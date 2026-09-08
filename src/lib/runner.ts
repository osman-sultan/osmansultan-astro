/**
 * Sands of Time runner: a small endless rooftop runner drawn on a 2D canvas.
 *
 * The prince runs right across Persian rooftops. Jump over gaps and spike
 * traps. Dying freezes time; holding R (or holding the canvas) rewinds the
 * last few seconds, draining the Dagger of Time's sand, which refills slowly
 * while running. Out of sand means the run is over.
 */

import dayDunes from "@/assets/game/day-1-dunes.png"
import dayCity from "@/assets/game/day-2-city.png"
import dayRooftops from "@/assets/game/day-3-rooftops.png"
import nightDunes from "@/assets/game/night-1-dunes.png"
import nightCity from "@/assets/game/night-2-city.png"
import nightRooftops from "@/assets/game/night-3-rooftops.png"
import dayB1 from "@/assets/game/day-b1.png"
import dayB2 from "@/assets/game/day-b2.png"
import dayB3 from "@/assets/game/day-b3.png"
import dayB4 from "@/assets/game/day-b4.png"
import dayB5 from "@/assets/game/day-b5.png"
import dayB6 from "@/assets/game/day-b6.png"
import dayB7 from "@/assets/game/day-b7.png"
import dayB8 from "@/assets/game/day-b8.png"
import dayBuildingMeta from "@/assets/game/day-buildings.json"
import nightB1 from "@/assets/game/night-b1.png"
import nightB2 from "@/assets/game/night-b2.png"
import nightB3 from "@/assets/game/night-b3.png"
import nightB4 from "@/assets/game/night-b4.png"
import nightB5 from "@/assets/game/night-b5.png"
import nightB6 from "@/assets/game/night-b6.png"
import nightB7 from "@/assets/game/night-b7.png"
import nightB8 from "@/assets/game/night-b8.png"

// Logical size. The canvas element scales this to its width, so a
// smaller logical width means everything draws bigger on screen.
const W = 400
const H = 250
const GROUND = H - 64 // y of the base rooftop level (screen px, y down)
const LEVEL_H = 26 // height difference between rooftop levels
const PLAYER_X = 80
const PLAYER_W = 12
const GRAVITY = 1900
const JUMP_V = -540
const JUMP_CUT = -180 // release early: cap upward speed for a shorter hop
const START_SPEED = 180
const MAX_SPEED = 290
const HISTORY_SECONDS = 4
const REWIND_RATE = 2.2 // seconds of history undone per real second
const SAND_MAX = 4 // seconds of rewind in the dagger
const SAND_REFILL = 0.22 // seconds of sand regained per second running
const STORAGE_KEY = "sands-runner-best"
// The rewind is always lit in the Sands of Time gold, whatever the theme.
const REWIND_SAND = "#ffc23d"
const REWIND_EDGE = "rgba(240, 147, 15, 0.45)"

type Part = { idx: number; x: number; w: number } // one building in a platform
type Platform = {
  x: number
  w: number
  level: number
  spikes: number[]
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
  moon: string | null
  sun: string | null
  outline: string
  textHalo: string // outline behind labels: opposite of the text colour
  spike: string
  sand: string
  sandDim: string
  text: string
  muted: string
  tint: string
}

const PALETTES: Record<"dark" | "light", Palette> = {
  dark: {
    roof: "oklch(0.2 0.04 240)",
    roofEdge: "oklch(0.86 0.1 205)",
    sky: ["oklch(0.12 0.03 265)", "oklch(0.32 0.1 222)"],
    moon: "rgba(244, 232, 207, 0.85)",
    sun: null,
    outline: "rgba(8, 16, 28, 0.9)",
    textHalo: "rgba(8, 16, 28, 0.85)",
    spike: "#ffc23d",
    sand: "#ffc23d",
    sandDim: "rgba(255, 194, 61, 0.25)",
    text: "oklch(0.96 0.008 240)",
    muted: "oklch(0.7 0.02 235)",
    tint: "rgba(240, 147, 15, 0.14)",
  },
  light: {
    roof: "oklch(0.44 0.1 205)",
    roofEdge: "oklch(0.92 0.09 92)",
    sky: ["oklch(0.9 0.06 95)", "oklch(0.82 0.13 62)"],
    moon: null,
    sun: "oklch(0.8 0.16 72)",
    outline: "rgba(40, 20, 8, 0.9)",
    textHalo: "rgba(255, 246, 228, 0.92)",
    spike: "#ffc23d",
    sand: "#b34d05",
    sandDim: "rgba(179, 77, 5, 0.22)",
    text: "oklch(0.2 0.03 60)",
    muted: "oklch(0.32 0.05 55)",
    tint: "rgba(240, 147, 15, 0.14)",
  },
}

