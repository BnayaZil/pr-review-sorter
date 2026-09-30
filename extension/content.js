/*
 * PR Review Sorter — content script + reusable core.
 *
 * A code agent decides the best order to read a PR's changed files and encodes
 * that order in the PR URL. This script reads it and reorders GitHub's
 * "Files changed" list to match, adding a numbered badge per file and a
 * clickable order panel.
 *
 * URL contract (two params, checked in this order):
 *   1. pr_order        base64url( JSON {"v":1,"files":[{"p":"path","r":"reason"}]} )
 *   2. pr_order_paths  comma-separated list of encodeURIComponent(path)
 * Either may live in the query string (?...) or the hash (#...).
 *
 * The core (parseOrder / collectFiles / decorate / encode) is exposed on
 * window.PRReviewSorter so the demo page can reuse the exact same code.
 */
(function () {
  "use strict";

  const PARAM = "pr_order";
  const PARAM_PATHS = "pr_order_paths";

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

  /** Parse an order from a search string and/or hash. Returns [{path, reason}] or null. */
  function parseOrder(search, hash) {
    const q = new URLSearchParams(search || "");
    const h = new URLSearchParams((hash || "").replace(/^#/, ""));
    const enc = q.get(PARAM) || h.get(PARAM);
    if (enc) {
      try {
        const data = JSON.parse(b64urlDecode(enc));
        if (data && Array.isArray(data.files)) {
          const out = data.files
            .map((f) => ({
              path: f.p != null ? f.p : f.path,
              reason: f.r != null ? f.r : f.reason || "",
              notes: normalizeNotes(f.notes || f.n),
            }))
            .filter((f) => f.path);
          if (out.length) return out;
        }
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

  /** Map every changed-file element in `root` to its path. */
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
    if (existing) existing.remove();

    const panel = document.createElement("div");
    panel.id = "prrs-panel";

    const head = document.createElement("div");
    head.className = "prrs-panel-head";
    head.innerHTML =
      '<span class="prrs-panel-title">Review order</span>' +
      '<button class="prrs-panel-toggle" title="Collapse">–</button>';
    panel.appendChild(head);

    const list = document.createElement("ol");
    list.className = "prrs-panel-list";

    order.forEach((item, i) => {
      const li = document.createElement("li");
      li.className = "prrs-panel-item";
      if (!map.has(item.path)) li.classList.add("prrs-missing");

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

      const el = map.get(item.path);
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
    return panel;
  }

  // ---- Inline highlights + comments ----

  /** Find the diff line row for a line number. Handles GitHub tables and the demo. */
  function findLine(fileEl, n, side) {
    const demo = fileEl.querySelector('.diff-row[data-line-number="' + n + '"]');
    if (demo) return { row: demo, code: demo };
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

    const filesContainer = root.querySelector("#files") || map.values().next().value.parentElement;
    if (!filesContainer) return { matched: 0, total: map.size };

    // Desired sequence: ordered matches first, then anything the agent left out.
    const orderedEls = [];
    const seen = new Set();
    order.forEach((item, i) => {
      const el = map.get(item.path);
      if (!el || seen.has(el)) return;
      seen.add(el);
      orderedEls.push(el);
      el.setAttribute("data-prrs-order", i + 1);

      // Badge in the file header.
      const header = el.querySelector(".file-header .file-info") || el.querySelector(".file-header") || el;
      if (header && !header.querySelector(".prrs-badge")) {
        header.insertBefore(makeBadge(i + 1, item.reason), header.firstChild);
      }

      if (item.notes && item.notes.length) applyNotes(el, item.notes);
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

  const PRReviewSorter = { PARAM, PARAM_PATHS, encode, parseOrder, normalizeNotes, collectFiles, decorate, makeBadge, makePanel, findLine, makeComment, addNote, applyNotes };
  if (typeof window !== "undefined") window.PRReviewSorter = PRReviewSorter;

  // ---- Auto-run on a real GitHub PR "Files changed" page ----
  function isFilesView() {
    return /^\/[^/]+\/[^/]+\/pull\/\d+\/files\b/.test(location.pathname);
  }

  let lastApplied = "";
  function run() {
    if (!isFilesView()) return;
    const order = parseOrder(location.search, location.hash);
    if (!order) return;
    const key = location.pathname + location.search + location.hash;
    const map = collectFiles(document);
    // Re-apply if the URL changed or files finished loading and none are decorated yet.
    const already = document.querySelector("[data-prrs-order]");
    if (key === lastApplied && already) return;
    if (!map.size) return;
    lastApplied = key;
    const res = decorate(document, order);
    console.log("[pr-review-sorter] ordered", res.matched, "of", res.total, "files");
  }

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id) {
    // GitHub loads diffs progressively and navigates via Turbo; watch for both.
    const obs = new MutationObserver(() => run());
    obs.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener("turbo:load", run);
    document.addEventListener("pjax:end", run);
    run();
  }
})();
