// Presets: named sets of the renderer's options. Glyphloom's own are here; a person's own are kept in this browser
// only (localStorage), never sent anywhere. The gallery shows Glyphloom's presets; the studio applies either kind.

/** Glyphloom's presets. Each is a starting point; every option can be changed after. */
export const PRESETS = [
  { id: "phosphor", name: "Phosphor", about: "An old terminal: the detailed ramp, scan lines and a glow.", options: { columns: 110, charset: "detailed", color: "none", paper: "dark", scanlines: 0.6, bloom: 0.5, halftone: 0, dither: "none" } },
  { id: "newsprint", name: "Newsprint", about: "Ink on paper through round dots, as a printed photograph.", options: { columns: 120, charset: "blocks", color: "none", paper: "light", halftone: 0.7, scanlines: 0, bloom: 0, dither: "floyd-steinberg" } },
  { id: "braille-ink", name: "Braille ink", about: "Eight dots a cell for fine lines, Atkinson dithering.", options: { columns: 100, charset: "braille", color: "none", paper: "dark", dither: "atkinson", scanlines: 0, bloom: 0, halftone: 0 } },
  { id: "mosaic", name: "Mosaic", about: "Colour on the cells behind the characters, in 256 colours.", options: { columns: 80, charset: "simple", color: "ansi256", colorTarget: "bg", paper: "dark", scanlines: 0, bloom: 0, halftone: 0, dither: "none" } },
  { id: "neon", name: "Neon", about: "Full colour on the characters, with a strong glow.", options: { columns: 100, charset: "detailed", color: "truecolor", colorTarget: "fg", paper: "dark", bloom: 0.9, scanlines: 0.2, halftone: 0, dither: "none" } },
  { id: "binary", name: "Binary", about: "Ones and zeros, ordered dithering, 16 colours.", options: { columns: 100, charset: "binary", color: "ansi16", colorTarget: "fg", paper: "dark", dither: "ordered", scanlines: 0, bloom: 0, halftone: 0 } },
];

const KEY = "glyphloom.presets";

/** The person's own presets in this browser: [{ name, options }]. Empty when storage is not allowed. */
export function ownPresets() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((p) => typeof p?.name === "string" && p.options && typeof p.options === "object") : [];
  } catch {
    return [];
  }
}

/** Keep `options` under `name` in this browser (replacing one of that name). False when storage is not allowed. */
export function savePreset(name, options) {
  try {
    const list = ownPresets().filter((p) => p.name !== name);
    list.push({ name, options });
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** Forget the person's preset `name`. */
export function deletePreset(name) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ownPresets().filter((p) => p.name !== name)));
    return true;
  } catch {
    return false;
  }
}
