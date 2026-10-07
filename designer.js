// ---------------------------------------------------------------------------
// designer.js — "עצבי את הציפורניים שלך".
// אין כאן תוכן: הצורות, הגימורים, הקישוטים והגיאומטריה של היד מגיעים מ-data.js.
//
// שתי הפרדות שמחזיקות את כל הקובץ:
//
// 1. גימור מול קישוט. גימור (פרנץ', אומברה, מט) חל על הציפורן כולה מטבעו.
//    קישוט (לב, כוכב, אבן) הוא פריט שמציבים — לו יש מיקום, גודל, סיבוב וצבע.
// 2. היקף. ברירת המחדל היא "כל הציפורניים"; לחיצה על ציפורן מצמצמת אליה.
//
// צורה, אורך, צבע, גימור וקישוטים מקודדים ב-query string וניתנים לשיתוף.
// ציור ידני לא — הוא ארוך מדי לכתובת, ונשלח כתמונה.
// ---------------------------------------------------------------------------

import { el, svgEl, whatsappLink } from './dom.js';
import { mountTryOn } from './tryon.js';
import { shadeHex, hueOf, depthOf } from './shade.js';

// תיבת הציפורן. כל ה-path-ים של הצורות ב-data.js מצוירים כאן:
// הקצה למעלה (y קטן), העורף ב-y=170.
const NAIL_W = 100;
const NAIL_H = 176;
const CUTICLE_Y = 170;
const OUTLINE = 'rgba(59,43,38,.18)';
const DEFAULT_SMILE = 'M-10,-16 L110,-16 L110,58 Q50,28 -10,58 Z';

const HEX = /^[0-9A-Fa-f]{6}$/;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// ----- קידוד מצב ל-URL -----

const encodeNails = (state, fingers) => fingers.map((f) => {
  const nail = state.nails[f.id];
  return `${nail.hex.slice(1)}.${nail.finish.toString(36)}.${nail.accent.slice(1)}`;
}).join(',');

function decodeNails(text, fingers, finishCount) {
  if (typeof text !== 'string') return null;
  const parts = text.split(',');
  if (parts.length !== fingers.length) return null;
  const nails = {};
  for (let i = 0; i < parts.length; i++) {
    const [hex, finish, accent] = parts[i].split('.');
    const index = parseInt(finish, 36);
    if (!HEX.test(hex ?? '') || !HEX.test(accent ?? '')) return null;
    if (!Number.isInteger(index) || index < 0 || index >= finishCount) return null;
    nails[fingers[i].id] = {
      hex: `#${hex}`, finish: index, accent: `#${accent}`, stickers: [], strokes: [],
    };
  }
  return nails;
}

// קישוטים: "type-x-y-scale100-rot-hex", מופרדים ב-!, וכל אצבע מופרדת ב-|.
const encodeStickers = (state, fingers) => fingers.map((f) =>
  state.nails[f.id].stickers.map((s) =>
    [s.type, Math.round(s.x), Math.round(s.y), Math.round(s.scale * 100),
      Math.round(s.rot), s.color.slice(1)].join('-')).join('!')).join('|');

function decodeStickers(text, fingers, typeCount, limits) {
  if (typeof text !== 'string') return null;
  const groups = text.split('|');
  if (groups.length !== fingers.length) return null;
  const out = {};
  for (let i = 0; i < groups.length; i++) {
    const list = [];
    if (groups[i]) {
      for (const entry of groups[i].split('!')) {
        const [type, x, y, scale, rot, hex] = entry.split('-');
        const typeIndex = Number(type);
        if (!Number.isInteger(typeIndex) || typeIndex < 0 || typeIndex >= typeCount) return null;
        if (!HEX.test(hex ?? '')) return null;
        const values = [x, y, scale, rot].map(Number);
        if (values.some((v) => !Number.isFinite(v))) return null;
        list.push({
          type: typeIndex,
          x: clamp(values[0], 0, NAIL_W),
          y: clamp(values[1], 0, NAIL_H),
          scale: clamp(values[2] / 100, limits.min, limits.max),
          rot: ((values[3] % 360) + 360) % 360,
          color: `#${hex}`,
        });
      }
    }
    out[fingers[i].id] = list;
  }
  return out;
}

// ----- גיאומטריה -----

function geometry(finger) {
  const [bx, by] = finger.base;
  const [tx, ty] = finger.tip;
  const dx = tx - bx;
  const dy = ty - by;
  const len = Math.hypot(dx, dy) || 1;
  return {
    bx, by, tx, ty, len,
    ux: dx / len, uy: dy / len,
    angle: (Math.atan2(dx, -dy) * 180) / Math.PI,
  };
}

// הציפורן מעוגנת בעורף, לא בקצה האצבע — כך שהארכה מותחת אותה קדימה במקום
// להזיז אותה אחורה.
function nailTransform(finger, lengthPercent) {
  const g = geometry(finger);
  const sx = finger.nail / NAIL_W;
  const sy = sx * (lengthPercent / 100);
  const inset = finger.nail * 1.1;
  const edgeX = g.tx + g.ux * (finger.width / 2);
  const edgeY = g.ty + g.uy * (finger.width / 2);
  const cx = edgeX - g.ux * inset;
  const cy = edgeY - g.uy * inset;
  return `translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${g.angle.toFixed(2)}) ` +
         `scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(-50 ${-CUTICLE_Y})`;
}

function handSkin(hand, fingers) {
  const skin = [];
  const line = (finger, props) => {
    const g = geometry(finger);
    return svgEl('line', {
      x1: g.bx, y1: g.by, x2: g.tx, y2: g.ty, 'stroke-linecap': 'round', ...props,
    });
  };

  skin.push(svgEl('path', { d: hand.palm, fill: hand.skin }));
  fingers.forEach((f) => skin.push(line(f, { stroke: hand.skin, 'stroke-width': f.width })));

  fingers.forEach((f) => {
    const g = geometry(f);
    const offset = f.width * 0.17;
    skin.push(svgEl('line', {
      x1: g.bx - offset, y1: g.by,
      x2: g.tx - offset, y2: g.ty + f.width * 0.45,
      stroke: hand.highlight, 'stroke-width': f.width * 0.32,
      'stroke-linecap': 'round', opacity: '.55',
    }));
  });

  skin.push(svgEl('ellipse', {
    cx: hand.palmHighlight[0], cy: hand.palmHighlight[1],
    rx: hand.palmHighlight[2], ry: hand.palmHighlight[3],
    fill: hand.highlight, opacity: '.45',
  }));

  fingers.forEach((f) => {
    (f.creases ?? []).forEach((where) => {
      const g = geometry(f);
      const px = g.bx + g.ux * g.len * where;
      const py = g.by + g.uy * g.len * where;
      const half = f.width * 0.26;
      skin.push(svgEl('line', {
        x1: px + g.uy * half, y1: py - g.ux * half,
        x2: px - g.uy * half, y2: py + g.ux * half,
        stroke: hand.crease, 'stroke-width': 2.4, 'stroke-linecap': 'round', opacity: '.5',
      }));
    });
  });

  return svgEl('g', { class: 'dz-skin', 'aria-hidden': 'true' }, skin);
}

