// ============================================================================
//  MOTION SEQUENCE
//  The timeline is a row of motions on one static bar grid. Motion 1 starts at bar 1; every later motion is
//  placed at a start bar with n blend bars before it: it begins n bars earlier, under the end of the motion
//  before, and the two cross-fade over those bars. Each motion is a full timeline of its own (its clip, its
//  automation: run controls, speeds, forcers, blends, IK …); nothing of one motion reaches another.
//  In a blend zone both motions run bar for bar: the seconds per bar ease from one cadence to the other, the
//  feet of the new motion are put in step with the old one (its loop starts at the phase where the same foot
//  lands), the ground speed eases over and every bone cross-fades (slerp, eased).
//  Editing works on the selected motion exactly as on a single clip: its tracks fill the timeline; the strip
//  above shows the whole sequence and the playhead runs through all of it.
// ============================================================================
const SEQ = { on: false, motions: [], sel: -1, T: 0, Tend: 0, lastLocal: null, base: V3(), g: null, ver: -1, uid: 1 };
const SEQ_R = 32;   // samples per bar in the sequence tables
const SEQ_COL = ['#f08a1c', '#5fd3a8', '#7fb7ff', '#e58ad6', '#c6d45a', '#ff7a6b', '#b9a5ff', '#56b6c2'];
const seqActive = () => SEQ.on && SEQ.motions.length > 0 && SEQ.sel >= 0;
function seqBarOff() { return seqActive() && SEQ.motions[SEQ.sel] ? SEQ.motions[SEQ.sel].G || 0 : 0; }

// ---------------------------------------------------------------- contexts (everything that belongs to one motion)
function ctxGrab(full) {
  const x = {
    cur, A, dur: S.dur, lut: S.speedLUT, nom: S.speedLUTNom, travelLUT, ev: editVersion,
    c: [leanFlatCache, brkTab, kneeGeo, clipMean, spdVar, spdNoFCache, natTab, stdCache, stdFeet, moveEndCache, footMarkCache, gridCache, spdCache],
  };
  if (full) Object.assign(x, { t: S.t, v0: S.v0, v1: S.v1, viewAll: S.viewAll, undo: undoStack, redo: redoStack, selPts, selRow });
  return x;
}
function ctxPut(x, full) {
  cur = x.cur; A = x.A; S.dur = x.dur; S.speedLUT = x.lut; S.speedLUTNom = x.nom; travelLUT = x.travelLUT; editVersion = x.ev;
  [leanFlatCache, brkTab, kneeGeo, clipMean, spdVar, spdNoFCache, natTab, stdCache, stdFeet, moveEndCache, footMarkCache, gridCache, spdCache] = x.c;
  if (full) { S.t = x.t; S.v0 = x.v0; S.v1 = x.v1; S.viewAll = x.viewAll; undoStack = x.undo; redoStack = x.redo; selPts = x.selPts || new Set(); selRow = x.selRow || null; }
}
function freshCaches() { leanFlatCache = { v: -1, flat: true }; brkTab = kneeGeo = clipMean = spdVar = spdNoFCache = natTab = stdCache = stdFeet = moveEndCache = footMarkCache = gridCache = spdCache = null; travelLUT = null; }
// the clip a motion plays: the library entry with the motion's loop phase on it
function seqClip(id, phase) { const base = clips.find((x) => x.id === id) || clips[0]; return { ...base, phase: base.kind === 'loop' ? mod1(phase || 0) : 0, baseClip: base }; }
// build (or rebuild) a motion's context: its clip, its automation (or a fresh one of n bars), its timing tables
function seqBuildCtx(m, autoObj, bars) {
  const keepUI = suppressUndo; suppressUndo = true;
  try {
    cur = seqClip(m.clipId, m.phase);
    freshCaches(); editVersion = (editVersion | 0) + 1;
    const n = Math.max(1, bars || (autoObj && autoObj.cycles) || 8);
    A = normalizeAuto(autoObj && autoObj.speed ? autoObj : cur.kind === 'proc' ? procNewAuto(n) : newAuto(+(n * cur.dur).toFixed(3), n));
    if (!(autoObj && autoObj.speed)) { A.cycles = n; A.cycLocked = true; }
    S.dur = A.dur; S.t = 0; S.viewAll = true; undoStack = []; redoStack = []; selPts = new Set(); selRow = null;
    rebuildSpeedLUT(); ensureEnds();
    if (cur.dur > 0) { A.cycLocked = true; lockCycles(true); }
    m.ctx = ctxGrab(true);
  } finally { suppressUndo = keepUI; }
  return m.ctx;
}
// raw (unshifted) contact windows of a clip, for the phase match
function rawWin(base, Sd) { const bk = BAKED[base.id] || (base.c && base.c.origBk), w = (bk && bk.win) || (base.c && base.c.win); return w && w[Sd] ? w[Sd] : null; }
function seqAutoPhase(i) {
  const m = SEQ.motions[i], p = SEQ.motions[i - 1]; if (!p || !m) return 0;
  const bm = clips.find((x) => x.id === m.clipId), bp = clips.find((x) => x.id === p.clipId);
  if (!bm || !bp || bm.kind !== 'loop' || bp.kind !== 'loop') return 0;
  const wm = rawWin(bm, 'L'), wp = rawWin(bp, 'L'); if (!wm || !wp) return 0;
  // the same foot lands at the same point of the bar: (its window − its phase) = (the previous one's window − its phase)
  return mod1(wm[0] - wp[0] + (p.phase || 0));
}

