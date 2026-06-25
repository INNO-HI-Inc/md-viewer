#!/usr/bin/env python3
"""
Playwright headless verification for MD Pretty Viewer webview features.

Drives a standalone HTML harness that loads the real editor.js with a mocked
VS Code API. Exercises all v1.0.2 features + regressions on pre-existing
features (tables, code blocks, checkboxes, word count).

Run locally:    python3 tests/verify.py
Run in CI:      see .github/workflows/test.yml
"""
import asyncio
import json
import os
import sys
from pathlib import Path
from playwright.async_api import async_playwright

SCRIPT_DIR = Path(__file__).parent.resolve()
HARNESS = SCRIPT_DIR / "harness.html"
OUT_DIR = SCRIPT_DIR / "evidence"
OUT_DIR.mkdir(exist_ok=True)

results = []


def record(name, passed, detail=""):
    icon = "✅" if passed else "❌"
    line = f"{icon} {name}"
    if detail:
        line += f" — {detail}"
    print(line, flush=True)
    results.append({"name": name, "passed": passed, "detail": detail})


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 900})
        page = await ctx.new_page()

        # Console capture
        console_errors = []
        page.on(
            "console",
            lambda msg: console_errors.append(msg.text) if msg.type == "error" else None,
        )
        page.on("pageerror", lambda err: console_errors.append(f"pageerror: {err}"))

        await page.goto(f"file://{HARNESS}", wait_until="networkidle")
        await page.wait_for_function(
            "window.__test && window.__test.getContent && window.__test.getContent().length > 0",
            timeout=10000,
        )
        await page.wait_for_timeout(400)

        # ── SETUP CHECK ──────────────────────────
        init_errs = [
            e for e in console_errors
            if "Failed to load resource" not in e and "favicon" not in e
        ]
        record(
            "init: no critical console errors",
            len(init_errs) == 0,
            f"errors: {init_errs[:3]}" if init_errs else "clean",
        )
        await page.screenshot(path=str(OUT_DIR / "00-initial-render.png"), full_page=False)

        # ── FEATURE 3: Image lightbox ────────────
        await page.evaluate(
            "window.__test.openLightbox('https://placeholder.example/test.png', 'sample image')"
        )
        await page.wait_for_timeout(250)
        has_lightbox = await page.evaluate("!!window.__test.getLightboxEl()")
        is_visible = await page.evaluate(
            "document.querySelector('.image-lightbox') && document.querySelector('.image-lightbox').classList.contains('show')"
        )
        record("lightbox: opens via click", has_lightbox and is_visible)
        await page.screenshot(path=str(OUT_DIR / "01-lightbox-open.png"))

        await page.keyboard.press("Escape")
        await page.wait_for_timeout(300)
        closed = await page.evaluate("!window.__test.getLightboxEl()")
        record("lightbox: ESC closes", closed)

        # Re-open lightbox twice — no stacking. Note: closeLightbox uses a 180ms
        # fade-out timer, so wait > 200ms before counting to let the prior overlay detach.
        await page.evaluate("window.__test.openLightbox('https://x.test/a.png', 'a')")
        await page.wait_for_timeout(300)
        await page.evaluate("window.__test.openLightbox('https://x.test/b.png', 'b')")
        await page.wait_for_timeout(300)
        count = await page.evaluate("document.querySelectorAll('.image-lightbox').length")
        record("lightbox: re-opening replaces (no stacked overlays)", count == 1, f"count={count}")
        await page.evaluate("window.__test.closeLightbox()")
        await page.wait_for_timeout(250)

        # 10x rapid open/close — leak check
        for _ in range(10):
            await page.evaluate("window.__test.openLightbox('https://x.test/c.png', 't')")
            await page.evaluate("window.__test.closeLightbox()")
        await page.wait_for_timeout(300)
        gone = await page.evaluate("!document.querySelector('.image-lightbox')")
        record(
            "lightbox: cleanup after rapid open/close cycle (listener leak fix)",
            gone is True,
            f"gone={gone}",
        )

        # ── FEATURE 4: Preview Cmd+F search ──────
        await page.evaluate("window.__test.openPreviewSearch()")
        await page.wait_for_timeout(150)
        panel_visible = await page.evaluate(
            "(function(){var p=window.__test.getPreviewSearchPanel(); return p && p.style.display!=='none';})()"
        )
        record("preview-search: panel opens", panel_visible)

        input_sel = ".preview-search-panel .ps-input"
        await page.fill(input_sel, "테마")
        await page.wait_for_timeout(200)
        matches = await page.evaluate("window.__test.getPreviewMatches()")
        record("preview-search: matches found for '테마'", matches >= 2, f"matches={matches}")
        await page.screenshot(path=str(OUT_DIR / "02-preview-search.png"))

        idx_before = await page.evaluate("window.__test.getPreviewActiveIdx()")
        await page.click(".preview-search-panel .ps-next")
        await page.wait_for_timeout(150)
        idx_after = await page.evaluate("window.__test.getPreviewActiveIdx()")
        record("preview-search: next navigation", idx_after != idx_before, f"{idx_before}→{idx_after}")

        # Edge cases
        await page.fill(input_sel, "")
        await page.wait_for_timeout(100)
        m_empty = await page.evaluate("window.__test.getPreviewMatches()")
        record("preview-search: empty query clears", m_empty == 0)

        await page.fill(input_sel, "ZZZNOMATCHZZZ")
        await page.wait_for_timeout(150)
        m_none = await page.evaluate("window.__test.getPreviewMatches()")
        count_text = await page.eval_on_selector(".ps-count", "e => e.textContent")
        record(
            "preview-search: no match shows 0/0",
            m_none == 0 and "0" in count_text,
            f"text='{count_text}'",
        )

        await page.evaluate("window.__test.closePreviewSearch()")
        await page.wait_for_timeout(150)
        residue = await page.evaluate(
            "document.querySelectorAll('mark.preview-search-hit, mark.preview-search-active').length"
        )
        record("preview-search: close clears highlights", residue == 0, f"residue={residue}")

        # ── FEATURE 5: Outline scroll spy ────────
        outline_visible = await page.evaluate(
            "!document.querySelector('.outline-pane').classList.contains('hidden')"
        )
        record("outline: pane visible (showOutline=true respected)", outline_visible)

        item_count = await page.evaluate("document.querySelectorAll('.outline-item').length")
        record("outline: items built", item_count >= 4, f"count={item_count}")

        await page.evaluate(
            "var pc = document.querySelector('.preview-pane'); pc.scrollTo({top: pc.scrollHeight * 0.6, behavior: 'auto'});"
        )
        await page.wait_for_timeout(700)
        active_text = await page.evaluate("window.__test.getOutlineActive()")
        record("outline: active item updates on scroll", active_text is not None, f"active='{active_text}'")
        await page.screenshot(path=str(OUT_DIR / "03-outline-active.png"))

        # ── FEATURE 7: Smart URL paste ───────────
        await page.evaluate("window.__test.setMode('edit')")
        await page.wait_for_timeout(250)
        mode = await page.evaluate("window.__test.getMode()")
        record("paste: switched to edit mode", mode == "edit")

        TEST_TEXT = "여기는 테마 자리입니다."
        await page.evaluate(f"window.__test.setEditorValue({json.dumps(TEST_TEXT)})")
        start = TEST_TEXT.index("테마")
        end = start + len("테마")
        await page.evaluate(f"window.__test.setEditorSelection({start}, {end})")
        await page.evaluate("window.__test.triggerPaste('https://example.com')")
        await page.wait_for_timeout(200)
        new_val = await page.evaluate("window.__test.getEditorValue()")
        expected = "여기는 [테마](https://example.com) 자리입니다."
        record("paste: selection + URL → markdown link", new_val == expected, f"got '{new_val}'")

        await page.evaluate(f"window.__test.setEditorValue({json.dumps('plain text')})")
        await page.evaluate("window.__test.setEditorSelection(5, 5)")
        await page.evaluate("window.__test.triggerPaste('https://no-selection.com')")
        await page.wait_for_timeout(150)
        v = await page.evaluate("window.__test.getEditorValue()")
        record("paste: no selection → handler does not auto-wrap", v == "plain text", f"got '{v}'")

        await page.evaluate(f"window.__test.setEditorValue({json.dumps('select me here')})")
        await page.evaluate("window.__test.setEditorSelection(0, 6)")
        await page.evaluate("window.__test.triggerPaste('not a url')")
        await page.wait_for_timeout(150)
        v2 = await page.evaluate("window.__test.getEditorValue()")
        record("paste: non-URL clipboard → no transform", v2 == "select me here", f"got '{v2}'")

        ml_val = "line one\nline two"
        await page.evaluate(f"window.__test.setEditorValue({json.dumps(ml_val)})")
        await page.evaluate("window.__test.setEditorSelection(5, 12)")
        await page.evaluate("window.__test.triggerPaste('https://multi.example')")
        await page.wait_for_timeout(150)
        v3 = await page.evaluate("window.__test.getEditorValue()")
        record(
            "paste: multi-line selection skipped (no transform)",
            "https://multi.example" not in v3 and v3 == "line one\nline two",
            f"got '{v3}'",
        )

        # ── FEATURE 8: PDF options dialog ────────
        await page.evaluate("window.__test.setMode('preview')")
        await page.wait_for_timeout(200)
        await page.evaluate("window.__test.showPdfDialog()")
        await page.wait_for_timeout(250)
        dialog = await page.evaluate("!!window.__test.getPdfDialog()")
        record("pdf-dialog: opens", dialog)
        await page.screenshot(path=str(OUT_DIR / "04-pdf-dialog.png"))

        defaults = await page.evaluate("""
            (function(){
                var p = document.querySelector('.pdf-options-dialog');
                if (!p) return null;
                var a = {};
                p.querySelectorAll('.pdf-segmented').forEach(function(g){
                    var active = g.querySelector('button.active');
                    a[g.dataset.key] = active ? active.dataset.val : null;
                });
                p.querySelectorAll('input[type=checkbox]').forEach(function(cb){
                    a[cb.dataset.key] = cb.checked;
                });
                return a;
            })()
        """)
        record(
            "pdf-dialog: defaults correct",
            defaults == {"paperSize": "a4", "orientation": "portrait", "margin": "normal", "showHeader": True, "showPageNumber": True},
            f"got {defaults}",
        )

        await page.click('.pdf-options-dialog .pdf-segmented[data-key="orientation"] button[data-val="landscape"]')
        await page.wait_for_timeout(100)
        await page.click('.pdf-options-dialog .pdf-segmented[data-key="paperSize"] button[data-val="letter"]')
        await page.wait_for_timeout(100)
        await page.click('.pdf-options-dialog input[data-key="showPageNumber"]')
        await page.wait_for_timeout(100)
        await page.click('.pdf-options-dialog .pdf-confirm')
        await page.wait_for_timeout(300)

        confirmed = await page.evaluate("window.__lastPdfOpts")
        record(
            "pdf-dialog: confirm passes user opts",
            confirmed
            and confirmed.get("orientation") == "landscape"
            and confirmed.get("paperSize") == "letter"
            and confirmed.get("showPageNumber") is False,
            f"got {confirmed}",
        )

        gone_after = await page.evaluate("!document.querySelector('.pdf-options-dialog')")
        record("pdf-dialog: removed after confirm", gone_after)

        # Regression: BUG-1 phantom Enter trigger
        await page.evaluate("window.__lastPdfOpts = null")
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(150)
        leak = await page.evaluate("window.__lastPdfOpts")
        record("pdf-dialog: no Enter-after-close phantom trigger (BUG-1 fix)", leak is None, f"got {leak}")

        await page.evaluate("window.__test.showPdfDialog()")
        await page.wait_for_timeout(250)
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(250)
        gone2 = await page.evaluate("!document.querySelector('.pdf-options-dialog')")
        record("pdf-dialog: ESC closes", gone2)

        # Restore content (paste tests overwrote it)
        await page.evaluate("window.__test.setContent(window.__sampleMd || '')")
        await page.wait_for_timeout(300)

        # ── SCROLL SYNC (BUG-2 fix) ─────────────
        await page.evaluate("window.__test.setMode('split')")
        await page.wait_for_timeout(500)
        n_anchors = await page.evaluate("window.__test.getScrollAnchors()")
        record(
            "scroll-sync: anchors built including formatted heading (BUG-2 fix)",
            n_anchors >= 7,
            f"anchors={n_anchors}",
        )

        await page.evaluate(
            "var e = document.querySelector('.editor-textarea'); e.scrollTop = e.scrollHeight * 0.4; e.dispatchEvent(new Event('scroll'));"
        )
        await page.wait_for_timeout(300)
        preview_scrolled = await page.evaluate("document.querySelector('.preview-pane').scrollTop > 0")
        record("scroll-sync: editor scroll moves preview", preview_scrolled)

        # ── REGRESSION CHECKS ───────────────────
        await page.evaluate("window.__test.setMode('preview')")
        await page.wait_for_timeout(300)

        stats_text = await page.eval_on_selector(".stats-left", "e => e.textContent")
        has_stats = "words" in stats_text and "min read" in stats_text
        record("regression: word count stats visible", has_stats, f"'{stats_text[:60]}'")

        n_tables = await page.evaluate("document.querySelectorAll('.table-scroll > table').length")
        record("regression: tables wrapped in scroll container", n_tables >= 1, f"wrapped={n_tables}")

        code_headers = await page.evaluate("document.querySelectorAll('.code-block-header').length")
        record("regression: code blocks enhanced", code_headers >= 1, f"headers={code_headers}")

        cb_count = await page.evaluate("document.querySelectorAll('#preview input[type=checkbox]').length")
        record("regression: checkboxes rendered", cb_count >= 3, f"checkboxes={cb_count}")

        await page.screenshot(path=str(OUT_DIR / "05-final-state.png"), full_page=False)

        # ── Summary ─────────────────────────────
        passed = sum(1 for r in results if r["passed"])
        total = len(results)
        print(f"\n{'='*60}", flush=True)
        print(f"RESULT: {passed}/{total} passed", flush=True)
        print(f"{'='*60}", flush=True)

        (OUT_DIR / "results.json").write_text(
            json.dumps(results, ensure_ascii=False, indent=2)
        )
        print(f"Evidence: {OUT_DIR}", flush=True)

        if console_errors:
            non_net = [e for e in console_errors if "Failed to load resource" not in e]
            if non_net:
                print(f"\nConsole errors ({len(non_net)}):", flush=True)
                for e in non_net[:10]:
                    print(f"  - {e}", flush=True)

        await browser.close()
        return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
