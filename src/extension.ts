import * as vscode from 'vscode';
import { pythonToLatex } from './pythonToLatex';

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {

  // Right-click → Visualize Expression: goes straight to the extended panel
  const cmd = vscode.commands.registerCommand('pythonVisualizer.visualize', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showErrorMessage('No active editor found.'); return; }
    const sel = editor.selection;
    const code = editor.document.getText(sel.isEmpty ? undefined : sel).trim();
    if (!code) { vscode.window.showWarningMessage('Select a Python expression first.'); return; }
    showExtendedPanel(context, code);
  });

  // Shift+Alt+V: shows the compact quick preview
  const quickCmd = vscode.commands.registerCommand('pythonVisualizer.quickPreview', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showErrorMessage('No active editor found.'); return; }
    const sel = editor.selection;
    if (sel.isEmpty) { vscode.window.showWarningMessage('Select a Python expression first.'); return; }
    const code = editor.document.getText(sel).trim();
    if (!code) { return; }
    showQuickPanel(context, code);
  });

  // Close the quick preview whenever the selection is cleared
  const selectionWatcher = vscode.window.onDidChangeTextEditorSelection(event => {
    if (event.selections[0].isEmpty) { closeQuickPanel(); }
  });

  context.subscriptions.push(cmd, quickCmd, selectionWatcher);
}

export function deactivate() {}

// ─── Quick preview panel (equation only) ─────────────────────────────────────

let quickPanel: vscode.WebviewPanel | undefined;
let quickPanelCode = '';  // remember the code so the button works after selection is gone

function showQuickPanel(context: vscode.ExtensionContext, code: string) {
  const katexBase = vscode.Uri.joinPath(context.extensionUri, 'node_modules', 'katex', 'dist');
  quickPanelCode = code;

  if (!quickPanel) {
    quickPanel = vscode.window.createWebviewPanel(
      'pythonVisualizerQuick',
      'Equation Preview',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: [katexBase],
        retainContextWhenHidden: true,
      }
    );
    quickPanel.onDidDispose(() => { quickPanel = undefined; quickPanelCode = ''; });

    quickPanel.webview.onDidReceiveMessage(() => {
      if (quickPanelCode) { showExtendedPanel(context, quickPanelCode); }
    });
  }

  const js  = quickPanel.webview.asWebviewUri(vscode.Uri.joinPath(katexBase, 'katex.min.js'));
  const css = quickPanel.webview.asWebviewUri(vscode.Uri.joinPath(katexBase, 'katex.min.css'));
  const { latex, error } = pythonToLatex(code);
  quickPanel.webview.html = buildQuickHtml(quickPanel.webview, latex, error, js, css);
}

function closeQuickPanel() {
  quickPanel?.dispose();
  quickPanel = undefined;
}

// ─── Extended panel (full view) ───────────────────────────────────────────────

let extPanel: vscode.WebviewPanel | undefined;

function showExtendedPanel(context: vscode.ExtensionContext, code: string) {
  const katexBase = vscode.Uri.joinPath(context.extensionUri, 'node_modules', 'katex', 'dist');

  if (extPanel) {
    extPanel.reveal(vscode.ViewColumn.Beside);
  } else {
    extPanel = vscode.window.createWebviewPanel(
      'pythonVisualizerExtended',
      'Expression Visualizer',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [katexBase],
        retainContextWhenHidden: true,
      }
    );
    extPanel.onDidDispose(() => { extPanel = undefined; });

    extPanel.webview.onDidReceiveMessage(async (msg: { command: string; text: string }) => {
      if (msg.command === 'copy') {
        await vscode.env.clipboard.writeText(msg.text);
        extPanel?.webview.postMessage({ command: 'copyDone' });
      }
    });
  }

  const js  = extPanel.webview.asWebviewUri(vscode.Uri.joinPath(katexBase, 'katex.min.js'));
  const css = extPanel.webview.asWebviewUri(vscode.Uri.joinPath(katexBase, 'katex.min.css'));
  const { latex, error } = pythonToLatex(code);
  extPanel.webview.html = buildExtendedHtml(extPanel.webview, code, latex, error, js, css);
}

