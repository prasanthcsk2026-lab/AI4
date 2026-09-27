
// ============================================================================
//  POSE PIPELINE
//   1. FK: the clip over the idle, shaped per bone (weight, adjust, timing), at the speed-warped clip time
//   2. root travel: unless "in place", the hips carry the clip's root motion (loops: speed × clip time
//      along the clip's direction; one-shot moves: their captured root path), continuing across loops
//   3. full-body IK on top (HumanIK style): hips → spine / head / shoulders → hands (with pull) → arms →
//      legs → feet / toes → fingers. Every effector is an offset over what FK gives, so the clip stays alive.
// ============================================================================

// ---------------------------------------------------------------- IK effectors
const pct = (v) => Math.round(v * 100) + '%';
const sgn = (v, d, u) => (v >= 0 ? '+' : '') + v.toFixed(d) + u;
const flagFmt = (v) => (v >= 0.5 ? 'on' : 'off');
const TRK = {
  blend: { label: 'IK blend', range: [0, 1], ref: 1, color: COL.ik, fmt: pct, snap: 0.05 },
  px: { label: 'Move X', range: [-80, 80], ref: 0, color: COL.pos, fmt: (v) => sgn(v, 1, ' cm'), snap: 0.5, axis: 'x', kind: 'p' },
  py: { label: 'Move Y', range: [-80, 80], ref: 0, color: COL.pos, fmt: (v) => sgn(v, 1, ' cm'), snap: 0.5, axis: 'y', kind: 'p' },
  pz: { label: 'Move Z', range: [-80, 80], ref: 0, color: COL.pos, fmt: (v) => sgn(v, 1, ' cm'), snap: 0.5, axis: 'z', kind: 'p' },
  rx: { label: 'Rotate X', range: [-120, 120], ref: 0, color: COL.rot, fmt: (v) => sgn(v, 1, '°'), snap: 1, axis: 'x', kind: 'r' },
  ry: { label: 'Rotate Y', range: [-120, 120], ref: 0, color: COL.rot, fmt: (v) => sgn(v, 1, '°'), snap: 1, axis: 'y', kind: 'r' },
  rz: { label: 'Rotate Z', range: [-120, 120], ref: 0, color: COL.rot, fmt: (v) => sgn(v, 1, '°'), snap: 1, axis: 'z', kind: 'r' },
  feet: { label: 'Feet stay planted', range: [0, 1], ref: 1, color: COL.flag, fmt: pct, snap: 0.05, hint: '100 % = feet keep their FK spot when the hips move' },
  pin: { label: 'Pin', range: [0, 1], ref: 0, color: COL.flag, fmt: pct, snap: 0.05, hint: 'stays put while the body under it moves' },
  hold: { label: 'Hold (world lock)', range: [0, 1], ref: 0, color: COL.flag, fmt: flagFmt, snap: 1, flag: true, hint: 'on = locked where it was when hold began' },
  pull: { label: 'Pull body', range: [0, 1], ref: 0, color: COL.ik, fmt: pct, snap: 0.05, hint: 'the chest bends toward a target out of reach' },
  swivel: { label: 'Swivel', range: [-150, 150], ref: 0, color: COL.swivel, fmt: (v) => sgn(v, 1, '°'), snap: 1, hint: 'turns the joint around the limb line' },
  curl: { label: 'Curl', range: [-30, 110], ref: 0, color: COL.finger, fmt: (v) => sgn(v, 1, '°'), snap: 1 },
  spread: { label: 'Spread', range: [-20, 35], ref: 0, color: COL.finger, fmt: (v) => sgn(v, 1, '°'), snap: 1 },
  thumb: { label: 'Thumb curl', range: [-40, 90], ref: 0, color: COL.finger, fmt: (v) => sgn(v, 1, '°'), snap: 1 },
  bend: { label: 'Toe bend', range: [-40, 60], ref: 0, color: COL.rot, fmt: (v) => sgn(v, 1, '°'), snap: 1, hint: '+ toes up · − toes down' },
};
const EFFECTORS = [];
const EFF_BY_ID = {};
(function defineEffectors() {
  const add = (e) => { EFFECTORS.push(e); EFF_BY_ID[e.id] = e; };
  const P = ['px', 'py', 'pz'], R = ['rx', 'ry', 'rz'];
  add({ id: 'hips', label: 'Hips', group: 'Body', kind: 'hips', tracks: ['blend', ...P, ...R, 'feet'], defaultShow: P, what: 'pelvis: move / rotate, feet stay' });
  add({ id: 'chest', label: 'Chest', group: 'Body', kind: 'chest', tracks: ['blend', ...R], defaultShow: ['rx'], what: 'spread over the spine' });
  add({ id: 'head', label: 'Head', group: 'Body', kind: 'head', tracks: ['blend', ...R], defaultShow: ['ry'], what: 'neck + head' });
  for (const [S, side] of [['L', 'Left'], ['R', 'Right']]) {
    add({ id: S + 'shoulder', label: side + ' shoulder', group: side + ' arm', kind: 'shoulder', side: S, tracks: ['blend', ...R], defaultShow: ['rz'], what: 'clavicle shrug / reach' });
    add({ id: S + 'elbow', label: side + ' elbow', group: side + ' arm', kind: 'elbow', side: S, tracks: ['swivel'], defaultShow: ['swivel'], what: 'elbow direction (pole)' });
    add({ id: S + 'hand', label: side + ' hand', group: side + ' arm', kind: 'hand', side: S, tracks: ['blend', ...P, ...R, 'pin', 'hold', 'pull'], defaultShow: P, what: 'arm IK: move / rotate the hand' });
    add({ id: S + 'fingers', label: side + ' fingers', group: side + ' arm', kind: 'fingers', side: S, tracks: ['curl', 'spread', 'thumb'], defaultShow: ['curl'], what: 'curl, spread, thumb' });
  }
  for (const [S, side] of [['L', 'Left'], ['R', 'Right']]) {
    add({ id: S + 'knee', label: side + ' knee', group: side + ' leg', kind: 'knee', side: S, tracks: ['swivel'], defaultShow: ['swivel'], what: 'knee direction (pole)' });
    add({ id: S + 'foot', label: side + ' foot', group: side + ' leg', kind: 'foot', side: S, tracks: ['blend', ...P, ...R, 'hold'], defaultShow: P, what: 'leg IK: move / rotate the foot' });
    add({ id: S + 'toes', label: side + ' toes', group: side + ' leg', kind: 'toes', side: S, tracks: ['bend'], defaultShow: ['bend'], what: 'toe bend' });
  }
})();
function newEffAuto(id, dur) {
  const d = EFF_BY_ID[id], tr = {};
  for (const k of d.tracks) tr[k] = flat(TRK[k].ref, dur);
  const show = {}; for (const k of d.defaultShow) show[k] = true;
  return { collapsed: false, show, tr };
}
function trackLabel(d, k) {
  const T = TRK[k];
  if (T.kind) { const info = worldAxisInfo(T.kind)[T.axis]; return `${T.label} <i>${info.short}</i>`; }
  return `${T.label}${T.hint ? ` <i>${T.hint.split(' ')[0] === '+' ? T.hint : ''}</i>` : ''}`;
}
function effBone(d) {
  const sd = d.side ? rig.side[d.side] : null;
  switch (d.kind) {
    case 'hips': return rig.b.hips;
    case 'chest': return rig.b.spine2;
    case 'head': return rig.b.head;
    case 'shoulder': return sd.upper;
    case 'elbow': return sd.fore;
    case 'hand': return sd.hand;
    case 'fingers': return (sd.fingers.find((f) => /middle1/i.test(f.bone.name)) || sd.fingers[0] || { bone: sd.hand }).bone;
    case 'knee': return sd.shin;
    case 'foot': return sd.foot;
    case 'toes': return sd.toe;
  }
  return rig.b.hips;
}
const effPos = (d) => worldP(effBone(d));