// ---------------------------------------------------------------- layout + timing tables
function seqLayout() {   // global start bar of every motion (from the bar counts and the blend bars)
  let g = 0;
  SEQ.motions.forEach((m, i) => {
    const N = m.ctx ? m.ctx.A.cycles : 8;
    if (i === 0) { m.blend = 0; m.G = 0; } else { const p = SEQ.motions[i - 1]; m.G = p.G + p.N - m.blend; }
    m.N = N; g = Math.max(g, m.G + N);
  });
  return g;
}
// one motion's table: local seconds and its own travel at every 1/SEQ_R bar (sampled inside its context)
function seqMotionTable(m) {
  const n = Math.max(1, Math.ceil(m.N * SEQ_R - 1e-6)), t = new Float64Array(n + 1), x = new Float64Array(n + 1), z = new Float64Array(n + 1), v = V3();
  for (let k = 0; k <= n; k++) {
    const bar = Math.min(m.N, k / SEQ_R), tt = cur.dur > 0 ? timeOfClipTime(bar * cur.dur) : bar;
    t[k] = Math.min(S.dur, tt); trueTravel(t[k], v); x[k] = v.x; z[k] = v.z;
  }
  return { n, t, x, z, dur: S.dur, ver: editVersion };
}
const tabAt = (tb, arr, bar) => { const f = clamp(bar * SEQ_R, 0, tb.n), i = Math.min(Math.floor(f), tb.n - 1), u = f - i; return tb.n < 1 ? arr[0] : lerp(arr[i], arr[i + 1], u); };
function seqWeight(i, b) {   // how much of motion i shows at global bar b
  const m = SEQ.motions[i], nx = SEQ.motions[i + 1];
  if (b < m.G - 1e-9 || b > m.G + m.N + 1e-9) return 0;
  let w = 1;
  if (i > 0 && m.blend > 0 && b < m.G + m.blend) w *= smooth(clamp((b - m.G) / m.blend, 0, 1));
  if (nx && b > nx.G) w *= nx.blend > 0 ? 1 - smooth(clamp((b - nx.G) / nx.blend, 0, 1)) : 0;
  return w;
}
function seqActives(b) {
  const out = []; let sum = 0;
  SEQ.motions.forEach((m, i) => { const w = seqWeight(i, b); if (w > 1e-6) { out.push([i, w]); sum += w; } });
  if (!out.length && SEQ.motions.length) { const i = b <= 0 ? 0 : SEQ.motions.length - 1; return [[i, 1]]; }
  for (const o of out) o[1] /= sum;
  return out;
}
// rebuild the tables (the selected motion's own table always; the others only when they are missing)
function seqRebuild(force) {
  if (!seqActive()) { SEQ.g = null; return; }
  const live = ctxGrab(true); SEQ.motions[SEQ.sel].ctx = live;
  seqLayout();
  SEQ.motions.forEach((m, i) => {
    if (!force && m.tab && i !== SEQ.sel) return;
    if (i !== SEQ.sel) ctxPut(m.ctx); else ctxPut(live);
    m.tab = seqMotionTable(m);
    if (i !== SEQ.sel) Object.assign(m.ctx, ctxGrab());
  });
  ctxPut(live, true);
  const TB = Math.max(...SEQ.motions.map((m) => m.G + m.N)), n = Math.max(1, Math.ceil(TB * SEQ_R - 1e-6));
  const T = new Float64Array(n + 1), X = new Float64Array(n + 1), Z = new Float64Array(n + 1);
  for (let k = 1; k <= n; k++) {
    const b0 = (k - 1) / SEQ_R, b1 = Math.min(TB, k / SEQ_R), bm = (b0 + b1) / 2;
    let dT = 0, dX = 0, dZ = 0;
    for (const [i, w] of seqActives(bm)) {
      const m = SEQ.motions[i], tb = m.tab, a0 = clamp(b0 - m.G, 0, m.N), a1 = clamp(b1 - m.G, 0, m.N);
      dT += w * (tabAt(tb, tb.t, a1) - tabAt(tb, tb.t, a0)); dX += w * (tabAt(tb, tb.x, a1) - tabAt(tb, tb.x, a0)); dZ += w * (tabAt(tb, tb.z, a1) - tabAt(tb, tb.z, a0));
    }
    T[k] = T[k - 1] + Math.max(1e-6, dT); X[k] = X[k - 1] + dX; Z[k] = Z[k - 1] + dZ;
  }
  SEQ.g = { n, TB, T, X, Z }; SEQ.Tend = T[n]; SEQ.ver = editVersion;
  SEQ.T = clamp(SEQ.T, 0, SEQ.Tend);
}
function seqBarOfT(T) {   // global time → global bar
  const g = SEQ.g; if (!g) return 0;
  if (T <= 0) return 0; if (T >= g.T[g.n]) return g.TB;
  let lo = 0, hi = g.n; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (g.T[mid] < T) lo = mid; else hi = mid; }
  return Math.min(g.TB, (lo + (T - g.T[lo]) / Math.max(1e-9, g.T[hi] - g.T[lo])) / SEQ_R);
}
function seqTOfBar(b) { const g = SEQ.g; if (!g) return 0; const f = clamp(b * SEQ_R, 0, g.n), i = Math.min(Math.floor(f), g.n - 1); return g.n < 1 ? 0 : lerp(g.T[i], g.T[i + 1], f - i); }
function seqTravelAt(b, out) { const g = SEQ.g, f = clamp(b * SEQ_R, 0, g.n), i = Math.min(Math.floor(f), g.n - 1), u = f - i; return out.set(lerp(g.X[i], g.X[i + 1], u), 0, lerp(g.Z[i], g.Z[i + 1], u)); }
function seqLocalT(i, b) { const m = SEQ.motions[i]; return tabAt(m.tab, m.tab.t, clamp(b - m.G, 0, m.N)); }
// the selected motion's local time → global time (scrubbing its own lanes moves the global playhead)
function seqGlobalOfLocal(t) { const m = SEQ.motions[SEQ.sel]; const bar = cur.dur > 0 ? clipTime(t) / cur.dur : t; return seqTOfBar(m.G + clamp(bar, 0, m.N)); }
function seqSetT(T) { SEQ.T = clamp(T, 0, SEQ.Tend); const b = seqBarOfT(SEQ.T); S.t = clamp(seqLocalT(SEQ.sel, b), 0, S.dur); SEQ.lastLocal = S.t; }

