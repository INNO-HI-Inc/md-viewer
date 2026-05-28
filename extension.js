const vscode = require('vscode');
const path = require('path');

// uri string -> WebviewPanel (one panel per file)
const openPanels = new Map();
// All active webviews (for command broadcasting)
const activeWebviews = new Set();

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
    <script nonce="${nonce}" src="${mediaUri('html2pdf.bundle.min.js')}"></script>
    <script nonce="${nonce}" src="${mediaUri('katex.min.js')}"></script>
    <script nonce="${nonce}" src="${mediaUri('katex-auto-render.min.js')}"></script>
    <script nonce="${nonce}" src="${mediaUri('highlight.min.js')}"></script>
    <script nonce="${nonce}" src="${mediaUri('editor.js')}"></script>
    <script nonce="${nonce}">
        initEditor(${JSON.stringify(content)}, ${JSON.stringify(fileName)}, ${JSON.stringify(docBaseUri.toString())}, ${JSON.stringify(settings)});
    </script>
</body>
</html>`;
}

async function openPrettyView(context, uri, viewColumn) {
    const uriKey = uri.toString();

    // If already open, reveal it
    if (openPanels.has(uriKey)) {
        const existing = openPanels.get(uriKey);
        existing.reveal(viewColumn || vscode.ViewColumn.Active);
        return existing;
    }

    // Open the document
    const document = await vscode.workspace.openTextDocument(uri);

    // Determine target column (use active column)
    const targetColumn = viewColumn || vscode.ViewColumn.Active;

    // Create webview panel in the target column
    const panel = vscode.window.createWebviewPanel(
        'mdPrettyViewer.editor',
        path.basename(uri.fsPath),
        targetColumn,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            enableFindWidget: true,
            localResourceRoots: [
                vscode.Uri.joinPath(context.extensionUri, 'media'),
                vscode.Uri.joinPath(uri, '..'),
                ...(vscode.workspace.workspaceFolders || []).map(f => f.uri)
            ]
        }
    );

    openPanels.set(uriKey, panel);
    activeWebviews.add(panel.webview);

    const docDir = vscode.Uri.joinPath(uri, '..');
    const docBaseUri = panel.webview.asWebviewUri(docDir);
    const nonce = getNonce();

    const config = vscode.workspace.getConfiguration('mdPrettyViewer');
    const initialSettings = {
        defaultTheme: config.get('defaultTheme', 'blue'),
        defaultFontSize: config.get('defaultFontSize', 16),
        defaultMode: config.get('defaultMode', 'preview'),
        showOutline: config.get('showOutline', false)
    };

    panel.webview.html = getHtml(panel.webview, nonce, context, document, docBaseUri, initialSettings);

    let isWebviewEdit = false;

    // Sync document changes → webview
    const changeDocSub = vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document.uri.toString() === uri.toString()) {
            if (isWebviewEdit) {
                isWebviewEdit = false;
                return;
            }
            panel.webview.postMessage({
                type: 'update',
                content: e.document.getText()
            });
        }
    });

    // Sync settings changes → webview
    const configSub = vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('mdPrettyViewer')) {
            const cfg = vscode.workspace.getConfiguration('mdPrettyViewer');
            panel.webview.postMessage({
                type: 'configChange',
                settings: {
                    defaultTheme: cfg.get('defaultTheme'),
                    defaultFontSize: cfg.get('defaultFontSize'),
                    defaultMode: cfg.get('defaultMode'),
                    showOutline: cfg.get('showOutline')
                }
            });
        }
    });

    // Handle webview → document edits
    panel.webview.onDidReceiveMessage(async msg => {
        if (msg.type === 'edit') {
            const doc = await vscode.workspace.openTextDocument(uri);
            const fullRange = new vscode.Range(
                new vscode.Position(0, 0),
                new vscode.Position(doc.lineCount, 0)
            );
            const edit = new vscode.WorkspaceEdit();
            edit.replace(uri, fullRange, msg.content);
            isWebviewEdit = true;
            await vscode.workspace.applyEdit(edit);
            await doc.save();
        }
    });

    panel.onDidDispose(() => {
        openPanels.delete(uriKey);
        activeWebviews.delete(panel.webview);
        changeDocSub.dispose();
        configSub.dispose();
    });

    return panel;
}

function isMarkdownFile(uri) {
    return /\.(md|markdown|mdown|mkd)$/i.test(uri.fsPath);
}

function broadcast(type, payload) {
    activeWebviews.forEach(wv => wv.postMessage({ type, ...payload }));
}

function showUpdateNotification(context) {
    const currentVersion = context.extension.packageJSON.version;
    const previousVersion = context.globalState.get('mdPrettyViewer.lastVersion');

    if (previousVersion && previousVersion !== currentVersion) {
        // Extension was updated — show notification
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
    // Show update notification if version changed since last run
    showUpdateNotification(context);

    // Auto-convert text editor tabs for .md files into our pretty viewer
    // Set of URIs we've already started converting (to avoid loops/double-handling)
    const inProgress = new Set();

    const convertToPrettyView = async (uri, column) => {
        const key = uri.toString();
        if (!isMarkdownFile(uri)) return;
        if (uri.scheme !== 'file') return;
        if (openPanels.has(key)) {
            // Already open as pretty view → just reveal it
            openPanels.get(key).reveal(column || vscode.ViewColumn.Active);
            return;
        }
        if (inProgress.has(key)) return;
        inProgress.add(key);

        try {
            // Close any text editor tabs for this file
            for (const group of vscode.window.tabGroups.all) {
                for (const tab of group.tabs) {
                    if (tab.input instanceof vscode.TabInputText &&
                        tab.input.uri.toString() === key) {
                        await vscode.window.tabGroups.close(tab);
                    }
                }
            }
            await openPrettyView(context, uri, column || vscode.ViewColumn.Active);
        } catch (_) {}
        inProgress.delete(key);
    };

    const handleEditor = async (editor) => {
        if (!editor || !editor.document) return;
        const uri = editor.document.uri;
        const column = editor.viewColumn || vscode.ViewColumn.Active;
        await convertToPrettyView(uri, column);
    };

    context.subscriptions.push(
        // When a document is freshly opened
        vscode.workspace.onDidOpenTextDocument(async (document) => {
            // Wait briefly so VS Code attaches it to an editor with a column
            await new Promise(r => setTimeout(r, 30));
            const editor = vscode.window.visibleTextEditors.find(
                e => e.document.uri.toString() === document.uri.toString()
            );
            const column = (editor && editor.viewColumn) || vscode.ViewColumn.Active;
            await convertToPrettyView(document.uri, column);
        }),
        // When the active editor changes (e.g. clicking a tab, link from Claude, etc.)
        vscode.window.onDidChangeActiveTextEditor(handleEditor),
        // When the visible editors change (e.g. opening files programmatically)
        vscode.window.onDidChangeVisibleTextEditors(async (editors) => {
            for (const e of editors) {
                if (isMarkdownFile(e.document.uri)) {
                    await convertToPrettyView(e.document.uri, e.viewColumn || vscode.ViewColumn.Active);
                }
            }
        })
    );

    // Handle any markdown text editors already visible
    for (const e of vscode.window.visibleTextEditors) {
        if (isMarkdownFile(e.document.uri)) {
            convertToPrettyView(e.document.uri, e.viewColumn || vscode.ViewColumn.Active);
        }
    }

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('mdPrettyViewer.open', async () => {
            const editor = vscode.window.activeTextEditor;
            const uri = editor ? editor.document.uri : undefined;
            if (uri && isMarkdownFile(uri)) {
                const column = editor.viewColumn || vscode.ViewColumn.Active;
                await openPrettyView(context, uri, column);
            } else {
                vscode.window.showInformationMessage('MD Pretty Viewer: Open a markdown file first.');
            }
        }),
        vscode.commands.registerCommand('mdPrettyViewer.toggleMode', () => {
            broadcast('command', { action: 'toggleMode' });
        }),
        vscode.commands.registerCommand('mdPrettyViewer.bold', () => {
            broadcast('command', { action: 'bold' });
        }),
        vscode.commands.registerCommand('mdPrettyViewer.italic', () => {
            broadcast('command', { action: 'italic' });
        }),
        vscode.commands.registerCommand('mdPrettyViewer.code', () => {
            broadcast('command', { action: 'code' });
        })
    );
}

function deactivate() {
    openPanels.forEach(panel => panel.dispose());
    openPanels.clear();
    activeWebviews.clear();
}

module.exports = { activate, deactivate };
