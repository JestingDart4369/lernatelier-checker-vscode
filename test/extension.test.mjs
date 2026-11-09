// Loads the real bundle dist/extension.js against a small stand-in for the VS Code API and
// checks what a student sees: Problems entries, status bar, report and the three commands.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import Module, { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const wait = (ms = 30) => new Promise(r => setTimeout(r, ms));

// ---- VS Code stand-in --------------------------------------------------------------------
function createVscode() {
  const listeners = {};
  const on = name => fn => ((listeners[name] ??= []).push(fn), { dispose() {} });
  const fire = (name, arg) => (listeners[name] ?? []).forEach(fn => fn(arg));
  const collections = {};
  const commands = {};
  const inputs = [];
  const quickPicks = [];
  const answers = [];
  const messages = [];
  const config = { enable: true, filePattern: '**/Lernperiode-*.md', checkWhileTyping: true };

  class Uri {
    constructor(fsPath) { this.fsPath = fsPath; this.path = fsPath; this.scheme = 'file'; }
    toString() { return `file://${this.fsPath}`; }
    static file(p) { return new Uri(p); }
    static joinPath(base, ...parts) { return new Uri(join(base.fsPath, ...parts)); }
    static parse(s) { return new Uri(s.replace('file://', '')); }
  }
  class Position { constructor(line, character) { this.line = line; this.character = character; } }
  class Range {
    constructor(a, b, c, d) {
      this.start = typeof a === 'number' ? new Position(a, b) : a;
      this.end = typeof a === 'number' ? new Position(c, d) : b;
    }
  }
  class Selection extends Range {}
  class Diagnostic { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } }
  class MarkdownString { constructor() { this.value = ''; } appendMarkdown(s) { this.value += s; return this; } }
  class ThemeColor { constructor(id) { this.id = id; } }

  function makeDoc(fsPath, text, languageId = 'markdown') {
    const doc = {
      uri: Uri.file(fsPath), fileName: fsPath, languageId, _text: text,
      getText() { return this._text; },
      get lineCount() { return this._text.split('\n').length; },
      lineAt(n) { const t = this._text.split('\n')[n]; return { text: t, range: { end: new Position(n, t.length) } }; },
    };
    return doc;
  }
  const textDocuments = [];
  const window = {
    activeTextEditor: undefined,
    createOutputChannel: () => ({ text: '', clear() { this.text = ''; }, appendLine(s) { this.text += s + '\n'; }, show() {}, dispose() {} }),
    createStatusBarItem: () => ({ visible: false, show() { this.visible = true; }, hide() { this.visible = false; }, dispose() {} }),
    showInformationMessage: async m => { messages.push(m); },
    showWarningMessage: async (m, ...rest) => { messages.push(m); return rest.length > 1 ? answers.shift() : undefined; },
    showQuickPick: async (items, opts) => { const pick = quickPicks.shift(); return pick ? pick(items, opts) : undefined; },
    showInputBox: async opts => {
      const value = inputs.shift();
      if (value !== undefined && opts?.validateInput) {
        const err = opts.validateInput(value);
        if (err) throw new Error(`input rejected: ${err}`);
      }
      return value;
    },
    showTextDocument: async uri => {
      const p = uri.fsPath ?? uri.uri.fsPath;
      let doc = textDocuments.find(d => d.fileName === p);
      if (!doc) { doc = makeDoc(p, await readFile(p, 'utf8'), p.endsWith('.json') ? 'json' : 'markdown'); textDocuments.push(doc); fire('open', doc); }
      window.activeTextEditor = editorFor(doc);
      fire('active');
      return window.activeTextEditor;
    },
    showWorkspaceFolderPick: async () => undefined,
    showOpenDialog: async () => undefined,
    onDidChangeActiveTextEditor: on('active'),
  };
  function editorFor(doc) {
    return {
      document: doc, selection: null,
      async edit(cb) {
        const edits = [];
        cb({ insert: (pos, text) => edits.push({ pos, text }) });
        for (const { pos, text } of edits) {
          const lines = doc._text.split('\n');
          const offset = lines.slice(0, pos.line).reduce((n, l) => n + l.length + 1, 0) + pos.character;
          doc._text = doc._text.slice(0, offset) + text + doc._text.slice(offset);
        }
        fire('change', { document: doc });
        return true;
      },
      revealRange() {},
    };
  }
  const glob = pattern => new RegExp('^' + basename(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
  const vscode = {
    Uri, Position, Range, Selection, Diagnostic, MarkdownString, ThemeColor,
    DiagnosticSeverity: { Error: 0, Warning: 1 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    TextEditorRevealType: { InCenter: 2 },
    languages: {
      createDiagnosticCollection: name => (collections[name] = {
        map: new Map(), set(uri, d) { this.map.set(uri.toString(), d); }, delete(uri) { this.map.delete(uri.toString()); },
        clear() { this.map.clear(); }, get(uri) { return this.map.get(uri.toString()); }, dispose() {},
      }),
      match: (selector, doc) => (doc.languageId === selector.language && glob(selector.pattern).test(basename(doc.fileName)) ? 10 : 0),
    },
    window,
    commands: { registerCommand: (id, fn) => ((commands[id] = fn), { dispose() {} }) },
    workspace: {
      textDocuments,
      workspaceFolders: undefined,
      getConfiguration: () => ({ get: (k, d) => (k in config ? config[k] : d) }),
      asRelativePath: uri => basename(uri.fsPath),
      createFileSystemWatcher: () => ({ onDidChange: () => ({ dispose() {} }), onDidCreate: () => ({ dispose() {} }), onDidDelete: () => ({ dispose() {} }), dispose() {} }),
      fs: {
        readFile: async uri => new Uint8Array(await readFile(uri.fsPath)),
        writeFile: async (uri, data) => writeFile(uri.fsPath, data),
        stat: async uri => stat(uri.fsPath),
      },
      onDidOpenTextDocument: on('open'),
      onDidSaveTextDocument: on('save'),
      onDidChangeTextDocument: on('change'),
      onDidCloseTextDocument: on('close'),
      onDidChangeConfiguration: on('config'),
    },
  };
  return { vscode, collections, commands, inputs, quickPicks, answers, messages, makeDoc, editorFor, fire, textDocuments };
}

async function activate() {
  const env = createVscode();
  const original = Module._load;
  Module._load = function (request, ...rest) {
    return request === 'vscode' ? env.vscode : original.call(this, request, ...rest);
  };
  const bundle = join(here, '../dist/extension.js');
  delete require.cache[bundle];
  const ext = require(bundle);
  Module._load = original;
  const context = { subscriptions: [] };
  ext.activate(context);
  return { ...env, ext, context };
}

const statusOf = env => env.context.subscriptions.find(s => 'hide' in s && 'show' in s && !('appendLine' in s));

async function workdir(files) {
  const dir = await mkdtemp(join(tmpdir(), 'lernatelier-'));
  for (const [name, source] of Object.entries(files)) await copyFile(join(here, 'fixtures', source), join(dir, name));
  return dir;
}

test('a complete document with lernperiode.json shows no problems and a green status', async () => {
  const dir = await workdir({ 'Lernperiode-5.md': 'Lernperiode-5.md', 'lernperiode.json': 'lernperiode.json' });
  const env = await activate();
  await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md')));
  await wait();
  assert.deepEqual(env.collections.lernatelier.get(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md'))), []);
  const status = statusOf(env);
  assert.equal(status.visible, true);
  assert.match(status.text, /^\$\(pass\) Lernatelier$/);
  assert.equal(status.backgroundColor, undefined);
});

test('the template shows errors in the Problems panel and a red status', async () => {
  const dir = await workdir({ 'Lernperiode-1.md': 'Lernperiode-template.md' });
  const env = await activate();
  const uri = env.vscode.Uri.file(join(dir, 'Lernperiode-1.md'));
  await env.vscode.window.showTextDocument(uri);
  await wait();
  const diags = env.collections.lernatelier.get(uri);
  assert.ok(diags.length >= 5);
  assert.ok(diags.every(d => d.source === 'Lernatelier' && d.code));
  const name = diags.find(d => d.code === 'name.missing');
  assert.equal(name.severity, 0);
  assert.equal(name.range.start.line, 17); // "- Name: Exemplibus Exemplio"
  const status = statusOf(env);
  assert.match(status.text, /^\$\(error\) Lernatelier \d+$/);
  assert.equal(status.backgroundColor.id, 'statusBarItem.errorBackground');
  assert.match(status.tooltip.value, /Handlungsbedarf/);
  assert.match(status.tooltip.value, /lernperiode\.json nicht gefunden/);
});

test('other Markdown files are not checked', async () => {
  const dir = await workdir({ 'README.md': 'Lernperiode-template.md' });
  const env = await activate();
  const uri = env.vscode.Uri.file(join(dir, 'README.md'));
  await env.vscode.window.showTextDocument(uri);
  await wait();
  assert.equal(env.collections.lernatelier.get(uri), undefined);
  const status = statusOf(env);
  assert.equal(status.visible, false);
});

test('an invalid lernperiode.json is reported on the config file and checks still run', async () => {
  const dir = await workdir({ 'Lernperiode-5.md': 'Lernperiode-5.md' });
  await writeFile(join(dir, 'lernperiode.json'), '{ "learningperiod": "fünf", "days": ["18.09.2026"] }');
  const env = await activate();
  await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md')));
  await wait();
  const cfgDiags = env.collections['lernatelier-config'].get(env.vscode.Uri.file(join(dir, 'lernperiode.json')));
  assert.equal(cfgDiags.length, 2);
  assert.deepEqual(env.collections.lernatelier.get(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md'))), []);
});

test('typing re-checks the document', async () => {
  const dir = await workdir({ 'Lernperiode-5.md': 'Lernperiode-5.md' });
  const env = await activate();
  const editor = await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md')));
  await wait();
  editor.document._text = editor.document._text.replace('Name: Max Beispiel', 'Name: Exemplibus Exemplio');
  env.fire('change', { document: editor.document });
  await wait(600);
  const diags = env.collections.lernatelier.get(editor.document.uri);
  assert.ok(diags.some(d => d.code === 'name.missing'));
});

test('report command writes the full report', async () => {
  const dir = await workdir({ 'Lernperiode-1.md': 'Lernperiode-template.md' });
  const env = await activate();
  await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-1.md')));
  await env.commands['lernatelier.check']();
  const channel = env.context.subscriptions.find(s => 'appendLine' in s);
  assert.match(channel.text, /^Lernperiode-1\.md/);
  assert.match(channel.text, /FEHLER   Zeile 18: Name fehlt/);
  assert.match(channel.text, /→ Handlungsbedarf/);
});

test('new period command creates Lernperiode-N.md from the template and never overwrites', async () => {
  const dir = await workdir({ 'Lernperiode-5.md': 'Lernperiode-5.md' });
  const env = await activate();
  await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md')));
  env.inputs.push('6');
  await env.commands['lernatelier.newPeriod']();
  const created = await readFile(join(dir, 'Lernperiode-6.md'), 'utf8');
  assert.match(created, /^# Lern-Periode 6$/m);
  assert.match(created, /Exemplibus Exemplio/);
  env.inputs.push('5');
  const before = await readFile(join(dir, 'Lernperiode-5.md'), 'utf8');
  await env.commands['lernatelier.newPeriod']();
  assert.equal(await readFile(join(dir, 'Lernperiode-5.md'), 'utf8'), before);
  assert.ok(env.messages.some(m => /gibt es in diesem Ordner schon/.test(m)));
});

test('generator: reads number and Zeitraum, preselects the usual weekday, writes the ticked days', async () => {
  const dir = await workdir({ 'Lernperiode-5.md': 'Lernperiode-5.md' });
  await writeFile(join(dir, 'Lernperiode-5.md'), (await readFile(join(dir, 'Lernperiode-5.md'), 'utf8'))
    .replace('Zeitraum: 18.09.2026 bis 25.09.2026', 'Zeitraum: 18.09.2026 bis 16.10.2026'));
  const env = await activate();
  await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md')));
  let weekdayItems, dayItems;
  env.inputs.push('5'); // number, prefilled from "# Lern-Periode 5"
  env.quickPicks.push(items => { weekdayItems = items; return items.filter(i => i.picked); });
  env.quickPicks.push(items => { dayItems = items; return items.filter(i => i.iso !== '2026-10-09'); }); // untick a holiday
  await env.commands['lernatelier.createConfig']();
  assert.deepEqual(weekdayItems.filter(i => i.picked).map(i => i.label), ['Freitag']);
  assert.deepEqual(dayItems.map(i => i.label), ['Fr 18.09.2026', 'Fr 25.09.2026', 'Fr 02.10.2026', 'Fr 09.10.2026', 'Fr 16.10.2026']);
  assert.ok(dayItems.every(i => i.picked));
  assert.equal(dayItems[0].description, 'im Dokument geplant');
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'lernperiode.json'), 'utf8')),
    { learningperiod: 5, days: ['2026-09-18', '2026-09-25', '2026-10-02', '2026-10-16'] });
});

test('generator: asks for the Zeitraum when the document has none', async () => {
  const dir = await workdir({ 'Lernperiode-1.md': 'Lernperiode-template.md' });
  const env = await activate();
  await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-1.md')));
  env.inputs.push('1', '02.11.2026', '13.11.2026');
  env.quickPicks.push(items => items.filter(i => ['Montag', 'Mittwoch'].includes(i.label)));
  env.quickPicks.push(items => items);
  await env.commands['lernatelier.createConfig']();
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'lernperiode.json'), 'utf8')),
    { learningperiod: 1, days: ['2026-11-02', '2026-11-04', '2026-11-09', '2026-11-11'] });
});

