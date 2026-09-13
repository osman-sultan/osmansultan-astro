/**
 * Moving sand for the Sands of Time title (Three.js).
 *
 * This is a GPU port of the static SVG filter chain in sands-title.astro,
 * so a still frame looks the same as the SVG wisps. The difference is that
 * the fractal noise the filters multiply and displace by is scrolled
 * outward from the word over time (and slowly evolves), which makes the
 * sand halo stream sideways off the letters.
 *
 * Per layer the SVG does: dilate the glyph alpha, blur it anisotropically,
 * multiply by fractal noise (outer layer also by a low-frequency patch
 * mask), displace it by the same noise, sharpen the alpha and flood a
 * colour. The dilate + blur is precomputed once on the CPU into a mask
 * texture (R = outer, G = inner); everything noise-related runs per frame
 * in the fragment shader.
 *
 * If WebGL is unavailable the SVG wisps simply stay visible.
 */
import * as THREE from "three"

const MAX_PIXEL_RATIO = 2
// Hover effects only make sense with a real pointer; touch devices also get
// a lower render resolution to keep the shader cheap.
const HOVER_CAPABLE =
  typeof matchMedia === "function" &&
  matchMedia("(hover: hover) and (pointer: fine)").matches
const RESOLUTION_SCALE = HOVER_CAPABLE ? 0.75 : 0.6
const MASK_SCALE = 0.5 // mask texture resolution relative to CSS px
const FLOW_PX_PER_SECOND = 26 // how fast the sand streams away from the word
// Every px value below is for the title at this font size. The shader runs
// in that reference space and the CPU masks are scaled to match, so the
// same effect fits the small nav copy of the title.
const REFERENCE_FONT_PX = 48

// Falling dust: now and then a spot on the underside lets go and fine dust
// pours out for a moment, widening and thinning as it drifts down, the way
// dust sifts off a ceiling when a building shakes.
const DUST = {
  opacity: 0.6, // overall strength; the specks are sparse so this stays subtle
  reach: 185, // px below the letters the dust has fully dispersed
  shakeSpeed: 55, // px/s the dust knocked loose by hovering drifts down
  shakeDecay: 0.4, // how fast that dust thins out (1/s)
  shakeRate: 2.4, // how fast pressing sheds it
  shakeOpacity: 0.7,
}

// Sand colours: the same golds in both themes (the light page is a pale
// steel blue they read against); the dust just gets a push in daylight.
const GOLD = {
  outer: [0.941, 0.576, 0.059], // #f0930f
  inner: [1.0, 0.761, 0.239], // #ffc23d
  dust: [0.92, 0.76, 0.5],
}
const PALETTE = {
  dark: { ...GOLD, dustBoost: 1 },
  light: { ...GOLD, dustBoost: 1.4 },
}

// Hover "footprint": a pressure field the cursor stamps into, which relaxes
// like sand refilling a print. Units are CSS px and seconds.
const WAKE = {
  scale: 0.25, // pressure buffer resolution relative to CSS px
  radius: 30, // footprint radius
  rise: 14, // how fast pressure builds under the cursor
  decay: 0.45, // how fast a print refills once the cursor is gone (1/s)
  spread: 0.9, // how fast the print's edges slump outward
  push: 1500, // how far sand is shoved away from the print (px per unit gradient)
  depth: 0.3, // how much sand is removed at the centre of the print
  rim: 0.55, // how strongly the shoved sand takes on the Sahara tint
}

// Values mirror the SVG filters (CSS px).
const OUTER = {
  dilate: 3,
  blurX: 26,
  blurY: 6,
  scaleX: 1.06,
  scaleY: 1.04,
  opacity: 0.8,
}
const INNER = {
  dilate: 3,
  blurX: 5,
  blurY: 2.5,
  scaleX: 1.05,
  scaleY: 1.03,
  opacity: 0.85,
}

