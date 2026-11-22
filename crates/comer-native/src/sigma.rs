//! CoMER often reads an isolated handwritten σ as 0, O, Y, or u. Port of
//! `src/ocr/comer/sigma.ts` — only those whole-glyph readings are rewritten,
//! and only when the ink itself has the loop-plus-tail of σ.

use crate::preprocess::{Point, Stroke};
use regex::Regex;

const MISREAD: &str = "^(?:0|O|o|Y|y|u|U)$";

pub fn repair_isolated_sigma(strokes: &[Stroke], model_text: &str) -> Option<String> {
    let text: String = model_text.chars().filter(|c| !c.is_whitespace()).collect();
    if !Regex::new(MISREAD).unwrap().is_match(&text) {
        return None;
    }
    if !looks_like_isolated_sigma(strokes) {
        return None;
    }
    Some("sigma".to_string())
}

pub fn looks_like_isolated_sigma(strokes: &[Stroke]) -> bool {
    let drawn: Vec<&Stroke> = strokes
        .iter()
        .filter(|s| s.points.len() >= 4 && arc_length(&s.points) >= 22.0)
        .collect();
    if drawn.len() != 1 {
        return false;
    }
    let pts = &drawn[0].points;
    let b = bounds(pts);
    if b.w < 16.0 || b.h < 16.0 {
        return false;
    }
    let aspect = b.h / b.w;
    if !(0.5..=2.15).contains(&aspect) {
        return false;
    }
    let diag = b.w.hypot(b.h);
    let len = arc_length(pts);
    if len < diag * 1.65 || len > diag * 5.5 {
        return false;
    }
    let turn = total_turn(pts);
    if !(3.5..=8.8).contains(&turn) {
        return false;
    }

    let cum = cumulative(pts);
    let end_gap = dist(&pts[0], &pts[pts.len() - 1]);
    let approach = nearest_approach(pts, &cum);
    let body = centroid(pts, &cum, 0.0, 1.0);
    let cv = radius_cv(pts, &cum, &body, 0.0, 1.0);
    let tail = has_outward_tail(pts, &cum);

    // A zero meets itself and stays inside its own bowl. σ leaves a gap or a tail.
    let closed_oval = end_gap < diag * 0.1 && cv < 0.25 && !tail;
    if closed_oval {
        return false;
    }
    if plain_bowl(pts, &b, end_gap, turn, approach, diag) {
        return false;
    }
    if top_fork(pts, &b) {
        return false;
    }

    let hook = terminal_hook(pts, &cum);
    let is_loop = approach < diag * 0.34 && end_gap > diag * 0.08;
    hook || (is_loop && (tail || end_gap > diag * 0.2))
}

struct Bounds {
    x0: f64,
    y0: f64,
    w: f64,
    h: f64,
}

fn plain_bowl(pts: &[Point], b: &Bounds, end_gap: f64, turn: f64, approach: f64, diag: f64) -> bool {
    let y0 = (pts[0].y - b.y0) / b.h;
    let y1 = (pts[pts.len() - 1].y - b.y0) / b.h;
    y0 < 0.3 && y1 < 0.3 && end_gap > b.w * 0.4 && turn < 4.5 && approach > diag * 0.32
}

/// A sharp peak in the upper half, with arms leaving both ways: a Y, not σ.
fn top_fork(pts: &[Point], b: &Bounds) -> bool {
    for i in 1..pts.len() - 1 {
        let a = &pts[i - 1];
        let c = &pts[i];
        let d = &pts[i + 1];
        let (Some(v1), Some(v2)) = (unit(a, c), unit(c, d)) else { continue };
        let dot = v1.0 * v2.0 + v1.1 * v2.1;
        if dot > 0.35 {
            continue;
        }
        let high = c.y < b.y0 + b.h * 0.55;
        let opens_up = a.y < c.y + 4.0 && d.y < c.y + 4.0 && (a.x - d.x).abs() > b.w * 0.35;
        if high && opens_up {
            return true;
        }
    }
    false
}

fn terminal_hook(pts: &[Point], cum: &[f64]) -> bool {
    let (Some(mid), Some(end)) = (chord(pts, cum, 0.5, 0.72), chord(pts, cum, 0.82, 1.0)) else { return false };
    mid.0 * end.0 + mid.1 * end.1 < 0.2
}