// The prince, 12 x 18 pixel art facing right. T turban, F feather, G gold
// band and sash, S skin, H hair, V vest, P trousers, B boots, K scarf.
const SPRITE_PX = 1.7
const SPRITE_COLORS: Record<string, string> = {
  T: "#f2e6cc",
  F: "#c8452e",
  G: "#e0a63a",
  S: "#d89a63",
  H: "#2a1a12",
  V: "#2f6d9e",
  P: "#e7dcc4",
  B: "#5b3a22",
  K: "#c8452e",
}
const SPRITE_BODY = [
  ".....F......",
  "....TTTT....",
  "...TTTTTT...",
  "...TGGGGT...",
  "...HSSSS....",
  "...HSSSS....",
  "....SSS.....",
  "..K.VVVV....",
  ".KKVVVVVS...",
  "K..VVVVVSS..",
  "..S.VVVV....",
  "....GGGG....",
]
const SPRITE_LEGS: Record<string, string[]> = {
  stride: [
    "...PPPPPP...",
    "..PPP..PPP..",
    ".PPP....PPP.",
    ".PP......PP.",
    "BB........BB",
    "BB........BB",
  ],
  cross: [
    "....PPPP....",
    "....PPPP....",
    "...PPP.PP...",
    "...PP..PPP..",
    "..BB....BB..",
    "..BB.....BB.",
  ],
  stride2: [
    "...PPPPPP...",
    "..PPP.PPP...",
    ".PPP...PPP..",
    ".PP.....PP..",
    "BB.......BB.",
    "BB.......BB.",
  ],
  jump: [
    "...PPPPPP...",
    "..PPP.PPPP..",
    ".PPP....PPP.",
    ".BB......BB.",
    "............",
    "............",
  ],
}
const RUN_CYCLE = ["stride", "cross", "stride2", "cross"]

// Painted parallax layers (src/assets/game), one image per theme. Each
// scrolls at a fraction of the ground speed: the smaller the fraction, the
// further away it reads. `width` is the drawn tile width in logical px
// (height follows the image's aspect) and `bottom` where its lower edge
// sits. The rooftops run past the canvas bottom so the drop between two
// platforms shows city rather than a void.
type LayerSpec = {
  day: ImageMetadata
  night: ImageMetadata
  width: number
  bottom: number
  parallax: number
  alpha: number
  haze: number // horizon-colour wash laid over this layer (and all behind it)
}
const LAYERS: LayerSpec[] = [
  {
    day: dayDunes,
    night: nightDunes,
    width: 560,
    bottom: GROUND - 58,
    parallax: 0.05,
    alpha: 0.9,
    haze: 0.3,
  },
  {
    day: dayCity,
    night: nightCity,
    width: 520,
    bottom: GROUND - 30,
    parallax: 0.12,
    alpha: 1,
    haze: 0.22,
  },
  {
    day: dayRooftops,
    night: nightRooftops,
    width: 500,
    bottom: H + 6,
    parallax: 0.28,
    alpha: 0.92,
    haze: 0.3,
  },
]

// The buildings the prince runs on (src/assets/game/day-b*.png). Each
// platform is a row of them chosen at random. `roof` is how far the
// runnable roofline sits below the sprite's top edge (crenellations poke
// above it). Night sprites, when present, share the day widths.
const BUILDING_SCALE = 0.36 // source px -> logical px
type Building = {
  day: ImageMetadata
  night: ImageMetadata
  w: number
  h: number
  roof: number
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
}))

function loadImage(meta: ImageMetadata) {
  const img = new Image()
  img.decoding = "async"
  img.src = meta.src
  return img
}

