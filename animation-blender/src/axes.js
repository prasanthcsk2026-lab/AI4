
// ============================================================================
//  WHAT EACH BONE AXIS DOES
//  Measured, not guessed: in the standing pose each local axis is turned by a few degrees and we look at
//  where the bone's tip goes (in the character's own frame: forward, up, left/right, out/in for a side).
//  An axis along the bone is a twist; the twist is named by where a reference direction rolls to.
// ============================================================================
const AXES = ['x', 'y', 'z'];
let axisInfo = {}, leftSign = 1;
const FWD = V3(0, 0, 1), UP = V3(0, 1, 0);
function sideOf(name) { return /Left/.test(name) ? 'L' : /Right/.test(name) ? 'R' : null; }
function lateralWord(side, xv) {
  if (!side) return (xv * leftSign > 0) ? 'left' : 'right';
  const outSign = side === 'L' ? leftSign : -leftSign;
  return xv * outSign > 0 ? 'out' : 'in';
}
const OPP = { forward: 'back', back: 'forward', up: 'down', down: 'up', left: 'right', right: 'left', out: 'in', in: 'out' };
const SHORT = { forward: 'fwd', back: 'back', up: 'up', down: 'down', left: 'left', right: 'right', out: 'out', in: 'in' };
function dominantWord(d, side) {
  const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
  if (az >= ax && az >= ay) return d.z > 0 ? 'forward' : 'back';
  if (ay >= ax) return d.y > 0 ? 'up' : 'down';
  return lateralWord(side, d.x);
}
function computeAxisInfo() {
  lib.sample(lib.idle, 0, Qi[0], Hi); applyPose(Qi[0], Hi);
  leftSign = rig.bp(rig.side.L.upper).x > rig.bp(rig.b.hips).x ? 1 : -1;
  axisInfo = {};
  const q = new THREE.Quaternion();
  for (const b of rig.bones) {
    const p = worldP(b), bq = worldQ(b);
    const child = b.children.find((o) => o.isBone);
    let tip = child ? worldP(child) : null;
    let dir = tip ? tip.clone().sub(p) : b.parent && b.parent.isBone ? p.clone().sub(worldP(b.parent)) : V3(0, 1, 0);
    if (dir.lengthSq() < 1e-10) dir.set(0, 1, 0);
    dir.normalize();
    if (!tip || tip.distanceTo(p) < 1e-4) tip = p.clone().addScaledVector(dir, 0.1);
    const side = sideOf(b.name), vertical = Math.abs(dir.y) > 0.6, center = !side;
    const info = {};
    for (const a of AXES) {
      const w = (a === 'x' ? AX : a === 'y' ? AY : AZ).clone().applyQuaternion(bq).normalize();
      qAxis(w, 0.2, q);
      let plus, type, verb;
      if (Math.abs(w.dot(dir)) > 0.7) {
        type = 'twist';
        const ref = vertical ? FWD.clone() : UP.clone();
        const d = ref.clone().applyQuaternion(q).sub(ref); d.addScaledVector(dir, -d.dot(dir));
        plus = dominantWord(d, side);
        verb = (word) => vertical ? (center ? 'turn ' + word : 'turn ' + word) : 'roll ' + word;
      } else {
        type = 'swing';
        const v = tip.clone().sub(p), d = v.clone().applyQuaternion(q).sub(v);
        plus = dominantWord(d, side);
        verb = (word) => {
          if (center && vertical) return { forward: 'bend forward', back: 'bend back', left: 'lean left', right: 'lean right', up: 'lift', down: 'drop' }[word];
          return { forward: 'swing forward', back: 'swing back', up: 'raise', down: 'lower', out: 'swing out', in: 'swing in', left: 'swing left', right: 'swing right' }[word];
        };
      }
      const minus = OPP[plus];
      info[a] = {
        type, plus, minus,
        short: (type === 'twist' ? 'twist ' : '') + `+${SHORT[plus]}/−${SHORT[minus]}`,
        long: `+ ${verb(plus)} · − ${verb(minus)}`,
      };
    }
    axisInfo[b.name] = info;
  }
}
// world axes of the IK offsets, named for this character
function worldAxisInfo(kind) {
  const lx = leftSign > 0 ? 'left' : 'right', rx = OPP[lx];
  if (kind === 'p') return {
    x: { short: `+${lx}/−${rx}`, long: `+ move ${lx} · − move ${rx}` },
    y: { short: '+up/−down', long: '+ move up · − move down' },
    z: { short: '+fwd/−back', long: '+ move forward · − move back' },
  };
  return {   // right-hand rule about the world axes
    x: { short: 'pitch +fwd', long: '+ tip forward · − tip back (about the sideways axis)' },
    y: { short: `yaw +${lx}`, long: `+ turn ${lx} · − turn ${rx}` },
    z: { short: `roll +${lx} up`, long: `+ ${lx} side up · − ${rx} side up` },
  };
}

