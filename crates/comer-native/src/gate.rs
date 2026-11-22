//! Stroke-structure helpers from `src/ocr/gate.ts` needed by the native
//! pipeline. `classifyInk` itself stays on the TS side (the frontend gate runs
//! before the native call); only `looksLikeIsolatedSigma` is required here.

use crate::preprocess::{Point, Stroke};

/**
 * One open curl whose rightmost point is an endpoint and whose leftmost point
 * sits in the bowl. That is a lowercase σ, not a tall Σ (several horizontal
 * reversals) and not a closed θ / o.
 */
pub fn looks_like_isolated_sigma(strokes: &[Stroke]) -> bool {
    let drawn: Vec<&Stroke> = strokes.iter().filter(|s| s.points.len() >= 2).collect();
    if drawn.len() != 1 {
        return false;
    }
    let pts = &drawn[0].points;
    if pts.len() < 6 {
        return false;
    }
    let b = bounds(pts);
    if b.w < 12.0 || b.h < 12.0 {
        return false;
    }
    if b.h > b.w * 1.35 && b.h > 28.0 {
        return false;
    }
    if b.w > b.h * 2.4 {
        return false;
    }
    let start = &pts[0];
    let end = &pts[pts.len() - 1];
    let chord = (end.x - start.x).hypot(end.y - start.y);
    let mut path = 0f64;
    let mut flips = 0i32;
    let mut prev = 0i32;
    for i in 1..pts.len() {
        let dx = pts[i].x - pts[i - 1].x;
        let dy = pts[i].y - pts[i - 1].y;
        path += dx.hypot(dy);
        if dx.abs() < 1.5 {
            continue;
        }
        let sign = if dx > 0.0 {
            1
        } else if dx < 0.0 {
            -1
        } else {
            0
        };
        if prev != 0 && sign != prev {
            flips += 1;
        }
        prev = sign;
    }
    // Σ zigzags more than once. A sigma turns from the bowl back toward its tail once.
    if flips != 1 {
        return false;
    }
    if chord < 8f64.max(b.w.min(b.h) * 0.28) {
        return false;
    }
    if path < chord * 1.55 {
        return false;
    }
    let mut right = &pts[0];
    let mut left = &pts[0];
    for p in pts {
        if p.x > right.x {
            right = p;
        }
        if p.x < left.x {
            left = p;
        }
    }
    let near = |a: &Point, c: &Point| (a.x - c.x).hypot(a.y - c.y) < 6f64.max(b.w * 0.2);
    if !near(right, start) && !near(right, end) {
        return false;
    }
    if near(left, start) || near(left, end) {
        return false;
    }
    true
}

struct Bounds {
    w: f64,
    h: f64,
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
    if !x0.is_finite() {
        return Bounds { w: 1.0, h: 1.0 };
    }
    Bounds { w: x1 - x0, h: y1 - y0 }
}
