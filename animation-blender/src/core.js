
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
const COL = { move: '#9fe0ff', group: '#7fb7ff', weight: '#f08a1c', adjust: '#56b6c2', speed: '#c6d45a', timing: '#c98bd6', pos: '#ffd166', rot: '#7fb7ff', ik: '#5fd3a8', swivel: '#e58ad6', flag: '#ff7a6b', finger: '#b9a5ff' };
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
function keyAtFlat(pts, t, v) {
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
  inPlace: true, follow: true, autoKey: true, travelBase: V3(), realtime: false, v0: 0, v1: 10, limits: true, limitHits: new Set(), lenMode: 'length', unit: 'sec', mirrorPref: true, magnet: true, falloff: 0.15,
};
let A = null;                                         // automation of the current clip (see newAuto)
let editVersion = 0;                                  // bumps on every edit (caches key on it)

function newAuto(dur, cycles = 5) { return { dur, cycles, sym: {}, symOrder: [], barSpeed: {}, cyc: flat(100, dur), cycV2: true, gnd: flat(0, dur), showMaster: { speed: false, move: false, cycle: false, gnd: false }, speed: flat(1, dur), move: flat(1, dur), bones: {}, order: [], groups: {}, groupOrder: [], ik: {}, ikOrder: [], heights: {}, zoom: {} }; }
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
  a.groups = a.groups || {}; a.groupOrder = a.groupOrder || []; a.move = a.move || flat(1, a.dur);
  a.barSpeed = a.barSpeed || {}; a.cyc = a.cyc || flat(100, a.dur); a.gnd = a.gnd || flat(0, a.dur);
  if (!a.cycV2) { for (const p of a.cyc) p.v = clamp(10000 / Math.max(1, p.v), 25, 400); a.cycV2 = true; }   // was reach time %, now speed %
  a.showMaster = a.showMaster || { speed: !isFlat(a.speed, 1), move: !isFlat(a.move, 1), cycle: false };   // older saves: show what was changed
  a.sym = a.sym || {}; a.symOrder = (a.symOrder || []).filter((k) => a.sym[k]);
  for (const k of a.symOrder) if (!a.sym[k].offset) a.sym[k].offset = flat(0.5, a.dur);
  if (!(a.cycles > 0)) a.cycles = cur && cur.dur > 0 ? +(a.dur / cur.dur).toFixed(3) : 1;   // older saves: the clip's natural cadence
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
  for (const id of a.ikOrder) if (id.startsWith('ig:c') && a.ik[id]) registerIG(id, a.ik[id].label);
  a.ikOrder = a.ikOrder.filter((id) => EFF_BY_ID[id]);
  for (const id of a.ikOrder) { const e = a.ik[id]; if (!e) continue; if (EFF_BY_ID[id].kind === 'igroup') { e.members = e.members || { ...EFF_BY_ID[id].members }; e.pivot = e.pivot || EFF_BY_ID[id].pivot; } for (const k of EFF_BY_ID[id].tracks) if (!e.tr[k]) e.tr[k] = flat(TRK[k].ref, a.dur); }
  return a;
}

function loadStore() { try { return JSON.parse(localStorage.getItem(STORE) || 'null') || { clips: {} }; } catch { return { clips: {} }; } }
let store = loadStore(), saveTimer = 0;
function save() {
  syncMirrors();
  editVersion++;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { store.last = cur && cur.id; store.clips[cur.id] = A; store.ui = { realtime: S.realtime, lenMode: S.lenMode, limits: S.limits, inPlace: S.inPlace, follow: S.follow, autoKey: S.autoKey, showIK: S.showIK, unit: S.unit, mirrorPref: S.mirrorPref, magnet: S.magnet, falloff: S.falloff }; localStorage.setItem(STORE, JSON.stringify(store)); } catch { /* storage off: the session still works */ }
  }, 350);
}

