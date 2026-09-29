
// ============================================================================
//  VIEWPORT: gizmo (live preview, key / auto-key), IK handles, skeleton, picking, trail, camera
// ============================================================================

// ---------------------------------------------------------------- live gizmo change ("pending")
// { kind: 'bone', name, deg: {x,y,z} }  or  { kind: 'eff', id, dpos: V3 (m), drot: Quaternion, dswivel (°) }
let pending = null;
function cancelPending() { pending = null; updateGizPanel(); }
function pendingIsZero(p) {
  if (!p) return true;
  if (p.kind === 'bone') return AXES.every((a) => Math.abs(p.deg[a]) < 0.05);
  return (!p.dpos || p.dpos.length() < 5e-4) && (!p.drot || Math.abs(p.drot.w) > 0.99999) && Math.abs(p.dswivel || 0) < 0.05;
}
function keyPending() { const p = pending; pending = null; keyChange(p, S.t, 0); }
// write a change into the tracks at time t; falloff > 0 keeps the change local (anchors at t ± falloff)
function keyChange(p0, t, falloff) {
  const p = redirectMirrored(p0);
  if (!p || pendingIsZero(p)) { updateGizPanel(); return; }
  pushUndo();
  let showChanged = false;
  const keyAt = (pts, tt, v) => keyLocal(pts, tt, v, falloff);
  if (p.kind === 'bone') {
    const ba = A.bones[p.name] || (showChanged = true, ensureBone(p.name));
    for (const a of AXES) {
      const d = p.deg[a]; if (Math.abs(d) < 0.05) continue;
      keyAt(ba.a[a], t, clamp(evalPts(ba.a[a], t) + d, -ADJ_MAX, ADJ_MAX));
      if (!ba.show['a' + a]) { ba.show['a' + a] = true; showChanged = true; }
    }
  } else {
    const had = !!A.ik[p.id], e = ensureEff(p.id), d = EFF_BY_ID[p.id], tr = e.tr;
    if (!had) { showChanged = true; for (const k of Object.keys(e.show)) e.show[k] = false; }
    const show = (k) => { if (!e.show[k]) { e.show[k] = true; showChanged = true; } };
    const w = d.tracks.includes('blend') ? Math.max(0.05, evalPts(tr.blend, t)) : 1;
    if (p.dpos && p.dpos.length() >= 5e-4 && d.tracks.includes('px')) {
      for (const a of AXES) {
        const dv = p.dpos[a] * 100 / w; if (Math.abs(dv) < 0.05) continue;
        const k = 'p' + a; keyAt(tr[k], t, clamp(evalPts(tr[k], t) + dv, TRK[k].range[0], TRK[k].range[1])); show(k);
      }
    }
    if (p.drot && Math.abs(p.drot.w) < 0.99999 && d.tracks.includes('rx')) {
      const q = p.drot.clone().multiply(eulerQ(evalPts(tr.rx, t), evalPts(tr.ry, t), evalPts(tr.rz, t)));
      const eu = new THREE.Euler().setFromQuaternion(q, 'YXZ');
      const vals = { rx: eu.x / DEG, ry: eu.y / DEG, rz: eu.z / DEG };
      for (const k of ['rx', 'ry', 'rz']) { const old = evalPts(tr[k], t); if (Math.abs(vals[k] - old) < 0.05) continue; keyAt(tr[k], t, clamp(vals[k], TRK[k].range[0], TRK[k].range[1])); show(k); }
    }
    if (p.dswivel && Math.abs(p.dswivel) >= 0.05 && d.tracks.includes('swivel')) {
      keyAt(tr.swivel, t, clamp(evalPts(tr.swivel, t) + p.dswivel, TRK.swivel.range[0], TRK.swivel.range[1])); show('swivel');
    }
  }
  if (showChanged) rebuildRows(); else for (const r of rows) if (r.cv) { drawLane(r); refreshSummary(r); }
  editVersion++; trailDirty = true; save(); updateGizPanel(); updateSelChip();
}

function keyLocal(pts, t, v, f) {
  if (!(f > 0)) return keyAtFlat(pts, t, v);
  for (const tt of [t - f, t + f]) if (tt > 1e-4 && tt < S.dur - 1e-4 && !pts.some((q) => Math.abs(q.t - tt) < 1e-3)) setPointAt(pts, tt, evalPts(pts, tt));
  setPointAt(pts, t, v);
}

