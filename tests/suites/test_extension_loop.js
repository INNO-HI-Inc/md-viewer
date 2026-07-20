#!/usr/bin/env node
/**
 * Loop-safety test for the "markdown opened as a plain TEXT tab → re-open in
 * the custom editor" safety net (extension.js).
 *
 * v1.0.34 shipped this without a re-entrancy guard: the vscode.openWith it
 * issued fired the very tab events that re-triggered the sweep, so with TWO
 * markdown files the editor ping-ponged between them forever. This test loads
 * extension.js against a mocked `vscode` module and asserts the sweep
 * terminates — including when the conversion is slow or fails outright.
 */
'use strict';
const path = require('path');
const Module = require('module');

const results = [];
function check(name, ok, detail) {
    results.push([name, ok]);
    console.log((ok ? 'PASS' : 'FAIL') + ' - ' + name + (!ok && detail !== undefined ? ': ' + JSON.stringify(detail) : ''));
}

// ── Mock vscode ──────────────────────────────────────────────────────────
class TabInputText { constructor(uri) { this.uri = uri; } }
class TabInputCustom { constructor(uri, viewType) { this.uri = uri; this.viewType = viewType; } }

function makeVscode() {
    const tabChangeCbs = [];
    const visEditorCbs = [];
    const openWithCalls = [];
    const group = { viewColumn: 1, tabs: [] };

    const vscode = {
        TabInputText, TabInputCustom,
        Uri: {
            file: (p) => ({ scheme: 'file', fsPath: p, toString: () => 'file://' + p }),
            parse: (s) => ({ scheme: 'https', fsPath: s, toString: () => s }),
            joinPath: (base, ...parts) => vscode.Uri.file(path.join(base.fsPath, ...parts)),
        },
        window: {
            tabGroups: {
                all: [group],
                onDidChangeTabs: (cb) => { tabChangeCbs.push(cb); return { dispose() {} }; },
                get activeTabGroup() { return group; },
            },
            onDidChangeVisibleTextEditors: (cb) => { visEditorCbs.push(cb); return { dispose() {} }; },
            registerCustomEditorProvider: () => ({ dispose() {} }),
            showInformationMessage: () => ({ then: () => {} }),
            showWarningMessage: () => {},
            activeTextEditor: undefined,
            createWebviewPanel: () => ({}),
        },
        workspace: {
            getConfiguration: () => ({ get: () => ({}) }),   // no editorAssociations pin
            onDidChangeTextDocument: () => ({ dispose() {} }),
            onDidChangeConfiguration: () => ({ dispose() {} }),
            workspaceFolders: [],
            applyEdit: async () => true,
        },
        commands: {
            registerCommand: () => ({ dispose() {} }),
            executeCommand: (cmd, uri, viewType, opts) => {
                if (cmd === 'vscode.openWith') openWithCalls.push({ uri: uri.toString(), viewType, opts });
                return Promise.resolve();
            },
        },
        env: { openExternal: () => Promise.resolve(true) },
        Range: class {}, Position: class {}, WorkspaceEdit: class { replace() {} },
        ViewColumn: { Active: -1 },
    };
    return { vscode, tabChangeCbs, visEditorCbs, openWithCalls, group };
}

function loadExtensionWith(vscode) {
    const origLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (request === 'vscode') return vscode;
        return origLoad.apply(this, arguments);
    };
    const extPath = path.resolve(__dirname, '../../extension.js');
    delete require.cache[extPath];
    let ext;
    try { ext = require(extPath); } finally { Module._load = origLoad; }
    return ext;
}

