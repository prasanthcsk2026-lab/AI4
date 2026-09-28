
// ============================================================================
//  SYMMETRIZE TOOL (a panel): load an in-place loop, mirror arms / legs onto the other side half a cycle later,
//  and retime the cycle so the feet land exactly on the bars (start foot at 0 %, the other at 50 %, the start
//  foot again at 100 %). It previews live on the character; Save replaces the clip (the timeline then shows
//  the feet on the bars, however many cycles), Save to project stores it for the project files, and the clip
//  can be exported with any number of cycles as FBX or glTF.
// ============================================================================
const ST = { clip: null, src: undefined, saved: false, res: null, fk: null, busy: false };
const ST_M = 240;   // working samples per cycle
function stOpts() {
  return {
    arms: $('stArms').value, legs: $('stLegs').value, w: clamp(+$('stW').value / 100, 0, 1),
    split: clamp(+$('stSplit').value / 100, 0.3, 0.7), retime: $('stRetime').checked, start: $('stStart').value,
    center: $('stCenter').checked, swing: $('stSwing').checked,
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
// hips / spine / neck / head: average each frame with the mirror of the frame half a cycle away, so the body sways alike both ways
function stCenterSym(Qs, Hs, M) {
  const b = rig.b, chain = [b.hips, b.spine, b.spine1, b.spine2, b.neck, b.head].map((x) => boneIdx.get(x.name)), F = ST.fk;
  const D = chain.map(() => []), rootQ = [], mx = (() => { let s = 0; for (let k = 0; k < M; k++) s += Hs[k * 3]; return s / M; })();
  for (let k = 0; k < M; k++) {   // each link's rotation relative to its parent, in world (bind) axes
    F.run(Qs.subarray(k * B * 4, (k + 1) * B * 4), V3(Hs[k * 3], Hs[k * 3 + 1], Hs[k * 3 + 2]), 0);
    chain.forEach((bi, c) => { const p = F.parent[bi]; D[c].push(F.delta(p).invert().multiply(F.delta(bi))); });
    rootQ.push(F.Q[F.parent[chain[0]]].clone());
  }
  const half = M / 2, mir = (q) => new THREE.Quaternion(q.x, -q.y, -q.z, q.w), out = new THREE.Quaternion();
  const Hn = Hs.slice();
  for (let k = 0; k < M; k++) {
    const k2 = (k + half) % M;
    let pWorld = rootQ[k], pDelta = pWorld.clone().multiply(F.bqInv[F.parent[chain[0]]]);
    chain.forEach((bi, c) => {
      const d = D[c][k].clone().slerp(mir(D[c][k2]), 0.5), delta = pDelta.clone().multiply(d), world = delta.clone().multiply(F.bq[bi]);
      out.copy(pWorld).invert().multiply(world).toArray(Qs, (k * B + bi) * 4);
      pDelta = delta; pWorld = world;
    });
    Hn[k * 3] = mx + ((Hs[k * 3] - mx) - (Hs[k2 * 3] - mx)) / 2; Hn[k * 3 + 1] = (Hs[k * 3 + 1] + Hs[k2 * 3 + 1]) / 2; Hn[k * 3 + 2] = (Hs[k * 3 + 2] + Hs[k2 * 3 + 2]) / 2;
  }
  Hs.set(Hn);
}
function stMeasure(Qs, Hs, M) {   // foot heights and forward offsets from the hips, per frame
  const fi = { L: boneIdx.get(rig.side.L.foot.name), R: boneIdx.get(rig.side.R.foot.name) }, hi = boneIdx.get(rig.b.hips.name);
  const ys = { L: [], R: [] }, zs = { L: [], R: [] };
  for (let k = 0; k < M; k++) {
    ST.fk.run(Qs.subarray(k * B * 4, (k + 1) * B * 4), V3(Hs[k * 3], Hs[k * 3 + 1], Hs[k * 3 + 2]), 0);
    for (const Sd of ['L', 'R']) { ys[Sd].push(ST.fk.P[fi[Sd]].y); zs[Sd].push(ST.fk.P[fi[Sd]].z - ST.fk.P[hi].z); }
  }
  return { contact: { L: stContacts(ys.L), R: stContacts(ys.R) }, swing: { L: stSwingOf(zs.L), R: stSwingOf(zs.R) } };
}
function stProcess() {
  const clip = ST.clip, o = stOpts(), keepCur = cur, keepBk = BAKED[clip.id];
  if (!ST.fk) ST.fk = new VirtualFK(rig);
  cur = clip; if (ST.src) BAKED[clip.id] = ST.src; else delete BAKED[clip.id];   // sample the loaded clip, not the preview
  const M = ST_M, dur = clip.dur, Q0 = new Float32Array(M * B * 4), H0 = new Float32Array(M * 3), Qs = new Float32Array(M * B * 4), Hs = new Float32Array(M * 3);
  const Q = new Float32Array(B * 4), Qx = new Float32Array(B * 4), H = V3(), Hx = V3();
  try {
    for (let k = 0; k < M; k++) {
      const tau = (k / M) * dur;
      sampleClip(tau, Q, H); Q0.set(Q, k * B * 4); H.toArray(H0, k * 3);
      for (const [region, dir] of [['arm', o.arms], ['leg', o.legs]]) {
        if (!dir) continue;
        sampleClip(tau + o.split * dur, Qx, Hx);   // the whole cycle of the other side, half a cycle away: no old data is left
        symMirrorInto(Q, H, region + ':' + dir, o.w, Qx, Hx);
      }
      Qs.set(Q, k * B * 4); H.toArray(Hs, k * 3);
    }
  } finally { cur = keepCur; if (keepBk) BAKED[clip.id] = keepBk; else delete BAKED[clip.id]; }
  if (o.center) stCenterSym(Qs, Hs, M);
  const before = stMeasure(Q0, H0, M), mid = stMeasure(Qs, Hs, M);
  // retime keys (output phase u ← source phase r, all relative to the start foot's landing)
  let warp = (u) => u;
  const S0 = o.start, S1 = S0 === 'L' ? 'R' : 'L';
  if (o.retime && mid.contact[S0] && mid.contact[S1]) {
    const a = mid.contact[S0].on, rel = (p) => mod1(p - a), d1 = rel(mid.contact[S1].on) || 0.5;
    const keys = [{ u: 0, r: 0 }, { u: 0.5, r: d1 }];
    const lin = (r) => (r < d1 ? (r / d1) * 0.5 : 0.5 + ((r - d1) / (1 - d1)) * 0.5);   // landings-only map, for placing the swing keys
    if (o.swing) {   // back → passing = passing → front, for the start foot, and half a cycle later for the other one
      for (const Sd of [S0, S1]) {
        const sw = mid.swing[Sd]; if (!sw) continue;
        const rb = rel(sw.back), rp = rel(sw.pass), rf = rel(sw.front);
        if (!(mod1(rp - rb) < mod1(rf - rb))) continue;
        const ub = lin(rb), uf = ub + mod1(lin(rf) - ub), up = mod1((ub + uf) / 2);
        keys.push({ u: mod1(ub), r: rb }, { u: mod1(up), r: rp }, { u: mod1(uf), r: rf });   // back, passing, front pinned
      }
    }
    keys.sort((x, y) => x.u - y.u);
    const ok = [];   // keep the keys that stay in order (source and output both increasing, a little apart)
    for (const k of keys) { const last = ok[ok.length - 1]; if (!last || (k.r > last.r + 1e-4 && k.u - last.u > 0.015)) ok.push(k); }
    const sp = stSpline(ok);
    warp = (u) => a + sp(u);
  }
  const n = 64, q = new Float32Array(n * B * 4), hp = new Float32Array(n * 3);
  for (let j = 0; j < n; j++) {
    const f = mod1(warp(j / n)) * M, i0 = Math.floor(f) % M, i1 = (i0 + 1) % M, u = f - Math.floor(f);
    for (let bI = 0; bI < B; bI++) {
      const o0 = (i0 * B + bI) * 4, o1 = (i1 * B + bI) * 4, d = (j * B + bI) * 4;
      let x1 = Qs[o1], y1 = Qs[o1 + 1], z1 = Qs[o1 + 2], w1 = Qs[o1 + 3];
      if (Qs[o0] * x1 + Qs[o0 + 1] * y1 + Qs[o0 + 2] * z1 + Qs[o0 + 3] * w1 < 0) { x1 = -x1; y1 = -y1; z1 = -z1; w1 = -w1; }
      const x = lerp(Qs[o0], x1, u), y = lerp(Qs[o0 + 1], y1, u), z = lerp(Qs[o0 + 2], z1, u), w = lerp(Qs[o0 + 3], w1, u), l = Math.hypot(x, y, z, w) || 1;
      q[d] = x / l; q[d + 1] = y / l; q[d + 2] = z / l; q[d + 3] = w / l;
    }
    for (let c = 0; c < 3; c++) hp[j * 3 + c] = lerp(Hs[i0 * 3 + c], Hs[i1 * 3 + c], u);
  }
  // measure the result (at a finer resampling of the output) and check the loop seam
  const after = stMeasure(q, hp, n);
  const win = {};
  for (const Sd of ['L', 'R']) if (after.contact[Sd]) { const c = after.contact[Sd]; win[Sd] = [c.on, c.on + mod1(c.off - c.on)]; }
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), steps = [];
  for (let j = 0; j < n; j++) { let m = 0; for (let bI = 0; bI < B; bI++) { qa.fromArray(q, (j * B + bI) * 4); qb.fromArray(q, (((j + 1) % n) * B + bI) * 4); m = Math.max(m, qa.angleTo(qb)); } steps.push(m); }
  const seam = steps[n - 1], typical = steps.slice(0, n - 1).sort((x, y) => x - y)[Math.floor((n - 1) / 2)];
  ST.res = { bk: { n, loop: true, fps: n / dur, q, hp, win }, before: before.contact, after: after.contact, swingBefore: before.swing, swingAfter: after.swing, dur, seam: seam / Math.max(typical, 1e-6), start: S0 };
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
    + `Loop seam: <b class="${seamOk ? 'ok' : 'warn'}">${seamOk ? 'smooth ✓' : 'jump ×' + r.seam.toFixed(1) + ' — check the clip'}</b> (last → first frame vs a typical frame)`;
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
  ST.clip = c; ST.src = BAKED[c.id]; ST.saved = true;
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
    const o = stOpts(); vs.push({ ...packBk(bk), at: Date.now(), current: true, label: [o.arms && 'arms ' + o.arms, o.legs && 'legs ' + o.legs, o.retime && 'feet on bars'].filter(Boolean).join(', ') });
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
  $('symTool').hidden = false; $('stSaveProj').hidden = !caps.db;
  stLoad(sel.value);
}
$('btnSym').onclick = openSymTool;
$('stClip').onchange = () => stLoad($('stClip').value);
for (const id of ['stArms', 'stLegs', 'stRetime', 'stStart', 'stSplit', 'stCenter', 'stSwing']) $(id).onchange = stRun;
$('stW').oninput = () => { $('stWv').textContent = $('stW').value + '%'; };
$('stW').onchange = stRun;
$('stSave').onclick = stSave;
$('stRestore').onclick = () => stRestore($('stVer').value);
$('stRevert').onclick = () => stRestore('orig');
$('stSaveProj').onclick = async () => {
  stSave();
  try { await caps.db.doc('baked/' + ST.clip.id.replace(/[^A-Za-z0-9_.~:@+-]/g, '_')).set({ ...bakedDoc(), savedAt: Date.now() }); $('stNote').textContent += ' Also saved to the project store: ask Claude to apply it.'; }
  catch (e) { $('stNote').textContent = 'Could not save to the project (' + ((e && e.code) || 'error') + ').'; }
};
$('stFbx').onclick = () => stExport('fbx');
$('stGlb').onclick = () => stExport('glb');
$('stClose').onclick = () => { stDiscard(); $('symTool').hidden = true; };
