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
        a: true, abbr: true, blockquote: true, br: true, caption: true,
        code: true, col: true, colgroup: true, dd: true, del: true,
        details: true, div: true, dl: true, dt: true, em: true,
        figcaption: true, figure: true, h1: true, h2: true, h3: true,
        h4: true, h5: true, h6: true, hr: true, img: true, input: true,
        ins: true, kbd: true, li: true, mark: true, ol: true, p: true,
        pre: true, s: true, section: true, span: true, strong: true,
        sub: true, summary: true, sup: true, table: true, tbody: true,
        td: true, tfoot: true, th: true, thead: true, tr: true, ul: true
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

/* Net difference between opening and closing HTML tags in a chunk of raw
   text. Void / self-closing elements don't count. Used to detect tokens
   that live inside an unclosed HTML structure (e.g. markdown that appears
   inside <table><td>...</td></table>) — wrapping those with .md-block
   div's breaks the HTML structure. */
var _voidTags = /^(br|hr|img|input|meta|link|area|base|col|embed|source|track|wbr)$/i;
function htmlTagDelta(raw) {
    // Code content renders literally — fenced blocks and inline code spans
    // must not affect the tag balance. Strip them before counting.
    var s = String(raw || '')
        .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, '')
        .replace(/`[^`\n]*`/g, '');
    var opens = 0, closes = 0;
    var re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>/g;
    var m;
    while ((m = re.exec(s))) {
        if (m[4] === '/') continue;                 // self-closing
        if (_voidTags.test(m[2])) continue;         // void element
        var after = m[3].charAt(0);
        if (after === ':' || after === '@') continue; // <https://…> autolink / <a@b> email, not a tag
        if (m[1] === '/') closes++; else opens++;
    }
    return opens - closes;
}

/* Units group the raw token list into structural blocks:
     kind 'block'          — one ordinary token
     kind 'admonition'     — ":::type … :::" spanning one or more tokens,
                             rendered as a single admonition box
     kind 'html-container' — an html token that opens tags it doesn't close
                             (e.g. "<table><tr><td>") plus every following
                             token until the structure closes. Tokens inside
                             must never be individually wrapped with .md-block
                             — that would interleave block divs inside
                             <td>/<tr> and browsers would rewrite the DOM.
   Both the renderer and every structural operation (insert/move/delete/
   duplicate) work in unit space, so multi-token constructs move as one. */
function admonitionSpanAt(tokens, i) {
    var t = tokens[i];
    if (!t || !t.raw) return 0;
    if (t.type !== 'paragraph' && t.type !== 'text') return 0;
    if (!/^:::\w+/.test(t.raw)) return 0;
    // Closing ::: on a later line of this same token?
    var body = t.raw.replace(/^[^\n]*\n?/, '');
    if (/^:::[ \t]*$/m.test(body)) return 1;
    for (var j = i + 1; j < tokens.length; j++) {
        if (tokens[j].type === 'code') continue;   // fences may contain ::: lines
        if (/^:::[ \t]*$/m.test(tokens[j].raw || '')) return j - i + 1;
    }
    return 0;   // unclosed — not an admonition
}

/* YAML frontmatter at the very top of the document ("---\nkey: v\n---").
   marked lexes it as hr + setext-heading garbage — detect it on the raw
   source and return how many leading tokens it spans (0 if none/misaligned)
   so it can render as one metadata card while the raws stay pristine. */
var FRONTMATTER_RE = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/;
function frontmatterSpanAt(tokens) {
    if (!tokens.length) return 0;
    if (!/^---[ \t]*\n/.test(tokens[0].raw || '')) return 0;
    var joined = '';
    for (var i = 0; i < tokens.length; i++) {
        joined += tokens[i].raw || '';
        var m = joined.match(FRONTMATTER_RE);
        // Clean boundary: the joined raws are exactly the frontmatter
        // (tokens may absorb the trailing blank line — that's still ours).
        if (m && /^\n*$/.test(joined.slice(m[0].length))) return i + 1;
        if (joined.length > 4000) break;   // not frontmatter — stop scanning
    }
    return 0;
}
function renderFrontmatterCard(fmRaw) {
    var m = fmRaw.match(FRONTMATTER_RE);
    if (!m) return '';
    var esc = function (s) {
        return String(s).replace(/[<>&"]/g, function (c) {
            return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c];
        });
    };
    var rows = [];
    m[1].split('\n').forEach(function (line) {
        if (!line.trim()) return;
        var kv = line.match(/^([A-Za-z0-9_가-힣-]+)\s*:\s*(.*)$/);
        if (kv) {
            rows.push('<div class="md-fm-row"><span class="md-fm-key">' + esc(kv[1]) +
                '</span><span class="md-fm-val">' + esc(kv[2]) + '</span></div>');
        } else {
            rows.push('<div class="md-fm-row md-fm-plain">' + esc(line) + '</div>');
        }
    });
    return '<div class="md-frontmatter"><div class="md-fm-title">문서 정보</div>' + rows.join('') + '</div>';
}

function computeBlockUnits(tokens) {
    tokens = tokens || _currentTokens || [];
    var units = [];
    var htmlDepth = 0;
    var i = 0;
    var fmSpan = frontmatterSpanAt(tokens);
    if (fmSpan > 0) {
        units.push({ start: 0, span: fmSpan, kind: 'frontmatter' });
        i = fmSpan;
    }
    while (i < tokens.length) {
        if (htmlDepth > 0 && units.length) {
            var last = units[units.length - 1];
            last.span++;
            htmlDepth += tokenTagDelta(tokens[i]);
            if (htmlDepth < 0) htmlDepth = 0;
            i++;
            continue;
        }
        var admSpan = admonitionSpanAt(tokens, i);
        if (admSpan > 0) {
            for (var k = i; k < i + admSpan; k++) htmlDepth += tokenTagDelta(tokens[k]);
            if (htmlDepth < 0) htmlDepth = 0;
            units.push({ start: i, span: admSpan, kind: 'admonition' });
            i += admSpan;
            continue;
        }
        var d = tokenTagDelta(tokens[i]);
        units.push({ start: i, span: 1, kind: d > 0 ? 'html-container' : 'block' });
        htmlDepth += d;
        if (htmlDepth < 0) htmlDepth = 0;
        i++;
    }
    return units;
}

/* Fenced code tokens never open/close real HTML structure. */
function tokenTagDelta(t) {
    if (!t || t.type === 'code') return 0;
    return htmlTagDelta(t.raw || '');
}

function unitIndexOf(units, tokenIdx) {
    for (var i = 0; i < units.length; i++) {
        if (tokenIdx >= units[i].start && tokenIdx < units[i].start + units[i].span) return i;
    }
    return -1;
}

function joinTokenRaws(tokens, start, span) {
    var out = '';
    for (var i = start; i < start + span && i < tokens.length; i++) out += tokens[i].raw || '';
    return out;
}

/* marked's lexer swallows some constructs without emitting a token —
   reference-link definitions ("[id]: url") register into tokens.links and
   simply vanish from the token list. Since every commit rebuilds the file
   by joining token raws, that text would be silently DELETED. Walk the
   source alongside the token raws and re-insert any skipped segment as an
   inert space token so join(raws) === source always holds. */
function lexPreservingSource(text) {
    // marked normalizes \r\n → \n before tokenizing; align with that so
    // raw offsets match (a pre-existing property: edits save LF).
    var src = String(text).replace(/\r\n|\r/g, '\n');
    var tokens = marked.lexer(src);
    var out = [];
    var pos = 0;
    for (var i = 0; i < tokens.length; i++) {
        var raw = tokens[i].raw || '';
        var at = raw ? src.indexOf(raw, pos) : pos;
        if (at < 0) return tokens;   // unexpected mismatch — don't guess
        if (at > pos) out.push({ type: 'space', raw: src.slice(pos, at) });
        out.push(tokens[i]);
        pos = at + raw.length;
    }
    if (pos < src.length) out.push({ type: 'space', raw: src.slice(pos) });
    return out;
}

function renderMarkdown(text) {
    var tokens = lexPreservingSource(text);
    _currentTokens = tokens;
    var fns = collectFootnotes(tokens);
    var tocHtml = null;
    function getTocHtml() {
        if (tocHtml === null) tocHtml = buildTocHtml(tokens);
        return tocHtml;
    }
    // Editable blocks that can be individually wrapped.
    var EDITABLE_TYPES = {
        heading: 1, paragraph: 1, blockquote: 1, list: 1, code: 1, hr: 1, table: 1, html: 1
    };
    var parts = [];
    var units = computeBlockUnits(tokens);
    units.forEach(function (u) {
        var token = tokens[u.start];

        if (u.kind === 'admonition') {
            // Rendered from the pristine raws each time — the token raws
            // (and therefore the saved source) keep the ::: syntax.
            var groupRaw = joinTokenRaws(tokens, u.start, u.span);
            var groupHtml;
            try { groupHtml = marked.parser(marked.lexer(admonitionToHtml(groupRaw))); }
            catch (_) { groupHtml = ''; }
            groupHtml = renderFootnoteRefs(groupHtml, fns);
            parts.push('<div class="md-block" data-block-idx="' + u.start +
                '" data-block-span="' + u.span + '">' + groupHtml + '</div>');
            return;
        }

        if (u.kind === 'frontmatter') {
            parts.push('<div class="md-block" data-block-idx="' + u.start +
                '" data-block-span="' + u.span + '">' +
                renderFrontmatterCard(joinTokenRaws(tokens, u.start, u.span)) + '</div>');
            return;
        }

        if (u.kind === 'html-container') {
            for (var k = u.start; k < u.start + u.span; k++) {
                try { parts.push(marked.parser([tokens[k]])); } catch (_) {}
            }
            return;
        }

        var blockHtml;
        try { blockHtml = marked.parser([token]); }
        catch (_) { blockHtml = ''; }

        if (fns && fns.defTokens[u.start] != null) {
            // A token made entirely of "[^id]: …" definitions renders as the
            // footnote list (first such token) or disappears — its raw keeps
            // the definition syntax for the saved source.
            blockHtml = fns.defTokens[u.start] ? renderFootnoteSection(fns) : '';
        } else if (token.type !== 'code') {
            blockHtml = renderFootnoteRefs(blockHtml, fns);
            if (/\[\[(TOC|목차)\]\]/i.test(blockHtml)) {
                // A headingless doc renders an empty (but .md-toc-classed)
                // shell — never '' — so the block stays visible/attributable
                // and WYSIWYG falls back to the raw editor instead of
                // committing '' over the [[TOC]] marker.
                var tocOut = getTocHtml() ||
                    '<div class="md-toc md-toc-empty"><div class="md-toc-title">목차 / Table of Contents</div></div>';
                if (token.type === 'paragraph' && /^\[\[(TOC|목차)\]\]$/i.test((token.raw || '').trim())) {
                    blockHtml = tocOut;   // standalone marker → replace whole <p>
                } else {
                    blockHtml = replaceInRenderedText(blockHtml, function (text) {
                        return text.replace(/\[\[(TOC|목차)\]\]/gi, tocOut);
                    });
                }
            }
        }

        if (EDITABLE_TYPES[token.type]) {
            parts.push('<div class="md-block" data-block-idx="' + u.start + '">' + blockHtml + '</div>');
        } else {
            parts.push(blockHtml);
        }
    });
    // Referenced footnotes whose definitions never formed a standalone token
    // still need a list to link to.
    if (fns && fns.order.length && !fns.hasSection) parts.push(renderFootnoteSection(fns));
    return sanitizeHtml(parts.join(''));
}

var _bigDocNoticeShown = false;
function highlightCodeBlocks(container) {
    // Very large documents: syntax highlighting is the single most
    // expensive render step and re-runs on every commit — skip it past
    // 800KB so editing stays responsive (code still renders, unstyled).
    var skipHighlight = currentContent.length > 800 * 1024;
    if (skipHighlight && !_bigDocNoticeShown) {
        _bigDocNoticeShown = true;
        showToast('대용량 문서 — 코드 하이라이트를 생략해 속도를 유지합니다');
    }
    if (typeof hljs !== 'undefined' && !skipHighlight) {
        container.querySelectorAll('pre code').forEach(function (block) {
            hljs.highlightElement(block);
        });
    }
    enhanceCodeBlocks(container);
}

/* Image lightbox (v1.0.2) — click to enlarge, ESC/click to close, wheel to
   zoom, drag to pan. Since v1.0.36 the zoom/pan engine is shared: it takes any
   content element (an <img> for images, a cloned <svg> for Mermaid diagrams)
   so complex diagrams get the same zoom & pan. */
var _lightboxEl = null;
var _lightboxCleanup = null;  // tear down window listeners when closing

/* Core zoom/pan overlay. `contentEl` is the zoomable node (img or svg). */
function openZoomView(contentEl, caption, ariaLabel) {
    closeLightbox();
    var overlay = document.createElement('div');
    overlay.className = 'image-lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', ariaLabel || caption || 'Preview');

    var cap = document.createElement('div');
    cap.className = 'lightbox-caption';
    cap.textContent = caption || '';
    if (!caption) cap.style.display = 'none';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'lightbox-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';

    var hint = document.createElement('div');
    hint.className = 'lightbox-hint';
    hint.textContent = 'ESC 또는 바깥 클릭으로 닫기 · 휠로 확대/축소 · 드래그로 이동 · 더블클릭 리셋';

    overlay.appendChild(contentEl);
    overlay.appendChild(cap);
    overlay.appendChild(closeBtn);
    overlay.appendChild(hint);
    document.body.appendChild(overlay);
    _lightboxEl = overlay;

    var scale = 1, tx = 0, ty = 0;
    var isDragging = false, dragStartX = 0, dragStartY = 0, dragOriginX = 0, dragOriginY = 0;
    function apply() {
        contentEl.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
        contentEl.style.cursor = scale > 1 ? 'grab' : 'zoom-out';
    }
    function zoomAt(clientX, clientY, factor) {
        var r = contentEl.getBoundingClientRect();
        var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        var ns = Math.min(12, Math.max(0.4, scale * factor));
        var k = ns / scale;
        // keep the point under the cursor stationary while zooming
        tx = (clientX - cx) - (clientX - cx - tx) * k;
        ty = (clientY - cy) - (clientY - cy - ty) * k;
        scale = ns;
        apply();
    }
    function onWheel(e) {
        e.preventDefault();
        zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }
    function onMouseDown(e) {
        isDragging = true;                       // pan at any zoom level
        dragStartX = e.clientX; dragStartY = e.clientY;
        dragOriginX = tx; dragOriginY = ty;
        contentEl.style.cursor = 'grabbing';
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
        apply();
    }
    function onDblClick(e) {
        e.stopPropagation();
        if (scale > 1) { scale = 1; tx = 0; ty = 0; apply(); }
        else zoomAt(e.clientX, e.clientY, 2.5);
    }
    function onClickOverlay(e) {
        if (e.target === overlay || e.target === closeBtn) closeLightbox();
    }

    overlay.addEventListener('wheel', onWheel, { passive: false });
    contentEl.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    contentEl.addEventListener('dblclick', onDblClick);
    overlay.addEventListener('click', onClickOverlay);

    _lightboxCleanup = function () {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
    };
    apply();
    requestAnimationFrame(function () { overlay.classList.add('show'); });
}

function openLightbox(src, alt) {
    var img = document.createElement('img');
    img.src = src;
    img.alt = alt || '';
    img.draggable = false;
    openZoomView(img, alt || '', alt || 'Image preview');
}

/* Open a Mermaid diagram's SVG in the zoom/pan overlay. Clones the SVG so the
   in-document one is untouched, and lets it grow (drop fixed width/height) so
   zooming stays crisp (it's vector, not a raster). */
function openMermaidZoom(svg) {
    if (!svg) return;
    padMermaidSvg(svg);                 // ensure the source is padded before cloning
    var clone = svg.cloneNode(true);
    clone.removeAttribute('width');
    clone.removeAttribute('height');
    clone.style.width = 'auto';
    clone.style.height = 'auto';
    clone.style.maxWidth = '90vw';      // beat Mermaid's inline max-width so it fills the overlay
    clone.style.maxHeight = '84vh';
    clone.style.overflow = 'visible';
    clone.classList.add('lightbox-svg');
    openZoomView(clone, '', 'Diagram preview');
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
    bindBlockDnD();
    container.querySelectorAll('.md-block').forEach(function (blockEl) {
        try {
        if (blockEl.dataset.editBound === '1') return;
        blockEl.dataset.editBound = '1';

        var blockIdx = parseInt(blockEl.dataset.blockIdx, 10);
        var token = _currentTokens && _currentTokens[blockIdx];
        var isTable = !!(token && (token.type === 'table' ||
            (token.type === 'html' && blockEl.querySelector('table'))));

        // Every block gets the left-gutter handles: ＋ (insert below),
        // ⠿ (menu / drag to reorder) and — for non-table blocks — the
        // ✎ block editor. Keeping the pencil in the gutter means no
        // floating chrome ever covers the block's own content. Tables
        // skip ✎ (they edit per-cell) but keep move/delete.
        addBlockHandles(blockEl, blockIdx,
            isTable ? null : function () { openBlockEditor(blockEl); });

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
        } catch (err) {
            // One malformed block must not kill editing for the whole doc.
            console.warn('MD Pretty Viewer: block bind failed', err);
        }
    });
}

/* ───────────────────────────────────────────
   Block structure editing (v1.0.26)
   ＋ insert · ⠿ drag/menu · WYSIWYG slash
   ─────────────────────────────────────────── */

// Block templates shared by the ＋ insert menu and the WYSIWYG slash menu.
var INSERT_BLOCKS = [
    { key: 'text',   label: '텍스트',       icon: '¶',  raw: '내용' },
    { key: 'h1',     label: '제목 1',       icon: 'H1', raw: '# 제목' },
    { key: 'h2',     label: '제목 2',       icon: 'H2', raw: '## 제목' },
    { key: 'h3',     label: '제목 3',       icon: 'H3', raw: '### 제목' },
    { key: 'bullet', label: '리스트',       icon: '•',  raw: '- 항목' },
    { key: 'number', label: '번호 리스트',  icon: '1.', raw: '1. 항목' },
    { key: 'check',  label: '체크박스',     icon: '☑',  raw: '- [ ] 할 일' },
    { key: 'quote',  label: '인용',         icon: '❝',  raw: '> 인용문' },
    { key: 'code',   label: '코드 블록',    icon: '{}', raw: '```\ncode\n```' },
    { key: 'table',  label: '표',           icon: '▦',  raw: '| 제목 | 제목 |\n| --- | --- |\n| 내용 | 내용 |' },
    { key: 'image',  label: '이미지',       icon: '🖼', raw: '![설명](https://)' },
    { key: 'link',   label: '링크',         icon: '🔗', raw: '[링크 제목](https://)' },
    { key: 'hr',     label: '구분선',       icon: '—',  raw: '---' }
];

/* Rebuild currentContent from a mutated raw-array, push undo history,
   persist, and re-render. All structural operations funnel through here. */
function applyRawsUpdate(raws) {
    var kept = [];
    raws.forEach(function (r) {
        if (r == null) return;
        // A whitespace-only separator right after a raw we normalized to
        // end in \n\n is redundant — dropping it stops blank lines from
        // accumulating on every structural operation. (ASCII whitespace
        // only: U+00A0 spacer paragraphs are content.)
        if (/^[ \t\r\n]+$/.test(r) && kept.length && /\n\n$/.test(kept[kept.length - 1])) return;
        kept.push(r);
    });
    // Leading blank lines at file start carry no meaning in markdown but
    // accumulate when the first block is moved away — trim them. Same for
    // extra trailing newlines a moved/deleted block leaves at EOF.
    var updated = kept.join('').replace(/^\n+/, '').replace(/\n+$/, '\n');
    if (updated === '\n') updated = '';
    if (updated === currentContent) { renderPreview(); return; }
    pushEditHistory(currentContent);
    currentContent = updated;
    if (editorEl) editorEl.value = updated;
    saveToDocument(updated);
    updateStats();
    renderPreview();
}

function currentRaws() {
    return (_currentTokens || []).map(function (t) { return t.raw || ''; });
}
function ensureBlockSep(s) {
    return String(s == null ? '' : s).replace(/\n*$/, '') + '\n\n';
}

/* Per-unit raw strings for the current token list. Structural operations
   mutate this array (units move as one) and hand it to applyRawsUpdate. */
function unitRawsOf(units, raws) {
    return units.map(function (u) {
        return raws.slice(u.start, u.start + u.span).join('');
    });
}
/* ASCII whitespace only — a paragraph made of U+00A0 spacer lines is real
   content, not a separator, and must never be skipped or dropped. */
function isBlankUnitRaw(r) { return /^[ \t\r\n]*$/.test(r || ''); }

/* Structural ops capture their blockIdx when the handles are bound, but
   committing a still-open editor re-lexes the document and can shift every
   index — acting on the bound index then corrupts the wrong block. Commit
   first, then re-locate the same block in the fresh token list. Returns -1
   when it can no longer be found (caller must abort). */
function resolveIdxAfterCommit(blockIdx) {
    if (!_currentTokens || !_currentTokens[blockIdx]) return -1;
    if (!_activeBlockEdit) return blockIdx;
    var editIdx = _activeBlockEdit.blockIdx;
    var targetRaw = _currentTokens[blockIdx].raw || '';
    var oldLen = _currentTokens.length;
    closeBlockEditor(true);
    var toks = _currentTokens || [];
    if (blockIdx === editIdx) {
        // The edited block keeps its starting index (earlier tokens are untouched)
        return toks[blockIdx] ? blockIdx : -1;
    }
    if (blockIdx < editIdx && toks[blockIdx] && (toks[blockIdx].raw || '') === targetRaw) {
        return blockIdx;
    }
    // Tokens after the edited block shift uniformly by the commit's token
    // delta — anchor the search there so duplicate-raw documents resolve
    // to the RIGHT copy, not merely the nearest one.
    var expected = blockIdx > editIdx ? blockIdx + (toks.length - oldLen) : blockIdx;
    var best = -1, bestDist = Infinity;
    for (var i = 0; i < toks.length; i++) {
        if ((toks[i].raw || '') === targetRaw) {
            var d = Math.abs(i - expected);
            if (d < bestDist) { best = i; bestDist = d; }
        }
    }
    return best;
}

function addBlockHandles(blockEl, blockIdx, onEdit) {
    if (!blockEl || blockEl.querySelector(':scope > .md-block-handles')) return;
    var wrap = document.createElement('div');
    wrap.className = 'md-block-handles';
    wrap.dataset.mdChrome = '1';
    wrap.contentEditable = 'false';

    var addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'md-handle-add';
    addBtn.setAttribute('aria-label', '아래에 블록 추가');
    addBtn.textContent = '＋';
    addBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    addBtn.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        openBlockPopup('insert', blockIdx, addBtn);
    });

    var dragBtn = document.createElement('button');
    dragBtn.type = 'button';
    dragBtn.className = 'md-handle-drag';
    dragBtn.setAttribute('aria-label', '블록 메뉴 · 드래그로 이동');
    dragBtn.textContent = '⠿';
    dragBtn.draggable = true;
    dragBtn.addEventListener('mousedown', function () {
        // While another editor is open, this mousedown blurs it → commit →
        // re-render detaches this very button, so its click never fires and
        // the first ⠿ press appears dead. Queue the menu to reopen on the
        // block's FRESH button after the commit settles.
        if (!_activeBlockEdit) return;
        var targetRaw = _currentTokens && _currentTokens[blockIdx] ? (_currentTokens[blockIdx].raw || '') : null;
        var gen = _externalGen;
        setTimeout(function () {
            if (gen !== _externalGen || _activeBlockEdit || targetRaw == null || !_currentTokens) return;
            var best = -1, bestDist = Infinity;
            for (var i = 0; i < _currentTokens.length; i++) {
                if ((_currentTokens[i].raw || '') === targetRaw) {
                    var d = Math.abs(i - blockIdx);
                    if (d < bestDist) { best = i; bestDist = d; }
                }
            }
            if (best < 0) return;
            var nb = previewEl && previewEl.querySelector('.md-block[data-block-idx="' + best + '"] .md-handle-drag');
            if (nb) openBlockPopup('menu', best, nb);
        }, 60);
    });
    dragBtn.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        openBlockPopup('menu', blockIdx, dragBtn);
    });
    dragBtn.addEventListener('dragstart', function (e) { onBlockDragStart(e, blockEl, blockIdx); });
    dragBtn.addEventListener('dragend', onBlockDragEnd);

    wrap.appendChild(addBtn);
    wrap.appendChild(dragBtn);

    if (onEdit) {
        var editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'md-handle-edit';
        editBtn.setAttribute('aria-label', '블록 편집');
        editBtn.textContent = '✎';
        editBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
        editBtn.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            onEdit();
        });
        wrap.appendChild(editBtn);
    }

    blockEl.appendChild(wrap);
}

/* Singleton popup used for both the insert menu (＋) and the block menu (⠿). */
var _blockPopupEl = null;
function closeBlockPopup() {
    if (_blockPopupEl && _blockPopupEl.parentNode) _blockPopupEl.parentNode.removeChild(_blockPopupEl);
    _blockPopupEl = null;
    document.removeEventListener('mousedown', _blockPopupOutside, true);
    document.removeEventListener('keydown', _blockPopupKeys, true);
    window.removeEventListener('scroll', _blockPopupDismiss, true);
    window.removeEventListener('resize', _blockPopupDismiss);
}
function _blockPopupOutside(e) {
    if (_blockPopupEl && !_blockPopupEl.contains(e.target)) closeBlockPopup();
}
/* position:fixed popups drift off their anchor when the pane scrolls or the
   window resizes — close instead of floating detached. */
function _blockPopupDismiss() {
    closeBlockPopup();
}
function _blockPopupKeys(e) {
    if (!_blockPopupEl) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        var items = _blockPopupEl.querySelectorAll('.md-popup-item');
        if (!items.length) return;
        var idx = -1;
        items.forEach(function (it, i) { if (it.classList.contains('active')) idx = i; });
        if (idx >= 0) items[idx].classList.remove('active');
        idx = idx < 0 ? (e.key === 'ArrowDown' ? 0 : items.length - 1)
                      : (idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[idx].classList.add('active');
        items[idx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
        var active = _blockPopupEl.querySelector('.md-popup-item.active');
        if (active) {
            e.preventDefault();
            e.stopPropagation();
            active.click();
        }
    }
}
function openBlockPopup(kind, blockIdx, anchorEl) {
    closeBlockPopup();
    var p = document.createElement('div');
    p.className = 'md-block-popup';
    p.dataset.mdChrome = '1';
    p.setAttribute('role', 'menu');

    function addItem(label, icon, danger, onPick) {
        var el = document.createElement('button');
        el.type = 'button';
        el.className = 'md-popup-item' + (danger ? ' md-popup-danger' : '');
        el.setAttribute('role', 'menuitem');
        if (icon) {
            var ic = document.createElement('span');
            ic.className = 'md-popup-icon';
            ic.textContent = icon;
            el.appendChild(ic);
        }
        el.appendChild(document.createTextNode(label));
        el.addEventListener('mousedown', function (e) { e.preventDefault(); });
        el.addEventListener('click', function () {
            closeBlockPopup();
            onPick();
        });
        p.appendChild(el);
    }

    if (kind === 'insert') {
        INSERT_BLOCKS.forEach(function (item) {
            addItem(item.label, item.icon, false, function () { insertBlockAfter(blockIdx, item.raw); });
        });
    } else {
        addItem('↑ 위로 이동',   null, false, function () { moveBlockStep(blockIdx, -1); });
        addItem('↓ 아래로 이동', null, false, function () { moveBlockStep(blockIdx, +1); });
        addItem('⧉ 복제',        null, false, function () { duplicateBlock(blockIdx); });
        addItem('🗑 삭제',        null, true,  function () { deleteBlock(blockIdx); });
    }

    document.body.appendChild(p);
    _blockPopupEl = p;
    // Position next to the anchor button, clamped to the viewport
    var r = anchorEl.getBoundingClientRect();
    var pr = p.getBoundingClientRect();
    var x = Math.max(8, Math.min(window.innerWidth - pr.width - 8, r.left));
    var y = r.bottom + 4;
    if (y + pr.height > window.innerHeight - 8) y = r.top - pr.height - 4;
    p.style.left = Math.round(x) + 'px';
    p.style.top = Math.round(y) + 'px';
    setTimeout(function () {
        document.addEventListener('mousedown', _blockPopupOutside, true);
        document.addEventListener('keydown', _blockPopupKeys, true);
        window.addEventListener('scroll', _blockPopupDismiss, true);
        window.addEventListener('resize', _blockPopupDismiss);
    }, 0);
}

function insertBlockAfter(blockIdx, rawTemplate) {
    if (blockIdx === -1) {
        // Empty-document bootstrap (＋ placeholder) — nothing to resolve.
        if (_activeBlockEdit) closeBlockEditor(true);
        applyRawsUpdate([ensureBlockSep(rawTemplate)]);
    } else {
        blockIdx = resolveIdxAfterCommit(blockIdx);
        if (blockIdx < 0) { showToast('문서가 바뀌어 블록을 찾지 못했습니다'); return; }
        var units = computeBlockUnits(_currentTokens);
        var ui = unitIndexOf(units, blockIdx);
        if (ui < 0) return;
        var uraws = unitRawsOf(units, currentRaws());
        uraws[ui] = ensureBlockSep(uraws[ui]);
        uraws.splice(ui + 1, 0, ensureBlockSep(rawTemplate));
        applyRawsUpdate(uraws);
    }
    // Open the editor on the freshly inserted block so the user can type
    // immediately. Match on the trimmed raw — marked keeps trailing blank
    // lines in separate space tokens, so an exact-raw match never fires.
    var want = String(rawTemplate).replace(/\n+$/, '');
    var gen = _externalGen;
    setTimeout(function () {
        if (gen !== _externalGen) return;   // document replaced externally
        if (!_currentTokens) return;
        for (var i = Math.max(0, blockIdx); i < _currentTokens.length; i++) {
            if ((_currentTokens[i].raw || '').replace(/\n+$/, '') !== want) continue;
            var t = _currentTokens[i];
            if (t.type === 'table' || t.type === 'code' || t.type === 'hr') return;
            var nb = previewEl && previewEl.querySelector('.md-block[data-block-idx="' + i + '"]');
            if (nb) openBlockEditor(nb);
            return;
        }
    }, 40);
}

function moveBlockStep(blockIdx, dir) {
    blockIdx = resolveIdxAfterCommit(blockIdx);
    if (blockIdx < 0) { showToast('문서가 바뀌어 블록을 찾지 못했습니다'); return; }
    var units = computeBlockUnits(_currentTokens);
    var ui = unitIndexOf(units, blockIdx);
    if (ui < 0) return;
    var uraws = unitRawsOf(units, currentRaws());
    var uj = ui + dir;
    while (uj >= 0 && uj < uraws.length && isBlankUnitRaw(uraws[uj])) uj += dir;
    if (uj < 0 || uj >= uraws.length) {
        showToast(dir < 0 ? '맨 위 블록입니다' : '맨 아래 블록입니다');
        return;
    }
    var a = ensureBlockSep(uraws[ui]);
    uraws[ui] = ensureBlockSep(uraws[uj]);
    uraws[uj] = a;
    // The block above the swapped pair may end without a blank line (marked
    // lets headings/fences interrupt a paragraph) — keep it separated from
    // whatever now sits below it, or the two would re-lex as one paragraph.
    var first = Math.min(ui, uj);
    if (first > 0 && !/\n\n$/.test(uraws[first - 1])) {
        uraws[first - 1] = ensureBlockSep(uraws[first - 1]);
    }
    applyRawsUpdate(uraws);
}

function duplicateBlock(blockIdx) {
    blockIdx = resolveIdxAfterCommit(blockIdx);
    if (blockIdx < 0) { showToast('문서가 바뀌어 블록을 찾지 못했습니다'); return; }
    var units = computeBlockUnits(_currentTokens);
    var ui = unitIndexOf(units, blockIdx);
    if (ui < 0) return;
    var uraws = unitRawsOf(units, currentRaws());
    var norm = ensureBlockSep(uraws[ui]);
    uraws[ui] = norm;
    uraws.splice(ui + 1, 0, norm);
    applyRawsUpdate(uraws);
    showToast('블록 복제됨');
}

function deleteBlock(blockIdx) {
    blockIdx = resolveIdxAfterCommit(blockIdx);
    if (blockIdx < 0) { showToast('문서가 바뀌어 블록을 찾지 못했습니다'); return; }
    var units = computeBlockUnits(_currentTokens);
    var ui = unitIndexOf(units, blockIdx);
    if (ui < 0) return;
    var uraws = unitRawsOf(units, currentRaws());
    uraws.splice(ui, 1);
    // Newly-adjacent neighbors must stay separated — deleting a heading
    // that interrupted a paragraph would otherwise fuse the paragraphs
    // above and below it into one.
    if (ui > 0 && ui < uraws.length && !/\n\n$/.test(uraws[ui - 1])) {
        uraws[ui - 1] = ensureBlockSep(uraws[ui - 1]);
    }
    applyRawsUpdate(uraws);
    showToast('블록 삭제됨 · Cmd/Ctrl+Z로 복구');
}

/* ── Drag & drop reorder ── */
var _dragState = null;
var _dropIndicatorEl = null;

function onBlockDragStart(e, blockEl, blockIdx) {
    closeBlockPopup();
    if (_activeBlockEdit) {
        // Committing here would re-render and detach the drag source —
        // Chromium then cancels the drag without ever firing dragend,
        // leaking _dragState with a stale index. Finish the edit and abort
        // this gesture; the next drag starts from a fresh DOM. (If the
        // slash menu is open, closeBlockEditor discards the "/cmd" text.)
        closeBlockEditor(true);
        e.preventDefault();
        return;
    }
    _dragState = { srcIdx: blockIdx };
    try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(blockIdx));
        e.dataTransfer.setDragImage(blockEl, 24, 16);
    } catch (_) {}
    blockEl.classList.add('md-block-dragging');
}
function onBlockDragEnd() {
    document.querySelectorAll('.md-block-dragging').forEach(function (el) {
        el.classList.remove('md-block-dragging');
    });
    hideDropIndicator();
    _dragState = null;
}
function showDropIndicator(blockEl, before) {
    if (!_dropIndicatorEl) {
        _dropIndicatorEl = document.createElement('div');
        _dropIndicatorEl.className = 'md-drop-indicator';
        _dropIndicatorEl.dataset.mdChrome = '1';
        document.body.appendChild(_dropIndicatorEl);
    }
    var r = blockEl.getBoundingClientRect();
    _dropIndicatorEl.style.left = r.left + 'px';
    _dropIndicatorEl.style.width = r.width + 'px';
    _dropIndicatorEl.style.top = (before ? r.top - 2 : r.bottom) + 'px';
    _dropIndicatorEl.style.display = 'block';
}
function hideDropIndicator() {
    if (_dropIndicatorEl) _dropIndicatorEl.style.display = 'none';
}

function bindBlockDnD() {
    if (!previewEl || previewEl.dataset.dndBound === '1') return;
    previewEl.dataset.dndBound = '1';
    previewEl.addEventListener('dragover', function (e) {
        if (!_dragState) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        // Auto-scroll while dragging near the pane's top/bottom edge so
        // long documents can be reordered without dropping midway.
        var scroller = previewEl.closest('.preview-pane') || previewEl.parentElement;
        if (scroller) {
            if (e.clientY < 70) scroller.scrollTop -= 14;
            else if (e.clientY > window.innerHeight - 70) scroller.scrollTop += 14;
        }
        var target = e.target && e.target.closest ? e.target.closest('.md-block') : null;
        if (!target) { hideDropIndicator(); return; }
        var rect = target.getBoundingClientRect();
        showDropIndicator(target, (e.clientY - rect.top) < rect.height / 2);
    });
    previewEl.addEventListener('drop', function (e) {
        if (!_dragState) return;
        e.preventDefault();
        var src = _dragState.srcIdx;
        hideDropIndicator();
        var target = e.target && e.target.closest ? e.target.closest('.md-block') : null;
        _dragState = null;
        if (!target) return;
        var rect = target.getBoundingClientRect();
        var before = (e.clientY - rect.top) < rect.height / 2;
        var tgt = parseInt(target.dataset.blockIdx, 10);
        performBlockMove(src, tgt, before);
    });
}

function performBlockMove(srcIdx, tgtIdx, before) {
    if (isNaN(srcIdx) || isNaN(tgtIdx) || srcIdx === tgtIdx) return;
    var units = computeBlockUnits(_currentTokens);
    var us = unitIndexOf(units, srcIdx);
    var ut = unitIndexOf(units, tgtIdx);
    if (us < 0 || ut < 0 || us === ut) return;
    var uraws = unitRawsOf(units, currentRaws());
    var moved = ensureBlockSep(uraws.splice(us, 1)[0]);
    // Keep the vacated spot's new neighbors separated (see deleteBlock).
    if (us > 0 && us < uraws.length && !/\n\n$/.test(uraws[us - 1])) {
        uraws[us - 1] = ensureBlockSep(uraws[us - 1]);
    }
    var insertAt = ut;
    if (us < ut) insertAt--;
    if (!before) insertAt++;
    insertAt = Math.max(0, Math.min(uraws.length, insertAt));
    if (insertAt > 0 && uraws[insertAt - 1] != null && !/\n\n$/.test(uraws[insertAt - 1])) {
        uraws[insertAt - 1] = ensureBlockSep(uraws[insertAt - 1]);
    }
    uraws.splice(insertAt, 0, moved);
    applyRawsUpdate(uraws);
    showToast('블록 이동됨');
}

/* Close every piece of floating chrome that anchors to block indexes —
   called at the top of renderPreview so nothing survives a re-render
   (external updates included) with a stale index. */
function resetBlockChrome() {
    closeBlockPopup();
    closeWysiwygSlash();
    closeLinkPopover();
    hideDropIndicator();
    _dragState = null;
}

/* Empty document (or every block deleted): the ＋/⠿ handles live on blocks,
   so there'd be no way to start writing from the preview. Render a visible
   "add a block" affordance instead. */
function renderEmptyPlaceholder() {
    if (!previewEl) return;
    if (previewEl.querySelector('.md-block')) return;
    if (currentContent.trim() !== '') return;   // content exists but isn't block-wrapped — don't cover it
    var wrap = document.createElement('div');
    wrap.className = 'md-empty-doc';
    wrap.dataset.mdChrome = '1';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'md-empty-add';
    btn.textContent = '＋ 블록 추가';
    btn.setAttribute('aria-label', '블록 추가');
    btn.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        openBlockPopup('insert', -1, btn);
    });
    var hint = document.createElement('div');
    hint.className = 'md-empty-hint';
    hint.textContent = '빈 문서입니다 — 블록을 추가해 시작하세요';
    wrap.appendChild(btn);
    wrap.appendChild(hint);
    previewEl.appendChild(wrap);
}

/* ── WYSIWYG slash menu ──
   Typing "/" as the only content of a block being WYSIWYG-edited pops a
   block-type conversion menu, filtered live as the user keeps typing. */
var _wSlashEl = null;
var _wSlashCtx = null;   // { blockIdx }
function editableTextOf(blockEl) {
    var clone = blockEl.cloneNode(true);
    clone.querySelectorAll('[data-md-chrome="1"]').forEach(function (n) { n.remove(); });
    return (clone.textContent || '').replace(/[​ ]/g, ' ');
}
var _wSlashDismissed = false;    // ESC pressed — stay closed for this "/" run
var _wSlashOutsideBound = false;
function checkWysiwygSlash(blockEl, blockIdx) {
    var text = editableTextOf(blockEl).trim();
    var m = text.match(/^\/(\S*)$/);
    if (!m) {
        _wSlashDismissed = false;   // trigger run ended — ESC no longer sticks
        closeWysiwygSlash();
        return;
    }
    if (_wSlashDismissed) return;
    openWysiwygSlash(blockEl, blockIdx, m[1]);
}
/* Clicking anywhere outside the menu AND outside the edited block must not
   leave a phantom editor behind (the blur handler skips closing while the
   menu is open) — close the menu and cancel the edit: the "/cmd" filter
   text is a command, not content. */
function _wSlashOutside(e) {
    if (!wysiwygSlashIsOpen()) return;
    if (_wSlashEl && _wSlashEl.contains(e.target)) return;
    var ed = _activeBlockEdit;
    if (ed && ed.blockEl && ed.blockEl.contains(e.target)) return;
    closeWysiwygSlash();
    if (ed) closeBlockEditor(false);
}
function openWysiwygSlash(blockEl, blockIdx, filter) {
    var f = (filter || '').toLowerCase();
    var items = INSERT_BLOCKS.filter(function (c) {
        return c.key.indexOf(f) >= 0 || c.label.toLowerCase().indexOf(f) >= 0;
    });
    if (!items.length) { closeWysiwygSlash(); return; }
    if (!_wSlashEl) {
        _wSlashEl = document.createElement('div');
        _wSlashEl.className = 'md-block-popup md-wslash';
        _wSlashEl.dataset.mdChrome = '1';
        document.body.appendChild(_wSlashEl);
    }
    _wSlashCtx = { blockIdx: blockIdx };
    _wSlashEl.innerHTML = '';
    _wSlashEl.setAttribute('role', 'menu');
    items.forEach(function (item, i) {
        var el = document.createElement('button');
        el.type = 'button';
        el.className = 'md-popup-item' + (i === 0 ? ' active' : '');
        el.setAttribute('role', 'menuitem');
        if (item.icon) {
            var ic = document.createElement('span');
            ic.className = 'md-popup-icon';
            ic.textContent = item.icon;
            el.appendChild(ic);
        }
        el.appendChild(document.createTextNode(item.label));
        el.dataset.key = item.key;
        el.addEventListener('mousedown', function (e) { e.preventDefault(); });
        el.addEventListener('click', function () { applyWysiwygSlash(item); });
        el.addEventListener('mouseenter', function () {
            _wSlashEl.querySelectorAll('.md-popup-item').forEach(function (x) { x.classList.remove('active'); });
            el.classList.add('active');
        });
        _wSlashEl.appendChild(el);
    });
    var hintEl = document.createElement('div');
    hintEl.className = 'md-popup-hint';
    hintEl.textContent = '↑↓ 이동 · Enter 선택 · Esc 닫기';
    _wSlashEl.appendChild(hintEl);
    // Position under the caret (fallback: under the block)
    var rect = null;
    try {
        var sel = window.getSelection();
        if (sel && sel.rangeCount) rect = sel.getRangeAt(0).getBoundingClientRect();
    } catch (_) {}
    if (!rect || (rect.width === 0 && rect.height === 0 && rect.top === 0)) {
        rect = blockEl.getBoundingClientRect();
    }
    _wSlashEl.style.display = 'block';
    var pr = _wSlashEl.getBoundingClientRect();
    var x = Math.max(8, Math.min(window.innerWidth - pr.width - 8, rect.left));
    var y = rect.bottom + 6;
    if (y + pr.height > window.innerHeight - 8) y = rect.top - pr.height - 6;
    _wSlashEl.style.left = Math.round(x) + 'px';
    _wSlashEl.style.top = Math.round(y) + 'px';
    if (!_wSlashOutsideBound) {
        document.addEventListener('mousedown', _wSlashOutside, true);
        _wSlashOutsideBound = true;
    }
}
function closeWysiwygSlash() {
    if (_wSlashEl) _wSlashEl.style.display = 'none';
    _wSlashCtx = null;
    if (_wSlashOutsideBound) {
        document.removeEventListener('mousedown', _wSlashOutside, true);
        _wSlashOutsideBound = false;
    }
}
function wysiwygSlashIsOpen() {
    return !!(_wSlashEl && _wSlashEl.style.display !== 'none' && _wSlashCtx);
}
function wysiwygSlashHandleKey(ev) {
    if (!wysiwygSlashIsOpen()) return false;
    if (ev.key === 'Escape') {
        ev.preventDefault();
        _wSlashDismissed = true;   // don't re-open on the very next keystroke
        closeWysiwygSlash();
        return true;
    }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        var items = _wSlashEl.querySelectorAll('.md-popup-item');
        if (!items.length) return true;
        var idx = 0;
        items.forEach(function (it, i) { if (it.classList.contains('active')) idx = i; });
        items[idx].classList.remove('active');
        idx = (idx + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[idx].classList.add('active');
        items[idx].scrollIntoView({ block: 'nearest' });
        return true;
    }
    if (ev.key === 'Enter') {
        ev.preventDefault();
        var active = _wSlashEl.querySelector('.md-popup-item.active');
        if (active) {
            var item = INSERT_BLOCKS.find(function (c) { return c.key === active.dataset.key; });
            if (item) applyWysiwygSlash(item);
        }
        return true;
    }
    return false;
}
function applyWysiwygSlash(item) {
    if (!_wSlashCtx) return;
    var blockIdx = _wSlashCtx.blockIdx;
    closeWysiwygSlash();
    // Tear down the active editor WITHOUT committing — the "/xxx" filter
    // text is a command, not content.
    if (_activeBlockEdit) {
        var ed = _activeBlockEdit;
        _activeBlockEdit = null;
        if (ed.teardown) ed.teardown();
        hideFormatToolbar();
    }
    var raws = currentRaws();
    if (raws[blockIdx] == null) return;
    var trailing = (raws[blockIdx].match(/\n*$/) || ['\n\n'])[0] || '\n\n';
    if (trailing.length < 2) trailing = '\n\n';
    raws[blockIdx] = item.raw.replace(/\n*$/, '') + trailing;
    applyRawsUpdate(raws);
    // Re-open the editor on the converted block for immediate typing
    var gen = _externalGen;
    setTimeout(function () {
        if (gen !== _externalGen) return;   // document replaced externally
        var nb = previewEl && previewEl.querySelector('.md-block[data-block-idx="' + blockIdx + '"]');
        if (nb && _currentTokens && _currentTokens[blockIdx] &&
            _currentTokens[blockIdx].type !== 'table' && _currentTokens[blockIdx].type !== 'code' &&
            _currentTokens[blockIdx].type !== 'hr') {
            openBlockEditor(nb);
        }
    }, 40);
}

/* ── Link edit popover (v1.0.28) ──
   VS Code webviews don't support window.prompt, so the old toolbar link
   flow silently did nothing. This popover edits an <a>'s text/URL in place
   while a WYSIWYG editor is open (click the link, or 🔗 on a selection). */
var _linkPopEl = null;
var _linkPopAnchor = null;
function linkPopoverIsOpen() { return !!_linkPopEl; }
function closeLinkPopover() {
    if (_linkPopEl && _linkPopEl.parentNode) _linkPopEl.parentNode.removeChild(_linkPopEl);
    _linkPopEl = null;
    _linkPopAnchor = null;
    document.removeEventListener('mousedown', _linkPopOutside, true);
}
function _linkPopOutside(e) {
    if (!_linkPopEl || _linkPopEl.contains(e.target)) return;
    closeLinkPopover();
}
function openLinkPopover(anchorEl, focusUrl) {
    closeLinkPopover();
    if (!anchorEl) return;
    _linkPopAnchor = anchorEl;

    var pop = document.createElement('div');
    pop.className = 'md-link-popover';
    pop.dataset.mdChrome = '1';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', '링크 편집');

    function field(labelText, value, placeholder) {
        var row = document.createElement('label');
        row.className = 'md-link-row';
        var lab = document.createElement('span');
        lab.textContent = labelText;
        var input = document.createElement('input');
        input.type = 'text';
        input.value = value;
        input.placeholder = placeholder;
        input.spellcheck = false;
        row.appendChild(lab);
        row.appendChild(input);
        pop.appendChild(row);
        return input;
    }
    var textInput = field('텍스트', anchorEl.textContent || '', '표시할 텍스트');
    var urlInput = field('URL', anchorEl.getAttribute('href') || '', 'https://…');

    var actions = document.createElement('div');
    actions.className = 'md-link-actions';
    function actionBtn(label, cls, fn) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.className = cls;
        b.addEventListener('mousedown', function (e) { e.preventDefault(); });
        b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); fn(); });
        actions.appendChild(b);
        return b;
    }
    function applyLink() {
        var a = _linkPopAnchor;
        if (a && a.isConnected) {
            var url = urlInput.value.trim();
            var text = textInput.value;
            if (text && text !== a.textContent) a.textContent = text;
            if (url) a.setAttribute('href', url);
        }
        closeLinkPopover();
        refocusEditor();
    }
    function removeLink() {
        var a = _linkPopAnchor;
        if (a && a.isConnected) a.replaceWith(document.createTextNode(a.textContent || ''));
        closeLinkPopover();
        refocusEditor();
    }
    function refocusEditor() {
        if (_activeBlockEdit && _activeBlockEdit.blockEl && _activeBlockEdit.blockEl.focus) {
            _activeBlockEdit.blockEl.focus();
        }
    }
    actionBtn('적용', 'md-link-apply', applyLink);
    actionBtn('링크 제거', 'md-link-remove', removeLink);
    pop.appendChild(actions);

    pop.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); applyLink(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeLinkPopover(); refocusEditor(); }
    });

    document.body.appendChild(pop);
    _linkPopEl = pop;
    var r = anchorEl.getBoundingClientRect();
    var pr = pop.getBoundingClientRect();
    var x = Math.max(8, Math.min(window.innerWidth - pr.width - 8, r.left));
    var y = r.bottom + 6;
    if (y + pr.height > window.innerHeight - 8) y = r.top - pr.height - 6;
    pop.style.left = Math.round(x) + 'px';
    pop.style.top = Math.round(y) + 'px';
    (focusUrl ? urlInput : textInput).focus();
    (focusUrl ? urlInput : textInput).select();
    setTimeout(function () {
        document.addEventListener('mousedown', _linkPopOutside, true);
    }, 0);
}

/* Small floating pencil that appears in the corner of a hovered block or cell.
   Click to open the editor. Stored under the block/cell but not part of the
   saved source — stripped by cleanEditAffordances() before every commit. */
function addEditIcon(host, onClick) {
    if (!host || host.querySelector(':scope > .md-edit-icon')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'md-edit-icon';
    btn.setAttribute('aria-label', '수정');
    btn.dataset.mdChrome = '1';
    btn.contentEditable = 'false';   // marker so we can strip on save
    btn.textContent = '✎';        // heavier pencil (U+270E) — more visible than ✏
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });  // don't blur active editor
    btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof onClick === 'function') onClick();
    });
    host.appendChild(btn);
}

/* Remove any UI chrome we injected (edit icons, done buttons, format
   toolbar) so the captured HTML doesn't include them when we compute the
   new source. */
function cleanEditAffordances(root) {
    if (!root) return;
    root.querySelectorAll('[data-md-chrome="1"]').forEach(function (n) { n.remove(); });
}

/* Rendered footnote refs and TOC boxes back to their source syntax before
   any HTML→markdown capture — otherwise an untouched cell/block commit
   would bake "[1](#fn-1)" or the whole TOC list into the file. The syntax
   is wrapped in  sentinels because turndown escapes brackets in
   plain text ("[^1]" → "\[^1\]"); restoreDerenderedSyntax() swaps them
   back AFTER capture. */
function derenderGeneratedChrome(root) {
    if (!root) return;
    root.querySelectorAll('sup.footnote-ref').forEach(function (n) {
        var m = (n.id || '').match(/^fnref-(.+)-\d+$/);
        n.replaceWith(document.createTextNode(m ? '^' + m[1] + '' : (n.textContent || '')));
    });
    root.querySelectorAll('.md-toc').forEach(function (n) {
        n.replaceWith(document.createTextNode('TOC'));
    });
    root.querySelectorAll('section.footnotes').forEach(function (n) { n.remove(); });
}
function restoreDerenderedSyntax(md) {
    return String(md)
        .replace(/\^(.*?)/g, function (_, id) { return '[^' + id + ']'; })
        .replace(/TOC/g, '[[TOC]]')
        .replace(//g, '');
}

/* Floating format toolbar (v1.0.24) — shown above a text selection inside
   the active editor. Bold / Italic / Code / Link. */
var _fmtToolbarEl = null;
function ensureFormatToolbar() {
    if (_fmtToolbarEl) return _fmtToolbarEl;
    var t = document.createElement('div');
    t.className = 'md-fmt-toolbar';
    t.dataset.mdChrome = '1';
    t.setAttribute('role', 'toolbar');
    var BUTTONS = [
        { cmd: 'bold',   label: 'B',  aria: '굵게'   , style: 'font-weight:700' },
        { cmd: 'italic', label: 'I',  aria: '이탤릭' , style: 'font-style:italic' },
        { cmd: 'code',   label: '</>',aria: '코드'   , style: 'font-family:monospace;font-size:10.5px' },
        { cmd: 'link',   label: '🔗', aria: '링크'   , style: '' }
    ];
    BUTTONS.forEach(function (b) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = b.label;
        btn.setAttribute('aria-label', b.aria);
        btn.dataset.cmd = b.cmd;
        if (b.style) btn.setAttribute('style', b.style);
        btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            applyFormatCommand(b.cmd);
        });
        t.appendChild(btn);
    });
    document.body.appendChild(t);
    _fmtToolbarEl = t;
    return t;
}
function updateFormatToolbar() {
    if (!_activeBlockEdit) return hideFormatToolbar();
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return hideFormatToolbar();
    var range = sel.getRangeAt(0);
    // Selection must lie inside the active editor host
    var host = _activeBlockEdit.cell || _activeBlockEdit.blockEl;
    if (!host || !host.contains(range.commonAncestorContainer)) return hideFormatToolbar();
    var rect = range.getBoundingClientRect();
    if (!rect || rect.width === 0 && rect.height === 0) return hideFormatToolbar();
    var t = ensureFormatToolbar();
    t.classList.add('md-fmt-toolbar-show');
    // Measure after making visible so getBoundingClientRect returns real size
    var tRect = t.getBoundingClientRect();
    var x = rect.left + rect.width / 2 - tRect.width / 2;
    var y = rect.top - tRect.height - 8;
    if (y < 8) y = rect.bottom + 8;  // flip below if no room above
    x = Math.max(8, Math.min(window.innerWidth - tRect.width - 8, x));
    t.style.left = Math.round(x) + 'px';
    t.style.top = Math.round(y) + 'px';
}
function hideFormatToolbar() {
    if (_fmtToolbarEl) _fmtToolbarEl.classList.remove('md-fmt-toolbar-show');
}
function applyFormatCommand(cmd) {
    if (!_activeBlockEdit) return;
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    if (cmd === 'link') {
        // window.prompt doesn't exist in VS Code webviews — create the link
        // with a placeholder href and edit it in the popover.
        var host0 = _activeBlockEdit.cell || _activeBlockEdit.blockEl;
        try { document.execCommand('createLink', false, 'https://'); } catch (_) {}
        var node = sel.anchorNode;
        var a = node && node.parentElement ? node.parentElement.closest('a') : null;
        if (!a && host0) a = host0.querySelector('a[href="https://"]');
        if (a) openLinkPopover(a, true);
        return;
    } else if (cmd === 'code') {
        // Wrap in <code> manually — execCommand doesn't cover it
        var range = sel.getRangeAt(0);
        var frag = range.extractContents();
        var codeEl = document.createElement('code');
        codeEl.appendChild(frag);
        range.insertNode(codeEl);
        // Restore selection over the new element
        var r = document.createRange();
        r.selectNodeContents(codeEl);
        sel.removeAllRanges();
        sel.addRange(r);
    } else {
        try { document.execCommand(cmd, false, null); } catch (_) {}
    }
    // Refocus editable host
    var host = _activeBlockEdit.cell || _activeBlockEdit.blockEl;
    if (host && host.focus) host.focus();
    setTimeout(updateFormatToolbar, 0);
}

// Selection listener registered once
if (typeof document !== 'undefined') {
    document.addEventListener('selectionchange', function () {
        if (_activeBlockEdit) updateFormatToolbar();
        else hideFormatToolbar();
    });
}

/* Floating ✓ 완료 + × 취소 button pair that appears while a block or
   cell is being edited. Both are in the same top-right corner where the
   pencil icon lived, so eye/mouse movement stays minimal. */
function addDoneButton(host) {
    if (!host || host.querySelector(':scope > .md-done-btn')) return;

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'md-cancel-btn';
    cancelBtn.dataset.mdChrome = '1';
    cancelBtn.contentEditable = 'false';
    cancelBtn.setAttribute('aria-label', '취소');
    cancelBtn.textContent = '✕';
    cancelBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    cancelBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeBlockEditor(false);   // discard
    });

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'md-done-btn';
    btn.dataset.mdChrome = '1';
    btn.contentEditable = 'false';
    btn.setAttribute('aria-label', '완료');
    btn.textContent = '✓';
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        // Brief "saving" flash so a large-doc commit doesn't feel silent.
        btn.classList.add('md-done-btn-saving');
        btn.textContent = '⋯';
        setTimeout(function () { closeBlockEditor(true); }, 40);
    });

    host.appendChild(cancelBtn);
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
        // Committing the other editor can shift token indexes — resolve the
        // table's NEW index, then re-find the target cell in the fresh DOM
        // using the coordinates we captured a moment ago.
        blockIdx = resolveIdxAfterCommit(blockIdx);
        if (blockIdx < 0) return;
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
    // Select all cell content so typing replaces the current value —
    // matches spreadsheet muscle memory.
    try {
        var range = document.createRange();
        range.selectNodeContents(cell);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    } catch (_) {}

    addDoneButton(cell);
    // Markdown tables get structural controls (row/col/align) while editing
    if (kind !== 'html') showTableToolbar(cell.closest('.md-block'));

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

    var pastePlainHandler = function (ev) {
        // Rich-text paste injects styled spans that leak into the saved
        // source (especially the html-cell innerHTML path) — coerce to text.
        if (!ev.clipboardData) return;
        var text = ev.clipboardData.getData('text/plain');
        ev.preventDefault();
        if (text) {
            try { document.execCommand('insertText', false, text.replace(/[\r\n]+/g, ' ')); } catch (_) {}
        }
    };
    var keyHandler = function (ev) {
        if (ev.key === 'Escape') { ev.preventDefault(); closeBlockEditor(false); }
        else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
            ev.preventDefault();
            closeBlockEditor(true);
        } else if (ev.key === 'Enter' && !ev.shiftKey) {
            // Enter → commit + move to same column, next row
            ev.preventDefault();
            moveToCellByOffset(blockIdx, kind, isHeader, rowIdx, colIdx, +1, 'row');
        } else if (ev.key === 'Enter' && ev.shiftKey) {
            // Shift+Enter → commit + move to same column, previous row
            ev.preventDefault();
            moveToCellByOffset(blockIdx, kind, isHeader, rowIdx, colIdx, -1, 'row');
        } else if (ev.key === 'Tab') {
            // Tab → move to next cell in row (Shift+Tab → previous)
            ev.preventDefault();
            moveToCellByOffset(blockIdx, kind, isHeader, rowIdx, colIdx, ev.shiftKey ? -1 : +1, 'col');
        }
    };
    var blurHandler = function () {
        setTimeout(function () {
            if (_activeBlockEdit && _activeBlockEdit.cell === cell) closeBlockEditor(true);
        }, 0);
    };
    cell.addEventListener('keydown', keyHandler);
    cell.addEventListener('blur', blurHandler);
    cell.addEventListener('paste', pastePlainHandler);
    _activeBlockEdit.teardown = function () {
        cell.removeEventListener('keydown', keyHandler);
        cell.removeEventListener('blur', blurHandler);
        cell.removeEventListener('paste', pastePlainHandler);
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

/* Find a cell by its structural coordinates in the current preview DOM.
   Called after commit → re-render so we can hop to the neighbor cell
   with a fresh reference. */
function findCellByCoords(blockIdx, isHeader, rowIdx, colIdx) {
    var block = previewEl && previewEl.querySelector('.md-block[data-block-idx="' + blockIdx + '"]');
    if (!block) return null;
    var table = block.querySelector('table');
    if (!table) return null;
    if (isHeader) {
        var thead = table.querySelector('thead');
        var hrow = thead ? thead.querySelector('tr') : table.querySelector('tr');
        return hrow ? hrow.children[colIdx] : null;
    }
    var section = table.querySelector('tbody') || table;
    var rows = Array.from(section.children).filter(function (n) { return n.tagName === 'TR'; });
    var row = rows[rowIdx];
    return row ? row.children[colIdx] : null;
}

/* Commit the current cell edit and hop to a neighbor. `axis` is 'row'
   (Enter / Shift+Enter) or 'col' (Tab / Shift+Tab). `delta` is ±1. */
function moveToCellByOffset(blockIdx, kind, isHeader, rowIdx, colIdx, delta, axis) {
    var destIsHeader = isHeader;
    var destRow = rowIdx;
    var destCol = colIdx;
    if (axis === 'row') {
        if (isHeader) {
            if (delta > 0) { destIsHeader = false; destRow = 0; }
            else { destIsHeader = true; destRow = -1; }  // no-op above header
        } else {
            destRow = rowIdx + delta;
            if (destRow < 0) { destIsHeader = true; destRow = -1; }
        }
    } else {
        destCol = colIdx + delta;
        if (destCol < 0) {
            // Wrap to end of previous row
            if (isHeader) return;                   // no row above
            destCol = 999; destRow = rowIdx - 1;
            if (destRow < 0) { destIsHeader = true; destRow = -1; }
        }
    }
    closeBlockEditor(true);
    // renderPreview runs synchronously inside closeBlockEditor, so the fresh
    // DOM is already in place — one microtask is enough to let commit-side
    // effects settle before we open the next cell.
    var gen = _externalGen;
    setTimeout(function () {
        if (gen !== _externalGen) return;   // document replaced externally
        var next = findCellByCoords(blockIdx, destIsHeader, destRow, destCol);
        if (!next && axis === 'col' && destCol > 0) {
            // Wrapping past end of row → try first cell of next row
            var trialRow = destRow + 1;
            next = findCellByCoords(blockIdx, false, trialRow, 0);
            if (!next && delta > 0 && kind !== 'html') {
                // Tab past the very last cell — spreadsheet muscle memory:
                // grow the table by one row and keep typing.
                var token = _currentTokens && _currentTokens[blockIdx];
                if (token && token.type === 'table') {
                    tableMutate(blockIdx, function (t) {
                        t.rows.push(t.header.map(emptyTableCell));
                    });
                    var newRowIdx = token.rows.length - 1;
                    setTimeout(function () {
                        if (gen !== _externalGen) return;
                        var c = findCellByCoords(blockIdx, false, newRowIdx, 0);
                        if (c) openCellEditor(c, blockIdx, kind);
                    }, 20);
                    return;
                }
            }
        }
        if (next) openCellEditor(next, blockIdx, kind);
    }, 20);
}

/* ── Table structure editing (v1.0.28) ──
   Row/column insert·delete and column alignment for MARKDOWN tables,
   mutating the parsed token and regenerating the table source. HTML
   tables keep raw-source editing (their layout is user-authored). */
function tableMutate(blockIdx, mutate) {
    var token = _currentTokens && _currentTokens[blockIdx];
    if (!token || token.type !== 'table') return false;
    mutate(token);
    var trailing = ((token.raw || '').match(/\n*$/) || ['\n'])[0] || '\n';
    var newRaw = regenerateTableMarkdown(token).replace(/\n+$/, '') + trailing;
    var parts = [];
    for (var i = 0; i < _currentTokens.length; i++) {
        parts.push(i === blockIdx ? newRaw : (_currentTokens[i].raw || ''));
    }
    applyRawsUpdate(parts);
    return true;
}
function emptyTableCell() { return { text: '' }; }

/* Toolbar action while a markdown-table cell editor is open. Commits the
   cell text first, then applies the structural change, then re-opens the
   editor on the logical cell so the flow never breaks. */
function tableToolbarAction(action) {
    if (!_activeBlockEdit || _activeBlockEdit.mode !== 'cell') return;
    var ed = _activeBlockEdit;
    var blockIdx = ed.blockIdx, rowIdx = ed.rowIdx, colIdx = ed.colIdx, isHeader = ed.isHeader;
    var token = _currentTokens && _currentTokens[blockIdx];
    if (!token || token.type !== 'table') return;
    var cols = token.header.length;
    var rows = token.rows.length;

    // Validate before touching anything
    if (action === 'row-' && (isHeader || rows <= 1)) { showToast(isHeader ? '제목 행은 삭제할 수 없습니다' : '마지막 행입니다'); return; }
    if (action === 'col-' && cols <= 1) { showToast('마지막 열입니다'); return; }

    closeBlockEditor(true);   // single-token swap — blockIdx stays stable

    var reopen = { header: isHeader, row: rowIdx, col: colIdx };
    var ok = tableMutate(blockIdx, function (t) {
        switch (action) {
            case 'row+': {
                var at = isHeader ? 0 : rowIdx + 1;
                t.rows.splice(at, 0, t.header.map(emptyTableCell));
                reopen = { header: false, row: at, col: colIdx };
                break;
            }
            case 'row-': {
                t.rows.splice(rowIdx, 1);
                reopen = { header: false, row: Math.min(rowIdx, t.rows.length - 1), col: colIdx };
                break;
            }
            case 'col+': {
                t.header.splice(colIdx + 1, 0, { text: '제목' });
                t.align.splice(colIdx + 1, 0, null);
                t.rows.forEach(function (r) { r.splice(colIdx + 1, 0, emptyTableCell()); });
                reopen = { header: isHeader, row: rowIdx, col: colIdx + 1 };
                break;
            }
            case 'col-': {
                t.header.splice(colIdx, 1);
                t.align.splice(colIdx, 1);
                t.rows.forEach(function (r) { r.splice(colIdx, 1); });
                reopen = { header: isHeader, row: rowIdx, col: Math.min(colIdx, t.header.length - 1) };
                break;
            }
            case 'align': {
                var CYCLE = [null, 'left', 'center', 'right'];
                var cur = CYCLE.indexOf(t.align[colIdx] || null);
                t.align[colIdx] = CYCLE[(cur + 1) % CYCLE.length];
                showToast('열 정렬: ' + (t.align[colIdx] || '기본'));
                break;
            }
        }
    });
    if (!ok) return;
    var gen = _externalGen;
    setTimeout(function () {
        if (gen !== _externalGen) return;
        var cell = findCellByCoords(blockIdx, reopen.header, reopen.row, reopen.col);
        if (cell) openCellEditor(cell, blockIdx, 'markdown');
    }, 30);
}

/* Small toolbar above the table while one of its cells is being edited. */
function showTableToolbar(blockEl) {
    if (!blockEl || blockEl.querySelector(':scope > .md-table-toolbar')) return;
    var bar = document.createElement('div');
    bar.className = 'md-table-toolbar';
    bar.dataset.mdChrome = '1';
    bar.contentEditable = 'false';
    var BUTTONS = [
        { key: 'row+',  label: '＋행', aria: '아래에 행 추가' },
        { key: 'row-',  label: '－행', aria: '현재 행 삭제' },
        { key: 'col+',  label: '＋열', aria: '오른쪽에 열 추가' },
        { key: 'col-',  label: '－열', aria: '현재 열 삭제' },
        { key: 'align', label: '⇤⇥',  aria: '열 정렬 전환' }
    ];
    BUTTONS.forEach(function (b) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = b.label;
        btn.setAttribute('aria-label', b.aria);
        btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
        btn.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            tableToolbarAction(b.key);
        });
        bar.appendChild(btn);
    });
    blockEl.appendChild(bar);
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
    // <pre> (fenced code blocks), KaTeX math nodes, Mermaid diagrams,
    // admonition boxes, and rendered TOC/footnote chrome — turndown would
    // serialize their generated HTML instead of the original [[TOC]] /
    // [^n] / ::: syntax the raw editor shows.
    if (blockEl.querySelector('pre, .katex, .katex-display, .mermaid-diagram, .md-admonition, .md-toc, .footnotes, .footnote-ref, .md-frontmatter')) return false;
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
        // Committing the other editor can shift every token index — resolve
        // the clicked block's NEW index, then re-find it in the fresh DOM.
        blockIdx = resolveIdxAfterCommit(blockIdx);
        if (blockIdx < 0) return;
        blockEl = previewEl && previewEl.querySelector('.md-block[data-block-idx="' + blockIdx + '"]');
        if (!blockEl) return;
    }
    if (!_currentTokens || !_currentTokens[blockIdx]) return;
    var token = _currentTokens[blockIdx];
    // Multi-token blocks (admonition groups) edit their JOINED raw so the
    // whole ::: … ::: construct is visible in the editor.
    var span = parseInt(blockEl.dataset.blockSpan || '1', 10) || 1;
    var rawText = span > 1 ? joinTokenRaws(_currentTokens, blockIdx, span) : (token.raw || '');
    var trailingBlanks = rawText.match(/\n*$/)[0];

    if (span === 1 && token.type === 'code' && /^(`{3,}|~{3,})/.test(token.raw || '')) {
        // Fenced code gets a dedicated editor: code text without the fences
        // plus a language field — no risk of breaking the fence syntax.
        openCodeEditor(blockEl, blockIdx, token, trailingBlanks);
    } else if (span === 1 && isWysiwygSafe(token, blockEl) && getTurndown()) {
        openWysiwygEditor(blockEl, blockIdx, token, trailingBlanks);
    } else {
        openRawEditor(blockEl, blockIdx, rawText, trailingBlanks, span);
    }
}

