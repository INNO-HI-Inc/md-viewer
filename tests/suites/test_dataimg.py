#!/usr/bin/env python3
"""v1.1.0 — embedded data:image/* images render (common in exported markdown),
while data:/javascript: LINKS stay blocked and no script executes. Regression for
the sanitizer's isSafeImgSrc (image src is more permissive than link href)."""
import sys, pathlib
HARNESS = (pathlib.Path(__file__).resolve().parents[1] / 'harness.html').as_uri()
from playwright.sync_api import sync_playwright

PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
DOC = (
    "# data image\n\n"
    "![png](%s)\n\n"
    "![svg](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCIvPg==)\n\n"
    "[data link](data:text/html,<b>x</b>)\n\n"
    "[js link](javascript:alert(1))\n"
) % PNG

results = []
def check(name, ok, detail=''):
    results.append((name, ok))
    print(('PASS' if ok else 'FAIL') + ' - ' + name + (': ' + str(detail) if detail and not ok else ''))

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 900, 'height': 700})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    alerts = []
    page.on('dialog', lambda d: (alerts.append(d.message), d.dismiss()))
    page.goto(HARNESS)
    page.wait_for_function('!!window.__test')
    page.evaluate("window.__test.setContent(%r)" % DOC)
    page.wait_for_timeout(500)

    imgs = page.evaluate("Array.from(document.querySelectorAll('#preview img')).map(function(i){return (i.getAttribute('src')||'').slice(0,22);})")
    check('data:image/png renders', any(s.startswith('data:image/png') for s in imgs), imgs)
    check('data:image/svg+xml renders', any(s.startswith('data:image/svg') for s in imgs), imgs)

    links = page.evaluate("Array.from(document.querySelectorAll('#preview a')).map(function(a){return a.getAttribute('href')||'';})")
    check('data: LINK stays blocked', not any(h.startswith('data:') for h in links), links)
    check('javascript: LINK stays blocked', not any('javascript:' in h.lower() for h in links), links)
    check('no script executed (no alert)', len(alerts) == 0, alerts)
    check('no page errors', len(errors) == 0, errors[:3])
    b.close()

failed = [r for r in results if not r[1]]
print('\nRESULT: %d/%d passed' % (len(results) - len(failed), len(results)))
sys.exit(1 if failed else 0)
