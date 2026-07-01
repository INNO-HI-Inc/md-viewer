/* MD Pretty Viewer — Webview Editor Logic */

/* Safe localStorage helpers (v0.9.5) — webview env may block storage */
function lsGet(key) {
    try { return lsGet(key); } catch (_) { return null; }
}
function lsSet(key, value) {
    try { lsSet(key, value); } catch (_) { /* quota / private mode */ }
}
function lsRemove(key) {
    try { lsRemove(key); } catch (_) {}
}

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
    // Drop foreign content & interactive tags wholesale (defense-in-depth)
    var dropWithContent = {
        script: true, style: true, iframe: true, object: true,
        embed: true, link: true, meta: true, base: true,
        svg: true, math: true, template: true, noscript: true,
        form: true, button: true, textarea: true, select: true,
        option: true, datalist: true, output: true, progress: true,
        portal: true, audio: true, video: true, source: true, track: true
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
    // data-* are safe by spec (no script execution surface); needed for our
    // own block-edit metadata (data-block-idx).
    if (attr.indexOf('data-') === 0) return true;
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

/* Token-aware rendering (v1.0.6) — keeps top-level token list around so
   inline block-edit can find the raw markdown for any rendered block. */
var _currentTokens = null;
function renderMarkdown(text) {
    var tokens = marked.lexer(text);
    _currentTokens = tokens;
    // Render each top-level token individually and wrap with a div carrying
    // its index in the token array. Editable blocks: heading/paragraph/
    // blockquote/list/code/hr/table. Other tokens render as-is without a
    // wrapper so structural elements (space) don't pollute the DOM.
    var EDITABLE_TYPES = {
        heading: 1, paragraph: 1, blockquote: 1, list: 1, code: 1, hr: 1, table: 1, html: 1
    };
    var parts = [];
    for (var i = 0; i < tokens.length; i++) {
        var token = tokens[i];
        var blockHtml;
        try {
            blockHtml = marked.parser([token]);
        } catch (_) {
            blockHtml = '';
        }
        if (EDITABLE_TYPES[token.type]) {
            parts.push('<div class="md-block" data-block-idx="' + i + '">' + blockHtml + '</div>');
        } else {
            parts.push(blockHtml);
        }
    }
    return sanitizeHtml(parts.join(''));
}

function highlightCodeBlocks(container) {
    if (typeof hljs !== 'undefined') {
        container.querySelectorAll('pre code').forEach(function (block) {
            hljs.highlightElement(block);
        });
    }
    enhanceCodeBlocks(container);
}

/* Image lightbox (v1.0.2) — click to enlarge, ESC/click to close, wheel to zoom */
var _lightboxEl = null;
var _lightboxCleanup = null;  // tear down window listeners when closing
function openLightbox(src, alt) {
    closeLightbox();
    var overlay = document.createElement('div');
    overlay.className = 'image-lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', alt || 'Image preview');
    var img = document.createElement('img');
    img.src = src;
    img.alt = alt || '';
    img.draggable = false;

    var caption = document.createElement('div');
    caption.className = 'lightbox-caption';
    caption.textContent = alt || '';
    if (!alt) caption.style.display = 'none';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'lightbox-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';

    var hint = document.createElement('div');
    hint.className = 'lightbox-hint';
    hint.textContent = 'ESC 또는 클릭으로 닫기 · 휠로 확대/축소';

    overlay.appendChild(img);
    overlay.appendChild(caption);
    overlay.appendChild(closeBtn);
    overlay.appendChild(hint);
    document.body.appendChild(overlay);
    _lightboxEl = overlay;

    var scale = 1, tx = 0, ty = 0;
    var isDragging = false, dragStartX = 0, dragStartY = 0, dragOriginX = 0, dragOriginY = 0;
    function apply() {
        img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
    }
    function onWheel(e) {
        e.preventDefault();
        var delta = -e.deltaY * 0.0015;
        scale = Math.min(6, Math.max(0.3, scale + delta * scale));
        apply();
    }
    function onMouseDown(e) {
        if (scale <= 1) return;
        isDragging = true;
        dragStartX = e.clientX; dragStartY = e.clientY;
        dragOriginX = tx; dragOriginY = ty;
        img.style.cursor = 'grabbing';
        e.preventDefault();
    }
    function onMouseMove(e) {
        if (!isDragging) return;
        tx = dragOriginX + (e.clientX - dragStartX);
        ty = dragOriginY + (e.clientY - dragStartY);
        apply();
    }
    function onMouseUp() {
        if (!isDragging) return;
        isDragging = false;
        img.style.cursor = 'grab';
    }
    function onDblClick(e) {
        e.stopPropagation();
        if (scale > 1) { scale = 1; tx = 0; ty = 0; } else { scale = 2.5; }
        apply();
    }
    function onClickOverlay(e) {
        if (e.target === overlay || e.target === closeBtn) closeLightbox();
    }

    overlay.addEventListener('wheel', onWheel, { passive: false });
    img.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    img.addEventListener('dblclick', onDblClick);
    overlay.addEventListener('click', onClickOverlay);

    // Tear-down used by closeLightbox to detach window listeners (avoid leak)
    _lightboxCleanup = function () {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
    };

    // Defer fade-in to next frame for transition
    requestAnimationFrame(function () { overlay.classList.add('show'); });
}
function closeLightbox() {
    if (!_lightboxEl) return;
    var el = _lightboxEl;
    _lightboxEl = null;
    if (_lightboxCleanup) { _lightboxCleanup(); _lightboxCleanup = null; }
    el.classList.remove('show');
    setTimeout(function () { if (el && el.parentNode) el.parentNode.removeChild(el); }, 180);
}
function bindImageLightbox(container) {
    if (!container) return;
    container.querySelectorAll('img').forEach(function (img) {
        // Skip emoji/inline-icon style tiny images
        if (img.dataset.lightboxBound === '1') return;
        img.dataset.lightboxBound = '1';
        img.style.cursor = 'zoom-in';
        img.addEventListener('click', function (e) {
            e.preventDefault();
            openLightbox(img.src, img.alt || '');
        });
    });
}

/* In-place block editing (v1.0.6 / v1.0.9 WYSIWYG)
   Preview에서 블록 더블클릭 → 그 블록만 contenteditable로 바뀌어 렌더된 텍스트를
   그대로 편집. 저장 시 turndown으로 HTML→markdown 라운드트립.
   복잡한 블록(code/math/mermaid/table/html)은 fallback으로 raw textarea를 사용. */
var _activeBlockEdit = null;  // { blockEl, blockIdx, originalRaw, mode: 'wysiwyg'|'raw', textarea, trailingBlanks }
var _turndown = null;

function getTurndown() {
    if (_turndown) return _turndown;
    if (typeof TurndownService === 'undefined') return null;
    _turndown = new TurndownService({
        headingStyle: 'atx',          // # not ===
        bulletListMarker: '-',
        codeBlockStyle: 'fenced',
        fence: '```',
        emDelimiter: '*',
        strongDelimiter: '**',
        linkStyle: 'inlined'
    });
    // Strip Tossface emoji <img> wrapper — emojis live in the body text fine
    // (the font handles them) but if any are inlined as <img>, keep alt text.
    _turndown.addRule('mdEmojiImg', {
        filter: function (node) { return node.nodeName === 'IMG' && node.classList && node.classList.contains('md-emoji'); },
        replacement: function (content, node) { return node.getAttribute('alt') || ''; }
    });
    // Preserve hard line breaks
    _turndown.addRule('lineBreak', {
        filter: 'br',
        replacement: function () { return '  \n'; }
    });
    // Compact list output — turndown's default indents li content by 4 spaces
    // and adds blank lines between items, which visibly changes the source
    // formatting after a WYSIWYG edit. Emit "- text\n" per item so the source
    // stays close to what the user originally wrote.
    _turndown.addRule('compactList', {
        filter: 'li',
        replacement: function (content, node, options) {
            content = content.replace(/^\s+/, '').replace(/\s+$/, '').replace(/\n/g, '\n  ');
            var marker = options.bulletListMarker + ' ';
            var parent = node.parentNode;
            if (parent && parent.nodeName === 'OL') {
                var start = parent.getAttribute('start');
                var index = Array.prototype.indexOf.call(parent.children, node);
                marker = (start ? parseInt(start, 10) + index : index + 1) + '. ';
            }
            return marker + content + (node.nextSibling && !/\n$/.test(content) ? '\n' : '');
        }
    });
    return _turndown;
}

