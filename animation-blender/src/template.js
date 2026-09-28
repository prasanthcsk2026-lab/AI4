
// ============================================================================
//  TEMPLATES: Sprint → Jog (decelerate)
//  Writes a set of tracks onto the timeline for a loop clip (a sprint): full speed for the first bars, then from the
//  start bar to the end bar the cadence drops (cycle speed), the feet stay down longer (foot on ground, with a
//  braking bump in the middle), knee lift and arm swing shrink (leg / arm group weights), the chest straightens
//  (Chest rotate X) and the hips rise a little (Hips move Y); from the end bar on it holds the jog. The ground
//  covered drops to the chosen share of the sprint (moving speed). Every value stays editable afterwards.
// ============================================================================
const TPL_DEF = { cycles: 10, from: 3, to: 8, cad: 72, gnd: 10, bump: 15, legs: 75, arms: 65, torso: 55, lean: -6, hips: 3, travel: 45, speed: 7 };
function tplVals() {
  const v = {}; for (const k of Object.keys(TPL_DEF)) v[k] = +$('tpl_' + k).value;
  v.cycles = clamp(Math.round(v.cycles), 2, 200); v.from = clamp(Math.round(v.from), 1, v.cycles - 1); v.to = clamp(Math.round(v.to), v.from + 1, v.cycles);
  v.cad = clamp(v.cad, 25, 100); v.gnd = clamp(v.gnd, 0, GND_MAX); v.bump = clamp(v.bump, 0, GND_MAX); v.legs = clamp(v.legs, 0, 200); v.arms = clamp(v.arms, 0, 200); v.torso = clamp(v.torso, 0, 200);
  v.travel = clamp(v.travel, 5, 100); v.speed = clamp(v.speed, 0, 15);
  return v;
}
function applySprintToJog(v) {
  if (!cur || cur.kind !== 'loop') return 'Pick a loop clip (the sprint) first.';
  pushUndo();
  const dur = cur.dur, ease = -0.35;   // curve shape on the ramps: eases into the slowdown
  if (!(cur.c.speed > 0.05) && v.speed > 0 && cur.c.imported) impSetSpeed(cur, v.speed);   // an in-place file: give it its travel
  // 1. a long enough timeline, then cycle speed, placed where the bars fall (they move once cadence drops)
  S.dur = A.dur = +(v.cycles * dur / (v.cad / 100) + 1).toFixed(3);
  const barT = (k) => timeOfClipTime((k - 1) * dur);
  A.cyc = [{ t: 0, v: 100, k: 0 }, { t: 0, v: 100, k: ease }, { t: 0, v: v.cad, k: 0 }, { t: S.dur, v: v.cad, k: 0 }];
  for (let it = 0; it < 10; it++) {   // the end bar's time depends on the slowdown before it
    rebuildSpeedLUT();
    const t0 = barT(v.from), t1 = barT(v.to);
    A.cyc[1].t = t0; A.cyc[2].t = t1;
  }
  rebuildSpeedLUT();
  const T = timeOfClipTime(v.cycles * dur), t0 = barT(v.from), t1 = barT(v.to);
  const tAt = (f) => timeOfClipTime(((v.from - 1) + f * (v.to - v.from)) * dur);   // f: 0 = start bar, 1 = end bar
  S.dur = A.dur = +T.toFixed(3);
  A.cyc[A.cyc.length - 1].t = S.dur; A.cycV2 = true; A.barSpeed = {};
  const ramp = (a, b) => [{ t: 0, v: a, k: 0 }, { t: t0, v: a, k: ease }, { t: t1, v: b, k: 0 }, { t: S.dur, v: b, k: 0 }];
  // 2. foot on ground: up to the jog value with a braking bump in the middle of the slowdown
  A.gnd = [{ t: 0, v: 0, k: 0 }, { t: t0, v: 0, k: 0 }, { t: tAt(0.4), v: v.bump, k: 0 }, { t: tAt(0.8), v: v.bump, k: 0 }, { t: t1, v: v.gnd, k: 0 }, { t: S.dur, v: v.gnd, k: 0 }];
  // 3. ground covered: the travel falls to `travel` % of the sprint; cadence already gives cad %, moving speed the rest
  A.move = ramp(1, clamp(v.travel / v.cad, 0.05, 3));
  A.showMaster.cycle = true; A.showMaster.gnd = true; A.showMaster.move = true;
  // 4. pose: knee lift and arm swing (group weights). The sprint's own forward lean is baked into the spine motion,
  // so straightening it takes the same trick as the legs and arms: turn down how much of that motion plays (the
  // "g:spine" group), not just a small extra tilt (Chest rotate X, kept for a bit of fine control).
  for (const [gid, w] of [['g:Lleg', v.legs], ['g:Rleg', v.legs], ['g:Larm', v.arms], ['g:Rarm', v.arms], ['g:spine', v.torso]]) { const g = ensureGroup(gid); g.weight = ramp(1, w / 100); g.timing = flat(0, S.dur); g.show = { weight: true }; }
  const ch = ensureEff('chest'); for (const k of Object.keys(ch.tr)) ch.tr[k] = flat(TRK[k].ref, S.dur); ch.tr.rx = ramp(0, v.lean); ch.show = { rx: true };
  const hp = ensureEff('hips'); for (const k of Object.keys(hp.tr)) hp.tr[k] = flat(TRK[k].ref, S.dur); hp.tr.py = ramp(0, v.hips); hp.show = { py: true };
  S.lenMode = 'cycles'; $('lenMode').value = 'cycles';
  S.t = 0; S.v0 = 0; moveEndCache = null; editVersion++;
  rebuildSpeedLUT(); syncLenInputs(); rebuildRows(); save();
  return `Sprint → Jog written: ${v.cycles} cycles (${S.dur.toFixed(2)} s), slowing from bar ${v.from} to bar ${v.to}. Run "Auto foot-lock" to plant the longer contacts.`;
}
function openTemplate() {
  const dlg = $('tplDlg'); dlg.hidden = false; $('tplNote').textContent = '';
  for (const [k, d] of Object.entries(TPL_DEF)) if ($('tpl_' + k).value === '') $('tpl_' + k).value = d;
  $('tplSpeedRow').hidden = !(cur && cur.c.imported && !(cur.c.speed > 0.05));
  $('tplClip').textContent = cur ? cur.name : '—';
}
$('tplGo').onclick = () => { $('tplNote').textContent = applySprintToJog(tplVals()); };
$('tplReset').onclick = () => { for (const [k, d] of Object.entries(TPL_DEF)) $('tpl_' + k).value = d; };
$('tplClose').onclick = () => { $('tplDlg').hidden = true; };
$('tplDlg').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('tplDlg').hidden = true; });
