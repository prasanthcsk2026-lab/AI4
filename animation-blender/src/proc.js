// ============================================================================
//  PROCEDURAL IK LOCOMOTION (experiment)
//  No clip is played. A small gait model is trained once (on first use) from the library's walks and runs: per
//  clip and bone a mean rotation + PROC_H Fourier harmonics over one cycle (phase 0 = left touchdown, the contacts
//  measured from the feet), the hips the same way, and the cadence / stride / contact timing.
//  A Throttle % track sets a target speed; a jerk-limited speed controller accelerates or decelerates until that
//  speed is reached and then holds it. Cadence, stride, amplitude and gait (walk ↔ run) follow the speed; every
//  touchdown leaves a footprint planned ahead of time, the planted feet stay on them and the swinging feet are
//  steered onto the next one; both legs are two-bone IK. The trunk leans with the acceleration (back when slowing).
// ============================================================================
const PROC_H = 5, PROC_N = 64;
const PROC_FAM = {   // (Run_medium left out: its forward-heavy arm swing; the CMU runs cover the slow end)
  walk: ['loop:Standard_walk', 'loop:Casual_walk_1'],
  run: ['cmu:16_35', 'cmu:35_17', 'cmu:09_07', 'loop:Run_steady', 'mocap:sprint'],
};
// per family: cadence below the style's own speed ∝ (v / style)^beta (≥ lo), contact at most dMul × the model's (cap)
const PROC_FAMK = { walk: { beta: 0.45, lo: 0.5, dMul: 1.25, dCap: 0.75, ext: 0.5 }, run: { beta: 0.3, lo: 0.6, dMul: 9, dCap: 0.42, ext: 0.35 } };
// throttle % → speed (m/s), and the motion it picks: ≈ 15 walk, 25 jog, 50 run, 70+ sprint
const PROC_THR = [[0, 0], [5, 0.5], [10, 1.0], [15, 1.4], [20, 1.75], [25, 2.6], [40, 3.4], [50, 4.0], [70, 5.5], [100, 7.5]];
const PROC_WR = [1.8, 2.5];   // walk → run blend band (m/s of the motion)
// speed controller: gain 1/s, a floor (m/s²) eased out over the last ~0.25 m/s (finite time, no overshoot), braking and
// jerk limits; the acceleration limit falls with speed (a sprint start pushes hardest)
const PROC_DYN = { gain: 1.3, bias: 0.8, near: 3, acc0: 4.0, acc1: 1.5, dec: 3.5, jerk: 7, styleTau: 0.25, standTau: 0.45, boostTau: 0.35 };
const PROC_LEAN = { k: 1.3, min: -14, max: 32 };   // whole-body lean = k · atan(a / g), limited (°)
const procThrSpeed = (p) => tableLerp(PROC_THR, clamp(p, 0, 100));
let PROC = null;

function procRegister() {
  clips.push({ id: 'proc:ik', name: 'Procedural IK', label: 'Procedural IK locomotion · Throttle track (experiment)', kind: 'proc', c: { name: 'Procedural_IK', speed: 0, dir: 0, proc: true }, dur: 1, group: 'Procedural' });
}
function procNewAuto(n = 16) {   // a demo over n bars (1 bar = 1 s): stand → walk → jog (25 %) → run (70 %) → 40 % → stop
  const a = newAuto(n, n), k = n / 16;
  a.throttle = [[0, 0], [1, 0], [1.3, 12], [4, 12], [4.3, 25], [7, 25], [7.3, 70], [10, 70], [10.3, 40], [13, 40], [13.3, 0], [16, 0]].map(([t, v]) => ({ t: +(t * k).toFixed(3), v, k: 0 }));
  a.showMaster.thr = true; a.showMaster.run = true; a.procStop = 'run';
  return a;
}

