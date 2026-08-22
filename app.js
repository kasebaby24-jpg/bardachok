/* =====================================================================
   BARDACHOK — логіка застосунку
   ---------------------------------------------------------------------
   Дані живуть на сервері (Cloudflare Worker), вхід — через Telegram.
   Тут: малювання екранів, форми, звернення до API.
   ===================================================================== */
(function () {
'use strict';

/* Єдине, що треба вписати після розгортання worker'а */
var API = 'https://bardachok.kasebaby24.workers.dev';

var QR_FOR = 'TWqHKxsLAdGMPC7kY4i3r2GQxNJ2U6vQXv';   // до цієї адреси намальовано usdt-qr.png

var BUILD = '20260822-2355';   // видно внизу «Ще» — щоб не гадати, яка версія відкрита
var BOOT_T0 = Date.now();

var tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;

var S    = null;   // дані користувача з сервера
var CFG  = {};     // налаштування
var PRO  = false;  // чи діє преміум
var TAB  = 's-home';
var REF  = {};   // реферальне посилання і лічильник

var $  = function (s) { return document.querySelector(s); };
var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

/* ------------------------------------------------------------------ */
/* ДРІБНИЦІ                                                            */
/* ------------------------------------------------------------------ */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function nfmt(n) { return Math.round(n || 0).toLocaleString('uk-UA').replace(/ /g, ' '); }
function money(n) { return nfmt(n) + ' ₴'; }
function usd(n) { return '$' + (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, ''); }
function uahOf(n) {                       // скільки це в гривнях за курсом НБУ
  var r = (CFG.rates && CFG.rates.USD) || parseFloat(CFG.usd) || 0;
  return r ? '≈ ' + nfmt(n * r) + ' ₴' : '';
}
function today() {
  var d = new Date();                       // місцева дата, не гринвіцька:
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 10);            // інакше після опівночі запис іде «вчора»
}

var MONTHS = ['січня','лютого','березня','квітня','травня','червня',
              'липня','серпня','вересня','жовтня','листопада','грудня'];
function fmtDateY(s) {              // з роком — для документів
  if (!s) return '';
  var p = String(s).split('-');
  if (p.length !== 3) return s;
  return parseInt(p[2], 10) + ' ' + MONTHS[parseInt(p[1], 10) - 1] + ' ' + p[0];
}
function fmtDate(s) {
  if (!s) return '';
  var p = String(s).split('-');
  if (p.length !== 3) return s;
  var out = parseInt(p[2], 10) + ' ' + MONTHS[parseInt(p[1], 10) - 1];
  if (p[0] !== today().slice(0, 4)) out += ' ' + p[0];   // інший рік — показуємо його
  return out;
}
function daysLeft(d) {
  if (!d) return null;
  var a = new Date(today() + 'T00:00:00Z').getTime();
  var b = new Date(d + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}
function plural(n, one, few, many) {
  n = Math.abs(n) % 100;
  var n1 = n % 10;
  if (n > 10 && n < 20) return many;
  if (n1 > 1 && n1 < 5) return few;
  if (n1 === 1) return one;
  return many;
}
function dayWord(n) { return plural(n, 'день', 'дні', 'днів'); }

var FUEL_UA  = { petrol: 'Бензин', diesel: 'Дизель', hybrid: 'Гібрид', electric: 'Електро', gas: 'Газ' };
var KIND_UA  = { oil: 'Заміна масла', brakes: 'Гальма', timing: 'Ремінь ГРМ', battery: 'Акумулятор',
                 tires: 'Шини', filter: 'Фільтри', diag: 'Діагностика', other: 'Інше' };
var CAT_UA = { wash: 'Мийка', parking: 'Паркінг', toll: 'Платні дороги', insurance: 'Страхування',
               tax: 'Податки і збори', tires: 'Шиномонтаж', parts: 'Запчастини', fine: 'Штраф', other: 'Інше' };
var CAT_IC = { wash: 'filter', parking: 'car', toll: 'globe', insurance: 'shield',
               tax: 'doc', tires: 'tires', parts: 'wrench', fine: 'money', other: 'plus' };

var KIND_IC  = { oil: 'oil', brakes: 'brakes', timing: 'timing', battery: 'battery',
                 tires: 'tires', filter: 'filter', diag: 'diag', other: 'wrench' };

function haptic(t) {
  try { if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred(t || 'light'); } catch (e) {}
}
function carName(c) {
  if (!c) return 'Авто';
  return [c.make, c.model].filter(Boolean).join(' ') || c.plate || 'Авто';
}
function activeCar() {
  if (!S || !S.cars.length) return null;
  return S.cars.filter(function (c) { return c.id === S.activeCar; })[0] || S.cars[0];
}


/* ------------------------------------------------------------------ */
/* ІКОНКИ                                                              */
/* Один набір контурних іконок замість емодзі — щоб застосунок          */
/* виглядав однаково на всіх пристроях і не «дешевив».                 */
/* ------------------------------------------------------------------ */
var ICONS = {
  fuel:   '<path d="M4 20V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15M3 20h12"/><path d="M14 9h2.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 0 3 0V8l-2.5-2.5"/><path d="M6 7h6v4H6z"/>',
  charge: '<path d="M4 20V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15M3 20h12"/><path d="M14 10h2.5a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 0 3 0V8"/><path d="M9.5 6 7 10.5h2.5L8.5 14"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 1 0 3 3L21 6l-3-3-3.3 3.3Z"/><path d="M11.5 12.5 5 19l-2-2 6.5-6.5"/>',
  money:  '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.3v9.4M9.6 9.6h4.2a1.7 1.7 0 0 1 0 3.4h-3.6a1.7 1.7 0 0 0 0 3.4h4.2"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>',
  shield: '<path d="M12 3 5 6v6c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-3Z"/>',
  oil:    '<path d="M5 9h9l3 3h3v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z"/><path d="M8 9V6h5"/><circle cx="8" cy="18" r="1.4"/><circle cx="17" cy="18" r="1.4"/>',
  brakes: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.4"/><path d="M12 3.5v5M12 15.5v5M3.5 12h5M15.5 12h5"/>',
  timing: '<circle cx="8" cy="14" r="4"/><circle cx="17" cy="9" r="3"/><path d="M8 10a8 8 0 0 1 9-1M6 18a9 9 0 0 0 12-6"/>',
  battery:'<rect x="2.5" y="8" width="17" height="9" rx="2"/><path d="M20 11v3M6 6.5h3M14 6.5h3M7 12.5h3M8.5 11v3M14 12.5h3"/>',
  tires:  '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3"/><path d="m12 3.5 1.5 5M12 20.5l-1.5-5M3.5 12l5-1.5M20.5 12l-5 1.5"/>',
  filter: '<path d="M3.5 5h17l-6.5 7.5V20l-4-2v-5.5L3.5 5Z"/>',
  diag:   '<path d="M3 12h3.5l2-5 3 10 2.5-5H21"/>',
  car:    '<path d="M4.5 16V12l2-5h11l2 5v4"/><path d="M3 16h18v2.5h-3V16H6v2.5H3V16Z"/><circle cx="7.5" cy="16" r="1.6"/><circle cx="16.5" cy="16" r="1.6"/><path d="M6.5 12h11"/>',
  ev:     '<path d="M4.5 16V12l2-5h11l2 5v4"/><path d="M3 16h18v2.5h-3V16H6v2.5H3V16Z"/><circle cx="7.5" cy="16" r="1.6"/><circle cx="16.5" cy="16" r="1.6"/><path d="m12.5 8.5-2 3.5h2l-.8 3"/>',
  alert:  '<path d="M12 4.5 21 19H3l9-14.5Z"/><path d="M12 10v4M12 16.5v.5"/>',
  check:  '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  chart:  '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
  doc:    '<path d="M6 3h7l5 5v13H6V3Z"/><path d="M13 3v5h5M9 13h6M9 17h4"/>',
  chat:   '<path d="M4 5h16v11H9l-5 4V5Z"/><path d="M8.5 10.5h.5M11.5 10.5h.5M14.5 10.5h.5"/>',
  crash:  '<path d="M12 3v4M5.6 5.6l2.8 2.8M3 12h4M5.6 18.4l2.8-2.8M12 21v-4M18.4 18.4l-2.8-2.8M21 12h-4M18.4 5.6l-2.8 2.8"/><circle cx="12" cy="12" r="2.6"/>',
  globe:  '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17"/>',
  plus:   '<path d="M12 5v14M5 12h14"/>',
  star:   '<path d="m12 4 2.4 5 5.6.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9 5.6-.8L12 4Z"/>',
  back:   '<path d="M15 5 8 12l7 7"/>',
  rain:   '<path d="M12 3.5c3 3.6 5 6.1 5 8.2a5 5 0 0 1-10 0c0-2.1 2-4.6 5-8.2Z"/>',
  sun:    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/>',
  snow:   '<path d="M12 2v20M4 7l16 10M20 7 4 17"/>',
  idcard: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><circle cx="8.5" cy="11" r="2"/>' +
          '<path d="M5.5 16c.6-1.4 1.7-2 3-2s2.4.6 3 2M14 10h4.5M14 13.5h3"/>',
  lock:   '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.6"/>' +
          '<path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9"/>',
  gift:   '<rect x="3.5" y="9" width="17" height="11" rx="1.5"/><path d="M3.5 13h17M12 9v11"/><path d="M12 9c-3.5 0-4.5-1-4.5-2.5S9 4 10 5s2 4 2 4Zm0 0c3.5 0 4.5-1 4.5-2.5S15 4 14 5s-2 4-2 4Z"/>',
};

/* ic('fuel') -> готова іконка. size і колір керуються з CSS. */
/* Золотий замочок біля всього, що відкриває Преміум */
function lockIc() {
  return '<span class="lock">' + ic('lock', 13) + '</span>';
}

function ic(name, size, cls) {
  var d = ICONS[name] || ICONS.car;
  return '<svg class="icn' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" width="' +
    (size || 22) + '" height="' + (size || 22) + '" aria-hidden="true">' + d + '</svg>';
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */
function initData() {
  try { return (tg && tg.initData) ? tg.initData : ''; } catch (e) { return ''; }
}
function api(path, body) {
  return fetch(API.replace(/\/+$/, '') + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Init-Data': initData() },
    body: JSON.stringify(body || {}),
  }).then(function (r) { return r.json(); });
}

/* Виконує дію на сервері, оновлює стан, показує помилку якщо є. */
function act(payload, onOk) {
  return api('/api/save', payload).then(function (d) {
    if (!d.ok) {
      if (d.error === 'limit') { needPro('cars'); return false; }
      toast(d.message || d.error || 'Не вдалося зберегти');
      return false;
    }
    S = d.data; PRO = d.premium;
    render();
    if (onOk) onOk();
    return true;
  }).catch(function () { toast('Немає зв’язку з сервером'); return false; });
}

function seen(k) { try { return localStorage.getItem('b_' + k) === '1'; } catch (e) { return false; } }
function markSeen(k) { try { localStorage.setItem('b_' + k, '1'); } catch (e) {} }

/* Власна плашка замість системного вікна: те показувало адресу сайту
   і виглядало як помилка браузера, а не як частина застосунку. */
var TOAST_T = null;
function toast(msg, kind) {
  var el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = String(msg).slice(0, 160);
  void el.offsetWidth;                       // щоб анімація програлась ще раз
  el.classList.add('on');
  if (TOAST_T) clearTimeout(TOAST_T);
  TOAST_T = setTimeout(function () { el.classList.remove('on'); }, 2600);
}

/* ------------------------------------------------------------------ */
/* ШТОРКА                                                              */
/* ------------------------------------------------------------------ */
/* Системний confirm() світить адресу сайту — а це чужий домен на GitHub.
   Тому питаємо всередині застосунку. */
var ASK_CB = null;
function ask(title, text, okText, cb) {
  ASK_CB = cb;
  openSheet(title,
    '<p style="margin:0 0 16px;font-size:14px;color:var(--ink2);line-height:1.55">' + esc(text) + '</p>' +
    '<button class="btn dan" data-do="askYes">' + esc(okText || 'Так') + '</button>' +
    '<button class="btn sec" data-close="1">Скасувати</button>');
}

/* Що дає Преміум — коли людина впирається в замок */
var PRO_WHY = {
  voice:  ['Голосове внесення', 'Надиктували боту або кнопці «Дія» — запис зʼявився сам.'],
  ai:     ['Питання про авто', 'Помічник відповідає з вашою сервісною книжкою перед очима.'],
  plate:  ['Пошук за номером', 'Марка, рік, обʼєм і колір за державним реєстром.'],
  vin:    ['Перевірки по VIN', 'Без обмежень, з фото й ціною з американського аукціону.'],
  report: ['Звіти для покупця', 'PDF із сервісною книжкою — сильний аргумент у торгу.'],
  docs:   ['Документи', 'Двадцять знімків замість трьох.'],
  cars:   ['Кілька авто', 'До дванадцяти машин в одному гаражі.'],
};

function needPro(what) {
  var w = PRO_WHY[what] || ['Ця можливість', 'Доступна в Преміумі.'];
  openSheet(w[0] + ' — у Преміумі',
    '<div class="hero" style="margin-bottom:14px">' +
      '<div class="hero-top"><span>' + esc(w[0]) + '</span>' + ic('star', 18) + '</div>' +
      '<b style="font-size:22px;line-height:1.2">' + esc(w[1]) + '</b></div>' +
    '<div class="card list">' + Object.keys(PRO_WHY).map(function (k) {
      var x = PRO_WHY[k];
      return '<div class="it" style="cursor:default"><div class="dt">' +
        ic(k === what ? 'check' : 'star', 16) + '</div>' +
        '<div class="tx"><b>' + x[0] + '</b><small>' + x[1] + '</small></div></div>';
    }).join('') + '</div>' +
    '<div class="plans" style="margin-top:14px">' +
      '<button data-do="buy" data-plan="month"><small>Місяць</small><b>' + usd(CFG.premiumMonth) + '</b>' +
        '<em>' + uahOf(CFG.premiumMonth) + '</em></button>' +
      '<button data-do="buy" data-plan="half"><small>Півроку</small><b>' + usd(CFG.premiumHalf) + '</b>' +
        '<em>' + uahOf(CFG.premiumHalf) + '</em></button>' +
      '<button class="best" data-do="buy" data-plan="year"><small>Рік</small><b>' + usd(CFG.premiumYear) + '</b>' +
        '<em>' + uahOf(CFG.premiumYear) + '</em></button>' +
    '</div>');
}

function openSheet(title, html) {
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = html;
  $('#sheet').classList.remove('hidden');
  $('#sheetBox').classList.remove('out');
  haptic('light');
  if (tg && tg.BackButton) tg.BackButton.show();
}
function closeSheet() {
  var b = $('#sheetBox');
  b.classList.add('out');
  setTimeout(function () { $('#sheet').classList.add('hidden'); b.classList.remove('out'); }, 260);
  if (tg && tg.BackButton && TAB === 's-home') tg.BackButton.hide();
}
document.addEventListener('click', function (e) {
  if (e.target.closest('[data-close]')) closeSheet();
});

/* Здогад міняє видимі поля, тому робимо це не на кожну літеру, а коли
   людина закінчила вводити — інакше поле «тікає» з-під курсора. */
document.addEventListener('change', function (e) {
  if (e.target.id === 'cMake' || e.target.id === 'cModel') applyGuess();
}, true);
document.addEventListener('blur', function (e) {
  if (e.target.id === 'cMake' || e.target.id === 'cModel') applyGuess();
}, true);

/* ------------------------------------------------------------------ */
/* СИЛУЕТИ ЗА ТИПОМ КУЗОВА                                             */
/* Малюємо самі: жодних чужих картинок, миттєво і завжди доречно.      */
/* ------------------------------------------------------------------ */
var SIL = {
  sedan: {
    body:'M8 62 L8 47 Q8 41 15 40 L44 37 L64 22 Q69 18 78 18 L124 18 Q134 18 141 23 L163 37 L186 41 Q194 43 194 51 L194 62 Z',
    win:'M70 25 L86 25 L86 36 L58 37 Z M92 25 L122 25 Q129 25 133 29 L142 36 L92 36 Z',
    w:[54,152], r:12
  },
  hatch: {
    body:'M22 62 L20 44 Q20 34 28 27 L40 20 Q45 17 54 17 L116 17 Q127 17 134 22 L158 37 L186 41 Q194 43 194 51 L194 62 Z',
    win:'M46 24 L74 24 L74 35 L30 35 Q31 30 36 26 Z M80 24 L114 24 Q121 24 125 28 L135 35 L80 35 Z',
    w:[56,152], r:12
  },
  wagon: {
    body:'M8 62 L8 40 Q8 22 20 20 L124 18 Q135 18 142 23 L164 37 L186 41 Q194 43 194 51 L194 62 Z',
    win:'M22 26 L74 25 L74 36 L18 36 Z M80 25 L122 25 Q129 25 133 29 L142 36 L80 36 Z',
    w:[52,152], r:12
  },
  suv: {
    body:'M10 56 L10 30 Q10 14 26 12 L128 11 Q141 11 148 18 L170 30 L188 34 Q194 36 194 44 L194 56 Q194 58 190 58 L14 58 Q10 58 10 56 Z',
    win:'M26 19 L78 18 L78 30 L22 30 Q22 21 26 19 Z M84 18 L124 18 Q133 18 138 23 L147 30 L84 30 Z',
    w:[52,154], r:16
  },
  coupe: {
    body:'M8 62 L8 49 Q8 43 16 42 L46 39 L72 23 Q79 19 90 19 L120 20 Q132 22 140 29 L166 41 L187 45 Q194 47 194 54 L194 62 Z',
    win:'M78 26 L96 26 L96 37 L64 38 Z M102 26 L118 27 Q127 29 133 34 L138 38 L102 37 Z',
    w:[54,152], r:12
  },
  pickup: {
    body:'M8 62 L8 38 L86 38 L86 24 Q86 18 94 18 L134 18 Q143 18 149 24 L169 37 L187 41 Q194 43 194 51 L194 62 Z',
    win:'M94 25 L110 25 L110 36 L94 36 Z M116 25 L132 25 Q139 25 143 29 L149 36 L116 36 Z',
    w:[46,156], r:13
  },
  van: {
    body:'M8 60 L8 32 Q8 18 24 17 L112 16 Q133 16 150 29 L173 39 L188 43 Q194 45 194 52 L194 60 Z',
    win:'M24 23 L74 22 L74 35 L18 35 Z M80 22 L110 22 Q126 23 139 33 L142 35 L80 35 Z',
    w:[52,152], r:13
  },
  truck: {
    body:'M8 60 L8 14 L120 14 L120 28 Q120 22 130 22 L150 22 Q159 22 165 28 L182 40 L189 43 Q194 45 194 52 L194 60 Z',
    win:'M130 28 L146 28 Q153 28 157 32 L162 38 L130 38 Z',
    w:[46,158], r:14
  },
};

function silSvg(body, ink, back) {
  var d = SIL[body] || SIL.sedan;
  var cy = d.body.indexOf('L194 60') > -1 || d.body.indexOf('L194 56') > -1 ? 58 : 62;
  var wheels = d.w.map(function (x) {
    return '<circle cx="' + x + '" cy="' + cy + '" r="' + d.r + '" fill="' + ink + '"/>' +
           '<circle cx="' + x + '" cy="' + cy + '" r="' + (d.r - 5) + '" fill="' + back + '" opacity=".5"/>';
  }).join('');
  return '<svg class="sil" viewBox="0 0 200 80" aria-hidden="true">' +
    '<path d="' + d.body + '" fill="' + ink + '"/>' +
    '<path d="' + d.win + '" fill="' + back + '" opacity=".26"/>' + wheels + '</svg>';
}

/* ------------------------------------------------------------------ */
/* ДОВІДНИК МОДЕЛЕЙ                                                    */
/* Щоб застосунок сам знав тип кузова й не дозволяв «Tesla на бензині».*/
/* Список — під український ринок, тому тут і Ланос, і Пріус.          */
/* ------------------------------------------------------------------ */
var BODY_UA = { sedan: 'Седан', hatch: 'Хетчбек', wagon: 'Універсал', suv: 'Кросовер',
                coupe: 'Купе', pickup: 'Пікап', van: 'Мінівен', truck: 'Фургон' };

/* модель -> [кузов, паливо або null якщо буває різне] */
var MODELS = {
  /* електричні — тут паливо задане жорстко */
  'tesla model 3': ['sedan','electric'], 'tesla model s': ['sedan','electric'],
  'tesla model y': ['suv','electric'],   'tesla model x': ['suv','electric'],
  'nissan leaf': ['hatch','electric'],   'nissan ariya': ['suv','electric'],
  'chevrolet bolt': ['hatch','electric'],'chevrolet volt': ['hatch','hybrid'],
  'renault zoe': ['hatch','electric'],   'renault kangoo': ['van',null],
  'volkswagen id.3': ['hatch','electric'],'volkswagen id.4': ['suv','electric'],
  'volkswagen e-golf': ['hatch','electric'],
  'hyundai kona': ['suv',null], 'hyundai ioniq': ['hatch',null], 'hyundai ioniq 5': ['suv','electric'],
  'kia niro': ['suv',null], 'kia ev6': ['suv','electric'], 'kia soul': ['suv',null],
  'bmw i3': ['hatch','electric'], 'bmw i4': ['sedan','electric'], 'bmw ix': ['suv','electric'],
  'audi e-tron': ['suv','electric'], 'porsche taycan': ['sedan','electric'],
  'ford mustang mach-e': ['suv','electric'], 'jaguar i-pace': ['suv','electric'],
  'mercedes-benz eqc': ['suv','electric'], 'mercedes eqc': ['suv','electric'],
  'byd song': ['suv','electric'], 'byd yuan': ['suv','electric'], 'byd han': ['sedan','electric'],
  'mg zs': ['suv',null], 'nio es8': ['suv','electric'], 'zeekr 001': ['wagon','electric'],

  /* гібриди */
  'toyota prius': ['hatch','hybrid'], 'toyota chr': ['suv',null], 'toyota c-hr': ['suv',null],

  /* найпоширеніші в Україні */
  'toyota camry': ['sedan',null], 'toyota corolla': ['sedan',null], 'toyota rav4': ['suv',null],
  'toyota land cruiser': ['suv',null], 'toyota highlander': ['suv',null], 'toyota avensis': ['sedan',null],
  'volkswagen golf': ['hatch',null], 'volkswagen passat': ['sedan',null], 'volkswagen tiguan': ['suv',null],
  'volkswagen polo': ['hatch',null], 'volkswagen touareg': ['suv',null], 'volkswagen caddy': ['van',null],
  'volkswagen transporter': ['van',null], 'volkswagen jetta': ['sedan',null],
  'skoda octavia': ['sedan',null], 'skoda superb': ['sedan',null], 'skoda fabia': ['hatch',null],
  'skoda kodiaq': ['suv',null], 'skoda karoq': ['suv',null],
  'renault megane': ['hatch',null], 'renault duster': ['suv',null], 'renault logan': ['sedan',null],
  'renault trafic': ['van',null], 'dacia duster': ['suv',null], 'dacia logan': ['sedan',null],
  'nissan qashqai': ['suv',null], 'nissan x-trail': ['suv',null], 'nissan juke': ['suv',null],
  'nissan rogue': ['suv',null], 'nissan altima': ['sedan',null], 'nissan micra': ['hatch',null],
  'hyundai tucson': ['suv',null], 'hyundai santa fe': ['suv',null], 'hyundai elantra': ['sedan',null],
  'hyundai accent': ['sedan',null], 'hyundai i30': ['hatch',null], 'hyundai sonata': ['sedan',null],
  'kia sportage': ['suv',null], 'kia sorento': ['suv',null], 'kia ceed': ['hatch',null],
  'kia rio': ['sedan',null], 'kia optima': ['sedan',null],
  'ford focus': ['hatch',null], 'ford fiesta': ['hatch',null], 'ford kuga': ['suv',null],
  'ford escape': ['suv',null], 'ford transit': ['truck',null], 'ford mondeo': ['sedan',null],
  'ford explorer': ['suv',null], 'ford f-150': ['pickup',null], 'ford ranger': ['pickup',null],
  'bmw 3 series': ['sedan',null], 'bmw 5 series': ['sedan',null], 'bmw x5': ['suv',null],
  'bmw x3': ['suv',null], 'bmw x1': ['suv',null], 'bmw 7 series': ['sedan',null],
  'mercedes-benz c-class': ['sedan',null], 'mercedes-benz e-class': ['sedan',null],
  'mercedes-benz s-class': ['sedan',null], 'mercedes-benz gle': ['suv',null],
  'mercedes-benz sprinter': ['truck',null], 'mercedes-benz vito': ['van',null],
  'audi a4': ['sedan',null], 'audi a6': ['sedan',null], 'audi q5': ['suv',null],
  'audi q7': ['suv',null], 'audi a3': ['hatch',null],
  'mazda 3': ['sedan',null], 'mazda 6': ['sedan',null], 'mazda cx-5': ['suv',null],
  'honda civic': ['sedan',null], 'honda accord': ['sedan',null], 'honda cr-v': ['suv',null],
  'mitsubishi outlander': ['suv',null], 'mitsubishi lancer': ['sedan',null],
  'mitsubishi pajero': ['suv',null], 'mitsubishi asx': ['suv',null],
  'opel astra': ['hatch',null], 'opel insignia': ['sedan',null], 'opel vivaro': ['van',null],
  'opel zafira': ['van',null], 'opel corsa': ['hatch',null],
  'peugeot 308': ['hatch',null], 'peugeot 3008': ['suv',null], 'peugeot partner': ['van',null],
  'peugeot 208': ['hatch',null], 'citroen berlingo': ['van',null], 'citroen c4': ['hatch',null],
  'chevrolet aveo': ['sedan',null], 'chevrolet lacetti': ['sedan',null], 'chevrolet cruze': ['sedan',null],
  'daewoo lanos': ['sedan',null], 'daewoo sens': ['sedan',null], 'daewoo nexia': ['sedan',null],
  'zaz lanos': ['sedan',null], 'zaz sens': ['sedan',null],
  'jeep grand cherokee': ['suv',null], 'jeep wrangler': ['suv',null], 'jeep cherokee': ['suv',null],
  'subaru forester': ['suv',null], 'subaru outback': ['wagon',null],
  'volvo xc60': ['suv',null], 'volvo xc90': ['suv',null], 'volvo s60': ['sedan',null],
  'lexus rx': ['suv',null], 'lexus nx': ['suv',null], 'lexus es': ['sedan',null],
  'infiniti qx60': ['suv',null], 'seat leon': ['hatch',null], 'seat ibiza': ['hatch',null],
  'fiat doblo': ['van',null], 'fiat ducato': ['truck',null], 'fiat 500': ['hatch',null],
  'lada niva': ['suv',null], 'lada priora': ['sedan',null], 'lada granta': ['sedan',null],
  'ram 1500': ['pickup',null], 'toyota tundra': ['pickup',null], 'toyota tacoma': ['pickup',null],
  'chevrolet silverado': ['pickup',null], 'gmc sierra': ['pickup',null],
};

/* марки, у яких усе електричне */
var EV_MAKES = ['tesla', 'nio', 'zeekr', 'polestar', 'lucid', 'rivian', 'xpeng'];

function carKey(make, model) {
  return String((make || '') + ' ' + (model || '')).toLowerCase()
    .replace(/[іi]/g, 'i').replace(/\s+/g, ' ').trim();
}

/* Що ми знаємо про це авто за маркою й моделлю */
function guessCar(make, model) {
  var k = carKey(make, model);
  if (MODELS[k]) return { body: MODELS[k][0], fuel: MODELS[k][1], sure: true };

  /* часткове співпадіння: «Model 3» без марки, «Octavia A7» з приміткою */
  var keys = Object.keys(MODELS);
  for (var i = 0; i < keys.length; i++) {
    if (k && (k.indexOf(keys[i]) === 0 || keys[i].indexOf(k) === 0))
      return { body: MODELS[keys[i]][0], fuel: MODELS[keys[i]][1], sure: false };
  }
  var mk = String(make || '').toLowerCase().trim();
  if (EV_MAKES.indexOf(mk) > -1) return { body: null, fuel: 'electric', sure: true };
  return { body: null, fuel: null, sure: false };
}

/* Тип кузова з відповіді державного декодера */
function bodyFromVin(bodyClass) {
  var b = String(bodyClass || '').toLowerCase();
  if (/pickup|truck-tractor/.test(b)) return 'pickup';
  if (/sport utility|suv|crossover|multi-purpose/.test(b)) return 'suv';
  if (/wagon|estate/.test(b)) return 'wagon';
  if (/hatchback|liftback/.test(b)) return 'hatch';
  if (/coupe|convertible|roadster/.test(b)) return 'coupe';
  if (/van|minivan/.test(b)) return b.indexOf('mini') > -1 ? 'van' : 'truck';
  if (/sedan|saloon/.test(b)) return 'sedan';
  return null;
}

/* ------------------------------------------------------------------ */
/* ОБЧИСЛЕННЯ                                                          */
/* ------------------------------------------------------------------ */
function nextOil(car) {
  if (!car || car.fuel === 'electric') return null;
  if (car.lastOilOdo == null) return null;
  var iv = parseInt(CFG.oilInterval, 10) || 10000;
  return { next: car.lastOilOdo + iv, left: car.lastOilOdo + iv - car.odo, interval: iv };
}

/* витрати за останні 30 днів */
function spend(carId, days) {
  var since = new Date(Date.now() - (days || 30) * 86400000).toISOString().slice(0, 10);
  var f = 0, s = 0;
  (S.fuel || []).forEach(function (r) { if (r.carId === carId && r.date >= since) f += costUah(r); });
  (S.service || []).forEach(function (r) { if (r.carId === carId && r.date >= since) s += costUah(r); });
  var fines = 0;
  (S.fines || []).forEach(function (r) { if (r.carId === carId && r.date >= since) fines += r.paid ? (r.half ? r.amount / 2 : r.amount) : 0; });
  var other = 0, byCat = {};
  (S.exp || []).forEach(function (r) {
    if (r.carId !== carId || r.date < since) return;
    other += costUah(r);
    byCat[r.cat] = (byCat[r.cat] || 0) + costUah(r);
  });
  return { fuel: f, service: s, fines: fines, other: other, byCat: byCat,
           total: f + s + fines + other };
}

/* середня витрата пального між заправками */
/* Витрата рахується від повного бака до повного бака: тільки тоді відомо,
   скільки саме пального пішло на пройдений відрізок. Неповні заправки
   всередині відрізка додаються до його обсягу, але самі його не закривають. */
function consumption(carId) {
  var rows = (S.fuel || []).filter(function (r) { return r.carId === carId && r.odo > 0 && r.qty > 0; })
                           .sort(function (a, b) { return a.odo - b.odo; });
  if (rows.length < 2) return null;

  var segs = [], start = null, acc = 0, accCost = 0;
  rows.forEach(function (r) {
    var full = r.full !== false;
    if (start === null) { if (full) start = r; return; }
    acc += r.qty; accCost += costUah(r);
    if (full) {
      var dist = r.odo - start.odo;
      if (dist > 0 && acc > 0)
        segs.push({ dist: dist, qty: acc, cost: accCost, per100: acc / dist * 100, date: r.date });
      start = r; acc = 0; accCost = 0;
    }
  });
  if (!segs.length) return null;

  var dist = 0, qty = 0, cost = 0;
  segs.forEach(function (g) { dist += g.dist; qty += g.qty; cost += g.cost; });
  return { per100: qty / dist * 100, dist: dist, tanks: segs.length,
           last: segs[segs.length - 1].per100,
           perKm: cost > 0 ? cost / dist : null };   // ціна кілометра — з тих самих відрізків
}

/* список того, що потребує уваги */
/* Підказки, без яких цифри будуть неправдиві.
   Не тривоги, а прохання: «онови пробіг», «познач повний бак». */
function nudges(car) {
  if (!car) return [];
  var out = [];
  var isEV = car.fuel === 'electric';

  var stale = car.odoDate ? daysBetween(car.odoDate, today()) : 999;
  if (stale >= 21)
    out.push({ t: 'Оновіть пробіг', p: 'Востаннє ' + (car.odoDate ? fmtDate(car.odoDate) : 'невідомо') +
      '. Від нього рахується витрата й строк заміни масла.', do: 'odo', btn: 'Оновити' });

  var fr = (S.fuel || []).filter(function (r) { return r.carId === car.id; });
  if (!fr.length)
    out.push({ t: (isEV ? 'Додайте першу зарядку' : 'Додайте першу заправку'),
      p: 'З двох заправок я порахую реальну витрату — і скільки коштує кілометр.',
      do: 'fuel', btn: 'Додати' });
  else if (!consumption(car.id))
    out.push({ t: 'Позначте «' + (isEV ? 'до 100%' : 'повний бак') + '»',
      p: 'Витрату видно тільки між двома повними ' + (isEV ? 'зарядами' : 'баками') + '.',
      do: 'fuel', btn: 'Заправка' });

  if (!isEV && car.lastOilOdo == null)
    out.push({ t: 'Коли міняли масло?', p: 'Впишіть пробіг заміни — і я нагадаю про наступну.',
      do: 'editThis', btn: 'Вписати' });

  if (!car.insuranceEnd)
    out.push({ t: 'Додайте дату ОСЦПВ', p: 'Попереджу за два тижні, щоб не купувати нашвидкуруч.',
      do: 'editThis', btn: 'Додати' });

  if (!(S.rem || []).filter(function (r) { return r.carId === car.id; }).length && fr.length)
    out.push({ t: 'Додайте нагадування', p: 'ГРМ, антифриз, техогляд — усе, що легко забути.',
      go: 'tab:s-rem', btn: 'Створити' });

  return out.slice(0, 1);                 // одна підказка за раз — дві вже гамірно
}

function attention() {
  var extra = [];
  var ac0 = activeCar();
  if (ac0) {
    remList(ac0.id).forEach(function (r) {
      var w = remWhen(r, ac0);
      if (w.hot) extra.push({ lvl: w.sort <= 0 ? 'hot' : '', ic: 'alert', t: r.title,
                              p: 'Ваше нагадування', d: w.txt, go: 'tab:s-rem' });
    });
  }
  return attentionBase().concat(extra);
}

function attentionBase() {
  var out = [];
  (S.cars || []).forEach(function (c) {
    var nm = carName(c);
    var di = daysLeft(c.insuranceEnd);
    if (di !== null && di <= (parseInt(CFG.remindInsurance, 10) || 14)) {
      out.push({
        lvl: di < 0 ? 'hot' : (di <= 3 ? 'hot' : 'warn'), ic: 'shield',
        t: 'ОСЦПВ' + (S.cars.length > 1 ? ' · ' + nm : ''),
        p: di < 0 ? 'Прострочено на ' + (-di) + ' ' + dayWord(-di) + '. Їздити без полісу — штраф.'
                  : (di === 0 ? 'Спливає сьогодні.' : 'Спливає ' + fmtDate(c.insuranceEnd) + '.'),
        d: di < 0 ? 'прострочено' : di + ' ' + dayWord(di),
        go: 'car:' + c.id,
      });
    }
    var dg = daysLeft(c.greenEnd);
    if (dg !== null && dg <= (parseInt(CFG.remindInsurance, 10) || 14) && dg >= 0) {
      out.push({ lvl: 'warn', ic: 'globe', t: 'Зелена карта' + (S.cars.length > 1 ? ' · ' + nm : ''),
        p: 'Спливає ' + fmtDate(c.greenEnd) + '.', d: dg + ' ' + dayWord(dg), go: 'car:' + c.id });
    }
    var oil = nextOil(c);
    if (oil && oil.left <= (parseInt(CFG.remindService, 10) || 1000)) {
      out.push({
        lvl: oil.left <= 0 ? 'hot' : 'warn', ic: 'oil',
        t: 'Заміна масла' + (S.cars.length > 1 ? ' · ' + nm : ''),
        p: oil.left <= 0 ? 'Прострочено на ' + nfmt(-oil.left) + ' км.' : 'Залишилось ' + nfmt(oil.left) + ' км.',
        d: oil.left <= 0 ? 'пора' : nfmt(oil.left) + ' км', go: 'tab:s-service',
      });
    }
  });
  (S.fines || []).filter(function (f) { return !f.paid; }).forEach(function (f) {
    var d = f.half ? daysLeft(f.until) : null;
    out.push({
      lvl: (d !== null && d <= 3) ? 'hot' : 'warn', ic: 'money', t: 'Несплачений штраф',
      p: f.half && d !== null && d >= 0
        ? 'Знижка 50% ще ' + (d === 0 ? 'сьогодні' : d + ' ' + dayWord(d)) + '. Зараз — ' + money(f.amount / 2) + '.'
        : 'До сплати ' + money(f.amount) + '.',
      d: f.half && d !== null && d >= 0 ? d + ' ' + dayWord(d) : money(f.amount),
      go: 'tab:s-fines',
    });
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* МАЛЮВАННЯ                                                           */
/* ------------------------------------------------------------------ */
function render() {
  /* поки немає жодного авто — показуємо знайомство замість гаража */
  var firstRun = !S.cars.length && !seen('tour');
  $('#nav').classList.toggle('hidden', firstRun);
  if (firstRun) { drawTour(); show('s-tour'); }
  else if (TAB === 's-tour') { show('s-home'); }

  $('#topName').textContent = S && S.name ? S.name : 'Бардачок';
  var d = new Date();
  $('#topDate').textContent = d.getDate() + ' ' + MONTHS[d.getMonth()];
  var av = $('#ava');
  av.textContent = (S && S.name ? S.name : 'Б').trim().charAt(0).toUpperCase();
  av.classList.toggle('pro', PRO);

  var unpaid = (S.fines || []).filter(function (f) { return !f.paid; }).length;
  var fbtn = $('.nav button[data-tab="s-fines"]');
  var dot = fbtn.querySelector('.dot');
  if (unpaid && !dot) { var el = document.createElement('span'); el.className = 'dot'; fbtn.appendChild(el); }
  if (!unpaid && dot) dot.remove();

  DIRTY = {};                       // усе застаріло
  paint(TAB);                       // малюємо тільки те, що видно
}

/* Перемальовуємо екран лише коли на нього дивляться.
   Раніше кожна дія перебудовувала всі одинадцять — звідси й гальма. */
var DIRTY = {};
var PAINT = {
  's-tour': drawTour, 's-home': drawHome, 's-fines': drawFines, 's-service': drawService,
  's-money': drawMoney, 's-more': drawMore, 's-vin': drawVin, 's-ask': drawAsk,
  's-docs': drawDocs, 's-report': drawReport, 's-crash': drawCrash, 's-cars': drawCars,
  's-rem': drawRem, 's-plate': drawPlate, 's-voice': drawVoice,
};
function paint(id) {
  var f = PAINT[id];
  if (!f) return;
  if (DIRTY[id]) return;            // вже намальовано з останніми даними
  f();
  DIRTY[id] = 1;
}

function ringSvg(pct, color) {
  var C = 232.5, off = C * (1 - Math.max(0, Math.min(1, pct)));
  return '<div class="gauge"><svg width="84" height="84" viewBox="0 0 88 88">' +
    '<circle cx="44" cy="44" r="37" stroke="#252C30" stroke-width="9" fill="none"/>' +
    '<circle cx="44" cy="44" r="37" stroke="' + color + '" stroke-width="9" fill="none" ' +
    'stroke-linecap="round" stroke-dasharray="' + C + '" stroke-dashoffset="' + off + '"/>' +
    '</svg><div class="lab" style="color:' + color + '">' + Math.round(pct * 100) + '%</div></div>';
}

/* ------------------------------------------------------------------ */
/* ЗНАЙОМСТВО ПРИ ПЕРШОМУ ЗАПУСКУ                                      */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* ЗНАЙОМСТВО — сторіз                                                 */
/* Перше, що бачить нова людина. За пʼять екранів має стати зрозуміло, */
/* навіщо це і чому варто лишитись.                                    */
/* ------------------------------------------------------------------ */
var STORY = 0;
var STORIES = [
  {
    tag: 'Бардачок',
    t: 'Усе про авто —\nв одному місці',
    p: 'Строки, витрати, ремонти, документи. Без папок, зошитів і «десь було в чаті».',
    art: 'hero',
  },
  {
    tag: 'Строки',
    t: 'Не пропустите\nжодного строку',
    p: 'Страховка, техобслуговування, зелена карта. Попереджу заздалегідь — у застосунку і в боті.',
    art: 'dates',
    fact: 'Штраф з камери зі знижкою — 425 ₴. Без знижки — 850 ₴. Знижка діє лише 10 банківських днів.',
  },
  {
    tag: 'Голос',
    t: 'Кажіть —\nя запишу',
    p: 'Надиктуйте боту «заправився на 500 і поміняв масло за 2400» — обидва записи зʼявляться самі.',
    art: 'voice',
    fact: 'На iPhone це можна повісити на кнопку «Дія» або постукування по кришці.',
  },
  {
    tag: 'Помічник',
    t: 'Знає саме\nваше авто',
    p: 'Питаєте — відповідає з вашою книжкою перед очима: коли міняли, скільки вклали, що вже пора.',
    art: 'brain',
    fact: 'Плюс перевірка по VIN: що це за машина насправді, ще до купівлі.',
  },
  {
    tag: 'Продаж',
    t: 'Історія,\nяка додає ціни',
    p: 'При продажу все зібране перетворюється на PDF-звіт для покупця. Доглянуте авто торгується інакше.',
    art: 'sell',
    last: true,
  },
];

function storyArt(kind) {
  if (kind === 'hero')
    return '<div class="st-art hero">' + silSvg('suv', '#0E1207', '#D7FF3E') + '</div>';
  if (kind === 'dates')
    return '<div class="st-art">' +
      '<div class="st-row"><span>' + ic('shield', 18) + 'ОСЦПВ</span><b>12 днів</b></div>' +
      '<div class="st-row hot"><span>' + ic('money', 18) + 'Штраф зі знижкою</span><b>4 дні</b></div>' +
      '<div class="st-row"><span>' + ic('oil', 18) + 'Заміна масла</span><b>800 км</b></div></div>';
  if (kind === 'voice')
    return '<div class="st-art">' +
      '<div class="st-say">«заправився на 500 і поміняв масло за 2400»</div>' +
      '<div class="st-row done"><span>' + ic('fuel', 18) + 'Заправка</span><b>500 ₴</b></div>' +
      '<div class="st-row done"><span>' + ic('oil', 18) + 'Заміна масла</span><b>2 400 ₴</b></div></div>';
  if (kind === 'brain')
    return '<div class="st-art">' +
      '<div class="st-bub me">Коли міняти ремінь ГРМ?</div>' +
      '<div class="st-typing"><i></i><i></i><i></i></div>' +
      '<div class="st-bub ai">У вас 142 000 км, ГРМ міняли на 126 000. Ресурс — 90–120 тис.,' +
      ' тобто ще рано. Наступна черга — близько 216 000 км.</div></div>';
  return '<div class="st-art">' +
    '<div class="st-doc"><b>Звіт про догляд</b>' +
    '<div class="st-row"><span>Записів обслуговування</span><b>12</b></div>' +
    '<div class="st-row"><span>Вкладено</span><b>38 400 ₴</b></div>' +
    '<div class="st-row"><span>Книжка ведеться з</span><b>2024</b></div></div></div>';
}

function drawTour() {
  var el = $('#s-tour');
  var i = Math.min(STORY, STORIES.length - 1);
  var s = STORIES[i];

  el.innerHTML =
    '<div class="st-wrap">' +
      '<div class="st-bars">' + STORIES.map(function (_, n) {
        return '<i class="' + (n < i ? 'done' : n === i ? 'on' : '') + '"></i>';
      }).join('') + '</div>' +

      '<div class="st-top"><span class="st-tag">' + esc(s.tag) + '</span>' +
        (s.last ? '' : '<button class="st-skip" data-do="tourDone">Пропустити</button>') + '</div>' +

      '<div class="st-body">' +
        '<h2>' + esc(s.t).replace(/\n/g, '<br>') + '</h2>' +
        '<p>' + esc(s.p) + '</p>' +
        storyArt(s.art) +
        (s.fact ? '<div class="st-fact">' + esc(s.fact) + '</div>' : '') +
      '</div>' +

      '<div class="st-tap left" data-do="storyBack"></div>' +
      '<div class="st-tap right" data-do="storyNext"></div>' +
      '<div class="st-foot">' +
        (i > 0 ? '<button class="st-back" data-do="storyBack">' + ic('back', 18) + '</button>' : '') +
        '<button class="btn" data-do="' + (s.last ? 'tourDone' : 'storyNext') + '">' +
          (s.last ? 'Додати своє авто' : 'Далі') + '</button>' +
      '</div>' +
      (s.last ? '<div class="note" style="text-align:center;margin-top:8px">' +
                'Займе хвилину. VIN не обовʼязковий.</div>' : '') +
    '</div>';
}

function drawHome() {
  var el = $('#s-home');
  var ac = activeCar();
  if (!S.cars.length) {
    el.innerHTML =
      '<div class="card" style="margin-top:14px">' +
        '<div style="font-family:var(--disp);font-weight:800;font-size:19px;letter-spacing:-.02em">Вітаю в Бардачку</div>' +
        '<p style="color:var(--mut);font-size:13.5px;line-height:1.55;margin:9px 0 16px">' +
          'Додайте авто — і я візьму на себе страховку, техобслуговування та штрафи. ' +
          'Це займе хвилину, VIN не обов’язковий.</p>' +
        '<button class="btn" data-do="addCar">Додати авто</button>' +
      '</div>' +
      '<div class="note">Дані зберігаються тільки для вас і прив’язані до вашого Telegram.</div>';
    return;
  }

  var car = activeCar();
  var att = attention();
  var sp = spend(car.id, 30);
  var isEV = car.fuel === 'electric';

  var h = '';

  if (S.cars.length > 1) {
    h += '<div class="carswitch">' + S.cars.map(function (c) {
      return '<button class="' + (c.id === car.id ? 'on' : '') + '" data-do="pickCar" data-id="' + c.id + '">' +
             esc(carName(c)) + '</button>';
    }).join('') + '</div>';
  }

  var bodyKind = car.body || (guessCar(car.make, car.model).body) || 'sedan';
  var specs = [car.year, FUEL_UA[car.fuel],
      (isEV ? (car.battery ? car.battery + ' кВт·год' : '') : (car.engine ? (car.engine / 1000).toFixed(1) + ' л' : '')),
      car.body ? BODY_UA[car.body] : ''].filter(Boolean);
  var stale = car.odoDate ? daysBetween(car.odoDate, today()) : 999;

  h += '<div class="carcard' + (isEV ? ' ev' : '') + '">' +
    silSvg(bodyKind, '#0E1207', isEV ? '#9BE7C4' : '#D7FF3E') +
    '<div class="cc-top">' +
      (car.plate ? '<span class="plate">' + esc(car.plate) + '</span>' : '<span></span>') +
      '<button class="cc-go" data-do="editThis" aria-label="Змінити авто">' + ic('wrench', 15) + '</button>' +
    '</div>' +
    '<h3>' + esc(carName(car)) + '</h3>' +
    '<div class="cc-specs">' + specs.map(function (x) {
      return '<span>' + esc(x) + '</span>';
    }).join('') + '</div>' +
    '<div class="odo">' +
      '<div><small>ПРОБІГ' + (stale >= 21 ? ' · давно не оновлювали' : '') + '</small>' +
      '<b>' + nfmt(car.odo) + ' <span style="font-size:13px;opacity:.6">км</span></b></div>' +
      '<button class="cc-odo" data-do="odo">' + ic('plus', 16) + 'Оновити</button>' +
    '</div>' +
    '</div>';

  h += '<div class="h2">Потребує уваги' + (att.length ? '<span class="act">' + att.length + '</span>' : '') + '</div>';
  if (!att.length) {
    h += '<div class="alert ok"><div class="ic">' + ic('check',18) + '</div><div class="bd"><b>Усе під контролем</b>' +
         '<p>Найближчим часом нічого не горить. Я попереджу заздалегідь.</p></div></div>';
  } else {
    h += att.map(function (a) {
      return '<div class="alert ' + (a.lvl === 'hot' ? 'hot' : '') + '" data-go="' + a.go + '">' +
        '<div class="ic">' + ic(a.ic, 19) + '</div><div class="bd"><b>' + esc(a.t) + '</b><p>' + esc(a.p) + '</p></div>' +
        '<div class="dd">' + esc(a.d) + '</div></div>';
    }).join('');
  }

  h += '<div class="h2">Швидко</div><div class="quick">' +
    '<button data-do="fuel">' + ic(isEV ? 'charge' : 'fuel', 21) + (isEV ? 'Зарядка' : 'Заправка') + '</button>' +
    '<button data-do="service">' + ic('wrench',21) + 'Ремонт</button>' +
    '<button data-go="tab:s-docs">' + ic('doc',21) + 'Документи</button>' +
    '<button data-do="expense">' + ic('plus',21) + 'Витрата</button>' +
    '</div>';

  var nt = CFG.notice;
  if (nt && !seen('nt_' + nt.id)) {
    h = '<div class="notice ' + esc(nt.kind || 'info') + '" data-do="noticeOpen">' +
      '<div class="nt-ic">' + ic(nt.kind === 'warn' ? 'alert' : 'star', 17) + '</div>' +
      '<div class="tx">' + (nt.title ? '<b>' + esc(nt.title) + '</b>' : '') +
      '<p>' + esc(nt.text) + '</p></div>' +
      '<div class="nt-go">' + ic('back', 15) + '</div></div>' + h;
  }

  var nd = nudges(car);
  if (nd.length) {
    h += '<div class="h2">Щоб рахувало точніше</div>' + nd.map(function (n) {
      return '<div class="nudge">' +
        '<div class="tx"><b>' + esc(n.t) + '</b><p>' + esc(n.p) + '</p></div>' +
        '<button class="chip gh"' + (n.do ? ' data-do="' + n.do + '"' : ' data-go="' + n.go + '"') + '>' +
        esc(n.btn) + '</button></div>';
    }).join('');
  }

  h += '<div class="askcard" data-go="tab:s-ask">' +
    '<div class="askcard-ic">' + ic('chat', 20) + '</div>' +
    '<div class="tx"><b>Спитати про авто</b>' +
    '<p>' + (PRO ? 'Стукає, гріється, не заводиться — відповім з вашою книжкою перед очима'
                 : 'Помічник знає ваш ' + esc(carName(car)) + '. Відкрийте в Преміумі') + '</p></div>' +
    '<div class="go">' + ic('back', 16) + '</div></div>';

  var pctFuel = sp.total > 0 ? sp.fuel / sp.total : 0;
  h += '<div class="h2">Витрати за 30 днів<span class="act" data-go="tab:s-money">детально</span></div>' +
    '<div class="card"><div class="ring"><div class="v"><b>' + money(sp.total) + '</b>' +
    '<small>' + (sp.total ? (isEV ? 'зарядка' : 'паливо') + ' — ' + Math.round(pctFuel * 100) + '% від суми' : 'поки що записів немає') + '</small></div>' +
    ringSvg(pctFuel, '#D7FF3E') + '</div></div>';

  el.innerHTML = h;
}

/* ---------- ШТРАФИ ---------- */
function drawFines() {
  var el = $('#s-fines');
  var list = (S.fines || []).slice();
  var unpaid = list.filter(function (f) { return !f.paid; });
  var h = '';

  var hot = unpaid.filter(function (f) { return f.half && daysLeft(f.until) !== null && daysLeft(f.until) >= 0; })
                  .sort(function (a, b) { return daysLeft(a.until) - daysLeft(b.until); })[0];

  if (hot) {
    var d = daysLeft(hot.until);
    h += '<div class="count"><div class="lb">Знижка 50% спливає через</div>' +
      '<b>' + d + '</b><div class="sb">' + dayWord(d) + ' · до ' + fmtDate(hot.until) + '</div>' +
      '<div class="pair"><s>' + money(hot.amount) + '</s><strong>' + money(hot.amount / 2) + '</strong></div>' +
      '<button class="btn" style="margin-top:15px" data-do="payFine" data-id="' + hot.id + '">Позначити сплаченим</button>' +
      '</div>';
    h += '<div class="note">Знижка 50% діє лише на штрафи з камер автофіксації і лише 10 банківських днів. ' +
         'На постанови від патрульного вона не поширюється.</div>';
  } else if (unpaid.length) {
    h += '<div class="msg inf">Є несплачені штрафи без знижки. Сплатіть протягом 30 днів, щоб не було пені.</div>';
  } else {
    h += '<div class="alert ok"><div class="ic">' + ic('check',18) + '</div><div class="bd"><b>Несплачених немає</b>' +
         '<p>Перевіряйте штрафи раз на тиждень — знижка діє недовго.</p></div></div>';
  }

  h += '<button class="btn sec" style="margin-top:11px" data-do="fine">Додати штраф</button>';
  h += '<a class="btn sec" href="https://diia.gov.ua" target="_blank" rel="noopener" style="text-decoration:none">Перевірити в Дії</a>';

  var saved = list.filter(function (f) { return f.paid && f.half; })
                  .reduce(function (a, f) { return a + f.amount / 2; }, 0);
  if (saved > 0) {
    h += '<div class="card" style="margin-top:11px;background:linear-gradient(150deg,#1F2A0B,#141A0A);border:1px solid #2E3D12">' +
      '<div style="font-size:13px;color:var(--ink2)">Зекономлено на знижках</div>' +
      '<div class="num" style="font-size:28px;color:var(--lime);margin-top:4px">' + money(saved) + '</div></div>';
  }

  if (list.length) {
    h += '<div class="h2">Історія</div><div class="card list">' + list.map(function (f) {
      var dd = f.half ? daysLeft(f.until) : null;
      var sub = fmtDate(f.date) + ' · ' + (f.paid ? 'сплачено' :
        (f.half && dd !== null && dd >= 0 ? 'знижка ще ' + dd + ' ' + dayWord(dd) : 'не сплачено'));
      return '<div class="it"><div class="dt">' + ic(f.paid ? 'check' : 'money', 17) + '</div>' +
        '<div class="tx"><b>' + esc(f.title) + '</b><small>' + sub + '</small></div>' +
        '<div class="vl" style="color:' + (f.paid ? 'var(--good)' : 'var(--bad)') + '">' +
        money(f.paid && f.half ? f.amount / 2 : f.amount) + '</div></div>';
    }).join('') + '</div>';
  }

  el.innerHTML = h;
}

/* ---------- СЕРВІС ---------- */
function drawService() {
  var el = $('#s-service');
  if (!S.cars.length) { el.innerHTML = '<div class="empty">Спочатку додайте авто в Гаражі.</div>'; return; }

  var car = activeCar();
  var isEV = car.fuel === 'electric';
  var oil = nextOil(car);
  var h = '';

  if (isEV) {
    h += '<div class="card"><div class="ring"><div class="v"><b>' + (car.soh ? car.soh + '%' : '—') + '</b>' +
      '<small>здоров’я батареї (SOH)</small></div>' + ringSvg(car.soh ? car.soh / 100 : 0, '#3ED598') + '</div>' +
      '<div class="note">Це головна цифра для електрокара: саме вона визначає ціну при перепродажі. ' +
      'Дані беруться з діагностики — оновіть після кожної перевірки.</div>' +
      '<button class="btn sec" style="margin-top:12px" data-do="editCar" data-id="' + car.id + '">Оновити SOH</button></div>';
  } else if (oil) {
    var pct = Math.max(0, Math.min(1, 1 - oil.left / oil.interval));
    h += '<div class="card"><div class="ring"><div class="v"><b>' +
      (oil.left > 0 ? nfmt(oil.left) + ' км' : 'Пора міняти') + '</b>' +
      '<small>' + (oil.left > 0 ? 'до заміни масла · кожні ' + nfmt(oil.interval) + ' км'
                                : 'прострочено на ' + nfmt(-oil.left) + ' км') + '</small></div>' +
      ringSvg(pct, oil.left <= 0 ? '#FF5A4A' : (pct > 0.85 ? '#FFB340' : '#D7FF3E')) + '</div></div>';
  } else {
    h += '<div class="msg inf">Внесіть заміну масла — і я рахуватиму, коли наступна.</div>';
  }

  h += '<div class="grid2" style="margin-top:11px">' +
    '<button class="btn sec" data-do="odo">Пробіг</button>' +
    '<button class="btn" data-do="service">Додати запис</button></div>';

  var recs = (S.service || []).filter(function (r) { return r.carId === car.id; });
  loadWeather(function () {
    if (TAB === 's-service' && WX) { DIRTY['s-service'] = 0; drawService(); }
  });
  h += weatherCard(car);
  h += seasonCard(car);

  h += '<div class="h2">Сервісна книжка' + (recs.length ? '<span class="act">' + recs.length + '</span>' : '') + '</div>';
  if (!recs.length) {
    h += '<div class="empty">Порожньо. Кожен запис — це плюс до ціни при продажу: покупець бачить, що авто доглядали.</div>';
  } else {
    h += '<div class="card list">' + recs.map(function (r) {
      return '<button class="it" data-do="delAsk" data-id="' + r.id + '"><div class="dt">' + ic(KIND_IC[r.kind] || 'wrench', 17) + '</div>' +
        '<div class="tx"><b>' + esc(r.title) + '</b><small>' + nfmt(r.odo) + ' км · ' + fmtDate(r.date) + '</small></div>' +
        '<div class="vl">' + (r.cost ? money(r.cost) : '—') + '</div></button>';
    }).join('') + '</div>';

    h += '<div class="promo" style="margin-top:12px"><b>Продаєте авто? <em>Це ваш козир.</em></b>' +
      '<p>Підтверджена історія обслуговування знімає половину питань покупця й тримає ціну.</p>' +
      '<button class="btn sec" data-go="tab:s-report">Звіт для покупця</button></div>';
  }

  el.innerHTML = h;
}

/* ---------- ВИТРАТИ ---------- */
var PERIOD = 30;
var PERIODS = [[7, 'Тиждень'], [30, 'Місяць'], [365, 'Рік'], [0, 'Усе']];

/* Скільки виходило щомісяця — для стовпчиків */
function spendMonths(carId, n) {
  var out = [], now = new Date();
  for (var i = n - 1; i >= 0; i--) {
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    var from = d.toISOString().slice(0, 7);
    out.push({ key: from, label: MONTHS_SHORT[d.getMonth()], total: 0, fuel: 0 });
  }
  var idx = {};
  out.forEach(function (r) { idx[r.key] = r; });

  function add(arr, field) {
    (arr || []).forEach(function (r) {
      if (r.carId !== carId || !r.date) return;
      var k = String(r.date).slice(0, 7);
      if (!idx[k]) return;
      idx[k].total += costUah(r);
      if (field) idx[k][field] += costUah(r);
    });
  }
  add(S.fuel, 'fuel'); add(S.service, null); add(S.exp, null);
  (S.fines || []).forEach(function (f) {
    if (f.carId !== carId || !f.paid || !f.date) return;
    var k = String(f.date).slice(0, 7);
    if (idx[k]) idx[k].total += f.half ? f.amount / 2 : f.amount;
  });
  return out;
}

var MONTHS_SHORT = ['січ','лют','бер','кві','тра','чер','лип','сер','вер','жов','лис','гру'];

function chartBars(rows) {
  var max = Math.max.apply(null, rows.map(function (r) { return r.total; }).concat([1]));
  return '<div class="chart">' + rows.map(function (r, i) {
    var pct = Math.max(2, Math.round(r.total / max * 100));
    var last = i === rows.length - 1;
    return '<div class="col' + (last ? ' on' : '') + '">' +
      '<div class="colv"><i style="height:' + pct + '%"></i></div>' +
      '<span>' + r.label + '</span></div>';
  }).join('') + '</div>';
}

function drawMoney() {
  var el = $('#s-money');
  if (!S.cars.length) { el.innerHTML = '<div class="empty">Спочатку додайте авто в Гаражі.</div>'; return; }

  var car = activeCar();
  var isEV = car.fuel === 'electric';
  loadBench(car, function () {
    if (TAB === 's-money' && BENCH) { DIRTY['s-money'] = 0; drawMoney(); }
  });

  var days = PERIOD || 100000;
  var cur = spend(car.id, days);
  var prev = PERIOD ? spend2(car.id, days, days) : null;
  var diff = prev && prev.total > 0 ? (cur.total - prev.total) / prev.total * 100 : null;

  var h = '<div class="pills">' + PERIODS.map(function (p) {
    return '<button data-do="period" data-v="' + p[0] + '"' +
      (PERIOD === p[0] ? ' class="on"' : '') + '>' + p[1] + '</button>';
  }).join('') + '</div>';

  /* головна плитка */
  h += '<div class="hero">' +
    '<div class="hero-top"><span>' +
      (PERIOD === 7 ? 'За тиждень' : PERIOD === 30 ? 'За місяць' : PERIOD === 365 ? 'За рік' : 'За весь час') +
    '</span>' + (isEV ? ic('charge', 18) : ic('fuel', 18)) + '</div>' +
    '<b>' + money(cur.total) + '</b>' +
    (diff !== null
      ? '<small>' + (diff > 0 ? '+' : '') + Math.round(diff) + '% до попереднього ' +
        (PERIOD === 7 ? 'тижня' : PERIOD === 30 ? 'місяця' : 'року') + '</small>'
      : '<small>' + (cur.total ? 'усе, що внесено' : 'поки що записів немає') + '</small>') +
    '</div>';

  /* стовпчики за пів року */
  var mm = spendMonths(car.id, 6);
  if (mm.some(function (r) { return r.total > 0; })) {
    h += '<div class="card"><div class="card-h"><b>Помісячно</b>' +
      '<span>' + money(mm.reduce(function (a, r) { return a + r.total; }, 0) / 6) + ' у середньому</span></div>' +
      chartBars(mm) + '</div>';
  }

  /* плитки */
  var tiles = [
    [isEV ? 'Зарядка' : 'Паливо', cur.fuel],
    ['Сервіс', cur.service],
    ['Штрафи', cur.fines],
    ['Інше', cur.other],
  ].filter(function (t) { return t[1] > 0; })
   .sort(function (a, b) { return b[1] - a[1]; });      // найбільша стаття — першою

  if (tiles.length) {
    h += '<div class="tiles">' + tiles.map(function (t, i) {
      return '<div class="tile' + (i === 0 ? ' acc' : '') + '"><small>' + t[0] + '</small>' +
        '<b>' + money(t[1]) + '</b>' +
        '<i>' + Math.round(t[1] / cur.total * 100) + '%</i></div>';
    }).join('') + '</div>';
  }

  /* витрата пального */
  var cons = consumption(car.id);
  if (cons) {
    h += '<div class="card"><div class="card-h"><b>Витрата</b>' +
      '<span>за ' + nfmt(cons.dist) + ' км</span></div>' +
      '<div class="two-num">' +
        '<div><small>у середньому</small><b>' + cons.per100.toFixed(1) + '</b></div>' +
        '<div><small>останній ' + (isEV ? 'заряд' : 'бак') + '</small><b>' + cons.last.toFixed(1) + '</b></div>' +
      '</div>' +
      (cons.perKm ? '<div class="kv"><span>' + (isEV ? 'Зарядка' : 'Паливо') +
        ' на кілометр</span><b>' + cons.perKm.toFixed(2) + ' ₴</b></div>' : '') +
      '</div>';
  } else if ((S.fuel || []).filter(function (r) { return r.carId === car.id; }).length) {
    h += '<div class="note">Витрату порахую, коли будуть дві заправки «' +
         (isEV ? 'до 100%' : 'повний бак') + '» поспіль — між ними видно, скільки саме пішло.</div>';
  }

  /* вартість володіння */
  var own = ownership(car.id);
  if (own) {
    h += '<div class="card"><div class="card-h"><b>Скільки коштує це авто</b>' +
      (own.short ? '<span>записів ще мало</span>' : '') + '</div>' +
      '<div class="two-num">' +
        '<div><small>' + (own.short ? 'за ' + own.days + ' ' + dayWord(own.days) : 'на місяць') + '</small><b>' +
          money(own.short ? own.total : own.perMonth) + '</b></div>' +
        '<div><small>' + (own.perKm ? 'кілометр' : 'усього') + '</small><b>' +
          (own.perKm ? own.perKm.toFixed(2) + ' ₴' : money(own.total)) + '</b></div>' +
      '</div>' +
      (own.kmPerMonth && !own.short ? '<div class="kv"><span>Пробіг за місяць</span><b>' +
        nfmt(own.kmPerMonth) + ' км</b></div>' : '') +
      '<div class="kv"><span>Рахую від</span><b>' + fmtDate(own.since) + '</b></div>' +
      '<div class="note" style="margin:10px 0 0">Сюди входить усе: паливо, ремонти, ' +
      'страховка, мийки й сплачені штрафи.</div></div>';
  }

  var fc = forecast(car.id);
  if (fc.length) {
    h += '<div class="h2">Найближчим часом</div><div class="card list">' + fc.map(function (f) {
      return '<div class="it" style="cursor:default"><div class="dt">' +
        ic(f.d <= 14 ? 'alert' : 'check', 17) + '</div>' +
        '<div class="tx"><b>' + esc(f.t) + '</b><small>' + esc(f.when) + '</small></div>' +
        (f.cost ? '<div class="vl">≈ ' + money(f.cost) + '</div>' : '') + '</div>';
    }).join('') + '</div>' +
    '<div class="note">Суми приблизні — за середніми цінами в Україні.</div>';
  }

  h += benchCard(car);

  h += '<div class="card" style="margin-top:11px"><div class="card-h"><b>Звіт про витрати</b>' +
    '<span>PDF у чат бота</span></div>' +
    '<p style="margin:0 0 12px;font-size:12.5px;color:var(--mut);line-height:1.5">' +
    'Куди пішли гроші за рік: помісячно, за статтями, найбільші витрати. ' +
    'Зручно, коли треба показати комусь або просто побачити картину.</p>' +
    '<button class="btn" data-do="moneyReport">Зібрати PDF' + (PRO ? '' : lockIc()) + '</button></div>';

  h += '<div class="grid2" style="margin-top:11px">' +
    '<button class="btn sec" data-do="fuel">' + (isEV ? 'Зарядка' : 'Заправка') + '</button>' +
    '<button class="btn sec" data-do="expense">Інша витрата</button></div>';

  var ex = (S.exp || []).filter(function (r) { return r.carId === car.id; });
  if (ex.length) {
    h += '<div class="h2">Інші витрати</div><div class="card list">' + ex.slice(0, 15).map(function (r) {
      return '<button class="it" data-do="delAsk" data-id="' + r.id + '">' +
        '<div class="dt">' + ic(CAT_IC[r.cat] || 'plus', 17) + '</div>' +
        '<div class="tx"><b>' + esc(r.title) + '</b><small>' + (CAT_UA[r.cat] || 'Інше') +
          ' · ' + fmtDate(r.date) + '</small></div>' +
        '<div class="vl">' + amt(r) + '</div></button>';
    }).join('') + '</div>';
  }

  var fr = (S.fuel || []).filter(function (r) { return r.carId === car.id; });
  h += '<div class="h2">' + (isEV ? 'Зарядки' : 'Заправки') + '</div>';
  if (!fr.length) {
    h += '<div class="empty">Ще нічого не внесено.</div>';
  } else {
    h += '<div class="card list">' + fr.slice(0, 20).map(function (r) {
      return '<button class="it" data-do="delAsk" data-id="' + r.id + '">' +
        '<div class="dt">' + ic(isEV ? 'charge' : 'fuel', 17) + '</div>' +
        '<div class="tx"><b>' + (r.qty ? r.qty + ' ' + (r.unit === 'kwh' ? 'кВт·год' : 'л') : 'Заправка') + '</b>' +
        '<small>' + fmtDate(r.date) + (r.station ? ' · ' + esc(r.station) : '') +
          (r.odo ? ' · ' + nfmt(r.odo) + ' км' : '') + (r.full === false ? ' · не повний' : '') + '</small></div>' +
        '<div class="vl">' + amt(r) + '</div></button>';
    }).join('') + '</div>';
  }

  el.innerHTML = h;
}

/* витрати за попередній такий самий відрізок — щоб було з чим порівняти */
function spend2(carId, days, back) {
  var to = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
  var from = new Date(Date.now() - (back + days) * 86400000).toISOString().slice(0, 10);
  var t = 0;
  ['fuel', 'service', 'exp'].forEach(function (k) {
    (S[k] || []).forEach(function (r) {
      if (r.carId === carId && r.date >= from && r.date < to) t += costUah(r);
    });
  });
  (S.fines || []).forEach(function (f) {
    if (f.carId === carId && f.paid && f.date >= from && f.date < to)
      t += f.half ? f.amount / 2 : f.amount;
  });
  return { total: t };
}

/* ---------- ЩЕ ---------- */
function drawMore() {
  var el = $('#s-more');
  var h = '';

  if (!PRO) {
    h += '<div class="promo"><b>Бардачок <em>Преміум</em></b>' +
      '<p>Голосове внесення, питання про своє авто, кілька машин, звіти для покупця та перевірки. ' +
      'Один вчасно спійманий штраф уже окупає місяць.</p>' +
      '<div class="plans">' +
        '<button data-do="buy" data-plan="month"><small>Місяць</small><b>' + usd(CFG.premiumMonth) + '</b>' +
          '<em>' + uahOf(CFG.premiumMonth) + '</em></button>' +
        '<button data-do="buy" data-plan="half"><small>Півроку</small><b>' + usd(CFG.premiumHalf) + '</b>' +
          '<em>' + uahOf(CFG.premiumHalf) + '</em></button>' +
        '<button class="best" data-do="buy" data-plan="year"><small>Рік</small><b>' + usd(CFG.premiumYear) + '</b>' +
          '<em>' + uahOf(CFG.premiumYear) + '</em></button>' +
      '</div></div>';
  } else {
    h += '<div class="promo"><b>Преміум <em>активний</em></b>' +
      '<p>Діє до ' + fmtDate(S.premiumUntil) + '. Голосове внесення й питання про авто увімкнені.</p></div>';
  }

  h += '<div class="h2">Інструменти</div><div class="card list">' +
    itemBtn('search', 'Перевірка по VIN', 'Що це за авто насправді', 'tab:s-vin') +
    itemBtn('idcard', 'Пошук за номером', 'Марка, рік, обʼєм за реєстром', 'tab:s-plate', !PRO) +
    itemBtn('chat', 'Голосове внесення', 'Надиктували боту — записалось', 'tab:s-voice', !PRO) +
    itemBtn('chat', 'Питання про авто', 'Стукає, гріється, не заводиться', 'tab:s-ask', !PRO) +
    itemBtn('alert', 'Нагадування', 'ГРМ, техогляд, що завгодно', 'tab:s-rem') +
    itemBtn('doc', 'Документи', 'Техпаспорт, страховка, права', 'tab:s-docs') +
    itemBtn('doc', 'Звіт для покупця', 'PDF із сервісною книжкою', 'tab:s-report', !PRO) +
    itemBtn('crash', 'Що робити при ДТП', 'Покроково, без паніки', 'tab:s-crash') +
    itemBtn('car', 'Мої авто', S.cars.length + ' ' + plural(S.cars.length, 'авто', 'авто', 'авто'), 'tab:s-cars') +
    '</div>';


  h += '<div class="promo" style="margin-top:12px">' +
    '<b>Передайте далі — <em>і місяць ваш</em></b>' +
    '<p>За кожного, хто приєднається за вашим посиланням, вам +30 днів Преміуму. ' +
    'Одразу і без умов. Скільки людей — стільки й місяців.</p>' +
    (REF.count
      ? '<div class="kv" style="border:0;padding:0 0 12px"><span>Уже привели</span><b>' +
        REF.count + ' ' + plural(REF.count, 'людину', 'людей', 'людей') + ' · +' +
        (REF.count * 30) + ' днів</b></div>'
      : '<div class="kv" style="border:0;padding:0 0 12px"><span>Приведено</span>' +
        '<b>поки нікого</b></div>') +
    (REF.link
      ? '<button class="btn" data-do="share">Надіслати посилання</button>' +
        '<button class="btn sec" data-do="copyRef">Скопіювати</button>'
      : '<div class="note" style="margin:0">Посилання зʼявиться, щойно бота буде підключено.</div>') +
    '</div>';

  h += '<div class="card" style="margin-top:12px"><div class="card-h"><b>Підтримати розробника</b>' +
    '<span>за бажанням</span></div>' +
    '<p style="margin:0 0 12px;font-size:12.5px;color:var(--mut);line-height:1.5">' +
    'Бардачок робить одна людина. Якщо застосунок вам допоміг — можна закинути ' +
    'скільки не шкода. Це не підписка й нічого не відкриває, просто дякую.</p>' +
    '<button class="btn sec" data-do="tip">Закинути на каву</button></div>';

  h += '<div class="note" style="text-align:center;opacity:.5">Версія ' + BUILD + '</div>';

  h += '<div class="note">Бардачок не замінює механіка й не є юридичною консультацією. ' +
       'Дати й суми ви вносите самі — я лише стежу, щоб нічого не забулось.</div>';

  el.innerHTML = h;
}
function itemBtn(name, t, s, go, locked) {
  return '<button class="it" data-go="' + go + '"><div class="dt">' + ic(name, 17) + '</div>' +
    '<div class="tx"><b>' + t + (locked ? lockIc() : '') + '</b>' +
    '<small>' + s + '</small></div><div class="ar">›</div></button>';
}

/* ---------- VIN ---------- */
/* Розкладаємо все, що віддав декодер, по зрозумілих групах.
   Раніше показували чотири рядки з шістдесяти — тепер видно все. */
function vinCard(c, vin) {
  var isEV = c.fuel === 'electric';
  var h = '';

  /* аукціонні знімки — головне, заради чого дивляться VIN битого авто */
  if (c.auction && c.auction.photos && c.auction.photos.length) {
    var a = c.auction;
    h += '<div class="vin-shots">' + a.photos.slice(0, 10).map(function (u, i) {
      return '<img src="' + esc(u) + '" alt="Фото з аукціону ' + (i + 1) + '" loading="lazy">';
    }).join('') + '</div>' +
    '<div class="card"><div class="h3">На аукціоні</div>' +
      kv('Пошкодження', [a.damage, a.damage2].filter(Boolean).join(' + ')) +
      kv('Документ', a.title) +
      kv('Пробіг на торгах', a.odo ? nfmt(a.odo) + ' миль' : '') +
      kv('Ціна продажу', a.price ? '$' + nfmt(a.price) : '') +
      kv('Аукціон', [a.site, a.loc].filter(Boolean).join(', ')) +
      kv('Лот', a.lot) + kv('Дата', a.date) +
    '</div>';
  } else if (c.pic && c.pic.url) {
    h += '<div class="vin-model" style="background-image:url(' + esc(c.pic.url) + ')"></div>' +
         '<div class="vin-credit">Так виглядає ця модель · фото з Вікіпедії</div>';
  }

  if (c.thin)
    h += '<div class="note" style="margin:0 0 10px">Це європейське або азійське авто. ' +
         'Державний реєстр США його не знає, тому марку, країну й рік я визначив ' +
         'за структурою самого VIN. Точні характеристики дивіться в техпаспорті.</div>';

  h += '<div class="card"><div class="h3">Авто</div>' +
    kv('Модель', [c.year, c.make, c.model].filter(Boolean).join(' ')) +
    kv('Комплектація', c.trim) +
    kv('Кузов', (c.bodyCode ? BODY_UA[c.bodyCode] + ' · ' : '') + (c.body || '')) +
    kv('Дверей', c.doors) + kv('Місць', c.seats) +
    kv('Кермо', /right/i.test(c.wheel || '') ? 'Праве' : (c.wheel ? 'Ліве' : '')) +
    '</div>';

  h += '<div class="card"><div class="h3">' + (isEV ? 'Силова установка' : 'Двигун і трансмісія') + '</div>' +
    kv('Паливо', [FUEL_UA[c.fuel] || c.fuelText, c.fuel2].filter(Boolean).join(' + ')) +
    kv('Обʼєм', c.engine ? (c.engine / 1000).toFixed(1) + ' л' : '') +
    kv('Батарея', c.battery ? c.battery + ' кВт·год' : '') +
    kv('Потужність', c.hp ? Math.round(parseFloat(c.hp)) + ' к.с.' : '') +
    kv('Циліндрів', [c.cyl, c.engCfg].filter(Boolean).join(', ')) +
    kv('Індекс двигуна', c.engModel) +
    kv('Коробка', c.trans) + kv('Привід', c.drive) +
    '</div>';

  var extra = [];
  if (c.safety && c.safety.length) extra.push(kv('Системи', c.safety.join(', ')));
  if (c.airbags && c.airbags.length) extra.push(kv('Подушки', c.airbags.join(', ')));
  if (extra.filter(Boolean).length)
    h += '<div class="card"><div class="h3">Безпека</div>' + extra.join('') + '</div>';

  h += '<div class="card"><div class="h3">Походження</div>' +
    kv('Виробник', c.maker) +
    kv('Завод', [c.plant, c.country].filter(Boolean).join(' · ')) +
    kv('Клас маси', c.gvwr) +
    '</div>';

  if (c.note) h += '<div class="note">Увага: ' + esc(c.note) + '. Перевірте, чи правильно переписаний VIN.</div>';
  if (!PRO)
    h += '<div class="promo"><b>У Преміумі — <em>більше</em></b>' +
         '<p>Фото з американського аукціону, характер пошкоджень, пробіг і ціна на торгах — ' +
         'якщо авто приїхало звідти.</p>' +
         '<button class="btn" data-go="tab:s-more">Дивитись Преміум</button></div>';

  h += '<button class="btn sec" style="margin-top:10px" data-do="vinToCar">Додати це авто в гараж</button>';
  return h;
}

function drawVin() {
  var left = CFG.vinLeft;
  var unlimited = (left === null || left === undefined);

  $('#s-vin').innerHTML =
    '<div class="card">' +
      '<div class="chat-head" style="padding:0 0 12px">' +
        '<div class="ic-box">' + ic('search', 20) + '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<b style="display:block;font-size:15px;font-weight:700">Перевірка по VIN</b>' +
          '<small style="color:var(--mut);font-size:12px">' +
            (unlimited ? 'без обмежень' :
              (left > 0 ? 'залишилось ' + left + ' ' + plural(left, 'безкоштовна', 'безкоштовні', 'безкоштовних') + ' ' +
                          plural(left, 'перевірка', 'перевірки', 'перевірок')
                        : 'безкоштовні вичерпані')) + '</small>' +
        '</div></div>' +
      '<p style="margin:0 0 13px;font-size:12.5px;color:var(--mut);line-height:1.5">' +
        'Марка, рік, тип кузова, двигун і паливо — з державного декодера. ' +
        'Корисно перед купівлею: видно, чи збігається реальність із оголошенням.</p>' +
      '<div class="field"><input id="vinIn" type="text" placeholder="17 символів" maxlength="20" autocomplete="off"></div>' +
      '<button class="btn" data-do="vinGo">Перевірити</button>' +
    '</div>' +
    '<div id="vinOut"></div>' +
    (unlimited || left > 0 ? '' :
      '<div class="promo" style="margin-top:11px"><b>Потрібно більше <em>перевірок</em></b>' +
      '<p>У Преміумі перевірок необмежено — плюс голосове внесення й помічник.</p>' +
      '<button class="btn" data-go="tab:s-more">Дивитись Преміум</button></div>') +
    '<div class="note">Дані про власника — персональні, у відкритому доступі їх немає. ' +
    'Перевірка показує саме авто.</div>';
}

/* ---------- ПОМІЧНИК (чат) ---------- */
var CHAT = [];          // {role:'u'|'a', text}
var CHAT_BUSY = false;

var CHAT_HINTS = [
  'Що означає помилка P0420?',
  'Стукає спереду на 80 км/год',
  'Коли міняти ремінь ГРМ?',
  'Скільки коштує заміна колодок?',
  'Чи можна їхати з цим далі?',
];

function drawAsk() {
  var car = activeCar();
  var el = $('#s-ask');

  var head =
    '<div class="chat-head">' +
      '<div class="ic-box">' + ic('chat', 20) + '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<b style="display:block;font-size:15px;font-weight:700">Помічник</b>' +
        '<small style="color:var(--mut);font-size:12px">' +
          (car ? 'знає ваш ' + esc(carName(car)) + (car.odo ? ' · ' + nfmt(car.odo) + ' км' : '')
               : 'додайте авто, щоб відповіді були точнішими') + '</small>' +
      '</div>' +
      (CHAT.length ? '<button class="chat-clear" data-do="chatClear">Очистити</button>' : '') +
    '</div>';

  var body;
  if (!CHAT.length) {
    body = '<div class="chat-empty">' +
      '<p>Опишіть, що не так — коли зʼявляється, на якій швидкості, який звук. ' +
      'Або спитайте про строки обслуговування чи код помилки.</p>' +
      '<div class="hints">' + CHAT_HINTS.map(function (h) {
        return '<button class="hint" data-do="chatHint" data-q="' + esc(h) + '">' + esc(h) + '</button>';
      }).join('') + '</div></div>';
  } else {
    body = '<div class="chat" id="chatBox">' + CHAT.map(function (m) {
      return '<div class="bub ' + (m.role === 'u' ? 'me' : 'ai') + '">' +
        (m.role === 'a' ? mdLite(m.text) : esc(m.text)) + '</div>';
    }).join('') +
    (CHAT_BUSY ? '<div class="bub ai typing"><i></i><i></i><i></i></div>' : '') +
    '</div>';
  }

  var bar =
    '<div class="chat-bar">' +
      '<textarea id="askIn" rows="1" placeholder="Напишіть питання…"></textarea>' +
      '<button class="send" data-do="askGo"' + (CHAT_BUSY ? ' disabled' : '') + '>' +
        '<svg viewBox="0 0 24 24" width="20" height="20" class="icn"><path d="M4 12 20 4l-4 8 4 8-16-8Z"/></svg>' +
      '</button>' +
    '</div>';

  el.innerHTML = head + body + bar +
    (PRO ? '' : '<div class="note">Питання про авто — у Преміумі. Напишіть — покажу, що це дає.</div>') +
    '<div class="note">Це підказка, а не діагноз — механік бачить авто, я ні.</div>';

  var box = document.getElementById('chatBox');
  if (box) box.scrollTop = box.scrollHeight;
  autoGrow();
}

/* Мінімальне форматування відповіді: списки, жирний, абзаци. */
function mdLite(t) {
  var out = esc(t);
  out = out.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  out = out.replace(/^\s*[-•]\s+/gm, '· ');
  out = out.replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
  return out;
}

function autoGrow() {
  var t = document.getElementById('askIn');
  if (!t) return;
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 120) + 'px';
  t.oninput = function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  };
  t.onkeydown = function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); DO.askGo(); }
  };
}

