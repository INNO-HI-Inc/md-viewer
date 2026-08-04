const vscode = require('vscode');
const path = require('path');

// The webview panel of the currently-focused pretty editor. Toolbar commands
// (bold/italic/code/toggleMode) route here ONLY — broadcasting to every open
// editor would run the command in unfocused documents and, with auto-save,
// silently corrupt files the user never touched.
let activePanel = null;

function postToActive(type, payload) {
    if (!activePanel) return;
    try {
        const p = activePanel.webview.postMessage({ type, ...payload });
        if (p && typeof p.then === 'function') p.then(undefined, () => {});
    } catch (_) { /* panel disposed */ }
}

function getNonce() {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += chars[Math.floor(Math.random() * chars.length)];
    }
    return text;
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function getHtml(webview, nonce, context, document, docBaseUri, settings) {
    const mediaUri = (file) => webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'media', file)
    );
    const fileName = path.basename(document.uri.fsPath);
    const content = document.getText();
    const initialMode = settings.defaultMode || 'preview';

    return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src ${webview.cspSource} https: http: data: file:; font-src ${webview.cspSource} https:;">
    <link rel="stylesheet" href="${mediaUri('editor.css')}">
    <link rel="stylesheet" href="${mediaUri('katex.min.css')}">
    <title>${escapeHtml(fileName)}</title>
</head>
<body class="mode-${initialMode}">
    <div id="app"></div>
    <script nonce="${nonce}" src="${mediaUri('marked.min.js')}"></script>
    <script nonce="${nonce}" src="${mediaUri('turndown.min.js')}"></script>
    <script nonce="${nonce}" src="${mediaUri('katex.min.js')}"></script>
    <script nonce="${nonce}" src="${mediaUri('katex-auto-render.min.js')}"></script>
    <script nonce="${nonce}" src="${mediaUri('highlight.min.js')}"></script>
    <script nonce="${nonce}" src="${mediaUri('editor.js')}"></script>
    <script nonce="${nonce}">
        // Lazy-loaded heavy libraries: paths passed in for on-demand <script> injection
        window.__lazyAssets = {
            mermaid: ${JSON.stringify(mediaUri('mermaid.min.js').toString())},
            html2pdf: ${JSON.stringify(mediaUri('html2pdf.bundle.min.js').toString())},
            nonce: ${JSON.stringify(nonce)}
        };
        initEditor(${JSON.stringify(content)}, ${JSON.stringify(fileName)}, ${JSON.stringify(docBaseUri.toString())}, ${JSON.stringify(settings)});
    </script>
