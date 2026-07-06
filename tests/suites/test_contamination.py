#!/usr/bin/env python3
"""v1.0.26 fix verification: preprocessing contamination (Critical 1),
stale blockIdx / "undefined" (Critical 2), neighbor merge, popup/slash
lifecycle, blank-line accumulation."""
import sys
from playwright.sync_api import sync_playwright

import pathlib
HARNESS = (pathlib.Path(__file__).resolve().parents[1] / 'harness.html').as_uri()

RICH_DOC = """# Title

[[TOC]]

First paragraph with a footnote.[^1]

:::note Custom Title
Admonition **body** here.
:::

Second paragraph.

Third paragraph.

[^1]: The footnote definition text.
"""

results = []
def check(name, ok, detail=''):
    results.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + ' - ' + name + (': ' + str(detail) if detail and not ok else ''))

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(HARNESS)
    page.wait_for_function('!!window.__test')

    # ── Group 1: rendering of TOC / admonition / footnote from pristine raws ──
    page.evaluate('window.__test.setContent(%s)' % repr(RICH_DOC))
    check('render: TOC visible', page.evaluate("!!document.querySelector('.md-toc')"))
    check('render: admonition visible', page.evaluate("!!document.querySelector('.md-admonition-note')"))
    check('render: admonition title', page.evaluate("document.querySelector('.md-admonition-title') && document.querySelector('.md-admonition-title').textContent.indexOf('Custom Title') >= 0"))
    check('render: footnote ref sup', page.evaluate("!!document.querySelector('sup.footnote-ref a[href=\\'#fn-1\\']')"))
    check('render: footnote section', page.evaluate("!!document.querySelector('section.footnotes li#fn-1')"))
    check('render: TOC links to headings', page.evaluate("document.querySelectorAll('.md-toc a').length >= 1"))

    # raws stay pristine
    raws_ok = page.evaluate("""(function(){
        var joined = _currentTokens.map(function(t){return t.raw||''}).join('');
        return joined === currentContent;
    })()""")
    check('tokens: raw join === currentContent (pristine)', raws_ok)

    # ── Group 2: Critical 1 — structural op must NOT bake HTML into the file ──
    # insert a block after "Second paragraph."
    idx = page.evaluate("""(function(){
        for (var i=0;i<_currentTokens.length;i++)
            if ((_currentTokens[i].raw||'').indexOf('Second paragraph.') === 0) return i;
        return -1;
    })()""")
    check('setup: found Second paragraph token', idx >= 0, idx)
    page.evaluate('insertBlockAfter(%d, "내용")' % idx)
    page.wait_for_timeout(100)
    content = page.evaluate('window.__test.getContent()')
    check('critical1: [[TOC]] survives insert', '[[TOC]]' in content)
    check('critical1: :::note survives insert', ':::note Custom Title' in content and content.count(':::') >= 2)
    check('critical1: [^1] ref survives insert', '[^1]' in content)
    check('critical1: [^1]: def survives insert', '[^1]: The footnote definition text.' in content)
    check('critical1: no md-toc HTML in file', 'md-toc' not in content)
    check('critical1: no md-admonition HTML in file', 'md-admonition' not in content)
    check('critical1: no footnote-ref HTML in file', 'footnote-ref' not in content)
    check('critical1: no <section HTML in file', '<section' not in content)
    check('critical1: inserted block present', '내용' in content)

    # delete the inserted block again — content should return to original shape
    page.evaluate("""(function(){
        // discard any auto-opened editor on the inserted block first
        if (_activeBlockEdit) closeBlockEditor(false);
        for (var i=0;i<_currentTokens.length;i++)
            if ((_currentTokens[i].raw||'').replace(/\\n+$/,'') === '내용') { deleteBlock(i); return; }
    })()""")
    page.wait_for_timeout(50)
    content = page.evaluate('window.__test.getContent()')
    check('critical1: delete keeps TOC/adm/footnote intact',
          '[[TOC]]' in content and ':::note' in content and '[^1]:' in content and 'md-' not in content)

    # ── Group 3: admonition group ops move/duplicate as ONE unit ──
    MULTI_ADM = """Para above.

:::warning
first body para

second body para
:::

Para below.
"""
    page.evaluate('window.__test.setContent(%s)' % repr(MULTI_ADM))
    span_info = page.evaluate("""(function(){
        var el = document.querySelector('.md-block[data-block-span]');
        return el ? {span: el.dataset.blockSpan, idx: el.dataset.blockIdx} : null;
    })()""")
    check('admonition: multi-token group wrapped with span', bool(span_info) and int(span_info['span']) >= 3, span_info)
    if span_info:
        page.evaluate('duplicateBlock(%d)' % int(span_info['idx']))
        page.wait_for_timeout(50)
        content = page.evaluate('window.__test.getContent()')
        check('admonition: duplicate copies whole ::: block', content.count(':::warning') == 2 and content.count('second body para') == 2)
        check('admonition: duplicate no HTML leak', 'md-admonition' not in content)
        # undo the duplicate
        page.evaluate('undoInlineEdit()')
        page.wait_for_timeout(50)

    # move the admonition up — should swap with "Para above." as a unit
    span_info = page.evaluate("""(function(){
        var el = document.querySelector('.md-block[data-block-span]');
        return el ? {span: el.dataset.blockSpan, idx: el.dataset.blockIdx} : null;
    })()""")
    if span_info:
        page.evaluate('moveBlockStep(%d, -1)' % int(span_info['idx']))
        page.wait_for_timeout(50)
        content = page.evaluate('window.__test.getContent()')
        check('admonition: move-up keeps ::: intact and reorders',
              content.strip().startswith(':::warning') and 'Para above.' in content and 'md-admonition' not in content)

    # ── Group 4: Critical 2 — no "undefined", no wrong-position insert ──
    page.evaluate('window.__test.setContent(%s)' % repr("Alpha.\n\nBeta.\n"))
    # open WYSIWYG editor on Alpha and empty it
    page.evaluate("""(function(){
        var b = document.querySelector('.md-block[data-block-idx="0"]');
        openBlockEditor(b);
        var host = _activeBlockEdit.blockEl;
        host.querySelectorAll(':scope > *:not([data-md-chrome])').forEach(function(n){ n.textContent=''; });
    })()""")
    beta_idx = page.evaluate("""(function(){
        for (var i=0;i<_currentTokens.length;i++)
            if ((_currentTokens[i].raw||'').indexOf('Beta.') === 0) return i;
        return -1;
    })()""")
    page.evaluate('insertBlockAfter(%d, "- 항목")' % beta_idx)
    page.wait_for_timeout(100)
    content = page.evaluate('window.__test.getContent()')
    check('critical2: no literal "undefined" in file', 'undefined' not in content, content)
    check('critical2: insert landed after Beta', content.find('Beta.') < content.find('- 항목'), content)
    page.evaluate('if (_activeBlockEdit) closeBlockEditor(false)')

    # ── Group 5: neighbor merge (heading interrupting paragraphs) ──
    page.evaluate('window.__test.setContent(%s)' % repr("first para\n# Heading\nsecond para\n"))
    h_idx = page.evaluate("""(function(){
        for (var i=0;i<_currentTokens.length;i++)
            if (_currentTokens[i].type === 'heading') return i;
        return -1;
    })()""")
    page.evaluate('deleteBlock(%d)' % h_idx)
    page.wait_for_timeout(50)
    merged = page.evaluate("""(function(){
        var toks = marked.lexer(currentContent).filter(function(t){return t.type==='paragraph'});
        return toks.length;
    })()""")
    check('merge: delete heading keeps 2 separate paragraphs', merged == 2, merged)

    page.evaluate('window.__test.setContent(%s)' % repr("first para\n# Heading\nsecond para\n"))
    h_idx = page.evaluate("""(function(){
        for (var i=0;i<_currentTokens.length;i++)
            if (_currentTokens[i].type === 'heading') return i;
        return -1;
    })()""")
    page.evaluate('moveBlockStep(%d, +1)' % h_idx)
    page.wait_for_timeout(50)
    merged = page.evaluate("""(function(){
        var toks = marked.lexer(currentContent).filter(function(t){return t.type==='paragraph'});
        return toks.length;
    })()""")
    check('merge: move heading down keeps 2 separate paragraphs', merged == 2, merged)

    # ── Group 6: blank-line accumulation ──
    page.evaluate('window.__test.setContent(%s)' % repr("A one.\n\nB two.\n"))
    for _ in range(3):
        page.evaluate("""(function(){
            for (var i=0;i<_currentTokens.length;i++)
                if ((_currentTokens[i].raw||'').indexOf('A one.') === 0) { moveBlockStep(i, +1); return; }
        })()""")
        page.wait_for_timeout(30)
        page.evaluate("""(function(){
            for (var i=0;i<_currentTokens.length;i++)
                if ((_currentTokens[i].raw||'').indexOf('A one.') === 0) { moveBlockStep(i, -1); return; }
        })()""")
        page.wait_for_timeout(30)
    content = page.evaluate('window.__test.getContent()')
    check('whitespace: 6 moves do not grow blank lines', '\n\n\n' not in content and content.count('\n\n') <= 2, repr(content))

    # ── Group 7: popup/slash lifecycle ──
    # 7a. block popup closes when an external update re-renders
    page.evaluate('window.__test.setContent(%s)' % repr("One.\n\nTwo.\n\nThree.\n"))
    page.evaluate("""(function(){
        var btn = document.querySelector('.md-block[data-block-idx="4"] .md-handle-drag');
        openBlockPopup('menu', 4, btn);
    })()""")
    check('lifecycle: popup opened', page.evaluate("!!document.querySelector('.md-block-popup')"))
    page.evaluate("window.postMessage({type:'update', content:'New lead.\\n\\nOne.\\n\\nTwo.\\n\\nThree.\\n'}, '*')")
    page.wait_for_timeout(80)
    check('lifecycle: popup closed by external update', page.evaluate("!document.querySelector('.md-block-popup')"))

    # 7b. slash menu outside click cancels the phantom editor without committing "/x"
    page.evaluate('window.__test.setContent(%s)' % repr("Kappa content.\n\nLambda content.\n"))
    page.evaluate("""(function(){
        var b = document.querySelector('.md-block[data-block-idx="0"]');
        openBlockEditor(b);
        var host = _activeBlockEdit.blockEl;
        host.querySelectorAll(':scope > *:not([data-md-chrome])').forEach(function(n){ n.textContent=''; });
        var p = host.querySelector('p') || host;
        p.textContent = '/x';
        checkWysiwygSlash(host, 0);
    })()""")
    check('lifecycle: slash menu open', page.evaluate('wysiwygSlashIsOpen()'))
    page.mouse.click(10, 500)   # far outside any block
    page.wait_for_timeout(80)
    check('lifecycle: outside click closes slash menu', page.evaluate('!wysiwygSlashIsOpen()'))
    check('lifecycle: outside click clears active editor', page.evaluate('!_activeBlockEdit'))
    content = page.evaluate('window.__test.getContent()')
    check('lifecycle: "/x" NOT committed as content', '/x' not in content and 'Kappa content.' in content, repr(content))

    # 7c. ESC is sticky — typing another char doesn't re-open the menu
    page.evaluate("""(function(){
        var b = document.querySelector('.md-block[data-block-idx="0"]');
        openBlockEditor(b);
        var host = _activeBlockEdit.blockEl;
        host.querySelectorAll(':scope > *:not([data-md-chrome])').forEach(function(n){ n.textContent=''; });
        var p = host.querySelector('p') || host;
        p.textContent = '/';
        checkWysiwygSlash(host, 0);
    })()""")
    check('lifecycle: slash reopened for ESC test', page.evaluate('wysiwygSlashIsOpen()'))
    page.evaluate("""(function(){
        var ev = new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true});
        wysiwygSlashHandleKey(ev);
    })()""")
    check('lifecycle: ESC closes menu', page.evaluate('!wysiwygSlashIsOpen()'))
    page.evaluate("""(function(){
        var host = _activeBlockEdit.blockEl;
        var p = host.querySelector('p') || host;
        p.textContent = '/d';
        checkWysiwygSlash(host, 0);
    })()""")
    check('lifecycle: ESC sticky — /d does not re-open', page.evaluate('!wysiwygSlashIsOpen()'))
    page.evaluate('if (_activeBlockEdit) closeBlockEditor(false)')

    # 7d. pencil-switch while slash open restores the original text
    page.evaluate('window.__test.setContent(%s)' % repr("Mu original.\n\nNu original.\n"))
    page.evaluate("""(function(){
        var b = document.querySelector('.md-block[data-block-idx="0"]');
        openBlockEditor(b);
        var host = _activeBlockEdit.blockEl;
        host.querySelectorAll(':scope > *:not([data-md-chrome])').forEach(function(n){ n.textContent=''; });
        var p = host.querySelector('p') || host;
        p.textContent = '/ta';
        checkWysiwygSlash(host, 0);
        // switch to editing the other block — closeBlockEditor(true) runs inside
        var b2 = document.querySelector('.md-block[data-block-idx="2"]');
        openBlockEditor(b2);
    })()""")
    page.wait_for_timeout(50)
    content = page.evaluate('window.__test.getContent()')
    check('lifecycle: pencil-switch discards "/ta" command text',
          '/ta' not in content and 'Mu original.' in content, repr(content))
    page.evaluate('if (_activeBlockEdit) closeBlockEditor(false)')

    # ── Group 8: chrome leak scan over everything we did ──
    leaks = page.evaluate("""(function(){
        var bad = ['md-handle', 'md-popup', 'data-md-chrome', 'md-block-handles', 'md-drop-indicator', 'md-wslash', '⠿', '✎'];
        var log = (window.__postLog || []).filter(function(m){ return m.type === 'edit'; });
        var hits = [];
        log.forEach(function(m){
            bad.forEach(function(s){ if ((m.content||'').indexOf(s) >= 0) hits.push(s); });
        });
        return hits;
    })()""")
    check('chrome: zero leak strings across all saved contents', len(leaks) == 0, leaks)

    check('no page errors', len(errors) == 0, errors[:3])
    browser.close()

failed = [r for r in results if not r[1]]
print('\nRESULT: %d/%d passed' % (len(results) - len(failed), len(results)))
sys.exit(1 if failed else 0)
