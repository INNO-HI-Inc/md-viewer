/* MD Pretty Viewer — Webview Editor Logic */

const vscodeApi = acquireVsCodeApi();

let currentContent = '';
let currentMode = 'preview';
let outlineVisible = false;
let editorEl = null;
let lineNumbersEl = null;
let previewEl = null;
let outlineEl = null;
let outlineListEl = null;
let toolbarEl = null;
let statsLeftEl = null;
let statsRightEl = null;
let fontSizeDisplayEl = null;
let isSyncingScroll = false;
let docBaseUri = '';

/* ───────────────────────────────────────────
   marked.js configuration
   ─────────────────────────────────────────── */
function configureMarked() {
    var renderer = new marked.Renderer();

    // Override image rendering — block javascript: URLs, resolve relative paths
    renderer.image = function (token) {
        var href = token.href || '';
        if (/^\s*javascript:/i.test(href) || /^\s*vbscript:/i.test(href)) {
            return escapeAttr(token.text || '');
        }
        var src = resolveUri(href);
        var html = '<img src="' + escapeAttr(src) + '" alt="' + escapeAttr(token.text || '') + '"';
        if (token.title) html += ' title="' + escapeAttr(token.title) + '"';
        html += '>';
        return html;
    };

    // Override link rendering — block javascript:/data:/vbscript: URLs
    renderer.link = function (token) {
        var href = token.href || '';
        if (/^\s*(javascript|vbscript|data):/i.test(href)) {
            return escapeAttr(token.text || '');
        }
        var html = '<a href="' + escapeAttr(href) + '"';
        if (token.title) html += ' title="' + escapeAttr(token.title) + '"';
        html += ' rel="noopener noreferrer">' + (this.parser ? this.parser.parseInline(token.tokens) : escapeAttr(token.text || '')) + '</a>';
        return html;
    };

    // Allow raw HTML through marked; sanitize the rendered tree downstream.
    // Credit: PR #4 by @FIN443 (jihoon) — allowlist-based sanitization.
    renderer.html = function (token) {
        return token.text || token.raw || '';
    };

    marked.setOptions({
        gfm: true,
        breaks: true,
        renderer: renderer,
        // Note: VS Code webview CSP ('default-src none', nonce-based script-src)
        // provides additional defense-in-depth against injection attacks.
    });
}

function escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ───────────────────────────────────────────
   HTML sanitization (allowlist) — adapted from PR #4 by @FIN443
   ─────────────────────────────────────────── */
function sanitizeHtml(html) {
    if (typeof document === 'undefined') return html;
    var template = document.createElement('template');
    template.innerHTML = html;
    sanitizeNode(template.content);
    return template.innerHTML;
}

function sanitizeNode(node) {
    Array.from(node.childNodes).forEach(function (child) {
        if (child.nodeType === Node.ELEMENT_NODE) {
            sanitizeElement(child);
        } else if (child.nodeType !== Node.TEXT_NODE) {
            child.remove();
        }
    });
}

function sanitizeElement(el) {
    var tag = el.tagName.toLowerCase();
    var dropWithContent = {
        script: true, style: true, iframe: true, object: true,
        embed: true, link: true, meta: true, base: true
    };
    var allowedTags = {
        a: true, abbr: true, blockquote: true, br: true, code: true, dd: true,
        del: true, details: true, div: true, dl: true, dt: true, em: true,
        h1: true, h2: true, h3: true, h4: true, h5: true, h6: true,
        hr: true, img: true, input: true, kbd: true, li: true, ol: true,
        p: true, pre: true, s: true, span: true, strong: true, sub: true,
        summary: true, sup: true, table: true, tbody: true, td: true,
        th: true, thead: true, tr: true, ul: true
    };
    if (!allowedTags[tag]) {
        if (dropWithContent[tag]) { el.remove(); return; }
        el.replaceWith(document.createTextNode(el.textContent || ''));
        return;
    }
    if (tag === 'input') {
        var inputType = (el.getAttribute('type') || '').toLowerCase();
        if (inputType !== 'checkbox') { el.remove(); return; }
        el.setAttribute('disabled', '');
    }
    Array.from(el.attributes).forEach(function (attr) {
        if (!isAllowedAttribute(tag, attr.name, attr.value)) {
            el.removeAttribute(attr.name);
        }
    });
    if (tag === 'a') {
        el.setAttribute('rel', 'noopener noreferrer');
    } else if (tag === 'img') {
        var src = el.getAttribute('src') || '';
        if (!src) { el.remove(); return; }
        el.setAttribute('src', resolveUri(src));
    }
    sanitizeNode(el);
}

function isAllowedAttribute(tag, name, value) {
    var attr = name.toLowerCase();
    if (attr.indexOf('on') === 0 || attr === 'style' || attr === 'srcdoc') return false;
    if (attr.indexOf('aria-') === 0) return true;
    if (attr === 'class' || attr === 'id' || attr === 'title' || attr === 'role') return true;
    if (attr === 'align') return /^(p|div|h[1-6]|td|th)$/.test(tag);
    if ((attr === 'colspan' || attr === 'rowspan') && (tag === 'td' || tag === 'th')) return /^\d+$/.test(value);
    if (attr === 'start' && tag === 'ol') return /^\d+$/.test(value);
    if (attr === 'open' && tag === 'details') return true;
    if ((attr === 'checked' || attr === 'disabled') && tag === 'input') return true;
    if (attr === 'type' && tag === 'input') return String(value).toLowerCase() === 'checkbox';
    if (attr === 'name' && tag === 'a') return true;
    if (attr === 'target' && tag === 'a') return /^_(blank|self|parent|top)$/.test(value);
    if (attr === 'rel' && tag === 'a') return true;
    if (attr === 'href' && tag === 'a') return isSafeUrl(value);
    if (attr === 'src' && tag === 'img') return isSafeUrl(value);
    if ((attr === 'alt' || attr === 'loading') && tag === 'img') return true;
    if ((attr === 'width' || attr === 'height') && tag === 'img') return /^\d{1,4}%?$/.test(value);
    return false;
}

function isSafeUrl(url) {
    var trimmed = String(url || '').trim();
    if (trimmed === '') return false;
    if (/[\u0000-\u001f\u007f]/.test(trimmed)) return false;
    if (/^\s*(javascript|vbscript|data|file):/i.test(trimmed)) return false;
    if (/^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i.test(trimmed)) return true;
    if (/^vscode-webview/i.test(trimmed)) return true;
    return !/^[a-z][a-z0-9+.-]*:/i.test(trimmed);
}