// ---------------------------------------------------------------- evaluation: every motion under the playhead, cross-faded
const seqBuf = { q: [], h: [] }, _sqTr = V3(), _sqQa = new THREE.Quaternion(), _sqQb = new THREE.Quaternion();
function seqEval(T, pend) {
  if (!seqActive() || !SEQ.g) { evaluate(S.t, pend); return; }
  const b = seqBarOfT(T), act = seqActives(b), live = ctxGrab(), keepBase = S.travelBase.clone(), keepTag = S.ctxTag;
  Object.assign(SEQ.motions[SEQ.sel].ctx, live);
  seqTravelAt(b, _sqTr).add(SEQ.base);
  try {
    act.forEach(([i, w], k) => {
      const m = SEQ.motions[i];
      if (i !== SEQ.sel) ctxPut(m.ctx); else ctxPut(live);
      S.ctxTag = m.uid;
      const t = clamp(seqLocalT(i, b), 0, S.dur);
      S.travelBase.copy(_sqTr).sub(trueTravel(t, V3()));
      evaluate(t, i === SEQ.sel ? pend : null);
      if (act.length > 1) {
        if (!seqBuf.q[k]) seqBuf.q[k] = new Float32Array(B * 4), seqBuf.h[k] = V3();
        rig.bones.forEach((bn, j) => bn.quaternion.toArray(seqBuf.q[k], j * 4));
        seqBuf.h[k].copy(rig.b.hips.position);
      }
      if (i !== SEQ.sel) Object.assign(m.ctx, ctxGrab());
    });
  } finally {
    ctxPut(live); S.ctxTag = keepTag;
    // the selected motion's own offset, so its trail and handles sit where the character is
    S.travelBase.copy(keepBase);
  }
  if (act.length > 1) {   // cross-fade (weights sum to 1): slerp pairwise in order
    let acc = act[0][1];
    rig.bones.forEach((bn, j) => bn.quaternion.fromArray(seqBuf.q[0], j * 4));
    rig.b.hips.position.copy(seqBuf.h[0]);
    for (let k = 1; k < act.length; k++) {
      const w = act[k][1], u = w / (acc + w); acc += w;
      rig.bones.forEach((bn, j) => { _sqQb.fromArray(seqBuf.q[k], j * 4); bn.quaternion.slerp(_sqQb, u); });
      rig.b.hips.position.lerp(seqBuf.h[k], u);
    }
    model.updateMatrixWorld(true);
  }
  SEQ.lastB = b; SEQ.lastAct = act;
}
// every frame (from the loop): keep the global playhead and the selected motion's playhead in step
function seqFrame(dt) {
  if (SEQ.ver !== editVersion || !SEQ.g) seqRebuild();
  if (SEQ.lastLocal == null || Math.abs(S.t - SEQ.lastLocal) > 1e-9) SEQ.T = seqGlobalOfLocal(S.t);   // the lanes / ruler moved it
  if (S.playing) {
    SEQ.T += dt;
    if (SEQ.T >= SEQ.Tend) {
      if (S.loop) { SEQ.T -= SEQ.Tend; if (!S.inPlace) { const e = V3(); seqTravelAt(SEQ.g.TB, e); SEQ.base.add(e); trailDirty = true; } }
      else { SEQ.T = SEQ.Tend; S.playing = false; $('btnPlay').textContent = 'Play'; }
    }
  }
  seqSetT(SEQ.T);
  // the selected motion's travel offset (its trail, its world handles)
  const b = seqBarOfT(SEQ.T), tr = seqTravelAt(b, V3()).add(SEQ.base);
  S.travelBase.copy(tr).sub(trueTravel(S.t, V3()));
}
function seqHome() { SEQ.T = 0; SEQ.base.set(0, 0, 0); if (seqActive()) seqSetT(0); }

