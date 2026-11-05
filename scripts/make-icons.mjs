// 앱 아이콘 PNG를 외부 라이브러리 없이 만든다.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const INK = [31, 27, 24], PAPER = [247, 243, 236], RED = [214, 69, 46];
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b) => { let c = ~0; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
function chunk(type, data) {
  const t = Buffer.from(type), len = Buffer.alloc(4), sum = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  sum.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, sum]);
}
function draw(size, inset) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const pad = size * inset, w = size - pad * 2;
  const inRound = (x, y, x0, y0, x1, y1, r) => {
    const dx = Math.max(x0 + r - x, 0, x - (x1 - r)), dy = Math.max(y0 + r - y, 0, y - (y1 - r));
    return x >= x0 && x <= x1 && y >= y0 && y <= y1 && dx * dx + dy * dy <= r * r;
  };
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let c = INK;
      const u = (x - pad) / w, v = (y - pad) / w;
      if (inRound(u, v, 0.14, 0.18, 0.86, 0.86, 0.08)) {
        c = PAPER;
        if (v < 0.36) c = RED;
        const col = Math.floor((u - 0.22) / 0.16), row = Math.floor((v - 0.44) / 0.13);
        const cu = (u - 0.22) % 0.16, cv = (v - 0.44) % 0.13;
        if (col >= 0 && col < 4 && row >= 0 && row < 3 && cu < 0.09 && cv < 0.075) {
          c = col === 2 && row === 1 ? RED : INK;
        }
      }
      if ((Math.abs(u - 0.33) < 0.025 || Math.abs(u - 0.67) < 0.025) && v > 0.1 && v < 0.26) c = PAPER;
      raw.set(c, y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const dir = new URL('../public/icons/', import.meta.url);
writeFileSync(new URL('icon-192.png', dir), draw(192, 0));
writeFileSync(new URL('icon-512.png', dir), draw(512, 0));
writeFileSync(new URL('maskable-512.png', dir), draw(512, 0.12));
