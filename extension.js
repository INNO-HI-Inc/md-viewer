const vscode = require('vscode');
const path = require('path');

class MarkdownEditorProvider {
    static viewType = 'mdPrettyViewer.editor';

    constructor(context) {
        this.context = context;
    }

    resolveCustomTextEditor(document, webviewPanel, _token) {
        const webview = webviewPanel.webview;
        const docDir = vscode.Uri.joinPath(document.uri, '..');
        const workspaceFolders = (vscode.workspace.workspaceFolders || []).map(f => f.uri);
        webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'media'),
                docDir,
                ...workspaceFolders
            ]
        };

        const mediaUri = (file) => webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', file)
        );
        const docBaseUri = webview.asWebviewUri(docDir);
        const nonce = getNonce();

        webview.html = getHtml(webview, nonce, mediaUri, document, docBaseUri);

        // Track whether the webview is triggering the edit to avoid echo loops
        let isWebviewEdit = false;

        // Document -> Webview synchronization
        const changeDocSub = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                if (isWebviewEdit) {
                    isWebviewEdit = false;
                    return;
                }
                webview.postMessage({
                    type: 'update',
                    content: document.getText()
                });
            }
        });

        // Webview -> Document synchronization
        webview.onDidReceiveMessage(async msg => {
            if (msg.type === 'edit') {
                const fullRange = new vscode.Range(
                    new vscode.Position(0, 0),
                    new vscode.Position(document.lineCount, 0)
                );
                const edit = new vscode.WorkspaceEdit();
                edit.replace(document.uri, fullRange, msg.content);
                isWebviewEdit = true;
                await vscode.workspace.applyEdit(edit);
            }
        });

        webviewPanel.onDidDispose(() => {
            changeDocSub.dispose();
        });
    }
}

function getHtml(webview, nonce, mediaUri, document, docBaseUri) {
    const fileName = path.basename(document.uri.fsPath);
    const content = document.getText();

    return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src ${webview.cspSource} https: http: data: file:; font-src ${webview.cspSource} https:;">
    <link rel="stylesheet" href="${mediaUri('editor.css')}">
    <title>${escapeHtml(fileName)}</title>
</head>
<body class="mode-preview">
    <div id="app"></div>
    <script nonce="${nonce}" src="${mediaUri('marked.min.js')}"></script>
    <script nonce="${nonce}" src="${mediaUri('highlight.min.js')}"></script>
    <script nonce="${nonce}" src="${mediaUri('editor.js')}"></script>
    <script nonce="${nonce}">
        initEditor(${JSON.stringify(content)}, ${JSON.stringify(fileName)}, ${JSON.stringify(docBaseUri.toString())});
    </script>
</body>
</html>`;
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function getNonce() {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += chars[Math.floor(Math.random() * chars.length)];
    }
    return text;
}

function activate(context) {
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(
            MarkdownEditorProvider.viewType,
            new MarkdownEditorProvider(context),
            {
                webviewOptions: { retainContextWhenHidden: true }
            }
        )
    );
}

function deactivate() {}

module.exports = { activate, deactivate };
