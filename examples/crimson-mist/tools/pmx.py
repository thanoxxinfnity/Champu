"""Minimal PMX 2.0 reader (vertices, faces, textures, materials, bones). Pure Python, no Blender.
    from pmx import load; m = load('model.pmx')"""
import struct


class R:
    def __init__(self, data):
        self.d, self.p = data, 0

    def u(self, fmt):
        v = struct.unpack_from('<' + fmt, self.d, self.p)
        self.p += struct.calcsize('<' + fmt)
        return v if len(v) > 1 else v[0]

    def text(self, enc):
        n = self.u('i')
        s = self.d[self.p:self.p + n]
        self.p += n
        return s.decode('utf-16-le' if enc == 0 else 'utf-8', 'replace')

    def idx(self, size, signed=True):
        return self.u({1: 'b', 2: 'h', 4: 'i'}[size] if signed else {1: 'B', 2: 'H', 4: 'i'}[size])


def load(path):
    r = R(open(path, 'rb').read())
    assert r.d[:3] == b'PMX', 'not a PMX file'
    r.p = 4
    ver = r.u('f')
    n = r.u('B')
    g = [r.u('B') for _ in range(n)]
    enc, extra, vs, ts, ms, bs = g[:6]
    m = {'version': ver, 'name': r.text(enc)}
    r.text(enc); r.text(enc); r.text(enc)
    verts = []
    for _ in range(r.u('i')):
        pos = r.u('fff'); nor = r.u('fff'); uv = r.u('ff')
        for _ in range(extra):
            r.u('ffff')
        wt = r.u('B')
        if wt == 0:
            joints, weights = [r.idx(bs)], [1.0]
        elif wt in (1, 3):
            b1, b2 = r.idx(bs), r.idx(bs)
            w = r.u('f')
            joints, weights = [b1, b2], [w, 1 - w]
            if wt == 3:
                r.u('fff'); r.u('fff'); r.u('fff')
        else:
            joints = [r.idx(bs) for _ in range(4)]
            weights = list(r.u('ffff'))
        r.u('f')
        verts.append((pos, nor, uv, joints, weights))
    m['verts'] = verts
    m['faces'] = [r.idx(vs, signed=False) for _ in range(r.u('i'))]
    m['textures'] = [r.text(enc) for _ in range(r.u('i'))]
    mats = []
    for _ in range(r.u('i')):
        mt = {'name': r.text(enc)}
        r.text(enc)
        mt['diffuse'] = r.u('ffff'); r.u('fff'); r.u('f'); r.u('fff')
        mt['flag'] = r.u('B')
        r.u('ffff'); r.u('f')
        mt['tex'] = r.idx(ts); mt['sph'] = r.idx(ts); mt['sph_mode'] = r.u('B')
        shared = r.u('B')
        mt['toon'] = r.u('B') if shared else r.idx(ts)
        mt['toon_shared'] = bool(shared)
        r.text(enc)
        mt['count'] = r.u('i')
        mats.append(mt)
    m['materials'] = mats
    bones = []
    for _ in range(r.u('i')):
        b = {'name': r.text(enc), 'en': r.text(enc), 'pos': r.u('fff'), 'parent': r.idx(bs)}
        r.u('i')
        fl = r.u('H')
        b['flags'] = fl
        b['tail'] = r.idx(bs) if fl & 1 else r.u('fff')
        if fl & 0x300:
            r.idx(bs); r.u('f')
        if fl & 0x400:
            r.u('fff')
        if fl & 0x800:
            r.u('fff'); r.u('fff')
        if fl & 0x2000:
            r.u('i')
        if fl & 0x20:
            r.idx(bs); r.u('i'); r.u('f')
            for _ in range(r.u('i')):
                r.idx(bs)
                if r.u('B'):
                    r.u('fff'); r.u('fff')
        bones.append(b)
    m['bones'] = bones
    return m
