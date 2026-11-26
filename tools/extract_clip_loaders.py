#!/usr/bin/env python3
"""Which of Wii Party's Mii clips each board, mode and minigame loads, for the animation gallery's dropdown.

Every program module on the disc (files/rel/<id>.rel.lz: mr001 = Board Game Island, mg100 = Commuter Count, ...) names the
clips it loads as file paths: "ch_base/player_motion/pm001_04.branm". This reads those paths out of every module, and the
English name of each board and minigame out of the game's text (files/locale/en_US/mess.bin: label MG100 -> "Commuter
Count", mr001_00 -> "Board Game Island").

Every module also holds the same list of 63 clip names without paths (shared code compiled into all of them): that list
is kept apart as SHARED, not counted for each module.

  python3 tools/extract_clip_loaders.py <rel folder> <mess.bin>
writes js15/world/wpClipLoaders.js.
"""
import sys, os, re, glob, json, struct
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'wii'))
from lz import unlz

rel_dir, mess = sys.argv[1], sys.argv[2]


def texts(path):
    """mess.bin ("XMSG"): u32 count at 8, then per message 4 u32s: label offset (ASCII), text offset (UTF-16BE), ..."""
    d = open(path, 'rb').read()
    assert d[:4] == b'XMSG', 'not a Wii Party mess.bin'
    n = struct.unpack('>I', d[8:12])[0]
    out = {}
    for k in range(n):
        a, b, _, _ = struct.unpack('>4I', d[12 + 16 * k:28 + 16 * k])
        label = d[a:d.index(b'\0', a)].decode('latin1')
        t = b''
        while d[b:b + 2] != b'\0\0': t += d[b:b + 2]; b += 2
        out[label] = re.sub(r'\[c:#\w+\]', '', t.decode('utf-16-be', 'replace')).replace('\n', ' ').strip()
    return out


T = texts(mess)
# boards and modes: mr001_00 "Board Game Island"; Balance Boat's modules (mr051, mr052) share mr050's name
MODES = {k[:5]: v for k, v in T.items() if re.match(r'^mr\d{3}_00$', k)}
OTHER = {'inst': 'Instructions screens', 'menu': 'Menus', 'ranking': 'Rankings', 'openmess': 'Opening messages',
         'boot': 'Boot', 'loading': 'Loading screen'}


def name_of(m):
    if m.startswith('mg'): return T.get('MG' + m[2:], m)
    if m.startswith('mr'):
        if m in MODES: return MODES[m]
        if m[:4] == 'mr05': return MODES.get('mr050', m)
        return m
    if m.startswith('ms'): # the minigame modes' own modules: no name of their own in the text
        return {'ms601': 'Minigame mode ms601', 'ms602': 'Minigame mode ms602', 'ms603': 'Minigame mode ms603'}.get(m, m)
    return OTHER.get(m, m)


def group_of(m):
    return 'board' if m.startswith(('mr', 'ms')) else 'minigame' if m.startswith('mg') else 'other'


loaders, shared = [], None
for p in sorted(glob.glob(os.path.join(rel_dir, '*.rel.lz'))):
    m = os.path.basename(p).split('.')[0]
    d = unlz(open(p, 'rb').read())
    clips = sorted(set(x.decode() for x in re.findall(rb'player_motion/(pm\d{3}_\d{2})\.branm', d)))
    bare = set(x.decode() for x in re.findall(rb'(?<![\w/])(pm\d{3}_\d{2})(?!\w)', d))
    if len(bare) > 30: shared = bare if shared is None else shared & bare # (the list every module has)
    loaders.append({'id': m, 'name': name_of(m), 'group': group_of(m), 'clips': clips})

dst = os.path.join(os.path.dirname(__file__), '..', 'js15', 'world', 'wpClipLoaders.js')
with open(dst, 'w') as f:
    f.write('// Which of Wii Party\'s Mii clips each board, mode and minigame loads (made by tools/extract_clip_loaders.py:\n')
    f.write('// the clip file paths named in each program module, files/rel/<id>.rel.lz, and the names from files/locale/en_US/mess.bin).\n')
    f.write('// SHARED: the list of clips every module holds (shared code compiled into all of them), kept apart.\n')
    f.write('export const LOADERS = ' + json.dumps(loaders, ensure_ascii=False, separators=(',', ':')).replace('},{', '},\n  {') + ';\n')
    f.write('export const SHARED = ' + json.dumps(sorted(shared or [])) + ';\n')
print(len(loaders), 'modules,', sum(1 for l in loaders if l['clips']), 'naming clips;', len(shared or []), 'shared ->', dst)
