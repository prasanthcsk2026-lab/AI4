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
const PROC_FAM = {   // the symmetrized training set (assets/proc_clips.json; Run_medium left out: its forward-heavy arm swing)
  walk: ['procset:Standard_walk', 'procset:Casual_walk_1'],
  run: ['procset:16_35', 'procset:35_17', 'procset:09_07', 'procset:Run_steady', 'procset:sprint'],
};
const procSrcId = (id) => ({ 'procset:Standard_walk': 'loop:Standard_walk', 'procset:Casual_walk_1': 'loop:Casual_walk_1', 'procset:16_35': 'cmu:16_35', 'procset:35_17': 'cmu:35_17', 'procset:09_07': 'cmu:09_07', 'procset:Run_steady': 'loop:Run_steady', 'procset:sprint': 'mocap:sprint' })[id];
// throttle % → motion: each at its own speed (measured from its planted feet); in between, the two blended
const PROC_SLOTS = [[0, 'stand'], [10, 'procset:Standard_walk'], [20, 'procset:Casual_walk_1'], [35, 'procset:16_35'], [45, 'procset:35_17'], [55, 'procset:09_07'], [75, 'procset:Run_steady'], [100, 'procset:sprint']];
// per family: cadence below the style's own speed ∝ (v / style)^beta (≥ lo), contact at most dMul × the model's (cap)
const PROC_FAMK = { walk: { beta: 0.45, lo: 0.75, dMul: 1.25, dCap: 0.75, ext: 0.5 }, run: { beta: 0.3, lo: 0.6, dMul: 9, dCap: 0.42, ext: 0.35 } };
// throttle % → speed (m/s), and the motion it picks: ≈ 15 walk, 25 jog, 50 run, 70+ sprint
// speed controller: gain 1/s, a floor (m/s²) eased out over the last ~0.25 m/s (finite time, no overshoot), braking and
// jerk limits; the acceleration limit falls with speed (a sprint start pushes hardest)
// start: from standing the push comes at once (jerk ≤ jerk0 for the first 0.3 s), up to accWalk … accSprint by the motion asked for
const PROC_DYN = { gain: 1.3, bias: 0.8, near: 3, accWalk: 1.3, accSprint: 6.0, acc1: 1.5, dec: 3.5, jerk: 7, jerk0: 40, styleTau: 0.25, startTau: 0.08, standTau: 0.45, boostUp: 0.08, boostDown: 0.35 };
// braking (a fielder reaching the ball), always running until stopped (never slower than the slow-jog motion). The
// three Run-control tracks Natural / Controlled / Hard brake (0–100 %) brake him by themselves (the throttle stays):
//  natural    — a gradual gather over ~6–8 steps: the cadence falls with the speed, a slight lean back
//  controlled — chop steps over ~3–5 steps: the cadence held high (quick, short steps), lean back, arms in front
//  hard       — a plant and stop in ~2–3 steps: strong braking force at once, a long braking step, a strong lean back
// dec m/s² · jerk m/s³ · gain 1/s and bias m/s² (the tail into the stop) · hold: cadence kept ≥ this share of the
// cadence he had when the braking began · pose: how far back he leans for the same speed drop (1 = the full back lean)
const PROC_BRAKE = {
  natural: { dec: 1.8, jerk: 5, gain: 1.0, bias: 0.9, hold: 0, pose: 0.5, back: -12 },
  controlled: { dec: 3.0, jerk: 12, gain: 2.0, bias: 1.6, hold: 0.92, pose: 0.75, back: -17 },
  hard: { dec: 5.5, jerk: 35, gain: 4.0, bias: 3.0, hold: 0.85, pose: 1.0, back: -24 },
};
// a run start from standing: the first (right) touchdown about T1 s after the start (jog … sprint); the step's lift (m)
const PROC_START = { t1Jog: 0.42, t1Sprint: 0.55, lift: 0.12 };
const PROC_HIPUP = 1;   // × the run motions' hip shortfall to the sprint's height
const PROC_JOG = 35;   // the slow-jog slot: braking from a run never goes below its motion (no walk)
// the body's lean and what goes with it, from the speed still to gain / to lose (target − present speed, full at 2 m/s):
// forward when speeding up, back when slowing down (× the braking type's pose); the hips, the landing, the ankles and
// the toes go with it; slowing down the arm swing gets smaller, the elbows stay as they are
const PROC_LEANV = 2.0;
const PROC_POSE = { accLean: 30, accHipZ: 0.12, decHipZ: -0.10, accHipY: -0.04, decHipY: 0, accLand: -0.10, decLand: 0.14, accKnee: 0.08, decKnee: -0.03, accPlantar: 20, decDorsi: 15, decToe: 10, accArm: 0.3, decArm: -0.4, accElbow: 0, decCentre: 10, decCross: -6, backArm: 0.7 };
const PROC_BRK_KEYS = [['brkNat', 'natural'], ['brkCtl', 'controlled'], ['brkHard', 'hard']];
function procBrakeMix(m) {   // the brake tracks at a moment → one braking profile (force adds up to the hard brake's; the rest weighted)
  const b = [m.bN, m.bC, m.bH], sum = b[0] + b[1] + b[2]; if (sum < 0.01) return null;
  const P = PROC_BRK_KEYS.map(([, k]) => PROC_BRAKE[k]), w = b.map((x) => x / sum), mix = (k) => P.reduce((a, q, i) => a + w[i] * q[k], 0);
  return { dec: Math.min(PROC_BRAKE.hard.dec, P.reduce((a, q, i) => a + b[i] * q.dec, 0)), jerk: mix('jerk'), gain: mix('gain'), bias: mix('bias'), hold: mix('hold'), pose: mix('pose'), back: mix('back') };
}
function procSpeedPct(v) { const E = procEntries(), tab = PROC_SLOTS.map(([q, id]) => [id === 'stand' ? 0 : (E.find((e) => !e.stand && e.c.id === id) || { v: 0 }).v, q]); return tableLerp(tab, v); }
function procThrSpeed(p) { const E = procEntries(); return tableLerp(PROC_SLOTS.map(([q, id]) => [q, id === 'stand' ? 0 : (E.find((e) => !e.stand && e.c.id === id) || { v: 0 }).v]), clamp(p, 0, 100)); }
let PROC = null;

