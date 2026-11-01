//! Circle theorems: from a radius and a few labeled segments around one point, derive the
//! rest — the fourth chord piece (intersecting chords / secants), the tangent length,
//! chord lengths, centre-to-chord distances, central angles, and a canonical picture of
//! the whole configuration. Plus cross inference between circles and named points.

use crate::geometry::{deg, dist2, line_eq_latex, near, nice, Fact, NamedPoint, Shape};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;


fn fact(group: &str, label: &str, value: String, num: Option<f64>, how: &str, why: &str) -> Fact {
    Fact { group: group.into(), label: label.into(), value, num, how: how.into(), why: why.into(), shape: None }
}

fn seg_fact(group: &str, label: &str, v: f64, how: &str, why: &str) -> Fact {
    fact(group, label, nice(v), Some(v), how, why)
}

// ---------------------------------------------------------------------------
// Sparse chord / secant / tangent problems through one point P

#[derive(Deserialize)]
pub struct ChordCross {
    /// Label of the common point, e.g. "P".
    pub p: String,
    /// [["A","B"],["C","D"]] for two chords / secants through P; [["T"],["A","B"]] for a
    /// tangent from P plus a secant.
    pub chords: Vec<Vec<String>>,
    /// Known segment lengths keyed like "PA" (reversed spellings such as "AP" are accepted).
    pub lengths: HashMap<String, f64>,
    /// "in" (弦), "out" (割线), "tan" (切线); None = derive whichever configurations fit.
    pub pos: Option<String>,
}

#[derive(Deserialize)]
pub struct CircleKnown {
    pub r: f64,
    pub cross: ChordCross,
}

/// One drawn segment of the canonical picture (centre at the origin, P on the +x axis).
#[derive(Serialize)]
pub struct DrawSeg {
    pub a: [f64; 2],
    pub b: [f64; 2],
    pub names: [String; 2],
}

#[derive(Serialize)]
pub struct CircleCase {
    pub facts: Vec<Fact>,
    pub note: String,
    pub center: [f64; 2],
    pub p: [f64; 2],
    pub lines: Vec<DrawSeg>,
}

#[derive(Serialize)]
pub struct CircleResult {
    pub cases: Vec<CircleCase>,
    pub error: Option<String>,
}

fn get_len(lengths: &HashMap<String, f64>, p: &str, end: &str) -> Option<f64> {
    let k = format!("{}{}", p, end);
    let rev: String = k.chars().rev().collect();
    lengths.get(&k).or_else(|| lengths.get(&rev)).copied()
}

/// Chord geometry shared by every case: centre-to-chord distance, central angle,
/// inscribed angle on the same arc, sagitta.
fn chord_metrics(group: &str, r: f64, na: &str, nb: &str, a: [f64; 2], b: [f64; 2], chord: f64) -> Vec<Fact> {
    let mut out = Vec::new();
    if chord <= 1e-9 {
        return out;
    }
    let half = chord / 2.0;
    let d = (r * r - half * half).max(0.0).sqrt();
    let foot = [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0];
    out.push(seg_fact(group, &format!("d(O, {}{})", na, nb), d, "\\sqrt{r^2 - \\left(\\frac{|\\text{弦}|}{2}\\right)^2}", "弦心距：圆心到弦的垂线段").with(Shape::Segment { x1: 0.0, y1: 0.0, x2: foot[0], y2: foot[1], label: format!("弦心距 {}", na) }));
    let theta = 2.0 * (half / r).clamp(-1.0, 1.0).asin();
    out.push(fact(group, &format!("\\angle O{}{}", na, nb), deg(theta), Some(theta), &format!("\\sin\\frac{{\\angle O{}{}}}{{2}} = \\frac{{|{}{}|}}{{2r}}", na, nb, na, nb), "圆心角与弦"));
    out.push(fact(group, &format!("\\text{{圆周角}}_{{{}{}}}", na, nb), deg(theta / 2.0), Some(theta / 2.0), &format!("\\frac{{1}}{{2}}\\angle O{}{}", na, nb), "圆周角定理：同弧上的圆周角"));
    out.push(seg_fact(group, &format!("\\text{{弓形高}}_{{{}{}}}", na, nb), r - d, "r - d(O,\\text{弦})", "弓形的高"));
    out
}

