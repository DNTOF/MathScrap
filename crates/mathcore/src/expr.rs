//! Tokenizer, parser, evaluator and LaTeX printer for the notebook's ASCII-math dialect.
//!
//! Dialect highlights:
//! - implicit multiplication: `2x`, `kx + b`, `2(x+1)`, `sin(x)cos(y)`
//! - letter runs are split into known words first (`sin`, `pi`, `theta`, ...) then single letters
//! - `^` or `**` for powers, `|x|` for abs, `√x`, `x²`, `30°`, unicode `π θ α · × ÷ −`
//! - `a_1` style subscripts become a single variable

use std::collections::HashMap;
use std::f64::consts::PI;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Op {
    Add,
    Sub,
    Mul,
    Div,
    Pow,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Expr {
    Num(f64),
    Const(&'static str),
    Var(String),
    Neg(Box<Expr>),
    Bin(Op, Box<Expr>, Box<Expr>),
    /// Implicit multiplication — evaluated like `Mul` but printed by juxtaposition.
    Juxt(Box<Expr>, Box<Expr>),
    Call(&'static str, Vec<Expr>),
    Deg(Box<Expr>),
    Fact(Box<Expr>),
}

const FUNCS: &[(&str, &str, usize)] = &[
    // (typed name, canonical name, arity)
    ("arcsin", "asin", 1),
    ("arccos", "acos", 1),
    ("arctan", "atan", 1),
    ("asin", "asin", 1),
    ("acos", "acos", 1),
    ("atan", "atan", 1),
    ("sinh", "sinh", 1),
    ("cosh", "cosh", 1),
    ("tanh", "tanh", 1),
    ("sqrt", "sqrt", 1),
    ("cbrt", "cbrt", 1),
    ("floor", "floor", 1),
    ("ceil", "ceil", 1),
    ("sign", "sign", 1),
    ("sin", "sin", 1),
    ("cos", "cos", 1),
    ("tan", "tan", 1),
    ("cot", "cot", 1),
    ("sec", "sec", 1),
    ("csc", "csc", 1),
    ("exp", "exp", 1),
    ("abs", "abs", 1),
    ("log", "log", 1),
    ("lg", "log", 1),
    ("ln", "ln", 1),
    ("min", "min", 2),
    ("max", "max", 2),
];

const GREEK: &[(&str, &str)] = &[
    ("alpha", "α"),
    ("beta", "β"),
    ("gamma", "γ"),
    ("delta", "δ"),
    ("epsilon", "ε"),
    ("theta", "θ"),
    ("lambda", "λ"),
    ("mu", "μ"),
    ("rho", "ρ"),
    ("sigma", "σ"),
    ("tau", "τ"),
    ("phi", "φ"),
    ("omega", "ω"),
];

fn greek_latex(name: &str) -> Option<&'static str> {
    Some(match name {
        "alpha" => "\\alpha",
        "beta" => "\\beta",
        "gamma" => "\\gamma",
        "delta" => "\\delta",
        "epsilon" => "\\varepsilon",
        "theta" => "\\theta",
        "lambda" => "\\lambda",
        "mu" => "\\mu",
        "rho" => "\\rho",
        "sigma" => "\\sigma",
        "tau" => "\\tau",
        "phi" => "\\varphi",
        "omega" => "\\omega",
        _ => return None,
    })
}

#[derive(Clone, Debug, PartialEq)]
enum Tok {
    Num(f64),
    Ident(String),
    Func(&'static str, usize),
    Const(&'static str),
    Op(char),
    LParen,
    RParen,
    Comma,
    Bar,
    Sqrt,
    Deg,
    Bang,
}

fn is_letter(c: char) -> bool {
    c.is_ascii_alphabetic()
}

fn tokenize(src: &str) -> Result<Vec<Tok>, String> {
    let chars: Vec<char> = src.chars().collect();
    let mut i = 0;
    let mut out = Vec::new();
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        if c.is_ascii_digit() || (c == '.' && i + 1 < chars.len() && chars[i + 1].is_ascii_digit()) {
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1;
            }
            let s: String = chars[start..i].iter().collect();
            let v: f64 = s.parse().map_err(|_| format!("无法识别的数字 “{s}”"))?;
            out.push(Tok::Num(v));
            continue;
        }
        if is_letter(c) {
            let start = i;
            while i < chars.len() && is_letter(chars[i]) {
                i += 1;
            }
            let run: String = chars[start..i].iter().collect();
            split_letters(&run, &mut out);
            // `a_1` / `x_{12}` subscripts glue onto the last single-letter identifier
            if i < chars.len() && chars[i] == '_' {
                if let Some(Tok::Ident(last)) = out.last_mut() {
                    let mut j = i + 1;
                    let braced = j < chars.len() && chars[j] == '{';
                    if braced {
                        j += 1;
                    }
                    let s = j;
                    while j < chars.len() && chars[j].is_ascii_alphanumeric() {
                        j += 1;
                    }
                    if j > s {
                        let sub: String = chars[s..j].iter().collect();
                        last.push('_');
                        last.push_str(&sub);
                        if braced && j < chars.len() && chars[j] == '}' {
                            j += 1;
                        }
                        i = j;
                    }
                }
            }
            continue;
        }
        match c {
            '+' => out.push(Tok::Op('+')),
            '-' | '−' | '–' => out.push(Tok::Op('-')),
            '*' | '·' | '×' | '⋅' => {
                if c == '*' && i + 1 < chars.len() && chars[i + 1] == '*' {
                    out.push(Tok::Op('^'));
                    i += 1;
                } else {
                    out.push(Tok::Op('*'));
                }
            }
            '/' | '÷' => out.push(Tok::Op('/')),
            '^' => out.push(Tok::Op('^')),
            '²' => {
                out.push(Tok::Op('^'));
                out.push(Tok::Num(2.0));
            }
            '³' => {
                out.push(Tok::Op('^'));
                out.push(Tok::Num(3.0));
            }
            '(' | '[' | '{' => out.push(Tok::LParen),
            ')' | ']' | '}' => out.push(Tok::RParen),
            ',' | '，' => out.push(Tok::Comma),
            '|' => out.push(Tok::Bar),
            '√' => out.push(Tok::Sqrt),
            '°' => out.push(Tok::Deg),
            '!' => out.push(Tok::Bang),
            'π' => out.push(Tok::Const("pi")),
            _ => {
                if let Some((name, _)) = GREEK.iter().find(|(_, g)| g.chars().next() == Some(c)) {
                    out.push(Tok::Ident((*name).to_string()));
                } else {
                    return Err(format!("无法识别的符号 “{c}”"));
                }
            }
        }
        i += 1;
    }
    Ok(out)
}

/// Greedy split of a letter run: known words (functions, constants, greek) first, else single letters.
fn split_letters(run: &str, out: &mut Vec<Tok>) {
    let mut rest = run;
    while !rest.is_empty() {
        let mut matched = false;
        // longest-first match across all known words
        let mut best: Option<(usize, Tok)> = None;
        for (name, canon, arity) in FUNCS {
            if rest.starts_with(name) && best.as_ref().map_or(true, |(l, _)| name.len() > *l) {
                best = Some((name.len(), Tok::Func(canon, *arity)));
            }
        }
        for (name, _) in GREEK {
            if rest.starts_with(name) && best.as_ref().map_or(true, |(l, _)| name.len() > *l) {
                best = Some((name.len(), Tok::Ident((*name).to_string())));
            }
        }
        if rest.starts_with("pi") && best.as_ref().map_or(true, |(l, _)| 2 > *l) {
            best = Some((2, Tok::Const("pi")));
        }
        if let Some((len, tok)) = best {
            out.push(tok);
            rest = &rest[len..];
            matched = true;
        }
        if !matched {
            let ch = &rest[..1];
            if ch == "e" {
                out.push(Tok::Const("e"));
            } else {
                out.push(Tok::Ident(ch.to_string()));
            }
            rest = &rest[1..];
        }
    }
}

struct Parser {
    toks: Vec<Tok>,
    pos: usize,
    abs_depth: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Tok> {
        self.toks.get(self.pos)
    }
    fn next(&mut self) -> Option<Tok> {
        let t = self.toks.get(self.pos).cloned();
        self.pos += 1;
        t
    }
    fn expect_rparen(&mut self) -> Result<(), String> {
        match self.next() {
            Some(Tok::RParen) => Ok(()),
            _ => Err("缺少右括号 )".into()),
        }
    }

    fn expr(&mut self) -> Result<Expr, String> {
        let mut lhs = self.term()?;
        loop {
            match self.peek() {
                Some(Tok::Op('+')) => {
                    self.pos += 1;
                    let r = self.term()?;
                    lhs = Expr::Bin(Op::Add, Box::new(lhs), Box::new(r));
                }
                Some(Tok::Op('-')) => {
                    self.pos += 1;
                    let r = self.term()?;
                    lhs = Expr::Bin(Op::Sub, Box::new(lhs), Box::new(r));
                }
                _ => return Ok(lhs),
            }
        }
    }

    fn starts_primary(&self) -> bool {
        match self.peek() {
            Some(Tok::Num(_)) | Some(Tok::Ident(_)) | Some(Tok::Func(..)) | Some(Tok::Const(_)) => true,
            Some(Tok::LParen) | Some(Tok::Sqrt) => true,
            Some(Tok::Bar) => self.abs_depth == 0,
            _ => false,
        }
    }

    fn term(&mut self) -> Result<Expr, String> {
        let mut lhs = self.unary()?;
        loop {
            match self.peek() {
                Some(Tok::Op('*')) => {
                    self.pos += 1;
                    let r = self.unary()?;
                    lhs = Expr::Bin(Op::Mul, Box::new(lhs), Box::new(r));
                }
                Some(Tok::Op('/')) => {
                    self.pos += 1;
                    let r = self.unary()?;
                    lhs = Expr::Bin(Op::Div, Box::new(lhs), Box::new(r));
                }
                _ if self.starts_primary() => {
                    let r = self.power()?;
                    lhs = Expr::Juxt(Box::new(lhs), Box::new(r));
                }
                _ => return Ok(lhs),
            }
        }
    }

    fn unary(&mut self) -> Result<Expr, String> {
        match self.peek() {
            Some(Tok::Op('-')) => {
                self.pos += 1;
                let e = self.unary()?;
                Ok(match e {
                    Expr::Num(v) => Expr::Num(-v),
                    other => Expr::Neg(Box::new(other)),
                })
            }
            Some(Tok::Op('+')) => {
                self.pos += 1;
                self.unary()
            }
            _ => self.power(),
        }
    }

    fn power(&mut self) -> Result<Expr, String> {
        let base = self.postfix()?;
        if let Some(Tok::Op('^')) = self.peek() {
            self.pos += 1;
            let exp = self.unary()?;
            return Ok(Expr::Bin(Op::Pow, Box::new(base), Box::new(exp)));
        }
        Ok(base)
    }

    fn postfix(&mut self) -> Result<Expr, String> {
        let mut e = self.primary()?;
        loop {
            match self.peek() {
                Some(Tok::Deg) => {
                    self.pos += 1;
                    e = Expr::Deg(Box::new(e));
                }
                Some(Tok::Bang) => {
                    self.pos += 1;
                    e = Expr::Fact(Box::new(e));
                }
                _ => return Ok(e),
            }
        }
    }

    fn primary(&mut self) -> Result<Expr, String> {
        match self.next() {
            Some(Tok::Num(v)) => Ok(Expr::Num(v)),
            Some(Tok::Const(c)) => Ok(Expr::Const(c)),
            Some(Tok::Ident(name)) => Ok(Expr::Var(name)),
            Some(Tok::LParen) => {
                let saved = self.abs_depth;
                self.abs_depth = 0;
                let e = self.expr()?;
                self.abs_depth = saved;
                if let Some(Tok::Comma) = self.peek() {
                    return Err("这里不支持逗号；向量 / 点请写成 v = (1, 2, 3)".into());
                }
                self.expect_rparen()?;
                Ok(e)
            }
            Some(Tok::Bar) => {
                self.abs_depth += 1;
                let e = self.expr()?;
                self.abs_depth -= 1;
                match self.next() {
                    Some(Tok::Bar) => Ok(Expr::Call("abs", vec![e])),
                    _ => Err("绝对值缺少右边的 |".into()),
                }
            }
            Some(Tok::Sqrt) => {
                let e = self.power()?;
                Ok(Expr::Call("sqrt", vec![e]))
            }
            Some(Tok::Func(name, arity)) => {
                if let Some(Tok::LParen) = self.peek() {
                    self.pos += 1;
                    let saved = self.abs_depth;
                    self.abs_depth = 0;
                    let mut args = vec![self.expr()?];
                    while let Some(Tok::Comma) = self.peek() {
                        self.pos += 1;
                        args.push(self.expr()?);
                    }
                    self.abs_depth = saved;
                    self.expect_rparen()?;
                    if args.len() != arity {
                        return Err(format!("{name} 需要 {arity} 个参数"));
                    }
                    // `sin(x)^2` reads as (sin x)^2, handled by power() on the caller side
                    Ok(Expr::Call(name, args))
                } else if arity == 1 {
                    // `sin x`, `ln 2x` — take one power-level factor as the argument
                    let arg = self.power()?;
                    Ok(Expr::Call(name, vec![arg]))
                } else {
                    Err(format!("{name} 后面需要括号"))
                }
            }
            Some(Tok::RParen) => Err("多余的右括号 )".into()),
            Some(Tok::Op(c)) => Err(format!("运算符 “{c}” 前面缺少内容")),
            Some(Tok::Comma) => Err("多余的逗号".into()),
            Some(Tok::Deg) => Err("° 前面需要数字".into()),
            Some(Tok::Bang) => Err("! 前面需要数字".into()),
            None => Err("表达式不完整".into()),
        }
    }
}

pub fn parse(src: &str) -> Result<Expr, String> {
    let toks = tokenize(src)?;
    if toks.is_empty() {
        return Err("空表达式".into());
    }
    let mut p = Parser { toks, pos: 0, abs_depth: 0 };
    let e = p.expr()?;
    if p.pos < p.toks.len() {
        return Err(match &p.toks[p.pos] {
            Tok::RParen => "多余的右括号 )".into(),
            Tok::Comma => "这里不支持逗号；向量 / 点请写成 v = (1, 2, 3)".into(),
            _ => "表达式后面有无法理解的内容".into(),
        });
    }
    Ok(e)
}

impl Expr {
    pub fn free_vars(&self, out: &mut Vec<String>) {
        match self {
            Expr::Var(n) => {
                if !out.contains(n) {
                    out.push(n.clone());
                }
            }
            Expr::Num(_) | Expr::Const(_) => {}
            Expr::Neg(a) | Expr::Deg(a) | Expr::Fact(a) => a.free_vars(out),
            Expr::Bin(_, a, b) | Expr::Juxt(a, b) => {
                a.free_vars(out);
                b.free_vars(out);
            }
            Expr::Call(_, args) => args.iter().for_each(|a| a.free_vars(out)),
        }
    }

    pub fn substitute(&self, name: &str, with: &Expr) -> Expr {
        match self {
            Expr::Var(n) if n == name => with.clone(),
            Expr::Var(_) | Expr::Num(_) | Expr::Const(_) => self.clone(),
            Expr::Neg(a) => Expr::Neg(Box::new(a.substitute(name, with))),
            Expr::Deg(a) => Expr::Deg(Box::new(a.substitute(name, with))),
            Expr::Fact(a) => Expr::Fact(Box::new(a.substitute(name, with))),
            Expr::Bin(op, a, b) => Expr::Bin(*op, Box::new(a.substitute(name, with)), Box::new(b.substitute(name, with))),
            Expr::Juxt(a, b) => Expr::Juxt(Box::new(a.substitute(name, with)), Box::new(b.substitute(name, with))),
            Expr::Call(f, args) => Expr::Call(f, args.iter().map(|a| a.substitute(name, with)).collect()),
        }
    }

    /// Fully parenthesised source that round-trips through `parse`.
    pub fn to_source(&self) -> String {
        match self {
            Expr::Num(v) => {
                if *v < 0.0 {
                    format!("({})", fmt_num(*v))
                } else {
                    fmt_num(*v)
                }
            }
            Expr::Const(c) => (*c).to_string(),
            Expr::Var(n) => n.clone(),
            Expr::Neg(a) => format!("(-{})", a.to_source()),
            Expr::Deg(a) => format!("({}°)", a.to_source()),
            Expr::Fact(a) => format!("({}!)", a.to_source()),
            Expr::Bin(op, a, b) => {
                let o = match op {
                    Op::Add => "+",
                    Op::Sub => "-",
                    Op::Mul => "*",
                    Op::Div => "/",
                    Op::Pow => "^",
                };
                format!("({}{}{})", a.to_source(), o, b.to_source())
            }
            Expr::Juxt(a, b) => format!("({}*{})", a.to_source(), b.to_source()),
            Expr::Call(f, args) => {
                let inner: Vec<String> = args.iter().map(|a| a.to_source()).collect();
                format!("{}({})", f, inner.join(","))
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Compiled form: variables resolved to slots for fast repeated evaluation.

#[derive(Clone, Debug)]
pub enum Code {
    Num(f64),
    Slot(usize),
    Neg(Box<Code>),
    Bin(Op, Box<Code>, Box<Code>),
    Call(&'static str, Vec<Code>),
    Fact(Box<Code>),
}

/// Compile `e` so that `slots[i]` holds the value of `names[i]`; other variables come from `env`.
pub fn compile(e: &Expr, names: &[&str], env: &HashMap<String, f64>) -> Result<Code, String> {
    Ok(match e {
        Expr::Num(v) => Code::Num(*v),
        Expr::Const("pi") => Code::Num(PI),
        Expr::Const(_) => Code::Num(std::f64::consts::E),
        Expr::Var(n) => {
            if let Some(i) = names.iter().position(|s| s == n) {
                Code::Slot(i)
            } else if let Some(v) = env.get(n) {
                Code::Num(*v)
            } else {
                return Err(format!("未知量 {n} 没有取值"));
            }
        }
        Expr::Neg(a) => Code::Neg(Box::new(compile(a, names, env)?)),
        Expr::Deg(a) => Code::Bin(Op::Mul, Box::new(compile(a, names, env)?), Box::new(Code::Num(PI / 180.0))),
        Expr::Fact(a) => Code::Fact(Box::new(compile(a, names, env)?)),
        Expr::Bin(op, a, b) => Code::Bin(*op, Box::new(compile(a, names, env)?), Box::new(compile(b, names, env)?)),
        Expr::Juxt(a, b) => Code::Bin(Op::Mul, Box::new(compile(a, names, env)?), Box::new(compile(b, names, env)?)),
        Expr::Call(f, args) => Code::Call(f, args.iter().map(|a| compile(a, names, env)).collect::<Result<_, _>>()?),
    })
}

fn gamma_fact(n: f64) -> f64 {
    if n < 0.0 || n.fract() != 0.0 || n > 170.0 {
        return f64::NAN;
    }
    (1..=(n as u64)).fold(1.0, |acc, k| acc * k as f64)
}

impl Code {
    pub fn eval(&self, s: &[f64]) -> f64 {
        match self {
            Code::Num(v) => *v,
            Code::Slot(i) => s[*i],
            Code::Neg(a) => -a.eval(s),
            Code::Fact(a) => gamma_fact(a.eval(s)),
            Code::Bin(op, a, b) => {
                let x = a.eval(s);
                let y = b.eval(s);
                match op {
                    Op::Add => x + y,
                    Op::Sub => x - y,
                    Op::Mul => x * y,
                    Op::Div => x / y,
                    Op::Pow => {
                        // real odd roots of negatives, e.g. x^(1/3)
                        if x < 0.0 && y.fract() != 0.0 {
                            let inv = 1.0 / y;
                            if (inv.round() - inv).abs() < 1e-9 && (inv.round() as i64) % 2 != 0 {
                                return -(-x).powf(y);
                            }
                        }
                        x.powf(y)
                    }
                }
            }
            Code::Call(f, args) => {
                let a = args[0].eval(s);
                match *f {
                    "sin" => a.sin(),
                    "cos" => a.cos(),
                    "tan" => a.tan(),
                    "cot" => 1.0 / a.tan(),
                    "sec" => 1.0 / a.cos(),
                    "csc" => 1.0 / a.sin(),
                    "asin" => a.asin(),
                    "acos" => a.acos(),
                    "atan" => a.atan(),
                    "sinh" => a.sinh(),
                    "cosh" => a.cosh(),
                    "tanh" => a.tanh(),
                    "sqrt" => a.sqrt(),
                    "cbrt" => a.cbrt(),
                    "exp" => a.exp(),
                    "abs" => a.abs(),
                    "ln" => a.ln(),
                    "log" => a.log10(),
                    "floor" => a.floor(),
                    "ceil" => a.ceil(),
                    "sign" => {
                        if a == 0.0 {
                            0.0
                        } else {
                            a.signum()
                        }
                    }
                    "min" => a.min(args[1].eval(s)),
                    "max" => a.max(args[1].eval(s)),
                    _ => f64::NAN,
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// LaTeX printing

pub fn fmt_num(v: f64) -> String {
    if !v.is_finite() {
        return if v.is_nan() { "NaN".into() } else if v > 0.0 { "∞".into() } else { "-∞".into() };
    }
    if v.fract() == 0.0 && v.abs() < 1e15 {
        return format!("{}", v as i64);
    }
    let s = format!("{:.6}", v);
    let s = s.trim_end_matches('0').trim_end_matches('.').to_string();
    if s == "-0" {
        "0".into()
    } else {
        s
    }
}

fn prec(e: &Expr) -> u8 {
    match e {
        Expr::Bin(Op::Add, ..) | Expr::Bin(Op::Sub, ..) => 1,
        Expr::Bin(Op::Mul, ..) | Expr::Bin(Op::Div, ..) | Expr::Juxt(..) => 2,
        Expr::Neg(_) => 2,
        Expr::Num(v) if *v < 0.0 => 2,
        Expr::Bin(Op::Pow, ..) => 4,
        Expr::Call(..) => 4,
        _ => 5,
    }
}

fn wrap(s: String) -> String {
    format!("\\left({}\\right)", s)
}

fn starts_with_digit(e: &Expr) -> bool {
    match e {
        Expr::Num(_) => true,
        Expr::Bin(Op::Pow, a, _) | Expr::Bin(Op::Mul, a, _) | Expr::Juxt(a, _) | Expr::Deg(a) | Expr::Fact(a) => starts_with_digit(a),
        _ => false,
    }
}

pub fn latex(e: &Expr) -> String {
    match e {
        Expr::Num(v) => fmt_num(*v),
        Expr::Const("pi") => "\\pi".into(),
        Expr::Const(c) => (*c).to_string(),
        Expr::Var(n) => {
            let (base, sub) = match n.split_once('_') {
                Some((b, s)) => (b, Some(s)),
                None => (n.as_str(), None),
            };
            let b = greek_latex(base).map(|s| s.to_string()).unwrap_or_else(|| base.to_string());
            match sub {
                Some(s) => format!("{}_{{{}}}", b, s),
                None => b,
            }
        }
        Expr::Neg(a) => {
            let inner = latex(a);
            if prec(a) <= 2 {
                format!("-{}", wrap(inner))
            } else {
                format!("-{}", inner)
            }
        }
        Expr::Deg(a) => format!("{}^{{\\circ}}", latex(a)),
        Expr::Fact(a) => {
            if prec(a) < 5 {
                format!("{}!", wrap(latex(a)))
            } else {
                format!("{}!", latex(a))
            }
        }
        Expr::Bin(Op::Add, a, b) => {
            let rb = latex(b);
            if let Some(stripped) = rb.strip_prefix('-') {
                format!("{} - {}", latex(a), stripped)
            } else {
                format!("{} + {}", latex(a), rb)
            }
        }
        Expr::Bin(Op::Sub, a, b) => {
            let rb = if prec(b) <= 1 || matches!(**b, Expr::Neg(_)) || matches!(**b, Expr::Num(v) if v < 0.0) {
                wrap(latex(b))
            } else {
                latex(b)
            };
            format!("{} - {}", latex(a), rb)
        }
        Expr::Bin(Op::Div, a, b) => format!("\\frac{{{}}}{{{}}}", latex(a), latex(b)),
        Expr::Bin(Op::Mul, a, b) | Expr::Juxt(a, b) => {
            let la = if prec(a) < 2 { wrap(latex(a)) } else { latex(a) };
            let lb = if prec(b) <= 2 && !matches!(**b, Expr::Bin(Op::Div, ..)) { wrap(latex(b)) } else { latex(b) };
            let explicit = matches!(e, Expr::Bin(Op::Mul, ..));
            if starts_with_digit(b) || (explicit && !matches!(**a, Expr::Num(_))) {
                format!("{} \\cdot {}", la, lb)
            } else {
                format!("{}{}", la, lb)
            }
        }
        Expr::Bin(Op::Pow, a, b) => {
            let base = if prec(a) < 5 { wrap(latex(a)) } else { latex(a) };
            format!("{}^{{{}}}", base, latex(b))
        }
        Expr::Call(f, args) => {
            let a0 = latex(&args[0]);
            match *f {
                "sqrt" => format!("\\sqrt{{{}}}", a0),
                "cbrt" => format!("\\sqrt[3]{{{}}}", a0),
                "abs" => format!("\\left|{}\\right|", a0),
                "exp" => format!("e^{{{}}}", a0),
                "floor" => format!("\\lfloor {} \\rfloor", a0),
                "ceil" => format!("\\lceil {} \\rceil", a0),
                "log" => format!("\\lg{}", wrap(a0)),
                "min" | "max" => format!("\\{}\\left({}, {}\\right)", f, a0, latex(&args[1])),
                "asin" => format!("\\arcsin{}", wrap(a0)),
                "acos" => format!("\\arccos{}", wrap(a0)),
                "atan" => format!("\\arctan{}", wrap(a0)),
                "sign" => format!("\\operatorname{{sgn}}{}", wrap(a0)),
                _ => {
                    let simple = matches!(args[0], Expr::Var(_) | Expr::Num(_) | Expr::Const(_));
                    if simple {
                        format!("\\{} {}", f, a0)
                    } else {
                        format!("\\{}{}", f, wrap(a0))
                    }
                }
            }
        }
    }
}

/// Split `src` at top-level occurrences of `sep` (outside brackets).
pub fn split_top(src: &str, seps: &[char]) -> Vec<String> {
    let mut depth = 0i32;
    let mut parts = Vec::new();
    let mut cur = String::new();
    for c in src.chars() {
        match c {
            '(' | '[' | '{' | '⟨' => {
                depth += 1;
                cur.push(c);
            }
            ')' | ']' | '}' | '⟩' => {
                depth -= 1;
                cur.push(c);
            }
            _ if depth == 0 && seps.contains(&c) => {
                parts.push(std::mem::take(&mut cur));
            }
            _ => cur.push(c),
        }
    }
    parts.push(cur);
    parts
}

/// Parse "(a, b, c)" / "<a, b>" into component sources, or None if it isn't a tuple.
pub fn tuple_parts(src: &str) -> Option<Vec<String>> {
    let t = src.trim();
    let inner = if (t.starts_with('(') && t.ends_with(')')) || (t.starts_with('[') && t.ends_with(']')) || (t.starts_with('<') && t.ends_with('>')) || (t.starts_with('⟨') && t.ends_with('⟩')) {
        let mut cs = t.chars();
        cs.next();
        cs.next_back();
        cs.as_str().to_string()
    } else {
        return None;
    };
    let parts = split_top(&inner, &[',', '，']);
    if parts.len() < 2 {
        return None;
    }
    Some(parts.into_iter().map(|p| p.trim().to_string()).collect())
}

/// LaTeX for a whole statement: equations, tuples and plain expressions. Falls back to `\text{}`.
pub fn statement_latex(src: &str) -> String {
    let sides = split_top(src, &['=']);
    let rendered: Vec<String> = sides
        .iter()
        .map(|side| {
            let side = side.trim();
            if let Some(parts) = tuple_parts(side) {
                let inner: Vec<String> = parts.iter().map(|p| parse(p).map(|e| latex(&e)).unwrap_or_else(|_| text_latex(p))).collect();
                format!("\\left({}\\right)", inner.join(",\\ "))
            } else {
                parse(side).map(|e| latex(&e)).unwrap_or_else(|_| text_latex(side))
            }
        })
        .collect();
    rendered.join(" = ")
}

fn text_latex(s: &str) -> String {
    let escaped: String = s.chars().map(|c| match c {
        '\\' | '{' | '}' | '$' | '&' | '#' | '%' | '_' | '^' => ' ',
        _ => c,
    }).collect();
    format!("\\text{{{}}}", escaped)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(src: &str, x: f64) -> f64 {
        let e = parse(src).unwrap();
        let c = compile(&e, &["x"], &HashMap::new()).unwrap();
        c.eval(&[x])
    }

    #[test]
    fn implicit_and_functions() {
        assert!((ev("2x^2 - 3x + 1", 2.0) - 3.0).abs() < 1e-12);
        assert!((ev("sinx", 1.0) - 1f64.sin()).abs() < 1e-12);
        assert!((ev("2(x+1)", 1.0) - 4.0).abs() < 1e-12);
        assert!((ev("-x^2", 3.0) + 9.0).abs() < 1e-12);
        assert!((ev("|x-3|", 1.0) - 2.0).abs() < 1e-12);
        assert!((ev("√x", 9.0) - 3.0).abs() < 1e-12);
        assert!((ev("x²", 3.0) - 9.0).abs() < 1e-12);
        assert!((ev("e^x", 0.0) - 1.0).abs() < 1e-12);
        assert!((ev("exp(x)", 0.0) - 1.0).abs() < 1e-12);
        assert!((ev("30°", 0.0) - PI / 6.0).abs() < 1e-12);
        assert!((ev("x^(1/3)", -8.0) + 2.0).abs() < 1e-9);
        assert!((ev("sin(x)^2 + cos(x)^2", 0.7) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn splitting() {
        let e = parse("kx + b").unwrap();
        let mut v = Vec::new();
        e.free_vars(&mut v);
        assert_eq!(v, vec!["k", "x", "b"]);
        let e = parse("a_1 x + theta").unwrap();
        let mut v = Vec::new();
        e.free_vars(&mut v);
        assert_eq!(v, vec!["a_1", "x", "theta"]);
    }

    #[test]
    fn latex_out() {
        assert_eq!(statement_latex("y = x^2 - 1"), "y = x^{2} - 1");
        assert_eq!(statement_latex("(x+1)/2"), "\\frac{x + 1}{2}");
        assert_eq!(statement_latex("2sin(x)"), "2\\sin x");
        assert_eq!(statement_latex("a = (1, 2, 3)"), "a = \\left(1,\\ 2,\\ 3\\right)");
    }
}
