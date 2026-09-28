import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
// ============================================================================
//  RIG + ANATOMICAL FULL-BODY IK
//  Everything is solved in world space. Each bone's pose is written as a
//  world-space "delta" from its bind (T-pose) orientation:  Q = Δ · Q_bind.
//  That keeps the solver independent of how the DCC oriented the bone axes.
// ============================================================================
const DEG = Math.PI / 180;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const sstep = (a, b, x) => smooth(clamp((x - a) / (b - a), 0, 1));
const mod1 = (x) => x - Math.floor(x);
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const AX = V3(1, 0, 0), AY = V3(0, 1, 0), AZ = V3(0, 0, 1);
const qAxis = (axis, ang, out = new THREE.Quaternion()) => out.setFromAxisAngle(axis, ang);
const qEuler = (pitch, yaw, roll, out = new THREE.Quaternion()) => out.setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));

const _m4 = new THREE.Matrix4();
const _pd = V3(), _sd = V3(), _qd = new THREE.Quaternion();

function basisQ(a, b, out) {
  const x = a.clone().normalize();
  const y = b.clone().addScaledVector(x, -b.dot(x)).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  _m4.makeBasis(x, y, z);
  return out.setFromRotationMatrix(_m4);
}
function perpNorm(v, axis, out) {
  out.copy(v).addScaledVector(axis, -v.dot(axis));
  const l = out.length();
  if (l < 1e-6) return null;
  return out.divideScalar(l);
}
// slerp the long way round (the rotation that THREE's shortest-path slerp would not take)
function slerpLong(a, b, t) {
  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  if (a.x * bx + a.y * by + a.z * bz + a.w * bw > 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
  const c = clamp(a.x * bx + a.y * by + a.z * bz + a.w * bw, -1, 1), th = Math.acos(c), sn = Math.sin(th);
  if (sn < 1e-5) return a.clone();
  const k0 = Math.sin((1 - t) * th) / sn, k1 = Math.sin(t * th) / sn;
  return new THREE.Quaternion(a.x * k0 + bx * k1, a.y * k0 + by * k1, a.z * k0 + bz * k1, a.w * k0 + bw * k1).normalize();
}
// closest distance between segments p1q1 and p2q2
function segDist(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r), c = d1.dot(r), b = d1.dot(d2), den = a * e - b * b;
  let s = den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0, t = (b * s + f) / e;
  if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
  return p1.clone().addScaledVector(d1, s).distanceTo(p2.clone().addScaledVector(d2, t));
}
function worldQ(o, out = new THREE.Quaternion()) { o.matrixWorld.decompose(_pd, out, _sd); return out; }
function worldP(o, out = V3()) { return out.setFromMatrixPosition(o.matrixWorld); }

// ---------------------------------------------------------------- bone naming
// Mixamo / Character Creator (Mixamo profile) names first, CC_Base names as a fallback.
const NAME_MAP = {
  hips: ['Hips', 'CC_Base_Hip', 'pelvis'],
  spine: ['Spine', 'CC_Base_Waist', 'spine_01'],
  spine1: ['Spine1', 'CC_Base_Spine01', 'spine_02'],
  spine2: ['Spine2', 'CC_Base_Spine02', 'spine_03'],
  neck: ['Neck', 'CC_Base_NeckTwist01', 'neck_01'],
  head: ['Head', 'CC_Base_Head', 'head'],
  clav: ['{S}Shoulder', 'CC_Base_{s}_Clavicle', 'clavicle_{l}'],
  upper: ['{S}Arm', 'CC_Base_{s}_Upperarm', 'upperarm_{l}'],
  fore: ['{S}ForeArm', 'CC_Base_{s}_Forearm', 'lowerarm_{l}'],
  hand: ['{S}Hand', 'CC_Base_{s}_Hand', 'hand_{l}'],
  thigh: ['{S}UpLeg', 'CC_Base_{s}_Thigh', 'thigh_{l}'],
  shin: ['{S}Leg', 'CC_Base_{s}_Calf', 'calf_{l}'],
  foot: ['{S}Foot', 'CC_Base_{s}_Foot', 'foot_{l}'],
  toe: ['{S}ToeBase', 'CC_Base_{s}_ToeBase', 'ball_{l}'],
};
const normName = (n) => n.toLowerCase().replace(/^mixamorig\d*[:_]?/, '').replace(/[^a-z0-9]/g, '');

class Rig {
  constructor(root) {
    this.root = root;
    root.updateMatrixWorld(true);
    const byName = {};
    this.bones = [];
    root.traverse((o) => { if (o.isBone) { this.bones.push(o); byName[normName(o.name)] = o; } });
    const find = (key, side) => {
      for (let pat of NAME_MAP[key]) {
        if (side) pat = pat.replace('{S}', side === 'L' ? 'Left' : 'Right').replace('{s}', side).replace('{l}', side.toLowerCase());
        const b = byName[normName(pat)];
        if (b) return b;
      }
      throw new Error('Rig is missing a bone for "' + key + (side ? ' ' + side : '') + '"');
    };
    this.b = {};
    for (const k of ['hips', 'spine', 'spine1', 'spine2', 'neck', 'head']) this.b[k] = find(k);
    this.meshes = [];
    root.traverse((o) => { if (o.isSkinnedMesh) this.meshes.push(o); });

    // bind snapshot
    this.bind = new Map();
    for (const b of this.bones) this.bind.set(b, { q: worldQ(b), p: worldP(b), lq: b.quaternion.clone(), lp: b.position.clone() });

    this.side = {};
    for (const S of ['L', 'R']) {
      const s = S === 'L' ? 1 : -1;
      const sd = { s, S };
      for (const k of ['clav', 'upper', 'fore', 'hand', 'thigh', 'shin', 'foot', 'toe']) sd[k] = find(k, S);
      sd.leg = this.makeLimb(sd.thigh, sd.shin, sd.foot, V3(0, 0, -1), 150 * DEG);
      sd.arm = this.makeLimb(sd.upper, sd.fore, sd.hand, V3(0, 0, 1), 148 * DEG);
      sd.fingers = this.collectFingers(sd.hand, s);
      this.side[S] = sd;
    }
    this.analyzeFeet();
    const hp = this.bp(this.b.hips);
    this.hipsH = hp.y - this.soleY;                 // straight-leg standing height of the hips bone
    this.hipOffset = { L: this.bp(this.side.L.thigh).sub(hp), R: this.bp(this.side.R.thigh).sub(hp) };
    this.legLen = this.side.L.leg.l1 + this.side.L.leg.l2;
    this.armLen = this.side.L.arm.l1 + this.side.L.arm.l2;
    this.height = this.bp(this.b.head).y - this.soleY + 0.12;
  }
  bp(b) { return this.bind.get(b).p.clone(); }
  bq(b) { return this.bind.get(b).q; }
  delta(b, out = new THREE.Quaternion()) { return worldQ(b, out).multiply(_qd.copy(this.bq(b)).invert()); }
  resetToBind() {
    for (const b of this.bones) { const d = this.bind.get(b); b.quaternion.copy(d.lq); b.position.copy(d.lp); }
    this.root.updateMatrixWorld(true);
  }
  // Set world rotation as Δ · Q_bind, then refresh that subtree.
  setDelta(bone, d) {
    const qw = _qA.copy(d).multiply(this.bq(bone));
    worldQ(bone.parent, _qB);
    bone.quaternion.copy(_qB.invert().multiply(qw));
    bone.updateMatrixWorld(true);
  }
  setHipsWorld(p) {
    const lp = _vA.copy(p);
    this.b.hips.parent.worldToLocal(lp);
    this.b.hips.position.copy(lp);
  }
  makeLimb(upper, lower, end, bendHint, maxFlex) {
    const P1 = this.bp(upper), P2 = this.bp(lower), P3 = this.bp(end);
    const aB1 = P2.clone().sub(P1), aB2 = P3.clone().sub(P2);
    const l1 = aB1.length(), l2 = aB2.length();
    aB1.normalize(); aB2.normalize();
    const bB = perpNorm(bendHint, aB1, V3());
    const hB = V3().crossVectors(aB1, bB);
    return {
      upper, lower, end, l1, l2, maxFlex,
      B1inv: basisQ(aB1, bB, new THREE.Quaternion()).invert(),
      B2inv: basisQ(aB2, hB, new THREE.Quaternion()).invert(),
      d1: new THREE.Quaternion(), d2: new THREE.Quaternion(), mid: V3(), endP: V3(), flex: 0, hit: false,
    };
  }
  collectFingers(hand, s) {
    const out = [];
    const down = V3(0, -1, 0);
    for (const c of hand.children) {
      if (!c.isBone) continue;
      const thumb = /thumb/i.test(c.name);
      let b = c, depth = 0;
      while (b && b.isBone && depth < 3) {
        const child = b.children.find((x) => x.isBone);
        if (!child) break;
        const dir = this.bp(child).sub(this.bp(b)).normalize();
        const axW = V3().crossVectors(dir, down).normalize();         // rotates the digit toward the palm
        const axL = axW.clone().applyQuaternion(this.bq(b).clone().invert());
        out.push({ bone: b, axis: axL, lq: this.bind.get(b).lq.clone(), w: thumb ? [0.45, 0.35, 0.3][depth] : [0.8, 1.0, 0.7][depth], thumb });
        b = child; depth++;
      }
    }
    return out;
  }
  analyzeFeet() {
    // Sole height, heel, ball and toe-tip from the skinned mesh itself.
    const v = V3();
    this.foot = {};
    let soleY = Infinity;
    const acc = { L: { heelZ: Infinity, tipZ: -Infinity }, R: { heelZ: Infinity, tipZ: -Infinity } };
    for (const mesh of this.meshes) {
      const g = mesh.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
      if (!si) continue;
      const bones = mesh.skeleton.bones;
      for (let i = 0; i < pos.count; i++) {
        let best = 0, bi = -1;
        for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > best) { best = w; bi = si.getComponent(i, k); } }
        const bone = bones[bi];
        for (const S of ['L', 'R']) {
          const sd = this.side[S];
          if (bone !== sd.foot && bone !== sd.toe) continue;
          mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);   // skinned (bind pose) → world
          soleY = Math.min(soleY, v.y);
          if (bone === sd.foot && v.y < this.bp(sd.foot).y) acc[S].heelZ = Math.min(acc[S].heelZ, v.z);
          if (bone === sd.toe) acc[S].tipZ = Math.max(acc[S].tipZ, v.z);
        }
      }
    }
    if (!isFinite(soleY)) soleY = Math.min(this.bp(this.side.L.toe).y - 0.03, 0);
    this.soleY = soleY;
    for (const S of ['L', 'R']) {
      const sd = this.side[S];
      const ank = this.bp(sd.foot), toe = this.bp(sd.toe);
      const heelZ = isFinite(acc[S].heelZ) ? acc[S].heelZ + 0.012 : ank.z - 0.06;
      const tipZ = isFinite(acc[S].tipZ) ? acc[S].tipZ - 0.01 : toe.z + 0.08;
      this.foot[S] = {
        ankleH: ank.y - soleY,
        heel: V3(ank.x, soleY, heelZ).sub(ank),      // relative to ankle, bind (flat) frame
        ball: V3(toe.x, soleY, toe.z).sub(ank),
        tip: V3(toe.x, soleY, tipZ).sub(toe),         // relative to toe joint
        toeRel: toe.clone().sub(ank),
        len: tipZ - heelZ,
        midZ: (tipZ + heelZ) / 2 - ank.z,
      };
    }
  }
  // Lowest world points of a posed foot (used when analyzing clips)
  footPoints(S, ankW, dFoot, toeW, dToe) {
    const f = this.foot[S];
    return {
      heel: f.heel.clone().applyQuaternion(dFoot).add(ankW),
      ball: f.ball.clone().applyQuaternion(dFoot).add(ankW),
      tip: f.tip.clone().applyQuaternion(dToe).add(toeW),
    };
  }
}
const _qA = new THREE.Quaternion(), _qB = new THREE.Quaternion(), _vA = V3();

