
// ============================================================================
//  IMPORT ANIMATION (FBX)
//  An FBX with motion (Character Creator; Mixamo names work too) is read with three.js' FBXLoader, its bones are
//  matched to this character, and every frame is retargeted:
//    target world rotation = (source rotation since its rest pose) · (rest-direction alignment) · target bind
//  so an A-pose rest in the file still gives the right pose here. The hips path is scaled to this character's leg
//  length; the travel is taken out and kept as speed + direction, so the header "In place" toggle decides whether it travels. A loop is cut from one
//  left-foot landing to the next. Imported clips live in this browser (IndexedDB) until "Save to project".
// ============================================================================
const CC_TO_RIG = {   // Character Creator (CC_Base_…) → this rig (Mixamo names)
  hip: 'Hips', waist: 'Spine', spine01: 'Spine1', spine02: 'Spine2', necktwist01: 'Neck', head: 'Head',
};
for (const [c, S] of [['l', 'Left'], ['r', 'Right']]) {
  Object.assign(CC_TO_RIG, {
    [c + 'clavicle']: S + 'Shoulder', [c + 'upperarm']: S + 'Arm', [c + 'forearm']: S + 'ForeArm', [c + 'hand']: S + 'Hand',
    [c + 'thigh']: S + 'UpLeg', [c + 'calf']: S + 'Leg', [c + 'foot']: S + 'Foot', [c + 'toebase']: S + 'ToeBase',
  });
  for (const [cf, mf] of [['thumb', 'Thumb'], ['index', 'Index'], ['mid', 'Middle'], ['ring', 'Ring'], ['pinky', 'Pinky']]) for (const k of [1, 2, 3]) CC_TO_RIG[c + cf + k] = `${S}Hand${mf}${k}`;
}
const IMP = { src: null, map: null, takes: [], busy: false };

// ---------------------------------------------------------------- IndexedDB cache
function idb() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open('animationBlender', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('clips', { keyPath: 'id' });
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
  });
}
async function idbDo(mode, fn) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('clips', mode), st = tx.objectStore('clips'), r = fn(st); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); }); }
const idbAll = () => idbDo('readonly', (st) => st.getAll());
const idbPut = (rec) => idbDo('readwrite', (st) => st.put(rec));
const idbDel = (id) => idbDo('readwrite', (st) => st.delete(id));

// ---------------------------------------------------------------- imported clips in the clip list
function addImportedClip(rec) {
  const bk = { n: rec.n, loop: rec.kind === 'loop', fps: rec.fps, q: rec.q, hp: rec.hp, win: rec.win };
  const c = { name: rec.name, speed: rec.speed, dir: rec.dir, n: rec.n, imported: true, origBk: bk };
  const old = clips.findIndex((x) => x.id === rec.id); if (old >= 0) clips.splice(old, 1);
  clips.push({ id: rec.id, name: rec.name, label: `${rec.name} · imported · ${rec.where === 'project' ? 'project' : 'cache'} · ${(rec.n / rec.fps).toFixed(2)} s`, kind: rec.kind, c, dur: rec.n / rec.fps, group: 'Imported', rec });
}
async function loadImported() {
  try { for (const rec of await idbAll()) addImportedClip(rec); } catch (e) { console.warn('Imported clips unavailable:', e); }
  buildClipSelect(); markBakedClips();
}

// ---------------------------------------------------------------- read + match
async function impRead(file) {
  const buf = await file.arrayBuffer();
  const obj = new FBXLoader().parse(buf, '');
  obj.updateMatrixWorld(true);
  const bones = []; obj.traverse((o) => { if (o.isBone || (o.type === 'Object3D' && /hip|pelvis|spine|arm|leg|hand|foot|head|neck/i.test(o.name))) bones.push(o); });
  if (!obj.animations || !obj.animations.length) throw new Error('This FBX has no animation in it.');
  const rest = new Map(bones.map((b) => [b, { q: b.getWorldQuaternion(new THREE.Quaternion()), p: b.getWorldPosition(V3()) }]));
  return { obj, bones, rest, takes: obj.animations, name: file.name.replace(/\.fbx$/i, '') };
}
function impAutoMap(src) {   // this rig's bone → the file's bone
  const bySrc = new Map();
  for (const b of src.bones) {
    const n = normName(b.name), cc = n.replace(/^ccbase/, '');
    const target = CC_TO_RIG[cc] || rig.bones.find((x) => normName(x.name) === n)?.name;
    if (target && !bySrc.has(target)) bySrc.set(target, b);
  }
  return bySrc;
}

