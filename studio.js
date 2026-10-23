// The studio page: reads an image, a video or a line of text on this device, renders it with glyphloom.js, and exports
// it. Nothing is sent anywhere; the page's security policy forbids connections (connect-src 'none').
import { effectCss, paint, render, toAnimatedHtml, toAnsi, toHtml, toSpans, toText } from "./glyphloom.js";
import { PRESETS, deletePreset, ownPresets, savePreset } from "./presets.js";
import { sampleImage } from "./samples.js";

const $ = (id) => document.getElementById(id);
const MAX_SIDE = 1200; // a larger image is scaled down first: the grid never needs more pixels than this
const FPS = 10; // the frames a second of a moving export
const MAX_SECONDS = 10; // the longest moving export: 100 frames

let source = null; // ImageData of the current image or video frame (text is drawn again on each render)
let mode = "image";
let video = null; // the <video> while the source is a video
let grid = null;
let pending = 0;
let busy = false; // an export of frames is running

// Each control and the option it sets.
const FIELDS = {
  columns: "columns", aspect: "charAspect", charset: "charset", custom: "custom", dither: "dither", brightness: "brightness",
  contrast: "contrast", gamma: "gamma", invert: "invert", paper: "paper", color: "color", target: "colorTarget",
  scanlines: "scanlines", bloom: "bloom", halftone: "halftone",
};
const NUMBERS = new Set(["columns", "aspect", "brightness", "contrast", "gamma", "scanlines", "bloom", "halftone"]);

function options() {
  const o = {};
  for (const [id, name] of Object.entries(FIELDS)) o[name] = id === "invert" ? $(id).checked : NUMBERS.has(id) ? Number($(id).value) : $(id).value;
  return o;
}

/** Set the controls from `o` (a preset's options); options it does not name keep their values. */
function applyOptions(o) {
  for (const [id, name] of Object.entries(FIELDS)) {
    if (o[name] === undefined) continue;
    if (id === "invert") $(id).checked = !!o[name];
    else $(id).value = String(o[name]);
  }
  schedule();
}

function say(text) {
  $("status").textContent = text;
}

function outputs() {
  $("columns-out").textContent = $("columns").value;
  for (const id of ["aspect", "brightness", "contrast", "gamma", "scanlines", "bloom", "halftone"]) $(`${id}-out`).textContent = Number($(id).value).toFixed(2);
  $("custom-row").classList.toggle("hidden", $("charset").value !== "custom");
  $("custom-help").classList.toggle("hidden", $("charset").value !== "custom");
}

function schedule() {
  outputs();
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(draw);
}

function currentImage() {
  return mode === "text" ? textImage() : source;
}

function draw() {
  const src = currentImage();
  if (!src) return;
  const o = options();
  grid = render(src, o);
  const pre = $("art");
  $("frame").classList.toggle("light", o.paper === "light");
  pre.innerHTML = toSpans(grid);
  $("effects").textContent = effectCss(o, "#art");
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
  const lh = cw / grid.options.charAspect;
  pre.style.fontSize = `${size}px`;
  pre.style.lineHeight = `${lh}px`;
  // The halftone's dots are one a cell.
  pre.style.setProperty("--cell-w", `${cw}px`);
  pre.style.setProperty("--cell-h", `${lh}px`);
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

function stopVideo() {
  if (!video) return;
  video.pause();
  URL.revokeObjectURL(video.src);
  video = null;
  $("video-bar").classList.add("hidden");
  for (const b of document.querySelectorAll("[data-moving]")) b.disabled = true;
}

async function openFile(file) {
  if (file?.type.startsWith("video/")) return openVideo(file);
  if (!file || !file.type.startsWith("image/")) return say("That file is not an image or a video.");
  try {
    const bitmap = await createImageBitmap(file);
    stopVideo();
    source = toImageData(bitmap, bitmap.width, bitmap.height);
    bitmap.close?.();
    setMode("image");
    say(`${file.name || "Pasted image"}: read on this device.`);
    schedule();
  } catch {
    say("This browser could not read that image.");
  }
}

/** A video: played here, muted and looped; each frame it shows is rendered. */
async function openVideo(file) {
  stopVideo();
  const v = document.createElement("video");
  v.muted = true;
  v.loop = true;
  v.playsInline = true;
  v.src = URL.createObjectURL(file);
  try {
    await new Promise((ok, fail) => {
      v.addEventListener("loadeddata", ok, { once: true });
      v.addEventListener("error", fail, { once: true });
    });
  } catch {
    URL.revokeObjectURL(v.src);
    return say("This browser could not read that video.");
  }
  video = v;
  setMode("image");
  $("video-bar").classList.remove("hidden");
  for (const b of document.querySelectorAll("[data-moving]")) b.disabled = false;
  say(`${file.name || "Video"}: read on this device.`);
  await v.play().catch(() => {});
  playing();
  frameLoop();
}

function playing() {
  $("play").textContent = video && !video.paused ? "Pause" : "Play";
  $("play").setAttribute("aria-pressed", String(!!video && !video.paused));
}

let lastFrame = 0;
/** While a video plays, render its frame about FPS times a second. */
function frameLoop() {
  if (!video) return;
  const now = performance.now();
  if (!busy && video.readyState >= 2 && now - lastFrame >= 1000 / FPS) {
    lastFrame = now;
    source = toImageData(video, video.videoWidth, video.videoHeight);
    $("clock").textContent = `${video.currentTime.toFixed(1)} s of ${video.duration.toFixed(1)} s`;
    schedule();
  }
  requestAnimationFrame(frameLoop);
}

/** The video's frames from its start, FPS a second (at most MAX_SECONDS), each rendered with the current options. */
async function videoGrids() {
  const o = options();
  const wasPlaying = !video.paused;
  video.pause();
  const count = Math.max(1, Math.min(MAX_SECONDS * FPS, Math.floor(video.duration * FPS)));
  const grids = [];
  for (let k = 0; k < count; k++) {
    video.currentTime = k / FPS;
    await new Promise((r) => video.addEventListener("seeked", r, { once: true }));
    grids.push(render(toImageData(video, video.videoWidth, video.videoHeight), o));
    say(`Rendering frame ${k + 1} of ${count}…`);
  }
  if (wasPlaying) await video.play().catch(() => {});
  playing();
  return grids;
}

/** The frames painted onto a canvas in time and recorded as a WebM video. */
async function webmOf(grids) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  paint(ctx, grids[0], { cell: 6 });
  const recorder = new MediaRecorder(canvas.captureStream(FPS), { mimeType: "video/webm" });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (recorder.onstop = r));
  recorder.start();
  for (let k = 0; k < grids.length; k++) {
    paint(ctx, grids[k], { cell: 6 });
    say(`Recording frame ${k + 1} of ${grids.length}…`);
    await new Promise((r) => setTimeout(r, 1000 / FPS));
  }
  recorder.stop();
  await stopped;
  return new Blob(chunks, { type: "video/webm" });
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