// ---------------------------------------------------------------- training
// each clip is first made symmetric: the Symmetrize tool's "Phase matching + average arms" (left lands on the bar,
// the right half a cycle later; the arms mirror-averaged), on the clip as it comes (the user's own versions untouched)
function procSymBk(cl) {
  const set = { stMode: 'arms', stW: '100', stStart: 'L', stEase: '0', stRetime: true, stSwing: false, stEven: false };
  const keep = [];
  for (const [id, v] of Object.entries(set)) { const e = $(id); if (!e) continue; keep.push([e, e.type === 'checkbox' ? e.checked : e.value]); if (e.type === 'checkbox') e.checked = v; else e.value = v; }
  const kST = { clip: ST.clip, src: ST.src, res: ST.res };
  try { ST.clip = cl; ST.src = undefined; const r = stProcess(); return r && r.bk; }
  catch (err) { console.warn('procedural: symmetrize failed for', cl.id, err); return null; }
  finally { for (const [e, v] of keep) { if (e.type === 'checkbox') e.checked = v; else e.value = v; } Object.assign(ST, kST); }
}
function procTrainClip(cl) {
  const bk = procSymBk(cl), keepBk = BAKED[cl.id];
  if (bk) BAKED[cl.id] = bk;
  try { return procFit(cl, !!bk); } finally { if (keepBk) BAKED[cl.id] = keepBk; else delete BAKED[cl.id]; }
}
function procFit(cl, sym) {
  return withClip(cl, () => {
    const N = PROC_N, dur = cl.dur, v = cl.c.speed, fkv = new VirtualFK(rig), Q = new Float32Array(B * 4), H = V3();
    const fi = { L: boneIdx.get(rig.side.L.foot.name), R: boneIdx.get(rig.side.R.foot.name) };
    const fr = [];
    for (let k = 0; k < N; k++) { sampleClip((k / N) * dur, Q, H); fkv.run(Q, H, 0); fr.push({ q: Q.slice(), h: H.clone(), L: fkv.P[fi.L].clone(), R: fkv.P[fi.R].clone() }); }
    // contacts: the foot low and (in the world, the body travelling +z at v) nearly still; the longest run per leg
    const dt = dur / N, win = {};
    for (const Sd of ['L', 'R']) {
      const ymin = Math.min(...fr.map((f) => f[Sd].y));
      const c = fr.map((f, k) => { const a = fr[(k + N - 1) % N][Sd], b = fr[(k + 1) % N][Sd], vz = (b.z - a.z) / (2 * dt) + v, vx = (b.x - a.x) / (2 * dt); return f[Sd].y < ymin + 0.05 && Math.hypot(vz, vx) < Math.max(0.35, 0.22 * v); });
      let best = [0, 0];
      for (let s = 0; s < N; s++) { if (!c[s] || c[(s + N - 1) % N]) continue; let n = 0; while (n < N && c[(s + n) % N]) n++; if (n > best[1]) best = [s, n]; }
      win[Sd] = best;
    }
    const k0 = win.L[0], rot = (k) => fr[(k0 + k) % N];   // phase 0 = left touchdown
    const harm = (vals) => {   // vals[k] (3 comps) → [a0(3), a1(3), b1(3), …]
      const out = new Float32Array(3 * (1 + 2 * PROC_H));
      for (let k = 0; k < N; k++) for (let c = 0; c < 3; c++) {
        const x = vals[k * 3 + c]; out[c] += x / N;
        for (let h = 1; h <= PROC_H; h++) { const w = (TAU * h * k) / N; out[3 * (2 * h - 1) + c] += (2 / N) * x * Math.cos(w); out[3 * (2 * h) + c] += (2 / N) * x * Math.sin(w); }
      }
      return out;
    };
    const bones = [], qq = new THREE.Quaternion(), mi = new THREE.Quaternion(), r = V3(), vals = new Float32Array(N * 3);
    for (let i = 0; i < B; i++) {
      const qs = []; for (let k = 0; k < N; k++) qs.push(new THREE.Quaternion().fromArray(rot(k).q, i * 4));
      const m = meanQuat(qs); mi.copy(m).invert();
      let amp = 0;
      for (let k = 0; k < N; k++) { logQ(qq.copy(mi).multiply(qs[k]), r); vals[k * 3] = r.x; vals[k * 3 + 1] = r.y; vals[k * 3 + 2] = r.z; amp = Math.max(amp, r.length()); }
      bones.push({ m, f: amp > 0.2 * DEG ? harm(vals) : null });
    }
    const hm = V3(); for (let k = 0; k < N; k++) hm.add(rot(k).h); hm.divideScalar(N);
    for (let k = 0; k < N; k++) { const h = rot(k).h; vals[k * 3] = h.x - hm.x; vals[k * 3 + 1] = h.y - hm.y; vals[k * 3 + 2] = h.z - hm.z; }
    const f = 1 / dur;
    return { id: cl.id, sym, v, f, stride: v / f, bones, hm, hf: harm(vals), dutyL: win.L[1] / N, offR: mod1((win.R[0] - k0) / N), dutyR: win.R[1] / N };
  });
}
function procModel() {
  if (PROC && PROC.model) return PROC.model;
  const keep = cur, model = {};
  try {
    for (const fam of ['walk', 'run']) {
      model[fam] = PROC_FAM[fam].map((id) => clips.find((c) => c.id === id)).filter(Boolean).map(procTrainClip).sort((a, b) => a.v - b.v);
      if (!model[fam].length) return null;
    }
  } finally { cur = keep; }
  PROC = PROC || {}; PROC.model = model;
  return model;
}

