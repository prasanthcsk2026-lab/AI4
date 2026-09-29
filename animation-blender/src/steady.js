// ============================================================================
//  STEADINESS AUTOMATION: the Symmetrize tool's Steadiness as timeline tracks
//  Per centre bone (Hips, Spine, Spine1, Chest, Neck, Head) an Amount track: how much of the bone's in-cycle motion
//  to take out (0 = as the clip moves it, 100 % = still), measured against the average pose of the bar it is in
//  (the averages are taken per bar and blended between bar centres, so a timeline that changes over the bars
//  steadies against its own changing pose). Hips also get Bob and Sway tracks (height and side movement).
//  Settings per bone (not animated): World (the bone holds still in the world, the bones below compensate) or
//  Local (only its own rotation calms), and which axes: pitch / turn / tilt. With "feet stay planted" the legs
//  are re-solved so each foot keeps the spot the unsteadied pose gave it.
//  It runs after the clip, groups, bones and symmetrize, before IK (so Chest / Head / Hips effectors and foot
//  lock act on top of it).
// ============================================================================
const STD_BONES = [['hips', 'Hips', 'world'], ['spine', 'Spine', 'local'], ['spine1', 'Spine1', 'local'], ['spine2', 'Chest', 'local'], ['neck', 'Neck', 'world'], ['head', 'Head', 'world']];
const STD_KEYS = [...STD_BONES.map(([k]) => k), 'bob', 'sway'];
const STD_LABEL = Object.fromEntries([...STD_BONES.map(([k, l]) => [k, l]), ['bob', 'Hips bob'], ['sway', 'Hips sway']]);
const STD_SPEC = { range: [0, 1], ref: 0, color: '#7fd0d8', scale: 100, unit: '%', fmt: pct, snap: 0.05 };
function newSteadyAuto(dur) {
  const tr = {}, set = {}, show = {};
  for (const k of STD_KEYS) { tr[k] = flat(0, dur); show[k] = ['hips', 'spine2', 'head', 'bob'].includes(k); }
  for (const [k, , sp] of STD_BONES) set[k] = { space: sp, pitch: true, turn: true, tilt: true };
  return { collapsed: false, show, tr, set, feet: true };
}
function normalizeSteady(st, dur) {
  if (!st) return null;
  const d = newSteadyAuto(dur);
  st.tr = st.tr || {}; st.set = st.set || {}; st.show = st.show || d.show;
  for (const k of STD_KEYS) { if (!Array.isArray(st.tr[k]) || !st.tr[k].length) st.tr[k] = flat(0, dur); if (st.show[k] == null) st.show[k] = false; }
  for (const [k] of STD_BONES) st.set[k] = { ...d.set[k], ...(st.set[k] || {}) };
  if (st.feet == null) st.feet = true;
  return st;
}
const steadyOn = () => !!(A && A.steady && !A.steady.bypass);
const stdBone = (k) => rig.b[k];

