// ============================================================================
//  RESISTANCE DEVICE ("speaker"): a force source that moves with the runner
//  Tracks: X / Y / Z position from the root (m; X + right, Y height above the ground, Z + in front), Facing X / Y / Z
//  (° the way the speaker points: X tilt up / down, Y turn left / right, Z roll), Force (N; + pushes away from the
//  speaker like a fan, − pulls toward it like a magnet) and Spread (° the full cone angle).
//  Settings: body mass, keep speed, falloff with distance (inverse square from 1 m, linear to 4 m, or none).
//  The root is the ground point under the hips, turned with the runner, so the speaker always keeps its place
//  around them. Every body part (head, chest, pelvis, thighs, shins, arms) inside the cone gets its share of the
//  force along the ray from the speaker (smooth at the cone's edge, weaker further away). From the sum
//  (formula based, no simulation, the same result every time):
//   · the body leans against it: forward / back = atan(back push / effective weight), side = atan(side push /
//     effective weight), away from the push; force high on the body bends the spine more, low on it tilts the pelvis
//   · load = back push / weight: shorter steps (−0.75 % per 1 % load, sled studies), more shoulder swing; keep
//     speed on: the cadence rises to hold the speed; off: the cadence drops a little and the speed falls
//   · an up push lightens (hips a little higher), a down push loads (hips lower); a side push widens the steps
//   · the head is pushed along with the force on it
//  It adds to the Run controls (it never overwrites their tracks).
// ============================================================================
const GRAV = 9.81;
const RES_KEYS = ['px', 'py', 'pz', 'fx', 'fy', 'fz', 'force', 'spread'];
const RES_SPEC = {
  px: { range: [-3, 3], ref: 0, color: '#e07a7a', scale: 1, unit: 'm', fmt: (v) => sgn(v, 2, ' m'), snap: 0.05 },
  py: { range: [0, 3], ref: 1.2, color: '#7ad07a', scale: 1, unit: 'm', fmt: (v) => v.toFixed(2) + ' m', snap: 0.05 },
  pz: { range: [-3, 3], ref: 1, color: '#7aa8e0', scale: 1, unit: 'm', fmt: (v) => sgn(v, 2, ' m'), snap: 0.05 },
  fx: { range: [-90, 90], ref: 0, color: '#d09a9a', scale: 1, unit: '°', fmt: (v) => sgn(v, 0, '°'), snap: 1 },
  fy: { range: [-180, 180], ref: 180, color: '#9ad09a', scale: 1, unit: '°', fmt: (v) => sgn(v, 0, '°'), snap: 1 },
  fz: { range: [-180, 180], ref: 0, color: '#9ab4d0', scale: 1, unit: '°', fmt: (v) => sgn(v, 0, '°'), snap: 1 },
  force: { range: [-600, 600], ref: 0, color: '#e8b04a', scale: 1, unit: 'N', fmt: (v) => sgn(v, 0, ' N'), snap: 5 },
  spread: { range: [5, 180], ref: 30, color: '#c08ae0', scale: 1, unit: '°', fmt: (v) => Math.round(v) + '°', snap: 1 },
};
const RES_LABEL = {
  px: 'X position <i>m from the root · + right</i>', py: 'Y position <i>m above the ground</i>', pz: 'Z position <i>m from the root · + in front</i>',
  fx: 'Facing X <i>° tilt · + down</i>', fy: 'Facing Y <i>° turn · 180 = toward the runner from in front</i>', fz: 'Facing Z <i>° roll (a round cone: no effect)</i>',
  force: 'Force <i>N · + push / − pull · 736 N = 75 kg body weight</i>', spread: 'Spread <i>° full cone angle</i>',
};
const RESK = { sideSign: 1, widthSign: -1, stepPerLoad: 0.75, cadDropPerLoad: 0.25, armPerLoad: 0.6, widthCmPerDeg: 0.6, vertCmPerG: 8, sideHipShare: 0.4, headDegPerN: 0.05 };
function newResistAuto(dur) {
  const r = { collapsed: false, mass: 75, keepSpeed: true, falloff: 'inv2' };
  for (const k of RES_KEYS) r[k] = flat(RES_SPEC[k].ref, dur);
  return r;
}
function normalizeResist(r, dur) {
  if (!r) return null;
  if (r.dir && !r.px) {   // an older Resistance (force / direction / vertical): a speaker 1 m back along the pull, pushing along it
    const F = r.force && r.force.length ? r.force[0].v : 0, h = (r.dir[0] ? r.dir[0].v : 180) * DEG, v = (r.vert && r.vert[0] ? r.vert[0].v : 0) * DEG;
    const pull = [Math.sin(h) * Math.cos(v), Math.sin(v), Math.cos(h) * Math.cos(v)], n = newResistAuto(dur);
    n.px = flat(-pull[0], dur); n.py = flat(1.0 - pull[1], dur); n.pz = flat(-pull[2], dur);
    n.fy = flat(Math.atan2(pull[0], pull[2]) / DEG, dur); n.fx = flat(-Math.asin(clamp(pull[1], -1, 1)) / DEG, dur);
    n.force = r.force && r.force.length ? r.force : flat(F, dur); n.spread = flat(120, dur);
    n.mass = r.mass || 75; n.keepSpeed = r.keepSpeed !== false; if (r.bypass) n.bypass = true;
    r = n;
  }
  const d = newResistAuto(dur);
  for (const k of RES_KEYS) if (!Array.isArray(r[k]) || !r[k].length) r[k] = d[k];
  delete r.dir; delete r.vert; delete r.attach;
  if (!(r.mass > 0)) r.mass = 75; if (r.keepSpeed == null) r.keepSpeed = true; if (!['inv2', 'linear', 'none'].includes(r.falloff)) r.falloff = 'inv2';
  return r;
}
const resistOn = () => !!(A && A.resist && !A.resist.bypass) && A.resist.force.some((p) => Math.abs(p.v) > 1e-9);   // no cache: timing is rebuilt before an edit bumps editVersion