function procRegister() {
  clips.push({ id: 'proc:ik', name: 'Procedural IK', label: 'Procedural IK locomotion · Throttle track (experiment)', kind: 'proc', c: { name: 'Procedural_IK', speed: 0, dir: 0, proc: true }, dur: 1, group: 'Procedural' });
}
function procNewAuto(n = 16) {   // a demo over n bars (1 bar = 1 s): stand → walk (10 %) → jog (35 %) → run (75 %) → 55 % → stop
  const a = newAuto(n, n), k = n / 16;
  a.throttle = [[0, 0], [1, 0], [1.3, 10], [4, 10], [4.3, 35], [7, 35], [7.3, 75], [10, 75], [10.3, 55], [13, 55], [13.3, 0], [16, 0]].map(([t, v]) => ({ t: +(t * k).toFixed(3), v, k: 0 }));
  a.showMaster.thr = true; a.showMaster.run = true; a.procSym = 'avg'; a.procArms = 'clip';
  return a;
}

// ---------------------------------------------------------------- training
// the training clips are made symmetric first. Mode (Throttle lane): Average — the Procedural set (phase matching +
// average arms, assets/proc_clips.json, or your edited version of it from the cache) · Right → Left / Left → Right —
// the original clips with one side copied onto the other (half a cycle later, mirrored)
const procSymMode = () => (A && (A.procSym === 'RL' || A.procSym === 'LR') ? A.procSym : 'avg');
function procSymBk(cl, mode = 'avg') {
  const set = mode === 'avg' ? { stMode: 'arms', stW: '100', stStart: 'L', stEase: '0', stRetime: true, stSwing: false, stEven: false }
    : { stMode: 'copy', stArms: mode, stLegs: mode, stW: '100', stSplit: '50', stStart: 'L', stEase: '0', stRetime: true, stSwing: false, stEven: false, stCenter: false };
  const keep = [];
  for (const [id, v] of Object.entries(set)) { const e = $(id); if (!e) continue; keep.push([e, e.type === 'checkbox' ? e.checked : e.value]); if (e.type === 'checkbox') e.checked = v; else e.value = v; }
  const kST = { clip: ST.clip, src: ST.src, res: ST.res };
  try { ST.clip = cl; ST.src = cl.c.origBk; const r = stProcess(); return r && r.bk; }
  catch (err) { console.warn('procedural: symmetrize failed for', cl.id, err); return null; }
  finally { for (const [e, v] of keep) { if (e.type === 'checkbox') e.checked = v; else e.value = v; } Object.assign(ST, kST); }
}
function procTrainClip(cl, mode) {
  if (mode === 'avg' && cl.id.startsWith('procset:')) return procFit(cl, true);   // (the set: already symmetrized, or your edit of it)
  const bk = procSymBk(cl, mode), keepBk = BAKED[cl.id];
  if (bk) BAKED[cl.id] = bk;
  try { return procFit(cl, !!bk); } finally { if (keepBk) BAKED[cl.id] = keepBk; else delete BAKED[cl.id]; }
}
const procBakedSig = (id) => { const k = BAKED[id]; return k ? `${k.n}_${k.q[13].toFixed(5)}_${k.hp[1].toFixed(5)}` : '-'; };
function procFit(cl, sym) {
  return withClip(cl, () => {
    const N = PROC_N, dur = cl.dur, fkv = new VirtualFK(rig), Q = new Float32Array(B * 4), H = V3();
    const fi = { L: boneIdx.get(rig.side.L.foot.name), R: boneIdx.get(rig.side.R.foot.name) };
    const fr = [];
    for (let k = 0; k < N; k++) { sampleClip((k / N) * dur, Q, H); fkv.run(Q, H, 0); fr.push({ q: Q.slice(), h: H.clone(), L: fkv.P[fi.L].clone(), R: fkv.P[fi.R].clone() }); }
    const dt = dur / N, win = {};
    // its speed, measured from the planted feet (the ankle's backward speed against the hips while it is down): an
    // edited or re-symmetrized clip gets its own speed, not the file's
    const vs = [];
    for (const Sd of ['L', 'R']) { const thr = Math.min(...fr.map((f) => f[Sd].y)) + 0.03; for (let k = 0; k < N; k++) if (fr[k][Sd].y < thr) { const a = fr[(k + N - 1) % N], b = fr[(k + 1) % N]; vs.push(-((b[Sd].z - b.h.z) - (a[Sd].z - a.h.z)) / (2 * dt)); } }
    vs.sort((x, y) => x - y);
    const vMeas = vs.length ? vs[Math.floor(vs.length / 2)] : 0, v = vMeas > 0.3 ? vMeas : cl.c.speed;
    // contacts: the foot low and (in the world, the body travelling +z at v) nearly still; the longest run per leg
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
  PROC = PROC || {};
  const mode = procSymMode(), ids = (fam) => PROC_FAM[fam].map((id) => (mode === 'avg' ? id : procSrcId(id)));
  const key = mode + '|' + [...ids('walk'), ...ids('run')].map((id) => id + ':' + (mode === 'avg' ? procBakedSig(id) : '')).join(',');
  if (PROC.model && PROC.modelKey === key) return PROC.model;
  PROC.models = PROC.models || new Map();
  let got = PROC.models.get(key);
  if (!got) {
    const keep = cur, model = {};
    try {
      for (const fam of ['walk', 'run']) {
        model[fam] = ids(fam).map((id) => clips.find((c) => c.id === id) || clips.find((c) => c.id === procSrcId(id))).filter(Boolean).map((c) => procTrainClip(c, mode)).sort((a, b) => a.v - b.v);
        if (!model[fam].length) return null;
      }
    } finally { cur = keep; }
    got = { model, entries: null }; PROC.models.set(key, got);
  }
  PROC.model = got.model; PROC.modelKey = key; PROC.entries = got.entries; PROC.plan = null; PROC.gotModel = got;
  return PROC.model;
}

// ---------------------------------------------------------------- the gait: the motions (weights) at a speed (v)
// The throttle picks the motion: every trained clip (and standing) is an entry with a weight; the throttle's speed
// sets target weights (its one or two clips around that speed), and each weight eases to its target on its own, so
// a big throttle change cross-fades straight from the current motion to the new one (nothing in between gets any).
// The real speed v sets the cadence and stride inside that motion: slower than the motion, a lower cadence, longer
// contacts and smaller steps (down to its mean pose at 0); faster, a higher cadence and shorter contacts (each leg's
// phase is warped, so the planted foot keeps pace with the ground and the leg needs no longer reach).
const PROC_ARMSUB = { v0: 2.0, k0: 0.6 };   // a CMU entry's arm swing: 60 % of the donor's at 2 m/s, 100 % at the donor's speed
// the arm swing's centre (deg forward of the hips → neck line, both arms, over a cycle) with body cB, arms cA × s
function procArmCentre(cB, cA, s) {
  const gm = procGroups(), fkv = new VirtualFK(rig), Q = new Float32Array(B * 4), q = new THREE.Quaternion(), cs = new Float64Array(2 * PROC_H + 1);
  const ix = (o) => boneIdx.get(o.name), iH = ix(rig.b.hips), iN = ix(rig.b.neck);
  let sum = 0, n = 0;
  for (let k = 0; k < 16; k++) {
    procCS(cs, k / 16);
    for (let i = 0; i < B; i++) { const arm = gm[i] === 3; procBone(arm ? cA : cB, i, q, cs, arm ? s : 1); q.toArray(Q, i * 4); }
    fkv.run(Q, V3(0, 1, 0), 0);
    const up = fkv.P[iN].clone().sub(fkv.P[iH]).normalize();
    for (const Sd of ['L', 'R']) { const u = fkv.P[ix(rig.side[Sd].fore)].clone().sub(fkv.P[ix(rig.side[Sd].upper)]).normalize(); sum += Math.atan2(u.z, -u.dot(up)); n++; }
  }
  return (sum / n) / DEG;
}
const procIsCmu = (id) => /^cmu:/.test(procSrcId(id) || id);
function procEntries() {
  if (PROC.entries) return PROC.entries;
  const M = procModel(), E = [];
  const w0 = M.walk[0];
  E.push({ stand: true, fam: 'walk', c: w0, v: 0.3, f: w0.f * PROC_FAMK.walk.lo, ms: w0.stride, K: PROC_FAMK.walk });
  for (const fam of ['walk', 'run']) for (const c of M[fam]) E.push({ fam, c, v: c.v, f: c.f, ms: c.stride, K: PROC_FAMK[fam] });
  // arms: the CMU jogs / run keep their legs and body, but swing the arms of the nearest non-CMU run (Run steady): the
  // same phase (0 = left touchdown in both), the swing scaled to the jog's speed (the elbow stays the donor's mean)
  const donors = E.filter((e) => !e.stand && e.fam === 'run' && !procIsCmu(e.c.id));
  for (const e of E) {
    e.armC = e.c; e.armS = 1; e.armOff = 0;
    if (e.stand || !procIsCmu(e.c.id) || !donors.length) continue;
    const d = donors.reduce((b, x) => (Math.abs(x.v - e.v) < Math.abs(b.v - e.v) ? x : b));
    e.armC = d.c; e.armS = clamp(PROC_ARMSUB.k0 + (1 - PROC_ARMSUB.k0) * (e.v - PROC_ARMSUB.v0) / Math.max(0.1, d.v - PROC_ARMSUB.v0), PROC_ARMSUB.k0, 1);
    // the jog's own spine carries the arms differently: the swing's centre (about the trunk line) put back to the donor's
    e.armOff = procArmCentre(d.c, d.c, 1) - procArmCentre(e.c, d.c, e.armS);
  }
  // hip height: a run motion carried lower than the sprint (Run steady's bent-knee run, 6–7 cm lower) is lifted to the
  // sprint's height (the feet stay; the knees straighten)
  const runs = E.filter((e) => !e.stand && e.fam === 'run'), ref = runs.reduce((q, e) => (e.v > q.v ? e : q), runs[0]).c.hm.y;   // (the fastest: the sprint)
  for (const e of E) e.hipUp = !e.stand && e.fam === 'run' ? Math.max(0, ref - e.c.hm.y) * PROC_HIPUP : 0;
  PROC.entries = E; if (PROC.gotModel) PROC.gotModel.entries = E; return E;
}
function procTargetW(p, out) {   // the entries' target weights for a throttle %: its slot's motion, or the two around it
  const E = procEntries(); out.fill(0);
  const ix = (id) => (id === 'stand' ? 0 : E.findIndex((e) => !e.stand && (e.c.id === id || e.c.id === procSrcId(id))));
  const sl = PROC_SLOTS.map(([q, id]) => [q, ix(id)]).filter(([, i]) => i >= 0);
  p = clamp(p, 0, 100);
  let j = 0; while (j < sl.length - 2 && sl[j + 1][0] < p) j++;
  const u = clamp((p - sl[j][0]) / Math.max(1e-6, sl[j + 1][0] - sl[j][0]), 0, 1);
  out[sl[j][1]] += 1 - u; out[sl[j + 1][1]] += u;
  return out;
}
// v: real speed · Wt: entry weights · len: step length × (hard × natural) · cad: cycle speed × · gnd: + contact
function procGait(v, Wt, len = 1, cad = 1, gnd = 0, holdF = 0) {   // holdF: a cadence floor (cycles/s) while braking
  const E = procEntries();
  if (!Wt || typeof Wt === 'number') Wt = procTargetW(Wt == null ? 50 : Wt, new Float32Array(E.length));   // (a number: a throttle %)
  const vb = v / Math.max(1e-3, len * cad);
  let f = 0, sw = 0;
  const act = [];
  for (let i = 0; i < E.length; i++) {
    const w = Wt[i]; if (w < 1e-4) continue;
    const e = E[i], x = vb / e.v, rho = x <= 1 ? Math.max(e.K.lo, Math.pow(x, e.K.beta)) : Math.min(1.6, Math.pow(x, e.K.ext));
    f += w * e.f * rho; sw += w; act.push({ e, w });
  }
  f = Math.max((f / Math.max(sw, 1e-6)) * cad, holdF);   // (chop steps: the cadence held up while the steps shorten)
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
      const arm = grp === 3;
      procBone(arm ? a.e.armC : a.e.c, i, acc ? _pq2 : _pq, cs, ampOf(a, grp) * (arm ? a.e.armS : 1));
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
    armK: Math.max(0, procTr('armSwing', 100, t) / 100), hipK: Math.max(0, procTr('hipMotion', 100, t) / 100),
    bN: clamp(procTr('brkNat', 0, t) / 100, 0, 1), bC: clamp(procTr('brkCtl', 0, t) / 100, 0, 1), bH: clamp(procTr('brkHard', 0, t) / 100, 0, 1),
    bDist: Math.max(0, procTr('brkDist', 0, t)), bJog: clamp(procTr('brkJog', 1.8, t), 0.8, 3.5) };
}
function procPlanKey() { return JSON.stringify([A.throttle, A.stride, A.stepNat, A.cyc, A.fwd, A.gnd, A.armSwing, A.hipMotion, A.brkNat, A.brkCtl, A.brkHard, A.brkDist, A.brkJog, PROC.modelKey, S.dur]); }

// ---------------------------------------------------------------- the plan (speed, motion, travel, phase, footprints)
// built at 240 Hz over the timeline from the Throttle track and the run controls; kept until one of them changes
function procFootFK(g, ph, out) {   // the model's feet → out.L / out.R, in place (reach × forward travel about the hips)
  const P = PROC.planQ || (PROC.planQ = new Float32Array(B * 4)), fkv = PROC.planFK || (PROC.planFK = new VirtualFK(rig));
  const H = procPose(g, ph, P, V3()); fkv.run(P, H, 0);
  const hp = fkv.P[boneIdx.get(rig.b.hips.name)];
  for (const Sd of ['L', 'R']) { const f = fkv.P[boneIdx.get(rig.side[Sd].foot.name)].clone(); f.z = hp.z + (f.z - hp.z) * g.fwd; f.z = procLandZ(g, Sd, f, fkv.P[boneIdx.get(rig.side[Sd].thigh.name)]); out['u' + Sd] = f.clone(); out[Sd] = f; }
  return out;
}
const procLand = (g) => PROC_POSE.accLand * g.wa + PROC_POSE.decLand * g.wd;   // m the feet land ahead (+) / back (−) of where the motion puts them
// the pose tracks' landing shift, kept within the leg's reach from its hip joint at the motion's own hip height (with
// the pose's hip shift): a braking foot lands as far ahead as the leg reaches, the hips are not pulled down for it
function procLandZ(g, Sd, f, thigh) {
  const PP = PROC_POSE, z = f.z + procLand(g); if (z <= f.z + 1e-6) return z;
  const leg = rig.side[Sd].leg, Rr = (leg.l1 + leg.l2) * 0.985, hz = thigh.z + PP.accHipZ * g.wa + PP.decHipZ * g.wd, hy = thigh.y + PP.accHipY * g.wa + PP.decHipY * g.wd;
  const dy = hy - f.y, dx = thigh.x - f.x, h2 = Rr * Rr - dy * dy - dx * dx;
  return h2 <= 0 ? f.z : Math.max(f.z, Math.min(z, hz + Math.sqrt(h2)));
}
function procPlan() {
  if (!procModel()) return null;
  const key = procPlanKey();
  if (PROC.plan && PROC.plan.key === key) return PROC.plan;
  PROC.plans = PROC.plans || new Map();
  if (PROC.plans.has(key)) return (PROC.plan = PROC.plans.get(key));
  const hz = 240, n = Math.max(2, Math.ceil(S.dur * hz) + 1), dt = S.dur / (n - 1), D = PROC_DYN, DEFBR = PROC_BRAKE.controlled;   // (a throttle drop brakes as a controlled brake)
  const F32 = () => new Float32Array(n);
  const V = F32(), Ac = F32(), X = new Float64Array(n), PH = new Float64Array(n), VT = F32(), SS = F32(), LEN = F32(), CAD = F32(), FW = F32(), GN = F32(), AK = F32(), HK = F32(), BO = F32();
  const AP = F32(), DP = F32(), HO = F32();
  const p0 = clamp(evalPts(A.throttle, 0), 0, 100), m0 = procMods(0);
  let v = procThrSpeed(p0) * m0.len * m0.cad, a = 0, x = 0, ph = 0, s = p0, held = p0, tStart = -9;   // starts steady at the first throttle value
  let runHeld = p0 >= PROC_JOG, brk = 0, fB = 0, fNow = 0;
  const kS = 1 - Math.exp(-dt / D.styleTau), kS1 = 1 - Math.exp(-dt / D.startTau), kS0 = 1 - Math.exp(-dt / D.standTau), kBu = 1 - Math.exp(-dt / D.boostUp), kBd = 1 - Math.exp(-dt / D.boostDown);
  let bo = 0; const kP = 1 - Math.exp(-dt / 0.12);
  let dRun = 0, runDone = false, hold = 0, vB = 0, wasBM = false; const DH = F32(), DW = F32(), BK = F32(), starts = [];   // (brake run: metres done in the braking pose; DH its pose weight)
  const nE = procEntries().length, wT = new Float32Array(nE), wC = new Float32Array(nE), WE = new Float32Array(n * nE);
  for (let i = 0; i < n; i++) {
    const t = i * dt, pc = clamp(evalPts(A.throttle, t), 0, 100), m = procMods(t), BM = procBrakeMix(m), BR = BM || DEFBR;
    // a brake track on: he brakes towards a stop, whatever the throttle. With a Brake run distance: first down to the
    // Brake run speed, that far in the braking pose (lean back, the type's cadence), then the stop
    if (BM && !wasBM) { vB = v; dRun = 0; runDone = false; } wasBM = !!BM;
    const runOn = !!BM && m.bDist > 0.01 && !runDone && runHeld, vJ = Math.min(m.bJog, vB);
    if (runOn && v <= vJ + 0.06) { dRun += v * m.fwd * dt; if (dRun >= m.bDist) runDone = true; }
    const vT = BM ? (runOn && !runDone ? vJ : 0) : procThrSpeed(pc) * m.len * m.cad;
    hold += ((runOn && !runDone ? 1 : 0) - hold) * (1 - Math.exp(-dt / 0.25));
    // the motion: straight to the throttle's own (a start or a change of pace). Braking from a run (to a stop, or to a
    // walking throttle) it stays a run: the motion follows the speed down, never below the slow jog, then standing
    // once nearly still. A throttle ramp down to 0 is a stop all the way (0.5 s ahead)
    const toStop = !!BM || (evalPts(A.throttle, Math.min(S.dur, t + 0.5)) <= 0.5 && pc < held);
    let pT;
    if (pc >= PROC_JOG && !toStop) { pT = pc; held = pc; runHeld = true; }
    else if (runHeld && v > 0.35) pT = clamp(procSpeedPct(v / Math.max(1e-3, m.len * m.cad)), PROC_JOG, Math.max(held, PROC_JOG));
    else if (pc > 0.5 && !toStop) { pT = pc; held = pc; runHeld = false; }
    else if (v > 0.35) pT = held;
    else { pT = 0; if (v < 0.05) runHeld = false; }
    procTargetW(pT, wT);
    if (i > 0) {
      // a start from standing: the push leg (left) is put on the ground and the right one starts its swing at once
      if (v < 0.02 && vT > 0.05 && t - tStart > 0.5) {
        const run = pT >= PROC_JOG, ff = {};
        if (run) { const pl0 = { V, Ac, X, PH, VT, SS, LEN, CAD, FW, GN, AK, HK, BO, AP, DP, HO, DW, BK, WE, nE }; procFootFK(procGaitAt(procStateAt(pl0, i - 1)), PH[i - 1], ff); }
        tStart = t; ph = Math.ceil(ph) + (run ? 0.02 : 0.12);   // (a walk: the right foot already on its way)
        // a run start: the right foot steps straight from where it stands to its first print (no back swing), the
        // phase slowed so the first contact comes once he has moved (a long first step), the left foot pushing
        if (run) starts.push({ t0: t, ph0: ph, spot: ff.R.clone().add(V3(0, 0, X[i - 1])), T1: lerp(PROC_START.t1Jog, PROC_START.t1Sprint, clamp((pT - PROC_JOG) / (100 - PROC_JOG), 0, 1)) });
      }
      const starting = t - tStart < 0.4, st0 = starts.length && starts[starts.length - 1].t0 === tStart ? starts[starts.length - 1] : null;
      const k = starting ? kS1 : pT < 1 ? kS0 : kS;   // (to the motion asked for at once on a start; into standing slowly)
      for (let e = 0; e < nE; e++) wC[e] += (wT[e] - wC[e]) * k;
      s += (pT - s) * k;
      const bT = clamp(a / 2.5, 0, 1); bo += (bT - bo) * (bT > bo ? kBu : kBd);
      const accMax = lerp(lerp(D.accWalk, D.accSprint, clamp((pT - PROC_SLOTS[1][0]) / (100 - PROC_SLOTS[1][0]), 0, 1)), D.acc1, clamp(v / 4.6, 0, 1));
      const e = vT - v, braking = e < -0.05;
      // braking: the chosen type's force, onset, tail and cadence; speeding up / holding: as before
      const gain = braking ? BR.gain : D.gain, bias = braking ? BR.bias : D.bias;
      const aCmd = clamp(gain * e + Math.sign(e) * Math.min(bias, D.near * Math.abs(e)), braking ? -BR.dec : -D.dec, accMax), J = starting ? D.jerk0 : braking || a < -0.05 ? Math.max(BR.jerk, D.jerk) : D.jerk;
      a += clamp(aCmd - a, -J * dt, J * dt);
      v += a * dt; if (v <= 0) { v = 0; if (a < 0) a = 0; }
      const brNow = (a < -0.1 || hold > 0.5) && runHeld; if (!brNow || brk < 0.02) fB = fNow;   // (the cadence when the braking began)
      brk += ((brNow ? 1 : 0) - brk) * kP;   // (braking from a run: the type's cadence hold and pose, eased)
      fNow = procGait(v, wC, m.len, m.cad, m.gnd, BR.hold * fB * brk * clamp(v / 0.6, 0, 1)).f;   // (the hold lets go in the last 0.6 m/s: the last step comes in)
      // the first step: the phase runs at most (to the right touchdown) / T1
      let fPh = fNow;
      if (st0 && ph < st0.ph0 + 0.48) fPh = Math.min(fNow, 0.48 / st0.T1);
      x += v * m.fwd * dt; ph += fPh * dt;
    } else { s = pT; wC.set(wT); }
    WE.set(wC, i * nE);
    V[i] = v; Ac[i] = a; X[i] = x; PH[i] = ph; VT[i] = vT; SS[i] = s; BO[i] = bo; LEN[i] = m.len; CAD[i] = m.cad; FW[i] = m.fwd; GN[i] = m.gnd; AK[i] = m.armK; HK[i] = m.hipK; const er = vT - v, waT = clamp(er / PROC_LEANV, 0, 1), wB = Math.max(clamp(-er / PROC_LEANV, 0, 1), brk * clamp(v / 0.8, 0, 1), hold), wdT = wB * BR.pose; DH[i] = hold; DW[i] = i ? DW[i - 1] + (wB - DW[i - 1]) * kP : wB; BK[i] = i ? BK[i - 1] + (BR.back - BK[i - 1]) * kP : BR.back; AP[i] = i ? AP[i - 1] + (waT - AP[i - 1]) * kP : waT; DP[i] = i ? DP[i - 1] + (wdT - DP[i - 1]) * kP : wdT; HO[i] = BR.hold * fB * brk * clamp(v / 0.6, 0, 1);   // (lean from the speed still to gain / lose, eased 0.12 s)
  }
  const pl = { key, n, dt, V, Ac, X, PH, VT, SS, LEN, CAD, FW, GN, AK, HK, BO, AP, DP, HO, DH, DW, BK, WE, nE, starts };
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
  for (const st of starts) { const fp = prints.R.find((q) => q.t0 > st.t0 + 1e-6); st.t1 = fp ? fp.t0 : st.t0; st.fp = fp; }
  PROC.plan = pl;
  PROC.plans.set(key, pl); if (PROC.plans.size > 6) PROC.plans.delete(PROC.plans.keys().next().value);
  return pl;
}
const PROC_KEYS = ['V', 'Ac', 'X', 'PH', 'VT', 'SS', 'LEN', 'CAD', 'FW', 'GN', 'AK', 'HK', 'BO', 'AP', 'DP', 'HO', 'DW', 'BK'];
function procStateAt(pl, i) { const o = {}; for (const k of PROC_KEYS) o[k] = pl[k][i]; o.W = pl.WE.subarray(i * pl.nE, (i + 1) * pl.nE); return o; }
function procState(t) {   // → the plan's values at timeline time t (V speed, Ac accel, X travel, PH phase, VT target, SS motion …)
  const pl = procPlan(); if (!pl) return { V: 0, Ac: 0, X: 0, PH: 0, VT: 0, SS: 0, LEN: 1, CAD: 1, FW: 1, GN: 0, AK: 1, HK: 1, BO: 0, AP: 0, DP: 0, HO: 0, DW: 0, BK: 0, v: 0, a: 0, x: 0, ph: 0, vt: 0 };
  const f = clamp(t / pl.dt, 0, pl.n - 1), i = Math.min(Math.floor(f), pl.n - 2), u = f - i, o = {};
  for (const k of PROC_KEYS) o[k] = lerp(pl[k][i], pl[k][i + 1], u);
  o.W = new Float32Array(pl.nE); for (let e = 0; e < pl.nE; e++) o.W[e] = lerp(pl.WE[i * pl.nE + e], pl.WE[(i + 1) * pl.nE + e], u);
  o.v = o.V; o.a = o.Ac; o.x = o.X; o.ph = o.PH; o.vt = o.VT;
  return o;
}
function procGaitAt(st) {
  const g = procGait(st.V, st.W || st.SS, st.LEN, st.CAD, st.GN, st.HO || 0);
  g.boost = st.BO; g.hipK = st.HK; g.fwd = st.FW;   // hard acceleration: full arm and trunk drive, however short the steps
  g.wa = st.AP; g.wd = st.DP; g.armK = st.AK * (1 + PROC_POSE.accArm * g.wa) * (1 + PROC_POSE.decArm * g.wd);
  for (const a of g.act) if (!a.e.stand) { a.ampL = Math.max(a.ampL, 0.9 * g.boost); a.ampR = Math.max(a.ampR, 0.9 * g.boost); a.amp = Math.min(a.ampL, a.ampR); }   // (a start: the legs swing out at once)
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
    const sd = rig.side[Sd], footFK = worldP(sd.foot), footU = footFK.clone(); footU.z = hp0.z + (footU.z - hp0.z) * g.fwd; footU.z = procLandZ(g, Sd, footU, worldP(sd.thigh));   // (where the plan puts the feet: forward travel, the pose tracks)
    fkRef[Sd] = { foot: footU, footU, footQ: rig.delta(sd.foot), hip: worldP(sd.thigh), knee: worldP(sd.shin), footFK, thighQ: rig.delta(sd.thigh), shinQ: rig.delta(sd.shin) };
  }
  // the body: the Acceleration / Deceleration pose tracks lean the whole body forward / back (35 % in the pelvis,
  // the rest up the spine, the head keeps 60 % of its level) and move the hips over / behind the feet; the Spine
  // lean and Hip rotation run controls add on. (No lean of its own from the speed: the pose tracks set it.)
  const PP = PROC_POSE, wa = g.wa, wd = g.wd;
  // speeding up: forward by accLean × the speed still to gain; braking: back to the brake type's trunk angle (hips →
  // neck from the vertical: −12° natural, −17° controlled, −24° hard; standing reads about −7°), from the motion's own
  const hp = worldP(b.hips), nk = worldP(b.neck), trunk0 = Math.atan2(nk.z - hp.z, nk.y - hp.y) / DEG;
  const leanBack = (st.DW || 0) * Math.min(0, (st.BK || 0) - trunk0), lean = (PP.accLean * wa + leanBack) * DEG;
  const uLean = procTr('lean', 0, t) * DEG, hRot = procTr('hipRot', 0, t) * DEG;
  if (Math.abs(lean) + Math.abs(uLean) + Math.abs(hRot) > 1e-5) {
    rotateBoneWorld(b.hips, qAxis(AX, lean * 0.35 + hRot));
    spreadOver([b.spine, b.spine1, b.spine2], qAxis(AX, lean * 0.65 + uLean));
    spreadOver([b.neck, b.head], qAxis(AX, -(lean + uLean + hRot) * 0.6));
    // the trunk line (hips → neck) does not turn by the whole amount (the hip turn is shared with the legs): the rest
    // up the spine, until it reads what was asked
    for (let it = 0; it < 2; it++) {
      const h1 = worldP(b.hips), n1 = worldP(b.neck), res = trunk0 * DEG + lean + uLean - Math.atan2(n1.z - h1.z, n1.y - h1.y);
      if (Math.abs(res) < 0.3 * DEG) break;
      spreadOver([b.spine, b.spine1, b.spine2], qAxis(AX, res)); spreadOver([b.neck, b.head], qAxis(AX, -res * 0.6));
    }
  }
  if (wa + wd > 1e-4) { rig.setHipsWorld(worldP(b.hips).add(V3(0, PP.accHipY * wa + PP.decHipY * wd, PP.accHipZ * wa + PP.decHipZ * wd))); b.hips.updateMatrixWorld(true); }
  // knee depth: the hips down (+) / up (−), 7 cm per 100 % · jump: the hips rise in the flight (6 cm at 100 %)
  const kd = (procTr('kneeDepth', 100, t) / 100 - 1) * 0.07;
  let fly = 1; const lps = {};
  for (const Sd of ['L', 'R']) { lps[Sd] = procLegPhase(Sd, g, st.PH); fly = Math.min(fly, lps[Sd].c ? 0 : Math.sin(Math.PI * lps[Sd].s)); }
  const lift = Math.max(0, procTr('jump', 0, t)) / 100 * JUMPK.cmAt100 / 100 * fly;
  const hu = g.act.reduce((q, a) => q + a.w * (a.e.hipUp || 0), 0);   // (hips up to the sprint's height)
  if (Math.abs(kd) > 1e-5 || lift > 1e-5 || hu > 1e-5) { rig.setHipsWorld(worldP(b.hips).add(V3(0, lift - kd + hu, 0))); b.hips.updateMatrixWorld(true); }
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
      target.y += lift - kd + 0.5 * hu;   // a swinging foot goes up / down with the hips
    }
    // a run start: the right foot goes straight from where it stood to its first print (lifted, no back swing)
    const S0 = Sd === 'R' ? procStartAt(t) : null;
    if (S0) {
      const u = clamp((t - S0.t0) / Math.max(1e-3, S0.t1 - S0.t0), 0, 1), e = smooth(u), P1 = S0.fp.p, P0 = S0.spot;
      target = V3(lerp(P0.x, P1.x, e), lerp(P0.y, P1.y, u) + PROC_START.lift * Math.sin(Math.PI * Math.min(1, u * 1.15)), lerp(P0.z, P1.z, e)).add(toShown);
      target.y += lift - kd;
    }
    // the pose tracks: a higher (accelerating) / lower (braking) knee drive in the swing; accelerating, the heel comes
    // up late in the contact (the ankle pushes: the foot points down and the toes bend, the ball stays down)
    const plantedNow = !!(fp && t < fp.t1), swNow = !lp.c ? lp.s : lp.u > 0.5 ? 0 : 1;
    if (!plantedNow) target.y += (PP.accKnee * wa + PP.decKnee * wd) * Math.sin(Math.PI * clamp(swNow, 0, 1));
    const push = wa * PP.accPlantar * DEG * (plantedNow ? smoothB((lp.u - 0.5) / 0.4) : 1 - smoothB(swNow / 0.3));
    const heel = wd * PP.decDorsi * DEG * (plantedNow ? 1 - smoothB(lp.u / 0.35) : smoothB((swNow - 0.6) / 0.4));
    if (plantedNow && push > 1e-4) target.y += 0.14 * Math.sin(push);
    fr.push = push; fr.heel = heel;
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
    // (a planted foot: mid-contact; a foot about to land far ahead, braking: over the last 30 % of its swing)
    const l = legT[Sd], cw = l.planted ? Math.max(Math.min(smoothB(l.lp.u / 0.12), smoothB((1 - l.lp.u) / 0.3)), g.wd * (1 - smoothB(l.lp.u / 0.3))) : l.lp.c ? 0 : smoothB((l.lp.s - 0.7) / 0.3) * g.wd;   // (braking: carried on from the landing)
    if (cw < 1e-4) continue;
    const leg = rig.side[Sd].leg, reach = (leg.l1 + leg.l2) * 0.985, h = worldP(rig.side[Sd].thigh).sub(l.target), hz2 = h.x * h.x + h.z * h.z;
    if (h.lengthSq() > reach * reach && hz2 < reach * reach) drop = Math.max(drop, cw * (h.y - Math.sqrt(reach * reach - hz2)));
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
    if (fr.push > 1e-4 || fr.heel > 1e-4) {   // ankle: + points the foot down (push-off), − pulls the toes up (heel strike)
      rotateBoneWorld(sd.foot, qAxis(AX, fr.push - fr.heel));
      if (sd.toe) rotateBoneWorld(sd.toe, qAxis(AX, -fr.push * (legT[Sd].planted ? 1 : 0.4) - fr.heel * (PP.decToe / PP.decDorsi)));
    }
  }
  if (A.procArms === 'synth') procArms(g, st);
  // arm shape run controls (elbow bend, arm crossing, swing centre), as on a clip
  const armOff = A.procArms === 'synth' ? 0 : g.act.reduce((s, a) => s + a.w * (a.e.armOff || 0), 0);
  applyArmShapeV(procTr('elbowBend', 0, t) + PP.accElbow * wa, procTr('armCross', 0, t) + PP.decCross * wd, procTr('armCentre', 0, t) + PP.decCentre * wd + armOff + PP.backArm * leanBack);   // (leaning back, the arms stay in front, not raised)
  model.updateMatrixWorld(true);
}
function procStartAt(t) { const pl = PROC.plan; if (!pl || !pl.starts) return null; for (const s of pl.starts) if (s.fp && t >= s.t0 && t < s.t1) return s; return null; }
// a short read-out for the status line
function procMotionName(g) { let best = null; for (const a of g.act) if (!best || a.w > best.w) best = a; return !best ? '' : best.e.stand ? 'stand' : ((clips.find((c) => c.id === best.e.c.id) || {}).name || best.e.c.id); }
function procReadout(t) { const st = procState(t), g = procGaitAt(st); return `${st.V.toFixed(2)} m/s → ${st.VT.toFixed(2)} · ${procMotionName(g)} motion · ${Math.round(g.f * 120)} steps/min${Math.abs(st.Ac) > 0.15 ? (st.Ac > 0 ? ' · accelerating' : ' · decelerating') : ''}`; }
// ---------------------------------------------------------------- fielding templates: sprint to the ball, brake, stop
// a standing start straight into the sprint (Acceleration pose through the drive phase), full speed, then the throttle
// to 0 with the braking type; running all the way down, standing at the end
const FIELD_TPL = { natural: { bars: 12, brakeAt: 6, key: 'brkNat' }, controlled: { bars: 10, brakeAt: 6, key: 'brkCtl' }, hard: { bars: 9, brakeAt: 6, key: 'brkHard' } };
function applyFieldBrake(type) {
  const v = FIELD_TPL[type]; if (!v) return 'Unknown braking type.';
  if (!seqActive()) seqAdd('proc:ik', 1, 0, v.bars);
  else if (SEQ.motions[SEQ.sel].clipId !== 'proc:ik') seqSetClip(SEQ.sel, 'proc:ik');
  pushUndo();
  const n = procNewAuto(v.bars), P = (t, val) => ({ t, v: val, k: 0 });
  for (const k of ['rowOrder', 'subOrder', 'heights', 'ranges']) if (A[k]) n[k] = A[k];
  n.throttle = [P(0, 0), P(0.5, 0), P(0.501, 100), P(v.bars, 100)];   // (the throttle stays: the brake track stops him)
  n[v.key] = [P(0, 0), P(v.brakeAt, 0), P(v.brakeAt + 0.001, 100), P(v.bars, 100)];
  n.runShow = { [v.key]: true }; n.showMaster.run = true;
  A = normalizeAuto(n); S.dur = A.dur; A.cycles = v.bars; A.cycLocked = true;
  S.t = 0; S.v0 = 0; editVersion++;
  ensureEnds(); rebuildSpeedLUT(); lockCycles(true); syncLenInputs(); rebuildRows(); save();
  const pl = procPlan(), i0 = Math.round(v.brakeAt / pl.dt); let iStop = pl.n - 1; for (let i = i0; i < pl.n; i++) if (pl.V[i] < 0.05) { iStop = i; break; }
  const steps = ['L', 'R'].reduce((c, Sd) => c + pl.prints[Sd].filter((x) => x.t0 > v.brakeAt && x.t0 <= iStop * pl.dt).length, 0);
  return `Fielding · ${type} brake (Run controls track, throttle left at 100 %): sprint from a standing start (bar 1), full speed ${pl.V[i0].toFixed(2)} m/s, brakes at ${v.brakeAt} s and stops in ${((iStop - i0) * pl.dt).toFixed(2)} s over ${(pl.X[iStop] - pl.X[i0]).toFixed(2)} m, ${steps} steps, running all the way.`;
}

