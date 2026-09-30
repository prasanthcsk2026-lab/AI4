
// ============================================================================
//  TIMELINE
//  One row per track. Every track row has its own height (drag its bottom edge) and its own value zoom
//  (Ctrl / Alt + wheel over the lane), so values can be placed precisely; double-click a point, or click
//  a track's value readout, to type an exact number.
// ============================================================================
const tracksEl = $('tracks');
const playhead = $('playhead'); document.querySelector('.tl').append(playhead);
let rows = [];
const LANE_H = 38, MIN_H = 24, MAX_H = 360, PAD = 6;
const HEIGHT_PRESETS = [['Small', 30], ['Normal', LANE_H], ['Tall', 90], ['Extra tall', 180]];

// track specs: how to read, write, show and snap one curve
const SPEC = {
  speed: { range: [0, SPEED_MAX], ref: 1, color: COL.speed, scale: 100, unit: '%', fmt: pct, snap: 0.05 },
  move: { range: [0, 3], ref: 1, color: COL.move, scale: 100, unit: '%', fmt: pct, snap: 0.05 },
  stride: { range: [50, 150], ref: 100, color: '#ffc94d', scale: 1, unit: '% stride', fmt: (v) => Math.round(v) + '%', snap: 5 },
  gnd: { range: [0, GND_MAX], ref: 0, color: '#7fd4a8', scale: 1, unit: '% of cycle', fmt: (v) => '+' + Math.round(v) + '%', snap: 1 },
  cyc: { range: [25, 400], ref: 100, color: '#f5a3ff', scale: 1, unit: '% speed', fmt: (v) => Math.round(v) + '%', snap: 5 },
  whole: { range: [0, W_MAX], ref: 1, color: COL.weight, scale: 100, unit: '%', fmt: pct, snap: 0.05 },
  w: { range: [0, W_MAX], ref: 1, color: COL.weight, scale: 100, unit: '%', fmt: pct, snap: 0.05 },
  a: { range: [-ADJ_MAX, ADJ_MAX], ref: 0, color: COL.adjust, scale: 1, unit: '°', fmt: (v) => sgn(v, 1, '°'), snap: 1 },
  timing: { range: [-TIMING_MAX, TIMING_MAX], ref: 0, color: COL.timing, scale: 100, unit: '% cycle', fmt: (v) => (v >= 0 ? '+' : '') + Math.round(v * 100) + '%', snap: 0.01 },
};
function effSpec(k) {
  const T = TRK[k];
  const scale = T.fmt === pct ? 100 : 1, unit = T.fmt === pct ? '%' : T.flag ? '(0 / 1)' : T.kind === 'p' ? 'cm' : '°';
  return { range: T.range, ref: T.ref, color: T.color, scale, unit, fmt: T.fmt, snap: T.snap, flag: !!T.flag };
}

// Vegas-style mute: M on a bone / group / IK / symmetrize header turns it off without deleting it (twin side too)
function addBlockGrip(hr, key) {
  const g = document.createElement('span'); g.className = 'bgrip'; g.textContent = '⋮⋮'; g.title = 'Drag to move this block up or down';
  hr.h.prepend(g);
  g.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation(); g.setPointerCapture(e.pointerId);
    const heads = () => [...tracksEl.querySelectorAll('[data-block]')];
    const mark = document.createElement('div'); mark.className = 'blockdrop'; tracksEl.append(mark);
    let target = null;
    const move = (ev) => {
      const hs = heads(), tb = tracksEl.getBoundingClientRect(); let at = hs.length;
      for (let i = 0; i < hs.length; i++) { const b = hs[i].getBoundingClientRect(); if (ev.clientY < b.top + b.height / 2) { at = i; break; } }
      target = at; const ref = hs[at]; mark.style.top = ((ref ? ref.getBoundingClientRect().top : tb.top + tracksEl.scrollHeight - tracksEl.scrollTop) - tb.top + tracksEl.scrollTop - 1) + 'px';
    };
    const up = () => {
      g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); mark.remove();
      if (target == null) return;
      const order = A.rowOrder.slice(), from = order.indexOf(key); if (from < 0) return;
      const keys = heads().map((h) => h.dataset.block), before = keys[target];
      order.splice(from, 1); let to = before ? order.indexOf(before) : order.length; if (to < 0) to = order.length;
      if (order.join('|') === A.rowOrder.filter((k) => k !== key).join('|') && to === from) return;
      pushUndo(); order.splice(to, 0, key); A.rowOrder = order; rebuildRows(); save();
    };
    g.addEventListener('pointermove', move); g.addEventListener('pointerup', up);
  });
}
function addBypass(hr, obj, twinOf) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'bypass'; b.textContent = 'M';
  b.title = obj.bypass ? 'Muted: click to turn it back on' : 'Mute: turn this off without deleting it';
  b.setAttribute('aria-pressed', obj.bypass ? 'true' : 'false'); if (obj.bypass) hr.el.classList.add('bypassed');
  b.onclick = (ev) => {
    ev.stopPropagation(); pushUndo();
    const on = !obj.bypass, tw = twinOf && twinOf();
    for (const o of [obj, tw]) { if (!o) continue; if (on) o.bypass = true; else delete o.bypass; }
    editVersion++; trailDirty = true; holdCache.clear(); rebuildRows(); save();
  };
  const del = hr.h.querySelector('[data-act="del"]'); hr.h.insertBefore(b, del);
}
function mkRow(cls, key) {
  const el = document.createElement('div'); el.className = 'row ' + cls;
  const h = document.createElement('div'); h.className = 'h'; el.append(h);
  const lane = document.createElement('div'); lane.className = 'lanefill'; el.append(lane);
  return { el, h, lane, key };
}
function rowHeight(r) { return r.key ? (A.heights[r.key] || LANE_H) : LANE_H; }
function addTrackRow(key, spec, get, set, labelHTML, owner) {
  const r = mkRow('track t-' + (owner ? owner.type : 'master'), key);
  Object.assign(r, spec, { kind: 'track', get, set, owner });
  r.h.innerHTML = `<span class="sw" style="background:${spec.color}"></span><span class="name">${labelHTML}</span><button type="button" class="val" title="Click to type a value at the playhead"></button><button type="button" class="tdel" title="Delete this track (its automation is cleared)">×</button><div class="rz" title="Drag to set this track's height · double-click for the default"></div>`;
  r.h.title = 'Double-click the name to reset · right-click the lane for track options';
  r.h.querySelector('.name').ondblclick = () => { pushUndo(); set(flat(spec.ref, S.dur)); edited(r); };
  r.valEl = r.h.querySelector('.val');
  r.valEl.onclick = (e) => openNumEdit(r, null, e);
  r.h.querySelector('.tdel').onclick = () => deleteTrack(r);
  r.h.oncontextmenu = (e) => { e.preventDefault(); if (rightDouble('h|' + r.key)) deleteTrack(r); else openMenu(e.clientX, e.clientY, [{ label: 'Delete track (or right double-click)', action: () => deleteTrack(r) }]); };
  const rz = r.h.querySelector('.rz');
  rz.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); rz.setPointerCapture(e.pointerId); rowDrag = { r, y0: e.clientY, h0: rowHeight(r) }; });
  rz.ondblclick = () => setRowHeight(r, LANE_H, true);
  r.el.style.height = rowHeight(r) + 'px';
  lane(r); tracksEl.append(r.el); rows.push(r);
  return r;
}
function setRowHeight(r, h, commit) {
  h = Math.round(clamp(h, MIN_H, MAX_H));
  if (h === LANE_H) delete A.heights[r.key]; else A.heights[r.key] = h;
  r.el.style.height = h + 'px'; layoutLane(r);
  if (commit) save();
}
let rowDrag = null;

