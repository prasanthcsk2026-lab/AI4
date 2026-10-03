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
function legPhase(Sd, ct, t) {   // → { c: in contact, u: contact progress, s: swing progress (toe-off → touchdown) }; with t: after Foot on ground
  const g = t != null ? gndAt(t) : 0, w = Math.abs(g) > 1e-4 ? gndWin(Sd, g) : clipWin(Sd); if (!w) return null;
  const p = mod1(ct / cur.dur), len = w[1] - w[0], du = mod1(p - w[0]);
  return du < len ? { c: true, u: du / len, s: 0 } : { c: false, u: 0, s: (du - len) / (1 - len) };
}
function brakeAt(t) { return brakeActive() ? clamp(evalPts(A.brake, t), 0, 1) : 0; }
function brakePulseAt(ct) {   // the strongest pulse over both legs at clip time ct
  let f = 0; for (const Sd of ['L', 'R']) { const lp = legPhase(Sd, ct); if (lp && lp.c) f = Math.max(f, brakePulse(lp.u)); }
  return f;
}
// Brake rhythm (%): the playback slows in each contact and plays a little faster right after toe-off to make up for
// it. At 100 % a bar takes exactly as long as without braking (the bars and the cadence stay); the speed it would
// have lost through the longer bars comes off the step length instead (feet stay planted), so the moving speed drops
// the same. 0 % = the old way (only the slow-down: longer bars, lower cadence).
const RHYTHM_SPEC = { range: [0, 1], ref: 1, color: '#e08a7a', scale: 100, unit: '%', fmt: pct, snap: 0.05 };
const releasePulse = (s) => (s < 0.45 ? Math.sin(Math.PI * s / 0.45) ** 2 : 0);   // the push-off surge, over the first 45 % of the swing
let brkTab = null;
function brakeTable() {   // per clip: the contact pulse and the release pulse over one cycle, and the make-up gain per braking strength
  const key = `${cur.id}|${cur.dur}|${!!BAKED[cur.id]}`; if (brkTab && brkTab.key === key) return brkTab;
  const N = 240, pc = new Float32Array(N), pr = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const ct = (i + 0.5) / N * cur.dur; pc[i] = brakePulseAt(ct);
    let r = 0; for (const Sd of ['L', 'R']) { const lp = legPhase(Sd, ct); if (lp && !lp.c) r = Math.max(r, releasePulse(lp.s)); } pr[i] = r;
  }
  brkTab = { key, N, pc, pr, g: new Map() }; return brkTab;
}
const brkMeanInv = (T, a, g) => { let m = 0; for (let i = 0; i < T.N; i++) m += 1 / ((1 - a * T.pc[i]) * (1 + g * T.pr[i])); return m / T.N; };
function brakeGain(a) {   // the release boost that makes a cycle take exactly as long as without braking
  const T = brakeTable(), k = Math.round(a * 400); if (T.g.has(k)) return T.g.get(k);
  let lo = 0, hi = 4; if (!T.pr.some((x) => x > 0)) hi = 0;
  for (let it = 0; it < 40 && hi > 0; it++) { const m = (lo + hi) / 2; if (brkMeanInv(T, k / 400, m) > 1) lo = m; else hi = m; }
  T.g.set(k, (lo + hi) / 2); return (lo + hi) / 2;
}
const rhythmAt = (t) => (A && A.brakeRhythm ? clamp(evalPts(A.brakeRhythm, t), 0, 1) : 1);
function releasePulseAt(ct) { const T = brakeTable(), i = Math.floor(mod1(ct / cur.dur) * T.N) % T.N; return T.pr[i]; }
function brakeRate(t, ct) {   // slows the clip (and the travel with it) in each contact; the release makes it up
  const b = brakeAt(t); if (b < 1e-4) return 1;
  const a = RUN.brakeSlow * b, rh = rhythmAt(t);
  return (1 - a * brakePulseAt(ct)) * (rh > 1e-4 ? 1 + rh * brakeGain(a) * releasePulseAt(ct) : 1);
}
function brakeStrideK(t) {   // the step length that takes off what the made-up time no longer does (same moving speed)
  const b = brakeAt(t); if (b < 1e-4) return 1;
  const a = RUN.brakeSlow * b, rh = rhythmAt(t); if (rh < 1e-4) return 1;
  const T = brakeTable(), k = Math.round(a * 400) + '|' + Math.round(rh * 200); if (!T.sk) T.sk = new Map(); if (T.sk.has(k)) return T.sk.get(k);
  const a2 = Math.round(a * 400) / 400, r2 = Math.round(rh * 200) / 200, v = brkMeanInv(T, a2, r2 * brakeGain(a2)) / brkMeanInv(T, a2, 0); T.sk.set(k, v); return v;
}
function brakeReachCm(Sd, t) {   // the foot lands further ahead: on through the contact, eased in before touchdown and out after toe-off
  const b = brakeAt(t); if (b < 1e-4) return 0;
  const lp = legPhase(Sd, clipTime(t), t); if (!lp) return 0;
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
const runIKActive = () => leanActive() || hipRotActive() || brakeActive() || resistOn() || forcersOn() || kneeDepthOn() || hipMotionOn() || armShapeOn() || jumpOn();
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
const kneeDepthAt = (t) => { if (!kneeDepthOn()) return 1; const R = (A.ranges && A.ranges.kneeDepth) || KNEE_SPEC.range; return clamp(evalPts(A.kneeDepth, t), Math.max(5, R[0]), R[1]) / 100; };
const HEEL_MAX = 40 * DEG;
let kneeGeo = null;
function kneeGeometry() {   // → per leg the hip → foot geometry: mid-contact samples, and the room to rise at every phase
  const key = `${cur.id}|${cur.dur}|${!!BAKED[cur.id]}`;
  if (kneeGeo && kneeGeo.key === key && kneeGeo.rig === rig) return kneeGeo;
  const vfk = new VirtualFK(rig), Q = new Float32Array(B * 4), H = V3(), legs = [], NP = 96, room = new Float32Array(NP).fill(1);
  for (const Sd of ['L', 'R']) {
    const w = clipWin(Sd); if (!w) continue;
    const sd = rig.side[Sd], iT = rig.bones.indexOf(sd.thigh), iK = rig.bones.indexOf(sd.shin), iF = rig.bones.indexOf(sd.foot), l1 = sd.leg.l1, l2 = sd.leg.l2, len = mod1(w[1] - w[0]) || 1, smp = [];
    const reach = (l1 + l2) * 0.985, iO = sd.toe ? rig.bones.indexOf(sd.toe) : -1;
    let swingMax = 0;
    for (let j = 0; j < NP; j++) {   // every phase: how far the hips could rise before this leg (if it is on the ground) locks straight
      const ph = j / NP, du = mod1(ph - w[0]), inC = du <= len + 1e-9, sw = inC ? 0 : (du - len) / Math.max(1e-6, 1 - len);
      const cw = inC ? 1 : Math.max(1 - smoothB(sw / 0.08), smoothB((sw - 0.92) / 0.08));
      sampleClip(ph * cur.dur, Q, H); vfk.run(Q, H);
      const v = vfk.P[iT].clone().sub(vfk.P[iF]), a = vfk.P[iT].clone().sub(vfk.P[iK]), c = vfk.P[iF].clone().sub(vfk.P[iK]);
      swingMax = Math.max(swingMax, Math.PI - a.angleTo(c));
      // the most the hips can rise with the foot rolled up onto its toe by up to HEEL_MAX (as heelLift does)
      let m = 0;
      const ank = vfk.P[iF], toe = iO >= 0 ? vfk.P[iO] : null, r0 = toe ? ank.clone().sub(toe) : null;
      const ax = r0 ? heelAxis(r0) : null;
      for (let k = 0; k <= (ax ? 8 : 0); k++) {
        const A2 = ax ? toe.clone().add(r0.clone().applyAxisAngle(ax, HEEL_MAX * k / 8)) : ank, u = vfk.P[iT].clone().sub(A2), h = Math.hypot(u.x, u.z);
        m = Math.max(m, Math.sqrt(Math.max(0, reach * reach - h * h)) - u.y);
      }
      room[j] = Math.min(room[j], m + (1 - cw) * 0.5);   // a leg in the air does not hold the hips down
    }
    for (let j = 0; j <= 4; j++) {   // the contact's middle: the depth the hips follow
      sampleClip(mod1(w[0] + len * (0.4 + 0.05 * j)) * cur.dur, Q, H); vfk.run(Q, H);
      const v = vfk.P[iT].clone().sub(vfk.P[iF]); smp.push({ h: Math.hypot(v.x, v.z), y: v.y });
    }
    legs.push({ side: Sd, l1, l2, smp, swingMax });
  }
  // a smooth curve under the room: the lowest value within ±25 % of a cycle, then blurred over no more than that (so it stays under the room)
  { const c = Float32Array.from(room), r = 24; for (let j = 0; j < NP; j++) { let m = Infinity; for (let k = -r; k <= r; k++) m = Math.min(m, c[(j + k + NP) % NP]); room[j] = m; } }
  for (let it = 0; it < 3; it++) { const c = Float32Array.from(room), r = 8; for (let j = 0; j < NP; j++) { let a = 0; for (let k = -r; k <= r; k++) a += c[(j + k + NP) % NP]; room[j] = a / (2 * r + 1); } }
  kneeGeo = { key, rig, legs, room, NP }; return kneeGeo;
}
// heel lift: the foot turns about its toe (heel up) just enough for the leg to reach it (0 while it reaches)
function heelAxis(r0) {   // the foot's side axis (the heel lifts about it), from its horizontal direction (the runner's forward if the foot is steep)
  const f = V3(-r0.x, 0, -r0.z); if (f.lengthSq() < 0.0004) f.set(0, 0, 1); f.normalize();
  const ax = V3().crossVectors(f, V3(0, 1, 0)).normalize(); if (r0.clone().applyAxisAngle(ax, 0.1).y < r0.y) ax.negate(); return ax;
}
function heelLift(sd, target, baseQ, w = 1, air = false) {
  if (!sd.toe) return;
  const hip = worldP(sd.thigh), R = (sd.leg.l1 + sd.leg.l2) * 0.985, d0 = target.distanceTo(hip); if (d0 <= R) return;
  const r0 = rig.bp(sd.foot).sub(rig.bp(sd.toe)).applyQuaternion(baseQ), toe = target.clone().sub(r0), ax = heelAxis(r0);
  const at = (a) => toe.clone().add(r0.clone().applyAxisAngle(ax, a)), N = 16;
  let best;
  if (air) {   // just before touchdown: a little (the least lift that reaches, at most 15°)
    best = -1; let prev = 0;
    for (let k = 1; k <= N; k++) { const a = HEEL_MAX * k / N; if (at(a).distanceTo(hip) <= R) { let lo = prev, hi = a; for (let it = 0; it < 14; it++) { const m = (lo + hi) / 2; if (at(m).distanceTo(hip) > R) lo = m; else hi = m; } best = hi; break; } prev = a; }
    best = Math.min(best < 0 ? HEEL_MAX : best, 15 * DEG);
  } else {
    // the lift that brings the toe closest (a continuous search), eased in by how far out of reach the foot is: the
    // least lift that just reaches grows without bound in speed near the edge (a 10° → 26° flick in 4 ms), this does not
    let lo = 0, hi = HEEL_MAX; for (let it = 0; it < 30; it++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (at(m1).distanceTo(hip) <= at(m2).distanceTo(hip)) hi = m2; else lo = m1; }
    const aC = (lo + hi) / 2, dC = at(aC).distanceTo(hip), x = d0 - dC > 1e-6 ? clamp((d0 - R) / (d0 - dC), 0, 1) : 1;
    best = aC * (1 - (1 - x) * (1 - x));
  }
  best *= w; if (best <= 0) return;
  target.copy(at(best)); baseQ.premultiply(qAxis(ax, best));
}
function kneeRoomAt(t) { const G = kneeGeometry(), f = mod1(clipTime(t) / cur.dur) * G.NP, i = Math.floor(f) % G.NP, u = f - Math.floor(f); return lerp(G.room[i], G.room[(i + 1) % G.NP], u); }
const smin = (a, b, k) => -k * Math.log(Math.exp(-a / k) + Math.exp(-b / k));
function kneeHipDrop(K, t) {   // m the hips come down (− = up) for knee depth K at time t
  if (Math.abs(K - 1) < 1e-6) return 0;
  const G = kneeGeometry(); if (!G.legs.length) return 0;
  let sum = 0, n = 0;
  for (const L of G.legs) {
    const { l1, l2 } = L;
    for (const q of L.smp) {
      const d0 = clamp(Math.hypot(q.h, q.y), Math.abs(l1 - l2) + 1e-4, l1 + l2);
      const flex0 = Math.PI - Math.acos(clamp((l1 * l1 + l2 * l2 - d0 * d0) / (2 * l1 * l2), -1, 1)), flex1 = clamp(flex0 * K, 2 * DEG, 150 * DEG);
      const d1 = Math.sqrt(l1 * l1 + l2 * l2 + 2 * l1 * l2 * Math.cos(flex1));
      sum += q.y - Math.sqrt(Math.max(0, d1 * d1 - q.h * q.h)); n++;
    }
  }
  const drop = n ? sum / n : 0;
  if (drop >= 0) return Math.min(drop, 0.3);
  // shallower: the hips rise, most in mid-contact (bent knee), less where a leg on the ground is near straight
  // (touchdown, toe-off); a smooth curve over the cycle, so no step
  const room = t == null ? Math.min(...G.room) : kneeRoomAt(t);
  return -Math.max(0, smin(-drop, 0.75 * room, 0.004));
}
function kneeSwingK(Sd, t) {   // the shin's extra fold in the air (1 in contact)
  const K = kneeDepthAt(t); if (K <= 1 + 1e-6) return 1;   // shallower: the swing is left as it is (a longer swinging leg would hit the ground)
  const lp = legPhase(Sd, clipTime(t), t); if (!lp || lp.c) return 1;
  let k = K;
  if (K > 1) {   // soft cap: the deepest fold of the clip stays under 140° (the knee's limit is 155°): no hitting the stop
    const L = kneeGeometry().legs.find((x) => x.side === Sd), room = L && L.swingMax > 0 ? Math.max(0, 140 * DEG / L.swingMax - 1) : 0.3;
    k = 1 + (room > 1e-4 ? room * Math.tanh((K - 1) / room) : 0);
  }
  const e = Math.sin(Math.PI * lp.s) ** 2; return 1 + (k - 1) * e;
}

// ---------------------------------------------------------------- arm swing, elbow bend, arm crossing, hip motion
// Arm swing (%) scales the arms' motion about the clip's own average arm pose (not toward the idle pose, so the carry
// and the elbow bend stay: no robot arms): collarbones (the shoulders' forward / back, up / down), upper arms and
// forearms, and the spine / neck twist (the shoulder line turning against the hips).
// Hip motion (%) scales the pelvis' turn, drop and tilt and the hips' bob and side sway about their average; the
// feet stay planted (leg IK) and the chest keeps its turn in the world.
// Both follow the moving speed by default (a slower run moves less): × (1 + k · (speed / clip speed − 1)), speed
// averaged over one bar so it does not flicker inside a step. Elbow bend (°) and Arm crossing (°) are added on top.
const ARMSW_SPEC = { range: [0, 200], ref: 100, color: '#e79ad0', scale: 1, unit: '%', fmt: (v) => Math.round(v) + '%', snap: 1 };
const ELBOW_SPEC = { range: [-40, 60], ref: 0, color: '#b99af0', scale: 1, unit: '°', fmt: (v) => sgn(v, 0, '°'), snap: 1 };
const CROSS_SPEC = { range: [-20, 30], ref: 0, color: '#8fb4f0', scale: 1, unit: '°', fmt: (v) => sgn(v, 0, '°'), snap: 1 };
const HIPMO_SPEC = { range: [0, 200], ref: 100, color: '#f0b870', scale: 1, unit: '%', fmt: (v) => Math.round(v) + '%', snap: 1 };
const MOTK = { armAuto: 0.8, hipAuto: 0.6, centrePerAcc: 14, centreMax: 30 };
const CENTRE_SPEC = { range: [-40, 40], ref: 0, color: '#d6a0e8', scale: 1, unit: '°', fmt: (v) => sgn(v, 0, '°'), snap: 1 };
function accelAt(t) {   // m/s² of the bar-averaged moving speed
  const h = Math.max(0.08, (cur.dur || 0.5) * 0.5), a = Math.max(0, t - h), b = Math.min(S.dur, t + h); if (b - a < 1e-3) return 0;
  return (avgSpeedAt(b) - avgSpeedAt(a)) / (b - a);
}
const centreAutoOn = () => !!(A && A.armCentreAuto !== false && !A.runOff && speedVaries());
function armCentreAt(t) {   // ° the arms' swing centre moves forward (+) / back (−)
  let c = A.armCentre ? evalPts(A.armCentre, t) : 0;
  if (centreAutoOn()) c += clamp(MOTK.centrePerAcc * accelAt(t), -MOTK.centreMax, MOTK.centreMax);   // slowing down: back; speeding up: forward
  return c;
}
const trackOff = (pts, ref) => !pts || !pts.some((p) => Math.abs(p.v - ref) > 1e-6);
let clipMean = null;
function clipMeans() {   // the clip's average local rotation per bone and hips position over one cycle
  const key = `${cur.id}|${cur.dur}|${!!BAKED[cur.id]}`;
  if (clipMean && clipMean.key === key && clipMean.rig === rig) return clipMean;
  const Q = new Float32Array(B * 4), H = V3(), acc = new Float32Array(B * 4), h = V3(), N = 48;
  for (let j = 0; j < N; j++) {
    sampleClip((j / N) * cur.dur, Q, H); h.add(H);
    for (let i = 0; i < B; i++) { const o = i * 4, sg = j && acc[o] * Q[o] + acc[o + 1] * Q[o + 1] + acc[o + 2] * Q[o + 2] + acc[o + 3] * Q[o + 3] < 0 ? -1 : 1; for (let k = 0; k < 4; k++) acc[o + k] += sg * Q[o + k]; }
  }
  const q = []; for (let i = 0; i < B; i++) q.push(new THREE.Quaternion().fromArray(acc, i * 4).normalize());
  clipMean = { key, rig, q, h: h.divideScalar(N) }; return clipMean;
}
function avgSpeedAt(t) {   // m/s over one bar around t
  const d = cur.dur, ct = clipTime(t), end = clipTime(S.dur);
  const a = timeOfClipTime(Math.max(0, ct - d / 2)), b = timeOfClipTime(Math.min(end, ct + d / 2));
  if (b - a < 1e-3) return groundSpeedAt(t);
  const p0 = trueTravel(a).clone(), p1 = trueTravel(b); p0.y = p1.y = 0; return p1.distanceTo(p0) / (b - a);
}
function speedRatio(t) { const v0 = cur && cur.kind === 'loop' ? cur.c.speed : 0; return v0 > 0.05 ? clamp(avgSpeedAt(t) / v0, 0.2, 1.6) : 1; }
let spdVar = null;
function speedVaries() {   // does the bar-averaged moving speed leave the clip's own speed anywhere (> 3 %)?
  const v0 = cur && cur.kind === 'loop' ? cur.c.speed : 0; if (!(v0 > 0.05) || !S.speedLUT) return false;
  const key = `${editVersion}|${S.dur}|${cur.id}|${v0}`; if (spdVar && spdVar.key === key) return spdVar.v;
  let v = false; for (let i = 0; i <= 24 && !v; i++) if (Math.abs(speedRatio((i / 24) * S.dur) - 1) > 0.03) v = true;
  spdVar = { key, v }; return v;
}
const armAutoOn = () => !!(A && A.armAuto !== false && !A.runOff && speedVaries()), hipAutoOn = () => !!(A && A.hipAuto !== false && !A.runOff && speedVaries());
const armSwingOn = () => !!(A && cur && cur.kind === 'loop' && (!trackOff(A.armSwing, 100) || armAutoOn() || resistOn()));
const hipMotionOn = () => !!(A && cur && cur.kind === 'loop' && (!trackOff(A.hipMotion, 100) || hipAutoOn()));
const armShapeOn = () => !!(A && (!trackOff(A.elbowBend, 0) || !trackOff(A.armCross, 0) || !trackOff(A.armCentre, 0) || (cur && cur.kind === 'loop' && centreAutoOn())));
function armScaleAt(t) { return (A.armSwing ? evalPts(A.armSwing, t) / 100 : 1) * (resistOn() ? resistAt(t).armK : 1) *   // a forcer's load swings the arms harder (about their own centre)
    (A.armAuto !== false && !A.runOff ? Math.max(0, 1 + MOTK.armAuto * (speedRatio(t) - 1)) : 1); }
function hipScaleAt(t) { return (A.hipMotion ? evalPts(A.hipMotion, t) / 100 : 1) * (A.hipAuto !== false && !A.runOff ? Math.max(0, 1 + MOTK.hipAuto * (speedRatio(t) - 1)) : 1); }
let armSet = null;
function armScaleBones() {
  if (armSet && armSet.rig === rig) return armSet;
  const b = rig.b, full = [], twist = [];
  for (const Sd of ['L', 'R']) { const s = rig.side[Sd]; for (const x of [s.clav, s.upper, s.fore]) if (x) full.push(boneIdx.get(x.name)); }
  for (const x of [b.spine, b.spine1, b.spine2, b.neck]) if (x) { const c = x.children.find((y) => y.isBone), a = c ? rig.bind.get(c).lp.clone().normalize() : V3(0, 1, 0); twist.push({ i: boneIdx.get(x.name), a }); }
  armSet = { rig, full, twist }; return armSet;
}
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v1 = V3();
function scaleAbout(mean, q, k, out) {   // mean · (mean⁻¹ q)^k
  _q1.copy(mean).invert().multiply(q); if (_q1.w < 0) _q1.set(-_q1.x, -_q1.y, -_q1.z, -_q1.w);
  logQ(_q1, _v1); expV(_v1.x * k, _v1.y * k, _v1.z * k, _q2); return out.copy(mean).multiply(_q2);
}
function applyArmSwing(t, Qout) {   // in composePose: local rotations
  const k = armScaleAt(t); if (Math.abs(k - 1) < 1e-4) return;
  const M = clipMeans(), S0 = armScaleBones(), q = new THREE.Quaternion();
  for (const i of S0.full) { q.fromArray(Qout, i * 4); scaleAbout(M.q[i], q, k, q).toArray(Qout, i * 4); }
  for (const { i, a } of S0.twist) {   // only the twist about the bone: the lean and the bob stay
    q.fromArray(Qout, i * 4); const d = M.q[i].clone().invert().multiply(q), pr = d.x * a.x + d.y * a.y + d.z * a.z;
    let tw = new THREE.Quaternion(a.x * pr, a.y * pr, a.z * pr, d.w); if (tw.lengthSq() < 1e-12) continue; tw.normalize();
    const sw = d.clone().multiply(tw.clone().invert());
    tw = scaleAbout(new THREE.Quaternion(), tw, k, new THREE.Quaternion());
    M.q[i].clone().multiply(sw).multiply(tw).toArray(Qout, i * 4);
  }
}
function applyHipMotion(t) {   // in solveIK, before anything else moves the hips: turn / tilt and bob / sway about the average
  const k = hipScaleAt(t); if (Math.abs(k - 1) < 1e-4) return;
  const M = clipMeans(), b = rig.b, hi = boneIdx.get(b.hips.name), spQ = rig.delta(b.spine);
  scaleAbout(M.q[hi], b.hips.quaternion, k, b.hips.quaternion); b.hips.updateMatrixWorld(true);
  const tr = shownTravel(t, V3()), rel = worldP(b.hips).sub(tr);
  rel.x = M.h.x + (rel.x - M.h.x) * k; rel.y = M.h.y + (rel.y - M.h.y) * k;
  rig.setHipsWorld(rel.add(tr)); b.hips.updateMatrixWorld(true);
  rig.setDelta(b.spine, spQ);   // the chest keeps its turn in the world (the arm swing sets the shoulder line)
}
function applyArmShape(t) {   // in solveIK: elbow bend and arm crossing (world)
  applyArmShapeV(A.elbowBend ? evalPts(A.elbowBend, t) : 0, A.armCross ? evalPts(A.armCross, t) : 0, armCentreAt(t));
}
const ELBOW_HINGE = {};
function applyArmShapeV(eb, cr, ce) {
  if (Math.abs(eb) < 1e-3 && Math.abs(cr) < 1e-3 && Math.abs(ce) < 1e-3) return;
  const chest = worldP(rig.b.spine2);
  let fwd = null;
  if (Math.abs(ce) > 1e-3) { const ac = worldP(rig.side.L.upper).sub(worldP(rig.side.R.upper)); ac.y = 0; fwd = V3().crossVectors(ac, V3(0, 1, 0)); if (fwd.lengthSq() < 1e-8) fwd = null; else fwd.normalize(); }
  for (const Sd of ['L', 'R']) {
    const sd = rig.side[Sd];
    if (fwd) {   // swing centre: the whole swing turns forward / back about the shoulder (the collarbone takes a quarter)
      const ax = V3().crossVectors(V3(0, -1, 0), fwd).normalize();
      if (sd.clav) rotateBoneWorld(sd.clav, qAxis(ax, 0.25 * ce * DEG));
      rotateBoneWorld(sd.upper, qAxis(ax, 0.75 * ce * DEG));
    }
    if (Math.abs(cr) > 1e-3) {   // the arm turns in toward the body's middle line (+) or out (−)
      const sh = worldP(sd.upper), v = worldP(sd.fore).sub(sh).normalize(), med = chest.clone().sub(sh); med.y = 0;
      const ax = V3().crossVectors(v, med.normalize()); if (ax.lengthSq() > 1e-8) rotateBoneWorld(sd.upper, qAxis(ax.normalize(), cr * DEG));
    }
    if (Math.abs(eb) > 1e-3) {   // more (+) or less (−) bend at the elbow, kept within 3°…150°
      const sh = worldP(sd.upper), el = worldP(sd.fore), u = el.clone().sub(sh), f = worldP(sd.hand).sub(el);
      let ax = V3().crossVectors(u, f);
      const a = u.angleTo(f), a2 = clamp(a + eb * DEG, 3 * DEG, 150 * DEG), w = smoothB((a - 15 * DEG) / (25 * DEG));
      // a nearly straight arm has no bend plane of its own (its cross product flips): the elbow's hinge, kept in the
      // upper arm's frame from the last clearly bent pose, takes over below 40° (blended 15°…40°)
      const ul = worldQ(sd.upper), hk = Sd;
      if (a > 40 * DEG && ax.lengthSq() > 1e-10) ELBOW_HINGE[hk] = ax.clone().normalize().applyQuaternion(ul.clone().invert());
      if (w < 1 && ELBOW_HINGE[hk]) {
        const hw = ELBOW_HINGE[hk].clone().applyQuaternion(ul).normalize();
        if (ax.lengthSq() > 1e-10) { ax.normalize(); if (ax.dot(hw) < 0) ax.negate(); ax = hw.lerp(ax, w); } else ax = hw;
      }
      if (ax.lengthSq() < 1e-10) continue;
      rotateBoneWorld(sd.fore, qAxis(ax.normalize(), a2 - a));
    }
  }
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
    { label: 'Arm swing follows the moving speed (slower → less swing)', checked: A.armAuto !== false, action: tog(() => { A.armAuto = A.armAuto === false; }) },
    { label: 'Arm swing centre follows the acceleration (slowing → back, speeding up → forward)', checked: A.armCentreAuto !== false, action: tog(() => { A.armCentreAuto = A.armCentreAuto === false; }) },
    { label: 'Jump follows the step length (longer steps → a higher hop)', checked: A.jumpAuto !== false, action: tog(() => { A.jumpAuto = A.jumpAuto === false; }) },
    { label: 'Hip motion follows the moving speed (slower → less hip motion)', checked: A.hipAuto !== false, action: tog(() => { A.hipAuto = A.hipAuto === false; }) },
    { label: 'Arm swing stays vertical (the trunk\'s lean does not tip the arms)', checked: A.armVertical !== false, action: tog(() => { A.armVertical = A.armVertical === false; }) },
    { label: 'Hide the Run controls', action: tog(() => { A.showMaster.run = false; }) },
    { label: 'Hide the Moving speed track', action: tog(() => { A.showMaster.mspeed = false; }) },
  ];
}
// the block: a header (+ adds a control, M mutes them all), then only the controls you added, each with its own M
// A.runShow[key]: the control is in the block · A.runMuteK[key]: that control is muted · A.runOff: the whole block
// is muted. A muted control's points wait in A.runMuted[key] (still drawn, still editable, retimed with the bars)
// while the engine reads the neutral value; un-muting puts them back.
function runDefs() {
  return [
    ['stride', SPEC.stride, 'Step length (Hard)', '% · feet reach, knee lift, arms'],
    ['stepNat', NAT_SPEC, 'Step length (Natural)', '% · same leg motion, a longer flight and hop (from the speed)'],
    ['cyc', SPEC.cyc, 'Cycle speed', '% · cadence'],
    ['lean', LEAN_SPEC, 'Spine lean', '° · + forward / − back (back rises)'],
    ['hipRot', HIPROT_SPEC, 'Hip rotation', '° pelvis tilt · − back (rises) / + forward'],
    ['brake', BRAKE_SPEC, 'Hard braking', '% · in every foot contact'],
    ['brakeRhythm', RHYTHM_SPEC, 'Brake rhythm', '% · slow in contact, fast after toe-off (bars keep their length)'],
    ['armSwing', ARMSW_SPEC, 'Arm swing', `% · arms, shoulders, shoulder twist${A.armAuto !== false ? ' · × moving speed' : ''}`],
    ['armCentre', CENTRE_SPEC, 'Arm swing centre', `° · + forward / − back${A.armCentreAuto !== false ? ' · + slowing: back, speeding up: forward' : ''}`],
    ['elbowBend', ELBOW_SPEC, 'Elbow bend', '° · + more bent / − straighter'],
    ['armCross', CROSS_SPEC, 'Arm crossing', '° · + in toward the middle / − out'],
    ['hipMotion', HIPMO_SPEC, 'Hip motion', `% · pelvis turn, drop, bob, sway${A.hipAuto !== false ? ' · × moving speed' : ''}`],
    ['jump', JUMP_SPEC, 'Jump', `% · a hop at each change of foot (100 % = 6 cm)${A.jumpAuto !== false ? ' · + longer steps' : ''}`],
    ['kneeDepth', KNEE_SPEC, 'Knee depth', '% · deeper knees, the hips come down (feet stay)'],
    ['fwd', FWD_SPEC, 'Forward travel', '% · 100 runs forward · 0 runs on the spot (the feet land under the hips)'],
    ['brkNat', BRKP_SPEC, 'Natural brake', '% · on: he slows to a stop · a gradual gather, ~6–8 steps'],
    ['brkCtl', BRKP_SPEC, 'Controlled brake', '% · on: he slows to a stop · quick chop steps, ~3–5 steps'],
    ['brkHard', BRKP_SPEC, 'Hard brake', '% · on: he slows to a stop · a long plant step, ~2–3 steps'],
  ].filter(([k]) => (cur && cur.kind === 'proc' ? k !== 'brake' && k !== 'brakeRhythm' : !/^brk/.test(k)));   // (a procedural motion brakes with its three brake tracks; a clip with Hard braking)   // (a procedural motion brakes with its throttle)
}
const RUN_KEYS = ['stride', 'stepNat', 'cyc', 'lean', 'hipRot', 'brake', 'brakeRhythm', 'armSwing', 'armCentre', 'elbowBend', 'armCross', 'hipMotion', 'jump', 'kneeDepth', 'fwd', 'brkNat', 'brkCtl', 'brkHard'];
const BRKP_SPEC = { range: [0, 100], ref: 0, color: '#e0605a', scale: 1, unit: '% brake', fmt: (v) => Math.round(v) + '%', snap: 5 };
// forward travel: the ground covered and the feet's reach in front of / behind the hips both go with it, so at 0 he runs
// on the spot (planted feet stay under the hips, no slide); the legs, arms and cadence keep their own motion
const FWD_SPEC = { range: [0, 100], ref: 100, color: '#7fd4ff', scale: 1, unit: '%', fmt: (v) => Math.round(v) + '%', snap: 1 };
const fwdAt = (t) => (A && A.fwd ? clamp(evalPts(A.fwd, t) / 100, 0, 1) : 1);
const runRef = (k) => (runDefs().find((d) => d[0] === k) || [0, { ref: 0 }])[1].ref;
const runPts = (k) => (A.runMuted && A.runMuted[k]) || A[k];   // the control's own points (muted or not)
function runShowInit(a) {   // older saves: the controls that do something show; the rest wait behind +
  if (a.runShow && typeof a.runShow === 'object') return;
  a.runShow = {};
  if (!a.showMaster || !a.showMaster.run) return;
  const keep = A; A = a;
  try { for (const [k, sp] of runDefs()) { const pts = (a.runMuted && a.runMuted[k]) || a[k]; if (Array.isArray(pts) && pts.some((p) => Math.abs(p.v - sp.ref) > 1e-6)) a.runShow[k] = true; } } finally { A = keep; }
}
function runApplyMute() {   // stash / restore points so the engine sees the neutral value for every muted control
  A.runMuted = A.runMuted || {}; A.runMuteK = A.runMuteK || {};
  for (const k of RUN_KEYS) {
    const want = !!(A.runOff || A.runMuteK[k]), has = !!A.runMuted[k];
    if (want && !has) { A.runMuted[k] = A[k]; A[k] = flat(runRef(k), S.dur); }
    else if (!want && has) { A[k] = A.runMuted[k]; delete A.runMuted[k]; }
  }
}
function runChanged() { moveEndCache = null; editVersion++; trailDirty = true; gridCache = null; holdCache.clear(); rebuildSpeedLUT(); lockCycles(true); syncLenInputs(); rebuildRows(); save(); }
function runAddMenu() {
  return runDefs().map(([k, , name]) => ({
    label: name, checked: !!(A.runShow && A.runShow[k]),
    action: () => { pushUndo(); A.runShow = A.runShow || {}; if (A.runShow[k]) delete A.runShow[k]; else A.runShow[k] = true; A.showMaster.run = true; A.runCollapsed = false; rebuildRows(); save(); },
  }));
}
function drawRunBlock() {
  runShowInit(A);
  const hr = mkRow('bone sym runb'); Object.assign(hr, { kind: 'runhead' });
  const col = !!A.runCollapsed, shown = runDefs().filter(([k]) => A.runShow[k]);
  hr.h.innerHTML = `<button type="button" class="mini" data-act="fold" aria-expanded="${!col}">${col ? '▸' : '▾'}</button><span class="symtag">RUN CONTROLS</span><span class="name"></span><button type="button" class="mini" data-act="add" title="Add a control (step length, cycle speed, lean, arm swing, jump, knee depth …)">+</button><button type="button" class="bypass" data-act="mute" aria-pressed="${!!A.runOff}" title="${A.runOff ? 'All run controls muted: click to turn them back on' : 'Mute all run controls (their points stay)'}">M</button><button type="button" class="mini" data-act="menu" title="Speed lock, body coupling, template">⋯</button>`;
  if (A.runOff) hr.el.classList.add('bypassed');
  hr.h.querySelector('[data-act="fold"]').onclick = () => { A.runCollapsed = !A.runCollapsed; rebuildRows(); save(); };
  hr.h.querySelector('[data-act="menu"]').onclick = (e) => { const b = e.currentTarget.getBoundingClientRect(); openMenu(b.left, b.bottom + 4, runMenu()); };
  hr.h.querySelector('[data-act="add"]').onclick = (e) => { const b = e.currentTarget.getBoundingClientRect(); openMenu(b.left, b.bottom + 4, runAddMenu()); };
  hr.h.querySelector('[data-act="mute"]').onclick = (e) => { e.stopPropagation(); pushUndo(); if (A.runOff) delete A.runOff; else A.runOff = true; runApplyMute(); runChanged(); };
  hr.h.oncontextmenu = (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, runMenu()); };
  hr.lane.innerHTML = '<div class="summary"></div>';
  hr.lane.firstChild.textContent = !shown.length ? 'No controls yet: click + to add the ones you want' : `${A.runOff ? 'MUTED · ' : ''}Moving speed (its own track) = cadence × step length${A.speedLock ? ' · speed lock ON' : ''}${stepCouple() ? ' · step length moves knees, pelvis and arms' : ''}`;
  tracksEl.append(hr.el); rows.push(hr);
  if (col || !shown.length) { hr.el.classList.add('blockend'); return; }
  const sub = [];
  for (const [k, spec, name, note] of shown) {
    const r = addTrackRow(k, spec, () => runPts(k), (p) => { if (A.runMuted && A.runMuted[k]) A.runMuted[k] = p; else A[k] = p; }, `${name} <i>${note}</i>`, null);
    const mk = !!(A.runMuteK && A.runMuteK[k]), b = document.createElement('button'); b.type = 'button'; b.className = 'bypass'; b.textContent = 'M';
    b.setAttribute('aria-pressed', mk ? 'true' : 'false'); b.title = mk ? 'Muted: click to turn it back on' : 'Mute this control (its points stay)';
    b.onclick = (ev) => { ev.stopPropagation(); pushUndo(); A.runMuteK = A.runMuteK || {}; if (A.runMuteK[k]) delete A.runMuteK[k]; else A.runMuteK[k] = true; runApplyMute(); runChanged(); };
    r.h.insertBefore(b, r.h.querySelector('.tdel'));
    if (mk || A.runOff) r.el.classList.add('bypassed');
    sub.push(r);
  }
  for (const r of sub) r.el.classList.add('sub');
  sub[sub.length - 1].el.classList.add('blockend');
}