function bindBlockEditing(container) {
    if (!container) return;
    container.querySelectorAll('.md-block').forEach(function (blockEl) {
        if (blockEl.dataset.editBound === '1') return;
        blockEl.dataset.editBound = '1';

        var blockIdx = parseInt(blockEl.dataset.blockIdx, 10);
        var token = _currentTokens && _currentTokens[blockIdx];

        // Tables get cell-level WYSIWYG editing — preserves the table
        // structure and only swaps the touched cell. Two flavors:
        //   markdown tables (token.type === 'table')  → precise header/rows edit
        //   HTML tables inside an html block          → cell edit + innerHTML rewrite
        if (token && token.type === 'table') {
            bindTableCellEditing(blockEl, blockIdx, token, 'markdown');
            return;
        }
        if (token && token.type === 'html' && blockEl.querySelector('table')) {
            bindTableCellEditing(blockEl, blockIdx, token, 'html');
            return;
        }

        // ✏ pencil icon in the top-right corner on hover — the only way to
        // open the inline editor. (Double-click no longer opens editing; it
        // still bubbles up to the preview pane's Preview↔Edit mode toggle.)
        addEditIcon(blockEl, function () { openBlockEditor(blockEl); });
    });
}

/* Small floating pencil that appears in the corner of a hovered block or cell.
   Click to open the editor. Stored under the block/cell but not part of the
   saved source — stripped by cleanEditAffordances() before every commit. */
function addEditIcon(host, onClick) {
    if (!host || host.querySelector(':scope > .md-edit-icon')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'md-edit-icon';
    btn.title = '수정';
    btn.setAttribute('aria-label', '수정');
    btn.dataset.mdChrome = '1';   // marker so we can strip on save
    btn.textContent = '✏';
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });  // don't blur active editor
    btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof onClick === 'function') onClick();
    });
    host.appendChild(btn);
}

/* Remove any UI chrome we injected (edit icons, done buttons) so the
   captured HTML doesn't include them when we compute the new source. */
function cleanEditAffordances(root) {
    if (!root) return;
    root.querySelectorAll('[data-md-chrome="1"]').forEach(function (n) { n.remove(); });
}

/* Floating "✓ 완료" button that appears while a block or cell is being
   edited. Clicking it commits the same way Cmd/Ctrl+Enter does. */
function addDoneButton(host) {
    if (!host || host.querySelector(':scope > .md-done-btn')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'md-done-btn';
    btn.dataset.mdChrome = '1';
    btn.setAttribute('aria-label', '완료');
    btn.textContent = '✓ 완료';
    // Prevent blur from firing on the editable region when the button is pressed
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeBlockEditor(true);
    });
    host.appendChild(btn);
}

function bindTableCellEditing(blockEl, blockIdx, token, kind) {
    blockEl.querySelectorAll('th, td').forEach(function (cell) {
        // Cell needs positioning context for the absolute edit icon
        if (!cell.style.position) cell.style.position = 'relative';
        addEditIcon(cell, function () { openCellEditor(cell, blockIdx, kind || 'markdown'); });
    });
}

function openCellEditor(cell, blockIdx, kind) {
    // Capture row/col coordinates BEFORE anything mutates the DOM.
    // If _activeBlockEdit is set, closing it triggers renderPreview which
    // rebuilds the DOM — the incoming `cell` reference would then be stale
    // (detached), and every mutation below would silently no-op.
    var row = cell.parentElement;                 // <tr>
    var section = row.parentElement;              // <thead> | <tbody> | <table>
    var isHeader = section.tagName === 'THEAD';
    var colIdx = Array.from(row.children).indexOf(cell);
    var rowIdx = -1;
    if (!isHeader) {
        rowIdx = Array.from(section.children).indexOf(row);
    }

    if (_activeBlockEdit) {
        closeBlockEditor(true);
        // Re-find the target cell in the freshly rendered DOM using the
        // coordinates we captured a moment ago.
        var freshBlock = previewEl && previewEl.querySelector('.md-block[data-block-idx="' + blockIdx + '"]');
        if (!freshBlock) return;
        var freshTable = freshBlock.querySelector('table');
        if (!freshTable) return;
        if (isHeader) {
            var thead = freshTable.querySelector('thead');
            var hrow = thead ? thead.querySelector('tr') : freshTable.querySelector('tr');
            cell = hrow ? hrow.children[colIdx] : null;
        } else {
            var freshSection = freshTable.querySelector('tbody') || freshTable;
            var freshRow = Array.from(freshSection.children).filter(function (n) { return n.tagName === 'TR'; })[rowIdx];
            cell = freshRow ? freshRow.children[colIdx] : null;
        }
        if (!cell) return;
    }
    if (!_currentTokens || !_currentTokens[blockIdx]) return;
    var token = _currentTokens[blockIdx];

    // Strip the pencil icon inside this cell before editing starts —
    // avoids the user typing "into" the button and keeps the captured
    // innerHTML clean.
    cleanEditAffordances(cell);

    cell.classList.add('md-cell-editing');
    cell.setAttribute('contenteditable', 'true');
    cell.setAttribute('spellcheck', 'true');
    cell.focus();
    try {
        var range = document.createRange();
        range.selectNodeContents(cell);
        range.collapse(false);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    } catch (_) {}

    addDoneButton(cell);

    _activeBlockEdit = {
        mode: kind === 'html' ? 'html-cell' : 'cell',
        blockEl: cell.closest('.md-block'),
        blockIdx: blockIdx,
        cell: cell,
        rowIdx: rowIdx,
        colIdx: colIdx,
        isHeader: isHeader,
        originalRaw: token.raw,
        trailingBlanks: (token.raw || '').match(/\n*$/)[0]
    };

    var keyHandler = function (ev) {
        if (ev.key === 'Escape') { ev.preventDefault(); closeBlockEditor(false); }
        else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
            ev.preventDefault();
            closeBlockEditor(true);
        } else if (ev.key === 'Enter' && !ev.shiftKey) {
            // Cells don't get multi-line content in markdown — Enter should commit
            ev.preventDefault();
            closeBlockEditor(true);
        } else if (ev.key === 'Tab') {
            // Tab moves to next cell
            ev.preventDefault();
            var next = ev.shiftKey ? prevCell(cell) : nextCell(cell);
            closeBlockEditor(true);
            if (next) {
                // Re-bind happens after renderPreview; defer to next frame
                setTimeout(function () {
                    var newBlock = previewEl && previewEl.querySelector('.md-block[data-block-idx="' + blockIdx + '"]');
                    if (!newBlock) return;
                    var newRow = newBlock.querySelectorAll('tr')[isHeader && next.rowIdx === 0 ? 1 : 0];  // simplification
                    var newCell = newBlock.querySelectorAll(next.isHeader ? 'th' : 'tr td')[next.colIdx];
                    if (newCell) openCellEditor(newCell, blockIdx);
                }, 50);
            }
        }
    };
    var blurHandler = function () {
        setTimeout(function () {
            if (_activeBlockEdit && _activeBlockEdit.cell === cell) closeBlockEditor(true);
        }, 0);
    };
    cell.addEventListener('keydown', keyHandler);
    cell.addEventListener('blur', blurHandler);
    _activeBlockEdit.teardown = function () {
        cell.removeEventListener('keydown', keyHandler);
        cell.removeEventListener('blur', blurHandler);
        cell.removeAttribute('contenteditable');
        cell.removeAttribute('spellcheck');
        cell.classList.remove('md-cell-editing');
    };
}

