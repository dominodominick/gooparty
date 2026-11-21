# Mii body dump

How `js15/world/miiBodyData.js` was made from the creator's `miiBody{M,F}_wiiu.glb` (meshopt-compressed glTF):
`dump.html` loads both bodies with three.js's GLTFLoader and meshopt decoder and writes out the node tree, the skinned
meshes and the first frame of the `Wait` animation; `dump.mjs` runs it in headless Chromium (Playwright) and saves
`bodydump.json`, which a few lines of Python turned into the data file.

The page needs, next to it: `three.js` (an ES module exporting every three.js name; the creator's `mii/dist/three.js`
re-exported name by name works), `gltf/GLTFLoader.js` and `gltf/meshopt.js` (the creator's `mii/dist/main.js` bundles
both; cut out of it, with an import of the three.js names they use), and the two .glb files (decoded from
`mii/assets/models/*.glb.b64.txt`). Serve the folder (`python3 -m http.server 8765`) and run `node dump.mjs`.
