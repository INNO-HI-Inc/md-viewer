#!/usr/bin/env node
/**
 * UI language resolution on the extension-host side (v1.0.44).
 *
 * Loads extension.js against a mocked `vscode` module and checks that:
 *  - mdPrettyViewer.language "en" / "ko" forces the webview language
 *    (html lang attribute + window.__mdpvLang injected BEFORE editor.js),
 *  - "auto" follows a Korean VS Code display language,
 *  - host-side messages (update toast, broken-link warning) are localized,
 *  - changing the language rebuilds open viewers IN PLACE: the webview is
 *    asked to commit + report state, pending edits land first, and the
 *    rebuilt page restores that state (no window reload),
 *  - the top-bar toggle / command palette write the setting,
 *  - document text can never break out of the bootstrap <script>.
 */
'use strict';
const path = require('path');
const Module = require('module');

const results = [];
function check(name, ok, detail) {
    results.push([name, ok]);
    console.log((ok ? 'PASS' : 'FAIL') + ' - ' + name + (!ok && detail !== undefined ? ': ' + JSON.stringify(detail) : ''));
}

function makeVscode(opts) {
    const state = {
        language: opts.setting,            // mdPrettyViewer.language
        infoMessages: [],
        warnMessages: [],
        commands: [],
        providers: [],
        configCbs: [],
        updates: [],
        applied: [],
        quickPicks: [],
        docText: opts.docText || '# Hello',
    };
    const Uri = {
        file: (p) => ({ scheme: 'file', fsPath: p, toString: () => 'file://' + p }),
        parse: (s) => ({ scheme: 'https', fsPath: s, toString: () => s }),
        joinPath: (base, ...parts) => Uri.file(path.join(base.fsPath, ...parts)),
    };
    const vscode = {
        Uri,
        TabInputText: class {}, TabInputCustom: class {},
        window: {
            tabGroups: { all: [], onDidChangeTabs: () => ({ dispose() {} }), activeTabGroup: null },
            onDidChangeVisibleTextEditors: () => ({ dispose() {} }),
            registerCustomEditorProvider: (type, provider) => { state.providers.push(provider); return { dispose() {} }; },
            showInformationMessage: (msg, ...items) => {
                state.infoMessages.push({ msg, items });
                return Promise.resolve(opts.pickInfo ? opts.pickInfo(items) : undefined);
            },
            showWarningMessage: (msg) => { state.warnMessages.push(msg); return Promise.resolve(); },
            activeTextEditor: undefined,
        },
        workspace: {
            getConfiguration: (section) => ({
                inspect: () => ({ workspaceValue: opts.workspaceValue, workspaceFolderValue: opts.folderValue }),
                update: (key, value, target) => {
                    state.updates.push({ key, value, target });
                    if (key === 'language') state.language = value;
                    state.configCbs.forEach((cb) => cb({ affectsConfiguration: (s) => s === 'mdPrettyViewer' || s === 'mdPrettyViewer.' + key }));
                    return Promise.resolve();
                },
                get: (key, def) => {
                    if (section === 'mdPrettyViewer' && key === 'language') {
                        return state.language === undefined ? def : state.language;
                    }
                    if (section === 'workbench') return {};
                    return def;
                },
            }),
            onDidChangeTextDocument: () => ({ dispose() {} }),
            onDidChangeConfiguration: (cb) => { state.configCbs.push(cb); return { dispose() {} }; },
            workspaceFolders: [],
            applyEdit: async (edit) => {
                await sleep(opts.applyDelay || 0);
                state.docText = edit.content;
                state.applied.push(edit.content);
                return true;
            },
        },
        commands: {
            registerCommand: () => ({ dispose() {} }),
            executeCommand: (cmd, ...args) => { state.commands.push({ cmd, args }); return Promise.resolve(); },
        },
        env: { language: opts.vscodeLanguage, openExternal: () => Promise.resolve(true) },
        Range: class {}, Position: class {},
        WorkspaceEdit: class { replace(uri, range, content) { this.content = content; } },
        ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    };
    vscode.window.showQuickPick = (items) => {
        state.quickPicks.push(items);
        return Promise.resolve(opts.pickQuick ? opts.pickQuick(items) : undefined);
    };
    return { vscode, state };
}

