
// ============================================================================
//  CURVE PRESETS · BAR COPY / PASTE · TIMELINE FBX EXPORT · SPEED READOUT + GRAPH
// ============================================================================

// ---------------------------------------------------------------- curve presets (the segment from a point to the next)
// a point carries k (bend: + eases in, − eases out) and e ('step' holds until the next point, 'inout' is an S curve)
const CURVES = [   // [label, k, e, what the ring does]
  ['Single curve', 0, null, 'bend'], ['Ease in', 0.45, null, 'bend'], ['Ease out', -0.45, null, 'bend'],
  ['Double curve (S)', 0, 'inout', 'sharpness'], ['Hold', 0, 'step', null], ['Stairs', 0, 'stairs', 'steps'], ['Smooth stairs', 0, 'sstairs', 'steps'],
  ['Pulse', 0, 'pulse', 'pulses'], ['Wave', -0.5, 'wave', 'waves'], ['Arc (overshoot)', 0.3, 'arc', 'overshoot'], ['Smooth (spline)', 0, 'smooth', null]];
const CURVE_ICON = { 'Single curve': '╱', 'Ease in': '⌒', 'Ease out': '◞', 'Double curve (S)': '∫', Hold: '⌐', Stairs: '▟', 'Smooth stairs': '⩘', Pulse: '⊓', Wave: '∿', 'Arc (overshoot)': '⌒', 'Smooth (spline)': '〜' };
function curveOf(p) {
  const e = p.e || null, k = p.k || 0;
  if (!e) return Math.abs(k) < 1e-3 ? 'Single curve' : Math.abs(k - 0.45) < 1e-3 ? 'Ease in' : Math.abs(k + 0.45) < 1e-3 ? 'Ease out' : 'Single curve';
  const c = CURVES.find((q) => q[2] === e); return c ? c[0] : 'Single curve';
}
const curveRing = (e) => (CURVES.find((q) => q[2] === (e || null)) || CURVES[0])[3];
function curveRingTip(p) {   // what the ring drag shows
  const what = curveRing(p.e), k = p.k || 0;
  if (what === 'steps' || what === 'pulses' || what === 'waves') return `${curveCount(k)} ${what}`;
  if (what === 'overshoot') return `overshoot ${Math.round(k * 120)} %`;
  if (what === 'sharpness') return `S ${k >= 0 ? 'sharper' : 'softer'} ${k.toFixed(2)}`;
  return `curve ${k.toFixed(2)}`;
}
function curveItems(r, hit) {
  const pts = r.get(), targets = r === selRow && selPts.has(hit) && selPts.size > 1 ? [...selPts] : [hit];
  const last = pts.length - 1, now = curveOf(pts[hit]);
  return CURVES.map(([label, k, e]) => ({
    label: `${CURVE_ICON[label] || ''}  ${label}${targets.length > 1 ? ` (${targets.length} points)` : ''}`, checked: now === label, disabled: targets.every((i) => i >= last),
    action: () => { pushUndo(); for (const i of targets) { if (i >= last) continue; const p = pts[i]; const same = (p.e || null) === e && e; p.k = same ? p.k : k; if (e) p.e = e; else delete p.e; } edited(r); },
  }));
}