function makeContext() {
    return {
        subscriptions: [],
        extensionUri: { fsPath: '/ext', scheme: 'file', toString: () => 'file:///ext' },
        extension: { packageJSON: { version: '9.9.9' } },
        globalState: { get: () => '9.9.9', update: () => {} },   // same version → no update toast
    };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Scenario A: two markdown TEXT tabs, conversion SUCCEEDS ───────────────
async function scenarioTwoFilesConversionWorks() {
    const m = makeVscode();
    const ext = loadExtensionWith(m.vscode);
    const uriA = m.vscode.Uri.file('/w/a.md');
    const uriB = m.vscode.Uri.file('/w/b.md');
    m.group.tabs = [
        { input: new TabInputText(uriA), group: m.group },
        { input: new TabInputText(uriB), group: m.group },
    ];

    // Model the REAL race: vscode.openWith is async — VS Code fires tab events
    // immediately, but the tab is still a TEXT tab until the conversion lands a
    // tick later. That window is what let v1.0.34 re-issue openWith forever.
    // (Hard cap so a regressed build fails the assert instead of hanging.)
    const CAP = 60;
    m.vscode.commands.executeCommand = (cmd, uri, viewType, opts) => {
        if (cmd === 'vscode.openWith') {
            m.openWithCalls.push({ uri: uri.toString(), viewType, opts });
            if (m.openWithCalls.length > CAP) return Promise.resolve();
            m.tabChangeCbs.forEach((cb) => cb({}));           // event BEFORE conversion
            setTimeout(() => {                                 // conversion lands later
                const t = m.group.tabs.find((x) => x.input.uri.toString() === uri.toString());
                if (t) t.input = new TabInputCustom(uri, viewType);
                m.tabChangeCbs.forEach((cb) => cb({}));
            }, 10);
        }
        return Promise.resolve();
    };

    ext.activate(makeContext());
    m.tabChangeCbs.forEach((cb) => cb({}));                    // initial trigger
    await sleep(700);                                          // let all passes settle

    const perUri = {};
    m.openWithCalls.forEach((c) => { perUri[c.uri] = (perUri[c.uri] || 0) + 1; });
    check('A: converts both files', Object.keys(perUri).length === 2, perUri);
    check('A: exactly one openWith per file (no loop)',
        Object.values(perUri).every((n) => n === 1), perUri);
    check('A: total openWith calls bounded (== 2)', m.openWithCalls.length === 2, m.openWithCalls.length);
    check('A: uses preserveFocus (no focus ping-pong)',
        m.openWithCalls.every((c) => c.opts && c.opts.preserveFocus === true),
        m.openWithCalls.map((c) => c.opts));
}

// ── Scenario B: conversion FAILS (tab stays text) — must not retry forever ─
async function scenarioConversionFails() {
    const m = makeVscode();
    const ext = loadExtensionWith(m.vscode);
    const uriA = m.vscode.Uri.file('/w/a.md');
    const uriB = m.vscode.Uri.file('/w/b.md');
    m.group.tabs = [
        { input: new TabInputText(uriA), group: m.group },
        { input: new TabInputText(uriB), group: m.group },
    ];
    // openWith does NOT convert (stays a text tab) but still emits events.
    m.vscode.commands.executeCommand = (cmd, uri, viewType, opts) => {
        if (cmd === 'vscode.openWith') {
            m.openWithCalls.push({ uri: uri.toString(), viewType, opts });
            m.tabChangeCbs.forEach((cb) => cb({}));
        }
        return Promise.resolve();
    };

    ext.activate(makeContext());
    m.tabChangeCbs.forEach((cb) => cb({}));
    await sleep(800);
    // Keep poking the listeners like a busy editor would.
    for (let i = 0; i < 5; i++) { m.tabChangeCbs.forEach((cb) => cb({})); await sleep(60); }
    await sleep(400);

    check('B: failed conversion is not retried in a loop', m.openWithCalls.length === 2, m.openWithCalls.length);
}

// ── Scenario C: closing the tab lets a later re-open convert again ─────────
async function scenarioReopenAfterClose() {
    const m = makeVscode();
    const ext = loadExtensionWith(m.vscode);
    const uriA = m.vscode.Uri.file('/w/a.md');
    m.group.tabs = [{ input: new TabInputText(uriA), group: m.group }];
    m.vscode.commands.executeCommand = (cmd, uri, viewType, opts) => {
        if (cmd === 'vscode.openWith') {
            m.openWithCalls.push({ uri: uri.toString(), viewType, opts });
            m.tabChangeCbs.forEach((cb) => cb({}));
        }
        return Promise.resolve();
    };
    ext.activate(makeContext());
    m.tabChangeCbs.forEach((cb) => cb({}));
    await sleep(400);
    const afterFirst = m.openWithCalls.length;

    // user closes the tab …
    m.group.tabs = [];
    m.tabChangeCbs.forEach((cb) => cb({}));
    await sleep(300);
    // … then opens the same file as text again
    m.group.tabs = [{ input: new TabInputText(uriA), group: m.group }];
    m.tabChangeCbs.forEach((cb) => cb({}));
    await sleep(400);

    check('C: same file converts again after its tab was closed',
        afterFirst === 1 && m.openWithCalls.length === 2, { afterFirst, total: m.openWithCalls.length });
}

// ── Scenario D: user pinned *.md to the text editor → never convert ────────
async function scenarioUserPinnedText() {
    const m = makeVscode();
    m.vscode.workspace.getConfiguration = () => ({ get: () => ({ '*.md': 'default' }) });
    const ext = loadExtensionWith(m.vscode);
    m.group.tabs = [{ input: new TabInputText(m.vscode.Uri.file('/w/a.md')), group: m.group }];
    ext.activate(makeContext());
    m.tabChangeCbs.forEach((cb) => cb({}));
    await sleep(400);
    check('D: respects workbench.editorAssociations "*.md": "default"',
        m.openWithCalls.length === 0, m.openWithCalls.length);
}

(async () => {
    await scenarioTwoFilesConversionWorks();
    await scenarioConversionFails();
    await scenarioReopenAfterClose();
    await scenarioUserPinnedText();

    const failed = results.filter(([, ok]) => !ok);
    console.log('\nRESULT: ' + (results.length - failed.length) + '/' + results.length + ' passed');
    process.exit(failed.length ? 1 : 0);
})();
