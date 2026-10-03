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
  run: ['cmu:16_35', 'cmu:35_17', 'cmu:09_07', 'loop:Run_steady'],   // (faster: Run steady's stride grows, cadence ∝ √v)
};
// throttle % → target speed (m/s): ≈ 15 walk, 25 jog, 50 run, 100 the fastest trained run
const PROC_THR = [[0, 0], [5, 0.5], [10, 1.0], [15, 1.4], [20, 1.75], [25, 2.6], [40, 3.4], [50, 4.0], [70, 5.2], [100, 6.6]];
const PROC_WR = [1.8, 2.5];   // walk → run blend band (m/s)
const PROC_DYN = { gain: 1.3, bias: 0.8, near: 3, acc: 2.6, dec: 3.2, jerk: 6 };   // 1/s, m/s² (a floor, eased out over the last ~0.25 m/s: the target is reached in finite time, no overshoot), 1/s, m/s², m/s², m/s³
const procThrSpeed = (p) => tableLerp(PROC_THR, clamp(p, 0, 100));
let PROC = null;

function procRegister() {
  clips.push({ id: 'proc:ik', name: 'Procedural IK', label: 'Procedural IK locomotion · Throttle track (experiment)', kind: 'proc', c: { name: 'Procedural_IK', speed: 0, dir: 0, proc: true }, dur: 1, group: 'Procedural' });
}
function procNewAuto(n = 16) {   // a demo over n bars (1 bar = 1 s): stand → walk → jog (25 %) → run (70 %) → 40 % → stop
  const a = newAuto(n, n), k = n / 16;
  a.throttle = [[0, 0], [1, 0], [2, 12], [4, 12], [4.5, 25], [7, 25], [7.5, 70], [10, 70], [10.5, 40], [13, 40], [13.5, 0], [16, 0]].map(([t, v]) => ({ t: +(t * k).toFixed(3), v, k: 0 }));
  a.showMaster.thr = true;
  return a;
}