// ---------------------------------------------------------------- speed lock
// in bar space (clip cycles): the old speed product cycle speed × step length is kept; the edited track wins and
// the other one is rewritten at every point of either track
function barCurves(a) {   // → { stride: [{b, v}], cyc: [{b, v}] } with b in bars, under that automation's own timing
  const keepA = A, keepDur = S.dur;
  A = a; S.dur = a.dur;
  try { rebuildSpeedLUT(); const d = cur.dur, f = (pts) => pts.map((p) => ({ b: clipTime(p.t) / d, v: p.v })); return { stride: f(a.stride), cyc: f(a.cyc), stepNat: f(a.stepNat || flat(100, a.dur)) }; }
  finally { A = keepA; S.dur = keepDur; rebuildSpeedLUT(); }
}
const evalB = (pts, b) => evalPts(pts.map((p) => ({ t: p.b, v: p.v, k: 0 })), b);
function speedLockAfter(changed) {
  if (!A.speedLock || !undoStack.length || !cur || !(cur.dur > 0)) return;
  const other = changed === 'cyc' ? 'stride' : 'cyc', keep = ['stride', 'cyc', 'stepNat'].filter((k) => k !== other);   // the speed = cycle × hard step × natural step
  let old; try { old = normalizeAuto(JSON.parse(undoStack[undoStack.length - 1]).A); } catch { return; }
  const bo = barCurves(old), bn = barCurves(A), d = cur.dur, total = clipTime(S.dur) / d;
  const bs = [...new Set([...bn[changed].map((p) => p.b), ...bo[other].map((p) => p.b), ...bo[changed].map((p) => p.b)].map((b) => +clamp(b, 0, total).toFixed(5)))].sort((a, b) => a - b);
  const prod = (b) => evalB(bo.cyc, b) * evalB(bo.stride, b) * evalB(bo.stepNat, b) / 100;
  const lim = other === 'cyc' ? SPEC.cyc.range : SPEC.stride.range;
  const vals = bs.map((b) => clamp(prod(b) / Math.max(1e-6, keep.reduce((m, k) => m * evalB(bn[k], b), 1) / 100), lim[0], lim[1]));
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
  A.runShow = { ...(A.runShow || {}), stride: true, cyc: true, lean: true, hipRot: true, brake: true }; delete A.runOff; A.runMuteK = {}; A.runMuted = {};
  S.lenMode = 'cycles'; A.cycles = v.cycles; A.cycLocked = true;
  S.t = 0; S.v0 = 0; moveEndCache = null; editVersion++; holdCache.clear();
  ensureEnds(); rebuildSpeedLUT(); lockCycles(true); syncLenInputs(); rebuildRows(); save();
  return `Run → Jog (4 controls): ${v.cycles} bars, slowing over bars 3–7: step length ${Math.round(stride)} %, cadence ${Math.round(runCad)} → ${Math.round(runCad * cad / 100)} steps/min, spine lean −8°, hip rotation −4°, hard braking 70 % over bars 4–6, ${sp.toFixed(2)} → ${(sp * cad / 100 * stride / 100).toFixed(2)} m/s.`;
}

