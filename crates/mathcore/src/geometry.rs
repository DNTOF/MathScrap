//! Geometry inference: given partial data, derive as many quantities as possible.
//! Every result is a `Fact` so the UI can render a uniform "已知 → 推出" list.

use crate::numeric::{clean, solve_linear_pub};
use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Shape {
    Point { x: f64, y: f64, label: String },
    Point3 { x: f64, y: f64, z: f64, label: String },
    Circle { cx: f64, cy: f64, r: f64, label: String },
    Segment { x1: f64, y1: f64, x2: f64, y2: f64, label: String },
    Line3 { px: f64, py: f64, pz: f64, dx: f64, dy: f64, dz: f64, label: String },
    Arrow3 { x: f64, y: f64, z: f64, label: String },
}

#[derive(Serialize, Clone, Debug)]
pub struct Fact {
    /// section heading, e.g. "边长", "角", "面积与周长"
    pub group: String,
    /// LaTeX label, e.g. "c" or "\\angle A"
    pub label: String,
    /// LaTeX value, e.g. "5" or "3\\sqrt{2} \\approx 4.2426"
    pub value: String,
    pub num: Option<f64>,
    /// LaTeX formula used
    pub how: String,
    /// short Chinese reason, e.g. "余弦定理"
    pub why: String,
    pub shape: Option<Shape>,
}

fn fact(group: &str, label: &str, value: String, num: Option<f64>, how: &str, why: &str) -> Fact {
    Fact { group: group.into(), label: label.into(), value, num, how: how.into(), why: why.into(), shape: None }
}

impl Fact {
    fn with(mut self, s: Shape) -> Self {
        self.shape = Some(s);
        self
    }
}

// ---------------------------------------------------------------------------
// Number display helpers

pub fn dec(v: f64) -> String {
    let v = clean(v);
    if v.fract() == 0.0 && v.abs() < 1e12 {
        return format!("{}", v as i64);
    }
    let s = format!("{:.4}", v);
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s == "-0" { "0".into() } else { s.into() }
}

fn exact_form(v: f64) -> Option<String> {
    let v = clean(v);
    if v.fract() == 0.0 {
        return None;
    }
    let sign = if v < 0.0 { "-" } else { "" };
    let a = v.abs();
    // p/q
    for q in 2..=12u32 {
        let p = a * q as f64;
        if (p - p.round()).abs() < 1e-9 {
            return Some(format!("{}\\frac{{{}}}{{{}}}", sign, p.round() as i64, q));
        }
    }
    // k·√m / q
    let sq = a * a;
    for q in 1..=6u32 {
        let n = sq * (q * q) as f64;
        if (n - n.round()).abs() < 1e-7 && n.round() < 100000.0 {
            let n = n.round() as u64;
            let (k, m) = simplify_sqrt(n);
            if m == 1 {
                continue;
            }
            let num = if k == 1 { format!("\\sqrt{{{}}}", m) } else { format!("{}\\sqrt{{{}}}", k, m) };
            return Some(if q == 1 { format!("{}{}", sign, num) } else { format!("{}\\frac{{{}}}{{{}}}", sign, num, q) });
        }
    }
    // pi multiples
    let t = a / PI;
    for q in 1..=12u32 {
        let p = t * q as f64;
        if (p - p.round()).abs() < 1e-9 && p.round() >= 1.0 {
            let p = p.round() as i64;
            let num = if p == 1 { "\\pi".to_string() } else { format!("{}\\pi", p) };
            return Some(if q == 1 { format!("{}{}", sign, num) } else { format!("{}\\frac{{{}}}{{{}}}", sign, num, q) });
        }
    }
    None
}

fn simplify_sqrt(n: u64) -> (u64, u64) {
    let mut k = 1;
    let mut m = n;
    let mut f = 2;
    while f * f <= m {
        while m % (f * f) == 0 {
            m /= f * f;
            k *= f;
        }
        f += 1;
    }
    (k, m)
}

/// "3\\sqrt{2} \\approx 4.2426" or "5"
pub fn nice(v: f64) -> String {
    match exact_form(v) {
        Some(e) => {
            if e.contains("frac") && !e.contains("sqrt") && !e.contains("pi") {
                format!("{} = {}", e, dec(v))
            } else {
                format!("{} \\approx {}", e, dec(v))
            }
        }
        None => dec(v),
    }
}

pub fn deg(rad: f64) -> String {
    let d = clean(rad * 180.0 / PI);
    let d = (d * 1e6).round() / 1e6;
    let mut s = format!("{}^\\circ", dec(d));
    if let Some(e) = exact_form(rad) {
        if e.contains("pi") {
            s = format!("{}^\\circ = {}", dec(d), e);
        }
    }
    s
}

fn pt(x: f64, y: f64) -> String {
    format!("\\left({},\\ {}\\right)", nice_short(x), nice_short(y))
}
fn pt3(p: [f64; 3]) -> String {
    format!("\\left({},\\ {},\\ {}\\right)", nice_short(p[0]), nice_short(p[1]), nice_short(p[2]))
}
fn nice_short(v: f64) -> String {
    exact_form(v).unwrap_or_else(|| dec(v))
}

fn near(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-7 * (1.0 + a.abs().max(b.abs()))
}

// ---------------------------------------------------------------------------
// Triangle solving from sides / angles / area

#[derive(Deserialize, Default)]
pub struct TriangleKnown {
    pub a: Option<f64>,
    pub b: Option<f64>,
    pub c: Option<f64>,
    #[serde(rename = "A")]
    pub angle_a: Option<f64>,
    #[serde(rename = "B")]
    pub angle_b: Option<f64>,
    #[serde(rename = "C")]
    pub angle_c: Option<f64>,
    #[serde(rename = "S")]
    pub area: Option<f64>,
}

#[derive(Serialize)]
pub struct TriangleCase {
    pub facts: Vec<Fact>,
    /// A, B, C placed with A at the origin and AB along +x
    pub vertices: [[f64; 2]; 3],
    pub note: String,
}

#[derive(Serialize)]
pub struct TriangleResult {
    pub cases: Vec<TriangleCase>,
    pub error: Option<String>,
}

const SIDE: [&str; 3] = ["a", "b", "c"];
const ANG: [&str; 3] = ["A", "B", "C"];