function resolveUri(href) {
    if (!href || !docBaseUri) return href || '';
    // Skip absolute URLs and data URIs
    if (/^(https?:\/\/|data:|blob:|vscode-webview)/i.test(href)) return href;
    // Strip leading ./
    var cleanPath = href.replace(/^\.\//, '');
    return docBaseUri.replace(/\/+$/, '') + '/' + cleanPath;
}

function renderMarkdown(text) {
    var html = marked.parse(text);
    return sanitizeHtml(html);
}

function highlightCodeBlocks(container) {
    if (typeof hljs !== 'undefined') {
        container.querySelectorAll('pre code').forEach(function (block) {
            hljs.highlightElement(block);
        });
    }
}

/* ───────────────────────────────────────────
   Stats computation
   ─────────────────────────────────────────── */
function computeStats(text) {
    var trimmed = text.trim();
    var chars = trimmed.length;
    var words = trimmed === '' ? 0 : trimmed.split(/\s+/).length;
    var lines = text === '' ? 0 : text.split('\n').length;
    var readMin = Math.max(1, Math.ceil(words / 200));
    return { words: words, chars: chars, lines: lines, readMin: readMin };
}

function formatNumber(n) {
    return n.toLocaleString();
}

function updateStats() {
    var s = computeStats(currentContent);
    if (statsLeftEl) {
        statsLeftEl.textContent = formatNumber(s.words) + ' words \u00B7 ' +
            formatNumber(s.chars) + ' chars \u00B7 ' + s.readMin + ' min read';
    }
    if (statsRightEl) {
        statsRightEl.textContent = formatNumber(s.lines) + ' lines';
    }
}

/* ───────────────────────────────────────────
   Outline extraction
   ─────────────────────────────────────────── */
function extractHeadings(html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    var headings = [];
    tmp.querySelectorAll('h1, h2, h3, h4').forEach(function (el) {
        headings.push({
            level: parseInt(el.tagName[1], 10),
            text: el.textContent,
            id: el.id || ''
        });
    });
    return headings;
}

function buildOutline(html) {
    if (!outlineListEl) return;
    outlineListEl.innerHTML = '';
    var headings = extractHeadings(html);
    headings.forEach(function (h) {
        var item = document.createElement('div');
        item.className = 'outline-item level-' + h.level;
        item.textContent = h.text;
        item.addEventListener('click', function () {
            scrollToHeading(h.text);
        });
        outlineListEl.appendChild(item);
    });
}

function scrollToHeading(text) {
    if (!previewEl) return;
    var headings = previewEl.querySelectorAll('h1, h2, h3, h4');
    for (var i = 0; i < headings.length; i++) {
        if (headings[i].textContent === text) {
            headings[i].scrollIntoView({ behavior: 'smooth', block: 'start' });
            break;
        }
    }
}

/* ───────────────────────────────────────────
   Preview rendering
   ─────────────────────────────────────────── */
function renderPreview() {
    if (!previewEl) return;
    var processed = currentContent;
    processed = injectTOC(processed);
    processed = preprocessAdmonitions(processed);
    processed = preprocessFootnotes(processed);
    var html = renderMarkdown(processed);
    previewEl.innerHTML = html;
    highlightCodeBlocks(previewEl);
    addHeadingIds();
    buildOutline(html);
    makeCheckboxesClickable();
    renderMath(previewEl);
    renderMermaid(previewEl);
}

/* Lazy script loader (v0.8.0) */
var _lazyLoaded = {};
function lazyLoadScript(key, url) {
    if (_lazyLoaded[key]) return _lazyLoaded[key];
    if (!url) return Promise.reject(new Error('missing url for ' + key));
    _lazyLoaded[key] = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = url;
        if (window.__lazyAssets && window.__lazyAssets.nonce) s.setAttribute('nonce', window.__lazyAssets.nonce);
        s.onload = function () { resolve(); };
        s.onerror = function (e) { reject(e); };
        document.head.appendChild(s);
    });
    return _lazyLoaded[key];
}
function renderMermaid(container) {
    if (!container) return;
    var blocks = container.querySelectorAll('pre code.language-mermaid, pre code.lang-mermaid');
    if (blocks.length === 0) return;
    var assets = window.__lazyAssets || {};
    lazyLoadScript('mermaid', assets.mermaid).then(function () {
        if (typeof mermaid === 'undefined') return;
        try { mermaid.initialize({ startOnLoad: false, theme: document.body.classList.contains('vscode-dark') ? 'dark' : 'default', securityLevel: 'strict', fontFamily: 'inherit' }); } catch (e) {}
        blocks.forEach(function (codeEl, idx) {
            var pre = codeEl.parentElement;
            if (!pre || pre.dataset.mermaidRendered) return;
            var source = codeEl.textContent || '';
            var wrapper = document.createElement('div');
            wrapper.className = 'mermaid-diagram';
            wrapper.id = 'mermaid-' + Date.now() + '-' + idx;
            pre.replaceWith(wrapper);
            try { mermaid.render(wrapper.id + '-svg', source).then(function (r) { wrapper.innerHTML = r.svg; }).catch(function () { wrapper.outerHTML = '<pre><code class="language-mermaid">' + source.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</code></pre>'; }); } catch (e) { wrapper.outerHTML = '<pre><code class="language-mermaid">' + source.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</code></pre>'; }
        });
    }).catch(function () {});
}

/* Admonitions (v0.9.0) */
var ADMONITION_ICONS = {
    note: { icon: 'ℹ', label: 'Note' }, info: { icon: 'ℹ', label: 'Info' },
    tip: { icon: '💡', label: 'Tip' }, success: { icon: '✓', label: 'Success' },
    warning: { icon: '⚠', label: 'Warning' }, caution: { icon: '⚠', label: 'Caution' },
    danger: { icon: '✕', label: 'Danger' }, error: { icon: '✕', label: 'Error' }
};
function preprocessAdmonitions(md) {
    return md.replace(/^:::(\w+)(?:\s+(.+))?\n([\s\S]*?)\n:::\s*$/gm, function (_, type, title, body) {
        type = type.toLowerCase();
        var spec = ADMONITION_ICONS[type] || ADMONITION_ICONS.note;
        var t = (title && title.trim()) || spec.label;
        var safeTitle = t.replace(/[<>&"']/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]; });
        return '<div class="md-admonition md-admonition-' + type + '"><div class="md-admonition-title"><span class="md-admonition-icon">' + spec.icon + '</span>' + safeTitle + '</div><div class="md-admonition-body">\n\n' + body + '\n\n</div></div>\n';
    });
}

/* Footnotes (v0.9.0) */
function preprocessFootnotes(md) {
    var defs = {}, order = [], refCount = {};
    md = md.replace(/^\[\^([^\]]+)\]:\s*(.+(?:\n[ \t]+.+)*)$/gm, function (_, id, content) {
        defs[id] = content.replace(/\n[ \t]+/g, ' ').trim();
        return '';
    });
    if (Object.keys(defs).length === 0) return md;
    md = md.replace(/\[\^([^\]]+)\]/g, function (match, id) {
        if (!defs[id]) return match;
        if (order.indexOf(id) < 0) order.push(id);
        refCount[id] = (refCount[id] || 0) + 1;
        var num = order.indexOf(id) + 1;
        return '<sup class="footnote-ref" id="fnref-' + id + '-' + refCount[id] + '"><a href="#fn-' + id + '">' + num + '</a></sup>';
    });
    if (order.length === 0) return md;
    var html = '\n\n<hr/>\n<section class="footnotes"><ol>';
    order.forEach(function (id) {
        var c = refCount[id] || 1, backlinks = '';
        for (var k = 1; k <= c; k++) backlinks += ' <a class="footnote-backref" href="#fnref-' + id + '-' + k + '">↩</a>';
        html += '<li id="fn-' + id + '">' + defs[id] + backlinks + '</li>';
    });
    return md + html + '</ol></section>\n';
}

function renderMath(container) {
    if (typeof renderMathInElement === 'undefined') return;
    try {
        renderMathInElement(container, {
            delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '$',  right: '$',  display: false },
                { left: '\\(', right: '\\)', display: false },
                { left: '\\[', right: '\\]', display: true }
            ],
            throwOnError: false,
            errorColor: '#cc0000'
        });
    } catch (e) { /* katex unavailable */ }
}

function injectTOC(md) {
    // Replace [[TOC]] or [[목차]] markers with a generated table of contents
    if (!/\[\[(TOC|목차)\]\]/i.test(md)) return md;
    var lines = md.split('\n');
    var inCode = false;
    var headings = [];
    lines.forEach(function (line) {
        if (/^```/.test(line)) inCode = !inCode;
        if (inCode) return;
        var m = line.match(/^(#{1,4})\s+(.+?)\s*$/);
        if (m) {
            // Skip headings on TOC marker line itself
            if (/\[\[(TOC|목차)\]\]/i.test(m[2])) return;
            var level = m[1].length;
            var text = m[2].replace(/[`*_~]/g, '').trim();
            var slug = 'heading-' + text.toLowerCase().replace(/[^\w\s-가-힣]/g, '').replace(/\s+/g, '-').substring(0, 60);
            headings.push({ level: level, text: text, slug: slug });
        }
    });
    if (headings.length === 0) return md.replace(/\[\[(TOC|목차)\]\]/gi, '');
    var toc = ['<div class="md-toc"><div class="md-toc-title">목차 / Table of Contents</div><ul>'];
    headings.forEach(function (h) {
        toc.push('<li class="md-toc-level-' + h.level + '"><a href="#' + h.slug + '">' + h.text + '</a></li>');
    });
    toc.push('</ul></div>');
    return md.replace(/\[\[(TOC|목차)\]\]/gi, toc.join(''));
}

function makeCheckboxesClickable() {
    if (!previewEl) return;
    var idx = 0;
    previewEl.querySelectorAll('input[type="checkbox"]').forEach(function (box, i) {
        box.disabled = false;
        box.style.cursor = 'pointer';
        box.addEventListener('change', function () {
            toggleCheckboxInSource(i, box.checked);
        });
    });
}

function toggleCheckboxInSource(index, checked) {
    // Find the Nth checkbox in the source markdown and toggle it
    var lines = currentContent.split('\n');
    var found = 0;
    for (var i = 0; i < lines.length; i++) {
        var m = lines[i].match(/^(\s*[-*+]\s+)\[([ xX])\](\s)/);
        if (m) {
            if (found === index) {
                var replacement = m[1] + '[' + (checked ? 'x' : ' ') + ']' + m[3];
                lines[i] = lines[i].replace(/^(\s*[-*+]\s+)\[([ xX])\](\s)/, replacement);
                break;
            }
            found++;
        }
    }
    currentContent = lines.join('\n');
    if (editorEl) editorEl.value = currentContent;
    saveToDocument(currentContent);
    updateLineNumbers();
}

function addHeadingIds() {
    if (!previewEl) return;
    previewEl.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(function (el) {
        if (!el.id) {
            el.id = 'heading-' + el.textContent.trim().toLowerCase()
                .replace(/[^\w\s-]/g, '')
                .replace(/\s+/g, '-')
                .substring(0, 60);
        }
    });
}

/* ───────────────────────────────────────────
   Mode switching
   ─────────────────────────────────────────── */
function setMode(mode) {
    currentMode = mode;
    document.body.className = document.body.className
        .replace(/mode-\w+/g, '')
        .trim() + ' mode-' + mode;

    // Update tab active states
    document.querySelectorAll('.mode-tab').forEach(function (tab) {
        tab.classList.toggle('active', tab.dataset.mode === mode);
    });

    // Update editor content when switching to edit or split
    if ((mode === 'edit' || mode === 'split') && editorEl) {
        editorEl.value = currentContent;
        updateLineNumbers();
        if (mode === 'edit') {
            setTimeout(function () { editorEl.focus(); }, 50);
        }
    }

    // Update preview
    if (mode === 'preview' || mode === 'split') {
        renderPreview();
    }
}

/* ───────────────────────────────────────────
   Toolbar actions
   ─────────────────────────────────────────── */
function wrapSelection(before, after) {
    if (!editorEl) return;
    var start = editorEl.selectionStart;
    var end = editorEl.selectionEnd;
    var text = editorEl.value;
    var selected = text.substring(start, end);
    var replacement = before + (selected || 'text') + after;
    editorEl.value = text.substring(0, start) + replacement + text.substring(end);
    // Select the inner text
    editorEl.selectionStart = start + before.length;
    editorEl.selectionEnd = start + before.length + (selected || 'text').length;
    editorEl.focus();
    onEditorInput();
}

