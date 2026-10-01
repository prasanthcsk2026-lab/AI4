// ============================================================================
//  FORCERS: force sources ("speakers") around the runner. Add as many as you like ("+" menu):
//   · Moving forcer: moves with the runner; X / Y / Z from the root (the ground point under the hips, turned
//     with the runner: X + right, Y height, Z + in front)
//   · Fixed forcer: stays put in the world; X / Y / Z from the runner's start point (world metres), so the runner
//     comes up to it and passes it
//  Tracks per forcer: X / Y / Z position, Facing X / Y / Z (° tilt / turn / roll; the way it points), Force (N;
//  + pushes away like a fan, − pulls toward it like a magnet), Spread (° full cone angle) and Weight (% of the
//  body's reaction: 0 = shown but no effect, 100 = full, 200 = exaggerated).
//  Per forcer settings: name, falloff, show, target: the whole body and / or IK controllers (stiffness, max move,
//  use the cone or always hit, body reacts too). Body settings (all forcers): mass, keep speed.
//  Whole body: every body part inside the cone gets its share of the force along the ray from the forcer; the
//  sum over all forcers leans the body against it, shortens the steps under load (keep speed raises the
//  cadence), lifts / loads it, widens the steps for a side push and pushes the head (formula based, no simulation).
//  IK targets: the controller is moved along the ray (push away / pull toward), up to the max move; its chain
//  follows by IK. Adds to the Run controls; never overwrites their tracks.
// ============================================================================
const GRAV = 9.81;
const RES_KEYS = ['force', 'spread', 'weight', 'resp'];   // automated; position and facing are set in 3D (W / E on the speaker)
const BONE_REGIONS = [['spine', 'Spine'], ['head', 'Neck + head'], ['Larm', 'Left arm'], ['Rarm', 'Right arm'], ['Lleg', 'Left leg'], ['Rleg', 'Right leg']];
const POS_KEYS = ['px', 'py', 'pz'], FACE_KEYS = ['fx', 'fy', 'fz'];
const POS_DEF = { moving: { px: 0, py: 1.2, pz: 1, fx: 0, fy: 180, fz: 0 }, fixed: { px: 0, py: 1.2, pz: 10, fx: 0, fy: 180, fz: 0 } };
const RES_SPEC = {
  force: { range: [-3000, 3000], ref: 0, color: '#e8b04a', scale: 1, unit: 'N', fmt: (v) => sgn(v, 0, ' N'), snap: 10 },
  spread: { range: [5, 180], ref: 90, color: '#c08ae0', scale: 1, unit: '°', fmt: (v) => Math.round(v) + '°', snap: 1 },
  weight: { range: [0, 2], ref: 1, color: '#d0d07a', scale: 100, unit: '%', fmt: pct, snap: 0.05 },
  resp: { range: [0, 1], ref: 0, color: '#ff8a8a', scale: 100, unit: '%', fmt: pct, snap: 0.05 },
};
const RES_LABEL = (mode) => ({
  force: 'Force <i>N · + push / − pull · 736 N = 75 kg body weight</i>', spread: 'Spread <i>° full cone angle</i>', weight: 'Weight <i>% of the body\'s reaction</i>', resp: 'Response <i>% · 0 resist (lean into it) → 100 yield (pushed along the arrows)</i>',
});
const RESK = { sideSign: 1, widthSign: -1, stepPerLoad: 0.75, cadDropPerLoad: 0.25, armPerLoad: 0.6, widthCmPerDeg: 0.6, vertCmPerG: 8, sideHipShare: 0.4, headDegPerN: 0.05, legCadPerLoad: 1.2, legKneePerLoad: 1.0 };
// yield: cm of push per N on the controllers the body gives way with (chest bends back, head, hips, the arms fly)
const YIELD_K = { chest: { part: 'chest', k: 0.15 }, head: { part: 'head', k: 0.15 }, hips: { part: 'pelvis', k: 0.05 }, Lhand: { part: 'Larm', k: 1.0 }, Rhand: { part: 'Rarm', k: 1.0 } };
const FORCER_COLORS = ['#ff9a3c', '#3cd2ff', '#b67cff', '#7cff9a', '#ff6fa5', '#ffe066'];
// IK controllers a forcer can move (the ones with a position)
const forcerIKList = () => EFFECTORS.filter((d) => d.tracks.includes('px') && (d.custom || d.kind !== 'igroup'));   // built-in controllers with a position, and your own controllers
function newForcer(mode, dur, n) {
  const f = { id: 'f' + Date.now().toString(36) + Math.floor(Math.random() * 1e4), name: 'Forcer ' + n, mode, collapsed: false, falloff: 'inv2', show: true, color: FORCER_COLORS[(n - 1) % FORCER_COLORS.length],
    target: { whole: true, ik: [], stiff: 10, maxMove: 40, useCone: true, bodyReacts: true, bones: [], bw: {}, boneFlex: 100 } };
  for (const k of RES_KEYS) f[k] = flat(RES_SPEC[k].ref, dur);
  f.at = { ...POS_DEF[mode] };   // position (m) and facing (°): set in 3D, not automated
  return f;
}
function normalizeForcers(a) {
  const dur = a.dur;
  a.body = a.body || { mass: 75, keepSpeed: true };
  if (!(a.body.mass > 0)) a.body.mass = 75; if (a.body.keepSpeed == null) a.body.keepSpeed = true;
  a.forcers = Array.isArray(a.forcers) ? a.forcers : [];
  if (a.resist) {   // the single Resistance device before forcers (or the older force / direction / vertical one)
    const r = a.resist, f = newForcer('moving', dur, a.forcers.length + 1);
    if (r.dir && !r.px) {
      const F = r.force && r.force.length ? r.force[0].v : 0, h = (r.dir[0] ? r.dir[0].v : 180) * DEG, v = (r.vert && r.vert[0] ? r.vert[0].v : 0) * DEG;
      const pull = [Math.sin(h) * Math.cos(v), Math.sin(v), Math.cos(h) * Math.cos(v)];
      f.px = flat(-pull[0], dur); f.py = flat(1.0 - pull[1], dur); f.pz = flat(-pull[2], dur);
      f.fy = flat(Math.atan2(pull[0], pull[2]) / DEG, dur); f.fx = flat(-Math.asin(clamp(pull[1], -1, 1)) / DEG, dur);
      f.force = r.force && r.force.length ? r.force : flat(F, dur); f.spread = flat(120, dur);
    } else for (const k of [...RES_KEYS, ...POS_KEYS, ...FACE_KEYS]) if (Array.isArray(r[k]) && r[k].length) f[k] = r[k];
    if (f.px) delete f.at;   // its position / facing come from those tracks (below)
    if (r.falloff) f.falloff = r.falloff; if (r.bypass) f.bypass = true;
    if (r.mass > 0) a.body.mass = r.mass; if (r.keepSpeed != null) a.body.keepSpeed = r.keepSpeed;
    a.forcers.push(f); if (a.rowOrder) a.rowOrder = a.rowOrder.map((k) => (k === 'res:main' ? 'frc:' + f.id : k));
    delete a.resist;
  }
  const tNow = typeof S !== 'undefined' && S ? Math.min(S.t || 0, dur) : 0;
  a.forcers.forEach((f, i) => {
    const d = newForcer(f.mode === 'fixed' ? 'fixed' : 'moving', dur, i + 1);
    if (!f.at) { f.at = { ...d.at }; for (const k of [...POS_KEYS, ...FACE_KEYS]) if (Array.isArray(f[k]) && f[k].length) f.at[k] = evalPts(f[k], tNow); }   // tracks from before: the value at the playhead
    for (const k of [...POS_KEYS, ...FACE_KEYS]) { delete f[k]; if (!(typeof f.at[k] === 'number' && isFinite(f.at[k]))) f.at[k] = d.at[k]; }
    for (const k of RES_KEYS) if (!Array.isArray(f[k]) || !f[k].length) f[k] = d[k];
    for (const k of ['id', 'name', 'mode', 'falloff', 'color']) if (!f[k]) f[k] = d[k];
    if (f.show == null) f.show = true;
    f.target = { ...d.target, ...(f.target || {}) }; f.target.ik = (f.target.ik || []).filter((id) => EFF_BY_ID[id]);
    if (!f.target.bw || typeof f.target.bw !== 'object') {   // before per-bone weights: every bone of the ticked regions at 100 %
      const regs = Array.isArray(f.target.bones) ? f.target.bones : BONE_REGIONS.map(([r]) => r); f.target.bw = {};
      for (const [key, , region, chain] of FBONES) if (regs.includes(region) && key !== 'hips') f.target.bw[key] = chain === 'trunk' || chain === 'head' ? 25 : 100;
    }
    for (const k of Object.keys(f.target.bw)) if (!FBONE_BY[k] || !(f.target.bw[k] >= 0)) delete f.target.bw[k];
    f.target.bones = []; if (!(f.target.boneFlex >= 0)) f.target.boneFlex = 100;
  });
  return a;
}
const forcerLive = (f) => !f.bypass && f.force.some((p) => Math.abs(p.v) > 1e-9) && f.weight.some((p) => Math.abs(p.v) > 1e-9);
const forcersOn = () => !!(A && A.forcers && A.forcers.some(forcerLive));   // no cache: timing is rebuilt before an edit bumps editVersion
const resistOn = () => forcersOn() && A.forcers.some((f) => forcerLive(f) && (f.target.whole || f.target.ik.some((id) => id === 'Lfoot' || id === 'Rfoot') || (f.target.bodyReacts && f.target.ik.length)));

