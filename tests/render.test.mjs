// The renderer's rules, on images made here. Run: node --test tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import { CHARSETS, effectCss, render, toAnimatedHtml, toAnsi, toHtml, toText, nearest256, color256 } from "../glyphloom.js";

const image = (width, height, at) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = at(x, y);
      data.set([r, g, b, a], (y * width + x) * 4);
    }
  return { width, height, data };
};
const flat = (v) => image(40, 40, () => [v, v, v]);

test("white on dark paper is the densest character, black the lightest; light paper reverses it", () => {
  for (const charset of ["simple", "detailed", "blocks", "binary"]) {
    const ramp = Array.from(CHARSETS[charset]);
    const chars = (img, o) => new Set(render(img, { columns: 10, charset, ...o }).chars.join(""));
    assert.deepEqual(chars(flat(255), { paper: "dark" }), new Set([ramp.at(-1)]), charset);
    assert.deepEqual(chars(flat(0), { paper: "dark" }), new Set([ramp[0]]), charset);
    assert.deepEqual(chars(flat(0), { paper: "light" }), new Set([ramp.at(-1)]), charset);
    assert.deepEqual(chars(flat(255), { paper: "light", invert: true }), new Set([ramp.at(-1)]), charset);
  }
});

test("a gradient's ink never falls from left to right", () => {
  const ramp = CHARSETS.detailed;
  const grid = render(image(300, 30, (x) => [x * 0.85, x * 0.85, x * 0.85]), { columns: 60, charset: "detailed" });
  for (const line of grid.chars) {
    const levels = Array.from(line).map((c) => ramp.indexOf(c));
    for (let i = 1; i < levels.length; i++) assert.ok(levels[i] >= levels[i - 1], line);
  }
});

test("the grid's height follows the image and the character aspect", () => {
  const grid = render(image(200, 100, () => [0, 0, 0]), { columns: 50, charAspect: 0.5 });
  assert.equal(grid.columns, 50);
  assert.equal(grid.rows, 13); // 100 px / (4 px wide cell / 0.5) = 12.5
  assert.ok(grid.chars.every((l) => Array.from(l).length === 50));
});

test("Floyd–Steinberg and ordered dithering on mid grey ink about half the binary cells", () => {
  for (const dither of ["floyd-steinberg", "atkinson", "ordered"]) {
    const grid = render(flat(128), { columns: 40, charAspect: 1, charset: "custom", custom: "#", dither });
    const text = grid.chars.join("");
    const share = [...text].filter((c) => c === "#").length / text.length;
    assert.ok(share > 0.4 && share < 0.6, `${dither}: ${share}`);
  }
  const none = render(flat(100), { columns: 40, charAspect: 1, charset: "custom", custom: "#" }).chars.join("");
  assert.ok(/^ +$/.test(none), "without dithering a flat grey below half is all paper");
});

test("braille dots follow the pixels under each cell", () => {
  // A 2×4 cell: the left column lit, the right dark.
  const grid = render(image(2, 4, (x) => (x === 0 ? [255, 255, 255] : [0, 0, 0])), { columns: 1, charAspect: 0.5, charset: "braille" });
  assert.equal(grid.chars[0], String.fromCharCode(0x2800 + 0x01 + 0x02 + 0x04 + 0x40));
});

test("colour: ANSI 16 on red, 256 and full colour escapes, a reset on each line", () => {
  const red = image(20, 20, () => [250, 10, 10]);
  const a16 = toAnsi(render(red, { columns: 4, color: "ansi16" }));
  assert.match(a16, /^\x1b\[91m/);
  assert.equal(a16.split("\n").filter(Boolean).every((l) => l.endsWith("\x1b[0m")), true);
  assert.match(toAnsi(render(red, { columns: 4, color: "ansi256", colorTarget: "bg" })), /\x1b\[48;5;196m/);
  assert.match(toAnsi(render(red, { columns: 4, color: "truecolor" })), /\x1b\[38;2;250;10;10m/);
  assert.equal(toAnsi(render(red, { columns: 4 })), toText(render(red, { columns: 4 })));
  assert.equal(nearest256([128, 128, 128]), 244);
  assert.deepEqual(color256(196), [255, 0, 0]);
});

test("transparent pixels are paper", () => {
  const clear = image(10, 10, () => [255, 255, 255, 0]);
  assert.ok(/^ +$/.test(render(clear, { columns: 5, paper: "dark" }).chars.join("")));
});

test("the HTML export holds the same characters as the text, escaped", () => {
  const grid = render(image(60, 60, (x, y) => [(x * 4) % 255, (y * 4) % 255, 120]), { columns: 30, charset: "detailed", color: "truecolor" });
  const html = toHtml(grid, { title: "a <test>" });
  assert.match(html, /<title>a &lt;test&gt;<\/title>/);
  const pre = html.slice(html.indexOf("<pre>") + 5, html.indexOf("</pre>"));
  const text = pre.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  assert.equal(text + "\n", toText(grid));
});

test("moving art: each frame's characters, shown one at a time, in order, by CSS alone", () => {
  const frames = [0, 128, 255].map((v) => render(flat(v), { columns: 4, charAspect: 1 }));
  const html = toAnimatedHtml(frames, { fps: 10, title: "three greys" });
  assert.ok(!/<script/i.test(html), "no script");
  const pres = [...html.matchAll(/<pre style="animation-delay:(-?[\d.]+)s">([^<]*)<\/pre>/g)];
  assert.deepEqual(pres.map((m) => m[2] + "\n"), frames.map(toText));
  // Frame k starts k tenths of a second into a 0.3 s loop: delays of -0.3, -0.2, -0.1.
  assert.deepEqual(pres.map((m) => Number(m[1])), [-0.3, -0.2, -0.1]);
  assert.match(html, /animation: frame 0\.300s step-end infinite/);
  assert.match(html, /@keyframes frame \{ 0% \{ visibility: visible; \} 33\.3333% \{ visibility: hidden; \} \}/);
  assert.throws(() => toAnimatedHtml([]), /at least one frame/);
});

test("effects are drawn over the art and never change its characters", () => {
  const img = image(60, 60, (x, y) => [(x * 4) % 255, (y * 4) % 255, 120]);
  const plain = render(img, { columns: 30, charset: "detailed" });
  const styled = render(img, { columns: 30, charset: "detailed", scanlines: 1, bloom: 0.5, halftone: 0.5 });
  assert.deepEqual(styled.chars, plain.chars);
  assert.equal(effectCss(plain.options), "");
  const css = effectCss(styled.options, "#art");
  assert.match(css, /#art \{ text-shadow:/);
  assert.match(css, /#art \{ -webkit-mask-image: radial-gradient/);
  assert.match(css, /#art \{ background-image: repeating-linear-gradient/);
  assert.ok(toHtml(styled).includes(effectCss(styled.options)), "the HTML export carries the effects");
});
