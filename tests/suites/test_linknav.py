#!/usr/bin/env python3
"""v1.0.31 link navigation: clicking a link in the rendered preview routes
to the extension (external URL / mailto / workspace file) or scrolls in-pane
for #anchors — instead of doing nothing (webviews don't auto-open links or
scroll the preview pane for the built-in <a> behavior)."""
import sys
import pathlib
HARNESS = (pathlib.Path(__file__).resolve().parents[1] / 'harness.html').as_uri()
from playwright.sync_api import sync_playwright

DOC = """# 링크 테스트

[[TOC]]

외부: [example](https://example.com/page) · [메일](mailto:a@b.com)

파일: [다른 문서](./other.md) · [상위](../up.md#frag)

## 섹션 1

내용 1

## 섹션 2

여기로 스크롤.
"""

results = []
def check(name, ok, detail=''):
    results.append((name, ok))
    print(('PASS' if ok else 'FAIL') + ' - ' + name + (': ' + str(detail) if detail and not ok else ''))

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1000, 'height': 600})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(HARNESS)
    page.wait_for_function('!!window.__test')
    page.evaluate("window.__test.setContent(%r)" % DOC)
    page.wait_for_timeout(200)

    def click_link(text):
        return page.evaluate("""(t)=>{
            var as = document.querySelectorAll('#preview a');
            for (var i=0;i<as.length;i++){
                if ((as[i].textContent||'').indexOf(t) >= 0) {
                    var before = (window.__postLog||[]).length;
                    var ev = new MouseEvent('click', {bubbles:true, cancelable:true});
                    as[i].dispatchEvent(ev);
                    return { prevented: ev.defaultPrevented, href: as[i].getAttribute('href'),
                             posted: (window.__postLog||[]).slice(before) };
                }
            }
            return None;
        }""".replace('None', 'null'), text)

    r = click_link('example')
    check('external URL → prevented + openLink posted',
          r and r['prevented'] and any(m.get('type') == 'openLink' and m.get('href') == 'https://example.com/page' for m in r['posted']), r)

    r = click_link('메일')
    check('mailto → openLink posted',
          r and r['prevented'] and any(m.get('href') == 'mailto:a@b.com' for m in r['posted']), r)

    r = click_link('다른 문서')
    check('relative file → openLink posted (extension resolves + opens)',
          r and r['prevented'] and any(m.get('href') == './other.md' for m in r['posted']), r)

    r = click_link('상위')
    check('relative file with #frag → openLink posted',
          r and r['prevented'] and any(m.get('href') == '../up.md#frag' for m in r['posted']), r)

    # TOC anchor → scroll within the pane, prevented, NOT posted to host
    anchor = page.evaluate("""()=>{
        var as = document.querySelectorAll('#preview .md-toc a, #preview a[href^="#"]');
        for (var i=0;i<as.length;i++){
            if ((as[i].textContent||'').indexOf('섹션 2') >= 0) {
                var before = (window.__postLog||[]).length;
                var ev = new MouseEvent('click', {bubbles:true, cancelable:true});
                as[i].dispatchEvent(ev);
                return { prevented: ev.defaultPrevented, href: as[i].getAttribute('href'),
                         postedCount: (window.__postLog||[]).length - before };
            }
        }
        return null;
    }""")
    check('TOC anchor → prevented, handled in-page (no host message)',
          anchor and anchor['prevented'] and anchor['postedCount'] == 0 and anchor['href'].startswith('#'), anchor)

    # While editing a block, link clicks must NOT navigate (the link popover owns them)
    edit_guard = page.evaluate("""()=>{
        var b = document.querySelector('#preview .md-block');
        // find a paragraph block containing a link
        var blocks = document.querySelectorAll('#preview .md-block');
        var target = null;
        blocks.forEach(function(x){ if (x.querySelector('a[href^="https"]')) target = x; });
        if (!target) return 'no link block';
        openBlockEditor(target);
        var a = target.querySelector('a[href^="https"]');
        var before = (window.__postLog||[]).length;
        a.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}));
        var openedPopover = !!document.querySelector('.md-link-popover');
        var postedOpenLink = (window.__postLog||[]).slice(before).some(function(m){return m.type==='openLink';});
        closeBlockEditor(false);
        return { openedPopover: openedPopover, postedOpenLink: postedOpenLink };
    }""")
    check('editing: link click opens popover, does NOT navigate',
          isinstance(edit_guard, dict) and edit_guard['openedPopover'] and not edit_guard['postedOpenLink'], edit_guard)

    check('no page errors', len(errors) == 0, errors[:3])
    browser.close()

failed = [r for r in results if not r[1]]
print('\nRESULT: %d/%d passed' % (len(results) - len(failed), len(results)))
sys.exit(1 if failed else 0)