// ---------------------------------------------------------------- body parts (bind pose, root frame: x right, y up, z forward)
let resBody = null;
function resParts() {
  if (resBody && resBody.rig === rig) return resBody;
  const b = rig.b, hp = rig.bp(b.hips), rs = Math.sign(rig.bp(rig.side.R.upper).x - hp.x) || -1;
  const loc = (...bones) => { const v = V3(); for (const x of bones) v.add(rig.bp(x)); v.divideScalar(bones.length); return V3((v.x - hp.x) * rs, v.y, v.z - hp.z); };
  const parts = [['head', 0.08, [b.head], b.head], ['chest', 0.3, [b.spine2], b.spine2], ['pelvis', 0.2, [b.hips], b.hips]];
  for (const S0 of ['L', 'R']) { const s = rig.side[S0]; parts.push([S0 + 'thigh', 0.1, [s.thigh, s.shin], s.thigh], [S0 + 'shin', 0.06, [s.shin, s.foot], s.shin], [S0 + 'arm', 0.05, [s.upper, s.hand], s.fore]); }
  resBody = { rig, rs, parts: parts.map(([id, share, bones, bone]) => ({ id, share, p: loc(...bones), bone, upper: /head|chest|arm/.test(id) })) };
  return resBody;
}
const toRoot = (v) => V3(v.x * resParts().rs, v.y, v.z);   // world axes ↔ root frame (the same mirror both ways)
function runnerPath(t) { try { return trueTravel(t, V3()); } catch { return V3(); } }   // the runner's ground position (the last timing's travel)
// the forcer's values at t (a live gizmo change wins)
function forcerVals(f, t) { const p = typeof pending !== 'undefined' && pending && pending.kind === 'forcer' && pending.id === f.id ? pending.vals : null; const o = {}, at = f.at || (f.at = { ...POS_DEF[f.mode === 'fixed' ? 'fixed' : 'moving'] }); for (const k of RES_KEYS) o[k] = evalPts(f[k], t); for (const k of [...POS_KEYS, ...FACE_KEYS]) o[k] = p && p[k] != null ? p[k] : at[k]; return o; }
// the runner's steady root on the ground: its travel, not the hips (which sway, bob and lean every step)
function runRoot(t) { const r = shownTravel(t, V3()); r.y = 0; return r; }
function forcerDevice(f, t) {   // → { pos, dir } in the root frame, F, half (rad), weight
  const v = forcerVals(f, t);
  const dir = V3(0, 0, 1).applyEuler(new THREE.Euler(v.fx * DEG, v.fy * DEG, v.fz * DEG, 'YXZ')).normalize();
  let pos = V3(v.px, v.py, v.pz);
  if (f.mode === 'fixed') { const rp = runnerPath(t); pos = V3(v.px - rp.x * resParts().rs, v.py, v.pz - rp.z); }   // world (from the start) → relative to the runner now
  return { pos, dir, F: v.force, half: clamp(v.spread, 5, 180) / 2 * DEG, weight: v.weight };
}
const resFall = (d, mode) => (mode === 'none' ? 1 : mode === 'linear' ? clamp(1 - d / 4, 0, 1) : Math.min(4, 1 / Math.max(0.35, d) ** 2));
// the cone: 100 % on its centre line, easing down (cosine) to 0 at the edge: half the spread → 50 %
function coneW(ray, D) { const u = Math.acos(clamp(ray.dot(D.dir), -1, 1)) / Math.max(1e-6, D.half); return u >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * u)); }
function forcerPartForces(f, t) {   // whole-body target: [{ ...part, f (N, root frame) }] (weighted)
  const B = resParts(), D = forcerDevice(f, t), out = [];
  for (const q of B.parts) {
    const ray = q.p.clone().sub(D.pos), d = ray.length(); if (d < 1e-4) { out.push({ ...q, f: V3() }); continue; }
    ray.divideScalar(d);
    out.push({ ...q, f: ray.multiplyScalar(D.F * D.weight * q.share * coneW(ray, D) * resFall(d, f.falloff)) });
  }
  return { parts: out, D };
}
// the IK controllers a forcer moves
const IK_PART = { Lhand: 'Larm', Rhand: 'Rarm', Lfoot: 'Lshin', Rfoot: 'Rshin', head: 'head', chest: 'chest', spine: 'chest', spine1: 'chest', neck: 'head', hips: 'pelvis', Lshoulder: 'chest', Rshoulder: 'chest' };
function effPosOf(id) { const b = effBoneOf(id); if (b) return worldP(b); const d = EFF_BY_ID[id]; return d && d.custom ? igPivotPos(id) : null; }
function effBoneOf(id) { const d = EFF_BY_ID[id]; if (!d) return null; if (d.side) { const s = rig.side[d.side]; return { hand: s.hand, foot: s.foot, elbow: s.fore, knee: s.shin, shoulder: s.clav }[d.kind] || null; } return (d.seg && rig.b[d.seg]) || (id === 'hips' ? rig.b.hips : null); }
function forcerIKPush(f, id, t, world = true) {   // the move of one controller by one forcer (m; world axes when world)
  const B = resParts(), D = forcerDevice(f, t), wp = effPosOf(id); if (!wp) return V3();
  const p = toRoot(wp.sub(runRoot(t)));
  const ray = p.sub(D.pos), d = ray.length(); if (d < 1e-4) return V3();
  ray.divideScalar(d);
  const c = f.target.useCone ? coneW(ray, D) : 1, amt = D.F * D.weight * c * resFall(d, f.falloff) * (f.target.stiff / 100) / 100;   // m
  const v = ray.multiplyScalar(clamp(amt, -f.target.maxMove / 100, f.target.maxMove / 100));
  return world ? V3(v.x * B.rs, v.y, v.z) : v;
}
const forcerIKOn = (id) => !!(A && A.forcers && A.forcers.some((f) => forcerLive(f) && f.target.ik.includes(id)));
// yield: the body gives way along the arrows (Response > 0, whole-body forcers)
const yieldOn = (id) => !!(YIELD_K[id] && A && A.forcers && A.forcers.some((f) => forcerLive(f) && f.target.whole && f.resp.some((p) => p.v > 1e-4)));
function forcerYieldAdd(id, k, t) {
  if ((k !== 'px' && k !== 'py' && k !== 'pz') || !yieldOn(id)) return 0;
  const y = YIELD_K[id], v = V3(), rs = resParts().rs;
  for (const f of A.forcers) {
    if (!forcerLive(f) || !f.target.whole) continue;
    const r = clamp(evalPts(f.resp, t), 0, 1); if (r < 1e-4) continue;
    const q = forcerPartForces(f, t).parts.find((x) => x.id === y.part); if (q) v.add(V3(q.f.x * rs, q.f.y, q.f.z).multiplyScalar(r * y.k));
  }
  if (v.length() > 40) v.setLength(40);
  return v[k[1]];
}
const forcerMoveOn = (id) => forcerIKOn(id) || yieldOn(id);
const forcerMoveAdd = (id, k, t) => forcerIKAdd(id, k, t) + forcerYieldAdd(id, k, t);
function forcerIKAdd(id, k, t) {   // cm on the controller's Move X / Y / Z
  if ((k !== 'px' && k !== 'py' && k !== 'pz') || !forcerIKOn(id)) return 0;
  const v = V3(); for (const f of A.forcers) if (forcerLive(f) && f.target.ik.includes(id)) v.add(forcerIKPush(f, id, t));
  return v[k[1]] * 100;
}

