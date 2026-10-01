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
  let best = -1, prev = 0;
  for (let k = 1; k <= N; k++) {   // the least lift that reaches
    const a = HEEL_MAX * k / N;
    if (at(a).distanceTo(hip) <= R) { let lo = prev, hi = a; for (let it = 0; it < 14; it++) { const m = (lo + hi) / 2; if (at(m).distanceTo(hip) > R) lo = m; else hi = m; } best = hi; break; }
    prev = a;
  }
  if (air) best = Math.min(best < 0 ? HEEL_MAX : best, 15 * DEG);   // just before touchdown: a little (never the search below: it can jump)
  else if (best < 0) {   // out of reach even then: the lift that gets closest (a continuous search, so it does not jump)
    let lo = 0, hi = HEEL_MAX; for (let it = 0; it < 30; it++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (at(m1).distanceTo(hip) <= at(m2).distanceTo(hip)) hi = m2; else lo = m1; }
    best = (lo + hi) / 2;
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
  const lp = legPhase(Sd, clipTime(t)); if (!lp || lp.c) return 1;
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
const centreAutoOn = () => !!(A && A.armCentreAuto !== false && speedVaries());
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
const armAutoOn = () => !!(A && A.armAuto !== false && speedVaries()), hipAutoOn = () => !!(A && A.hipAuto !== false && speedVaries());
const armSwingOn = () => !!(A && cur && cur.kind === 'loop' && (!trackOff(A.armSwing, 100) || armAutoOn()));
const hipMotionOn = () => !!(A && cur && cur.kind === 'loop' && (!trackOff(A.hipMotion, 100) || hipAutoOn()));
const armShapeOn = () => !!(A && (!trackOff(A.elbowBend, 0) || !trackOff(A.armCross, 0) || !trackOff(A.armCentre, 0) || (cur && cur.kind === 'loop' && centreAutoOn())));
function armScaleAt(t) { return (A.armSwing ? evalPts(A.armSwing, t) / 100 : 1) * (A.armAuto !== false ? Math.max(0, 1 + MOTK.armAuto * (speedRatio(t) - 1)) : 1); }
function hipScaleAt(t) { return (A.hipMotion ? evalPts(A.hipMotion, t) / 100 : 1) * (A.hipAuto !== false ? Math.max(0, 1 + MOTK.hipAuto * (speedRatio(t) - 1)) : 1); }
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
  const eb = A.elbowBend ? evalPts(A.elbowBend, t) : 0, cr = A.armCross ? evalPts(A.armCross, t) : 0, ce = armCentreAt(t);
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
      const sh = worldP(sd.upper), el = worldP(sd.fore), u = el.clone().sub(sh), f = worldP(sd.hand).sub(el), ax = V3().crossVectors(u, f);
      if (ax.lengthSq() < 1e-10) continue;
      const a = u.angleTo(f), a2 = clamp(a + eb * DEG, 3 * DEG, 150 * DEG);
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
  sub.push(addTrackRow('brakeRhythm', RHYTHM_SPEC, () => A.brakeRhythm, (p) => { A.brakeRhythm = p; }, 'Brake rhythm <i>% · slow in contact, fast after toe-off (bars keep their length)</i>', null));
  sub.push(addTrackRow('armSwing', ARMSW_SPEC, () => A.armSwing, (p) => { A.armSwing = p; }, `Arm swing <i>% · arms, shoulders, shoulder twist${A.armAuto !== false ? ' · × moving speed' : ''}</i>`, null));
  sub.push(addTrackRow('armCentre', CENTRE_SPEC, () => A.armCentre, (p) => { A.armCentre = p; }, `Arm swing centre <i>° · + forward / − back${A.armCentreAuto !== false ? ' · + slowing: back, speeding up: forward' : ''}</i>`, null));
  sub.push(addTrackRow('elbowBend', ELBOW_SPEC, () => A.elbowBend, (p) => { A.elbowBend = p; }, 'Elbow bend <i>° · + more bent / − straighter</i>', null));
  sub.push(addTrackRow('armCross', CROSS_SPEC, () => A.armCross, (p) => { A.armCross = p; }, 'Arm crossing <i>° · + in toward the middle / − out</i>', null));
  sub.push(addTrackRow('hipMotion', HIPMO_SPEC, () => A.hipMotion, (p) => { A.hipMotion = p; }, `Hip motion <i>% · pelvis turn, drop, bob, sway${A.hipAuto !== false ? ' · × moving speed' : ''}</i>`, null));
  sub.push(addTrackRow('jump', JUMP_SPEC, () => A.jump, (p) => { A.jump = p; }, `Jump <i>% · a hop at each change of foot (100 % = 6 cm)${A.jumpAuto !== false ? ' · + longer steps' : ''}</i>`, null));
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
  let j = A.jump ? evalPts(A.jump, t) : 0;
  if (A.jumpAuto !== false && A.stride) j += JUMPK.perStride * Math.max(0, evalPts(A.stride, t) - 100);
  return Math.max(0, j);
}
const jumpOn = () => !!(A && cur && cur.kind === 'loop' && clipWin('L') && clipWin('R') && (!trackOff(A.jump, 0) || (A.jumpAuto !== false && A.stride && A.stride.some((p) => p.v > 100.5))));
function jumpLift(t) {   // m the hips rise at t
  const j = jumpPct(t); if (j < 1e-3) return 0;
  const wL = clipWin('L'), wR = clipWin('R'), p = mod1(clipTime(t) / cur.dur);
  const mL = mod1(wL[0] + mod1(wL[1] - wL[0]) / 2), mR = mod1(wR[0] + mod1(wR[1] - wR[0]) / 2);
  const dLR = mod1(mR - mL) || 0.5, a = mod1(p - mL), x = a < dLR ? a / dLR : (a - dLR) / (1 - dLR);
  return (j / 100) * (JUMPK.cmAt100 / 100) * (0.5 - 0.5 * Math.cos(2 * Math.PI * x));
}