// ---------------------------------------------------------------- selecting / adding / removing motions
function seqRefreshUI() {
  syncLenInputs(); updateHScroll(); rebuildRows(); drawRuler(); updateSelChip(); $('clipSel').value = cur.id; seqDraw(); seqEmptyUI();
}
function seqSelect(i, keepT) {
  if (i === SEQ.sel || !SEQ.motions[i]) return;
  if (SEQ.sel >= 0 && SEQ.motions[SEQ.sel]) SEQ.motions[SEQ.sel].ctx = ctxGrab(true);
  const T = SEQ.T; SEQ.sel = i; ctxPut(SEQ.motions[i].ctx, true); selRow = null; selPts = new Set();
  seqRebuild();
  if (keepT !== false) seqSetT(T);
  seqRefreshUI(); save();
}
function seqPhaseAll() {   // auto phases down the chain; a motion whose phase moved gets its context rebuilt
  let changed = false;
  SEQ.motions.forEach((m, i) => {
    const ph = i === 0 ? (m.phaseAuto ? 0 : m.phase || 0) : m.phaseAuto ? seqAutoPhase(i) : m.phase || 0;
    if (Math.abs(mod1(ph) - mod1(m.cur0 == null ? -1 : m.cur0)) > 1e-6 || !m.ctx) {
      m.phase = mod1(ph); const a = m.ctx ? m.ctx.A : m.A0; seqBuildCtx(m, a); m.cur0 = m.phase; m.tab = null; changed = true;
    }
  });
  return changed;
}
function seqReload(keepT = true) {   // after a structural change: phases, contexts, tables, UI
  const T = SEQ.T;
  if (SEQ.sel >= 0 && SEQ.motions[SEQ.sel] && SEQ.motions[SEQ.sel].ctx && cur === SEQ.motions[SEQ.sel].ctx.cur) SEQ.motions[SEQ.sel].ctx = ctxGrab(true);
  seqPhaseAll();
  if (!SEQ.motions.length) { SEQ.sel = -1; SEQ.g = null; seqRefreshEmpty(); save(); return; }
  SEQ.sel = clamp(SEQ.sel, 0, SEQ.motions.length - 1);
  ctxPut(SEQ.motions[SEQ.sel].ctx, true);
  for (const m of SEQ.motions) m.tab = null;
  seqRebuild(true);
  seqSetT(keepT ? T : 0);
  seqRefreshUI(); save();
}
// a motion's bar count changes inside its own context (the same trim / hold the bar count field uses)
function seqSetBars(i, n) {
  const m = SEQ.motions[i]; if (!m) return;
  const live = ctxGrab(true); if (SEQ.sel >= 0) SEQ.motions[SEQ.sel].ctx = live;
  if (i !== SEQ.sel) ctxPut(m.ctx, true);
  setCycles(n);
  m.ctx = ctxGrab(true);
  if (i !== SEQ.sel) ctxPut(SEQ.motions[SEQ.sel].ctx, true);
}
function seqAdd(clipId, startBar, blend, bars, matchFeet) {
  const i = SEQ.motions.length, m = { uid: SEQ.uid++, clipId, blend: i ? Math.max(0, blend) : 0, phaseAuto: matchFeet !== false, phase: 0 };
  if (i > 0) {
    const p = SEQ.motions[i - 1], need = (startBar - 1) - p.G;   // the previous motion runs up to the new start bar
    if (need < m.blend + 1) { toast(`Start bar ${startBar} is too early: the motion before starts at bar ${p.G + 1} and needs at least ${m.blend + 1} bars.`); return false; }
    if (Math.abs(need - p.ctx.A.cycles) > 1e-6) seqSetBars(i - 1, need);
  }
  SEQ.motions.push(m);
  if (SEQ.sel >= 0 && SEQ.motions[SEQ.sel] && SEQ.motions[SEQ.sel] !== m) SEQ.motions[SEQ.sel].ctx = ctxGrab(true);
  m.phase = i ? (m.phaseAuto ? seqAutoPhase(i) : 0) : 0; m.cur0 = m.phase;
  seqBuildCtx(m, null, m.blend + Math.max(1, bars));
  SEQ.sel = i; ctxPut(m.ctx, true);
  for (const x of SEQ.motions) x.tab = null;
  seqRebuild(true);
  seqSetT(seqTOfBar(m.G));
  seqRefreshUI(); save();
  return true;
}
function seqRemove(i) {
  const m = SEQ.motions[i]; if (!m) return;
  askConfirm(`Remove motion ${i + 1} (${m.ctx.cur.name}) and its automation from the sequence?`, () => {
    if (SEQ.sel >= 0 && SEQ.motions[SEQ.sel]) SEQ.motions[SEQ.sel].ctx = ctxGrab(true);
    SEQ.motions.splice(i, 1);
    if (SEQ.motions[0]) SEQ.motions[0].blend = 0;
    if (SEQ.sel >= SEQ.motions.length || SEQ.sel === i) SEQ.sel = Math.max(0, Math.min(i, SEQ.motions.length - 1)); else if (SEQ.sel > i) SEQ.sel--;
    for (const x of SEQ.motions) x.cur0 = null;   // phases down the chain may change
    seqReload();
  }, 'Remove');
}
function seqClear() {
  askConfirm('Clear the whole sequence? Every motion and its automation goes (the timeline starts empty).', () => { SEQ.motions = []; SEQ.sel = -1; SEQ.T = 0; seqReload(false); }, 'Clear all');
}
// a new clip for a motion: a fresh automation of the same bar count
function seqSetClip(i, id) {
  const m = SEQ.motions[i]; if (!m || m.clipId === id) return;
  if (SEQ.sel >= 0) SEQ.motions[SEQ.sel].ctx = ctxGrab(true);
  m.clipId = id; const bars = m.ctx.A.cycles; m.cur0 = null;
  seqBuildCtx(m, null, bars);
  for (const x of SEQ.motions) x.cur0 = null;
  seqReload();
}
// clip menu: in a sequence it changes the selected motion's clip (its automation starts fresh)
function clipSelChanged(id) {
  if (!seqActive()) { if (SEQ.on && !SEQ.motions.length) { $('clipSel').value = cur.id; openSeqDlg(null, id); return; } selectClip(id); return; }
  const m = SEQ.motions[SEQ.sel]; $('clipSel').value = cur.id;
  askConfirm(`Change motion ${SEQ.sel + 1} to "${(clips.find((x) => x.id === id) || {}).name}"? Its automation starts fresh (the bar count stays).`, () => { seqSetClip(SEQ.sel, id); toast(`Motion ${SEQ.sel + 1}: ${cur.name}.`); }, 'Change');
}
// other code (imports, the symmetrize tool) loads a clip: in a sequence that goes into the selected motion
function selectClip(id) {
  if (!seqActive()) { selectClipRaw(id); return; }
  if (SEQ.motions[SEQ.sel].clipId === id) return;
  seqSetClip(SEQ.sel, id);
}

