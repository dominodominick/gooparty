#!/usr/bin/env python3
"""The real Board Game Island's set pieces, recorded: every moment picked out of the traces of the real game, as played.

Input: the traces (the Wii Party recomp's bgi-trace v2 log), each turned into a compact events file by
tools/trace_parse.py and loaded by tools/trace_load.py (a pickle per log). For every moment found in them this keeps,
frame by frame and exactly as the real game had it:
  - each Mii in it: where they are, how they are turned (x, y, z, degrees), which animation their body plays, from which
    frame and how fast, and their face;
  - everyone else on the board: the animations they play where they stand (reacting to it);
  - the camera: where it is, where it looks, which way is up.
The game's spaces are where the real game's are (map units x 0.016, the volcano too), so it is all kept in the scene's
own units and places. Each kind of moment has its own marker in the trace (when it starts, on our set piece's clock).

Writes mii/clips/recordings.json (fetched by the game the first time it plays one; js15/scenes/replay.js plays them).
Usage:  python3 tools/extract_recordings.py out.json log1.pkl [log2.pkl ...]
"""
import sys, os, json, math, bisect, pickle, collections
import numpy as np

S = 0.016
HERE = os.path.dirname(os.path.abspath(__file__))
SP = json.load(open(os.path.join(HERE, 'trace_spaces.json')))
ISL = [(i, t, x * S, y * S, z * S) for i, t, x, y, z in SP['island']]
VOL = [(i, t, x * S, y * S, z * S) for i, t, x, y, z in SP['volcano']]  # (the volcano's spaces are already at +43750: 700 in the scene)
TYPE = {('I', i): t for i, t, *_ in ISL}; TYPE.update({('V', i): t for i, t, *_ in VOL})
FPS = 30
IDLE = {'pm011_08', 'pm000_16', 'pm000_17'}
MOVE_CLIPS = {'pm000_04', 'pm000_03'}

def near(p):
    best = None
    for tr, L in (('I', ISL), ('V', VOL)):
        for i, t, x, y, z in L:
            d = math.hypot(p[0] - x, p[2] - z)
            if best is None or d < best[0]: best = (d, tr, i)
    return best

class Log:
    def __init__(self, path, name):
        D = pickle.load(open(path, 'rb')); self.name = name; self.kind = D['kind']; self.oname = D.get('name', {})
        self.X = D['X']; self.CL = D['CL']; self.FR = D['FR']; self.SP = D['SP']; self.FACE = D['FACE']; self.CAM = D['CAM']
        self.MOD = sorted(D['MOD'])
        self.XT = {o: a[:, 0] for o, a in self.X.items()}
        self.CT = {o: [c[0] for c in L] for o, L in self.CL.items()}
        self.camT = self.CAM[:, 0]
        self.mods = collections.defaultdict(list)
        for t, o, nm, k in self.MOD:
            if k == 'setMo': self.mods[nm].append(t)

    def alive(self, t):
        return [o for o, T in self.XT.items() if self.kind.get(o) == 'mii' and len(T) and T[0] <= t <= T[-1] + 60]

    def models(self, prefixes, a, b):
        """The map's or the board's own models (named by `prefixes`) that move between a and b."""
        out = []
        for o, T in self.XT.items():
            nm = self.oname.get(o, '')
            if self.kind.get(o) == 'mii' or not nm.startswith(prefixes) or not len(T): continue
            i = bisect.bisect_left(T, a); j = bisect.bisect_right(T, b)
            if j - i < 2: continue
            P = self.X[o][i:j, 1:4]
            if np.ptp(P, axis=0).max() < 1: continue
            out.append((nm, o))
        return out

    def raw(self, o, t):
        """The last logged transform at or before t: (x, y, z) scene units, (rx, ry, rz) degrees; None before the first."""
        T = self.XT.get(o)
        if T is None: return None
        i = bisect.bisect_right(T, t) - 1
        if i < 0: return None
        r = self.X[o][i]
        return (r[1] * S, r[2] * S, r[3] * S), (r[4], r[5], r[6]), r[8]

    def pos(self, o, t):
        q = self.raw(o, t); return q[0] if q else None

    def valid(self, p):
        return p is not None and all(v == v for v in p) and abs(p[0]) + abs(p[2]) > 1 and abs(p[1]) < 500

    def space(self, o, t):
        p = self.pos(o, t)
        if not self.valid(p): return None
        n = near(p)
        return '%s%d' % (n[1], n[2]) if n[0] < 3.0 else None

    def clips(self, o, a, b):
        L = self.CL.get(o, []); T = self.CT.get(o, [])
        i = bisect.bisect_left(T, a); j = bisect.bisect_right(T, b)
        out = []
        for t, nm, k in L[i:j]:
            if out and out[-1][1] == nm and t - out[-1][0] < 0.02: continue
            out.append((t, nm))
        return out

    def clip_at(self, o, t):
        L = self.CL.get(o, []); T = self.CT.get(o, [])
        i = bisect.bisect_right(T, t) - 1
        return L[i] if i >= 0 else None

    def onboard(self, o, t):
        return self.space(o, t) is not None