function nextCell(cell) {
    if (cell.nextElementSibling) return cell.nextElementSibling;
    var row = cell.parentElement;
    if (row.nextElementSibling) return row.nextElementSibling.firstElementChild;
    return null;
}
function prevCell(cell) {
    if (cell.previousElementSibling) return cell.previousElementSibling;
    var row = cell.parentElement;
    if (row.previousElementSibling) return row.previousElementSibling.lastElementChild;
    return null;
}

function alignToDelim(a) {
    if (a === 'left') return ':---';
    if (a === 'right') return '---:';
    if (a === 'center') return ':---:';
    return '---';
}
function regenerateTableMarkdown(token) {
    var sep = ' | ';
    var lines = [];
    lines.push('| ' + token.header.map(function (h) { return (h.text || '').trim(); }).join(sep) + ' |');
    lines.push('| ' + (token.align || []).map(alignToDelim).join(' | ') + ' |');
    token.rows.forEach(function (row) {
        lines.push('| ' + row.map(function (c) { return (c.text || '').trim(); }).join(sep) + ' |');
    });
    return lines.join('\n') + '\n';
}

// Tokens whose rendered form is safe to edit via contenteditable +
// HTML→markdown round-trip. Complex tokens (code, table, math, html, hr)
// fall back to raw textarea so we don't lose formatting.
function isWysiwygSafe(token, blockEl) {
    if (!token) return false;
    var simple = { heading: 1, paragraph: 1, blockquote: 1, list: 1, html: 1 };
    if (!simple[token.type]) return false;
    // Only block-level complex content forces raw fallback. Inline <code>
    // is safe — turndown wraps it back in backticks correctly. We exclude
    // <pre> (fenced code blocks), KaTeX math nodes, Mermaid diagrams, and
    // admonition boxes whose round-trip is lossy.
    if (blockEl.querySelector('pre, .katex, .katex-display, .mermaid-diagram, .md-admonition')) return false;
    // HTML tokens that contain their own structural layout (tables, details,
    // multiple sibling divs) are safer to keep as raw-source editing so we
    // don't collapse the layout to plain markdown.
    if (token.type === 'html') {
        if (blockEl.querySelector('table, details, summary, iframe, form')) return false;
        if (blockEl.querySelectorAll('div').length > 1) return false;
    }
    return true;
}

function openBlockEditor(blockEl) {
    // Capture block index BEFORE closeBlockEditor triggers renderPreview —
    // the `blockEl` reference we were passed would become detached.
    var blockIdx = parseInt(blockEl.dataset.blockIdx, 10);
    if (isNaN(blockIdx)) return;
    if (_activeBlockEdit) {
        closeBlockEditor(true);
        // Re-find the same block in the freshly rendered DOM
        blockEl = previewEl && previewEl.querySelector('.md-block[data-block-idx="' + blockIdx + '"]');
        if (!blockEl) return;
    }
    if (!_currentTokens || !_currentTokens[blockIdx]) return;
    var token = _currentTokens[blockIdx];
    var trailingBlanks = (token.raw || '').match(/\n*$/)[0];

    if (isWysiwygSafe(token, blockEl) && getTurndown()) {
        openWysiwygEditor(blockEl, blockIdx, token, trailingBlanks);
    } else {
        openRawEditor(blockEl, blockIdx, token, trailingBlanks);
    }
}

function openWysiwygEditor(blockEl, blockIdx, token, trailingBlanks) {
    // Strip any UI chrome (pencil icon) so the captured innerHTML doesn't
    // include our own markup when it goes through turndown.
    cleanEditAffordances(blockEl);

    blockEl.classList.add('md-block-editing', 'md-block-wysiwyg');
    blockEl.setAttribute('contenteditable', 'true');
    blockEl.setAttribute('spellcheck', 'true');
    blockEl.focus();

    // Place cursor at end of block
    try {
        var range = document.createRange();
        range.selectNodeContents(blockEl);
        range.collapse(false);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    } catch (_) {}

    addDoneButton(blockEl);

    _activeBlockEdit = {
        blockEl: blockEl, blockIdx: blockIdx, originalRaw: token.raw,
        trailingBlanks: trailingBlanks, mode: 'wysiwyg'
    };

    var keyHandler = function (ev) {
        if (ev.key === 'Escape') { ev.preventDefault(); closeBlockEditor(false); }
        else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
            ev.preventDefault();
            closeBlockEditor(true);
        }
    };
    var blurHandler = function () {
        setTimeout(function () {
            if (_activeBlockEdit && _activeBlockEdit.blockEl === blockEl) closeBlockEditor(true);
        }, 0);
    };
    blockEl.addEventListener('keydown', keyHandler);
    blockEl.addEventListener('blur', blurHandler);
    _activeBlockEdit.teardown = function () {
        blockEl.removeEventListener('keydown', keyHandler);
        blockEl.removeEventListener('blur', blurHandler);
        blockEl.removeAttribute('contenteditable');
        blockEl.removeAttribute('spellcheck');
        blockEl.classList.remove('md-block-editing', 'md-block-wysiwyg');
    };
}

function openRawEditor(blockEl, blockIdx, token, trailingBlanks) {
    var raw = (token.raw || '').replace(/\n+$/, '');
    var textarea = document.createElement('textarea');
    textarea.className = 'md-block-editor';
    textarea.value = raw;
    textarea.spellcheck = false;
    var rect = blockEl.getBoundingClientRect();
    textarea.style.minHeight = Math.max(40, rect.height) + 'px';

    blockEl.classList.add('md-block-editing');
    blockEl.innerHTML = '';
    blockEl.appendChild(textarea);
    autoResizeTextarea(textarea);
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;

    addDoneButton(blockEl);

    _activeBlockEdit = {
        blockEl: blockEl, blockIdx: blockIdx, originalRaw: token.raw,
        trailingBlanks: trailingBlanks, mode: 'raw', textarea: textarea
    };

    textarea.addEventListener('input', function () { autoResizeTextarea(textarea); });
    textarea.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') { ev.preventDefault(); closeBlockEditor(false); }
        else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
            ev.preventDefault();
            closeBlockEditor(true);
        }
    });
    textarea.addEventListener('blur', function () {
        setTimeout(function () { if (_activeBlockEdit && _activeBlockEdit.textarea === textarea) closeBlockEditor(true); }, 0);
    });
}

function autoResizeTextarea(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.max(40, ta.scrollHeight + 2) + 'px';
}