function openCodeEditor(blockEl, blockIdx, token, trailingBlanks) {
    var fence = ((token.raw || '').match(/^(`{3,}|~{3,})/) || ['```'])[0];

    blockEl.classList.add('md-block-editing', 'md-code-editing');
    blockEl.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'md-code-edit-head';
    head.dataset.mdChrome = '1';
    var langLabel = document.createElement('span');
    langLabel.className = 'md-code-lang-label';
    langLabel.textContent = '언어';
    var langInput = document.createElement('input');
    langInput.type = 'text';
    langInput.className = 'md-code-lang';
    langInput.placeholder = 'js, python, …';
    langInput.value = token.lang || '';
    langInput.spellcheck = false;
    head.appendChild(langLabel);
    head.appendChild(langInput);
    blockEl.appendChild(head);

    var textarea = document.createElement('textarea');
    textarea.className = 'md-block-editor md-code-editor';
    textarea.value = token.text || '';
    textarea.spellcheck = false;
    blockEl.appendChild(textarea);
    autoResizeTextarea(textarea);
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;

    addDoneButton(blockEl);

    _activeBlockEdit = {
        blockEl: blockEl, blockIdx: blockIdx, originalRaw: token.raw,
        trailingBlanks: trailingBlanks, mode: 'code',
        textarea: textarea, langInput: langInput, fence: fence, span: 1
    };

    var keyHandler = function (ev) {
        if (ev.key === 'Escape') { ev.preventDefault(); closeBlockEditor(false); }
        else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
            ev.preventDefault();
            closeBlockEditor(true);
        } else if (ev.key === 'Tab' && ev.target === textarea) {
            // Tab belongs to the code, not focus traversal
            ev.preventDefault();
            var s = textarea.selectionStart, e2 = textarea.selectionEnd;
            textarea.value = textarea.value.slice(0, s) + '  ' + textarea.value.slice(e2);
            textarea.selectionStart = textarea.selectionEnd = s + 2;
        }
    };
    var inputHandler = function () { autoResizeTextarea(textarea); };
    // Two focusables (language + code) — only commit when focus leaves the block
    var focusOutHandler = function () {
        setTimeout(function () {
            if (!_activeBlockEdit || _activeBlockEdit.blockEl !== blockEl) return;
            var ae = document.activeElement;
            if (ae && blockEl.contains(ae)) return;
            closeBlockEditor(true);
        }, 0);
    };
    blockEl.addEventListener('keydown', keyHandler);
    blockEl.addEventListener('focusout', focusOutHandler);
    textarea.addEventListener('input', inputHandler);
    _activeBlockEdit.teardown = function () {
        blockEl.removeEventListener('keydown', keyHandler);
        blockEl.removeEventListener('focusout', focusOutHandler);
        textarea.removeEventListener('input', inputHandler);
        blockEl.classList.remove('md-block-editing', 'md-code-editing');
    };
}

function openWysiwygEditor(blockEl, blockIdx, token, trailingBlanks) {
    // Strip any UI chrome (pencil icon) so the captured innerHTML doesn't
    // include our own markup when it goes through turndown.
    cleanEditAffordances(blockEl);

    blockEl.classList.add('md-block-editing', 'md-block-wysiwyg');
    blockEl.setAttribute('contenteditable', 'true');
    blockEl.setAttribute('spellcheck', 'true');
    blockEl.focus();

    // Selection placement — target the CONTENT element (last real child)
    // so the cursor lives inside the paragraph/heading/etc., not adjacent
    // to it. This keeps typed text from later leaking into the sibling
    // ✓/✕ chrome buttons we're about to append as children of the block.
    try {
        var range = document.createRange();
        var contentTarget = blockEl.lastElementChild || blockEl;
        range.selectNodeContents(contentTarget);
        var isHeading = (token && token.type === 'heading') ||
            !!blockEl.querySelector('h1, h2, h3, h4, h5, h6');
        if (!isHeading) range.collapse(false);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    } catch (_) {}

    addDoneButton(blockEl);
    _wSlashDismissed = false;

    _activeBlockEdit = {
        blockEl: blockEl, blockIdx: blockIdx, originalRaw: token.raw,
        trailingBlanks: trailingBlanks, mode: 'wysiwyg', span: 1
    };

    var keyHandler = function (ev) {
        // Slash menu owns arrows / Enter / ESC while it's open
        if (wysiwygSlashHandleKey(ev)) return;
        if (ev.key === 'Escape') { ev.preventDefault(); closeBlockEditor(false); }
        else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
            ev.preventDefault();
            closeBlockEditor(true);
        }
    };
    var blurHandler = function () {
        setTimeout(function () {
            // Keep the editor open while the slash menu / link popover has
            // focus-stealing UI
            if (wysiwygSlashIsOpen() || linkPopoverIsOpen()) return;
            if (_activeBlockEdit && _activeBlockEdit.blockEl === blockEl) closeBlockEditor(true);
        }, 0);
    };
    var linkClickHandler = function (ev) {
        var a = ev.target && ev.target.closest ? ev.target.closest('a') : null;
        if (!a || !blockEl.contains(a)) return;
        // Inside the editor a link click means "edit this link", not navigate
        ev.preventDefault();
        ev.stopPropagation();
        openLinkPopover(a, false);
    };
    var pasteHandler = function (ev) { handleEditorImageEvent(ev, 'paste'); };
    var dropHandler = function (ev) { handleEditorImageEvent(ev, 'drop'); };
    var dragoverHandler = function (ev) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; };
    var slashHandler = function () { checkWysiwygSlash(blockEl, blockIdx); };

    blockEl.addEventListener('keydown', keyHandler);
    blockEl.addEventListener('blur', blurHandler);
    blockEl.addEventListener('click', linkClickHandler);
    blockEl.addEventListener('paste', pasteHandler);
    blockEl.addEventListener('drop', dropHandler);
    blockEl.addEventListener('dragover', dragoverHandler);
    blockEl.addEventListener('input', slashHandler);
    _activeBlockEdit.teardown = function () {
        blockEl.removeEventListener('keydown', keyHandler);
        blockEl.removeEventListener('blur', blurHandler);
        blockEl.removeEventListener('click', linkClickHandler);
        blockEl.removeEventListener('paste', pasteHandler);
        blockEl.removeEventListener('drop', dropHandler);
        blockEl.removeEventListener('dragover', dragoverHandler);
        blockEl.removeEventListener('input', slashHandler);
        blockEl.removeAttribute('contenteditable');
        blockEl.removeAttribute('spellcheck');
        blockEl.classList.remove('md-block-editing', 'md-block-wysiwyg');
        closeWysiwygSlash();
        closeLinkPopover();
    };
}

