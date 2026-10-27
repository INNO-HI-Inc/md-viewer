const vscode = require('vscode');
const path = require('path');
const childProcess = require('child_process');

/* ───────────────────────────────────────────
   UI language (v1.0.44)
   mdPrettyViewer.language: "auto" | "en" | "ko".
   "auto" picks Korean when EITHER the VS Code display language OR the OS
   language is Korean, English otherwise. Checking the OS too matters:
   many Korean users run an English VS Code, and they have always seen the
   Korean UI — switching them to English on update would be a regression.
   ─────────────────────────────────────────── */
const HOST_STRINGS = {
    ko: {
        linkOpenFail: 'MD Pretty Viewer: 링크한 파일을 열 수 없습니다 — ',
        updated: '🎉 MD Pretty Viewer {version} 업데이트됨!',
        viewChanges: '변경 사항 보기',
        close: '닫기',
        pickLanguage: '화면 언어를 선택하세요',
        langAuto: '자동',
        langAutoDetail: 'VS Code나 운영체제 언어가 한국어면 한국어, 아니면 English',
        langEn: 'English',
        langKo: '한국어',
        current: '현재 설정',
        languageOverridden: 'MD Pretty Viewer: 이 폴더의 설정(.vscode/settings.json)이 화면 언어를 고정하고 있어 바뀌지 않았습니다.'
    },
    en: {
        linkOpenFail: 'MD Pretty Viewer: Could not open the linked file — ',
        updated: '🎉 MD Pretty Viewer {version} updated!',
        viewChanges: 'View Changes',
        close: 'Close',
        pickLanguage: 'Select the interface language',
        langAuto: 'Auto',
        langAutoDetail: 'Korean if VS Code or your OS is Korean, English otherwise',
        langEn: 'English',
        langKo: '한국어 (Korean)',
        current: 'current setting',
        languageOverridden: 'MD Pretty Viewer: The language did not change because folder settings (.vscode/settings.json) pin it.'
    }
};

function hostString(key, vars) {
    const table = HOST_STRINGS[resolveUiLanguage()] || HOST_STRINGS.ko;
    let s = table[key] != null ? table[key] : HOST_STRINGS.ko[key];
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
    return s;
}

function isKoreanTag(tag) {
    return typeof tag === 'string' && /^ko([-_.]|$)/i.test(tag.trim());
}

// OS language never changes while VS Code runs — detect once, lazily.
let _osIsKorean = null;
function osLanguageIsKorean() {
    if (_osIsKorean !== null) return _osIsKorean;
    const tags = [];
    for (const name of ['LC_ALL', 'LC_MESSAGES', 'LANG', 'LANGUAGE']) {
        const v = process.env[name];
        if (v) tags.push(...String(v).split(':'));
    }
    try { tags.push(Intl.DateTimeFormat().resolvedOptions().locale); } catch (_) {}
    // macOS apps launched from the Dock usually have no LANG, and Node's
    // ICU then reports en-US even on a Korean Mac — ask the system instead.
    if (process.platform === 'darwin' && !tags.some(isKoreanTag)) {
        try {
            const out = childProcess.execFileSync('defaults', ['read', '-g', 'AppleLanguages'], {
                encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore']
            });
            const first = out.match(/[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)*/);
            if (first) tags.push(first[0]);
        } catch (_) { /* no defaults binary / sandbox — ignore */ }
    }
    _osIsKorean = tags.some(isKoreanTag);
    return _osIsKorean;
}

function resolveUiLanguage() {
    let setting = 'auto';
    try {
        setting = vscode.workspace.getConfiguration('mdPrettyViewer').get('language', 'auto');
    } catch (_) {}
    if (setting === 'en' || setting === 'ko') return setting;
    const vscodeLang = vscode.env && vscode.env.language;
    if (isKoreanTag(vscodeLang)) return 'ko';
    return osLanguageIsKorean() ? 'ko' : 'en';
}

/* Persist mdPrettyViewer.language. Written to user settings, unless the
   workspace already pins a value — then the workspace value is updated,
   since a user-level write would be silently shadowed by it. */
