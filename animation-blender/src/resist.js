// ============================================================================
//  RESISTANCE: a force on the runner (a rope, a band, a sled, the wind) and what the body does about it
//  Tracks: Force (N), Direction (° the force pulls toward, around the runner: 0 forward, 90 right, 180 back,
//  270 left) and Vertical (° up + / down −). Settings: body mass, attachment (hips or chest), keep speed.
//  From the force (formula based, no simulation, the same result every time):
//   · lean against it: forward / back lean = atan(back pull / effective weight), side lean = atan(side pull /
//     effective weight), away from the pull; split between Hip rotation and Spine lean (hips harness: half and
//     half; chest: a quarter at the pelvis)
//   · load = back pull / weight: shorter steps (−0.75 % per 1 % load, sled studies), more shoulder swing; keep
//     speed on: the cadence rises to hold the speed; off: the cadence drops a little and the speed falls
//   · vertical pull: up lightens (hips a little higher), down loads (hips lower, knees bent)
//   · side pull: wider steps
//  It adds to the Run controls (it never overwrites their tracks).
// ============================================================================
const GRAV = 9.81;
const RES_SPEC = {
  force: { range: [0, 600], ref: 0, color: '#e8b04a', scale: 1, unit: 'N', fmt: (v) => Math.round(v) + ' N', snap: 5 },
  dir: { range: [0, 360], ref: 180, color: '#b98ae0', scale: 1, unit: '°', fmt: (v) => Math.round(v) + '°', snap: 5 },
  vert: { range: [-60, 60], ref: 0, color: '#7fb7e0', scale: 1, unit: '°', fmt: (v) => sgn(v, 0, '°'), snap: 1 },
};
const RES_LABEL = { force: 'Force <i>N · 736 N = a 75 kg body weight</i>', dir: 'Direction <i>° pulls toward: 0 fwd · 90 right · 180 back · 270 left</i>', vert: 'Vertical <i>° + up / − down</i>' };
const RESK = { sideSign: 1, widthSign: -1, stepPerLoad: 0.75, cadDropPerLoad: 0.25, armPerLoad: 0.6, widthCmPerDeg: 0.6, vertCmPerG: 8, hipShareHips: 0.5, hipShareChest: 0.25, sideHipShare: 0.4 };
function newResistAuto(dur) { return { collapsed: false, force: flat(0, dur), dir: flat(180, dur), vert: flat(0, dur), mass: 75, attach: 'hips', keepSpeed: true }; }
function normalizeResist(r, dur) {
  if (!r) return null;
  const d = newResistAuto(dur);
  for (const k of ['force', 'dir', 'vert']) if (!Array.isArray(r[k]) || !r[k].length) r[k] = d[k];
  if (!(r.mass > 0)) r.mass = 75; if (r.attach !== 'chest') r.attach = 'hips'; if (r.keepSpeed == null) r.keepSpeed = true;
  return r;
}
const resistOn = () => !!(A && A.resist && !A.resist.bypass) && flatActiveR();
function flatActiveR() { return A.resist.force.some((p) => Math.abs(p.v) > 1e-9); }   // no cache: timing is rebuilt before an edit bumps editVersion
// the force at time t, broken down → { back, side, up (N), load, lean, sideLean (°), stepK, cadK, armK, heightCm, widthCm }
const RES0 = { back: 0, side: 0, up: 0, load: 0, lean: 0, sideLean: 0, stepK: 1, cadK: 1, armK: 1, heightCm: 0, widthCm: 0 };
function resistAt(t) {
  if (!resistOn()) return RES0;
  const r = A.resist, F = Math.max(0, evalPts(r.force, t)), h = evalPts(r.dir, t) * DEG, v = clamp(evalPts(r.vert, t), -89, 89) * DEG;
  const hor = F * Math.cos(v), back = -hor * Math.cos(h), side = hor * Math.sin(h), up = F * Math.sin(v);
  const W = r.mass * GRAV, Weff = Math.max(0.2 * W, W - up), load = back / W;
  const lean = Math.atan2(back, Weff) / DEG, sideLean = -Math.atan2(side, Weff) / DEG;   // lean against the pull
  const stepK = load >= 0 ? clamp(1 - RESK.stepPerLoad * load, 0.5, 1) : clamp(1 - 0.3 * load, 1, 1.2);
  const cadK = r.keepSpeed ? 1 / stepK : load >= 0 ? clamp(1 - RESK.cadDropPerLoad * load, 0.6, 1) : 1;
  return { back, side, up, load, lean, sideLean, stepK, cadK, armK: 1 + RESK.armPerLoad * Math.max(0, load), heightCm: RESK.vertCmPerG * (up / W), widthCm: RESK.widthCmPerDeg * Math.abs(sideLean) };
}
// share of the lean that goes to the pelvis (Hip rotation) vs the spine (Spine lean)
const resHipShare = () => (A.resist && A.resist.attach === 'chest' ? RESK.hipShareChest : RESK.hipShareHips);
function resistLeanParts(t) { const R = resistAt(t), hs = resHipShare(); return { spine: R.lean * (1 - hs), hip: R.lean * hs, side: R.sideLean, heightCm: R.heightCm }; }

