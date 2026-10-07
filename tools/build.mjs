// ---------------------------------------------------------------------------
// tools/build.mjs — מכין תיקיית dist/ להעלאה.
//
// זה לא באמת build: אין כאן קימפוד, אין חבילות, ואין שינוי בקוד. הוא רק
// מעתיק את קבצי האתר בלבד, כי כל מה שנמצא בתיקייה שמעלים הופך לציבורי —
// ו-ROADMAP.md, holidays.ics ו-tools/ הם שלך, לא של הלקוחות.
//
//   node tools/build.mjs            → dist/ עם robots.txt שחוסם מנועי חיפוש
//   node tools/build.mjs --public   → dist/ שמותר לאינדוקס
//
// ברירת המחדל חוסמת בכוונה: ההעלאה הראשונה היא לכתובת זמנית לבדיקה, ואין
// שום סיבה שגוגל תאנדקס אותה. ביום שעולים לדומיין האמיתי — --public.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

// הרשימה מפורשת ולא "כל מה שנגמר ב-js". קובץ חדש צריך להיכנס לכאן במודע.
const FILES = [
  'index.html',
  'styles.css',
  'main.js',
  'data.js',
  'dom.js',
  'gallery.js',
  'designer.js',
  'tryon.js',
  'nailfit.js',
  'shade.js',
  'wheel.js',
  'calendar.js',
  'favicon.svg',
  'favicon.png',
  'apple-touch-icon.png',
  'icon-512.png',
];

// תיקיות נכסים שיעלו אם וכאשר הן קיימות.
const DIRS = ['images', 'fonts'];

const isPublic = process.argv.includes('--public');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

let bytes = 0;
const missing = [];

for (const name of FILES) {
  const from = path.join(root, name);
  if (!fs.existsSync(from)) { missing.push(name); continue; }
  fs.copyFileSync(from, path.join(dist, name));
  bytes += fs.statSync(from).size;
}

for (const dir of DIRS) {
  const from = path.join(root, dir);
  if (!fs.existsSync(from)) continue;
  fs.cpSync(from, path.join(dist, dir), { recursive: true });
}

fs.writeFileSync(
  path.join(dist, 'robots.txt'),
  isPublic ? 'User-agent: *\nAllow: /\n' : 'User-agent: *\nDisallow: /\n',
  'utf8',
);

const kb = (bytes / 1024).toFixed(0);
console.log(`dist/ מוכנה — ${FILES.length - missing.length} קבצים, ${kb}KB`);
console.log(isPublic ? 'robots.txt: פתוח לאינדוקס' : 'robots.txt: חוסם מנועי חיפוש (--public כדי לפתוח)');
if (missing.length) console.log(`חסרים ולא הועתקו: ${missing.join(', ')}`);