def first(log, o, names, a, b):
    for t, c in log.clips(o, a, b):
        if c in names: return t
    return None

def movers(log, a, b, mind=0.8):
    out = []
    for o in log.alive(a):
        p0 = log.pos(o, a)
        if not log.valid(p0): continue
        T = log.XT[o]; i = bisect.bisect_left(T, a); j = bisect.bisect_right(T, b)
        m = 0
        for r in log.X[o][i:j]:
            p = (r[1] * S, r[2] * S, r[3] * S)
            if log.valid(p): m = max(m, math.dist(p, p0))
        if m > mind: out.append(o)
    return out

# ---------------------------------------------------------------- sampling
def reduce_keys(keys, eps):
    """Keep the keys a straight line between the kept ones would miss by more than eps (and every jump)."""
    if len(keys) <= 2: return keys
    out = [keys[0]]
    for k in range(1, len(keys) - 1):
        a = out[-1]; b = keys[k]; c = keys[k + 1]
        span = c[0] - a[0]
        if span <= 0: out.append(b); continue
        u = (b[0] - a[0]) / span
        if any(abs(a[n] + (c[n] - a[n]) * u - b[n]) > eps[n - 1] for n in range(1, len(b))): out.append(b)
    out.append(keys[-1])
    return out

def track(log, o, t0, t1):
    """One Mii, t0..t1: transform keys [t, x, y, z, rx, ry, rz] (None where the game does not place them: carried),
    clip keys [t, clip, frame, speed] (a speed change keeps the clip: clip None), faces [t, face]."""
    T = log.XT[o]; A = log.X[o]
    i = max(0, bisect.bisect_right(T, t0) - 1); j = bisect.bisect_right(T, t1)
    keys = []; prev = None
    def add(t, r):
        p = (r[1] * S, r[2] * S, r[3] * S)
        if not log.valid(p): keys.append([round(t - t0, 3), None]); return
        ry = r[5]
        if prev is not None and prev[0] is not None:  # unwrap the turn so it eases the short way
            while ry - prev[0] > 180: ry -= 360
            while ry - prev[0] < -180: ry += 360
        keys.append([round(max(0, t - t0), 3), round(p[0], 3), round(p[1], 3), round(p[2], 3), round(r[4], 2), round(ry, 2), round(r[6], 2)])
        return ry
    for k in range(i, j):
        r = A[k]; t = max(t0, r[0])
        ry = add(t, r)
        prev = (ry,) if ry is not None else (None,)
    if keys and keys[-1][0] < t1 - t0 - 1e-3 and keys[-1][1] is not None: keys.append([round(t1 - t0, 3)] + keys[-1][1:])
    # split into runs (carried: None) and thin each run
    out = []; run = []
    for k in keys:
        if k[1] is None:
            if run: out += reduce_keys(run, (0.01, 0.01, 0.01, 0.5, 0.5, 0.5)); run = []
            if not out or out[-1][1] is not None: out.append([k[0], None])
        else: run.append(k)
    if run: out += reduce_keys(run, (0.01, 0.01, 0.01, 0.5, 0.5, 0.5))
    # dedupe equal times (a jump: keep both, the later nudged)
    # clips: the one playing at t0, then every change; frame from the game's frame sets and speeds
    cl = []
    cur = log.clip_at(o, t0)
    events = [(t, 'clip', nm) for t, nm in log.clips(o, t0, t1)]
    events += [(t, 'frame', f) for t, f in log.FR.get(o, []) if t0 <= t <= t1]
    # speed: from the transform log's v (logged whenever it changes)
    sp_ev = []; lastv = None
    for k in range(i, j):
        v = A[k][8]
        if v != lastv: sp_ev.append((max(t0, A[k][0]), v)); lastv = v
    events += [(t, 'speed', v) for t, v in sp_ev]
    events.sort(key=lambda e: e[0])
    clip = cur[1] if cur else None
    # the frame the playing clip is on at t0: from its start (it started at frame 0) at the speed then
    start = cur[0] if cur else t0
    speed = 1.0
    f = 0.0; tl = start
    # walk from the clip's start to t0 for its frame
    pre = [(t, v) for t, v in sp_ev if t <= t0]
    if pre: speed = pre[-1][1]
    f = max(0.0, (t0 - start) * 60 * speed)
    tl = t0
    if clip: cl.append([0, clip, round(f, 2), speed])
    for t, kind, val in events:
        f += (t - tl) * 60 * speed; tl = t
        if kind == 'clip': clip = val; f = 0.0; cl.append([round(t - t0, 3), clip, 0, speed])
        elif kind == 'frame': f = val; cl.append([round(t - t0, 3), None, round(f, 2), speed])
        elif kind == 'speed':
            if val < 0: continue
            speed = val; cl.append([round(t - t0, 3), None, round(f, 2), speed])
    # drop no-op speed/frame keys
    cl2 = []
    for c in cl:
        if c[1] is None and cl2 and cl2[-1][3] == c[3] and abs(cl2[-1][2] + (c[0] - cl2[-1][0]) * 60 * cl2[-1][3] - c[2]) < 0.6: continue
        cl2.append(c)
    faces = [[round(t - t0, 3), fc] for t, fc in log.FACE.get(o, []) if t0 <= t <= t1]
    fb = [x for x in log.FACE.get(o, []) if x[0] < t0]
    if fb: faces.insert(0, [0, fb[-1][1]])
    return {'k': out, 'c': cl2, 'f': faces}

