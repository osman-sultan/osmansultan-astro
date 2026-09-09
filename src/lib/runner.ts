/**
 * Sands of Time runner: a small endless rooftop runner drawn on a 2D canvas.
 *
 * The prince runs right across Persian rooftops. Jump over gaps, rooftop
 * clutter and kiosks. Dying freezes time; holding R (or holding the canvas) rewinds the
 * last few seconds, draining the Dagger of Time's sand, which refills slowly
 * while running. Out of sand means the run is over.
 */

import dayDunes from "@/assets/game/day-1-dunes.webp"
import dayCity from "@/assets/game/day-2-city.webp"
import dayRooftops from "@/assets/game/day-3-rooftops.webp"
import nightDunes from "@/assets/game/night-1-dunes.webp"
import nightCity from "@/assets/game/night-2-city.webp"
import nightRooftops from "@/assets/game/night-3-rooftops.webp"
import dayB1 from "@/assets/game/day-b1.webp"
import dayB2 from "@/assets/game/day-b2.webp"
import dayB3 from "@/assets/game/day-b3.webp"
import dayB4 from "@/assets/game/day-b4.webp"
import dayB5 from "@/assets/game/day-b5.webp"
import dayB6 from "@/assets/game/day-b6.webp"
import dayB7 from "@/assets/game/day-b7.webp"
import dayB8 from "@/assets/game/day-b8.webp"
import dayBuildingMeta from "@/assets/game/day-buildings.json"
import nightB1 from "@/assets/game/night-b1.webp"
import nightB2 from "@/assets/game/night-b2.webp"
import nightB3 from "@/assets/game/night-b3.webp"
import nightB4 from "@/assets/game/night-b4.webp"
import nightB5 from "@/assets/game/night-b5.webp"
import nightB6 from "@/assets/game/night-b6.webp"
import nightB7 from "@/assets/game/night-b7.webp"
import nightB8 from "@/assets/game/night-b8.webp"
import dayP1 from "@/assets/game/day-p1.webp"
import dayP2 from "@/assets/game/day-p2.webp"
import dayP3 from "@/assets/game/day-p3.webp"
import dayP4 from "@/assets/game/day-p4.webp"
import dayP5 from "@/assets/game/day-p5.webp"
import propMeta from "@/assets/game/props.json"
import nightP1 from "@/assets/game/night-p1.webp"
import nightP2 from "@/assets/game/night-p2.webp"
import nightP3 from "@/assets/game/night-p3.webp"
import nightP4 from "@/assets/game/night-p4.webp"
import nightP5 from "@/assets/game/night-p5.webp"
import princeAtlas from "@/assets/game/prince.webp"
import princeMeta from "@/assets/game/prince.json"
import skyDay from "@/assets/game/sky-day.webp"
import skyNight from "@/assets/game/sky-night.webp"
import daggerEmpty from "@/assets/game/dagger-empty.webp"
import daggerFull from "@/assets/game/dagger-full.webp"
import daggerMeta from "@/assets/game/dagger.json"

// Logical size. The canvas element scales this to its width, so a
// smaller logical width means everything draws bigger on screen.
const W = 400
const H = 250
const GROUND = H - 40 // y of the base rooftop level (screen px, y down)
const LEVEL_H = 26 // height difference between rooftop levels
const PLAYER_X = 80
const PLAYER_W = 12
const GRAVITY = 1900
const JUMP_V = -540
const JUMP_CUT = -180 // release early: cap upward speed for a shorter hop
const START_SPEED = 150
const MAX_SPEED = 250
const ACCEL = 2 // px/s gained per second: top speed after about 50 s
const JUMP_BUFFER = 0.12 // a press this long before landing still jumps
const COYOTE = 0.09 // a press this long after running off a roof still jumps
const SAND_MAX = 4 // seconds of history the dagger can undo
const HISTORY_SECONDS = SAND_MAX // frames kept: as much as the dagger can undo
const REWIND_RATE = 2.2 // seconds of history undone per real second
const SAND_REFILL = 0.22 // seconds of sand regained per second running
const REWIND_MIN = 0.3 // sand needed to start a rewind
const STREAKS_PER_S = 720 // rewind FX: sand streaks blown across the scene
const GRAINS_PER_S = 430 // rewind FX: grains swirling off the prince
const STORAGE_KEY = "sands-runner-best"
// The rewind is always lit in the Sands of Time gold, whatever the theme.
const REWIND_SAND = "#ffc23d"
const REWIND_EDGE = "rgba(240, 147, 15, 0.45)"
// Draw at most about this often: on a 144 or 240 Hz display the game would
// otherwise render every refresh for no visible gain.
const TARGET_FPS = 60
// Redraw period while nothing moves (idle, dead, out of sand): enough for
// the dagger's sheen and the blinking prompt.
const IDLE_MS = 50
// How far the window frame's top bar reaches into the canvas (see
// sands-runner.astro): the HUD starts below it.
const HUD_TOP = 36

type Part = { idx: number; x: number; w: number } // one building in a platform
type Clutter = { idx: number; x: number } // a prop on a roof, x from its start
type Platform = {
  x: number
  w: number
  level: number
  props: Clutter[]
  parts: Part[]
}
type Frame = {
  t: number // run time this frame was recorded at
  worldX: number
  y: number
  vy: number
  speed: number
  dist: number
  gait: number
}
type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  len?: number // streak length (sand blowing past during a rewind)
  float?: boolean // no gravity
}
type Ghost = { worldX: number; y: number; gait: number; life: number }
type State = "idle" | "running" | "dead" | "rewinding" | "over"

type Tint = [top: string, bottom: string]
type Palette = {
  roof: string
  roofEdge: string
  sky: Tint // canvas backdrop, top to horizon
  outline: string
  textHalo: string // outline behind labels: opposite of the text colour
  sand: string
  text: string
  muted: string
  tint: string
}

