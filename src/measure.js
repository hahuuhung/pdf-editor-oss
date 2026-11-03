// Technical drawing measurement suite, dual scale calibration (preset ratios + 2-point reference),
// vector dimension geometry (distance, perimeter, Shoelace area, 3-point angle), and magnifier Loupe.

import { el, field, icon, openDialog, svgEl } from './dom.js';

export const MEASURE_UNITS = Object.freeze([
  { id: 'mm', label: 'Milimét (mm)', areaLabel: 'mm²', toMm: 1 },
  { id: 'cm', label: 'Xentimét (cm)', areaLabel: 'cm²', toMm: 10 },
  { id: 'm', label: 'Mét (m)', areaLabel: 'm²', toMm: 1000 },
  { id: 'in', label: 'Inch (in)', areaLabel: 'in²', toMm: 25.4 },
  { id: 'ft', label: 'Feet (ft)', areaLabel: 'ft²', toMm: 304.8 },
]);

export const PRESET_RATIOS = Object.freeze([1, 2, 5, 10, 20, 25, 50, 75, 100, 200, 500]);

export const MEASURE_SUBTYPES = Object.freeze(['dist', 'perim', 'area', 'angle']);

const MM_PER_PT = 25.4 / 72;

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function unitMeta(unitId) {
  return MEASURE_UNITS.find((u) => u.id === unitId) ?? MEASURE_UNITS[0];
}

// Computes real-world units per 1 PDF point from a standard drawing scale 1:ratio (e.g. 1:100, unit 'm').
export function scaleFromPreset(ratio = 1, unit = 'mm') {
  const safeRatio = Math.max(0.0001, Number(ratio) || 1);
  const u = unitMeta(unit);
  const realUnitsPerPt = (MM_PER_PT * safeRatio) / u.toMm;
  return {
    mode: 'preset',
    ratio: safeRatio,
    unit: u.id,
    realUnitsPerPt,
  };
}

// Computes calibration from a measured segment in PDF points and the user-entered real distance.
export function calibrateFromSegment(ptDistance, realDistance, unit = 'm') {
  const pt = Math.max(0.01, Number(ptDistance) || 1);
  const real = Math.max(0.0001, Number(realDistance) || 1);
  const u = unitMeta(unit);
  const realUnitsPerPt = real / pt;
  const impliedRatio = (realUnitsPerPt * u.toMm) / MM_PER_PT;
  return {
    mode: 'custom',
    ratio: Math.round(impliedRatio * 100) / 100,
    unit: u.id,
    realUnitsPerPt,
  };
}

export function sanitizeMeasureScale(raw) {
  if (!raw || typeof raw !== 'object') return scaleFromPreset(1, 'mm');
  const u = unitMeta(raw.unit);
  if (raw.mode === 'custom' && Number.isFinite(Number(raw.realUnitsPerPt)) && Number(raw.realUnitsPerPt) > 0) {
    const rup = Number(raw.realUnitsPerPt);
    return {
      mode: 'custom',
      ratio: Math.round(((rup * u.toMm) / MM_PER_PT) * 100) / 100,
      unit: u.id,
      realUnitsPerPt: rup,
    };
  }
  return scaleFromPreset(raw.ratio ?? 1, u.id);
}

// Euclidean distance in PDF points between two 2D points.
export function segmentDistancePt(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

// Total polyline length in PDF points across all consecutive vertices.
export function polylineLengthPt(points = []) {
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    sum += segmentDistancePt(points[i - 1], points[i]);
  }
  return sum;
}

// Polygon area in square PDF points using the Shoelace formula.
export function polygonAreaPt2(points = []) {
  if (points.length < 3) return 0;
  let twiceArea = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    twiceArea += x1 * y2 - x2 * y1;
  }
  return Math.abs(twiceArea) / 2;
}

// Interior angle in degrees (0..180) at vertex `b` formed by rays b->a and b->c.
export function angleDegrees(a, b, c) {
  if (!a || !b || !c) return 0;
  const ux = a[0] - b[0];
  const uy = a[1] - b[1];
  const vx = c[0] - b[0];
  const vy = c[1] - b[1];
  const lenU = Math.hypot(ux, uy);
  const lenV = Math.hypot(vx, vy);
  if (lenU < 1e-6 || lenV < 1e-6) return 0;
  const cos = clamp((ux * vx + uy * vy) / (lenU * lenV), -1, 1);
  return (Math.acos(cos) * 180) / Math.PI;
}