function mirrorName(n) { if (/Left/.test(n)) return n.replace('Left', 'Right'); if (/Right/.test(n)) return n.replace('Right', 'Left'); return null; }
function mirrorAxis(src, dstInfo) {   // → [axis in the mirror bone, sign]
  for (const a of AXES) if (dstInfo[a] && dstInfo[a].type === src.type && dstInfo[a].plus === src.plus) return [a, 1];
  for (const a of AXES) if (dstInfo[a] && dstInfo[a].type === src.type && dstInfo[a].plus === src.minus) return [a, -1];
  return null;
}
function mirrorPair(name) {
  const target = mirrorName(name);
  if (!target || !boneIdx.has(target)) return;
  const src = A.bones[name]; if (!src) return;
  pushUndo();
  const dst = ensureBone(target);
  const labS = axisInfo[name] || {}, labD = axisInfo[target] || {};
  dst.whole = clonePts(src.whole); dst.withChildren = src.withChildren; dst.timing = clonePts(src.timing);
  const show = { whole: src.show.whole, timing: src.show.timing };
  for (const sa of AXES) {
    const m = labS[sa] ? mirrorAxis(labS[sa], labD) : null;
    const [da, sign] = m || [sa, 1];
    dst.w[da] = clonePts(src.w[sa]);
    dst.a[da] = clonePts(src.a[sa], sign);
    show['w' + da] = src.show['w' + sa]; show['a' + da] = src.show['a' + sa];
  }
  dst.show = show;
  rebuildRows(); save(); if (window.__slRebuildTree) window.__slRebuildTree();
}

// ---------------------------------------------------------------- axis tripod on the selection
let tripod = null;
function labelSprite() {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 64;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.renderOrder = 21; sp.scale.set(0.32, 0.04, 1); sp.center.set(0, 0.5);
  sp.userData = { cv, tex, text: '' };
  return sp;
}
function setSpriteText(sp, text, color) {
  if (sp.userData.text === text + color) return;
  sp.userData.text = text + color;
  const { cv, tex } = sp.userData, x = cv.getContext('2d');
  x.clearRect(0, 0, cv.width, cv.height);
  x.font = '600 30px "Barlow", system-ui, sans-serif';
  const w = Math.min(cv.width - 4, x.measureText(text).width + 20);
  x.fillStyle = 'rgba(11,14,12,.82)'; x.beginPath(); x.roundRect(2, 8, w, 48, 10); x.fill();
  x.fillStyle = color; x.fillText(text, 12, 43);
  tex.needsUpdate = true;
}
function buildTripod() {
  const g = new THREE.Group(); g.visible = false; g.renderOrder = 20;
  const lines = {}, sprites = {};
  for (const a of AXES) {
    const geo = new THREE.BufferGeometry().setFromPoints([V3(), (a === 'x' ? AX : a === 'y' ? AY : AZ).clone().multiplyScalar(0.2)]);
    const ln = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: AXIS_COL[a], depthTest: false, transparent: true }));
    ln.renderOrder = 20; g.add(ln); lines[a] = ln;
    const sp = labelSprite(); sprites[a] = sp; scene.add(sp);
  }
  scene.add(g);
  tripod = { g, lines, sprites };
}
function updateTripod() {
  if (!tripod) return;
  const { g, sprites } = tripod;
  let info = null, pos = null, rot = null;
  if (S.selected && boneIdx.has(S.selected)) {
    const b = rig.bones[boneIdx.get(S.selected)];
    pos = worldP(b); rot = worldQ(b); info = axisInfo[S.selected];
  } else if (S.selEff) {
    const d = EFF_BY_ID[S.selEff]; pos = effPos(d); rot = new THREE.Quaternion();
    info = d.tracks.includes('px') ? worldAxisInfo('p') : d.tracks.includes('rx') ? worldAxisInfo('r') : null;
  }
  const on = !!(info && pos);
  g.visible = on;
  for (const a of AXES) sprites[a].visible = on;
  if (!on) return;
  g.position.copy(pos); g.quaternion.copy(rot);
  for (const a of AXES) {
    const end = (a === 'x' ? AX : a === 'y' ? AY : AZ).clone().multiplyScalar(0.21).applyQuaternion(rot).add(pos);
    sprites[a].position.copy(end);
    setSpriteText(sprites[a], `${a.toUpperCase()}  ${info[a] ? info[a].short : ''}`, AXIS_COL[a]);
  }
}
function axesLegendHTML(info) {
  return AXES.map((a) => info && info[a] ? `<div class="axrow"><b style="color:${AXIS_COL[a]}">${a.toUpperCase()}</b><span>${info[a].type === 'twist' ? '<em>twist</em> ' : ''}${info[a].long}</span></div>` : '').join('');
}