// ============================================================================
//  JUMP: a little hop at every change of foot (long steps). The hips rise in a smooth bump between the middles of
//  two contacts (none at mid-contact, the most in mid-flight); a foot near the start / end of its contact can then no
//  longer reach the ground and leaves it earlier / lands later, so the flight gets longer by itself (the planted part
//  of the contact stays planted). Jump % = the bump height (100 % = 6 cm);
//  "Jump follows step length" adds 1 % per % of step length over 100.
// ============================================================================
const JUMP_SPEC = { range: [0, 200], ref: 0, color: '#7fd6b0', scale: 1, unit: '%', fmt: (v) => Math.round(v) + '%', snap: 1 };
const JUMPK = { cmAt100: 6, footCm: 3, perStride: 1 };
function jumpPct(t) {
  let j = (A.jump ? evalPts(A.jump, t) : 0) + (natOn() ? natJumpPct(t) : 0);
  if (A.jumpAuto !== false && A.stride) j += JUMPK.perStride * Math.max(0, evalPts(A.stride, t) - 100);
  return Math.max(0, j);
}
const jumpOn = () => !!(A && cur && cur.kind === 'loop' && clipWin('L') && clipWin('R') && (!trackOff(A.jump, 0) || natOn() || (A.jumpAuto !== false && A.stride && A.stride.some((p) => p.v > 100.5))));
function jumpLift(t) {   // m the hips rise at t
  const j = jumpPct(t); if (j < 1e-3) return 0;
  const wL = clipWin('L'), wR = clipWin('R'), p = mod1(clipTime(t) / cur.dur);
  const mL = mod1(wL[0] + mod1(wL[1] - wL[0]) / 2), mR = mod1(wR[0] + mod1(wR[1] - wR[0]) / 2);
  const dLR = mod1(mR - mL) || 0.5, a = mod1(p - mL), x = a < dLR ? a / dLR : (a - dLR) / (1 - dLR);
  return (j / 100) * (JUMPK.cmAt100 / 100) * (0.5 - 0.5 * Math.cos(2 * Math.PI * x));
}

