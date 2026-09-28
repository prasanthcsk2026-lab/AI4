# Animation Blender

A browser animation-modifier suite for the Stride Lab character. Pick a motion clip, then shape it on an
automation timeline with FK bone tracks and HumanIK-style full-body IK effectors. You can watch it in place
or travelling with its root motion, and export the result as JSON or as a baked glTF.

Published as the Claude artifact **Animation-Blender**:
<https://claude.ai/artifact/DNYiTRt5E2DCA1GQ9WjSN6>.
It grew out of `../stride-lab-studio/` (the original, untouched import).

## What it does

- **Bone picker:** parts (body, each arm, each hand's fingers as segment chips, each leg). Finger joints
  can also be clicked in the viewport (small dots).
- **Groups** (Group…, the bone chip's "As group", or right-click a bone): one weight track, plus an
  optional timing track, for many bones.
  - Predefined groups: whole body, upper / lower body, spine, head & neck, and each side's arm, hand,
    fingers, leg, foot.
  - Custom groups: any bone plus everything below it.
  - Weights multiply: a bone's weight = its own × every group it is in. Left arm 60 % × Left hand 50 %
    leaves the hand at 30 % and the forearm at 60 %. Group timings add.
- **Mirror (both sides):** the add / edit dialog of any bone, group or IK effector has a Mirror option.
  It is on by default and remembers your last choice.
  - When on, the item is one row named without a side ("Arm", "Leg", "Hand"), tagged ⇄ L+R.
  - Every edit is applied to the left and right. Bone axes are matched by what each axis does; IK
    sideways moves, turns, rolls and swivels flip sign.
  - A gizmo change made on the other side's joint is mirrored back.
  - Turn "Both sides" off (right-click) to split them into two editable rows.
- **Length or Cycles** (header, "Set by"): set the timeline either by its length in seconds or by how
  many clip cycles it holds; the other value follows. The clip's cadence never changes; only the
  playback-speed track changes speed. New clips start at 10 s in Length mode, or 5 cycles in Cycles mode.
- **Symmetrize tool** (header → Symmetrize, a side panel):
  - Load an in-place loop.
  - Mode **Average** (default): the clip is first retimed, then every bone is averaged with the mirror of its
    other-side twin half a cycle away (centre bones with their own mirror), with a slerp relative to the parent,
    and the hips position likewise. Both sides keep half of their own motion and the result is symmetric.
  - Mode **Copy**: one side's arms and/or legs replace the other's (right → left or left → right), with a cycle split.
  - Strength scales either mode.
  - Feet on bars retimes the cycle so the chosen foot lands at 0 % and the other at 50 %. Before / after contacts and step times are shown.
  - The mirrored side gets the whole cycle of the source side, half a cycle away, so none of its old motion is left.
  - Even swing retimes back-most → passing under the hips = passing → front-most for both feet.
  - Centre averages hips, spine, neck and head with their mirror half a cycle away, so the body sways alike both ways.
  - The retime is a smooth monotone spline, so there are no sudden speed changes. A loop-seam check says whether last → first frame joins smoothly.
  - Every Save is kept as a version (the newest 8 per clip); Restore any of them, or Revert to original.
  - It previews live on the character. Save replaces the clip: on the timeline the feet then fall on the bars for any number of cycles.
  - Save to project stores it for Claude to apply to the project files.
  - Export writes N cycles, in place or with travel, as FBX or glTF (each zipped).
- **Symmetrize on the timeline** (Group… → Symmetrize): arms or legs, right → left or left → right.
  - The target side takes the other side's clip motion from half a cycle away, mirrored across the
    body's mid-plane.
  - It is measured relative to the chest (arms) or pelvis (legs), and blended by a weight track
    (100 % = fully symmetric). A cycle split track (50 % = even) evens out unequal steps.
  - Viewport readouts show each hand's peak reach forward of the hips (R / L / Δ cm) and the step times
    measured from the feet as they are (L→R / R→L / Δ s).
- **Help:** the "i" button beside IK… explains the timeline.
- **Master tracks are optional** ("+" beside Group… / Bone… / IK…): playback speed, moving speed, and cycle speed + bar reach. Hidden ones keep their values.
- **Bar reach:** click a quarter-bar segment to make it v % faster (speed × (1 + v/100)) or slower. A change carries on into later segments until changed again, and changes multiply (10 then 10 = × 1.21). Each cell shows its value and the running factor.
- **Cycle speed** (automation, speed %): 100 = neutral, 150 = 1.5 × as fast (older saves are converted). It eases between points and multiplies with bar reach.
- **Realtime bars** (header checkbox): bar lines where the bars really fall after bar reach / cycle speed; off keeps them evenly spaced.
- **Timeline zoom:** the scroll bar under the tracks (drag to scroll, drag its ends to zoom), Ctrl + wheel to zoom at the cursor, Shift + wheel to scroll, Fit for the whole length. It follows the playhead while playing. Alt + wheel zooms a track's values.
- **Viewport layout:**
  - Left toolbar: Select (Q), Move (W), Rotate (E), Auto-key.
  - Top right: View (bones, IK, ghost, limits, trail + falloff).
  - Bottom right: World (in place, follow, frame).
- **Moving speed** (master track): scales the ground the character covers without changing the cadence.
  Playback speed changes the cadence. Both can be automated; travel integrates moving speed over time.
- **Grid units** (Grid in the header): Seconds, Frames (30 fps), Cycles (bars of the clip loop), or Foot
  steps. Foot steps shows the left / right contact (lock) spans in their own colours and labels L1, R1, L2…
  The ruler, lane grid and snapping use the chosen unit; its readout (with L / R contact dots for foot steps) sits in the viewport, bottom-left.
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
  | Spine (lower back) | rotate the Spine bone; move shifts half through the pelvis and tilts it for the rest (feet stay planted) |
  | Spine1 (mid back) | rotate Spine1; move bends Spine |
  | Chest | rotate, spread over the three spine bones; move bends Spine1 + Spine |
  | Neck | rotate the neck; move bends the upper spine |
  | Head | rotate, spread over neck and head; move bends neck, Spine2, Spine1 |
  | Shoulders | rotate the clavicle |
  | Hands | move, rotate, pin, hold, pull (the chest leans toward a target out of reach) |
  | Elbows, knees | swivel around the limb line; rotate turns the forearm / shin (the hand / foot keeps its orientation) |
  | Fingers | curl, spread, thumb; rotate turns all fingers |
  | Feet | move, rotate, hold |
  | Toes | bend, rotate |
  | Group IK | one handle moves / rotates several effectors about a pivot (arm, leg, both hands, both feet, upper body, whole body, or custom) |

  Torso moves use CCD with at most 45° per joint, so a far target is reached as close as the spine allows.
  Every effector is an offset over the FK result, so the clip keeps moving underneath.
  IK offsets are in world axes: X sideways, Y up, Z forward.
- **Group IK** (IK… → Group IK, or "+ New custom group IK…"):
  - Set the share (%) each member takes of the move, and the pivot it rotates about.
  - Members already carried by another member of the same group take no extra share, so nothing moves
    twice. An unpinned hand on a moving chest is one example.
  - Arm / leg groups mirror as both sides.
- **IK controller (a point between joints):** IK… → "+ New IK controller…".
  - Link any hands, feet, hips, spine or head, each with its own share. The point sits at their weighted centre.
  - Drag it and they follow: for example, both hands 100 % reach for a ball while the hips travel 40 %.
  - The head can look at it.
- **Anatomical limits** (Limits button, on by default): cones for spine, neck, head, collarbones,
  elbows, wrists, knees, ankles and toes; hip flexion −30…125° and abduction −25…45°; shoulder swing
  at most 55° behind and 140° across. They act only on joints the IK changed; a joint at a limit turns red.
- **Bake / Project…:**
  - Bake & replace turns the result into the clip's own frames; Revert brings the original back.
  - Save to project stores it in the artifact database for Claude to write into the project files.
  - Download gives the baked clip as .json.
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
- **Delete a track:** the × on a track header (shown on hover) or right-click → Delete track. Its automation is cleared and it leaves the timeline. An item with no tracks left is removed. Ctrl+Z brings it back.
- **Precision:**
  - Drag a track's bottom edge to set its height.
  - Ctrl / Alt + wheel zooms a track's values. Tall tracks show a value grid.
  - Double-click a point, or click a track's value readout, to type an exact time and value.
  - Magnet (🧲, next to Grid): new and dragged points stick to the chosen unit's lines. Ctrl also snaps the value.
  - Arrow keys nudge the selected points.
  - Track separators are drawn bold; each bone / group / IK block starts with a brighter line.
- **Trail:** the path of the selected joint over the whole timeline, with dots on the grid unit's lines
  (magnet on) or every 0.1 s.
  - Drag a dot to reshape the path. The change is keyed at that dot's time. The ± falloff (s) next to the
    Trail button adds anchors that keep the edit local.
  - Where the edit is written:
    - IK joints (hands, feet, hips, spine, chest, neck, head): their Move tracks.
    - Forearm / shin: elbow / knee swivel.
    - Any other bone: its parent's FK adjust.
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
src/mirror.js    both-sides mirror (sync after edits, side-less names, gizmo redirect)
src/timeline.js  track rows (height, zoom, exact values), editing, menus, keys, ruler
src/viewport.js  gizmo + keying, IK handles, skeleton, picking, trail, camera follow, toggles
src/bake.js      bake & replace, save to project, baked clip export
src/fbx.js       binary FBX 7.4 writer (skeleton + animation)
src/symtool.js   symmetrize tool panel (mirror, feet-on-bars retime, save, export)
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