/* ------------------------------------------------------------------ */
/* ЗВІТ ДЛЯ ПОКУПЦЯ                                                    */
/* ------------------------------------------------------------------ */
/* Малюємо сторінки А4 на canvas (щоб кирилиця виглядала як у книжці),
   відправляємо на сервер, а він складає PDF і кидає файлом у чат бота. */

var RP_W = 1240, RP_H = 1754, RP_M = 92;   // 150 dpi

function rpStats(carId) {
  var srv = (S.service || []).filter(function (r) { return r.carId === carId; })
                             .sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
  var fuel = (S.fuel || []).filter(function (r) { return r.carId === carId; });
  var exp  = (S.exp  || []).filter(function (r) { return r.carId === carId; });

  var spentSrv = srv.reduce(function (a, r) { return a + costUah(r); }, 0);
  var spentAll = spentSrv + fuel.reduce(function (a, r) { return a + costUah(r); }, 0) +
                            exp.reduce(function (a, r) { return a + costUah(r); }, 0);

  var dates = srv.map(function (r) { return r.date; })
    .concat(fuel.map(function (r) { return r.date; }))
    .concat(exp.map(function (r) { return r.date; }))
    .filter(Boolean).sort();

  var qty = fuel.reduce(function (a, r) { return a + (r.qty || 0); }, 0);
  return { srv: srv, fuel: fuel, exp: exp, spentSrv: spentSrv, spentAll: spentAll,
           since: dates[0] || null, qty: qty, cons: consumption(carId) };
}

