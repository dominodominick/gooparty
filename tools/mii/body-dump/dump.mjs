import { createRequire } from 'node:module'; import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const b = await chromium.launch(); const p = await b.newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto('http://127.0.0.1:8765/dump.html'); await p.waitForFunction(() => window.__done, null, { timeout: 60000 });
const o = await p.evaluate(() => window.__out); fs.writeFileSync('bodydump.json', JSON.stringify(o)); await b.close();
for (const g of ['M', 'F']) { console.log(g, o[g].nodes.map((n, i) => i + ':' + n.name + '(' + n.kind + ',' + n.parent + ')').join(' ')); for (const m of o[g].meshes) console.log(' mesh', o[g].nodes[m.node].name, m.pos.length / 3, 'col', m.colMinMax, 'bones', m.bones.length, 'bind', m.bind.join(',')); console.log(' wait arm_l1', o[g].wait.arm_l1, 'foot_l1', o[g].wait.foot_l1, 'head', o[g].wait.head); }