/* Handle drop / paste of image files inside a WYSIWYG editor. Reads the
   first image, converts to base64 data URL, inserts as <img> at caret. */
function handleEditorImageEvent(ev, kind) {
    var dt = kind === 'paste' ? ev.clipboardData : ev.dataTransfer;
    if (!dt || !dt.items) return;
    for (var i = 0; i < dt.items.length; i++) {
        var item = dt.items[i];
        if (item.type && item.type.indexOf('image/') === 0) {
            var file = item.getAsFile();
            if (!file) continue;
            ev.preventDefault();
            // base64 inflates ~33% and lands in the markdown source — a huge
            // image would freeze rendering and bloat the file permanently.
            if (file.size > 8 * 1024 * 1024) {
                showToast('이미지가 너무 큽니다 (8MB 초과) — 파일로 저장 후 링크하세요');
                return;
            }
            if (file.size > 2 * 1024 * 1024) {
                showToast('큰 이미지(' + (file.size / 1024 / 1024).toFixed(1) + 'MB) — 문서 용량이 커집니다');
            }
            var reader = new FileReader();
            reader.onload = function (e) {
                var dataUrl = e.target.result;
                try {
                    document.execCommand('insertHTML', false,
                        '<img src="' + dataUrl + '" alt="image">');
                } catch (_) {}
                showToast('이미지 삽입됨');
            };
            reader.readAsDataURL(file);
            return;
        }
    }
}