// ---------------------------------------------------------------- procedural arm swing
// each arm swings with the opposite leg's phase (forward as that leg reaches forward to land), the swing's size by
// speed (jog ~±25°, sprint ~±50°; a little more forward than back) × the Arm swing control (smaller while braking) ×
// how big the steps are (a start or a stop swings less), centred a little forward of the body line, a little out; the
// elbow held at 85° (it does not open up as he slows), a little more bent as the arm comes forward; the forearm turns in
// toward the middle. It fades in with the speed (standing keeps the motion's own arms)
const PROC_ARMS = { amp0: 25, amp1: 50, centre: 4, fwdK: 1.15, backK: 0.85, lead: 0.05, abduct: 9, elbow0: 85, elbow1: 85, elbowSwing: 10, cross: 0.22 };
function procArms(g, st) {
  const PA = PROC_ARMS, b = rig.b, standW = st.W ? st.W[0] : 0, w = clamp(st.V / 0.8, 0, 1) * (1 - standW);
  if (w < 1e-3) return;
  // the trunk's own frame (hips → neck line; facing the way he runs): the swing is about the trunk, whatever its lean
  const up = worldP(b.neck).sub(worldP(b.hips)).normalize(), lat = V3().crossVectors(up, V3(0, 0, 1)).normalize(), fwd = V3().crossVectors(lat, up).normalize();
  const steps = g.act.reduce((a, x) => a + x.w * Math.max(x.amp, g.boost), 0);   // (how big the steps are: small at a start / a stop)
  const amp = lerp(PA.amp0, PA.amp1, clamp((st.V - 2) / 2.6, 0, 1)) * g.armK * clamp(steps, 0, 1);
  const elbowB = lerp(PA.elbow0, PA.elbow1, clamp((st.V - 1.5) / 3, 0, 1));
  for (const Sd of ['L', 'R']) {
    const sd = rig.side[Sd], peak = (Sd === 'L' ? g.offR : 0) - PA.lead;   // forward when the opposite leg lands
    const c = Math.cos(TAU * (st.PH - peak)), th = (PA.centre + amp * c * (c > 0 ? PA.fwdK : PA.backK)) * DEG;
    const E = (elbowB + PA.elbowSwing * c) * DEG;
    const sh = worldP(sd.upper), out = lat.clone().multiplyScalar(Math.sign(sh.clone().sub(worldP(b.spine2)).dot(lat)) || (Sd === 'L' ? 1 : -1));
    const d1 = up.clone().multiplyScalar(-Math.cos(th)).addScaledVector(fwd, Math.sin(th)).addScaledVector(out, Math.sin(PA.abduct * DEG)).normalize();
    const pp = fwd.clone().addScaledVector(d1, -fwd.dot(d1)).normalize();
    const d2 = d1.clone().multiplyScalar(Math.cos(E)).addScaledVector(pp, Math.sin(E)).addScaledVector(out, -PA.cross * Math.sin(E)).normalize();
    const c1 = worldP(sd.fore).sub(sh).normalize();
    rotateBoneWorld(sd.upper, new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(c1, d1), w)); sd.upper.updateMatrixWorld(true);
    const el = worldP(sd.fore), c2 = worldP(sd.hand).sub(el).normalize(), d1n = el.clone().sub(worldP(sd.upper)).normalize();
    const d2n = d2.clone().applyQuaternion(new THREE.Quaternion().setFromUnitVectors(d1, d1n));   // (the forearm kept to the arm as it actually is)
    rotateBoneWorld(sd.fore, new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(c2, d2n), w)); sd.fore.updateMatrixWorld(true);
  }
}
