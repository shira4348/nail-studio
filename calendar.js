// ---------------------------------------------------------------------------
// calendar.js — לוח התורים.
//
// שני דברים להבין לפני שנוגעים:
//
// 1. אין כאן זמינות. הלוח יודע מתי הסטודיו סגור — שבת, חג, יום שנקבע ידנית,
//    תאריך שכבר עבר — אבל הוא לא יודע אילו תורים כבר תפוסים, כי אין שרת.
//    לכן הוא לא מאשר כלום. הבחירה נארזת להודעת וואטסאפ, והתור נסגר שם.
//    זה ההבדל בין דף שעוזר לבין דף שמשקר.
//
// 2. החגים לא מגיעים מטבלת תאריכים לועזיים. Intl.DateTimeFormat עם הלוח
//    העברי מובנה בכל דפדפן, ומאפשר לשאול כל תאריך "איזה יום עברי אתה".
//    לכן טבלת החגים ב-data.js נכונה לכל שנה קדימה, בלי תחזוקה שנתית.
//
// להחלפה במערכת חיצונית: למחוק את הקריאה ל-mountBooking() ב-main.js ולהדביק
// את ה-embed לתוך [data-bind="booking"]. שום חלק אחר בדף לא תלוי במודול הזה.
// ---------------------------------------------------------------------------

import { el, whatsappLink } from './dom.js';