/* Inline markdown shortcuts (v1.0.24) — as the user types inside a
   contenteditable block, watch the text around the caret and convert
   common markdown syntax into the corresponding HTML. Runs on the
   text node the caret sits in so multi-line content isn't affected. */
var INLINE_MD_RULES = [
    // Ordered longest-match-first so ** doesn't shadow *
    { re: /\*\*([^*\n]+)\*\*$/, wrap: 'strong' },
    { re: /__([^_\n]+)__$/,       wrap: 'strong' },
    { re: /\*([^*\n]+)\*$/,       wrap: 'em' },
    { re: /_([^_\n]+)_$/,          wrap: 'em' },
    { re: /~~([^~\n]+)~~$/,        wrap: 'del' },
    { re: /`([^`\n]+)`$/,           wrap: 'code' }
];
function applyInlineMarkdownShortcuts(host) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    if (!range.collapsed) return;
    var node = range.startContainer;
    if (node.nodeType !== 3 /* TEXT */) return;
    if (!host.contains(node)) return;
    var text = node.nodeValue || '';
    var caret = range.startOffset;
    var before = text.substring(0, caret);
    // Only fire on a "confirming" space so that partial patterns like
    // "*bold*" don't match while the user is still typing "**bold**".
    var lastChar = before.charAt(before.length - 1);
    if (lastChar !== ' ' && lastChar !== '\u00A0') return;
    var trimmed = before.substring(0, before.length - 1);
    for (var i = 0; i < INLINE_MD_RULES.length; i++) {
        var rule = INLINE_MD_RULES[i];
        var m = trimmed.match(rule.re);
        if (!m) continue;
        var matchLen = m[0].length + 1;              // includes trailing space
        var startInNode = caret - matchLen;
        // Select the entire matched region (marker + text + trailing space)
        // so execCommand does the DOM edit atomically. The browser then
        // places the caret at the end of the inserted HTML, which is where
        // the user expects to keep typing.
        var selectRange = document.createRange();
        selectRange.setStart(node, startInNode);
        selectRange.setEnd(node, caret);
        sel.removeAllRanges();
        sel.addRange(selectRange);
        var htmlText = m[1].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        var replacement = '<' + rule.wrap + '>' + htmlText + '</' + rule.wrap + '> ';
        try { document.execCommand('insertHTML', false, replacement); } catch (_) {}
        // Chromium's execCommand copies inline font styles onto the inserted
        // wrapper — strip them so the source stays clean when serialized.
        host.querySelectorAll(rule.wrap + '[style], span[style]').forEach(function (el) {
            el.removeAttribute('style');
        });
        // Any residual empty <span> the browser injected around the caret
        host.querySelectorAll('span:empty').forEach(function (el) { el.remove(); });
        return;
    }
}

function openRawEditor(blockEl, blockIdx, rawText, trailingBlanks, span) {
    var raw = String(rawText || '').replace(/\n+$/, '');
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
        blockEl: blockEl, blockIdx: blockIdx, originalRaw: rawText,
        trailingBlanks: trailingBlanks, mode: 'raw', textarea: textarea,
        span: span || 1
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
    // While the slash menu is open the block's visible text is a command
    // ("/표"), not content — committing would overwrite the block with it.
    if (commit && wysiwygSlashIsOpen() && _activeBlockEdit.mode === 'wysiwyg' &&
        /^\/\S*$/.test(editableTextOf(_activeBlockEdit.blockEl).trim())) {
        commit = false;
    }
    closeWysiwygSlash();
    var ed = _activeBlockEdit;
    _activeBlockEdit = null;
    hideFormatToolbar();

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
        // Strip UI chrome (✓ 완료 button, any residual edit icon) before
        // capturing the cell content so their text doesn't sneak into the
        // markdown as literal characters. Rendered footnote/TOC chrome must
        // also revert to its source syntax first.
        cleanEditAffordances(ed.cell);
        derenderGeneratedChrome(ed.cell);
        var td = getTurndown();
        var cellText;
        if (td) {
            try { cellText = td.turndown(ed.cell.innerHTML).replace(/[\r\n]+/g, ' ').trim(); }
            catch (_) { cellText = ed.cell.innerText.trim(); }
        } else {
            cellText = ed.cell.innerText.trim();
        }
        cellText = restoreDerenderedSyntax(cellText);
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
        derenderGeneratedChrome(ed.cell);
        var editedInnerHtml = restoreDerenderedSyntax(ed.cell.innerHTML);
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
        derenderGeneratedChrome(ed.blockEl);
        var td2 = getTurndown();
        if (!td2) { renderPreview(); return; }
        try {
            newRaw = restoreDerenderedSyntax(td2.turndown(ed.blockEl.innerHTML)).trim();
        } catch (e) {
            console.warn('MD Pretty Viewer: turndown failed', e);
            renderPreview();
            return;
        }
        // Blank blockquote separators come back as "> " — normalize the
        // trailing space so quote round-trips stay byte-stable.
        newRaw = newRaw.replace(/^((?:>[ \t]*)+)$/gm, function (m) {
            return m.replace(/[ \t]+$/, '').replace(/>[ \t]+(?=>)/g, '> ');
        });
        // Turndown often reformats without changing MEANING (quote marker
        // spacing, added blank quote lines). If the new markdown renders to
        // the same HTML as the original, keep the original bytes.
        try {
            var oldTrim = (ed.originalRaw || '').replace(/\n+$/, '');
            if (newRaw !== oldTrim &&
                marked.parser(marked.lexer(newRaw)) === marked.parser(marked.lexer(oldTrim))) {
                newRaw = oldTrim;
            }
        } catch (_) {}
        if (ed.teardown) ed.teardown();
    } else if (ed.mode === 'code') {
        var codeLang = (ed.langInput.value || '').trim().replace(/[`\s]/g, '');
        var codeBody = ed.textarea.value.replace(/\n+$/, '');
        var codeFence = ed.fence || '```';
        // Code containing the fence sequence would terminate it early —
        // grow the fence until it can't collide.
        while (codeBody.indexOf(codeFence) >= 0) codeFence += codeFence.charAt(0);
        newRaw = codeFence + codeLang + '\n' + codeBody + '\n' + codeFence;
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
    // The edited block may span several tokens (e.g. an admonition whose
    // body contains blank lines) — replace the whole span with the new raw.
    var span = ed.span || 1;
    var parts = [];
    for (var i = 0; i < _currentTokens.length; i++) {
        if (i === ed.blockIdx) parts.push(newRawWithTrailing);
        if (i >= ed.blockIdx && i < ed.blockIdx + span) continue;
        parts.push(_currentTokens[i].raw || '');
    }
    // Same funnel as structural ops: collapses the redundant separator the
    // forced '\n\n' trailing would otherwise stack onto an existing space
    // token, pushes undo history, saves, re-renders.
    applyRawsUpdate(parts);
}

