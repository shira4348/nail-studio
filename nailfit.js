// ---------------------------------------------------------------------------
// nailfit.js — מוצא את הציפורן האמיתית בתמונה.
//
// **למה זה קיים.**
//
// כל מה שהיה עד כה ניבא איפה הציפורן צריכה להיות: נקודות הציון של היד,
// כפול יחסים קבועים. יחסים קבועים הם בדיוק הבעיה — הם משתנים מאדם לאדם,
// ממצלמה למצלמה ומתנוחה לתנוחה. אפשר לכוונן אותם עד אינסוף ותמיד תהיה יד
// שבה הם לא מדויקים.
//
// כאן הגישה הפוכה: הציפורן **נראית** בתמונה, אז נמצא אותה.
//
// **איך.**
//
// 1. מהניבוי לוקחים אזור עניין נדיב סביב קצה האצבע.
// 2. בונים מודל של צבע העור מהמקטע שמתחת למפרק — שם זה בוודאות עור.
// 3. מסמנים באזור העניין את הפיקסלים שרחוקים מהעור. ציפורן, בין אם היא
//    טבעית או צבועה, שונה מהעור שסביבה — זה מה שהופך אותה לנראית.
// 4. מהמסכה מחשבים מומנטים: מרכז, זווית, אורך ורוחב. ארבעת המספרים שאנחנו
//    צריכים, נמדדים ולא מנוחשים.
//
// **הזהירות.** מדידה שנכשלת גרועה מניבוי סביר: רקע שמציץ בין האצבעות
// נראה גם הוא "לא עור". לכן כל מדידה מקבלת ציון ביטחון, ומדידה שרחוקה
// מדי מהניבוי או קטנה מדי נדחית. הניבוי נשאר רשת הביטחון.
// ---------------------------------------------------------------------------

// ----- מודל העור -----

// כרומטיות במקום RGB: r/(r+g+b) מבטל את עוצמת התאורה ומשאיר את הגוון.
// אצבע בצל ואצבע באור הן אותו עור בדיוק, ורק ככה אפשר לראות את זה.
function chroma(r, g, b) {
  const sum = r + g + b || 1;
  return [r / sum, g / sum];
}

// ממוצע וסטייה של גוון העור, מתוך דגימות שידוע שהן עור.
export function skinModel(samples) {
  if (!samples.length) return null;
  let mr = 0; let mg = 0;
  for (const [r, g] of samples) { mr += r; mg += g; }
  mr /= samples.length;
  mg /= samples.length;
  let variance = 0;
  for (const [r, g] of samples) {
    variance += (r - mr) ** 2 + (g - mg) ** 2;
  }
  // רצפה על הסטייה: עור אחיד לגמרי ייתן סטייה אפסית, וכל פיקסל שאינו
  // זהה לו בדיוק ייחשב ציפורן. הרצפה שומרת על סף שפוי.
  const spread = Math.max(0.012, Math.sqrt(variance / samples.length));
  return { r: mr, g: mg, spread };
}

// ----- מומנטים -----

// מרכז, זווית וצירים של מסכה בינארית, מתוך מומנטים מרכזיים.
//
// לאליפסה מלאה עם חצאי-צירים a,b מתקיים mu20 = a²/4, ולכן האורך המלא הוא
// 4·√mu20. אותה נוסחה נותנת גם את הזווית, וזו בדיוק הסיבה להשתמש במומנטים
// ולא בתיבה חוסמת: תיבה חוסמת לא יודעת על סיבוב.
export function moments(mask, width, height) {
  let m00 = 0; let m10 = 0; let m01 = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      m00 += 1; m10 += x; m01 += y;
    }
  }
  if (m00 < 12) return null;
  const cx = m10 / m00;
  const cy = m01 / m00;

  let mu20 = 0; let mu02 = 0; let mu11 = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      const dx = x - cx;
      const dy = y - cy;
      mu20 += dx * dx; mu02 += dy * dy; mu11 += dx * dy;
    }
  }
  mu20 /= m00; mu02 /= m00; mu11 /= m00;

  const common = Math.sqrt(Math.max(0, 4 * mu11 * mu11 + (mu20 - mu02) ** 2));
  const l1 = (mu20 + mu02 + common) / 2;
  const l2 = Math.max(0, (mu20 + mu02 - common) / 2);
  return {
    area: m00,
    cx,
    cy,
    // הזווית של הציר הארוך, במערכת של התמונה.
    angle: 0.5 * Math.atan2(2 * mu11, mu20 - mu02),
    major: 4 * Math.sqrt(l1),
    minor: 4 * Math.sqrt(l2),
  };
}

