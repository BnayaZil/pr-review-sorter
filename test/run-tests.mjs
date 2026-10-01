/*
 * End-to-end tests for PR Review Sorter.
 *   npm i playwright && npx playwright install chromium
 *   node test/run-tests.mjs
 *
 * Covers: hash carrier, query carrier, compressed carrier (pr_order_z) incl.
 * inflate performance, and the remote (gist) wiring in content.js.
 */
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import vm from "vm";
import zlib from "zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = "file://" + path.join(root, "test", "fixture.html");

let pass = 0,
  fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log("  ✓ " + name);
  } else {
    fail++;
    console.log("  ✗ " + name + (detail ? " — " + detail : ""));
  }
}

// ---- load content.js core into a node sandbox (for encode + wiring tests) ----
function loadCore(extraGlobals) {
  const src = fs.readFileSync(path.join(root, "extension", "content.js"), "utf8");
  const sandbox = {
    window: {},
    console: console,
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    URLSearchParams,
    TextDecoder,
    TextEncoder,
    URL,
    document: {
      createElement: () => ({ style: {}, classList: { add() {} }, appendChild() {}, insertBefore() {}, setAttribute() {}, querySelector: () => null, addEventListener() {} }),
      querySelector: () => null,
      querySelectorAll: () => [],
      body: { appendChild() {} },
    },
  };
  Object.assign(sandbox, extraGlobals || {});
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window.PRReviewSorter;
}

const ORDER = [
  { path: "src/alpha.ts", reason: "entry", notes: [{ line: 2, text: "the main fn" }, { from: 3, to: 4, text: "the return" }] },
  { path: "src/mid.ts", reason: "mid" },
  { path: "src/zeta.ts", reason: "leaf" },
];
const EXPECTED = ["src/alpha.ts", "src/mid.ts", "src/zeta.ts"];

const core = loadCore();
const plainToken = core.encode(ORDER);
const planJson = JSON.stringify({ v: 1, files: ORDER.map((f) => ({ p: f.path, r: f.reason, notes: f.notes })) });
const zToken = zlib.deflateRawSync(Buffer.from(planJson)).toString("base64url");

async function applyAt(page, urlSuffix) {
  await page.goto(fixture + urlSuffix);
  await page.waitForFunction("window.PRReviewSorter !== undefined");
  return await page.evaluate(async () => {
    const res = await window.PRReviewSorter.applyFromLocation(document, location);
    return {
      res,
      order: Array.prototype.slice.call(document.querySelectorAll("#files > .file")).map((f) => f.getAttribute("data-tagsearch-path")),
      badges: document.querySelectorAll(".prrs-badge").length,
      comments: document.querySelectorAll(".prrs-comment").length,
      highlights: document.querySelectorAll(".prrs-hl").length,
      firstComment: (document.querySelector(".prrs-comment-text") || {}).textContent || "",
      panel: !!document.getElementById("prrs-panel"),
    };
  });
}

const browser = await chromium.launch();
const page = await browser.newPage();

console.log("\n[browser] hash carrier (#pr_order=) — the new default");
let r = await applyAt(page, "#pr_order=" + plainToken);
check("applied", r.res.applied);
check("reordered to review order", JSON.stringify(r.order) === JSON.stringify(EXPECTED), r.order.join(","));
check("matched 3 files", r.res.matched === 3, "matched=" + r.res.matched);
check("3 badges", r.badges === 3, "badges=" + r.badges);
check("2 comments", r.comments === 2, "comments=" + r.comments);
check("3 highlighted lines (line 2 + range 3-4)", r.highlights === 3, "hl=" + r.highlights);
check("order panel present", r.panel);

console.log("\n[browser] query carrier (?pr_order=) — parity");
r = await applyAt(page, "?pr_order=" + plainToken);
check("applied", r.res.applied);
check("reordered", JSON.stringify(r.order) === JSON.stringify(EXPECTED), r.order.join(","));

console.log("\n[browser] compressed carrier (#pr_order_z=)");
r = await applyAt(page, "#pr_order_z=" + zToken);
check("applied", r.res.applied);
check("reordered", JSON.stringify(r.order) === JSON.stringify(EXPECTED), r.order.join(","));
check("comments present", r.comments === 2, "comments=" + r.comments);