// ============================================================================
//  STEP LENGTH (NATURAL): longer steps without reaching further. The legs keep the clip's joint motion; the extra
//  length is covered in the air: the ground speed stays the clip's while a foot is planted and the extra comes in
//  the flight, which gets longer (the contacts shorter) with the hop that physics needs at that speed:
//  extra flight = extra step length ÷ moving speed, hop height = g · flight² ÷ 8 (on top of the clip's own flight).
// ============================================================================
const NAT_SPEC = { range: [50, 160], ref: 100, color: '#a8e07a', scale: 1, unit: '%', fmt: (v) => Math.round(v) + '%', snap: 1 };
const natOn = () => !!(A && cur && cur.kind === 'loop' && clipWin('L') && clipWin('R') && (!trackOff(A.stepNat, 100) || brakeOn()));
const natAt = (t) => (A && A.stepNat ? Math.max(0.3, evalPts(A.stepNat, t) / 100) : 1) * brakeNatK(t);   // a brake forcer's longer steps are flown too
let natTab = null;
function natClip() {   // per clip: the flight share of a cycle (neither foot down)
  const key = `${cur.id}|${cur.dur}|${!!BAKED[cur.id]}`; if (natTab && natTab.key === key) return natTab;
  const wL = clipWin('L'), wR = clipWin('R'), N = 200; let f = 0;
  const inW = (w, p) => mod1(p - w[0]) < mod1(w[1] - w[0]);
  for (let i = 0; i < N; i++) { const p = (i + 0.5) / N; if (!inW(wL, p) && !inW(wR, p)) f++; }
  natTab = { key, flight: f / N, fw: new Map() }; return natTab;
}
function natJumpPct(t) {   // the hop (in Jump %) that the extra flight needs
  const N = natAt(t); if (N <= 1 + 1e-4) return 0;
  const rate = Math.max(0.05, evalPts(A.speed, t) * Math.max(5, evalPts(A.cyc, t)) / 100), cyc = cur.dur / rate;   // s per bar
  const L0 = cur.c.speed * cur.dur * strideK(t) / 2, v = Math.max(0.3, N * L0 / (cyc / 2));   // a step, the new speed
  const T0 = natClip().flight * cyc / 2, T1 = T0 + (N - 1) * L0 / v, dh = (GRAV * (T1 * T1 - T0 * T0)) / 8;
  return (dh * 100 / JUMPK.cmAt100) * 100;
}
function plantedW(Sd, j, p) {   // 1 while the foot is in the planted middle of its contact (shortened by the hop), 0 in the air
  const w = clipWin(Sd); if (!w) return 0;
  const len = mod1(w[1] - w[0]), du = mod1(p - w[0]); if (du >= len) return 0;
  const u = du / len, half = 0.5 * (1 - 0.45 * Math.min(1, j));
  return 1 - smoothB((Math.abs(u - 0.5) - half) / Math.max(1e-3, 0.5 - half));
}
function natFlightMean(j) {   // the average of the flight weight over a cycle, for this hop
  const T = natClip(), k = Math.round(j * 50); if (T.fw.has(k)) return T.fw.get(k);
  let m = 0; const N = 200; for (let i = 0; i < N; i++) { const p = (i + 0.5) / N; m += 1 - Math.max(plantedW('L', k / 50, p), plantedW('R', k / 50, p)); }
  T.fw.set(k, m / N); return m / N;
}
function natTravelK(t) {   // × the ground covered at t: 1 while a foot is planted, more in the air (the extra step length)
  if (!natOn()) return 1;
  const N = natAt(t); if (Math.abs(N - 1) < 1e-4) return 1;
  const j = clamp(jumpPct(t) / 100, 0, 2), p = mod1(clipTime(t) / cur.dur), fm = natFlightMean(j);
  if (fm < 0.05) return N;   // no flight (a walk): spread over the cycle (the feet slide)
  const fw = 1 - Math.max(plantedW('L', j, p), plantedW('R', j, p));
  return Math.max(0.05, 1 + ((N - 1) / fm) * fw);
}