function rebuildRows() {
  tracksEl.textContent = ''; rows = [];
  // master tracks are optional (the "+" button); hidden ones keep working with their values
  if (A.showMaster.speed) addTrackRow('speed', SPEC.speed, () => A.speed, (p) => { A.speed = p; }, 'Playback speed <i>cadence</i>', null);
  if (A.showMaster.run) drawRunBlock();
  if (A.showMaster.move) addTrackRow('move', SPEC.move, () => A.move, (p) => { A.move = p; }, 'Travel trim <i>× ground covered (feet may slide)</i>', null);
  if (A.showMaster.cycle && !A.showMaster.run) {
    addTrackRow('cyc', SPEC.cyc, () => A.cyc, (p) => { A.cyc = p; }, 'Cycle speed <i>% · 150 = faster</i>', null);
  }
  if (A.showMaster.stride && !A.showMaster.run) addTrackRow('stride', SPEC.stride, () => A.stride, (p) => { A.stride = p; }, 'Stride length <i>% · feet reach + ground covered</i>', null);
  if (A.showMaster.gnd) addTrackRow('gnd', SPEC.gnd, () => A.gnd, (p) => { A.gnd = p; }, 'Foot on ground <i>+% of cycle · braking</i>', null);
  // symmetrize (one side follows the other, mirrored, half a cycle later)
  const drawSym = (k) => {
    const sy = A.sym[k]; if (!sy) return;
    const hr = mkRow('bone sym'); Object.assign(hr, { kind: 'sym', sym: k });
    hr.h.innerHTML = `<button type="button" class="mini" data-act="fold" aria-expanded="${!sy.collapsed}">${sy.collapsed ? '▸' : '▾'}</button><span class="symtag">SYM</span><span class="name"></span><button type="button" class="mini" data-act="del" title="Remove">×</button>`;
    hr.h.querySelector('.name').textContent = symLabel(k);
    hr.h.querySelector('[data-act="fold"]').onclick = () => { sy.collapsed = !sy.collapsed; rebuildRows(); save(); };
    hr.h.querySelector('[data-act="del"]').onclick = () => confirmDelete(`Remove "${symLabel(k)}" and its tracks?`, () => { pushUndo(); delete A.sym[k]; A.symOrder = A.symOrder.filter((x) => x !== k); rebuildRows(); save(); });
    addBypass(hr, sy, null);
    hr.h.oncontextmenu = (ev) => { ev.preventDefault(); if (rightDouble('s|' + k)) hr.h.querySelector('[data-act="del"]').click(); };
    hr.lane.innerHTML = '<div class="summary"></div>'; hr.lane.firstChild.textContent = 'The target side copies the other side\'s clip motion from the cycle split away (50 % = half a cycle), mirrored. Weight 100 % = fully symmetric. Watch the step times in the viewport.';
    tracksEl.append(hr.el); rows.push(hr);
    sy.show = sy.show || { weight: true, offset: true };
    if (!sy.collapsed) {
      if (sy.show.weight !== false) addTrackRow(`s|${k}|weight`, { ...SPEC.whole, range: [0, 1], color: '#e58ad6' }, () => sy.weight, (p) => { sy.weight = p; }, 'Symmetry <i>weight</i>', { type: 'sym', id: k });
      if (sy.show.offset !== false) addTrackRow(`s|${k}|offset`, { ...SPEC.whole, range: [0.3, 0.7], ref: 0.5, color: '#c98bd6', snap: 0.005 }, () => sy.offset, (p) => { sy.offset = p; }, 'Cycle split <i>50 % = even steps</i>', { type: 'sym', id: k });
    }
  };
  // groups (weights multiply into every bone they hold)
  const drawGroup = (gid) => {
    const g = A.groups[gid]; if (!g) return;
    if (g.mirrorOf) return;   // the linked twin lives in its source's row
    const hr = mkRow('bone grp' + (isSelRow('group', gid) ? ' selected' : ''));
    Object.assign(hr, { kind: 'group', group: gid });
    hr.el.dataset.group = gid;
    hr.h.innerHTML = `<button type="button" class="mini" data-act="fold" aria-expanded="${!g.collapsed}" title="Show / hide tracks">${g.collapsed ? '▸' : '▾'}</button><span class="grptag">GRP</span><span class="name" title="Select (highlights its bones) · right-click for options"></span>${g.mirror ? '<span class="mirtag" title="Both sides: every edit applies to left and right">⇄ L+R</span>' : ''}<button type="button" class="mini" data-act="del" title="Remove this group from the timeline">×</button>`;
    hr.h.querySelector('.name').textContent = g.mirror ? sideless(groupLabel(gid)) : groupLabel(gid);
    hr.h.querySelector('[data-act="fold"]').onclick = () => { g.collapsed = !g.collapsed; rebuildRows(); save(); };
    hr.h.querySelector('[data-act="del"]').onclick = () => removeGroup(gid);
    addBypass(hr, g, () => A.groups[mirrorGroupId(gid)]);
    hr.h.querySelector('.name').onclick = () => selectGroup(gid);
    hr.h.oncontextmenu = (ev) => { ev.preventDefault(); if (rightDouble('g|' + gid)) removeGroup(gid); else openGroupMenu(ev, gid); };
    hr.lane.innerHTML = '<div class="summary"></div>'; hr.lane.firstChild.textContent = groupSummary(gid);
    tracksEl.append(hr.el); rows.push(hr);
    if (g.collapsed) return;
    const own = { type: 'group', id: gid };
    if (g.show.weight) addTrackRow(`g|${gid}|weight`, { ...SPEC.whole, color: COL.group }, () => g.weight, (p) => { g.weight = p; }, 'Group weight <i>× its bones</i>', own);
    if (g.show.timing) addTrackRow(`g|${gid}|timing`, SPEC.timing, () => g.timing, (p) => { g.timing = p; }, 'Group timing <i>phase %</i>', own);
  };
  // FK bones
  const drawBone = (name) => {
    const ba = A.bones[name]; if (!ba) return;
    if (ba.mirrorOf) return;
    const hr = mkRow('bone' + (isSelRow('bone', name) ? ' selected' : ''));
    Object.assign(hr, { kind: 'bone', bone: name });
    hr.el.dataset.bone = name;
    const mtag = ba.mirror ? ' <span class="mirtag" title="Both sides: every edit applies to left and right">⇄ L+R</span>' : '';
    const chain = mtag + (ba.withChildren ? ' <span class="mini tag" title="Multiplies into every descendant bone">⛓ children</span>' : '');
    hr.h.innerHTML = `<button type="button" class="mini" data-act="fold" aria-expanded="${!ba.collapsed}" title="Show / hide tracks">${ba.collapsed ? '▸' : '▾'}</button><span class="name" title="Select in the viewport · right-click for options"></span>${chain}<button type="button" class="mini" data-act="del" title="Remove this bone from the timeline">×</button>`;
    hr.h.querySelector('.name').textContent = ba.mirror ? sideless(name) : name;
    hr.h.querySelector('[data-act="fold"]').onclick = () => { ba.collapsed = !ba.collapsed; rebuildRows(); save(); };
    hr.h.querySelector('[data-act="del"]').onclick = () => removeBone(name);
    addBypass(hr, ba, () => A.bones[mirrorName(name)]);
    hr.h.querySelector('.name').onclick = () => selectBone(name);
    hr.h.oncontextmenu = (e) => { e.preventDefault(); if (rightDouble('b|' + name)) removeBone(name); else openBoneMenu(e, name); };
    hr.lane.innerHTML = '<div class="summary"></div>'; hr.lane.firstChild.textContent = boneSummary(ba);
    tracksEl.append(hr.el); rows.push(hr);
    if (ba.collapsed) return;
    const lab = axisInfo[name] || {}, sw = ba.show || { whole: true }, own = { type: 'bone', name };
    const k = (s) => `b|${name}|${s}`;
    if (sw.whole) addTrackRow(k('whole'), SPEC.whole, () => ba.whole, (p) => { ba.whole = p; }, 'Whole bone <i>weight</i>', own);
    for (const a of AXES) if (sw['w' + a]) addTrackRow(k('w' + a), SPEC.w, () => ba.w[a], (p) => { ba.w[a] = p; }, `<b class="axl" style="color:${AXIS_COL[a]}">${a.toUpperCase()}</b> weight <i>${lab[a] ? lab[a].short : ''}</i>`, { ...own, axis: a });
    for (const a of AXES) if (sw['a' + a]) addTrackRow(k('a' + a), SPEC.a, () => ba.a[a], (p) => { ba.a[a] = p; }, `<b class="axl" style="color:${AXIS_COL[a]}">${a.toUpperCase()}</b> adjust <i>${lab[a] ? lab[a].short : ''}</i>`, { ...own, axis: a });
    if (sw.timing) addTrackRow(k('timing'), SPEC.timing, () => ba.timing, (p) => { ba.timing = p; }, 'Timing offset <i>phase %</i>', own);
  };
  // IK effectors: the built-in ones, then the custom controllers in their own section
  const drawEff = (id) => {
    const e = A.ik[id], d = EFF_BY_ID[id]; if (!e || !d) return;
    if (e.mirrorOf) return;
    const hr = mkRow('bone eff' + (isSelRow('eff', id) ? ' selected' : ''));
    Object.assign(hr, { kind: 'eff', eff: id });
    hr.el.dataset.eff = id;
    hr.h.innerHTML = `<button type="button" class="mini" data-act="fold" aria-expanded="${!e.collapsed}" title="Show / hide tracks">${e.collapsed ? '▸' : '▾'}</button><span class="iktag${d.custom ? ' cust' : ''}">${d.custom ? 'IK CUST' : d.kind === 'igroup' ? 'IK GRP' : 'IK'}</span><span class="name" title="Select in the viewport · right-click for options"></span>${e.mirror ? '<span class="mirtag" title="Both sides: every edit applies to left and right">⇄ L+R</span>' : ''}${d.custom ? '<button type="button" class="mini" data-act="edit" title="Edit controller: name, members, pivot, tracks">✎</button>' : ''}<button type="button" class="mini" data-act="del" title="Remove this effector from the timeline">×</button>`;
    hr.h.querySelector('.name').textContent = e.mirror ? sideless(d.label) : d.label;
    hr.h.querySelector('[data-act="fold"]').onclick = () => { e.collapsed = !e.collapsed; rebuildRows(); save(); };
    hr.h.querySelector('[data-act="del"]').onclick = () => removeEff(id);
    addBypass(hr, e, () => A.ik[mirrorEffId(id)]);
    { const eb = hr.h.querySelector('[data-act="edit"]'); if (eb) eb.onclick = () => editController(id); }
    hr.h.querySelector('.name').onclick = () => selectEff(id);
    hr.h.oncontextmenu = (ev) => { ev.preventDefault(); if (rightDouble('e|' + id)) removeEff(id); else openEffMenu(ev, id); };
    hr.lane.innerHTML = '<div class="summary"></div>'; hr.lane.firstChild.textContent = effSummary(id);
    tracksEl.append(hr.el); rows.push(hr);
    if (e.collapsed) return;
    for (const k of d.tracks) {
      if (!e.show[k]) continue;
      const T = TRK[k], axl = T.axis ? `<b class="axl" style="color:${AXIS_COL[T.axis]}">${T.axis.toUpperCase()}</b> ` : '';
      const info = T.kind ? worldAxisInfo(T.kind)[T.axis].short : (T.hint || '');
      addTrackRow(`e|${id}|${k}`, effSpec(k), () => e.tr[k], (p) => { e.tr[k] = p; }, `${axl}${T.kind ? (T.kind === 'p' ? 'Move' : 'Rotate') : T.label} <i>${info}</i>`, { type: 'eff', id, k });
    }
  };
  // every bone / group / IK / symmetrize block in the order it was added (new ones at the end; drag a block's
  // ⋮⋮ grip to move it); A.rowOrder keeps that order, older projects start from the type order
  const keyOk = (key) => { const [kind, ...r] = key.split(':'), id = r.join(':'); return kind === 'frc' ? !!(A.forcers && A.forcers.some((f) => f.id === id)) : kind === 'std' ? !!A.steady : kind === 'sym' ? !!A.sym[id] : kind === 'grp' ? !!A.groups[id] && !A.groups[id].mirrorOf : kind === 'bone' ? !!A.bones[id] && !A.bones[id].mirrorOf : kind === 'eff' ? !!A.ik[id] && !A.ik[id].mirrorOf && !!EFF_BY_ID[id] : false; };
  const all = [...(A.forcers || []).map((f) => 'frc:' + f.id), ...(A.steady ? ['std:main'] : []), ...A.symOrder.map((k) => 'sym:' + k), ...A.groupOrder.map((k) => 'grp:' + k), ...A.order.map((k) => 'bone:' + k), ...A.ikOrder.map((k) => 'eff:' + k)].filter(keyOk);
  const seen = new Set(); A.rowOrder = (A.rowOrder || []).filter((k) => keyOk(k) && !seen.has(k) && seen.add(k));
  for (const k of all) if (!seen.has(k)) { seen.add(k); A.rowOrder.push(k); }
  for (const key of A.rowOrder) {
    const [kind, ...r] = key.split(':'), id = r.join(':'), n0 = rows.length;
    if (kind === 'frc') drawForcerBlock(id); else if (kind === 'std') drawSteady(); else if (kind === 'sym') drawSym(id); else if (kind === 'grp') drawGroup(id); else if (kind === 'bone') drawBone(id); else drawEff(id);
    const blk = rows.slice(n0); if (!blk.length) continue;
    blk[0].el.dataset.block = key; addBlockGrip(blk[0], key);
    for (const sub of blk.slice(1)) sub.el.classList.add('sub');
    blk[blk.length - 1].el.classList.add('blockend');
  }
  if (!rows.length) {
    const e = document.createElement('div'); e.className = 'empty';
    e.textContent = 'Nothing on the timeline yet. Add a group, bone or IK effector on the left; the "i" button explains how the timeline works.';
    tracksEl.append(e);
  }
  if (window.__slRebuildTree) window.__slRebuildTree();
  layoutLanes();
}
// ---------------------------------------------------------------- "+" menu: the optional master tracks
$('btnAddMaster').onclick = (e) => {
  const b = e.currentTarget.getBoundingClientRect(), tog = (k) => () => { A.showMaster[k] = !A.showMaster[k]; rebuildRows(); save(); };
  openMenu(b.left, b.bottom + 4, [
    { label: 'Run controls: step length, cycle speed, spine lean, moving speed', checked: !!A.showMaster.run, action: tog('run') },
    { sep: true },
    { label: 'Playback speed (cadence)', checked: !!A.showMaster.speed, action: tog('speed') },
    { label: 'Travel trim (old moving speed ×)', checked: !!A.showMaster.move, action: tog('move') },
    { label: 'Cycle speed', checked: !!A.showMaster.cycle, action: tog('cycle') },
    { label: 'Stride length', checked: !!A.showMaster.stride, action: tog('stride') },
    { label: 'Step length also moves knees, pelvis turn and arm swing', checked: A.strideArms !== false, action: () => { pushUndo(); A.strideArms = A.strideArms === false; editVersion++; trailDirty = true; save(); } },
    { label: 'Foot on ground (braking)', checked: !!A.showMaster.gnd, action: tog('gnd') },
    { label: 'Moving forcer (moves with the runner)', action: () => addForcer('moving') },
    { label: 'Fixed forcer (stays put in the world)', action: () => addForcer('fixed') },
    { label: 'Steadiness (centre bones)', checked: !!A.steady, action: () => (A.steady ? confirmDelete('Remove Steadiness and its tracks?', () => { pushUndo(); removeSteadyNow(); }) : addSteady()) },
    { label: 'Templates: save / open…', action: openTplLib },
    { label: 'Template: Sprint → Jog (decelerate)…', action: openTemplate },
    { label: 'Template: Run → Jog (4 controls)', action: () => toast(applyRunJog4()) },
    { label: 'Template: Sprint → Jog 2 m/s, braking (bars 3–7)', action: () => toast(applyDecelTemplate()) },
    { label: 'Template: Sprint → Decel 2.1 m/s, braking run (bars 3–7)', action: () => toast(applyDecelTemplate(DECEL_REF)) },
  ]);
};
$('btnHelp').onclick = () => { $('helpDlg').hidden = false; $('helpClose').focus(); };
$('helpClose').onclick = () => { $('helpDlg').hidden = true; };
$('helpDlg').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('helpDlg').hidden = true; });
$('realtimeCb').onchange = () => { S.realtime = $('realtimeCb').checked; gridCache = null; setView(0, dispDur()); trailDirty = true; save(); };

// ---------------------------------------------------------------- horizontal zoom / scroll
function setView(a, b) {
  const minSpan = Math.min(S.dur, 0.05);
  const D = dispDur(); let span = clamp(b - a, Math.min(D, minSpan), D); a = clamp(a, 0, D - span);
  S.viewAll = span >= D - 1e-6;
  S.v0 = a; S.v1 = a + span;
  layoutLanes(); updateHScroll();
}
function updateHScroll() {
  const D = dispDur(), th = $('hthumb'); th.style.left = (S.v0 / D) * 100 + '%'; th.style.width = Math.max(0.5, (vSpan() / D) * 100) + '%';
}
{
  const bar = $('hscroll'); let hd = null;
  bar.addEventListener('pointerdown', (e) => {
    e.preventDefault(); bar.setPointerCapture(e.pointerId);
    const r = bar.getBoundingClientRect(), mode = e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : e.target.id === 'hthumb' ? 'pan' : 'jump';
    if (mode === 'jump') { const c = ((e.clientX - r.left) / r.width) * dispDur(); setView(c - vSpan() / 2, c + vSpan() / 2); }
    hd = { mode: mode === 'jump' ? 'pan' : mode, x0: e.clientX, a: S.v0, b: S.v1, w: r.width };
  });
  bar.addEventListener('pointermove', (e) => {
    if (!hd) return;
    const dt = ((e.clientX - hd.x0) / hd.w) * dispDur();
    if (hd.mode === 'pan') setView(hd.a + dt, hd.b + dt);
    else if (hd.mode === 'l') setView(Math.min(hd.a + dt, hd.b - 0.05), hd.b);
    else setView(hd.a, Math.max(hd.b + dt, hd.a + 0.05));
  });
  bar.addEventListener('pointerup', () => { hd = null; });
  $('btnFit').onclick = () => setView(0, dispDur());
  // Ctrl / ⌘ + wheel: time zoom around the cursor · Shift + wheel: scroll
  document.querySelector('.tl').addEventListener('wheel', (e) => {
    if (e.altKey || !(e.ctrlKey || e.metaKey || e.shiftKey)) return;
    e.preventDefault();
    const rb = ruler.getBoundingClientRect(), f = clamp((e.clientX - rb.left) / timeAreaCss(), 0, 1), c = S.v0 + f * vSpan();
    if (e.shiftKey && !(e.ctrlKey || e.metaKey)) { const d = (e.deltaY || e.deltaX) / 600 * vSpan(); setView(S.v0 + d, S.v1 + d); return; }
    const k = Math.exp(clamp(e.deltaY, -200, 200) * 0.003), span = vSpan() * k;
    setView(c - f * span, c - f * span + span);
  }, { passive: false });
}
function followPlayhead() {   // while playing, keep the playhead in view
  if (vSpan() >= dispDur() - 1e-6) return;
  const d = dispOf(S.t);
  if (d > S.v1 || d < S.v0) { const span = vSpan(); setView(d - span * 0.1, d - span * 0.1 + span); }
}