// ---------------------------------------------------------------- bar copy / paste
// Copies every track's points inside whole bars a…b (1-based, inclusive) by bar position, plus the values at the two
// edges (so the shape pastes whole); pastes them at another bar, replacing what is
// there or inserting new bars first. Tracks are matched by name, so a copy goes to another clip too.
let barClip = null;
function pointArrayMap(a) {   // stable name → point array, for every track in an automation object
  const m = { speed: a.speed, move: a.move, cyc: a.cyc, gnd: a.gnd, stride: a.stride, lean: a.lean, hipRot: a.hipRot, brake: a.brake, kneeDepth: a.kneeDepth, armSwing: a.armSwing, elbowBend: a.elbowBend, armCross: a.armCross, hipMotion: a.hipMotion, armCentre: a.armCentre, brakeRhythm: a.brakeRhythm, jump: a.jump, stepNat: a.stepNat, fwd: a.fwd, throttle: a.throttle };
  for (const b of a.blends || []) for (const k of BLEND_KEYS) m[`l|${b.id}|${k}`] = b[k];
  if (a.runMuted) for (const k of Object.keys(a.runMuted)) m[`rm|${k}`] = a.runMuted[k];
  for (const n of a.order) { const ba = a.bones[n]; if (!ba) continue; m[`b|${n}|whole`] = ba.whole; m[`b|${n}|timing`] = ba.timing; for (const x of AXES) { m[`b|${n}|w${x}`] = ba.w[x]; m[`b|${n}|a${x}`] = ba.a[x]; } }
  for (const g of a.groupOrder) { const gr = a.groups[g]; if (!gr) continue; m[`g|${g}|weight`] = gr.weight; m[`g|${g}|timing`] = gr.timing; }
  for (const id of a.ikOrder) { const e = a.ik[id]; if (!e) continue; for (const k in e.tr) m[`e|${id}|${k}`] = e.tr[k]; }
  for (const k of a.symOrder) { const sy = a.sym[k]; if (!sy) continue; m[`s|${k}|weight`] = sy.weight; m[`s|${k}|offset`] = sy.offset; }
  if (a.steady && a.steady.tr) for (const k of STD_KEYS) m[`q|${k}`] = a.steady.tr[k];
  for (const f of a.forcers || []) for (const k of RES_KEYS) m[`f|${f.id}|${k}`] = f[k];
  for (const k of Object.keys(m)) if (!m[k]) delete m[k];
  return m;
}
function copyBars(a, b) {
  if (!cur || !(cur.dur > 0)) return;
  const d = cur.dur, c0 = (a - 1) * d, c1 = b * d, tracks = {}, map = pointArrayMap(A);
  for (const [key, pts] of Object.entries(map)) {
    const t0 = timeOfClipTime(c0), t1 = timeOfClipTime(c1), inner = [];
    for (const p of pts) { if (p.t <= t0 + 1e-6 || p.t >= t1 - 1e-6) continue; inner.push({ b: (clipTime(p.t) - c0) / d, v: p.v, k: p.k || 0, e: p.e }); }
    const i0 = pts.findIndex((p) => p.t > t0 + 1e-6), before = pts[Math.max(0, i0 - 1)];
    tracks[key] = { v0: evalPts(pts, t0), k0: before && i0 > 0 ? before.k || 0 : 0, e0: before && i0 > 0 ? before.e : undefined, v1: evalPts(pts, t1), inner, flat: inner.length === 0 && Math.abs(evalPts(pts, t0) - evalPts(pts, t1)) < 1e-9 && pts.every((p) => Math.abs(p.v - pts[0].v) < 1e-9) };
  }
  barClip = { n: b - a + 1, from: a, tracks, clip: cur.name };
  toast(`Copied bar${barClip.n > 1 ? 's' : ''} ${a}${barClip.n > 1 ? '–' + b : ''} (${Object.values(tracks).filter((t) => !t.flat).length} tracks with changes).`);
}
function pasteBars(at, mode) {   // at: 1-based bar; mode 'replace' | 'insert'
  if (!barClip || !cur || !(cur.dur > 0)) return;
  const d = cur.dur, n = barClip.n;
  if (mode === 'insert') addBars(n, (at - 1) * d); else pushUndo();
  const total = totalClipTime();
  if ((at - 1 + n) * d > total + 1e-6) { toast(`Bars ${at}–${at + n - 1} run past the end: add bars first, or paste earlier.`); return; }
  const map = pointArrayMap(A), c0 = (at - 1) * d, c1 = c0 + n * d;
  const arrs = allPointArrays(), snap = snapClipTimes(arrs), idx = new Map(arrs.map((p, i) => [p, i]));
  let changed = 0;
  for (const [key, tr] of Object.entries(barClip.tracks)) {
    const pts = map[key]; if (!pts || tr.flat) continue;
    const i = idx.get(pts); if (i == null) continue;
    const sn = snap[i];
    for (let j = pts.length - 1; j >= 0; j--) if (sn[j] != null && sn[j] >= c0 - 1e-6 && sn[j] <= c1 + 1e-6 && j > 0) { pts.splice(j, 1); sn.splice(j, 1); }
    const add = (ct, p) => { let j = sn.findIndex((c) => c == null || c > ct); if (j < 0) j = pts.length; pts.splice(j, 0, p); sn.splice(j, 0, ct); };
    add(c0 + 1e-6, { t: 0, v: tr.v0, k: tr.k0, ...(tr.e0 ? { e: tr.e0 } : {}) });
    for (const q of tr.inner) add(c0 + q.b * d, { t: 0, v: q.v, k: q.k, ...(q.e ? { e: q.e } : {}) });
    add(c1 - 1e-6, { t: 0, v: tr.v1, k: 0 });
    changed++;
  }
  placeByClipTime(arrs, snap, S.dur); ensureEnds(); lockCycles(true);
  moveEndCache = null; editVersion++; trailDirty = true; gridCache = null; holdCache.clear();
  rebuildSpeedLUT(); layoutLanes(); save();
  toast(`Pasted ${n} bar${n > 1 ? 's' : ''} at bar ${at}${mode === 'insert' ? ' (inserted)' : ''}: ${changed} tracks.`);
}
function barClipItems(k) {
  const total = cur && cur.dur > 0 ? Math.round(totalClipTime() / cur.dur) : 1, at = clamp(k, 1, total);
  const items = [
    { label: `Copy bar ${at}`, action: () => copyBars(at, at) },
    { label: 'Copy bars…', action: () => openBarCopy(at) },
  ];
  if (barClip) items.push(
    { label: `Paste ${barClip.n} bar${barClip.n > 1 ? 's' : ''} at bar ${at} (replace)`, action: () => pasteBars(at, 'replace') },
    { label: `Paste ${barClip.n} bar${barClip.n > 1 ? 's' : ''} at bar ${at} (insert)`, action: () => pasteBars(at, 'insert') },
  );
  return items;
}
function openBarCopy(at) {
  const total = Math.round(totalClipTime() / cur.dur);
  $('bcFrom').value = at; $('bcTo').value = Math.min(total, at + 1); $('bcFrom').max = $('bcTo').max = total;
  $('barCopyDlg').hidden = false; $('bcFrom').focus();
}
$('bcOk').onclick = () => { const total = Math.round(totalClipTime() / cur.dur), a = clamp(Math.round(+$('bcFrom').value), 1, total), b = clamp(Math.round(+$('bcTo').value), a, total); $('barCopyDlg').hidden = true; copyBars(a, b); };
$('bcCancel').onclick = () => { $('barCopyDlg').hidden = true; };
$('barCopyDlg').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('barCopyDlg').hidden = true; if (e.key === 'Enter') $('bcOk').click(); });
const playBar = () => (cur && cur.dur > 0 ? Math.floor(clipTime(S.t) / cur.dur + 1e-6) + 1 : 1);
window.addEventListener('keydown', (e) => {   // Ctrl+Shift+C / V: copy / paste the playhead's bar (Ctrl+C / V stay for points)
  if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName)) return;
  if (e.code === 'KeyC') { e.preventDefault(); copyBars(playBar(), playBar()); }
  if (e.code === 'KeyV' && barClip) { e.preventDefault(); pasteBars(playBar(), 'replace'); }
});