// ---------------------------------------------------------------- per-bar average pose (cached)
let stdCache = null, stdSkip = false, stdFeet = null;
function stdChainWorld(Q, i, out) {   // world rotation of bone i from local quats Q (as VirtualFK does)
  const par = fk.v.parent, chain = []; let j = i;
  while (j >= 0) { chain.push(j); j = par[j]; }
  const root = chain.pop(); out.copy(fk.v.bq[root]);
  const ql = new THREE.Quaternion();
  for (let n = chain.length - 1; n >= 0; n--) { const k = chain[n]; out.multiply(ql.fromArray(Q, k * 4)); }
  return out;
}
function stdMeans() {
  const key = `${editVersion}|${S.dur}|${cur && cur.id}`;
  if (stdCache && stdCache.key === key) return stdCache;
  const d = cur.dur, total = clipTime(S.dur), nb = Math.max(1, Math.ceil(total / d - 1e-6)), M = 24;
  const Q = new Float32Array(B * 4), H = V3(), tv = V3(), wq = new THREE.Quaternion(), bars = [];
  stdSkip = true;
  try {
    for (let k = 0; k < nb; k++) {
      const c0 = k * d, c1 = Math.min(total, (k + 1) * d), W = {}, L = {}; let mx = 0, my = 0, n = 0;
      for (const [b] of STD_BONES) { W[b] = []; L[b] = []; }
      for (let s = 0; s < M; s++) {
        const t = timeOfClipTime(c0 + (c1 - c0) * (s + 0.5) / M);
        composePose(t, Q, H, null);
        const hl = H.clone().sub(shownTravel(t, tv)); mx += hl.x; my += hl.y; n++;
        for (const [b] of STD_BONES) { const i = boneIdx.get(stdBone(b).name); W[b].push(stdChainWorld(Q, i, wq).clone()); L[b].push(new THREE.Quaternion().fromArray(Q, i * 4)); }
      }
      const bar = { c: (c0 + c1) / 2, mx: mx / n, my: my / n, W: {}, L: {} };
      for (const [b] of STD_BONES) { bar.W[b] = meanQuat(W[b]); bar.L[b] = meanQuat(L[b]); }
      bars.push(bar);
    }
  } finally { stdSkip = false; }
  stdCache = { key, bars };
  return stdCache;
}
function stdMeanAt(ct) {   // the average pose at clip time ct: blended between bar centres
  const bars = stdMeans().bars;
  let i = 0; while (i < bars.length - 1 && bars[i + 1].c <= ct) i++;
  const a = bars[i], b = bars[Math.min(bars.length - 1, i + 1)], u = b === a ? 0 : clamp((ct - a.c) / (b.c - a.c), 0, 1);
  const out = { mx: lerp(a.mx, b.mx, u), my: lerp(a.my, b.my, u), W: {}, L: {} };
  for (const [k] of STD_BONES) { out.W[k] = a.W[k].clone().slerp(b.W[k], u); out.L[k] = a.L[k].clone().slerp(b.L[k], u); }
  return out;
}

// ---------------------------------------------------------------- apply at time t (inside composePose)
const _sq = { a: new THREE.Quaternion(), b: new THREE.Quaternion(), c: new THREE.Quaternion() }, _sv = V3();
function applySteady(t, Qout, Hout) {
  stdFeet = null;
  if (stdSkip || !steadyOn() || !cur || !(cur.dur > 0)) return;
  const st = A.steady, amt = {};
  let any = false; for (const k of STD_KEYS) { amt[k] = clamp(evalPts(st.tr[k], t), 0, 1); if (amt[k] > 1e-4) any = true; }
  if (!any) return;
  const m = stdMeanAt(clipTime(t));
  const hipsTouched = amt.hips > 1e-4 || amt.bob > 1e-4 || amt.sway > 1e-4;
  if (hipsTouched && st.feet) {   // where the feet were before: the legs are re-solved to keep them there (solveIK)
    fk.v.run(Qout, Hout, 0);
    stdFeet = {};
    for (const Sd of ['L', 'R']) { const i = boneIdx.get(rig.side[Sd].foot.name); stdFeet[Sd] = { p: fk.v.P[i].clone(), q: fk.v.delta(i) }; }
  }
  if (amt.bob > 1e-4 || amt.sway > 1e-4) {
    const tv = shownTravel(t, _sv).clone(), hl = Hout.clone().sub(tv);
    hl.y -= amt.bob * (hl.y - m.my); hl.x -= amt.sway * (hl.x - m.mx);
    Hout.copy(hl.add(tv));
  }
  const rv = V3();
  for (const [k] of STD_BONES) {   // top of the chain down, each against its parent as already steadied
    const a = amt[k]; if (a < 1e-4) continue;
    const o = st.set[k], i = boneIdx.get(stdBone(k).name), p = fk.v.parent[i];
    const kx = 1 - a * (o.pitch ? 1 : 0), ky = 1 - a * (o.turn ? 1 : 0), kz = 1 - a * (o.tilt ? 1 : 0);
    let Ln;
    if (o.space === 'world') {
      const Wc = stdChainWorld(Qout, i, _sq.a), meanI = _sq.b.copy(m.W[k]).invert();
      const dq = Wc.clone().multiply(meanI); if (dq.w < 0) { dq.x = -dq.x; dq.y = -dq.y; dq.z = -dq.z; dq.w = -dq.w; }
      logQ(dq, rv); rv.set(rv.x * kx, rv.y * ky, rv.z * kz);
      const Wn = expV(rv.x, rv.y, rv.z, new THREE.Quaternion()).multiply(m.W[k]);
      const Pw = p >= 0 ? stdChainWorld(Qout, p, _sq.c).clone() : new THREE.Quaternion();
      Ln = Pw.invert().multiply(Wn);
    } else {
      const Lc = _sq.a.fromArray(Qout, i * 4), dq = m.L[k].clone().invert().multiply(Lc);
      if (dq.w < 0) { dq.x = -dq.x; dq.y = -dq.y; dq.z = -dq.z; dq.w = -dq.w; }
      logQ(dq, rv); rv.applyQuaternion(m.W[k]);                       // the deviation in character axes
      rv.set(rv.x * kx, rv.y * ky, rv.z * kz); rv.applyQuaternion(m.W[k].clone().invert());
      Ln = m.L[k].clone().multiply(expV(rv.x, rv.y, rv.z, new THREE.Quaternion()));
    }
    Ln.normalize().toArray(Qout, i * 4);
  }
}