// finger spread axes (per first segment): turn the finger toward the index side (+) about the palm normal
function buildEffectors() {
  for (const Sd of ['L', 'R']) {
    const sd = rig.side[Sd];
    const firsts = sd.fingers.filter((f) => f.bone.parent === sd.hand && !f.thumb);
    const find = (re) => firsts.find((f) => re.test(f.bone.name));
    const ix = find(/index/i), pk = find(/pinky|little/i);
    const toward = ix && pk ? rig.bp(ix.bone).sub(rig.bp(pk.bone)).normalize() : V3(0, 0, 1);
    for (const f of sd.fingers) {
      f.depth = 0; let p = f.bone.parent; while (p && p !== sd.hand) { f.depth++; p = p.parent; }
      f.spread = 0;
      if (f.depth !== 0 || f.thumb) continue;
      const child = f.bone.children.find((c) => c.isBone);
      const dir = child ? rig.bp(child).sub(rig.bp(f.bone)).normalize() : V3(1, 0, 0);
      const axW = V3().crossVectors(dir, toward).normalize();
      f.spreadAxis = axW.applyQuaternion(rig.bq(f.bone).clone().invert());
      const n = f.bone.name;
      f.spread = /index/i.test(n) ? 1 : /middle/i.test(n) ? 0.25 : /ring/i.test(n) ? -0.55 : /pinky|little/i.test(n) ? -1.1 : 0;
    }
  }
}

