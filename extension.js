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
    <title>${escapeHtml(fileName)}</title>
</head>
<body class="mode-${initialMode}">
    <div id="app"></div>
    <script nonce="${nonce}" src="${mediaUri('marked.min.js')}"></script>
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

function activate(context) {
    // Auto-convert text editor tabs for .md files into our pretty viewer
    const handleOpenedDocument = async (document) => {
        if (!isMarkdownFile(document.uri)) return;
        if (document.uri.scheme !== 'file') return;

        // Wait a tick so VS Code finishes showing the text editor
        await new Promise(r => setTimeout(r, 20));

        // Find the text editor for this document
        const editor = vscode.window.visibleTextEditors.find(
            e => e.document.uri.toString() === document.uri.toString()
        );
        if (!editor) return;

        const column = editor.viewColumn || vscode.ViewColumn.Active;

        // Close the text editor tab (in its group)
        try {
            for (const group of vscode.window.tabGroups.all) {
                for (const tab of group.tabs) {
                    if (tab.input instanceof vscode.TabInputText &&
                        tab.input.uri.toString() === document.uri.toString()) {
                        await vscode.window.tabGroups.close(tab);
                    }
                }
            }
        } catch (_) {}

        // Open our webview panel in the SAME column
        await openPrettyView(context, document.uri, column);
    };

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(handleOpenedDocument)
    );

    // Also handle files that are already open when the extension activates
    for (const doc of vscode.workspace.textDocuments) {
        handleOpenedDocument(doc);
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