/// The intersecting-chords (inside) / secant-secant (outside) configuration.
/// Ok(None) = impossible in this mode; Err = the given lengths contradict the theorem.
fn chord_case(k: &CircleKnown, inside: bool) -> Result<Option<CircleCase>, String> {
    let cross = &k.cross;
    let r = k.r;
    let p = cross.p.clone();
    let c0 = &cross.chords[0];
    let c1 = &cross.chords[1];
    if c0.len() != 2 || c1.len() != 2 {
        return Err("每条弦要有两个端点，例如 弦 AB、CD 交于 P".into());
    }
    let (ca, cb) = (c0[0].clone(), c0[1].clone());
    let (cc, cd) = (c1[0].clone(), c1[1].clone());
    let mut a1 = get_len(&cross.lengths, &p, &ca);
    let mut b1 = get_len(&cross.lengths, &p, &cb);
    let mut a2 = get_len(&cross.lengths, &p, &cc);
    let mut b2 = get_len(&cross.lengths, &p, &cd);
    if [a1, b1, a2, b2].iter().filter(|v| v.is_some()).count() < 3 {
        return Err("已知长度不够：相交弦需要三条线段长，例如 PA = 2, PB = 6, PC = 4".into());
    }
    if [a1, b1, a2, b2].iter().flatten().any(|v| *v <= 0.0) {
        return Err("线段长度必须是正数".into());
    }
    // fill the single missing piece from the other chord's product: PA·PB = PC·PD
    let mut derived: Option<(String, f64, String)> = None; // label, value, how
    match (a1, b1, a2, b2) {
        (Some(_), Some(_), Some(_), Some(_)) => {}
        (Some(x), Some(y), Some(u), None) => {
            let v = x * y / u;
            b2 = Some(v);
            derived = Some((format!("{}{}", p, cd), v, format!("\\frac{{{}{} \\cdot {}{}}}{{{}{}}}", p, ca, p, cb, p, cc)));
        }
        (Some(x), Some(y), None, Some(u)) => {
            let v = x * y / u;
            a2 = Some(v);
            derived = Some((format!("{}{}", p, cc), v, format!("\\frac{{{}{} \\cdot {}{}}}{{{}{}}}", p, ca, p, cb, p, cd)));
        }
        (Some(x), None, Some(u), Some(v)) => {
            let w = u * v / x;
            b1 = Some(w);
            derived = Some((format!("{}{}", p, cb), w, format!("\\frac{{{}{} \\cdot {}{}}}{{{}{}}}", p, cc, p, cd, p, ca)));
        }
        (None, Some(y), Some(u), Some(v)) => {
            let w = u * v / y;
            a1 = Some(w);
            derived = Some((format!("{}{}", p, ca), w, format!("\\frac{{{}{} \\cdot {}{}}}{{{}{}}}", p, cc, p, cd, p, cb)));
        }
        _ => return Err("已知长度不够：相交弦需要三条线段长".into()),
    }
    let (a1, b1, a2, b2) = (a1.unwrap(), b1.unwrap(), a2.unwrap(), b2.unwrap());
    let prod = a1 * b1;
    if (a2 * b2 - prod).abs() > 1e-6 * (1.0 + prod.abs()) {
        return Err(format!("{}{}·{}{} = {}，但 {}{}·{}{} = {}，与定理矛盾，请检查数值", p, ca, p, cb, nice(prod), p, cc, p, cd, nice(a2 * b2)));
    }
    let group = if inside { "圆内的弦" } else { "圆外的割线" };
    let theorem_why = if inside { "圆内两条弦相交：PA·PB = PC·PD" } else { "圆外一点的两条割线：PA·PB = PC·PD" };

    let op2 = if inside { r * r - prod } else { r * r + prod };
    if op2 <= 1e-9 * (1.0 + r * r) {
        return Ok(None); // P is not strictly inside the circle
    }
    let op = op2.sqrt();
    let chord1 = if inside { a1 + b1 } else { (b1 - a1).abs() };
    let chord2 = if inside { a2 + b2 } else { (b2 - a2).abs() };
    if chord1 > 2.0 * r * (1.0 + 1e-9) || chord2 > 2.0 * r * (1.0 + 1e-9) {
        return Ok(None); // a chord cannot exceed the diameter
    }

    let mut facts = Vec::new();
    if let Some((label, value, how)) = derived {
        facts.push(seg_fact(group, &label, value, &how, theorem_why));
    }
    facts.push(fact(group, &format!("{}{} \\cdot {}{}", p, ca, p, cb), nice(prod), Some(prod), &format!("= {}{} \\cdot {}{} = {}", p, cc, p, cd, nice(a2 * b2)), theorem_why));

    // canonical picture: centre at the origin, P on the +x axis
    let pc = [op, 0.0];
    let mut lines = Vec::new();
    for (ends, a, b, uy_sign, chord) in [(&c0, a1, b1, 1.0, chord1), (&c1, a2, b2, -1.0, chord2)] {
        let u: [f64; 2] = if op < 1e-9 {
            // P is the centre itself: both chords are diameters
            if uy_sign > 0.0 { [1.0, 0.0] } else { [0.0, 1.0] }
        } else if inside {
            let ux = (a - b) / (2.0 * op);
            [ux, uy_sign * (1.0 - ux * ux).max(0.0).sqrt()]
        } else {
            let ux = -(a + b) / (2.0 * op);
            [ux, uy_sign * (1.0 - ux * ux).max(0.0).sqrt()]
        };
        let (e1, e2) = if inside {
            ([pc[0] - a * u[0], pc[1] - a * u[1]], [pc[0] + b * u[0], pc[1] + b * u[1]])
        } else {
            ([pc[0] + a * u[0], pc[1] + a * u[1]], [pc[0] + b * u[0], pc[1] + b * u[1]])
        };
        lines.push(DrawSeg { a: e1, b: e2, names: [ends[0].clone(), ends[1].clone()] });
        let how = if inside {
            format!("{}{} + {}{}", p, ends[0], p, ends[1])
        } else {
            format!("|{}{} - {}{}|", p, ends[1], p, ends[0])
        };
        facts.push(seg_fact(group, &format!("|{}{}|", ends[0], ends[1]), chord, &how, if inside { "弦长 = 两段之和" } else { "弦长 = 两段之差" }).with(Shape::Segment { x1: e1[0], y1: e1[1], x2: e2[0], y2: e2[1], label: format!("{}{}", ends[0], ends[1]) }));
        facts.extend(chord_metrics(group, r, &ends[0], &ends[1], e1, e2, chord));
    }
    facts.push(seg_fact(group, &format!("|O{}|", p), op, &format!("OP^2 = r^2 {} {}{} \\cdot {}{}", if inside { "-" } else { "+" }, p, ca, p, cb), "点的幂：OP² 与两段乘积").with(Shape::Point { x: pc[0], y: pc[1], label: format!("{}（{}）", p, if inside { "圆内" } else { "圆外" }) }));

    let note = if inside {
        format!("{}{}、{}{} 是两条弦，交于 {}（相交弦定理）", ca, cb, cc, cd, p)
    } else {
        format!("{}{}、{}{} 是从 {} 出发的两条割线（割线定理）", ca, cb, cc, cd, p)
    };
    Ok(Some(CircleCase { facts, note, center: [0.0, 0.0], p: pc, lines }))
}

