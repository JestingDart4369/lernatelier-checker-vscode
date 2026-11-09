// Sidebar panel "Lernatelier": status, findings, calendar and buttons for every action.
import * as vscode from 'vscode';
import type { Finding, Status } from './core';
import { page } from './webview';

export interface SidebarState {
  file: { name: string; uri: string } | null;
  status: Status | null;
  summary: string;
  errors: number;
  warnings: number;
  findings: Array<Pick<Finding, 'severity' | 'message' | 'range'>>;
  calendar: { found: boolean; days: number; next: string | null; problems: string[] } | null;
  notes: string[];
}

/** Commands the panel may run; anything else from the webview is ignored. */
export const PANEL_COMMANDS = [
  'lernatelier.check', 'lernatelier.showReport', 'lernatelier.createConfig',
  'lernatelier.addDay', 'lernatelier.newPeriod', 'lernatelier.openPeriod',
] as const;

type FromWebview =
  | { type: 'ready' }
  | { type: 'command'; command: string }
  | { type: 'reveal'; uri: string; line: number; character: number };

export class SidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'lernatelier.panel';
  private view: vscode.WebviewView | undefined;
  private state: SidebarState = emptyState();

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = page(view.webview, 'Lernatelier', BODY, CSS, SCRIPT);
    view.webview.onDidReceiveMessage(async (msg: FromWebview) => {
      if (msg.type === 'ready') {
        void this.post();
      } else if (msg.type === 'command' && (PANEL_COMMANDS as readonly string[]).includes(msg.command)) {
        await vscode.commands.executeCommand(msg.command);
      } else if (msg.type === 'reveal') {
        const uri = vscode.Uri.parse(msg.uri);
        const editor = await vscode.window.showTextDocument(uri, { preserveFocus: false });
        const pos = new vscode.Position(msg.line, msg.character);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      }
    });
    view.onDidChangeVisibility(() => {
      if (view.visible) void this.post();
    });
  }

  update(state: SidebarState): void {
    this.state = state;
    void this.post();
  }

  getState(): SidebarState {
    return this.state;
  }

  private post(): Thenable<boolean> | undefined {
    return this.view?.webview.postMessage({ type: 'state', state: this.state });
  }
}

export function emptyState(): SidebarState {
  return { file: null, status: null, summary: '', errors: 0, warnings: 0, findings: [], calendar: null, notes: [] };
}

const BODY = `
<main id="app" aria-live="polite"></main>
`;

const CSS = `
body { padding: 8px 12px 16px; background: transparent; }
.status { display: flex; gap: 10px; align-items: center; }
.light { width: 14px; height: 14px; border-radius: 50%; flex: none; border: 2px solid var(--vscode-widget-border, rgba(128,128,128,.4)); }
.light.green { background: var(--vscode-testing-iconPassed, #4f6b3e); border-color: transparent; }
.light.yellow { background: var(--vscode-editorWarning-foreground, #e8a63d); border-color: transparent; }
.light.red { background: var(--vscode-editorError-foreground, #d02267); border-color: transparent; }
.status strong { display: block; }
.file { font-size: 0.9em; color: var(--vscode-descriptionForeground); word-break: break-all; }
.buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 8px; }
.buttons button { width: 100%; }
.buttons .wide { grid-column: 1 / -1; }
ul.findings { list-style: none; padding: 0; margin: 0; }
ul.findings li { margin: 0; }
ul.findings button {
  all: unset; display: grid; grid-template-columns: 1.2em 1fr; gap: 6px; width: 100%; box-sizing: border-box;
  padding: 4px 6px; border-radius: 6px; cursor: pointer; color: var(--vscode-foreground);
}
ul.findings button:hover { background: var(--vscode-list-hoverBackground); }
ul.findings button:focus-visible { outline: 2px solid var(--vscode-focusBorder); }
.sev.error { color: var(--vscode-editorError-foreground); }
.sev.warning { color: var(--vscode-editorWarning-foreground); }
.line { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
.ok { color: var(--vscode-descriptionForeground); }
.notes p { font-size: 0.9em; font-style: italic; }
`;

