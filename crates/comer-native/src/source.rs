//! Vocab loading + token→word mapping + tokens→ASCII source.
//! Port of `src/ocr/comer/source.ts`.

use std::collections::HashMap;
use std::error::Error;
use std::fs;

#[derive(serde::Deserialize, Clone, Debug)]
pub struct SpecialTokens {
    pub pad: i64,
    pub sos: i64,
    pub eos: i64,
}

#[derive(serde::Deserialize, Clone, Debug)]
pub struct Vocab {
    #[serde(default)]
    pub word2idx: HashMap<String, i64>,
    pub idx2word: HashMap<String, String>,
    pub special_tokens: SpecialTokens,
    pub vocab_size: usize,
}

impl Vocab {
    pub fn load(path: &std::path::Path) -> Result<Vocab, Box<dyn Error>> {
        let raw = fs::read_to_string(path)?;
        Self::from_json_str(&raw)
    }

    pub fn from_json_str(raw: &str) -> Result<Vocab, Box<dyn Error>> {
        let v: Vocab = serde_json::from_str(raw)?;
        if v.idx2word.is_empty() || v.vocab_size == 0 {
            return Err("vocab.json is missing idx2word/vocab_size".into());
        }
        Ok(v)
    }

    /// decodeTokens: skip pad/sos/eos, map ids through idx2word.
    pub fn decode_tokens(&self, ids: &[i64]) -> Vec<String> {
        let skip = [self.special_tokens.pad, self.special_tokens.sos, self.special_tokens.eos];
        let mut words = Vec::new();
        for id in ids {
            if skip.contains(id) {
                continue;
            }
            if let Some(word) = self.idx2word.get(&id.to_string()) {
                words.push(word.clone());
            }
        }
        words
    }
}

const NAMED: &[(&str, &str)] = &[
    ("\\alpha", "alpha"),
    ("\\beta", "beta"),
    ("\\gamma", "gamma"),
    ("\\lambda", "lambda"),
    ("\\mu", "mu"),
    ("\\phi", "phi"),
    ("\\pi", "pi"),
    ("\\sigma", "sigma"),
    ("\\theta", "theta"),
];

fn named(cur: &str) -> Option<&'static str> {
    NAMED.iter().find(|(k, _)| *k == cur).map(|(_, v)| *v)
}

/**
 * CoMER tokens → the ASCII this sheet already parses. Port of tokensToSource:
 * `a ^ { 2 } = b` becomes `a^2 = b`; `\sigma`/`\pi`/`\theta` become the sheet's
 * names; `\sum`/`\int` keep their braced limits so KaTeX can show them.
 */
pub fn tokens_to_source(tokens: &[String]) -> String {
    let repaired = crate::repair::repair_latex(tokens);
    if !crate::repair::is_complete_expression(&repaired) {
        return String::new();
    }
    let mut i = 0usize;
    let repaired = repaired.clone();

    fn read_group(repaired: &[String], i: &mut usize) -> String {
        if repaired[*i] != "{" {
            return read_atom(repaired, i);
        }
        *i += 1;
        let mut body = String::new();
        let mut depth = 1usize;
        while *i < repaired.len() && depth > 0 {
            if repaired[*i] == "{" {
                depth += 1;
            } else if repaired[*i] == "}" {
                depth -= 1;
                if depth == 0 {
                    *i += 1;
                    break;
                }
            }
            body += &read_atom(repaired, i);
        }
        body
    }

    /// Keep braces around a group so ∑ / ∫ limits stay valid LaTeX.
    fn read_latex_group(repaired: &[String], i: &mut usize) -> String {
        if repaired[*i] != "{" {
            return read_atom(repaired, i);
        }
        format!("{{{}}}", read_group(repaired, i))
    }

    fn read_atom(repaired: &[String], i: &mut usize) -> String {
        if *i >= repaired.len() {
            return String::new();
        }
        let cur = repaired[*i].clone();
        *i += 1;
        if cur.is_empty() || cur == "{" || cur == "}" {
            return String::new();
        }
        if cur == "\\frac" {
            return format!("({})/({})", read_group(repaired, i), read_group(repaired, i));
        }
        if cur == "\\sqrt" {
            return format!("sqrt({})", read_group(repaired, i));
        }
        if cur == "\\vec" || cur == "\\overrightarrow" {
            return format!("\\vec{{{}}}", read_group(repaired, i));
        }
        if cur == "\\sum" || cur == "\\int" {
            let mut out = cur;
            let mut take = |mark: &str, i: &mut usize, out: &mut String| {
                let mut j = *i;
                if repaired.get(j).map(|t| t == "\\limits").unwrap_or(false) {
                    j += 1;
                }
                if repaired.get(j).map(|t| t == mark).unwrap_or(false) {
                    *i = j + 1;
                    *out += mark;
                    *out += &read_latex_group(repaired, i);
                }
            };
            take("_", i, &mut out);
            take("^", i, &mut out);
            if !out.contains('_') {
                take("_", i, &mut out);
            }
            if *i >= repaired.len() {
                return out;
            }
            let body = if repaired[*i] == "{" { read_latex_group(repaired, i) } else { read_atom(repaired, i) };
            if !body.trim().is_empty() {
                out += &format!(" {}", body.trim());
            }
            return out;
        }
        if cur == "^" {
            return format!("^{}", read_group(repaired, i));
        }
        if cur == "_" {
            return format!("_{}", read_group(repaired, i));
        }
        if cur == "\\ln" {
            return "ln".to_string();
        }
        if cur == "\\lg" {
            return "lg".to_string();
        }
        if cur == "\\log" {
            return "log".to_string();
        }
        if cur == "\\cdot" || cur == "\\times" {
            return String::new();
        }
        if cur == "=" || cur == "+" || cur == "-" {
            return format!(" {cur} ");
        }
        if let Some(name) = named(&cur) {
            return name.to_string();
        }
        cur
    }

    let mut out = String::new();
    while i < repaired.len() {
        out += &read_atom(&repaired, &mut i);
    }
    // `out.replace(/\s+/g, ' ').trim()`
    let mut compact = String::new();
    let mut in_ws = false;
    for ch in out.chars() {
        if ch.is_whitespace() {
            in_ws = !compact.is_empty();
        } else {
            if in_ws {
                compact.push(' ');
                in_ws = false;
            }
            compact.push(ch);
        }
    }
    if !compact.chars().any(|c| c.is_ascii_alphanumeric() || c == '\\') {
        return String::new();
    }
    compact
}

#[cfg(test)]
mod tests {
    use super::*;

    fn toks(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn exponent_compacts() {
        assert_eq!(tokens_to_source(&toks(&["a", "^", "{", "2", "}", "=", "b"])), "a^2 = b");
    }

    #[test]
    fn frac_to_ascii() {
        assert_eq!(tokens_to_source(&toks(&["\\frac", "{", "1", "}", "{", "2", "}"])), "(1)/(2)");
    }

    #[test]
    fn greek_names() {
        assert_eq!(tokens_to_source(&toks(&["\\sigma"])), "sigma");
        assert_eq!(tokens_to_source(&toks(&["\\pi"])), "pi");
    }

    #[test]
    fn sum_keeps_limits() {
        assert_eq!(
            tokens_to_source(&toks(&["\\sum", "_", "{", "i", "}", "^", "{", "n", "}", "i"])),
            "\\sum_{i}^{n} i"
        );
    }
}
