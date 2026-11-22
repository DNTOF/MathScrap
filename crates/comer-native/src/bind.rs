//! After CoMER emits LaTeX, attach it to the sheet's point and vector forms.
//! Port of `src/ocr/comer/bind.ts` — only stroke layout is used, the model
//! stays the reader.

use crate::preprocess::{Point, Stroke};
use regex::Regex;

/// collapse runs of whitespace to one space, trim ends (`text.replace(/\s+/g,' ').trim()`)
pub fn collapse_ws(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_ws = false;
    for ch in text.chars() {
        if ch.is_whitespace() {
            in_ws = !out.is_empty();
        } else {
            if in_ws {
                out.push(' ');
                in_ws = false;
            }
            out.push(ch);
        }
    }
    out
}

/// remove ALL whitespace (`text.replace(/\s/g, '')`)
fn squash(text: &str) -> String {
    text.chars().filter(|c| !c.is_whitespace()).collect()
}

pub fn bind_ink(strokes: &[Stroke], model_text: &str) -> String {
    let text = collapse_ws(model_text);
    if text.is_empty() {
        return String::new();
    }
    let squashed = squash(&text);
    // ∑, ∫, π, … are not vectors. A bar across the top of Σ must not erase them.
    if squashed.starts_with('\\') && !vec_prefix(&squashed) {
        return text;
    }
    let arrow = find_over_arrow(strokes);
    if arrow.is_some() && arrow_reading(&squashed) {
        let letter = letter_of(&text);
        let Some(letter) = letter else {
            return String::new();
        };
        let from_ink = tuple_of(&text);
        let comps: Vec<String> = match (&from_ink, has_paren_stroke(strokes)) {
            (Some(t), true) => t.clone(),
            _ => vec![fmt(arrow.unwrap().0), fmt(arrow.unwrap().1)],
        };
        return format!("\\vec{{{letter}}} = ({})", comps.join(", "));
    }
    if Regex::new(r"^\\(?:vec|overrightarrow)\{[A-Za-z]\}$").unwrap().is_match(&squashed) {
        return String::new();
    }
    let point = point_of(&text, strokes);
    if let Some(point) = point {
        return point;
    }
    if Regex::new(r"^[A-Za-z]$").unwrap().is_match(&squashed) {
        return String::new();
    }
    // One number in parentheses is not a coordinate point.
    if Regex::new(r"^[A-Za-z]\([+\-0-9.]*\)?$").unwrap().is_match(&squashed) {
        return String::new();
    }
    if Regex::new(r"^[a-z]\s*=\s*\(").unwrap().is_match(&text) && !has_paren_stroke(strokes) {
        return String::new();
    }
    text
}

/// `\\vec` / `\\overrightarrow` prefix with a word boundary
fn vec_prefix(squashed: &str) -> bool {
    for prefix in ["\\vec", "\\overrightarrow"] {
        if let Some(rest) = squashed.strip_prefix(prefix) {
            match rest.chars().next() {
                None => return true,
                Some(c) if !(c.is_alphanumeric() || c == '_') => return true,
                _ => {}
            }
        }
    }
    false
}

/// A letter, `\vec{a}`, or `a = (1, 2)` — not an equation like `y = 2`.
fn arrow_reading(squashed: &str) -> bool {
    if Regex::new(r"^[A-Za-z]$").unwrap().is_match(squashed) {
        return true;
    }
    if Regex::new(r"^\\(?:vec|overrightarrow)\{[A-Za-z]\}$").unwrap().is_match(squashed) {
        return true;
    }
    if Regex::new(r"^[A-Za-z]\\rightarrow$").unwrap().is_match(squashed) {
        return true;
    }
    Regex::new(r"^[A-Za-z]=\([+\-0-9.]+(?:,[+\-0-9.]+){1,2}\)$").unwrap().is_match(squashed)
}

