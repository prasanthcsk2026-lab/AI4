
// ============================================================================
//  ANIMATION BLENDER
//  One clip layered over the idle, shaped by automation (points + curve tension, FL Studio style):
//    · per bone (FK): weight 0–200 % of the clip's rotation away from idle (whole bone and per local axis),
//      an adjustment in degrees about each local axis, and a timing offset
//    · per IK effector (HumanIK style, full body): hips, chest, head, shoulders, elbows, hands, fingers,
//      knees, feet, toes: position / rotation offsets, IK blend, pin, hold (world lock), pull, swivel, curl
//    · a master playback-speed track
//  Every frame: FK automation → root travel (unless in place) → full-body IK on top of it.
// ============================================================================
const $ = (id) => document.getElementById(id);
const STORE = 'animationBlender.v1';
const W_MAX = 2, ADJ_MAX = 90, SPEED_MAX = 2, TIMING_MAX = 0.5;
const COL = { group: '#7fb7ff', weight: '#f08a1c', adjust: '#56b6c2', speed: '#c6d45a', timing: '#c98bd6', pos: '#ffd166', rot: '#7fb7ff', ik: '#5fd3a8', swivel: '#e58ad6', flag: '#ff7a6b', finger: '#b9a5ff' };
const AXIS_COL = { x: '#ff5f5f', y: '#7ddc6a', z: '#5f9dff' };
const niceName = (n) => n.replace(/__LegsOnly/i, '').replace(/_/g, ' ').replace(/^Gen /, '');

function blobSafeTextures(parser) {   // (embedded glTF images decoded in memory: the host blocks blob: URLs)
  return {
    name: 'blob_safe_textures',
    loadTexture(texIndex) {
      const json = parser.json, td = json.textures[texIndex], sd = td && json.images[td.source];
      if (!sd || sd.bufferView === undefined || typeof createImageBitmap === 'undefined') return null;
      return parser.getDependency('bufferView', sd.bufferView)
        .then((buf) => createImageBitmap(new Blob([buf], { type: sd.mimeType }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
        .then((bmp) => { const t = new THREE.Texture(bmp); t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true; parser.associations.set(t, { textures: texIndex }); return t; })
        .catch(() => null);
    },
  };
}

// ---------------------------------------------------------------- automation curves
// a track = sorted points { t (s), v, k (tension of the segment to the next point, −1…1) }
const shapeU = (u, k) => (Math.abs(k) < 1e-3 ? u : Math.pow(u, Math.pow(2, k * 3)));
function evalPts(pts, t) {
  if (!pts || !pts.length) return 0;
  if (t <= pts[0].t) return pts[0].v;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (t <= b.t) { const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1; return lerp(a.v, b.v, shapeU(u, a.k)); }
  }
  return pts[pts.length - 1].v;
}
const flat = (v, dur) => [{ t: 0, v, k: 0 }, { t: dur, v, k: 0 }];
const isFlat = (pts, v) => pts.every((p) => Math.abs(p.v - v) < 1e-6);
function setPointAt(pts, t, v) {
  let i = pts.findIndex((p) => Math.abs(p.t - t) < 1e-3);
  if (i >= 0) { pts[i].v = v; return; }
  let at = pts.findIndex((p) => p.t > t); if (at < 0) at = pts.length;
  pts.splice(at, 0, { t, v, k: 0 });
}
// a key: on a still-flat track the first key sets the whole track (like a single key in a DCC); after that it adds shape
function keyAt(pts, t, v) {
  if (pts.every((p) => Math.abs(p.v - pts[0].v) < 1e-6)) for (const p of pts) p.v = v;
  setPointAt(pts, t, v);
}
const clonePts = (pts, mul = 1) => pts.map((p) => ({ t: p.t, v: p.v * mul, k: p.k }));

// ---------------------------------------------------------------- scene + infinite ground
const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
view.prepend(renderer.domElement);
const scene = new THREE.Scene();
const BG = new THREE.Color('#1a201d');
scene.background = BG;
const FOG_NEAR = 18, FOG_FAR = 80;
scene.fog = new THREE.Fog(BG, FOG_NEAR, FOG_FAR);
const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 400);
camera.position.set(2.6, 1.35, 3.3);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.95, 0); controls.enableDamping = true; controls.minDistance = 0.6; controls.maxDistance = 45;
controls.maxPolarAngle = Math.PI * 0.495;
scene.add(new THREE.HemisphereLight('#dfe8e2', '#27302b', 1.1));
const sun = new THREE.DirectionalLight('#fff4e2', 2.2); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -2.5, right: 2.5, top: 2.5, bottom: -1.5, near: 0.5, far: 20 });
scene.add(sun, sun.target);
// The ground is a grid drawn from world coordinates in the shader: it follows the camera, so it never ends.
const groundMat = new THREE.ShaderMaterial({
  uniforms: {
    uBase: { value: new THREE.Color('#1f3326') }, uMinor: { value: new THREE.Color('#284030') }, uMajor: { value: new THREE.Color('#3b5c45') },
    uAxis: { value: new THREE.Color('#6b5530') }, uFog: { value: BG }, uNear: { value: FOG_NEAR }, uFar: { value: FOG_FAR }, uCam: { value: V3() },
  },
  vertexShader: 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
  fragmentShader: `uniform vec3 uBase, uMinor, uMajor, uAxis, uFog, uCam; uniform float uNear, uFar; varying vec3 vW;
    float line(vec2 p, float s, float wpx) { vec2 q = p / s; vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q); return 1.0 - min(min(g.x, g.y) / wpx, 1.0); }
    float axisLine(float c) { return 1.0 - min(abs(c) / fwidth(c) / 1.5, 1.0); }
    void main() {
      vec3 c = uBase;
      c = mix(c, uMinor, line(vW.xz, 1.0, 1.0) * 0.8);
      c = mix(c, uMajor, line(vW.xz, 5.0, 1.3));
      c = mix(c, uAxis, max(axisLine(vW.x), axisLine(vW.z)) * 0.6);
      float f = smoothstep(uNear, uFar, distance(uCam, vW));
      gl_FragColor = vec4(mix(c, uFog, f), 1.0);
      #include <colorspace_fragment>
    }`,
});
const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), groundMat);
ground.rotation.x = -Math.PI / 2; scene.add(ground);
const shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.ShadowMaterial({ opacity: 0.32 }));
shadowCatcher.rotation.x = -Math.PI / 2; shadowCatcher.position.y = 0.002; shadowCatcher.receiveShadow = true; scene.add(shadowCatcher);
function placeWorld(focus) {   // ground, shadow and sun travel with the character
  ground.position.set(Math.round(camera.position.x / 5) * 5, 0, Math.round(camera.position.z / 5) * 5);
  groundMat.uniforms.uCam.value.copy(camera.position);
  shadowCatcher.position.set(focus.x, 0.002, focus.z);
  sun.target.position.set(focus.x, 0, focus.z); sun.position.set(focus.x + 3, 6, focus.z + 4);
}

