// The gallery: each of Glyphloom's presets drawn on the sample picture, here, with a link that opens it in the studio.
import { effectCss, render, toSpans } from "./glyphloom.js";
import { PRESETS } from "./presets.js";
import { sampleImage } from "./samples.js";

const image = sampleImage();
const COLUMNS = 72; // every card the same width in characters, whatever the preset's own width
const styles = [];
const gallery = document.getElementById("gallery");
for (const p of PRESETS) {
  const grid = render(image, { ...p.options, columns: COLUMNS });
  const card = document.createElement("article");
  card.className = "card";
  card.id = `preset-${p.id}`;
  const h = document.createElement("h2");
  h.textContent = p.name;
  const about = document.createElement("p");
  about.textContent = p.about;
  const frame = document.createElement("div");
  frame.className = `frame${grid.options.paper === "light" ? " light" : ""}`;
  const pre = document.createElement("pre");
  pre.setAttribute("aria-label", `${p.name}: the sample picture as character art`);
  pre.innerHTML = toSpans(grid);
  frame.append(pre);
  const open = document.createElement("a");
  open.className = "btn";
  open.href = `index.html#preset=${encodeURIComponent(p.id)}`;
  open.textContent = "Open in the studio";
  card.append(h, about, frame, open);
  gallery.append(card);
  styles.push(effectCss(grid.options, `#preset-${p.id} pre`));
}
const style = document.createElement("style");
style.textContent = styles.join("\n");
document.head.append(style);

/** Each card's art fills its frame: the font size from the frame's width, each cell the preset's shape. */
function fit() {
  for (const pre of gallery.querySelectorAll("pre")) {
    const frame = pre.parentElement;
    const aspect = PRESETS.find((p) => frame.parentElement.id === `preset-${p.id}`).options.charAspect ?? 0.5;
    pre.style.fontSize = "10px";
    const width = pre.scrollWidth;
    const avail = frame.clientWidth - 16;
    const size = Math.max(2, (10 * avail) / width);
    const cw = (width / COLUMNS) * (size / 10);
    pre.style.fontSize = `${size}px`;
    pre.style.lineHeight = `${cw / aspect}px`;
    pre.style.setProperty("--cell-w", `${cw}px`);
    pre.style.setProperty("--cell-h", `${cw / aspect}px`);
  }
}
fit();
addEventListener("resize", () => requestAnimationFrame(fit));