// ---------------------------------------------------------------- gizmo
let gizmoMode = null, tcontrols = null, gizHelper = null, gizProxy = null, gizAvailable = true;
let gizDragging = false, gizStart = null, gizEndedAt = 0;
function ensureGizmo() {
  if ((tcontrols && gizHelper) || !gizAvailable) return;
  try {
    gizProxy = gizProxy || new THREE.Object3D(); if (!gizProxy.parent) scene.add(gizProxy);
    const tc = new TransformControls(camera, renderer.domElement);
    tc.size = 0.85;
    tc.attach(gizProxy);
    const helper = tc.getHelper ? tc.getHelper() : tc;
    scene.add(helper);
    tc.addEventListener('dragging-changed', (e) => { controls.enabled = !e.value; if (e.value) startGizDrag(); else endGizDrag(); });
    tc.addEventListener('objectChange', onGizChange);
    helper.visible = false; tc.enabled = false;
    tcontrols = tc; gizHelper = helper;
  } catch (err) { gizAvailable = false; tcontrols = null; gizHelper = null; console.warn('Transform gizmo unavailable:', err); }
}
// what the gizmo drives right now: { type: 'bone'|'eff', ... , mode: 'rotate'|'translate', space }
function gizTarget() {
  if (!gizmoMode) return null;
  if (S.selected) {
    if (gizmoMode === 'rotate') return { type: 'bone', name: S.selected, mode: 'rotate', space: 'local' };
    if (S.selected === rig.b.hips.name) return { type: 'eff', id: 'hips', mode: 'translate', space: 'world' };
    return null;
  }
  if (S.selEff) {
    const d = EFF_BY_ID[S.selEff];
    if (gizmoMode === 'rotate' && d.tracks.includes('rx')) return { type: 'eff', id: d.id, mode: 'rotate', space: 'world' };
    if (gizmoMode === 'move' && (d.tracks.includes('px') || d.tracks.includes('swivel'))) return { type: 'eff', id: d.id, mode: 'translate', space: 'world', swivel: !d.tracks.includes('px') };
  }
  return null;
}
function updateGizmoTarget() {
  if (!gizAvailable) return;
  ensureGizmo(); if (!tcontrols || !gizHelper) return;
  const g = gizTarget();
  gizHelper.visible = tcontrols.enabled = !!g;
  if (g) { tcontrols.setMode(g.mode); tcontrols.setSpace(g.space); }
  updateGizPanel();
}
function setGizmoMode(mode) {
  gizmoMode = gizmoMode === mode ? null : mode;
  $('btnGizRot').setAttribute('aria-pressed', gizmoMode === 'rotate');
  $('btnGizMove').setAttribute('aria-pressed', gizmoMode === 'move');
  $('btnSelect').setAttribute('aria-pressed', !gizmoMode);
  updateGizmoTarget();
}
$('btnGizRot').onclick = () => setGizmoMode('rotate');
$('btnSelect').onclick = () => { gizmoMode = null; setGizmoMode(null); };
$('btnGizMove').onclick = () => setGizmoMode('move');
function gizBonePos(g) { return g.type === 'bone' ? worldP(rig.bones[boneIdx.get(g.name)]) : effPos(EFF_BY_ID[g.id]); }
function syncGizmoProxy() {
  if (!tcontrols || !gizHelper || !gizHelper.visible || gizDragging) return;
  const g = gizTarget(); if (!g) return;
  gizProxy.position.copy(gizBonePos(g));
  if (g.type === 'bone') worldQ(rig.bones[boneIdx.get(g.name)], gizProxy.quaternion); else gizProxy.quaternion.identity();
}
function startGizDrag() {
  const g = gizTarget(); if (!g) return;
  gizDragging = true;
  if (!pending || pending.kind !== (g.type === 'bone' ? 'bone' : 'eff') || pending.name !== g.name || pending.id !== g.id) {
    pending = g.type === 'bone' ? { kind: 'bone', name: g.name, deg: { x: 0, y: 0, z: 0 } } : { kind: 'eff', id: g.id, dpos: V3(), drot: new THREE.Quaternion(), dswivel: 0 };
  }
  const st = { g, pos: gizProxy.position.clone(), q: gizProxy.quaternion.clone(), base: JSON.parse(JSON.stringify({ deg: pending.deg || null, dswivel: pending.dswivel || 0 })) };
  if (pending.dpos) st.basePos = pending.dpos.clone();
  if (pending.drot) st.baseRot = pending.drot.clone();
  if (g.type === 'bone') { const b = rig.bones[boneIdx.get(g.name)]; st.localQ = b.quaternion.clone(); st.parentQ = worldQ(b.parent, new THREE.Quaternion()); }
  if (g.swivel) {   // swivel: turn around the limb line (shoulder → hand, hip → foot)
    const d = EFF_BY_ID[g.id], sd = rig.side[d.side];
    st.root = worldP(d.kind === 'elbow' ? sd.upper : sd.thigh); st.end = worldP(d.kind === 'elbow' ? sd.hand : sd.foot);
  }
  gizStart = st;
}
function endGizDrag() {
  gizDragging = false; gizEndedAt = performance.now();
  if (S.autoKey && pending) keyPending();
  updateGizPanel();
}
function onGizChange() {
  if (!gizDragging || !gizStart || !pending) return;
  const st = gizStart, g = st.g;
  if (g.type === 'bone') {
    const newLocal = st.parentQ.clone().invert().multiply(gizProxy.quaternion);
    logQ(st.localQ.clone().invert().multiply(newLocal), vv);
    for (const a of AXES) pending.deg[a] = st.base.deg[a] + vv[a] / DEG;
  } else if (g.mode === 'rotate') {
    pending.drot = gizProxy.quaternion.clone().multiply(st.q.clone().invert()).multiply(st.baseRot);
  } else if (g.swivel) {
    const ax = st.end.clone().sub(st.root).normalize();
    const a0 = perpNorm(st.pos.clone().sub(st.root), ax, V3()), a1 = perpNorm(gizProxy.position.clone().sub(st.root), ax, V3());
    if (a0 && a1) pending.dswivel = st.base.dswivel + Math.atan2(V3().crossVectors(a0, a1).dot(ax), a0.dot(a1)) / DEG;
  } else {
    pending.dpos = st.basePos.clone().add(gizProxy.position.clone().sub(st.pos));
  }
  updateGizPanel();
}
function updateGizPanel() {
  const g = gizTarget(), p = pending;
  $('gizPanel').hidden = !(g || p);
  if (!(g || p)) return;
  let text = g ? (g.mode === 'rotate' ? 'rotate' : g.swivel ? 'swivel' : 'move') : 'change';
  if (p && !pendingIsZero(p)) {
    if (p.kind === 'bone') {
      const lab = axisInfo[p.name] || {};
      let best = 'x'; for (const a of ['y', 'z']) if (Math.abs(p.deg[a]) > Math.abs(p.deg[best])) best = a;
      text = `${best.toUpperCase()} ${sgn(p.deg[best], 1, '°')} (${lab[best] ? lab[best].short : ''})`;
    } else if (p.dswivel && Math.abs(p.dswivel) >= 0.05) text = `swivel ${sgn(p.dswivel, 1, '°')}`;
    else if (p.dpos && p.dpos.length() >= 5e-4) text = `move ${sgn(p.dpos.x * 100, 1, '')} / ${sgn(p.dpos.y * 100, 1, '')} / ${sgn(p.dpos.z * 100, 1, '')} cm`;
    else if (p.drot) { const e = new THREE.Euler().setFromQuaternion(p.drot, 'YXZ'); text = `rotate ${sgn(e.x / DEG, 1, '°')} / ${sgn(e.y / DEG, 1, '°')} / ${sgn(e.z / DEG, 1, '°')}`; }
  }
  $('gizAxis').textContent = text;
  const live = !!(p && !pendingIsZero(p));
  $('btnKey').hidden = $('btnGizCancel').hidden = !live;
}
$('btnKey').onclick = keyPending;
$('btnGizCancel').onclick = cancelPending;
$('btnAutoKey').onclick = () => { S.autoKey = !S.autoKey; syncToggles(); save(); };