// ---------------------------------------------------------------- the timeline block
function drawResistBlock() {
  const r = A.resist; if (!r) return;
  const hr = mkRow('bone sym resb'); Object.assign(hr, { kind: 'resist' });
  hr.h.innerHTML = `<button type="button" class="mini" data-act="fold" aria-expanded="${!r.collapsed}">${r.collapsed ? '▸' : '▾'}</button><span class="symtag">RESISTANCE</span><span class="name"></span><button type="button" class="mini" data-act="set" title="Body mass, attachment, keep speed">⚙</button><button type="button" class="mini" data-act="del" title="Remove">×</button>`;
  hr.h.querySelector('[data-act="fold"]').onclick = () => { r.collapsed = !r.collapsed; rebuildRows(); save(); };
  hr.h.querySelector('[data-act="set"]').onclick = () => openResistDlg();
  hr.h.querySelector('[data-act="del"]').onclick = () => confirmDelete('Remove Resistance and its tracks?', () => { pushUndo(); removeResistNow(); });
  addBypass(hr, r, null);
  hr.h.oncontextmenu = (ev) => { ev.preventDefault(); if (rightDouble('res')) hr.h.querySelector('[data-act="del"]').click(); };
  hr.lane.innerHTML = '<div class="summary"></div>'; hr.resSum = hr.lane.firstChild; resistSummary(hr);
  tracksEl.append(hr.el); rows.push(hr);
  if (r.collapsed) return;
  for (const k of ['force', 'dir', 'vert']) addTrackRow(`r|${k}`, RES_SPEC[k], () => r[k], (p) => { r[k] = p; }, RES_LABEL[k], { type: 'resist', id: 'main', k });
}
function resistSummary(hr) {
  const r = A.resist; if (!hr || !hr.resSum || !r) return;
  const R = resistAt(S.t);
  hr.resSum.textContent = `${r.mass} kg · ${r.attach === 'chest' ? 'chest' : 'hips'} harness · ${r.keepSpeed ? 'keep speed' : 'speed drops'} · at the playhead: load ${Math.round(R.load * 100)} %, lean ${sgn(R.lean, 1, '°')}, side ${sgn(R.sideLean, 1, '°')}, step ${Math.round(R.stepK * 100)} %, cadence ${Math.round(R.cadK * 100)} %`;
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
  $('resMass').value = r.mass; $('resAttach').value = r.attach; $('resKeep').checked = !!r.keepSpeed;
  $('resDlg').hidden = false;
}
$('resMass').onchange = () => { if (!A.resist) return; pushUndo(); A.resist.mass = clamp(+$('resMass').value || 75, 20, 200); resistChanged(); };
$('resAttach').onchange = () => { if (!A.resist) return; pushUndo(); A.resist.attach = $('resAttach').value; resistChanged(); };
$('resKeep').onchange = () => { if (!A.resist) return; pushUndo(); A.resist.keepSpeed = $('resKeep').checked; resistChanged(); };
$('resClose').onclick = () => { $('resDlg').hidden = true; };
$('resDlg').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('resDlg').hidden = true; });
