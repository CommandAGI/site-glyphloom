// Character art: RGBA pixels in, a grid of characters with their colours out, and the writers of each export.
// Pure: no DOM, no network. It runs in a browser and in Node. `paint` draws on a canvas context that the caller owns.
// One file: packages/domain/world/character-art.js in CommandAGI (the host's `character_art` tool) is the source, and
// Glyphloom's site carries it byte for byte as glyphloom.js (tests/workbench/character-art.test.mjs holds them equal).
//
//   const grid = render({ width, height, data }, { columns: 80, charset: "simple", dither: "floyd-steinberg" });
//   toText(grid); toAnsi(grid); toHtml(grid); toAnimatedHtml([grid, …], { fps }); paint(ctx, grid);

/** Character sets, each ordered from the least ink to the most. `braille` is drawn as dots, not from a ramp. */
export const CHARSETS = {
  simple: " .:-=+*#%@",
  detailed: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  blocks: " ░▒▓█",
  binary: " 01",
  braille: "braille",
};

export const DITHERS = ["none", "floyd-steinberg", "atkinson", "ordered"];
export const COLORS = ["none", "ansi16", "ansi256", "truecolor"];

export const DEFAULTS = {
  columns: 100,
  charAspect: 0.5, // a character cell's width over its height
  charset: "simple",
  custom: "",
  paper: "dark", // the background the art is shown on: ink is light on dark paper, dark on light paper
  invert: false,
  brightness: 0, // -1 … 1
  contrast: 1, // 0 … 3
  gamma: 1, // 0.2 … 3
  dither: "none",
  color: "none",
  colorTarget: "fg", // "fg": the character carries the colour; "bg": the cell behind it does
  // Post effects, 0 (off) … 1, drawn over the art by paint and the HTML exports, never into the characters.
  scanlines: 0, // dark lines across, as on a cathode-ray screen
  bloom: 0, // the ink glows into the paper around it
  halftone: 0, // each cell seen through a round dot
};

/** The post effects: each an option from 0 (off) to 1. */
export const EFFECTS = ["scanlines", "bloom", "halftone"];

// xterm's 16 colours.
export const ANSI16 = [
  [0, 0, 0], [205, 0, 0], [0, 205, 0], [205, 205, 0], [0, 0, 238], [205, 0, 205], [0, 205, 205], [229, 229, 229],
  [127, 127, 127], [255, 0, 0], [0, 255, 0], [255, 255, 0], [92, 92, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
];
const CUBE = [0, 95, 135, 175, 215, 255];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** The nearest of the 16 colours: its index. */
export function nearest16(rgb) {
  let best = 0;
  for (let i = 1; i < 16; i++) if (dist2(rgb, ANSI16[i]) < dist2(rgb, ANSI16[best])) best = i;
  return best;
}

/** The colour of an index of the 256-colour palette. */
export function color256(i) {
  if (i < 16) return ANSI16[i];
  if (i >= 232) {
    const v = 8 + 10 * (i - 232);
    return [v, v, v];
  }
  const n = i - 16;
  return [CUBE[Math.floor(n / 36)], CUBE[Math.floor(n / 6) % 6], CUBE[n % 6]];
}

/** The nearest index of the 256-colour palette, from its cube and its grey ramp (never 0–15: terminals restyle them). */
export function nearest256(rgb) {
  const level = (v) => {
    let best = 0;
    for (let i = 1; i < 6; i++) if (Math.abs(CUBE[i] - v) < Math.abs(CUBE[best] - v)) best = i;
    return best;
  };
  const cube = 16 + 36 * level(rgb[0]) + 6 * level(rgb[1]) + level(rgb[2]);
  const avg = (rgb[0] + rgb[1] + rgb[2]) / 3;
  const grey = 232 + Math.max(0, Math.min(23, Math.round((avg - 8) / 10)));
  return dist2(rgb, color256(grey)) < dist2(rgb, color256(cube)) ? grey : cube;
}

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

// Error diffusion kernels: [dx, dy, weight].
const KERNELS = {
  "floyd-steinberg": [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]],
  atkinson: [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]],
};

/**
 * The source sampled on a w×h grid: the mean colour of the pixels under each sample, composited over the paper.
 * → { rgb: Float32Array(w*h*3) in 0…255 }
 */
function sample(image, w, h, paperRgb) {
  const { width, height, data } = image;
  const rgb = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / w));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = y0; sy < y1 && sy < height; sy++)
        for (let sx = x0; sx < x1 && sx < width; sx++) {
          const i = (sy * width + sx) * 4;
          const a = data[i + 3] / 255;
          r += data[i] * a + paperRgb[0] * (1 - a);
          g += data[i + 1] * a + paperRgb[1] * (1 - a);
          b += data[i + 2] * a + paperRgb[2] * (1 - a);
          n++;
        }
      const o = (y * w + x) * 3;
      rgb[o] = n ? r / n : paperRgb[0];
      rgb[o + 1] = n ? g / n : paperRgb[1];
      rgb[o + 2] = n ? b / n : paperRgb[2];
    }
  }
  return rgb;
}

