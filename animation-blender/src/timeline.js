
// ============================================================================
//  TIMELINE
//  One row per track. Every track row has its own height (drag its bottom edge) and its own value zoom
//  (Ctrl / Alt + wheel over the lane), so values can be placed precisely; double-click a point, or click
//  a track's value readout, to type an exact number.
// ============================================================================
const tracksEl = $('tracks');
const playhead = $('playhead'); document.querySelector('.tl').append(playhead);
let rows = [];
const LANE_H = 38, MIN_H = 24, MAX_H = 360, PAD = 6;
const HEIGHT_PRESETS = [['Small', 30], ['Normal', LANE_H], ['Tall', 90], ['Extra tall', 180]];

// track specs: how to read, write, show and snap one curve
const SPEC = {
  speed: { range: [0, SPEED_MAX], ref: 1, color: COL.speed, scale: 100, unit: '%', fmt: pct, snap: 0.05 },
  whole: { range: [0, W_MAX], ref: 1, color: COL.weight, scale: 100, unit: '%', fmt: pct, snap: 0.05 },
  w: { range: [0, W_MAX], ref: 1, color: COL.weight, scale: 100, unit: '%', fmt: pct, snap: 0.05 },
  a: { range: [-ADJ_MAX, ADJ_MAX], ref: 0, color: COL.adjust, scale: 1, unit: '°', fmt: (v) => sgn(v, 1, '°'), snap: 1 },
  timing: { range: [-TIMING_MAX, TIMING_MAX], ref: 0, color: COL.timing, scale: 100, unit: '% cycle', fmt: (v) => (v >= 0 ? '+' : '') + Math.round(v * 100) + '%', snap: 0.01 },
};
function effSpec(k) {
  const T = TRK[k];
  const scale = T.fmt === pct ? 100 : 1, unit = T.fmt === pct ? '%' : T.flag ? '(0 / 1)' : T.kind === 'p' ? 'cm' : '°';
  return { range: T.range, ref: T.ref, color: T.color, scale, unit, fmt: T.fmt, snap: T.snap, flag: !!T.flag };
}

function mkRow(cls, key) {
  const el = document.createElement('div'); el.className = 'row ' + cls;
  const h = document.createElement('div'); h.className = 'h'; el.append(h);
  const lane = document.createElement('div'); lane.className = 'lanefill'; el.append(lane);
  return { el, h, lane, key };
}
function rowHeight(r) { return r.key ? (A.heights[r.key] || LANE_H) : LANE_H; }
function addTrackRow(key, spec, get, set, labelHTML, owner) {
  const r = mkRow('track', key);
  Object.assign(r, spec, { kind: 'track', get, set, owner });
  r.h.innerHTML = `<span class="sw" style="background:${spec.color}"></span><span class="name">${labelHTML}</span><button type="button" class="val" title="Click to type a value at the playhead"></button><div class="rz" title="Drag to set this track's height · double-click for the default"></div>`;
  r.h.title = 'Double-click the name to reset · right-click the lane for track options';
  r.h.querySelector('.name').ondblclick = () => { pushUndo(); set(flat(spec.ref, S.dur)); edited(r); };
  r.valEl = r.h.querySelector('.val');
  r.valEl.onclick = (e) => openNumEdit(r, null, e);
  const rz = r.h.querySelector('.rz');
  rz.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); rz.setPointerCapture(e.pointerId); rowDrag = { r, y0: e.clientY, h0: rowHeight(r) }; });
  rz.ondblclick = () => setRowHeight(r, LANE_H, true);
  r.el.style.height = rowHeight(r) + 'px';
  lane(r); tracksEl.append(r.el); rows.push(r);
  return r;
}
function setRowHeight(r, h, commit) {
  h = Math.round(clamp(h, MIN_H, MAX_H));
  if (h === LANE_H) delete A.heights[r.key]; else A.heights[r.key] = h;
  r.el.style.height = h + 'px'; layoutLane(r);
  if (commit) save();
}
let rowDrag = null;

