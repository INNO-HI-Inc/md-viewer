#!/usr/bin/env python3
"""Plan D: chrome placement — ✎ in left handle group, ✓✕ in right gutter,
cell ✓✕ above body cells. Verifies buttons never overlap block content."""
import sys
from playwright.sync_api import sync_playwright

import pathlib
HARNESS = (pathlib.Path(__file__).resolve().parents[1] / 'harness.html').as_uri()
DOC = """# Title

A paragraph to edit with some longer content inside it.

| H1 | H2 |
| --- | --- |
| c1 | c2 |
"""

results = []
def check(name, ok, detail=''):
    results.append((name, ok))
    print(('PASS' if ok else 'FAIL') + ' - ' + name + (': ' + str(detail) if detail and not ok else ''))

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1200, 'height': 800})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(HARNESS)
    page.wait_for_function('!!window.__test')
    page.evaluate('window.__test.setContent(%s)' % repr(DOC))

    # 1. handle group composition
    check('para block has [+ drag edit] handles', page.evaluate("""(function(){
        var b = Array.prototype.find.call(document.querySelectorAll('.md-block'), function(x){ return x.querySelector('p') && !x.querySelector('table'); });
        var h = b && b.querySelector(':scope > .md-block-handles');
        return !!(h && h.querySelector('.md-handle-add') && h.querySelector('.md-handle-drag') && h.querySelector('.md-handle-edit'));
    })()"""))
    check('table block has handles but NO pencil', page.evaluate("""(function(){
        var bs = document.querySelectorAll('.md-block');
        for (var i=0;i<bs.length;i++) {
            if (bs[i].querySelector('table')) {
                var h = bs[i].querySelector(':scope > .md-block-handles');
                return !!(h && h.querySelector('.md-handle-add') && !h.querySelector('.md-handle-edit'));
            }
        }
        return false;
    })()"""))
    check('no legacy block-level .md-edit-icon', page.evaluate(
        "document.querySelectorAll('.md-block > .md-edit-icon').length === 0"))
    check('cells still have pencil icons', page.evaluate(
        "document.querySelectorAll('td > .md-edit-icon, th > .md-edit-icon').length >= 4"))

    # 2. handle group sits fully LEFT of block content
    geo = page.evaluate("""(function(){
        var b = Array.prototype.find.call(document.querySelectorAll('.md-block'), function(x){ return x.querySelector('p') && !x.querySelector('table'); });
        var h = b.querySelector(':scope > .md-block-handles');
        var br = b.getBoundingClientRect(), hr = h.getBoundingClientRect();
        return { blockLeft: br.left, handlesRight: hr.right, handlesLeft: hr.left };
    })()""")
    check('handles entirely left of content (no overlap)', geo['handlesRight'] <= geo['blockLeft'] + 1, geo)
    check('handles not clipped off-screen', geo['handlesLeft'] >= 0, geo)

    # 3. open block editor → done/cancel in RIGHT gutter, outside content
    page.evaluate("""(function(){
        var b = Array.prototype.find.call(document.querySelectorAll('.md-block'), function(x){ return x.querySelector('p') && !x.querySelector('table'); });
        openBlockEditor(b);
    })()""")
    geo2 = page.evaluate("""(function(){
        var b = document.querySelector('.md-block-editing');
        var d = b.querySelector(':scope > .md-done-btn');
        var c = b.querySelector(':scope > .md-cancel-btn');
        var br = b.getBoundingClientRect(), dr = d.getBoundingClientRect(), cr = c.getBoundingClientRect();
        return { blockRight: br.right, doneLeft: dr.left, cancelLeft: cr.left,
                 doneTop: dr.top, cancelTop: cr.top, doneRight: dr.right,
                 vw: window.innerWidth };
    })()""")
    check('done btn right of content edge', geo2['doneLeft'] >= geo2['blockRight'] - 1, geo2)
    check('cancel stacked below done', geo2['cancelTop'] > geo2['doneTop'] + 20, geo2)
    check('done btn on-screen', geo2['doneRight'] <= geo2['vw'], geo2)
    page.evaluate('closeBlockEditor(false)')

    # 4. body-cell editor → ✓✕ above the cell
    page.evaluate("""(function(){
        var td = document.querySelector('td');
        openCellEditor(td, parseInt(td.closest('.md-block').dataset.blockIdx, 10), 'markdown');
    })()""")
    geo3 = page.evaluate("""(function(){
        var cell = document.querySelector('td.md-cell-editing');
        var d = cell.querySelector(':scope > .md-done-btn');
        var c = cell.querySelector(':scope > .md-cancel-btn');
        var cr = cell.getBoundingClientRect(), dr = d.getBoundingClientRect(), xr = c.getBoundingClientRect();
        return { cellTop: cr.top, doneBottom: dr.bottom, cancelBottom: xr.bottom };
    })()""")
    check('cell done btn above cell', geo3['doneBottom'] <= geo3['cellTop'] + 1, geo3)
    check('cell cancel btn above cell', geo3['cancelBottom'] <= geo3['cellTop'] + 1, geo3)
    page.evaluate('closeBlockEditor(false)')

    # 5. header-cell editor keeps in-cell corner (no clipping above table)
    page.evaluate("""(function(){
        var th = document.querySelector('th');
        openCellEditor(th, parseInt(th.closest('.md-block').dataset.blockIdx, 10), 'markdown');
    })()""")
    geo4 = page.evaluate("""(function(){
        var cell = document.querySelector('th.md-cell-editing');
        var d = cell.querySelector(':scope > .md-done-btn');
        var cr = cell.getBoundingClientRect(), dr = d.getBoundingClientRect();
        return { inCell: dr.top >= cr.top && dr.bottom <= cr.bottom + 2 };
    })()""")
    check('header cell keeps in-cell done btn', geo4['inCell'], geo4)
    page.evaluate('closeBlockEditor(false)')

    # 6. hover screenshot for the record
    page.hover('.md-block p')
    page.wait_for_timeout(200)
    page.screenshot(path=str(pathlib.Path(__file__).resolve().parents[1] / 'evidence' / 'ui_hover.png'))
    page.evaluate("""(function(){
        var b = Array.prototype.find.call(document.querySelectorAll('.md-block'), function(x){ return x.querySelector('p') && !x.querySelector('table'); });
        openBlockEditor(b);
    })()""")
    page.wait_for_timeout(200)
    page.screenshot(path=str(pathlib.Path(__file__).resolve().parents[1] / 'evidence' / 'ui_editing.png'))
    page.evaluate('closeBlockEditor(false)')

    check('no page errors', len(errors) == 0, errors[:3])
    browser.close()

failed = [r for r in results if not r[1]]
print('\nRESULT: %d/%d passed' % (len(results) - len(failed), len(results)))
sys.exit(1 if failed else 0)
