#!/usr/bin/env python3
"""
Marketing screenshot generator — framed macOS-window captures on a soft
backdrop, rendered from the REAL editor.css/editor.js.

Outputs polished PNGs into docs/marketing/ and the hero into docs/screenshot.png.
"""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

REPO = Path(__file__).parent.parent.resolve()
FRAME = REPO / "tests" / "frame-harness.html"
OUT = REPO / "docs" / "marketing"
OUT.mkdir(parents=True, exist_ok=True)

# Outer viewport = window (1240x800) + backdrop padding. 2x for retina.
VW, VH = 1360, 924


async def get_frame(page):
    # file:// iframes are cross-origin (origin "null") to the outer page, so
    # drive the app frame directly via Playwright instead of a JS proxy.
    for f in page.frames:
        if "marketing-harness" in (f.url or ""):
            return f
    return None


async def boot(page):
    await page.goto(f"file://{FRAME}", wait_until="networkidle")
    frame = None
    for _ in range(50):
        frame = await get_frame(page)
        if frame:
            break
        await page.wait_for_timeout(100)
    if not frame:
        raise RuntimeError("app iframe never appeared")
    await frame.wait_for_function(
        "window.__mkt && document.querySelector('#preview') && document.querySelector('#preview').children.length > 0",
        timeout=15000,
    )
    await page.wait_for_timeout(1200)  # katex/mermaid settle
    return frame


async def call(frame, name, *args):
    await frame.evaluate(
        "([n,a]) => { var m = window.__mkt; if (m && m[n]) return m[n].apply(m, a); }",
        [name, list(args)],
    )


async def backdrop(page, cls):
    await page.evaluate("c => window.__frame.backdrop(c)", cls)


async def shoot(page, name, out_dir=OUT):
    await page.wait_for_timeout(120)
    await page.screenshot(path=str(out_dir / name), full_page=False)
    print(f"  → {name}")


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(
            viewport={"width": VW, "height": VH},
            device_scale_factor=2,
        )
        page = await ctx.new_page()
        frame = await boot(page)

        # ── HERO — light, blue, preview, outline ────────────────────
        print("HERO")
        await backdrop(page, "light")
        await call(frame, "setVscodeTheme", "vscode-light")
        await call(frame, "setTheme", "blue")
        await call(frame, "setMode", "preview")
        await call(frame, "setOutline", True)
        await call(frame, "scrollTop")
        await page.wait_for_timeout(700)
        await shoot(page, "01-hero-light-blue.png")
        # also the README/homepage hero
        await page.screenshot(path=str(REPO / "docs" / "screenshot.png"), full_page=False)
        print("  → ../screenshot.png")

        # ── DARK HERO — orchid ──────────────────────────────────────
        print("DARK HERO")
        await backdrop(page, "dark")
        await call(frame, "setVscodeTheme", "vscode-dark")
        await call(frame, "setTheme", "orchid")
        await page.wait_for_timeout(500)
        await shoot(page, "02-hero-dark-orchid.png")

        # ── BLOCK EDITING (the headline feature) ────────────────────
        # Insert-menu open + handles revealed on a heading block
        print("BLOCK EDITING")
        await backdrop(page, "light")
        await call(frame, "setVscodeTheme", "vscode-light")
        await call(frame, "setTheme", "blue")
        await call(frame, "setOutline", False)
        await page.wait_for_timeout(300)
        await call(frame, "openInsertMenu", "핵심 의사결정")
        await page.wait_for_timeout(500)
        await shoot(page, "15-block-insert.png")
        await call(frame, "closeOverlays")

        # Gutter handles (＋ ⠿ ✎) revealed on a block
        print("BLOCK HANDLES")
        await page.wait_for_timeout(200)
        await call(frame, "showHandles", "사용자가 무료 체험")
        await page.wait_for_timeout(400)
        await shoot(page, "16-block-handles.png")
        await call(frame, "closeOverlays")

        # ── THEME VARIETY ───────────────────────────────────────────
        print("THEMES")
        await call(frame, "setOutline", False)
        themes = [
            ("light", "vscode-light", "blue", "03-theme-blue.png"),
            ("light", "vscode-light", "green", "04-theme-green.png"),
            ("peach", "vscode-light", "peach", "05-theme-peach.png"),
            ("dark", "vscode-dark", "aqua", "06-theme-aqua.png"),
            ("sepia", "vscode-light", "sepia", "07-theme-sepia.png"),
            ("dark", "vscode-dark", "mist", "08-theme-mist.png"),
        ]
        for bg, vtheme, theme, fname in themes:
            await backdrop(page, bg)
            await call(frame, "setVscodeTheme", vtheme)
            await call(frame, "setTheme", theme)
            await call(frame, "scrollTo", 0.18)
            await page.wait_for_timeout(450)
            await shoot(page, fname)

        # reset
        await backdrop(page, "light")
        await call(frame, "setVscodeTheme", "vscode-light")
        await call(frame, "setTheme", "blue")
        await call(frame, "scrollTop")
        await page.wait_for_timeout(400)

        # ── SPLIT MODE ──────────────────────────────────────────────
        print("SPLIT")
        await call(frame, "setMode", "split")
        await call(frame, "setOutline", False)
        await page.wait_for_timeout(600)
        await shoot(page, "09-split-mode.png")

        # ── PDF DIALOG ──────────────────────────────────────────────
        print("PDF DIALOG")
        await call(frame, "setMode", "preview")
        await page.wait_for_timeout(300)
        await call(frame, "openPdfDialog")
        await page.wait_for_timeout(500)
        await shoot(page, "10-pdf-dialog.png")
        await call(frame, "closeOverlays")

        # ── PREVIEW SEARCH ──────────────────────────────────────────
        print("SEARCH")
        await call(frame, "openPreviewSearch", "LTV")
        await page.wait_for_timeout(500)
        await shoot(page, "11-preview-search.png")
        await call(frame, "closeOverlays")

        # ── OUTLINE SPY ─────────────────────────────────────────────
        print("OUTLINE SPY")
        await call(frame, "setOutline", True)
        await call(frame, "scrollTo", 0.5)
        await page.wait_for_timeout(900)
        await shoot(page, "12-outline-active.png")

        # ── EDIT MODE ───────────────────────────────────────────────
        print("EDIT MODE")
        await call(frame, "setOutline", False)
        await call(frame, "setMode", "edit")
        await call(frame, "scrollTop")
        await page.wait_for_timeout(400)
        await shoot(page, "14-edit-mode.png")

        print(f"\nDone. Output: {OUT}")
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
