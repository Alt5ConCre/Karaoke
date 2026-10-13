// Generates PWA PNG icons (no dependencies) into public/.
// A vinyl-disc mark on the app's dark background. Run: node scripts/generate-icons.mjs
import { deflateSync, crc32 as zlibCrc32 } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')
mkdirSync(OUT, { recursive: true })

let crcTable
function crc32(buf) {
  if (typeof zlibCrc32 === 'function') return zlibCrc32(buf) >>> 0
  if (!crcTable) {
    crcTable = []
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}

function png(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6 // RGBA
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const BG = [0x0a, 0x0a, 0x14]
const BRAND = [0x86, 0x3b, 0xff]
const LIGHT = [0xed, 0xe6, 0xff]

function drawDisc(size, { maskable }) {
  const SS = 4
  const S = size * SS
  const cx = S / 2
  const cy = S / 2
  const discR = (maskable ? 0.30 : 0.39) * S
  const labelR = discR * 0.46
  const holeR = discR * 0.16
  const acc = new Float64Array(size * size * 4)
  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      const d = Math.hypot(x - cx, y - cy)
      let c = BG
      if (d <= holeR) c = BG
      else if (d <= labelR) c = LIGHT
      else if (d <= discR) c = BRAND
      const px = Math.floor(x / SS)
      const py = Math.floor(y / SS)
      const i = (py * size + px) * 4
      acc[i] += c[0]
      acc[i + 1] += c[1]
      acc[i + 2] += c[2]
      acc[i + 3] += 255
    }
  }
  const out = Buffer.alloc(size * size * 4)
  const n = SS * SS
  for (let i = 0; i < size * size; i += 1) {
    out[i * 4] = Math.round(acc[i * 4] / n)
    out[i * 4 + 1] = Math.round(acc[i * 4 + 1] / n)
    out[i * 4 + 2] = Math.round(acc[i * 4 + 2] / n)
    out[i * 4 + 3] = Math.round(acc[i * 4 + 3] / n)
  }
  return out
}

const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-192.png', 192, true],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon-180.png', 180, false],
]
for (const [name, size, maskable] of targets) {
  writeFileSync(path.join(OUT, name), png(size, drawDisc(size, { maskable })))
  console.log('wrote', name)
}
