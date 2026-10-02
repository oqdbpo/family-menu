// 图片处理常驻工具（纯 Node，零依赖）
//   node tools/img.mjs resize <文件或目录> [--to 宽或高上限] [--out 输出目录]
//   node tools/img.mjs bg <文件或目录> --target F4F1E9   把纸底归一到指定色
//
// 为什么需要它：AI 生成的插画自带约 #F8F3E2 的纸底，和画布色 #F4F1E9 差一点就会
// 看到矩形接缝；右下角还烙着水印。任何新图进 assets 之前都要过一遍。
// PNG 编解码全部手写，所以不依赖 sharp / ImageMagick。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/* ------------------------------ PNG decode ------------------------------ */
function decode(buf) {
  let pos = 8, w = 0, h = 0, bd = 0, ct = 0;
  const ids = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    else if (type === 'IDAT') ids.push(data);
    pos += 12 + len;
  }
  if (bd !== 8) throw new Error('只支持 8bit PNG');
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : ct === 4 ? 2 : 3;
  const raw = zlib.inflateSync(Buffer.concat(ids));
  const stride = w * ch, out = Buffer.alloc(h * stride);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[rp++];
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[y * stride + x - ch] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= ch && y > 0 ? out[(y - 1) * stride + x - ch] : 0;
      let v = raw[rp++];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1; else if (f === 4) v += paeth(a, b, c);
      out[y * stride + x] = v & 255;
    }
  }
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * ch;
    let r, g, b, al = 255;
    if (ch === 1) r = g = b = out[s];
    else if (ch === 2) { r = g = b = out[s]; al = out[s + 1]; }
    else { r = out[s]; g = out[s + 1]; b = out[s + 2]; if (ch === 4) al = out[s + 3]; }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = al;
  }
  return { w, h, data: rgba };
}

/* ------------------------------ PNG encode ------------------------------ */
let T = null;
const tab = () => { if (T) return T; T = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c; } return T; };
const crc32 = b => { const t = tab(); let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encode(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const stride = 1 + w * 4, raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) { raw[y * stride] = 0; rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
                        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/* ------------------------------ box resize ------------------------------ */
function resize(img, w, h, nw, nh) {
  const out = Buffer.alloc(nw * nh * 4);
  const xr = w / nw, yr = h / nh;
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor(y * yr), y1 = Math.max(y0 + 1, Math.min(h, Math.ceil((y + 1) * yr)));
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor(x * xr), x1 = Math.max(x0 + 1, Math.min(w, Math.ceil((x + 1) * xr)));
      let a = 0, b = 0, c = 0, d = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
        const i = (sy * w + sx) * 4; a += img[i]; b += img[i + 1]; c += img[i + 2]; d += img[i + 3]; n++;
      }
      const o = (y * nw + x) * 4;
      out[o] = a / n; out[o + 1] = b / n; out[o + 2] = c / n; out[o + 3] = d / n;
    }
  }
  return out;
}

function borderMedian(img, w, h, t = 3) {
  const idx = [];
  for (let x = 0; x < w; x++) for (let y = 0; y < t; y++) idx.push((y * w + x) * 4);
  for (let x = 0; x < w; x++) for (let y = h - t; y < h; y++) idx.push((y * w + x) * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < t; x++) idx.push((y * w + x) * 4);
  for (let y = 0; y < h; y++) for (let x = w - t; x < w; x++) idx.push((y * w + x) * 4);
  const med = k => { const a = idx.map(i => img[i + k]).sort((p, q) => p - q); return a[a.length >> 1]; };
  return [med(0), med(1), med(2)];
}

const hex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
const files = target => fs.statSync(target).isDirectory()
  ? fs.readdirSync(target).filter(f => /\.(png|jpe?g)$/i.test(f)).map(f => path.join(target, f))
  : [target];

/* ------------------------------ commands ------------------------------ */
const [, , cmd, target, ...rest] = process.argv;
const arg = (n, d) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : d; };

if (!cmd || !target) {
  console.error('用法：node tools/img.mjs resize <文件或目录> [--to 760] [--out 目录]\n          node tools/img.mjs bg <文件或目录> [--target F4F1E9]');
  process.exit(1);
}

for (const f of files(target)) {
  const { w, h, data } = decode(fs.readFileSync(f));
  let out = data, nw = w, nh = h, note = `${w}x${h}`;

  if (cmd === 'resize') {
    const cap = Number(arg('to', 760));
    const s = Math.min(1, cap / Math.max(w, h));
    if (s < 1) { nw = Math.round(w * s); nh = Math.round(h * s); out = resize(data, w, h, nw, nh); }
  }

  const bg = borderMedian(out, nw, nh);
  if (cmd === 'bg') {
    const t = [0, 1, 2].map(i => parseInt(arg('target', 'F4F1E9').slice(i * 2, i * 2 + 2), 16));
    const k = t.map((v, i) => v / bg[i]);
    for (let i = 0; i < out.length; i += 4) for (let c = 0; c < 3; c++) out[i + c] = Math.max(0, Math.min(255, out[i + c] * k[c]));
    note = `底色 ${hex(bg)} → ${hex(t)}`;
  }

  const dir = arg('out', path.dirname(f));
  fs.mkdirSync(dir, { recursive: true });
  const png = encode(nw, nh, out);
  const dest = path.join(dir, path.basename(f));
  fs.writeFileSync(dest, png);
  console.log(`${path.basename(dest).padEnd(24)} ${String(nw + 'x' + nh).padEnd(10)} ${(png.length / 1024).toFixed(0).padStart(5)}KB  ${note}`);
}
