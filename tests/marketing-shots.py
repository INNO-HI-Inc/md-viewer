#!/usr/bin/env python3
"""
Marketing screenshot generator for VS Code Marketplace.

Renders the webview in multiple themes / modes / overlay states and saves
clean 1280-wide PNGs into docs/marketing/.
"""
import asyncio
import sys
from pathlib import Path
from playwright.async_api import async_playwright

REPO = Path(__file__).parent.parent.resolve()
HARNESS = REPO / "tests" / "marketing-harness.html"
OUT = REPO / "docs" / "marketing"
OUT.mkdir(parents=True, exist_ok=True)

# Marketplace recommends 1280x720+, scaled 2x for retina
WIDTH = 1280
HEIGHT = 800


async def boot(page):
    await page.goto(f"file://{HARNESS}", wait_until="networkidle")
    await page.wait_for_function(
        "window.__mkt && document.querySelector('#preview') && document.querySelector('#preview').children.length > 0",
        timeout=10000,
    )
    await page.wait_for_timeout(700)  # let katex/mermaid settle


async def shoot(page, name):
    out = OUT / name
    await page.screenshot(path=str(out), full_page=False)
    print(f"  → {name}")


async def shoot_full(page, name):
    out = OUT / name
    await page.screenshot(path=str(out), full_page=True)
    print(f"  → {name} (full)")


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(
            viewport={"width": WIDTH, "height": HEIGHT},
            device_scale_factor=2,
        )
        page = await ctx.new_page()
        await boot(page)

        # ── 1. Hero — light, blue, preview, outline visible ─────────
        print("HERO")
        await page.evaluate("window.__mkt.setVscodeTheme('vscode-light')")
        await page.evaluate("window.__mkt.setTheme('blue')")
        await page.evaluate("window.__mkt.setMode('preview')")
        await page.evaluate("window.__mkt.setOutline(true)")
        await page.evaluate(
            "var p=document.querySelector('.preview-pane'); if(p) p.scrollTo({top:0});"
        )
        await page.wait_for_timeout(600)
        await shoot(page, "01-hero-light-blue.png")

        # ── 2. Hero — dark, orchid (Pantone), preview ─────────────
        print("DARK HERO")
        await page.evaluate("window.__mkt.setVscodeTheme('vscode-dark')")
        await page.evaluate("window.__mkt.setTheme('orchid')")
        await page.wait_for_timeout(400)
        await shoot(page, "02-hero-dark-orchid.png")

        # ── 3. Theme variety — capture 6 distinct themes ──────────
        print("THEMES")
        themes = [
            ("vscode-light", "blue", "03-theme-blue.png"),
            ("vscode-light", "green", "04-theme-green.png"),
            ("vscode-light", "peach", "05-theme-peach.png"),
            ("vscode-dark", "aqua", "06-theme-aqua.png"),
            ("vscode-light", "sepia", "07-theme-sepia.png"),
            ("vscode-dark", "mist", "08-theme-mist.png"),
        ]
        await page.evaluate("window.__mkt.setOutline(false)")
        for vscode_theme, theme, fname in themes:
            await page.evaluate(f"window.__mkt.setVscodeTheme('{vscode_theme}')")
            await page.evaluate(f"window.__mkt.setTheme('{theme}')")
            await page.evaluate(
                "var p=document.querySelector('.preview-pane'); if(p) p.scrollTo({top:300});"
            )
            await page.wait_for_timeout(350)
            await shoot(page, fname)

        # Reset to top, outline on, light blue
        await page.evaluate("window.__mkt.setVscodeTheme('vscode-light')")
        await page.evaluate("window.__mkt.setTheme('blue')")
        await page.evaluate("window.__mkt.setOutline(true)")
        await page.evaluate(
            "var p=document.querySelector('.preview-pane'); if(p) p.scrollTo({top:0});"
        )
        await page.wait_for_timeout(400)

        # ── 4. Split mode ──────────────────────────────────────
        print("SPLIT")
        await page.evaluate("window.__mkt.setMode('split')")
        await page.evaluate("window.__mkt.setOutline(false)")
        await page.wait_for_timeout(500)
        await shoot(page, "09-split-mode.png")

        # ── 5. PDF dialog ──────────────────────────────────────
        print("PDF DIALOG")
        await page.evaluate("window.__mkt.setMode('preview')")
        await page.wait_for_timeout(300)
        await page.evaluate("window.__mkt.openPdfDialog()")
        await page.wait_for_timeout(500)
        await shoot(page, "10-pdf-dialog.png")
        await page.evaluate("window.__mkt.closeOverlays()")
        await page.wait_for_timeout(200)

        # ── 6. Preview search ──────────────────────────────────
        print("SEARCH")
        await page.evaluate("window.__mkt.openPreviewSearch('LTV')")
        await page.wait_for_timeout(500)
        await shoot(page, "11-preview-search.png")
        await page.evaluate("window.__mkt.closeOverlays()")
        await page.wait_for_timeout(200)

        # ── 7. Outline scroll spy ──────────────────────────────
        print("OUTLINE SPY")
        await page.evaluate("window.__mkt.setOutline(true)")
        await page.evaluate(
            "var p=document.querySelector('.preview-pane'); if(p) p.scrollTo({top: p.scrollHeight*0.55});"
        )
        await page.wait_for_timeout(900)
        await shoot(page, "12-outline-active.png")

        # ── 8. Full-page preview render (showcase ALL content) ─
        print("FULL PAGE")
        await page.evaluate("window.__mkt.setOutline(false)")
        await page.evaluate(
            "var p=document.querySelector('.preview-pane'); if(p) p.scrollTo({top:0});"
        )
        await page.wait_for_timeout(400)
        await shoot_full(page, "13-full-document.png")

        # ── 9. Edit mode showing toolbar / line numbers ─────────
        print("EDIT MODE")
        await page.evaluate("window.__mkt.setMode('edit')")
        await page.wait_for_timeout(400)
        await shoot(page, "14-edit-mode.png")

        print(f"\nDone. Output: {OUT}")
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
