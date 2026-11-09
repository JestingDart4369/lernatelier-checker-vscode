// Calendar editor for lernperiode.json, as a form in an editor tab.
import * as vscode from 'vscode';
import {
  CONFIG_FILE, calendarInit, calendarProblems, calendarRows, configText, todayIso,
  type CalendarInit, type CalendarRow, type LearningPeriodConfig,
} from './core';
import { page } from './webview';

export interface CalendarContext {
  /** folder the lernperiode.json belongs to */
  folder: vscode.Uri;
  /** text of the Lernperiode document, '' if none is open */
  text: string;
  /** name of the Lernperiode document, for the title */
  docName: string | undefined;
  config: LearningPeriodConfig | undefined;
  existing: boolean;
  /** called after saving, to re-check the document */
  onSaved: () => void;
}

type FromWebview =
  | { type: 'ready' }
  | { type: 'compute'; start: string | null; end: string | null; weekdays: number[]; extra: string[]; unchecked: string[] }
  | { type: 'save'; number: number | null; start: string | null; end: string | null; days: string[] }
  | { type: 'openJson' }
  | { type: 'cancel' };

export type ToWebview =
  | { type: 'init'; init: CalendarInit; rows: CalendarRow[]; today: string; title: string }
  | { type: 'rows'; rows: CalendarRow[] }
  | { type: 'saved'; count: number }
  | { type: 'problems'; problems: string[] };

let current: { panel: vscode.WebviewPanel; folder: string } | undefined;

export function openCalendar(ctx: CalendarContext): vscode.WebviewPanel {
  const key = ctx.folder.toString();
  if (current && current.folder === key) {
    current.panel.reveal(vscode.ViewColumn.Beside);
    return current.panel;
  }
  current?.panel.dispose();
  const panel = vscode.window.createWebviewPanel('lernatelier.calendar', 'Lernperiode-Kalender', vscode.ViewColumn.Beside, {
    enableScripts: true,
    localResourceRoots: [],
    retainContextWhenHidden: true,
  });
  current = { panel, folder: key };
  panel.onDidDispose(() => {
    if (current?.panel === panel) current = undefined;
  });
  const post = (msg: ToWebview) => panel.webview.postMessage(msg);
  const text = ctx.text;
  panel.webview.onDidReceiveMessage(async (msg: FromWebview) => {
    switch (msg.type) {
      case 'ready': {
        const init = calendarInit(text, ctx.config, ctx.existing);
        await post({
          type: 'init', init, today: todayIso(),
          rows: calendarRows(text, init.start, init.end, init.weekdays, init.extra, init.unchecked),
          title: ctx.docName ? `Kalender für ${ctx.docName}` : 'Kalender',
        });
        break;
      }
      case 'compute':
        await post({ type: 'rows', rows: calendarRows(text, msg.start, msg.end, msg.weekdays, msg.extra, msg.unchecked) });
        break;
      case 'save': {
        const days = [...new Set(msg.days)].sort();
        const problems = calendarProblems(msg.number, msg.start, msg.end, days);
        if (problems.length) {
          await post({ type: 'problems', problems });
          break;
        }
        const uri = vscode.Uri.joinPath(ctx.folder, CONFIG_FILE);
        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(configText(msg.number!, days)));
        await post({ type: 'saved', count: days.length });
        void vscode.window.showInformationMessage(`${CONFIG_FILE} mit ${days.length} Unterrichtstagen gespeichert.`);
        ctx.onSaved();
        break;
      }
      case 'openJson':
        await vscode.window.showTextDocument(vscode.Uri.joinPath(ctx.folder, CONFIG_FILE), { viewColumn: vscode.ViewColumn.Beside });
        break;
      case 'cancel':
        panel.dispose();
        break;
    }
  });
  panel.webview.html = page(panel.webview, 'Lernperiode-Kalender', BODY, CSS, SCRIPT);
  return panel;
}

