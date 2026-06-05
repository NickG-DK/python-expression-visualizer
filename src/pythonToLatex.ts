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
      out.push({ type: TT.Identifier, value: src.slice(i, j) });
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
  'sp.pi': '\\pi', 'sympy.pi': '\\pi', 'sympy.E': 'e', 'sympy.I': 'i',
};

function stripModulePrefix(name: string): string {
  for (const p of [
    'np.linalg.', 'np.fft.', 'np.random.', 'np.',
    'numpy.linalg.', 'numpy.',
    'math.', 'cmath.',
    'scipy.linalg.', 'scipy.special.', 'scipy.stats.', 'scipy.',
    'sympy.', 'sym.', 'sp.',
    'torch.linalg.', 'torch.', 'tf.math.', 'tf.',
  ]) {
    if (name.startsWith(p)) return name.slice(p.length);
  }
  return name;
}

function identToLatex(name: string): string {
  if (CONSTANTS[name]) return CONSTANTS[name];
  if (GREEK[name])    return GREEK[name];

  // Handle trailing j/J for complex literals that slipped through as identifiers
  if (name === 'j' || name === 'J') return 'i';

  // Subscripts: split on first underscore
  const u = name.indexOf('_');
  if (u > 0) {
    const base = name.slice(0, u);
    const sub  = name.slice(u + 1);
    const baseLatex = identToLatex(base);
    const subLatex  = identToLatex(sub);
    // Wrap multi-char alphabetic subscripts in \mathrm
    const subFinal = ([...sub].length > 1 && /^[a-zA-Z]+$/.test(sub))
      ? `\\mathrm{${subLatex}}`
      : subLatex;
    return `${baseLatex}_{${subFinal}}`;
  }

  // Single letter — natural italic in math mode
  if ([...name].length === 1) return name;

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
    case 'atan2':  return `\\operatorname{atan2}\\!\\left(${a},\\,${b}\\right)`;

    // Hyperbolic
    case 'sinh':   return `\\sinh\\!\\left(${a}\\right)`;
    case 'cosh':   return `\\cosh\\!\\left(${a}\\right)`;
    case 'tanh':   return `\\tanh\\!\\left(${a}\\right)`;

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
    case 'solve':     return `${a}^{-1}\\,${b}`;
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

    // Calculus (SymPy)
    case 'diff': case 'Derivative':
      if (c) return `\\frac{d^{${c}} ${a}}{d\\,{${b}}^{${c}}}`;
      return `\\frac{d}{d\\,${b || 'x'}}\\left(${a}\\right)`;
    case 'integrate': case 'Integral':
      return `\\int ${a} \\, d${b || 'x'}`;
    case 'limit': case 'Limit':
      return `\\lim_{${b || 'x'} \\to ${c || '\\infty'}} ${a}`;
    case 'Sum': case 'summation':
      return `\\sum ${a}`;
    case 'Product':
      return `\\prod ${a}`;

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

  parseStatement(): string {
    this.skipNewlines();
    if (this.peek().type === TT.EOF) return '';

    // Detect assignment: IDENTIFIER [op]= expr
    // We do a lightweight lookahead: first token IDENTIFIER, second =
    if (this.peek().type === TT.Identifier) {
      const saved = this.pos;
      const lhsName = this.advance().value;

      if (this.peek().type === TT.Equals) {
        this.advance(); // consume =
        const rhs = this.parseComparison();
        return `${identToLatex(lhsName)} = ${rhs}`;
      }
      // Not an assignment — backtrack
      this.pos = saved;
    }

    return this.parseComparison();
  }

  // ── Comparison ────────────────────────────────────────────────────────────

  private parseComparison(): string {
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
    return `\\frac{${joinFactors(num)}}{${joinFactors(den)}}`;
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
      // Wrap base in braces if it contains LaTeX commands (heuristic)
      const baseWrapped = /[\\^_{}]/.test(base) ? `\\left(${base}\\right)` : base;
      return `{${baseWrapped}}^{${exp}}`;
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
        // Function call
        this.advance();
        const args = this.parseArgList(TT.RParen);
        this.advance(); // RParen
        let result = funcToLatex(fullName, args);
        return this.continuePostfix(result);
      }

      // Attribute / constant / plain identifier
      const dotted = DOTTED_CONSTANTS[fullName];
      if (dotted) return this.continuePostfix(dotted);

      // Attribute .T (transpose) without call
      const lastPart = nameParts[nameParts.length - 1];
      if (nameParts.length > 1 && (lastPart === 'T' || lastPart === 'H')) {
        const obj = identToLatex(nameParts.slice(0, -1).join('.'));
        const sup = lastPart === 'T' ? '\\top' : '\\dagger';
        return this.continuePostfix(`{${obj}}^{${sup}}`);
      }

      return this.continuePostfix(identToLatex(fullName));
    }

    return this.continuePostfix(this.parsePrimary());
  }

  // Handles trailing [] subscripts after an expression
  private continuePostfix(base: string): string {
    while (true) {
      if (this.peek().type === TT.LBracket) {
        this.advance();
        const idx = this.parseArgList(TT.RBracket);
        this.advance(); // RBracket
        base = `{${base}}_{${idx.join(',\\,')}}`;
      } else if (this.peek().type === TT.Dot) {
        // Trailing .attr after a non-identifier base (e.g. expr.T)
        const savedPos = this.pos;
        this.advance();
        if (this.peek().type === TT.Identifier) {
          const attr = this.advance().value;
          if (attr === 'T') { base = `{${base}}^{\\top}`; continue; }
          if (attr === 'H') { base = `{${base}}^{\\dagger}`; continue; }
          if (attr === 'real') { base = `\\operatorname{Re}\\!\\left(${base}\\right)`; continue; }
          if (attr === 'imag') { base = `\\operatorname{Im}\\!\\left(${base}\\right)`; continue; }
          // Unknown attr — backtrack
        }
        this.pos = savedPos; break;
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
      const inner = this.parseComparison();
      if (this.peek().type === TT.RParen) this.advance();
      return `\\left(${inner}\\right)`;
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
      // Skip keyword arguments (keyword=value) — parse the value
      const saved = this.pos;
      if (this.peek().type === TT.Identifier) {
        this.advance();
        if (this.peek().type === TT.Equals) { this.advance(); } // skip kwarg name=
        else this.pos = saved;
      }
      args.push(this.parseComparison());
      if (this.peek().type === TT.Comma) this.advance(); else break;
    }
    return args;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function joinFactors(factors: string[]): string {
  if (factors.length === 0) return '1';
  if (factors.length === 1) return factors[0];

  const parts: string[] = [factors[0]];
  for (let k = 1; k < factors.length; k++) {
    const left  = factors[k - 1];
    const right = factors[k];
    // Omit \cdot when: (number)(letter), (letter)(paren), (paren)(letter)
    const isSimpleLeft  = /^[\d.]/.test(left)  || /^[a-zA-Z]$/.test(left);
    const isSimpleRight = /^[a-zA-Z(\\]/.test(right);
    if (isSimpleLeft && isSimpleRight) {
      parts.push(right);
    } else {
      parts.push(` \\cdot ${right}`);
    }
  }
  return parts.join('');
}

function needsParenInUnary(s: string): boolean {
  return s.includes(' + ') || s.includes(' - ');
}

function formatNumber(s: string): string {
  // Complex: 3j → 3i
  if (/[jJ]$/.test(s)) return s.slice(0, -1) + 'i';

  // Scientific notation: 1.5e-10 → 1.5 \times 10^{-10}
  const sci = s.match(/^([+-]?[\d.]+)[eE]([+-]?\d+)$/);
  if (sci) {
    const [, m, exp] = sci;
    return m === '1' ? `10^{${exp}}` : `${m} \\times 10^{${exp}}`;
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

export function pythonToLatex(code: string): ConversionResult {
  try {
    const rawLines = code.split('\n');
    const lines = rawLines
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('#'));

    if (lines.length === 0) return { latex: '' };

    if (lines.length === 1) {
      const tokens = tokenize(lines[0]);
      const parser = new Parser(tokens);
      return { latex: parser.parseStatement() };
    }

    // Multi-line: emit an aligned block
    const converted = lines.map(line => {
      try {
        const tokens = tokenize(line);
        const parser = new Parser(tokens);
        return parser.parseStatement();
      } catch {
        return `\\text{${escLatexText(line)}}`;
      }
    });

    // Align on = signs
    const aligned = converted.map(l => l.replace(' = ', ' &= '));
    return { latex: `\\begin{aligned}\n${aligned.join(' \\\\\n')}\n\\end{aligned}` };

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { latex: '', error: msg };
  }
}