async function setLanguageSetting(lang) {
    if (lang !== 'auto' && lang !== 'en' && lang !== 'ko') return;
    const cfg = vscode.workspace.getConfiguration('mdPrettyViewer');
    const info = typeof cfg.inspect === 'function' ? cfg.inspect('language') : null;
    const T = vscode.ConfigurationTarget || { Global: 1, Workspace: 2 };
    const target = info && info.workspaceValue !== undefined ? T.Workspace : T.Global;
    try {
        await cfg.update('language', lang, target);
    } catch (err) {
        console.error('MD Pretty Viewer: could not save language setting', err);
        return;
    }
    // A per-folder value (multi-root .vscode/settings.json) still wins.
    if (info && info.workspaceFolderValue !== undefined && info.workspaceFolderValue !== lang) {
        vscode.window.showWarningMessage(hostString('languageOverridden'));
    }
}

/* Command palette: "MD Pretty Viewer: Change Display Language". */
async function pickLanguage() {
    let current = 'auto';
    try { current = vscode.workspace.getConfiguration('mdPrettyViewer').get('language', 'auto'); } catch (_) {}
    const mark = (v) => (v === current ? hostString('current') : undefined);
    const items = [
        { value: 'auto', label: hostString('langAuto'), description: mark('auto'), detail: hostString('langAutoDetail') },
        { value: 'en', label: hostString('langEn'), description: mark('en') },
        { value: 'ko', label: hostString('langKo'), description: mark('ko') }
    ];
    const picked = await vscode.window.showQuickPick(items, { placeHolder: hostString('pickLanguage') });
    if (picked && picked.value !== current) await setLanguageSetting(picked.value);
}

// The webview panel of the currently-focused pretty editor. Toolbar commands
// (bold/italic/code/toggleMode) route here ONLY — broadcasting to every open
// editor would run the command in unfocused documents and, with auto-save,
// silently corrupt files the user never touched.
let activePanel = null;

// Every open pretty-editor panel → { lang it was built with, requestRebuild }.
// A language change rebuilds each stale panel in place (no window reload).
const openPanels = new Map();

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

/* JSON that is safe to inline inside a <script> element. Plain
   JSON.stringify leaves "</script>" intact, so a markdown file that merely
   MENTIONS that tag (e.g. in an HTML code block) closed the bootstrap script
   early and the viewer stayed blank. < / \u2028 / \u2029 decode to the
   exact same string in JS. */
