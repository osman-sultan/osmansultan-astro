// Turns the generated game art into the files src/lib/runner.ts imports.
//
//   node scripts/slice-game-art.mjs <dir with the ten ChatGPT images>
//
// Expects these files in <dir> (the ChatGPT downloads, renamed by role):
//   day-1-dunes.png night-1-dunes.png day-2-city.png night-2-city.png
//   day-3-rooftops.png night-3-rooftops.png (optional: a tinted day copy
//   stands in while it is missing) sheet-a-day.png sheet-a-night.png
//   sheet-b-day.png sheet-b-night.png props-day.png props-night.png
//   (the prop sheets are optional: jars and crates the prince hops over)
//   prince.png (optional: one image with three rows of frames, run / jump /
//   rewind, packed into the prince.webp atlas described by prince.json) and
//   prince-run.png (optional: a single-row run cycle that replaces the run
//   row of prince.png), sky-day.png / sky-night.png (optional opaque sky
//   backdrops, cropped to the canvas shape) and dagger.png (optional HUD
//   dagger sheet: the empty copy above the sand-filled copy) and frames.png
//   (optional: the light and dark window frames side by side)
// Layers are trimmed of their transparent top and saved as WebP. Sheets are
// cut on their transparent gaps into rooftop pieces; each piece's walkable
// roofline is the first row that spans the piece (merlons and domes above it
// are narrower), and its base colour is the mean of its lowest rows, used to
// continue the wall below the piece. Night pieces are resized to the day
// piece's size so both themes share one geometry (day-buildings.json).
import sharp from "sharp"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const SRC = process.argv[2]
const OUT = join(import.meta.dirname, "..", "src", "assets", "game")
if (!SRC) throw new Error("usage: node scripts/slice-game-art.mjs <dir>")
mkdirSync(OUT, { recursive: true })

const ROLES = [
  "day-1-dunes",
  "night-1-dunes",
  "day-2-city",
  "night-2-city",
  "day-3-rooftops",
  "night-3-rooftops",
  "sheet-a-day",
  "sheet-a-night",
  "sheet-b-day",
  "sheet-b-night",
  "props-day",
  "props-night",
  "prince",
  "prince-run",
  "sky-day",
  "sky-night",
  "dagger",
  "frames",
]
const OPTIONAL = new Set([
  "night-3-rooftops",
  "props-day",
  "props-night",
  "prince",
  "prince-run",
  "sky-day",
  "sky-night",
  "dagger",
  "frames",
])
const FILES = Object.fromEntries(
  ROLES.map((r) => [r, existsSync(join(SRC, `${r}.png`)) ? `${r}.png` : null])
)
for (const r of ROLES)
  if (!FILES[r] && !OPTIONAL.has(r))
    throw new Error(`missing ${r}.png in ${SRC}`)
const WEBP = { quality: 82, alphaQuality: 90, effort: 6 }
const ALPHA = 16 // below this a pixel counts as empty

async function raw(file) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, W: info.width, H: info.height }
}
const alphaAt = (r, x, y) => r.data[(y * r.W + x) * 4 + 3]

// --- layers -------------------------------------------------------------------
async function layer(name, file, tint) {
  const r = await raw(file)
  let top = 0
  outer: for (; top < r.H; top++)
    for (let x = 0; x < r.W; x++) if (alphaAt(r, x, top) > 8) break outer
  // Where the skyline and the solid mass start, as fractions of the trimmed height.
  const rows = []
  for (let y = 0; y < r.H; y++) {
    let n = 0
    for (let x = 0; x < r.W; x++) if (alphaAt(r, x, y) > ALPHA) n++
    rows.push(n / r.W)
  }
  const h = r.H - top
  const skyline = rows.findIndex((f) => f >= 0.05)
  const solid = rows.findIndex((f) => f >= 0.9)
  let img = sharp(file).extract({ left: 0, top, width: r.W, height: h })
  if (tint)
    img = img.modulate({ brightness: 0.55, saturation: 0.55 }).tint(tint)
  await img.webp(WEBP).toFile(join(OUT, `${name}.webp`))
  console.log(
    `${name.padEnd(18)} ${r.W}x${h} (trimmed ${top} px) skyline ${(((skyline - top) / h) * 100).toFixed(0)}% solid ${(((solid - top) / h) * 100).toFixed(0)}%`
  )
}