/// Tangent + secant from an outside point: PT² = PA·PB (切割线定理).
fn tangent_case(k: &CircleKnown) -> Result<Option<CircleCase>, String> {
    let cross = &k.cross;
    let r = k.r;
    if cross.chords[0].len() != 1 || cross.chords[1].len() != 2 {
        return Err("切线的写法：切线 PT、割线 PAB（P 为公共点）".into());
    }
    let p = cross.p.clone();
    let t = cross.chords[0][0].clone();
    let (ca, cb) = (cross.chords[1][0].clone(), cross.chords[1][1].clone());
    let mut pt_len = get_len(&cross.lengths, &p, &t);
    let mut a = get_len(&cross.lengths, &p, &ca);
    let mut b = get_len(&cross.lengths, &p, &cb);
    if [pt_len, a, b].iter().filter(|v| v.is_some()).count() < 2 {
        return Err("已知长度不够：切线问题需要两个长度，例如 PA = 2, PB = 6".into());
    }
    if [pt_len, a, b].iter().flatten().any(|v| *v <= 0.0) {
        return Err("线段长度必须是正数".into());
    }
    let prod = match (a, b, pt_len) {
        (Some(x), Some(y), _) => x * y,
        (_, _, Some(t)) => t * t,
        _ => return Err("已知长度不够：切线问题需要两个长度".into()),
    };
    let mut derived: Vec<(String, f64, String)> = Vec::new(); // label, value, how
    if pt_len.is_none() {
        let v = prod.sqrt();
        pt_len = Some(v);
        derived.push((format!("{}{}", p, t), v, format!("\\sqrt{{{}{} \\cdot {}{}}}", p, ca, p, cb)));
    }
    if a.is_none() {
        let v = prod / b.unwrap();
        a = Some(v);
        derived.push((format!("{}{}", p, ca), v, format!("\\frac{{{}{}^2}}{{{}{}}}", p, t, p, cb)));
    }
    if b.is_none() {
        let v = prod / a.unwrap();
        b = Some(v);
        derived.push((format!("{}{}", p, cb), v, format!("\\frac{{{}{}^2}}{{{}{}}}", p, t, p, ca)));
    }
    let (pt_len, a, b) = (pt_len.unwrap(), a.unwrap(), b.unwrap());
    if (pt_len * pt_len - prod).abs() > 1e-6 * (1.0 + prod) {
        return Err(format!("{}{}² = {}，但 {}{}·{}{} = {}，与切割线定理矛盾，请检查数值", p, t, nice(pt_len * pt_len), p, ca, p, cb, nice(prod)));
    }
    let op = (r * r + prod).sqrt();
    let chord = (b - a).abs();
    if chord > 2.0 * r * (1.0 + 1e-9) {
        return Ok(None);
    }

    let pc = [op, 0.0];
    let mut facts = Vec::new();
    if derived.is_empty() {
        // PT was given: show it as a derived quantity of PA·PB anyway
        facts.push(seg_fact("切线与割线", &format!("{}{}", p, t), pt_len, &format!("\\sqrt{{{}{} \\cdot {}{}}}", p, ca, p, cb), "切割线定理：PT² = PA·PB"));
    }
    for (label, value, how) in derived {
        facts.push(seg_fact("切线与割线", &label, value, &how, "切割线定理"));
    }
    facts.push(fact("切线与割线", &format!("{}{}^2", p, t), nice(prod), Some(prod), &format!("= {}{} \\cdot {}{}", p, ca, p, cb), "切割线定理"));
    let ux = if op > 1e-9 { -(a + b) / (2.0 * op) } else { -1.0 };
    let uy = (1.0 - ux * ux).max(0.0).sqrt();
    let e1 = [pc[0] + a * ux, pc[1] + a * uy];
    let e2 = [pc[0] + b * ux, pc[1] + b * uy];
    let tangent_pt = [r * r / op, r * pt_len / op];
    if chord > 1e-9 {
        facts.push(seg_fact("切线与割线", &format!("|{}{}|", ca, cb), chord, &format!("|{}{} - {}{}|", p, cb, p, ca), "弦长 = 两段之差").with(Shape::Segment { x1: e1[0], y1: e1[1], x2: e2[0], y2: e2[1], label: format!("{}{}", ca, cb) }));
        facts.extend(chord_metrics("切线与割线", r, &ca, &cb, e1, e2, chord));
    }
    facts.push(seg_fact("切线与割线", &format!("|O{}|", p), op, &format!("OP^2 = r^2 + {}{}^2", p, t), "点的幂：割线与切线").with(Shape::Point { x: pc[0], y: pc[1], label: format!("{}（圆外）", p) }));
    facts.push(fact("切线与割线", &format!("O{} \\perp {}{}", t, p, t), "\\checkmark".into(), None, "切线垂直于过切点的半径", "切线的性质").with(Shape::Segment { x1: 0.0, y1: 0.0, x2: tangent_pt[0], y2: tangent_pt[1], label: format!("O{}", t) }));

    let lines = vec![
        DrawSeg { a: pc, b: tangent_pt, names: [p.clone(), t.clone()] },
        DrawSeg { a: pc, b: e1, names: [p.clone(), ca.clone()] },
        DrawSeg { a: e1, b: e2, names: [ca.clone(), cb.clone()] },
    ];
    Ok(Some(CircleCase { facts, note: format!("{}{} 是切线，{}{}{} 是割线（切割线定理）", p, t, p, ca, cb), center: [0.0, 0.0], p: pc, lines }))
}

