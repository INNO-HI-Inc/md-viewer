# Tests

Headless verification of the webview features without launching VS Code.

## What this is

`harness.html` loads the real `media/editor.js` with a mocked `acquireVsCodeApi`. The webview boots in a vanilla Chromium and exposes its internals via `window.__test`. `verify.py` drives Playwright to exercise each feature plus edge cases.

This is the same harness used to verify v1.0.2 (31/31 checks, including 3 bug-fix regressions).

## Run locally

```bash
pip install playwright
playwright install chromium
python3 tests/verify.py
```

Screenshots and `results.json` land in `tests/evidence/`.

## What it covers

| Area | Checks |
|------|--------|
| Image lightbox | open, ESC, no stacking, 10× rapid open/close (listener leak) |
| Preview Cmd+F search | matches, next-nav, empty query, no-match, residue cleanup |
| Outline scroll spy | active item updates on scroll |
| Smart URL paste | selection, no-selection, non-URL, multi-line skip |
| PDF options dialog | defaults, confirm, ESC, phantom-Enter regression (BUG-1) |
| Split scroll sync | anchor count with formatted heading (BUG-2), editor → preview |
| Regressions | word count, table wrappers, code headers, checkboxes |

## CI

`.github/workflows/test.yml` runs this on every push to main and every PR.

## Limits

The harness can't reproduce:
- VS Code host ↔ webview `postMessage` round-trips
- Actual PDF file output from html2pdf
- Cmd+F conflict with VS Code's native find widget
- Real theme switching driven by VS Code config

Those still need manual verification in the actual extension after install.