function closeBlockEditor(commit) {
    if (!_activeBlockEdit) return;
    var ed = _activeBlockEdit;
    _activeBlockEdit = null;

    if (!commit) {
        if (ed.teardown) ed.teardown();
        renderPreview();
        return;
    }

    var newRaw;
    var token = _currentTokens && _currentTokens[ed.blockIdx];
    if (!token) { renderPreview(); return; }

    if (ed.mode === 'cell') {
        // Cell-level edit — update only the touched cell's text, regenerate
        // the whole table markdown, keep all other cells/rows intact.
        var td = getTurndown();
        var cellText;
        if (td) {
            try { cellText = td.turndown(ed.cell.innerHTML).replace(/[\r\n]+/g, ' ').trim(); }
            catch (_) { cellText = ed.cell.innerText.trim(); }
        } else {
            cellText = ed.cell.innerText.trim();
        }
        if (ed.isHeader) {
            if (token.header && token.header[ed.colIdx]) token.header[ed.colIdx].text = cellText;
        } else {
            if (token.rows && token.rows[ed.rowIdx] && token.rows[ed.rowIdx][ed.colIdx]) {
                token.rows[ed.rowIdx][ed.colIdx].text = cellText;
            }
        }
        newRaw = regenerateTableMarkdown(token);
        if (ed.teardown) ed.teardown();
    } else if (ed.mode === 'html-cell') {
        // HTML table cell edit — do NOT capture the block's live innerHTML,
        // because that includes runtime wrappers we injected (.md-block,
        // .table-scroll, data-block-idx, contenteditable, spellcheck…) and
        // would contaminate the saved source. Instead, take the ORIGINAL
        // token.raw, parse it, find the same cell by row/col index, and
        // swap just its innerHTML with the edited version. Everything else
        // in the source markup is preserved byte-for-byte.
        cleanEditAffordances(ed.cell);
        var editedInnerHtml = ed.cell.innerHTML;
        if (ed.teardown) ed.teardown();
        var scratch = document.createElement('div');
        scratch.innerHTML = ed.originalRaw || '';
        var sourceTable = scratch.querySelector('table');
        if (sourceTable) {
            var targetCell = null;
            if (ed.isHeader) {
                // Header cells live in either <thead> or the first <tr>
                var thead = sourceTable.querySelector('thead');
                if (thead) {
                    var hrow = thead.querySelector('tr');
                    if (hrow) targetCell = hrow.children[ed.colIdx];
                }
                if (!targetCell) {
                    var firstRow = sourceTable.querySelector('tr');
                    if (firstRow) targetCell = firstRow.children[ed.colIdx];
                }
            } else {
                // Body cell — index rows across tbody (or table if no tbody),
                // matching how openCellEditor computed rowIdx.
                var section = sourceTable.querySelector('tbody') || sourceTable;
                var bodyRows = Array.from(section.children).filter(function (n) { return n.tagName === 'TR'; });
                var row = bodyRows[ed.rowIdx];
                if (row) targetCell = row.children[ed.colIdx];
            }
            if (targetCell) targetCell.innerHTML = editedInnerHtml;
        }
        newRaw = scratch.innerHTML;
        // Strip implicit <tbody> the browser added if the original didn't have one
        if (!/<tbody[\s>]/i.test(ed.originalRaw || '') && /<tbody[\s>]/i.test(newRaw)) {
            newRaw = newRaw.replace(/<tbody[^>]*>/gi, '').replace(/<\/tbody>/gi, '');
        }
    } else if (ed.mode === 'wysiwyg') {
        cleanEditAffordances(ed.blockEl);
        var td2 = getTurndown();
        if (!td2) { renderPreview(); return; }
        try {
            newRaw = td2.turndown(ed.blockEl.innerHTML).trim();
        } catch (e) {
            console.warn('MD Pretty Viewer: turndown failed', e);
            renderPreview();
            return;
        }
        if (ed.teardown) ed.teardown();
    } else {
        newRaw = ed.textarea.value;
    }

    var oldRaw = (ed.originalRaw || '').replace(/\n+$/, '');
    if (newRaw.replace(/\n+$/, '') === oldRaw) {
        renderPreview();
        return;
    }
    var newRawWithTrailing = newRaw.replace(/\n+$/, '') + (ed.trailingBlanks || '\n\n');
    var parts = [];
    for (var i = 0; i < _currentTokens.length; i++) {
        parts.push(i === ed.blockIdx ? newRawWithTrailing : (_currentTokens[i].raw || ''));
    }
    var updated = parts.join('');
    currentContent = updated;
    if (editorEl) editorEl.value = updated;
    saveToDocument(updated);
    updateStats();
    renderPreview();
}

/* Wrap wide tables in horizontal scroll container (v1.0.2) */
function wrapTablesScrollable(container) {
    if (!container) return;
    container.querySelectorAll('table').forEach(function (table) {
        var parent = table.parentElement;
        if (!parent || parent.classList.contains('table-scroll')) return;
        // Don't wrap if table is inside our own admonition body or other special wrapper
        var wrap = document.createElement('div');
        wrap.className = 'table-scroll';
        parent.insertBefore(wrap, table);
        wrap.appendChild(table);
    });
}

/* Code block enhancement (v0.9.4) — language label + copy button */
function enhanceCodeBlocks(container) {
    container.querySelectorAll('pre').forEach(function (pre) {
        if (pre.dataset.enhanced) return;
        if (pre.parentElement && pre.parentElement.classList.contains('code-block-wrap')) return;
        var code = pre.querySelector('code');
        if (!code) return;
        // Skip mermaid (it'll be replaced by diagram)
        if (code.classList.contains('language-mermaid') || code.classList.contains('lang-mermaid')) return;

        // Detect language from class
        var lang = '';
        Array.from(code.classList).forEach(function (cls) {
            var m = cls.match(/^(?:language|lang)-(.+)$/);
            if (m) lang = m[1];
        });

        var wrap = document.createElement('div');
        wrap.className = 'code-block-wrap';
        pre.parentElement.insertBefore(wrap, pre);

        var header = document.createElement('div');
        header.className = 'code-block-header';

        var label = document.createElement('span');
        label.className = 'code-block-lang';
        label.textContent = lang || 'text';
        header.appendChild(label);

        var copyBtn = document.createElement('button');
        copyBtn.className = 'code-block-copy';
        copyBtn.type = 'button';
        copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="4.5" y="4.5" width="8" height="9" rx="1.2"/><path d="M3.5 11V3a.5.5 0 0 1 .5-.5h7"/></svg><span>Copy</span>';
        copyBtn.title = 'Copy code';
        // Look up code via DOM (avoid closure capture of `code` that prevents GC)
        copyBtn.addEventListener('click', function (e) {
            var btn = e.currentTarget;
            var wrapEl = btn.closest('.code-block-wrap');
            var codeEl = wrapEl && wrapEl.querySelector('pre code');
            var text = codeEl ? (codeEl.textContent || '') : '';
            (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () {
                btn.classList.add('copied');
                var span = btn.querySelector('span');
                if (span) span.textContent = 'Copied!';
                setTimeout(function () {
                    btn.classList.remove('copied');
                    if (span) span.textContent = 'Copy';
                }, 1500);
            }).catch(function () { showToast('복사 실패'); });
        });
        header.appendChild(copyBtn);

        wrap.appendChild(header);
        wrap.appendChild(pre);
        pre.dataset.enhanced = '1';
    });
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
    headings.forEach(function (h, idx) {
        var item = document.createElement('div');
        item.className = 'outline-item level-' + h.level;
        item.textContent = h.text;
        item.dataset.headingIndex = idx;
        item.addEventListener('click', function () {
            scrollToHeading(h.text);
        });
        outlineListEl.appendChild(item);
    });
    // Wire up scroll tracking after headings are rendered into preview
    setupOutlineScrollSpy();
}