function rpPages(car) {
  var st = rpStats(car.id);
  var isEV = car.fuel === 'electric';
  var pages = [], cv = null, x = null, y = 0, pageNo = 0;

  function newPage() {
    cv = document.createElement('canvas');
    cv.width = RP_W; cv.height = RP_H;
    x = cv.getContext('2d');
    x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, RP_W, RP_H);
    x.textBaseline = 'alphabetic';
    pages.push(cv); pageNo++;

    x.fillStyle = '#0F1310'; x.fillRect(0, 0, RP_W, 132);
    x.fillStyle = '#D7FF3E'; x.font = '800 32px Unbounded, sans-serif';
    x.fillText('БАРДАЧОК', RP_M, 80);
    x.fillStyle = '#8A9382'; x.font = '600 22px "IBM Plex Sans", sans-serif';
    var t = 'ЗВІТ ПРО ДОГЛЯД ЗА АВТО';
    x.fillText(t, RP_W - RP_M - x.measureText(t).width, 78);
    y = 132 + 78;
  }

  function room(need) { if (y + need > RP_H - 190) newPage(); }  // 190 — місце під підпис і колонтитул

  function h1(t) {
    room(90); x.fillStyle = '#0F1310'; x.font = '800 52px Unbounded, sans-serif';
    x.fillText(t, RP_M, y); y += 22;
  }
  function h2(t, need) {
    room((need || 110) + 26); y += 26;
    x.fillStyle = '#5B6455'; x.font = '700 21px "IBM Plex Sans", sans-serif';
    x.fillText(t.toUpperCase(), RP_M, y); y += 16;
    x.fillStyle = '#E4E8DE'; x.fillRect(RP_M, y, RP_W - RP_M * 2, 2); y += 40;
  }
  function para(t, size, color) {
    x.fillStyle = color || '#3C443A';
    x.font = '400 ' + (size || 24) + 'px "IBM Plex Sans", sans-serif';
    var words = String(t).split(' '), line = '', max = RP_W - RP_M * 2;
    words.forEach(function (w) {
      var tryLine = line ? line + ' ' + w : w;
      if (x.measureText(tryLine).width > max) { room(40); x.fillText(line, RP_M, y); y += (size || 24) + 12; line = w; }
      else line = tryLine;
    });
    if (line) { room(40); x.fillText(line, RP_M, y); y += (size || 24) + 12; }
  }
  function clip(t, max) {
    x.font = '400 24px "IBM Plex Sans", sans-serif';
    t = String(t == null ? '' : t);
    if (x.measureText(t).width <= max) return t;
    while (t.length > 1 && x.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t + '…';
  }
  function rrect(a, b, w, hh, r) {
    x.beginPath();
    x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + hh, r);
    x.arcTo(a + w, b + hh, a, b + hh, r); x.arcTo(a, b + hh, a, b, r);
    x.arcTo(a, b, a + w, b, r); x.closePath();
  }
  function rows(items) {
    items.forEach(function (it) {
      room(48);
      x.fillStyle = '#5B6455'; x.font = '400 24px "IBM Plex Sans", sans-serif';
      x.fillText(it[0], RP_M, y + 26);
      x.fillStyle = '#0F1310'; x.font = '600 24px "IBM Plex Sans", sans-serif';
      x.fillText(it[1], RP_W - RP_M - x.measureText(it[1]).width, y + 26);
      x.fillStyle = '#EFF2EB'; x.fillRect(RP_M, y + 43, RP_W - RP_M * 2, 1);
      y += 46;
    });
  }
  function cells(items) {
    var colW = (RP_W - RP_M * 2 - 20) / 2, cellH = 118;
    for (var i = 0; i < items.length; i += 2) {
      room(cellH + 16);
      for (var j = 0; j < 2 && items[i + j]; j++) {
        var it = items[i + j], cx = RP_M + j * (colW + 20);
        x.fillStyle = '#F5F7F2'; rrect(cx, y, colW, cellH, 18); x.fill();
        x.fillStyle = '#6B7464'; x.font = '600 20px "IBM Plex Sans", sans-serif';
        x.fillText(it[0].toUpperCase(), cx + 26, y + 42);
        x.fillStyle = '#0F1310'; x.font = '700 32px "IBM Plex Sans", sans-serif';
        x.fillText(clip(it[1], colW - 52), cx + 26, y + 86);
      }
      y += cellH + 16;
    }
  }

  newPage();

  /* ---- шапка авто ---- */
  h1([car.make, car.model].filter(Boolean).join(' ') || 'Автомобіль');
  y += 46;
  var sub = [car.year, FUEL_UA[car.fuel], car.plate].filter(Boolean).join('  ·  ');
  x.fillStyle = '#5B6455'; x.font = '500 26px "IBM Plex Sans", sans-serif';
  x.fillText(sub, RP_M, y); y += 20;
  if (car.vin) {
    y += 26; x.fillStyle = '#8A9382'; x.font = '500 22px "IBM Plex Sans", sans-serif';
    x.fillText('VIN  ' + car.vin, RP_M, y);
  }
  y += 26;

  /* ---- силует авто: невеликий, у верхньому куті ---- */
  if (window.__silImg) {
    var iw2 = 260, ih2 = iw2 * 80 / 200;
    x.save(); x.globalAlpha = 0.9;
    x.drawImage(window.__silImg, RP_W - RP_M - iw2, 176, iw2, ih2);
    x.restore();
  }
  y += 10;

  /* ---- ключове ---- */
  h2('Коротко');
  var months = st.since ? Math.max(1, Math.round((Date.now() - new Date(st.since + 'T12:00:00Z')) / 2629800000)) : 0;
  cells([
    ['Пробіг', nfmt(car.odo) + ' км'],
    [isEV ? 'Батарея' : 'Двигун',
      isEV ? ((car.battery ? car.battery + ' кВт·год' : '—') + (car.soh ? ' · SOH ' + car.soh + '%' : ''))
           : (car.engine ? (car.engine / 1000).toFixed(1) + ' л' : '—')],
    ['Записів обслуговування', String(st.srv.length)],
    ['Вкладено в обслуговування', money(st.spentSrv)],
    [isEV ? 'Здоровʼя батареї' : 'Остання заміна масла',
      isEV ? (car.soh ? car.soh + '%' : 'не вказано')
           : (car.lastOilOdo ? nfmt(car.lastOilOdo) + ' км' : 'не вказано')],
    ['Книжка ведеться', st.since ? fmtDateY(st.since) : 'з сьогодні'],
  ]);

  /* ---- скільки коштувало ---- */
  var own = ownership(car.id);
  if (own) {
    h2('Скільки коштувало', 200);
    rows([
      ['У середньому на місяць', money(own.perMonth)],
      own.perKm ? ['Вартість кілометра', own.perKm.toFixed(2) + ' ₴'] : null,
      own.kmPerMonth ? ['Пробіг за місяць', nfmt(own.kmPerMonth) + ' км'] : null,
      ['Разом за весь облік', money(own.total)],
    ].filter(Boolean));
  }

  /* ---- сервісна книжка ---- */
  h2('Сервісна книжка', 240);   // щоб заголовок не лишився сам унизу
  if (!st.srv.length) {
    para('Записів поки немає.', 24, '#8A9382');
  } else {
    var cols = [RP_M, RP_M + 258, RP_M + 440, RP_W - RP_M];   // дата з роком широка
    x.fillStyle = '#8A9382'; x.font = '600 19px "IBM Plex Sans", sans-serif';
    x.fillText('ДАТА', cols[0], y); x.fillText('ПРОБІГ', cols[1], y); x.fillText('ЩО ЗРОБЛЕНО', cols[2], y);
    var sc = 'СУМА'; x.fillText(sc, cols[3] - x.measureText(sc).width, y);
    y += 22;

    st.srv.slice(0, 90).forEach(function (r, i) {
      room(64);
      if (i % 2 === 0) { x.fillStyle = '#FAFBF8'; x.fillRect(RP_M - 14, y - 8, RP_W - RP_M * 2 + 28, 54); }
      x.fillStyle = '#0F1310'; x.font = '400 24px "IBM Plex Sans", sans-serif';
      x.fillText(fmtDateY(r.date), cols[0], y + 28);
      x.fillStyle = '#3C443A';
      x.fillText(r.odo ? nfmt(r.odo) : '—', cols[1], y + 28);
      x.fillStyle = '#0F1310';
      var what = r.title || KIND_UA[r.kind] || 'Обслуговування';
      x.fillText(clip(what, cols[3] - cols[2] - 190), cols[2], y + 28);
      var s = r.cost ? money(r.cost) : '—';
      x.font = '600 24px "IBM Plex Sans", sans-serif';
      x.fillText(s, cols[3] - x.measureText(s).width, y + 28);
      y += 54;
    });
    if (st.srv.length > 90) para('…та ще ' + (st.srv.length - 90) + ' записів', 22, '#8A9382');
  }

  /* ---- паливо ---- */
  if (st.fuel.length) {
    h2(isEV ? 'Заряджання' : 'Заправки', 210);
    var unit = isEV ? 'кВт·год' : 'л';
    rows([
      [isEV ? 'Заряджань' : 'Заправок', String(st.fuel.length)],
      ['Загалом ' + (isEV ? 'енергії' : 'пального'), nfmt(st.qty) + ' ' + unit],
      ['Середня витрата', st.cons ? st.cons.per100.toFixed(1) + ' ' + unit + '/100 км' : 'даних поки мало'],
      ['Витрачено на ' + (isEV ? 'зарядку' : 'паливо'),
        money(st.fuel.reduce(function (a, r) { return a + costUah(r); }, 0))],
    ]);
  }

  /* ---- нижній колонтитул на кожній сторінці ---- */
  pages.forEach(function (p, i) {
    var c2 = p.getContext('2d');
    var last = i === pages.length - 1;
    if (last) {                              // підпис — на останній сторінці, окремий аркуш не потрібен
      c2.fillStyle = '#8A9382'; c2.font = '400 21px "IBM Plex Sans", sans-serif';
      c2.fillText('Записи вносив власник авто у застосунку Бардачок. Звіт показує, як за машиною', RP_M, RP_H - 148);
      c2.fillText('доглядали: що і коли обслуговували, скільки в це вклали.', RP_M, RP_H - 118);
    }
    c2.fillStyle = '#E4E8DE'; c2.fillRect(RP_M, RP_H - 96, RP_W - RP_M * 2, 2);
    c2.fillStyle = '#8A9382'; c2.font = '400 20px "IBM Plex Sans", sans-serif';
    c2.fillText('Сформовано ' + fmtDateY(today()), RP_M, RP_H - 58);
    var pn = 'Сторінка ' + (i + 1) + ' з ' + pages.length;
    c2.fillText(pn, RP_W - RP_M - c2.measureText(pn).width, RP_H - 58);
  });

  return pages.map(function (p) { return p.toDataURL('image/jpeg', 0.86); });
}

