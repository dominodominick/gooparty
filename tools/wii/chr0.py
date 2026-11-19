import numpy as np, math
from brres import be, group
def herm(f0,v0,t0,f1,v1,t1,f):
    span=f1-f0
    if span<=0: return v0
    s=(f-f0)/span; s2=s*s; s3=s2*s
    return v0*(2*s3-3*s2+1)+v1*(-2*s3+3*s2)+(t0*(s3-2*s2+s)+t1*(s3-s2))*span
def read_track(d,base,fmt,frames):
    """returns list of (frame,value,tangent) keys or ('dense',array)"""
    if fmt==1:
        n=be('H',d,base)[0]; sc,step,b0=be('fff',d,base+4); keys=[]
        for k in range(n):
            x=be('I',d,base+16+4*k)[0]; fr=x>>24; val=(x>>12)&0xFFF; tan=x&0xFFF
            if tan&0x800: tan-=0x1000
            keys.append((fr,b0+step*val,tan/32.0))
        return keys
    if fmt==2:
        n=be('H',d,base)[0]; sc,step,b0=be('fff',d,base+4); keys=[]
        for k in range(n):
            fr,val,tan=be('HHh',d,base+16+6*k); keys.append((fr/32.0,b0+step*val,tan/256.0))
        return keys
    if fmt==3:
        n=be('H',d,base)[0]; keys=[be('fff',d,base+8+12*k) for k in range(n)]; return keys
    if fmt in (4,5,6):
        cnt=int(frames)+1
        if fmt==6: return ('dense',np.array(be(f'{cnt}f',d,base)))
        step,b0=be('ff',d,base)
        if fmt==4: raw=be(f'{cnt}B',d,base+8)
        else: raw=be(f'{cnt}H',d,base+8)
        return ('dense',b0+step*np.array(raw,float))
    raise ValueError(fmt)
def sample(tr,f):
    if isinstance(tr,(int,float)): return tr
    if isinstance(tr,tuple) and tr[0]=='dense':
        a=tr[1]; i=int(math.floor(f)); t=f-i; i=max(0,min(i,len(a)-1)); j=min(i+1,len(a)-1); return a[i]*(1-t)+a[j]*t
    keys=tr
    if f<=keys[0][0]: return keys[0][1]
    for k in range(len(keys)-1):
        if keys[k][0]<=f<=keys[k+1][0]: return herm(*keys[k],*keys[k+1],f)
    return keys[-1][1]
def chr0(d,c):
    assert d[c:c+4]==b'CHR0'
    doff=be('i',d,c+0x10)[0]; frames,n=be('HH',d,c+0x20); loop=be('I',d,c+0x24)[0]
    out={}
    for name,e in group(d,c+doff):
        code=be('I',d,e+4)[0]; p=e+8; tr={}
        def take(kind,exist,iso,fixedbits,fmtbits):
            nonlocal p
            if not exist: return
            fmt=fmtbits
            comps=1 if iso else 3
            vals=[]
            for k in range(comps):
                fixed=(code>>fixedbits[k])&1
                if fixed: vals.append(be('f',d,p)[0])
                else: off=be('i',d,p)[0]; vals.append(read_track(d,e+off,fmt,frames))
                p+=4
            if iso: vals=vals*3
            tr[kind]=vals
        take('S',code>>22&1 and not code>>3&1, code>>4&1,(13,14,15),code>>25&3)
        take('R',code>>23&1 and not (code>>2&1), code>>5&1,(16,17,18),code>>27&7)
        take('T',code>>24&1 and not (code>>2&1), code>>6&1,(19,20,21),code>>30&3)
        out[name]=dict(code=code,tracks=tr)
    return dict(frames=frames,loop=loop,bones=out)