// ---------------------------------------------------------------- the body parts (from the bind pose, in the root frame)
// root frame: x = the runner's right, y = up, z = forward
let resBody = null;
function resParts() {
  if (resBody && resBody.rig === rig) return resBody;
  const b = rig.b, hp = rig.bp(b.hips), rs = Math.sign(rig.bp(rig.side.R.upper).x - hp.x) || -1;
  const loc = (...bones) => { const v = V3(); for (const x of bones) v.add(rig.bp(x)); v.divideScalar(bones.length); return V3((v.x - hp.x) * rs, v.y, v.z - hp.z); };
  const parts = [['head', 0.08, [b.head], b.head], ['chest', 0.3, [b.spine2], b.spine2], ['pelvis', 0.2, [b.hips], b.hips]];
  for (const S of ['L', 'R']) { const s = rig.side[S]; parts.push([S + 'thigh', 0.1, [s.thigh, s.shin], s.thigh], [S + 'shin', 0.06, [s.shin, s.foot], s.shin], [S + 'arm', 0.05, [s.upper, s.hand], s.fore]); }
  resBody = { rig, rs, parts: parts.map(([id, share, bones, bone]) => ({ id, share, p: loc(...bones), bone, upper: /head|chest|arm/.test(id) })) };
  return resBody;
}
function resDevice(t) {   // → { pos, dir (unit, root frame), F, half (rad) }
  const r = A.resist, e = (k) => evalPts(r[k], t);
  const dir = V3(0, 0, 1).applyEuler(new THREE.Euler(e('fx') * DEG, e('fy') * DEG, e('fz') * DEG, 'YXZ')).normalize();
  return { pos: V3(e('px'), e('py'), e('pz')), dir, F: e('force'), half: clamp(e('spread'), 5, 180) / 2 * DEG };
}
const resFall = (d, mode) => (mode === 'none' ? 1 : mode === 'linear' ? clamp(1 - d / 4, 0, 1) : Math.min(4, 1 / Math.max(0.35, d) ** 2));
function resPartForces(t) {   // → [{ id, f: Vector3 (N, root frame), w }] and the device
  const B = resParts(), D = resDevice(t), out = [];
  for (const q of B.parts) {
    const ray = q.p.clone().sub(D.pos), d = ray.length(); if (d < 1e-4) { out.push({ ...q, f: V3(), w: 0 }); continue; }
    ray.divideScalar(d);
    const a = Math.acos(clamp(ray.dot(D.dir), -1, 1)), edge = D.half * 0.8;
    const cone = a <= edge ? 1 : a >= D.half ? 0 : 1 - smoothB((a - edge) / Math.max(1e-6, D.half - edge));
    const w = q.share * cone * resFall(d, A.resist.falloff);
    out.push({ ...q, f: ray.multiplyScalar(D.F * w), w });
  }
  return { parts: out, D };
}
// the force at time t, broken down
const RES0 = { back: 0, side: 0, up: 0, load: 0, lean: 0, sideLean: 0, stepK: 1, cadK: 1, armK: 1, heightCm: 0, widthCm: 0, hipShare: 0.5, headRx: 0 };
function resistAt(t) {
  if (!resistOn()) return RES0;
  const r = A.resist, P = resPartForces(t).parts, N = V3(); let up = 0, all = 0, head = V3();
  for (const q of P) { N.add(q.f); const m = q.f.length(); all += m; if (q.upper) up += m; if (q.id === 'head') head = q.f; }
  const back = -N.z, side = N.x, lift = N.y;
  const W = r.mass * GRAV, Weff = Math.max(0.2 * W, W - lift), load = back / W;
  const lean = Math.atan2(back, Weff) / DEG, sideLean = -Math.atan2(side, Weff) / DEG;   // lean against the push
  const stepK = load >= 0 ? clamp(1 - RESK.stepPerLoad * load, 0.5, 1) : clamp(1 - 0.3 * load, 1, 1.2);
  const cadK = r.keepSpeed ? 1 / stepK : load >= 0 ? clamp(1 - RESK.cadDropPerLoad * load, 0.6, 1) : 1;
  const upperFrac = all > 1e-6 ? up / all : 0.5;
  return { back, side, up: lift, load, lean, sideLean, stepK, cadK, armK: 1 + RESK.armPerLoad * Math.max(0, load), heightCm: RESK.vertCmPerG * (lift / W), widthCm: RESK.widthCmPerDeg * Math.abs(sideLean),
    hipShare: 0.5 - 0.25 * upperFrac, headRx: RESK.headDegPerN * head.z };
}
function resistLeanParts(t) { const R = resistAt(t); return { spine: R.lean * (1 - R.hipShare), hip: R.lean * R.hipShare, side: R.sideLean, heightCm: R.heightCm, headRx: R.headRx }; }