// --- sheets -------------------------------------------------------------------
function pieces(r) {
  const colFull = new Array(r.W).fill(false)
  for (let x = 0; x < r.W; x++)
    for (let y = 0; y < r.H; y++)
      if (alphaAt(r, x, y) > ALPHA) {
        colFull[x] = true
        break
      }
  const runs = []
  let start = null
  for (let x = 0; x <= r.W; x++) {
    const full = x < r.W && colFull[x]
    if (full && start === null) start = x
    if (!full && start !== null) {
      if (x - start >= 60) runs.push([start, x - 1])
      start = null
    }
  }
  return runs.map(([x0, x1]) => {
    const w = x1 - x0 + 1
    let top = -1,
      bottom = -1,
      roof = -1
    for (let y = 0; y < r.H; y++) {
      let n = 0
      for (let x = x0; x <= x1; x++) if (alphaAt(r, x, y) > ALPHA) n++
      if (n && top < 0) top = y
      if (n) bottom = y
      if (roof < 0 && n >= w * 0.85) roof = y
    }
    // Mean colour of the lowest opaque rows.
    let R = 0,
      G = 0,
      B = 0,
      n = 0
    for (let y = Math.max(top, bottom - 8); y <= bottom; y++)
      for (let x = x0; x <= x1; x++) {
        const i = (y * r.W + x) * 4
        if (r.data[i + 3] > 200) {
          R += r.data[i]
          G += r.data[i + 1]
          B += r.data[i + 2]
          n++
        }
      }
    const hex = (v) =>
      Math.round(v / Math.max(1, n))
        .toString(16)
        .padStart(2, "0")
    // Anything rising well above the roofline (a dome kiosk, not merlons)
    // is an obstacle the player has to vault: its columns are those with
    // more than TALL px of paint above the roofline, and its top the first
    // row at least half as wide as its widest, which skips a thin finial.
    const TALL = 40
    let ox0 = -1
    let ox1 = -1
    const rowN = []
    for (let x = x0; x <= x1; x++) {
      let c = 0
      for (let y = top; y < roof; y++) if (alphaAt(r, x, y) > ALPHA) c++
      if (c > TALL) {
        if (ox0 < 0) ox0 = x
        ox1 = x
      }
    }
    let obstacle = null
    if (ox0 >= 0) {
      for (let y = top; y < roof; y++) {
        let c = 0
        for (let x = ox0; x <= ox1; x++) if (alphaAt(r, x, y) > ALPHA) c++
        rowN.push(c)
      }
      const widest = Math.max(...rowN)
      const bodyTop = top + rowN.findIndex((c) => c >= widest / 2)
      obstacle = { x0: ox0 - x0, x1: ox1 - x0, h: roof - bodyTop }
    }
    return {
      x0,
      top,
      w,
      h: bottom - top + 1,
      roof: roof - top,
      base: `#${hex(R)}${hex(G)}${hex(B)}`,
      obstacle,
    }
  })
}

async function sheets(dayFile, nightFile, firstIndex) {
  const day = pieces(await raw(dayFile))
  const night = pieces(await raw(nightFile))
  if (night.length !== day.length)
    console.warn(`night sheet has ${night.length} pieces, day ${day.length}`)
  const meta = []
  for (let k = 0; k < day.length; k++) {
    const i = firstIndex + k
    const d = day[k]
    await sharp(dayFile)
      .extract({ left: d.x0, top: d.top, width: d.w, height: d.h })
      .webp(WEBP)
      .toFile(join(OUT, `day-b${i}.webp`))
    const n = night[k] ?? d
    await sharp(nightFile)
      .extract({ left: n.x0, top: n.top, width: n.w, height: n.h })
      .resize(d.w, d.h, { fit: "fill" })
      .webp(WEBP)
      .toFile(join(OUT, `night-b${i}.webp`))
    meta.push({
      i,
      w: d.w,
      h: d.h,
      roof: d.roof,
      base: d.base,
      obstacle: d.obstacle,
    })
    const ob = d.obstacle
      ? ` obstacle x ${d.obstacle.x0}-${d.obstacle.x1} h ${d.obstacle.h}`
      : ""
    console.log(
      `b${i}: ${d.w}x${d.h} roof ${d.roof} base ${d.base}${ob}  (night ${n.w}x${n.h})`
    )
  }
  return meta
}

const f = (k) => join(SRC, FILES[k])
await layer("day-1-dunes", f("day-1-dunes"))
await layer("night-1-dunes", f("night-1-dunes"))
await layer("day-2-city", f("day-2-city"))
await layer("night-2-city", f("night-2-city"))
await layer("day-3-rooftops", f("day-3-rooftops"))
if (FILES["night-3-rooftops"])
  await layer("night-3-rooftops", f("night-3-rooftops"))
else
  await layer("night-3-rooftops", f("day-3-rooftops"), {
    r: 70,
    g: 105,
    b: 160,
  })
