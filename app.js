// ── SMOOTH SCROLL ──
function scrollToSection(id) {
  const section = document.getElementById(id);
  if (!section) return;

  if (window.location.hash !== `#${id}`) {
    history.pushState(null, '', `#${id}`);
  }

  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
window.scrollToSection = scrollToSection;
globalThis.scrollToSection = scrollToSection;

function handleInitialHash() {
  const hash = window.location.hash.replace('#', '').trim();
  if (hash) {
    requestAnimationFrame(() => scrollToSection(hash));
  }
}

function activateCell(element) {
  const target = element.getAttribute('data-scroll-target');
  const message = element.getAttribute('data-toast');
  const action = element.getAttribute('data-action');
  const targetSection = target ? document.getElementById(target) : null;

  if (target) scrollToSection(target);

  if (targetSection) {
    targetSection.classList.remove('section-highlight');
    void targetSection.offsetWidth;
    targetSection.classList.add('section-highlight');
    setTimeout(() => targetSection.classList.remove('section-highlight'), 1400);
  }

  if (action === 'stories') {
    setTimeout(() => {
      document.getElementById('cards-grid')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 250);
  } else if (action === 'mail') {
    setTimeout(() => {
      document.getElementById('letter-name')?.focus();
    }, 350);
  } else if (action === 'locker') {
    setTimeout(() => {
      document.getElementById('inp-name')?.focus();
    }, 350);
  }

  if (message) showToast(message);
}

document.querySelectorAll('[data-scroll-target]').forEach(cell => {
  cell.addEventListener('click', () => activateCell(cell));
  cell.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activateCell(cell);
    }
  });
});

// ── TOAST ──
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}
window.showToast = showToast;
globalThis.showToast = showToast;
window.handleLogin = handleLogin;
globalThis.handleLogin = handleLogin;
window.handleRegister = handleRegister;
globalThis.handleRegister = handleRegister;
window.publishCard = publishCard;
globalThis.publishCard = publishCard;
window.submitLetter = submitLetter;
globalThis.submitLetter = submitLetter;
window.submitAnonymousLetter = submitAnonymousLetter;
globalThis.submitAnonymousLetter = submitAnonymousLetter;
window.submitMeme = submitMeme;
globalThis.submitMeme = submitMeme;
window.deleteCard = deleteCard;
globalThis.deleteCard = deleteCard;
window.previewPhoto = previewPhoto;
globalThis.previewPhoto = previewPhoto;
window.previewMemePhoto = previewMemePhoto;
globalThis.previewMemePhoto = previewMemePhoto;
window.openMemeModal = openMemeModal;
globalThis.openMemeModal = openMemeModal;
window.bindMemeCards = bindMemeCards;
globalThis.bindMemeCards = bindMemeCards;

// ── DATA LAYER ──
// Все читання/запис даних іде ЛИШЕ через власний бекенд (/api/...).
// Реєстрація/логін зберігають users на сервері й НІКОЛИ не повертаються
// у публічний /api/state — тож звичайні відвідувачі їх не бачать.
// Картки, листи й меми — публічні: їх бачать усі, хто заходить на сайт.
const API_BASE = '/api';

let cards = [];
let letters = [];
let memes = [];
let currentUser = null;

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Помилка запиту');
  }
  return data;
}

async function loadState() {
  try {
    const data = await requestJson('/state');
    cards = data.cards || [];
    letters = data.letters || [];
    memes = data.memes || [];
  } catch (error) {
    showToast('Не вдалося завантажити дані сайту');
  }
}

// ── MODAL ──
const modals = {
  login: `
    <div class="modal-title">Увійти</div>
    <form class="stack-form" onsubmit="handleLogin(event)">
      <div><label class="form-label">Email</label><input id="login-email" class="form-input" type="email" placeholder="your@email.com" required /></div>
      <div><label class="form-label">Пароль</label><input id="login-password" class="form-input" type="password" placeholder="••••••" required /></div>
      <button class="publish-btn" type="submit">Увійти →</button>
    </form>`,
  register: `
    <div class="modal-title">Зареєструватися</div>
    <form class="stack-form" onsubmit="handleRegister(event)">
      <div><label class="form-label">Ім'я</label><input id="register-name" class="form-input" type="text" placeholder="Твоє ім'я" required /></div>
      <div><label class="form-label">Email</label><input id="register-email" class="form-input" type="email" placeholder="your@email.com" required /></div>
      <div><label class="form-label">Пароль</label><input id="register-password" class="form-input" type="password" placeholder="••••••" required /></div>
      <button class="publish-btn" type="submit">Зареєструватися →</button>
    </form>`,
  anon: `
    <div class="modal-title">✉ Анонімний лист</div>
    <form class="stack-form" onsubmit="submitAnonymousLetter(event)">
      <div><label class="form-label">Кому?</label><input id="anon-recipient" class="form-input" type="text" placeholder="Або залиш порожнім" /></div>
      <div><label class="form-label">Твоє повідомлення</label><textarea id="anon-message" class="form-textarea" placeholder="Напиши те, що важко сказати вголос..." required></textarea></div>
      <button class="publish-btn" type="submit">Надіслати →</button>
    </form>`
};

