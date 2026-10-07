// ---------------------------------------------------------------------------
// tools/icon-from-logo.mjs — הופך את קובץ הלוגו לסט האייקונים של האתר.
//
//   node tools/icon-from-logo.mjs
//   node tools/icon-from-logo.mjs --crop=0.05,0.08,0.55,0.34
//
// הקלט: assets/logo.png — המאסטר המלא. חייב PNG; JPG לא
// נתמך כאן, וההמרה חינם בכל עורך.
//
// מה הוא עושה: מפענח את ה-PNG, חותך מלבן, מכווץ אותו לריבוע, ומייצר
// favicon.png, apple-touch-icon.png ו-icon-512.png. בסוף הוא גם מפנה את
// index.html לאייקון החדש.
//
// **על החיתוך.** אייקון בלשונית הוא 16 פיקסלים. רישום שלם — עם הבניין,
// הטלפון וקפלי הבגד — נמרח שם לכתם. ברירת המחדל חותכת את אזור הראש
// והשיער בלבד, כי זה החלק שנשאר קריא. אם הפריים לא יושב נכון, --crop
// מקבל ארבעה שברים: x, y, רוחב, גובה, ביחס לתמונה המלאה. הכלי מדפיס
// בכל ריצה מה הוא חתך.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// --from מאפשר להצביע על הקובץ איפה שהוא נשמר, בלי להעביר אותו קודם.
const fromArg = process.argv.find((a) => a.startsWith('--from='));
// המאסטר יושב ב-assets/ ולא ב-images/ בכוונה: build.mjs מעתיק את images
// כולה אל dist, וקובץ מקור של 700KB לא אמור להישלח ללקוחות. assets/ לא
// נכלל בבנייה, ולכן הוא נשאר שלך.
const source = fromArg ? fromArg.slice(7) : path.join(root, 'assets', 'logo.png');

const PAPER = [0xf4, 0xf0, 0xe8];
const INK = [0x19, 0x16, 0x13];

// ----- פענוח PNG -----

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function decodePng(buffer) {
  if (buffer.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('זה לא קובץ PNG. שמרי מחדש כ-PNG.');
  }
  let at = 8;
  let head = null;
  let palette = null;
  const data = [];
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('ascii', at + 4, at + 8);
    const body = buffer.slice(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      head = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        color: body[9],
        interlace: body[12],
      };
    } else if (type === 'PLTE') palette = body;
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (!head) throw new Error('חסר IHDR');
  if (head.depth !== 8) throw new Error(`עומק ${head.depth} ביט לא נתמך — שמרי ב-8 ביט לערוץ.`);
  if (head.interlace) throw new Error('PNG עם שזירה (interlaced) לא נתמך. שמרי בלי.');

  const channels = CHANNELS[head.color];
  if (!channels) throw new Error(`סוג צבע ${head.color} לא נתמך`);
  const stride = head.width * channels;
  const raw = zlib.inflateSync(Buffer.concat(data));

  // ביטול הסינון. כל שורה נפתחת בבית שאומר איזו חיזוי הופעל עליה, וכל
  // סוג מתייחס לפיקסל שמשמאל (a), שמעל (b), ולאלכסון (c).
  const out = Buffer.alloc(stride * head.height);
  for (let y = 0; y < head.height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const from = y * (stride + 1) + 1;
    for (let i = 0; i < stride; i += 1) {
      const x = raw[from + i];
      const a = i >= channels ? out[y * stride + i - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + i] : 0;
      const c = (i >= channels && y > 0) ? out[(y - 1) * stride + i - channels] : 0;
      let value;
      switch (filter) {
        case 0: value = x; break;
        case 1: value = x + a; break;
        case 2: value = x + b; break;
        case 3: value = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          value = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`סוג סינון ${filter} לא מוכר`);
      }
      out[y * stride + i] = value & 0xff;
    }
  }

  // המרה ל-RGBA אחיד, כדי שכל השאר לא יצטרך להכיר סוגי צבע.
  const rgba = Buffer.alloc(head.width * head.height * 4);
  for (let i = 0; i < head.width * head.height; i += 1) {
    const s = i * channels;
    let r; let g; let b; let a = 255;
    if (head.color === 0) { r = out[s]; g = out[s]; b = out[s]; }
    else if (head.color === 4) { r = out[s]; g = out[s]; b = out[s]; a = out[s + 1]; }
    else if (head.color === 2) { r = out[s]; g = out[s + 1]; b = out[s + 2]; }
    else if (head.color === 6) { r = out[s]; g = out[s + 1]; b = out[s + 2]; a = out[s + 3]; }
    else { const k = out[s] * 3; r = palette[k]; g = palette[k + 1]; b = palette[k + 2]; }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a;
  }
  return { width: head.width, height: head.height, rgba };
}

