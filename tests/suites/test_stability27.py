#!/usr/bin/env python3
"""v1.0.27 stabilization batch: empty-doc placeholder, redo, frontmatter,
popup nav/scroll-close, toast dedupe, scroll preserve, search restore,
update coalescing, Cmd+S flush, help overlay, sanitize additions, plain
paste, new templates."""
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
    page = browser.new_page(viewport={'width': 1200, 'height': 800})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(HARNESS)
    page.wait_for_function('!!window.__test')

    # ── 1-3. empty document placeholder + bootstrap insert ──
    page.evaluate("window.__test.setContent('')")
    check('empty: placeholder rendered', page.evaluate("!!document.querySelector('.md-empty-add')"))
    page.evaluate("document.querySelector('.md-empty-add').click()")
    check('empty: popup opens', page.evaluate("!!document.querySelector('.md-block-popup')"))
    item_count = page.evaluate("document.querySelectorAll('.md-block-popup .md-popup-item').length")
    check('templates: 13 insert items (image/link added)', item_count == 13, item_count)
    check('templates: icons rendered', page.evaluate(
        "document.querySelectorAll('.md-block-popup .md-popup-icon').length") == 13)
    # pick 제목 1
    page.evaluate("""(function(){
        var items = document.querySelectorAll('.md-block-popup .md-popup-item');
        for (var i=0;i<items.length;i++) if (items[i].textContent.indexOf('제목 1') >= 0) { items[i].click(); return; }
    })()""")
    page.wait_for_timeout(100)
    content = page.evaluate('window.__test.getContent()')
    check('empty: insert into empty doc works', '# 제목' in content, repr(content))
    check('empty: placeholder gone after insert', page.evaluate("!document.querySelector('.md-empty-add')"))
    page.evaluate('if (_activeBlockEdit) closeBlockEditor(false)')
    # delete the only block → placeholder returns
    page.evaluate('deleteBlock(0)')
    page.wait_for_timeout(50)
    check('empty: delete last block restores placeholder', page.evaluate("!!document.querySelector('.md-empty-add')"))

    # ── 4-6. redo ──
    page.evaluate("window.__test.setContent(%s)" % repr("redo base.\n\nother.\n"))
    page.evaluate("""(function(){
        var b = document.querySelector('.md-block[data-block-idx="0"]');
        openBlockEditor(b);
        b.querySelector('p').textContent = 'redo edited.';
        closeBlockEditor(true);
    })()""")
    page.wait_for_timeout(30)
    page.evaluate('undoInlineEdit()')
    page.wait_for_timeout(30)
    check('redo: undo restored base', 'redo base.' in page.evaluate('window.__test.getContent()'))
    check('redo: redoInlineEdit works', page.evaluate('redoInlineEdit()') == True)
    page.wait_for_timeout(30)
    check('redo: content re-applied', 'redo edited.' in page.evaluate('window.__test.getContent()'))
    # new edit clears redo
    page.evaluate('undoInlineEdit()')
    page.evaluate("""(function(){
        var b = document.querySelector('.md-block[data-block-idx="0"]');
        openBlockEditor(b);
        b.querySelector('p').textContent = 'fork edit.';
        closeBlockEditor(true);
    })()""")
    page.wait_for_timeout(30)
    check('redo: new edit invalidates redo', page.evaluate('redoInlineEdit()') == False)

    # ── 7-9. frontmatter ──
    FM_DOC = "---\ntitle: 내 문서\nauthor: innohi\ntags: a, b\n---\n\n# Real Heading\n\nBody para.\n\n[[TOC]]\n"
    page.evaluate("window.__test.setContent(%s)" % repr(FM_DOC))
    check('fm: card rendered', page.evaluate("!!document.querySelector('.md-frontmatter')"))
    check('fm: key/value rows', page.evaluate(
        "document.querySelectorAll('.md-frontmatter .md-fm-row').length") == 3)
    check('fm: raw join pristine', page.evaluate(
        "_currentTokens.map(function(t){return t.raw||''}).join('') === currentContent"))
    toc_items = page.evaluate("Array.from(document.querySelectorAll('.md-toc li')).map(function(x){return x.textContent})")
    check('fm: TOC skips phantom setext heading', toc_items == ['Real Heading'], toc_items)
    # structural op preserves frontmatter syntax
    page.evaluate("""(function(){
        for (var i=0;i<_currentTokens.length;i++)
            if ((_currentTokens[i].raw||'').indexOf('Body para.') === 0) { duplicateBlock(i); return; }
    })()""")
    page.wait_for_timeout(50)
    content = page.evaluate('window.__test.getContent()')
    check('fm: op preserves --- syntax', content.startswith('---\ntitle: 내 문서'), repr(content[:60]))
    check('fm: no card HTML in file', 'md-frontmatter' not in content)
    # fm editor is raw mode
    mode = page.evaluate("""(function(){
        var b = document.querySelector('.md-block[data-block-span]');
        openBlockEditor(b);
        return _activeBlockEdit ? _activeBlockEdit.mode : null;
    })()""")
    check('fm: opens raw editor', mode == 'raw', mode)
    page.evaluate('closeBlockEditor(false)')

    # ── 10-11. popup scroll-close + keyboard nav ──
    page.evaluate("window.__test.setContent(%s)" % repr("One.\n\nTwo.\n"))
    page.evaluate("""(function(){
        var btn = document.querySelector('.md-handle-drag');
        openBlockPopup('menu', 0, btn);
    })()""")
    page.wait_for_timeout(30)
    check('popup: open for nav test', page.evaluate("!!document.querySelector('.md-block-popup')"))
    page.evaluate("""(function(){
        document.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown', bubbles:true, cancelable:true}));
        document.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown', bubbles:true, cancelable:true}));
    })()""")
    active = page.evaluate("(document.querySelector('.md-block-popup .md-popup-item.active')||{}).textContent || null")
    check('popup: arrow nav sets active', active is not None and '아래로' in active, active)
    page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true}))")
    page.wait_for_timeout(50)
    content = page.evaluate('window.__test.getContent()')
    check('popup: Enter picks active (moved down)', content.find('Two.') < content.find('One.'), repr(content))
    check('popup: closed after pick', page.evaluate("!document.querySelector('.md-block-popup')"))
    # scroll closes popup
    page.evaluate("""(function(){
        var btn = document.querySelector('.md-handle-drag');
        openBlockPopup('menu', 0, btn);
    })()""")
    page.wait_for_timeout(30)
    page.evaluate("window.dispatchEvent(new Event('resize'))")
    page.wait_for_timeout(30)
    check('popup: resize closes popup', page.evaluate("!document.querySelector('.md-block-popup')"))

    # ── 12. toast dedupe ──
    page.evaluate("showToast('중복 테스트'); showToast('중복 테스트');")
    count = page.evaluate("document.querySelectorAll('.md-toast').length")
    check('toast: dedupe keeps single element', count == 1, count)

    # ── 13. scroll preserved across commit ──
    long_doc = "\n\n".join("paragraph %d content." % i for i in range(80)) + "\n"
    page.evaluate("window.__test.setContent(%s)" % repr(long_doc))
    page.evaluate("""(function(){
        var sc = document.querySelector('.preview-pane') || previewEl.parentElement;
        sc.style.scrollBehavior = 'auto';   // instant for test setup
        sc.scrollTop = 600;
        sc.style.scrollBehavior = '';
    })()""")
    # edit a block that's currently in view (focus() must not yank the scroll)
    page.evaluate("""(function(){
        var sc = document.querySelector('.preview-pane');
        var target = null;
        document.querySelectorAll('.md-block').forEach(function(b){
            var r = b.getBoundingClientRect();
            if (!target && r.top > 100 && r.top < 400) target = b;
        });
        openBlockEditor(target);
        var p = target.querySelector('p');
        p.textContent = p.textContent + ' EDITED';
        closeBlockEditor(true);
    })()""")
    page.wait_for_timeout(50)
    st = page.evaluate("(document.querySelector('.preview-pane') || previewEl.parentElement).scrollTop")
    check('scroll: preserved across commit', abs(st - 600) < 60, st)

    # ── 14. search highlights restored after commit ──
    page.evaluate("window.__test.setContent(%s)" % repr("find needle one.\n\nneedle two here.\n"))
    page.evaluate("window.__test.openPreviewSearch()")
    page.evaluate("""(function(){
        var input = document.querySelector('.preview-search-panel .ps-input');
        input.value = 'needle';
        input.dispatchEvent(new Event('input', {bubbles:true}));
    })()""")
    page.wait_for_timeout(30)
    before_marks = page.evaluate("document.querySelectorAll('mark.preview-search-hit, mark.preview-search-active').length")
    page.evaluate("""(function(){
        var bs = document.querySelectorAll('.md-block');
        var target = null;
        bs.forEach(function(b){ if (b.textContent.indexOf('two here') >= 0) target = b; });
        openBlockEditor(target);
        closeBlockEditor(true);
    })()""")
    page.wait_for_timeout(60)
    after_marks = page.evaluate("document.querySelectorAll('mark.preview-search-hit, mark.preview-search-active').length")
    check('search: highlights restored after re-render', before_marks == 2 and after_marks == 2, (before_marks, after_marks))
    page.evaluate("window.__test.closePreviewSearch()")

    # ── 15. update storm coalesced ──
    page.evaluate("""(function(){
        for (var i = 0; i < 6; i++) {
            window.postMessage({type:'update', content: 'storm rev ' + i + '.\\n\\nsecond.\\n'}, '*');
        }
    })()""")
    page.wait_for_timeout(400)
    content = page.evaluate('window.__test.getContent()')
    dom_ok = page.evaluate("document.querySelector('.md-block') && document.querySelector('.md-block').textContent.indexOf('storm rev 5.') >= 0")
    check('storm: final content applied + rendered', 'storm rev 5.' in content and dom_ok, repr(content))
    check('storm: tokens fresh after coalesce', page.evaluate(
        "_currentTokens && _currentTokens.map(function(t){return t.raw||''}).join('') === currentContent"))

    # ── 16. Cmd+S flush ──
    page.evaluate("window.__test.setContent(%s)" % repr("flush me.\n"))
    page.evaluate("""(function(){
        window.__postLog = [];
        saveToDocument('flush me edited.\\n');   // starts 300ms debounce
        document.dispatchEvent(new KeyboardEvent('keydown', {key:'s', metaKey:true, bubbles:true, cancelable:true}));
    })()""")
    flushed = page.evaluate("""(function(){
        var log = (window.__postLog||[]).filter(function(m){return m.type==='edit'});
        return log.length === 1 && log[0].content === 'flush me edited.\\n';
    })()""")
    check('cmd+s: pending save flushed immediately', flushed)

    # ── 17. help overlay ──
    page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key:'?', bubbles:true, cancelable:true}))")
    check('help: overlay opens on ?', page.evaluate("!!document.querySelector('.md-help-overlay')"))
    kbd_rows = page.evaluate("document.querySelectorAll('.md-help-row').length")
    check('help: shortcut rows listed', kbd_rows >= 10, kbd_rows)
    page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}))")
    check('help: ESC closes', page.evaluate("!document.querySelector('.md-help-overlay')"))

    # ── 18. sanitize additions render ──
    page.evaluate("window.__test.setContent(%s)" % repr(
        "<figure><img src='https://x/y.png' alt='a'><figcaption>cap</figcaption></figure>\n\nText with <mark>marked</mark> part.\n"))
    check('sanitize: figure/figcaption kept', page.evaluate(
        "!!document.querySelector('.markdown-body figure figcaption')"))
    check('sanitize: mark kept', page.evaluate(
        "!!document.querySelector('.markdown-body mark')"))

    # ── 19. outline empty state ──
    page.evaluate("window.__test.setContent(%s)" % repr("no headings here.\n"))
    check('outline: empty state message', page.evaluate(
        "(document.querySelector('.outline-empty')||{}).textContent === '헤딩이 없습니다'"))

    # ── 20. slash hint footer ──
    page.evaluate("window.__test.setContent(%s)" % repr("slash target.\n"))
    page.evaluate("""(function(){
        var b = document.querySelector('.md-block[data-block-idx="0"]');
        openBlockEditor(b);
        var p = b.querySelector('p') || b;
        p.textContent = '/';
        checkWysiwygSlash(b, 0);
    })()""")
    check('slash: hint footer present', page.evaluate(
        "!!(_wSlashEl && _wSlashEl.querySelector('.md-popup-hint'))"))
    page.evaluate('closeWysiwygSlash(); if (_activeBlockEdit) closeBlockEditor(false)')

    # ── 21. cell paste is plain text ──
    page.evaluate("window.__test.setContent(%s)" % repr("| A | B |\n| --- | --- |\n| c1 | c2 |\n"))
    pasted = page.evaluate("""(function(){
        var td = document.querySelector('td');
        openCellEditor(td, parseInt(td.closest('.md-block').dataset.blockIdx, 10), 'markdown');
        var cell = document.querySelector('td.md-cell-editing');
        var dt = new DataTransfer();
        dt.setData('text/plain', 'plain text');
        dt.setData('text/html', '<b style="color:red">rich</b>');
        var ev = new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true});
        try { Object.defineProperty(ev, 'clipboardData', {value: dt}); } catch(_) {}
        cell.dispatchEvent(ev);
        var html = cell.innerHTML;
        closeBlockEditor(false);
        return html;
    })()""")
    check('cell: paste coerced to plain text', 'plain text' in pasted and 'rich' not in pasted and 'style=' not in pasted, pasted)

    # ── 22. ⠿ while editing reopens menu after commit ──
    page.evaluate("window.__test.setContent(%s)" % repr("edit me block.\n\ntarget menu block.\n"))
    page.evaluate("""(function(){
        var b = document.querySelector('.md-block[data-block-idx="0"]');
        openBlockEditor(b);
    })()""")
    # real mouse press on the other block's drag handle
    page.hover('.md-block[data-block-idx="2"]')
    box = page.evaluate("""(function(){
        var h = document.querySelector('.md-block[data-block-idx="2"] .md-handle-drag');
        var r = h.getBoundingClientRect();
        return {x: r.left + r.width/2, y: r.top + r.height/2};
    })()""")
    page.mouse.click(box['x'], box['y'])
    page.wait_for_timeout(200)
    reopened = page.evaluate("!!document.querySelector('.md-block-popup')")
    check('drag-handle: menu reopens after auto-commit', reopened)
    page.evaluate('closeBlockPopup()')

    check('no page errors', len(errors) == 0, errors[:3])
    browser.close()

failed = [r for r in results if not r[1]]
print('\nRESULT: %d/%d passed' % (len(results) - len(failed), len(results)))
sys.exit(1 if failed else 0)