pub fn circle_solve(k: &CircleKnown) -> CircleResult {
    let err = |m: String| CircleResult { cases: vec![], error: Some(m) };
    if k.r <= 0.0 {
        return err("半径必须是正数".into());
    }
    let cross = &k.cross;
    if cross.chords.len() != 2 {
        return err("需要两条弦（或一条切线 + 一条割线）".into());
    }
    let pos = cross.pos.as_deref();
    let mut cases = Vec::new();
    let mut hard: Option<String> = None;
    {
        let mut try_case = |res: Result<Option<CircleCase>, String>| match res {
            Ok(Some(c)) => cases.push(c),
            Ok(None) => {}
            Err(m) => hard = Some(m),
        };
        match pos {
            Some("tan") => try_case(tangent_case(k)),
            Some("in") => try_case(chord_case(k, true)),
            Some("out") => try_case(chord_case(k, false)),
            _ => {
                try_case(chord_case(k, true));
                try_case(chord_case(k, false));
            }
        }
    }
    if cases.is_empty() {
        err(hard.unwrap_or_else(|| "这些长度与半径构不成可行的图形（弦长不能超过直径 2r，且 P 的位置要和长度匹配）".into()))
    } else {
        CircleResult { cases, error: None }
    }
}

// ---------------------------------------------------------------------------
// Cross inference: a circle together with named points

#[derive(Deserialize)]
pub struct NamedCircle {
    pub name: String,
    pub cx: f64,
    pub cy: f64,
    pub r: f64,
}

/// Angle at v between rays v→u and v→w, in [0, π].
fn ang_at(v: [f64; 2], u: [f64; 2], w: [f64; 2]) -> f64 {
    let a = [u[0] - v[0], u[1] - v[1]];
    let b = [w[0] - v[0], w[1] - v[1]];
    let cr = (a[0] * b[1] - a[1] * b[0]).abs();
    let dt = a[0] * b[0] + a[1] * b[1];
    cr.atan2(dt)
}