// ---------------------------------------------------------------- retarget
function impRetarget(src, map, take, fps = 30) {
  const mixer = new THREE.AnimationMixer(src.obj), action = mixer.clipAction(take); action.play();
  const n = Math.max(2, Math.round(take.duration * fps) + 1), bones = rig.bones;
  const q = new Float32Array(n * B * 4), hp = new Float32Array(n * 3);
  // rest-direction alignment per mapped bone (target rest → source rest), and the hips scale
  const align = new Map();
  for (const tb of bones) {
    const sb = map.get(tb.name); if (!sb) continue;
    const tc = tb.children.find((c) => c.isBone && map.get(c.name)), sc = tc && map.get(tc.name);
    if (!tc || !sc) { align.set(tb, new THREE.Quaternion()); continue; }
    const dt = rig.bp(tc).sub(rig.bp(tb)).normalize(), ds = src.rest.get(sc).p.clone().sub(src.rest.get(sb).p).normalize();
    align.set(tb, new THREE.Quaternion().setFromUnitVectors(dt, ds));
  }
  // hips scale = this character's leg length / the file's (thigh → knee → ankle bone lengths: the same in any pose)
  const sHips = map.get(rig.b.hips.name), legLen = (get) => { let tot = 0, cnt = 0; for (const S of ['L', 'R']) { const [a, b2, c] = ['thigh', 'shin', 'foot'].map((k2) => get(rig.side[S][k2])); if (a && b2 && c) { tot += a.distanceTo(b2) + b2.distanceTo(c); cnt++; } } return cnt ? tot / cnt : 0; };
  const tLeg = legLen((b2) => rig.bp(b2)), sLeg = legLen((b2) => { const m = map.get(b2.name); return m ? src.rest.get(m).p : null; });
  const k = sHips && sLeg > 1e-4 ? tLeg / sLeg : 1;
  const tHips0 = rig.bp(rig.b.hips), world = new Array(B), tmp = new THREE.Quaternion(), wq = new THREE.Quaternion();
  for (let f = 0; f < n; f++) {
    mixer.setTime(Math.min(take.duration, f / fps)); src.obj.updateMatrixWorld(true);
    bones.forEach((tb, i) => {
      const par = bones.indexOf(tb.parent), sb = map.get(tb.name);
      const pw = par >= 0 ? world[par] : worldQ(tb.parent, new THREE.Quaternion());
      if (sb && i > 0) {
        const d = sb.getWorldQuaternion(wq).multiply(tmp.copy(src.rest.get(sb).q).invert());   // source since rest
        world[i] = d.clone().multiply(align.get(tb)).multiply(rig.bq(tb));
      } else world[i] = pw.clone().multiply(rig.bind.get(tb).lq);   // unmatched: its bind pose
      tmp.copy(pw).invert().multiply(world[i]).toArray(q, (f * B + i) * 4);
    });
    const hp0 = sHips ? sHips.getWorldPosition(V3()).sub(src.rest.get(sHips).p).multiplyScalar(k).add(tHips0) : tHips0;
    hp0.toArray(hp, f * 3);
  }
  action.stop(); mixer.uncacheRoot(src.obj);
  return { n, fps, q, hp };
}
// left-foot landings in the retargeted frames (feet low and nearly still)
function impLandings(fr) {
  const F = new VirtualFK(rig), fi = boneIdx.get(rig.side.L.foot.name), ys = [];
  for (let f = 0; f < fr.n; f++) { F.run(fr.q.subarray(f * B * 4, (f + 1) * B * 4), V3(fr.hp[f * 3], fr.hp[f * 3 + 1], fr.hp[f * 3 + 2]), 0); ys.push(F.P[fi].y); }
  const lo = Math.min(...ys), out = [];
  for (let f = 1; f < fr.n; f++) if (ys[f] < lo + 0.02 && ys[f - 1] >= lo + 0.02) out.push(f);
  return out;
}
function impCut(fr, a, b) {   // frames a … b−1 (a loop: b is the next landing); the travel is taken out of the hips and kept as speed + direction
  const n = Math.max(2, b - a), q = fr.q.slice(a * B * 4, (a + n) * B * 4), hp = fr.hp.slice(a * 3, (a + n) * 3);
  const end = Math.min(fr.n - 1, a + n), T = (end - a) / fr.fps, vx = (fr.hp[end * 3] - fr.hp[a * 3]) / T, vz = (fr.hp[end * 3 + 2] - fr.hp[a * 3 + 2]) / T;
  const speed = Math.hypot(vx, vz), dir = Math.atan2(vx, vz);
  for (let f = 0; f < n; f++) { const t = f / fr.fps; hp[f * 3] -= vx * t + (fr.hp[a * 3] - rig.bp(rig.b.hips).x); hp[f * 3 + 2] -= vz * t + (fr.hp[a * 3 + 2] - rig.bp(rig.b.hips).z); }
  return { n, fps: fr.fps, q, hp, speed, dir };
}