// ---------------------------------------------------------------- IK handles
let handles = [];
const HC = { idle: new THREE.Color('#2f8f74'), on: new THREE.Color(COL.ik), sel: new THREE.Color('#ff4fa3'), cIdle: new THREE.Color('#3a86b8'), cOn: new THREE.Color('#5cc8ff') };   // c…: custom controllers
let handleGeo = null;
function makeHandle(d) {
  const g = d.kind === 'igroup' ? 'grp' : d.kind === 'torso' ? (d.id === 'chest' || d.id === 'head' ? 'body' : 'ring') : { hips: 'body', hand: 'end', foot: 'end', elbow: 'pole', knee: 'pole' }[d.kind] || 'small';
  const m = new THREE.Mesh(handleGeo[g], new THREE.MeshBasicMaterial({ color: HC.idle, depthTest: false, transparent: true, opacity: 0.9, wireframe: g === 'grp' }));
  if (g === 'body' || g === 'ring') m.rotation.x = Math.PI / 2;
  m.renderOrder = 12; m.frustumCulled = false; scene.add(m);
  handles.push({ d, m });
}
function buildHandles() {
  handleGeo = {
    body: new THREE.TorusGeometry(0.07, 0.009, 8, 32),
    ring: new THREE.TorusGeometry(0.05, 0.007, 8, 28),
    end: new THREE.BoxGeometry(0.045, 0.045, 0.045),
    pole: new THREE.OctahedronGeometry(0.026),
    small: new THREE.SphereGeometry(0.018, 12, 8),
    grp: new THREE.OctahedronGeometry(0.06),
  };
  for (const d of EFFECTORS) makeHandle(d);
}
function updateHandles() {
  if (handles.length < EFFECTORS.length) for (const d of EFFECTORS) if (!handles.some((h) => h.d === d)) makeHandle(d);   // custom group IKs
  for (const h of handles) {
    h.m.visible = S.showIK && (h.d.kind !== 'igroup' || h.d.custom || !!A.ik[h.d.id] || S.selEff === h.d.id);   // built-in group IK handles only once used; custom controllers always
    if (!h.m.visible) continue;
    h.m.position.copy(effPos(h.d));
    const on = !!A.ik[h.d.id], sel = S.selEff === h.d.id;
    h.m.material.color.copy(sel ? HC.sel : h.d.custom ? (on ? HC.cOn : HC.cIdle) : on ? HC.on : HC.idle);
    h.m.material.opacity = sel || on ? 0.95 : 0.4;
    h.m.scale.setScalar(sel || on ? 1 : 0.75);
  }
}