function loadExtensionWith(vscode) {
    const origLoad = Module._load;
    Module._load = function (request) {
        if (request === 'vscode') return vscode;
        return origLoad.apply(this, arguments);
    };
    const extPath = path.resolve(__dirname, '../../extension.js');
    delete require.cache[extPath];
    try { return require(extPath); } finally { Module._load = origLoad; }
}

function makeContext(prevVersion) {
    return {
        subscriptions: [],
        extensionUri: { fsPath: '/ext', scheme: 'file', toString: () => 'file:///ext' },
        extension: { packageJSON: { version: '9.9.9' } },
        globalState: { get: () => prevVersion || '9.9.9', update: () => {} },
    };
}

// Resolve one custom editor and return { html, panel }.
function openEditor(m) {
    const provider = m.state.providers[m.state.providers.length - 1];
    let disposeCb = null;
    let onMsg = null;
    const posted = [];
    const htmls = [];
    const webview = {
        options: {}, cspSource: 'vscode-resource:',
        asWebviewUri: (u) => ({ toString: () => 'vscode-resource:' + u.fsPath }),
        onDidReceiveMessage: (cb) => { onMsg = cb; return { dispose() {} }; },
        postMessage: (msg) => { posted.push(msg); return Promise.resolve(true); },
        set html(v) { htmls.push(v); },
        get html() { return htmls[htmls.length - 1] || ''; },
    };
    const panel = {
        webview, active: true,
        onDidChangeViewState: () => ({ dispose() {} }),
        onDidDispose: (cb) => { disposeCb = cb; },
    };
    const document = {
        uri: m.vscode.Uri.file('/w/doc.md'),
        getText: () => m.state.docText,
        get lineCount() { return m.state.docText.split('\n').length; },
        save: async () => true,
    };
    provider.resolveCustomTextEditor(document, panel, {});
    return {
        html: webview.html, htmls, posted,
        send: (msg) => onMsg && onMsg(msg),
        close: () => disposeCb && disposeCb(),
    };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function langOf(html) {
    const a = html.match(/<html lang="([^"]+)">/);
    const b = html.match(/window\.__mdpvLang = "([^"]+)";/);
    return { attr: a && a[1], injected: b && b[1] };
}

