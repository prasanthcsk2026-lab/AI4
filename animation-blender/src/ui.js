
// ============================================================================
//  WORKSPACE (Vegas-style): menu bar, main toolbar with the big time display, the options dock on the left
//  (30 % by default, resizable, sections remember open / closed), the viewport on the right, transport under the
//  timeline. Every menu item runs the same handler as its button, so nothing here owns any state of its own.
// ============================================================================
const UI_KEY = 'animBlender.ui.v1';
function uiPrefs() { try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}'); } catch { return {}; } }
function uiSave(p) { try { localStorage.setItem(UI_KEY, JSON.stringify({ ...uiPrefs(), ...p })); } catch { /* private window */ } }
const clickId = (id) => () => $(id).click();
const MENUS = {
  file: () => [
    { label: 'Import FBX animation…', action: clickId('btnImportAnim') },
    { label: 'Import automation (JSON)…', action: clickId('btnImport') },
    { sep: true },
    { label: 'Templates: save / open…', action: () => openTplLib() },
    { label: 'Bake / save to project…', action: clickId('btnBake') },
    { sep: true },
    { label: 'Export (JSON, glTF)…', action: clickId('btnExport') },
    { label: 'Export FBX (Symmetrize tool)…', action: clickId('btnSym') },
  ],
  edit: () => [
    { label: 'Undo  (Ctrl+Z)', disabled: !undoStack.length, action: () => { undo(); } },
    { label: 'Redo  (Ctrl+Y)', disabled: !redoStack.length, action: () => { redo(); } },
    { sep: true },
    { label: 'Reset clip (clear all automation)…', action: clickId('btnReset') },
  ],
  insert: () => [
    { label: 'Bars…', action: () => openBarsDlg(null) },
    { label: 'Bone track…', action: clickId('btnAddBone') },
    { label: 'Group…', action: clickId('btnAddGroup') },
    { label: 'IK effector / controller…', action: clickId('btnAddIK') },
    { sep: true },
    { label: 'Master tracks…', action: () => { const b = $('btnAddMaster').getBoundingClientRect(); $('btnAddMaster').dispatchEvent(new MouseEvent('click', { clientX: b.left, clientY: b.bottom })); } },
  ],
  tools: () => [
    { label: 'Symmetrize…', action: clickId('btnSym') },
    { label: 'Foot lock…', action: clickId('btnFootLock') },
    { label: 'Templates…', action: () => openTplLib() },
    { label: 'Template: Sprint → Jog…', action: () => openTemplate() },
    { label: 'Bake / Project…', action: clickId('btnBake') },
  ],
  view: () => [
    { label: 'Options panel', checked: !$('work').classList.contains('nodock'), action: () => toggleDock() },
    { sep: true },
    { label: 'Bones', checked: !!S.bones, action: clickId('btnBones') },
    { label: 'IK handles', checked: !!S.showIK, action: clickId('btnIK') },
    { label: 'Ghost (untouched clip)', checked: !!S.ghost, action: clickId('btnGhost') },
    { label: 'Joint limits', checked: !!S.limits, action: clickId('btnLimits') },
    { label: 'Trail', checked: !!S.trail, action: clickId('btnTrail') },
    { sep: true },
    { label: 'In place', checked: !!S.inPlace, action: clickId('btnInPlace') },
    { label: 'Camera follows', checked: !!S.follow, action: clickId('btnFollow') },
    { label: 'Realtime bars', checked: !!S.realtime, action: () => { const c = $('realtimeCb'); c.checked = !c.checked; c.dispatchEvent(new Event('change')); } },
    { label: 'Fit the timeline', action: clickId('btnFit') },
  ],
  help: () => [
    { label: 'How the timeline works', action: clickId('btnHelp') },
    { label: 'Keys: Space play · Q W E tools · K key · F frame · Ctrl+Z / Y', disabled: true },
  ],
};
for (const b of document.querySelectorAll('.mnu')) b.onclick = () => { const r = b.getBoundingClientRect(); openMenu(r.left, r.bottom + 2, MENUS[b.dataset.menu]()); };
$('tbUndo').onclick = () => undo();
$('tbRedo').onclick = () => redo();
$('tbTpl').onclick = () => openTplLib();
$('btnTplLib').onclick = () => openTplLib();
$('tbSym').onclick = clickId('btnSym');
$('tbFoot').onclick = clickId('btnFootLock');
// ---- dock: width (drag the divider), sections open / closed, a hide toggle; the Symmetrize tool docks in it
function setDockW(px) { const w = clamp(px, 220, Math.max(260, window.innerWidth * 0.6)); $('work').style.setProperty('--dock-w', w + 'px'); return w; }
function toggleDock(force) { const on = force ?? $('work').classList.contains('nodock'); $('work').classList.toggle('nodock', !on); uiSave({ dock: on }); }
{
  const p = uiPrefs();
  if (p.dockW) setDockW(p.dockW);
  if (p.dock === false) $('work').classList.add('nodock');
  for (const d of document.querySelectorAll('.dsec')) {
    const k = d.dataset.sec; if (p.sec && k in p.sec) d.open = p.sec[k];
    d.addEventListener('toggle', () => { const cur0 = uiPrefs().sec || {}; cur0[k] = d.open; uiSave({ sec: cur0 }); });
  }
  const g = $('dockGrip'); let dragging = false;
  g.addEventListener('pointerdown', (e) => { dragging = true; g.setPointerCapture(e.pointerId); e.preventDefault(); });
  g.addEventListener('pointermove', (e) => { if (dragging) setDockW(e.clientX - $('work').getBoundingClientRect().left); });
  g.addEventListener('pointerup', (e) => { if (!dragging) return; dragging = false; uiSave({ dockW: setDockW(e.clientX - $('work').getBoundingClientRect().left) }); });
  g.addEventListener('dblclick', () => { $('work').style.removeProperty('--dock-w'); uiSave({ dockW: null }); });
  g.addEventListener('keydown', (e) => { if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; const w = $('dock').getBoundingClientRect().width + (e.key === 'ArrowLeft' ? -24 : 24); uiSave({ dockW: setDockW(w) }); });
  $('dockTool').append($('symTool'));   // the Symmetrize tool opens inside the dock, not over the viewport
}
// ---- transport
let playFrom = 0;
$('btnPlay').addEventListener('pointerdown', () => { if (!S.playing) playFrom = S.t; }, true);
$('btnStop').onclick = () => { if (S.playing) $('btnPlay').click(); S.t = playFrom; };
$('btnEnd').onclick = () => { if (S.playing) $('btnPlay').click(); S.t = S.dur; };
function stepBar(dir) {
  if (!cur || !(cur.dur > 0) || !S.speedLUT) return;
  const ct = clipTime(S.t), k = ct / cur.dur, onBar = Math.abs(k - Math.round(k)) < 1e-3;
  const tk = dir < 0 ? (onBar ? Math.round(k) - 1 : Math.floor(k)) : (onBar ? Math.round(k) + 1 : Math.ceil(k));
  S.t = clamp(timeOfClipTime(Math.max(0, tk) * cur.dur), 0, S.dur);
}
$('btnPrevBar').onclick = () => stepBar(-1);
$('btnNextBar').onclick = () => stepBar(1);
// ---- every frame: the big time display, the clip name, the gait readout
function updateWorkspace() {
  if (!cur) return;
  const ct = clipTime(S.t), d = cur.dur > 0 ? cur.dur : 1, k = ct / d, bar = Math.floor(k + 1e-6), q = Math.floor((k - bar) * 4 + 1e-6);
  $('btBar').textContent = `bar ${bar + 1}${q > 0 ? ' .' + clamp(q, 1, 3) : ''}`;
  $('btSec').textContent = `${S.t.toFixed(3)} s`;
  $('btFrm').textContent = `f ${Math.round(S.t * 30)}`;
  const mc = $('menuClip'); if (mc.dataset.id !== cur.id) { mc.dataset.id = cur.id; mc.textContent = cur.name; }
  const g = $('gaitChip'), spd = cur.c && cur.c.speed;
  if (cur.kind !== 'loop' || !(spd > 0.01)) { g.textContent = 'Cadence, step length and speed show for a travelling loop clip.'; return; }
  const play = evalPts(A.speed, S.t), cyc = Math.max(5, evalPts(A.cyc, S.t)) / 100, rate = play * cyc;   // cycles of the clip per clip-second
  const cadence = 120 * rate / d, ground = spd * rate * evalPts(A.move, S.t) * strideK(S.t), step = ground / Math.max(1e-6, cadence / 60);
  g.innerHTML = `cadence <b>${cadence.toFixed(0)}</b> steps/min · step <b>${step.toFixed(2)}</b> m · speed <b>${ground.toFixed(2)}</b> m/s · stride <b>${Math.round(strideK(S.t) * 100)} %</b>`;
}
new MutationObserver(() => { if (!$('symTool').hidden) $('symTool').scrollIntoView({ block: 'start', behavior: 'smooth' }); }).observe($('symTool'), { attributes: true, attributeFilter: ['hidden'] });
