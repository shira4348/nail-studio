// ---------------------------------------------------------------------------
// tools/make-icons.mjs — מייצר את האייקון של האתר.
//
// פרופיל בקו אחד, בשפה של הלוגו: מצח, אף, שפתיים, סנטר, ושיער ארוך וגלי
// שנופל אחורה. **קווים ולא מילוי** — הלוגו הוא רישום קו, וצללית מלאה
// הייתה שפה אחרת לגמרי.
//
// מקור אמת אחד: כל משיכה מוגדרת כאן פעם אחת, וממנה נגזרים גם ה-SVG
// (שמשרטט אותה ממש) וגם ה-PNG (שבו כל משיכה מומרת למצולע ונצרבת).
//
//   node tools/make-icons.mjs
//
// פלט: favicon.svg (הדפדפן), apple-touch-icon.png (מסך הבית באייפון),
// icon-512.png (שיתוף ומניפסט).
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const BOX = 64;
const INK = [0x1f, 0x1b, 0x18];    // --ink
const BG = [0xf4, 0xf0, 0xe8];     // --bg

// כל משיכה: נקודת פתיחה, רשימת מקטעים, ועובי. המקטעים הם ['C',x1,y1,x2,y2,x,y]
// או ['L',x,y] — בדיוק כמו ב-SVG, כדי ששתי הדרכים יקראו את אותו מקור.
//
// העובי משתנה בכוונה: קו הפנים דק, השיער עבה מעט יותר. ניגודיות עובי היא
// מה שמבדיל בין רישום לבין מתאר טכני.
const STROKES = [
  {
    // קו הפנים: מהמצח, דרך הגבה, האף, השפתיים והסנטר, עד הלסת.
    width: 2.6,
    start: [33, 13],
    segments: [
      ['C', 25, 13, 20, 19, 19, 27],
      ['C', 18.5, 30, 18, 31, 16.5, 33],
      ['L', 12, 37.5],
      ['C', 14.5, 38.5, 15.5, 38.5, 17, 39.5],
      ['C', 15.5, 41.5, 15.5, 42.5, 17, 43.5],
      ['C', 19.5, 45, 19.5, 46.5, 17, 48.5],
      ['C', 18, 51.5, 21, 54.5, 26, 56],
    ],
  },
  {
    // מתאר השיער: מאותה נקודת מצח, אחורה ולמטה.
    width: 3,
    start: [33, 13],
    segments: [
      ['C', 44, 13, 50, 21, 51.5, 31],
      ['C', 53, 41, 51, 51, 46, 59],
    ],
  },
  {
    // שתי מחלפות פנימיות. בלעדיהן השיער הוא כתם, איתן הוא נופל.
    width: 2,
    start: [36, 17],
    segments: [['C', 43, 20, 46, 28, 46, 37], ['C', 46, 45, 44.5, 52, 42, 58]],
  },
  {
    width: 1.7,
    start: [31, 22],
    segments: [['C', 37, 26, 39.5, 33, 39, 41], ['C', 38.7, 48, 37.5, 53, 36, 57]],
  },
];

// ----- שיטוח מסלול לפוליגון פתוח -----

const cubic = (p0, p1, p2, p3, t) => {
  const u = 1 - t;
  return [0, 1].map((i) =>
    u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i]);
};

function polyline(stroke, steps = 20) {
  const points = [stroke.start];
  let current = stroke.start;
  for (const seg of stroke.segments) {
    if (seg[0] === 'L') {
      current = [seg[1], seg[2]];
      points.push(current);
      continue;
    }
    const p1 = [seg[1], seg[2]];
    const p2 = [seg[3], seg[4]];
    const p3 = [seg[5], seg[6]];
    for (let i = 1; i <= steps; i += 1) points.push(cubic(current, p1, p2, p3, i / steps));
    current = p3;
  }
  return points;
}