// ---------------------------------------------------------------- the gait: the motions (weights) at a speed (v)
// The throttle picks the motion: every trained clip (and standing) is an entry with a weight; the throttle's speed
// sets target weights (its one or two clips around that speed), and each weight eases to its target on its own, so
// a big throttle change cross-fades straight from the current motion to the new one (nothing in between gets any).
// The real speed v sets the cadence and stride inside that motion: slower than the motion, a lower cadence, longer
// contacts and smaller steps (down to its mean pose at 0); faster, a higher cadence and shorter contacts (each leg's
// phase is warped, so the planted foot keeps pace with the ground and the leg needs no longer reach).
function procEntries() {
  if (PROC.entries) return PROC.entries;
  const M = procModel(), E = [];
  const w0 = M.walk[0];
  E.push({ stand: true, fam: 'walk', c: w0, v: 0.3, f: w0.f * PROC_FAMK.walk.lo, ms: w0.stride, K: PROC_FAMK.walk });
  for (const fam of ['walk', 'run']) for (const c of M[fam]) E.push({ fam, c, v: c.v, f: c.f, ms: c.stride, K: PROC_FAMK[fam] });
  PROC.entries = E; return E;
}
function procTargetW(sT, out) {   // the entries' target weights for a throttle speed
  const E = procEntries(); out.fill(0);
  const iW = E.map((e, i) => (!e.stand && e.fam === 'walk' ? i : -1)).filter((i) => i >= 0), iR = E.map((e, i) => (e.fam === 'run' ? i : -1)).filter((i) => i >= 0);
  const famW = (ids, s, o, k) => {   // the two clips of a family around s (the end one outside), × k
    if (s <= E[ids[0]].v) { o[ids[0]] += k; return; }
    const z = ids[ids.length - 1]; if (s >= E[z].v) { o[z] += k; return; }
    let j = 0; while (E[ids[j + 1]].v < s) j++;
    const u = (s - E[ids[j]].v) / (E[ids[j + 1]].v - E[ids[j]].v); o[ids[j]] += k * (1 - u); o[ids[j + 1]] += k * u;
  };
  if (sT < 0.3) { const u = sstep(0.1, 0.3, sT); out[0] = 1 - u; if (u > 0) famW(iW, sT, out, u); return out; }
  const wr = sstep(PROC_WR[0], PROC_WR[1], sT);
  if (wr < 1) famW(iW, sT, out, 1 - wr);
  if (wr > 0) famW(iR, sT, out, wr);
  return out;
}
// v: real speed · Wt: entry weights · len: step length × (hard × natural) · cad: cycle speed × · gnd: + contact
function procGait(v, Wt, len = 1, cad = 1, gnd = 0) {
  const E = procEntries();
  if (!Wt || typeof Wt === 'number') Wt = procTargetW(Wt == null ? v : Wt, new Float32Array(E.length));
  const vb = v / Math.max(1e-3, len * cad);
  let f = 0, sw = 0;
  const act = [];
  for (let i = 0; i < E.length; i++) {
    const w = Wt[i]; if (w < 1e-4) continue;
    const e = E[i], x = vb / e.v, rho = x <= 1 ? Math.max(e.K.lo, Math.pow(x, e.K.beta)) : Math.min(1.6, Math.pow(x, e.K.ext));
    f += w * e.f * rho; sw += w; act.push({ e, w });
  }
  f = (f / Math.max(sw, 1e-6)) * cad;
  const stride = v / f, g = { v, f, act, wRun: 0, dutyL: 0, dutyR: 0, dL: 0, dR: 0, offR: 0, amp: 0, boost: 0, armK: 1, hipK: 1, fwd: 1 };
  for (const a of act) {
    const e = a.e, c = e.c, ratio = Math.max(1e-4, stride / e.ms), w = a.w / sw;
    a.w = w;
    for (const Sd of ['L', 'R']) {
      const d = c['duty' + Sd], dMax = Math.max(d, Math.min(d * e.K.dMul, e.K.dCap)), dO = clamp(d / ratio, 0.06, dMax);
      a['amp' + Sd] = e.stand ? 0 : Math.min(1, (ratio * dO) / d);
      g['duty' + Sd] += w * d; g['d' + Sd] += w * dO;
    }
    a.amp = Math.min(a.ampL, a.ampR); g.offR += w * c.offR; g.amp += w * a.amp;
    if (e.fam === 'run') g.wRun += w;
  }
  g.dL = clamp(g.dL + gnd, 0.06, 0.85); g.dR = clamp(g.dR + gnd, 0.06, 0.85);
  return g;
}
const _pcs = new Float64Array(2 * PROC_H + 1), _pcsL = new Float64Array(2 * PROC_H + 1), _pcsR = new Float64Array(2 * PROC_H + 1), _pq = new THREE.Quaternion(), _pq2 = new THREE.Quaternion(), _pq3 = new THREE.Quaternion(), _pr = V3(), _pr2 = V3();
function procHarm(c, amp, out, cs = _pcs) {   // a Fourier set at a phase (its cos / sin table), harmonics × amp
  out.set(c[0], c[1], c[2]);
  for (let j = 1; j <= 2 * PROC_H; j++) { const w = cs[j] * amp; out.x += c[3 * j] * w; out.y += c[3 * j + 1] * w; out.z += c[3 * j + 2] * w; }
  return out;
}
function procBone(c, i, out, cs, amp) {   // one bone of a trained clip: mean · exp(Fourier · amp)
  const bn = c.bones[i];
  out.copy(bn.m);
  if (bn.f) { procHarm(bn.f, amp, _pr, cs); out.multiply(expV(_pr.x, _pr.y, _pr.z, _pq3)); }
  return out;
}
function procCS(cs, p) { for (let h = 1; h <= PROC_H; h++) { cs[2 * h - 1] = Math.cos(TAU * h * p); cs[2 * h] = Math.sin(TAU * h * p); } return cs; }
function procWarp(x, dOut, dIn) {   // a leg's own phase (0 = its touchdown): output → model (contact dOut ↔ dIn)
  return x < dOut ? (x / dOut) * dIn : dIn + ((x - dOut) / (1 - dOut)) * (1 - dIn);
}
function procGroups() {   // bone index → 1 left leg, 2 right leg (thigh and below), 3 arms (collarbone and below), 4 the pelvis, 0 the rest
  if (PROC.groups && PROC.groups.rig === rig) return PROC.groups.m;
  const m = new Int8Array(B), mark = (o, v) => o.traverse((x) => { if (x.isBone && boneIdx.has(x.name)) m[boneIdx.get(x.name)] = v; });
  mark(rig.side.L.thigh, 1); mark(rig.side.R.thigh, 2);
  for (const Sd of ['L', 'R']) mark(rig.side[Sd].clav || rig.side[Sd].upper, 3);
  m[boneIdx.get(rig.b.hips.name)] = 4;
  PROC.groups = { rig, m }; return m;
}
function procPose(g, ph, Q, H) {   // the pose for gait g at phase ph (in place, facing +z): the entries blended
  const p = mod1(ph), gm = procGroups();
  procCS(_pcs, p);
  procCS(_pcsL, mod1(procWarp(p, g.dL, g.dutyL)));
  procCS(_pcsR, mod1(g.offR + procWarp(mod1(p - g.offR), g.dR, g.dutyR)));
  const ampOf = (a, grp) => grp === 1 ? a.ampL : grp === 2 ? a.ampR : grp === 3 ? Math.max(a.amp, a.e.stand ? 0 : g.boost) * g.armK : grp === 4 ? a.amp * g.hipK : Math.max(a.amp, a.e.stand ? 0 : g.boost);
  for (let i = 0; i < B; i++) {
    const grp = gm[i], cs = grp === 1 ? _pcsL : grp === 2 ? _pcsR : _pcs;
    let acc = 0;
    for (const a of g.act) {
      procBone(a.e.c, i, acc ? _pq2 : _pq, cs, ampOf(a, grp));
      if (acc) { const q = _pq2; if (_pq.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w); _pq.slerp(q, a.w / (acc + a.w)); }
      acc += a.w;
    }
    Q[i * 4] = _pq.x; Q[i * 4 + 1] = _pq.y; Q[i * 4 + 2] = _pq.z; Q[i * 4 + 3] = _pq.w;
  }
  H.set(0, 0, 0);
  for (const a of g.act) H.addScaledVector(V3().copy(a.e.c.hm).add(procHarm(a.e.c.hf, a.amp * g.hipK, _pr)), a.w);
  return H;
}
// leg phase: 0 = this leg's touchdown; → { c, u: contact progress, s: swing progress }
function procLegPhase(Sd, g, ph) {
  const d = Sd === 'L' ? g.dL : g.dR, x = mod1(ph - (Sd === 'L' ? 0 : g.offR));
  return x < d ? { c: true, u: x / d, s: 0 } : { c: false, u: 0, s: (x - d) / (1 - d) };
}