// ---------------------------------------------------------------- clip time + root travel
function rebuildSpeedLUT() {   // clip time at each timeline time = ∫ speed
  const n = Math.max(2, Math.ceil(S.dur * 240) + 1), lut = new Float32Array(n), dt = S.dur / (n - 1);
  for (let i = 1; i < n; i++) { const t0 = (i - 1) * dt, t1 = i * dt; lut[i] = lut[i - 1] + 0.5 * (evalPts(A.speed, t0) + evalPts(A.speed, t1)) * dt; }
  S.speedLUT = lut; drawRuler(); editVersion++;
}
function clipTime(t) { const lut = S.speedLUT, f = clamp(t / S.dur, 0, 1) * (lut.length - 1), i = Math.min(Math.floor(f), lut.length - 2); return lerp(lut[i], lut[i + 1], f - i); }
let moveEndCache = null;
const _mvQ = new THREE.Quaternion();
function moveDisp(c, ct, out) {   // a one-shot move's root displacement at clip time ct (within one play)
  const G = QcG[0], h = V3();
  gl.sample(c, ct, G, h);
  const qY = qAxis(AY, -((c.start && c.start.hipsYaw) || 0), _mvQ);
  return out.set(h.x - c.hp[0], 0, h.z - c.hp[2]).applyQuaternion(qY);
}
function trueTravel(t, out = V3()) {   // root travel of the clip at timeline time t (ignores "in place")
  out.set(0, 0, 0);
  if (!cur) return out;
  const ct = clipTime(t), c = cur.c;
  if (cur.kind === 'loop') {
    const d = (c.speed || 0) * ct, dir = c.dir || 0;
    return out.set(Math.sin(dir) * d, 0, Math.cos(dir) * d);
  }
  if (!gl || !(cur.dur > 0)) return out;
  if (!moveEndCache || moveEndCache.id !== cur.id) moveEndCache = { id: cur.id, end: moveDisp(c, cur.dur, V3()) };
  const n = Math.floor(ct / cur.dur);
  moveDisp(c, ct - n * cur.dur, out);
  return out.addScaledVector(moveEndCache.end, n);
}
function shownTravel(t, out = V3()) { if (S.inPlace) return out.set(0, 0, 0); return trueTravel(t, out).add(S.travelBase); }

