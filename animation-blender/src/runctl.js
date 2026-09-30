// ============================================================================
//  RUN CONTROLS: four controls for a run
//   · Step length (the stride track, %): the feet reach further / less far from the hips (feet planted, the
//     ground covered follows); with "step length also moves the body" on, the knee lift, the pelvis turn and the
//     shoulder swing follow it too (the elbow bend stays)
//   · Cycle speed (cadence, %): the timing only: legs, arms and bob faster / slower, the pose the same
//   · Spine lean (°, + forward / − back): the chest tips (spread over the spine), the head counters it (eyes
//     level), the hips shift to keep the weight over the feet and go up / down with it: straightening a little
//     rises, a strong backward (braking) lean crouches, a forward lean crouches a little; feet stay planted
//   · Moving speed (m/s): the result, cadence × step length; with Speed lock on, editing step length rewrites the
//     cadence (and the other way round) so the speed stays what it was
// ============================================================================
const RUN = { chestK: 2.0, headK: 0.8, riseAt: -12, riseCm: 1.5, crouchPerDeg: 0.9, fwdCrouchPerDeg: 0.2, shiftPerDeg: 0.2, turnK: 0.8, kneeK: 0.65, armK: 0.85 };
const LEAN_SPEC = { range: [-40, 30], ref: 0, color: '#9ad08a', scale: 1, unit: '°', fmt: (v) => sgn(v, 1, '°'), snap: 1 };
const RESULT_COLOR = '#f08a1c';
// ---------------------------------------------------------------- spine lean → the chest / head / hips effectors
let leanFlatCache = { v: -1, flat: true };
function leanActive() {
  if (!A || !A.lean) return false;
  if (leanFlatCache.v !== editVersion) leanFlatCache = { v: editVersion, flat: isFlat(A.lean, 0) };
  return !leanFlatCache.flat;
}
function leanHeightCm(l) {   // the up / down that goes with a lean
  if (l >= 0) return -RUN.fwdCrouchPerDeg * l;
  if (l >= RUN.riseAt) return RUN.riseCm * (l / RUN.riseAt);
  return RUN.riseCm - RUN.crouchPerDeg * (RUN.riseAt - l);
}
function runLeanAdd(id, k, t) {
  if (!leanActive()) return 0;
  const l = evalPts(A.lean, t);
  if (id === 'chest' && k === 'rx') return RUN.chestK * l;
  if (id === 'head' && k === 'rx') return -RUN.headK * RUN.chestK * l;
  if (id === 'hips' && k === 'py') return leanHeightCm(l);
  if (id === 'hips' && k === 'pz') return -RUN.shiftPerDeg * l;
  return 0;
}
const runLeanOn = (id) => (id === 'chest' || id === 'head' || id === 'hips') && leanActive();
// ---------------------------------------------------------------- step length → knee, arms (factors per bone)
const stepCouple = () => !!(A && A.strideArms !== false);
function stepKneeK(k) { return k < 1 ? 1 - RUN.kneeK * (1 - k) : 1 + 0.3 * (k - 1); }
function stepArmK(k) { return k < 1 ? 1 - RUN.armK * (1 - k) : 1 + 0.5 * (k - 1); }
function stepTurnAmt(k) { return stepCouple() && k < 1 ? clamp(RUN.turnK * (1 - k), 0, 0.9) : 0; }