// ---------------------------------------------------------------- the speaker in the viewport
let resViz = null;
function resVizBuild() {
  const g = new THREE.Group(); g.renderOrder = 5;
  const dark = new THREE.MeshStandardMaterial({ color: '#4a4f58', roughness: 0.55, metalness: 0.15, emissive: '#15171b' });
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.46, 0.26), dark); cab.position.z = -0.13; g.add(cab);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.012, 10, 40), new THREE.MeshStandardMaterial({ color: '#8a8f99', metalness: 0.6, roughness: 0.3 })); rim.position.set(0, -0.06, 0.004); g.add(rim);
  const woofer = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.045, 0.05, 32, 1, true), new THREE.MeshStandardMaterial({ color: '#0f1013', side: THREE.DoubleSide, roughness: 0.9 }));
  woofer.rotation.x = Math.PI / 2; woofer.position.set(0, -0.06, -0.02); g.add(woofer);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#2d3036' })); cap.rotation.x = Math.PI / 2; cap.position.set(0, -0.06, -0.03); g.add(cap);
  const tw = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 10), new THREE.MeshStandardMaterial({ color: '#9aa0aa', metalness: 0.7, roughness: 0.25 })); tw.position.set(0, 0.14, 0); tw.scale.z = 0.5; g.add(tw);
  const coneMat = new THREE.MeshBasicMaterial({ color: '#ff9a3c', transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false });
  const cone = new THREE.Mesh(new THREE.BufferGeometry(), coneMat); g.add(cone);
  const edge = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#ff9a3c', transparent: true, opacity: 0.5 })); g.add(edge);
  const waves = []; for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.01, 6, 48), new THREE.MeshBasicMaterial({ color: '#ff9a3c', transparent: true, opacity: 0.6, depthWrite: false })); g.add(m); waves.push(m); }
  const arrows = new THREE.Group(); scene.add(arrows);
  scene.add(g);
  resViz = { g, cone, edge, coneMat, waves, arrows, key: '', arrowPool: [] };
}
function resVizCone(half, L) {
  const key = `${half.toFixed(3)}|${L.toFixed(2)}`; if (resViz.key === key) return; resViz.key = key;
  const R = L * Math.tan(Math.min(half, 1.45)), geo = new THREE.ConeGeometry(R, L, 40, 1, true); geo.translate(0, -L / 2, 0); geo.rotateX(-Math.PI / 2);
  resViz.cone.geometry.dispose(); resViz.cone.geometry = geo;
  const pts = []; for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; pts.push(0, 0, 0, Math.cos(a) * R, Math.sin(a) * R, L); }
  const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); resViz.edge.geometry.dispose(); resViz.edge.geometry = eg;
}
function updateResistViz() {
  const on = !!(A && A.resist && !A.resist.bypass && S.showResist !== false && rig);
  if (!on) { if (resViz) { resViz.g.visible = false; resViz.arrows.visible = false; } return; }
  if (!resViz) resVizBuild();
  const B = resParts(), rs = B.rs, hp = worldP(rig.b.hips), root = V3(hp.x, 0, hp.z);
  const { parts, D } = resPartForces(S.t), toW = (v) => V3(v.x * rs, v.y, v.z);
  const pos = root.clone().add(toW(D.pos)), dirW = toW(D.dir).normalize();
  resViz.g.visible = true; resViz.g.position.copy(pos); resViz.g.lookAt(pos.clone().add(dirW));
  const L = clamp(D.pos.length() + 0.35, 0.8, 2.5); resVizCone(D.half, L);
  const push = D.F >= 0, col = push ? '#ff9a3c' : '#4aa3ff', mag = Math.min(1, Math.abs(D.F) / 300);
  resViz.coneMat.color.set(col); resViz.edge.material.color.set(col); resViz.coneMat.opacity = 0.05 + 0.12 * mag;
  const now = performance.now() / 1000, speed = 0.35 + 0.9 * mag;
  resViz.waves.forEach((m, i) => {
    let ph = (now * speed + i / resViz.waves.length) % 1; if (!push) ph = 1 - ph;
    const z = ph * L, rad = Math.max(0.02, z * Math.tan(Math.min(D.half, 1.45)));
    m.position.set(0, 0, z); m.scale.set(rad, rad, 1); m.material.color.set(col); m.material.opacity = (Math.abs(D.F) > 0.5 ? 0.15 + 0.55 * mag : 0.08) * (1 - ph * 0.7);
    m.visible = true;
  });
  // arrows on the body parts that get a push
  resViz.arrows.visible = true;
  while (resViz.arrowPool.length < parts.length) { const a = new THREE.ArrowHelper(V3(0, 0, 1), V3(), 0.3, col, 0.08, 0.05); resViz.arrows.add(a); resViz.arrowPool.push(a); }
  parts.forEach((q, i) => {
    const a = resViz.arrowPool[i], m = q.f.length();
    if (m < 2) { a.visible = false; return; }
    a.visible = true; a.position.copy(worldP(q.bone)); a.setDirection(toW(q.f).normalize()); a.setLength(clamp(m / 120, 0.1, 0.7), 0.07, 0.045); a.setColor(col);
  });
}