/* Outline scroll-spy (v1.0.2) — highlight active heading as user scrolls */
var _outlineSpyObserver = null;
var _outlineActiveItem = null;
function setupOutlineScrollSpy() {
    if (!previewEl || !outlineListEl) return;
    if (_outlineSpyObserver) { _outlineSpyObserver.disconnect(); _outlineSpyObserver = null; }
    var headingEls = previewEl.querySelectorAll('h1, h2, h3, h4');
    if (!headingEls.length) return;
    var items = outlineListEl.querySelectorAll('.outline-item');
    if (!items.length) return;

    // Map heading element → outline item, in DOM order
    var pairs = [];
    var itemIdx = 0;
    headingEls.forEach(function (h) {
        // Only match levels 1-4 (extractHeadings filters to these)
        var level = parseInt(h.tagName[1], 10);
        if (level > 4) return;
        if (itemIdx < items.length) {
            pairs.push({ heading: h, item: items[itemIdx] });
            itemIdx++;
        }
    });
    if (!pairs.length) return;

    // Track which headings are in viewport; pick topmost as active
    var visible = new Set();
    _outlineSpyObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
            if (e.isIntersecting) visible.add(e.target);
            else visible.delete(e.target);
        });
        // Pick topmost visible; if none visible, pick last one above viewport
        var topMost = null;
        var topMostY = Infinity;
        visible.forEach(function (el) {
            var rect = el.getBoundingClientRect();
            if (rect.top < topMostY) { topMostY = rect.top; topMost = el; }
        });
        if (!topMost) {
            // Find last heading whose top is above current scroll position
            var scrollTop = previewEl.parentElement ? previewEl.parentElement.scrollTop : window.scrollY;
            for (var i = pairs.length - 1; i >= 0; i--) {
                if (topWithin(pairs[i].heading, previewEl) <= scrollTop + 20) { topMost = pairs[i].heading; break; }
            }
        }
        if (!topMost) return;
        var match = pairs.find(function (p) { return p.heading === topMost; });
        if (match && match.item !== _outlineActiveItem) {
            if (_outlineActiveItem) _outlineActiveItem.classList.remove('active');
            match.item.classList.add('active');
            _outlineActiveItem = match.item;
            // Keep active item visible in outline panel
            var rect = match.item.getBoundingClientRect();
            var pr = outlineListEl.getBoundingClientRect();
            if (rect.top < pr.top + 10 || rect.bottom > pr.bottom - 10) {
                match.item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    }, {
        // top margin negative pushes the trigger line down (heading must reach near top to be 'active')
        root: previewEl.parentElement || null,
        rootMargin: '0px 0px -70% 0px',
        threshold: [0, 1]
    });
    pairs.forEach(function (p) { _outlineSpyObserver.observe(p.heading); });
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
var _isRendering = false;
function renderPreview() {
    if (!previewEl) return;
    if (_isRendering) return;       // re-entrancy guard
    _isRendering = true;
    try {
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
        wrapTablesScrollable(previewEl);
        bindImageLightbox(previewEl);
        bindBlockEditing(previewEl);
        renderMath(previewEl);
        renderMermaid(previewEl);
        // Rebuild scroll-sync anchors after each render so heading offsets stay accurate
        buildScrollAnchors();
    } catch (err) {
        console.error('MD Pretty Viewer: render failed', err);
    } finally {
        _isRendering = false;
    }
}

