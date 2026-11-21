import numpy as np
from brres import be
def attrs(vlo,vhi):
    L=[]
    if vlo&1: L.append(('pnm',1))
    for t in range(8):
        if vlo>>(1+t)&1: L.append((f'tm{t}',1))
    for nm,sh in (('pos',9),('nrm',11),('clr0',13),('clr1',15)):
        m=vlo>>sh&3
        if m: L.append((nm,m))
    for t in range(8):
        m=vhi>>(2*t)&3
        if m: L.append((f'uv{t}',m))
    return L
def read_obj(d,o):
    L=attrs(o['vlo'],o['vhi']); p=o['addr']+0x24+o['doff']; end=p+o['dlen']
    tris=[]; verts=[]; slots={}  # position-matrix slots, loaded by the display list (0x20: matrix id -> slot)
    def rv(p):
        v={}
        for nm,m in L:
            if nm in('pnm',) or nm.startswith('tm'): v[nm]=d[p]; p+=1
            elif m==2: v[nm]=d[p]; p+=1
            elif m==3: v[nm]=be('H',d,p)[0]; p+=2
            else: raise ValueError('direct data '+nm)
        return v,p
    while p<end:
        op=d[p]
        if op==0: p+=1; continue
        if op==0x08: p+=6; continue
        if op==0x10: n=be('H',d,p+1)[0]+1; p+=5+4*n; continue
        if op==0x20: mi,addr=be('HH',d,p+1); slots[(addr&0xFFF)//12]=mi; p+=5; continue
        if op in (0x28,0x30,0x38): p+=5; continue
        kind=op&0xF8; n=be('H',d,p+1)[0]; p+=3
        vs=[]
        for _ in range(n):
            v,p=rv(p)
            if 'pnm' in v: v['mid']=slots.get(v['pnm']//3)  # the matrix id this vertex is skinned to
            vs.append(len(verts)); verts.append(v)
        if kind==0x90: tris+= [vs[i:i+3] for i in range(0,n-2,3)]
        elif kind==0x98: tris+= [(vs[i],vs[i+1],vs[i+2]) if i%2==0 else (vs[i+1],vs[i],vs[i+2]) for i in range(n-2)]
        elif kind==0xA0: tris+= [(vs[0],vs[i],vs[i+1]) for i in range(1,n-1)]
        elif kind==0x80: tris+= [t for i in range(0,n,4) for t in ((vs[i],vs[i+1],vs[i+2]),(vs[i],vs[i+2],vs[i+3]))]
        else: raise ValueError(hex(op))
    return verts,tris