// ---------------------------------------------------------------- skeleton overlay + picking
let skel = null;
function buildSkeleton() {
  const under = new Set(); rig.b.hips.traverse((o) => o.isBone && under.add(o));
  const joints = rig.bones.filter((b) => under.has(b) && !/Thumb|Index|Middle|Ring|Pinky|_End$/i.test(b.name));
  const fjoints = rig.bones.filter((b) => under.has(b) && /Thumb|Index|Middle|Ring|Pinky/i.test(b.name) && !/4$|_End$/i.test(b.name));   // finger joints: smaller dots
  const js = new Set([...joints, ...fjoints]); const pairs = [...joints, ...fjoints].filter((b) => b !== rig.b.hips && js.has(b.parent)).map((b) => [b, b.parent]);
  const mk = (color, op) => {
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pairs.length * 6), 3));
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color, transparent: true, opacity: op, depthTest: false })); lines.renderOrder = 10; lines.frustumCulled = false; scene.add(lines); return lines;
  };
  const dot = document.createElement('canvas'); dot.width = dot.height = 32;
  { const x = dot.getContext('2d'); x.fillStyle = '#fff'; x.beginPath(); x.arc(16, 16, 14, 0, Math.PI * 2); x.fill(); }
  const dotTex = new THREE.CanvasTexture(dot);
  const mkPts = (list, size) => {   // round joints (IK handles are the square / ring ones)
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(list.length * 3), 3));
    pg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(list.length * 3), 3));
    const pts = new THREE.Points(pg, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true, map: dotTex, alphaTest: 0.5 }));
    pts.renderOrder = 11; pts.frustumCulled = false; scene.add(pts); return pts;
  };
  skel = { joints, fjoints, pairs, lines: mk('#9aa7a0', 0.8), ghost: mk('#f08a1c', 0.6), pts: mkPts(joints, 8), fpts: mkPts(fjoints, 5), gQ: new Float32Array(B * 4), gH: V3() };
}
const cLim = new THREE.Color('#ff3b3b'), cSel = new THREE.Color('#ff4fa3'), cIn = new THREE.Color('#f08a1c'), cBase = new THREE.Color('#dfe6e1'), cGrp = new THREE.Color(COL.group);
function updateSkeleton(t) {
  const { joints, fjoints, pairs, lines, ghost, pts, fpts } = skel;
  lines.visible = pts.visible = fpts.visible = S.bones; ghost.visible = S.ghost;
  if (S.bones) {
    const lp = lines.geometry.attributes.position.array; pairs.forEach(([a, b], i) => { worldP(a, vv); lp.set([vv.x, vv.y, vv.z], i * 6); worldP(b, vv); lp.set([vv.x, vv.y, vv.z], i * 6 + 3); });
    lines.geometry.attributes.position.needsUpdate = true;
    const gm = S.selGroup ? groupMembers(S.selGroup) : null;
    for (const [P, list] of [[pts, joints], [fpts, fjoints]]) {
      const pp = P.geometry.attributes.position.array, pc = P.geometry.attributes.color.array;
      list.forEach((b, i) => { worldP(b, vv); pp.set([vv.x, vv.y, vv.z], i * 3); const c = S.limits && S.limitHits.has(b.name) ? cLim : b.name === S.selected ? cSel : gm && gm.has(b.name) ? cGrp : A.bones[b.name] ? cIn : cBase; pc.set([c.r, c.g, c.b], i * 3); });
      P.geometry.attributes.position.needsUpdate = true; P.geometry.attributes.color.needsUpdate = true;
    }
  }
  if (S.ghost) {   // the untouched clip, as a skeleton, travelling with him
    sampleClip(clipTime(t), skel.gQ, skel.gH);
    skel.gH.add(shownTravel(t, _trav));
    const f = fk.v; f.run(skel.gQ, skel.gH, 0);
    const gp = ghost.geometry.attributes.position.array;
    pairs.forEach(([a, b], i) => { const pa = f.P[boneIdx.get(a.name)], pb = f.P[boneIdx.get(b.name)]; gp.set([pa.x, pa.y, pa.z, pb.x, pb.y, pb.z], i * 6); });
    ghost.geometry.attributes.position.needsUpdate = true;
  }
}
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4 || !skel || gizDragging) return;
  if (performance.now() - gizEndedAt < 300 || (tcontrols && tcontrols.enabled && tcontrols.axis)) return;
  const best = pickViewport(e.clientX, e.clientY);
  if (!best) clearSelection(); else if (best.eff) selectEff(best.eff); else selectBone(best.bone);
});
function pickViewport(cx, cy) {   // → { eff } | { bone } | null: IK handles first, then joints, then finger joints
  if (!skel) return null;
  const b = renderer.domElement.getBoundingClientRect();
  const scr = (p) => { const q = p.clone().project(camera); return [(q.x + 1) / 2 * b.width + b.left, (1 - q.y) / 2 * b.height + b.top, q.z]; };
  let best = null, bd = 16;
  if (S.showIK) for (const h of handles) { if (!h.m.visible) continue; const [x, y, z] = scr(h.m.position); const d = Math.hypot(x - cx, y - cy); if (z < 1 && d < bd) { bd = d; best = { eff: h.d.id }; } }
  if (!best && S.bones) for (const j of skel.joints) { const [x, y, z] = scr(worldP(j)); const d = Math.hypot(x - cx, y - cy); if (z < 1 && d < bd) { bd = d; best = { bone: j.name }; } }
  if (!best && S.bones) { let fd = 9; for (const j of skel.fjoints) { const [x, y, z] = scr(worldP(j)); const d = Math.hypot(x - cx, y - cy); if (z < 1 && d < fd) { fd = d; best = { bone: j.name }; } } }
  return best;
}
// double-click a custom controller's handle: edit it
renderer.domElement.addEventListener('dblclick', (e) => {
  const hit = pickViewport(e.clientX, e.clientY);
  if (hit && hit.eff && EFF_BY_ID[hit.eff] && EFF_BY_ID[hit.eff].custom) editController(hit.eff);
});
// ================= #6 right-click a bone or IK handle in the viewport (a right-drag still pans)
let rDownAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { if (e.button === 2) rDownAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const at = rDownAt; rDownAt = null;
  if (!rig || !A || (at && Math.hypot(e.clientX - at[0], e.clientY - at[1]) > 5)) return;
  const hit = pickViewport(e.clientX, e.clientY); if (!hit) return;
  if (hit.eff) { selectEff(hit.eff); openViewEffMenu(e, hit.eff); } else { selectBone(hit.bone); openViewBoneMenu(e, hit.bone); }
});
function keyHereArrays(arrs) {   // a point at the playhead on each track, at the value it has there (the curve does not change)
  pushUndo(); let n = 0;
  for (const pts of arrs) { if (!pts) continue; setPointAt(pts, S.t, evalPts(pts, S.t)); n++; }
  editVersion++; trailDirty = true; layoutLanes(); save(); toast(n ? `Keyed ${n} track${n > 1 ? 's' : ''} at ${S.t.toFixed(2)} s.` : 'Nothing shown to key.');
}
function boneArr(ba, k) { return k === 'whole' ? ba.whole : k === 'timing' ? ba.timing : k[0] === 'w' ? ba.w[k[1]] : k[0] === 'a' ? ba.a[k[1]] : null; }
function effOfBone(name) { const b = rig.bones[boneIdx.get(name)]; return EFFECTORS.find((d) => d.kind !== 'igroup' && d.kind !== 'fingers' && effBone(d) === b) || null; }
function openViewBoneMenu(e, name0) {
  const own = A.bones[name0], name = own && own.mirrorOf ? own.mirrorOf : name0, ba = A.bones[name], lab = axisInfo[name0] || {};
  const toggle = (k) => () => { pushUndo(); const b = ensureBone(name); const sh = { ...(b.show || {}) }; sh[k] = !sh[k]; if (!Object.values(sh).some(Boolean)) sh.whole = true; b.show = sh; syncMirrors(); selectBone(name0); save(); };
  const trackItems = BONE_TRACKS.map(([k, l]) => { const ax = k.length === 2 && 'wa'.includes(k[0]) ? k[1] : null; return { label: l + (ax && lab[ax] ? ' · ' + lab[ax].short : ''), checked: !!(ba && ba.show && ba.show[k]), action: toggle(k) }; });
  const ed = effOfBone(name0), grp = GROUP_DEFS.filter((g) => groupMembers(g.id).has(name0));
  const hasKids = rig.bones[boneIdx.get(name0)].children.some((c) => c.isBone);
  openMenu(e.clientX, e.clientY, [
    { label: name0, disabled: true },
    ...trackItems,
    { sep: true },
    ...(ed ? [{ label: A.ik[ed.id] ? `IK: ${ed.label} (on the timeline)` : `Add IK: ${ed.label}…`, action: () => (A.ik[ed.id] ? selectEff(ed.id) : openAddDialog({ type: 'eff', id: ed.id })) }] : []),
    ...(ed && MOVABLE.includes(ed.id) ? [{ label: 'New IK controller with this joint…', action: () => newControllerWith({ [ed.id]: 1 }) }] : []),
    ...grp.map((g) => ({ label: A.groups[g.id] ? `Group: ${g.label} (on the timeline)` : `Add to group: ${g.label}…`, action: () => (A.groups[g.id] ? selectGroup(g.id) : openAddDialog({ type: 'group', id: g.id })) })),
    { label: 'Group: this bone + everything below…', disabled: !hasKids, action: () => (A.groups['sub:' + name0] ? selectGroup('sub:' + name0) : openAddDialog({ type: 'group', id: 'sub:' + name0 })) },
    { sep: true },
    ba ? linkItem('bone', name) : { label: 'Both sides (add a track first)', disabled: true },
    { label: 'Key here (every shown track, at the playhead)', disabled: !ba, action: () => keyHereArrays(Object.keys(ba.show || {}).filter((k) => ba.show[k]).map((k) => boneArr(ba, k))) },
    { label: ba ? 'Show in the timeline' : 'Add to the timeline…', action: () => { if (ba) { selectBone(name0); const r = document.querySelector(`[data-bone="${CSS.escape(name)}"]`); if (r) r.scrollIntoView({ block: 'nearest' }); } else openAddDialog({ type: 'bone', name: name0 }); } },
    { label: 'Remove from the timeline', disabled: !ba, action: () => removeBone(name) },
  ]);
}
function openViewEffMenu(e, id0) {
  const own = A.ik[id0], id = own && own.mirrorOf ? own.mirrorOf : id0, ef = A.ik[id], d = EFF_BY_ID[id0];
  const toggle = (k) => () => { pushUndo(); const x = ensureEff(id); const sh = { ...(x.show || {}) }; sh[k] = !sh[k]; if (!Object.values(sh).some(Boolean)) sh[d.defaultShow[0]] = true; x.show = sh; syncMirrors(); selectEff(id0); save(); };
  const trackItems = d.tracks.map((k) => ({ label: trackLabel(d, k).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(), checked: !!(ef && ef.show && ef.show[k]), action: toggle(k) }));
  openMenu(e.clientX, e.clientY, [
    { label: d.label + ' (IK)', disabled: true },
    ...(d.custom ? [{ label: 'Edit controller…', action: () => editController(id0) }, { label: 'Duplicate controller', disabled: !A.ik[id0], action: () => duplicateController(id0) }, { sep: true }] : []),
    ...trackItems,
    { sep: true },
    ...(!d.custom && MOVABLE.includes(id0) ? [{ label: 'New IK controller with this effector…', action: () => newControllerWith({ [id0]: 1 }) }] : []),
    ef ? linkItem('eff', id) : { label: 'Both sides (add a track first)', disabled: true },
    { label: 'Key here (every shown track, at the playhead)', disabled: !ef, action: () => keyHereArrays(Object.keys(ef.show || {}).filter((k) => ef.show[k]).map((k) => ef.tr[k])) },
    { label: ef ? 'Show in the timeline' : 'Add to the timeline…', action: () => { if (ef) { selectEff(id0); const r = document.querySelector(`[data-eff="${CSS.escape(id)}"]`); if (r) r.scrollIntoView({ block: 'nearest' }); } else openAddDialog({ type: 'eff', id: id0 }); } },
    { label: 'Remove from the timeline', disabled: !ef, action: () => removeEff(id) },
  ]);
}
function updateSelChip() {
  const on = !!(S.selected || S.selEff || S.selGroup); $('selChip').hidden = !on; $('hintChip').hidden = on;
  $('btnGroupSel').hidden = true;
  if (!on) return;
  if (S.selGroup) {
    const gid = S.selGroup, members = [...groupMembers(gid)], inTl = !!A.groups[gid];
    $('selDot').style.background = COL.group;
    const lk = linkOf('group', gid);
    $('selName').textContent = lk ? sideless(groupLabel(gid)) : groupLabel(gid); $('selKind').textContent = `group · ${members.length} bones` + (lk ? ' · both sides' : '');
    const others = A.groupOrder.filter((o) => o !== gid && members.some((b) => groupMembers(o).has(b))).map(groupLabel);
    $('selAxes').innerHTML = '<div class="axrow"><span></span></div>';
    $('selAxes').firstChild.lastChild.textContent = 'Its weight multiplies into every highlighted bone' + (others.length ? `, together with: ${others.join(', ')}.` : '.') + ' Bones: ' + members.slice(0, 12).join(', ') + (members.length > 12 ? ` … (+${members.length - 12})` : '');
    $('btnAddSel').textContent = inTl ? 'Edit tracks' : 'Add to timeline';
    $('btnAddSel').onclick = () => openAddDialog({ type: 'group', id: gid }, inTl && A.groups[gid].show);
    return;
  }
  if (S.selected) {
    $('selDot').style.background = '#ff4fa3';
    const lk = linkOf('bone', S.selected);
    $('selName').textContent = lk ? sideless(S.selected) : S.selected; $('selKind').textContent = lk ? 'bone · FK · both sides' : 'bone · FK';
    $('selAxes').innerHTML = axesLegendHTML(axisInfo[S.selected]);
    $('btnAddSel').textContent = A.bones[S.selected] ? 'Edit tracks' : 'Add to timeline';
    $('btnAddSel').onclick = () => openAddDialog({ type: 'bone', name: S.selected }, A.bones[S.selected] && A.bones[S.selected].show);
    const name = S.selected, gs = groupsOfBone(name);
    if (gs.length) { const d = document.createElement('div'); d.className = 'axrow'; d.innerHTML = '<span></span>'; d.firstChild.textContent = 'In groups: ' + gs.map((g) => `${groupLabel(g)} (${Math.round(evalPts(A.groups[g].weight, S.t) * 100)} %)`).join(' × '); $('selAxes').append(d); }
    if (rig.bones[boneIdx.get(name)].children.some((c) => c.isBone)) {
      $('btnGroupSel').hidden = false;
      $('btnGroupSel').onclick = () => (A.groups['sub:' + name] ? selectGroup('sub:' + name) : openAddDialog({ type: 'group', id: 'sub:' + name }));
    }
  } else {
    const d = EFF_BY_ID[S.selEff];
    $('selDot').style.background = COL.ik;
    const lk = linkOf('eff', d.id);
    $('selName').textContent = lk ? sideless(d.label) : d.label; $('selKind').textContent = (lk ? 'IK · both sides · ' : 'IK · ') + d.what;
    let html = '';
    if (d.tracks.includes('px')) html += '<div class="axhead">Move</div>' + axesLegendHTML(worldAxisInfo('p'));
    if (d.tracks.includes('rx')) html += '<div class="axhead">Rotate</div>' + axesLegendHTML(worldAxisInfo('r'));
    if (d.tracks.includes('swivel')) html += '<div class="axrow"><span>Move the handle (W) to swivel the joint around the limb line.</span></div>';
    if (d.kind === 'fingers') html += '<div class="axrow"><span>Curl + closes the fist · Spread + fans the fingers · Thumb + folds it in.</span></div>';
    if (d.kind === 'toes') html += '<div class="axrow"><span>Toe bend + lifts the toes · − curls them down.</span></div>';
    $('selAxes').innerHTML = html;
    $('btnAddSel').textContent = A.ik[d.id] ? 'Edit tracks' : 'Add to timeline';
    $('btnAddSel').onclick = () => openAddDialog({ type: 'eff', id: d.id }, A.ik[d.id] && A.ik[d.id].show);
  }
}