/* Після відкриття рахунку самі перевіряємо, чи гроші дійшли.
   Спершу часто, потім рідше — щоб не гатити сервер. */
var PAY_TIMER = null;
function watchPayment() {
  if (PAY_TIMER) clearTimeout(PAY_TIMER);
  var tries = 0;
  /* перші три хвилини перевіряємо часто — саме там людина чекає */
  var delays = [];
  for (var i = 0; i < 60; i++) delays.push(3000);
  for (var j = 0; j < 30; j++) delays.push(10000);

  function tick() {
    api('/api/pay-check', {}).then(function (d) {
      if (d.ok && d.premium) {
        PRO = true;
        S.premiumUntil = d.until;
        DIRTY = {}; render();
        haptic('medium');
        premiumWelcome(d.until);
        return;
      }
      if (tries < delays.length) PAY_TIMER = setTimeout(tick, delays[tries++]);
      else {
        var box = document.getElementById('payErr');
        if (box) box.innerHTML = '<div class="msg er">Оплата ще не дійшла. ' +
          'Натисніть «Перевірити оплату» — або напишіть нам, розберемось.</div>' +
          '<button class="btn sec" data-do="payCheck">Перевірити оплату</button>';
      }
    }).catch(function () {
      if (tries < delays.length) PAY_TIMER = setTimeout(tick, delays[tries++]);
    });
  }
  PAY_TIMER = setTimeout(tick, 4000);
}

/* Що саме людина щойно купила — коротко і по ділу */
var WEL = 0;
var WEL_UNTIL = '';
var WELCOME = [
  { tag: 'Готово', t: 'Преміум\nувімкнено', p: 'Дякуємо. Ось що зʼявилось — за хвилину пройдемось.', art: 'ok' },
  { tag: 'Голос', t: 'Просто\nнадиктуйте', p: 'Затисніть мікрофон у чаті з ботом і скажіть «залив 40 літрів на 1800». Запис зʼявиться сам.', art: 'voice' },
  { tag: 'Помічник', t: 'Питайте\nпро своє авто', p: 'Відповідає з вашою сервісною книжкою перед очима: коли міняли, скільки вклали, що вже пора.', art: 'brain' },
  { tag: 'Перевірки', t: 'VIN і номерний\nзнак', p: 'Без обмежень. По VIN — ще й фото з американського аукціону, якщо авто звідти.', art: 'vin' },
  { tag: 'Документи', t: 'Усе під рукою', p: 'До двадцяти знімків, зашифрованих у телефоні. Плюс звіти для покупця й по витратах.', art: 'docs', last: true },
];

function welArt(kind) {
  if (kind === 'ok')
    return '<div class="st-art hero" style="text-align:center;padding:30px 20px">' +
      '<div class="wel-check">' + ic('check', 34) + '</div></div>';
  if (kind === 'voice')
    return '<div class="st-art">' +
      '<div class="st-say">«залив 40 літрів на 1800»</div>' +
      '<div class="st-row done"><span>' + ic('fuel', 18) + 'Заправка</span><b>1 800 ₴</b></div></div>';
  if (kind === 'brain')
    return '<div class="st-art">' +
      '<div class="st-bub me">Коли міняти колодки?</div>' +
      '<div class="st-typing"><i></i><i></i><i></i></div>' +
      '<div class="st-bub ai">Ви міняли передні на 135 200 км. Зараз 142 000 — ще рано, ' +
      'типовий ресурс 40–60 тисяч.</div></div>';
  if (kind === 'vin')
    return '<div class="st-art">' +
      '<div class="st-row"><span>' + ic('search', 18) + 'Перевірок по VIN</span><b>без ліміту</b></div>' +
      '<div class="st-row"><span>' + ic('idcard', 18) + 'Пошук за номером</span><b>відкрито</b></div>' +
      '<div class="st-row done"><span>' + ic('car', 18) + 'Фото з аукціону</span><b>так</b></div></div>';
  return '<div class="st-art">' +
    '<div class="st-row"><span>' + ic('doc', 18) + 'Документів</span><b>20</b></div>' +
    '<div class="st-row"><span>' + ic('chart', 18) + 'Звіт про витрати</span><b>PDF</b></div>' +
    '<div class="st-row done"><span>' + ic('star', 18) + 'Звіт для покупця</span><b>PDF</b></div></div>';
}

function premiumWelcome(until) {
  WEL = 0; WEL_UNTIL = until || S.premiumUntil || '';
  drawWelcome();
}

function drawWelcome() {
  var i = Math.min(WEL, WELCOME.length - 1);
  var w = WELCOME[i];
  openSheet('',
    '<div class="st-wrap" style="min-height:auto">' +
      '<div class="st-bars">' + WELCOME.map(function (_, n) {
        return '<i class="' + (n < i ? 'done' : n === i ? 'on' : '') + '"></i>';
      }).join('') + '</div>' +
      '<div class="st-top"><span class="st-tag">' + esc(w.tag) + '</span>' +
        (w.last ? '' : '<button class="st-skip" data-close="1">Пропустити</button>') + '</div>' +
      '<div class="st-body">' +
        '<h2>' + esc(w.t).replace(/\n/g, '<br>') + '</h2>' +
        '<p>' + esc(w.p) + '</p>' + welArt(w.art) +
        (i === 0 && WEL_UNTIL ? '<div class="st-fact">Діє до ' + fmtDateY(WEL_UNTIL) + '</div>' : '') +
      '</div>' +
      '<div class="st-foot">' +
        (i > 0 ? '<button class="st-back" data-do="welBack">' + ic('back', 18) + '</button>' : '') +
        '<button class="btn" data-do="' + (w.last ? 'welDone' : 'welNext') + '">' +
          (w.last ? 'Почати користуватись' : 'Далі') + '</button>' +
      '</div>' +
    '</div>');
}

/* Преміум могли увімкнути, поки застосунок був закритий. Порівнюємо з тим,
   що бачили минулого разу, і вітаємо один раз. */
function checkNewPremium() {
  var was = '';
  try { was = localStorage.getItem('b_pro') || ''; } catch (e) {}
  var now = PRO ? (S.premiumUntil || '1') : '';
  try { localStorage.setItem('b_pro', now); } catch (e) {}
  if (now && now !== was) setTimeout(function () { premiumWelcome(S.premiumUntil); }, 700);
}

function paywallHtml(what) {
  return '<div class="msg inf">' + esc(what) + ' — у Преміумі.</div>' +
    '<p style="margin:0 0 14px;font-size:13.5px;color:var(--ink2);line-height:1.6">' +
      'Преміум відкриває голосове внесення, питання про авто, кілька машин, ' +
      'необмежені перевірки по VIN і звіти для покупця.</p>' +
    '<div class="card"><div class="kv"><span>Місяць</span><b>' + money(CFG.premiumMonth) + '</b></div>' +
    '<div class="kv"><span>Рік</span><b>' + money(CFG.premiumYear) + '</b></div></div>' +
    '<button class="btn" style="margin-top:12px" data-go="tab:s-more" data-close="1">Дивитись тарифи</button>';
}

