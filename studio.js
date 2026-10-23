// The studio page: reads an image or a line of text on this device, renders it with glyphloom.js, and exports it.
// Nothing is sent anywhere; the page's security policy forbids connections (connect-src 'none').
import { paint, render, toAnsi, toHtml, toSpans, toText } from "./glyphloom.js";

const $ = (id) => document.getElementById(id);
const MAX_SIDE = 1200; // a larger image is scaled down first: the grid never needs more pixels than this

let source = null; // ImageData of the current image (text is drawn again on each render)
let mode = "image";
let grid = null;
let pending = 0;

const controls = ["columns", "aspect", "charset", "custom", "dither", "brightness", "contrast", "gamma", "invert", "paper", "color", "target"];

function options() {
  return {
    columns: Number($("columns").value),
    charAspect: Number($("aspect").value),
    charset: $("charset").value,
    custom: $("custom").value,
    dither: $("dither").value,
    brightness: Number($("brightness").value),
    contrast: Number($("contrast").value),
    gamma: Number($("gamma").value),
    invert: $("invert").checked,
    paper: $("paper").value,
    color: $("color").value,
    colorTarget: $("target").value,
  };
}

function say(text) {
  $("status").textContent = text;
}

function outputs() {
  $("columns-out").textContent = $("columns").value;
  for (const id of ["aspect", "brightness", "contrast", "gamma"]) $(`${id}-out`).textContent = Number($(id).value).toFixed(2);
  $("custom-row").classList.toggle("hidden", $("charset").value !== "custom");
  $("custom-help").classList.toggle("hidden", $("charset").value !== "custom");
}

function schedule() {
  outputs();
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(draw);
}

function draw() {
  const src = mode === "text" ? textImage() : source;
  if (!src) return;
  const o = options();
  grid = render(src, o);
  const pre = $("art");
  $("frame").classList.toggle("light", o.paper === "light");
  pre.innerHTML = toSpans(grid);
  fit();
  $("dims").textContent = `${grid.columns} × ${grid.rows} characters`;
}

/** Size the preview so each cell has the chosen shape, and, when asked, so the art fits the frame's width. */
function fit() {
  if (!grid) return;
  const pre = $("art");
  const frame = $("frame");
  pre.style.fontSize = "10px";
  pre.style.lineHeight = "10px";
  const charWidth = pre.scrollWidth / grid.columns || 6;
  let size = 10;
  if ($("fit").checked) {
    const style = getComputedStyle(frame);
    const avail = frame.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    size = Math.max(2, (10 * avail) / pre.scrollWidth);
  }
  const cw = (charWidth * size) / 10;
  pre.style.fontSize = `${size}px`;
  pre.style.lineHeight = `${cw / grid.options.charAspect}px`;
}

