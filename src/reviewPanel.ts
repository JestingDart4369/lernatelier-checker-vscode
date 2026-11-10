// "Rückblick": everything of a Lernperiode on one page, to have in view while writing the
// Lernperiodenreflexion. Read-only: plain HTML, no script, nothing loaded from the network.
import * as vscode from 'vscode';
import { counterText } from './writing';
import type { Review } from './writing';
import { escapeHtml, page } from './webview';

let current: { panel: vscode.WebviewPanel; uri: string } | undefined;

/** HTML body of the review (exported for tests). */
export function reviewBody(r: Review, fileName: string): string {
  const e = escapeHtml;
  const para = (text: string) => text.split(/\n{2,}/).filter(Boolean).map(p => `<p>${e(p).replace(/\n/g, '<br>')}</p>`).join('');
  const days = r.days.map(d => `
<section class="day">
  <h3>${e(d.label)}${d.absent ? ' <span class="muted">· abwesend</span>' : ''}</h3>
  ${d.tasks.length ? `<ul class="tasks">${d.tasks.map(t =>
    `<li class="${t.checked ? 'done' : 'open'}"><span aria-hidden="true">${t.checked ? '✓' : '○'}</span><span class="sr">${t.checked ? 'erledigt: ' : 'offen: '}</span>${e(t.text)}</li>`).join('')}</ul>` : ''}
  ${d.reflection ? `<blockquote>${para(d.reflection)}</blockquote>` : d.absent ? '' : '<p class="muted">Keine Tagesreflexion.</p>'}
</section>`).join('');
  const c = r.reflection;
  return `
<h1>Rückblick${r.number === null ? '' : ` Lernperiode ${r.number}`}</h1>
<p class="muted">${e(fileName)} · zum Schreiben der Lernperiodenreflexion. Diese Seite ändert nichts an der Datei.</p>
<div class="stats">
  <div><strong>${r.days.length}</strong><span>${r.days.length === 1 ? 'Tag' : 'Tage'}${r.absentDays ? `, ${r.absentDays} abwesend` : ''}</span></div>
  <div><strong>${r.tasksDone}</strong><span>Arbeitspakete erledigt</span></div>
  <div><strong>${r.tasksOpen}</strong><span>nie abgehakt</span></div>
  <div class="${c.ok ? '' : 'warn'}"><strong>${e(counterText(c).replace(/ Wörter$/, ''))}</strong><span>Wörter Reflexion</span></div>
</div>
${r.goals ? `<h2>Generelle Ziele</h2><div class="card">${para(r.goals)}</div>` : ''}
${r.projects ? `<h2>Projekte / neue Technologien</h2><div class="card">${para(r.projects)}</div>` : ''}
${r.open.length ? `<h2>Nie abgehakt</h2><ul class="tasks card">${r.open.map(t => `<li class="open"><span aria-hidden="true">○</span>${e(t)}</li>`).join('')}</ul>` : ''}
<h2>Tage</h2>
${days || '<p class="muted">Noch keine Tagesplanungen.</p>'}`;
}

const CSS = `
body { max-width: 720px; }
h1 { font-size: 1.4em; margin: 0 0 2px; }
h2 { font-size: 0.8em; text-transform: uppercase; letter-spacing: .06em; color: var(--vscode-descriptionForeground); margin: 20px 0 6px; }
h3 { font-size: 1em; margin: 0 0 4px; }
.muted { color: var(--vscode-descriptionForeground); }
.card, .day { border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.3)); border-radius: 8px; padding: 10px 12px; margin: 0 0 8px; }
.card p:first-child, blockquote p:first-child { margin-top: 0; } .card p:last-child, blockquote p:last-child { margin-bottom: 0; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; margin-top: 12px; }
.stats div { border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.3)); border-radius: 8px; padding: 8px 10px; }
.stats strong { display: block; font-size: 1.4em; font-variant-numeric: tabular-nums; }
.stats span { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
.stats .warn strong { color: var(--vscode-editorWarning-foreground); }
ul.tasks { list-style: none; padding-left: 12px; margin-top: 0; margin-bottom: 8px; }
ul.tasks.card { padding: 10px 12px; }
ul.tasks li { display: grid; grid-template-columns: 1.3em 1fr; }
ul.tasks li.done > span:first-child { color: var(--vscode-testing-iconPassed, inherit); }
ul.tasks li.open > span:first-child { color: var(--vscode-descriptionForeground); }
ul.tasks li .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
blockquote { margin: 0; padding: 2px 0 2px 10px; border-left: 3px solid var(--vscode-textBlockQuote-border, rgba(128,128,128,.4)); }
`;

/** Opens the review beside the editor, or refreshes it. */
export function showReview(uri: vscode.Uri, fileName: string, data: Review): vscode.WebviewPanel {
  const key = uri.toString();
  if (!current) {
    const panel = vscode.window.createWebviewPanel('lernatelier.review', 'Rückblick', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: false, localResourceRoots: [] });
    panel.onDidDispose(() => {
      if (current?.panel === panel) current = undefined;
    });
    current = { panel, uri: key };
  }
  current.uri = key;
  current.panel.title = `Rückblick${data.number === null ? '' : ` LP ${data.number}`}`;
  current.panel.webview.html = page(current.panel.webview, 'Rückblick', reviewBody(data, fileName), CSS, '');
  return current.panel;
}

/** Refreshes the open review if it shows this file. */
export function refreshReview(uri: vscode.Uri, fileName: string, data: () => Review): void {
  if (current?.uri === uri.toString()) showReview(uri, fileName, data());
}