function boneSummary(ba) {
  const parts = [];
  if (!isFlat(ba.whole, 1)) parts.push('whole');
  for (const a of AXES) { if (!isFlat(ba.w[a], 1)) parts.push(a.toUpperCase() + ' weight'); if (!isFlat(ba.a[a], 0)) parts.push(a.toUpperCase() + ' adjust'); }
  if (!isFlat(ba.timing, 0)) parts.push('timing');
  if (ba.withChildren) parts.push('children ×');
  const gs = boneGroupsLabel(ba);
  return (parts.length ? 'Automated: ' + parts.join(', ') : 'No automation yet (clip as it is)') + gs;
}
function boneGroupsLabel(ba) { const name = Object.keys(A.bones).find((n) => A.bones[n] === ba); const gs = name ? groupsOfBone(name) : []; return gs.length ? ' · × ' + gs.map(groupLabel).join(' × ') : ''; }
function groupSummary(gid) {
  const g = A.groups[gid], n = groupMembers(gid).size, parts = [];
  if (!isFlat(g.weight, 1)) parts.push('weight'); if (!isFlat(g.timing, 0)) parts.push('timing');
  const inside = A.groupOrder.filter((o) => o !== gid && [...groupMembers(o)].every((b) => groupMembers(gid).has(b))).map(groupLabel);
  return `${n} bones · ` + (parts.length ? 'automated: ' + parts.join(', ') : 'no automation yet') + (inside.length ? ' · contains ' + inside.join(', ') : '');
}
function groupsOfBone(name) { return A.groupOrder.filter((gid) => groupMembers(gid).has(name)); }
function effSummary(id) {
  const e = A.ik[id], d = EFF_BY_ID[id];
  const parts = d.tracks.filter((k) => !isFlat(e.tr[k], TRK[k].ref)).map((k) => TRK[k].kind ? `${TRK[k].kind === 'p' ? 'move' : 'rotate'} ${TRK[k].axis.toUpperCase()}` : TRK[k].label.toLowerCase());
  return parts.length ? 'IK: ' + parts.join(', ') : 'IK on, no offsets yet (follows the clip)';
}
function refreshSummary(r) {
  if (!r.owner) return;
  const o = r.owner;
  if (o.type === 'sym') return;
  if (o.type === 'forcer') { for (const x of rows) if (x.kind === 'forcer') forcerSummary(x); return; }
  if (o.type === 'steady') { const hr = rows.find((x) => x.kind === 'steady'); if (hr && hr.lane.firstChild) hr.lane.firstChild.textContent = steadySummary(); return; }
  const hr = o.type === 'bone' ? rows.find((x) => x.kind === 'bone' && x.bone === o.name) : o.type === 'group' ? rows.find((x) => x.kind === 'group' && x.group === o.id) : rows.find((x) => x.kind === 'eff' && x.eff === o.id);
  if (hr && hr.lane.firstChild) hr.lane.firstChild.textContent = o.type === 'bone' ? boneSummary(A.bones[o.name]) : o.type === 'group' ? groupSummary(o.id) : effSummary(o.id);
}
function lane(r) {
  const cv = document.createElement('canvas'); r.cv = cv; r.lane.append(cv);
  cv.addEventListener('pointerdown', (e) => onLaneDown(e, r));
  cv.addEventListener('pointermove', (e) => onLaneHover(e, r));
  cv.addEventListener('pointerleave', () => { if (!drag && !boxSel) tip(null); });
  cv.addEventListener('contextmenu', (e) => {   // right-click: menu · right double-click: delete the point / the track
    e.preventDefault(); const hit = hitPoint(r, e);
    if (rightDouble(r.key + (hit != null ? '#' + hit : ''))) { if (hit != null) deletePoint(r, hit); else deleteTrack(r); return; }
    if (hit != null) openMenu(e.clientX, e.clientY, [{ label: 'Delete point (or right double-click)', action: () => deletePoint(r, hit) }, { label: 'Type its value…', action: () => openNumEdit(r, hit, e) }, { sep: true }, ...curveItems(r, hit)]);
    else openLaneMenu(e, r);
  });
  cv.addEventListener('dblclick', (e) => { const hit = hitPoint(r, e); if (hit != null) openNumEdit(r, hit, e); });
  cv.addEventListener('wheel', (e) => {
    if (!e.altKey) return;   // Alt + wheel: value zoom (Ctrl / Shift + wheel: time zoom / scroll)
    e.preventDefault();
    const [, py] = evXY(r, e), v = vOfRaw(r, py), [lo, hi] = viewOf(r), k = Math.exp(clamp(e.deltaY, -200, 200) * 0.0025);
    setZoom(r, [v - (v - lo) * k, v + (hi - v) * k]);
  }, { passive: false });
}
function setZoom(r, z) {
  const [lo, hi] = r.range, span = hi - lo;
  let [a, b] = z;
  if (b - a < span * 0.002) { const m = (a + b) / 2; a = m - span * 0.001; b = m + span * 0.001; }
  if (b - a >= span * 0.999) { delete A.zoom[r.key]; } else {
    if (a < lo) { b += lo - a; a = lo; } if (b > hi) { a -= b - hi; b = hi; }
    A.zoom[r.key] = [Math.max(lo, a), Math.min(hi, b)];
  }
  drawLane(r); save();
}
function zoomToFit(r) {
  const pts = r.get(); let lo = Math.min(r.ref, ...pts.map((p) => p.v)), hi = Math.max(r.ref, ...pts.map((p) => p.v));
  const pad = Math.max((hi - lo) * 0.15, (r.range[1] - r.range[0]) * 0.01); setZoom(r, [lo - pad, hi + pad]);
}
function layoutLane(r) {
  if (!r.cv) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = r.lane.clientWidth || 300, h = Math.max(10, rowHeight(r) - 1);
  r.cv.width = Math.round(w * dpr); r.cv.height = Math.round(h * dpr); r.cv.style.width = w + 'px'; r.cv.style.height = h + 'px';
  drawLane(r);
}
function layoutLanes() { for (const r of rows) layoutLane(r); drawRuler(); placePlayhead(); }
{ let lastSb = -1; new ResizeObserver(() => { const sb = tracksEl.offsetWidth - tracksEl.clientWidth; if (sb !== lastSb) { lastSb = sb; if (A) layoutLanes(); } }).observe(tracksEl); }
// geometry
const viewOf = (r) => A.zoom[r.key] || r.range;
const dprOf = (r) => r.cv.width / Math.max(1, r.cv.clientWidth || r.lane.clientWidth || 1);
// the visible time window (horizontal zoom / scroll): S.v0 … S.v1 seconds
const vSpan = () => Math.max(1e-3, S.v1 - S.v0);
// Display axis. Realtime bars on: real seconds. Off: "bar space" — the axis follows the bars, so every bar is the
// same width however playback / cycle speed change the timing, and feet and curves stay lined up with the bars.
// A display coordinate d is the nominal time (playback speed only) at which the clip reaches the same clip time.
// While a timing point (playback / moving / cycle speed, foot on ground) is dragged the view is frozen: the bars,
// grid and ruler keep their place and the character previews the new timing; the layout updates on release.
let viewFreeze = null;
const TIMING_KEYS = new Set(['speed', 'move', 'cyc', 'gnd', 'stride', 'brake', 'r|px', 'r|py', 'r|pz', 'r|fx', 'r|fy', 'r|fz', 'r|force', 'r|spread']);
// Playback speed and cycle speed are what turn clip time into real seconds — a "bar" is a fixed
// point in clip time, not in real seconds. Editing either one moves where the bars land in real time; every other
// point, on every other track, is re-timed here so it lands on the same clip time as before — it stays on its bar.
const BAR_DRIVERS = new Set(['speed', 'cyc', 'brake', 'r|px', 'r|py', 'r|pz', 'r|fx', 'r|fy', 'r|fz', 'r|force', 'r|spread']);
function allPointArrays() { return allPointArraysOf(A); }
function allPointArraysOf(a) {   // every point array of an automation object, in one fixed order
  const out = [a.speed, a.move, a.cyc, a.gnd, a.stride];
  for (const n of a.order) { const ba = a.bones[n]; out.push(ba.whole, ba.timing, ba.w.x, ba.w.y, ba.w.z, ba.a.x, ba.a.y, ba.a.z); }
  for (const gid of a.groupOrder) { const g = a.groups[gid]; out.push(g.weight, g.timing); }
  for (const id of a.ikOrder) { const e = a.ik[id]; for (const k in e.tr) out.push(e.tr[k]); }
  for (const k of a.symOrder) { const sy = a.sym[k]; out.push(sy.weight, sy.offset); }
  if (a.steady && a.steady.tr) for (const k of STD_KEYS) out.push(a.steady.tr[k]);
  out.push(a.lean, a.hipRot, a.brake);
  for (const f of a.forcers || []) for (const k of RES_KEYS) out.push(f[k]);
  return out.filter(Boolean);
}
// the point being dragged on a playback / cycle speed track, and the bar (clip time) under the cursor
let pinDrag = null;
// clip time reached at real time t1, carrying on from clip time c0 at t0, straight from the current speed tracks
// (the LUT's own sum, without building the table)
function clipTimeFrom(t0, c0, t1) {
  if (t1 <= t0) return c0;
  const n = Math.max(1, Math.ceil((t1 - t0) * 480)), dt = (t1 - t0) / n, k = cycleRate();
  let c = c0;
  for (let i = 0; i < n; i++) {
    const a = t0 + i * dt, play = 0.5 * (evalPts(A.speed, a) + evalPts(A.speed, a + dt)) * k;
    const cyc = Math.max(5, evalPts(A.cyc, a + dt / 2));
    c += play * (cyc / 100) * brakeRate(a + dt / 2, c) * resistAt(a + dt / 2).cadK * dt;
  }
  return c;
}
// each point's bar (clip time) under the timing as it is now; a point exactly at the track's end is its end anchor
// (every track's last point sits at S.dur), not "placed on a bar", so it stays at the end (null)
function snapClipTimes(arrs) { return arrs.map((pts) => pts.map((p) => (pinDrag && p === pinDrag.p ? pinDrag.ct : p.t >= S.dur - 1e-6 ? null : clipTime(p.t)))); }
function pinPointsToBar() {
  if (!cur || !S.speedLUT) { rebuildSpeedLUT(); return; }
  const arrs = allPointArrays();
  placeByClipTime(arrs, snapClipTimes(arrs), S.dur);
}
// put every point at the real time where the (new) timing reaches its bar; D = the timeline length to use
function placeByClipTime(arrs, snap, D) {
  if (Math.abs(D - S.dur) > 1e-9) { S.dur = A.dur = +D; S.t = Math.min(S.t, S.dur); }
  arrs.forEach((pts, i) => pts.forEach((p, j) => { if (snap[i][j] == null) p.t = S.dur; }));   // end anchors ride to the end
  // the speed tracks' own points shape the timing that places them: each is solved (bisection) for the real time
  // at which the timing reaches its bar, in bar order; a couple of passes settle the two tracks against each other
  const drv = [];
  arrs.forEach((pts, i) => { if (pts === A.speed || pts === A.cyc) pts.forEach((p, j) => { if (snap[i][j] != null && snap[i][j] > 1e-9) drv.push({ p, ct: snap[i][j] }); }); });
  drv.sort((a, b) => a.ct - b.ct);
  // before a point's own track neighbour nothing depends on where the point goes: sum up to there once
  const both = A.speed.length > 2 && A.cyc.length > 2;
  for (let pass = 0; pass < (both ? 3 : 1); pass++) {
    let lo0 = 0;
    for (const d of drv) {
      const own = A.speed.includes(d.p) ? A.speed : A.cyc, prev = own[own.indexOf(d.p) - 1], ts = prev ? Math.min(prev.t, lo0) : 0;
      const cs = clipTimeFrom(0, 0, ts), at = (t) => { d.p.t = t; return clipTimeFrom(ts, cs, t); };
      let lo = lo0, hi = S.dur;
      if (at(hi) <= d.ct) { lo0 = hi; continue; }
      // bracket from the point's current place first: a small edit stays a short search
      for (let it = 0; it < 24 && hi - lo > 1e-5; it++) { const mid = (lo + hi) / 2; if (at(mid) < d.ct) lo = mid; else hi = mid; }
      d.p.t = (lo + hi) / 2; lo0 = d.p.t;
    }
  }
  for (const pts of [A.speed, A.cyc]) pts.sort((a, b) => a.t - b.t);
  rebuildSpeedLUT();
  arrs.forEach((pts, i) => {
    if (pts === A.speed || pts === A.cyc) { pts.forEach((p, j) => { if (snap[i][j] == null) p.t = S.dur; }); return; }
    pts.forEach((p, j) => { const c = snap[i][j]; p.t = c == null ? S.dur : clamp(timeOfClipTime(c), 0, S.dur); });
    pts.sort((a, b) => a.t - b.t);
  });
}
// ---- Cycles mode: the cycle count is fixed. Any timing change (playback / cycle speed, template…) keeps
// every point on its bar and moves the END of the timeline instead, so no bar is ever added or dropped by itself.
// Bars are only added with "+ Bars" / the ruler menu, or by typing a new count.
function totalClipTime() { const l = S.speedLUT; return l && l.length ? l[l.length - 1] : 0; }
function fitToClipTime(target, arrs, snap) {   // length so the timeline ends exactly at clip time `target` → true when reached
  // total clip time grows with the length; moving the end also stretches every track's last segment, so a plain
  // Newton step can overshoot: bracket the answer, then regula falsi (Illinois)
  const tol = 1e-5 * Math.max(cur.dur, 0.1), f = (D) => { placeByClipTime(arrs, snap, D); return totalClipTime() - target; };
  let D0 = S.dur, f0 = f(D0);
  if (Math.abs(f0) < tol) return true;
  const lut = S.speedLUT, n = lut.length, m = Math.min(96, n - 1), r = Math.max(1e-4, (lut[n - 1] - lut[n - 1 - m]) / (S.dur * m / (n - 1)));
  let D1 = clamp(D0 - f0 / r, 0.2, 120); if (Math.abs(D1 - D0) < 1e-9) D1 = clamp(D0 * (f0 > 0 ? 0.9 : 1.1), 0.2, 120);
  let f1 = f(D1);
  for (let k = 0; k < 30 && Math.sign(f0) === Math.sign(f1); k++) {   // walk on until the target is between the two
    if (Math.abs(f1) < tol) return true;
    const step = D1 - D0; D0 = D1; f0 = f1; D1 = clamp(D1 + step * 2, 0.2, 120);
    if (Math.abs(D1 - D0) < 1e-9) break;
    f1 = f(D1);
  }
  if (Math.abs(f1) < tol) return true;
  if (Math.sign(f0) === Math.sign(f1)) return false;   // cannot be reached inside 0.2…120 s
  let lo = D0, flo = f0, hi = D1, fhi = f1;
  for (let it = 0; it < 60; it++) {
    const D = hi - (fhi * (hi - lo)) / (fhi - flo), fd = f(D);
    if (Math.abs(fd) < tol || Math.abs(hi - lo) < 1e-9) return true;
    if (Math.sign(fd) === Math.sign(fhi)) { hi = D; fhi = fd; flo /= 2; } else { lo = D; flo = fd; fhi /= 2; }
  }
  return Math.abs(totalClipTime() - target) < 1e-3 * cur.dur;
}
let lockBusy = false;
const cycTxt = (c) => (Math.abs(c - Math.round(c)) < 1e-6 ? String(Math.round(c)) : c.toFixed(2));
function lockCycles(quiet) {   // → false when the count cannot be held (the caller undoes the edit)
  if (lockBusy || !cur || !(cur.dur > 0) || !(A && A.cycles > 0) || !S.speedLUT) return true;
  const target = A.cycles * cur.dur;
  if (Math.abs(totalClipTime() - target) < 1e-6 * cur.dur) return true;
  lockBusy = true; let ok = true;
  try {
    const arrs = allPointArrays(); ok = fitToClipTime(target, arrs, snapClipTimes(arrs));
    if (ok) rebuildSpeedLUT();   // (the exact end correction is applied in rebuildSpeedLUT)
    if (!ok && !quiet) toast(`${cycTxt(A.cycles)} bars do not fit at these speeds (the timeline would pass 120 s).`);
  } finally { lockBusy = false; }
  moveEndCache = null; editVersion++; trailDirty = true; gridCache = null; syncLenInputs(); layoutLanes();
  return ok;
}
// a timing edit that cannot keep the bar count is taken back: the count never gives way
function holdCountOrUndo(what) {
  const ok = lockCycles(true);
  if (ok === false) { undo(); redoStack.pop(); toast(`${cycTxt(A.cycles)} bars do not fit in 120 s at that ${what || 'speed'}: the change was undone.`); }
  return ok;
}
// every track starts at 0 and ends at the end line (those two points are fixed in time and cannot be deleted)
function ensureEnds() {
  if (!A) return;
  for (const pts of allPointArrays()) {
    if (!pts || !pts.length) continue;
    pts.sort((a, b) => a.t - b.t);
    if (pts[0].t > 1e-6) pts.unshift({ t: 0, v: pts[0].v, k: 0 }); else pts[0].t = 0;
    const L = pts[pts.length - 1];
    if (L.t < S.dur - 1e-6) pts.push({ t: S.dur, v: L.v, k: 0 }); else L.t = S.dur;
  }
}
const isEndPt = (pts, i) => i === 0 || i === pts.length - 1;
// the central check: whatever rebuilt the timing, if the count drifted it is put back (right after this edit)
let lockQueued = false;
function queueLock() {
  if (lockQueued || lockBusy) return; lockQueued = true;
  queueMicrotask(() => { lockQueued = false; if (viewFreeze || drag) return; if (cur && A && A.cycles > 0 && Math.abs(totalClipTime() - A.cycles * cur.dur) > 1e-6 * cur.dur) lockCycles(); });
}
// a track whose last segment is not flat keeps its shape: its end value gets its own point at the old end first
function holdTails(arrs, snap, ctEnd) {
  arrs.forEach((pts, i) => {
    const n = pts.length; if (n < 2) return;
    const last = pts[n - 1], prev = pts[n - 2];
    if (snap[i][n - 1] != null || (Math.abs(prev.v - last.v) < 1e-9 && Math.abs(prev.k) < 1e-6)) return;
    pts.splice(n - 1, 0, { t: last.t, v: last.v, k: 0 }); snap[i].splice(n - 1, 0, Math.max(0, ctEnd - 1e-6));
  });
}
// fewer cycles typed: points past the new end go, each track ends on the value it had there
function trimToClipTime(arrs, snap, target) {
  const tEnd = timeOfClipTime(target);
  arrs.forEach((pts, i) => {
    const vEnd = evalPts(pts, tEnd);
    for (let j = pts.length - 1; j >= 0; j--) if (snap[i][j] != null && snap[i][j] > target - 1e-6) { pts.splice(j, 1); snap[i].splice(j, 1); }
    const last = pts[pts.length - 1]; if (last && snap[i][pts.length - 1] == null) last.v = vEnd;
  });
}
function finishRetime(msg) {
  selPts = new Set(); moveEndCache = null; editVersion++; trailDirty = true; gridCache = null;
  S.viewAll = true; rebuildSpeedLUT(); syncLenInputs(); layoutLanes(); save();
  if (msg) toast(msg);
}
// the count typed into the Cycles field: more = bars added at the end, fewer = bars cut from the end
function setCycles(c) {
  if (!cur || !(cur.dur > 0) || !S.speedLUT) return;
  c = clamp(+c || A.cycles || 1, 0.25, 400);
  const target = c * cur.dur, now = totalClipTime();
  if (Math.abs(target - now) < 1e-6) { A.cycles = c; syncLenInputs(); save(); return; }
  pushUndo();
  const arrs = allPointArrays(), snap = snapClipTimes(arrs);
  if (target < now) trimToClipTime(arrs, snap, target); else holdTails(arrs, snap, now);
  const was = A.cycles; A.cycles = c;
  lockBusy = true; let ok = true;
  try { ok = fitToClipTime(target, arrs, snap); } finally { lockBusy = false; }
  if (!ok) { A.cycles = was; undo(); redoStack.pop(); toast(`${cycTxt(c)} bars do not fit in 120 s at these speeds: kept ${cycTxt(was)}.`); syncLenInputs(); return; }
  finishRetime(null);
}
// + Bars: n whole bars at the end, or right after bar boundary ctB (clip time); later points move n bars on,
// the new bars hold the value every track had at that spot
function addBars(n, ctB) {
  if (!cur || !(cur.dur > 0) || !S.speedLUT) return;
  n = Math.round(clamp(+n || 1, 1, 200));
  pushUndo();
  const arrs = allPointArrays(), snap = snapClipTimes(arrs), sh = n * cur.dur, total = totalClipTime();
  const atEnd = ctB == null || ctB >= total - 1e-6;
  if (atEnd) holdTails(arrs, snap, total);
  else {
    const tB = timeOfClipTime(ctB);
    // every point after the insert moves n bars on; no point is added: the segment across the new bars simply
    // stretches (a 100 at bar 5 and a 150 at bar 7 become 100 at bar 5 and 150 at bar 9)
    arrs.forEach((pts, i) => { const sn = snap[i]; for (let j = 0; j < sn.length; j++) if (sn[j] != null && sn[j] > ctB + 1e-6) sn[j] += sh; });
  }
  const target = total + sh, was = A.cycles;
  A.cycles = +((A.cycles || total / cur.dur) + n).toFixed(4);
  lockBusy = true; let ok = true;
  try { ok = fitToClipTime(target, arrs, snap); } finally { lockBusy = false; }
  if (!ok) { A.cycles = was; undo(); redoStack.pop(); toast(`${n} more bar${n > 1 ? 's do' : ' does'} not fit in 120 s at these speeds.`); syncLenInputs(); return; }
  const where = atEnd ? 'at the end' : `after bar ${Math.round(ctB / cur.dur)}`;
  finishRetime(`Added ${n} bar${n > 1 ? 's' : ''} ${where}: ${cycTxt(A.cycles)} bars.`);
}
function openBarsDlg(ctB) {
  const dlg = $('barsDlg'); dlg.hidden = false;
  const k = cur && cur.dur > 0 ? Math.floor(clipTime(S.t) / cur.dur + 1e-6) + 1 : 1;
  $('barsWhere').options[1].textContent = `After bar ${k} (the playhead's bar)`;
  if (ctB != null) { $('barsWhere').value = 'at'; $('barsWhere').options[2].textContent = `After bar ${Math.round(ctB / cur.dur)} (where you clicked)`; $('barsWhere').options[2].hidden = false; dlg.dataset.ct = ctB; }
  else { $('barsWhere').options[2].hidden = true; if ($('barsWhere').value === 'at') $('barsWhere').value = 'end'; delete dlg.dataset.ct; }
  $('barsN').focus(); $('barsN').select();
}
$('btnAddBars').onclick = () => openBarsDlg(null);
$('barsCancel').onclick = () => { $('barsDlg').hidden = true; };
$('barsOk').onclick = () => {
  const dlg = $('barsDlg'), w = $('barsWhere').value, n = +$('barsN').value || 1; dlg.hidden = true;
  const k = Math.floor(clipTime(S.t) / cur.dur + 1e-6) + 1;
  addBars(n, w === 'end' ? null : w === 'after' ? k * cur.dur : +dlg.dataset.ct);
};
$('barsDlg').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('barsDlg').hidden = true; if (e.key === 'Enter') $('barsOk').click(); });
// ruler right-click: insert bars at the bar boundary right after the click
$('ruler').addEventListener('contextmenu', (e) => {
  e.preventDefault(); if (!cur || !(cur.dur > 0)) return;
  const b = $('ruler').getBoundingClientRect(), t = clamp(tOfDisp(S.v0 + clamp((e.clientX - b.left) / timeAreaCss(), 0, 1) * vSpan()), 0, S.dur);
  const k = Math.min(Math.floor(clipTime(t) / cur.dur + 1e-6) + 1, Math.ceil(totalClipTime() / cur.dur - 1e-6)), ctB = k * cur.dur, atEnd = ctB >= totalClipTime() - 1e-6;
  openMenu(e.clientX, e.clientY, [
    { label: atEnd ? 'Add 1 bar at the end' : `Insert 1 bar after bar ${k}`, action: () => addBars(1, atEnd ? null : ctB) },
    { label: atEnd ? 'Add bars at the end…' : `Insert bars after bar ${k}…`, action: () => openBarsDlg(atEnd ? null : ctB) },
    { sep: true },
    ...barClipItems(k),
  ]);
});
const vLut = () => (viewFreeze ? viewFreeze.lut : S.speedLUT), vNom = () => (viewFreeze ? viewFreeze.nom : S.speedLUTNom);
function freezeView() { if (!viewFreeze) viewFreeze = { lut: S.speedLUT.slice(), nom: S.speedLUTNom.slice(), grid: timeGrid(), bs: barSpace() }; }
function thawView() { if (!viewFreeze) return; viewFreeze = null; gridCache = null; rebuildSpeedLUT(); layoutLanes(); }
function barSpace() { if (viewFreeze) return viewFreeze.bs; return !S.realtime && S.speedLUTNom && S.speedLUT && Math.abs(S.speedLUT[S.speedLUT.length - 1] - S.speedLUTNom[S.speedLUTNom.length - 1]) > 1e-6; }
function lutAt(lut, t) { const f = clamp(t / S.dur, 0, 1) * (lut.length - 1), i = Math.min(Math.floor(f), lut.length - 2); return lerp(lut[i], lut[i + 1], f - i); }
function dispOf(t) { return barSpace() ? timeOfClipTime(lutAt(vLut(), t), vNom(), true) : t; }
function tOfDisp(d) { return barSpace() ? timeOfClipTime(lutAt(vNom(), d), vLut()) : d; }
function dispDur() { return barSpace() ? dispOf(S.dur) : S.dur; }
const xT = (t, w) => ((dispOf(t) - S.v0) / vSpan()) * w;
// The time area: the ruler and every lane map time onto the SAME width, the ruler's width less the tracks'
// scrollbar and a small gutter, so the end of the timeline (the line after the last bar) is always in view,
// left of the scrollbar, with a little room after it.
const TL_GUT = 16;
function timeAreaCss() { const rw = ruler.clientWidth || 300, sb = Math.max(0, tracksEl.offsetWidth - tracksEl.clientWidth); return Math.max(60, rw - sb - TL_GUT); }
const twOf = (r) => timeAreaCss() * dprOf(r);
function xOf(r, t) { return xT(t, twOf(r)); }
function tOf(r, x) { return clamp(tOfDisp(S.v0 + (x / twOf(r)) * vSpan()), 0, S.dur); }
function endLabel() { if (!cur || !(cur.dur > 0)) return 'end'; const nb = totalClipTime() / cur.dur; return Math.abs(nb - Math.round(nb)) < 0.01 ? `${Math.round(nb)} |` : 'end |'; }
function drawEndMark(x, w, h, xe, dpr, dark) {   // shade past the end, then the end line
  if (xe < w) { x.fillStyle = dark; x.fillRect(Math.max(0, xe), 0, w - Math.max(0, xe), h); }
  if (xe >= -2 && xe <= w + 2) { x.fillStyle = 'rgba(240,138,28,.9)'; x.fillRect(Math.round(xe) - Math.round(dpr / 2), 0, Math.max(1, Math.round(1.5 * dpr)), h); }
}
function yOf(r, v) { const [lo, hi] = viewOf(r), h = r.cv.height, p = PAD * dprOf(r); return p + (1 - (v - lo) / (hi - lo)) * (h - 2 * p); }
function vOfRaw(r, y) { const [lo, hi] = viewOf(r), h = r.cv.height, p = PAD * dprOf(r); return lo + (1 - (y - p) / (h - 2 * p)) * (hi - lo); }
function vOf(r, y) { return clamp(vOfRaw(r, y), r.range[0], r.range[1]); }
function niceStep(span, n) { const raw = span / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; }
function drawLane(r) {
  if (r.kind === 'result') return drawResult(r);
  const cv = r.cv, x = cv.getContext('2d'), w = cv.width, h = cv.height, dpr = dprOf(r), pts = r.get();
  x.clearRect(0, 0, w, h);
  x.fillStyle = rows.indexOf(r) % 2 ? '#232326' : '#28282c'; x.fillRect(0, 0, w, h);
  // time grid in the chosen unit (seconds, frames, clip cycles or foot steps)
  const G = timeGrid();
  if (S.unit === 'step') for (const sp of G.spans) { x.fillStyle = sp.S === 'L' ? 'rgba(201,139,214,.09)' : 'rgba(255,138,74,.08)'; const a = xOf(r, sp.t0), b = xOf(r, sp.t1); x.fillRect(a, 0, Math.max(1, b - a), h); x.fillStyle = sp.S === 'L' ? 'rgba(201,139,214,.55)' : 'rgba(255,138,74,.55)'; x.fillRect(a, sp.S === 'L' ? h - 3 * dpr : h - 6 * dpr, Math.max(1, b - a), 2 * dpr); }
  for (const g of visibleGrid(G, twOf(r), dpr)) { x.fillStyle = g.S ? (g.S === 'L' ? '#5a4460' : '#65452f') : g.level === 2 ? '#45454b' : g.level === 1 ? '#36363b' : '#2d2d31'; x.fillRect(Math.round(xOf(r, g.t)) + 0.5, 0, 1, h); }
  // foot landings: a line in the foot's colour
  for (const [t, Sd] of footMarks()) { const px = Math.round(xOf(r, t)); if (px < -2 || px > w + 2) continue; x.fillStyle = Sd === 'L' ? 'rgba(201,139,214,.75)' : 'rgba(255,138,74,.75)'; x.fillRect(px, 0, Math.max(1, Math.round(dpr)), h); }
  // value grid with labels once the track is tall enough
  const [lo, hi] = viewOf(r), cssH = h / dpr;
  if (cssH >= 56) {
    const st = niceStep((hi - lo) * r.scale, cssH / 26) / r.scale;
    x.font = `500 ${10 * dpr}px "IBM Plex Mono", monospace`; x.textBaseline = 'middle';
    for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) {
      const gy = Math.round(yOf(r, v)) + 0.5; x.fillStyle = '#333338'; x.fillRect(0, gy, w, 1);
      x.fillStyle = '#8a8a90'; x.fillText(+(v * r.scale).toFixed(4) + '', 4 * dpr, gy - 6 * dpr);
    }
  }
  const zoomed = !!A.zoom[r.key];
  // reference line (100 % / 0°)
  x.setLineDash([4 * dpr, 4 * dpr]); x.strokeStyle = '#46534c'; x.lineWidth = dpr; x.beginPath(); const ry = clamp(yOf(r, r.ref), -2, h + 2); x.moveTo(0, ry); x.lineTo(w, ry); x.stroke(); x.setLineDash([]);
  // curve + fill toward the reference
  x.save(); x.beginPath(); x.rect(0, 0, w, h); x.clip();
  x.beginPath();
  for (let px = 0; px <= w; px += 2) { const y = yOf(r, evalPts(pts, tOf(r, px))); px ? x.lineTo(px, y) : x.moveTo(px, y); }
  x.strokeStyle = r.color; x.lineWidth = 1.6 * dpr; x.stroke();
  x.lineTo(w, ry); x.lineTo(0, ry); x.closePath(); x.globalAlpha = 0.16; x.fillStyle = r.color; x.fill(); x.globalAlpha = 1;
  // tension rings, then points
  for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; if (b.t - a.t < 1e-3 || (Math.abs(b.v - a.v) < 1e-6 && Math.abs(a.k) < 1e-3)) continue; const tm = (a.t + b.t) / 2; x.beginPath(); x.arc(xOf(r, tm), yOf(r, evalPts(pts, tm)), 3 * dpr, 0, Math.PI * 2); x.strokeStyle = r.color; x.lineWidth = dpr; x.stroke(); }
  pts.forEach((p, i) => { x.beginPath(); const px = xOf(r, p.t), py = yOf(r, p.v); if (isEndPt(pts, i)) x.rect(px - 4 * dpr, py - 4 * dpr, 8 * dpr, 8 * dpr); else x.arc(px, py, 4 * dpr, 0, Math.PI * 2); x.fillStyle = '#111513'; x.fill(); x.strokeStyle = r.color; x.lineWidth = 1.6 * dpr; x.stroke(); });
  // selection ring + box-select rectangle
  if (r === selRow && selPts.size) for (const i of selPts) { const p = pts[i]; if (!p) continue; x.beginPath(); x.arc(xOf(r, p.t), yOf(r, p.v), 6.5 * dpr, 0, Math.PI * 2); x.strokeStyle = '#ffffff'; x.lineWidth = dpr; x.stroke(); }
  x.restore();
  if (drag && drag.r === r && drag.stick) { const gy = Math.round(yOf(r, drag.stick.v)) + 0.5; x.save(); x.strokeStyle = 'rgba(255,214,120,.8)'; x.lineWidth = dpr; x.setLineDash([4 * dpr, 3 * dpr]); x.beginPath(); x.moveTo(0, gy); x.lineTo(w, gy); x.stroke(); x.restore(); }   // the value it is holding at
  if (boxSel && boxSel.r === r) { x.save(); x.strokeStyle = 'rgba(255,255,255,.55)'; x.setLineDash([3 * dpr, 3 * dpr]); x.strokeRect(Math.min(boxSel.x0, boxSel.x1), Math.min(boxSel.y0, boxSel.y1), Math.abs(boxSel.x1 - boxSel.x0), Math.abs(boxSel.y1 - boxSel.y0)); x.restore(); }
  drawEndMark(x, w, h, xOf(r, S.dur), dpr, 'rgba(12,15,13,.62)');
  if (zoomed) { x.font = `600 ${10 * dpr}px "Barlow", sans-serif`; x.textBaseline = 'top'; x.textAlign = 'right'; x.fillStyle = 'rgba(240,138,28,.8)'; x.fillText(`zoom ${+(lo * r.scale).toFixed(2)}…${+(hi * r.scale).toFixed(2)}`, w - 4 * dpr, 3 * dpr); x.textAlign = 'left'; }
}
function evXY(r, e) { const b = r.cv.getBoundingClientRect(), k = r.cv.width / b.width; return [(e.clientX - b.left) * k, (e.clientY - b.top) * k, k]; }
function hitPoint(r, e) { const [px, py, k] = evXY(r, e), pts = r.get(); let best = null, bd = 8 * k; pts.forEach((p, i) => { const d = Math.hypot(xOf(r, p.t) - px, yOf(r, p.v) - py); if (d < bd) { bd = d; best = i; } }); return best; }
function hitRing(r, e) { const [px, py, k] = evXY(r, e), pts = r.get(); for (let i = 0; i < pts.length - 1; i++) { const tm = (pts[i].t + pts[i + 1].t) / 2; if (Math.hypot(xOf(r, tm) - px, yOf(r, evalPts(pts, tm)) - py) < 7 * k) return i; } return null; }
function deletePoint(r, i) { const pts = r.get(); if (pts.length <= 1) return; if (isEndPt(pts, i)) { toast('The start and end points stay (drag them up or down to change their value).'); return; } confirmDelete(`Delete this point (${pts[i].t.toFixed(2)} s, ${r.fmt(pts[i].v)}) from ${trackName(r)}?`, () => { pushUndo(); pts.splice(i, 1); edited(r); }); }
let drag = null, boxSel = null, selRow = null, selPts = new Set();
function onLaneDown(e, r) {
  if (e.button !== 0) return;
  e.preventDefault(); r.cv.setPointerCapture(e.pointerId);
  closeNumEdit();
  if (r !== selRow) { const old = selRow; selPts = new Set(); selRow = r; if (old && old.cv) drawLane(old); }
  if (e.shiftKey) { const [px, py] = evXY(r, e); boxSel = { r, x0: px, y0: py, x1: px, y1: py }; return; }
  const pts = r.get(); let i = hitPoint(r, e);
  if (i == null) { const ri = hitRing(r, e); if (ri != null) { pushUndo(); drag = { r, ring: ri, y0: e.clientY, k0: pts[ri].k }; return; } }
  if (i == null) {
    // a new point at the clicked time: its value starts as whatever the curve already reads there, so adding a
    // point never bends the line by itself — drag it (mousemove, without releasing) to actually set a value
    pushUndo();
    const [px] = evXY(r, e), tRaw = tOf(r, px), t = S.magnet ? snapTime(tRaw, r.cv.width, dprOf(r)) : tRaw;
    let at = pts.findIndex((q) => q.t > t); if (at < 0) at = pts.length;
    const lo = at > 0 ? pts[at - 1].t : 0, hi = at < pts.length ? pts[at].t : S.dur, tc = clamp(t, lo, hi);
    const v0 = evalPts(pts, tc), p = { t: tc, v: r.flag ? (v0 >= 0.5 ? 1 : 0) : v0, k: 0 };
    pts.splice(at, 0, p); i = at; edited(r);
    drag = { r, i };
    return;
  }
  pushUndo();
  { const [px, py] = evXY(r, e), q = pts[i]; drag = { r, i, dx: xOf(r, q.t) - px, dy: yOf(r, q.v) - py, x0: px, passed: q.v }; }   // grab offset: the point doesn't jump to the pixel under the cursor
  onDrag(e);
}
function onDrag(e) {
  if (!drag) return;
  const r = drag.r, pts = r.get();
  if (drag.ring != null) {
    const a = pts[drag.ring], b = pts[drag.ring + 1], dir = Math.sign(b.v - a.v) || 1;
    a.k = clamp(drag.k0 + dir * (e.clientY - drag.y0) / 60, -1, 1);
    edited(r, true); tip(e, `curve ${a.k.toFixed(2)}`); return;
  }
  const [px0, py0, kk] = evXY(r, e), p = pts[drag.i], px = px0 + (drag.dx || 0), py = py0 + (drag.dy || 0);
  const sideways = drag.x0 == null || Math.abs(px0 - drag.x0) > 3 * kk;   // a straight up / down drag keeps its time
  let t = sideways ? tOf(r, px) : p.t, v = vOf(r, py);
  if (sideways && (S.magnet || e.ctrlKey || e.metaKey)) t = snapTime(t, r.cv.width, dprOf(r));   // magnet: stick to the unit's lines
  if (e.ctrlKey || e.metaKey) v = Math.round(v / r.snap) * r.snap;
  // value magnet: when the dragged value reaches or crosses a neighbour's value, the track's default or another
  // point's value, it holds there for a moment (0.25 s), then follows the mouse again; Alt drags free
  const rawV = v, now = performance.now();
  if (S.magnet && !e.altKey && !(e.ctrlKey || e.metaKey) && !r.flag) {
    if (drag.hold && now < drag.hold.until) v = drag.hold.v;
    else {
      if (drag.hold) { drag.passed = drag.hold.v; drag.hold = null; }
      const cands = [], add = (val, why) => { if (val != null && isFinite(val)) cands.push({ v: val, why }); };
      if (drag.i > 0) add(pts[drag.i - 1].v, 'previous point'); if (drag.i < pts.length - 1) add(pts[drag.i + 1].v, 'next point');
      add(r.ref, 'default'); pts.forEach((q, j) => { if (j !== drag.i && Math.abs(j - drag.i) > 1) add(q.v, 'a point'); });
      const pv = drag.prevV ?? rawV, near = 2.5 * kk;
      for (const c of cands) {
        if (drag.passed != null && Math.abs(c.v - drag.passed) < 1e-9) continue;   // just let go of this one
        const crossed = (pv - c.v) * (rawV - c.v) <= 0 && Math.abs(pv - rawV) > 1e-12, close = Math.abs(yOf(r, c.v) - yOf(r, rawV)) < near;
        if (crossed || close) { drag.hold = { v: c.v, why: c.why, until: now + 250 }; v = c.v; break; }
      }
      if (drag.passed != null && Math.abs(yOf(r, drag.passed) - yOf(r, rawV)) > 6 * kk) drag.passed = null;
    }
  }
  drag.prevV = rawV; drag.stick = drag.hold && now < drag.hold.until ? drag.hold : null;
  if (r.flag) v = v >= 0.5 ? 1 : 0;
  const lo = drag.i > 0 ? pts[drag.i - 1].t : 0, hi = drag.i < pts.length - 1 ? pts[drag.i + 1].t : S.dur;
  p.t = drag.i === 0 ? 0 : drag.i === pts.length - 1 ? S.dur : clamp(t, lo, hi); p.v = clamp(v, r.range[0], r.range[1]);
  // a playback / cycle speed point: it goes to the bar under the cursor (as the frozen ruler shows it), and stays
  // on that bar however its own value re-times the bars before it
  if (BAR_DRIVERS.has(r.key) || r.key.startsWith('f|')) {
    const ctLo = drag.i > 0 ? clipTime(pts[drag.i - 1].t) : 0, ctHi = drag.i < pts.length - 1 && pts[drag.i + 1].t < S.dur - 1e-6 ? clipTime(pts[drag.i + 1].t) : Infinity;
    if (drag.ct0 == null) drag.ct0 = clipTime(p.t);   // its bar when grabbed
    pinDrag = { p, ct: clamp(sideways ? lutAt(vLut(), p.t) : drag.ct0, ctLo, ctHi) };
  }
  const held = drag.stick ? ` · = ${drag.stick.why}` : '';
  if (BAR_DRIVERS.has(r.key) || r.key.startsWith('f|')) { freezeView(); drawLane(r); tip(e, `${p.t.toFixed(3)} s · ${r.fmt(p.v)}${held} · updates on release`); return; }
  edited(r, true); tip(e, `${p.t.toFixed(3)} s · ${r.fmt(p.v)}${held}`);
}
function finalizeBoxSelect() {
  const { r, x0, y0, x1, y1 } = boxSel;
  const t0 = tOf(r, Math.min(x0, x1)), t1 = tOf(r, Math.max(x0, x1));
  const v0 = vOfRaw(r, Math.max(y0, y1)), v1 = vOfRaw(r, Math.min(y0, y1));
  const pts = r.get(); selPts = new Set(); pts.forEach((p, i) => { if (p.t >= t0 - 1e-6 && p.t <= t1 + 1e-6 && p.v >= v0 - 1e-6 && p.v <= v1 + 1e-6) selPts.add(i); });
  selRow = r; drawLane(r);
}
window.addEventListener('pointermove', (e) => {
  if (drag) onDrag(e);
  if (boxSel) { const [px, py] = evXY(boxSel.r, e); boxSel.x1 = px; boxSel.y1 = py; drawLane(boxSel.r); }
  if (rowDrag) setRowHeight(rowDrag.r, rowDrag.h0 + (e.clientY - rowDrag.y0), false);
  if (rulerDrag) scrub(e); if (gripDrag) resizeTimeline(e);
});
window.addEventListener('pointerup', () => {
  if (drag) { const r = drag.r; drag = null; pinDrag = null; tip(null); edited(r); }
  if (boxSel) { finalizeBoxSelect(); boxSel = null; }
  if (rowDrag) { rowDrag = null; save(); }
  rulerDrag = false; gripDrag = false;
});
function onLaneHover(e, r) {
  if (drag || boxSel) return;
  const [px] = evXY(r, e), t = tOf(r, px), hit = hitPoint(r, e) != null || hitRing(r, e) != null;
  r.cv.style.cursor = hit ? 'grab' : 'crosshair';
  tip(e, `${t.toFixed(2)} s · ${r.fmt(evalPts(r.get(), t))}`);
}
function edited(r, live = false) {
  const stdKeep = r && r.owner && r.owner.type === 'steady' && stdCache && stdCache.key.startsWith(editVersion + '|');
  try { editedInner(r, live); if (!live && r && (r.key === 'stride' || r.key === 'cyc')) speedLockAfter(r.key); } finally { if (stdKeep && stdCache) stdCache.key = stdCache.key.replace(/^\d+\|/, editVersion + '|'); }
}
function editedInner(r, live = false) {
  if (live) syncMirrors();
  if (TIMING_KEYS.has(r.key) || r.key.startsWith('f|')) {
    const bar = BAR_DRIVERS.has(r.key) || r.key.startsWith('f|');
    // playback / cycle speed: while dragging nothing is re-timed (the point stays where the frozen ruler shows it,
    // only its value moves); on release the point, the ruler, the bars and every other track update at once
    if (live) { freezeView(); if (!bar) rebuildSpeedLUT(); drawLane(r); }
    else { viewFreeze = null; if (bar) pinPointsToBar(); else rebuildSpeedLUT(); if (holdCountOrUndo(r.key === 'cyc' ? 'cycle speed' : 'speed') === false) return; gridCache = null; layoutLanes(); }
  } else drawLane(r);
  refreshSummary(r);
  editVersion++; trailDirty = true;
  if (!live) save();
}
function tip(e, text) { const el = $('tip'); if (!e) { el.hidden = true; return; } el.textContent = text; el.hidden = false; el.style.left = Math.min(e.clientX + 14, window.innerWidth - 180) + 'px'; el.style.top = e.clientY - 26 + 'px'; }