const BODY = `
<header>
  <h1 id="title">Lernperiode-Kalender</h1>
  <p>Erstellt die <code>${CONFIG_FILE}</code> für die Kalenderprüfung: Unterrichtstage wählen, Ferien abwählen, speichern.</p>
</header>

<section aria-labelledby="h-basics">
  <h2 id="h-basics">Lernperiode</h2>
  <div class="row">
    <label for="number">Nummer</label>
    <input id="number" type="number" min="1" step="1" inputmode="numeric">
  </div>
  <div class="row period">
    <label for="start">Zeitraum von</label>
    <input id="start" type="date">
    <label for="end">bis</label>
    <input id="end" type="date">
  </div>
  <p id="periodHint" class="muted"></p>
</section>

<section aria-labelledby="h-weekdays">
  <h2 id="h-weekdays">Wochentage mit Lernatelier</h2>
  <div class="row" id="weekdays" role="group" aria-labelledby="h-weekdays"></div>
</section>

<section aria-labelledby="h-days">
  <h2 id="h-days">Unterrichtstage</h2>
  <p class="muted">Ferien und freie Tage abwählen. Tage, die im Dokument schon geplant sind, sind markiert.</p>
  <div class="row toolbar">
    <button class="secondary" id="all" type="button">Alle wählen</button>
    <button class="secondary" id="none" type="button">Keine</button>
    <span class="grow"></span>
    <label for="extraDate">Weiterer Tag</label>
    <input id="extraDate" type="date">
    <button class="secondary" id="addExtra" type="button">Hinzufügen</button>
  </div>
  <div id="days" class="days"></div>
  <p id="empty" class="muted" hidden>Zeitraum und mindestens einen Wochentag wählen, dann erscheinen hier die Daten.</p>
</section>

<section aria-labelledby="h-preview">
  <h2 id="h-preview">Vorschau</h2>
  <pre id="preview" class="card" aria-live="polite"></pre>
</section>

<footer>
  <div id="problems" class="problems" role="alert"></div>
  <div class="row">
    <button id="save" type="button">Speichern</button>
    <button class="secondary" id="cancel" type="button">Schliessen</button>
    <span id="summary" class="muted"></span>
  </div>
  <p id="saved" class="saved" role="status"></p>
</footer>
`;

const CSS = `
body { max-width: 760px; }
code { font-family: var(--vscode-editor-font-family); }
.period { margin-top: 6px; }
.grow { flex: 1; }
.chip {
  display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px;
  border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.4)); user-select: none;
}
.chip.on { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); border-color: var(--vscode-focusBorder); }
.chip input { margin: 0; }
.days { margin-top: 8px; }
.month { margin: 10px 0 4px; font-weight: 600; }
.day {
  display: grid; grid-template-columns: auto 9em 1fr; gap: 10px; align-items: center;
  padding: 3px 8px; border-radius: 6px;
}
.day:hover { background: var(--vscode-list-hoverBackground); }
.day.off .label { text-decoration: line-through; color: var(--vscode-descriptionForeground); }
.day .note { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
.day.today .label::after { content: " · heute"; color: var(--vscode-descriptionForeground); }
pre#preview { margin: 0; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); white-space: pre-wrap; }
footer { position: sticky; bottom: 0; background: var(--vscode-editor-background); padding: 12px 0 4px; margin-top: 16px; border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,.35)); }
.problems { color: var(--vscode-errorForeground); margin-bottom: 6px; }
.saved { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); min-height: 1.5em; }
.saved a { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: underline; }
`;