// ----- קידוד PNG -----

const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return (b) => {
    let c = -1;
    for (const byte of b) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(Buffer.concat([Buffer.from(type, 'ascii'), body])), 0);
  return Buffer.concat([head, body, crc]);
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
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

// PNG בגווני אפור: בית אחד לפיקסל במקום ארבעה.
//
// רישום קו הוא שחור על לבן — שלושת ערוצי הצבע נושאים בדיוק את אותו מידע,
// ואפיק השקיפות מלא ב-255 לאורך כל הקובץ. RGBA משלם על ארבעתם. סוג צבע 0
// שומר ערוץ אחד, וזה לבדו מוריד את הקובץ פי כמה.
function encodeGrayPng(width, height, gray) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // עומק ביט
  ihdr[9] = 0;    // גווני אפור
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    // סינון 2 (Up) — כל שורה נשמרת כהפרש מזו שמעליה. ברישום קו שורות
    // סמוכות כמעט זהות, וההפרש הוא כמעט כולו אפסים שנדחסים לכלום.
    raw[y * (width + 1)] = y === 0 ? 0 : 2;
    for (let x = 0; x < width; x += 1) {
      const here = gray[y * width + x];
      const above = y === 0 ? 0 : gray[(y - 1) * width + x];
      raw[y * (width + 1) + 1 + x] = (here - above) & 0xff;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// כיווץ התמונה כולה למלבן, בלי חיתוך. אותו ממוצע על בלוק כמו באייקונים.
function resizeGray(image, width, height) {
  const out = Buffer.alloc(width * height);
  const kx = image.width / width;
  const ky = image.height / height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let n = 0;
      for (let sy = Math.floor(y * ky); sy < Math.max(Math.ceil((y + 1) * ky), Math.floor(y * ky) + 1); sy += 1) {
        if (sy >= image.height) continue;
        for (let sx = Math.floor(x * kx); sx < Math.max(Math.ceil((x + 1) * kx), Math.floor(x * kx) + 1); sx += 1) {
          if (sx >= image.width) continue;
          const at = (sy * image.width + sx) * 4;
          const alpha = image.rgba[at + 3] / 255;
          const lum = 0.299 * image.rgba[at] + 0.587 * image.rgba[at + 1] + 0.114 * image.rgba[at + 2];
          sum += lum * alpha + 255 * (1 - alpha);
          n += 1;
        }
      }
      out[y * width + x] = n ? Math.round(sum / n) : 255;
    }
  }
  return out;
}

// ----- כיווץ -----

// ממוצע על כל בלוק המקור, ולא דגימה של פיקסל אחד ממנו. ברישום קו זה
// ההבדל בין קווים אפורים ורציפים לבין קווים מקוטעים: דגימה נקודתית
// מפספסת קו דק לגמרי כשהיא נוחתת לידו.
function downsample(image, crop, size, boost) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const x0 = crop.x + (x / size) * crop.w;
      const x1 = crop.x + ((x + 1) / size) * crop.w;
      const y0 = crop.y + (y / size) * crop.h;
      const y1 = crop.y + ((y + 1) / size) * crop.h;
      let r = 0; let g = 0; let b = 0; let n = 0;
      for (let sy = Math.floor(y0); sy < Math.max(Math.ceil(y1), Math.floor(y0) + 1); sy += 1) {
        if (sy < 0 || sy >= image.height) continue;
        for (let sx = Math.floor(x0); sx < Math.max(Math.ceil(x1), Math.floor(x0) + 1); sx += 1) {
          if (sx < 0 || sx >= image.width) continue;
          const at = (sy * image.width + sx) * 4;
          const alpha = image.rgba[at + 3] / 255;
          // רקע שקוף נחשב נייר, אחרת הרישום יושב על חור.
          r += image.rgba[at] * alpha + PAPER[0] * (1 - alpha);
          g += image.rgba[at + 1] * alpha + PAPER[1] * (1 - alpha);
          b += image.rgba[at + 2] * alpha + PAPER[2] * (1 - alpha);
          n += 1;
        }
      }
      // **הגברת הדיו.** קו של פיקסל אחד בתמונה של 768, אחרי כיווץ ל-64,
      // מתפרס על שישית פיקסל — והממוצע הופך אותו לאפור בהיר שכמעט לא
      // נראה. רישום שלם היה יוצא כתם ריק.
      //
      // לכן מודדים כמה דיו יש בפיקסל ומחזקים אותו: מה שהיה 15% שחור הופך
      // לשחור ממשי. זה לא "חידוד" אלא שחזור — הדיו היה שם, הממוצע פיזר
      // אותו.
      const lum = n ? (0.299 * r + 0.587 * g + 0.114 * b) / n : 255;
      const paperLum = 0.299 * PAPER[0] + 0.587 * PAPER[1] + 0.114 * PAPER[2];
      const t = Math.min(1, Math.max(0, (paperLum - lum) / paperLum) * boost);
      const at = (y * size + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        out[at + c] = Math.round(PAPER[c] * (1 - t) + INK[c] * t);
      }
      out[at + 3] = 255;
    }
  }
  return out;
}