const PALETTES: Record<"dark" | "light", Palette> = {
  dark: {
    roof: "oklch(0.2 0.04 240)",
    roofEdge: "oklch(0.86 0.1 205)",
    sky: ["oklch(0.12 0.03 265)", "oklch(0.32 0.1 222)"],
    outline: "rgba(8, 16, 28, 0.9)",
    textHalo: "rgba(8, 16, 28, 0.85)",
    sand: "#ffc23d",
    text: "oklch(0.96 0.008 240)",
    muted: "oklch(0.7 0.02 235)",
    tint: "rgba(240, 147, 15, 0.14)",
  },
  light: {
    roof: "oklch(0.44 0.1 205)",
    roofEdge: "oklch(0.92 0.09 92)",
    sky: ["oklch(0.9 0.06 95)", "oklch(0.82 0.13 62)"],
    outline: "rgba(40, 20, 8, 0.9)",
    textHalo: "rgba(255, 246, 228, 0.92)",
    sand: "#b34d05",
    text: "oklch(0.2 0.03 60)",
    muted: "oklch(0.32 0.05 55)",
    tint: "rgba(240, 147, 15, 0.14)",
  },
}

// The prince (src/assets/game/prince.webp, packed by scripts/slice-game-art.mjs
// from the generated sheet): six run frames, three jump frames (take-off,
// apex, fall) and three rewind frames (standing, dagger raised, dagger
// raised with sand). Each frame is drawn with its bottom on the roofline and
// its anchor `ax` on the player's x. The run row was drawn bigger than the
// other two, so those get a larger scale to match its head size.
const PRINCE_SCALE = { run: 0.12, jump: 0.145, rewind: 0.145 } as const
type PrinceRow = keyof typeof PRINCE_SCALE
type PrinceFrame = { x: number; y: number; w: number; h: number; ax: number }
const PRINCE: Record<PrinceRow, PrinceFrame[]> = princeMeta
// Run frames in cycle order.
const RUN_CYCLE = [0, 1, 2, 3, 4, 5]

// Painted parallax layers (src/assets/game), one image per theme, with the
// distance haze painted in. Each scrolls at a fraction of the ground speed:
// the smaller the fraction, the further away it reads. `width` is the drawn
// tile width in logical px (height follows the image's aspect) and `bottom`
// where its lower edge sits; the near layer's bottom is past the canvas so
// its solid base fills the drop between two platforms.
type LayerSpec = {
  day: ImageMetadata
  night: ImageMetadata
  width: number
  bottom: number
  parallax: number
}
const LAYERS: LayerSpec[] = [
  { day: dayDunes, night: nightDunes, width: 560, bottom: 210, parallax: 0.05 },
  { day: dayCity, night: nightCity, width: 400, bottom: 229, parallax: 0.12 },
  {
    day: dayRooftops,
    night: nightRooftops,
    width: 320,
    bottom: 261,
    parallax: 0.28,
  },
]

// The rooftop pieces the prince runs on (src/assets/game/day-b*.webp, cut
// from the generated sheets by scripts/slice-game-art.mjs). Each platform is
// a row of them chosen at random. `roof` is how far the runnable roofline
// sits below the piece's top edge (merlons and domes poke above it),
// `base` the colour that continues the facade below the piece's bottom,
// and `obstacle` a kiosk on the roof the prince has to vault: its span
// along the piece and its height above the roofline. Night pieces share the
// day geometry.
const BUILDING_SCALE = 0.2 // source px -> logical px
const OBSTACLE_RUN_UP = 100 // roof needed in front of a kiosk, logical px
type Obstacle = { x0: number; x1: number; h: number }
type Building = {
  day: ImageMetadata
  night: ImageMetadata
  w: number
  h: number
  roof: number
  base: string
  obstacle: Obstacle | null
}
const DAY_BUILDINGS = [dayB1, dayB2, dayB3, dayB4, dayB5, dayB6, dayB7, dayB8]
const NIGHT_BUILDINGS = [
  nightB1,
  nightB2,
  nightB3,
  nightB4,
  nightB5,
  nightB6,
  nightB7,
  nightB8,
]
const BUILDINGS: Building[] = dayBuildingMeta.map((m, i) => ({
  day: DAY_BUILDINGS[i]!,
  night: NIGHT_BUILDINGS[i]!,
  w: Math.round(m.w * BUILDING_SCALE),
  h: Math.round(m.h * BUILDING_SCALE),
  roof: Math.round(m.roof * BUILDING_SCALE),
  base: m.base,
  // The hitbox is a little narrower than the paint, so a near miss is a miss.
  obstacle: m.obstacle
    ? {
        x0: Math.round(m.obstacle.x0 * BUILDING_SCALE) + 3,
        x1: Math.round(m.obstacle.x1 * BUILDING_SCALE) - 3,
        h: Math.round(m.obstacle.h * BUILDING_SCALE),
      }
    : null,
}))

// Rooftop clutter the prince hops over (src/assets/game/day-p*.webp): the
// runner's cacti. A roof gets a cluster of one to three, standing on the
// roofline. The sheet was drawn much larger than the rooftops, hence the
// separate scale.
const PROP_SCALE = 0.075 // source px -> logical px
type Prop = { day: ImageMetadata; night: ImageMetadata; w: number; h: number }
const DAY_PROPS = [dayP1, dayP2, dayP3, dayP4, dayP5]
const NIGHT_PROPS = [nightP1, nightP2, nightP3, nightP4, nightP5]
const PROPS: Prop[] = propMeta.map((m, i) => ({
  day: DAY_PROPS[i]!,
  night: NIGHT_PROPS[i]!,
  w: Math.round(m.w * PROP_SCALE),
  h: Math.round(m.h * PROP_SCALE),
}))

function loadImage(meta: ImageMetadata) {
  const img = new Image()
  img.decoding = "async"
  img.src = meta.src
  return img
}

// The HUD dagger (src/assets/game/dagger-*.webp): drawn this wide, with the
// sand level running between the two columns of `fill`.
const DAGGER_W = 96
const DAGGER: { w: number; h: number; fill: number[] } = daggerMeta

