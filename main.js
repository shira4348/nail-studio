// ---------------------------------------------------------------------------
// main.js — רינדור והרכבה בלבד. אין כאן תוכן, רק לוגיקה שקוראת את data.js.
// כל renderer עצמאי ולא מכיר את התוכן הספציפי, כך שהוספת שירות, טאב, ביקורת
// או גוון ב-data.js לא דורשת שינוי כאן.
// ---------------------------------------------------------------------------

import { site } from './data.js';
import { el, svgEl, slot, prefersReducedMotion } from './dom.js';
import { mountDesigner } from './designer.js';
import { mountWheel } from './wheel.js';
import { mountGallery } from './gallery.js';
import { mountBooking } from './calendar.js';

// ----- עזרים -----

// מחליף מערך שורות בטקסט + <br> ביניהן, בלי innerHTML.
function appendLines(node, lines) {
  lines.forEach((line, i) => {
    if (i > 0) node.append(el('br'));
    if (typeof line === 'string') { node.append(document.createTextNode(line)); return; }
    const link = el('a', { href: line.href, text: line.text });
    // קישור יוצא נפתח בטאב חדש, כדי לא להוציא את הלקוחה מהדף.
    if (/^https?:/.test(line.href)) { link.target = '_blank'; link.rel = 'noopener'; }
    node.append(link);
  });
  return node;
}

function fill(name, text) {
  const node = slot(name);
  if (!node) return;
  // שדה שלא קיים ב-data.js (sub, badge) מסיר את האלמנט, כדי שלא יישאר
  // shell ריק עם עיצוב משלו.
  if (text == null) { node.remove(); return; }
  // אלמנט שכבר מכיל טקסט ב-index.html (h1, lede) נשאר כפי שהוא — הטקסט שם
  // קיים בשביל טעינה ללא JS ובשביל crawlers.
  if (node.textContent.trim()) return;
  node.textContent = text;
}

// ----- טקסטים קבועים -----

function renderText() {
  fill('headCta', site.headCta);
  fill('heroTitle', site.business.heroTitle);
  fill('heroLede', site.business.heroLede);
  fill('servicesTitle', site.services.title);
  fill('servicesSub', site.services.sub);
  fill('galleryTitle', site.gallery.title);
  fill('gallerySub', site.gallery.sub);
  fill('galleryNote', site.gallery.note);
  fill('designerTitle', site.designer.title);
  fill('designerSub', site.designer.sub);
  fill('wheelTitle', site.wheel.title);
  fill('wheelSub', site.wheel.sub);
  fill('reviewsTitle', site.reviews.title);
  fill('bookingTitle', site.booking.title);
  fill('bookingSub', site.booking.sub);

  const mark = slot('mark');
  mark.append(site.business.name, el('span', { text: site.business.markSuffix }));

  // הכפתור הצף מכיל אייקון SVG, אז רק ה-span מקבל טקסט.
  const whatsapp = slot('whatsapp');
  whatsapp.href = site.whatsapp.href;
  fill('whatsappLabel', site.whatsapp.label);
  if (/^https?:/.test(site.whatsapp.href)) {
    whatsapp.target = '_blank';
    whatsapp.rel = 'noopener';
  }
}

// ----- עמוד הבית -----

// כרטיסי המעבר. כל אחד הוא קישור ל-hash, ולא כפתור שקורא ל-select():
// המאזין ל-hashchange כבר מטפל בזה, וקישור אמיתי אפשר גם לפתוח בטאב חדש
// ולהעתיק. #booking אינו טאב, ושם הדפדפן גולל כרגיל — גם זה עובד לבד.
function renderHome() {
  const nav = slot('homeNav');
  nav.setAttribute('aria-label', site.home.navLabel);
  nav.append(...site.home.links.map((link) => el('a', {
    class: 'home-card', href: `#${link.to}`,
  }, [
    svgEl('svg', {
      class: 'home-icon', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false',
      fill: 'none', stroke: 'currentColor', 'stroke-width': '1.3',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    }, [svgEl('path', { d: link.icon })]),
    el('h3', { text: link.title }),
    el('p', { text: link.text }),
  ])));

  // הפרטים נקראים מהפוטר ולא מוגדרים מחדש: כתובת ושעות שמופיעות בשני
  // מקומות הן שני מקומות שיתיישנו בנפרד.
  const facts = slot('homeFacts');
  facts.append(...site.footer.map((column) => {
    const body = column.numeric ? el('span', { class: 'hours' }) : null;
    const cell = el('div', {}, [el('strong', { text: column.title }), body]);
    appendLines(body ?? cell, column.lines);
    return cell;
  }));
}

// ----- טאבים -----

