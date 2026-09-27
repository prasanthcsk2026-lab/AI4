# Animation Blender

A browser animation-modifier suite for the Stride Lab character. Pick a motion clip, then shape it on an
automation timeline with FK bone tracks and HumanIK-style full-body IK effectors. You can watch it in place
or travelling with its root motion, and export the result as JSON or as a baked glTF.

Published as the Claude artifact **Animation-Blender**:
<https://claude.ai/artifact/DNYiTRt5E2DCA1GQ9WjSN6>.
It grew out of `../stride-lab-studio/` (the original, untouched import).

## What it does

- **Groups** (Group…, the bone chip's "As group", or right-click a bone): one weight track, plus an
  optional timing track, for many bones.
  - Predefined groups: whole body, upper / lower body, spine, head & neck, and each side's arm, hand,
    fingers, leg, foot.
  - Custom groups: any bone plus everything below it.
  - Weights multiply: a bone's weight = its own × every group it is in. Left arm 60 % × Left hand 50 %
    leaves the hand at 30 % and the forearm at 60 %. Group timings add.
- **Linked mirror:** tick "Mirror → Right …" when adding (or editing) a bone, group or IK effector.
  - Its other-side twin is rewritten after every edit. Bone axes are matched by what each axis does,
    with the sign that keeps the motion symmetric. IK sideways moves, turns, rolls and swivels flip sign.
  - The twin shows as a read-only ⇄ row. A gizmo change made on the twin is mirrored back onto the source.
  - Right-click to unlink: the twin keeps its copy and becomes editable. Removing the source removes the twin.
- **FK tracks per bone:**
  - weight 0–200 % of the clip's rotation away from idle (whole bone and per axis)
  - adjust in degrees about each local axis
  - timing offset
- **Axis meanings:** every bone axis is labelled by measuring it. In the standing pose each axis is
  turned a few degrees and the tip's movement is read in the character's frame, giving labels like
  `+ swing forward · − swing back` or `twist + turn in · − turn out`. The labels are side-aware:
  "out" means away from the body on both sides. They appear in the track names, the add-tracks
  dialog, the selection panel and as a tripod on the selected bone.
- **Full-body IK effectors** (Add IK…, or click a square/ring handle):

  | Effector | Tracks |
  |---|---|
  | Hips | move, rotate, "feet stay planted" (the pelvis drops if needed to keep the feet reachable) |
  | Spine (lower back) | rotate the Spine bone |
  | Spine1 (mid back) | rotate Spine1; move bends Spine |
  | Chest | rotate, spread over the three spine bones; move bends Spine1 + Spine |
  | Neck | rotate the neck; move bends the upper spine |
  | Head | rotate, spread over neck and head; move bends neck, Spine2, Spine1 |
  | Shoulders | rotate the clavicle |
  | Hands | move, rotate, pin, hold, pull (the chest leans toward a target out of reach) |
  | Elbows, knees | swivel around the limb line |
  | Fingers | curl, spread, thumb |
  | Feet | move, rotate, hold |
  | Toes | bend |

  Torso moves use CCD with at most 45° per joint, so a far target is reached as close as the spine allows.
  Every effector is an offset over the FK result, so the clip keeps moving underneath.
  IK offsets are in world axes: X sideways, Y up, Z forward.
- **Gizmo:**
  - Rotate (R) and Move (W) drive bones and effectors, with a live preview.
  - Auto-key writes the change at the playhead when you let go. Otherwise use Key / Cancel.
  - The first key on a flat track sets the whole track; later keys add shape.
- **Auto foot-lock:** writes foot `hold` tracks from the clip's contact data, so planted feet stay
  fixed in the world.
- **World and camera:**
  - The ground is infinite: a shader grid drawn from world coordinates that follows the camera.
  - "In place" off: the character travels with the clip's root motion and keeps going across loops.
  - Follow keeps the camera on the character. Frame (F) re-centres it.
- **Precision:**
  - Drag a track's bottom edge to set its height.
  - Ctrl / Alt + wheel zooms a track's values. Tall tracks show a value grid.
  - Double-click a point, or click a track's value readout, to type an exact time and value.
  - Arrow keys nudge the selected points. Ctrl while dragging snaps.
- **Trail:** the path of the selected joint over the whole timeline.
- **Export:**
  - JSON automation (FK + IK) plus a 10 Hz sampling.
  - Save for Claude (the artifact database).
  - Baked glTF (character + animation at 30 fps) as a `.zip`, because the artifact host only
    allows downloads with certain extensions.

## Layout

```
src/index.html   page shell (markup, import map); build markers for CSS, JS and assets
src/style.css
src/engine.js    rig, anatomical IK solver, motion library, virtual FK, get-up library
src/core.js      scene + infinite ground, data model, store, undo, boot, bone / IK pickers
src/axes.js      measured bone-axis meanings, mirror, selection tripod
src/pose.js      root travel, FK composition, IK effectors + full-body solve, foot-lock
src/mirror.js    linked left/right mirror (sync after edits, gizmo redirect)
src/timeline.js  track rows (height, zoom, exact values), editing, menus, keys, ruler
src/viewport.js  gizmo + keying, IK handles, skeleton, picking, trail, camera follow, toggles
src/io.js        transport, JSON / glTF export + import, frame loop
assets/          character (base64 glb) and motion data
build.py         bundles everything into dist/animation-blender.html
```

All JS files share one module scope, concatenated in the order listed in `build.py`.

## Build and run

```sh
python3 animation-blender/build.py
python3 -m http.server -d animation-blender/dist 8000
# open http://localhost:8000/animation-blender.html
```

`dist/` is not committed; rebuild it after editing `src/`. three.js and the fonts load from CDNs.