// ---------------------------------------------------------------- data + rig
let rig, lib, gl, model, B, boneIdx, isLower, gMap, hipsParentQ;
let clips = [], cur = null;                           // cur = { id, name, kind: 'loop'|'move', c, dur (cycle s) }
const Qi = [], Qc = [], QcG = [];
let Hi, Hc, HcG;
const fk = { v: null };
const S = {
  t: 0, playing: false, loop: true, dur: 3, speedLUT: null,
  selected: null, selEff: null, selGroup: null,         // a bone name, an IK effector id, or a group id
  bones: true, ghost: false, showIK: true, trail: false,
  inPlace: true, follow: true, autoKey: true, travelBase: V3(),
};
let A = null;                                         // automation of the current clip (see newAuto)
let editVersion = 0;                                  // bumps on every edit (caches key on it)

function newAuto(dur) { return { dur, speed: flat(1, dur), bones: {}, order: [], groups: {}, groupOrder: [], ik: {}, ikOrder: [], heights: {}, zoom: {} }; }
function newBoneAuto(dur) {
  return {
    collapsed: false, withChildren: false, show: { whole: true },
    whole: flat(1, dur), w: { x: flat(1, dur), y: flat(1, dur), z: flat(1, dur) }, a: { x: flat(0, dur), y: flat(0, dur), z: flat(0, dur) },
    timing: flat(0, dur),
  };
}
// fill fields added since a save was made; the old hips position offset becomes the hips IK effector
function normalizeAuto(a) {
  a.ik = a.ik || {}; a.ikOrder = a.ikOrder || []; a.heights = a.heights || {}; a.zoom = a.zoom || {};
  a.groups = a.groups || {}; a.groupOrder = a.groupOrder || [];
  for (const gid of a.groupOrder) { const g = a.groups[gid]; if (g) { g.show = g.show || { weight: true }; g.weight = g.weight || flat(1, a.dur); g.timing = g.timing || flat(0, a.dur); } }
  for (const n of a.order) {
    const ba = a.bones[n]; if (!ba) continue;
    if (!ba.show) ba.show = { whole: true };
    if (!ba.timing) ba.timing = flat(0, a.dur);
    if (ba.hipsPos) {
      const moved = AXES.some((x) => !isFlat(ba.hipsPos[x], 0));
      if (moved) {
        const e = a.ik.hips || newEffAuto('hips', a.dur);
        for (const x of AXES) e.tr['p' + x] = clonePts(ba.hipsPos[x]);
        for (const x of AXES) e.show['p' + x] = true;
        if (!a.ik.hips) { a.ik.hips = e; a.ikOrder.push('hips'); }
      }
      delete ba.hipsPos;
      for (const x of AXES) delete ba.show['h' + x];
    }
  }
  for (const id of a.ikOrder) { const e = a.ik[id]; if (!e) continue; for (const k of EFF_BY_ID[id].tracks) if (!e.tr[k]) e.tr[k] = flat(TRK[k].ref, a.dur); }
  return a;
}

