import struct
def unlz(d):
    t=d[0]; n=d[1]|d[2]<<8|d[3]<<16; i=4
    if n==0: n=struct.unpack_from('<I',d,4)[0]; i=8
    out=bytearray()
    if t==0x10:
        while len(out)<n:
            f=d[i]; i+=1
            for b in range(8):
                if len(out)>=n: break
                if f&0x80>>b:
                    x=d[i]<<8|d[i+1]; i+=2; ln=(x>>12)+3; off=(x&0xFFF)+1
                    for _ in range(ln): out.append(out[-off])
                else: out.append(d[i]); i+=1
    elif t==0x11:
        while len(out)<n:
            f=d[i]; i+=1
            for b in range(8):
                if len(out)>=n: break
                if f&0x80>>b:
                    a=d[i]; ind=a>>4
                    if ind==0: ln=((a&0xF)<<4|d[i+1]>>4)+0x11; off=((d[i+1]&0xF)<<8|d[i+2])+1; i+=3
                    elif ind==1: ln=((a&0xF)<<12|d[i+1]<<4|d[i+2]>>4)+0x111; off=((d[i+2]&0xF)<<8|d[i+3])+1; i+=4
                    else: ln=ind+1; off=((a&0xF)<<8|d[i+1])+1; i+=2
                    for _ in range(ln): out.append(out[-off])
                else: out.append(d[i]); i+=1
    else: raise ValueError(hex(t))
    return bytes(out[:n])
