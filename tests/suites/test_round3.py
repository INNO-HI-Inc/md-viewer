#!/usr/bin/env python3
"""Round-3 fixes: cell footnote/TOC de-render, stale-idx editor switch,
checkbox token sync, [[TOC]]-no-headings, alt-attr protection, single-word
footnote defs, fence-aware admonitions, external-update invalidation."""
import sys
from playwright.sync_api import sync_playwright

import pathlib
HARNESS = (pathlib.Path(__file__).resolve().parents[1] / 'harness.html').as_uri()
results = []
def check(name, ok, detail=''):
    results.append((name, ok))
    print(('PASS' if ok else 'FAIL') + ' - ' + name + (': ' + str(detail) if detail and not ok else ''))

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(HARNESS)
    page.wait_for_function('!!window.__test')

    # ── 1. table cell containing a footnote ref: untouched commit is a no-op ──
    DOC1 = "# H\n\nBody ref.[^1]\n\n| A | B |\n| --- | --- |\n| uses[^1] | plain |\n\n[^1]: The def has several words.\n"
    page.evaluate('window.__test.setContent(%s)' % repr(DOC1))
    check('cell-fn: sup rendered in cell', page.evaluate("!!document.querySelector('td sup.footnote-ref')"))
    page.evaluate("""(function(){
        var td = null;
        document.querySelectorAll('td').forEach(function(c){ if (c.textContent.indexOf('uses') >= 0) td = c; });
        openCellEditor(td, parseInt(td.closest('.md-block').dataset.blockIdx, 10), 'markdown');
        closeBlockEditor(true);   // untouched commit
    })()""")
    page.wait_for_timeout(50)
    content = page.evaluate('window.__test.getContent()')
    check('cell-fn: [^1] survives untouched cell commit', 'uses[^1]' in content, repr(content))
    check('cell-fn: no rendered link baked in', '](#fn-' not in content and 'footnote-ref' not in content, repr(content))

    # ── 2. [[TOC]] in a cell: untouched commit no-op ──
    DOC2 = "# H\n\n| A |\n| --- |\n| [[TOC]] here |\n"
    page.evaluate('window.__test.setContent(%s)' % repr(DOC2))
    page.evaluate("""(function(){
        var td = document.querySelector('td');
        openCellEditor(td, parseInt(td.closest('.md-block').dataset.blockIdx, 10), 'markdown');
        closeBlockEditor(true);
    })()""")
    page.wait_for_timeout(50)
    content = page.evaluate('window.__test.getContent()')
    check('cell-toc: [[TOC]] survives untouched cell commit', '[[TOC]] here' in content and 'md-toc' not in content, repr(content))

    # ── 3. [[TOC]] with no headings: raw fallback, marker survives ──
    DOC3 = "[[TOC]]\n\nOnly paragraphs here.\n"
    page.evaluate('window.__test.setContent(%s)' % repr(DOC3))
    check('toc-empty: placeholder rendered', page.evaluate("!!document.querySelector('.md-toc-empty')"))
    mode = page.evaluate("""(function(){
        var b = document.querySelector('.md-block[data-block-idx="0"]');
        openBlockEditor(b);
        return _activeBlockEdit ? _activeBlockEdit.mode : null;
    })()""")
    check('toc-empty: opens RAW editor (not wysiwyg)', mode == 'raw', mode)
    page.evaluate('closeBlockEditor(true)')   # untouched commit
    page.wait_for_timeout(50)
    content = page.evaluate('window.__test.getContent()')
    check('toc-empty: [[TOC]] survives untouched commit', '[[TOC]]' in content, repr(content))

    # ── 4. footnote ref in image alt: attribute untouched, commit safe ──
    DOC4 = "Image ![diagram [^1] label](x.png) end.[^1]\n\n[^1]: A def with words.\n"
    page.evaluate('window.__test.setContent(%s)' % repr(DOC4))
    alt_ok = page.evaluate("""(function(){
        var img = document.querySelector('.md-block img');
        return img ? img.getAttribute('alt') : null;
    })()""")
    check('alt: attribute not rewritten', alt_ok is not None and 'sup' not in alt_ok and '<' not in alt_ok, alt_ok)
    page.evaluate("""(function(){
        var b = document.querySelector('.md-block[data-block-idx="0"]');
        openBlockEditor(b);
        closeBlockEditor(true);
    })()""")
    page.wait_for_timeout(50)
    content = page.evaluate('window.__test.getContent()')
    check('alt: no renderer HTML in file after commit', 'footnote-ref' not in content and '<sup' not in content, repr(content))

    # ── 5. editor switch after split: correct target block opens ──
    DOC5 = "alpha one.\n\nbravo two.\n\ncharlie three.\n"
    page.evaluate('window.__test.setContent(%s)' % repr(DOC5))
    opened = page.evaluate("""(function(){
        var bs = document.querySelectorAll('.md-block');
        var a = null, c = null;
        bs.forEach(function(b){
            if (b.textContent.indexOf('alpha') >= 0) a = b;
            if (b.textContent.indexOf('charlie') >= 0) c = b;
        });
        openBlockEditor(a);
        var p = a.querySelector('p');
        p.innerHTML = 'a1</p><p>a2</p><p>a3';   // split into 3 → +4 token shift
        // click ✎ path on charlie while alpha's editor is open
        openBlockEditor(c);
        return _activeBlockEdit ? editableTextOf(_activeBlockEdit.blockEl).trim() : null;
    })()""")
    page.wait_for_timeout(50)
    check('switch: correct block opened after split', opened is not None and 'charlie' in opened, opened)
    page.evaluate('if (_activeBlockEdit) closeBlockEditor(false)')
    content = page.evaluate('window.__test.getContent()')
    check('switch: split committed, charlie intact', 'a2' in content and 'charlie three.' in content, repr(content))

    # ── 6. checkbox toggle then structural op keeps the check ──
    DOC6 = "- [ ] task one\n- [ ] task two\n\nTail para.\n"
    page.evaluate('window.__test.setContent(%s)' % repr(DOC6))
    page.evaluate("""(function(){
        var box = document.querySelector('input[type=checkbox]');
        box.checked = true;
        box.dispatchEvent(new Event('change', {bubbles: true}));
    })()""")
    page.wait_for_timeout(50)
    page.evaluate("""(function(){
        for (var i=0;i<_currentTokens.length;i++)
            if ((_currentTokens[i].raw||'').indexOf('Tail para.') === 0) { duplicateBlock(i); return; }
    })()""")
    page.wait_for_timeout(50)
    content = page.evaluate('window.__test.getContent()')
    check('checkbox: toggle survives structural op', '- [x] task one' in content, repr(content))

    # ── 7. single-word footnote def: content preserved through ops ──
    DOC7 = "Uses a short note.[^1]\n\n[^1]: Note.\n\nEnd para.\n"
    page.evaluate('window.__test.setContent(%s)' % repr(DOC7))
    check('shortdef: raw join preserved', page.evaluate(
        "_currentTokens.map(function(t){return t.raw||''}).join('') === currentContent"))
    page.evaluate("""(function(){
        for (var i=0;i<_currentTokens.length;i++)
            if ((_currentTokens[i].raw||'').indexOf('End para.') === 0) { duplicateBlock(i); return; }
    })()""")
    page.wait_for_timeout(50)
    content = page.evaluate('window.__test.getContent()')
    check('shortdef: [^1]: Note. survives op', '[^1]: Note.' in content, repr(content))

    # ── 8. fence containing ::: inside an admonition renders un-corrupted ──
    DOC8 = ":::note\nbefore fence\n```\n:::\nliteral colons above\n```\nafter fence\n:::\n\nTail.\n"
    page.evaluate('window.__test.setContent(%s)' % repr(DOC8))
    render = page.evaluate("""(function(){
        var adm = document.querySelector('.md-admonition');
        return adm ? adm.textContent : null;
    })()""")
    check('admfence: admonition rendered', render is not None, render)
    check('admfence: no literal </div> leak', render is not None and '</div>' not in render, render)
    check('admfence: fence content inside box', render is not None and 'literal colons above' in render and 'after fence' in render, render)
    content = page.evaluate('window.__test.getContent()')
    check('admfence: raws pristine', ':::note' in content and content.count('```') == 2, repr(content))

    # ── 9. external update kills undo + pending save ──
    DOC9 = "undo base.\n\nsecond block.\n"
    page.evaluate('window.__test.setContent(%s)' % repr(DOC9))
    page.evaluate("""(function(){
        var b = document.querySelector('.md-block[data-block-idx="0"]');
        openBlockEditor(b);
        var p = b.querySelector('p');
        p.textContent = 'undo edited.';
        closeBlockEditor(true);
    })()""")
    page.wait_for_timeout(30)
    page.evaluate("window.postMessage({type:'update', content:'EXTERNAL WINS.\\n\\nsecond block.\\n'}, '*')")
    page.wait_for_timeout(400)   # past the 300ms save debounce
    undo_result = page.evaluate('undoInlineEdit()')
    content = page.evaluate('window.__test.getContent()')
    check('external: undo stack invalidated', undo_result == False and 'EXTERNAL WINS.' in content, (undo_result, repr(content)))
    stale_save = page.evaluate("""(function(){
        var log = (window.__postLog || []).filter(function(m){ return m.type === 'edit'; });
        var last = log[log.length - 1];
        return last ? last.content.indexOf('undo base.') >= 0 : false;
    })()""")
    check('external: no stale debounced save posted', stale_save == False, stale_save)

    check('no page errors', len(errors) == 0, errors[:3])
    browser.close()

failed = [r for r in results if not r[1]]
print('\nRESULT: %d/%d passed' % (len(results) - len(failed), len(results)))
sys.exit(1 if failed else 0)
