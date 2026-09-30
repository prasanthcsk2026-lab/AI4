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
  - **Swing ease** (−100…+100):
    - The hands' and feet's forward swing gives one speed profile, and the whole cycle is retimed with it.
      Plus spreads the motion more evenly (less time hanging at the ends); minus makes it hang longer at the ends.
    - Each half cycle is warped separately, so the feet stay on the bars and every bone keeps in step.
    - A readout shows the time spent in the outer "ends zone" % of the swing, before → after.
    - Swing ease is applied last, so it wins over Even swing.
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
- **Master tracks are optional** ("+" beside Group… / Bone… / IK…): playback speed, moving speed, cycle speed, stride length, foot on ground. Hidden ones keep their values.
- **Cycle speed** (automation, speed %): 100 = neutral, 150 = 1.5 × as fast (older saves are converted). It eases between points.
- **Realtime bars** (header checkbox): on, the timeline is in real seconds and the bars move with playback / cycle speed. Off, the timeline is in bar space: every bar is the same width, and feet, curves and the playhead follow the bars.
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
- **Every delete asks first** (tracks, items, points, Reset clip, Revert): Enter = Delete, Esc = Cancel.
- **Colours:** each kind of track has a muted stripe and tint: master violet, groups blue, bones orange, IK teal, symmetrize pink.
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

## Import FBX (Character Creator)
**Import FBX…** reads a CC / iClone FBX (`CC_Base_` bones, auto-mapped; the mapping can be changed), picks a take, finds the left-foot landings and cuts one loop (or a one-shot), The travel is taken out and kept as speed + direction, so the header **In place** toggle decides whether it travels. Imported clips live in this browser's cache (IndexedDB) until **Save to project** stores them in the artifact database; cache clips can be deleted from the dialog.

## Deleting
Deletes happen at once with a **Deleted · Undo** toast. Right double-click deletes whatever is under the cursor; a single right-click opens the menu. Reset clip and Revert still ask first.

## Symmetrize
One cycle from left-foot landing to left-foot landing; each half is stretched uniformly so the right foot lands at the middle. Output keeps the clip's own frame count with no repeated frames. Modes: **Phase matching only** (default: timing only, every pose untouched), **Phase matching + average arms** (shoulder → hand matched to the other side half a cycle later, strength slider), **Average whole body**, **Copy one side**. **Even swing** is optional (off by default).

## Foot on ground (braking)
Master "+" → **Foot on ground**: +g % of the cycle (0–30) lengthens each foot's contact and shortens its swing by the same amount, cycle length unchanged. Automate it together with a lower cycle / moving speed for a natural braking stop. Auto foot-lock follows the longer contacts.

## Timeline
Foot landings are coloured vertical lines through the lanes (left purple, right orange). While a timing point (playback / moving / cycle speed, foot on ground) is dragged, the bars, grid and ruler stay put and the character previews the new timing; the layout updates on release, lanes and ruler together.

## Custom IK controllers
Custom controllers have their own section in the IK dialog and on the timeline (tag **IK CUST**), and their handles (blue) show whenever the IK view is on.

## Template: Sprint → Jog (decelerate)
Master "+" → **Template: Sprint → Jog (decelerate)…** on a loop clip writes cycle speed, foot on ground (with a braking bump), moving speed, leg / arm group weights, Chest rotate X and Hips move Y: full sprint until the start bar, a slowdown to the end bar, then a jog. Defaults: 10 cycles, bars 3 → 8, cadence 72 %, foot on ground +10 % (+15 % braking), knee lift 75 %, arm swing 65 %, torso lean (spine group) 55 % (the main straightening — a small Chest rotate X on top fine-tunes it), hips +3 cm, ground speed 45 %. The Cycles field counts the cycles the timeline really holds. Imported in-place clips take a travel speed (m/s) in the import list or in the template; a file holding one cycle is used whole as the loop.

## Bars stay put
Playback speed and cycle speed are what turn clip time into real seconds; editing either one moves where the bars fall. Every point on every track — the playback and cycle speed tracks' own points included — is re-timed automatically so it stays on the same bar it was placed on (a speed point dragged up or down stays on its bar even though its value re-times the bars before it). Dragging a point straight up or down never moves it in time; drag sideways to move it to another bar. Each track's own end anchor stays at the timeline's end.

## Adding a point
Clicking an empty spot on a track adds a point at that time with the value the curve already had there, so the line doesn't jump — drag (without releasing) to actually set a value.