function jsonForScript(value) {
    return JSON.stringify(value === undefined ? null : value)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function getHtml(webview, nonce, context, document, docBaseUri, settings, restoreState, uiLang) {
    const mediaUri = (file) => webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'media', file)
    );
    const fileName = path.basename(document.uri.fsPath);
    const content = document.getText();
    const MODES = ['preview', 'edit', 'split'];
    const restoredMode = restoreState && MODES.includes(restoreState.mode) ? restoreState.mode : null;
    const initialMode = restoredMode || (MODES.includes(settings.defaultMode) ? settings.defaultMode : 'preview');
    uiLang = uiLang || resolveUiLanguage();

    return `<!DOCTYPE html>
<html lang="${uiLang}">
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
    <script nonce="${nonce}">window.__mdpvLang = ${jsonForScript(uiLang)};</script>
    <script nonce="${nonce}" src="${mediaUri('editor.js')}"></script>
    <script nonce="${nonce}">
        // Lazy-loaded heavy libraries: paths passed in for on-demand <script> injection
        window.__lazyAssets = {
            mermaid: ${jsonForScript(mediaUri('mermaid.min.js').toString())},
            html2pdf: ${jsonForScript(mediaUri('html2pdf.bundle.min.js').toString())},
            nonce: ${jsonForScript(nonce)}
        };
        initEditor(${jsonForScript(content)}, ${jsonForScript(fileName)}, ${jsonForScript(docBaseUri.toString())}, ${jsonForScript(settings)}, ${jsonForScript(restoreState || null)});
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
        mermaidLevelColors: config.get('mermaidLevelColors', false)
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
        let isDisposed = false;

        // (Re)build the webview in the current UI language. A fresh nonce
        // per build keeps the CSP tight across rebuilds.
        const panelInfo = { lang: null, rebuilding: false, timer: null, requestRebuild: null };
        const render = (restoreState) => {
            const lang = resolveUiLanguage();
            webview.html = getHtml(webview, getNonce(), context, document, docBaseUri,
                readSettings(), restoreState || null, lang);
            panelInfo.lang = lang;
        };
        render(null);
        openPanels.set(webviewPanel, panelInfo);

        // Edits still being applied/saved — a language rebuild waits for
        // them so the new webview is built from the up-to-date document.
        const pendingApplies = new Set();
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
        // Language switch, step 1: ask the live webview to commit any open
        // block editor, flush its debounced save and report its view state.
        // If it never answers (crashed / unresponsive), rebuild anyway.
        const finishRebuild = async (state) => {
            if (!panelInfo.rebuilding || isDisposed) return;
            clearTimeout(panelInfo.timer);
            await Promise.all(Array.from(pendingApplies).map(p => p.catch(() => {})));
            if (isDisposed || !panelInfo.rebuilding) return;
            panelInfo.rebuilding = false;
            render(state && typeof state === 'object' ? state : null);
        };
        panelInfo.requestRebuild = () => {
            if (isDisposed || panelInfo.rebuilding) return;
            panelInfo.rebuilding = true;
            safePost({ type: 'prepareRebuild' });
            panelInfo.timer = setTimeout(() => { finishRebuild(null); }, 3000);
        };

        const applyEdit = async (content) => {
            if (document.getText() === content) return;   // no-op
            const fullRange = new vscode.Range(
                new vscode.Position(0, 0),
                new vscode.Position(document.lineCount, 0)
            );
            const edit = new vscode.WorkspaceEdit();
            edit.replace(uri, fullRange, content);
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
        };

        const msgSub = webview.onDidReceiveMessage(msg => {
            if (!msg || isDisposed) return;
            if (msg.type === 'openLink') {
                openLinkFromWebview(String(msg.href || ''), uri);
            } else if (msg.type === 'setLanguage') {
                setLanguageSetting(msg.lang);
            } else if (msg.type === 'rebuildReady') {
                finishRebuild(msg.state);
            } else if (msg.type === 'edit') {
                // Registered synchronously, so a 'rebuildReady' that the
                // webview posts right after this edit always waits for it.
                const p = applyEdit(msg.content);
                pendingApplies.add(p);
                p.then(() => pendingApplies.delete(p), () => pendingApplies.delete(p));
            }
        });

        webviewPanel.onDidDispose(() => {
            isDisposed = true;
            clearTimeout(panelInfo.timer);
            openPanels.delete(webviewPanel);
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
        vscode.window.showWarningMessage(hostString('linkOpenFail') + href);
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
        const message = hostString('updated', { version: currentVersion });
        const viewChanges = hostString('viewChanges');
        vscode.window.showInformationMessage(
            message,
            viewChanges,
            hostString('close')
        ).then(selection => {
            if (selection === viewChanges) {
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

    // Language switch: new editors pick it up automatically (getHtml reads
    // the setting); every open viewer built in another language is rebuilt
    // in place — after it has committed its edits and handed over its view
    // state — so no window reload is needed.
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (!e.affectsConfiguration('mdPrettyViewer.language')) return;
            const lang = resolveUiLanguage();
            for (const info of openPanels.values()) {
                if (info.lang !== lang && info.requestRebuild) info.requestRebuild();
            }
        }),
        vscode.commands.registerCommand('mdPrettyViewer.changeLanguage', pickLanguage)
    );

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
    openPanels.clear();
    if (_convertTimer) { clearTimeout(_convertTimer); _convertTimer = null; }
    _convertAttempted.clear();
}

module.exports = { activate, deactivate };
