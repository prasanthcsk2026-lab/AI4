
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
  if (A.showMaster.move) addTrackRow('move', SPEC.move, () => A.move, (p) => { A.move = p; }, 'Moving speed <i>ground covered</i>', null);
  if (A.showMaster.cycle) {
    addTrackRow('cyc', SPEC.cyc, () => A.cyc, (p) => { A.cyc = p; }, 'Cycle speed <i>% · 150 = faster</i>', null);
    addBarsRow();
  }
  if (A.showMaster.gnd) addTrackRow('gnd', SPEC.gnd, () => A.gnd, (p) => { A.gnd = p; }, 'Foot on ground <i>+% of cycle · braking</i>', null);
  // symmetrize (one side follows the other, mirrored, half a cycle later)
  for (const k of A.symOrder) {
    const sy = A.sym[k]; if (!sy) continue;
    const hr = mkRow('bone sym'); Object.assign(hr, { kind: 'sym', sym: k });
    hr.h.innerHTML = `<button type="button" class="mini" data-act="fold" aria-expanded="${!sy.collapsed}">${sy.collapsed ? '▸' : '▾'}</button><span class="symtag">SYM</span><span class="name"></span><button type="button" class="mini" data-act="del" title="Remove">×</button>`;
    hr.h.querySelector('.name').textContent = symLabel(k);
    hr.h.querySelector('[data-act="fold"]').onclick = () => { sy.collapsed = !sy.collapsed; rebuildRows(); save(); };
    hr.h.querySelector('[data-act="del"]').onclick = () => confirmDelete(`Remove "${symLabel(k)}" and its tracks?`, () => { pushUndo(); delete A.sym[k]; A.symOrder = A.symOrder.filter((x) => x !== k); rebuildRows(); save(); });
    hr.h.oncontextmenu = (ev) => { ev.preventDefault(); if (rightDouble('s|' + k)) hr.h.querySelector('[data-act="del"]').click(); };
    hr.lane.innerHTML = '<div class="summary"></div>'; hr.lane.firstChild.textContent = 'The target side copies the other side\'s clip motion from the cycle split away (50 % = half a cycle), mirrored. Weight 100 % = fully symmetric. Watch the step times in the viewport.';
    tracksEl.append(hr.el); rows.push(hr);
    sy.show = sy.show || { weight: true, offset: true };
    if (!sy.collapsed) {
      if (sy.show.weight !== false) addTrackRow(`s|${k}|weight`, { ...SPEC.whole, range: [0, 1], color: '#e58ad6' }, () => sy.weight, (p) => { sy.weight = p; }, 'Symmetry <i>weight</i>', { type: 'sym', id: k });
      if (sy.show.offset !== false) addTrackRow(`s|${k}|offset`, { ...SPEC.whole, range: [0.3, 0.7], ref: 0.5, color: '#c98bd6', snap: 0.005 }, () => sy.offset, (p) => { sy.offset = p; }, 'Cycle split <i>50 % = even steps</i>', { type: 'sym', id: k });
    }
  }
  // groups (weights multiply into every bone they hold)
  for (const gid of A.groupOrder) {
    const g = A.groups[gid]; if (!g) continue;
    if (g.mirrorOf) continue;   // the linked twin lives in its source's row
    const hr = mkRow('bone grp' + (isSelRow('group', gid) ? ' selected' : ''));
    Object.assign(hr, { kind: 'group', group: gid });
    hr.el.dataset.group = gid;
    hr.h.innerHTML = `<button type="button" class="mini" data-act="fold" aria-expanded="${!g.collapsed}" title="Show / hide tracks">${g.collapsed ? '▸' : '▾'}</button><span class="grptag">GRP</span><span class="name" title="Select (highlights its bones) · right-click for options"></span>${g.mirror ? '<span class="mirtag" title="Both sides: every edit applies to left and right">⇄ L+R</span>' : ''}<button type="button" class="mini" data-act="del" title="Remove this group from the timeline">×</button>`;
    hr.h.querySelector('.name').textContent = g.mirror ? sideless(groupLabel(gid)) : groupLabel(gid);
    hr.h.querySelector('[data-act="fold"]').onclick = () => { g.collapsed = !g.collapsed; rebuildRows(); save(); };
    hr.h.querySelector('[data-act="del"]').onclick = () => removeGroup(gid);
    hr.h.querySelector('.name').onclick = () => selectGroup(gid);
    hr.h.oncontextmenu = (ev) => { ev.preventDefault(); if (rightDouble('g|' + gid)) removeGroup(gid); else openGroupMenu(ev, gid); };
    hr.lane.innerHTML = '<div class="summary"></div>'; hr.lane.firstChild.textContent = groupSummary(gid);
    tracksEl.append(hr.el); rows.push(hr);
    if (g.collapsed) continue;
    const own = { type: 'group', id: gid };
    if (g.show.weight) addTrackRow(`g|${gid}|weight`, { ...SPEC.whole, color: COL.group }, () => g.weight, (p) => { g.weight = p; }, 'Group weight <i>× its bones</i>', own);
    if (g.show.timing) addTrackRow(`g|${gid}|timing`, SPEC.timing, () => g.timing, (p) => { g.timing = p; }, 'Group timing <i>phase %</i>', own);
  }
  // FK bones
  for (const name of A.order) {
    const ba = A.bones[name]; if (!ba) continue;
    if (ba.mirrorOf) continue;
    const hr = mkRow('bone' + (isSelRow('bone', name) ? ' selected' : ''));
    Object.assign(hr, { kind: 'bone', bone: name });
    hr.el.dataset.bone = name;
    const mtag = ba.mirror ? ' <span class="mirtag" title="Both sides: every edit applies to left and right">⇄ L+R</span>' : '';
    const chain = mtag + (ba.withChildren ? ' <span class="mini tag" title="Multiplies into every descendant bone">⛓ children</span>' : '');
    hr.h.innerHTML = `<button type="button" class="mini" data-act="fold" aria-expanded="${!ba.collapsed}" title="Show / hide tracks">${ba.collapsed ? '▸' : '▾'}</button><span class="name" title="Select in the viewport · right-click for options"></span>${chain}<button type="button" class="mini" data-act="del" title="Remove this bone from the timeline">×</button>`;
    hr.h.querySelector('.name').textContent = ba.mirror ? sideless(name) : name;
    hr.h.querySelector('[data-act="fold"]').onclick = () => { ba.collapsed = !ba.collapsed; rebuildRows(); save(); };
    hr.h.querySelector('[data-act="del"]').onclick = () => removeBone(name);
    hr.h.querySelector('.name').onclick = () => selectBone(name);
    hr.h.oncontextmenu = (e) => { e.preventDefault(); if (rightDouble('b|' + name)) removeBone(name); else openBoneMenu(e, name); };
    hr.lane.innerHTML = '<div class="summary"></div>'; hr.lane.firstChild.textContent = boneSummary(ba);
    tracksEl.append(hr.el); rows.push(hr);
    if (ba.collapsed) continue;
    const lab = axisInfo[name] || {}, sw = ba.show || { whole: true }, own = { type: 'bone', name };
    const k = (s) => `b|${name}|${s}`;
    if (sw.whole) addTrackRow(k('whole'), SPEC.whole, () => ba.whole, (p) => { ba.whole = p; }, 'Whole bone <i>weight</i>', own);
    for (const a of AXES) if (sw['w' + a]) addTrackRow(k('w' + a), SPEC.w, () => ba.w[a], (p) => { ba.w[a] = p; }, `<b class="axl" style="color:${AXIS_COL[a]}">${a.toUpperCase()}</b> weight <i>${lab[a] ? lab[a].short : ''}</i>`, { ...own, axis: a });
    for (const a of AXES) if (sw['a' + a]) addTrackRow(k('a' + a), SPEC.a, () => ba.a[a], (p) => { ba.a[a] = p; }, `<b class="axl" style="color:${AXIS_COL[a]}">${a.toUpperCase()}</b> adjust <i>${lab[a] ? lab[a].short : ''}</i>`, { ...own, axis: a });
    if (sw.timing) addTrackRow(k('timing'), SPEC.timing, () => ba.timing, (p) => { ba.timing = p; }, 'Timing offset <i>phase %</i>', own);
  }
  // IK effectors: the built-in ones, then the custom controllers in their own section
  const ikIds = A.ikOrder.filter((id) => EFF_BY_ID[id] && !EFF_BY_ID[id].custom).concat(A.ikOrder.filter((id) => EFF_BY_ID[id] && EFF_BY_ID[id].custom));
  let customHead = false;
  for (const id of ikIds) {
    const e = A.ik[id], d = EFF_BY_ID[id]; if (!e || !d) continue;
    if (e.mirrorOf) continue;
    if (d.custom && !customHead) { customHead = true; const sh = document.createElement('div'); sh.className = 'tlsec'; sh.textContent = 'Custom IK controllers'; tracksEl.append(sh); }
    const hr = mkRow('bone eff' + (isSelRow('eff', id) ? ' selected' : ''));
    Object.assign(hr, { kind: 'eff', eff: id });
    hr.el.dataset.eff = id;
    hr.h.innerHTML = `<button type="button" class="mini" data-act="fold" aria-expanded="${!e.collapsed}" title="Show / hide tracks">${e.collapsed ? '▸' : '▾'}</button><span class="iktag${d.custom ? ' cust' : ''}">${d.custom ? 'IK CUST' : d.kind === 'igroup' ? 'IK GRP' : 'IK'}</span><span class="name" title="Select in the viewport · right-click for options"></span>${e.mirror ? '<span class="mirtag" title="Both sides: every edit applies to left and right">⇄ L+R</span>' : ''}<button type="button" class="mini" data-act="del" title="Remove this effector from the timeline">×</button>`;
    hr.h.querySelector('.name').textContent = e.mirror ? sideless(d.label) : d.label;
    hr.h.querySelector('[data-act="fold"]').onclick = () => { e.collapsed = !e.collapsed; rebuildRows(); save(); };
    hr.h.querySelector('[data-act="del"]').onclick = () => removeEff(id);
    hr.h.querySelector('.name').onclick = () => selectEff(id);
    hr.h.oncontextmenu = (ev) => { ev.preventDefault(); if (rightDouble('e|' + id)) removeEff(id); else openEffMenu(ev, id); };
    hr.lane.innerHTML = '<div class="summary"></div>'; hr.lane.firstChild.textContent = effSummary(id);
    tracksEl.append(hr.el); rows.push(hr);
    if (e.collapsed) continue;
    for (const k of d.tracks) {
      if (!e.show[k]) continue;
      const T = TRK[k], axl = T.axis ? `<b class="axl" style="color:${AXIS_COL[T.axis]}">${T.axis.toUpperCase()}</b> ` : '';
      const info = T.kind ? worldAxisInfo(T.kind)[T.axis].short : (T.hint || '');
      addTrackRow(`e|${id}|${k}`, effSpec(k), () => e.tr[k], (p) => { e.tr[k] = p; }, `${axl}${T.kind ? (T.kind === 'p' ? 'Move' : 'Rotate') : T.label} <i>${info}</i>`, { type: 'eff', id, k });
    }
  }
  if (!rows.length) {
    const e = document.createElement('div'); e.className = 'empty';
    e.textContent = 'Nothing on the timeline yet. Add a group, bone or IK effector on the left; the "i" button explains how the timeline works.';
    tracksEl.append(e);
  }
  if (window.__slRebuildTree) window.__slRebuildTree();
  layoutLanes();
}
// the bar reach row: one cell per quarter-bar segment; click to type how much faster (+) or slower (−) it is
function addBarsRow() {
  const r = mkRow('track bars', 'bars'); Object.assign(r, { kind: 'bars' });
  r.h.innerHTML = '<span class="sw" style="background:#f5a3ff"></span><span class="name">Bar reach <i>% per quarter bar</i></span><div class="rz"></div>';
  r.h.title = 'Click a segment to set how much faster (+) or slower (−) it is; the change carries on until the next one (they multiply). Right-click for options.';
  const rz = r.h.querySelector('.rz');
  rz.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); rz.setPointerCapture(e.pointerId); rowDrag = { r, y0: e.clientY, h0: rowHeight(r) }; });
  r.el.style.height = rowHeight(r) + 'px';
  const cv = document.createElement('canvas'); r.cv = cv; r.lane.append(cv);
  const segAt = (e) => { const [px] = evXY(r, e); return Math.floor(clipTime(tOf(r, px)) / segLen()); };
  cv.addEventListener('click', (e) => openBarEdit(segAt(e), e));
  cv.addEventListener('pointermove', (e) => { const q = segAt(e), v = A.barSpeed[q] || 0; tip(e, `bar ${Math.floor(q / 4) + 1} · .${q % 4}→${q % 4 === 3 ? 'next bar' : '.' + (q % 4 + 1)}: ${v >= 0 ? '+' : ''}${v}% · speed ×${segMulTable(q)[q].toFixed(3)}`); });
  cv.addEventListener('pointerleave', () => tip(null));
  cv.addEventListener('contextmenu', (e) => { e.preventDefault(); const q = segAt(e); if (rightDouble('bars#' + q)) { if (A.barSpeed[q]) confirmDelete(`Reset bar ${Math.floor(q / 4) + 1} .${q % 4} to 0 %?`, () => { pushUndo(); delete A.barSpeed[q]; barsEdited(); }, 'Reset'); return; } openMenu(e.clientX, e.clientY, [
    { label: 'Set this segment…', action: () => openBarEdit(q, e) },
    { label: 'Reset this segment', disabled: !A.barSpeed[q], action: () => confirmDelete(`Reset bar ${Math.floor(q / 4) + 1} .${q % 4} to 0 %?`, () => { pushUndo(); delete A.barSpeed[q]; barsEdited(); }, 'Reset') },
    { label: 'Clear all bar speeds', disabled: !Object.keys(A.barSpeed).length, action: () => confirmDelete('Clear every bar reach value?', () => { pushUndo(); A.barSpeed = {}; barsEdited(); }, 'Clear') },
  ]); });
  tracksEl.append(r.el); rows.push(r);
}
// ---------------------------------------------------------------- "+" menu: the optional master tracks
$('btnAddMaster').onclick = (e) => {
  const b = e.currentTarget.getBoundingClientRect(), tog = (k) => () => { A.showMaster[k] = !A.showMaster[k]; rebuildRows(); save(); };
  openMenu(b.left, b.bottom + 4, [
    { label: 'Playback speed (cadence)', checked: !!A.showMaster.speed, action: tog('speed') },
    { label: 'Moving speed (ground covered)', checked: !!A.showMaster.move, action: tog('move') },
    { label: 'Cycle speed + bar reach', checked: !!A.showMaster.cycle, action: tog('cycle') },
    { label: 'Foot on ground (braking)', checked: !!A.showMaster.gnd, action: tog('gnd') },
    { label: 'Template: Sprint → Jog (decelerate)…', action: openTemplate },
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
    const rb = ruler.getBoundingClientRect(), f = clamp((e.clientX - rb.left) / rb.width, 0, 1), c = S.v0 + f * vSpan();
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

function barsEdited() { pinPointsToBar(null); layoutLanes(); trailDirty = true; save(); }
function drawBars(r) {
  const cv = r.cv, x = cv.getContext('2d'), w = cv.width, h = cv.height, dpr = dprOf(r), sl = segLen();
  x.clearRect(0, 0, w, h); x.fillStyle = '#1d1a20'; x.fillRect(0, 0, w, h);
  if (!S.speedLUT || !cur) return;
  const total = S.speedLUT[S.speedLUT.length - 1], qMax = Math.ceil(total / sl), cum = segMulTable(qMax);
  x.font = `600 ${10 * dpr}px "IBM Plex Mono", monospace`; x.textBaseline = 'middle'; x.textAlign = 'center';
  for (let q = 0; q < qMax; q++) {
    const a = xOf(r, timeOfClipTime(q * sl)), b = xOf(r, timeOfClipTime(Math.min(total, (q + 1) * sl)));
    if (b < 0 || a > w) continue;
    const v = A.barSpeed[q] || 0, m = cum[q];
    x.fillStyle = v ? (v > 0 ? 'rgba(245,163,255,.28)' : 'rgba(120,180,255,.25)') : (Math.floor(q / 4) % 2 ? '#221e25' : '#1d1a20');
    x.fillRect(a, 0, b - a, h);
    x.fillStyle = q % 4 === 0 ? '#5b4e61' : '#3a3240'; x.fillRect(Math.round(a), 0, 1, h);
    if (b - a > 34 * dpr) {
      x.fillStyle = v ? '#f5d6ff' : '#6f6477'; x.fillText((v > 0 ? '+' : '') + v + '%', (a + b) / 2, h * (Math.abs(m - 1) > 1e-6 ? 0.36 : 0.5));
      if (Math.abs(m - 1) > 1e-6) { x.fillStyle = '#b08fbd'; x.fillText('×' + m.toFixed(2), (a + b) / 2, h * 0.72); }
    }
  }
  x.textAlign = 'left';
}
function openBarEdit(q, e) {
  const box = $('numEdit'); numTarget = { bars: q };
  $('numTL').hidden = true; $('numV').value = A.barSpeed[q] || 0; $('numV').step = 1; $('numVL').textContent = `bar ${Math.floor(q / 4) + 1} .${q % 4} → +/− %`;
  box.hidden = false;
  const bw = box.offsetWidth || 260;
  box.style.left = clamp(e.clientX - bw / 2, 8, window.innerWidth - bw - 8) + 'px'; box.style.top = clamp(e.clientY - 70, 8, window.innerHeight - 60) + 'px';
  $('numV').focus(); $('numV').select();
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
    if (hit != null) openMenu(e.clientX, e.clientY, [{ label: 'Delete point (or right double-click)', action: () => deletePoint(r, hit) }, { label: 'Type its value…', action: () => openNumEdit(r, hit, e) }]);
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
  if (r.kind === 'bars') { const dpr = Math.min(2, window.devicePixelRatio || 1), w = r.lane.clientWidth || 300, h = Math.max(10, rowHeight(r) - 2); r.cv.width = Math.round(w * dpr); r.cv.height = Math.round(h * dpr); r.cv.style.width = w + 'px'; r.cv.style.height = h + 'px'; drawBars(r); return; }
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = r.lane.clientWidth || 300, h = Math.max(10, rowHeight(r) - 1);
  r.cv.width = Math.round(w * dpr); r.cv.height = Math.round(h * dpr); r.cv.style.width = w + 'px'; r.cv.style.height = h + 'px';
  drawLane(r);
}
function layoutLanes() { for (const r of rows) layoutLane(r); drawRuler(); placePlayhead(); }
// geometry
const viewOf = (r) => A.zoom[r.key] || r.range;
const dprOf = (r) => r.cv.width / Math.max(1, r.cv.clientWidth || r.lane.clientWidth || 1);
// the visible time window (horizontal zoom / scroll): S.v0 … S.v1 seconds
const vSpan = () => Math.max(1e-3, S.v1 - S.v0);
// Display axis. Realtime bars on: real seconds. Off: "bar space" — the axis follows the bars, so every bar is the
// same width however cycle speed / bar reach change the timing, and feet and curves stay lined up with the bars.
// A display coordinate d is the nominal time (playback speed only) at which the clip reaches the same clip time.
// While a timing point (playback / moving / cycle speed, foot on ground) is dragged the view is frozen: the bars,
// grid and ruler keep their place and the character previews the new timing; the layout updates on release.
let viewFreeze = null;
const TIMING_KEYS = new Set(['speed', 'move', 'cyc', 'gnd']);
// Playback speed and cycle speed (with bar reach) are what turn clip time into real seconds — a "bar" is a fixed
// point in clip time, not in real seconds. Editing either one moves where the bars land in real time; every other
// point, on every other track, is re-timed here so it lands on the same clip time as before — it stays on its bar.
const BAR_DRIVERS = new Set(['speed', 'cyc']);
function allPointArrays() {
  const out = [A.speed, A.move, A.cyc, A.gnd];
  for (const n of A.order) { const ba = A.bones[n]; out.push(ba.whole, ba.timing, ba.w.x, ba.w.y, ba.w.z, ba.a.x, ba.a.y, ba.a.z); }
  for (const gid of A.groupOrder) { const g = A.groups[gid]; out.push(g.weight, g.timing); }
  for (const id of A.ikOrder) { const e = A.ik[id]; for (const k in e.tr) out.push(e.tr[k]); }
  for (const k of A.symOrder) { const sy = A.sym[k]; out.push(sy.weight, sy.offset); }
  return out;
}
function pinPointsToBar(exceptArr) {
  if (!cur || !S.speedLUT) { rebuildSpeedLUT(); return; }
  const arrs = allPointArrays().filter((a) => a !== exceptArr);
  // a point sitting exactly at the track's end is its end anchor (every track's last point sits at S.dur by
  // convention), not "placed on a bar" — it stays at S.dur rather than following a clip time that may now fall
  // short of (or past) the timeline's own length
  const snap = arrs.map((pts) => pts.map((p) => (p.t >= S.dur - 1e-6 ? null : clipTime(p.t))));
  rebuildSpeedLUT();
  arrs.forEach((pts, i) => {
    pts.forEach((p, j) => { p.t = snap[i][j] == null ? S.dur : clamp(timeOfClipTime(snap[i][j]), 0, S.dur); });
    pts.sort((a, b) => a.t - b.t);
  });
}
const vLut = () => (viewFreeze ? viewFreeze.lut : S.speedLUT), vNom = () => (viewFreeze ? viewFreeze.nom : S.speedLUTNom);
function freezeView() { if (!viewFreeze) viewFreeze = { lut: S.speedLUT.slice(), nom: S.speedLUTNom.slice(), grid: timeGrid(), bs: barSpace() }; }
function thawView() { if (!viewFreeze) return; viewFreeze = null; gridCache = null; rebuildSpeedLUT(); layoutLanes(); }
function barSpace() { if (viewFreeze) return viewFreeze.bs; return !S.realtime && S.speedLUTNom && S.speedLUT && Math.abs(S.speedLUT[S.speedLUT.length - 1] - S.speedLUTNom[S.speedLUTNom.length - 1]) + Object.keys(A.barSpeed || {}).length > 1e-6; }
function lutAt(lut, t) { const f = clamp(t / S.dur, 0, 1) * (lut.length - 1), i = Math.min(Math.floor(f), lut.length - 2); return lerp(lut[i], lut[i + 1], f - i); }
function dispOf(t) { return barSpace() ? timeOfClipTime(lutAt(vLut(), t), vNom(), true) : t; }
function tOfDisp(d) { return barSpace() ? timeOfClipTime(lutAt(vNom(), d), vLut()) : d; }
function dispDur() { return barSpace() ? dispOf(S.dur) : S.dur; }
const xT = (t, w) => ((dispOf(t) - S.v0) / vSpan()) * w;
function xOf(r, t) { return xT(t, r.cv.width); }
function tOf(r, x) { return clamp(tOfDisp(S.v0 + (x / r.cv.width) * vSpan()), 0, S.dur); }
function yOf(r, v) { const [lo, hi] = viewOf(r), h = r.cv.height, p = PAD * dprOf(r); return p + (1 - (v - lo) / (hi - lo)) * (h - 2 * p); }
function vOfRaw(r, y) { const [lo, hi] = viewOf(r), h = r.cv.height, p = PAD * dprOf(r); return lo + (1 - (y - p) / (h - 2 * p)) * (hi - lo); }
function vOf(r, y) { return clamp(vOfRaw(r, y), r.range[0], r.range[1]); }
function niceStep(span, n) { const raw = span / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; }
function drawLane(r) {
  if (r.kind === 'bars') return drawBars(r);
  const cv = r.cv, x = cv.getContext('2d'), w = cv.width, h = cv.height, dpr = dprOf(r), pts = r.get();
  x.clearRect(0, 0, w, h);
  x.fillStyle = rows.indexOf(r) % 2 ? '#1b201d' : '#1f2522'; x.fillRect(0, 0, w, h);
  // time grid in the chosen unit (seconds, frames, clip cycles or foot steps)
  const G = timeGrid();
  if (S.unit === 'step') for (const sp of G.spans) { x.fillStyle = sp.S === 'L' ? 'rgba(201,139,214,.09)' : 'rgba(255,138,74,.08)'; const a = xOf(r, sp.t0), b = xOf(r, sp.t1); x.fillRect(a, 0, Math.max(1, b - a), h); x.fillStyle = sp.S === 'L' ? 'rgba(201,139,214,.55)' : 'rgba(255,138,74,.55)'; x.fillRect(a, sp.S === 'L' ? h - 3 * dpr : h - 6 * dpr, Math.max(1, b - a), 2 * dpr); }
  for (const g of visibleGrid(G, w, dpr)) { x.fillStyle = g.S ? (g.S === 'L' ? '#5a4460' : '#65452f') : g.level === 2 ? '#34403a' : g.level === 1 ? '#2b3430' : '#232a26'; x.fillRect(Math.round(xOf(r, g.t)) + 0.5, 0, 1, h); }
  // foot landings: a line in the foot's colour
  for (const [t, Sd] of footMarks()) { const px = Math.round(xOf(r, t)); if (px < -2 || px > w + 2) continue; x.fillStyle = Sd === 'L' ? 'rgba(201,139,214,.75)' : 'rgba(255,138,74,.75)'; x.fillRect(px, 0, Math.max(1, Math.round(dpr)), h); }
  // value grid with labels once the track is tall enough
  const [lo, hi] = viewOf(r), cssH = h / dpr;
  if (cssH >= 56) {
    const st = niceStep((hi - lo) * r.scale, cssH / 26) / r.scale;
    x.font = `500 ${10 * dpr}px "IBM Plex Mono", monospace`; x.textBaseline = 'middle';
    for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) {
      const gy = Math.round(yOf(r, v)) + 0.5; x.fillStyle = '#29322d'; x.fillRect(0, gy, w, 1);
      x.fillStyle = '#6d7872'; x.fillText(+(v * r.scale).toFixed(4) + '', 4 * dpr, gy - 6 * dpr);
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
  for (const p of pts) { x.beginPath(); x.arc(xOf(r, p.t), yOf(r, p.v), 4 * dpr, 0, Math.PI * 2); x.fillStyle = '#111513'; x.fill(); x.strokeStyle = r.color; x.lineWidth = 1.6 * dpr; x.stroke(); }
  // selection ring + box-select rectangle
  if (r === selRow && selPts.size) for (const i of selPts) { const p = pts[i]; if (!p) continue; x.beginPath(); x.arc(xOf(r, p.t), yOf(r, p.v), 6.5 * dpr, 0, Math.PI * 2); x.strokeStyle = '#ffffff'; x.lineWidth = dpr; x.stroke(); }
  x.restore();
  if (boxSel && boxSel.r === r) { x.save(); x.strokeStyle = 'rgba(255,255,255,.55)'; x.setLineDash([3 * dpr, 3 * dpr]); x.strokeRect(Math.min(boxSel.x0, boxSel.x1), Math.min(boxSel.y0, boxSel.y1), Math.abs(boxSel.x1 - boxSel.x0), Math.abs(boxSel.y1 - boxSel.y0)); x.restore(); }
  if (zoomed) { x.font = `600 ${10 * dpr}px "Barlow", sans-serif`; x.textBaseline = 'top'; x.textAlign = 'right'; x.fillStyle = 'rgba(240,138,28,.8)'; x.fillText(`zoom ${+(lo * r.scale).toFixed(2)}…${+(hi * r.scale).toFixed(2)}`, w - 4 * dpr, 3 * dpr); x.textAlign = 'left'; }
}
function evXY(r, e) { const b = r.cv.getBoundingClientRect(), k = r.cv.width / b.width; return [(e.clientX - b.left) * k, (e.clientY - b.top) * k, k]; }
function hitPoint(r, e) { const [px, py, k] = evXY(r, e), pts = r.get(); let best = null, bd = 8 * k; pts.forEach((p, i) => { const d = Math.hypot(xOf(r, p.t) - px, yOf(r, p.v) - py); if (d < bd) { bd = d; best = i; } }); return best; }
function hitRing(r, e) { const [px, py, k] = evXY(r, e), pts = r.get(); for (let i = 0; i < pts.length - 1; i++) { const tm = (pts[i].t + pts[i + 1].t) / 2; if (Math.hypot(xOf(r, tm) - px, yOf(r, evalPts(pts, tm)) - py) < 7 * k) return i; } return null; }
function deletePoint(r, i) { const pts = r.get(); if (pts.length <= 1) return; confirmDelete(`Delete this point (${pts[i].t.toFixed(2)} s, ${r.fmt(pts[i].v)}) from ${trackName(r)}?`, () => { pushUndo(); pts.splice(i, 1); edited(r); }); }
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
  drag = { r, i };
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
  const [px, py] = evXY(r, e), p = pts[drag.i];
  let t = tOf(r, px), v = vOf(r, py);
  if (S.magnet || e.ctrlKey || e.metaKey) t = snapTime(t, r.cv.width, dprOf(r));   // magnet: stick to the unit's lines
  if (e.ctrlKey || e.metaKey) v = Math.round(v / r.snap) * r.snap;
  if (r.flag) v = v >= 0.5 ? 1 : 0;
  const lo = drag.i > 0 ? pts[drag.i - 1].t : 0, hi = drag.i < pts.length - 1 ? pts[drag.i + 1].t : S.dur;
  p.t = clamp(t, lo, hi); p.v = clamp(v, r.range[0], r.range[1]);
  edited(r, true); tip(e, `${p.t.toFixed(3)} s · ${r.fmt(p.v)}`);
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
  if (drag) { const r = drag.r; drag = null; tip(null); edited(r); }
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
  if (live) syncMirrors();
  if (TIMING_KEYS.has(r.key)) {
    const bar = BAR_DRIVERS.has(r.key);
    if (live) { freezeView(); if (bar) pinPointsToBar(r.get()); else rebuildSpeedLUT(); drawLane(r); }   // preview the timing; the layout waits for release
    else { viewFreeze = null; if (bar) pinPointsToBar(r.get()); else rebuildSpeedLUT(); gridCache = null; layoutLanes(); }
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
  $('numT').value = (p ? p.t : S.t).toFixed(3);
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
  if (numTarget.bars != null) {   // a bar reach segment
    const q = numTarget.bars, v = clamp(Math.round((parseFloat($('numV').value) || 0) * 10) / 10, -90, 400);
    pushUndo(); if (v) A.barSpeed[q] = v; else delete A.barSpeed[q];
    closeNumEdit(); barsEdited(); return;
  }
  const { r, i } = numTarget, pts = r.get();
  const t = clamp(parseFloat($('numT').value), 0, S.dur), raw = parseFloat($('numV').value);
  if (!isFinite(t) || !isFinite(raw)) { closeNumEdit(); return; }
  let v = clamp(raw / r.scale, r.range[0], r.range[1]); if (r.flag) v = v >= 0.5 ? 1 : 0;
  pushUndo();
  if (i != null && pts[i]) { const p = pts.splice(i, 1)[0]; p.v = v; p.t = t; let at = pts.findIndex((q) => q.t > t); if (at < 0) at = pts.length; pts.splice(at, 0, p); }
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
  const to = mirrorEffId(id);
  openMenu(e.clientX, e.clientY, [
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
function trackName(r) { const el = r.h.querySelector('.name'); const own = r.owner ? (r.owner.type === 'bone' ? r.owner.name : r.owner.type === 'eff' ? EFF_BY_ID[r.owner.id].label : r.owner.type === 'group' ? groupLabel(r.owner.id) : symLabel(r.owner.id)) : ''; return `"${el ? el.textContent.trim() : r.key}"${own ? ' of ' + own : ''}`; }
function deleteTrack(r) {
  const o = r.owner, last = (o && o.type === 'bone' && Object.values(A.bones[o.name].show).filter(Boolean).length === 1) || (o && o.type === 'eff' && Object.values(A.ik[o.id].show).filter(Boolean).length === 1) || (o && o.type === 'group' && Object.values(A.groups[o.id].show).filter(Boolean).length === 1);
  confirmDelete(`Delete the track ${trackName(r)}? Its automation is cleared.${last ? ' It is the last track, so the item leaves the timeline too.' : ''}`, () => deleteTrackNow(r));
}
function deleteTrackNow(r) {
  pushUndo();
  r.set(flat(r.ref, S.dur));
  const part = r.key.split('|'), last = part[part.length - 1], o = r.owner;
  if (!o) {   // master tracks
    if (r.key === 'speed') A.showMaster.speed = false; else if (r.key === 'move') A.showMaster.move = false;
    else if (r.key === 'cyc') { A.showMaster.cycle = false; A.barSpeed = {}; }
    else if (r.key === 'gnd') A.showMaster.gnd = false;
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
  for (const p of clipboard.data) { const np = { t: clamp(base + (p.t - t0), 0, S.dur), v: clamp(p.v, selRow.range[0], selRow.range[1]), k: p.k }; let at = pts.findIndex((q) => q.t > np.t); if (at < 0) at = pts.length; pts.splice(at, 0, np); }
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
  const keep = pts.filter((_, i) => !selPts.has(i));
  selRow.set(keep.length ? keep : flat(selRow.ref, S.dur));
  selPts = new Set(); edited(selRow);
}
function nudgeSelection(key, big) {
  if (!selRow || !selPts.size) return;
  pushUndo();
  const pts = selRow.get(), [lo, hi] = selRow.range;
  const dt = (big ? 0.1 : 0.01) * (key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0);
  const dv = (big ? 10 : 1) * selRow.snap * (key === 'ArrowUp' ? 1 : key === 'ArrowDown' ? -1 : 0);
  const moved = [...selPts].map((i) => pts[i]).filter(Boolean);
  for (const p of moved) { p.t = clamp(p.t + dt, 0, S.dur); p.v = clamp(p.v + dv, lo, hi); }
  pts.sort((a, b) => a.t - b.t); selPts = new Set(moved.map((p) => pts.indexOf(p))); edited(selRow);
}
function selectAllInFocusedLane() { if (!selRow) return; selPts = new Set(selRow.get().map((_, i) => i)); drawLane(selRow); }
function dialogsOpen() { return !$('confirmDlg').hidden || !$('sheet').hidden || !$('addDlg').hidden || !$('boneDlg').hidden || !$('bakeDlg').hidden || !$('helpDlg').hidden; }
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
  x.fillStyle = '#181d1a'; x.fillRect(0, 0, W, H);
  x.font = `500 ${11 * dpr}px "IBM Plex Mono", monospace`; x.textBaseline = 'top';
  const G = timeGrid(), vis = visibleGrid(G, W, dpr);
  if (S.unit === 'step') for (const sp of G.spans) { x.fillStyle = sp.S === 'L' ? 'rgba(201,139,214,.28)' : 'rgba(255,138,74,.25)'; const a = xT(sp.t0, W - 1), b = xT(sp.t1, W - 1); x.fillRect(a, sp.S === 'L' ? H * 0.62 : H * 0.8, Math.max(1, b - a), H * 0.14); }
  const taken = [];   // labels: the major ones first, then the rest where they fit
  for (const g of vis) {
    const px = Math.round(xT(g.t, W - 1)) + 0.5;
    x.fillStyle = g.S ? (g.S === 'L' ? COL.timing : '#ff8a4a') : g.level === 2 ? '#7d8882' : g.level === 1 ? '#56615b' : '#3a443f';
    x.fillRect(px, g.level === 2 ? H * 0.45 : g.level === 1 ? H * 0.6 : H * 0.72, 1, H);
  }
  for (const pass of [2, 1, 0]) for (const g of vis) {
    if (g.level !== pass || !g.label || g.t >= S.dur - 1e-6) continue;
    const px = Math.round(xT(g.t, W - 1)) + 0.5, a0 = px + 4 * dpr, a1 = a0 + x.measureText(g.label).width + 6 * dpr;
    if (a1 < 0 || a0 > W || taken.some(([l, r]) => a0 < r && a1 > l)) continue;
    taken.push([a0, a1]);
    x.fillStyle = g.S ? (g.S === 'L' ? COL.timing : '#ff8a4a') : pass === 2 ? '#d4dbd6' : '#8d9892';
    x.fillText(g.label, a0, 5 * dpr);
  }
  // clip cycle marks (where one loop / move of the clip ends, at the current speeds)
  if (cur && vLut()) { x.fillStyle = 'rgba(240,138,28,.55)'; let n = 1; const lut = vLut(); for (let i = 1; i < lut.length; i++) { if (lut[i] >= n * cur.dur) { x.fillRect(Math.round(xT((i / (lut.length - 1)) * S.dur, W - 1)), H - 6 * dpr, 2, 6 * dpr); n++; } } }
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
    // realtime: bar lines where the bars really fall (after bar reach / cycle speed); otherwise evenly spaced
    const lutG = S.speedLUT, total = lutG[lutG.length - 1];
    for (let q = 0; q / 8 * cur.dur <= total + 1e-9 && q < 4000; q++) lines.push({ t: timeOfClipTime(q / 8 * cur.dur, lutG), level: q % 8 === 0 ? 2 : q % 2 === 0 ? 1 : 0, label: q % 8 === 0 ? 'bar ' + (q / 8 + 1) : q % 2 === 0 ? '.' + (q % 8) / 2 : '' });
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

function scrub(e) { const b = ruler.getBoundingClientRect(); S.t = clamp(tOfDisp(S.v0 + clamp((e.clientX - b.left) / b.width, 0, 1) * vSpan()), 0, S.dur); }
ruler.addEventListener('pointerdown', (e) => { rulerDrag = true; ruler.setPointerCapture(e.pointerId); scrub(e); });
function placePlayhead() {
  const tl = document.querySelector('.tl').getBoundingClientRect(), rb = ruler.getBoundingClientRect();
  const f = (dispOf(S.t) - S.v0) / vSpan();
  playhead.hidden = f < -0.001 || f > 1.001;
  playhead.style.left = (rb.left - tl.left + f * rb.width - 1) + 'px';
}
// resizable timeline
const grip = $('grip'); let gripDrag = false;
grip.addEventListener('pointerdown', (e) => { gripDrag = true; grip.setPointerCapture(e.pointerId); });
function resizeTimeline(e) { const h = clamp(window.innerHeight - e.clientY - 3, 120, window.innerHeight - 220); $('app').style.setProperty('--tl-h', h + 'px'); resize(); }
grip.addEventListener('keydown', (e) => { const cs = parseFloat(getComputedStyle(document.querySelector('.tl')).height); if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); $('app').style.setProperty('--tl-h', clamp(cs + (e.key === 'ArrowUp' ? 30 : -30), 120, window.innerHeight - 220) + 'px'); resize(); } });
