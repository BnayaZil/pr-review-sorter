/*
 * Packages extension/ into dist/pr-review-sorter-extension.zip (manifest at the
 * zip root, as the Chrome Web Store and "Load unpacked" expect). Stable name so
 * the release download URL never changes.
 *   node scripts/package.mjs
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
fs.mkdirSync(dist, { recursive: true });

const out = path.join(dist, "pr-review-sorter-extension.zip");
fs.rmSync(out, { force: true });

// `zip` is present on GitHub's ubuntu/macos runners and on macOS/Linux dev machines.
execFileSync("zip", ["-r", "-q", out, ".", "-x", ".*"], { cwd: path.join(root, "extension"), stdio: "inherit" });

const version = JSON.parse(fs.readFileSync(path.join(root, "extension", "manifest.json"), "utf8")).version;
console.log("wrote " + out + " (manifest v" + version + ")");