function prependLine(prefix) {
    if (!editorEl) return;
    var start = editorEl.selectionStart;
    var text = editorEl.value;
    // Find the beginning of the current line
    var lineStart = text.lastIndexOf('\n', start - 1) + 1;
    var lineEnd = text.indexOf('\n', start);
    if (lineEnd === -1) lineEnd = text.length;
    var line = text.substring(lineStart, lineEnd);
    var newLine = prefix + line;
    editorEl.value = text.substring(0, lineStart) + newLine + text.substring(lineEnd);
    editorEl.selectionStart = lineStart + prefix.length;
    editorEl.selectionEnd = lineStart + newLine.length;
    editorEl.focus();
    onEditorInput();
}

function insertAtCursor(insertion) {
    if (!editorEl) return;
    var start = editorEl.selectionStart;
    var text = editorEl.value;
    editorEl.value = text.substring(0, start) + insertion + text.substring(start);
    editorEl.selectionStart = editorEl.selectionEnd = start + insertion.length;
    editorEl.focus();
    onEditorInput();
}

function changeFontSize(delta) {
    var currentSize = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--md-font-size') || '16');
    var newSize = Math.max(12, Math.min(24, currentSize + delta));
    document.documentElement.style.setProperty('--md-font-size', newSize + 'px');
    if (fontSizeDisplayEl) fontSizeDisplayEl.textContent = Math.round(newSize);
    localStorage.setItem('md-viewer-font-size', newSize + 'px');
}

function toolbarAction(action) {
    switch (action) {
        case 'h1': prependLine('# '); break;
        case 'h2': prependLine('## '); break;
        case 'h3': prependLine('### '); break;
        case 'bold': wrapSelection('**', '**'); break;
        case 'italic': wrapSelection('*', '*'); break;
        case 'code':
            if (editorEl) {
                var sel = editorEl.value.substring(editorEl.selectionStart, editorEl.selectionEnd);
                if (sel.indexOf('\n') >= 0) {
                    wrapSelection('\n```\n', '\n```\n');
                } else {
                    wrapSelection('`', '`');
                }
            }
            break;
        case 'link':
            if (editorEl) {
                wrapSelection('[', '](url)');
            }
            break;
        case 'bullet': prependLine('- '); break;
        case 'number': prependLine('1. '); break;
        case 'quote': prependLine('> '); break;
        case 'hr': insertAtCursor('\n---\n'); break;
        case 'font-size-up': changeFontSize(1); break;
        case 'font-size-down': changeFontSize(-1); break;
        case 'copy':
            navigator.clipboard.writeText(currentContent).catch(function () {});
            showToast('마크다운 복사됨 / Copied markdown');
            break;
        case 'copy-html':
            var html = renderMarkdown(currentContent);
            navigator.clipboard.writeText(html).catch(function () {});
            showToast('HTML 복사됨 / Copied HTML');
            break;
        case 'focus':
            toggleFocusMode();
            break;
    }
}

