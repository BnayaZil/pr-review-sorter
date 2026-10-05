/*
 * PR Review Sorter — content script + reusable core.
 *
 * A code agent decides the best order to read a PR's changed files and encodes
 * that order in the PR URL. This script reads it and reorders GitHub's
 * "Files changed" list to match, adding a numbered badge per file and a
 * clickable order panel.
 *
 * URL contract (checked in this order):
 *   1. pr_order_z     base64url( raw-DEFLATE( JSON ) )  — compressed, for big PRs
 *   2. pr_order_gist  a GitHub gist id holding the JSON  — remote, unlimited size
 *   3. pr_order_url   an https URL to the JSON           — remote, unlimited size
 *   4. pr_order       base64url( JSON )                  — plain inline
 *   5. pr_order_paths comma-separated encodeURIComponent(path) — simplest
 * JSON shape: {"v":1,"files":[{"p":"path","r":"reason","notes":[{"l":42,"t":"..."}]}]}
 *
 * The payload belongs in the URL HASH (#...) by default: the fragment is never
 * sent to GitHub's server, so it can't trigger a 414 "URI Too Long" (the query
 * string is rejected around 7 KB). The query string (?...) is still read, for
 * short links. Remote params (gist/url) are fetched by the background worker.
 *
 * Caching: when an order is seen on ANY of a PR's pages (conversation, files, …),
 * it's cached per PR (owner/repo/number) in chrome.storage.local and re-applied on
 * the files view even when that URL has no params. The order panel has an "Erase"
 * button that clears the cache for the PR and restores GitHub's native order.
 *
 * The core (resolveOrder / parseOrder / decorate / encode) is exposed on
 * window.PRReviewSorter so the demo and tests reuse the exact same code.
 */