// ---------------------------------------------------------------- exact values
let numTarget = null;
function openNumEdit(r, i, e) {
  const box = $('numEdit'), pts = r.get(), p = i != null ? pts[i] : null;
  $('numTL').hidden = false;
  numTarget = { r, i };
  $('numT').value = (p ? p.t : S.t).toFixed(3); $('numT').disabled = !!(p && isEndPt(pts, i));
  $('numV').value = +((p ? p.v : evalPts(pts, S.t)) * r.scale).toFixed(3);
  $('numV').step = r.flag ? 1 : r.snap * r.scale;
  $('numVL').textContent = r.unit;
  box.hidden = false;
  const bw = box.offsetWidth || 260;
  box.style.left = clamp(e.clientX - bw / 2, 8, window.innerWidth - bw - 8) + 'px';
  box.style.top = clamp(e.clientY - 70, 8, window.innerHeight - 60) + 'px';
  $('numV').focus(); $('numV').select();
}
function closeNumEdit() { $('numEdit').hidden = true; numTarget = null; }
function applyNumEdit() {
  if (!numTarget) return;
  const { r, i } = numTarget, pts = r.get();
  const t = clamp(parseFloat($('numT').value), 0, S.dur), raw = parseFloat($('numV').value);
  if (!isFinite(t) || !isFinite(raw)) { closeNumEdit(); return; }
  let v = clamp(raw / r.scale, r.range[0], r.range[1]); if (r.flag) v = v >= 0.5 ? 1 : 0;
  pushUndo();
  if (i != null && pts[i]) { const end = isEndPt(pts, i), last = i === pts.length - 1, p = pts.splice(i, 1)[0]; p.v = v; p.t = end ? (last ? S.dur : 0) : clamp(t, 1e-3, S.dur - 1e-3); let at = pts.findIndex((q) => q.t > t); if (at < 0) at = pts.length; pts.splice(at, 0, p); }
  else keyAtFlat(pts, t, v);
  closeNumEdit(); edited(r);
}
$('numOk').onclick = applyNumEdit;
$('numEdit').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyNumEdit(); } if (e.key === 'Escape') closeNumEdit(); e.stopPropagation(); });
document.addEventListener('pointerdown', (e) => { if (!$('numEdit').hidden && !$('numEdit').contains(e.target) && !(e.target.classList && e.target.classList.contains('val'))) closeNumEdit(); });