function exportToPdf() {
    if (typeof html2pdf === 'undefined') {
        var assets = window.__lazyAssets || {};
        if (!assets.html2pdf) { showToast('PDF 라이브러리 로드 실패'); return; }
        showToast('PDF 라이브러리 로딩 중...');
        lazyLoadScript('html2pdf', assets.html2pdf).then(function () { exportToPdf(); }).catch(function () { showToast('PDF 라이브러리 로드 실패'); });
        return;
    }

    var previousMode = currentMode;
    if (currentMode !== 'preview') {
        setMode('preview');
    }

    showToast('PDF 생성 중... / Generating PDF...');

    // Filename from first H1
    var titleFromContent = '';
    var h1Match = currentContent.match(/^#\s+(.+?)\s*$/m);
    if (h1Match) {
        titleFromContent = h1Match[1]
            .replace(/[\\/:*?"<>|]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }
    var fileName = (titleFromContent || (document.title || 'document').replace(/\.md$/, '')) + '.pdf';

    var element = previewEl;
    if (!element) {
        showToast('프리뷰를 찾을 수 없습니다');
        return;
    }

    var restore = function () { /* no-op — onclone touches only the cloned doc */ };

    // Get document title from first H1, but only use ASCII parts for jsPDF (no CJK)
    var docTitle = '';
    var titleH1 = element.querySelector('h1');
    if (titleH1) {
        var raw = titleH1.textContent.trim();
        // jsPDF default font cannot render CJK — keep header only if title is ASCII-safe
        var asciiOnly = raw.replace(/[^\x20-\x7E]/g, '').trim();
        if (asciiOnly.length >= 3 && asciiOnly.length === raw.length) {
            docTitle = raw.substring(0, 80);
        }
    }

    setTimeout(function () {
        var opt = {
            margin: [18, 18, 22, 18],   // top, left, bottom, right (mm)
            filename: fileName,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: {
                scale: 2,
                useCORS: true,
                logging: false,
                backgroundColor: '#ffffff',
                height: element.scrollHeight,
                windowHeight: element.scrollHeight,
                onclone: function (clonedDoc) {
                    // Force light theme on cloned body so CSS variables resolve to light values
                    var b = clonedDoc.body;
                    if (b) {
                        b.classList.remove('vscode-dark', 'vscode-high-contrast');
                        b.classList.add('vscode-light');
                        b.removeAttribute('data-theme');
                        ['--md-accent', '--md-link', '--md-link-hover', '--md-inline-code-text',
                         '--md-selection-bg', '--md-gradient', '--md-mark-bg', '--md-mark-text',
                         '--hljs-keyword', '--hljs-string', '--hljs-number', '--hljs-function',
                         '--hljs-variable', '--hljs-type', '--hljs-tag', '--hljs-attr',
                         '--hljs-selector', '--hljs-built-in', '--hljs-addition', '--hljs-addition-bg']
                         .forEach(function (v) { b.style.removeProperty(v); });
                    }

                    // Inject extra print-quality overrides into the cloned doc
                    var s = clonedDoc.createElement('style');
                    s.textContent = [
                        // Strip trailing padding so content ends exactly at last element (no blank trailing page)
                        '#preview { background:#fff !important; color:#1a1a1a !important; animation:none !important; padding-bottom:0 !important; }',
                        '#preview > *:last-child { margin-bottom:0 !important; padding-bottom:0 !important; }',

                        // Headings
                        '#preview h1, #preview h2, #preview h3, #preview h4, #preview h5, #preview h6 { color:#000 !important; border-image:none !important; }',
                        '#preview h1 { border-bottom:2px solid #000 !important; }',
                        '#preview h2 { border-bottom:1px solid #c0c0c0 !important; }',

                        // Code blocks
                        '#preview pre { background:#fff !important; border:1px solid #c0c0c0 !important; border-radius:4px !important; box-shadow:none !important; }',
                        '#preview pre code, #preview pre code.hljs, #preview pre .hljs { background:transparent !important; color:#000 !important; }',
                        '#preview pre code *, #preview pre .hljs * { color:#000 !important; background:transparent !important; }',
                        '#preview pre .hljs-comment, #preview pre .hljs-quote { color:#6a737d !important; font-style:italic !important; }',

                        // Inline code (not inside pre)
                        '#preview :not(pre) > code { background:#f5f5f5 !important; color:#1a1a1a !important; border:1px solid #d0d7de !important; padding:1px 5px !important; border-radius:3px !important; font-size:0.88em !important; }',

                        // Blockquote — gray panel, but keep strong/headings dark for emphasis
                        '#preview blockquote { background:#f8f9fa !important; border-left:3px solid #999 !important; color:#4a4a4a !important; padding:0.6em 1em !important; border-radius:0 4px 4px 0 !important; }',
                        '#preview blockquote * { color:#4a4a4a !important; background:transparent !important; }',
                        '#preview blockquote strong, #preview blockquote b { color:#1a1a1a !important; font-weight:700 !important; }',
                        '#preview blockquote code { background:#eef0f3 !important; color:#1a1a1a !important; }',

                        // ── TABLES ── full borders, header bg, zebra rows, cell padding
                        // thead/tbody as proper row groups so header repeats on page break
                        '#preview table { width:100% !important; border-collapse:collapse !important; border:1px solid #c0c0c0 !important; margin:1em 0 !important; font-size:0.95em !important; }',
                        '#preview thead { display:table-header-group !important; }',
                        '#preview tbody { display:table-row-group !important; }',
                        '#preview tfoot { display:table-footer-group !important; }',
                        '#preview thead tr, #preview thead th { page-break-inside:avoid !important; break-inside:avoid !important; page-break-after:avoid !important; break-after:avoid !important; }',
                        '#preview thead th { background:#f1f3f5 !important; color:#000 !important; font-weight:700 !important; border:1px solid #c0c0c0 !important; padding:8px 12px !important; text-align:left !important; }',
                        '#preview tbody td { color:#1a1a1a !important; border:1px solid #d0d7de !important; padding:8px 12px !important; background:#fff !important; vertical-align:top !important; }',
                        '#preview tbody tr:nth-child(even) td { background:#fafbfc !important; }',
                        '#preview tbody tr:hover td { background:#fff !important; }',
                        '#preview table strong, #preview table b { color:#000 !important; }',

                        // Strong / emphasis
                        '#preview strong, #preview b { color:#000 !important; font-weight:700 !important; }',

                        // Links
                        '#preview a { color:#0366d6 !important; text-decoration:underline !important; word-break:break-all !important; }',

                        // HR
                        '#preview hr { background:#c0c0c0 !important; height:1px !important; border:none !important; opacity:1 !important; margin:1.5em 0 !important; }',

                        // Mark — yellow highlight
                        '#preview mark { background:#fff8c5 !important; color:#000 !important; padding:0 2px !important; }',

                        // Images
                        '#preview img { max-width:100% !important; height:auto !important; box-shadow:none !important; }',

                        // Page break behavior
                        '#preview pre, #preview img { page-break-inside:avoid !important; break-inside:avoid !important; }',
                        '#preview tr { page-break-inside:avoid !important; break-inside:avoid !important; }',
                        '#preview blockquote { page-break-inside:avoid !important; break-inside:avoid !important; }',
                        '#preview h1, #preview h2, #preview h3 { page-break-after:avoid !important; break-after:avoid !important; }',
                        // Keep code-block + caption blockquote together (e.g. diagram + 실증 근거)
                        '#preview pre + blockquote, #preview img + blockquote { page-break-before:avoid !important; break-before:avoid !important; }',
                        // Keep an element that follows a heading on the same page as the heading
                        '#preview h1 + *, #preview h2 + *, #preview h3 + *, #preview h4 + * { page-break-before:avoid !important; break-before:avoid !important; }'
                    ].join('\n');
                    clonedDoc.head.appendChild(s);
                }
            },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            // v0.9.1: 'avoid' selectors prevent tables/figures from getting split awkwardly at page edges
            pagebreak: {
                mode: ['css', 'legacy'],
                avoid: ['table', 'tr', 'pre', 'img', 'blockquote', '.mermaid-diagram', '.md-admonition']
            }
        };

        html2pdf().set(opt).from(element).toPdf().get('pdf').then(function (pdf) {
            var pageCount = pdf.internal.getNumberOfPages();
            var pageWidth = pdf.internal.pageSize.getWidth();
            var pageHeight = pdf.internal.pageSize.getHeight();

            for (var i = 1; i <= pageCount; i++) {
                pdf.setPage(i);

                // Running header (skip first page — already has title in body)
                if (docTitle && i > 1) {
                    pdf.setFontSize(9);
                    pdf.setTextColor(140, 140, 140);
                    pdf.text(docTitle, 18, 12, { align: 'left' });
                    // Header underline
                    pdf.setDrawColor(220, 220, 220);
                    pdf.setLineWidth(0.2);
                    pdf.line(18, 14, pageWidth - 18, 14);
                }

                // Footer page number
                pdf.setFontSize(9);
                pdf.setTextColor(140, 140, 140);
                pdf.text(i + ' / ' + pageCount, pageWidth / 2, pageHeight - 10, { align: 'center' });
            }

            pdf.save(fileName);
            restore();
            showToast('PDF 저장 완료');
            if (previousMode !== 'preview') {
                setMode(previousMode);
            }
        }).catch(function (err) {
            restore();
            console.error(err);
            showToast('PDF 저장 실패');
        });
    }, 150);
}

function showToast(message) {
    var existing = document.querySelector('.md-toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.className = 'md-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function () { toast.classList.add('show'); }, 10);
    setTimeout(function () {
        toast.classList.remove('show');
        setTimeout(function () { toast.remove(); }, 200);
    }, 1500);
}

/* ───────────────────────────────────────────
   Editor input handling
   ─────────────────────────────────────────── */
var _renderTimer = null;
function debouncedRenderPreview() {
    if (_renderTimer) cancelAnimationFrame(_renderTimer);
    if (window._renderTimeoutId) clearTimeout(window._renderTimeoutId);
    // Debounce 120ms — feels responsive but avoids reflow on every keystroke
    window._renderTimeoutId = setTimeout(function () {
        _renderTimer = requestAnimationFrame(renderPreview);
    }, 120);
}

function onEditorInput() {
    if (!editorEl) return;
    currentContent = editorEl.value;
    updateStats();
    setSaveState('dirty');
    if (currentMode === 'split') {
        debouncedRenderPreview();
    }
    saveToDocument(currentContent);
}

// Save state indicator: 'saved' | 'dirty' | 'saving'
var saveStateEl = null;
function setSaveState(state) {
    if (!saveStateEl) return;
    saveStateEl.className = 'save-state save-state-' + state;
    if (state === 'dirty') saveStateEl.textContent = '● 수정됨';
    else if (state === 'saving') saveStateEl.textContent = '◐ 저장 중';
    else saveStateEl.textContent = '✓ 저장됨';
}

function updateLineNumbers() {
    if (!lineNumbersEl || !editorEl) return;
    var lines = editorEl.value.split('\n').length;
    var html = '';
    for (var i = 1; i <= lines; i++) {
        html += '<span>' + i + '</span>';
    }
    lineNumbersEl.innerHTML = html;
}

/* ───────────────────────────────────────────
   VS Code communication
   ─────────────────────────────────────────── */
function saveToDocument(content) {
    clearTimeout(window._saveTimer);
    setSaveState('saving');
    window._saveTimer = setTimeout(function () {
        vscodeApi.postMessage({ type: 'edit', content: content });
        setSaveState('saved');
    }, 300);
}

/* ───────────────────────────────────────────
   Scroll synchronization (Split mode)
   ─────────────────────────────────────────── */
function setupScrollSync() {
    if (!editorEl || !previewEl) return;

    editorEl.addEventListener('scroll', function () {
        if (isSyncingScroll || currentMode !== 'split') return;
        isSyncingScroll = true;
        var pct = editorEl.scrollTop / (editorEl.scrollHeight - editorEl.clientHeight || 1);
        var previewContainer = previewEl.parentElement;
        previewContainer.scrollTop = pct * (previewContainer.scrollHeight - previewContainer.clientHeight);
        requestAnimationFrame(function () { isSyncingScroll = false; });
    });

    var previewContainer = previewEl.parentElement;
    previewContainer.addEventListener('scroll', function () {
        if (isSyncingScroll || currentMode !== 'split') return;
        isSyncingScroll = true;
        var pct = previewContainer.scrollTop / (previewContainer.scrollHeight - previewContainer.clientHeight || 1);
        editorEl.scrollTop = pct * (editorEl.scrollHeight - editorEl.clientHeight);
        requestAnimationFrame(function () { isSyncingScroll = false; });
    });
}

/* ───────────────────────────────────────────
   Keyboard shortcuts
   ─────────────────────────────────────────── */
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', function (e) {
        var mod = e.metaKey || e.ctrlKey;
        if (mod && (e.key === 'h' || e.key === 'H')) { e.preventDefault(); openFindReplace(); return; }
        if (mod && e.key === 'e') {
            e.preventDefault();
            setMode(currentMode === 'preview' ? 'edit' : 'preview');
        }
        if (mod && e.key === 'b' && (currentMode === 'edit' || currentMode === 'split')) {
            e.preventDefault();
            toolbarAction('bold');
        }
        if (mod && e.key === 'i' && (currentMode === 'edit' || currentMode === 'split')) {
            e.preventDefault();
            toolbarAction('italic');
        }
        if (mod && e.shiftKey && (e.key === 'c' || e.key === 'C') && (currentMode === 'edit' || currentMode === 'split')) {
            e.preventDefault();
            toolbarAction('code');
        }
        // Smart Tab — list indent or 4-space indent
        if (e.key === 'Tab' && document.activeElement === editorEl) {
            e.preventDefault();
            var start = editorEl.selectionStart;
            var end = editorEl.selectionEnd;
            var val = editorEl.value;
            var lineStart = val.lastIndexOf('\n', start - 1) + 1;
            var lineText = val.substring(lineStart, val.indexOf('\n', start) === -1 ? val.length : val.indexOf('\n', start));

            // If on a list item, indent the whole line
            var listMatch = lineText.match(/^(\s*)([-*+]|\d+\.)\s/);
            if (listMatch && !e.shiftKey) {
                editorEl.value = val.substring(0, lineStart) + '    ' + val.substring(lineStart);
                editorEl.selectionStart = editorEl.selectionEnd = start + 4;
            } else if (listMatch && e.shiftKey) {
                // Shift+Tab: outdent
                if (val.substring(lineStart, lineStart + 4) === '    ') {
                    editorEl.value = val.substring(0, lineStart) + val.substring(lineStart + 4);
                    editorEl.selectionStart = editorEl.selectionEnd = Math.max(lineStart, start - 4);
                }
            } else {
                editorEl.value = val.substring(0, start) + '    ' + val.substring(end);
                editorEl.selectionStart = editorEl.selectionEnd = start + 4;
            }
            onEditorInput();
            updateLineNumbers();
        }

        // Auto-continue list on Enter
        if (e.key === 'Enter' && !e.shiftKey && document.activeElement === editorEl) {
            var start = editorEl.selectionStart;
            var val = editorEl.value;
            var lineStart = val.lastIndexOf('\n', start - 1) + 1;
            var lineText = val.substring(lineStart, start);

            // Match list prefixes: - item, * item, + item, 1. item, > quote
            var match = lineText.match(/^(\s*)([-*+]|\d+\.|>)\s(.*)$/);
            if (match) {
                e.preventDefault();
                var indent = match[1];
                var marker = match[2];
                var content = match[3];

                // Empty list item → exit list
                if (content.trim() === '') {
                    editorEl.value = val.substring(0, lineStart) + val.substring(start);
                    editorEl.selectionStart = editorEl.selectionEnd = lineStart;
                } else {
                    // Increment numbered list marker
                    var newMarker = marker;
                    var numMatch = marker.match(/^(\d+)\.$/);
                    if (numMatch) {
                        newMarker = (parseInt(numMatch[1], 10) + 1) + '.';
                    }
                    var insertion = '\n' + indent + newMarker + ' ';
                    editorEl.value = val.substring(0, start) + insertion + val.substring(start);
                    editorEl.selectionStart = editorEl.selectionEnd = start + insertion.length;
                }
                onEditorInput();
                updateLineNumbers();
            }
        }

        // Focus mode toggle: Cmd+K Z (like VS Code Zen Mode)
        if (mod && (e.key === '.' || e.key === '/')) {
            if (e.shiftKey && e.key === '/') {  // Cmd+?
                e.preventDefault();
                toggleFocusMode();
            }
        }
    });
}

function toggleFocusMode() {
    document.body.classList.toggle('focus-mode');
}

/* ───────────────────────────────────────────
   Theme system
   ─────────────────────────────────────────── */
var themes = [
    { id: 'blue',    label: 'Blue',    color: '#448CFF' },
    { id: 'green',   label: 'Green',   color: '#10B981' },
    { id: 'rose',    label: 'Rose',    color: '#F43F5E' },
    { id: 'purple',  label: 'Purple',  color: '#8B5CF6' },
    { id: 'amber',   label: 'Amber',   color: '#F59E0B' },
    { id: 'neutral', label: 'Neutral', color: '#64748B' },
    { id: 'mono',    label: 'Mono',    color: '#171717', border: '#a3a3a3' },
    // 2026 Pantone trend palette
    { id: 'peach',   label: 'Peach',   color: '#E89A7A' },
    { id: 'aqua',    label: 'Aqua',    color: '#5FB89F' },
    { id: 'orchid',  label: 'Orchid',  color: '#B48AC7' },
    // Eye-comfort palette (low saturation, easy on eyes)
    { id: 'sage',    label: 'Sage',    color: '#8DA787' },
    { id: 'sepia',   label: 'Sepia',   color: '#A88568' },
    { id: 'mist',    label: 'Mist',    color: '#8BA3B0' }
];

var currentTheme = 'blue';

function applyTheme(themeId) {
    currentTheme = themeId;
    // Clear any previous custom CSS overrides
    clearCustomThemeVars();

    if (themeId === 'blue') {
        document.body.removeAttribute('data-theme');
    } else {
        document.body.setAttribute('data-theme', themeId);
    }
    localStorage.setItem('md-viewer-theme', themeId);
    localStorage.removeItem('md-viewer-custom-color');

    var currentDot = document.querySelector('.theme-dot-current');
    if (currentDot) {
        var theme = themes.find(function (t) { return t.id === themeId; });
        if (theme) currentDot.style.background = theme.color;
    }
    document.querySelectorAll('.theme-dot').forEach(function (dot) {
        dot.classList.toggle('active', dot.dataset.theme === themeId);
    });
}

/* ───────────────────────────────────────────
   Custom color (palette picker) theme
   ─────────────────────────────────────────── */
function hexToHsl(hex) {
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
    var r = parseInt(hex.substring(0, 2), 16) / 255;
    var g = parseInt(hex.substring(2, 4), 16) / 255;
    var b = parseInt(hex.substring(4, 6), 16) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
        var d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [h * 360, s * 100, l * 100];
}

function hslToHex(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    var r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
        var hue2rgb = function (p, q, t) {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        var p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }
    var toHex = function (x) {
        var h = Math.round(x * 255).toString(16);
        return h.length === 1 ? '0' + h : h;
    };
    return '#' + toHex(r) + toHex(g) + toHex(b);
}

function hexToRgba(hex, alpha) {
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
    var r = parseInt(hex.substring(0, 2), 16);
    var g = parseInt(hex.substring(2, 4), 16);
    var b = parseInt(hex.substring(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

var CUSTOM_VAR_NAMES = [
    '--md-accent', '--md-link', '--md-link-hover', '--md-inline-code-text',
    '--md-selection-bg', '--md-gradient', '--md-mark-bg', '--md-mark-text',
    '--hljs-keyword', '--hljs-string', '--hljs-number', '--hljs-function',
    '--hljs-variable', '--hljs-type', '--hljs-tag', '--hljs-attr',
    '--hljs-selector', '--hljs-built-in', '--hljs-addition', '--hljs-addition-bg'
];

function clearCustomThemeVars() {
    var root = document.body;
    CUSTOM_VAR_NAMES.forEach(function (v) { root.style.removeProperty(v); });
}

function applyCustomColor(hex) {
    currentTheme = 'custom';
    document.body.removeAttribute('data-theme');
    localStorage.setItem('md-viewer-theme', 'custom');
    localStorage.setItem('md-viewer-custom-color', hex);

    var isDark = document.body.classList.contains('vscode-dark') ||
                 document.body.classList.contains('vscode-high-contrast');
    var hsl = hexToHsl(hex);
    var h = hsl[0], s = hsl[1];

    var accent, link, linkHover, darker, lighter, lightest;
    if (isDark) {
        lightest = hslToHex(h, s, 85);
        lighter  = hslToHex(h, s, 75);
        accent   = hslToHex(h, s, 70);
        link     = hslToHex(h, s, 72);
        linkHover = hslToHex(h, s, 82);
        darker   = hslToHex(h, s, 55);
    } else {
        accent   = hex;
        link     = hslToHex(h, s, Math.max(30, hsl[2] - 8));
        linkHover = hslToHex(h, s, Math.max(20, hsl[2] - 18));
        darker   = hslToHex(h, s, Math.max(20, hsl[2] - 22));
        lighter  = hslToHex(h, s, Math.min(80, hsl[2] + 15));
        lightest = hslToHex(h, s, Math.min(92, hsl[2] + 28));
    }

    var root = document.body;
    root.style.setProperty('--md-accent', accent);
    root.style.setProperty('--md-link', link);
    root.style.setProperty('--md-link-hover', linkHover);
    root.style.setProperty('--md-inline-code-text', darker);
    root.style.setProperty('--md-selection-bg', hexToRgba(accent, 0.18));
    root.style.setProperty('--md-gradient',
        'linear-gradient(135deg, ' + link + ' 0%, ' + accent + ' 50%, ' + lighter + ' 100%)');
    root.style.setProperty('--md-mark-bg', isDark ? hexToRgba(accent, 0.22) : lightest);
    root.style.setProperty('--md-mark-text', isDark ? lightest : darker);

    root.style.setProperty('--hljs-keyword', link);
    root.style.setProperty('--hljs-string', darker);
    root.style.setProperty('--hljs-number', accent);
    root.style.setProperty('--hljs-function', linkHover);
    root.style.setProperty('--hljs-variable', accent);
    root.style.setProperty('--hljs-type', link);
    root.style.setProperty('--hljs-tag', accent);
    root.style.setProperty('--hljs-attr', lighter);
    root.style.setProperty('--hljs-selector', linkHover);
    root.style.setProperty('--hljs-built-in', accent);
    root.style.setProperty('--hljs-addition', link);
    root.style.setProperty('--hljs-addition-bg', isDark ? hexToRgba(accent, 0.15) : lightest);

    // UI picker states
    var currentDot = document.querySelector('.theme-dot-current');
    if (currentDot) currentDot.style.background = hex;
    document.querySelectorAll('.theme-dot').forEach(function (d) { d.classList.remove('active'); });
    var customDot = document.querySelector('.theme-dot-custom');
    if (customDot) customDot.classList.add('active');
}

function buildThemePicker() {
    var picker = document.createElement('div');
    picker.className = 'theme-picker';

    var btn = document.createElement('button');
    btn.className = 'theme-picker-btn';
    btn.title = 'Change Theme';

    var dot = document.createElement('span');
    dot.className = 'theme-dot-current';
    var activeTheme = themes.find(function (t) { return t.id === currentTheme; });
    dot.style.background = activeTheme ? activeTheme.color : '#448CFF';
    btn.appendChild(dot);

    var dropdown = document.createElement('div');
    dropdown.className = 'theme-dropdown';

    // Show only 6 primary theme dots
    var visibleThemes = themes.filter(function (t) {
        return ['blue', 'green', 'rose', 'purple', 'amber', 'neutral'].indexOf(t.id) !== -1;
    });

    visibleThemes.forEach(function (t) {
        var d = document.createElement('span');
        d.className = 'theme-dot' + (t.id === currentTheme ? ' active' : '');
        d.dataset.theme = t.id;
        d.title = t.label;
        d.style.background = t.color;
        if (t.border) d.style.border = '2px solid ' + t.border;
        d.addEventListener('click', function (e) {
            e.stopPropagation();
            applyTheme(t.id);
            dropdown.classList.remove('open');
        });
        dropdown.appendChild(d);
    });

    // Custom color (+) button — opens curated palette
    var customBtn = document.createElement('button');
    customBtn.type = 'button';
    customBtn.className = 'theme-dot theme-dot-custom' +
        (currentTheme === 'custom' ? ' active' : '');
    customBtn.title = 'Pick custom color';
    customBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>';

    var palette = buildColorPalette();
    customBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        palette.classList.toggle('open');
    });

    dropdown.appendChild(customBtn);
    dropdown.appendChild(palette);

    btn.addEventListener('click', function (e) {
        e.stopPropagation();
        dropdown.classList.toggle('open');
    });

    document.addEventListener('click', function () {
        dropdown.classList.remove('open');
    });

    picker.appendChild(btn);
    picker.appendChild(dropdown);
    return picker;
}

/* ───────────────────────────────────────────
   Curated color palette
   ─────────────────────────────────────────── */
var colorPalette = {
    'Warm': [
        '#FF6B6B', '#F4A261', '#E89A7A', '#E76F51',
        '#F4C96E', '#F59E0B', '#D4A373', '#A88568'
    ],
    'Cool': [
        '#448CFF', '#3B82F6', '#0EA5E9', '#06B6D4',
        '#14B8A6', '#10B981', '#5FB89F', '#8DA787'
    ],
    'Rich': [
        '#8B5CF6', '#A855F7', '#D946EF', '#EC4899',
        '#F43F5E', '#B48AC7', '#6366F1', '#7C3AED'
    ],
    'Muted': [
        '#64748B', '#94A3B8', '#8BA3B0', '#78716C',
        '#A8A29E', '#737373', '#171717', '#F5F5F5'
    ]
};

function buildColorPalette() {
    var wrap = document.createElement('div');
    wrap.className = 'color-palette';

    var title = document.createElement('div');
    title.className = 'palette-title';
    title.textContent = '컬러 선택 / Pick a color';
    wrap.appendChild(title);

    Object.keys(colorPalette).forEach(function (category) {
        var row = document.createElement('div');
        row.className = 'palette-row';

        var label = document.createElement('span');
        label.className = 'palette-label';
        label.textContent = category;
        row.appendChild(label);

        var swatches = document.createElement('div');
        swatches.className = 'palette-swatches';

        colorPalette[category].forEach(function (color) {
            var s = document.createElement('button');
            s.type = 'button';
            s.className = 'palette-swatch';
            s.style.background = color;
            s.title = color;
            if (color === '#F5F5F5' || color === '#FFFFFF') {
                s.style.border = '1px solid rgba(0,0,0,0.15)';
            }
            s.addEventListener('click', function (e) {
                e.stopPropagation();
                applyCustomColor(color);
                wrap.classList.remove('open');
                document.querySelector('.theme-dropdown').classList.remove('open');
            });
            swatches.appendChild(s);
        });

        row.appendChild(swatches);
        wrap.appendChild(row);
    });

    // Custom hex input row
    var hexRow = document.createElement('div');
    hexRow.className = 'palette-hex-row';

    var hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.className = 'palette-hex-input';
    hexInput.placeholder = '#448CFF';
    hexInput.maxLength = 7;
    hexInput.value = localStorage.getItem('md-viewer-custom-color') || '';

    var nativeColor = document.createElement('input');
    nativeColor.type = 'color';
    nativeColor.className = 'palette-native-color';
    nativeColor.value = hexInput.value || '#448CFF';

    // Sync native color picker with hex input
    nativeColor.addEventListener('input', function (e) {
        e.stopPropagation();
        hexInput.value = e.target.value.toUpperCase();
        applyCustomColor(e.target.value);
    });
    nativeColor.addEventListener('click', function (e) { e.stopPropagation(); });

    var applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'palette-apply-btn';
    applyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l3.5 3.5L13 5"/></svg>';
    applyBtn.title = 'Apply';

    var applyHex = function () {
        var val = hexInput.value.trim();
        if (!val.startsWith('#')) val = '#' + val;
        if (/^#[0-9a-fA-F]{6}$/.test(val) || /^#[0-9a-fA-F]{3}$/.test(val)) {
            applyCustomColor(val);
            wrap.classList.remove('open');
            document.querySelector('.theme-dropdown').classList.remove('open');
        }
    };

    applyBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        applyHex();
    });
    hexInput.addEventListener('click', function (e) { e.stopPropagation(); });
    hexInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') applyHex();
    });

    hexRow.appendChild(nativeColor);
    hexRow.appendChild(hexInput);
    hexRow.appendChild(applyBtn);
    wrap.appendChild(hexRow);

    wrap.addEventListener('click', function (e) { e.stopPropagation(); });
    return wrap;
}

