
// ============================================================================
//  BAKE & REPLACE, SAVE TO PROJECT, EXPORT THE BAKED CLIP
//  Bake samples the finished result (FK automation, groups, symmetrize, IK) frame by frame, in place, and
//  makes it the clip itself: the clip plays from the baked frames from then on and the automation starts
//  clean. Baked clips are kept in this browser; "Save to project" also stores them in the artifact's
//  database, where Claude can pick them up and write them into the project files.
// ============================================================================
const BAKED = {};   // clip id → { n, loop, fps, q: Float32Array (n × bones × 4, local), hp: Float32Array (n × 3, hips world, in place) }
const f32ToB64 = (f) => { const u = new Uint8Array(f.buffer, f.byteOffset, f.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const b64ToF32 = (b) => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Float32Array(u.buffer); };

function sampleBaked(bk, tau, Q, H) {
  let i0, i1, u;
  if (bk.loop) { const f = mod1(tau / cur.dur) * bk.n; i0 = Math.floor(f) % bk.n; i1 = (i0 + 1) % bk.n; u = f - Math.floor(f); }
  else { const f = clamp((cur.dur > 0 ? (tau % cur.dur) / cur.dur : 0) * (bk.n - 1), 0, bk.n - 1); i0 = Math.floor(f); i1 = Math.min(bk.n - 1, i0 + 1); u = f - i0; }
  const q = bk.q;
  for (let b = 0; b < B; b++) {
    const o0 = (i0 * B + b) * 4, o1 = (i1 * B + b) * 4;
    let x1 = q[o1], y1 = q[o1 + 1], z1 = q[o1 + 2], w1 = q[o1 + 3];
    if (q[o0] * x1 + q[o0 + 1] * y1 + q[o0 + 2] * z1 + q[o0 + 3] * w1 < 0) { x1 = -x1; y1 = -y1; z1 = -z1; w1 = -w1; }
    const x = lerp(q[o0], x1, u), y = lerp(q[o0 + 1], y1, u), z = lerp(q[o0 + 2], z1, u), w = lerp(q[o0 + 3], w1, u), l = Math.hypot(x, y, z, w) || 1;
    Q[b * 4] = x / l; Q[b * 4 + 1] = y / l; Q[b * 4 + 2] = z / l; Q[b * 4 + 3] = w / l;
  }
  const h = bk.hp; H.set(lerp(h[i0 * 3], h[i1 * 3], u), lerp(h[i0 * 3 + 1], h[i1 * 3 + 1], u), lerp(h[i0 * 3 + 2], h[i1 * 3 + 2], u));
}
function bakeFrames() {   // the finished pose at every frame of one clip cycle (loops) or of the move, in place
  const loop = cur.kind === 'loop', fps = 30;
  const n = loop ? Math.max(8, cur.c.n || Math.round(cur.dur * fps)) : Math.max(2, Math.round(cur.dur * fps) + 1);
  const q = new Float32Array(n * B * 4), hp = new Float32Array(n * 3);
  const keep = { inPlace: S.inPlace, base: S.travelBase.clone() };
  S.inPlace = true; S.travelBase.set(0, 0, 0);
  const total = S.speedLUT[S.speedLUT.length - 1];
  try {
    for (let k = 0; k < n; k++) {
      const ct = loop ? (k / n) * cur.dur : (k / (n - 1)) * cur.dur;
      evaluate(ct <= total ? timeOfClipTime(ct) : ct, null);
      rig.bones.forEach((b, j) => b.quaternion.toArray(q, (k * B + j) * 4));
      worldP(rig.b.hips).toArray(hp, k * 3);
    }
  } finally { S.inPlace = keep.inPlace; S.travelBase.copy(keep.base); }
  return { n, loop, fps, q, hp };
}
function bakeAndReplace() {
  const bk = bakeFrames();
  BAKED[cur.id] = bk;
  try { store.baked = store.baked || {}; store.baked[cur.id] = { n: bk.n, loop: bk.loop, fps: bk.fps, q: f32ToB64(bk.q), hp: f32ToB64(bk.hp) }; } catch { /* storage full: the session keeps it */ }
  A = newAuto(S.dur); S.selected = S.selEff = S.selGroup = null;
  undoStack = []; redoStack = [];   // the old automation belonged to the old clip
  moveEndCache = null; rebuildSpeedLUT(); rebuildRows(); save(); afterSelect(); markBakedClips();
  return `Baked ${bk.n} frames into "${cur.name}". It now plays the baked motion; the timeline starts clean.`;
}
function revertBake() {
  if (!BAKED[cur.id]) return 'This clip is not baked.';
  delete BAKED[cur.id]; if (store.baked) delete store.baked[cur.id];
  editVersion++; rebuildSpeedLUT(); save(); markBakedClips();
  return `"${cur.name}" is back to the original motion.`;
}
function loadBaked() {
  for (const [id, b] of Object.entries(store.baked || {})) {
    try { const q = b64ToF32(b.q); if (q.length !== b.n * B * 4) continue; BAKED[id] = { n: b.n, loop: b.loop, fps: b.fps, q, hp: b64ToF32(b.hp) }; } catch { /* skip a broken entry */ }
  }
  markBakedClips();
}
function markBakedClips() {
  for (const o of $('clipSel').querySelectorAll('option')) { const c = clips.find((x) => x.id === o.value); if (c) o.textContent = c.label + (BAKED[c.id] ? ' · baked' : ''); }
}
function bakedDoc() {   // the baked clip in a plain, documented form
  const bk = BAKED[cur.id] || bakeFrames();
  return {
    tool: 'Animation Blender', kind: 'baked-clip', format: 1, bakedAt: new Date().toISOString(),
    clip: { id: cur.id, name: cur.c.name, label: cur.name, kind: cur.kind, cycle_s: +cur.dur.toFixed(4), speed_mps: cur.c.speed ?? null },
    frames: bk.n, loop: bk.loop, fps: bk.fps,
    note: 'q: Float32 little-endian, base64; frames × bones × [x,y,z,w] local rotations in the order of `bones`. hips: frames × [x,y,z] hips world position in metres, in place. Loops: frame k is at k/frames of the cycle.',
    bones: rig.bones.map((b) => b.name),
    q: f32ToB64(bk.q), hips: f32ToB64(bk.hp),
  };
}
function openBakeDlg() {
  const dlg = $('bakeDlg'), note = $('bakeNote'); dlg.hidden = false; note.textContent = '';
  $('bakeState').textContent = BAKED[cur.id] ? `"${cur.name}" is baked (${BAKED[cur.id].n} frames).` : `"${cur.name}" plays its original motion.`;
  $('bakeRevert').disabled = !BAKED[cur.id];
  $('bakeSave').hidden = !caps.db; $('bakeDl').hidden = !caps.downloads;
  $('bakeGo').onclick = () => { note.textContent = bakeAndReplace(); $('bakeRevert').disabled = false; $('bakeState').textContent = `"${cur.name}" is baked (${BAKED[cur.id].n} frames).`; };
  $('bakeRevert').onclick = () => { note.textContent = revertBake(); $('bakeRevert').disabled = true; $('bakeState').textContent = `"${cur.name}" plays its original motion.`; };
  $('bakeSave').onclick = async () => {
    try { const d = bakedDoc(); await caps.db.doc('baked/' + cur.id.replace(/[^A-Za-z0-9_.~:@+-]/g, '_')).set({ ...d, savedAt: Date.now() }); note.textContent = `Saved to the project store. Tell Claude "apply the baked ${cur.c.name}" to write it into the project files.`; }
    catch (e) { note.textContent = 'Could not save (' + ((e && e.code) || 'error') + '). Use Download instead.'; }
  };
  $('bakeDl').onclick = async () => {
    const fn = `${cur.c.name}_baked_${stamp()}.json`;
    try { await caps.downloads.save({ filename: fn, data: JSON.stringify(bakedDoc()) }); note.textContent = 'Saved as ' + fn + '.'; }
    catch (e) { note.textContent = e && e.code === 'declined' ? 'Download cancelled.' : 'Download is not available here.'; }
  };
  $('bakeClose').onclick = () => { dlg.hidden = true; };
}
$('btnBake').onclick = openBakeDlg;
$('bakeDlg').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('bakeDlg').hidden = true; });
