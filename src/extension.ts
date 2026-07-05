import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
// Fix #12: use async spawn instead of spawnSync so a slow SymPy never freezes the UI
import { spawn } from 'child_process';
import { pythonToLatex, pythonLineToLatex, ConversionResult } from './pythonToLatex';


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

# Evaluate EVERY line (not just the last) and emit one JSON entry per line:
# [var_latex_or_null, expr_latex] when the line evaluated, null when it didn't.
# Lines share the namespace so later lines can use earlier assignments.
_results = []

for _line in _lines:
    _val = None
    _var = None
    _m = re.match(r'^([A-Za-z_]\\w*)\\s*=(?![=+\\-*\\/&|^])\\s*(.+)$', _line)
    if _m:
        _varname, _rhs = _m.group(1), _m.group(2)
        try:
            exec(_line, _ns)
            _var = _varname
            _val = _ns.get(_varname)
        except:
            try:
                _val = eval(_rhs.strip(), _ns)
                _var = _varname
                _ns[_varname] = _val
            except: pass
    else:
        try:
            _val = eval(_line, _ns)
        except:
            try: exec(_line, _ns)
            except: pass

    if _val is None:
        _results.append(None)
        continue

    # Force evaluation of unevaluated forms (Derivative, Integral, Sum, etc.)
    try:
        _evaled = _val.doit()
        if _evaled != _val:
            _val = _evaled
    except: pass

    try:
        from sympy import latex, Symbol
        _expr_latex = latex(_val)
        if _var:
            try:    _var_latex = latex(Symbol(_var))
            except: _var_latex = _var
            _results.append([_var_latex, _expr_latex])
        else:
            _results.append([None, _expr_latex])
    except:
        _results.append(None)

if all(r is None for r in _results):
    sys.stderr.write('no-result'); sys.exit(1)