test('generator: replaces an existing lernperiode.json only after confirmation', async () => {
  const dir = await workdir({ 'Lernperiode-5.md': 'Lernperiode-5.md', 'lernperiode.json': 'lernperiode.json' });
  const env = await activate();
  await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md')));
  const before = await readFile(join(dir, 'lernperiode.json'), 'utf8');
  env.answers.push(undefined); // "Abbrechen"
  await env.commands['lernatelier.createConfig']();
  assert.equal(await readFile(join(dir, 'lernperiode.json'), 'utf8'), before);
  env.answers.push('Ersetzen');
  env.inputs.push('5');
  env.quickPicks.push(items => items.filter(i => i.picked));
  env.quickPicks.push(items => items.slice(0, 1));
  await env.commands['lernatelier.createConfig']();
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'lernperiode.json'), 'utf8')), { learningperiod: 5, days: ['2026-09-18'] });
});

test('add-day command inserts the next configured day before the period reflection', async () => {
  const dir = await workdir({ 'Lernperiode-5.md': 'Lernperiode-5.md' });
  await writeFile(join(dir, 'lernperiode.json'), JSON.stringify({ learningperiod: 5, days: ['2026-09-18', '2026-09-25', '2099-01-07'] }));
  const env = await activate();
  const editor = await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md')));
  await env.commands['lernatelier.addDay']();
  const text = editor.document.getText();
  assert.match(text, /### Planung 07\.01\.2099\n\n- \[ \] \.\.\.Ihr Text\.\.\./);
  assert.ok(text.indexOf('### Planung 07.01.2099') < text.indexOf('## Lernperiode Reflexion'));
  assert.ok(text.indexOf('### Planung 25.09.2026') < text.indexOf('### Planung 07.01.2099'));
  assert.equal(editor.selection.start.line, text.split('\n').findIndex(l => l === '### Planung 07.01.2099') + 2);
});