// the feet: only the middle of each contact stays on the ground (100 % → the middle 55 %); towards its ends the foot
// rises (up to 3 cm at 100 %), carrying on smoothly into the swing, so the contact is shorter and the flight longer
function jumpFootRise(Sd, t) {
  const j = clamp(jumpPct(t) / 100, 0, 2); if (j < 1e-3) return 0;
  const lp = legPhase(Sd, clipTime(t), t); if (!lp) return 0;
  const jOwn = clamp((A.jump ? evalPts(A.jump, t) : 0) / 100 + (A.jumpAuto !== false && A.stride ? Math.max(0, evalPts(A.stride, t) - 100) * JUMPK.perStride / 100 : 0), 0, 2);
  // the extra lift at the contact's ends comes from the Jump track only (natural steps keep the leg's shape)
  const H = jOwn * JUMPK.footCm / 100, half = 0.5 * (1 - 0.45 * Math.min(1, j));
  const lift = jumpLift(t), pw = plantedW(Sd, Math.min(1, j), mod1(clipTime(t) / cur.dur));   // in the air the foot rises with the hips (the leg keeps its shape)
  if (lp.c) return Math.max(H * smoothB((Math.abs(lp.u - 0.5) - half) / Math.max(1e-3, 0.5 - half)), lift * (1 - pw));
  return Math.max(H * Math.max(1 - smoothB(lp.s / 0.2), smoothB((lp.s - 0.8) / 0.2)), lift);
}