// ---------------------------------------------------------------- FK composition
const qI = new THREE.Quaternion(), qC = new THREE.Quaternion(), qD = new THREE.Quaternion(), qO = new THREE.Quaternion(), vv = V3();
const logQ = (q, out) => { let { x, y, z, w } = q; if (w < 0) { x = -x; y = -y; z = -z; w = -w; } const s = Math.hypot(x, y, z); if (s < 1e-9) return out.set(0, 0, 0); const a = 2 * Math.atan2(s, w); return out.set(x / s * a, y / s * a, z / s * a); };
const expV = (x, y, z, out) => { const a = Math.hypot(x, y, z); if (a < 1e-9) return out.set(0, 0, 0, 1); const s = Math.sin(a / 2) / a; return out.set(x * s, y * s, z * s, Math.cos(a / 2)); };
function sampleClip(tau, Q, H) {   // the untouched clip at clip time tau (s), laid facing +z, in place
  const c = cur.c;
  if (cur.kind === 'loop') {
    lib.sample(c, mod1(tau / cur.dur), Q, H);
    if (c.legsOnly) for (let i = 0; i < B; i++) if (!isLower[i]) Q.set(Qi[0].subarray(i * 4, i * 4 + 4), i * 4);
    return;
  }
  const G = QcG[0], ct = cur.dur > 0 ? tau % cur.dur : 0;
  gl.sample(c, ct, G, HcG);
  const h0 = V3(c.hp[0], c.hp[1], c.hp[2]), qY = qAxis(AY, -((c.start && c.start.hipsYaw) || 0));
  for (let i = 0; i < B; i++) {
    const k = gMap[i];
    if (k < 0 || (c.mask === 'legs' && !gl.legMask[k])) { Q.set(Qi[0].subarray(i * 4, i * 4 + 4), i * 4); continue; }
    Q.set(G.subarray(k * 4, k * 4 + 4), i * 4);
  }
  const hi = boneIdx.get(rig.b.hips.name);   // turn the whole move so it starts facing +z
  qO.fromArray(Q, hi * 4).premultiply(hipsParentQ).premultiply(qY).premultiply(hipsParentQ.clone().invert()); qO.toArray(Q, hi * 4);
  H.set(HcG.x - h0.x, HcG.y, HcG.z - h0.z).applyQuaternion(qY); H.x = Hi.x; H.z = Hi.z;   // in place (height and turn kept)
}
function wholeEff(name, t) {
  let W = 1; const ba0 = A.bones[name]; if (ba0) W = evalPts(ba0.whole, t);
  let p = rig.bones[boneIdx.get(name)].parent;
  while (p && p.isBone) { const pba = A.bones[p.name]; if (pba && pba.withChildren) W *= evalPts(pba.whole, t); p = p.parent; }
  return W;
}
const shiftPool = [], HshiftScratch = V3(), _trav = V3();
function composePose(t, Qout, Hout, pend) {
  lib.sample(lib.idle, mod1(t / lib.idle.dur), Qi[0], Hi);
  sampleClip(clipTime(t), Qc[0], Hc);
  const QI = Qi[0], QC = Qc[0];
  // per-bone timing offset: re-sample the clip at a shifted clip-time for bones that use it
  const shiftKeyOf = new Map(), shiftArr = new Map();
  for (const name of A.order) {
    const ba = A.bones[name]; if (!ba || !ba.timing) continue;
    const sh = evalPts(ba.timing, t); if (Math.abs(sh) < 1e-4) continue;
    const key = Math.round(sh * 1000); shiftKeyOf.set(name, key);
    if (!shiftArr.has(key)) { const arr = shiftPool.pop() || new Float32Array(B * 4); sampleClip(clipTime(t) + sh * (cur.dur || 1), arr, HshiftScratch); shiftArr.set(key, arr); }
  }
  const pb = pend && pend.kind === 'bone' ? pend : null;
  for (let i = 0; i < B; i++) {
    const o = i * 4, name = rig.bones[i].name, ba = A.bones[name];
    const src = shiftKeyOf.has(name) ? shiftArr.get(shiftKeyOf.get(name)) : QC;
    qC.fromArray(src, o);
    const pd = pb && pb.name === name ? pb.deg : null;
    if (!ba && !pd) { Qout.set(src.subarray(o, o + 4), o); continue; }
    qI.fromArray(QI, o);
    qD.copy(qI).invert().multiply(qC); if (qD.w < 0) { qD.x = -qD.x; qD.y = -qD.y; qD.z = -qD.z; qD.w = -qD.w; }
    logQ(qD, vv);
    const D = DEG;
    let x = vv.x, y = vv.y, z = vv.z;
    if (ba) {
      const W = wholeEff(name, t);
      x = vv.x * evalPts(ba.w.x, t) * W + evalPts(ba.a.x, t) * D; y = vv.y * evalPts(ba.w.y, t) * W + evalPts(ba.a.y, t) * D; z = vv.z * evalPts(ba.w.z, t) * W + evalPts(ba.a.z, t) * D;
    }
    if (pd) { x += pd.x * D; y += pd.y * D; z += pd.z * D; }
    expV(x, y, z, qO); qO.premultiply(qI);
    Qout[o] = qO.x; Qout[o + 1] = qO.y; Qout[o + 2] = qO.z; Qout[o + 3] = qO.w;
  }
  for (const arr of shiftArr.values()) shiftPool.push(arr);
  const hb = A.bones[rig.b.hips.name], wh = hb ? evalPts(hb.whole, t) : 1;
  Hout.copy(Hi).lerp(Hc, wh).add(shownTravel(t, _trav));
}
function applyPose(Q, H) {
  rig.bones.forEach((b, i) => { if (b !== rig.bones[0] || b === rig.b.hips) b.quaternion.set(Q[i * 4], Q[i * 4 + 1], Q[i * 4 + 2], Q[i * 4 + 3]); });
  rig.b.hips.parent.updateMatrixWorld(true);
  rig.setHipsWorld(H);
  model.updateMatrixWorld(true);
}
// FK world positions at another time, without touching the scene (for hold / world lock)
const Qh = { v: null }, Hh = V3();
function fkPositionsAt(t) {
  if (!Qh.v) Qh.v = new Float32Array(B * 4);
  composePose(t, Qh.v, Hh, null);
  fk.v.run(Qh.v, Hh, 0);
  return fk.v.P;
}