// ---------------------------------------------------------------- the whole timeline as FBX
// every frame of the timeline as it plays (automation, groups, IK, holds, stride), bone names Mixamo or Character Creator
const RIG_TO_CC = (() => {
  const m = { hips: 'CC_Base_Hip', spine: 'CC_Base_Waist', spine1: 'CC_Base_Spine01', spine2: 'CC_Base_Spine02', neck: 'CC_Base_NeckTwist01', head: 'CC_Base_Head' };
  for (const [S0, c] of [['left', 'L'], ['right', 'R']]) {
    Object.assign(m, { [S0 + 'shoulder']: `CC_Base_${c}_Clavicle`, [S0 + 'arm']: `CC_Base_${c}_Upperarm`, [S0 + 'forearm']: `CC_Base_${c}_Forearm`, [S0 + 'hand']: `CC_Base_${c}_Hand`,
      [S0 + 'upleg']: `CC_Base_${c}_Thigh`, [S0 + 'leg']: `CC_Base_${c}_Calf`, [S0 + 'foot']: `CC_Base_${c}_Foot`, [S0 + 'toebase']: `CC_Base_${c}_ToeBase` });
    for (const [mf, cf] of [['thumb', 'Thumb'], ['index', 'Index'], ['middle', 'Mid'], ['ring', 'Ring'], ['pinky', 'Pinky']]) for (const k of [1, 2, 3]) m[`${S0}hand${mf}${k}`] = `CC_Base_${c}_${cf}${k}`;
  }
  return m;
})();
function timelineFrames(fps, travel) {
  if (seqActive()) return seqFrames(fps, travel);   // a sequence: every motion, cross-faded
  const n = Math.max(2, Math.round(S.dur * fps) + 1), q = new Float32Array(n * B * 4), hp = new Float32Array(n * 3);
  const keep = { inPlace: S.inPlace, base: S.travelBase.clone(), t: S.t };
  S.inPlace = !travel; S.travelBase.set(0, 0, 0);
  try {
    for (let i = 0; i < n; i++) {
      evaluate(Math.min(S.dur, i / fps), null);
      rig.bones.forEach((b, j) => b.quaternion.toArray(q, (i * B + j) * 4));
      worldP(rig.b.hips).toArray(hp, i * 3);
    }
  } finally { S.inPlace = keep.inPlace; S.travelBase.copy(keep.base); S.t = keep.t; }
  return { n, fps, q, hp };
}
async function exportTimelineFbx() {
  const fps = +$('tfFps').value || 30, travel = $('tfTravel').checked, cc = $('tfNames').value === 'cc', note = $('tfNote');
  note.textContent = 'Baking…'; await new Promise((r) => setTimeout(r, 30));
  try {
    const fr = timelineFrames(fps, travel), base = `${(cur.c.name || 'clip').replace(/[^A-Za-z0-9_-]/g, '_')}_timeline`;
    const nameOf = cc ? (nm) => RIG_TO_CC[normName(nm)] || nm : (nm) => nm;
    const data = zipStore([{ name: base + '.fbx', data: buildFbx(fr, base, nameOf) }]), fn = `${base}_${stamp()}_fbx.zip`;
    if (!caps.downloads) { note.textContent = 'Download is not available here.'; return; }
    await caps.downloads.save({ filename: fn, data });
    note.textContent = `Saved ${fn}: ${fr.n} frames at ${fps} fps (${((fr.n - 1) / fps).toFixed(2)} s${seqActive() ? `, ${SEQ.motions.length} motions` : `, ${cycTxt(A.cycles || 0)} bars`}), ${travel ? 'with travel' : 'in place'}, ${cc ? 'Character Creator' : 'Mixamo'} bone names.`;
  } catch (e) { note.textContent = e && e.code === 'declined' ? 'Download cancelled.' : 'Export failed: ' + (e && e.message || e); }
}
function openTimelineFbx() { $('tfDlg').hidden = false; $('tfNote').textContent = seqActive() ? `Whole sequence: ${SEQ.motions.length} motions · ${cycTxt(SEQ.g ? SEQ.g.TB : 0)} bars · ${SEQ.Tend.toFixed(2)} s · every motion and blend is baked in.` : `${cycTxt(A.cycles || 0)} bars · ${S.dur.toFixed(2)} s · everything on the timeline is baked in.`; }
$('tfGo').onclick = exportTimelineFbx;
$('tfClose').onclick = () => { $('tfDlg').hidden = true; };
$('tfDlg').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('tfDlg').hidden = true; });