function openModal(type) {
  document.getElementById('modal-content').innerHTML = modals[type] || '';
  document.getElementById('modal-overlay').classList.add('open');
}
window.openModal = openModal;
globalThis.openModal = openModal;
function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('open');
  document.getElementById('modal-content').innerHTML = '';
}
function closeModalOutside(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
}
window.closeModal = closeModal;
globalThis.closeModal = closeModal;
window.closeModalOutside = closeModalOutside;
globalThis.closeModalOutside = closeModalOutside;

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeModal();
});

function openMemeModal(title, text, photo, date) {
  document.getElementById('modal-content').innerHTML = `
    <div class="meme-modal">
      <div class="modal-title">Мем</div>
      ${photo ? `<img class="meme-modal-image" src="${photo}" alt="${escHtml(title)}" />` : ''}
      <div class="meme-modal-title">${escHtml(title)}</div>
      <div class="meme-modal-date">${escHtml(date)}</div>
      <div class="meme-modal-text">${escHtml(text)}</div>
    </div>`;
  document.getElementById('modal-overlay').classList.add('open');
}

function bindMemeCards() {
  document.querySelectorAll('.meme-card').forEach(card => {
    card.addEventListener('click', () => {
      openMemeModal(
        card.getAttribute('data-title') || '',
        card.getAttribute('data-text') || '',
        card.getAttribute('data-photo') || '',
        card.getAttribute('data-date') || ''
      );
    });
  });
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value.trim();
  if (!email || !password) {
    showToast('Заповни всі поля');
    return;
  }
  try {
    const data = await requestJson('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    currentUser = data.user;
    renderAll();
    closeModal();
    showToast(`Ласкаво просимо, ${data.user.name}!`);
  } catch (error) {
    showToast(error.message);
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('register-name').value.trim();
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value.trim();
  if (!name || !email || !password) {
    showToast('Заповни всі поля');
    return;
  }
  try {
    const data = await requestJson('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password })
    });
    currentUser = data.user;
    renderAll();
    closeModal();
    showToast(`Реєстрація успішна, ${name}!`);
  } catch (error) {
    showToast(error.message);
  }
}

async function submitAnonymousLetter(e) {
  e.preventDefault();
  const recipient = document.getElementById('anon-recipient').value.trim();
  const message = document.getElementById('anon-message').value.trim();
  if (!message) {
    showToast('Напиши текст листа');
    return;
  }
  try {
    const data = await requestJson('/letters', {
      method: 'POST',
      body: JSON.stringify({
        author: currentUser ? currentUser.name : 'Анонім',
        recipient: recipient || 'Невідомий адресат',
        message,
        date: new Date().toLocaleDateString('uk-UA')
      })
    });
    letters = data.state.letters || [];
    renderLetters();
    closeModal();
    showToast('Лист надіслано! ✉');
  } catch (error) {
    showToast(error.message);
  }
}

// ── PHOTO PREVIEW ──
function previewPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById('photo-preview');
    img.src = e.target.result;
    img.style.display = 'block';
  };
  reader.readAsDataURL(file);
}

function previewMemePhoto(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById('meme-preview');
    img.src = e.target.result;
    img.style.display = 'block';
  };
  reader.readAsDataURL(file);
}

// ── PUBLISH CARD (публічно, бачать усі) ──
async function publishCard() {
  const name = document.getElementById('inp-name').value.trim();
  const story = document.getElementById('inp-story').value.trim();
  const preview = document.getElementById('photo-preview');
  const hasPhoto = preview.style.display !== 'none' && preview.getAttribute('src') && preview.getAttribute('src').startsWith('data:');

  if (!name || !story) { showToast('Заповни ім\'я та історію!'); return; }

  try {
    const data = await requestJson('/cards', {
      method: 'POST',
      body: JSON.stringify({
        name,
        story,
        photo: hasPhoto ? preview.getAttribute('src') : null,
        date: new Date().toLocaleDateString('uk-UA')
      })
    });
    cards = data.state.cards || [];
    renderCards();

    document.getElementById('inp-name').value = '';
    document.getElementById('inp-story').value = '';
    document.getElementById('inp-photo').value = '';
    preview.removeAttribute('src');
    preview.style.display = 'none';
    showToast('Картку опубліковано! ✦');
  } catch (error) {
    showToast(error.message);
  }
}