pub fn triangle_solve(k: &TriangleKnown) -> TriangleResult {
    let s = [k.a, k.b, k.c];
    let mut g = [k.angle_a, k.angle_b, k.angle_c];
    let err = |m: &str| TriangleResult { cases: vec![], error: Some(m.into()) };
    if s.iter().flatten().any(|v| *v <= 0.0) {
        return err("边长必须为正数");
    }
    if g.iter().flatten().any(|v| *v <= 0.0 || *v >= PI) {
        return err("角必须在 0° 与 180° 之间");
    }
    let mut steps: Vec<Fact> = Vec::new();
    let ng = g.iter().filter(|v| v.is_some()).count();
    if ng >= 2 {
        let sum: f64 = g.iter().flatten().sum();
        if ng == 2 {
            if sum >= PI - 1e-12 {
                return err("两个角之和已不小于 180°，构不成三角形");
            }
            let i = g.iter().position(|v| v.is_none()).unwrap();
            g[i] = Some(PI - sum);
            let others: Vec<&str> = (0..3).filter(|&j| j != i).map(|j| ANG[j]).collect();
            steps.push(fact("角", &format!("\\angle {}", ANG[i]), deg(PI - sum), Some(PI - sum), &format!("\\angle {} = 180^\\circ - \\angle {} - \\angle {}", ANG[i], others[0], others[1]), "三角形内角和"));
        } else if !near(sum, PI) {
            return err("三个角之和不等于 180°");
        }
    }
    let ns = s.iter().filter(|v| v.is_some()).count();
    let mut cases: Vec<([f64; 3], [f64; 3], Vec<Fact>, String)> = Vec::new();

    match ns {
        3 => {
            let [a, b, c] = [s[0].unwrap(), s[1].unwrap(), s[2].unwrap()];
            if a + b <= c || a + c <= b || b + c <= a {
                return err("不满足三角形两边之和大于第三边");
            }
            let mut st = steps.clone();
            let ang = angles_from_sides([a, b, c]);
            for i in 0..3 {
                if g[i].is_none() {
                    let (j, l) = ((i + 1) % 3, (i + 2) % 3);
                    st.push(fact("角", &format!("\\angle {}", ANG[i]), deg(ang[i]), Some(ang[i]), &format!("\\cos {} = \\frac{{{}^2 + {}^2 - {}^2}}{{2{}{}}}", ANG[i], SIDE[j], SIDE[l], SIDE[i], SIDE[j], SIDE[l]), "余弦定理"));
                } else if !near(g[i].unwrap(), ang[i]) {
                    return err(&format!("已知的 ∠{} 与三边不一致", ANG[i]));
                }
            }
            cases.push(([a, b, c], ang, st, "SSS：三边确定唯一三角形".into()));
        }
        2 => {
            let m = s.iter().position(|v| v.is_none()).unwrap();
            let (i, j) = ((m + 1) % 3, (m + 2) % 3);
            let (si, sj) = (s[i].unwrap(), s[j].unwrap());
            if let Some(gm) = g[m] {
                // SAS
                let sm = (si * si + sj * sj - 2.0 * si * sj * gm.cos()).sqrt();
                let mut st = steps.clone();
                st.push(fact("边长", SIDE[m], nice(sm), Some(sm), &format!("{m}^2 = {i}^2 + {j}^2 - 2{i}{j}\\cos {M}", m = SIDE[m], i = SIDE[i], j = SIDE[j], M = ANG[m]), "余弦定理"));
                let mut sides = [0.0; 3];
                sides[m] = sm;
                sides[i] = si;
                sides[j] = sj;
                let ang = angles_from_sides(sides);
                for t in [i, j] {
                    if g[t].is_none() {
                        st.push(fact("角", &format!("\\angle {}", ANG[t]), deg(ang[t]), Some(ang[t]), &format!("\\cos {T} = \\frac{{{u}^2 + {v}^2 - {t}^2}}{{2{u}{v}}}", T = ANG[t], t = SIDE[t], u = SIDE[(t + 1) % 3], v = SIDE[(t + 2) % 3]), "余弦定理"));
                    }
                }
                cases.push((sides, ang, st, "SAS：两边及夹角确定唯一三角形".into()));
            } else if g[i].is_some() || g[j].is_some() {
                // SSA (possibly ambiguous)
                let (p, q) = if g[i].is_some() { (i, j) } else { (j, i) };
                let (sp, sq, gp) = (s[p].unwrap(), s[q].unwrap(), g[p].unwrap());
                let sin_q = sq * gp.sin() / sp;
                if sin_q > 1.0 + 1e-12 {
                    return err(&format!("由正弦定理 sin {} > 1，这样的三角形不存在", ANG[q]));
                }
                let base = sin_q.min(1.0).asin();
                let mut cands = vec![base];
                if (PI - base - base).abs() > 1e-9 {
                    cands.push(PI - base);
                }
                let total = cands.iter().filter(|&&gq| gp + gq < PI - 1e-12).count();
                for (idx, gq) in cands.into_iter().enumerate() {
                    if gp + gq >= PI - 1e-12 {
                        continue;
                    }
                    let gm = PI - gp - gq;
                    let sm = sp * gm.sin() / gp.sin();
                    let mut st = steps.clone();
                    st.push(fact("角", &format!("\\angle {}", ANG[q]), deg(gq), Some(gq), &format!("\\sin {Q} = \\frac{{{q}\\sin {P}}}{{{p}}}", Q = ANG[q], P = ANG[p], q = SIDE[q], p = SIDE[p]), if total > 1 { if idx == 0 { "正弦定理（锐角解）" } else { "正弦定理（钝角解）" } } else { "正弦定理" }));
                    st.push(fact("角", &format!("\\angle {}", ANG[m]), deg(gm), Some(gm), &format!("\\angle {} = 180^\\circ - \\angle {} - \\angle {}", ANG[m], ANG[p], ANG[q]), "三角形内角和"));
                    st.push(fact("边长", SIDE[m], nice(sm), Some(sm), &format!("{m} = \\frac{{{p}\\sin {M}}}{{\\sin {P}}}", m = SIDE[m], p = SIDE[p], M = ANG[m], P = ANG[p]), "正弦定理"));
                    let mut sides = [0.0; 3];
                    let mut ang = [0.0; 3];
                    sides[p] = sp;
                    sides[q] = sq;
                    sides[m] = sm;
                    ang[p] = gp;
                    ang[q] = gq;
                    ang[m] = gm;
                    let note = if total > 1 { format!("SSA：两边及其一对角 → 有两解（第 {} 解）", idx + 1) } else { "SSA：本题只有一解".into() };
                    cases.push((sides, ang, st, note));
                }
                if cases.is_empty() {
                    return err("给定的边角组合构不成三角形");
                }
            } else if let Some(area) = k.area {
                let sin_m = 2.0 * area / (si * sj);
                if sin_m > 1.0 + 1e-12 {
                    return err("面积过大：两边所能围成的最大面积是 ½ab");
                }
                let base = sin_m.min(1.0).asin();
                let mut cands = vec![base];
                if (PI - 2.0 * base).abs() > 1e-9 {
                    cands.push(PI - base);
                }
                for (idx, gm) in cands.into_iter().enumerate() {
                    let sm = (si * si + sj * sj - 2.0 * si * sj * gm.cos()).sqrt();
                    let mut sides = [0.0; 3];
                    sides[m] = sm;
                    sides[i] = si;
                    sides[j] = sj;
                    let ang = angles_from_sides(sides);
                    let mut st = steps.clone();
                    st.push(fact("角", &format!("\\angle {}", ANG[m]), deg(gm), Some(gm), &format!("\\sin {M} = \\frac{{2S}}{{{i}{j}}}", M = ANG[m], i = SIDE[i], j = SIDE[j]), if idx == 0 { "面积公式（锐角解）" } else { "面积公式（钝角解）" }));
                    st.push(fact("边长", SIDE[m], nice(sm), Some(sm), &format!("{m}^2 = {i}^2 + {j}^2 - 2{i}{j}\\cos {M}", m = SIDE[m], i = SIDE[i], j = SIDE[j], M = ANG[m]), "余弦定理"));
                    for t in [i, j] {
                        st.push(fact("角", &format!("\\angle {}", ANG[t]), deg(ang[t]), Some(ang[t]), "", "余弦定理"));
                    }
                    cases.push((sides, ang, st, format!("两边 + 面积 → 夹角有锐、钝两种可能（第 {} 解）", idx + 1)));
                }
            } else {
                return err(&format!("已知 {} 和 {}，还需要一个角（如 ∠{}）或面积 S", SIDE[i], SIDE[j], ANG[m]));
            }
        }
        1 => {
            if g.iter().all(|v| v.is_some()) {
                let i = s.iter().position(|v| v.is_some()).unwrap();
                let si = s[i].unwrap();
                let k2 = si / g[i].unwrap().sin();
                let mut st = steps.clone();
                let mut sides = [0.0; 3];
                sides[i] = si;
                for t in 0..3 {
                    if t != i {
                        sides[t] = k2 * g[t].unwrap().sin();
                        st.push(fact("边长", SIDE[t], nice(sides[t]), Some(sides[t]), &format!("{t} = \\frac{{{i}\\sin {T}}}{{\\sin {I}}}", t = SIDE[t], i = SIDE[i], T = ANG[t], I = ANG[i]), "正弦定理"));
                    }
                }
                let ang = [g[0].unwrap(), g[1].unwrap(), g[2].unwrap()];
                cases.push((sides, ang, st, "AAS / ASA：一边两角确定唯一三角形".into()));
            } else if let (Some(area), true) = (k.area, ng == 1) {
                // one side + one angle + area
                let i = s.iter().position(|v| v.is_some()).unwrap();
                let t = g.iter().position(|v| v.is_some()).unwrap();
                if i == t {
                    return err("已知一边、它的对角和面积：请再给一条边");
                }
                // the remaining side adjacent to angle t (other than i)
                let o = 3 - i - t;
                let so = 2.0 * area / (s[i].unwrap() * g[t].unwrap().sin());
                let mut sides = [0.0; 3];
                sides[i] = s[i].unwrap();
                sides[o] = so;
                sides[t] = (sides[i].powi(2) + so * so - 2.0 * sides[i] * so * g[t].unwrap().cos()).sqrt();
                let ang = angles_from_sides(sides);
                let mut st = steps.clone();
                st.push(fact("边长", SIDE[o], nice(so), Some(so), &format!("S = \\frac12 {i}{o}\\sin {T}", i = SIDE[i], o = SIDE[o], T = ANG[t]), "面积公式"));
                st.push(fact("边长", SIDE[t], nice(sides[t]), Some(sides[t]), "", "余弦定理"));
                cases.push((sides, ang, st, "一边一角 + 面积".into()));
            } else {
                return err("只知道一条边：再给两个角，或一个角 + 面积");
            }
        }
        _ => {
            if g.iter().all(|v| v.is_some()) {
                return err("只知道三个角：形状确定但大小不定（相似三角形），请再给一条边");
            }
            return err("请至少给出一条边，例如 △ABC: a=3, b=4, C=90°");
        }
    }

    TriangleResult {
        cases: cases
            .into_iter()
            .map(|(sides, ang, mut st, note)| {
                let verts = [[0.0, 0.0], [sides[2], 0.0], [sides[1] * ang[0].cos(), sides[1] * ang[0].sin()]];
                st.extend(triangle_derived(sides, ang, verts, ["A", "B", "C"]));
                TriangleCase { facts: st, vertices: verts.map(|p| p.map(clean)), note }
            })
            .collect(),
        error: None,
    }
}

