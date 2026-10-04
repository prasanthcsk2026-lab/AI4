
// ============================================================================
//  FBX EXPORT (binary FBX 7.4: skeleton + animation, no mesh)
//  One LimbNode per bone under an "Armature" node, one take with a translation and a rotation curve per bone.
//  Each bone's own (rest) transform is the character's bind pose, and a BindPose lists them: an importer that takes
//  the file's rest pose as its reference (our own import, Blender, Character Creator, Unreal …) then reads every frame
//  right. (The first frame as the rest pose put fingers up to 172° and arms 144° off after import.)
//  Units: centimetres (UnitScaleFactor 1), Y up; rotations as XYZ Euler in degrees (FBX's default order).
// ============================================================================
class FbxWriter {
  constructor() { this.parts = []; this.len = 0; }
  bytes(u8) { this.parts.push(u8); this.len += u8.length; }
  u8(v) { this.bytes(Uint8Array.of(v)); }
  u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); this.bytes(b); }
  str(s) { this.bytes(new TextEncoder().encode(s)); }
  // a node: [name, props, children]; props are [type, value] with type in I L D F S C d f l i
  node(name, props = [], children = null) {
    const start = this.len, patch = new DataView(new ArrayBuffer(12));
    this.bytes(new Uint8Array(patch.buffer));   // endOffset, numProps, propListLen, patched below
    const nm = new TextEncoder().encode(name); this.u8(nm.length); this.bytes(nm);
    const p0 = this.len;
    for (const [t, v] of props) this.prop(t, v);
    const plen = this.len - p0;
    if (children) { for (const c of children) this.node(...c); this.bytes(new Uint8Array(13)); }
    patch.setUint32(0, this.len, true); patch.setUint32(4, props.length, true); patch.setUint32(8, plen, true);
    void start;
  }
  prop(t, v) {
    this.u8(t.charCodeAt(0));
    const dv = (n) => { const b = new Uint8Array(n); return [b, new DataView(b.buffer)]; };
    if (t === 'I') { const [b, d] = dv(4); d.setInt32(0, v, true); this.bytes(b); }
    else if (t === 'L') { const [b, d] = dv(8); d.setBigInt64(0, BigInt(v), true); this.bytes(b); }
    else if (t === 'D') { const [b, d] = dv(8); d.setFloat64(0, v, true); this.bytes(b); }
    else if (t === 'F') { const [b, d] = dv(4); d.setFloat32(0, v, true); this.bytes(b); }
    else if (t === 'C') this.u8(v ? 1 : 0);
    else if (t === 'S') { const s = typeof v === 'string' ? new TextEncoder().encode(v) : v; this.u32(s.length); this.bytes(s); }
    else {   // arrays, uncompressed
      const size = { d: 8, f: 4, l: 8, i: 4 }[t], [b, d] = dv(v.length * size);
      v.forEach((x, k) => { if (t === 'd') d.setFloat64(k * 8, x, true); else if (t === 'f') d.setFloat32(k * 4, x, true); else if (t === 'l') d.setBigInt64(k * 8, BigInt(x), true); else d.setInt32(k * 4, x, true); });
      this.u32(v.length); this.u32(0); this.u32(b.length); this.bytes(b);
    }
  }
}
const FBX_SEC = 46186158000;   // FBX time ticks per second
function fbxName(n, cls) { const a = new TextEncoder().encode(n), b = new TextEncoder().encode(cls), o = new Uint8Array(a.length + 2 + b.length); o.set(a); o.set([0, 1], a.length); o.set(b, a.length + 2); return o; }
const P70 = (name, type, label, flags, ...vals) => ['P', [['S', name], ['S', type], ['S', label], ['S', flags], ...vals], null];
// frames: { n, fps, q: Float32Array(n × bones × 4) local rotations, hp: Float32Array(n × 3) hips world (m) }
function buildFbx(frames, takeName, nameOf = (n) => n) {   // nameOf: bone name in the file (e.g. Character Creator names)
  const bones = rig.bones, s = new THREE.Vector3(); bones[0].parent.getWorldScale(s);
  const unit = s.x * 100;   // bone local units → cm
  const armParent = bones[0].parent, apPos = worldP(armParent).multiplyScalar(100), apQ = worldQ(armParent);
  let nextId = 1000000; const id = () => ++nextId;
  const eulerDeg = (q, prev) => {
    const e = new THREE.Euler().setFromQuaternion(q, 'ZYX');   // FBX eEulerXYZ: R = Rz·Ry·Rx
    const v = [e.x / DEG, e.y / DEG, e.z / DEG];
    if (prev) for (let k = 0; k < 3; k++) { while (v[k] - prev[k] > 180) v[k] -= 360; while (v[k] - prev[k] < -180) v[k] += 360; }
    return v;
  };
  const n = frames.n, times = Array.from({ length: n }, (_, k) => Math.round((k / frames.fps) * FBX_SEC));
  const stop = times[n - 1];
  const objects = [], conns = [];
  const modelNode = (mid, name, t, r, sc) => ['Model', [['L', mid], ['S', fbxName(name, 'Model')], ['S', 'LimbNode']], [
    ['Version', [['I', 232]], null],
    ['Properties70', [], [P70('Lcl Translation', 'Lcl Translation', '', 'A', ['D', t[0]], ['D', t[1]], ['D', t[2]]), P70('Lcl Rotation', 'Lcl Rotation', '', 'A', ['D', r[0]], ['D', r[1]], ['D', r[2]]), P70('Lcl Scale', 'Lcl Scale', '', 'A', ['D', sc], ['D', sc], ['D', sc]), P70('InheritType', 'enum', '', '', ['I', 1])]],
    ['Shading', [['C', true]], null], ['Culling', [['S', 'CullingOff']], null],
  ]];
  const attr = (aid, name) => ['NodeAttribute', [['L', aid], ['S', fbxName(name, 'NodeAttribute')], ['S', 'LimbNode']], [['TypeFlags', [['S', 'Skeleton']], null]]];
  // the armature root carries the world placement of the skeleton's parent
  const armId = id(), armAttr = id();
  objects.push(attr(armAttr, 'Armature'), modelNode(armId, 'Armature', [apPos.x, apPos.y, apPos.z], eulerDeg(apQ), 1));
  conns.push(['OO', armAttr, armId], ['OO', armId, 0]);
  const stackId = id(), layerId = id();
  objects.push(['AnimationStack', [['L', stackId], ['S', fbxName(takeName, 'AnimStack')], ['S', '']], [['Properties70', [], [P70('LocalStop', 'KTime', 'Time', '', ['L', stop]), P70('ReferenceStop', 'KTime', 'Time', '', ['L', stop])]]]]);
  objects.push(['AnimationLayer', [['L', layerId], ['S', fbxName('BaseLayer', 'AnimLayer')], ['S', '']], []]);
  conns.push(['OO', layerId, stackId]);
  const curve = (cid, vals) => ['AnimationCurve', [['L', cid], ['S', fbxName('', 'AnimCurve')], ['S', '']], [
    ['Default', [['D', vals[0]]], null], ['KeyVer', [['I', 4009]], null],
    ['KeyTime', [['l', times]], null], ['KeyValueFloat', [['f', vals]], null],
    ['KeyAttrFlags', [['i', [(2 << 2) | (1 << 8) | (1 << 13) | (1 << 14)]]], null],   // linear
    ['KeyAttrDataFloat', [['f', [0, 0, 9.419963346924634e-30, 0]]], null],
    ['KeyAttrRefCount', [['i', [n]]], null],
  ]];
  const curveNode = (cnid, kind, v0) => ['AnimationCurveNode', [['L', cnid], ['S', fbxName(kind, 'AnimCurveNode')], ['S', '']], [['Properties70', [], [P70('d|X', 'Number', '', 'A', ['D', v0[0]]), P70('d|Y', 'Number', '', 'A', ['D', v0[1]]), P70('d|Z', 'Number', '', 'A', ['D', v0[2]])]]]];
  const ids = new Map(), hipsI = bones.indexOf(rig.b.hips), q = new THREE.Quaternion(), hipLocal = V3();
  // bind-pose world matrices (cm) for the BindPose: the armature node, then each bone from its parent
  const armW = new THREE.Matrix4().compose(apPos, apQ, V3(1, 1, 1)), bindW = new Map(), poseNodes = [['PoseNode', [], [['Node', [['L', armId]], null], ['Matrix', [['d', Array.from(armW.elements)]], null]]]];
  bones.forEach((b, i) => {
    const mid = id(), aid = id(); ids.set(b, mid);
    // rotations over the frames (continuous Euler), translation: bind (hips: animated)
    const rx = [], ry = [], rz = [], tx = [], ty = [], tz = []; let prev = null;
    for (let k = 0; k < n; k++) {
      q.fromArray(frames.q, (k * bones.length + i) * 4); prev = eulerDeg(q, prev); rx.push(prev[0]); ry.push(prev[1]); rz.push(prev[2]);
      if (i === hipsI) { hipLocal.set(frames.hp[k * 3], frames.hp[k * 3 + 1], frames.hp[k * 3 + 2]); b.parent.worldToLocal(hipLocal); tx.push(hipLocal.x * unit); ty.push(hipLocal.y * unit); tz.push(hipLocal.z * unit); }
    }
    const bd = rig.bind.get(b), lp = bd.lp, t0 = i === hipsI ? [tx[0], ty[0], tz[0]] : [lp.x * unit, lp.y * unit, lp.z * unit];
    // the rest transform: the bind pose (not the first frame)
    objects.push(attr(aid, nameOf(b.name)), modelNode(mid, nameOf(b.name), [lp.x * unit, lp.y * unit, lp.z * unit], eulerDeg(bd.lq), 1));
    const pm = b.parent && bindW.has(b.parent) ? bindW.get(b.parent) : armW;
    const mw = pm.clone().multiply(new THREE.Matrix4().compose(V3(lp.x * unit, lp.y * unit, lp.z * unit), bd.lq, V3(1, 1, 1))); bindW.set(b, mw);
    poseNodes.push(['PoseNode', [], [['Node', [['L', mid]], null], ['Matrix', [['d', Array.from(mw.elements)]], null]]]);
    conns.push(['OO', aid, mid], ['OO', mid, b.parent && ids.has(b.parent) ? ids.get(b.parent) : armId]);
    const rn = id(); objects.push(curveNode(rn, 'R', [rx[0], ry[0], rz[0]])); conns.push(['OO', rn, layerId], ['OP', rn, mid, 'Lcl Rotation']);
    for (const [ax, vals] of [['d|X', rx], ['d|Y', ry], ['d|Z', rz]]) { const cid = id(); objects.push(curve(cid, vals)); conns.push(['OP', cid, rn, ax]); }
    if (i === hipsI) {
      const tn = id(); objects.push(curveNode(tn, 'T', t0)); conns.push(['OO', tn, layerId], ['OP', tn, mid, 'Lcl Translation']);
      for (const [ax, vals] of [['d|X', tx], ['d|Y', ty], ['d|Z', tz]]) { const cid = id(); objects.push(curve(cid, vals)); conns.push(['OP', cid, tn, ax]); }
    }
  });
  objects.push(['Pose', [['L', id()], ['S', fbxName('BindPose', 'Pose')], ['S', 'BindPose']], [['Type', [['S', 'BindPose']], null], ['Version', [['I', 100]], null], ['NbPoseNodes', [['I', poseNodes.length]], null], ...poseNodes]]);
  const count = (t) => objects.filter((o) => o[0] === t).length;
  const W = new FbxWriter();
  W.str('Kaydara FBX Binary  '); W.bytes(Uint8Array.of(0, 0x1a, 0)); W.u32(7400);
  const now = new Date();
  W.node('FBXHeaderExtension', [], [
    ['FBXHeaderVersion', [['I', 1003]], null], ['FBXVersion', [['I', 7400]], null],
    ['CreationTimeStamp', [], [['Version', [['I', 1000]], null], ['Year', [['I', now.getFullYear()]], null], ['Month', [['I', now.getMonth() + 1]], null], ['Day', [['I', now.getDate()]], null], ['Hour', [['I', now.getHours()]], null], ['Minute', [['I', now.getMinutes()]], null], ['Second', [['I', now.getSeconds()]], null], ['Millisecond', [['I', 0]], null]]],
    ['Creator', [['S', 'Animation Blender']], null],
  ]);
  W.node('GlobalSettings', [], [['Version', [['I', 1000]], null], ['Properties70', [], [
    P70('UpAxis', 'int', 'Integer', '', ['I', 1]), P70('UpAxisSign', 'int', 'Integer', '', ['I', 1]),
    P70('FrontAxis', 'int', 'Integer', '', ['I', 2]), P70('FrontAxisSign', 'int', 'Integer', '', ['I', 1]),
    P70('CoordAxis', 'int', 'Integer', '', ['I', 0]), P70('CoordAxisSign', 'int', 'Integer', '', ['I', 1]),
    P70('UnitScaleFactor', 'double', 'Number', '', ['D', 1]), P70('OriginalUnitScaleFactor', 'double', 'Number', '', ['D', 1]),
    P70('TimeMode', 'enum', '', '', ['I', 14]), P70('CustomFrameRate', 'double', 'Number', '', ['D', frames.fps]),
    P70('TimeSpanStart', 'KTime', 'Time', '', ['L', 0]), P70('TimeSpanStop', 'KTime', 'Time', '', ['L', stop]),
  ]]]);
  const docId = id();
  W.node('Documents', [], [['Count', [['I', 1]], null], ['Document', [['L', docId], ['S', ''], ['S', 'Scene']], [['RootNode', [['L', 0]], null]]]]);
  W.node('References', [], []);
  const types = ['Model', 'NodeAttribute', 'Pose', 'AnimationStack', 'AnimationLayer', 'AnimationCurveNode', 'AnimationCurve'];
  W.node('Definitions', [], [['Version', [['I', 100]], null], ['Count', [['I', objects.length + 1]], null], ['ObjectType', [['S', 'GlobalSettings']], [['Count', [['I', 1]], null]]], ...types.map((t) => ['ObjectType', [['S', t]], [['Count', [['I', count(t)]], null]]])]);
  W.node('Objects', [], objects);
  W.node('Connections', [], conns.map(([k, a, b, p]) => ['C', [['S', k], ['L', a], ['L', b], ...(p ? [['S', p]] : [])], null]));
  W.node('Takes', [], [['Current', [['S', takeName]], null], ['Take', [['S', takeName]], [['FileName', [['S', takeName + '.tak']], null], ['LocalTime', [['L', 0], ['L', stop]], null], ['ReferenceTime', [['L', 0], ['L', stop]], null]]]]);
  W.bytes(new Uint8Array(13));   // end of the top-level node list
  // footer
  W.bytes(Uint8Array.from([0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66, 0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e]));
  W.bytes(new Uint8Array((16 - (W.len % 16)) % 16 || 16));
  W.u32(0); W.u32(7400); W.bytes(new Uint8Array(120));
  W.bytes(Uint8Array.from([0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e, 0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b]));
  const out = new Uint8Array(W.len); let o = 0; for (const p of W.parts) { out.set(p, o); o += p.length; }
  return out;
}
