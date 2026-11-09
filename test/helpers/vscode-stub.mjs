// Stand-in for the VS Code API, used by the extension tests and the screenshot script.
import { readFile, writeFile, stat } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ---- VS Code stand-in --------------------------------------------------------------------
export function createVscode() {
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
    createWebviewPanel: (viewType, title) => {
      const panel = makeWebview();
      Object.assign(panel, { viewType, title, revealed: 0, disposed: false,
        reveal() { this.revealed++; }, onDidDispose: fn => { panel._onDispose = fn; return { dispose() {} }; },
        dispose() { this.disposed = true; panel._onDispose?.(); } });
      panels.push(panel);
      return panel;
    },
    registerWebviewViewProvider: (id, provider) => { views[id] = provider; return { dispose() {} }; },
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
  const panels = [];
  const views = {};
  const executed = [];
  function makeWebview() {
    const webview = {
      html: '', cspSource: 'vscode-resource:', options: {}, sent: [],
      postMessage: async msg => { webview.sent.push(msg); return true; },
      onDidReceiveMessage: fn => { webview._handler = fn; return { dispose() {} }; },
    };
    return { webview, async send(msg) { await webview._handler(msg); }, last(type) { return [...webview.sent].reverse().find(m => m.type === type); } };
  }
  const glob = pattern => new RegExp('^' + basename(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
  const vscode = {
    Uri, Position, Range, Selection, Diagnostic, MarkdownString, ThemeColor,
    DiagnosticSeverity: { Error: 0, Warning: 1 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    TextEditorRevealType: { InCenter: 2 },
    ViewColumn: { Beside: -2, Active: -1 },
    languages: {
      createDiagnosticCollection: name => (collections[name] = {
        map: new Map(), set(uri, d) { this.map.set(uri.toString(), d); }, delete(uri) { this.map.delete(uri.toString()); },
        clear() { this.map.clear(); }, get(uri) { return this.map.get(uri.toString()); }, dispose() {},
      }),
      match: (selector, doc) => (doc.languageId === selector.language && glob(selector.pattern).test(basename(doc.fileName)) ? 10 : 0),
    },
    window,
    commands: {
      registerCommand: (id, fn) => ((commands[id] = fn), { dispose() {} }),
      executeCommand: async (id, ...args) => { executed.push(id); return commands[id]?.(...args); },
    },
    workspace: {
      textDocuments,
      workspaceFolders: undefined,
      findFiles: async () => [],
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
  return { vscode, collections, commands, inputs, quickPicks, answers, messages, makeDoc, editorFor, fire, textDocuments,
    panels, views, executed, makeWebview };
}

export async function activate() {
  const env = createVscode();
  const original = Module._load;
  Module._load = function (request, ...rest) {
    return request === 'vscode' ? env.vscode : original.call(this, request, ...rest);
  };
  const bundle = join(here, '../../dist/extension.js');
  delete require.cache[bundle];
  const ext = require(bundle);
  Module._load = original;
  const context = { subscriptions: [] };
  ext.activate(context);
  return { ...env, ext, context };
}