print(json.dumps(_results))
`.trim();

const SCRIPT_PATH = path.join(os.tmpdir(), 'pev_runner.py');
const DATA_PATH   = path.join(os.tmpdir(), 'pev_data.json');
let   scriptWritten = false;  // reset to false to force rewrite on next run

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {

  // Fix #12: command handlers are async — the SymPy subprocess runs off the UI thread
  const cmd = vscode.commands.registerCommand('pythonVisualizer.visualize', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showErrorMessage('No active editor found.'); return; }
    const sel  = editor.selection;
    const code = editor.document.getText(sel.isEmpty ? undefined : sel).trim();
    if (!code) { vscode.window.showWarningMessage('Select a Python expression first.'); return; }
    const result = await resolveLatex(code, editor.document, sel.start);
    showExtendedPanel(context, code, result);
  });

  const quickCmd = vscode.commands.registerCommand('pythonVisualizer.quickPreview', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showErrorMessage('No active editor found.'); return; }
    const sel = editor.selection;
    if (sel.isEmpty) { vscode.window.showWarningMessage('Select a Python expression first.'); return; }
    const code = editor.document.getText(sel).trim();
    if (!code) { return; }
    const result = await resolveLatex(code, editor.document, sel.start);
    showQuickPanel(context, code, result);
  });

  // Fix #11: only close the quick panel when the user deliberately empties the
  // selection (mouse/keyboard) in a Python editor — programmatic or focus-driven
  // selection events (e.g. clicking the panel itself) no longer close it
  const selectionWatcher = vscode.window.onDidChangeTextEditorSelection(event => {
    const deliberate =
      event.kind === vscode.TextEditorSelectionChangeKind.Mouse ||
      event.kind === vscode.TextEditorSelectionChangeKind.Keyboard;
    if (deliberate &&
        event.textEditor.document.languageId === 'python' &&
        event.selections[0].isEmpty) {
      closeQuickPanel();
    }
  });

  context.subscriptions.push(cmd, quickCmd, selectionWatcher);
}

export function deactivate() {}

// ─── LaTeX resolution: SymPy subprocess → structural parser fallback ──────────

interface ResolvedLatex {
  parserLatex: string;    // structural parser — always available
  sympyLatex?: string;    // SymPy evaluated — only when subprocess succeeds
  parserError?: string;
}

// Fix #12: async — awaits the subprocess instead of blocking the extension host
async function resolveLatex(
  code: string,
  document: vscode.TextDocument,
  selectionStart: vscode.Position,
): Promise<ResolvedLatex> {
  const { latex: parserLatex, error: parserError } = pythonToLatex(code);
  const result: ResolvedLatex = { parserLatex, parserError };

  if (hasSymPyImport(document)) {
    const preamble = extractPreamble(document, selectionStart);
    const sympyLines = await trySymPyLatex(code, preamble);
    // The runner returns one result per line; merge evaluated lines with raw
    // parser fallbacks so multi-line selections keep every line in the
    // "Evaluated" view, not just the last one.
    const sympy = buildSympyLatex(code, sympyLines);
    // Only expose the SymPy version if it's meaningfully different from the
    // parser version — not just a reordering of the same terms.
    if (sympy !== null && isMeaningfullyDifferent(parserLatex, sympy)) {
      result.sympyLatex = sympy;
    }
  }

  return result;
}

// One entry per selected line: [var_latex | null, expr_latex] when SymPy evaluated
// the line, or null when it could not.
type SymPyLine = [string | null, string] | null;

// Merge per-line SymPy results into a single LaTeX block. Lines SymPy could not
// evaluate keep their structural-parser rendering, so all selected lines stay
// visible in the "Evaluated" view.
function buildSympyLatex(code: string, sympyLines: SymPyLine[] | null): string | null {
  if (!sympyLines || !sympyLines.some(l => l !== null)) { return null; }

  // Same line filtering as the parser and the Python runner use
  const lines = code.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#'));
  if (lines.length !== sympyLines.length) { return null; } // line accounting mismatch

  // The LHS variable name always keeps the parser's rendering (expr55 stays expr55) —
  // SymPy's latex(Symbol(...)) would restyle it (expr_{55}); only the RHS is evaluated.
  if (lines.length === 1) {
    const s = sympyLines[0];
    if (!s) { return null; }
    const lhs = pythonLineToLatex(lines[0]).lhs ?? s[0];
    return lhs !== null ? `${lhs} = ${s[1]}` : s[1];
  }

  const rows = lines.map((line, i) => {
    const s = sympyLines[i];
    const p = pythonLineToLatex(line);
    if (s) {
      const lhs = p.lhs ?? s[0];
      return lhs !== null ? `${lhs} &= ${s[1]}` : s[1];
    }
    // raw fallback for non-evaluable lines
    return p.lhs !== null ? `${p.lhs} &= ${p.rhs}` : p.rhs;
  });
  return `\\begin{aligned}\n${rows.join(' \\\\\n')}\n\\end{aligned}`;
}

// Returns true when two LaTeX strings differ beyond mere term reordering.
// Strategy: strip all LaTeX markup, keep only alphanumeric chars and basic
// operators, sort what remains, and compare.  If the sorted content is the
// same the expressions are considered equivalent (just reordered).
// Fix #3: hardened normalization — handles \\ row breaks (incl. \\[4pt]), array
// column specs, and ALL escaped symbols (\{, \|, \%, …), so matrices from SymPy
// vs. the structural parser no longer produce false "meaningfully different" calls
function isMeaningfullyDifferent(a: string, b: string): boolean {
  const normalize = (s: string) =>
    s
      // \begin{array}{ccc} carries a column spec that must go too
      .replace(/\\begin\{array\}\{[^}]*\}/g, ' ')
      // Remove \begin{env} and \end{env} entirely (matrix, aligned, cases, etc.)
      .replace(/\\(?:begin|end)\{[^}]*\}/g, ' ')
      // LaTeX row breaks \\ and \\[6pt] become spaces BEFORE command stripping,
      // otherwise the second \ merges with the next letter (e.g. \\c → \c removed)
      .replace(/\\\\(?:\[[^\]]*\])?/g, ' ')
      // Drop ALL LaTeX commands (\sin, \operatorname*) and escaped single chars
      // (\!, \,, \{, \}, \|, \%, …) — the old class missed the escaped symbols
      .replace(/\\(?:[a-zA-Z]+\*?|[^a-zA-Z])/g, ' ')
      // Collapse grouping and alignment chars so expr50 == expr_{50}
      .replace(/[_{}^&]/g, '')
      // Keep only alphanumeric and meaningful math operators
      .replace(/[^a-zA-Z0-9+\-*/=<>]/g, '')
      .split('').sort().join('');
  return normalize(a) !== normalize(b);
}

// Returns true if the document imports sympy anywhere
function hasSymPyImport(document: vscode.TextDocument): boolean {
  for (let i = 0; i < document.lineCount; i++) {
    const line = document.lineAt(i).text;
    if (/\bsympy\b/.test(line) && /\b(import|from)\b/.test(line)) { return true; }
  }
  return false;
}

// Collect import lines and symbol declarations above the selection.
// We deliberately exclude plain variable assignments (A = x**2 + 4) so the
// subprocess does not silently substitute earlier values into the expression.
function extractPreamble(document: vscode.TextDocument, before: vscode.Position): string[] {
  const lines: string[] = [];
  for (let i = 0; i < before.line; i++) {
    const line = document.lineAt(i).text.trim();
    if (!line || line.startsWith('#')) { continue; }
    // All import / from … import lines
    if (line.startsWith('import ') || line.startsWith('from ')) { lines.push(line); continue; }
    // Symbol / dynamicsymbols / Function declarations
    if (/\b(symbols|Symbol|dynamicsymbols|Function|var)\s*\(/.test(line)) { lines.push(line); continue; }
    // init_printing() and similar setup helpers
    if (/^init_\w+\s*\(/.test(line)) { lines.push(line); }
  }
  return lines;
}

interface PyRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnFailed: boolean;
}

// Fix #12: async spawn wrapper with a kill timer — never blocks the UI thread
function runPython(py: string, args: string[], timeoutMs: number): Promise<PyRunResult> {
  return new Promise(resolve => {
    let stdout = '', stderr = '', timedOut = false;
    const child = spawn(py, args);
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ status: null, stdout, stderr, timedOut, spawnFailed: true });
    });
    child.on('close', status => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr, timedOut, spawnFailed: false });
    });
  });
}

// Spawn Python, run the SymPy runner, return per-line results or null on failure
async function trySymPyLatex(code: string, preamble: string[]): Promise<SymPyLine[] | null> {
  try {
    fs.writeFileSync(SCRIPT_PATH, PYTHON_SCRIPT, 'utf8');
    fs.writeFileSync(DATA_PATH, JSON.stringify({ code, preamble }), 'utf8');

    for (const py of ['python3', 'python']) {
      // Fix #12: timeout reduced from 10s to 5s
      const r = await runPython(py, [SCRIPT_PATH, DATA_PATH], 5000);
      if (r.spawnFailed) { continue; }     // interpreter not found — try the next one
      // Fix #13: a timeout, a no-sympy signal, or any completed-but-failed run stops
      // here — retrying the other interpreter would only double the wait for the
      // same outcome
      if (r.timedOut) { return null; }
      if (r.status === 0 && r.stdout.trim()) {
        // The runner prints a JSON array with one entry per line
        try {
          const parsed: unknown = JSON.parse(r.stdout.trim());
          if (Array.isArray(parsed)) { return parsed as SymPyLine[]; }
        } catch { /* malformed output */ }
      }
      return null;
    }
  } catch { /* file system error */ }
  return null;
}

// ─── Quick preview panel ──────────────────────────────────────────────────────

let quickPanel: vscode.WebviewPanel | undefined;
let quickPanelCode = '';
let quickPanelResult: ResolvedLatex = { parserLatex: '' };

function showQuickPanel(context: vscode.ExtensionContext, code: string, result: ResolvedLatex) {
  const katexBase = vscode.Uri.joinPath(context.extensionUri, 'node_modules', 'katex', 'dist');
  quickPanelCode   = code;
  quickPanelResult = result;

  if (!quickPanel) {
    quickPanel = vscode.window.createWebviewPanel(
      'pythonVisualizerQuick', 'Equation Preview',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, localResourceRoots: [katexBase], retainContextWhenHidden: true }
    );
    quickPanel.onDidDispose(() => { quickPanel = undefined; quickPanelCode = ''; });

    quickPanel.webview.onDidReceiveMessage(() => {
      if (quickPanelCode) {
        const code   = quickPanelCode;
        const result = quickPanelResult;
        closeQuickPanel();               // close quick panel first
        showExtendedPanel(context, code, result);
      }
    });
  }

  const js  = quickPanel.webview.asWebviewUri(vscode.Uri.joinPath(katexBase, 'katex.min.js'));
  const css = quickPanel.webview.asWebviewUri(vscode.Uri.joinPath(katexBase, 'katex.min.css'));
  quickPanel.webview.html = buildQuickHtml(quickPanel.webview, code, result, js, css);
}

function closeQuickPanel() { quickPanel?.dispose(); quickPanel = undefined; }

// ─── Extended panel ───────────────────────────────────────────────────────────

let extPanel: vscode.WebviewPanel | undefined;

function showExtendedPanel(
  context: vscode.ExtensionContext,
  code: string,
  result: ResolvedLatex,
) {
  const katexBase = vscode.Uri.joinPath(context.extensionUri, 'node_modules', 'katex', 'dist');

  if (extPanel) {
    extPanel.reveal(vscode.ViewColumn.Beside);
  } else {
    extPanel = vscode.window.createWebviewPanel(
      'pythonVisualizerExtended', 'Expression Visualizer',
      vscode.ViewColumn.Beside,
      { enableScripts: true, localResourceRoots: [katexBase], retainContextWhenHidden: true }
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
  extPanel.webview.html = buildExtendedHtml(extPanel.webview, code, result, js, css);
}

// ─── Quick panel HTML ─────────────────────────────────────────────────────────

function buildQuickHtml(
  webview: vscode.Webview,
  _code: string,
  result: ResolvedLatex,
  katexJs: vscode.Uri,
  katexCss: vscode.Uri,
): string {
  const nonce      = getNonce();
  const hasSympy   = !!result.sympyLatex;
  const toggleHtml = hasSympy
    ? `<div class="toggle" id="toggle">
         <button class="tog-btn active" id="btnRaw">Raw</button>
         <button class="tog-btn" id="btnEval">Evaluated</button>
       </div>`
    : '';

  return /* html */`<!DOCTYPE html>
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
    const rawLatex   = ${jsonForScript(result.parserLatex)};
    const evalLatex  = ${jsonForScript(result.sympyLatex ?? null)};
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