async function submitLetter(e) {
  e.preventDefault();
  const name = document.getElementById('letter-name').value.trim();
  const text = document.getElementById('letter-text').value.trim();
  if (!name || !text) {
    showToast('Заповни ім\'я та повідомлення');
    return;
  }
  try {
    const data = await requestJson('/letters', {
      method: 'POST',
      body: JSON.stringify({
        author: name,
        recipient: 'Внутрішня адреса',
        message: text,
        date: new Date().toLocaleDateString('uk-UA')
      })
    });
    letters = data.state.letters || [];
    renderLetters();
    document.getElementById('letter-name').value = '';
    document.getElementById('letter-text').value = '';
    showToast('Лист надіслано! ✉');
  } catch (error) {
    showToast(error.message);
  }
}

async function submitMeme(e) {
  e.preventDefault();
  const title = document.getElementById('meme-title').value.trim();
  const text = document.getElementById('meme-text').value.trim();
  const preview = document.getElementById('meme-preview');
  const hasPhoto = preview.style.display !== 'none' && preview.getAttribute('src') && preview.getAttribute('src').startsWith('data:');
  if (!title || !text) {
    showToast('Заповни назву і текст мема');
    return;
  }
  try {
    const data = await requestJson('/memes', {
      method: 'POST',
      body: JSON.stringify({
        title,
        text,
        photo: hasPhoto ? preview.getAttribute('src') : null,
        author_name: currentUser?.name || 'Анонім',
        date: new Date().toLocaleDateString('uk-UA')
      })
    });
    memes = data.state.memes || [];
    renderMemes();
    document.getElementById('meme-title').value = '';
    document.getElementById('meme-text').value = '';
    document.getElementById('meme-photo').value = '';
    preview.removeAttribute('src');
    preview.style.display = 'none';
    showToast('Мем додано! 😂');
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteCard(id) {
  try {
    const data = await requestJson(`/cards/${id}`, { method: 'DELETE' });
    cards = data.state.cards || [];
    renderCards();
  } catch (error) {
    showToast(error.message);
  }
}

function renderCards() {
  const grid = document.getElementById('cards-grid');
  if (!grid) return;
  if (cards.length === 0) {
    grid.innerHTML = '<div class="cards-empty">Ще немає карток. Будь першим!</div>';
    return;
  }
  grid.innerHTML = cards.map(c => `
    <div class="polaroid">
      <button class="polaroid-del" onclick="deleteCard(${c.id})">✕</button>
      ${c.photo
        ? `<img class="polaroid-img" src="${c.photo}" alt=""/>`
        : `<div class="polaroid-img-placeholder">📷</div>`}
      <div class="polaroid-name">${escHtml(c.name)}</div>
      <div class="polaroid-date">${c.date}</div>
      <div class="polaroid-text">${escHtml(c.story)}</div>
    </div>
  `).join('');
}

function renderLetters() {
  const list = document.getElementById('letters-list');
  if (!list) return;
  if (letters.length === 0) {
    list.innerHTML = '<div class="feed-item"><strong>Поки що немає листів</strong><p>Стань першим, хто поділиться своєю думкою.</p></div>';
    return;
  }
  list.innerHTML = letters.slice(0, 6).map(item => `
    <div class="feed-item">
      <strong>${escHtml(item.author)}</strong>
      <small>${escHtml(item.recipient)} • ${item.date}</small>
      <p>${escHtml(item.message)}</p>
    </div>
  `).join('');
}

function renderMemes() {
  const list = document.getElementById('memes-list');
  if (!list) return;
  const fallbackMemes = [
    { title: 'Мем 1', text: 'Веселий момент для спільноти', photo: 'assets/images/meme1.jpg', date: '01.08.2026' },
    { title: 'Мем 2', text: 'Коли всі вже в темі', photo: 'assets/images/meme2.jpg', date: '01.08.2026' },
    { title: 'Мем 3', text: 'Підтримка в дії', photo: 'assets/images/meme3.jpg', date: '01.08.2026' },
    { title: 'Мем 4', text: 'Сміх — це теж сила', photo: 'assets/images/meme4.jpg', date: '01.08.2026' },
    { title: 'Мем 5', text: 'Залізна зміна в русі', photo: 'assets/images/meme5.jpg', date: '01.08.2026' },
    { title: 'Мем 6', text: 'Ми в команді', photo: 'assets/images/meme6.jpg', date: '01.08.2026' }
  ];
  const items = memes.length > 0 ? memes : fallbackMemes;
  if (items.length === 0) {
    list.innerHTML = '<div class="feed-item"><strong>Поки що немає мемів</strong><p>Додай веселий момент для спільноти.</p></div>';
    return;
  }
  list.innerHTML = items.slice(0, 6).map(item => `
      <div class="feed-item meme-card" role="button" tabindex="0" data-title="${escHtml(item.title)}" data-text="${escHtml(item.text)}" data-photo="${item.photo || ''}" data-date="${escHtml(item.date)}">
        <strong>${escHtml(item.title)}</strong>
        <small>${item.date}</small>
        ${item.photo ? `<img class="meme-card-image" src="${item.photo}" alt="${escHtml(item.title)}"/>` : ''}
        <p>${escHtml(item.text)}</p>
      </div>
    `).join('');
  bindMemeCards();
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderAll() {
  renderCards();
  renderLetters();
  renderMemes();
}

async function initApp() {
  await loadState();
  renderAll();
}

initApp();

function handleGlobalClick(event) {
  const target = event.target.closest('button, .ad-banner, .social-icon, .modal-close, .locker-cell, .step-cell, .meme-card');
  if (!target) return;

  const action = target.getAttribute('data-action');
  const toast = target.getAttribute('data-toast');
  const scrollTarget = target.getAttribute('data-scroll-target');

  if (toast) {
    showToast(toast);
    return;
  }

  if (scrollTarget) {
    activateCell(target);
    return;
  }

  if (action === 'scroll-hero') {
    scrollToSection('section-hero');
  } else if (action === 'scroll-team') {
    scrollToSection('section-komanda');
  } else if (action === 'login') {
    openModal('login');
  } else if (action === 'register') {
    openModal('register');
  } else if (action === 'locker') {
    scrollToSection('section-komirka');
  } else if (action === 'anon') {
    openModal('anon');
  } else if (action === 'publish-card') {
    publishCard();
  } else if (action === 'close-modal') {
    closeModal();
  }
}
window.handleGlobalClick = handleGlobalClick;

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('button, .ad-banner, .social-icon, .modal-close').forEach(element => {
    if (element.hasAttribute('onclick')) {
      element.removeAttribute('onclick');
    }
  });

  handleInitialHash();
  window.addEventListener('hashchange', handleInitialHash);

  document.querySelectorAll('[data-scroll-target]').forEach(cell => {
    cell.addEventListener('click', () => activateCell(cell));
    cell.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activateCell(cell);
      }
    });
  });

  document.addEventListener('click', handleGlobalClick);
});

