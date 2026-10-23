// The sample picture, drawn by the page so that the site needs no image file: a lit sphere over a sunset and a
// checkered floor. The studio and the gallery both start from it.

/** The sample as ImageData. */
export function sampleImage() {
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