def camera(log, t0, t1):
    T = log.camT; C = log.CAM
    i = max(0, bisect.bisect_right(T, t0) - 1); j = bisect.bisect_right(T, t1)
    keys = []
    for k in range(i, j):
        r = C[k]
        keys.append([round(max(0, r[0] - t0), 3)] + [round(v * S, 3) for v in r[1:7]] + [round(v, 3) for v in r[7:10]])
    if keys and keys[-1][0] < t1 - t0: keys.append([round(t1 - t0, 3)] + keys[-1][1:])
    # a cut: the camera jumps; keep a key just before it so it does not slide
    out = []
    for k in keys:
        if out and math.dist(out[-1][1:4], k[1:4]) > 6 and k[0] - out[-1][0] > 0.02:
            out.append([round(k[0] - 0.001, 3)] + out[-1][1:])
        out.append(k)
    return reduce_keys(out, (0.01,) * 6 + (0.002,) * 3)

def onlookers(log, roles, t0, t1):
    """Everyone else on the board: where they stand at t0, and the animations they play (not walking or the idles)."""
    out = []
    for o in log.alive(t0):
        if o in roles or not log.onboard(o, t0): continue
        cl = [[round(t - t0, 3), c] for t, c in log.clips(o, t0, t1)]
        if not any(c not in IDLE for _, c in cl): continue
        p = log.pos(o, t0)
        out.append({'at': [round(v, 2) for v in p], 'c': cl, 'f': [[round(t - t0, 3), fc] for t, fc in log.FACE.get(o, []) if t0 <= t <= t1]})
    return out

MODEL_OF = {'ufo': ('m001_82', 'm001_83'), 'move.fly.tornado': ('op001_tornado',), 'move.fly.ptero': ('mr001_02',), 'move.fly.trex': ('mr001_01',)}

def instance(log, key, t0, length, roles, extra=None):
    who = []
    for role, o in roles:
        tr = track(log, o, t0, t0 + length)
        tr['role'] = role; tr['from'] = log.space(o, t0); tr['to'] = log.space(o, t0 + length)
        who.append(tr)
    d = {'src': '%s@%.2f' % (log.name, t0), 'len': round(length, 3), 'who': who, 'cam': camera(log, t0, t0 + length),
         'look': onlookers(log, {o for _, o in roles}, t0, t0 + length)}
    if key in MODEL_OF:  # the models in it, as recorded: where they are, how they are turned, which of their clips plays
        d['models'] = {}
        for nm, o in log.models(MODEL_OF[key], t0, t0 + length):
            base = nm.split('_')[0] + '_' + nm.split('_')[1]
            if base in d['models']: continue
            tr = track(log, o, t0, t0 + length); tr['f'] = []
            d['models'][base] = tr
    if extra: d.update(extra)
    return d