const NOISE_GLSL = /* glsl */ `
  // Simplex 3D noise — Ian McEwan, Ashima Arts (MIT).
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }

  // SVG feTurbulence type="fractalNoise": summed octaves mapped to 0..1.
  float fractal3(vec3 p) {
    float n = snoise(p) + 0.5 * snoise(p * 2.0 + 11.3) + 0.25 * snoise(p * 4.0 + 29.7);
    return clamp(0.5 + 0.5 * n / 1.75, 0.0, 1.0);
  }
  float fractal2(vec3 p) {
    float n = snoise(p) + 0.5 * snoise(p * 2.0 + 11.3);
    return clamp(0.5 + 0.5 * n / 1.5, 0.0, 1.0);
  }

  // Noise that streams outward: a field translating left and one translating
  // right, crossfaded through the middle of the word. Each field is a rigid
  // translation, so nothing stretches or piles up at the centre.
  float flow3(vec2 p, vec2 freq, float z, float offs, float shift, float blendR) {
    float nl = fractal3(vec3((p + vec2(shift, 0.0)) * freq, z) + offs);
    float nr = fractal3(vec3((p - vec2(shift, 0.0)) * freq, z) + offs);
    return mix(nl, nr, blendR);
  }
  float flow2(vec2 p, vec2 freq, float z, float offs, float shift, float blendR) {
    float nl = fractal2(vec3((p + vec2(shift, 0.0)) * freq, z) + offs);
    float nr = fractal2(vec3((p - vec2(shift, 0.0)) * freq, z) + offs);
    return mix(nl, nr, blendR);
  }
`

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const WAKE_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform sampler2D tPrev;
  uniform vec2 uTexel;
  uniform vec2 uSize;
  uniform vec2 uMouse;
  uniform vec2 uPrevMouse;
  uniform float uDt;
  uniform float uHover;
  uniform float uTime;
  uniform float uGlyphY;
  uniform float uEmitY;
  varying vec2 vUv;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float segmentDistance(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
    return length(p - (a + ab * h));
  }

  void main() {
    float c = texture2D(tPrev, vUv).r;
    // Slump: grains slide so the print's edges soften and widen.
    float n = texture2D(tPrev, vUv + vec2(uTexel.x, 0.0)).r
            + texture2D(tPrev, vUv - vec2(uTexel.x, 0.0)).r
            + texture2D(tPrev, vUv + vec2(0.0, uTexel.y)).r
            + texture2D(tPrev, vUv - vec2(0.0, uTexel.y)).r;
    c = mix(c, n * 0.25, clamp(${WAKE.spread} * uDt, 0.0, 1.0));
    // Refill.
    c *= exp(-${WAKE.decay} * uDt);
    // Press along the cursor's path this frame.
    vec2 p = vUv * uSize;
    float d = segmentDistance(p, uPrevMouse, uMouse);
    float s = uHover * exp(-(d * d) / (2.0 * ${WAKE.radius}.0 * ${WAKE.radius}.0));
    if (s > c) c += (s - c) * (1.0 - exp(-${WAKE.rise}.0 * uDt));

    // Dust knocked loose by pressing: a density carried downward each frame
    // (y is up, so sample from just above), spreading a little sideways and
    // thinning as it falls. It is only ever emitted in a thin band at the
    // underside of the letters, so it can only come from the text.
    vec2 up = vec2(0.0, ${DUST.shakeSpeed}.0 * uDt / uSize.y);
    float dust = texture2D(tPrev, vUv + up).g;
    float dSide = texture2D(tPrev, vUv + up + vec2(uTexel.x, 0.0)).g
                + texture2D(tPrev, vUv + up - vec2(uTexel.x, 0.0)).g;
    dust = mix(dust, dSide * 0.5, clamp(0.9 * uDt, 0.0, 0.5));
    dust *= exp(-${DUST.shakeDecay} * uDt);
    float band = 1.0 - smoothstep(0.0, 7.0, abs(p.y - uEmitY));
    float pressAbove = texture2D(tPrev, vec2(vUv.x, uGlyphY / uSize.y)).r;
    // Ragged emission: only some spots along the underside let go, and
    // which spots changes every few hundred ms.
    float gate = smoothstep(0.55, 0.85, hash21(vec2(floor(p.x / 8.0), floor(uTime * 2.5))));
    dust += band * pressAbove * gate * ${DUST.shakeRate} * uDt;
    gl_FragColor = vec4(c, min(dust, 1.0), 0.0, 1.0);
  }
