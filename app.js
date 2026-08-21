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
  idcard: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><circle cx="8.5" cy="11" r="2"/>' +
          '<path d="M5.5 16c.6-1.4 1.7-2 3-2s2.4.6 3 2M14 10h4.5M14 13.5h3"/>',
  gift:   '<rect x="3.5" y="9" width="17" height="11" rx="1.5"/><path d="M3.5 13h17M12 9v11"/><path d="M12 9c-3.5 0-4.5-1-4.5-2.5S9 4 10 5s2 4 2 4Zm0 0c3.5 0 4.5-1 4.5-2.5S15 4 14 5s-2 4-2 4Z"/>',
};

/* ic('fuel') -> готова іконка. size і колір керуються з CSS. */
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
      if (d.error === 'limit') {                 // вперлись у безкоштовну межу — показуємо чому
        openSheet('Ліміт безкоштовної версії',
          '<div class="msg inf">' + esc(d.message || 'Це вже за межами безкоштовної версії.') + '</div>' +
          paywallHtml('Кілька авто'));
        return false;
      }
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

function toast(msg) {
  try {
    if (tg && tg.showPopup) { tg.showPopup({ message: String(msg).slice(0, 200) }); return; }
  } catch (e) {}
  alert(msg);
}

/* ------------------------------------------------------------------ */
/* ШТОРКА                                                              */
/* ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ */
/* ФОТО АВТО                                                           */
/* Стискаємо на телефоні перед відправкою — щоб не тягати мегабайти.   */
/* ------------------------------------------------------------------ */
var PHOTOS = {};   // carId -> dataURL
var PH_REQ = {};   // за яким carId фото вже запитували

function loadPhoto(carId) {
  if (PHOTOS[carId] !== undefined) return Promise.resolve(PHOTOS[carId]);
  return api('/api/photo', { carId: carId, get: 1 }).then(function (d) {
    PHOTOS[carId] = d.ok ? d.data : null;
    return PHOTOS[carId];
  }).catch(function () { return null; });
}