# ---------------------------------------------------------------- the moments
def clusters(ts, gap=3.0):
    out = []
    for t in sorted(ts):
        if not out or t - out[-1] > gap: out.append(t)
    return out

def find_mii(log, a, b, names, where=None):
    """The Mii that plays one of `names` between a and b (nearest to `where` if given)."""
    best = None
    for o in log.alive(a):
        t = first(log, o, names, a, b)
        if t is None: continue
        if where is not None:
            p = log.pos(o, t)
            if not log.valid(p): continue
            d = math.dist(p[::2], where[::2])
        else: d = t
        if best is None or d < best[0]: best = (d, o, t)
    return (best[1], best[2]) if best else (None, None)

REC = collections.defaultdict(list)
def add(key, inst): REC[key].append(inst)

def springs(log):
    from_kind = {}
    for nm in ('op001_jump1_1', 'op001_jump2_1'):
        for T in clusters(log.mods[nm]):
            o, t08 = find_mii(log, T - 1.2, T + 1.2, {'pm001_08'})
            if not o: continue
            t15 = first(log, o, {'pm001_15'}, t08 - 1.0, t08)
            if t15 is None: continue
            fl = log.clips(o, t08, t08 + 3)
            back = any(c == 'pm001_11' for _, c in fl)
            # the end: the reaction (a fist pump, or the head hung) played out, back to standing
            react = first(log, o, {'pm001_06', 'pm001_07'}, t08 + 1, t08 + 8)
            end = (react + (1.40 if not back else 1.48) + 1.2) if react else t08 + 6
            frm = log.space(o, t15)
            ty = TYPE.get((frm[0], int(frm[1:]))) if frm else None
            if nm == 'op001_jump2_1': key = 'move.spring.red'
            elif ty in ('mg11', 'mgRest') or back: key = 'move.spring.green.back' if back else 'move.spring.green'
            else: key = 'move.spring.blue'
            add(key, instance(log, key, t15, end - t15, [('actor', o)]))

def statues(log):
    for nm, color in (('m001_30_1', 'blue'), ('m001_31_1', 'red')):
        for T in clusters(log.mods[nm], 30):
            marker = {'pm405_09'} if color == 'blue' else {'pm001_03'}
            o, t = find_mii(log, T - 1, T + 12, marker)
            if not o: continue
            L = 16.116 if color == 'blue' else 14.830
            add('move.fly.statue.' + color, instance(log, 'statue', T, L, [('actor', o)]))

def dragon(log):
    for T in clusters(log.mods['m001_35_4']):  # the fireball
        o, t = find_mii(log, T, T + 3, {'pm001_11'})
        if not o: continue
        add('note.fireball', instance(log, '', T - 0.859, 1.393, [('actor', o)]))
        add('move.knock', instance(log, '', T - 0.859 + 1.393, 4.438, [('actor', o)]))
    for T in clusters(log.mods['m001_35_2'], 20):  # the wall broken
        o, t = find_mii(log, T - 4, T + 1, {'pm301_02', 'pm301_03', 'pm301_04', 'pm301_05'})
        if not o: continue
        add('smash.dragon', instance(log, '', t, 7.391, [('actor', o)]))

def gate(log):
    for T in clusters(log.mods['m001_60_2'], 20):  # opened: a win
        o, t = find_mii(log, T - 5, T + 1, {'pm301_02', 'pm301_03', 'pm301_04', 'pm301_05'})
        if not o: continue
        add('smash.final', instance(log, '', t, 5.476, [('actor', o)]))

def tornado(log):
    for T in clusters(log.mods['op001_tornado_1'], 20):
        v, t = find_mii(log, T, T + 12, {'pm001_11'})
        if not v: continue
        # it ends when they have landed and sat a moment (pm001_05 played out)
        sit = first(log, v, {'pm001_05'}, T, T + 25)
        end = (sit + 1.6) if sit else T + 9
        # who landed on the tornado: the one who rolled for it just before
        lander, tl = find_mii(log, T - 8, T + 0.5, {'pm011_09'})
        roles = [('actor', v)] + ([('lander', lander)] if lander and lander != v else [])
        add('move.fly.tornado', instance(log, 'move.fly.tornado', T, end - T, roles))

