// ---------------------------------------------------------------------------
// tryon.js — מדידה על היד האמיתית.
//
// המצלמה נפתחת, MediaPipe מזהה 21 נקודות ציון לכל יד, ואנחנו מציירים את
// העיצוב שנבחר במעצבת על הציפורניים האמיתיות, פריים אחר פריים.
//
// ארבע נקודות שחשוב להבין לפני שנוגעים:
//
// 1. **התמונה לא עוזבת את המכשיר.** הזיהוי רץ ב-WASM בתוך הדפדפן. אין שרת,
//    אין העלאה, אין מפתח API. זו לא רק החלטת פרטיות — זו הסיבה שזה אפשרי
//    בכלל באתר סטטי.
//
// 2. **אין כאן מצב משלו.** העיצוב מגיע מ-designer.js דרך getDesign(), כדי
//    שלא יהיו שני מקורות אמת שמסתעפים. מה שרואים על היד הוא בדיוק מה
//    שרואים על היד המצוירת.
//
// 3. **אותה גיאומטריה בדיוק.** הציפורן מצוירת מאותם נתיבי SVG שב-data.js,
//    באותה מערכת קואורדינטות (100×176, עורף ב-y=170).
//
// 4. **ההצבה תלת-ממדית.** MediaPipe מחזיר את הנקודות פעמיים: כקואורדינטות
//    תמונה, וגם כמיקום מרחבי אמיתי. השימוש בשני אלה יחד הוא מה שמבדיל בין
//    מדבקה שטוחה שמונחת על האצבע לבין ציפורן שיושבת עליה — כי רק מהמרחב
//    אפשר לדעת לאיזה כיוון האצבע מוטה, וכמה הציפורן אמורה להתקצר בגללה.
// ---------------------------------------------------------------------------

import { el } from './dom.js';
import { skinModel, fitNail } from './nailfit.js';

// תיבת הציפורן המקומית — חייבת להתאים ל-designer.js.
const NAIL_W = 100;
const NAIL_H = 176;
const CUTICLE_Y = 170;
// גוף הציפורן משתרע מ-x=12 עד x=88 בתוך התיבה. הרוחב המבוקש מתייחס לגוף.
const BODY_W = 76;
const NAIL_LEN = CUTICLE_Y - 8;

// נקודות הציון של MediaPipe. לכל אצבע: המפרק העליון וקצה האצבע.
// הציפורן יושבת בין השניים, ומכאן גם המיקום, גם הזווית וגם הגודל.
const JOINTS = {
  thumb: [3, 4], index: [7, 8], middle: [11, 12], ring: [15, 16], pinky: [19, 20],
};
// רוחב כף היד: פרק האצבע עד פרק הזרת. מדד יציב לקנה מידה של היד.
const PALM = [5, 17];
// המפרק האמצעי של כל אצבע. המקטע ממנו אל המפרק העליון הוא עור ודאי,
// ומשם נדגם צבע העור שמולו מחפשים את הציפורן.
const MID_JOINT = { thumb: 2, index: 6, middle: 10, ring: 14, pinky: 18 };
// שורש כף היד ושני פרקי הקצה — שלוש נקודות שמגדירות את מישור כף היד,
// ומהן הנורמל שאומר לאיזה כיוון פונה גב היד.
const PALM_PLANE = [0, 5, 17];
// זוגות שמשמשים לאמידת קנה המידה. מגוונים בכוונה — פרקי כף היד לרוחב,
// ומקטעי האצבעות לאורך — כדי שתמיד יהיה ביניהם זוג שקרוב למישור התמונה.
const SCALE_PAIRS = [
  [0, 5], [0, 9], [0, 13], [0, 17], [5, 9], [9, 13], [13, 17], [5, 17],
  [5, 6], [6, 7], [7, 8], [9, 10], [10, 11], [11, 12],
  [13, 14], [14, 15], [15, 16], [17, 18], [18, 19], [19, 20],
];

// ----- טעינת המודל -----

let loading = null;

// הורדה עם מדידה.
//
// **הסיבה שאנחנו מורידים את המודל בעצמנו** ולא נותנים ל-MediaPipe לעשות
// זאת: modelAssetPath לא מדווח כלום, ושבעה מגה-בייט ברשת סלולרית הם
// עשרות שניות של מסך שלא זז. baseOptions מקבל גם modelAssetBuffer, ולכן
// אפשר להוריד לבד, לספור בדרך, ורק אז למסור.
async function fetchWithProgress(url, onProgress) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const total = Number(response.headers.get('content-length')) || 0;
  // בלי content-length אין ממה לחשב אחוז, ועדיף חיווי בלתי מוגדר על פני
  // מספר שקרי. גם דחיסה בדרך יכולה לבטל את הכותרת.
  if (!response.body || !total) return new Uint8Array(await response.arrayBuffer());

  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded / total);
  }
  const out = new Uint8Array(loaded);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  return out;
}

// נטען פעם אחת, ורק כשבאמת לוחצים. זו הורדה של כמה מגה-בייט, ואין סיבה
// שמישהי שלא פתחה את המצלמה תשלם עליה.
//
// onStage מקבל שלב וחלק: 'bundle' בלי אחוזים (import דינמי לא מדווח),
// 'model' עם 0..1, ו-'build' בזמן האתחול עצמו.
function loadLandmarker(model, onStage = () => {}) {
  if (loading) { onStage('bundle', null); return loading; }
  loading = (async () => {
    onStage('bundle', null);
    const vision = await import(/* webpackIgnore: true */ model.bundle);
    const files = await vision.FilesetResolver.forVisionTasks(model.wasm);
    onStage('model', 0);
    const asset = await fetchWithProgress(model.asset, (part) => onStage('model', part));
    onStage('build', null);
    return vision.HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetBuffer: asset, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: model.hands,
      minHandDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  })().catch((error) => { loading = null; throw error; });
  return loading;
}

