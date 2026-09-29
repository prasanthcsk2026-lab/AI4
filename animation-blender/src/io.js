
// ============================================================================
//  TRANSPORT, EXPORT / IMPORT, FRAME LOOP
// ============================================================================
function goHome() { S.t = 0; S.travelBase.set(0, 0, 0); trailDirty = true; }
$('btnPlay').onclick = () => { S.playing = !S.playing; if (S.playing && S.t >= S.dur - 1e-4) S.t = 0; $('btnPlay').textContent = S.playing ? 'Pause' : 'Play'; };
$('btnHome').onclick = goHome;
$('btnLoop').onclick = () => { S.loop = !S.loop; syncToggles(); };
// Length or Cycles: one sets the timeline, the other just shows the matching value (the clip's cadence never changes)
function syncLenInputs() {
  const byLen = false;
  if (cur && cur.dur > 0 && A && A.cycles > 0) $('cycIn').classList.toggle('drift', Math.abs(realCycles() - A.cycles) > 0.005);
  $('durIn').value = +S.dur.toFixed(3); $('cycIn').value = cur && cur.dur > 0 ? +(byLen || !(A && A.cycles > 0) ? realCycles() : A.cycles).toFixed(2) : '';
  $('durIn').readOnly = !byLen; $('cycIn').readOnly = byLen;
  $('durIn').classList.toggle('derived', !byLen); $('cycIn').classList.toggle('derived', byLen);
}
$('cycIn').onchange = () => { if (!cur) return; setCycles(parseFloat($('cycIn').value)); };
// cycles the timeline really holds (cycle speed / bar reach / playback speed included)
function realCycles() { const lut = S.speedLUT; return lut && lut.length && lut.length === Math.max(2, Math.ceil(S.dur * 960) + 1) ? lut[lut.length - 1] / cur.dur : S.dur / cur.dur; }
$('durIn').onchange = () => syncLenInputs();   // read-only: the length follows the bars and the speeds
function setLength(dIn) {
  const d = clamp(+(+dIn).toFixed(3), 0.2, 120);
  pushUndo();
  const k = d / S.dur;   // points keep their place relative to the length
  const scale = (pts) => pts.forEach((p) => (p.t *= k));
  scale(A.speed); scale(A.move);
  for (const n of A.order) { const ba = A.bones[n]; scale(ba.whole); scale(ba.timing); for (const a of AXES) { scale(ba.w[a]); scale(ba.a[a]); } }
  for (const id of A.ikOrder) { const e = A.ik[id]; for (const key in e.tr) scale(e.tr[key]); }
  for (const gid of A.groupOrder) { const g = A.groups[gid]; scale(g.weight); scale(g.timing); }
  for (const k of A.symOrder) { scale(A.sym[k].weight); scale(A.sym[k].offset); }
  scale(A.cyc); scale(A.gnd); scale(A.stride);
  S.dur = A.dur = d; S.t = Math.min(S.t, d); S.v0 = 0; S.v1 = d; syncLenInputs(); updateHScroll(); rebuildSpeedLUT(); layoutLanes(); trailDirty = true; save();
}
$('btnReset').onclick = () => {
  confirmDelete(`Clear all automation for "${cur.name}"? Every group, bone, IK and master track goes.`, () => { pushUndo(); A = newAuto(S.dur); S.selected = null; S.selEff = null; S.selGroup = null; rebuildSpeedLUT(); rebuildRows(); save(); afterSelect(); }, 'Clear all');
};
$('toastUndo').onclick = () => { undo(); $('toast').hidden = true; };
// ---------------------------------------------------------------- foot lock dialog
function flReport() {
  const r = footSlideReport();
  $('flSlide').textContent = r.spans ? `While locked the foot's own animation drifts ${r.meanCm.toFixed(1)} cm on average (at most ${r.maxCm.toFixed(1)} cm) over ${r.spans} contacts. That is what the release blend hides; "Match moving speed" (×${r.k.toFixed(2)}) takes out the part that comes from the travel speed.` : 'No foot-lock tracks yet.';
}
$('btnFootLock').onclick = () => { $('flDlg').hidden = false; $('flNote').textContent = ''; $('flOut').value = S.lockOut ?? 0.12; $('flIn').value = S.lockIn ?? 0.03; flReport(); };
const flBlends = () => { S.lockOut = clamp(+$('flOut').value || 0, 0, 0.5); S.lockIn = clamp(+$('flIn').value || 0, 0, 0.3); holdCache.clear(); editVersion++; trailDirty = true; save(); };
$('flOut').onchange = flBlends; $('flIn').onchange = flBlends;
$('flWrite').onclick = () => { $('flNote').textContent = autoFootLock(); flReport(); };
$('flMatch').onclick = () => { $('flNote').textContent = matchMovingSpeed(); flReport(); };
$('flClose').onclick = () => { $('flDlg').hidden = true; };
$('flDlg').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('flDlg').hidden = true; });
let flashTimer = 0;
function flash(msg) { const el = $('status'); el.dataset.flash = msg; clearTimeout(flashTimer); flashTimer = setTimeout(() => { delete el.dataset.flash; }, 5000); }