function loadStore() { try { return JSON.parse(localStorage.getItem(STORE) || 'null') || { clips: {} }; } catch { return { clips: {} }; } }
let store = loadStore(), saveTimer = 0;
function save() {
  syncMirrors();
  editVersion++;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { store.last = cur && cur.id; store.clips[cur.id] = A; store.ui = { inPlace: S.inPlace, follow: S.follow, autoKey: S.autoKey, showIK: S.showIK }; localStorage.setItem(STORE, JSON.stringify(store)); } catch { /* storage off: the session still works */ }
  }, 350);
}

// ---------------------------------------------------------------- undo / redo
let undoStack = [], redoStack = [], suppressUndo = false;
function snapshot() { return JSON.stringify({ curId: cur.id, A }); }
function pushUndo() { if (suppressUndo || !cur) return; undoStack.push(snapshot()); if (undoStack.length > 150) undoStack.shift(); redoStack.length = 0; }
function restoreSnapshot(s) {
  const o = JSON.parse(s);
  if (o.curId !== cur.id) { const c = clips.find((x) => x.id === o.curId); if (c) { cur = c; $('clipSel').value = cur.id; } }
  A = normalizeAuto(o.A); S.dur = A.dur; $('durIn').value = S.dur; S.t = Math.min(S.t, S.dur);
  selPts = new Set(); selRow = null;
  rebuildSpeedLUT(); rebuildRows(); save(); updateSelChip();
}
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); const s = undoStack.pop(); suppressUndo = true; restoreSnapshot(s); suppressUndo = false; }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); const s = redoStack.pop(); suppressUndo = true; restoreSnapshot(s); suppressUndo = false; }

let clipboard = null;   // { type: 'points'|'track'|'bone'|'eff', ... }

