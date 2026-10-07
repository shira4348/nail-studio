// ---------------------------------------------------------------------------
// tools/make-holidays.mjs — מייצר holidays.ics לייבוא ליומן גוגל.
//
// למה זה קיים: בלוח הפגישות של גוגל, בחשבון חינמי, הזמינות נבדקת מול היומן
// הראשי בלבד. יומן חגים ש"נוסף" (יומנים אחרים) לא חוסם כלום, ולכן אפשר
// לקבוע תור ביום כיפור. הקובץ הזה מייצר אירועי "עסוק" אמיתיים שנכנסים
// ליומן הראשי וחוסמים בפועל.
//
// מקור הנתונים הוא site.booking — אותה טבלת חגים ואותן שעות שהאתר משתמש
// בהן, כדי שלא ייווצרו שני מקורות אמת. אחרי שינוי בטבלה — להריץ מחדש.
//
//   node tools/make-holidays.mjs [שנים קדימה]
//
// ברירת מחדל: 3 שנים. הפלט נכתב ל-holidays.ics בשורש הפרויקט.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { site } from '../data.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const years = Number(process.argv[2]) || 3;
const { holidays, week } = site.booking;

const HEBREW = new Intl.DateTimeFormat('en-u-ca-hebrew', {
  day: 'numeric', month: 'long', timeZone: 'UTC',
});

const utc = (y, m, d) => new Date(Date.UTC(y, m, d, 12));

function holidayOn(date) {
  const parts = HEBREW.formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  const month = get('month');
  const day = Number(get('day'));
  return holidays.find((entry) => entry.day === day
    && (Array.isArray(entry.month) ? entry.month.includes(month) : entry.month === month));
}

const pad = (n) => String(n).padStart(2, '0');
const icsEscape = (text) => text.replace(/([,;\\])/g, '\\$1');

// זמן "צף" — בלי Z ובלי TZID. הוא נקרא בשעון המקומי של היומן, ולכן נכון
// גם בשעון חורף וגם בשעון קיץ בלי להטמיע VTIMEZONE שלם.
// hour יכול להיות שברי (13.5 = 13:30), כמו ב-week ב-data.js.
const floating = (date, hour) => {
  const day = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
  return `${day}T${pad(Math.floor(hour))}${pad(Math.round((hour % 1) * 60))}00`;
};

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const lines = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//nail-studio//holidays//HE',
  'CALSCALE:GREGORIAN',
];

const today = new Date();
const start = utc(today.getFullYear(), today.getMonth(), today.getDate());
const total = Math.round(years * 365.25);
let count = 0;

for (let offset = 0; offset < total; offset += 1) {
  const date = new Date(start.getTime() + offset * 86400000);
  const day = week[date.getUTCDay()];
  // יום שסגור ממילא (שבת) לא צריך חסימה.
  if (!day) continue;
  const holiday = holidayOn(date);
  if (!holiday) continue;

  lines.push(
    'BEGIN:VEVENT',
    `UID:${floating(date, day.open)}-holiday@nail-studio`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${floating(date, day.open)}`,
    `DTEND:${floating(date, day.close)}`,
    `SUMMARY:${icsEscape(holiday.name)} — סגור`,
    // שני אלה יחד הם מה שגורם לגוגל להסתיר את השעות האלה מהלקוחות.
    'TRANSP:OPAQUE',
    'STATUS:CONFIRMED',
    'END:VEVENT',
  );
  count += 1;
}

lines.push('END:VCALENDAR');
const out = path.join(root, 'holidays.ics');
fs.writeFileSync(out, `${lines.join('\r\n')}\r\n`, 'utf8');
console.log(`${count} חסימות חג ל-${years} שנים קדימה → ${out}`);