const meta = [
  ...(await sheets(f("sheet-a-day"), f("sheet-a-night"), 1)),
  ...(await sheets(f("sheet-b-day"), f("sheet-b-night"), 5)),
]
writeFileSync(join(OUT, "day-buildings.json"), JSON.stringify(meta) + "\n")
console.log(`wrote ${meta.length} pieces to day-buildings.json`)

// --- props ----------------------------------------------------------------------
// Jars and crates the prince hops over, cut from the prop sheets like the
// rooftop pieces but trimmed to their paint. The generator drew a soft glow
// around each one; alpha up to HALO is faded out to lose it.
const HALO = 70
function propPieces(r) {
  const solid = (x, y) => alphaAt(r, x, y) > HALO
  const colFull = new Array(r.W).fill(false)
  for (let x = 0; x < r.W; x++)
    for (let y = 0; y < r.H; y++)
      if (solid(x, y)) {
        colFull[x] = true
        break
      }
  const runs = []
  let start = null
  for (let x = 0; x <= r.W; x++) {
    const full = x < r.W && colFull[x]
    if (full && start === null) start = x
    if (!full && start !== null) {
      if (x - start >= 30) runs.push([start, x - 1])
      start = null
    }
  }
  return runs.map(([x0, x1]) => {
    let top = -1
    let bottom = -1
    for (let y = 0; y < r.H; y++) {
      let any = false
      for (let x = x0; x <= x1 && !any; x++) any = solid(x, y)
      if (any && top < 0) top = y
      if (any) bottom = y
    }
    return { x0, top, w: x1 - x0 + 1, h: bottom - top + 1 }
  })
}
async function extractProp(file, p, size) {
  const { data, info } = await sharp(file)
    .extract({ left: p.x0, top: p.top, width: p.w, height: p.h })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i]
    data[i] = a <= HALO ? 0 : Math.round(((a - HALO) / (255 - HALO)) * 255)
  }
  let img = sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
  if (size) img = img.resize(size.w, size.h, { fit: "fill" })
  return img
}
async function propSheets(dayFile, nightFile) {
  const day = propPieces(await raw(dayFile))
  const night = propPieces(await raw(nightFile))
  if (night.length !== day.length)
    console.warn(`night props: ${night.length} pieces, day ${day.length}`)
  const meta = []
  for (let k = 0; k < day.length; k++) {
    const i = k + 1
    const d = day[k]
    const n = night[k] ?? d
    await (
      await extractProp(dayFile, d)
    )
      .webp(WEBP)
      .toFile(join(OUT, `day-p${i}.webp`))
    await (
      await extractProp(nightFile, n, d)
    )
      .webp(WEBP)
      .toFile(join(OUT, `night-p${i}.webp`))
    meta.push({ i, w: d.w, h: d.h })
    console.log(`p${i}: ${d.w}x${d.h} (night ${n.w}x${n.h})`)
  }
  writeFileSync(join(OUT, "props.json"), JSON.stringify(meta) + "\n")
}
if (FILES["props-day"] && FILES["props-night"])
  await propSheets(f("props-day"), f("props-night"))
else console.log("no props-day.png / props-night.png: props skipped")

