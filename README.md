# PR Review Sorter

A tiny Chrome extension that lets a **code agent decide the order you read a PR in**.

GitHub shows a PR's changed files alphabetically. That's rarely the order that makes
a review easy. This extension reads a review order the agent encoded in the PR URL and
reorders the "Files changed" list to match — entry points first, tests and docs last —
with a numbered badge on each file and a clickable order panel.

The agent can also **highlight specific lines and drop inline comments** to walk you
through the diff — all encoded in the same link, no API and no server.

![PR Review Sorter reordering a PR's files](assets/demo.gif)

## How it works

1. A code agent (Claude, etc.) looks at a PR and picks a sensible reading order, a short reason per file, and — optionally — highlights key lines with inline comments.
2. It encodes all of that into the PR's files URL — in the `#hash` by default.
3. You open the link. The extension reorders the diff, numbers each file, shows the order panel, and draws the highlights + comments inline.

The agent needs no API and no server — it just builds a URL.

## Install (unpacked)

1. `git clone https://github.com/BnayaZil/pr-review-sorter.git`
2. Open `chrome://extensions`, turn on **Developer mode**.
3. **Load unpacked** → select the `extension/` folder.
4. Open any `…/pull/<n>/files#pr_order=…` link.

## The URL contract

The agent puts the review plan on a PR's **files** URL
(`https://github.com/<owner>/<repo>/pull/<n>/files`) — **in the hash (`#…`) by default**,
because the hash is never sent to GitHub's server and so can't trip GitHub's ~7 KB
"URI too long" limit that a long `?query` would. Pick the carrier by plan size:

| Param | Carrier value | Use when |
|-------|---------------|----------|
| `pr_order` | base64url of `{"v":1,"files":[{"p","r","notes"}]}` | normal PRs |
| `pr_order_z` | base64url of **raw-DEFLATE** of that JSON | big plans (≈33 KB → ≈1 KB; inflates in <1 ms) |
| `pr_order_gist` | a **public** gist id holding the JSON | huge plans / reuse across machines |
| `pr_order_url` | an https URL to the JSON | self-hosted (allowed hosts below) |
| `pr_order_paths` | comma-separated `encodeURIComponent(path)` | quick, no reasons/notes |

Any param also works in the `?query` for short links. Remote params
(`pr_order_gist` / `pr_order_url`) are fetched by the extension's background worker;
allowed hosts are `api.github.com`, `gist.githubusercontent.com`,
`raw.githubusercontent.com`. Files the agent leaves out still show (after the ordered
ones); paths not in the PR are greyed out in the panel.

Build a plain link in one line:

```bash
node -e 'const f=[{p:"src/index.ts",r:"entry point"},{p:"src/core.ts",r:"main logic"}];
const t=Buffer.from(JSON.stringify({v:1,files:f})).toString("base64url");
console.log("https://github.com/OWNER/REPO/pull/N/files#pr_order="+t)'
```

…or a compressed one for a big plan (swap `#pr_order=` → `#pr_order_z=`):

```bash
node -e 'const z=require("zlib");const f=[{p:"src/index.ts",r:"entry point"}];
const t=z.deflateRawSync(Buffer.from(JSON.stringify({v:1,files:f}))).toString("base64url");
console.log("https://github.com/OWNER/REPO/pull/N/files#pr_order_z="+t)'
```

### Highlights + inline comments

Give any file a `notes` array to highlight lines and attach the agent's comments:

```json
{ "v": 1, "files": [
  { "p": "src/index.ts", "r": "entry point",
    "notes": [ { "l": 42, "t": "session middleware must run before routes" } ] },
  { "p": "src/api/routes.ts", "r": "the API surface",
    "notes": [ { "f": 10, "to": 18, "t": "new login handler — is `user` in scope?" } ] }
] }
```

| Note field | Meaning |
|------------|---------|
| `l` | a single line number (diff gutter) |
| `f` + `to` | a line range |
| `s` | side: `"R"` new/added (default) or `"L"` old |
| `t` | the comment text |

## The agent skill

[`skill/SKILL.md`](skill/SKILL.md) is a short [Agent Skill](https://docs.claude.com/en/docs/claude-code/skills)
that teaches an agent the whole flow: list files, order them for a human, build the link.
To use it with Claude Code, drop the folder into `~/.claude/skills/pr-review-sorter/`
(or your project's `.claude/skills/`). Then: *"review PR 128 and give me a sorted link."*

## Try the demo

Open [`demo/demo.html`](demo/demo.html) in a browser — it mimics a real GitHub PR page
(same DOM classes) and animates the reorder using the extension's own code. It's also
what the gif above is recorded from.

## Repo layout

| Path | What |
|------|------|
| `extension/` | The Chrome extension (MV3): `manifest.json`, `content.js`, `background.js`, `styles.css`, `icons/` |
| `skill/SKILL.md` | The agent skill explaining the integration |
| `demo/` | Self-contained demo page used for the gif |
| `test/` | `fixture.html` + `run-tests.mjs` (Playwright end-to-end tests) |
| `scripts/` | `build-gif.mjs`, `make-icons.mjs` (Playwright + ffmpeg) |
| `assets/demo.gif` | The demo recording |

## Tests

```bash
npm i playwright && npx playwright install chromium
node test/run-tests.mjs
```

Covers every carrier (hash, query, compressed), the inflate performance of a large
compressed plan, and the remote-gist wiring.

## Rebuild the gif / icons

```bash
npm i playwright && npx playwright install chromium   # ffmpeg also required
node scripts/make-icons.mjs
node scripts/build-gif.mjs
```

## License

MIT — see [LICENSE](LICENSE).