// ---------------------------------------------------------------- save / load
function seqSerialize() {
  return { v: 1, sel: SEQ.sel, motions: SEQ.motions.map((m, i) => ({ clipId: m.clipId, blend: m.blend || 0, phaseAuto: m.phaseAuto !== false, phase: m.phase || 0, A: i === SEQ.sel && seqActive() ? A : m.ctx ? m.ctx.A : m.A0 })) };
}
function seqLoad(o) {
  SEQ.motions = []; SEQ.sel = -1;
  for (const x of (o && Array.isArray(o.motions) ? o.motions : [])) {
    if (!x || !clips.find((c) => c.id === x.clipId)) continue;
    SEQ.motions.push({ uid: SEQ.uid++, clipId: x.clipId, blend: Math.max(0, +x.blend || 0), phaseAuto: x.phaseAuto !== false, phase: +x.phase || 0, A0: x.A, cur0: null });
  }
  SEQ.sel = SEQ.motions.length ? clamp(+(o && o.sel) || 0, 0, SEQ.motions.length - 1) : -1;
  SEQ.T = 0; SEQ.base.set(0, 0, 0);
  seqReload(false);
}
function seqBoot() {
  SEQ.on = true;
  if (store.seq && Array.isArray(store.seq.motions)) { seqLoad(store.seq); return; }
  // first run with this version: the clip that was open becomes motion 1 (nothing of it is lost)
  const saved = store.last && store.clips && store.clips[store.last];
  if (saved && saved.speed && clips.find((c) => c.id === store.last)) seqLoad({ sel: 0, motions: [{ clipId: store.last, blend: 0, A: JSON.parse(JSON.stringify(saved)) }] });
  else seqLoad({ motions: [] });
}