// ---------------------------------------------------------------- every bone: bent by the force on it and on what it carries
// Each chain (spine, neck + head, arms, legs) takes the force at its joints (a share each, the cone and the falloff
// as for the body); a bone turns by the torque about its joint from the forces on it and below it (deg per N·m, its
// compliance: the spine is stiff, a hand light). A leg only while its foot is off the ground (a planted foot stays).
// Runs after the IK, before the joint limits (so a knee or an elbow never bends the wrong way).
const BONEK = { share: 0.12, maxDeg: 50 };
// the bones a forcer can bend: [key, label, region (older saves), chain, compliance (° per N·m)]
const FBONES = [
  // (trunk and head: 4× the old compliance, so 100 % shows; older saves come in at 25 % there and look the same)
  ['hips', 'Hips (pelvis)', 'spine', 'trunk', 0.48], ['spine', 'Spine (lower)', 'spine', 'trunk', 0.48], ['spine1', 'Spine (middle)', 'spine', 'trunk', 0.48], ['chest', 'Chest', 'spine', 'trunk', 0.48],
  ['neck', 'Neck', 'head', 'head', 2.0], ['head', 'Head', 'head', 'head', 3.2],
  ...['L', 'R'].flatMap((Sd) => { const n = Sd === 'L' ? 'Left' : 'Right'; return [
    [Sd + 'clav', n + ' shoulder', Sd + 'arm', Sd + 'arm', 0.3], [Sd + 'upper', n + ' upper arm', Sd + 'arm', Sd + 'arm', 1.0], [Sd + 'fore', n + ' forearm', Sd + 'arm', Sd + 'arm', 1.6], [Sd + 'hand', n + ' hand', Sd + 'arm', Sd + 'arm', 3.0],
    [Sd + 'thigh', n + ' thigh', Sd + 'leg', Sd + 'leg', 0.35], [Sd + 'shin', n + ' shin', Sd + 'leg', Sd + 'leg', 0.7], [Sd + 'foot', n + ' foot', Sd + 'leg', Sd + 'leg', 1.5]]; }),
];
const FBONE_BY = Object.fromEntries(FBONES.map((x) => [x[0], x]));
let fbChains = null;
function forcerBoneChains() {
  if (fbChains && fbChains.rig === rig) return fbChains;
  const b = rig.b, tipOf = (bone) => bone.children.find((x) => x.isBone) || bone, ch = [];
  const boneOf = (key) => { if (key === 'hips') return b.hips; if (key === 'spine') return b.spine; if (key === 'spine1') return b.spine1; if (key === 'chest') return b.spine2; if (key === 'neck') return b.neck; if (key === 'head') return b.head; const s = rig.side[key[0]]; return s[key.slice(1)]; };
  for (const name of ['trunk', 'head', 'Larm', 'Rarm', 'Lleg', 'Rleg']) {
    const defs = FBONES.filter((x) => x[3] === name).map(([key, , , , k]) => ({ key, bone: boneOf(key), k })).filter((x) => x.bone);
    const pts = defs.map((x) => (x.key === 'hips' ? b.spine : tipOf(x.bone)));
    if (name === 'trunk') pts.push(b.head);
    ch.push({ region: name, bones: defs, pts });
  }
  fbChains = { rig, ch }; return fbChains;
}
const boneW = (f, key) => (f.target.bw && f.target.bw[key] > 0 ? f.target.bw[key] / 100 : 0);
const boneList = (f) => Object.keys(f.target.bw || {}).filter((k) => f.target.bw[k] > 0);
const bonesOn = () => !!(A && A.forcers && A.forcers.some((f) => forcerLive(f) && f.target.boneFlex > 0 && boneList(f).length));
function legSwingW(Sd, t) { if (!cur || cur.kind !== 'loop') return 0.5; const lp = legPhase(Sd, clipTime(t)); return !lp ? 0.5 : lp.c ? 0 : Math.sin(Math.PI * lp.s); }
function forcerBonePass(t) {
  if (!rig || !bonesOn()) return;
  const C = forcerBoneChains().ch, list = A.forcers.filter((f) => forcerLive(f) && f.target.boneFlex > 0 && boneList(f).length), rec = [];
  const devs = list.map((f) => { const W = forcerWorldPose(f, t); return { f, W, flex: (f.target.boneFlex / 100) * (0.5 + 0.5 * clamp(evalPts(f.resp, t), 0, 1)) }; });
  for (const c of C) {
    const legW = /leg$/.test(c.region) ? legSwingW(c.region[0], t) : 1; if (legW < 1e-3) continue;
    const use = devs.filter((d) => c.bones.some((x) => boneW(d.f, x.key) > 0)); if (!use.length) continue;
    const pts = c.pts.map((x) => worldP(x)), joints = c.bones.map((x) => worldP(x.bone)), tqs = c.bones.map(() => V3());
    for (const d of use) {
      const D = d.W.D, dir = d.W.dirW, frc = pts.map(() => V3());
      let any = false;
      pts.forEach((p, i) => {
        const ray = p.clone().sub(d.W.pos), dist = ray.length(); if (dist < 1e-4) return; ray.divideScalar(dist);
        const m = D.F * D.weight * BONEK.share * coneW(ray, { dir, half: D.half }) * resFall(dist, d.f.falloff) * d.flex * legW;
        if (Math.abs(m) > 1e-6) { frc[i].addScaledVector(ray, m); any = true; }
      });
      if (!any) continue;
      c.bones.forEach((x, j) => {   // torque about this joint from the forces at its own tip and every point below it, × that bone's weight
        const w = boneW(d.f, x.key); if (w <= 0) return;
        const tq = V3(); for (let i = j; i < pts.length; i++) tq.add(V3().crossVectors(pts[i].clone().sub(joints[j]), frc[i]));
        tqs[j].addScaledVector(tq, w);
      });
    }
    const rots = c.bones.map((x, j) => { const a = Math.min(BONEK.maxDeg, tqs[j].length() * x.k) * DEG; rec.push([x.bone.name, a / DEG]); return a > 1e-5 ? new THREE.Quaternion().setFromAxisAngle(tqs[j].clone().normalize(), a) : null; });
    c.bones.forEach((x, j) => {
      if (!rots[j]) return;
      rotateBoneWorld(x.bone, rots[j]);
      if (x.key === 'hips') { const inv = rots[j].clone().invert(); for (const Sd of ['L', 'R']) rotateBoneWorld(rig.side[Sd].thigh, inv); }   // the pelvis tilts, the legs keep their line
    });
  }
  S.forcerBones = rec;
}