function closeExtendedPanel() {
  extPanel?.dispose();
  extPanel = undefined;
}

// ─── Quick panel HTML ─────────────────────────────────────────────────────────

function buildQuickHtml(
  webview: vscode.Webview,
  latex: string,
  error: string | undefined,
  katexJs: vscode.Uri,
  katexCss: vscode.Uri,
): string {
  const nonce = getNonce();
  const errorHtml = error
    ? `<div class="error">Could not parse expression</div>`
    : '';

  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${webview.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}' ${webview.cspSource};
             font-src ${webview.cspSource};">
  <link rel="stylesheet" href="${katexCss}">
  <style>
    :root {
      --bg:     var(--vscode-editor-background, #1e1e1e);
      --fg:     var(--vscode-editor-foreground, #d4d4d4);
      --border: var(--vscode-panel-border, #424242);
      --accent: var(--vscode-button-background, #0e639c);
      --accent-fg: var(--vscode-button-foreground, #fff);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 32px 24px 24px;
      gap: 24px;
    }
    #render-box {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow-x: auto;
    }
    #render-box .katex { font-size: 2.2em; }
    #render-box .katex-display { margin: 0; }
    .error {
      color: var(--vscode-errorForeground, #f48771);
      font-size: 13px;
      font-style: italic;
    }
    button {
      background: var(--accent);
      color: var(--accent-fg);
      border: none;
      border-radius: 4px;
      padding: 8px 18px;
      font-size: 13px;
      cursor: pointer;
      opacity: .9;
    }
    button:hover { opacity: 1; }
  </style>
</head>
<body>
  <div id="render-box"></div>
  ${errorHtml}
  <button id="btnOpen">Open Extended Viewer</button>

  <script nonce="${nonce}" src="${katexJs}"></script>
  <script nonce="${nonce}">
    const latex = ${JSON.stringify(latex)};
    const vscode = acquireVsCodeApi();

    const box = document.getElementById('render-box');
    if (latex) {
      try {
        katex.render(latex, box, { displayMode: true, throwOnError: false, output: 'html' });
      } catch(e) {
        box.textContent = 'Render error: ' + e.message;
      }
    } else {
      box.innerHTML = '<span style="opacity:.4">Nothing to render</span>';
    }

    document.getElementById('btnOpen').addEventListener('click', () => {
      vscode.postMessage({ command: 'openExtended' });
    });
  </script>
</body>
</html>`;
}

// ─── Extended panel HTML ──────────────────────────────────────────────────────

function buildExtendedHtml(
  webview: vscode.Webview,
  code: string,
  latex: string,
  error: string | undefined,
  katexJs: vscode.Uri,
  katexCss: vscode.Uri,
): string {
  const nonce = getNonce();
  const safeCode  = escHtml(code);
  const safeLatex = escHtml(latex);
  const errorHtml = error ? `<div class="error">Parser error: ${escHtml(error)}</div>` : '';

  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${webview.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}' ${webview.cspSource};
             font-src ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="${katexCss}">
  <title>Expression Visualizer</title>
  <style>
    :root {
      --bg:      var(--vscode-editor-background, #1e1e1e);
      --fg:      var(--vscode-editor-foreground, #d4d4d4);
      --border:  var(--vscode-panel-border, #424242);
      --code-bg: var(--vscode-textCodeBlock-background, #2d2d2d);
      --accent:  var(--vscode-button-background, #0e639c);
      --accent-fg: var(--vscode-button-foreground, #fff);
      --radius:  6px;
      --mono:    var(--vscode-editor-font-family, 'Courier New', monospace);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg); color: var(--fg);
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      font-size: 14px; line-height: 1.6;
      padding: 24px; max-width: 900px;
    }
    h2 {
      font-size: 11px; font-weight: 600; letter-spacing: .08em;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground, #888);
      margin-bottom: 8px;
    }
    .card {
      background: var(--code-bg); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 16px 20px; margin-bottom: 20px;
    }
    pre { font-family: var(--mono); font-size: 13px; white-space: pre-wrap; word-break: break-word; }
    #render-box {
      display: flex; align-items: center; justify-content: center;
      min-height: 100px; padding: 28px; overflow-x: auto;
    }
    #render-box .katex { font-size: 1.8em; }
    #render-box .katex-display { margin: 0; }
    .error { color: var(--vscode-errorForeground, #f48771); font-style: italic; font-size: 13px; }
    .toolbar { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; align-items: center; }
    button {
      background: var(--accent); color: var(--accent-fg); border: none;
      border-radius: 4px; padding: 6px 14px; font-size: 12px; cursor: pointer;
      display: flex; align-items: center; gap: 5px; transition: opacity .15s;
    }
    button:hover { opacity: .85; }
    button.secondary { background: transparent; border: 1px solid var(--border); color: var(--fg); }
    .size-controls { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--vscode-descriptionForeground, #888); }
    .size-controls input[type=range] { width: 90px; cursor: pointer; }
    #toast {
      position: fixed; bottom: 20px; right: 20px;
      background: var(--vscode-notificationToast-background, #333);
      color: var(--fg); border: 1px solid var(--border); border-radius: var(--radius);
      padding: 8px 16px; font-size: 12px; opacity: 0; pointer-events: none; transition: opacity .2s;
    }
    #toast.show { opacity: 1; }
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="btnCopyLatex">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
        <path d="M4 2h7a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1zm0 1v9h7V3H4z"/>
        <path d="M2 4v9a1 1 0 001 1h8v-1H3V4H2z"/>
      </svg>
      Copy LaTeX
    </button>
    <button class="secondary" id="btnCopyCode">Copy Python</button>
    <div class="size-controls">
      <span>Size</span>
      <input type="range" id="sizeSlider" min="1" max="3.5" step="0.1" value="1.8">
    </div>
  </div>

  <h2>Rendered Equation</h2>
  <div class="card">
    <div id="render-box"></div>
    ${errorHtml}
  </div>

  <h2>LaTeX Source</h2>
  <div class="card"><pre id="latex-src">${safeLatex}</pre></div>

  <h2>Python Source</h2>
  <div class="card"><pre>${safeCode}</pre></div>

  <div id="toast"></div>

  <script nonce="${nonce}" src="${katexJs}"></script>
  <script nonce="${nonce}">
    const latex = ${JSON.stringify(latex)};
    const code  = ${JSON.stringify(code)};
    const renderBox = document.getElementById('render-box');
    const vscode = acquireVsCodeApi();
    let pendingToast = '';

    function render(size) {
      renderBox.innerHTML = '';
      if (!latex) { renderBox.innerHTML = '<span style="opacity:.5">Nothing to render.</span>'; return; }
      try {
        katex.render(latex, renderBox, { displayMode: true, throwOnError: false, output: 'html' });
        renderBox.querySelector('.katex').style.fontSize = size + 'em';
      } catch(e) {
        renderBox.innerHTML = '<span style="color:var(--vscode-errorForeground,#f48771)">Render error: ' + e.message + '</span>';
      }
    }

    function toast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg; t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 1800);
    }

    window.addEventListener('message', e => {
      if (e.data.command === 'copyDone') toast(pendingToast);
    });

    document.getElementById('btnCopyLatex').addEventListener('click', () => {
      pendingToast = 'LaTeX copied!';
      vscode.postMessage({ command: 'copy', text: latex });
    });
    document.getElementById('btnCopyCode').addEventListener('click', () => {
      pendingToast = 'Python copied!';
      vscode.postMessage({ command: 'copy', text: code });
    });
    document.getElementById('sizeSlider').addEventListener('input', e => {
      const el = renderBox.querySelector('.katex');
      if (el) el.style.fontSize = e.target.value + 'em';
    });

    render(1.8);
  </script>
</body>
</html>`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
