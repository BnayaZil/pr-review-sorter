/*
 * Demo driver. Builds a GitHub-style "Files changed" list (alphabetical), then
 * animates it into the agent's review order using the EXACT badge + panel code
 * from the extension (window.PRReviewSorter). Exposes window.demoSeek(t) so the
 * gif recorder can step the animation deterministically.
 */
(function () {
  "use strict";

  // A believable PR: files listed alphabetically, the way GitHub shows them.
  const FILES = [
    { path: ".github/workflows/ci.yml", add: 6, del: 0, lines: [
      "  test:", "    steps:", "+     - run: npm test", "+       env:", "+         CI: true", "    build:" ] },
    { path: "README.md", add: 4, del: 1, lines: [
      "## Auth", "-Sessions are not supported yet.", "+Sessions are cookie-based.", "+See `src/auth`.", "" ] },
    { path: "package.json", add: 3, del: 0, lines: [
      '  "dependencies": {', '+   "cookie": "^0.6.0",', '+   "iron-session": "^8.0.0"', "  }" ] },
    { path: "src/api/routes.ts", add: 9, del: 2, lines: [
      "import { getSession } from '../auth/session'", "", "-router.post('/login', legacyLogin)", "+router.post('/login', async (req, res) => {",
      "+  const s = await getSession(req)", "+  s.userId = user.id", "+  await s.save()", "+  res.json({ ok: true })", "+})", "" ] },
    { path: "src/auth/session.ts", add: 12, del: 1, lines: [
      "import { getIronSession } from 'iron-session'", "", "+export async function getSession(req) {", "+  return getIronSession(req, {", "+  password: process.env.SESSION_SECRET,",
      "+  cookieName: 'sid',", "+  })", "+}", "+", "+export function clear(s) {", "+  s.destroy()", "+}" ] },
    { path: "src/index.ts", add: 5, del: 1, lines: [
      "import { routes } from './api/routes'", "+import { session } from './auth/session'", "", "-app.use(routes)", "+app.use(session, routes)", "app.listen(3000)" ] },
    { path: "src/utils/logger.ts", add: 4, del: 0, lines: [
      "export const log = (m) => {", "+  if (m.userId) redact(m)", "+  console.log(fmt(m))", "}" ] },
    { path: "tests/auth.test.ts", add: 8, del: 0, lines: [
      "+test('login sets a session', async () => {", "+  const res = await post('/login', creds)", "+  expect(res.status).toBe(200)", "+  expect(cookies(res)).toContain('sid')",
      "+})", "+test('logout clears it', async () => {", "+  // ...", "+})" ] },
  ];

  // The order a reviewer should actually read them in — chosen by the agent.
  const ORDER = [
    {
      path: "src/index.ts",
      reason: "entry point — see how auth is wired in",
      notes: [{ line: 5, text: "Session middleware is added before routes — that ordering is the point of the PR." }],
    },
    {
      path: "src/api/routes.ts",
      reason: "the API surface that changed",
      notes: [{ from: 4, to: 9, text: "New login handler: opens a session, stores the user id, saves it. Is `user` defined in this scope?" }],
    },
    {
      path: "src/auth/session.ts",
      reason: "core logic the routes call",
      notes: [{ line: 5, text: "SESSION_SECRET must be set in prod, or getIronSession throws at boot." }],
    },
    { path: "src/utils/logger.ts", reason: "shared helper touched by the above" },
    { path: "package.json", reason: "new dependencies" },
    { path: ".github/workflows/ci.yml", reason: "CI runs the new test" },
    { path: "tests/auth.test.ts", reason: "tests — read last" },
    { path: "README.md", reason: "docs — skim last" },
  ];

  const filesEl = document.getElementById("files");
  const caption = document.getElementById("caption");

  function rowType(text) {
    if (text.startsWith("+")) return "add";
    if (text.startsWith("-")) return "del";
    return "ctx";
  }

  function buildFile(f) {
    const el = document.createElement("div");
    el.className = "file js-file";
    el.setAttribute("data-tagsearch-path", f.path);

    const header = document.createElement("div");
    header.className = "file-header";
    const info = document.createElement("div");
    info.className = "file-info";
    info.innerHTML =
      '<span class="file-chevron">▾</span>' +
      '<a class="file-path" title="' + f.path + '">' + f.path + "</a>" +
      '<span class="diffstat"><span class="add">+' + f.add + '</span> <span class="del">-' + f.del + "</span></span>";
    header.appendChild(info);

    const body = document.createElement("div");
    body.className = "file-body";
    f.lines.forEach((text, i) => {
      const row = document.createElement("div");
      const t = rowType(text);
      row.className = "diff-row " + t;
      row.setAttribute("data-line-number", i + 1);
      row.innerHTML =
        '<span class="ln">' + (i + 1) + "</span>" +
        '<span class="code">' + text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])) + "</span>";
      body.appendChild(row);
    });

    el.appendChild(header);
    el.appendChild(body);
    return el;
  }

  // 1) Render alphabetically, like GitHub.
  const alpha = FILES.slice().sort((a, b) => a.path.localeCompare(b.path));
  alpha.forEach((f) => filesEl.appendChild(buildFile(f)));

  const map = window.PRReviewSorter.collectFiles(document);

  // 2) Insert the real badges (hidden for now) + the real panel (off-screen).
  ORDER.forEach((item, i) => {
    const el = map.get(item.path);
    if (!el) return;
    const info = el.querySelector(".file-header .file-info");
    const badge = window.PRReviewSorter.makeBadge(i + 1, item.reason);
    badge.style.opacity = "0";
    badge.style.transition = "none";
    info.insertBefore(badge, info.firstChild);
  });
  const panel = window.PRReviewSorter.makePanel(ORDER, map);
  panel.style.opacity = "0";
  panel.style.transform = "translateX(120%)";
  document.body.appendChild(panel);

  // 3) Measure natural (source) and target positions.
  const GAP = 12;
  const src = {};
  const height = {};
  alpha.forEach((f) => {
    const el = map.get(f.path);
    src[f.path] = el.offsetTop;
    height[f.path] = el.offsetHeight + GAP;
  });
  const target = {};
  let acc = filesEl.firstElementChild ? filesEl.firstElementChild.offsetTop : 0;
  ORDER.forEach((item) => {
    target[item.path] = acc;
    acc += height[item.path] || 0;
  });

  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const clamp = (v) => Math.max(0, Math.min(1, v));

  const badges = Array.from(document.querySelectorAll(".prrs-badge"));

  function seek(t) {
    const e = easeInOut(clamp(t));
    ORDER.forEach((item) => {
      const el = map.get(item.path);
      if (!el) return;
      const dy = (target[item.path] - src[item.path]) * e;
      el.style.transform = "translateY(" + dy.toFixed(2) + "px)";
      el.style.zIndex = String(Math.round(dy) + 1000); // rising files slide over
    });
    const b = clamp((t - 0.1) / 0.4);
    badges.forEach((el) => (el.style.opacity = String(b)));
    const p = clamp((t - 0.3) / 0.5);
    panel.style.opacity = String(p);
    panel.style.transform = "translateX(" + ((1 - p) * 120).toFixed(1) + "%)";
    caption.innerHTML =
      t < 0.05
        ? "Files as GitHub shows them — <b>alphabetical</b>."
        : "Reordered by the review agent — <b>entry points first, tests &amp; docs last</b>.";
  }

  // ---- Phase 2: commit the order for real, then reveal highlights + comments ----
  let committed = false;
  let notesApplied = false;
  let commentNodes = [];

  function commit() {
    if (committed) return;
    committed = true;
    ORDER.forEach((item) => {
      const el = map.get(item.path);
      if (!el) return;
      el.style.transform = "";
      el.style.zIndex = "";
      filesEl.appendChild(el); // physical reorder, so inserting comments doesn't fight transforms
    });
    caption.innerHTML = "Now the agent walks you through the diff — <b>highlights &amp; inline comments</b>.";
  }

  function annotate(a) {
    commit();
    if (!notesApplied) {
      notesApplied = true;
      commentNodes = [];
      ORDER.forEach((item) => {
        const el = map.get(item.path);
        if (el && item.notes && item.notes.length) {
          window.PRReviewSorter.applyNotes(el, item.notes).forEach((n) => {
            n.style.transition = "none";
            commentNodes.push(n);
          });
        }
      });
    }
    const o = clamp(a * 1.3);
    commentNodes.forEach((n) => (n.style.opacity = String(o)));
  }

  window.demoSeek = seek;
  window.demoCommit = commit;
  window.demoAnnotate = annotate;
  window.demoReset = () => seek(0);
  seek(0);
  window.demoReady = true;

  // Autoplay when opened directly in a browser (skip with ?static=1 for the recorder).
  if (!/[?&]static/.test(location.search)) {
    const play = () => {
      const hold = 700, reorder = 1600, pause = 550, annot = 1300, end = 2400;
      const start = performance.now();
      function frame(now) {
        const dt = now - start;
        if (dt < hold) seek(0);
        else if (dt < hold + reorder) seek((dt - hold) / reorder);
        else if (dt < hold + reorder + pause) seek(1);
        else if (dt < hold + reorder + pause + annot) annotate((dt - hold - reorder - pause) / annot);
        else annotate(1);
        if (dt < hold + reorder + pause + annot + end) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    };
    play();
    document.body.addEventListener("click", (e) => {
      if (e.target.closest("#prrs-panel")) return;
      location.reload();
    });
  }
})();