// ============================================================================
//  MOTION BLEND: any part of the body (arms, upper body, legs, …) from another loop clip, blended in by a weight
//  track from any bar. The other clip is phase-matched to this one by the foot contacts (its left / right touchdowns
//  land on this clip's), optionally made symmetric (each side averaged with the other side's motion half a cycle
//  later, mirrored), and its own swing % scales its motion about its own average pose. It comes in after this clip's
//  Arm swing % (so that one stays on this clip's motion) and before Arm swing centre / Elbow bend / Arm crossing.
// ============================================================================
const BLEND_REGIONS = [['arms', 'Arms (both)'], ['g:upperNH', 'Upper body (no hips)'], ['g:spine', 'Spine'], ['g:headneck', 'Head & neck'], ['legs', 'Legs (both)'], ['g:Larm', 'Left arm'], ['g:Rarm', 'Right arm'], ['g:Lleg', 'Left leg'], ['g:Rleg', 'Right leg'], ['g:body', 'Whole body (rotations)']];
const BLEND_SPEC = { weight: { range: [0, 1], ref: 0, color: '#6fc3e8', scale: 100, unit: '%', fmt: pct, snap: 0.05 }, swing: { range: [0, 2], ref: 1, color: '#9fb0f0', scale: 100, unit: '%', fmt: pct, snap: 0.05 } };
const BLEND_KEYS = ['weight', 'swing'];
const regionLabel = (r) => (BLEND_REGIONS.find(([k]) => k === r) || [r, r])[1];
function blendBones(region) {   // → bone indices, parents first
  const sub = (b) => { const out = []; b.traverse((o) => o.isBone && !/_End$/i.test(o.name) && out.push(o)); return out; };
  const list = region === 'arms' ? [...sub(rig.side.L.clav), ...sub(rig.side.R.clav)] : region === 'legs' ? [...sub(rig.side.L.thigh), ...sub(rig.side.R.thigh)] : (GROUP_DEFS.find((g) => g.id === region) || { bones: () => [] }).bones();
  return list.map((b) => boneIdx.get(b.name)).filter((i) => i != null).sort((a, b) => a - b);
}
function withClip(cl, fn) { const keep = cur; cur = cl; try { return fn(); } finally { cur = keep; } }
function blendPhase(src, p) {   // this clip's phase → the source clip's (left / right touchdowns matched)
  const a = clipWin('L'), b = clipWin('R'), sa = withClip(src, () => clipWin('L')), sb = withClip(src, () => clipWin('R'));
  if (!a || !b || !sa || !sb) return p;
  const d = mod1(b[0] - a[0]) || 0.5, sd = mod1(sb[0] - sa[0]) || 0.5, x = mod1(p - a[0]);
  return mod1(sa[0] + (x < d ? (x / d) * sd : sd + ((x - d) / (1 - d)) * (1 - sd)));
}
const blendFK = { a: null, b: null, Q1: null, Q2: null, H1: null, H2: null };
function newBlend(clipId, region, dur) { const b = { id: 'l' + Date.now().toString(36) + Math.floor(Math.random() * 1e4), clipId, region, sym: true, collapsed: false }; b.weight = flat(0, dur); b.swing = flat(1, dur); return b; }
// a speed-matched blend: its weight follows the moving speed, 0 at or above `from` (the faster motion's speed), 1 at
// or below `to` (its own clip's speed). Blends in order fast → slow give the motion of the speed he runs at
function blendSpeedW(bl, t) {
  if (!bl.speed) return 1;
  const v = avgSpeedAt(t), { from, to } = bl.speed;
  return smoothB((from - v) / Math.max(1e-3, from - to));
}
function applyBlends(t, Qout) {   // in composePose, after this clip's arm swing
  if (!A.blends || !A.blends.length || !cur || cur.kind !== 'loop') return;
  for (const bl of A.blends) {
    if (bl.bypass) continue;
    const w = clamp(evalPts(bl.weight, t), 0, 1) * blendSpeedW(bl, t); if (w < 1e-4) continue;
    const src = clips.find((c) => c.id === bl.clipId && c.kind === 'loop'); if (!src || src === cur) continue;
    if (!blendFK.a) { blendFK.a = new VirtualFK(rig); blendFK.b = new VirtualFK(rig); blendFK.Q1 = new Float32Array(B * 4); blendFK.Q2 = new Float32Array(B * 4); blendFK.H1 = V3(); blendFK.H2 = V3(); }
    const ps = blendPhase(src, mod1(clipTime(t) / cur.dur)), idx = blendBones(bl.region), F = blendFK.a, G = blendFK.b;
    withClip(src, () => { sampleClip(ps * src.dur, blendFK.Q1, blendFK.H1); if (bl.sym) sampleClip(mod1(ps + 0.5) * src.dur, blendFK.Q2, blendFK.H2); });
    const local = new Map();   // bone index → the source's local rotation (symmetric if asked)
    if (bl.sym) {
      F.run(blendFK.Q1, blendFK.H1, 0); G.run(blendFK.Q2, blendFK.H2, 0);
      const hi = boneIdx.get(rig.b.hips.name), aF = F.delta(hi).invert(), aG = G.delta(hi).invert(), symW = new Map();
      const worldOf = (i) => symW.get(i) || F.Q[i];
      for (const i of idx) {
        const name = rig.bones[i].name, mn = mirrorName(name), mi = mn != null && boneIdx.has(mn) ? boneIdx.get(mn) : i;
        const D1 = aF.clone().multiply(F.delta(i)), D2 = aG.clone().multiply(G.delta(mi)), M2 = new THREE.Quaternion(D2.x, -D2.y, -D2.z, D2.w);
        if (D1.dot(M2) < 0) M2.set(-M2.x, -M2.y, -M2.z, -M2.w);
        const D = D1.clone().slerp(M2, 0.5), world = F.delta(hi).multiply(D).multiply(F.bq[i]);
        symW.set(i, world);
        local.set(i, worldOf(F.parent[i]).clone().invert().multiply(world));
      }
    } else for (const i of idx) local.set(i, new THREE.Quaternion().fromArray(blendFK.Q1, i * 4));
    const k = clamp(evalPts(bl.swing, t), 0, 3), M = Math.abs(k - 1) > 1e-4 ? withClip(src, () => clipMeans()) : null, q = new THREE.Quaternion();
    for (const i of idx) {
      let s = local.get(i); if (!s) continue;
      if (M) s = scaleAbout(M.q[i], s, k, new THREE.Quaternion());
      q.fromArray(Qout, i * 4); if (q.dot(s) < 0) s.set(-s.x, -s.y, -s.z, -s.w);
      q.slerp(s, w).toArray(Qout, i * 4);
    }
  }
}
// timeline block
function drawBlendBlock(id) {
  const bl = (A.blends || []).find((x) => x.id === id); if (!bl) return;
  const src = clips.find((c) => c.id === bl.clipId);
  const hr = mkRow('bone sym blendb'); Object.assign(hr, { kind: 'blend', blend: id });
  hr.h.innerHTML = `<button type="button" class="mini" data-act="fold" aria-expanded="${!bl.collapsed}">${bl.collapsed ? '▸' : '▾'}</button><span class="symtag" style="background:#6fc3e8;color:#111">BLEND</span><span class="name"></span><button type="button" class="mini" data-act="set" title="Source clip, body part, symmetric">⚙</button><button type="button" class="mini" data-act="del" title="Remove">×</button>`;
  hr.h.querySelector('.name').textContent = `${regionLabel(bl.region)} ← ${src ? src.name : '(missing clip)'}${bl.speed ? ` · speed-matched (${bl.speed.from.toFixed(2)} → ${bl.speed.to.toFixed(2)} m/s)` : ''}`;
  hr.h.querySelector('[data-act="fold"]').onclick = () => { bl.collapsed = !bl.collapsed; rebuildRows(); save(); };
  hr.h.querySelector('[data-act="set"]').onclick = () => openBlendDlg(id);
  hr.h.querySelector('[data-act="del"]').onclick = () => confirmDelete(`Remove the blend "${regionLabel(bl.region)} ← ${src ? src.name : ''}" and its tracks?`, () => { pushUndo(); A.blends = A.blends.filter((x) => x.id !== id); A.rowOrder = (A.rowOrder || []).filter((k) => k !== 'bld:' + id); editVersion++; rebuildRows(); save(); });
  addBypass(hr, bl, null);
  hr.lane.innerHTML = '<div class="summary"></div>';
  hr.lane.firstChild.textContent = `${regionLabel(bl.region)} from ${src ? src.name : '?'}, matched to this clip's steps${bl.sym ? ', made symmetric' : ''}.${bl.speed ? ` Speed-matched: none at ${bl.speed.from.toFixed(2)} m/s or faster, fully in at ${bl.speed.to.toFixed(2)} m/s (its own speed) and slower; the weight track scales that.` : ''} Weight 100 % = that motion fully; its own swing % scales it (this clip's Arm swing stays on this clip's arms).`;
  tracksEl.append(hr.el); rows.push(hr);
  if (bl.collapsed) return;
  addTrackRow(`l|${id}|weight`, BLEND_SPEC.weight, () => bl.weight, (p) => { bl.weight = p; }, 'Blend weight <i>% of the other clip\'s motion</i>', { type: 'blend', id, k: 'weight' });
  addTrackRow(`l|${id}|swing`, BLEND_SPEC.swing, () => bl.swing, (p) => { bl.swing = p; }, 'Its swing <i>% · scales the other clip\'s motion about its average</i>', { type: 'blend', id, k: 'swing' });
}
let dlgBlend = null;
function openBlendDlg(id) {
  const bl = id ? (A.blends || []).find((x) => x.id === id) : null; dlgBlend = id || null;
  const cs = $('bldClip'); cs.textContent = '';
  for (const c of clips) if (c.kind === 'loop' && c !== cur) { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; cs.append(o); }
  const rs = $('bldRegion'); rs.textContent = ''; for (const [k, l] of BLEND_REGIONS) { const o = document.createElement('option'); o.value = k; o.textContent = l; rs.append(o); }
  const pick = (re) => clips.find((c) => c.kind === 'loop' && c !== cur && re.test(c.name)), jog = pick(/jog.?slow/i) || pick(/jog.?forward/i) || pick(/^(?!.*(back|strafe)).*jog/i);
  cs.value = bl ? bl.clipId : jog ? jog.id : (cs.options[0] || {}).value; rs.value = bl ? bl.region : 'arms'; $('bldSym').checked = bl ? !!bl.sym : true;
  $('bldOk').textContent = bl ? 'Apply' : 'Add'; $('bldDlg').hidden = false;
}
$('bldOk').onclick = () => {
  const clipId = $('bldClip').value, region = $('bldRegion').value, sym = $('bldSym').checked; if (!clipId) return;
  pushUndo(); A.blends = A.blends || [];
  const bl = dlgBlend && A.blends.find((x) => x.id === dlgBlend);
  if (bl) Object.assign(bl, { clipId, region, sym });
  else { const n = newBlend(clipId, region, S.dur); n.sym = sym; n.weight = flat(1, S.dur); A.blends.push(n); addRowKey('bld:' + n.id); }
  $('bldDlg').hidden = true; editVersion++; trailDirty = true; rebuildRows(); save();
};
$('bldCancel').onclick = () => { $('bldDlg').hidden = true; };
$('bldDlg').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('bldDlg').hidden = true; e.stopPropagation(); });

// ============================================================================
//  ARM SWING STAYS VERTICAL: the trunk's pitch (lean, hip rotation, a forcer's lean) is taken back out of the upper
//  arms about the body's side axis, so they swing about the same world line as in the clip (not tipped with the chest)
// ============================================================================
const armVerticalOn = () => !!(A && A.armVertical !== false && cur && cur.kind === 'loop');
function bodySideAxis() {   // horizontal, right-pointing axis of the body (shoulder to shoulder)
  const a = worldP(rig.side.L.upper), b = worldP(rig.side.R.upper), v = b.sub(a); v.y = 0;
  return v.lengthSq() > 1e-8 ? v.normalize() : V3(1, 0, 0);
}
function chestUpW() {   // the upper chest's up line and the side axis, in the world, now
  const up = worldP(rig.b.neck).sub(worldP(rig.b.spine2)).normalize();   // the upper chest, where the shoulders sit
  return { up, side: bodySideAxis() };
}
const _avQ = new THREE.Quaternion();
function armsUpright(ref) {
  const now = chestUpW(), ax = ref.side;
  // signed pitch of the chest about the side axis (both up lines projected onto the body's mid-plane)
  const pa = ref.up.clone().addScaledVector(ax, -ref.up.dot(ax)), pb = now.up.clone().addScaledVector(ax, -now.up.dot(ax));
  if (pa.lengthSq() < 1e-8 || pb.lengthSq() < 1e-8) return 0;
  pa.normalize(); pb.normalize();
  const ang = Math.atan2(pa.clone().cross(pb).dot(ax), clamp(pa.dot(pb), -1, 1));
  if (Math.abs(ang) < 1e-5) return 0;
  _avQ.setFromAxisAngle(ax, -ang);
  for (const Sd of ['L', 'R']) { rotateBoneWorld(rig.side[Sd].upper, _avQ); }
  rig.b.hips.updateMatrixWorld(true);
  return ang;
}

// ============================================================================
//  TEMPLATE: SPRINT → RESISTED RUN. 10 bars; a forcer 4 m in front of the runner (moving with him, pointing back at
//  him, no falloff) comes on at exactly the start of bar 4 and eases (S curve) to its full push by the start of bar 8;
//  from bar 8 nothing changes. The body answers it the way resisted (sled / parachute) sprinting does: trunk lean into
//  the push, shorter strides (more than the cadence drops), longer contacts, more flexed knees and hips; the speed
//  eases down (no jerk). The arm swing keeps its world angle (Arm swing stays vertical).
// ============================================================================
const RESIST_TPL = { bars: 10, onBar: 4, fullBar: 8, distM: 4, heightM: 1.0, forceN: 230, knee: 112, spread: 60, arm: 90, hip: 90, cyc: 106, gnd: 8 };
function applySprintResist(o = {}) {
  const v = { ...RESIST_TPL, ...o };
  if (!cur || cur.kind !== 'loop') return 'Load the sprint (a loop clip) as the motion first.';
  if (!(cur.c.speed > 0.05)) return 'This clip has no travel speed: set its m/s (Clip → Travel) first.';
  pushUndo();
  const dur = cur.dur, P = (t, val, e) => (e ? { t, v: val, k: 0, e } : { t, v: val, k: 0 });
  const n = newAuto(+(v.bars * dur * 1.6).toFixed(3), v.bars);
  for (const k of ['rowOrder', 'subOrder', 'heights', 'ranges']) if (A[k]) n[k] = A[k];
  A = normalizeAuto(n); S.dur = A.dur;
  A.body = { mass: 75, keepSpeed: false };   // the push slows him down (keep speed would raise the cadence instead)
  const f = newForcer('moving', S.dur, 1);
  Object.assign(f, { name: 'Resistance (4 m ahead)', falloff: 'none' });
  f.at = { px: 0, py: v.heightM, pz: v.distM, fx: 0, fy: 180, fz: 0 };   // in front, facing back at him: it pushes him back
  f.spread = flat(v.spread, S.dur); f.weight = flat(1, S.dur); f.resp = flat(0, S.dur);   // resisted: he leans into it
  f.target.bw = { chest: 100, spine: 50, hips: 20 };   // the push bends the trunk: chest most, lower spine half, pelvis a little (the arms keep their swing)
  A.forcers = [f];
  A.armAuto = false; A.hipAuto = false; A.armCentreAuto = false;   // the bars before the push stay the clip's own; the swing eases down by its own tracks
  A.showMaster = { ...A.showMaster, run: true, mspeed: true, cycle: false, stride: false, move: false, gnd: false };
  A.runShow = { kneeDepth: true, armSwing: true, hipMotion: true, cyc: true };
  A.showMaster.gnd = true; A.armVertical = true; A.speedLock = false;
  const B = (x) => Math.min(S.dur, timeOfClipTime((x - 1) * dur));
  const place = () => {
    const t0 = B(v.onBar), t1 = B(v.fullBar);
    f.force = [P(0, 0), P(t0, 0, 'inout'), P(t1, v.forceN), P(S.dur, v.forceN)];
    A.kneeDepth = [P(0, 100), P(t0, 100, 'inout'), P(t1, v.knee), P(S.dur, v.knee)];
    A.armSwing = [P(0, 100), P(t0, 100, 'inout'), P(t1, v.arm), P(S.dur, v.arm)];
    A.hipMotion = [P(0, 100), P(t0, 100, 'inout'), P(t1, v.hip), P(S.dur, v.hip)];
    A.cyc = [P(0, 100), P(t0, 100, 'inout'), P(t1, v.cyc), P(S.dur, v.cyc)];   // the cadence drops less than the stride (sled studies)
    A.gnd = [P(0, 0), P(t0, 0, 'inout'), P(t1, v.gnd), P(S.dur, v.gnd)];   // longer ground contacts
  };
  for (let it = 0; it < 12; it++) { place(); rebuildSpeedLUT(); }   // the push lowers the cadence: the bars move, the points follow
  S.dur = A.dur = +timeOfClipTime(v.bars * dur).toFixed(3); place(); rebuildSpeedLUT(); place();
  A.cycles = v.bars; A.cycLocked = true;
  S.t = 0; S.v0 = 0; moveEndCache = null; editVersion++; holdCache.clear();
  ensureEnds(); rebuildSpeedLUT(); lockCycles(true); syncLenInputs(); rebuildRows(); save();
  return `Sprint → resisted run: ${v.bars} bars; a ${v.forceN} N push from ${v.distM} m ahead starts at bar ${v.onBar} and is full at bar ${v.fullBar}; knee depth ${v.knee} %, cycle speed ${v.cyc} %, foot on ground +${v.gnd} %, arm swing ${v.arm} %, hip motion ${v.hip} %; bars ${v.fullBar}–${v.bars} hold still.`;
}