function buildExtendedHtml(
  webview: vscode.Webview,
  code: string,
  result: ResolvedLatex,
  katexJs: vscode.Uri,
  katexCss: vscode.Uri,
): string {
  const nonce     = getNonce();
  const safeCode  = escHtml(code);
  const hasSympy  = !!result.sympyLatex;
  const errorHtml = result.parserError
    ? `<div class="error">Parser note: ${escHtml(result.parserError)}</div>`
    : '';

  const toggleHtml = hasSympy
    ? `<div class="toggle">
         <button class="tog-btn active" id="btnRaw">Raw</button>
         <button class="tog-btn" id="btnEval">Evaluated</button>
       </div>`
    : '';

  return /* html */`<!DOCTYPE html>
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
    const rawLatex  = ${jsonForScript(result.parserLatex)};
    const evalLatex = ${jsonForScript(result.sympyLatex ?? null)};
    const code      = ${jsonForScript(code)};
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

// Fix #18: JSON.stringify alone is NOT safe inside a <script> block — a selection
// containing "</script>" would terminate the script tag and inject raw HTML.
// Escaping '<' as the JS escape sequence \\u003c keeps the string identical in JS
// while making HTML breakout impossible. (KaTeX itself escapes its rendered
// output, and code shown in the page body goes through escHtml.)
function jsonForScript(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c');
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