// שם החודש והיום העברי. באנגלית ולא בעברית, כי השמות האלה הם המפתח בטבלת
// החגים ב-data.js, ושמות אנגליים יציבים יותר בין גרסאות ICU.
const HEBREW = new Intl.DateTimeFormat('en-u-ca-hebrew', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});
const HEBREW_HE = new Intl.DateTimeFormat('he-u-ca-hebrew', { month: 'long', timeZone: 'UTC' });
const MONTH_HE = new Intl.DateTimeFormat('he', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const DATE_HE = new Intl.DateTimeFormat('he', {
  day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC',
});

const DAY_MS = 86400000;

// כל תאריך בלוח נבנה באמצע היום ב-UTC. בלי זה אזור זמן עם היסט שלילי היה
// מזיז את היום אחורה, והלוח היה מציג סטייה של יום.
const utc = (year, month, day) => new Date(Date.UTC(year, month, day, 12));

// היום של המשתמשת לפי השעון שלה, מתורגם לאותו ייצוג.
const todayUtc = () => {
  const now = new Date();
  return utc(now.getFullYear(), now.getMonth(), now.getDate());
};

const isoOf = (date) => date.toISOString().slice(0, 10);

function hebrewOf(date) {
  const parts = HEBREW.formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return { month: get('month'), day: Number(get('day')) };
}

// בשנה מעוברת אדר מתפצל, ולכן month בטבלה יכול להיות מערך של שמות אפשריים.
function holidayOn(date, holidays) {
  const { month, day } = hebrewOf(date);
  return holidays.find((entry) => entry.day === day
    && (Array.isArray(entry.month) ? entry.month.includes(month) : entry.month === month));
}

// למה היום סגור, או null אם הוא פתוח. סדר הבדיקות הוא סדר העדיפות בתווית.
function closureFor(date, config, today) {
  const distance = Math.round((date - today) / DAY_MS);
  if (distance < 0) return { kind: 'past', label: config.closedPast };
  if (distance < config.leadDays) return { kind: 'lead', label: config.closedLead };
  if (distance > config.horizonDays) return { kind: 'far', label: '' };
  if (config.closedDates.includes(isoOf(date))) {
    return { kind: 'closed', label: config.closedWeekly };
  }
  if (!config.week[date.getUTCDay()]) return { kind: 'weekly', label: config.closedWeekly };
  const holiday = holidayOn(date, config.holidays);
  if (holiday) return { kind: 'holiday', label: holiday.name };
  return null;
}

// שעות ההתחלה האפשריות ביום נתון לשירות נתון. הרשת קבועה (slotStep), אבל
// משבצת נכנסת רק אם התור כולו מסתיים עד הסגירה — ולכן לבנייה בג'ל יש פחות
// שעות פנויות מלמניקור באותו יום בדיוק.
function slotsFor(date, config, minutes) {
  const day = config.week[date.getUTCDay()];
  if (!day) return [];
  const out = [];
  for (let start = day.open * 60; start + minutes <= day.close * 60; start += config.slotStep) {
    out.push(start);
  }
  return out;
}

const timeLabel = (minutes) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;

// "שעה וחצי", "שעתיים", "30 דק׳" — משך בעברית, בלי ספרייה.
function durationLabel(minutes) {
  const hours = minutes / 60;
  const names = { 1: 'שעה', 1.5: 'שעה וחצי', 2: 'שעתיים', 2.5: 'שעתיים וחצי', 3: 'שלוש שעות' };
  if (names[hours]) return names[hours];
  if (minutes < 60) return `${minutes} דק׳`;
  return `${hours} שעות`;
}

// כותרת החודש: הלועזי, ומתחתיו העברי. חודש לועזי נופל על שני חודשים עבריים
// כמעט תמיד, ולכן שניהם מוצגים כשהם שונים.
function hebrewSpan(first, last) {
  const from = HEBREW_HE.format(first);
  const to = HEBREW_HE.format(last);
  return from === to ? from : `${from}–${to}`;
}

// ----- קובץ יומן -----

// פסיק ונקודה-פסיק הם תווי הפרדה ב-RFC 5545 וחייבים בריחה.
const icsEscape = (text) => text.replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
const icsStamp = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// STATUS:TENTATIVE ולא CONFIRMED — התור עדיין לא אושר, והקובץ לא אמור
// להיראות ביומן כאילו כן.
function icsBlob(config, start, service) {
  const end = new Date(start.getTime() + service.minutes * 60000);
  const body = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//nail-studio//booking//HE',
    'BEGIN:VEVENT',
    `UID:${icsStamp(start)}-booking@nail-studio`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsEscape(config.icsName.replace('{service}', service.name))}`,
    'STATUS:TENTATIVE',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  return new Blob([body], { type: 'text/calendar;charset=utf-8' });
}

// ---------------------------------------------------------------------------

// לוח הפגישות של גוגל. הוא היחיד שיודע מה תפוס באמת, כי הוא קורא את היומן
// עצמו — כולל אירועים פרטיים שאין להם קשר לסטודיו.
// נבנה בקוד ולא מודבק כ-HTML, כדי שלא יידרש innerHTML בשום מקום בפרויקט.
function embedFrame(embed) {
  return el('div', { class: 'book-embed' }, [
    el('iframe', {
      // gv=true הוא מה שהופך את הדף לתצוגת הטמעה במקום דף מלא.
      src: `${embed.src}?gv=true`,
      title: embed.title,
      // הסקשן יושב בתחתית הדף, מתחת לקיפול, ולכן lazy באמת חוסך טעינה.
      loading: 'lazy',
      style: { width: '100%', height: `${embed.height}px`, border: '0' },
    }),
    // חוסם פרסומות או מסגור חסום ישאירו iframe ריק. הקישור הישיר הוא
    // ההבדל בין "הדף מקולקל" לבין "קבעתי תור".
    el('p', { class: 'book-fallback' }, [
      el('a', { href: embed.href, target: '_blank', rel: 'noopener', text: embed.fallback }),
    ]),
  ]);
}

export function mountBooking(root, config, whatsappHref) {
  // מערכת חיצונית גוברת על הלוח המובנה. מחיקת embed מחזירה אותו בשורה אחת.
  if (config.embed?.src) {
    root.append(embedFrame(config.embed));
    return;
  }

  const today = todayUtc();
  const limit = new Date(today.getTime() + config.horizonDays * DAY_MS);

  let view = utc(today.getUTCFullYear(), today.getUTCMonth(), 1);
  let cursor = today;      // היום שמחזיק את הפוקוס בתוך הרשת
  let service = null;      // השירות שנבחר, ומכאן משך התור
  let picked = null;       // התאריך שנבחר
  let start = null;        // שעת ההתחלה שנבחרה, בדקות מחצות
  let icsUrl = null;

  const serviceBox = el('div', { class: 'slots svc-row' });

  const title = el('strong', { class: 'cal-title' });
  const hebrewLine = el('span', { class: 'cal-heb' });
  const prev = el('button', {
    type: 'button', class: 'cal-nav', 'aria-label': config.prevLabel, text: '›',
  });
  const next = el('button', {
    type: 'button', class: 'cal-nav', 'aria-label': config.nextLabel, text: '‹',
  });
  const grid = el('div', { class: 'cal-grid', role: 'grid', 'aria-label': config.calendarLabel });

  const slotsHead = el('strong', { class: 'book-title' });
  const slotsBox = el('div', { class: 'slots' });
  const chosenLine = el('p', { class: 'confirm', 'aria-live': 'polite' });
  const cta = el('a', { class: 'cta', target: '_blank', rel: 'noopener', text: config.ctaLabel });
  const ics = el('a', { class: 'book-ics', download: 'appointment.ics', text: config.icsLabel });
  const actions = el('div', { class: 'book-actions', hidden: 'hidden' }, [cta, ics]);

  const sameDay = (a, b) => a && b && a.getTime() === b.getTime();

  // ----- רשת החודש -----

  function renderGrid() {
    const year = view.getUTCFullYear();
    const month = view.getUTCMonth();
    const last = utc(year, month + 1, 0);
    title.textContent = MONTH_HE.format(view);
    hebrewLine.textContent = hebrewSpan(view, last);

    // חודש שכולו מאחורי היום או כולו מעבר לאופק אינו נגיש.
    prev.disabled = utc(year, month, 0) < today;
    next.disabled = utc(year, month + 1, 1) > limit;

    grid.replaceChildren(el('div', { class: 'cal-row', role: 'row' },
      config.dayInitials.map((initial, index) => el('span', {
        class: 'cal-dow', role: 'columnheader', 'aria-label': config.dayNames[index], text: initial,
      }))));

    let row = el('div', { class: 'cal-row', role: 'row' });
    // ריפוד לפני הראשון בחודש, כדי שהעמודות יישארו ימי שבוע.
    for (let pad = 0; pad < view.getUTCDay(); pad += 1) {
      row.append(el('span', { class: 'cal-pad', role: 'gridcell' }));
    }

    for (let day = 1; day <= last.getUTCDate(); day += 1) {
      const date = utc(year, month, day);
      const closed = closureFor(date, config, today);
      const cell = el('button', {
        type: 'button',
        class: `cal-day${closed ? ' is-closed' : ''}${sameDay(date, picked) ? ' is-picked' : ''}`,
        role: 'gridcell',
        // roving tabindex: תא אחד בלבד נגיש ב-Tab, והחצים מזיזים אותו.
        tabindex: sameDay(date, cursor) ? '0' : '-1',
        'aria-selected': sameDay(date, picked) ? 'true' : 'false',
        'aria-disabled': closed ? 'true' : null,
        'aria-label': closed ? `${DATE_HE.format(date)} — ${closed.label}` : DATE_HE.format(date),
      }, [
        el('span', { class: 'cal-num', text: String(day) }),
        closed?.kind === 'holiday' ? el('span', { class: 'cal-tag', text: closed.label }) : null,
      ]);

      // התא נשאר כפתור גם כשהוא סגור, ולא disabled: קורא מסך צריך להגיע אליו
      // ולשמוע למה הוא סגור. aria-disabled מוסר את המשמעות בלי להסתיר אותו.
      cell.addEventListener('click', () => { if (!closed) pick(date); });
      cell.dataset.iso = isoOf(date);
      row.append(cell);

      if (row.children.length === 7) {
        grid.append(row);
        row = el('div', { class: 'cal-row', role: 'row' });
      }
    }
    if (row.children.length) grid.append(row);
  }

  function focusCursor() {
    const cell = grid.querySelector(`[data-iso="${isoOf(cursor)}"]`);
    if (cell) cell.focus();
  }

  // הזזת הפוקוס. חצייה של גבול חודש מחליפה חודש, כדי שהחצים לא ייתקעו בקצה.
  function moveCursor(days) {
    const target = new Date(cursor.getTime() + days * DAY_MS);
    if (target < today || target > limit) return;
    cursor = target;
    if (target.getUTCMonth() !== view.getUTCMonth()
        || target.getUTCFullYear() !== view.getUTCFullYear()) {
      view = utc(target.getUTCFullYear(), target.getUTCMonth(), 1);
    }
    renderGrid();
    focusCursor();
  }

  grid.addEventListener('keydown', (event) => {
    // ב-RTL החץ השמאלי מקדם, בדיוק כמו בטאבים ובלייטבוקס.
    const rtl = document.documentElement.dir === 'rtl';
    const moves = {
      ArrowLeft: rtl ? 1 : -1,
      ArrowRight: rtl ? -1 : 1,
      ArrowDown: 7,
      ArrowUp: -7,
      Home: -cursor.getUTCDay(),
      End: 6 - cursor.getUTCDay(),
    };
    if (event.key === 'PageDown' || event.key === 'PageUp') {
      event.preventDefault();
      const step = event.key === 'PageDown' ? 1 : -1;
      const target = utc(cursor.getUTCFullYear(), cursor.getUTCMonth() + step, cursor.getUTCDate());
      moveCursor(Math.round((target - cursor) / DAY_MS));
      return;
    }
    if (!(event.key in moves)) return;
    event.preventDefault();
    moveCursor(moves[event.key]);
  });

  prev.addEventListener('click', () => {
    view = utc(view.getUTCFullYear(), view.getUTCMonth() - 1, 1);
    cursor = view < today ? today : view;
    renderGrid();
  });
  next.addEventListener('click', () => {
    view = utc(view.getUTCFullYear(), view.getUTCMonth() + 1, 1);
    cursor = view;
    renderGrid();
  });

  // ----- שעות ופעולה -----

  // רשימת השירותים נבנית מ-data.js, ולכן קטגוריה חדשה (איפור, למשל) נכנסת
  // לכאן מעצמה בלי לגעת בקוד.
  function renderServices() {
    serviceBox.replaceChildren(...config.services.map((item) => {
      const button = el('button', {
        type: 'button', class: 'slot svc',
        'aria-pressed': item === service ? 'true' : 'false',
      }, [
        el('span', { class: 'svc-name', text: item.name }),
        el('span', { class: 'svc-time', text: durationLabel(item.minutes) }),
      ]);
      button.addEventListener('click', () => {
        service = item;
        // המשך השתנה, ולכן שעה שנבחרה קודם כבר לא בהכרח נכנסת.
        start = null;
        renderServices();
        renderSlots();
        renderAction();
      });
      return button;
    }));
  }

  function renderSlots() {
    slotsBox.replaceChildren();
    if (!service || !picked) {
      slotsHead.textContent = !service ? config.pickService : config.pickDate;
      return;
    }
    const times = slotsFor(picked, config, service.minutes);
    slotsHead.textContent = config.slotsHeading.replace('{date}', DATE_HE.format(picked));
    if (!times.length) {
      // היום פתוח, אבל השירות ארוך מדי כדי להסתיים לפני הסגירה.
      const open = Boolean(config.week[picked.getUTCDay()]);
      slotsBox.append(el('p', { class: 'book-empty', text: open ? config.noFit : config.noSlots }));
      return;
    }
    times.forEach((time) => {
      const button = el('button', {
        type: 'button', class: 'slot', text: timeLabel(time),
        'aria-pressed': time === start ? 'true' : 'false',
      });
      button.addEventListener('click', () => { start = time; renderSlots(); renderAction(); });
      slotsBox.append(button);
    });
  }

  function renderAction() {
    // כל בחירה חדשה מייצרת Blob חדש. בלי שחרור הקודם הם נערמים בזיכרון.
    if (icsUrl) { URL.revokeObjectURL(icsUrl); icsUrl = null; }
    if (!service || !picked || start == null) {
      actions.hidden = true;
      chosenLine.textContent = config.emptyMessage;
      return;
    }
    const fields = {
      '{service}': service.name,
      '{day}': config.dayNames[picked.getUTCDay()],
      '{date}': DATE_HE.format(picked),
      '{time}': timeLabel(start),
    };
    const fill = (template) => Object.entries(fields)
      .reduce((text, [key, value]) => text.split(key).join(value), template);

    chosenLine.textContent = `${fill(config.chosenLine)} — ${config.pendingNote}`;
    cta.href = whatsappLink(whatsappHref, fill(config.messageTemplate));

    // השעה נבנית בזמן המקומי ולא ב-UTC: זו שעת התור בפועל ביומן.
    const at = new Date(
      picked.getUTCFullYear(), picked.getUTCMonth(), picked.getUTCDate(),
      Math.floor(start / 60), start % 60, 0,
    );
    icsUrl = URL.createObjectURL(icsBlob(config, at, service));
    ics.href = icsUrl;
    actions.hidden = false;
  }

  function pick(date) {
    picked = date;
    cursor = date;
    start = null;
    renderGrid();
    renderSlots();
    renderAction();
  }

  root.append(
    el('div', { class: 'book-step' }, [
      el('strong', { class: 'book-title', text: config.serviceHeading }),
      serviceBox,
    ]),
    el('div', { class: 'cal' }, [
      el('div', { class: 'cal-head' }, [prev, el('div', { class: 'cal-label' }, [title, hebrewLine]), next]),
      grid,
    ]),
    el('div', { class: 'book-slots' }, [slotsHead, slotsBox]),
    chosenLine,
    actions,
  );

  renderServices();
  renderGrid();
  renderSlots();
  renderAction();
}