`

const FRAGMENT = /* glsl */ `
  precision highp float;
  uniform sampler2D tMask;
  uniform sampler2D tWake;
  uniform vec2 uWakeTexel;
  uniform vec2 uSize;
  uniform vec2 uOrigin;
  uniform float uCenterX;
  uniform float uGlyphY;
  uniform float uGlyphBottom;
  uniform float uTime;
  uniform float uHover;
  uniform vec3 uOuterCol;
  uniform vec3 uInnerCol;
  uniform vec3 uDustCol;
  uniform float uDustBoost;
  varying vec2 vUv;
  ${NOISE_GLSL}

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float maskAt(vec2 p, int channel) {
    vec2 uv = p / uSize;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    vec4 m = texture2D(tMask, uv);
    return channel == 0 ? m.r : m.g;
  }

  // Sparse soft specks on a jittered grid; q in px. Used for the falling
  // dust so it reads as individual grains rather than a shape.
  float grainField(vec2 q, float cell, float density, float seed) {
    vec2 g = q / cell;
    vec2 id = floor(g);
    vec2 f = fract(g);
    float h = hash21(id + seed);
    if (h > density) return 0.0;
    vec2 c = vec2(hash21(id + 7.1 + seed), hash21(id + 3.7 + seed)) * 0.6 + 0.2;
    float r = length((f - c) * cell);
    return smoothstep(1.7, 0.3, r) * (0.5 + 0.5 * h / density);
  }

  // One dust plume, belonging to column col of a layer. Space is split into
  // columns; each column rolls a die every period seconds and, if it wins,
  // a crack at a random x in the column pours fine dust for a short while.
  // The dust drifts down, spreads or tapers, sways and disperses. Pressing
  // on the sand (the hover footprint) raises the odds around the cursor.
  float plumeAt(float col, float back, vec2 p, float cellW, float period, float chance, float t, float seed) {
    float phase = hash21(vec2(col, seed)) * period;
    float tt = t + phase;
    // back = 1 evaluates the previous period's plume, so one still falling
    // when its period ends keeps falling instead of vanishing.
    float idx = floor(tt / period) - back;
    float local = tt - idx * period;
    float h = hash21(vec2(col + 1.3, idx + seed));
    float h2 = hash21(vec2(col + 3.3, idx * 1.7 + seed));
    float h3 = hash21(vec2(col + 9.1, idx + seed * 2.0));

    // Where the crack is, only where there is sand above it.
    float x0 = (col + 0.15 + 0.7 * h3) * cellW - seed * 131.0;
    float emit = maskAt(vec2(x0, uGlyphY), 0);
    if (emit < 0.15) return 0.0;

    if (h > chance) return 0.0;

    // Each plume gets its own character from a few more dice.
    float h4 = hash21(vec2(col + 5.7, idx * 2.3 + seed));
    float h5 = hash21(vec2(col + 2.9, idx * 0.6 + seed * 3.0));
    float h6 = hash21(vec2(col + 8.4, idx * 1.1 + seed * 5.0));
    // Shape: below 0 the plume starts wide and tapers to a point (inverted
    // triangle); above 0 it fans out as it falls. Around 0 it stays thin.
    float shape = mix(-0.9, 1.6, h4);
    float sigma0 = shape < 0.0 ? mix(6.0, 15.0, h5) : mix(1.8, 5.0, h5);
    float reachP = ${DUST.reach}.0 * mix(0.35, 1.0, h6); // how far this one falls
    float pour = mix(0.35, 2.0, h3); // seconds the crack keeps shedding
    float speed = mix(30.0, 90.0, h); // px/s the dust drifts down
    float heaviness = mix(0.55, 1.2, h6);
    float lean = (h5 - 0.5) * 0.45; // sideways drift per px fallen
    float start = h2 * period * 0.4;
    float age = local - start;
    if (age < 0.0 || age > pour + reachP / speed) return 0.0;

    float top = uGlyphBottom + 8.0;
    float fall = top - p.y; // how far below the crack this pixel is
    if (fall < -6.0) return 0.0;
    fall = max(fall, 0.0);
    float depth = fall / reachP; // 0 at the crack, 1 where it is gone

    // Dust at this depth left the crack this long ago; it must fall inside
    // the shedding window.
    float left = age - fall / speed;
    float window = smoothstep(-0.35, 0.25, left) * (1.0 - smoothstep(pour, pour + 0.6, left));
    if (window <= 0.001) return 0.0;

    // Width profile: tapering or fanning, never constant. Soft gaussian
    // across, so there is no edge for the eye to read as a strip.
    float sigma = max(sigma0 * (1.0 + shape * depth), 0.7);
    float sway = (fall / 50.0) * 6.0 * snoise(vec3(x0 * 0.05, fall * 0.02, t * 0.35 + h * 5.0));
    float dx = p.x - x0 - sway - lean * fall;
    float spread = exp(-(dx * dx) / (2.0 * sigma * sigma));
    if (spread < 0.01) return 0.0;
    // Tapering plumes thin out towards their tip; fanning ones thin as they spread.
    float disperse = shape < 0.0
      ? 1.0 - smoothstep(0.55, 1.0, depth)
      : (1.0 - smoothstep(0.25, 1.0, depth)) * mix(1.0, 0.5, depth);

    // Break the stream into ragged clumps that drift down with it.
    float clump = smoothstep(0.3, 0.75, fractal2(vec3(p.x * 0.12, (p.y + age * speed) * 0.05, h * 3.0)));

    // Individual specks moving with the dust, two sizes for depth.
    vec2 q = vec2(p.x, p.y + age * speed);
    float grains = grainField(q, 4.0, 0.5 * heaviness, h * 10.0)
                 + 0.7 * grainField(q * vec2(1.0, 0.85) + 13.0, 7.0, 0.4 * heaviness, h * 20.0);

    return window * spread * clump * disperse * min(grains, 1.0) * emit * heaviness;
  }

  // A layer: this pixel sees its own column's plume and both neighbours',
  // so plumes can lean, spread and overlap across column edges.
  float plumeLayer(vec2 p, float cellW, float period, float chance, float t, float seed) {
    float col0 = floor((p.x + seed * 131.0) / cellW);
    float sum = 0.0;
    for (int k = -1; k <= 1; k++) {
      sum += plumeAt(col0 + float(k), 0.0, p, cellW, period, chance, t, seed);
      sum += plumeAt(col0 + float(k), 1.0, p, cellW, period, chance, t, seed);
    }
    return sum;
  }

  void main() {
    float t = uTime;

    // Footprint: read the pressure field and its slope. Sand is shoved
    // outward from the print (we sample from nearer the centre), the centre
    // thins, and the displaced sand piles up along the rim.
    float wake = texture2D(tWake, vUv).r;
    vec2 gx = vec2(uWakeTexel.x, 0.0);
    vec2 gy = vec2(0.0, uWakeTexel.y);
    vec2 slope = vec2(
      texture2D(tWake, vUv + gx).r - texture2D(tWake, vUv - gx).r,
      texture2D(tWake, vUv + gy).r - texture2D(tWake, vUv - gy).r
    ) / (2.0 * uSize * uWakeTexel);
    vec2 shove = slope * ${WAKE.push}.0;
    float rim = clamp(length(shove) / 24.0, 0.0, 1.0);
    vec2 px = vUv * uSize + shove;
    // Sand streams away from the middle of the word on both sides.
    float side = clamp((px.x - uCenterX) / 110.0, -1.0, 1.0);
    float blendR = 0.5 + 0.5 * side;
    float shift = t * ${FLOW_PX_PER_SECOND.toFixed(1)};
    // Grains churn inside the print.
    float evolve = t * 0.12 + wake * 0.9;

    // ---- Outer wisps (SVG #sands-wisps-outer) ----------------------------
    // Undo the layer's CSS transform so the filter runs in its own space.
    vec2 mo = uOrigin + (px - uOrigin) / vec2(${OUTER.scaleX}, ${OUTER.scaleY});
    vec2 fineFreq = vec2(0.0095, 0.06);
    vec2 fineRG = vec2(
      flow3(mo, fineFreq, evolve, 3.1, shift, blendR),
      flow3(mo, fineFreq, evolve, 57.3, shift, blendR)
    );
    // feDisplacementMap (scale 30 in the SVG) stretched sideways so the
    // displaced edges tear into horizontal strands.
    vec2 md = mo + vec2(48.0, 26.0) * (fineRG - 0.5);
    float soft = maskAt(md, 0);
    // Long ridges erode the halo so its top and bottom edges are strands
    // rather than straight lines.
    float ridgeLong = 1.0 - abs(flow3(md, vec2(0.003, 0.085), evolve * 0.5, 61.2, shift * 1.1, blendR) * 2.0 - 1.0);
    soft *= 0.5 + 0.65 * smoothstep(0.15, 0.95, ridgeLong);
    // Concentrate the sand against the letters: steepen the halo falloff so
    // it is dense at the glyphs and only sparse strands reach further out.
    soft = pow(soft, 2.1);
    float fineA = flow3(md, fineFreq, evolve, 91.7, shift, blendR);
    float macroA = flow2(md, vec2(0.0045, 0.016), evolve * 0.5, 13.9, shift * 0.6, blendR);
    // feComposite arithmetic k1=2.2, then k1=2.6 (each step clamps).
    float a = min(1.0, 2.2 * soft * fineA);
    a = min(1.0, 2.6 * a * macroA);
    // feComponentTransfer slope=3 intercept=-0.12
    float outerA = clamp(3.0 * a - 0.12, 0.0, 1.0) * ${OUTER.opacity};
    // Horizontal streaks carved through the wisps.
    float ridge = 1.0 - abs(flow3(md, vec2(0.0045, 0.11), evolve * 0.7, 23.5, shift * 1.25, blendR) * 2.0 - 1.0);
    outerA *= 0.55 + 0.6 * smoothstep(0.2, 1.0, ridge);

    // ---- Inner burn (SVG #sands-wisps-inner) -----------------------------
    vec2 mi = uOrigin + (px - uOrigin) / vec2(${INNER.scaleX}, ${INNER.scaleY});
    vec2 innerFreq = vec2(0.022, 0.055);
    vec2 nz = vec2(
      flow3(mi, innerFreq, evolve * 1.3, 5.1, shift * 0.8, blendR),
      flow3(mi, innerFreq, evolve * 1.3, 43.9, shift * 0.8, blendR)
    );
    vec2 mid = mi + vec2(30.0, 16.0) * (nz - 0.5);
    float innerA = maskAt(mid, 1) * ${INNER.opacity};
    innerA *= 0.8 + 0.25 * smoothstep(0.2, 1.0, ridge);

    // ---- Composite inner over outer (flood colours from the SVG) ---------
    vec3 outerCol = uOuterCol;
    vec3 innerCol = uInnerCol;
    float alpha = innerA + outerA * (1.0 - innerA);
    vec3 col = (innerCol * innerA + outerCol * outerA * (1.0 - innerA)) / max(alpha, 1e-4);
    // ---- Falling dust ------------------------------------------------------
    // A few random plumes under the word, drawn beneath the halo.
    vec2 pr = vUv * uSize;
    float dust = plumeLayer(pr, 36.0, 5.5, 0.26, t, 1.0)
               + plumeLayer(pr, 54.0, 8.0, 0.24, t, 2.0)
               + plumeLayer(pr, 25.0, 10.0, 0.18, t, 3.0);
    // Dust shaken loose by hovering, from the advected density field.
    float shake = texture2D(tWake, vUv).g;
    vec2 sq = vec2(pr.x, pr.y + t * ${DUST.shakeSpeed}.0);
    float shakeGrains = grainField(sq, 4.0, 0.55, 3.0)
                      + 0.7 * grainField(sq * vec2(1.0, 0.85) + 29.0, 7.0, 0.4, 5.0);
    float shakeClump = smoothstep(0.25, 0.7, fractal2(vec3(pr.x * 0.12, sq.y * 0.05, 1.7)));
    float shakeA = smoothstep(0.02, 0.5, shake) * min(shakeGrains, 1.0) * shakeClump * ${DUST.shakeOpacity};
    float dustA = clamp((dust * ${DUST.opacity} + shakeA) * uDustBoost, 0.0, 1.0);
    vec3 dustCol = uDustCol;

    // Under the foot the sand thins a little and turns the deep, sun-baked
    // amber of dune sand; the shoved-up rim gets the strongest tint.
    vec3 sahara = vec3(0.89, 0.50, 0.13); // #e3802*
    alpha *= 1.0 - ${WAKE.depth} * wake;
    col = mix(col, sahara, clamp(wake * 0.6 + rim * ${WAKE.rim}, 0.0, 0.85));

    // Halo over dust.
    float outA = alpha + dustA * (1.0 - alpha);
    vec3 outCol = (col * alpha + dustCol * dustA * (1.0 - alpha)) / max(outA, 1e-4);
    // Premultiplied output: the canvas is composited as premultiplied
    // alpha, which is also what the view-transition snapshot assumes. A
    // straight-alpha canvas picked up dark fringes around the soft sand
    // whenever the title was captured for a page transition.
    gl_FragColor = vec4(outCol * outA, outA);
  }