/** Each sample's ink, 0…1, after tone. */
function inkOf(rgb, n, o) {
  const ink = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = (0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2]) / 255;
    v = clamp01((v - 0.5) * o.contrast + 0.5 + o.brightness);
    v = Math.pow(v, 1 / o.gamma);
    let k = o.paper === "dark" ? v : 1 - v;
    if (o.invert) k = 1 - k;
    ink[i] = k;
  }
  return ink;
}

/** Ink quantized to `levels` steps (0 … levels-1), dithered in place. */
function quantize(ink, w, h, levels, method) {
  const out = new Uint8Array(w * h);
  const top = levels - 1;
  if (method === "ordered") {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const t = (BAYER4[y & 3][x & 3] + 0.5) / 16 - 0.5;
        out[y * w + x] = Math.max(0, Math.min(top, Math.round(ink[y * w + x] * top + t)));
      }
    return out;
  }
  const kernel = KERNELS[method];
  const v = Float32Array.from(ink);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const q = Math.max(0, Math.min(top, Math.round(v[i] * top)));
      out[i] = q;
      if (!kernel) continue;
      const err = v[i] - q / top;
      for (const [dx, dy, wt] of kernel) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < w && ny < h) v[ny * w + nx] += err * wt;
      }
    }
  return out;
}

function cellColor(rgb, mode) {
  if (mode === "ansi16") {
    const code = nearest16(rgb);
    return { code, color: ANSI16[code] };
  }
  if (mode === "ansi256") {
    const code = nearest256(rgb);
    return { code, color: color256(code) };
  }
  if (mode === "truecolor") return { code: null, color: rgb.map((c) => Math.round(c)) };
  return { code: null, color: null };
}

// Braille: the bit of each dot, by [x][y] in the 2×4 cell (Unicode's dot numbering).
const BRAILLE_BITS = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
];

/**
 * Render an image. `image` is `{ width, height, data }` with RGBA bytes (an ImageData has this shape).
 * → { columns, rows, chars: string[] (one per row), colors: (null | [r,g,b])[] , codes: (null | number)[], options }
 */
export function render(image, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const columns = Math.max(1, Math.round(o.columns));
  const cellW = image.width / columns;
  const rows = Math.max(1, Math.round(image.height / (cellW / o.charAspect)));
  const paperRgb = o.paper === "dark" ? [0, 0, 0] : [255, 255, 255];
  const braille = o.charset === "braille";
  let ramp = braille ? null : Array.from(o.charset === "custom" ? o.custom || CHARSETS.simple : CHARSETS[o.charset] ?? CHARSETS.simple);
  if (ramp && ramp.length < 2) ramp = [" ", ...ramp]; // one character alone has no steps: it is the ink, space the paper
  const chars = [];
  const colors = [];
  const codes = [];

  if (braille) {
    const w = columns * 2, h = rows * 4;
    const rgb = sample(image, w, h, paperRgb);
    const dots = quantize(inkOf(rgb, w * h, o), w, h, 2, o.dither);
    for (let y = 0; y < rows; y++) {
      let line = "";
      for (let x = 0; x < columns; x++) {
        let bits = 0;
        const sum = [0, 0, 0];
        for (let dx = 0; dx < 2; dx++)
          for (let dy = 0; dy < 4; dy++) {
            const i = (y * 4 + dy) * w + x * 2 + dx;
            if (dots[i]) bits |= BRAILLE_BITS[dx][dy];
            for (let c = 0; c < 3; c++) sum[c] += rgb[i * 3 + c] / 8;
          }
        line += String.fromCharCode(0x2800 + bits);
        const { code, color } = cellColor(sum, o.color);
        colors.push(color);
        codes.push(code);
      }
      chars.push(line);
    }
  } else {
    const rgb = sample(image, columns, rows, paperRgb);
    const q = quantize(inkOf(rgb, columns * rows, o), columns, rows, ramp.length, o.dither);
    for (let y = 0; y < rows; y++) {
      let line = "";
      for (let x = 0; x < columns; x++) {
        const i = y * columns + x;
        line += ramp[q[i]];
        const { code, color } = cellColor([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]], o.color);
        colors.push(color);
        codes.push(code);
      }
      chars.push(line);
    }
  }
  return { columns, rows, chars, colors, codes, options: o };
}