## Foot lock
**Foot lock…** writes Hold tracks on the Left / Right foot IK from the clip's contacts. The lock eases in after a landing (landing blend, default 0.03 s) and out after it lets go (release blend, default 0.12 s): the gap between the held spot and the foot's own path at the release is carried on and faded, so the foot never snaps. The dialog reports how far each foot's animation drifts while locked; **Match moving speed** scales the moving speed track so the ground travel matches the feet (the drift that remains comes from the clip's own foot slide within a contact).

## Templates (save / open)
Master "+" → **Templates: save / open…** saves the timeline you built as a named template (in this browser, and in the project store when the page has one) and opens it on any clip. Points are stored by bar (clip cycles), so they land on the same bars on another clip whatever its cycle length or speeds; opening replaces that clip's timeline (Ctrl+Z undoes it).

## Symmetrize: odd frame counts, None
The result's foot contacts are measured on a fine resample, so with an odd frame count the other foot still reads (and shows) at exactly half a cycle. **Even frames** optionally rounds an odd count up by one so that landing falls on a frame. Mode **None** keeps timing and poses as they are (Steadiness still applies).

## Workspace (Vegas-style)
Menu bar (File, Edit, Insert, Tools, View, Help), a main toolbar (undo / redo, Select / Move / Rotate / Auto-key, Snap, Templates, Symmetrize, Foot lock) with a big time display (bar . quarter, seconds, frame). The middle is split: an options dock on the left (30 %, drag the divider, double-click to reset; sections Clip, Selection, View, Readouts, Tools, Import / Export remember open / closed; the Symmetrize tool opens inside it) and the 3D viewport on the right (70 %). Under the timeline a transport bar: start, previous bar, play, stop (back to where play started), next bar, end, loop, clock and status. Track headers carry an **M** (mute) button that turns a bone, group, IK effector or symmetrize item off without deleting it. The ruler's end line reads "bar N end" on its lower line, so the last bar keeps its own label.

## Stride length
Master "+" → **Stride length** (50–150 %, like cycle speed): each foot reaches that much further ahead of and behind the hips (foot IK; the pelvis drops if a foot would be out of reach), the ground covered grows by the same share so the feet do not slide, and the arm swing follows (toggle "Arm swing follows the stride" in the same menu). The Readouts show cadence (steps / min), step length and ground speed at the playhead. The Sprint → Jog template now shortens the stride (default 70 %) instead of only slowing the travel.

## Timeline blocks and editing
- Blocks (bone, group, IK, symmetrize) show in the order they were added, new ones at the end; drag a block's ⋮⋮ grip to move it. A block's tracks sit indented under its header with a guide line in the block's colour.
- Inserting bars in the middle moves every later point on by the same number of bars and adds no points: a curve across the new bars stretches (100 at bar 5 and 150 at bar 7 become 100 at bar 5 and 150 at bar 9).
- Value magnet (with Snap on): dragging a point up or down holds for a moment (0.25 s) when it reaches a neighbour's value, the track's default or another point's value, with a dashed guide and a note in the tooltip; hold Alt to drag free.

## In-place FBX travel, ruler numbers
- Importing an in-place FBX (no travel in the file) shows a **Travel speed** field, pre-filled with an estimate from the feet (while a foot is down it sweeps back under the hips as far as the body moves); the clip then moves with In place off. The Clip panel has a **Travel (m/s)** field for imported clips, and turning In place off on a clip without travel says why nothing moves.
- The ruler shows bar numbers **1, 2, 3…** large and quarters **1.1, 1.2, 1.3** small; the end reads "10 |". The big time display reads the same way (3, 3.2).

## Moving speed, bar copy / paste, curves, whole-timeline FBX
- **Speed readout**: the viewport's top-right shows the character's moving speed at the playhead (m/s, km/h, moving %, and "in place" when the view is pinned). Readouts has a speed graph over the whole timeline: bar marks, the playhead, hover to read, click to seek.
- **Upper body (no hips)**: a separate bone group, first in the list (spine and everything above it). It has no IK controller. The original Upper body group is unchanged.
- **Bar copy / paste**: right-click the ruler for Copy bar / Copy bars… and Paste (replace or insert). Ctrl+Shift+C / V copy or paste the playhead's bar. Every track's points in those bars are copied.
- **Curve presets**: right-click a point for Linear, Ease in, Ease out, Ease in-out, or Step (hold). A preset applies to every selected point.
- **Export FBX (whole timeline)** (File menu): bakes every frame of the timeline with all automation. Options: 30 or 60 fps, travel or in place, and Mixamo or Character Creator (CC_Base_) bone names. The file downloads as a zip.