function formatNumber(val) {
  if (val >= 1000) return val.toFixed(1);
  if (val >= 10) return val.toFixed(2);
  return val.toFixed(2);
}

// Computes the human-readable measurement string for any measurement mark.
export function formatMeasurementLabel(mark, rawScale) {
  const scale = sanitizeMeasureScale(rawScale);
  const u = unitMeta(scale.unit);
  const pts = mark.points ?? [];
  const kind = MEASURE_SUBTYPES.includes(mark.label) ? mark.label : 'dist';

  if (kind === 'angle') {
    if (pts.length < 3) return '0.0°';
    return `${angleDegrees(pts[0], pts[1], pts[2]).toFixed(1)}°`;
  }
  if (kind === 'area') {
    const areaReal = polygonAreaPt2(pts) * scale.realUnitsPerPt * scale.realUnitsPerPt;
    return `${formatNumber(areaReal)} ${u.areaLabel}`;
  }
  if (kind === 'perim') {
    const lenReal = polylineLengthPt(pts) * scale.realUnitsPerPt;
    return `${formatNumber(lenReal)} ${u.id}`;
  }
  const distReal = (pts.length >= 2 ? segmentDistancePt(pts[0], pts[1]) : 0) * scale.realUnitsPerPt;
  return `${formatNumber(distReal)} ${u.id}`;
}

// Computes perpendicular tick endpoints at `a` and `b` for architectural dimension lines.
export function dimensionTicks(a, b, tickHalf = 4.5) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  return [
    [[a[0] - nx * tickHalf, a[1] - ny * tickHalf], [a[0] + nx * tickHalf, a[1] + ny * tickHalf]],
    [[b[0] - nx * tickHalf, b[1] - ny * tickHalf], [b[0] + nx * tickHalf, b[1] + ny * tickHalf]],
  ];
}

// Centroid / anchor point in view space where the measurement callout pill is placed.
export function measurementLabelAnchor(points = [], kind = 'dist') {
  if (!points.length) return [0, 0];
  if (kind === 'dist' && points.length >= 2) {
    return [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2 - 7];
  }
  if (kind === 'angle' && points.length >= 3) {
    const [a, b, c] = points;
    const ux = (a[0] - b[0]) / (Math.hypot(a[0] - b[0], a[1] - b[1]) || 1);
    const uy = (a[1] - b[1]) / (Math.hypot(a[0] - b[0], a[1] - b[1]) || 1);
    const vx = (c[0] - b[0]) / (Math.hypot(c[0] - b[0], c[1] - b[1]) || 1);
    const vy = (c[1] - b[1]) / (Math.hypot(c[0] - b[0], c[1] - b[1]) || 1);
    const bx = ux + vx;
    const by = uy + vy;
    const bl = Math.hypot(bx, by) || 1;
    return [b[0] + (bx / bl) * 26, b[1] + (by / bl) * 26];
  }
  const sumX = points.reduce((s, p) => s + p[0], 0);
  const sumY = points.reduce((s, p) => s + p[1], 0);
  return [sumX / points.length, sumY / points.length];
}

