// Exporta a animação quadro a quadro (Chromium headless) e envia os PNGs ao ffmpeg.
// Uso:
//   node scripts/render-frames.mjs video  [saida.mp4] [fps]   → vídeo sem áudio
//   node scripts/render-frames.mjs stills 1.2 5.5 ...          → PNGs de conferência em out/stills/
// Com FORMAT=story renderiza a versão vertical 1080×1920 (Stories/Reels).
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(path.join(process.execPath, "../../lib/node_modules/playwright")); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" };

const server = createServer(async (req, res) => {
  try {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!file.startsWith(ROOT)) throw new Error("fora do projeto");
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const STORY = process.env.FORMAT === "story";
const [VW, VH] = STORY ? [1080, 1920] : [1920, 1080];
const url = `http://127.0.0.1:${server.address().port}/src/index.html${STORY ? "?format=story" : ""}`;

const browser = await playwright.chromium.launch({ args: ["--font-render-hinting=none", "--disable-lcd-text"] });
const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("Erro na página:", e.message));
await page.goto(url);
await page.evaluate(() => window.READY);

const [mode = "video", ...rest] = process.argv.slice(2);
if (mode === "stills") {
  await mkdir(path.join(ROOT, "out/stills"), { recursive: true });
  for (const t of rest.map(Number)) {
    await page.evaluate((tt) => window.render(tt), t);
    await page.screenshot({ path: path.join(ROOT, `out/stills/${STORY ? "story-" : ""}t${t.toFixed(2)}.png`) });
  }
} else {
  const out = rest[0] || path.join(ROOT, "out/video-sem-audio.mp4");
  const fps = Number(rest[1] || 30);
  const duration = await page.evaluate(() => window.TIMELINE.duration);
  const frames = Math.round(duration * fps);
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
  for (let i = 0; i < frames; i++) {
    await page.evaluate((tt) => window.render(tt), i / fps);
    const buf = await page.screenshot({ type: "png" });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if (i % 60 === 0) process.stdout.write(`quadro ${i}/${frames}\n`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  console.log("Vídeo:", out);
}
await browser.close();
server.close();
