// ---------------------------------------------------------------------------
// shade.js — בחירת גוון בשני מספרים.
//
// **למה לא RGB.**
//
// בוחר RGB נותן 16 מיליון צבעים, ורובם המוחלט לא נראים כמו לק. הוא גם
// מחייב להבין רוויה ובהירות כשני צירים נפרדים, וזה בדיוק מה שהופך את
// הבוחר של המערכת ללא שמיש בטלפון.
//
// כאן המרחב מצומצם בכוונה לשני מספרים שאפשר להסביר במילה אחת:
//
//   **גוון** — מאיזה צבע מדובר. מעגל הצבעים, 0 עד 360.
//   **עומק** — כמה הוא פסטלי או רווי. 0 = שקוף כמעט, 100 = כהה ועשיר.
//
// העומק מזיז רוויה ובהירות **יחד**, לאורך עקומה שנבחרה כך שכל נקודה
// עליה נראית כמו לק אמיתי. אי אפשר לקבל ממנה חום בוצי או ניאון זוהר,
// וזו המטרה: לא לתת את כל המרחב, אלא את החלק שבו כל בחירה יפה.
// ---------------------------------------------------------------------------

// קצות עקומת העומק. רוויה עולה ובהירות יורדת יחד — בדיוק מה שמבדיל
// ורוד בייבי מפוקסיה, או נוד מקרמל.
const PALE = { s: 0.36, l: 0.90 };
const DEEP = { s: 0.74, l: 0.24 };

const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
const lerp = (a, b, t) => a + (b - a) * t;

// HSL ל-hex. מימוש ישיר של נוסחת ההמרה, בלי טבלאות ובלי תלויות.
export function hslToHex(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 1);
  const light = clamp(l, 0, 1);
  const a = sat * Math.min(light, 1 - light);
  const channel = (n) => {
    const k = (n + hue / 30) % 12;
    const value = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * value).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

export function hexToHsl(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: ((h * 60) % 360 + 360) % 360, s: clamp(s, 0, 1), l };
}

// שני המספרים אל הצבע, ובחזרה.
export const shadeHex = (hue, depth) => {
  const t = clamp(depth, 0, 1);
  return hslToHex(hue, lerp(PALE.s, DEEP.s, t), lerp(PALE.l, DEEP.l, t));
};

// העומק נגזר מהבהירות ולא מהרוויה: הבהירות יורדת מונוטונית לאורך
// העקומה, ולכן היא הפיכה חד-משמעית. הרוויה לא בהכרח.
export const depthOf = (hex) => {
  const hsl = hexToHsl(hex);
  if (!hsl) return null;
  return clamp((PALE.l - hsl.l) / (PALE.l - DEEP.l), 0, 1);
};

export const hueOf = (hex) => hexToHsl(hex)?.h ?? null;

// רצועת הצבע שמתחת למחוון העומק, בגוון הנוכחי. המחוון מראה בדיוק לאן
// הוא מוביל — בלי זה הוא פס אפור שצריך לנחש מה הוא עושה.
export const depthStops = (hue, steps = 7) =>
  [...Array(steps)].map((_, i) => shadeHex(hue, i / (steps - 1)));