// ---------------------------------------------------------------- export / import (JSON)
function exportObj() {
  const P = (pts, mul = 1) => pts.map((p) => [+p.t.toFixed(3), +(p.v * mul).toFixed(3), +p.k.toFixed(2)]);
  const o = {
    tool: 'Animation Blender', format: 3, exportedAt: new Date().toISOString(),
    clip: { id: cur.id, name: cur.c.name, label: cur.name, kind: cur.kind, speed_mps: cur.c.speed ?? null, cycle_s: +cur.dur.toFixed(4), legsOnly: !!cur.c.legsOnly },
    duration_s: S.dur, cycles: A.cycles, in_place: S.inPlace,
    symmetrize: A.symOrder.map((k) => ({ item: k, label: symLabel(k), weight_pct: P(A.sym[k].weight, 100), offset_pct: P(A.sym[k].offset, 100) })),
    note: 'points are [time_s, value, tension]. Groups: weight in % multiplied into every bone listed (groups nest by multiplying), timing in % of the cycle added. FK: weight in %, adjust in degrees about the bone local axis (axes: what + does), timing offset in % of the clip cycle. Group IK: members_pct = share of the group move per effector, pivot = what it rotates about. IK: effector offsets in world axes (X sideways, Y up, Z forward), move in cm, rotate in degrees (Euler YXZ), blend / pin / pull / feet in %, hold 0/1, swivel / curl / spread / thumb / toe bend in degrees. Playback speed in % of the clip speed (cadence); moving speed in % of the ground the clip covers (travel only).',
    playback_speed_pct: P(A.speed, 100),
    cycle_speed_reach_time_pct: P(A.cyc), bar_reach_pct: A.barSpeed, foot_on_ground_extra_pct: P(A.gnd), stride_length_pct: P(A.stride), stride_moves_arms: A.strideArms !== false, show_master: A.showMaster,
    moving_speed_pct: P(A.move, 100),
    bones: A.order.filter((n) => A.bones[n]).map((n) => {
      const ba = A.bones[n];
      return {
        bone: n, mirror: !!ba.mirror, mirror_of: ba.mirrorOf, axes: Object.fromEntries(AXES.map((a) => [a, axisInfo[n] && axisInfo[n][a] ? axisInfo[n][a].long : ''])), show: ba.show, with_children: !!ba.withChildren,
        whole_weight_pct: P(ba.whole, 100), weight_pct: { x: P(ba.w.x, 100), y: P(ba.w.y, 100), z: P(ba.w.z, 100) },
        adjust_deg: { x: P(ba.a.x), y: P(ba.a.y), z: P(ba.a.z) }, timing_pct: P(ba.timing, 100),
      };
    }),
    groups: A.groupOrder.filter((gid) => A.groups[gid]).map((gid) => ({ group: gid, mirror: !!A.groups[gid].mirror, mirror_of: A.groups[gid].mirrorOf, label: groupLabel(gid), bones: [...groupMembers(gid)], show: A.groups[gid].show, weight_pct: P(A.groups[gid].weight, 100), timing_pct: P(A.groups[gid].timing, 100) })),
    ik: A.ikOrder.filter((id) => A.ik[id]).map((id) => {
      const e = A.ik[id], tracks = {};
      for (const k of EFF_BY_ID[id].tracks) tracks[k] = P(e.tr[k], TRK[k].fmt === pct ? 100 : 1);
      return { effector: id, mirror: !!e.mirror, mirror_of: e.mirrorOf, label: EFF_BY_ID[id].label, show: e.show, tracks, ...(e.members ? { members_pct: Object.fromEntries(Object.entries(e.members).map(([k, v]) => [k, Math.round(v * 100)])), pivot: e.pivot, look: !!e.look } : {}) };
    }),
    view: { heights: A.heights, zoom: A.zoom },
  };
  const ts = []; for (let t = 0; t <= S.dur + 1e-6; t += 0.1) ts.push(+t.toFixed(2));
  o.sampled_10hz = { t: ts, speed_pct: ts.map((t) => Math.round(evalPts(A.speed, t) * 1000) / 10), clip_time_s: ts.map((t) => +clipTime(t).toFixed(3)), bones: {}, ik: {} };
  const s = (pts, m) => ts.map((t) => Math.round(evalPts(pts, t) * m * 10) / 10);
  for (const n of A.order) { const ba = A.bones[n]; if (!ba) continue; o.sampled_10hz.bones[n] = { whole: s(ba.whole, 100), wx: s(ba.w.x, 100), wy: s(ba.w.y, 100), wz: s(ba.w.z, 100), ax: s(ba.a.x, 1), ay: s(ba.a.y, 1), az: s(ba.a.z, 1) }; }
  for (const id of A.ikOrder) { const e = A.ik[id]; if (!e) continue; o.sampled_10hz.ik[id] = Object.fromEntries(EFF_BY_ID[id].tracks.map((k) => [k, s(e.tr[k], TRK[k].fmt === pct ? 100 : 1)])); }
  return o;
}
function importObj(o) {
  const clipId = o.clip && (o.clip.id || ('loop:' + o.clip.name));
  if (clipId && clipId !== cur.id && clips.find((x) => x.id === clipId)) selectClip(clipId);
  const d = +o.duration_s || S.dur, P = (a, div = 1) => (Array.isArray(a) && a.length ? a.map(([t, v, k]) => ({ t: +t, v: +v / div, k: +k || 0 })) : null);
  const n = newAuto(d); n.speed = P(o.playback_speed_pct, 100) || n.speed; n.move = P(o.moving_speed_pct, 100) || n.move; n.cyc = P(o.cycle_speed_reach_time_pct) || n.cyc; if (o.bar_reach_pct) n.barSpeed = o.bar_reach_pct; if (o.show_master) n.showMaster = o.show_master;
  for (const b of o.bones || []) {
    if (!boneIdx.has(b.bone)) continue;
    const ba = newBoneAuto(d);
    ba.whole = P(b.whole_weight_pct, 100) || ba.whole;
    for (const a of AXES) { ba.w[a] = P(b.weight_pct && b.weight_pct[a], 100) || ba.w[a]; ba.a[a] = P(b.adjust_deg && b.adjust_deg[a]) || ba.a[a]; }
    ba.timing = P(b.timing_pct, 100) || ba.timing;
    if (b.hips_offset_cm) ba.hipsPos = { x: P(b.hips_offset_cm.x) || flat(0, d), y: P(b.hips_offset_cm.y) || flat(0, d), z: P(b.hips_offset_cm.z) || flat(0, d) };   // format 2
    ba.show = b.show || { whole: true }; ba.withChildren = !!b.with_children;
    if (b.mirror) ba.mirror = true; if (b.mirror_of) ba.mirrorOf = b.mirror_of;
    n.bones[b.bone] = ba; n.order.push(b.bone);
  }
  for (const g of o.groups || []) {
    if (!g.group || !(GROUP_DEFS.some((d) => d.id === g.group) || (g.group.startsWith('sub:') && boneIdx.has(g.group.slice(4))))) continue;
    const ga = newGroupAuto(d);
    ga.weight = P(g.weight_pct, 100) || ga.weight; ga.timing = P(g.timing_pct, 100) || ga.timing; if (g.show) ga.show = g.show;
    if (g.mirror) ga.mirror = true; if (g.mirror_of) ga.mirrorOf = g.mirror_of;
    n.groups[g.group] = ga; n.groupOrder.push(g.group);
  }
  for (const f of o.ik || []) {
    if (f.effector && f.effector.startsWith('ig:c')) registerIG(f.effector, f.label);
    if (!EFF_BY_ID[f.effector]) continue;
    const e = newEffAuto(f.effector, d);
    for (const k of EFF_BY_ID[f.effector].tracks) e.tr[k] = P(f.tracks && f.tracks[k], TRK[k].fmt === pct ? 100 : 1) || e.tr[k];
    if (f.show) e.show = f.show;
    if (f.mirror) e.mirror = true; if (f.mirror_of) e.mirrorOf = f.mirror_of;
    if (f.members_pct) e.members = Object.fromEntries(Object.entries(f.members_pct).filter(([k]) => EFF_BY_ID[k]).map(([k, v]) => [k, clamp(+v / 100, 0, 1)]));
    if (f.pivot) e.pivot = f.pivot; if (f.look) e.look = true; if (f.effector.startsWith('ig:c')) e.label = f.label;
    n.ik[f.effector] = e; n.ikOrder.push(f.effector);
  }
  if (o.view) { n.heights = o.view.heights || {}; n.zoom = o.view.zoom || {}; }
  pushUndo();
  n.cycles = +o.cycles > 0 ? +o.cycles : 0;
  for (const sy of o.symmetrize || []) if (SYM_KEYS.some(([k]) => k === sy.item)) { const x = newSymAuto(d); x.weight = P(sy.weight_pct, 100) || x.weight; x.offset = P(sy.offset_pct, 100) || x.offset; n.sym[sy.item] = x; n.symOrder.push(sy.item); }
  A = normalizeAuto(n); S.dur = d; S.v0 = 0; S.v1 = d; S.t = 0; selPts = new Set(); selRow = null;
  if (!(A.cycles > 0) || !(+o.cycles > 0)) { rebuildSpeedLUT(); A.cycles = +(Math.round(realCycles() * 100) / 100).toFixed(2); }
  A.cycLocked = true; ensureEnds();
  rebuildSpeedLUT(); lockCycles(true); syncLenInputs(); rebuildRows(); save(); afterSelect();
}