// --- prince ---------------------------------------------------------------------
// The player sheet: three rows of frames (run x6, jump x3, rewind x3: standing,
// dagger raised, dagger raised with sand), or the same with the run row taken
// from a separate single-row sheet. The generator labelled each row of the
// three-row sheet with text in the strip above it; those strips are erased
// first. Every frame is trimmed to its paint, halo faded like the props, and
// packed row by row into one atlas. `ax` is the frame's anchor from its left
// edge: the middle of the paint for run and jump frames (the body stays put
// while the legs swing), the middle of the feet for the rewind row (so the two
// dagger frames don't jitter against each other). Frames are drawn with their
// bottom on the roofline.
const PRINCE_ROWS = ["run", "jump", "rewind"]
const PRINCE_LABELS = [
  // [x0, x1, y0, y1] regions holding the row labels of the three-row sheet
  [0, 400, 0, 45],
  [0, 334, 330, 366],
  [0, 351, 672, 708],
]
const solidIn = (r) => (x, y) => alphaAt(r, x, y) > HALO
// Row bands: runs of rows with paint, merged across gaps under 12 px.
function bands(r) {
  const solid = solidIn(r)
  const out = []
  let s = null
  for (let y = 0; y <= r.H; y++) {
    let on = false
    if (y < r.H) for (let x = 0; x < r.W && !on; x++) on = solid(x, y)
    if (on && s === null) s = y
    if (!on && s !== null) {
      const last = out[out.length - 1]
      if (last && s - last[1] < 12) last[1] = y - 1
      else out.push([s, y - 1])
      s = null
    }
  }
  return out
}
// The frames in one band, left to right.
function bandFrames(r, file, [y0, y1], row) {
  const solid = solidIn(r)
  const colFull = new Array(r.W).fill(false)
  for (let x = 0; x < r.W; x++)
    for (let y = y0; y <= y1 && !colFull[x]; y++) colFull[x] = solid(x, y)
  const frames = []
  let st = null
  for (let x = 0; x <= r.W; x++) {
    const on = x < r.W && colFull[x]
    if (on && st === null) st = x
    if (!on && st !== null) {
      if (x - st >= 60) {
        const x0 = st
        const x1 = x - 1
        let top = -1
        let bottom = -1
        for (let y = y0; y <= y1; y++) {
          let any = false
          for (let xx = x0; xx <= x1 && !any; xx++) any = solid(xx, y)
          if (any && top < 0) top = y
          if (any) bottom = y
        }
        // Anchor: paint centre, or the feet's centre for the rewind row.
        const from =
          row === "rewind" ? bottom - Math.round((bottom - top) * 0.12) : top
        let sum = 0
        let n = 0
        for (let y = from; y <= bottom; y++)
          for (let xx = x0; xx <= x1; xx++)
            if (solid(xx, y)) {
              sum += xx - x0
              n++
            }
        frames.push({
          file,
          x0,
          top,
          w: x1 - x0 + 1,
          h: bottom - top + 1,
          ax: Math.round(sum / Math.max(1, n)),
        })
      }
      st = null
    }
  }
  return frames
}
async function princeSheet(file, runFile) {
  const r = await raw(file)
  for (const [x0, x1, y0, y1] of PRINCE_LABELS)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) r.data[(y * r.W + x) * 4 + 3] = 0
  const main = bands(r)
  if (main.length !== PRINCE_ROWS.length)
    throw new Error(`prince sheet: expected 3 rows, found ${main.length}`)
  const rows = {}
  PRINCE_ROWS.forEach((row, i) => {
    rows[row] = bandFrames(r, file, main[i], row)
  })
  if (runFile) {
    const rr = await raw(runFile)
    const rb = bands(rr)
    if (rb.length !== 1)
      throw new Error(`prince run sheet: expected 1 row, found ${rb.length}`)
    rows.run = bandFrames(rr, runFile, rb[0], "run")
  }
  // Pack: each row on its own line of the atlas, frames 2 px apart.
  const PAD = 2
  const layers = []
  const meta = { run: [], jump: [], rewind: [] }
  let y = 0
  for (const row of PRINCE_ROWS) {
    let x = 0
    let rowH = 0
    for (const f of rows[row]) {
      const buf = await (
        await extractProp(f.file, f)
      )
        .raw()
        .toBuffer({ resolveWithObject: true })
      layers.push({
        input: buf.data,
        raw: { width: buf.info.width, height: buf.info.height, channels: 4 },
        left: x,
        top: y,
      })
      meta[row].push({ x, y, w: f.w, h: f.h, ax: f.ax })
      x += f.w + PAD
      rowH = Math.max(rowH, f.h)
    }
    y += rowH + PAD
  }
  const width = Math.max(...layers.map((l) => l.left + l.raw.width))
  await sharp({
    create: {
      width,
      height: y,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(layers)
    .webp(WEBP)
    .toFile(join(OUT, "prince.webp"))
  writeFileSync(join(OUT, "prince.json"), JSON.stringify(meta) + "\n")
  for (const row of PRINCE_ROWS)
    console.log(
      `prince ${row}: ${meta[row].map((f) => `${f.w}x${f.h}@${f.ax}`).join(" ")}`
    )
  console.log(`prince atlas ${width}x${y}`)
}
if (FILES["prince"])
  await princeSheet(f("prince"), FILES["prince-run"] ? f("prince-run") : null)
else console.log("no prince.png: prince skipped")

// --- sky ------------------------------------------------------------------------
// Opaque backdrops. The canvas is 400 x 250, so the image is cropped to 1.6:1
// from the top (the sun and moon sit high; the bottom is behind the dunes).
async function sky(name, file) {
  const m = await sharp(file).metadata()
  const height = Math.min(m.height, Math.round(m.width / 1.6))
  await sharp(file)
    .extract({ left: 0, top: 0, width: m.width, height })
    .webp({ quality: 85, effort: 6 })
    .toFile(join(OUT, `${name}.webp`))
  console.log(`${name.padEnd(18)} ${m.width}x${height}`)
}
if (FILES["sky-day"]) await sky("sky-day", f("sky-day"))
if (FILES["sky-night"]) await sky("sky-night", f("sky-night"))

// --- dagger ---------------------------------------------------------------------
// The HUD meter: the sheet stacks an empty dagger over a sand-filled one. Both
// are cut with the empty copy's geometry (the full one is resized to match)
// and the sand span is wherever the two copies differ, so the game can clip
// the full copy to the current sand level between those columns.
async function dagger(file) {
  const r = await raw(file)
  const b = bands(r)
  if (b.length !== 2)
    throw new Error(`dagger sheet: expected 2 rows, found ${b.length}`)
  const [empty] = bandFrames(r, file, b[0], "run")
  const [full] = bandFrames(r, file, b[1], "run")
  const e = await (
    await extractProp(file, empty)
  )
    .raw()
    .toBuffer({ resolveWithObject: true })
  const fl = await (
    await extractProp(file, full, empty)
  )
    .raw()
    .toBuffer({ resolveWithObject: true })
  // Sand: gold in the full copy where the empty copy is grey glass. A
  // column belongs to the sand span when a good part of it has turned gold.
  const gold = (p, j) => p[j] > 170 && p[j + 1] > 110 && p[j + 2] < 130
  const cols = new Array(empty.w).fill(0)
  for (let y = 0; y < empty.h; y++)
    for (let x = 0; x < empty.w; x++) {
      const i = (y * empty.w + x) * 4
      if (e.data[i + 3] < 200 || fl.data[i + 3] < 200) continue
      if (gold(fl.data, i) && !gold(e.data, i)) cols[x]++
    }
  let x0 = cols.findIndex((n) => n >= 20)
  let x1 = cols.length - 1 - [...cols].reverse().findIndex((n) => n >= 20)
  if (x0 < 0) x0 = x1 = 0
  await sharp(e.data, { raw: { width: empty.w, height: empty.h, channels: 4 } })
    .webp(WEBP)
    .toFile(join(OUT, "dagger-empty.webp"))
  await sharp(fl.data, {
    raw: { width: empty.w, height: empty.h, channels: 4 },
  })
    .webp(WEBP)
    .toFile(join(OUT, "dagger-full.webp"))
  const meta = { w: empty.w, h: empty.h, fill: [x0, x1] }
  writeFileSync(join(OUT, "dagger.json"), JSON.stringify(meta) + "\n")
  console.log(`dagger ${empty.w}x${empty.h}, sand spans x ${x0}-${x1}`)
}
if (FILES["dagger"]) await dagger(f("dagger"))

// --- frames ---------------------------------------------------------------------
// The ornate window frame around the canvas, light and dark side by side in
// one image. Each is trimmed to its paint; the component that overlays it
// on the canvas is laid out from the opening measured here.
async function frames(file) {
  const r = await raw(file)
  const [band] = bands(r)
  const found = bandFrames(r, file, band, "run")
  if (found.length !== 2)
    throw new Error(`frames sheet: expected 2 frames, found ${found.length}`)
  for (const [k, name] of [["frame-light"], ["frame-dark"]].map((n, i) => [
    i,
    n[0],
  ])) {
    const f = found[k]
    await sharp(file)
      .extract({ left: f.x0, top: f.top, width: f.w, height: f.h })
      .webp({ quality: 80, alphaQuality: 90, effort: 6 })
      .toFile(join(OUT, `${name}.webp`))
    // Opening: the transparent run across the middle row, and down a column
    // a third of the way in (clear of the arch and the corner capitals).
    const solid = (x, y) => alphaAt(r, x, y) > 40
    const my = f.top + Math.round(f.h / 2)
    const mx = f.x0 + Math.round(f.w / 2)
    let l = mx
    let rr = mx
    while (l > f.x0 && !solid(l - 1, my)) l--
    while (rr < f.x0 + f.w - 1 && !solid(rr + 1, my)) rr++
    const cx = f.x0 + Math.round(f.w * 0.15)
    let t = my
    let b = my
    while (t > f.top && !solid(cx, t - 1)) t--
    while (b < f.top + f.h - 1 && !solid(cx, b + 1)) b++
    let apex = my
    while (apex > f.top && !solid(mx, apex - 1)) apex--
    console.log(
      `${name}: ${f.w}x${f.h}, opening x ${l - f.x0}-${rr - f.x0}, y ${t - f.top}-${b - f.top}, arch apex y ${apex - f.top}`
    )
  }
}
if (FILES["frames"]) await frames(f("frames"))