async function boot() {
  const [b64, libJson, gJson] = await Promise.all([
    window.__local('character.glb.txt').then((r) => { if (!r.ok) throw new Error('character file missing'); return r.text(); }),
    window.__local('motionlib.json').then((r) => { if (!r.ok) throw new Error('motion library missing'); return r.json(); }),
    window.__local('getups.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  const bin = Uint8Array.from(atob(b64.trim()), (c) => c.charCodeAt(0));
  const g = await new GLTFLoader().register(blobSafeTextures).parseAsync(bin.buffer, '');
  model = g.scene;
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
    const m = o.material; if (!m) return; m.roughness = 0.62;
    if (/hair|lash/i.test(m.name + o.name)) { m.normalMap = null; m.transparent = false; m.alphaTest = 0.45; m.alphaToCoverage = true; m.depthWrite = true; }
    m.needsUpdate = true;
  });
  scene.add(model); model.updateMatrixWorld(true);
  rig = new Rig(model);
  lib = new MotionLib(libJson, rig);
  gl = gJson ? new GetupLib(gJson, rig) : null;
  B = rig.bones.length; boneIdx = new Map(rig.bones.map((b, i) => [b.name, i]));
  const lower = new Set([rig.b.hips]); for (const s of ['L', 'R']) rig.side[s].thigh.traverse((o) => o.isBone && lower.add(o));
  isLower = rig.bones.map((b) => lower.has(b));
  for (const arr of [Qi, Qc]) arr.push(new Float32Array(B * 4));
  Hi = V3(); Hc = V3(); HcG = V3();
  if (gl) { QcG.push(new Float32Array(gl.bones.length * 4)); gMap = rig.bones.map((b) => gl.bones.indexOf(b)); }
  hipsParentQ = worldQ(rig.b.hips.parent);
  fk.v = new VirtualFK(rig);
  // clip list: every clip the app uses
  const role = { loco: '', prestop: ' · pre-stop jog (d_loop)', brake: ' · braking legs', shuffle: ' · shuffle' };
  for (const c of lib.clips) {
    if (c.loop !== 'phase' || !(c.role in role)) continue;
    let name = niceName(c.name);
    if (c.name === 'Run_steady_fast') name = 'Run fast (Run steady ×' + (c.speed / c.nativeSpeed).toFixed(2) + ', sprint top)';
    if (c.name === 'Backpedal_quick') name = 'Backpedal quick (Jog backward ×' + (c.speed / c.nativeSpeed).toFixed(2) + ')';
    clips.push({ id: 'loop:' + c.name, name, label: `${name} · ${c.speed.toFixed(2)} m/s${c.legsOnly ? ' · legs' : ''}${role[c.role]}`, kind: 'loop', c, dur: 1 / c.freq, group: 'Loops' });
  }
  clips.sort((a, b) => a.c.speed - b.c.speed);
  if (gl) for (const c of gl.clips) {
    if (!c.n || !c.q) continue;
    clips.push({ id: 'move:' + c.name, name: c.name, label: `${c.name} · ${c.src || ''} · ${((c.n - 1) / gl.fps).toFixed(2)} s`, kind: 'move', c, dur: (c.n - 1) / gl.fps, group: 'One-shot moves' });
  }
  if (store.ui) for (const k of ['inPlace', 'follow', 'autoKey', 'showIK']) if (typeof store.ui[k] === 'boolean') S[k] = store.ui[k];
  syncToggles();
  buildClipSelect(); buildBoneTree(); computeAxisInfo(); buildEffectors(); ensureGizmo(); buildSkeleton(); buildHandles(); buildTripod();
  const first = clips.find((x) => x.id === store.last) || clips.find((x) => x.c.name === 'Run_steady_fast') || clips[0];
  selectClip(first.id);
  $('loading').hidden = true;
  frameCamera(true);
  resize(); requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- UI: clip + bones
function buildClipSelect() {
  const sel = $('clipSel'); sel.textContent = '';
  for (const grp of ['Loops', 'One-shot moves']) {
    const og = document.createElement('optgroup'); og.label = grp;
    for (const c of clips.filter((x) => x.group === grp)) { const o = document.createElement('option'); o.value = c.id; o.textContent = c.label; og.append(o); }
    if (og.children.length) sel.append(og);
  }
  sel.onchange = () => selectClip(sel.value);
}

// bone hierarchy tree: search box + indented rows, click adds (opens the track dialog) or selects
function buildBoneTree() {
  const under = new Set(); rig.b.hips.traverse((o) => o.isBone && under.add(o));
  const all = rig.bones.filter((b) => under.has(b));
  const roots = all.filter((b) => !all.includes(b.parent));
  function walk(b, depth, q) {
    const kids = all.filter((c) => c.parent === b);
    const kidRows = []; for (const k of kids) kidRows.push(...walk(k, depth + 1, q));
    const matchSelf = !q || b.name.toLowerCase().includes(q);
    if (!matchSelf && !kidRows.length) return [];
    const row = document.createElement('div'); row.className = 'treerow'; row.style.paddingLeft = (depth * 16 + 8) + 'px';
    const inTl = !!A.bones[b.name];
    const tn = document.createElement('span'); tn.className = 'tn'; tn.textContent = b.name; if (inTl) tn.style.color = 'var(--accent)';
    row.append(tn);
    if (inTl) { const m = document.createElement('span'); m.className = 'mini'; m.style.cssText = 'opacity:.6;pointer-events:none'; m.textContent = 'in timeline'; row.append(m); }
    row.onclick = () => {
      $('boneDlg').hidden = true;
      if (inTl) selectBone(b.name); else openAddDialog({ type: 'bone', name: b.name });
    };
    return [row, ...kidRows];
  }
  function render(q) {
    const root = $('boneTree'); root.textContent = '';
    const items = []; for (const r of roots) items.push(...walk(r, 0, q.trim().toLowerCase()));
    if (!items.length) { root.innerHTML = '<div class="empty">No bones match.</div>'; return; }
    for (const it of items) root.append(it);
  }
  const renderMode = (q) => (treeMode === 'ik' ? renderIKList(q) : treeMode === 'group' ? renderGroupList(q) : render(q));
  $('boneSearch').oninput = () => renderMode($('boneSearch').value);
  $('btnAddBone').onclick = () => { treeMode = 'bone'; $('boneDlgTitle').textContent = 'Add a bone'; $('boneDlgNote').textContent = 'Body → Left / Right → fingers, in hierarchy order.'; $('boneDlg').hidden = false; $('boneSearch').value = ''; render(''); $('boneSearch').focus(); };
  $('btnAddIK').onclick = () => { treeMode = 'ik'; $('boneDlgTitle').textContent = 'Add an IK effector'; $('boneDlgNote').textContent = 'HumanIK-style effectors. Offsets are in world axes: X sideways, Y up, Z forward.'; $('boneDlg').hidden = false; $('boneSearch').value = ''; renderIKList(''); $('boneSearch').focus(); };
  $('btnAddGroup').onclick = () => { treeMode = 'group'; $('boneDlgTitle').textContent = 'Add a group'; $('boneDlgNote').textContent = 'One weight track for many bones. Weights multiply: a bone inside two groups gets both.'; $('boneDlg').hidden = false; $('boneSearch').value = ''; renderGroupList(''); $('boneSearch').focus(); };
  $('boneDlgClose').onclick = () => { $('boneDlg').hidden = true; };
  $('boneDlg').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('boneDlg').hidden = true; });
  window.__slRebuildTree = () => renderMode($('boneSearch').value || '');
}
let treeMode = 'bone';
function renderIKList(q) {
  const root = $('boneTree'); root.textContent = '';
  q = q.trim().toLowerCase();
  let group = null;
  for (const e of EFFECTORS) {
    if (q && !e.label.toLowerCase().includes(q)) continue;
    if (e.group !== group) { group = e.group; const h = document.createElement('div'); h.className = 'treegrp'; h.textContent = group; root.append(h); }
    const inTl = !!A.ik[e.id];
    const row = document.createElement('div'); row.className = 'treerow'; row.style.paddingLeft = '16px';
    const tn = document.createElement('span'); tn.className = 'tn'; tn.textContent = e.label; if (inTl) tn.style.color = COL.ik;
    const d = document.createElement('span'); d.className = 'mini'; d.style.cssText = 'opacity:.6;pointer-events:none'; d.textContent = inTl ? 'in timeline' : e.what;
    row.append(tn, d);
    row.onclick = () => { $('boneDlg').hidden = true; if (inTl) selectEff(e.id); else openAddDialog({ type: 'eff', id: e.id }); };
    root.append(row);
  }
  if (!root.children.length) root.innerHTML = '<div class="empty">No effectors match.</div>';
}

