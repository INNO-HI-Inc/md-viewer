#!/usr/bin/env python3
"""UI language (v1.0.44): English mode shows NO Korean anywhere in the
viewer chrome, and Korean mode keeps the exact strings of earlier versions.

English mode is simulated the way the extension does it: window.__mdpvLang
is set before editor.js loads (Playwright init script). The document itself
is English-only, so any Hangul found in the page is leaked UI text."""
import pathlib
import re
import sys
from playwright.sync_api import sync_playwright

HARNESS = (pathlib.Path(__file__).resolve().parents[1] / 'harness.html').as_uri()
EVIDENCE = pathlib.Path(__file__).resolve().parents[1] / 'evidence'
HANGUL = re.compile(r'[가-힣ㄱ-ㆎ]')

DOC = """---
title: Sample
author: Someone
---

# Getting Started

[[TOC]]

A paragraph with a [link](https://example.com) inside.

## Table

| Name | Value |
| --- | --- |
| a | 1 |
| b | 2 |

## Code

```js
console.log('hi');
```

```mermaid
graph TD
  A --> B
```
"""

results = []
def check(name, ok, detail=''):
    results.append((name, ok))
    print(('PASS' if ok else 'FAIL') + ' - ' + name + (': ' + str(detail)[:400] if detail and not ok else ''))

# Everything a user can read or a screen reader announces.
HARVEST = """(function(){
    var out = [document.body.innerText];
    document.querySelectorAll('[title],[aria-label],[placeholder]').forEach(function (el) {
        ['title', 'aria-label', 'placeholder'].forEach(function (a) {
            var v = el.getAttribute(a); if (v) out.push(v);
        });
    });
    return out.join('\\n');
})()"""

SAVE_STATES = """(function(){
    var el = document.querySelector('.save-state'), out = [];
    ['dirty', 'saving', 'saved'].forEach(function (s) { setSaveState(s); out.push(el.textContent); });
    return out.join('|');
})()"""

def hangul_in(page):
    found = HANGUL.findall(page.evaluate(HARVEST))
    if not found:
        return ''
    text = page.evaluate(HARVEST)
    return [l for l in text.split('\n') if HANGUL.search(l)][:10]

def open_page(p, lang):
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1280, 'height': 860})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    if lang:
        page.add_init_script('window.__mdpvLang = %r;' % lang)
    page.goto(HARNESS)
    page.wait_for_function('!!window.__test')
    page.evaluate('window.__test.setContent(%r)' % DOC)
    return browser, page, errors

def first_block_with(page, selector):
    return page.evaluate_handle("""(sel) => Array.prototype.find.call(
        document.querySelectorAll('.md-block'), function (b) { return b.querySelector(sel); })""", selector)