function rebuildRows() {
  tracksEl.textContent = ''; rows = [];
  addTrackRow('speed', SPEC.speed, () => A.speed, (p) => { A.speed = p; }, 'Playback speed <i>master</i>', null);
  // FK bones
  for (const name of A.order) {
    const ba = A.bones[name]; if (!ba) continue;
    const hr = mkRow('bone' + (S.selected === name ? ' selected' : ''));
    Object.assign(hr, { kind: 'bone', bone: name });
    hr.el.dataset.bone = name;
    const chain = ba.withChildren ? ' <span class="mini tag" title="Multiplies into every descendant bone">⛓ children</span>' : '';
    hr.h.innerHTML = `<button type="button" class="mini" data-act="fold" aria-expanded="${!ba.collapsed}" title="Show / hide tracks">${ba.collapsed ? '▸' : '▾'}</button><span class="name" title="Select in the viewport · right-click for options"></span>${chain}<button type="button" class="mini" data-act="del" title="Remove this bone from the timeline">×</button>`;
    hr.h.querySelector('.name').textContent = name;
    hr.h.querySelector('[data-act="fold"]').onclick = () => { ba.collapsed = !ba.collapsed; rebuildRows(); save(); };
    hr.h.querySelector('[data-act="del"]').onclick = () => removeBone(name);
    hr.h.querySelector('.name').onclick = () => selectBone(name);
    hr.h.oncontextmenu = (e) => { e.preventDefault(); openBoneMenu(e, name); };
    hr.lane.innerHTML = '<div class="summary"></div>'; hr.lane.firstChild.textContent = boneSummary(ba);
    tracksEl.append(hr.el); rows.push(hr);
    if (ba.collapsed) continue;
    const lab = axisInfo[name] || {}, sw = ba.show || { whole: true }, own = { type: 'bone', name };
    const k = (s) => `b|${name}|${s}`;
    if (sw.whole) addTrackRow(k('whole'), SPEC.whole, () => ba.whole, (p) => { ba.whole = p; }, 'Whole bone <i>weight</i>', own);
    for (const a of AXES) if (sw['w' + a]) addTrackRow(k('w' + a), SPEC.w, () => ba.w[a], (p) => { ba.w[a] = p; }, `<b class="axl" style="color:${AXIS_COL[a]}">${a.toUpperCase()}</b> weight <i>${lab[a] ? lab[a].short : ''}</i>`, { ...own, axis: a });
    for (const a of AXES) if (sw['a' + a]) addTrackRow(k('a' + a), SPEC.a, () => ba.a[a], (p) => { ba.a[a] = p; }, `<b class="axl" style="color:${AXIS_COL[a]}">${a.toUpperCase()}</b> adjust <i>${lab[a] ? lab[a].short : ''}</i>`, { ...own, axis: a });
    if (sw.timing) addTrackRow(k('timing'), SPEC.timing, () => ba.timing, (p) => { ba.timing = p; }, 'Timing offset <i>phase %</i>', own);
  }
  // IK effectors
  for (const id of A.ikOrder) {
    const e = A.ik[id], d = EFF_BY_ID[id]; if (!e || !d) continue;
    const hr = mkRow('bone eff' + (S.selEff === id ? ' selected' : ''));
    Object.assign(hr, { kind: 'eff', eff: id });
    hr.el.dataset.eff = id;
    hr.h.innerHTML = `<button type="button" class="mini" data-act="fold" aria-expanded="${!e.collapsed}" title="Show / hide tracks">${e.collapsed ? '▸' : '▾'}</button><span class="iktag">IK</span><span class="name" title="Select in the viewport · right-click for options"></span><button type="button" class="mini" data-act="del" title="Remove this effector from the timeline">×</button>`;
    hr.h.querySelector('.name').textContent = d.label;
    hr.h.querySelector('[data-act="fold"]').onclick = () => { e.collapsed = !e.collapsed; rebuildRows(); save(); };
    hr.h.querySelector('[data-act="del"]').onclick = () => removeEff(id);
    hr.h.querySelector('.name').onclick = () => selectEff(id);
    hr.h.oncontextmenu = (ev) => { ev.preventDefault(); openEffMenu(ev, id); };
    hr.lane.innerHTML = '<div class="summary"></div>'; hr.lane.firstChild.textContent = effSummary(id);
    tracksEl.append(hr.el); rows.push(hr);
    if (e.collapsed) continue;
    for (const k of d.tracks) {
      if (!e.show[k]) continue;
      const T = TRK[k], axl = T.axis ? `<b class="axl" style="color:${AXIS_COL[T.axis]}">${T.axis.toUpperCase()}</b> ` : '';
      const info = T.kind ? worldAxisInfo(T.kind)[T.axis].short : (T.hint || '');
      addTrackRow(`e|${id}|${k}`, effSpec(k), () => e.tr[k], (p) => { e.tr[k] = p; }, `${axl}${T.kind ? (T.kind === 'p' ? 'Move' : 'Rotate') : T.label} <i>${info}</i>`, { type: 'eff', id, k });
    }
  }
  if (!A.order.length && !A.ikOrder.length) {
    const e = document.createElement('div'); e.className = 'empty';
    e.innerHTML = '<b>FK:</b> "Add bone…" (or click a joint) — <b>weight</b> 0–200 % of the clip, <b>adjust</b> in degrees about each axis (the axis names say what each one does), <b>timing offset</b>. ' +
      '<b>IK:</b> "Add IK…" (or click a round IK handle) — move / rotate hips, chest, head, shoulders, hands, feet; swivel elbows and knees; curl fingers; pin, hold and pull. ' +
      'In a lane: click to add a point, drag it, drag the small ring between two points to bend the curve, double-click a point to type its value, right-click a point to delete it. Drag a track\'s bottom edge to make it taller; Ctrl / Alt + wheel zooms its values. Hold Ctrl while dragging to snap. Shift-drag box-selects; Ctrl+Z / Y undo / redo.';
    tracksEl.append(e);
  }
  if (window.__slRebuildTree) window.__slRebuildTree();
  layoutLanes();
}
function boneSummary(ba) {
  const parts = [];
  if (!isFlat(ba.whole, 1)) parts.push('whole');
  for (const a of AXES) { if (!isFlat(ba.w[a], 1)) parts.push(a.toUpperCase() + ' weight'); if (!isFlat(ba.a[a], 0)) parts.push(a.toUpperCase() + ' adjust'); }
  if (!isFlat(ba.timing, 0)) parts.push('timing');
  if (ba.withChildren) parts.push('children ×');
  return parts.length ? 'Automated: ' + parts.join(', ') : 'No automation yet (clip as it is)';
}
function effSummary(id) {
  const e = A.ik[id], d = EFF_BY_ID[id];
  const parts = d.tracks.filter((k) => !isFlat(e.tr[k], TRK[k].ref)).map((k) => TRK[k].kind ? `${TRK[k].kind === 'p' ? 'move' : 'rotate'} ${TRK[k].axis.toUpperCase()}` : TRK[k].label.toLowerCase());
  return parts.length ? 'IK: ' + parts.join(', ') : 'IK on, no offsets yet (follows the clip)';
}
function refreshSummary(r) {
  if (!r.owner) return;
  const hr = r.owner.type === 'bone' ? rows.find((x) => x.kind === 'bone' && x.bone === r.owner.name) : rows.find((x) => x.kind === 'eff' && x.eff === r.owner.id);
  if (hr && hr.lane.firstChild) hr.lane.firstChild.textContent = r.owner.type === 'bone' ? boneSummary(A.bones[r.owner.name]) : effSummary(r.owner.id);
}
function lane(r) {
  const cv = document.createElement('canvas'); r.cv = cv; r.lane.append(cv);
  cv.addEventListener('pointerdown', (e) => onLaneDown(e, r));
  cv.addEventListener('pointermove', (e) => onLaneHover(e, r));
  cv.addEventListener('pointerleave', () => { if (!drag && !boxSel) tip(null); });
  cv.addEventListener('contextmenu', (e) => {
    e.preventDefault(); const hit = hitPoint(r, e);
    if (hit != null) { pushUndo(); deletePoint(r, hit); } else openLaneMenu(e, r);
  });
  cv.addEventListener('dblclick', (e) => { const hit = hitPoint(r, e); if (hit != null) openNumEdit(r, hit, e); });
  cv.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.altKey || e.metaKey)) return;
    e.preventDefault();
    const [, py] = evXY(r, e), v = vOfRaw(r, py), [lo, hi] = viewOf(r), k = Math.exp(clamp(e.deltaY, -200, 200) * 0.0025);
    setZoom(r, [v - (v - lo) * k, v + (hi - v) * k]);
  }, { passive: false });
}
function setZoom(r, z) {
  const [lo, hi] = r.range, span = hi - lo;
  let [a, b] = z;
  if (b - a < span * 0.002) { const m = (a + b) / 2; a = m - span * 0.001; b = m + span * 0.001; }
  if (b - a >= span * 0.999) { delete A.zoom[r.key]; } else {
    if (a < lo) { b += lo - a; a = lo; } if (b > hi) { a -= b - hi; b = hi; }
    A.zoom[r.key] = [Math.max(lo, a), Math.min(hi, b)];
  }
  drawLane(r); save();
}
function zoomToFit(r) {
  const pts = r.get(); let lo = Math.min(r.ref, ...pts.map((p) => p.v)), hi = Math.max(r.ref, ...pts.map((p) => p.v));
  const pad = Math.max((hi - lo) * 0.15, (r.range[1] - r.range[0]) * 0.01); setZoom(r, [lo - pad, hi + pad]);
}
function layoutLane(r) {
  if (!r.cv) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = r.lane.clientWidth || 300, h = Math.max(10, rowHeight(r) - 1);
  r.cv.width = Math.round(w * dpr); r.cv.height = Math.round(h * dpr); r.cv.style.width = w + 'px'; r.cv.style.height = h + 'px';
  drawLane(r);
}
function layoutLanes() { for (const r of rows) layoutLane(r); drawRuler(); placePlayhead(); }
// geometry
const viewOf = (r) => A.zoom[r.key] || r.range;
const dprOf = (r) => r.cv.width / Math.max(1, r.cv.clientWidth || r.lane.clientWidth || 1);
function xOf(r, t) { return (t / S.dur) * r.cv.width; }
function tOf(r, x) { return clamp((x / r.cv.width) * S.dur, 0, S.dur); }
function yOf(r, v) { const [lo, hi] = viewOf(r), h = r.cv.height, p = PAD * dprOf(r); return p + (1 - (v - lo) / (hi - lo)) * (h - 2 * p); }
function vOfRaw(r, y) { const [lo, hi] = viewOf(r), h = r.cv.height, p = PAD * dprOf(r); return lo + (1 - (y - p) / (h - 2 * p)) * (hi - lo); }
function vOf(r, y) { return clamp(vOfRaw(r, y), r.range[0], r.range[1]); }
function niceStep(span, n) { const raw = span / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; }
function drawLane(r) {
  const cv = r.cv, x = cv.getContext('2d'), w = cv.width, h = cv.height, dpr = dprOf(r), pts = r.get();
  x.clearRect(0, 0, w, h);
  x.fillStyle = rows.indexOf(r) % 2 ? '#1b201d' : '#1f2522'; x.fillRect(0, 0, w, h);
  // time grid: 0.1 s faint, 0.5 s, 1 s
  for (let t = 0; t <= S.dur + 1e-6; t += 0.1) { const gx = Math.round(xOf(r, t)) + 0.5; const s = Math.round(t * 10); x.fillStyle = s % 10 === 0 ? '#34403a' : s % 5 === 0 ? '#2b3430' : '#232a26'; if (w / S.dur * 0.1 > 4 * dpr || s % 5 === 0) x.fillRect(gx, 0, 1, h); }
  // value grid with labels once the track is tall enough
  const [lo, hi] = viewOf(r), cssH = h / dpr;
  if (cssH >= 56) {
    const st = niceStep((hi - lo) * r.scale, cssH / 26) / r.scale;
    x.font = `500 ${10 * dpr}px "IBM Plex Mono", monospace`; x.textBaseline = 'middle';
    for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) {
      const gy = Math.round(yOf(r, v)) + 0.5; x.fillStyle = '#29322d'; x.fillRect(0, gy, w, 1);
      x.fillStyle = '#6d7872'; x.fillText(+(v * r.scale).toFixed(4) + '', 4 * dpr, gy - 6 * dpr);
    }
  }
  const zoomed = !!A.zoom[r.key];
  // reference line (100 % / 0°)
  x.setLineDash([4 * dpr, 4 * dpr]); x.strokeStyle = '#46534c'; x.lineWidth = dpr; x.beginPath(); const ry = clamp(yOf(r, r.ref), -2, h + 2); x.moveTo(0, ry); x.lineTo(w, ry); x.stroke(); x.setLineDash([]);
  // curve + fill toward the reference
  x.save(); x.beginPath(); x.rect(0, 0, w, h); x.clip();
  x.beginPath();
  for (let px = 0; px <= w; px += 2) { const y = yOf(r, evalPts(pts, tOf(r, px))); px ? x.lineTo(px, y) : x.moveTo(px, y); }
  x.strokeStyle = r.color; x.lineWidth = 1.6 * dpr; x.stroke();
  x.lineTo(w, ry); x.lineTo(0, ry); x.closePath(); x.globalAlpha = 0.16; x.fillStyle = r.color; x.fill(); x.globalAlpha = 1;
  // tension rings, then points
  for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; if (b.t - a.t < 1e-3 || (Math.abs(b.v - a.v) < 1e-6 && Math.abs(a.k) < 1e-3)) continue; const tm = (a.t + b.t) / 2; x.beginPath(); x.arc(xOf(r, tm), yOf(r, evalPts(pts, tm)), 3 * dpr, 0, Math.PI * 2); x.strokeStyle = r.color; x.lineWidth = dpr; x.stroke(); }
  for (const p of pts) { x.beginPath(); x.arc(xOf(r, p.t), yOf(r, p.v), 4 * dpr, 0, Math.PI * 2); x.fillStyle = '#111513'; x.fill(); x.strokeStyle = r.color; x.lineWidth = 1.6 * dpr; x.stroke(); }
  // selection ring + box-select rectangle
  if (r === selRow && selPts.size) for (const i of selPts) { const p = pts[i]; if (!p) continue; x.beginPath(); x.arc(xOf(r, p.t), yOf(r, p.v), 6.5 * dpr, 0, Math.PI * 2); x.strokeStyle = '#ffffff'; x.lineWidth = dpr; x.stroke(); }
  x.restore();
  if (boxSel && boxSel.r === r) { x.save(); x.strokeStyle = 'rgba(255,255,255,.55)'; x.setLineDash([3 * dpr, 3 * dpr]); x.strokeRect(Math.min(boxSel.x0, boxSel.x1), Math.min(boxSel.y0, boxSel.y1), Math.abs(boxSel.x1 - boxSel.x0), Math.abs(boxSel.y1 - boxSel.y0)); x.restore(); }
  if (zoomed) { x.font = `600 ${10 * dpr}px "Barlow", sans-serif`; x.textBaseline = 'top'; x.textAlign = 'right'; x.fillStyle = 'rgba(240,138,28,.8)'; x.fillText(`zoom ${+(lo * r.scale).toFixed(2)}…${+(hi * r.scale).toFixed(2)}`, w - 4 * dpr, 3 * dpr); x.textAlign = 'left'; }
}
function evXY(r, e) { const b = r.cv.getBoundingClientRect(), k = r.cv.width / b.width; return [(e.clientX - b.left) * k, (e.clientY - b.top) * k, k]; }
function hitPoint(r, e) { const [px, py, k] = evXY(r, e), pts = r.get(); let best = null, bd = 8 * k; pts.forEach((p, i) => { const d = Math.hypot(xOf(r, p.t) - px, yOf(r, p.v) - py); if (d < bd) { bd = d; best = i; } }); return best; }
function hitRing(r, e) { const [px, py, k] = evXY(r, e), pts = r.get(); for (let i = 0; i < pts.length - 1; i++) { const tm = (pts[i].t + pts[i + 1].t) / 2; if (Math.hypot(xOf(r, tm) - px, yOf(r, evalPts(pts, tm)) - py) < 7 * k) return i; } return null; }
function deletePoint(r, i) { const pts = r.get(); if (pts.length <= 1) return; pts.splice(i, 1); edited(r); }
let drag = null, boxSel = null, selRow = null, selPts = new Set();
function onLaneDown(e, r) {
  if (e.button !== 0) return;
  e.preventDefault(); r.cv.setPointerCapture(e.pointerId);
  closeNumEdit();
  if (r !== selRow) { const old = selRow; selPts = new Set(); selRow = r; if (old && old.cv) drawLane(old); }
  if (e.shiftKey) { const [px, py] = evXY(r, e); boxSel = { r, x0: px, y0: py, x1: px, y1: py }; return; }
  const pts = r.get(); let i = hitPoint(r, e);
  if (i == null) { const ri = hitRing(r, e); if (ri != null) { pushUndo(); drag = { r, ring: ri, y0: e.clientY, k0: pts[ri].k }; return; } }
  if (i == null) {   // new point at the clicked time and value
    pushUndo();
    const [px, py] = evXY(r, e), t = tOf(r, px);
    const p = { t, v: vOf(r, py), k: 0 }; let at = pts.findIndex((q) => q.t > t); if (at < 0) at = pts.length;
    pts.splice(at, 0, p); i = at; edited(r);
  } else { pushUndo(); }
  drag = { r, i };
  onDrag(e);
}
function onDrag(e) {
  if (!drag) return;
  const r = drag.r, pts = r.get();
  if (drag.ring != null) {
    const a = pts[drag.ring], b = pts[drag.ring + 1], dir = Math.sign(b.v - a.v) || 1;
    a.k = clamp(drag.k0 + dir * (e.clientY - drag.y0) / 60, -1, 1);
    edited(r, true); tip(e, `curve ${a.k.toFixed(2)}`); return;
  }
  const [px, py] = evXY(r, e), p = pts[drag.i];
  let t = tOf(r, px), v = vOf(r, py);
  if (e.ctrlKey || e.metaKey) { t = Math.round(t * 20) / 20; v = Math.round(v / r.snap) * r.snap; }
  if (r.flag) v = v >= 0.5 ? 1 : 0;
  const lo = drag.i > 0 ? pts[drag.i - 1].t : 0, hi = drag.i < pts.length - 1 ? pts[drag.i + 1].t : S.dur;
  p.t = clamp(t, lo, hi); p.v = clamp(v, r.range[0], r.range[1]);
  edited(r, true); tip(e, `${p.t.toFixed(3)} s · ${r.fmt(p.v)}`);
}
function finalizeBoxSelect() {
  const { r, x0, y0, x1, y1 } = boxSel;
  const t0 = tOf(r, Math.min(x0, x1)), t1 = tOf(r, Math.max(x0, x1));
  const v0 = vOfRaw(r, Math.max(y0, y1)), v1 = vOfRaw(r, Math.min(y0, y1));
  const pts = r.get(); selPts = new Set(); pts.forEach((p, i) => { if (p.t >= t0 - 1e-6 && p.t <= t1 + 1e-6 && p.v >= v0 - 1e-6 && p.v <= v1 + 1e-6) selPts.add(i); });
  selRow = r; drawLane(r);
}
window.addEventListener('pointermove', (e) => {
  if (drag) onDrag(e);
  if (boxSel) { const [px, py] = evXY(boxSel.r, e); boxSel.x1 = px; boxSel.y1 = py; drawLane(boxSel.r); }
  if (rowDrag) setRowHeight(rowDrag.r, rowDrag.h0 + (e.clientY - rowDrag.y0), false);
  if (rulerDrag) scrub(e); if (gripDrag) resizeTimeline(e);
});
window.addEventListener('pointerup', () => {
  if (drag) { const r = drag.r; drag = null; tip(null); edited(r); }
  if (boxSel) { finalizeBoxSelect(); boxSel = null; }
  if (rowDrag) { rowDrag = null; save(); }
  rulerDrag = false; gripDrag = false;
});
function onLaneHover(e, r) {
  if (drag || boxSel) return;
  const [px] = evXY(r, e), t = tOf(r, px), hit = hitPoint(r, e) != null || hitRing(r, e) != null;
  r.cv.style.cursor = hit ? 'grab' : 'crosshair';
  tip(e, `${t.toFixed(2)} s · ${r.fmt(evalPts(r.get(), t))}`);
}
function edited(r, live = false) {
  drawLane(r);
  if (r.key === 'speed') rebuildSpeedLUT();
  refreshSummary(r);
  editVersion++; trailDirty = true;
  if (!live) save();
}
function tip(e, text) { const el = $('tip'); if (!e) { el.hidden = true; return; } el.textContent = text; el.hidden = false; el.style.left = Math.min(e.clientX + 14, window.innerWidth - 180) + 'px'; el.style.top = e.clientY - 26 + 'px'; }