`

// --- CPU mask helpers -------------------------------------------------------

/** Separable square dilation (max filter), like feMorphology dilate. */
function dilate(src: Float32Array, w: number, h: number, r: number) {
  if (r <= 0) return src
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0
      for (let k = -r; k <= r; k++) {
        const xx = x + k
        if (xx >= 0 && xx < w) m = Math.max(m, src[y * w + xx])
      }
      tmp[y * w + x] = m
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0
      for (let k = -r; k <= r; k++) {
        const yy = y + k
        if (yy >= 0 && yy < h) m = Math.max(m, tmp[yy * w + x])
      }
      out[y * w + x] = m
    }
  }
  return out
}

function gaussianKernel(sigma: number) {
  const r = Math.max(1, Math.ceil(sigma * 3))
  const k = new Float32Array(r * 2 + 1)
  let sum = 0
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma))
    k[i + r] = v
    sum += v
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum
  return { k, r }
}

/** Separable Gaussian blur with independent x and y sigmas (feGaussianBlur). */
function blur(src: Float32Array, w: number, h: number, sx: number, sy: number) {
  const { k: kx, r: rx } = gaussianKernel(sx)
  const { k: ky, r: ry } = gaussianKernel(sy)
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let i = -rx; i <= rx; i++) {
        const xx = x + i
        if (xx >= 0 && xx < w) s += src[y * w + xx] * kx[i + rx]
      }
      tmp[y * w + x] = s
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let i = -ry; i <= ry; i++) {
        const yy = y + i
        if (yy >= 0 && yy < h) s += tmp[yy * w + x] * ky[i + ry]
      }
      out[y * w + x] = s
    }
  }
  return out
}

/**
 * Belt and braces for browsers that hand out a software GL context without
 * flagging the performance caveat: read the unmasked renderer string and
 * bail on the known CPU rasterisers.
 */
function isSoftwareRenderer(renderer: THREE.WebGLRenderer) {
  const gl = renderer.getContext()
  const info = gl.getExtension("WEBGL_debug_renderer_info")
  const name = info
    ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
    : String(gl.getParameter(gl.RENDERER))
  return /swiftshader|llvmpipe|softpipe|software|mesa offscreen/i.test(name)
}

export function initSandsTitle(root: HTMLElement) {
  // Guard against double init (e.g. dev-server hot reloads re-running the
  // component script), which would stack a second renderer on the title.
  if (root.dataset.sandsInit) return
  root.dataset.sandsInit = "1"

  const letters = root.querySelector<HTMLElement>("[data-sands-letters]")
  const host = root.querySelector<HTMLElement>("[data-sands-field]")
  if (!letters || !host) return

  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches

  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      powerPreference: "high-performance",
      // Refuse a context the browser would have to software-render (no GPU,
      // hardware acceleration off, remote desktops, headless audits). The
      // shader ports an SVG filter chain and is far too heavy for a CPU
      // rasteriser; the static SVG wisps are the right answer there.
      failIfMajorPerformanceCaveat: true,
    })
  } catch {
    root.setAttribute("data-sands-static", "") // no WebGL: show the SVG wisps
    return
  }
  if (isSoftwareRenderer(renderer)) {
    renderer.dispose()
    root.setAttribute("data-sands-static", "")
    return
  }
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO) * RESOLUTION_SCALE
  )
  host.replaceChildren(renderer.domElement)

  const maskTexture = new THREE.DataTexture(new Uint8Array(4), 1, 1)
  maskTexture.minFilter = THREE.LinearFilter
  maskTexture.magFilter = THREE.LinearFilter
  maskTexture.generateMipmaps = false
  maskTexture.wrapS = maskTexture.wrapT = THREE.ClampToEdgeWrapping
  maskTexture.flipY = true

  const uniforms = {
    tMask: { value: maskTexture },
    tWake: { value: null as THREE.Texture | null },
    uWakeTexel: { value: new THREE.Vector2(1, 1) },
    uSize: { value: new THREE.Vector2(1, 1) },
    uOrigin: { value: new THREE.Vector2() },
    uCenterX: { value: 0 },
    uGlyphY: { value: 0 },
    uGlyphBottom: { value: 0 },
    uTime: { value: 0 },
    uHover: { value: 0 },
    uOuterCol: { value: new THREE.Vector3() },
    uInnerCol: { value: new THREE.Vector3() },
    uDustCol: { value: new THREE.Vector3() },
    uDustBoost: { value: 1 },
  }
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending,
      premultipliedAlpha: true, // ONE, ONE_MINUS_SRC_ALPHA: the shader premultiplies
    })
  )
  quad.frustumCulled = false
  scene.add(quad)

  // Pressure buffer, ping-ponged between two half-float targets.
  const wakeUniforms = {
    tPrev: { value: null as THREE.Texture | null },
    uTexel: { value: new THREE.Vector2(1, 1) },
    uSize: { value: new THREE.Vector2(1, 1) },
    uMouse: { value: new THREE.Vector2(-9999, -9999) },
    uPrevMouse: { value: new THREE.Vector2(-9999, -9999) },
    uDt: { value: 0 },
    uHover: { value: 0 },
    uTime: { value: 0 },
    uGlyphY: { value: 0 },
    uEmitY: { value: 0 },
  }
  const wakeScene = new THREE.Scene()
  const wakeQuad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: wakeUniforms,
      vertexShader: VERTEX,
      fragmentShader: WAKE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    })
  )
  wakeQuad.frustumCulled = false
  wakeScene.add(wakeQuad)
  let wakeTargets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null =
    null
  let wakeIndex = 0

  function rebuildWake(width: number, height: number) {
    wakeTargets?.forEach((t) => t.dispose())
    // Reference px, like everything else the shaders see.
    const w = Math.max(1, Math.round((width / unit) * WAKE.scale))
    const h = Math.max(1, Math.round((height / unit) * WAKE.scale))
    const make = () =>
      new THREE.WebGLRenderTarget(w, h, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
      })
    wakeTargets = [make(), make()]
    for (const t of wakeTargets) {
      renderer.setRenderTarget(t)
      renderer.clear()
    }
    renderer.setRenderTarget(null)
    wakeIndex = 0
    wakeUniforms.uTexel.value.set(1 / w, 1 / h)
    wakeUniforms.uSize.value.set(width / unit, height / unit)
    uniforms.uWakeTexel.value.set(1 / w, 1 / h)
    uniforms.tWake.value = wakeTargets[0].texture
  }

  function updateWake(dt: number) {
    if (!wakeTargets) return
    const prev = wakeTargets[wakeIndex]
    const next = wakeTargets[1 - wakeIndex]
    wakeUniforms.tPrev.value = prev.texture
    wakeUniforms.uDt.value = dt
    wakeUniforms.uHover.value = hoverAmount
    wakeUniforms.uTime.value = elapsed
    wakeUniforms.uGlyphY.value = uniforms.uGlyphY.value
    wakeUniforms.uEmitY.value = uniforms.uGlyphBottom.value + 8
    wakeUniforms.uMouse.value.copy(mouse)
    wakeUniforms.uPrevMouse.value.copy(prevMouse)
    renderer.setRenderTarget(next)
    renderer.render(wakeScene, camera)
    renderer.setRenderTarget(null)
    wakeIndex = 1 - wakeIndex
    uniforms.tWake.value = next.texture
    prevMouse.copy(mouse)
  }

  // --- Theme ----------------------------------------------------------------

  function applyTheme() {
    const dark = document.documentElement.classList.contains("dark")
    const c = dark ? PALETTE.dark : PALETTE.light
    uniforms.uOuterCol.value.fromArray(c.outer)
    uniforms.uInnerCol.value.fromArray(c.inner)
    uniforms.uDustCol.value.fromArray(c.dust)
    uniforms.uDustBoost.value = c.dustBoost
  }
  applyTheme()
  // While the MagicUI theme toggler's view transition runs, the browser
  // shows a frozen snapshot of the old theme next to the live new one. Any
  // motion in between reads as a stutter, so the clock pauses for those
  // few hundred milliseconds and resumes from the same instant.
  let frozen = false
  const themeObserver = new MutationObserver(() => {
    applyTheme()
    frozen = document.documentElement.hasAttribute("data-magicui-theme-vt")
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-magicui-theme-vt"],
  })

  // --- Masks --------------------------------------------------------------

  // Fingerprint of everything the masks depend on. The render loop compares
  // it against the live layout so a device switch, font swap or reflow that
  // slips past the observers still triggers a rebuild.
  let builtFor = ""
  // Current font size relative to the reference; see REFERENCE_FONT_PX.
  let unit = 1
  function layoutKey() {
    const hr = host!.getBoundingClientRect()
    const lr = letters!.getBoundingClientRect()
    const fs = parseFloat(getComputedStyle(letters!).fontSize)
    // Measured in reference px, rounded coarsely: the hero and the nav copy
    // are the same shape at different sizes, so they share a key and moving
    // the title between them costs no mask or wake rebuild.
    const u = fs / REFERENCE_FONT_PX || 1
    const q = (v: number) => Math.round(v / u / 4)
    return [
      q(hr.width),
      q(hr.height),
      q(lr.left - hr.left),
      q(lr.top - hr.top),
      q(lr.width),
      q(lr.height),
    ].join("|")
  }

  function rebuildMasks() {
    const hr = host!.getBoundingClientRect()
    const lr = letters!.getBoundingClientRect()
    const rr = root.getBoundingClientRect()
    const text = letters!.textContent?.trim() ?? ""
    const w = Math.max(1, Math.round(hr.width * MASK_SCALE))
    const h = Math.max(1, Math.round(hr.height * MASK_SCALE))
    if (!text || !hr.width || !hr.height) return

    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) return
    const style = getComputedStyle(letters!)
    unit = parseFloat(style.fontSize) / REFERENCE_FONT_PX || 1
    ctx.scale(MASK_SCALE, MASK_SCALE)
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillStyle = "#fff"
    // The letters box is symmetrically padded, so its centre is the text centre.
    ctx.fillText(
      text,
      lr.left - hr.left + lr.width / 2,
      lr.top - hr.top + lr.height / 2
    )

    const rgba = ctx.getImageData(0, 0, w, h).data
    const glyph = new Float32Array(w * h)
    for (let i = 0; i < w * h; i++) glyph[i] = rgba[i * 4 + 3] / 255

    const s = MASK_SCALE * unit
    const outer = blur(
      dilate(glyph, w, h, Math.round(OUTER.dilate * s)),
      w,
      h,
      OUTER.blurX * s,
      OUTER.blurY * s
    )
    const inner = blur(
      dilate(glyph, w, h, Math.round(INNER.dilate * s)),
      w,
      h,
      INNER.blurX * s,
      INNER.blurY * s
    )

    const data = new Uint8Array(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = Math.round(Math.min(1, outer[i]) * 255)
      data[i * 4 + 1] = Math.round(Math.min(1, inner[i]) * 255)
      data[i * 4 + 2] = Math.round(glyph[i] * 255)
      data[i * 4 + 3] = 255
    }
    // The GPU copy is allocated at a fixed size on first upload; a mask of a
    // different size would be written into a corner of the old allocation
    // and render shrunk and offset. Dispose so it is reallocated.
    if (maskTexture.image.width !== w || maskTexture.image.height !== h) {
      maskTexture.dispose()
    }
    maskTexture.image = {
      data,
      width: w,
      height: h,
    } as typeof maskTexture.image
    maskTexture.needsUpdate = true

    // Positions go to the shader in reference px (CSS px / unit).
    uniforms.uSize.value.set(hr.width / unit, hr.height / unit)
    // Shader space is y-up, so flip the DOM y for the transform origin
    // (CSS transform-origin: 50% 60% of the wisps box, which is the root box).
    uniforms.uOrigin.value.set(
      (rr.left - hr.left + rr.width * 0.5) / unit,
      (hr.height - (rr.top - hr.top + rr.height * 0.6)) / unit
    )
    uniforms.uCenterX.value = (lr.left - hr.left + lr.width / 2) / unit
    uniforms.uGlyphY.value =
      (hr.height - (lr.top - hr.top + lr.height / 2)) / unit
    uniforms.uGlyphBottom.value = (hr.height - (rr.bottom - hr.top)) / unit
    builtFor = layoutKey()
  }

  function resize() {
    const rect = host!.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    renderer.setSize(rect.width, rect.height, false)
    unit =
      parseFloat(getComputedStyle(letters!).fontSize) / REFERENCE_FONT_PX || 1
    // A pure change of scale (hero <-> nav) keeps the masks and the hover
    // buffers: they live in reference space and still fit. Only a real
    // reflow (different text layout, font swap) rebuilds them.
    if (layoutKey() !== builtFor) {
      rebuildMasks()
      try {
        rebuildWake(rect.width, rect.height)
      } catch {
        // No float render targets: the halo still works, just without hover.
        wakeTargets = null
      }
    }
    root.setAttribute("data-sands-gpu", "")
    render()
  }

  // --- Hover + loop ---------------------------------------------------------

  const mouse = new THREE.Vector2(-9999, -9999)
  const prevMouse = new THREE.Vector2(-9999, -9999)
  let hovering = false
  let hoverAmount = 0
  let visible = true
  let raf = 0
  let last = 0
  let elapsed = 0

  function track(event: PointerEvent) {
    const rect = host!.getBoundingClientRect()
    mouse.set(
      (event.clientX - rect.left) / unit,
      (rect.height - (event.clientY - rect.top)) / unit
    )
  }

  if (HOVER_CAPABLE) {
    root.addEventListener("pointerenter", (event) => {
      track(event)
      prevMouse.copy(mouse)
      hovering = true
    })
    root.addEventListener("pointermove", track)
    root.addEventListener("pointerleave", () => {
      hovering = false
    })
  }

  function render() {
    uniforms.uTime.value = elapsed
    uniforms.uHover.value = hoverAmount
    renderer.render(scene, camera)
  }

  let lastLayoutCheck = 0
  function step(now: number) {
    if (!root.isConnected) {
      raf = 0
      return
    }
    const dt = frozen ? 0 : Math.min((now - last) / 1000, 1 / 20) || 1 / 60
    last = now
    elapsed += dt
    if (now - lastLayoutCheck > 250) {
      lastLayoutCheck = now
      if (layoutKey() !== builtFor) resize()
    }
    hoverAmount += ((hovering ? 1 : 0) - hoverAmount) * Math.min(1, dt * 10)
    if (!frozen) updateWake(dt)
    render()
    raf = visible ? requestAnimationFrame(step) : 0
  }

  function start() {
    if (raf || !visible || reducedMotion) return
    last = performance.now()
    raf = requestAnimationFrame(step)
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }

  const visibility = new IntersectionObserver((entries) => {
    // The swap detaches and re-attaches the node; take the latest entry.
    const entry = entries[entries.length - 1]
    visible = entry?.isIntersecting ?? true
    if (visible) start()
    else stop()
  })
  visibility.observe(root)

  // Rebuild after layout has settled (next frame), coalescing bursts.
  let resizeRaf = 0
  function scheduleResize() {
    if (resizeRaf) return
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0
      resize()
    })
  }
  const sizeObserver = new ResizeObserver(scheduleResize)
  sizeObserver.observe(host)
  sizeObserver.observe(root)
  sizeObserver.observe(letters)
  window.addEventListener("resize", scheduleResize)
  window.addEventListener("orientationchange", scheduleResize)
  document.fonts.addEventListener("loadingdone", scheduleResize)
  void document.fonts.ready.then(scheduleResize)
  start()

  // The title is a persisted element: client-side navigation moves this
  // very node between the hero and the nav, so the canvas and clock carry
  // on across pages. Only if it ever ends up detached is everything let go.
  function dispose() {
    stop()
    visibility.disconnect()
    sizeObserver.disconnect()
    themeObserver.disconnect()
    window.removeEventListener("resize", scheduleResize)
    window.removeEventListener("orientationchange", scheduleResize)
    document.fonts.removeEventListener("loadingdone", scheduleResize)
    renderer.dispose()
  }
  document.addEventListener("astro:page-load", function check() {
    if (root.isConnected) return
    document.removeEventListener("astro:page-load", check)
    dispose()
  })
  // The swap drops the node into a slot of a different size. Resize right
  // away, inside the swap, rather than a frame later via the observers, so
  // the view transition never shows a stretched frame.
  document.addEventListener("astro:after-swap", function onSwap() {
    if (!root.isConnected) {
      document.removeEventListener("astro:after-swap", onSwap)
      return
    }
    resize()
  })
}
