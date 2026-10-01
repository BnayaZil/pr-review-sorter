# Publishing guide

## Chrome Web Store

The store requires a one-time developer account and a human review, so these steps are
manual (they need your Google account).

1. **Register** (one-time): https://chrome.google.com/webstore/devconsole — pay the
   one-time US$5 developer fee.
2. **Build the zip:**
   ```bash
   cd extension && zip -r -q ../dist/pr-review-sorter.zip . -x ".*"
   ```
   (or `npm run` nothing — it's just a zip of the `extension/` folder with `manifest.json` at its root.)
3. **New item** → upload `dist/pr-review-sorter.zip`.
4. **Fill the listing** from [`LISTING.md`](LISTING.md) — name, summary, description,
   category (Developer Tools), single-purpose, permission justifications.
5. **Privacy:** set the privacy policy URL to
   `https://raw.githubusercontent.com/BnayaZil/pr-review-sorter/main/PRIVACY.md`, and mark
   "does not collect user data".
6. **Screenshots:** upload the 1280×800 PNGs from [`screenshots/`](screenshots/).
7. **Submit for review.** Approval usually takes a few hours to a few days.
8. **After it's live:** copy the listing URL
   (`https://chrome.google.com/webstore/detail/<slug>/<id>`) and update the two
   cross-links:
   - `README.md` → the "Chrome Web Store" line under **Install**.
   - `skills/pr-review-sorter/SKILL.md` → the "Get the extension" line.

### Optional: automated publishing via the API

If you'd rather push updates from CI, create a Google Cloud OAuth client (Chrome Web
Store API enabled) and a refresh token, then use `chrome-webstore-upload-cli`:

```bash
npx chrome-webstore-upload-cli upload --source dist/pr-review-sorter.zip \
  --extension-id <id> --client-id <id> --client-secret <secret> --refresh-token <token>
npx chrome-webstore-upload-cli publish --extension-id <id> ...
```

The item must have been created once in the dashboard first (step 3).

## skills.sh

The skill is published by being in a public GitHub repo at a discoverable path
(`skills/pr-review-sorter/SKILL.md`) and getting indexed when it's installed:

```bash
npx skills add BnayaZil/pr-review-sorter      # installs + registers (telemetry on by default)
```

No account or login — it uses your Git credentials and only sends the identifier for
repos GitHub confirms are public. It then appears in the https://skills.sh directory.
Users install the same way.