function renderGroupList(q) {
  const root = $('boneTree'); root.textContent = '';
  q = q.trim().toLowerCase();
  const row = (gid, label, note, pad) => {
    const inTl = !!A.groups[gid];
    const r = document.createElement('div'); r.className = 'treerow'; r.style.paddingLeft = pad + 'px';
    const tn = document.createElement('span'); tn.className = 'tn'; tn.textContent = label; if (inTl) tn.style.color = COL.group;
    const d = document.createElement('span'); d.className = 'mini'; d.style.cssText = 'opacity:.6;pointer-events:none'; d.textContent = inTl ? 'in timeline' : note;
    r.append(tn, d);
    r.onclick = () => { $('boneDlg').hidden = true; if (inTl) selectGroup(gid); else openAddDialog({ type: 'group', id: gid }); };
    root.append(r);
  };
  let cat = null;
  for (const g of GROUP_DEFS) {
    if (q && !g.label.toLowerCase().includes(q)) continue;
    if (g.cat !== cat) { cat = g.cat; const h = document.createElement('div'); h.className = 'treegrp'; h.textContent = cat; root.append(h); }
    row(g.id, g.label, (g.note ? g.note + ' · ' : '') + groupMembers(g.id).size + ' bones', 16);
  }
  const custom = A.groupOrder.filter((gid) => gid.startsWith('sub:') && (!q || gid.toLowerCase().includes(q)));
  const matches = q ? rig.bones.filter((b) => b.name.toLowerCase().includes(q) && b.children.some((c) => c.isBone) && !A.groups['sub:' + b.name]).slice(0, 40) : [];
  if (custom.length || matches.length || !q) { const h = document.createElement('div'); h.className = 'treegrp'; h.textContent = 'A bone and everything below it'; root.append(h); }
  for (const gid of custom) row(gid, groupLabel(gid), '', 16);
  for (const b of matches) row('sub:' + b.name, b.name + ' + below', groupMembers('sub:' + b.name).size + ' bones', 16);
  if (!q) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'Type a bone name to make a group from it and everything below it (or right-click a bone in the timeline).'; root.append(e); }
  if (!root.children.length) root.innerHTML = '<div class="empty">No groups match.</div>';
}