/* Звіт про витрати — окремий документ: куди пішли гроші за рік. */
function rpMoneyPages(car) {
  var isEV = car.fuel === 'electric';
  var own = ownership(car.id);
  var cons = consumption(car.id);
  var year = spend(car.id, 365);
  var mm = spendMonths(car.id, 12);

  var pages = [], cv = null, x = null, y = 0;

  function newPage() {
    cv = document.createElement('canvas');
    cv.width = RP_W; cv.height = RP_H;
    x = cv.getContext('2d');
    x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, RP_W, RP_H);
    x.textBaseline = 'alphabetic';
    pages.push(cv);
    x.fillStyle = '#0F1310'; x.fillRect(0, 0, RP_W, 132);
    x.fillStyle = '#D7FF3E'; x.font = '800 32px Unbounded, sans-serif';
    x.fillText('БАРДАЧОК', RP_M, 80);
    x.fillStyle = '#8A9382'; x.font = '600 22px "IBM Plex Sans", sans-serif';
    var t = 'ЗВІТ ПРО ВИТРАТИ';
    x.fillText(t, RP_W - RP_M - x.measureText(t).width, 78);
    y = 210;
  }
  function room(n) { if (y + n > RP_H - 190) newPage(); }
  function h2(t, need) {
    room((need || 110) + 26); y += 26;
    x.fillStyle = '#5B6455'; x.font = '700 21px "IBM Plex Sans", sans-serif';
    x.fillText(t.toUpperCase(), RP_M, y); y += 16;
    x.fillStyle = '#E4E8DE'; x.fillRect(RP_M, y, RP_W - RP_M * 2, 2); y += 40;
  }
  function rows(items) {
    items.forEach(function (it) {
      room(48);
      x.fillStyle = '#5B6455'; x.font = '400 24px "IBM Plex Sans", sans-serif';
      x.fillText(it[0], RP_M, y + 26);
      x.fillStyle = '#0F1310'; x.font = '600 24px "IBM Plex Sans", sans-serif';
      x.fillText(it[1], RP_W - RP_M - x.measureText(it[1]).width, y + 26);
      x.fillStyle = '#EFF2EB'; x.fillRect(RP_M, y + 43, RP_W - RP_M * 2, 1);
      y += 46;
    });
  }
  function rrect(a, b, w, hh, r) {
    x.beginPath(); x.moveTo(a + r, b);
    x.arcTo(a + w, b, a + w, b + hh, r); x.arcTo(a + w, b + hh, a, b + hh, r);
    x.arcTo(a, b + hh, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath();
  }

  newPage();

  x.fillStyle = '#0F1310'; x.font = '800 52px Unbounded, sans-serif';
  x.fillText(carName(car), RP_M, y); y += 46;
  x.fillStyle = '#5B6455'; x.font = '500 26px "IBM Plex Sans", sans-serif';
  x.fillText([car.year, FUEL_UA[car.fuel], car.plate].filter(Boolean).join('  ·  '), RP_M, y);
  y += 30;

  /* велика цифра за рік */
  room(190);
  var bw = RP_W - RP_M * 2;
  x.fillStyle = '#D7FF3E'; rrect(RP_M, y, bw, 170, 24); x.fill();
  x.fillStyle = 'rgba(16,19,14,.62)'; x.font = '600 22px "IBM Plex Sans", sans-serif';
  x.fillText('ВИТРАЧЕНО ЗА РІК', RP_M + 30, y + 52);
  x.fillStyle = '#10130E'; x.font = '800 62px Unbounded, sans-serif';
  x.fillText(money(year.total), RP_M + 30, y + 124);
  y += 190;

  /* стовпчики по місяцях */
  h2('Помісячно', 300);
  var max = Math.max.apply(null, mm.map(function (r) { return r.total; }).concat([1]));
  var gap = 10, colW = (bw - gap * 11) / 12, H = 190;
  mm.forEach(function (r, i) {
    var hh = Math.max(3, r.total / max * H);
    var cx = RP_M + i * (colW + gap);
    x.fillStyle = i === 11 ? '#0F1310' : '#DEE4D6';
    rrect(cx, y + H - hh, colW, hh, Math.min(colW / 2, 7)); x.fill();
    x.fillStyle = '#8A9382'; x.font = '500 17px "IBM Plex Sans", sans-serif';
    var lw = x.measureText(r.label).width;
    x.fillText(r.label, cx + (colW - lw) / 2, y + H + 26);
  });
  y += H + 46;

  h2('Куди пішли гроші');
  var parts = [
    [isEV ? 'Зарядка' : 'Паливо', year.fuel],
    ['Сервіс і ремонт', year.service],
    ['Штрафи', year.fines],
    ['Інше', year.other],
  ].filter(function (p) { return p[1] > 0; }).sort(function (a, b) { return b[1] - a[1]; });
  rows(parts.map(function (p) {
    return [p[0] + '  ·  ' + Math.round(p[1] / (year.total || 1) * 100) + '%', money(p[1])];
  }));

  if (own || cons) {
    h2('Показники', 200);
    var r2 = [];
    if (own) r2.push(['У середньому на місяць', money(own.perMonth)]);
    if (own && own.perKm) r2.push(['Вартість кілометра', own.perKm.toFixed(2) + ' ₴']);
    if (own && own.kmPerMonth) r2.push(['Пробіг за місяць', nfmt(own.kmPerMonth) + ' км']);
    if (cons) r2.push(['Витрата ' + (isEV ? 'енергії' : 'пального'),
      cons.per100.toFixed(1) + ' ' + (isEV ? 'кВт·год' : 'л') + '/100 км']);
    if (cons && cons.perKm) r2.push([(isEV ? 'Зарядка' : 'Паливо') + ' на кілометр',
      cons.perKm.toFixed(2) + ' ₴']);
    rows(r2);
  }

  /* найдорожче за рік */
  var big = [];
  ['service', 'exp'].forEach(function (k) {
    (S[k] || []).forEach(function (r) {
      if (r.carId === car.id && r.date >= new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10))
        big.push(r);
    });
  });
  big.sort(function (a, b) { return costUah(b) - costUah(a); });
  if (big.length) {
    h2('Найбільші витрати', 240);
    rows(big.slice(0, 10).map(function (r) {
      return [fmtDateY(r.date) + '  ·  ' + (r.title || ''), amt(r)];
    }));
  }

  pages.forEach(function (p, i) {
    var c2 = p.getContext('2d');
    if (i === pages.length - 1) {
      c2.fillStyle = '#8A9382'; c2.font = '400 21px "IBM Plex Sans", sans-serif';
      c2.fillText('Дані взяті з ваших записів у Бардачку. Суми в інших валютах', RP_M, RP_H - 148);
      c2.fillText('переведені в гривню за курсом НБУ на день внесення.', RP_M, RP_H - 118);
    }
    c2.fillStyle = '#E4E8DE'; c2.fillRect(RP_M, RP_H - 96, RP_W - RP_M * 2, 2);
    c2.fillStyle = '#8A9382'; c2.font = '400 20px "IBM Plex Sans", sans-serif';
    c2.fillText('Сформовано ' + fmtDateY(today()), RP_M, RP_H - 58);
    var pn = 'Сторінка ' + (i + 1) + ' з ' + pages.length;
    c2.fillText(pn, RP_W - RP_M - c2.measureText(pn).width, RP_H - 58);
  });

  return pages.map(function (p) { return p.toDataURL('image/jpeg', 0.86); });
}

function sendMoneyReport() {
  var car = activeCar();
  if (!car) return;
  if (!PRO) { needPro('report'); return; }
  toast('Готую звіт…');
  var ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  ready.then(function () {
    var pages;
    try { pages = rpMoneyPages(car); }
    catch (e) { toast('Не вдалося намалювати звіт'); return; }
    return api('/api/report', { pages: pages, kind: 'money', plate: 'витрати-' + (car.plate || '') }).then(function (d) {
      if (!d.ok) {
        if (d.error === 'premium') { needPro('report'); return; }
        toast(d.message || d.error || 'Не вдалося надіслати');
        return;
      }
      haptic('medium');
      openSheet('Звіт готовий',
        '<p style="margin:0 0 14px;font-size:14px;color:var(--ink2);line-height:1.6">' +
        'PDF із витратами надіслано у чат бота.</p>' +
        '<button class="btn" data-close="1">Зрозуміло</button>');
    });
  }).catch(function () { toast('Немає звʼязку з сервером'); });
}

function drawReport() {
  var car = activeCar();
  var el = $('#s-report');
  if (!car) { el.innerHTML = '<div class="card"><p style="margin:0;color:var(--mut)">Спочатку додайте авто.</p></div>'; return; }
  var st = rpStats(car.id);

  el.innerHTML =
    '<div class="card">' +
      '<div class="chat-head" style="padding:0 0 12px">' +
        '<div class="ic-box">' + ic('doc', 20) + '</div>' +
        '<div style="flex:1;min-width:0"><b style="display:block;font-size:15px;font-weight:700">Звіт для покупця</b>' +
        '<small style="color:var(--mut);font-size:12px">' + carName(car) + '</small></div></div>' +
      '<p style="margin:0 0 14px;font-size:13px;color:var(--ink2);line-height:1.55">' +
        'PDF-документ із сервісною книжкою: що робили, на якому пробігу, за скільки. ' +
        'Покупець бачить, що авто доглянуте — і торгуватись йому важче.</p>' +
      '<div class="kv"><span>Записів обслуговування</span><b>' + st.srv.length + '</b></div>' +
      '<div class="kv"><span>Вкладено в обслуговування</span><b>' + money(st.spentSrv) + '</b></div>' +
      '<div class="kv"><span>Книжка ведеться з</span><b>' + (st.since ? fmtDate(st.since) : 'сьогодні') + '</b></div>' +
      '<button class="btn" data-do="report" style="margin-top:14px">' +
        (PRO ? 'Створити PDF' : 'Створити PDF') + (PRO ? '' : lockIc()) + '</button>' +
      '<div class="note" style="margin-top:10px">Файл прийде у чат бота — звідти перешлете покупцю.</div>' +
    '</div>' +
    (st.srv.length ? '' :
      '<div class="note">Поки що книжка порожня. Внесіть хоч кілька робіт — звіт стане переконливим.</div>');
}

function sendReport() {
  var car = activeCar();
  if (!car) return;
  if (!PRO) { needPro('report'); return; }

  toast('Готую звіт…');
  var ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();

  ready.then(function () {
    {                                           // силует треба «проявити» як картинку
      return new Promise(function (res) {
        var sv = silSvg(car.body || guessCar(car.make, car.model).body || 'sedan', '#0F1310', '#F5F7F2');
        var src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
          sv.replace('<svg class="sil"', '<svg xmlns="http://www.w3.org/2000/svg"'));
        var im = new Image();
        im.onload = function () { window.__silImg = im; res(null); };
        im.onerror = function () { window.__silImg = null; res(null); };
        im.src = src;
      });
    }
  }).then(function () {
    var pages;
    try { pages = rpPages(car); }
    catch (e) { toast('Не вдалося намалювати звіт'); return; }
    return api('/api/report', { pages: pages, kind: 'sale', plate: car.plate || carName(car) }).then(function (d) {
      if (!d.ok) {
        if (d.error === 'premium') { needPro('report'); return; }
        toast(d.message || d.error || 'Не вдалося надіслати');
        return;
      }
      haptic('medium');
      openSheet('Звіт готовий',
        '<p style="margin:0 0 14px;font-size:14px;color:var(--ink2);line-height:1.6">' +
        'PDF надіслано у чат бота. Відкрийте бота і перешліть файл покупцю.</p>' +
        '<button class="btn" data-close="1">Зрозуміло</button>');
    });
  }).catch(function () { toast('Немає звʼязку з сервером'); });
}

/* ------------------------------------------------------------------ */
/* ШИФРУВАННЯ ДОКУМЕНТІВ                                               */
/* Знімки паспорта й прав шифруються прямо в телефоні. На сервер іде   */
/* лише набір байтів: ані власник застосунку, ані той, хто вкраде базу,*/
/* прочитати їх не зможе. Ключ живе тільки на пристрої — і його можна  */
/* записати собі як код відновлення.                                   */
/* ------------------------------------------------------------------ */
var KEY_STORE = 'b_key';
var DOC_KEY = null;