console.log("\n[browser] compression performance (inflate + JSON.parse)");
const bigFiles = [];
for (let i = 0; i < 200; i++) {
  bigFiles.push({ p: "packages/app/src/components/widget" + i + "/index.tsx", r: "refactored to the new hook", notes: [{ f: 10, to: 22, t: "check the effect cleanup and dep array here" }] });
}
const bigJson = JSON.stringify({ v: 1, files: bigFiles });
const bigZ = zlib.deflateRawSync(Buffer.from(bigJson)).toString("base64url");
const perf = await page.evaluate(
  async ({ tok, rawLen }) => {
    const S = window.PRReviewSorter;
    await S.inflateToken(tok); // warm up
    const N = 25;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) JSON.parse(await S.inflateToken(tok));
    return { ms: (performance.now() - t0) / N, zLen: tok.length, rawLen };
  },
  { tok: bigZ, rawLen: bigJson.length }
);
console.log(`    200 files+notes: raw JSON ${perf.rawLen}B -> z-token ${perf.zLen}B; inflate+parse avg ${perf.ms.toFixed(2)} ms`);
check("inflate+parse under 5 ms for a 200-file plan", perf.ms < 5, perf.ms.toFixed(2) + " ms");

console.log("\n[browser] erase restores native order + clears decorations");
await applyAt(page, "#pr_order=" + plainToken);
const afterErase = await page.evaluate(() => {
  window.PRReviewSorter.eraseDecorations(document);
  return {
    order: Array.prototype.slice.call(document.querySelectorAll("#files > .file")).map((f) => f.getAttribute("data-tagsearch-path")),
    badges: document.querySelectorAll(".prrs-badge").length,
    comments: document.querySelectorAll(".prrs-comment").length,
    panel: !!document.getElementById("prrs-panel"),
    hls: document.querySelectorAll(".prrs-hl").length,
  };
});
check("erase clears badges/comments/panel/highlights", afterErase.badges === 0 && afterErase.comments === 0 && !afterErase.panel && afterErase.hls === 0, JSON.stringify(afterErase));
check("erase restores native order", JSON.stringify(afterErase.order) === JSON.stringify(["src/zeta.ts", "src/alpha.ts", "src/mid.ts"]), afterErase.order.join(","));

console.log("\n[browser] Erase button fires prrs:erase");
const fired = await page.evaluate(async () => {
  await window.PRReviewSorter.applyFromLocation(document, location);
  return await new Promise((resolve) => {
    let got = false;
    document.addEventListener("prrs:erase", () => { got = true; }, { once: true });
    const btn = document.querySelector(".prrs-erase");
    if (!btn) return resolve(false);
    btn.click();
    setTimeout(() => resolve(got), 300);
  });
});
check("clicking Erase dispatches prrs:erase", fired === true);

console.log("\n[browser] storage round-trip (localStorage fallback)");
const stored = await page.evaluate(async () => {
  const S = window.PRReviewSorter;
  await S.storeSet({ "prrs:order:o/r/1": { files: [{ path: "a" }] } });
  const g = await S.storeGet(["prrs:order:o/r/1"]);
  return g["prrs:order:o/r/1"];
});
check("storeSet/storeGet round-trips", !!stored && stored.files && stored.files[0].path === "a", JSON.stringify(stored));

await browser.close();

console.log("\n[node] remote (gist) wiring in resolveOrder");
let sentMsg = null;
const mockChrome = {
  runtime: {
    sendMessage: (msg, cb) => {
      sentMsg = msg;
      cb({ ok: true, data: { v: 1, files: [{ p: "src/alpha.ts", r: "from gist", notes: [{ l: 2, t: "n" }] }] } });
    },
  },
};
const core2 = loadCore({ chrome: mockChrome });
const gistOrder = await core2.resolveOrder({ search: "", hash: "#pr_order_gist=abc123" });
check("gist id forwarded to background", sentMsg && sentMsg.gist === "abc123", JSON.stringify(sentMsg));
check("remote JSON parsed into an order", !!gistOrder && gistOrder[0].path === "src/alpha.ts" && gistOrder[0].notes.length === 1);

console.log("\n[node] prId + chooseOrder (cache decision)");
check("prId parses a PR path", core.prId("/o/r/pull/42/files") === "o/r/42", String(core.prId("/o/r/pull/42/files")));
check("prId is null off a PR", core.prId("/o/r/tree/main") === null);
const P = [{ path: "x" }], C = [{ path: "y" }];
check("params win over cache", core.chooseOrder(P, C, false) === P);
check("cache used when no params", core.chooseOrder(null, C, false) === C);
check("erased + no params => nothing", core.chooseOrder(null, C, true) === null);
check("erased but params present => params", core.chooseOrder(P, C, true) === P);

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
