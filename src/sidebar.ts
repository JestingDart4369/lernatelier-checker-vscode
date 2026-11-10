// Sidebar panel "Lernatelier": status, findings, calendar and buttons for every action.
import * as vscode from 'vscode';
import type { Finding, Status } from './core';
import type { Progress } from './progress';
import { page } from './webview';

export interface SidebarState {
  file: { name: string; uri: string } | null;
  status: Status | null;
  summary: string;
  errors: number;
  warnings: number;
  findings: Array<Pick<Finding, 'severity' | 'message' | 'range'>>;
  calendar: { found: boolean; days: number; next: string | null; problems: string[]; file: string; reason: string | null } | null;
  notes: string[];
  /** the open file is ignored */
  ignored: boolean;
  progress: Progress | null;
  /** every Lernperiode in the folder, also those that are not open */
  files: Array<{ name: string; uri: string; status: Status | null; errors: number; warnings: number; ignored: boolean; active: boolean }>;
}

/** Commands the panel may run; anything else from the webview is ignored. */
export const PANEL_COMMANDS = [
  'lernatelier.check', 'lernatelier.showReport', 'lernatelier.createConfig',
  'lernatelier.addDay', 'lernatelier.newPeriod', 'lernatelier.openPeriod',
  'lernatelier.ignoreOlder', 'lernatelier.checkWorkspace', 'lernatelier.carryOver', 'lernatelier.welcome',
] as const;

type FromWebview =
  | { type: 'ready' }
  | { type: 'command'; command: string }
  | { type: 'reveal'; uri: string; line: number; character: number }
  | { type: 'open'; uri: string }
  | { type: 'ignore'; uri: string; ignore: boolean };

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
      } else if (msg.type === 'open') {
        await vscode.window.showTextDocument(vscode.Uri.parse(msg.uri), { preserveFocus: false });
      } else if (msg.type === 'ignore') {
        await vscode.commands.executeCommand(msg.ignore ? 'lernatelier.ignoreFile' : 'lernatelier.unignoreFile', msg.uri);
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
  return { file: null, status: null, summary: '', errors: 0, warnings: 0, findings: [], calendar: null, notes: [], ignored: false, files: [], progress: null };
}

const BODY = `
<main id="app" aria-live="polite"></main>
`;

const CSS = `
body { padding: 8px 12px 16px; background: transparent; }
.card { background: var(--vscode-editor-background); }
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
.bar { margin: 6px 0; }
.bar .top { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0 8px; font-size: 0.92em; }
.bar .top span:last-child { color: var(--vscode-descriptionForeground); margin-left: auto; text-align: right; }
.track { height: 6px; border-radius: 999px; background: var(--vscode-widget-border, rgba(128,128,128,.3)); overflow: hidden; margin-top: 3px; }
.fill { height: 100%; border-radius: 999px; background: var(--vscode-progressBar-background, var(--vscode-button-background)); }
.fill.warn { background: var(--vscode-editorWarning-foreground); }
.fill.w0 { width: 0 } .fill.w10 { width: 10% } .fill.w20 { width: 20% } .fill.w30 { width: 30% } .fill.w40 { width: 40% }
.fill.w50 { width: 50% } .fill.w60 { width: 60% } .fill.w70 { width: 70% } .fill.w80 { width: 80% } .fill.w90 { width: 90% } .fill.w100 { width: 100% }
ul.days { list-style: none; padding: 0; margin: 6px 0 0; display: grid; grid-template-columns: 1fr 1fr; gap: 2px 8px; }
ul.days button { all: unset; display: flex; gap: 6px; align-items: center; padding: 2px 4px; border-radius: 6px; cursor: pointer; font-size: 0.92em; width: 100%; box-sizing: border-box; }
ul.days button:hover { background: var(--vscode-list-hoverBackground); }
ul.days button:focus-visible { outline: 2px solid var(--vscode-focusBorder); }
ul.days button:disabled { cursor: default; }
.st { width: 1.1em; text-align: center; font-weight: 700; }
.st.complete, .st.next { color: var(--vscode-testing-iconPassed, inherit); }
.st.incomplete { color: var(--vscode-editorWarning-foreground); }
.st.missing { color: var(--vscode-editorError-foreground); }
.st.absent, .st.later { color: var(--vscode-descriptionForeground); }
ul.files { list-style: none; padding: 0; margin: 0; }
ul.files li { display: grid; grid-template-columns: 1fr auto; gap: 6px; align-items: center; }
ul.files .open {
  all: unset; display: flex; gap: 8px; align-items: center; padding: 4px 6px; border-radius: 6px; cursor: pointer; min-width: 0;
}
ul.files .open:hover { background: var(--vscode-list-hoverBackground); }
ul.files .open:focus-visible { outline: 2px solid var(--vscode-focusBorder); }
ul.files .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
ul.files li.active .name { font-weight: 600; }
ul.files li.ignored .name { color: var(--vscode-descriptionForeground); text-decoration: line-through; }
ul.files .count { color: var(--vscode-descriptionForeground); font-size: 0.9em; white-space: nowrap; }
ul.files button.small { padding: 2px 8px; font-size: 0.9em; }
.light.small { flex: none; width: 10px; height: 10px; border-width: 1px; }
.light.off { background: transparent; border: 1px dashed var(--vscode-descriptionForeground); }
.head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.head h2 { margin-bottom: 0.5em; }
.link { all: unset; cursor: pointer; color: var(--vscode-textLink-foreground); font-size: 0.9em; }
.link:hover { text-decoration: underline; }
.link:focus-visible { outline: 2px solid var(--vscode-focusBorder); }
`;

