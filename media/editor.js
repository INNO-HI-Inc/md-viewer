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

    // Override html rendering — escape all raw HTML to prevent XSS
    renderer.html = function (token) {
        var raw = token.text || token.raw || '';
        return escapeAttr(raw);
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
    return html;
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
    var html = renderMarkdown(currentContent);
    previewEl.innerHTML = html;
    highlightCodeBlocks(previewEl);
    addHeadingIds();
    buildOutline(html);
    makeCheckboxesClickable();
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
function onEditorInput() {
    if (!editorEl) return;
    currentContent = editorEl.value;
    updateStats();
    if (currentMode === 'split') {
        renderPreview();
    }
    saveToDocument(currentContent);
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
    window._saveTimer = setTimeout(function () {
        vscodeApi.postMessage({ type: 'edit', content: content });
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
    { id: 'orchid',  label: 'Orchid',  color: '#B48AC7' }
];

var currentTheme = 'blue';

function applyTheme(themeId) {
    currentTheme = themeId;
    if (themeId === 'blue') {
        document.body.removeAttribute('data-theme');
    } else {
        document.body.setAttribute('data-theme', themeId);
    }
    localStorage.setItem('md-viewer-theme', themeId);

    // Update picker dot + dropdown active states
    var currentDot = document.querySelector('.theme-dot-current');
    if (currentDot) {
        var theme = themes.find(function (t) { return t.id === themeId; });
        if (theme) currentDot.style.background = theme.color;
    }
    document.querySelectorAll('.theme-dot').forEach(function (dot) {
        dot.classList.toggle('active', dot.dataset.theme === themeId);
    });
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

    themes.forEach(function (t) {
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

    btn.addEventListener('click', function (e) {
        e.stopPropagation();
        dropdown.classList.toggle('open');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', function () {
        dropdown.classList.remove('open');
    });

    picker.appendChild(btn);
    picker.appendChild(dropdown);
    return picker;
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

    var toolbarItems = [
        { action: 'h1', label: 'H1', title: 'Heading 1' },
        { action: 'h2', label: 'H2', title: 'Heading 2' },
        { action: 'h3', label: 'H3', title: 'Heading 3' },
        { action: 'divider' },
        { action: 'bold', label: 'B', title: 'Bold (Cmd+B)', cls: 'bold-btn' },
        { action: 'italic', label: 'I', title: 'Italic (Cmd+I)', cls: 'italic-btn' },
        { action: 'code', label: '<>', title: 'Code (Cmd+Shift+C)', cls: 'code-btn' },
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

    editorWrap.appendChild(lineNumbersEl);
    editorWrap.appendChild(editorEl);
    editorPane.appendChild(editorWrap);

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

    statsRightEl = document.createElement('span');
    statsRightEl.className = 'stats-right';

    statusbar.appendChild(statsLeftEl);
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
    applyTheme(currentTheme);
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