// ---------------------------------------------------------------- joint limits
// Degrees. Spine split lumbar / lower thoracic / upper thoracic: the lumbar
// spine flexes but barely rotates; axial rotation lives in the thoracic spine.
const SPINE_SEG = [
  { wy: 0.12, wp: 0.45, wr: 0.36, yaw: 6, flex: 28, ext: 18, lat: 14 },
  { wy: 0.40, wp: 0.33, wr: 0.34, yaw: 16, flex: 22, ext: 12, lat: 12 },
  { wy: 0.48, wp: 0.22, wr: 0.30, yaw: 20, flex: 16, ext: 10, lat: 10 },
];
const NECK_SEG = [
  { wy: 0.42, wp: 0.5, wr: 0.55, yaw: 35, flex: 32, ext: 30, lat: 25 },
  { wy: 0.58, wp: 0.5, wr: 0.45, yaw: 45, flex: 25, ext: 25, lat: 12 },
];
const LIMITS = {
  hipFlex: 125, hipExt: 30, hipAbd: 45, hipAdd: 25,
  ankleDorsi: 32, anklePlantar: 55, ankleInv: 30, ankleEv: 20, ankleYaw: 22,
  toeExt: 62, toeFlex: 25,
  shoulderExt: 62,
};

class BodyIK {
  constructor(rig) {
    this.rig = rig;
    this.diag = { hits: 0, hitLog: [], kneeL: 0, kneeR: 0, elbowL: 0, elbowR: 0, pelvisDrop: 0, chestQ: new THREE.Quaternion() };
    this.debug = { targets: [], poles: [], reach: null };
    this.v = Array.from({ length: 12 }, () => V3());
    this.dropS = 0;
    this.armAng = {};
  }
  // distribute a relative rotation over a chain of segments with per-segment ROM
  distribute(Rrel, segs, flexSign = 1) {
    const e = new THREE.Euler().setFromQuaternion(Rrel, 'YXZ');
    const out = [];
    let clipped = false;
    for (const g of segs) {
      let y = e.y * g.wy, p = e.x * g.wp * flexSign, r = e.z * g.wr;
      const y2 = clamp(y, -g.yaw * DEG, g.yaw * DEG), p2 = clamp(p, -g.ext * DEG, g.flex * DEG), r2 = clamp(r, -g.lat * DEG, g.lat * DEG);
      if (y2 !== y || p2 !== p || r2 !== r) clipped = true;
      out.push(qEuler(p2 * flexSign, y2, r2));
    }
    return { rots: out, clipped };
  }
  hit(name) { this.diag.hits++; this.diag.hitLog.push(name); }
  // point the hand: fingers along F, palm facing N (world). The forearm takes 60% of the twist, the wrist the rest.
  orientHand(S, F, N, w) {
    const rig = this.rig, sd = rig.side[S], s = sd.s;
    if (!this.handBind) { this.handBind = {}; this.handN0 = {}; }
    if (!this.handBind[S]) {
      const fm = sd.fingers.find((f) => /middle1/i.test(f.bone.name)) || sd.fingers[0], th = sd.fingers.find((f) => /thumb1/i.test(f.bone.name)) || sd.fingers[0];
      const F0 = rig.bp(fm.bone).sub(rig.bp(sd.hand)).normalize(), T0 = rig.bp(th.bone).sub(rig.bp(sd.hand)).normalize();
      const N0 = V3().crossVectors(F0, T0).normalize().multiplyScalar(s);
      const N0o = N0.clone().addScaledVector(F0, -N0.dot(F0)).normalize();
      this.handBind[S] = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(F0, N0o, V3().crossVectors(F0, N0o).normalize())).invert();
      this.handN0[S] = N0o;                                 // palm normal of the bind hand (world, bind pose)
    }
    // wrist range: the fingers can point at most 75° away from the forearm line (a hand never folds back on itself)
    const fa = worldP(sd.hand).sub(worldP(sd.fore)).normalize();
    let f = F.clone().normalize();
    const fAng = Math.acos(clamp(fa.dot(f), -1, 1)), lim = 75 * DEG;
    if (fAng > lim) {
      let ax = V3().crossVectors(fa, f); if (ax.lengthSq() < 1e-8) ax = V3().crossVectors(fa, Math.abs(fa.y) < 0.9 ? AY : AX);
      f = fa.clone().applyAxisAngle(ax.normalize(), lim);
    }
    let n = N.clone().addScaledVector(f, -N.dot(f)); if (n.lengthSq() < 1e-6) n = V3().crossVectors(f, AY); n.normalize();
    const Rq = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(f, n, V3().crossVectors(f, n).normalize())).multiply(this.handBind[S]);
    // forearm roll (pronation / supination): from the forearm's own neutral palm direction to the wanted palm
    // direction, measured around the forearm, kept continuous frame to frame, 60% of it (≤ 100°) in the forearm
    const nN = this.handN0[S].clone().applyQuaternion(rig.delta(sd.fore));
    const pa = nN.addScaledVector(fa, -nN.dot(fa)), pb = n.clone().addScaledVector(fa, -n.dot(fa));
    let th = Math.atan2(V3().crossVectors(pa, pb).dot(fa), pa.dot(pb));
    this.twPrev = this.twPrev || {};
    const prev = this.twPrev[S];
    if (prev != null) th = prev + wrapPi(th - prev);
    this.twPrev[S] = th;
    rig.setDelta(sd.fore, qAxis(fa, 0.6 * clamp(th, -100 * DEG, 100 * DEG) * w).multiply(rig.delta(sd.fore)));
    // hand: from where it now is toward the target, along whichever way round stays closest to last frame's hand
    const cur = rig.delta(sd.hand);
    let tgt = cur.clone().slerp(Rq, w);
    this.handPrev = this.handPrev || {};
    const hp = this.handPrev[S];
    if (hp && w < 0.999) {
      const alt = slerpLong(cur, Rq, w);
      if (Math.abs(alt.dot(hp)) > Math.abs(tgt.dot(hp)) + 1e-4) tgt = alt;
    }
    this.handPrev[S] = tgt.clone();
    rig.setDelta(sd.hand, tgt);
  }

  // T = targets from the locomotion layer (see Locomotion.buildTargets)
  solve(T) {
    const rig = this.rig, b = rig.b, D = this.diag;
    D.hits = 0; D.hitLog.length = 0;
    const [v0, v1, v2, v3, v4, v5] = this.v;

    // ---- 1. Pelvis: lower it just enough that both ankles are reachable
    const pelvisPos = T.pelvisPos.clone();
    let drop = 0;
    for (const S of ['L', 'R']) {
      const leg = rig.side[S].leg, L = leg.l1 + leg.l2;
      const reach = L * 0.985;
      const hip = v0.copy(rig.hipOffset[S]).applyQuaternion(T.pelvisQ).add(pelvisPos);
      const h = v1.copy(hip).sub(T.legs[S].ankle);
      const horiz2 = h.x * h.x + h.z * h.z;
      if (h.lengthSq() > reach * reach && horiz2 < reach * reach) drop = Math.max(drop, h.y - Math.sqrt(reach * reach - horiz2));
    }
    drop = clamp(drop, 0, 0.22);
    // smooth the dip so it never pops (soft IK absorbs the few mm while it catches up)
    if (T.dt) { const tau = drop > this.dropS ? 0.035 : 0.12; this.dropS += (drop - this.dropS) * (1 - Math.exp(-T.dt / tau)); drop = this.dropS; }
    pelvisPos.y -= drop;
    D.pelvisDrop = drop;
    rig.setHipsWorld(pelvisPos);
    rig.setDelta(b.hips, T.pelvisQ);

    // ---- 2. Spine: distribute pelvis→chest rotation with segment ROM
    let chestTarget = T.chestQ.clone();
    if (T.reach && T.reach.w > 0.001) chestTarget = this.reachAssist(T, chestTarget);
    const Rs = _qA.copy(T.pelvisQ).invert().multiply(chestTarget);
    const sp = this.distribute(Rs, SPINE_SEG);
    if (sp.clipped) this.hit('spine');
    let acc = T.pelvisQ.clone();
    for (const [i, bone] of [b.spine, b.spine1, b.spine2].entries()) { acc.multiply(sp.rots[i]); rig.setDelta(bone, acc); }
    const chestQ = D.chestQ.copy(acc);

    // ---- 3. Neck + head (look target), cervical ROM
    const Rn = _qA.copy(chestQ).invert().multiply(T.headQ);
    const nk = this.distribute(Rn, NECK_SEG);
    let accN = chestQ.clone();
    accN.multiply(nk.rots[0]); rig.setDelta(b.neck, accN);
    accN.multiply(nk.rots[1]); rig.setDelta(b.head, accN);

    // ---- 4. Shoulder girdle + arms
    for (const S of ['L', 'R']) {
      const sd = rig.side[S], A = T.arms[S], s = sd.s;
      // scapulohumeral rhythm: clavicle takes ~1/3 of elevation above ~60°, and protracts with forward reach
      // generic hand override (reach / brace): world wrist target + elbow pole, weighted
      if (A.reachW > 0.001 && !(A.ovW > 0.001)) { A.ovW = A.reachW; A.ovWrist = A.reachP; A.ovElbow = null; }
      const wr = v3.copy(A.wr);
      if (A.ovW > 0.001) wr.lerp(v4.copy(A.ovWrist).sub(worldP(sd.upper, v5)).applyQuaternion(_qB.copy(chestQ).invert()), A.ovW);
      const wl = wr.length() || 1;
      const elev = Math.acos(clamp(-wr.y / wl, -1, 1));
      const clavElev = clamp((elev - 60 * DEG) / 3, 0, 24 * DEG);
      const clavProt = clamp(wr.z / wl * 14 * DEG, -8 * DEG, 14 * DEG);
      let dClav;
      if (A.clavRel) {   // clavicle from the clip, plus extra shrug only when an override lifts the arm
        const ow = A.ovW > 0.001 ? A.ovW : 0;
        dClav = chestQ.clone().multiply(A.clavRel).multiply(qAxis(AZ, s * clavElev * ow)).multiply(qAxis(AY, -s * clavProt * ow));
      } else dClav = chestQ.clone().multiply(qAxis(AZ, s * clavElev)).multiply(qAxis(AY, -s * clavProt));
      rig.setDelta(sd.clav, dClav);

      const sh = worldP(sd.upper, v0);
      const wrist = v1.copy(A.wr).applyQuaternion(chestQ).add(sh);
      const elbow = v2.copy(A.el).applyQuaternion(chestQ).add(sh);
      if (!(A.ovW > 0.001)) this.armAng[S] = null;
      if (A.ovW > 0.001) {
        // the clip's elbow direction, measured against the clip's own shoulder→wrist line
        const axFK = V3().copy(wrist).sub(sh).normalize();
        const dFK0 = V3().copy(elbow).sub(sh); dFK0.addScaledVector(axFK, -dFK0.dot(axFK));
        {   // blend the hand around the shoulder (direction + reach), never through it
          const r0 = V3().copy(wrist).sub(sh), r1 = V3().copy(A.ovWrist).sub(sh);
          const l0 = r0.length(), l1 = r1.length();
          r0.normalize(); r1.normalize();
          const qd = new THREE.Quaternion().setFromUnitVectors(r0, r1);
          const dir = r0.applyQuaternion(new THREE.Quaternion().slerp(qd, A.ovW));
          wrist.copy(sh).addScaledVector(dir, lerp(l0, l1, A.ovW));
        }
        // blend the elbow's bend DIRECTION around the shoulder→wrist line (never the point), so it can't flip through the line
        const axis = v4.copy(wrist).sub(sh).normalize();
        const base = v5.copy(sh).add(wrist).multiplyScalar(0.5);
        const perp = (p, out) => { out.copy(p).sub(base); out.addScaledVector(axis, -out.dot(axis)); return out; };
        const dFK = dFK0.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(axFK, axis)); dFK.addScaledVector(axis, -dFK.dot(axis));
        const dOv = A.ovPoleDir ? V3().copy(A.ovPoleDir).addScaledVector(axis, -A.ovPoleDir.dot(axis)) : perp(A.ovElbow ? A.ovElbow : V3(s * 0.35, -0.45, -0.25).applyQuaternion(chestQ).add(sh), V3());
        if (dFK.lengthSq() < 1e-6) dFK.copy(dOv);
        if (dOv.lengthSq() < 1e-6) dOv.copy(dFK);
        dFK.normalize(); dOv.normalize();
        let ang = Math.atan2(V3().crossVectors(dFK, dOv).dot(axis), dFK.dot(dOv));    // rotate around the arm line, never through it
        const prev = this.armAng[S];                                                   // keep the same way round when nearly opposite
        if (prev != null && Math.abs(ang - prev) > Math.PI) ang += ang < prev ? 2 * Math.PI : -2 * Math.PI;
        this.armAng[S] = ang;
        const dm = dFK.clone().applyAxisAngle(axis, ang * A.ovW);
        elbow.copy(base).addScaledVector(dm.normalize(), 0.35);
      }
      // glenohumeral extension limit (arm behind the trunk)
      const rel = v4.copy(elbow).sub(sh).applyQuaternion(_qB.copy(chestQ).invert());
      const ext = Math.atan2(-rel.z, -rel.y);
      if (ext > LIMITS.shoulderExt * DEG) this.hit('shoulder ' + S);
      const fb = v5.set(s * 0.3, -0.25, -1).normalize().applyQuaternion(chestQ);
      elbow.addScaledVector(fb, 0.05);          // small back-out bias keeps the elbow plane stable when the arm is straight
      this.solveLimb(sd.arm, sh, wrist, elbow, fb);
      rig.setDelta(sd.upper, sd.arm.d1);
      rig.setDelta(sd.fore, sd.arm.d2);
      if (sd.arm.hit) this.hit('elbow ' + S);
      D['elbow' + S] = sd.arm.flex;
      // wrist (local) + fingers
      sd.hand.quaternion.copy(A.hand);
      sd.hand.updateMatrixWorld(true);
      if (A.handW > 0.001 && A.handF) this.orientHand(S, A.handF, A.handN, A.handW);
      else { if (this.twPrev) this.twPrev[S] = null; if (this.handPrev) this.handPrev[S] = null; }
      if (T.fingers) {
        for (const f of sd.fingers) { const q = T.fingers.get(f.bone); if (q) f.bone.quaternion.copy(q); }
      } else for (const f of sd.fingers) {
        const ang = (f.thumb ? T.curl * 0.6 : T.curl) * f.w * 55 * DEG;
        f.bone.quaternion.copy(f.lq).multiply(qAxis(f.axis, ang, _qB));
      }
      if (A.curl != null && A.handW > 0.001) for (const f of sd.fingers) {   // catching shape of the fingers
        const q = f.lq.clone().multiply(qAxis(f.axis, (f.thumb ? 0.6 : 1) * A.curl * f.w * DEG, _qB));
        f.bone.quaternion.slerp(q, A.handW);
      }
      sd.hand.updateMatrixWorld(true);
      this.debug[S + 'wrist'] = wrist.clone(); this.debug[S + 'elbow'] = elbow.clone();
    }

    // ---- 5. Legs
    // (a) both legs first, then keep the knees and shins from passing through each other: a leg whose knee comes
    //     within ~13 cm of the other leg turns its knee outward around its own hip–ankle line
    const legPole = { L: T.legs.L.pole.clone(), R: T.legs.R.pole.clone() };
    if (!globalThis.__noKnee) this.legClearance(T, legPole);
    for (const S of ['L', 'R']) {
      const sd = rig.side[S], Lg = T.legs[S], s = sd.s;
      const hip = worldP(sd.thigh, v0);
      const target = Lg.ankle;
      const fwd = v5.set(0, 0, 1).applyQuaternion(T.pelvisQ);
      this.solveLimb(sd.leg, hip, target, legPole[S], fwd);
      // hip ROM check in pelvis frame
      const thighDir = v1.copy(sd.leg.mid).sub(hip).applyQuaternion(_qB.copy(T.pelvisQ).invert()).normalize();
      const flex = Math.atan2(thighDir.z, -thighDir.y) / DEG;
      const abd = Math.asin(clamp(thighDir.x * s, -1, 1)) / DEG;
      if (flex > LIMITS.hipFlex || flex < -LIMITS.hipExt || abd > LIMITS.hipAbd || abd < -LIMITS.hipAdd) this.hit('hip ' + S + (flex > LIMITS.hipFlex ? ' flex' : flex < -LIMITS.hipExt ? ' ext' : ' ab/add'));
      rig.setDelta(sd.thigh, sd.leg.d1);
      rig.setDelta(sd.shin, sd.leg.d2);
      if (sd.leg.hit) this.hit('knee ' + S);
      D['knee' + S] = sd.leg.flex;

      // foot: blend shank-relative (swing) and ground-relative (contact) orientation
      const dShin = sd.leg.d2;
      const qSw = dShin.clone().multiply(qAxis(AX, Lg.ankleAngle, _qB));
      const qF = qSw.slerp(Lg.groundQ, Lg.mix);
      // ankle / subtalar ROM relative to the shank
      const rel = _qA.copy(dShin).invert().multiply(qF);
      const e = new THREE.Euler().setFromQuaternion(rel, 'YXZ');
      const px = clamp(e.x, -LIMITS.ankleDorsi * DEG, LIMITS.anklePlantar * DEG);
      const rz = clamp(e.z * s, -LIMITS.ankleInv * DEG, LIMITS.ankleEv * DEG) * s;
      const yy = clamp(e.y, -LIMITS.ankleYaw * DEG, LIMITS.ankleYaw * DEG);
      if (Math.abs(px - e.x) > 0.02 || Math.abs(rz - e.z) > 0.02 || Math.abs(yy - e.y) > 0.02) this.hit('ankle ' + S + (Math.abs(px - e.x) > 0.02 ? (e.x < 0 ? ' dorsi' : ' plantar') : Math.abs(rz - e.z) > 0.02 ? ' inv/ev' : ' yaw'));
      const dFoot = dShin.clone().multiply(qEuler(px, yy, rz));
      rig.setDelta(sd.foot, dFoot);
      // toes (MTP): positive = extension (toes up)
      const tb = clamp(Lg.toeBend, -LIMITS.toeFlex * DEG, LIMITS.toeExt * DEG);
      rig.setDelta(sd.toe, dFoot.clone().multiply(qAxis(AX, -tb, _qB)));
      D['err' + S] = worldP(sd.foot, v1).distanceTo(target);
      this.debug[S + 'ankle'] = target.clone(); this.debug[S + 'knee'] = sd.leg.mid.clone();
      this.debug[S + 'pole'] = Lg.pole.clone();
    }
  }

  legClearance(T, pole) {
    const rig = this.rig, fwd = V3(0, 0, 1).applyQuaternion(T.pelvisQ), left = V3(1, 0, 0).applyQuaternion(T.pelvisQ);
    const base = { L: pole.L.clone(), R: pole.R.clone() }, seg = {};
    const solve = (S, th) => {
      const sd = rig.side[S], hip = worldP(sd.thigh), s = S === 'L' ? 1 : -1;
      this.solveLimb(sd.leg, hip, T.legs[S].ankle, base[S], fwd);
      if (Math.abs(th) > 1e-4) {                     // turn the knee outward (toward his own side) around the hip–ankle line
        const axis = sd.leg.endP.clone().sub(hip).normalize(), knee = sd.leg.mid.clone();
        const off = knee.clone().sub(hip); off.addScaledVector(axis, -off.dot(axis));
        const out = left.clone().multiplyScalar(s); out.addScaledVector(axis, -out.dot(axis));
        const sgn = Math.sign(V3().crossVectors(off, out).dot(axis)) || 1;
        off.applyAxisAngle(axis, sgn * th);
        pole[S] = hip.clone().addScaledVector(axis, knee.clone().sub(hip).dot(axis)).add(off.multiplyScalar(3));
        this.solveLimb(sd.leg, hip, T.legs[S].ankle, pole[S], fwd);
      } else pole[S] = base[S].clone();
      seg[S] = { hip, knee: sd.leg.mid.clone(), end: sd.leg.endP.clone(), r: (() => { const ax = sd.leg.endP.clone().sub(hip).normalize(), o = sd.leg.mid.clone().sub(hip); o.addScaledVector(ax, -o.dot(ax)); return o.length(); })() };
    };
    const gapOf = () => { const A = seg.L, B = seg.R; return Math.max(0.135 - A.knee.distanceTo(B.knee), 0.11 - Math.min(segDist(A.knee, A.end, B.knee, B.end), segDist(A.hip, A.knee, B.knee, B.end), segDist(A.knee, A.end, B.hip, B.knee))); };
    // how far each knee has to turn out (both share it), then eased in time so it never snaps
    this.kr = this.kr || { L: 0, R: 0 };
    const need = { L: 0, R: 0 };
    solve('L', 0); solve('R', 0);
    for (let it = 0; it < 4; it++) {
      const def = gapOf(); if (def <= 0.002) break;
      for (const S of ['L', 'R']) if (seg[S].r > 0.015) need[S] = Math.min(0.7, need[S] + (def * 0.6 + 0.004) / seg[S].r);
      solve('L', need.L); solve('R', need.R);
    }
    const k = T.dt ? 1 - Math.exp(-T.dt / 0.05) : 1;
    for (const S of ['L', 'R']) this.kr[S] += (Math.max(need[S], 0) - this.kr[S]) * (need[S] > this.kr[S] ? Math.min(1, k * 1.5) : k);
    solve('L', this.kr.L); solve('R', this.kr.R);
    if (need.L + need.R > 0.01) this.hit('knees close');
  }

  // Two-bone analytic IK: law of cosines + pole plane, with soft reach and
  // an anatomical hinge limit (max flexion → minimum root-to-end distance).
  solveLimb(limb, root, target, pole, fallback) {
    const { l1, l2 } = limb, L = l1 + l2;
    const t = this.v;
    const vv = t[6].copy(target).sub(root);
    let d = vv.length();
    const dir = t[7].copy(vv).divideScalar(Math.max(d, 1e-6));
    const dMin = Math.sqrt(l1 * l1 + l2 * l2 - 2 * l1 * l2 * Math.cos(Math.PI - limb.maxFlex));
    const ds = 0.975 * L;
    limb.hit = false;
    if (d > ds) d = Math.min(ds + (L - ds) * (1 - Math.exp(-(d - ds) / (L - ds))), L * 0.9999);
    if (d < dMin) { d = dMin; limb.hit = true; }
    const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
    let pn = perpNorm(t[8].copy(pole).sub(root), dir, t[9]);
    if (!pn) pn = perpNorm(fallback, dir, t[9]) || t[9].set(0, 0, 1);
    limb.mid.copy(root).addScaledVector(dir, l1 * cosA).addScaledVector(pn, l1 * sinA);
    limb.endP.copy(root).addScaledVector(dir, d);
    const a1 = t[10].copy(limb.mid).sub(root).normalize();
    const bdir = perpNorm(t[8].copy(pn).negate(), a1, t[11]) || t[11].copy(pn).negate();
    basisQ(a1, bdir, limb.d1).multiply(limb.B1inv);
    const h = V3().crossVectors(a1, bdir);
    const a2 = V3().copy(limb.endP).sub(limb.mid).normalize();
    basisQ(a2, h, limb.d2).multiply(limb.B2inv);
    limb.flex = Math.acos(clamp(a1.dot(a2), -1, 1));
  }

  // When a hand target is beyond arm's length, the trunk turns and bends toward it.
  reachAssist(T, chestTarget) {
    const rig = this.rig;
    for (const S of ['L', 'R']) {
      const A = T.arms[S];
      if (!(A.reachW > 0.001)) continue;
      const base = worldP(rig.b.spine, V3());
      const shB = rig.bp(rig.side[S].upper).sub(rig.bp(rig.b.spine)).applyQuaternion(chestTarget).add(base);
      const dist = shB.distanceTo(A.reachP);
      const need = clamp((dist - rig.armLen * 0.9) / 0.45, 0, 1) * A.reachW;
      if (need <= 0) continue;
      const from = shB.clone().sub(base).normalize(), to = A.reachP.clone().sub(base).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(from, to);
      const full = new THREE.Quaternion();
      full.slerp(q, need * 0.8);
      chestTarget = full.multiply(chestTarget);
    }
    return chestTarget;
  }
}