## Bar reach removed
The Bar reach % row is gone. Timing comes from playback speed and cycle speed only. Older saves and JSON files with bar reach values still load; the values are ignored and the bar count stays locked.

## Template: Sprint → Jog 2 m/s, braking (bars 3–7)
"+" menu or Tools menu. Built for a sprint loop: 10 bars, bars 1–2 sprint, the slowdown runs through bars 3–7, bars 8–10 jog at 2 m/s. Based on running-deceleration studies: speed drops through both step rate and step length; the trunk tips back and the knees bend to brake; then the body straightens into an upright jog.
- **Cadence** (cycle speed) drops to 165 steps/min. **Stride length** drops so that cadence × stride = 2 m/s with the feet planted.
- **Trunk**: the sprint's forward lean eases out (Spine group). The chest tips back while braking (bars 4–5), then settles slightly forward. The head counters it.
- **Hips**: dip about 4 cm while braking (the knees bend), then rise for the upright jog.
- **Legs**: less knee lift and heel kick (knee weight only, so the stance sweep and the feet stay matched). **Arms**: shorter swing at the shoulder only (upper-arm weight); the elbow bend stays.
- **No foot lock, no foot-on-ground stretch** (a longer contact without a lock slides). Re-running the template removes a leftover foot lock. Add one afterwards with Foot lock… if you want it.
- Measured on Sprint.fbx: 5.18 → 2.00 m/s, trunk lean 20° → 2° (braking) → 8.5° (jog), foot slip 3.6–6 cm per bar (the sprint clip itself: 6.5).

Fix: Stride length now also applies while the Hips IK keeps the feet planted. Before, it was cancelled.

## Template: Sprint → Decel 2.1 m/s, braking run (bars 3–7)
"+" menu or Tools menu. Same layout as the jog template (10 bars, slowdown over bars 3–7, target from bar 8), aimed at a measured reference braking run (Run_Deccelarate FBX): ~189 steps/min, trunk tipped back ~3°, hips ~3.5 cm lower with the knees well bent in stance, 2.1 m/s. The arms keep the sprint's swing, shortened at the shoulder (upper-arm weight 45 %). No foot lock.

| Measured on Sprint.fbx, bars 8–10 | Template | Reference |
|---|---|---|
| Cadence | 189 steps/min | ~189 |
| Trunk lean | −2.4 to −2.7° | −1.5 to −6° |
| Hip height | 83.6 cm | ~83.5 cm |
| Stance knee (most bent) | 111–114° | 110–112° |
| Swing knee (most bent) | 82° | 79–82° |
| Speed | 2.10 m/s | 2.13 m/s (import estimate) |

Not matched: the reference keeps each foot down about 0.3 s (the sprint about 0.1 s). A longer contact without a foot lock slides, so the template leaves it.

## Steadiness tracks (timeline)
"+" menu → **Steadiness (centre bones)**. It adds a block with an **Amount** track per centre bone (Hips, Spine, Spine1, Chest, Neck, Head) and **Hips bob / sway** tracks. 0 % = as the clip moves; 100 % = still.
- Motion is measured against the average pose of the bar it is in. Averages are taken per bar and blended between bar centres, so a timeline that changes over the bars (templates, cadence) steadies against its own pose.
- ⚙ (or right-click the block): which tracks show; **World** (the bone holds still in the world, the bones below compensate) or **Local** (only its own rotation calms); axes **P / T / L** (pitch, turn, tilt); **Feet stay planted** (the legs are re-solved so each foot keeps the spot the unsteadied pose gave it).
- Order: clip → groups / bones → symmetrize → **steadiness** → IK (Chest / Head / Hips effectors and foot lock act on top).
- Saved with the project, in undo, JSON export / import, templates, bar copy / paste, and the whole-timeline FBX export. The Symmetrize tool's own Steadiness is unchanged.
- Measured on Sprint.fbx: Head world 80 % → head pitch range 10.3° → 2.1°; a 0 → 100 % ramp gives 10.1° / 6.0° / 1.9° at bars 1 / 3 / 5; with hips steadied the planted feet stay within 0 cm of their unsteadied spots. With feet planted, Hips bob 50 % only takes the bob from 4.1 to 3.1 cm: the legs cannot reach higher at mid-stance, so the pelvis comes back down.