/* Bumped whenever an external 'update' replaces the document — deferred
   editor-open timers (insert auto-open, slash reopen, cell navigation)
   capture it and bail if the document changed underneath them. */
var _externalGen = 0;

/* Inline-edit undo (v1.0.25) — every commit pushes the pre-change content
   onto a bounded stack. Cmd/Ctrl+Z in Preview mode pops the stack and
   restores the previous content. */
var _editHistory = [];
var _redoHistory = [];
var _EDIT_HISTORY_LIMIT = 30;
function pushEditHistory(prev) {
    if (typeof prev !== 'string') return;
    _editHistory.push(prev);
    if (_editHistory.length > _EDIT_HISTORY_LIMIT) _editHistory.shift();
    _redoHistory.length = 0;   // a new edit forks history — redo is gone
}
function undoInlineEdit() {
    if (_activeBlockEdit) return false;    // ignore while a block is being edited
    if (!_editHistory.length) return false;
    var prev = _editHistory.pop();
    _redoHistory.push(currentContent);
    currentContent = prev;
    if (editorEl) editorEl.value = prev;
    saveToDocument(prev);
    updateStats();
    renderPreview();
    showToast('편집 되돌림');
    return true;
}
function redoInlineEdit() {
    if (_activeBlockEdit) return false;
    if (!_redoHistory.length) return false;
    var next = _redoHistory.pop();
    _editHistory.push(currentContent);   // direct push — must NOT clear redo
    if (_editHistory.length > _EDIT_HISTORY_LIMIT) _editHistory.shift();
    currentContent = next;
    if (editorEl) editorEl.value = next;
    saveToDocument(next);
    updateStats();
    renderPreview();
    showToast('편집 다시 실행');
    return true;
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
    if (!headings.length) {
        var empty = document.createElement('div');
        empty.className = 'outline-empty';
        empty.textContent = '헤딩이 없습니다';
        outlineListEl.appendChild(empty);
        return;
    }
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

/* Link navigation (v1.0.31) — VS Code webviews don't scroll the preview
   pane for in-page #anchors (the pane, not the window, is the scroll
   container) and don't reliably open external links from a custom-editor
   webview. Intercept clicks and route them: #anchors scroll within the
   pane; everything else is handed to the extension (openExternal for URLs,
   vscode.open for workspace files). Bound once on previewEl, which survives
   the innerHTML swaps. */
function bindLinkNavigation() {
    if (!previewEl || previewEl.dataset.linkNavBound === '1') return;
    previewEl.dataset.linkNavBound = '1';
    previewEl.addEventListener('click', function (e) {
        // While a block is being edited, its own handler shows the link
        // editor popover instead of navigating.
        if (_activeBlockEdit) return;
        var a = e.target && e.target.closest ? e.target.closest('a') : null;
        if (!a || !previewEl.contains(a)) return;
        var href = a.getAttribute('href') || '';
        if (!href) return;
        if (href.charAt(0) === '#') {
            e.preventDefault();
            var id = href.slice(1);
            try { id = decodeURIComponent(id); } catch (_) {}
            var target = null;
            try { target = previewEl.querySelector('[id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"')) + '"]'); }
            catch (_) { target = document.getElementById(id); }
            if (!target) target = document.getElementById(id);
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }
        // External URL or workspace file — let the extension host open it.
        e.preventDefault();
        try { vscodeApi.postMessage({ type: 'openLink', href: href }); } catch (_) {}
    });
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
        // Any floating chrome anchored to the old DOM (block popup, slash
        // menu, drop indicator, in-flight drag) is now pointing at token
        // indexes that are about to change — acting on it afterwards would
        // hit the wrong block. Close it all before swapping the DOM.
        resetBlockChrome();
        // IMPORTANT: lex from currentContent directly — token raws are the
        // single source of truth that every edit/structural op writes back
        // to the file. TOC/admonitions/footnotes render per-token inside
        // renderMarkdown so their original syntax survives round-trips.
        var html = renderMarkdown(currentContent);
        // The innerHTML swap resets the pane's scroll position — losing the
        // reading spot on every commit. Capture and restore it.
        var scroller = previewEl.closest('.preview-pane') || previewEl.parentElement;
        var scrollTop = scroller ? scroller.scrollTop : 0;
        previewEl.innerHTML = html;
        if (scroller && scrollTop) {
            // The pane uses scroll-behavior:smooth — restoring through it
            // would ANIMATE back from the top on every commit. Snap instead.
            var prevBehavior = scroller.style.scrollBehavior;
            scroller.style.scrollBehavior = 'auto';
            scroller.scrollTop = scrollTop;
            scroller.style.scrollBehavior = prevBehavior;
        }
        highlightCodeBlocks(previewEl);
        addHeadingIds();
        buildOutline(html);
        makeCheckboxesClickable();
        wrapTablesScrollable(previewEl);
        bindImageLightbox(previewEl);
        bindLinkNavigation();
        bindBlockEditing(previewEl);
        renderEmptyPlaceholder();
        renderMath(previewEl);
        renderMermaid(previewEl);
        // Rebuild scroll-sync anchors after each render so heading offsets stay accurate
        buildScrollAnchors();
        // An open preview-search lost its <mark> highlights in the swap —
        // re-run the query (without stealing scroll) so the panel stays live.
        if (_previewSearchPanel && _previewSearchPanel.style.display !== 'none' && _previewSearchQuery) {
            highlightPreviewMatches(_previewSearchQuery);
            if (_previewMatches.length) {
                _previewMatchIdx = 0;
                _previewMatches[0].classList.add('preview-search-active');
                _previewMatches[0].classList.remove('preview-search-hit');
            }
            updatePreviewSearchCount();
        }
    } catch (err) {
        console.error('MD Pretty Viewer: render failed', err);
        // Stale tokens must not feed the next commit — better to disable
        // block ops than to write outdated raws over the document.
        _currentTokens = null;
        showToast('렌더링 오류가 발생했습니다 — 원본은 안전합니다');
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
var _mermaidThemeSig = '';

/* Read a CSS custom property off <body> (falls back if unset/errored). */
function readCssVar(name, fallback) {
    try {
        var v = getComputedStyle(document.body).getPropertyValue(name).trim();
        return v || fallback;
    } catch (e) { return fallback; }
}

/* Mermaid label size, tied to the reader's chosen preview font size (the −/＋
   control sets --md-font-size). Kept a touch larger than body text so diagram
   labels stay legible. */
function mermaidFontSizePx() {
    var base = parseFloat(readCssVar('--md-font-size', '16')) || 16;
    return Math.max(12, Math.round(base * 1.1));
}

/* A signature that changes whenever the visual theme OR font size changes, so we
   know to re-initialize Mermaid (light/dark + any of the 13 themes + font size). */
function mermaidThemeSig() {
    return (document.body.classList.contains('vscode-dark') ? 'd' : 'l') + '|' +
        readCssVar('--md-accent', '') + '|' + readCssVar('--md-code-bg', '') + '|' +
        readCssVar('--md-text', '') + '|' + mermaidFontSizePx();
}

/* Build a Mermaid config whose colors track the active color theme, so diagrams
   feel like part of the document instead of a generic gray blob. Uses the 'base'
   theme (the only one whose variables are fully overridable) and a concrete font
   stack (a real font — not 'inherit' — so Mermaid measures text correctly and
   stops clipping descenders). */
function buildMermaidConfig() {
    var dark = document.body.classList.contains('vscode-dark');
    var accent  = readCssVar('--md-accent',      dark ? '#6BA3FF' : '#448CFF');
    var text    = readCssVar('--md-text',        dark ? '#e6edf3' : '#24292f');
    var bg      = readCssVar('--md-bg',          dark ? '#0d1117' : '#ffffff');
    var codeBg  = readCssVar('--md-code-bg',     dark ? '#161b22' : '#f6f8fa');
    var border  = readCssVar('--md-code-border', dark ? '#30363d' : '#e1e4e8');
    var heading = readCssVar('--md-heading',     text);
    var font = "'AtoZ','Pretendard Variable','Pretendard',-apple-system,BlinkMacSystemFont," +
        "'Segoe UI',Roboto,'Noto Sans KR',sans-serif";

    return {
        startOnLoad: false,
        theme: 'base',
        securityLevel: 'strict',
        fontFamily: font,
        flowchart: { curve: 'basis', htmlLabels: true, padding: 14, nodeSpacing: 46, rankSpacing: 52, useMaxWidth: true },
        sequence:  { useMaxWidth: true, mirrorActors: true, boxMargin: 10 },
        gantt:     { useMaxWidth: true },
        themeVariables: {
            fontFamily: font,
            fontSize: mermaidFontSizePx() + 'px',
            // diagram canvas blends with the .mermaid-diagram card; nodes use the
            // page bg so they pop against the card with an accent border.
            background: codeBg,
            primaryColor: bg,
            primaryBorderColor: accent,
            primaryTextColor: text,
            secondaryColor: codeBg,
            secondaryBorderColor: border,
            secondaryTextColor: text,
            tertiaryColor: codeBg,
            tertiaryBorderColor: border,
            tertiaryTextColor: text,
            lineColor: accent,
            textColor: text,
            mainBkg: bg,
            nodeBorder: accent,
            nodeTextColor: text,
            clusterBkg: codeBg,
            clusterBorder: border,
            titleColor: heading,
            edgeLabelBackground: codeBg,
            labelBackground: codeBg,
            // sequence diagrams
            actorBkg: bg,
            actorBorder: accent,
            actorTextColor: text,
            actorLineColor: border,
            signalColor: text,
            signalTextColor: text,
            labelBoxBkgColor: bg,
            labelBoxBorderColor: accent,
            labelTextColor: text,
            loopTextColor: text,
            noteBkgColor: bg,
            noteTextColor: text,
            noteBorderColor: accent,
            // Categorical palette for pie / series charts (they'd otherwise all be
            // the same near-white fill since primaryColor is light).
            pie1: '#3B82F6', pie2: '#22C55E', pie3: '#F59E0B', pie4: '#A855F7',
            pie5: '#F43F5E', pie6: '#06B6D4', pie7: '#EC4899', pie8: '#14B8A6',
            pie9: '#F97316', pie10: '#8B5CF6', pie11: '#10B981', pie12: '#EF4444',
            pieStrokeColor: bg, pieStrokeWidth: '2px', pieOuterStrokeColor: border,
            pieSectionTextColor: '#ffffff', pieTitleTextColor: heading
        }
    };
}

/* Give a rendered Mermaid SVG a little breathing room so the bottom row of text
   (descenders / the last node's label) isn't shaved off, and let it paint
   outside the strict viewBox as a safety net. Idempotent per SVG. */
function padMermaidSvg(svg) {
    if (!svg || svg.dataset.vbPadded === '1') return;
    try {
        var vb = svg.getAttribute('viewBox');
        if (vb) {
            var p = vb.split(/[\s,]+/).map(Number);
            if (p.length === 4 && p.every(function (n) { return !isNaN(n); })) {
                var padX = Math.max(6, p[2] * 0.02);
                var padY = Math.max(8, p[3] * 0.04);
                p[0] -= padX; p[1] -= padY * 0.5;
                p[2] += padX * 2; p[3] += padY * 1.5;   // extra room at the bottom
                svg.setAttribute('viewBox', p.join(' '));
            }
        }
        svg.style.overflow = 'visible';
        svg.dataset.vbPadded = '1';
    } catch (e) {}
}

/* Color a flowchart's nodes by hierarchy level, so each tier reads as a distinct
   color instead of one flat fill. Levels are inferred from node positions along
   the flow axis (y for top-down, x for left-right). No-op for non-flowcharts
   (sequence/gantt/etc. have no g.node). Pastel fills + dark text stay readable on
   both light paper and a dark preview card. */
var MERMAID_LEVEL_PALETTE = [
    { f: '#DBEAFE', s: '#3B82F6' },  // blue
    { f: '#DCFCE7', s: '#22C55E' },  // green
    { f: '#FEF3C7', s: '#F59E0B' },  // amber
    { f: '#F3E8FF', s: '#A855F7' },  // purple
    { f: '#FFE4E6', s: '#F43F5E' },  // rose
    { f: '#CFFAFE', s: '#06B6D4' },  // cyan
    { f: '#FCE7F3', s: '#EC4899' }   // pink
];
var _mermaidLevelColors = true;   // toggled by the mdPrettyViewer.mermaidLevelColors setting
function colorMermaidByLevel(svg) {
    if (!svg || !_mermaidLevelColors) return;
    try {
        var nodes = svg.querySelectorAll('g.node');
        if (nodes.length < 2) { colorMermaidActors(svg); return; }
        var arr = [];
        nodes.forEach(function (n) {
            var t = n.getAttribute('transform') || '';
            var m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(t);
            arr.push({ n: n, x: m ? parseFloat(m[1]) : 0, y: m ? parseFloat(m[2]) : 0 });
        });
        var xs = arr.map(function (o) { return o.x; });
        var ys = arr.map(function (o) { return o.y; });
        var xr = Math.max.apply(null, xs) - Math.min.apply(null, xs);
        var yr = Math.max.apply(null, ys) - Math.min.apply(null, ys);
        var axis = yr >= xr ? 'y' : 'x';                 // flow direction
        arr.sort(function (a, b) { return a[axis] - b[axis]; });
        var tol = Math.max(18, (axis === 'y' ? yr : xr) * 0.04);
        var levels = [], cur = null;
        arr.forEach(function (o) {
            if (cur && Math.abs(o[axis] - cur.v) <= tol) cur.items.push(o);
            else { cur = { v: o[axis], items: [o] }; levels.push(cur); }
        });
        levels.forEach(function (lv, i) {
            var c = MERMAID_LEVEL_PALETTE[i % MERMAID_LEVEL_PALETTE.length];
            lv.items.forEach(function (o) {
                o.n.querySelectorAll('rect, polygon, circle, ellipse, path').forEach(function (sh) {
                    sh.style.fill = c.f;
                    sh.style.stroke = c.s;
                    sh.style.strokeWidth = '1.5px';
                });
                // Force dark label text so it stays readable on the pastel fill —
                // set both `fill` (SVG <text>) and `color` (foreignObject HTML
                // labels), since the fill would otherwise follow the light --md-text
                // in dark mode and wash out.
                o.n.querySelectorAll('text, tspan, .nodeLabel, foreignObject div, foreignObject span, foreignObject p').forEach(function (tx) {
                    tx.style.fill = '#111';
                    tx.style.color = '#111';
                    tx.setAttribute('fill', '#111');
                });
            });
        });
    } catch (e) {}
}

/* Color a sequence diagram's actors — each participant column gets its own color
   (top + bottom boxes share it), so the lanes are easy to tell apart. */
function colorMermaidActors(svg) {
    try {
        var actors = Array.prototype.slice.call(svg.querySelectorAll('rect.actor'));
        if (!actors.length) return;
        var byX = {};
        actors.forEach(function (a) {
            var x = Math.round(parseFloat(a.getAttribute('x') || '0'));
            (byX[x] = byX[x] || []).push(a);
        });
        var xkeys = Object.keys(byX).map(Number).sort(function (a, b) { return a - b; });
        xkeys.forEach(function (x, i) {
            var c = MERMAID_LEVEL_PALETTE[i % MERMAID_LEVEL_PALETTE.length];
            byX[x].forEach(function (a) {
                a.style.fill = c.f;
                a.style.stroke = c.s;
                a.style.strokeWidth = '1.5px';
            });
        });
        // Actor name labels: dark text so they read on the pastel boxes.
        svg.querySelectorAll('text.actor, text.actor > tspan').forEach(function (t) {
            t.style.fill = '#111';
            t.setAttribute('fill', '#111');
        });
    } catch (e) {}
}

/* A print-friendly Mermaid config for PDF export: a light palette that reads on
   white paper, and htmlLabels:false so labels are native SVG <text> (not
   <foreignObject> HTML — which html2canvas silently drops, leaving a blank box). */
function buildMermaidPdfConfig() {
    var accent = readCssVar('--md-accent', '#448CFF');
    var font = "'AtoZ','Pretendard Variable','Pretendard',-apple-system,BlinkMacSystemFont," +
        "'Segoe UI',Roboto,'Noto Sans KR',sans-serif";
    return {
        startOnLoad: false,
        theme: 'base',
        securityLevel: 'strict',
        fontFamily: font,
        flowchart: { curve: 'basis', htmlLabels: false, padding: 14, nodeSpacing: 46, rankSpacing: 52, useMaxWidth: true },
        sequence:  { useMaxWidth: true, mirrorActors: true, boxMargin: 10 },
        gantt:     { useMaxWidth: true },
        themeVariables: {
            fontFamily: font, fontSize: mermaidFontSizePx() + 'px',
            background: '#ffffff', primaryColor: '#ffffff', primaryBorderColor: accent,
            primaryTextColor: '#1a1a1a', secondaryColor: '#f6f8fa', secondaryBorderColor: '#c9d1d9',
            secondaryTextColor: '#1a1a1a', tertiaryColor: '#f6f8fa', tertiaryBorderColor: '#c9d1d9',
            tertiaryTextColor: '#1a1a1a', lineColor: accent, textColor: '#1a1a1a', mainBkg: '#ffffff',
            nodeBorder: accent, nodeTextColor: '#1a1a1a', clusterBkg: '#f6f8fa', clusterBorder: '#c9d1d9',
            titleColor: '#111', edgeLabelBackground: '#ffffff', labelBackground: '#ffffff',
            actorBkg: '#ffffff', actorBorder: accent, actorTextColor: '#1a1a1a', actorLineColor: '#c9d1d9',
            signalColor: '#1a1a1a', signalTextColor: '#1a1a1a', labelBoxBkgColor: '#ffffff',
            labelBoxBorderColor: accent, labelTextColor: '#1a1a1a', loopTextColor: '#1a1a1a',
            noteBkgColor: '#fff8c5', noteTextColor: '#1a1a1a', noteBorderColor: '#d4b106',
            pie1: '#3B82F6', pie2: '#22C55E', pie3: '#F59E0B', pie4: '#A855F7',
            pie5: '#F43F5E', pie6: '#06B6D4', pie7: '#EC4899', pie8: '#14B8A6',
            pie9: '#F97316', pie10: '#8B5CF6', pie11: '#10B981', pie12: '#EF4444',
            pieStrokeColor: '#ffffff', pieStrokeWidth: '2px', pieOuterStrokeColor: '#c9d1d9',
            pieSectionTextColor: '#ffffff', pieTitleTextColor: '#111'
        }
    };
}

/* Rasterize an SVG element to a white-backed PNG data URL. Uses a same-origin
   data: URI (not a Blob URL) so the canvas isn't tainted and toDataURL succeeds. */
function svgToPngDataUrl(svgEl, scale) {
    return new Promise(function (resolve, reject) {
        try {
            var clone = svgEl.cloneNode(true);
            var vb = (clone.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
            var w = 0, h = 0;
            if (vb.length === 4 && !isNaN(vb[2]) && !isNaN(vb[3])) { w = vb[2]; h = vb[3]; }
            if (!w || !h) {
                var wa = parseFloat(clone.getAttribute('width')), ha = parseFloat(clone.getAttribute('height'));
                if (!isNaN(wa) && !isNaN(ha)) { w = wa; h = ha; }
            }
            w = w || 800; h = h || 600;
            clone.removeAttribute('style');            // drop mermaid's inline max-width cap
            clone.setAttribute('width', w);
            clone.setAttribute('height', h);
            var xml = new XMLSerializer().serializeToString(clone);
            if (!/\bxmlns=/.test(xml)) xml = xml.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
            var src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
            var img = new Image();
            img.onload = function () {
                var s = scale || 2;
                var canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(w * s));
                canvas.height = Math.max(1, Math.round(h * s));
                var ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                try { resolve({ url: canvas.toDataURL('image/png'), w: w, h: h }); }
                catch (e) { reject(e); }
            };
            img.onerror = function (e) { reject(e || new Error('svg image load failed')); };
            img.src = src;
        } catch (e) { reject(e); }
    });
}

/* Before a PDF capture, swap every rendered Mermaid diagram for a rasterized
   <img>. html2canvas can't render inline SVG (esp. foreignObject labels), so a
   diagram would otherwise print as a blank box. Re-renders each from source with
   a print-light, SVG-text config. Returns a Promise of a restore() to undo it. */
function prepareMermaidForPdf(root, fit) {
    if (!root || typeof mermaid === 'undefined') return Promise.resolve(function () {});
    var wrappers = Array.prototype.slice.call(root.querySelectorAll('.mermaid-diagram'))
        .filter(function (w) { return w.dataset.mermaidSrc && w.querySelector('svg'); });
    if (!wrappers.length) return Promise.resolve(function () {});

    fit = fit || {};
    var maxW = fit.maxW || 0;      // px: fill up to the printable content width
    var maxH = fit.maxH || 0;      // px: never taller than (most of) one page
    var MAX_UPSCALE = 1.8;

    try { mermaid.initialize(buildMermaidPdfConfig()); } catch (e) {}
    var swapped = [];
    var idBase = 'mmpdf-' + (wrappers[0].id || 'x') + '-';
    var chain = Promise.resolve();

    wrappers.forEach(function (w, i) {
        chain = chain.then(function () {
            return mermaid.render(idBase + i, w.dataset.mermaidSrc).then(function (r) {
                var tmp = document.createElement('div');
                tmp.innerHTML = r.svg;
                var svgEl = tmp.querySelector('svg');
                if (!svgEl) return;
                padMermaidSvg(svgEl);            // breathing room so bottoms never clip
                colorMermaidByLevel(svgEl);      // per-level colors, same as the live view
                return svgToPngDataUrl(svgEl, 2).then(function (res) {
                    return new Promise(function (resolve) {
                        // Scale so the diagram fills the width but is never taller
                        // than (most of) one page — kept whole, never clipped.
                        // Constrain to the card's own inner width so max-width can't
                        // clamp it and distort the aspect ratio. Small diagrams get
                        // a modest upscale so they don't look tiny.
                        var cardW = Math.max(50, (w.clientWidth || maxW || res.w) - 32);
                        var effMaxW = maxW ? Math.min(maxW, cardW) : cardW;
                        var scale = 1;
                        if (res.w && res.h && effMaxW && maxH) {
                            scale = Math.min(effMaxW / res.w, maxH / res.h, MAX_UPSCALE);
                        } else if (res.w && effMaxW) {
                            scale = Math.min(effMaxW / res.w, MAX_UPSCALE);
                        }
                        if (!(scale > 0)) scale = 1;
                        var dispW = Math.round(res.w * scale);
                        var dispH = Math.round(res.h * scale);

                        var img = document.createElement('img');
                        img.className = 'mermaid-pdf-img';
                        img.style.display = 'block';
                        img.style.margin = '0 auto';
                        // max-width:100% is a safety net against right-edge overflow;
                        // height:auto keeps the aspect ratio if it ever clamps. Width
                        // drives the size (dispW is already ≤ the card width).
                        img.style.maxWidth = '100%';
                        if (dispW) { img.setAttribute('width', dispW); img.style.width = dispW + 'px'; }
                        img.style.height = 'auto';
                        var done = function () { resolve(); };
                        img.onload = done;
                        img.onerror = done;
                        img.src = res.url;
                        // Detach (not just hide) the live SVG so html2canvas can't
                        // pick it up; re-attached on restore.
                        var origSvg = w.querySelector('svg');
                        var origBtn = w.querySelector('.mermaid-zoom-btn');
                        if (origSvg && origSvg.parentNode) origSvg.parentNode.removeChild(origSvg);
                        if (origBtn) origBtn.style.display = 'none';
                        w.insertBefore(img, w.firstChild);
                        swapped.push({ wrapper: w, img: img, svg: origSvg, btn: origBtn });
                        if (img.complete) done();
                    });
                });
            }).catch(function () { /* keep original SVG for this one */ });
        });
    });

    return chain.then(function () {
        return function restoreMermaid() {
            swapped.forEach(function (s) {
                if (s.img && s.img.parentNode) s.img.parentNode.removeChild(s.img);
                if (s.svg && s.wrapper) s.wrapper.appendChild(s.svg);
                if (s.btn) s.btn.style.display = '';
            });
            swapped = [];
            try { mermaid.initialize(buildMermaidConfig()); } catch (e) {}
        };
    });
}

/* Make a rendered Mermaid diagram open in the zoom/pan overlay. Adds a hover
   "⤢" button (discoverable) and a click-to-zoom on the diagram itself. */
function addMermaidZoomAffordance(wrapper) {
    if (!wrapper || wrapper.dataset.zoomBound === '1') return;
    var svg = wrapper.querySelector('svg');
    if (!svg) return;
    wrapper.dataset.zoomBound = '1';
    wrapper.style.cursor = 'zoom-in';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mermaid-zoom-btn';
    btn.dataset.mdChrome = '1';
    btn.setAttribute('aria-label', '다이어그램 확대');
    btn.title = '확대 / 축소 · 팬';
    btn.textContent = '⤢';
    btn.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        openMermaidZoom(wrapper.querySelector('svg'));
    });
    wrapper.appendChild(btn);

    // Color on/off (흑백) toggle — sits on the diagram next to the zoom button,
    // only for diagram types that actually get colored (flowchart/class/state/
    // sequence). Toggles globally + persists; re-renders so it applies at once.
    if (svg.querySelector('g.node, rect.actor')) {
        var cbtn = document.createElement('button');
        cbtn.type = 'button';
        cbtn.className = 'mermaid-color-btn' + (_mermaidLevelColors ? ' active' : '');
        cbtn.dataset.mdChrome = '1';
        cbtn.setAttribute('aria-label', '색상 / 흑백 전환');
        cbtn.title = _mermaidLevelColors ? '흑백으로 보기' : '색상으로 보기';
        cbtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.8 A6.2 6.2 0 0 1 8 14.2 Z" fill="currentColor"/></svg>';
        cbtn.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            _mermaidLevelColors = !_mermaidLevelColors;
            lsSet('md-viewer-mermaid-colors', _mermaidLevelColors ? 'on' : 'off');
            if (typeof renderPreview === 'function') renderPreview();
        });
        wrapper.appendChild(cbtn);
    }

    wrapper.addEventListener('click', function (e) {
        if (e.target.closest('a')) return;   // let links inside the diagram work
        openMermaidZoom(wrapper.querySelector('svg'));
    });
}

