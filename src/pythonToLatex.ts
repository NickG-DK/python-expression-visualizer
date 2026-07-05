// ─── Token types ─────────────────────────────────────────────────────────────

const enum TT {
  Number     = 'NUMBER',
  Identifier = 'IDENTIFIER',
  String     = 'STRING',
  Plus       = '+',
  Minus      = '-',
  Star       = '*',
  Slash      = '/',
  DoubleSlash = '//',
  DoubleStar = '**',
  Percent    = '%',
  At         = '@',           // matrix multiply
  LParen     = '(',
  RParen     = ')',
  LBracket   = '[',
  RBracket   = ']',
  Comma      = ',',
  Dot        = '.',
  Equals     = '=',
  Colon      = ':',           // Fix #8: needed to delimit lambda parameter lists
  Lambda     = 'lambda',      // Fix #8: lambda keyword token
  EqEq       = '==',
  NotEq      = '!=',
  Lt         = '<',
  LtEq       = '<=',
  Gt         = '>',
  GtEq       = '>=',
  Newline    = 'NEWLINE',
  EOF        = 'EOF',
}

interface Token { type: TT; value: string }

// ─── Tokenizer ───────────────────────────────────────────────────────────────

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue; }
    if (ch === '\n') { out.push({ type: TT.Newline, value: '\n' }); i++; continue; }
    if (ch === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }

    // String literals (consume but don't try to convert)
    if (ch === '"' || ch === "'") {
      const q = src.slice(i, i + 3) === ch.repeat(3) ? ch.repeat(3) : ch;
      i += q.length;
      let s = '';
      while (i < src.length && src.slice(i, i + q.length) !== q) {
        if (src[i] === '\\') { s += src[i++]; }
        s += src[i++];
      }
      i += q.length;
      out.push({ type: TT.String, value: s });
      continue;
    }

    // Numbers
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && /\d/.test(src[j])) j++;
      if (j < src.length && src[j] === '.') {
        j++;
        while (j < src.length && /\d/.test(src[j])) j++;
      }
      if (j < src.length && /[eE]/.test(src[j])) {
        j++;
        if (j < src.length && /[+\-]/.test(src[j])) j++;
        while (j < src.length && /\d/.test(src[j])) j++;
      }
      if (j < src.length && /[jJ]/.test(src[j])) j++; // complex
      out.push({ type: TT.Number, value: src.slice(i, j) });
      i = j; continue;
    }

    // Identifiers — accept Unicode letters (æ, ø, å, etc.) as Python 3 does
    if (/[_\p{L}]/u.test(ch)) {
      let j = i;
      while (j < src.length && /[\d_\p{L}]/u.test(src[j])) j++;
      const word = src.slice(i, j);
      // Fix #8: 'lambda' is a Python keyword, not an identifier — emit a dedicated
      // token so `lambda x: x**2` can render as x ↦ x² instead of \lambda x x^2
      out.push({ type: word === 'lambda' ? TT.Lambda : TT.Identifier, value: word });
      i = j; continue;
    }

    // Multi-char operators
    const two = src.slice(i, i + 2);
    if (two === '**') { out.push({ type: TT.DoubleStar,  value: '**' }); i += 2; continue; }
    if (two === '//') { out.push({ type: TT.DoubleSlash, value: '//' }); i += 2; continue; }
    if (two === '==') { out.push({ type: TT.EqEq,        value: '==' }); i += 2; continue; }
    if (two === '!=') { out.push({ type: TT.NotEq,       value: '!=' }); i += 2; continue; }
    if (two === '<=') { out.push({ type: TT.LtEq,        value: '<=' }); i += 2; continue; }
    if (two === '>=') { out.push({ type: TT.GtEq,        value: '>=' }); i += 2; continue; }
    if (two === '->' || two === ':=') { i += 2; continue; } // skip arrows / walrus

    // Single-char operators
    const SINGLE: Partial<Record<string, TT>> = {
      '+': TT.Plus, '-': TT.Minus, '*': TT.Star, '/': TT.Slash,
      '%': TT.Percent, '@': TT.At,
      '(': TT.LParen, ')': TT.RParen,
      '[': TT.LBracket, ']': TT.RBracket,
      ',': TT.Comma, '.': TT.Dot, '=': TT.Equals,
      '<': TT.Lt, '>': TT.Gt,
      ':': TT.Colon, // Fix #8: ':' is now a real token (lambda); ':=' is still skipped above
    };
    if (SINGLE[ch]) { out.push({ type: SINGLE[ch]!, value: ch }); i++; continue; }

    i++; // skip unknown
  }

  out.push({ type: TT.EOF, value: '' });
  return out;
}

// ─── Identifier / constant maps ──────────────────────────────────────────────

const GREEK: Record<string, string> = {
  alpha: '\\alpha', beta: '\\beta', gamma: '\\gamma', delta: '\\delta',
  epsilon: '\\epsilon', varepsilon: '\\varepsilon', zeta: '\\zeta',
  eta: '\\eta', theta: '\\theta', vartheta: '\\vartheta', iota: '\\iota',
  kappa: '\\kappa', lambda: '\\lambda', mu: '\\mu', nu: '\\nu',
  xi: '\\xi', pi: '\\pi', varpi: '\\varpi', rho: '\\rho', varrho: '\\varrho',
  sigma: '\\sigma', varsigma: '\\varsigma', tau: '\\tau', upsilon: '\\upsilon',
  phi: '\\phi', varphi: '\\varphi', chi: '\\chi', psi: '\\psi', omega: '\\omega',
  Gamma: '\\Gamma', Delta: '\\Delta', Theta: '\\Theta', Lambda: '\\Lambda',
  Xi: '\\Xi', Pi: '\\Pi', Sigma: '\\Sigma', Upsilon: '\\Upsilon',
  Phi: '\\Phi', Psi: '\\Psi', Omega: '\\Omega',
};

const CONSTANTS: Record<string, string> = {
  pi: '\\pi', e: 'e', inf: '\\infty', infty: '\\infty',
  nan: '\\text{NaN}', True: '\\text{True}', False: '\\text{False}', None: '\\text{None}',
};

// Dotted names like np.pi
const DOTTED_CONSTANTS: Record<string, string> = {
  'np.pi': '\\pi', 'np.e': 'e', 'np.inf': '\\infty', 'np.nan': '\\text{NaN}',
  'np.euler_gamma': '\\gamma', 'numpy.pi': '\\pi', 'numpy.e': 'e',
  'math.pi': '\\pi', 'math.e': 'e', 'math.inf': '\\infty', 'math.tau': '2\\pi',
  'sp.pi': '\\pi', 'sp.E': 'e', 'sp.I': 'i', 'sp.oo': '\\infty', 'sp.nan': '\\text{NaN}',
  'sympy.pi': '\\pi', 'sympy.E': 'e', 'sympy.I': 'i', 'sympy.oo': '\\infty',
  'oo': '\\infty',   // bare oo from `from sympy import *`
};

function stripModulePrefix(name: string): string {
  for (const p of [
    'np.linalg.', 'np.fft.', 'np.random.', 'np.polynomial.',
    'np.',
    'numpy.linalg.', 'numpy.fft.', 'numpy.random.', 'numpy.polynomial.',
    'numpy.',
    'math.', 'cmath.',
    'scipy.integrate.', 'scipy.linalg.', 'scipy.special.', 'scipy.stats.',
    'scipy.misc.', 'scipy.signal.', 'scipy.fft.', 'scipy.',
    'sympy.', 'sym.', 'sp.',
    'torch.linalg.', 'torch.', 'tf.math.', 'tf.',
    'integrate.',  // from scipy.integrate import ...
    'special.',    // from scipy.special import ...
  ]) {
    if (name.startsWith(p)) return name.slice(p.length);
  }
  return name;
}