// ----- וקטורים -----

const lerp = (a, b, t) => a + (b - a) * t;
const sub3 = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross3 = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const len3 = (v) => Math.hypot(v.x, v.y, v.z);
const unit3 = (v) => {
  const n = len3(v);
  return n ? { x: v.x / n, y: v.y / n, z: v.z / n } : { x: 0, y: 0, z: 0 };
};

// החלקה מעריכית על נקודות הציון. בלעדיה הציפורניים רועדות בין פריימים,
// וזה מה שמבדיל בין "מרשים" לבין "זול".
function smooth(previous, next, alpha) {
  if (!previous || previous.length !== next.length) return next;
  return next.map((point, i) => ({
    x: lerp(previous[i].x, point.x, alpha),
    y: lerp(previous[i].y, point.y, alpha),
    z: lerp(previous[i].z ?? 0, point.z ?? 0, alpha),
  }));
}

// ----- הצבת הציפורן -----

// כל ההצבות מסתיימות באותו דבר: מטריצה אפינית שמעבירה את תיבת הציפורן
// המקומית אל הקנבס. ex ו-ey הם התמונה של יחידת ציר x ושל יחידת ציר y,
// ו-at הוא המקום שאליו נוחת מרכז העורף המקומי (50, 170).
//
// משתמשים ב-transform ולא ב-setTransform בכוונה: כשהמצלמה הקדמית פעילה
// כבר יש מטריצת מראה על הקנבס, והצבת הציפורן צריכה להצטרף אליה ולא למחוק
// אותה.
function placeNail(ctx, { at, ex, ey }) {
  ctx.transform(
    ex.x, ex.y, ey.x, ey.y,
    at.x - ex.x * (NAIL_W / 2) - ey.x * CUTICLE_Y,
    at.y - ex.y * (NAIL_W / 2) - ey.y * CUTICLE_Y,
  );
}

// מידות הציפורן ומקומה על אצבע אחת.
//
// **כל מה שנמדד — נמדד בתמונה. מהמרחב לוקחים רק כיוונים.**
//
// זו לא קפריזה אלא תיקון של טעות: קודם גזרתי את הגודל מהמיקום המרחבי
// שהמודל מחזיר, והכפלתי בקנה מידה שנאמד מהתאמת שתי המערכות. כשהיד מוטה,
// הפרישה המרחבית שלה גדולה מהפרישה בתמונה — האומדן יוצא קטן מדי, וכל
// הציפורניים מתכווצות. ככל שהיד מוטה יותר, כך הן קטנות יותר. זה בדיוק
// ההפך ממה שצריך לקרות.
//
// רוחב כף היד בפיקסלים, לעומת זאת, הוא מדידה ישירה של מה שרואים. הוא
// כבר כולל את הפרספקטיבה, ואי אפשר לטעות בו.
// כמה פיקסלים שווה יחידת מרחב אחת.
//
// **מקסימום, לא ממוצע.** הטלה רק מקצרת: לכל זוג נקודות, המרחק בתמונה קטן
// או שווה למרחק במרחב כפול קנה המידה. לכן הזוג שנותן את היחס הגבוה ביותר
// הוא הזוג שבמקרה מקביל למישור התמונה, והיחס שלו הוא קנה המידה האמיתי.
//
// קודם אמדתי את זה בריבועים פחותים על כל הנקודות. ממוצע על זוגות שחלקם
// מוטים נמשך כלפי מטה, ולכן ככל שהיד הייתה מוטה יותר כך הציפורניים יצאו
// קטנות יותר — בדיוק ההפך ממה שצריך.
export function projectionScale(marks, world) {
  if (!marks || !world) return 0;
  let best = 0;
  for (const [i, j] of SCALE_PAIRS) {
    if (!world[i] || !world[j] || !marks[i] || !marks[j]) continue;
    const spread = len3(sub3(world[i], world[j]));
    if (spread < 1e-9) continue;
    const seen = Math.hypot(marks[i].x - marks[j].x, marks[i].y - marks[j].y);
    best = Math.max(best, seen / spread);
  }
  return Number.isFinite(best) && best > 0 ? best : 0;
}

export function nailFrame(dip, tip, finger, design, base, reference, palmPixels, spatial) {
  // כוונון האצבע דורס את הכללי. בלי override — אותם מספרים בדיוק.
  const tune = finger.tuning ? { ...base, ...finger.tuning } : base;
  const dx = tip.x - dip.x;
  const dy = tip.y - dip.y;
  const segment = Math.hypot(dx, dy) || 1;
  // כיוון האצבע בתמונה, והניצב לו. שניהם יחידתיים, ושניהם נכונים תמיד.
  const along = { x: dx / segment, y: dy / segment };
  const across = { x: -along.y, y: along.x };

  // רוחב כף היד — מהמרחב כשאפשר, ואז הוא חסין לסיבוב, ומהתמונה כשאין.
  // רוחב הציפורן לא אמור להשתנות כשהיד מסתובבת סביב צירה, וההיטל של
  // הפרקים דווקא כן משתנה: זו הסיבה שהערך מהתמונה לבדו נתן ציפורניים
  // צרות מדי בכל תנוחה שאינה ישרה למצלמה.
  const span = spatial?.palm || palmPixels;
  const width = span * tune.width * (finger.nail / reference.nail);
  const sx = width / BODY_W;

  // **האורך נמדד מהאצבע, הרוחב מכף היד — וזה לא חוסר עקביות אלא הנקודה.**
  //
  // ניסיתי לגזור את האורך מהרוחב, לפי היחס שהצורה מגדירה ביד המצוירת.
  // ביד מצוירת אין פרספקטיבה, ולכן שם היחס קבוע. במצלמה הוא לא: אצבע
  // שמצביעה אלייך נראית קצרה בלי שרוחבה משתנה כלל. יחס קבוע הכריח ציפורן
  // ארוכה בדיוק כשהמציאות דרשה קצרה.
  //
  // המקטע בתמונה הוא מדידה ישירה של הקיצור הזה. הוא לא מעריך אותו ולא
  // מסיק אותו — הוא פשוט רואה אותו. הרוחב, לעומת זאת, חייב להגיע מהמרחב,
  // כי הוא היחיד שלא אמור להשתנות כשהאצבע מוטה.
  const length = segment * tune.length * (design.length / reference.length);
  const sy = length / NAIL_LEN;

  // ההרמה אל גב האצבע. הנורמל לא מנורמל בכוונה: ההיטל שלו קטן כשהיד
  // פונה ישר למצלמה, וגדל כשהיא מוטה — וזה בדיוק גודל ההרמה הנדרש.
  const lift = width * tune.lift;
  const at = {
    x: dip.x + dx * tune.cuticle + (spatial?.normal.x ?? 0) * lift,
    y: dip.y + dy * tune.cuticle + (spatial?.normal.y ?? 0) * lift,
  };

  return {
    at, segment, sx, sy,
    ex: { x: across.x * sx, y: across.y * sx },
    ey: { x: -along.x * sy, y: -along.y * sy },
  };
}

