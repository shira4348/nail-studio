// ---------------------------------------------------------------------------
// dom.js — עזרי DOM משותפים ל-main.js ולפיצ'רים. אין כאן תוכן ואין לוגיקה
// של הדף, רק בנייה של אלמנטים.
// ---------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';

export const slot = (name) => document.querySelector(`[data-bind="${name}"]`);

function assign(node, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'text') node.textContent = value;
    else if (key === 'style') Object.assign(node.style, value);
    else node.setAttribute(key, value);
  }
}

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  assign(node, props);
  for (const child of children) if (child) node.append(child);
  return node;
}

// זהה ל-el, אבל ב-namespace של SVG. createElement רגיל מייצר אלמנט HTML
// שנראה כמו SVG ולא מרונדר.
export function svgEl(tag, props = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  assign(node, props);
  for (const child of children) if (child) node.append(child);
  return node;
}

// קישור וואטסאפ עם הודעה מוכנה מראש.
export function whatsappLink(base, text) {
  return `${base}?text=${encodeURIComponent(text)}`;
}

// אופציונלי בכוונה: הפונקציה נקראת בתוך מטפלי אירועים, וחריגה כאן
// היתה מפילה את כל מה שאחריה — למשל את הגלילה במעבר טאב.
// בלי ה-API ההנחה היא שמותר להנפיש, כמו ברירת המחדל של הדפדפן.
export const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