// ---------------------------------------------------------------- the timeline block
function drawSteady() {
  const st = A.steady; if (!st) return;
  const hr = mkRow('bone sym std'); Object.assign(hr, { kind: 'steady' });
  hr.h.innerHTML = `<button type="button" class="mini" data-act="fold" aria-expanded="${!st.collapsed}">${st.collapsed ? '▸' : '▾'}</button><span class="symtag">STEADINESS</span><span class="name"></span><button type="button" class="mini" data-act="set" title="Tracks, World / Local, axes, feet">⚙</button><button type="button" class="mini" data-act="del" title="Remove">×</button>`;
  hr.h.querySelector('[data-act="fold"]').onclick = () => { st.collapsed = !st.collapsed; rebuildRows(); save(); };
  hr.h.querySelector('[data-act="set"]').onclick = () => openSteadyDlg();
  hr.h.querySelector('[data-act="del"]').onclick = () => confirmDelete('Remove Steadiness and its tracks?', () => { pushUndo(); removeSteadyNow(); });
  addBypass(hr, st, null);
  hr.h.oncontextmenu = (ev) => { ev.preventDefault(); if (rightDouble('std')) hr.h.querySelector('[data-act="del"]').click(); else openMenu(ev.clientX, ev.clientY, steadyMenu()); };
  hr.lane.innerHTML = '<div class="summary"></div>'; hr.lane.firstChild.textContent = steadySummary();
  tracksEl.append(hr.el); rows.push(hr);
  if (st.collapsed) return;
  for (const k of STD_KEYS) {
    if (!st.show[k]) continue;
    const bone = STD_BONES.find(([b]) => b === k), s = bone ? st.set[k] : null;
    const info = s ? `${s.space === 'world' ? 'world' : 'local'} · ${['pitch', 'turn', 'tilt'].filter((a) => s[a]).join(' ') || 'no axes'}` : k === 'bob' ? 'height' : 'side to side';
    addTrackRow(`q|${k}`, STD_SPEC, () => st.tr[k], (p) => { st.tr[k] = p; }, `${STD_LABEL[k]} <i>${info}</i>`, { type: 'steady', id: 'main', k });
  }
}
function steadySummary() {
  const st = A.steady, on = STD_KEYS.filter((k) => !isFlat(st.tr[k], 0));
  return on.length ? 'Steadied: ' + on.map((k) => STD_LABEL[k].toLowerCase()).join(', ') + (st.feet ? ' · feet stay planted' : '') : 'Amount 0 % = as the clip moves · 100 % = still (against the bar\'s average pose). ⚙ for tracks, World / Local and axes.';
}
function steadyMenu() {
  const st = A.steady, tog = (fn) => () => { pushUndo(); fn(); editVersion++; trailDirty = true; holdCache.clear(); rebuildRows(); save(); };
  return [
    ...STD_KEYS.map((k) => ({ label: `Track: ${STD_LABEL[k]}`, checked: !!st.show[k], action: tog(() => { st.show[k] = !st.show[k]; }) })),
    { sep: true },
    { label: 'Feet stay planted (hips steadied)', checked: !!st.feet, action: tog(() => { st.feet = !st.feet; }) },
    { label: 'Settings…', action: openSteadyDlg },
    { sep: true },
    { label: 'Remove Steadiness…', action: () => confirmDelete('Remove Steadiness and its tracks?', () => { pushUndo(); removeSteadyNow(); }) },
  ];
}
function addSteady() {
  if (A.steady) return;
  pushUndo(); A.steady = newSteadyAuto(S.dur); addRowKey('std:main');
  editVersion++; rebuildRows(); save();
}
function removeSteadyNow() {
  delete A.steady; if (A.rowOrder) A.rowOrder = A.rowOrder.filter((k) => k !== 'std:main');
  editVersion++; trailDirty = true; holdCache.clear(); rebuildRows(); save();
}
function openSteadyDlg() {
  const st = A.steady; if (!st) return;
  const g = $('stdGrid'); g.textContent = '';
  const add = (html) => { const tp = document.createElement('template'); tp.innerHTML = html; g.append(...tp.content.childNodes); };
  add('<span class="hd">Track</span><span class="hd">Space</span><span class="hd" title="Pitch: nod forward / back">P</span><span class="hd" title="Turn: left / right">T</span><span class="hd" title="Tilt: side to side">L</span>');
  for (const [k, label] of STD_BONES) {
    const s = st.set[k];
    add(`<label><input type="checkbox" data-k="${k}" data-f="show"${st.show[k] ? ' checked' : ''}> ${label}</label><select data-k="${k}" data-f="space"><option value="world"${s.space === 'world' ? ' selected' : ''}>World</option><option value="local"${s.space === 'local' ? ' selected' : ''}>Local</option></select>` +
      ['pitch', 'turn', 'tilt'].map((a) => `<input type="checkbox" data-k="${k}" data-f="${a}"${s[a] ? ' checked' : ''} title="${a}">`).join(''));
  }
  for (const k of ['bob', 'sway']) add(`<label><input type="checkbox" data-k="${k}" data-f="show"${st.show[k] ? ' checked' : ''}> ${STD_LABEL[k]}</label><span class="wide">${k === 'bob' ? 'up / down' : 'side to side'}</span>`);
  $('stdFeet').checked = !!st.feet;
  for (const el of g.querySelectorAll('input, select')) el.onchange = () => {
    pushUndo();
    const k = el.dataset.k, f = el.dataset.f;
    if (f === 'show') st.show[k] = el.checked; else if (f === 'space') st.set[k].space = el.value; else st.set[k][f] = el.checked;
    editVersion++; trailDirty = true; holdCache.clear(); rebuildRows(); save();
  };
  $('stdDlg').hidden = false;
}
$('stdFeet').onchange = () => { if (!A.steady) return; pushUndo(); A.steady.feet = $('stdFeet').checked; editVersion++; trailDirty = true; holdCache.clear(); rebuildRows(); save(); };
$('stdClose').onclick = () => { $('stdDlg').hidden = true; };
$('stdDlg').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('stdDlg').hidden = true; });