/// (dx/len, dy/len) of the over-arrow stroke, None when absent
pub fn find_over_arrow(strokes: &[Stroke]) -> Option<(f64, f64)> {
    if looks_like_sum_bars(strokes) {
        return None;
    }
    let drawn: Vec<&Stroke> = strokes.iter().filter(|s| s.points.len() >= 2).collect();
    if drawn.len() < 2 {
        return None;
    }
    let all = bounds_points(&drawn.iter().flat_map(|s| s.points.iter().copied()).collect::<Vec<_>>());
    if all.h < 16.0 || all.w < 12.0 {
        return None;
    }
    let mut bars: Vec<&Stroke> = Vec::new();
    for s in &drawn {
        let b = bounds_points(&s.points);
        let flat = b.h < 6f64.max(b.w * 0.42) && b.w > all.w * 0.45;
        let high = b.cy < all.y0 + all.h * 0.36;
        let rest: Vec<Point> = drawn.iter().filter(|o| !std::ptr::eq(**o, *s)).flat_map(|o| o.points.iter().copied()).collect();
        if rest.len() < 2 {
            continue;
        }
        let body = bounds_points(&rest);
        let above = b.y1 <= body.y0 + 3f64.max(body.h * 0.12);
        let covers = b.x0 < body.cx && b.x1 > body.cx;
        if flat && high && above && covers {
            bars.push(s);
        }
    }
    if bars.len() != 1 {
        return None;
    }
    let pts = &bars[0].points;
    let dx = pts[pts.len() - 1].x - pts[0].x;
    let dy = pts[0].y - pts[pts.len() - 1].y;
    let len = dx.hypot(dy);
    if len < 8.0 {
        return None;
    }
    Some((dx / len, dy / len))
}

pub fn looks_like_sum_bars(strokes: &[Stroke]) -> bool {
    let drawn: Vec<&Stroke> = strokes.iter().filter(|s| s.points.len() >= 2).collect();
    if drawn.len() < 3 {
        return false;
    }
    let all = bounds_points(&drawn.iter().flat_map(|s| s.points.iter().copied()).collect::<Vec<_>>());
    if all.h < 24.0 || all.w < 16.0 {
        return false;
    }
    let flats: Vec<&Stroke> = drawn
        .iter()
        .copied()
        .filter(|s| {
            let b = bounds_points(&s.points);
            b.w > all.w * 0.55 && b.h < 8f64.max(b.w * 0.35)
        })
        .collect();
    if flats.len() < 2 {
        return false;
    }
    let mut boxes: Vec<Bounds> = flats.iter().map(|s| bounds_points(&s.points)).collect();
    boxes.sort_by(|a, b| a.cy.partial_cmp(&b.cy).unwrap_or(std::cmp::Ordering::Equal));
    let top = &boxes[0];
    let bot = &boxes[boxes.len() - 1];
    if top.cy > all.y0 + all.h * 0.4 {
        return false;
    }
    if bot.cy < all.y0 + all.h * 0.6 {
        return false;
    }
    let gap = bot.y0 - top.y1;
    if gap < all.h * 0.35 {
        return false;
    }
    let overlap = top.x1.min(bot.x1) - top.x0.max(bot.x0);
    if overlap < top.w.min(bot.w) * 0.5 {
        return false;
    }
    drawn.iter().any(|s| {
        if flats.iter().any(|f| std::ptr::eq(*f, *s)) {
            return false;
        }
        let b = bounds_points(&s.points);
        b.h > gap * 0.45 && b.y0 < top.y1 + gap * 0.35 && b.y1 > bot.y0 - gap * 0.35
    })
}

fn point_of(text: &str, strokes: &[Stroke]) -> Option<String> {
    let t = squash(text);
    let re = Regex::new(r"^([A-Za-z])(?:=)?\(([+\-0-9.]+),([+\-0-9.]+)(?:,([+\-0-9.]+))?\)$").unwrap();
    let m = re.captures(&t)?;
    let coords: Vec<String> = [m.get(2), m.get(3), m.get(4)].into_iter().flatten().map(|g| g.as_str().to_string()).collect();
    // A lowercase name plus a 3-number tuple, with no parenthesis drawn, is the old
    // invented vector. A real point is a capital label or a 2-number coordinate.
    let label = m.get(1).unwrap().as_str();
    let lower = label.chars().all(|c| c.to_lowercase().next() == Some(c));
    if coords.len() >= 3 && lower && !has_paren_stroke(strokes) {
        return None;
    }
    Some(format!("{}({})", label.to_uppercase(), coords.join(", ")))
}

