# Prenájom bez vrások

## Spustenie

Účty sa ukladajú do SQLite databázy `data/accounts.sqlite3`. Spustite aplikáciu cez lokálny server namiesto otvárania `index.html` priamo:

1. Nainštalujte Python 3.9 alebo novší, ak ho ešte nemáte.
2. V PowerShelli prejdite do priečinka aplikácie a spustite:

   ```powershell
   python server.py
   ```

3. Otvorte [http://127.0.0.1:8000](http://127.0.0.1:8000).
4. Na stránke kliknite na ikonu profilu vpravo hore. V okne vyberte **Vytvoriť účet** na registráciu alebo **Prihlásenie** pre existujúci účet.
5. Server zastavíte klávesmi `Ctrl+C`.

Server počúva iba na tomto počítači. Heslá sa neukladajú v čitateľnej podobe; databáza ukladá ich PBKDF2 hash. Databáza sa vytvorí automaticky pri prvom spustení.

Účty vytvorené staršou verziou stránky v úložisku prehliadača sa do novej databázy automaticky neprenesú; bude potrebné ich vytvoriť znova.