// Fix #16: subscript renderer — 1–2 letter subscripts stay italic (sigma_ij → \sigma_{ij});
// only word-like subscripts of 3+ letters (x_max, T_out) are wrapped in \mathrm.
function subscriptToLatex(sub: string): string {
  if (GREEK[sub]) return GREEK[sub];
  if (/^\d+$/.test(sub)) return sub;
  if (/^[a-zA-Z]{1,2}$/.test(sub)) return sub;
  if (/^[a-zA-Z]+$/.test(sub)) return `\\mathrm{${sub}}`;
  return identToLatex(sub);
}

function identToLatex(name: string): string {
  if (CONSTANTS[name]) return CONSTANTS[name];
  if (GREEK[name])    return GREEK[name];

  // Handle trailing j/J for complex literals that slipped through as identifiers
  if (name === 'j' || name === 'J') return 'i';

  // Greek letter + digit suffix: theta1 → \theta_{1}, omega2 → \omega_{2}
  // Try longest Greek name first to avoid e.g. "ph" matching inside "phi"
  const greekNames = Object.keys(GREEK).sort((a, b) => b.length - a.length);
  for (const greek of greekNames) {
    if (name.startsWith(greek) && name.length > greek.length) {
      const suffix = name.slice(greek.length);
      if (/^\d+$/.test(suffix)) {
        // purely numeric suffix → subscript digit(s)
        return `${GREEK[greek]}_{${suffix}}`;
      }
      if (/^[a-zA-Z]\w*$/.test(suffix)) {
        // alphabetic suffix → subscript identifier (Fix #16: no \mathrm for short subs)
        return `${GREEK[greek]}_{${subscriptToLatex(suffix)}}`;
      }
    }
  }

  // Subscripts: split on first underscore
  const u = name.indexOf('_');
  if (u > 0) {
    const base = name.slice(0, u);
    const sub  = name.slice(u + 1);
    // Fix #16: short alphabetic subscripts (ij, xy) stay italic; \mathrm only for words
    return `${identToLatex(base)}_{${subscriptToLatex(sub)}}`;
  }

  // Single letter — natural italic in math mode
  if ([...name].length === 1) return name;

  // Single ASCII letter + digit(s): x1 → x_{1}, P2 → P_{2}, v12 → v_{12}
  const letterDigit = name.match(/^([a-zA-Z])(\d+)$/);
  if (letterDigit) return `${letterDigit[1]}_{${letterDigit[2]}}`;

  // Non-ASCII names must use \text{} because \mathrm{} only handles ASCII in KaTeX
  if (/[^\x00-\x7F]/.test(name)) return `\\text{${name}}`;

  return `\\mathrm{${name}}`;
}

// ─── Function conversion ──────────────────────────────────────────────────────

