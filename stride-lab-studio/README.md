# Stride Lab Studio

Animation studio for the Stride Lab character rig: a three.js viewport with an
anatomical full-body IK solver, clip-driven locomotion, and an automation
timeline for keying per-bone weight/adjustment curves.

Imported from the Claude artifact
<https://claude.ai/artifact/WPq3DrCg2zyL4d3yKtTtuy> (version `1790513910-0690`).

## Running

`index.html` is self-contained: the character (`character.glb`) and motion
libraries (`motionlib.json`, `getups.json`) are embedded as `<script>` blocks.
three.js and Google Fonts load from CDNs, so a network connection is needed.

Serve the folder over HTTP (ES modules don't load from `file://`):

```sh
python3 -m http.server -d stride-lab-studio 8000
# open http://localhost:8000
```

Outside claude.ai the artifact runtime (`window.claude`) is absent, so the
shared database and download capabilities are skipped; everything else works.