// ============================================================================
//  CLIP-DRIVEN FIELDER CONTROLLER
//  Base layer : motion-library clips, phase-synced, blended in a 2-D velocity
//               blend space (speed × direction relative to the chest).
//  IK layer   : foot locking with rolling contact, terrain, planted-foot stops,
//               turn-in-place steps, gaze chain, lean, brake, slide, reach.
// ============================================================================
const TAU = Math.PI * 2;
const angLerp = (a, b, t) => a + wrapPi(b - a) * t;
const expK = (dt, tau) => 1 - Math.exp(-dt / Math.max(tau, 1e-4));
const tableLerp = (tab, x) => {
  if (x <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) if (x <= tab[i][0]) return lerp(tab[i - 1][1], tab[i][1], (x - tab[i - 1][0]) / (tab[i][0] - tab[i - 1][0]));
  return tab[tab.length - 1][1];
};
const inWin = (phi, w) => mod1(phi - w[0]) < (w[1] - w[0]);
const IDQ = new THREE.Quaternion();
const FAST_RUN = 6.6;   // top speed until a real sprint clip arrives (Run_fast at ~290 steps/min)
const BACKPEDAL = 1.8;  // quick backpedal: Walking_Backward at a higher cadence (same step, so no foot skate)
const SHUFFLE_MAX = 2.6;