function b64(buf) {
  var b = new Uint8Array(buf), s = '';
  for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
function unb64(str) {
  var bin = atob(str), out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/* код відновлення — літери й цифри без схожих символів */
var CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function codeFromKey(raw) {
  var b = new Uint8Array(raw), s = '';
  for (var i = 0; i < b.length; i++) {
    s += CODE_ABC[b[i] % 32];
    if (s.length % 5 === 4 && i < b.length - 1) s += '-';
  }
  return s;
}
function keyFromCode(code) {
  var c = String(code).toUpperCase().replace(/[^A-Z2-9]/g, '');
  if (c.length < 20) return null;
  var out = new Uint8Array(c.length);
  for (var i = 0; i < c.length; i++) out[i] = CODE_ABC.indexOf(c[i]) * 8 + 3;
  return out;
}

/* Ключ живе у трьох місцях, і жодне з них — не наш сервер:
   1) у памʼяті телефона (швидко),
   2) у хмарі Telegram для цього застосунку (переживає чистку кешу
      і переїзд на інший телефон; наш сервер туди не має доступу),
   3) у голові власника — код відновлення.
   Плюс, якщо телефон уміє, вхід можна закрити відбитком або обличчям. */
var CLOUD = (tg && tg.CloudStorage) ? tg.CloudStorage : null;
var KEY_CACHE = null;

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

function hasKey() { return !!(KEY_CACHE || lsGet(KEY_STORE)); }

/* тягнемо ключ із хмари Telegram, якщо на пристрої його нема */
function syncKey() {
  return new Promise(function (res) {
    var local = lsGet(KEY_STORE);
    if (!CLOUD) { res(local); return; }

    /* Старі версії Telegram можуть не відповісти взагалі — тоді документ
       мовчки не додавався. Чекаємо дві секунди й ідемо далі з тим, що є. */
    var done = false;
    var finish = function (v) { if (done) return; done = true; res(v); };
    setTimeout(function () { finish(local); }, 2000);

    try {
      CLOUD.getItem(KEY_STORE, function (err, val) {
        if (!err && val) {
          if (!local) lsSet(KEY_STORE, val);         // впав із хмари
          finish(val);
          return;
        }
        if (local) { try { CLOUD.setItem(KEY_STORE, local, function () {}); } catch (e) {} }
        finish(local);
      });
    } catch (e) { finish(local); }
  });
}

function loadKey() {
  if (DOC_KEY) return Promise.resolve(DOC_KEY);
  return syncKey().then(function (raw) {
    if (!raw) return null;
    KEY_CACHE = raw;
    return crypto.subtle.importKey('raw', unb64(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
      .then(function (k) { DOC_KEY = k; return k; })
      .catch(function () { return null; });
  });
}

function saveKeyRaw(rawB64) {
  KEY_CACHE = rawB64;
  lsSet(KEY_STORE, rawB64);
  if (CLOUD) { try { CLOUD.setItem(KEY_STORE, rawB64, function () {}); } catch (e) {} }
  DOC_KEY = null;
}

function makeKey() {
  var raw = crypto.getRandomValues(new Uint8Array(16));
  saveKeyRaw(b64(raw));
  return { code: codeFromKey(raw) };
}

function restoreKey(code) {
  var raw = keyFromCode(code);
  if (!raw) return false;
  saveKeyRaw(b64(raw));
  return true;
}

function seal(text) {
  return loadKey().then(function (k) {
    if (!k) return null;
    if (!(window.crypto && crypto.subtle)) return null;   // старий вебперегляд
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var data = new TextEncoder().encode(text);
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, data).then(function (buf) {
      return 'sealed:' + b64(iv) + ':' + b64(buf);
    });
  });
}

function unseal(payload) {
  if (!payload) return Promise.resolve(null);
  if (payload.indexOf('sealed:') !== 0) return Promise.resolve(payload);   // старий незашифрований
  var parts = payload.split(':');
  if (parts.length < 3) return Promise.resolve(null);
  return loadKey().then(function (k) {
    if (!k) return null;
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(parts[1]) }, k, unb64(parts[2]))
      .then(function (buf) { return new TextDecoder().decode(buf); })
      .catch(function () { return null; });
  });
}

/* Перед першим документом показуємо код відновлення — інакше людина
   втратить доступ до власних знімків і не зрозуміє чому. */
function ensureKey(cb) {
  if (hasKey()) { cb(); return; }
  var made = makeKey();
  openSheet('Ключ до ваших документів',
    '<p style="margin:0 0 14px;font-size:13.5px;color:var(--ink2);line-height:1.6">' +
      'Знімки документів шифруються прямо в телефоні. Ключ зберігається лише тут, ' +
      'на сервер він не потрапляє — навіть ми не можемо їх відкрити.</p>' +
    '<div class="tokenbox"><code>' + esc(made.code) + '</code></div>' +
    '<button class="btn sec" style="margin-top:9px" data-do="sendSelf" data-w="reccode" ' +
      'data-code="' + esc(made.code) + '">Надіслати код собі в бот</button>' +
    '<div class="note">Збережіть цей код. Якщо зміните телефон або почистите ' +
      'застосунок — без нього документи не відкриються.</div>' +
    '<button class="btn" data-do="keyOk">Записав, продовжити</button>' +
    '<button class="btn sec" data-do="keyRestore">У мене вже є код</button>');
  KEY_NEXT = cb;
}
var KEY_NEXT = null;

/* ------------------------------------------------------------------ */
/* ДОКУМЕНТИ                                                           */
/* Те, що зазвичай лежить у справжньому бардачку — тільки не губиться. */
/* ------------------------------------------------------------------ */
var DOCS = null, DOC_LIMIT = 3, DOC_IMG = {};
var DOC_UA = { techpass: 'Техпаспорт', insurance: 'Страховка', licence: 'Посвідчення',
               greencard: 'Зелена карта', other: 'Інше' };
var DOC_IC = { techpass: 'doc', insurance: 'shield', licence: 'idcard',
               greencard: 'globe', other: 'doc' };

function loadDocs(cb) {
  api('/api/doc', { list: 1 }).then(function (d) {
    if (d.ok) { DOCS = d.docs || []; DOC_LIMIT = d.limit || 3; }
    else DOCS = [];
    if (cb) cb();
    drawDocs();
  }).catch(function () { DOCS = []; drawDocs(); });
}

/* Сіра заготовка замість порожнього екрана, поки йдуть дані */
function skeleton(n) {
  var one = '<div class="card sk"><div class="sk-l w60"></div><div class="sk-l w90"></div>' +
            '<div class="sk-l w40"></div></div>';
  var out = '';
  for (var i = 0; i < (n || 2); i++) out += one;
  return out;
}

function drawDocs() {
  var el = $('#s-docs');
  if (!el) return;

  if (DOCS === null) {
    el.innerHTML = skeleton(3);
    loadDocs();
    return;
  }

  var h = '<div class="card">' +
    '<div class="chat-head" style="padding:0 0 12px">' +
      '<div class="ic-box">' + ic('doc', 20) + '</div>' +
      '<div style="flex:1;min-width:0"><b style="display:block;font-size:15px;font-weight:700">Документи</b>' +
      '<small style="color:var(--mut);font-size:12px">' + DOCS.length + ' з ' + DOC_LIMIT + '</small></div></div>' +
    '<p style="margin:0 0 13px;font-size:12.5px;color:var(--mut);line-height:1.5">' +
      'Знімки техпаспорта, страховки, прав. Забули вдома — відкрили тут.</p>' +
    '<div class="safe">' +
      '<div><i>' + ic('lock', 15) + '</i><span>Знімок шифрується <b>у вашому телефоні</b> — ' +
        'ще до того, як полетить на сервер</span></div>' +
      '<div><i>' + ic('shield', 15) + '</i><span>У хмарі лежать <b>закодовані байти</b>, ' +
        'а не ваші фотографії</span></div>' +
      '<div><i>' + ic('check', 15) + '</i><span>Ключ живе у вашому телефоні й у хмарі Telegram — ' +
        'переживе чистку кешу і новий телефон</span></div>' +
    '</div>' +
    '<button class="btn' + (DOCS.length >= DOC_LIMIT ? ' sec' : '') + '" data-do="docAdd">Додати документ</button>' +
    '</div>';

  if (DOCS.length) {
    h += '<div class="h2">У бардачку</div><div class="card list">' +
      DOCS.map(function (d) {
        return '<button class="it" data-do="docOpen" data-id="' + d.id + '">' +
          '<div class="dt">' + ic(DOC_IC[d.kind] || 'doc', 17) + '</div>' +
          '<div class="tx"><b>' + esc(d.title || DOC_UA[d.kind] || 'Документ') + '</b>' +
          '<small>' + (DOC_UA[d.kind] || 'Інше') + ' · ' + fmtDate(d.added) + '</small></div>' +
          '<div class="vl">›</div></button>';
      }).join('') + '</div>';
  } else {
    h += '<div class="empty">Поки що порожньо. Найкорисніше — техпаспорт і страховка.</div>';
  }

  h += '<div class="card" style="margin-top:10px"><div class="card-h"><b>Захист</b></div>' +
    '<div class="kv"><span>Шифрування</span><b>у вашому телефоні</b></div>' +
    '<div class="kv"><span>Ключ у хмарі Telegram</span><b>' + (CLOUD ? 'так' : 'недоступно') + '</b></div>' +
    '<button class="btn sec" style="margin-top:11px" data-do="keyShow">' +
      'Показати код відновлення</button>' +
    '</div>';

  h += '<div class="note">У кожного свій персональний ключ, і він лишається у вас: ' +
       'у телефоні та у вашій хмарі Telegram. Тому документи переживають чистку кешу ' +
       'і переїзд на новий телефон — і відкриваються тільки вашим ключем.<br><br>' +
       'Окремого пароля на розділ немає навмисно: той, хто тримає ваш розблокований ' +
       'телефон, однаково зняв би його в два дотики. Захист тут — саме шифрування ' +
       'і блокування самого телефона.</div>';
  el.innerHTML = h;
}

function docPick() {
  if (DOCS && DOCS.length >= DOC_LIMIT && !PRO) { needPro('docs'); return; }
  if (!hasKey()) { ensureKey(function () { docPick(); }); return; }
  openSheet('Новий документ',
    '<div class="field"><label>Що це</label><div class="seg" id="dKind" style="flex-wrap:wrap">' +
      Object.keys(DOC_UA).map(function (k, i) {
        return '<button type="button" data-v="' + k + '" class="' + (i === 0 ? 'on' : '') + '">' + DOC_UA[k] + '</button>';
      }).join('') + '</div></div>' +
    fld('dTitle', 'Підпис (не обов’язково)', { ph: 'напр. Техпаспорт Camry', max: 60 }) +
    '<div id="dErr"></div>' +
    '<button class="btn" data-do="docShoot">Зробити знімок або обрати</button>' +
    '<div class="note" style="margin-bottom:0">Знімайте при доброму світлі, щоб текст читався.</div>');
}

function docShoot() {
  var on = document.querySelector('#dKind button.on');
  var kind = on ? on.dataset.v : 'other';
  var title = val('dTitle');

  /* Поле мусить бути в самій сторінці. Відірваний від документа input
     у вебперегляді Telegram на iPhone просто не повідомляє про вибір —
     людина обирає фото, і нічого не відбувається. */
  var old = document.getElementById('docFile');
  if (old) old.remove();
  var inp = document.createElement('input');
  inp.id = 'docFile';
  inp.type = 'file'; inp.accept = 'image/*';
  inp.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0';
  document.body.appendChild(inp);

  inp.onchange = function () {
    var f = inp.files && inp.files[0];
    if (!f) { inp.remove(); return; }
    toast('Обробляю знімок…');
    var fr = new FileReader();
    fr.onerror = function () { toast('Не вдалося прочитати файл', 'er'); inp.remove(); };
    fr.onload = function () {
      var img = new Image();
      img.onload = function () {
        /* Шифрування збільшує обсяг на третину, тому тиснемо з запасом:
           зменшуємо, поки не влізе, інакше сервер відмовить і людина
           не зрозуміє чому. */
        var data = null;
        var sizes = [1500, 1300, 1100, 900, 750];
        var quals = [0.72, 0.62, 0.5, 0.42];
        for (var si = 0; si < sizes.length && !data; si++) {
          for (var qi = 0; qi < quals.length; qi++) {
            var k = Math.min(1, sizes[si] / Math.max(img.width, img.height));
            var c = document.createElement('canvas');
            c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            var d0 = c.toDataURL('image/jpeg', quals[qi]);
            if (d0.length < 700000) { data = d0; break; }
          }
        }
        if (!data) { toast('Знімок завеликий навіть після стиснення'); return; }
        toast('Шифрую й кладу в бардачок…');
        var guard = setTimeout(function () {
          toast('Шифрування не відповідає — зберігаю як є');
        }, 4000);
        seal(data).catch(function () { return null; }).then(function (payload) {
        clearTimeout(guard);
        api('/api/doc', { kind: kind, title: title, data: payload || data }).then(function (d) {
          if (!d.ok) {
            if (d.error === 'limit') { needPro('docs'); return; }
            openSheet('Не вдалося зберегти',
              '<div class="msg er">' + esc(d.message || d.error || 'Сервер відмовив') + '</div>' +
              '<button class="btn" data-close="1">Зрозуміло</button>');
            return;
          }
          DOCS = d.docs || [];
          inp.remove();
          closeSheet(); DIRTY['s-docs'] = 0; drawDocs(); haptic('medium');
          toast('Документ у бардачку', 'ok');
        }).catch(function () { toast('Немає зв’язку'); });
        });
      };
      img.onerror = function () { toast('Не вдалося прочитати знімок', 'er'); inp.remove(); };
      img.src = fr.result;
    };
    fr.readAsDataURL(f);
  };
  inp.click();
}

function docOpen(id) {
  var d = (DOCS || []).filter(function (x) { return x.id === id; })[0];
  if (!d) return;
  var head = '<div class="kv"><span>' + (DOC_UA[d.kind] || 'Інше') + '</span><b>' + fmtDate(d.added) + '</b></div>';

  function body(imgHtml) {
    return head + imgHtml +
      '<button class="btn sec" data-do="docDel" data-id="' + d.id + '">Прибрати з бардачка</button>';
  }
  openSheet(d.title || DOC_UA[d.kind] || 'Документ',
    body('<div class="empty" style="padding:22px 0">Дістаю…</div>'));

  var show = function (data) {
    if (!data) { $('#sheetBody').innerHTML = body('<div class="msg er">Знімок не знайшовся</div>'); return; }
    $('#sheetBody').innerHTML = body('<img src="' + data + '" alt="" ' +
      'style="width:100%;border-radius:14px;margin:10px 0 12px;display:block">');
  };
  if (DOC_IMG[id]) { show(DOC_IMG[id]); return; }
  api('/api/doc', { get: 1, id: id }).then(function (r) {
    if (!r.ok || !r.data) { show(null); return; }
    unseal(r.data).then(function (img) {
      if (!img) {
        $('#sheetBody').innerHTML = head +
          '<div class="msg er">Не вдалося відкрити: цей знімок зашифровано іншим ключем.</div>' +
          '<button class="btn sec" data-do="keyRestore">Ввести код відновлення</button>';
        return;
      }
      DOC_IMG[id] = img;
      show(img);
    });
  }).catch(function () { show(null); });
}

/* ------------------------------------------------------------------ */
/* НАГАДУВАННЯ                                                         */
/* Усе, чого немає в стандартних строках: ТО, ГРМ, кредит, техогляд.   */
/* ------------------------------------------------------------------ */
var REM_SUG = [];
var REM_PRESETS = [
  { t: 'Заміна ременя ГРМ', every: 90000, ice: true },
  { t: 'Заміна гальмівної рідини', every: 40000 },
  { t: 'Заміна антифризу', every: 60000 },
  { t: 'Заміна свічок', every: 30000, ice: true },
  { t: 'Заміна повітряного фільтра', every: 15000, ice: true },
  { t: 'Заміна салонного фільтра', every: 20000 },
  { t: 'Перевірка батареї (SOH)', every: 20000, ev: true },
  { t: 'Технічний огляд', every: null },
  { t: 'Оплата кредиту', every: null },
  { t: 'Сезонна зміна гуми', every: null },
];

function remList(carId) {
  return (S.rem || []).filter(function (r) { return r.carId === carId && !r.done; });
}

function remWhen(r, car) {
  if (r.odo && car) {
    var left = r.odo - car.odo;
    return { txt: left <= 0 ? 'вже пора' : 'через ' + nfmt(left) + ' км', hot: left <= 500, sort: left };
  }
  if (r.date) {
    var d = daysLeft(r.date);
    return { txt: d < 0 ? 'прострочено на ' + (-d) + ' ' + dayWord(-d)
                        : d === 0 ? 'сьогодні' : 'через ' + d + ' ' + dayWord(d),
             hot: d <= 7, sort: d * 30 };
  }
  return { txt: '', hot: false, sort: 99999 };
}

function drawRem() {
  var el = $('#s-rem');
  var car = activeCar();
  if (!car) { el.innerHTML = '<div class="empty">Спочатку додайте авто.</div>'; return; }

  var list = remList(car.id).slice().sort(function (a, b) {
    return remWhen(a, car).sort - remWhen(b, car).sort;
  });

  var h = '<div class="card">' +
    '<div class="chat-head" style="padding:0 0 12px">' +
      '<div class="ic-box">' + ic('alert', 20) + '</div>' +
      '<div style="flex:1;min-width:0"><b style="display:block;font-size:15px;font-weight:700">Нагадування</b>' +
      '<small style="color:var(--mut);font-size:12px">' + carName(car) + ' · ' + nfmt(car.odo) + ' км</small></div></div>' +
    '<p style="margin:0 0 13px;font-size:12.5px;color:var(--mut);line-height:1.5">' +
      'Що завгодно — за датою або за пробігом. Я нагадаю в боті, навіть якщо ви сюди не заходите.</p>' +
    '<button class="btn" data-do="remAdd">Додати нагадування</button></div>';

  if (list.length) {
    h += '<div class="h2">Чекають</div><div class="card list">' + list.map(function (r) {
      var w = remWhen(r, car);
      return '<div class="it" style="cursor:default">' +
        '<div class="dt">' + ic(w.hot ? 'alert' : 'check', 17) + '</div>' +
        '<div class="tx"><b>' + esc(r.title) + '</b><small' + (w.hot ? ' style="color:var(--hot)"' : '') + '>' +
          esc(w.txt) + (r.every ? ' · кожні ' + nfmt(r.every) + ' км' : '') + '</small></div>' +
        '<button class="chip gh" data-do="remDone" data-id="' + r.id + '">Зроблено</button>' +
        '<button class="chip gh" data-do="remDel" data-id="' + r.id + '" ' +
          'style="margin-left:6px;color:var(--mut)">×</button>' +
      '</div>';
    }).join('') + '</div>';
  } else {
    h += '<div class="empty">Поки порожньо.</div>';
  }

  var sug = remSuggest(car);
  if (sug.length) {
    h += '<div class="h2">Схоже, варто поставити</div>' + sug.map(function (x, i) {
      return '<div class="nudge"><div class="tx"><b>' + esc(x.t) + '</b>' +
        '<p>' + esc(x.why) + '</p></div>' +
        '<button class="chip gh" data-do="remQuick" data-i="' + i + '">Додати</button></div>';
    }).join('') +
    '<div class="note">Пропозиції зібрані з вашої ж сервісної книжки — ' +
    'не загальні поради, а те, чого саме тут бракує.</div>';
    REM_SUG = sug;
  }

  el.innerHTML = h;
}

/* Що варто поставити саме цьому авто — виводимо з його ж книжки.
   Не загальні поради, а «цього у вас ще не було» або «востаннє давно». */
function remSuggest(car) {
  if (!car) return [];
  var isEV = car.fuel === 'electric';
  var srv = (S.service || []).filter(function (r) { return r.carId === car.id; });
  var have = remList(car.id);
  var out = [];

  function lastOf(re) {
    var hit = srv.filter(function (r) { return re.test((r.title || '') + ' ' + (r.kind || '')); })
                 .sort(function (a, b) { return b.odo - a.odo; })[0];
    return hit || null;
  }
  function already(t) {
    return have.some(function (r) { return r.title.toLowerCase().indexOf(t.toLowerCase().slice(0, 10)) > -1; });
  }

  var rules = [
    { t: 'Заміна ременя ГРМ', every: 90000, re: /грм|ремінь|ремен/i, ice: true },
    { t: 'Заміна гальмівної рідини', every: 40000, re: /гальмівн.*рідин|тормозн.*жидк/i },
    { t: 'Заміна антифризу', every: 60000, re: /антифриз|охолодж/i },
    { t: 'Заміна свічок', every: 30000, re: /свічк|свеч/i, ice: true },
    { t: 'Заміна повітряного фільтра', every: 15000, re: /повітрян|воздушн/i, ice: true },
    { t: 'Заміна салонного фільтра', every: 20000, re: /салонн/i },
    { t: 'Перевірка батареї (SOH)', every: 20000, re: /батаре|soh/i, ev: true },
  ];

  rules.forEach(function (r) {
    if (isEV ? r.ice : r.ev) return;
    if (already(r.t)) return;
    var last = lastOf(r.re);
    if (last) {
      var passed = car.odo - last.odo;
      if (passed >= r.every * 0.7)
        out.push({ t: r.t, odo: last.odo + r.every, every: r.every,
                   why: 'востаннє на ' + nfmt(last.odo) + ' км, минуло ' + nfmt(passed) + ' км' });
    } else if (srv.length >= 2) {
      out.push({ t: r.t, odo: car.odo + Math.round(r.every * 0.3), every: r.every,
                 why: 'у книжці такого запису ще немає' });
    }
  });

  if (!car.insuranceEnd && !already('ОСЦПВ'))
    out.push({ t: 'Оформити ОСЦПВ', date: null, why: 'дата поліса не вказана' });

  return out.slice(0, 4);
}

function remForm() {
  var car = activeCar(); if (!car) return;
  var isEV = car.fuel === 'electric';
  var presets = REM_PRESETS.filter(function (p) {
    return isEV ? !p.ice : !p.ev;
  });
  openSheet('Нове нагадування',
    '<div class="field"><label>Що саме</label>' +
      '<div class="seg wrap" id="rPreset">' + presets.map(function (p) {
        return '<button type="button" data-v="' + REM_PRESETS.indexOf(p) + '">' + esc(p.t) + '</button>';
      }).join('') + '</div></div>' +
    fld('rTitle', 'Назва', { ph: 'напр. Заміна ременя ГРМ', max: 60 }) +
    '<div class="field"><label>Коли нагадати</label>' +
      '<div class="seg" id="rMode">' +
        '<button type="button" data-v="odo" class="on">За пробігом</button>' +
        '<button type="button" data-v="date">За датою</button>' +
      '</div></div>' +
    '<div id="rOdoBox">' +
      fld('rOdo', 'На пробігу, км', { mode: 'numeric', val: car.odo + 10000 }) +
      fld('rEvery', 'Повторювати кожні, км (не обовʼязково)', { mode: 'numeric', ph: '90000' }) +
    '</div>' +
    '<div id="rDateBox" class="hidden">' + fld('rDate', 'Дата', { type: 'date' }) + '</div>' +
    '<div id="rErr"></div>' +
    '<button class="btn" data-do="remSave">Зберегти</button>');
}

/* ------------------------------------------------------------------ */
/* ВАРТІСТЬ ВОЛОДІННЯ                                                  */
/* Скільки авто справді зʼїдає — з паливом, ремонтами і страховкою.    */
/* ------------------------------------------------------------------ */
function ownership(carId) {
  var car = (S.cars || []).filter(function (c) { return c.id === carId; })[0];
  if (!car) return null;

  var all = [];
  ['fuel', 'service', 'exp'].forEach(function (k) {
    (S[k] || []).forEach(function (r) { if (r.carId === carId) all.push(r); });
  });
  (S.fines || []).forEach(function (f) {
    if (f.carId === carId && f.paid) all.push({ date: f.date, cost: f.half ? f.amount / 2 : f.amount });
  });
  if (!all.length) return null;

  var dates = all.map(function (r) { return r.date; }).filter(Boolean).sort();
  var first = dates[0], days = Math.max(30, daysBetween(first, today()));
  var total = all.reduce(function (a, r) { return a + costUah(r); }, 0);

  /* скільки їздить: від найранішого запису з пробігом до теперішнього */
  var withOdo = [];
  ['fuel', 'service'].forEach(function (k) {
    (S[k] || []).forEach(function (r) { if (r.carId === carId && r.odo > 0) withOdo.push(r); });
  });
  withOdo.sort(function (a, b) { return a.odo - b.odo; });
  var km = withOdo.length ? Math.max(0, car.odo - withOdo[0].odo) : 0;

  return {
    total: total,
    short: days < 45,                       // за два тижні місячна цифра — вигадка
    perMonth: total / days * 30,
    perKm: km > 500 ? total / km : null,
    kmPerMonth: km > 500 ? km / days * 30 : null,
    days: days, km: km, since: first,
  };
}

function daysBetween(a, b) {
  if (!a || !b) return 0;
  return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
}

/* Що чекає найближчі три місяці — щоб витрати не падали як сніг на голову */
function forecast(carId) {
  var car = (S.cars || []).filter(function (c) { return c.id === carId; })[0];
  if (!car) return [];
  var own = ownership(carId);
  var kpm = own && own.kmPerMonth ? own.kmPerMonth : null;
  var out = [];

  var di = daysLeft(car.insuranceEnd);
  if (di !== null && di <= 95) out.push({ t: 'Продовжити ОСЦПВ', when: fmtDate(car.insuranceEnd), d: di, cost: 2200 });

  var dg = daysLeft(car.greenEnd);
  if (dg !== null && dg <= 95) out.push({ t: 'Зелена карта', when: fmtDate(car.greenEnd), d: dg, cost: 1500 });

  if (car.fuel !== 'electric') {
    var oil = nextOil(car);
    if (oil && oil.next) {
      var leftKm = oil.next - car.odo;
      var months = kpm ? leftKm / kpm : null;
      if (months !== null && months <= 3)
        out.push({ t: 'Заміна масла', when: 'через ' + nfmt(Math.max(0, leftKm)) + ' км',
                   d: Math.round(months * 30), cost: 2500 });
    }
  }

  remList(carId).forEach(function (r) {
    if (r.date) {
      var d = daysLeft(r.date);
      if (d !== null && d <= 95) out.push({ t: r.title, when: fmtDate(r.date), d: d, cost: 0 });
    } else if (r.odo && kpm) {
      var lk = r.odo - car.odo, m = lk / kpm;
      if (m <= 3) out.push({ t: r.title, when: 'через ' + nfmt(Math.max(0, lk)) + ' км',
                             d: Math.round(m * 30), cost: 0 });
    }
  });

  return out.sort(function (a, b) { return a.d - b.d; }).slice(0, 5);
}

/* ------------------------------------------------------------------ */
/* ЯК У ІНШИХ                                                          */
/* ------------------------------------------------------------------ */
var BENCH = null, BENCH_FOR = '';
function loadBench(car, cb) {
  var key = ((car.make || '') + ' ' + (car.model || '')).toLowerCase().trim();
  if (BENCH_FOR === key) return;          // вже питали — другий раз не треба
  BENCH_FOR = key; BENCH = null;
  api('/api/bench', { make: car.make, model: car.model }).then(function (d) {
    BENCH = d.ok ? d.bench : null;
    cb();
  }).catch(function () { cb(); });
}

function benchCard(car) {
  if (!BENCH) return '';
  var isEV = car.fuel === 'electric';
  var mine = consumption(car.id);
  var own = ownership(car.id);
  var rows = '';

  if (BENCH.cons) {
    var d = mine ? mine.per100 - BENCH.cons : null;
    rows += '<div class="kv"><span>Витрата у таких же</span><b>' + BENCH.cons.toFixed(1) +
      ' ' + (isEV ? 'кВт·год' : 'л') + '</b></div>' +
      (mine ? '<div class="kv"><span>У вас</span><b style="color:' +
        (d > 0.4 ? 'var(--hot)' : 'var(--lime)') + '">' + mine.per100.toFixed(1) +
        ' · ' + (d > 0 ? '+' : '') + d.toFixed(1) + '</b></div>' : '');
  }
  if (BENCH.year) {
    var my = own ? own.perMonth * 12 : null;
    rows += '<div class="kv"><span>Витрати за рік у таких же</span><b>' + money(BENCH.year) + '</b></div>' +
      (my ? '<div class="kv"><span>У вас</span><b>' + money(my) + '</b></div>' : '');
  }
  if (BENCH.km) rows += '<div class="kv"><span>Типовий пробіг</span><b>' + nfmt(BENCH.km) + ' км</b></div>';
  if (!rows) return '';

  return '<div class="h2">Як у інших власників</div><div class="card">' + rows +
    '<div class="note" style="margin:10px 0 0">Знеособлені дані ' + BENCH.n + ' таких авто в Бардачку. ' +
    'Ваші записи ніхто не бачить.</div></div>';
}

/* ------------------------------------------------------------------ */
/* СЕЗОННИЙ ЧЕК-ЛИСТ                                                   */
/* ------------------------------------------------------------------ */
var WX = null, WX_ASKED = false;
function loadWeather(cb) {
  if (WX_ASKED) return;          // вже питали — інакше зворотний виклик зациклиться
  WX_ASKED = true;
  api('/api/weather', {}).then(function (d) {
    WX = d.ok ? { w: d.weather, city: d.city } : null;
    if (cb) cb();
  }).catch(function () { if (cb) cb(); });
}

/* Порада, яка випливає саме з прогнозу, а не з календаря */
function weatherCard(car) {
  if (!WX || !WX.w || !WX.w.days || !WX.w.days.length) return '';
  var w = WX.w, isEV = car.fuel === 'electric';
  var d = w.days.slice(0, 3);
  var minLow = Math.min.apply(null, d.map(function (x) { return x.min; }));
  var maxHigh = Math.max.apply(null, d.map(function (x) { return x.max; }));
  var rain = Math.max.apply(null, d.map(function (x) { return x.rain || 0; }));

  var tips = [];
  if (minLow <= 0)
    tips.push(['snow', 'Вночі до ' + minLow + '°',
      isEV ? 'Запас ходу впаде помітно — ставте на зарядку з вечора і грійте салон від мережі.'
           : 'Слабкий акумулятор саме в такі ночі й помирає. Перевірте, поки не стало пізно.']);
  else if (minLow <= 7)
    tips.push(['tires', 'Вночі ' + minLow + '°',
      'Нижче семи градусів літня гума дубіє. Час думати про зимову.']);

  if (maxHigh >= 28)
    tips.push(['sun', 'Вдень до ' + maxHigh + '°',
      isEV ? 'На спеці зарядка повільніша, а батарея гріється — не лишайте авто на сонці надовго.'
           : 'Перевірте антифриз і тиск у шинах: на гарячому асфальті він росте.']);

  if (rain >= 60)
    tips.push(['rain', 'Дощ найближчими днями',
      'Щітки і протектор вирішують. Перша година дощу — найслизькіша.']);

  if (!tips.length)
    tips.push(['check', (w.now != null ? w.now + '° зараз' : 'Погода спокійна'),
      'Нічого термінового найближчі три дні. Добрий час зробити те, що відкладали.']);

  return '<div class="h2">Погода і авто' +
    (WX.city ? '<span class="act" style="pointer-events:none">' + esc(WX.city) + '</span>' : '') +
    '</div>' +
    '<div class="card"><div class="wx">' + w.days.slice(0, 4).map(function (x, i) {
      var dd = x.date.split('-');
      return '<div class="wxd' + (i === 0 ? ' on' : '') + '">' +
        '<span>' + (i === 0 ? 'сьогодні' : parseInt(dd[2], 10) + ' ' + MONTHS_SHORT[parseInt(dd[1], 10) - 1]) + '</span>' +
        '<b>' + x.max + '°</b><i>' + x.min + '°</i></div>';
    }).join('') + '</div>' +
    tips.map(function (t) {
      return '<div class="alert" style="margin-top:10px"><div class="ic">' + ic(t[0], 18) + '</div>' +
        '<div class="bd"><b>' + esc(t[1]) + '</b><p>' + esc(t[2]) + '</p></div></div>';
    }).join('') + '</div>';
}

function seasonCard(car) {
  var m = new Date().getMonth() + 1;
  var isEV = car.fuel === 'electric';
  var title, list;

  if (m >= 10 || m <= 2) {
    title = 'Готовність до зими';
    list = ['Зимова гума — від +7 °C гальмівний шлях на літній довший на третину',
            isEV ? 'Батарея на морозі втрачає до 30% запасу — плануйте зарядку'
                 : 'Акумулятор: на холоді слабкий помирає першим',
            'Незамерзайка і щітки склоочисника',
            'Антифриз — перевірити температуру замерзання',
            'Скребок, трос і рукавички в багажник'];
  } else if (m >= 3 && m <= 5) {
    title = 'Після зими';
    list = ['Літня гума — після стабільних +7 °C',
            'Кондиціонер: заправка й салонний фільтр',
            'Мийка днища від реагентів',
            'Гальмівні колодки після зими',
            isEV ? 'Перевірити стан батареї після морозів' : 'Рівень масла після зимових пусків'];
  } else {
    title = 'Літня спека і дорога';
    list = ['Тиск у шинах — на гарячому асфальті він росте',
            isEV ? 'На спеці зарядка повільніша — закладайте час у маршрут'
                 : 'Рівень антифризу й стан радіатора',
            'Кондиціонер: якщо дує тепле — не тягніть до липня',
            'Аптечка, вогнегасник і знак — перед довгою поїздкою',
            'Щітки після зими зазвичай уже дубові'];
  }

  return '<div class="h2">' + title + '</div>' +
    '<div class="card"><ul class="checks">' + list.map(function (x) {
      return '<li>' + esc(x) + '</li>';
    }).join('') + '</ul></div>';
}

/* ------------------------------------------------------------------ */
/* ВАЛЮТИ                                                              */
/* Багато наших людей зараз у Європі, тому «30 євро» має лишатись      */
/* тридцятьма євро, а в підсумки йти вже перерахованим.                */
/* ------------------------------------------------------------------ */
var CUR_SIGN = { UAH: '₴', USD: '$', EUR: '€', PLN: 'zł' };
var CUR_LIST = ['UAH', 'EUR', 'USD', 'PLN'];

function amt(r) {
  var c = r && r.cur && CUR_SIGN[r.cur] ? r.cur : 'UAH';
  var v = r ? (r.cost != null ? r.cost : r.amount) : 0;
  return c === 'USD' ? '$' + nfmt(v) : nfmt(v) + ' ' + CUR_SIGN[c];
}
function costUah(r) {
  if (!r) return 0;
  if (r.uah != null) return r.uah;
  var v = r.cost != null ? r.cost : (r.amount || 0);
  var k = (CFG.rates && CFG.rates[r.cur]) || 1;
  return v * k;
}
function curPicker(id, val) {
  return '<div class="field"><label>Валюта</label><div class="seg" id="' + id + '">' +
    CUR_LIST.map(function (c) {
      return '<button type="button" data-v="' + c + '" class="' + ((val || 'UAH') === c ? 'on' : '') + '">' +
        (c === 'UAH' ? '₴ грн' : c === 'EUR' ? '€ євро' : c === 'USD' ? '$ дол' : 'zł злот') + '</button>';
    }).join('') + '</div></div>';
}
function pickedCur(id) {
  var b = document.querySelector('#' + id + ' button.on');
  return b ? b.dataset.v : 'UAH';
}

/* ------------------------------------------------------------------ */
/* ПОШУК ЗА НОМЕРНИМ ЗНАКОМ                                            */
/* ------------------------------------------------------------------ */
function drawPlate() {
  var el = $('#s-plate');
  if (!el) return;
  el.innerHTML =
    '<div class="card">' +
      '<div class="chat-head" style="padding:0 0 12px">' +
        '<div class="ic-box">' + ic('idcard', 20) + '</div>' +
        '<div style="flex:1;min-width:0"><b style="display:block;font-size:15px;font-weight:700">Пошук за номером</b>' +
        '<small style="color:var(--mut);font-size:12px">' +
          (!CFG.plates ? 'ще не підключено' : PRO ? 'державний реєстр' : 'у Преміумі') +
          '</small></div></div>' +
      '<p style="margin:0 0 13px;font-size:12.5px;color:var(--mut);line-height:1.5">' +
        'Марка, модель, рік, обʼєм двигуна, колір, регіон і дата останньої ' +
        'реєстрації. Зручно перед оглядом авто — видно, чи збігається з оголошенням, ' +
        'і чи не числиться авто в розшуку.</p>' +
      '<div class="field"><input id="plIn" type="text" placeholder="АА1234ВВ" maxlength="10" autocomplete="off"></div>' +
      '<button class="btn" data-do="plateGo">Знайти' + (PRO ? '' : lockIc()) + '</button>' +
    '</div>' +
    (!CFG.plates
      ? '<div class="note">Джерело даних поки не підключене. Щойно зʼявиться — ' +
        'пошук почне працювати без оновлення застосунку.</div>'
      : '') +
    '<div id="plOut"></div>' +
    '<div class="note">Дані про власника не показуються — це персональні дані, ' +
    'і в реєстрі відкритої частини їх немає.</div>';
}

function plateCard(c) {
  var h = '';

  if (c.photo)
    h += '<div class="vin-model" style="background-image:url(' + esc(c.photo) + ')"></div>' +
         '<div class="vin-credit">' +
         (c.photoFrom === 'Вікіпедія' ? 'Так виглядає ця модель · фото з Вікіпедії'
                                      : 'Фото моделі з каталогу реєстру') + '</div>';

  if (c.isStolen)
    h += '<div class="msg er"><b>Авто числиться в розшуку.</b>' +
         (c.stolen && c.stolen.date ? ' Заявлено ' + esc(c.stolen.date) + '.' : '') +
         ' Будьте обережні й не поспішайте з завдатком.</div>';

  h += '<div class="card"><div class="h3">' + esc(c.plate) + '</div>' +
    kv('Авто', [c.year, c.make, c.model].filter(Boolean).join(' ')) +
    kv('Колір', c.color) +
    kv('Тип', [c.kind, c.body].filter(Boolean).join(' · ')) +
    kv('Обʼєм двигуна', c.engine ? nfmt(c.engine) + ' см³' : '') +
    kv('Регіон', c.region) +
    kv('VIN', c.vin) +
    '</div>';

  if (c.date || c.operation)
    h += '<div class="card"><div class="h3">Остання реєстрація</div>' +
      kv('Дата', c.date) +
      kv('Що саме', c.opGroup || c.operation) +
      kv('Підрозділ', c.dept) +
      (c.ops > 1 ? '<div class="kv"><span>Реєстрацій усього</span><b>' + c.ops + '</b></div>' : '') +
      '</div>';

  if (!c.vin)
    h += '<div class="note">VIN у відкритій частині реєстру є лише для авто, ' +
         'зареєстрованих з 2021 року. Для старіших його не показують — це не помилка.</div>';

  if (c.vin)
    h += '<button class="btn sec" data-do="plateToVin" data-vin="' + esc(c.vin) + '">' +
         'Перевірити цей VIN</button>';

  return h;
}

/* ------------------------------------------------------------------ */
/* ГОЛОСОМ З ЕКРАНА БЛОКУВАННЯ                                         */
/* Ключ замінює вхід, тому показуємо його тільки преміуму й даємо      */
/* можливість перевипустити.                                            */
/* ------------------------------------------------------------------ */
var VTOKEN = null;

/* ------------------------------------------------------------------ */
/* ГОЛОСОМ                                                             */
/* Головний шлях — просто надиктувати боту. Ярлик на iPhone — приємний */
/* додаток, а не основа, тому він нижче й згорнутий.                   */
/* ------------------------------------------------------------------ */
function drawVoice() {
  var el = $('#s-voice');
  if (!el) return;
  if (PRO && !VTOKEN) loadToken();

  var head =
    '<div class="card">' +
      '<div class="chat-head" style="padding:0 0 12px">' +
        '<div class="ic-box">' + ic('chat', 20) + '</div>' +
        '<div style="flex:1;min-width:0"><b style="display:block;font-size:15px;font-weight:700">' +
          'Записувати голосом' + (PRO ? '' : lockIc()) + '</b>' +
        '<small style="color:var(--mut);font-size:12px">' +
          (PRO ? 'працює в чаті з ботом' : 'у Преміумі') + '</small></div></div>' +
      '<p style="margin:0 0 14px;font-size:13.5px;color:var(--ink2);line-height:1.6">' +
        'Відкрийте чат із ботом, затисніть мікрофон і скажіть звичайними словами. ' +
        'Я розберу й запишу — форму заповнювати не треба.</p>' +
      '<div class="say">«Залив 42 літри на 1850»</div>' +
      '<div class="say">«Поміняв масло, 2400»</div>' +
      '<div class="say">«Заправився на 30 євро»</div>' +
      '<div class="say">«Прийшов штраф 850»</div>' +
      '<p style="margin:12px 0 0;font-size:12.5px;color:var(--mut);line-height:1.5">' +
        'Розумію українську й російську. Можна сказати кілька справ одразу — ' +
        'кожна ляже своїм записом. Валюту теж чую: євро, долари, злоті.</p>' +
      (PRO ? '<button class="btn" style="margin-top:13px" data-do="openBot">Відкрити чат із ботом</button>'
           : '<button class="btn" style="margin-top:13px" data-do="needPro" data-w="voice">Що дає Преміум</button>') +
    '</div>';

  if (!PRO) { el.innerHTML = head; return; }

  var t = VTOKEN;
  el.innerHTML = head +
    '<div class="h2">Швидше: без відкривання чату</div>' +
    '<div class="card">' +
      '<p style="margin:0 0 12px;font-size:13px;color:var(--ink2);line-height:1.6">' +
      'Разова настройка — і запис робиться, не розблоковуючи телефон. ' +
      'Обирайте свій телефон.</p>' +
      '<div class="seg" id="vTabs">' +
        '<button type="button" class="on" data-v="ios">iPhone</button>' +
        '<button type="button" data-v="android">Android</button>' +
      '</div>' +

      '<div id="vIos" style="margin-top:14px">' +
        '<div class="steps">' +
          '<div><i>1</i><div><b>Скопіюйте свій ключ</b>' +
            '<p>Він замінює вхід — нікому не пересилайте.</p>' +
            '<div class="tokenbox"><code>' + esc(t ? t.token : '…') + '</code>' +
            '<button class="chip gh" data-do="tokCopy">Копіювати</button></div></div></div>' +
          '<div><i>2</i><div><b>Застосунок «Команди»</b>' +
            '<p>Він уже є на кожному iPhone. Плюс угорі → «Нова команда».</p></div></div>' +
          '<div><i>3</i><div><b>Дія «Диктувати текст»</b>' +
            '<p>У пошуку напишіть «диктувати». Мову поставте українську.</p></div></div>' +
          '<div><i>4</i><div><b>Дія «Отримати вміст URL-адреси»</b>' +
            '<p>Вставте цю адресу:</p>' +
            '<div class="tokenbox"><code>' + esc(t ? t.url : '…') + '</code>' +
            '<button class="chip gh" data-do="urlCopy">Копіювати</button></div>' +
            '<p style="margin-top:8px">«Показати більше» → Спосіб <b>POST</b>, ' +
            'Тіло запиту <b>JSON</b>, поле <b>text</b> зі значенням ' +
            '<b>Диктований текст</b>.</p></div></div>' +
          '<div><i>5</i><div><b>Повісьте на кнопку</b>' +
            '<p>Налаштування → <b>Action Button</b> → Команда. Це бічна кнопка над ' +
            'гойдалкою гучності на iPhone 15 Pro і новіших. До застосунку «Дія» ' +
            'вона стосунку не має.<br>' +
            'Немає такої кнопки — Налаштування → Універсальний доступ → Дотик → ' +
            'Дотик до задньої панелі → Подвійний дотик.</p></div></div>' +
        '</div>' +
      '</div>' +

      '<div id="vAndroid" class="hidden" style="margin-top:14px">' +
        '<div class="steps">' +
          '<div><i>1</i><div><b>Скопіюйте свій ключ</b>' +
            '<div class="tokenbox"><code>' + esc(t ? t.token : '…') + '</code>' +
            '<button class="chip gh" data-do="tokCopy">Копіювати</button></div></div></div>' +
          '<div><i>2</i><div><b>Встановіть «HTTP Shortcuts»</b>' +
            '<p>Безкоштовний застосунок у Google Play. Він робить те саме, ' +
            'що «Команди» на iPhone.</p></div></div>' +
          '<div><i>3</i><div><b>Створіть запит</b>' +
            '<p>Спосіб <b>POST</b>, адреса:</p>' +
            '<div class="tokenbox"><code>' + esc(t ? t.url : '…') + '</code>' +
            '<button class="chip gh" data-do="urlCopy">Копіювати</button></div>' +
            '<p style="margin-top:8px">Тіло — <b>JSON</b>: <code class="mini">' +
            '{"text":"{{Питання}}"}</code>, де «Питання» — змінна з голосовим вводом.</p></div></div>' +
          '<div><i>4</i><div><b>Винесіть на робочий стіл</b>' +
            '<p>Довге натискання на запит → «Додати на головний екран». ' +
            'Або повісьте на жест у налаштуваннях телефона.</p></div></div>' +
        '</div>' +
        '<div class="note" style="margin-bottom:0">Якщо возитись не хочеться — ' +
        'просто диктуйте боту. Це той самий результат, лише на два дотики довше.</div>' +
      '</div>' +
    '</div>' +

    '<div class="card"><div class="card-h"><b>Ключ</b><span>якщо кудись засвітився</span></div>' +
      '<button class="btn sec" data-do="tokReset">Видати новий ключ</button>' +
      '<div class="note" style="margin-bottom:0">Старий одразу перестане працювати.</div></div>';
}

function loadToken(cb) {
  if (VTOKEN) return;
  api('/api/token', {}).then(function (d) {
    if (d.ok) VTOKEN = { token: d.token, url: d.url };
    if (cb) cb();
    drawVoice();
  }).catch(function () { if (cb) cb(); });
}

/* ---------- ДТП ---------- */
function drawCrash() {
  var car = activeCar();

  var steps = [
    ['Зупиніться і не рухайте авто',
     'Аварійка, знак: 20 м у місті, 40 м за містом. Пересунути машину можна тільки якщо вона ' +
     'повністю перекрила рух — і лише після того, як зафіксували положення на фото.'],
    ['Перевірте, чи всі цілі',
     'Є потерпілі — 103 і 102 негайно. Залишити місце ДТП із потерпілими це кримінальна стаття, ' +
     'а не штраф. Надайте допомогу, якщо вмієте.'],
    ['Фотографуйте до того, як щось зрушите',
     'Загальний план з розміткою і знаками · обидва номери · усі пошкодження зблизька · ' +
     'сліди гальмування · position коліс · документи другого водія. Краще 30 фото, ніж потім доводити.'],
    ['Зберіть дані другого учасника',
     'ПІБ, телефон, номер авто, серія полісу і назва страховика. Сфотографуйте його поліс і права — ' +
     'це швидше й надійніше, ніж переписувати.'],
    ['Знайдіть свідків',
     'Запишіть телефон хоча б одного. Якщо поруч є камери — запамʼятайте, де саме: записи затирають ' +
     'за кілька днів, і встигнути треба самому.'],
    ['Європротокол або поліція',
     'Європротокол можна, якщо: немає потерпілих, лише два авто, обидва на ходу, обидва мають чинний ' +
     'ОСЦПВ і немає спору про винного. Хоч одна умова не виконана — викликайте поліцію.'],
    ['Повідомте страховика того ж дня',
     'За правилами ОСЦПВ на повідомлення дається обмежений строк. Затягнули — страховик має підставу ' +
     'зменшити або не виплатити.'],
  ];

  var never = [
    'Не визнавайте провину на місці. Винного визначає поліція або страховик, а не ви на емоціях.',
    'Не підписуйте порожніх чи незаповнених бланків.',
    'Не домовляйтесь «на місці за готівку», якщо пошкодження не очевидно дрібні — приховані ' +
    'наслідки виявляються на СТО, і повернутись до цього питання вже не вийде.',
    'Не сідайте за кермо, якщо вас трусить. Пʼятнадцять хвилин нічого не змінять.',
  ];

  $('#s-crash').innerHTML =
    '<div class="card" style="border-left:3px solid var(--bad)">' +
      '<div style="font-family:var(--disp);font-weight:700;font-size:17px;margin-bottom:6px">Спокійно. По порядку.</div>' +
      '<p style="margin:0;font-size:13px;color:var(--mut);line-height:1.55">' +
      'Сім кроків. Перші три вирішують, чи отримаєте ви виплату.</p></div>' +

    '<div class="grid2" style="margin-top:11px">' +
      '<a class="btn dan" href="tel:102" style="text-decoration:none">Поліція 102</a>' +
      '<a class="btn dan" href="tel:103" style="text-decoration:none">Швидка 103</a>' +
    '</div>' +

    '<div class="h2">Що робити</div>' +
    '<div class="card list">' + steps.map(function (x, i) {
      return '<div class="it" style="align-items:flex-start">' +
        '<div class="dt" style="background:var(--lime);color:#10130E;font-family:var(--disp);font-weight:800;font-size:13px">' + (i + 1) + '</div>' +
        '<div class="tx"><b style="white-space:normal;line-height:1.35">' + x[0] + '</b>' +
        '<small style="display:block;margin-top:4px;line-height:1.5">' + x[1] + '</small></div></div>';
    }).join('') + '</div>' +

    '<div class="h2">Чого не робити ніколи</div>' +
    '<div class="card">' + never.map(function (t, i) {
      return '<div class="kv" style="align-items:flex-start"><span style="color:var(--bad);flex:0 0 auto;font-weight:700">—</span>' +
        '<b style="text-align:left;font-weight:500;font-size:13px;line-height:1.5;color:var(--ink2)">' + t + '</b></div>';
    }).join('') + '</div>' +

    (car ? '<div class="h2">Ваші дані під рукою</div><div class="card">' +
      '<div class="kv"><span>Авто</span><b>' + esc(carName(car)) + (car.year ? ', ' + car.year : '') + '</b></div>' +
      (car.plate ? '<div class="kv"><span>Номер</span><b>' + esc(car.plate) + '</b></div>' : '') +
      (car.vin ? '<div class="kv"><span>VIN</span><b style="font-size:12px">' + esc(car.vin) + '</b></div>' : '') +
      (car.insuranceEnd ? '<div class="kv"><span>ОСЦПВ діє до</span><b>' + fmtDate(car.insuranceEnd) + '</b></div>' : '') +
      '</div><button class="btn sec" style="margin-top:10px" data-do="copyCar">Скопіювати дані авто</button>' : '') +

    '<div class="note">Це орієнтир, а не юридична консультація. У складній ситуації тримайте звʼязок ' +
    'зі своїм страховиком — саме він оплачує ремонт.</div>';
}

/* ---------- МОЇ АВТО ---------- */
function drawCars() {
  var h = '';
  if (S.cars.length) {
    h += '<div class="card list">' + S.cars.map(function (c) {
      return '<button class="it" data-do="editCar" data-id="' + c.id + '">' +
        '<div class="dt">' + ic(c.fuel === 'electric' ? 'ev' : 'car', 17) + '</div>' +
        '<div class="tx"><b>' + esc(carName(c)) + '</b><small>' +
        [c.plate, nfmt(c.odo) + ' км'].filter(Boolean).join(' · ') + '</small></div><div class="ar">›</div></button>';
    }).join('') + '</div>';
  }
  h += '<button class="btn" style="margin-top:11px" data-do="addCar">Додати авто</button>';
  if (!PRO && S.cars.length >= (CFG.freeCars || 1))
    h += '<div class="note">Безкоштовно — одне авто. Преміум знімає обмеження.</div>';
  $('#s-cars').innerHTML = h;
}

/* ------------------------------------------------------------------ */
/* ФОРМИ                                                               */
/* ------------------------------------------------------------------ */
function fld(id, label, opts) {
  opts = opts || {};
  return '<div class="field"><label for="' + id + '">' + label + '</label>' +
    '<input id="' + id + '" type="' + (opts.type || 'text') + '"' +
    (opts.mode ? ' inputmode="' + opts.mode + '"' : '') +
    (opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : '') +
    (opts.val != null && opts.val !== '' ? ' value="' + esc(opts.val) + '"' : '') +
    (opts.max ? ' maxlength="' + opts.max + '"' : '') + '></div>';
}
function val(id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; }
function numv(id) { var v = val(id).replace(',', '.').replace(/\s/g, ''); return v === '' ? null : parseFloat(v); }

function formCar(car) {
  FUEL_AUTO = false;
  var c = car || {};
  var fuels = ['petrol', 'diesel', 'hybrid', 'electric', 'gas'];
  return '<div id="carForm" data-id="' + (c.id || '') + '">' +
    '<div class="two">' + fld('cMake', 'Марка', { ph: 'Toyota', val: c.make, max: 40 }) +
                          fld('cModel', 'Модель', { ph: 'RAV4', val: c.model, max: 40 }) + '</div>' +
    '<div class="two">' + fld('cYear', 'Рік', { mode: 'numeric', ph: '2019', val: c.year }) +
                          fld('cPlate', 'Номер', { ph: 'АА1234ВС', val: c.plate, max: 16 }) + '</div>' +
    '<div class="field"><label>Паливо</label><div class="seg" id="cFuel">' +
      fuels.map(function (f) {
        return '<button type="button" data-v="' + f + '" class="' + ((c.fuel || 'petrol') === f ? 'on' : '') + '">' + FUEL_UA[f] + '</button>';
      }).join('') + '</div></div>' +
    '<div class="field"><label>Кузов<small style="color:var(--mut);font-weight:500"> — щоб намалювати ваше авто</small></label>' +
      '<div class="seg wrap" id="cBody">' +
        Object.keys(BODY_UA).map(function (b) {
          return '<button type="button" data-v="' + b + '" class="' + (c.body === b ? 'on' : '') + '">' + BODY_UA[b] + '</button>';
        }).join('') + '</div></div>' +
    '<div id="cGuess"></div>' +
    '<div id="cEngineBox">' + fld('cEngine', 'Об’єм двигуна, л', { mode: 'decimal', ph: '2.0', val: c.engine ? (c.engine / 1000).toFixed(1) : '' }) + '</div>' +
    '<div id="cEvBox" class="hidden"><div class="two">' +
      fld('cBattery', 'Батарея, кВт·год', { mode: 'decimal', ph: '64', val: c.battery }) +
      fld('cSoh', 'Здоров’я батареї, %', { mode: 'numeric', ph: '92', val: c.soh }) + '</div></div>' +
    fld('cOdo', 'Пробіг, км', { mode: 'numeric', ph: '87400', val: c.odo || '' }) +
    fld('cVin', 'VIN (не обов’язково)', { ph: '17 символів', val: c.vin, max: 20 }) +
    '<div class="two">' + fld('cIns', 'ОСЦПВ діє до', { type: 'date', val: c.insuranceEnd }) +
                          fld('cGreen', 'Зелена карта до', { type: 'date', val: c.greenEnd }) + '</div>' +
    '<div id="cOilBox"' + (c.fuel === 'electric' ? ' class="hidden"' : '') + '>' +
      fld('cOil', 'Пробіг останньої заміни масла', { mode: 'numeric', ph: 'напр. 82000', val: c.lastOilOdo }) + '</div>' +
    '<div id="carErr"></div>' +
    '<button class="btn" data-do="saveCar">' + (c.id ? 'Зберегти' : 'Додати авто') + '</button>' +
    (c.id ? '<button class="btn dan" data-do="delCar" data-id="' + c.id + '">Видалити авто</button>' : '') +
    '</div>';
}

/* Щойно вписали марку й модель — підставляємо кузов і паливо самі.
   Саме тут ловиться «Tesla на бензині»: марка без ДВЗ не може бути бензиновою. */
var FUEL_AUTO = false;   // паливо поставив застосунок, а не людина

function applyGuess() {
  var mk = val('cMake'), md = val('cModel');
  var box = document.getElementById('cGuess');
  if (!box) return;
  if (!mk && !md) { box.innerHTML = ''; return; }

  var g = guessCar(mk, md);
  var msg = '';

  if (g.body) {
    var b = document.querySelector('#cBody button[data-v="' + g.body + '"]');
    var chosen = document.querySelector('#cBody button.on');
    if (b && (!chosen || !chosen.dataset.userSet)) {
      Array.prototype.forEach.call(document.querySelectorAll('#cBody button'),
        function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      msg += 'Кузов: ' + BODY_UA[g.body] + '. ';
    }
  }

  var cur = document.querySelector('#cFuel button.on');
  var userChose = cur && cur.dataset.userSet;
  if (!userChose) {
    /* якщо модель відома — беремо її паливо; якщо модель буває різна,
       а ми раніше самі поставили електро — повертаємо бензин */
    var target = g.fuel || (FUEL_AUTO ? 'petrol' : null);
    var want = target ? document.querySelector('#cFuel button[data-v="' + target + '"]') : null;
    if (want && cur && cur.dataset.v !== target) {
      Array.prototype.forEach.call(document.querySelectorAll('#cFuel button'),
        function (x) { x.classList.remove('on'); });
      want.classList.add('on');
      FUEL_AUTO = !!g.fuel;
      syncFuelBoxes();
      if (g.fuel) msg += (g.fuel === 'electric' ? 'Це електромобіль — переставив паливо.'
                                                : 'Паливо: ' + FUEL_UA[g.fuel] + '.');
    }
  }

  box.innerHTML = msg ? '<div class="msg inf" style="margin:0 0 12px">' + esc(msg) + '</div>' : '';
}

function syncFuelBoxes() {
  var on = document.querySelector('#cFuel button.on');
  var ev = on && on.dataset.v === 'electric';
  var eb = document.getElementById('cEngineBox'), vb = document.getElementById('cEvBox');
  if (eb) eb.classList.toggle('hidden', !!ev);
  if (vb) vb.classList.toggle('hidden', !ev);
  var ob = document.getElementById('cOilBox');
  if (ob) ob.classList.toggle('hidden', !!ev);      // електрокару масло не міняють
}

/* ------------------------------------------------------------------ */
/* ДІЇ                                                                 */
/* ------------------------------------------------------------------ */
var DO = {
  tourDone: function () { markSeen('tour'); show('s-home'); render(); DO.addCar(); },

  addCar: function () { openSheet('Нове авто', formCar(null)); syncFuelBoxes(); },

  editCar: function (t) {
    var c = S.cars.filter(function (x) { return x.id === t.dataset.id; })[0];
    if (c) { openSheet(carName(c), formCar(c)); syncFuelBoxes(); }
  },

  saveCar: function () {
    var id = document.getElementById('carForm').dataset.id;
    var on = document.querySelector('#cFuel button.on');
    var fuel = on ? on.dataset.v : 'petrol';
    var eng = numv('cEngine');
    var car = {
      make: val('cMake'), model: val('cModel'), plate: val('cPlate'),
      year: numv('cYear'), fuel: fuel, vin: val('cVin'),
      engine: fuel === 'electric' ? null : (eng != null ? Math.round(eng < 20 ? eng * 1000 : eng) : null),
      battery: fuel === 'electric' ? numv('cBattery') : null,
      soh: fuel === 'electric' ? numv('cSoh') : null,
      odo: numv('cOdo') || 0,
      insuranceEnd: val('cIns') || null,
      greenEnd: val('cGreen') || null,
      lastOilOdo: fuel === 'electric' ? null : numv('cOil'),
      body: (document.querySelector('#cBody button.on') || {}).dataset
              ? document.querySelector('#cBody button.on').dataset.v : null,
    };
    if (!car.make && !car.model && !car.plate) {
      document.getElementById('carErr').innerHTML = '<div class="msg er">Вкажіть хоча б марку або номер.</div>';
      return;
    }
    act(id ? { action: 'editCar', id: id, car: car } : { action: 'addCar', car: car }, closeSheet);
  },

  delCar: function (t) {
    var id = t.dataset.id;
    ask('Видалити авто?', 'Разом із ним зникне вся історія: сервіс, заправки, штрафи.',
        'Видалити', function () { act({ action: 'delCar', id: id }, closeSheet); });
  },

  pickCar: function (t) { act({ action: 'setActive', id: t.dataset.id }); },

  editThis: function () {
    var c = activeCar(); if (!c) return;
    openSheet(carName(c), formCar(c)); syncFuelBoxes();
  },

  period: function (t) {
    PERIOD = parseInt(t.dataset.v, 10);
    DIRTY['s-money'] = 0; drawMoney(); haptic('light');
  },

  remAdd:  function () { remForm(); },
  remQuick: function (t) {
    var x = REM_SUG[+t.dataset.i];
    if (!x) return;
    act({ action: 'addRem', title: x.t, odo: x.odo || null, every: x.every || null, date: x.date || null });
    toast('Нагадування додано', 'ok');
  },
  remSave: function () {
    var pre = document.querySelector('#rPreset button.on');
    var mode = (document.querySelector('#rMode button.on') || {}).dataset;
    var byOdo = !mode || mode.v === 'odo';
    var title = val('rTitle') || (pre ? REM_PRESETS[+pre.dataset.v].t : '');
    if (!title) { document.getElementById('rErr').innerHTML =
      '<div class="msg er">Вкажіть, про що нагадати.</div>'; return; }
    act({ action: 'addRem', title: title,
          odo: byOdo ? numv('rOdo') : null,
          every: byOdo ? numv('rEvery') : null,
          date: byOdo ? null : val('rDate') }, closeSheet);
  },
  remDone: function (t) { act({ action: 'doneRem', id: t.dataset.id }); },
  remDel:  function (t) { act({ action: 'delRem', id: t.dataset.id }); },

  askYes: function () {
    var cb = ASK_CB; ASK_CB = null; closeSheet();
    if (cb) setTimeout(cb, 60);
  },

  needPro: function (t) { needPro(t.dataset.w); },

  noticeOpen: function () {
    var nt = CFG.notice;
    if (!nt) return;
    openSheet(nt.title || 'Повідомлення',
      '<p style="margin:0 0 18px;font-size:14.5px;color:var(--ink2);line-height:1.65">' +
        esc(nt.text) + '</p>' +
      '<button class="btn" data-do="noticeOk">Добре</button>');
  },
  noticeOk: function () {
    if (CFG.notice) markSeen('nt_' + CFG.notice.id);
    closeSheet();
    DIRTY['s-home'] = 0; drawHome();
  },

  tip: function () {
    if (!CFG.usdt) { toast('Гаманець ще не вказано'); return; }
    openSheet('Підтримати розробника',
      '<p style="margin:0 0 14px;font-size:13.5px;color:var(--ink2);line-height:1.6">' +
      'Переказ у USDT, мережа TRC-20. Скільки не шкода — фіксованої суми немає. ' +
      'Нічого не відкриває, це просто подяка.</p>' +
      (CFG.usdt === QR_FOR ? '<div class="card" style="text-align:center">' +
        '<img src="usdt-qr.png" alt="QR гаманця" ' +
        'style="width:170px;max-width:55%;border-radius:16px;display:block;margin:0 auto 12px">' +
        '<div class="addr">' + esc(CFG.usdt) + '</div></div>'
        : '<div class="card"><div class="addr">' + esc(CFG.usdt) + '</div></div>') +
      '<button class="btn" data-do="sendSelf" data-w="wallet">Надіслати адресу в бот</button>' +
      '<button class="btn sec" data-do="copyAddr" data-a="' + esc(CFG.usdt) + '">Скопіювати адресу</button>' +
      '<div class="note" style="margin-bottom:0">Дякую. Серйозно.</div>');
  },

  keyCopy: function (t) { copy(t.dataset.c); toast('Код скопійовано'); },

  sendSelf: function (t) {
    var body = { what: t.dataset.w };
    if (t.dataset.amount) body.amount = t.dataset.amount;
    if (t.dataset.code) body.code = t.dataset.code;
    t.disabled = true;
    api('/api/send', body).then(function (d) {
      t.disabled = false;
      if (!d.ok) { toast(d.error || 'Не вдалося надіслати', 'er'); return; }
      toast('Надіслано в чат бота', 'ok');
      haptic('light');
    }).catch(function () { t.disabled = false; toast('Немає звʼязку', 'er'); });
  },

  keyShow: function () {
    var raw;
    try { raw = localStorage.getItem(KEY_STORE); } catch (e) { raw = null; }
    if (!raw) { toast('Ключа ще нема'); return; }
    var code = codeFromKey(unb64(raw));
    openSheet('Код відновлення',
      '<p style="margin:0 0 14px;font-size:13.5px;color:var(--ink2);line-height:1.6">' +
      'Це ваш персональний ключ у зручному вигляді. Він потрібен, якщо відкриватимете ' +
      'документи на іншому телефоні.</p>' +
      '<div class="tokenbox"><code>' + esc(code) + '</code></div>' +
      '<button class="btn sec" style="margin-top:9px" data-do="sendSelf" data-w="reccode" ' +
        'data-code="' + esc(code) + '">Надіслати код собі в бот</button>' +
      '<button class="btn" data-close="1">Готово</button>');
  },


  keyOk:   function () { var cb = KEY_NEXT; KEY_NEXT = null; closeSheet(); if (cb) setTimeout(cb, 80); },
  keyRestore: function () {
    openSheet('Код відновлення',
      '<p style="margin:0 0 14px;font-size:13.5px;color:var(--ink2);line-height:1.6">' +
      'Введіть код, який ви зберегли, коли додавали документи вперше.</p>' +
      fld('keyIn', 'Код', { ph: 'ABCD-EFGH-JKLM' }) +
      '<div id="keyErr"></div>' +
      '<button class="btn" data-do="keyApply">Відновити доступ</button>');
  },
  keyApply: function () {
    if (restoreKey(val('keyIn'))) {
      DOC_IMG = {}; closeSheet(); drawDocs(); toast('Ключ прийнято');
    } else {
      document.getElementById('keyErr').innerHTML =
        '<div class="msg er">Код закороткий або з помилкою.</div>';
    }
  },

  plateGo: function () {
    if (!PRO) { needPro('plate'); return; }
    var out = document.getElementById('plOut');
    if (!CFG.plates) {
      out.innerHTML = '<div class="msg er">Джерело даних поки не підключене — ' +
        'пошук за номером тимчасово не працює.</div>';
      return;
    }
    var v = val('plIn');
    if (!v) { out.innerHTML = '<div class="msg er">Впишіть номерний знак.</div>'; return; }
    out.innerHTML = '<div class="msg inf">Шукаю…</div>';
    api('/api/plate', { plate: v }).then(function (d) {
      if (!d.ok) {
        if (d.error === 'premium') { out.innerHTML = ''; needPro('plate'); return; }
        /* показуємо людський текст, а не службовий код помилки */
        out.innerHTML = '<div class="msg er">' +
          esc(d.message || d.error || 'Не вдалося виконати пошук.') + '</div>';
        return;
      }
      if (!d.car) { out.innerHTML = '<div class="msg er">' +
        esc(d.message || 'За цим номером нічого не знайшлось.') + '</div>'; return; }
      out.innerHTML = plateCard(d.car);
      haptic('medium');
    }).catch(function () { out.innerHTML = '<div class="msg er">Немає звʼязку.</div>'; });
  },
  plateToVin: function (t) {
    show('s-vin');
    var i = document.getElementById('vinIn');
    if (i) { i.value = t.dataset.vin; DO.vinGo(); }
  },

  tokCopy: function () { if (VTOKEN) { copy(VTOKEN.token); toast('Ключ скопійовано', 'ok'); } },
  urlCopy: function () { if (VTOKEN) { copy(VTOKEN.url); toast('Адресу скопійовано', 'ok'); } },
  openBot: function () {
    var link = (REF && REF.link) ? REF.link.split('?')[0] : '';
    try {
      if (link && tg && tg.openTelegramLink) { tg.openTelegramLink(link); return; }
      if (tg && tg.close) { tg.close(); return; }
    } catch (e) {}
    toast('Відкрийте чат із ботом і затисніть мікрофон');
  },
  tokReset: function () {
    ask('Видати новий ключ?', 'Старий перестане працювати одразу. Доведеться вписати новий у команду.',
        'Видати', function () {
      api('/api/token', { reset: 1 }).then(function (d) {
        if (d.ok) { VTOKEN = { token: d.token, url: d.url }; drawVoice(); toast('Готово'); }
      });
    });
  },

  welNext: function () { WEL = Math.min(WEL + 1, WELCOME.length - 1); drawWelcome(); haptic('light'); },
  welBack: function () { WEL = Math.max(0, WEL - 1); drawWelcome(); },
  welDone: function () { closeSheet(); DIRTY = {}; render(); },

  storyNext: function () { STORY = Math.min(STORY + 1, STORIES.length - 1); drawTour(); haptic('light'); },
  storyBack: function () { STORY = Math.max(0, STORY - 1); drawTour(); },

  report: function () { sendReport(); },
  moneyReport: function () { sendMoneyReport(); },

  docAdd:  function () { docPick(); },
  docShoot: function () { docShoot(); },
  docOpen: function (t) { docOpen(t.dataset.id); },
  docDel:  function (t) {
    var id = t.dataset.id;
    ask('Прибрати документ?', 'Знімок буде видалено назавжди.', 'Прибрати', function () {
    api('/api/doc', { remove: 1, id: id }).then(function (d) {
      if (d.ok) { DOCS = d.docs || []; delete DOC_IMG[id]; closeSheet(); drawDocs(); }
      else toast(d.error || 'Не вдалося');
    });
    });
  },


  odo: function () {
    var car = activeCar(); if (!car) return;
    openSheet('Пробіг', fld('oOdo', 'Скільки зараз на одометрі, км', { mode: 'numeric', val: car.odo }) +
      '<div id="oErr"></div><button class="btn" data-do="saveOdo">Зберегти</button>');
  },
  saveOdo: function () {
    var v = numv('oOdo');
    if (v == null) { document.getElementById('oErr').innerHTML = '<div class="msg er">Введіть число.</div>'; return; }
    act({ action: 'odo', odo: v }, closeSheet);
  },

  fuel: function () {
    var car = activeCar(); if (!car) { toast('Спочатку додайте авто'); return; }
    var ev = car.fuel === 'electric';
    openSheet(ev ? 'Зарядка' : 'Заправка',
      '<div class="two">' +
        fld('fQty', ev ? 'кВт·год' : 'Літрів', { mode: 'decimal', ph: ev ? '32' : '40' }) +
        fld('fCost', 'Сума', { mode: 'decimal', ph: '1800' }) + '</div>' +
      curPicker('fCur') +
      fld('fOdo', 'Пробіг, км', { mode: 'numeric', val: car.odo }) +
      '<div class="two">' + fld('fStation', ev ? 'Станція' : 'АЗС', { ph: ev ? 'YASNO' : 'OKKO', max: 40 }) +
                            fld('fDate', 'Дата', { type: 'date', val: today() }) + '</div>' +
      '<div class="field"><label>' + (ev ? 'Скільки зарядили' : 'Скільки залили') + '</label>' +
        '<div class="seg" id="fFull">' +
          '<button type="button" data-v="1" class="on">' + (ev ? 'До 100%' : 'Повний бак') + '</button>' +
          '<button type="button" data-v="0">' + (ev ? 'Частково' : 'Не повний') + '</button>' +
        '</div></div>' +
      '<div class="note" style="margin:0 0 12px">Витрату можна порахувати тільки між ' +
        (ev ? 'повними зарядами' : 'повними баками') + ' — тому цей вибір важливий.</div>' +
      '<button class="btn" data-do="saveFuel">Зберегти</button>');
  },
  saveFuel: function () {
    var fullBtn = document.querySelector('#fFull button.on');
    act({ action: 'addFuel', qty: numv('fQty') || 0, cost: numv('fCost') || 0,
          cur: pickedCur('fCur'),
          odo: numv('fOdo'), date: val('fDate'), station: val('fStation'),
          full: !fullBtn || fullBtn.dataset.v === '1' }, closeSheet);
  },

  service: function () {
    var car = activeCar(); if (!car) { toast('Спочатку додайте авто'); return; }
    var kinds = Object.keys(KIND_UA);
    openSheet('Запис у сервісну книжку',
      '<div class="field"><label>Що робили</label><div class="seg" id="sKind">' +
        kinds.map(function (k, i) {
          return '<button type="button" data-v="' + k + '" class="' + (i === 0 ? 'on' : '') + '">' + KIND_UA[k] + '</button>';
        }).join('') + '</div></div>' +
      fld('sTitle', 'Опис', { ph: 'Заміна масла та фільтра' }) +
      '<div class="two">' + fld('sCost', 'Вартість', { mode: 'decimal', ph: '2400' }) +
                            fld('sOdo', 'Пробіг, км', { mode: 'numeric', val: car.odo }) + '</div>' +
      curPicker('sCur') +
      fld('sDate', 'Дата', { type: 'date', val: today() }) +
      '<button class="btn" data-do="saveService">Зберегти</button>');
  },
  saveService: function () {
    var on = document.querySelector('#sKind button.on');
    var kind = on ? on.dataset.v : 'other';
    act({ action: 'addService', kind: kind, title: val('sTitle') || KIND_UA[kind],
          cost: numv('sCost') || 0, cur: pickedCur('sCur'),
          odo: numv('sOdo'), date: val('sDate') }, closeSheet);
  },

  expense: function () {
    var car = activeCar(); if (!car) { toast('Спочатку додайте авто'); return; }
    var cats = Object.keys(CAT_UA).filter(function (c) { return c !== 'fine'; });
    openSheet('Витрата',
      '<div class="field"><label>Категорія</label><div class="seg" id="eCat">' +
        cats.map(function (c, i) {
          return '<button type="button" data-v="' + c + '" class="' + (i === 0 ? 'on' : '') + '">' + CAT_UA[c] + '</button>';
        }).join('') + '</div></div>' +
      fld('eTitle', 'Опис', { ph: 'Мийка з хімчисткою' }) +
      '<div class="two">' + fld('eCost', 'Сума', { mode: 'decimal', ph: '350' }) +
                            fld('eDate', 'Дата', { type: 'date', val: today() }) + '</div>' +
      curPicker('eCur') +
      '<button class="btn" data-do="saveExpense">Зберегти</button>');
  },
  saveExpense: function () {
    var on = document.querySelector('#eCat button.on');
    var cat = on ? on.dataset.v : 'other';
    var c = numv('eCost');
    if (c == null) { toast('Вкажіть суму'); return; }
    act({ action: 'addExpense', cat: cat, cur: pickedCur('eCur'), title: val('eTitle') || CAT_UA[cat],
          cost: c, date: val('eDate') }, closeSheet);
  },

  fine: function () {
    var car = activeCar(); if (!car) { toast('Спочатку додайте авто'); return; }
    openSheet('Штраф',
      fld('nTitle', 'За що', { ph: 'Перевищення швидкості' }) +
      '<div class="two">' + fld('nAmount', 'Сума, ₴', { mode: 'decimal', ph: '850' }) +
                            fld('nDate', 'Дата постанови', { type: 'date', val: today() }) + '</div>' +
      '<div class="field"><label>Звідки штраф</label><div class="seg" id="nCam">' +
        '<button type="button" data-v="1" class="on">Камера</button>' +
        '<button type="button" data-v="0">Патрульний</button></div></div>' +
      '<div class="msg inf">Знижка 50% діє тільки на штрафи з камер і лише 10 банківських днів.</div>' +
      '<button class="btn" data-do="saveFine">Зберегти</button>');
  },
  saveFine: function () {
    var on = document.querySelector('#nCam button.on');
    var a = numv('nAmount');
    if (a == null) { toast('Вкажіть суму'); return; }
    act({ action: 'addFine', title: val('nTitle') || 'Штраф', amount: a,
          date: val('nDate'), camera: !on || on.dataset.v === '1' }, closeSheet);
  },
  payFine: function (t) { act({ action: 'payFine', id: t.dataset.id }); },

  delAsk: function (t) {
    var id = t.dataset.id;
    ask('Видалити запис?', 'Він зникне з історії та з підрахунків.', 'Видалити',
        function () { act({ action: 'del', id: id }); });
  },

  vinGo: function () {
    var v = val('vinIn').toUpperCase().replace(/[^A-Z0-9]/g, '');
    var out = document.getElementById('vinOut');
    if (v.length !== 17) { out.innerHTML = '<div class="msg er">VIN має містити рівно 17 символів. Зараз ' + v.length + '.</div>'; return; }
    out.innerHTML = '<div class="msg inf">Перевіряю…</div>';
    api('/api/vin', { vin: v }).then(function (d) {
      if (!d.ok) {
        if (d.error === 'limit') { CFG.vinLeft = 0; drawVin(); needPro('vin'); return; }
        out.innerHTML = '<div class="msg er">' + esc(d.error || 'Не знайдено') + '</div>';
        return;
      }
      if (d.left !== undefined && d.left !== null) CFG.vinLeft = d.left;
      var c = d.car;
      out.innerHTML = vinCard(c, v);
      window.__vin = { vin: v, car: c };
      haptic('medium');
      var badge = document.querySelector('#s-vin .chat-head small');
      if (badge && CFG.vinLeft !== null && CFG.vinLeft !== undefined) {
        badge.textContent = CFG.vinLeft > 0
          ? 'залишилось ' + CFG.vinLeft + ' ' + plural(CFG.vinLeft, 'безкоштовна', 'безкоштовні', 'безкоштовних') + ' ' +
            plural(CFG.vinLeft, 'перевірка', 'перевірки', 'перевірок')
          : 'безкоштовні вичерпані';
      }
    }).catch(function () { out.innerHTML = '<div class="msg er">Немає зв’язку. Спробуйте ще раз.</div>'; });
  },
  vinToCar: function () {
    var d = window.__vin; if (!d) return;
    openSheet('Нове авто', formCar({
      make: d.car.make, model: d.car.model, year: parseInt(d.car.year, 10) || null,
      fuel: d.car.fuel, engine: d.car.engine, battery: d.car.battery, vin: d.vin,
      body: d.car.bodyCode || null,
    }));
    syncFuelBoxes();
  },

  askGo: function () {
    if (CHAT_BUSY) return;
    if (!PRO) { needPro('ai'); return; }
    var t = document.getElementById('askIn');
    var q = t ? t.value.trim() : '';
    if (q.length < 2) return;

    CHAT.push({ role: 'u', text: q });
    CHAT_BUSY = true;
    drawAsk();

    api('/api/ask', {
      q: q, carId: S.activeCar,
      history: CHAT.slice(0, -1).slice(-8),
    }).then(function (d) {
      CHAT_BUSY = false;
      CHAT.push({ role: 'a', text: d.ok ? d.answer : (d.message || d.error || 'Не вдалося відповісти') });
      drawAsk();
      haptic('light');
    }).catch(function () {
      CHAT_BUSY = false;
      CHAT.push({ role: 'a', text: 'Немає звʼязку з сервером. Спробуйте ще раз.' });
      drawAsk();
    });
  },
  chatHint: function (t) {
    var el = document.getElementById('askIn');
    if (el) { el.value = t.dataset.q; }
    DO.askGo();
  },
  chatClear: function () { CHAT = []; drawAsk(); },

  copyCar: function () {
    var c = activeCar(); if (!c) return;
    var L = [carName(c) + (c.year ? ', ' + c.year : '')];
    if (c.plate) L.push('Номер: ' + c.plate);
    if (c.vin) L.push('VIN: ' + c.vin);
    if (c.insuranceEnd) L.push('ОСЦПВ до: ' + fmtDate(c.insuranceEnd));
    copy(L.join('\n'));
    toast('Дані скопійовано');
  },

  voiceHelp: function () {
    openSheet('Голосове внесення',
      '<div class="msg inf">Найпростіше: відкрийте чат із ботом і надиктуйте голосове. Я розберу й запишу.</div>' +
      '<div class="card"><div style="font-weight:700;margin-bottom:8px">Приклади, які я розумію</div>' +
      '<div class="kv"><span>«Залив 42 літри на 1850»</span><b>заправка</b></div>' +
      '<div class="kv"><span>«Поміняв масло, 2400»</span><b>сервіс</b></div>' +
      '<div class="kv"><span>«Прийшов штраф 850»</span><b>штраф</b></div>' +
      '<div class="kv"><span>«Пробіг 87 тисяч 400»</span><b>пробіг</b></div></div>' +
      '<div class="card" style="margin-top:10px"><div style="font-weight:700;margin-bottom:8px">iPhone — кнопка «Дія»</div>' +
      '<p style="margin:0;font-size:12.5px;color:var(--mut);line-height:1.55">' +
      'Налаштування → Кнопка «Дія» → Швидка команда → оберіть команду, яка відкриває чат із ботом. ' +
      'Якщо кнопки немає — Універсальний доступ → Дотик → Постукування по задній панелі.</p></div>' +
      (PRO ? '' : '<div class="note">Голосове внесення працює у Преміумі.</div>'));
  },

  share: function () {
    if (!REF.link) { toast('Посилання ще не готове'); return; }
    var txt = 'Бардачок — нагадує про страховку, ТО і ловить штрафи, поки діє знижка 50%. ' +
              'Записи можна диктувати голосом. За моїм посиланням тобі одразу місяць Преміуму:';
    var u = 'https://t.me/share/url?url=' + encodeURIComponent(REF.link) +
            '&text=' + encodeURIComponent(txt);
    if (tg && tg.openTelegramLink) tg.openTelegramLink(u);
    else window.open(u, '_blank');
  },
  copyRef: function () {
    if (!REF.link) { toast('Посилання ще не готове'); return; }
    copy(REF.link);
    toast('Посилання скопійовано');
  },

  buy: function (t) {
    var p = t.dataset.plan || 'month';
    var price = p === 'year' ? CFG.premiumYear : (p === 'half' ? CFG.premiumHalf : CFG.premiumMonth);
    var pay = CFG.pay || {};
    var name = p === 'year' ? 'Рік' : p === 'half' ? 'Півроку' : 'Місяць';
    var uah = uahOf(price);

    var ways = '';
    if (CFG.usdt) ways += '<button class="btn" data-do="payUsdt" data-plan="' + p + '">Оплатити в USDT</button>';
    if (pay.crypto) ways += '<button class="btn' + (CFG.usdt ? ' sec' : '') + '" data-do="payGo" ' +
                            'data-plan="' + p + '" data-m="crypto">Через @CryptoBot</button>';
    if (pay.card)   ways += '<button class="btn sec" data-do="payGo" data-plan="' + p + '" data-m="card">Карткою</button>';

    openSheet('Преміум · ' + name,
      '<div class="hero" style="margin-bottom:12px">' +
        '<div class="hero-top"><span>До сплати</span>' + ic('star', 18) + '</div>' +
        '<b>' + price + ' USDT</b>' +
        '<small>' + (uah ? uah + ' за курсом НБУ' : 'мережа TRC-20') + '</small></div>' +
      '<div class="card"><div class="kv"><span>Тариф</span><b>' + name + '</b></div>' +
      '<div class="kv"><span>Термін</span><b>' +
        (p === 'year' ? '365 днів' : p === 'half' ? '182 дні' : '30 днів') + '</b></div></div>' +
      '<div id="payErr"></div>' +
      (ways ? ways
            : '<div class="msg inf">Оплата ще не підключена.</div>' +
              (CFG.contactTg ? '<a class="btn" style="text-decoration:none" target="_blank" rel="noopener" ' +
                'href="https://t.me/' + esc(CFG.contactTg) + '">Написати менеджеру</a>' : '')));
  },

  /* переказ напряму на гаманець: показуємо адресу, суму і що робити далі */
  payUsdt: function (t) {
    var p = t.dataset.plan || 'month';
    var box = document.getElementById('payErr');
    if (box) box.innerHTML = '<div class="msg inf">Готую…</div>';
    api('/api/pay', { plan: p, method: 'usdt' }).then(function (d) {
      if (!d.ok) {
        if (box) box.innerHTML = '<div class="msg er">' + esc(d.error || 'Не вдалося') + '</div>';
        return;
      }
      window.__ord = d.order;
      var uah = uahOf(d.amount);
      var same = d.address === QR_FOR;
      openSheet('Переказ ' + d.amount + ' USDT',
        '<div class="card" style="text-align:center">' +
          (same ? '<img src="usdt-qr.png" alt="QR гаманця" ' +
            'style="width:190px;max-width:60%;border-radius:16px;display:block;margin:2px auto 14px">' : '') +
          '<div style="font-size:11.5px;color:var(--mut);font-weight:600;letter-spacing:.06em;' +
            'text-transform:uppercase;margin-bottom:6px">Мережа TRC-20 · Tron</div>' +
          '<div class="addr" id="usdtAddr">' + esc(d.address) + '</div>' +
          '<button class="btn sec" style="margin-top:11px" data-do="sendSelf" ' +
            'data-w="wallet" data-amount="' + d.amount + '">Надіслати адресу в бот</button>' +
          '<button class="btn sec" data-do="copyAddr" data-a="' + esc(d.address) + '">Скопіювати</button>' +
        '</div>' +
        '<div class="card"><div class="kv"><span>Сума</span><b>' + d.amount + ' USDT</b></div>' +
          (uah ? '<div class="kv"><span>У гривні</span><b>' + uah + '</b></div>' : '') +
          '<div class="kv"><span>Мережа</span><b>TRC-20 (Tron)</b></div></div>' +
        '<div class="note">Надсилайте <b>саме USDT у мережі TRC-20</b>. Інша мережа — ' +
          'гроші втрачаються, повернути їх неможливо.</div>' +
        '<div id="payErr2"></div>' +
        '<button class="btn" data-do="paidDone" data-plan="' + p + '">Я оплатив</button>' +
        '<div class="note" style="margin-bottom:0">Після натискання <b>обовʼязково надішліть ' +
          'скрін переказу в чат бота</b> — інакше ми не звіримо платіж.</div>');
    }).catch(function () {
      if (box) box.innerHTML = '<div class="msg er">Немає звʼязку</div>';
    });
  },

  copyAddr: function (t) { copy(t.dataset.a); toast('Адресу скопійовано'); },

  paidDone: function (t) {
    var box = document.getElementById('payErr2');
    if (box) box.innerHTML = '<div class="msg inf">Передаю…</div>';
    api('/api/paid', { order: window.__ord, plan: t.dataset.plan }).then(function (d) {
      openSheet('Дякуємо',
        '<div class="hero" style="margin-bottom:14px">' +
          '<div class="hero-top"><span>Що далі</span>' + ic('check', 18) + '</div>' +
          '<b style="font-size:24px;line-height:1.25">Надішліть скрін переказу в чат бота</b></div>' +
        '<div class="msg er" style="margin-bottom:14px">Без скріншота Преміум не ввімкнеться — ' +
        'ми не побачимо, що платіж саме ваш.</div>' +
        '<div class="steps">' +
          '<div><i>1</i><div><b>Відкрийте чат із ботом</b>' +
            '<p>Той самий, звідки заходили в застосунок.</p></div></div>' +
          '<div><i>2</i><div><b>Надішліть скріншот переказу</b>' +
            '<p>Прикріпіть картинку — ми одразу побачимо її разом із вашим номером.</p></div></div>' +
          '<div><i>3</i><div><b>Чекайте кілька хвилин</b>' +
            '<p>Щойно ввімкнемо — Преміум зʼявиться сам, застосунок відкривати не треба.</p></div></div>' +
        '</div>' +
        '<button class="btn" style="margin-top:14px" data-do="payCheck">Перевірити зараз</button>' +
        '<button class="btn sec" data-close="1">Закрити</button>');
      watchPayment();
    }).catch(function () {
      if (box) box.innerHTML = '<div class="msg er">Немає звʼязку</div>';
    });
  },

  payGo: function (t) {
    var box = document.getElementById('payErr');
    if (box) box.innerHTML = '<div class="msg inf">Створюю рахунок…</div>';
    api('/api/pay', { plan: t.dataset.plan, method: t.dataset.m }).then(function (d) {
      if (!d.ok || !d.url) {
        if (box) box.innerHTML = '<div class="msg er">' + esc(d.error || 'Не вдалося створити рахунок') + '</div>';
        return;
      }
      if (box) box.innerHTML = '<div class="msg inf">Чекаю на оплату…</div>';
      try {
        if (tg && /t\.me\//.test(d.url) && tg.openTelegramLink) tg.openTelegramLink(d.url);
        else if (tg && tg.openLink) tg.openLink(d.url);
        else window.open(d.url, '_blank');
      } catch (e) { window.open(d.url, '_blank'); }
      watchPayment();
    }).catch(function () {
      if (box) box.innerHTML = '<div class="msg er">Немає звʼязку з сервером</div>';
    });
  },

  payCheck: function () {
    var box = document.getElementById('payErr');
    if (box) box.innerHTML = '<div class="msg inf">Перевіряю…</div>';
    api('/api/pay-check', {}).then(function (d) {
      if (d.ok && d.premium) {
        PRO = true; S.premiumUntil = d.until;
        DIRTY = {}; render(); haptic('medium');
        premiumWelcome(d.until);
        return;
      }
      if (box) box.innerHTML = '<div class="msg er">Оплата ще не дійшла. Платіжці інколи треба до хвилини.</div>';
    }).catch(function () {
      if (box) box.innerHTML = '<div class="msg er">Немає звʼязку</div>';
    });
  },
};
function kv(k, v) { return v ? '<div class="kv"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>' : ''; }

function copy(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).catch(function () { fallbackCopy(t); });
  } else fallbackCopy(t);
}
function fallbackCopy(t) {
  var a = document.createElement('textarea');
  a.value = t; a.style.position = 'fixed'; a.style.opacity = '0';
  document.body.appendChild(a); a.select();
  try { document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(a);
}

/* ------------------------------------------------------------------ */
/* НАВІГАЦІЯ ТА ПОДІЇ                                                  */
/* ------------------------------------------------------------------ */
var PARENT = { 's-vin': 's-more', 's-ask': 's-more', 's-crash': 's-more', 's-cars': 's-more' };

function show(id) {
  TAB = id;
  paint(id);
  $$('.screen').forEach(function (s) { s.classList.toggle('on', s.id === id); });
  var tab = PARENT[id] || id;
  $$('.nav button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
  $('#scroll').scrollTop = 0;
  if (tg && tg.BackButton) { if (PARENT[id]) tg.BackButton.show(); else tg.BackButton.hide(); }
}

document.addEventListener('click', function (e) {
  var nav = e.target.closest('.nav button');
  if (nav) { haptic('light'); show(nav.dataset.tab); return; }

  var seg = e.target.closest('.seg button');
  if (seg) {
    Array.prototype.slice.call(seg.parentNode.children).forEach(function (b) { b.classList.remove('on'); });
    seg.classList.add('on');
    seg.dataset.userSet = '1';            // вибір людини важливіший за здогад
    if (seg.parentNode.id === 'cFuel') syncFuelBoxes();
    if (seg.parentNode.id === 'rMode') {
      var byOdo = seg.dataset.v === 'odo';
      var a = document.getElementById('rOdoBox'), b = document.getElementById('rDateBox');
      if (a) a.classList.toggle('hidden', !byOdo);
      if (b) b.classList.toggle('hidden', byOdo);
    }
    if (seg.parentNode.id === 'vTabs') {
      var ios = seg.dataset.v === 'ios';
      var a1 = document.getElementById('vIos'), a2 = document.getElementById('vAndroid');
      if (a1) a1.classList.toggle('hidden', !ios);
      if (a2) a2.classList.toggle('hidden', ios);
    }
    if (seg.parentNode.id === 'rPreset') {
      var pr = REM_PRESETS[+seg.dataset.v];
      var ti = document.getElementById('rTitle'); if (ti) ti.value = pr.t;
      var ev = document.getElementById('rEvery'); if (ev && pr.every) ev.value = pr.every;
      var od = document.getElementById('rOdo');
      var ac = activeCar();
      if (od && pr.every && ac) od.value = ac.odo + pr.every;
    }
    return;
  }

  var go = e.target.closest('[data-go]');
  if (go) {
    var v = go.dataset.go;
    if (v.indexOf('tab:') === 0) { show(v.slice(4)); }
    else if (v.indexOf('car:') === 0) {
      var c = S.cars.filter(function (x) { return x.id === v.slice(4); })[0];
      if (c) { openSheet(carName(c), formCar(c)); syncFuelBoxes(); }
    }
    return;
  }

  var d = e.target.closest('[data-do]');
  if (d && DO[d.dataset.do]) { haptic('light'); DO[d.dataset.do](d); }
});

if (tg && tg.BackButton) {
  tg.BackButton.onClick(function () {
    if (!$('#sheet').classList.contains('hidden')) { closeSheet(); return; }
    show('s-home');
  });
}

/* ------------------------------------------------------------------ */
/* СТАРТ                                                               */
/* ------------------------------------------------------------------ */
function bootFail(msg) {
  $('#bootMsg').innerHTML = msg;
  var sp = document.querySelector('.spin');
  if (sp) sp.style.display = 'none';
}

function start() {
  try {
    if (tg) {
      tg.ready(); tg.expand();
      if (tg.setHeaderColor) tg.setHeaderColor('#0B0D0C');
      if (tg.setBackgroundColor) tg.setBackgroundColor('#0B0D0C');
      if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
    }
  } catch (e) {}

  if (/ЗАМІНИ-НА-СВІЙ/.test(API)) {
    bootFail('У файлі <b>app.js</b> ще не вказана адреса сервера.<br>Замініть значення <b>API</b> на адресу свого worker’а.');
    return;
  }
  if (!initData()) {
    bootFail('Бардачок відкривається з Telegram.<br><br>Знайдіть бота й натисніть «Відкрити».');
    return;
  }

  var ref = '';
  try {
    var sp = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || '';
    var m = String(sp).match(/^ref_(\d+)$/);
    if (m) ref = m[1];
  } catch (e) {}

  api('/api/me', { ref: ref }).then(function (d) {
    if (!d.ok) {
      bootFail(d.error === 'auth'
        ? 'Не вдалося підтвердити вхід.<br>Закрийте застосунок і відкрийте його з бота ще раз.'
        : 'Сервер відповів помилкою.<br>' + esc(d.error || ''));
      return;
    }
    S = d.data; PRO = d.premium; CFG = d.cfg || {}; REF = d.ref || {};

    /* даємо заставці показатись хоча б раз — інакше вона блимає й це
       виглядає як збій, а не як анімація */
    var left = Math.max(0, 1500 - (Date.now() - BOOT_T0));
    setTimeout(function () {
      var b = $('#boot');
      b.classList.add('gone');
      setTimeout(function () { b.classList.add('hidden'); }, 340);
      $('#app').classList.remove('hidden');
      render();
      checkNewPremium();
    }, left);
  }).catch(function () {
    bootFail('Немає зв’язку із сервером.<br>Перевірте інтернет і спробуйте ще раз.');
  });
}

start();

/* хуки для перевірки */
window.__app = { get S() { return S; }, get PRO() { return PRO; }, show: show, render: render, DO: DO };
})();