// ----- החיפוש -----

// הרכיב הקשיר הגדול ביותר, בסריקה איטרטיבית (בלי רקורסיה — אזור עניין
// של 80×80 היה יכול להגיע לעומק של אלפי קריאות).
export function largestBlob(mask, width, height) {
  const seen = new Uint8Array(mask.length);
  const best = new Uint8Array(mask.length);
  let bestSize = 0;
  const stack = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    const cells = [];
    while (stack.length) {
      const at = stack.pop();
      cells.push(at);
      const x = at % width;
      const y = (at - x) / width;
      if (x > 0 && mask[at - 1] && !seen[at - 1]) { seen[at - 1] = 1; stack.push(at - 1); }
      if (x + 1 < width && mask[at + 1] && !seen[at + 1]) { seen[at + 1] = 1; stack.push(at + 1); }
      if (y > 0 && mask[at - width] && !seen[at - width]) { seen[at - width] = 1; stack.push(at - width); }
      if (y + 1 < height && mask[at + width] && !seen[at + width]) {
        seen[at + width] = 1; stack.push(at + width);
      }
    }
    if (cells.length > bestSize) {
      bestSize = cells.length;
      best.fill(0);
      for (const at of cells) best[at] = 1;
    }
  }
  return bestSize ? best : null;
}

// מדידת הציפורן באזור עניין אחד.
//
// roi: {data, width, height} — פיקסלים RGBA כפי שהם בתמונה.
// skin: מודל העור מ-skinModel.
// expect: מה שהניבוי אמר — {cx, cy, major, minor} בקואורדינטות אזור העניין.
//
// מחזיר מדידה עם ציון ביטחון, או null אם אין על מה לסמוך.
export function fitNail(roi, skin, expect, options = {}) {
  const { data, width, height } = roi;
  const tolerance = options.tolerance ?? 2.4;
  const minFill = options.minFill ?? 0.05;
  const maxFill = options.maxFill ?? 0.72;

  if (!skin) return null;

  const mask = new Uint8Array(width * height);
  let marked = 0;
  for (let i = 0; i < width * height; i += 1) {
    const at = i * 4;
    const [r, g] = chroma(data[at], data[at + 1], data[at + 2]);
    const distance = Math.hypot(r - skin.r, g - skin.g) / skin.spread;
    if (distance > tolerance) { mask[i] = 1; marked += 1; }
  }

  const fill = marked / (width * height);
  // כמעט כלום מסומן — אין ציפורן נראית. כמעט הכל מסומן — מודל העור לא
  // תפס, וסביר שאזור העניין מלא ברקע. בשני המקרים עדיף הניבוי.
  if (fill < minFill || fill > maxFill) return null;

  const blob = largestBlob(mask, width, height);
  if (!blob) return null;
  const shape = moments(blob, width, height);
  if (!shape) return null;

  // המדידה חייבת להיות בסביבת הניבוי. כתם שנמצא חצי אזור עניין משם הוא
  // רקע או אצבע שכנה, לא הציפורן הזו.
  const drift = Math.hypot(shape.cx - expect.cx, shape.cy - expect.cy);
  const reach = Math.max(expect.major, expect.minor);
  if (drift > reach * 0.8) return null;

  // צורה: ציפורן ארוכה מרוחבה, אבל לא פי חמישה. יחס חריג מסגיר כתם
  // שאינו ציפורן — צל לאורך האצבע, או שתי ציפורניים שנדבקו.
  const ratio = shape.major / (shape.minor || 1);
  if (ratio < 1.05 || ratio > 4.5) return null;

  // ביטחון: כמה הכתם מלא ביחס לאליפסה שהמומנטים מתארים, וכמה הוא קרוב
  // לניבוי. שניהם בין 0 ל-1, והמכפלה היא המשקל שהמדידה תקבל.
  const ellipse = (Math.PI / 4) * shape.major * shape.minor;
  const solidity = Math.min(1, shape.area / (ellipse || 1));
  const nearness = 1 - drift / (reach * 0.8);
  return { ...shape, confidence: Math.max(0, Math.min(1, solidity * nearness)) };
}