export function initSandsRunner(canvas: HTMLCanvasElement) {
  if (canvas.dataset.runnerInit) return () => {}
  canvas.dataset.runnerInit = "1"
  const ctx = canvas.getContext("2d")
  if (!ctx) return () => {}

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches
  const hoverCapable = matchMedia("(hover: hover) and (pointer: fine)").matches
  const fontMono =
    getComputedStyle(canvas).fontFamily || "ui-monospace, monospace"

  let palette = PALETTES.dark
  function applyTheme() {
    palette = document.documentElement.classList.contains("dark")
      ? PALETTES.dark
      : PALETTES.light
  }
  applyTheme()
  // Art is fetched for the theme on screen, on first use; the other theme's
  // set follows once the page has settled, so a toggle never blanks the
  // scenery for long.
  const images = new Map<string, HTMLImageElement>()
  function imageOf(meta: ImageMetadata) {
    let img = images.get(meta.src)
    if (!img) {
      img = loadImage(meta)
      images.set(meta.src, img)
    }
    return img
  }
  const prefetch = window.setTimeout(() => {
    const night = palette === PALETTES.dark
    for (const l of LAYERS) imageOf(night ? l.day : l.night)
    for (const b of BUILDINGS) imageOf(night ? b.day : b.night)
    for (const p of PROPS) imageOf(night ? p.day : p.night)
    imageOf(night ? skyDay : skyNight)
  }, 4000)
  let devScale = 1 // device px per logical px, set in resize()
  // Snap a logical coordinate to a device pixel, so a bitmap copies 1:1.
  const snap = (v: number) => Math.round(v * devScale) / devScale

  // Bitmaps pre-scaled to their on-screen pixel size, so each frame is a
  // plain 1:1 copy instead of resampling a 2000 px wide image. Dropped
  // whenever the device scale or the theme changes; an image that has not
  // loaded yet is tried again next frame.
  type TileSet = {
    scale: number
    sky: (HTMLCanvasElement | null)[]
    layers: (HTMLCanvasElement | null)[]
    buildings: (HTMLCanvasElement | null)[]
    props: (HTMLCanvasElement | null)[]
    hud: (HTMLCanvasElement | null)[]
  }
  const emptyTiles = (scale = 0): TileSet => ({
    scale,
    sky: [],
    layers: [],
    buildings: [],
    props: [],
    hud: [],
  })
  // One set per theme, so a toggle swaps sets instead of rebuilding one.
  const tiles = { day: emptyTiles(), night: emptyTiles() }
  function tileSet() {
    const key = palette === PALETTES.dark ? "night" : "day"
    if (tiles[key].scale !== devScale) tiles[key] = emptyTiles(devScale)
    return tiles[key]
  }
  function tileOf(
    slot: (HTMLCanvasElement | null)[],
    i: number,
    img: HTMLImageElement,
    w: number
  ) {
    const cached = slot[i]
    if (cached) return cached
    if (!img.complete || !img.naturalWidth) return null
    const h = (img.naturalHeight / img.naturalWidth) * w
    const t = document.createElement("canvas")
    t.width = Math.max(1, Math.round(w * devScale))
    t.height = Math.max(1, Math.round(h * devScale))
    t.getContext("2d")!.drawImage(img, 0, 0, t.width, t.height)
    slot[i] = t
    return t
  }

  // Prince frames cut from the atlas and pre-scaled to the device scale,
  // keyed by frame and, for the rewind afterimages, by the flat colour they
  // are filled with. Null until the atlas has loaded.
  type Sprite = { bitmap: HTMLCanvasElement; w: number; h: number; ax: number }
  const sprites = new Map<string, Sprite>()
  function princeSprite(row: PrinceRow, index: number, mono?: string) {
    const key = `${row}:${index}|${mono ?? ""}|${devScale}`
    let s = sprites.get(key)
    if (s) return s
    const atlas = imageOf(princeAtlas)
    if (!atlas.complete || !atlas.naturalWidth) return null
    const f = PRINCE[row][index]!
    const k = PRINCE_SCALE[row]
    const bitmap = document.createElement("canvas")
    bitmap.width = Math.max(1, Math.round(f.w * k * devScale))
    bitmap.height = Math.max(1, Math.round(f.h * k * devScale))
    const c = bitmap.getContext("2d")!
    c.drawImage(atlas, f.x, f.y, f.w, f.h, 0, 0, bitmap.width, bitmap.height)
    if (mono) {
      // A flat silhouette in one colour, keeping the frame's alpha.
      c.globalCompositeOperation = "source-in"
      c.fillStyle = mono
      c.fillRect(0, 0, bitmap.width, bitmap.height)
    }
    if (sprites.size > 48) sprites.clear()
    s = {
      bitmap,
      w: bitmap.width / devScale,
      h: bitmap.height / devScale,
      ax: f.ax * k,
    }
    sprites.set(key, s)
    return s
  }

  // HUD labels, cached as bitmaps: each is outlined (strokeText with a round
  // join is among the dearer canvas calls) and the HUD shows five a frame.
  type Label = {
    bitmap: HTMLCanvasElement
    w: number
    h: number
    textW: number
  }
  const LABEL_PAD = 3
  const LABEL_CACHE = 32
  const labels = new Map<string, Label>()
  function labelOf(str: string, font: string, fill: string, halo: string) {
    const key = `${str}|${font}|${fill}|${halo}|${devScale}`
    let l = labels.get(key)
    if (l) {
      // Most recently used moves to the back, so eviction below takes the
      // stale distance readouts before the labels drawn every frame.
      labels.delete(key)
      labels.set(key, l)
      return l
    }
    const c0 = ctx!
    c0.font = font
    const textW = c0.measureText(str).width
    const size = parseFloat(font)
    const bitmap = document.createElement("canvas")
    bitmap.width = Math.max(1, Math.ceil((textW + LABEL_PAD * 2) * devScale))
    bitmap.height = Math.max(
      1,
      Math.ceil((size * 1.4 + LABEL_PAD * 2) * devScale)
    )
    const c = bitmap.getContext("2d")!
    c.setTransform(devScale, 0, 0, devScale, 0, 0)
    c.font = font
    c.textBaseline = "top"
    c.textAlign = "left"
    c.lineJoin = "round"
    c.lineWidth = 3
    c.strokeStyle = halo
    c.strokeText(str, LABEL_PAD, LABEL_PAD)
    c.fillStyle = fill
    c.fillText(str, LABEL_PAD, LABEL_PAD)
    if (labels.size >= LABEL_CACHE) {
      const oldest = labels.keys().next().value
      if (oldest !== undefined) labels.delete(oldest)
    }
    l = {
      bitmap,
      w: bitmap.width / devScale,
      h: bitmap.height / devScale,
      textW,
    }
    labels.set(key, l)
    return l
  }
  // Drop cached labels once web fonts arrive, so none keeps a fallback face.
  const onFonts = () => labels.clear()
  document.fonts?.addEventListener("loadingdone", onFonts)

  // The next idle tick (within IDLE_MS) picks the new palette up.
  const themeObserver = new MutationObserver(applyTheme)
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  })

  // --- World -----------------------------------------------------------------

  let state: State = "idle"
  let worldX = 0 // how far the world has scrolled (px)
  let speed = START_SPEED
  let dist = 0 // metres
  let best = 0
  try {
    best = Number(localStorage.getItem(STORAGE_KEY)) || 0
  } catch {
    /* storage unavailable */
  }
  let y = GROUND // player's feet (screen y)
  let vy = 0
  let onGround = true
  let gait = 0 // run cycle phase
  let jumpHeld = false
  let jumpQueued = 0 // seconds left on a jump pressed while still in the air
  let coyote = 0 // seconds left to jump after running off a roof
  let sand = SAND_MAX
  let history: Frame[] = []
  let runTime = 0
  let particles: Particle[] = []
  let ghosts: Ghost[] = []
  let lastGhostT = 0
  let rewindTime = 0 // seconds spent in the current rewind (drives the FX)
  let emitStreaks = 0 // fractional particles owed by the rewind emitters
  let emitGrains = 0
  let platforms: Platform[] = []
  let genX = 0 // world x where the next platform starts
  let rewindHeld = false
  let rewindSpent = false // R held on past an empty dagger: wait for a release
  let blink = 0
  let lastLevel = 0
  let seed = 1

  function rnd() {
    // Small deterministic PRNG so a run is reproducible for the history.
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }

  function reset() {
    worldX = 0
    speed = START_SPEED
    dist = 0
    y = GROUND
    vy = 0
    onGround = true
    jumpQueued = coyote = 0
    gait = 0
    sand = SAND_MAX
    history = []
    runTime = 0
    particles = []
    ghosts = []
    platforms = []
    lastLevel = 0
    seed = Date.now() & 0xffff || 1
    // A long, safe starting roof.
    const start = buildRow(420, false)
    platforms.push({
      x: -40,
      w: start.w,
      level: 0,
      props: [],
      parts: start.parts,
    })
    genX = -40 + start.w
    while (genX < worldX + W + 200) addPlatform()
  }

  function addPlatform() {
    // The jump covers about speed * 0.55 s; keep gaps well inside that.
    const jumpReach = speed * 0.55
    const gap = 36 + rnd() * Math.max(0, jumpReach * 0.55 - 36)
    let level = lastLevel
    const r = rnd()
    if (r < 0.28) level = Math.min(1, level + 1)
    else if (r < 0.5) level = Math.max(0, level - 1)
    const row = buildRow(150 + rnd() * 220)
    const w = row.w
    const props: Clutter[] = []
    // One hazard per roof: a kiosk or a clutter of props, never both.
    // Clutter turns up more often as the run goes on.
    const chance = Math.min(0.6, 0.25 + dist / 400)
    if (!row.obstacle && w > 200 && rnd() < chance) {
      // One to three props side by side, never right at the landing edge.
      const picks: number[] = []
      let cw = 0
      for (let i = 0, n = 1 + Math.floor(rnd() * 3); i < n; i++) {
        const idx = Math.floor(rnd() * PROPS.length)
        picks.push(idx)
        cw += PROPS[idx]!.w + (i ? 2 : 0)
      }
      let x = 80 + rnd() * (w - 80 - cw - 40)
      for (const idx of picks) {
        props.push({ idx, x })
        x += PROPS[idx]!.w + 2
      }
    }
    platforms.push({ x: genX + gap, w, level, props, parts: row.parts })
    genX += gap + w
    lastLevel = level
  }

  // A row of pieces at least `target` wide, no piece twice in a row. A
  // kiosk needs a run-up, so a piece carrying one never opens a row, a row
  // holds at most one, and the starting roof has none.
  let lastBuilding = -1
  function buildRow(target: number, allowObstacle = true) {
    const parts: Part[] = []
    let w = 0
    let obstacle = false
    while (w < target) {
      let idx = Math.floor(rnd() * BUILDINGS.length)
      for (let tries = 0; tries < BUILDINGS.length; tries++) {
        const kiosk = BUILDINGS[idx]!.obstacle !== null
        const fits =
          !kiosk || (allowObstacle && !obstacle && w >= OBSTACLE_RUN_UP)
        if (idx !== lastBuilding && fits) break
        idx = (idx + 1) % BUILDINGS.length
      }
      lastBuilding = idx
      const b = BUILDINGS[idx]!
      if (b.obstacle) obstacle = true
      // Overlap neighbours by a pixel: scaled sprites otherwise leave a
      // hairline seam between them.
      const x = parts.length ? w - 3 : 0
      parts.push({ idx, x, w: b.w })
      w = x + b.w
    }
    return { parts, w, obstacle }
  }

  function levelY(level: number) {
    return GROUND - level * LEVEL_H
  }

  function platformAt(px: number, margin = 0) {
    for (const p of platforms) {
      if (px + margin >= p.x && px - margin <= p.x + p.w) return p
    }
    return null
  }

  function die() {
    state = "dead"
    blink = 0
    burst(PLAYER_X, y - 8, 14, 1)
  }

  // Time runs backwards from here until R is let go, the dagger is empty or
  // the history is spent.
  function startRewind() {
    state = "rewinding"
    rewindTime = 0
    emitStreaks = emitGrains = 0
    lastGhostT = runTime
  }

  function burst(x: number, py: number, n: number, spread: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.PI + (rnd() - 0.5) * Math.PI * spread
      const s = 40 + rnd() * 120
      particles.push({
        x,
        y: py,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 40,
        life: 0,
        max: 0.4 + rnd() * 0.5,
        size: 1 + rnd() * 2,
      })
    }
  }

  // --- Simulation -----------------------------------------------------------

  function step(dt: number) {
    // Holding R mid-run rewinds too, not only after a fall.
    if (
      state === "running" &&
      rewindHeld &&
      !rewindSpent &&
      sand >= REWIND_MIN &&
      history.length
    ) {
      startRewind()
    }
    if (state === "running") {
      speed = Math.min(MAX_SPEED, speed + dt * ACCEL)
      worldX += speed * dt
      dist += (speed * dt) / 22
      sand = Math.min(SAND_MAX, sand + SAND_REFILL * dt)

      vy += GRAVITY * dt
      if (!jumpHeld && vy < JUMP_CUT) vy = JUMP_CUT
      y += vy * dt

      // Land on whichever roof is under the feet, only when coming down.
      const wx = worldX + PLAYER_X
      const p = platformAt(wx, PLAYER_W / 2 - 2)
      onGround = false
      if (p) {
        const top = levelY(p.level)
        if (vy >= 0 && y >= top && y - vy * dt <= top + 6) {
          y = top
          vy = 0
          onGround = true
          // A press made just before landing fires now.
          if (jumpQueued > 0) doJump()
        }
        // Running into the face of a higher roof.
        if (
          y > top + 4 &&
          wx + PLAYER_W / 2 > p.x &&
          wx - PLAYER_W / 2 < p.x + 8
        ) {
          die()
        }
        // Clutter: hop it or run into it. The hitbox is a little smaller
        // than the paint, so a near miss is a miss.
        for (const pr of p.props) {
          const prop = PROPS[pr.idx]!
          const ax = p.x + pr.x
          if (
            wx + PLAYER_W / 2 - 3 > ax + 2 &&
            wx - PLAYER_W / 2 + 3 < ax + prop.w - 2 &&
            y > top - prop.h + 3
          ) {
            die()
            break
          }
        }
        // Rooftop kiosks: vault them or run into them.
        for (const part of p.parts) {
          const o = BUILDINGS[part.idx]!.obstacle
          if (!o) continue
          const ox = p.x + part.x
          if (
            wx + PLAYER_W / 2 - 3 > ox + o.x0 &&
            wx - PLAYER_W / 2 + 3 < ox + o.x1 &&
            y > top - o.h
          ) {
            die()
            break
          }
        }
      }
      // Grace after running off a roof, and the buffered press timing out.
      coyote = onGround ? COYOTE : Math.max(0, coyote - dt)
      jumpQueued = Math.max(0, jumpQueued - dt)
      if (onGround) gait += dt * speed * 0.055
      if (y > H + 30) die()

      // Keep the road ahead paved; drop only what is too far back to
      // rewind to (4 s at top speed is about 1300 px).
      while (genX < worldX + W + 200) addPlatform()
      if (
        platforms.length &&
        platforms[0]!.x + platforms[0]!.w < worldX - 1800
      ) {
        platforms.shift()
      }

      runTime += dt
      history.push({ t: runTime, worldX, y, vy, speed, dist, gait })
      while (history.length && history[0]!.t < runTime - HISTORY_SECONDS) {
        history.shift()
      }
    } else if (state === "rewinding") {
      // Undo history at REWIND_RATE x real time, whatever the frame rate.
      const target = runTime - REWIND_RATE * dt
      let f: Frame | undefined
      while (history.length && history[history.length - 1]!.t > target) {
        f = history.pop()
        // Leave an afterimage every few hundredths of a second of undone time.
        if (f && lastGhostT - f.t > 0.06) {
          ghosts.push({ worldX: f.worldX, y: f.y, gait: f.gait, life: 0 })
          lastGhostT = f.t
        }
      }
      rewindTime += dt
      if (f) {
        runTime = f.t
        worldX = f.worldX
        y = f.y
        vy = f.vy
        speed = f.speed
        dist = f.dist
        gait = f.gait
      }
      // The dagger holds seconds of history, so it drains as fast as the
      // history is undone and runs dry exactly when the history does.
      sand = Math.max(0, sand - REWIND_RATE * dt)
      // Sand pours back into the hourglass: streaks race right to left
      // across the whole scene, plus grains swirling off the prince. Both
      // are emitted per second of real time, so the storm is as thick at
      // 60 fps as at 144.
      emitStreaks += STREAKS_PER_S * dt
      for (; emitStreaks >= 1; emitStreaks--) {
        particles.push({
          x: W + 10,
          y: rnd() * H,
          vx: -(500 + rnd() * 500),
          vy: (rnd() - 0.5) * 40,
          life: 0,
          max: 0.6 + rnd() * 0.5,
          size: 0.8 + rnd() * 1.2,
          len: 10 + rnd() * 26,
          float: true,
        })
      }
      emitGrains += GRAINS_PER_S * dt
      for (let i = 0; emitGrains >= 1; emitGrains--, i++) {
        const a = rewindTime * 9 + i * 2.1 + rnd() * 0.6
        const r = 10 + rnd() * 14
        particles.push({
          x: PLAYER_X + Math.cos(a) * r,
          y: y - 13 + Math.sin(a) * r * 0.6,
          vx: 40 + rnd() * 120,
          vy: (rnd() - 0.5) * 60,
          life: 0,
          max: 0.3 + rnd() * 0.3,
          size: 1 + rnd() * 1.5,
          float: true,
        })
      }
      if (!rewindHeld || !history.length || sand <= 0) {
        // Resume from the rewound moment, whatever is left in the dagger;
        // an empty dagger only ends the run at the next death.
        if (rewindHeld) rewindSpent = true // no restart until R is let go
        state = "running"
        onGround = false
        particles = particles.filter((p) => !p.len)
      }
    } else if (state === "dead") {
      blink += dt
      if (rewindHeld && !rewindSpent && sand >= REWIND_MIN && history.length)
        startRewind()
      else if (sand < REWIND_MIN || !history.length) state = "over"
    }

    // Age particles and ghosts, compacting the spent ones out in place.
    let kept = 0
    for (const p of particles) {
      p.life += dt
      if (p.life >= p.max) continue
      p.x += p.vx * dt
      p.y += p.vy * dt
      if (!p.float) p.vy += 300 * dt
      particles[kept++] = p
    }
    particles.length = kept
    kept = 0
    for (const g of ghosts) {
      g.life += dt
      if (g.life < 0.7) ghosts[kept++] = g
    }
    ghosts.length = kept
  }

  // --- Drawing ----------------------------------------------------------------

  // Outlined text: every label sits over busy artwork. Drawn from the label
  // cache with its top-left, top-right or top-centre at (x, y).
  const FONT_HUD = `12px ${fontMono}`
  const FONT_SMALL = `10px ${fontMono}`
  function text(
    str: string,
    x: number,
    y: number,
    align: "left" | "right" | "center",
    font: string,
    fill: string
  ) {
    const l = labelOf(str, font, fill, palette.textHalo)
    const left =
      align === "left" ? x : align === "right" ? x - l.textW : x - l.textW / 2
    ctx!.drawImage(
      l.bitmap,
      snap(left - LABEL_PAD),
      snap(y - LABEL_PAD),
      l.w,
      l.h
    )
  }

  // Gradients that never change, made once.
  const skyGradients = new Map<Palette, CanvasGradient>()
  let vignette: CanvasGradient | null = null

  function draw() {
    const c = ctx!
    if (!canvas.width) return // no layout box (hidden): nothing to draw into
    const pal = palette
    const set = tileSet()
    const night = pal === PALETTES.dark

    // Sky backdrop: a painted image cut to the canvas shape (sun or moon
    // and stars included); a plain gradient stands in until it has loaded.
    const skyTile = tileOf(set.sky, 0, imageOf(night ? skyNight : skyDay), W)
    if (skyTile) c.drawImage(skyTile, 0, 0, W, H)
    else {
      let sky = skyGradients.get(pal)
      if (!sky) {
        sky = c.createLinearGradient(0, 0, 0, GROUND)
        sky.addColorStop(0, pal.sky[0])
        sky.addColorStop(1, pal.sky[1])
        skyGradients.set(pal, sky)
      }
      c.fillStyle = sky
      c.fillRect(0, 0, W, H)
    }

    // Painted city behind the rooftops, far to near.
    LAYERS.forEach((l, i) => {
      const tile = tileOf(
        set.layers,
        i,
        imageOf(night ? l.night : l.day),
        l.width
      )
      if (tile) drawTiled(c, tile, l.width, l.bottom, l.parallax, 1)
    })

    // Rooftops.
    for (const p of platforms) {
      const sx = p.x - worldX
      if (sx > W + 10 || sx + p.w < -10) continue
      const top = levelY(p.level)
      for (const part of p.parts) {
        const b = BUILDINGS[part.idx]!
        const img = imageOf(night ? b.night : b.day)
        const tile = tileOf(set.buildings, part.idx, img, b.w)
        if (tile) {
          const x = Math.round(sx + part.x)
          c.drawImage(tile, x, top - b.roof, b.w, b.h)
          // The piece is only the top of a building: continue its wall to
          // the bottom of the canvas.
          const end = top - b.roof + b.h
          if (end < H) {
            c.fillStyle = b.base
            c.fillRect(x, end - 1, b.w, H - end + 1)
          }
        } else {
          c.fillStyle = pal.roof
          c.fillRect(sx + part.x, top, b.w, H - top)
          c.fillStyle = pal.roofEdge
          c.fillRect(sx + part.x, top, b.w, 2)
        }
      }
      // Clutter, standing on the roofline.
      for (const pr of p.props) {
        const prop = PROPS[pr.idx]!
        const img = imageOf(night ? prop.night : prop.day)
        const tile = tileOf(set.props, pr.idx, img, prop.w)
        const x = Math.round(sx + pr.x)
        if (tile) c.drawImage(tile, x, top - prop.h, prop.w, prop.h)
        else {
          c.fillStyle = pal.outline
          c.fillRect(x, top - prop.h, prop.w, prop.h)
        }
      }
    }

    // Afterimages of the prince along the path being undone.
    for (const g of ghosts) {
      const gx = PLAYER_X + (g.worldX - worldX)
      if (gx < -20 || gx > W + 20) continue
      // Ghosts used to be laid down as overlapping rects, each at this
      // alpha, which stacked about three deep into a denser silhouette; a
      // single blit of the sprite needs that stacking folded into its alpha.
      const a = 0.45 * (1 - g.life / 0.7)
      c.globalAlpha = 1 - (1 - a) ** 3
      drawPrince(c, gx, g.y, ["run", runFrame(g.gait)], REWIND_SAND)
    }
    c.globalAlpha = 1

    // Dust and sand streaks.
    for (const p of particles) {
      c.globalAlpha = 1 - p.life / p.max
      c.fillStyle = p.float ? REWIND_SAND : pal.sand
      if (p.len) c.fillRect(p.x, p.y, p.len, p.size)
      else c.fillRect(p.x, p.y, p.size, p.size)
    }
    c.globalAlpha = 1

    // The prince, with a soft shadow so he separates from the city behind.
    c.fillStyle = "rgba(0, 0, 0, 0.35)"
    c.beginPath()
    c.ellipse(PLAYER_X + 2, y + 1, 11, 3, 0, 0, Math.PI * 2)
    c.fill()
    drawPrince(c, PLAYER_X, y, princeFrame())

    // Time frozen: warm tint.
    if (state === "dead" || state === "rewinding" || state === "over") {
      c.fillStyle = pal.tint
      c.fillRect(0, 0, W, H)
    }

    // Rewinding: a sand vignette closes in from the edges.
    if (state === "rewinding") {
      if (!vignette) {
        vignette = c.createRadialGradient(
          W / 2,
          H / 2,
          H * 0.35,
          W / 2,
          H / 2,
          W * 0.62
        )
        vignette.addColorStop(0, "rgba(0,0,0,0)")
        vignette.addColorStop(1, REWIND_EDGE)
      }
      c.fillStyle = vignette
      c.fillRect(0, 0, W, H)
    }

    // HUD.
    // The HUD sits below the window frame's top bar, which covers the top
    // HUD_TOP px of the canvas at the corners (the arch in the middle is open).
    text(`${Math.floor(dist)} m`, 12, HUD_TOP, "left", FONT_HUD, pal.text)
    text(
      `best ${Math.floor(best)} m`,
      W - 12,
      HUD_TOP,
      "right",
      FONT_HUD,
      pal.muted
    )

    // Dagger of Time: its glass blade holds the banked rewind time. The
    // empty dagger is drawn whole and the sand-filled one clipped to the
    // current level, so the sand recedes toward the hilt as it is spent.
    const dx = 8
    const dy = HUD_TOP + 14
    const dh = Math.round((DAGGER.h / DAGGER.w) * DAGGER_W)
    const k = DAGGER_W / DAGGER.w
    const fx0 = dx + DAGGER.fill[0]! * k
    const fx1 = dx + DAGGER.fill[1]! * k
    const level = fx0 + (fx1 - fx0) * (sand / SAND_MAX)
    const empty = tileOf(set.hud, 0, imageOf(daggerEmpty), DAGGER_W)
    const full = tileOf(set.hud, 1, imageOf(daggerFull), DAGGER_W)
    if (empty && full) {
      c.drawImage(empty, dx, dy, DAGGER_W, dh)
      c.save()
      c.beginPath()
      c.rect(dx, dy, level - dx, dh)
      c.clip()
      c.drawImage(full, dx, dy, DAGGER_W, dh)
      c.restore()
    } else {
      // Art still loading: a plain bar.
      c.fillStyle = pal.sand
      c.fillRect(fx0, dy + dh / 2 - 2, level - fx0, 4)
    }
    text("sands of time", dx + 4, dy + dh + 2, "left", FONT_SMALL, pal.muted)

    // Prompts.
    const prompt = (str: string, y: number, fill = pal.text) =>
      text(str, W / 2, y, "center", FONT_HUD, fill)
    if (state === "idle") {
      prompt(hoverCapable ? "press space to run" : "tap to run", H / 2 - 30)
    } else if (state === "dead") {
      if (Math.floor(blink * 2) % 2 === 0) {
        prompt(
          hoverCapable ? "hold R to rewind time" : "hold to rewind time",
          H / 2 - 30
        )
      }
    } else if (state === "rewinding") {
      prompt("rewinding", H / 2 - 30)
    } else if (state === "over") {
      prompt("out of sand", H / 2 - 40)
      prompt(
        hoverCapable ? "space to run again" : "tap to run again",
        H / 2 - 22,
        pal.muted
      )
    }
  }

  /** Tile a layer across the width; every other copy is mirrored so the
   *  seam between copies never shows. */
  function drawTiled(
    c: CanvasRenderingContext2D,
    img: HTMLCanvasElement,
    w: number,
    bottom: number,
    parallax: number,
    alpha: number
  ) {
    const height = (img.height / img.width) * w
    const par = worldX * parallax
    const firstIndex = Math.floor(par / w)
    c.globalAlpha = alpha
    for (let k = firstIndex; (k - firstIndex) * w - (par % w) < W; k++) {
      const x = k * w - par
      if (k % 2 === 0) {
        c.drawImage(img, x, bottom - height, w, height)
      } else {
        c.save()
        c.translate(x + w, 0)
        c.scale(-1, 1)
        c.drawImage(img, 0, bottom - height, w, height)
        c.restore()
      }
    }
    c.globalAlpha = 1
  }

  // The run cycle frame for a gait phase (one cycle per 2 pi).
  const runFrame = (phase: number) =>
    RUN_CYCLE[
      Math.floor(phase / ((Math.PI * 2) / RUN_CYCLE.length)) % RUN_CYCLE.length
    ]!

  // Which frame the prince is in: standing when nothing is happening, the
  // dagger poses (alternating) while rewinding, a jump frame from vertical
  // speed in the air, otherwise the run cycle. A death freezes whichever
  // frame he was in.
  function princeFrame(): [PrinceRow, number] {
    if (state === "idle" || state === "over") return ["rewind", 0]
    if (state === "rewinding") {
      return ["rewind", 1 + (Math.floor(rewindTime / 0.12) % 2)]
    }
    if (!onGround) return ["jump", vy < -150 ? 0 : vy > 150 ? 2 : 1]
    return ["run", runFrame(gait)]
  }

  function drawPrince(
    c: CanvasRenderingContext2D,
    x: number,
    feet: number,
    frame: [PrinceRow, number],
    mono?: string
  ) {
    const s = princeSprite(frame[0], frame[1], mono)
    if (!s) {
      // Atlas still loading: a stand-in the size of the hitbox.
      c.fillStyle = mono ?? palette.outline
      c.fillRect(x - PLAYER_W / 2, feet - 30, PLAYER_W, 30)
      return
    }
    c.drawImage(s.bitmap, snap(x - s.ax), snap(feet - s.h), s.w, s.h)
  }

  // --- Input ------------------------------------------------------------------

  function jumpPress() {
    if (state === "idle" || state === "over") {
      reset()
      state = "running"
      return
    }
    if (state !== "running") return
    // On the roof, or just off its edge: jump now. In the air: remember the
    // press briefly so it lands the moment the feet do.
    if (onGround || coyote > 0) doJump()
    else jumpQueued = JUMP_BUFFER
  }
  function doJump() {
    vy = JUMP_V
    jumpHeld = true
    onGround = false
    coyote = 0
    jumpQueued = 0
    burst(PLAYER_X - 4, y, 6, 0.6)
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (!visible) return
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
      if (e.repeat) {
        e.preventDefault()
        return
      }
      e.preventDefault()
      jumpPress()
      wake()
    } else if (e.code === "KeyR") {
      e.preventDefault()
      rewindHeld = true
      wake()
    }
  }
  function onKeyUp(e: KeyboardEvent) {
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
      jumpHeld = false
    } else if (e.code === "KeyR") {
      rewindHeld = false
      rewindSpent = false
    }
  }
  // Touch: a tap jumps; a hold rewinds. Mid-run the hold starts as a jump,
  // which the rewind then undoes along with everything else.
  let holdTimer = 0
  function onPointerDown(e: PointerEvent) {
    e.preventDefault()
    canvas.setPointerCapture(e.pointerId)
    if (state === "dead" || state === "rewinding") rewindHeld = true
    else {
      jumpPress()
      clearTimeout(holdTimer)
      holdTimer = window.setTimeout(() => {
        rewindHeld = true
        wake()
      }, 250)
    }
    wake()
  }
  function onPointerUp() {
    clearTimeout(holdTimer)
    jumpHeld = false
    rewindHeld = false
    rewindSpent = false
  }

  window.addEventListener("keydown", onKeyDown)
  window.addEventListener("keyup", onKeyUp)
  canvas.addEventListener("pointerdown", onPointerDown)
  canvas.addEventListener("pointerup", onPointerUp)
  canvas.addEventListener("pointercancel", onPointerUp)

  // --- Loop -------------------------------------------------------------------
  //
  // While running or rewinding the game draws on requestAnimationFrame,
  // every n-th tick so a high-refresh display gets TARGET_FPS or a little
  // more (72 on a 144 Hz panel, 60 on 240 Hz, 90 on 90 Hz). Otherwise it
  // sleeps on a timer and redraws every IDLE_MS, so an idle page costs
  // nothing between ticks.

  let raf = 0
  let timer = 0
  let last = 0
  let visible = true
  let awake = !reducedMotion // under reduced motion, wait for the first input
  let skip = 1 // draw every n-th tick while active
  let tick = 0
  let lastTick = 0
  const intervals: number[] = [] // recent tick spacing, to size `skip`

  // Mirrored on the element for styling, tests and assistive tech.
  function mirror() {
    canvas.dataset.runnerState = state
    canvas.dataset.runnerDist = String(Math.floor(dist))
    canvas.dataset.runnerSand = sand.toFixed(2)
  }

  function resize() {
    const rect = canvas.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(((rect.width * H) / W) * dpr)
    devScale = canvas.width / W
    ctx!.setTransform(devScale, 0, 0, devScale, 0, 0)
  }
  const sizeObserver = new ResizeObserver(() => {
    resize()
    draw()
  })
  sizeObserver.observe(canvas)

  const isActive = () => state === "running" || state === "rewinding"

  function frame(now: number) {
    raf = 0
    if (!visible) return
    if (isActive()) {
      // Refresh rate from the spacing of the last 30 ticks (the median
      // shrugs off a hitch), re-read every 30 ticks in case the window
      // has moved to another display.
      const gap = now - lastTick
      if (lastTick && gap > 1 && gap < 100) {
        intervals.push(gap)
        if (intervals.length > 30) intervals.shift()
      }
      lastTick = now
      tick++
      if (intervals.length >= 10 && tick % 30 === 0) {
        const sorted = [...intervals].sort((a, b) => a - b)
        const hz = 1000 / sorted[sorted.length >> 1]!
        // The largest n that keeps the drawn rate at or above the target
        // (the 0.1 absorbs a 120 Hz panel measuring as 119).
        skip = Math.max(1, Math.floor(hz / TARGET_FPS + 0.1))
      }
      if (tick % skip) {
        raf = requestAnimationFrame(frame)
        return
      }
    } else {
      // Start the next run fresh: its first tick draws, and the refresh
      // rate is measured again in case the window has moved.
      lastTick = 0
      tick = -1
      intervals.length = 0
    }
    const dt = Math.min((now - last) / 1000, 1 / 30) || 1 / 60
    last = now
    step(dt)
    if (state === "running" && dist > best) {
      best = dist
      try {
        localStorage.setItem(STORAGE_KEY, String(Math.floor(best)))
      } catch {
        /* storage unavailable */
      }
    }
    draw()
    mirror()
    schedule()
  }
  function schedule() {
    if (!visible || raf || timer) return
    if (isActive()) raf = requestAnimationFrame(frame)
    else
      timer = window.setTimeout(() => {
        timer = 0
        raf = requestAnimationFrame(frame)
      }, IDLE_MS)
  }
  function start() {
    if (raf || timer || !visible || !awake) return
    last = performance.now()
    schedule()
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf)
    if (timer) clearTimeout(timer)
    raf = timer = 0
  }
  // Input can make the game active between two idle ticks: go straight to
  // the next frame instead of waiting the rest of the tick out. This is
  // also what starts the loop under reduced motion.
  function wake() {
    awake = true
    if (timer) {
      clearTimeout(timer)
      timer = 0
    }
    if (!raf && visible) raf = requestAnimationFrame(frame)
  }
  const visibility = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1]?.isIntersecting ?? true
    if (visible) start()
    else stop()
  })
  visibility.observe(canvas)

  reset()
  resize()
  draw()
  mirror()
  // Under reduced motion the idle sheen stays still until the first input
  // (start() is gated on `awake`, which only wake() sets).
  start()

  return function dispose() {
    stop()
    clearTimeout(prefetch)
    clearTimeout(holdTimer)
    visibility.disconnect()
    sizeObserver.disconnect()
    themeObserver.disconnect()
    document.fonts?.removeEventListener("loadingdone", onFonts)
    window.removeEventListener("keydown", onKeyDown)
    window.removeEventListener("keyup", onKeyUp)
    canvas.removeEventListener("pointerdown", onPointerDown)
    canvas.removeEventListener("pointerup", onPointerUp)
    canvas.removeEventListener("pointercancel", onPointerUp)
    delete canvas.dataset.runnerInit
  }
}
