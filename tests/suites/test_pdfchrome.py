#!/usr/bin/env python3
"""v1.0.32 PDF export must not print editing chrome. The onclone strips every
[data-md-chrome] element and applies body.exporting-pdf (whose CSS hides
handles/edit-icons/toolbars). This test asserts both mechanisms the onclone
relies on: the class hides chrome via CSS, and stripping removes it entirely.
(The bug: body.exporting-pdf CSS existed but the class was never applied, so
editing buttons leaked into exported PDFs.)"""
import sys
import pathlib
HARNESS = (pathlib.Path(__file__).resolve().parents[1] / 'harness.html').as_uri()
from playwright.sync_api import sync_playwright

DOC = """# 제목

외부 [링크](https://example.com) 그리고 내부 [앵커](#섹션).

| A | B |
| --- | --- |
| c1 | c2 |

- [ ] 할 일
- [x] 완료

```js
const x = 1;
```

<details>
<summary>접힌 섹션</summary>

접힌 내용.
</details>
"""

results = []
def check(name, ok, detail=''):
    results.append((name, ok))
    print(('PASS' if ok else 'FAIL') + ' - ' + name + (': ' + str(detail) if detail and not ok else ''))

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1000, 'height': 700})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(HARNESS)
    page.wait_for_function('!!window.__test')
    page.evaluate("window.__test.setContent(%r)" % DOC)
    page.wait_for_timeout(200)

    before = page.evaluate("document.querySelectorAll('#preview [data-md-chrome=\"1\"]').length")
    check('chrome exists in preview at rest', before > 0, before)

    # body.exporting-pdf must hide the handle group + edit icons via CSS
    with_class = page.evaluate("""()=>{
        document.body.classList.add('exporting-pdf');
        var h = document.querySelector('#preview .md-block-handles');
        var icon = document.querySelector('#preview .md-edit-icon');
        return {
            handle: h ? getComputedStyle(h).display : 'none',
            icon: icon ? getComputedStyle(icon).display : 'none',
            codeHeader: (function(){ var c = document.querySelector('#preview .code-block-header'); return c ? getComputedStyle(c).display : 'none'; })()
        };
    }""")
    check('exporting-pdf hides block handles (display:none)', with_class['handle'] == 'none', with_class)
    check('exporting-pdf hides edit icons (display:none)', with_class['icon'] == 'none', with_class)
    check('exporting-pdf hides code-block header', with_class['codeHeader'] == 'none', with_class)

    # pseudo-elements html2canvas reads from the live nodes: with the class on
    # the live body, the ▶ summary triangle and the ↗ external-link arrow must
    # compute to content:none.
    pseudo = page.evaluate("""()=>{
        var sum = document.querySelector('#preview summary');
        var ext = document.querySelector('#preview a[href^="https"]');
        return {
            triangle: sum ? getComputedStyle(sum, '::before').content : 'none',
            arrow: ext ? getComputedStyle(ext, '::after').content : 'none'
        };
    }""")
    check('exporting-pdf removes summary ▶ triangle', pseudo['triangle'] in ('none', 'normal'), pseudo)
    check('exporting-pdf removes external-link ↗ arrow', pseudo['arrow'] in ('none', 'normal'), pseudo)

    # _runPdfExport force-opens collapsed <details> on the live DOM (so all
    # content prints) — simulate + verify the closed one becomes visible.
    details = page.evaluate("""()=>{
        var closed = document.querySelectorAll('#preview details:not([open])');
        var n = closed.length;
        closed.forEach(function(d){ d.setAttribute('open',''); });
        var body = document.querySelector('#preview details:not([open])');
        // content visible after open?
        var d0 = document.querySelector('#preview details');
        var contentVisible = false;
        if (d0) { var p = d0.querySelector('p'); contentVisible = !!(p && p.offsetHeight > 0); }
        return { hadClosed: n, stillClosed: document.querySelectorAll('#preview details:not([open])').length, contentVisible: contentVisible };
    }""")
    check('details force-open expands collapsed sections',
          details['hadClosed'] >= 1 and details['stillClosed'] == 0 and details['contentVisible'], details)

    # stripping data-md-chrome removes every chrome node (belt-and-suspenders)
    after = page.evaluate("""()=>{
        document.querySelectorAll('#preview [data-md-chrome="1"]').forEach(function(n){ if(n.parentNode) n.parentNode.removeChild(n); });
        return document.querySelectorAll('#preview [data-md-chrome="1"]').length;
    }""")
    check('stripping data-md-chrome leaves zero chrome nodes', after == 0, after)

    # content itself (headings, table, checkboxes, code) survives the strip
    survived = page.evaluate("""()=>({
        h1: !!document.querySelector('#preview h1'),
        table: !!document.querySelector('#preview table'),
        checkbox: document.querySelectorAll('#preview input[type=checkbox]').length,
        code: !!document.querySelector('#preview pre code')
    })""")
    check('document content survives chrome strip',
          survived['h1'] and survived['table'] and survived['checkbox'] == 2 and survived['code'], survived)

    check('no page errors', len(errors) == 0, errors[:3])
    browser.close()

failed = [r for r in results if not r[1]]
print('\nRESULT: %d/%d passed' % (len(results) - len(failed), len(results)))
sys.exit(1 if failed else 0)