// ---------------------------------------------------------------- moving speed: viewport readout + graph over the timeline
function groundSpeedAt(t) {   // m/s of the character over the ground at timeline time t (all speeds, stride, moving speed)
  const h = Math.min(0.02, S.dur / 4), a = clamp(t - h, 0, S.dur), b = clamp(t + h, 0, S.dur);
  if (b - a < 1e-6) return 0;
  const p0 = trueTravel(a).clone(), p1 = trueTravel(b); p1.y = p0.y = 0; return p1.distanceTo(p0) / (b - a);
}
let spdCache = null;
function speedSeries() {
  const key = `${editVersion}|${S.dur}|${cur && cur.id}`;
  if (spdCache && spdCache.key === key) return spdCache;
  const n = 240, v = new Float32Array(n + 1); let mx = 0, mn = Infinity;
  for (let i = 0; i <= n; i++) { v[i] = groundSpeedAt((i / n) * S.dur); mx = Math.max(mx, v[i]); mn = Math.min(mn, v[i]); }
  spdCache = { key, n, v, mx, mn };
  return spdCache;
}
function drawSpeedGraph() {
  const cv = $('spdGraph'); if (!cv || !cur || !S.speedLUT) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth || 240, h = 64;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.height = h + 'px'; }
  const x = cv.getContext('2d'), W = cv.width, H = cv.height, s = speedSeries(), top = Math.max(0.5, Math.ceil(s.mx * 1.1));
  const px = (i) => (i / s.n) * (W - 2 * dpr) + dpr, py = (v) => H - 12 * dpr - (v / top) * (H - 22 * dpr);
  x.clearRect(0, 0, W, H);
  x.font = `500 ${9.5 * dpr}px "IBM Plex Mono", monospace`; x.textBaseline = 'alphabetic';
  x.fillStyle = '#3a3a40'; x.fillRect(0, Math.round(py(0)), W, 1);   // baseline
  if (cur.dur > 0) for (let k = 1; k < Math.round(totalClipTime() / cur.dur); k++) { const bx = Math.round(((timeOfClipTime(k * cur.dur)) / S.dur) * (W - 2 * dpr) + dpr); x.fillStyle = '#2f2f35'; x.fillRect(bx, 8 * dpr, 1, H - 20 * dpr); }
  x.strokeStyle = '#f08a1c'; x.lineWidth = 2 * dpr; x.lineJoin = 'round'; x.beginPath();
  for (let i = 0; i <= s.n; i++) { const X = px(i), Y = py(s.v[i]); if (i) x.lineTo(X, Y); else x.moveTo(X, Y); }
  x.stroke();
  const tx = (S.t / S.dur) * (W - 2 * dpr) + dpr; x.fillStyle = 'rgba(240,138,28,.85)'; x.fillRect(Math.round(tx), 0, Math.max(1, dpr), H - 10 * dpr);
  x.fillStyle = '#8c8c93'; x.fillText(`${top.toFixed(top < 2 ? 1 : 0)} m/s`, 3 * dpr, 9 * dpr); x.fillText('0', 3 * dpr, H - 2 * dpr);
  x.textAlign = 'right'; x.fillText(`${S.dur.toFixed(1)} s`, W - 3 * dpr, H - 2 * dpr); x.textAlign = 'left';
  const hv = cv.dataset.hover; if (hv) { const hx = +hv * dpr; x.fillStyle = 'rgba(255,255,255,.35)'; x.fillRect(Math.round(hx), 0, 1, H - 10 * dpr); }
}
{
  const cv = $('spdGraph'), at = (e) => { const b = cv.getBoundingClientRect(); return clamp((e.clientX - b.left) / b.width, 0, 1); };
  cv.addEventListener('pointermove', (e) => { const f = at(e), t = f * S.dur, b = cv.getBoundingClientRect(); cv.dataset.hover = String(e.clientX - b.left); tip(e, `${t.toFixed(2)} s · bar ${cur && cur.dur > 0 ? (clipTime(t) / cur.dur + 1).toFixed(2) : '–'} · ${groundSpeedAt(t).toFixed(2)} m/s`); });
  cv.addEventListener('pointerleave', () => { delete cv.dataset.hover; tip(null); });
  cv.addEventListener('pointerdown', (e) => { S.t = at(e) * S.dur; });
}
function updateSpeedHud() {
  if (!cur) return;
  const v = groundSpeedAt(S.t), m = evalPts(A.move, S.t);
  $('shSpeed').textContent = v.toFixed(2); $('shKmh').textContent = `${(v * 3.6).toFixed(1)} km/h`;
  $('shMove').textContent = `moving ${Math.round(m * 100)} %${S.inPlace ? ' · in place' : ''}`;
  drawSpeedGraph();
  updateResistViz();
  for (const r of rows) if (r.kind === 'forcer') forcerSummary(r);
  let v0 = null;
  for (const r of rows) if (r.resEl) { if (r.ghost && v0 == null) { const R = resistAt(S.t); v0 = v / Math.max(0.05, R.cadK * R.stepK); } r.resEl.textContent = r.ghost ? `${v0.toFixed(2)} → ${v.toFixed(2)} m/s` : `${v.toFixed(2)} m/s`; }
}