// ---------------------------------------------------------------- the strip: every motion on the global bar grid
function seqDraw() {
  const cv = $('seqCv'); if (!cv) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.max(10, Math.round(cv.clientWidth * dpr)), h = Math.max(10, Math.round(cv.clientHeight * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const x = cv.getContext('2d'); x.clearRect(0, 0, w, h);
  $('seqInfo').textContent = SEQ.motions.length ? `${SEQ.motions.length} motion${SEQ.motions.length > 1 ? 's' : ''}` : 'empty';
  if (!seqActive() || !SEQ.g) return;
  const TB = SEQ.g.TB, bx = (b) => 4 * dpr + (b / Math.max(1, TB)) * (w - 8 * dpr), lane = h / 2;
  // bar ticks
  x.font = `600 ${9 * dpr}px "Barlow", sans-serif`; x.textBaseline = 'top';
  const every = Math.max(1, Math.ceil(TB / Math.max(1, (w / dpr) / 26)));
  for (let k = 0; k <= TB + 1e-6; k++) { const px = Math.round(bx(k)) + 0.5; x.fillStyle = 'rgba(255,255,255,.07)'; x.fillRect(px, 0, dpr, h); if (k % every === 0 && k < TB) { x.fillStyle = 'rgba(200,200,205,.45)'; x.fillText(String(k + 1), px + 2 * dpr, 1 * dpr); } }
  SEQ.motions.forEach((m, i) => {
    const y = (i % 2) * lane + 2 * dpr, hh = lane - 4 * dpr, a = bx(m.G), b = bx(m.G + m.N), col = SEQ_COL[(m.uid - 1) % SEQ_COL.length];
    x.globalAlpha = i === SEQ.sel ? 0.95 : 0.55; x.fillStyle = col; x.beginPath(); x.roundRect(a, y, Math.max(2, b - a), hh, 4 * dpr); x.fill(); x.globalAlpha = 1;
    if (m.blend > 0 && i > 0) {   // blend zone: stripes
      const z = bx(m.G + m.blend); x.save(); x.beginPath(); x.rect(a, y, z - a, hh); x.clip(); x.strokeStyle = 'rgba(15,17,16,.55)'; x.lineWidth = 2 * dpr;
      for (let s = a - hh; s < z; s += 6 * dpr) { x.beginPath(); x.moveTo(s, y + hh); x.lineTo(s + hh, y); x.stroke(); } x.restore();
    }
    if (i === SEQ.sel) { x.strokeStyle = '#ffffff'; x.lineWidth = 1.5 * dpr; x.beginPath(); x.roundRect(a + 0.75 * dpr, y + 0.75 * dpr, Math.max(2, b - a) - 1.5 * dpr, hh - 1.5 * dpr, 4 * dpr); x.stroke(); }
    x.save(); x.beginPath(); x.rect(a, y, b - a, hh); x.clip(); x.fillStyle = '#111513'; x.font = `700 ${10.5 * dpr}px "Barlow", sans-serif`; x.textBaseline = 'middle';
    x.fillText(`${i + 1} · ${(m.ctx.cur.name || '').replace(/ \(.*$/, '')}  ${m.G + 1}–${m.G + m.N}${m.blend ? ` · blend ${m.blend}` : ''}`, a + 6 * dpr, y + hh / 2); x.restore();
  });
  const pb = bx(seqBarOfT(SEQ.T)); x.fillStyle = '#ffd166'; x.fillRect(Math.round(pb) - dpr, 0, 2 * dpr, h);
}
function seqHit(e) {
  const cv = $('seqCv'), r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  if (!seqActive() || !SEQ.g) return { bar: 0, i: -1 };
  const TB = SEQ.g.TB, bar = clamp(((px - 4) / Math.max(1, r.width - 8)) * TB, 0, TB), laneI = py < r.height / 2 ? 0 : 1;
  let i = SEQ.motions.findIndex((m, k) => k % 2 === laneI && bar >= m.G && bar <= m.G + m.N);
  if (i < 0) i = SEQ.motions.findIndex((m) => bar >= m.G && bar <= m.G + m.N);
  return { bar, i };
}
function seqEmptyUI() {
  const empty = SEQ.on && !SEQ.motions.length;
  $('seqEmpty').hidden = !empty; document.body.classList.toggle('seq-empty', empty);
  $('btnSeqAdd').textContent = SEQ.motions.length ? '+ Motion' : '+ Motion 1';
}
function seqRefreshEmpty() { seqEmptyUI(); seqDraw(); rebuildRows(); }

// ---------------------------------------------------------------- add / edit dialog
let seqDlgEdit = null;
function openSeqDlg(editI, clipId) {
  seqDlgEdit = editI == null ? null : editI;
  const cs = $('sqClip'); cs.textContent = '';
  for (const grp of ['Procedural', 'Loops', 'CMU mocap', 'One-shot moves', 'Imported']) {
    const og = document.createElement('optgroup'); og.label = grp;
    for (const c of clips.filter((x) => x.group === grp)) { const o = document.createElement('option'); o.value = c.id; o.textContent = c.label; og.append(o); }
    if (og.children.length) cs.append(og);
  }
  const n = SEQ.motions.length, last = SEQ.motions[n - 1], m = seqDlgEdit != null ? SEQ.motions[seqDlgEdit] : null, first = m ? seqDlgEdit === 0 : n === 0;
  const pick = (re) => clips.find((c) => c.kind === 'loop' && re.test(c.name));
  cs.value = clipId || (m ? m.clipId : n ? ((pick(/jog.?slow/i) || pick(/jog.?forward/i) || clips[0]).id) : (clips.find((c) => c.c && c.c.name === 'Run_steady_fast') || clips[0]).id);
  cs.disabled = !!m;
  $('sqH').textContent = m ? `Motion ${seqDlgEdit + 1}: ${m.ctx.cur.name}` : `Add motion ${n + 1}`;
  $('sqStartL').hidden = first; $('sqBlendL').hidden = first; $('sqFeetL').hidden = first;
  $('sqBarsL').querySelector('span').textContent = m ? 'Bars (its whole length)' : first ? 'Bars' : 'Bars after the start bar';
  if (m) {
    $('sqStart').value = m.G + m.blend + 1; $('sqBlend').value = m.blend; $('sqBars').value = +m.ctx.A.cycles.toFixed(2); $('sqFeet').checked = m.phaseAuto !== false;
  } else {
    $('sqStart').value = last ? Math.round(last.G + last.N + 1) : 1; $('sqBlend').value = 2; $('sqBars').value = 8; $('sqFeet').checked = true;
  }
  $('sqStart').min = 2;
  seqDlgNote();
  $('sqOk').textContent = m ? 'Apply' : 'Add';
  $('sqDel').hidden = !m;
  $('seqDlg').hidden = false;
}
function seqDlgNote() {
  const n = SEQ.motions.length, m = seqDlgEdit != null ? SEQ.motions[seqDlgEdit] : null, first = m ? seqDlgEdit === 0 : n === 0;
  if (first) { $('sqNote').textContent = 'The first motion starts at bar 1. Every motion has its own automation (run controls, speeds, forcers, blends …).'; return; }
  const st = Math.round(+$('sqStart').value || 2), bl = Math.max(0, Math.round(+$('sqBlend').value || 0)), from = st - bl;
  $('sqNote').textContent = bl > 0 ? `It is placed from bar ${from}: bars ${from}–${st - 1} cross-fade from the motion before (cadence, speed and every bone ease over; feet put in step), and from bar ${st} only this motion plays.` : `It starts at bar ${st} with a cut (no blend bars).`;
}
for (const id of ['sqStart', 'sqBlend']) $(id).addEventListener('input', seqDlgNote);
$('sqOk').onclick = () => {
  const st = Math.round(+$('sqStart').value || 1), bl = Math.max(0, Math.round(+$('sqBlend').value || 0)), bars = Math.max(1, +$('sqBars').value || 8), feet = $('sqFeet').checked;
  if (seqDlgEdit == null) { if (seqAdd($('sqClip').value, st, bl, bars, feet) !== false) $('seqDlg').hidden = true; return; }
  const i = seqDlgEdit, m = SEQ.motions[i];
  if (i > 0) {
    const p = SEQ.motions[i - 1], need = (st - 1) - p.G;   // the motion before runs up to the start bar (the blend bars overlap its end)
    if (bl >= bars) { toast('The blend bars must be fewer than its bars.'); return; }
    if (need < bl + 1) { toast(`Start bar ${st} is too early for ${bl} blend bars (the motion before starts at bar ${p.G + 1}).`); return; }
    if (Math.abs(need - p.ctx.A.cycles) > 1e-6) seqSetBars(i - 1, need);
    m.blend = bl; m.phaseAuto = feet; m.cur0 = null;
  }
  if (Math.abs(bars - m.ctx.A.cycles) > 1e-6) seqSetBars(i, bars);
  for (const x of SEQ.motions) x.cur0 = null;
  $('seqDlg').hidden = true; seqReload();
};
$('sqCancel').onclick = () => { $('seqDlg').hidden = true; };
$('sqDel').onclick = () => { $('seqDlg').hidden = true; if (seqDlgEdit != null) seqRemove(seqDlgEdit); };
$('seqDlg').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('seqDlg').hidden = true; e.stopPropagation(); });
$('btnSeqAdd').onclick = () => openSeqDlg(null);
$('btnSeqEmpty').onclick = () => openSeqDlg(null);
(() => {
  const cv = $('seqCv'); let scrub = false;
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !seqActive()) return;
    const { bar, i } = seqHit(e);
    if (i >= 0 && i !== SEQ.sel) seqSelect(i, true);
    SEQ.T = seqTOfBar(bar); seqSetT(SEQ.T); scrub = true; cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', (e) => {
    if (scrub) { const { bar } = seqHit(e); seqSetT(seqTOfBar(bar)); return; }
    const { bar, i } = seqHit(e); const m = SEQ.motions[i];
    if (m) tip(e, `motion ${i + 1} · ${m.ctx.cur.name} · bars ${m.G + 1}–${m.G + m.N}${m.blend ? ` (blend ${m.G + 1}–${m.G + m.blend})` : ''} · bar ${(bar + 1).toFixed(2)} · click: select · double-click: settings · right-click: menu`); else tip(null);
  });
  cv.addEventListener('pointerup', () => { scrub = false; });
  cv.addEventListener('pointerleave', () => { if (!scrub) tip(null); });
  cv.addEventListener('dblclick', (e) => { const { i } = seqHit(e); if (i >= 0) openSeqDlg(i); });
  cv.addEventListener('contextmenu', (e) => {
    e.preventDefault(); const { i } = seqHit(e);
    const items = [];
    if (i >= 0) items.push({ label: `Motion ${i + 1} settings… (start bar, blend, bars)`, action: () => openSeqDlg(i) }, { label: `Remove motion ${i + 1}`, action: () => seqRemove(i) }, { sep: true });
    items.push({ label: 'Add motion…', action: () => openSeqDlg(null) }, { label: 'Clear sequence (start empty)', disabled: !SEQ.motions.length, action: seqClear });
    openMenu(e.clientX, e.clientY, items);
  });
  new ResizeObserver(() => seqDraw()).observe(cv);
})();
// whole-sequence frames for the timeline FBX export
function seqFrames(fps, travel) {
  const n = Math.max(2, Math.round(SEQ.Tend * fps) + 1), q = new Float32Array(n * B * 4), hp = new Float32Array(n * 3);
  const keep = { inPlace: S.inPlace, base: SEQ.base.clone(), T: SEQ.T };
  S.inPlace = !travel; SEQ.base.set(0, 0, 0);
  try {
    for (let i = 0; i < n; i++) {
      seqEval(Math.min(SEQ.Tend, i / fps), null);
      rig.bones.forEach((b, j) => b.quaternion.toArray(q, (i * B + j) * 4));
      worldP(rig.b.hips).toArray(hp, i * 3);
    }
  } finally { S.inPlace = keep.inPlace; SEQ.base.copy(keep.base); seqSetT(keep.T); }
  return { n, fps, q, hp };
}