function selectClip(id) {
  cur = clips.find((x) => x.id === id) || clips[0];
  $('clipSel').value = cur.id;
  const saved = store.clips && store.clips[cur.id];
  A = normalizeAuto(saved && saved.speed ? saved : newAuto(Math.max(3, Math.round(cur.dur * 4 * 2) / 2)));
  S.dur = A.dur; $('durIn').value = S.dur;
  S.t = 0; S.travelBase.set(0, 0, 0); selPts = new Set(); selRow = null; undoStack = []; redoStack = [];
  moveEndCache = null;
  rebuildSpeedLUT(); rebuildRows(); save(); updateSelChip();
}
// removing a linked source removes its twin too; removing a twin just ends the link
function removeLinked(type, map, orderKey, key) {
  pushUndo();
  const it = map[key], to = partnerOf(type, key);
  const gone = [key]; if (it && it.mirror && to && map[to] && map[to].mirrorOf === key) gone.push(to);
  if (it && it.mirrorOf && map[it.mirrorOf]) delete map[it.mirrorOf].mirror;
  for (const k of gone) delete map[k];
  A[orderKey] = A[orderKey].filter((n) => !gone.includes(n));
  rebuildRows(); save(); updateSelChip();
}
function removeBone(name) { removeLinked('bone', A.bones, 'order', name); }
function removeGroup(gid) { removeLinked('group', A.groups, 'groupOrder', gid); }
function removeEff(id) { removeLinked('eff', A.ik, 'ikOrder', id); }

function selectBone(name) { S.selected = name; S.selEff = null; S.selGroup = null; afterSelect(); }
function selectEff(id) { S.selEff = id; S.selected = null; S.selGroup = null; afterSelect(); }
function selectGroup(gid) { S.selGroup = gid; S.selected = null; S.selEff = null; afterSelect(); }
function clearSelection() { S.selected = null; S.selEff = null; S.selGroup = null; afterSelect(); }
function afterSelect() { cancelPending(); rebuildRows(); updateSelChip(); updateGizmoTarget(); trailDirty = true; }

