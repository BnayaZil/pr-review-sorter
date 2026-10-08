/*
 * Background service worker. Content scripts can't do privileged cross-origin
 * fetches in MV3, so remote review plans (pr_order_gist / pr_order_url) are
 * fetched here, where the extension's host_permissions apply, and returned to
 * the content script.
 */
const ALLOWED_HOSTS = ["api.github.com", "gist.githubusercontent.com", "raw.githubusercontent.com"];

async function fetchGist(id) {
  const r = await fetch("https://api.github.com/gists/" + encodeURIComponent(id), {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!r.ok) throw new Error("gist http " + r.status);
  const gist = await r.json();
  const files = gist.files || {};
  const first = Object.values(files)[0];
  if (!first) throw new Error("gist has no files");
  // Large files are truncated in the API response; fall back to the raw URL.
  const content = first.truncated && first.raw_url ? await (await fetch(first.raw_url)).text() : first.content;
  return JSON.parse(content);
}

async function fetchUrl(url) {
  const host = new URL(url).hostname;
  if (!ALLOWED_HOSTS.includes(host)) throw new Error("host not allowed: " + host);
  const r = await fetch(url);
  if (!r.ok) throw new Error("http " + r.status);
  return await r.json();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "prrs-fetch") return;
  (async () => {
    try {
      const data = msg.gist ? await fetchGist(msg.gist) : await fetchUrl(msg.url);
      sendResponse({ ok: true, data: data });
    } catch (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    }
  })();
  return true; // keep the message channel open for the async response
});

// Dev only: an unpacked install polls its own files and, on change, reloads open PR
// tabs and itself. Inert in the store build (installType "normal").
// ponytail: 1s full-file polling, swap for a file-watcher dev server if it ever feels slow.
const DEV_FILES = ["manifest.json", "background.js", "content.js", "styles.css"];

async function devSnapshot() {
  const texts = await Promise.all(DEV_FILES.map((f) => fetch(f, { cache: "no-store" }).then((r) => r.text())));
  return texts.join("\0");
}

async function devReload() {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.map((t) => chrome.tabs.sendMessage(t.id, { type: "prrs-dev-reload" })));
  chrome.runtime.reload();
}

chrome.runtime.onStartup.addListener(() => {}); // wake the worker at browser start so the watcher runs
chrome.management.getSelf().then(async (self) => {
  if (self.installType !== "development") return;
  let last = await devSnapshot();
  setInterval(async () => {
    await chrome.runtime.getPlatformInfo(); // an extension API call keeps the MV3 worker from idling out
    const now = await devSnapshot();
    if (now !== last) devReload();
  }, 1000);
});
