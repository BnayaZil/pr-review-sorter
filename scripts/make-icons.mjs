/*
 * Generates extension/icons/icon{16,48,128}.png — a rounded blue tile with three
 * numbered rows (a sorted list). Rendered with chromium at each exact size.
 *   npm i playwright && npx playwright install chromium
 *   node scripts/make-icons.mjs
 */
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "extension", "icons");
fs.mkdirSync(outDir, { recursive: true });

const html = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;background:transparent}
  .ic{width:100vw;height:100vh;box-sizing:border-box;padding:15%;border-radius:24%;
      background:linear-gradient(135deg,#218bff,#0969da 60%,#0a53be);
      display:flex;flex-direction:column;justify-content:center;gap:9%}
  .row{display:flex;align-items:center;gap:9%;height:19%}
  .n{aspect-ratio:1;height:100%;border-radius:50%;background:#fff;color:#0969da;
     font:800 11vmin/1 Arial,Helvetica,sans-serif;display:flex;align-items:center;justify-content:center}
  .bar{flex:1;height:52%;border-radius:999px;background:rgba(255,255,255,.9)}
  .bar.s{flex:.6}
</style>
<div class="ic">
  <div class="row"><span class="n">1</span><span class="bar"></span></div>
  <div class="row"><span class="n">2</span><span class="bar s"></span></div>
  <div class="row"><span class="n">3</span><span class="bar"></span></div>
</div>`;

const browser = await chromium.launch();
for (const size of [128, 48, 16]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  await page.waitForTimeout(30);
  await page.screenshot({ path: path.join(outDir, `icon${size}.png`), omitBackground: true });
  await page.close();
  console.log("wrote icon" + size + ".png");
}
await browser.close();
