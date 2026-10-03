
// ============================================================================
//  SYMMETRIZE TOOL (a panel): load an in-place loop, mirror arms / legs onto the other side half a cycle later,
//  and retime the cycle so the feet land exactly on the bars (start foot at 0 %, the other at 50 %, the start
//  foot again at 100 %). It previews live on the character; Save replaces the clip (the timeline then shows
//  the feet on the bars, however many cycles), Save to project stores it for the project files, and the clip
//  can be exported with any number of cycles as FBX or glTF.
// ============================================================================
const ST = { clip: null, src: undefined, saved: false, res: null, fk: null, busy: false };
const ST_M = 240;   // working samples per cycle
// Steadiness: per centre bone, how much of its in-cycle motion to take out (0 = as is, 100 % = still), measured
// against the cycle's average pose. World = the bone holds still in the world (the bones below compensate, e.g. a level
// gaze while the body rocks); Local = only the bone's own rotation calms down. Pitch / turn / tilt pick the axes
// (character axes: pitch about the side-to-side axis, turn about the vertical, tilt about the forward axis).
const ST_STEADY = [['hips', 'Hips', 'world'], ['spine', 'Spine', 'local'], ['spine1', 'Spine1', 'local'], ['spine2', 'Chest', 'local'], ['neck', 'Neck', 'world'], ['head', 'Head', 'world']];
function buildSteadyUI() {
  const g = $('stSteady'); g.textContent = '';
  const add = (html) => { const t = document.createElement('template'); t.innerHTML = html; g.append(...t.content.childNodes); };
  add('<span class="hd">Bone</span><span class="hd">Amount</span><span class="hd">Space</span><span class="hd" title="Pitch: nod forward / back">P</span><span class="hd" title="Turn: left / right">T</span><span class="hd" title="Tilt: side to side">L</span>');
  for (const [k, label, sp] of ST_STEADY) add(`<label><input type="checkbox" data-s="${k}" data-f="on"> ${label}</label><span class="amt"><input type="range" min="0" max="100" step="5" value="60" data-s="${k}" data-f="amt"><b>60%</b></span><select data-s="${k}" data-f="space"><option value="world"${sp === 'world' ? ' selected' : ''}>World</option><option value="local"${sp === 'local' ? ' selected' : ''}>Local</option></select><input type="checkbox" checked data-s="${k}" data-f="pitch" title="Pitch"><input type="checkbox" checked data-s="${k}" data-f="turn" title="Turn"><input type="checkbox" checked data-s="${k}" data-f="tilt" title="Tilt">`);
  add('<span class="hd">Hips move</span><span class="wide"><span class="amt">Bob <input type="range" min="0" max="100" step="5" value="0" data-s="bob"><b>0%</b></span><span class="amt">Sway <input type="range" min="0" max="100" step="5" value="0" data-s="sway"><b>0%</b></span><label title="Legs are IK-solved so the feet keep their spots when the hips are steadied"><input type="checkbox" checked data-s="feet"> Feet stay planted (leg IK)</label></span>');
  for (const el of g.querySelectorAll('input[type=range]')) el.oninput = () => { el.nextElementSibling.textContent = el.value + '%'; };
  for (const el of g.querySelectorAll('input, select')) el.onchange = stRun;
}
function steadyOpts() {
  const g = $('stSteady'), q = (s, f) => g.querySelector(`[data-s="${s}"]${f ? `[data-f="${f}"]` : ''}`), o = {};
  if (!g.children.length) return { bob: 0, sway: 0, feet: true };
  for (const [k] of ST_STEADY) o[k] = { on: q(k, 'on').checked, amt: clamp(+q(k, 'amt').value / 100, 0, 1), space: q(k, 'space').value, pitch: q(k, 'pitch').checked, turn: q(k, 'turn').checked, tilt: q(k, 'tilt').checked };
  o.bob = clamp(+q('bob').value / 100, 0, 1); o.sway = clamp(+q('sway').value / 100, 0, 1); o.feet = q('feet').checked;
  return o;
}
function meanQuat(qs) {   // average rotation (signs aligned to the first)
  const a = qs[0], m = new THREE.Quaternion(0, 0, 0, 0);
  for (const q of qs) { const s = a.x * q.x + a.y * q.y + a.z * q.z + a.w * q.w < 0 ? -1 : 1; m.x += s * q.x; m.y += s * q.y; m.z += s * q.z; m.w += s * q.w; }
  return m.normalize();
}
function stSteady(Qo, Ho, N, st) {   // → a short report, or null when nothing was asked
  const bonesOf = { hips: rig.b.hips, spine: rig.b.spine, spine1: rig.b.spine1, spine2: rig.b.spine2, neck: rig.b.neck, head: rig.b.head };
  const list = ST_STEADY.filter(([k]) => st[k] && st[k].on && st[k].amt > 0 && bonesOf[k]);
  if (!list.length && !(st.bob > 0) && !(st.sway > 0)) return null;
  const fk = ST.fk, origQ = Qo.slice(), origH = Ho.slice(), q = new Float32Array(B * 4), h = V3(), rv = V3(), rep = [];
  const frameFK = (j) => { q.set(Qo.subarray(j * B * 4, (j + 1) * B * 4)); h.fromArray(Ho, j * 3); fk.run(q, h); };
  if (st.bob > 0 || st.sway > 0) {   // hips height bob / side sway toward the cycle's average
    let mx = 0, my = 0; for (let j = 0; j < N; j++) { mx += Ho[j * 3]; my += Ho[j * 3 + 1]; } mx /= N; my /= N;
    let bob0 = 0, sw0 = 0; for (let j = 0; j < N; j++) { bob0 = Math.max(bob0, Math.abs(Ho[j * 3 + 1] - my)); sw0 = Math.max(sw0, Math.abs(Ho[j * 3] - mx)); Ho[j * 3] -= st.sway * (Ho[j * 3] - mx); Ho[j * 3 + 1] -= st.bob * (Ho[j * 3 + 1] - my); }
    if (st.bob > 0) rep.push(`hips bob ±${(bob0 * 100).toFixed(1)} → ±${(bob0 * (1 - st.bob) * 100).toFixed(1)} cm`);
    if (st.sway > 0) rep.push(`sway ±${(sw0 * 100).toFixed(1)} → ±${(sw0 * (1 - st.sway) * 100).toFixed(1)} cm`);
  }
  for (const [k, label] of list) {   // top of the chain down, each one against its parent as already steadied
    const bone = bonesOf[k], i = boneIdx.get(bone.name), o = st[k], pb = bone.parent, pi = pb && pb.isBone && boneIdx.has(pb.name) ? boneIdx.get(pb.name) : -1;
    const W = [], P = [], L = [];
    for (let j = 0; j < N; j++) { frameFK(j); W.push(fk.Q[i].clone()); P.push(pi >= 0 ? fk.Q[pi].clone() : hipsParentQ.clone()); L.push(new THREE.Quaternion().fromArray(Qo, (j * B + i) * 4)); }
    const world = o.space === 'world', src = world ? W : L, mean = meanQuat(src), Wm = meanQuat(W), Wmi = Wm.clone().invert(), meanI = mean.clone().invert();
    const kx = 1 - o.amt * (o.pitch ? 1 : 0), ky = 1 - o.amt * (o.turn ? 1 : 0), kz = 1 - o.amt * (o.tilt ? 1 : 0);
    let peak0 = 0, peak1 = 0;
    for (let j = 0; j < N; j++) {
      let Ln;
      if (world) { logQ(src[j].clone().multiply(meanI), rv); }            // deviation in character axes
      else { logQ(meanI.clone().multiply(src[j]), rv); rv.applyQuaternion(Wm); }   // local deviation, seen in character axes
      peak0 = Math.max(peak0, rv.length());
      rv.set(rv.x * kx, rv.y * ky, rv.z * kz); peak1 = Math.max(peak1, rv.length());
      if (world) { const Wn = expV(rv.x, rv.y, rv.z, new THREE.Quaternion()).multiply(mean); Ln = P[j].clone().invert().multiply(Wn); }
      else { rv.applyQuaternion(Wmi); Ln = mean.clone().multiply(expV(rv.x, rv.y, rv.z, new THREE.Quaternion())); }
      Ln.normalize().toArray(Qo, (j * B + i) * 4);
    }
    rep.push(`${label.toLowerCase()} ±${(peak0 / DEG).toFixed(1)}° → ±${(peak1 / DEG).toFixed(1)}°`);
  }
  // hips steadied: the legs are re-solved so each foot keeps its spot and its turn from the original frame
  const hipsTouched = st.bob > 0 || st.sway > 0 || list.some(([k]) => k === 'hips');
  if (hipsTouched && st.feet) {
    const Hv = V3(), fe = {};
    for (let j = 0; j < N; j++) {
      applyPose(origQ.subarray(j * B * 4, (j + 1) * B * 4), Hv.fromArray(origH, j * 3));
      for (const Sd of ['L', 'R']) { const sd = rig.side[Sd]; fe[Sd] = { p: worldP(sd.foot), q: worldQ(sd.foot), k: worldP(sd.shin) }; }
      applyPose(Qo.subarray(j * B * 4, (j + 1) * B * 4), Hv.fromArray(Ho, j * 3));
      for (const Sd of ['L', 'R']) {
        const sd = rig.side[Sd], f = fe[Sd];
        const res = ikLimb(sd.leg, worldP(sd.thigh), f.p, f.k, V3(0, 0, 1));
        rig.setDelta(sd.thigh, res.d1); rig.setDelta(sd.shin, res.d2); rig.setDelta(sd.foot, f.q.clone().multiply(rig.bq(sd.foot).clone().invert()));
        for (const b of [sd.thigh, sd.shin, sd.foot]) b.quaternion.toArray(Qo, (j * B + boneIdx.get(b.name)) * 4);
      }
    }
    rep.push('feet kept planted');
  }
  return rep;
}
function stOpts() {
  return { steady: steadyOpts(),
    arms: $('stArms').value, legs: $('stLegs').value, w: clamp(+$('stW').value / 100, 0, 1),
    split: clamp(+$('stSplit').value / 100, 0.3, 0.7), retime: $('stRetime').checked, start: $('stStart').value,
    center: $('stCenter').checked, swing: $('stSwing').checked, mode: $('stMode').value, even: $('stEven').checked,
    ease: clamp(+$('stEase').value / 100, -0.8, 1), zone: clamp(+$('stZone').value / 100, 0.02, 0.45),
  };
}
// contacts in a cyclic list of foot heights: the main { on, off } of that foot, as phases (0…1)
function stContacts(ys) {
  const M = ys.length, lo = Math.min(...ys), down = ys.map((y) => y < lo + 0.02), spans = [];
  for (let k = 0; k < M; k++) {
    if (!down[k] || down[(k - 1 + M) % M]) continue;
    let e = k; while (down[(e + 1) % M] && e - k < M) e++;
    spans.push({ on: k / M, off: (e + 1) / M, len: e + 1 - k });
  }
  spans.sort((a, b) => b.len - a.len);
  return spans[0] || null;
}
// the forward swing of a foot (relative to the hips): back-most → passing under the hips → front-most, as phases
function stSwingOf(zs) {
  const M = zs.length; let kb = 0, kf = 0;
  zs.forEach((z, k) => { if (z < zs[kb]) kb = k; if (z > zs[kf]) kf = k; });
  let kp = null;
  for (let s = 0; s < M; s++) { const k = (kb + s) % M, k2 = (k + 1) % M; if (k === kf) break; if (zs[k] <= 0 && zs[k2] > 0) { kp = k + (0 - zs[k]) / (zs[k2] - zs[k]); break; } }
  if (kp == null) return null;
  return { back: kb / M, pass: mod1(kp / M), front: kf / M };
}
// a smooth, monotone, periodic map u (output phase) → source phase, through keys [{ u, r }] with r relative to r0
function stSpline(keys) {
  const K = keys.slice().sort((a, b) => a.u - b.u), n = K.length;
  const pt = (i) => { const w = Math.floor(i / n), k = K[((i % n) + n) % n]; return { u: k.u + w, r: k.r + w }; };
  const sec = (i) => { const a = pt(i), b = pt(i + 1); return (b.r - a.r) / (b.u - a.u); };
  const m = []; for (let i = 0; i < n; i++) { const d0 = sec(i - 1), d1 = sec(i); m.push(d0 * d1 <= 0 ? 0 : (2 * d0 * d1) / (d0 + d1)); }   // harmonic mean: no overshoot
  return (u) => {
    u = mod1(u); let i = n - 1; while (i > 0 && K[i].u > u) i--;
    if (K[0].u > u) i = -1;
    const a = pt(i), b = pt(i + 1), h = b.u - a.u, t = (u - a.u) / h, t2 = t * t, t3 = t2 * t;
    const ma = m[((i % n) + n) % n], mb = m[(((i + 1) % n) + n) % n];
    return (2 * t3 - 3 * t2 + 1) * a.r + (t3 - 2 * t2 + t) * h * ma + (-2 * t3 + 3 * t2) * b.r + (t3 - t2) * h * mb;
  };
}
function stLimbZ(Q, H, M) {
  const ids = [rig.side.L.hand, rig.side.R.hand, rig.side.L.foot, rig.side.R.foot].map((b) => boneIdx.get(b.name)), hi = boneIdx.get(rig.b.hips.name), z = ids.map(() => []);
  for (let k = 0; k < M; k++) { ST.fk.run(Q.subarray(k * B * 4, (k + 1) * B * 4), V3(H[k * 3], H[k * 3 + 1], H[k * 3 + 2]), 0); ids.forEach((bi, j) => z[j].push(ST.fk.P[bi].z - ST.fk.P[hi].z)); }
  return z.map((zs) => { const lo = Math.min(...zs), hi2 = Math.max(...zs), r = (hi2 - lo) / 2 || 1, c = (hi2 + lo) / 2; return zs.map((v) => (v - c) / r); });   // −1 … 1
}
const stEndsShare = (n, zone) => { let a = 0, t = 0; for (const s of n) for (const v of s) { t++; if (Math.abs(v) > 1 - 2 * zone) a++; } return a / Math.max(1, t); };
function stMeasure(Qs, Hs, M) {   // foot heights and forward offsets from the hips, per frame
  const fi = { L: boneIdx.get(rig.side.L.foot.name), R: boneIdx.get(rig.side.R.foot.name) }, hi = boneIdx.get(rig.b.hips.name);
  const ys = { L: [], R: [] }, zs = { L: [], R: [] };
  for (let k = 0; k < M; k++) {
    ST.fk.run(Qs.subarray(k * B * 4, (k + 1) * B * 4), V3(Hs[k * 3], Hs[k * 3 + 1], Hs[k * 3 + 2]), 0);
    for (const Sd of ['L', 'R']) { ys[Sd].push(ST.fk.P[fi[Sd]].y); zs[Sd].push(ST.fk.P[fi[Sd]].z - ST.fk.P[hi].z); }
  }
  return { contact: { L: stContacts(ys.L), R: stContacts(ys.R) }, swing: { L: stSwingOf(zs.L), R: stSwingOf(zs.R) } };
}
// Average (and Centre): each frame is averaged with the mirror of its partner frame (the same cycle half a cycle
// later, given as its own buffer). Rotations relative to the parent, in world axes, 50 % slerp × strength; side
// bones pair with their twin, centre bones with themselves. only: 'centre' (side bones keep their own motion) or
// 'arms' (shoulder → hand on both sides; every other bone and the hips keep their own motion).
function stMirrorAverageAB(Qa, Ha, Qb, Hb, N, strength, only = null) {
  const F = ST.fk, bones = rig.bones, twin = bones.map((b, i) => { const m = mirrorName(b.name); return m != null && boneIdx.has(m) ? boneIdx.get(m) : i; });
  const rel = (Q, H, k) => { F.run(Q.subarray(k * B * 4, (k + 1) * B * 4), V3(H[k * 3], H[k * 3 + 1], H[k * 3 + 2]), 0); const out = []; for (let i = 0; i < B; i++) { const p = F.parent[i]; out.push(p < 0 ? F.delta(i) : F.delta(p).invert().multiply(F.delta(i))); } return { D: out, root: F.Q[0].clone() }; };
  const ARM = new Set(); if (only === 'arms') for (const Sd of ['Left', 'Right']) for (const n of ['Shoulder', 'Arm', 'ForeArm', 'Hand']) { const i = rig.bones.findIndex((b) => normName(b.name) === (Sd + n).toLowerCase()); if (i >= 0) ARM.add(i); }
  let mx = 0; for (let k = 0; k < N; k++) mx += Ha[k * 3]; mx /= N;
  const mir = (q) => new THREE.Quaternion(q.x, -q.y, -q.z, q.w), f = 0.5 * strength, tmp = new THREE.Quaternion();
  const out = new Float32Array(Qa.length), Ho = Ha.slice();
  for (let k = 0; k < N; k++) {
    const A = rel(Qa, Ha, k), Bp = rel(Qb, Hb, k), dW = new Array(B), wW = new Array(B);
    for (let i = 0; i < B; i++) {
      const p = F.parent[i];
      if (p < 0) { dW[i] = A.root.clone().multiply(F.bqInv[i]); wW[i] = A.root.clone(); Qa.subarray((k * B + i) * 4, (k * B + i) * 4 + 4).forEach((v, c) => { out[(k * B + i) * 4 + c] = v; }); continue; }
      const side = twin[i] !== i, keep = (only === 'centre' && side) || (only === 'arms' && !ARM.has(i)), d = keep ? A.D[i].clone() : A.D[i].clone().slerp(mir(Bp.D[twin[i]]), f);
      dW[i] = dW[p].clone().multiply(d); wW[i] = dW[i].clone().multiply(F.bq[i]);
      tmp.copy(wW[p]).invert().multiply(wW[i]).toArray(out, (k * B + i) * 4);
    }
    if (only !== 'arms') Ho[k * 3] = mx + lerp(Ha[k * 3] - mx, -(Hb[k * 3] - mx), f); if (only !== 'arms') { Ho[k * 3 + 1] = lerp(Ha[k * 3 + 1], Hb[k * 3 + 1], f); Ho[k * 3 + 2] = lerp(Ha[k * 3 + 2], Hb[k * 3 + 2], f); }
  }
  Qa.set(out); Ha.set(Ho);
}
// ---------------------------------------------------------------- processing
// 1. one full cycle of the loaded clip, from a left-foot landing to the next (landings found to a fraction of a frame)
// 2. the right-foot landing splits it in two halves; each half is stretched uniformly to exactly half of the output,
//    so the right foot lands on the middle frame. Output frames = the clip's own frames per cycle, same cycle time.
//    A uniform stretch never lands two output frames on the same moment, so no frame repeats.
// 3. optional: even swing / swing ease (extra re-timing, each step kept ≥ half a normal frame step), then
//    Average (or Copy) for symmetry, frame by frame against the frame half a cycle away.
function stUpsample(Q, H, N, M) {   // a looping N-frame cycle resampled to M (rotations slerped, hips lerped)
  const Qu = new Float32Array(M * B * 4), Hu = new Float32Array(M * 3), a = new THREE.Quaternion(), b = new THREE.Quaternion();
  for (let k = 0; k < M; k++) {
    const f = (k / M) * N, i0 = Math.floor(f) % N, i1 = (i0 + 1) % N, u = f - Math.floor(f);
    for (let bi = 0; bi < B; bi++) { a.fromArray(Q, (i0 * B + bi) * 4); b.fromArray(Q, (i1 * B + bi) * 4); a.slerp(b, u).toArray(Qu, (k * B + bi) * 4); }
    for (let c = 0; c < 3; c++) Hu[k * 3 + c] = lerp(H[i0 * 3 + c], H[i1 * 3 + c], u);
  }
  return [Qu, Hu];
}
function stProcess() {
  const clip = ST.clip, o = stOpts(), keepCur = cur, keepBk = BAKED[clip.id];
  if (!ST.fk) ST.fk = new VirtualFK(rig);
  cur = clip; if (ST.src) BAKED[clip.id] = ST.src; else delete BAKED[clip.id];   // sample the loaded clip, not the preview
  const dur = clip.dur, N0 = Math.max(8, ST.src ? ST.src.n : clip.c.n || Math.round(dur * 30)), N = o.even && N0 % 2 ? N0 + 1 : N0, M = ST_M;   // even: the other foot's landing (half a cycle) falls on a frame
  const Qx = new Float32Array(B * 4), Hx = V3();
  const sample = (p, Q, H) => {   // the clip at cycle phase p (with the Copy-mode mirror)
    sampleClip(mod1(p) * dur, Q, H);
    if (o.mode === 'copy') for (const [region, dir] of [['arm', o.arms], ['leg', o.legs]]) {
      if (!dir) continue;
      sampleClip(mod1(p + o.split) * dur, Qx, Hx); symMirrorInto(Q, H, region + ':' + dir, o.w, Qx, Hx);
    }
  };
  const fill = (map, n) => { const Q = new Float32Array(n * B * 4), H = new Float32Array(n * 3), q = new Float32Array(B * 4), h = V3(); for (let j = 0; j < n; j++) { sample(map(j / n), q, h); Q.set(q, j * B * 4); h.toArray(H, j * 3); } return [Q, H]; };
  try {
    const [Qf0, Hf0] = fill((u) => u, M), before = stMeasure(Qf0, Hf0, M);
    const S0 = o.start, S1 = S0 === 'L' ? 'R' : 'L';
    let base = (u) => u, retimed = false;
    const none = o.mode === 'none';   // None: timing and poses as they are (Steadiness still applies)
    if (!none && o.retime && before.contact[S0] && before.contact[S1]) {
      const a = before.contact[S0].on, d1 = mod1(before.contact[S1].on - a) || 0.5;
      base = (u) => a + (u < 0.5 ? (u / 0.5) * d1 : d1 + ((u - 0.5) / 0.5) * (1 - d1));   // uniform in each half
      retimed = true;
    }
    // optional extra re-timing on top (u → u'), measured on the uniformly retimed cycle
    let remap = (u) => u;
    if (retimed && o.swing) {
      const [Qb, Hb] = fill(base, M), m = stMeasure(Qb, Hb, M), keys = [{ u: 0, r: 0 }, { u: 0.5, r: 0.5 }];
      for (const Sd of [S0, S1]) {
        const sw = m.swing[Sd]; if (!sw || !(mod1(sw.pass - sw.back) < mod1(sw.front - sw.back))) continue;
        const ub = sw.back, uf = ub + mod1(sw.front - ub);
        keys.push({ u: mod1(ub), r: mod1(ub) }, { u: mod1((ub + uf) / 2), r: sw.pass }, { u: mod1(uf), r: mod1(uf) });
      }
      keys.sort((x, y) => x.u - y.u);
      const ok = []; for (const k of keys) { const l = ok[ok.length - 1]; if (!l || (k.r > l.r + 1e-4 && k.u - l.u > 0.015)) ok.push(k); }
      if (ok.length > 2) remap = stSpline(ok);
    }
    let easeInfo = null;
    if (!none && Math.abs(o.ease) > 1e-3) {
      const r1 = remap, [Qe, He] = fill((u) => base(r1(u)), M), nz = stLimbZ(Qe, He, M);
      const sp = new Float32Array(M); for (let k = 0; k < M; k++) { let v = 0; for (const z of nz) v += Math.abs(z[(k + 1) % M] - z[k]); sp[k] = v + 1e-4; }
      const half = M / 2, cum = new Float32Array(M + 1); for (let k = 0; k < M; k++) cum[k + 1] = cum[k] + sp[k];
      const arcInv = (h, w) => { const a = cum[h * half], b = cum[(h + 1) * half], tg = a + w * (b - a); let lo = h * half, hi = (h + 1) * half; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] < tg) lo = mid; else hi = mid; } return (lo + (tg - cum[lo]) / Math.max(1e-9, cum[hi] - cum[lo])) / M; };
      const r2 = (u) => { u = clamp(u, 0, 1); const h = u >= 0.5 ? 1 : 0, w = (u - h * 0.5) / 0.5; return u + o.ease * (arcInv(Math.min(h, 1), clamp(w, 0, 1)) - u); };
      remap = (u) => r1(r2(u));
      easeInfo = { zone: o.zone, hands: [stEndsShare(nz.slice(0, 2), o.zone)], feet: [stEndsShare(nz.slice(2), o.zone)] };
    }
    // output nodes: no step smaller than half a normal frame step (so no frame nearly repeats), ends pinned
    const c = new Float64Array(N + 1); for (let j = 0; j <= N; j++) c[j] = remap(j / N);
    c[0] = 0; c[N] = 1;
    const minStep = 0.5 / N, st = []; for (let j = 0; j < N; j++) st.push(Math.max(minStep, c[j + 1] - c[j]));
    const ex = st.reduce((a, x) => a + (x - minStep), 0), room = 1 - minStep * N;
    for (let j = 0, acc = 0; j < N; j++) { acc += minStep + (ex > 0 ? ((st[j] - minStep) * room) / ex : room / N); c[j + 1] = acc; }
    const cAt = (u) => { const f = mod1(u) * N, i = Math.floor(f); return lerp(c[i], c[Math.min(N, i + 1)], f - i); };
    const [Qo, Ho] = fill((u) => base(cAt(u)), N);
    if (o.mode === 'arms') { const [Qp, Hp] = fill((u) => base(cAt(u + 0.5)), N); stMirrorAverageAB(Qo, Ho, Qp, Hp, N, o.w, 'arms'); }   // phase matching + arm swing matched
    else if (o.mode === 'avg') { const [Qp, Hp] = fill((u) => base(cAt(u + 0.5)), N); stMirrorAverageAB(Qo, Ho, Qp, Hp, N, o.w); }
    else if (o.mode === 'copy' && o.center) { const [Qp, Hp] = fill((u) => base(cAt(u + 0.5)), N); stMirrorAverageAB(Qo, Ho, Qp, Hp, N, 1, 'centre'); }
    const steadyRep = stSteady(Qo, Ho, N, o.steady);
    // contacts measured on a fine resample of the result, not on its frames: with an odd frame count the landing
    // half a cycle away falls between two frames, and a frame-by-frame reading put it up to half a frame late
    const [Qu, Hu] = stUpsample(Qo, Ho, N, M), after = stMeasure(Qu, Hu, M);
    if (retimed) for (const [Sd, at] of [[S0, 0], [S1, 0.5]]) {   // the retime put the landings exactly here
      const cc = after.contact[Sd]; if (!cc) continue;
      const d = ((cc.on - at + 0.5) % 1 + 1) % 1 - 0.5;
      if (Math.abs(d) < 1.5 / N) { cc.on -= d; cc.off -= d; }
    }
    if (easeInfo) { const nz = stLimbZ(Qo, Ho, N); easeInfo.hands.push(stEndsShare(nz.slice(0, 2), o.zone)); easeInfo.feet.push(stEndsShare(nz.slice(2), o.zone)); }
    const win = {};
    for (const Sd of ['L', 'R']) if (after.contact[Sd]) { const cc = after.contact[Sd]; win[Sd] = [cc.on, cc.on + mod1(cc.off - cc.on)]; }
    // frame steps: the smallest against a typical one (a repeated frame shows up as ~0 %)
    const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), steps = [];
    for (let j = 0; j < N; j++) { let mm = 0; for (let bI = 0; bI < B; bI++) { qa.fromArray(Qo, (j * B + bI) * 4); qb.fromArray(Qo, (((j + 1) % N) * B + bI) * 4); mm = Math.max(mm, qa.angleTo(qb)); } steps.push(mm); }
    const sorted = steps.slice().sort((x, y) => x - y), typical = sorted[Math.floor(N / 2)] || 1e-6;
    ST.res = { steady: steadyRep, ease: easeInfo, frames: N, minStep: sorted[0] / typical, seam: steps[N - 1] / typical, bk: { n: N, loop: true, fps: N / dur, q: Qo, hp: Ho, win }, before: before.contact, after: after.contact, swingBefore: before.swing, swingAfter: after.swing, dur, start: S0 };
  } finally { cur = keepCur; if (keepBk) BAKED[clip.id] = keepBk; else delete BAKED[clip.id]; }
  return ST.res;
}
const stSteps = (c, dur) => (c.L && c.R ? { LR: mod1(c.R.on - c.L.on) * dur, RL: mod1(c.L.on - c.R.on) * dur } : null);
function stDraw() {
  const cv = $('stStrip'), dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth || 300, h = 92;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.height = h + 'px';
  const x = cv.getContext('2d'), W = cv.width, H = cv.height, r = ST.res; if (!r) return;
  x.fillStyle = '#0b0e0c'; x.fillRect(0, 0, W, H);
  const pad = 58 * dpr, lane = (H - 20 * dpr) / 2, X = (p) => pad + p * (W - pad - 8 * dpr);
  x.font = `600 ${10 * dpr}px "Barlow", sans-serif`; x.textBaseline = 'middle';
  [['Before', r.before], ['After', r.after]].forEach(([lbl, c], row) => {
    const y0 = 4 * dpr + row * (lane + 12 * dpr);
    x.fillStyle = '#8d9892'; x.fillText(lbl, 6 * dpr, y0 + lane / 2);
    for (const [Sd, col, dy] of [['L', '#c98bd6', 0], ['R', '#ff8a4a', lane / 2]]) {
      const s = c[Sd]; if (!s) continue;
      x.fillStyle = col; x.globalAlpha = 0.85;
      const segs = s.off <= 1 ? [[s.on, s.off]] : [[s.on, 1], [0, s.off - 1]];
      for (const [a, b] of segs) x.fillRect(X(a), y0 + dy + 2 * dpr, Math.max(2, X(b) - X(a)), lane / 2 - 4 * dpr);
      x.globalAlpha = 1; x.fillText(Sd, X(s.on) + 3 * dpr, y0 + dy + lane / 4);
    }
    for (const p of [0, 0.25, 0.5, 0.75, 1]) { x.fillStyle = p % 0.5 === 0 ? '#e7ece8' : '#56615b'; x.fillRect(X(p), y0, 1, lane); }
  });
  x.fillStyle = '#8d9892'; x.textBaseline = 'bottom';
  for (const [p, t] of [[0, 'bar 1'], [0.5, '.2 (50 %)'], [1, 'bar 2']]) x.fillText(t, Math.min(X(p) + 2 * dpr, W - 44 * dpr), H - 1 * dpr);
  const sb = stSteps(r.before, r.dur), sa = stSteps(r.after, r.dur), f = (s) => (s ? `L→R ${s.LR.toFixed(3)} · R→L ${s.RL.toFixed(3)} s` : '—');
  const sw = (x) => { const v = x && x[r.start]; if (!v) return '—'; return `back→centre ${(mod1(v.pass - v.back) * r.dur).toFixed(3)} · centre→front ${(mod1(v.front - v.pass) * r.dur).toFixed(3)} s`; };
  const seamOk = r.seam < 2.2;
  $('stInfo').innerHTML = `Steps before: <b>${f(sb)}</b><br>Steps after: <b>${f(sa)}</b> · cycle ${r.dur.toFixed(3)} s<br>`
    + `${r.start} swing before: <b>${sw(r.swingBefore)}</b><br>${r.start} swing after: <b>${sw(r.swingAfter)}</b><br>`
    + (r.ease ? `Time in the outer ${Math.round(r.ease.zone * 100)} % of the swing — hands: <b>${Math.round(r.ease.hands[0] * 100)} % → ${Math.round(r.ease.hands[1] * 100)} %</b> · feet: <b>${Math.round(r.ease.feet[0] * 100)} % → ${Math.round(r.ease.feet[1] * 100)} %</b><br>` : '')
    + (r.ease && Math.abs(stOpts().ease) > 1e-3 ? '<span class="dim">Swing ease is applied last, so the even swing above is what is left after it (ease 0 = exact even swing).</span><br>' : '')
    + `Frames: <b>${r.frames}</b> per cycle (the clip's own) · smallest frame step <b class="${r.minStep > 0.3 ? 'ok' : 'warn'}">${Math.round(r.minStep * 100)} %</b> of a typical one ${r.minStep > 0.3 ? '· no repeated frames ✓' : '· a frame barely moves'}<br>`
    + `Loop seam: <b class="${seamOk ? 'ok' : 'warn'}">${seamOk ? 'smooth ✓' : 'jump ×' + r.seam.toFixed(1) + ' — check the clip'}</b> (last → first frame vs a typical frame)`
    + (r.steady && r.steady.length ? `<br>Steadiness: <b>${r.steady.join(' · ')}</b>` : '');
}
function stRun() {   // process + live preview on the character
  if (!ST.clip || ST.busy) return;
  ST.busy = true;
  try {
    stProcess(); stDraw();
    BAKED[ST.clip.id] = ST.res.bk; ST.saved = false;
    editVersion++; moveEndCache = null; rebuildSpeedLUT(); gridCache = null; layoutLanes(); trailDirty = true;
    $('stNote').textContent = 'Previewing on the character. Save to keep it.';
  } catch (err) { $('stNote').textContent = 'Could not process: ' + err.message; console.error(err); }
  ST.busy = false;
}
function stLoad(id) {
  stDiscard();
  const c = clips.find((x) => x.id === id); if (!c) return;
  if (cur.id !== c.id) selectClip(c.id);
  ST.clip = c; ST.src = BAKED[c.id] || c.c.origBk; ST.saved = true;
  stFillVersions();
  stRun();
}
function stDiscard() {   // leaving without saving: the clip goes back to what it was
  if (ST.clip && !ST.saved) { if (ST.src) BAKED[ST.clip.id] = ST.src; else delete BAKED[ST.clip.id]; editVersion++; rebuildSpeedLUT(); gridCache = null; layoutLanes(); }
  ST.clip = null; ST.res = null;
}
// versions: every save is kept (newest 8 per clip), and any of them — or the original — can be brought back
const packBk = (bk) => ({ n: bk.n, loop: true, fps: bk.fps, q: f32ToB64(bk.q), hp: f32ToB64(bk.hp), win: bk.win });
const unpackBk = (b) => ({ n: b.n, loop: b.loop, fps: b.fps, q: b64ToF32(b.q), hp: b64ToF32(b.hp), win: b.win });
function stVersions() { store.versions = store.versions || {}; return (store.versions[ST.clip.id] = store.versions[ST.clip.id] || []); }
function stFillVersions() {
  const sel = $('stVer'); sel.textContent = '';
  const add = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.append(o); };
  add('orig', 'Original clip');
  stVersions().forEach((v, i) => add(String(i), `v${i + 1} · ${new Date(v.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}${v.label ? ' · ' + v.label : ''}`));
  const ci = stVersions().findIndex((v) => v.current);
  sel.value = BAKED[ST.clip.id] && ci >= 0 ? String(ci) : 'orig';
}
function stRestore(which) {
  const id = ST.clip.id, vs = stVersions();
  if (which === 'orig') { delete BAKED[id]; if (store.baked) delete store.baked[id]; ST.src = undefined; }
  else { const v = vs[+which]; if (!v) return; const bk = unpackBk(v); BAKED[id] = bk; store.baked = store.baked || {}; store.baked[id] = packBk(bk); ST.src = bk; }
  vs.forEach((v, i) => { v.current = String(i) === which; });
  ST.saved = true; ST.res = null;
  editVersion++; moveEndCache = null; rebuildSpeedLUT(); gridCache = null; layoutLanes(); trailDirty = true; save(); markBakedClips(); stFillVersions();
  const c = $('stStrip'); c.getContext('2d').clearRect(0, 0, c.width, c.height); $('stInfo').textContent = '';
  $('stNote').textContent = which === 'orig' ? `"${ST.clip.name}" is back to its original motion. Change a setting to process it again.` : `Restored v${+which + 1}. Change a setting to process it again.`;
}
function stSave() {
  if (!ST.res) return;
  const bk = ST.res.bk; BAKED[ST.clip.id] = bk; ST.src = bk; ST.saved = true;
  try {
    store.baked = store.baked || {}; store.baked[ST.clip.id] = packBk(bk);
    const vs = stVersions(); vs.forEach((v) => { v.current = false; });
    const o = stOpts(); vs.push({ ...packBk(bk), at: Date.now(), current: true, label: [o.mode === 'none' ? 'no change' : o.mode === 'phase' ? 'phase match' : o.mode === 'arms' ? 'phase match + arms avg' : o.mode === 'avg' ? 'average' : [o.arms && 'arms ' + o.arms, o.legs && 'legs ' + o.legs].filter(Boolean).join(', '), o.retime && 'feet on bars', o.swing && 'even swing'].filter(Boolean).join(', ') });
    while (vs.length > 8) vs.shift();
  } catch { /* storage full: the session keeps it */ }
  save(); markBakedClips(); stFillVersions();
  $('stNote').textContent = `Saved: "${ST.clip.name}" now plays the symmetrized clip. On the timeline its feet fall on the bars (Grid → Cycles).`;
}
function stFrames(cycles, travel) {   // the clip repeated `cycles` times (+ the closing frame)
  const bk = ST.res.bk, n = bk.n, N = Math.max(1, Math.round(cycles)) * n + 1, q = new Float32Array(N * B * 4), hp = new Float32Array(N * 3);
  const c = ST.clip.c, spd = travel ? c.speed || 0 : 0, dir = c.dir || 0;
  for (let k = 0; k < N; k++) {
    const j = k % n; q.set(bk.q.subarray(j * B * 4, (j + 1) * B * 4), k * B * 4);
    const t = k / bk.fps;
    hp[k * 3] = bk.hp[j * 3] + Math.sin(dir) * spd * t; hp[k * 3 + 1] = bk.hp[j * 3 + 1]; hp[k * 3 + 2] = bk.hp[j * 3 + 2] + Math.cos(dir) * spd * t;
  }
  return { n: N, fps: bk.fps, q, hp };
}
async function stExport(kind) {
  if (!ST.res) return;
  if (!caps.downloads) { $('stNote').textContent = 'Downloads are not available in this view.'; return; }
  const cycles = clamp(+$('stCycles').value || 1, 1, 200), fr = stFrames(cycles, $('stTravel').checked), base = `${ST.clip.c.name}_sym_${cycles}cyc`;
  try {
    $('stNote').textContent = 'Building…';
    let data, fn;
    if (kind === 'fbx') { data = zipStore([{ name: base + '.fbx', data: buildFbx(fr, base) }]); fn = `${base}_fbx.zip`; }
    else { data = zipStore([{ name: base + '.glb', data: await glbFromFrames(fr, base) }]); fn = `${base}_gltf.zip`; }
    await caps.downloads.save({ filename: fn, data });
    $('stNote').textContent = `Saved ${fn} (${cycles} cycles, ${fr.n} frames at ${fr.fps.toFixed(1)} fps${$('stTravel').checked ? ', with travel' : ', in place'}).`;
  } catch (e) { $('stNote').textContent = e && e.code === 'declined' ? 'Download cancelled.' : 'Export failed: ' + ((e && (e.message || e.code)) || 'error'); console.error(e); }
}
async function glbFromFrames(fr, name) {
  const times = Float32Array.from({ length: fr.n }, (_, k) => k / fr.fps), bones = rig.bones;
  const tracks = bones.map((b, j) => { const v = new Float32Array(fr.n * 4); for (let k = 0; k < fr.n; k++) v.set(fr.q.subarray((k * B + j) * 4, (k * B + j) * 4 + 4), k * 4); return new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, v); });
  const hv = new Float32Array(fr.n * 3), p = V3();
  for (let k = 0; k < fr.n; k++) { p.set(fr.hp[k * 3], fr.hp[k * 3 + 1], fr.hp[k * 3 + 2]); rig.b.hips.parent.worldToLocal(p); p.toArray(hv, k * 3); }
  tracks.push(new THREE.VectorKeyframeTrack(rig.b.hips.name + '.position', times, hv));
  return new Uint8Array(await new GLTFExporter().parseAsync(model, { binary: true, animations: [new THREE.AnimationClip(name, times[fr.n - 1], tracks)], onlyVisible: true }));
}
function openSymTool() {
  const sel = $('stClip'); sel.textContent = '';
  for (const c of clips.filter((x) => x.kind === 'loop')) { const o = document.createElement('option'); o.value = c.id; o.textContent = c.label + (BAKED[c.id] ? ' · baked' : ''); sel.append(o); }
  sel.value = cur.kind === 'loop' ? cur.id : sel.options[0].value;
  $('symTool').hidden = false; $('stSaveProj').hidden = !caps.db; stModeUI();
  stLoad(sel.value);
}
$('btnSym').onclick = openSymTool;
$('stClip').onchange = () => stLoad($('stClip').value);
for (const id of ['stArms', 'stLegs', 'stRetime', 'stStart', 'stSplit', 'stCenter', 'stSwing', 'stZone', 'stEven']) $(id).onchange = stRun;
$('stEase').oninput = () => { $('stEasev').textContent = (+$('stEase').value > 0 ? '+' : '') + $('stEase').value; };
$('stEase').onchange = stRun;
buildSteadyUI();
$('stMode').onchange = () => { stModeUI(); stRun(); };
function stModeUI() { const m = $('stMode').value; for (const el of document.querySelectorAll('.copyonly')) el.hidden = m !== 'copy'; for (const el of document.querySelectorAll('.wonly')) el.hidden = m === 'phase' || m === 'none'; }
$('stW').oninput = () => { $('stWv').textContent = $('stW').value + '%'; };
$('stW').onchange = stRun;
$('stSave').onclick = stSave;
$('stRestore').onclick = () => stRestore($('stVer').value);
$('stRevert').onclick = () => confirmDelete(`Put the original "${ST.clip.name}" back? (Saved versions stay in the list.)`, () => stRestore('orig'), 'Revert');
$('stSaveProj').onclick = async () => {
  stSave();
  try { await caps.db.doc('baked/' + ST.clip.id.replace(/[^A-Za-z0-9_.~:@+-]/g, '_')).set({ ...bakedDoc(), savedAt: Date.now() }); $('stNote').textContent += ' Also saved to the project store: ask Claude to apply it.'; }
  catch (e) { $('stNote').textContent = 'Could not save to the project (' + ((e && e.code) || 'error') + ').'; }
};
$('stFbx').onclick = () => stExport('fbx');
$('stGlb').onclick = () => stExport('glb');
$('stClose').onclick = () => { stDiscard(); $('symTool').hidden = true; };