// הרחבת קו לשורת מצולעים.
//
// מלבן אחד ארוך לכל הקו היה הדרך המתבקשת, והוא נכשל: בקצה האף הכיוון
// מתהפך כמעט לאחור, שני צדי הקו מצטלבים, וכלל הזוגיות שבצורב מפרש את
// ההצטלבות כחור. בקובץ יצא כתם לבן בדיוק שם.
//
// לכן כל מקטע הופך למרובע נפרד — מרובע קמור לא יכול להצטלב בעצמו — ועל
// כל קודקוד מונח מתומן בקוטר העובי, שממלא את הפינות. זה בדיוק מה שנותן
// stroke-linecap ו-stroke-linejoin עגולים ב-SVG.
function pieces(points, width) {
  const half = width / 2;
  const out = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-9) continue;
    const nx = (-(by - ay) / len) * half;
    const ny = ((bx - ax) / len) * half;
    out.push([[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]]);
  }
  for (const [px, py] of points) {
    out.push([...Array(8)].map((_, k) => {
      const angle = (k / 8) * Math.PI * 2;
      return [px + Math.cos(angle) * half, py + Math.sin(angle) * half];
    }));
  }
  return out;
}

// ----- SVG -----

const pathOf = (stroke) => `M${stroke.start[0]},${stroke.start[1]} ` + stroke.segments.map((seg) =>
  (seg[0] === 'L' ? `L${seg[1]},${seg[2]}`
    : `C${seg[1]},${seg[2]} ${seg[3]},${seg[4]} ${seg[5]},${seg[6]}`)).join(' ');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOX} ${BOX}" role="img" aria-label="סטודיו שירה">
  <rect width="${BOX}" height="${BOX}" rx="0" fill="#F4F0E8"/>
  <g fill="none" stroke="#1F1B18" stroke-linecap="round" stroke-linejoin="round">
${STROKES.map((stroke) =>
    `    <path d="${pathOf(stroke)}" stroke-width="${stroke.width}"/>`).join('\n')}
  </g>
</svg>
`;
fs.writeFileSync(path.join(root, 'favicon.svg'), svg, 'utf8');

// ----- צריבת PNG -----

const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return (buffer) => {
    let c = -1;
    for (const byte of buffer) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // עומק ביט
  ihdr[9] = 6;    // RGBA
  // כל שורה נפתחת בבית סינון 0 — בלעדיו הפורמט לא תקין.
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// סריקת קווים: לכל תת-שורה מחשבים את נקודות החיתוך עם המצולע פעם אחת,
// וממלאים את המקטעים שביניהן. בדיקת שייכות לכל דגימה בנפרד הייתה
// O(פיקסלים × דגימות × צלעות) — מיליארד פעולות ל-512, וזה פשוט לא נגמר.
const SS = 4;   // 4×4 דגימות לפיקסל, אחרת הקצוות משוננים

function accumulate(cov, shape, size) {
  const scale = BOX / size;
  for (let sy = 0; sy < size * SS; sy += 1) {
    const py = (sy + 0.5) / SS;
    const y = py * scale;
    const crossings = [];
    for (let i = 0, j = shape.length - 1; i < shape.length; j = i, i += 1) {
      const [xi, yi] = shape[i];
      const [xj, yj] = shape[j];
      if ((yi > y) !== (yj > y)) crossings.push(xi + ((xj - xi) * (y - yi)) / (yj - yi));
    }
    if (crossings.length < 2) continue;
    crossings.sort((a, b) => a - b);
    const row = Math.min(size - 1, Math.floor(py));
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const first = Math.max(0, Math.ceil((crossings[k] / scale) * SS - 0.5));
      const last = Math.min(size * SS - 1, Math.floor((crossings[k + 1] / scale) * SS - 0.5));
      for (let sx = first; sx <= last; sx += 1) {
        const at = row * size + Math.floor(sx / SS);
        cov[at] = Math.min(SS * SS, cov[at] + 1);
      }
    }
  }
}

function render(size) {
  // כל משיכה נצרבת בנפרד ומצטרפת לאותה מפת כיסוי. חפיפה בין משיכות לא
  // מחשיכה פי שניים — הדיו לא מצטבר, ולכן הערך חסום.
  const cov = new Float32Array(size * size);
  for (const stroke of STROKES) {
    for (const piece of pieces(polyline(stroke), stroke.width)) accumulate(cov, piece, size);
  }

  const pixels = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    const t = Math.min(1, cov[i] / (SS * SS));
    for (let c = 0; c < 3; c += 1) pixels[i * 4 + c] = Math.round(BG[c] * (1 - t) + INK[c] * t);
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-512.png', 512]]) {
  fs.writeFileSync(path.join(root, name), png(size, render(size)));
  console.log(`${name} — ${size}×${size}`);
}
console.log('favicon.svg — וקטורי');
