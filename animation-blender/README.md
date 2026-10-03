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

## Forcers (force sources around the runner)
"+" menu → **Moving forcer** or **Fixed forcer**. Add as many as you like; each one is its own timeline block (**MOVING** / **FIXED** tag in its colour).
- **Moving forcer:** moves with the runner. X / Y / Z are from the root (the ground under the hips, turned with the runner: X + right, Y height, Z + in front); default 1 m in front, 1.2 m high, facing the runner.
- **Fixed forcer:** stays put in the world. X / Y / Z are from the runner's start point; default 10 m down the track, facing back toward the start. The runner comes up to it and passes it.
- **Tracks per forcer:** X / Y / Z position, Facing X / Y / Z (tilt / turn / roll), **Force** (N: + push, − pull), **Spread** (° cone), **Weight** (% of the body's reaction: 0 = shown but no effect, 100 = full, 200 = double).
- **Settings (⚙ on the block):**
  - Name, falloff, show.
  - **Target:** Whole body and / or IK controllers (hips, spine, chest, neck, head, hands, feet). A ticked controller is moved along the ray from the forcer by Force × Weight × **Stiffness** (cm per 100 N), up to **Max move**, and its chain follows by IK.
  - **Only inside the cone** (off = always hits) and **Body reacts too**.
  - **Body (shared by all forcers):** mass, keep speed.
- **Several forcers add up** on each body part (vector sum), then the body leans against the total, the steps shorten under load, and the cadence rises to keep the speed.
- **Viewport:**
  - Each forcer is drawn as a speaker (colour trim), with its cone, waves (out = push, in = pull, blue) and arrows on the parts or controllers it reaches.
  - **Click a speaker to select it** (its block highlights). **W** gives move arrows, **E** rotation rings. Auto-key on keys X / Y / Z or Facing at the playhead when you let go; off leaves it live until Key.
- **Measured at 5.5 m/s (Sprint.fbx):**
  - One moving forcer, 150 N, 90°: lean 20° → 28.9°, step 88 %, cadence 255, 5.5 m/s. Weight 0 / 50 / 200 % gives lean 20.0° / 24.5° / 37.1°.
  - Adding a side forcer adds 6.5° of side lean.
  - A pull of −200 N on the left hand moves it 25 cm toward the forcer.
  - A fixed forcer 10 m down the track: 1 N at the start, 149 N at 9.2 m, 0 once passed.
- Older projects: the single Resistance device becomes Forcer 1 (moving); its mass / keep speed become the body settings. A fixed forcer uses the runner's path from the last timing (keep speed off can lag it slightly).

## Forcers: response, leg drag, ±3000 N, gizmo on click
- **Force** range is now −3000 to +3000 N (snap 10). New forcers default to a **90°** spread.
- **Response** track per forcer (0 – 100 %):
  - 0 = resist: the runner leans into the force, as before.
  - 100 = yield: the body gives way along the arrows. The chest bends back (0.15 cm per N on the chest), the head goes with it (0.15 cm/N), the hips shift (0.05 cm/N) and the arms fly (1 cm/N on each arm), each up to 40 cm. Feet stay planted.
  - In between, it does both.
  - Measured with 300 N at 1.2 m, 90°, on Sprint.fbx: 0 / 50 / 100 % gives lean 37.1° / 14.2° / −8.2°, chest back 0 / 11 / 22 cm, left hand back 0 / 10 / 31 cm.
- **Leg drag:** force that lands on the thighs / shins (or on a foot IK target) slows the leg swing (cadence −1.2 % per 1 % of body weight) and lowers the knee lift, even with keep speed on, so the moving speed drops.
  - Measured with 300 N at 5.5 m/s: on the legs (0.4 m high, 60°): 4.74 m/s, cadence 213, swing knee 52° → 66°. On the chest (1.45 m, 30°): 5.5 m/s held. On the legs with keep speed off: 4.2 m/s.
  - A whole-body 90° forcer reaches the legs too: 150 N now gives 5.23 m/s instead of 5.5.
  - The forcer summary shows leg drag %.
- **Gizmo:** clicking a speaker (anywhere on the cabinet) selects it and brings up the move gizmo, even in Select mode. E switches to rotate. A real mouse drag of the X arrow keys X position at the playhead on release (auto-key).

## Procedural IK v3: real clip speeds, symmetrized training set, instant start, Acceleration / Deceleration pose
- **Each motion at its own speed.** Every training clip's speed is now measured from its planted feet: the ankle's backward speed relative to the hips in contact. The files' numbers were 11–15 % high. The throttle picks a motion slot; between two slots the speed and the motion blend. No speed beyond the Sprint clip's own (7.5 m/s is gone).

  | Throttle | 0 | 10 | 20 | 35 | 45 | 55 | 75 | 100 |
  |---|---|---|---|---|---|---|---|---|
  | Motion | stand | Standard walk | Casual walk 1 | CMU jog 16_35 | CMU jog 35_17 | CMU run 09_07 | Run steady | Sprint |
  | m/s | 0 | 1.16 | 1.33 | 2.14 | 2.38 | 2.62 | 3.41 | 4.58 |
  | steps/min | – | 103 | 116 | 150 | 157 | 164 | 160 | 225 |

  At every slot the motion runs exactly as captured: contact fraction equal to the clip's, no warp, foot slide 0.0 cm. Faster or slower inside a motion comes from Step length / Cycle speed.
- **Symmetrized training set** (`assets/proc_clips.json`, clip group *Procedural set (symmetrized)*): the 7 clips above, each through the Symmetrize tool's *Phase matching + average arms* (left lands on the bar, right half a cycle later). They can be loaded and checked like any clip. The originals are untouched. The procedural motion now trains from this set (no symmetrizing at run time).
- **Shoulders too high in the CMU jogs:** CMU 16_35, 35_17 and 09_07 had the shoulder joints 1–5 cm *above* the neck base; every other clip has them 4–12 cm below. That is an 8–12 cm shrug from the BVH retarget's collarbones. In the set, their collarbones are replaced by Jog slow's mean collarbone rotation and the upper arms counter-turned, so the arm swing is kept. Now −7.8 … −5.8 cm.
- **Instant start.** From standing, a throttle step now:
  - Starts the push at once (jerk up to 40 m/s³ for the first 0.3 s; up to 6 m/s² for a sprint, 1.3 for a walk).
  - Cross-fades to the asked motion in 0.08 s.
  - Puts the left (push) foot down and starts the right one's swing.
  - Swings arms and legs out at once, not with the still-low speed.
- **Start measured** (step 0 → throttle at 1.0 s; the body's biggest joint change is 60° after 0.05 s):

  | Start | 1st touchdown | Steps (m) | Speed at 1st step |
  |---|---|---|---|
  | Sprint (100 %) | 0.43 s | 0.50, 0.82, 0.97, 1.10, 1.15, 1.21 | 1.84 m/s |
  | Jog (35 %) | 0.57 s | 0.47, 0.71, 0.82 | – |
  | Walk (10 %) | 0.77 s | 0.50, 0.70, 0.63 | – |

  Before this, the first sprint step was 0.04 m: the foot landed next to the standing one, because the cycle phase kept running while standing and the swing scaled with the still-tiny speed.
- **Acceleration pose / Deceleration pose tracks** (0–100 %, under the Throttle). Pose only: the speed stays the throttle's. They act on the whole body: the planned footprints, the leg IK, the ankles and toes, the arms. Eased over 0.12 s.

  | | Acceleration pose 100 % | Deceleration pose 100 % |
  |---|---|---|
  | Lean | 30° forward (35 % pelvis, 65 % spine; head keeps 60 % of its level) | 15° back |
  | Hips | 12 cm forward, 4 cm down | 10 cm back, 8 cm down; brought down further while a braking foot reaches ahead |
  | Feet land | 10 cm further back | 14 cm further ahead |
  | Knee drive in the swing | +8 cm | −3 cm |
  | Ankle | Push-off: foot down 20° late in the contact, heel up with the ball kept down | Heel strike: toes up 15° |
  | Toes | Bend at push-off | Up 10° more |
  | Arms | Swing × 1.4, elbows +15° | Swing × 0.7, centre 20° forward, 10° out |

  Measured at 55 % (CMU run 09_07, 2.62 m/s at every setting):
  - Trunk lean 9.6° → 19.8° → 30.1° (Acceleration 0/50/100 %) and → −0.6° (Deceleration 100 %).
  - The planted foot lands 2 cm ahead of the hips; with Acceleration 100 % 20 cm behind; with Deceleration 100 % 26 cm ahead.
  - Foot slide 0.0 cm.
- **The automatic lean from the speed controller is gone.** The two pose tracks set the lean.
- **Elbow bend on a nearly straight arm** (here and on clips): the bend axis came from the arm's own plane, which flips when the arm is almost straight. The forearm turned 8000 °/s in one frame. The hinge is now kept in the upper arm's frame from the last clearly bent pose (blended in 15°–40°).
- **Measured, 0 → 100 → 0 with both pose tracks ramped in 0.1–0.2 s:**
  - Foot slide 0.0 cm (Stop: run and Stop: walk out).
  - Highest turn rates: forearm 1851, thigh 1712, foot 1953 °/s, hips acceleration 276 m/s². These come from the deliberately sharp pose ramps.
  - Without the pose tracks, all are within the clips' own ranges (thigh ≤ 727 °/s on the demo).
- **Limits:**
  - Fast pose-track ramps (< 0.2 s) make fast body changes.
  - Deceleration pose 100 % at a sprint is a deep, crouched brake.
  - Forcers and IK tracks still do not act on a procedural motion.

## Procedural IK locomotion v2: throttle picks the motion, run controls on top, Sprint, stop style
- **The motion comes from the throttle, not from the speed.**
  - Every trained clip, and standing, is an entry with a weight. The throttle's speed sets the target weights (the one or two clips around it).
  - Each weight eases to its target (0.25 s; into standing 0.45 s). A big throttle change cross-fades straight from the current motion to the new one. Nothing in between gets any weight: 0 → 100 % goes stand → Sprint, never walk → jog → run.
  - A slow throttle ramp that you draw still passes through the motions on its way.
- **Real speed vs motion:** the real speed ramps with the speed controller and sets the cadence and stride inside the chosen motion.
  - Slower than the motion: a lower cadence, longer contacts and smaller steps, down to its mean pose.
  - Faster: a higher cadence and shorter contacts (per-leg phase warp).
  - Acceleration limit 4.0 m/s² from standstill, falling to 1.5 at 7.5 m/s. Braking 3.5 m/s², jerk 7 m/s³.
- **Throttle → speed:**

  | Throttle | 0 | 5 | 10 | 15 | 20 | 25 | 40 | 50 | 70 | 100 |
  |---|---|---|---|---|---|---|---|---|---|---|
  | m/s | 0 | 0.5 | 1.0 | 1.4 | 1.75 | 2.6 | 3.4 | 4.0 | 5.5 | 7.5 |

- **Sprint:** the project's own Sprint.fbx (5.18 m/s, 225 steps/min) is now a built-in clip (group *Mocap*, id `mocap:sprint`) and the top of the run family.
  - Above 5.18 m/s, cadence ∝ v^0.35: 256 steps/min at 7.5 m/s.
  - 0 → 100 %: 7.5 m/s in about 3.5 s.
- **Drive phase:** lean = 1.3 · atan(a / g), up to 32° forward and 14° back. While accelerating hard, the arms and trunk swing at full amplitude even when the steps are still short (eased in over 0.35 s).
- **Symmetrized training:** before fitting, every training clip goes through the Symmetrize tool's *Phase matching + average arms* (left lands on the bar, the right half a cycle later, arms mirror-averaged). Your own saved versions of those clips are not touched. First use takes about 0.6 s.
- **Stop style** (selector at the top-right of the Throttle lane), for a throttle that goes to 0:
  - *Stop: run* keeps the motion it was in until nearly still (≤ 0.35 m/s), then eases into standing.
  - *Stop: walk out* changes to the walk below 2.2 m/s, then stands.
  - A throttle ramp down to 0 counts as a stop all the way (0.5 s look-ahead). 100 → 40 % still goes straight to the 40 % motion.
- **Run controls on a procedural motion** act inside the motion the throttle picked:

  | Control | What it does here |
  |---|---|
  | Step length (Hard and Natural), Cycle speed | Scale the speed (longer steps or quicker cadence, same motion) |
  | Forward travel | Scales the ground covered and the feet's reach (0 = on the spot) |
  | Foot on ground | Lengthens / shortens the contacts |
  | Arm swing, Hip motion | Scale those Fourier amplitudes |
  | Spine lean, Hip rotation | Add to the trunk / pelvis |
  | Knee depth | Hips down 7 cm per +100 % |
  | Jump | Hips up 6 cm at 100 % in the flight |
  | Elbow bend, Arm crossing, Arm swing centre | As on a clip |

  - Hard braking and Brake rhythm are not offered: the throttle brakes.
  - On a procedural motion, Cycle speed no longer moves the bars.
- **Feet:**
  - Late in a contact and early in the swing, a foot further than 99 % of the leg from the hip rises (heel up, as at toe-off) instead of locking the knee straight.
  - Planted-foot slide: 0.0 cm in all measured runs (demo, 0 → 100 → 0 with both stop styles).
- **Measured, 0 → 100 % → 0:**
  - Speed at 1.5 / 2 / 3 / 4 / 5 s: 0.88 / 2.59 / 5.26 / 7.13 / 7.49 m/s.
  - Stop: run gives 7.5 → 0 in about 2.5 s in the Sprint motion.
  - Highest turn rates at the 7.5 m/s sprint: forearm 1536, thigh 1396–1596, foot 1252 °/s. The Sprint clip's own, at 5.18 m/s, are forearm 1449, thigh 728, foot 1154.
  - Hips acceleration ≤ 57 m/s².
- **Run-control check** (25 % throttle, CMU jog 16_35 motion):
  - Step length 130 % → 3.38 m/s at the same 152 steps/min.
  - Cycle speed 120 % → 3.12 m/s at 183 steps/min.
  - Forward travel 0 → 0 m/s of travel, still 152 steps/min.
  - Foot on ground +10 → contact 0.18 → 0.28 of the cycle; the planted foot slips up to 3.5 cm (the model's stance sweep is shorter than the longer contact).
- **Limits:**
  - Forcers and IK tracks do not act on a procedural motion yet.
  - Step length / cycle speed above about 130 % run the motion faster than it was captured.
  - Hip motion and Arm swing have no automatic "× speed" here.
  - The thigh turns about 2× faster than in the Sprint clip at 7.5 m/s.

## Procedural IK locomotion (experiment, v1): Throttle track
- **What it is:** a clip called *Procedural IK locomotion* (group *Procedural*, also in **+ Motion**). It plays no motion clip. 1 bar = 1 s.
- **The gait model:** trained once, on first use, from 6 library clips:
  - Walks: Standard walk 1.38 m/s, Casual walk 1.50.
  - Runs: CMU 16_35 2.53, CMU 35_17 2.75, CMU 09_07 3.03, Run steady 3.98.
  - Run medium is left out (its arm swing). Run fast is left out (it is Run steady at a forced cadence).
  - What each clip gives: per bone a mean rotation plus 5 Fourier harmonics over the cycle; the hips the same way; the cadence and the stride.
  - Contacts are measured from the feet (ankle low and still in the world). Phase 0 is the left touchdown.
- **Throttle %** (the first track): sets the target speed.

  | Throttle | 0 | 5 | 10 | 15 | 20 | 25 | 40 | 50 | 70 | 100 |
  |---|---|---|---|---|---|---|---|---|---|---|
  | m/s | 0 | 0.5 | 1.0 | 1.4 | 1.75 | 2.6 | 3.4 | 4.0 | 5.2 | 6.6 |

- **Speed controller:** a jerk-limited speed controller (gain 1.3/s, a 0.8 m/s² floor eased out over the last 0.25 m/s, acceleration ≤ 2.6 m/s², braking ≤ 3.2 m/s², jerk ≤ 6 m/s³). It accelerates or decelerates until the new throttle's speed is reached, then holds it, with no overshoot.
  - Example: 70 % → 40 % slows 5.2 → 3.4 m/s in about 1.5 s, then runs steady at 3.4.
  - It starts steady at the first throttle value: 0 = standing.
- **Cadence, stride and gait follow the speed:**
  - Between two trained speeds, both clips are blended.
  - Walk ↔ run blend over 1.8–2.5 m/s.
  - Slower than the slowest walk: cadence ∝ v^0.45 (≥ 50 %) and smaller motion, down to the standing mean pose at 0.
  - Faster than Run steady: cadence ∝ √v. The longer stride comes from a shorter contact and a longer flight: each leg's phase is warped, so its contact plays k× faster. That keeps the planted foot in step with the ground and needs no longer reach.
- **IK legs:**
  - Every touchdown leaves a footprint, planned ahead at 240 Hz from the Throttle track. The planted foot stays on it.
  - A swinging foot follows the model's foot plus a gap. The gap goes from the lift-off one to the next touchdown's and is gone by 60 % of the swing.
  - The gap never takes the foot further from the hip than the model's own foot (or 98.5 % of the leg), eased in over the first quarter of the swing.
  - Two-bone IK in the model's knee plane, keeping the model's thigh and shin twist and the foot's world turn.
- **Lean:** whole-body lean 0.9 · atan(a / g), limited to −12° … +16°. A quarter goes in the pelvis and the rest up the spine; the head takes back 40 %. It leans forward while accelerating and back while braking.
- **Measured** (the 16-bar demo: 0 → 12 % → 25 % → 70 % → 40 % → 0):
  - Speed per second: 0, 0, 0.92, 1.16, 1.16, 2.43, 2.60, 2.60, 4.50, 5.19, 5.20, 3.68, 3.40, 3.40, 1.16, 0.04, 0.
  - Cadence (steps/min): 95 at the 1.16 m/s walk, 152 at the 2.6 m/s jog, 162 at 3.4 m/s, 183 at 5.2 m/s.
  - Planted-foot slide: ≤ 0.2 cm in 24 run contacts and 6 walk contacts.
  - Hips acceleration peak 68 m/s².
  - Highest bone turn rates (thigh 856, knee about 1050, upper arm 739 °/s) are at 5.2 m/s, where the cadence is 1.14× Run steady's own (thigh 732, knee 768, upper arm 637 °/s).
  - Plan build 7 ms. One pose 0.25 ms.
- **Limits:**
  - The Throttle track is the only control: the other run controls, forcers and IK tracks do not act on this motion yet. Playback speed is ignored.
  - The run style above 4 m/s is Run steady's, with high hands and low hips.
  - The feet land close to the centre line (as in the CMU clips).
  - Throttle 100 = 6.6 m/s. No sprint was trained.
  - Turning is not modelled (straight line only).

## CMU mocap arms and jog, BVH import, running on the spot, run → jog hop
- **Why the arms looked wrong in the blends:** Run medium swings the forward arm up to 69° in front with the elbow half open (shoulder −66° … +69°, 135° in all); Jog slow carries the hands low with the elbow at 40–88°. Running-form studies give elbows of about 90° (70–120°) and hands from the hip to the chest. The CMU captures match that: elbow 95–130°, hands 26–45 cm above the hips, arm in phase with the opposite thigh (r = 0.95–0.97).
- **BVH import:** Import accepts .bvh (CMU and others). The CMU files' first T-pose frame is the rest pose (and left out); their spine (LowerBack / Spine / Spine1) maps onto Spine / Spine1 / Spine2; the lowest toe is put 2 cm above the ground (the files floated 5–14 cm).
- **Built-in "CMU mocap" clips** (retargeted, symmetrized, loop seams below the biggest frame-to-frame step): CMU jog 35_17 (2.75 m/s, 157 steps/min), CMU jog 16_35 (2.53, 150), CMU run-jog 35_22 (3.10, 171), CMU run 09_07 (3.03, 164). Source: CMU Graphics Lab Motion Capture Database, BVH conversion by B. Hahne (cgspeed), via github.com/una-dinosauria/cmu-mocap.
- **Forward travel %** (Run controls, new): the ground covered and the feet's reach in front of / behind the hips go with it (along the way he runs); at 0 he runs on the spot: planted feet under the hips, a swinging foot pulled in keeps its toe off the ground. Jog forward 2.96 → 0 m/s over two bars; thigh lift 37° moving, 56° on the spot.
- **Templates now:**
  - Braking 1 and 3: the run phase (Run medium) takes its arms from CMU run 09_07 (Blend motion, symmetric, swing 120 %): shoulder −50° … +9°, elbow 89–122°. The jog is CMU jog 35_17 (full capture).
  - Run → jog: a small hop at the handover (Jump 0 → 30 % → 0, S curves, peak at the end of the blend bars): hips bounce 8 cm, no jerk (hips acceleration ≤ 127 m/s² against 157 in the plain sprint).
  - **Braking 4 · decelerate → jog on the spot** (18 bars, 3 motions): as Braking 1, then the CMU jog's forward travel eases 100 → 0 % (bars 11–14) with the spine a little more upright, and he jogs on the spot to bar 18. Speed per bar 6.60 → 4.78 → 4.17 → 3.02 → 2.50 → 1.38 → 0.26 → 0; cadence stays 156–157.
- Walk arms (Braking 3's last motion): Standard walk swings its arms almost only forward (shoulder −4° … +49°, the hand 36 cm ahead, elbow nearly straight). The walk motion now moves the swing centre back (−22°), swings 90 % and bends the elbows 10°: −21° … +27°. CMU walks (35_01, 35_02) swing even less (about 11–14°).
- Checked by eye (side and front filmstrips, 0.25–0.5 bar apart): Braking 1, 3 and 4. Front view: the run and jog phases land the feet close to the body's centre line (the CMU jogger's own style).
- Not done: I cannot watch YouTube videos here; the changes rest on published running studies and on measuring the CMU captures against the library clips.

## No slow motion: cadence floor, clip handover
- Playing the sprint clip at half its cadence read as slow motion (Braking 1 went 265 → 142 steps/min with sprint poses). A Brake forcer now keeps the cadence at **≥ 85 %** of the clip's; the rest of the speed loss comes off the steps. Cadence share default 35 %.
- Where the speed drops further, the templates hand over to a slower clip (motion sequence) that plays at its own cadence:
  - **Braking 1** (14 bars, 3 motions): the sprint starts braking at bar 4 (Brake forcer: leans back, hips up), hands over to **Run medium** (bars 4–5 blend) whose own steps are longer (1.66 m against 1.49) and which brakes on (Brake forcer, share 70 %, contact braking 40 %); **Jog slow** with long steps (natural 120 %) is fully in at bar 10.
    - Speed 6.60 → 6.12 → 4.78 → 4.36 → 4.17 → 3.95 → 3.00 → 2.72 m/s; step 1.49 → 1.56 m (longer while braking) → 1.16 m jog; cadence 265 → 243 → 186 (blend) → 157 (Run medium: 87 % of its 180) → 141 (jog's own); spine 11.8° further back; peak slow-down 2.35 m/s².
  - **Braking 2** (choppy) needed no change: its cadence goes up (265 → 287).
  - **Braking 3** (27 bars, 4 motions): sprint coasts (Brake forcer 75 N, bars 4–8, cadence ≥ 230), **Run medium** coasts on from bar 10 (cadence 189 → 164, steps 1.65 → 1.43 m), **Jog slow** (natural 110 %) from bar 15, **Standard walk** from bar 22. Speed 6.60 → 5.38 (7) → 4.95 (10) → 4.50 (12) → 2.50 (15) → 1.38 (22); peak 1.44 m/s².
- Every bar's cadence is the clip's own or ≥ 85 % of it (only the blend bars sit between two clips). Bars 1–3 untouched (0.16°); no jerk (hips ≤ 288 m/s² against 138–330 in the plain bars).

## Forcer: Brake mode; braking templates made with it
- Forcer settings → **Body response: Brake (slows down)**. The force's backward part on the body decelerates him: **a = F / m**. The speed is what is left of the clip's after ∫a dt (it stays down when the force ends); he leans back **atan(a / g)**; the hips rise (**Hip rise**, cm per g of braking, default 20).
  - **Cadence share** splits the speed loss: cadence × k^share, step × k^(1 − share) (k = speed left). 100 % = cadence only; above 100 % = longer steps (flown: the natural step); below 0 = faster, shorter steps.
  - "Resist" (the old behaviour, leans into the push and keeps going) stays the default; older forcers are unchanged.
- The three braking templates are now made with one Brake forcer (4 m ahead, facing him, no falloff). Its force is solved so the speed lands on the template's target, then ends:

| Template | Force | Share | Speed per bar | Cadence / step | Lean change |
|---|---|---|---|---|---|
| 1 · lean back, long steps → decel jog (10 bars) | 132 N, bars 4–7 | 140 % | 6.60 → 5.96 → 5.01 → 4.26 → 4.22 | 265 → 142 · 1.49 → 1.78 m | −9.2° (bar 5), hips +4.7 cm |
| 2 · lean back, choppy steps (10 bars) | 150 N, bars 4–7 | −30 % | 6.60 → 5.73 → 5.12 → 5.08 | 265 → 287 · 1.49 → 1.06 m | −10.5°, hips +5.1 cm |
| 3 · sleep deceleration → jog → walk (28 bars) | 42 N, bars 4–14 | 120 % | 6.60 → 6.27 (6) → 5.48 (9) → 4.52 (12) → 2.50 jog → 1.38 walk | step 1.49 → 1.62 m | −3° |

  - Physics check: 132 N on 75 kg → the measured peak slow-down 1.57 m/s² (the cone takes a little), lean −9.2° = atan(1.6 / 9.81).
  - Template 1 still blends in the slow jog's arms (bars 5–7); 3 still adds Jog slow (natural step 110 %, fully in at bar 15) and Standard walk (bar 23). Select the sprint first (for 3: the last motion).
  - Bars 1–3 are the clip's own (0.16°); held bars match within 0.17°.
- **Fixes found on the way:**
  - Joint limits snapped a clip pose that was already past a limit the moment a small IK change touched it (an upper arm jumped 12° in one frame when the lean-back compensation moved it). The limit now eases in by how much the IK moved the joint (full from 4°): 12.3° → 0.59° per step.
  - Heel lift: the least lift that reaches grew without bound near the edge of reach (10° → 26° in 4 ms, then back). It is now the lift that brings the toe closest, eased in by how far out of reach the foot is: the biggest per-step turn 9.3° → 2.9°.
  - Late in a contact the hips no longer drop to chase a back foot out of reach (the foot lets go over the last 45 % of the contact).
  - Other templates re-measured: unchanged.

## Faster with forcers
- One evaluate asked the forcers ~100 times for the same moment: the last answer is now kept (a live gizmo drag is always fresh). The timing builders (bar table, travel, placing points on their bars) read the forcers' cadence / step factors from a 120 Hz table made once per build.
- The hand-reach / step-time readouts sampled the whole timeline in one go after every edit; they now run spread over frames (≤ 4 ms per frame).
- The forcer's cone is 2 shells of 24 segments (was 4 × 40): half the transparent overdraw.
- Measured (Sprint → resisted run template, 10 bars): timing table rebuild 30.6 → 7.4 ms; one evaluate 0.75 → 0.55 ms; a forcer setting change 154 → 77 ms, and the work after it (CPU profile, edit + 3 frames) ≈ 336 → 80 ms. The template's results are unchanged (speed per bar, lean, arm angle, bars 1–3 / 8–10 checks identical).

## Template: Walk → Run; Foot on ground below 0
- **Foot on ground** now goes from −30 to +30 % of the cycle: − shortens each contact (the swing gets the time: a run's flight), + lengthens it (braking). Jump, heel lift, knee depth and the planted-foot logic follow the changed contacts.
- "+" → **Template: Walk → Run (Standard walk, symmetrized)**: loads Standard walk into the selected motion (or adds motion 1), symmetrizes it once (Symmetrize tool, average mode; a clip already processed is kept), then over 8 bars: cycle speed 135 %, step length hard 125 % × natural 135 % (the extra flown), foot on ground −4 %, jump 80 %, knee depth 170 %, elbow +50°, arm swing 95 %, lean +14°, arm swing stays vertical. All flat tracks: edit or key them.
- Measured against the library's Run slow (mocap) at the same point of a cycle:

| | Walk | Walk → Run | Run slow |
|---|---|---|---|
| Cadence (steps/min) | 103 | 139 | 131 |
| Speed (m/s) | 1.38 | 3.14 | 3.18 |
| Step (m) | 0.81 | 1.36 | 1.46 |
| One foot on the ground (% of cycle) | 53 | 27 | 27 |
| Both feet in the air (%) | 0 | 47 | 47 |
| Trunk lean (°) | −7.2 | 7.1 | 7.3 |
| Elbow (°) | 13 | 63 | 74 |
| Hands above the hips at most (cm) | – | 42 | 39 |
| Stance knee, most bent (°) | 42 | 38 | 53 |
| Swing knee, most bent (°) | 68 | 88 | 145 |
| Hips at mid-stance vs mean (cm) | +1.9 | −1.5 | −4.4 |
| Hips up / down range (cm) | 5.0 | 5.1 | 13.2 |

- Limits (it reads as a light run, not as a run capture): the swing knee folds 88° (a run 145°; the jog clip 87°); the body dips at mid-stance only 1.5 cm and bounces 5 cm (a run 4.4 / 13 cm); the stance knee does not bend deeper (knee depth is held by the room the clip's leg has); the foot keeps the walk's heel-to-toe roll; the ground speed swings more within a step (2.0–5.0 m/s against the clip's 1.0–3.8), because the extra step length is covered in the air. For a capture-like run blend in Run slow / Jog (Blend motion) or use those clips.

## Tracks in the order they were added; forcers per motion (copy to others)
- Inside every block (Run controls, bones, IK, groups, forcers, blends, steadiness) a track you add goes to the **end** and stays there; one you take out and add again goes to the end too. The ⋮ grip still reorders. Older projects keep the order they show now.
  - Measured: Run controls, add Knee depth, Step length (Hard), Jump → that order; take Knee depth out and add it again → Step length, Jump, Knee depth.
- A forcer belongs to its motion: it acts on that motion only (another motion's pose differs by 0.165°, the same as noise), and its speaker, cone and arrows show only while that motion is under the playhead.
- **⧉** on the forcer's header (or right-click it): **Copy to motion n** / **Copy to every other motion**. The copy lands on the same bars (moved onto that motion's timing) and works there on its own (Ctrl+Z on that motion takes it back).

## Forcer: bones it bends, one by one with a weight
- Forcer settings → **Bones it bends** starts empty (the push then only leans and slows the body). **+ Add bone** picks one (Hips, Spine lower / middle, Chest, Neck, Head, each shoulder, upper arm, forearm, hand, thigh, shin, foot) with its **weight %** (0–200); each row can be changed or removed (×).
- A bone turns by the push's torque about its joint × its weight. Hips tilt the pelvis while the legs keep their line.
- "Bone flex (all)" still multiplies every bone.
- 100 % on the trunk / head is 4× the old bend so it shows; older saves come in at 25 % there (and 100 % on arms / legs), so they look the same.
- Resisted run template: Chest 100 %, Spine (lower) 50 %, Hips 20 %. At bar 9 (230 N): chest 1.6°, lower spine 3.2°, pelvis 2.2° back; the feet move 2 mm. The trunk lean settles at 24.8° (27.7° without the bend); arm swing centre −23.8° → −25.9°. Bars 1–3 unchanged (0.15°), bars 8–10 within 0.18°.

## Template: Sprint → resisted run (forcer 4 m ahead, bars 4–7 transition, steady from bar 8)
- "+" → **Template: Sprint → resisted run**, on the selected motion (load the sprint first). It writes 10 bars:
  - **Forcer** "Resistance (4 m ahead)": moving with the runner, 4 m in front at 1 m height, pointing back at him, no falloff, 60° spread, resist (he leans into it), keep speed off; bends Chest 100 %, Spine (lower) 50 %, Hips 20 %. Force 0 N until exactly the start of bar 4, then an S curve to 230 N at the start of bar 8, then held.
  - The same S curve (bar 4 → bar 8) on: knee depth 100 → 112 %, cycle speed 100 → 106 % (the cadence drops less than the stride, as in sled studies), foot on ground 0 → +8 % (longer contacts), arm swing and hip motion 100 → 90 %.
  - Arm swing / hip motion / arm centre "follow" options are off (bars 1–3 stay the clip's own).
- Modelled on resisted (sled) sprinting: trunk lean grows with the load, stride length drops more than stride frequency, longer ground contact, more flexed knees and hips; the slow-down is spread over the steps (no braking jerk).
- Measured on Sprint.fbx: bars 1–3 identical to the plain clip (largest bone difference 0.15°, the same as with no IK). Speed per bar 5.18 → 5.10 → 4.72 → 4.18 → 3.73 → 3.59 (−31 %, peak slow-down ≈ 0.9 m/s²); stride 1.38 → 1.09 m (−21 %), cadence 225 → 198 (−12 %); trunk lean 16.7° → 27.7°. Bars 8, 9 and 10 match within 0.21° at the same phase. Hips acceleration peak 192 m/s² in the transition against 197 before.
- **Arm swing stays vertical** (Run controls ⋯, on by default): the upper chest's pitch (lean, hip rotation, a forcer's lean and bend) is taken back out of the upper arms about the body's side axis, so the swing keeps its world angle. In this template the arm swing's centre moves 2.4° from bar 1 to bar 9 (24.4° with the option off).
- A forcer's extra arm swing now scales the swing about its own centre (it used to scale the arms away from the idle pose, which tipped them).
- **Run IK no longer changes an untouched leg:** the knee plane follows the clip's knee wherever the clip's knee is bent, the soft reach only works in the last 0.5 % of the leg's length, and the thigh and shin keep the clip's twist. With the foot where the clip has it, the leg is the clip's (it used to differ by up to 27.6° in the shin twist).
- Sources: Resisted Sled Sprint Kinematics (PMC8538495); Effects of resisted sled towing on sprint kinematics in field-sport athletes; Biomechanical and neuromuscular requirements of horizontal deceleration (PMC9474351).

## Run controls: add what you need, mute
- Adding **Run controls** ("+" menu) now gives an empty block. Its own **+** button lists the 14 controls (✓ = in the block); click one to add it (or take it out).
- **M on the header** mutes every run control: the engine uses the neutral values (100 %, 0°…), and the auto parts (arm swing / hip motion follow the speed, arm centre follows the acceleration) are off too. The points stay and come back on un-mute.
- **M on a control** mutes just that one; its curve stays visible and editable (the row is struck through).
- **×** (or right double-click) takes a control out of the block and resets it; Ctrl+Z brings it back.
- Muting cycle speed or step length changes the timing as an edit would; the bar count stays (8 bars: 4.52 s with cycle 80 % → 3.62 s muted → 4.52 s again).
- Older saves: the controls that already do something show, the rest wait behind +. The Run → Jog template adds its own five controls. Saves and the JSON export keep what is shown and muted.

## Motion sequence (several motions, one timeline)
- **The timeline starts empty.** "+ Add motion 1" picks the first clip and its bar count; it starts at bar 1.
- **More motions:** "+ Motion" (strip above the ruler). Pick the clip, the **start bar** (where it is fully in), the **blend bars** before it and its bars after the start.
  - Example: Jog at bar 10 with 2 blend bars is placed from bar 8. Bars 8–9 cross-fade from the motion before; from bar 10 only the jog plays.
  - The motion before is cut (or extended) to end at the start bar.
- **The bars stay static:** every motion keeps its own bar count; a later motion moves only if an earlier one gets more or fewer bars.
- **Separate automation:** every motion is a full timeline of its own: run controls, moving / cycle speed, forcers, blends, IK, bones. Nothing of one motion reaches another.
  - Click a motion in the strip to edit its tracks. The ruler and the big bar readout show global bar numbers.
  - Each motion has its own undo history.
- **In the blend bars** both motions run bar for bar:
  - the seconds per bar ease from one cadence to the other, and the ground speed eases over;
  - **Match feet:** the new motion's loop starts where the same foot lands as in the motion before, so the feet stay in step;
  - every bone cross-fades (eased slerp), the hips too.
- **Strip:** click selects (and moves the playhead), drag scrubs, double-click opens the settings (start bar, blend bars, bars, match feet), right-click: settings, remove, add, clear sequence.
- Changing a motion's clip (Clip menu) gives it a fresh automation with the same bar count.
- Play, loop and the timeline FBX export run through the whole sequence.
- Older saves open as motion 1 (nothing is lost).
- Measured (Sprint 9 bars → Jog slow at bar 10, 2 blend bars): seconds per bar 0.452 → 0.527 → 0.776 → 0.850; ground speed per bar 6.60 → 5.29 → 2.74 → 2.27 m/s. Hips acceleration peak in the blend bars 196 m/s² against 118 / 234 in the motions on either side; bone turn rate peak 2180 °/s against 2683 / 1071. No jump at the joins. The other way round (Jog → Sprint) is the same.
- Limitation: within a blend both motions keep their own travel, so a planted foot can slide a little while the weights change (10th-percentile foot speed near the ground 0.09 m/s in the blend, 0.06–0.10 outside).

## Curve modes (FL Studio style)
- Right-click a point to pick the shape of the curve from it to the next point (with several points selected, all of them change):
  - **Single curve**, **Ease in**, **Ease out**: one bend (the ring drags it).
  - **Double curve (S)**: slow, fast, slow (the ring: sharper / softer).
  - **Hold**: stays, then jumps at the next point.
  - **Stairs** / **Smooth stairs**: steps (the ring: how many, 1–16).
  - **Pulse**: on / off between the two values (the ring: how many).
  - **Wave**: cosine waves from this value to the next (the ring: how many).
  - **Arc (overshoot)**: goes past the value and comes back (the ring: how much).
  - **Smooth (spline)**: a smooth curve through the neighbouring points.
- Older timelines look the same (their curves keep their shape). Curve modes are kept in saves and in the JSON export.

## Step length: Hard and Natural
- **Step length (Hard)** is the old Step length: the feet reach further from the hips (knee lift, pelvis turn and arms follow).
- **Step length (Natural)** (%, new) makes the steps longer with the legs' own motion. The extra length is covered in the air.
  - While a foot is planted the ground speed stays the clip's; the extra comes during the flight.
  - The flight gets longer with the hop physics needs at that speed: extra flight = extra length ÷ moving speed, hop = g·flight²/8 over the clip's own flight.
  - In the air the feet rise with the hips, so the legs keep their shape.
  - Sprint: 110 % → step 1.47 → 1.61 m, 6.05 m/s, flight 172 → 180 ms, hop +1 cm; 130 % → 1.91 m, 7.15 m/s, 186 ms, +3 cm. The knees differ from the clip by at most 9–10°, of which 8.6° is the run IK itself (a 0.01° lean gives the same), so the natural step adds ≈ 0.5–1.6°.
  - With **Speed lock** on, editing it rewrites the cycle speed so the moving speed stays (120 % → cycle 83 %, 5.53 m/s).
- "Jump follows the step length" still follows the Hard step length (the natural step has its own hop). The extra foot lift at the ends of a contact comes from the Jump track only.

## Jump, motion blend from other clips
- **Jump %** (Run controls; 100 % = 6 cm): a hop at each change of foot.
  - The hips rise in a smooth bump between the middles of two contacts: none at mid-contact, the most in mid-flight.
  - Only the middle of each contact stays on the ground (55 % of it at 100 %). Towards its ends the foot rises (up to 3 cm), carrying on smoothly into the swing, so the contact is shorter and the flight longer.
  - The heel lift is mostly turned off while jumping (the foot leaves the ground instead of rolling onto its toe).
  - "Jump follows the step length" (⋯, on) adds 1 % per % of step length over 100.
  - Sprint: 50 % → hips +3 cm, flight 171 → 190 ms; 100 % → +6 cm, 200 ms; 150 % → +9 cm, 204 ms. Extra hip acceleration 9–28 m/s², mid-contact foot 0 cm.
- **Blend motion from another clip** ("+" → Blend motion…): a block with the source clip, the body part and Symmetric, plus two tracks.
  - Body parts: arms, upper body (no hips), spine, head & neck, legs, one arm / leg, whole body.
  - Tracks: **Blend weight** (bring it in from any bar) and **Its swing %**, which scales the source's motion about its own average.
  - The source is phase-matched to this clip's left / right touchdowns. Symmetric averages each side with the other side half a cycle later, mirrored.
  - Order: this clip's Arm swing % → the blend → Arm swing centre / Elbow bend / Arm crossing. So this clip's arm swing stays on this clip's arms, and the source keeps its own 100 % until you change its swing.
  - Sprint arms at 40 % (hand travel 38 / 36 cm) + Jog_slow arms at 100 %: 41 / 50 cm; with its swing at 50 %: 26 / 33 cm; blended as upper body (no hips): 43 / 43 cm.
  - The left / right difference with arms only comes from the sprint's own chest turn; blend the upper body to take that too.

## Brake rhythm, arm swing centre, track order, frame stepping, track ranges
- **Brake rhythm** (Run controls, %, default 100): with Hard braking the playback slows in each foot contact and plays faster right after toe-off to make it up. The make-up is solved per clip, so a bar takes exactly as long as without braking. The speed the longer bars used to take off now comes off the step length (feet stay planted), so the moving speed drops the same. 0 % = the old behaviour.
  - Sprint, braking 70 %: bar 0.5333 s (without braking 0.5333; rhythm 0 % 0.5595). Playback 0.79× in contact → 1.16× after toe-off. Moving speed 5.24 m/s either way, step length 95 %.
  - Run → Jog template still ends at 2.02 m/s in 10 bars.
- **Arm swing centre** (°, + forward / − back): turns the whole swing about the shoulder (the collarbone takes a quarter), so the swing amount and the elbow stay the same. On by default, it follows the acceleration at 14° per m/s², up to ±30° (⋯ menu to turn off): slowing down moves it back, speeding up forward. Run → Jog at −0.75 m/s²: −10.5°, hands' average 15.4 → 7.9 cm in front of the chest. +15° by hand: 24.5 cm.
- **Track order:** drag a block's ⋮⋮ grip to move it, now including Moving speed, Playback speed and the Run controls. Drag a track's ⋮ grip to move it inside its block (Run controls, forcer, IK, bone, group…). The order is saved per clip, and undo works.
- **Frame stepping:** with no points selected, ← / → step one frame (30 fps) and Shift ×10. Holding the key keeps going and speeds up (2 frames per step after ~15 repeats, 4 after ~40). With points selected the arrows still nudge the points.
- **Track range:** right-click a track's name (or its lane) → **Range: min / max…** to set your own limits in the track's units, wider (Force ±5000 N) or narrower for fine edits; Reset brings the default back. Saved per track and in the JSON export. Knee depth follows its range in the pose too. Joint limits and leg reach still apply.

## Arm swing, elbow bend, arm crossing, hip motion; shallower knee depth with heel lift
New Run controls rows: **Arm swing %**, **Elbow bend °**, **Arm crossing °**, **Hip motion %** (Knee depth stays at the end).
- **Arm swing** scales the arms' motion about the clip's own average arm pose, not toward the idle pose, so the carry and the elbow bend stay (no robot arms). It covers the collarbones (the shoulders' forward / back and up / down), upper arms, forearms and the spine / neck twist (the shoulder line turning). Sprint, 50 %: hand travel 73 → 47 cm, shoulder twist 42° → 26°, shoulder (collarbone) swing 15 → 9 cm, elbow carry 60.5° → 60.6° (unchanged).
- **Elbow bend** +20° → mean elbow 60° → 80°. **Arm crossing** +15° → hand 30 → 20 cm from the middle line.
- **Hip motion** scales the pelvis turn, drop and tilt and the hips' bob and side sway about their average. The feet stay planted (0.1 cm) and the chest keeps its turn in the world. Sprint, 50 %: pelvis turn 22° → 11°, drop 26° → 13°, bob 4.1 → 2.1 cm, sway 3.0 → 1.5 cm.
- **Both follow the moving speed** (on by default, ⋯ menu to turn off): × (1 + k·(speed / clip speed − 1)), k = 0.8 for the arms and 0.6 for the hips, with the speed averaged over one bar. Run → Jog (5.5 → 2 m/s, ratio 0.37): arm 49 %, hip 62 %. Hand travel 52 → 31 cm, shoulder twist 44° → 24°, pelvis turn 14° → 8.5°, bob 4.1 → 2.5 cm.
- **Knee depth < 100 %** now raises the hips by phase: most in mid-contact, less at touchdown / toe-off. A smooth curve kept under what the legs can reach, with a **heel lift**: a planted foot that would be out of reach rolls onto its toe (up to 40°). The lift fades in just before touchdown and out before toe-off. At 60 %: jog +3.8 cm, sprint +3.2 cm (before: 0).
- The heel lift also replaces the hip dip that the run IK made when a planted foot was just out of reach (extra hip acceleration with a spine lean: jog 60 → 0, run slow 136 → 21 m/s²).
- Limitation: on the sprint, 60 % still has a small hip jerk at toe-off (185 m/s² extra) and extra foot acceleration (≈ 600 m/s²); 80 % is 88 / 400. Keep a sprint at ≥ 80 %.

## Knee depth, Moving speed track, hip jerk fix
- **Moving speed** is its own track at the top of the timeline (no longer inside Run controls or a forcer block). It is a read-only result: the ground speed from every track (playback / cycle speed, step length, hard braking, travel trim) and every forcer. With forcers on, a dashed line shows the speed without them and the value reads "without → with". Its scale fits the range the speed moves in. "+" → Moving speed shows / hides it.
- **Knee depth** (Run controls, %, 100 = the clip, 50–150): deeper knees in every foot contact, and the hips come down by exactly the amount that keeps the planted foot where it was. That amount is worked out once per clip from the legs at mid-contact, so the hip height follows only the Knee depth track: no step at touchdown or toe-off.
  - Sprint (5.5 m/s): 120 % → hips 2.7 cm lower, stance knee 48° → 57°; 140 % → 6.0 cm, 67°. The planted foot stays exactly where the clip had it (0.00 cm), and foot acceleration at touchdown / toe-off is unchanged.
  - In the air the shin folds more too, eased in after toe-off and out before touchdown, with a soft cap so the knee stays under 140° (it was hitting the 150° stop and jerking the foot).
  - Shallower (< 100 %) raises the hips only as far as every pose of the cycle can still reach the ground. The Sprint's legs are almost straight at contact, so there is no room (0 cm) and < 100 % does nothing on it.
- **Hip jerk fixed.** Whenever the run IK was on (lean, hip rotation, braking, forcers), a swinging leg that stretched too far pulled the hips down, and they snapped back up in 3 frames (8 mm, in the flight phase). Now only a planted foot lowers the hips, easing in / out over the first and last 8 % of the swing, and a foot too far out to be reached by lowering fades out instead of switching off. Extra hip acceleration: hip rotation −5° 286 → 26 m/s², a Knee depth ramp 221 → 1.

## Forcers bend every bone, smooth spread, Moving speed row, view toggles
- **Every bone, not only IK controllers.** Each chain (spine, neck + head, both arms, both legs) takes the force at its joints. A bone turns by the torque about its joint from the force on it and on everything it carries: the spine is stiff and a hand is light. ⚙ → **Bones it bends** (tick the chains) and **Bone flex %** (0 = off, 100 default, up to 300). Response adds to it (resist 50 % of the bend, yield 100 %).
- A leg bends only while its foot is off the ground, so planted feet don't slide (measured 0 cm). It runs after the IK and before the joint limits, so knees and elbows never bend the wrong way (0 / 480 bad knee frames, also with 1500 N).
- Measured at 300 N from 1.2 m in front at chest height: hands 4–9 cm, head ~3 cm, 11–13 bones turned per frame, up to 9°. Aimed at the legs (0.5 m high): swinging foot 2–6 cm.
- **Spread** is now 100 % on the centre line and eases down to 0 at the edge (cosine): half the angle gives 50 %. The cone is drawn as nested shells, brightest in the middle. Edge parts get less force than before, so the same numbers give a little less lean (legs forcer 300 N: 5.5 → 5.1 m/s with keep speed, 4.81 without).
- **Moving speed** row at the end of each forcer block: the orange line is the speed with the forcers, the dashed line without them (cadence × step length with the forcers' share divided out). The value reads "without → with" at the playhead.
- **View → Forcers** shows / hides the speakers, cones and arrows. **Hide all** turns off bones, IK handles, forcers, ghost and trail at once; a second click brings back what was on.

## Forcers: placed in 3D, custom controllers, steady anchor
- A forcer's **position and facing are no longer automated.** Select the speaker in the viewport and use **W** (move) or **E** (rotate); the change applies on release (auto-key on or off) and Ctrl+Z undoes it. ⚙ has number boxes for X / Y / Z (m) and Facing X / Y / Z (°).
- The block keeps four tracks: **Force, Spread, Weight, Response**.
- Older projects: position / facing tracks become the value they had at the playhead.
- **Your own IK controllers** (New IK controller) are in the target list. A forcer pushes / pulls the controller's pivot and all its members move with it. Measured: −200 N on a controller holding the left hand moves the hand 18.9 cm.
- A moving forcer now follows the runner's travel root, not the hips. The speaker no longer sways with each step or comes closer when the body leans (0 cm of wobble over a cycle while the hips sway 2.2 cm).

## Knees no longer fold backward
The leg IK now aims the knee along the runner's facing (from the hips), not from the shin. A strongly tilted pelvis (big forward lean, hip rotation, a strong forcer push) used to fold it backward: 73 / 480 frames with a 300 N push, 330 / 480 with lean and hip rotation +25°. Both are now 0.

Also fixed: the timing no longer uses a stale "is this track active" check right after a Hard braking edit.