## Run controls (4 controls)
"+" menu → **Run controls**: one block with four rows.
- **Step length** (%, the stride track): the feet reach further or less far from the hips (feet planted; the ground covered follows). With **"Step length also moves knees, pelvis turn and arm swing"** on (block ⋯ menu, on by default), a shorter step also lowers the knee lift (knee weight 1 − 0.65 × the drop), turns the pelvis less, and shortens the shoulder swing (upper-arm weight 1 − 0.85 × the drop). The elbow bend stays.
- **Cycle speed** (%, cadence): timing only.
- **Spine lean** (°, + forward / − back): the chest tips (about 2° of chest rotation per degree, spread over the spine), the head counters 80 % of it, and the hips shift about 0.2 cm per degree to keep the weight over the feet. Leaning back (straightening) raises the hips 0.125 cm per degree; leaning forward crouches 0.2 cm per degree. Feet stay planted. Measured on Sprint.fbx: −6 / −12 / −18 / +10 give a trunk change of −6.1° / −12.2° / −18.3° / +10.2°.
- **Hip rotation** (°, pelvis tilt, its own control): − tips the pelvis back (the whole upper body with it, the hips rise 0.15 cm per degree), + forward. The head counters it; feet stay planted. Measured: −5 / −10 / −20 give −5° / −10° / −20° of trunk and +0.5 / +0.9 / +1.3 cm of hip height (the legs limit the rise).
- **Hard braking** (%): in every foot contact. The foot lands further ahead (up to 15 cm, eased in before touchdown and out after toe-off), the hips dip (up to 5 cm) and the trunk kicks back (up to 4°) with a pulse that peaks 30 % into the contact, and the clip plus the travel slow down (up to 30 %) inside the contact, so speed drops step by step with the feet planted. Measured at 70 % on Sprint.fbx: landing 18 → 29 cm ahead, hip low point −2.8 cm, speed dipping 5.18 → 4.17 m/s in each contact, foot slip unchanged.
- **Moving speed** (m/s): the result, cadence × step length, drawn over the timeline. **Speed lock** (⋯ menu): editing step length rewrites the cadence so the speed stays, and editing the cadence rewrites the step length (within 50–150 %).
- The old "Moving speed" multiplier is now **Travel trim** (it can make the feet slide).
- **Template: Run → Jog (4 controls)** (⋯ menu or "+" menu): 10 bars; bars 3–7 slow down: step length 100 → 53 %, cadence 225 → 165 steps/min, spine lean 0 → −8°, hip rotation 0 → −4°, hard braking 70 % over bars 4–6. Measured on Sprint.fbx: 5.18 → 2.00 m/s, trunk 20° → 7.9°, hips 87 → 88.7 cm, swing knee 52° → 83°, slip 4.2–8 cm per bar (the sprint clip itself: 6).

## Resistance (a force on the runner)
"+" menu → **Resistance**. A formula-based block (no simulation; the same result every time) that adds to the Run controls without overwriting them.
- **Tracks:** **Force** (N; body weight = mass × 9.81, 75 kg = 736 N); **Direction** (° the force pulls the runner toward, around the runner: 0 forward, 90 right, 180 back (a rope behind, a headwind), 270 left); **Vertical** (° + pulls up, − pulls down; a sled rope is about −20 to −30°). Don't cross 0 / 360 inside one ramp: it interpolates the long way round.
- **Settings (⚙):** body mass; attached at the hips (the lean is split half pelvis, half spine) or the chest (a quarter at the pelvis); **Keep speed**.
- **What it does:**
  - The body leans against the pull: forward / back = atan(back pull / effective weight), side = atan(side pull / effective weight), away from the pull. The head counters it.
  - Load = back pull / weight. Steps shorten 0.75 % per 1 % load (sled-towing studies) and the shoulder swing grows.
  - **Keep speed** on: the cadence rises to hold the speed. Off: the cadence drops a little and the speed falls.
  - An upward pull lightens the body (hips a little higher); a downward pull loads it (hips lower, knees bent).
  - A side pull widens the steps.
- **Measured at 5.5 m/s (Sprint.fbx, 75 kg, hips):**

| Case | Load | Trunk lean | Step | Cadence | Speed |
|---|---|---|---|---|---|
| none | 0 % | 20.0° | 100 % | 225 | 5.5 |
| headwind 35 N, 180°, 0° | 5 % | 22.8° | 96 % | 233 | 5.5 |
| band 100 N, 180°, +10° | 13 % | 27.9° | 90 % | 250 | 5.5 |
| sled 150 N, 180°, −25° | 18 % | 29.8° | 86 % | 261 | 5.5 (4.52 with keep speed off) |
| side gust 60 N, 90°, 0° | 0 % | side −4.4° (leans left, away from the pull) | 100 % | 225 | 5.5; step width 13 → 17 cm |

Also fixed: the timing no longer uses a stale "is this track active" check right after a Hard braking edit.
