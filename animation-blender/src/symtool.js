
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
  };
}
// contacts in a cyclic list of foot heights: [{ on, off }] as phases (0…1)
function stContacts(ys) {
  const M = ys.length, lo = Math.min(...ys), down = ys.map((y) => y < lo + 0.02), spans = [];
  for (let k = 0; k < M; k++) {
    if (!down[k] || down[(k - 1 + M) % M]) continue;
    let e = k; while (down[(e + 1) % M] && e - k < M) e++;
    spans.push({ on: k / M, off: (e + 1) / M, len: e + 1 - k });
  }
  spans.sort((a, b) => b.len - a.len);
  return spans[0] || null;   // the main contact of that foot in the cycle
}
function stProcess() {
  const clip = ST.clip, o = stOpts(), keepCur = cur, keepBk = BAKED[clip.id];
  if (!ST.fk) ST.fk = new VirtualFK(rig);
  cur = clip; if (ST.src) BAKED[clip.id] = ST.src; else delete BAKED[clip.id];   // sample the loaded clip, not the preview
  const M = ST_M, dur = clip.dur, Qs = new Float32Array(M * B * 4), Hs = new Float32Array(M * 3);
  const Q = new Float32Array(B * 4), Qx = new Float32Array(B * 4), H = V3(), Hx = V3();
  const fi = { L: boneIdx.get(rig.side.L.foot.name), R: boneIdx.get(rig.side.R.foot.name) };
  const ysBefore = { L: [], R: [] }, ysAfter = { L: [], R: [] };
  try {
    for (let k = 0; k < M; k++) {
      const tau = (k / M) * dur;
      sampleClip(tau, Q, H);
      ST.fk.run(Q, H, 0); ysBefore.L.push(ST.fk.P[fi.L].y); ysBefore.R.push(ST.fk.P[fi.R].y);
      for (const [region, dir] of [['arm', o.arms], ['leg', o.legs]]) {
        if (!dir) continue;
        sampleClip(tau + o.split * dur, Qx, Hx);
        symMirrorInto(Q, H, region + ':' + dir, o.w, Qx, Hx);
      }
      Qs.set(Q, k * B * 4); H.toArray(Hs, k * 3);
      ST.fk.run(Q, H, 0); ysAfter.L.push(ST.fk.P[fi.L].y); ysAfter.R.push(ST.fk.P[fi.R].y);
    }
  } finally { cur = keepCur; if (keepBk) BAKED[clip.id] = keepBk; else delete BAKED[clip.id]; }
  const before = { L: stContacts(ysBefore.L), R: stContacts(ysBefore.R) }, mid = { L: stContacts(ysAfter.L), R: stContacts(ysAfter.R) };
  // retime: a piecewise-linear warp of the cycle so the start foot lands at 0 and the other foot at 0.5
  let warp = (u) => u, unwarp = (p) => p;
  if (o.retime && mid.L && mid.R) {
    const a = o.start === 'L' ? mid.L.on : mid.R.on, bOn = o.start === 'L' ? mid.R.on : mid.L.on, d1 = mod1(bOn - a) || 0.5;
    warp = (u) => a + (u < 0.5 ? (u / 0.5) * d1 : d1 + ((u - 0.5) / 0.5) * (1 - d1));
    unwarp = (p) => { const r = mod1(p - a); return r < d1 ? (r / d1) * 0.5 : 0.5 + ((r - d1) / (1 - d1)) * 0.5; };
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
  const win = {};
  for (const Sd of ['L', 'R']) if (mid[Sd]) { const on = unwarp(mid[Sd].on), off = on + mod1(unwarp(mid[Sd].off) - on); win[Sd] = [on, off]; }
  const after = { L: win.L ? { on: win.L[0], off: win.L[1] } : null, R: win.R ? { on: win.R[0], off: win.R[1] } : null };
  ST.res = { bk: { n, loop: true, fps: n / dur, q, hp, win }, before, after, dur };
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
  $('stInfo').innerHTML = `Steps before: <b>${f(sb)}</b><br>Steps after: <b>${f(sa)}</b> · cycle ${r.dur.toFixed(3)} s`;
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
  stRun();
}
function stDiscard() {   // leaving without saving: the clip goes back to what it was
  if (ST.clip && !ST.saved) { if (ST.src) BAKED[ST.clip.id] = ST.src; else delete BAKED[ST.clip.id]; editVersion++; rebuildSpeedLUT(); gridCache = null; layoutLanes(); }
  ST.clip = null; ST.res = null;
}
function stSave() {
  if (!ST.res) return;
  const bk = ST.res.bk; BAKED[ST.clip.id] = bk; ST.src = bk; ST.saved = true;
  try { store.baked = store.baked || {}; store.baked[ST.clip.id] = { n: bk.n, loop: true, fps: bk.fps, q: f32ToB64(bk.q), hp: f32ToB64(bk.hp), win: bk.win }; } catch { /* storage full */ }
  save(); markBakedClips();
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
for (const id of ['stArms', 'stLegs', 'stRetime', 'stStart', 'stSplit']) $(id).onchange = stRun;
$('stW').oninput = () => { $('stWv').textContent = $('stW').value + '%'; };
$('stW').onchange = stRun;
$('stSave').onclick = stSave;
$('stSaveProj').onclick = async () => {
  stSave();
  try { await caps.db.doc('baked/' + ST.clip.id.replace(/[^A-Za-z0-9_.~:@+-]/g, '_')).set({ ...bakedDoc(), savedAt: Date.now() }); $('stNote').textContent += ' Also saved to the project store: ask Claude to apply it.'; }
  catch (e) { $('stNote').textContent = 'Could not save to the project (' + ((e && e.code) || 'error') + ').'; }
};
$('stFbx').onclick = () => stExport('fbx');
$('stGlb').onclick = () => stExport('glb');
$('stClose').onclick = () => { stDiscard(); $('symTool').hidden = true; };
