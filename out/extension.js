"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
const pythonToLatex_1 = require("./pythonToLatex");
// ─── Python runner script (written to disk once per session) ─────────────────
// Receives a JSON data file as argv[1] containing { code, preamble }.
// Executes the preamble + code in a SymPy namespace, then prints latex(result).
const PYTHON_SCRIPT = `
import sys, json, re
from pathlib import Path

data = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
code     = data['code']
preamble = data['preamble']

# ── Auto-symbol namespace ──────────────────────────────────────────────────────
# Any name not already in the namespace is silently created as a SymPy Symbol.
# This means users don't have to write x = symbols('x') for the visualizer.
class _SymbolNS(dict):
    def __missing__(self, key):
        if key.startswith('__'):
            raise KeyError(key)
        from sympy import Symbol, Function
        # Heuristic: if the name is used as a callable we make it a Function,
        # otherwise a Symbol.  We default to Symbol here; callers that need
        # a Function (e.g. y(x)) will get a TypeError and the line will fail
        # gracefully (the subprocess falls back to the parser).
        sym = Symbol(key)
        self[key] = sym
        return sym

_ns = _SymbolNS()

# Core SymPy — if unavailable, exit so the TypeScript parser takes over
try:
    exec('from sympy import *', _ns)
except Exception as e:
    sys.stderr.write('no-sympy'); sys.exit(1)

# Optional submodules (ignore failures)
for _imp in [
    'from sympy.physics.vector import dynamicsymbols, ReferenceFrame',
    'from sympy.physics.mechanics import *',
    'from sympy.matrices import *',
    'import numpy as np',
    'import sympy as sp',
]:
    try: exec(_imp, _ns)
    except: pass

# Execute preamble (imports + symbol declarations above the selection)
for _line in preamble:
    _line = _line.strip()
    if not _line or _line.startswith('#'): continue
    try: exec(_line, _ns)
    except: pass

# Process selected lines
_lines = [l.strip() for l in code.strip().split('\\n')
          if l.strip() and not l.strip().startswith('#')]

_last_var = None
_last_val = None

for _line in _lines:
    _m = re.match(r'^([A-Za-z_]\\w*)\\s*=(?![=+\\-*\\/&|^])\\s*(.+)$', _line)
    if _m:
        _varname, _rhs = _m.group(1), _m.group(2)
        try:
            exec(_line, _ns)
            _last_var = _varname
            _last_val = _ns.get(_varname)
        except:
            try:
                _last_val = eval(_rhs.strip(), _ns)
                _last_var = _varname
            except: pass
    else:
        try:
            _last_val = eval(_line, _ns)
            _last_var = None
        except:
            try: exec(_line, _ns)
            except: pass

if _last_val is None:
    sys.stderr.write('no-result'); sys.exit(1)

# Force evaluation of unevaluated forms (Derivative, Integral, Sum, etc.)
try:
    _evaled = _last_val.doit()
    if _evaled != _last_val:
        _last_val = _evaled
except: pass

try:
    from sympy import latex, Symbol
    _expr_latex = latex(_last_val)
    if _last_var:
        try:    _var_latex = latex(Symbol(_last_var))
        except: _var_latex = _last_var
        print(_var_latex + ' = ' + _expr_latex)
    else:
        print(_expr_latex)
except Exception as e:
    sys.stderr.write(str(e)); sys.exit(1)
`.trim();
const SCRIPT_PATH = path.join(os.tmpdir(), 'pev_runner.py');
const DATA_PATH = path.join(os.tmpdir(), 'pev_data.json');
let scriptWritten = false; // reset to false to force rewrite on next run
// ─── Activation ───────────────────────────────────────────────────────────────
function activate(context) {
    const cmd = vscode.commands.registerCommand('pythonVisualizer.visualize', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found.');
            return;
        }
        const sel = editor.selection;
        const code = editor.document.getText(sel.isEmpty ? undefined : sel).trim();
        if (!code) {
            vscode.window.showWarningMessage('Select a Python expression first.');
            return;
        }
        const result = resolveLatex(code, editor.document, sel.start);
        showExtendedPanel(context, code, result);
    });
    const quickCmd = vscode.commands.registerCommand('pythonVisualizer.quickPreview', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found.');
            return;
        }
        const sel = editor.selection;
        if (sel.isEmpty) {
            vscode.window.showWarningMessage('Select a Python expression first.');
            return;
        }
        const code = editor.document.getText(sel).trim();
        if (!code) {
            return;
        }
        const result = resolveLatex(code, editor.document, sel.start);
        showQuickPanel(context, code, result);
    });
    const selectionWatcher = vscode.window.onDidChangeTextEditorSelection(event => {
        if (event.selections[0].isEmpty) {
            closeQuickPanel();
        }
    });
    context.subscriptions.push(cmd, quickCmd, selectionWatcher);
}
function deactivate() { }
function resolveLatex(code, document, selectionStart) {
    const { latex: parserLatex, error: parserError } = (0, pythonToLatex_1.pythonToLatex)(code);
    const result = { parserLatex, parserError };
    if (hasSymPyImport(document)) {
        const preamble = extractPreamble(document, selectionStart);
        const sympy = trySymPyLatex(code, preamble);
        // Only expose the SymPy version if it's meaningfully different from the
        // parser version — not just a reordering of the same terms.
        if (sympy !== null && isMeaningfullyDifferent(parserLatex, sympy)) {
            result.sympyLatex = sympy;
        }
    }
    return result;
}
// Returns true when two LaTeX strings differ beyond mere term reordering.
// Strategy: strip all LaTeX markup, keep only alphanumeric chars and basic
// operators, sort what remains, and compare.  If the sorted content is the
// same the expressions are considered equivalent (just reordered).
function isMeaningfullyDifferent(a, b) {
    const normalize = (s) => s
        // Remove \begin{env} and \end{env} entirely (matrix, aligned, cases, etc.)
        .replace(/\\(?:begin|end)\{[^}]*\}/g, '')
        // Replace LaTeX line-breaks \\ with a space BEFORE command stripping,
        // otherwise the second \ merges with the next letter (e.g. \\c → \c removed)
        .replace(/\\\\/g, ' ')
        // Drop all LaTeX commands: \sin, \frac, \operatorname, and single-char
        // spacing/punctuation commands like \!, \,, \;, \:
        .replace(/\\(?:[a-zA-Z]+|[!,;: ])/g, '')
        // Collapse subscript/superscript grouping so expr50 == expr_{50}
        .replace(/[_{}^]/g, '')
        // Keep only alphanumeric and meaningful math operators
        .replace(/[^a-zA-Z0-9+\-*/=<>]/g, '')
        .split('').sort().join('');
    return normalize(a) !== normalize(b);
}
// Returns true if the document imports sympy anywhere
function hasSymPyImport(document) {
    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;
        if (/\bsympy\b/.test(line) && /\b(import|from)\b/.test(line)) {
            return true;
        }
    }
    return false;
}
// Collect import lines and symbol declarations above the selection.
// We deliberately exclude plain variable assignments (A = x**2 + 4) so the
// subprocess does not silently substitute earlier values into the expression.
function extractPreamble(document, before) {
    const lines = [];
    for (let i = 0; i < before.line; i++) {
        const line = document.lineAt(i).text.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }
        // All import / from … import lines
        if (line.startsWith('import ') || line.startsWith('from ')) {
            lines.push(line);
            continue;
        }
        // Symbol / dynamicsymbols / Function declarations
        if (/\b(symbols|Symbol|dynamicsymbols|Function|var)\s*\(/.test(line)) {
            lines.push(line);
            continue;
        }
        // init_printing() and similar setup helpers
        if (/^init_\w+\s*\(/.test(line)) {
            lines.push(line);
        }
    }
    return lines;
}
// Spawn Python, run the SymPy runner, return LaTeX string or null on failure
function trySymPyLatex(code, preamble) {
    try {
        fs.writeFileSync(SCRIPT_PATH, PYTHON_SCRIPT, 'utf8');
        fs.writeFileSync(DATA_PATH, JSON.stringify({ code, preamble }), 'utf8');
        for (const py of ['python3', 'python']) {
            const r = (0, child_process_1.spawnSync)(py, [SCRIPT_PATH, DATA_PATH], {
                encoding: 'utf8',
                timeout: 10000,
            });
            if (r.status === 0 && r.stdout.trim()) {
                return r.stdout.trim();
            }
            // "no-sympy" stderr means SymPy isn't installed — don't try python fallback
            if (r.stderr?.includes('no-sympy')) {
                return null;
            }
        }
    }
    catch { /* file system or spawn error */ }
    return null;
}
// ─── Quick preview panel ──────────────────────────────────────────────────────
let quickPanel;
let quickPanelCode = '';
let quickPanelResult = { parserLatex: '' };
function showQuickPanel(context, code, result) {
    const katexBase = vscode.Uri.joinPath(context.extensionUri, 'node_modules', 'katex', 'dist');
    quickPanelCode = code;
    quickPanelResult = result;
    if (!quickPanel) {
        quickPanel = vscode.window.createWebviewPanel('pythonVisualizerQuick', 'Equation Preview', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, localResourceRoots: [katexBase], retainContextWhenHidden: true });
        quickPanel.onDidDispose(() => { quickPanel = undefined; quickPanelCode = ''; });
        quickPanel.webview.onDidReceiveMessage(() => {
            if (quickPanelCode) {
                const code = quickPanelCode;
                const result = quickPanelResult;
                closeQuickPanel(); // close quick panel first
                showExtendedPanel(context, code, result);
            }
        });
    }
    const js = quickPanel.webview.asWebviewUri(vscode.Uri.joinPath(katexBase, 'katex.min.js'));
    const css = quickPanel.webview.asWebviewUri(vscode.Uri.joinPath(katexBase, 'katex.min.css'));
    quickPanel.webview.html = buildQuickHtml(quickPanel.webview, code, result, js, css);
}
function closeQuickPanel() { quickPanel?.dispose(); quickPanel = undefined; }
// ─── Extended panel ───────────────────────────────────────────────────────────
let extPanel;
function showExtendedPanel(context, code, result) {
    const katexBase = vscode.Uri.joinPath(context.extensionUri, 'node_modules', 'katex', 'dist');
    if (extPanel) {
        extPanel.reveal(vscode.ViewColumn.Beside);
    }
    else {
        extPanel = vscode.window.createWebviewPanel('pythonVisualizerExtended', 'Expression Visualizer', vscode.ViewColumn.Beside, { enableScripts: true, localResourceRoots: [katexBase], retainContextWhenHidden: true });
        extPanel.onDidDispose(() => { extPanel = undefined; });
        extPanel.webview.onDidReceiveMessage(async (msg) => {
            if (msg.command === 'copy') {
                await vscode.env.clipboard.writeText(msg.text);
                extPanel?.webview.postMessage({ command: 'copyDone' });
            }
        });
    }
    const js = extPanel.webview.asWebviewUri(vscode.Uri.joinPath(katexBase, 'katex.min.js'));
    const css = extPanel.webview.asWebviewUri(vscode.Uri.joinPath(katexBase, 'katex.min.css'));
    extPanel.webview.html = buildExtendedHtml(extPanel.webview, code, result, js, css);
}
// ─── Quick panel HTML ─────────────────────────────────────────────────────────
function buildQuickHtml(webview, _code, result, katexJs, katexCss) {
    const nonce = getNonce();
    const hasSympy = !!result.sympyLatex;
    const toggleHtml = hasSympy
        ? `<div class="toggle" id="toggle">
         <button class="tog-btn active" id="btnRaw">Raw</button>
         <button class="tog-btn" id="btnEval">Evaluated</button>
       </div>`
        : '';
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}' ${webview.cspSource}; font-src ${webview.cspSource};">
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
      background: var(--bg); color: var(--fg);
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; min-height: 100vh; padding: 32px 24px 24px; gap: 20px;
    }
    #render-box { width: 100%; display: flex; align-items: center; justify-content: center; overflow-x: auto; }
    #render-box .katex { font-size: 2.2em; }
    #render-box .katex-display { margin: 0; }
    .footer { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: center; }
    button {
      background: var(--accent); color: var(--accent-fg); border: none;
      border-radius: 4px; padding: 8px 18px; font-size: 13px; cursor: pointer; opacity: .9;
    }
    button:hover { opacity: 1; }
    .toggle { display: flex; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
    .tog-btn {
      background: transparent; color: var(--fg); border: none; border-radius: 0;
      padding: 6px 14px; font-size: 12px; cursor: pointer; opacity: .6;
    }
    .tog-btn.active { background: var(--accent); color: var(--accent-fg); opacity: 1; }
    .tog-btn:not(:last-child) { border-right: 1px solid var(--border); }
  </style>
</head>
<body>
  <div id="render-box"></div>
  <div class="footer">
    ${toggleHtml}
    <button id="btnOpen">Open Extended Viewer</button>
  </div>
  <script nonce="${nonce}" src="${katexJs}"></script>
  <script nonce="${nonce}">
    const rawLatex   = ${JSON.stringify(result.parserLatex)};
    const evalLatex  = ${JSON.stringify(result.sympyLatex ?? null)};
    const vscode     = acquireVsCodeApi();
    const box        = document.getElementById('render-box');
    let   current    = rawLatex;

    function render(latex) {
      box.innerHTML = '';
      if (!latex) { box.innerHTML = '<span style="opacity:.4">Nothing to render</span>'; return; }
      try { katex.render(latex, box, { displayMode: true, throwOnError: false, output: 'html' }); }
      catch(e) { box.textContent = 'Render error: ' + e.message; }
    }

    render(current);

    ${hasSympy ? `
    const btnRaw  = document.getElementById('btnRaw');
    const btnEval = document.getElementById('btnEval');
    btnRaw.addEventListener('click', () => {
      current = rawLatex; render(current);
      btnRaw.classList.add('active'); btnEval.classList.remove('active');
    });
    btnEval.addEventListener('click', () => {
      current = evalLatex; render(current);
      btnEval.classList.add('active'); btnRaw.classList.remove('active');
    });
    ` : ''}

    document.getElementById('btnOpen').addEventListener('click', () => {
      vscode.postMessage({ command: 'openExtended' });
    });
  </script>
</body>
</html>`;
}
// ─── Extended panel HTML ──────────────────────────────────────────────────────
function buildExtendedHtml(webview, code, result, katexJs, katexCss) {
    const nonce = getNonce();
    const safeCode = escHtml(code);
    const hasSympy = !!result.sympyLatex;
    const errorHtml = result.parserError
        ? `<div class="error">Parser note: ${escHtml(result.parserError)}</div>`
        : '';
    const toggleHtml = hasSympy
        ? `<div class="toggle">
         <button class="tog-btn active" id="btnRaw">Raw</button>
         <button class="tog-btn" id="btnEval">Evaluated</button>
       </div>`
        : '';
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}' ${webview.cspSource}; font-src ${webview.cspSource};">
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
    body { background: var(--bg); color: var(--fg); font-family: var(--vscode-font-family, system-ui, sans-serif); font-size: 14px; line-height: 1.6; padding: 24px; max-width: 900px; }
    h2 { font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--vscode-descriptionForeground, #888); margin-bottom: 8px; }
    .card { background: var(--code-bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 20px; margin-bottom: 20px; }
    pre { font-family: var(--mono); font-size: 13px; white-space: pre-wrap; word-break: break-word; }
    #render-box { display: flex; align-items: center; justify-content: center; min-height: 100px; padding: 28px; overflow-x: auto; }
    #render-box .katex { font-size: 1.8em; }
    #render-box .katex-display { margin: 0; }
    .error { color: var(--vscode-errorForeground, #f48771); font-style: italic; font-size: 13px; }
    .toolbar { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; align-items: center; }
    button { background: var(--accent); color: var(--accent-fg); border: none; border-radius: 4px; padding: 6px 14px; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 5px; transition: opacity .15s; }
    button:hover { opacity: .85; }
    button.secondary { background: transparent; border: 1px solid var(--border); color: var(--fg); }
    .size-controls { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--vscode-descriptionForeground, #888); }
    .size-controls input[type=range] { width: 90px; cursor: pointer; }
    .toggle { display: flex; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
    .tog-btn { background: transparent; color: var(--fg); border: none; border-radius: 0; padding: 5px 13px; font-size: 12px; cursor: pointer; opacity: .6; display: flex; }
    .tog-btn.active { background: var(--accent); color: var(--accent-fg); opacity: 1; }
    .tog-btn:not(:last-child) { border-right: 1px solid var(--border); }
    #toast { position: fixed; bottom: 20px; right: 20px; background: var(--vscode-notificationToast-background, #333); color: var(--fg); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 16px; font-size: 12px; opacity: 0; pointer-events: none; transition: opacity .2s; }
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
    ${toggleHtml}
  </div>

  <h2>Rendered Equation</h2>
  <div class="card">
    <div id="render-box"></div>
    ${errorHtml}
  </div>

  <h2>LaTeX Source</h2>
  <div class="card"><pre id="latex-src"></pre></div>

  <h2>Python Source</h2>
  <div class="card"><pre>${safeCode}</pre></div>

  <div id="toast"></div>

  <script nonce="${nonce}" src="${katexJs}"></script>
  <script nonce="${nonce}">
    const rawLatex  = ${JSON.stringify(result.parserLatex)};
    const evalLatex = ${JSON.stringify(result.sympyLatex ?? null)};
    const code      = ${JSON.stringify(code)};
    const renderBox = document.getElementById('render-box');
    const latexSrc  = document.getElementById('latex-src');
    const vscode    = acquireVsCodeApi();
    let   current   = rawLatex;
    let   pendingToast = '';
    let   currentSize  = 1.8;

    function render(latex, size) {
      renderBox.innerHTML = '';
      latexSrc.textContent = latex || '';
      if (!latex) { renderBox.innerHTML = '<span style="opacity:.5">Nothing to render.</span>'; return; }
      try {
        katex.render(latex, renderBox, { displayMode: true, throwOnError: false, output: 'html' });
        const el = renderBox.querySelector('.katex');
        if (el) el.style.fontSize = size + 'em';
      } catch(e) {
        renderBox.innerHTML = '<span style="color:var(--vscode-errorForeground,#f48771)">Render error: ' + e.message + '</span>';
      }
    }

    function toast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg; t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 1800);
    }

    render(current, currentSize);

    ${hasSympy ? `
    const btnRaw  = document.getElementById('btnRaw');
    const btnEval = document.getElementById('btnEval');
    btnRaw.addEventListener('click', () => {
      current = rawLatex; render(current, currentSize);
      btnRaw.classList.add('active'); btnEval.classList.remove('active');
    });
    btnEval.addEventListener('click', () => {
      current = evalLatex; render(current, currentSize);
      btnEval.classList.add('active'); btnRaw.classList.remove('active');
    });
    ` : ''}

    window.addEventListener('message', e => { if (e.data.command === 'copyDone') toast(pendingToast); });
    document.getElementById('btnCopyLatex').addEventListener('click', () => {
      pendingToast = 'LaTeX copied!';
      vscode.postMessage({ command: 'copy', text: current });
    });
    document.getElementById('btnCopyCode').addEventListener('click', () => {
      pendingToast = 'Python copied!';
      vscode.postMessage({ command: 'copy', text: code });
    });
    document.getElementById('sizeSlider').addEventListener('input', e => {
      currentSize = parseFloat(e.target.value);
      const el = renderBox.querySelector('.katex');
      if (el) el.style.fontSize = currentSize + 'em';
    });
  </script>
</body>
</html>`;
}
// ─── Helpers ──────────────────────────────────────────────────────────────────
function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function getNonce() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
//# sourceMappingURL=extension.js.map