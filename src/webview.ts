// Shared helpers for the calendar editor and the sidebar panel.
// Both pages use only VS Code's theme variables, a strict Content Security Policy and one inline
// script with a nonce. They load nothing from the network.
import * as vscode from 'vscode';

export function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let n = '';
  for (let i = 0; i < 32; i++) n += chars.charAt(Math.floor(Math.random() * chars.length));
  return n;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function page(webview: vscode.Webview, title: string, body: string, css: string, script: string): string {
  const n = nonce();
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${n}'; script-src 'nonce-${n}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style nonce="${n}">${BASE_CSS}${css}</style>
</head>
<body>
${body}
<script nonce="${n}">${script}</script>
</body>
</html>`;
}

const BASE_CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 12px 16px 24px;
  font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
  color: var(--vscode-foreground); background: var(--vscode-editor-background);
  line-height: 1.5;
}
h1 { font-size: 1.35em; margin: 0.2em 0 0.1em; }
h2 { font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.08em; color: var(--vscode-descriptionForeground); margin: 1.4em 0 0.5em; font-weight: 600; }
p, .muted { color: var(--vscode-descriptionForeground); margin: 0.2em 0 0.6em; }
.card {
  border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, rgba(128,128,128,.35)));
  border-radius: 10px; padding: 10px 12px; margin: 8px 0;
}
button {
  font: inherit; cursor: pointer; border-radius: 6px; padding: 5px 12px;
  color: var(--vscode-button-foreground); background: var(--vscode-button-background);
  border: 1px solid var(--vscode-button-border, transparent);
}
button:hover { background: var(--vscode-button-hoverBackground); }
button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
button:disabled { opacity: 0.5; cursor: default; }
button:focus-visible, input:focus-visible, .chip:focus-within, a:focus-visible {
  outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px;
}
input[type="number"], input[type="date"], input[type="text"] {
  font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, rgba(128,128,128,.35)));
  border-radius: 6px; padding: 4px 8px;
}
input[type="checkbox"] { accent-color: var(--vscode-button-background); width: 1em; height: 1em; }
label { cursor: pointer; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (prefers-reduced-motion: no-preference) { button, .chip { transition: background .15s ease, border-color .15s ease; } }
`;
