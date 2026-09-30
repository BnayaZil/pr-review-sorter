---
name: pr-review-sorter
description: >-
  Turn a GitHub PR into a guided, review-ordered link. Use when the user asks to
  review a pull request, order/sort the changed files, or "where do I start
  reading". You pick the order files should be read in AND can highlight specific
  lines with inline comments, then hand back a github.com/.../files URL that the
  PR Review Sorter Chrome extension reorders and annotates the diff to match.
---

# PR Review Sorter

You decide the smartest order to read a PR's changed files, and can highlight key
lines with your own comments; the extension applies both.

## Steps

1. **Get the file list.** `gh pr view <n> --json files -q '.files[].path'` (or read the diff).
2. **Order for a human reviewer**, not alphabetically. A good default:
   entry points / API surface → core logic → callers → config/schema → generated
   or vendored files → tests last. Group related files together.
3. **Write one short reason per file** (why it's here in the order). Reasons are optional but make the link far more useful.
4. **Build the link** (see below) and give it to the user.

## Build the link

Append `?pr_order=<token>` to the PR's **files** URL:

```
https://github.com/<owner>/<repo>/pull/<n>/files?pr_order=<token>
```

`<token>` is base64url of this JSON (drop `=` padding, `+`→`-`, `/`→`_`):

```json
{ "v": 1, "files": [ { "p": "src/index.ts", "r": "entry point" }, { "p": "src/core.ts", "r": "main logic" } ] }
```

- `p` = file path (required), `r` = one-line reason (optional).

Node one-liner:

```bash
node -e 'const f=[{p:"src/index.ts",r:"entry point"},{p:"src/core.ts",r:"main logic"}];
process.stdout.write(Buffer.from(JSON.stringify({v:1,files:f})).toString("base64url"))'
```

## Highlight and comment on lines

Add a `notes` array to any file to highlight lines and attach your own comment —
this is how you guide the reviewer through the actual code, not just the file order.

```json
{ "v": 1, "files": [
  { "p": "src/index.ts", "r": "entry point",
    "notes": [ { "l": 42, "t": "session middleware must run before routes" } ] },
  { "p": "src/api/routes.ts", "r": "the API surface",
    "notes": [ { "f": 10, "to": 18, "t": "new login handler — is `user` in scope here?" } ] }
] }
```

Note fields: `l` = single line, **or** `f`+`to` = a line range. `t` = comment text.
`s` = side, `"R"` for the new/added side (default) or `"L"` for the old side. Line
numbers are the ones shown in the diff gutter.

Same encoding — just include `notes`:

```bash
node -e 'const f=[{p:"src/index.ts",r:"entry point",notes:[{l:42,t:"runs before routes"}]}];
process.stdout.write(Buffer.from(JSON.stringify({v:1,files:f})).toString("base64url"))'
```

Then: `echo "https://github.com/OWNER/REPO/pull/N/files?pr_order=$TOKEN"`

**No reasons?** Use the simpler param instead — comma-separated, each path URL-encoded:
`?pr_order_paths=src%2Findex.ts,src%2Fcore.ts`

## Notes

- Only paths that actually changed in the PR are matched; extras are ignored, missing ones are greyed out in the panel.
- Files you leave out still show — they're kept after the ordered ones.
- The user needs the extension installed (repo README) for the link to reorder the diff.
