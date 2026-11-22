//! Stroke polylines → CoMER image tensor.
//!
//! Line-by-line port of `src/ocr/comer/preprocess.ts` (round-1 parity target):
//! resample every ~3px, white ink on black, quadratic smoothing matching canvas
//! `quadraticCurveTo`, anti-aliased round stamp, bilinear downscale onto a
//! 256px-tall canvas whose width is a multiple of 64 (128–1024). Pure math, no
//! canvas API — f64 in, f32 out (JS Float32Array semantics).

pub const MODEL_H: usize = 256;
const MAX_W: usize = 1024;
const MIN_W: usize = 128;
const W_ALIGN: usize = 64;
const TARGET_H: f64 = 128.0;
const PAD: f64 = 16.0;

#[derive(Clone, Copy, Debug, serde::Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, serde::Deserialize)]
pub struct Stroke {
    pub points: Vec<Point>,
    #[serde(rename = "lineWidth")]
    pub line_width: f64,
}

#[derive(Clone, Debug)]
pub struct PreprocessResult {
    /// f32 values, height × width, row-major (JS Float32Array semantics)
    pub tensor: Vec<f32>,
    pub height: usize,
    pub width: usize,
    /// 1 = masked (outside content), 0 = content
    pub mask: Vec<u8>,
    pub mask_width: usize,
}

pub fn resample_points(points: &[Point], interval: f64) -> Vec<Point> {
    if points.len() < 2 {
        return points.to_vec();
    }
    let mut out = vec![points[0]];
    let mut remaining = interval;
    for i in 1..points.len() {
        let prev = points[i - 1];
        let curr = points[i];
        let dx = curr.x - prev.x;
        let dy = curr.y - prev.y;
        let dist = dx.hypot(dy);
        if dist <= remaining {
            remaining -= dist;
            continue;
        }
        let mut covered = remaining;
        while covered <= dist {
            let t = covered / dist;
            out.push(Point { x: prev.x + dx * t, y: prev.y + dy * t });
            covered += interval;
        }
        remaining = covered - dist;
    }
    out.push(points[points.len() - 1]);
    out
}

const MIN_STROKE_SIZE: f64 = 8.0;
const MIN_TOTAL_POINTS: usize = 6;
const MIN_PATH_LENGTH: f64 = 15.0;

/// Skip taps and specks — same gates the TS path runs before a model pass.
pub fn is_ink_meaningful(strokes: &[Stroke]) -> bool {
    let drawn: Vec<&Stroke> = strokes.iter().filter(|s| s.points.len() >= 2).collect();
    if drawn.is_empty() {
        return false;
    }
    let bbox = bounds(&drawn);
    let w = bbox.2 - bbox.0;
    let h = bbox.3 - bbox.1;
    if w < MIN_STROKE_SIZE && h < MIN_STROKE_SIZE {
        return false;
    }
    let mut total_points = 0usize;
    let mut total_length = 0f64;
    for s in &drawn {
        total_points += s.points.len();
        for i in 1..s.points.len() {
            let dx = s.points[i].x - s.points[i - 1].x;
            let dy = s.points[i].y - s.points[i - 1].y;
            total_length += dx.hypot(dy);
        }
    }
    total_points >= MIN_TOTAL_POINTS && total_length >= MIN_PATH_LENGTH
}

/// (minX, minY, maxX, maxY)
type Bounds = (f64, f64, f64, f64);

fn bounds(strokes: &[&Stroke]) -> Bounds {
    let mut b = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for s in strokes {
        for p in &s.points {
            b.0 = b.0.min(p.x);
            b.1 = b.1.min(p.y);
            b.2 = b.2.max(p.x);
            b.3 = b.3.max(p.y);
        }
    }
    if !b.0.is_finite() {
        return (0.0, 0.0, 1.0, 1.0);
    }
    b
}

pub fn preprocess_strokes(strokes: &[Stroke]) -> PreprocessResult {
    let drawn: Vec<&Stroke> = strokes.iter().filter(|s| s.points.len() >= 2).collect();
    let (min_x, min_y, max_x, max_y) = bounds(&drawn);
    let raw_w = (1f64.max((max_x - min_x).ceil()) + PAD * 2.0) as usize;
    let raw_h = (1f64.max((max_y - min_y).ceil()) + PAD * 2.0) as usize;
    let mut raw = vec![0f32; raw_w * raw_h];
    for stroke in &drawn {
        let pts: Vec<Point> = resample_points(&stroke.points, 3.0)
            .into_iter()
            .map(|p| Point { x: p.x - min_x + PAD, y: p.y - min_y + PAD })
            .collect();
        // Canvas stroke width, same as ink-on: diameter, round caps, white on black.
        paint_stroke(&mut raw, raw_w, raw_h, &pts, 2f64.max(stroke.line_width) / 2.0);
    }

    let scale = (TARGET_H / raw_h as f64).min(MAX_W as f64 / raw_w as f64);
    let dw = 1usize.max((raw_w as f64 * scale).round() as usize);
    let dh = 1usize.max((raw_h as f64 * scale).round() as usize);
    let canvas_w = ((MAX_W as f64).min(((dw as f64 + PAD) / W_ALIGN as f64).ceil() * W_ALIGN as f64).max(MIN_W as f64)) as usize;
    let mut tensor = vec![0f32; MODEL_H * canvas_w];
    blit(&raw, raw_w, raw_h, &mut tensor, canvas_w, dw, dh);

    let mut mask = vec![0u8; MODEL_H * canvas_w];
    for y in 0..MODEL_H {
        for x in 0..canvas_w {
            mask[y * canvas_w + x] = if y < dh && x < dw { 0 } else { 1 };
        }
    }
    PreprocessResult { tensor, height: MODEL_H, width: canvas_w, mask, mask_width: canvas_w }
}