/* ───────────────────────────────────────────
   Build UI
   ─────────────────────────────────────────── */
function buildUI(fileName) {
    var app = document.getElementById('app');
    app.innerHTML = '';

    // ── Topbar ──
    var topbar = document.createElement('div');
    topbar.className = 'topbar';

    var topLeft = document.createElement('div');
    topLeft.className = 'topbar-left';

    var fileIcon = document.createElement('span');
    fileIcon.className = 'file-icon';
    fileIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 1.5h7.293L13.5 4.707V14.5h-10.5v-13z" stroke="currentColor" stroke-opacity="0.6" fill="none"/><path d="M10 1.5V5h3.5" stroke="currentColor" stroke-opacity="0.4" fill="none"/><path d="M5 8h6M5 10h6M5 12h4" stroke="currentColor" stroke-opacity="0.4" stroke-linecap="round"/></svg>';

    var fileNameEl = document.createElement('span');
    fileNameEl.className = 'file-name';
    fileNameEl.textContent = fileName;

    topLeft.appendChild(fileIcon);
    topLeft.appendChild(fileNameEl);

    var modeTabs = document.createElement('div');
    modeTabs.className = 'mode-tabs';

    var modes = [
        { id: 'preview', label: 'Preview' },
        { id: 'edit', label: 'Edit' },
        { id: 'split', label: 'Split' }
    ];

    modes.forEach(function (m) {
        var btn = document.createElement('button');
        btn.className = 'mode-tab' + (m.id === 'preview' ? ' active' : '');
        btn.dataset.mode = m.id;
        btn.textContent = m.label;
        btn.addEventListener('click', function () { setMode(m.id); });
        modeTabs.appendChild(btn);
    });

    var topRight = document.createElement('div');
    topRight.className = 'topbar-right';

    // Theme picker
    topRight.appendChild(buildThemePicker());

    // Font size controls (always visible)
    var fontSizeGroup = document.createElement('div');
    fontSizeGroup.className = 'font-size-group';

    var fontDownBtn = document.createElement('button');
    fontDownBtn.className = 'topbar-btn font-ctrl';
    fontDownBtn.title = 'Decrease Font Size';
    fontDownBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M3.5 8.5h9a.75.75 0 000-1.5h-9a.75.75 0 000 1.5z"/></svg>';
    fontDownBtn.addEventListener('click', function () { changeFontSize(-1); });

    var savedSize = localStorage.getItem('md-viewer-font-size');
    var initialSize = savedSize ? parseFloat(savedSize) : 16;

    fontSizeDisplayEl = document.createElement('span');
    fontSizeDisplayEl.className = 'font-size-display';
    fontSizeDisplayEl.textContent = Math.round(initialSize);

    var fontUpBtn = document.createElement('button');
    fontUpBtn.className = 'topbar-btn font-ctrl';
    fontUpBtn.title = 'Increase Font Size';
    fontUpBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8.75 3.5a.75.75 0 00-1.5 0v3.75H3.5a.75.75 0 000 1.5h3.75v3.75a.75.75 0 001.5 0V8.75h3.75a.75.75 0 000-1.5H8.75V3.5z"/></svg>';
    fontUpBtn.addEventListener('click', function () { changeFontSize(1); });

    fontSizeGroup.appendChild(fontDownBtn);
    fontSizeGroup.appendChild(fontSizeDisplayEl);
    fontSizeGroup.appendChild(fontUpBtn);
    topRight.appendChild(fontSizeGroup);

    // PDF export button (always visible in topbar)
    var pdfBtn = document.createElement('button');
    pdfBtn.className = 'topbar-btn pdf-btn';
    pdfBtn.title = 'Export as PDF / PDF로 저장';
    pdfBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 2h6l3 3v9h-9V2z"/><path d="M9.5 2v3h3"/><text x="4.5" y="11.5" font-size="3.2" font-weight="700" fill="currentColor" stroke="none" font-family="sans-serif">PDF</text></svg>';
    pdfBtn.addEventListener('click', function () { exportToPdf(); });
    topRight.appendChild(pdfBtn);

    var outlineBtn = document.createElement('button');
    outlineBtn.className = 'topbar-btn outline-toggle';
    outlineBtn.title = 'Toggle Outline';
    outlineBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="3" width="12" height="1.4" rx="0.7"/><rect x="2" y="7.3" width="12" height="1.4" rx="0.7"/><rect x="2" y="11.6" width="12" height="1.4" rx="0.7"/></svg>';
    outlineBtn.addEventListener('click', function () {
        outlineVisible = !outlineVisible;
        outlineEl.classList.toggle('hidden', !outlineVisible);
        outlineBtn.classList.toggle('active', outlineVisible);
    });

    topRight.appendChild(outlineBtn);

    topbar.appendChild(topLeft);
    topbar.appendChild(modeTabs);
    topbar.appendChild(topRight);
    app.appendChild(topbar);

    // ── Toolbar ──
    toolbarEl = document.createElement('div');
    toolbarEl.className = 'toolbar';

    // OS-aware modifier label for tooltips
    var isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform || '');
    var modKey = isMac ? 'Cmd' : 'Ctrl';

    var toolbarItems = [
        { action: 'h1', label: 'H1', title: 'Heading 1' },
        { action: 'h2', label: 'H2', title: 'Heading 2' },
        { action: 'h3', label: 'H3', title: 'Heading 3' },
        { action: 'divider' },
        { action: 'bold', label: 'B', title: 'Bold (' + modKey + '+B)', cls: 'bold-btn' },
        { action: 'italic', label: 'I', title: 'Italic (' + modKey + '+I)', cls: 'italic-btn' },
        { action: 'code', label: '<>', title: 'Code (' + modKey + '+Shift+C)', cls: 'code-btn' },
        { action: 'divider' },
        { action: 'link', label: '', title: 'Link', icon: 'link' },
        { action: 'bullet', label: '', title: 'Bullet List', icon: 'bullet' },
        { action: 'number', label: '', title: 'Numbered List', icon: 'number' },
        { action: 'quote', label: '', title: 'Blockquote', icon: 'quote' },
        { action: 'divider' },
        { action: 'hr', label: '', title: 'Horizontal Rule', icon: 'hr' },
        { action: 'divider' },
        { action: 'copy', label: '', title: 'Copy Markdown', icon: 'copy' },
        { action: 'copy-html', label: '', title: 'Copy as HTML', icon: 'html' },
        { action: 'focus', label: '', title: 'Focus Mode', icon: 'focus' }
    ];

    toolbarItems.forEach(function (item) {
        if (item.action === 'divider') {
            var div = document.createElement('span');
            div.className = 'toolbar-divider';
            toolbarEl.appendChild(div);
            return;
        }
        var btn = document.createElement('button');
        btn.className = 'toolbar-btn' + (item.cls ? ' ' + item.cls : '');
        btn.title = item.title;

        if (item.icon) {
            btn.innerHTML = getToolbarIcon(item.icon);
        } else {
            btn.textContent = item.label;
        }

        btn.addEventListener('click', function () { toolbarAction(item.action); });
        toolbarEl.appendChild(btn);
    });

    app.appendChild(toolbarEl);

    // ── Main content area ──
    var mainContent = document.createElement('div');
    mainContent.className = 'main-content';

    // Editor pane with line numbers
    var editorPane = document.createElement('div');
    editorPane.className = 'editor-pane';

    var editorWrap = document.createElement('div');
    editorWrap.className = 'editor-wrap';

    lineNumbersEl = document.createElement('div');
    lineNumbersEl.className = 'line-numbers';

    editorEl = document.createElement('textarea');
    editorEl.className = 'editor-textarea';
    editorEl.spellcheck = false;
    editorEl.placeholder = 'Start writing markdown...';
    editorEl.value = currentContent;
    editorEl.addEventListener('input', function() {
        onEditorInput();
        updateLineNumbers();
    });
    editorEl.addEventListener('scroll', function() {
        if (lineNumbersEl) lineNumbersEl.scrollTop = editorEl.scrollTop;
    });

    // Paste handler — convert clipboard images to base64 markdown
    editorEl.addEventListener('paste', function (e) {
        if (!e.clipboardData || !e.clipboardData.items) return;
        for (var i = 0; i < e.clipboardData.items.length; i++) {
            var item = e.clipboardData.items[i];
            if (item.type && item.type.indexOf('image/') === 0) {
                e.preventDefault();
                var file = item.getAsFile();
                if (!file) continue;
                var reader = new FileReader();
                reader.onload = function (ev) {
                    var dataUrl = ev.target.result;
                    var altText = 'image-' + Date.now();
                    var insertion = '![' + altText + '](' + dataUrl + ')';
                    var start = editorEl.selectionStart;
                    var end = editorEl.selectionEnd;
                    editorEl.value = editorEl.value.substring(0, start) + insertion + editorEl.value.substring(end);
                    editorEl.selectionStart = editorEl.selectionEnd = start + insertion.length;
                    onEditorInput();
                    updateLineNumbers();
                    showToast('이미지 붙여넣음 / Image pasted');
                };
                reader.readAsDataURL(file);
                return;
            }
        }
    });

    editorWrap.appendChild(lineNumbersEl);
    editorWrap.appendChild(editorEl);
    editorPane.appendChild(editorWrap);

    // Edit mode dblclick on margin → preview (skip when target is textarea so word-select works)
    editorPane.addEventListener('dblclick', function (e) {
        if (currentMode === 'edit' && e.target !== editorEl) setMode('preview');
    });

    // Slash command menu
    setupSlashMenu(editorEl);

    // Preview pane
    var previewPane = document.createElement('div');
    previewPane.className = 'preview-pane';
    previewEl = document.createElement('div');
    previewEl.className = 'markdown-body';
    previewEl.id = 'preview';
    previewPane.appendChild(previewEl);

    // Double-click hint
    var hint = document.createElement('div');
    hint.className = 'dblclick-hint';
    hint.textContent = 'Double-click to edit';
    previewPane.appendChild(hint);

    // Double-click to switch to edit mode
    previewPane.addEventListener('dblclick', function () {
        if (currentMode === 'preview') {
            setMode('edit');
        }
    });

    // Outline pane
    outlineEl = document.createElement('div');
    outlineEl.className = 'outline-pane hidden';

    var outlineHeader = document.createElement('div');
    outlineHeader.className = 'outline-header';
    outlineHeader.textContent = 'Outline';

    outlineListEl = document.createElement('div');
    outlineListEl.className = 'outline-list';

    outlineEl.appendChild(outlineHeader);
    outlineEl.appendChild(outlineListEl);

    mainContent.appendChild(editorPane);
    mainContent.appendChild(previewPane);
    mainContent.appendChild(outlineEl);
    app.appendChild(mainContent);

    // ── Statusbar ──
    var statusbar = document.createElement('div');
    statusbar.className = 'statusbar';

    statsLeftEl = document.createElement('span');
    statsLeftEl.className = 'stats-left';

    var statsCenter = document.createElement('span');
    statsCenter.className = 'stats-center';
    saveStateEl = document.createElement('span');
    saveStateEl.className = 'save-state save-state-saved';
    saveStateEl.textContent = '✓ 저장됨';
    statsCenter.appendChild(saveStateEl);

    statsRightEl = document.createElement('span');
    statsRightEl.className = 'stats-right';

    statusbar.appendChild(statsLeftEl);
    statusbar.appendChild(statsCenter);
    statusbar.appendChild(statsRightEl);
    app.appendChild(statusbar);
}