// ----- ריצה -----

if (!fs.existsSync(source)) {
  console.error(`לא נמצא ${path.relative(root, source)}`);
  console.error('שמרי את הרישום שם — PNG, לא JPG — והריצי שוב.');
  console.error('או הצביעי עליו איפה שהוא: node tools/icon-from-logo.mjs --from="C:/Users/shira/Downloads/logo.png"');
  process.exit(1);
}

// ככל שהאייקון קטן יותר, כך הקו מתפזר יותר וצריך חיזוק חזק יותר.
const boostArg = process.argv.find((a) => a.startsWith('--ink='));
const boost = boostArg ? Number(boostArg.slice(6)) : 2.6;

const arg = process.argv.find((a) => a.startsWith('--crop='));
// ברירת המחדל: הראש והשיער, בשליש העליון. שם הרישום עדיין קריא ב-16 פיקסלים.
const box = (arg ? arg.slice(7).split(',').map(Number) : [0.04, 0.09, 0.58, 0.36]);
if (box.length !== 4 || box.some((v) => !Number.isFinite(v))) {
  console.error('--crop דורש ארבעה מספרים: x,y,רוחב,גובה (שברים של 0 עד 1)');
  process.exit(1);
}

const image = decodePng(fs.readFileSync(source));
const crop = {
  x: box[0] * image.width,
  y: box[1] * image.height,
  w: box[2] * image.width,
  h: box[3] * image.height,
};
// ריבוע: אייקון לא מרובע נמתח. לוקחים את הצלע הגדולה ומרחיבים סביב המרכז.
const side = Math.max(crop.w, crop.h);
crop.x -= (side - crop.w) / 2;
crop.y -= (side - crop.h) / 2;
crop.w = side;
crop.h = side;

console.log(`מקור ${image.width}×${image.height}`);
console.log(`חיתוך ${Math.round(crop.x)},${Math.round(crop.y)} בגודל ${Math.round(side)}×${Math.round(side)}`);

for (const [name, size] of [['favicon.png', 64], ['apple-touch-icon.png', 180], ['icon-512.png', 512]]) {
  fs.writeFileSync(path.join(root, name), encodePng(size, downsample(image, crop, size, boost)));
  console.log(`${name} — ${size}×${size}`);
}

// האיור של ה-hero, מאותו מקור. ברוחב 460 — בתצוגה הוא ממילא בערך 190
// פיקסלים, וכל בית מעבר לזה הוא תעבורה שמישהי משלמת עליה.
const HERO_W = 460;
const heroPath = path.join(root, 'images', 'hero.png');
const heroH = Math.round((image.height * HERO_W) / image.width);
const heroBefore = fs.existsSync(heroPath) ? fs.statSync(heroPath).size : 0;
fs.mkdirSync(path.dirname(heroPath), { recursive: true });
fs.writeFileSync(heroPath, encodeGrayPng(HERO_W, heroH, resizeGray(image, HERO_W, heroH)));
const heroAfter = fs.statSync(heroPath).size;
console.log(`images/hero.png — ${HERO_W}×${heroH} בגווני אפור, `
  + `${Math.round(heroAfter / 1024)}KB`
  + (heroBefore ? ` (היה ${Math.round(heroBefore / 1024)}KB)` : ''));

// ה-SVG הישן היה הרישום שלי. משהופיע הרישום שלה, הוא מפנה מקום.
const html = path.join(root, 'index.html');
let page = fs.readFileSync(html, 'utf8');
if (page.includes('href="favicon.svg"')) {
  page = page.replace('<link rel="icon" href="favicon.svg" type="image/svg+xml">',
    '<link rel="icon" href="favicon.png" type="image/png">');
  fs.writeFileSync(html, page, 'utf8');
  console.log('index.html מפנה עכשיו ל-favicon.png');
}
console.log('\nעכשיו: node tools/build.mjs');