// ============================================================================
//  TEMPLATE: WALK → RUN. Standard walk, symmetrized (left / right averaged), turned into a run over the whole timeline:
//  a run's cadence, longer steps (hard + natural: the extra flown), shorter contacts (foot on ground −) and a hop so
//  both feet leave the ground, deeper stance knees (the body dips at mid-stance, not rises as in a walk), bent elbows,
//  a bigger arm swing and a little forward lean. Every value is a flat track: edit it, or key it to blend in.
// ============================================================================
const W2R = { bars: 8, clip: 'loop:Standard_walk', cyc: 135, stride: 125, nat: 135, gnd: -4, jump: 80, knee: 170, elbow: 50, arm: 95, lean: 14 };
function symmetrizeClip(id) {   // the Symmetrize tool on this clip, average mode (once: a clip already processed stays)
  const c = clips.find((x) => x.id === id); if (!c) return 'missing';
  if (BAKED[c.id]) return 'kept';
  const keepMode = $('stMode').value;
  try {
    $('stMode').value = 'avg';
    ST.clip = c; ST.src = c.c.origBk; ST.saved = true;
    stProcess(); stSave();
  } finally { $('stMode').value = keepMode; ST.clip = null; ST.res = null; }
  return 'done';
}
function applyWalkToRun(o = {}) {
  const v = { ...W2R, ...o };
  if (!clips.find((x) => x.id === v.clip)) return 'Standard walk is not in the library.';
  if (!seqActive()) seqAdd(v.clip, 1, 0, v.bars);
  else if (SEQ.motions[SEQ.sel].clipId !== v.clip) seqSetClip(SEQ.sel, v.clip);
  const sym = symmetrizeClip(v.clip);
  pushUndo();
  const dur = cur.dur, n = newAuto(+(v.bars * dur / (v.cyc / 100)).toFixed(3), v.bars);
  for (const k of ['rowOrder', 'subOrder', 'heights', 'ranges']) if (A[k]) n[k] = A[k];
  A = normalizeAuto(n); S.dur = A.dur;
  const F = (x) => flat(x, S.dur);
  Object.assign(A, { cyc: F(v.cyc), stride: F(v.stride), stepNat: F(v.nat), gnd: F(v.gnd), jump: F(v.jump), kneeDepth: F(v.knee), elbowBend: F(v.elbow), armSwing: F(v.arm), lean: F(v.lean) });
  A.showMaster = { ...A.showMaster, run: true, mspeed: true, gnd: true, cycle: false, stride: false, move: false };
  A.runShow = { cyc: true, stride: true, stepNat: true, jump: true, kneeDepth: true, elbowBend: true, armSwing: true, lean: true };
  A.armVertical = true; A.speedLock = false; A.jumpAuto = false; A.strideArms = true;
  A.cycles = v.bars; A.cycLocked = true;
  S.t = 0; S.v0 = 0; moveEndCache = null; editVersion++; holdCache.clear();
  ensureEnds(); rebuildSpeedLUT(); lockCycles(true); syncLenInputs(); rebuildRows(); save();
  return `Walk → Run: Standard walk ${sym === 'done' ? 'symmetrized (average) and ' : sym === 'kept' ? '(already processed) ' : ''}turned into a run over ${v.bars} bars: cycle speed ${v.cyc} %, step length ${v.stride} % hard × ${v.nat} % natural, foot on ground ${v.gnd} %, jump ${v.jump} %, knee depth ${v.knee} %, elbow +${v.elbow}°, arm swing ${v.arm} %, lean +${v.lean}°.`;
}