function renderTabs() {
  const list = slot('tablist');
  const tabs = site.tabs.map((tab) => el('button', {
    type: 'button', role: 'tab', class: 'tab', id: `tab-${tab.id}`,
    'aria-controls': `panel-${tab.id}`, 'aria-selected': 'false',
    tabindex: '-1', text: tab.label,
  }));

  function select(index, { focus = false, updateHash = true, scroll = false } = {}) {
    site.tabs.forEach((tab, i) => {
      const active = i === index;
      tabs[i].setAttribute('aria-selected', String(active));
      tabs[i].tabIndex = active ? 0 : -1;
      document.getElementById(`panel-${tab.id}`).hidden = !active;
    });
    if (focus) tabs[index].focus();
    // replaceState ולא location.hash, כדי לא לגלול ולא להציף את ההיסטוריה.
    if (updateHash) history.replaceState(null, '', `#${site.tabs[index].id}`);
    // מעבר טאב הוא מעבר לתוכן אחר, ולכן צריך להתחיל מלמעלה. בלי זה נוחתים
    // באמצע הסקשן החדש, בגובה הגלילה של הקודם. רק בפעולת משתמשת — לא
    // בטעינה ולא בשינוי hash, ששם גלילה מפתיעה היא הפרעה.
    if (scroll) {
      window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
  }

  tabs.forEach((button, i) => {
    button.addEventListener('click', () => select(i, { scroll: true }));
    button.addEventListener('keydown', (event) => {
      // ב-RTL "הבא" נמצא משמאל, אז החץ השמאלי מקדם.
      const rtl = document.documentElement.dir === 'rtl';
      const step = { ArrowLeft: rtl ? 1 : -1, ArrowRight: rtl ? -1 : 1 }[event.key];
      let next = null;
      if (step) next = (i + step + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      if (next === null) return;
      event.preventDefault();
      select(next, { focus: true, scroll: true });
    });
    list.append(button);
  });

  const fromHash = () => site.tabs.findIndex((tab) => `#${tab.id}` === location.hash);
  const initial = fromHash();
  select(initial >= 0 ? initial : 0, { updateHash: false });

  // קישור חיצוני לטאב מסוים — למשל השיתוף של המעצבת, שמסתיים ב-#designer.
  // hash שאינו טאב (כמו #booking) נשאר לדפדפן, שיגלול אליו כרגיל.
  window.addEventListener('hashchange', () => {
    const index = fromHash();
    if (index >= 0) select(index, { updateHash: false });
  });
}

// ----- מחירון: לולאה על קבוצות, ללא ידע על שמות הקטגוריות -----

// הסכום נעטף ב-bdi/ltr כדי שטווח כמו "₪10–20" לא יתהפך בהקשר RTL.
function priceCell(item) {
  const amount = item.priceMax ? `₪${item.price}–${item.priceMax}` : `₪${item.price}`;
  return el('span', { class: 'price' }, [
    el('bdi', { dir: 'ltr', text: amount }),
    item.priceNote ? document.createTextNode(` ${item.priceNote}`) : null,
  ]);
}

function renderServices() {
  slot('menu').append(...site.services.groups.map((group) =>
    el('div', { id: `service-${group.id}` }, [
      el('h3', { text: group.title }),
      el('ul', {}, group.items.map((item) =>
        el('li', {}, [
          el('span', { text: item.name }),
          el('span', { class: 'dots', 'aria-hidden': 'true' }),
          priceCell(item),
        ]))),
      group.note ? el('p', { class: 'note', text: group.note }) : null,
    ])));
}

function renderReviews() {
  const root = slot('reviews');
  // בלי ביקורות אמיתיות הסקשן כולו יורד, במקום כותרת מעל אזור ריק.
  if (!site.reviews.items.length) { root.closest('section').hidden = true; return; }
  root.append(...site.reviews.items.map((review) =>
    el('blockquote', {}, [
      el('p', { text: review.quote }),
      el('cite', { text: review.author }),
    ])));
}

function renderFooter() {
  slot('footer').append(...site.footer.map((column) => {
    const body = column.numeric ? el('span', { class: 'hours' }) : null;
    const cell = el('div', {}, [el('strong', { text: column.title }), body]);
    appendLines(body ?? cell, column.lines);
    return cell;
  }));
}

// ----- הרכבה -----

function mount() {
  renderText();
  renderHome();
  renderTabs();
  renderServices();
  mountGallery(slot('gallery'), site.gallery);
  renderReviews();
  renderFooter();
  mountDesigner(slot('designer'), site.designer, site.whatsapp.href);
  mountWheel(slot('wheel'), site.wheel, site.whatsapp.href);
  mountBooking(slot('booking'), site.booking, site.whatsapp.href);
}

mount();
