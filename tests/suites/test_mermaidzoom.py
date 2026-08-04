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
    check('drag pans', 'translate(60px, 30px)' in t2, t2)

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

    # image lightbox still works (shared engine)
    page.evaluate("""()=>{ var i=document.querySelector('#preview img'); if(i) i.click(); }""")
    page.wait_for_timeout(150)
    check('image lightbox still opens (shared engine)', page.evaluate("!!document.querySelector('.image-lightbox img')"))
    page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))")

    check('no page errors', len(errors) == 0, errors[:3])
    b.close()

failed = [r for r in results if not r[1]]
print('\nRESULT: %d/%d passed' % (len(results) - len(failed), len(results)))
sys.exit(1 if failed else 0)