// the feet: only the middle of each contact stays on the ground (100 % → the middle 55 %); towards its ends the foot
// rises (up to 3 cm at 100 %), carrying on smoothly into the swing, so the contact is shorter and the flight longer
function jumpFootRise(Sd, t) {
  const j = clamp(jumpPct(t) / 100, 0, 2); if (j < 1e-3) return 0;
  const lp = legPhase(Sd, clipTime(t)); if (!lp) return 0;
  const H = j * JUMPK.footCm / 100, half = 0.5 * (1 - 0.45 * Math.min(1, j));
  if (lp.c) return H * smoothB((Math.abs(lp.u - 0.5) - half) / Math.max(1e-3, 0.5 - half));
  return H * Math.max(1 - smoothB(lp.s / 0.2), smoothB((lp.s - 0.8) / 0.2));
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
function applyBlends(t, Qout) {   // in composePose, after this clip's arm swing
  if (!A.blends || !A.blends.length || !cur || cur.kind !== 'loop') return;
  for (const bl of A.blends) {
    if (bl.bypass) continue;
    const w = clamp(evalPts(bl.weight, t), 0, 1); if (w < 1e-4) continue;
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
  hr.h.querySelector('.name').textContent = `${regionLabel(bl.region)} ← ${src ? src.name : '(missing clip)'}`;
  hr.h.querySelector('[data-act="fold"]').onclick = () => { bl.collapsed = !bl.collapsed; rebuildRows(); save(); };
  hr.h.querySelector('[data-act="set"]').onclick = () => openBlendDlg(id);
  hr.h.querySelector('[data-act="del"]').onclick = () => confirmDelete(`Remove the blend "${regionLabel(bl.region)} ← ${src ? src.name : ''}" and its tracks?`, () => { pushUndo(); A.blends = A.blends.filter((x) => x.id !== id); A.rowOrder = (A.rowOrder || []).filter((k) => k !== 'bld:' + id); editVersion++; rebuildRows(); save(); });
  addBypass(hr, bl, null);
  hr.lane.innerHTML = '<div class="summary"></div>';
  hr.lane.firstChild.textContent = `${regionLabel(bl.region)} from ${src ? src.name : '?'}, matched to this clip's steps${bl.sym ? ', made symmetric' : ''}. Weight 100 % = that motion fully; its own swing % scales it (this clip's Arm swing stays on this clip's arms).`;
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