// ---------------------------------------------------------------- training
function procTrainClip(cl) {
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
    return { id: cl.id, v, f, stride: v / f, bones, hm, hf: harm(vals), dutyL: win.L[1] / N, offR: mod1((win.R[0] - k0) / N), dutyR: win.R[1] / N };
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

// ---------------------------------------------------------------- the gait at a speed
// each family: the two trained clips around v (u between them); outside the trained range the nearest one,
// its cadence scaled. stride = v / cadence; slower than the clip: smaller motion (amp); faster: longer reach (k)
function procFamCadence(F, v) {
  const a = F[0], z = F[F.length - 1];
  if (v <= a.v) return { i0: 0, i1: 0, u: 0, f: a.f * Math.max(0.5, Math.pow(Math.max(v, 1e-4) / a.v, 0.45)), ms: a.stride };
  if (v >= z.v) return { i0: F.length - 1, i1: F.length - 1, u: 0, f: z.f * Math.pow(v / z.v, 0.5), ms: z.stride };
  let i = 0; while (F[i + 1].v < v) i++;
  const u = (v - F[i].v) / (F[i + 1].v - F[i].v);
  return { i0: i, i1: i + 1, u, f: lerp(F[i].f, F[i + 1].f, u), ms: lerp(F[i].stride, F[i + 1].stride, u) };
}
function procGait(v) {
  const M = procModel(), wRun = sstep(PROC_WR[0], PROC_WR[1], v);
  const W = procFamCadence(M.walk, v), R = procFamCadence(M.run, v);
  const f = lerp(W.f, R.f, wRun), stride = v / f;
  for (const [g, F] of [[W, M.walk], [R, M.run]]) {
    const ratio = stride / g.ms;
    g.amp = Math.min(1, ratio); g.k = clamp(Math.max(1, ratio), 1, 1.35);
    const a = F[g.i0], b = F[g.i1];
    g.dutyL = lerp(a.dutyL, b.dutyL, g.u); g.dutyR = lerp(a.dutyR, b.dutyR, g.u); g.offR = lerp(a.offR, b.offR, g.u);
  }
  const k = lerp(W.k, R.k, wRun), dutyL = lerp(W.dutyL, R.dutyL, wRun), dutyR = lerp(W.dutyR, R.dutyR, wRun);
  // a longer stride than the model's: the same foot sweep, a shorter contact (and a longer flight), as runners do —
  // each leg's phase is warped (the model's contact played k× faster), so the planted foot keeps pace with the ground
  return { v, f, wRun, W, R, k, dutyL, dutyR, dL: dutyL / k, dR: dutyR / k, offR: lerp(W.offR, R.offR, wRun) };
}
const _pcs = new Float64Array(2 * PROC_H + 1), _pcsL = new Float64Array(2 * PROC_H + 1), _pcsR = new Float64Array(2 * PROC_H + 1), _pq = new THREE.Quaternion(), _pq2 = new THREE.Quaternion(), _pq3 = new THREE.Quaternion(), _pr = V3(), _pr2 = V3();
function procHarm(c, amp, out, cs = _pcs) {   // a Fourier set at a phase (its cos / sin table), harmonics × amp
  out.set(c[0], c[1], c[2]);
  for (let j = 1; j <= 2 * PROC_H; j++) { const w = cs[j] * amp; out.x += c[3 * j] * w; out.y += c[3 * j + 1] * w; out.z += c[3 * j + 2] * w; }
  return out;
}
function procFamBone(F, g, i, out, cs) {   // one bone of a family at the gait's speed (two clips blended)
  const a = F[g.i0].bones[i], b = F[g.i1].bones[i];
  out.copy(a.m); if (g.u > 0 && a !== b) out.slerp(b.m, g.u);
  _pr.set(0, 0, 0);
  if (a.f) procHarm(a.f, g.amp, _pr, cs);
  if (g.u > 0 && a !== b) { _pr2.set(0, 0, 0); if (b.f) procHarm(b.f, g.amp, _pr2, cs); _pr.lerp(_pr2, g.u); }
  return out.multiply(expV(_pr.x, _pr.y, _pr.z, _pq3));
}
function procFamHips(F, g, out) {
  const a = F[g.i0], b = F[g.i1];
  out.copy(a.hm).add(procHarm(a.hf, g.amp, _pr));
  if (g.u > 0 && a !== b) out.lerp(_pr2.copy(b.hm).add(procHarm(b.hf, g.amp, V3())), g.u);
  return out;
}
function procCS(cs, p) { for (let h = 1; h <= PROC_H; h++) { cs[2 * h - 1] = Math.cos(TAU * h * p); cs[2 * h] = Math.sin(TAU * h * p); } return cs; }
function procWarp(x, dOut, dIn) {   // a leg's own phase (0 = its touchdown): output → model (contact dOut ↔ dIn)
  return x < dOut ? (x / dOut) * dIn : dIn + ((x - dOut) / (1 - dOut)) * (1 - dIn);
}
function procLegMap() {   // bone index → 1 left leg, 2 right leg (thigh and below), 0 the rest
  if (PROC.legMap && PROC.legMap.rig === rig) return PROC.legMap.m;
  const m = new Int8Array(B); ['L', 'R'].forEach((Sd, j) => rig.side[Sd].thigh.traverse((o) => { if (o.isBone && boneIdx.has(o.name)) m[boneIdx.get(o.name)] = j + 1; }));
  PROC.legMap = { rig, m }; return m;
}
function procPose(g, ph, Q, H) {   // the model's pose at gait g and phase ph (in place, facing +z)
  const M = procModel(), p = mod1(ph), lm = procLegMap();
  procCS(_pcs, p);
  procCS(_pcsL, mod1(procWarp(p, g.dL, g.dutyL)));
  procCS(_pcsR, mod1(g.offR + procWarp(mod1(p - g.offR), g.dR, g.dutyR)));
  const wr = g.wRun;
  for (let i = 0; i < B; i++) {
    const cs = lm[i] === 1 ? _pcsL : lm[i] === 2 ? _pcsR : _pcs;
    if (wr < 1) procFamBone(M.walk, g.W, i, _pq, cs);
    if (wr > 0) { procFamBone(M.run, g.R, i, _pq2, cs); if (wr < 1) _pq.slerp(_pq2, wr); else _pq.copy(_pq2); }
    Q[i * 4] = _pq.x; Q[i * 4 + 1] = _pq.y; Q[i * 4 + 2] = _pq.z; Q[i * 4 + 3] = _pq.w;
  }
  const hw = V3(), hr = V3();
  if (wr < 1) procFamHips(M.walk, g.W, hw);
  if (wr > 0) procFamHips(M.run, g.R, hr);
  H.copy(wr <= 0 ? hw : wr >= 1 ? hr : hw.lerp(hr, wr));
  return H;
}
// leg phase: 0 = this leg's touchdown; → { c, u: contact progress, s: swing progress }
function procLegPhase(Sd, g, ph) {
  const d = Sd === 'L' ? g.dL : g.dR, x = mod1(ph - (Sd === 'L' ? 0 : g.offR));
  return x < d ? { c: true, u: x / d, s: 0 } : { c: false, u: 0, s: (x - d) / (1 - d) };
}

// ---------------------------------------------------------------- the plan (speed, travel, phase, footprints)
// built at 240 Hz over the timeline from the Throttle track; kept until the track or the length changes
function procFootFK(g, ph, out) {   // the model's feet → out.L / out.R and out.uL / out.uR (the same: the stride is in the leg phase warp), in place
  const P = PROC.planQ || (PROC.planQ = new Float32Array(B * 4)), fkv = PROC.planFK || (PROC.planFK = new VirtualFK(rig));
  const H = procPose(g, ph, P, V3()); fkv.run(P, H, 0);
  const hp = fkv.P[boneIdx.get(rig.b.hips.name)];
  for (const Sd of ['L', 'R']) { const f = fkv.P[boneIdx.get(rig.side[Sd].foot.name)].clone(); out['u' + Sd] = f.clone(); out[Sd] = f; }
  return out;
}
function procPlan() {
  if (!procModel()) return null;
  const key = JSON.stringify(A.throttle) + '|' + S.dur;
  if (PROC.plan && PROC.plan.key === key) return PROC.plan;
  PROC.plans = PROC.plans || new Map();
  if (PROC.plans.has(key)) return (PROC.plan = PROC.plans.get(key));
  const hz = 240, n = Math.max(2, Math.ceil(S.dur * hz) + 1), dt = S.dur / (n - 1), D = PROC_DYN;
  const V = new Float32Array(n), Ac = new Float32Array(n), X = new Float64Array(n), PH = new Float64Array(n), VT = new Float32Array(n);
  let v = procThrSpeed(evalPts(A.throttle, 0)), a = 0, x = 0, ph = 0;   // starts steady at the first throttle value
  for (let i = 0; i < n; i++) {
    const t = i * dt, vt = procThrSpeed(evalPts(A.throttle, t));
    if (i > 0) {
      const e = vt - v, aCmd = clamp(D.gain * e + Math.sign(e) * Math.min(D.bias, D.near * Math.abs(e)), -D.dec, D.acc);
      a += clamp(aCmd - a, -D.jerk * dt, D.jerk * dt);
      v += a * dt; if (v <= 0) { v = 0; if (a < 0) a = 0; }
      x += v * dt; ph += procGait(v).f * dt;
    }
    V[i] = v; Ac[i] = a; X[i] = x; PH[i] = ph; VT[i] = vt;
  }
  // footprints: at each touchdown the model's foot where it lands, its reach scaled to the stride (with the travel so
  // far). The swing follows the model's own (unscaled) foot plus a gap that goes from the one at lift-off (planted
  // spot − model foot) to the one at the next touchdown (next spot − model foot): continuous at both ends
  const prints = { L: [], R: [] }, ff = {}, prev = { L: null, R: null };
  for (let i = 0; i < n; i++) {
    const g = procGait(V[i]);
    for (const Sd of ['L', 'R']) {
      const c = procLegPhase(Sd, g, PH[i]).c;
      if (c && !prev[Sd]) {
        procFootFK(g, PH[i], ff);
        const fp = { t0: i * dt, t1: S.dur + 1, p: ff[Sd].clone().add(V3(0, 0, X[i])), err: V3(), errTd: ff[Sd].clone().sub(ff['u' + Sd]) }; fp.errTd.y = 0;
        prints[Sd].push(fp);
      }
      if (!c && prev[Sd] && prints[Sd].length) {
        const fp = prints[Sd][prints[Sd].length - 1]; fp.t1 = i * dt; procFootFK(g, PH[i], ff);
        fp.err.copy(fp.p).sub(ff['u' + Sd]); fp.err.z -= X[i]; fp.err.y = 0;
      }
      prev[Sd] = c;
    }
  }
  PROC.plan = { key, n, dt, V, Ac, X, PH, VT, prints };
  PROC.plans.set(key, PROC.plan); if (PROC.plans.size > 6) PROC.plans.delete(PROC.plans.keys().next().value);
  return PROC.plan;
}
function procState(t) {   // → { v, a, x, ph, vt } at timeline time t
  const pl = procPlan(); if (!pl) return { v: 0, a: 0, x: 0, ph: 0, vt: 0 };
  const f = clamp(t / pl.dt, 0, pl.n - 1), i = Math.min(Math.floor(f), pl.n - 2), u = f - i, L = (A) => lerp(A[i], A[i + 1], u);
  return { v: L(pl.V), a: L(pl.Ac), x: L(pl.X), ph: L(pl.PH), vt: L(pl.VT) };
}
function procPrintIx(Sd, t) {   // index of the footprint in use at t (the last touchdown at or before t), −1 before the first
  const arr = PROC.plan.prints[Sd]; let lo = 0, hi = arr.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].t0 <= t + 1e-9) { r = m; lo = m + 1; } else hi = m - 1; }
  return r;
}
function procPrint(Sd, t) { const i = procPrintIx(Sd, t); return i >= 0 ? PROC.plan.prints[Sd][i] : null; }
function procTravel(t, out = V3()) { return out.set(0, 0, procState(t).x); }
function procSample(t, Q, H) { const st = procState(t); procPose(procGait(st.v), st.ph, Q, H); }
function procContact(Sd, t) { const st = procState(t); return procLegPhase(Sd, procGait(st.v), st.ph).c; }

