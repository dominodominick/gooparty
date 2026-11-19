import struct, math
import numpy as np
from brres import be, name_at, group
def i32(d,o): return be('i',d,o)[0]
def u32(d,o): return be('I',d,o)[0]
def f32s(d,o,n): return be(f'{n}f',d,o)
SECT=['defs','bones','verts','normals','colors','uvs','furvec','furlay','mats','shaders','objects','texlinks','pltlinks','user']
def mdl0(d,m):
    assert d[m:m+4]==b'MDL0'; ver=u32(d,m+8); assert ver==11,ver
    offs=[i32(d,m+0x10+4*i) for i in range(14)]
    secs={SECT[i]:(group(d,m+o) if o else []) for i,o in enumerate(offs)}
    info=m+0x10+4*14+4
    M={'secs':secs,'ver':ver}
    # bones
    bones=[]
    for nm,b in secs['bones']:
        idx,mtx,flags,bb,bbref=be('5I',d,b+12)
        S=f32s(d,b+0x20,3); R=f32s(d,b+0x2C,3); T=f32s(d,b+0x38,3)
        par,child,nxt,prv,ud=[i32(d,b+0x5C+4*k) for k in range(5)]
        W=np.array(f32s(d,b+0x70,12)).reshape(3,4); IW=np.array(f32s(d,b+0xA0,12)).reshape(3,4)
        bones.append(dict(name=nm,addr=b,index=idx,mtx=mtx,flags=flags,S=S,R=R,T=T,parent_addr=(b+par) if par else None,W=W,IW=IW))
    by_addr={b['addr']:i for i,b in enumerate(bones)}
    for b in bones: b['parent']=by_addr.get(b['parent_addr'],-1)
    M['bones']=bones
    # info: matrix id -> node table
    tbl=info+i32(d,info+0x24) if False else None
    M['info']=info
    # arrays
    def arr(sec,kind):
        out={}
        for nm,a in secs[sec]:
            dataoff=i32(d,a+8); idx=u32(d,a+16)
            if kind=='clr':
                ct,fmt=be('II',d,a+20); stride=d[a+28]; cnt=be('H',d,a+30)[0]
                raw=d[a+dataoff:a+dataoff+stride*cnt]; v=[]
                for k in range(cnt):
                    p=raw[k*stride:(k+1)*stride]
                    if fmt==5: v.append([p[0],p[1],p[2],p[3]])
                    elif fmt==1: v.append([p[0],p[1],p[2],255])
                    elif fmt==2: v.append([p[0],p[1],p[2],255])
                    elif fmt==0: x=p[0]<<8|p[1]; v.append([(x>>11)*255//31,((x>>5)&63)*255//63,(x&31)*255//31,255])
                    elif fmt==3: x=p[0]<<8|p[1]; v.append([((x>>12)&15)*17,((x>>8)&15)*17,((x>>4)&15)*17,(x&15)*17])
                    elif fmt==4: x=p[0]<<16|p[1]<<8|p[2]; v.append([((x>>18)&63)*255//63,((x>>12)&63)*255//63,((x>>6)&63)*255//63,(x&63)*255//63])
                out[idx]=(nm,np.array(v,float)/255); continue
            ct,fmt=be('II',d,a+20); div=d[a+28]; stride=d[a+29]; cnt=be('H',d,a+30)[0]
            nc={'pos':(2,3)[ct] if ct<2 else 3,'nrm':3 if ct==0 else 9,'uv':(1,2)[ct]}[kind]
            ty={0:('B',1),1:('b',1),2:('H',2),3:('h',2),4:('f',4)}[fmt]
            v=np.array([be(f'{nc}{ty[0]}',d,a+dataoff+k*stride) for k in range(cnt)],float)
            if fmt!=4: v/= (1<<div)
            if kind=='nrm' and ct!=0: v=v[:,:3]
            out[idx]=(nm,v)
        return out
    M['pos']=arr('verts','pos'); M['nrm']=arr('normals','nrm'); M['clr']=arr('colors','clr'); M['uv']=arr('uvs','uv')
    # defs bytecode
    defs={}
    for nm,a in secs['defs']:
        p=a; ops=[]
        while True:
            op=d[p]
            if op==1: break
            if op==2: ops.append(('tree',)+be('HH',d,p+1)); p+=5
            elif op==3:
                mid=be('H',d,p+1)[0]; n=d[p+3]; w=[be('Hf',d,p+4+6*k) for k in range(n)]; ops.append(('mix',mid,w)); p+=4+6*n
            elif op==4: ops.append(('draw',)+be('HHHB',d,p+1)); p+=8
            elif op==5: ops.append(('dup',)+be('HH',d,p+1)); p+=5
            elif op==6: ops.append(('op6',)+be('HH',d,p+1)); p+=5
            else: raise ValueError(f'def op {op} in {nm}')
        defs[nm]=ops
    M['defs']=defs
    # materials: name -> addr ; texture links: tex name -> list of material addresses
    M['mats']={nm:a for nm,a in secs['mats']}
    links={}
    for nm,a in secs['texlinks']:
        n=u32(d,a); refs=[(a+i32(d,a+4+8*k), a+i32(d,a+8+8*k)) for k in range(n)]
        links[nm]=refs
    M['texlinks']=links
    # objects
    objs=[]
    for nm,a in secs['objects']:
        node=i32(d,a+8); vlo,vhi,specs=be('III',d,a+12)
        defsz,deffl,defoff=be('IIi',d,a+0x18); dlen1,dlen2,doff=be('IIi',d,a+0x24)
        arrfl,unk,nmoff,idx,nv,nf=be('IIiIII',d,a+0x30)
        ids=be('16h',d,a+0x48)
        tbloff=i32(d,a+0x68)
        objs.append(dict(name=nm,addr=a,node=node,vlo=vlo,vhi=vhi,doff=doff,dlen=dlen1,idx=idx,nv=nv,nf=nf,ids=ids,tbl=a+tbloff,defoff=defoff))
    M['objs']=objs
    return M