// ---------------------------------------------------------------- library
class MotionLib {
  constructor(json, rig) {
    this.rig = rig;
    const idx = new Map(rig.bones.map((b, i) => [b.name, i]));
    this.map = json.bones.map((n) => idx.has(n) ? idx.get(n) : -1);
    this.B = rig.bones.length;
    const dec = (b64, T) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new T(u.buffer); };
    this.clips = json.clips.map((c) => {
      const qi = dec(c.q, Int16Array), hp = dec(c.hp, Float32Array);
      const n = c.n, JB = json.bones.length;
      const q = new Float32Array(n * this.B * 4);
      // default every bone to its bind local rotation, then fill what the clip has
      for (let k = 0; k < n; k++) for (let b = 0; b < this.B; b++) { const l = rig.bind.get(rig.bones[b]).lq; q.set([l.x, l.y, l.z, l.w], (k * this.B + b) * 4); }
      for (let k = 0; k < n; k++) for (let j = 0; j < JB; j++) {
        const b = this.map[j]; if (b < 0) continue;
        const o = (k * JB + j) * 4, d = (k * this.B + b) * 4;
        q[d] = qi[o] / 32767; q[d + 1] = qi[o + 1] / 32767; q[d + 2] = qi[o + 2] / 32767; q[d + 3] = qi[o + 3] / 32767;
      }
      let dir = c.dir;
      if (c.role === 'loco' && Math.abs(dir) < 8 * DEG) dir = 0;                    // clean forward axis
      if (c.role === 'loco' && Math.abs(wrapPi(dir - Math.PI)) < 8 * DEG) dir = Math.PI;
      const out = { ...c, dir, q, hp };
      // mocap-only locomotion: generated jog/sprint are dropped (walk blends straight into Run_medium)
      if (c.generated && c.loop === 'phase') out.role = 'off';
      // Run_fast = the fast-run slot. Same stride, played at a higher cadence → FAST_RUN m/s (no foot skate)
      if (/^run_fast$/i.test(c.name)) { out.role = 'loco'; if (Math.abs(dir) < 8 * DEG) out.dir = 0; out.nativeSpeed = c.speed; out.freq = c.freq * (FAST_RUN / c.speed); out.speed = FAST_RUN; }
      out.stride = out.speed / out.freq;
      return out;
    });
    // v20: back to v14's blend — the CMU jog (104_04) stays in (without it the cadence dips 139 → 132 steps/min between
    // 2.2 and 3.4 m/s). Its shrug (shoulders ~10 cm higher than every other clip) is fixed on the clip instead: its
    // clavicles are replaced by Jog_slow's at the same phase, the upper arms counter-turned so the arm swing is kept
    { const jf = this.clips.find((c) => c.name === 'Jog_forward'), js = this.clips.find((c) => c.name === 'Jog_slow');
      if (jf && js) this.transplantClavicles(jf, js); }
    // v21: the jog right before the CMU jog → stop (104_09, same subject): an in-place loop played while braking to a
    // stop, so the stop capture starts from its own jog. Same shrug → same clavicle fix. Not in the blend space.
    { const ps = this.clips.find((c) => c.name === 'Jog_prestop'), js = this.clips.find((c) => c.name === 'Jog_slow');
      if (ps && js) { this.transplantClavicles(ps, js); ps.role = 'prestop'; this.prestop = ps; } }
    // v21: the trunk leans 2-3× too far forward in the run clips (chest 25-34° at 3-5 m/s; runners ~5-10°, more only
    // while accelerating hard): each moving clip's mean chest tilt brought down to a target by speed, the pitch taken
    // back over the spine (hips and legs untouched: the feet do not change); the in-cycle bob is kept
    for (const c of this.clips) if ((c.role === 'loco' || c.role === 'prestop') && c.loop === 'phase' && c.speed > 0.3 && !c.derived) this.straighten(c);
    // v20: Run_steady swings its hands ~30 cm out from the chest (the jogs ~26): upper arms brought in toward the body;
    // it is also the sprint now (same stride, quicker cadence, like the old Run_fast slot) — Sprint and Run_fast out
    { const rs = this.clips.find((c) => c.name === 'Run_steady' && c.role === 'loco');
      if (rs) {
        this.narrowArms(rs, 0.26);
        for (const c of this.clips) if (c.name === 'Sprint' || c.name === 'Run_fast') c.role = 'off';
        // (the running strafes cross their legs the wrong way — feet −41° against the +37° they are filed under — with
        // the hips turned ~50°: in a running turn they showed as over-rotation; out, the jog strafes cover the sides)
        for (const c of this.clips) if (/^Run_(left|right)_strafe$/.test(c.name)) c.role = 'off';
        const f = { ...rs, name: 'Run_steady_fast', nativeSpeed: rs.speed, speed: FAST_RUN, freq: rs.freq * FAST_RUN / rs.speed, derived: true };
        f.stride = f.speed / f.freq; this.clips.push(f);
      } }
    // v13: Next_set_2's full-body backward walk replaces the old legs-only one
    if (this.clips.some((c) => c.name === 'Walking_Backward' && c.role === 'loco')) for (const c of this.clips) if (c.name === 'Walking_Backward__LegsOnly') c.role = 'off';
    // quick backpedal = the backward jog (Next_set_2) at a quicker cadence (fielders back-pedal with short, fast steps)
    { const wb = this.clips.find((c) => /^jog_backward$/i.test(c.name) && c.role === 'loco') || this.clips.find((c) => /^walking_backward/i.test(c.name) && c.role === 'loco');
      if (wb) { const qb = { ...wb, name: 'Backpedal_quick', nativeSpeed: wb.speed, speed: BACKPEDAL, freq: wb.freq * BACKPEDAL / wb.speed, derived: true }; qb.stride = qb.speed / qb.freq; this.clips.push(qb); } }
    this.byName = new Map(this.clips.map((c) => [c.name, c]));
    this.idle = this.clips.find((c) => c.loop === 'time');
    this.brake = this.clips.find((c) => c.role === 'brake');
    this.spaces = { casual: this.buildSpace('casual'), standard: this.buildSpace('standard') };
    // shuffle (hold R): side-step clips left / right (Next_set_2), walking forward / back, facing held; arms from idle
    const sh = ['Shuffle_left__LegsOnly', 'Shuffle_right__LegsOnly', 'Standard_walk', 'Walking_Backward'].map((n) => this.byName.get(n)).filter(Boolean);
    if (sh.length >= 3) { this.spaces.shuffle = this.buildSpace('shuffle', sh); this.spaces.shuffle.axis = [[0, this.idle]]; }
  }
  // clip frames → FK helper (VirtualFK, built on first use)
  vfk() { return this._vfk || (this._vfk = new VirtualFK(this.rig)); }
  sideI(S) { const sd = this.rig.side[S], ix = (b) => this.rig.bones.indexOf(b); return { clav: ix(sd.clav), upper: ix(sd.upper), fore: ix(sd.fore), hand: ix(sd.hand) }; }
  transplantClavicles(dst, src) {
    const B = this.B, buf = new Float32Array(B * 4), h = V3(), q = new THREE.Quaternion(), a = new THREE.Quaternion(), u = new THREE.Quaternion();
    for (let k = 0; k < dst.n; k++) {
      this.sample(src, k / dst.n, buf, h);
      for (const S of ['L', 'R']) {
        const x = this.sideI(S); if (x.clav < 0 || x.upper < 0) continue;
        const oc = (k * B + x.clav) * 4, ou = (k * B + x.upper) * 4;
        a.fromArray(dst.q, oc); u.fromArray(dst.q, ou); q.fromArray(buf, x.clav * 4);
        const un = q.clone().invert().multiply(a).multiply(u);          // clav' · upper' = clav · upper
        dst.q.set([q.x, q.y, q.z, q.w], oc); dst.q.set([un.x, un.y, un.z, un.w], ou);
      }
    }
  }
  // mean forward tilt of the chest over a clip's cycle (radians, + = forward)
  chestTilt(clip, N = 32) {
    const fk = this.vfk(), buf = new Float32Array(this.B * 4), h = V3(), ch = this.rig.bones.indexOf(this.rig.b.spine2); let m = 0;
    for (let i = 0; i < N; i++) { this.sample(clip, i / N, buf, h); fk.run(buf, h, 0); const up = V3(0, 1, 0).applyQuaternion(fk.delta(ch)); const f = V3(0, 0, 1); m += Math.asin(clamp(up.dot(f), -1, 1)) / N; }
    return m;
  }
  straighten(clip) {
    const target = tableLerp([[0, 2], [1.4, 4.5], [2.5, 6.5], [4, 9], [6.6, 11]], clip.speed) * DEG;   // (v22: a little more upright)
    const m0 = this.chestTilt(clip); clip.tiltMean = m0;
    const c = m0 - target; if (c <= 1 * DEG) return;
    const fk = this.vfk(), B = this.B, rig = this.rig, sp = [[rig.b.spine, 0.4], [rig.b.spine1, 0.3], [rig.b.spine2, 0.3]].map(([b, k]) => [rig.bones.indexOf(b), k]);
    const orig = clip.q, out = orig.slice();
    for (let k = 0; k < clip.n; k++) {
      const fr = out.subarray(k * B * 4, (k + 1) * B * 4);
      for (const [i, w] of sp) {                                   // parents first: each segment tips back its share
        fk.run(fr, V3(clip.hp[k * 3], clip.hp[k * 3 + 1], clip.hp[k * 3 + 2]), 0);
        const fwd = V3(0, 0, 1);                                     // (the body's forward: clips face +z)
        const ax = V3().crossVectors(V3(0, 1, 0), fwd).normalize();      // pitch axis (a + angle about it tips the top forward)
        const Wp = fk.Q[fk.parent[i]].clone(), R = new THREE.Quaternion().setFromAxisAngle(ax, -c * w);
        const ql = new THREE.Quaternion().fromArray(fr, i * 4), qn = Wp.clone().invert().multiply(R).multiply(Wp).multiply(ql);
        fr.set([qn.x, qn.y, qn.z, qn.w], i * 4);
      }
    }
    clip.q = out; clip.tiltFix = c; clip.tiltMean = this.chestTilt(clip);
    // the head came back with the spine: if that tips the chin up, the neck brings it back to level (≤ what was taken)
    const hm = this.headTilt(clip), want = 2 * DEG, hc = clamp(want - hm, 0, Math.max(c, 10 * DEG));
    if (hc > 1 * DEG) {
      const ni = rig.bones.indexOf(rig.b.neck), ax = V3(1, 0, 0);
      for (let k = 0; k < clip.n; k++) {
        const fr = out.subarray(k * B * 4, (k + 1) * B * 4); fk.run(fr, V3(clip.hp[k * 3], clip.hp[k * 3 + 1], clip.hp[k * 3 + 2]), 0);
        const Wp = fk.Q[fk.parent[ni]].clone(), R = new THREE.Quaternion().setFromAxisAngle(ax, hc);
        const ql = new THREE.Quaternion().fromArray(fr, ni * 4), qn = Wp.clone().invert().multiply(R).multiply(Wp).multiply(ql);
        fr.set([qn.x, qn.y, qn.z, qn.w], ni * 4);
      }
    }
  }
  headTilt(clip, N = 16) {
    const fk = this.vfk(), buf = new Float32Array(this.B * 4), h = V3(), hi = this.rig.bones.indexOf(this.rig.b.head); let m = 0;
    for (let i = 0; i < N; i++) { this.sample(clip, i / N, buf, h); fk.run(buf, h, 0); const up = V3(0, 1, 0).applyQuaternion(fk.delta(hi)); m += Math.asin(clamp(up.z, -1, 1)) / N; }
    return m;
  }
  // mean sideways distance of the hands from the chest (chest frame), over the cycle
  handsOut(clip, N = 32) {
    const fk = this.vfk(), buf = new Float32Array(this.B * 4), h = V3(), ch = this.rig.bones.indexOf(this.rig.b.spine2); let m = 0;
    for (let i = 0; i < N; i++) { this.sample(clip, i / N, buf, h); fk.run(buf, h, 0); const ci = fk.delta(ch).invert();
      for (const S of ['L', 'R']) m += Math.abs(fk.P[this.sideI(S).hand].clone().sub(fk.P[ch]).applyQuaternion(ci).x) / (2 * N); }
    return m;
  }
  // bring the upper arms in toward the body (about the chest's forward axis) until the hands average `target` m out
  narrowArms(clip, target) {
    const orig = clip.q.slice(), fk = this.vfk(), B = this.B, ch = this.rig.bones.indexOf(this.rig.b.spine2);
    const apply = (ang) => {
      clip.q.set(orig);
      for (let k = 0; k < clip.n; k++) {
        const fr = orig.subarray(k * B * 4, (k + 1) * B * 4); fk.run(fr, V3(clip.hp[k * 3], clip.hp[k * 3 + 1], clip.hp[k * 3 + 2]), 0);
        const fwd = V3(0, 0, 1).applyQuaternion(fk.delta(ch));
        for (const S of ['L', 'R']) {
          const x = this.sideI(S); if (x.upper < 0) continue;
          const side = fk.P[x.upper].clone().sub(fk.P[ch]).applyQuaternion(fk.delta(ch).invert()).x > 0 ? 1 : -1;
          const Wp = fk.Q[this.rig.bones.indexOf(this.rig.bones[x.upper].parent)].clone();
          const R = new THREE.Quaternion().setFromAxisAngle(fwd, side * ang);
          const o = (k * B + x.upper) * 4, qu = new THREE.Quaternion().fromArray(orig, o);
          const qn = Wp.clone().invert().multiply(R).multiply(Wp).multiply(qu);
          clip.q.set([qn.x, qn.y, qn.z, qn.w], o);
        }
      }
      return this.handsOut(clip);
    };
    const m0 = this.handsOut(clip); if (m0 <= target) return;
    // pick the direction that brings them in, then bisect
    const sgn = apply(0.1) < m0 ? 1 : -1;
    let lo = 0, hi = 0.6;
    for (let it = 0; it < 18; it++) { const mid = (lo + hi) / 2; if (apply(sgn * mid) > target) lo = mid; else hi = mid; }
    apply(sgn * hi); clip.armIn = sgn * hi;
  }
  buildSpace(mode, only = null) {
    const pts = [{ clip: this.idle, x: 0, z: 0 }];
    for (const c of only || this.clips) {
      if (!only && (c.role !== 'loco' || c.loop !== 'phase')) continue;
      if (!only && c.mode !== 'both' && c.mode !== mode) continue;
      pts.push({ clip: c, x: c.speed * Math.sin(c.dir), z: c.speed * Math.cos(c.dir) });
    }
    // brute-force Delaunay (few points)
    const tris = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
      const A = pts[i], B = pts[j], C = pts[k];
      const d = 2 * (A.x * (B.z - C.z) + B.x * (C.z - A.z) + C.x * (A.z - B.z));
      if (Math.abs(d) < 1e-6) continue;
      const a2 = A.x * A.x + A.z * A.z, b2 = B.x * B.x + B.z * B.z, c2 = C.x * C.x + C.z * C.z;
      const ux = (a2 * (B.z - C.z) + b2 * (C.z - A.z) + c2 * (A.z - B.z)) / d, uz = (a2 * (C.x - B.x) + b2 * (A.x - C.x) + c2 * (B.x - A.x)) / d;
      const r2 = (A.x - ux) ** 2 + (A.z - uz) ** 2;
      let ok = true;
      for (let m = 0; m < n && ok; m++) if (m !== i && m !== j && m !== k && (pts[m].x - ux) ** 2 + (pts[m].z - uz) ** 2 < r2 - 1e-7) ok = false;
      if (ok) tris.push([i, j, k]);
    }
    // hull edges = edges used by exactly one triangle
    const ec = new Map();
    for (const t of tris) for (const [a, b] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) { const key = Math.min(a, b) + ':' + Math.max(a, b); ec.set(key, (ec.get(key) || 0) + 1); }
    const hull = [...ec.entries()].filter(([, c]) => c === 1).map(([k]) => k.split(':').map(Number));
    // forward clips that own an upper body, by speed: donors for legs-only clips
    const axis = [[0, this.idle], ...pts.filter((p) => p.clip !== this.idle && !p.clip.legsOnly && Math.abs(p.x) < 1e-3 && p.z > 0).map((p) => [p.z, p.clip])].sort((a, b) => a[0] - b[0]);
    return { pts, tris, hull, mode, axis };
  }
  donor(space, s) {
    const ax = space.axis;
    if (s <= ax[0][0]) return [[ax[0][1], 1]];
    for (let i = 1; i < ax.length; i++) if (s <= ax[i][0]) { const t = (s - ax[i - 1][0]) / (ax[i][0] - ax[i - 1][0]); return [[ax[i - 1][1], 1 - t], [ax[i][1], t]]; }
    return [[ax[ax.length - 1][1], 1]];
  }
  // barycentric weights for a local velocity (x = left, z = forward); returns {weights: Map clip→w, x, z, capped}
  query(space, x, z) {
    const { pts, tris, hull } = space;
    const bary = (t, px, pz) => {
      const A = pts[t[0]], B = pts[t[1]], C = pts[t[2]];
      const d = (B.z - C.z) * (A.x - C.x) + (C.x - B.x) * (A.z - C.z);
      const l1 = ((B.z - C.z) * (px - C.x) + (C.x - B.x) * (pz - C.z)) / d;
      const l2 = ((C.z - A.z) * (px - C.x) + (A.x - C.x) * (pz - C.z)) / d;
      return [l1, l2, 1 - l1 - l2];
    };
    let capped = false;
    for (let pass = 0; pass < 2; pass++) {
      let best = null, bestMin = -Infinity;
      for (const t of tris) { const b = bary(t, x, z); const m = Math.min(...b); if (m > bestMin) { bestMin = m; best = [t, b]; } }
      if (bestMin > -1e-4) {
        const w = new Map();
        best[0].forEach((pi, k) => { const v = Math.max(0, best[1][k]); if (v > 1e-4) w.set(pts[pi].clip, (w.get(pts[pi].clip) || 0) + v); });
        let s = 0; w.forEach((v) => (s += v)); w.forEach((v, c) => w.set(c, v / s));
        return { weights: w, x, z, capped };
      }
      // outside the hull → nearest point on the hull (this is the speed cap for that direction)
      let bd = Infinity, bx = 0, bz = 0;
      for (const [a, b] of hull) {
        const A = pts[a], B = pts[b], ex = B.x - A.x, ez = B.z - A.z;
        const t = clamp(((x - A.x) * ex + (z - A.z) * ez) / (ex * ex + ez * ez), 0, 1);
        const qx = A.x + ex * t, qz = A.z + ez * t, dd = (qx - x) ** 2 + (qz - z) ** 2;
        if (dd < bd) { bd = dd; bx = qx; bz = qz; }
      }
      // pull 1 mm inside so the containment test passes
      const l = Math.hypot(bx, bz); x = bx * (1 - 0.001 / Math.max(l, 0.01)); z = bz * (1 - 0.001 / Math.max(l, 0.01)); capped = true;
    }
    return { weights: new Map([[this.idle, 1]]), x: 0, z: 0, capped: true };
  }
  // max speed along a local direction (for the cap)
  capAt(space, ang) { const r = this.query(space, Math.sin(ang) * 20, Math.cos(ang) * 20); return Math.hypot(r.x, r.z); }
  // sample a clip at a normalized time u∈[0,1) into dst (Float32Array B*4) and hips (Vector3)
  sample(clip, u, dstQ, dstH) {
    const n = clip.n, f = mod1(u) * n, i0 = Math.floor(f) % n, i1 = (i0 + 1) % n, t = f - Math.floor(f);
    const B = this.B, q = clip.q;
    for (let b = 0; b < B; b++) {
      const o0 = (i0 * B + b) * 4, o1 = (i1 * B + b) * 4;
      let x1 = q[o1], y1 = q[o1 + 1], z1 = q[o1 + 2], w1 = q[o1 + 3];
      if (q[o0] * x1 + q[o0 + 1] * y1 + q[o0 + 2] * z1 + q[o0 + 3] * w1 < 0) { x1 = -x1; y1 = -y1; z1 = -z1; w1 = -w1; }
      let x = lerp(q[o0], x1, t), y = lerp(q[o0 + 1], y1, t), z = lerp(q[o0 + 2], z1, t), w = lerp(q[o0 + 3], w1, t);
      const l = Math.hypot(x, y, z, w) || 1;
      dstQ[b * 4] = x / l; dstQ[b * 4 + 1] = y / l; dstQ[b * 4 + 2] = z / l; dstQ[b * 4 + 3] = w / l;
    }
    const h = clip.hp;
    dstH.set(lerp(h[i0 * 3], h[i1 * 3], t), lerp(h[i0 * 3 + 1], h[i1 * 3 + 1], t), lerp(h[i0 * 3 + 2], h[i1 * 3 + 2], t));
  }
}