// ── QR CANVAS (simple pixel art) ──
(function drawQR() {
  const c = document.getElementById('qr-canvas');
  if (!c || c.tagName !== 'CANVAS') return;
  const ctx = c.getContext('2d');
  const s = 10;
  const pattern = [
    [1,1,1,1,1,1,1,0,1,0,1,1,1,1,1,1,1],
    [1,0,0,0,0,0,1,0,0,1,1,0,0,0,0,0,1],
    [1,0,1,1,1,0,1,0,1,0,1,0,1,1,1,0,1],
    [1,0,1,1,1,0,1,0,0,1,1,0,1,1,1,0,1],
    [1,0,1,1,1,0,1,0,1,1,0,0,1,1,1,0,1],
    [1,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,0,1,0,1,1,1,1,1,1,1],
    [0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0],
    [1,0,1,1,0,1,1,0,1,0,0,1,1,0,1,0,1],
    [0,0,0,0,0,0,0,0,1,1,0,0,1,1,0,0,0],
    [1,1,1,1,1,1,1,0,0,0,1,0,1,1,0,1,1],
    [1,0,0,0,0,0,1,0,1,0,0,1,0,0,1,0,1],
    [1,0,1,1,1,0,1,0,0,1,1,0,0,1,0,0,0],
    [1,0,1,1,1,0,1,0,1,0,1,1,0,0,1,0,1],
    [1,0,1,1,1,0,1,0,0,1,0,0,1,0,0,1,0],
    [1,0,0,0,0,0,1,0,1,0,0,1,0,1,0,0,1],
    [1,1,1,1,1,1,1,0,0,1,1,0,1,0,0,1,0],
  ];
  c.width = pattern[0].length * s;
  c.height = pattern.length * s;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#111';
  pattern.forEach((row, r) => {
    row.forEach((cell, col) => {
      if (cell) ctx.fillRect(col * s, r * s, s, s);
    });
  });
})();