// ---------------------------------------------------------------- context menus
const menuEl = document.createElement('div'); menuEl.id = 'ctxMenu'; menuEl.hidden = true; document.body.append(menuEl);
document.addEventListener('pointerdown', (e) => { if (!menuEl.hidden && !menuEl.contains(e.target)) menuEl.hidden = true; });
window.addEventListener('blur', () => { menuEl.hidden = true; });
// a right-click that lands on an open menu belongs to what is under it (right double-click deletes even when the
// first click's menu opened under the pointer)
menuEl.addEventListener('contextmenu', (e) => {
  e.preventDefault(); menuEl.hidden = true;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (el && el !== menuEl) el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, button: 2 }));
});
function openMenu(x, y, items) {
  menuEl.textContent = '';
  for (const it of items) {
    if (it.sep) { const hr = document.createElement('div'); hr.className = 'ctxsep'; menuEl.append(hr); continue; }
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ctxitem';
    b.textContent = (it.checked != null ? (it.checked ? '☑ ' : '☐ ') : '') + it.label;
    if (it.disabled) b.disabled = true;
    b.onclick = () => { menuEl.hidden = true; if (it.action) it.action(); };
    menuEl.append(b);
  }
  menuEl.hidden = false;
  const vw = window.innerWidth, vh = window.innerHeight, mh = menuEl.offsetHeight || 200;
  menuEl.style.left = Math.min(x, vw - 220) + 'px'; menuEl.style.top = Math.max(8, Math.min(y, vh - mh - 8)) + 'px';
}
function openBoneMenu(e, name) {
  const ba = A.bones[name]; if (!ba) return;
  const mirror = mirrorName(name);
  openMenu(e.clientX, e.clientY, [
    { label: 'Show / hide tracks…', action: () => openAddDialog({ type: 'bone', name }, ba.show) },
    { label: 'Multiply into children', checked: !!ba.withChildren, action: () => { pushUndo(); ba.withChildren = !ba.withChildren; rebuildRows(); save(); } },
    { sep: true },
    { label: 'Reset bone', action: () => { pushUndo(); const show = ba.show; A.bones[name] = newBoneAuto(S.dur); A.bones[name].show = show; rebuildRows(); save(); } },
    { label: 'Copy bone', action: () => { clipboard = { type: 'bone', data: JSON.parse(JSON.stringify(ba)) }; } },
    { label: 'Paste bone', disabled: !(clipboard && clipboard.type === 'bone'), action: () => { pushUndo(); const show = ba.show; A.bones[name] = JSON.parse(JSON.stringify(clipboard.data)); A.bones[name].show = show; rebuildRows(); save(); } },
    { label: mirror ? ('Copy mirrored → ' + mirror) : 'Mirror (no L/R pair)', disabled: !mirror, action: () => mirrorPair(name) },
    linkItem('bone', name),
    { label: 'Group: this bone + everything below', disabled: !rig.bones[boneIdx.get(name)].children.some((c) => c.isBone), action: () => (A.groups['sub:' + name] ? selectGroup('sub:' + name) : openAddDialog({ type: 'group', id: 'sub:' + name })) },
    { sep: true },
    { label: 'Remove bone', action: () => removeBone(name) },
  ]);
}
function mirrorEffId(id) { if (/^ig:[LR]/.test(id)) return 'ig:' + (id[3] === 'L' ? 'R' : 'L') + id.slice(4); if (id.startsWith('ig:')) return null; return id[0] === 'L' ? 'R' + id.slice(1) : id[0] === 'R' ? 'L' + id.slice(1) : null; }
function mirrorEff(id) {
  const to = mirrorEffId(id), src = A.ik[id]; if (!to || !src) return;
  pushUndo();   // a one-time copy (the linked mirror keeps copying after every edit)
  if (!A.ik[to]) A.ikOrder.push(to);
  A.ik[to] = mirrorEffCopy(id, to);
  rebuildRows(); save();
}
function isSelRow(type, key) {   // a both-sides row lights up for either side
  const sel = type === 'bone' ? S.selected : type === 'group' ? S.selGroup : S.selEff;
  return !!sel && (sel === key || linkOf(type, sel) === key);
}
function linkItem(type, key) {
  const map = type === 'bone' ? A.bones : type === 'group' ? A.groups : A.ik, it = map[key], twin = partnerLabel(type, key);
  return { label: twin ? 'Both sides (linked mirror with ' + twin + ')' : 'Both sides (no L/R pair)', checked: !!(it && it.mirror), disabled: !twin, action: () => { pushUndo(); setMirrorLink(type, key, !it.mirror); rebuildRows(); save(); } };
}
function openGroupMenu(e, gid) {
  const g = A.groups[gid]; if (!g) return;
  const to = mirrorGroupId(gid);
  openMenu(e.clientX, e.clientY, [
    { label: 'Show / hide tracks…', action: () => openAddDialog({ type: 'group', id: gid }, g.show) },
    { label: 'Select its bones in the viewport', action: () => selectGroup(gid) },
    { sep: true },
    { label: 'Reset group', action: () => { pushUndo(); const show = g.show; A.groups[gid] = newGroupAuto(S.dur); A.groups[gid].show = show; rebuildRows(); save(); } },
    { label: to ? 'Copy mirrored → ' + groupLabel(to) : 'Mirror (no L/R pair)', disabled: !to, action: () => { pushUndo(); if (!A.groups[to]) A.groupOrder.push(to); A.groups[to] = mirrorGroupCopy(gid); rebuildRows(); save(); } },
    linkItem('group', gid),
    { sep: true },
    { label: 'Remove group', action: () => removeGroup(gid) },
  ]);
}
function openEffMenu(e, id) {
  const ef = A.ik[id]; if (!ef) return;
  const to = mirrorEffId(id), cust = EFF_BY_ID[id].custom;
  openMenu(e.clientX, e.clientY, [
    ...(cust ? [{ label: 'Edit controller…', action: () => editController(id) }, { label: 'Duplicate controller', action: () => duplicateController(id) }, { sep: true }] : []),
    { label: 'Show / hide tracks…', action: () => openAddDialog({ type: 'eff', id }, ef.show) },
    { sep: true },
    { label: 'Reset effector', action: () => { pushUndo(); const show = ef.show; A.ik[id] = newEffAuto(id, S.dur); A.ik[id].show = show; rebuildRows(); save(); } },
    { label: 'Copy effector', action: () => { clipboard = { type: 'eff', kind: EFF_BY_ID[id].kind, data: JSON.parse(JSON.stringify(ef)) }; } },
    { label: 'Paste effector', disabled: !(clipboard && clipboard.type === 'eff' && clipboard.kind === EFF_BY_ID[id].kind), action: () => { pushUndo(); const show = ef.show; A.ik[id] = JSON.parse(JSON.stringify(clipboard.data)); A.ik[id].show = show; rebuildRows(); save(); } },
    { label: to ? 'Copy mirrored → ' + EFF_BY_ID[to].label : 'Mirror (no L/R pair)', disabled: !to, action: () => mirrorEff(id) },
    linkItem('eff', id),
    { sep: true },
    { label: 'Remove effector', action: () => removeEff(id) },
  ]);
}
// delete a track: its automation goes back to neutral and it leaves the timeline; an item with no tracks left goes too
function trackName(r) { const el = r.h.querySelector('.name'); const own = r.owner ? (r.owner.type === 'bone' ? r.owner.name : r.owner.type === 'eff' ? EFF_BY_ID[r.owner.id].label : r.owner.type === 'group' ? groupLabel(r.owner.id) : r.owner.type === 'steady' ? 'Steadiness' : r.owner.type === 'forcer' ? ((A.forcers || []).find((f) => f.id === r.owner.id) || { name: 'Forcer' }).name : symLabel(r.owner.id)) : ''; return `"${el ? el.textContent.trim() : r.key}"${own ? ' of ' + own : ''}`; }
function deleteTrack(r) {
  const o = r.owner, last = (o && o.type === 'bone' && Object.values(A.bones[o.name].show).filter(Boolean).length === 1) || (o && o.type === 'eff' && Object.values(A.ik[o.id].show).filter(Boolean).length === 1) || (o && o.type === 'group' && Object.values(A.groups[o.id].show).filter(Boolean).length === 1) || (o && o.type === 'steady' && Object.values(A.steady.show).filter(Boolean).length === 1);
  confirmDelete(`Delete the track ${trackName(r)}? Its automation is cleared.${last ? ' It is the last track, so the item leaves the timeline too.' : ''}`, () => deleteTrackNow(r));
}
function deleteTrackNow(r) {
  pushUndo();
  r.set(flat(r.ref, S.dur));
  const part = r.key.split('|'), last = part[part.length - 1], o = r.owner;
  if (!o) {   // master tracks
    if (r.key === 'speed') A.showMaster.speed = false; else if (r.key === 'move') A.showMaster.move = false;
    else if (r.key === 'cyc') A.showMaster.cycle = false;
    else if (r.key === 'gnd') A.showMaster.gnd = false;
    else if (r.key === 'stride') A.showMaster.stride = false;
    rebuildSpeedLUT();
  } else if (o.type === 'bone') {
    const ba = A.bones[o.name]; ba.show[last] = false;
    if (!Object.values(ba.show).some(Boolean)) { delete A.bones[o.name]; A.order = A.order.filter((n) => n !== o.name); }
  } else if (o.type === 'eff') {
    const e = A.ik[o.id]; e.show[o.k] = false;
    if (!Object.values(e.show).some(Boolean)) { delete A.ik[o.id]; A.ikOrder = A.ikOrder.filter((n) => n !== o.id); }
  } else if (o.type === 'group') {
    const g = A.groups[o.id]; g.show[last] = false;
    if (!Object.values(g.show).some(Boolean)) { delete A.groups[o.id]; A.groupOrder = A.groupOrder.filter((n) => n !== o.id); }
  } else if (o.type === 'steady') {
    A.steady.show[o.k] = false;
    if (!Object.values(A.steady.show).some(Boolean)) { delete A.steady; A.rowOrder = (A.rowOrder || []).filter((k) => k !== 'std:main'); }
  } else if (o.type === 'sym') {
    const sy = A.sym[o.id]; sy.show = sy.show || {}; sy.show[last] = false;
    if (sy.show.weight === false && sy.show.offset === false) { delete A.sym[o.id]; A.symOrder = A.symOrder.filter((n) => n !== o.id); }
  }
  editVersion++; trailDirty = true; rebuildRows(); save(); updateSelChip();
}
function openLaneMenu(e, r) {
  const pts = r.get(), h = rowHeight(r);
  openMenu(e.clientX, e.clientY, [
    { label: 'Delete track', action: () => deleteTrack(r) },
    { sep: true },
    { label: 'Add point at playhead…', action: () => openNumEdit(r, null, e) },
    { label: 'Select all points', action: () => { selRow = r; selPts = new Set(pts.map((_, i) => i)); drawLane(r); } },
    { label: 'Copy track', action: () => { clipboard = { type: 'track', data: JSON.parse(JSON.stringify(pts)) }; } },
    { label: 'Paste track', disabled: !(clipboard && clipboard.type === 'track'), action: () => { pushUndo(); r.set(JSON.parse(JSON.stringify(clipboard.data)).map((p) => ({ ...p, v: clamp(p.v, r.range[0], r.range[1]) }))); edited(r); } },
    { sep: true },
    { label: 'Zoom values to fit', action: () => zoomToFit(r) },
    { label: 'Reset value zoom', disabled: !A.zoom[r.key], action: () => setZoom(r, r.range) },
    ...HEIGHT_PRESETS.map(([n, v]) => ({ label: 'Height: ' + n, checked: h === v, action: () => setRowHeight(r, v, true) })),
    { sep: true },
    { label: 'Reset track', action: () => confirmDelete(`Reset ${trackName(r)}? All its points go.`, () => { pushUndo(); r.set(flat(r.ref, S.dur)); edited(r); }, 'Reset') },
  ]);
}