</body>
</html>`;
}

function readSettings() {
    const config = vscode.workspace.getConfiguration('mdPrettyViewer');
    return {
        defaultTheme: config.get('defaultTheme', 'blue'),
        defaultFontSize: config.get('defaultFontSize', 16),
        defaultMode: config.get('defaultMode', 'preview'),
        showOutline: config.get('showOutline', false),
        mermaidLevelColors: config.get('mermaidLevelColors', true)
    };
}

/* ───────────────────────────────────────────
   Custom text editor — VS Code resolves .md files straight into this
   webview (no raw-text flicker, no tab-swap timing race). Because it is
   backed by the real TextDocument, VS Code owns the tab lifecycle; we only
   render the webview and keep it in sync with the document both ways.
   ─────────────────────────────────────────── */
const VIEW_TYPE = 'mdPrettyViewer.editor';

class MdPrettyEditorProvider {
    constructor(context) {
        this.context = context;
    }

    resolveCustomTextEditor(document, webviewPanel, _token) {
        const context = this.context;
        const webview = webviewPanel.webview;
        const uri = document.uri;
        const docDir = vscode.Uri.joinPath(uri, '..');

        webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(context.extensionUri, 'media'),
                docDir,
                ...(vscode.workspace.workspaceFolders || []).map(f => f.uri)
            ]
        };

        // Track focus so toolbar commands hit only this editor when it's active.
        if (webviewPanel.active) activePanel = webviewPanel;
        const viewStateSub = webviewPanel.onDidChangeViewState(() => {
            if (webviewPanel.active) activePanel = webviewPanel;
            else if (activePanel === webviewPanel) activePanel = null;
        });

        const docBaseUri = webview.asWebviewUri(docDir);
        const nonce = getNonce();
        webview.html = getHtml(webview, nonce, context, document, docBaseUri, readSettings());

        let isDisposed = false;
        // Provenance guard: while we apply a webview edit AND persist it, VS
        // Code fires onDidChangeTextDocument for our own change — plus, if
        // files.insertFinalNewline / trimTrailingWhitespace is on, a save
        // participant fires ANOTHER change with normalized text. Content
        // comparison can't recognize the normalized one, so gate on
        // provenance (a depth counter, robust to overlapping edits) instead:
        // ignore every change event that lands inside our own apply+save.
        let applyingDepth = 0;

        const safePost = (msg) => {
            if (isDisposed) return;
            try {
                const p = webview.postMessage(msg);
                if (p && typeof p.then === 'function') p.then(undefined, () => {});
            } catch (_) { /* webview disposed mid-call */ }
        };

        // Document → webview (external edits: split-view typing, git checkout,
        // formatter, another window). Never bounce our own apply/save back.
        const changeDocSub = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() !== uri.toString()) return;
            if (applyingDepth > 0) return;
            safePost({ type: 'update', content: e.document.getText() });
        });

        // Settings → webview
        const configSub = vscode.workspace.onDidChangeConfiguration(e => {
            if (!e.affectsConfiguration('mdPrettyViewer')) return;
            const cfg = vscode.workspace.getConfiguration('mdPrettyViewer');
            safePost({
                type: 'configChange',
                settings: {
                    defaultTheme: cfg.get('defaultTheme'),
                    defaultFontSize: cfg.get('defaultFontSize'),
                    defaultMode: cfg.get('defaultMode'),
                    showOutline: cfg.get('showOutline'),
                    mermaidLevelColors: cfg.get('mermaidLevelColors')
                }
            });
        });

        // Webview → document. Apply as a WorkspaceEdit so VS Code records it on
        // the native undo stack, then persist (preserving the extension's
        // long-standing auto-save behaviour).
        const msgSub = webview.onDidReceiveMessage(async msg => {
            if (!msg || isDisposed) return;
            if (msg.type === 'openLink') {
                openLinkFromWebview(String(msg.href || ''), uri);
                return;
            }
            if (msg.type !== 'edit') return;
            if (document.getText() === msg.content) return;   // no-op
            const fullRange = new vscode.Range(
                new vscode.Position(0, 0),
                new vscode.Position(document.lineCount, 0)
            );
            const edit = new vscode.WorkspaceEdit();
            edit.replace(uri, fullRange, msg.content);
            applyingDepth++;
            try {
                const ok = await vscode.workspace.applyEdit(edit);
                if (ok && !isDisposed) {
                    await document.save();
                } else if (!ok && !isDisposed) {
                    // applyEdit signals rejection by resolving false (stale
                    // version / conflicting edit), not by throwing — re-sync
                    // the webview so it doesn't keep diverged phantom content.
                    safePost({ type: 'update', content: document.getText() });
                }
            } catch (err) {
                console.error('MD Pretty Viewer: edit apply failed', err);
                // Persisting failed — re-sync the webview to what's really on
                // disk so it doesn't keep showing an unsaved phantom state.
                if (!isDisposed) safePost({ type: 'update', content: document.getText() });
            } finally {
                applyingDepth--;
            }
        });

        webviewPanel.onDidDispose(() => {
            isDisposed = true;
            if (activePanel === webviewPanel) activePanel = null;
            viewStateSub.dispose();
            changeDocSub.dispose();
            configSub.dispose();
            msgSub.dispose();
        });
    }
}

function isMarkdownFile(uri) {
    return /\.(md|markdown|mdown|mkd)$/i.test(uri.fsPath);
}

/* Open a link the user clicked inside the rendered markdown. URLs (http/https/
   mailto/…) open externally; a relative or absolute path (optionally with a
   #fragment) is resolved against the document's folder and opened as a file —
   so a link to another .md opens in the pretty viewer too. */
function openLinkFromWebview(href, docUri) {
    if (!href) return;
    // Absolute URL with a scheme → open externally (openExternal prompts for
    // untrusted sites and safely ignores javascript:/etc.).
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
        try { vscode.env.openExternal(vscode.Uri.parse(href)).then(undefined, () => {}); } catch (_) {}
        return;
    }
    // Workspace file path (drop any #fragment — file links can't target anchors).
    let path = href;
    const hash = path.indexOf('#');
    if (hash >= 0) path = path.slice(0, hash);
    if (!path) return;
    let target;
    try {
        target = path.charAt(0) === '/'
            ? vscode.Uri.file(path)
            : vscode.Uri.joinPath(docUri, '..', path);
    } catch (_) { return; }
    vscode.commands.executeCommand('vscode.open', target).then(undefined, () => {
        vscode.window.showWarningMessage('MD Pretty Viewer: 링크한 파일을 열 수 없습니다 — ' + href);
    });
}

/* Respect a deliberate global preference for the built-in text editor:
   if the user pinned markdown to "default" via workbench.editorAssociations,
   we never auto-convert their text tabs. */
function userPinnedMarkdownToText() {
    let assoc;
    try {
        assoc = vscode.workspace.getConfiguration('workbench').get('editorAssociations') || {};
    } catch (_) { return false; }
    return Object.keys(assoc).some(glob =>
        /\*\.(md|markdown|mdown|mkd)\b/i.test(glob) && assoc[glob] === 'default');
}

/* Re-open markdown files that landed in a PLAIN TEXT tab into the pretty
   editor. priority:"default" covers Explorer / Quick Open / terminal clicks,
   but window.showTextDocument — which Claude Code's chat file links use —
   forces the text editor and bypasses custom editors entirely. This sweep is
   the safety net for that path (and for the cold-start race).

   Re-entrancy is the danger here: our own vscode.openWith fires the very tab
   events that trigger this sweep. With two markdown files that turned into an
   endless focus ping-pong between them. Three guards prevent it:
     1. `_convertAttempted` — each uri is converted at most once per tab
        lifetime (cleared only when that file's tab is gone), so a failed or
        slow conversion can never be retried in a loop.
     2. a debounce, so the burst of events one conversion emits collapses into
        a single later pass.
     3. preserveFocus, so replacing a background tab never steals focus. */
const _convertAttempted = new Set();
let _convertTimer = null;

function reopenMarkdownTextTabs() {
    if (userPinnedMarkdownToText()) return;
    if (_convertTimer) return;                 // a pass is already scheduled
    _convertTimer = setTimeout(() => {
        _convertTimer = null;
        const openUris = new Set();
        const pending = [];
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                const uri = tab.input && tab.input.uri;
                if (!uri) continue;
                openUris.add(uri.toString());
                if (tab.input instanceof vscode.TabInputText &&
                    uri.scheme === 'file' && isMarkdownFile(uri)) {
                    pending.push({ uri, column: tab.group.viewColumn });
                }
            }
        }
        // Forget files whose tabs are gone, so opening them again later works.
        for (const key of Array.from(_convertAttempted)) {
            if (!openUris.has(key)) _convertAttempted.delete(key);
        }
        for (const item of pending) {
            const key = item.uri.toString();
            if (_convertAttempted.has(key)) continue;   // already handled once
            _convertAttempted.add(key);
            vscode.commands.executeCommand(
                'vscode.openWith', item.uri, VIEW_TYPE,
                { viewColumn: item.column, preserveFocus: true }
            ).then(undefined, () => {});
        }
    }, 120);
}

/* The uri of the markdown file in the active tab — works for both our custom
   editor tabs (TabInputCustom) and plain text tabs (TabInputText). */
function activeMarkdownUri() {
    const group = vscode.window.tabGroups.activeTabGroup;
    const input = group && group.activeTab && group.activeTab.input;
    if (input && input.uri && isMarkdownFile(input.uri)) return input.uri;
    const ed = vscode.window.activeTextEditor;
    if (ed && isMarkdownFile(ed.document.uri)) return ed.document.uri;
    return undefined;
}

function showUpdateNotification(context) {
    const currentVersion = context.extension.packageJSON.version;
    const previousVersion = context.globalState.get('mdPrettyViewer.lastVersion');

    if (previousVersion && previousVersion !== currentVersion) {
        const message = `🎉 MD Pretty Viewer ${currentVersion} 업데이트됨!`;
        vscode.window.showInformationMessage(
            message,
            '변경 사항 보기',
            '닫기'
        ).then(selection => {
            if (selection === '변경 사항 보기') {
                vscode.env.openExternal(
                    vscode.Uri.parse(`https://github.com/INNO-HI-Inc/md-viewer/releases/tag/v${currentVersion}`)
                );
            }
        });
    }

    context.globalState.update('mdPrettyViewer.lastVersion', currentVersion);
}