fn tuple_of(text: &str) -> Option<Vec<String>> {
    let t = squash(text);
    let re = Regex::new(r"\(([+\-0-9.]+),([+\-0-9.]+)(?:,([+\-0-9.]+))?\)$").unwrap();
    let m = re.captures(&t)?;
    Some([m.get(1), m.get(2), m.get(3)].into_iter().flatten().map(|g| g.as_str().to_string()).collect())
}

fn letter_of(text: &str) -> Option<String> {
    let t = squash(text);
    let wrapped = Regex::new(r"^\\(?:vec|overrightarrow)\{([A-Za-z])\}(?:=.*)?$").unwrap();
    if let Some(m) = wrapped.captures(&t) {
        return Some(m.get(1).unwrap().as_str().to_lowercase());
    }
    let arrow_tok = Regex::new(r"^([A-Za-z])\\rightarrow$").unwrap();
    if let Some(m) = arrow_tok.captures(&t) {
        return Some(m.get(1).unwrap().as_str().to_lowercase());
    }
    if Regex::new(r"^[A-Za-z]$").unwrap().is_match(&t) {
        return Some(t.to_lowercase());
    }
    let lhs = Regex::new(r"^([A-Za-z])(?:=|\()").unwrap();
    if let Some(m) = lhs.captures(&t) {
        return Some(m.get(1).unwrap().as_str().to_lowercase());
    }
    None
}

fn has_paren_stroke(strokes: &[Stroke]) -> bool {
    strokes.iter().any(|s| {
        let pts = &s.points;
        if pts.len() < 4 {
            return false;
        }
        let b = bounds_points(pts);
        if b.h < 14f64.max(b.w * 1.5) {
            return false;
        }
        let mid = &pts[pts.len() / 2];
        let chord = (pts[0].x + pts[pts.len() - 1].x) / 2.0;
        (mid.x - chord).abs() > b.w * 0.25
    })
}

/// JS `Math.round(n * 100) / 100` + `String(r)` shortest display, `-0`/`0` → "0"
fn fmt(n: f64) -> String {
    let r = (n * 100.0).round() / 100.0;
    if r == 0.0 {
        return "0".to_string();
    }
    format!("{r}")
}

struct Bounds {
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
    w: f64,
    h: f64,
    cx: f64,
    cy: f64,
}

fn bounds_points(pts: &[Point]) -> Bounds {
    let mut b = Bounds { x0: f64::INFINITY, y0: f64::INFINITY, x1: f64::NEG_INFINITY, y1: f64::NEG_INFINITY, w: 0.0, h: 0.0, cx: 0.0, cy: 0.0 };
    for p in pts {
        b.x0 = b.x0.min(p.x);
        b.y0 = b.y0.min(p.y);
        b.x1 = b.x1.max(p.x);
        b.y1 = b.y1.max(p.y);
    }
    b.w = b.x1 - b.x0;
    b.h = b.y1 - b.y0;
    b.cx = (b.x0 + b.x1) / 2.0;
    b.cy = (b.y0 + b.y1) / 2.0;
    b
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stroke(points: &[(f64, f64)]) -> Stroke {
        Stroke { points: points.iter().map(|(x, y)| Point { x: *x, y: *y }).collect(), line_width: 3.0 }
    }

    #[test]
    fn plain_formula_passes_through() {
        assert_eq!(bind_ink(&[], "y = 2"), "y = 2");
        assert_eq!(bind_ink(&[], "a ^ { 2 } = b"), "a ^ { 2 } = b");
    }

    #[test]
    fn bare_letter_without_arrow_stays_empty() {
        assert_eq!(bind_ink(&[stroke(&[(0.0, 0.0), (5.0, 5.0)])], "a"), "");
    }

    #[test]
    fn collapse_ws_matches_js() {
        assert_eq!(collapse_ws("a   b "), "a b");
        assert_eq!(collapse_ws("  "), "");
    }
}
