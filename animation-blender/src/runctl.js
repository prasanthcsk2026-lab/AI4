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
const RUN = { chestK: 2.0, headK: 0.8, backRisePerDeg: 0.125, fwdCrouchPerDeg: 0.2, shiftPerDeg: 0.2, turnK: 0.8, kneeK: 0.65, armK: 0.85,
  hipRisePerDeg: 0.15, brakeReachCm: 15, brakeDipCm: 5, brakeLean: -4, brakeSlow: 0.3 };
const HIPROT_SPEC = { range: [-30, 30], ref: 0, color: '#d8a36a', scale: 1, unit: '°', fmt: (v) => sgn(v, 1, '°'), snap: 1 };
const BRAKE_SPEC = { range: [0, 1], ref: 0, color: '#e0605a', scale: 100, unit: '%', fmt: pct, snap: 0.05 };
const LEAN_SPEC = { range: [-40, 30], ref: 0, color: '#9ad08a', scale: 1, unit: '°', fmt: (v) => sgn(v, 1, '°'), snap: 1 };
const RESULT_COLOR = '#f08a1c';
// ---------------------------------------------------------------- spine lean → the chest / head / hips effectors
let leanFlatCache = { v: -1, flat: true };
function leanActive() { return flatActive('lean'); }
function leanHeightCm(l) {   // the up / down that goes with a lean: straightening (back) rises, forward crouches a little
  return l >= 0 ? -RUN.fwdCrouchPerDeg * l : RUN.backRisePerDeg * -l;
}
const flatActive = (key) => !!(A && A[key] && A[key].some((p) => Math.abs(p.v) > 1e-9));   // no cache: timing is rebuilt before an edit bumps editVersion
const hipRotActive = () => flatActive('hipRot'), brakeActive = () => flatActive('brake') && cur && cur.kind === 'loop';
// ---------------------------------------------------------------- hard braking: per foot contact
// u: 0 at touchdown → 1 at toe-off. The braking pulse rises fast to its peak at 30 % of the contact, gone by 90 %.
const smoothB = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
function brakePulse(u) { return u < 0.3 ? smoothB(u / 0.3) : 1 - smoothB((u - 0.3) / 0.6); }
function legPhase(Sd, ct) {   // → { c: in contact, u: contact progress, s: swing progress (toe-off → touchdown) }
  const w = clipWin(Sd); if (!w) return null;
  const p = mod1(ct / cur.dur), len = w[1] - w[0], du = mod1(p - w[0]);
  return du < len ? { c: true, u: du / len, s: 0 } : { c: false, u: 0, s: (du - len) / (1 - len) };
}
function brakeAt(t) { return brakeActive() ? clamp(evalPts(A.brake, t), 0, 1) : 0; }
function brakePulseAt(ct) {   // the strongest pulse over both legs at clip time ct
  let f = 0; for (const Sd of ['L', 'R']) { const lp = legPhase(Sd, ct); if (lp && lp.c) f = Math.max(f, brakePulse(lp.u)); }
  return f;
}
function brakeRate(t, ct) { const b = brakeAt(t); return b > 1e-4 ? 1 - RUN.brakeSlow * b * brakePulseAt(ct) : 1; }   // slows the clip (and the travel with it) in each contact
function brakeReachCm(Sd, t) {   // the foot lands further ahead: on through the contact, eased in before touchdown and out after toe-off
  const b = brakeAt(t); if (b < 1e-4) return 0;
  const lp = legPhase(Sd, clipTime(t)); if (!lp) return 0;
  const g = lp.c ? 1 : lp.s < 0.25 ? 1 - smoothB(lp.s / 0.25) : lp.s > 0.6 ? smoothB((lp.s - 0.6) / 0.4) : 0;
  return RUN.brakeReachCm * b * g;
}
function runLeanAdd(id, k, t) {
  if (!runIKActive()) return 0;
  const br = brakeActive() ? brakeAt(t) * brakePulseAt(clipTime(t)) : 0, R = resistOn() ? resistLeanParts(t) : null;
  const l0 = (leanActive() ? evalPts(A.lean, t) : 0) + (R ? R.spine : 0), l = l0 + br * RUN.brakeLean;
  const hr = (hipRotActive() ? evalPts(A.hipRot, t) : 0) + (R ? R.hip : 0), side = R ? R.side * RESK.sideSign : 0;
  if (id === 'hips' && k === 'rx') return hr;
  if (id === 'hips' && k === 'py') return leanHeightCm(l0) + RUN.hipRisePerDeg * Math.max(0, -hr) - br * RUN.brakeDipCm + (R ? R.heightCm : 0);
  if (id === 'hips' && k === 'rz') return side * RESK.sideHipShare;
  if (id === 'chest' && k === 'rz') return RUN.chestK * side * (1 - RESK.sideHipShare);
  if (id === 'head' && k === 'rz') return -RUN.headK * (RUN.chestK * side * (1 - RESK.sideHipShare) + side * RESK.sideHipShare);
  if (id === 'chest' && k === 'rx') return RUN.chestK * l;
  if (id === 'head' && k === 'rx') return -RUN.headK * (RUN.chestK * l + hr) + (R ? R.headRx : 0);
  if (id === 'hips' && k === 'pz') return -RUN.shiftPerDeg * l;
  return 0;
}
const runIKActive = () => leanActive() || hipRotActive() || brakeActive() || resistOn() || forcersOn() || kneeDepthOn();
const runLeanOn = (id) => (id === 'chest' || id === 'head' || id === 'hips') && runIKActive();
// ---------------------------------------------------------------- step length → knee, arms (factors per bone)
const stepCouple = () => !!(A && A.strideArms !== false);
function stepKneeK(k) { return k < 1 ? 1 - RUN.kneeK * (1 - k) : 1 + 0.3 * (k - 1); }
function stepArmK(k) { return k < 1 ? 1 - RUN.armK * (1 - k) : 1 + 0.5 * (k - 1); }
function stepTurnAmt(k) { return stepCouple() && k < 1 ? clamp(RUN.turnK * (1 - k), 0, 0.9) : 0; }