const SCRIPT = `
const vscode = acquireVsCodeApi();
const app = document.getElementById('app');
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const run = command => vscode.postMessage({ type: 'command', command });
const button = (text, command, cls) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', () => run(command)); return b; };
const LABEL = { red: 'Handlungsbedarf', yellow: 'Verbesserungsbedarf', green: 'Alles in Ordnung' };

function render(s) {
  app.textContent = '';
  if (!s.file) {
    const card = el('div', 'card');
    card.append(el('strong', '', 'Keine Lernperiode offen'),
      el('p', '', 'Öffne eine Datei Lernperiode-N.md oder erstelle eine neue.'));
    const b = el('div', 'buttons');
    b.append(button('Lernperiode öffnen …', 'lernatelier.openPeriod', 'wide'),
      button('Neue Lernperiode erstellen …', 'lernatelier.newPeriod', 'wide secondary'));
    card.append(b);
    app.append(card);
    return;
  }

  const card = el('div', 'card');
  const status = el('div', 'status');
  const light = el('span', 'light ' + (s.status || ''));
  light.setAttribute('role', 'img');
  light.setAttribute('aria-label', s.status ? LABEL[s.status] : 'Noch nicht geprüft');
  const text = el('div');
  text.append(el('strong', '', s.status ? LABEL[s.status] : 'Wird geprüft …'),
    el('span', 'file', s.file.name));
  status.append(light, text);
  card.append(status);
  if (s.status) card.append(el('p', '', s.errors + ' Fehler · ' + s.warnings + (s.warnings === 1 ? ' Warnung' : ' Warnungen')));
  const b = el('div', 'buttons');
  b.append(button('Prüfen', 'lernatelier.check'), button('Bericht', 'lernatelier.showReport', 'secondary'));
  card.append(b);
  app.append(card);

  app.append(el('h2', '', 'Hinweise'));
  if (!s.findings.length) {
    app.append(el('p', 'ok', s.status ? 'Keine Hinweise.' : '…'));
  } else {
    const list = el('ul', 'findings');
    for (const f of s.findings) {
      const li = el('li');
      const btn = el('button');
      btn.type = 'button';
      btn.title = 'Zur Stelle springen';
      const sev = el('span', 'sev ' + f.severity, f.severity === 'error' ? '●' : '▲');
      sev.setAttribute('aria-label', f.severity === 'error' ? 'Fehler' : 'Warnung');
      const body = el('span');
      body.append(el('span', '', f.message), el('span', 'line', ' · Zeile ' + (f.range.startLine + 1)));
      btn.append(sev, body);
      btn.addEventListener('click', () => vscode.postMessage({ type: 'reveal', uri: s.file.uri, line: f.range.startLine, character: f.range.startCharacter }));
      li.append(btn);
      list.append(li);
    }
    app.append(list);
  }

  app.append(el('h2', '', 'Kalender'));
  const cal = el('div', 'card');
  const c = s.calendar;
  if (!c || !c.found) {
    cal.append(el('p', '', 'Noch keine lernperiode.json. Mit Kalender werden die Tagesplanungen bis heute und für den nächsten Unterrichtstag geprüft.'));
    cal.append(button('Kalender erstellen …', 'lernatelier.createConfig', 'wide'));
  } else {
    cal.append(el('strong', '', c.days + ' Unterrichtstage'));
    cal.append(el('p', '', c.next ? 'Nächster Unterrichtstag: ' + c.next : 'Kein weiterer Unterrichtstag.'));
    for (const p of c.problems) cal.append(el('p', 'sev error', p));
    cal.append(button('Kalender bearbeiten …', 'lernatelier.createConfig', 'wide secondary'));
  }
  app.append(cal);

  app.append(el('h2', '', 'Planen'));
  const plan = el('div', 'buttons');
  plan.append(button('Nächste Tagesplanung einfügen', 'lernatelier.addDay', 'wide'),
    button('Neue Lernperiode erstellen …', 'lernatelier.newPeriod', 'wide secondary'));
  app.append(plan);

  if (s.notes.length) {
    const notes = el('div', 'notes');
    for (const n of s.notes) notes.append(el('p', 'muted', n));
    app.append(notes);
  }
}

window.addEventListener('message', e => { if (e.data.type === 'state') render(e.data.state); });
vscode.postMessage({ type: 'ready' });
`;