// מה שהמרחב תורם: כמה האצבע מוטה אל המצלמה, ולאיזה כיוון פונה גב היד.
// שניהם חסרי יחידות, ולכן חסינים לבעיה שהפילה את הגרסה הקודמת.
export function spatialOf(world, joints, scale = 0) {
  if (!world) return null;
  const forward = unit3(sub3(world[joints[1]], world[joints[0]]));
  const [wrist, indexBase, pinkyBase] = PALM_PLANE;
  let normal = unit3(cross3(
    sub3(world[indexBase], world[wrist]),
    sub3(world[pinkyBase], world[wrist]),
  ));
  // ב-MediaPipe z קטן יותר הוא קרוב יותר, ולכן הציפורן תמיד על הצד הנראה.
  if (normal.z > 0) normal = { x: -normal.x, y: -normal.y, z: -normal.z };
  // אורך ההיטל של וקטור יחידה = הקוסינוס של ההטיה מחוץ למישור התמונה.
  return {
    tilt: Math.hypot(forward.x, forward.y),
    normal,
    palm: scale ? len3(sub3(world[PALM[0]], world[PALM[1]])) * scale : 0,
  };
}


// ----- כיול -----

// שלושה מספרים קובעים איך הציפורן יושבת, ואי אפשר לבחור אותם מרחוק: הם
// תלויים במצלמה, במרחק ובצורת היד. עם ?nails=tune מופיעים שלושה מחוונים
// ושורה שאפשר להעתיק היישר אל data.js — במקום עוד סבב ניחושים.
const KNOBS = [
  { key: 'width',   label: 'גודל',  min: 0.06, max: 0.34, step: 0.005 },
  { key: 'cuticle', label: 'מיקום', min: -0.15, max: 0.55, step: 0.01 },
  { key: 'length',  label: 'אורך',  min: 0.25, max: 1.4,  step: 0.01 },
];

export const calibrateWanted = (search) =>
  new URLSearchParams(search || '').get('nails') === 'tune';

export const tuningLine = (tune) =>
  KNOBS.map(({ key }) => `${key}: ${Number(tune[key]).toFixed(3)},`).join(' ');

const STORE = 'nail-tuning';

// קריאה וכתיבה עטופות: בחלון פרטי או כשאחסון חסום, גישה ל-localStorage
// זורקת — וכיול שנכשל אסור לו להפיל את המצלמה.
export function loadTuning(base, storage) {
  try {
    const saved = JSON.parse(storage?.getItem(STORE) ?? 'null');
    if (!saved) return { ...base };
    // רק מפתחות מוכרים, ורק מספרים סופיים. מה ששמור יכול להיות מגרסה ישנה.
    const clean = {};
    for (const { key } of KNOBS) {
      if (Number.isFinite(saved[key])) clean[key] = saved[key];
    }
    return { ...base, ...clean };
  } catch {
    return { ...base };
  }
}

function saveTuning(tune, storage) {
  try {
    const only = {};
    for (const { key } of KNOBS) only[key] = tune[key];
    storage?.setItem(STORE, JSON.stringify(only));
  } catch { /* אחסון חסום — הכיול פשוט לא ישרוד רענון */ }
}

function buildKnobs(tune, config, onChange, storage) {
  const rows = KNOBS.map(({ key, label, min, max, step }) => {
    const out = el('output', { class: 'tz-knob-value', text: String(tune[key]) });
    const input = el('input', {
      type: 'range', class: 'tz-knob-range', min, max, step, value: String(tune[key]),
    });
    input.addEventListener('input', () => {
      tune[key] = Number(input.value);
      out.textContent = input.value;
      saveTuning(tune, storage);
      onChange();
    });
    return el('label', { class: 'tz-knob' }, [el('span', { text: label }), input, out]);
  });

  const copy = el('button', { type: 'button', class: 'tz-tool tz-copy', text: config.copyLabel });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(tuningLine(tune));
      copy.textContent = config.copiedLabel;
      setTimeout(() => { copy.textContent = config.copyLabel; }, 1600);
    } catch {
      // בלי הרשאת לוח, בחירת הטקסט היא הגיבוי הסביר.
      copy.textContent = tuningLine(tune);
    }
  });

  const reset = el('button', { type: 'button', class: 'tz-tool', text: config.resetLabel });
  reset.addEventListener('click', () => {
    try { storage?.removeItem(STORE); } catch { /* חסום */ }
    window.location.reload();
  });

  return el('div', { class: 'tz-knobs' }, [...rows, el('div', { class: 'tz-knob-actions' }, [copy, reset])]);
}

// ----- אבחון -----