with sync_playwright() as p:
    # ───────────────────────── English ─────────────────────────
    browser, page, errors = open_page(p, 'en')
    check('en: MDPV_LANG is en', page.evaluate('MDPV_LANG') == 'en')
    check('en: string table has no Korean', not [
        (k, v) for k, v in page.evaluate('L10N.en').items() if HANGUL.search(v)])
    check('en: every ko key has an en translation',
          page.evaluate("Object.keys(L10N.ko).filter(function(k){ return !(k in L10N.en); })") == [])

    page.wait_for_selector('.mermaid-zoom-btn', timeout=15000)
    check('en: base view (topbar, outline, frontmatter, TOC, mermaid buttons)', not hangul_in(page), hangul_in(page))
    check('en: frontmatter title', page.evaluate("document.querySelector('.md-fm-title').textContent") == 'Document Info')
    check('en: TOC title', page.evaluate("document.querySelector('.md-toc-title').textContent") == 'Table of Contents')
    check('en: save states', page.evaluate(SAVE_STATES) == '● Modified|◐ Saving|✓ Saved')
    check('en: mermaid zoom title', page.evaluate("document.querySelector('.mermaid-zoom-btn').title") == 'Zoom in / out · Pan')

    # Block ＋ insert menu and ⠿ block menu
    page.evaluate("openBlockPopup('insert', 0, document.querySelector('.md-handle-add'))")
    check('en: insert-block menu', not hangul_in(page), hangul_in(page))
    labels = page.evaluate("Array.from(document.querySelectorAll('.md-block-popup')).map(function(e){return e.innerText}).join('|')")
    check('en: insert menu lists Heading 1 / Table', 'Heading 1' in labels and 'Table' in labels, labels)
    page.screenshot(path=str(EVIDENCE / 'i18n-en-insert-menu.png'))
    page.evaluate('closeBlockPopup()')
    page.evaluate("openBlockPopup('menu', 0, document.querySelector('.md-handle-drag'))")
    check('en: block menu (move / duplicate / delete)', not hangul_in(page), hangul_in(page))
    page.evaluate('closeBlockPopup()')

    # Inserted templates are English (they land in the user's file!)
    raws = page.evaluate("INSERT_BLOCKS.map(function(b){return b.raw}).join('\\n')")
    check('en: insert templates contain no Korean', not HANGUL.search(raws), raws)

    # Table cell editor → table toolbar
    page.evaluate("""(function(){
        var td = document.querySelector('.markdown-body td');
        var b = td.closest('.md-block');
        openCellEditor(td, Number(b.dataset.blockIdx), 'td');
    })()""")
    page.wait_for_selector('.md-table-toolbar', timeout=3000)
    check('en: table toolbar + cell editor', not hangul_in(page), hangul_in(page))
    tb = page.evaluate("Array.from(document.querySelectorAll('.md-table-toolbar button')).map(function(b){return b.textContent}).join(' ')")
    check('en: table toolbar labels', tb.startswith('＋Row －Row ＋Col －Col'), tb)
    page.screenshot(path=str(EVIDENCE / 'i18n-en-table-toolbar.png'))
    page.evaluate('closeBlockEditor(false)')

    # Code block editor (language label)
    page.evaluate("""(function(){
        var b = Array.prototype.find.call(document.querySelectorAll('.md-block'), function(x){ return x.querySelector('pre code.language-js, pre code.hljs'); });
        openBlockEditor(b);
    })()""")
    check('en: code editor language label',
          page.evaluate("(document.querySelector('.md-code-lang-label')||{}).textContent") == 'Language')
    check('en: code editor chrome', not hangul_in(page), hangul_in(page))
    page.evaluate('closeBlockEditor(false)')

    # Paragraph WYSIWYG editor + link popover + format toolbar
    page.evaluate("""(function(){
        var b = Array.prototype.find.call(document.querySelectorAll('.md-block'), function(x){ return x.querySelector('p a'); });
        openBlockEditor(b);
        ensureFormatToolbar();
        openLinkPopover(document.querySelector('.md-block-editing a'));
    })()""")
    check('en: paragraph editor + link popover + format toolbar', not hangul_in(page), hangul_in(page))
    page.screenshot(path=str(EVIDENCE / 'i18n-en-link-popover.png'))
    page.evaluate('closeLinkPopover(); closeBlockEditor(false)')

    # Help overlay
    page.evaluate('toggleShortcutHelp()')
    check('en: keyboard shortcut help', not hangul_in(page), hangul_in(page))
    check('en: help title', page.evaluate("document.querySelector('.md-help-title').textContent") == '⌨️ Keyboard Shortcuts')
    page.screenshot(path=str(EVIDENCE / 'i18n-en-help.png'))
    page.evaluate('toggleShortcutHelp()')

    # PDF options dialog
    page.evaluate('window.__test.showPdfDialog()')
    page.wait_for_selector('.pdf-options-dialog', timeout=3000)
    check('en: PDF options dialog', not hangul_in(page), hangul_in(page))
    geo = page.evaluate("""(function(){
        var panel = document.querySelector('.pdf-dialog-panel').getBoundingClientRect();
        var over = Array.from(document.querySelectorAll('.pdf-dialog-panel button, .pdf-dialog-panel label'))
            .filter(function(e){ var r = e.getBoundingClientRect(); return r.right > panel.right + 0.5 || r.left < panel.left - 0.5; });
        return over.length;
    })()""")
    check('en: PDF dialog content fits inside the panel', geo == 0, geo)
    page.screenshot(path=str(EVIDENCE / 'i18n-en-pdf-dialog.png'))
    page.keyboard.press('Escape')

    # Preview search
    page.evaluate('window.__test.openPreviewSearch()')
    check('en: preview search', not hangul_in(page), hangul_in(page))
    page.evaluate('window.__test.closePreviewSearch()')

    # Toasts: capture everything showToast receives during a few actions
    page.evaluate("""(function(){
        window.__toasts = [];
        var orig = window.showToast;
        window.showToast = function (m) { window.__toasts.push(m); return orig.apply(this, arguments); };
    })()""")
    page.keyboard.press('Meta+s')
    page.evaluate("moveBlockStep(0, -1)")
    toasts = page.evaluate('window.__toasts')
    check('en: toasts are English', toasts and not any(HANGUL.search(t) for t in toasts), toasts)

    # Edit mode find / replace
    page.evaluate("window.__test.setMode('edit')")
    page.evaluate('openFindReplace()')
    check('en: edit-mode find & replace', not hangul_in(page), hangul_in(page))
    page.screenshot(path=str(EVIDENCE / 'i18n-en-find-replace.png'))
    page.evaluate("window.__test.setMode('preview')")

    # Empty document + empty outline
    page.evaluate("window.__test.setContent('')")
    check('en: empty document placeholder', page.evaluate(
        "(document.querySelector('.md-empty-hint')||{}).textContent") == 'This document is empty — add a block to get started')
    check('en: empty outline', page.evaluate(
        "(document.querySelector('.outline-empty')||{}).textContent") == 'No headings')
    check('en: empty-document view', not hangul_in(page), hangul_in(page))

    check('en: no page errors', not errors, errors)
    browser.close()

    # ───────────────────────── Korean (unchanged) ─────────────────────────
    browser, page, errors = open_page(p, None)       # no __mdpvLang → Korean, like older builds
    check('ko: default without injection is Korean', page.evaluate('MDPV_LANG') == 'ko')
    check('ko: save states', page.evaluate(SAVE_STATES) == '● 수정됨|◐ 저장 중|✓ 저장됨')
    check('ko: frontmatter title', page.evaluate("document.querySelector('.md-fm-title').textContent") == '문서 정보')
    check('ko: TOC title', page.evaluate("document.querySelector('.md-toc-title').textContent") == '목차 / Table of Contents')
    check('ko: insert templates unchanged', page.evaluate(
        "INSERT_BLOCKS.map(function(b){return b.raw}).join('|')") ==
        '내용|# 제목|## 제목|### 제목|- 항목|1. 항목|- [ ] 할 일|> 인용문|```\ncode\n```|'
        '| 제목 | 제목 |\n| --- | --- |\n| 내용 | 내용 ||![설명](https://)|[링크 제목](https://)|---')
    page.evaluate('toggleShortcutHelp()')
    check('ko: help title', page.evaluate("document.querySelector('.md-help-title').textContent") == '⌨️ 키보드 단축키')
    page.evaluate('toggleShortcutHelp()')
    page.evaluate('window.__test.showPdfDialog()')
    page.wait_for_selector('.pdf-options-dialog', timeout=3000)
    check('ko: PDF dialog title', page.evaluate("document.querySelector('.pdf-dialog-panel h3').textContent") == 'PDF 내보내기 옵션')
    check('ko: PDF create button', page.evaluate("document.querySelector('.pdf-confirm').textContent") == 'PDF 만들기')
    page.keyboard.press('Escape')
    page.evaluate("window.__test.setMode('edit')")
    page.evaluate('openFindReplace()')
    check('ko: find & replace buttons', page.evaluate(
        "document.querySelector('.fr-replace-one').textContent + '/' + document.querySelector('.fr-replace-all').textContent") == '바꾸기/모두')
    check('ko: no page errors', not errors, errors)

    # Korean stats keep the long-standing format
    page.evaluate("window.__test.setMode('preview'); window.__test.setContent('word')")
    check('ko: stats format unchanged', page.evaluate(
        "statsLeftEl.textContent + ' | ' + statsRightEl.textContent") == '1 words · 4 chars · 1 min read | 1 lines')
    # Korean toggle button shows 한 and asks for English
    check('ko: language button shows 한', page.evaluate("document.querySelector('.lang-btn').textContent") == '한')
    page.click('.lang-btn')
    check('ko: language button requests en', page.evaluate('window.__lastPostMessage') == {'type': 'setLanguage', 'lang': 'en'},
          page.evaluate('window.__lastPostMessage'))
    browser.close()

    # ─────────────── Live language switch: prepare → rebuild → restore ───────────────
    browser, page, errors = open_page(p, 'en')
    check('en: language button shows EN', page.evaluate("document.querySelector('.lang-btn').textContent") == 'EN')
    check('en: language button tooltip is English', not HANGUL.search(page.evaluate("document.querySelector('.lang-btn').title")))
    page.click('.lang-btn')
    check('en: language button requests ko', page.evaluate('window.__lastPostMessage') == {'type': 'setLanguage', 'lang': 'ko'})

    page.evaluate("window.__test.setContent('word')")
    check('en: stats use singulars', page.evaluate("statsLeftEl.textContent + ' | ' + statsRightEl.textContent")
          == '1 word · 4 chars · 1 min read | 1 line')
    page.evaluate("window.__test.setContent('two words\\nline')")
    check('en: stats use plurals', page.evaluate("statsLeftEl.textContent + ' | ' + statsRightEl.textContent")
          == '3 words · 14 chars · 1 min read | 2 lines')

    # An open, UNCOMMITTED block edit must survive the switch.
    page.evaluate("window.__test.setContent('# Title\\n\\nOriginal paragraph.\\n')")
    page.wait_for_timeout(400)   # let the debounced save of setContent go out first
    page.evaluate("""(function(){
        var b = Array.prototype.find.call(document.querySelectorAll('.md-block'), function(x){ return x.querySelector('p'); });
        openBlockEditor(b);
        var p = document.querySelector('.md-block-editing p') || document.querySelector('.md-block-editing');
        p.textContent = 'Typed but not committed.';
        window.__postLog.length = 0;
        window.postMessage({ type: 'prepareRebuild' }, '*');
    })()""")
    page.wait_for_function("window.__postLog.some(function(m){ return m.type === 'rebuildReady'; })", timeout=3000)
    log = page.evaluate('window.__postLog')
    types = [m['type'] for m in log]
    edit_idx = next((i for i, m in enumerate(log) if m['type'] == 'edit' and 'Typed but not committed.' in m['content']), -1)
    ready_idx = types.index('rebuildReady')
    check('prepare: open block edit is committed and sent', edit_idx >= 0, log)
    check('prepare: edit is sent BEFORE rebuildReady', 0 <= edit_idx < ready_idx, types)
    st = log[ready_idx]['state']
    check('prepare: state has mode/theme/font/scroll/undo',
          all(k in st for k in ('mode', 'theme', 'fontSize', 'previewScroll', 'undo', 'outline', 'mermaidColors')), st)
    check('prepare: no editor left open', page.evaluate('!_activeBlockEdit'))
    check('prepare: no page errors', not errors, errors)
    browser.close()

    # Rebuilt page restores the handed-over state.
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1280, 'height': 700})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.add_init_script("""window.__mdpvLang = 'ko';
        window.__restoreState = { mode: 'split', outline: false, theme: 'sage', fontSize: '19px',
            mermaidColors: true, previewScroll: 300, editorScroll: 0, selStart: 3, selEnd: 7,
            undo: ['older version'], redo: [] };""")
    page.goto(HARNESS)
    page.wait_for_function('!!window.__test')
    page.wait_for_timeout(800)
    got = page.evaluate("""({
        mode: currentMode, bodySplit: document.body.classList.contains('mode-split'),
        theme: document.body.getAttribute('data-theme'),
        font: document.documentElement.style.getPropertyValue('--md-font-size').trim(),
        outlineHidden: outlineEl.classList.contains('hidden'),
        mermaid: _mermaidLevelColors, undo: _editHistory.length,
        scroll: previewEl.parentElement.scrollTop,
        sel: [editorEl.selectionStart, editorEl.selectionEnd],
        lang: MDPV_LANG
    })""")
    check('restore: mode split', got['mode'] == 'split' and got['bodySplit'], got)
    check('restore: theme', got['theme'] == 'sage', got)
    check('restore: font size', got['font'] == '19px', got)
    check('restore: outline hidden (overrides showOutline: true)', got['outlineHidden'], got)
    check('restore: mermaid colors', got['mermaid'] is True, got)
    check('restore: undo history', got['undo'] == 1, got)
    check('restore: preview scroll position', abs(got['scroll'] - 300) <= 2, got)
    check('restore: editor selection', got['sel'] == [3, 7], got)
    check('restore: built in the new language', got['lang'] == 'ko', got)
    check('restore: no page errors', not errors, errors)
    browser.close()

passed = sum(1 for _, ok in results if ok)
print('RESULT: %d/%d passed' % (passed, len(results)))
sys.exit(0 if passed == len(results) else 1)
