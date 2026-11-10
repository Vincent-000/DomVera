import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent
DATABASE = ROOT / "data" / "accounts.sqlite3"
SESSION_COOKIE = "rental_session"
SESSION_LIFETIME = 30 * 24 * 60 * 60
PASSWORD_ITERATIONS = 310_000
MAX_REQUEST_SIZE = 16 * 1024
STATIC_FILES = {
    "/": "index.html",
    "/index.html": "index.html",
    "/profile.html": "profile.html",
    "/property.html": "property.html",
    "/app.js": "app.js",
    "/style.css": "style.css",
}
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@contextmanager
def database():
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize_database():
    DATABASE.parent.mkdir(parents=True, exist_ok=True)
    with database() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL COLLATE NOCASE UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('tenant', 'landlord')),
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
            """
        )
        connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (int(time.time()),))


def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS
    )
    return f"pbkdf2_sha256${salt.hex()}${digest.hex()}"


def verify_password(password, encoded):
    try:
        algorithm, salt_hex, digest_hex = encoded.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
    except (ValueError, TypeError):
        return False

    actual = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS
    )
    return hmac.compare_digest(actual, expected)


def public_user(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "role": row["role"],
    }


class RequestError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class AccountHandler(BaseHTTPRequestHandler):
    server_version = "RentalAccountServer/1.0"

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/me":
            try:
                user = self.authenticated_user()
            except sqlite3.Error:
                self.log_error("Database operation failed")
                self.send_json(500, {"error": "Databázu sa nepodarilo spracovať."})
                return
            self.send_json(200, {"user": public_user(user) if user else None})
            return

        filename = STATIC_FILES.get(path)
        if filename is None:
            self.send_json(404, {"error": "Stránka sa nenašla."})
            return

        file_path = ROOT / filename
        try:
            contents = file_path.read_bytes()
        except OSError:
            self.send_json(404, {"error": "Súbor stránky sa nenašiel."})
            return

        content_type = "text/javascript; charset=utf-8" if filename.endswith(".js") else (
            "text/css; charset=utf-8" if filename.endswith(".css") else "text/html; charset=utf-8"
        )
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(contents)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(contents)

    def do_POST(self):
        path = urlsplit(self.path).path
        if path not in ("/api/register", "/api/login", "/api/logout"):
            self.send_json(404, {"error": "Požiadavka sa nenašla."})
            return
        if not self.check_origin():
            self.send_json(403, {"error": "Požiadavka nepochádza z tejto stránky."})
            return

        try:
            if path == "/api/register":
                self.register()
            elif path == "/api/login":
                self.login()
            else:
                self.logout()
        except RequestError as error:
            self.send_json(error.status, {"error": str(error)})
        except sqlite3.IntegrityError:
            self.send_json(409, {"error": "Účet s touto e-mailovou adresou už existuje."})
        except sqlite3.Error:
            self.log_error("Database operation failed")
            self.send_json(500, {"error": "Databázu sa nepodarilo spracovať."})

    def do_PATCH(self):
        if urlsplit(self.path).path != "/api/profile":
            self.send_json(404, {"error": "Požiadavka sa nenašla."})
            return
        if not self.check_origin():
            self.send_json(403, {"error": "Požiadavka nepochádza z tejto stránky."})
            return

        try:
            self.update_profile()
        except RequestError as error:
            self.send_json(error.status, {"error": str(error)})
        except sqlite3.IntegrityError:
            self.send_json(409, {"error": "Túto e-mailovú adresu už používa iný účet."})
        except sqlite3.Error:
            self.log_error("Database operation failed")
            self.send_json(500, {"error": "Databázu sa nepodarilo spracovať."})

    def register(self):
        payload = self.read_payload()
        name = self.valid_name(payload.get("name"))
        email = self.valid_email(payload.get("email"))
        password = self.valid_password(payload.get("password"))
        role = self.valid_role(payload.get("role"))

        with database() as connection:
            cursor = connection.execute(
                "INSERT INTO users (name, email, password_hash, role, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (name, email, hash_password(password), role, int(time.time())),
            )
            user = connection.execute(
                "SELECT id, name, email, role FROM users WHERE id = ?",
                (cursor.lastrowid,),
            ).fetchone()
            self.create_session(connection, user["id"])
        self.send_json(201, {"user": public_user(user)})

    def login(self):
        payload = self.read_payload()
        email = self.valid_email(payload.get("email"))
        password = payload.get("password")
        if not isinstance(password, str) or not password or len(password) > 1024:
            raise RequestError(400, "Zadajte e-mail a heslo.")

        with database() as connection:
            user = connection.execute(
                "SELECT id, name, email, role, password_hash FROM users WHERE email = ?",
                (email,),
            ).fetchone()
            password_matches = verify_password(
                password,
                user["password_hash"] if user else (
                    "pbkdf2_sha256$" + ("00" * 16) + "$" + ("00" * 32)
                ),
            )
            requested_role = payload.get("role")
            if (
                not user
                or not password_matches
                or (requested_role is not None and requested_role != user["role"])
            ):
                raise RequestError(401, "Nesprávny e-mail, heslo alebo typ účtu.")
            self.create_session(connection, user["id"])
        self.send_json(200, {"user": public_user(user)})

    def logout(self):
        token = self.session_token()
        if token:
            with database() as connection:
                connection.execute(
                    "DELETE FROM sessions WHERE token_hash = ?", (self.token_hash(token),)
                )
        self.clear_session_cookie()
        self.send_json(200, {"ok": True})

    def update_profile(self):
        user = self.authenticated_user()
        if not user:
            raise RequestError(401, "Pred úpravou profilu sa prihláste.")
        payload = self.read_payload()
        updates = {}

        if "name" in payload:
            updates["name"] = self.valid_name(payload["name"])
        if "email" in payload:
            updates["email"] = self.valid_email(payload["email"])
        if "role" in payload:
            updates["role"] = self.valid_role(payload["role"])
        if "password" in payload and payload["password"]:
            updates["password_hash"] = hash_password(
                self.valid_password(payload["password"])
            )
        if not updates:
            raise RequestError(400, "Nie sú zadané žiadne zmeny.")

        columns = ", ".join(f"{column} = ?" for column in updates)
        with database() as connection:
            connection.execute(
                f"UPDATE users SET {columns} WHERE id = ?",
                (*updates.values(), user["id"]),
            )
            updated_user = connection.execute(
                "SELECT id, name, email, role FROM users WHERE id = ?",
                (user["id"],),
            ).fetchone()
        self.send_json(200, {"user": public_user(updated_user)})

    def authenticated_user(self):
        token = self.session_token()
        if not token:
            return None

        with database() as connection:
            row = connection.execute(
                "SELECT users.id, users.name, users.email, users.role "
                "FROM sessions JOIN users ON users.id = sessions.user_id "
                "WHERE sessions.token_hash = ? AND sessions.expires_at > ?",
                (self.token_hash(token), int(time.time())),
            ).fetchone()
            if not row:
                connection.execute(
                    "DELETE FROM sessions WHERE token_hash = ?", (self.token_hash(token),)
                )
                self.clear_session_cookie()
        return row

    def create_session(self, connection, user_id):
        token = secrets.token_urlsafe(32)
        expires_at = int(time.time()) + SESSION_LIFETIME
        connection.execute(
            "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
            (self.token_hash(token), user_id, expires_at),
        )
        cookie = SimpleCookie()
        cookie[SESSION_COOKIE] = token
        cookie[SESSION_COOKIE]["path"] = "/"
        cookie[SESSION_COOKIE]["httponly"] = True
        cookie[SESSION_COOKIE]["samesite"] = "Lax"
        cookie[SESSION_COOKIE]["max-age"] = str(SESSION_LIFETIME)
        self._session_cookie = cookie.output(header="").strip()

    def session_token(self):
        cookie_header = self.headers.get("Cookie")
        if not cookie_header:
            return None
        cookie = SimpleCookie()
        try:
            cookie.load(cookie_header)
        except (ValueError, TypeError):
            return None
        morsel = cookie.get(SESSION_COOKIE)
        return morsel.value if morsel else None

    @staticmethod
    def token_hash(token):
        return hashlib.sha256(token.encode("ascii")).hexdigest()

    def clear_session_cookie(self):
        cookie = SimpleCookie()
        cookie[SESSION_COOKIE] = ""
        cookie[SESSION_COOKIE]["path"] = "/"
        cookie[SESSION_COOKIE]["httponly"] = True
        cookie[SESSION_COOKIE]["samesite"] = "Lax"
        cookie[SESSION_COOKIE]["max-age"] = "0"
        self._session_cookie = cookie.output(header="").strip()

    def read_payload(self):
        if self.headers.get_content_type() != "application/json":
            raise RequestError(415, "Požiadavka musí obsahovať JSON.")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise RequestError(400, "Neplatná požiadavka.")
        if length < 1 or length > MAX_REQUEST_SIZE:
            raise RequestError(400, "Neplatná veľkosť požiadavky.")
        try:
            payload = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise RequestError(400, "Požiadavka obsahuje neplatné údaje.")
        if not isinstance(payload, dict):
            raise RequestError(400, "Požiadavka obsahuje neplatné údaje.")
        return payload

    def check_origin(self):
        origin = self.headers.get("Origin")
        if not origin:
            return True
        return origin == f"http://{self.headers.get('Host', '')}"

    @staticmethod
    def valid_name(value):
        if not isinstance(value, str):
            raise RequestError(400, "Meno je povinné.")
        value = value.strip()
        if not value or len(value) > 100:
            raise RequestError(400, "Meno musí mať 1 až 100 znakov.")
        return value

    @staticmethod
    def valid_email(value):
        if not isinstance(value, str):
            raise RequestError(400, "Zadajte platnú e-mailovú adresu.")
        value = value.strip().lower()
        if len(value) > 254 or not EMAIL_PATTERN.fullmatch(value):
            raise RequestError(400, "Zadajte platnú e-mailovú adresu.")
        return value

    @staticmethod
    def valid_password(value):
        if not isinstance(value, str) or len(value) < 8 or len(value) > 1024:
            raise RequestError(400, "Heslo musí mať aspoň 8 znakov.")
        return value

    @staticmethod
    def valid_role(value):
        if value not in ("tenant", "landlord"):
            raise RequestError(400, "Vyberte platný typ účtu.")
        return value

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if hasattr(self, "_session_cookie"):
            self.send_header("Set-Cookie", self._session_cookie)
            del self._session_cookie
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format_string, *args):
        super().log_message(format_string, *args)


if __name__ == "__main__":
    initialize_database()
    port = int(os.environ.get("PORT", 8000))
    server = ThreadingHTTPServer(("0.0.0.0", port), AccountHandler)
    print(f"Server is running on port {port} (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()