// ---------------------------------------------------------------- virtual FK (no scene-graph work)
class VirtualFK {
  constructor(rig) {
    this.rig = rig;
    const bones = rig.bones, B = bones.length;
    this.parent = bones.map((b) => bones.indexOf(b.parent));
    const s = new THREE.Vector3(); bones[0].parent.getWorldScale(s);
    this.lp = bones.map((b) => rig.bind.get(b).lp.clone().multiplyScalar(s.x));
    this.bq = bones.map((b) => rig.bind.get(b).q.clone());
    this.bqInv = this.bq.map((q) => q.clone().invert());
    this.bp = bones.map((b) => rig.bind.get(b).p.clone());
    this.hips = bones.indexOf(rig.b.hips);
    this.Q = bones.map(() => new THREE.Quaternion()); this.P = bones.map(() => new THREE.Vector3());
    this._q = new THREE.Quaternion(); this._v = new THREE.Vector3();
  }
  // local quats → world (clip space). hipsPos in clip space; warp = yaw applied at the hips
  run(L, hipsPos, warp = 0, only = null) {
    const B = this.Q.length, par = this.parent;
    const qw = warp ? new THREE.Quaternion().setFromAxisAngle(AY, warp) : null;
    for (let i = 0; i < B; i++) {
      if (only && !only[i]) continue;
      const p = par[i];
      const ql = this._q.set(L[i * 4], L[i * 4 + 1], L[i * 4 + 2], L[i * 4 + 3]);
      if (p < 0) { this.Q[i].copy(this.bq[i]); this.P[i].copy(this.bp[i]); continue; }
      this.Q[i].copy(this.Q[p]).multiply(ql);
      if (i === this.hips) {
        this.P[i].copy(hipsPos);
        if (qw) { this.Q[i].premultiply(qw); this.P[i].applyQuaternion(qw); }
      } else this.P[i].copy(this.lp[i]).applyQuaternion(this.Q[p]).add(this.P[p]);
    }
  }
  delta(i, out = new THREE.Quaternion()) { return out.copy(this.Q[i]).multiply(this.bqInv[i]); }
}