function getToolbarIcon(name) {
    var icons = {
        link: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6.354 5.5H4a3 3 0 0 0 0 6h3a3 3 0 0 0 2.83-4H9a2 2 0 0 1-2 2H5a2 2 0 1 1 0-4h1.354z"/><path d="M9.646 10.5H12a3 3 0 1 0 0-6H9a3 3 0 0 0-2.83 4H7a2 2 0 0 1 2-2h2a2 2 0 1 1 0 4H9.646z"/></svg>',
        bullet: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="3" cy="4" r="1.2"/><rect x="6" y="3.3" width="8" height="1.4" rx="0.7"/><circle cx="3" cy="8" r="1.2"/><rect x="6" y="7.3" width="8" height="1.4" rx="0.7"/><circle cx="3" cy="12" r="1.2"/><rect x="6" y="11.3" width="8" height="1.4" rx="0.7"/></svg>',
        number: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><text x="1.5" y="5.5" font-size="5" font-weight="700" font-family="sans-serif">1.</text><rect x="6" y="3.3" width="8" height="1.4" rx="0.7"/><text x="1.5" y="9.5" font-size="5" font-weight="700" font-family="sans-serif">2.</text><rect x="6" y="7.3" width="8" height="1.4" rx="0.7"/><text x="1.5" y="13.5" font-size="5" font-weight="700" font-family="sans-serif">3.</text><rect x="6" y="11.3" width="8" height="1.4" rx="0.7"/></svg>',
        quote: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" opacity="0.8"><path d="M3 3h2.5c.8 0 1.5.7 1.5 1.5v2c0 .8-.7 1.5-1.5 1.5H4v1.5c0 1-1 2-2 2.5v-1c.5-.3 1-.8 1-1.5V8h-.5C1.7 8 1 7.3 1 6.5v-2C1 3.7 1.7 3 2.5 3H3zM10 3h2.5c.8 0 1.5.7 1.5 1.5v2c0 .8-.7 1.5-1.5 1.5H11v1.5c0 1-1 2-2 2.5v-1c.5-.3 1-.8 1-1.5V8h-.5C8.7 8 8 7.3 8 6.5v-2C8 3.7 8.7 3 9.5 3H10z"/></svg>',
        hr: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="7" width="14" height="2" rx="1"/></svg>',
        copy: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="4" width="8" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6 4V2.5C6 2.2 6.2 2 6.5 2h5c.3 0 .5.2.5.5v7c0 .3-.2.5-.5.5H10" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
        html: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5L3 8l2.5 3M10.5 5L13 8l-2.5 3M9 4l-2 8" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        focus: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 5V2h3M14 5V2h-3M2 11v3h3M14 11v3h-3"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>'
    };
    return icons[name] || '';
}

