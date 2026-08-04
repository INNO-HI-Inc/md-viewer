#!/usr/bin/env python3
"""v1.0.36 Mermaid zoom/pan: a rendered diagram gets a zoom button + click,
opening it in the shared zoom/pan overlay (wheel-zoom, drag-pan, dbl-reset,
ESC). The zoom engine is shared with the image lightbox."""
import sys, pathlib
HARNESS = (pathlib.Path(__file__).resolve().parents[1] / 'harness.html').as_uri()
from playwright.sync_api import sync_playwright

DOC = """# 다이어그램

```mermaid
flowchart LR
    A[시작] --> B{조건}
    B -->|예| C[처리 1]
    B -->|아니오| D[처리 2]
    C --> E[끝]
    D --> E
```

일반 이미지도 확인: ![x](https://example.com/i.png)
"""

results = []
def check(name, ok, detail=''):
    results.append((name, ok))
    print(('PASS' if ok else 'FAIL') + ' - ' + name + (': ' + str(detail) if detail and not ok else ''))

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 1000, 'height': 800})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(HARNESS)
    page.wait_for_function('!!window.__test')
    page.evaluate("window.__test.setContent(%r)" % DOC)
    page.wait_for_function("!!document.querySelector('.mermaid-diagram svg')", timeout=15000)
    page.wait_for_timeout(300)

    check('mermaid rendered to svg', page.evaluate("!!document.querySelector('.mermaid-diagram svg')"))
    # v1.0.37: viewBox padded so the bottom row of text isn't clipped
    check('svg viewBox padded (no bottom clipping)',
          page.evaluate("document.querySelector('.mermaid-diagram svg').dataset.vbPadded") == '1')
    # v1.0.38: flowchart nodes are colored by hierarchy level (distinct fills)
    distinct_fills = page.evaluate("""() => {
        var s = new Set();
        document.querySelectorAll('.mermaid-diagram g.node').forEach(function (n) {
            var sh = n.querySelector('rect, polygon, circle, ellipse, path');
            if (sh && sh.style && sh.style.fill) s.add(sh.style.fill);
        });
        return s.size;
    }""")
    check('nodes colored by level (>=2 distinct fills)', distinct_fills >= 2, distinct_fills)
    # v1.0.39: the color toggle turns per-level coloring off (single flat color)
    page.evaluate("_mermaidLevelColors = false; renderPreview();")
    page.wait_for_function("!!document.querySelector('.mermaid-diagram svg')", timeout=15000)
    page.wait_for_timeout(300)
    off_fills = page.evaluate("""() => {
        var s = new Set();
        document.querySelectorAll('.mermaid-diagram g.node').forEach(function (n) {
            var sh = n.querySelector('rect, polygon, circle, ellipse, path');
            if (sh && sh.style && sh.style.fill) s.add(sh.style.fill);
        });
        return s.size;
    }""")
    check('color toggle OFF -> no per-level fills', off_fills == 0, off_fills)
    page.evaluate("_mermaidLevelColors = true; renderPreview();")
    page.wait_for_function("!!document.querySelector('.mermaid-diagram svg')", timeout=15000)
    page.wait_for_timeout(300)
    check('zoom button added', page.evaluate("!!document.querySelector('.mermaid-zoom-btn')"))
    check('zoom button is chrome (stripped on save/pdf)',
          page.evaluate("document.querySelector('.mermaid-zoom-btn').dataset.mdChrome") == '1')

    # open via button
    page.evaluate("document.querySelector('.mermaid-zoom-btn').click()")
    page.wait_for_timeout(150)
    check('overlay opens with cloned svg', page.evaluate("!!document.querySelector('.image-lightbox .lightbox-svg')"))
    check('original diagram svg untouched', page.evaluate("!!document.querySelector('.mermaid-diagram svg')"))

    # wheel zoom changes transform scale
    t0 = page.evaluate("document.querySelector('.image-lightbox .lightbox-svg').style.transform")
    page.evaluate("""()=>document.querySelector('.image-lightbox').dispatchEvent(
        new WheelEvent('wheel',{deltaY:-120,clientX:500,clientY:400,bubbles:true,cancelable:true}))""")
    page.wait_for_timeout(60)
    t1 = page.evaluate("document.querySelector('.image-lightbox .lightbox-svg').style.transform")
    check('wheel zooms in', t0 != t1 and 'scale(1.12' in t1, (t0, t1))

    # drag pans (translate changes)
    page.evaluate("""()=>{
        var el = document.querySelector('.image-lightbox .lightbox-svg');
        el.dispatchEvent(new MouseEvent('mousedown',{clientX:400,clientY:300,bubbles:true,cancelable:true}));
        window.dispatchEvent(new MouseEvent('mousemove',{clientX:460,clientY:330,bubbles:true}));
        window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
    }""")
    page.wait_for_timeout(60)
    t2 = page.evaluate("document.querySelector('.image-lightbox .lightbox-svg').style.transform")
    import re
    _m = re.search(r'translate\(([-\d.]+)px,\s*([-\d.]+)px\)', t2)
    _dx = float(_m.group(1)) if _m else None
    _dy = float(_m.group(2)) if _m else None
    check('drag pans', _dx is not None and abs(_dx - 60) < 1 and abs(_dy - 30) < 1, t2)

    # double-click resets
    page.evaluate("""()=>document.querySelector('.image-lightbox .lightbox-svg').dispatchEvent(
        new MouseEvent('dblclick',{clientX:500,clientY:400,bubbles:true,cancelable:true}))""")
    page.wait_for_timeout(60)
    t3 = page.evaluate("document.querySelector('.image-lightbox .lightbox-svg').style.transform")
    check('double-click resets to scale 1', 'scale(1)' in t3 and 'translate(0px, 0px)' in t3, t3)

    # ESC closes
    page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))")
    page.wait_for_timeout(300)
    check('ESC closes overlay', page.evaluate("!document.querySelector('.image-lightbox')"))

    # v1.0.37: in dark mode the overlay SVG background follows the theme (not a
    # hardcoded white card that would break a dark-rendered diagram).
    page.evaluate("""
        document.body.classList.remove('vscode-light');
        document.body.classList.add('vscode-dark');
        document.documentElement.style.setProperty('--vscode-editor-background', '#0d1117');
        document.documentElement.style.setProperty('--vscode-editor-foreground', '#e6edf3');
    """)
    page.evaluate("window.__test.setContent(%r)" % DOC)
    page.wait_for_function("!!document.querySelector('.mermaid-diagram svg')", timeout=15000)
    page.wait_for_timeout(300)
    page.evaluate("document.querySelector('.mermaid-zoom-btn').click()")
    page.wait_for_timeout(150)
    dark_bg = page.evaluate("getComputedStyle(document.querySelector('.image-lightbox .lightbox-svg')).backgroundColor")
    check('dark-mode overlay bg is not white', dark_bg not in ('rgb(255, 255, 255)', 'rgba(0, 0, 0, 0)'), dark_bg)
    page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))")
    page.wait_for_timeout(200)
    page.evaluate("""
        document.body.classList.remove('vscode-dark');
        document.body.classList.add('vscode-light');
    """)

    # v1.0.37: PDF export rasterizes each Mermaid diagram to a PNG <img> (inline
    # SVG can't be captured by html2canvas → prints blank). Verify the swap
    # produces a real PNG and restore() puts the live SVG back.
    page.evaluate("window.__test.setContent(%r)" % DOC)
    page.wait_for_function("!!document.querySelector('.mermaid-diagram svg')", timeout=15000)
    page.wait_for_timeout(200)
    page.evaluate("""
        window.__pdfPrepDone = false;
        prepareMermaidForPdf(document.querySelector('#preview')).then(function (r) {
            window.__pdfRestore = r; window.__pdfPrepDone = true;
        });
    """)
    page.wait_for_function("window.__pdfPrepDone === true", timeout=15000)
    img_src = page.evaluate("(document.querySelector('.mermaid-diagram .mermaid-pdf-img')||{}).src || ''")
    check('PDF swap produced a PNG raster', img_src.startswith('data:image/png'), img_src[:40])
    # ".mermaid-diagram > svg" targets the diagram's own svg (the color-toggle
    # button also contains an icon <svg>, so a bare "svg" query would match that).
    check('live SVG detached during PDF capture',
          page.evaluate("!document.querySelector('.mermaid-diagram > svg')"))
    page.evaluate("if (window.__pdfRestore) window.__pdfRestore();")
    page.wait_for_timeout(100)
    check('PDF restore removes raster + restores SVG',
          page.evaluate("!document.querySelector('.mermaid-pdf-img') && !!document.querySelector('.mermaid-diagram > svg')"))

    # v1.0.38: the −/＋ font control also resizes Mermaid (re-renders diagrams)
    LABEL_SEL = ".mermaid-diagram svg .nodeLabel, .mermaid-diagram svg text"
    page.evaluate("window.__test.setContent(%r)" % DOC)
    page.wait_for_function("!!document.querySelector(%r)" % LABEL_SEL, timeout=15000)
    page.wait_for_timeout(200)
    fs0 = page.evaluate("parseFloat(getComputedStyle(document.querySelector(%r)).fontSize)" % LABEL_SEL)
    page.evaluate("changeFontSize(1); changeFontSize(1); changeFontSize(1); changeFontSize(1);")
    page.wait_for_timeout(700)
    page.wait_for_function("!!document.querySelector(%r)" % LABEL_SEL, timeout=15000)
    fs1 = page.evaluate("parseFloat(getComputedStyle(document.querySelector(%r)).fontSize)" % LABEL_SEL)
    check('font control resizes mermaid labels', fs1 > fs0, (fs0, fs1))
    page.evaluate("changeFontSize(-1); changeFontSize(-1); changeFontSize(-1); changeFontSize(-1);")
    page.wait_for_timeout(500)

    # v1.0.40: sequence diagrams color each actor column + carry the in-diagram
    # color toggle button (chrome, stripped on save/PDF)
    SEQ = "# s\n\n```mermaid\nsequenceDiagram\n    participant A as 가\n    participant B as 나\n    participant C as 다\n    A->>B: x\n    B->>C: y\n```\n"
    page.evaluate("window.__test.setContent(%r)" % SEQ)
    page.wait_for_function("!!document.querySelector('.mermaid-diagram svg rect.actor')", timeout=15000)
    page.wait_for_timeout(300)
    seq_fills = page.evaluate("""() => {
        var s = new Set();
        document.querySelectorAll('.mermaid-diagram svg rect.actor').forEach(function (a) {
            if (a.style && a.style.fill) s.add(a.style.fill);
        });
        return s.size;
    }""")
    check('sequence actors colored per column (>=2)', seq_fills >= 2, seq_fills)
    cbtn = page.evaluate("""() => {
        var b = document.querySelector('.mermaid-diagram .mermaid-color-btn');
        return { present: !!b, chrome: b && b.dataset.mdChrome };
    }""")
    check('in-diagram color toggle present + is chrome', cbtn['present'] and cbtn['chrome'] == '1', cbtn)

    # image lightbox still works (shared engine)
    page.evaluate("window.__test.setContent(%r)" % DOC)
    page.wait_for_timeout(200)
    page.evaluate("""()=>{ var i=document.querySelector('#preview img'); if(i) i.click(); }""")
    page.wait_for_timeout(150)
    check('image lightbox still opens (shared engine)', page.evaluate("!!document.querySelector('.image-lightbox img')"))
    page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))")

    check('no page errors', len(errors) == 0, errors[:3])
    b.close()

failed = [r for r in results if not r[1]]
print('\nRESULT: %d/%d passed' % (len(results) - len(failed), len(results)))
sys.exit(1 if failed else 0)
