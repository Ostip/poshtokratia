/* ═══════════════ Залізна Зміна — клієнтська логіка ═══════════════ */
(() => {
  'use strict';

  /* ───────────── утиліти ───────────── */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const plural = (n, one, few, many) => {
    const m10 = n % 10; const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  };
  const hue = (str) => { let h = 0; for (const ch of String(str || '')) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  const safeSrc = (u) => (typeof u === 'string' && (u.startsWith('/uploads/') || /^(assets\/|[\w.-]+\.(png|jpe?g|webp|gif|svg)$)/i.test(u))) ? u : '';
  const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u)) ? u : '';
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // Безпечний «мікро-форматер» для тексту заходів: екранує все, дозволяє **жирний**, посилання, переноси рядків
  function rich(text) {
    let h = esc(text);
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/https?:\/\/(?:(?!&quot;|&#39;|&lt;|&gt;)\S)+/g, (m) => {
      const tail = (m.match(/[.,;:!?)\]]+$/) || [''])[0];
      const url = tail ? m.slice(0, -tail.length) : m;
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${tail}`;
    });
    return h.replace(/\n/g, '<br>');
  }

  const UA_TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ye', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'yi', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ь: '', ю: 'yu', я: 'ya', "'": '', ʼ: '' };
  const translit = (s) => String(s).toLowerCase().split('').map((c) => (UA_TRANSLIT[c] !== undefined ? UA_TRANSLIT[c] : c)).join('').replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);

  /* ───────────── дати й заходи ───────────── */
  const MONTHS_SHORT = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
  const MONTHS_LONG = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
  const DOW = ['НД', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
  const DOW_LONG = ['неділя', 'понеділок', 'вівторок', 'середа', 'четвер', "пʼятниця", 'субота'];
  const CATS = {
    meetup: { emoji: '🤝', label: 'Зустріч', color: 'var(--sky)' },
    workshop: { emoji: '🛠', label: 'Майстер-клас', color: 'var(--lavender)' },
    party: { emoji: '🎉', label: 'Івент', color: 'var(--pink)' },
    charity: { emoji: '💛', label: 'Волонтерство', color: 'var(--yellow)' },
    online: { emoji: '💻', label: 'Онлайн', color: 'var(--mint)' },
    other: { emoji: '✨', label: 'Інше', color: 'var(--peach)' },
  };
  const pad = (n) => String(n).padStart(2, '0');
  const isDateOnly = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  function evDate(e) {
    if (!e.date) return null;
    const d = isDateOnly(e.date) ? new Date(e.date + 'T00:00') : new Date(e.date);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function evEnd(e) { const d = evDate(e); return d ? new Date(d.getTime() + (isDateOnly(e.date) ? 24 * 36e5 : 3 * 36e5)) : null; }
  function evState(e) {
    const s = evDate(e); if (!s) return 'upcoming';
    const now = new Date();
    if (now > evEnd(e)) return 'past';
    return now >= s ? 'live' : 'upcoming';
  }
  function evTime(e) { const d = evDate(e); return d && !isDateOnly(e.date) ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : ''; }
  function fmtLong(e) {
    const d = evDate(e); if (!d) return 'Дата уточнюється';
    const t = evTime(e);
    return `${DOW_LONG[d.getDay()]}, ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}${t ? ' · ' + t : ''}`;
  }
  function until(e) {
    const s = evDate(e); if (!s) return 'Дата уточнюється';
    const st = evState(e);
    if (st === 'live') return 'Триває зараз';
    if (st === 'past') return 'Вже відбувся';
    const now = new Date();
    const mins = Math.round((s - now) / 60000);
    if (!isDateOnly(e.date) && mins < 60) return `Через ${Math.max(mins, 1)} хв`;
    const dd = Math.round((startOfDay(s) - startOfDay(now)) / 86400000);
    if (dd === 0) return isDateOnly(e.date) ? 'Сьогодні' : `Сьогодні — через ${Math.floor(mins / 60)} год`;
    if (dd === 1) return 'Завтра';
    return `Через ${dd} ${plural(dd, 'день', 'дні', 'днів')}`;
  }
  const cmpDate = (a, b) => { const x = evDate(a); const y = evDate(b); if (x && y) return x - y; if (x) return -1; if (y) return 1; return 0; };
  function groupedEvents() {
    const up = []; const past = [];
    for (const e of S.events) (evState(e) === 'past' ? past : up).push(e);
    up.sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || cmpDate(a, b));
    past.sort((a, b) => cmpDate(b, a));
    return { up, past };
  }
  function nextEvent() {
    const { up } = groupedEvents();
    return up.filter((e) => evDate(e)).sort(cmpDate)[0] || up[0] || null;
  }

  /* ───────────── стан ───────────── */
  const S = {
    me: null, cards: [], letters: [], memes: [], events: [],
    stats: { people: 0, stories: 0, letters: 0, memes: 0, events: 0 },
    shown: { cards: 8, letters: 6, memes: 6 },
    eventFilter: 'upcoming', photos: { story: null, meme: null },
    avatarDraft: { state: 'keep', data: null },
    extra: { cards: {}, memes: {} },
    modal: null, loaded: false, loadError: false, sig: '',
  };

  /* ───────────── API ───────────── */
  async function api(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch('/api' + path, {
        method, credentials: 'same-origin',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      const err = new Error("Немає зв'язку із сервером. Перевір інтернет і спробуй ще раз.");
      err.network = true; throw err;
    }
    let data = {};
    try { data = await res.json(); } catch (e) { /* порожня відповідь */ }
    if (!res.ok || data.success === false) {
      const err = new Error(data.error || 'Щось пішло не так. Спробуй ще раз.');
      err.status = res.status; throw err;
    }
    return data;
  }

  async function busy(btn, fn) {
    if (btn && btn.disabled) return undefined;
    if (btn) { btn.disabled = true; btn.classList.add('busy'); }
    try { return await fn(); } finally { if (btn) { btn.disabled = false; btn.classList.remove('busy'); } }
  }

  /* ───────────── повідомлення, конфеті ───────────── */
  function toast(msg, type = 'info') {
    const box = $('#toasts'); if (!box) return;
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.innerHTML = `<span>${type === 'error' ? '⚠️' : type === 'success' ? '✅' : '✦'}</span><span></span>`;
    t.lastChild.textContent = msg;
    box.appendChild(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 3600);
  }

  function confetti(n = 150) {
    if (reduceMotion) return;
    const c = $('#confetti'); if (!c) return;
    const ctx = c.getContext('2d');
    c.width = window.innerWidth; c.height = window.innerHeight;
    const colors = ['#ffd93d', '#6ec6f5', '#f5a0c0', '#7de8c8', '#d0021b', '#c9b8f5', '#ffc49b'];
    const parts = Array.from({ length: n }, () => ({
      x: c.width / 2 + (Math.random() - 0.5) * 240, y: c.height * 0.4,
      vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 15 - 4, g: 0.34 + Math.random() * 0.2,
      s: 6 + Math.random() * 7, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4,
      c: colors[(Math.random() * colors.length) | 0], life: 0,
    }));
    (function frame() {
      ctx.clearRect(0, 0, c.width, c.height);
      let alive = false;
      for (const p of parts) {
        p.vy += p.g; p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.r += p.vr; p.life += 1;
        if (p.y < c.height + 20 && p.life < 240) {
          alive = true;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
          ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); ctx.restore();
        }
      }
      if (alive) requestAnimationFrame(frame); else ctx.clearRect(0, 0, c.width, c.height);
    })();
  }

  /* ───────────── модальні вікна ───────────── */
  const overlay = $('#modal-overlay');
  const modalBox = $('#modal-box');
  const modalContent = $('#modal-content');
  let lastFocus = null;

  function openModal(html, { cls = '' } = {}) {
    if (!overlay.classList.contains('open')) lastFocus = document.activeElement;
    modalContent.innerHTML = html;
    modalBox.className = 'modal ' + cls;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
    modalBox.scrollTop = 0;
    const f = $('[autofocus], input:not([type=hidden]):not([type=file]), textarea', modalContent);
    if (f) setTimeout(() => f.focus({ preventScroll: true }), 60);
  }

  function closeModal() {
    if (!overlay.classList.contains('open')) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('no-scroll');
    const t = S.modal && S.modal.type;
    S.modal = null;
    setTimeout(() => { if (!overlay.classList.contains('open')) modalContent.innerHTML = ''; }, 250);
    if (t === 'event' || t === 'user') history.replaceState(null, '', location.pathname + location.search);
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }

  function confirmDialog(message, { yes = 'Так, видалити', danger = true } = {}) {
    return new Promise((resolve) => {
      const o = $('#confirm-overlay'); const y = $('#confirm-yes'); const n = $('#confirm-no');
      $('#confirm-text').textContent = message;
      y.textContent = yes; y.className = 'publish-btn' + (danger ? '' : ' ok');
      o.classList.add('open'); y.focus();
      const done = (v) => { o.classList.remove('open'); y.onclick = n.onclick = o.onclick = null; document.removeEventListener('keydown', onKey, true); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
      document.addEventListener('keydown', onKey, true);
      y.onclick = () => done(true); n.onclick = () => done(false);
      o.onclick = (e) => { if (e.target === o) done(false); };
    });
  }

  function openLightbox(src) {
    const s = safeSrc(src); if (!s) return;
    $('#lightbox-img').src = s;
    $('#lightbox').classList.add('open');
  }
  const closeLightbox = () => $('#lightbox').classList.remove('open');

  /* ───────────── шаблони: аватар, автор, лайк ───────────── */
  function avatar(u, size = 'sm') {
    const name = (u && u.name) || '?';
    const init = ([...name.trim()][0] || '?').toUpperCase();
    const h = hue((u && u.username) || name);
    const src = safeSrc(u && u.avatar);
    return src
      ? `<img class="avatar avatar-${size}" src="${esc(src)}" alt="" style="--h:${h}" data-fallback="initial" data-initial="${esc(init)}" loading="lazy">`
      : `<span class="avatar avatar-${size}" style="--h:${h}">${esc(init)}</span>`;
  }
  function authorChip(author, fallbackName) {
    if (author) {
      return `<button type="button" class="author-chip" data-action="user" data-username="${esc(author.username)}" aria-label="Профіль ${esc(author.name)}">${avatar(author, 'xs')}<span>${esc(author.name)}</span></button>`;
    }
    return `<span class="author-chip">${avatar({ name: fallbackName || 'Анонім' }, 'xs')}<span>${esc(fallbackName || 'Анонім')}</span></span>`;
  }
  const likeBtn = (kind, it) =>
    `<button type="button" class="like-btn ${it.liked ? 'liked' : ''}" data-action="like" data-kind="${kind}" data-id="${esc(it.id)}" aria-pressed="${!!it.liked}" aria-label="Подобається"><span class="heart">♥</span><span class="cnt">${it.likes}</span></button>`;
  const PH_EMOJI = ['📖', '💌', '🌟', '🕊️', '🔥', '🌈', '☕', '🎧'];
  const phEmoji = (s) => PH_EMOJI[hue(s) % PH_EMOJI.length];

  /* ───────────── рендер: шапка, статистика ───────────── */
  function renderAuth() {
    const area = $('#auth-area');
    document.body.classList.toggle('authed', !!S.me);
    if (area) {
      area.innerHTML = S.me
        ? `<button class="nav-user" data-action="profile" aria-label="Мій профіль">${avatar(S.me, 'sm')}<span>${esc(S.me.name.split(' ')[0])}</span></button>
           <button class="nav-btn nav-btn-auth" data-action="logout">Вийти</button>`
        : `<button class="nav-btn nav-btn-auth" data-action="login">Увійти <span class="indicator ind-green"></span></button>
           <button class="nav-btn nav-btn-auth" data-action="register">Реєстрація <span class="indicator ind-yellow"></span></button>`;
    }
    $$('[data-as]').forEach((el) => {
      el.innerHTML = S.me ? `${avatar(S.me, 'sm')}<span>Публікуєш як <b>${esc(S.me.name)}</b> <span class="handle">@${esc(S.me.username)}</span></span>` : '';
    });
  }

  function animateCount(el, to) {
    const from = Number(el.dataset.val || 0);
    el.dataset.val = to;
    if (reduceMotion || from === to) { el.textContent = to; return; }
    const t0 = performance.now(); const dur = 900;
    (function step(t) {
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }
  function renderStats() {
    $$('[data-stat]').forEach((el) => animateCount(el, Number(S.stats[el.dataset.stat] || 0)));
  }

  /* ───────────── рендер: заходи ───────────── */
  function ticketHTML(e, i, nextId) {
    const st = evState(e); const cat = CATS[e.category] || CATS.other; const d = evDate(e); const t = evTime(e);
    const stub = d
      ? `<span class="stub-dow">${DOW[d.getDay()]}</span><span class="stub-day">${d.getDate()}</span><span class="stub-mon">${MONTHS_SHORT[d.getMonth()]}</span>${t ? `<span class="stub-time">${t}</span>` : ''}`
      : '<span class="stub-soon">✨</span><span class="stub-mon">скоро</span>';
    const ribbons = [
      st === 'live' ? '<span class="ribbon live">Зараз</span>' : '',
      st === 'past' ? '<span class="ribbon past">Минув</span>' : '',
      st !== 'past' && e.id === nextId ? '<span class="ribbon">Найближчий</span>' : '',
      e.pinned && st !== 'past' ? '<span class="ribbon pin">📌 Закріплено</span>' : '',
    ].join('');
    const cover = safeSrc(e.cover) ? `<div class="ticket-cover"><img src="${esc(safeSrc(e.cover))}" alt="" loading="lazy" data-fallback="hide-parent"></div>` : '';
    const action = st === 'past' ? '' : `<button type="button" class="go-btn ${e.goingMe ? 'on' : ''}" data-action="going" data-id="${esc(e.id)}">${e.goingMe ? '✓ Ти йдеш' : 'Піду'}</button>`;
    return `<div class="ticket-wrap" style="--i:${i}">
      <div class="ticket ${st === 'past' ? 'past' : ''}" style="--c:${cat.color}" role="button" tabindex="0" data-action="event" data-id="${esc(e.id)}" aria-label="${esc(e.title)}">
        <div class="ticket-stub">${stub}</div>
        <div class="ticket-main">${cover}
          <div class="ticket-body">
            <div class="ticket-top"><span class="ticket-cat">${cat.emoji} ${cat.label}</span>${ribbons}</div>
            <h3 class="ticket-title">${esc(e.title)}</h3>
            <div class="ticket-meta">${e.place ? `<span>📍 ${esc(e.place)}</span>` : ''}<span>⏳ ${until(e)}</span></div>
            <div class="ticket-text">${rich(e.text)}</div>
            <div class="ticket-foot">${action}<span class="going-count" data-going-count="${esc(e.id)}">${e.going ? `👥 ${e.going}` : ''}</span><span class="read-more">Детальніше →</span></div>
          </div>
        </div>
      </div></div>`;
  }

  function renderEvents() {
    const grid = $('#events-grid'); if (!grid) return;
    const { up, past } = groupedEvents();
    const badge = $('#nav-events-badge');
    if (badge) { badge.textContent = up.length; badge.hidden = up.length === 0; }
    renderHeroNext();
    if (!S.loaded) { grid.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>'; return; }
    if (S.loadError && !S.events.length) {
      grid.innerHTML = '<div class="events-empty"><span class="big">📡</span><h3>Не вдалося завантажити заходи</h3><p>Перевір інтернет і спробуй ще раз.</p><button class="publish-btn" data-action="reload">Спробувати ще</button></div>';
      return;
    }
    const list = S.eventFilter === 'past' ? past : S.eventFilter === 'all' ? [...up, ...past] : up;
    if (!list.length) {
      const msg = S.eventFilter === 'past' ? ['🗂', 'Минулих заходів поки немає', 'Тут зберігатиметься історія наших зустрічей.']
        : ['🎟', 'Скоро тут зʼявляться заходи', 'Ми готуємо щось класне. Підпишись на Instagram, щоб не пропустити анонс.'];
      grid.innerHTML = `<div class="events-empty"><span class="big">${msg[0]}</span><h3>${msg[1]}</h3><p>${msg[2]}</p>
        <a class="publish-btn ok" style="display:inline-block;text-decoration:none" href="https://www.instagram.com/poshtokratia?igsh=MXJ1d3U2aXRjdGlkNg==" target="_blank" rel="noopener noreferrer">Підписатись у Instagram</a></div>`;
      return;
    }
    const next = nextEvent();
    grid.innerHTML = list.map((e, i) => ticketHTML(e, i, next && next.id)).join('');
  }

  function renderHeroNext() {
    const el = $('#hero-next'); if (!el) return;
    const e = S.loaded ? nextEvent() : null;
    if (!e || evState(e) === 'past') { el.hidden = true; return; }
    const cat = CATS[e.category] || CATS.other;
    el.hidden = false;
    el.innerHTML = `<span style="font-size:22px">${cat.emoji}</span><span><b>${evState(e) === 'live' ? 'Зараз:' : 'Найближчий:'}</b> ${esc(e.title)}<br><small style="color:var(--muted);font-weight:700">${esc(fmtLong(e))} · ${until(e)}</small></span>`;
  }

  /* ───────────── рендер: історії, листи, меми ───────────── */
  const skeletons = (n) => Array.from({ length: n }, () => '<div class="skeleton"></div>').join('');
  const retryBlock = '<div class="empty-state"><span class="big">📡</span>Не вдалося завантажити. <button class="ghost-btn" style="margin-top:8px" data-action="reload">Спробувати ще</button></div>';
  const moreBtn = (id, total, shown) => { const b = $(id); if (!b) return; b.hidden = total <= shown; b.textContent = `Показати ще (${Math.max(total - shown, 0)})`; };

  function renderCards() {
    const grid = $('#cards-grid'); if (!grid) return;
    if (!S.loaded) { grid.innerHTML = skeletons(4); return; }
    if (S.loadError && !S.cards.length) { grid.innerHTML = retryBlock; return; }
    if (!S.cards.length) {
      grid.innerHTML = '<div class="empty-state"><span class="big">📖</span>Тут ще порожньо — стань першим, хто поділиться історією.</div>';
      moreBtn('#cards-more', 0, 0); return;
    }
    const list = S.cards.slice(0, S.shown.cards);
    grid.innerHTML = list.map((c, i) => {
      const img = safeSrc(c.photo)
        ? `<img class="polaroid-img" src="${esc(safeSrc(c.photo))}" alt="" loading="lazy" data-fallback="ph" data-ph-class="polaroid-ph">`
        : `<div class="polaroid-ph" style="--h:${hue(c.id)}">${phEmoji(c.id)}</div>`;
      return `<article class="polaroid" style="--i:${i}" role="button" tabindex="0" data-action="story" data-id="${esc(c.id)}">
        ${img}
        <div class="polaroid-meta">${authorChip(c.author, c.name)}<span>${esc(c.date)}</span></div>
        <div class="polaroid-text">${esc(c.story)}</div>
        <div class="polaroid-foot">${likeBtn('cards', c)}<span class="read-more">читати →</span></div>
      </article>`;
    }).join('');
    moreBtn('#cards-more', S.cards.length, S.shown.cards);
  }

  function renderLetters() {
    const list = $('#letters-list'); if (!list) return;
    if (!S.loaded) { list.innerHTML = skeletons(2); return; }
    if (S.loadError && !S.letters.length) { list.innerHTML = retryBlock; return; }
    if (!S.letters.length) {
      list.innerHTML = '<div class="empty-state"><span class="big">💌</span>Листів ще немає. Напиши перший — навіть анонімно.</div>';
      moreBtn('#letters-more', 0, 0); return;
    }
    list.innerHTML = S.letters.slice(0, S.shown.letters).map((l, i) => `
      <article class="feed-item" style="--i:${i}">
        <div class="feed-top">${authorChip(l.authorInfo, l.author)}<small>→ ${esc(l.recipient || 'Невідомий адресат')} · ${esc(l.date)}</small></div>
        <p>${esc(l.message)}</p>
      </article>`).join('');
    moreBtn('#letters-more', S.letters.length, S.shown.letters);
  }

  function renderMemes() {
    const list = $('#memes-list'); if (!list) return;
    if (!S.loaded) { list.innerHTML = skeletons(4); return; }
    if (S.loadError && !S.memes.length) { list.innerHTML = retryBlock; return; }
    if (!S.memes.length) {
      list.innerHTML = '<div class="empty-state"><span class="big">😂</span>Мемів поки немає. Додай перший — розсмішимо всіх!</div>';
      moreBtn('#memes-more', 0, 0); return;
    }
    list.innerHTML = S.memes.slice(0, S.shown.memes).map((m, i) => {
      const img = safeSrc(m.photo)
        ? `<img src="${esc(safeSrc(m.photo))}" alt="${esc(m.title)}" loading="lazy" data-fallback="ph" data-ph-class="meme-ph">`
        : `<div class="meme-ph" style="--h:${hue(m.id)}">😂</div>`;
      return `<article class="meme-card" style="--i:${i}" role="button" tabindex="0" data-action="meme" data-id="${esc(m.id)}">
        ${img}
        <div class="meme-info"><strong>${esc(m.title)}</strong><p>${esc(m.text)}</p>
          <div class="meme-foot">${authorChip(m.author, m.author_name)}${likeBtn('memes', m)}</div></div>
      </article>`;
    }).join('');
    moreBtn('#memes-more', S.memes.length, S.shown.memes);
  }

  function renderAll() {
    renderAuth(); renderStats(); renderEvents(); renderCards(); renderLetters(); renderMemes();
  }

  /* ───────────── завантаження даних ───────────── */
  async function loadMe() {
    try { S.me = (await api('/me')).user; } catch (e) { S.me = null; }
  }
  async function loadData() {
    const [st, ev] = await Promise.all([api('/state'), api('/events')]);
    S.cards = st.cards; S.letters = st.letters; S.memes = st.memes; S.stats = st.stats; S.events = ev.events;
  }
  async function refreshData({ silent = false } = {}) {
    try {
      await loadData();
      S.loadError = false;
      const sig = JSON.stringify([S.cards, S.letters, S.memes, S.events, S.stats, S.me && S.me.username]);
      if (silent && sig === S.sig) return;
      S.sig = sig;
      renderAll();
    } catch (e) {
      if (!silent) { S.loadError = true; renderAll(); toast(e.message, 'error'); }
    }
  }

  async function bootstrap() {
    S.loaded = false; S.loadError = false; renderAll();
    const slow = setTimeout(() => $('#net-banner').classList.add('show'), 4500);
    try {
      await loadMe();
      await loadData();
    } catch (e) {
      S.loadError = true;
    }
    clearTimeout(slow);
    $('#net-banner').classList.remove('show');
    S.loaded = true;
    S.sig = JSON.stringify([S.cards, S.letters, S.memes, S.events, S.stats, S.me && S.me.username]);
    renderAll();
    if (S.loadError) toast('Не вдалося завантажити дані сайту', 'error');
    setTimeout(() => document.body.classList.add('ready'), 1400);
    openFromHash();
  }

  /* ───────────── навігація ───────────── */
  function scrollToId(id) {
    const el = document.getElementById(id); if (!el) return;
    el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    history.replaceState(null, '', '#' + id);
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1300);
    $('#top-nav').classList.remove('nav-open');
    $('#nav-burger').setAttribute('aria-expanded', 'false');
  }

  function openFromHash() {
    const h = decodeURIComponent(location.hash.slice(1));
    if (!h) return;
    if (h.startsWith('event/')) openEvent(h.slice(6), false);
    else if (h.startsWith('u/')) openUser(h.slice(2));
    else if (document.getElementById(h)) setTimeout(() => scrollToId(h), 200);
  }

  /* ───────────── авторизація ───────────── */
  const pwField = (name, label, autocomplete) => `
    <div><label class="form-label" for="f-${name}">${label}</label>
      <div class="pw-wrap"><input class="form-input" id="f-${name}" name="${name}" type="password" autocomplete="${autocomplete}" required>
        <button type="button" class="pw-toggle" data-action="togglepw" aria-label="Показати пароль">👁</button></div></div>`;

  function authModal(tab = 'login') {
    S.modal = { type: 'auth' };
    const login = `<form data-form="login" novalidate>
        <div class="stack-form">
          <div><label class="form-label" for="f-ident">Email або нікнейм</label><input class="form-input" id="f-ident" name="identifier" type="text" autocomplete="username" autocapitalize="none" required autofocus></div>
          ${pwField('password', 'Пароль', 'current-password')}
          <div class="form-error" role="alert"></div>
          <button class="publish-btn" type="submit">Увійти →</button>
          <div class="field-hint" style="text-align:center">Ще немає акаунта? <a href="#" data-action="auth-tab:register" style="color:var(--red);font-weight:800">Зареєструватися</a></div>
        </div></form>`;
    const register = `<form data-form="register" novalidate>
        <div class="stack-form">
          <div><label class="form-label" for="f-name">Імʼя</label><input class="form-input" id="f-name" name="name" type="text" maxlength="40" autocomplete="name" required autofocus></div>
          <div><label class="form-label" for="f-username">Нікнейм</label><input class="form-input" id="f-username" name="username" type="text" maxlength="20" autocomplete="username" autocapitalize="none" required>
            <div class="field-hint">Латиниця, цифри та _ . Це твоя особиста сторінка: <b>@<span data-username-preview>nickname</span></b></div></div>
          <div><label class="form-label" for="f-email">Email</label><input class="form-input" id="f-email" name="email" type="email" maxlength="120" autocomplete="email" required></div>
          ${pwField('password', 'Пароль', 'new-password')}
          <div class="pw-meter"><i data-pw-bar></i></div><div class="pw-hint" data-pw-text>Мінімум 8 символів</div>
          <div class="form-error" role="alert"></div>
          <button class="publish-btn" type="submit">Створити акаунт →</button>
          <div class="field-hint" style="text-align:center">Вже є акаунт? <a href="#" data-action="auth-tab:login" style="color:var(--red);font-weight:800">Увійти</a></div>
        </div></form>`;
    openModal(`<div class="auth-tabs" role="tablist">
        <button class="auth-tab ${tab === 'login' ? 'active' : ''}" role="tab" data-action="auth-tab:login">Вхід</button>
        <button class="auth-tab ${tab === 'register' ? 'active' : ''}" role="tab" data-action="auth-tab:register">Реєстрація</button></div>
      ${tab === 'login' ? login : register}`, { cls: 'modal-auth' });
  }

  function pwScore(p) {
    let s = 0;
    if (p.length >= 8) s += 1; if (p.length >= 12) s += 1;
    if (/[a-zа-яіїєґ]/.test(p) && /[A-ZА-ЯІЇЄҐ]/.test(p)) s += 1;
    if (/\d/.test(p)) s += 1; if (/[^\w\s]/.test(p)) s += 1;
    return Math.min(s, 4);
  }

  function showFormError(form, msg) {
    const el = $('.form-error', form); if (el) el.textContent = msg || '';
  }
  function invalid(form, name, msg) {
    const f = form.elements[name];
    if (f) { f.classList.add('invalid'); f.focus(); setTimeout(() => f.classList.remove('invalid'), 600); }
    showFormError(form, msg);
    return false;
  }

  async function afterAuth(user) {
    S.me = user;
    await refreshData();
    renderAuth();
  }

  const forms = {
    async login(form, btn) {
      const identifier = form.elements.identifier.value.trim(); const password = form.elements.password.value;
      if (!identifier) return invalid(form, 'identifier', 'Введи email або нікнейм');
      if (!password) return invalid(form, 'password', 'Введи пароль');
      return busy(btn, async () => {
        try {
          const d = await api('/auth/login', { method: 'POST', body: { identifier, password } });
          await afterAuth(d.user); closeModal();
          toast(`З поверненням, ${d.user.name.split(' ')[0]}! 👋`, 'success');
        } catch (e) { showFormError(form, e.message); }
      });
    },
    async register(form, btn) {
      const v = (n) => form.elements[n].value.trim();
      if (v('name').length < 2) return invalid(form, 'name', "Введи своє ім'я (мінімум 2 символи)");
      if (!/^[a-z0-9_]{3,20}$/.test(v('username'))) return invalid(form, 'username', 'Нікнейм: 3–20 символів, латиниця, цифри або _');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v('email'))) return invalid(form, 'email', 'Введи коректний email');
      if (form.elements.password.value.length < 8) return invalid(form, 'password', 'Пароль: мінімум 8 символів');
      return busy(btn, async () => {
        try {
          const d = await api('/auth/register', { method: 'POST', body: { name: v('name'), username: v('username'), email: v('email'), password: form.elements.password.value } });
          await afterAuth(d.user);
          S.modal = { type: 'welcome' };
          modalContent.innerHTML = `<div class="welcome"><div class="welcome-emoji">🎉</div>
            <h3>Вітаємо, ${esc(d.user.name.split(' ')[0])}!</h3>
            <p>Акаунт створено. Твоя особиста сторінка — <b>@${esc(d.user.username)}</b>.<br>Додай фото й кілька слів про себе, щоб люди тебе впізнали.</p>
            <div class="welcome-actions"><button class="publish-btn" data-action="profile">Налаштувати профіль</button>
            <button class="ghost-btn" data-action="locker">Написати першу історію</button></div></div>`;
          confetti(180);
        } catch (e) { showFormError(form, e.message); }
      });
    },
    async profile(form, btn) {
      const name = form.elements.name.value.trim();
      if (name.length < 2) return invalid(form, 'name', "Імʼя: мінімум 2 символи");
      const body = { name, bio: form.elements.bio.value.trim() };
      if (S.avatarDraft.state === 'new') body.avatar = S.avatarDraft.data;
      if (S.avatarDraft.state === 'remove') body.avatar = null;
      return busy(btn, async () => {
        try {
          const d = await api('/me', { method: 'PATCH', body });
          S.me = d.user; S.avatarDraft = { state: 'keep', data: null };
          await refreshData(); toast('Профіль збережено', 'success'); openProfile();
        } catch (e) { showFormError(form, e.message); }
      });
    },
    async password(form, btn) {
      const current = form.elements.current.value; const next = form.elements.next.value;
      if (!current) return invalid(form, 'current', 'Введи поточний пароль');
      if (next.length < 8) return invalid(form, 'next', 'Новий пароль: мінімум 8 символів');
      return busy(btn, async () => {
        try { await api('/me/password', { method: 'POST', body: { current, next } }); form.reset(); showFormError(form, ''); toast('Пароль змінено. Інші пристрої вийшли з акаунта.', 'success'); }
        catch (e) { showFormError(form, e.message); }
      });
    },
    async 'delete-account'(form, btn) {
      const password = form.elements.password.value;
      if (!password) return invalid(form, 'password', 'Введи пароль для підтвердження');
      if (!(await confirmDialog('Видалити акаунт назавжди разом з усіма твоїми історіями й мемами?', { yes: 'Так, видалити акаунт' }))) return false;
      return busy(btn, async () => {
        try {
          await api('/me', { method: 'DELETE', body: { password } });
          S.me = null; closeModal(); await refreshData(); renderAuth(); toast('Акаунт видалено. Нам буде вас бракувати 💔');
        } catch (e) { showFormError(form, e.message); }
      });
    },
    async 'story-form'(form, btn) {
      const story = form.elements.story.value.trim();
      if (!S.me) { authModal('register'); return false; }
      if (story.length < 3) return invalid(form, 'story', 'Напиши хоча б кілька слів');
      return busy(btn, async () => {
        try {
          await api('/cards', { method: 'POST', body: { story, photo: S.photos.story } });
          form.reset(); S.photos.story = null; showPreview('story'); updateCounters(form); showFormError(form, '');
          await refreshData(); toast('Історію опубліковано! ✦', 'success'); confetti(70);
          $('#cards-grid').scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (e) { showFormError(form, e.message); if (e.status === 401) { S.me = null; renderAuth(); } }
      });
    },
    async 'meme-form'(form, btn) {
      if (!S.me) { authModal('register'); return false; }
      const title = form.elements.title.value.trim(); const text = form.elements.text.value.trim();
      if (title.length < 2) return invalid(form, 'title', 'Додай назву мема');
      if (!text) return invalid(form, 'text', 'Напиши текст мема');
      return busy(btn, async () => {
        try {
          await api('/memes', { method: 'POST', body: { title, text, photo: S.photos.meme } });
          form.reset(); S.photos.meme = null; showPreview('meme'); showFormError(form, '');
          await refreshData(); toast('Мем додано! 😂', 'success');
        } catch (e) { showFormError(form, e.message); }
      });
    },
    async 'letter-form'(form, btn) {
      const message = form.elements.message.value.trim();
      if (message.length < 3) return invalid(form, 'message', 'Напиши текст листа');
      const body = { message, recipient: form.elements.recipient.value.trim(), author: form.elements.author ? form.elements.author.value.trim() : '', anonymous: !!(form.elements.anonymous && form.elements.anonymous.checked) };
      return busy(btn, async () => {
        try {
          await api('/letters', { method: 'POST', body });
          form.reset(); updateCounters(form); showFormError(form, '');
          await refreshData(); toast('Лист надіслано! ✉', 'success');
        } catch (e) { showFormError(form, e.message); }
      });
    },
    async anon(form, btn) {
      const message = form.elements.message.value.trim();
      if (message.length < 3) return invalid(form, 'message', 'Напиши текст листа');
      return busy(btn, async () => {
        try {
          await api('/letters', { method: 'POST', body: { message, recipient: form.elements.recipient.value.trim(), anonymous: true } });
          closeModal(); await refreshData(); toast('Анонімний лист надіслано ✉', 'success');
        } catch (e) { showFormError(form, e.message); }
      });
    },
  };

  /* ───────────── фото ───────────── */
  function compressImage(file, maxDim = 1400, quality = 0.82) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) { reject(new Error('Це не зображення')); return; }
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        const k = Math.min(1, maxDim / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не вдалося прочитати це фото. Спробуй JPG або PNG.')); };
      img.src = url;
    });
  }
  function showPreview(kind) {
    const box = $('#preview-' + kind); if (!box) return;
    const url = S.photos[kind];
    box.classList.toggle('has', !!url);
    box.innerHTML = url ? `<img src="${url}" alt="Попередній перегляд"><button type="button" data-action="photo-remove:${kind}" aria-label="Прибрати фото">✕</button>` : '';
  }

  const updateCounters = (root = document) => $$('[data-counter-for]', root).forEach((c) => {
    const t = document.getElementById(c.dataset.counterFor); if (t) c.textContent = `${t.value.length} / ${t.maxLength}`;
  });

  /* ───────────── профілі ───────────── */
  function miniItems(kind, items, mine) {
    if (!items.length) return `<div class="empty-state" style="padding:14px">${kind === 'cards' ? 'Історій ще немає' : 'Мемів ще немає'}</div>`;
    return `<div class="mini-list">${items.map((it) => {
      S.extra[kind][it.id] = it;
      const thumb = safeSrc(it.photo) ? `<img src="${esc(safeSrc(it.photo))}" alt="" loading="lazy" data-fallback="ph" data-ph-class="mini-ph">` : `<div class="mini-ph" style="background:hsl(${hue(it.id)} 80% 86%)">${kind === 'cards' ? phEmoji(it.id) : '😂'}</div>`;
      return `<div class="mini-item" role="button" tabindex="0" data-action="${kind === 'cards' ? 'story' : 'meme'}" data-id="${esc(it.id)}">${thumb}
        <p>${esc(kind === 'cards' ? it.story : it.title)}</p>${likeBtn(kind, it)}
        ${mine ? `<button type="button" class="mini-del" data-action="delete" data-kind="${kind}" data-id="${esc(it.id)}" aria-label="Видалити">🗑</button>` : ''}</div>`;
    }).join('')}</div>`;
  }

  async function openProfile() {
    if (!S.me) { authModal('login'); return; }
    S.avatarDraft = { state: 'keep', data: null };
    S.modal = { type: 'profile' };
    openModal('<div class="spinner"></div>', { cls: 'modal-wide' });
    try {
      const d = await api('/users/' + encodeURIComponent(S.me.username));
      if (!S.modal || S.modal.type !== 'profile') return;
      const me = S.me;
      openModal(`
        <div class="modal-title">Мій профіль</div>
        <form data-form="profile" novalidate>
          <div class="profile-head">
            <label class="avatar-edit" title="Змінити фото"><span id="avatar-preview">${avatar(me, 'xl')}</span><span class="cam">📷</span>
              <input type="file" accept="image/*" data-photo="avatar"></label>
            <div><h3>${esc(me.name)}</h3><div class="handle">@${esc(me.username)} · ${esc(me.email)}</div>
              ${me.avatar ? '<button type="button" class="ghost-btn" style="padding:4px 12px;font-size:12px;margin-top:8px" data-action="avatar-remove">Прибрати фото</button>' : ''}</div>
          </div>
          <div class="profile-stats">
            <div class="stat"><b>${d.stats.stories}</b><span>історій</span></div><div class="stat"><b>${d.stats.memes}</b><span>мемів</span></div><div class="stat"><b>${d.stats.likes}</b><span>лайків</span></div>
          </div>
          <div class="stack-form">
            <div><label class="form-label" for="p-name">Імʼя</label><input class="form-input" id="p-name" name="name" maxlength="40" value="${esc(me.name)}"></div>
            <div><label class="form-label" for="p-bio">Про себе</label><textarea class="form-textarea" id="p-bio" name="bio" maxlength="200" style="min-height:80px" placeholder="Кілька слів про тебе…">${esc(me.bio)}</textarea>
              <div class="counter" data-counter-for="p-bio">${(me.bio || '').length} / 200</div></div>
            <div class="form-error" role="alert"></div>
            <button class="publish-btn" type="submit">Зберегти профіль</button>
          </div>
        </form>
        <div class="sub-title">Мої історії</div>${miniItems('cards', d.cards, true)}
        <div class="sub-title">Мої меми</div>${miniItems('memes', d.memes, true)}
        <details class="fold"><summary>🔐 Змінити пароль</summary>
          <form data-form="password" novalidate><div class="stack-form">
            ${pwField('current', 'Поточний пароль', 'current-password')}${pwField('next', 'Новий пароль', 'new-password')}
            <div class="form-error" role="alert"></div><button class="publish-btn ok" type="submit">Змінити пароль</button></div></form></details>
        <details class="fold"><summary>⚠️ Видалити акаунт</summary>
          <form data-form="delete-account" novalidate><div class="stack-form">
            <p class="field-hint">Усі твої історії та меми буде видалено назавжди.</p>
            ${pwField('password', 'Пароль для підтвердження', 'current-password')}
            <div class="form-error" role="alert"></div><button class="ghost-btn danger" type="submit">Видалити акаунт</button></div></form></details>
        <div style="margin-top:14px"><button class="ghost-btn" data-action="logout">Вийти з акаунта</button></div>`, { cls: 'modal-wide' });
      S.modal = { type: 'profile' };
    } catch (e) { closeModal(); toast(e.message, 'error'); }
  }

  async function openUser(username) {
    if (S.me && S.me.username === String(username).toLowerCase()) { openProfile(); return; }
    S.modal = { type: 'user', username };
    openModal('<div class="spinner"></div>', { cls: 'modal-wide' });
    try {
      const d = await api('/users/' + encodeURIComponent(username));
      if (!S.modal || S.modal.type !== 'user') return;
      const u = d.user;
      const joined = new Date(u.joined);
      openModal(`
        <div class="profile-head">${avatar(u, 'xl')}
          <div><h3>${esc(u.name)}</h3><div class="handle">@${esc(u.username)}${Number.isNaN(joined.getTime()) ? '' : ` · з нами з ${MONTHS_LONG[joined.getMonth()]} ${joined.getFullYear()}`}</div>
            <div style="margin-top:8px"><span class="soon-chip">🔔 Підписки — скоро</span></div></div></div>
        ${u.bio ? `<div class="profile-bio">${esc(u.bio)}</div>` : ''}
        <div class="profile-stats">
          <div class="stat"><b>${d.stats.stories}</b><span>історій</span></div><div class="stat"><b>${d.stats.memes}</b><span>мемів</span></div><div class="stat"><b>${d.stats.likes}</b><span>лайків</span></div></div>
        <div class="sub-title">Історії</div>${miniItems('cards', d.cards, false)}
        <div class="sub-title">Меми</div>${miniItems('memes', d.memes, false)}`, { cls: 'modal-wide' });
      S.modal = { type: 'user', username };
      history.replaceState(null, '', '#u/' + u.username);
    } catch (e) { closeModal(); toast(e.status === 404 ? 'Такого користувача не знайдено' : e.message, 'error'); }
  }

  const findItem = (kind, id) => S[kind].find((x) => x.id === id) || S.extra[kind][id];

  function openStory(id) {
    const c = findItem('cards', id); if (!c) return;
    S.modal = { type: 'story', id };
    openModal(`
      <div class="modal-title">Історія</div>
      <div class="modal-meta" style="margin:0 0 6px">${authorChip(c.author, c.name)}<small style="color:#8c837b">${esc(c.date)}</small></div>
      ${safeSrc(c.photo) ? `<img class="modal-photo" src="${esc(safeSrc(c.photo))}" alt="" data-action="zoom" data-src="${esc(safeSrc(c.photo))}" data-fallback="remove">` : ''}
      <div class="story-full">${esc(c.story)}</div>
      <div class="modal-meta">${likeBtn('cards', c)}${c.mine ? `<button class="ghost-btn danger" data-action="delete" data-kind="cards" data-id="${esc(c.id)}">Видалити</button>` : ''}</div>`);
  }

  function openMeme(id) {
    const m = findItem('memes', id); if (!m) return;
    S.modal = { type: 'meme', id };
    openModal(`
      <div class="modal-title">${esc(m.title)}</div>
      ${safeSrc(m.photo) ? `<img class="modal-photo" src="${esc(safeSrc(m.photo))}" alt="${esc(m.title)}" data-action="zoom" data-src="${esc(safeSrc(m.photo))}" data-fallback="remove">` : ''}
      <div class="story-full">${esc(m.text)}</div>
      <div class="modal-meta">${authorChip(m.author, m.author_name)}<small style="color:#8c837b">${esc(m.date)}</small>${likeBtn('memes', m)}
        ${m.mine ? `<button class="ghost-btn danger" data-action="delete" data-kind="memes" data-id="${esc(m.id)}">Видалити</button>` : ''}</div>`);
  }

  async function like(btn) {
    if (!S.me) { toast('Увійди, щоб ставити лайки ♥'); authModal('login'); return; }
    const { kind, id } = btn.dataset;
    try {
      const d = await api(`/${kind}/${id}/like`, { method: 'POST' });
      const apply = (it) => { if (it) { it.liked = d.liked; it.likes = d.likes; } };
      apply(S[kind].find((x) => x.id === id)); apply(S.extra[kind][id]);
      $$(`.like-btn[data-kind="${kind}"][data-id="${id}"]`).forEach((b) => {
        b.classList.toggle('liked', d.liked); b.setAttribute('aria-pressed', d.liked); $('.cnt', b).textContent = d.likes;
      });
    } catch (e) { toast(e.message, 'error'); }
  }

  async function deleteItem(kind, id) {
    if (!(await confirmDialog(kind === 'cards' ? 'Видалити цю історію?' : 'Видалити цей мем?'))) return;
    try {
      await api(`/${kind}/${id}`, { method: 'DELETE' });
      delete S.extra[kind][id];
      const t = S.modal && S.modal.type; const u = S.modal && S.modal.username;
      await refreshData(); toast('Видалено', 'success');
      if (t === 'profile') openProfile(); else if (t === 'user') openUser(u); else closeModal();
    } catch (e) { toast(e.message, 'error'); }
  }

  /* ───────────── заходи: модалка, RSVP, календар ───────────── */
  function openEvent(id, push = true) {
    const e = S.events.find((x) => x.id === id);
    if (!e) { toast('Цей захід більше недоступний', 'error'); return; }
    const st = evState(e); const cat = CATS[e.category] || CATS.other;
    S.modal = { type: 'event', id };
    const link = safeUrl(e.link);
    openModal(`
      ${safeSrc(e.cover) ? `<div class="ev-cover"><img src="${esc(safeSrc(e.cover))}" alt="" data-fallback="hide-parent"></div>` : ''}
      <div class="ticket-top" style="margin-bottom:10px"><span class="ticket-cat" style="--c:${cat.color}">${cat.emoji} ${cat.label}</span>
        ${st === 'live' ? '<span class="ribbon live">Зараз</span>' : ''}${st === 'past' ? '<span class="ribbon past">Минув</span>' : ''}${e.pinned && st !== 'past' ? '<span class="ribbon pin">📌 Закріплено</span>' : ''}</div>
      <div class="modal-title">${esc(e.title)}</div>
      <div class="ev-info">
        <div>🗓 ${esc(fmtLong(e))} <span style="color:var(--red)">· ${until(e)}</span></div>
        ${e.place ? `<div>📍 ${esc(e.place)}</div>` : ''}
        <div>👥 <span data-going-count="${esc(e.id)}">${e.going ? `${e.going} ${plural(e.going, 'учасник йде', 'учасники йдуть', 'учасників йдуть')}` : 'Будь першим, хто піде'}</span></div>
      </div>
      <div class="ev-text">${rich(e.text)}</div>
      <div class="ev-actions">
        ${st !== 'past' ? `<button class="go-btn ${e.goingMe ? 'on' : ''}" style="padding:13px 24px;font-size:13px" data-action="going" data-id="${esc(e.id)}">${e.goingMe ? '✓ Ти йдеш' : 'Піду'}</button>` : ''}
        ${link ? `<a class="publish-btn ok" style="text-decoration:none;display:inline-block" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Деталі / реєстрація ↗</a>` : ''}
        ${evDate(e) && st !== 'past' ? `<button class="ghost-btn" data-action="ics" data-id="${esc(e.id)}">📅 У календар</button>` : ''}
        <button class="ghost-btn" data-action="share" data-id="${esc(e.id)}">🔗 Поділитись</button>
      </div>`, { cls: 'modal-wide' });
    if (push) history.replaceState(null, '', '#event/' + e.id);
  }

  function syncGoing(e) {
    $$(`.go-btn[data-id="${e.id}"]`).forEach((b) => { b.classList.toggle('on', e.goingMe); b.textContent = e.goingMe ? '✓ Ти йдеш' : 'Піду'; });
    $$(`[data-going-count="${e.id}"]`).forEach((el) => {
      const inModal = !!el.closest('#modal-content');
      el.textContent = inModal ? (e.going ? `${e.going} ${plural(e.going, 'учасник йде', 'учасники йдуть', 'учасників йдуть')}` : 'Будь першим, хто піде') : (e.going ? `👥 ${e.going}` : '');
    });
  }

  async function going(btn) {
    if (!S.me) { toast('Увійди, щоб відмітити, що ти йдеш 🎟'); authModal('login'); return; }
    await busy(btn, async () => {
      try {
        const d = await api(`/events/${btn.dataset.id}/going`, { method: 'POST' });
        const i = S.events.findIndex((x) => x.id === d.event.id);
        if (i >= 0) S.events[i] = d.event;
        syncGoing(d.event);
        if (d.event.goingMe) { toast('Чудово, до зустрічі! 🎉', 'success'); confetti(60); }
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  function downloadICS(id) {
    const e = S.events.find((x) => x.id === id); const d = e && evDate(e); if (!d) return;
    const f = (x) => `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}`;
    const ft = (x) => `${f(x)}T${pad(x.getHours())}${pad(x.getMinutes())}00`;
    const ic = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const dateOnly = isDateOnly(e.date);
    const end = dateOnly ? new Date(d.getTime() + 864e5) : new Date(d.getTime() + 2 * 36e5);
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Zalizna Zmina//UA', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
      `UID:${e.id}@zalizna-zmina`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`,
      dateOnly ? `DTSTART;VALUE=DATE:${f(d)}` : `DTSTART:${ft(d)}`, dateOnly ? `DTEND;VALUE=DATE:${f(end)}` : `DTEND:${ft(end)}`,
      `SUMMARY:${ic(e.title)}`, `LOCATION:${ic(e.place)}`, `DESCRIPTION:${ic(e.text.slice(0, 600))}\\n${location.origin}/#event/${e.id}`, 'END:VEVENT', 'END:VCALENDAR'];
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'zalizna-zmina-event.ics';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Подію збережено — відкрий файл, щоб додати в календар', 'success');
  }

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) {
      const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (er) { ok = false; } ta.remove(); return ok;
    }
  }
  async function shareEvent(id) {
    const e = S.events.find((x) => x.id === id); if (!e) return;
    const url = `${location.origin}/#event/${e.id}`;
    if (navigator.share) { try { await navigator.share({ title: e.title, text: `${e.title} — Залізна Зміна`, url }); return; } catch (er) { if (er && er.name === 'AbortError') return; } }
    toast((await copyText(url)) ? 'Посилання скопійовано 🔗' : url, 'success');
  }

  /* ───────────── делегування подій ───────────── */
  const actions = {
    go: (id) => scrollToId(id),
    locker() {
      if (!S.me) { toast('Спочатку створи акаунт — це 20 секунд ✨'); authModal('register'); return; }
      closeModal(); scrollToId('section-komirka'); setTimeout(() => $('#inp-story').focus({ preventScroll: true }), 500);
    },
    login: () => authModal('login'),
    register: () => authModal('register'),
    'auth-tab': (tab) => authModal(tab),
    async logout() {
      try { await api('/auth/logout', { method: 'POST' }); } catch (e) { /* все одно виходимо локально */ }
      S.me = null; closeModal(); await refreshData(); renderAuth(); toast('Ти вийшов з акаунта. До зустрічі! 👋');
    },
    profile: () => openProfile(),
    user: (_, el) => openUser(el.dataset.username),
    story: (_, el) => openStory(el.dataset.id),
    meme: (_, el) => openMeme(el.dataset.id),
    event: (_, el) => openEvent(el.dataset.id),
    'event-next'() { const e = nextEvent(); if (e) openEvent(e.id); },
    going: (_, el) => going(el),
    ics: (_, el) => downloadICS(el.dataset.id),
    share: (_, el) => shareEvent(el.dataset.id),
    like: (_, el) => like(el),
    delete: (_, el) => deleteItem(el.dataset.kind, el.dataset.id),
    more(kind) { S.shown[kind] += kind === 'cards' ? 8 : 6; ({ cards: renderCards, letters: renderLetters, memes: renderMemes })[kind](); },
    filter(f) { S.eventFilter = f; $$('#event-filters .chip').forEach((c) => c.classList.toggle('active', c.dataset.action === 'filter:' + f)); renderEvents(); },
    anon() {
      S.modal = { type: 'anon' };
      openModal(`<div class="modal-title">✉ Анонімний лист</div><form data-form="anon" novalidate><div class="stack-form">
        <div><label class="form-label" for="a-to">Кому?</label><input class="form-input" id="a-to" name="recipient" maxlength="60" placeholder="Або залиш порожнім"></div>
        <div><label class="form-label" for="a-msg">Твоє повідомлення</label><textarea class="form-textarea" id="a-msg" name="message" maxlength="1500" placeholder="Напиши те, що важко сказати вголос…" autofocus></textarea></div>
        <div class="form-error" role="alert"></div><button class="publish-btn" type="submit">Надіслати →</button></div></form>`);
    },
    join() { if (S.me) scrollToId('section-events'); else authModal('register'); },
    toast: (msg) => toast(msg),
    zoom: (_, el) => openLightbox(el.dataset.src),
    'close-modal': () => closeModal(),
    'close-lightbox': () => closeLightbox(),
    burger(_, el) { const nav = $('#top-nav'); const open = nav.classList.toggle('nav-open'); el.setAttribute('aria-expanded', open); },
    togglepw(_, el) {
      const input = $('input', el.parentElement); const show = input.type === 'password';
      input.type = show ? 'text' : 'password'; el.textContent = show ? '🙈' : '👁';
    },
    'photo-remove'(kind) { S.photos[kind] = null; showPreview(kind); },
    'avatar-remove'() {
      S.avatarDraft = { state: 'remove', data: null };
      const p = $('#avatar-preview'); if (p) p.innerHTML = avatar({ name: S.me.name, username: S.me.username }, 'xl');
      toast('Фото буде прибрано після збереження');
    },
    reload: () => bootstrap(),
  };

  document.addEventListener('click', (e) => {
    const lb = e.target.closest('#lightbox');
    if (lb && !e.target.closest('[data-action="close-lightbox"]')) { closeLightbox(); return; }
    const el = e.target.closest('[data-action]');
    if (!el) { if (e.target === overlay) closeModal(); return; }
    const idx = el.dataset.action.indexOf(':');
    const name = idx < 0 ? el.dataset.action : el.dataset.action.slice(0, idx);
    const arg = idx < 0 ? '' : el.dataset.action.slice(idx + 1);
    const fn = actions[name]; if (!fn) return;
    if (el.tagName === 'A') e.preventDefault();
    e.stopPropagation(); fn(arg, el, e);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if ($('#confirm-overlay').classList.contains('open')) return;
      if ($('#lightbox').classList.contains('open')) { closeLightbox(); return; }
      closeModal(); return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role="button"][data-action]')) {
      e.preventDefault(); e.target.click(); return;
    }
    if (e.key === 'Tab' && overlay.classList.contains('open') && !$('#confirm-overlay').classList.contains('open')) {
      const f = $$('a[href], button:not([disabled]), input:not([disabled]), textarea, summary, [tabindex="0"]', modalBox).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0]; const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  document.addEventListener('submit', (e) => {
    const form = e.target.closest('form'); if (!form) return;
    e.preventDefault();
    const handler = forms[form.dataset.form || form.id];
    if (!handler) return;
    showFormError(form, '');
    handler(form, $('button[type=submit]', form));
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id && $(`[data-counter-for="${t.id}"]`)) { const c = $(`[data-counter-for="${t.id}"]`); c.textContent = `${t.value.length} / ${t.maxLength}`; }
    if (t.name === 'username' && t.closest('[data-form="register"]')) {
      const clean = t.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
      if (clean !== t.value) t.value = clean;
      t.dataset.touched = '1';
      const pv = $('[data-username-preview]'); if (pv) pv.textContent = clean || 'nickname';
    }
    if (t.name === 'name' && t.closest('[data-form="register"]')) {
      const u = $('#f-username');
      if (u && !u.dataset.touched) { u.value = translit(t.value); const pv = $('[data-username-preview]'); if (pv) pv.textContent = u.value || 'nickname'; }
    }
    if (t.name === 'password' && t.closest('[data-form="register"]')) {
      const s = pwScore(t.value); const bar = $('[data-pw-bar]'); const txt = $('[data-pw-text]');
      const cfg = [['8%', '#d0021b', 'Занадто короткий'], ['30%', '#ef6c00', 'Слабкий'], ['55%', '#f5c800', 'Непоганий'], ['80%', '#7cb342', 'Добрий'], ['100%', '#12a150', 'Відмінний!']];
      const [w, col, label] = t.value ? cfg[s] : ['0', '#eee', 'Мінімум 8 символів'];
      if (bar) { bar.style.width = w; bar.style.background = col; } if (txt) txt.textContent = label;
    }
  });

  document.addEventListener('change', async (e) => {
    const inp = e.target;
    if (!inp.matches || !inp.matches('input[type=file][data-photo]')) return;
    const kind = inp.dataset.photo; const file = inp.files[0]; inp.value = '';
    if (!file) return;
    try {
      const url = await compressImage(file, kind === 'avatar' ? 360 : 1400, kind === 'avatar' ? 0.85 : 0.82);
      if (kind === 'avatar') {
        S.avatarDraft = { state: 'new', data: url };
        const holder = $('#avatar-preview'); if (holder) holder.innerHTML = `<img class="avatar avatar-xl" src="${url}" alt="">`;
        toast('Фото обрано — натисни «Зберегти профіль»');
      } else { S.photos[kind] = url; showPreview(kind); }
    } catch (err) { toast(err.message, 'error'); }
  });

  // Резервні варіанти для зламаних картинок
  document.addEventListener('error', (e) => {
    const t = e.target; if (!(t instanceof HTMLImageElement)) return;
    const mode = t.dataset.fallback; if (!mode) return;
    delete t.dataset.fallback;
    if (mode === 'avatar') {
      const d = document.createElement('div'); d.className = 'team-avatar team-avatar-placeholder';
      d.textContent = ([...(t.alt || '?').trim()][0] || '?').toUpperCase(); t.replaceWith(d);
    } else if (mode === 'initial') {
      const s = document.createElement('span'); s.className = t.className; s.style.cssText = t.style.cssText; s.textContent = t.dataset.initial || '?'; t.replaceWith(s);
    } else if (mode === 'ph') {
      const d = document.createElement('div'); d.className = t.dataset.phClass || 'polaroid-ph'; d.textContent = '🖼'; t.replaceWith(d);
    } else if (mode === 'hide-parent') { if (t.parentElement) t.parentElement.remove(); } else if (mode === 'remove') { t.remove(); }
  }, true);

  /* ───────────── підсвітка меню, поява секцій, оновлення ───────────── */
  function setupObservers() {
    const reveals = $$('.reveal');
    if (!('IntersectionObserver' in window)) { reveals.forEach((r) => r.classList.add('in')); return; }
    const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: 0.05, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach((r) => io.observe(r));
    setTimeout(() => reveals.forEach((r) => r.classList.add('in')), 3500); // страховка

    const navBtns = $$('[data-nav]');
    const spy = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) navBtns.forEach((b) => b.classList.toggle('active', b.dataset.nav === en.target.id));
    }), { rootMargin: '-30% 0px -60% 0px' });
    navBtns.forEach((b) => { const s = document.getElementById(b.dataset.nav); if (s) spy.observe(s); });
  }

  /* ───────────── старт ───────────── */
  window.addEventListener('hashchange', () => { if (!S.loaded) return; openFromHash(); });
  setupObservers();
  updateCounters();
  bootstrap();
  setInterval(() => { if (!document.hidden && S.loaded) { renderEvents(); } }, 60 * 1000);          // оновлюємо відлік «через N днів»
  setInterval(() => { if (!document.hidden && S.loaded) refreshData({ silent: true }); }, 45 * 1000); // нові заходи зʼявляються без перезавантаження
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.loaded) refreshData({ silent: true }); });
})();
