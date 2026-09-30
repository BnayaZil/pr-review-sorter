/*
 * Records demo/demo.html into assets/demo.gif.
 * Drives window.demoSeek(t) frame by frame (deterministic), screenshots each
 * frame, then stitches with ffmpeg using a generated palette for clean colors.
 *
 * Requires: playwright (with chromium) resolvable, and ffmpeg on PATH.
 *   npm i playwright && npx playwright install chromium
 *   node scripts/build-gif.mjs
 */
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import { execFileSync } from "child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demo = "file://" + path.join(root, "demo", "demo.html") + "?static=1";
const framesDir = process.env.FRAMES_DIR || path.join(root, ".frames");
fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });

const VW = 1160,
  VH = 900;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2 });
await page.goto(demo);
await page.waitForFunction("window.demoReady === true");
await page.waitForTimeout(200);

let idx = 0;
async function snap() {
  await page.waitForTimeout(15);
  const p = path.join(framesDir, `f_${String(idx++).padStart(3, "0")}.png`);
  await page.screenshot({ path: p, clip: { x: 0, y: 0, width: VW, height: VH } });
}
async function seek(t) {
  await page.evaluate((tt) => window.demoSeek(tt), t);
  await snap();
}
async function ann(a) {
  await page.evaluate((aa) => window.demoAnnotate(aa), a);
  await snap();
}

for (let i = 0; i < 6; i++) await seek(0); // hold: alphabetical
const N = 26;
for (let i = 0; i <= N; i++) await seek(i / N); // reorder
for (let i = 0; i < 6; i++) await seek(1); // hold: sorted
const M = 16;
for (let i = 0; i <= M; i++) await ann(i / M); // reveal highlights + comments
for (let i = 0; i < 22; i++) await ann(1); // hold: final
await browser.close();

const out = path.join(root, "assets", "demo.gif");
fs.mkdirSync(path.dirname(out), { recursive: true });
execFileSync(
  "ffmpeg",
  [
    "-y",
    "-framerate", "16",
    "-i", path.join(framesDir, "f_%03d.png"),
    "-vf", "scale=1000:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=full[p];[s1][p]paletteuse=dither=sierra2_4a",
    "-loop", "0",
    out,
  ],
  { stdio: "inherit" }
);
fs.rmSync(framesDir, { recursive: true, force: true });
console.log("wrote", out);
