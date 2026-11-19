import struct
be=lambda f,d,o: struct.unpack_from('>'+f,d,o)
def name_at(d,o):
    if o<=0 or o>=len(d): return None
    e=d.index(b'\0',o); return d[o:e].decode('latin1')
def group(d,g):
    """index group at absolute offset g -> list of (name, absolute data offset)"""
    size,n=be('II',d,g); out=[]
    for i in range(1,n+1):
        e=g+8+16*i; idv,u,l,r,no,do=be('HHHHii',d,e)
        out.append((name_at(d,g+no),g+do))
    return out
def brres(d):
    assert d[:4]==b'bres'
    root=be('H',d,0x0C)[0]; assert d[root:root+4]==b'root'
    res={}
    for folder,fo in group(d,root+8):
        res[folder]={n:o for n,o in group(d,fo)}
    return res