const SCRIPT = `
const vscode = acquireVsCodeApi();
const app = document.getElementById('app');
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const run = command => vscode.postMessage({ type: 'command', command });
const button = (text, command, cls) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', () => run(command)); return b; };
const LABEL = { red: 'Handlungsbedarf', yellow: 'Verbesserungsbedarf', green: 'Alles in Ordnung' };

const STATE = {
  complete: ['✓', 'erledigt'], next: ['✓', 'geplant (nächster Tag)'], incomplete: ['!', 'unvollständig'],
  missing: ['✗', 'fehlt'], absent: ['–', 'abwesend'], later: ['○', 'später'],
};
function bar(label, value, max, warn) {
  const box = el('div', 'bar');
  const top = el('div', 'top');
  top.append(el('span', '', label), el('span', '', value + ' / ' + max));
  const track = el('div', 'track');
  const pct = max ? Math.min(100, Math.round((value / max) * 10) * 10) : 0;
  const fill = el('div', 'fill w' + pct + (warn ? ' warn' : ''));
  track.append(fill);
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', label);
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', String(max));
  track.setAttribute('aria-valuenow', String(value));
  box.append(top, track);
  return box;
}
function progressSection(s) {
  const p = s.progress;
  if (!p) return;
  app.append(el('h2', '', 'Fortschritt'));
  const card = el('div', 'card');
  card.append(bar(p.calendar ? 'Tage bis jetzt vollständig' : 'Tage vollständig', p.complete, p.required, p.complete < p.required));
  card.append(bar('Arbeitspakete erledigt', p.tasksDone, p.tasksFilled, false));
  card.append(bar('Tagesreflexionen', p.reflectionsOk, p.reflectionsDue, p.reflectionsOk < p.reflectionsDue));
  card.append(bar('Grobplanung', p.overviewDone, 4, p.overviewDone < 4));
  const pr = p.periodReflection;
  const prBar = bar('Lernperiodenreflexion', pr.words, pr.max, pr.due && !pr.ok);
  prBar.querySelector('.top span:last-child').textContent = pr.words + ' / ' + pr.min + '–' + pr.max + ' Wörter' + (pr.due ? '' : ' · später fällig');
  card.append(prBar);
  if (p.days.length) {
    const list = el('ul', 'days');
    for (const d of p.days) {
      const li = el('li');
      const b = el('button');
      b.type = 'button';
      const [icon, text] = STATE[d.state];
      const st = el('span', 'st ' + d.state, icon);
      st.setAttribute('aria-hidden', 'true');
      b.append(st, el('span', '', d.label));
      b.title = d.label + ': ' + text + (d.state !== 'missing' && d.state !== 'absent' ? ' · ' + d.tasksFilled + ' Arbeitspakete, ' + d.tasksDone + ' erledigt, Reflexion ' + d.reflectionWords + ' Wörter' : '');
      b.setAttribute('aria-label', b.title);
      if (d.line >= 0) b.addEventListener('click', () => vscode.postMessage({ type: 'reveal', uri: s.file.uri, line: d.line, character: 0 }));
      else if (d.state === 'missing') b.addEventListener('click', () => run('lernatelier.addDay'));
      else b.disabled = true;
      li.append(b);
      list.append(li);
    }
    card.append(list);
  }
  app.append(card);
}

function filesSection(s) {
  if (!s.files.length) return;
  const head = el('div', 'head');
  head.append(el('h2', '', 'Alle Lernperioden (' + s.files.length + ')'));
  const older = el('button', 'link', 'Ältere ignorieren');
  older.type = 'button';
  older.title = 'Alle Lernperioden ausser der neusten pro Ordner nicht mehr prüfen';
  older.addEventListener('click', () => run('lernatelier.ignoreOlder'));
  if (s.files.filter(f => !f.ignored).length > 1) head.append(older);
  app.append(head);
  const list = el('ul', 'files');
  for (const f of s.files) {
    const li = el('li', (f.active ? 'active ' : '') + (f.ignored ? 'ignored' : ''));
    const open = el('button', 'open');
    open.type = 'button';
    open.title = f.name + ' öffnen';
    const light = el('span', 'light small ' + (f.ignored ? 'off' : (f.status || '')));
    light.setAttribute('role', 'img');
    light.setAttribute('aria-label', f.ignored ? 'ignoriert' : f.status ? LABEL[f.status] : 'wird geprüft');
    const count = f.ignored ? 'ignoriert' : f.status ? (f.errors + f.warnings ? f.errors + ' F · ' + f.warnings + ' W' : 'ok') : '…';
    open.append(light, el('span', 'name', f.name.split('/').pop()), el('span', 'count', count));
    open.addEventListener('click', () => vscode.postMessage({ type: 'open', uri: f.uri }));
    const toggle = el('button', 'secondary small', f.ignored ? 'Prüfen' : 'Ignorieren');
    toggle.type = 'button';
    toggle.title = f.ignored ? 'Wieder prüfen' : 'Nicht mehr prüfen (z. B. abgeschlossene Lernperiode)';
    toggle.setAttribute('aria-label', (f.ignored ? 'Wieder prüfen: ' : 'Ignorieren: ') + f.name);
    toggle.addEventListener('click', () => vscode.postMessage({ type: 'ignore', uri: f.uri, ignore: !f.ignored }));
    li.append(open, toggle);
    list.append(li);
  }
  app.append(list);
}

function render(s) {
  app.textContent = '';
  if (s.file && s.ignored) {
    const card = el('div', 'card');
    card.append(el('strong', '', 'Diese Lernperiode wird ignoriert'), el('span', 'file', s.file.name),
      el('p', '', 'Sie erscheint nicht im Bereich Probleme.'));
    const again = el('button', 'wide', 'Wieder prüfen');
    again.type = 'button';
    again.addEventListener('click', () => vscode.postMessage({ type: 'ignore', uri: s.file.uri, ignore: false }));
    card.append(again);
    app.append(card);
    filesSection(s);
    return;
  }
  if (!s.file) {
    const card = el('div', 'card');
    card.append(el('strong', '', 'Keine Lernperiode offen'),
      el('p', '', 'Öffne eine Datei Lernperiode-N.md oder erstelle eine neue.'));
    const b = el('div', 'buttons');
    b.append(button('Lernperiode öffnen …', 'lernatelier.openPeriod', 'wide'),
      button('Neue Lernperiode erstellen …', 'lernatelier.newPeriod', 'wide secondary'),
      button('Erste Schritte', 'lernatelier.welcome', 'wide secondary'));
    card.append(b);
    app.append(card);
    filesSection(s);
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

  progressSection(s);

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
    cal.append(el('p', '', (c && c.reason) || 'Noch kein Kalender. Mit Kalender werden die Tagesplanungen bis heute und für den nächsten Unterrichtstag geprüft.'));
    cal.append(button('Kalender erstellen …', 'lernatelier.createConfig', 'wide'));
  } else {
    cal.append(el('strong', '', c.days + ' Unterrichtstage'), el('span', 'file', ' · ' + c.file));
    cal.append(el('p', '', c.next ? 'Nächster Unterrichtstag: ' + c.next : 'Kein weiterer Unterrichtstag.'));
    for (const p of c.problems) cal.append(el('p', 'sev error', p));
    cal.append(button('Kalender bearbeiten …', 'lernatelier.createConfig', 'wide secondary'));
  }
  app.append(cal);

  app.append(el('h2', '', 'Planen'));
  const plan = el('div', 'buttons');
  plan.append(button('Nächste Tagesplanung einfügen', 'lernatelier.addDay', 'wide'),
    button('Offene Arbeitspakete übernehmen', 'lernatelier.carryOver', 'wide secondary'),
    button('Neue Lernperiode erstellen …', 'lernatelier.newPeriod', 'wide secondary'));
  app.append(plan);

  filesSection(s);

  if (s.notes.length) {
    const notes = el('div', 'notes');
    for (const n of s.notes) notes.append(el('p', 'muted', n));
    app.append(notes);
  }
  const help = el('div', 'buttons');
  help.append(button('Erste Schritte', 'lernatelier.welcome', 'small secondary'));
  app.append(help);
}

window.addEventListener('message', e => { if (e.data.type === 'state') render(e.data.state); });
vscode.postMessage({ type: 'ready' });
`;