fn angles_from_sides(s: [f64; 3]) -> [f64; 3] {
    let [a, b, c] = s;
    let ca = ((b * b + c * c - a * a) / (2.0 * b * c)).clamp(-1.0, 1.0).acos();
    let cb = ((a * a + c * c - b * b) / (2.0 * a * c)).clamp(-1.0, 1.0).acos();
    [ca, cb, PI - ca - cb]
}

/// Area, perimeter, radii, heights, medians, special centres, classification.
fn triangle_derived(s: [f64; 3], g: [f64; 3], v: [[f64; 2]; 3], names: [&str; 3]) -> Vec<Fact> {
    let [a, b, c] = s;
    let mut out = Vec::new();
    let area = 0.5 * a * b * g[2].sin();
    let per = a + b + c;
    let p = per / 2.0;
    let rr = a / (2.0 * g[0].sin());
    let r = area / p;
    out.push(fact("面积与周长", "S", nice(area), Some(area), "S = \\frac12 ab\\sin C", "面积公式"));
    out.push(fact("面积与周长", "C_{\\triangle}", nice(per), Some(per), "a + b + c", "周长"));

    let [na, nb, nc] = names;
    let (pa, pb, pc) = (v[0], v[1], v[2]);
    let centroid = [(pa[0] + pb[0] + pc[0]) / 3.0, (pa[1] + pb[1] + pc[1]) / 3.0];
    let d = 2.0 * (pa[0] * (pb[1] - pc[1]) + pb[0] * (pc[1] - pa[1]) + pc[0] * (pa[1] - pb[1]));
    let sq = |q: [f64; 2]| q[0] * q[0] + q[1] * q[1];
    let circ = [
        (sq(pa) * (pb[1] - pc[1]) + sq(pb) * (pc[1] - pa[1]) + sq(pc) * (pa[1] - pb[1])) / d,
        (sq(pa) * (pc[0] - pb[0]) + sq(pb) * (pa[0] - pc[0]) + sq(pc) * (pb[0] - pa[0])) / d,
    ];
    let inc = [(a * pa[0] + b * pb[0] + c * pc[0]) / per, (a * pa[1] + b * pb[1] + c * pc[1]) / per];
    let orth = [pa[0] + pb[0] + pc[0] - 2.0 * circ[0], pa[1] + pb[1] + pc[1] - 2.0 * circ[1]];

    out.push(fact("外接圆与内切圆", "R", nice(rr), Some(rr), "R = \\frac{a}{2\\sin A}", "正弦定理").with(Shape::Circle { cx: circ[0], cy: circ[1], r: rr, label: "外接圆".into() }));
    out.push(fact("外接圆与内切圆", "r", nice(r), Some(r), "r = \\frac{2S}{a+b+c}", "面积 = ½ · 周长 · r").with(Shape::Circle { cx: inc[0], cy: inc[1], r, label: "内切圆".into() }));

    for (i, (side, foot_from)) in [(a, 0usize), (b, 1), (c, 2)].into_iter().enumerate() {
        let h = 2.0 * area / side;
        // foot of altitude from vertex i onto the opposite side
        let (p, q1, q2) = (v[foot_from], v[(foot_from + 1) % 3], v[(foot_from + 2) % 3]);
        let dx = q2[0] - q1[0];
        let dy = q2[1] - q1[1];
        let t = ((p[0] - q1[0]) * dx + (p[1] - q1[1]) * dy) / (dx * dx + dy * dy);
        let foot = [q1[0] + t * dx, q1[1] + t * dy];
        out.push(fact("高与中线", &format!("h_{}", SIDE[i]), nice(h), Some(h), &format!("h_{s} = \\frac{{2S}}{{{s}}}", s = SIDE[i]), "面积反推高").with(Shape::Segment { x1: p[0], y1: p[1], x2: foot[0], y2: foot[1], label: format!("h_{}", SIDE[i]) }));
    }
    for i in 0..3 {
        let (x, y, z) = (s[i], s[(i + 1) % 3], s[(i + 2) % 3]);
        let m = 0.5 * (2.0 * y * y + 2.0 * z * z - x * x).sqrt();
        let p = v[i];
        let mid = [(v[(i + 1) % 3][0] + v[(i + 2) % 3][0]) / 2.0, (v[(i + 1) % 3][1] + v[(i + 2) % 3][1]) / 2.0];
        out.push(fact("高与中线", &format!("m_{}", SIDE[i]), nice(m), Some(m), &format!("m_{s} = \\frac12\\sqrt{{2{u}^2 + 2{w}^2 - {s}^2}}", s = SIDE[i], u = SIDE[(i + 1) % 3], w = SIDE[(i + 2) % 3]), "中线长公式").with(Shape::Segment { x1: p[0], y1: p[1], x2: mid[0], y2: mid[1], label: format!("m_{}", SIDE[i]) }));
    }

    out.push(fact("特殊点", "G", pt(centroid[0], centroid[1]), None, "G = \\frac{A + B + C}{3}", "重心（中线交点）").with(Shape::Point { x: centroid[0], y: centroid[1], label: "G 重心".into() }));
    out.push(fact("特殊点", "O", pt(circ[0], circ[1]), None, "|OA| = |OB| = |OC|", "外心（中垂线交点）").with(Shape::Point { x: circ[0], y: circ[1], label: "O 外心".into() }));
    out.push(fact("特殊点", "I", pt(inc[0], inc[1]), None, "I = \\frac{aA + bB + cC}{a + b + c}", "内心（角平分线交点）").with(Shape::Point { x: inc[0], y: inc[1], label: "I 内心".into() }));
    out.push(fact("特殊点", "H", pt(orth[0], orth[1]), None, "\\vec{OH} = \\vec{OA} + \\vec{OB} + \\vec{OC}", "垂心（高线交点）").with(Shape::Point { x: orth[0], y: orth[1], label: "H 垂心".into() }));

    let mut kinds: Vec<String> = Vec::new();
    let maxg = g.iter().cloned().fold(0.0, f64::max);
    if near(maxg, PI / 2.0) {
        let i = g.iter().position(|x| near(*x, PI / 2.0)).unwrap();
        kinds.push(format!("直角三角形（∠{} = 90°）", [na, nb, nc][i]));
    } else if maxg > PI / 2.0 {
        kinds.push("钝角三角形".into());
    } else {
        kinds.push("锐角三角形".into());
    }
    if near(a, b) && near(b, c) {
        kinds.push("等边".into());
    } else if near(a, b) || near(b, c) || near(a, c) {
        kinds.push("等腰".into());
    }
    out.push(fact("形状判断", "\\text{类型}", format!("\\text{{{}}}", kinds.join("、")), None, "", "由三个角与三边比较"));
    if near(maxg, PI / 2.0) {
        out.push(fact("形状判断", "R", nice(rr), Some(rr), "R = \\frac{\\text{斜边}}{2}", "直角三角形外心在斜边中点"));
    }
    out
}

// ---------------------------------------------------------------------------
// Named points (2D): distances, polygon properties

#[derive(Deserialize)]
pub struct NamedPoint {
    pub name: String,
    pub p: Vec<f64>,
}

fn dist2(a: [f64; 2], b: [f64; 2]) -> f64 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt()
}