async function exportAs(kind) {
  if (!grid) return say("Open an image or use the sample first.");
  if (kind === "txt") download("glyphloom.txt", new Blob([toText(grid)], { type: "text/plain;charset=utf-8" }));
  if (kind === "ans") download("glyphloom.ans", new Blob([toAnsi(grid)], { type: "text/plain;charset=utf-8" }));
  if (kind === "html") download("glyphloom.html", new Blob([toHtml(grid, { title: "Glyphloom art" })], { type: "text/html;charset=utf-8" }));
  if (kind === "png") {
    const canvas = document.createElement("canvas");
    paint(canvas.getContext("2d"), grid, { cell: 8 });
    canvas.toBlob((blob) => (blob ? download("glyphloom.png", blob) : say("This browser could not make the PNG.")), "image/png");
  }
  if (kind === "anim" || kind === "webm") {
    if (!video) return say("Open a video first: a moving export is made from its frames.");
    if (busy) return;
    busy = true;
    try {
      const grids = await videoGrids();
      if (kind === "anim") download("glyphloom-moving.html", new Blob([toAnimatedHtml(grids, { title: "Glyphloom moving art", fps: FPS })], { type: "text/html;charset=utf-8" }));
      else if (typeof MediaRecorder === "undefined") say("This browser cannot record a video.");
      else download("glyphloom.webm", await webmOf(grids));
    } finally {
      busy = false;
    }
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

/** The preset menu: Glyphloom's, then the person's own in this browser. */
function listPresets(selected = "") {
  const menu = $("preset");
  const own = ownPresets();
  menu.innerHTML = "";
  menu.append(new Option("Choose a preset", ""));
  const group = (label, items) => {
    const g = document.createElement("optgroup");
    g.label = label;
    for (const [value, name] of items) g.append(new Option(name, value));
    menu.append(g);
  };
  group("Glyphloom's", PRESETS.map((p) => [`g:${p.id}`, p.name]));
  if (own.length) group("Yours, in this browser", own.map((p) => [`y:${p.name}`, p.name]));
  menu.value = selected;
  $("preset-delete").disabled = !menu.value.startsWith("y:");
}

function choosePreset(value) {
  if (value.startsWith("g:")) {
    const p = PRESETS.find((x) => x.id === value.slice(2));
    if (p) applyOptions(p.options), say(`${p.name}: ${p.about}`);
  } else if (value.startsWith("y:")) {
    const p = ownPresets().find((x) => x.name === value.slice(2));
    if (p) applyOptions(p.options), say(`Your preset ${p.name}.`);
  }
  $("preset-delete").disabled = !value.startsWith("y:");
}

$("controls").addEventListener("submit", (e) => e.preventDefault());
for (const id of Object.keys(FIELDS)) $(id).addEventListener("input", schedule);
for (const id of ["text", "face"]) $(id).addEventListener("input", schedule);
$("fit").addEventListener("change", fit);
addEventListener("resize", () => requestAnimationFrame(fit));
$("file").addEventListener("change", (e) => openFile(e.target.files[0]));
$("sample").addEventListener("click", () => {
  stopVideo();
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
$("play").addEventListener("click", async () => {
  if (!video) return;
  if (video.paused) await video.play().catch(() => {});
  else video.pause();
  playing();
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
$("preset").addEventListener("change", (e) => choosePreset(e.target.value));
$("preset-save").addEventListener("click", () => {
  const name = $("preset-name").value.trim();
  if (!name) return say("Name the preset first.");
  if (!savePreset(name, options())) return say("This browser does not allow the page to keep a preset.");
  $("preset-name").value = "";
  listPresets(`y:${name}`);
  say(`Kept ${name} in this browser.`);
});
$("preset-delete").addEventListener("click", () => {
  const value = $("preset").value;
  if (!value.startsWith("y:")) return;
  deletePreset(value.slice(2));
  listPresets();
  say(`Forgot ${value.slice(2)}.`);
});

listPresets();
source = sampleImage();
// A link from the gallery names a preset: index.html#preset=<id>.
const named = new URLSearchParams(location.hash.slice(1)).get("preset");
if (named && PRESETS.some((p) => p.id === named)) {
  $("preset").value = `g:${named}`;
  choosePreset(`g:${named}`);
}
schedule();
