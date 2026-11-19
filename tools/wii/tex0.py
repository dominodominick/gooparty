import numpy as np, struct
from brres import be
BLK={0:(8,8,4),1:(8,4,8),2:(8,4,8),3:(4,4,16),4:(4,4,16),5:(4,4,16),6:(4,4,32),8:(8,8,4),9:(8,4,8),14:(8,8,4)}
def tex0(d,t):
    assert d[t:t+4]==b'TEX0'
    doff=be('i',d,t+0x10)[0]; w,h,fmt=be('HHI',d,t+0x1C)
    p=t+doff; bw,bh,bpp=BLK[fmt]; W=(w+bw-1)//bw*bw; H=(h+bh-1)//bh*bh
    out=np.zeros((H,W,4),np.uint8)
    def c565(x): return ((x>>11)*255//31,((x>>5)&63)*255//63,(x&31)*255//31)
    for by in range(0,H,bh):
        for bx in range(0,W,bw):
            if fmt==14:
                for sy in range(0,8,4):
                    for sx in range(0,8,4):
                        c0,c1=be('HH',d,p); bits=be('I',d,p+4)[0]; p+=8
                        a=np.array(c565(c0)+(255,)); b=np.array(c565(c1)+(255,))
                        if c0>c1: pal=[a,b,(2*a+b)//3,(a+2*b)//3]
                        else: pal=[a,b,(a+b)//2,np.array([0,0,0,0])]
                        for k in range(16):
                            out[by+sy+k//4,bx+sx+k%4]=pal[(bits>>(30-2*k))&3]
            elif fmt==6:
                ar=d[p:p+32]; gb=d[p+32:p+64]; p+=64
                for k in range(16):
                    out[by+k//4,bx+k%4]=(ar[2*k+1],gb[2*k],gb[2*k+1],ar[2*k])
            else:
                for y in range(bh):
                    for x in range(bw):
                        if fmt==0:
                            k=y*bw+x; v=d[p+k//2]; v=(v>>4 if k%2==0 else v&15)*17; out[by+y,bx+x]=(v,v,v,255)
                        elif fmt==1: v=d[p+y*bw+x]; out[by+y,bx+x]=(v,v,v,255)
                        elif fmt==2: v=d[p+y*bw+x]; i=(v&15)*17; out[by+y,bx+x]=(i,i,i,(v>>4)*17)
                        elif fmt==3: a_,i=d[p+2*(y*bw+x)],d[p+2*(y*bw+x)+1]; out[by+y,bx+x]=(i,i,i,a_)
                        elif fmt==4: out[by+y,bx+x]=c565(be('H',d,p+2*(y*bw+x))[0])+(255,)
                        elif fmt==5:
                            v=be('H',d,p+2*(y*bw+x))[0]
                            if v&0x8000: out[by+y,bx+x]=(((v>>10)&31)*255//31,((v>>5)&31)*255//31,(v&31)*255//31,255)
                            else: out[by+y,bx+x]=(((v>>8)&15)*17,((v>>4)&15)*17,(v&15)*17,((v>>12)&7)*255//7)
                        else: raise ValueError(fmt)
                p+=bw*bh*bpp//8
    return out[:h,:w], fmt