fn line_eq_latex(a: f64, b: f64, c: f64) -> String {
    // a x + b y = c, normalised for display
    if near(b, 0.0) {
        return format!("x = {}", nice_short(c / a));
    }
    let m = -a / b;
    let q = c / b;
    let mut s = String::from("y = ");
    if near(m, 0.0) {
        s.push_str(&nice_short(q));
        return s;
    }
    s.push_str(&if near(m, 1.0) { "x".into() } else if near(m, -1.0) { "-x".into() } else { format!("{}x", nice_short(m)) });
    if !near(q, 0.0) {
        let qs = nice_short(q);
        if let Some(stripped) = qs.strip_prefix('-') {
            s.push_str(&format!(" - {}", stripped));
        } else {
            s.push_str(&format!(" + {}", qs));
        }
    }
    s
}

pub fn points_analyze(points: &[NamedPoint]) -> Vec<Fact> {
    if points.iter().any(|p| p.p.len() == 3) {
        return points3_analyze(points);
    }
    let pts: Vec<(String, [f64; 2])> = points.iter().map(|p| (p.name.clone(), [p.p[0], *p.p.get(1).unwrap_or(&0.0)])).collect();
    let n = pts.len();
    let mut out = Vec::new();
    if n == 0 {
        return out;
    }
    if n == 1 {
        let (nm, p) = &pts[0];
        let r = dist2(*p, [0.0, 0.0]);
        out.push(fact("距离", &format!("|O{}|", nm), nice(r), Some(r), "\\sqrt{x^2 + y^2}", "到原点的距离"));
        let q = if near(p[0], 0.0) || near(p[1], 0.0) { "坐标轴上".to_string() } else { format!("第{}象限", match (p[0] > 0.0, p[1] > 0.0) { (true, true) => "一", (false, true) => "二", (false, false) => "三", _ => "四" }) };
        out.push(fact("位置", nm, format!("\\text{{{}}}", q), None, "", "看坐标符号"));
        return out;
    }
    if n == 2 {
        let ((na, a), (nb, b)) = (&pts[0], &pts[1]);
        let d = dist2(*a, *b);
        let mid = [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0];
        out.push(fact("线段", &format!("|{na}{nb}|"), nice(d), Some(d), "\\sqrt{(x_2-x_1)^2 + (y_2-y_1)^2}", "两点间距离").with(Shape::Segment { x1: a[0], y1: a[1], x2: b[0], y2: b[1], label: format!("{na}{nb}") }));
        out.push(fact("线段", &format!("{na}{nb} \\text{{ 中点}}"), pt(mid[0], mid[1]), None, "\\left(\\frac{x_1+x_2}{2},\\ \\frac{y_1+y_2}{2}\\right)", "中点公式").with(Shape::Point { x: mid[0], y: mid[1], label: "中点 M".into() }));
        let (la, lb) = (b[1] - a[1], a[0] - b[0]);
        let lc = la * a[0] + lb * a[1];
        if !near(b[0], a[0]) {
            let k = (b[1] - a[1]) / (b[0] - a[0]);
            out.push(fact("直线", "k", nice(k), Some(k), "k = \\frac{y_2 - y_1}{x_2 - x_1}", "斜率"));
            let ang = k.atan().rem_euclid(PI);
            out.push(fact("直线", "\\alpha", deg(ang), Some(ang), "\\tan\\alpha = k", "倾斜角"));
        } else {
            out.push(fact("直线", "k", "\\text{不存在（竖直）}".into(), None, "", "两点横坐标相同"));
        }
        out.push(fact("直线", &format!("{na}{nb}"), line_eq_latex(la, lb, lc), None, "", "两点式"));
        // perpendicular bisector: direction (la, lb) is normal of AB; bisector normal is AB direction
        let (pa, pb) = (b[0] - a[0], b[1] - a[1]);
        let pc = pa * mid[0] + pb * mid[1];
        out.push(fact("直线", "\\text{中垂线}", line_eq_latex(pa, pb, pc), None, "", "过中点且垂直于该线段"));
        return out;
    }

    // polygon in the given order
    let side_name = |i: usize| format!("{}{}", pts[i].0, pts[(i + 1) % n].0);
    let mut sides = Vec::new();
    for i in 0..n {
        let (a, b) = (pts[i].1, pts[(i + 1) % n].1);
        let d = dist2(a, b);
        sides.push(d);
        out.push(fact("边长", &format!("|{}|", side_name(i)), nice(d), Some(d), "\\sqrt{\\Delta x^2 + \\Delta y^2}", "两点间距离"));
    }
    let mut area2 = 0.0;
    for i in 0..n {
        let (a, b) = (pts[i].1, pts[(i + 1) % n].1);
        area2 += a[0] * b[1] - b[0] * a[1];
    }
    let orient = area2.signum();
    let area = area2.abs() / 2.0;
    let per: f64 = sides.iter().sum();

    let mut angles = Vec::new();
    let mut convex = true;
    for i in 0..n {
        let prev = pts[(i + n - 1) % n].1;
        let cur = pts[i].1;
        let next = pts[(i + 1) % n].1;
        let u = [prev[0] - cur[0], prev[1] - cur[1]];
        let w = [next[0] - cur[0], next[1] - cur[1]];
        let cross = w[0] * u[1] - w[1] * u[0];
        let dot = u[0] * w[0] + u[1] * w[1];
        let mut ang = cross.abs().atan2(dot);
        if cross * orient < -1e-12 {
            ang = 2.0 * PI - ang;
            convex = false;
        }
        angles.push(ang);
        out.push(fact("角", &format!("\\angle {}{}{}", pts[(i + n - 1) % n].0, pts[i].0, pts[(i + 1) % n].0), deg(ang), Some(ang), "\\cos\\theta = \\frac{\\vec u \\cdot \\vec v}{|\\vec u||\\vec v|}", "向量夹角"));
    }
    out.push(fact("面积与周长", "S", nice(area), Some(area), "S = \\frac12\\left|\\sum (x_i y_{i+1} - x_{i+1} y_i)\\right|", "鞋带公式"));
    out.push(fact("面积与周长", "C", nice(per), Some(per), "\\sum |P_i P_{i+1}|", "周长"));

    // parallel / perpendicular sides
    let dir = |i: usize| {
        let (a, b) = (pts[i].1, pts[(i + 1) % n].1);
        [b[0] - a[0], b[1] - a[1]]
    };
    let mut par = Vec::new();
    for i in 0..n {
        for j in i + 1..n {
            let (u, w) = (dir(i), dir(j));
            let cr = u[0] * w[1] - u[1] * w[0];
            let dt = u[0] * w[0] + u[1] * w[1];
            let scale = (u[0].hypot(u[1])) * (w[0].hypot(w[1]));
            if cr.abs() < 1e-9 * scale {
                par.push((i, j));
                out.push(fact("位置关系", &format!("{} \\parallel {}", side_name(i), side_name(j)), "\\checkmark".into(), None, "x_1y_2 - x_2y_1 = 0", "方向向量共线"));
            } else if dt.abs() < 1e-9 * scale {
                out.push(fact("位置关系", &format!("{} \\perp {}", side_name(i), side_name(j)), "\\checkmark".into(), None, "\\vec u\\cdot\\vec v = 0", "方向向量点积为 0"));
            }
        }
    }

    if n == 3 {
        let s = [sides[1], sides[2], sides[0]]; // a = BC, b = CA, c = AB
        let g = [angles[0], angles[1], angles[2]];
        let verts = [pts[0].1, pts[1].1, pts[2].1];
        let names = [pts[0].0.as_str(), pts[1].0.as_str(), pts[2].0.as_str()];
        if area < 1e-12 {
            out.push(fact("形状判断", "\\text{类型}", "\\text{三点共线，不构成三角形}".into(), None, "", "面积为 0"));
            return out;
        }
        let derived = triangle_derived(s, g, verts, names);
        out.extend(derived.into_iter().filter(|f| f.label != "S" && f.label != "C_{\\triangle}"));
    } else if n == 4 {
        let (a, b, c, d) = (pts[0].1, pts[1].1, pts[2].1, pts[3].1);
        let d1 = dist2(a, c);
        let d2 = dist2(b, d);
        out.push(fact("对角线", &format!("|{}{}|", pts[0].0, pts[2].0), nice(d1), Some(d1), "", "两点间距离").with(Shape::Segment { x1: a[0], y1: a[1], x2: c[0], y2: c[1], label: "对角线".into() }));
        out.push(fact("对角线", &format!("|{}{}|", pts[1].0, pts[3].0), nice(d2), Some(d2), "", "两点间距离").with(Shape::Segment { x1: b[0], y1: b[1], x2: d[0], y2: d[1], label: "对角线".into() }));
        // diagonal intersection
        let m = vec![vec![c[0] - a[0], -(d[0] - b[0])], vec![c[1] - a[1], -(d[1] - b[1])]];
        if let Some(st) = solve_linear_pub(m, vec![b[0] - a[0], b[1] - a[1]]) {
            if st[0].is_finite() {
                let p = [a[0] + st[0] * (c[0] - a[0]), a[1] + st[0] * (c[1] - a[1])];
                out.push(fact("对角线", "\\text{交点}", pt(p[0], p[1]), None, "", "联立两条对角线").with(Shape::Point { x: p[0], y: p[1], label: "对角线交点".into() }));
            }
        }
        let is_para = par.contains(&(0, 2)) && par.contains(&(1, 3));
        let right = angles.iter().all(|x| near(*x, PI / 2.0));
        let equal = sides.iter().all(|x| near(*x, sides[0]));
        let kind = if is_para && right && equal {
            "正方形"
        } else if is_para && right {
            "矩形"
        } else if is_para && equal {
            "菱形"
        } else if is_para {
            "平行四边形"
        } else if par.contains(&(0, 2)) || par.contains(&(1, 3)) {
            "梯形"
        } else if !convex {
            "凹四边形"
        } else {
            "一般凸四边形"
        };
        out.push(fact("形状判断", "\\text{类型}", format!("\\text{{{}}}", kind), None, "", "由对边平行、直角、边长相等判断"));
    } else {
        out.push(fact("形状判断", "\\text{类型}", format!("\\text{{{}{}边形}}", if convex { "凸" } else { "凹" }, n), None, "", "内角和 (n-2)·180°"));
    }
    out
}