// ---------------------------------------------------------------- the controller

// ============================================================================
//  MOCAP GET-UPS
//  Four one-shot clips from the CMU motion-capture database (subjects 139/140,
//  retargeted offline to Model2 by tools/pack-getups.mjs): chest down, left side
//  down, right side down (mirrored) and on the back. After a dive or a fall the
//  clip matching how he ended up lying is laid onto the ground where he is
//  (turned so its head points where his head points), blended in from the
//  settled pose, played with its pauses tightened, and handed back to the
//  locomotion layer standing on its own feet.
// ============================================================================
class GetupLib {
  constructor(json, rig) {
    const dec = (b64, T) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new T(u.buffer); };
    const byN = new Map(rig.bones.map((b) => [normName(b.name), b]));
    this.fps = json.fps;
    this.bones = json.bones.map((n) => byN.get(normName(n)) || null);
    this.hipsK = this.bones.indexOf(rig.b.hips);
    this.clips = json.clips.map((c) => ({ ...c, q: dec(c.q, Int16Array), hp: dec(c.hp, Float32Array) }));
    this.byName = Object.fromEntries(this.clips.map((c) => [c.name, c]));
    // v13 one-shots on the legs only (turns): hips + legs, and the chain used for the yaw-only turn scaling
    const k = (b) => this.bones.indexOf(b);
    this.legMask = this.bones.map(() => false); this.legMask[this.hipsK] = true;
    this.turnChain = [[this.hipsK, -1]];
    for (const S of ['L', 'R']) { const sd = rig.side[S]; let p = this.hipsK; for (const b of [sd.thigh, sd.shin, sd.foot, sd.toe]) { const i = k(b); if (i < 0) break; this.legMask[i] = true; this.turnChain.push([i, p]); p = i; } }
    this.bqW = this.bones.map((b) => (b ? rig.bq(b).clone() : null));
    this.bqWInv = this.bqW.map((q) => (q ? q.clone().invert() : null));
    this.thighK = { L: k(rig.side.L.thigh), R: k(rig.side.R.thigh) };
    this.rigIdx = this.bones.map((b) => (b ? rig.bones.indexOf(b) : -1));
    for (const c of this.clips) {
      // v20: foot events of the move clips (landing / lift-off after frame 0, blips under 4 frames dropped): the
      // locomotion phase is known all through the clip (interpolated between events), not only after a landing
      if (c.cL) {
        const ev = [];
        for (const S of ['L', 'R']) {
          const con = S === 'L' ? c.cL : c.cR, runs = [];
          for (let j = 0, st = 0; j <= c.n; j++) if (j === c.n || (j > 0 && con[j] !== con[j - 1])) { runs.push([st, j, con[st]]); st = j; }
          for (let r = runs.length - 2; r >= 1; r--) if (runs[r][1] - runs[r][0] < 4) { runs[r - 1][1] = runs[r + 1][1]; runs.splice(r, 2); }   // merge short blips
          for (let r = 1; r < runs.length; r++) ev.push({ j: runs[r][0], S, land: !!runs[r][2] });
        }
        c.ev = ev.sort((a, b) => a.j - b.j);
      }
      // v20: standing starts come from a turned stance (hips 40° off the way he runs, still 15-26° off at the end):
      // the hips' slow yaw offset from the travel direction (averaged over ±0.2 s), taken out of the pelvis with
      // the thighs counter-turned (feet unchanged), so the trunk starts where the idle faces and ends square to the run
      if (c.cL && /^(start|jogStart)M?$/.test(c.name)) {
        const hy = c.yawU.map((u) => wrapPi(c.start.hipsYaw + u - c.travelYaw)), b = new Float32Array(c.n);
        for (let i = 0; i < c.n; i++) { let s = 0, m = 0; for (let j = Math.max(0, i - 6); j <= Math.min(c.n - 1, i + 6); j++) { s += hy[j]; m++; } b[i] = s / m; }
        c.hyBias = b;
      }
    }
  }
  // v21: the CMU jog → stop (104_09, the subject whose jog shrugged) holds the shoulders ~10 cm high: its clavicles
  // are replaced by the jog's (Jog_slow, cycle mean) while moving, easing to the idle's as it slows to a stand; the
  // upper arms are counter-turned so the arms move exactly as captured
  fixShrug(lib, rig) {
    if (this.shrugFixed) return; this.shrugFixed = true;
    const js = lib.byName.get('Jog_slow'), idle = lib.idle; if (!js || !idle) return;
    const B = lib.B, mean = (clip, bi) => { const a = new THREE.Quaternion(0, 0, 0, 0), q = new THREE.Quaternion(); let ref = null;
      for (let k = 0; k < clip.n; k++) { q.fromArray(clip.q, (k * B + bi) * 4); if (!ref) ref = q.clone(); if (q.dot(ref) < 0) q.set(-q.x, -q.y, -q.z, -q.w); a.x += q.x; a.y += q.y; a.z += q.z; a.w += q.w; }
      return a.normalize(); };
    for (const S of ['L', 'R']) {
      const ri = rig.bones.indexOf(rig.side[S].clav), ci = this.bones.indexOf(rig.side[S].clav), ui = this.bones.indexOf(rig.side[S].upper);
      if (ri < 0 || ci < 0 || ui < 0) continue;
      const qJog = mean(js, ri), qIdle = mean(idle, ri), nb = this.bones.length;
      for (const c of ['jogStop', 'jogStopM'].map((n) => this.byName[n]).filter(Boolean)) {
        for (let i = 0; i < c.n; i++) {
          const oc = (i * nb + ci) * 4, ou = (i * nb + ui) * 4, q = c.q;
          const a = new THREE.Quaternion(q[oc] / 32767, q[oc + 1] / 32767, q[oc + 2] / 32767, q[oc + 3] / 32767).normalize();
          const u = new THREE.Quaternion(q[ou] / 32767, q[ou + 1] / 32767, q[ou + 2] / 32767, q[ou + 3] / 32767).normalize();
          const t = qIdle.clone().slerp(qJog, clamp((c.spd[i] || 0) / 2.3, 0, 1));
          const un = t.clone().invert().multiply(a).multiply(u);
          const put = (o, v) => { q[o] = Math.round(v.x * 32767); q[o + 1] = Math.round(v.y * 32767); q[o + 2] = Math.round(v.z * 32767); q[o + 3] = Math.round(v.w * 32767); };
          put(oc, t); put(ou, un);
        }
      }
    }
  }
  // which clip for a lying body frame (front = chest normal, lat = his left)
  pick(fr) {
    if (fr.front.y < -0.5) return this.byName.prone;
    if (fr.front.y > 0.45) return this.byName.supine;
    return fr.lat.y < 0 ? this.byName.sideL : this.byName.sideR;
  }
  // playback speed at clip time ct (pauses in the capture are played faster; changes eased over 0.3 s)
  speed(c, ct) { let s = c.segs[0][1]; for (let i = 1; i < c.segs.length; i++) { const [t, v] = c.segs[i]; s = lerp(s, v, sstep(t - 0.15, t + 0.15, ct)); } return s; }
  sample(c, ct, outQ, outH) {
    const nb = this.bones.length, f = clamp(ct * this.fps, 0, c.n - 1), i0 = Math.floor(f), i1 = Math.min(c.n - 1, i0 + 1), t = f - i0, q = c.q;
    for (let k = 0; k < nb; k++) {
      const o0 = (i0 * nb + k) * 4, o1 = (i1 * nb + k) * 4;
      let x1 = q[o1], y1 = q[o1 + 1], z1 = q[o1 + 2], w1 = q[o1 + 3];
      if (q[o0] * x1 + q[o0 + 1] * y1 + q[o0 + 2] * z1 + q[o0 + 3] * w1 < 0) { x1 = -x1; y1 = -y1; z1 = -z1; w1 = -w1; }
      const x = lerp(q[o0], x1, t), y = lerp(q[o0 + 1], y1, t), z = lerp(q[o0 + 2], z1, t), w = lerp(q[o0 + 3], w1, t), l = Math.hypot(x, y, z, w) || 1;
      outQ[k * 4] = x / l; outQ[k * 4 + 1] = y / l; outQ[k * 4 + 2] = z / l; outQ[k * 4 + 3] = w / l;
    }
    const h = c.hp; outH.set(lerp(h[i0 * 3], h[i1 * 3], t), lerp(h[i0 * 3 + 1], h[i1 * 3 + 1], t), lerp(h[i0 * 3 + 2], h[i1 * 3 + 2], t));
  }
}
