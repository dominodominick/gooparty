# Load a compact events file (parse2.py output) into per-object arrays, pickled next to it.
import gzip, sys, re, pickle, collections, numpy as np
src = sys.argv[1]; dst = sys.argv[2]
kind = {}; name = {}; X = collections.defaultdict(list)
# besides the Miis, the map's and the board's own models that move in a set piece: the UFO and its beam, the tornado,
# the pterodactyl, the T-Rex, the springs
MODELS = ('m001_82', 'm001_83', 'op001_tornado', 'mr001_01', 'mr001_02', 'op001_jump', 'm001_81')
keep = lambda o: kind.get(o) == 'mii' or name.get(o, '').startswith(MODELS); CL = collections.defaultdict(list); FR = collections.defaultdict(list); SP = collections.defaultdict(list)
FACE = collections.defaultdict(list); CAM = []; MOD = []
rx_s = re.compile(r'obj=(\w+) f1=(\S+)')
for ln in gzip.open(src, 'rt'):
    c = ln[0]
    if c == 'X':
        _, t, o, p, rot, r, m, v = ln.split()
        if not keep(o): continue
        X[o].append((float(t), *map(float, p.split(',')), *map(float, rot.split(',')), int(m), float(v)))
    elif c == 'A':
        _, t, o, i, b, k = ln.split(); kind[o] = k
        if i == '0' or o not in name or not name[o].startswith(MODELS): name[o] = b if (i in ('0', '1') or o not in name) else name[o]
    elif c == 'M':
        p = ln.split(); t = float(p[1]); o = p[2]; nm = p[4]
        if nm.startswith('pm') or nm.startswith(MODELS): CL[o].append((t, nm, p[3]))
        if not nm.startswith('pm') and nm != '?': MOD.append((t, o, nm, p[3]))
    elif c == 'S':
        p = ln.split(None, 3); m = rx_s.search(p[3])
        if not m: continue
        (FR if p[2] == 'frame' else SP)[m.group(1)].append((float(p[1]), float(m.group(2))))
    elif c == 'F':
        p = ln.split(); t = float(p[1]); mii = int(p[2][4:], 16); face = int(p[3][5:])
        FACE['%08x' % (mii + 0x54)].append((t, face))
    elif c == 'C':
        if 'mtx=90d2c1dc' not in ln: continue
        p = ln.split(); t = float(p[1])
        e = [float(v) for v in p[3][4:].split(',')]; g = [float(v) for v in p[4][7:].split(',')]; u = [float(v) for v in p[5][3:].split(',')]
        CAM.append((t, *e, *g, *u))
out = {'name': name, 'X': {o: np.array(v) for o, v in X.items()}, 'CL': dict(CL), 'FR': dict(FR), 'SP': dict(SP), 'FACE': dict(FACE),
       'CAM': np.array(CAM), 'MOD': MOD, 'kind': kind}
pickle.dump(out, open(dst, 'wb'))
print(len(out['X']), 'miis', len(CAM), 'camera frames', len(MOD), 'model clips', sum(len(v) for v in FACE.values()), 'faces')