// ---------------------------------------------------------------- dialog
function impList() {
  const box = $('impList'); box.textContent = '';
  const mine = clips.filter((c) => c.group === 'Imported');
  if (!mine.length) { box.innerHTML = '<div class="empty">No imported clips yet.</div>'; return; }
  for (const c of mine) {
    const row = document.createElement('div'); row.className = 'improw';
    const nm = document.createElement('span'); nm.className = 'tn'; nm.textContent = c.name;
    const tag = document.createElement('span'); tag.className = 'imptag ' + (c.rec.where === 'project' ? 'proj' : 'cache'); tag.textContent = c.rec.where === 'project' ? 'project' : 'cache';
    const sv = document.createElement('button'); sv.type = 'button'; sv.className = 'mini'; sv.textContent = 'Save to project'; sv.hidden = c.rec.where === 'project' || !caps.db;
    sv.onclick = async () => {
      try {
        const r = c.rec; await caps.db.doc('imported/' + r.id.replace(/[^A-Za-z0-9_.~:@+-]/g, '_')).set({ id: r.id, name: r.name, kind: r.kind, fps: r.fps, n: r.n, speed: r.speed, dir: r.dir, win: r.win || null, bones: rig.bones.map((b) => b.name), q: f32ToB64(r.q), hips: f32ToB64(r.hp), savedAt: Date.now() });
        r.where = 'project'; await idbPut(r); addImportedClip(r); buildClipSelect(); markBakedClips(); impList();
        $('impNote').textContent = `"${r.name}" saved to the project. Ask Claude to add it to the project files.`;
      } catch (e) { $('impNote').textContent = 'Could not save to the project (' + ((e && e.code) || 'error') + ').'; }
    };
    const del = document.createElement('button'); del.type = 'button'; del.className = 'mini'; del.textContent = 'Delete';
    del.onclick = async () => {
      await idbDel(c.id); clips.splice(clips.indexOf(c), 1); delete BAKED[c.id];
      if (cur.id === c.id) selectClip(clips[0].id);
      buildClipSelect(); markBakedClips(); impList(); toast(`Deleted "${c.name}" from this browser${c.rec.where === 'project' ? ' (the project copy stays)' : ''}`);
    };
    row.append(nm, tag, sv, del); box.append(row);
  }
}
function openImport() { $('impDlg').hidden = false; $('impNote').textContent = ''; $('impSetup').hidden = !IMP.src; impList(); }
async function impFileChosen(file) {
  $('impNote').textContent = 'Reading ' + file.name + '…';
  try {
    IMP.src = await impRead(file); IMP.map = impAutoMap(IMP.src);
    $('impName').value = IMP.src.name;
    const ts = $('impTake'); ts.textContent = '';
    IMP.src.takes.forEach((t, i) => { const o = document.createElement('option'); o.value = i; o.textContent = `${t.name || 'Take ' + (i + 1)} · ${t.duration.toFixed(2)} s`; ts.append(o); });
    const need = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];
    const missing = need.filter((n) => !IMP.map.get(n));
    $('impMap').textContent = `Matched ${IMP.map.size} of ${rig.bones.length} bones` + (missing.length ? ` · not found: ${missing.join(', ')}` : ' · all main bones found ✓');
    impMapTable();
    $('impSetup').hidden = false; $('impNote').textContent = '';
    impDetect();
  } catch (e) { IMP.src = null; $('impSetup').hidden = true; $('impNote').textContent = 'Could not read it: ' + e.message; console.error(e); }
}
function impMapTable() {   // the main bones, each with a dropdown of the file's bones
  const box = $('impMapTable'); box.textContent = '';
  const names = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', ...['Left', 'Right'].flatMap((S) => ['Shoulder', 'Arm', 'ForeArm', 'Hand', 'UpLeg', 'Leg', 'Foot', 'ToeBase'].map((x) => S + x))];
  for (const n of names) {
    if (!boneIdx.has(n)) continue;
    const l = document.createElement('label'); l.className = 'igline'; l.append(n);
    const sel = document.createElement('select'); const none = document.createElement('option'); none.value = ''; none.textContent = '— none —'; sel.append(none);
    for (const b of IMP.src.bones) { const o = document.createElement('option'); o.value = b.uuid; o.textContent = b.name; sel.append(o); }
    sel.value = IMP.map.get(n) ? IMP.map.get(n).uuid : '';
    sel.onchange = () => { const b = IMP.src.bones.find((x) => x.uuid === sel.value); if (b) IMP.map.set(n, b); else IMP.map.delete(n); impDetect(); };
    l.append(sel); box.append(l);
  }
}
function impDetect() {   // retarget once, find the loop
  const take = IMP.src.takes[+$('impTake').value || 0];
  IMP.frames = impRetarget(IMP.src, IMP.map, take);
  const lands = impLandings(IMP.frames);
  IMP.lands = lands;
  const loop = $('impKind').value === 'loop';
  if (loop && lands.length >= 2) { const mid = Math.max(0, Math.floor(lands.length / 2) - 1); $('impStart').value = lands[mid]; $('impEnd').value = lands[mid + 1]; }
  else { $('impStart').value = 0; $('impEnd').value = IMP.frames.n - 1; }
  $('impInfo').textContent = `${IMP.frames.n} frames at ${IMP.frames.fps} fps · left-foot landings at frames ${lands.join(', ') || 'none found'}` + (loop && lands.length < 2 ? ' · set the loop start and end by hand' : '');
}
async function impDo() {
  if (!IMP.frames) return;
  const a = clamp(Math.round(+$('impStart').value), 0, IMP.frames.n - 2), b = clamp(Math.round(+$('impEnd').value), a + 2, IMP.frames.n);
  const loop = $('impKind').value === 'loop', cut = impCut(IMP.frames, a, loop ? b : b + 1 > IMP.frames.n ? IMP.frames.n : b + 1);
  const name = ($('impName').value || IMP.src.name).trim(), id = 'imp:' + name.replace(/[^A-Za-z0-9_.-]/g, '_');
  const rec = { id, name, kind: loop ? 'loop' : 'move', fps: cut.fps, n: cut.n, q: cut.q, hp: cut.hp, speed: cut.speed, dir: cut.dir, where: 'cache', at: Date.now() };
  if (loop) {   // measured contacts, so the timeline shows the feet
    if (!ST.fk) ST.fk = new VirtualFK(rig);
    const m = stMeasure(rec.q, rec.hp, rec.n); rec.win = {};
    for (const Sd of ['L', 'R']) if (m.contact[Sd]) { const c = m.contact[Sd]; rec.win[Sd] = [c.on, c.on + mod1(c.off - c.on)]; }
  }
  try { await idbPut(rec); } catch (e) { $('impNote').textContent = 'Could not keep it in this browser: ' + e.message; }
  addImportedClip(rec); buildClipSelect(); markBakedClips(); selectClip(id); impList();
  $('impNote').textContent = `Imported "${name}" (${cut.n} frames, ${loop ? 'loop' : 'one-shot'}). Turn "In place" off in the header to see it travel. It is kept in this browser; "Save to project" stores it in the project.`;
}
$('btnImportAnim').onclick = openImport;
$('impFile').onchange = () => { const f = $('impFile').files[0]; if (f) impFileChosen(f); };
$('impTake').onchange = impDetect;
$('impKind').onchange = impDetect;
$('impGo').onclick = impDo;
$('impClose').onclick = () => { $('impDlg').hidden = true; };
$('impDlg').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('impDlg').hidden = true; });
