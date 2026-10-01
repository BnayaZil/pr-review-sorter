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