function hash(n: number) {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return v - Math.floor(v)
}

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
  const layerImages = LAYERS.map((l) => ({
    day: loadImage(l.day),
    night: loadImage(l.night),
  }))
  const buildingImages = BUILDINGS.map((b) => ({
    day: loadImage(b.day),
    night: loadImage(b.night),
  }))
  // Layer tiles pre-scaled to their on-screen pixel size, so each frame is
  // a plain 1:1 copy instead of resampling a 2000 px wide image three times.
  const tileCache = new Map<string, HTMLCanvasElement>()
  let devScale = 1 // device px per logical px, set in resize()
  function tileFor(i: number, img: HTMLImageElement, w: number) {
    if (!img.complete || !img.naturalWidth) return null
    const key = `${i}:${img.src}:${devScale}`
    let t = tileCache.get(key)
    if (!t) {
      const h = (img.naturalHeight / img.naturalWidth) * w
      t = document.createElement("canvas")
      t.width = Math.max(1, Math.round(w * devScale))
      t.height = Math.max(1, Math.round(h * devScale))
      t.getContext("2d")!.drawImage(img, 0, 0, t.width, t.height)
      tileCache.set(key, t)
      // Keep only the current size around.
      for (const k of [...tileCache.keys()]) {
        if (!k.endsWith(`:${devScale}`)) tileCache.delete(k)
      }
    }
    return t
  }
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
  let sand = SAND_MAX
  let history: Frame[] = []
  let runTime = 0
  let particles: Particle[] = []
  let ghosts: Ghost[] = []
  let lastGhostT = 0
  let rewindTime = 0 // seconds spent in the current rewind (drives the FX)
  let platforms: Platform[] = []
  let genX = 0 // world x where the next platform starts
  let rewindHeld = false
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
    const start = buildRow(420)
    platforms.push({
      x: -40,
      w: start.w,
      level: 0,
      spikes: [],
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
    const row = buildRow(120 + rnd() * 220)
    const w = row.w
    const spikes: number[] = []
    if (w > 170 && rnd() < 0.6) {
      // One cluster of 2-4 spikes, never right at the landing edge.
      const n = 2 + Math.floor(rnd() * 3)
      const start = 56 + rnd() * (w - 56 - n * 10 - 40)
      for (let i = 0; i < n; i++) spikes.push(start + i * 10)
    }
    platforms.push({ x: genX + gap, w, level, spikes, parts: row.parts })
    genX += gap + w
    lastLevel = level
  }

  // A row of buildings at least `target` wide, no building twice in a row.
  let lastBuilding = -1
  function buildRow(target: number) {
    const parts: Part[] = []
    let w = 0
    while (w < target) {
      let idx = Math.floor(rnd() * BUILDINGS.length)
      if (idx === lastBuilding) idx = (idx + 1) % BUILDINGS.length
      lastBuilding = idx
      const b = BUILDINGS[idx]!
      // Overlap neighbours by a pixel: scaled sprites otherwise leave a
      // hairline seam between them.
      const x = parts.length ? w - 3 : 0
      parts.push({ idx, x, w: b.w })
      w = x + b.w
    }
    return { parts, w }
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
    if (state === "running") {
      speed = Math.min(MAX_SPEED, speed + dt * 4)
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
        }
        // Running into the face of a higher roof.
        if (
          y > top + 4 &&
          wx + PLAYER_W / 2 > p.x &&
          wx - PLAYER_W / 2 < p.x + 8
        ) {
          die()
        }
        // Spikes.
        for (const sx of p.spikes) {
          const ax = p.x + sx
          if (
            wx + PLAYER_W / 2 - 3 > ax &&
            wx - PLAYER_W / 2 + 3 < ax + 10 &&
            y > top - 14
          ) {
            die()
            break
          }
        }
      }
      if (onGround) gait += dt * speed * 0.07
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
      sand = Math.max(0, sand - dt)
      // Sand pours back into the hourglass: streaks race right to left
      // across the whole scene, plus grains swirling off the prince.
      for (let i = 0; i < 5; i++) {
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
      for (let i = 0; i < 3; i++) {
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
        // Resume from the rewound moment; the trap is still ahead.
        state = history.length || sand > 0 ? "running" : "over"
        if (state === "running") {
          onGround = false
          particles = particles.filter((p) => !p.len)
        }
      }
    } else if (state === "dead") {
      blink += dt
      if (rewindHeld && sand > 0 && history.length) {
        state = "rewinding"
        rewindTime = 0
        lastGhostT = runTime
      }
      if (sand <= 0.05 || !history.length) state = "over"
    }

    for (const p of particles) {
      p.life += dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      if (!p.float) p.vy += 300 * dt
    }
    particles = particles.filter((p) => p.life < p.max)
    for (const g of ghosts) g.life += dt
    ghosts = ghosts.filter((g) => g.life < 0.7)
  }

  // --- Drawing ----------------------------------------------------------------

  // Outlined text: every label sits over busy artwork.
  function text(str: string, x: number, y: number) {
    const c = ctx!
    c.lineJoin = "round"
    c.lineWidth = 3
    c.strokeStyle = palette.textHalo
    c.strokeText(str, x, y)
    c.fillText(str, x, y)
  }

  function draw() {
    const c = ctx!
    const pal = palette

    // Sky backdrop.
    const sky = c.createLinearGradient(0, 0, 0, GROUND)
    sky.addColorStop(0, pal.sky[0])
    sky.addColorStop(1, pal.sky[1])
    c.fillStyle = sky
    c.fillRect(0, 0, W, H)

    // Stars and a crescent moon by night, a hazy sun by day.
    if (pal.moon) {
      c.fillStyle = pal.moon
      for (let i = 0; i < 14; i++) {
        const sx = hash(i * 7 + 1) * W
        const sy = 8 + hash(i * 7 + 2) * (H * 0.45)
        c.globalAlpha = 0.35 + hash(i * 7 + 3) * 0.5
        c.fillRect(sx, sy, 1.5, 1.5)
      }
      c.globalAlpha = 1
      c.beginPath()
      c.arc(W - 72, 40, 14, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = sky
      c.beginPath()
      c.arc(W - 66, 36, 13, 0, Math.PI * 2)
      c.fill()
    }
    if (pal.sun) {
      const halo = c.createRadialGradient(W - 72, 44, 6, W - 72, 44, 40)
      halo.addColorStop(0, "rgba(240, 147, 15, 0.45)")
      halo.addColorStop(1, "rgba(240, 147, 15, 0)")
      c.fillStyle = halo
      c.fillRect(W - 112, 4, 80, 80)
      c.fillStyle = pal.sun
      c.beginPath()
      c.arc(W - 72, 44, 13, 0, Math.PI * 2)
      c.fill()
    }

    // Painted city behind the rooftops, far to near.
    const night = palette === PALETTES.dark
    LAYERS.forEach((l, i) => {
      const img = night ? layerImages[i]!.night : layerImages[i]!.day
      const tile = tileFor(i, img, l.width)
      if (tile) drawTiled(c, tile, l.width, l.bottom, l.parallax, l.alpha)
      // Atmospheric haze: a wash of horizon colour over everything so far,
      // so each layer sits further back than the one drawn after it.
      c.globalAlpha = l.haze
      c.fillStyle = pal.sky[1]
      c.fillRect(0, 0, W, H)
      c.globalAlpha = 1
    })

    // Rooftops.
    for (const p of platforms) {
      const sx = p.x - worldX
      if (sx > W + 10 || sx + p.w < -10) continue
      const top = levelY(p.level)
      for (const part of p.parts) {
        const b = BUILDINGS[part.idx]!
        const set = buildingImages[part.idx]!
        const img = night ? set.night : set.day
        const tile = tileFor(100 + part.idx, img, b.w)
        if (tile) {
          c.drawImage(tile, Math.round(sx + part.x), top - b.roof, b.w, b.h)
        } else {
          c.fillStyle = pal.roof
          c.fillRect(sx + part.x, top, b.w, H - top)
          c.fillStyle = pal.roofEdge
          c.fillRect(sx + part.x, top, b.w, 2)
        }
      }
      // Spikes: bright, outlined, on a small base plate.
      if (p.spikes.length) {
        const first = sx + p.spikes[0]!
        const last = sx + p.spikes[p.spikes.length - 1]! + 10
        c.fillStyle = pal.outline
        c.fillRect(first - 2, top - 3, last - first + 4, 3)
        for (const sp of p.spikes) {
          const ax = sx + sp
          c.beginPath()
          c.moveTo(ax, top - 2)
          c.lineTo(ax + 5, top - 20)
          c.lineTo(ax + 10, top - 2)
          c.closePath()
          c.fillStyle = pal.spike
          c.fill()
          c.strokeStyle = pal.outline
          c.lineWidth = 1.5
          c.lineJoin = "round"
          c.stroke()
          // Bright edge so the blade reads against any backdrop.
          c.beginPath()
          c.moveTo(ax + 2.5, top - 4)
          c.lineTo(ax + 5, top - 16)
          c.strokeStyle = "rgba(255, 255, 255, 0.8)"
          c.lineWidth = 1
          c.stroke()
        }
      }
    }

    // Afterimages of the prince along the path being undone.
    for (const g of ghosts) {
      const gx = PLAYER_X + (g.worldX - worldX)
      if (gx < -20 || gx > W + 20) continue
      c.globalAlpha = 0.45 * (1 - g.life / 0.7)
      drawPrince(c, gx, g.y, REWIND_SAND, g.gait, REWIND_SAND)
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
    drawPrince(c, PLAYER_X, y, pal.outline)

    // Time frozen: warm tint.
    if (state === "dead" || state === "rewinding" || state === "over") {
      c.fillStyle = pal.tint
      c.fillRect(0, 0, W, H)
    }

    // Rewinding: a sand vignette closes in from the edges.
    if (state === "rewinding") {
      const vig = c.createRadialGradient(
        W / 2,
        H / 2,
        H * 0.35,
        W / 2,
        H / 2,
        W * 0.62
      )
      vig.addColorStop(0, "rgba(0,0,0,0)")
      vig.addColorStop(1, REWIND_EDGE)
      c.fillStyle = vig
      c.fillRect(0, 0, W, H)
    }

    // HUD.
    c.fillStyle = pal.text
    c.font = `12px ${fontMono}`
    c.textBaseline = "top"
    c.textAlign = "left"
    text(`${Math.floor(dist)} m`, 12, 10)
    c.textAlign = "right"
    c.fillStyle = pal.muted
    text(`best ${Math.floor(best)} m`, W - 12, 10)

    // Dagger of Time: the blade fills with sand as rewind time is banked,
    // with a light sweeping along it like polished steel.
    const mx = 12
    const my = 30
    const len = 80
    const bh = 5
    const blade = () => {
      c.beginPath()
      c.moveTo(mx, my)
      c.lineTo(mx + len - 9, my)
      c.lineTo(mx + len, my + bh / 2)
      c.lineTo(mx + len - 9, my + bh)
      c.lineTo(mx, my + bh)
      c.closePath()
    }
    c.fillStyle = pal.sandDim
    blade()
    c.fill()
    c.save()
    blade()
    c.clip()
    const fw = (len * sand) / SAND_MAX
    c.fillStyle = pal.sand
    c.fillRect(mx, my, fw, bh)
    // Top edge catches the light.
    const edge = c.createLinearGradient(0, my, 0, my + bh)
    edge.addColorStop(0, "rgba(255, 255, 255, 0.45)")
    edge.addColorStop(0.5, "rgba(255, 255, 255, 0)")
    edge.addColorStop(1, "rgba(0, 0, 0, 0.18)")
    c.fillStyle = edge
    c.fillRect(mx, my, fw, bh)
    // Sweeping shimmer.
    const sweep = ((performance.now() / 1000) * 55) % (len + 70)
    const sx = mx - 35 + sweep
    const sheen = c.createLinearGradient(sx - 16, 0, sx + 16, 0)
    sheen.addColorStop(0, "rgba(255, 255, 255, 0)")
    sheen.addColorStop(0.5, "rgba(255, 255, 255, 0.8)")
    sheen.addColorStop(1, "rgba(255, 255, 255, 0)")
    c.fillStyle = sheen
    c.fillRect(mx, my, fw, bh)
    c.restore()
    // Hilt.
    c.fillStyle = pal.spike
    c.fillRect(mx - 5, my - 2, 3, bh + 4)
    c.fillRect(mx - 9, my + 1, 4, bh - 2)
    c.fillStyle = pal.muted
    c.font = `10px ${fontMono}`
    c.textAlign = "left"
    text("sands of time", mx, my + 8)

    // Prompts.
    c.textAlign = "center"
    c.font = `12px ${fontMono}`
    c.fillStyle = pal.text
    if (state === "idle") {
      text(
        hoverCapable ? "press space to run" : "tap to run",
        W / 2,
        H / 2 - 30
      )
    } else if (state === "dead") {
      if (Math.floor(blink * 2) % 2 === 0) {
        text(
          hoverCapable ? "hold R to rewind time" : "hold to rewind time",
          W / 2,
          H / 2 - 30
        )
      }
    } else if (state === "rewinding") {
      text("rewinding", W / 2, H / 2 - 30)
    } else if (state === "over") {
      text("out of sand", W / 2, H / 2 - 40)
      c.fillStyle = pal.muted
      text(
        hoverCapable ? "space to run again" : "tap to run again",
        W / 2,
        H / 2 - 22
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

  function drawPrince(
    c: CanvasRenderingContext2D,
    x: number,
    feet: number,
    outline: string,
    phase = gait,
    mono?: string
  ) {
    const air = !onGround && state === "running" && mono === undefined
    const frame = air
      ? "jump"
      : RUN_CYCLE[Math.floor(phase / (Math.PI / 2)) % RUN_CYCLE.length]!
    const rows = [...SPRITE_BODY, ...SPRITE_LEGS[frame]!]
    const px = SPRITE_PX
    const cols = rows[0]!.length
    const bob = !air && frame === "cross" ? 1 : 0
    const ox = x - (cols * px) / 2
    const oy = feet - rows.length * px + bob
    // Outline pass, then colour pass.
    c.fillStyle = outline
    rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        if (row[rx] === ".") continue
        c.fillRect(ox + rx * px - 0.7, oy + ry * px - 0.7, px + 1.4, px + 1.4)
      }
    })
    rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        const ch = row[rx]!
        if (ch === ".") continue
        c.fillStyle = mono ?? SPRITE_COLORS[ch]!
        c.fillRect(ox + rx * px, oy + ry * px, px + 0.2, px + 0.2)
      }
    })
  }

  // --- Input ------------------------------------------------------------------

  function jumpPress() {
    if (state === "idle" || state === "over") {
      reset()
      state = "running"
      return
    }
    if (state === "running" && onGround) {
      vy = JUMP_V
      jumpHeld = true
      onGround = false
      burst(PLAYER_X - 4, y, 6, 0.6)
    }
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
    } else if (e.code === "KeyR") {
      e.preventDefault()
      rewindHeld = true
    }
  }
  function onKeyUp(e: KeyboardEvent) {
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
      jumpHeld = false
    } else if (e.code === "KeyR") {
      rewindHeld = false
    }
  }
  function onPointerDown(e: PointerEvent) {
    e.preventDefault()
    canvas.setPointerCapture(e.pointerId)
    if (state === "dead" || state === "rewinding") rewindHeld = true
    else jumpPress()
  }
  function onPointerUp() {
    jumpHeld = false
    rewindHeld = false
  }

  window.addEventListener("keydown", onKeyDown)
  window.addEventListener("keyup", onKeyUp)
  canvas.addEventListener("pointerdown", onPointerDown)
  canvas.addEventListener("pointerup", onPointerUp)
  canvas.addEventListener("pointercancel", onPointerUp)

  // --- Loop -------------------------------------------------------------------

  let raf = 0
  let last = 0
  let visible = true

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

  let lastDraw = 0
  function frame(now: number) {
    const active = state === "running" || state === "rewinding"
    if (!active && now - lastDraw < 50) {
      raf = visible ? requestAnimationFrame(frame) : 0
      return
    }
    lastDraw = now
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
    // Mirrored on the element for styling, tests and assistive tech.
    canvas.dataset.runnerState = state
    canvas.dataset.runnerDist = String(Math.floor(dist))
    raf = visible ? requestAnimationFrame(frame) : 0
  }
  function start() {
    if (raf || !visible) return
    last = performance.now()
    raf = requestAnimationFrame(frame)
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
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
  if (!reducedMotion) start()
  else {
    // Still playable, just no idle loop until the first input.
    canvas.addEventListener("pointerdown", () => start(), { once: true })
    window.addEventListener("keydown", () => start(), { once: true })
  }

  return function dispose() {
    stop()
    visibility.disconnect()
    sizeObserver.disconnect()
    themeObserver.disconnect()
    window.removeEventListener("keydown", onKeyDown)
    window.removeEventListener("keyup", onKeyUp)
    canvas.removeEventListener("pointerdown", onPointerDown)
    canvas.removeEventListener("pointerup", onPointerUp)
    canvas.removeEventListener("pointercancel", onPointerUp)
    delete canvas.dataset.runnerInit
  }
}