// ---------------------------------------------------------------- baked glTF (.glb in a .zip)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zipStore(files) {   // [{ name, data: Uint8Array }] → a stored (uncompressed) zip
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  for (const f of files) {
    const nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(8, 0, true); lh.setUint32(14, crc, true); lh.setUint32(18, sz, true); lh.setUint32(22, sz, true); lh.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(lh.buffer), nm, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint32(16, crc, true); ch.setUint32(20, sz, true); ch.setUint32(24, sz, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nm);
    off += 30 + nm.length + sz;
  }
  const cSize = central.reduce((s, p) => s + p.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cSize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
async function bakeGLB(fps = 30) {
  const n = Math.max(2, Math.round(S.dur * fps) + 1), times = new Float32Array(n);
  const bones = rig.bones, qs = bones.map(() => new Float32Array(n * 4)), hp = new Float32Array(n * 3);
  const base = S.travelBase.clone(); S.travelBase.set(0, 0, 0);
  try {
    for (let i = 0; i < n; i++) {
      const t = Math.min(S.dur, i / fps); times[i] = t;
      evaluate(t, null);
      bones.forEach((b, j) => b.quaternion.toArray(qs[j], i * 4));
      rig.b.hips.position.toArray(hp, i * 3);
    }
  } finally { S.travelBase.copy(base); }
  const tracks = bones.map((b, j) => new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, qs[j]));
  tracks.push(new THREE.VectorKeyframeTrack(rig.b.hips.name + '.position', times, hp));
  const clip = new THREE.AnimationClip(`${cur.c.name}_blended`, S.dur, tracks);
  const exp = new GLTFExporter();
  const glb = await exp.parseAsync(model, { binary: true, animations: [clip], onlyVisible: true });
  return new Uint8Array(glb);
}
let caps = { downloads: null, db: null };
(async () => { try { if (window.claude && window.claude.use) { const [d, db] = await Promise.all([window.claude.use('downloads'), window.claude.use('db')]); caps = { downloads: d, db }; } } catch { /* no runtime here */ } })();
function stamp() { return new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'); }
function openSheet(mode) {
  const sh = $('sheet'), tx = $('sheetText'), note = $('sheetNote'), b1 = $('sheetB1'), b2 = $('sheetB2'), b4 = $('sheetB4'), b5 = $('sheetB5'); sh.hidden = false; note.textContent = '';
  if (mode === 'export') {
    $('sheetTitle').textContent = 'Export'; const json = JSON.stringify(exportObj(), null, 1); tx.value = json; tx.readOnly = true;
    b1.textContent = 'Copy JSON'; b1.onclick = async () => { try { await navigator.clipboard.writeText(json); note.textContent = 'Copied.'; } catch { tx.select(); note.textContent = 'Copy is blocked here: the text is selected, press Ctrl+C.'; } };
    b2.hidden = !caps.downloads; b2.textContent = 'Download .json';
    b2.onclick = async () => { const fn = `animation-blender_${cur.c.name}_${stamp()}.json`; try { await caps.downloads.save({ filename: fn, data: json }); note.textContent = 'Saved as ' + fn + '.'; } catch (e) { note.textContent = e && e.code === 'declined' ? 'Download cancelled.' : 'Download is not available here: use Copy JSON.'; } };
    b4.hidden = !caps.db;
    b4.onclick = async () => { try { const o = exportObj(); delete o.sampled_10hz; await caps.db.doc('studio/' + cur.c.name.replace(/[^A-Za-z0-9_.~:@+-]/g, '_')).set({ ...o, savedAt: Date.now() }); note.textContent = 'Saved. Tell Claude which clip you worked on.'; } catch (e) { note.textContent = 'Could not save (' + (e && e.code || 'error') + '): use Copy JSON.'; } };
    b5.hidden = !caps.downloads;
    b5.onclick = async () => {
      note.textContent = 'Baking the animation…';
      try {
        const glb = await bakeGLB(30), base = `${cur.c.name}_blended`;
        const zip = zipStore([{ name: base + '.glb', data: glb }]);
        note.textContent = `Baked ${(glb.length / 1e6).toFixed(1)} MB. Confirm the download…`;
        await caps.downloads.save({ filename: `${base}_${stamp()}.zip`, data: zip });
        note.textContent = 'Saved: unzip it for the .glb (character + baked animation, 30 fps' + (S.inPlace ? ', in place' : ', with root travel') + ').';
      } catch (e) { note.textContent = e && e.code === 'declined' ? 'Download cancelled.' : 'glTF export failed: ' + ((e && (e.message || e.code)) || 'error'); console.error(e); }
    };
    if (!caps.downloads) note.textContent = 'Copy the JSON and paste it to Claude (downloads are not available in this view).';
  } else {
    $('sheetTitle').textContent = 'Import automation'; tx.value = ''; tx.readOnly = false; tx.placeholder = 'Paste exported JSON here, or choose a file.';
    b1.textContent = 'Choose file'; b1.onclick = () => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json'; inp.onchange = () => { const f = inp.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { tx.value = rd.result; }; rd.readAsText(f); }; inp.click(); };
    b2.hidden = false; b2.textContent = 'Load'; b2.onclick = () => { try { importObj(JSON.parse(tx.value)); sh.hidden = true; } catch (err) { note.textContent = 'That is not valid Animation Blender JSON.'; console.warn(err); } };
    b4.hidden = true; b5.hidden = true;
  }
}
$('btnExport').onclick = () => openSheet('export');
$('btnImport').onclick = () => openSheet('import');
$('sheetB3').onclick = () => { $('sheet').hidden = true; };
$('sheet').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('sheet').hidden = true; });