/** Plain text: one line per row. */
export function toText(grid) {
  return grid.chars.join("\n") + "\n";
}

function sgr(grid, i) {
  const { color: mode, colorTarget } = grid.options;
  const bg = colorTarget === "bg";
  const code = grid.codes[i];
  if (mode === "ansi16") return bg ? (code < 8 ? 40 + code : 100 + code - 8) : code < 8 ? 30 + code : 90 + code - 8;
  if (mode === "ansi256") return `${bg ? 48 : 38};5;${code}`;
  if (mode === "truecolor") return `${bg ? 48 : 38};2;${grid.colors[i].join(";")}`;
  return null;
}

/** ANSI text for a terminal: an escape where the colour changes, a reset at the end of each line. */
export function toAnsi(grid) {
  if (grid.options.color === "none") return toText(grid);
  let out = "";
  for (let y = 0; y < grid.rows; y++) {
    const cells = Array.from(grid.chars[y]);
    let last = null;
    for (let x = 0; x < cells.length; x++) {
      const s = String(sgr(grid, y * grid.columns + x));
      if (s !== last) out += `\x1b[${s}m`;
      last = s;
      out += cells[x];
    }
    out += "\x1b[0m\n";
  }
  return out;
}

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const hex = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/** The inner HTML of a <pre>: runs of one colour in one span. */
export function toSpans(grid) {
  if (grid.options.color === "none") return escapeHtml(grid.chars.join("\n"));
  const prop = grid.options.colorTarget === "bg" ? "background" : "color";
  const lines = [];
  for (let y = 0; y < grid.rows; y++) {
    const cells = Array.from(grid.chars[y]);
    let html = "", run = "", last = null;
    const flush = () => {
      if (run) html += `<span style="${prop}:${last}">${escapeHtml(run)}</span>`;
      run = "";
    };
    for (let x = 0; x < cells.length; x++) {
      const c = hex(grid.colors[y * grid.columns + x]);
      if (c !== last) flush();
      last = c;
      run += cells[x];
    }
    flush();
    lines.push(html);
  }
  return lines.join("\n");
}

const strength = (o, name) => Math.max(0, Math.min(1, Number(o[name]) || 0));

/**
 * The post effects as CSS rules for `sel`, the element that holds the art (a <pre>). A cell is `--cell-w` wide and
 * `--cell-h` tall (default 1ch and 1em): the halftone has one dot a cell. Empty when every effect is off.
 */
export function effectCss(options, sel = "pre") {
  const o = { ...DEFAULTS, ...options };
  const bloom = strength(o, "bloom"), lines = strength(o, "scanlines"), dots = strength(o, "halftone");
  const rules = [];
  if (bloom) rules.push(`${sel} { text-shadow: 0 0 ${(1 + 3 * bloom).toFixed(2)}px currentColor, 0 0 ${(4 + 10 * bloom).toFixed(2)}px currentColor; }`);
  if (dots) {
    const r = Math.round(100 - 45 * dots);
    const mask = `radial-gradient(circle closest-side, #000 ${r}%, rgba(0,0,0,${(1 - dots).toFixed(2)}) ${Math.min(100, r + 6)}%)`;
    rules.push(`${sel} { -webkit-mask-image: ${mask}; mask-image: ${mask}; -webkit-mask-size: var(--cell-w, 1ch) var(--cell-h, 1em); mask-size: var(--cell-w, 1ch) var(--cell-h, 1em); }`);
  }
  if (lines) {
    const shade = `rgba(0,0,0,${((o.paper === "dark" ? 0.65 : 0.3) * lines).toFixed(2)})`;
    rules.push(`${sel} { background-image: repeating-linear-gradient(to bottom, ${shade} 0 1px, transparent 1px 3px); background-attachment: local; }`);
  }
  return rules.join("\n");
}