/* ───────────────────────────────────────────
   Message handling from extension
   ─────────────────────────────────────────── */
function setupMessageListener() {
    window.addEventListener('message', function (e) {
        var msg = e.data;
        if (msg.type === 'update') {
            currentContent = msg.content;
            if (editorEl && document.activeElement !== editorEl) {
                editorEl.value = currentContent;
            }
            if (currentMode === 'preview' || currentMode === 'split') {
                renderPreview();
            }
            updateStats();
        } else if (msg.type === 'command') {
            if (msg.action === 'toggleMode') {
                setMode(currentMode === 'preview' ? 'edit' : 'preview');
            } else if (msg.action === 'bold') {
                if (currentMode === 'edit' || currentMode === 'split') toolbarAction('bold');
            } else if (msg.action === 'italic') {
                if (currentMode === 'edit' || currentMode === 'split') toolbarAction('italic');
            } else if (msg.action === 'code') {
                if (currentMode === 'edit' || currentMode === 'split') toolbarAction('code');
            }
        } else if (msg.type === 'configChange') {
            if (msg.settings && msg.settings.defaultTheme) {
                applyTheme(msg.settings.defaultTheme);
            }
            if (msg.settings && msg.settings.defaultFontSize) {
                document.documentElement.style.setProperty('--md-font-size', msg.settings.defaultFontSize + 'px');
                if (fontSizeDisplayEl) fontSizeDisplayEl.textContent = msg.settings.defaultFontSize;
            }
        }
    });
}

/* ───────────────────────────────────────────
   initEditor — global entry point
   ─────────────────────────────────────────── */
function initEditor(content, fileName, baseUri, initialSettings) {
    currentContent = content;
    docBaseUri = baseUri || '';
    configureMarked();

    var settings = initialSettings || {};

    // Font size: saved > settings > default
    var savedFontSize = localStorage.getItem('md-viewer-font-size');
    var fontSize = savedFontSize || (settings.defaultFontSize ? settings.defaultFontSize + 'px' : null);
    if (fontSize) {
        document.documentElement.style.setProperty('--md-font-size', fontSize);
    }

    // Theme: saved > settings > default
    var savedTheme = localStorage.getItem('md-viewer-theme');
    currentTheme = savedTheme || settings.defaultTheme || 'blue';

    // Default mode
    if (settings.defaultMode) {
        currentMode = settings.defaultMode;
    }

    // Outline default
    if (settings.showOutline) {
        outlineVisible = true;
    }

    buildUI(fileName);
    // Restore custom color if saved
    var savedCustomColor = localStorage.getItem('md-viewer-custom-color');
    if (currentTheme === 'custom' && savedCustomColor) {
        applyCustomColor(savedCustomColor);
    } else {
        applyTheme(currentTheme);
    }
    updateLineNumbers();

    // Apply initial mode if not preview
    if (currentMode !== 'preview') {
        setMode(currentMode);
    }

    // Apply initial outline state
    if (outlineVisible && outlineEl) {
        outlineEl.classList.remove('hidden');
        var outlineBtn = document.querySelector('.outline-toggle');
        if (outlineBtn) outlineBtn.classList.add('active');
    }

    renderPreview();
    updateStats();
    setupScrollSync();
    setupKeyboardShortcuts();
    setupMessageListener();
}