// ---------------------------------------------------------------- the run controls on a procedural motion
// speed: step length (hard × natural) and cycle speed scale the speed inside the motion the throttle picked; forward
// travel scales the ground covered (0 = on the spot); foot on ground lengthens / shortens the contacts.
// pose: arm swing, hip motion (Fourier amplitudes), spine lean, hip rotation, knee depth, jump, elbow / cross / centre
const procTr = (k, ref, t) => (A[k] ? evalPts(A[k], t) : ref);
function procMods(t) {
  return { len: clamp(procTr('stride', 100, t) / 100, 0.3, 1.6) * clamp(procTr('stepNat', 100, t) / 100, 0.3, 1.6), cad: clamp(procTr('cyc', 100, t) / 100, 0.25, 4),
    fwd: clamp(procTr('fwd', 100, t) / 100, 0, 1), gnd: clamp(procTr('gnd', 0, t), -GND_MAX, GND_MAX) / 100,
    armK: Math.max(0, procTr('armSwing', 100, t) / 100), hipK: Math.max(0, procTr('hipMotion', 100, t) / 100) };
}
function procPlanKey() { return JSON.stringify([A.throttle, A.stride, A.stepNat, A.cyc, A.fwd, A.gnd, A.armSwing, A.hipMotion, A.procStop || 'run', S.dur]); }