// ---------------------------------------------------------------- the "Moving speed" result row
function drawResult(r) {
  const cv = r.cv, x = cv.getContext('2d'), w = cv.width, h = cv.height, dpr = dprOf(r);
  x.clearRect(0, 0, w, h); x.fillStyle = '#211d19'; x.fillRect(0, 0, w, h);
  if (!cur || !S.speedLUT) return;
  const s = speedSeries(), top = Math.max(0.5, s.mx * 1.15), py = (v) => h - 3 * dpr - (v / top) * (h - 8 * dpr);
  x.strokeStyle = RESULT_COLOR; x.lineWidth = 2 * dpr; x.beginPath();
  for (let i = 0; i <= s.n; i++) { const X = xOf(r, (i / s.n) * S.dur), Y = py(s.v[i]); if (i) x.lineTo(X, Y); else x.moveTo(X, Y); }
  x.stroke();
  x.font = `500 ${9.5 * dpr}px "IBM Plex Mono", monospace`; x.fillStyle = '#8c8c93';
  x.fillText(`${top.toFixed(1)} m/s`, 4 * dpr, 10 * dpr);
  drawEndMark(x, w, h, xOf(r, S.dur), dpr, 'rgba(12,15,13,.62)');
}
function addResultRow() {
  const r = mkRow('track t-master result', 'result'); Object.assign(r, { kind: 'result' });
  r.h.innerHTML = `<span class="sw" style="background:${RESULT_COLOR}"></span><span class="name">Moving speed <i>result · cadence × step length</i></span><b class="val resv"></b><div class="rz"></div>`;
  r.h.title = 'The character\'s speed over the ground (m/s): the result of cycle speed × step length. Speed lock (right-click) keeps it when you edit one of them.';
  r.resEl = r.h.querySelector('.resv');
  r.h.oncontextmenu = (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, runMenu()); };
  const rz = r.h.querySelector('.rz');
  rz.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); rz.setPointerCapture(e.pointerId); rowDrag = { r, y0: e.clientY, h0: rowHeight(r) }; });
  r.el.style.height = rowHeight(r) + 'px';
  const cv = document.createElement('canvas'); r.cv = cv; r.lane.append(cv);
  cv.addEventListener('pointermove', (e) => { const [px] = evXY(r, e), t = tOf(r, px); tip(e, `${t.toFixed(2)} s · ${groundSpeedAt(t).toFixed(2)} m/s · ${(groundSpeedAt(t) * 3.6).toFixed(1)} km/h`); });
  cv.addEventListener('pointerleave', () => tip(null));
  cv.addEventListener('pointerdown', (e) => { const [px] = evXY(r, e); S.t = clamp(tOf(r, px), 0, S.dur); });
  tracksEl.append(r.el); rows.push(r);
}
function runMenu() {
  const tog = (fn) => () => { pushUndo(); fn(); editVersion++; trailDirty = true; rebuildRows(); save(); };
  return [
    { label: 'Speed lock (editing step length rewrites the cadence and the other way round)', checked: !!A.speedLock, action: tog(() => { A.speedLock = !A.speedLock; }) },
    { label: 'Step length also moves knees, pelvis turn and arm swing', checked: stepCouple(), action: tog(() => { A.strideArms = !stepCouple(); }) },
    { sep: true },
    { label: 'Template: Run → Jog (4 controls)', action: () => toast(applyRunJog4()) },
    { label: 'Hide the Run controls', action: tog(() => { A.showMaster.run = false; }) },
  ];
}
// the block: a header, then Step length, Cycle speed, Spine lean and the Moving speed result
function drawRunBlock() {
  const hr = mkRow('bone sym runb'); Object.assign(hr, { kind: 'runhead' });
  const col = !!A.runCollapsed;
  hr.h.innerHTML = `<button type="button" class="mini" data-act="fold" aria-expanded="${!col}">${col ? '▸' : '▾'}</button><span class="symtag">RUN CONTROLS</span><span class="name"></span><button type="button" class="mini" data-act="menu" title="Speed lock, body coupling, template">⋯</button>`;
  hr.h.querySelector('[data-act="fold"]').onclick = () => { A.runCollapsed = !A.runCollapsed; rebuildRows(); save(); };
  hr.h.querySelector('[data-act="menu"]').onclick = (e) => { const b = e.currentTarget.getBoundingClientRect(); openMenu(b.left, b.bottom + 4, runMenu()); };
  hr.h.oncontextmenu = (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, runMenu()); };
  hr.lane.innerHTML = '<div class="summary"></div>';
  hr.lane.firstChild.textContent = `Moving speed = cadence × step length${A.speedLock ? ' · speed lock ON' : ''}${stepCouple() ? ' · step length moves knees, pelvis and arms' : ''}`;
  tracksEl.append(hr.el); rows.push(hr);
  if (col) return;
  const sub = [];
  sub.push(addTrackRow('stride', SPEC.stride, () => A.stride, (p) => { A.stride = p; }, 'Step length <i>% · feet reach, knee lift, arms</i>', null));
  sub.push(addTrackRow('cyc', SPEC.cyc, () => A.cyc, (p) => { A.cyc = p; }, 'Cycle speed <i>% · cadence</i>', null));
  sub.push(addTrackRow('lean', LEAN_SPEC, () => A.lean, (p) => { A.lean = p; }, 'Spine lean <i>° · + forward / − back, with up / down</i>', null));
  addResultRow(); sub.push(rows[rows.length - 1]);
  for (const r of sub) r.el.classList.add('sub');
  sub[sub.length - 1].el.classList.add('blockend');
}