// ---------------------------------------------------------------- exact values
let numTarget = null;
function openNumEdit(r, i, e) {
  const box = $('numEdit'), pts = r.get(), p = i != null ? pts[i] : null;
  numTarget = { r, i };
  $('numT').value = (p ? p.t : S.t).toFixed(3);
  $('numV').value = +((p ? p.v : evalPts(pts, S.t)) * r.scale).toFixed(3);
  $('numV').step = r.flag ? 1 : r.snap * r.scale;
  $('numVL').textContent = r.unit;
  box.hidden = false;
  const bw = box.offsetWidth || 260;
  box.style.left = clamp(e.clientX - bw / 2, 8, window.innerWidth - bw - 8) + 'px';
  box.style.top = clamp(e.clientY - 70, 8, window.innerHeight - 60) + 'px';
  $('numV').focus(); $('numV').select();
}
function closeNumEdit() { $('numEdit').hidden = true; numTarget = null; }
function applyNumEdit() {
  if (!numTarget) return;
  const { r, i } = numTarget, pts = r.get();
  const t = clamp(parseFloat($('numT').value), 0, S.dur), raw = parseFloat($('numV').value);
  if (!isFinite(t) || !isFinite(raw)) { closeNumEdit(); return; }
  let v = clamp(raw / r.scale, r.range[0], r.range[1]); if (r.flag) v = v >= 0.5 ? 1 : 0;
  pushUndo();
  if (i != null && pts[i]) { const p = pts.splice(i, 1)[0]; p.v = v; p.t = t; let at = pts.findIndex((q) => q.t > t); if (at < 0) at = pts.length; pts.splice(at, 0, p); }
  else keyAt(pts, t, v);
  closeNumEdit(); edited(r);
}
$('numOk').onclick = applyNumEdit;
$('numEdit').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyNumEdit(); } if (e.key === 'Escape') closeNumEdit(); e.stopPropagation(); });
document.addEventListener('pointerdown', (e) => { if (!$('numEdit').hidden && !$('numEdit').contains(e.target) && !(e.target.classList && e.target.classList.contains('val'))) closeNumEdit(); });