// ---------------------------------------------------------------- the plan (speed, motion, travel, phase, footprints)
// built at 240 Hz over the timeline from the Throttle track and the run controls; kept until one of them changes
function procFootFK(g, ph, out) {   // the model's feet → out.L / out.R, in place (reach × forward travel about the hips)
  const P = PROC.planQ || (PROC.planQ = new Float32Array(B * 4)), fkv = PROC.planFK || (PROC.planFK = new VirtualFK(rig));
  const H = procPose(g, ph, P, V3()); fkv.run(P, H, 0);
  const hp = fkv.P[boneIdx.get(rig.b.hips.name)];
  for (const Sd of ['L', 'R']) { const f = fkv.P[boneIdx.get(rig.side[Sd].foot.name)].clone(); f.z = hp.z + (f.z - hp.z) * g.fwd; out['u' + Sd] = f.clone(); out[Sd] = f; }
  return out;
}
function procPlan() {
  if (!procModel()) return null;
  const key = procPlanKey();
  if (PROC.plan && PROC.plan.key === key) return PROC.plan;
  PROC.plans = PROC.plans || new Map();
  if (PROC.plans.has(key)) return (PROC.plan = PROC.plans.get(key));
  const hz = 240, n = Math.max(2, Math.ceil(S.dur * hz) + 1), dt = S.dur / (n - 1), D = PROC_DYN, stop = A.procStop || 'run';
  const F32 = () => new Float32Array(n);
  const V = F32(), Ac = F32(), X = new Float64Array(n), PH = new Float64Array(n), VT = F32(), SS = F32(), LEN = F32(), CAD = F32(), FW = F32(), GN = F32(), AK = F32(), HK = F32(), BO = F32();
  const m0 = procMods(0), vt0 = procThrSpeed(evalPts(A.throttle, 0));
  let v = vt0 * m0.len * m0.cad, a = 0, x = 0, ph = 0, s = vt0, held = vt0;   // starts steady at the first throttle value
  const kS = 1 - Math.exp(-dt / D.styleTau), kS0 = 1 - Math.exp(-dt / D.standTau), kB = 1 - Math.exp(-dt / D.boostTau);
  let bo = 0;
  const nE = procEntries().length, wT = new Float32Array(nE), wC = new Float32Array(nE), WE = new Float32Array(n * nE);
  for (let i = 0; i < n; i++) {
    const t = i * dt, vt = procThrSpeed(evalPts(A.throttle, t)), m = procMods(t), vT = vt * m.len * m.cad;
    // the motion: straight to the throttle's own; to a stop, the one it ran (Run to stop) or a walk once below 2.2
    // m/s (Walk out), standing once nearly still
    // (a throttle ramp down to 0 is a stop all the way: the motion is not stepped down through its in-between values)
    const toStop = procThrSpeed(evalPts(A.throttle, Math.min(S.dur, t + 0.5))) <= 0.05 && vt < held;
    let sT;
    if (vt > 0.05 && !toStop) { sT = vt; held = vt; }
    else if (v > 0.35) sT = stop === 'walk' && v < 2.2 ? Math.min(held, 1.4) : held;
    else sT = 0;
    procTargetW(sT, wT);
    if (i > 0) {
      const k = sT < 0.3 ? kS0 : kS;   // (into the standing pose more slowly)
      for (let e = 0; e < nE; e++) wC[e] += (wT[e] - wC[e]) * k;
      s += (sT - s) * k;
      bo += (clamp(a / 2.5, 0, 1) - bo) * kB;
      const e = vT - v, accMax = lerp(D.acc0, D.acc1, clamp(v / 7.5, 0, 1));
      const aCmd = clamp(D.gain * e + Math.sign(e) * Math.min(D.bias, D.near * Math.abs(e)), -D.dec, accMax);
      a += clamp(aCmd - a, -D.jerk * dt, D.jerk * dt);
      v += a * dt; if (v <= 0) { v = 0; if (a < 0) a = 0; }
      x += v * m.fwd * dt; ph += procGait(v, wC, m.len, m.cad, m.gnd).f * dt;
    } else { s = sT; wC.set(wT); }
    WE.set(wC, i * nE);
    V[i] = v; Ac[i] = a; X[i] = x; PH[i] = ph; VT[i] = vT; SS[i] = s; BO[i] = bo; LEN[i] = m.len; CAD[i] = m.cad; FW[i] = m.fwd; GN[i] = m.gnd; AK[i] = m.armK; HK[i] = m.hipK;
  }
  const pl = { key, n, dt, V, Ac, X, PH, VT, SS, LEN, CAD, FW, GN, AK, HK, BO, WE, nE };
  // footprints: at each touchdown the model's foot where it lands (with the travel so far). The swing follows the
  // model's foot plus a gap going from the one at lift-off (planted spot − model foot) to the next touchdown's (0)
  const prints = { L: [], R: [] }, ff = {}, prev = { L: null, R: null };
  for (let i = 0; i < n; i++) {
    const g = procGaitAt(procStateAt(pl, i));
    for (const Sd of ['L', 'R']) {
      const c = procLegPhase(Sd, g, PH[i]).c;
      if (c && !prev[Sd]) {
        procFootFK(g, PH[i], ff);
        prints[Sd].push({ t0: i * dt, t1: S.dur + 1, p: ff[Sd].clone().add(V3(0, 0, X[i])), err: V3(), errTd: V3() });
      }
      if (!c && prev[Sd] && prints[Sd].length) {
        const fp = prints[Sd][prints[Sd].length - 1]; fp.t1 = i * dt; procFootFK(g, PH[i], ff);
        fp.err.copy(fp.p).sub(ff['u' + Sd]); fp.err.z -= X[i]; fp.err.y = 0;
      }
      prev[Sd] = c;
    }
  }
  pl.prints = prints;
  PROC.plan = pl;
  PROC.plans.set(key, pl); if (PROC.plans.size > 6) PROC.plans.delete(PROC.plans.keys().next().value);
  return pl;
}
const PROC_KEYS = ['V', 'Ac', 'X', 'PH', 'VT', 'SS', 'LEN', 'CAD', 'FW', 'GN', 'AK', 'HK', 'BO'];
function procStateAt(pl, i) { const o = {}; for (const k of PROC_KEYS) o[k] = pl[k][i]; o.W = pl.WE.subarray(i * pl.nE, (i + 1) * pl.nE); return o; }
function procState(t) {   // → the plan's values at timeline time t (V speed, Ac accel, X travel, PH phase, VT target, SS motion …)
  const pl = procPlan(); if (!pl) return { V: 0, Ac: 0, X: 0, PH: 0, VT: 0, SS: 0, LEN: 1, CAD: 1, FW: 1, GN: 0, AK: 1, HK: 1, BO: 0, v: 0, a: 0, x: 0, ph: 0, vt: 0 };
  const f = clamp(t / pl.dt, 0, pl.n - 1), i = Math.min(Math.floor(f), pl.n - 2), u = f - i, o = {};
  for (const k of PROC_KEYS) o[k] = lerp(pl[k][i], pl[k][i + 1], u);
  o.W = new Float32Array(pl.nE); for (let e = 0; e < pl.nE; e++) o.W[e] = lerp(pl.WE[i * pl.nE + e], pl.WE[(i + 1) * pl.nE + e], u);
  o.v = o.V; o.a = o.Ac; o.x = o.X; o.ph = o.PH; o.vt = o.VT;
  return o;
}
function procGaitAt(st) {
  const g = procGait(st.V, st.W || st.SS, st.LEN, st.CAD, st.GN);
  g.boost = st.BO; g.armK = st.AK; g.hipK = st.HK; g.fwd = st.FW;   // hard acceleration: full arm and trunk drive, however short the steps
  return g;
}
function procPrintIx(Sd, t) {   // index of the footprint in use at t (the last touchdown at or before t), −1 before the first
  const arr = PROC.plan.prints[Sd]; let lo = 0, hi = arr.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].t0 <= t + 1e-9) { r = m; lo = m + 1; } else hi = m - 1; }
  return r;
}
function procPrint(Sd, t) { const i = procPrintIx(Sd, t); return i >= 0 ? PROC.plan.prints[Sd][i] : null; }
function procTravel(t, out = V3()) { return out.set(0, 0, procState(t).X); }
function procSample(t, Q, H) { const st = procState(t); procPose(procGaitAt(st), st.PH, Q, H); }
function procContact(Sd, t) { const st = procState(t); return procLegPhase(Sd, procGaitAt(st), st.PH).c; }