// ---------------------------------------------------------------- the sum on the body at time t
const RES0 = { back: 0, side: 0, up: 0, load: 0, lean: 0, sideLean: 0, stepK: 1, cadK: 1, armK: 1, heightCm: 0, widthCm: 0, hipShare: 0.5, headRx: 0, legLoad: 0, legKnee: 1 };
function resistAt(t) {
  if (!resistOn()) return RES0;
  const N = V3(); let upper = 0, all = 0, headZ = 0, legSum = 0;
  const addPart = (q, fv, rf = 1) => { const g = fv.clone().multiplyScalar(rf); N.add(g); const m = g.length(); all += m; if (q.upper) upper += m; if (q.id === 'head') headZ += g.z; };
  for (const f of A.forcers) {
    if (!forcerLive(f)) continue;
    const rf = 1 - clamp(evalPts(f.resp, t), 0, 1);   // the part the runner resists (the rest it yields to)
    if (f.target.whole) for (const q of forcerPartForces(f, t).parts) { addPart(q, q.f, rf); if (/thigh|shin/.test(q.id)) legSum += q.f.length(); }
    for (const id of f.target.ik) if (id === 'Lfoot' || id === 'Rfoot') {   // a pushed foot drags the leg too
      const D = forcerDevice(f, t), q = resParts().parts.find((x) => x.id === id[0] + 'shin'), ray = q.p.clone().sub(D.pos), d = ray.length(); if (d < 1e-4) continue; ray.divideScalar(d);
      legSum += Math.abs(D.F * D.weight) * (f.target.useCone ? coneW(ray, D) : 1) * resFall(d, f.falloff) * 0.2;
    }
    if (f.target.bodyReacts && f.target.ik.length && rig) {   // a pushed controller pulls the body along a little
      const parts = resParts().parts, D = forcerDevice(f, t);
      for (const id of f.target.ik) {
        const q = parts.find((x) => x.id === IK_PART[id]) || parts[2], ray = q.p.clone().sub(D.pos), d = ray.length(); if (d < 1e-4) continue; ray.divideScalar(d);
        addPart(q, ray.multiplyScalar(D.F * D.weight * 0.15 * (f.target.useCone ? coneW(ray, D) : 1) * resFall(d, f.falloff)));
      }
    }
  }
  const back = -N.z, side = N.x, lift = N.y, body = A.body || { mass: 75, keepSpeed: true };
  const W = body.mass * GRAV, Weff = Math.max(0.2 * W, W - lift), load = back / W;
  const lean = Math.atan2(back, Weff) / DEG, sideLean = -Math.atan2(side, Weff) / DEG;   // lean against the push
  const stepK = load >= 0 ? clamp(1 - RESK.stepPerLoad * load, 0.5, 1) : clamp(1 - 0.3 * load, 1, 1.2);
  const legLoad = legSum / W, legCad = clamp(1 - RESK.legCadPerLoad * legLoad, 0.5, 1);   // leg drag: the legs swing slower (even with keep speed)
  const cadK = (body.keepSpeed ? 1 / stepK : load >= 0 ? clamp(1 - RESK.cadDropPerLoad * load, 0.6, 1) : 1) * legCad;
  const upperFrac = all > 1e-6 ? upper / all : 0.5;
  return { legLoad, legKnee: clamp(1 - RESK.legKneePerLoad * legLoad, 0.4, 1), back, side, up: lift, load, lean, sideLean, stepK, cadK, armK: 1 + RESK.armPerLoad * Math.max(0, load), heightCm: RESK.vertCmPerG * (lift / W), widthCm: RESK.widthCmPerDeg * Math.abs(sideLean),
    hipShare: 0.5 - 0.25 * upperFrac, headRx: RESK.headDegPerN * headZ };
}
function resistLeanParts(t) { const R = resistAt(t); return { spine: R.lean * (1 - R.hipShare), hip: R.lean * R.hipShare, side: R.sideLean, heightCm: R.heightCm, headRx: R.headRx }; }