function pickPhoto(carId) {
  var inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.onchange = function () {
    var f = inp.files && inp.files[0];
    if (!f) return;
    if (f.size > 12 * 1024 * 1024) { toast('Фото завелике — оберіть інше'); return; }
    var fr = new FileReader();
    fr.onload = function () {
      var img = new Image();
      img.onload = function () {
        var W = 900;
        var k = Math.min(1, W / img.width);
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        var data = c.toDataURL('image/jpeg', 0.78);
        toast('Завантажую…');
        api('/api/photo', { carId: carId, data: data }).then(function (d) {
          if (!d.ok) { toast(d.error || 'Не вдалося зберегти фото'); return; }
          PHOTOS[carId] = data; PH_REQ[carId] = 1;
          var car = S.cars.filter(function (x) { return x.id === carId; })[0];
          if (car) car.photo = true;
          render();
          haptic('medium');
        }).catch(function () { toast('Немає звʼязку'); });
      };
      img.onerror = function () { toast('Не вдалося прочитати фото'); };
      img.src = fr.result;
    };
    fr.readAsDataURL(f);
  };
  inp.click();
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
  (S.fuel || []).forEach(function (r) { if (r.carId === carId && r.date >= since) f += r.cost || 0; });
  (S.service || []).forEach(function (r) { if (r.carId === carId && r.date >= since) s += r.cost || 0; });
  var fines = 0;
  (S.fines || []).forEach(function (r) { if (r.carId === carId && r.date >= since) fines += r.paid ? (r.half ? r.amount / 2 : r.amount) : 0; });
  var other = 0, byCat = {};
  (S.exp || []).forEach(function (r) {
    if (r.carId !== carId || r.date < since) return;
    other += r.cost || 0;
    byCat[r.cat] = (byCat[r.cat] || 0) + (r.cost || 0);
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
    acc += r.qty; accCost += r.cost || 0;
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
function attention() {
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

  drawHome(); drawFines(); drawService(); drawMoney(); drawMore();
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
var TOUR = [
  {
    ic: 'shield',
    t: 'Не пропустите жодного строку',
    p: 'Страховка, техобслуговування, зелена карта. Попереджу заздалегідь — у застосунку і в боті, ' +
       'навіть якщо ви сюди місяць не заходили.',
  },
  {
    ic: 'money',
    t: 'Штраф зі знижкою 50%',
    p: 'На штрафи з камер діє знижка, але лише 10 банківських днів. Пропустили — платите вдвічі більше. ' +
       'Я рахую цей строк і нагадаю, поки він не вийшов.',
  },
  {
    ic: 'chat',
    t: 'Записуйте голосом',
    p: 'Заправились — надиктуйте боту «залив 40 літрів на 1800». Він сам розкладе і запише. ' +
       'Нічого не треба відкривати й заповнювати.',
  },
  {
    ic: 'doc',
    t: 'Документи завжди з собою',
    p: 'Знімок техпаспорта і страховки лежить у застосунку. Забули вдома — відкрили тут. ' +
       'Видно тільки вам.',
  },
  {
    ic: 'search',
    t: 'Перевірка авто по VIN',
    p: 'Перед купівлею видно, що це за машина насправді: рік, кузов, двигун, паливо. ' +
       'П’ять перевірок безкоштовно.',
  },
  {
    ic: 'chart',
    t: 'Історія, яка додає ціни',
    p: 'Кожен запис лишається в сервісній книжці, а при продажу збирається в PDF-звіт для покупця. ' +
       'Це сильний аргумент у торгу.',
  },
];

function drawTour() {
  var el = $('#s-tour');
  el.innerHTML =
    '<div style="text-align:center;padding:8px 4px 4px">' +
      '<div style="font-family:var(--disp);font-weight:800;font-size:27px;letter-spacing:-.03em">Бардачок</div>' +
      '<div style="color:var(--mut);font-size:13.5px;margin-top:5px">Усе про ваше авто в одному місці</div>' +
    '</div>' +
    '<div style="margin-top:18px">' + TOUR.map(function (x) {
      return '<div class="card" style="display:flex;gap:14px;align-items:flex-start">' +
        '<div class="ic-box">' + ic(x.ic, 20) + '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<b style="display:block;font-size:14.5px;font-weight:700;margin-bottom:4px">' + x.t + '</b>' +
          '<p style="margin:0;font-size:12.5px;color:var(--mut);line-height:1.5">' + x.p + '</p>' +
        '</div></div>';
    }).join('') + '</div>' +
    '<button class="btn" style="margin-top:16px" data-do="tourDone">Додати авто</button>' +
    '<div class="note" style="text-align:center">Займе хвилину. VIN не обовʼязковий.</div>';
}

/* ---------- ГАРАЖ ---------- */
function drawHome() {
  var el = $('#s-home');
  var ac = activeCar();
  if (ac && ac.photo && !PH_REQ[ac.id]) {
    PH_REQ[ac.id] = 1;                    // щоб не смикати сервер повторно
    loadPhoto(ac.id).then(function (d) { if (d) drawHome(); });
  }
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

  var ph = PHOTOS[car.id];
  h += '<div class="carcard' + (isEV ? ' ev' : '') + (ph ? ' hasph' : '') + '"' +
    (ph ? ' style="background-image:url(' + ph + ')"' : '') + '>' +
    (ph ? '<div class="shade"></div>' : '') +
    (ph ? '' :
      '<svg class="sil" viewBox="0 0 200 80" aria-hidden="true">' +
      '<path d="M12 58 L20 40 Q32 22 60 21 L118 21 Q150 23 168 42 L186 50 Q196 54 194 62 L12 62 Z" fill="#0E1207"/>' +
      '<circle cx="56" cy="62" r="12" fill="#0E1207"/><circle cx="152" cy="62" r="12" fill="#0E1207"/></svg>' +
      '<button class="addph" data-do="photo">' + ic('plus', 15) + 'Додати фото</button>') +
    (car.plate ? '<span class="plate">' + esc(car.plate) + '</span>' : '') +
    '<h3>' + esc(carName(car)) + '</h3>' +
    '<div class="sub">' + [car.year, FUEL_UA[car.fuel],
        (isEV ? (car.battery ? car.battery + ' кВт·год' : '') : (car.engine ? (car.engine / 1000).toFixed(1) + ' л' : ''))]
        .filter(Boolean).join(' · ') + '</div>' +
    '<div class="odo"><div><small>ПРОБІГ</small><b>' + nfmt(car.odo) + ' <span style="font-size:13px;opacity:.6">км</span></b></div>' +
    '<button class="chip gh" style="background:rgba(14,18,7,.16);color:#0E1207;margin:0" data-do="odo">Оновити</button></div>' +
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
    '<button data-go="tab:s-vin">' + ic('search',21) + 'Перевірка</button>' +
    '<button data-do="expense">' + ic('plus',21) + 'Витрата</button>' +
    '</div>';

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
function drawMoney() {
  var el = $('#s-money');
  if (!S.cars.length) { el.innerHTML = '<div class="empty">Спочатку додайте авто в Гаражі.</div>'; return; }

  var car = activeCar();
  var isEV = car.fuel === 'electric';
  var m30 = spend(car.id, 30), m365 = spend(car.id, 365);
  var cons = consumption(car.id);

  var h = '<div class="card">' +
    '<div style="font-size:12.5px;color:var(--mut)">За 30 днів</div>' +
    '<div class="num" style="font-size:36px;margin:4px 0 14px">' + money(m30.total) + '</div>';

  if (m30.total > 0) {
    var rows = [
      [isEV ? 'Зарядка' : 'Паливо', m30.fuel],
      ['Сервіс і ремонт', m30.service],
      ['Штрафи', m30.fines],
    ];
    Object.keys(m30.byCat || {}).forEach(function (c) {
      rows.push([CAT_UA[c] || 'Інше', m30.byCat[c]]);
    });
    rows = rows.filter(function (r) { return r[1] > 0; })
               .sort(function (a, b) { return b[1] - a[1]; });
    h += '<div class="bars">' + rows.map(function (r) {
      var p = Math.round(r[1] / m30.total * 100);
      return '<div class="bar"><div class="t"><b>' + r[0] + '</b><span>' + money(r[1]) + '</span></div>' +
        '<div class="track"><div class="fill" style="width:' + p + '%"></div></div></div>';
    }).join('') + '</div>';
  } else {
    h += '<div class="empty" style="padding:8px 0">Записів за місяць немає. Додайте заправку чи ремонт — і тут з’явиться картина.</div>';
  }
  h += '</div>';

  h += '<div class="card"><div class="kv"><span>За рік</span><b>' + money(m365.total) + '</b></div>' +
    '<div class="kv"><span>У середньому на місяць</span><b>' + money(m365.total / 12) + '</b></div>' +
    (cons ? '<div class="kv"><span>Витрата ' + (isEV ? 'енергії' : 'пального') + '</span><b>' +
      cons.per100.toFixed(1) + ' ' + (isEV ? 'кВт·год' : 'л') + ' / 100 км</b></div>' +
      (cons.tanks > 1 ? '<div class="kv"><span>Останній ' + (isEV ? 'заряд' : 'бак') + '</span><b>' +
        cons.last.toFixed(1) + ' ' + (isEV ? 'кВт·год' : 'л') + ' / 100 км</b></div>' : '') : '') +
    (cons && cons.perKm ? '<div class="kv"><span>' + (isEV ? 'Зарядка' : 'Паливо') +
      ' на кілометр</span><b>' + cons.perKm.toFixed(2) + ' ₴</b></div>' : '') +
    '</div>';

  if (!cons && (S.fuel || []).filter(function (r) { return r.carId === car.id; }).length)
    h += '<div class="note">Витрату порахую, коли будуть дві заправки «' +
         (isEV ? 'до 100%' : 'повний бак') + '» поспіль — між ними видно, скільки саме пішло.</div>';

  h += '<div class="grid2" style="margin-top:11px">' +
    '<button class="btn sec" data-do="fuel">' + (isEV ? 'Зарядка' : 'Заправка') + '</button>' +
    '<button class="btn sec" data-do="expense">Інша витрата</button></div>';

  var ex = (S.exp || []).filter(function (r) { return r.carId === car.id; });
  if (ex.length) {
    h += '<div class="h2">Інші витрати</div><div class="card list">' + ex.slice(0, 15).map(function (r) {
      return '<button class="it" data-do="delAsk" data-id="' + r.id + '">' +
        '<div class="dt">' + ic(CAT_IC[r.cat] || 'plus', 17) + '</div>' +
        '<div class="tx"><b>' + esc(r.title) + '</b><small>' + (CAT_UA[r.cat] || 'Інше') + ' · ' + fmtDate(r.date) + '</small></div>' +
        '<div class="vl">' + money(r.cost) + '</div></button>';
    }).join('') + '</div>';
  }

  var fr = (S.fuel || []).filter(function (r) { return r.carId === car.id; });
  h += '<div class="h2">' + (isEV ? 'Зарядки' : 'Заправки') + '</div>';
  if (!fr.length) {
    h += '<div class="empty">Ще нічого не внесено.</div>';
  } else {
    h += '<div class="card list">' + fr.slice(0, 20).map(function (r) {
      return '<button class="it" data-do="delAsk" data-id="' + r.id + '"><div class="dt">' + ic(isEV ? 'charge' : 'fuel', 17) + '</div>' +
        '<div class="tx"><b>' + (r.qty ? r.qty + ' ' + (r.unit === 'kwh' ? 'кВт·год' : 'л') : 'Заправка') + '</b>' +
        '<small>' + fmtDate(r.date) + (r.station ? ' · ' + esc(r.station) : '') +
          (r.odo ? ' · ' + nfmt(r.odo) + ' км' : '') + (r.full === false ? ' · не повний' : '') + '</small></div>' +
        '<div class="vl">' + money(r.cost) + '</div></button>';
    }).join('') + '</div>';
  }

  el.innerHTML = h;
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
        '<button data-do="buy" data-plan="month"><small>Місяць</small><b>' + nfmt(CFG.premiumMonth) + '</b></button>' +
        '<button data-do="buy" data-plan="half"><small>Півроку</small><b>' + nfmt(CFG.premiumHalf) + '</b>' +
          '<em>' + nfmt(CFG.premiumHalf / 6) + ' ₴/міс</em></button>' +
        '<button class="best" data-do="buy" data-plan="year"><small>Рік</small><b>' + nfmt(CFG.premiumYear) + '</b>' +
          '<em>' + nfmt(CFG.premiumYear / 12) + ' ₴/міс</em></button>' +
      '</div></div>';
  } else {
    h += '<div class="promo"><b>Преміум <em>активний</em></b>' +
      '<p>Діє до ' + fmtDate(S.premiumUntil) + '. Голосове внесення й питання про авто увімкнені.</p></div>';
  }

  h += '<div class="h2">Інструменти</div><div class="card list">' +
    itemBtn('search', 'Перевірка по VIN', 'Що це за авто насправді', 'tab:s-vin') +
    itemBtn('chat', 'Питання про авто', PRO ? 'Стукає, гріється, не заводиться' : 'У Преміумі', 'tab:s-ask') +
    itemBtn('doc', 'Документи', 'Техпаспорт, страховка, права', 'tab:s-docs') +
    itemBtn('doc', 'Звіт для покупця', 'PDF із сервісною книжкою', 'tab:s-report') +
    itemBtn('crash', 'Що робити при ДТП', 'Покроково, без паніки', 'tab:s-crash') +
    itemBtn('car', 'Мої авто', S.cars.length + ' ' + plural(S.cars.length, 'авто', 'авто', 'авто'), 'tab:s-cars') +
    '</div>';

  h += '<div class="h2">Голосове внесення</div><div class="card">' +
    '<p style="margin:0 0 12px;font-size:13px;color:var(--ink2);line-height:1.55">' +
      'Надиктуйте боту голосове — «залив 40 літрів на 1800» — і запис з’явиться сам. ' +
      'На iPhone можна повісити це на кнопку «Дія» або постукування по кришці.</p>' +
    '<button class="btn sec" data-do="voiceHelp">Як налаштувати</button></div>';

  h += '<div class="promo" style="margin-top:12px">' +
    '<b>Приведіть друга — <em>отримайте місяць</em></b>' +
    '<p>За кожного, хто приєднається за вашим посиланням, ви отримуєте 30 днів Преміуму. ' +
    'Друг теж отримує місяць. Нарахування автоматичне.</p>' +
    (REF.count ? '<div class="kv" style="border:0;padding:0 0 12px"><span>Уже привели</span><b>' +
      REF.count + ' ' + plural(REF.count, 'людину', 'людей', 'людей') + ' · +' + (REF.count * 30) + ' днів</b></div>' : '') +
    (REF.link
      ? '<button class="btn" data-do="share">Надіслати посилання</button>' +
        '<button class="btn sec" data-do="copyRef">Скопіювати</button>'
      : '<div class="note" style="margin:0">Посилання зʼявиться, щойно бота буде підключено.</div>') +
    '</div>';

  h += '<div class="note">Бардачок не замінює механіка й не є юридичною консультацією. ' +
       'Дати й суми ви вносите самі — я лише стежу, щоб нічого не забулось.</div>';

  el.innerHTML = h;
  drawVin(); drawAsk(); drawReport(); drawDocs(); drawCrash(); drawCars();
}
function itemBtn(name, t, s, go) {
  return '<button class="it" data-go="' + go + '"><div class="dt">' + ic(name, 17) + '</div>' +
    '<div class="tx"><b>' + t + '</b><small>' + s + '</small></div><div class="ar">›</div></button>';
}

/* ---------- VIN ---------- */
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
      '<textarea id="askIn" rows="1" placeholder="Напишіть питання…"' +
        (PRO ? '' : ' disabled') + '></textarea>' +
      '<button class="send" data-do="askGo"' + (PRO && !CHAT_BUSY ? '' : ' disabled') + '>' +
        '<svg viewBox="0 0 24 24" width="20" height="20" class="icn"><path d="M4 12 20 4l-4 8 4 8-16-8Z"/></svg>' +
      '</button>' +
    '</div>';

  el.innerHTML = head + body + bar +
    (PRO ? '' : '<div class="note">Помічник доступний у Преміумі.</div>') +
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

  var spentSrv = srv.reduce(function (a, r) { return a + (r.cost || 0); }, 0);
  var spentAll = spentSrv + fuel.reduce(function (a, r) { return a + (r.cost || 0); }, 0) +
                            exp.reduce(function (a, r) { return a + (r.cost || 0); }, 0);

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
  function h2(t) {
    room(110); y += 26;
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

  /* ---- фото ---- */
  var ph = PHOTOS[car.id];
  if (ph && window.__rpImg) {
    var img = window.__rpImg, boxW = RP_W - RP_M * 2, boxH = 420;
    room(boxH + 30);
    x.save(); rrect(RP_M, y, boxW, boxH, 22); x.clip();
    var k = Math.max(boxW / img.width, boxH / img.height);
    var iw = img.width * k, ih = img.height * k;
    x.drawImage(img, RP_M + (boxW - iw) / 2, y + (boxH - ih) / 2, iw, ih);
    x.restore();
    y += boxH + 10;
  }

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

  /* ---- сервісна книжка ---- */
  h2('Сервісна книжка');
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
    h2(isEV ? 'Заряджання' : 'Заправки');
    var unit = isEV ? 'кВт·год' : 'л';
    rows([
      [isEV ? 'Заряджань' : 'Заправок', String(st.fuel.length)],
      ['Загалом ' + (isEV ? 'енергії' : 'пального'), nfmt(st.qty) + ' ' + unit],
      ['Середня витрата', st.cons ? st.cons.per100.toFixed(1) + ' ' + unit + '/100 км' : 'даних поки мало'],
      ['Витрачено на ' + (isEV ? 'зарядку' : 'паливо'),
        money(st.fuel.reduce(function (a, r) { return a + (r.cost || 0); }, 0))],
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

function paywallHtml(what) {
  return '<div class="msg inf">' + esc(what) + ' — у Преміумі.</div>' +
    '<p style="margin:0 0 14px;font-size:13.5px;color:var(--ink2);line-height:1.6">' +
      'Преміум відкриває голосове внесення, питання про авто, кілька машин, ' +
      'необмежені перевірки по VIN і звіти для покупця.</p>' +
    '<div class="card"><div class="kv"><span>Місяць</span><b>' + money(CFG.premiumMonth) + '</b></div>' +
    '<div class="kv"><span>Рік</span><b>' + money(CFG.premiumYear) + '</b></div></div>' +
    '<button class="btn" style="margin-top:12px" data-go="tab:s-more" data-close="1">Дивитись тарифи</button>';
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
        (PRO ? 'Створити PDF' : 'Створити PDF · Преміум') + '</button>' +
      '<div class="note" style="margin-top:10px">Файл прийде у чат бота — звідти перешлете покупцю.</div>' +
    '</div>' +
    (st.srv.length ? '' :
      '<div class="note">Поки що книжка порожня. Внесіть хоч кілька робіт — звіт стане переконливим.</div>');
}

function sendReport() {
  var car = activeCar();
  if (!car) return;
  if (!PRO) { openSheet('Звіт для покупця', paywallHtml('Звіти для покупця')); return; }

  toast('Готую звіт…');
  var ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();

  ready.then(function () {
    var ph = PHOTOS[car.id];
    if (!ph) return null;
    return new Promise(function (res) {
      var im = new Image();
      im.onload = function () { window.__rpImg = im; res(im); };
      im.onerror = function () { window.__rpImg = null; res(null); };
      im.src = ph;
    });
  }).then(function () {
    var pages;
    try { pages = rpPages(car); }
    catch (e) { toast('Не вдалося намалювати звіт'); return; }
    window.__rpImg = null;
    return api('/api/report', { pages: pages, plate: car.plate || carName(car) }).then(function (d) {
      if (!d.ok) { toast(d.error || 'Не вдалося надіслати'); return; }
      haptic('medium');
      openSheet('Звіт готовий',
        '<p style="margin:0 0 14px;font-size:14px;color:var(--ink2);line-height:1.6">' +
        'PDF надіслано у чат бота. Відкрийте бота і перешліть файл покупцю.</p>' +
        '<button class="btn" data-close="1">Зрозуміло</button>');
    });
  }).catch(function () { toast('Немає звʼязку з сервером'); });
}

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

function drawDocs() {
  var el = $('#s-docs');
  if (!el) return;

  if (DOCS === null) {
    el.innerHTML = '<div class="card"><p style="margin:0;color:var(--mut);font-size:13px">Дивлюсь, що там…</p></div>';
    loadDocs();
    return;
  }

  var h = '<div class="card">' +
    '<div class="chat-head" style="padding:0 0 12px">' +
      '<div class="ic-box">' + ic('doc', 20) + '</div>' +
      '<div style="flex:1;min-width:0"><b style="display:block;font-size:15px;font-weight:700">Документи</b>' +
      '<small style="color:var(--mut);font-size:12px">' + DOCS.length + ' з ' + DOC_LIMIT + '</small></div></div>' +
    '<p style="margin:0 0 13px;font-size:12.5px;color:var(--mut);line-height:1.5">' +
      'Знімки техпаспорта, страховки, прав. Забули вдома — відкрили тут. ' +
      'Видно тільки вам: вхід у застосунок підтверджує Telegram.</p>' +
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

  h += '<div class="note">Знімки лежать на вашому сервері й прив’язані до вашого Telegram. ' +
       'Не додавайте сюди те, чого не хочете зберігати онлайн.</div>';
  el.innerHTML = h;
}

function docPick() {
  if (DOCS && DOCS.length >= DOC_LIMIT && !PRO) {
    openSheet('Документи', paywallHtml('Більше документів'));
    return;
  }
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

  var inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = function () {
    var f = inp.files && inp.files[0];
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      var img = new Image();
      img.onload = function () {
        var W = 1400;                             // текст має лишитись читабельним
        var k = Math.min(1, W / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        var data = c.toDataURL('image/jpeg', 0.72);
        if (data.length > 880000) data = c.toDataURL('image/jpeg', 0.55);
        toast('Кладу в бардачок…');
        api('/api/doc', { kind: kind, title: title, data: data }).then(function (d) {
          if (!d.ok) { toast(d.message || d.error || 'Не вдалося зберегти'); return; }
          DOCS = d.docs || [];
          closeSheet(); drawDocs(); haptic('medium');
        }).catch(function () { toast('Немає зв’язку'); });
      };
      img.onerror = function () { toast('Не вдалося прочитати знімок'); };
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
    if (r.ok && r.data) DOC_IMG[id] = r.data;
    show(r.ok ? r.data : null);
  }).catch(function () { show(null); });
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
    '<div id="cEngineBox">' + fld('cEngine', 'Об’єм двигуна, л', { mode: 'decimal', ph: '2.0', val: c.engine ? (c.engine / 1000).toFixed(1) : '' }) + '</div>' +
    '<div id="cEvBox" class="hidden"><div class="two">' +
      fld('cBattery', 'Батарея, кВт·год', { mode: 'decimal', ph: '64', val: c.battery }) +
      fld('cSoh', 'Здоров’я батареї, %', { mode: 'numeric', ph: '92', val: c.soh }) + '</div></div>' +
    fld('cOdo', 'Пробіг, км', { mode: 'numeric', ph: '87400', val: c.odo || '' }) +
    fld('cVin', 'VIN (не обов’язково)', { ph: '17 символів', val: c.vin, max: 20 }) +
    '<div class="two">' + fld('cIns', 'ОСЦПВ діє до', { type: 'date', val: c.insuranceEnd }) +
                          fld('cGreen', 'Зелена карта до', { type: 'date', val: c.greenEnd }) + '</div>' +
    (c.fuel !== 'electric' ? fld('cOil', 'Пробіг останньої заміни масла', { mode: 'numeric', ph: 'напр. 82000', val: c.lastOilOdo }) : '') +
    '<div id="carErr"></div>' +
    (c.id ? '<button class="btn sec" data-do="' + (c.photo ? 'photoDel' : 'photo') + '" data-id="' + c.id + '">' +
      (c.photo ? 'Прибрати фото' : 'Додати фото авто') + '</button>' : '') +
    '<button class="btn" data-do="saveCar">' + (c.id ? 'Зберегти' : 'Додати авто') + '</button>' +
    (c.id ? '<button class="btn dan" data-do="delCar" data-id="' + c.id + '">Видалити авто</button>' : '') +
    '</div>';
}

function syncFuelBoxes() {
  var on = document.querySelector('#cFuel button.on');
  var ev = on && on.dataset.v === 'electric';
  var eb = document.getElementById('cEngineBox'), vb = document.getElementById('cEvBox');
  if (eb) eb.classList.toggle('hidden', !!ev);
  if (vb) vb.classList.toggle('hidden', !ev);
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
    };
    if (!car.make && !car.model && !car.plate) {
      document.getElementById('carErr').innerHTML = '<div class="msg er">Вкажіть хоча б марку або номер.</div>';
      return;
    }
    act(id ? { action: 'editCar', id: id, car: car } : { action: 'addCar', car: car }, closeSheet);
  },

  delCar: function (t) {
    if (!confirm('Видалити авто разом з усією історією?')) return;
    act({ action: 'delCar', id: t.dataset.id }, closeSheet);
  },

  pickCar: function (t) { act({ action: 'setActive', id: t.dataset.id }); },

  report: function () { sendReport(); },

  docAdd:  function () { docPick(); },
  docShoot: function () { docShoot(); },
  docOpen: function (t) { docOpen(t.dataset.id); },
  docDel:  function (t) {
    var id = t.dataset.id;
    if (!confirm('Прибрати документ?')) return;
    api('/api/doc', { remove: 1, id: id }).then(function (d) {
      if (d.ok) { DOCS = d.docs || []; delete DOC_IMG[id]; closeSheet(); drawDocs(); }
      else toast(d.error || 'Не вдалося');
    });
  },

  photo: function (t) {
    var id = (t && t.dataset.id) || (activeCar() || {}).id;
    if (id) pickPhoto(id);
  },
  photoDel: function (t) {
    var id = t.dataset.id;
    if (!confirm('Прибрати фото?')) return;
    api('/api/photo', { carId: id, remove: 1 }).then(function () {
      PHOTOS[id] = null; PH_REQ[id] = 0;
      var c = S.cars.filter(function (x) { return x.id === id; })[0];
      if (c) c.photo = false;
      render();
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
        fld('fCost', 'Сума, ₴', { mode: 'decimal', ph: '1800' }) + '</div>' +
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
      '<div class="two">' + fld('sCost', 'Вартість, ₴', { mode: 'decimal', ph: '2400' }) +
                            fld('sOdo', 'Пробіг, км', { mode: 'numeric', val: car.odo }) + '</div>' +
      fld('sDate', 'Дата', { type: 'date', val: today() }) +
      '<button class="btn" data-do="saveService">Зберегти</button>');
  },
  saveService: function () {
    var on = document.querySelector('#sKind button.on');
    var kind = on ? on.dataset.v : 'other';
    act({ action: 'addService', kind: kind, title: val('sTitle') || KIND_UA[kind],
          cost: numv('sCost') || 0, odo: numv('sOdo'), date: val('sDate') }, closeSheet);
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
      '<div class="two">' + fld('eCost', 'Сума, ₴', { mode: 'decimal', ph: '350' }) +
                            fld('eDate', 'Дата', { type: 'date', val: today() }) + '</div>' +
      '<button class="btn" data-do="saveExpense">Зберегти</button>');
  },
  saveExpense: function () {
    var on = document.querySelector('#eCat button.on');
    var cat = on ? on.dataset.v : 'other';
    var c = numv('eCost');
    if (c == null) { toast('Вкажіть суму'); return; }
    act({ action: 'addExpense', cat: cat, title: val('eTitle') || CAT_UA[cat],
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
    if (!confirm('Видалити запис?')) return;
    act({ action: 'del', id: t.dataset.id });
  },

  vinGo: function () {
    var v = val('vinIn').toUpperCase().replace(/[^A-Z0-9]/g, '');
    var out = document.getElementById('vinOut');
    if (v.length !== 17) { out.innerHTML = '<div class="msg er">VIN має містити рівно 17 символів. Зараз ' + v.length + '.</div>'; return; }
    out.innerHTML = '<div class="msg inf">Перевіряю…</div>';
    api('/api/vin', { vin: v }).then(function (d) {
      if (!d.ok) {
        if (d.error === 'limit') {
          CFG.vinLeft = 0;
          drawVin();                       // перемальовуємо — з блоком про Преміум
          var box = document.getElementById('vinOut');
          if (box) box.innerHTML = '<div class="msg er">' + esc(d.message) + '</div>';
          return;
        }
        out.innerHTML = '<div class="msg er">' + esc(d.error || 'Не знайдено') + '</div>';
        return;
      }
      if (d.left !== undefined && d.left !== null) CFG.vinLeft = d.left;
      var c = d.car;
      out.innerHTML = '<div class="card">' +
        kv('Авто', [c.year, c.make, c.model].filter(Boolean).join(' ')) +
        kv('Кузов', c.body) + kv('Паливо', FUEL_UA[c.fuel] || c.fuelText) +
        kv('Двигун', c.engine ? (c.engine / 1000).toFixed(1) + ' л' : '') +
        kv('Батарея', c.battery ? c.battery + ' кВт·год' : '') +
        kv('Країна випуску', c.country) +
        '</div><button class="btn sec" style="margin-top:10px" data-do="vinToCar">Додати це авто в гараж</button>';
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
    }));
    syncFuelBoxes();
  },

  askGo: function () {
    if (!PRO) { toast('Помічник доступний у Преміумі'); return; }
    if (CHAT_BUSY) return;
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

    var ways = '';
    if (pay.card)   ways += '<button class="btn" data-do="payGo" data-plan="' + p + '" data-m="card">Карткою</button>';
    if (pay.crypto) ways += '<button class="btn' + (pay.card ? ' sec' : '') + '" data-do="payGo" ' +
                            'data-plan="' + p + '" data-m="crypto">Криптою через CryptoBot</button>';

    openSheet('Преміум · ' + name,
      '<div class="card"><div class="kv"><span>Тариф</span><b>' + name + '</b></div>' +
      '<div class="kv"><span>Вартість</span><b>' + money(price) + '</b></div>' +
      '<div class="kv"><span>Термін</span><b>' +
        (p === 'year' ? '365 днів' : p === 'half' ? '182 дні' : '30 днів') + '</b></div></div>' +
      '<div id="payErr"></div>' +
      (ways
        ? ways +
          '<button class="btn sec" data-do="payCheck">Перевірити оплату</button>' +
          '<div class="note" style="margin-bottom:0">Після оплати преміум вмикається сам. ' +
          'Якщо за хвилину нічого не змінилось — натисніть «Перевірити оплату».</div>'
        : '<div class="msg inf">Оплата ще не підключена.</div>' +
          (CFG.contactTg ? '<a class="btn" style="text-decoration:none" target="_blank" rel="noopener" ' +
            'href="https://t.me/' + esc(CFG.contactTg) + '">Написати менеджеру</a>' : '')));
  },

  payGo: function (t) {
    var box = document.getElementById('payErr');
    if (box) box.innerHTML = '<div class="msg inf">Створюю рахунок…</div>';
    api('/api/pay', { plan: t.dataset.plan, method: t.dataset.m }).then(function (d) {
      if (!d.ok || !d.url) {
        if (box) box.innerHTML = '<div class="msg er">' + esc(d.error || 'Не вдалося створити рахунок') + '</div>';
        return;
      }
      if (box) box.innerHTML = '<div class="msg inf">Відкриваю оплату. Після неї поверніться сюди.</div>';
      try {
        if (tg && /t\.me\//.test(d.url) && tg.openTelegramLink) tg.openTelegramLink(d.url);
        else if (tg && tg.openLink) tg.openLink(d.url);
        else window.open(d.url, '_blank');
      } catch (e) { window.open(d.url, '_blank'); }
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
        closeSheet(); render(); haptic('medium');
        toast('Преміум активний до ' + fmtDate(d.until));
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
    if (seg.parentNode.id === 'cFuel') syncFuelBoxes();
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
    $('#boot').classList.add('hidden');
    $('#app').classList.remove('hidden');
    render();
  }).catch(function () {
    bootFail('Немає зв’язку із сервером.<br>Перевірте інтернет і спробуйте ще раз.');
  });
}

start();

/* хуки для перевірки */
window.__app = { get S() { return S; }, get PRO() { return PRO; }, show: show, render: render, DO: DO };
})();
