#!/usr/bin/env python3
"""Round-2 fixes: ref-link defs survive commits, autolink/code htmlTagDelta
false positives, NBSP paragraphs preserved, duplicate-raw resolve, whitespace."""
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

    # ── 1. reference-style link definitions survive every commit path ──
    REF_DOC = "Intro with a [ref link][gh] inside.\n\n[gh]: https://github.com \"GitHub\"\n\nOutro paragraph.\n"
    page.evaluate('window.__test.setContent(%s)' % repr(REF_DOC))
    check('refdef: raw join === content', page.evaluate(
        "_currentTokens.map(function(t){return t.raw||''}).join('') === currentContent"))
    check('refdef: link resolved in render', page.evaluate(
        "!!document.querySelector('a[href=\\'https://github.com\\']')"))
    # inline edit commit on the outro paragraph
    page.evaluate("""(function(){
        var bs = document.querySelectorAll('.md-block');
        var target = null;
        bs.forEach(function(b){ if (b.textContent.indexOf('Outro') >= 0) target = b; });
        openBlockEditor(target);
        var p = target.querySelector('p');
        p.textContent = 'Outro paragraph edited.';
        closeBlockEditor(true);
    })()""")
    page.wait_for_timeout(50)
    content = page.evaluate('window.__test.getContent()')
    check('refdef: definition survives inline edit', '[gh]: https://github.com "GitHub"' in content, repr(content))
    check('refdef: edit applied', 'Outro paragraph edited.' in content)
    # structural op
    page.evaluate("""(function(){
        for (var i=0;i<_currentTokens.length;i++)
            if ((_currentTokens[i].raw||'').indexOf('Intro') === 0) { duplicateBlock(i); return; }
    })()""")
    page.wait_for_timeout(50)
    content = page.evaluate('window.__test.getContent()')
    check('refdef: definition survives duplicate', '[gh]: https://github.com "GitHub"' in content, repr(content))

    # ── 2. autolinks / emails / code with tags don't create phantom containers ──
    AUTO_DOC = "See <https://example.com/page> for docs.\n\nContact <admin@example.com> anytime.\n\n```html\n<div>\n<table>\n```\n\nInline `<div>` mention.\n\nFinal block.\n"
    page.evaluate('window.__test.setContent(%s)' % repr(AUTO_DOC))
    counts = page.evaluate("""(function(){
        var blocks = document.querySelectorAll('.md-block').length;
        var handles = document.querySelectorAll('.md-block > .md-block-handles').length;
        return {blocks: blocks, handles: handles};
    })()""")
    check('autolink: all 5 blocks wrapped with handles', counts['blocks'] == 5 and counts['handles'] == 5, counts)
    # move Final block up — should be a clean unit swap
    page.evaluate("""(function(){
        for (var i=0;i<_currentTokens.length;i++)
            if ((_currentTokens[i].raw||'').indexOf('Final block.') === 0) { moveBlockStep(i, -1); return; }
    })()""")
    page.wait_for_timeout(50)
    content = page.evaluate('window.__test.getContent()')
    check('autolink: move keeps code fence byte-intact', '```html\n<div>\n<table>\n```' in content, repr(content))
    check('autolink: Final moved above inline-div para',
          content.find('Final block.') < content.find('Inline `<div>` mention.'), repr(content))

    # ── 3. real unclosed-HTML container still grouped (no regression) ──
    HTMLC_DOC = "Lead para.\n\n<table><tr><td>\n\ncell **md** here\n\n</td></tr></table>\n\nTail para.\n"
    page.evaluate('window.__test.setContent(%s)' % repr(HTMLC_DOC))
    page.evaluate("""(function(){
        for (var i=0;i<_currentTokens.length;i++)
            if ((_currentTokens[i].raw||'').indexOf('Lead para.') === 0) { moveBlockStep(i, +1); return; }
    })()""")
    page.wait_for_timeout(50)
    content = page.evaluate('window.__test.getContent()')
    ok = content.find('<table><tr><td>') < content.find('Lead para.') and 'cell **md** here' in content
    check('htmlcontainer: whole table moves as one unit', ok, repr(content))
    relex = page.evaluate("marked.lexer(currentContent).length > 0")
    check('htmlcontainer: relex sane', relex)

    # ── 4. NBSP spacer paragraph is content, never dropped ──
    NBSP_DOC = "Above.\n\n \n\nBelow.\n"
    page.evaluate('window.__test.setContent(%s)' % repr(NBSP_DOC))
    page.evaluate("""(function(){
        for (var i=0;i<_currentTokens.length;i++)
            if ((_currentTokens[i].raw||'').indexOf('Above.') === 0) { duplicateBlock(i); return; }
    })()""")
    page.wait_for_timeout(50)
    content = page.evaluate('window.__test.getContent()')
    check('nbsp: spacer paragraph survives op', ' ' in content, repr(content))

    # ── 5. duplicate-raw doc: op after editor split targets the RIGHT copy ──
    DUP_DOC = "start block.\n\nsame text.\n\nsame text.\n\nend block.\n"
    page.evaluate('window.__test.setContent(%s)' % repr(DUP_DOC))
    result = page.evaluate("""(function(){
        // open editor on "start block." and split it into 3 paragraphs
        var bs = document.querySelectorAll('.md-block');
        var target = null;
        bs.forEach(function(b){ if (b.textContent.indexOf('start block.') >= 0) target = b; });
        openBlockEditor(target);
        var p = target.querySelector('p');
        p.innerHTML = 'one</p><p>two</p><p>three';
        // find SECOND "same text." token idx (pre-commit)
        var idxs = [];
        for (var i=0;i<_currentTokens.length;i++)
            if ((_currentTokens[i].raw||'').indexOf('same text.') === 0) idxs.push(i);
        var second = idxs[1];
        deleteBlock(second);   // commits the split, then must delete the SECOND copy
        return second;
    })()""")
    page.wait_for_timeout(80)
    content = page.evaluate('window.__test.getContent()')
    first_pos = content.find('same text.')
    check('dupraw: exactly one "same text." left', content.count('same text.') == 1, repr(content))
    check('dupraw: split committed (three paras)', 'one' in content and 'two' in content and 'three' in content, repr(content))
    check('dupraw: remaining copy sits before end block', 0 <= first_pos < content.find('end block.'), repr(content))

    # ── 6. whitespace: repeated inline edits do not grow separators ──
    page.evaluate('window.__test.setContent(%s)' % repr("P one.\n\nP two.\n"))
    for n in range(3):
        page.evaluate("""(function(n){
            var bs = document.querySelectorAll('.md-block');
            var target = null;
            bs.forEach(function(b){ if (b.textContent.indexOf('P one') >= 0) target = b; });
            openBlockEditor(target);
            var p = target.querySelector('p');
            p.textContent = 'P one v' + n + '.';
            closeBlockEditor(true);
        })(%d)""" % n)
        page.wait_for_timeout(30)
    content = page.evaluate('window.__test.getContent()')
    check('whitespace: 3 edits keep single blank separator', '\n\n\n' not in content, repr(content))
    check('whitespace: final edit applied', 'P one v2.' in content, repr(content))

    check('no page errors', len(errors) == 0, errors[:3])
    browser.close()

failed = [r for r in results if not r[1]]
print('\nRESULT: %d/%d passed' % (len(results) - len(failed), len(results)))
sys.exit(1 if failed else 0)
