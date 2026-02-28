# Publish to Google Docs — Obsidian Plugin

Publish Obsidian notes to Google Docs, DOCX, and PDF with one click. Supports LaTeX math, images (including SVG rasterization), callout blocks, code blocks, tables, themes, batch export, and more.

## Free vs Pro

| Feature | Free | Pro ($20 lifetime) |
|---------|:----:|:------------------:|
| One-click publish to Google Docs | ✓ | ✓ |
| LaTeX math (inline & display) | ✓ | ✓ |
| Images with SVG→PNG rasterization | ✓ | ✓ |
| Callout blocks, code, tables, blockquotes | ✓ | ✓ |
| Update existing docs | ✓ | ✓ |
| DOCX export | | ✓ |
| PDF export | | ✓ |
| Batch publish (entire folders) | | ✓ |
| 5 document themes | | ✓ |
| Table of Contents | | ✓ |
| Custom header & footer | | ✓ |

**[Get Pro on Gumroad →](https://9522178230608.gumroad.com/l/svsnaw)**

## Features

### One-Click Publishing
Right-click any `.md` file → **"Publish to Google Docs"**. The plugin converts your note to clean HTML and uploads it as a Google Doc. A link to the published doc is saved in your note's frontmatter for easy re-publishing.

### LaTeX Math
- **Display math:** `$$...$$` (multi-line)
- **Inline math:** `$...$`
- Pre-extracted from raw markdown before rendering — no reverse-engineering of MathJax output
- Output uses `\(...\)` and `\[...\]` delimiters compatible with the [Auto-LaTeX Equations](https://workspace.google.com/marketplace/app/auto_latex_equations/850293439076) Google Docs add-on
- Handles edge cases like `($\Omega$)` without delimiter confusion

### Images
- **Wikilink embeds:** `![[image.png]]`, `![[image.png|500]]` (with width)
- **Standard Markdown:** `![alt](path/to/image.png)`
- **SVG → PNG rasterization:** SVGs are rendered at 2x resolution for crisp output, since Google Docs doesn't support inline SVG
- **Automatic upload:** Images are uploaded to Google Drive and embedded with public URLs
- **Parallel uploads:** Batches of 5 for speed

### Callout Blocks
Obsidian callouts (`> [!note]`, `> [!warning]`, etc.) are converted to styled tables with colored left borders matching Obsidian's color scheme.

Supported types: `note`, `abstract`, `summary`, `info`, `tip`, `hint`, `success`, `check`, `question`, `help`, `warning`, `caution`, `failure`, `danger`, `error`, `bug`, `example`, `quote`, `cite`.

### Other Conversions
- **Code blocks** — monospace font, gray background, proper spacing
- **Inline code** — gray background with padding
- **Blockquotes** — gray left border, indented
- **Tables** — styled borders and padding
- **Wikilinks** — converted to bold text (internal links can't work outside Obsidian)
- **YAML frontmatter** — stripped from output (not shown in Google Doc)

### Update Existing Docs
When re-publishing a note that already has a linked Google Doc, the plugin asks whether to:
- **Update existing** — creates a new version, moves the old doc to trash (recoverable)
- **Create new** — makes a separate Google Doc

### DOCX Export (Pro)
Right-click any `.md` file → **"Export to DOCX"**. Generates a Word document saved alongside your note in the vault. Uses the selected theme for styling. Images are embedded as base64 — no Google Drive upload needed.

### PDF Export (Pro)
Right-click any `.md` file → **"Export to PDF"**. Opens a print dialog with your styled document ready to save as PDF.

### Batch Publish (Pro)
Right-click any folder → **"Publish folder to Google Docs"**. Publishes all markdown files in the folder (recursively, up to 50 notes) with a progress bar and cancel button. 1-second delay between notes to avoid API rate limits.

### Document Themes (Pro)
Five style presets applied to all exports:
- **Default** — Clean sans-serif, matches v1 output
- **Academic** — Serif fonts, conservative styling for papers
- **Business** — Professional, blue accents
- **Minimal** — Sparse, lots of whitespace, subtle styling
- **Colorful** — Vibrant colors, playful feel

### Table of Contents (Pro)
Auto-generates a clickable TOC from your document headings, inserted at the top of the exported document.

### Custom Header & Footer (Pro)
Add text above the title (e.g., "CONFIDENTIAL", "DRAFT") or below the document (e.g., "Generated from Obsidian").

## Setup

### 1. Create a Google Cloud Project
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Go to **APIs & Services → Library**
4. Search for **Google Drive API** and enable it

### 2. Create OAuth Credentials
1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth client ID**
3. Application type: **Desktop app**
4. Name it anything (e.g., "Obsidian Publish")
5. Copy the **Client ID** and **Client Secret**

### 3. Configure the Plugin
1. Open Obsidian **Settings → Community Plugins → Publish to Google Docs**
2. Paste your **Client ID** and **Client Secret**
3. Click **Sign in with Google**
4. Authorize in the browser popup
5. (Optional) Set a **Default Folder ID** from Google Drive to organize published docs

### 4. (Optional) Activate Pro License
1. Purchase a license at [Gumroad](https://9522178230608.gumroad.com/l/svsnaw)
2. In plugin settings, paste your license key and click **Activate**
3. Pro features unlock immediately

### 5. (Optional) Auto-LaTeX Equations Add-on
To render LaTeX as formatted equations in Google Docs:
1. Install the [Auto-LaTeX Equations](https://workspace.google.com/marketplace/app/auto_latex_equations/850293439076) add-on in Google Docs
2. After publishing, open the Google Doc and run the add-on

## How It Works

### Conversion Pipeline

```
Raw Markdown
  ↓ Strip YAML frontmatter
  ↓ Extract code blocks (protect from regex)
  ↓ Extract LaTeX → placeholders
  ↓ Extract images → placeholders
  ↓ Restore code blocks
  ↓ Render via Obsidian's MarkdownRenderer
  ↓ Restore LaTeX as \(...\) / \[...\]
  ↓ Upload images to Drive → replace placeholders with <img>
  ↓ Apply theme styling
  ↓ Clean HTML for Google Docs (callouts, styles, strip classes)
  ↓ Wrap in HTML document
  ↓ Upload to Google Drive as Google Doc
```

### Why Pre-Extract Math & Images?

Post-render extraction (parsing the DOM after Obsidian renders) fails because:
1. **MathJax CHTML** doesn't expose the original TeX source in its output
2. **Image paths** are rendered as `app://` URLs with cache-busting query strings that can't be resolved back to vault files

Pre-extraction captures everything from the raw markdown, which is clean and reliable.

### Authentication

Uses **OAuth 2.0 with PKCE** (Proof Key for Code Exchange):
- A temporary loopback server receives the OAuth callback
- PKCE protects against authorization code interception
- Tokens are stored locally in the plugin's `data.json`
- Access tokens auto-refresh; if the refresh token expires, the plugin triggers a full re-auth

**Scope:** `drive.file` — the plugin can only access files it creates. It cannot read your other Drive files.

### License Validation

Pro licenses are validated against the Gumroad API:
- Lifetime licenses are re-checked every 7 days
- Subscription licenses are re-checked every 24 hours
- 30-day offline grace period if the API is unreachable
- No account creation needed — just a Gumroad license key

## Security

- **Minimal scope:** Only `drive.file` (access files created by this plugin)
- **PKCE auth flow:** Protects against code interception attacks
- **Local credentials:** Tokens stored in `.obsidian/plugins/publish-to-google-docs/data.json`
- **Image visibility:** Uploaded images are made publicly accessible (anyone with the link). Don't publish sensitive images.
- **Vault sync caveat:** If your vault syncs via OneDrive/Dropbox/iCloud, the `data.json` with tokens syncs too. Revoking your Google OAuth consent removes access.

## File Structure

```
src/
├── main.ts          Plugin entry point, file/folder menu registration, What's New modal
├── auth.ts          OAuth 2.0 PKCE flow, loopback server, token management
├── converter.ts     Markdown → HTML conversion pipeline (with ConvertOptions)
├── google-api.ts    Google Drive API (create doc, upload image, delete)
├── publisher.ts     Orchestration, frontmatter, update-choice modal
├── settings.ts      Settings UI tab (license, credentials, auth, drive, export, advanced)
├── types.ts         Shared interfaces, API constants, feature/tier types
├── license.ts       Gumroad license validation, caching, feature gates
├── docx-builder.ts  HTML DOM walker → DOCX objects (uses docx npm package)
├── themes.ts        5 theme presets (Default, Academic, Business, Minimal, Colorful)
├── toc.ts           Table of Contents generator from headings
└── exporters.ts     DOCX export, PDF export, batch publish
```

## Building from Source

```bash
npm install
node esbuild.config.mjs
```

For production (minified, no sourcemaps):
```bash
node esbuild.config.mjs production
```

## Dependencies

- **Runtime:** [Obsidian API](https://github.com/obsidianmd/obsidian-api), [docx](https://www.npmjs.com/package/docx) ^9.6.0
- **Build:** TypeScript 5.8, esbuild 0.24

Uses Obsidian's built-in `requestUrl` for CORS-free HTTP and `MarkdownRenderer` for markdown conversion.

## Support

If you find this plugin useful, consider getting [Pro](https://9522178230608.gumroad.com/l/svsnaw) or donating:

[![PayPal](https://img.shields.io/badge/PayPal-Donate-blue?logo=paypal)](https://www.paypal.com/donate/?business=alex.novickis%40gmail.com)

## License

MIT