async function main() {
    // 1. Explicit "en" wins even on a Korean VS Code.
    {
        const m = makeVscode({ setting: 'en', vscodeLanguage: 'ko' });
        loadExtensionWith(m.vscode).activate(makeContext());
        const { html } = openEditor(m);
        const l = langOf(html);
        check('setting en: <html lang="en">', l.attr === 'en', l);
        check('setting en: window.__mdpvLang = "en"', l.injected === 'en', l);
        check('lang is injected before editor.js loads',
            html.indexOf('window.__mdpvLang') >= 0 &&
            html.indexOf('window.__mdpvLang') < html.indexOf('editor.js'));
    }

    // 2. Explicit "ko" wins on an English VS Code.
    {
        const m = makeVscode({ setting: 'ko', vscodeLanguage: 'en' });
        loadExtensionWith(m.vscode).activate(makeContext());
        const l = langOf(openEditor(m).html);
        check('setting ko: Korean UI', l.attr === 'ko' && l.injected === 'ko', l);
    }

    // 3. "auto" + Korean VS Code → Korean.
    {
        const m = makeVscode({ setting: 'auto', vscodeLanguage: 'ko' });
        loadExtensionWith(m.vscode).activate(makeContext());
        const l = langOf(openEditor(m).html);
        check('auto + VS Code ko: Korean UI', l.attr === 'ko' && l.injected === 'ko', l);
    }

    // 4. Unset setting / garbage value behaves like "auto" (no crash).
    {
        const m = makeVscode({ setting: 42, vscodeLanguage: 'ko-KR' });
        loadExtensionWith(m.vscode).activate(makeContext());
        const l = langOf(openEditor(m).html);
        check('invalid setting falls back to auto (ko-KR → ko)', l.injected === 'ko', l);
    }
    {
        const m = makeVscode({ setting: undefined, vscodeLanguage: undefined });
        loadExtensionWith(m.vscode).activate(makeContext());
        const l = langOf(openEditor(m).html);
        check('no setting / no env.language: still a valid language', l.injected === 'en' || l.injected === 'ko', l);
    }

    // 5. Update notification is localized and its button still works.
    {
        const m = makeVscode({ setting: 'en', vscodeLanguage: 'en', pickInfo: (items) => items[0] });
        let opened = null;
        m.vscode.env.openExternal = (u) => { opened = u.toString(); return Promise.resolve(true); };
        loadExtensionWith(m.vscode).activate(makeContext('1.0.0'));
        await sleep(10);
        const n = m.state.infoMessages[0] || {};
        check('en update toast text', n.msg === '🎉 MD Pretty Viewer 9.9.9 updated!', n);
        check('en update toast buttons', JSON.stringify(n.items) === JSON.stringify(['View Changes', 'Close']), n);
        check('en "View Changes" opens the release page', opened && opened.indexOf('/releases/tag/v9.9.9') >= 0, opened);
    }
    {
        const m = makeVscode({ setting: 'ko', vscodeLanguage: 'en' });
        loadExtensionWith(m.vscode).activate(makeContext('1.0.0'));
        const n = m.state.infoMessages[0] || {};
        check('ko update toast unchanged from earlier versions', n.msg === '🎉 MD Pretty Viewer 9.9.9 업데이트됨!' &&
            JSON.stringify(n.items) === JSON.stringify(['변경 사항 보기', '닫기']), n);
    }

    // 6. Language change with an open viewer → in-place rebuild, no reload prompt.
    {
        const m = makeVscode({ setting: 'ko', vscodeLanguage: 'en', applyDelay: 40 });
        loadExtensionWith(m.vscode).activate(makeContext());
        const ed = openEditor(m);
        m.state.language = 'en';
        m.state.configCbs.forEach((cb) => cb({ affectsConfiguration: (s) => s === 'mdPrettyViewer.language' || s === 'mdPrettyViewer' }));
        check('language change: webview asked to prepare (commit + report state)',
            ed.posted.some((x) => x.type === 'prepareRebuild'), ed.posted);
        check('language change: no reload prompt', m.state.infoMessages.length === 0, m.state.infoMessages);
        check('language change: not rebuilt before the webview answers', ed.htmls.length === 1, ed.htmls.length);

        // The webview flushes its last edit, then reports its view state.
        const state = { mode: 'split', previewScroll: 420, undo: ['a</script>b'], theme: 'sage' };
        ed.send({ type: 'edit', content: '# Hello\n\nlast words typed\n' });
        ed.send({ type: 'rebuildReady', state });
        await sleep(10);
        check('rebuild waits for the in-flight edit to be applied', ed.htmls.length === 1, ed.htmls.length);
        await sleep(80);
        check('rebuilt once after the edit landed', ed.htmls.length === 2, ed.htmls.length);
        const html = ed.htmls[1] || '';
        const l = langOf(html);
        check('rebuilt page is English', l.attr === 'en' && l.injected === 'en', l);
        check('rebuilt page contains the flushed edit', html.indexOf('last words typed') >= 0);
        check('rebuilt page starts in the restored mode', /<body class="mode-split">/.test(html));
        const init = html.match(/initEditor\(([\s\S]*?)\);\s*<\/script>/);
        let restored = null;
        try { restored = init && JSON.parse('[' + init[1] + ']')[4]; } catch (e) { restored = String(e); }
        check('view state handed to initEditor', restored && restored.previewScroll === 420 &&
            restored.theme === 'sage' && restored.undo[0] === 'a</script>b', restored);

        // Same language again → nothing happens.
        m.state.configCbs.forEach((cb) => cb({ affectsConfiguration: (s) => s.indexOf('mdPrettyViewer') === 0 }));
        check('no rebuild when the language did not change', !ed.posted.slice(1).some((x) => x.type === 'prepareRebuild'));
    }

    // 7. Unresponsive webview → rebuild anyway after the timeout (still English).
    {
        const m = makeVscode({ setting: 'ko', vscodeLanguage: 'en' });
        loadExtensionWith(m.vscode).activate(makeContext());
        const ed = openEditor(m);
        m.state.language = 'en';
        m.state.configCbs.forEach((cb) => cb({ affectsConfiguration: (s) => s === 'mdPrettyViewer.language' }));
        await sleep(3200);
        check('unresponsive webview: rebuilt after timeout', ed.htmls.length === 2 && langOf(ed.htmls[1]).injected === 'en', ed.htmls.length);
    }

    // 8. Closed viewer → no rebuild, no prompt.
    {
        const m = makeVscode({ setting: 'ko', vscodeLanguage: 'en' });
        loadExtensionWith(m.vscode).activate(makeContext());
        const ed = openEditor(m);
        ed.close();
        m.state.language = 'en';
        m.state.configCbs.forEach((cb) => cb({ affectsConfiguration: (s) => s.indexOf('mdPrettyViewer') === 0 }));
        check('closed viewer: nothing posted', !ed.posted.some((x) => x.type === 'prepareRebuild'));
        check('closed viewer: no prompt', m.state.infoMessages.length === 0, m.state.infoMessages);
    }

    // 9. Top-bar toggle → writes the user setting → open viewer switches.
    {
        const m = makeVscode({ setting: 'ko', vscodeLanguage: 'en' });
        loadExtensionWith(m.vscode).activate(makeContext());
        const ed = openEditor(m);
        ed.send({ type: 'setLanguage', lang: 'en' });
        await sleep(10);
        const u = m.state.updates[0] || {};
        check('toggle writes mdPrettyViewer.language = en to user settings', u.key === 'language' && u.value === 'en' && u.target === 1, u);
        check('toggle triggers the in-place rebuild', ed.posted.some((x) => x.type === 'prepareRebuild'), ed.posted);
        ed.send({ type: 'setLanguage', lang: 'fr' });
        ed.send({ type: 'setLanguage', lang: '<script>' });
        await sleep(10);
        check('toggle ignores unknown languages', m.state.updates.length === 1, m.state.updates);
    }
    {
        const m = makeVscode({ setting: 'ko', vscodeLanguage: 'en', workspaceValue: 'ko' });
        loadExtensionWith(m.vscode).activate(makeContext());
        openEditor(m).send({ type: 'setLanguage', lang: 'en' });
        await sleep(10);
        check('workspace-pinned value is updated at workspace level', (m.state.updates[0] || {}).target === 2, m.state.updates);
    }

    // 10. Command palette picker.
    {
        const m = makeVscode({ setting: 'auto', vscodeLanguage: 'en', pickQuick: (items) => items.find((i) => i.value === 'ko') });
        loadExtensionWith(m.vscode).activate(makeContext());
        const registered = [];
        // re-activate with a command spy
        m.vscode.commands.registerCommand = (id, fn) => { registered.push([id, fn]); return { dispose() {} }; };
        loadExtensionWith(m.vscode).activate(makeContext());
        const cmd = registered.find((r) => r[0] === 'mdPrettyViewer.changeLanguage');
        check('changeLanguage command registered', !!cmd);
        if (cmd) await cmd[1]();
        const items = m.state.quickPicks[0] || [];
        check('picker offers auto / en / ko', items.map((i) => i.value).join() === 'auto,en,ko', items);
        check('picker marks the current setting', items[0] && !!items[0].description && !items[1].description, items);
        check('picking Korean saves ko', m.state.updates.some((u) => u.value === 'ko'), m.state.updates);
    }

    // 11. Document text can't break out of the bootstrap script.
    {
        const evil = '# Doc\n\n```html\n<script>alert(1)</script>\n```\n  ';
        const m = makeVscode({ setting: 'en', vscodeLanguage: 'en', docText: evil });
        loadExtensionWith(m.vscode).activate(makeContext());
        const html = openEditor(m).html;
        const closes = (html.match(/<\/script>/g) || []).length;
        const srcTags = (html.match(/<script nonce="[^"]+"[^>]*>/g) || []).length;
        check('</script> in the document is escaped (one close per real script tag)',
            closes === srcTags && html.indexOf('alert(1)</script>') < 0, { srcTags, closes });
        const init = html.match(/initEditor\(([\s\S]*?)\);\s*<\/script>/);
        let content = null;
        try { content = JSON.parse('[' + init[1] + ']')[0]; } catch (e) { content = String(e); }
        check('escaped content round-trips exactly', content === evil, content);
    }

    const passed = results.filter((r) => r[1]).length;
    console.log('RESULT: ' + passed + '/' + results.length + ' passed');
    process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