// ---------------------------------------------------------------- the pose at t
const PQ = { v: null };
function procEvaluate(t) {
  if (!procPlan()) { applyPose(Qi[0], Hi); return; }
  if (!PQ.v) PQ.v = new Float32Array(B * 4);
  const st = procState(t), g = procGaitAt(st), H = procPose(g, st.PH, PQ.v, V3());
  const shown = shownTravel(t, V3()), toShown = shown.clone().sub(V3(0, 0, st.X));   // true (planned) world → shown
  applyPose(PQ.v, H.clone().add(shown));
  const b = rig.b, hp0 = worldP(b.hips);
  const fkRef = {};
  for (const Sd of ['L', 'R']) {
    const sd = rig.side[Sd], footFK = worldP(sd.foot), footU = footFK.clone(); footU.z = hp0.z + (footU.z - hp0.z) * g.fwd;
    fkRef[Sd] = { foot: footU, footU, footQ: rig.delta(sd.foot), hip: worldP(sd.thigh), knee: worldP(sd.shin), footFK, thighQ: rig.delta(sd.thigh), shinQ: rig.delta(sd.shin) };
  }
  // the body: lean with the acceleration (whole-body lean k · atan(a / g): 30 % in the pelvis, the rest up the
  // spine, the head keeps part of its level), plus the Spine lean and Hip rotation run controls
  const lean = clamp(Math.atan2(st.Ac, 9.81) * PROC_LEAN.k, PROC_LEAN.min * DEG, PROC_LEAN.max * DEG);
  const uLean = procTr('lean', 0, t) * DEG, hRot = procTr('hipRot', 0, t) * DEG;
  if (Math.abs(lean) + Math.abs(uLean) + Math.abs(hRot) > 1e-5) {
    rotateBoneWorld(b.hips, qAxis(AX, lean * 0.3 + hRot));
    spreadOver([b.spine, b.spine1, b.spine2], qAxis(AX, lean * 0.7 + uLean));
    spreadOver([b.neck, b.head], qAxis(AX, -(lean + uLean + hRot) * 0.4));
  }
  // knee depth: the hips down (+) / up (−), 7 cm per 100 % · jump: the hips rise in the flight (6 cm at 100 %)
  const kd = (procTr('kneeDepth', 100, t) / 100 - 1) * 0.07;
  let fly = 1; const lps = {};
  for (const Sd of ['L', 'R']) { lps[Sd] = procLegPhase(Sd, g, st.PH); fly = Math.min(fly, lps[Sd].c ? 0 : Math.sin(Math.PI * lps[Sd].s)); }
  const lift = Math.max(0, procTr('jump', 0, t)) / 100 * JUMPK.cmAt100 / 100 * fly;
  if (Math.abs(kd) > 1e-5 || lift > 1e-5) { rig.setHipsWorld(worldP(b.hips).add(V3(0, lift - kd, 0))); b.hips.updateMatrixWorld(true); }
  // leg targets: planted on the footprint, or swinging toward the next one
  const legT = {};
  for (const Sd of ['L', 'R']) {
    const fr = fkRef[Sd], lp = lps[Sd], ix = procPrintIx(Sd, t), arr = PROC.plan.prints[Sd], fp = ix >= 0 ? arr[ix] : null;
    let target;
    // planted or not is the plan's call (its touchdown / lift-off times); the phase only says how far the swing is
    // (in the moment the two disagree, right at a touchdown or lift-off, the swing is at its end or its start)
    if (fp && t < fp.t1) target = V3(fp.p.x, fr.foot.y, fp.p.z).add(toShown);
    else {
      const next = arr[ix + 1], e1 = next ? next.errTd : V3(), e0 = fp ? fp.err : e1, sw = !lp.c ? lp.s : lp.u > 0.5 ? 0 : 1;
      const gap = e0.clone().lerp(e1, smooth(clamp(sw / 0.6, 0, 1)));   // (gone by 60 % of the swing)
      // the gap never takes the foot further from the hip than the model's own foot is (or 98.5 % of the leg): a
      // trailing leg is not pulled straight
      const hip = worldP(rig.side[Sd].thigh), d0 = fr.footU.clone().sub(hip), Lm = Math.max(d0.length(), (rig.side[Sd].leg.l1 + rig.side[Sd].leg.l2) * 0.985);
      const qa = gap.lengthSq(), qb = 2 * d0.dot(gap), qc = d0.lengthSq() - Lm * Lm;
      let al = 1; if (qa > 1e-10 && (d0.clone().add(gap)).lengthSq() > Lm * Lm) al = clamp((-qb + Math.sqrt(Math.max(0, qb * qb - 4 * qa * qc))) / (2 * qa), 0, 1);
      target = fr.footU.clone().addScaledVector(gap, lerp(1, al, smooth(clamp(sw / 0.25, 0, 1))));   // (eased in over the first quarter: no step at lift-off)
      target.y += lift - kd;   // a swinging foot goes up / down with the hips
    }
    // a trailing leg never locks straight: late in the contact and early in the swing, a foot further than 99 % of
    // the leg from the hip rises (the heel comes up, as at toe-off) instead; the planted spot is kept
    { const planted = !!(fp && t < fp.t1), sw = !lp.c ? lp.s : lp.u > 0.5 ? 0 : 1;
      const wl = planted ? smoothB((lp.u - 0.3) / 0.3) : 1 - smoothB((sw - 0.3) / 0.3);
      if (wl > 1e-4) {
        const hip = worldP(rig.side[Sd].thigh), Lc = (rig.side[Sd].leg.l1 + rig.side[Sd].leg.l2) * 0.99, dx = target.x - hip.x, dz = target.z - hip.z, h2 = dx * dx + dz * dz;
        if (h2 < Lc * Lc) { const yMax = hip.y - Math.sqrt(Lc * Lc - h2); if (target.y < yMax) target.y = lerp(target.y, yMax, wl); }
      } }
    legT[Sd] = { target, lp, planted: !!(fp && t < fp.t1) };
  }
  PROC.dbg = legT;
  // the pelvis comes down just enough that a planted foot stays reachable
  let drop = 0;
  for (const Sd of ['L', 'R']) {
    const l = legT[Sd]; if (!l.planted) continue;
    const leg = rig.side[Sd].leg, reach = (leg.l1 + leg.l2) * 0.985, h = worldP(rig.side[Sd].thigh).sub(l.target), hz2 = h.x * h.x + h.z * h.z;
    if (h.lengthSq() > reach * reach && hz2 < reach * reach) drop = Math.max(drop, Math.min(smoothB(l.lp.u / 0.12), smoothB((1 - l.lp.u) / 0.3)) * (h.y - Math.sqrt(reach * reach - hz2)));
  }
  PROC.dbgDrop = drop;
  if (drop > 1e-5) { rig.setHipsWorld(worldP(b.hips).add(V3(0, -Math.min(drop, 0.12), 0))); b.hips.updateMatrixWorld(true); }
  // two-bone IK: the knee in the model's own knee plane, the model's thigh / shin twist kept, the foot's world turn kept
  for (const Sd of ['L', 'R']) {
    const sd = rig.side[Sd], fr = fkRef[Sd], target = legT[Sd].target, hip = worldP(sd.thigh);
    const mid = hip.clone().add(target).multiplyScalar(0.5);
    const kv = fr.knee.clone().sub(fr.hip.clone().add(fr.footFK).multiplyScalar(0.5)), kl = kv.length();
    const pole = mid.clone().addScaledVector(kl > 0.005 ? kv.divideScalar(kl) : V3(0, 0, 1), 0.5);
    const r = ikLimb(sd.leg, hip, target, pole, V3(0, 0, 1));
    rig.setDelta(sd.thigh, r.d1); rig.setDelta(sd.shin, r.d2); sd.thigh.updateMatrixWorld(true);
    const kP = worldP(sd.shin), fP = worldP(sd.foot), hP = worldP(sd.thigh);
    const s1 = new THREE.Quaternion().setFromUnitVectors(fr.knee.clone().sub(fr.hip).normalize(), kP.clone().sub(hP).normalize());
    const s2 = new THREE.Quaternion().setFromUnitVectors(fr.footFK.clone().sub(fr.knee).normalize(), fP.clone().sub(kP).normalize());
    rig.setDelta(sd.thigh, s1.multiply(fr.thighQ)); rig.setDelta(sd.shin, s2.multiply(fr.shinQ));
    rig.setDelta(sd.foot, fr.footQ);
  }
  // arm shape run controls (elbow bend, arm crossing, swing centre), as on a clip
  applyArmShapeV(procTr('elbowBend', 0, t), procTr('armCross', 0, t), procTr('armCentre', 0, t));
  model.updateMatrixWorld(true);
}
// a short read-out for the status line
function procMotionName(g) { let best = null; for (const a of g.act) if (!best || a.w > best.w) best = a; return !best ? '' : best.e.stand ? 'stand' : ((clips.find((c) => c.id === best.e.c.id) || {}).name || best.e.c.id); }
function procReadout(t) { const st = procState(t), g = procGaitAt(st); return `${st.V.toFixed(2)} m/s → ${st.VT.toFixed(2)} · ${procMotionName(g)} motion · ${Math.round(g.f * 120)} steps/min${Math.abs(st.Ac) > 0.15 ? (st.Ac > 0 ? ' · accelerating' : ' · decelerating') : ''}`; }
// the Throttle row: how a full stop is made
function procStopUI(r) {
  if (!r || !r.h) return;
  const sel = document.createElement('select'); sel.className = 'procstop'; sel.title = 'Throttle to 0: keep the motion until stopped (Run to stop) or change to a walk below 2.2 m/s (Walk out)';
  sel.innerHTML = '<option value="run">Stop: run</option><option value="walk">Stop: walk out</option>';
  sel.value = A.procStop || 'run';
  sel.onclick = (e) => e.stopPropagation(); sel.onpointerdown = (e) => e.stopPropagation();
  sel.onchange = () => { pushUndo(); A.procStop = sel.value; rebuildSpeedLUT(); editVersion++; save(); };
  if (getComputedStyle(r.lane).position === 'static') r.lane.style.position = 'relative';
  r.lane.append(sel);   // (top-right of the lane: the header is narrow)
}