fn sub3(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn dot3(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn cross3(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
fn len3(a: [f64; 3]) -> f64 {
    dot3(a, a).sqrt()
}

fn points3_analyze(points: &[NamedPoint]) -> Vec<Fact> {
    let pts: Vec<(String, [f64; 3])> = points.iter().map(|p| (p.name.clone(), [p.p[0], *p.p.get(1).unwrap_or(&0.0), *p.p.get(2).unwrap_or(&0.0)])).collect();
    let mut out = Vec::new();
    for i in 0..pts.len() {
        for j in i + 1..pts.len() {
            let d = len3(sub3(pts[j].1, pts[i].1));
            out.push(fact("距离", &format!("|{}{}|", pts[i].0, pts[j].0), nice(d), Some(d), "\\sqrt{\\Delta x^2+\\Delta y^2+\\Delta z^2}", "空间两点距离"));
        }
    }
    if pts.len() >= 3 {
        let (a, b, c) = (pts[0].1, pts[1].1, pts[2].1);
        let nrm = cross3(sub3(b, a), sub3(c, a));
        let area = len3(nrm) / 2.0;
        let names = format!("{}{}{}", pts[0].0, pts[1].0, pts[2].0);
        out.push(fact("面积", &format!("S_{{\\triangle {}}}", names), nice(area), Some(area), "S = \\frac12|\\vec{AB}\\times\\vec{AC}|", "叉积的模"));
        if area > 1e-12 {
            let d = dot3(nrm, a);
            out.push(fact("平面", &format!("\\text{{平面 }}{}", names), plane_latex(nrm, d), None, "\\vec n = \\vec{AB}\\times\\vec{AC}", "三点确定一个平面"));
        }
        if pts.len() >= 4 {
            let dpt = pts[3].1;
            let vol = dot3(sub3(dpt, a), nrm).abs() / 6.0;
            out.push(fact("体积", "V", nice(vol), Some(vol), "V = \\frac16\\left|\\vec{AD}\\cdot(\\vec{AB}\\times\\vec{AC})\\right|", "混合积"));
            if area > 1e-12 {
                let h = 3.0 * vol / area;
                out.push(fact("距离", &format!("d({}, \\text{{平面}})", pts[3].0), nice(h), Some(h), "d = \\frac{3V}{S}", "等体积法"));
            }
        }
    }
    out
}

fn plane_latex(n: [f64; 3], d: f64) -> String {
    let mut terms = Vec::new();
    for (c, v) in n.iter().zip(["x", "y", "z"]) {
        if near(*c, 0.0) {
            continue;
        }
        let cs = if near(*c, 1.0) { String::new() } else if near(*c, -1.0) { "-".into() } else { nice_short(*c) };
        terms.push(format!("{}{}", cs, v));
    }
    let mut s = terms.join(" + ").replace("+ -", "- ");
    if s.is_empty() {
        s = "0".into();
    }
    format!("{} = {}", s, nice_short(d))
}

// ---------------------------------------------------------------------------
// Vectors

#[derive(Deserialize)]
pub struct NamedVec {
    pub name: String,
    pub v: Vec<f64>,
}

fn vlabel(n: &str) -> String {
    if n.len() == 2 && n.chars().all(|c| c.is_ascii_uppercase()) {
        format!("\\overrightarrow{{{}}}", n)
    } else {
        format!("\\mathbf{{{}}}", n)
    }
}

pub fn vectors_analyze(vs: &[NamedVec]) -> Vec<Fact> {
    let mut out = Vec::new();
    let to3 = |v: &Vec<f64>| [v[0], *v.get(1).unwrap_or(&0.0), *v.get(2).unwrap_or(&0.0)];
    let is3 = vs.iter().any(|v| v.v.len() == 3);
    for v in vs {
        let a = to3(&v.v);
        let l = len3(a);
        let nm = vlabel(&v.name);
        out.push(fact("模长与方向", &format!("|{}|", nm), nice(l), Some(l), "\\sqrt{x^2 + y^2 + z^2}", "模长"));
        if l > 1e-12 {
            if is3 {
                out.push(fact("模长与方向", &format!("\\hat{{{}}}", v.name), pt3([a[0] / l, a[1] / l, a[2] / l]), None, "\\frac{\\vec v}{|\\vec v|}", "单位向量"));
            } else {
                let ang = a[1].atan2(a[0]).rem_euclid(2.0 * PI);
                out.push(fact("模长与方向", &format!("\\theta_{{{}}}", v.name), deg(ang), Some(ang), "\\tan\\theta = \\frac{y}{x}", "与 x 轴正方向的夹角"));
            }
        }
    }
    for i in 0..vs.len() {
        for j in i + 1..vs.len() {
            let (a, b) = (to3(&vs[i].v), to3(&vs[j].v));
            let (na, nb) = (vlabel(&vs[i].name), vlabel(&vs[j].name));
            let d = dot3(a, b);
            let (la, lb) = (len3(a), len3(b));
            out.push(fact("两向量关系", &format!("{} \\cdot {}", na, nb), nice(d), Some(d), "x_1x_2 + y_1y_2 + z_1z_2", "数量积"));
            if la > 1e-12 && lb > 1e-12 {
                let ang = (d / (la * lb)).clamp(-1.0, 1.0).acos();
                out.push(fact("两向量关系", &format!("\\langle {}, {} \\rangle", na, nb), deg(ang), Some(ang), "\\cos\\theta = \\frac{\\vec a\\cdot\\vec b}{|\\vec a||\\vec b|}", "夹角"));
                let proj = d / lb;
                out.push(fact("两向量关系", &format!("\\text{{{} 在 {} 上的投影}}", vs[i].name, vs[j].name), nice(proj), Some(proj), "\\frac{\\vec a\\cdot\\vec b}{|\\vec b|}", "投影（数量）"));
                let cr = cross3(a, b);
                let lc = len3(cr);
                if lc < 1e-9 * la * lb {
                    let same = d > 0.0;
                    out.push(fact("两向量关系", &format!("{} \\parallel {}", na, nb), format!("\\text{{{}}}", if same { "同向共线" } else { "反向共线" }), None, "\\vec a = \\lambda\\vec b", "叉积为零"));
                    out.push(fact("两向量关系", "\\lambda", nice(if same { la / lb } else { -la / lb }), None, "\\vec a = \\lambda \\vec b", "共线系数"));
                } else if d.abs() < 1e-9 * la * lb {
                    out.push(fact("两向量关系", &format!("{} \\perp {}", na, nb), "\\checkmark".into(), None, "\\vec a\\cdot\\vec b = 0", "数量积为 0"));
                }
                if is3 {
                    out.push(fact("两向量关系", &format!("{} \\times {}", na, nb), pt3(cr), None, "\\begin{vmatrix} i & j & k \\\\ x_1 & y_1 & z_1 \\\\ x_2 & y_2 & z_2 \\end{vmatrix}", "向量积").with(Shape::Arrow3 { x: cr[0], y: cr[1], z: cr[2], label: format!("{}×{}", vs[i].name, vs[j].name) }));
                }
                out.push(fact("两向量关系", "S_{\\text{平行四边形}}", nice(lc), Some(lc), "|\\vec a \\times \\vec b| = |\\vec a||\\vec b|\\sin\\theta", "以两向量为邻边"));
                out.push(fact("两向量关系", "S_{\\triangle}", nice(lc / 2.0), Some(lc / 2.0), "\\frac12|\\vec a\\times\\vec b|", "以两向量为邻边的三角形"));
            }
            let sum: Vec<f64> = (0..3).map(|k| a[k] + b[k]).collect();
            let dif: Vec<f64> = (0..3).map(|k| a[k] - b[k]).collect();
            let fmt = |v: &[f64]| if is3 { pt3([v[0], v[1], v[2]]) } else { pt(v[0], v[1]) };
            out.push(fact("两向量关系", &format!("{} + {}", na, nb), fmt(&sum), None, "", "坐标相加"));
            out.push(fact("两向量关系", &format!("{} - {}", na, nb), fmt(&dif), None, "", "坐标相减"));
        }
    }
    if vs.len() >= 3 && is3 {
        let (a, b, c) = (to3(&vs[0].v), to3(&vs[1].v), to3(&vs[2].v));
        let m = dot3(a, cross3(b, c));
        out.push(fact("三向量", &format!("[{}\\,{}\\,{}]", vs[0].name, vs[1].name, vs[2].name), nice(m), Some(m), "\\vec a\\cdot(\\vec b\\times\\vec c)", "混合积"));
        if m.abs() < 1e-9 {
            out.push(fact("三向量", "\\text{共面}", "\\checkmark".into(), None, "[\\vec a\\,\\vec b\\,\\vec c] = 0", "混合积为 0"));
        } else {
            out.push(fact("三向量", "V_{\\text{平行六面体}}", nice(m.abs()), Some(m.abs()), "|[\\vec a\\,\\vec b\\,\\vec c]|", "混合积的绝对值"));
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Lines in the plane  (a x + b y = c)

#[derive(Deserialize)]
pub struct NamedLine {
    pub name: String,
    pub a: f64,
    pub b: f64,
    pub c: f64,
}

pub fn lines_analyze(ls: &[NamedLine], points: &[NamedPoint]) -> Vec<Fact> {
    let mut out = Vec::new();
    for l in ls {
        let nm = &l.name;
        if !near(l.b, 0.0) {
            let k = -l.a / l.b;
            out.push(fact("直线", &format!("k_{{{}}}", nm), nice(k), Some(k), "y = kx + b", "斜率"));
            let ang = k.atan().rem_euclid(PI);
            out.push(fact("直线", &format!("\\alpha_{{{}}}", nm), deg(ang), Some(ang), "\\tan\\alpha = k", "倾斜角"));
        } else {
            out.push(fact("直线", &format!("\\alpha_{{{}}}", nm), "90^\\circ".into(), None, "", "竖直直线，斜率不存在"));
        }
        if !near(l.a, 0.0) {
            out.push(fact("截距", &format!("{} \\cap x\\text{{轴}}", nm), pt(l.c / l.a, 0.0), None, "y = 0", "令 y = 0").with(Shape::Point { x: l.c / l.a, y: 0.0, label: format!("{nm} 与 x 轴") }));
        }
        if !near(l.b, 0.0) {
            out.push(fact("截距", &format!("{} \\cap y\\text{{轴}}", nm), pt(0.0, l.c / l.b), None, "x = 0", "令 x = 0").with(Shape::Point { x: 0.0, y: l.c / l.b, label: format!("{nm} 与 y 轴") }));
        }
        let dist0 = l.c.abs() / l.a.hypot(l.b);
        out.push(fact("距离", &format!("d(O, {})", nm), nice(dist0), Some(dist0), "d = \\frac{|Ax_0 + By_0 + C|}{\\sqrt{A^2 + B^2}}", "原点到直线的距离"));
        for p in points {
            let (x, y) = (p.p[0], *p.p.get(1).unwrap_or(&0.0));
            let d = (l.a * x + l.b * y - l.c).abs() / l.a.hypot(l.b);
            let t = (l.c - l.a * x - l.b * y) / (l.a * l.a + l.b * l.b);
            let foot = [x + t * l.a, y + t * l.b];
            if d < 1e-9 {
                out.push(fact("点与直线", &format!("{} \\in {}", p.name, nm), "\\checkmark".into(), None, "", "代入方程成立"));
            } else {
                out.push(fact("点与直线", &format!("d({}, {})", p.name, nm), nice(d), Some(d), "d = \\frac{|Ax_0 + By_0 + C|}{\\sqrt{A^2 + B^2}}", "点到直线距离").with(Shape::Segment { x1: x, y1: y, x2: foot[0], y2: foot[1], label: format!("{} 到 {}", p.name, nm) }));
            }
        }
    }
    for i in 0..ls.len() {
        for j in i + 1..ls.len() {
            let (p, q) = (&ls[i], &ls[j]);
            let det = p.a * q.b - p.b * q.a;
            let rel = format!("{} , {}", p.name, q.name);
            let scale = p.a.hypot(p.b) * q.a.hypot(q.b);
            if det.abs() < 1e-12 * scale {
                let coincide = (p.a * q.c - q.a * p.c).abs() < 1e-9 * scale && (p.b * q.c - q.b * p.c).abs() < 1e-9 * scale;
                if coincide {
                    out.push(fact("两直线", &rel, "\\text{重合}".into(), None, "\\frac{A_1}{A_2} = \\frac{B_1}{B_2} = \\frac{C_1}{C_2}", "系数成比例"));
                } else {
                    let (np, nq) = (p.a.hypot(p.b), q.a.hypot(q.b));
                    let same_dir = p.a * q.a + p.b * q.b > 0.0;
                    let cq = if same_dir { q.c / nq } else { -q.c / nq };
                    let d = (p.c / np - cq).abs();
                    out.push(fact("两直线", &format!("{} \\parallel {}", p.name, q.name), "\\checkmark".into(), None, "\\frac{A_1}{A_2} = \\frac{B_1}{B_2} \\ne \\frac{C_1}{C_2}", "斜率相等"));
                    out.push(fact("两直线", &format!("d({}, {})", p.name, q.name), nice(d), Some(d), "\\frac{|C_1 - C_2|}{\\sqrt{A^2+B^2}}", "平行线间距离"));
                }
                continue;
            }
            let x = (p.c * q.b - p.b * q.c) / det;
            let y = (p.a * q.c - p.c * q.a) / det;
            out.push(fact("两直线", &format!("{} \\cap {}", p.name, q.name), pt(x, y), None, "\\begin{cases} A_1x + B_1y = C_1 \\\\ A_2x + B_2y = C_2 \\end{cases}", "联立方程").with(Shape::Point { x, y, label: format!("{}∩{}", p.name, q.name) }));
            let dt = p.a * q.a + p.b * q.b;
            if dt.abs() < 1e-12 * scale {
                out.push(fact("两直线", &format!("{} \\perp {}", p.name, q.name), "\\checkmark".into(), None, "k_1 k_2 = -1", "法向量点积为 0"));
            } else {
                let ang = (det.abs()).atan2(dt.abs());
                out.push(fact("两直线", &format!("\\theta({}, {})", p.name, q.name), deg(ang), Some(ang), "\\tan\\theta = \\left|\\frac{k_1 - k_2}{1 + k_1k_2}\\right|", "两直线夹角"));
            }
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Planes  (a x + b y + c z = d)

#[derive(Deserialize)]
pub struct NamedPlane {
    pub name: String,
    pub n: [f64; 3],
    pub d: f64,
}

pub fn planes_analyze(ps: &[NamedPlane], points: &[NamedPoint]) -> Vec<Fact> {
    let mut out = Vec::new();
    for p in ps {
        let ln = len3(p.n);
        out.push(fact("平面", &format!("\\vec n_{{{}}}", p.name), pt3(p.n), None, "ax + by + cz = d \\Rightarrow \\vec n = (a,b,c)", "法向量").with(Shape::Arrow3 { x: p.n[0], y: p.n[1], z: p.n[2], label: format!("n_{}", p.name) }));
        let d0 = p.d.abs() / ln;
        out.push(fact("平面", &format!("d(O, {})", p.name), nice(d0), Some(d0), "\\frac{|d|}{|\\vec n|}", "原点到平面的距离"));
        let mut ints = Vec::new();
        for (k, ax) in ["x", "y", "z"].iter().enumerate() {
            if !near(p.n[k], 0.0) {
                ints.push(format!("{}={}", ax, nice_short(p.d / p.n[k])));
            }
        }
        if !ints.is_empty() {
            out.push(fact("平面", &format!("\\text{{截距 }}{}", p.name), ints.join(",\\ "), None, "", "令另外两个坐标为 0"));
        }
        for q in points {
            let x = [q.p[0], *q.p.get(1).unwrap_or(&0.0), *q.p.get(2).unwrap_or(&0.0)];
            let d = (dot3(p.n, x) - p.d).abs() / ln;
            out.push(fact("点与平面", &format!("d({}, {})", q.name, p.name), nice(d), Some(d), "\\frac{|ax_0+by_0+cz_0-d|}{\\sqrt{a^2+b^2+c^2}}", "点到平面距离"));
        }
    }
    for i in 0..ps.len() {
        for j in i + 1..ps.len() {
            let (p, q) = (&ps[i], &ps[j]);
            let dirv = cross3(p.n, q.n);
            let (lp, lq) = (len3(p.n), len3(q.n));
            if len3(dirv) < 1e-9 * lp * lq {
                let f = dot3(p.n, q.n).signum() * lq / lp;
                let d = (q.d - p.d * f).abs() / lq;
                out.push(fact("两平面", &format!("{} \\parallel {}", p.name, q.name), if d < 1e-9 { "\\text{重合}".into() } else { "\\checkmark".into() }, None, "\\vec n_1 \\parallel \\vec n_2", "法向量共线"));
                if d > 1e-9 {
                    out.push(fact("两平面", &format!("d({}, {})", p.name, q.name), nice(d), Some(d), "", "平行平面间距离"));
                }
                continue;
            }
            let ang = (dot3(p.n, q.n).abs() / (lp * lq)).clamp(-1.0, 1.0).acos();
            out.push(fact("两平面", &format!("\\theta({}, {})", p.name, q.name), deg(ang), Some(ang), "\\cos\\theta = \\frac{|\\vec n_1\\cdot\\vec n_2|}{|\\vec n_1||\\vec n_2|}", "二面角（锐角）"));
            if dot3(p.n, q.n).abs() < 1e-9 * lp * lq {
                out.push(fact("两平面", &format!("{} \\perp {}", p.name, q.name), "\\checkmark".into(), None, "\\vec n_1\\cdot\\vec n_2 = 0", "法向量垂直"));
            }
            // point on the line: least-norm solution of the 2x3 system via n1, n2 basis
            let n11 = dot3(p.n, p.n);
            let n22 = dot3(q.n, q.n);
            let n12 = dot3(p.n, q.n);
            let det = n11 * n22 - n12 * n12;
            let c1 = (p.d * n22 - q.d * n12) / det;
            let c2 = (q.d * n11 - p.d * n12) / det;
            let p0 = [c1 * p.n[0] + c2 * q.n[0], c1 * p.n[1] + c2 * q.n[1], c1 * p.n[2] + c2 * q.n[2]];
            let p0 = p0.map(clean);
            let g = gcd_scale(dirv);
            out.push(fact("两平面", &format!("{} \\cap {}", p.name, q.name), format!("{} + t{}", pt3(p0), pt3(g)), None, "\\vec s = \\vec n_1 \\times \\vec n_2", "交线（参数式）").with(Shape::Line3 { px: p0[0], py: p0[1], pz: p0[2], dx: g[0], dy: g[1], dz: g[2], label: format!("{}∩{}", p.name, q.name) }));
        }
    }
    if ps.len() >= 3 {
        let (p, q, r) = (&ps[0], &ps[1], &ps[2]);
        let m = vec![p.n.to_vec(), q.n.to_vec(), r.n.to_vec()];
        let det = dot3(p.n, cross3(q.n, r.n));
        if det.abs() > 1e-12 {
            if let Some(x) = solve_linear_pub(m, vec![p.d, q.d, r.d]) {
                let x = [clean(x[0]), clean(x[1]), clean(x[2])];
                out.push(fact("三平面", &format!("{} \\cap {} \\cap {}", p.name, q.name, r.name), pt3(x), None, "\\text{克拉默法则}", "三个平面交于一点").with(Shape::Point3 { x: x[0], y: x[1], z: x[2], label: "三平面交点".into() }));
            }
        } else {
            out.push(fact("三平面", "\\text{交点}", "\\text{不唯一}".into(), None, "\\det = 0", "法向量共面：交于一线或无公共点"));
        }
    }
    out
}

/// Scale a direction vector to small integers when possible.
fn gcd_scale(v: [f64; 3]) -> [f64; 3] {
    let m = v.iter().fold(0.0f64, |a, b| a.max(b.abs()));
    if m == 0.0 {
        return v;
    }
    for k in 1..=12 {
        let s = v.map(|x| x / m * k as f64);
        if s.iter().all(|x| (x - x.round()).abs() < 1e-9) {
            let ints: Vec<i64> = s.iter().map(|x| x.round() as i64).collect();
            let g = ints.iter().fold(0i64, |a, &b| gcd(a, b.abs()));
            let g = g.max(1) as f64;
            let sign = if ints.iter().find(|x| **x != 0).map_or(1, |x| x.signum()) < 0 { -1.0 } else { 1.0 };
            return s.map(|x| clean(sign * x.round() / g));
        }
    }
    v.map(clean)
}
fn gcd(a: i64, b: i64) -> i64 {
    if b == 0 { a } else { gcd(b, a % b) }
}

// ---------------------------------------------------------------------------
// Conics from A x² + B xy + C y² + D x + E y + F = 0

pub fn conic_analyze(c: [f64; 6], name: &str) -> Vec<Fact> {
    let [a, b, cc, d, e, f] = c;
    let mut out = Vec::new();
    let det = 4.0 * a * cc - b * b;
    if near(a, 0.0) && near(b, 0.0) && near(cc, 0.0) {
        return out;
    }
    if near(det, 0.0) {
        // parabola (axis-aligned cases)
        if near(b, 0.0) && near(a, 0.0) && !near(d, 0.0) {
            let y0 = -e / (2.0 * cc);
            let x0 = -(cc * y0 * y0 + e * y0 + f) / d;
            let p = -d / (4.0 * cc);
            out.push(fact("圆锥曲线", name, "\\text{抛物线（开口沿 x 轴）}".into(), None, "(y-y_0)^2 = 4p(x-x_0)", "配方"));
            out.push(fact("圆锥曲线", "\\text{顶点}", pt(x0, y0), None, "", "配方").with(Shape::Point { x: x0, y: y0, label: "顶点".into() }));
            out.push(fact("圆锥曲线", "\\text{焦点}", pt(x0 + p, y0), None, "F(x_0 + p,\\ y_0)", "焦点").with(Shape::Point { x: x0 + p, y: y0, label: "焦点 F".into() }));
            out.push(fact("圆锥曲线", "\\text{准线}", format!("x = {}", nice_short(x0 - p)), None, "x = x_0 - p", "准线"));
        } else if near(b, 0.0) && near(cc, 0.0) && !near(e, 0.0) {
            let x0 = -d / (2.0 * a);
            let y0 = -(a * x0 * x0 + d * x0 + f) / e;
            let p = -e / (4.0 * a);
            out.push(fact("圆锥曲线", name, "\\text{抛物线（开口沿 y 轴）}".into(), None, "(x-x_0)^2 = 4p(y-y_0)", "配方"));
            out.push(fact("圆锥曲线", "\\text{顶点}", pt(x0, y0), None, "", "配方").with(Shape::Point { x: x0, y: y0, label: "顶点".into() }));
            out.push(fact("圆锥曲线", "\\text{焦点}", pt(x0, y0 + p), None, "F(x_0,\\ y_0 + p)", "焦点").with(Shape::Point { x: x0, y: y0 + p, label: "焦点 F".into() }));
            out.push(fact("圆锥曲线", "\\text{准线}", format!("y = {}", nice_short(y0 - p)), None, "y = y_0 - p", "准线"));
        } else {
            out.push(fact("圆锥曲线", name, "\\text{抛物线型（退化或斜置）}".into(), None, "B^2 - 4AC = 0", "判别式"));
        }
        return out;
    }
    let x0 = (b * e - 2.0 * cc * d) / det;
    let y0 = (b * d - 2.0 * a * e) / det;
    let f0 = a * x0 * x0 + b * x0 * y0 + cc * y0 * y0 + d * x0 + e * y0 + f;
    let tr = a + cc;
    let disc = ((a - cc).powi(2) + b * b).sqrt();
    let l1 = (tr + disc) / 2.0;
    let l2 = (tr - disc) / 2.0;
    let theta = 0.5 * b.atan2(a - cc);
    if det > 0.0 {
        if (f0 > 0.0 && l1 > 0.0) || (f0 < 0.0 && l1 < 0.0) {
            out.push(fact("圆锥曲线", name, "\\text{无实点（虚椭圆）}".into(), None, "", "配方后右侧为负"));
            return out;
        }
        if near(f0, 0.0) {
            out.push(fact("圆锥曲线", name, "\\text{退化为一点}".into(), None, "", "").with(Shape::Point { x: x0, y: y0, label: "点".into() }));
            return out;
        }
        let r1 = (-f0 / l1).sqrt();
        let r2 = (-f0 / l2).sqrt();
        if near(a, cc) && near(b, 0.0) {
            out.push(fact("圆锥曲线", name, "\\text{圆}".into(), None, "(x-a)^2 + (y-b)^2 = r^2", "配方"));
            out.push(fact("圆锥曲线", "\\text{圆心}", pt(x0, y0), None, "\\left(-\\frac{D}{2},\\ -\\frac{E}{2}\\right)", "配方").with(Shape::Point { x: x0, y: y0, label: "圆心".into() }));
            out.push(fact("圆锥曲线", "r", nice(r1), Some(r1), "r = \\frac12\\sqrt{D^2 + E^2 - 4F}", "半径"));
            let area = PI * r1 * r1;
            out.push(fact("圆锥曲线", "S", nice(area), Some(area), "\\pi r^2", "圆面积"));
            out.push(fact("圆锥曲线", "C", nice(2.0 * PI * r1), Some(2.0 * PI * r1), "2\\pi r", "周长"));
            let d0 = x0.hypot(y0);
            let rel = if near(d0, r1) { "原点在圆上" } else if d0 < r1 { "原点在圆内" } else { "原点在圆外" };
            out.push(fact("圆锥曲线", "O", format!("\\text{{{}}}", rel), None, "|OC| \\text{ vs } r", "比较距离与半径"));
            return out;
        }
        // semi-major is the larger radius; r1 belongs to l1 (larger eigenvalue => smaller radius)
        let (big, small, ang) = if r2 >= r1 { (r2, r1, theta + PI / 2.0) } else { (r1, r2, theta) };
        let cfoc = (big * big - small * small).sqrt();
        let ecc = cfoc / big;
        out.push(fact("圆锥曲线", name, "\\text{椭圆}".into(), None, "\\frac{x'^2}{a^2} + \\frac{y'^2}{b^2} = 1", "判别式 B^2 - 4AC < 0"));
        out.push(fact("圆锥曲线", "\\text{中心}", pt(x0, y0), None, "\\nabla F = 0", "求中心").with(Shape::Point { x: x0, y: y0, label: "中心".into() }));
        out.push(fact("圆锥曲线", "a", nice(big), Some(big), "", "长半轴"));
        out.push(fact("圆锥曲线", "b", nice(small), Some(small), "", "短半轴"));
        out.push(fact("圆锥曲线", "c", nice(cfoc), Some(cfoc), "c^2 = a^2 - b^2", "半焦距"));
        out.push(fact("圆锥曲线", "e", nice(ecc), Some(ecc), "e = \\frac{c}{a}", "离心率"));
        let (fx, fy) = (cfoc * ang.cos(), cfoc * ang.sin());
        out.push(fact("圆锥曲线", "F_1", pt(x0 + fx, y0 + fy), None, "", "焦点").with(Shape::Point { x: x0 + fx, y: y0 + fy, label: "F₁".into() }));
        out.push(fact("圆锥曲线", "F_2", pt(x0 - fx, y0 - fy), None, "", "焦点").with(Shape::Point { x: x0 - fx, y: y0 - fy, label: "F₂".into() }));
        out.push(fact("圆锥曲线", "S", nice(PI * big * small), Some(PI * big * small), "\\pi a b", "椭圆面积"));
    } else {
        if near(f0, 0.0) {
            out.push(fact("圆锥曲线", name, "\\text{退化为两条相交直线}".into(), None, "", ""));
            return out;
        }
        // hyperbola: transverse axis along the eigen-direction where -f0/λ > 0
        let (lt, lc_, ang) = if -f0 / l1 > 0.0 { (l1, l2, theta) } else { (l2, l1, theta + PI / 2.0) };
        let at = (-f0 / lt).sqrt();
        let bt = (f0 / lc_).sqrt();
        let cfoc = (at * at + bt * bt).sqrt();
        out.push(fact("圆锥曲线", name, "\\text{双曲线}".into(), None, "\\frac{x'^2}{a^2} - \\frac{y'^2}{b^2} = 1", "判别式 B^2 - 4AC > 0"));
        out.push(fact("圆锥曲线", "\\text{中心}", pt(x0, y0), None, "", "求中心").with(Shape::Point { x: x0, y: y0, label: "中心".into() }));
        out.push(fact("圆锥曲线", "a", nice(at), Some(at), "", "实半轴"));
        out.push(fact("圆锥曲线", "b", nice(bt), Some(bt), "", "虚半轴"));
        out.push(fact("圆锥曲线", "e", nice(cfoc / at), Some(cfoc / at), "e = \\frac{c}{a},\\ c^2 = a^2 + b^2", "离心率"));
        let (fx, fy) = (cfoc * ang.cos(), cfoc * ang.sin());
        out.push(fact("圆锥曲线", "F_1", pt(x0 + fx, y0 + fy), None, "", "焦点").with(Shape::Point { x: x0 + fx, y: y0 + fy, label: "F₁".into() }));
        out.push(fact("圆锥曲线", "F_2", pt(x0 - fx, y0 - fy), None, "", "焦点").with(Shape::Point { x: x0 - fx, y: y0 - fy, label: "F₂".into() }));
        if near(b, 0.0) {
            let k = bt / at;
            let k = if near(ang.sin(), 0.0) { k } else { 1.0 / k };
            out.push(fact("圆锥曲线", "\\text{渐近线}", format!("y - {} = \\pm {}(x - {})", nice_short(y0), nice_short(k), nice_short(x0)), None, "y = \\pm\\frac{b}{a}x", "渐近线"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn right_triangle() {
        let k = TriangleKnown { a: Some(3.0), b: Some(4.0), angle_c: Some(PI / 2.0), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none());
        let c = r.cases[0].facts.iter().find(|f| f.label == "c").unwrap();
        assert!((c.num.unwrap() - 5.0).abs() < 1e-9);
        let s = r.cases[0].facts.iter().find(|f| f.label == "S").unwrap();
        assert!((s.num.unwrap() - 6.0).abs() < 1e-9);
    }

    #[test]
    fn ssa_two_solutions() {
        let k = TriangleKnown { a: Some(6.0), b: Some(8.0), angle_a: Some(PI / 6.0), ..Default::default() };
        let r = triangle_solve(&k);
        assert_eq!(r.cases.len(), 2);
    }

    #[test]
    fn nice_forms() {
        assert_eq!(nice(2f64.sqrt() * 3.0), "3\\sqrt{2} \\approx 4.2426");
        assert_eq!(nice(0.5), "\\frac{1}{2} = 0.5");
        assert_eq!(nice(5.0), "5");
    }

    #[test]
    fn circle() {
        // x^2 + y^2 - 4x + 2y - 4 = 0  => centre (2,-1), r = 3
        let f = conic_analyze([1.0, 0.0, 1.0, -4.0, 2.0, -4.0], "C");
        let r = f.iter().find(|f| f.label == "r").unwrap();
        assert!((r.num.unwrap() - 3.0).abs() < 1e-9);
    }
}