// ---------------------------------------------------------------- undo / redo
let undoStack = [], redoStack = [], suppressUndo = false;
function snapshot() { return JSON.stringify({ curId: cur.id, A }); }
function pushUndo() { if (suppressUndo || !cur) return; undoStack.push(snapshot()); if (undoStack.length > 150) undoStack.shift(); redoStack.length = 0; }
function restoreSnapshot(s) {
  const o = JSON.parse(s);
  if (o.curId !== cur.id) { const c = clips.find((x) => x.id === o.curId); if (c) { cur = c; $('clipSel').value = cur.id; } }
  A = normalizeAuto(o.A); S.dur = A.dur; S.v0 = clamp(S.v0, 0, S.dur); S.v1 = clamp(S.v1, S.v0 + 0.05, S.dur); syncLenInputs(); S.t = Math.min(S.t, S.dur);
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
  if (store.ui) for (const k of ['inPlace', 'follow', 'autoKey', 'showIK', 'mirrorPref', 'magnet']) if (typeof store.ui[k] === 'boolean') S[k] = store.ui[k];
  if (store.ui && isFinite(store.ui.falloff)) S.falloff = clamp(+store.ui.falloff, 0, 2);
  $('btnMagnet').setAttribute('aria-pressed', S.magnet); $('falloffIn').value = S.falloff;
  if (store.ui && ['sec', 'frame', 'cycle', 'step'].includes(store.ui.unit)) S.unit = store.ui.unit;
  if (store.ui && ['length', 'cycles'].includes(store.ui.lenMode)) S.lenMode = store.ui.lenMode;
  if (store.ui && typeof store.ui.limits === 'boolean') S.limits = store.ui.limits;
  if (store.ui && typeof store.ui.realtime === 'boolean') S.realtime = store.ui.realtime;
  $('realtimeCb').checked = S.realtime;
  $('lenMode').value = S.lenMode;
  $('unitSel').value = S.unit;
  syncToggles();
  buildClipSelect(); loadBaked(); loadImported(); buildBoneTree(); computeAxisInfo(); buildEffectors(); ensureGizmo(); buildSkeleton(); buildHandles(); buildTripod();
  const first = clips.find((x) => x.id === store.last) || clips.find((x) => x.c.name === 'Run_steady_fast') || clips[0];
  selectClip(first.id);
  $('loading').hidden = true;
  frameCamera(true);
  resize(); requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- UI: clip + bones
function buildClipSelect() {
  const sel = $('clipSel'); sel.textContent = '';
  for (const grp of ['Loops', 'One-shot moves', 'Imported']) {
    const og = document.createElement('optgroup'); og.label = grp;
    for (const c of clips.filter((x) => x.group === grp)) { const o = document.createElement('option'); o.value = c.id; o.textContent = c.label; og.append(o); }
    if (og.children.length) sel.append(og);
  }
  if (cur) sel.value = cur.id;
  sel.onchange = () => selectClip(sel.value);
}

// bone hierarchy tree: search box + indented rows, click adds (opens the track dialog) or selects
function buildBoneTree() {
  const under = new Set(); rig.b.hips.traverse((o) => o.isBone && under.add(o));
  const all = rig.bones.filter((b) => under.has(b));
  // sections (body, each arm, each hand's fingers, each leg); a finger is one row of segment chips
  const isEnd = (b) => /_End$|(Thumb|Index|Middle|Ring|Pinky)4$/i.test(b.name);   // finger tips carry no motion
  const sections = [['Body', [rig.b.hips, rig.b.spine, rig.b.spine1, rig.b.spine2, rig.b.neck, rig.b.head], null]];
  for (const [S, side] of [['L', 'Left'], ['R', 'Right']]) {
    const sd = rig.side[S];
    sections.push([side + ' arm', [sd.clav, sd.upper, sd.fore, sd.hand], null]);
    const fingers = sd.hand.children.filter((c) => c.isBone).map((f) => { const chain = []; let b = f; while (b && b.isBone) { chain.push(b); b = b.children.find((c) => c.isBone); } return chain; });
    sections.push([side + ' fingers', [], fingers]);
  }
  for (const [S, side] of [['L', 'Left'], ['R', 'Right']]) { const sd = rig.side[S]; sections.push([side + ' leg', [sd.thigh, sd.shin, sd.foot, sd.toe], null]); }
  const listed = new Set(); for (const [, bs, fs] of sections) { bs.forEach((b) => listed.add(b)); (fs || []).forEach((c) => c.forEach((b) => listed.add(b))); }
  sections.push(['Other', all.filter((b) => !listed.has(b) && !/_End$/i.test(b.name)), null]);
  const inTl = (n) => !!A.bones[n];
  const pick = (n) => { $('boneDlg').hidden = true; if (inTl(n)) selectBone(n); else openAddDialog({ type: 'bone', name: n }); };
  function render(q) {
    const root = $('boneTree'); root.textContent = '';
    q = q.trim().toLowerCase();
    const hit = (b) => !q || b.name.toLowerCase().includes(q);
    for (const [title, bones, fingers] of sections) {
      const rowsHere = [];
      bones.filter(hit).forEach((b, i) => {
        const row = document.createElement('div'); row.className = 'treerow'; row.style.paddingLeft = (8 + Math.min(i, 5) * 12) + 'px';
        const tn = document.createElement('span'); tn.className = 'tn'; tn.textContent = b.name; if (inTl(b.name)) tn.classList.add('on');
        row.append(tn);
        if (inTl(b.name)) { const m = document.createElement('span'); m.className = 'intl'; m.textContent = 'in timeline'; row.append(m); }
        row.onclick = () => pick(b.name);
        rowsHere.push(row);
      });
      for (const chain of fingers || []) {
        const segs = chain.filter((b) => !isEnd(b) && hit(b)); if (!segs.length) continue;
        const row = document.createElement('div'); row.className = 'treerow fingerrow';
        const tn = document.createElement('span'); tn.className = 'tn'; tn.textContent = chain[0].name.replace(/^(Left|Right)Hand/, '').replace(/\d+$/, '');
        const chips = document.createElement('span'); chips.className = 'chips';
        for (const b of segs) { const c = document.createElement('button'); c.type = 'button'; c.className = 'chip-seg' + (inTl(b.name) ? ' on' : ''); c.textContent = b.name.match(/\d+$/) ? b.name.match(/\d+$/)[0] : b.name; c.title = b.name + (inTl(b.name) ? ' · in timeline' : ''); c.onclick = (e) => { e.stopPropagation(); pick(b.name); }; chips.append(c); }
        row.append(tn, chips); row.onclick = () => pick(segs[0].name);
        rowsHere.push(row);
      }
      if (!rowsHere.length) continue;
      const h = document.createElement('div'); h.className = 'treegrp'; h.textContent = title; root.append(h, ...rowsHere);
    }
    if (!root.children.length) root.innerHTML = '<div class="empty">No bones match.</div>';
  }
  const renderMode = (q) => (treeMode === 'ik' ? renderIKList(q) : treeMode === 'group' ? renderGroupList(q) : render(q));
  $('boneSearch').oninput = () => renderMode($('boneSearch').value);
  $('btnAddBone').onclick = () => { treeMode = 'bone'; $('boneDlgTitle').textContent = 'Add a bone'; $('boneDlgNote').textContent = 'Parent → child order in each part. A finger\'s numbers are its segments, from the knuckle out.'; $('boneDlg').hidden = false; $('boneSearch').value = ''; render(''); $('boneSearch').focus(); };
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
    const d = document.createElement('span'); d.className = 'note2'; d.textContent = inTl ? 'in timeline' : e.what; d.title = e.what;
    row.append(tn, d);
    row.onclick = () => { $('boneDlg').hidden = true; if (inTl) selectEff(e.id); else openAddDialog({ type: 'eff', id: e.id }); };
    root.append(row);
  }
  if (!q || 'custom controllers group ik new'.includes(q)) {
    if (group !== 'Custom controllers') { const h = document.createElement('div'); h.className = 'treegrp'; h.textContent = 'Custom controllers'; root.append(h); }
    const row = document.createElement('div'); row.className = 'treerow'; row.style.paddingLeft = '16px';
    row.innerHTML = '<span class="tn" style="color:var(--accent)">+ New IK controller (a point between joints)…</span><span class="note2">e.g. both hands + hips: drag it and they follow</span>';
    row.onclick = () => { $('boneDlg').hidden = true; let n = 1; while (EFF_BY_ID['ig:c' + n]) n++; registerIG('ig:c' + n, 'Controller ' + n); openAddDialog({ type: 'eff', id: 'ig:c' + n }); };
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
  if (!q || 'symmetrize arms legs mirror'.includes(q) || /sym|arm|leg/.test(q)) {
    const h = document.createElement('div'); h.className = 'treegrp'; h.textContent = 'Symmetrize (mirror with a half-cycle offset)'; root.append(h);
    for (const [k, label] of SYM_KEYS) {
      const inTl = !!A.sym[k];
      const r = document.createElement('div'); r.className = 'treerow'; r.style.paddingLeft = '16px';
      r.innerHTML = `<span class="tn"${inTl ? ' style="color:#e58ad6"' : ''}></span><span class="note2">${inTl ? 'in timeline' : 'weight 100 % = fully symmetric'}</span>`;
      r.firstChild.textContent = label;
      r.onclick = () => { $('boneDlg').hidden = true; if (!inTl) { pushUndo(); A.sym[k] = newSymAuto(S.dur); A.symOrder.push(k); rebuildRows(); save(); } };
      root.append(r);
    }
  }
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
  A = normalizeAuto(saved && saved.speed ? saved : newAuto(S.lenMode === 'cycles' ? +(5 * cur.dur).toFixed(3) : 10));
  S.dur = A.dur; syncLenInputs(); S.v0 = 0; S.v1 = S.dur; updateHScroll();
  S.t = 0; S.travelBase.set(0, 0, 0); selPts = new Set(); selRow = null; undoStack = []; redoStack = [];
  moveEndCache = null;
  rebuildSpeedLUT(); rebuildRows(); save(); updateSelChip();
}
// removing a linked source removes its twin too; removing a twin just ends the link
// Deletes happen at once, with an "Undo" toast (Ctrl+Z works too). Only clearing a whole clip still asks first.
function confirmDelete(message, run, okLabel = 'Delete') {
  if (okLabel !== 'Clear all' && okLabel !== 'Revert') { run(); toast(message.replace(/\?.*$/, '').replace(/^Delete /, 'Deleted ').replace(/^Remove /, 'Removed ').replace(/^Reset /, 'Reset ').replace(/^Clear /, 'Cleared ')); return; }
  askConfirm(message, run, okLabel);
}
let toastTimer = 0;
function toast(text) {
  const el = $('toast'); $('toastMsg').textContent = text; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
}
// a second right-click on the same thing within 0.4 s: that thing is deleted
let lastRight = null;
function rightDouble(key) {
  const now = performance.now(), hit = lastRight && lastRight.key === key && now - lastRight.t < 400;
  lastRight = hit ? null : { key, t: now };
  if (hit) menuEl.hidden = true;
  return hit;
}
function askConfirm(message, run, okLabel) {
  const dlg = $('confirmDlg'); $('confirmMsg').textContent = message; $('confirmOk').textContent = okLabel; dlg.hidden = false;
  const close = () => { dlg.hidden = true; dlg.onkeydown = null; };
  $('confirmOk').onclick = () => { close(); run(); };
  $('confirmCancel').onclick = close;
  dlg.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } if (e.key === 'Enter') { e.preventDefault(); close(); run(); } e.stopPropagation(); };
  $('confirmOk').focus();
}
function itemLabel(type, key) { return type === 'eff' ? EFF_BY_ID[key].label : type === 'group' ? groupLabel(key) : key; }
function removeLinked(type, map, orderKey, key) {
  const it = map[key], to = partnerOf(type, key), both = it && it.mirror && to && map[to] && map[to].mirrorOf === key;
  confirmDelete(`Remove ${both ? sideless(itemLabel(type, key)) + ' (both sides)' : itemLabel(type, key)} and all its tracks from the timeline?`, () => removeLinkedNow(type, map, orderKey, key));
}
function removeLinkedNow(type, map, orderKey, key) {
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
    mcb = document.createElement('input'); mcb.type = 'checkbox'; mcb.checked = map[key] ? !!map[key].mirror : S.mirrorPref;
    const plain = sideless(isGrp ? groupLabel(key) : isEff ? def.label : key);
    row.append(mcb, document.createTextNode(`Mirror — both sides as one "${plain}" (edits apply to left and right${own ? '; replaces ' + twin + "'s own tracks" : ''})`));
    box.append(row);
  }
  // group IK: name (custom), members with their share of the move, pivot
  let igUI = null;
  if (isEff && def.kind === 'igroup') {
    const e = A.ik[def.id], mem = (e && e.members) || def.members, piv = (e && e.pivot) || def.pivot;
    const sec = document.createElement('div'); sec.className = 'igsec';
    let nameIn = null;
    if (def.custom) { const l = document.createElement('label'); l.className = 'igline'; l.append('Name '); nameIn = document.createElement('input'); nameIn.type = 'text'; nameIn.value = (e && e.label) || def.label; l.append(nameIn); sec.append(l); }
    const h = document.createElement('div'); h.className = 'axhead'; h.textContent = 'Members — % of the group move each one takes'; sec.append(h);
    const ins = {};
    for (const id of MOVABLE) {
      const l = document.createElement('label'); l.className = 'igline';
      const inp = document.createElement('input'); inp.type = 'number'; inp.min = 0; inp.max = 100; inp.step = 5; inp.value = Math.round((mem[id] || 0) * 100);
      l.append(EFF_BY_ID[id].label, inp); sec.append(l); ins[id] = inp;
    }
    const pl = document.createElement('label'); pl.className = 'igline'; pl.append('Pivot (rotate about)');
    const sel = document.createElement('select');
    const opts = [...(IG_AUTO_PIVOT[def.id] ? [['auto', 'Auto (' + IG_AUTO_PIVOT[def.id]().name + ')']] : []), ['centroid', 'Weighted centre of the members'], ...MOVABLE.map((id) => [id, EFF_BY_ID[id].label])];
    for (const [v, t] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.append(o); }
    sel.value = opts.some(([v]) => v === piv) ? piv : 'centroid'; pl.append(sel); sec.append(pl);
    const ll = document.createElement('label'); ll.className = 'igline'; ll.append('Head looks at it');
    const look = document.createElement('input'); look.type = 'checkbox'; look.checked = !!(e && e.look); ll.append(look); sec.append(ll);
    box.append(sec);
    igUI = () => ({ look: look.checked, label: nameIn ? nameIn.value.trim() || def.label : null, pivot: sel.value, members: Object.fromEntries(MOVABLE.map((id) => [id, clamp((+ins[id].value || 0) / 100, 0, 1)]).filter(([, v]) => v > 0)) });
  }
  const ok = $('addDlgOk'), cancel = $('addDlgCancel');
  ok.textContent = existingShow ? 'Apply' : 'Add';
  ok.onclick = () => {
    const show = {}; for (const k in boxes) show[k] = boxes[k].checked;
    if (!Object.values(show).some(Boolean)) show[defaults[0]] = true;
    dlg.hidden = true;
    const mirror = !!(mcb && mcb.checked);
    if (mcb) S.mirrorPref = mirror;
    if (isGrp) commitAddGroup(target.id, show, mirror); else if (isEff) commitAddEff(target.id, show, mirror, igUI && igUI()); else commitAddBone(target.name, show, mirror);
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
function commitAddEff(id, show, mirror, ig) {
  pushUndo();
  const e = ensureEff(id); e.show = show;
  if (ig) { e.members = ig.members; e.pivot = ig.pivot; e.look = !!ig.look; if (ig.label) { e.label = ig.label; registerIG(id, ig.label); } }
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