// ---------------------------------------------------------------- knee depth: deeper / shallower knee bend, the hips follow
// Knee depth (%, 100 = the clip). In each foot contact the knee bends that much more (or less) than in the clip; the
// hips come down (or up) by the amount that keeps the planted foot where it was, worked out once per clip from the
// legs' geometry at mid-contact, so the hip height follows only the Knee depth track: no step at touchdown or
// toe-off (the feet stay planted by the leg IK). Shallower is capped where a leg in contact would lock straight.
// In the air the shin folds that much more (knee lift), eased in after toe-off and out before touchdown (sin²).
const KNEE_SPEC = { range: [50, 150], ref: 100, color: '#7ac7e0', scale: 1, unit: '%', fmt: (v) => Math.round(v) + '%', snap: 1 };
const kneeDepthOn = () => !!(A && A.kneeDepth && cur && cur.kind === 'loop' && A.kneeDepth.some((p) => Math.abs(p.v - 100) > 1e-6));
const kneeDepthAt = (t) => (kneeDepthOn() ? clamp(evalPts(A.kneeDepth, t), KNEE_SPEC.range[0], KNEE_SPEC.range[1]) / 100 : 1);
let kneeGeo = null;
function kneeGeometry() {   // → per leg the hip → foot geometry through its contact in the clip (in place)
  const key = `${cur.id}|${cur.dur}|${!!BAKED[cur.id]}`;
  if (kneeGeo && kneeGeo.key === key && kneeGeo.rig === rig) return kneeGeo;
  const vfk = new VirtualFK(rig), Q = new Float32Array(B * 4), H = V3(), legs = [];
  for (const Sd of ['L', 'R']) {
    const w = clipWin(Sd); if (!w) continue;
    const sd = rig.side[Sd], iT = rig.bones.indexOf(sd.thigh), iK = rig.bones.indexOf(sd.shin), iF = rig.bones.indexOf(sd.foot), l1 = sd.leg.l1, l2 = sd.leg.l2, len = mod1(w[1] - w[0]) || 1, smp = [];
    let swingMax = 0;
    for (let j = 0; j < 48; j++) {   // the whole cycle: every pose must stay reachable when the hips rise; the deepest knee fold
      const ph = mod1(w[0] + j / 48), inC = mod1(ph - w[0]) <= len + 1e-9;
      sampleClip(ph * cur.dur, Q, H); vfk.run(Q, H);
      const v = vfk.P[iT].clone().sub(vfk.P[iF]), a = vfk.P[iT].clone().sub(vfk.P[iK]), c = vfk.P[iF].clone().sub(vfk.P[iK]);
      swingMax = Math.max(swingMax, Math.PI - a.angleTo(c));
      smp.push({ h: Math.hypot(v.x, v.z), y: v.y, mid: false, inC });
    }
    for (let j = 0; j <= 4; j++) {   // the contact's middle (3 samples around it): the depth the hips follow
      sampleClip(mod1(w[0] + len * (0.4 + 0.05 * j)) * cur.dur, Q, H); vfk.run(Q, H);
      const v = vfk.P[iT].clone().sub(vfk.P[iF]); smp.push({ h: Math.hypot(v.x, v.z), y: v.y, mid: true, inC: true });
    }
    legs.push({ side: Sd, l1, l2, smp, swingMax });
  }
  kneeGeo = { key, rig, legs }; return kneeGeo;
}
function kneeHipDrop(K) {   // m the hips come down (− = up) for knee depth K
  if (Math.abs(K - 1) < 1e-6) return 0;
  const G = kneeGeometry(); if (!G.legs.length) return 0;
  let sum = 0, n = 0, rise = Infinity;
  for (const L of G.legs) {
    const { l1, l2 } = L, reach = (l1 + l2) * 0.985;
    for (const q of L.smp) {
      const d0 = clamp(Math.hypot(q.h, q.y), Math.abs(l1 - l2) + 1e-4, l1 + l2);
      rise = Math.min(rise, Math.max(0, Math.sqrt(Math.max(0, reach * reach - q.h * q.h)) - q.y));   // how far up before this pose locks straight
      if (!q.mid) continue;
      const flex0 = Math.PI - Math.acos(clamp((l1 * l1 + l2 * l2 - d0 * d0) / (2 * l1 * l2), -1, 1)), flex1 = clamp(flex0 * K, 2 * DEG, 150 * DEG);
      const d1 = Math.sqrt(l1 * l1 + l2 * l2 + 2 * l1 * l2 * Math.cos(flex1));
      sum += q.y - Math.sqrt(Math.max(0, d1 * d1 - q.h * q.h)); n++;
    }
  }
  const drop = n ? sum / n : 0;
  return clamp(drop, -0.9 * rise, 0.3);
}
function kneeSwingK(Sd, t) {   // the shin's extra fold in the air (1 in contact)
  const K = kneeDepthAt(t); if (K <= 1 + 1e-6) return 1;   // shallower: the swing is left as it is (a longer swinging leg would hit the ground)
  const lp = legPhase(Sd, clipTime(t)); if (!lp || lp.c) return 1;
  let k = K;
  if (K > 1) {   // soft cap: the deepest fold of the clip stays under 140° (the knee's limit is 155°): no hitting the stop
    const L = kneeGeometry().legs.find((x) => x.side === Sd), room = L && L.swingMax > 0 ? Math.max(0, 140 * DEG / L.swingMax - 1) : 0.3;
    k = 1 + (room > 1e-4 ? room * Math.tanh((K - 1) / room) : 0);
  }
  const e = Math.sin(Math.PI * lp.s) ** 2; return 1 + (k - 1) * e;
}