// ---------------------------------------------------------------- the speakers in the viewport
const resViz = new Map();   // forcer id → its meshes
function forcerVizBuild(f) {
  const g = new THREE.Group();
  const cabMat = new THREE.MeshStandardMaterial({ color: '#4a4f58', roughness: 0.55, metalness: 0.15, emissive: '#15171b' });
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.46, 0.26), cabMat); cab.position.z = -0.13; g.add(cab);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.03, 0.27), new THREE.MeshBasicMaterial({ color: f.color })); trim.position.set(0, 0.245, -0.13); g.add(trim);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.012, 10, 40), new THREE.MeshStandardMaterial({ color: '#8a8f99', metalness: 0.6, roughness: 0.3 })); rim.position.set(0, -0.06, 0.004); g.add(rim);
  const woofer = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.045, 0.05, 32, 1, true), new THREE.MeshStandardMaterial({ color: '#0f1013', side: THREE.DoubleSide, roughness: 0.9 }));
  woofer.rotation.x = Math.PI / 2; woofer.position.set(0, -0.06, -0.02); g.add(woofer);
  const tw = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 10), new THREE.MeshStandardMaterial({ color: '#9aa0aa', metalness: 0.7, roughness: 0.25 })); tw.position.set(0, 0.14, 0); tw.scale.z = 0.5; g.add(tw);
  // the cone as nested shells (full, ¾, ½, ¼ of the spread): brightest on the centre line, fading to the edge
  const cones = [1, 0.75, 0.5, 0.25].map((u) => { const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false })); m.userData.u = u; g.add(m); return m; }), cone = cones[0];
  const edge = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5 })); g.add(edge);
  const waves = []; for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.01, 6, 48), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6, depthWrite: false })); g.add(m); waves.push(m); }
  const arrows = new THREE.Group(); scene.add(arrows); scene.add(g);
  const v = { g, cabMat, trim, cone, cones, edge, waves, arrows, pool: [], key: '' };
  resViz.set(f.id, v); return v;
}
function forcerVizCone(v, half, L) {
  const key = `${half.toFixed(3)}|${L.toFixed(2)}`; if (v.key === key) return; v.key = key;
  const R = L * Math.tan(Math.min(half, 1.45));
  for (const c of v.cones) { const r = L * Math.tan(Math.min(half * c.userData.u, 1.45)), geo = new THREE.ConeGeometry(Math.max(0.005, r), L, 40, 1, true); geo.translate(0, -L / 2, 0); geo.rotateX(-Math.PI / 2); c.geometry.dispose(); c.geometry = geo; }
  const pts = []; for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; pts.push(0, 0, 0, Math.cos(a) * R, Math.sin(a) * R, L); }
  const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); v.edge.geometry.dispose(); v.edge.geometry = eg;
}
function forcerWorldPose(f, t) {   // → { pos, dirW, D }: where it is drawn now
  const B = resParts(), D = forcerDevice(f, t);
  return { pos: runRoot(t).add(V3(D.pos.x * B.rs, D.pos.y, D.pos.z)), dirW: V3(D.dir.x * B.rs, D.dir.y, D.dir.z).normalize(), D };
}
function updateResistViz() {
  const list = A && A.forcers ? A.forcers : [];
  for (const [id, v] of resViz) if (!list.some((f) => f.id === id)) { scene.remove(v.g); scene.remove(v.arrows); resViz.delete(id); }
  if (!rig) return;
  const now = performance.now() / 1000;
  for (const f of list) {
    const v = resViz.get(f.id) || forcerVizBuild(f);
    const on = !f.bypass && f.show !== false && S.showResist !== false && seqShowsSel();   // a sequence: only while its own motion is under the playhead
    v.g.visible = v.arrows.visible = on; if (!on) continue;
    const { pos, dirW, D } = forcerWorldPose(f, S.t);
    v.g.position.copy(pos); v.g.lookAt(pos.clone().add(dirW));
    const L = clamp(D.pos.length() + 0.35, 0.8, 2.5); forcerVizCone(v, D.half, L);
    const push = D.F >= 0, col = push ? f.color : '#4aa3ff', mag = Math.min(1, Math.abs(D.F * D.weight) / 300), sel = S.selForcer === f.id;
    for (const c of v.cones) { c.material.color.set(col); c.material.opacity = 0.015 + 0.045 * mag; } v.edge.material.color.set(col); v.trim.material.color.set(f.color);
    v.cabMat.emissive.set(sel ? '#ff4fa3' : '#15171b');
    const speed = 0.35 + 0.9 * mag;
    v.waves.forEach((m, i) => {
      let ph = (now * speed + i / v.waves.length) % 1; if (!push) ph = 1 - ph;
      const z = ph * L, rad = Math.max(0.02, z * Math.tan(Math.min(D.half, 1.45)));
      m.position.set(0, 0, z); m.scale.set(rad, rad, 1); m.material.color.set(col); m.material.opacity = (Math.abs(D.F) > 0.5 ? 0.15 + 0.55 * mag : 0.08) * (1 - ph * 0.7);
    });
    // arrows: the body parts it reaches (whole body) and the controllers it moves
    const items = [], rs = resParts().rs;
    if (f.target.whole && forcerLive(f)) for (const q of forcerPartForces(f, S.t).parts) { const m = q.f.length(); if (m >= 2) items.push([worldP(q.bone), V3(q.f.x * rs, q.f.y, q.f.z), clamp(m / 120, 0.1, 0.7)]); }
    if (forcerLive(f)) for (const id of f.target.ik) { const mv = forcerIKPush(f, id, S.t), wp = effPosOf(id); if (wp && mv.length() > 1e-3) items.push([wp, mv, clamp(mv.length() * 2, 0.12, 0.8)]); }
    while (v.pool.length < items.length) { const a = new THREE.ArrowHelper(V3(0, 0, 1), V3(), 0.3, col, 0.08, 0.05); v.arrows.add(a); v.pool.push(a); }
    v.pool.forEach((a, i) => { const it = items[i]; if (!it) { a.visible = false; return; } a.visible = true; a.position.copy(it[0]); a.setDirection(it[1].normalize()); a.setLength(it[2], 0.07, 0.045); a.setColor(col); });
  }
}
function pickForcer(cx, cy) {   // a forcer's speaker near the pointer → its id
  if (!A || !A.forcers || !rig) return null;
  const b = renderer.domElement.getBoundingClientRect();
  {   // a hit on the speaker itself (cabinet, woofer, trim) wins
    const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(((cx - b.left) / b.width) * 2 - 1, -((cy - b.top) / b.height) * 2 + 1), camera);
    let hit = null, hd = Infinity;
    for (const f of A.forcers) { const v = resViz.get(f.id); if (!v || !v.g.visible) continue; const meshes = v.g.children.filter((m) => m.isMesh && !v.cones.includes(m) && !v.waves.includes(m)); const x = rc.intersectObjects(meshes, false)[0]; if (x && x.distance < hd) { hd = x.distance; hit = f.id; } }
    if (hit) return hit;
  }
  let best = null, bd = 28;
  for (const f of A.forcers) { const v = resViz.get(f.id); if (!v || !v.g.visible) continue; const q = v.g.position.clone().project(camera); if (q.z > 1) continue; const d = Math.hypot((q.x + 1) / 2 * b.width + b.left - cx, (1 - q.y) / 2 * b.height + b.top - cy); if (d < bd) { bd = d; best = f.id; } }
  return best;
}
function selectForcer(id) { S.selForcer = id; S.selected = null; S.selEff = null; S.selGroup = null; afterSelect(); if (!gizmoMode) setGizmoMode('move'); }   // a forcer is picked to be moved: its gizmo comes up
// gizmo: a world position / facing → the forcer's track values at the playhead
function forcerValsFromWorld(f, posW, dirW) {
  const B = resParts(), root = runRoot(S.t), o = { ...forcerVals(f, S.t) };
  if (posW) {
    const rel = posW.clone().sub(root);
    if (f.mode === 'fixed') { const rp = runnerPath(S.t); o.px = (rel.x + rp.x) * B.rs; o.pz = rel.z + rp.z; } else { o.px = rel.x * B.rs; o.pz = rel.z; }
    o.py = rel.y;
  }
  if (dirW) { const d = V3(dirW.x * B.rs, dirW.y, dirW.z).normalize(); o.fx = -Math.asin(clamp(d.y, -1, 1)) / DEG; o.fy = Math.atan2(d.x, d.z) / DEG; }
  o.py = Math.max(0, o.py); for (const k of ['fx', 'fy']) o[k] = clamp(o[k], -180, 180);
  return o;
}
function keyForcer(p) {   // a gizmo move / turn: the forcer's position / facing (not keys: they are not automated)
  const f = A.forcers.find((x) => x.id === p.id); if (!f) return;
  pushUndo();
  for (const k of [...POS_KEYS, ...FACE_KEYS]) f.at[k] = +p.vals[k].toFixed(4);
  forcerChanged();
}