// ---------------------------------------------------------------- add-tracks dialog (bones and effectors)
const BONE_TRACKS = [
  ['whole', 'Whole bone weight'], ['wx', 'X weight'], ['wy', 'Y weight'], ['wz', 'Z weight'],
  ['ax', 'X adjust (°)'], ['ay', 'Y adjust (°)'], ['az', 'Z adjust (°)'],
  ['timing', 'Timing offset (% of cycle)'],
];
function openAddDialog(target, existingShow) {
  {   // a linked twin is edited through its source
    const map = target.type === 'eff' ? A.ik : target.type === 'group' ? A.groups : A.bones, key = target.type === 'bone' ? target.name : target.id;
    const it = map[key];
    if (it && it.mirrorOf) { target = target.type === 'bone' ? { type: 'bone', name: it.mirrorOf } : { type: target.type, id: it.mirrorOf }; existingShow = map[it.mirrorOf].show; }
  }
  const dlg = $('addDlg'); dlg.hidden = false;
  const isEff = target.type === 'eff', isGrp = target.type === 'group', def = isEff ? EFF_BY_ID[target.id] : null;
  $('addDlgName').textContent = isEff ? def.label : isGrp ? groupLabel(target.id) : target.name;
  const box = $('addDlgChecks'); box.textContent = '';
  const boxes = {};
  const lab = !isEff ? (axisInfo[target.name] || {}) : null;
  const defs = isGrp ? GROUP_TRACKS : isEff ? def.tracks.map((k) => [k, trackLabel(def, k).replace(/<[^>]+>/g, '')]) : BONE_TRACKS.map(([k, l]) => {
    const ax = k.length === 2 && 'wa'.includes(k[0]) ? k[1] : null;
    return [k, ax && lab[ax] ? `${l} — ${lab[ax].long}` : l];
  });
  const defaults = isGrp ? ['weight'] : isEff ? def.defaultShow : ['whole'];
  for (const [key, label] of defs) {
    const row = document.createElement('label'); row.className = 'checkrow';
    const cb = document.createElement('input'); cb.type = 'checkbox';
    cb.checked = existingShow ? !!existingShow[key] : defaults.includes(key);
    row.append(cb, document.createTextNode(label)); box.append(row); boxes[key] = cb;
  }
  // linked mirror: the other side follows every edit
  const type = isGrp ? 'group' : isEff ? 'eff' : 'bone', key = isGrp || isEff ? target.id : target.name;
  const twin = partnerLabel(type, key);
  let mcb = null;
  if (twin) {
    const map = isGrp ? A.groups : isEff ? A.ik : A.bones, to = partnerOf(type, key), own = map[to] && !map[to].mirrorOf;
    const row = document.createElement('label'); row.className = 'checkrow mirrorrow';
    mcb = document.createElement('input'); mcb.type = 'checkbox'; mcb.checked = !!(map[key] && map[key].mirror);
    row.append(mcb, document.createTextNode(`Mirror → ${twin} (linked: every edit here applies to both sides${own ? '; replaces its own tracks' : ''})`));
    box.append(row);
  }
  const ok = $('addDlgOk'), cancel = $('addDlgCancel');
  ok.textContent = existingShow ? 'Apply' : 'Add';
  ok.onclick = () => {
    const show = {}; for (const k in boxes) show[k] = boxes[k].checked;
    if (!Object.values(show).some(Boolean)) show[defaults[0]] = true;
    dlg.hidden = true;
    const mirror = !!(mcb && mcb.checked);
    if (isGrp) commitAddGroup(target.id, show, mirror); else if (isEff) commitAddEff(target.id, show, mirror); else commitAddBone(target.name, show, mirror);
  };
  cancel.onclick = () => { dlg.hidden = true; };
  dlg.onkeydown = (e) => { if (e.key === 'Escape') dlg.hidden = true; if (e.key === 'Enter') ok.click(); };
  ok.focus();
}
function commitAddBone(name, show, mirror) {
  pushUndo();
  if (!A.bones[name]) { A.bones[name] = newBoneAuto(S.dur); A.order.push(name); }
  A.bones[name].show = show;
  setMirrorLink('bone', name, mirror);
  selectBone(name); save();
  const r = document.querySelector(`[data-bone="${CSS.escape(name)}"]`); if (r) r.scrollIntoView({ block: 'nearest' });
}
const GROUP_TRACKS = [['weight', 'Group weight (× every bone in the group)'], ['timing', 'Group timing offset (% of cycle, + every bone)']];
function commitAddGroup(gid, show, mirror) {
  pushUndo();
  ensureGroup(gid).show = show;
  setMirrorLink('group', gid, mirror);
  selectGroup(gid); save();
  const r = document.querySelector(`[data-group="${CSS.escape(gid)}"]`); if (r) r.scrollIntoView({ block: 'nearest' });
}
function ensureGroup(gid) {
  if (!A.groups[gid]) { A.groups[gid] = newGroupAuto(S.dur); A.groupOrder.push(gid); }
  return A.groups[gid];
}
function commitAddEff(id, show, mirror) {
  pushUndo();
  ensureEff(id).show = show;
  setMirrorLink('eff', id, mirror);
  selectEff(id); save();
  const r = document.querySelector(`[data-eff="${CSS.escape(id)}"]`); if (r) r.scrollIntoView({ block: 'nearest' });
}
function ensureEff(id) {
  if (!A.ik[id]) { A.ik[id] = newEffAuto(id, S.dur); A.ikOrder.push(id); }
  return A.ik[id];
}
function ensureBone(name) {
  if (!A.bones[name]) { A.bones[name] = newBoneAuto(S.dur); A.order.push(name); }
  return A.bones[name];
}
