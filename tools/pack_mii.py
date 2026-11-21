#!/usr/bin/env python3
"""Packs the open-source Mii creator (mii-creator-public, a Mii Maker remake: https://github.com/datkat21/mii-creator, this
copy a public instance by ariankordi) into mii/, next to the game, so the game can open it full screen and use its Mii
renderer (FFL.js) for the players' heads.

What it changes, so it runs inside a published artifact (files served from a sub-folder, only web file types served):
  - .zip, .glb and .dat files are stored as base64 text (X.zip -> X.zip.b64.txt) and a small fetch() shim in index.html reads
    them back;
  - paths that assumed the site root ("/dist/three.js", origin + "/assets/...") are made relative to the script;
  - the creator's error reporting (Sentry) is turned off, and the Mii parts file is read from next to it;
  - two literal U+FFFD characters in a UTF-8 decoder are written as "\\uFFFD" escapes (same string);
  - the pieces the game does not use are left out (the old API page, the sign-in popup, the embedding helper, source maps,
    the loose hat models that are also inside the hat bundle).
And it copies FFL.js (src/external/ffl.js) to mii/ffl/ with tools/mii/game-ffl.js, the game's door into it.

Usage:  python3 tools/pack_mii.py path/to/mii-creator-public.zip
"""
import sys, os, io, re, zipfile, base64, shutil

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'mii')
z = zipfile.ZipFile(sys.argv[1])
names = z.namelist()
top = names[0].split('/')[0] + '/'
DROP = re.compile(r'^(api-test\.html|popup\.html|dist/popup\.js|dist/helper\.js|dist/.*\.map|assets/models/hat_[0-9]+\.glb|assets/images/README\.md)$')

if os.path.isdir(OUT): shutil.rmtree(OUT)
count = 0
for n in names:
    if n.endswith('/') or not n.startswith(top + 'public/'): continue
    rel = n[len(top + 'public/'):]
    if DROP.match(rel): continue
    data = z.read(n)
    if rel.endswith(('.zip', '.dat', '.glb')): rel += '.b64.txt'; data = base64.b64encode(data)
    if rel in ('dist/main.js', 'dist/worker.js'):
        s = data.decode('utf-8')
        for a, b in [('new URL(import.meta.url).origin + "/dist/three.js"', 'new URL("./three.js", import.meta.url).href'),
                     ('return root2.origin + "/dist/" + path;', 'return new URL("./" + path, import.meta.url).href;'),
                     ('return "/dist/" + path;', 'return new URL("./" + path, import.meta.url).href;'),
                     ('setRoot(root2.origin + "/")', 'setRoot(new URL("../", import.meta.url).href)'),
                     ('root2.origin + "/assets/audio/miiSelector.zip"', 'new URL("../assets/audio/miiSelector.zip", import.meta.url).href'),
                     ('root2.origin + "/popup.html?"', 'new URL("../popup.html?", import.meta.url).href'),
                     ('"/FFLResHigh.dat"', '"./FFLResHigh.dat"'), ('"/FFLResMiddle.dat"', '"./FFLResHigh.dat"'), ('"/FFLResLow.dat"', '"./FFLResHigh.dat"'),
                     # opened straight into the editor (?data=...), wait for the Mii renderer before building the head
                     ('if (searchParams.has("data")) {\n      new MiiEditor2(0,', 'if (searchParams.has("data")) {\n      ensureFFLReady().catch(() => {}).then(() => new MiiEditor2(0,'),
                     ('}, searchParams.get("data"));', '}, searchParams.get("data")));'),
                     # (the music may never have started: don't let fading it stop the Mii being sent back)
                     ('          mm2.mainGainNode.gain.linearRampToValueAtTime(-1, mm2.audioContext.currentTime + 0.5);\n          window.parent.postMessage({',
                      '          if (mm2.mainGainNode) mm2.mainGainNode.gain.linearRampToValueAtTime(-1, mm2.audioContext.currentTime + 0.5);\n          window.parent.postMessage({'),
                     ('useSentry: true,', 'useSentry: false,'),  # (no error reports sent to the creator's error tracker)
                     ('//! NOTE: THIS ASSUMES THE ROOT IS THE PUBLIC FOLDER\nvar root = "/";', '//! (Party Island: the creator is in a sub-folder)\nvar root = new URL("../", import.meta.url).href;'),
                     ('"�"', '"\\uFFFD"')]:
            s = s.replace(a, b)
        assert '�' not in s and '"/dist/' not in s and 'var root = "/";' not in s, rel
        data = s.encode('utf-8')
    if rel == 'index.html':
        s = data.decode('utf-8')
        shim = open(os.path.join(ROOT, 'tools', 'mii', 'fetch-shim.html')).read()
        s = s.replace('<link rel="stylesheet"', shim + '    <link rel="stylesheet"', 1)
        data = s.encode('utf-8')
    dst = os.path.join(OUT, rel); os.makedirs(os.path.dirname(dst), exist_ok=True)
    open(dst, 'wb').write(data); count += 1

# FFL.js for the game's own Mii heads
F = os.path.join(OUT, 'ffl'); os.makedirs(F, exist_ok=True)
for f in ('ffl.js', 'struct-fu.js', 'ffl-emscripten.js', 'FFLShaderMaterial.js'):
    s = z.read(top + 'src/external/ffl.js/' + f).decode('utf-8')
    if f == 'FFLShaderMaterial.js':
        s = re.sub(r"import \{ _THREE \} from '../../util/PrepareThree';\s*const THREE = _THREE\(\);", "import * as THREE from 'three';", s, count=1)
        assert 'PrepareThree' not in s
    open(os.path.join(F, f), 'w').write(s)
open(os.path.join(F, 'ffl-emscripten.wasm'), 'wb').write(z.read(top + 'public/dist/ffl-emscripten.wasm'))
shutil.copy(os.path.join(ROOT, 'tools', 'mii', 'game-ffl.js'), F)
open(os.path.join(OUT, 'CREDITS.txt'), 'w').write(open(os.path.join(ROOT, 'tools', 'mii', 'CREDITS.txt')).read())
size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(OUT) for f in fs)
print(count, 'creator files +', len(os.listdir(F)), 'FFL files ->', os.path.relpath(OUT, ROOT), f'({size / 1e6:.1f} MB)')