const htmlPage = ({ title, dark, fontSize, css, body }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  html, body { margin: 0; background: ${dark ? "#000" : "#fff"}; color: ${dark ? "#e8e8e8" : "#111"}; }
  pre { margin: 0; padding: 16px; font: ${fontSize}px/1 ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace; letter-spacing: 0; overflow: auto; }
${css}
</style>
</head>
<body>
${body}
</body>
</html>
`;

/** One self-contained HTML file of the art. */
export function toHtml(grid, { title = "Character art", fontSize = 10 } = {}) {
  return htmlPage({ title, dark: grid.options.paper === "dark", fontSize, css: effectCss(grid.options), body: `<pre>${toSpans(grid)}</pre>` });
}

/**
 * One self-contained HTML file of moving art: the frames in turn at `fps`, looped, by CSS alone (no script, so it plays
 * under a policy that forbids scripts). The first grid's options (paper, effects) are the file's.
 */
export function toAnimatedHtml(grids, { title = "Character art", fontSize = 10, fps = 10 } = {}) {
  if (!grids.length) throw new Error("an animation has at least one frame");
  const n = grids.length, period = n / fps;
  const css = [
    "  .frames { display: grid; }",
    `  .frames > pre { grid-area: 1 / 1; visibility: hidden; animation: frame ${period.toFixed(3)}s step-end infinite; }`,
    `  @keyframes frame { 0% { visibility: visible; } ${(100 / n).toFixed(4)}% { visibility: hidden; } }`,
    "  @media (prefers-reduced-motion: reduce) { .frames > pre { animation: none; } .frames > pre:first-child { visibility: visible; } }",
    effectCss(grids[0].options, ".frames > pre"),
  ].join("\n");
  // Frame k shows while the time since the start, modulo the period, is in [k/fps, (k+1)/fps): a delay of k/fps, made
  // negative by one period so that every frame runs from the first moment.
  const frames = grids.map((g, k) => `<pre style="animation-delay:${((k - n) / fps).toFixed(3)}s">${toSpans(g)}</pre>`);
  return htmlPage({ title, dark: grids[0].options.paper === "dark", fontSize, css, body: `<div class="frames">\n${frames.join("\n")}\n</div>` });
}

/**
 * Draw the art on a 2D canvas context of the caller's (for a PNG). `cell` is the cell's width in pixels; the height
 * follows the character aspect. Sets the canvas size.
 */
export function paint(ctx, grid, { cell = 8 } = {}) {
  const { charAspect, paper, color, colorTarget } = grid.options;
  const cw = cell, ch = Math.round(cell / charAspect);
  const canvas = ctx.canvas;
  canvas.width = grid.columns * cw;
  canvas.height = grid.rows * ch;
  const ink = paper === "dark" ? "#e8e8e8" : "#111111";
  ctx.fillStyle = paper === "dark" ? "#000000" : "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${ch}px ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace`;
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  for (let y = 0; y < grid.rows; y++) {
    const cells = Array.from(grid.chars[y]);
    for (let x = 0; x < cells.length; x++) {
      const c = grid.colors[y * grid.columns + x];
      if (color !== "none" && colorTarget === "bg") {
        ctx.fillStyle = hex(c);
        ctx.fillRect(x * cw, y * ch, cw, ch);
      }
      if (cells[x] === " " || cells[x] === "⠀") continue;
      ctx.fillStyle = color !== "none" && colorTarget === "fg" ? hex(c) : ink;
      // Scale each glyph to the cell: a monospace face is wider than half its height in most fonts.
      ctx.save();
      ctx.translate(x * cw + cw / 2, y * ch);
      const m = ctx.measureText(cells[x]).width || cw;
      ctx.scale(Math.min(1, cw / m), 1);
      ctx.fillText(cells[x], 0, 0);
      ctx.restore();
    }
  }
  paintEffects(ctx, grid.options, cw, ch);
}

/** The post effects over what paint drew, as effectCss draws them over a <pre>. */
function paintEffects(ctx, o, cw, ch) {
  const { width, height } = ctx.canvas;
  const dark = o.paper === "dark";
  const bloom = strength(o, "bloom"), lines = strength(o, "scanlines"), dots = strength(o, "halftone");
  ctx.save();
  if (bloom) {
    // The art over itself, blurred: added light on dark paper, multiplied ink on light paper.
    ctx.filter = `blur(${(2 + 6 * bloom).toFixed(1)}px)`;
    ctx.globalCompositeOperation = dark ? "lighter" : "multiply";
    ctx.globalAlpha = 0.35 + 0.5 * bloom;
    ctx.drawImage(ctx.canvas, 0, 0);
    ctx.filter = "none";
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }
  if (dots) {
    // Paper over each cell outside its dot.
    const r = (Math.min(cw, ch) / 2) * (1 - 0.45 * dots);
    ctx.fillStyle = dark ? `rgba(0,0,0,${dots})` : `rgba(255,255,255,${dots})`;
    ctx.beginPath();
    for (let y = 0; y < height; y += ch)
      for (let x = 0; x < width; x += cw) {
        ctx.rect(x, y, cw, ch);
        ctx.moveTo(x + cw / 2 + r, y + ch / 2);
        ctx.arc(x + cw / 2, y + ch / 2, r, 0, Math.PI * 2);
      }
    ctx.fill("evenodd");
  }
  if (lines) {
    ctx.fillStyle = `rgba(0,0,0,${((dark ? 0.65 : 0.3) * lines).toFixed(2)})`;
    for (let y = 0; y < height; y += 3) ctx.fillRect(0, y, width, 1);
  }
  ctx.restore();
}