// ---------------------------------------------------------------- trail (path of the selection over the timeline)
let trail = null, trailDirty = true;
function trailBone() {
  if (S.selected && boneIdx.has(S.selected)) return rig.bones[boneIdx.get(S.selected)];
  if (S.selEff) return effBone(EFF_BY_ID[S.selEff]);
  return null;
}
function trailDotTimes() {   // the dots: on the grid unit's lines with the magnet on, else every 0.1 s
  let ts = [];
  if (S.magnet) ts = visibleGrid(timeGrid(), (ruler.clientWidth || 800) * Math.min(2, window.devicePixelRatio || 1), Math.min(2, window.devicePixelRatio || 1)).filter((g) => g.level >= 1 || S.unit === 'step').map((g) => g.t);
  if (ts.length < 2 || ts.length > 400) { ts = []; for (let i = 0; i <= Math.round(S.dur * 10); i++) ts.push(i / 10); }
  return [...new Set(ts.map((t) => +clamp(t, 0, S.dur).toFixed(5)))].sort((a, b) => a - b);
}
function computeTrail() {
  trailDirty = false;
  const bone = trailBone();
  if (!trail) {
    const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 }));
    const dots = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true }));
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.02, 16, 10), new THREE.MeshBasicMaterial({ color: '#ff4fa3', depthTest: false, transparent: true }));
    line.renderOrder = 9; dots.renderOrder = 13; marker.renderOrder = 14; marker.visible = false;
    line.frustumCulled = dots.frustumCulled = false; scene.add(line, dots, marker);
    trail = { line, dots, marker, times: [], pos: [] };
  }
  if (!bone) { trail.line.visible = trail.dots.visible = false; return; }
  const c0 = new THREE.Color('#5fd3a8'), c1 = new THREE.Color('#ff4fa3'), c = new THREE.Color();
  const sampleAt = (ts) => { const pos = new Float32Array(ts.length * 3), col = new Float32Array(ts.length * 3), pts = []; ts.forEach((t, i) => { evaluate(t, null); const p = worldP(bone); pts.push(p); pos.set([p.x, p.y, p.z], i * 3); c.copy(c0).lerp(c1, t / S.dur); col.set([c.r, c.g, c.b], i * 3); }); return { pos, col, pts }; };
  const n = Math.round(clamp(S.dur * 30, 30, 300)), lineTs = Array.from({ length: n + 1 }, (_, i) => (i / n) * S.dur);
  const L = sampleAt(lineTs), times = trailDotTimes(), D = sampleAt(times);
  const set = (obj, R) => { const g = obj.geometry; g.setAttribute('position', new THREE.BufferAttribute(R.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(R.col, 3)); g.computeBoundingSphere(); };
  set(trail.line, L); set(trail.dots, D);
  trail.times = times; trail.pos = D.pts;
}
function updateTrail() {
  if (!S.trail) { if (trail) trail.line.visible = trail.dots.visible = trail.marker.visible = false; return; }
  if (trailDirty && !trailDrag) computeTrail();
  if (trail) trail.line.visible = trail.dots.visible = !!trailBone();
}
// ---- editing the trail: drag a dot, the change is keyed at that dot's time (local, with falloff)
function trailOwner() {   // → how a dragged dot writes back: IK move, swivel, or the parent bone's FK adjust
  if (S.selEff) {
    const d = EFF_BY_ID[S.selEff];
    if (d.tracks.includes('px')) return { kind: 'eff', id: d.id };
    if (d.kind === 'elbow' || d.kind === 'knee') return { kind: 'swivel', id: d.id };
    return null;
  }
  if (!S.selected || !boneIdx.has(S.selected)) return null;
  const bone = rig.bones[boneIdx.get(S.selected)];
  const e = EFFECTORS.find((x) => x.kind !== 'igroup' && x.tracks.includes('px') && effBone(x) === bone);
  if (e) return { kind: 'eff', id: e.id };
  for (const Sd of ['L', 'R']) { if (bone === rig.side[Sd].fore) return { kind: 'swivel', id: Sd + 'elbow' }; if (bone === rig.side[Sd].shin) return { kind: 'swivel', id: Sd + 'knee' }; }
  return bone.parent && bone.parent.isBone ? { kind: 'fk', bone } : null;
}
function applyTrailEdit(t, delta) {
  const o = trailOwner(); if (!o || delta.length() < 1e-4) return;
  let p = null;
  if (o.kind === 'eff') p = { kind: 'eff', id: o.id, dpos: delta.clone() };
  else if (o.kind === 'swivel') {
    evaluate(t, null);
    const d = EFF_BY_ID[o.id], sd = rig.side[d.side], elbow = d.kind === 'elbow';
    const root = worldP(elbow ? sd.upper : sd.thigh), end = worldP(elbow ? sd.hand : sd.foot), j = worldP(elbow ? sd.fore : sd.shin), ax = end.sub(root).normalize();
    const a0 = perpNorm(j.clone().sub(root), ax, V3()), a1 = perpNorm(j.clone().add(delta).sub(root), ax, V3());
    if (a0 && a1) p = { kind: 'eff', id: o.id, dswivel: Math.atan2(V3().crossVectors(a0, a1).dot(ax), a0.dot(a1)) / DEG };
  } else {
    evaluate(t, null);
    const par = o.bone.parent, pp = worldP(par), bp = worldP(o.bone);
    const q = new THREE.Quaternion().setFromUnitVectors(bp.clone().sub(pp).normalize(), bp.clone().add(delta).sub(pp).normalize());
    const W = worldQ(par), local = W.clone().invert().multiply(q).multiply(W);
    logQ(local, vv);
    p = { kind: 'bone', name: par.name, deg: { x: vv.x / DEG, y: vv.y / DEG, z: vv.z / DEG } };
  }
  if (p) keyChange(p, t, S.falloff);
}
let trailDrag = null;
const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2();
function pointerOnPlane(e, plane) {
  const r = renderer.domElement.getBoundingClientRect();
  _ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  _ray.setFromCamera(_ndc, camera);
  return _ray.ray.intersectPlane(plane, V3());
}
view.addEventListener('pointerdown', (e) => {   // capture phase: a dot wins over orbit and the gizmo
  if (e.button !== 0 || !S.trail || !trail || !trail.dots.visible || !trail.pos.length || !trailOwner()) return;
  const r = renderer.domElement.getBoundingClientRect();
  let best = -1, bd = 10;
  trail.pos.forEach((p, i) => { const q = p.clone().project(camera); const x = (q.x + 1) / 2 * r.width + r.left, y = (1 - q.y) / 2 * r.height + r.top, d = Math.hypot(x - e.clientX, y - e.clientY); if (q.z < 1 && d < bd) { bd = d; best = i; } });
  if (best < 0) return;
  e.stopPropagation(); e.preventDefault();
  const p0 = trail.pos[best].clone(), n = camera.getWorldDirection(V3());
  trailDrag = { i: best, t: trail.times[best], p0, p1: p0.clone(), plane: new THREE.Plane().setFromNormalAndCoplanarPoint(n, p0) };
  trail.marker.position.copy(p0); trail.marker.visible = true;
  view.setPointerCapture(e.pointerId);
}, true);
window.addEventListener('pointermove', (e) => {
  if (!trailDrag) return;
  const p = pointerOnPlane(e, trailDrag.plane); if (!p) return;
  trailDrag.p1.copy(p); trail.marker.position.copy(p);
  const d = p.clone().sub(trailDrag.p0).multiplyScalar(100);
  tip(e, `${trailDrag.t.toFixed(2)} s${unitReadout(trailDrag.t) ? ' (' + unitReadout(trailDrag.t) + ')' : ''} · Δ ${d.x.toFixed(1)} / ${d.y.toFixed(1)} / ${d.z.toFixed(1)} cm · ±${S.falloff.toFixed(2)} s`);
});
window.addEventListener('pointerup', () => {
  if (!trailDrag) return;
  const { t, p0, p1 } = trailDrag; trailDrag = null; tip(null);
  trail.marker.visible = false;
  applyTrailEdit(t, p1.clone().sub(p0));
  trailDirty = true;
});
$('falloffIn').onchange = () => { S.falloff = clamp(parseFloat($('falloffIn').value) || 0, 0, 2); $('falloffIn').value = S.falloff; save(); };