// ---------------------------------------------------------------- context menus
const menuEl = document.createElement('div'); menuEl.id = 'ctxMenu'; menuEl.hidden = true; document.body.append(menuEl);
document.addEventListener('pointerdown', (e) => { if (!menuEl.hidden && !menuEl.contains(e.target)) menuEl.hidden = true; });
window.addEventListener('blur', () => { menuEl.hidden = true; });
function openMenu(x, y, items) {
  menuEl.textContent = '';
  for (const it of items) {
    if (it.sep) { const hr = document.createElement('div'); hr.className = 'ctxsep'; menuEl.append(hr); continue; }
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ctxitem';
    b.textContent = (it.checked != null ? (it.checked ? '☑ ' : '☐ ') : '') + it.label;
    if (it.disabled) b.disabled = true;
    b.onclick = () => { menuEl.hidden = true; if (it.action) it.action(); };
    menuEl.append(b);
  }
  menuEl.hidden = false;
  const vw = window.innerWidth, vh = window.innerHeight, mh = menuEl.offsetHeight || 200;
  menuEl.style.left = Math.min(x, vw - 220) + 'px'; menuEl.style.top = Math.max(8, Math.min(y, vh - mh - 8)) + 'px';
}
function openBoneMenu(e, name) {
  const ba = A.bones[name]; if (!ba) return;
  const mirror = mirrorName(name);
  openMenu(e.clientX, e.clientY, [
    { label: 'Show / hide tracks…', action: () => openAddDialog({ type: 'bone', name }, ba.show) },
    { label: 'Multiply into children', checked: !!ba.withChildren, action: () => { pushUndo(); ba.withChildren = !ba.withChildren; rebuildRows(); save(); } },
    { sep: true },
    { label: 'Reset bone', action: () => { pushUndo(); const show = ba.show; A.bones[name] = newBoneAuto(S.dur); A.bones[name].show = show; rebuildRows(); save(); } },
    { label: 'Copy bone', action: () => { clipboard = { type: 'bone', data: JSON.parse(JSON.stringify(ba)) }; } },
    { label: 'Paste bone', disabled: !(clipboard && clipboard.type === 'bone'), action: () => { pushUndo(); const show = ba.show; A.bones[name] = JSON.parse(JSON.stringify(clipboard.data)); A.bones[name].show = show; rebuildRows(); save(); } },
    { label: mirror ? ('Mirror → ' + mirror) : 'Mirror (no L/R pair)', disabled: !mirror, action: () => mirrorPair(name) },
    { sep: true },
    { label: 'Remove bone', action: () => removeBone(name) },
  ]);
}
function mirrorEffId(id) { return id[0] === 'L' ? 'R' + id.slice(1) : id[0] === 'R' ? 'L' + id.slice(1) : null; }
function mirrorEff(id) {
  const to = mirrorEffId(id), src = A.ik[id]; if (!to || !src) return;
  pushUndo();
  const dst = ensureEff(to);
  for (const k of EFF_BY_ID[id].tracks) {
    // across the body's mid-plane: sideways moves and turns / rolls change sign
    const flip = k === 'px' || k === 'ry' || k === 'rz' || k === 'swivel' ? -1 : 1;
    dst.tr[k] = clonePts(src.tr[k], flip);
  }
  dst.show = { ...src.show };
  rebuildRows(); save();
}
function openEffMenu(e, id) {
  const ef = A.ik[id]; if (!ef) return;
  const to = mirrorEffId(id);
  openMenu(e.clientX, e.clientY, [
    { label: 'Show / hide tracks…', action: () => openAddDialog({ type: 'eff', id }, ef.show) },
    { sep: true },
    { label: 'Reset effector', action: () => { pushUndo(); const show = ef.show; A.ik[id] = newEffAuto(id, S.dur); A.ik[id].show = show; rebuildRows(); save(); } },
    { label: 'Copy effector', action: () => { clipboard = { type: 'eff', kind: EFF_BY_ID[id].kind, data: JSON.parse(JSON.stringify(ef)) }; } },
    { label: 'Paste effector', disabled: !(clipboard && clipboard.type === 'eff' && clipboard.kind === EFF_BY_ID[id].kind), action: () => { pushUndo(); const show = ef.show; A.ik[id] = JSON.parse(JSON.stringify(clipboard.data)); A.ik[id].show = show; rebuildRows(); save(); } },
    { label: to ? 'Mirror → ' + EFF_BY_ID[to].label : 'Mirror (no L/R pair)', disabled: !to, action: () => mirrorEff(id) },
    { sep: true },
    { label: 'Remove effector', action: () => removeEff(id) },
  ]);
}
function openLaneMenu(e, r) {
  const pts = r.get(), h = rowHeight(r);
  openMenu(e.clientX, e.clientY, [
    { label: 'Add point at playhead…', action: () => openNumEdit(r, null, e) },
    { label: 'Select all points', action: () => { selRow = r; selPts = new Set(pts.map((_, i) => i)); drawLane(r); } },
    { label: 'Copy track', action: () => { clipboard = { type: 'track', data: JSON.parse(JSON.stringify(pts)) }; } },
    { label: 'Paste track', disabled: !(clipboard && clipboard.type === 'track'), action: () => { pushUndo(); r.set(JSON.parse(JSON.stringify(clipboard.data)).map((p) => ({ ...p, v: clamp(p.v, r.range[0], r.range[1]) }))); edited(r); } },
    { sep: true },
    { label: 'Zoom values to fit', action: () => zoomToFit(r) },
    { label: 'Reset value zoom', disabled: !A.zoom[r.key], action: () => setZoom(r, r.range) },
    ...HEIGHT_PRESETS.map(([n, v]) => ({ label: 'Height: ' + n, checked: h === v, action: () => setRowHeight(r, v, true) })),
    { sep: true },
    { label: 'Reset track', action: () => { pushUndo(); r.set(flat(r.ref, S.dur)); edited(r); } },
  ]);
}