// ניחוש מרחוק על סמך צילום מסך הוא לא שיטה. עם ?nails=debug בכתובת
// מצוירות הנקודות שהמודל באמת מחזיר, מסגרת הציפורן שחושבה מהן, והמספרים
// עצמם — וצילום מסך אחד מחליף סבב ניחושים שלם.
export const debugWanted = (search) => new URLSearchParams(search || '').get('nails') === 'debug';

function paintDebug(ctx, marks, boxes) {
  ctx.save();
  ctx.lineWidth = 2;
  // כל 21 הנקודות, כדי לראות אם המודל בכלל תפס את היד נכון.
  ctx.fillStyle = '#00E5FF';
  marks.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  });
  // המפרק והקצה של כל אצבע — שתי הנקודות שמהן נגזרת כל ההצבה.
  ctx.fillStyle = '#FFEB3B';
  boxes.forEach(({ joint }) => joint.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }));
  // מסגרת הציפורן שחושבה. אם היא לא על הציפורן — כאן רואים בכמה היא מפספסת.
  ctx.strokeStyle = '#76FF03';
  boxes.forEach(({ corners }) => {
    ctx.beginPath();
    corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
    ctx.closePath();
    ctx.stroke();
  });
  ctx.restore();
}

// ארבע פינות גוף הציפורן בקואורדינטות הקנבס, מאותה מטריצה שמציירת אותה.
function nailCorners(m) {
  const at = (x, y) => ({
    x: m.at.x + m.ex.x * (x - NAIL_W / 2) + m.ey.x * (y - CUTICLE_Y),
    y: m.at.y + m.ex.y * (x - NAIL_W / 2) + m.ey.y * (y - CUTICLE_Y),
  });
  return [at(12, 8), at(88, 8), at(88, CUTICLE_Y), at(12, CUTICLE_Y)];
}

// ----- תיקון לפי מדידה -----

// הפריים המנובא, מתוקן לפי מה שנמדד בתמונה.
//
// **החשוב כאן הוא המשקל.** המדידה לא מחליפה את הניבוי אלא מושכת אליה
// לפי הביטחון שלה. ביטחון נמוך כמעט לא מזיז, ביטחון גבוה כמעט קובע —
// ופריים בודד שבו הזיהוי נכשל לא גורם לקפיצה.
export function correctFrame(frame, fit, strength) {
  const weight = Math.max(0, Math.min(1, fit.confidence * strength));
  if (weight <= 0) return frame;

  // כיוון האצבע כפי שהניבוי רואה אותו: מהעורף אל הקצה.
  const predLen = Math.hypot(frame.ey.x, frame.ey.y) * NAIL_LEN;
  const predWide = Math.hypot(frame.ex.x, frame.ex.y) * BODY_W;
  const dir = { x: -frame.ey.x, y: -frame.ey.y };
  const dirLen = Math.hypot(dir.x, dir.y) || 1;
  dir.x /= dirLen; dir.y /= dirLen;

  // המומנטים נותנים ציר, לא כיוון: הזווית מוגדרת מודולו 180°. הסימן
  // נבחר לפי הניבוי, אחרת הציפורן הייתה מתהפכת קצה-עורף באקראי.
  let mx = Math.cos(fit.angle);
  let my = Math.sin(fit.angle);
  if (mx * dir.x + my * dir.y < 0) { mx = -mx; my = -my; }

  const blend = (a, b) => a + (b - a) * weight;
  const nx = blend(dir.x, mx);
  const ny = blend(dir.y, my);
  const n = Math.hypot(nx, ny) || 1;
  const along = { x: nx / n, y: ny / n };
  const across = { x: -along.y, y: along.x };

  const major = blend(predLen, fit.major);
  const minor = blend(predWide, fit.minor);

  // מרכז הציפורן: אמצע הקטע בין העורף לקצה, בשתי המערכות.
  const predCx = frame.at.x + dir.x * (predLen / 2);
  const predCy = frame.at.y + dir.y * (predLen / 2);
  const cx = blend(predCx, fit.x);
  const cy = blend(predCy, fit.y);

  const sx = minor / BODY_W;
  const sy = major / NAIL_LEN;
  return {
    ...frame,
    sx,
    sy,
    at: { x: cx - along.x * (major / 2), y: cy - along.y * (major / 2) },
    ex: { x: across.x * sx, y: across.y * sx },
    ey: { x: -along.x * sy, y: -along.y * sy },
  };
}

// ----- צביעה -----

// נצנצים דטרמיניסטיים: אותה אצבע מקבלת אותן נקודות בכל פריים, אחרת הן
// מהבהבות. גנרטור זול עם זרע קבוע עושה את העבודה.
function sparkles(seed, count) {
  const out = [];
  let value = seed * 9301 + 49297;
  for (let i = 0; i < count; i += 1) {
    value = (value * 9301 + 49297) % 233280;
    const x = (value / 233280) * NAIL_W;
    value = (value * 9301 + 49297) % 233280;
    const y = (value / 233280) * NAIL_H;
    value = (value * 9301 + 49297) % 233280;
    out.push({ x, y, r: 0.8 + (value / 233280) * 1.6 });
  }
  return out;
}