const SCRIPT = `
const vscode = acquireVsCodeApi();
const $ = id => document.getElementById(id);
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const NAMES = { 0: 'So', 1: 'Mo', 2: 'Di', 3: 'Mi', 4: 'Do', 5: 'Fr', 6: 'Sa' };
const LONG = { 0: 'Sonntag', 1: 'Montag', 2: 'Dienstag', 3: 'Mittwoch', 4: 'Donnerstag', 5: 'Freitag', 6: 'Samstag' };
let state = { weekdays: [], extra: [], unchecked: [], rows: [], today: '' };

function german(iso) { const [y, m, d] = iso.split('-'); return d + '.' + m + '.' + y; }

function renderWeekdays() {
  const box = $('weekdays');
  box.textContent = '';
  for (const d of ORDER) {
    const label = document.createElement('label');
    label.className = 'chip' + (state.weekdays.includes(d) ? ' on' : '');
    label.title = LONG[d];
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = state.weekdays.includes(d);
    input.setAttribute('aria-label', LONG[d]);
    input.addEventListener('change', () => {
      state.weekdays = input.checked ? [...state.weekdays, d] : state.weekdays.filter(x => x !== d);
      renderWeekdays();
      compute();
    });
    label.append(input, document.createTextNode(NAMES[d]));
    box.append(label);
  }
}

function renderRows() {
  const box = $('days');
  box.textContent = '';
  let month = '';
  for (const row of state.rows) {
    if (row.month !== month) {
      month = row.month;
      const h = document.createElement('div');
      h.className = 'month';
      h.textContent = month;
      box.append(h);
    }
    const line = document.createElement('label');
    line.className = 'day' + (row.checked ? '' : ' off') + (row.iso === state.today ? ' today' : '');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = row.checked;
    input.addEventListener('change', () => {
      row.checked = input.checked;
      state.unchecked = input.checked ? state.unchecked.filter(x => x !== row.iso) : [...state.unchecked, row.iso];
      line.classList.toggle('off', !input.checked);
      renderPreview();
    });
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = row.label;
    const note = document.createElement('span');
    note.className = 'note';
    note.textContent = row.note;
    line.append(input, label, note);
    box.append(line);
  }
  $('empty').hidden = state.rows.length > 0;
  renderPreview();
}

function chosenDays() { return state.rows.filter(r => r.checked).map(r => r.iso); }

function renderPreview() {
  const days = chosenDays();
  const number = Number($('number').value) || null;
  $('preview').textContent = JSON.stringify({ learningperiod: number, days }, null, 2);
  const next = days.find(d => d > state.today);
  $('summary').textContent = days.length + ' von ' + state.rows.length + ' Tagen gewählt' + (next ? ' · nächster Unterrichtstag ' + NAMES[new Date(next + 'T00:00:00Z').getUTCDay()] + ' ' + german(next) : '');
  $('problems').textContent = '';
}

function compute() {
  vscode.postMessage({ type: 'compute', start: $('start').value || null, end: $('end').value || null,
    weekdays: state.weekdays, extra: state.extra, unchecked: state.unchecked });
}

$('start').addEventListener('change', () => { $('periodHint').textContent = ''; compute(); });
$('end').addEventListener('change', () => { $('periodHint').textContent = ''; compute(); });
$('number').addEventListener('input', renderPreview);
$('all').addEventListener('click', () => { state.unchecked = []; compute(); });
$('none').addEventListener('click', () => { state.unchecked = state.rows.map(r => r.iso); compute(); });
$('addExtra').addEventListener('click', () => {
  const v = $('extraDate').value;
  if (!v) return;
  if (!state.extra.includes(v)) state.extra = [...state.extra, v];
  state.unchecked = state.unchecked.filter(x => x !== v);
  $('extraDate').value = '';
  compute();
});
$('save').addEventListener('click', () => {
  vscode.postMessage({ type: 'save', number: Number($('number').value) || null,
    start: $('start').value || null, end: $('end').value || null, days: chosenDays() });
});
$('cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));

window.addEventListener('message', event => {
  const msg = event.data;
  if (msg.type === 'init') {
    const i = msg.init;
    state = { weekdays: i.weekdays, extra: i.extra, unchecked: i.unchecked, rows: msg.rows, today: msg.today };
    $('title').textContent = msg.title;
    $('number').value = i.number ?? '';
    $('start').value = i.start ?? '';
    $('end').value = i.end ?? '';
    $('periodHint').textContent = i.periodSource === 'document' ? 'Zeitraum aus dem Dokument übernommen.'
      : i.periodSource === 'config' ? 'Zeitraum aus der bestehenden lernperiode.json abgeleitet.'
      : 'Im Dokument ist noch kein Zeitraum eingetragen: bitte wählen.';
    $('save').textContent = i.existing ? 'Speichern (ersetzt die bestehende Datei)' : 'Speichern';
    renderWeekdays();
    renderRows();
  } else if (msg.type === 'rows') {
    state.rows = msg.rows;
    renderRows();
  } else if (msg.type === 'problems') {
    $('problems').textContent = msg.problems.join(' ');
  } else if (msg.type === 'saved') {
    const saved = $('saved');
    saved.textContent = 'Gespeichert: ' + msg.count + ' Unterrichtstage. ';
    const a = document.createElement('a');
    a.textContent = 'Datei öffnen';
    a.tabIndex = 0;
    a.addEventListener('click', () => vscode.postMessage({ type: 'openJson' }));
    saved.append(a);
    $('save').textContent = 'Speichern (ersetzt die bestehende Datei)';
  }
});

vscode.postMessage({ type: 'ready' });
`;