// ---------------------------------------------------------------- selection actions (keyboard)
function copySelection() { if (!selRow || !selPts.size) return; const pts = selRow.get(); clipboard = { type: 'points', data: [...selPts].sort((a, b) => a - b).map((i) => ({ ...pts[i] })) }; }
function pasteSelection() {
  if (!selRow || !clipboard || clipboard.type !== 'points') return;
  pushUndo();
  const pts = selRow.get(), t0 = clipboard.data[0].t, base = S.t;
  for (const p of clipboard.data) { const np = { t: clamp(base + (p.t - t0), 0, S.dur), v: clamp(p.v, selRow.range[0], selRow.range[1]), k: p.k }; let at = pts.findIndex((q) => q.t > np.t); if (at < 0) at = pts.length; pts.splice(at, 0, np); }
  selPts = new Set(); edited(selRow);
}
function deleteSelection() {
  if (!selRow || !selPts.size) return;
  const pts = selRow.get(); if (pts.length - selPts.size < 1) return;
  pushUndo();
  const keep = pts.filter((_, i) => !selPts.has(i));
  selRow.set(keep.length ? keep : flat(selRow.ref, S.dur));
  selPts = new Set(); edited(selRow);
}
function nudgeSelection(key, big) {
  if (!selRow || !selPts.size) return;
  pushUndo();
  const pts = selRow.get(), [lo, hi] = selRow.range;
  const dt = (big ? 0.1 : 0.01) * (key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0);
  const dv = (big ? 10 : 1) * selRow.snap * (key === 'ArrowUp' ? 1 : key === 'ArrowDown' ? -1 : 0);
  const moved = [...selPts].map((i) => pts[i]).filter(Boolean);
  for (const p of moved) { p.t = clamp(p.t + dt, 0, S.dur); p.v = clamp(p.v + dv, lo, hi); }
  pts.sort((a, b) => a.t - b.t); selPts = new Set(moved.map((p) => pts.indexOf(p))); edited(selRow);
}
function selectAllInFocusedLane() { if (!selRow) return; selPts = new Set(selRow.get().map((_, i) => i)); drawLane(selRow); }
function dialogsOpen() { return !$('sheet').hidden || !$('addDlg').hidden || !$('boneDlg').hidden; }
window.addEventListener('keydown', (e) => {
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName) || dialogsOpen()) {
    if (e.key === 'Escape') { $('sheet').hidden = true; $('addDlg').hidden = true; $('boneDlg').hidden = true; }
    return;
  }
  if (e.code === 'Space') { e.preventDefault(); $('btnPlay').click(); return; }
  if (e.code === 'Home') { goHome(); return; }
  const meta = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (meta && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if (meta && ((k === 'z' && e.shiftKey) || k === 'y')) { e.preventDefault(); redo(); return; }
  if (meta && k === 'c') { e.preventDefault(); copySelection(); return; }
  if (meta && k === 'v') { e.preventDefault(); pasteSelection(); return; }
  if (meta && k === 'a') { e.preventDefault(); selectAllInFocusedLane(); return; }
  if (meta) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
  if (e.key.startsWith('Arrow')) { e.preventDefault(); nudgeSelection(e.key, e.shiftKey); return; }
  if (k === 'r') { setGizmoMode('rotate'); return; }
  if (k === 'w') { setGizmoMode('move'); return; }
  if (k === 'f') { frameCamera(false); return; }
  if (k === 'k') { keyPending(); return; }
  if (e.key === 'Escape') { if (pending) cancelPending(); else clearSelection(); }
});