// ---------------------------------------------------------------- IK helpers
// two-bone analytic limb IK (law of cosines + pole plane, soft reach, anatomical hinge limit)
function ikLimb(limb, root, target, pole, fallback) {
  const { l1, l2, maxFlex } = limb, L = l1 + l2;
  const vvv = target.clone().sub(root);
  let d = vvv.length();
  const dir = vvv.clone().divideScalar(Math.max(d, 1e-6));
  const dMin = Math.sqrt(l1 * l1 + l2 * l2 - 2 * l1 * l2 * Math.cos(Math.PI - maxFlex));
  const ds = 0.975 * L;
  if (d > ds) d = Math.min(ds + (L - ds) * (1 - Math.exp(-(d - ds) / (L - ds))), L * 0.9999);
  if (d < dMin) d = dMin;
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  let pn = perpNorm(pole.clone().sub(root), dir, V3());
  if (!pn) pn = perpNorm(fallback, dir, V3()) || V3(0, 0, 1);
  const mid = root.clone().addScaledVector(dir, l1 * cosA).addScaledVector(pn, l1 * sinA);
  const endP = root.clone().addScaledVector(dir, d);
  const a1 = mid.clone().sub(root).normalize();
  const bdir = perpNorm(pn.clone().negate(), a1, V3()) || pn.clone().negate();
  const d1 = basisQ(a1, bdir, new THREE.Quaternion()).multiply(limb.B1inv);
  const h = new THREE.Vector3().crossVectors(a1, bdir);
  const a2 = endP.clone().sub(mid).normalize();
  const d2 = basisQ(a2, h, new THREE.Quaternion()).multiply(limb.B2inv);
  return { d1, d2 };
}
const effActive = (id, pend) => !!A.ik[id] || !!(pend && pend.kind === 'eff' && pend.id === id);
function effVal(id, k, t) { const e = A.ik[id]; return e && e.tr[k] ? evalPts(e.tr[k], t) : TRK[k].ref; }
const eulerQ = (xd, yd, zd, out = new THREE.Quaternion()) => out.setFromEuler(new THREE.Euler(xd * DEG, yd * DEG, zd * DEG, 'YXZ'));
function effRotQ(id, t, pend, w = 1) {   // world rotation offset of an effector (tracks × blend, then the live gizmo change)
  const q = eulerQ(effVal(id, 'rx', t), effVal(id, 'ry', t), effVal(id, 'rz', t));
  if (w < 1) q.slerp(IDQ, 1 - w);
  if (pend && pend.kind === 'eff' && pend.id === id && pend.drot) q.premultiply(pend.drot);
  return q;
}
function effPosOff(id, t, pend, w = 1) {   // world position offset in metres
  const v = V3(effVal(id, 'px', t), effVal(id, 'py', t), effVal(id, 'pz', t)).multiplyScalar(w / 100);
  if (pend && pend.kind === 'eff' && pend.id === id && pend.dpos) v.add(pend.dpos);
  return v;
}
function effSwivel(id, t, pend) {
  let s = effVal(id, 'swivel', t);
  if (pend && pend.kind === 'eff' && pend.id === id && pend.dswivel) s += pend.dswivel;
  return s * DEG;
}
function rotateBoneWorld(bone, q) { rig.setDelta(bone, q.clone().multiply(rig.delta(bone))); }
function spreadOver(bones, q) {   // a world rotation shared by a chain (each link takes an equal part)
  const part = new THREE.Quaternion().slerp(q, 1 / bones.length);
  for (const b of bones) rotateBoneWorld(b, part);
}
function holdStart(pts, t) {   // start of the current "hold on" span, on a 1/120 s grid
  const step = 1 / 120; let t0 = Math.round(t / step) * step;
  while (t0 > 1e-6 && evalPts(pts, t0 - step) >= 0.5) t0 -= step;
  return Math.max(0, t0);
}
const holdCache = new Map();
function holdTarget(bone, pts, t) {   // world spot the effector had (FK) when the hold began
  const t0 = holdStart(pts, t), bi = boneIdx.get(bone.name), key = `${editVersion}|${S.inPlace}|${bi}|${t0.toFixed(4)}|${S.travelBase.x.toFixed(3)},${S.travelBase.z.toFixed(3)}`;
  let p = holdCache.get(key);
  if (!p) { p = fkPositionsAt(t0)[bi].clone(); if (holdCache.size > 64) holdCache.clear(); holdCache.set(key, p); }
  p = p.clone();
  if (S.inPlace) p.sub(trueTravel(t)).add(trueTravel(t0));   // in place the world slides back under him
  return p;
}