// ---------------------------------------------------------------- camera: follow + frame
const followPos = V3(); let followInit = false;
function hipsGround() { const p = worldP(rig.b.hips); return p.set(p.x, 0, p.z); }
function frameCamera(initial) {
  const h = hipsGround();
  const dir = initial ? V3(2.6, 0.4, 3.3) : camera.position.clone().sub(controls.target);
  const dist = initial ? dir.length() : clamp(dir.length(), 2.5, 8);
  dir.normalize();
  controls.target.set(h.x, 0.95, h.z);
  camera.position.copy(controls.target).addScaledVector(dir, dist);
  followPos.copy(h); followInit = true;
}
function updateFollow(dt) {
  const h = hipsGround();
  if (!followInit) { followPos.copy(h); followInit = true; }
  const prev = followPos.clone();
  const jump = h.distanceTo(followPos) > 6;   // a reset (home, clip change): cut, don't glide
  if (jump) followPos.copy(h); else followPos.lerp(h, 1 - Math.exp(-dt / 0.12));
  if (S.follow) { const d = followPos.clone().sub(prev); camera.position.add(d); controls.target.add(d); }
  return followPos;
}
$('btnFrame').onclick = () => frameCamera(false);

// ---------------------------------------------------------------- toggles
function syncToggles() {
  const set = (id, v) => $(id).setAttribute('aria-pressed', v);
  set('btnBones', S.bones); set('btnGhost', S.ghost); set('btnIK', S.showIK); set('btnTrail', S.trail);
  $('falloffBox').hidden = !S.trail;
  set('btnLimits', S.limits); set('btnInPlace', S.inPlace); set('btnFollow', S.follow); set('btnAutoKey', S.autoKey); set('btnLoop', S.loop);
}
$('btnBones').onclick = () => { S.bones = !S.bones; syncToggles(); };
$('btnGhost').onclick = () => { S.ghost = !S.ghost; syncToggles(); };
$('btnIK').onclick = () => { S.showIK = !S.showIK; syncToggles(); save(); };
$('btnTrail').onclick = () => { S.trail = !S.trail; trailDirty = true; syncToggles(); $('falloffBox').hidden = !S.trail; };
$('btnInPlace').onclick = () => { S.inPlace = !S.inPlace; S.travelBase.set(0, 0, 0); trailDirty = true; holdCache.clear(); syncToggles(); save(); };
$('btnLimits').onclick = () => { S.limits = !S.limits; S.limitHits = new Set(); editVersion++; trailDirty = true; syncToggles(); save(); };
$('btnFollow').onclick = () => { S.follow = !S.follow; syncToggles(); save(); };
