// ---------------------------------------------------------------------------
// gallery.js — הגלריה. ארבעה מצבים, נבחרים לפי התוכן ב-data.js בלבד:
//
// 1. site.gallery.widget                   → ווידג'ט חיצוני שמתעדכן לבד
// 2. site.gallery.items עם { image, alt }  → רשת תמונות מקומיות + לייטבוקס
// 3. site.gallery.items עם { post: '...' } → הטמעת פוסטים מאינסטגרם
// 4. items ריק                             → ריבועי ממלא מקום
//
// ווידג'ט גובר על הכל. תמונות ופוסטים אפשר לערבב באותו מערך.
// ---------------------------------------------------------------------------

import { el } from './dom.js';

// הסקריפט הרשמי של אינסטגרם. הוא מה שכפתור "Embed" בפוסט נותן, ואינו דורש
// מפתח, טוקן או חשבון Business. נטען רק אם באמת יש פוסטים בגלריה.
const IG_SCRIPT = 'https://www.instagram.com/embed.js';

// טעינה חד-פעמית של סקריפט צד שלישי.
function loadScript(src) {
  if (!src || document.querySelector(`script[src="${src}"]`)) return;
  document.body.append(el('script', { src, async: 'async' }));
}

function loadInstagram() {
  // אם הסקריפט כבר רץ בדף, מספיק לבקש ממנו לעבד את מה שנוסף.
  if (window.instgrm?.Embeds) { window.instgrm.Embeds.process(); return; }
  loadScript(IG_SCRIPT);
}

// ווידג'ט חיצוני: iframe שהספק מגיש, והסקריפט שלו מתאים את הגובה.
// נבנה כאן ולא מודבק כ-HTML, כדי שלא יידרש innerHTML בשום מקום בפרויקט.
function widgetFrame(widget) {
  return el('iframe', {
    src: widget.src,
    class: 'lightwidget-widget',
    scrolling: 'no',
    allowtransparency: 'true',
    title: widget.title,
    style: { width: '100%', border: '0', overflow: 'hidden' },
  });
}

function instagramEmbed(url, label) {
  // הפורמט שאינסטגרם עצמה נותנת. הסקריפט מחליף את ה-blockquote ב-iframe;
  // אם הוא לא נטען, נשאר קישור עובד לפוסט.
  return el('blockquote', {
    class: 'instagram-media',
    'data-instgrm-permalink': url,
    'data-instgrm-version': '14',
  }, [el('a', { href: url, target: '_blank', rel: 'noopener', text: label || url })]);
}

// אינסטגרם קובעת את גובה ה-iframe לפי יחס המדיה: ריל אנכי יוצא גבוה בהרבה
// מפוסט מרובע, והרשת נראית קרועה. בתוך iframe חוצה-מקור אי אפשר לעצב, אז
// משווים מבחוץ — תא הריל מקבל את הגובה האופייני של פוסט תמונה, והעודף נחתך
// ב-overflow. הווידאו עצמו נשאר שלם; מה שנחתך הוא שובל הלייקים והתגובות.
function equalizeReels(root) {
  // ResizeObserver חסר בסביבות בדיקה ובדפדפנים ישנים. בלעדיו פשוט לא משווים,
  // וזו הידרדרות נאה: הרשת עדיין עובדת, רק לא מיושרת.
  if (typeof ResizeObserver === 'undefined') return;

  const heightOf = (cell) => cell.querySelector('iframe')?.offsetHeight || 0;
  // חציון ולא מינימום: תמונה רוחבית אחת לא תגזור את כל השאר.
  const median = (nums) => nums.sort((a, b) => a - b)[Math.floor(nums.length / 2)];

  let applied = 0;
  const apply = () => {
    const cells = [...root.querySelectorAll('.shot-embed')];
    const reels = cells.filter((cell) => cell.classList.contains('is-reel'));
    const photos = cells.filter((cell) => !cell.classList.contains('is-reel'));
    if (!reels.length || !photos.length) return;

    const sizes = photos.map(heightOf).filter(Boolean);
    // מדידה חלקית תיתן יעד שגוי, אז מחכים שכל פוסטי התמונה יקבלו גובה.
    if (sizes.length < photos.length) return;

    const target = median(sizes);
    if (!target || target === applied) return;
    applied = target;
    reels.forEach((cell) => { cell.style.height = `${target}px`; });
  };

  // שני שלבים דורשים מדידה מחדש: החלפת ה-blockquote ב-iframe, ואז הגובה
  // שאינסטגרם קובעת לו ב-postMessage. שינוי רוחב חלון הוא שלב שלישי.
  const ro = new ResizeObserver(apply);
  const watch = () => root.querySelectorAll('.shot-embed iframe').forEach((frame) => ro.observe(frame));
  new MutationObserver(() => { watch(); apply(); }).observe(root, { childList: true, subtree: true });
  watch();
}