// שכבות הגימור, מקבילות ל-finishLayers() ב-designer.js. גימור שאין לו כאן
// מקבילה נופל לצבע מלא — מוטב פחות מדויק מאשר ריק.
function paintFinish(ctx, finish, nail, shape, index) {
  const accent = nail.accent;
  ctx.fillStyle = accent;
  switch (finish?.id) {
    case 'french':
      ctx.fill(new Path2D(shape.smile ?? 'M-10,-16 L110,-16 L110,58 Q50,28 -10,58 Z'));
      break;
    case 'reverseFrench':
      ctx.fill(new Path2D('M-10,192 L110,192 L110,126 Q50,166 -10,126 Z'));
      break;
    case 'halfMoon':
      ctx.beginPath();
      ctx.ellipse(50, 158, 26, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'boomer':
    case 'ombre': {
      const gradient = ctx.createLinearGradient(0, 0, 0, NAIL_H);
      gradient.addColorStop(0, accent);
      gradient.addColorStop(1, nail.hex);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, NAIL_W, NAIL_H);
      break;
    }
    case 'glitter':
    case 'glitterTip': {
      const tipOnly = finish.id === 'glitterTip';
      ctx.fillStyle = '#FFFFFF';
      ctx.globalAlpha = tipOnly ? 0.85 : 0.6;
      sparkles(index + 1, tipOnly ? 18 : 42).forEach((dot) => {
        if (tipOnly && dot.y > 58) return;
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      break;
    }
    case 'chrome':
      ctx.fillStyle = '#FFFFFF';
      ctx.globalAlpha = 0.42;
      ctx.beginPath();
      ctx.ellipse(34, 80, 15, 92, -0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.26;
      ctx.beginPath();
      ctx.ellipse(72, 80, 7, 88, -0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    case 'stripes':
      [26, 62, 98, 134].forEach((y) => ctx.fillRect(0, y, NAIL_W, 7));
      break;
    case 'diagonal':
      ctx.globalAlpha = 0.9;
      ctx.fill(new Path2D('M0,0 L100,0 L100,54 L0,128 Z'));
      ctx.globalAlpha = 1;
      break;
    default:
      break;
  }
}

// הברק. מט מוותר עליו, וזה כל ההבדל בין השניים.
function paintShine(ctx) {
  ctx.fillStyle = '#FFFFFF';
  ctx.globalAlpha = 0.2;
  ctx.beginPath();
  ctx.ellipse(35, 62, 13, 44, -0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------

// deps.createLandmarker מוזרק בבדיקות בלבד, כדי שאפשר יהיה לאמת את מחזור
// החיים של המצלמה — ובעיקר שהיא באמת נכבית — בלי WASM ובלי רשת.
export function mountTryOn(root, config, getDesign, deps = {}) {
  const createLandmarker = deps.createLandmarker
    ?? ((onStage) => loadLandmarker(config.model, onStage));
  const video = el('video', { class: 'tz-video', playsinline: 'playsinline', muted: 'muted' });
  video.muted = true;
  const canvas = el('canvas', { class: 'tz-canvas' });
  const status = el('p', { class: 'tz-status', 'aria-live': 'polite', text: config.idle });
  const debug = deps.debug ?? debugWanted(window.location?.search);
  const calibrating = deps.calibrate ?? calibrateWanted(window.location?.search);
  // עותק ולא הפניה: config.tuning משותף, ולוח הכיול לא אמור לדלוף לשאר
  // האתר. בכיול נטען גם מה שנשמר במכשיר.
  const storage = deps.storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
  const tune = calibrating ? loadTuning(config.tuning, storage) : { ...config.tuning };
  const readout = el('p', { class: 'tz-debug', hidden: debug ? null : 'hidden' });
  // הכפתורים נושאים טקסט ולא רק סמל: "⟲" לבדו לא אומר לאף אחת מה יקרה.
  const freeze = el('button', {
    type: 'button', class: 'tz-tool tz-freeze', text: config.freezeLabel, 'aria-pressed': 'false',
  });
  const flip = el('button', { type: 'button', class: 'tz-tool tz-flip' });
  // שכבת הטעינה יושבת בתוך המסגרת, לא מתחתיה: שם העין כבר מחכה לתמונה.
  const bar = el('i', { class: 'tz-bar-fill' });
  const loadNote = el('p', { class: 'tz-load-note' });
  const loader = el('div', { class: 'tz-loading', 'aria-hidden': 'true' }, [
    el('div', { class: 'tz-bar' }, [bar]),
    loadNote,
    el('p', { class: 'tz-load-sub', text: config.loadingOnce }),
  ]);
  const tools = el('div', { class: 'tz-tools' }, [freeze, flip]);
  const frame = el('div', { class: 'tz-frame' }, [video, canvas, loader, tools]);

  const knobs = calibrating ? buildKnobs(tune, config, () => {
    readout.textContent = tuningLine(tune);
  }, storage) : null;
  root.append(frame, status, readout);
  if (knobs) {
    root.append(knobs);
    readout.hidden = false;
    readout.textContent = tuningLine(tune);
  }

  const ctx = canvas.getContext('2d');
  let landmarker = null;
  let stream = null;
  let raf = 0;
  let running = false;
  let frozen = false;
  let lastStamp = -1;
  let lastResult = null;
  let tracked = [];
  let trackedWorld = [];
  let frameCount = 0;
  // מדידה אחרונה לכל אצבע, מוחלקת. נשמרת גם בפריימים שבהם לא מודדים.
  const measured = new Map();
  // קנבס צדדי לקריאת פיקסלים מהווידאו. הקנבס הגלוי מכיל את מה שציירנו,
  // ולא את התמונה — ולכן צריך אחד משלו.
  const probe = document.createElement('canvas');
  const probeCtx = probe.getContext ? probe.getContext('2d', { willReadFrequently: true }) : null;
  // 'environment' = האחורית, מסתכלים על היד מלמעלה. 'user' = הקדמית, כמראה.
  let facing = config.facing;

  // הכפתור מודיע לאן הוא לוקח, לא איפה אנחנו. "למצלמה הקדמית" הוא הוראה
  // שאפשר לפעול לפיה; "מצלמה אחורית" הוא רק דיווח מצב.
  function labelFlip() {
    flip.textContent = facing === 'user' ? config.flipToBack : config.flipToFront;
    flip.title = config.flipLabel;
  }
  labelFlip();

  // אמת המידה: האמה (האצבע האמצעית) ואורך ברירת המחדל של הסרגל. שניהם
  // מגיעים מהמעצבת, כדי ששינוי שם לא ידרוש כוונון כאן.
  const reference = () => {
    const design = getDesign();
    return { nail: design.fingers[2].nail, length: design.lengthDefault };
  };

  // שלב בלי אחוזים מקבל פס נע; שלב עם אחוזים מקבל פס שמתמלא. ההפרדה
  // חשובה: פס שקופא על מספר נראה תקוע, ופס נע אומר "עובד, לא יודע כמה".
  function stage(name, part) {
    const known = Number.isFinite(part);
    loader.classList.toggle('is-indeterminate', !known);
    bar.style.width = known ? Math.round(part * 100) + '%' : '';
    const text = config.stages?.[name] ?? config.loading;
    loadNote.textContent = known && part > 0 ? text + ' ' + Math.round(part * 100) + '%' : text;
    status.textContent = text;
  }

  function showLoader(on) {
    frame.classList.toggle('is-loading', on);
    loader.setAttribute('aria-hidden', String(!on));
    if (on) stage('bundle', null);
  }

  function resize() {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return false;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return true;
  }

  // מכין את הקנבס הצדדי לפריים הנוכחי. מחזיר false כשאי אפשר למדוד.
  function grabFrame() {
    if (!probeCtx || !tune.measure) return false;
    if (probe.width !== canvas.width || probe.height !== canvas.height) {
      probe.width = canvas.width;
      probe.height = canvas.height;
    }
    try {
      probeCtx.drawImage(video, 0, 0, probe.width, probe.height);
      return true;
    } catch {
      return false;
    }
  }

  // צבע העור, מהמקטע שבין המפרק האמצעי לעליון. שם זו בוודאות אצבע.
  function sampleSkin(marks, finger) {
    const mid = MID_JOINT[finger.id];
    const top = JOINTS[finger.id]?.[0];
    if (mid == null || top == null || !marks[mid] || !marks[top]) return null;
    const samples = [];
    for (let i = 1; i <= 6; i += 1) {
      const t = i / 7;
      const x = Math.round(marks[mid].x + (marks[top].x - marks[mid].x) * t);
      const y = Math.round(marks[mid].y + (marks[top].y - marks[mid].y) * t);
      if (x < 1 || y < 1 || x >= probe.width - 1 || y >= probe.height - 1) continue;
      // 3×3 סביב הנקודה: פיקסל בודד יכול ליפול על שערה או על ברק.
      const patch = probeCtx.getImageData(x - 1, y - 1, 3, 3).data;
      for (let p = 0; p < 9; p += 1) {
        const at = p * 4;
        const sum = patch[at] + patch[at + 1] + patch[at + 2] || 1;
        samples.push([patch[at] / sum, patch[at + 1] / sum]);
      }
    }
    return skinModel(samples);
  }

  // מודד את הציפורן של אצבע אחת, ומחזיר מדידה בקואורדינטות הקנבס.
  function measure(marks, finger, frame) {
    const skin = sampleSkin(marks, finger);
    if (!skin) return null;

    const major = Math.hypot(frame.ey.x, frame.ey.y) * NAIL_LEN;
    const minor = Math.hypot(frame.ex.x, frame.ex.y) * BODY_W;
    const dirLen = Math.hypot(frame.ey.x, frame.ey.y) || 1;
    const cx = frame.at.x - (frame.ey.x / dirLen) * (major / 2);
    const cy = frame.at.y - (frame.ey.y / dirLen) * (major / 2);

    // אזור עניין נדיב: פי 1.9 מהניבוי, כדי שציפורן שהניבוי פספס עדיין
    // תיכנס לתוכו. צר מדי היה חותך בדיוק את מה שבאנו לתקן.
    const side = Math.round(Math.max(major, minor) * 1.9);
    if (side < 12 || side > 400) return null;
    const x0 = Math.round(cx - side / 2);
    const y0 = Math.round(cy - side / 2);
    if (x0 < 0 || y0 < 0 || x0 + side > probe.width || y0 + side > probe.height) return null;

    const roi = { data: probeCtx.getImageData(x0, y0, side, side).data, width: side, height: side };
    const fit = fitNail(roi, skin, {
      cx: cx - x0, cy: cy - y0, major, minor,
    });
    if (!fit) return null;
    return {
      x: fit.cx + x0,
      y: fit.cy + y0,
      angle: fit.angle,
      major: fit.major,
      minor: fit.minor,
      confidence: fit.confidence,
    };
  }

  function draw(result) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const hands = result?.landmarks;
    if (!hands?.length) return;
    const worlds = result?.worldLandmarks ?? [];

    frameCount += 1;
    const grabbed = grabFrame();
    const design = getDesign();
    const ref = reference();
    const shape = design.shapes.find((s) => s.id === design.shape) ?? design.shapes[0];
    const shapePath = new Path2D(shape.d);

    // המצלמה הקדמית מוצגת ממוראה, כדי שהזזת יד ימינה תזיז את ההשתקפות
    // ימינה. האחורית לא — שם רואים את היד כמו שהיא. הקנבס חייב להתהפך
    // יחד עם הווידאו, אחרת הציפורניים ינחתו על היד הלא נכונה.
    ctx.save();
    if (facing === 'user') ctx.setTransform(-1, 0, 0, 1, canvas.width, 0);

    const boxes = [];

    hands.forEach((points, handIndex) => {
      const scaled = points.map((p) => ({
        x: p.x * canvas.width, y: p.y * canvas.height, z: 0,
      }));
      tracked[handIndex] = smooth(tracked[handIndex], scaled, tune.smoothing);
      const marks = tracked[handIndex];

      // הנקודות המרחביות מוחלקות בנפרד: הן מזינות את הכיוון ואת הקיצור,
      // וקפיצה שם בולטת הרבה יותר מקפיצה במיקום.
      let world = null;
      if (worlds[handIndex]) {
        trackedWorld[handIndex] = smooth(trackedWorld[handIndex], worlds[handIndex], tune.smoothing);
        world = trackedWorld[handIndex];
      }

      const scale = world ? projectionScale(marks, world) : 0;
      // גיבוי לכשאין נתון מרחבי: רוחב כף היד כפי שהוא נראה בתמונה.
      const palmSize = Math.hypot(
        marks[PALM[0]].x - marks[PALM[1]].x,
        marks[PALM[0]].y - marks[PALM[1]].y,
      ) || 1;

      const canMeasure = grabbed;
      design.fingers.forEach((finger, index) => {
        const joint = JOINTS[finger.id];
        if (!joint) return;
        const nail = design.nails[finger.id];
        if (!nail) return;

        let metrics = nailFrame(
          marks[joint[0]], marks[joint[1]], finger, design, tune, ref,
          palmSize, spatialOf(world, joint, scale),
        );

        // המדידה רצה אחת לכמה פריימים: היא קוראת פיקסלים מהכרטיס הגרפי,
        // וזו הפעולה היקרה היחידה כאן. ציפורן לא זזה מהר, והתוצאה
        // האחרונה תקפה בינתיים.
        const key = handIndex + ':' + finger.id;
        if (canMeasure && frameCount % (tune.measureEvery ?? 2) === 0) {
          const fresh = measure(marks, finger, metrics);
          const last = measured.get(key);
          if (fresh) {
            // החלקה על המדידה עצמה, אחרת כל פריים מזיז את הציפורן מעט.
            measured.set(key, last ? {
              x: lerp(last.x, fresh.x, tune.smoothing),
              y: lerp(last.y, fresh.y, tune.smoothing),
              angle: lerp(last.angle, fresh.angle, tune.smoothing),
              major: lerp(last.major, fresh.major, tune.smoothing),
              minor: lerp(last.minor, fresh.minor, tune.smoothing),
              confidence: fresh.confidence,
            } : fresh);
          } else if (last) {
            // מדידה שנכשלה לא נמחקת מיד — הביטחון דועך, והציפורן חוזרת
            // אל הניבוי בהדרגה במקום לקפוץ.
            const faded = last.confidence * 0.6;
            if (faded < 0.05) measured.delete(key);
            else measured.set(key, { ...last, confidence: faded });
          }
        }
        const found = measured.get(key);
        if (found) metrics = correctFrame(metrics, found, tune.measureStrength ?? 0.85);
        const finish = design.finishes[nail.finish];

        if (debug) {
          boxes.push({ joint: [marks[joint[0]], marks[joint[1]]], corners: nailCorners(metrics) });
        }

        ctx.save();
        placeNail(ctx, metrics);
        // הכל נחתך לצורת הציפורן, כדי שגימור לא יגלוש על העור.
        ctx.clip(shapePath);
        ctx.globalAlpha = tune.opacity;
        ctx.fillStyle = nail.hex;
        ctx.fill(shapePath);
        ctx.globalAlpha = 1;
        paintFinish(ctx, finish, nail, shape, handIndex * 5 + index);
        if (!finish?.matte) paintShine(ctx);
        ctx.restore();
      });

      if (debug) {
        paintDebug(ctx, marks, boxes);
        const seg = Math.hypot(marks[11].x - marks[12].x, marks[11].y - marks[12].y);
        const box = boxes[2];
        const long = box ? Math.hypot(
          box.corners[0].x - box.corners[3].x, box.corners[0].y - box.corners[3].y,
        ) : 0;
        const wide = box ? Math.hypot(
          box.corners[0].x - box.corners[1].x, box.corners[0].y - box.corners[1].y,
        ) : 0;
        readout.textContent =
          `seg ${seg.toFixed(0)} · nail ${long.toFixed(0)}x${wide.toFixed(0)} `
          + `· ratio ${(long / (seg || 1)).toFixed(2)} · palm ${palmSize.toFixed(0)} `
          + `· 3d ${world ? 'yes' : 'NO'} · tilt ${(spatialOf(world, JOINTS.middle, scale)?.tilt ?? 1).toFixed(2)} `
          + `· span ${(spatialOf(world, JOINTS.middle, scale)?.palm ?? 0).toFixed(0)} `
          + `· fit ${measured.size}/${design.fingers.length} `
          + `${(measured.get('0:middle')?.confidence ?? 0).toFixed(2)} `
          + `· len ${design.length} · ${tuningLine(tune)}`;
      }
    });

    ctx.restore();
  }

  function loop() {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    // בהקפאה לא מזהים מחדש, אבל כן מציירים מחדש: שינוי צבע או צורה חייב
    // להופיע גם על תמונה עומדת, אחרת הכפתור נראה שבור.
    if (frozen) { draw(lastResult); return; }
    if (video.readyState < 2 || !resize()) return;
    const stamp = performance.now();
    // detectForVideo דורש חותמת עולה ממש, אחרת הוא זורק.
    if (stamp <= lastStamp) return;
    lastStamp = stamp;
    try {
      lastResult = landmarker.detectForVideo(video, stamp);
      draw(lastResult);
    } catch {
      // פריים בודד שנכשל אינו סיבה להפיל את הלולאה.
    }
  }

  // פתיחת המצלמה בשלבים.
  //
  // לפי התקן facingMode הוא בקשה ולא דרישה, ודפדפן שאין לו מצלמה אחורית
  // אמור פשוט לתת את מה שיש. בפועל יש דפדפנים שזורקים OverconstrainedError
  // במקום — ואז "פתחי מצלמה" נכשל לגמרי בגלל העדפה שהיא לא קריטית.
  //
  // לכן יורדים מדרגה בכל ניסיון: קודם העדשה המבוקשת ברזולוציה מלאה, אחר כך
  // העדשה בלי דרישת רזולוציה, ולבסוף כל מצלמה שיש. סירוב הרשאה עוצר מיד —
  // הוא לא ישתנה בניסיון אחר, ואין טעם להציק עוד פעמיים.
  async function openCamera() {
    const attempts = [
      { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
      { facingMode: { ideal: facing } },
      true,
    ];
    let last = null;
    for (const constraint of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia({ video: constraint, audio: false });
      } catch (error) {
        if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') throw error;
        last = error;
      }
    }
    throw last ?? new Error('no camera');
  }

  // הורדה של כמה מגה-בייט ברשת סלולרית איטית נראית בדיוק כמו תקיעה.
  // מגבלת זמן הופכת שתיקה אינסופית להודעה שאפשר לפעול לפיה.
  function withDeadline(promise, seconds) {
    let timer = 0;
    const alarm = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), seconds * 1000);
    });
    return Promise.race([promise, alarm]).finally(() => clearTimeout(timer));
  }

  async function start() {
    if (running) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      // getUserMedia חסום מחוץ להקשר מאובטח. localhost נחשב מאובטח, http:// לא.
      status.textContent = config.unsupported;
      return;
    }
    showLoader(true);
    try {
      landmarker = await withDeadline(createLandmarker(stage), config.modelSeconds ?? 40);
    } catch {
      showLoader(false);
      // כשל של המודל אינו כשל של המצלמה, ואסור לשלוח לבדוק הרשאות בגללו.
      status.textContent = config.modelFailed;
      return;
    }
    stage('camera', null);
    try {
      stream = await openCamera();
      // איזו עדשה נפתחה בפועל — לא איזו ביקשנו. כשיש רק מצלמה אחת הבקשה
      // לאחורית מקבלת את הקדמית, וההשתקפות חייבת ללכת לפי מה שקרה.
      const actual = stream.getVideoTracks?.()?.[0]?.getSettings?.().facingMode;
      if (actual === 'user' || actual === 'environment') {
        facing = actual;
        labelFlip();
      }
      video.srcObject = stream;
      // וידאו מושתק עם playsinline מותר להתנגן אוטומטית בכל דפדפן מודרני,
      // אבל דחייה כאן אינה סיבה להפיל את הכל — לפעמים התמונה עולה בכל זאת.
      // Promise.resolve עוטף גם מימושים ישנים של play() שלא מחזירים הבטחה.
      await Promise.resolve(video.play()).catch(() => {});
      running = true;
      frozen = false;
      lastStamp = -1;
      lastResult = null;
      tracked = [];
      trackedWorld = [];
      measured.clear();
      showLoader(false);
      frame.classList.add('is-live');
      frame.classList.remove('is-frozen');
      freeze.textContent = config.freezeLabel;
      freeze.setAttribute('aria-pressed', 'false');
      frame.classList.toggle('is-mirrored', facing === 'user');
      status.textContent = config.live;
      loop();
    } catch (error) {
      stop();
      showLoader(false);
      // דחיית הרשאה היא המקרה השכיח, ומגיעה לה הודעה משלה ולא "שגיאה".
      const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
      // שם השגיאה נוסף בכוונה: בלעדיו הדיווח היחיד הוא "לא נפתחת", ואי אפשר
      // לדעת אם זו המצלמה, ההרשאה או האילוץ. שתי מילים באנגלית מול חצי שעה ניחושים.
      status.textContent = denied
        ? config.denied
        : `${config.failed} (${error?.name ?? 'Error'})`;
    }
  }

  function stop() {
    running = false;
    frozen = false;
    cancelAnimationFrame(raf);
    // בלי עצירה מפורשת של המסלולים נורית המצלמה נשארת דולקת.
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
    frame.classList.remove('is-live', 'is-frozen');
    freeze.textContent = config.freezeLabel;
    freeze.setAttribute('aria-pressed', 'false');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    status.textContent = config.idle;
  }

  // הקפאה. יד חיה זזה, והזיהוי רועד קלות סביבה — על תמונה עומדת אפשר סוף
  // סוף להסתכל, להשוות גוונים, ולצלם בלי לתפוס את הרגע הנכון.
  function setFrozen(next) {
    if (!running || frozen === next) return;
    frozen = next;
    if (next) video.pause(); else Promise.resolve(video.play()).catch(() => {});
    frame.classList.toggle('is-frozen', next);
    freeze.textContent = next ? config.resumeLabel : config.freezeLabel;
    freeze.setAttribute('aria-pressed', String(next));
    status.textContent = next ? config.frozen : config.live;
    // בחזרה מהקפאה החותמת חייבת להתאפס: performance.now המשיך לרוץ, אבל
    // MediaPipe בודק רק שהחותמת עולה, והאיפוס מונע ויכוח על הפריים הראשון.
    if (!next) lastStamp = -1;
  }
  const toggleFreeze = () => setFrozen(!frozen);
  freeze.addEventListener('click', toggleFreeze);

  // צילום מסך של מה שרואים — הווידאו והציפורניים יחד, ממוראה כמו בתצוגה.
  function snapshot() {
    if (!running || !canvas.width) return null;
    const shot = document.createElement('canvas');
    shot.width = canvas.width;
    shot.height = canvas.height;
    const out = shot.getContext('2d');
    if (facing === 'user') out.setTransform(-1, 0, 0, 1, shot.width, 0);
    out.drawImage(video, 0, 0, shot.width, shot.height);
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.drawImage(canvas, 0, 0);
    return shot;
  }

  // החלפת מצלמה דורשת זרם חדש — אי אפשר להחליף עדשה על זרם קיים.
  async function flipCamera() {
    facing = facing === 'user' ? 'environment' : 'user';
    labelFlip();
    if (!running) return;
    stop();
    await start();
  }
  flip.addEventListener('click', flipCamera);

  return {
    start, stop, snapshot, flipCamera, toggleFreeze,
    isRunning: () => running,
    isFrozen: () => frozen,
  };
}