// ---------------------------------------------------------------- speed lock
// in bar space (clip cycles): the old speed product cycle speed × step length is kept; the edited track wins and
// the other one is rewritten at every point of either track
function barCurves(a) {   // → { stride: [{b, v}], cyc: [{b, v}] } with b in bars, under that automation's own timing
  const keepA = A, keepDur = S.dur;
  A = a; S.dur = a.dur;
  try { rebuildSpeedLUT(); const d = cur.dur, f = (pts) => pts.map((p) => ({ b: clipTime(p.t) / d, v: p.v })); return { stride: f(a.stride), cyc: f(a.cyc) }; }
  finally { A = keepA; S.dur = keepDur; rebuildSpeedLUT(); }
}
const evalB = (pts, b) => evalPts(pts.map((p) => ({ t: p.b, v: p.v, k: 0 })), b);
function speedLockAfter(changed) {
  if (!A.speedLock || !undoStack.length || !cur || !(cur.dur > 0)) return;
  const other = changed === 'stride' ? 'cyc' : 'stride';
  let old; try { old = normalizeAuto(JSON.parse(undoStack[undoStack.length - 1]).A); } catch { return; }
  const bo = barCurves(old), bn = barCurves(A), d = cur.dur, total = clipTime(S.dur) / d;
  const bs = [...new Set([...bn[changed].map((p) => p.b), ...bo[other].map((p) => p.b), ...bo[changed].map((p) => p.b)].map((b) => +clamp(b, 0, total).toFixed(5)))].sort((a, b) => a - b);
  const prod = (b) => evalB(bo.cyc, b) * evalB(bo.stride, b);
  const lim = other === 'cyc' ? SPEC.cyc.range : SPEC.stride.range;
  const vals = bs.map((b) => clamp(prod(b) / Math.max(1e-6, evalB(bn[changed], b)), lim[0], lim[1]));
  const arrs = allPointArrays(), snap = snapClipTimes(arrs), i = arrs.indexOf(A[other]);
  if (i < 0) return;
  const pts = A[other]; pts.length = 0; snap[i] = [];
  bs.forEach((b, j) => { const last = j === bs.length - 1 && b >= total - 1e-4; pts.push({ t: last ? S.dur : timeOfClipTime(b * d), v: vals[j], k: 0 }); snap[i].push(last ? null : b * d); });
  placeByClipTime(arrs, snap, S.dur); ensureEnds(); lockCycles(true);
  moveEndCache = null; editVersion++; trailDirty = true; gridCache = null; holdCache.clear();
  rebuildSpeedLUT(); layoutLanes();
  toast(`Speed lock: ${other === 'cyc' ? 'cycle speed' : 'step length'} rewritten so the moving speed stays.`);
}

// ---------------------------------------------------------------- template: Run → Jog with the four controls only
const RUNJOG4 = { cycles: 10, target: 2, jogCad: 165,
  stride: [[3, 100, 'inout'], [5, 75, 'inout'], [8, null]],   // null = the jog value (from the target speed)
  cyc: [[3, 100, 'inout'], [6, 82, 'inout'], [8, null]],
  lean: [[3, 0, 'inout'], [5.5, -18, 'inout'], [8, -12]] };
function applyRunJog4(o = {}) {
  const v = { ...RUNJOG4, ...o };
  if (!cur || cur.kind !== 'loop') return 'Pick a loop clip (the run) first.';
  const sp = cur.c.speed > 0.05 ? cur.c.speed : 0;
  if (!sp) return 'This clip has no travel speed: set its m/s (Clip → Travel) first.';
  pushUndo();
  const dur = cur.dur, runCad = 120 / dur, cad = clamp(v.jogCad / runCad * 100, 30, 100);
  const stride = clamp((v.target / sp) / (cad / 100) * 100, 50, 100);
  const fill = (list, end) => list.map(([x, val, e]) => [x, val == null ? end : val, e]);
  const P = (t, val, e) => (e ? { t, v: val, k: 0, e } : { t, v: val, k: 0 });
  // a long enough timeline, then the cadence placed where its bars fall (they move once it drops)
  S.dur = A.dur = +(v.cycles * dur / (cad / 100) + 1).toFixed(3);
  A.speed = flat(1, S.dur); A.move = flat(1, S.dur); A.gnd = flat(0, S.dur);
  const cycK = fill(v.cyc, cad);
  A.cyc = [P(0, cycK[0][1]), ...cycK.map(([, val, e]) => P(0, val, e)), P(S.dur, cycK[cycK.length - 1][1])];
  for (let it = 0; it < 12; it++) { rebuildSpeedLUT(); cycK.forEach(([x], j) => { A.cyc[j + 1].t = timeOfClipTime((x - 1) * dur); }); }
  rebuildSpeedLUT();
  S.dur = A.dur = +timeOfClipTime(v.cycles * dur).toFixed(3); A.cyc[A.cyc.length - 1].t = S.dur; A.cycV2 = true;
  rebuildSpeedLUT();
  const B = (x) => Math.min(S.dur, timeOfClipTime((x - 1) * dur));
  const track = (list) => [P(0, list[0][1]), ...list.map(([x, val, e]) => P(B(x), val, e)), P(S.dur, list[list.length - 1][1])];
  A.stride = track(fill(v.stride, stride)); A.lean = track(fill(v.lean, 0));
  A.strideArms = true;
  A.showMaster = { ...A.showMaster, run: true, cycle: false, stride: false, move: false, gnd: false };
  S.lenMode = 'cycles'; A.cycles = v.cycles; A.cycLocked = true;
  S.t = 0; S.v0 = 0; moveEndCache = null; editVersion++; holdCache.clear();
  ensureEnds(); rebuildSpeedLUT(); lockCycles(true); syncLenInputs(); rebuildRows(); save();
  return `Run → Jog (4 controls): ${v.cycles} bars, slowing over bars 3–7: step length ${Math.round(stride)} %, cadence ${Math.round(runCad)} → ${Math.round(runCad * cad / 100)} steps/min, spine lean −12° (−18° braking), ${sp.toFixed(2)} → ${(sp * cad / 100 * stride / 100).toFixed(2)} m/s.`;
}