// ---------------------------------------------------------------- the "Moving speed" result row
function drawResult(r) {
  const cv = r.cv, x = cv.getContext('2d'), w = cv.width, h = cv.height, dpr = dprOf(r);
  x.clearRect(0, 0, w, h); x.fillStyle = '#211d19'; x.fillRect(0, 0, w, h);
  if (!cur || !S.speedLUT) return;
  const s = speedSeries(), g = r.ghost ? speedNoForcers() : null;
  let mn = Infinity, mx = -Infinity; for (const arr of [s.v, g && g.v]) if (arr) for (const v of arr) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  const pad = Math.max(0.25, (mx - mn) * 0.15), bot = Math.max(0, mn - pad), top = mx + pad;   // the range it moves in, so a change shows
  const py = (v) => h - 3 * dpr - ((v - bot) / (top - bot)) * (h - 16 * dpr);
  x.strokeStyle = RESULT_COLOR; x.lineWidth = 2 * dpr; x.beginPath();
  for (let i = 0; i <= s.n; i++) { const X = xOf(r, (i / s.n) * S.dur), Y = py(s.v[i]); if (i) x.lineTo(X, Y); else x.moveTo(X, Y); }
  x.stroke();
  if (r.ghost) {   // a forcer block: the speed the forcers took away (dashed: without any forcer)
    x.strokeStyle = 'rgba(200,200,210,.55)'; x.lineWidth = 1.25 * dpr; x.setLineDash([4 * dpr, 3 * dpr]); x.beginPath();
    for (let i = 0; i <= g.n; i++) { const X = xOf(r, (i / g.n) * S.dur), Y = py(Math.min(top, g.v[i])); if (i) x.lineTo(X, Y); else x.moveTo(X, Y); }
    x.stroke(); x.setLineDash([]);
  }
  x.font = `500 ${9.5 * dpr}px "IBM Plex Mono", monospace`; x.fillStyle = '#8c8c93';
  x.fillText(`${bot.toFixed(1)}–${top.toFixed(1)} m/s${r.ghost ? ' · dashed: without forcers' : ''}`, 4 * dpr, 10 * dpr);
  drawEndMark(x, w, h, xOf(r, S.dur), dpr, 'rgba(12,15,13,.62)');
}
// the speed without the forcers: the forcers scale the cadence (cadK) and the step length (stepK), and the
// ground speed is cadence × step length, so dividing them out gives what it would be
let spdNoFCache = null;
function speedNoForcers() {
  const s = speedSeries(); if (spdNoFCache && spdNoFCache.s === s) return spdNoFCache;
  const v = new Float32Array(s.n + 1);
  for (let i = 0; i <= s.n; i++) { const R = resistAt((i / s.n) * S.dur); v[i] = s.v[i] / Math.max(0.05, R.cadK * R.stepK); }
  spdNoFCache = { s, n: s.n, v }; return spdNoFCache;
}
function addResultRow(ghost = false) {
  const r = mkRow('track t-master result', 'result'); Object.assign(r, { kind: 'result', ghost });
  r.h.innerHTML = `<span class="sw" style="background:${RESULT_COLOR}"></span><span class="name">Moving speed <i>${ghost ? 'result · with the forcers (dashed: without)' : 'result · cadence × step length'}</i></span><b class="val resv"></b><div class="rz"></div>`;
  r.h.title = 'The character\'s speed over the ground (m/s): the result of cycle speed × step length. Speed lock (right-click) keeps it when you edit one of them.';
  r.resEl = r.h.querySelector('.resv');
  r.h.oncontextmenu = (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, runMenu()); };
  const rz = r.h.querySelector('.rz');
  rz.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); rz.setPointerCapture(e.pointerId); rowDrag = { r, y0: e.clientY, h0: rowHeight(r) }; });
  r.el.style.height = rowHeight(r) + 'px';
  const cv = document.createElement('canvas'); r.cv = cv; r.lane.append(cv);
  cv.addEventListener('pointermove', (e) => { const [px] = evXY(r, e), t = tOf(r, px), v = groundSpeedAt(t), R = ghost ? resistAt(t) : null; tip(e, `${t.toFixed(2)} s · ${v.toFixed(2)} m/s · ${(v * 3.6).toFixed(1)} km/h${R ? ` · without forcers ${(v / Math.max(0.05, R.cadK * R.stepK)).toFixed(2)} m/s` : ''}`); });
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
    { label: 'Hide the Moving speed track', action: tog(() => { A.showMaster.mspeed = false; }) },
  ];
}
// the block: a header, then Step length, Cycle speed, Spine lean, Hip rotation, Hard braking, Knee depth
function drawRunBlock() {
  const hr = mkRow('bone sym runb'); Object.assign(hr, { kind: 'runhead' });
  const col = !!A.runCollapsed;
  hr.h.innerHTML = `<button type="button" class="mini" data-act="fold" aria-expanded="${!col}">${col ? '▸' : '▾'}</button><span class="symtag">RUN CONTROLS</span><span class="name"></span><button type="button" class="mini" data-act="menu" title="Speed lock, body coupling, template">⋯</button>`;
  hr.h.querySelector('[data-act="fold"]').onclick = () => { A.runCollapsed = !A.runCollapsed; rebuildRows(); save(); };
  hr.h.querySelector('[data-act="menu"]').onclick = (e) => { const b = e.currentTarget.getBoundingClientRect(); openMenu(b.left, b.bottom + 4, runMenu()); };
  hr.h.oncontextmenu = (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, runMenu()); };
  hr.lane.innerHTML = '<div class="summary"></div>';
  hr.lane.firstChild.textContent = `Moving speed (its own track) = cadence × step length${A.speedLock ? ' · speed lock ON' : ''}${stepCouple() ? ' · step length moves knees, pelvis and arms' : ''}`;
  tracksEl.append(hr.el); rows.push(hr);
  if (col) return;
  const sub = [];
  sub.push(addTrackRow('stride', SPEC.stride, () => A.stride, (p) => { A.stride = p; }, 'Step length <i>% · feet reach, knee lift, arms</i>', null));
  sub.push(addTrackRow('cyc', SPEC.cyc, () => A.cyc, (p) => { A.cyc = p; }, 'Cycle speed <i>% · cadence</i>', null));
  sub.push(addTrackRow('lean', LEAN_SPEC, () => A.lean, (p) => { A.lean = p; }, 'Spine lean <i>° · + forward / − back (back rises)</i>', null));
  sub.push(addTrackRow('hipRot', HIPROT_SPEC, () => A.hipRot, (p) => { A.hipRot = p; }, 'Hip rotation <i>° pelvis tilt · − back (rises) / + forward</i>', null));
  sub.push(addTrackRow('brake', BRAKE_SPEC, () => A.brake, (p) => { A.brake = p; }, 'Hard braking <i>% · in every foot contact</i>', null));
  sub.push(addTrackRow('kneeDepth', KNEE_SPEC, () => A.kneeDepth, (p) => { A.kneeDepth = p; }, 'Knee depth <i>% · deeper knees, the hips come down (feet stay)</i>', null));
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
  lean: [[3, 0, 'inout'], [6, -8]],
  hipRot: [[3, 0, 'inout'], [6, -4]],
  brake: [[3.5, 0, 'inout'], [4.25, 0.7], [6.25, 0.7, 'inout'], [7.25, 0]] };
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
  A.stride = track(fill(v.stride, stride)); A.lean = track(fill(v.lean, 0)); A.hipRot = track(fill(v.hipRot, 0)); A.brake = track(fill(v.brake, 0));
  A.strideArms = true;
  A.showMaster = { ...A.showMaster, run: true, cycle: false, stride: false, move: false, gnd: false };
  S.lenMode = 'cycles'; A.cycles = v.cycles; A.cycLocked = true;
  S.t = 0; S.v0 = 0; moveEndCache = null; editVersion++; holdCache.clear();
  ensureEnds(); rebuildSpeedLUT(); lockCycles(true); syncLenInputs(); rebuildRows(); save();
  return `Run → Jog (4 controls): ${v.cycles} bars, slowing over bars 3–7: step length ${Math.round(stride)} %, cadence ${Math.round(runCad)} → ${Math.round(runCad * cad / 100)} steps/min, spine lean −8°, hip rotation −4°, hard braking 70 % over bars 4–6, ${sp.toFixed(2)} → ${(sp * cad / 100 * stride / 100).toFixed(2)} m/s.`;
}
