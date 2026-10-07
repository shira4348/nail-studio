// ---------------------------------------------------------------------------
// wheel.js — גלגל ההטבות.
//
// שתי החלטות שחשוב להכיר לפני שנוגעים כאן:
//
// 1. כל המשבצות זוכות. אין משבצת "לא זכית". זה גם עדיף שיווקית, וגם מרחיק
//    את הפיצ'ר מהגדרה של הגרלה.
// 2. ההגבלה של סיבוב אחד לחודש נשמרת ב-localStorage, כלומר היא חיכוך ולא
//    אבטחה: ניקוי אחסון, גלישה בסתר או מכשיר אחר עוקפים אותה. האכיפה
//    האמיתית היא בצד שלנו — המימוש הוא מול הקוד, ידנית.
//
// אין כאן תוכן: הפרסים והטקסטים מגיעים מ-data.js.
// ---------------------------------------------------------------------------

import { el, svgEl, whatsappLink, prefersReducedMotion } from './dom.js';

const SIZE = 260;          // viewBox
const C = SIZE / 2;
const R = C - 6;
const SPIN_MS = 4200;      // חייב להתאים ל-transition ב-styles.css
const TURNS = 5;

// נקודה על המעגל, בזווית הנמדדת עם כיוון השעון מ-12.
function point(deg, r) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(rad), C + r * Math.sin(rad)];
}

function segmentPath(from, to) {
  const [x1, y1] = point(from, R);
  const [x2, y2] = point(to, R);
  const large = to - from > 180 ? 1 : 0;
  return `M${C},${C} L${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} Z`;
}

// קוד מימוש: חודש, שנה, מזהה הפרס וספרת ביקורת. לא הצפנה — מספיק כדי
// שקוד מומצא או קוד מחודש קודם ייראו מיד.
function prizeCode(prize, now = new Date()) {
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(2);
  const sum = [...(mm + yy + prize.id)].reduce((total, ch) => total + ch.charCodeAt(0), 0);
  return `SH-${mm}${yy}-${prize.id}${(sum % 36).toString(36).toUpperCase()}`;
}

// ----- אחסון. עלול לזרוק בגלישה בסתר או כשאחסון חסום. -----

function readSaved(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSaved(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // אין אחסון — הסיבוב פשוט לא ייזכר. לא שוברים את הפיצ'ר בשביל זה.
  }
}

// ---------------------------------------------------------------------------

export function mountWheel(root, config, whatsappBase) {
  const prizes = config.prizes;
  const seg = 360 / prizes.length;

  const wheel = svgEl('svg', {
    class: 'wh-wheel', viewBox: `0 0 ${SIZE} ${SIZE}`, 'aria-hidden': 'true',
  }, [
    ...prizes.map((prize, i) =>
      svgEl('path', { d: segmentPath(i * seg, (i + 1) * seg), fill: prize.color })),
    svgEl('circle', { cx: C, cy: C, r: 20, fill: '#FFFFFF' }),
    svgEl('circle', { cx: C, cy: C, r: 20, fill: 'none', stroke: '#E6D8CF', 'stroke-width': '2' }),
  ]);

  const spin = el('button', { type: 'button', class: 'cta wh-spin', text: config.spinLabel });
  // התוצאה היא הטקסט שנושא את המשמעות — הגלריה הוויזואלית מוסתרת מקוראי מסך.
  const result = el('p', { class: 'wh-result', 'aria-live': 'polite' });
  const claim = el('a', {
    class: 'dz-action dz-action-primary wh-claim', text: config.claimLabel,
    target: '_blank', rel: 'noopener', hidden: 'hidden',
  });

  const legend = el('ul', { class: 'wh-legend' }, prizes.map((prize) =>
    el('li', {}, [
      el('span', { class: 'wh-dot', 'aria-hidden': 'true', style: { background: prize.color } }),
      el('span', { text: prize.label }),
    ])));

  let rotation = 0;
  let busy = false;

  function showResult(prize, code, prefix) {
    result.textContent = (prefix ? prefix + ' ' : '') +
      config.resultTemplate.replace('{prize}', prize.label).replace('{code}', code);
    claim.href = whatsappLink(whatsappBase,
      config.claimTemplate.replace('{prize}', prize.label).replace('{code}', code));
    claim.hidden = false;
  }

  // סיבוב קודם בתוך תקופת הצינון — מציגים אותו ונועלים את הכפתור.
  const saved = readSaved(config.storageKey);
  const cooldownMs = config.cooldownDays * 24 * 60 * 60 * 1000;
  if (saved && Date.now() - saved.ts < cooldownMs) {
    const prize = prizes.find((p) => p.id === saved.prizeId);
    if (prize) {
      showResult(prize, saved.code, config.againMessage);
      spin.disabled = true;
      // הגלגל מוצג כבר על המשבצת שיצאה, כדי שהמצב יהיה עקבי.
      rotation = -(prizes.indexOf(prize) * seg + seg / 2);
      wheel.style.transform = `rotate(${rotation}deg)`;
    }
  }

  spin.addEventListener('click', () => {
    if (busy || spin.disabled) return;
    busy = true;
    spin.disabled = true;
    result.textContent = '';
    claim.hidden = true;

    const index = Math.floor(Math.random() * prizes.length);
    const prize = prizes[index];
    const code = prizeCode(prize);

    // מרכז המשבצת הנבחרת צריך לנחות על החץ שבחלק העליון.
    rotation += TURNS * 360 + (360 - ((rotation % 360) + 360) % 360) - (index * seg + seg / 2);
    wheel.style.transform = `rotate(${rotation}deg)`;

    const finish = () => {
      showResult(prize, code, '');
      writeSaved(config.storageKey, { ts: Date.now(), prizeId: prize.id, code });
      busy = false;
    };

    // ב-prefers-reduced-motion ה-transition מבוטל גלובלית, אז אין מה לחכות לו.
    if (prefersReducedMotion()) finish();
    else setTimeout(finish, SPIN_MS);
  });

  root.append(
    el('div', { class: 'wh-stage' }, [
      el('span', { class: 'wh-pointer', 'aria-hidden': 'true' }),
      wheel,
    ]),
    spin,
    result,
    claim,
    el('p', { class: 'wh-note', text: config.note }),
    legend,
  );
}