// ---------------------------------------------------------------- the pose at t
const PQ = { v: null };
function procEvaluate(t) {
  if (!procPlan()) { applyPose(Qi[0], Hi); return; }
  if (!PQ.v) PQ.v = new Float32Array(B * 4);
  const st = procState(t), g = procGait(st.v), H = procPose(g, st.ph, PQ.v, V3());
  const shown = shownTravel(t, V3()), toShown = shown.clone().sub(V3(0, 0, st.x));   // true (planned) world → shown
  applyPose(PQ.v, H.clone().add(shown));
  const b = rig.b;
  const fkRef = {};
  for (const Sd of ['L', 'R']) {
    const sd = rig.side[Sd], footU = worldP(sd.foot), foot = footU.clone();
    fkRef[Sd] = { foot, footU, footQ: rig.delta(sd.foot), hip: worldP(sd.thigh), knee: worldP(sd.shin), footFK: worldP(sd.foot), thighQ: rig.delta(sd.thigh), shinQ: rig.delta(sd.shin) };
  }
  // lean with the acceleration (whole-body lean ≈ atan(a / g)): a quarter in the pelvis, the rest up the spine,
  // the head keeps part of its level
  const lean = clamp(Math.atan2(st.a, 9.81) * 0.9, -12 * DEG, 16 * DEG);
  if (Math.abs(lean) > 1e-4) {
    rotateBoneWorld(b.hips, qAxis(AX, lean * 0.25));
    spreadOver([b.spine, b.spine1, b.spine2], qAxis(AX, lean * 0.75));
    spreadOver([b.neck, b.head], qAxis(AX, -lean * 0.4));
  }
  // leg targets: planted on the footprint, or swinging toward the next one
  const legT = {};
  for (const Sd of ['L', 'R']) {
    const fr = fkRef[Sd], lp = procLegPhase(Sd, g, st.ph), ix = procPrintIx(Sd, t), arr = PROC.plan.prints[Sd], fp = ix >= 0 ? arr[ix] : null;
    let target;
    // planted or not is the plan's call (its touchdown / lift-off times); the phase only says how far the swing is
    // (in the moment the two disagree, right at a touchdown or lift-off, the swing is at its end or its start)
    if (fp && t < fp.t1) target = V3(fp.p.x, fr.foot.y, fp.p.z).add(toShown);
    else {
      const next = arr[ix + 1], live = fr.foot.clone().sub(fr.footU).setY(0);
      const e1 = next ? next.errTd : live, e0 = fp ? fp.err : e1, sw = !lp.c ? lp.s : lp.u > 0.5 ? 0 : 1;
      const gap = e0.clone().lerp(e1, smooth(clamp(sw / 0.6, 0, 1)));   // (gone by 60 % of the swing)
      // the gap never takes the foot further from the hip than the model's own foot is (or 98.5 % of the leg): a
      // trailing leg is not pulled straight
      const hip = worldP(rig.side[Sd].thigh), d0 = fr.footU.clone().sub(hip), Lm = Math.max(d0.length(), (rig.side[Sd].leg.l1 + rig.side[Sd].leg.l2) * 0.985);
      const qa = gap.lengthSq(), qb = 2 * d0.dot(gap), qc = d0.lengthSq() - Lm * Lm;
      let al = 1; if (qa > 1e-10 && (d0.clone().add(gap)).lengthSq() > Lm * Lm) al = clamp((-qb + Math.sqrt(Math.max(0, qb * qb - 4 * qa * qc))) / (2 * qa), 0, 1);
      target = fr.footU.clone().addScaledVector(gap, lerp(1, al, smooth(clamp(sw / 0.25, 0, 1))));   // (eased in over the first quarter: no step at lift-off)
    }
    legT[Sd] = { target, lp, planted: !!(fp && t < fp.t1) };
    PROC.dbg = legT;
  }
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
  model.updateMatrixWorld(true);
}
// a short read-out for the Throttle row
function procReadout(t) { const st = procState(t), g = procGait(st.v); return `${st.v.toFixed(2)} m/s → ${st.vt.toFixed(2)} · ${Math.round(g.f * 120)} steps/min · ${g.wRun < 0.05 ? 'walk' : g.wRun > 0.95 ? 'run' : 'walk→run'}${Math.abs(st.a) > 0.15 ? (st.a > 0 ? ' · accelerating' : ' · decelerating') : ''}`; }
