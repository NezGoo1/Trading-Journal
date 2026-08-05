/* ============================================================
   charts.js — tiny dependency-free canvas charts (HiDPI aware)
   ============================================================ */

const Charts = (() => {
  const COLORS = {
    green: '#3fb950',
    red: '#f85149',
    accent: '#388bfd',
    grid: 'rgba(255,255,255,0.06)',
    axis: 'rgba(255,255,255,0.28)',
    text: '#9aa7b4',
  };

  function setup(canvas, cssHeight) {
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || canvas.parentElement.clientWidth || 320;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.height = cssHeight + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    return { ctx, w: cssWidth, h: cssHeight };
  }

  function niceExtent(min, max) {
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.08;
    return [min - pad, max + pad];
  }

  /* Area/line chart for equity curve.
     data: [{label, value}] ; opts: {height, baseline} */
  function area(canvas, data, opts = {}) {
    const height = opts.height || 190;
    const { ctx, w, h } = setup(canvas, height);
    if (!data.length) { emptyMsg(ctx, w, h); return; }

    const padL = 46, padR = 12, padT = 12, padB = 22;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const values = data.map((d) => d.value);
    const baseline = opts.baseline != null ? opts.baseline : Math.min(0, ...values);
    let [minV, maxV] = niceExtent(Math.min(baseline, ...values), Math.max(baseline, ...values));

    const x = (i) => padL + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
    const y = (v) => padT + plotH - ((v - minV) / (maxV - minV)) * plotH;

    // grid + y labels
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.text;
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const v = minV + (i / ticks) * (maxV - minV);
      const yy = y(v);
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(shortNum(v), padL - 6, yy);
    }

    const lastVal = values[values.length - 1];
    const up = lastVal >= (opts.baseline != null ? opts.baseline : (data[0] ? data[0].value : 0));
    const stroke = up ? COLORS.green : COLORS.red;

    // area fill
    const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    grad.addColorStop(0, hexA(stroke, 0.28));
    grad.addColorStop(1, hexA(stroke, 0.02));
    ctx.beginPath();
    ctx.moveTo(x(0), y(Math.max(minV, Math.min(maxV, baseline))));
    data.forEach((d, i) => ctx.lineTo(x(i), y(d.value)));
    ctx.lineTo(x(data.length - 1), y(Math.max(minV, Math.min(maxV, baseline))));
    ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    // baseline line
    if (baseline >= minV && baseline <= maxV) {
      ctx.strokeStyle = COLORS.axis;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(padL, y(baseline)); ctx.lineTo(w - padR, y(baseline)); ctx.stroke();
      ctx.setLineDash([]);
    }

    // line
    ctx.beginPath();
    data.forEach((d, i) => { const xx = x(i), yy = y(d.value); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); });
    ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();

    // last point dot
    ctx.beginPath();
    ctx.arc(x(data.length - 1), y(lastVal), 3.2, 0, Math.PI * 2);
    ctx.fillStyle = stroke; ctx.fill();

    // x labels (first, mid, last)
    ctx.fillStyle = COLORS.text; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const idxs = data.length > 2 ? [0, Math.floor((data.length - 1) / 2), data.length - 1] : data.map((_, i) => i);
    idxs.forEach((i) => { if (data[i] && data[i].label) ctx.fillText(data[i].label, x(i), padT + plotH + 6); });
  }

  /* Vertical bar chart. data: [{label, value}] ; positive green / negative red */
  function bars(canvas, data, opts = {}) {
    const height = opts.height || 180;
    const { ctx, w, h } = setup(canvas, height);
    if (!data.length) { emptyMsg(ctx, w, h); return; }

    const padL = 44, padR = 10, padT = 10, padB = 24;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const values = data.map((d) => d.value);
    let maxV = Math.max(0, ...values);
    let minV = Math.min(0, ...values);
    if (maxV === minV) { maxV += 1; minV -= 1; }
    const range = maxV - minV;

    const y = (v) => padT + plotH - ((v - minV) / range) * plotH;
    const zeroY = y(0);

    // grid + labels
    ctx.font = '10px -apple-system, sans-serif';
    ctx.fillStyle = COLORS.text;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const v = minV + (i / ticks) * range;
      const yy = y(v);
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
      ctx.fillStyle = COLORS.text;
      ctx.fillText(shortNum(v), padL - 6, yy);
    }

    const gap = Math.min(14, plotW / data.length * 0.3);
    const bw = Math.max(3, (plotW / data.length) - gap);
    data.forEach((d, i) => {
      const cx = padL + (i + 0.5) * (plotW / data.length);
      const val = d.value;
      const top = y(Math.max(0, val));
      const bottom = y(Math.min(0, val));
      const barH = Math.max(1, bottom - top);
      ctx.fillStyle = val >= 0 ? COLORS.green : COLORS.red;
      roundRect(ctx, cx - bw / 2, top, bw, barH, Math.min(4, bw / 2));
      ctx.fill();
    });

    // zero axis
    ctx.strokeStyle = COLORS.axis;
    ctx.beginPath(); ctx.moveTo(padL, zeroY); ctx.lineTo(w - padR, zeroY); ctx.stroke();

    // x labels
    ctx.fillStyle = COLORS.text; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const step = Math.ceil(data.length / (w < 420 ? 7 : 14));
    data.forEach((d, i) => {
      if (i % step !== 0 && i !== data.length - 1) return;
      if (d.label) ctx.fillText(d.label, padL + (i + 0.5) * (plotW / data.length), padT + plotH + 6);
    });
  }

  /* Histogram of P&L distribution. values: number[] */
  function histogram(canvas, values, opts = {}) {
    if (!values.length) { const { ctx, w, h } = setup(canvas, opts.height || 160); emptyMsg(ctx, w, h); return; }
    const min = Math.min(...values), max = Math.max(...values);
    const bins = opts.bins || 9;
    const width = (max - min) || 1;
    const binW = width / bins;
    const buckets = Array.from({ length: bins }, (_, i) => ({
      lo: min + i * binW, hi: min + (i + 1) * binW, count: 0, mid: min + (i + 0.5) * binW,
    }));
    values.forEach((v) => {
      let idx = Math.floor((v - min) / binW);
      if (idx >= bins) idx = bins - 1;
      if (idx < 0) idx = 0;
      buckets[idx].count++;
    });
    bars(canvas, buckets.map((b) => ({ label: shortNum(b.mid), value: b.count > 0 ? b.count : 0, _mid: b.mid })), {
      height: opts.height || 160,
    });
    // Re-color by sign of the bin midpoint (bars() colors by value which is count>0).
    // Simpler: redraw using signed coloring:
    redrawHistogramColors(canvas, buckets, opts.height || 160);
  }

  function redrawHistogramColors(canvas, buckets, height) {
    const { ctx, w, h } = setup(canvas, height);
    const padL = 44, padR = 10, padT = 10, padB = 24;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const maxCount = Math.max(1, ...buckets.map((b) => b.count));
    const y = (c) => padT + plotH - (c / maxCount) * plotH;

    ctx.font = '10px -apple-system, sans-serif';
    ctx.fillStyle = COLORS.text; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const c = (i / 4) * maxCount, yy = y(c);
      ctx.strokeStyle = COLORS.grid; ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
      ctx.fillStyle = COLORS.text; ctx.fillText(Math.round(c), padL - 6, yy);
    }
    const cellW = plotW / buckets.length;
    const bw = Math.max(3, cellW - 6);
    buckets.forEach((b, i) => {
      const cx = padL + (i + 0.5) * cellW;
      const top = y(b.count);
      ctx.fillStyle = b.mid >= 0 ? COLORS.green : COLORS.red;
      roundRect(ctx, cx - bw / 2, top, bw, Math.max(1, padT + plotH - top), Math.min(4, bw / 2));
      ctx.fill();
    });
    ctx.fillStyle = COLORS.text; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    buckets.forEach((b, i) => {
      if (i % 2 !== 0 && i !== buckets.length - 1) return;
      ctx.fillText(shortNum(b.mid), padL + (i + 0.5) * cellW, padT + plotH + 6);
    });
  }

  /* ---- helpers ---- */
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function emptyMsg(ctx, w, h) {
    ctx.fillStyle = COLORS.text; ctx.font = '13px -apple-system, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('No data yet', w / 2, h / 2);
  }
  function shortNum(v) {
    const abs = Math.abs(v);
    let s;
    if (abs >= 1000) s = (v / 1000).toFixed(abs >= 10000 ? 0 : 1) + 'k';
    else if (abs >= 1) s = Math.round(v).toString();
    else s = v.toFixed(1);
    return s;
  }
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return `rgba(${r},${g},${b},${a})`;
  }

  return { area, bars, histogram, COLORS };
})();