(function () {
  "use strict";

  const PARAM = "pr_order";
  const PARAM_Z = "pr_order_z";
  const PARAM_PATHS = "pr_order_paths";
  const PARAM_URL = "pr_order_url";
  const PARAM_GIST = "pr_order_gist";

  // ---- base64url <-> unicode string ----
  function b64urlDecode(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return decodeURIComponent(escape(atob(s)));
  }
  function b64urlEncode(s) {
    return btoa(unescape(encodeURIComponent(s)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  /** Build a `pr_order` value from [{path, reason?, notes?}, ...]. */
  function encode(files) {
    const payload = {
      v: 1,
      files: files.map((f) => {
        const o = { p: f.path };
        if (f.reason) o.r = f.reason;
        if (f.notes && f.notes.length) {
          o.notes = f.notes.map((nt) => {
            const c = {};
            if (nt.from != null) {
              c.f = nt.from;
              c.to = nt.to != null ? nt.to : nt.from;
            } else {
              c.l = nt.line != null ? nt.line : nt.from;
            }
            if (nt.side) c.s = nt.side;
            if (nt.text) c.t = nt.text;
            return c;
          });
        }
        return o;
      }),
    };
    return b64urlEncode(JSON.stringify(payload));
  }

  /** Normalize a compact/long note list into {line?, from?, to?, side, text}. */
  function normalizeNotes(arr) {
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x) => ({
        line: x.line != null ? x.line : x.l,
        from: x.from != null ? x.from : x.f,
        to: x.to,
        side: x.side || x.s || "R",
        text: x.text != null ? x.text : x.t || "",
      }))
      .filter((n) => n.line != null || n.from != null);
  }

  /** Turn a decoded {v, files:[...]} object into [{path, reason, notes}]. */
  function filesFromData(data) {
    if (!data || !Array.isArray(data.files)) return null;
    const out = data.files
      .map((f) => ({
        path: f.p != null ? f.p : f.path,
        reason: f.r != null ? f.r : f.reason || "",
        notes: normalizeNotes(f.notes || f.n),
      }))
      .filter((f) => f.path);
    return out.length ? out : null;
  }

  // ---- base64url <-> bytes, and raw-DEFLATE inflate (for pr_order_z) ----
  function b64urlToBytes(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  /** Inflate a raw-DEFLATE base64url token to its UTF-8 string. Async (DecompressionStream). */
  async function inflateToken(token) {
    const bytes = b64urlToBytes(token);
    if (typeof DecompressionStream === "undefined") throw new Error("DecompressionStream unavailable");
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new TextDecoder().decode(buf);
  }

  /** Compress a UTF-8 string to a raw-DEFLATE base64url token. Async; used by tests/tools. */
  async function deflateToken(str) {
    const cs = new CompressionStream("deflate-raw");
    const stream = new Blob([new TextEncoder().encode(str)]).stream().pipeThrough(cs);
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  /** Parse an INLINE order (plain pr_order / pr_order_paths). Sync. Returns [{...}] or null. */
  function parseOrder(search, hash) {
    const q = new URLSearchParams(search || "");
    const h = new URLSearchParams((hash || "").replace(/^#/, ""));
    const enc = q.get(PARAM) || h.get(PARAM);
    if (enc) {
      try {
        const out = filesFromData(JSON.parse(b64urlDecode(enc)));
        if (out) return out;
      } catch (e) {
        console.warn("[pr-review-sorter] could not parse pr_order:", e);
      }
    }
    const plain = q.get(PARAM_PATHS) || h.get(PARAM_PATHS);
    if (plain) {
      const out = plain
        .split(",")
        .map((p) => ({ path: decodeURIComponent(p.trim()), reason: "", notes: [] }))
        .filter((f) => f.path);
      if (out.length) return out;
    }
    return null;
  }

  /** Ask the background worker to fetch remote JSON (gist id or https url). */
  function fetchRemote(params) {
    return new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) {
        resolve(null);
        return;
      }
      try {
        chrome.runtime.sendMessage({ type: "prrs-fetch", url: params.url, gist: params.gist }, (resp) => {
          if (chrome.runtime.lastError) {
            console.warn("[pr-review-sorter] remote fetch error:", chrome.runtime.lastError.message);
            resolve(null);
            return;
          }
          resolve(resp && resp.ok ? resp.data : null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  /**
   * Resolve an order from a location, handling every carrier in priority order:
   * compressed (pr_order_z) -> remote (gist/url) -> plain inline. Async.
   */
  async function resolveOrder(loc) {
    const q = new URLSearchParams(loc.search || "");
    const h = new URLSearchParams((loc.hash || "").replace(/^#/, ""));
    const get = (k) => q.get(k) || h.get(k);

    const z = get(PARAM_Z);
    if (z) {
      try {
        const out = filesFromData(JSON.parse(await inflateToken(z)));
        if (out) return out;
      } catch (e) {
        console.warn("[pr-review-sorter] could not parse pr_order_z:", e);
      }
    }

    const url = get(PARAM_URL);
    const gist = get(PARAM_GIST);
    if (url || gist) {
      const data = await fetchRemote({ url: url, gist: gist });
      const out = filesFromData(data);
      if (out) return out;
    }

    return parseOrder(loc.search, loc.hash);
  }

  /** The container holding the per-file diffs — classic (#files) or new (/changes). */
  function filesContainerOf(root) {
    return root.querySelector("#files") || root.querySelector('[data-testid="progressive-diffs-list"]');
  }

  /** Resolve a path to its file element: exact (classic) or aria-label suffix (new UI). */
  function matchFile(map, path) {
    if (map.has(path)) return map.get(path);
    for (const entry of map) {
      const key = entry[0];
      if (key.endsWith(path) || key.endsWith("/" + path) || key.includes(path)) return entry[1];
    }
    return null;
  }

  /** Map every changed-file element in `root` to its path (classic) or aria-label (new UI). */
  function collectFiles(root) {
    const map = new Map();
    root.querySelectorAll(".file.js-file, div.file[data-tagsearch-path], div.file").forEach((el) => {
      const path =
        el.getAttribute("data-tagsearch-path") ||
        (el.querySelector("[data-tagsearch-path]") &&
          el.querySelector("[data-tagsearch-path]").getAttribute("data-tagsearch-path")) ||
        (el.querySelector(".file-info a[title]") &&
          el.querySelector(".file-info a[title]").getAttribute("title"));
      if (path && !map.has(path)) map.set(path, el);
    });
    // New "Files changed" experience (/changes): each file is a div[class*="diffEntry"].
    // Its header link (a[href="#diff-<sha>"]) names the path even before the diff loads
    // and for generated files that need "Load Diff"; the table appears only once loaded.
    if (!map.size) {
      root.querySelectorAll('[class*="diffEntry"]').forEach((unit) => {
        const link = unit.querySelector('a[href^="#diff-"]');
        const table = unit.querySelector("table[data-diff-anchor]");
        const label =
          (link && link.textContent.replace(/\u200e/g, "").trim()) || (table && table.getAttribute("aria-label"));
        if (label && !map.has(label)) map.set(label, unit);
      });
    }
    if (!map.size) {
      root.querySelectorAll("table[data-diff-anchor]").forEach((t) => {
        const label = t.getAttribute("aria-label");
        if (!label) return;
        const unit = t.closest('[class*="diffEntry"]') || t;
        if (!map.has(label)) map.set(label, unit);
      });
    }
    return map;
  }

  function makeBadge(n, reason) {
    const badge = document.createElement("span");
    badge.className = "prrs-badge";
    badge.textContent = "#" + n;
    if (reason) badge.title = reason;
    return badge;
  }

  function makePanel(order, map) {
    const existing = document.getElementById("prrs-panel");
    const wasCollapsed = !!existing && existing.classList.contains("prrs-collapsed");
    if (existing) existing.remove();

    const panel = document.createElement("div");
    panel.id = "prrs-panel";
    if (wasCollapsed) panel.classList.add("prrs-collapsed");

    const head = document.createElement("div");
    head.className = "prrs-panel-head";
    head.innerHTML =
      '<span class="prrs-panel-title">Review order</span>' +
      '<span class="prrs-panel-actions">' +
      '<button class="prrs-erase" title="Erase sorting and restore GitHub\'s order">Erase</button>' +
      '<button class="prrs-panel-toggle" title="Collapse">–</button>' +
      "</span>";
    panel.appendChild(head);

    const list = document.createElement("ol");
    list.className = "prrs-panel-list";

    order.forEach((item, i) => {
      const li = document.createElement("li");
      li.className = "prrs-panel-item";
      const el = matchFile(map, item.path);
      if (!el) {
        li.classList.add("prrs-missing");
        li.title = "This file isn't on the page. It may not be loaded yet, or it isn't part of this PR.";
      }

      const num = document.createElement("span");
      num.className = "prrs-panel-num";
      num.textContent = i + 1;

      const body = document.createElement("span");
      body.className = "prrs-panel-body";
      const name = document.createElement("span");
      name.className = "prrs-panel-path";
      name.textContent = item.path;
      body.appendChild(name);
      if (item.reason) {
        const why = document.createElement("span");
        why.className = "prrs-panel-reason";
        why.textContent = item.reason;
        body.appendChild(why);
      }
      if (item.notes && item.notes.length) {
        const c = document.createElement("span");
        c.className = "prrs-panel-count";
        c.textContent = "💬 " + item.notes.length + (item.notes.length === 1 ? " note" : " notes");
        body.appendChild(c);
      }

      li.appendChild(num);
      li.appendChild(body);

      if (el) {
        li.addEventListener("click", () => {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          el.classList.add("prrs-flash");
          setTimeout(() => el.classList.remove("prrs-flash"), 1200);
        });
      }
      list.appendChild(li);
    });

    panel.appendChild(list);
    head.querySelector(".prrs-panel-toggle").addEventListener("click", (e) => {
      e.stopPropagation();
      panel.classList.toggle("prrs-collapsed");
    });
    const eraseBtn = head.querySelector(".prrs-erase");
    if (eraseBtn) {
      eraseBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        document.dispatchEvent(new CustomEvent("prrs:erase"));
      });
    }
    return panel;
  }

  // ---- Inline highlights + comments ----

  /** Find the diff line row for a line number. Handles GitHub tables and the demo. */
  function findLine(fileEl, n, side) {
    const demo = fileEl.querySelector('.diff-row[data-line-number="' + n + '"]');
    if (demo) return { row: demo, code: demo };
    // New UI: <td data-line-anchor="<diffAnchor><R|L><line>"> inside <table data-diff-anchor>.
    const table = fileEl.matches && fileEl.matches("table[data-diff-anchor]") ? fileEl : fileEl.querySelector("table[data-diff-anchor]");
    if (table) {
      const a = table.getAttribute("data-diff-anchor");
      const at = (s) => table.querySelector('td[data-line-anchor="' + a + s + n + '"]');
      const cell = at(side === "L" ? "L" : "R") || at(side === "L" ? "R" : "L");
      if (cell) {
        const row = cell.closest("tr");
        return { row: row, code: row };
      }
    }
    const cells = Array.prototype.slice.call(fileEl.querySelectorAll('td.blob-num[data-line-number="' + n + '"]'));
    if (!cells.length) return null;
    let cell = cells.find((c) =>
      side === "L" ? c.classList.contains("blob-num-deletion") : !c.classList.contains("blob-num-deletion")
    );
    cell = cell || cells[cells.length - 1];
    const row = cell.closest("tr");
    return { row: row, code: row ? row.querySelector("td.blob-code") || row : null };
  }

  function makeComment(text, anchorRow) {
    const box = document.createElement("div");
    box.className = "prrs-comment";
    box.innerHTML =
      '<span class="prrs-comment-icon">✦</span>' +
      '<div class="prrs-comment-body">' +
      '<span class="prrs-comment-author">Review agent</span>' +
      '<span class="prrs-comment-text"></span></div>';
    box.querySelector(".prrs-comment-text").textContent = text;

    if (anchorRow.tagName === "TR") {
      const tr = document.createElement("tr");
      tr.className = "prrs-comment-row";
      const td = document.createElement("td");
      td.className = "prrs-comment-cell";
      td.colSpan = anchorRow.children.length || 3;
      td.appendChild(box);
      tr.appendChild(td);
      return tr;
    }
    const wrap = document.createElement("div");
    wrap.className = "prrs-comment-row";
    wrap.appendChild(box);
    return wrap;
  }

  /** Highlight a line/range and attach the agent's comment under it. Returns the comment node (or null). */
  function addNote(fileEl, note) {
    const start = note.from != null ? note.from : note.line;
    const end = note.to != null ? note.to : note.from != null ? note.from : note.line;
    if (start == null) return null;
    let anchorRow = null;
    for (let n = start; n <= end; n++) {
      const r = findLine(fileEl, n, note.side);
      if (!r) continue;
      r.row.classList.add("prrs-hl");
      if (r.code && r.code !== r.row) r.code.classList.add("prrs-hl");
      anchorRow = r.row;
    }
    if (!anchorRow) return null;
    const cmt = note.text ? makeComment(note.text, anchorRow) : null;
    if (cmt) anchorRow.parentNode.insertBefore(cmt, anchorRow.nextSibling);
    return cmt;
  }

  function applyNotes(fileEl, notes) {
    const created = [];
    (notes || []).forEach((nt) => {
      const el = addNote(fileEl, nt);
      if (el) created.push(el);
    });
    return created;
  }

  /**
   * Reorder the file blocks in `root` and decorate them.
   * Returns { matched, total }.
   */
  function decorate(root, order) {
    const map = collectFiles(root);
    if (!map.size) return { matched: 0, total: 0 };

    const filesContainer = filesContainerOf(root) || map.values().next().value.parentElement;
    if (!filesContainer) return { matched: 0, total: map.size };

    // Remember the native order once, so "Erase" can restore it without a reload.
    // Files GitHub loads later (in batches) arrive after the ones already here.
    const original =
      filesContainer.__prrsOriginal ||
      (filesContainer.__prrsOriginal = Array.prototype.slice.call(filesContainer.children));
    map.forEach((el) => {
      if (original.indexOf(el) < 0) original.push(el);
    });

    // Desired sequence: ordered matches first, then anything the agent left out.
    const orderedEls = [];
    const seen = new Set();
    order.forEach((item, i) => {
      const el = matchFile(map, item.path);
      if (!el || seen.has(el)) return;
      seen.add(el);
      orderedEls.push(el);
      el.setAttribute("data-prrs-order", i + 1);

      // Badge in the file header (classic .file-header, or the new-UI diff region).
      const header =
        el.querySelector(".file-header .file-info") ||
        el.querySelector(".file-header") ||
        el.querySelector('[role="region"]') ||
        el;
      if (header && !header.querySelector(".prrs-badge")) {
        header.insertBefore(makeBadge(i + 1, item.reason), header.firstChild);
      }

      // On /changes a file's diff can load after the file is sorted; its notes wait for it.
      if (item.notes && item.notes.length && el.getAttribute("data-prrs-notes") !== "done") {
        applyNotes(el, item.notes);
        el.setAttribute("data-prrs-notes", el.querySelector(".prrs-hl") ? "done" : "pending");
      }
    });

    const leftovers = [];
    map.forEach((el) => {
      if (!seen.has(el)) leftovers.push(el);
    });

    // appendChild moves nodes; iterating the full desired list yields exact order.
    orderedEls.concat(leftovers).forEach((el) => filesContainer.appendChild(el));

    // Order panel.
    document.body.appendChild(makePanel(order, map));

    return { matched: orderedEls.length, total: map.size };
  }

  /** Resolve the order for a location and apply it to `root`. Async. Returns {applied, matched, total}. */
  async function applyFromLocation(root, loc) {
    const order = await resolveOrder(loc);
    if (!order) return { applied: false, matched: 0, total: 0 };
    const res = decorate(root, order);
    return { applied: true, matched: res.matched, total: res.total };
  }

  // ---- Per-PR cache (so params on any of a PR's URLs apply on the files view) ----

  /** owner/repo/number for the current PR, or null. */
  function prId(pathname) {
    const m = (pathname || "").match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    return m ? m[1] + "/" + m[2] + "/" + m[3] : null;
  }
  const KEY_ORDER = (id) => "prrs:order:" + id;
  const KEY_DISMISS = (id) => "prrs:dismissed:" + id;

  function hasChromeStorage() {
    return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  }
  function storeGet(keys) {
    return new Promise((resolve) => {
      try {
        if (hasChromeStorage()) {
          chrome.storage.local.get(keys, (r) => resolve(r || {}));
          return;
        }
      } catch (e) {}
      // Fallback: localStorage (demo/tests / no storage permission).
      const out = {};
      (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
        try {
          const v = localStorage.getItem(k);
          if (v != null) out[k] = JSON.parse(v);
        } catch (e) {}
      });
      resolve(out);
    });
  }
  function storeSet(obj) {
    return new Promise((resolve) => {
      try {
        if (hasChromeStorage()) {
          chrome.storage.local.set(obj, () => resolve());
          return;
        }
      } catch (e) {}
      Object.keys(obj).forEach((k) => {
        try {
          localStorage.setItem(k, JSON.stringify(obj[k]));
        } catch (e) {}
      });
      resolve();
    });
  }
  function storeRemove(keys) {
    return new Promise((resolve) => {
      try {
        if (hasChromeStorage()) {
          chrome.storage.local.remove(keys, () => resolve());
          return;
        }
      } catch (e) {}
      (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
        try {
          localStorage.removeItem(k);
        } catch (e) {}
      });
      resolve();
    });
  }

  /** Decide which order to apply. Explicit params win; otherwise cache, unless erased. */
  function chooseOrder(paramsOrder, cachedOrder, dismissed) {
    if (paramsOrder && paramsOrder.length) return paramsOrder;
    if (dismissed) return null;
    return cachedOrder && cachedOrder.length ? cachedOrder : null;
  }

  /** Remove all of our decorations and restore GitHub's native file order. */
  function eraseDecorations(root) {
    root.querySelectorAll(".prrs-comment-row").forEach((n) => n.remove());
    root.querySelectorAll(".prrs-badge").forEach((n) => n.remove());
    root.querySelectorAll(".prrs-hl").forEach((n) => n.classList.remove("prrs-hl"));
    root.querySelectorAll("[data-prrs-order]").forEach((n) => n.removeAttribute("data-prrs-order"));
    root.querySelectorAll("[data-prrs-notes]").forEach((n) => n.removeAttribute("data-prrs-notes"));
    const panel = document.getElementById("prrs-panel");
    if (panel) panel.remove();
    const c = filesContainerOf(root);
    if (c && c.__prrsOriginal) {
      c.__prrsOriginal.forEach((el) => {
        if (el && el.parentElement === c) c.appendChild(el);
      });
    }
  }

  const PRReviewSorter = {
    PARAM, PARAM_Z, PARAM_PATHS, PARAM_URL, PARAM_GIST,
    encode, parseOrder, resolveOrder, filesFromData, normalizeNotes,
    inflateToken, deflateToken, b64urlToBytes,
    collectFiles, decorate, makeBadge, makePanel, findLine, makeComment, addNote, applyNotes,
    applyFromLocation, prId, chooseOrder, eraseDecorations, storeGet, storeSet, storeRemove,
    matchFile, filesContainerOf,
  };
  if (typeof window !== "undefined") window.PRReviewSorter = PRReviewSorter;

  // ---- Auto-run on GitHub PR pages ----
  function isFilesView() {
    return /^\/[^/]+\/[^/]+\/pull\/\d+\/(files|changes)\b/.test(location.pathname);
  }
  function alreadyApplied() {
    return !!document.querySelector("[data-prrs-order]");
  }
  function waitingNotesWithDiff() {
    return document.querySelectorAll('[data-prrs-notes="pending"] table').length;
  }

  let busy = false;
  let decoratedCount = 0;
  let waitingCount = 0;
  let capturedUrlKey = null;
  // Resolve params once per URL so remote fetches don't repeat on every mutation.
  let resolvedUrlKey = null;
  let resolvedParamsOrder = null;
  async function paramsOrderFor(loc) {
    const key = (loc.search || "") + (loc.hash || "");
    if (key === resolvedUrlKey) return resolvedParamsOrder;
    resolvedUrlKey = key;
    resolvedParamsOrder = await resolveOrder(loc);
    return resolvedParamsOrder;
  }

  function stripParamsFromUrl() {
    try {
      const u = new URL(location.href);
      const names = [PARAM, PARAM_Z, PARAM_PATHS, PARAM_URL, PARAM_GIST];
      names.forEach((k) => u.searchParams.delete(k));
      const h = (u.hash || "").replace(/^#/, "");
      if (h) {
        const hp = new URLSearchParams(h);
        names.forEach((k) => hp.delete(k));
        const hs = hp.toString();
        u.hash = hs ? "#" + hs : "";
      }
      history.replaceState(null, "", u.toString());
    } catch (e) {}
  }

  async function erase() {
    const id = prId(location.pathname);
    eraseDecorations(document);
    if (id) {
      await storeSet({ [KEY_DISMISS(id)]: true });
      await storeRemove([KEY_ORDER(id)]);
    }
    stripParamsFromUrl();
    resolvedUrlKey = null;
    resolvedParamsOrder = null;
    capturedUrlKey = null;
  }

  async function run() {
    if (busy) return;
    const id = prId(location.pathname);
    if (!id) return;
    busy = true;
    try {
      const paramsOrder = await paramsOrderFor(location);
      // An explicit order on ANY of this PR's pages → cache it and clear any prior erase.
      if (paramsOrder && capturedUrlKey !== resolvedUrlKey) {
        capturedUrlKey = resolvedUrlKey;
        await storeSet({ [KEY_ORDER(id)]: { files: paramsOrder, ts: Date.now() }, [KEY_DISMISS(id)]: false });
      }
      if (!isFilesView()) return; // only the files view has a diff to decorate
      const fileCount = collectFiles(document).size;
      if (!fileCount) return; // files not in the DOM yet
      // GitHub loads big PRs' diffs in batches; sort again when more files or awaited diffs arrive.
      if (alreadyApplied() && fileCount === decoratedCount && waitingNotesWithDiff() === waitingCount) return;
      const st = await storeGet([KEY_ORDER(id), KEY_DISMISS(id)]);
      const cached = st[KEY_ORDER(id)] && st[KEY_ORDER(id)].files;
      const order = chooseOrder(paramsOrder, cached, !!st[KEY_DISMISS(id)]);
      if (!order) return;
      const res = decorate(document, order);
      decoratedCount = res.total;
      waitingCount = waitingNotesWithDiff();
      console.log("[pr-review-sorter] ordered", res.matched, "of", res.total, "files", paramsOrder ? "(from URL)" : "(from cache)");
    } finally {
      busy = false;
    }
  }

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id) {
    document.addEventListener("prrs:erase", erase);
    // GitHub loads diffs progressively and navigates via Turbo; watch for both.
    const obs = new MutationObserver(() => run());
    obs.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener("turbo:load", run);
    document.addEventListener("pjax:end", run);
    run();
  }
})();