function toImageData(drawable, w, h) {
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(drawable, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

async function openFile(file) {
  if (!file || !file.type.startsWith("image/")) return say("That file is not an image.");
  try {
    const bitmap = await createImageBitmap(file);
    source = toImageData(bitmap, bitmap.width, bitmap.height);
    bitmap.close?.();
    setMode("image");
    say(`${file.name || "Pasted image"}: read on this device.`);
    schedule();
  } catch {
    say("This browser could not read that image.");
  }
}

/** The sample: a lit sphere over a sunset and a checkered floor, drawn here so the page needs no image file. */
function sampleImage() {
  const w = 640, h = 420;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.62);
  sky.addColorStop(0, "#050a14");
  sky.addColorStop(0.7, "#2a1838");
  sky.addColorStop(1, "#6b2f3a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  const floorTop = h * 0.62;
  for (let row = 0; row < 8; row++)
    for (let col = -8; col < 16; col++) {
      const y0 = floorTop + ((h - floorTop) * (row / 8) ** 1.6);
      const y1 = floorTop + ((h - floorTop) * ((row + 1) / 8) ** 1.6);
      const spread = (y) => 0.2 + (0.8 * (y - floorTop)) / (h - floorTop);
      const x = (c, y) => w / 2 + (c - 4) * 80 * spread(y);
      ctx.fillStyle = (row + col) % 2 ? "#1f5c45" : "#d9d2bf";
      ctx.beginPath();
      ctx.moveTo(x(col, y0), y0);
      ctx.lineTo(x(col + 1, y0), y0);
      ctx.lineTo(x(col + 1, y1), y1);
      ctx.lineTo(x(col, y1), y1);
      ctx.fill();
    }
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(w / 2 + 20, h * 0.8, 120, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  const ball = ctx.createRadialGradient(w / 2 - 50, h * 0.36, 12, w / 2, h * 0.48, 150);
  ball.addColorStop(0, "#fff6e0");
  ball.addColorStop(0.3, "#e8a33d");
  ball.addColorStop(0.85, "#7a2e14");
  ball.addColorStop(1, "#2a0f08");
  ctx.fillStyle = ball;
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.48, 135, 0, Math.PI * 2);
  ctx.fill();
  return ctx.getImageData(0, 0, w, h);
}

function textImage() {
  const text = $("text").value || " ";
  const font = $("face").value;
  const dark = $("paper").value === "dark";
  const probe = document.createElement("canvas").getContext("2d");
  probe.font = font;
  const w = Math.ceil(probe.measureText(text).width) + 40;
  const h = 210;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, w);
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = dark ? "#000" : "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = dark ? "#fff" : "#000";
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 20, h / 2);
  return ctx.getImageData(0, 0, w, h);
}

function setMode(next) {
  mode = next;
  $("src-image").setAttribute("aria-pressed", String(next === "image"));
  $("src-text").setAttribute("aria-pressed", String(next === "text"));
  $("image-source").classList.toggle("hidden", next !== "image");
  $("text-source").classList.toggle("hidden", next !== "text");
}

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  say(`Saved ${name}.`);
}

function exportAs(kind) {
  if (!grid) return say("Open an image or use the sample first.");
  if (kind === "txt") download("glyphloom.txt", new Blob([toText(grid)], { type: "text/plain;charset=utf-8" }));
  if (kind === "ans") download("glyphloom.ans", new Blob([toAnsi(grid)], { type: "text/plain;charset=utf-8" }));
  if (kind === "html") download("glyphloom.html", new Blob([toHtml(grid, { title: "Glyphloom art" })], { type: "text/html;charset=utf-8" }));
  if (kind === "png") {
    const canvas = document.createElement("canvas");
    paint(canvas.getContext("2d"), grid, { cell: 8 });
    canvas.toBlob((blob) => (blob ? download("glyphloom.png", blob) : say("This browser could not make the PNG.")), "image/png");
  }
}

async function copy() {
  if (!grid) return say("Open an image or use the sample first.");
  try {
    await navigator.clipboard.writeText(toText(grid));
    say("Copied the text.");
  } catch {
    const range = document.createRange();
    range.selectNodeContents($("art"));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    say("Selected the art: copy it with your keyboard.");
  }
}

$("controls").addEventListener("submit", (e) => e.preventDefault());
for (const id of controls) $(id).addEventListener("input", schedule);
for (const id of ["text", "face"]) $(id).addEventListener("input", schedule);
$("fit").addEventListener("change", fit);
addEventListener("resize", () => requestAnimationFrame(fit));
$("file").addEventListener("change", (e) => openFile(e.target.files[0]));
$("sample").addEventListener("click", () => {
  source = sampleImage();
  setMode("image");
  say("The sample is drawn by this page.");
  schedule();
});
$("src-image").addEventListener("click", () => {
  setMode("image");
  schedule();
});
$("src-text").addEventListener("click", () => {
  setMode("text");
  schedule();
});
const drop = $("drop");
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  openFile(e.dataTransfer.files[0]);
});
addEventListener("paste", (e) => {
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
  if (item) openFile(item.getAsFile());
});
$("copy").addEventListener("click", copy);
for (const b of document.querySelectorAll("[data-export]")) b.addEventListener("click", () => exportAs(b.dataset.export));

source = sampleImage();
schedule();