// ---------------------------------------------------------------- the timeline block
function drawResistBlock() {
  const r = A.resist; if (!r) return;
  const hr = mkRow('bone sym resb'); Object.assign(hr, { kind: 'resist' });
  hr.h.innerHTML = `<button type="button" class="mini" data-act="fold" aria-expanded="${!r.collapsed}">${r.collapsed ? '▸' : '▾'}</button><span class="symtag">RESISTANCE</span><span class="name"></span><button type="button" class="mini" data-act="set" title="Body mass, keep speed, falloff, show the speaker">⚙</button><button type="button" class="mini" data-act="del" title="Remove">×</button>`;
  hr.h.querySelector('[data-act="fold"]').onclick = () => { r.collapsed = !r.collapsed; rebuildRows(); save(); };
  hr.h.querySelector('[data-act="set"]').onclick = () => openResistDlg();
  hr.h.querySelector('[data-act="del"]').onclick = () => confirmDelete('Remove the resistance device and its tracks?', () => { pushUndo(); removeResistNow(); });
  addBypass(hr, r, null);
  hr.h.oncontextmenu = (ev) => { ev.preventDefault(); if (rightDouble('res')) hr.h.querySelector('[data-act="del"]').click(); };
  hr.lane.innerHTML = '<div class="summary"></div>'; hr.resSum = hr.lane.firstChild; resistSummary(hr);
  tracksEl.append(hr.el); rows.push(hr);
  if (r.collapsed) return;
  for (const k of RES_KEYS) addTrackRow(`r|${k}`, RES_SPEC[k], () => r[k], (p) => { r[k] = p; }, RES_LABEL[k], { type: 'resist', id: 'main', k });
}
function resistSummary(hr) {
  const r = A.resist; if (!hr || !hr.resSum || !r) return;
  const R = resistAt(S.t), hit = resistOn() ? resPartForces(S.t).parts.filter((q) => q.f.length() >= 2).map((q) => q.id) : [];
  hr.resSum.textContent = `${r.mass} kg · ${r.keepSpeed ? 'keep speed' : 'speed drops'} · at the playhead: push ${Math.round(Math.hypot(R.back, R.side, R.up))} N on ${hit.length ? hit.join(', ') : 'nothing'} · load ${Math.round(R.load * 100)} %, lean ${sgn(R.lean, 1, '°')}, side ${sgn(R.sideLean, 1, '°')}, step ${Math.round(R.stepK * 100)} %, cadence ${Math.round(R.cadK * 100)} %`;
}
function addResist() {
  if (A.resist) return;
  pushUndo(); A.resist = newResistAuto(S.dur); addRowKey('res:main');
  editVersion++; rebuildRows(); save();
}
function removeResistNow() {
  delete A.resist; if (A.rowOrder) A.rowOrder = A.rowOrder.filter((k) => k !== 'res:main');
  moveEndCache = null; editVersion++; trailDirty = true; holdCache.clear(); rebuildSpeedLUT(); lockCycles(true); rebuildRows(); save();
}
function resistChanged() { moveEndCache = null; editVersion++; trailDirty = true; holdCache.clear(); pinPointsToBar(); lockCycles(true); syncLenInputs(); rebuildRows(); save(); }
function openResistDlg() {
  const r = A.resist; if (!r) return;
  $('resMass').value = r.mass; $('resFall').value = r.falloff; $('resKeep').checked = !!r.keepSpeed; $('resShow').checked = S.showResist !== false;
  $('resDlg').hidden = false;
}
$('resMass').onchange = () => { if (!A.resist) return; pushUndo(); A.resist.mass = clamp(+$('resMass').value || 75, 20, 200); resistChanged(); };
$('resFall').onchange = () => { if (!A.resist) return; pushUndo(); A.resist.falloff = $('resFall').value; resistChanged(); };
$('resKeep').onchange = () => { if (!A.resist) return; pushUndo(); A.resist.keepSpeed = $('resKeep').checked; resistChanged(); };
$('resShow').onchange = () => { S.showResist = $('resShow').checked; };
$('resClose').onclick = () => { $('resDlg').hidden = true; };
$('resDlg').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('resDlg').hidden = true; });