/* Find & Replace panel (v0.9.0) */
var _findPanel = null;
function openFindReplace() {
    if (currentMode === 'preview') setMode('edit');
    if (!editorEl) return;
    if (_findPanel) { _findPanel.style.display = 'block'; var fi = _findPanel.querySelector('.fr-find'); if (fi) { fi.focus(); fi.select(); } return; }
    var p = document.createElement('div');
    p.className = 'find-replace-panel';
    p.innerHTML = '<div class="fr-row"><input type="text" class="fr-find" placeholder="찾기 / Find"><button class="fr-prev" title="이전">↑</button><button class="fr-next" title="다음">↓</button><span class="fr-count"></span></div><div class="fr-row"><input type="text" class="fr-replace" placeholder="바꾸기 / Replace"><button class="fr-replace-one">바꾸기</button><button class="fr-replace-all">모두</button><button class="fr-close" title="닫기">×</button></div>';
    document.body.appendChild(p);
    _findPanel = p;
    var findInput = p.querySelector('.fr-find');
    var replaceInput = p.querySelector('.fr-replace');
    var count = p.querySelector('.fr-count');
    function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    function updateCount() {
        var q = findInput.value;
        if (!q || !editorEl) { count.textContent = ''; return; }
        var m = editorEl.value.match(new RegExp(esc(q), 'gi'));
        count.textContent = (m ? m.length : 0) + ' matches';
    }
    function findNext(dir) {
        var q = findInput.value; if (!q || !editorEl) return;
        var v = editorEl.value, lv = v.toLowerCase(), ql = q.toLowerCase(), pos;
        if (dir === 'prev') { pos = lv.lastIndexOf(ql, editorEl.selectionStart - 1); if (pos < 0) pos = lv.lastIndexOf(ql); }
        else { pos = lv.indexOf(ql, editorEl.selectionEnd); if (pos < 0) pos = lv.indexOf(ql); }
        if (pos >= 0) {
            editorEl.focus(); editorEl.selectionStart = pos; editorEl.selectionEnd = pos + q.length;
            var lh = parseFloat(getComputedStyle(editorEl).lineHeight) || 22;
            editorEl.scrollTop = Math.max(0, (v.substring(0, pos).split('\n').length - 4) * lh);
        }
    }
    function replaceOne() {
        var q = findInput.value, r = replaceInput.value; if (!q || !editorEl) return;
        var sel = editorEl.value.substring(editorEl.selectionStart, editorEl.selectionEnd);
        if (sel.toLowerCase() === q.toLowerCase()) {
            var pos = editorEl.selectionStart;
            editorEl.value = editorEl.value.substring(0, pos) + r + editorEl.value.substring(editorEl.selectionEnd);
            editorEl.selectionStart = editorEl.selectionEnd = pos + r.length;
            onEditorInput(); updateLineNumbers();
        }
        findNext('next'); updateCount();
    }
    function replaceAll() {
        var q = findInput.value, r = replaceInput.value; if (!q || !editorEl) return;
        var re = new RegExp(esc(q), 'gi');
        var n = (editorEl.value.match(re) || []).length;
        editorEl.value = editorEl.value.replace(re, r);
        onEditorInput(); updateLineNumbers(); updateCount();
        showToast(n + '개 바꿈');
    }
    findInput.addEventListener('input', updateCount);
    findInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); findNext(e.shiftKey ? 'prev' : 'next'); } else if (e.key === 'Escape') closeFindReplace(); });
    replaceInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } else if (e.key === 'Escape') closeFindReplace(); });
    p.querySelector('.fr-next').addEventListener('click', function () { findNext('next'); });
    p.querySelector('.fr-prev').addEventListener('click', function () { findNext('prev'); });
    p.querySelector('.fr-replace-one').addEventListener('click', replaceOne);
    p.querySelector('.fr-replace-all').addEventListener('click', replaceAll);
    p.querySelector('.fr-close').addEventListener('click', closeFindReplace);
    findInput.focus();
}
function closeFindReplace() { if (_findPanel) _findPanel.style.display = 'none'; if (editorEl) editorEl.focus(); }

/* Slash command menu (v0.9.0) */
var SLASH_COMMANDS = [
    { key: 'h1', label: 'Heading 1', insert: '# ' },
    { key: 'h2', label: 'Heading 2', insert: '## ' },
    { key: 'h3', label: 'Heading 3', insert: '### ' },
    { key: 'code', label: 'Code block', insert: '```\n\n```', co: -4 },
    { key: 'table', label: 'Table', insert: '| Header | Header |\n| ------ | ------ |\n| Cell | Cell |\n' },
    { key: 'link', label: 'Link', insert: '[text](url)', co: -6 },
    { key: 'image', label: 'Image', insert: '![alt](url)', co: -5 },
    { key: 'quote', label: 'Blockquote', insert: '> ' },
    { key: 'bullet', label: 'Bullet list', insert: '- ' },
    { key: 'number', label: 'Numbered list', insert: '1. ' },
    { key: 'hr', label: 'Divider', insert: '\n---\n' },
    { key: 'check', label: 'Task / Checkbox', insert: '- [ ] ' },
    { key: 'note', label: 'Admonition (Note)', insert: ':::note\n\n:::', co: -5 },
    { key: 'warning', label: 'Admonition (Warning)', insert: ':::warning\n\n:::', co: -5 },
    { key: 'math', label: 'Math block (KaTeX)', insert: '$$\n\n$$', co: -4 },
    { key: 'mermaid', label: 'Mermaid diagram', insert: '```mermaid\n\n```', co: -4 },
    { key: 'toc', label: 'Table of Contents', insert: '[[TOC]]\n' }
];
function setupSlashMenu(textarea) {
    var menu = null, slashPos = -1;
    function close() { if (menu) { menu.remove(); menu = null; } slashPos = -1; }
    function open() {
        close();
        slashPos = textarea.selectionStart - 1;
        menu = document.createElement('div');
        menu.className = 'slash-menu';
        render('');
        position();
        document.body.appendChild(menu);
    }
    function position() {
        if (!menu) return;
        var rect = textarea.getBoundingClientRect();
        // Simple positioning near textarea top
        menu.style.top = (rect.top + 40) + 'px';
        menu.style.left = (rect.left + 30) + 'px';
    }
    function render(filter) {
        if (!menu) return;
        var f = (filter || '').toLowerCase();
        var items = SLASH_COMMANDS.filter(function (c) { return c.key.toLowerCase().indexOf(f) >= 0 || c.label.toLowerCase().indexOf(f) >= 0; });
        menu.innerHTML = items.map(function (c, i) {
            return '<div class="slash-item' + (i === 0 ? ' active' : '') + '" data-key="' + c.key + '"><span class="slash-label">' + c.label + '</span><span class="slash-hint">/' + c.key + '</span></div>';
        }).join('') || '<div class="slash-empty">No match</div>';
        Array.from(menu.querySelectorAll('.slash-item')).forEach(function (el) {
            el.addEventListener('mouseenter', function () { menu.querySelectorAll('.slash-item').forEach(function (x) { x.classList.remove('active'); }); el.classList.add('active'); });
            el.addEventListener('mousedown', function (e) { e.preventDefault(); apply(el.dataset.key); });
        });
    }
    function apply(key) {
        var cmd = SLASH_COMMANDS.find(function (c) { return c.key === key; });
        if (!cmd) return close();
        var v = textarea.value, caret = textarea.selectionStart;
        var before = v.substring(0, slashPos), after = v.substring(caret);
        var nc = before.length + cmd.insert.length + (cmd.co || 0);
        textarea.value = before + cmd.insert + after;
        textarea.selectionStart = textarea.selectionEnd = nc;
        textarea.focus();
        onEditorInput(); updateLineNumbers();
        close();
    }
    textarea.addEventListener('keydown', function (e) {
        if (!menu) return;
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            var items = menu.querySelectorAll('.slash-item');
            if (!items.length) return;
            var idx = 0; items.forEach(function (it, i) { if (it.classList.contains('active')) idx = i; });
            items[idx].classList.remove('active');
            idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[idx].classList.add('active');
            items[idx].scrollIntoView({ block: 'nearest' });
            return;
        }
        if (e.key === 'Enter') { e.preventDefault(); var a = menu.querySelector('.slash-item.active'); if (a) apply(a.dataset.key); return; }
    });
    textarea.addEventListener('input', function () {
        if (!menu) {
            var p = textarea.selectionStart, v = textarea.value;
            if (p > 0 && v[p - 1] === '/' && (p === 1 || v[p - 2] === '\n')) open();
            return;
        }
        var v = textarea.value, p = textarea.selectionStart;
        if (p <= slashPos) { close(); return; }
        var q = v.substring(slashPos + 1, p);
        if (q.indexOf(' ') >= 0 || q.indexOf('\n') >= 0) { close(); return; }
        render(q);
    });
    textarea.addEventListener('blur', function () { setTimeout(close, 150); });
}