// ----- לייטבוקס -----

// <dialog> נותן מלכודת פוקוס וסגירה ב-Esc בלי קוד, ולכן עדיף על div מומצא.
function buildLightbox(config, shots) {
  const image = el('img', { class: 'lb-img', alt: '' });
  const caption = el('p', { class: 'lb-cap' });
  const counter = el('span', { class: 'lb-count' });
  let index = 0;

  const show = (next) => {
    index = (next + shots.length) % shots.length;
    image.src = shots[index].image;
    image.alt = shots[index].alt;
    caption.textContent = shots[index].alt;
    counter.textContent = config.lightbox.counter
      .replace('{index}', String(index + 1)).replace('{total}', String(shots.length));
  };

  const prev = el('button', {
    type: 'button', class: 'lb-nav', 'aria-label': config.lightbox.prevLabel, text: '‹',
  });
  const next = el('button', {
    type: 'button', class: 'lb-nav', 'aria-label': config.lightbox.nextLabel, text: '›',
  });
  const close = el('button', {
    type: 'button', class: 'lb-close', 'aria-label': config.lightbox.closeLabel, text: '×',
  });

  prev.addEventListener('click', () => show(index - 1));
  next.addEventListener('click', () => show(index + 1));

  const dialog = el('dialog', { class: 'lb', 'aria-label': config.lightbox.label }, [
    el('div', { class: 'lb-bar' }, [counter, close]),
    el('div', { class: 'lb-stage' }, [next, image, prev]),
    caption,
  ]);

  close.addEventListener('click', () => dialog.close());
  // לחיצה על הרקע סוגרת. ה-::backdrop אינו אלמנט, אז בודקים את היעד.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('keydown', (event) => {
    // ב-RTL "הבא" נמצא משמאל, כמו בטאבים.
    const rtl = document.documentElement.dir === 'rtl';
    const step = { ArrowLeft: rtl ? 1 : -1, ArrowRight: rtl ? -1 : 1 }[event.key];
    if (!step) return;
    event.preventDefault();
    show(index + step);
  });

  document.body.append(dialog);
  return { open: (at) => { show(at); dialog.showModal(); } };
}

// ---------------------------------------------------------------------------

export function mountGallery(root, config) {
  // ווידג'ט חיצוני מחליף את הרשת כולה. ה-<ul> יורד, כי iframe אינו פריט רשימה.
  if (config.widget?.src) {
    root.replaceWith(el('div', { class: 'gal-widget' }, [widgetFrame(config.widget)]));
    loadScript(config.widget.script);
    return;
  }

  const items = config.items ?? [];

  // אין תוכן אמיתי: ריבועי ממלא מקום, עם אותה רשת.
  if (!items.length) {
    root.append(...(config.placeholders ?? []).map((tile) =>
      el('li', { class: 'tile', text: tile.title, style: { backgroundColor: tile.color } })));
    if (!config.placeholders?.length) root.remove();
    return;
  }

  const shots = items.filter((item) => item.image);
  const lightbox = shots.length ? buildLightbox(config, shots) : null;

  items.forEach((item) => {
    if (item.post) {
      // ריל מול פוסט תמונה: מה שמבדיל ביניהם הוא הנתיב בכתובת. מסומן כבר כאן, כדי ש-equalizeReels לא יצטרך לנחש מהמבנה שאינסטגרם מזריקה.
      const kind = item.post.includes('/reel/') ? 'shot-embed is-reel' : 'shot-embed';
      root.append(el('li', { class: kind }, [instagramEmbed(item.post, config.postLabel)]));
      return;
    }
    const position = shots.indexOf(item);
    const button = el('button', {
      type: 'button', class: 'shot',
      'aria-label': config.lightbox.openLabel.replace('{alt}', item.alt),
    }, [el('img', {
      src: item.image, alt: item.alt, loading: 'lazy', decoding: 'async',
    })]);
    button.addEventListener('click', () => lightbox.open(position));
    root.append(el('li', {}, [button]));
  });

  if (items.some((item) => item.post)) { loadInstagram(); equalizeReels(root); }
}