// ----- גימור: שכבה על כל הציפורן -----

function finishLayers(finish, nail, gradientId, shape) {
  const full = { x: 0, y: 0, width: NAIL_W, height: NAIL_H };
  const a = nail.accent;
  switch (finish.id) {
    case 'french':
      // קו החיוך דק במרכז ועבה בפינות, כי מיטת הציפורן מגיעה הכי רחוק במרכז.
      // הצורה מביאה את הקו שלה, אחרת צורה מחודדת מקבלת משולש.
      return [svgEl('path', { d: shape.smile ?? DEFAULT_SMILE, fill: a })];
    case 'reverseFrench':
      return [svgEl('path', { d: 'M-10,192 L110,192 L110,126 Q50,166 -10,126 Z', fill: a })];
    case 'halfMoon':
      return [svgEl('ellipse', { cx: 50, cy: 158, rx: 26, ry: 18, fill: a })];
    case 'boomer':
    case 'ombre':
      return [svgEl('rect', { ...full, fill: `url(#${gradientId})` })];
    case 'glitter':
      return [svgEl('rect', { ...full, fill: 'url(#dz-glitter)', opacity: '.65' })];
    case 'glitterTip':
      return [svgEl('rect', { x: 0, y: 0, width: NAIL_W, height: 58, fill: 'url(#dz-glitter)', opacity: '.85' })];
    case 'chrome':
      return [
        svgEl('ellipse', { cx: 34, cy: 80, rx: 15, ry: 92, fill: '#FFFFFF', opacity: '.42', transform: 'rotate(-8 34 80)' }),
        svgEl('ellipse', { cx: 72, cy: 80, rx: 7, ry: 88, fill: '#FFFFFF', opacity: '.26', transform: 'rotate(-8 72 80)' }),
      ];
    case 'stripes':
      return [26, 62, 98, 134].map((y) =>
        svgEl('rect', { x: 0, y, width: NAIL_W, height: 7, fill: a }));
    case 'diagonal':
      return [svgEl('path', { d: 'M0,0 L100,0 L100,54 L0,128 Z', fill: a, opacity: '.9' })];
    case 'leopard':
      return [[32, 46, 9], [66, 66, 7], [40, 96, 8], [70, 122, 6], [30, 140, 5]]
        .flatMap(([cx, cy, r]) => [
          svgEl('ellipse', { cx, cy, rx: r, ry: r * 0.8, fill: a, opacity: '.28' }),
          svgEl('ellipse', { cx: cx - 1, cy: cy - 1, rx: r * 0.55, ry: r * 0.45, fill: a }),
        ]);
    case 'marble':
      return [
        svgEl('path', { d: 'M-5,40 C25,30 35,70 70,58 C90,52 100,66 110,60', fill: 'none', stroke: a, 'stroke-width': 3, 'stroke-linecap': 'round', opacity: '.8' }),
        svgEl('path', { d: 'M-5,96 C20,86 40,120 66,104 C86,92 100,106 110,100', fill: 'none', stroke: a, 'stroke-width': 2, 'stroke-linecap': 'round', opacity: '.6' }),
        svgEl('path', { d: 'M10,140 C34,132 50,152 78,142', fill: 'none', stroke: a, 'stroke-width': 1.6, 'stroke-linecap': 'round', opacity: '.5' }),
      ];
    case 'matte':
      // בכוונה בלי שכבה — מט מסתיר את הברק, וזה נעשה ב-paintNail().
      return [];
    default:
      return [];
  }
}

// ----- קישוט: פריט שמציבים -----

// כל קישוט מצויר סביב (0,0) בתיבה של 24×24, כדי שגודל וסיבוב יפעלו סביב המרכז.
function stickerNode(sticker, color) {
  return svgEl('g', {}, sticker.parts.map((part) => {
    const fill = part.fill ?? color;
    const rot = part.rot ? { transform: `rotate(${part.rot})` } : {};
    if (part.d) return svgEl('path', { d: part.d, fill, ...rot });
    if (part.c) return svgEl('circle', { cx: part.c[0], cy: part.c[1], r: part.c[2], fill, ...rot });
    return svgEl('ellipse', {
      cx: part.e[0], cy: part.e[1], rx: part.e[2], ry: part.e[3], fill, ...rot,
    });
  }));
}

const placedTransform = (placed) =>
  `translate(${placed.x.toFixed(1)} ${placed.y.toFixed(1)}) ` +
  `rotate(${placed.rot.toFixed(0)}) scale(${placed.scale.toFixed(2)})`;

function glitterPattern() {
  return svgEl('pattern', {
    id: 'dz-glitter', width: '13', height: '13', patternUnits: 'userSpaceOnUse',
  }, [
    svgEl('circle', { cx: 3, cy: 3, r: 1.7, fill: '#FFFFFF', opacity: '.85' }),
    svgEl('circle', { cx: 9, cy: 8, r: 1.1, fill: '#FFFFFF', opacity: '.65' }),
    svgEl('circle', { cx: 5, cy: 11, r: 0.9, fill: '#FFFFFF', opacity: '.5' }),
  ]);
}

function strokePath(stroke) {
  const [first, ...rest] = stroke.points;
  const d = `M${first.x.toFixed(1)},${first.y.toFixed(1)}` +
    rest.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');
  return svgEl('path', {
    d, fill: 'none', stroke: stroke.color, 'stroke-width': stroke.width,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  });
}

const cloneStrokes = (strokes) =>
  strokes.map((s) => ({ color: s.color, width: s.width, points: s.points.map((p) => ({ ...p })) }));
