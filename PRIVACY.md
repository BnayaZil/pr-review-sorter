# Privacy Policy — PR Review Sorter

_Last updated: 2026-10-01_

PR Review Sorter does **not** collect, store, transmit, or sell any personal data.

- **No analytics, no tracking, no accounts.** The extension has no servers of its own.
- **What it reads:** the review plan encoded in the GitHub pull-request URL you open
  (the `#pr_order…` fragment or query parameter), and the pull-request's changed-file
  list already shown on the page — only to reorder and annotate that page in your browser.
- **Network requests:** the extension makes an outbound request **only** when a link uses
  a remote plan (`pr_order_gist` or `pr_order_url`). In that case it fetches the plan JSON
  from the URL/gist named in the link, limited to `api.github.com`,
  `gist.githubusercontent.com`, and `raw.githubusercontent.com`. Nothing about you is sent;
  it is a plain read of the plan you (or your agent) created.
- **Permissions:** the content script runs only on `https://github.com/*/pull/*` pages.
  Host permissions are limited to the three GitHub hosts above, solely for the remote-plan fetch.
- **Storage:** the extension stores nothing on disk or in the cloud.

Questions or issues: https://github.com/BnayaZil/pr-review-sorter/issues