/// Intersection of the supporting lines a→b and c→d.
fn seg_isect(a: [f64; 2], b: [f64; 2], c: [f64; 2], d: [f64; 2]) -> Option<[f64; 2]> {
    let (x1, y1, x2, y2) = (b[0] - a[0], b[1] - a[1], d[0] - c[0], d[1] - c[1]);
    let scale = x1.hypot(y1) * x2.hypot(y2);
    if scale < 1e-12 {
        return None;
    }
    let den = x1 * y2 - y1 * x2;
    if den.abs() < 1e-12 * scale {
        return None;
    }
    let t = ((c[0] - a[0]) * y2 - (c[1] - a[1]) * x2) / den;
    Some([a[0] + t * x1, a[1] + t * y1])
}

/// Is q strictly inside segment ab (by the parameter along the longer axis)?
fn on_seg(q: [f64; 2], a: [f64; 2], b: [f64; 2]) -> bool {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let t = if dx.abs() > dy.abs() { (q[0] - a[0]) / dx } else { (q[1] - a[1]) / dy };
    t.is_finite() && t > 1e-9 && t < 1.0 - 1e-9
}

type OnPair = ((String, [f64; 2]), (String, [f64; 2]));

pub fn circles_analyze(circles: &[NamedCircle], points: &[NamedPoint]) -> Vec<Fact> {
    let mut out = Vec::new();
    for c in circles {
        if c.r <= 0.0 {
            continue;
        }
        let ctr = [c.cx, c.cy];
        let g = format!("⊙{} 与各点", c.name);
        let mut on: Vec<(String, [f64; 2])> = Vec::new();
        for p in points {
            if p.p.len() > 2 || p.p.is_empty() {
                continue;
            }
            let q = [p.p[0], *p.p.get(1).unwrap_or(&0.0)];
            let d = dist2(ctr, q);
            let pow = d * d - c.r * c.r;
            out.push(seg_fact(&g, &format!("|O{}|", p.name), d, "\\sqrt{(x-a)^2 + (y-b)^2}", &format!("到 ⊙{} 圆心的距离", c.name)));
            out.push(fact(&g, &format!("O{}^2 - r^2", p.name), nice(pow), Some(pow), "|OP|^2 - r^2", &format!("点 {} 的幂", p.name)));
            let pos = if near(d, c.r) {
                "在圆上"
            } else if d < c.r {
                "在圆内"
            } else {
                "在圆外"
            };
            out.push(fact(&g, &format!("{} \\in \\odot {}", p.name, c.name), format!("\\text{{{}}}", pos), None, "比较 |OP| 与 r", "点的位置"));
            if pow > 1e-9 * (1.0 + c.r * c.r) {
                let t = pow.sqrt();
                out.push(seg_fact(&g, &format!("\\text{{切线长}}_{{{}}}", p.name), t, "\\sqrt{OP^2 - r^2}", "从圆外一点引切线的长度").with(Shape::Point { x: q[0], y: q[1], label: format!("{}（圆外）", p.name) }));
            }
            if near(d, c.r) {
                on.push((p.name.clone(), q));
            }
        }
        // chords between on-circle points
        let n = on.len().min(8);
        let mut chords: Vec<OnPair> = Vec::new();
        'chords: for i in 0..n {
            for j in i + 1..n {
                chords.push((on[i].clone(), on[j].clone()));
                if chords.len() >= 10 {
                    break 'chords;
                }
            }
        }
        for ((na, a), (nb, b)) in &chords {
            let len = dist2(*a, *b);
            out.push(seg_fact(&g, &format!("|{}{}|", na, nb), len, "\\sqrt{\\Delta x^2 + \\Delta y^2}", &format!("⊙{} 的弦", c.name)).with(Shape::Segment { x1: a[0], y1: a[1], x2: b[0], y2: b[1], label: format!("{}{}", na, nb) }));
            if len > 1e-9 && len <= 2.0 * c.r * (1.0 + 1e-9) {
                out.extend(chord_metrics(&g, c.r, na, nb, *a, *b, len));
                if near(len, 2.0 * c.r) {
                    out.push(fact(&g, &format!("{}{} \\text{{ 是直径}}", na, nb), "\\checkmark".into(), None, "|AB| = 2r", "直径所对的圆周角是直角"));
                }
            }
        }
        // inscribed angles: a third on-circle point looking at a chord
        let mut inscribed = 0usize;
        'inscribed: for i in 0..n {
            for j in 0..n {
                for t in 0..n {
                    if inscribed >= 8 {
                        break 'inscribed;
                    }
                    if i == j || t == i || t == j {
                        continue;
                    }
                    inscribed += 1;
                    let (na, a) = &on[i];
                    let (nb, b) = &on[j];
                    let (nc, cpt) = &on[t];
                    let beta = ang_at(*cpt, *a, *b);
                    if beta < 1e-9 {
                        continue;
                    }
                    let central = 2.0 * ((dist2(*a, *b) / 2.0) / c.r).clamp(-1.0, 1.0).asin();
                    let how = if near(2.0 * beta, central) {
                        format!("\\angle {}{}{} = \\frac{{1}}{{2}}\\angle O{}{}", na, nc, nb, na, nb)
                    } else {
                        format!("\\angle {}{}{} = \\frac{{1}}{{2}}(360^\\circ - \\angle O{}{})", na, nc, nb, na, nb)
                    };
                    out.push(fact(&g, &format!("\\angle {}{}{}", na, nc, nb), deg(beta), Some(beta), &how, "圆周角定理：同弧所对的圆周角是圆心角的一半"));
                }
            }
        }
        // two chords crossing inside, or two secants meeting outside
        let mut crossings = 0usize;
        'cross: for ci in 0..chords.len() {
            for cj in ci + 1..chords.len() {
                if crossings >= 4 {
                    break 'cross;
                }
                let ((na, a), (nb, b)) = &chords[ci];
                let ((nc, cpt), (nd, dpt)) = &chords[cj];
                if na == nc || na == nd || nb == nc || nb == nd {
                    continue;
                }
                let Some(q) = seg_isect(*a, *b, *cpt, *dpt) else { continue };
                let (in1, in2) = (on_seg(q, *a, *b), on_seg(q, *cpt, *dpt));
                if in1 != in2 {
                    continue; // one line crossing inside and one outside cannot share a circle
                }
                crossings += 1;
                let (qa, qb) = (dist2(q, *a), dist2(q, *b));
                let (qc, qd) = (dist2(q, *cpt), dist2(q, *dpt));
                let (prod1, prod2) = (qa * qb, qc * qd);
                if in1 {
                    out.push(fact(&g, &format!("\\text{{相交弦}}: {}{} \\cap {}{}", na, nb, nc, nd), nice(prod1), Some(prod1), &format!("|{}Q| \\cdot |{}Q| = |{}Q| \\cdot |{}Q| = {}", nc, nd, na, nb, nice(prod2)), "相交弦定理").with(Shape::Point { x: q[0], y: q[1], label: "弦交点".into() }));
                    let oq2 = c.r * c.r - prod1;
                    if oq2 > 1e-9 {
                        out.push(seg_fact(&g, "|OQ|", oq2.sqrt(), "OQ^2 = r^2 - QA \\cdot QB", "点的幂（圆内）").with(Shape::Point { x: q[0], y: q[1], label: "弦交点".into() }));
                    }
                } else {
                    out.push(fact(&g, &format!("\\text{{割线}}: {}{},{}{} 与 {}{},{}{}", na, nb, nc, nd, nc, nd, na, nb), nice(prod1), Some(prod1), &format!("|{}Q| \\cdot |{}Q| = |{}Q| \\cdot |{}Q| = {}", nc, nd, na, nb, nice(prod2)), "割线定理").with(Shape::Point { x: q[0], y: q[1], label: "割线交点".into() }));
                }
            }
        }
    }
    // Radical axis of each pair: subtract the two circle equations.
    for i in 0..circles.len() {
        for j in i + 1..circles.len() {
            let (a, b) = (&circles[i], &circles[j]);
            if a.r <= 0.0 || b.r <= 0.0 {
                continue;
            }
            let g = "两圆根轴";
            let (c1, c2) = ([a.cx, a.cy], [b.cx, b.cy]);
            let (nx, ny) = (c2[0] - c1[0], c2[1] - c1[1]);
            let ln = nx.hypot(ny);
            if ln < 1e-12 {
                let same = (a.r - b.r).abs() < 1e-9;
                out.push(fact(g, &format!("\\odot {},\\ \\odot {}", a.name, b.name), format!("\\text{{{}}}", if same { "同心等半径（重合）" } else { "同心不等半径（无根轴）" }), None, "O_1 = O_2", "两圆圆心重合"));
                continue;
            }
            let rhs = (c2[0] * c2[0] + c2[1] * c2[1] - c1[0] * c1[0] - c1[1] * c1[1] + a.r * a.r - b.r * b.r) / 2.0;
            out.push(fact(
                g,
                &format!("l_{{{}{}}}", a.name, b.name),
                line_eq_latex(nx, ny, rhs),
                None,
                "(O_2 - O_1)\\cdot X = \\frac{|O_2|^2 - |O_1|^2 + r_1^2 - r_2^2}{2}",
                "两圆方程相减得根轴",
            ));
            out.push(seg_fact(g, &format!("|O_{}O_{}|", a.name, b.name), ln, "\\sqrt{(a_2-a_1)^2 + (b_2-b_1)^2}", "圆心距"));
            let signed = (nx * c1[0] + ny * c1[1] - rhs) / ln;
            let h = signed.abs();
            let rho2 = a.r * a.r - h * h;
            let (sum, diff) = (a.r + b.r, (a.r - b.r).abs());
            let rel = if near(ln, sum) {
                "外切"
            } else if near(ln, diff) {
                "内切"
            } else if ln > sum {
                "外离"
            } else if ln + 1e-9 < diff {
                "内含"
            } else {
                "相交"
            };
            out.push(fact(g, &format!("\\odot {} ,\\ \\odot {}", a.name, b.name), format!("\\text{{{rel}}}"), None, "|O_1O_2| \\text{ 与 } r_1\\pm r_2", "两圆位置关系"));
            if rho2 > 1e-9 {
                let chord = 2.0 * rho2.sqrt();
                out.push(seg_fact(g, &format!("|\\text{{公共弦}}_{{{}{}}}|", a.name, b.name), chord, "2\\sqrt{r_1^2 - d^2}", "公共弦长（落在根轴上）"));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solve(r: f64, chords: Vec<Vec<&str>>, lengths: &[(&str, f64)], pos: Option<&str>) -> CircleResult {
        circle_solve(&CircleKnown {
            r,
            cross: ChordCross {
                p: "P".into(),
                chords: chords.into_iter().map(|c| c.into_iter().map(String::from).collect()).collect(),
                lengths: lengths.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
                pos: pos.map(String::from),
            },
        })
    }

    #[test]
    fn intersecting_chords() {
        // r = 5, PA = 2, PB = 6, PC = 4 → PD = 3, AB = 8, d(O, AB) = 3, OP = √13
        let res = solve(5.0, vec![vec!["A", "B"], vec!["C", "D"]], &[("PA", 2.0), ("PB", 6.0), ("PC", 4.0)], Some("in"));
        assert!(res.error.is_none(), "{:?}", res.error);
        assert_eq!(res.cases.len(), 1);
        let f = |label: &str| res.cases[0].facts.iter().find(|x| x.label == label).unwrap().num.unwrap();
        assert!((f("PD") - 3.0).abs() < 1e-9);
        assert!((f("|AB|") - 8.0).abs() < 1e-9);
        assert!((f("d(O, AB)") - 3.0).abs() < 1e-9);
        assert!((f("|OP|") - 13f64.sqrt()).abs() < 1e-9);
        let ang = res.cases[0].facts.iter().find(|x| x.label == "\\angle OAB").unwrap().num.unwrap();
        assert!((ang - 2.0 * 0.8f64.asin()).abs() < 1e-9);
        // canonical endpoints sit on the circle: |P ± half·u| = r
        let line = &res.cases[0].lines[0];
        for e in [line.a, line.b] {
            assert!((e[0].hypot(e[1]) - 5.0).abs() < 1e-9, "endpoint not on circle: {e:?}");
        }
        let pp = res.cases[0].p;
        assert!((dist2(pp, line.a) - 2.0).abs() < 1e-9, "PA should be 2");
        assert!((dist2(pp, line.b) - 6.0).abs() < 1e-9, "PB should be 6");
    }

    #[test]
    fn secants_from_outside() {
        // same lengths but P outside: PD = 3, chord AB = 4, OP = √37
        let res = solve(5.0, vec![vec!["A", "B"], vec!["C", "D"]], &[("PA", 2.0), ("PB", 6.0), ("PC", 4.0)], Some("out"));
        assert!(res.error.is_none(), "{:?}", res.error);
        let f = |label: &str| res.cases[0].facts.iter().find(|x| x.label == label).unwrap().num.unwrap();
        assert!((f("PD") - 3.0).abs() < 1e-9);
        assert!((f("|AB|") - 4.0).abs() < 1e-9);
        assert!((f("|OP|") - 37f64.sqrt()).abs() < 1e-9);
        let line = &res.cases[0].lines[0];
        for e in [line.a, line.b] {
            assert!((e[0].hypot(e[1]) - 5.0).abs() < 1e-9, "endpoint not on circle: {e:?}");
        }
        let pp = res.cases[0].p;
        assert!((dist2(pp, line.a) - 2.0).abs() < 1e-9);
        assert!((dist2(pp, line.b) - 6.0).abs() < 1e-9);
    }

    #[test]
    fn auto_positions_both_cases() {
        let res = solve(5.0, vec![vec!["A", "B"], vec!["C", "D"]], &[("PA", 2.0), ("PB", 6.0), ("PC", 4.0)], None);
        assert!(res.error.is_none());
        assert_eq!(res.cases.len(), 2);
    }

    #[test]
    fn too_far_inside_is_dropped() {
        // PA·PB = 60 > r² = 25: P cannot be inside, but the secant reading survives
        let res = solve(5.0, vec![vec!["A", "B"], vec!["C", "D"]], &[("PA", 6.0), ("PB", 10.0), ("PC", 5.0)], None);
        assert!(res.error.is_none(), "{:?}", res.error);
        assert_eq!(res.cases.len(), 1);
        let f = |label: &str| res.cases[0].facts.iter().find(|x| x.label == label).unwrap().num.unwrap();
        assert!((f("PD") - 12.0).abs() < 1e-9);
    }

    #[test]
    fn tangent_and_secant() {
        // PT² = PA·PB = 12 → PT = 2√3, OP = √37
        let res = solve(5.0, vec![vec!["T"], vec!["A", "B"]], &[("PA", 2.0), ("PB", 6.0)], Some("tan"));
        assert!(res.error.is_none(), "{:?}", res.error);
        let f = |label: &str| res.cases[0].facts.iter().find(|x| x.label == label).unwrap().num.unwrap();
        assert!((f("PT") - 12f64.sqrt()).abs() < 1e-9);
        assert!((f("|OP|") - 37f64.sqrt()).abs() < 1e-9);
        // derive PB from PT and PA instead
        let res = solve(5.0, vec![vec!["T"], vec!["A", "B"]], &[("PT", 12f64.sqrt()), ("PA", 2.0)], Some("tan"));
        assert!(res.error.is_none(), "{:?}", res.error);
        let f = |label: &str| res.cases[0].facts.iter().find(|x| x.label == label).unwrap().num.unwrap();
        assert!((f("PB") - 6.0).abs() < 1e-9);
        // tangent point is on the circle
        let tline = &res.cases[0].lines[0];
        assert!((tline.b[0].hypot(tline.b[1]) - 5.0).abs() < 1e-9);
    }

    #[test]
    fn contradictory_lengths() {
        let res = solve(5.0, vec![vec!["A", "B"], vec!["C", "D"]], &[("PA", 2.0), ("PB", 6.0), ("PC", 4.0), ("PD", 7.0)], None);
        assert!(res.error.is_some());
    }

    #[test]
    fn circle_with_points() {
        let circles = vec![NamedCircle { name: "O".into(), cx: 0.0, cy: 0.0, r: 5.0 }];
        let pts = vec![
            NamedPoint { name: "A".into(), p: vec![3.0, 4.0] },
            NamedPoint { name: "B".into(), p: vec![0.0, 5.0] },
            NamedPoint { name: "C".into(), p: vec![-4.0, 3.0] },
            NamedPoint { name: "D".into(), p: vec![7.0, 0.0] },
        ];
        let out = circles_analyze(&circles, &pts);
        let get = |label: &str| out.iter().find(|x| x.label == label).unwrap();
        // chord AB: |AB| = √10
        assert!((get("|AB|").num.unwrap() - 10f64.sqrt()).abs() < 1e-9);
        // power of D: 49 − 25 = 24, tangent length √24
        assert!((get("OD^2 - r^2").num.unwrap() - 24.0).abs() < 1e-9);
        assert!((get("\\text{切线长}_{D}").num.unwrap() - 24f64.sqrt()).abs() < 1e-9);
        // inscribed angle ∠ACB = ½∠AOB ≈ 18.435°
        let ins = get("\\angle ACB").num.unwrap();
        let central = 2.0 * ((10f64.sqrt() / 2.0) / 5.0).asin();
        assert!((ins - central / 2.0).abs() < 1e-9, "inscribed {ins} vs central {central}");
        // C is on the circle
        assert!(out.iter().any(|x| x.label == "C \\in \\odot O" && x.value.contains("圆上")));
    }

    #[test]
    fn radical_axis_of_two_circles() {
        // unit circles at (0,0) and (1,0): radical axis x = 1/2, common chord √3
        let circles = vec![
            NamedCircle { name: "A".into(), cx: 0.0, cy: 0.0, r: 1.0 },
            NamedCircle { name: "B".into(), cx: 1.0, cy: 0.0, r: 1.0 },
        ];
        let out = circles_analyze(&circles, &[]);
        let axis = out.iter().find(|f| f.label == "l_{AB}").unwrap();
        assert!(axis.value.contains("\\frac{1}{2}") || axis.value.contains("0.5"), "axis = {}", axis.value);
        let chord = out.iter().find(|f| f.label == "|\\text{公共弦}_{AB}|").unwrap();
        assert!((chord.num.unwrap() - 3f64.sqrt()).abs() < 1e-9, "chord = {}", chord.value);
        assert!(out.iter().any(|f| f.value.contains("相交")));
        // separate equal circles: x = 3/2, no chord
        let circles = vec![
            NamedCircle { name: "A".into(), cx: 0.0, cy: 0.0, r: 1.0 },
            NamedCircle { name: "B".into(), cx: 3.0, cy: 0.0, r: 1.0 },
        ];
        let out = circles_analyze(&circles, &[]);
        let axis = out.iter().find(|f| f.label == "l_{AB}").unwrap();
        assert!(axis.value.contains("\\frac{3}{2}"), "axis = {}", axis.value);
        assert!(out.iter().all(|f| f.label != "|\\text{公共弦}_{AB}|"));
        assert!(out.iter().any(|f| f.value.contains("外离")));
    }
}
