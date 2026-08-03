/**
 * 程序化生成应用图标（纯 Node 标准库，无第三方依赖）
 * 产出：assets/icon.png(256) / icon.ico / tray.png(32) / tray-paused.png(32)
 * 图形：圆角方块底 + 白色小鱼剪影（摸鱼）
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'assets');

/* ---------------------------- PNG 编码 ---------------------------- */
let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c;
  }
  return CRC_TABLE;
}
function crc32(buf) {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------------------- 图形绘制 ---------------------------- */

function roundRectSDF(x, y, w, h, r) {
  const qx = Math.abs(x - w / 2) - (w / 2 - r);
  const qy = Math.abs(y - h / 2) - (h / 2 - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - r;
}

/** 小鱼形状：判断点是否在鱼体内（归一化坐标 0..1） */
function inFish(u, v) {
  // 身体：椭圆，中心略偏左
  const bx = (u - 0.44) / 0.30;
  const by = (v - 0.5) / 0.205;
  const body = bx * bx + by * by <= 1;

  // 尾巴：右侧三角凹口
  let tail = false;
  if (u >= 0.68 && u <= 0.92) {
    const t = (u - 0.68) / 0.24; // 0..1
    const half = 0.06 + t * 0.20; // 外扩
    const inner = t * 0.14; // 内凹
    const dv = Math.abs(v - 0.5);
    tail = dv <= half && dv >= inner * 0.9;
  }
  return body || tail;
}

function fishEye(u, v) {
  const dx = u - 0.32;
  const dy = v - 0.435;
  return dx * dx + dy * dy <= 0.030 * 0.030;
}

function drawIcon(size, opts = {}) {
  const SS = 4; // 超采样倍数（抗锯齿）
  const bg = opts.bg || [15, 123, 108, 255]; // 主题青绿
  const fg = opts.fg || [255, 255, 255, 255];
  const out = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rs = 0;
      let gs = 0;
      let bs = 0;
      let as = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          const u = px / size;
          const v = py / size;

          const d = roundRectSDF(px, py, size, size, size * 0.235);
          if (d > 0) continue; // 圆角外 → 透明

          let c = bg;
          if (inFish(u, v) && !fishEye(u, v)) c = fg;

          const a = c[3] / 255;
          rs += c[0] * a;
          gs += c[1] * a;
          bs += c[2] * a;
          as += c[3];
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      const alpha = as / n; // 0..255
      if (alpha < 0.5) {
        out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
      } else {
        const k = 255 / alpha; // 反预乘
        out[i] = Math.min(255, Math.round((rs / n) * k));
        out[i + 1] = Math.min(255, Math.round((gs / n) * k));
        out[i + 2] = Math.min(255, Math.round((bs / n) * k));
        out[i + 3] = Math.round(alpha);
      }
    }
  }
  return encodePNG(size, size, out);
}

/* ----------------------------- ICO 封装 ----------------------------- */
function buildICO(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const entries = [];
  let offset = 6 + count * 16;
  for (const p of pngs) {
    const e = Buffer.alloc(16);
    e[0] = p.size >= 256 ? 0 : p.size;
    e[1] = p.size >= 256 ? 0 : p.size;
    e[2] = 0;
    e[3] = 0;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(p.data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += p.data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

/* ------------------------------- main ------------------------------- */
function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = sizes.map((s) => ({ size: s, data: drawIcon(s) }));

  fs.writeFileSync(path.join(OUT, 'icon.png'), pngs[pngs.length - 1].data);
  fs.writeFileSync(path.join(OUT, 'icon.ico'), buildICO(pngs));
  fs.writeFileSync(path.join(OUT, 'tray.png'), drawIcon(32));
  fs.writeFileSync(
    path.join(OUT, 'tray-paused.png'),
    drawIcon(32, { bg: [140, 146, 150, 255], fg: [240, 241, 242, 255] })
  );

  for (const f of ['icon.png', 'icon.ico', 'tray.png', 'tray-paused.png']) {
    console.log('  生成', f, Math.round(fs.statSync(path.join(OUT, f)).size / 1024) + 'KB');
  }
}

main();