// ---------------------------------------------------------------- viewport HUD: unit readout + hand reach
function updateUnitChip() {
  const el = $('unitChip'), ur = unitReadout(S.t);
  el.hidden = !ur; if (!ur) return;
  let html = '';
  if (S.unit === 'step') {
    const G = timeGrid(), on = (Sd) => G.spans.some((sp) => sp.S === Sd && S.t >= sp.t0 && S.t <= sp.t1);
    html = `<span class="ft${on('L') ? ' on' : ''}"><i style="background:${COL.timing}"></i>L</span><span class="ft${on('R') ? ' on' : ''}"><i style="background:#ff8a4a"></i>R</span> `;
  }
  const key = html + ur; if (el.dataset.k === key) return; el.dataset.k = key;
  el.innerHTML = html + '<b></b>'; el.lastChild.textContent = ur;
}
// how far forward of the hips each hand gets at its peak over the timeline (to check left / right symmetry)
let reachAt = { v: -1, when: 0, L: 0, R: 0 };
function updateReach() {
  const now = performance.now();
  if (reachAt.v === editVersion || now - reachAt.when < 500 || !cur) return;
  reachAt = { v: editVersion, when: now, L: -Infinity, R: -Infinity };
  const n = Math.round(clamp(S.dur * 60, 60, 900)), fy = { L: [], R: [] }, ts = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * S.dur; ts.push(t);
    evaluate(t, null);
    const hz = worldP(rig.b.hips).z;
    for (const Sd of ['L', 'R']) { reachAt[Sd] = Math.max(reachAt[Sd], worldP(rig.side[Sd].hand).z - hz); fy[Sd].push(worldP(rig.side[Sd].foot).y); }
  }
  // step times from the feet as they are now: a foot lands when it comes down within 2 cm of its lowest
  const lands = [];
  for (const Sd of ['L', 'R']) {
    const lo = Math.min(...fy[Sd]); let down = true;
    fy[Sd].forEach((y, i) => { const d = y < lo + 0.02; if (d && !down) lands.push({ S: Sd, t: ts[i] }); down = d; });
  }
  lands.sort((a, b) => a.t - b.t);
  const dur = { LR: [], RL: [] };
  for (let i = 1; i < lands.length; i++) if (lands[i].S !== lands[i - 1].S) dur[lands[i - 1].S + lands[i].S].push(lands[i].t - lands[i - 1].t);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const sL = avg(dur.LR), sR = avg(dur.RL), sc = $('stepChip');
  sc.hidden = sL == null || sR == null;
  if (!sc.hidden) sc.innerHTML = `Steps <b>L→R ${sL.toFixed(3)}</b> · <b>R→L ${sR.toFixed(3)}</b> s <span class="${Math.abs(sL - sR) > 0.015 ? 'warn' : ''}">Δ ${Math.abs(sL - sR).toFixed(3)}</span>`;
  reachAt.steps = { LR: sL, RL: sR };
  const el = $('reachChip'), L = reachAt.L * 100, R = reachAt.R * 100, d = Math.abs(L - R);
  el.hidden = false;
  el.innerHTML = `Hand peak fwd <b>R ${R.toFixed(1)}</b> · <b>L ${L.toFixed(1)}</b> cm <span class="${d > 2 ? 'warn' : ''}">Δ ${d.toFixed(1)}</span>`;
}

