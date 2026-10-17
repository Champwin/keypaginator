# -*- coding: utf-8 -*-
"""用标准库生成插件图标（圆角蓝底 + 白色竖线 + 右箭头），输出 icons/icon48.png / icon96.png"""
import struct, zlib, os, math

BG = (37, 99, 235, 255)     # 蓝底
FG = (255, 255, 255, 255)   # 白色图形
TR = (0, 0, 0, 0)           # 透明


def in_rounded(x, y, w, h, r):
    """判断像素是否落在圆角矩形内"""
    cx = min(x, w - 1 - x)
    cy = min(y, h - 1 - y)
    if cx < r and cy < r:
        return (r - cx) ** 2 + (r - cy) ** 2 <= r * r
    return True


def dist_to_seg(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def draw(size):
    r = size * 0.22                  # 圆角半径
    lw = max(1.6, size * 0.072)      # 线宽半径
    # 竖线（书页边）
    x0, x1 = size * 0.20, size * 0.28
    y0, y1 = size * 0.26, size * 0.74
    # 箭头两段
    a = (size * 0.42, size * 0.28)
    b = (size * 0.70, size * 0.50)
    c = (size * 0.42, size * 0.72)

    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            if not in_rounded(px, py, size, size, r):
                row.append(TR)
                continue
            on = False
            if x0 <= px <= x1 and y0 <= py <= y1:
                on = True
            if dist_to_seg(px, py, *a, *b) <= lw or dist_to_seg(px, py, *b, *c) <= lw:
                on = True
            row.append(FG if on else BG)
        rows.append(row)
    return rows


def write_png(path, rows):
    h = len(rows)
    w = len(rows[0])
    raw = bytearray()
    for row in rows:
        raw.append(0)
        for p in row:
            raw += struct.pack('BBBB', *p)

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data +
                struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

    png = (b'\x89PNG\r\n\x1a\n' +
           chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) +
           chunk(b'IDAT', zlib.compress(bytes(raw), 9)) +
           chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)
    print('wrote', path, w, 'x', h)


if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, 'icons')
    os.makedirs(out, exist_ok=True)
    write_png(os.path.join(out, 'icon48.png'), draw(48))
    write_png(os.path.join(out, 'icon96.png'), draw(96))