// ============================================================================
//  BRAKING TEMPLATES. Each writes the selected motion (its own clip, usually the sprint): bars 1–3 untouched, the
//  change on S curves over its transition bars, then held (the last bars do not change). Points sit on bar starts and
//  follow the bars as the cadence changes. The run "follow" options are off so the bars before the change stay the clip's.
//   1. Lean-back braking → decel jog: spine back, hips up (shallower knees), longer steps landing ahead, cadence down;
//      then a jog with long steps and a slow jog's arm swing (Jog slow arms blended in).
//   2. Lean-back + choppy steps: spine back, hips up, short steps at a higher cadence, a little contact braking.
//   3. Sleep deceleration: no braking, no push: the sprint coasts down over 11 bars (cadence down, steps a little
//      longer, spine back), then a jog with long steps, then a walk (a three-motion sequence).
// ============================================================================
function tplWrite(bars, spec, after) {   // spec: { track: [[bar, value, curve?], …] } (bar = 1-based bar start)
  const dur = cur.dur, P = (t, val, e) => (e ? { t, v: val, k: 0, e } : { t, v: val, k: 0 });
  const n = newAuto(+(bars * dur * 1.8).toFixed(3), bars);
  for (const k of ['rowOrder', 'subOrder', 'heights', 'ranges']) if (A[k]) n[k] = A[k];
  A = normalizeAuto(n); S.dur = A.dur;
  Object.assign(A, { armAuto: false, hipAuto: false, armCentreAuto: false, jumpAuto: false, armVertical: true, speedLock: false });
  const B = (x) => Math.min(S.dur, timeOfClipTime((x - 1) * dur));
  const place = () => {
    for (const [key, list] of Object.entries(spec)) {
      const pts = [P(0, list[0][1])]; for (const [x, val, e] of list) pts.push(P(B(x), val, e)); pts.push(P(S.dur, list[list.length - 1][1]));
      A[key] = pts;
    }
    if (after) after(B, P);
  };
  for (let it = 0; it < 12; it++) { place(); rebuildSpeedLUT(); }
  S.dur = A.dur = +timeOfClipTime(bars * dur).toFixed(3); place(); rebuildSpeedLUT(); place();
  A.cycles = bars; A.cycLocked = true;
  S.t = 0; S.v0 = 0; moveEndCache = null; editVersion++; holdCache.clear();
  ensureEnds(); rebuildSpeedLUT(); lockCycles(true); syncLenInputs();
}
const SC = 'inout';   // an S curve to the next point
// the braking itself is a Brake forcer (4 m ahead, facing him, no falloff): its force slows him (a = F / m), leans him
// back (atan(a / g)), lifts the hips and splits the speed loss between cadence and step length (cadence share); the
// force is solved so the speed lands on the template's target, then it ends (the speed stays down, the lean comes back)
// the arms in the run phase come from a CMU run (Run medium's own forward arm swings up to 69° with the elbow half open);
// the jog is a CMU jog capture (elbows ~100–120°, hands from the hips to the chest, as in running-form studies)
const RUN_ARMS = { clip: 'cmu:09_07', swing: 1.2 };
// run → jog: a small hop at the handover (an S-curve bump on Jump, peak at the end of the blend bars, gone a bar later)
const HOP = [[1, 0, SC], [2, 30, SC], [3.5, 0]];
// Standard walk swings its arms almost only forward (shoulder −4° … +49°, the hand 36 cm ahead with the elbow straight):
// the centre back to the body line, a little less swing and a little elbow (→ −21° … +27°)
const WALK_ARMS = { armCentre: [[1, -22]], armSwing: [[1, 90]], elbowBend: [[1, 10]] };
const BRAKE_TPL = {
  // the sprint starts braking (lean back, hips up) and hands over to Run medium, whose own steps are longer (1.66 m
  // against 1.49) at its own cadence: long braking steps without slow motion; it brakes on, then a long-step jog
  leanBack: { bars: 5, on: [4, 5, 5, 6], target: 0.88, share: 35, hip: 20, spec: {},
    chain: [
      { clip: 'loop:Run_medium', start: 6, blend: 2, bars: 3, brake: { on: [1, 2, 4, 5], target: 0.85, share: 70, hip: 20 }, spec: { brake: [[1, 0, SC], [2, 0.4, SC], [4, 0.4, SC], [5, 0]] }, arms: RUN_ARMS },
      { clip: 'cmu:35_17', start: 10, blend: 2, bars: 5, stepNat: 115, hop: HOP },
    ] },
  choppy: { bars: 10, on: [4, 5, 6, 7], target: 0.77, share: -30, hip: 20, spec: { armSwing: [[4, 100, SC], [7, 80]] } },
  // no braking: light Brake forcers let each clip coast down; every clip plays at its own cadence (≥ 85 %)
  sleep: { bars: 8, on: [4, 5, 7, 8], target: 0.8, share: 35, hip: 8, spec: {},
    chain: [
      { clip: 'loop:Run_medium', start: 10, blend: 2, bars: 5, brake: { on: [3, 4, 6, 7], target: 0.85, share: 35, hip: 8 }, arms: RUN_ARMS },
      { clip: 'cmu:35_17', start: 15, blend: 2, bars: 7, stepNat: 108, hop: HOP },
      { clip: 'loop:Standard_walk', start: 22, blend: 3, bars: 6, sym: true, spec: WALK_ARMS },
    ] },
  // Braking 1, then the jog comes to a stop where it is and goes on running on the spot (forward travel → 0)
  inPlace: { bars: 5, on: [4, 5, 5, 6], target: 0.88, share: 35, hip: 20, spec: {},
    chain: [
      { clip: 'loop:Run_medium', start: 6, blend: 2, bars: 3, brake: { on: [1, 2, 4, 5], target: 0.85, share: 70, hip: 20 }, spec: { brake: [[1, 0, SC], [2, 0.4, SC], [4, 0.4, SC], [5, 0]] }, arms: RUN_ARMS },
      { clip: 'cmu:35_17', start: 10, blend: 2, bars: 9, hop: HOP, spec: { fwd: [[4, 100, SC], [7, 0]], lean: [[4, 0, SC], [7, -4]] } },
    ] },
};
function brakeForcer(v, B, P, st) {   // the Brake forcer; st.F is solved toward the target speed at the end of the braking
  let f = (A.forcers || []).find((x) => x.tpl === 'brake');
  if (!f) { f = newForcer('moving', S.dur, 1); Object.assign(f, { tpl: 'brake', name: 'Braking (4 m ahead)', falloff: 'none', react: 'brake' }); f.at = { px: 0, py: 1.0, pz: 4, fx: 0, fy: 180, fz: 0 }; f.target.bw = {}; A.forcers = [f]; }
  Object.assign(f, { cadShare: v.share, hipRise: v.hip, split: v.ratio ? 'ratio' : 'share', stepPerCad: v.ratio || 2 }); f.spread = flat(60, S.dur); f.weight = flat(1, S.dur); f.resp = flat(0, S.dur);
  const [a0, a1, a2, a3] = v.on;
  f.force = [P(0, 0), P(B(a0), 0, SC), P(B(a1), st.F), P(B(a2), st.F, SC), P(B(a3), 0), P(S.dur, 0)];
  resistClear();
  const got = brakeState(B(a3)).speedK;   // speed left when the force ends
  if (got < 0.999) st.F = clamp(st.F * (1 - v.target) / Math.max(1e-3, 1 - got), 5, 3000);
  f.force = [P(0, 0), P(B(a0), 0, SC), P(B(a1), st.F), P(B(a2), st.F, SC), P(B(a3), 0), P(S.dur, 0)];
  resistClear();
  return f;
}
function brakeTplCheck() {
  if (!cur || cur.kind !== 'loop') return 'Load the sprint (a loop clip) as the motion first.';
  if (!(cur.c.speed > 0.05)) return 'This clip has no travel speed: set its m/s (Clip → Travel) first.';
  return null;
}
function brakeTplShow(extra) {
  A.showMaster = { ...A.showMaster, run: true, mspeed: true, cycle: false, stride: false, move: false, gnd: false };
  A.runShow = { ...extra };
}
const brakeMsg = (v, st) => `${Math.round(st.F)} N for ${v.on[3] - v.on[0]} bars (bars ${v.on[0]}–${v.on[3]}) → ${Math.round(v.target * 100)} % of the speed, cadence share ${v.share} %`;
function seqTail(si) {   // a template that adds motions after the selected one needs it to be the last
  if (!seqActive()) return 'Add the sprint as a motion first.';
  if (si !== SEQ.motions.length - 1) return 'Select the last motion (the sprint): the next motions are added after it.';
  return null;
}
function seqAppend(m) {   // add a motion after the last one and write its tracks (flat natural step, an optional coasting Brake forcer)
  if (!clips.find((c) => c.id === m.clip)) return `${m.clip.split(':')[1]} is missing from the library.`;
  if (m.sym) symmetrizeClip(m.clip);
  seqRebuild(true);
  if (seqAdd(m.clip, m.start, m.blend, m.bars, true) === false) return `Could not add ${m.clip.split(':')[1]}.`;
  const st = { F: 40 }, arms = m.arms && clips.find((c) => c.id === m.arms.clip);
  const spec = { ...(m.spec || {}), ...(m.stepNat ? { stepNat: [[1, m.stepNat]] } : {}), ...(m.hop ? { jump: m.hop } : {}) };
  tplWrite(A.cycles, spec, (B, P) => {
    if (m.brake) brakeForcer(m.brake, B, P, st);
    if (arms) { const bl = newBlend(arms.id, 'arms', S.dur); Object.assign(bl, { tpl: 'arms', sym: true }); bl.weight = flat(1, S.dur); bl.swing = flat(m.arms.swing || 1, S.dur); A.blends = [bl]; }
  });
  brakeTplShow(Object.fromEntries(Object.keys(spec).map((k) => [k, true]))); ensureEnds(); rebuildRows(); save(); seqRebuild(true);
  return null;
}
function brakeChainTpl(v, label) {
  const bad = brakeTplCheck() || seqTail(SEQ.sel); if (bad) return bad;
  const st = { F: 60 }, si = SEQ.sel;
  pushUndo();
  tplWrite(v.bars, v.spec, (B, P) => brakeForcer(v, B, P, st));
  brakeTplShow({}); ensureEnds(); rebuildRows(); save();
  for (const m of v.chain) { const err = seqAppend(m); if (err) return err; }
  seqSelect(si, false); seqSetT(0);
  return label;
}
function applyBrakeLeanBack() {
  const v = BRAKE_TPL.leanBack;
  return brakeChainTpl(v, `Braking 1 · lean back, long braking steps → decel jog: the sprint starts braking at bar 4 (Brake forcer: leans back, hips up), hands over to Run medium (its own longer steps, CMU run arms) which brakes on; a CMU jog (long steps, a small hop at the handover) fully in at bar ${v.chain[1].start}.`);
}
function applyBrakeInPlace() {
  const v = BRAKE_TPL.inPlace;
  return brakeChainTpl(v, `Braking 4 · decelerate → jog on the spot: as Braking 1, then the CMU jog stops travelling over bars 13–16 (forward travel 100 → 0 %) and keeps jogging on the spot to bar ${v.chain[1].start + v.chain[1].bars - 1}.`);
}
function applyBrakeChoppy() {
  const bad = brakeTplCheck(); if (bad) return bad;
  const v = BRAKE_TPL.choppy, st = { F: 90 };
  pushUndo(); tplWrite(v.bars, v.spec, (B, P) => brakeForcer(v, B, P, st));
  brakeTplShow({ armSwing: true }); ensureEnds(); rebuildRows(); save();
  return `Braking 2 · lean back, choppy steps: a Brake forcer ${brakeMsg(v, st)} (faster, shorter steps; leans back, hips up).`;
}
function applyBrakeSleep() {
  const bad = brakeTplCheck() || seqTail(SEQ.sel); if (bad) return bad;
  const v = BRAKE_TPL.sleep, st = { F: 40 }, si = SEQ.sel;
  pushUndo(); tplWrite(v.bars, v.spec, (B, P) => brakeForcer(v, B, P, st));
  brakeTplShow({}); ensureEnds(); rebuildRows(); save();
  for (const m of v.chain) { const err = seqAppend(m); if (err) return err; }
  seqSelect(si, false); seqSetT(0);
  return `Braking 3 · sleep deceleration: the sprint coasts (Brake forcer ${brakeMsg(v, st)}), Run medium coasts on from bar ${v.chain[0].start}, Jog slow from bar ${v.chain[1].start}, Standard walk from bar ${v.chain[2].start}; every clip at its own cadence.`;
}

// ---------------------------------------------------------------- Sprint → braking: cadence up, steps down
// The sprint with a Brake forcer (4 m ahead, facing him): every 1 % more cadence takes 2 % off the step length, so the
// speed falls ((1 + c)(1 − 2c)), the spine leans back with the braking (atan(a / g)), and the arms come from the motion
// of the speed he is running at (speed-matched blends of the slower clips, fast → slow). Braking bars 4–8, down to
// half the sprint's speed (jog speed).
const CADBRAKE = { bars: 10, on: [4, 5, 7, 8], target: 0.5, share: 35, hip: 10, ratio: 2, spec: {}, arms: ['loop:Run_steady', 'cmu:09_07', 'cmu:35_17', 'cmu:16_35'], sprint: 'loop:Run_steady_fast' };
function applySprintCadBrake(o = {}) {
  const v = { ...CADBRAKE, ...o };
  if (!(cur && cur.kind === 'loop' && cur.c.speed >= 4)) {   // load the sprint (the loaded clip if it is a fast run)
    if (!clips.find((c) => c.id === v.sprint)) return 'The sprint clip is missing.';
    if (!seqActive()) seqAdd(v.sprint, 1, 0, v.bars); else seqSetClip(SEQ.sel, v.sprint);
  }
  const bad = brakeTplCheck(); if (bad) return bad;
  const st = { F: 120 };
  pushUndo();
  tplWrite(v.bars, v.spec, (B, P) => brakeForcer(v, B, P, st));
  // the arms: the slower clips' arms, each fully in at its own speed (blended between neighbours), fast → slow
  const v0 = cur.c.speed, srcs = v.arms.map((id) => clips.find((c) => c.id === id && c.kind === 'loop')).filter((c) => c && c.c.speed < v0 - 0.05).sort((a, b) => b.c.speed - a.c.speed);
  A.blends = []; let from = v0;
  for (const c of srcs) { const bl = newBlend(c.id, 'arms', S.dur); bl.sym = true; bl.weight = flat(1, S.dur); bl.swing = flat(1, S.dur); bl.speed = { from, to: c.c.speed }; bl.collapsed = true; A.blends.push(bl); from = c.c.speed; }
  brakeTplShow({}); A.showMaster.mspeed = true;
  editVersion++; ensureEnds(); rebuildSpeedLUT(); rebuildRows(); save();
  const per = []; for (let b = 1; b <= v.bars; b++) { const t = timeOfClipTime((b - 0.5) * cur.dur), s = brakeState(t); per.push(`${b}: ${(v0 * s.speedK).toFixed(2)} m/s ×${s.cad.toFixed(2)} cad ×${s.step.toFixed(2)} step`); }
  return `Sprint → braking (cadence up, steps down): Brake forcer ${Math.round(st.F)} N over bars ${v.on[0]}–${v.on[3]}, each 1 % more cadence takes ${v.ratio} % off the step; arms from ${srcs.map((c) => c.name).join(' → ')} by speed. Per bar ${per.join(' · ')}.`;
}
