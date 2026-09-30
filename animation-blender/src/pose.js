
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
  // torso controllers: rotate turns their own bone(s) (children follow); move bends the chain below them so the
  // controller point goes to the target (CCD, a capped angle per joint)
  add({ id: 'spine', label: 'Spine (lower back)', group: 'Body', kind: 'torso', seg: 'spine', spread: ['spine'], chain: null, tracks: ['blend', ...P, ...R], defaultShow: ['rx'], what: 'rotate the Spine bone · move tilts / shifts the pelvis (feet stay)' });
  add({ id: 'spine1', label: 'Spine1 (mid back)', group: 'Body', kind: 'torso', seg: 'spine1', spread: ['spine1'], chain: ['spine'], tracks: ['blend', ...P, ...R], defaultShow: ['rx'], what: 'rotate Spine1 · move bends Spine' });
  add({ id: 'chest', label: 'Chest', group: 'Body', kind: 'torso', seg: 'spine2', spread: ['spine', 'spine1', 'spine2'], chain: ['spine1', 'spine'], tracks: ['blend', ...P, ...R], defaultShow: ['rx'], what: 'rotate spread over the spine · move bends it' });
  add({ id: 'neck', label: 'Neck', group: 'Body', kind: 'torso', seg: 'neck', spread: ['neck'], chain: ['spine2', 'spine1', 'spine'], tracks: ['blend', ...P, ...R], defaultShow: ['rx'], what: 'rotate the neck · move bends the upper spine' });
  add({ id: 'head', label: 'Head', group: 'Body', kind: 'torso', seg: 'head', spread: ['neck', 'head'], chain: ['neck', 'spine2', 'spine1'], tracks: ['blend', ...P, ...R], defaultShow: ['ry'], what: 'rotate neck + head · move bends neck and chest' });
  for (const [S, side] of [['L', 'Left'], ['R', 'Right']]) {
    add({ id: S + 'shoulder', label: side + ' shoulder', group: side + ' arm', kind: 'shoulder', side: S, tracks: ['blend', ...R], defaultShow: ['rz'], what: 'clavicle shrug / reach' });
    add({ id: S + 'elbow', label: side + ' elbow', group: side + ' arm', kind: 'elbow', side: S, tracks: ['swivel', ...R], defaultShow: ['swivel'], what: 'elbow direction (pole) · rotate turns the forearm' });
    add({ id: S + 'hand', label: side + ' hand', group: side + ' arm', kind: 'hand', side: S, tracks: ['blend', ...P, ...R, 'pin', 'hold', 'pull'], defaultShow: P, what: 'arm IK: move / rotate the hand' });
    add({ id: S + 'fingers', label: side + ' fingers', group: side + ' arm', kind: 'fingers', side: S, tracks: ['curl', 'spread', 'thumb', ...R], defaultShow: ['curl'], what: 'curl, spread, thumb · rotate turns all fingers' });
  }
  for (const [S, side] of [['L', 'Left'], ['R', 'Right']]) {
    add({ id: S + 'knee', label: side + ' knee', group: side + ' leg', kind: 'knee', side: S, tracks: ['swivel', ...R], defaultShow: ['swivel'], what: 'knee direction (pole) · rotate turns the shin' });
    add({ id: S + 'foot', label: side + ' foot', group: side + ' leg', kind: 'foot', side: S, tracks: ['blend', ...P, ...R, 'hold'], defaultShow: P, what: 'leg IK: move / rotate the foot' });
    add({ id: S + 'toes', label: side + ' toes', group: side + ' leg', kind: 'toes', side: S, tracks: ['bend', ...R], defaultShow: ['bend'], what: 'toe bend · rotate' });
  }
  // group IK: one handle moves / rotates several effectors together, about a pivot. Members that another member
  // already carries (a hand on a moving chest, unpinned) take no extra share, so nothing moves twice.
  const G = (id, label, members, pivot, what, poles = []) => add({ id, label, group: 'Group IK', kind: 'igroup', members, pivot, poles, tracks: ['blend', ...P, ...R], defaultShow: P, what });
  for (const [S, side] of [['L', 'Left'], ['R', 'Right']]) {
    G('ig:' + S + 'arm', side + ' arm group', { [S + 'hand']: 1 }, 'auto', 'hand + elbow about the shoulder', [S + 'elbow']);
    G('ig:' + S + 'leg', side + ' leg group', { [S + 'foot']: 1 }, 'auto', 'foot + knee about the hip', [S + 'knee']);
  }
  G('ig:hands', 'Both hands', { Lhand: 1, Rhand: 1 }, 'centroid', 'both hands together', ['Lelbow', 'Relbow']);
  G('ig:feet', 'Both feet', { Lfoot: 1, Rfoot: 1 }, 'centroid', 'both feet together', ['Lknee', 'Rknee']);
  G('ig:upper', 'Upper body', { chest: 1, Lhand: 1, Rhand: 1 }, 'auto', 'chest + hands about the lower back', ['Lelbow', 'Relbow']);
  G('ig:body', 'Whole body', { hips: 1, Lfoot: 1, Rfoot: 1, Lhand: 1, Rhand: 1 }, 'auto', 'everything about the hips', ['Lelbow', 'Relbow', 'Lknee', 'Rknee']);
})();
const MOVABLE = ['hips', 'spine', 'spine1', 'chest', 'neck', 'head', 'Lhand', 'Rhand', 'Lfoot', 'Rfoot'];
const IG_AUTO_PIVOT = { 'ig:Larm': () => rig.side.L.upper, 'ig:Rarm': () => rig.side.R.upper, 'ig:Lleg': () => rig.side.L.thigh, 'ig:Rleg': () => rig.side.R.thigh, 'ig:upper': () => rig.b.spine, 'ig:body': () => rig.b.hips };
function registerIG(id, label) {   // a custom group IK (id "ig:c<n>")
  if (EFF_BY_ID[id]) { if (label) EFF_BY_ID[id].label = label; return EFF_BY_ID[id]; }
  const d = { id, label: label || 'Controller', group: 'Custom controllers', kind: 'igroup', custom: true, members: {}, pivot: 'centroid', poles: [], tracks: ['blend', 'px', 'py', 'pz', 'rx', 'ry', 'rz'], defaultShow: ['px', 'py', 'pz'], what: 'your own set of effectors' };
  EFFECTORS.push(d); EFF_BY_ID[id] = d; return d;
}
function igMembers(gid) { const e = A && A.ik[gid]; return (e && e.members) || EFF_BY_ID[gid].members; }
function igPivotPos(gid) {
  const e = A && A.ik[gid], pv = (e && e.pivot) || EFF_BY_ID[gid].pivot;
  if (pv === 'auto' && IG_AUTO_PIVOT[gid]) return worldP(IG_AUTO_PIVOT[gid]());
  if (pv !== 'centroid' && EFF_BY_ID[pv]) return effPos(EFF_BY_ID[pv]);
  const m = igMembers(gid), ids = Object.keys(m).filter((k) => m[k] > 0 && EFF_BY_ID[k]);   // weighted centre of the members
  if (!ids.length) return worldP(rig.b.hips);
  const wsum = ids.reduce((a, k) => a + m[k], 0);
  return ids.reduce((acc, k) => acc.addScaledVector(effPos(EFF_BY_ID[k]), m[k] / wsum), V3());
}
function newEffAuto(id, dur) {
  const d = EFF_BY_ID[id], tr = {};
  for (const k of d.tracks) tr[k] = flat(TRK[k].ref, dur);
  const show = {}; for (const k of d.defaultShow) show[k] = true;
  const e = { collapsed: false, show, tr };
  if (d.kind === 'igroup') { e.members = { ...d.members }; e.pivot = d.pivot; if (d.custom) e.label = d.label; }
  return e;
}
function trackLabel(d, k) {
  const T = TRK[k];
  if (T.kind) { const info = worldAxisInfo(T.kind)[T.axis]; return `${T.label} <i>${info.short}</i>`; }
  return `${T.label}${T.hint ? ` <i>${T.hint.split(' ')[0] === '+' ? T.hint : ''}</i>` : ''}`;
}
function effBone(d) {
  if (d.kind === 'igroup') {
    const e = A && A.ik[d.id], pv = (e && e.pivot) || d.pivot;
    if (pv === 'auto' && IG_AUTO_PIVOT[d.id]) return IG_AUTO_PIVOT[d.id]();
    const first = EFF_BY_ID[pv] ? pv : Object.keys(igMembers(d.id))[0];
    return first && EFF_BY_ID[first] ? effBone(EFF_BY_ID[first]) : rig.b.hips;
  }
  const sd = d.side ? rig.side[d.side] : null;
  switch (d.kind) {
    case 'hips': return rig.b.hips;
    case 'torso': return rig.b[d.seg];
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
const effPos = (d) => (d.kind === 'igroup' ? igPivotPos(d.id) : worldP(effBone(d)));

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

// ---------------------------------------------------------------- bone groups
// A group scales the clip's motion of every bone in it by one weight track (and can shift their timing).
// Groups nest freely: a bone's weight = its own weight × every group it is in (× "multiply into children"
// parents), so "Left arm" at 60 % with "Left hand" at 50 % leaves the hand at 30 %.
const GROUP_DEFS = [];
(function defineGroups() {
  const sub = (b) => { const out = []; b.traverse((o) => o.isBone && out.push(o)); return out; };
  const add = (g) => GROUP_DEFS.push(g);
  add({ id: 'g:upperNH', label: 'Upper body (no hips)', note: 'spine and everything above it', cat: 'Body', bones: () => sub(rig.b.spine) });
  add({ id: 'g:body', label: 'Whole body', cat: 'Body', bones: () => sub(rig.b.hips) });
  add({ id: 'g:upper', label: 'Upper body', cat: 'Body', bones: () => sub(rig.b.spine) });
  add({ id: 'g:lower', label: 'Lower body', note: 'hips + legs', cat: 'Body', bones: () => [rig.b.hips, ...sub(rig.side.L.thigh), ...sub(rig.side.R.thigh)] });
  add({ id: 'g:spine', label: 'Spine', note: 'Spine, Spine1, Spine2', cat: 'Body', bones: () => [rig.b.spine, rig.b.spine1, rig.b.spine2] });
  add({ id: 'g:headneck', label: 'Head & neck', cat: 'Body', bones: () => sub(rig.b.neck) });
  for (const [S, side] of [['L', 'Left'], ['R', 'Right']]) {
    add({ id: 'g:' + S + 'arm', label: side + ' arm', note: 'shoulder → fingers', cat: side + ' side', bones: () => sub(rig.side[S].clav) });
    add({ id: 'g:' + S + 'hand', label: side + ' hand', note: 'hand + fingers', cat: side + ' side', bones: () => sub(rig.side[S].hand) });
    add({ id: 'g:' + S + 'fingers', label: side + ' fingers', cat: side + ' side', bones: () => sub(rig.side[S].hand).filter((b) => b !== rig.side[S].hand) });
    add({ id: 'g:' + S + 'leg', label: side + ' leg', note: 'thigh → toes', cat: side + ' side', bones: () => sub(rig.side[S].thigh) });
    add({ id: 'g:' + S + 'foot', label: side + ' foot', note: 'foot + toes', cat: side + ' side', bones: () => sub(rig.side[S].foot) });
  }
})();
const groupCache = new Map();
function groupMembers(gid) {   // → Set of bone names ("sub:<bone>" = that bone and everything below it)
  let m = groupCache.get(gid);
  if (m) return m;
  const def = GROUP_DEFS.find((g) => g.id === gid);
  let bones = [];
  if (def) bones = def.bones();
  else if (gid.startsWith('sub:') && boneIdx.has(gid.slice(4))) rig.bones[boneIdx.get(gid.slice(4))].traverse((o) => o.isBone && bones.push(o));
  m = new Set(bones.map((b) => b.name)); groupCache.set(gid, m);
  return m;
}
function groupLabel(gid) { const d = GROUP_DEFS.find((g) => g.id === gid); return d ? d.label : gid.startsWith('sub:') ? gid.slice(4) + ' + below' : gid; }
function mirrorGroupId(gid) {
  if (/^g:[LR]/.test(gid)) return 'g:' + (gid[2] === 'L' ? 'R' : 'L') + gid.slice(3);
  if (gid.startsWith('sub:')) { const m = mirrorName(gid.slice(4)); return m && boneIdx.has(m) ? 'sub:' + m : null; }
  return null;
}
function newGroupAuto(dur) { return { collapsed: false, show: { weight: true }, weight: flat(1, dur), timing: flat(0, dur) }; }
// weight × and timing + that the groups give one bone at time t (gw / gt: this frame's group values)
function groupFactor(name, gw, gt) {
  let w = 1, sh = 0;
  for (const gid of A.groupOrder) { if (!gw.has(gid) || !groupMembers(gid).has(name)) continue; w *= gw.get(gid); sh += gt.get(gid); }
  return [w, sh];
}

// ---------------------------------------------------------------- clip time + root travel
// the timeline holds A.cycles cycles of the clip in S.dur seconds: that sets the base cadence; the playback-speed
// track multiplies on top of it. Clip time at each timeline time = rate × ∫ speed.
function cycleRate() { return 1; }   // the clip always plays at its own cadence; Length / Cycles only set how long the timeline is
// The cycle-speed track is a speed in % (100 = neutral, 150 = 1.5× as fast); it acts in clip time.
function rebuildSpeedLUT() {
  const n = Math.max(2, Math.ceil(S.dur * 960) + 1), lut = new Float32Array(n), nom = new Float32Array(n), dt = S.dur / (n - 1), k = cycleRate();
  for (let i = 1; i < n; i++) {
    const t0 = (i - 1) * dt, t1 = i * dt, play = 0.5 * (evalPts(A.speed, t0) + evalPts(A.speed, t1)) * k;
    nom[i] = nom[i - 1] + play * dt;
    const cyc = Math.max(5, evalPts(A.cyc, (t0 + t1) / 2));
    lut[i] = lut[i - 1] + play * (cyc / 100) * dt;
  }
  if (A && A.cycles > 0 && cur && cur.dur > 0) {   // exact count: a residue under 0.1 % of a bar is taken out of the table
    const tg = A.cycles * cur.dur, e = lut[n - 1];
    if (e > 0 && Math.abs(e - tg) < 1e-3 * cur.dur) { const kk = tg / e; for (let i = 1; i < n; i++) lut[i] *= kk; }
    else if (!lockBusy) queueLock();
  }
  S.speedLUTNom = nom;
  S.speedLUT = lut; editVersion++;
  rebuildTravelLUT(); gridCache = null;
  if (typeof viewFreeze !== 'undefined' && viewFreeze) { /* dragging a timing point: keep the view */ }
  else if (S.viewAll !== false) { S.v0 = 0; S.v1 = dispDur(); } else { const D = dispDur(); S.v1 = Math.min(S.v1, D); S.v0 = Math.min(S.v0, Math.max(0, S.v1 - 0.05)); }
  updateHScroll(); drawRuler();
  if (cur) syncLenInputs();   // the cycles count follows cycle speed
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
// root travel at timeline time t (ignores "in place"): the clip's own travel, each bit of it scaled by the
// moving-speed track at that moment (so 150 % covers half as much ground again at the same cadence)
let travelLUT = null;
function rebuildTravelLUT() {
  const n = Math.max(2, Math.ceil(S.dur * 240) + 1), dt = S.dur / (n - 1), x = new Float32Array(n), z = new Float32Array(n);
  const prev = V3(), now = V3();
  rawTravel(0, prev);
  for (let i = 1; i < n; i++) {
    rawTravel(i * dt, now);
    const m = evalPts(A.move, (i - 0.5) * dt) * strideK((i - 0.5) * dt);
    x[i] = x[i - 1] + (now.x - prev.x) * m; z[i] = z[i - 1] + (now.z - prev.z) * m;
    prev.copy(now);
  }
  travelLUT = { n, x, z };
}
function trueTravel(t, out = V3()) {
  if (!travelLUT) return rawTravel(t, out);
  const { n, x, z } = travelLUT, f = clamp(t / S.dur, 0, 1) * (n - 1), i = Math.min(Math.floor(f), n - 2), u = f - i;
  return out.set(lerp(x[i], x[i + 1], u), 0, lerp(z[i], z[i + 1], u));
}
function rawTravel(t, out = V3()) {   // the clip's own root travel at timeline time t
  out.set(0, 0, 0);
  if (!cur) return out;
  const ct = clipTime(t), c = cur.c;
  if (cur.kind === 'loop' || c.imported) {
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
  const bk = BAKED[cur.id] || cur.c.origBk; if (bk) { sampleBaked(bk, tau, Q, H); return; }   // a baked clip plays its baked frames
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
  let W = 1; const ba0 = boneOn(name); if (ba0) W = evalPts(ba0.whole, t);
  let p = rig.bones[boneIdx.get(name)].parent;
  while (p && p.isBone) { const pba = boneOn(p.name); if (pba && pba.withChildren) W *= evalPts(pba.whole, t); p = p.parent; }
  return W;
}
// ---------------------------------------------------------------- foot on ground (braking)
// "Foot on ground" +g % of the cycle: each leg's stance (its contact window) is stretched by g and its swing
// squeezed by the same amount, so the cycle length stays. The leg (thigh and below) samples the clip at that
// re-timed phase; everything else is untouched. Auto foot-lock follows the longer contacts.
const GND_MAX = 30;
function clipWin(Sd) { const bk = BAKED[cur.id] || cur.c.origBk, w = (bk && bk.win) || cur.c.win; return w && w[Sd] ? w[Sd] : null; }
function gndAt(t) { return A.gnd && cur && cur.kind === 'loop' ? clamp(evalPts(A.gnd, t), 0, GND_MAX) / 100 : 0; }
function gndWin(Sd, g) {   // the contact window after the stretch
  const w = clipWin(Sd); if (!w) return null;
  const s = w[1] - w[0]; return [w[0], w[0] + Math.min(0.95, s + g)];
}
function gndPhase(Sd, p, g) {   // output phase → source phase for that leg
  const w = clipWin(Sd); if (!w || g < 1e-4) return p;
  const s = w[1] - w[0], s2 = Math.min(0.95, s + g), du = mod1(p - w[0]);
  return w[0] + (du < s2 ? du * (s / s2) : s + (du - s2) * ((1 - s) / (1 - s2)));
}
let gndLegs = null;
function gndLegSets() {
  if (gndLegs && gndLegs.rig === rig) return gndLegs;
  gndLegs = { rig };
  for (const Sd of ['L', 'R']) { const set = new Set(); rig.side[Sd].thigh.traverse((o) => { if (o.isBone) set.add(o.name); }); gndLegs[Sd] = set; }
  return gndLegs;
}
const gndArr = { L: null, R: null }, gndH = V3();
// a track muted from its header (Vegas-style M button) counts as not there
const boneOn = (n) => { const b = A.bones[n]; return b && !b.bypass ? b : undefined; };
// Stride length (master track, % of the clip's own): each foot reaches that much further ahead of / behind the hips
// (foot IK), the ground covered grows by the same share (no sliding), and the arm swing follows when strideArms is on
function strideK(t) { return A && A.stride ? clamp(evalPts(A.stride, t) / 100, 0.5, 1.5) : 1; }
let armChain = null;
let stepNm = null;
function stepNames() { if (stepNm && stepNm.rig === rig) return stepNm; stepNm = { rig, knee: new Set(['L', 'R'].map((S) => rig.side[S].shin.name)), arm: new Set(['L', 'R'].map((S) => rig.side[S].upper.name)) }; return stepNm; }
function armBones() { if (armChain && armChain.rig === rig) return armChain; armChain = { rig, set: new Set() }; for (const Sd of ['L', 'R']) for (const k of ['clav', 'upper', 'fore', 'hand']) armChain.set.add(rig.side[Sd][k].name); return armChain; }
const shiftPool = [], HshiftScratch = V3(), _trav = V3();
function composePose(t, Qout, Hout, pend) {
  lib.sample(lib.idle, mod1(t / lib.idle.dur), Qi[0], Hi);
  sampleClip(clipTime(t), Qc[0], Hc);
  const QI = Qi[0], QC = Qc[0];
  const stepK = stepCouple() ? strideK(t) : 1, kneeF = stepKneeK(stepK), armF = stepArmK(stepK), sn = stepNames();   // step length: knee lift + shoulder swing
  const gw = new Map(), gt = new Map();
  for (const gid of A.groupOrder) { const g = A.groups[gid]; if (!g || g.bypass) continue; gw.set(gid, evalPts(g.weight, t)); gt.set(gid, evalPts(g.timing, t)); }
  const gF = gw.size ? rig.bones.map((b) => groupFactor(b.name, gw, gt)) : null;
  // per-bone timing offset (its own + its groups'): re-sample the clip at a shifted clip-time for bones that use it
  const shiftKeyOf = new Map(), shiftArr = new Map();
  for (let i = 0; i < B; i++) {
    const name = rig.bones[i].name, ba = boneOn(name);
    const sh = (ba && ba.timing ? evalPts(ba.timing, t) : 0) + (gF ? gF[i][1] : 0);
    if (Math.abs(sh) < 1e-4) continue;
    const key = Math.round(sh * 1000); shiftKeyOf.set(name, key);
    if (!shiftArr.has(key)) { const arr = shiftPool.pop() || new Float32Array(B * 4); sampleClip(clipTime(t) + sh * (cur.dur || 1), arr, HshiftScratch); shiftArr.set(key, arr); }
  }
  // foot on ground: each leg from its own re-timed phase (a bone's own timing shift still wins)
  const g = gndAt(t), legOf = g > 1e-4 ? gndLegSets() : null;
  if (legOf) for (const Sd of ['L', 'R']) {
    if (!clipWin(Sd)) { gndArr[Sd] = null; continue; }
    const ct = clipTime(t), cyc = Math.floor(ct / cur.dur), p = mod1(ct / cur.dur);
    if (!gndArr[Sd]) gndArr[Sd] = new Float32Array(B * 4);
    sampleClip((cyc + gndPhase(Sd, p, g)) * cur.dur, gndArr[Sd], gndH);
  }
  const pb = pend && pend.kind === 'bone' ? pend : null;
  for (let i = 0; i < B; i++) {
    const o = i * 4, name = rig.bones[i].name, ba = boneOn(name);
    const legSd = legOf ? (legOf.L.has(name) ? 'L' : legOf.R.has(name) ? 'R' : null) : null;
    const src = shiftKeyOf.has(name) ? shiftArr.get(shiftKeyOf.get(name)) : legSd && gndArr[legSd] ? gndArr[legSd] : QC;
    qC.fromArray(src, o);
    const pd = pb && pb.name === name ? pb.deg : null;
    const W = wholeEff(name, t) * (gF ? gF[i][0] : 1) * (stepK !== 1 ? (sn.knee.has(name) ? kneeF : sn.arm.has(name) ? armF : 1) : 1);
    if (!ba && !pd && Math.abs(W - 1) < 1e-6) { Qout.set(src.subarray(o, o + 4), o); continue; }
    qI.fromArray(QI, o);
    qD.copy(qI).invert().multiply(qC); if (qD.w < 0) { qD.x = -qD.x; qD.y = -qD.y; qD.z = -qD.z; qD.w = -qD.w; }
    logQ(qD, vv);
    const D = DEG;
    let x = vv.x * W, y = vv.y * W, z = vv.z * W;
    if (ba) {
      x = vv.x * evalPts(ba.w.x, t) * W + evalPts(ba.a.x, t) * D; y = vv.y * evalPts(ba.w.y, t) * W + evalPts(ba.a.y, t) * D; z = vv.z * evalPts(ba.w.z, t) * W + evalPts(ba.a.z, t) * D;
    }
    if (pd) { x += pd.x * D; y += pd.y * D; z += pd.z * D; }
    expV(x, y, z, qO); qO.premultiply(qI);
    Qout[o] = qO.x; Qout[o + 1] = qO.y; Qout[o + 2] = qO.z; Qout[o + 3] = qO.w;
  }
  for (const arr of shiftArr.values()) shiftPool.push(arr);
  const hi = boneIdx.get(rig.b.hips.name), wh = wholeEff(rig.b.hips.name, t) * (gF ? gF[hi][0] : 1);
  Hout.copy(Hi).lerp(Hc, wh).add(shownTravel(t, _trav));
  if (A.symOrder.length) applySymmetrize(t, Qout, Hout);
  applySteady(t, Qout, Hout);
}

// ---------------------------------------------------------------- symmetrize (mirror with a half-cycle offset)
// In a loop the left side should do, half a cycle later, what the right side did (mirrored). A symmetrize item
// makes the target side's arm or leg take the source side's clip motion from half a cycle away, mirrored across
// the body's mid-plane and measured relative to the chest (arms) or the pelvis (legs), blended by its weight track.
const SYM_KEYS = [['arm:RL', 'Arms: right → left'], ['arm:LR', 'Arms: left → right'], ['leg:RL', 'Legs: right → left'], ['leg:LR', 'Legs: left → right']];
const symLabel = (k) => (SYM_KEYS.find(([x]) => x === k) || [k, k])[1];
let symChains = null;
const symFK = { a: null, b: null, Q: null, H: null };
function symChain(region, Sd) {
  if (!symChains) {
    const sub = (b) => { const out = []; b.traverse((o) => o.isBone && !/_End$/i.test(o.name) && out.push(o)); return out; };   // parents first
    symChains = { arm: { L: sub(rig.side.L.clav), R: sub(rig.side.R.clav) }, leg: { L: sub(rig.side.L.thigh), R: sub(rig.side.R.thigh) } };
  }
  return symChains[region][Sd];
}
function newSymAuto(dur) { return { collapsed: false, show: { weight: true, offset: true }, weight: flat(1, dur), offset: flat(0.5, dur) }; }
function ensureSymFK() { if (!symFK.a) { symFK.a = new VirtualFK(rig); symFK.b = new VirtualFK(rig); symFK.Q = new Float32Array(B * 4); symFK.H = V3(); } }
// mirror the source pose (srcQ / srcH, already sampled) onto the target side of Qout, blended by w
function symMirrorInto(Qout, Hout, key, w, srcQ, srcH) {
  ensureSymFK();
  const F = symFK.a, G = symFK.b, q = new THREE.Quaternion(), cl = new THREE.Quaternion();
  F.run(srcQ, srcH, 0);
  G.run(Qout, Hout, 0);   // the pose so far (an earlier item may have changed it)
  const [region, dir] = key.split(':'), tgt = dir === 'RL' ? 'L' : 'R';
  const ai = boneIdx.get((region === 'arm' ? rig.b.spine2 : rig.b.hips).name);
  const aSrcInv = F.delta(ai).invert(), aCur = G.delta(ai);
  const newW = new Map();
  for (const tb of symChain(region, tgt)) {
    const ti = boneIdx.get(tb.name), sn = mirrorName(tb.name), si = sn != null ? boneIdx.get(sn) : undefined;
    if (si == null) continue;
    const D = aSrcInv.clone().multiply(F.delta(si));                    // source, relative to its anchor
    q.set(D.x, -D.y, -D.z, D.w);                                        // mirrored across x = 0
    const world = aCur.clone().multiply(q).multiply(G.bq[ti]);
    const pi = G.parent[ti], parentW = newW.get(pi) || G.Q[pi];
    const local = parentW.clone().invert().multiply(world);
    cl.fromArray(Qout, ti * 4).slerp(local, w).toArray(Qout, ti * 4);
    newW.set(ti, parentW.clone().multiply(cl));
  }
}
function applySymmetrize(t, Qout, Hout) {
  const act = A.symOrder.filter((k) => A.sym[k] && !A.sym[k].bypass && evalPts(A.sym[k].weight, t) > 1e-4);
  if (!act.length) return;
  ensureSymFK();
  for (const key of act) {
    // the source: `offset` of a cycle away (50 % = an even split; move it when one step is longer than the other)
    const off = A.sym[key].offset ? evalPts(A.sym[key].offset, t) : 0.5;
    sampleClip(clipTime(t) + (cur.kind === 'loop' ? cur.dur * off : 0), symFK.Q, symFK.H);
    symMirrorInto(Qout, Hout, key, clamp(evalPts(A.sym[key].weight, t), 0, 1), symFK.Q, symFK.H);
  }
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
  const k = strideK(t);
  if (Math.abs(k - 1) > 1e-4) { const P = fk.v.P, hz = P[boneIdx.get(rig.b.hips.name)].z; for (const Sd of ['L', 'R']) { const f = P[boneIdx.get(rig.side[Sd].foot.name)]; f.z = hz + (f.z - hz) * k; } }
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
const effActive = (id, pend) => (!!A.ik[id] && !A.ik[id].bypass) || !!(pend && pend.kind === 'eff' && pend.id === id) || runLeanOn(id);
// an effector's value: its own track (or the neutral value), plus what the Run controls' spine lean adds
function effVal(id, k, t) { const e = A.ik[id], own = e && e.tr[k] ? evalPts(e.tr[k], t) : TRK[k].ref; return own + runLeanAdd(id, k, t); }
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
const TORSO_IDS = ['spine', 'spine1', 'chest', 'neck', 'head'];
// move a point on the spine toward a target by turning the joints below it (nearest first), each at most maxDeg in all
function ccdMove(bone, chain, target, iters = 8, maxDeg = 45) {
  const used = chain.map(() => 0), q = new THREE.Quaternion();
  for (let it = 0; it < iters; it++) {
    chain.forEach((j, i) => {
      const pj = worldP(j), a = worldP(bone).sub(pj), c = target.clone().sub(pj);
      if (a.lengthSq() < 1e-8 || c.lengthSq() < 1e-8) return;
      q.setFromUnitVectors(a.normalize(), c.normalize());
      let ang = 2 * Math.acos(clamp(Math.abs(q.w), -1, 1));
      const room = maxDeg * DEG - used[i];
      if (room <= 1e-5 || ang < 1e-5) return;
      if (ang > room) { q.slerp(IDQ.clone(), 1 - room / ang); ang = room; }
      used[i] += ang;
      rotateBoneWorld(j, q);
    });
    if (worldP(bone).distanceTo(target) < 5e-4) break;
  }
}
function holdStart(pts, t) {   // start of the current "hold on" span, on a 1/120 s grid
  const step = 1 / 120; let t0 = Math.round(t / step) * step;
  while (t0 > 1e-6 && evalPts(pts, t0 - step) >= 0.5) t0 -= step;
  return Math.max(0, t0);
}
const holdCache = new Map();
function holdTarget(bone, pts, t, tNow = t) {   // world spot the effector had (FK) when the hold (on at t) began
  const t0 = holdStart(pts, t), bi = boneIdx.get(bone.name), key = `${editVersion}|${S.inPlace}|${bi}|${t0.toFixed(4)}|${S.travelBase.x.toFixed(3)},${S.travelBase.z.toFixed(3)}`;
  let p = holdCache.get(key);
  if (!p) { p = fkPositionsAt(t0)[bi].clone(); if (holdCache.size > 64) holdCache.clear(); holdCache.set(key, p); }
  p = p.clone();
  if (S.inPlace) p.sub(trueTravel(tNow)).add(trueTravel(t0));   // in place the world slides back under him
  return p;
}
// Hold with soft edges: the lock blends in after a landing and out after it lets go, so the foot never snaps.
// → { w, spot }: how much of the held spot to use (0…1) and the spot; w = 0 when no hold is near.
function holdBlend(bone, pts, t) {
  const on = evalPts(pts, t) >= 0.5, step = 1 / 120, sm = (u) => u * u * (3 - 2 * u);
  if (on) {
    const t0 = holdStart(pts, t), bin = Math.max(0, S.lockIn || 0);
    return { w: bin > 1e-4 ? sm(clamp((t - t0) / bin, 0, 1)) : 1, spot: holdTarget(bone, pts, t) };
  }
  const bout = Math.max(0, S.lockOut ?? 0.12);
  if (bout < 1e-4) return { w: 0, spot: null };
  let t1 = Math.round(t / step) * step, n = 0;
  while (t1 > 1e-6 && evalPts(pts, t1 - step) < 0.5 && n * step < bout) { t1 -= step; n++; }
  if (t1 <= 1e-6 || evalPts(pts, t1 - step) < 0.5) return { w: 0, spot: null };
  // let go: the gap between the held spot and the foot's own path AT the release is carried on and faded out,
  // riding on that path — not a pull back toward the spot, which the swinging foot leaves further behind each frame
  const bi = boneIdx.get(bone.name), spotAt = holdTarget(bone, pts, t1 - step, t1), k0 = `r|${editVersion}|${S.inPlace}|${bi}|${t1.toFixed(4)}`;
  let gap = holdCache.get(k0);
  if (!gap) { gap = spotAt.clone().sub(fkPositionsAt(t1)[bi]); if (holdCache.size > 64) holdCache.clear(); holdCache.set(k0, gap); }
  const w = 1 - sm(clamp((t - t1) / bout, 0, 1));
  return { w: 1, spot: fkPositionsAt(t)[bi].clone().addScaledVector(gap, w), fade: w };
}
// How far each held foot's own animation (FK) drifts while it is locked: the gap the lock has to hide, which
// is what the foot jumps by on release without a blend. Also the moving-speed factor that closes it best:
// the drift = the foot's motion under the hips + the travel over the hold; scaling the travel by k cancels it.
function footSlideReport() {
  const keep = S.inPlace; S.inPlace = false;
  const res = { spans: 0, meanCm: 0, maxCm: 0, k: 1 };
  let num = 0, den = 0, sum = 0;
  try {
    for (const Sd of ['L', 'R']) {
      const e = A.ik[Sd + 'foot']; if (!e || !e.tr.hold) continue;
      const pts = e.tr.hold, bi = boneIdx.get(rig.side[Sd].foot.name);
      const spans = []; let a = null;
      for (let t = 0; t <= S.dur + 1e-9; t += 1 / 120) { const on = evalPts(pts, t) >= 0.5; if (on && a == null) a = t; if (!on && a != null) { spans.push([a, t]); a = null; } }
      for (const [t0, t1] of spans) {
        if (t1 - t0 < 0.02) continue;
        const f0 = fkPositionsAt(t0)[bi].clone(), f1 = fkPositionsAt(t1)[bi].clone();
        const T = trueTravel(t1).sub(trueTravel(t0)); T.y = 0;
        const d = f1.sub(f0); d.y = 0; const rel = d.clone().sub(T);
        const cm = d.length() * 100; sum += cm; res.maxCm = Math.max(res.maxCm, cm); res.spans++;
        num += rel.dot(T); den += T.dot(T);
      }
    }
  } finally { S.inPlace = keep; }
  res.meanCm = res.spans ? sum / res.spans : 0;
  res.k = den > 1e-9 ? clamp(-num / den, 0.05, 5) : 1;
  return res;
}
function matchMovingSpeed() {
  const r = footSlideReport(); if (!r.spans) return 'Write the foot-lock tracks first.';
  pushUndo(); for (const p of A.move) p.v = clamp(p.v * r.k, 0, 3);
  moveEndCache = null; rebuildSpeedLUT(); holdCache.clear(); rebuildRows(); save();
  const after = footSlideReport();
  return `Moving speed ×${r.k.toFixed(2)}: foot drift under the lock ${r.meanCm.toFixed(1)} → ${after.meanCm.toFixed(1)} cm (average).`;
}

// ---------------------------------------------------------------- full-body IK solve
// ---------------------------------------------------------------- anatomical limits
// swing / twist cones (degrees, from the bind pose) for spine, neck, wrists, ankles, toes, collarbones, elbows and
// knees; the hip and the shoulder get anatomical ranges in the pelvis / chest frame instead of a cone
let limDefs = null;
function limitDefs() {
  if (limDefs) return limDefs;
  const b = rig.b, L = [];
  const axisOf = (bone) => { const c = bone.children.find((x) => x.isBone), v = c ? rig.bind.get(c).lp.clone() : V3(0, 1, 0); return v.lengthSq() > 1e-10 ? v.normalize() : V3(0, 1, 0); };
  const st = (bone, swing, twist) => bone && L.push({ bone, kind: 'st', swing: swing * DEG, twist: twist * DEG, axis: axisOf(bone), lq: rig.bind.get(bone).lq.clone() });
  st(b.spine, 35, 25); st(b.spine1, 35, 25); st(b.spine2, 30, 25); st(b.neck, 45, 50); st(b.head, 40, 45);
  for (const Sd of ['L', 'R']) {
    const sd = rig.side[Sd];
    st(sd.clav, 30, 15);
    L.push({ bone: sd.upper, kind: 'shoulder', side: sd.s, anchor: b.spine2, rest: rig.bp(sd.fore).sub(rig.bp(sd.upper)).normalize() });
    st(sd.fore, 155, 95); st(sd.hand, 80, 45);
  }
  for (const Sd of ['L', 'R']) {
    const sd = rig.side[Sd];
    L.push({ bone: sd.thigh, kind: 'hip', side: sd.s, anchor: b.hips, rest: rig.bp(sd.shin).sub(rig.bp(sd.thigh)).normalize() });
    st(sd.shin, 155, 35); st(sd.foot, 55, 30); st(sd.toe, 65, 15);
  }
  limDefs = L;
  return L;
}
const qAng = (q) => 2 * Math.acos(clamp(Math.abs(q.w), 0, 1));
function clampSwingTwist(L) {
  const q = L.bone.quaternion, d = L.lq.clone().invert().multiply(q), a = L.axis;
  const pr = d.x * a.x + d.y * a.y + d.z * a.z;
  let tw = new THREE.Quaternion(a.x * pr, a.y * pr, a.z * pr, d.w);
  if (tw.lengthSq() < 1e-12) tw.set(0, 0, 0, 1); tw.normalize();
  let sw = d.clone().multiply(tw.clone().invert()), hit = false;
  const ta = qAng(tw), sa = qAng(sw);
  if (ta > L.twist) { tw = IDQ.clone().slerp(tw, L.twist / ta); hit = true; }
  if (sa > L.swing) { sw = IDQ.clone().slerp(sw, L.swing / sa); hit = true; }
  if (hit) { q.copy(L.lq).multiply(sw).multiply(tw); L.bone.updateMatrixWorld(true); }
  return hit;
}
function clampLimbDir(L) {   // hip / shoulder: the limb's direction in the pelvis / chest frame
  const dA = rig.delta(L.anchor), D = dA.clone().invert().multiply(rig.delta(L.bone));
  const v = L.rest.clone().applyQuaternion(D), s = L.side;
  let v2 = null;
  if (L.kind === 'hip') {   // flexion −30…125°, abduction −25…45°
    const flex = Math.atan2(v.z, -v.y), abd = Math.asin(clamp(v.x * s, -1, 1));
    const f2 = clamp(flex, -30 * DEG, 125 * DEG), a2 = clamp(abd, -25 * DEG, 45 * DEG);
    if (f2 !== flex || a2 !== abd) v2 = V3(s * Math.sin(a2), -Math.cos(a2) * Math.cos(f2), Math.cos(a2) * Math.sin(f2));
  } else {                   // the arm swings at most 55° behind the side line and 140° across the front
    const r = Math.hypot(v.x, v.z); if (r < 0.2) return false;
    const az = Math.atan2(v.z, v.x * s), a2 = clamp(az, -55 * DEG, 140 * DEG);
    if (a2 !== az) v2 = V3(s * r * Math.cos(a2), v.y, r * Math.sin(a2));
  }
  if (!v2) return false;
  rotateBoneWorld(L.bone, new THREE.Quaternion().setFromUnitVectors(v.applyQuaternion(dA).normalize(), v2.normalize().applyQuaternion(dA)));
  return true;
}
function applyLimits(before) {
  const hits = new Set();
  limitDefs().forEach((L, i) => {
    if (L.bone.quaternion.angleTo(before[i]) < 0.2 * DEG) return;   // untouched by the IK
    if (L.kind === 'st' ? clampSwingTwist(L) : clampLimbDir(L)) hits.add(L.bone.name);
  });
  S.limitHits = hits;
}

// which active group IKs hold an effector, and how much of the group's move it takes
const CARRIERS = { spine: ['hips'], spine1: ['spine', 'hips'], chest: ['spine1', 'spine', 'hips'], neck: ['chest', 'spine1', 'spine', 'hips'], head: ['neck', 'chest', 'spine1', 'spine', 'hips'], Lhand: ['chest', 'spine1', 'spine', 'hips'], Rhand: ['chest', 'spine1', 'spine', 'hips'], Lfoot: ['hips'], Rfoot: ['hips'] };
function makeGroupCtx(t, pend) {
  const ids = A.ikOrder.filter((id) => EFF_BY_ID[id] && EFF_BY_ID[id].kind === 'igroup' && A.ik[id] && !A.ik[id].bypass);
  if (pend && pend.kind === 'eff' && EFF_BY_ID[pend.id] && EFF_BY_ID[pend.id].kind === 'igroup' && !ids.includes(pend.id)) ids.push(pend.id);
  const pivots = new Map();
  const ctx = {
    ids,
    has(id) { return ids.some((g) => (igMembers(g)[id] || 0) > 0 || (EFF_BY_ID[g].poles || []).includes(id)); },
    carried(id, g) {   // 0…1: how much of this member the group already moves through another member
      const m = igMembers(g);
      if (!(CARRIERS[id] || []).some((c) => (m[c] || 0) > 0)) return 0;
      if (/hand$/.test(id)) { const e = A.ik[id]; if (e && evalPts(e.tr.hold, t) >= 0.5) return 0; return 1 - (A.ik[id] ? effVal(id, 'pin', t) * effVal(id, 'blend', t) : 0); }
      if (/foot$/.test(id)) { const e = A.ik[id]; if (e && evalPts(e.tr.hold, t) >= 0.5) return 0; return 1 - (A.ik.hips ? effVal('hips', 'feet', t) : 1); }
      return 1;
    },
    // → { dpos, q, apply(point) }: the groups' move of a member whose base position is `base`
    xf(id, base) {
      const parts = [];
      for (const g of ids) {
        const mw = igMembers(g)[id] || 0; if (mw <= 0) continue;
        // a member carried by another member of the group (a hand on the moving hips) already gets that member's share;
        // it takes only what is left of its own
        const m = igMembers(g), cw = Math.max(0, ...(CARRIERS[id] || []).map((c) => m[c] || 0));
        const w = effVal(g, 'blend', t) * Math.max(0, mw - cw * this.carried(id, g)); if (w < 1e-4) continue;
        if (!pivots.has(g)) pivots.set(g, igPivotPos(g));
        parts.push({ pivot: pivots.get(g), q: effRotQ(g, t, pend, w), dp: effPosOff(g, t, pend, w) });
      }
      const apply = (pt) => { const p = pt.clone(); for (const x of parts) p.sub(x.pivot).applyQuaternion(x.q).add(x.pivot).add(x.dp); return p; };
      const q = new THREE.Quaternion(); for (const x of parts) q.premultiply(x.q);
      return { dpos: parts.length ? apply(base).sub(base) : V3(), q, apply, any: parts.length > 0 };
    },
  };
  return ctx;
}

// ---------------------------------------------------------------- full-body IK solve
function solveIK(t, pend) {
  const sk = strideK(t), strideOn = Math.abs(sk - 1) > 1e-4;
  const sf = stdFeet;   // steadiness moved the hips: the feet go back to where the unsteadied pose had them
  const active = A.ikOrder.length || (pend && pend.kind === 'eff') || strideOn || sf || leanActive();
  if (!active) return;
  const GX = makeGroupCtx(t, pend);
  const before = S.limits ? limitDefs().map((L) => L.bone.quaternion.clone()) : null;   // FK pose, to find what the IK changed
  const on = (id) => effActive(id, pend) || GX.has(id);
  const b = rig.b;
  // FK reference, before any effector moves the body
  const fkRef = {};
  for (const Sd of ['L', 'R']) {
    const sd = rig.side[Sd];
    fkRef[Sd] = { foot: worldP(sd.foot), footQ: rig.delta(sd.foot), hand: worldP(sd.hand), handQ: rig.delta(sd.hand) };
  }
  const hz0 = worldP(b.hips).z;   // stride scales the planted-foot spots about the hips as they were before the hips moved
  // 1. hips
  let feetPin = 1;
  if (on('hips')) {
    const w = effVal('hips', 'blend', t);
    feetPin = effVal('hips', 'feet', t);
    const p0 = worldP(b.hips), gx = GX.xf('hips', p0);
    const off = effPosOff('hips', t, pend, w).add(gx.dpos);
    if (off.lengthSq() > 1e-12) rig.setHipsWorld(p0.add(off));
    rig.setDelta(b.hips, gx.q.clone().multiply(effRotQ('hips', t, pend, w)).multiply(rig.delta(b.hips)));
  }
  // 2. leg targets (needed now: the hips come down if planted feet are out of reach)
  const legT = {};
  for (const Sd of ['L', 'R']) {
    const sd = rig.side[Sd], fId = Sd + 'foot';
    const need = on(fId) || on(Sd + 'knee') || (on('hips') && feetPin > 0) || on('spine') || strideOn || sf;
    if (!need) continue;
    const carried = worldP(sd.foot), carriedQ = rig.delta(sd.foot);
    if (strideOn) { const hz = worldP(b.hips).z; carried.z = hz + (carried.z - hz) * sk; }   // stride: the foot reaches further ahead / behind the hips
    const fkFoot = (sf ? sf[Sd].p : fkRef[Sd].foot).clone(); if (strideOn) fkFoot.z = hz0 + (fkFoot.z - hz0) * sk;
    const pinW = sf ? 1 : on('hips') ? feetPin : 0;
    let base = carried.clone().lerp(fkFoot, pinW);
    let baseQ = carriedQ.clone().slerp(sf ? sf[Sd].q : fkRef[Sd].footQ, pinW);
    const e = A.ik[fId];
    if (e && !e.bypass && e.tr.hold) { const hb = holdBlend(sd.foot, e.tr.hold, t); if (hb.w > 0) base = base.clone().lerp(hb.spot, hb.w); }
    const w = on(fId) ? effVal(fId, 'blend', t) : 0, gx = GX.xf(fId, base);
    const target = base.clone().add(effPosOff(fId, t, pend, w)).add(gx.dpos);
    baseQ = gx.q.clone().multiply(baseQ);
    legT[Sd] = { target, baseQ, w, gx };
  }
  if (on('hips') || sk > 1.001 || sf) {   // lower the pelvis just enough that both planted feet stay reachable (a longer stride too)
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
  for (const id of TORSO_IDS) {
    if (!on(id)) continue;
    const d = EFF_BY_ID[id], w = effVal(id, 'blend', t), p0 = worldP(b[d.seg]), gx = GX.xf(id, p0);
    const off = effPosOff(id, t, pend, w).add(gx.dpos);
    if (off.lengthSq() > 1e-10) {
      if (d.chain) ccdMove(b[d.seg], d.chain.map((k) => b[k]), p0.clone().add(off));
      else {   // the lower back: half of it a pelvis shift, the rest a pelvis tilt (the feet are re-planted below)
        rig.setHipsWorld(worldP(b.hips).addScaledVector(off, 0.5)); b.hips.updateMatrixWorld(true);
        ccdMove(b.spine, [b.hips], p0.clone().add(off), 8, 30);
      }
    }
    spreadOver(d.spread.map((k) => b[k]), gx.q.clone().multiply(effRotQ(id, t, pend, w)));
  }
  for (const Sd of ['L', 'R']) { const id = Sd + 'shoulder'; if (on(id)) rotateBoneWorld(rig.side[Sd].clav, effRotQ(id, t, pend, effVal(id, 'blend', t))); }
  // 4. hand targets, then the body leans toward targets out of reach (pull)
  const armT = {};
  for (const Sd of ['L', 'R']) {
    const sd = rig.side[Sd], hId = Sd + 'hand';
    if (!on(hId) && !on(Sd + 'elbow')) continue;
    const carried = worldP(sd.hand), carriedQ = rig.delta(sd.hand);
    const w = A.ik[hId] || (pend && pend.id === hId) ? effVal(hId, 'blend', t) : 0, pin = w ? effVal(hId, 'pin', t) * w : 0;
    let base = carried.clone().lerp(fkRef[Sd].hand, pin);
    let baseQ = carriedQ.clone().slerp(fkRef[Sd].handQ, pin);
    const e = A.ik[hId];
    if (e && !e.bypass && e.tr.hold) { const hb = holdBlend(sd.hand, e.tr.hold, t); if (hb.w > 0) base = base.clone().lerp(hb.spot, hb.w); }
    const gx = GX.xf(hId, base);
    baseQ = gx.q.clone().multiply(baseQ);
    armT[Sd] = { target: base.clone().add(effPosOff(hId, t, pend, w)).add(gx.dpos), baseQ, w, gx, pull: w ? effVal(hId, 'pull', t) * w : 0 };
  }
  for (const Sd of ['L', 'R']) {
    const a = armT[Sd]; if (!a || a.pull <= 0) continue;
    const sh = worldP(rig.side[Sd].upper), dist = sh.distanceTo(a.target), L = rig.armLen;
    const need = clamp((dist - L * 0.95) / 0.45, 0, 1) * a.pull;
    if (need <= 0) continue;
    const base = worldP(b.spine), from = sh.sub(base).normalize(), to = a.target.clone().sub(base).normalize();
    spreadOver([b.spine, b.spine1, b.spine2], new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(from, to), need * 0.85));
  }
  // 5. arms (+ forearm rotate)
  for (const Sd of ['L', 'R']) {
    const a = armT[Sd]; if (!a) continue;
    const sd = rig.side[Sd], s = sd.s, sh = worldP(sd.upper);
    let pole = worldP(sd.fore).addScaledVector(V3(s * 0.3, -0.25, -1).normalize(), 0.05);
    if (a.gx.any) pole = a.gx.apply(pole);   // the elbow turns with the hand's group move
    const sw = effSwivel(Sd + 'elbow', t, pend);
    if (Math.abs(sw) > 1e-5) { const ax = a.target.clone().sub(sh).normalize(); pole = pole.sub(sh).applyAxisAngle(ax, sw).add(sh); }
    const r = ikLimb(sd.arm, sh, a.target, pole, V3(0, 0, -1));
    rig.setDelta(sd.upper, r.d1); rig.setDelta(sd.fore, r.d2);
    const handQ = a.w ? effRotQ(Sd + 'hand', t, pend, a.w).multiply(a.baseQ) : a.baseQ;
    if (on(Sd + 'elbow')) rotateBoneWorld(sd.fore, effRotQ(Sd + 'elbow', t, pend));
    rig.setDelta(sd.hand, handQ);
  }
  // 6. legs (+ shin rotate), feet, toes
  for (const Sd of ['L', 'R']) {
    const sd = rig.side[Sd], l = legT[Sd];
    if (l) {
      const hip = worldP(sd.thigh);
      let pole = worldP(sd.shin).addScaledVector(V3(0, 0, 1), 0.05);
      if (l.gx.any) pole = l.gx.apply(pole);
      const sw = effSwivel(Sd + 'knee', t, pend);
      if (Math.abs(sw) > 1e-5) { const ax = l.target.clone().sub(hip).normalize(); pole = pole.sub(hip).applyAxisAngle(ax, sw).add(hip); }
      const r = ikLimb(sd.leg, hip, l.target, pole, V3(0, 0, 1));
      rig.setDelta(sd.thigh, r.d1); rig.setDelta(sd.shin, r.d2);
      const footQ = (A.ik[Sd + 'foot'] || (pend && pend.id === Sd + 'foot')) ? effRotQ(Sd + 'foot', t, pend, l.w).multiply(l.baseQ) : l.baseQ;
      if (on(Sd + 'knee')) rotateBoneWorld(sd.shin, effRotQ(Sd + 'knee', t, pend));
      rig.setDelta(sd.foot, footQ);
    }
    if (on(Sd + 'toes')) {
      const bend = effVal(Sd + 'toes', 'bend', t) * DEG, lat = V3(1, 0, 0).applyQuaternion(rig.delta(sd.foot)).normalize();
      rotateBoneWorld(sd.toe, qAxis(lat, -bend));
      rotateBoneWorld(sd.toe, effRotQ(Sd + 'toes', t, pend));
    }
  }
  // 9. anatomical limits, on the joints the IK changed (the clip's own pose is left alone)
  if (before) applyLimits(before);
  // 7. look-at: a controller can turn the head (neck + head, ≤ 70°) toward itself
  for (const g of GX.ids) {
    const e = A.ik[g]; if (!e || !e.look) continue;
    const w = effVal(g, 'blend', t), hp = worldP(b.head), to = igPivotPos(g).sub(hp);
    if (to.lengthSq() < 1e-6 || w < 1e-3) continue;
    const fwd = V3(0, 0, 1).applyQuaternion(rig.delta(b.head)).normalize(), q = new THREE.Quaternion().setFromUnitVectors(fwd, to.normalize());
    const ang = 2 * Math.acos(clamp(Math.abs(q.w), 0, 1)), lim = 70 * DEG;
    spreadOver([b.neck, b.head], new THREE.Quaternion().slerp(q, w * (ang > lim ? lim / ang : 1)));
  }
  // 8. fingers (local, on top of the clip's hand), then their shared rotate
  for (const Sd of ['L', 'R']) {
    const id = Sd + 'fingers'; if (!on(id)) continue;
    const sd = rig.side[Sd], curl = effVal(id, 'curl', t), spread = effVal(id, 'spread', t), thumb = effVal(id, 'thumb', t);
    for (const f of sd.fingers) {
      const ang = (f.thumb ? thumb : curl) * f.w * DEG;
      if (Math.abs(ang) > 1e-6) f.bone.quaternion.multiply(qAxis(f.axis, ang));
      if (f.spread && f.spreadAxis && Math.abs(spread) > 1e-6) f.bone.quaternion.multiply(qAxis(f.spreadAxis, spread * f.spread * DEG));
    }
    sd.hand.updateMatrixWorld(true);
    const q = effRotQ(id, t, pend);
    if (Math.abs(q.w) < 0.999999) for (const f of sd.fingers) if (f.depth === 0) rotateBoneWorld(f.bone, q);
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
  const c = cur.c, ct = clipTime(t), bk = BAKED[cur.id] || cur.c.origBk, g = gndAt(t);
  if (g > 1e-4) { const w = gndWin(Sd, g); if (w) return inWin(mod1(ct / cur.dur), w); }   // foot on ground: the longer contact
  if (bk && bk.win && cur.kind === 'loop') return bk.win[Sd] ? inWin(mod1(ct / cur.dur), bk.win[Sd]) : null;   // a processed clip: its measured contacts
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