const cloneStickers = (list) => list.map((s) => ({ ...s }));

// ---------------------------------------------------------------------------

export function mountDesigner(root, config, whatsappBase) {
  const { fingers, finishes, shapes, stickers } = config;
  const fingerById = Object.fromEntries(fingers.map((f) => [f.id, f]));
  const quick = config.quickColors;
  const firstHex = quick[0].hex;

  const shapeOf = (id) => shapes.find((s) => s.id === id) ?? shapes[0];
  const lengthName = (value) =>
    (config.length.names.find((n) => value <= n.upTo) ?? config.length.names.at(-1)).label;
  const colorName = (hex) =>
    quick.find((c) => c.hex.toLowerCase() === hex.toLowerCase())?.name ?? hex.toUpperCase();

  // ----- מצב -----

  const params = new URLSearchParams(location.search);
  const urlNails = decodeNails(params.get('n'), fingers, finishes.length);
  const urlStickers = decodeStickers(params.get('k'), fingers, stickers.length, config.sticker);
  const urlShape = params.get('shape');
  const urlLength = Number(params.get('len'));

  const blankNail = () => ({
    hex: firstHex, finish: 0, accent: '#FFFFFF', stickers: [], strokes: [],
  });

  const state = {
    // shapeDefault מ-data.js, ולא shapes[0] — סדר הכפתורים הוא מרובע עד
    // סטילטו, ואין סיבה שהראשון ברשימה יהיה גם הרושם הראשון.
    shape: shapes.some((s) => s.id === urlShape) ? urlShape
      : (shapes.some((s) => s.id === config.shapeDefault) ? config.shapeDefault : shapes[0].id),
    length: Number.isFinite(urlLength) && urlLength >= config.length.min && urlLength <= config.length.max
      ? urlLength : config.length.value,
    selected: null,   // ציפורן נבחרת, או null לכל הציפורניים
    picked: null,     // אינדקס הקישוט הנבחר בלוח
    nails: urlNails ?? Object.fromEntries(fingers.map((f) => [f.id, blankNail()])),
  };
  if (urlNails && urlStickers) {
    fingers.forEach((f) => { state.nails[f.id].stickers = urlStickers[f.id]; });
  }

  // צילום המצב שהמדידה על היד האמיתית קוראת. אין כאן העתקה של הנתונים —
  // tryon.js קורא את אותו state, כדי שלא ייווצרו שני מקורות אמת שמסתעפים.
  const design = () => ({
    shape: state.shape,
    length: state.length,
    lengthDefault: config.length.value,
    nails: state.nails,
    fingers,
    finishes,
    shapes,
  });

  const targets = () => (state.selected ? [state.selected] : fingers.map((f) => f.id));
  const leadId = () => state.selected ?? fingers[0].id;
  const leadNail = () => state.nails[leadId()];
  const hasDrawing = () => fingers.some((f) => state.nails[f.id].strokes.length);

  // ----- היד -----

  const status = el('p', { class: 'dz-status', 'aria-live': 'polite' });
  const scope = el('button', { type: 'button', class: 'dz-scope' });
  const defs = svgEl('defs', {}, [glitterPattern()]);
  const svg = svgEl('svg', {
    class: 'dz-hand', viewBox: config.hand.viewBox,
    role: 'group', 'aria-label': config.handLabel,
  }, [defs, handSkin(config.hand, fingers)]);

  const parts = {};

  const describe = (finger) => {
    const nail = state.nails[finger.id];
    const extras = [];
    if (nail.stickers.length) extras.push(`${nail.stickers.length} קישוטים`);
    if (nail.strokes.length) extras.push('ציור ידני');
    return `${finger.label}: ${colorName(nail.hex)}, ${finishes[nail.finish].label}` +
      (extras.length ? ` + ${extras.join(' + ')}` : '');
  };

  function paintNail(finger) {
    const part = parts[finger.id];
    const nail = state.nails[finger.id];
    const finish = finishes[nail.finish];
    const shape = shapeOf(state.shape);

    part.group.setAttribute('transform', nailTransform(finger, state.length));
    part.base.setAttribute('d', shape.d);
    part.clipPath.setAttribute('d', shape.d);
    part.outline.setAttribute('d', shape.d);
    part.base.setAttribute('fill', nail.hex);

    // בייבי בומר דוהה ללבן; אומברה דוהה לצבע השני.
    const fade = finish.id === 'ombre' ? nail.accent : '#FFFFFF';
    part.gradientStop.setAttribute('stop-color', fade);
    part.gradientFade.setAttribute('stop-color', fade);

    part.finish.replaceChildren(...finishLayers(finish, nail, part.gradientId, shape));
    part.stickers.replaceChildren(...nail.stickers.map((placed) =>
      svgEl('g', { transform: placedTransform(placed) },
        [stickerNode(stickers[placed.type], placed.color)])));
    part.draw.replaceChildren(...nail.strokes.map(strokePath));
    part.shine.style.display = finish.matte ? 'none' : '';
    part.group.setAttribute('aria-label', describe(finger));
  }

  const paintAll = () => fingers.forEach(paintNail);
  const paintTargets = () => targets().forEach((id) => paintNail(fingerById[id]));

  fingers.forEach((finger) => {
    const clipId = `dz-clip-${finger.id}`;
    const gradientId = `dz-grad-${finger.id}`;
    const gradientStop = svgEl('stop', { offset: '0', 'stop-color': '#FFFFFF', 'stop-opacity': '.95' });
    const gradientFade = svgEl('stop', { offset: '.72', 'stop-color': '#FFFFFF', 'stop-opacity': '0' });
    defs.append(svgEl('linearGradient', { id: gradientId, x1: '0', y1: '0', x2: '0', y2: '1' },
      [gradientStop, gradientFade]));

    const clipPath = svgEl('path', {});
    const base = svgEl('path', { class: 'dz-nail' });
    // תכונות ולא CSS, כדי שייצוא ה-PNG יהיה עצמאי.
    const outline = svgEl('path', { class: 'dz-outline', fill: 'none', stroke: OUTLINE, 'stroke-width': 2 });
    const finishGroup = svgEl('g', { 'clip-path': `url(#${clipId})` });
    const stickerGroup = svgEl('g', { 'clip-path': `url(#${clipId})` });
    const draw = svgEl('g', { 'clip-path': `url(#${clipId})` });
    const shine = svgEl('g', { 'clip-path': `url(#${clipId})` }, [
      svgEl('ellipse', {
        cx: 33, cy: 52, rx: 11, ry: 30, fill: '#FFFFFF', opacity: '.18',
        transform: 'rotate(-12 33 52)',
      }),
    ]);

    const group = svgEl('g', {
      class: 'dz-finger', role: 'button', tabindex: '0', 'aria-pressed': 'false',
    }, [
      svgEl('clipPath', { id: clipId }, [clipPath]),
      base, finishGroup, stickerGroup, draw, shine, outline,
    ]);

    const toggle = () => {
      state.selected = state.selected === finger.id ? null : finger.id;
      state.picked = null;
      syncScope();
      status.textContent = state.selected ? describe(finger) : config.editingAll;
    };
    group.addEventListener('click', toggle);
    // SVG אינו כפתור, אז ההפעלה במקלדת נכתבת ידנית.
    group.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggle();
    });

    parts[finger.id] = {
      base, clipPath, outline, finish: finishGroup, stickers: stickerGroup, draw, shine,
      group, gradientId, gradientStop, gradientFade,
    };
    svg.append(group);
  });

  // ----- בקרות בסיס -----

  const field = (labelText, control) => el('div', { class: 'dz-field' }, [
    el('span', { class: 'dz-label', text: labelText }), control,
  ]);

  const shapeButtons = shapes.map((shape) => {
    const button = el('button', {
      type: 'button', class: 'dz-shape', 'aria-label': shape.label, title: shape.label,
    });
    button.append(svgEl('svg', { viewBox: `0 0 ${NAIL_W} ${NAIL_H}`, 'aria-hidden': 'true' },
      [svgEl('path', { d: shape.d, fill: 'currentColor' })]));
    button.addEventListener('click', () => {
      state.shape = shape.id;
      paintAll();
      renderPad();
      syncShapes();
      status.textContent = shape.label;
    });
    return { button, id: shape.id };
  });
  const syncShapes = () => shapeButtons.forEach(({ button, id }) =>
    button.setAttribute('aria-pressed', String(id === state.shape)));

  const lengthOut = el('output', { class: 'dz-out' });
  const lengthInput = el('input', {
    type: 'range', class: 'dz-range',
    min: config.length.min, max: config.length.max, step: config.length.step,
    value: state.length, 'aria-label': config.lengthLabel,
  });
  const syncLength = () => { lengthOut.textContent = lengthName(state.length); };
  lengthInput.addEventListener('input', () => {
    state.length = Number(lengthInput.value);
    paintAll();
    syncLength();
  });

  const picker = el('input', {
    type: 'color', class: 'dz-picker', value: firstHex, 'aria-label': config.pickerLabel,
  });
  // הדיאלוג של המערכת נפתח על ערך הקלט ברגע הלחיצה. הסנכרון קורה כאן ולא
  // רק בהחלפת בחירה, כי בין לחיצה על גוון מהלוח לבין פתיחת הבוחר יכולים
  // לקרות דברים — ובלי זה הוא נפתח על מה שהיה, ובמובייל זה נראה כמו שחור.
  ['pointerdown', 'focus'].forEach((event) =>
    picker.addEventListener(event, () => { picker.value = leadNail().hex; }));
  picker.addEventListener('input', () => {
    targets().forEach((id) => { state.nails[id].hex = picker.value; });
    paintTargets();
    renderPad();
    syncQuick();
  });

  const quickButtons = quick.map((color) => {
    const button = el('button', {
      type: 'button', class: 'sw', 'aria-label': color.name, title: color.name,
      style: { background: color.hex },
    });
    button.addEventListener('click', () => {
      targets().forEach((id) => { state.nails[id].hex = color.hex; });
      picker.value = color.hex;
      paintTargets();
      renderPad();
      syncQuick();
      status.textContent = color.name;
    });
    return { button, hex: color.hex };
  });
  const syncQuick = () => {
    const current = leadNail().hex.toLowerCase();
    syncMixer(current);
    quickButtons.forEach(({ button, hex }) =>
      button.setAttribute('aria-pressed', String(hex.toLowerCase() === current)));
  };

  // ---------------------------------------------------------------------
  // שדה הצבע.
  //
  // מלבן אחד: אופקית — גוון, אנכית — עומק. כל נקודה בו נצבעת ב-shadeHex
  // ממש, ולא בקירוב של גרדיאנט CSS, ולכן הצבע שמתחת לאצבע הוא בדיוק
  // הצבע שמתקבל. בלי זה הנקודה והרקע מסתעפים והשדה משקר.
  //
  // הציור סטטי: שני הצירים הם כל המצב, אז הקנבס נצבע פעם אחת בלבד.
  //
  // אזור מגע משלנו ולא שני input type=range — זה מה שהיא ביקשה. המחיר
  // הוא שהנגישות לא מגיעה בחינם, ולכן יש כאן גם ניווט מקשי חצים
  // ותווית שמתעדכנת, וגם קלט hex מדויק לצדו.
  // ---------------------------------------------------------------------
  const FIELD_W = 240, FIELD_H = 132;
  let mixHue = hueOf(firstHex) ?? 340;
  let mixDepth = depthOf(firstHex) ?? 0.5;

  const fieldCanvas = el('canvas', { class: 'dz-fieldpaint', width: FIELD_W, height: FIELD_H, 'aria-hidden': 'true' });
  const fieldDot = el('span', { class: 'dz-fielddot' });
  const mixField = el('div', {
    class: 'dz-mixfield', tabindex: '0', role: 'group', 'aria-label': config.fieldLabel,
  }, [fieldCanvas, fieldDot]);
  const mixDot = el('span', { class: 'dz-mixdot' });

  (function paintField() {
    const ctx = fieldCanvas.getContext('2d');
    if (!ctx) return;
    for (let y = 0; y < FIELD_H; y += 1) {
      const depth = y / (FIELD_H - 1);
      for (let x = 0; x < FIELD_W; x += 1) {
        ctx.fillStyle = shadeHex((x / FIELD_W) * 360, depth);
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }());

  // הנקודה ממוקמת ב-left ולא ב-inset-inline: הקנבס הוא תמונה ואינו
  // מתהפך ב-RTL, אז הציר שלה חייב להישאר הציר של הפיקסלים.
  function paintMixer() {
    const hex = shadeHex(mixHue, mixDepth);
    fieldDot.style.left = (mixHue / 360) * 100 + '%';
    fieldDot.style.top = mixDepth * 100 + '%';
    fieldDot.style.background = hex;
    mixDot.style.background = hex;
    mixField.setAttribute('aria-label',
      config.fieldLabel + ': ' + config.hueLabel + ' ' + Math.round(mixHue)
      + ', ' + config.depthLabel + ' ' + Math.round(mixDepth * 100));
    return hex;
  }

  function applyMix() {
    const hex = paintMixer();
    targets().forEach((id) => { state.nails[id].hex = hex; });
    picker.value = hex;
    paintTargets();
    renderPad();
    syncQuick();
  }

  function pickAt(event) {
    const box = mixField.getBoundingClientRect();
    if (!box.width || !box.height) return;
    mixHue = Math.max(0, Math.min(359.9, ((event.clientX - box.left) / box.width) * 360));
    mixDepth = Math.max(0, Math.min(1, (event.clientY - box.top) / box.height));
    applyMix();
  }

  // דגל משלנו ולא hasPointerCapture: הלכידה היא אופטימיזציה שלא בכל
  // סביבה קיימת, והגרירה לא אמורה להיות תלויה בה.
  let dragging = false;
  mixField.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    dragging = true;
    mixField.focus();
    mixField.setPointerCapture?.(event.pointerId);
    pickAt(event);
  });
  mixField.addEventListener('pointermove', (event) => {
    if (dragging) pickAt(event);
  });
  ['pointerup', 'pointercancel'].forEach((name) =>
    mixField.addEventListener(name, () => { dragging = false; }));

  // חצים: אופקי לגוון, אנכי לעומק. Shift מקפיץ פי עשר, כי מעבר על
  // 360 מעלות בקפיצות של מעלה הוא לא ניווט.
  mixField.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 10 : 1;
    let used = true;
    switch (event.key) {
      case 'ArrowLeft':  mixHue = (mixHue - step + 360) % 360; break;
      case 'ArrowRight': mixHue = (mixHue + step) % 360; break;
      case 'ArrowUp':    mixDepth = Math.max(0, mixDepth - step / 100); break;
      case 'ArrowDown':  mixDepth = Math.min(1, mixDepth + step / 100); break;
      default: used = false;
    }
    if (!used) return;
    event.preventDefault();
    applyMix();
  });

  // סנכרון הפוך: בחירת גוון מהלוח או מעבר לציפורן אחרת מזיזים את
  // הנקודה למקום שמתאים לצבע שנבחר.
  function syncMixer(hex) {
    const hue = hueOf(hex);
    const depth = depthOf(hex);
    if (hue == null || depth == null) return;
    mixHue = hue;
    mixDepth = depth;
    paintMixer();
  }

  const accent = el('input', {
    type: 'color', class: 'dz-picker', value: '#FFFFFF', 'aria-label': config.accentLabel,
  });
  accent.addEventListener('input', () => {
    targets().forEach((id) => { state.nails[id].accent = accent.value; });
    paintTargets();
    renderPad();
  });

  const finishButtons = finishes.map((finish, i) => {
    const button = el('button', { type: 'button', class: 'dz-chip', text: finish.label });
    button.addEventListener('click', () => {
      targets().forEach((id) => { state.nails[id].finish = i; });
      paintTargets();
      renderPad();
      syncFinishes();
      status.textContent = finish.label;
    });
    return button;
  });
  const syncFinishes = () => {
    const current = leadNail().finish;
    finishButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === current)));
  };

  // ----- לוח העיצוב -----

  const padClip = 'dz-pad-clip';
  const padShape = svgEl('path', {});
  const padBase = svgEl('path', {});
  const padFinish = svgEl('g', { 'clip-path': `url(#${padClip})` });
  const padStickers = svgEl('g', { 'clip-path': `url(#${padClip})` });
  const padInk = svgEl('g', { 'clip-path': `url(#${padClip})` });
  const padOutline = svgEl('path', { fill: 'none', stroke: OUTLINE, 'stroke-width': 2 });
  const padGradStop = svgEl('stop', { offset: '0', 'stop-color': '#FFFFFF', 'stop-opacity': '.95' });
  const padGradFade = svgEl('stop', { offset: '.72', 'stop-color': '#FFFFFF', 'stop-opacity': '0' });
  const pad = svgEl('svg', {
    class: 'dz-pad', viewBox: `0 0 ${NAIL_W} ${NAIL_H}`,
    role: 'application', 'aria-label': config.studioLabel,
  }, [
    svgEl('defs', {}, [svgEl('linearGradient', {
      id: 'dz-grad-pad', x1: '0', y1: '0', x2: '0', y2: '1',
    }, [padGradStop, padGradFade])]),
    svgEl('clipPath', { id: padClip }, [padShape]),
    padBase, padFinish, padStickers, padInk, padOutline,
  ]);

  let drawMode = false;
  let padStrokes = [];

  function renderPad() {
    const nail = leadNail();
    const finish = finishes[nail.finish];
    const shape = shapeOf(state.shape);
    padShape.setAttribute('d', shape.d);
    padBase.setAttribute('d', shape.d);
    padOutline.setAttribute('d', shape.d);
    padBase.setAttribute('fill', nail.hex);

    const fade = finish.id === 'ombre' ? nail.accent : '#FFFFFF';
    padGradStop.setAttribute('stop-color', fade);
    padGradFade.setAttribute('stop-color', fade);
    padFinish.replaceChildren(...finishLayers(finish, nail, 'dz-grad-pad', shape));

    padStickers.replaceChildren(...nail.stickers.map((placed, index) => {
      const node = svgEl('g', {
        class: 'dz-placed', transform: placedTransform(placed),
        role: 'button', tabindex: '0',
        'aria-label': stickers[placed.type].label,
        'aria-pressed': String(state.picked === index),
      }, [stickerNode(stickers[placed.type], placed.color)]);
      if (state.picked === index) node.classList.add('is-picked');
      node.addEventListener('pointerdown', (event) => startStickerDrag(event, index));
      node.addEventListener('keydown', (event) => handleStickerKey(event, index));
      return node;
    }));

    padInk.replaceChildren(...padStrokes.map(strokePath));
  }

  // המרה לינארית מותרת רק כי ה-viewBox ויחס הממדים של האלמנט זהים.
  // aspect-ratio:100/176 ב-CSS הוא חלק מהחוזה.
  const padPoint = (event) => {
    const box = pad.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * NAIL_W,
      y: ((event.clientY - box.top) / box.height) * NAIL_H,
    };
  };
  const overPad = (event) => {
    const box = pad.getBoundingClientRect();
    return event.clientX >= box.left && event.clientX <= box.right
      && event.clientY >= box.top && event.clientY <= box.bottom;
  };

  // הקישוטים של הציפורן המובילה הם מקור האמת, ומועתקים לכל ההיקף.
  function commitStickers() {
    const source = state.nails[leadId()].stickers;
    targets().forEach((id) => {
      if (id !== leadId()) state.nails[id].stickers = cloneStickers(source);
    });
    paintTargets();
  }

  function addSticker(typeIndex, at) {
    state.nails[leadId()].stickers.push({
      type: typeIndex,
      x: at?.x ?? NAIL_W / 2,
      y: at?.y ?? NAIL_H / 2,
      scale: Number(sizeInput.value),
      rot: Number(rotateInput.value),
      color: stickerColor.value,
    });
    state.picked = state.nails[leadId()].stickers.length - 1;
    commitStickers();
    renderPad();
    syncPicked();
    const where = state.selected ? fingerById[state.selected].label : config.editingAll;
    status.textContent = config.placedStatus
      .replace('{sticker}', stickers[typeIndex].label).replace('{finger}', where);
  }

  function startStickerDrag(event, index) {
    if (drawMode) return;
    event.stopPropagation();
    event.preventDefault();
    state.picked = index;
    syncPicked();
    renderPad();

    const placed = state.nails[leadId()].stickers[index];
    const origin = padPoint(event);
    const offset = { x: placed.x - origin.x, y: placed.y - origin.y };

    const move = (moveEvent) => {
      const point = padPoint(moveEvent);
      placed.x = clamp(point.x + offset.x, 0, NAIL_W);
      placed.y = clamp(point.y + offset.y, 0, NAIL_H);
      commitStickers();
      renderPad();
    };
    const end = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
  }

  function handleStickerKey(event, index) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      state.picked = index;
      renderPad();
      syncPicked();
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      removeSticker(index);
      return;
    }
    const step = event.shiftKey ? 8 : 2;
    const delta = {
      ArrowUp: [0, -step], ArrowDown: [0, step],
      ArrowLeft: [-step, 0], ArrowRight: [step, 0],
    }[event.key];
    if (!delta) return;
    event.preventDefault();
    const placed = state.nails[leadId()].stickers[index];
    placed.x = clamp(placed.x + delta[0], 0, NAIL_W);
    placed.y = clamp(placed.y + delta[1], 0, NAIL_H);
    state.picked = index;
    commitStickers();
    renderPad();
    syncPicked();
  }

  function removeSticker(index) {
    state.nails[leadId()].stickers.splice(index, 1);
    state.picked = null;
    commitStickers();
    renderPad();
    syncPicked();
  }

  // מגש הקישוטים. לחיצה מוסיפה במרכז; גרירה מציבה בנקודת השחרור.
  const trayButtons = stickers.map((sticker, index) => {
    const button = el('button', {
      type: 'button', class: 'dz-tray-item', 'aria-label': sticker.label, title: sticker.label,
    });
    button.append(svgEl('svg', { viewBox: '-14 -14 28 28', 'aria-hidden': 'true' },
      [stickerNode(sticker, 'currentColor')]));

    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      button.classList.add('is-dragging');
      const drop = (upEvent) => {
        button.classList.remove('is-dragging');
        document.removeEventListener('pointerup', drop);
        addSticker(index, overPad(upEvent) ? padPoint(upEvent) : null);
      };
      document.addEventListener('pointerup', drop);
    });
    // מקלדת: זה button אמיתי, אז Enter ורווח מוסיפים במרכז.
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      addSticker(index, null);
    });
    return button;
  });

  const sizeInput = el('input', {
    type: 'range', class: 'dz-range dz-range-sm',
    min: config.sticker.min, max: config.sticker.max, step: config.sticker.step,
    value: config.sticker.value, 'aria-label': config.sizeLabel,
  });
  const rotateInput = el('input', {
    type: 'range', class: 'dz-range dz-range-sm',
    min: 0, max: 355, step: 5, value: 0, 'aria-label': config.rotateLabel,
  });
  const stickerColor = el('input', {
    type: 'color', class: 'dz-picker', value: config.sticker.color,
    'aria-label': config.stickerColorLabel,
  });

  const pickedSticker = () =>
    (state.picked === null ? null : state.nails[leadId()].stickers[state.picked] ?? null);

  const applyToPicked = (mutate) => {
    const placed = pickedSticker();
    if (!placed) return;
    mutate(placed);
    commitStickers();
    renderPad();
  };
  sizeInput.addEventListener('input', () =>
    applyToPicked((p) => { p.scale = Number(sizeInput.value); }));
  rotateInput.addEventListener('input', () =>
    applyToPicked((p) => { p.rot = Number(rotateInput.value); }));
  stickerColor.addEventListener('input', () =>
    applyToPicked((p) => { p.color = stickerColor.value; }));

  const deleteSticker = el('button', { type: 'button', class: 'dz-action', text: config.deleteLabel });
  deleteSticker.addEventListener('click', () => {
    if (state.picked !== null) removeSticker(state.picked);
  });

  const clearStickers = el('button', {
    type: 'button', class: 'dz-action', text: config.clearStickersLabel,
  });
  clearStickers.addEventListener('click', () => {
    state.nails[leadId()].stickers = [];
    state.picked = null;
    commitStickers();
    renderPad();
    syncPicked();
  });

  const pickedNote = el('span', { class: 'dz-hint' });
  function syncPicked() {
    const placed = pickedSticker();
    [sizeInput, rotateInput, stickerColor, deleteSticker].forEach((control) => {
      control.disabled = !placed;
    });
    if (placed) {
      sizeInput.value = String(placed.scale);
      rotateInput.value = String(placed.rot);
      stickerColor.value = placed.color;
      pickedNote.textContent = stickers[placed.type].label;
    } else {
      pickedNote.textContent = config.noSelection;
    }
  }

  // ----- ציור ידני, על אותו לוח -----

  let activeStroke = null;

  const brushColor = el('input', {
    type: 'color', class: 'dz-picker', value: config.brush.color, 'aria-label': config.brushLabel,
  });
  const brushSize = el('input', {
    type: 'range', class: 'dz-range dz-range-sm',
    min: config.brush.min, max: config.brush.max, step: config.brush.step,
    value: config.brush.value, 'aria-label': config.brushSizeLabel,
  });

  const commitDrawing = () => {
    targets().forEach((id) => { state.nails[id].strokes = cloneStrokes(padStrokes); });
    paintTargets();
  };

  pad.addEventListener('pointerdown', (event) => {
    if (!drawMode) return;
    event.preventDefault();
    activeStroke = {
      color: brushColor.value, width: Number(brushSize.value), points: [padPoint(event)],
    };
    padStrokes.push(activeStroke);
    pad.setPointerCapture(event.pointerId);
    renderPad();
  });
  pad.addEventListener('pointermove', (event) => {
    if (!activeStroke) return;
    activeStroke.points.push(padPoint(event));
    renderPad();
    commitDrawing();
  });
  const endStroke = () => { if (activeStroke) { activeStroke = null; commitDrawing(); } };
  pad.addEventListener('pointerup', endStroke);
  pad.addEventListener('pointercancel', endStroke);

  const undo = el('button', { type: 'button', class: 'dz-action', text: config.undoLabel });
  undo.addEventListener('click', () => { padStrokes.pop(); renderPad(); commitDrawing(); });

  const clearDraw = el('button', { type: 'button', class: 'dz-action', text: config.clearDrawLabel });
  clearDraw.addEventListener('click', () => { padStrokes = []; renderPad(); commitDrawing(); });

  const drawBar = el('div', { class: 'dz-drawbar', hidden: 'hidden' }, [
    el('label', { class: 'dz-custom' }, [el('span', { text: config.brushLabel }), brushColor]),
    el('label', { class: 'dz-custom' }, [el('span', { text: config.brushSizeLabel }), brushSize]),
    undo, clearDraw,
  ]);

  const drawToggle = el('button', {
    type: 'button', class: 'dz-action', text: config.drawOnLabel, 'aria-pressed': 'false',
  });
  drawToggle.addEventListener('click', () => {
    drawMode = !drawMode;
    drawToggle.setAttribute('aria-pressed', String(drawMode));
    pad.classList.toggle('is-drawing', drawMode);
    drawBar.hidden = !drawMode;
    if (drawMode) {
      state.picked = null;
      syncPicked();
      padStrokes = cloneStrokes(leadNail().strokes);
    }
    renderPad();
    status.textContent = drawMode ? config.drawHint : '';
  });

  // ----- פעולות -----

  const summary = () => [
    config.shareIntro,
    `${config.shapeLabel}: ${shapeOf(state.shape).label}`,
    `${config.lengthLabel}: ${lengthName(state.length)}`,
    ...fingers.map(describe),
    hasDrawing() ? config.drawnNote : null,
  ].filter(Boolean).join('\n');

  const shareUrl = () => {
    const query = new URLSearchParams({
      shape: state.shape, len: String(state.length),
      n: encodeNails(state, fingers), k: encodeStickers(state, fingers),
    });
    return `${location.origin}${location.pathname}?${query}#designer`;
  };

  function exportPng() {
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', 1040);
    clone.setAttribute('height', 1400);
    const source = new XMLSerializer().serializeToString(clone);
    const image = new Image();
    image.onload = () => {
      const canvas = el('canvas');
      canvas.width = 1040;
      canvas.height = 1400;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) { status.textContent = config.downloadFailed; return; }
        const href = URL.createObjectURL(blob);
        const link = el('a', { href, download: 'nail-design.png' });
        document.body.append(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(href);
        status.textContent = config.downloadDone;
      }, 'image/png');
    };
    image.onerror = () => { status.textContent = config.downloadFailed; };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
  }

  const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];

  const surprise = el('button', { type: 'button', class: 'dz-action', text: config.surpriseLabel });
  surprise.addEventListener('click', () => {
    state.shape = pickRandom(shapes).id;
    state.length = Math.round(
      config.length.min + Math.random() * (config.length.max - config.length.min));
    const base = pickRandom(quick).hex;
    const finishIndex = Math.floor(Math.random() * finishes.length);
    fingers.forEach((f) => {
      const nail = state.nails[f.id];
      nail.hex = base;
      nail.finish = finishIndex;
      nail.accent = pickRandom(quick).hex;
      nail.stickers = Math.random() < 0.6 ? [{
        type: Math.floor(Math.random() * stickers.length),
        x: 30 + Math.random() * 40,
        y: 50 + Math.random() * 70,
        scale: 0.7 + Math.random() * 0.8,
        rot: Math.floor(Math.random() * 360),
        color: pickRandom(quick).hex,
      }] : [];
    });
    state.picked = null;
    lengthInput.value = String(state.length);
    picker.value = base;
    paintAll();
    syncAll();
    status.textContent = config.surpriseDone;
  });

  const reset = el('button', { type: 'button', class: 'dz-action', text: config.resetLabel });
  reset.addEventListener('click', () => {
    state.shape = shapes[0].id;
    state.length = config.length.value;
    state.selected = null;
    state.picked = null;
    fingers.forEach((f) => { state.nails[f.id] = blankNail(); });
    padStrokes = [];
    lengthInput.value = String(state.length);
    picker.value = firstHex;
    paintAll();
    syncAll();
    status.textContent = config.resetDone;
  });

  const download = el('button', { type: 'button', class: 'dz-action', text: config.downloadLabel });
  download.addEventListener('click', exportPng);

  const copy = el('button', { type: 'button', class: 'dz-action', text: config.copyLabel });
  copy.addEventListener('click', async () => {
    const url = shareUrl();
    // ציור ידני לא נכנס לכתובת — עדיף לומר את זה מאשר לשתף קישור חלקי בשקט.
    const done = hasDrawing() ? config.copyDrawNote : config.copyDone;
    try {
      await navigator.clipboard.writeText(url);
      status.textContent = done;
    } catch {
      status.textContent = url;
    }
  });

  const share = el('a', {
    class: 'dz-action dz-action-primary', text: config.shareLabel,
    target: '_blank', rel: 'noopener', href: whatsappBase,
  });
  share.addEventListener('click', () => {
    share.href = whatsappLink(whatsappBase, `${summary()}\n${shareUrl()}`);
  });

  // ----- סנכרון -----

  function syncScope() {
    const finger = state.selected ? fingerById[state.selected] : null;
    scope.textContent = finger
      ? config.editingOne.replace('{finger}', finger.label)
      : config.editingAll;
    scope.setAttribute('aria-pressed', String(state.selected !== null));
    fingers.forEach((f) => {
      parts[f.id].group.setAttribute('aria-pressed', String(state.selected === f.id));
      parts[f.id].group.classList.toggle('is-selected', state.selected === f.id);
    });
    picker.value = leadNail().hex;
    accent.value = leadNail().accent;
    padStrokes = cloneStrokes(leadNail().strokes);
    syncQuick();
    syncFinishes();
    syncPicked();
    renderPad();
  }

  function syncAll() {
    paintMixer();
    syncScope();
    syncShapes();
    syncLength();
  }

  scope.addEventListener('click', () => {
    state.selected = null;
    state.picked = null;
    syncScope();
    status.textContent = config.editingAll;
  });

  // ----- הרכבה: הבקרות בצד ההתחלה, היד דביקה בצד הסיום -----

  const controls = el('div', { class: 'dz-side' }, [
    el('div', { class: 'dz-scopebar' }, [
      scope, el('span', { class: 'dz-hint', text: config.hint }),
    ]),
    el('div', { class: 'dz-card' }, [
      field(config.shapeLabel, el('div', {
        class: 'dz-row', role: 'group', 'aria-label': config.shapeLabel,
      }, shapeButtons.map((s) => s.button))),
      field(config.lengthLabel, el('div', { class: 'dz-rangewrap' }, [lengthInput, lengthOut])),
      field(config.shadeLabel, el('div', { class: 'dz-colorwrap' }, [
        el('div', { class: 'dz-swatches', role: 'group', 'aria-label': config.quickLabel },
          quickButtons.map((q) => q.button)),
        el('div', { class: 'dz-mixer' }, [mixField, el('div', { class: 'dz-mixside' }, [
          mixDot,
          el('span', { class: 'dz-mixhint', text: config.fieldHint }),
        ])]),
        el('label', { class: 'dz-custom' }, [el('span', { text: config.pickerLabel }), picker]),
      ])),
    ]),
    el('div', { class: 'dz-card' }, [
      el('span', { class: 'dz-pname', text: config.studioLabel }),
      el('div', { class: 'dz-padwrap' }, [
        pad,
        el('div', { class: 'dz-padside' }, [
          el('span', { class: 'dz-pname', text: config.finishLabel }),
          el('div', { class: 'dz-row' }, finishButtons),
          el('label', { class: 'dz-custom' }, [el('span', { text: config.accentLabel }), accent]),
          drawToggle,
          drawBar,
        ]),
      ]),
      el('div', { class: 'dz-tray' }, [
        el('span', { class: 'dz-pname', text: config.stickerLabel }),
        el('div', { class: 'dz-row dz-trayrow' }, trayButtons),
        el('span', { class: 'dz-hint', text: config.studioHint }),
      ]),
      el('div', { class: 'dz-tray' }, [
        el('span', { class: 'dz-pname', text: config.placedLabel }),
        pickedNote,
        el('div', { class: 'dz-drawbar' }, [
          el('label', { class: 'dz-custom' }, [el('span', { text: config.sizeLabel }), sizeInput]),
          el('label', { class: 'dz-custom' }, [el('span', { text: config.rotateLabel }), rotateInput]),
          el('label', { class: 'dz-custom' }, [el('span', { text: config.stickerColorLabel }), stickerColor]),
          deleteSticker, clearStickers,
        ]),
      ]),
    ]),
  ]);

  // ----- שתי תצוגות לאותו עיצוב: היד המצוירת, והיד האמיתית במצלמה -----

  const live = el('div', { class: 'dz-live', hidden: 'hidden' });
  const tryOn = mountTryOn(live, config.tryOn, design);

  const photo = el('button', {
    type: 'button', class: 'dz-action', text: config.tryOn.photoLabel, hidden: 'hidden',
  });
  photo.addEventListener('click', () => {
    const shot = tryOn.snapshot();
    if (!shot) return;
    // אותו מסלול כמו ייצוא היד המצוירת: קנבס → PNG → הורדה.
    shot.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = el('a', { href: url, download: 'my-nails.png' });
      link.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  });

  const viewButtons = [
    { id: 'drawn', label: config.tryOn.drawnLabel },
    { id: 'live', label: config.tryOn.liveLabel },
  ].map(({ id, label }) => {
    const button = el('button', {
      type: 'button', class: 'dz-view', text: label, 'aria-pressed': String(id === 'drawn'),
    });
    button.addEventListener('click', () => setView(id));
    return { id, button };
  });

  function setView(id) {
    const isLive = id === 'live';
    viewButtons.forEach((v) => v.button.setAttribute('aria-pressed', String(v.id === id)));
    // hidden הוא תכונה של HTMLElement, ו-SVGElement אינו יורש ממנו: השמה
    // ל-svg.hidden הייתה יוצרת תכונת JS שלא עושה כלום. התכונה עצמה כן
    // תופסת, כי הכלל הגלובלי ב-styles.css הוא סלקטור תכונה.
    if (isLive) svg.setAttribute('hidden', ''); else svg.removeAttribute('hidden');
    live.hidden = !isLive;
    photo.hidden = !isLive;
    // המצלמה נדלקת רק כשמסתכלים עליה, ונכבית ברגע שעוברים משם. נורית
    // מצלמה שנשארת דולקת בטאב אחר היא בדיוק מה שגורם לאנשים לסגור אתר.
    if (isLive) tryOn.start(); else tryOn.stop();
  }

  const stage = el('div', { class: 'dz-stage' }, [
    el('div', { class: 'dz-viewbar', role: 'group', 'aria-label': config.tryOn.viewLabel },
      viewButtons.map((v) => v.button)),
    svg,
    live,
    el('div', { class: 'dz-actions' }, [surprise, reset, download, photo, copy, share]),
    status,
  ]);

  root.append(el('div', { class: 'dz-layout' }, [controls, stage]));

  paintAll();
  syncAll();
}