// ---------------------------------------------------------------- selection actions (keyboard)
function copySelection() { if (!selRow || !selPts.size) return; const pts = selRow.get(); clipboard = { type: 'points', data: [...selPts].sort((a, b) => a - b).map((i) => ({ ...pts[i] })) }; }
function pasteSelection() {
  if (!selRow || !clipboard || clipboard.type !== 'points') return;
  pushUndo();
  const pts = selRow.get(), t0 = clipboard.data[0].t, base = S.t;
  for (const p of clipboard.data) { const np = { t: clamp(base + (p.t - t0), 1e-3, S.dur - 1e-3), v: clamp(p.v, selRow.range[0], selRow.range[1]), k: p.k }; let at = pts.findIndex((q) => q.t > np.t); if (at < 0) at = pts.length; pts.splice(at, 0, np); }
  selPts = new Set(); edited(selRow);
}
function deleteSelection() {
  if (!selRow || !selPts.size) return;
  const pts = selRow.get(); if (pts.length - selPts.size < 1) return;
  confirmDelete(`Delete ${selPts.size} point${selPts.size > 1 ? 's' : ''} from ${trackName(selRow)}?`, deleteSelectionNow);
}
function deleteSelectionNow() {
  if (!selRow || !selPts.size) return;
  const pts = selRow.get();
  pushUndo();
  const keep = pts.filter((_, i) => !selPts.has(i) || isEndPt(pts, i));   // the start and end points stay
  selRow.set(keep.length >= 2 ? keep : flat(selRow.ref, S.dur));
  selPts = new Set(); edited(selRow);
}
function nudgeSelection(key, big) {
  if (!selRow || !selPts.size) return;
  pushUndo();
  const pts = selRow.get(), [lo, hi] = selRow.range;
  const dt = (big ? 0.1 : 0.01) * (key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0);
  const dv = (big ? 10 : 1) * selRow.snap * (key === 'ArrowUp' ? 1 : key === 'ArrowDown' ? -1 : 0);
  const moved = [...selPts].map((i) => pts[i]).filter(Boolean), ends = new Set([pts[0], pts[pts.length - 1]]);
  for (const p of moved) { if (!ends.has(p)) p.t = clamp(p.t + dt, 1e-3, S.dur - 1e-3); p.v = clamp(p.v + dv, lo, hi); }
  pts.sort((a, b) => a.t - b.t); selPts = new Set(moved.map((p) => pts.indexOf(p))); edited(selRow);
}
function selectAllInFocusedLane() { if (!selRow) return; selPts = new Set(selRow.get().map((_, i) => i)); drawLane(selRow); }
function dialogsOpen() { return !$('frcDlg').hidden || !$('stdDlg').hidden || !$('barCopyDlg').hidden || !$('tfDlg').hidden || !$('barsDlg').hidden || !$('tplLibDlg').hidden || !$('confirmDlg').hidden || !$('sheet').hidden || !$('addDlg').hidden || !$('boneDlg').hidden || !$('bakeDlg').hidden || !$('helpDlg').hidden; }
window.addEventListener('keydown', (e) => {
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName) || dialogsOpen()) {
    if (e.key === 'Escape') { $('sheet').hidden = true; $('addDlg').hidden = true; $('boneDlg').hidden = true; }
    return;
  }
  if (e.code === 'Space') { e.preventDefault(); $('btnPlay').click(); return; }
  if (e.code === 'Home') { goHome(); return; }
  const meta = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (meta && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if (meta && ((k === 'z' && e.shiftKey) || k === 'y')) { e.preventDefault(); redo(); return; }
  if (meta && k === 'c') { e.preventDefault(); copySelection(); return; }
  if (meta && k === 'v') { e.preventDefault(); pasteSelection(); return; }
  if (meta && k === 'a') { e.preventDefault(); selectAllInFocusedLane(); return; }
  if (meta) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
  if (e.key.startsWith('Arrow')) { e.preventDefault(); nudgeSelection(e.key, e.shiftKey); return; }
  if (k === 'r' || k === 'e') { if (gizmoMode !== 'rotate') setGizmoMode('rotate'); return; }
  if (k === 'q') { gizmoMode = null; setGizmoMode(null); return; }
  if (k === 'w') { if (gizmoMode !== 'move') setGizmoMode('move'); return; }
  if (k === 'f') { frameCamera(false); return; }
  if (k === 'k') { keyPending(); return; }
  if (e.key === 'Escape') { if (pending) cancelPending(); else clearSelection(); }
});

