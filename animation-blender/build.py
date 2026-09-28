#!/usr/bin/env python3
"""Bundle src/ + assets/ into one self-contained page: dist/animation-blender.html."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC, ASSETS, DIST = ROOT / 'src', ROOT / 'assets', ROOT / 'dist'
# module order matters only for top-level statements; every file shares one module scope
JS = ['engine.js', 'core.js', 'axes.js', 'pose.js', 'mirror.js', 'timeline.js', 'viewport.js', 'bake.js', 'io.js']
ASSET_FILES = ['character.glb.txt', 'motionlib.json', 'getups.json']


def main():
    page = (SRC / 'index.html').read_text(encoding='utf-8')
    css = (SRC / 'style.css').read_text(encoding='utf-8')
    js = '\n'.join((SRC / f).read_text(encoding='utf-8') for f in JS)
    for name, text in (('css', css), ('js', js)):
        if '</script' in text.lower() and name == 'js':
            raise SystemExit('a JS source contains "</script": it would end the inline module early')
    assets = '\n'.join(
        f'<script type="text/plain" id="asset:{n}">{(ASSETS / n).read_text(encoding="utf-8")}</script>'
        for n in ASSET_FILES)
    page = page.replace('/* @css */', css, 1).replace('/* @js */', js, 1).replace('<!-- @assets -->', assets, 1)
    DIST.mkdir(exist_ok=True)
    out = DIST / 'animation-blender.html'
    out.write_text(page, encoding='utf-8')
    print(f'wrote {out.relative_to(ROOT)} ({out.stat().st_size / 1e6:.1f} MB)')


if __name__ == '__main__':
    main()