// ---------------------------------------------------------------- forcers belong to their motion; copy one to others
function seqShowsSel() {   // is the selected motion under the playhead (so its forcers are drawn)?
  if (!seqActive() || !SEQ.g) return true;
  return seqWeight(SEQ.sel, seqBarOfT(SEQ.T)) > 0.02;
}
function seqCopyForcerMenu(fid) {
  const items = SEQ.motions.map((m, i) => (i === SEQ.sel ? null : { label: `Copy to motion ${i + 1} (${(m.ctx.cur.name || '').replace(/ \(.*$/, '')})`, action: () => toast(seqCopyForcer(fid, [i])) })).filter(Boolean);
  if (items.length > 1) items.push({ sep: true }, { label: 'Copy to every other motion', action: () => toast(seqCopyForcer(fid, SEQ.motions.map((m, i) => i).filter((i) => i !== SEQ.sel))) });
  return items;
}
// the copy lands on the same bars (its points are moved bar for bar onto the other motion's own timing)
function seqCopyForcer(fid, targets) {
  const f = (A.forcers || []).find((x) => x.id === fid); if (!f || !targets.length) return 'Nothing to copy.';
  const d0 = cur.dur, bars = {};
  for (const k of RES_KEYS) bars[k] = f[k].map((p) => ({ b: d0 > 0 ? clipTime(p.t) / d0 : p.t, v: p.v, k: p.k, e: p.e }));
  const live = ctxGrab(true); SEQ.motions[SEQ.sel].ctx = live;
  const done = [];
  try {
    for (const i of targets) {
      const m = SEQ.motions[i]; if (!m || i === SEQ.sel) continue;
      ctxPut(m.ctx, true);
      pushUndo();
      const n = JSON.parse(JSON.stringify(f)); n.id = 'f' + Date.now().toString(36) + Math.floor(Math.random() * 1e4) + i;
      const d = cur.dur, total = d > 0 ? clipTime(S.dur) / d : S.dur;
      for (const k of RES_KEYS) {
        const pts = bars[k].filter((p) => p.b <= total + 1e-6).map((p) => { const q = { t: Math.min(S.dur, d > 0 ? timeOfClipTime(p.b * d) : p.b), v: p.v, k: p.k || 0 }; if (p.e) q.e = p.e; return q; });
        n[k] = pts.length ? pts : flat(RES_SPEC[k].ref, S.dur);
      }
      A.forcers = A.forcers || []; A.forcers.push(n);
      if (f.mode === 'fixed') { /* a fixed forcer keeps its spot from the motion's own start */ }
      ensureEnds(); moveEndCache = null; editVersion++; holdCache.clear(); rebuildSpeedLUT(); lockCycles(true);
      m.ctx = ctxGrab(true); m.tab = null; done.push(i + 1);
    }
  } finally { ctxPut(SEQ.motions[SEQ.sel].ctx, true); }
  seqRebuild(true); seqRefreshUI(); save();
  return done.length ? `${f.name} copied to motion ${done.join(', ')} (same bars; it works there on its own).` : 'Nothing copied.';
}