// ruler + playhead
const ruler = $('ruler'); let rulerDrag = false;
function timeOfClipTime(ct, lut = S.speedLUT, extend = false) { if (!lut || lut.length < 2) return 0;
  if (ct <= lut[0]) return 0;
  if (ct >= lut[lut.length - 1]) {   // past the end: carry on at the last rate (display axis only)
    if (!extend) return S.dur;
    const n = lut.length - 1, rate = (lut[n] - lut[n - 1]) / (S.dur / n);
    return S.dur + (rate > 1e-9 ? (ct - lut[n]) / rate : 0);
  }
  let lo = 0, hi = lut.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (lut[mid] < ct) lo = mid; else hi = mid; }
  const t0 = lo / (lut.length - 1) * S.dur, t1 = hi / (lut.length - 1) * S.dur;
  const f = (ct - lut[lo]) / Math.max(1e-9, lut[hi] - lut[lo]);
  return t0 + (t1 - t0) * f;
}
// foot landings as [time, side], drawn as coloured vertical lines through the lanes (L purple, R orange)
let footMarkCache = null;
function footMarks() {
  const lut = vLut();
  if (!cur || !lut || !lut.length) return [];
  if (footMarkCache && footMarkCache.lut === lut && footMarkCache.v === editVersion && footMarkCache.id === cur.id) return footMarkCache.marks;
  const totalCt = lut[lut.length - 1], marks = [];
  try {
    const win = ((BAKED[cur.id] || cur.c.origBk || {}).win) || cur.c.win;   // a symmetrized clip: its measured contacts
    if (cur.kind === 'loop' && win) {
      for (const Sd of ['L', 'R']) {
        if (!win[Sd]) continue;
        const w0 = win[Sd][0];
        for (let n = 0; n < 2000; n++) { const ct = n * cur.dur + w0 * cur.dur; if (ct > totalCt + 1e-6) break; marks.push([timeOfClipTime(ct, lut), Sd]); }
      }
    } else if (cur.kind === 'move') {
      const fps = (gl && gl.fps) || 30, con = { L: cur.c.cL, R: cur.c.cR };
      for (const Sd of ['L', 'R']) { const arr = con[Sd]; if (!arr) continue; for (let i = 1; i < arr.length; i++) if (arr[i] && !arr[i - 1]) marks.push([timeOfClipTime(i / fps, lut), Sd]); }
    }
  } catch { /* clip missing contact data: no marks */ }
  footMarkCache = { lut, v: editVersion, id: cur.id, marks };
  return marks;
}
function drawRuler() {
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = ruler.clientWidth || 300; ruler.width = Math.round(w * dpr); ruler.height = Math.round(34 * dpr);
  const x = ruler.getContext('2d'), W = ruler.width, H = ruler.height;
  x.fillStyle = '#1f1f22'; x.fillRect(0, 0, W, H);
  x.font = `500 ${11 * dpr}px "IBM Plex Mono", monospace`; x.textBaseline = 'top';
  const TW = timeAreaCss() * dpr, G = timeGrid(), vis = visibleGrid(G, TW, dpr);
  if (S.unit === 'step') for (const sp of G.spans) { x.fillStyle = sp.S === 'L' ? 'rgba(201,139,214,.28)' : 'rgba(255,138,74,.25)'; const a = xT(sp.t0, TW), b = xT(sp.t1, TW); x.fillRect(a, sp.S === 'L' ? H * 0.62 : H * 0.8, Math.max(1, b - a), H * 0.14); }
  const taken = [];   // labels: the end first, then the major ones, then the rest where they fit
  const xe = xT(S.dur, TW);
  { const lb = endLabel(), tw = x.measureText(lb).width, a0 = Math.round(xe) - tw - 5 * dpr; x.fillStyle = '#f5b46b'; x.fillText(lb, a0, 19 * dpr); }   // on the lower line: the last bar keeps its own label
  for (const g of vis) {
    const px = Math.round(xT(g.t, TW)) + 0.5;
    x.fillStyle = g.S ? (g.S === 'L' ? COL.timing : '#ff8a4a') : g.level === 2 ? '#8e8e94' : g.level === 1 ? '#5e5e64' : '#46464c';
    x.fillRect(px, g.level === 2 ? H * 0.45 : g.level === 1 ? H * 0.6 : H * 0.72, 1, H);
  }
  for (const pass of [2, 1, 0]) for (const g of vis) {
    if (g.level !== pass || !g.label || g.t >= S.dur - 1e-6) continue;
    const big = S.unit === 'cycle' && pass === 2;   // bar numbers large, quarters (1.2, 1.3) small
    x.font = big ? `700 ${15 * dpr}px "IBM Plex Mono", monospace` : `500 ${10 * dpr}px "IBM Plex Mono", monospace`;
    const px = Math.round(xT(g.t, TW)) + 0.5, a0 = px + 4 * dpr, a1 = a0 + x.measureText(g.label).width + 6 * dpr;
    if (a1 < 0 || a0 > W || taken.some(([l, r]) => a0 < r && a1 > l)) continue;
    taken.push([a0, a1]);
    x.fillStyle = g.S ? (g.S === 'L' ? COL.timing : '#ff8a4a') : pass === 2 ? '#d4dbd6' : '#8d9892';
    x.fillText(g.label, a0, (big ? 3 : 6) * dpr);
  }
  // clip cycle marks (where one loop / move of the clip ends, at the current speeds)
  if (cur && vLut()) { x.fillStyle = 'rgba(240,138,28,.55)'; let n = 1; const lut = vLut(); for (let i = 1; i < lut.length; i++) { if (lut[i] >= n * cur.dur) { x.fillRect(Math.round(xT((i / (lut.length - 1)) * S.dur, TW)), H - 6 * dpr, 2, 6 * dpr); n++; } } }
  drawEndMark(x, W, H, xe, dpr, 'rgba(10,12,11,.55)');
}
// ---------------------------------------------------------------- time units
// grid lines { t, level 0-2, label, S? } for the chosen unit; foot steps also give the contact spans
let gridCache = null;
const FPS = 30;
function timeGrid() {
  if (viewFreeze) return viewFreeze.grid;
  const key = `${S.unit}|${S.dur}|${cur && cur.id}|${editVersion}|${S.realtime}`;
  if (gridCache && gridCache.key === key) return gridCache;
  const lines = [], spans = [];
  if (cur && S.speedLUT) {   // contact spans (used by the step unit and its colours)
    const step = 1 / 240;
    for (const Sd of ['L', 'R']) {
      if (footContact(Sd, 0) == null) continue;
      let on = null;
      for (let t = 0; t <= S.dur + 1e-9; t += step) {
        const c = footContact(Sd, Math.min(t, S.dur));
        if (c && on == null) on = t;
        if (!c && on != null) { spans.push({ S: Sd, t0: on, t1: t }); on = null; }
      }
      if (on != null) spans.push({ S: Sd, t0: on, t1: S.dur });
    }
    spans.sort((a, b) => a.t0 - b.t0);
  }
  if (S.unit === 'frame') {
    for (let f = 0; f <= Math.round(S.dur * FPS); f++) lines.push({ t: f / FPS, level: f % FPS === 0 ? 2 : f % 5 === 0 ? 1 : 0, label: f % 5 === 0 ? f + 'f' : '' });
  } else if (S.unit === 'cycle' && cur && S.speedLUT) {
    // realtime: bar lines where the bars really fall (after playback / cycle speed); otherwise evenly spaced
    const lutG = S.speedLUT, total = lutG[lutG.length - 1];
    for (let q = 0; q / 8 * cur.dur <= total + 1e-9 && q < 4000; q++) lines.push({ t: timeOfClipTime(q / 8 * cur.dur, lutG), level: q % 8 === 0 ? 2 : q % 2 === 0 ? 1 : 0, label: q % 8 === 0 ? String(q / 8 + 1) : q % 2 === 0 ? `${Math.floor(q / 8) + 1}.${(q % 8) / 2}` : '' });
  } else if (S.unit === 'step' && spans.length) {
    const n = { L: 0, R: 0 };
    lines.push({ t: 0, level: 2, label: '' });
    for (const sp of spans) { n[sp.S]++; if (sp.t0 > 1e-6) lines.push({ t: sp.t0, level: 2, label: sp.S + n[sp.S], S: sp.S }); else Object.assign(lines[0], { label: sp.S + n[sp.S], S: sp.S }); if (sp.t1 < S.dur - 1e-6) lines.push({ t: sp.t1, level: 0, label: '' }); }
  } else {
    const major = S.dur > 20 ? 5 : S.dur > 8 ? 1 : 0.5;
    for (let i = 0; i <= Math.round(S.dur * 10); i++) { const t = i / 10, mj = Math.abs(t / major - Math.round(t / major)) < 1e-6; lines.push({ t, level: i % 10 === 0 ? 2 : i % 5 === 0 ? 1 : 0, label: mj ? t.toFixed(major < 1 ? 1 : 0) + 's' : '' }); }
  }
  lines.sort((a, b) => a.t - b.t);
  gridCache = { key, lines, spans };
  return gridCache;
}
function visibleGrid(G, w, dpr) {   // drop the finer levels when they would crowd (< 4 px apart)
  const per = w / vSpan();
  const gap = (lv) => { const ts = G.lines.filter((g) => g.level >= lv).map((g) => g.t); let m = Infinity; for (let i = 1; i < ts.length; i++) m = Math.min(m, ts[i] - ts[i - 1] || Infinity); return m * per; };
  const minLv = [0, 1, 2].find((lv) => gap(lv) >= 4 * dpr) ?? 2;
  return G.lines.filter((g) => g.level >= minLv);
}
function snapTime(t, w, dpr) {   // nearest visible grid line of the chosen unit
  const vis = visibleGrid(timeGrid(), w, dpr); let best = t, bd = Infinity;
  for (const g of vis) { const d = Math.abs(g.t - t); if (d < bd) { bd = d; best = g.t; } }
  return clamp(best, 0, S.dur);
}
function unitReadout(t) {
  if (S.unit === 'frame') return `f ${Math.round(t * FPS)}`;
  if (S.unit === 'cycle' && cur) return `bar ${(clipTime(t) / cur.dur + 1).toFixed(2)}`;
  if (S.unit === 'step') { const G = timeGrid(), on = G.spans.filter((sp) => t >= sp.t0 && t <= sp.t1).map((sp) => sp.S); const n = G.lines.filter((g) => g.S && g.t <= t + 1e-6).length; return `step ${n}${on.length ? ' · ' + on.join('+') + ' down' : ' · airborne'}`; }
  return '';
}
$('unitSel').onchange = () => { S.unit = $('unitSel').value; gridCache = null; layoutLanes(); trailDirty = true; save(); };
$('btnMagnet').onclick = () => { S.magnet = !S.magnet; $('btnMagnet').setAttribute('aria-pressed', S.magnet); trailDirty = true; save(); };