function funcToLatex(rawName: string, args: string[]): string {
  const name = stripModulePrefix(rawName);
  const [a = '', b = '', c = ''] = args;

  switch (name) {
    // Roots
    case 'sqrt':   return `\\sqrt{${a}}`;
    case 'cbrt':   return `\\sqrt[3]{${a}}`;
    case 'root':   return b ? `\\sqrt[${b}]{${a}}` : `\\sqrt{${a}}`;

    // Trig
    case 'sin':    return `\\sin\\!\\left(${a}\\right)`;
    case 'cos':    return `\\cos\\!\\left(${a}\\right)`;
    case 'tan':    return `\\tan\\!\\left(${a}\\right)`;
    case 'cot':    return `\\cot\\!\\left(${a}\\right)`;
    case 'sec':    return `\\sec\\!\\left(${a}\\right)`;
    case 'csc':    return `\\csc\\!\\left(${a}\\right)`;
    case 'asin': case 'arcsin': return `\\arcsin\\!\\left(${a}\\right)`;
    case 'acos': case 'arccos': return `\\arccos\\!\\left(${a}\\right)`;
    case 'atan': case 'arctan': return `\\arctan\\!\\left(${a}\\right)`;
    case 'acot': case 'arccot': return `\\operatorname{arccot}\\!\\left(${a}\\right)`;
    case 'asec': case 'arcsec': return `\\operatorname{arcsec}\\!\\left(${a}\\right)`;
    case 'acsc': case 'arccsc': return `\\operatorname{arccsc}\\!\\left(${a}\\right)`;
    case 'atan2':  return `\\operatorname{atan2}\\!\\left(${a},\\,${b}\\right)`;

    // Hyperbolic
    case 'sinh':   return `\\sinh\\!\\left(${a}\\right)`;
    case 'cosh':   return `\\cosh\\!\\left(${a}\\right)`;
    case 'tanh':   return `\\tanh\\!\\left(${a}\\right)`;
    case 'coth':   return `\\coth\\!\\left(${a}\\right)`;
    case 'sech':   return `\\operatorname{sech}\\!\\left(${a}\\right)`;
    case 'csch':   return `\\operatorname{csch}\\!\\left(${a}\\right)`;
    case 'asinh': case 'arcsinh': return `\\operatorname{arcsinh}\\!\\left(${a}\\right)`;
    case 'acosh': case 'arccosh': return `\\operatorname{arccosh}\\!\\left(${a}\\right)`;
    case 'atanh': case 'arctanh': return `\\operatorname{arctanh}\\!\\left(${a}\\right)`;

    // Exponential / log
    case 'exp':    return `e^{${a}}`;
    case 'expm1':  return `e^{${a}} - 1`;
    case 'log':
      return b ? `\\log_{${b}}\\!\\left(${a}\\right)` : `\\ln\\!\\left(${a}\\right)`;
    case 'log2':   return `\\log_{2}\\!\\left(${a}\\right)`;
    case 'log10':  return `\\log_{10}\\!\\left(${a}\\right)`;
    case 'log1p':  return `\\ln\\!\\left(1 + ${a}\\right)`;
    case 'ln':     return `\\ln\\!\\left(${a}\\right)`;

    // Rounding
    case 'abs':    return `\\left|${a}\\right|`;
    case 'floor':  return `\\left\\lfloor ${a} \\right\\rfloor`;
    case 'ceil':   return `\\left\\lceil ${a} \\right\\rceil`;
    case 'round':  return b
      ? `\\operatorname{round}\\!\\left(${a},\\,${b}\\right)`
      : `\\operatorname{round}\\!\\left(${a}\\right)`;

    // Extrema
    case 'min':    return `\\min\\!\\left(${args.join(',\\,')}\\right)`;
    case 'max':    return `\\max\\!\\left(${args.join(',\\,')}\\right)`;
    case 'minimum': return `\\min\\!\\left(${a},\\,${b}\\right)`;
    case 'maximum': return `\\max\\!\\left(${a},\\,${b}\\right)`;
    case 'clip':   return `\\operatorname{clip}\\!\\left(${a},\\,${b},\\,${c}\\right)`;

    // Linear algebra
    case 'dot':       return `${a} \\cdot ${b}`;
    case 'cross':     return `${a} \\times ${b}`;
    case 'matmul':    return `${a} ${b}`;
    case 'norm':      return `\\left\\| ${a} \\right\\|`;
    case 'det':       return `\\det\\!\\left(${a}\\right)`;
    case 'trace': case 'tr': return `\\operatorname{tr}\\!\\left(${a}\\right)`;
    case 'inv':       return `{${a}}^{-1}`;
    case 'pinv':      return `{${a}}^{+}`;
    case 'transpose': return `{${a}}^{\\top}`;
    case 'T':         return `{${a}}^{\\top}`;
    // linalg.solve(A,b) → A⁻¹b; sp.solve(f,x) → generic algebraic solver display
    case 'solve':
      if (rawName.includes('linalg')) return `${a}^{-1}\\,${b}`;
      return b
        ? `\\left\\{${b} \\mid ${a} = 0\\right\\}`
        : `\\operatorname{solve}\\!\\left(${a}\\right)`;
    case 'outer':     return `${a} \\otimes ${b}`;
    case 'kron':      return `${a} \\otimes ${b}`;

    // Complex
    case 'conj': case 'conjugate': return `\\overline{${a}}`;
    case 'real':  return `\\operatorname{Re}\\!\\left(${a}\\right)`;
    case 'imag':  return `\\operatorname{Im}\\!\\left(${a}\\right)`;
    case 'angle': return `\\arg\\!\\left(${a}\\right)`;

    // Sign / misc
    case 'sign': case 'sgn': return `\\operatorname{sgn}\\!\\left(${a}\\right)`;
    case 'heaviside':        return `H\\!\\left(${a}\\right)`;
    case 'dirac':            return `\\delta\\!\\left(${a}\\right)`;

    // Combinatorics
    case 'factorial':        return `${a}!`;
    case 'comb': case 'choose': return `\\binom{${a}}{${b}}`;
    case 'perm':             return `P\\!\\left(${a},\\,${b}\\right)`;
    case 'gcd':              return `\\gcd\\!\\left(${args.join(',\\,')}\\right)`;
    case 'lcm':              return `\\operatorname{lcm}\\!\\left(${args.join(',\\,')}\\right)`;

    // SymPy special forms
    case 'Rational': case 'Fraction': return `\\frac{${a}}{${b}}`;
    case 'Symbol':   return a.replace(/['"]/g, '');
    case 'symbols':  return args.map(s => s.replace(/['"]/g, '')).join(',\\,');
    case 'Pow':      return `{${a}}^{${b}}`;
    case 'Add':      return args.join(' + ');
    case 'Mul':      return args.join(' \\cdot ');

    // Equality / relational
    case 'Eq':  return `${a} = ${b}`;
    case 'Ne':  return `${a} \\neq ${b}`;
    case 'Lt':  return `${a} < ${b}`;
    case 'Le':  return `${a} \\leq ${b}`;
    case 'Gt':  return `${a} > ${b}`;
    case 'Ge':  return `${a} \\geq ${b}`;

    // Lambda / anonymous function
    case 'Lambda': return `${a} \\mapsto ${b}`;

    // sp.latex(expr) — the user is calling latex() themselves; just render the inner expr
    case 'latex': return a || '';

    // Piecewise: args are pairs (expr, condition) passed as tuples → spread
    // Fix #9: extractTuple now robustly unwraps rendered LaTeX tuples (any paren style
    // or comma separator), so (expr, cond) pairs no longer silently fail; a literal
    // True condition renders as "otherwise".
    case 'Piecewise': {
      const cases: string[] = [];
      for (const arg of args) {
        const t = extractTuple(arg);
        if (t && t.length >= 2) {
          const cond = t[1] === '\\text{True}' ? '\\text{otherwise}' : `\\text{if } ${t[1]}`;
          cases.push(`${t[0]} & ${cond}`);
        } else if (arg) {
          cases.push(arg);
        }
      }
      return `\\begin{cases} ${cases.join(' \\\\ ')} \\end{cases}`;
    }

    // Fix #6: zeros/ones/eye/full render as actual constant matrices (or a symbolic
    // 0/1/I with dimensions) instead of a bmatrix containing the shape tuple.
    case 'eye': case 'identity': {
      const n = Number(a);
      if (Number.isInteger(n) && n > 0 && n <= 8) {
        const rows = Array.from({ length: n }, (_, r) =>
          Array.from({ length: n }, (_, cIdx) => (r === cIdx ? '1' : '0')).join(' & '));
        return `\\begin{bmatrix} ${rows.join(' \\\\ ')} \\end{bmatrix}`;
      }
      return `I_{${a}}`;
    }
    case 'zeros': case 'ones': case 'full': {
      const fill  = name === 'ones' ? '1' : name === 'full' ? (b || '0') : '0';
      // Shape comes either as a tuple first argument — zeros((3,3)) — or as
      // separate positional args — zeros(3, 3) (SymPy style)
      const shape = (name === 'full' || args.length === 1)
        ? (extractTuple(a) ?? [a])
        : args;
      const explicit = buildConstMatrix(shape, fill);
      if (explicit) return explicit;
      const dims = shape.join(' \\times ');
      if (name === 'full') return `${fill} \\cdot \\mathbf{1}_{${dims}}`;
      return `${name === 'ones' ? '\\mathbf{1}' : '\\mathbf{0}'}_{${dims}}`;
    }

    // Matrix / array constructors → \begin{bmatrix}...\end{bmatrix}
    case 'Matrix': case 'ImmutableMatrix': case 'MutableMatrix':
    case 'array': case 'ndarray': case 'mat': case 'matrix':
    case 'diag': case 'block_diag': {
      if (args.length === 1) {
        const rows = parseLatexMatrix(args[0]);
        if (rows) {
          const body = rows.map(r => r.join(' & ')).join(' \\\\ ');
          return `\\begin{bmatrix} ${body} \\end{bmatrix}`;
        }
      }
      return `\\begin{bmatrix} ${args.join(',\\,')} \\end{bmatrix}`;
    }

    // Calculus (SymPy) — extract limits from tuple second argument
    case 'diff': case 'Derivative': {
      const wrt = b || 'x';
      const order = c || '';
      if (order) return `\\frac{d^{${order}}}{d\\,${wrt}^{${order}}} ${groupForPostfix(a)}`;
      return `\\frac{d}{d\\,${wrt}} ${groupForPostfix(a)}`;
    }
    case 'integrate': case 'Integral': {
      if (b) {
        const t = extractTuple(b);
        if (t && t.length >= 3) return `\\int_{${t[1]}}^{${t[2]}} ${a} \\, d${t[0]}`;
        return `\\int ${a} \\, d${b}`;
      }
      return `\\int ${a} \\, dx`;
    }
    case 'limit': case 'Limit':
      return `\\lim_{${b || 'x'} \\to ${c || '\\infty'}} ${a}`;
    case 'Sum': case 'summation': {
      if (b) {
        const t = extractTuple(b);
        if (t && t.length >= 3) return `\\sum_{${t[0]}=${t[1]}}^{${t[2]}} ${a}`;
        if (t && t.length >= 1) return `\\sum_{${t[0]}} ${a}`;
        return `\\sum_{${b}} ${a}`;
      }
      return `\\sum ${a}`;
    }
    case 'Product': {
      if (b) {
        const t = extractTuple(b);
        if (t && t.length >= 3) return `\\prod_{${t[0]}=${t[1]}}^{${t[2]}} ${a}`;
      }
      return `\\prod ${a}`;
    }

    // Aggregation
    case 'sum':      return `\\sum ${a}`;
    case 'prod': case 'product': return `\\prod ${a}`;
    case 'mean': case 'average': return `\\bar{${a}}`;
    case 'var': case 'variance': return `\\operatorname{Var}\\!\\left(${a}\\right)`;
    case 'std':  return `\\sigma\\!\\left(${a}\\right)`;
    case 'cumsum': return `\\sum_{k} {${a}}_k`;

    // Trigonometric identities sometimes used
    case 'sinc':    return `\\operatorname{sinc}\\!\\left(${a}\\right)`;
    case 'hypot':   return `\\sqrt{${a}^{2} + ${b}^{2}}`;

    // Power
    case 'power': case 'pow': return `{${a}}^{${b}}`;

    // Modular
    case 'mod':  return `${a} \\bmod ${b}`;
    case 'divmod': return `\\left(\\left\\lfloor\\frac{${a}}{${b}}\\right\\rfloor,\\;${a} \\bmod ${b}\\right)`;

    // ── Special functions (scipy.special / sympy / math) ──────────────────────
    // Gamma & related
    case 'gamma':      return `\\Gamma\\!\\left(${a}\\right)`;
    case 'loggamma': case 'gammaln': return `\\ln\\Gamma\\!\\left(${a}\\right)`;
    case 'rgamma':     return `\\frac{1}{\\Gamma\\!\\left(${a}\\right)}`;
    case 'digamma': case 'psi': return `\\psi\\!\\left(${a}\\right)`;
    case 'polygamma':  return `\\psi^{\\left(${a}\\right)}\\!\\left(${b}\\right)`;
    case 'trigamma':   return `\\psi^{\\left(1\\right)}\\!\\left(${a}\\right)`;
    case 'beta':       return `\\mathrm{B}\\!\\left(${a},\\,${b}\\right)`;
    case 'betaln':     return `\\ln\\mathrm{B}\\!\\left(${a},\\,${b}\\right)`;
    case 'betainc':    return `I_{${c}}\\!\\left(${a},\\,${b}\\right)`;
    case 'zeta':       return b ? `\\zeta\\!\\left(${a},\\,${b}\\right)` : `\\zeta\\!\\left(${a}\\right)`;
    case 'hurwitz_zeta': return `\\zeta\\!\\left(${a},\\,${b}\\right)`;

    // Error functions
    case 'erf':    return `\\mathrm{erf}\\!\\left(${a}\\right)`;
    case 'erfc':   return `\\mathrm{erfc}\\!\\left(${a}\\right)`;
    case 'erfinv': return `\\mathrm{erf}^{-1}\\!\\left(${a}\\right)`;
    case 'erfcinv':return `\\mathrm{erfc}^{-1}\\!\\left(${a}\\right)`;
    case 'erfi':   return `\\mathrm{erfi}\\!\\left(${a}\\right)`;
    case 'dawsn':  return `F\\!\\left(${a}\\right)`;  // Dawson function

    // Bessel functions
    case 'jv':     return `J_{${a}}\\!\\left(${b}\\right)`;
    case 'yv':     return `Y_{${a}}\\!\\left(${b}\\right)`;
    case 'iv':     return `I_{${a}}\\!\\left(${b}\\right)`;
    case 'kv':     return `K_{${a}}\\!\\left(${b}\\right)`;
    case 'j0':     return `J_{0}\\!\\left(${a}\\right)`;
    case 'j1':     return `J_{1}\\!\\left(${a}\\right)`;
    case 'y0':     return `Y_{0}\\!\\left(${a}\\right)`;
    case 'y1':     return `Y_{1}\\!\\left(${a}\\right)`;
    case 'hankel1':return `H^{(1)}_{${a}}\\!\\left(${b}\\right)`;
    case 'hankel2':return `H^{(2)}_{${a}}\\!\\left(${b}\\right)`;
    case 'jn_zeros': case 'jnp_zeros': return `j_{${a},k}`;

    // Airy functions
    case 'airy':   return `\\mathrm{Ai}\\!\\left(${a}\\right)`;
    case 'airye':  return `\\mathrm{Ai}\\!\\left(${a}\\right)`;

    // Legendre / spherical harmonics
    case 'lpmv':   return `P_{${b}}^{${a}}\\!\\left(${c}\\right)`;
    case 'sph_harm': return `Y_{${b}}^{${a}}\\!\\left(${c},\\,${args[3] ?? ''}\\right)`;

    // Elliptic integrals
    case 'ellipk': case 'ellipkm1': return `K\\!\\left(${a}\\right)`;
    case 'ellipe':  return `E\\!\\left(${a}\\right)`;
    case 'ellipj':  return `\\mathrm{sn}\\!\\left(${a}\\mid${b}\\right)`;

    // Hypergeometric
    case 'hyp2f1': return `{}_{2}F_{1}\\!\\left(${a},\\,${b};\\,${c};\\,${args[3] ?? ''}\\right)`;
    case 'hyp1f1': return `{}_{1}F_{1}\\!\\left(${a};\\,${b};\\,${c}\\right)`;
    case 'hyp0f1': return `{}_{0}F_{1}\\!\\left(;\\,${a};\\,${b}\\right)`;

    // ── Numerical integration — intent = ∫ regardless of library ─────────────
    // scipy.integrate.quad(f, a, b) / fixed_quad / romberg / quadrature
    case 'quad': case 'fixed_quad': case 'romberg': case 'quadrature':
    case 'quad_vec': {
      // args: f, a, b  (+ optional kwargs)
      // Fix #8: a lambda integrand (x ↦ x²) unwraps into the integrand, with the
      // lambda parameter becoming the integration variable
      const lam = a.match(/^(.+?) \\mapsto (.+)$/);
      const integrand = lam ? lam[2] : a;
      const dvar      = lam && /^[^\\{}]*$|^\\[a-zA-Z]+$/.test(lam[1]) ? lam[1] : 'x';
      const lo = b, hi = c;
      if (lo && hi) return `\\int_{${lo}}^{${hi}} ${integrand} \\, d${dvar}`;
      if (lo)       return `\\int_{${lo}} ${integrand} \\, d${dvar}`;
      return `\\int ${integrand} \\, d${dvar}`;
    }
    case 'dblquad': {
      // args: f, a, b, gfun, hfun
      const [, alo = '', ahi = ''] = args;
      return `\\iint_{${alo}}^{${ahi}} ${a} \\, dy\\, dx`;
    }
    case 'tplquad': {
      return `\\iiint ${a} \\, dz\\, dy\\, dx`;
    }
    case 'nquad': {
      return `\\idotsint ${a} \\, d\\mathbf{x}`;
    }
    // numpy / scipy numerical quadrature on arrays
    case 'trapz': case 'trapezoid': case 'cumtrapz': case 'cumulative_trapezoid':
    case 'simps': case 'simpson': case 'romb': {
      // args: y [, x]  — render as definite integral if x given
      if (b) return `\\int ${a} \\, d${b}`;
      return `\\int ${a} \\, dk`;
    }

    // ── Numerical differentiation — intent = d/dx regardless of library ───────
    case 'gradient': {
      // numpy.gradient(f) or numpy.gradient(f, x)
      if (b) return `\\frac{d}{d ${b}}\\left(${a}\\right)`;
      return `\\nabla ${a}`;
    }
    case 'derivative': {
      // scipy.misc.derivative(f, x0, dx)
      if (b) return `\\left.\\frac{d}{d x} ${a}\\right|_{x=${b}}`;
      return `\\frac{d}{d x}\\left(${a}\\right)`;
    }
    case 'jacobian': {
      return `J_{${a}}`;
    }
    case 'hessian': {
      return `H_{${a}}`;
    }
    case 'laplacian': {
      return `\\nabla^{2} ${a}`;
    }

    // ── ODE solvers — show as differential equation intent ────────────────────
    case 'odeint': case 'solve_ivp': case 'ode': {
      return `\\frac{d}{d t}\\left(${a}\\right)`;
    }

    // ── Fourier transforms ─────────────────────────────────────────────────────
    case 'fft': case 'rfft': case 'fft2': case 'fftn':
      return `\\mathcal{F}\\!\\left\\{${a}\\right\\}`;
    case 'ifft': case 'irfft': case 'ifft2': case 'ifftn':
      return `\\mathcal{F}^{-1}\\!\\left\\{${a}\\right\\}`;
    case 'fftfreq': case 'rfftfreq':
      return `\\frac{k}{N}`;

    // ── Laplace transform ─────────────────────────────────────────────────────
    case 'laplace_transform':
      return `\\mathcal{L}\\!\\left\\{${a}\\right\\}\\!\\left(${b}\\right)`;
    case 'inverse_laplace_transform':
      return `\\mathcal{L}^{-1}\\!\\left\\{${a}\\right\\}\\!\\left(${b}\\right)`;

    // ── Convolution ───────────────────────────────────────────────────────────
    case 'convolve': case 'fftconvolve': case 'oaconvolve':
      return `\\left(${a} * ${b}\\right)`;
    case 'correlate': case 'fftcorrelate':
      return `\\left(${a} \\star ${b}\\right)`;

    // ── Statistics ────────────────────────────────────────────────────────────
    case 'median':   return `\\operatorname{median}\\!\\left(${a}\\right)`;
    case 'cov': case 'covariance': return `\\operatorname{Cov}\\!\\left(${a},\\,${b || a}\\right)`;
    case 'corrcoef': case 'correlation': return `\\operatorname{Corr}\\!\\left(${a},\\,${b || a}\\right)`;
    case 'percentile': case 'quantile':
      return `Q_{${b}}\\!\\left(${a}\\right)`;
    case 'histogram': return `\\#\\left\\{${a}\\right\\}`;
    case 'pmf':  return `P\\!\\left(X = ${a}\\right)`;
    case 'pdf':  return `f\\!\\left(${a}\\right)`;
    case 'cdf':  return `F\\!\\left(${a}\\right)`;
    case 'ppf':  return `F^{-1}\\!\\left(${a}\\right)`;
    case 'sf':   return `1 - F\\!\\left(${a}\\right)`;
    case 'logpdf': case 'logpmf': return `\\ln f\\!\\left(${a}\\right)`;
    case 'logcdf': return `\\ln F\\!\\left(${a}\\right)`;
    case 'entropy': return `H\\!\\left(${a}\\right)`;
    case 'kl_div': case 'rel_entr':
      return `D_{\\mathrm{KL}}\\!\\left(${a}\\,\\|\\,${b}\\right)`;

    // ── Number theory ─────────────────────────────────────────────────────────
    case 'isprime':   return `${a} \\in \\mathbb{P}`;
    case 'nextprime': return `p_{\\text{next}}\\!\\left(${a}\\right)`;
    case 'primepi':   return `\\pi\\!\\left(${a}\\right)`;
    case 'totient':   return `\\varphi\\!\\left(${a}\\right)`;
    case 'mobius':    return `\\mu\\!\\left(${a}\\right)`;
    case 'divisor_sigma': return b
      ? `\\sigma_{${b}}\\!\\left(${a}\\right)`
      : `\\sigma\\!\\left(${a}\\right)`;

    // ── Norms / distances ─────────────────────────────────────────────────────
    case 'vector_norm': return `\\left\\| ${a} \\right\\|`;
    case 'matrix_norm': return `\\left\\| ${a} \\right\\|`;
    case 'cond':        return `\\kappa\\!\\left(${a}\\right)`;
    case 'matrix_rank': return `\\operatorname{rank}\\!\\left(${a}\\right)`;
    case 'rank':        return `\\operatorname{rank}\\!\\left(${a}\\right)`;
    case 'slogdet':     return `\\ln\\left|\\det\\!\\left(${a}\\right)\\right|`;
    case 'eig': case 'eigh': return `\\lambda\\!\\left(${a}\\right)`;
    case 'eigvals': case 'eigvalsh': return `\\lambda\\!\\left(${a}\\right)`;
    case 'svd':         return `\\sigma\\!\\left(${a}\\right)`;
    case 'svdvals':     return `\\sigma\\!\\left(${a}\\right)`;
    case 'qr':          return `QR\\!\\left(${a}\\right)`;
    case 'cholesky':    return `L\\,L^{\\top} = ${a}`;
    case 'lu':          return `LU\\!\\left(${a}\\right)`;
    case 'lstsq':       return `\\arg\\min_{x}\\,\\left\\|${a}x - ${b}\\right\\|`;

    default: {
      // Fallback: render as operator name with parens
      const latexName = identToLatex(stripModulePrefix(rawName));
      return args.length
        ? `${latexName}\\!\\left(${args.join(',\\,')}\\right)`
        : `${latexName}()`;
    }
  }
}

// ─── Parser ───────────────────────────────────────────────────────────────────

// Methods that, on a non-module object, are instance methods (theta1.diff(t))
const INSTANCE_METHODS = new Set([
  'diff', 'integrate', 'conjugate', 'conj',
  'simplify', 'expand', 'factor', 'subs', 'evalf', 'doit', 'series',
]);

// Fix #4: cover all common module aliases AND submodule names, and check every
// prefix segment — so scipy.integrate.quad, np.linalg.solve, sp.integrate(...)
// are never mistaken for instance-method calls.
const MODULE_ALIASES = new Set([
  'np', 'numpy', 'sp', 'sym', 'sympy', 'math', 'cmath', 'scipy', 'torch', 'tf',
  'integrate', 'special', 'linalg', 'fft', 'random', 'stats', 'signal',
  'optimize', 'sparse', 'misc', 'polynomial',
]);

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token  { return this.tokens[this.pos]; }
  private advance(): Token { return this.tokens[this.pos++]; }

  private match(...types: TT[]): boolean {
    if (types.includes(this.peek().type)) { this.advance(); return true; }
    return false;
  }

  private skipNewlines() {
    while (this.peek().type === TT.Newline) this.advance();
  }

  // ── Top-level: one statement (assignment or expression) ────────────────────

  // Fix #2 + #10: returns a structured { lhs, rhs } so callers can align only on true
  // assignments; augmented (+=), tuple-unpacking, chained, and subscripted assignments
  // degrade gracefully to rendering just the final RHS.
  parseStatement(): { lhs: string | null; rhs: string } {
    this.skipNewlines();
    if (this.peek().type === TT.EOF) return { lhs: null, rhs: '' };

    // Pre-scan for top-level '=' tokens. kwargs inside call parens sit at depth > 0,
    // and anything after a lambda keyword belongs to the lambda (default values).
    const eqPositions: number[] = [];
    let depth = 0;
    for (let k = this.pos; k < this.tokens.length; k++) {
      const t = this.tokens[k].type;
      if (t === TT.Newline || t === TT.EOF || t === TT.Lambda) break;
      if (t === TT.LParen || t === TT.LBracket) depth++;
      else if (t === TT.RParen || t === TT.RBracket) depth--;
      else if (t === TT.Equals && depth === 0) eqPositions.push(k);
    }

    if (eqPositions.length > 0) {
      const simpleAssignment =
        eqPositions.length === 1 &&
        eqPositions[0] === this.pos + 1 &&
        this.tokens[this.pos].type === TT.Identifier;

      if (simpleAssignment) {
        const lhsName = this.advance().value;
        this.advance(); // consume =
        return { lhs: identToLatex(lhsName), rhs: this.parseComparison() };
      }

      // Anything fancier (a += b, a, b = f(x), a = b = expr, x[0] = expr):
      // skip to after the last '=' and show only the RHS
      this.pos = eqPositions[eqPositions.length - 1] + 1;
      return { lhs: null, rhs: this.parseComparison() };
    }

    return { lhs: null, rhs: this.parseComparison() };
  }

  // ── Comparison ────────────────────────────────────────────────────────────

  private parseComparison(): string {
    // Fix #8: lambda has the lowest precedence — intercept it before comparisons
    if (this.peek().type === TT.Lambda) return this.parseLambda();

    let left = this.parseAdditive();

    const REL: Partial<Record<TT, string>> = {
      [TT.EqEq]: '=', [TT.NotEq]: '\\neq',
      [TT.Lt]: '<',   [TT.LtEq]: '\\leq',
      [TT.Gt]: '>',   [TT.GtEq]: '\\geq',
    };

    while (REL[this.peek().type]) {
      const op = this.advance().type;
      const right = this.parseAdditive();
      left = `${left} ${REL[op]!} ${right}`;
    }
    return left;
  }

  // Fix #8: lambda x, y: body → (x, y) ↦ body
  private parseLambda(): string {
    this.advance(); // consume 'lambda'
    const params: string[] = [];
    while (this.peek().type === TT.Identifier) {
      params.push(identToLatex(this.advance().value));
      if (this.peek().type === TT.Equals) {
        this.advance();
        this.parseComparison(); // discard default value — not part of the math
      }
      if (this.peek().type === TT.Comma) this.advance(); else break;
    }
    if (this.peek().type === TT.Colon) this.advance();
    const body = this.parseComparison();
    const head = params.length === 1 ? params[0] : `\\left(${params.join(',\\,')}\\right)`;
    return `${head} \\mapsto ${body}`;
  }

  // ── Additive ──────────────────────────────────────────────────────────────

  private parseAdditive(): string {
    let left = this.parseMultiplicative();

    while (true) {
      if (this.peek().type === TT.Plus) {
        this.advance();
        left = `${left} + ${this.parseMultiplicative()}`;
      } else if (this.peek().type === TT.Minus) {
        this.advance();
        const right = this.parseMultiplicative();
        left = `${left} - ${right}`;
      } else break;
    }
    return left;
  }

  // ── Multiplicative ────────────────────────────────────────────────────────
  //
  // Collects numerator / denominator factors so that a/b renders as \frac.
  // Left-to-right semantics are preserved:
  //   a * b / c * d  →  num=[a,b,d]  den=[c]  →  \frac{a \cdot b \cdot d}{c}

  private parseMultiplicative(): string {
    const num: string[] = [];
    const den: string[] = [];

    num.push(this.parseUnary());

    while (true) {
      if (this.peek().type === TT.Star) {
        this.advance();
        num.push(this.parseUnary());
      } else if (this.peek().type === TT.At) {
        this.advance();
        const right = this.parseUnary();
        // Matrix multiply — represent with no operator (or thin space)
        num.push(right);
      } else if (this.peek().type === TT.Slash) {
        this.advance();
        den.push(this.parseUnary());
      } else if (this.peek().type === TT.DoubleSlash) {
        this.advance();
        const right = this.parseUnary();
        // Floor division: wrap whatever we have so far
        const numLatex = joinFactors(num);
        num.length = 0;
        den.length = 0;
        num.push(`\\left\\lfloor \\frac{${numLatex}}{${right}} \\right\\rfloor`);
      } else if (this.peek().type === TT.Percent) {
        this.advance();
        const right = this.parseUnary();
        const numLatex = joinFactors(num);
        num.length = 0;
        den.length = 0;
        num.push(`${numLatex} \\bmod ${right}`);
      } else break;
    }

    if (den.length === 0) return joinFactors(num);
    // Fix #1: \frac already groups its parts — outer parens inside it are redundant
    return `\\frac{${unwrapGroup(joinFactors(num))}}{${unwrapGroup(joinFactors(den))}}`;
  }

  // ── Unary ─────────────────────────────────────────────────────────────────

  private parseUnary(): string {
    if (this.peek().type === TT.Minus) {
      this.advance();
      const op = this.parsePower();
      // Parenthesise compound operands to avoid double-minus ambiguity
      return needsParenInUnary(op) ? `-\\left(${op}\\right)` : `-${op}`;
    }
    if (this.peek().type === TT.Plus) { this.advance(); }
    return this.parsePower();
  }

  // ── Power (right-associative) ─────────────────────────────────────────────

  private parsePower(): string {
    const base = this.parsePostfix();
    if (this.peek().type === TT.DoubleStar) {
      this.advance();
      const exp = this.parseUnary(); // right-associative
      const baseWrapped = needsParenAsBase(base) ? `\\left(${base}\\right)` : base;
      // Fix #1: the ^{…} braces already group the exponent — x**(n-1) → x^{n - 1}
      return `{${baseWrapped}}^{${unwrapGroup(exp)}}`;
    }
    return base;
  }

  // ── Postfix: function calls, attribute access, subscripts ─────────────────

  private parsePostfix(): string {
    // Special handling: identifier may be start of a dotted name chain or function call
    if (this.peek().type === TT.Identifier) {
      const nameParts: string[] = [this.advance().value];

      // Collect dotted name: np.linalg.norm
      while (this.peek().type === TT.Dot) {
        const savedPos = this.pos;
        this.advance(); // consume dot
        if (this.peek().type === TT.Identifier) {
          nameParts.push(this.advance().value);
        } else {
          this.pos = savedPos; break;
        }
      }

      const fullName = nameParts.join('.');

      if (this.peek().type === TT.LParen) {
        // Detect obj.method(args) where the last part is a known instance method,
        // e.g. theta1.diff(t) — split so the object becomes the first argument.
        const lastPart = nameParts[nameParts.length - 1];
        // Fix #4: check EVERY prefix segment against MODULE_ALIASES, so
        // scipy.integrate.quad / np.linalg.solve / sp.integrate are module calls
        const baseIsModule = nameParts.slice(0, -1).some(p => MODULE_ALIASES.has(p));
        if (nameParts.length > 1 && INSTANCE_METHODS.has(lastPart) && !baseIsModule) {
          const objLatex = dottedNameToLatex(nameParts.slice(0, -1));
          this.advance(); // LParen
          const args = this.parseArgList(TT.RParen);
          this.advance(); // RParen
          let result: string;
          if (lastPart === 'diff') {
            result = applyDiff(objLatex, args);
          } else if (lastPart === 'integrate') {
            // expr.integrate((x, a, b)) renders as a real integral, not a bare name
            result = funcToLatex('integrate', [objLatex, ...args]);
          } else if (lastPart === 'conjugate' || lastPart === 'conj') {
            result = `\\overline{${objLatex}}`;
          } else {
            result = objLatex; // simplify/expand/etc are no-ops for display
          }
          return this.continuePostfix(result);
        }

        // Regular function / module call: np.sqrt(x), sin(x), etc.
        this.advance();
        const args = this.parseArgList(TT.RParen);
        this.advance(); // RParen
        let result = funcToLatex(fullName, args);
        return this.continuePostfix(result);
      }

      // Attribute / constant / plain identifier
      const dotted = DOTTED_CONSTANTS[fullName];
      if (dotted) return this.continuePostfix(dotted);

      // Fix #17: generic attribute access on a variable — A.T / A.H stay special,
      // anything else (A.shape, A.dtype) becomes a text subscript: A_{\text{shape}}
      if (nameParts.length > 1 && !MODULE_ALIASES.has(nameParts[0])) {
        return this.continuePostfix(dottedNameToLatex(nameParts));
      }

      return this.continuePostfix(identToLatex(fullName));
    }

    return this.continuePostfix(this.parsePrimary());
  }

  // Handles trailing [], .attr, and .method() after an expression
  private continuePostfix(base: string): string {
    while (true) {
      if (this.peek().type === TT.LBracket) {
        this.advance();
        const idx = this.parseArgList(TT.RBracket);
        this.advance(); // RBracket
        base = `{${base}}_{${idx.join(',\\,')}}`;

      } else if (this.peek().type === TT.Dot) {
        const savedPos = this.pos;
        this.advance();

        if (this.peek().type !== TT.Identifier) { this.pos = savedPos; break; }
        const attr = this.advance().value;

        if (this.peek().type === TT.LParen) {
          // Method call: base.method(args)
          this.advance();
          const args = this.parseArgList(TT.RParen);
          this.advance(); // RParen

          if (attr === 'diff') {
            base = applyDiff(base, args);
          } else if (attr === 'subs') {
            // expr.subs(old, new) — just show expr for display purposes
            // (substitution is a runtime operation we can't evaluate)
          } else if (attr === 'simplify' || attr === 'expand' || attr === 'factor') {
            // no-op for display
          } else if (attr === 'conjugate' || attr === 'conj') {
            base = `\\overline{${base}}`;
          } else if (attr === 'T') {
            base = `{${base}}^{\\top}`;
          } else {
            base = funcToLatex(attr, [base, ...args]);
          }
          continue;
        }

        // Plain attribute (no call) — Fix #17: unknown attributes fall through to a
        // text subscript (A.shape → A_{\text{shape}}) instead of backtracking, so
        // chains like A.shape[0] keep parsing correctly
        base = plainAttrToLatex(base, attr);
        continue;

      } else break;
    }
    return base;
  }

  // ── Primary ───────────────────────────────────────────────────────────────

  private parsePrimary(): string {
    const t = this.peek();

    if (t.type === TT.Number) {
      this.advance();
      return formatNumber(t.value);
    }

    if (t.type === TT.String) {
      this.advance();
      return `\\text{${escLatexText(t.value)}}`;
    }

    if (t.type === TT.LParen) {
      this.advance();
      if (this.peek().type === TT.RParen) { this.advance(); return '\\left(\\right)'; }
      const first = this.parseComparison();
      // Detect Python tuple: (a, b, c)
      if (this.peek().type === TT.Comma) {
        const elems = [first];
        while (this.peek().type === TT.Comma) {
          this.advance();
          if (this.peek().type === TT.RParen) break; // trailing comma
          elems.push(this.parseComparison());
        }
        if (this.peek().type === TT.RParen) this.advance();
        return `\\left(${elems.join(',\\,')}\\right)`;
      }
      if (this.peek().type === TT.RParen) this.advance();
      return `\\left(${first}\\right)`;
    }

    if (t.type === TT.LBracket) {
      this.advance();
      const elems = this.parseArgList(TT.RBracket);
      if (this.peek().type === TT.RBracket) this.advance();
      return `\\left[${elems.join(',\\,')}\\right]`;
    }

    // Fallback: consume and return raw
    this.advance();
    return t.value;
  }

  // ── Argument list ─────────────────────────────────────────────────────────

  private parseArgList(closing: TT): string[] {
    const args: string[] = [];
    while (this.peek().type !== closing && this.peek().type !== TT.EOF) {
      // Fix #7: treat IDENT = value as a kwarg only inside call parens (never in
      // subscripts), and only when the value parses cleanly up to ',' or the closing
      // paren — otherwise backtrack and re-parse the whole thing as a positional arg.
      if (closing === TT.RParen && this.peek().type === TT.Identifier) {
        const saved = this.pos;
        this.advance();
        if (this.peek().type === TT.Equals &&
            this.tokens[this.pos + 1]?.type !== TT.Equals) {
          this.advance(); // consume '='
          const value = this.parseComparison();
          if (this.peek().type === TT.Comma || this.peek().type === closing) {
            args.push(value);
            if (this.peek().type === TT.Comma) this.advance();
            continue;
          }
        }
        this.pos = saved; // not a clean kwarg — positional after all
      }
      args.push(this.parseComparison());
      if (this.peek().type === TT.Comma) this.advance(); else break;
    }
    return args;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Tuple / matrix helpers ───────────────────────────────────────────────────

// Split s at delim, respecting depth of (), [], {}
function splitAtDelim(s: string, delim: string): string[] {
  const parts: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    if ('({['.includes(s[i])) depth++;
    else if (')}]'.includes(s[i])) { if (depth > 0) depth--; }
    else if (depth === 0 && s.startsWith(delim, i)) {
      parts.push(s.slice(start, i).trim());
      start = i + delim.length;
      i += delim.length - 1;
    }
  }
  parts.push(s.slice(start).trim());
  return parts;
}

// Fix #5: if s is wrapped in a single matching pair of \left(…\right) or plain (…),
// return the inner content, verifying the outer parens actually match each other
// (rejects things like "(a) + (b)"). Returns null otherwise.
function stripOuterParens(s: string): string | null {
  const t = s.trim();
  let body: string | null = null;
  if (t.startsWith('\\left(') && t.endsWith('\\right)')) body = t.slice(6, -7);
  else if (t.startsWith('(') && t.endsWith(')')) body = t.slice(1, -1);
  if (body === null) return null;
  let depth = 0;
  for (const ch of body) {
    if ('({['.includes(ch)) depth++;
    else if (')}]'.includes(ch)) { if (--depth < 0) return null; }
  }
  return depth === 0 ? body : null;
}

// Fix #5: robust tuple extraction — accepts \left(…\right) or plain (…), and both
// the ',\,' and plain ',' separators, so integrate/Sum limits are never silently lost
function extractTuple(s: string): string[] | null {
  const inner = stripOuterParens(s);
  if (inner === null) return null;
  let parts = splitAtDelim(inner, ',\\,');
  if (parts.length < 2) parts = splitAtDelim(inner, ',');
  return parts.length >= 2 ? parts.map(p => p.trim()) : null;
}

// Fix #6: build an explicit r×c matrix filled with `fill` when the dims are small
// positive integers; null lets the caller fall back to a symbolic form
function buildConstMatrix(parts: string[], fill: string): string | null {
  const dims = parts.map(p => Number(p));
  if (dims.length === 0 || dims.length > 2 ||
      !dims.every(d => Number.isInteger(d) && d > 0)) return null;
  const [r, c] = dims.length === 2 ? [dims[0], dims[1]] : [1, dims[0]];
  if (r > 8 || c > 8) return null;
  const row = Array(c).fill(fill).join(' & ');
  return `\\begin{bmatrix} ${Array(r).fill(row).join(' \\\\ ')} \\end{bmatrix}`;
}

// Fix #1: drop a \left(…\right) pair that wraps an entire already-grouped slot
// (numerator, denominator, exponent) — but never unwrap tuples
function unwrapGroup(s: string): string {
  const body = stripOuterParens(s);
  return body !== null && splitAtDelim(body, ',').length === 1 ? body : s;
}

// Fix #17: shared renderer for plain (non-call) attribute access
function plainAttrToLatex(base: string, attr: string): string {
  if (attr === 'T')    return `{${base}}^{\\top}`;
  if (attr === 'H')    return `{${base}}^{\\dagger}`;
  if (attr === 'real') return `\\operatorname{Re}\\!\\left(${base}\\right)`;
  if (attr === 'imag') return `\\operatorname{Im}\\!\\left(${base}\\right)`;
  return `{${base}}_{\\text{${attr}}}`;
}

// Fix #17: dotted variable names (a.b.c) fold into attribute subscripts
function dottedNameToLatex(parts: string[]): string {
  let base = identToLatex(parts[0]);
  for (const attr of parts.slice(1)) base = plainAttrToLatex(base, attr);
  return base;
}

// If s is \left[[r1],[r2],...\right], return rows as string[][]
function parseLatexMatrix(s: string): string[][] | null {
  const P = '\\left[', S = '\\right]';
  if (!s.startsWith(P) || !s.endsWith(S)) return null;
  const inner = s.slice(P.length, s.length - S.length);
  const rowStrs = splitAtDelim(inner, ',\\,');
  const rows: string[][] = [];
  for (const rs of rowStrs) {
    const t = rs.trim();
    if (!t.startsWith(P) || !t.endsWith(S)) return null;
    const rowInner = t.slice(P.length, t.length - S.length);
    rows.push(splitAtDelim(rowInner, ',\\,').map(c => c.trim()));
  }
  return rows.length > 0 ? rows : null;
}

// expr.diff(t) → \dot{expr}   expr.diff(t, 2) → \ddot{expr}   higher → \frac{d^n}{dt^n} expr
function applyDiff(expr: string, args: string[]): string {
  const wrt   = args[0] ?? 't';
  const order = args[1] ?? '1';

  if (order === '1') return `\\dot{${expr}}`;
  if (order === '2') return `\\ddot{${expr}}`;
  return `\\frac{d^{${order}}}{d {${wrt}}^{${order}}} ${groupForPostfix(expr)}`;
}

// Fix #1: detect a binary +/- at nesting depth 0 — now also counts [ ] so a minus
// inside a list literal like \left[1,\,-2\right] no longer forces parentheses
function hasTopLevelPlusMinus(s: string): boolean {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if ('({['.includes(ch)) { depth++; continue; }
    if (')}]'.includes(ch)) { depth--; continue; }
    if (depth === 0 && (ch === '+' || ch === '-') && i > 0) return true;
  }
  return false;
}

// Fix #1: only parenthesize when mathematically required — never re-wrap an
// expression that is already a single \left(…\right) group
function needsParenAsBase(s: string): boolean {
  if (stripOuterParens(s) !== null) return false;
  if (s.startsWith('\\frac')) return true; // (a/b)^n must stay unambiguous
  return hasTopLevelPlusMinus(s);
}

function groupForPostfix(s: string): string {
  // Fix #1: fractions are visually self-grouping after d/dx — only sums need parens
  return stripOuterParens(s) === null && hasTopLevelPlusMinus(s)
    ? `\\left(${s}\\right)` : s;
}

// Fix #15: consistent \cdot rules — juxtapose number·symbol and symbol·symbol
// (including Greek commands and subscripted symbols, so 2*x*y → 2xy uniformly);
// everything else keeps an explicit \cdot. Joined with a space so LaTeX commands
// never merge with the following token.
function joinFactors(factors: string[]): string {
  if (factors.length === 0) return '1';
  if (factors.length === 1) return factors[0];

  // symbol, optionally subscripted and/or raised to a simple power: x, \alpha, x_{1}, {c}^{2}
  const isSymbolAtom = (s: string) =>
    /^(?:\{(?:\\[a-zA-Z]+|[a-zA-Z])(?:_\{[^{}]*\})?\}|\\[a-zA-Z]+|[a-zA-Z])(?:_\{[^{}]*\})?(?:\^\{[^{}]*\})?$/.test(s);
  const isNumber     = (s: string) => /^-?\d+(?:\.\d+)?$/.test(s);

  const parts: string[] = [factors[0]];
  for (let k = 1; k < factors.length; k++) {
    const left  = factors[k - 1];
    const right = factors[k];
    const omitCdot = isSymbolAtom(right) && (isSymbolAtom(left) || isNumber(left));
    parts.push(omitCdot ? ` ${right}` : ` \\cdot ${right}`);
  }
  return parts.join('');
}

function needsParenInUnary(s: string): boolean {
  // Fix #1: -a/b is fine as -\frac{a}{b} — only additive operands need parens here
  return stripOuterParens(s) === null && hasTopLevelPlusMinus(s);
}

function formatNumber(s: string): string {
  // Complex: 3j → 3i
  if (/[jJ]$/.test(s)) return s.slice(0, -1) + 'i';

  // Scientific notation: 1.5e-10 → 1.5 \times 10^{-10}
  const sci = s.match(/^([+-]?[\d.]+)[eE]([+-]?\d+)$/);
  if (sci) {
    const [, mRaw, exp] = sci;
    const sign = mRaw.startsWith('-') ? '-' : '';
    const m = mRaw.replace(/^[+-]/, '');
    // Fix #14: compare the mantissa numerically so 1.0e5 renders 10^{5} like 1e5
    if (parseFloat(m) === 1) return `${sign}10^{${exp}}`;
    return `${sign}${m} \\times 10^{${exp}}`;
  }
  return s;
}

function escLatexText(s: string): string {
  return s.replace(/[\\&%$#_{}~^]/g, m => `\\${m}`);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ConversionResult {
  latex: string;
  error?: string;
}

// Convert a single logical line to structured { lhs, rhs }; falls back to escaped
// text on parse failure. Used by the extension to render raw fallbacks for lines
// SymPy could not evaluate in a multi-line "Evaluated" view.
export function pythonLineToLatex(line: string): { lhs: string | null; rhs: string } {
  try {
    const parser = new Parser(tokenize(line));
    return parser.parseStatement();
  } catch {
    return { lhs: null, rhs: `\\text{${escLatexText(line)}}` };
  }
}

export function pythonToLatex(code: string): ConversionResult {
  try {
    const rawLines = code.split('\n');
    const lines = rawLines
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('#'));

    if (lines.length === 0) return { latex: '' };

    if (lines.length === 1) {
      const parser = new Parser(tokenize(lines[0]));
      const { lhs, rhs } = parser.parseStatement();
      return { latex: lhs !== null ? `${lhs} = ${rhs}` : rhs };
    }

    // Multi-line: emit an aligned block
    // Fix #2: alignment uses the parser's structured { lhs, rhs } so '&=' is inserted
    // only at real assignments — never at rendered comparisons (==, !=) or any other
    // '=' that happens to appear inside the LaTeX (the old string replace was naive)
    const aligned = lines.map(line => {
      const { lhs, rhs } = pythonLineToLatex(line);
      return lhs !== null ? `${lhs} &= ${rhs}` : rhs;
    });
    return { latex: `\\begin{aligned}\n${aligned.join(' \\\\\n')}\n\\end{aligned}` };

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { latex: '', error: msg };
  }
}