// Draws a measurement mark inside an SVG <g> element on screen.
export function renderMeasureSvg(g, m, rawScale) {
  const pts = m.points ?? [];
  if (!pts.length) return;
  const kind = MEASURE_SUBTYPES.includes(m.label) ? m.label : 'dist';
  const stroke = {
    stroke: m.color,
    'stroke-width': m.width,
    'stroke-opacity': m.opacity,
    fill: 'none',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  };

  if (kind === 'area' && pts.length >= 2) {
    g.append(svgEl('polygon', {
      points: pts.map((p) => p.join(',')).join(' '),
      fill: m.fill || m.color,
      'fill-opacity': 0.18,
      ...stroke,
    }));
  } else if (pts.length >= 2) {
    g.append(svgEl('polyline', {
      points: pts.map((p) => p.join(',')).join(' '),
      ...stroke,
    }));
  }

  if (kind === 'dist' && pts.length >= 2) {
    for (const [t1, t2] of dimensionTicks(pts[0], pts[1], 4.5)) {
      g.append(svgEl('line', { x1: t1[0], y1: t1[1], x2: t2[0], y2: t2[1], ...stroke }));
    }
  } else {
    for (const [px, py] of pts) {
      g.append(svgEl('circle', { cx: px, cy: py, r: 2.4, fill: m.color, 'fill-opacity': m.opacity }));
    }
  }

  const text = m.text?.trim() ? m.text.trim() : formatMeasurementLabel(m, rawScale);
  const [lx, ly] = measurementLabelAnchor(pts, kind);
  const pillW = Math.max(34, text.length * 5.8 + 10);
  const pillH = 14;
  g.append(
    svgEl('rect', {
      x: lx - pillW / 2,
      y: ly - pillH / 2,
      width: pillW,
      height: pillH,
      rx: 3,
      fill: '#ffffff',
      'fill-opacity': 0.92,
      stroke: m.color,
      'stroke-width': 0.8,
    }),
  );
  const labelNode = svgEl('text', {
    x: lx,
    y: ly + 3.3,
    'text-anchor': 'middle',
    'font-size': 9.5,
    'font-weight': 600,
    fill: m.color,
    class: 'measure-label',
  });
  labelNode.textContent = text;
  g.append(labelNode);
}

// Modal dialog for setting a preset architectural ratio or calibrating from a 2-point segment.
export function openScaleCalibrationDialog({ currentScale, measuredPt = null, onApply, onStartReferenceTool }) {
  const cur = sanitizeMeasureScale(currentScale);
  const modeSel = el('select', {},
    el('option', { value: 'preset', selected: cur.mode !== 'custom' && !measuredPt }, 'Chọn tỷ lệ bản vẽ chuẩn (1:N)'),
    el('option', { value: 'custom', selected: cur.mode === 'custom' || !!measuredPt }, 'Hiệu chuẩn theo đoạn mẫu thực tế'),
  );
  const ratioSel = el('select', {},
    PRESET_RATIOS.map((r) => el('option', { value: r, selected: Math.abs(cur.ratio - r) < 0.01 }, `1 : ${r}`)),
  );
  const customRatioInput = el('input', { type: 'number', min: 0.01, step: 'any', value: cur.ratio });
  const unitSel = el('select', {},
    MEASURE_UNITS.map((u) => el('option', { value: u.id, selected: u.id === cur.unit }, u.label)),
  );
  const ptInput = el('input', {
    type: 'number',
    min: 0.1,
    step: 'any',
    value: measuredPt ? measuredPt.toFixed(2) : '72.00',
  });
  const realDistInput = el('input', {
    type: 'number',
    min: 0.001,
    step: 'any',
    value: measuredPt ? (measuredPt * cur.realUnitsPerPt).toFixed(2) : '1.00',
    autofocus: !!measuredPt,
  });

  const presetBox = el('div', { class: 'dlg-grid' },
    field('Tỷ lệ thông dụng', ratioSel),
    field('Hoặc nhập mẫu số N (1:N)', customRatioInput),
  );
  ratioSel.addEventListener('change', () => {
    customRatioInput.value = ratioSel.value;
  });

  let closeDlg = () => {};
  const pickBtn = onStartReferenceTool
    ? el('button', {
        type: 'button',
        class: 'dlg-btn',
        onclick: () => {
          closeDlg();
          onStartReferenceTool();
        },
      }, icon('ruler', 15), 'Kẻ đoạn chuẩn trực tiếp trên bản vẽ')
    : null;

  const customBox = el('div', {},
    pickBtn,
    el('div', { class: 'dlg-grid' },
      field('Độ dài trên trang (pt)', ptInput, 'Tự điền khi kẻ 2 điểm trên bản vẽ.'),
      field('Kích thước ngoài thực tế', realDistInput),
    ),
  );

  const syncMode = () => {
    const isCustom = modeSel.value === 'custom';
    presetBox.classList.toggle('hidden', isCustom);
    customBox.classList.toggle('hidden', !isCustom);
  };
  modeSel.addEventListener('change', syncMode);
  syncMode();

  closeDlg = openDialog({
    title: 'Hiệu chuẩn tỷ lệ đo đạc bản vẽ',
    subtitle: 'Áp dụng cho Thước đo khoảng cách, Chu vi & Diện tích',
    icon: 'ruler',
    width: 490,
    body: el('div', {},
      field('Phương thức hiệu chuẩn', modeSel),
      presetBox,
      customBox,
      field('Đơn vị hiển thị', unitSel),
    ),
    actions: [
      { label: 'Hủy' },
      {
        label: 'Lưu tỷ lệ',
        primary: true,
        run: () => {
          const next = modeSel.value === 'custom'
            ? calibrateFromSegment(ptInput.value, realDistInput.value, unitSel.value)
            : scaleFromPreset(customRatioInput.value, unitSel.value);
          onApply?.(next);
        },
      },
    ],
  });
}