function activate(context) {
    showUpdateNotification(context);

    // Register the pretty viewer as the default editor for markdown. VS Code
    // now routes every association-respecting open (Explorer, Quick Open,
    // vscode.open — which is what Claude Code's chat file-links use — terminal
    // Ctrl+click, tab restore) straight into this editor.
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(
            VIEW_TYPE,
            new MdPrettyEditorProvider(context),
            {
                webviewOptions: { retainContextWhenHidden: true, enableFindWidget: true },
                supportsMultipleEditorsPerDocument: false
            }
        )
    );

    // Safety net for opens that bypass the default custom editor — most
    // importantly Claude Code's chat file links, which use showTextDocument
    // (a text-editor-only API). Whenever a markdown file shows up in a plain
    // text tab, re-open it in the pretty editor.
    context.subscriptions.push(
        vscode.window.tabGroups.onDidChangeTabs(reopenMarkdownTextTabs),
        vscode.window.onDidChangeVisibleTextEditors(reopenMarkdownTextTabs)
    );
    reopenMarkdownTextTabs();   // convert anything already open (incl. cold start)

    context.subscriptions.push(
        // "Open Pretty View" — reopens the active markdown in our editor. Still
        // useful after a user picks "Reopen Editor With… › Text Editor".
        vscode.commands.registerCommand('mdPrettyViewer.open', async () => {
            const uri = activeMarkdownUri();
            if (uri) {
                await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
            } else {
                vscode.window.showInformationMessage('MD Pretty Viewer: Open a markdown file first.');
            }
        }),
        vscode.commands.registerCommand('mdPrettyViewer.toggleMode', () => {
            postToActive('command', { action: 'toggleMode' });
        }),
        vscode.commands.registerCommand('mdPrettyViewer.bold', () => {
            postToActive('command', { action: 'bold' });
        }),
        vscode.commands.registerCommand('mdPrettyViewer.italic', () => {
            postToActive('command', { action: 'italic' });
        }),
        vscode.commands.registerCommand('mdPrettyViewer.code', () => {
            postToActive('command', { action: 'code' });
        })
    );
}

function deactivate() {
    activePanel = null;
    if (_convertTimer) { clearTimeout(_convertTimer); _convertTimer = null; }
    _convertAttempted.clear();
}

module.exports = { activate, deactivate };