function scrub(e) { const b = ruler.getBoundingClientRect(); S.t = clamp(tOfDisp(S.v0 + clamp((e.clientX - b.left) / timeAreaCss(), 0, 1) * vSpan()), 0, S.dur); }
ruler.addEventListener('pointerdown', (e) => { rulerDrag = true; ruler.setPointerCapture(e.pointerId); scrub(e); });
function placePlayhead() {
  const tl = document.querySelector('.tl').getBoundingClientRect(), rb = ruler.getBoundingClientRect();
  const f = (dispOf(S.t) - S.v0) / vSpan();
  playhead.hidden = f < -0.001 || f > 1.001;
  playhead.style.left = (rb.left - tl.left + f * timeAreaCss() - 1) + 'px';
}
// resizable timeline
const grip = $('grip'); let gripDrag = false;
grip.addEventListener('pointerdown', (e) => { gripDrag = true; grip.setPointerCapture(e.pointerId); });
function resizeTimeline(e) { const h = clamp(window.innerHeight - e.clientY - 3, 120, window.innerHeight - 220); $('app').style.setProperty('--tl-h', h + 'px'); resize(); }
grip.addEventListener('keydown', (e) => { const cs = parseFloat(getComputedStyle(document.querySelector('.tl')).height); if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); $('app').style.setProperty('--tl-h', clamp(cs + (e.key === 'ArrowUp' ? 30 : -30), 120, window.innerHeight - 220) + 'px'); resize(); } });