// ---------------------------------------------------------------- full-body IK solve
function solveIK(t, pend) {
  const active = A.ikOrder.length || (pend && pend.kind === 'eff');
  if (!active) return;
  const on = (id) => effActive(id, pend);
  const b = rig.b;
  // FK reference, before any effector moves the body
  const fkRef = {};
  for (const Sd of ['L', 'R']) {
    const sd = rig.side[Sd];
    fkRef[Sd] = { foot: worldP(sd.foot), footQ: rig.delta(sd.foot), hand: worldP(sd.hand), handQ: rig.delta(sd.hand) };
  }
  // 1. hips
  let feetPin = 1;
  if (on('hips')) {
    const w = effVal('hips', 'blend', t);
    feetPin = effVal('hips', 'feet', t);
    const off = effPosOff('hips', t, pend, w);
    if (off.lengthSq() > 1e-12) rig.setHipsWorld(worldP(b.hips).add(off));
    rig.setDelta(b.hips, effRotQ('hips', t, pend, w).multiply(rig.delta(b.hips)));
  }
  // 2. leg targets (needed now: the hips come down if planted feet are out of reach)
  const legT = {};
  for (const Sd of ['L', 'R']) {
    const sd = rig.side[Sd], fId = Sd + 'foot';
    const need = on(fId) || on(Sd + 'knee') || (on('hips') && feetPin > 0);
    if (!need) continue;
    const carried = worldP(sd.foot), carriedQ = rig.delta(sd.foot);
    let base = carried.clone().lerp(fkRef[Sd].foot, on('hips') ? feetPin : 0);
    const baseQ = carriedQ.clone().slerp(fkRef[Sd].footQ, on('hips') ? feetPin : 0);
    const e = A.ik[fId];
    if (e && evalPts(e.tr.hold, t) >= 0.5) base = holdTarget(sd.foot, e.tr.hold, t);
    const w = on(fId) ? effVal(fId, 'blend', t) : 0;
    const target = base.add(effPosOff(fId, t, pend, w));
    legT[Sd] = { target, baseQ, w };
  }
  if (on('hips')) {   // lower the pelvis just enough that both planted feet stay reachable
    let drop = 0;
    for (const Sd of ['L', 'R']) {
      if (!legT[Sd]) continue;
      const leg = rig.side[Sd].leg, reach = (leg.l1 + leg.l2) * 0.985, hip = worldP(rig.side[Sd].thigh), h = hip.clone().sub(legT[Sd].target);
      const horiz2 = h.x * h.x + h.z * h.z;
      if (h.lengthSq() > reach * reach && horiz2 < reach * reach) drop = Math.max(drop, h.y - Math.sqrt(reach * reach - horiz2));
    }
    drop = clamp(drop, 0, 0.25);
    if (drop > 1e-5) { rig.setHipsWorld(worldP(b.hips).add(V3(0, -drop, 0))); b.hips.updateMatrixWorld(true); }
  }
  // 3. spine, head, shoulders
  if (on('chest')) spreadOver([b.spine, b.spine1, b.spine2], effRotQ('chest', t, pend, effVal('chest', 'blend', t)));
  if (on('head')) spreadOver([b.neck, b.head], effRotQ('head', t, pend, effVal('head', 'blend', t)));
  for (const Sd of ['L', 'R']) { const id = Sd + 'shoulder'; if (on(id)) rotateBoneWorld(rig.side[Sd].clav, effRotQ(id, t, pend, effVal(id, 'blend', t))); }
  // 4. hand targets, then the body leans toward targets out of reach (pull)
  const armT = {};
  for (const Sd of ['L', 'R']) {
    const sd = rig.side[Sd], hId = Sd + 'hand';
    if (!on(hId) && !on(Sd + 'elbow')) continue;
    const carried = worldP(sd.hand), carriedQ = rig.delta(sd.hand);
    const w = on(hId) ? effVal(hId, 'blend', t) : 0, pin = on(hId) ? effVal(hId, 'pin', t) * w : 0;
    let base = carried.clone().lerp(fkRef[Sd].hand, pin);
    const baseQ = carriedQ.clone().slerp(fkRef[Sd].handQ, pin);
    const e = A.ik[hId];
    if (e && evalPts(e.tr.hold, t) >= 0.5) base = holdTarget(sd.hand, e.tr.hold, t);
    armT[Sd] = { target: base.add(effPosOff(hId, t, pend, w)), baseQ, w, pull: on(hId) ? effVal(hId, 'pull', t) * w : 0 };
  }
  for (const Sd of ['L', 'R']) {
    const a = armT[Sd]; if (!a || a.pull <= 0) continue;
    const sh = worldP(rig.side[Sd].upper), dist = sh.distanceTo(a.target), L = rig.armLen;
    const need = clamp((dist - L * 0.95) / 0.45, 0, 1) * a.pull;
    if (need <= 0) continue;
    const base = worldP(b.spine), from = sh.sub(base).normalize(), to = a.target.clone().sub(base).normalize();
    spreadOver([b.spine, b.spine1, b.spine2], new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(from, to), need * 0.85));
  }
  // 5. arms
  for (const Sd of ['L', 'R']) {
    const a = armT[Sd]; if (!a) continue;
    const sd = rig.side[Sd], s = sd.s, sh = worldP(sd.upper);
    const fwd = V3(0, 0, 1);
    let pole = worldP(sd.fore).addScaledVector(V3(s * 0.3, -0.25, -1).normalize(), 0.05);
    const sw = effSwivel(Sd + 'elbow', t, pend);
    if (Math.abs(sw) > 1e-5) { const ax = a.target.clone().sub(sh).normalize(); pole = pole.sub(sh).applyAxisAngle(ax, sw).add(sh); }
    const r = ikLimb(sd.arm, sh, a.target, pole, fwd.negate());
    rig.setDelta(sd.upper, r.d1); rig.setDelta(sd.fore, r.d2);
    rig.setDelta(sd.hand, on(Sd + 'hand') ? effRotQ(Sd + 'hand', t, pend, a.w).multiply(a.baseQ) : a.baseQ);
  }
  // 6. legs, feet, toes
  for (const Sd of ['L', 'R']) {
    const sd = rig.side[Sd], l = legT[Sd];
    if (l) {
      const hip = worldP(sd.thigh);
      let pole = worldP(sd.shin).addScaledVector(V3(0, 0, 1), 0.05);
      const sw = effSwivel(Sd + 'knee', t, pend);
      if (Math.abs(sw) > 1e-5) { const ax = l.target.clone().sub(hip).normalize(); pole = pole.sub(hip).applyAxisAngle(ax, sw).add(hip); }
      const r = ikLimb(sd.leg, hip, l.target, pole, V3(0, 0, 1));
      rig.setDelta(sd.thigh, r.d1); rig.setDelta(sd.shin, r.d2);
      rig.setDelta(sd.foot, on(Sd + 'foot') ? effRotQ(Sd + 'foot', t, pend, l.w).multiply(l.baseQ) : l.baseQ);
    }
    if (on(Sd + 'toes')) {
      const bend = effVal(Sd + 'toes', 'bend', t) * DEG, lat = V3(1, 0, 0).applyQuaternion(rig.delta(sd.foot)).normalize();
      rotateBoneWorld(sd.toe, qAxis(lat, -bend));
    }
  }
  // 7. fingers (local, on top of the clip's hand)
  for (const Sd of ['L', 'R']) {
    const id = Sd + 'fingers'; if (!on(id)) continue;
    const sd = rig.side[Sd], curl = effVal(id, 'curl', t), spread = effVal(id, 'spread', t), thumb = effVal(id, 'thumb', t);
    for (const f of sd.fingers) {
      const ang = (f.thumb ? thumb : curl) * f.w * DEG;
      if (Math.abs(ang) > 1e-6) f.bone.quaternion.multiply(qAxis(f.axis, ang));
      if (f.spread && f.spreadAxis && Math.abs(spread) > 1e-6) f.bone.quaternion.multiply(qAxis(f.spreadAxis, spread * f.spread * DEG));
    }
    sd.hand.updateMatrixWorld(true);
  }
}

