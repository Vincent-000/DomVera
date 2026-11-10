const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

let currentUser = null;

const getCurrentUser = () => currentUser;
const setCurrentUser = user => {
  currentUser = user;
};

const request = async (path, options = {}) => {
  let response;
  try {
    response = await fetch(`/api/${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
      },
      credentials: 'same-origin'
    });
  } catch {
    throw new Error('Server nie je dostupný. Spustite aplikáciu cez python server.py.');
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('Server nie je dostupný. Spustite aplikáciu cez python server.py.');
  }

  if (!response.ok) {
    throw new Error(result.error || 'Požiadavku sa nepodarilo spracovať.');
  }

  return result;
};

const authApi = {
  async register(payload) {
    const result = await request('register', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    setCurrentUser(result.user);
    return result.user;
  },

  async login(payload) {
    const result = await request('login', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    setCurrentUser(result.user);
    return result.user;
  },

  async logout() {
    await request('logout', { method: 'POST' });
    setCurrentUser(null);
  },

  async updateProfile(payload) {
    const result = await request('profile', {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    setCurrentUser(result.user);
    return result.user;
  }
};

const authModal = $('#authModal');
const authForm = $('#authForm');
const authMessage = $('#authMessage');
const authSubmit = $('#authSubmit');
const authTabs = $$('.auth-tab');
const authNameField = $('#nameField');
const authEmail = $('#authEmail');
const authPassword = $('#authPassword');
const authRole = $('#authRole');
const accountButton = $('#accountButton');
const logoutButton = $('#logoutButton');
const profileMenu = $('#profileMenu');
const loggedUserName = $('#loggedUserName');
const settingsLink = $('#settingsLink');
const profileSettingsForm = $('#profileSettingsForm');
const profileSettingsMessage = $('#profileSettingsMessage');
const profileNameInput = $('#profileNameInput');
const profileEmailInput = $('#profileEmailInput');
const profilePasswordInput = $('#profilePasswordInput');
const profileRoleInput = $('#profileRoleInput');

let authMode = 'login';
const sessionReady = request('me')
  .then(result => setCurrentUser(result.user))
  .catch(error => {
    console.error(error);
    if (authMessage) setAuthMessage('Účet sa nepodarilo načítať. Skontrolujte, či je server spustený.', 'error');
  });

const setAuthMessage = (message = '', type = '') => {
  if (!authMessage) return;
  authMessage.textContent = message;
  authMessage.className = 'auth-message';
  if (type) authMessage.classList.add(type);
};

const setProfileSettingsMessage = (message = '', type = '') => {
  if (!profileSettingsMessage) return;
  profileSettingsMessage.textContent = message;
  profileSettingsMessage.className = 'auth-message';
  if (type) profileSettingsMessage.classList.add(type);
};

const syncModeButtons = (mode = document.body.dataset.mode || 'tenant') => {
  document.body.dataset.mode = mode;
  document.querySelectorAll('.pill button').forEach(button => {
    button.classList.toggle('active', button.dataset.mode === mode);
  });
  if (authRole) authRole.value = mode;
  if (profileRoleInput) profileRoleInput.value = mode;
};

const updateAccountMenu = () => {
  const user = getCurrentUser();

  if (!profileMenu || !loggedUserName) return;

  if (!user) {
    loggedUserName.textContent = 'Nie ste prihlásený';
    if (settingsLink) settingsLink.classList.add('hidden');
    if (logoutButton) logoutButton.classList.add('hidden');
    if (profileMenu) profileMenu.style.display = 'none';
    return;
  }

  loggedUserName.textContent = user.name;
  if (settingsLink) settingsLink.classList.remove('hidden');
  if (logoutButton) logoutButton.classList.remove('hidden');
  if (profileMenu) profileMenu.style.display = '';
};

const setAuthTab = mode => {
  authMode = mode;
  if (!authTabs.length) return;

  authTabs.forEach(tab => tab.classList.toggle('active', tab.dataset.authTab === mode));
  const isRegister = mode === 'register';
  if (authNameField) authNameField.classList.toggle('hidden', !isRegister);
  if (authPassword) authPassword.autocomplete = isRegister ? 'new-password' : 'current-password';
  if (authPassword) {
    authPassword.minLength = isRegister ? 8 : 0;
    authPassword.placeholder = isRegister ? 'Aspoň 8 znakov' : '********';
  }
  if (authSubmit) authSubmit.textContent = isRegister ? 'Vytvoriť účet' : 'Prihlásiť sa';
  if (authRole) authRole.value = document.body.dataset.mode || 'tenant';
  setAuthMessage();
};

const openAuthModal = () => {
  if (!authModal) return;
  authModal.classList.remove('hidden');
  authModal.setAttribute('aria-hidden', 'false');
  if (authRole) authRole.value = document.body.dataset.mode || 'tenant';
};

const closeAuthModal = () => {
  if (!authModal) return;
  authModal.classList.add('hidden');
  authModal.setAttribute('aria-hidden', 'true');
  setAuthMessage();
};

const handleAuthSubmit = async event => {
  event.preventDefault();

  const formData = new FormData(authForm);
  const name = (formData.get('name') || '').toString().trim();
  const email = (formData.get('email') || '').toString().trim().toLowerCase();
  const password = (formData.get('password') || '').toString();
  const role = (formData.get('role') || document.body.dataset.mode || 'tenant').toString();

  if (!email || !password || (authMode === 'register' && !name)) {
    setAuthMessage('Vyplňte všetky povinné polia.', 'error');
    return;
  }
  if (authMode === 'register' && password.length < 8) {
    setAuthMessage('Heslo musí mať aspoň 8 znakov.', 'error');
    return;
  }

  authEmail.value = email;
  if (!authEmail.checkValidity()) {
    setAuthMessage('Zadajte platnú e-mailovú adresu, napríklad meno@domena.sk.', 'error');
    return;
  }

  try {
    const user = authMode === 'register'
      ? await authApi.register({ name, email, password, role })
      : await authApi.login({ email, password, role });

    syncModeButtons(user.role);
    updateAccountMenu();
    closeAuthModal();
  } catch (error) {
    setAuthMessage(error.message, 'error');
  }
};

const handleProfileUpdate = async event => {
  event.preventDefault();

  const currentUser = getCurrentUser();
  if (!currentUser) {
    window.location.href = 'index.html';
    return;
  }

  const nextName = (profileNameInput.value || '').trim();
  const nextEmail = (profileEmailInput.value || '').trim().toLowerCase();
  const nextPassword = profilePasswordInput.value || '';
  const nextRole = (profileRoleInput.value || currentUser.role || 'tenant');

  if (!nextName || !nextEmail) {
    setProfileSettingsMessage('Meno a e-mail sú povinné.', 'error');
    return;
  }

  profileEmailInput.value = nextEmail;
  if (!profileEmailInput.checkValidity()) {
    setProfileSettingsMessage('Zadajte platnú e-mailovú adresu, napríklad meno@domena.sk.', 'error');
    return;
  }

  try {
    const updatedUser = await authApi.updateProfile({
      name: nextName,
      email: nextEmail,
      password: nextPassword,
      role: nextRole
    });
    syncModeButtons(updatedUser.role);
    updateAccountMenu();
    if (profilePasswordInput) profilePasswordInput.value = '';
    setProfileSettingsMessage('Profil bol úspešne aktualizovaný.', 'success');
  } catch (error) {
    setProfileSettingsMessage(error.message, 'error');
  }
};

const populateProfileForm = () => {
  if (!profileSettingsForm) return;

  const user = getCurrentUser();
  if (!user) {
    setProfileSettingsMessage('Pred úpravou profilu sa prihláste.', 'error');
    setTimeout(() => {
      window.location.href = 'index.html';
    }, 800);
    return;
  }

  if (profileNameInput) profileNameInput.value = user.name || '';
  if (profileEmailInput) profileEmailInput.value = user.email || '';
  if (profilePasswordInput) profilePasswordInput.value = '';
  if (profileRoleInput) profileRoleInput.value = user.role || 'tenant';
  syncModeButtons(user.role);
};

const initModeSwitch = () => {
  document.querySelectorAll('.pill button').forEach(button => {
    button.addEventListener('click', async () => {
      const nextMode = button.dataset.mode;
      const user = getCurrentUser();
      const previousMode = document.body.dataset.mode || 'tenant';
      syncModeButtons(nextMode);

      if (user) {
        try {
          await authApi.updateProfile({ role: nextMode });
        } catch (error) {
          syncModeButtons(previousMode);
          if (profileSettingsMessage) {
            setProfileSettingsMessage(error.message, 'error');
          } else if (authMessage) {
            setAuthMessage(error.message, 'error');
          } else {
            window.alert(error.message);
          }
          return;
        }
      }

      scrollTo({ top: 0, behavior: 'smooth' });
      updateAccountMenu();
    });
  });
};

const rentalProperties = [
  {
    id: 'bratislava-stare-mesto',
    title: 'Svetlý 2-izbový byt s balkónom',
    location: 'Bratislava, Staré Mesto',
    landlord: { name: 'Mária Vejková', score: 75, rentals: 2, months: 16 },
    price: 890,
    utilities: 180,
    area: 64,
    rooms: 2,
    floor: '4. poschodie z 6',
    furnishing: 'Kompletne zariadený',
    available: 'Od 1. decembra 2026',
    deposit: 1780,
    energy: 'B',
    pets: 'Po dohode',
    description: 'Príjemný, moderne zariadený byt v pokojnej ulici Starého Mesta. Obývacia izba je prepojená s kuchyňou a z oboch izieb je výhľad do zelene. V okolí nájdete zastávky MHD, obchody aj kaviarne.',
    features: ['Balkón', 'Pivnica', 'Výťah', 'Umývačka riadu'],
    images: [
      'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1400&q=85',
      'https://images.unsplash.com/photo-1484154213954-3eded5c46d2a?auto=format&fit=crop&w=1000&q=80',
      'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1000&q=80'
    ]
  },
  {
    id: 'kosice-terasa',
    title: 'Útulný 3-izbový byt po rekonštrukcii',
    location: 'Košice, Terasa',
    landlord: { name: 'Ján Kováč', score: 92, rentals: 8, months: 42 },
    price: 760,
    utilities: 150,
    area: 72,
    rooms: 3,
    floor: '2. poschodie z 8',
    furnishing: 'Čiastočne zariadený',
    available: 'Ihneď',
    deposit: 760,
    energy: 'C',
    pets: 'Nie',
    description: 'Zrekonštruovaný byt s praktickou dispozíciou a dostatkom úložného priestoru. Kuchyňa je vybavená spotrebičmi a v obývacej izbe je miesto na jedálenský stôl. V blízkosti je park, školy a električková zastávka.',
    features: ['Loggia', 'Pivnica', 'Výťah', 'Nová kuchyňa'],
    images: [
      'https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=1400&q=85',
      'https://images.unsplash.com/photo-1460317442991-0ec209397118?auto=format&fit=crop&w=1000&q=80',
      'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1000&q=80'
    ]
  },
  {
    id: 'zilina-solinky',
    title: 'Moderný 1-izbový byt v novostavbe',
    location: 'Žilina, Solinky',
    landlord: { name: 'Lucia Horváthová', score: 88, rentals: 5, months: 28 },
    price: 590,
    utilities: 120,
    area: 38,
    rooms: 1,
    floor: '5. poschodie z 7',
    furnishing: 'Kompletne zariadený',
    available: 'Od 15. novembra 2026',
    deposit: 590,
    energy: 'A',
    pets: 'Po dohode',
    description: 'Kompaktný byt s premysleným úložným priestorom a veľkými oknami. Novostavba má energeticky úspornú prevádzku a upravené spoločné priestory. Parkovanie je možné prenajať priamo pri dome.',
    features: ['Novostavba', 'Výťah', 'Parkovanie za príplatok', 'Klimatizácia'],
    images: [
      'https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=1400&q=85',
      'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1000&q=80',
      'https://images.unsplash.com/photo-1484154213954-3eded5c46d2a?auto=format&fit=crop&w=1000&q=80'
    ]
  },
  {
    id: 'nitra-chrenova',
    title: 'Priestranný 2-izbový byt s terasou',
    location: 'Nitra, Chrenová',
    landlord: { name: 'Peter Novotný', score: 96, rentals: 12, months: 63 },
    price: 680,
    utilities: 140,
    area: 58,
    rooms: 2,
    floor: 'Prízemie',
    furnishing: 'Kompletne zariadený',
    available: 'Ihneď',
    deposit: 1360,
    energy: 'B',
    pets: 'Po dohode',
    description: 'Vzdušný byt s priamym vstupom na súkromnú terasu, ideálny na pokojné bývanie. Kuchyňa a obývacia izba tvoria otvorený denný priestor. Potraviny aj zastávka MHD sú pár minút pešo.',
    features: ['Terasa', 'Bezbariérový prístup', 'Pivnica', 'Umývačka riadu'],
    images: [
      'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1400&q=85',
      'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1000&q=80',
      'https://images.unsplash.com/photo-1460317442991-0ec209397118?auto=format&fit=crop&w=1000&q=80'
    ]
  }
];

const renderLandlordTrust = landlord => {
  const initials = landlord.name.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase();
  return `
    <div class="landlord-trust" aria-label="Trust score prenajímateľa ${landlord.name}: ${landlord.score} percent">
      <div class="landlord-identity">
        <span class="landlord-avatar" aria-hidden="true">${initials}</span>
        <span class="landlord-name"><span class="landlord-label">Profil prenajímateľa</span><strong>${landlord.name}</strong><span class="landlord-verified">Overený profil</span></span>
      </div>
      <div class="trust-score-row"><span>Rent Trust Score</span><strong>${landlord.score}<small>%</small></strong></div>
      <div class="trust-meter" role="meter" aria-label="Rent Trust Score" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${landlord.score}"><span style="width:${landlord.score}%"></span></div>
      <div class="landlord-stats"><span><strong>${landlord.rentals}</strong> úspešných prenájmov</span><span><strong>${landlord.months}</strong> mesiacov na platforme</span></div>
    </div>
  `;
};

const landlordProfiles = [
  { name: 'Barbora Kováčová', score: 91, rentals: 9, months: 39 },
  { name: 'Samuel Benko', score: 84, rentals: 4, months: 24 },
  { name: 'Daniela Malíková', score: 97, rentals: 16, months: 71 },
  { name: 'Tomáš Varga', score: 78, rentals: 3, months: 13 }
];

const renderLandlordProfiles = () => {
  const profiles = $('#landlordTrustProfiles');
  if (!profiles) return;
  profiles.innerHTML = landlordProfiles.map(renderLandlordTrust).join('');
};

const renderListings = () => {
  document.querySelectorAll('.listings').forEach(grid => {
    const showLandlordTrust = Boolean(grid.closest('.tenant-only'));
    grid.innerHTML = rentalProperties.map(property => `
      <a class="listing" href="property.html?id=${property.id}" aria-label="${property.title}, ${property.location}, ${property.price} eur mesačne">
        <img loading="lazy" alt="${property.title}" src="${property.images[0]}">
        <span class="listing-location">${property.location}</span>
        <h4>${property.title}</h4>
        <p>${property.area} m² · ${property.rooms} ${property.rooms === 1 ? 'izba' : 'izby'}</p>
        <strong class="listing-price">${property.price} € / mes.</strong>
        <span class="listing-costs">Energie ${property.utilities} € · spolu ${property.price + property.utilities} € / mes.</span>
        ${showLandlordTrust ? renderLandlordTrust(property.landlord) : ''}
      </a>
    `).join('');
  });
};

const renderPropertyDetail = () => {
  const detail = $('#propertyDetail');
  if (!detail) return;

  const propertyId = new URLSearchParams(window.location.search).get('id');
  const property = rentalProperties.find(item => item.id === propertyId);

  if (!property) {
    detail.innerHTML = '<div class="property-not-found"><h1>Ponuka sa nenašla</h1><a class="back-link" href="index.html">Späť na ponuky</a></div>';
    return;
  }

  document.title = `${property.title} | Prenájom bez vrások`;
  detail.innerHTML = `
    <div class="property-heading">
      <div><p class="property-location">${property.location}</p><h1>${property.title}</h1></div>
      <p class="property-price">${property.price} € <span>/ mesiac</span></p>
    </div>
    ${renderLandlordTrust(property.landlord)}
    <div class="property-gallery">
      <img class="property-main-image" src="${property.images[0]}" alt="${property.title} - fotografia 1">
      <div class="property-thumbnails">
        ${property.images.map((image, index) => `<button class="property-thumbnail${index === 0 ? ' active' : ''}" type="button" data-image="${image}" data-alt="${property.title} - fotografia ${index + 1}" aria-label="Zobraziť fotografiu ${index + 1}"><img src="${image}" alt=""></button>`).join('')}
      </div>
    </div>
    <div class="property-content">
      <section class="property-description"><h2>O nehnuteľnosti</h2><p>${property.description}</p><h3>Vybavenie</h3><ul class="property-features">${property.features.map(feature => `<li>${feature}</li>`).join('')}</ul></section>
      <aside class="property-facts"><h2>Detaily ponuky</h2><dl>
        <div><dt>Úžitková plocha</dt><dd>${property.area} m²</dd></div>
        <div><dt>Izby</dt><dd>${property.rooms}</dd></div>
        <div><dt>Poschodie</dt><dd>${property.floor}</dd></div>
        <div><dt>Zariadenie</dt><dd>${property.furnishing}</dd></div>
        <div><dt>Dostupnosť</dt><dd>${property.available}</dd></div>
        <div><dt>Depozit</dt><dd>${property.deposit} €</dd></div>
        <div><dt>Energie a služby</dt><dd>${property.utilities} € / mesiac</dd></div>
        <div><dt>Spolu mesačne</dt><dd>${property.price + property.utilities} €</dd></div>
        <div><dt>Energetická trieda</dt><dd>${property.energy}</dd></div>
        <div><dt>Domáce zvieratá</dt><dd>${property.pets}</dd></div>
      </dl></aside>
    </div>
    <a class="property-back" href="index.html#tenant-listings">← Späť na ponuky</a>
  `;

  const mainImage = detail.querySelector('.property-main-image');
  detail.querySelectorAll('.property-thumbnail').forEach(button => {
    button.addEventListener('click', () => {
      mainImage.src = button.dataset.image;
      mainImage.alt = button.dataset.alt;
      detail.querySelectorAll('.property-thumbnail').forEach(thumbnail => thumbnail.classList.toggle('active', thumbnail === button));
    });
  });
};

const calc = () => {
  const stateInput = $('#state');
  const roomsInput = $('#rooms');
  const costsInput = $('#costs');
  const result = $('#result');

  if (!stateInput || !roomsInput || !costsInput || !result) return;

  const f = +stateInput.value;
  const r = +roomsInput.value;
  const c = +costsInput.value || 0;

  result.textContent = f && r
    ? `≈ ${Math.round((200 + r * 150) * f + c)} € / mesiac (orientačný výpočet)`
    : 'Vyplňte parametre bytu.';
};

if (accountButton) {
  accountButton.addEventListener('click', async () => {
    await sessionReady;
    if (!getCurrentUser()) {
      openAuthModal();
    }
  });
}

if (logoutButton) {
  logoutButton.addEventListener('click', async () => {
    try {
      await authApi.logout();
      updateAccountMenu();
      if (window.location.pathname.endsWith('profile.html')) {
        window.location.href = 'index.html';
      }
    } catch (error) {
      if (authMessage) {
        setAuthMessage(error.message, 'error');
      } else if (profileSettingsMessage) {
        setProfileSettingsMessage(error.message, 'error');
      } else {
        window.alert(error.message);
      }
    }
  });
}

if (authTabs.length) {
  authTabs.forEach(tab => {
    tab.addEventListener('click', () => setAuthTab(tab.dataset.authTab));
  });
}

if (authForm) {
  authForm.addEventListener('submit', handleAuthSubmit);
}

if (profileSettingsForm) {
  profileSettingsForm.addEventListener('submit', handleProfileUpdate);
}

if (authModal) {
  $('#closeAuth')?.addEventListener('click', closeAuthModal);
  authModal.addEventListener('click', event => {
    if (event.target === authModal) closeAuthModal();
  });
}

if (profileSettingsForm) {
  setProfileSettingsMessage();
}

const initUi = async () => {
  await sessionReady;
  const user = getCurrentUser();
  syncModeButtons(user ? user.role : document.body.dataset.mode || 'tenant');
  initModeSwitch();
  renderListings();
  renderLandlordProfiles();
  renderPropertyDetail();
  calc();
  document.querySelectorAll('.calc input, .calc select').forEach(input => {
    input.addEventListener('input', calc);
  });
  updateAccountMenu();
  populateProfileForm();
  if (authForm) setAuthTab('login');
};

initUi().catch(error => {
  console.error(error);
  if (authMessage) setAuthMessage('Stránku sa nepodarilo inicializovať.', 'error');
});
