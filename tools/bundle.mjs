// Builds ONE self-contained file (party-island.html): the page, the CSS and every module inlined.
// Usage: node tools/bundle.mjs   ->   writes party-island.html next to index.html
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const entry = 'js15/main.js';
const mods = new Map(); // relative path -> { code, deps }
const externals = new Set();

function load(rel) {
  if (mods.has(rel)) return;
  let code = fs.readFileSync(path.join(root, rel), 'utf8');
  const entryRec = { code: null, deps: [] };
  mods.set(rel, entryRec); // register first (guards against cycles)
  const exportsList = [];
  // imports from outside the project (three.js and its GLTF loader) stay real imports, hoisted to the top of the bundle
  code = code.replace(/^import\s+([^;]*?)\s+from\s*['"]([^.'"][^'"]*)['"]\s*;?/gm, (_, what, spec) => { externals.add(`import ${what} from '${spec}';`); return ''; });
  // imports: import { a, b as c } from './x.js';   (only named imports are used in this project)
  code = code.replace(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?/g, (_, names, spec) => {
    const dep = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
    load(dep);
    entryRec.deps.push(dep);
    const list = names.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/\s+as\s+/, ': '));
    return `const { ${list.join(', ')} } = __mods[${JSON.stringify(dep)}];`;
  });
  // exports: export const|let|function|class NAME
  code = code.replace(/^export\s+((?:async\s+)?(?:const|let|function\*?|class)\s+)([A-Za-z0-9_$]+)/gm, (_, kw, name) => {
    exportsList.push(name);
    return `${kw}${name}`;
  });
  if (/^\s*export\s/m.test(code)) throw new Error(`unsupported export form in ${rel}`);
  if (/\bimport\s*\(|import\.meta|^await\s/m.test(code)) throw new Error(`unsupported syntax in ${rel}`);
  entryRec.code = `__mods[${JSON.stringify(rel)}] = (() => {\n${code}\nreturn { ${exportsList.join(', ')} };\n})();`;
}

load(entry);
// dependencies first
const order = []; const seen = new Set();
(function visit(rel) {
  if (seen.has(rel)) return; seen.add(rel);
  for (const d of mods.get(rel).deps) visit(d);
  order.push(rel);
})(entry);

const bundle = `${[...externals].join('\n')}\nconst __mods = {};\n${order.map((r) => mods.get(r).code).join('\n')}`.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync(path.join(root, 'style15.css'), 'utf8');
// the map's files, packed into the page so that one double-clicked file is the whole game
const A = path.join(root, 'assets', 'board-game-island'), assets = {};
for (const f of ['island.glb', 'volcano.glb', 'sky.glb', 'props.glb']) assets[f] = fs.readFileSync(path.join(A, f)).toString('base64');
assets['board.json'] = fs.readFileSync(path.join(A, 'board.json'), 'utf8');
const assetScript = `<script>window.__BOARD_ASSETS = ${JSON.stringify(assets).replace(/<\/script/gi, '<\\/script')};</script>`;
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html
  .replace(/<link rel="stylesheet" href="style15.css">/, () => `<style>\n${css}\n</style>`)
  .replace(/<script type="module" src="[^"]*"><\/script>/, () => `${assetScript}\n<script type="module">\n${bundle}\n</script>`);
if (html.includes('src="js15/') || html.includes('href="style15.css"')) throw new Error('bundle still references separate files');
fs.writeFileSync(path.join(root, 'party-island.html'), html);
console.log(`party-island.html written (${(html.length / 1024 / 1024).toFixed(1)} MB, ${order.length} modules)`);
// the same page without the <html>/<head>/<body> wrapper, for hosts that add their own
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta[^>]*>/g, ''), body = html.match(/<body>([\s\S]*)<\/body>/)[1];
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'page.html'), head + body);