// full pose at time t: FK automation → travel → IK (the live gizmo change folded in)
const Qf = { v: null }, Hf = V3();
function evaluate(t, pend) {
  if (!Qf.v) Qf.v = new Float32Array(B * 4);
  composePose(t, Qf.v, Hf, pend);
  applyPose(Qf.v, Hf);
  try { solveIK(t, pend); } catch (err) { if (!evaluate.warned) { evaluate.warned = true; console.warn('IK solve failed:', err); } }
}

// ---------------------------------------------------------------- auto foot-lock from the clip's contacts
function footContact(Sd, t) {
  const c = cur.c, ct = clipTime(t);
  if (cur.kind === 'loop') return c.win && c.win[Sd] ? inWin(mod1(ct / cur.dur), c.win[Sd]) : null;
  const arr = Sd === 'L' ? c.cL : c.cR, fps = (gl && gl.fps) || 30;
  if (!arr) return null;
  return !!arr[clamp(Math.floor((ct % cur.dur) * fps), 0, arr.length - 1)];
}
function autoFootLock() {
  if (!cur) return 'no clip';
  const step = 1 / 120, made = [];
  pushUndo();
  for (const Sd of ['L', 'R']) {
    if (footContact(Sd, 0) == null) continue;
    const pts = []; let prev = null;
    for (let t = 0; t <= S.dur + 1e-9; t += step) {
      const v = footContact(Sd, Math.min(t, S.dur)) ? 1 : 0;
      if (prev == null) pts.push({ t: 0, v, k: 0 });
      else if (v !== prev) { pts.push({ t: Math.max(0, t - 0.001), v: prev, k: 0 }); pts.push({ t, v, k: 0 }); }
      prev = v;
    }
    pts.push({ t: S.dur, v: prev, k: 0 });
    const e = ensureEff(Sd + 'foot');
    e.tr.hold = pts; e.show.hold = true;
    made.push(Sd === 'L' ? 'left' : 'right');
  }
  if (!made.length) { undoStack.pop(); return 'This clip has no foot-contact data.'; }
  rebuildRows(); save();
  return `Hold tracks written for the ${made.join(' and ')} foot.` + (S.inPlace ? ' Turn "In place" off to watch the feet stay planted as he travels.' : '');
}