// Floating circular magnifier Loupe (2x - 4x) for inspecting fine blueprint lines & text.
export function createLoupeController({ viewEl }) {
  let active = false;
  let mag = 3;
  let lensEl = null;
  let lensCanvas = null;
  let badgeEl = null;
  const LENS_SIZE = 176;

  function ensureLens() {
    if (lensEl) return;
    lensCanvas = el('canvas', { width: LENS_SIZE, height: LENS_SIZE, class: 'loupe-canvas' });
    badgeEl = el('span', { class: 'loupe-badge' }, `${mag}×`);
    lensEl = el('div', { class: 'pdf-loupe hidden', 'aria-hidden': 'true' },
      lensCanvas,
      el('span', { class: 'loupe-crosshair' }),
      badgeEl,
    );
    document.body.append(lensEl);
  }

  function paintAt(clientX, clientY) {
    if (!active || !lensEl) return;
    const target = document.elementFromPoint(clientX, clientY);
    const pageDiv = target?.closest?.('.page');
    const srcCanvas = pageDiv?.querySelector('canvas');
    if (!srcCanvas || !srcCanvas.width || !srcCanvas.height) {
      lensEl.classList.add('hidden');
      return;
    }

    const rect = srcCanvas.getBoundingClientRect();
    const relX = (clientX - rect.left) / rect.width;
    const relY = (clientY - rect.top) / rect.height;
    if (relX < 0 || relX > 1 || relY < 0 || relY > 1) {
      lensEl.classList.add('hidden');
      return;
    }

    lensEl.classList.remove('hidden');
    lensEl.style.left = `${clientX - LENS_SIZE / 2}px`;
    lensEl.style.top = `${clientY - LENS_SIZE / 2}px`;

    const ctx = lensCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, LENS_SIZE, LENS_SIZE);

    const ratioX = srcCanvas.width / rect.width;
    const ratioY = srcCanvas.height / rect.height;
    const srcW = (LENS_SIZE / mag) * ratioX;
    const srcH = (LENS_SIZE / mag) * ratioY;
    const sx = relX * srcCanvas.width - srcW / 2;
    const sy = relY * srcCanvas.height - srcH / 2;

    ctx.drawImage(srcCanvas, sx, sy, srcW, srcH, 0, 0, LENS_SIZE, LENS_SIZE);
  }

  function onPointerMove(e) {
    paintAt(e.clientX, e.clientY);
  }

  function onPointerLeave() {
    lensEl?.classList.add('hidden');
  }

  function setMagnification(nextMag) {
    mag = clamp(Math.round(Number(nextMag) || 3), 2, 4);
    if (badgeEl) badgeEl.textContent = `${mag}×`;
  }

  function toggle(force) {
    active = typeof force === 'boolean' ? force : !active;
    if (active) {
      ensureLens();
      viewEl?.addEventListener('pointermove', onPointerMove);
      viewEl?.addEventListener('pointerleave', onPointerLeave);
    } else {
      viewEl?.removeEventListener('pointermove', onPointerMove);
      viewEl?.removeEventListener('pointerleave', onPointerLeave);
      lensEl?.classList.add('hidden');
    }
    return active;
  }

  return {
    get active() {
      return active;
    },
    get magnification() {
      return mag;
    },
    setMagnification,
    toggle,
  };
}
