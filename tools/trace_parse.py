# Parse the v2 trace (streamed from gzip) into a compact events file: only the models (objects that had clips added:
# Miis' pm*, map models' m001_*, npc mr001_*), their clip changes, transforms, speeds, frames; faces; cameras.
import gzip, sys, re, json
src, out = sys.argv[1], sys.argv[2]
names = {}      # obj -> {id: name}
kindof = {}     # obj -> 'mii' | 'map' | 'npc' | 'other'
oname = {}      # obj -> the name of its first motion (the board's own models: op001_tornado, op001_jump...)
lastxf = {}
o = gzip.open(out, 'wt', compresslevel=3)
def cls(n):
    b = n.rsplit('/', 1)[-1]
    if b.startswith('pm'): return 'mii'
    if b.startswith('m0') or b.startswith('s0'): return 'map'
    if b.startswith('mr') or 'npc' in n: return 'npc'
    return 'other'
rx_add = re.compile(r'obj=(\w+) name=(\S+) .*-> id=(-?\d+)')
rx_mo = re.compile(r'obj=(\w+) id=(-?\d+)(.*)')
rx_xf = re.compile(r'obj=(\w+) p=(\S+) r=(\S+) s=(\S+) m=(-?\d+) v=(\S+)')
n = 0
for line in gzip.open(src, 'rt', errors='replace'):
    n += 1
    if line[0] == '#': continue
    parts = line.split(None, 2)
    if len(parts) < 3: continue
    t, k, rest = parts
    if k == 'xf':
        m = rx_xf.search(rest)
        if not m: continue
        ob = m.group(1)
        if kindof.get(ob) not in ('mii', 'map', 'npc') and not oname.get(ob, '').startswith('op001'): continue
        o.write('X %s %s %s %s %s %s %s\n' % (t, ob, m.group(2), m.group(4), m.group(3), m.group(5), m.group(6)))  # p, rot(+0xb8), +0xac, clip id, speed
    elif k == 'addMotion':
        m = rx_add.search(rest)
        if not m: continue
        ob, nm, i = m.group(1), m.group(2), int(m.group(3))
        if i == 0: names[ob] = {}
        if i <= 1: oname[ob] = nm.rsplit('/', 1)[-1].split('.')[0]
        names.setdefault(ob, {})[i] = nm
        c = cls(nm)
        if i == 0 or kindof.get(ob) in (None, 'other'): kindof[ob] = c
        base = nm.rsplit('/', 1)[-1].split('.')[0]
        o.write('A %s %s %d %s %s\n' % (t, ob, i, base, kindof[ob]))
    elif k in ('setMotion', 'shiftMotion', 'idleMotion'):
        m = rx_mo.search(rest)
        if not m: continue
        ob, i = m.group(1), int(m.group(2))
        nm = names.get(ob, {}).get(i, '?')
        base = nm.rsplit('/', 1)[-1].split('.')[0]
        extra = ' '.join(x for x in m.group(3).split() if x.startswith(('f1=', 'f2=', 'r5=', 'r6=', 'r7=', 'caller=')))
        o.write('M %s %s %s %s %s\n' % (t, ob, k[:5], base, extra))
    elif k in ('speed', 'frame') and 'obj=' in rest:
        o.write('S %s %s %s\n' % (t, k, rest.strip()))
    elif k == 'face':
        o.write('F %s %s\n' % (t, rest.strip()))
    elif k == 'camera':
        o.write('C %s %s\n' % (t, rest.strip()))
    elif k == 'frame':
        if n % 60 == 0: o.write('T %s %s\n' % (t, rest.strip()))
o.close()
print('lines', n)
