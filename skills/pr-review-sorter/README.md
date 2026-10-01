# PR Review Sorter — agent skill

Turn a GitHub PR into a **guided, review-ordered link**: the smartest order to read the
changed files, with inline highlights and comments that walk the reviewer through the diff.

![PR Review Sorter demo](https://raw.githubusercontent.com/BnayaZil/pr-review-sorter/main/assets/demo.gif)

## Install

```bash
npx skills add BnayaZil/pr-review-sorter
```

## What it does

You (the agent) pick a review order for a PR's changed files and, optionally, highlight
specific lines with your own comments. You encode that in the PR's files URL and hand it
back. The companion **PR Review Sorter** Chrome extension reorders the "Files changed"
list to match, numbers each file, shows a clickable order panel, and draws your
highlights and comments inline.

No API, no server — just a link. For big PRs the plan can be compressed or stored in a
gist so the link stays small.

- Full skill instructions: [SKILL.md](SKILL.md)
- Extension + source + the demo above: https://github.com/BnayaZil/pr-review-sorter