/// Quadratic smoothing matches canvas `quadraticCurveTo` + a final `lineTo`.
fn paint_stroke(buf: &mut [f32], w: usize, h: usize, pts: &[Point], radius: f64) {
    let path = canvas_path(pts);
    for p in &path {
        stamp(buf, w, h, p.x, p.y, radius);
    }
}

fn canvas_path(pts: &[Point]) -> Vec<Point> {
    if pts.len() < 2 {
        return pts.to_vec();
    }
    if pts.len() == 2 {
        return densify(pts[0], pts[1]);
    }
    let mut out: Vec<Point> = Vec::new();
    let mut from = pts[0];
    for i in 1..pts.len() - 1 {
        let ctrl = pts[i];
        let to = Point { x: (pts[i].x + pts[i + 1].x) / 2.0, y: (pts[i].y + pts[i + 1].y) / 2.0 };
        append_quad(&mut out, from, ctrl, to);
        from = to;
    }
    let mut tail = densify(from, pts[pts.len() - 1]);
    if !out.is_empty() {
        tail.remove(0);
    }
    out.append(&mut tail);
    out
}

fn append_quad(out: &mut Vec<Point>, from: Point, ctrl: Point, to: Point) {
    let len = (ctrl.x - from.x).hypot(ctrl.y - from.y) + (to.x - ctrl.x).hypot(to.y - ctrl.y);
    let steps = 2usize.max((len / 0.6).ceil() as usize);
    let start = usize::from(!out.is_empty());
    for s in start..=steps {
        let t = s as f64 / steps as f64;
        let u = 1.0 - t;
        out.push(Point {
            x: u * u * from.x + 2.0 * u * t * ctrl.x + t * t * to.x,
            y: u * u * from.y + 2.0 * u * t * ctrl.y + t * t * to.y,
        });
    }
}

fn densify(a: Point, b: Point) -> Vec<Point> {
    let steps = 1usize.max(((b.x - a.x).hypot(b.y - a.y) / 0.6).ceil() as usize);
    let mut out = Vec::with_capacity(steps + 1);
    for s in 0..=steps {
        let t = s as f64 / steps as f64;
        out.push(Point { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    out
}

fn stamp(buf: &mut [f32], w: usize, h: usize, cx: f64, cy: f64, r: f64) {
    let x0 = 0f64.max((cx - r - 1.0).floor()) as usize;
    let x1 = ((w - 1) as f64).min((cx + r + 1.0).ceil()) as usize;
    let y0 = 0f64.max((cy - r - 1.0).floor()) as usize;
    let y1 = ((h - 1) as f64).min((cy + r + 1.0).ceil()) as usize;
    for y in y0..=y1 {
        for x in x0..=x1 {
            let dist = (x as f64 + 0.5 - cx).hypot(y as f64 + 0.5 - cy);
            let cov = if dist <= r - 0.7 {
                1.0
            } else if dist >= r + 0.7 {
                0.0
            } else {
                (r + 0.7 - dist) / 1.4
            };
            if cov <= 0.0 {
                continue;
            }
            let i = y * w + x;
            if cov > buf[i] as f64 {
                buf[i] = cov as f32;
            }
        }
    }
}

fn blit(src: &[f32], sw: usize, sh: usize, dst: &mut [f32], dst_w: usize, dw: usize, dh: usize) {
    for y in 0..dh {
        let sy = ((y as f64 + 0.5) * sh as f64) / dh as f64 - 0.5;
        let y0 = ((sh - 1) as f64).min(sy.floor().max(0.0)) as usize;
        let y1 = ((sh - 1) as f64).min((y0 + 1) as f64).max(0.0) as usize;
        let fy = sy - y0 as f64;
        for x in 0..dw {
            let sx = ((x as f64 + 0.5) * sw as f64) / dw as f64 - 0.5;
            let x0 = ((sw - 1) as f64).min(sx.floor().max(0.0)) as usize;
            let x1 = ((sw - 1) as f64).min((x0 + 1) as f64).max(0.0) as usize;
            let fx = sx - x0 as f64;
            let v = src[y0 * sw + x0] as f64 * (1.0 - fx) * (1.0 - fy)
                + src[y0 * sw + x1] as f64 * fx * (1.0 - fy)
                + src[y1 * sw + x0] as f64 * (1.0 - fx) * fy
                + src[y1 * sw + x1] as f64 * fx * fy;
            dst[y * dst_w + x] = v as f32;
        }
    }
}
