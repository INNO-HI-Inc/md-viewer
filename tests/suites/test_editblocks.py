#!/usr/bin/env python3
"""v1.0.28 block-type editing: table row/col/align ops, dedicated code
editor, blockquote round-trip stability, link popover."""
import sys
import pathlib
HARNESS = (pathlib.Path(__file__).resolve().parents[1] / 'harness.html').as_uri()
from playwright.sync_api import sync_playwright

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

    TABLE_DOC = "| 이름 | 나이 |\n| --- | --- |\n| 김 | 10 |\n| 이 | 20 |\n\nAfter table.\n"

    # ── 표: toolbar 표시 + 행 추가 ──
    page.evaluate("window.__test.setContent(%r)" % TABLE_DOC)
    page.evaluate("""(function(){
        var td = document.querySelector('td');   // '김'
        openCellEditor(td, parseInt(td.closest('.md-block').dataset.blockIdx, 10), 'markdown');
    })()""")
    check('table: toolbar appears while editing', page.evaluate("!!document.querySelector('.md-table-toolbar')"))
    check('table: toolbar has 5 controls', page.evaluate("document.querySelectorAll('.md-table-toolbar button').length") == 5)
    page.evaluate("tableToolbarAction('row+')")
    page.wait_for_timeout(120)
    content = page.evaluate('window.__test.getContent()')
    check('table: row+ adds empty row after current', content.count('\n|') == 4 and '김' in content and '이' in content, repr(content))
    check('table: editor reopened on new row', page.evaluate("!!document.querySelector('td.md-cell-editing')"))

    # ── 표: 열 추가 → 헤더/정렬/행 모두 확장 ──
    page.evaluate("tableToolbarAction('col+')")
    page.wait_for_timeout(120)
    content = page.evaluate('window.__test.getContent()')
    first_line = content.split('\n')[0]
    check('table: col+ adds header column', first_line.count('|') == 4, first_line)
    relex_ok = page.evaluate("""(function(){
        var t = marked.lexer(currentContent).find(function(x){return x.type==='table'});
        return t && t.header.length === 3 && t.rows.every(function(r){return r.length === 3});
    })()""")
    check('table: col+ keeps table rectangular', relex_ok)

    # ── 표: 정렬 토글 ──
    page.evaluate("tableToolbarAction('align')")
    page.wait_for_timeout(120)
    content = page.evaluate('window.__test.getContent()')
    check('table: align cycle writes delimiter', ':---' in content, repr(content))

    # ── 표: 행/열 삭제 + 가드 ──
    page.evaluate("tableToolbarAction('col-')")
    page.wait_for_timeout(120)
    page.evaluate("tableToolbarAction('row-')")
    page.wait_for_timeout(120)
    relex2 = page.evaluate("""(function(){
        var t = marked.lexer(currentContent).find(function(x){return x.type==='table'});
        return t ? {cols: t.header.length, rows: t.rows.length} : null;
    })()""")
    check('table: col-/row- shrink table', relex2 == {'cols': 2, 'rows': 2}, relex2)
    check('table: After-table paragraph untouched', 'After table.' in page.evaluate('window.__test.getContent()'))
    page.evaluate('if (_activeBlockEdit) closeBlockEditor(false)')

    # ── 표: Tab past last cell → new row ──
    page.evaluate("window.__test.setContent(%r)" % "| A | B |\n| --- | --- |\n| a1 | b1 |\n")
    page.evaluate("""(function(){
        var tds = document.querySelectorAll('td');
        var last = tds[tds.length - 1];   // b1
        openCellEditor(last, parseInt(last.closest('.md-block').dataset.blockIdx, 10), 'markdown');
    })()""")
    page.keyboard.press('Tab')
    page.wait_for_timeout(200)
    relex3 = page.evaluate("""(function(){
        var t = marked.lexer(currentContent).find(function(x){return x.type==='table'});
        return t ? t.rows.length : 0;
    })()""")
    check('table: Tab at last cell appends row', relex3 == 2, relex3)
    check('table: editor active on appended row', page.evaluate("!!document.querySelector('td.md-cell-editing')"))
    page.evaluate('if (_activeBlockEdit) closeBlockEditor(false)')

    # ── 코드블록: 전용 에디터 ──
    CODE_DOC = "```python\ndef f(x):\n    return x * 2\n```\n\nAfter code.\n"
    page.evaluate("window.__test.setContent(%r)" % CODE_DOC)
    mode = page.evaluate("""(function(){
        var b = document.querySelector('.md-block');
        openBlockEditor(b);
        return _activeBlockEdit ? _activeBlockEdit.mode : null;
    })()""")
    check('code: dedicated editor opens', mode == 'code', mode)
    check('code: language field prefilled', page.evaluate("document.querySelector('.md-code-lang').value") == 'python')
    check('code: textarea has NO fences', page.evaluate(
        "document.querySelector('.md-code-editor').value.indexOf('```') === -1"))
    # untouched commit is byte-stable
    page.evaluate('closeBlockEditor(true)')
    page.wait_for_timeout(50)
    check('code: untouched commit byte-stable', page.evaluate('window.__test.getContent()') == CODE_DOC)
    # edit language + body, Tab inserts spaces
    page.evaluate("""(function(){
        var b = document.querySelector('.md-block');
        openBlockEditor(b);
        document.querySelector('.md-code-lang').value = 'js';
        var ta = document.querySelector('.md-code-editor');
        ta.value = 'const x = 1;';
        ta.focus();
        ta.selectionStart = ta.selectionEnd = ta.value.length;
    })()""")
    page.keyboard.press('Tab')
    tab_ok = page.evaluate("document.querySelector('.md-code-editor').value") == 'const x = 1;  '
    check('code: Tab inserts spaces (no focus move)', tab_ok)
    page.evaluate('closeBlockEditor(true)')
    page.wait_for_timeout(50)
    content = page.evaluate('window.__test.getContent()')
    check('code: commit rebuilds fence + lang', content.startswith('```js\nconst x = 1;'), repr(content))
    check('code: closing fence intact', content.count('```') == 2)
    # fence collision safety
    page.evaluate("window.__test.setContent(%r)" % "```\nplain\n```\n")
    page.evaluate("""(function(){
        var b = document.querySelector('.md-block');
        openBlockEditor(b);
        document.querySelector('.md-code-editor').value = 'text with ``` inside';
    })()""")
    page.evaluate('closeBlockEditor(true)')
    page.wait_for_timeout(50)
    content = page.evaluate('window.__test.getContent()')
    fence_ok = page.evaluate("""(function(){
        var t = marked.lexer(currentContent).find(function(x){return x.type==='code'});
        return t && t.text.indexOf('```') >= 0;
    })()""")
    check('code: body containing ``` keeps fence intact', fence_ok, repr(content))

    # ── 인용문: untouched commit이 파일을 더럽히지 않음 ──
    for name, doc in [
        ('multi-para', "> 첫 문단\n>\n> 둘째 문단\n"),
        ('nested', "> 바깥\n> > 안쪽 중첩\n"),
        ('with list', "> - 항목 하나\n> - 항목 둘\n"),
    ]:
        page.evaluate("window.__test.setContent(%r)" % doc)
        page.evaluate("""(function(){
            var b = document.querySelector('.md-block');
            openBlockEditor(b);
            closeBlockEditor(true);
        })()""")
        page.wait_for_timeout(40)
        out = page.evaluate('window.__test.getContent()')
        check('quote: untouched commit stable (%s)' % name, out == doc, repr(out))

    # 인용문 실제 편집은 여전히 반영되는지
    page.evaluate("window.__test.setContent(%r)" % "> 원래 인용문\n")
    page.evaluate("""(function(){
        var b = document.querySelector('.md-block');
        openBlockEditor(b);
        var p = b.querySelector('blockquote p') || b.querySelector('p');
        p.textContent = '수정된 인용문';
        closeBlockEditor(true);
    })()""")
    page.wait_for_timeout(40)
    content = page.evaluate('window.__test.getContent()')
    check('quote: real edit still commits', '> 수정된 인용문' in content, repr(content))

    # ── 링크: 팝오버 편집 ──
    page.evaluate("window.__test.setContent(%r)" % "문단에 [기존 링크](https://old.example.com) 있음.\n")
    page.evaluate("""(function(){
        var b = document.querySelector('.md-block');
        openBlockEditor(b);
        var a = b.querySelector('a');
        a.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
    })()""")
    page.wait_for_timeout(50)
    check('link: popover opens on click in editor', page.evaluate("!!document.querySelector('.md-link-popover')"))
    check('link: url prefilled', page.evaluate(
        "document.querySelectorAll('.md-link-row input')[1].value") == 'https://old.example.com')
    page.evaluate("""(function(){
        var inputs = document.querySelectorAll('.md-link-row input');
        inputs[0].value = '새 링크 텍스트';
        inputs[1].value = 'https://new.example.com';
        document.querySelector('.md-link-apply').click();
    })()""")
    page.wait_for_timeout(50)
    page.evaluate('closeBlockEditor(true)')
    page.wait_for_timeout(50)
    content = page.evaluate('window.__test.getContent()')
    check('link: apply rewrites text+url in markdown',
          '[새 링크 텍스트](https://new.example.com)' in content, repr(content))
    check('link: editor closed cleanly', page.evaluate('!_activeBlockEdit'))

    # 링크 제거
    page.evaluate("window.__test.setContent(%r)" % "지울 [삭제 대상](https://x.com) 링크.\n")
    page.evaluate("""(function(){
        var b = document.querySelector('.md-block');
        openBlockEditor(b);
        var a = b.querySelector('a');
        a.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
    })()""")
    page.wait_for_timeout(50)
    page.evaluate("document.querySelector('.md-link-remove').click()")
    page.wait_for_timeout(30)
    page.evaluate('closeBlockEditor(true)')
    page.wait_for_timeout(50)
    content = page.evaluate('window.__test.getContent()')
    check('link: remove unwraps to plain text', '삭제 대상' in content and '](https://x.com)' not in content, repr(content))

    # 툴바 🔗 → 팝오버 (prompt 미사용)
    page.evaluate("window.__test.setContent(%r)" % "여기 선택해서 링크로.\n")
    popped = page.evaluate("""(function(){
        var b = document.querySelector('.md-block');
        openBlockEditor(b);
        var p = b.querySelector('p');
        var range = document.createRange();
        range.selectNodeContents(p.firstChild);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        applyFormatCommand('link');
        return !!document.querySelector('.md-link-popover');
    })()""")
    check('link: toolbar 🔗 opens popover (no window.prompt)', popped)
    page.evaluate("""(function(){
        var inputs = document.querySelectorAll('.md-link-row input');
        inputs[1].value = 'https://made.example.com';
        document.querySelector('.md-link-apply').click();
    })()""")
    page.evaluate('closeBlockEditor(true)')
    page.wait_for_timeout(50)
    content = page.evaluate('window.__test.getContent()')
    check('link: toolbar-created link committed', 'https://made.example.com' in content, repr(content))

    # 팝오버 열린 채 재렌더 → 정리
    page.evaluate("window.__test.setContent(%r)" % "다른 [링크](https://y.com) 문단.\n")
    page.evaluate("""(function(){
        var b = document.querySelector('.md-block');
        openBlockEditor(b);
        b.querySelector('a').dispatchEvent(new MouseEvent('click', {bubbles: true}));
    })()""")
    page.evaluate("window.postMessage({type:'update', content:'교체된 문서.\\n'}, '*')")
    page.wait_for_timeout(100)
    check('link: popover killed by external update', page.evaluate("!document.querySelector('.md-link-popover')"))

    # ── 체크박스: 모든 변형이 올바른 소스 줄을 토글 ──
    CHK_DOC = "# 목록\n\n> - [ ] 인용 속 할 일\n\n1. [ ] 번호 할 일\n\n- [ ] 보통 할 일\n- 그냥 항목\n  - [ ] 중첩 할 일\n"
    page.evaluate("window.__test.setContent(%r)" % CHK_DOC)
    check('checkbox: 4 boxes rendered', page.evaluate(
        "document.querySelectorAll('#preview input[type=checkbox]').length") == 4)
    for k, expect in [(0, '> - [x] 인용 속 할 일'), (1, '1. [x] 번호 할 일'),
                      (2, '- [x] 보통 할 일'), (3, '- [x] 중첩 할 일')]:
        r = page.evaluate("""(function(k){
            var box = document.querySelectorAll('#preview input[type=checkbox]')[k];
            var rc = box.getBoundingClientRect(); return {x: rc.left+8, y: rc.top+8};
        })(%d)""" % k)
        page.mouse.click(r['x'], r['y'])
        page.wait_for_timeout(80)
        check('checkbox: click #%d toggles right line' % k,
              expect in page.evaluate('currentContent'))
    r = page.evaluate("""(function(){
        var box = document.querySelectorAll('#preview input[type=checkbox]')[0];
        var rc = box.getBoundingClientRect(); return {x: rc.left+8, y: rc.top+8};
    })()""")
    page.mouse.click(r['x'], r['y'])
    page.wait_for_timeout(80)
    check('checkbox: uncheck restores [ ]', '> - [ ] 인용 속 할 일' in page.evaluate('currentContent'))
    # 체크박스 토글 후 구조 연산에도 상태 유지 (토큰 동기화)
    page.evaluate("""(function(){
        for (var i=0;i<_currentTokens.length;i++)
            if ((_currentTokens[i].raw||'').indexOf('# 목록') === 0) { duplicateBlock(i); return; }
    })()""")
    page.wait_for_timeout(80)
    check('checkbox: state survives structural op', '1. [x] 번호 할 일' in page.evaluate('currentContent'))

    # 크롬 누출 종합
    leaks = page.evaluate("""(function(){
        var bad = ['md-table-toolbar', 'md-code-lang', 'md-link-popover', 'data-md-chrome'];
        var log = (window.__postLog || []).filter(function(m){ return m.type === 'edit'; });
        var hits = [];
        log.forEach(function(m){ bad.forEach(function(s){ if ((m.content||'').indexOf(s) >= 0) hits.push(s); }); });
        return hits;
    })()""")
    check('chrome: no editor chrome leaked to saved content', len(leaks) == 0, leaks)

    check('no page errors', len(errors) == 0, errors[:3])
    browser.close()

failed = [r for r in results if not r[1]]
print('\nRESULT: %d/%d passed' % (len(results) - len(failed), len(results)))
sys.exit(1 if failed else 0)