// ruler + playhead
const ruler = $('ruler'); let rulerDrag = false;
function timeOfClipTime(ct) {
  const lut = S.speedLUT; if (!lut || lut.length < 2) return 0;
  if (ct <= lut[0]) return 0; if (ct >= lut[lut.length - 1]) return S.dur;
  let lo = 0, hi = lut.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (lut[mid] < ct) lo = mid; else hi = mid; }
  const t0 = lo / (lut.length - 1) * S.dur, t1 = hi / (lut.length - 1) * S.dur;
  const f = (ct - lut[lo]) / Math.max(1e-9, lut[hi] - lut[lo]);
  return t0 + (t1 - t0) * f;
}
function drawFootMarks(x, W, H, dpr) {
  if (!cur || !S.speedLUT || !S.speedLUT.length) return;
  const totalCt = S.speedLUT[S.speedLUT.length - 1];
  try {
    const marks = [];
    if (cur.kind === 'loop' && cur.c.win) {
      for (const Sd of ['L', 'R']) {
        const w0 = cur.c.win[Sd][0];
        for (let n = 0; n < 200; n++) { const ct = n * cur.dur + w0 * cur.dur; if (ct > totalCt + 1e-6) break; marks.push([timeOfClipTime(ct), Sd]); }
      }
    } else if (cur.kind === 'move') {
      const fps = (gl && gl.fps) || 30, con = { L: cur.c.cL, R: cur.c.cR };
      for (const Sd of ['L', 'R']) { const arr = con[Sd]; if (!arr) continue; for (let i = 1; i < arr.length; i++) if (arr[i] && !arr[i - 1]) marks.push([timeOfClipTime(i / fps), Sd]); }
    }
    for (const [t, Sd] of marks) {
      const px = Math.round((t / S.dur) * (W - 1));
      x.fillStyle = Sd === 'L' ? COL.timing : '#ff8a4a';
      x.beginPath(); x.moveTo(px - 3 * dpr, H - 2); x.lineTo(px + 3 * dpr, H - 2); x.lineTo(px, H - 2 - 6 * dpr); x.closePath(); x.fill();
    }
  } catch { /* clip missing contact data: skip the markers */ }
}
function drawRuler() {
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = ruler.clientWidth || 300; ruler.width = Math.round(w * dpr); ruler.height = Math.round(34 * dpr);
  const x = ruler.getContext('2d'), W = ruler.width, H = ruler.height;
  x.fillStyle = '#181d1a'; x.fillRect(0, 0, W, H);
  x.font = `500 ${11 * dpr}px "IBM Plex Mono", monospace`; x.textBaseline = 'top';
  const step = S.dur > 20 ? 5 : S.dur > 8 ? 1 : 0.5;
  for (let t = 0; t <= S.dur + 1e-6; t += 0.1) {
    const px = Math.round((t / S.dur) * (W - 1)) + 0.5, major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
    if (!major && W / S.dur * 0.1 < 4 * dpr) continue;
    x.fillStyle = major ? '#7d8882' : '#3a443f'; x.fillRect(px, major ? H * 0.45 : H * 0.7, 1, H);
    if (major && t < S.dur - 1e-6) { x.fillStyle = '#b4bdb7'; x.fillText(t.toFixed(step < 1 ? 1 : 0) + 's', px + 4 * dpr, 5 * dpr); }
  }
  // clip cycle marks (where one loop / move of the clip ends, at the current speeds)
  if (cur && S.speedLUT) { x.fillStyle = 'rgba(240,138,28,.55)'; let n = 1; const lut = S.speedLUT; for (let i = 1; i < lut.length; i++) { if (lut[i] >= n * cur.dur) { x.fillRect(Math.round((i / (lut.length - 1)) * (W - 1)), H - 6 * dpr, 2, 6 * dpr); n++; } } }
  drawFootMarks(x, W, H, dpr);
}
function scrub(e) { const b = ruler.getBoundingClientRect(); S.t = clamp((e.clientX - b.left) / b.width, 0, 1) * S.dur; }
ruler.addEventListener('pointerdown', (e) => { rulerDrag = true; ruler.setPointerCapture(e.pointerId); scrub(e); });
function placePlayhead() {
  const tl = document.querySelector('.tl').getBoundingClientRect(), rb = ruler.getBoundingClientRect();
  playhead.style.left = (rb.left - tl.left + (S.t / S.dur) * rb.width - 1) + 'px';
}
// resizable timeline
const grip = $('grip'); let gripDrag = false;
grip.addEventListener('pointerdown', (e) => { gripDrag = true; grip.setPointerCapture(e.pointerId); });
function resizeTimeline(e) { const h = clamp(window.innerHeight - e.clientY - 3, 120, window.innerHeight - 220); $('app').style.setProperty('--tl-h', h + 'px'); resize(); }
grip.addEventListener('keydown', (e) => { const cs = parseFloat(getComputedStyle(document.querySelector('.tl')).height); if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); $('app').style.setProperty('--tl-h', clamp(cs + (e.key === 'ArrowUp' ? 30 : -30), 120, window.innerHeight - 220) + 'px'); resize(); } });