function renderMermaid(container) {
    if (!container) return;
    var blocks = container.querySelectorAll('pre code.language-mermaid, pre code.lang-mermaid');
    if (blocks.length === 0) return;
    var assets = window.__lazyAssets || {};
    lazyLoadScript('mermaid', assets.mermaid).then(function () {
        if (typeof mermaid === 'undefined') return;
        var sig = mermaidThemeSig();
        if (!_mermaidInited || sig !== _mermaidThemeSig) {
            try {
                mermaid.initialize(buildMermaidConfig());
                _mermaidInited = true;
                _mermaidThemeSig = sig;
            } catch (e) {}
        }
        blocks.forEach(function (codeEl, idx) {
            var pre = codeEl.parentElement;
            if (!pre || pre.dataset.mermaidRendered) return;
            var source = codeEl.textContent || '';
            var wrapper = document.createElement('div');
            wrapper.className = 'mermaid-diagram';
            wrapper.id = 'mermaid-' + Date.now() + '-' + idx;
            wrapper.dataset.mermaidSrc = source;   // kept so PDF export can re-render to a raster
            pre.replaceWith(wrapper);

            var fallbackHtml = '<pre><code class="language-mermaid">' +
                source.replace(/&/g, '&amp;').replace(/</g, '&lt;') +
                '</code></pre>';

            try {
                mermaid.render(wrapper.id + '-svg', source).then(function (r) {
                    // Guard: wrapper might be replaced by a newer render cycle
                    if (!wrapper.isConnected) return;
                    wrapper.innerHTML = r.svg;
                    var _svg = wrapper.querySelector('svg');
                    padMermaidSvg(_svg);
                    colorMermaidByLevel(_svg);
                    addMermaidZoomAffordance(wrapper);
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
/* Turn a ":::type … :::" group raw into the admonition div + markdown body.
   Line-walker (not a lazy regex) so a bare ":::" INSIDE a code fence in the
   body can't terminate the box early. Falls back to the input unchanged if
   the group doesn't parse. */
function admonitionToHtml(groupRaw) {
    var lines = String(groupRaw).split('\n');
    var head = lines[0].match(/^:::(\w+)(?:\s+(.+))?\s*$/);
    if (!head) return groupRaw;
    var inFence = false, close = -1;
    for (var i = 1; i < lines.length; i++) {
        if (/^\s*(```|~~~)/.test(lines[i])) { inFence = !inFence; continue; }
        if (!inFence && /^:::[ \t]*$/.test(lines[i])) { close = i; break; }
    }
    if (close < 0) return groupRaw;
    var type = head[1].toLowerCase();
    var spec = ADMONITION_ICONS[type] || ADMONITION_ICONS.note;
    var t = (head[2] && head[2].trim()) || spec.label;
    var safeTitle = t.replace(/[<>&"']/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]; });
    var body = lines.slice(1, close).join('\n');
    var tail = lines.slice(close + 1).join('\n');
    return '<div class="md-admonition md-admonition-' + type + '"><div class="md-admonition-title"><span class="md-admonition-icon">' + spec.icon + '</span>' + safeTitle + '</div><div class="md-admonition-body">\n\n' + body + '\n\n</div></div>\n' + tail;
}

/* Footnotes (v0.9.0, token-based since v1.0.26) — refs and definitions are
   resolved from the pristine token raws at render time, so the saved source
   keeps the [^id] syntax. */
var FOOTNOTE_DEF_RE = /^\[\^([^\]]+)\]:\s*(.+(?:\n[ \t]+.+)*)$/gm;
function collectFootnotes(tokens) {
    var defs = {};
    var pureDefTokens = [];
    tokens.forEach(function (t, i) {
        // 'space' included: a single-word def like "[^1]: Note." parses as
        // a link REFERENCE definition and marked swallows it — it reaches
        // us as a synthetic source-preserving space token.
        if (t.type !== 'paragraph' && t.type !== 'text' && t.type !== 'space') return;
        var raw = t.raw || '';
        var found = false;
        var stripped = raw.replace(FOOTNOTE_DEF_RE, function (_, id, content) {
            defs[id] = content.replace(/\n[ \t]+/g, ' ').trim();
            found = true;
            return '';
        });
        if (found && stripped.trim() === '') pureDefTokens.push(i);
    });
    if (Object.keys(defs).length === 0) return null;
    // Reference order + total count per id, scanning raws in document order
    // (skipping code fences and the definition lines themselves).
    var order = [], refCount = {};
    tokens.forEach(function (t) {
        if (t.type === 'code') return;
        var raw = (t.raw || '').replace(FOOTNOTE_DEF_RE, '');
        raw.replace(/\[\^([^\]]+)\]/g, function (m, id) {
            if (!defs[id]) return m;
            if (order.indexOf(id) < 0) order.push(id);
            refCount[id] = (refCount[id] || 0) + 1;
            return m;
        });
    });
    var defTokens = {};
    pureDefTokens.forEach(function (idx, n) { defTokens[idx] = (n === 0); });
    return {
        defs: defs, order: order, refCount: refCount,
        defTokens: defTokens, hasSection: pureDefTokens.length > 0,
        seen: {}    // running per-render occurrence counters for ref ids
    };
}
/* Run `replace` only on rendered TEXT — skipping <pre>/<code> spans and the
   inside of tags (attributes like alt="…[^1]…" must never be rewritten). */
function replaceInRenderedText(html, replace) {
    var segs = String(html).split(/(<(?:pre|code)\b[\s\S]*?<\/(?:pre|code)>)/i);
    for (var s = 0; s < segs.length; s += 2) {
        var parts = segs[s].split(/(<[^>]*>)/);
        for (var t = 0; t < parts.length; t += 2) parts[t] = replace(parts[t]);
        segs[s] = parts.join('');
    }
    return segs.join('');
}

function renderFootnoteRefs(html, fns) {
    if (!fns || !fns.order.length) return html;
    return replaceInRenderedText(html, function (text) {
        return text.replace(/\[\^([^\]]+)\]/g, function (m, id) {
            if (!fns.defs[id] || fns.order.indexOf(id) < 0) return m;
            fns.seen[id] = (fns.seen[id] || 0) + 1;
            var num = fns.order.indexOf(id) + 1;
            return '<sup class="footnote-ref" id="fnref-' + id + '-' + fns.seen[id] +
                '"><a href="#fn-' + id + '">' + num + '</a></sup>';
        });
    });
}
function renderFootnoteSection(fns) {
    if (!fns || !fns.order.length) return '';
    var html = '<hr/><section class="footnotes"><ol>';
    fns.order.forEach(function (id) {
        var c = fns.refCount[id] || 1, backlinks = '';
        for (var k = 1; k <= c; k++) backlinks += ' <a class="footnote-backref" href="#fnref-' + id + '-' + k + '">↩</a>';
        html += '<li id="fn-' + id + '">' + fns.defs[id] + backlinks + '</li>';
    });
    return html + '</ol></section>';
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

// Unified slugify (preserves Hangul). Used by both buildTocHtml and addHeadingIds.
function slugify(text) {
    return 'heading-' + String(text || '').toLowerCase()
        .replace(/[`*_~]/g, '')
        .replace(/[^\w\s\-가-힣ㄱ-ㅎㅏ-ㅣ]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 60);
}

/* [[TOC]] / [[목차]] table of contents (token-based since v1.0.26) —
   built from the heading tokens at render time; the marker stays in the
   token raw and therefore in the saved source. */
function buildTocHtml(tokens) {
    var headings = [], seen = {};
    var fmSpan = frontmatterSpanAt(tokens || []);
    (tokens || []).forEach(function (t, ti) {
        if (ti < fmSpan) return;   // "title: x\n---" in frontmatter lexes as a phantom setext heading
        if (t.type !== 'heading' || t.depth > 4) return;
        var text = String(t.text || '').replace(/[`*_~]/g, '').trim();
        if (!text || /\[\[(TOC|목차)\]\]/i.test(text)) return;
        var slug = slugify(text);
        if (seen[slug] != null) {
            seen[slug]++;
            slug = slug + '-' + seen[slug];
        } else {
            seen[slug] = 1;
        }
        headings.push({ level: t.depth, text: text, slug: slug });
    });
    if (headings.length === 0) return '';
    var toc = ['<div class="md-toc"><div class="md-toc-title">목차 / Table of Contents</div><ul>'];
    headings.forEach(function (h) {
        toc.push('<li class="md-toc-level-' + h.level + '"><a href="#' + h.slug + '">' + h.text + '</a></li>');
    });
    toc.push('</ul></div>');
    return toc.join('');
}

/* A source line that marked renders as a task-list checkbox. Must accept
   every variant the renderer accepts — blockquoted ("> - [ ]"), numbered
   ("1. [ ]"), nested — or the DOM order and the source order drift apart
   and clicking a box toggles the WRONG line (or silently nothing). */
var TASK_LINE_RE = /^((?:\s*>\s*)*\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](\s)/;

function makeCheckboxesClickable() {
    if (!previewEl) return;
    var idx = 0;
    previewEl.querySelectorAll('input[type="checkbox"]').forEach(function (box) {
        // Only task-list boxes map to a source line. Raw-HTML checkboxes
        // (outside <li>) stay read-only so they can't shift the mapping.
        if (!box.closest('li')) return;
        var myIdx = idx++;
        box.disabled = false;
        box.style.cursor = 'pointer';
        box.addEventListener('change', function () {
            toggleCheckboxInSource(myIdx, box.checked);
        });
    });
}

function toggleCheckboxInSource(index, checked) {
    // Find the Nth checkbox in the source markdown and toggle it.
    // CRITICAL: skip lines inside fenced code blocks so we don't corrupt code examples.
    var lines = currentContent.split('\n');
    var found = 0;
    var inFence = false;
    var applied = false;
    for (var i = 0; i < lines.length; i++) {
        // Track fenced code blocks (``` / ~~~)
        if (/^\s*(```|~~~)/.test(lines[i])) { inFence = !inFence; continue; }
        if (inFence) continue;
        var m = lines[i].match(TASK_LINE_RE);
        if (m) {
            if (found === index) {
                lines[i] = lines[i].replace(TASK_LINE_RE, function (_, pre, _mark, post) {
                    return pre + '[' + (checked ? 'x' : ' ') + ']' + post;
                });
                applied = true;
                break;
            }
            found++;
        }
    }
    if (!applied) {
        // Mapping drifted (shouldn't happen) — re-render so the DOM box
        // never lies about what's in the file.
        renderPreview();
        return;
    }
    currentContent = lines.join('\n');
    if (editorEl) editorEl.value = currentContent;
    // Keep the token raws in sync without a full re-render (the checkbox
    // DOM is already correct) — a later commit would otherwise join STALE
    // raws and silently revert this toggle in the saved file.
    _currentTokens = lexPreservingSource(currentContent);
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

var _mermaidFontTimer = null;
function changeFontSize(delta) {
    var currentSize = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--md-font-size') || '16');
    var newSize = Math.max(12, Math.min(24, currentSize + delta));
    document.documentElement.style.setProperty('--md-font-size', newSize + 'px');
    if (fontSizeDisplayEl) fontSizeDisplayEl.textContent = Math.round(newSize);
    lsSet('md-viewer-font-size', newSize + 'px');
    // Mermaid renders to a fixed-size SVG, so it won't reflow with the CSS font
    // var — re-render the diagrams (debounced) so their labels track the size too.
    if (document.querySelector('.mermaid-diagram')) {
        if (_mermaidFontTimer) clearTimeout(_mermaidFontTimer);
        _mermaidFontTimer = setTimeout(function () {
            if (typeof renderPreview === 'function') renderPreview();
        }, 180);
    }
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

    // Prepare the LIVE preview for capture. html2canvas reads computed styles
    // AND ::before/::after pseudo content from the ORIGINAL (live) nodes, not
    // the clone — so hiding the disclosure triangle / external-link arrow and
    // expanding collapsed <details> must happen here, on the live DOM, and be
    // undone afterwards. (body.exporting-pdf CSS drives the pseudo hiding.)
    var _closedDetails = [];
    element.querySelectorAll('details:not([open])').forEach(function (d) {
        _closedDetails.push(d);
        d.setAttribute('open', '');
    });
    document.body.classList.add('exporting-pdf');

    // Resolve margin preset to mm tuple [top, left, bottom, right]
    var marginPresets = {
        narrow: [10, 10, 14, 10],
        normal: [18, 18, 22, 18],
        wide: [25, 25, 28, 25]
    };
    var marginMm = marginPresets[userOpts.margin] || marginPresets.normal;
    var paperFormat = userOpts.paperSize === 'letter' ? 'letter' : 'a4';
    var pageOrient = userOpts.orientation === 'landscape' ? 'landscape' : 'portrait';

    var _mermaidRestore = function () {};
    var restore = function () {
        document.body.classList.remove('exporting-pdf');
        _closedDetails.forEach(function (d) { d.removeAttribute('open'); });
        _closedDetails = [];
        try { _mermaidRestore(); } catch (e) {}
        _mermaidRestore = function () {};
    };

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

    // Let the live preview's async Mermaid renders settle first, THEN rasterize
    // each diagram to a PNG <img> (html2canvas can't capture inline SVG — esp.
    // foreignObject labels — so a diagram would print blank). Running the swap
    // after the settle delay avoids a race where an in-flight live render wipes
    // the swapped <img>. Rasterization failure never blocks the export.
    // Fit box for diagrams: fill the printable width, but cap height well under
    // one page so a tall flowchart stays whole (never clipped) AND can share a
    // page with the title/text instead of getting bumped to its own page (which
    // is what left the big blank gap).
    var _pageWmm = paperFormat === 'letter' ? 215.9 : 210;
    var _pageHmm = paperFormat === 'letter' ? 279.4 : 297;
    if (pageOrient === 'landscape') { var _t = _pageWmm; _pageWmm = _pageHmm; _pageHmm = _t; }
    var _printWmm = _pageWmm - marginMm[1] - marginMm[3];
    var _printHmm = _pageHmm - marginMm[0] - marginMm[2];
    var _contentWpx = element.clientWidth || 760;
    var _pxPerMm = _contentWpx / _printWmm;
    var _fit = { maxW: _contentWpx, maxH: _printHmm * _pxPerMm * 0.56 };

    setTimeout(function () {
    prepareMermaidForPdf(element, _fit).then(function (mr) { _mermaidRestore = mr; }, function () {}).then(function () {
        var opt = {
            margin: marginMm,
            filename: fileName,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: {
                scale: 2,
                useCORS: true,
                logging: false,
                backgroundColor: '#ffffff',
                // NOTE: no fixed `height`/`windowHeight` — pinning the capture
                // height mis-paginates tall rasterized diagrams (blank/split pages).
                // html2canvas auto-measures the element's full height correctly.
                onclone: function (clonedDoc) {
                    // Remove all editing chrome (＋ ⠿ ✎ handles, edit icons,
                    // ✓/✕ buttons, toolbars, popups) so it never prints. The
                    // CSS meant to hide it keyed on body.exporting-pdf, but
                    // that class was never actually applied — add it here too
                    // so the rest of the print rules (table-scroll unwrap,
                    // code-block header, block padding) finally take effect.
                    clonedDoc.querySelectorAll('[data-md-chrome="1"]').forEach(function (n) {
                        if (n.parentNode) n.parentNode.removeChild(n);
                    });
                    // NOTE: <details> expansion and the triangle/arrow hiding are
                    // done on the LIVE DOM before capture (see _runPdfExport),
                    // because html2canvas reads computed styles + ::before/::after
                    // pseudo content from the ORIGINAL nodes, not this clone.
                    // Force light theme on cloned body so CSS variables resolve to light values
                    var b = clonedDoc.body;
                    if (b) {
                        b.classList.add('exporting-pdf');
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
                        // <details> print as normal boxes; the summary is the box heading
                        '#preview details { break-inside:avoid !important; page-break-inside:avoid !important; }',
                        '#preview summary { font-weight:700 !important; }'
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
    });
    }, 250);
}

var _toastTimers = [];
function showToast(message) {
    var existing = document.querySelector('.md-toast');
    // Same message re-fired while visible: extend its life instead of
    // flicker-recreating (repeated ops spam the same toast).
    if (existing && existing.textContent === message) {
        _toastTimers.forEach(clearTimeout);
        existing.classList.add('show');
    } else {
        if (existing) existing.remove();
        existing = document.createElement('div');
        existing.className = 'md-toast';
        existing.textContent = message;
        document.body.appendChild(existing);
        _toastTimers.forEach(clearTimeout);
        _toastTimers = [setTimeout(function () { existing.classList.add('show'); }, 10)];
    }
    var el = existing;
    _toastTimers.push(setTimeout(function () {
        el.classList.remove('show');
        setTimeout(function () { el.remove(); }, 200);
    }, 1500));
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
var _pendingSaveContent = null;
function saveToDocument(content) {
    clearTimeout(window._saveTimer);
    setSaveState('saving');
    _pendingSaveContent = content;
    window._saveTimer = setTimeout(function () {
        _pendingSaveContent = null;
        vscodeApi.postMessage({ type: 'edit', content: content });
        setSaveState('saved');
    }, 300);
}
/* Send any debounced-but-unsent edit NOW — the webview may be about to be
   hidden or torn down, and a 300ms timer wouldn't survive that. */
function flushPendingSave() {
    if (_pendingSaveContent == null) return false;
    clearTimeout(window._saveTimer);
    var content = _pendingSaveContent;
    _pendingSaveContent = null;
    vscodeApi.postMessage({ type: 'edit', content: content });
    setSaveState('saved');
    return true;
}
if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushPendingSave);
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') flushPendingSave();
    });
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
function isTypingTarget(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}

/* Keyboard shortcut help overlay — toggled with "?" */
var _helpOverlayEl = null;
function toggleShortcutHelp() {
    if (_helpOverlayEl) { closeShortcutHelp(); return; }
    var ROWS = [
        ['✎ / ＋ / ⠿', '블록 편집 · 삽입 · 이동 메뉴 (블록에 마우스 올리면 왼쪽에 표시)'],
        ['/', '빈 블록 편집 중 블록 타입 변환 메뉴'],
        ['Cmd/Ctrl + Enter', '편집 저장'],
        ['ESC', '편집 취소 · 메뉴/검색/도움말 닫기'],
        ['Cmd/Ctrl + Z', '편집 되돌리기 (Preview)'],
        ['Cmd/Ctrl + Shift + Z', '다시 실행 (Preview)'],
        ['Cmd/Ctrl + S', '즉시 저장'],
        ['Cmd/Ctrl + F', '찾기 (Preview 검색 / 편집 찾기·바꾸기)'],
        ['Cmd/Ctrl + E', 'Preview ↔ Edit 전환'],
        ['Enter / Shift+Enter', '표 셀: 아래/위 셀로 이동'],
        ['Tab / Shift+Tab', '표 셀: 다음/이전 셀로 이동'],
        ['?', '이 도움말']
    ];
    var overlay = document.createElement('div');
    overlay.className = 'md-help-overlay';
    overlay.dataset.mdChrome = '1';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', '키보드 단축키');
    var card = document.createElement('div');
    card.className = 'md-help-card';
    var title = document.createElement('div');
    title.className = 'md-help-title';
    title.textContent = '⌨️ 키보드 단축키';
    card.appendChild(title);
    ROWS.forEach(function (r) {
        var row = document.createElement('div');
        row.className = 'md-help-row';
        var k = document.createElement('kbd');
        k.textContent = r[0];
        var d = document.createElement('span');
        d.textContent = r[1];
        row.appendChild(k);
        row.appendChild(d);
        card.appendChild(row);
    });
    var hint = document.createElement('div');
    hint.className = 'md-help-hint';
    hint.textContent = 'ESC 또는 바깥 클릭으로 닫기';
    card.appendChild(hint);
    overlay.appendChild(card);
    overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeShortcutHelp();
    });
    document.body.appendChild(overlay);
    _helpOverlayEl = overlay;
}
function closeShortcutHelp() {
    if (_helpOverlayEl && _helpOverlayEl.parentNode) _helpOverlayEl.parentNode.removeChild(_helpOverlayEl);
    _helpOverlayEl = null;
}

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', function (e) {
        var mod = e.metaKey || e.ctrlKey;
        // ESC closes lightbox / preview search / block popup before anything else
        if (e.key === 'Escape') {
            if (_helpOverlayEl) { e.preventDefault(); closeShortcutHelp(); return; }
            if (_lightboxEl) { e.preventDefault(); closeLightbox(); return; }
            if (_previewSearchPanel && _previewSearchPanel.style.display !== 'none') {
                e.preventDefault(); closePreviewSearch(); return;
            }
            if (_blockPopupEl) { e.preventDefault(); closeBlockPopup(); return; }
        }
        // Cmd/Ctrl+F: preview-mode search; edit/split → existing Find&Replace
        if (mod && (e.key === 'f' || e.key === 'F')) {
            e.preventDefault();
            if (currentMode === 'preview') openPreviewSearch();
            else openFindReplace();
            return;
        }
        // Cmd/Ctrl+Z in Preview → undo last inline edit
        if (mod && !e.shiftKey && (e.key === 'z' || e.key === 'Z') && currentMode === 'preview' && !_activeBlockEdit) {
            if (undoInlineEdit()) { e.preventDefault(); return; }
        }
        // Cmd/Ctrl+Shift+Z or Ctrl+Y in Preview → redo
        if (((mod && e.shiftKey && (e.key === 'z' || e.key === 'Z')) ||
             (e.ctrlKey && !e.metaKey && (e.key === 'y' || e.key === 'Y'))) &&
            currentMode === 'preview' && !_activeBlockEdit) {
            if (redoInlineEdit()) { e.preventDefault(); return; }
        }
        // Cmd/Ctrl+S → flush the debounced save immediately, everywhere
        if (mod && (e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            if (flushPendingSave()) showToast('저장됨');
            return;
        }
        // ? → keyboard shortcut help (only when not typing anywhere)
        if (e.key === '?' && !mod && !_activeBlockEdit && !isTypingTarget(document.activeElement)) {
            e.preventDefault();
            toggleShortcutHelp();
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

    // Editing hint — pencil edits in place, double-click jumps to source
    var hint = document.createElement('div');
    hint.className = 'dblclick-hint';
    hint.textContent = '✎ 블록 편집 · 더블클릭 시 소스 편집';
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
var _lastUpdateRenderAt = 0;
function setupMessageListener() {
    window.addEventListener('message', function (e) {
        var msg = e.data;
        if (msg.type === 'update') {
            // The document changed underneath us — a still-open inline
            // editor now points at stale tokens; committing it would write
            // old content into the wrong block. Discard it (external
            // content wins), then render the new state. A pending debounced
            // save or queued editor-open timer would likewise replay stale
            // webview state over the external edit — cancel them. Undo
            // snapshots predate the external content, so popping one would
            // clobber it: drop the stack (the text document's own undo
            // still covers those edits).
            if (_activeBlockEdit) closeBlockEditor(false);
            clearTimeout(window._saveTimer);
            _pendingSaveContent = null;   // a later flush must not replay stale content
            setSaveState('saved');
            _externalGen++;
            _editHistory.length = 0;
            _redoHistory.length = 0;
            resetBlockChrome();   // popups anchored to old indexes die NOW, not at render time
            currentContent = msg.content;
            if (editorEl && document.activeElement !== editorEl) {
                editorEl.value = currentContent;
            }
            if (currentMode === 'preview' || currentMode === 'split') {
                // Typing in a split source tab streams one update per
                // keystroke — a full preview rebuild each time janks. Render
                // the first one immediately, coalesce a storm into one
                // trailing render (tokens are nulled meanwhile so no
                // structural op can commit stale raws).
                var now = Date.now();
                if (now - _lastUpdateRenderAt > 250 && !window._updateRenderTimer) {
                    _lastUpdateRenderAt = now;
                    renderPreview();
                } else {
                    _currentTokens = null;
                    clearTimeout(window._updateRenderTimer);
                    window._updateRenderTimer = setTimeout(function () {
                        window._updateRenderTimer = null;
                        _lastUpdateRenderAt = Date.now();
                        renderPreview();
                    }, 160);
                }
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
            // Only follow the setting if the user hasn't set a local override.
            if (msg.settings && typeof msg.settings.mermaidLevelColors === 'boolean'
                && lsGet('md-viewer-mermaid-colors') == null
                && msg.settings.mermaidLevelColors !== _mermaidLevelColors) {
                _mermaidLevelColors = msg.settings.mermaidLevelColors;
                if (typeof renderPreview === 'function') renderPreview();
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

    // Mermaid per-level colors (saved override > setting > default on)
    var savedMmColors = lsGet('md-viewer-mermaid-colors');
    if (savedMmColors === 'off') _mermaidLevelColors = false;
    else if (savedMmColors === 'on') _mermaidLevelColors = true;
    else if (typeof settings.mermaidLevelColors === 'boolean') _mermaidLevelColors = settings.mermaidLevelColors;

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
