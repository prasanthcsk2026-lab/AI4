
// ============================================================================
//  LINKED MIRROR
//  A bone, group or IK effector added with "Mirror" drives its other-side twin: after every edit the twin is
//  rewritten from it (bone axes matched by what each axis does, with the sign that keeps the motion
//  symmetric; IK sideways moves, turns, rolls and swivels change sign). The twin shows as a read-only row,
//  and gizmo changes made on the twin are mirrored back onto the source.
// ============================================================================
function partnerOf(type, key) {
  if (type === 'bone') { const m = mirrorName(key); return m && boneIdx.has(m) ? m : null; }
  if (type === 'eff') { const m = mirrorEffId(key); return m && EFF_BY_ID[m] ? m : null; }
  return mirrorGroupId(key);
}
// "LeftArm" → "Arm", "Left hand" → "Hand": how a both-sides item is named
function sideless(s) { const r = String(s).replace(/\b(Left|Right)\s*/, '').replace(/(Left|Right)/, ''); return r.charAt(0).toUpperCase() + r.slice(1); }
function linkOf(type, key) {   // → the source key if this item is one side of a linked pair, else null
  const map = type === 'bone' ? A.bones : type === 'group' ? A.groups : A.ik, it = map && map[key];
  if (!it) { const to = partnerOf(type, key), p = to && map[to]; return p && p.mirror ? to : null; }
  return it.mirror ? key : it.mirrorOf || null;
}
function partnerLabel(type, key) {
  const to = partnerOf(type, key); if (!to) return null;
  return type === 'eff' ? EFF_BY_ID[to].label : type === 'group' ? groupLabel(to) : to;
}
const EFF_FLIP = new Set(['px', 'ry', 'rz', 'swivel']);   // across the body's mid-plane these change sign
function mirrorBoneCopy(name, target) {
  const src = A.bones[name], dst = newBoneAuto(S.dur);
  const labS = axisInfo[name] || {}, labD = axisInfo[target] || {};
  dst.whole = clonePts(src.whole); dst.withChildren = src.withChildren; dst.timing = clonePts(src.timing); dst.collapsed = src.collapsed;
  const show = { whole: src.show.whole, timing: src.show.timing };
  for (const sa of AXES) {
    const m = labS[sa] ? mirrorAxis(labS[sa], labD) : null;
    const [da, sign] = m || [sa, 1];
    dst.w[da] = clonePts(src.w[sa]);
    dst.a[da] = clonePts(src.a[sa], sign);
    show['w' + da] = src.show['w' + sa]; show['a' + da] = src.show['a' + sa];
  }
  dst.show = show;
  return dst;
}
function mirrorEffCopy(id, to) {
  const src = A.ik[id], dst = newEffAuto(to, S.dur);
  for (const k of EFF_BY_ID[id].tracks) dst.tr[k] = clonePts(src.tr[k], EFF_FLIP.has(k) ? -1 : 1);
  dst.show = { ...src.show }; dst.collapsed = src.collapsed;
  return dst;
}
function mirrorGroupCopy(gid) {
  const g = A.groups[gid], d = newGroupAuto(S.dur);
  d.weight = clonePts(g.weight); d.timing = clonePts(g.timing); d.show = { ...g.show }; d.collapsed = g.collapsed;
  return d;
}
function linkSets() { return [['bone', A.bones, A.order], ['group', A.groups, A.groupOrder], ['eff', A.ik, A.ikOrder]]; }
// rewrite every linked twin from its source (called after each edit)
function syncMirrors() {
  if (!A || !rig) return;
  for (const [type, map, order] of linkSets()) {
    for (const k of order) { const it = map[k]; if (it && it.mirrorOf && !(map[it.mirrorOf] && map[it.mirrorOf].mirror)) delete it.mirrorOf; }
    for (const k of [...order]) {
      const it = map[k]; if (!it || !it.mirror || it.mirrorOf) continue;
      const to = partnerOf(type, k); if (!to) { delete it.mirror; continue; }
      const copy = type === 'bone' ? mirrorBoneCopy(k, to) : type === 'group' ? mirrorGroupCopy(k) : mirrorEffCopy(k, to);
      copy.mirrorOf = k;
      map[to] = copy;
      if (!order.includes(to)) order.splice(order.indexOf(k) + 1, 0, to);
    }
  }
}
function setMirrorLink(type, key, on) {
  const map = type === 'bone' ? A.bones : type === 'group' ? A.groups : A.ik, it = map[key]; if (!it) return;
  if (on && partnerOf(type, key)) { it.mirror = true; delete it.mirrorOf; }
  else { delete it.mirror; const to = partnerOf(type, key); if (to && map[to] && map[to].mirrorOf === key) delete map[to].mirrorOf; }
}
// a gizmo change made on a twin is applied to its source, mirrored
function redirectMirrored(p) {
  if (!p) return p;
  if (p.kind === 'bone') {
    const ba = A.bones[p.name]; if (!ba || !ba.mirrorOf) return p;
    const src = ba.mirrorOf, labT = axisInfo[p.name] || {}, labS = axisInfo[src] || {}, deg = { x: 0, y: 0, z: 0 };
    for (const a of AXES) { const m = labT[a] ? mirrorAxis(labT[a], labS) : null; const [sa, sign] = m || [a, 1]; deg[sa] += p.deg[a] * sign; }
    return { kind: 'bone', name: src, deg };
  }
  const e = A.ik[p.id]; if (!e || !e.mirrorOf) return p;
  return {
    kind: 'eff', id: e.mirrorOf,
    dpos: p.dpos ? V3(-p.dpos.x, p.dpos.y, p.dpos.z) : null,
    drot: p.drot ? new THREE.Quaternion(p.drot.x, -p.drot.y, -p.drot.z, p.drot.w) : null,
    dswivel: -(p.dswivel || 0),
  };
}