def rise(log, o, a, b, dy=0.5):
    """When a Mii starts going up (beamed up), after a."""
    p0 = log.pos(o, a)
    if not log.valid(p0): return None
    T = log.XT[o]; i = bisect.bisect_left(T, a); j = bisect.bisect_right(T, b)
    for r in log.X[o][i:j]:
        if r[2] * S > p0[1] + dy: return r[0]
    return None

def ufo(log):
    for T in clusters(log.mods['m001_83'], 20):  # the UFO comes
        a, ta = find_mii(log, T - 3, T + 6, {'pm001_01'})
        if not a: continue
        pa = log.pos(a, T)
        # the other: whoever ends up where the lander was (they swap)
        other = None
        for o in log.alive(T):
            if o == a: continue
            q = log.pos(o, T + 14)
            if log.valid(q) and math.dist(q[::2], pa[::2]) < 3 and log.valid(log.pos(o, T)) and math.dist(log.pos(o, T)[::2], pa[::2]) > 3: other = o; break
        if not other: continue
        fa = first(log, a, {'pm001_11'}, T, T + 20); fo = first(log, other, {'pm001_11'}, T, T + 20)
        ra = rise(log, a, T, T + 10); ro = rise(log, other, T, T + 15)
        if None in (fa, fo, ra, ro): continue
        ups = [t for o in (a, other) for t, c in log.clips(o, T, T + 20) if c == 'pm206_03']
        end = (max(ups) + 1.2) if ups else fa + 3
        # our four events: the lander beamed up, the other beamed up, the other put down, the lander put down. In the real
        # game the other is never seen going up: they drop onto the lander's space straight after the lander has gone
        ph = [0, round(fo - 0.9 - T, 3), round(fo - 0.9 - T, 3), round(fa - 0.9 - T, 3), round(end - T, 3)]
        add('ufo', instance(log, 'ufo', T, end - T, [('actor', a), ('other', other)], {'phases': ph}))

def dinos(log):
    for T in clusters(log.mods['mr001_01_1'], 20):  # the T-Rex
        o, t = find_mii(log, T - 1, T + 10, {'pm405_04'})
        if not o: continue
        t2 = first(log, o, {'pm001_02'}, T - 2, T + 6) or T
        sad = first(log, o, {'pm001_16'}, t2, t2 + 12)
        add('move.fly.trex', instance(log, 'move.fly.trex', t2, ((sad + 2.9) if sad else t2 + 8) - t2, [('actor', o)]))
    # the pterodactyl: a Mii on a dino space grabbed (pm001_17), carried, set down (pm001_10)
    for o, L in log.CL.items():
        for t, nm, k in L:
            if nm != 'pm001_17': continue
            s = log.space(o, t - 0.3)
            if not s or TYPE.get((s[0], int(s[1:]))) != 'dino': continue
            pump = first(log, o, {'pm001_06'}, t, t + 10)
            add('move.fly.ptero', instance(log, 'move.fly.ptero', t - 0.2, ((pump + 1.5) if pump else t + 8) - (t - 0.2), [('actor', o)]))

def main():
    out_path = sys.argv[1]
    for k, p in enumerate(sys.argv[2:]):
        log = Log(p, 'L%d' % (k + 1))
        springs(log); statues(log); dragon(log); gate(log); tornado(log); ufo(log); dinos(log)
        print(p, {k: len(v) for k, v in REC.items()})
    data = {'v': 1, 'rec': REC}
    json.dump(data, open(out_path, 'w'), separators=(',', ':'))
    print(out_path, os.path.getsize(out_path) // 1024, 'KB')
    # the index (bundled with the game: the host takes each moment's length from it): key -> [from, to, length, the
    # other's from, phases]
    idx = {k: [[x['who'][0]['from'], x['who'][0]['to'], x['len'], x['who'][1]['from'] if len(x['who']) > 1 else None] + ([x['phases']] if 'phases' in x else []) for x in L] for k, L in REC.items()}
    js = os.path.join(HERE, '..', 'js15', 'game', 'recIndex.js')
    with open(js, 'w') as f:
        f.write('// Generated by tools/extract_recordings.py. Do not edit. Every recorded moment of the real game (the full\n')
        f.write('// recordings are in mii/clips/recordings.json): key -> [[from, to, length (s), the other Mii\'s from, (phases)], ...].\n')
        f.write('export const REC_INDEX = ' + json.dumps(idx, separators=(',', ':')) + ';\n')

if __name__ == '__main__':
    main()