/* Lazy script loader (v0.8.0) */
var _lazyLoaded = {};
function lazyLoadScript(key, url) {
    if (_lazyLoaded[key]) return _lazyLoaded[key];
    if (!url) return Promise.reject(new Error('missing url for ' + key));
    var s = document.createElement('script');
    _lazyLoaded[key] = new Promise(function (resolve, reject) {
        s.src = url;
        if (window.__lazyAssets && window.__lazyAssets.nonce) s.setAttribute('nonce', window.__lazyAssets.nonce);
        s.onload = function () { resolve(); };
        s.onerror = function (e) {
            // Clear cache + remove failed <script> so user can retry
            delete _lazyLoaded[key];
            if (s.parentNode) s.parentNode.removeChild(s);
            reject(e);
        };
        document.head.appendChild(s);
    });
    return _lazyLoaded[key];
}
var _mermaidInited = false;
function renderMermaid(container) {
    if (!container) return;
    var blocks = container.querySelectorAll('pre code.language-mermaid, pre code.lang-mermaid');
    if (blocks.length === 0) return;
    var assets = window.__lazyAssets || {};
    lazyLoadScript('mermaid', assets.mermaid).then(function () {
        if (typeof mermaid === 'undefined') return;
        if (!_mermaidInited) {
            try {
                mermaid.initialize({
                    startOnLoad: false,
                    theme: document.body.classList.contains('vscode-dark') ? 'dark' : 'default',
                    securityLevel: 'strict',
                    fontFamily: 'inherit'
                });
                _mermaidInited = true;
            } catch (e) {}
        }
        blocks.forEach(function (codeEl, idx) {
            var pre = codeEl.parentElement;
            if (!pre || pre.dataset.mermaidRendered) return;
            var source = codeEl.textContent || '';
            var wrapper = document.createElement('div');
            wrapper.className = 'mermaid-diagram';
            wrapper.id = 'mermaid-' + Date.now() + '-' + idx;
            pre.replaceWith(wrapper);

            var fallbackHtml = '<pre><code class="language-mermaid">' +
                source.replace(/&/g, '&amp;').replace(/</g, '&lt;') +
                '</code></pre>';

            try {
                mermaid.render(wrapper.id + '-svg', source).then(function (r) {
                    // Guard: wrapper might be replaced by a newer render cycle
                    if (!wrapper.isConnected) return;
                    wrapper.innerHTML = r.svg;
                }).catch(function () {
                    if (!wrapper.isConnected) return;
                    wrapper.outerHTML = fallbackHtml;
                });
            } catch (e) {
                if (wrapper.isConnected) wrapper.outerHTML = fallbackHtml;
            }
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

// Unified slugify (preserves Hangul). Used by both injectTOC and addHeadingIds.
function slugify(text) {
    return 'heading-' + String(text || '').toLowerCase()
        .replace(/[`*_~]/g, '')
        .replace(/[^\w\s\-가-힣ㄱ-ㅎㅏ-ㅣ]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 60);
}

function injectTOC(md) {
    // Replace [[TOC]] or [[목차]] markers with a generated table of contents
    if (!/\[\[(TOC|목차)\]\]/i.test(md)) return md;
    var lines = md.split('\n');
    var inCode = false;
    var headings = [];
    var seen = {};
    lines.forEach(function (line) {
        if (/^```/.test(line)) { inCode = !inCode; return; }
        if (inCode) return;
        var m = line.match(/^(#{1,4})\s+(.+?)\s*$/);
        if (m) {
            if (/\[\[(TOC|목차)\]\]/i.test(m[2])) return;
            var level = m[1].length;
            var text = m[2].replace(/[`*_~]/g, '').trim();
            var slug = slugify(text);
            // Deduplicate: append -2, -3, ... if collision
            if (seen[slug] != null) {
                seen[slug]++;
                slug = slug + '-' + seen[slug];
            } else {
                seen[slug] = 1;
            }
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
    // Find the Nth checkbox in the source markdown and toggle it.
    // CRITICAL: skip lines inside fenced code blocks so we don't corrupt code examples.
    var lines = currentContent.split('\n');
    var found = 0;
    var inFence = false;
    for (var i = 0; i < lines.length; i++) {
        // Track fenced code blocks (```)
        if (/^\s*```/.test(lines[i])) { inFence = !inFence; continue; }
        if (inFence) continue;
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
    var seen = {};
    previewEl.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(function (el) {
        if (el.id) return;
        var slug = slugify(el.textContent.trim());
        if (seen[slug] != null) {
            seen[slug]++;
            slug = slug + '-' + seen[slug];
        } else {
            seen[slug] = 1;
        }
        el.id = slug;
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
    lsSet('md-viewer-font-size', newSize + 'px');
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

var _isExporting = false;
/* PDF options dialog (v1.0.2) — paper size, orientation, margins, header/footer */
var PDF_DEFAULTS = {
    paperSize: 'a4',          // 'a4' | 'letter'
    orientation: 'portrait',   // 'portrait' | 'landscape'
    margin: 'normal',          // 'narrow' | 'normal' | 'wide'
    showHeader: true,
    showPageNumber: true
};
function getPdfOptions() {
    var saved = lsGet('md-viewer-pdf-options');
    if (!saved) return Object.assign({}, PDF_DEFAULTS);
    try {
        var parsed = JSON.parse(saved);
        return Object.assign({}, PDF_DEFAULTS, parsed);
    } catch (_) { return Object.assign({}, PDF_DEFAULTS); }
}
function savePdfOptions(o) { lsSet('md-viewer-pdf-options', JSON.stringify(o)); }

function showPdfOptionsDialog(onConfirm) {
    var existing = document.querySelector('.pdf-options-dialog');
    if (existing) existing.remove();
    var opts = getPdfOptions();

    var overlay = document.createElement('div');
    overlay.className = 'pdf-options-dialog';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'PDF 내보내기 옵션');
    overlay.innerHTML =
        '<div class="pdf-dialog-panel">' +
            '<h3>PDF 내보내기 옵션</h3>' +
            '<div class="pdf-row">' +
                '<label>용지 크기</label>' +
                '<div class="pdf-segmented" data-key="paperSize">' +
                    '<button data-val="a4">A4</button>' +
                    '<button data-val="letter">Letter</button>' +
                '</div>' +
            '</div>' +
            '<div class="pdf-row">' +
                '<label>방향</label>' +
                '<div class="pdf-segmented" data-key="orientation">' +
                    '<button data-val="portrait">세로</button>' +
                    '<button data-val="landscape">가로</button>' +
                '</div>' +
            '</div>' +
            '<div class="pdf-row">' +
                '<label>여백</label>' +
                '<div class="pdf-segmented" data-key="margin">' +
                    '<button data-val="narrow">좁게</button>' +
                    '<button data-val="normal">보통</button>' +
                    '<button data-val="wide">넓게</button>' +
                '</div>' +
            '</div>' +
            '<div class="pdf-row">' +
                '<label class="pdf-check"><input type="checkbox" data-key="showHeader"> <span>상단 제목 표시</span></label>' +
            '</div>' +
            '<div class="pdf-row">' +
                '<label class="pdf-check"><input type="checkbox" data-key="showPageNumber"> <span>페이지 번호 표시</span></label>' +
            '</div>' +
            '<div class="pdf-actions">' +
                '<button class="pdf-cancel">취소</button>' +
                '<button class="pdf-confirm">PDF 만들기</button>' +
            '</div>' +
        '</div>';
    document.body.appendChild(overlay);

    function syncUI() {
        overlay.querySelectorAll('.pdf-segmented').forEach(function (group) {
            var key = group.dataset.key;
            group.querySelectorAll('button').forEach(function (b) {
                b.classList.toggle('active', b.dataset.val === opts[key]);
            });
        });
        overlay.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
            cb.checked = !!opts[cb.dataset.key];
        });
    }
    syncUI();

    overlay.querySelectorAll('.pdf-segmented button').forEach(function (b) {
        b.addEventListener('click', function () {
            opts[b.parentElement.dataset.key] = b.dataset.val;
            syncUI();
        });
    });
    overlay.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
        cb.addEventListener('change', function () { opts[cb.dataset.key] = cb.checked; });
    });
    var keyHandler;  // forward decl so close() can reference it
    function close() {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (keyHandler) document.removeEventListener('keydown', keyHandler, true);
    }
    overlay.querySelector('.pdf-cancel').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    overlay.querySelector('.pdf-confirm').addEventListener('click', function () {
        savePdfOptions(opts);
        close();
        onConfirm(opts);
    });
    // Keyboard: ESC cancels, Enter confirms (when not focused on a button)
    keyHandler = function (e) {
        // Defensive: if overlay already detached, unbind and bail
        if (!overlay.parentNode) { document.removeEventListener('keydown', keyHandler, true); return; }
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
            e.preventDefault();
            savePdfOptions(opts);
            close();
            onConfirm(opts);
        }
    };
    document.addEventListener('keydown', keyHandler, true);
    requestAnimationFrame(function () { overlay.classList.add('show'); });
}

function exportToPdf() {
    // Guard against double-trigger (rapid clicks, keyboard repeat)
    if (_isExporting) { showToast('PDF 생성 중입니다'); return; }

    if (typeof html2pdf === 'undefined') {
        var assets = window.__lazyAssets || {};
        if (!assets.html2pdf) { showToast('PDF 라이브러리 로드 실패'); return; }
        showToast('PDF 라이브러리 로딩 중...');
        lazyLoadScript('html2pdf', assets.html2pdf).then(function () { exportToPdf(); }).catch(function () { showToast('PDF 라이브러리 로드 실패'); });
        return;
    }
    // Show options dialog first; actual export proceeds in callback
    showPdfOptionsDialog(function (userOpts) { _runPdfExport(userOpts); });
}

function _runPdfExport(userOpts) {
    var previousMode = currentMode;
    if (currentMode !== 'preview') {
        setMode('preview');
    }
    // Force a fresh render BEFORE setting the export guard,
    // so html2canvas captures up-to-date content
    renderPreview();
    _isExporting = true;

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
        _isExporting = false;
        return;
    }

    // Resolve margin preset to mm tuple [top, left, bottom, right]
    var marginPresets = {
        narrow: [10, 10, 14, 10],
        normal: [18, 18, 22, 18],
        wide: [25, 25, 28, 25]
    };
    var marginMm = marginPresets[userOpts.margin] || marginPresets.normal;
    var paperFormat = userOpts.paperSize === 'letter' ? 'letter' : 'a4';
    var pageOrient = userOpts.orientation === 'landscape' ? 'landscape' : 'portrait';

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
            margin: marginMm,
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
                        '#preview h1 + *, #preview h2 + *, #preview h3 + *, #preview h4 + * { page-break-before:avoid !important; break-before:avoid !important; }',
                        // Code block wrap: hide header in PDF, keep code block together
                        '#preview .code-block-header { display:none !important; }',
                        '#preview .code-block-wrap { page-break-inside:avoid !important; break-inside:avoid !important; border-radius:4px !important; }',
                        // External link arrow — drop in print, URL is appended already
                        '#preview a[href^="http"]::after, #preview a[href^="//"]::after { content: none !important; }'
                    ].join('\n');
                    clonedDoc.head.appendChild(s);
                }
            },
            jsPDF: { unit: 'mm', format: paperFormat, orientation: pageOrient },
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
                if (userOpts.showHeader && docTitle && i > 1) {
                    pdf.setFontSize(9);
                    pdf.setTextColor(140, 140, 140);
                    pdf.text(docTitle, marginMm[1], 12, { align: 'left' });
                    // Header underline
                    pdf.setDrawColor(220, 220, 220);
                    pdf.setLineWidth(0.2);
                    pdf.line(marginMm[1], 14, pageWidth - marginMm[3], 14);
                }

                // Footer page number
                if (userOpts.showPageNumber) {
                    pdf.setFontSize(9);
                    pdf.setTextColor(140, 140, 140);
                    pdf.text(i + ' / ' + pageCount, pageWidth / 2, pageHeight - 10, { align: 'center' });
                }
            }

            pdf.save(fileName);
            restore();
            _isExporting = false;
            showToast('PDF 저장 완료');
            if (previousMode !== 'preview') {
                setMode(previousMode);
            }
        }).catch(function (err) {
            restore();
            _isExporting = false;
            // Restore mode even on failure so user isn't stuck in preview
            if (previousMode !== 'preview') setMode(previousMode);
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
    if (_isExporting) return;   // skip live edit re-renders mid-PDF capture
    if (_renderTimer) cancelAnimationFrame(_renderTimer);
    if (window._renderTimeoutId) clearTimeout(window._renderTimeoutId);
    // Debounce 120ms — feels responsive but avoids reflow on every keystroke
    window._renderTimeoutId = setTimeout(function () {
        if (_isExporting) return;
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
/* True top of `el` relative to `root` — sums offsetTop up the offsetParent
 * chain. Needed when intermediate wrappers (e.g. .md-block, position:relative)
 * reset the offsetParent so el.offsetTop alone isn't relative to previewEl. */
function topWithin(el, root) {
    var top = 0;
    var cur = el;
    while (cur && cur !== root) {
        top += cur.offsetTop || 0;
        cur = cur.offsetParent;
    }
    return top;
}

/*
 * Anchor-based scroll sync (v1.0.2)
 *
 * Build two parallel arrays of anchor points:
 *   - editor: { sourceLine, scrollTop }
 *   - preview: { heading, offsetTop }
 *
 * For each heading in the rendered preview, find its source line in the editor.
 * When user scrolls, find the two surrounding anchors and interpolate.
 * Falls back to % ratio if no headings or sparse anchors.
 */
var _scrollAnchors = null;
function buildScrollAnchors() {
    _scrollAnchors = null;
    if (!editorEl || !previewEl) return;
    var headingEls = previewEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
    if (!headingEls.length) return;
    var src = editorEl.value;
    var lines = src.split('\n');

    // Pre-scan source lines for headings (markdown `#`-style only; setext '====' rare)
    function stripMd(s) {
        // Strip common inline markdown to align with rendered .textContent
        return s
            .replace(/`([^`]+)`/g, '$1')                          // inline code
            .replace(/\*\*([^*]+)\*\*/g, '$1')                    // bold
            .replace(/__([^_]+)__/g, '$1')                        // bold alt
            .replace(/\*([^*]+)\*/g, '$1')                        // italic
            .replace(/_([^_]+)_/g, '$1')                          // italic alt
            .replace(/~~([^~]+)~~/g, '$1')                        // strike
            .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')              // link
            .replace(/\s+/g, ' ')                                  // collapse ws
            .trim();
    }
    var srcHeadings = [];
    var lineOffsets = [0]; // char offset of each line start
    for (var i = 0; i < lines.length; i++) {
        var ln = lines[i];
        var m = ln.match(/^(#{1,6})\s+(.+?)\s*$/);
        if (m) {
            srcHeadings.push({ line: i, level: m[1].length, text: stripMd(m[2]) });
        }
        lineOffsets.push(lineOffsets[lineOffsets.length - 1] + ln.length + 1);
    }
    if (!srcHeadings.length) return;

    // Match rendered headings to source headings in DOM order
    var anchors = [];
    var srcIdx = 0;
    headingEls.forEach(function (h) {
        var hText = stripMd(h.textContent);
        var hLevel = parseInt(h.tagName[1], 10);
        // Walk forward from srcIdx; pick first source heading with same level whose text matches loosely
        for (var i = srcIdx; i < srcHeadings.length; i++) {
            // Loose match: equal OR rendered starts with source OR source starts with rendered
            // (handles emoji decorations on either side, e.g. "🎉 Title" rendered vs "Title" source)
            if (srcHeadings[i].level === hLevel && (
                hText === srcHeadings[i].text ||
                hText.indexOf(srcHeadings[i].text) >= 0 ||
                srcHeadings[i].text.indexOf(hText) >= 0
            )) {
                anchors.push({
                    sourceLine: srcHeadings[i].line,
                    headingEl: h
                });
                srcIdx = i + 1;
                break;
            }
        }
    });
    if (anchors.length < 1) return;
    _scrollAnchors = { anchors: anchors, lineOffsets: lineOffsets, lineCount: lines.length };
}

function getCurrentEditorLine() {
    if (!editorEl || !_scrollAnchors) return 0;
    // Approximate line at editor scroll center using lineHeight
    var lh = parseFloat(getComputedStyle(editorEl).lineHeight) || 22;
    var centerY = editorEl.scrollTop + editorEl.clientHeight * 0.3;
    var line = Math.floor(centerY / lh);
    return Math.max(0, Math.min(_scrollAnchors.lineCount - 1, line));
}

function syncEditorToPreview() {
    if (!_scrollAnchors || !previewEl) return false;
    var container = previewEl.parentElement;
    if (!container) return false;
    var line = getCurrentEditorLine();
    var anchors = _scrollAnchors.anchors;
    // Find surrounding anchors
    var prev = null, next = null;
    for (var i = 0; i < anchors.length; i++) {
        if (anchors[i].sourceLine <= line) prev = anchors[i];
        else { next = anchors[i]; break; }
    }
    var lh = parseFloat(getComputedStyle(editorEl).lineHeight) || 22;
    var targetTop;
    if (prev && next) {
        var srcSpan = next.sourceLine - prev.sourceLine || 1;
        var ratio = (line - prev.sourceLine) / srcSpan;
        var prevTop = topWithin(prev.headingEl, previewEl);
        var nextTop = topWithin(next.headingEl, previewEl);
        targetTop = prevTop + (nextTop - prevTop) * ratio;
    } else if (prev) {
        // Past last heading — interpolate using remaining source lines vs preview height
        var remainSrc = Math.max(1, _scrollAnchors.lineCount - prev.sourceLine);
        var ratio2 = (line - prev.sourceLine) / remainSrc;
        var remainPv = previewEl.scrollHeight - topWithin(prev.headingEl, previewEl);
        targetTop = topWithin(prev.headingEl, previewEl) + remainPv * ratio2;
    } else if (next) {
        var ratio3 = line / Math.max(1, next.sourceLine);
        targetTop = topWithin(next.headingEl, previewEl) * ratio3;
    } else {
        return false;
    }
    // Apply with small offset so heading sits a bit below top edge
    container.scrollTop = Math.max(0, targetTop - container.clientHeight * 0.15);
    return true;
}

function syncPreviewToEditor() {
    if (!_scrollAnchors || !previewEl || !editorEl) return false;
    var container = previewEl.parentElement;
    if (!container) return false;
    var anchors = _scrollAnchors.anchors;
    // Find the heading anchor nearest to current scroll
    var scrollTop = container.scrollTop + container.clientHeight * 0.15;
    var prev = null, next = null;
    for (var i = 0; i < anchors.length; i++) {
        if (topWithin(anchors[i].headingEl, previewEl) <= scrollTop) prev = anchors[i];
        else { next = anchors[i]; break; }
    }
    var lh = parseFloat(getComputedStyle(editorEl).lineHeight) || 22;
    var targetLine;
    if (prev && next) {
        var pvSpan = topWithin(next.headingEl, previewEl) - topWithin(prev.headingEl, previewEl) || 1;
        var ratio = (scrollTop - topWithin(prev.headingEl, previewEl)) / pvSpan;
        targetLine = prev.sourceLine + (next.sourceLine - prev.sourceLine) * ratio;
    } else if (prev) {
        var remainPv = Math.max(1, previewEl.scrollHeight - topWithin(prev.headingEl, previewEl));
        var ratio2 = (scrollTop - topWithin(prev.headingEl, previewEl)) / remainPv;
        var remainSrc = _scrollAnchors.lineCount - prev.sourceLine;
        targetLine = prev.sourceLine + remainSrc * ratio2;
    } else if (next) {
        targetLine = next.sourceLine * (scrollTop / Math.max(1, topWithin(next.headingEl, previewEl)));
    } else {
        return false;
    }
    editorEl.scrollTop = Math.max(0, targetLine * lh - editorEl.clientHeight * 0.3);
    return true;
}

function setupScrollSync() {
    if (!editorEl || !previewEl) return;

    editorEl.addEventListener('scroll', function () {
        if (isSyncingScroll || currentMode !== 'split') return;
        isSyncingScroll = true;
        var ok = syncEditorToPreview();
        if (!ok) {
            // Fallback: percentage
            var pct = editorEl.scrollTop / (editorEl.scrollHeight - editorEl.clientHeight || 1);
            var c = previewEl.parentElement;
            c.scrollTop = pct * (c.scrollHeight - c.clientHeight);
        }
        requestAnimationFrame(function () { isSyncingScroll = false; });
    });

    var previewContainer = previewEl.parentElement;
    previewContainer.addEventListener('scroll', function () {
        if (isSyncingScroll || currentMode !== 'split') return;
        isSyncingScroll = true;
        var ok = syncPreviewToEditor();
        if (!ok) {
            var pct = previewContainer.scrollTop / (previewContainer.scrollHeight - previewContainer.clientHeight || 1);
            editorEl.scrollTop = pct * (editorEl.scrollHeight - editorEl.clientHeight);
        }
        requestAnimationFrame(function () { isSyncingScroll = false; });
    });
}

/* ───────────────────────────────────────────
   Keyboard shortcuts
   ─────────────────────────────────────────── */
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', function (e) {
        var mod = e.metaKey || e.ctrlKey;
        // ESC closes lightbox / preview search before anything else
        if (e.key === 'Escape') {
            if (_lightboxEl) { e.preventDefault(); closeLightbox(); return; }
            if (_previewSearchPanel && _previewSearchPanel.style.display !== 'none') {
                e.preventDefault(); closePreviewSearch(); return;
            }
        }
        // Cmd/Ctrl+F: preview-mode search; edit/split → existing Find&Replace
        if (mod && (e.key === 'f' || e.key === 'F')) {
            e.preventDefault();
            if (currentMode === 'preview') openPreviewSearch();
            else openFindReplace();
            return;
        }
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
    lsSet('md-viewer-theme', themeId);
    lsRemove('md-viewer-custom-color');

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
    lsSet('md-viewer-theme', 'custom');
    lsSet('md-viewer-custom-color', hex);

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
    hexInput.value = lsGet('md-viewer-custom-color') || '';

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

    var savedSize = lsGet('md-viewer-font-size');
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

    // Paste handler — image → base64 markdown; URL + selection → markdown link (v1.0.2)
    editorEl.addEventListener('paste', function (e) {
        if (!e.clipboardData || !e.clipboardData.items) return;
        // 1) Image paste
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

        // 2) Smart URL paste: text selected + clipboard is a URL → wrap as [text](url)
        var pasted = e.clipboardData.getData('text/plain');
        if (!pasted) return;
        pasted = pasted.trim();
        // Strict URL regex — must start with http(s)://, no whitespace
        var URL_RE = /^https?:\/\/[^\s]+$/i;
        if (!URL_RE.test(pasted)) return;
        var selStart = editorEl.selectionStart;
        var selEnd = editorEl.selectionEnd;
        var selected = editorEl.value.substring(selStart, selEnd);
        if (!selected) return; // no selection → let default paste happen (bare URL)
        // Skip if selection itself contains markdown link syntax or newlines
        if (/[\n\r]/.test(selected) || /\]\(/.test(selected)) return;
        e.preventDefault();
        var ins = '[' + selected + '](' + pasted + ')';
        editorEl.value = editorEl.value.substring(0, selStart) + ins + editorEl.value.substring(selEnd);
        // Place caret right after inserted link
        editorEl.selectionStart = editorEl.selectionEnd = selStart + ins.length;
        onEditorInput();
        updateLineNumbers();
        showToast('링크 변환됨 / Linked');
    });

    editorWrap.appendChild(lineNumbersEl);
    editorWrap.appendChild(editorEl);
    editorPane.appendChild(editorWrap);

    // Edit-mode double-click → Preview (symmetric counterpart to Preview→Edit)
    // Listen on textarea directly so it works regardless of where user clicks.
    editorEl.addEventListener('dblclick', function () {
        if (currentMode === 'edit') setMode('preview');
    });
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
    var savedFontSize = lsGet('md-viewer-font-size');
    var fontSize = savedFontSize || (settings.defaultFontSize ? settings.defaultFontSize + 'px' : null);
    if (fontSize) {
        document.documentElement.style.setProperty('--md-font-size', fontSize);
    }

    // Theme: saved > settings > default
    var savedTheme = lsGet('md-viewer-theme');
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
    var savedCustomColor = lsGet('md-viewer-custom-color');
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

/* Preview-mode search (v1.0.2) — highlights matches in rendered DOM */
var _previewSearchPanel = null;
var _previewMatches = [];
var _previewMatchIdx = -1;
var _previewSearchQuery = '';

function clearPreviewHighlights() {
    if (!previewEl) return;
    var marks = previewEl.querySelectorAll('mark.preview-search-hit, mark.preview-search-active');
    marks.forEach(function (m) {
        var parent = m.parentNode;
        if (!parent) return;
        while (m.firstChild) parent.insertBefore(m.firstChild, m);
        parent.removeChild(m);
        parent.normalize();
    });
    _previewMatches = [];
    _previewMatchIdx = -1;
}

function highlightPreviewMatches(query) {
    clearPreviewHighlights();
    if (!previewEl || !query) return;
    var q = query.toLowerCase();
    // Walk text nodes; skip script/style/already-marked content
    var walker = document.createTreeWalker(previewEl, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
            if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
            var p = n.parentNode;
            while (p && p !== previewEl) {
                var tag = (p.tagName || '').toLowerCase();
                if (tag === 'script' || tag === 'style' || tag === 'mark') return NodeFilter.FILTER_REJECT;
                p = p.parentNode;
            }
            return n.nodeValue.toLowerCase().indexOf(q) >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
    });
    var nodes = [];
    var n;
    while ((n = walker.nextNode())) nodes.push(n);

    nodes.forEach(function (node) {
        var text = node.nodeValue;
        var lower = text.toLowerCase();
        var idx = 0;
        var frag = document.createDocumentFragment();
        var hits = [];
        while (true) {
            var pos = lower.indexOf(q, idx);
            if (pos < 0) break;
            if (pos > idx) frag.appendChild(document.createTextNode(text.substring(idx, pos)));
            var mark = document.createElement('mark');
            mark.className = 'preview-search-hit';
            mark.textContent = text.substring(pos, pos + query.length);
            frag.appendChild(mark);
            hits.push(mark);
            idx = pos + query.length;
        }
        if (idx < text.length) frag.appendChild(document.createTextNode(text.substring(idx)));
        node.parentNode.replaceChild(frag, node);
        for (var i = 0; i < hits.length; i++) _previewMatches.push(hits[i]);
    });
}

function setActiveMatch(i) {
    if (!_previewMatches.length) return;
    if (_previewMatchIdx >= 0 && _previewMatches[_previewMatchIdx]) {
        _previewMatches[_previewMatchIdx].classList.remove('preview-search-active');
        _previewMatches[_previewMatchIdx].classList.add('preview-search-hit');
    }
    _previewMatchIdx = ((i % _previewMatches.length) + _previewMatches.length) % _previewMatches.length;
    var el = _previewMatches[_previewMatchIdx];
    el.classList.add('preview-search-active');
    el.classList.remove('preview-search-hit');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    updatePreviewSearchCount();
}

function updatePreviewSearchCount() {
    if (!_previewSearchPanel) return;
    var c = _previewSearchPanel.querySelector('.ps-count');
    if (!c) return;
    if (!_previewMatches.length) { c.textContent = _previewSearchQuery ? '0 / 0' : ''; return; }
    c.textContent = (_previewMatchIdx + 1) + ' / ' + _previewMatches.length;
}

function openPreviewSearch() {
    if (!previewEl) return;
    if (!_previewSearchPanel) {
        var p = document.createElement('div');
        p.className = 'preview-search-panel';
        p.innerHTML =
            '<input type="text" class="ps-input" placeholder="프리뷰에서 찾기 / Find in preview" aria-label="Search preview">' +
            '<span class="ps-count" aria-live="polite"></span>' +
            '<button class="ps-prev" title="이전 (Shift+Enter)" aria-label="Previous match">↑</button>' +
            '<button class="ps-next" title="다음 (Enter)" aria-label="Next match">↓</button>' +
            '<button class="ps-close" title="닫기 (ESC)" aria-label="Close">×</button>';
        document.body.appendChild(p);
        _previewSearchPanel = p;
        var input = p.querySelector('.ps-input');
        input.addEventListener('input', function () {
            _previewSearchQuery = input.value;
            highlightPreviewMatches(_previewSearchQuery);
            if (_previewMatches.length) setActiveMatch(0);
            else updatePreviewSearchCount();
        });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); setActiveMatch(_previewMatchIdx + (e.shiftKey ? -1 : 1)); }
            else if (e.key === 'Escape') { e.preventDefault(); closePreviewSearch(); }
        });
        p.querySelector('.ps-next').addEventListener('click', function () { setActiveMatch(_previewMatchIdx + 1); });
        p.querySelector('.ps-prev').addEventListener('click', function () { setActiveMatch(_previewMatchIdx - 1); });
        p.querySelector('.ps-close').addEventListener('click', closePreviewSearch);
    }
    _previewSearchPanel.style.display = 'flex';
    var input = _previewSearchPanel.querySelector('.ps-input');
    input.focus();
    input.select();
}
function closePreviewSearch() {
    if (_previewSearchPanel) _previewSearchPanel.style.display = 'none';
    clearPreviewHighlights();
    _previewSearchQuery = '';
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