// ---------------------------------------------------------------- loop
let last = performance.now(), frameErrCount = 0;
function frame(now) {
  try {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (S.playing) {
      S.t += dt;
      if (S.t >= S.dur) {
        if (S.loop) { S.t -= S.dur; if (!S.inPlace) { S.travelBase.add(trueTravel(S.dur)); trailDirty = true; } }
        else { S.t = S.dur; S.playing = false; $('btnPlay').textContent = 'Play'; }
      }
    }
    updateTrail();
    updateReach();
    evaluate(S.t, pending);
    updateSkeleton(S.t);
    updateHandles();
    updateTripod();
    try { syncGizmoProxy(); } catch (err) { gizAvailable = false; console.warn('gizmo sync failed, disabling:', err); }
    const focus = updateFollow(dt);
    controls.update();
    placeWorld(focus);
    renderer.render(scene, camera);
    if (S.playing) followPlayhead();
    placePlayhead();
    $('clock').textContent = `${S.t.toFixed(2)} / ${S.dur.toFixed(2)} s`;
    updateUnitChip(); updateWorkspace(); updateSpeedHud();
    const ct = clipTime(S.t), el = $('status');
    const travel = S.inPlace ? 'in place' : `travel ${hipsGround().length().toFixed(1)} m`;
    el.textContent = el.dataset.flash || `clip time ${ct.toFixed(2)} s · ${cur.kind === 'loop' ? 'cycle ' + cur.dur.toFixed(3) + ' s · phase ' + mod1(ct / cur.dur).toFixed(2) : 'move ' + cur.dur.toFixed(2) + ' s'} · speed ${Math.round(evalPts(A.speed, S.t) * 100)}% · moving ${Math.round(evalPts(A.move, S.t) * 100)}% · ${travel}`;
    for (const r of rows) if (r.valEl) r.valEl.textContent = r.fmt(evalPts(r.get(), S.t));
    frameErrCount = 0;
  } catch (err) {
    frameErrCount++;
    if (frameErrCount < 6) console.error('Frame error (recovering):', err);
  }
  requestAnimationFrame(frame);
}
function resize() {
  const w = view.clientWidth, h = view.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(h, 1); camera.updateProjectionMatrix();
  if (A) layoutLanes();
}
window.addEventListener('resize', resize);
new ResizeObserver(() => resize()).observe(view);
// test hook (read-only use from automated checks)
window.__ab = { S, get camera() { return camera; }, get pending() { return pending; }, get A() { return A; }, get rig() { return rig; }, get axisInfo() { return axisInfo; }, get rows() { return rows; }, evaluate, worldP, ensureEff, ensureBone, rebuildRows, fkPositionsAt, trueTravel, effPos, EFF_BY_ID, autoFootLock, bakeGLB, zipStore, keyPending, setPending: (p) => { pending = p; }, selectEff, selectBone, flat, THREE, get boneIdx() { return boneIdx; }, ensureGroup, groupMembers, syncMirrors, setMirrorLink, keyChange, applyTrailEdit, registerIG, trailOwner, get trail() { return trail; }, igPivotPos, get reach() { return reachAt; }, applySymmetrize, newSymAuto, redirectMirrored, openAddDialog, selectGroup, GROUP_DEFS, stProcess, stSave, stFrames, buildFbx, glbFromFrames, openSymTool, get ST() { return ST; }, rebuildSpeedLUT, timeOfClipTime, clipTime, setView, get cur() { return cur; }, bakeAndReplace, revertBake, bakedDoc, get BAKED() { return BAKED; }, tplSave, tplList, tplOpen, tplFromTimeline, holdBlend, fkPositionsAt, footSlideReport, matchMovingSpeed, xOfPublic: (r, t) => xOf(r, t), yOfPublic: (r, v) => yOf(r, v), applySprintToJog, TPL_DEF, gridT: () => timeGrid().lines.filter((g) => g.level === 2).map((g) => +g.t.toFixed(3)), gndPhase, gndWin, footContact, impRetarget, impCut, impLandings, addImportedClip, get clips() { return clips; }, selectClip, copyBars, pasteBars, get barClip() { return barClip; }, timelineFrames, groundSpeedAt, speedSeries, curveItems, RIG_TO_CC, exportTimelineFbx, openTimelineFbx };
boot().catch((e) => { $('loading').textContent = 'Could not load: ' + e.message; console.error(e); });