// ---------------------------------------------------------------- the timeline blocks
function drawForcerBlock(id) {
  const f = A.forcers.find((x) => x.id === id); if (!f) return;
  const hr = mkRow('bone sym resb' + (S.selForcer === id ? ' selected' : '')); Object.assign(hr, { kind: 'forcer', forcer: id });
  hr.h.innerHTML = `<button type="button" class="mini" data-act="fold" aria-expanded="${!f.collapsed}">${f.collapsed ? '▸' : '▾'}</button><span class="symtag" style="background:${f.color};color:#111">${f.mode === 'fixed' ? 'FIXED' : 'MOVING'}</span><span class="name"></span><button type="button" class="mini" data-act="set" title="Name, target, falloff, body settings">⚙</button>${seqActive() && SEQ.motions.length > 1 ? '<button type="button" class="mini" data-act="copy" title="Copy this forcer to other motions">⧉</button>' : ''}<button type="button" class="mini" data-act="del" title="Remove">×</button>`;
  hr.h.querySelector('.name').textContent = f.name;
  hr.h.querySelector('.name').onclick = () => selectForcer(id);
  hr.h.querySelector('[data-act="fold"]').onclick = () => { f.collapsed = !f.collapsed; rebuildRows(); save(); };
  hr.h.querySelector('[data-act="set"]').onclick = () => openForcerDlg(id);
  hr.h.querySelector('[data-act="del"]').onclick = () => confirmDelete(`Remove ${f.name} and its tracks?`, () => { pushUndo(); removeForcerNow(id); });
  addBypass(hr, f, null);
  const cp = hr.h.querySelector('[data-act="copy"]'); if (cp) cp.onclick = (ev) => { const r = ev.currentTarget.getBoundingClientRect(); openMenu(r.left, r.bottom + 4, seqCopyForcerMenu(id)); };
  hr.h.oncontextmenu = (ev) => { ev.preventDefault(); if (rightDouble('frc' + id)) hr.h.querySelector('[data-act="del"]').click(); else if (seqActive() && SEQ.motions.length > 1) openMenu(ev.clientX, ev.clientY, seqCopyForcerMenu(id)); };
  hr.lane.innerHTML = '<div class="summary"></div>'; hr.resSum = hr.lane.firstChild; forcerSummary(hr);
  tracksEl.append(hr.el); rows.push(hr);
  if (f.collapsed) return;
  const lab = RES_LABEL(f.mode);
  for (const k of RES_KEYS) addTrackRow(`f|${id}|${k}`, RES_SPEC[k], () => f[k], (p) => { f[k] = p; }, lab[k], { type: 'forcer', id, k });
}
function forcerSummary(hr) {
  const f = hr && A.forcers && A.forcers.find((x) => x.id === hr.forcer); if (!f || !hr.resSum) return;
  const hits = forcerLive(f) && f.target.whole ? forcerPartForces(f, S.t).parts.filter((q) => q.f.length() >= 2).map((q) => q.id) : [];
  const R = resistAt(S.t), tgt = [f.target.whole ? 'whole body' : null, ...f.target.ik.map((id) => EFF_BY_ID[id].label)].filter(Boolean).join(' + ') || 'nothing';
  hr.resSum.textContent = `${f.name} → ${tgt}${hits.length ? ' · reaches ' + hits.join(', ') : ''} · all forcers at the playhead: load ${Math.round(R.load * 100)} %, leg drag ${Math.round(R.legLoad * 100)} %, lean ${sgn(R.lean, 1, '°')}, side ${sgn(R.sideLean, 1, '°')}, step ${Math.round(R.stepK * 100)} %, cadence ${Math.round(R.cadK * 100)} %`;
}
function addForcer(mode) {
  pushUndo(); normalizeForcers(A);
  const f = newForcer(mode, S.dur, A.forcers.length + 1);
  A.forcers.push(f); addRowKey('frc:' + f.id);
  editVersion++; rebuildRows(); save(); selectForcer(f.id);
  toast(`${f.name} (${mode}) added: ${mode === 'fixed' ? '10 m down the track, 1.2 m high, facing back toward the start' : '1 m in front, 1.2 m high, facing the runner'}. Set its Force to push (+) or pull (−).`);
}
function removeForcerNow(id) {
  A.forcers = A.forcers.filter((f) => f.id !== id); if (A.rowOrder) A.rowOrder = A.rowOrder.filter((k) => k !== 'frc:' + id);
  if (S.selForcer === id) S.selForcer = null;
  forcerChanged();
}
function forcerChanged() { moveEndCache = null; editVersion++; trailDirty = true; holdCache.clear(); pinPointsToBar(); lockCycles(true); syncLenInputs(); rebuildRows(); save(); }
// per forcer settings (+ the body settings shared by all)
let dlgForcer = null;
function openForcerDlg(id) {
  const f = A.forcers.find((x) => x.id === id); if (!f) return; dlgForcer = id;
  for (const k of [...POS_KEYS, ...FACE_KEYS]) $('frc_' + k).value = +f.at[k].toFixed(k[0] === 'p' ? 2 : 1);
  $('frcName').value = f.name; $('frcFall').value = f.falloff; $('frcShow').checked = f.show !== false;
  $('frcWhole').checked = !!f.target.whole; $('frcStiff').value = f.target.stiff; $('frcMax').value = f.target.maxMove; $('frcCone').checked = !!f.target.useCone; $('frcReact').checked = !!f.target.bodyReacts;
  drawFrcBones(f);
  $('frcFlex').value = f.target.boneFlex;
  const box = $('frcIK'); box.textContent = '';
  for (const d of forcerIKList()) { const l = document.createElement('label'); l.className = 'cb'; l.innerHTML = `<input type="checkbox" value="${d.id}"${f.target.ik.includes(d.id) ? ' checked' : ''}> ${d.label}`; box.append(l); }
  $('resMass').value = (A.body || {}).mass || 75; $('resKeep').checked = (A.body || {}).keepSpeed !== false;
  $('frcDlg').hidden = false;
}
function frcApply() {
  const f = A.forcers.find((x) => x.id === dlgForcer); if (!f) return;
  pushUndo();
  for (const k of [...POS_KEYS, ...FACE_KEYS]) { const v = parseFloat($('frc_' + k).value); if (isFinite(v)) f.at[k] = k[0] === 'p' ? clamp(v, k === 'py' ? 0 : -200, 200) : clamp(v, -180, 180); }
  f.name = $('frcName').value.trim() || f.name; f.falloff = $('frcFall').value; f.show = $('frcShow').checked;
  f.target.whole = $('frcWhole').checked; f.target.stiff = clamp(+$('frcStiff').value || 10, 0, 100); f.target.maxMove = clamp(+$('frcMax').value || 40, 0, 150);
  f.target.useCone = $('frcCone').checked; f.target.bodyReacts = $('frcReact').checked;
  f.target.ik = [...$('frcIK').querySelectorAll('input:checked')].map((x) => x.value);
  f.target.boneFlex = clamp(isFinite(+$('frcFlex').value) ? +$('frcFlex').value : 100, 0, 300);
  A.body = { mass: clamp(+$('resMass').value || 75, 20, 200), keepSpeed: $('resKeep').checked };
  forcerChanged();
}
for (const id of ['frc_px', 'frc_py', 'frc_pz', 'frc_fx', 'frc_fy', 'frc_fz', 'frcName', 'frcFall', 'frcShow', 'frcWhole', 'frcStiff', 'frcMax', 'frcCone', 'frcReact', 'resMass', 'resKeep', 'frcFlex']) $(id).onchange = frcApply;
$('frcIK').addEventListener('change', frcApply);
// bones it bends: added one by one, each with its weight (% of the bend the push gives it)
function drawFrcBones(f) {
  const bx = $('frcBones'); bx.textContent = '';
  const keys = Object.keys(f.target.bw || {}).sort((a, b) => FBONES.findIndex((x) => x[0] === a) - FBONES.findIndex((x) => x[0] === b));
  if (!keys.length) { const e = document.createElement('div'); e.className = 'note'; e.textContent = 'No bones yet: the push only leans and slows the body. Add the bones it should bend.'; bx.append(e); }
  for (const k of keys) {
    const row = document.createElement('div'); row.className = 'fbrow';
    row.innerHTML = `<span>${FBONE_BY[k][1]}</span><input type="number" min="0" max="200" step="5" value="${Math.round(f.target.bw[k])}" aria-label="${FBONE_BY[k][1]} weight"><span class="unitlbl">%</span><button type="button" class="mini" title="Remove">×</button>`;
    row.querySelector('input').onchange = (e) => { pushUndo(); f.target.bw[k] = clamp(+e.target.value || 0, 0, 200); forcerChanged(); };
    row.querySelector('button').onclick = () => { pushUndo(); delete f.target.bw[k]; forcerChanged(); drawFrcBones(f); };
    bx.append(row);
  }
  const add = document.createElement('div'); add.className = 'fbrow';
  const left = FBONES.filter(([k]) => !(k in (f.target.bw || {})));
  add.innerHTML = `<select aria-label="Bone to add">${left.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><input type="number" min="0" max="200" step="5" value="100" aria-label="Weight"><span class="unitlbl">%</span><button type="button" class="mini"${left.length ? '' : ' disabled'}>+ Add bone</button>`;
  add.querySelector('button').onclick = () => { const k = add.querySelector('select').value; if (!k) return; pushUndo(); f.target.bw = f.target.bw || {}; f.target.bw[k] = clamp(+add.querySelector('input').value || 0, 0, 200); forcerChanged(); drawFrcBones(f); };
  bx.append(add);
}
$('frcClose').onclick = () => { $('frcDlg').hidden = true; };
$('frcDlg').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('frcDlg').hidden = true; });