/// The last fifth leaves the box of the earlier ink: a tail, not the close of a circle.
fn has_outward_tail(pts: &[Point], cum: &[f64]) -> bool {
    let total = cum[cum.len() - 1];
    let (mut x0, mut y0, mut x1, mut y1) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    let mut n = 0usize;
    for (i, p) in pts.iter().enumerate() {
        if cum[i] > total * 0.8 {
            break;
        }
        x0 = x0.min(p.x);
        y0 = y0.min(p.y);
        x1 = x1.max(p.x);
        y1 = y1.max(p.y);
        n += 1;
    }
    if n < 4 {
        return false;
    }
    let pad = 4f64.max((x1 - x0).hypot(y1 - y0) * 0.06);
    for (i, p) in pts.iter().enumerate() {
        if cum[i] < total * 0.84 {
            continue;
        }
        if p.x < x0 - pad || p.x > x1 + pad || p.y < y0 - pad || p.y > y1 + pad {
            return true;
        }
    }
    false
}

fn nearest_approach(pts: &[Point], cum: &[f64]) -> f64 {
    let total = cum[cum.len() - 1];
    let mut best = f64::INFINITY;
    for i in 0..pts.len() {
        if cum[i] > total * 0.4 {
            break;
        }
        for j in (i + 1..pts.len()).rev() {
            if cum[j] < total * 0.6 {
                break;
            }
            if cum[j] - cum[i] < total * 0.35 {
                continue;
            }
            let d = dist(&pts[i], &pts[j]);
            if d < best {
                best = d;
            }
        }
    }
    best
}

fn total_turn(pts: &[Point]) -> f64 {
    let mut turn = 0f64;
    let mut prev: Option<(f64, f64)> = None;
    for i in 1..pts.len() {
        let Some(dir) = unit(&pts[i - 1], &pts[i]) else { continue };
        if let Some(p) = prev {
            turn += (p.0 * dir.0 + p.1 * dir.1).clamp(-1.0, 1.0).acos();
        }
        prev = Some(dir);
    }
    turn
}

fn radius_cv(pts: &[Point], cum: &[f64], c: &Point, from: f64, to: f64) -> f64 {
    let total = cum[cum.len() - 1];
    let mut rs = Vec::new();
    for (i, p) in pts.iter().enumerate() {
        let t = cum[i] / total;
        if t < from || t > to {
            continue;
        }
        rs.push(dist(p, c));
    }
    if rs.len() < 4 {
        return 1.0;
    }
    let mean = rs.iter().sum::<f64>() / rs.len() as f64;
    if mean < 1.0 {
        return 1.0;
    }
    let variance = rs.iter().map(|r| (r - mean).powi(2)).sum::<f64>() / rs.len() as f64;
    variance.sqrt() / mean
}

fn centroid(pts: &[Point], cum: &[f64], from: f64, to: f64) -> Point {
    let total = cum[cum.len() - 1];
    let (mut x, mut y) = (0f64, 0f64);
    let mut n = 0usize;
    for (i, p) in pts.iter().enumerate() {
        let t = if total == 0.0 { 0.0 } else { cum[i] / total };
        if t < from || t > to {
            continue;
        }
        x += p.x;
        y += p.y;
        n += 1;
    }
    if n == 0 {
        return pts[0];
    }
    Point { x: x / n as f64, y: y / n as f64 }
}

fn chord(pts: &[Point], cum: &[f64], from: f64, to: f64) -> Option<(f64, f64)> {
    let a = point_at(pts, cum, from)?;
    let b = point_at(pts, cum, to)?;
    unit(&a, &b)
}

fn point_at(pts: &[Point], cum: &[f64], fraction: f64) -> Option<Point> {
    let target = cum[cum.len() - 1] * fraction;
    for i in 1..pts.len() {
        if cum[i] + 1e-9 < target {
            continue;
        }
        let span = cum[i] - cum[i - 1];
        let t = if span < 1e-9 { 0.0 } else { (target - cum[i - 1]) / span };
        return Some(Point { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t });
    }
    pts.last().cloned()
}

fn cumulative(pts: &[Point]) -> Vec<f64> {
    let mut out = vec![0f64];
    for i in 1..pts.len() {
        out.push(out[i - 1] + dist(&pts[i - 1], &pts[i]));
    }
    out
}

fn arc_length(pts: &[Point]) -> f64 {
    let mut n = 0f64;
    for i in 1..pts.len() {
        n += dist(&pts[i - 1], &pts[i]);
    }
    n
}

fn unit(a: &Point, b: &Point) -> Option<(f64, f64)> {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let len = dx.hypot(dy);
    if len < 0.8 {
        return None;
    }
    Some((dx / len, dy / len))
}

fn dist(a: &Point, b: &Point) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}

fn bounds(pts: &[Point]) -> Bounds {
    let mut x0 = f64::INFINITY;
    let mut y0 = f64::INFINITY;
    let mut x1 = f64::NEG_INFINITY;
    let mut y1 = f64::NEG_INFINITY;
    for p in pts {
        x0 = x0.min(p.x);
        y0 = y0.min(p.y);
        x1 = x1.max(p.x);
        y1 = y1.max(p.y);
    }
    Bounds { x0, y0, w: x1 - x0, h: y1 - y0 }
}
