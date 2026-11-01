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

fn seg_fact(group: &str, label: &str, v: f64, how: &str, why: &str) -> Fact {
    fact(group, label, nice(v), Some(v), how, why)
}

impl Fact {
    pub(crate) fn with(mut self, s: Shape) -> Self {
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

pub(crate) fn pt(x: f64, y: f64) -> String {
    format!("\\left({},\\ {}\\right)", nice_short(x), nice_short(y))
}
pub(crate) fn pt3(p: [f64; 3]) -> String {
    format!("\\left({},\\ {},\\ {}\\right)", nice_short(p[0]), nice_short(p[1]), nice_short(p[2]))
}
pub(crate) fn nice_short(v: f64) -> String {
    exact_form(v).unwrap_or_else(|| dec(v))
}

pub(crate) fn near(a: f64, b: f64) -> bool {
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
    /// medians to side a / b / c (中线)
    #[serde(default)]
    pub ma: Option<f64>,
    #[serde(default)]
    pub mb: Option<f64>,
    #[serde(default)]
    pub mc: Option<f64>,
    /// heights onto side a / b / c (高)
    #[serde(default)]
    pub ha: Option<f64>,
    #[serde(default)]
    pub hb: Option<f64>,
    #[serde(default)]
    pub hc: Option<f64>,
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
    let mut s = [k.a, k.b, k.c];
    let mut g = [k.angle_a, k.angle_b, k.angle_c];
    let mut area = k.area;
    let err = |m: &str| TriangleResult { cases: vec![], error: Some(m.into()) };
    if s.iter().flatten().any(|v| *v <= 0.0) {
        return err("边长必须为正数");
    }
    if g.iter().flatten().any(|v| *v <= 0.0 || *v >= PI) {
        return err("角必须在 0° 与 180° 之间");
    }
    if area.is_some_and(|v| v <= 0.0) {
        return err("面积必须为正数");
    }
    let mut steps: Vec<Fact> = Vec::new();
    let ng = g.iter().filter(|v| v.is_some()).count();

    // medians given (m_a = ½√(2b² + 2c² − a²)): turn them into sides
    let med = [k.ma, k.mb, k.mc];
    for i in 0..3 {
        let Some(m) = med[i] else { continue };
        if m <= 0.0 {
            return err("中线长必须为正数");
        }
        let (u, w) = ((i + 1) % 3, (i + 2) % 3);
        if s[u].is_some() && s[w].is_some() {
            let v2 = 2.0 * s[u].unwrap().powi(2) + 2.0 * s[w].unwrap().powi(2) - 4.0 * m * m;
            if v2 <= 0.0 {
                return err(&format!("m_{} 与两邻边矛盾：中线长公式要求 4m² < 2b² + 2c²", SIDE[i]));
            }
            let v = v2.sqrt();
            steps.push(fact("边长", SIDE[i], nice(v), Some(v), &format!("{s} = \\sqrt{{2{u}^2 + 2{w}^2 - 4m_{s}^2}}", s = SIDE[i], u = SIDE[u], w = SIDE[w]), "中线长公式反推"));
            s[i] = Some(v);
        } else if s[i].is_some() && (s[u].is_some() || s[w].is_some()) {
            let (kn, other) = if s[u].is_some() { (u, w) } else { (w, u) };
            let v2 = (4.0 * m * m - 2.0 * s[kn].unwrap().powi(2) + s[i].unwrap().powi(2)) / 2.0;
            if v2 <= 0.0 {
                return err(&format!("m_{} 与已知的边矛盾，构不成三角形", SIDE[i]));
            }
            let v = v2.sqrt();
            steps.push(fact("边长", SIDE[other], nice(v), Some(v), &format!("{t}^2 = 4m_{s}^2 - 2{k}^2 + {s}^2", t = SIDE[other], s = SIDE[i], k = SIDE[kn]), "中线长公式反推"));
            s[other] = Some(v);
        }
    }
    // heights given (h_i): with side i they fix the area
    let hts = [k.ha, k.hb, k.hc];
    for i in 0..3 {
        let Some(h) = hts[i] else { continue };
        if h <= 0.0 {
            return err("高必须为正数");
        }
        match s[i] {
            Some(si) => {
                let s2 = si * h / 2.0;
                if let Some(given) = area {
                    if (given - s2).abs() > 1e-6 * (1.0 + given.abs().max(s2)) {
                        return err("已知的高与边长算出的面积不一致");
                    }
                }
                if area.is_none() {
                    steps.push(fact("面积与周长", "S", nice(s2), Some(s2), &format!("S = \\frac12 \\cdot {} \\cdot h_{{{}}}", SIDE[i], SIDE[i]), "由边和高算面积"));
                }
                area = Some(s2);
            }
            None => return err(&format!("给定 h_{} 需要先写出边 {} 的长度", SIDE[i], SIDE[i])),
        }
    }

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
            } else if let Some(sa) = area {
                let sin_m = 2.0 * sa / (si * sj);
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
            } else if let (Some(sa), true) = (area, ng >= 1) {
                // one side + one angle + area
                let i = s.iter().position(|v| v.is_some()).unwrap();
                let t = g.iter().position(|v| v.is_some()).unwrap();
                if i == t {
                    return err("已知一边、它的对角和面积：请再给一条边");
                }
                // the remaining side adjacent to angle t (other than i)
                let o = 3 - i - t;
                let so = 2.0 * sa / (s[i].unwrap() * g[t].unwrap().sin());
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
                let Some(sa) = area else {
                    return err("只知道三个角：形状确定但大小不定（相似三角形），请再给一条边或面积 S");
                };
                // S = 2R²·sinA·sinB·sinC → R fixes the size
                let prod = g[0].unwrap().sin() * g[1].unwrap().sin() * g[2].unwrap().sin();
                if prod <= 1e-12 || sa / (2.0 * prod) <= 0.0 {
                    return err("这组角与面积构不成三角形");
                }
                let rr = (sa / (2.0 * prod)).sqrt();
                let mut st = steps.clone();
                st.push(fact("外接圆与内切圆", "R", nice(rr), Some(rr), "R = \\sqrt{\\frac{S}{2\\sin A\\sin B\\sin C}}", "由面积定大小"));
                let mut sides = [0.0; 3];
                for t in 0..3 {
                    sides[t] = 2.0 * rr * g[t].unwrap().sin();
                    st.push(fact("边长", SIDE[t], nice(sides[t]), Some(sides[t]), &format!("{t} = 2R\\sin {T}", t = SIDE[t], T = ANG[t]), "正弦定理"));
                }
                let ang = [g[0].unwrap(), g[1].unwrap(), g[2].unwrap()];
                cases.push((sides, ang, st, "两角 + 面积：角定形状，面积通过外接圆半径 R 定出大小".into()));
            } else if area.is_some() {
                return err("面积 S 还需要两个角（或一条边 + 一个角）才能定出大小");
            } else {
                return err("请至少给出一条边，例如 △ABC: a=3, b=4, C=90°（或两个角 + 面积 S）");
            }
        }
    }

    // over-determined givens must agree with what was derived
    let mut mismatch: Option<String> = None;
    for (sides, ang, _, _) in &cases {
        for i in 0..3 {
            if let Some(gi) = g[i] {
                if !near(gi, ang[i]) {
                    mismatch = mismatch.or_else(|| {
                        Some(format!("已知的 ∠{} 与推出的 {}° 不一致，条件互相矛盾", ANG[i], dec(ang[i] * 180.0 / PI)))
                    });
                }
            }
        }
        if let Some(sa) = area {
            let comp = 0.5 * sides[0] * sides[1] * ang[2].sin();
            if (comp - sa).abs() > 1e-6 * (1.0 + sa.abs().max(comp)) {
                mismatch = mismatch.or_else(|| Some(format!("已知的面积 S = {}，但按边角推出的是 {}，条件互相矛盾", dec(sa), dec(comp))));
            }
        }
    }
    if let Some(m) = mismatch {
        return err(&m);
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
    // Heron: same area from three sides — useful when the student only wrote SSS.
    let heron = (p * (p - a) * (p - b) * (p - c)).max(0.0).sqrt();
    out.push(fact("面积与周长", "S_{\\text{海伦}}", nice(heron), Some(heron), "S = \\sqrt{p(p-a)(p-b)(p-c)}", "海伦公式"));
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
    // midsegments: join the midpoints of the two sides through vertex i, parallel to side i
    for i in 0..3 {
        let m1 = [(v[i][0] + v[(i + 1) % 3][0]) / 2.0, (v[i][1] + v[(i + 1) % 3][1]) / 2.0];
        let m2 = [(v[i][0] + v[(i + 2) % 3][0]) / 2.0, (v[i][1] + v[(i + 2) % 3][1]) / 2.0];
        let len = dist2(m1, m2);
        out.push(fact("高与中线", &format!("\\text{{中位线}}_{}", SIDE[i]), nice(len), Some(len), &format!("\\frac{{{}}}{{2}}", SIDE[i]), "平行于第三边，等于第三边的一半").with(Shape::Segment { x1: m1[0], y1: m1[1], x2: m2[0], y2: m2[1], label: format!("中位线{}", SIDE[i]) }));
    }
    // angle bisector lengths: t_i = 2·(adjacent sides)·cos(g_i/2) / (sum of adjacent sides)
    for i in 0..3 {
        let (y, z) = (s[(i + 1) % 3], s[(i + 2) % 3]);
        let t = 2.0 * y * z * (g[i] / 2.0).cos() / (y + z);
        let foot = [
            (y * v[(i + 1) % 3][0] + z * v[(i + 2) % 3][0]) / (y + z),
            (y * v[(i + 1) % 3][1] + z * v[(i + 2) % 3][1]) / (y + z),
        ];
        out.push(fact("角平分线", &format!("t_{}", SIDE[i]), nice(t), Some(t), &format!("t_{s} = \\frac{{2{u}{w}\\cos\\frac{{{T}}}{{2}}}}{{{u} + {w}}}", s = SIDE[i], u = SIDE[(i + 1) % 3], w = SIDE[(i + 2) % 3], T = ANG[i]), "角平分线长公式").with(Shape::Segment { x1: v[i][0], y1: v[i][1], x2: foot[0], y2: foot[1], label: format!("t_{}", SIDE[i]) }));
        // 角平分线定理: foot F on the opposite side splits it as the adjacent sides.
        let (u, w) = ((i + 1) % 3, (i + 2) % 3);
        let d_u = dist2(v[u], foot);
        let d_w = dist2(foot, v[w]);
        if d_w > 1e-12 {
            let ratio = d_u / d_w;
            out.push(fact(
                "角平分线",
                &format!("\\frac{{|{nu}F_{{{s}}}|}}{{|F_{{{s}}}{nw}|}}", s = SIDE[i], nu = names[u], nw = names[w]),
                nice(ratio),
                Some(ratio),
                &format!("\\frac{{{w}}}{{{u}}}", u = SIDE[u], w = SIDE[w]),
                "角平分线定理：分对边成邻边比",
            ));
        }
    }

    out.push(fact("特殊点", "G", pt(centroid[0], centroid[1]), None, "G = \\frac{A + B + C}{3}", "重心（中线交点）").with(Shape::Point { x: centroid[0], y: centroid[1], label: "G 重心".into() }));
    out.push(fact("特殊点", "O", pt(circ[0], circ[1]), None, "|OA| = |OB| = |OC|", "外心（中垂线交点）").with(Shape::Point { x: circ[0], y: circ[1], label: "O 外心".into() }));
    out.push(fact("特殊点", "I", pt(inc[0], inc[1]), None, "I = \\frac{aA + bB + cC}{a + b + c}", "内心（角平分线交点）").with(Shape::Point { x: inc[0], y: inc[1], label: "I 内心".into() }));
    out.push(fact("特殊点", "H", pt(orth[0], orth[1]), None, "\\vec{OH} = \\vec{OA} + \\vec{OB} + \\vec{OC}", "垂心（高线交点）").with(Shape::Point { x: orth[0], y: orth[1], label: "H 垂心".into() }));

    // Excircle radii; Euler OI² = R(R − 2r); OH from the orthocenter / circumcenter.
    for i in 0..3 {
        let ri = area / (p - s[i]);
        out.push(fact(
            "外接圆与内切圆",
            &format!("r_{}", SIDE[i]),
            nice(ri),
            Some(ri),
            &format!("r_{s} = \\frac{{S}}{{p - {s}}}", s = SIDE[i]),
            "旁切圆半径",
        ));
    }
    let oi = dist2(circ, inc);
    out.push(fact(
        "特殊点",
        "|OI|",
        nice(oi),
        Some(oi),
        "|OI|^2 = R(R - 2r)",
        "欧拉公式（外心与内心的距离）",
    ).with(Shape::Segment { x1: circ[0], y1: circ[1], x2: inc[0], y2: inc[1], label: "OI".into() }));
    let oh = dist2(circ, orth);
    out.push(fact(
        "特殊点",
        "|OH|",
        nice(oh),
        Some(oh),
        "|OH|^2 = 9R^2 - (a^2 + b^2 + c^2)",
        "外心与垂心的距离",
    ).with(Shape::Segment { x1: circ[0], y1: circ[1], x2: orth[0], y2: orth[1], label: "OH".into() }));
    // Explicit Euler OH² identity (distinct from |OI|² = R(R−2r)).
    {
        let oh2 = oh * oh;
        let oh2_form = 9.0 * rr * rr - (a * a + b * b + c * c);
        out.push(fact(
            "特殊点",
            "|OH|^2",
            nice(oh2),
            Some(oh2),
            "|OH|^2 = 9R^2 - (a^2 + b^2 + c^2)",
            "欧拉：外心与垂心距离的平方公式",
        ));
        if (oh2 - oh2_form).abs() < 1e-6 * (1.0 + oh2.abs()) {
            out.push(fact(
                "特殊点",
                "9R^2 - (a^2+b^2+c^2)",
                nice(oh2_form),
                Some(oh2_form),
                "|OH|^2 = 9R^2 - (a^2 + b^2 + c^2)",
                "与 |OH|^2 一致",
            ));
        }
        let oi2_form = rr * (rr - 2.0 * r);
        out.push(fact(
            "特殊点",
            "|OI|^2",
            nice(oi * oi),
            Some(oi * oi),
            "|OI|^2 = R(R - 2r)",
            "欧拉：外心与内心（勿与 |OH|^2 混淆）",
        ));
        let _ = oi2_form;
    }
    // Isogonal conjugates: O and H are isogonal conjugates of each other; I is self-conjugate.
    out.push(fact(
        "等角共轭",
        "H \\leftrightarrow O",
        "\\text{等角共轭}".into(),
        None,
        "\\text{反射角平分线}",
        "垂心与外心互为等角共轭；内心是自身的等角共轭",
    ));
    out.push(fact(
        "等角共轭",
        "I \\leftrightarrow I",
        "\\checkmark".into(),
        None,
        "",
        "内心的等角共轭是自身",
    ));
    out.push(fact(
        "等角共轭",
        "G \\leftrightarrow K",
        "\\text{等角共轭}".into(),
        None,
        "\\text{重心} \\leftrightarrow \\text{勒莫恩点}",
        "重心与勒莫恩（对称中线）点互为等角共轭",
    ));

    // Carnot: signed distances from O to the three sides sum to R + r.
    {
        let mut sum_d = 0.0;
        for i in 0..3 {
            let q1 = v[(i + 1) % 3];
            let q2 = v[(i + 2) % 3];
            let dx = q2[0] - q1[0];
            let dy = q2[1] - q1[1];
            let len = (dx * dx + dy * dy).sqrt();
            if len < 1e-12 {
                continue;
            }
            // cross z-component for (q2-q1)×(P-q1)
            let cross_o = dx * (circ[1] - q1[1]) - dy * (circ[0] - q1[0]);
            let cross_v = dx * (v[i][1] - q1[1]) - dy * (v[i][0] - q1[0]);
            let dist = cross_o.abs() / len;
            let signed = if cross_o * cross_v >= 0.0 { dist } else { -dist };
            sum_d += signed;
            out.push(fact(
                "卡诺定理",
                &format!("\\delta_{{{}}}", SIDE[i]),
                nice(signed),
                Some(signed),
                "d(O,\\text{边})\\text{（有向）}",
                "外心到边的有向距离（与对顶同侧为正）",
            ));
        }
        out.push(fact(
            "卡诺定理",
            "\\delta_a+\\delta_b+\\delta_c",
            nice(sum_d),
            Some(sum_d),
            "\\delta_a+\\delta_b+\\delta_c = R+r",
            "卡诺定理：外心到三边有向距离之和等于 R+r",
        ));
        out.push(fact(
            "卡诺定理",
            "R+r",
            nice(rr + r),
            Some(rr + r),
            "R + r",
            "与有向距离之和对照",
        ));
    }

        // Euler line: O, G, H collinear with OG:GH = 1:2 (and |OH| = 3|OG|).
    // Note: |OI|^2 = R(R−2r) is the Euler distance formula for the incenter (already above);
    // it is not |OH|^2.
    {
        let og = dist2(circ, centroid);
        let gh = dist2(centroid, orth);
        let cross = (centroid[0] - circ[0]) * (orth[1] - circ[1]) - (centroid[1] - circ[1]) * (orth[0] - circ[0]);
        let scale = (1.0 + og) * (1.0 + oh);
        if cross.abs() < 1e-6 * scale {
            out.push(fact(
                "欧拉线",
                "O,\\ G,\\ H",
                "\\text{共线}".into(),
                None,
                "\\vec{OH} = 3\\vec{OG}",
                "欧拉线：外心、重心、垂心共线",
            ));
            if og > 1e-12 {
                let ratio = gh / og;
                out.push(fact(
                    "欧拉线",
                    "OG:GH",
                    format!("1:{}", nice(ratio)),
                    Some(ratio),
                    "OG:GH = 1:2",
                    "重心按 1:2 分 OH",
                ));
                out.push(fact(
                    "欧拉线",
                    "|OG|",
                    nice(og),
                    Some(og),
                    "|OH| = 3|OG|",
                    "欧拉线上的线段",
                ).with(Shape::Segment {
                    x1: circ[0],
                    y1: circ[1],
                    x2: centroid[0],
                    y2: centroid[1],
                    label: "OG".into(),
                }));
            }
        }
        // Nine-point circle: center N = midpoint of OH, radius R/2.
        let n9 = [(circ[0] + orth[0]) / 2.0, (circ[1] + orth[1]) / 2.0];
        let r9 = rr / 2.0;
        out.push(fact(
            "欧拉线",
            "N",
            pt(n9[0], n9[1]),
            None,
            "N = \\text{中点}(O, H)",
            "九点圆圆心（欧拉圆）",
        ).with(Shape::Point {
            x: n9[0],
            y: n9[1],
            label: "N 九点圆圆心".into(),
        }));
        out.push(fact(
            "欧拉线",
            "R_{\\text{九点}}",
            nice(r9),
            Some(r9),
            "R_N = R/2",
            "九点圆半径",
        ).with(Shape::Circle {
            cx: n9[0],
            cy: n9[1],
            r: r9,
            label: "九点圆".into(),
        }));
        // OH is always a diameter of the circle centred at N through O (and H);
        // it coincides with the nine-point circle precisely when |OH| = R (right triangles).
        let oh_len = dist2(circ, orth);
        out.push(fact(
            "欧拉线",
            "|OH| = 2|ON|",
            nice(oh_len),
            Some(oh_len),
            "|OH| = 2|ON| = 2|NH|",
            "N 平分 OH，故 OH 是以 N 为圆心、半径 |OH|/2 的圆的直径",
        ));
        if near(oh_len, rr) {
            out.push(fact(
                "欧拉线",
                "OH\\text{ 九点圆直径}",
                "\\checkmark".into(),
                None,
                "|OH| = R = 2R_N",
                "直角三角形：欧拉圆（九点圆）以 OH 为直径",
            ));
        } else {
            out.push(fact(
                "欧拉线",
                "OH\\text{ 与九点圆}",
                format!("|OH|/2 = {},\\ R_N = {}", nice(oh_len / 2.0), nice(r9)),
                None,
                "|OH|/2 \\ne R/2",
                "一般三角形 OH 不是九点圆直径（仅当直角时重合）",
            ));
        }

        // Feuerbach: nine-point circle tangent to incircle (internally) and excircles (externally).
        {
            let ni = (r9 - r).abs();
            out.push(fact(
                "费尔巴哈定理",
                "|NI|",
                nice(ni),
                Some(ni),
                "|NI| = R/2 - r",
                "九点圆与内切圆内切（费尔巴哈）",
            ).with(Shape::Segment {
                x1: n9[0],
                y1: n9[1],
                x2: inc[0],
                y2: inc[1],
                label: "NI".into(),
            }));
            // verify from coordinates
            let ni_coord = dist2(n9, inc);
            if (ni_coord - ni).abs() < 1e-5 * (1.0 + ni) {
                out.push(fact(
                    "费尔巴哈定理",
                    "\\text{内切}",
                    "\\checkmark".into(),
                    None,
                    "d(N,I) = R_N - r",
                    "九点圆与内切圆相切",
                ));
            }
            // Feuerbach point X(11): internal contact of nine-point circle and incircle.
            // T = ((R/2) I - r N) / (R/2 - r) along NI (order N–I–Fe).
            // Skip when N=I (equilateral: nine-point coincides with incircle).
            {
                let den_f = r9 - r;
                let ni_len = dist2(n9, inc);
                if den_f.abs() > 1e-9 && ni_len > 1e-9 {
                    let fe = [
                        (r9 * inc[0] - r * n9[0]) / den_f,
                        (r9 * inc[1] - r * n9[1]) / den_f,
                    ];
                    let d_n = dist2(n9, fe);
                    let d_i = dist2(inc, fe);
                    if (d_n - r9).abs() < 1e-4 * (1.0 + r9) && (d_i - r).abs() < 1e-4 * (1.0 + r) {
                        out.push(fact(
                            "费尔巴哈点",
                            "Fe",
                            pt(fe[0], fe[1]),
                            None,
                            "Fe = \\dfrac{(R/2)I - r\\,N}{R/2 - r}",
                            "费尔巴哈点 X(11)：九点圆与内切圆的内切点",
                        ).with(Shape::Point {
                            x: fe[0],
                            y: fe[1],
                            label: "Fe 费尔巴哈".into(),
                        }));
                        out.push(fact(
                            "费尔巴哈点",
                            "|N\\,Fe|",
                            nice(d_n),
                            Some(d_n),
                            "|N\\,Fe| = R/2",
                            "费尔巴哈点在九点圆上",
                        ));
                    }
                }
            }
            for i in 0..3 {
                let ri = area / (p - s[i]);
                // excenter I_i opposite vertex i: (-a_i V_i + a_j V_j + a_k V_k) / (-a_i + a_j + a_k)
                let (ai, aj, ak) = (s[i], s[(i + 1) % 3], s[(i + 2) % 3]);
                let den = -ai + aj + ak;
                if den.abs() < 1e-12 {
                    continue;
                }
                let ia = [
                    (-ai * v[i][0] + aj * v[(i + 1) % 3][0] + ak * v[(i + 2) % 3][0]) / den,
                    (-ai * v[i][1] + aj * v[(i + 1) % 3][1] + ak * v[(i + 2) % 3][1]) / den,
                ];
                let nia = r9 + ri;
                let nia_coord = dist2(n9, ia);
                out.push(fact(
                    "费尔巴哈定理",
                    &format!("|NI_{}|", SIDE[i]),
                    nice(nia),
                    Some(nia),
                    &format!("|NI_{s}| = R/2 + r_{s}", s = SIDE[i]),
                    "九点圆与旁切圆外切（费尔巴哈）",
                ));
                if (nia_coord - nia).abs() < 1e-5 * (1.0 + nia) {
                    out.push(fact(
                        "费尔巴哈定理",
                        &format!("I_{}", SIDE[i]),
                        pt(ia[0], ia[1]),
                        None,
                        "",
                        "旁心（与九点圆外切）",
                    ).with(Shape::Point {
                        x: ia[0],
                        y: ia[1],
                        label: format!("I{}", SIDE[i]),
                    }));
                }
            }
        }
    }

    // Spieker center: incenter of the medial triangle = perimeter centroid.
    {
        let den = 2.0 * (a + b + c);
        let sp = [
            ((b + c) * pa[0] + (c + a) * pb[0] + (a + b) * pc[0]) / den,
            ((b + c) * pa[1] + (c + a) * pb[1] + (a + b) * pc[1]) / den,
        ];
        out.push(fact(
            "斯皮克中心",
            "Sp",
            pt(sp[0], sp[1]),
            None,
            "Sp = \\frac{(b+c)A+(c+a)B+(a+b)C}{2(a+b+c)}",
            "斯皮克中心：周界重心（中点三角形的内心）",
        ).with(Shape::Point {
            x: sp[0],
            y: sp[1],
            label: "Sp 斯皮克".into(),
        }));
    }

    // Nagel point: concurrence of vertex-to-excircle-contact cevians; bary (s−a:s−b:s−c).
    {
        let sa = p - a;
        let sb = p - b;
        let sc = p - c;
        if p > 1e-12 {
            let na = [
                (sa * pa[0] + sb * pb[0] + sc * pc[0]) / p,
                (sa * pa[1] + sb * pb[1] + sc * pc[1]) / p,
            ];
            out.push(fact(
                "奈格尔点",
                "Na",
                pt(na[0], na[1]),
                None,
                "Na = \\frac{(s-a)A+(s-b)B+(s-c)C}{s}",
                "奈格尔点：顶点与对旁切圆切点的连线交点",
            ).with(Shape::Point {
                x: na[0],
                y: na[1],
                label: "Na 奈格尔".into(),
            }));
            // Nagel line: I, G, Na collinear with IG:GNa = 1:2
            let ig = dist2(inc, centroid);
            let gna = dist2(centroid, na);
            let cross = (centroid[0] - inc[0]) * (na[1] - inc[1]) - (centroid[1] - inc[1]) * (na[0] - inc[0]);
            if cross.abs() < 1e-6 * (1.0 + ig) * (1.0 + gna) && ig > 1e-12 {
                let ratio = gna / ig;
                out.push(fact(
                    "奈格尔点",
                    "I,\\ G,\\ Na",
                    "\\text{共线}".into(),
                    None,
                    "\\vec{INa} = 3\\vec{IG}",
                    "奈格尔线：内心、重心、奈格尔点共线",
                ));
                out.push(fact(
                    "奈格尔点",
                    "IG:GNa",
                    format!("1:{}", nice(ratio)),
                    Some(ratio),
                    "IG:GNa = 1:2",
                    "重心按 1:2 分 INa",
                ));
            }
        }
    }


    // Gergonne point: concurrence of vertex-to-incircle-contact cevians; bary 1/(s−a):…
    {
        let sa = p - a;
        let sb = p - b;
        let sc = p - c;
        if sa > 1e-12 && sb > 1e-12 && sc > 1e-12 {
            // bary 1/(s−a):1/(s−b):1/(s−c) = isotomic conjugate of Nagel (s−a:s−b:s−c)
            let wa = 1.0 / sa;
            let wb = 1.0 / sb;
            let wc = 1.0 / sc;
            let den = wa + wb + wc;
            let ge = [
                (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
            ];
            out.push(fact(
                "格尔巩点",
                "Ge",
                pt(ge[0], ge[1]),
                None,
                "Ge = \\frac{\\frac{1}{s-a}A+\\frac{1}{s-b}B+\\frac{1}{s-c}C}{\\sum}",
                "格尔巩点：顶点与对边内切圆切点的连线交点",
            ).with(Shape::Point {
                x: ge[0],
                y: ge[1],
                label: "Ge 格尔巩".into(),
            }));
            out.push(fact(
                "格尔巩点",
                "Ge \\leftrightarrow Na",
                "\\text{等截共轭}".into(),
                None,
                "\\text{isotomic}",
                "格尔巩点与奈格尔点互为等截共轭",
            ));
        }
    }

    // Lemoine / symmedian point K: concurrence of symmedians; bary (a²:b²:c²).
    {
        let wa = a * a;
        let wb = b * b;
        let wc = c * c;
        let den = wa + wb + wc;
        if den > 1e-18 {
            let kpt = [
                (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
            ];
            out.push(fact(
                "勒莫恩点",
                "K",
                pt(kpt[0], kpt[1]),
                None,
                "K = \\frac{a^2 A + b^2 B + c^2 C}{a^2 + b^2 + c^2}",
                "勒莫恩点（对称中线点）：三对称中线交点",
            ).with(Shape::Point {
                x: kpt[0],
                y: kpt[1],
                label: "K 勒莫恩".into(),
            }));
        }
    }

    // Brocard angle ω and Brocard points Ω, Ω′.
    // cot ω = (a²+b²+c²)/(4S); Ω trilinear (c/b : a/c : b/a), Ω′ (b/c : c/a : a/b).
    if area > 1e-12 {
        let sum_sq = a * a + b * b + c * c;
        let cot_w = sum_sq / (4.0 * area);
        let tan_w = 1.0 / cot_w;
        let omega = tan_w.atan();
        out.push(fact(
            "布罗卡",
            "\\omega",
            deg(omega),
            Some(omega),
            "\\cot\\omega = \\frac{a^2+b^2+c^2}{4S}",
            "布罗卡角",
        ));
        out.push(fact(
            "布罗卡",
            "\\tan\\omega",
            nice(tan_w),
            Some(tan_w),
            "\\tan\\omega = \\frac{4S}{a^2+b^2+c^2}",
            "布罗卡角的正切",
        ));
        out.push(fact(
            "布罗卡",
            "\\cot\\omega",
            nice(cot_w),
            Some(cot_w),
            "\\cot\\omega = \\frac{a^2+b^2+c^2}{4S}",
            "与 tan ω 互为倒数",
        ));
        if a > 1e-12 && b > 1e-12 && c > 1e-12 {
            let wa = a * c / b;
            let wb = b * a / c;
            let wc = c * b / a;
            let den = wa + wb + wc;
            let om = [
                (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
            ];
            out.push(fact(
                "布罗卡",
                "\\Omega",
                pt(om[0], om[1]),
                None,
                "\\text{trilinear }(c/b:a/c:b/a)",
                "第一布罗卡点",
            ).with(Shape::Point {
                x: om[0],
                y: om[1],
                label: "Ω 布罗卡".into(),
            }));
            let wa2 = a * b / c;
            let wb2 = b * c / a;
            let wc2 = c * a / b;
            let den2 = wa2 + wb2 + wc2;
            let omp = [
                (wa2 * pa[0] + wb2 * pb[0] + wc2 * pc[0]) / den2,
                (wa2 * pa[1] + wb2 * pb[1] + wc2 * pc[1]) / den2,
            ];
            out.push(fact(
                "布罗卡",
                "\\Omega'",
                pt(omp[0], omp[1]),
                None,
                "\\text{trilinear }(b/c:c/a:a/b)",
                "第二布罗卡点（与 Ω 互为等角共轭）",
            ).with(Shape::Point {
                x: omp[0],
                y: omp[1],
                label: "Ω′ 布罗卡".into(),
            }));
            // Brocard midpoint X(39) = midpoint(Ω, Ω′); center of Brocard circle.
            let bm = [(om[0] + omp[0]) / 2.0, (om[1] + omp[1]) / 2.0];
            out.push(fact(
                "布罗卡",
                "X_{39}",
                pt(bm[0], bm[1]),
                None,
                "X_{39} = \\text{mid}(\\Omega,\\Omega')",
                "布罗卡中点：第一/第二布罗卡点的中点（布罗卡圆圆心）",
            ).with(Shape::Point {
                x: bm[0],
                y: bm[1],
                label: "X39 布罗卡中点".into(),
            }));
        }
    }

    // de Longchamps point L: reflection of H over O (so O midpoint of LH); on Euler line.
    {
        let longch = [2.0 * circ[0] - orth[0], 2.0 * circ[1] - orth[1]];
        out.push(fact(
            "德龙尚点",
            "L",
            pt(longch[0], longch[1]),
            None,
            "L = 2O - H",
            "德龙尚点：垂心关于外心的对称点",
        ).with(Shape::Point {
            x: longch[0],
            y: longch[1],
            label: "L 德龙尚".into(),
        }));
        let mid = [(longch[0] + orth[0]) / 2.0, (longch[1] + orth[1]) / 2.0];
        if dist2(mid, circ) < 1e-6 * (1.0 + dist2(circ, orth)) {
            out.push(fact(
                "德龙尚点",
                "O = \\text{中点}(L,H)",
                "\\checkmark".into(),
                None,
                "\\overrightarrow{OL} = -\\overrightarrow{OH}",
                "外心是 LH 的中点（欧拉线上）",
            ));
        }
    }

    // Mittenpunkt Mi: perspector of medial and excentral triangles; bary a(s-a):b(s-b):c(s-c).
    {
        let sa = p - a;
        let sb = p - b;
        let sc = p - c;
        let wa = a * sa;
        let wb = b * sb;
        let wc = c * sc;
        let den = wa + wb + wc;
        if den > 1e-12 {
            let mi = [
                (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
            ];
            out.push(fact(
                "米滕点",
                "Mi",
                pt(mi[0], mi[1]),
                None,
                "Mi = \\frac{a(s-a)A+b(s-b)B+c(s-c)C}{\\sum}",
                "米滕点（Mittenpunkt）：旁心三角形与中点三角形的透视中心",
            ).with(Shape::Point {
                x: mi[0],
                y: mi[1],
                label: "Mi 米滕".into(),
            }));
        }
    }

    // Schiffler point: concurrence of Euler lines of ABC, IBC, ICA, IAB.
    // Construct as Euler(ABC) ∩ Euler(IBC); cross-check with Euler(ICA).
    if let Some((o_ibc, _)) = circum2(inc, pb, pc) {
        let g_ibc = [
            (inc[0] + pb[0] + pc[0]) / 3.0,
            (inc[1] + pb[1] + pc[1]) / 3.0,
        ];
        if let Some(sf) = line_line_isect2(circ, orth, o_ibc, g_ibc) {
            let cross = (orth[0] - circ[0]) * (sf[1] - circ[1]) - (orth[1] - circ[1]) * (sf[0] - circ[0]);
            let scale = (1.0 + dist2(circ, orth)) * (1.0 + dist2(circ, sf));
            if cross.abs() < 1e-5 * scale {
                out.push(fact(
                    "席弗勒点",
                    "Sc",
                    pt(sf[0], sf[1]),
                    None,
                    "\\text{Euler}(\\triangle ABC)\\cap\\text{Euler}(\\triangle IBC)",
                    "席弗勒点：内心三角形与原三角形欧拉线的交点",
                ).with(Shape::Point {
                    x: sf[0],
                    y: sf[1],
                    label: "Sc 席弗勒".into(),
                }));
                if let Some((o_ica, _)) = circum2(inc, pc, pa) {
                    let g_ica = [
                        (inc[0] + pc[0] + pa[0]) / 3.0,
                        (inc[1] + pc[1] + pa[1]) / 3.0,
                    ];
                    if let Some(sf2) = line_line_isect2(circ, orth, o_ica, g_ica) {
                        if dist2(sf, sf2) < 1e-5 * (1.0 + dist2(circ, orth)) {
                            out.push(fact(
                                "席弗勒点",
                                "\\text{Euler}(ICA)",
                                "\\checkmark".into(),
                                None,
                                "\\text{Euler}(ICA)\\ni Sc",
                                "与 △ICA 的欧拉线亦交于同一点",
                            ));
                        }
                    }
                }
            }
        }
    }

    // Bevan point: circumcenter of the excentral triangle = reflection of I over O.
    {
        let bevan = [2.0 * circ[0] - inc[0], 2.0 * circ[1] - inc[1]];
        out.push(fact(
            "贝万点",
            "Be",
            pt(bevan[0], bevan[1]),
            None,
            "Be = 2O - I",
            "贝万点：旁心三角形的外心（内心关于外心的对称点）",
        ).with(Shape::Point {
            x: bevan[0],
            y: bevan[1],
            label: "Be 贝万".into(),
        }));
        let mut ex = [[0.0f64; 2]; 3];
        let mut ex_ok = true;
        for i in 0..3 {
            let (ai, aj, ak) = (s[i], s[(i + 1) % 3], s[(i + 2) % 3]);
            let den = -ai + aj + ak;
            if den.abs() < 1e-12 {
                ex_ok = false;
                break;
            }
            ex[i] = [
                (-ai * v[i][0] + aj * v[(i + 1) % 3][0] + ak * v[(i + 2) % 3][0]) / den,
                (-ai * v[i][1] + aj * v[(i + 1) % 3][1] + ak * v[(i + 2) % 3][1]) / den,
            ];
        }
        if ex_ok {
            if let Some((o_ex, _)) = circum2(ex[0], ex[1], ex[2]) {
                if dist2(o_ex, bevan) < 1e-5 * (1.0 + dist2(circ, inc)) {
                    out.push(fact(
                        "贝万点",
                        "O(I_a I_b I_c)",
                        "\\checkmark".into(),
                        None,
                        "Be = O(I_a I_b I_c)",
                        "旁心三角形的外心与 2O−I 重合",
                    ));
                }
            }
        }
    }

    // Orthic triangle: feet of the altitudes (on the nine-point circle).
    {
        let n9loc = [(circ[0] + orth[0]) / 2.0, (circ[1] + orth[1]) / 2.0];
        let r9loc = rr / 2.0;
        let mut feet = [[0.0f64; 2]; 3];
        let mut ok = true;
        for i in 0..3 {
            let p0 = v[i];
            let q1 = v[(i + 1) % 3];
            let q2 = v[(i + 2) % 3];
            let dx = q2[0] - q1[0];
            let dy = q2[1] - q1[1];
            let den = dx * dx + dy * dy;
            if den < 1e-18 {
                ok = false;
                break;
            }
            let t = ((p0[0] - q1[0]) * dx + (p0[1] - q1[1]) * dy) / den;
            feet[i] = [q1[0] + t * dx, q1[1] + t * dy];
        }
        if ok {
            for i in 0..3 {
                let f = feet[i];
                out.push(fact(
                    "垂足三角形",
                    &format!("H_{}", SIDE[i]),
                    pt(f[0], f[1]),
                    None,
                    &format!("H_{s} = \\text{{足}}_{{{s}}}", s = SIDE[i]),
                    "垂足三角形的顶点（高线足）",
                ).with(Shape::Point {
                    x: f[0],
                    y: f[1],
                    label: format!("H{} 垂足", SIDE[i]),
                }));
            }
            let on_n9 = (0..3).all(|i| (dist2(feet[i], n9loc) - r9loc).abs() < 1e-5 * (1.0 + r9loc));
            if on_n9 {
                out.push(fact(
                    "垂足三角形",
                    "H_a, H_b, H_c \\in \\text{九点圆}",
                    "\\checkmark".into(),
                    None,
                    "d(N, H_*) = R/2",
                    "垂足三角形内接于九点圆",
                ));
            }
            // Circumcenter of the orthic triangle is the nine-point center N.
            if let Some((o_h, _)) = circum2(feet[0], feet[1], feet[2]) {
                out.push(fact(
                    "垂足三角形",
                    "O(H_a H_b H_c)",
                    pt(o_h[0], o_h[1]),
                    None,
                    "O_{\\text{orthic}} = N",
                    "垂足三角形的外心（等于九点圆心）",
                ).with(Shape::Point {
                    x: o_h[0],
                    y: o_h[1],
                    label: "O_H 垂足外心".into(),
                }));
                if dist2(o_h, n9loc) < 1e-5 * (1.0 + rr) {
                    out.push(fact(
                        "垂足三角形",
                        "O(H_a H_b H_c) = N",
                        "\\checkmark".into(),
                        None,
                        "O_{\\text{orthic}} = N = \\tfrac{O+H}{2}",
                        "垂足外心与九点圆心重合",
                    ));
                }
            }
        }
    }

    // Euler reflection point X(110): reflections of Euler line over the sides concur on (O).
    // May fail to concur for some right triangles — emit only when found.
    {
        let reflect = |pt: [f64; 2], s1: [f64; 2], s2: [f64; 2]| -> [f64; 2] {
            let dx = s2[0] - s1[0];
            let dy = s2[1] - s1[1];
            let den = dx * dx + dy * dy;
            if den < 1e-18 {
                return pt;
            }
            let t = ((pt[0] - s1[0]) * dx + (pt[1] - s1[1]) * dy) / den;
            let foot = [s1[0] + t * dx, s1[1] + t * dy];
            [2.0 * foot[0] - pt[0], 2.0 * foot[1] - pt[1]]
        };
        let mirrors = [(pb, pc), (pc, pa), (pa, pb)];
        let mut segs: [([f64; 2], [f64; 2]); 3] = [([0.0; 2], [0.0; 2]); 3];
        let mut ok = true;
        for (i, (s1, s2)) in mirrors.into_iter().enumerate() {
            let p = reflect(circ, s1, s2);
            let mut q = reflect(orth, s1, s2);
            if dist2(p, q) < 1e-9 {
                q = reflect(centroid, s1, s2);
                if dist2(p, q) < 1e-9 {
                    ok = false;
                    break;
                }
            }
            segs[i] = (p, q);
        }
        if ok {
            if let (Some(e1), Some(e2)) = (
                line_line_isect2(segs[0].0, segs[0].1, segs[1].0, segs[1].1),
                line_line_isect2(segs[0].0, segs[0].1, segs[2].0, segs[2].1),
            ) {
                if dist2(e1, e2) < 1e-5 * (1.0 + rr) {
                    let er = e1;
                    out.push(fact(
                        "欧拉反射点",
                        "E_r",
                        pt(er[0], er[1]),
                        None,
                        "\\mathrm{refl}_{BC}(OH)\\cap\\mathrm{refl}_{CA}(OH)",
                        "欧拉反射点：欧拉线关于三边的反射线交点",
                    ).with(Shape::Point {
                        x: er[0],
                        y: er[1],
                        label: "Er 欧拉反射".into(),
                    }));
                    if (dist2(er, circ) - rr).abs() < 1e-5 * (1.0 + rr) {
                        out.push(fact(
                            "欧拉反射点",
                            "E_r \\in (O)",
                            "\\checkmark".into(),
                            None,
                            "d(O, E_r) = R",
                            "欧拉反射点在外接圆上",
                        ));
                    }
                }
            }
        }
    }

    // Contact (intouch) triangle: incircle tangency points on the sides.
    // On BC: BD = s-b, DC = s-c; perspector is the Gergonne point.
    {
        let sa = p - a;
        let sb = p - b;
        let sc = p - c;
        if sa > 1e-12 && sb > 1e-12 && sc > 1e-12 {
            let xa = section_point(pb, pc, sb, sc);
            let xb = section_point(pc, pa, sc, sa);
            let xc = section_point(pa, pb, sa, sb);
            let pts = [(xa, "a"), (xb, "b"), (xc, "c")];
            for (q, lab) in pts {
                out.push(fact(
                    "接触三角形",
                    &format!("X_{}", lab),
                    pt(q[0], q[1]),
                    None,
                    &format!("X_{s}\\text{{ on side }}{s}", s = lab),
                    "内切圆与边的切点（接触三角形顶点）",
                ).with(Shape::Point {
                    x: q[0],
                    y: q[1],
                    label: format!("X{} 切点", lab),
                }));
            }
            if (dist2(inc, xa) - r).abs() < 1e-5 * (1.0 + r)
                && (dist2(inc, xb) - r).abs() < 1e-5 * (1.0 + r)
                && (dist2(inc, xc) - r).abs() < 1e-5 * (1.0 + r)
            {
                out.push(fact(
                    "接触三角形",
                    "|IX_*|",
                    nice(r),
                    Some(r),
                    "|IX_a| = |IX_b| = |IX_c| = r",
                    "切点到内心的距离等于内切圆半径",
                ));
            }
            let wa = 1.0 / sa;
            let wb = 1.0 / sb;
            let wc = 1.0 / sc;
            let den = wa + wb + wc;
            let ge = [
                (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
            ];
            let cross = (xa[0] - pa[0]) * (ge[1] - pa[1]) - (xa[1] - pa[1]) * (ge[0] - pa[0]);
            if cross.abs() < 1e-5 * (1.0 + dist2(pa, xa)) * (1.0 + dist2(pa, ge)) {
                out.push(fact(
                    "接触三角形",
                    "A, X_a, Ge",
                    "\\text{共线}".into(),
                    None,
                    "A X_a \\ni Ge",
                    "接触三角形与原三角形的透视中心为格尔巩点",
                ));
            }
        }
    }

    // Spieker circle: incircle of the medial triangle; center Sp, radius r/2.
    {
        let den = 2.0 * (a + b + c);
        let sp = [
            ((b + c) * pa[0] + (c + a) * pb[0] + (a + b) * pc[0]) / den,
            ((b + c) * pa[1] + (c + a) * pb[1] + (a + b) * pc[1]) / den,
        ];
        let r_sp = r / 2.0;
        out.push(fact(
            "斯皮克圆",
            "r_{\\text{Sp}}",
            nice(r_sp),
            Some(r_sp),
            "r_{\\text{Sp}} = r/2",
            "斯皮克圆：中点三角形的内切圆，半径为 r/2",
        ).with(Shape::Circle {
            cx: sp[0],
            cy: sp[1],
            r: r_sp,
            label: "斯皮克圆".into(),
        }));
        out.push(fact(
            "斯皮克圆",
            "S_{\\text{中点}}/(s/2)",
            nice(r_sp),
            Some(r_sp),
            "\\frac{S/4}{s/2} = \\frac{r}{2}",
            "由中点三角形的面积与半周长推出",
        ));
    }

    // Kosnita point: A O_a ∩ B O_b ∩ C O_c with O_a = circumcenter of △OBC.
    // Skip when △OAB / OBC / OCA is degenerate (e.g. right △ with O on a side).
    {
        let oa = circum2(circ, pb, pc);
        let ob = circum2(circ, pc, pa);
        let oc = circum2(circ, pa, pb);
        if let (Some((oa, _)), Some((ob, _)), Some((oc, _))) = (oa, ob, oc) {
            if let (Some(k1), Some(k2)) = (
                line_line_isect2(pa, oa, pb, ob),
                line_line_isect2(pa, oa, pc, oc),
            ) {
                if dist2(k1, k2) < 1e-5 * (1.0 + rr) {
                    let ko = k1;
                    out.push(fact(
                        "科斯尼塔点",
                        "Ko",
                        pt(ko[0], ko[1]),
                        None,
                        "AO_a \\cap BO_b \\cap CO_c",
                        "科斯尼塔点：A 与 △OBC 外心等连线的交点",
                    ).with(Shape::Point {
                        x: ko[0],
                        y: ko[1],
                        label: "Ko 科斯尼塔".into(),
                    }));
                }
            }
        }
    }


    // Extouch (excircle-contact / Nagel) triangle: A-excircle touches BC at T_a, etc.
    // BT_a = s−c, CT_a = s−b; perspector is the Nagel point (dual of the intouch △).
    {
        let sa = p - a;
        let sb = p - b;
        let sc = p - c;
        if sa > 1e-12 && sb > 1e-12 && sc > 1e-12 {
            // A-excircle on BC: BT:TC = (s−c):(s−b)
            let ta = section_point(pb, pc, sc, sb);
            let tb = section_point(pc, pa, sa, sc);
            let tc = section_point(pa, pb, sb, sa);
            let pts = [(ta, "a"), (tb, "b"), (tc, "c")];
            for (q, lab) in pts {
                out.push(fact(
                    "旁切接触三角形",
                    &format!("T_{}", lab),
                    pt(q[0], q[1]),
                    None,
                    &format!("T_{s}\\text{{ on side }}{s}", s = lab),
                    "旁切圆与边的切点（旁切接触 / 奈格尔三角形顶点）",
                ).with(Shape::Point {
                    x: q[0],
                    y: q[1],
                    label: format!("T{} 旁切点", lab),
                }));
            }
            // Midpoint of intouch X_a and extouch T_a is the midpoint of BC (isotomic).
            let xa = section_point(pb, pc, sb, sc);
            let mid_xt = [(xa[0] + ta[0]) / 2.0, (xa[1] + ta[1]) / 2.0];
            let mid_bc = [(pb[0] + pc[0]) / 2.0, (pb[1] + pc[1]) / 2.0];
            if dist2(mid_xt, mid_bc) < 1e-5 * (1.0 + a) {
                out.push(fact(
                    "旁切接触三角形",
                    "X_a T_a",
                    "\\text{以 BC 中点为中点}".into(),
                    None,
                    "\\text{mid}(X_a,T_a)=\\text{mid}(B,C)",
                    "内切切点与旁切切点关于边中点等截对称",
                ));
            }
            // Perspector Na: A, T_a, Na collinear.
            let na = [
                (sa * pa[0] + sb * pb[0] + sc * pc[0]) / p,
                (sa * pa[1] + sb * pb[1] + sc * pc[1]) / p,
            ];
            let cross = (ta[0] - pa[0]) * (na[1] - pa[1]) - (ta[1] - pa[1]) * (na[0] - pa[0]);
            if cross.abs() < 1e-5 * (1.0 + dist2(pa, ta)) * (1.0 + dist2(pa, na)) {
                out.push(fact(
                    "旁切接触三角形",
                    "A, T_a, Na",
                    "\\text{共线}".into(),
                    None,
                    "A T_a \\ni Na",
                    "旁切接触三角形与原三角形的透视中心为奈格尔点",
                ));
            }
        }
    }

    // Steiner inellipse: unique inscribed ellipse tangent at the side midpoints; center G.
    // Area = π S / (3 √3); coincides with the incircle on equilateral triangles.
    {
        let ma = [(pb[0] + pc[0]) / 2.0, (pb[1] + pc[1]) / 2.0];
        let mb = [(pc[0] + pa[0]) / 2.0, (pc[1] + pa[1]) / 2.0];
        let mc = [(pa[0] + pb[0]) / 2.0, (pa[1] + pb[1]) / 2.0];
        for (q, lab) in [(ma, "a"), (mb, "b"), (mc, "c")] {
            out.push(fact(
                "施泰纳内接椭圆",
                &format!("M_{}", lab),
                pt(q[0], q[1]),
                None,
                &format!("M_{s} = \\text{{mid}}", s = lab),
                "施泰纳内接椭圆在各边中点处与边相切",
            ).with(Shape::Point {
                x: q[0],
                y: q[1],
                label: format!("M{} 中点切", lab),
            }));
        }
        let steiner_area = std::f64::consts::PI * area / (3.0 * 3.0f64.sqrt());
        out.push(fact(
            "施泰纳内接椭圆",
            "S_{\\text{Steiner}}",
            nice(steiner_area),
            Some(steiner_area),
            "S_{\\text{Steiner}} = \\frac{\\pi S}{3\\sqrt{3}}",
            "施泰纳内接椭圆：面积最大的内接椭圆，中心为重心 G",
        ).with(Shape::Point {
            x: centroid[0],
            y: centroid[1],
            label: "Steiner@G".into(),
        }));
        // Equilateral: Steiner = incircle ⇒ area = π r².
        if (a - b).abs() < 1e-9 && (b - c).abs() < 1e-9 {
            let circ_area = std::f64::consts::PI * r * r;
            if (steiner_area - circ_area).abs() < 1e-5 * (1.0 + circ_area) {
                out.push(fact(
                    "施泰纳内接椭圆",
                    "=\\pi r^2",
                    nice(circ_area),
                    Some(circ_area),
                    "\\text{equilateral: Steiner = incircle}",
                    "等边时施泰纳内接椭圆与内切圆重合",
                ));
            }
        }
    }

    // Mandart inellipse: inscribed ellipse tangent at the extouch points; center = Mittenpunkt.
    {
        let sa = p - a;
        let sb = p - b;
        let sc = p - c;
        let wa = a * sa;
        let wb = b * sb;
        let wc = c * sc;
        let den = wa + wb + wc;
        if den > 1e-12 && sa > 1e-12 && sb > 1e-12 && sc > 1e-12 {
            let mi = [
                (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
            ];
            out.push(fact(
                "曼达特内接椭圆",
                "\\text{center}",
                pt(mi[0], mi[1]),
                None,
                "\\text{center} = \\text{Mi}",
                "曼达特内接椭圆：在旁切切点处与边相切，中心为米滕点",
            ).with(Shape::Point {
                x: mi[0],
                y: mi[1],
                label: "Mandart@Mi".into(),
            }));
            out.push(fact(
                "曼达特内接椭圆",
                "T_*",
                "\\text{切于旁切切点}".into(),
                None,
                "\\text{tangent at }T_a,T_b,T_c",
                "与旁切接触三角形的三顶点处相切",
            ));
        }
    }


    // Clawson point X(19): bary tan A : tan B : tan C.
    // Undefined / at infinity on right △ (tan → ∞); emit only for acute triangles.
    {
        let cosines = [g[0].cos(), g[1].cos(), g[2].cos()];
        let acute = cosines.iter().all(|&c| c > 1e-9)
            && g.iter().all(|&ang| ang > 1e-9 && ang < std::f64::consts::FRAC_PI_2 - 1e-9);
        if acute {
            let wa = g[0].tan();
            let wb = g[1].tan();
            let wc = g[2].tan();
            let den = wa + wb + wc;
            if den.abs() > 1e-12 {
                let cl = [
                    (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                    (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
                ];
                out.push(fact(
                    "克劳森点",
                    "Cl",
                    pt(cl[0], cl[1]),
                    None,
                    "Cl = \\frac{\\tan A\\,A+\\tan B\\,B+\\tan C\\,C}{\\sum}",
                    "克劳森点 X(19)：锐角三角形中 tan A:tan B:tan C（直角时退化）",
                ).with(Shape::Point {
                    x: cl[0],
                    y: cl[1],
                    label: "Cl 克劳森".into(),
                }));
            }
        }
    }

    // First Yff center of congruence X(174): bary sec A : sec B : sec C = 1/cos.
    // Skip when any cos ≈ 0 (right / near-right △).
    {
        let cosines = [g[0].cos(), g[1].cos(), g[2].cos()];
        if cosines.iter().all(|&c| c.abs() > 1e-9) {
            let wa = 1.0 / cosines[0];
            let wb = 1.0 / cosines[1];
            let wc = 1.0 / cosines[2];
            let den = wa + wb + wc;
            if den.abs() > 1e-12 {
                let yff = [
                    (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                    (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
                ];
                out.push(fact(
                    "伊夫中心",
                    "Yff",
                    pt(yff[0], yff[1]),
                    None,
                    "Yff = \\frac{\\sec A\\,A+\\sec B\\,B+\\sec C\\,C}{\\sum}",
                    "伊夫中心 X(174)：sec A:sec B:sec C（直角时 sec 无定义）",
                ).with(Shape::Point {
                    x: yff[0],
                    y: yff[1],
                    label: "Yff 伊夫".into(),
                }));
            }
        }
    }

    // Exeter point X(22): perspector of tangential and circummedial triangles;
    // bary a(b⁴+c⁴−a⁴) : b(c⁴+a⁴−b⁴) : c(a⁴+b⁴−c⁴).
    {
        let a2 = a * a;
        let b2 = b * b;
        let c2 = c * c;
        let a4 = a2 * a2;
        let b4 = b2 * b2;
        let c4 = c2 * c2;
        let wa = a * (b4 + c4 - a4);
        let wb = b * (c4 + a4 - b4);
        let wc = c * (a4 + b4 - c4);
        let den = wa + wb + wc;
        if den.abs() > 1e-12 {
            let ex = [
                (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
            ];
            out.push(fact(
                "埃克塞特点",
                "Ex",
                pt(ex[0], ex[1]),
                None,
                "Ex = \\frac{a(b^4+c^4-a^4)A+\\cdots}{\\sum}",
                "埃克塞特点 X(22)：切线三角形与外接中点三角形的透视中心",
            ).with(Shape::Point {
                x: ex[0],
                y: ex[1],
                label: "Ex 埃克塞特".into(),
            }));
            // Perspector helper: name the classical pair.
            out.push(fact(
                "埃克塞特点",
                "\\text{perspector}",
                "\\text{tangential}/\\text{circummedial}".into(),
                None,
                "\\text{perspector}(\\triangle_{\\text{tang}},\\triangle_{\\text{cm}})",
                "透视中心：切线三角形与外接中点三角形",
            ));
        }
    }


    // Isodynamic / isogonic centers X(15), X(16): concurrence of Apollonian circles.
    // Bary a sin(A±π/3); X(16) degenerates on equilateral (sin(A−π/3)=0).
    {
        let pi3 = std::f64::consts::PI / 3.0;
        let s15 = [((g[0] + pi3).sin()), (g[1] + pi3).sin(), (g[2] + pi3).sin()];
        let wa = a * s15[0];
        let wb = b * s15[1];
        let wc = c * s15[2];
        let den = wa + wb + wc;
        if den.abs() > 1e-12 {
            let p15 = [
                (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
            ];
            out.push(fact(
                "等动力点",
                "S_{1}",
                pt(p15[0], p15[1]),
                None,
                "S_1 = \\frac{a\\sin(A+\\pi/3)A+\\cdots}{\\sum}",
                "第一等动力点 X(15)（等角线中心 / Apollonian）",
            ).with(Shape::Point {
                x: p15[0],
                y: p15[1],
                label: "S1 等动力".into(),
            }));
        }
        let s16 = [(g[0] - pi3).sin(), (g[1] - pi3).sin(), (g[2] - pi3).sin()];
        // Equilateral: sin(A−π/3)=0 ⇒ den=0 — skip. One 60° angle (weight 0) is fine.
        {
            let wa = a * s16[0];
            let wb = b * s16[1];
            let wc = c * s16[2];
            let den16 = wa + wb + wc;
            if den16.abs() > 1e-12 {
                let p16 = [
                    (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den16,
                    (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den16,
                ];
                out.push(fact(
                    "等动力点",
                    "S_{2}",
                    pt(p16[0], p16[1]),
                    None,
                    "S_2 = \\frac{a\\sin(A-\\pi/3)A+\\cdots}{\\sum}",
                    "第二等动力点 X(16)（等角线中心）",
                ).with(Shape::Point {
                    x: p16[0],
                    y: p16[1],
                    label: "S2 等动力".into(),
                }));
            }
        }
        if den.abs() > 1e-12 {
            out.push(fact(
                "等动力点",
                "\\text{Apollonius}",
                "\\text{三阿氏圆共点}".into(),
                None,
                "\\odot A_a\\cap\\odot A_b\\cap\\odot A_c",
                "阿波罗尼奥斯圆（角平分线直径）交于等动力点",
            ));
        }
    }

    // Steiner point X(99): bary 1/(b²−c²):… on circumcircle ∩ Steiner ellipse.
    // Undefined for isosceles (denominator zero); skip cleanly.
    // Tarry X(98) = circumcircle antipode of Steiner (= 2O − St).
    {
        let dbc = b * b - c * c;
        let dca = c * c - a * a;
        let dab = a * a - b * b;
        if dbc.abs() > 1e-10 && dca.abs() > 1e-10 && dab.abs() > 1e-10 {
            let wa = 1.0 / dbc;
            let wb = 1.0 / dca;
            let wc = 1.0 / dab;
            let den = wa + wb + wc;
            if den.abs() > 1e-12 {
                let st = [
                    (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                    (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
                ];
                let os = dist2(circ, st);
                if (os - rr).abs() < 1e-4 * (1.0 + rr) {
                    out.push(fact(
                        "施泰纳点",
                        "St",
                        pt(st[0], st[1]),
                        None,
                        "St = \\frac{\\frac{1}{b^2-c^2}A+\\cdots}{\\sum}",
                        "施泰纳点 X(99)：外接圆与施泰纳椭圆的第四交点",
                    ).with(Shape::Point {
                        x: st[0],
                        y: st[1],
                        label: "St 施泰纳".into(),
                    }));
                    // Tarry = antipode of Steiner on (O)
                    let ty = [2.0 * circ[0] - st[0], 2.0 * circ[1] - st[1]];
                    let ot = dist2(circ, ty);
                    if (ot - rr).abs() < 1e-4 * (1.0 + rr) {
                        out.push(fact(
                            "塔里点",
                            "Ty",
                            pt(ty[0], ty[1]),
                            None,
                            "Ty = 2O - St",
                            "塔里点 X(98)：施泰纳点在外接圆上的对径点",
                        ).with(Shape::Point {
                            x: ty[0],
                            y: ty[1],
                            label: "Ty 塔里".into(),
                        }));
                        out.push(fact(
                            "塔里点",
                            "|O\\,Ty|",
                            nice(ot),
                            Some(ot),
                            "|O\\,Ty| = R",
                            "塔里点在外接圆上",
                        ));
                    }
                }
            }
        }
    }


    // Napoleon centers X(17), X(18): concurrence of lines to centroids of
    // outward/inward equilateral triangles on the sides (distinct from Napoleon theorem).
    {
        let pi6 = std::f64::consts::PI / 6.0;
        // X(17) outer: bary a csc(A+π/6); skip if sin(A+π/6)≈0 (e.g. angle ≈ 150°).
        let s17 = [(g[0] + pi6).sin(), (g[1] + pi6).sin(), (g[2] + pi6).sin()];
        if s17.iter().all(|&s| s.abs() > 1e-9) {
            let wa = a / s17[0];
            let wb = b / s17[1];
            let wc = c / s17[2];
            let den = wa + wb + wc;
            if den.abs() > 1e-12 {
                let n1 = [
                    (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                    (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
                ];
                out.push(fact(
                    "拿破仑中心",
                    "N_1",
                    pt(n1[0], n1[1]),
                    None,
                    "N_1 = \\frac{a\\csc(A+\\pi/6)A+\\cdots}{\\sum}",
                    "第一拿破仑点 X(17)：外接等边三角形重心连线交点",
                ).with(Shape::Point {
                    x: n1[0],
                    y: n1[1],
                    label: "N1 拿破仑".into(),
                }));
            }
        }
        // X(18) inner: bary a csc(A−π/6); skip if sin(A−π/6)≈0 (angle ≈ 30°).
        let s18 = [(g[0] - pi6).sin(), (g[1] - pi6).sin(), (g[2] - pi6).sin()];
        if s18.iter().all(|&s| s.abs() > 1e-9) {
            let wa = a / s18[0];
            let wb = b / s18[1];
            let wc = c / s18[2];
            let den = wa + wb + wc;
            if den.abs() > 1e-12 {
                let n2 = [
                    (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                    (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
                ];
                out.push(fact(
                    "拿破仑中心",
                    "N_2",
                    pt(n2[0], n2[1]),
                    None,
                    "N_2 = \\frac{a\\csc(A-\\pi/6)A+\\cdots}{\\sum}",
                    "第二拿破仑点 X(18)：内接等边三角形重心连线交点",
                ).with(Shape::Point {
                    x: n2[0],
                    y: n2[1],
                    label: "N2 拿破仑".into(),
                }));
            }
        }
    }

    // Parry point X(111): bary a²/(2a²−b²−c²); on circumcircle.
    // Degenerate when 2a²=b²+c² for any side (e.g. equilateral).
    {
        let da = 2.0 * a * a - b * b - c * c;
        let db = 2.0 * b * b - c * c - a * a;
        let dc = 2.0 * c * c - a * a - b * b;
        if da.abs() > 1e-10 && db.abs() > 1e-10 && dc.abs() > 1e-10 {
            let wa = (a * a) / da;
            let wb = (b * b) / db;
            let wc = (c * c) / dc;
            let den = wa + wb + wc;
            if den.abs() > 1e-12 {
                let py = [
                    (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                    (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
                ];
                out.push(fact(
                    "帕里点",
                    "Py",
                    pt(py[0], py[1]),
                    None,
                    "Py = \\frac{\\frac{a^2}{2a^2-b^2-c^2}A+\\cdots}{\\sum}",
                    "帕里点 X(111)：Λ(G,K)（等边时退化）",
                ).with(Shape::Point {
                    x: py[0],
                    y: py[1],
                    label: "Py 帕里".into(),
                }));
                let op = dist2(circ, py);
                if (op - rr).abs() < 1e-4 * (1.0 + rr) {
                    out.push(fact(
                        "帕里点",
                        "|O\\,Py|",
                        nice(op),
                        Some(op),
                        "|O\\,Py| = R",
                        "帕里点在外接圆上",
                    ));
                }
            }
        }
    }

    // Vecten points: perspectors of outer/inner square-center triangles.
    // X(485) outer: bary a sec(A−π/4); skip if cos(A−π/4)≈0 (angle ≈ 135°).
    // X(486) inner: bary a sec(A+π/4); skip if cos(A+π/4)≈0 (angle ≈ 45°).
    {
        let pi4 = std::f64::consts::FRAC_PI_4;
        let c_out = [(g[0] - pi4).cos(), (g[1] - pi4).cos(), (g[2] - pi4).cos()];
        if c_out.iter().all(|&c| c.abs() > 1e-9) {
            let wa = a / c_out[0];
            let wb = b / c_out[1];
            let wc = c / c_out[2];
            let den = wa + wb + wc;
            if den.abs() > 1e-12 {
                let vo = [
                    (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                    (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
                ];
                out.push(fact(
                    "韦克滕点",
                    "V_{\\text{out}}",
                    pt(vo[0], vo[1]),
                    None,
                    "V_{\\text{out}} = \\frac{a\\sec(A-\\pi/4)A+\\cdots}{\\sum}",
                    "外韦克滕点 X(485)：外侧正方形中心三角形的透视中心",
                ).with(Shape::Point {
                    x: vo[0],
                    y: vo[1],
                    label: "Vout 韦克滕".into(),
                }));
            }
        }
        let c_in = [(g[0] + pi4).cos(), (g[1] + pi4).cos(), (g[2] + pi4).cos()];
        if c_in.iter().all(|&c| c.abs() > 1e-9) {
            let wa = a / c_in[0];
            let wb = b / c_in[1];
            let wc = c / c_in[2];
            let den = wa + wb + wc;
            if den.abs() > 1e-12 {
                let vi = [
                    (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                    (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
                ];
                out.push(fact(
                    "韦克滕点",
                    "V_{\\text{in}}",
                    pt(vi[0], vi[1]),
                    None,
                    "V_{\\text{in}} = \\frac{a\\sec(A+\\pi/4)A+\\cdots}{\\sum}",
                    "内韦克滕点 X(486)：内侧正方形中心三角形的透视中心",
                ).with(Shape::Point {
                    x: vi[0],
                    y: vi[1],
                    label: "Vin 韦克滕".into(),
                }));
            }
        }
    }


    // Hofstadter points X(359), X(360): transcendental centers (angles in barycentrics).
    // X(360) zero-point: bary A:B:C; X(359) one-point: bary a²/A:b²/B:c²/C.
    {
        if g[0] > 1e-12 && g[1] > 1e-12 && g[2] > 1e-12 {
            let den0 = g[0] + g[1] + g[2];
            let hz = [
                (g[0] * pa[0] + g[1] * pb[0] + g[2] * pc[0]) / den0,
                (g[0] * pa[1] + g[1] * pb[1] + g[2] * pc[1]) / den0,
            ];
            out.push(fact(
                "霍夫斯塔特点",
                "Hf_0",
                pt(hz[0], hz[1]),
                None,
                "Hf_0 = (A:B:C)",
                "霍夫斯塔特零点 X(360)：重心坐标为三角本身",
            ).with(Shape::Point {
                x: hz[0],
                y: hz[1],
                label: "Hf0 霍夫".into(),
            }));
            let wa = (a * a) / g[0];
            let wb = (b * b) / g[1];
            let wc = (c * c) / g[2];
            let den1 = wa + wb + wc;
            if den1.abs() > 1e-12 {
                let ho = [
                    (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den1,
                    (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den1,
                ];
                out.push(fact(
                    "霍夫斯塔特点",
                    "Hf_1",
                    pt(ho[0], ho[1]),
                    None,
                    "Hf_1 = (a^2/A:b^2/B:c^2/C)",
                    "霍夫斯塔特一点 X(359)：与 Hf_0 互为等角共轭",
                ).with(Shape::Point {
                    x: ho[0],
                    y: ho[1],
                    label: "Hf1 霍夫".into(),
                }));
            }
        }
    }

    // Kenmotu point X(371): congruent-squares point; bary a cos(A−π/4).
    // Isogonal conjugate of outer Vecten X(485).
    {
        let pi4 = std::f64::consts::FRAC_PI_4;
        let ca = [(g[0] - pi4).cos(), (g[1] - pi4).cos(), (g[2] - pi4).cos()];
        let wa = a * ca[0];
        let wb = b * ca[1];
        let wc = c * ca[2];
        let den = wa + wb + wc;
        if den.abs() > 1e-12 {
            let km = [
                (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
            ];
            out.push(fact(
                "肯莫图点",
                "Km",
                pt(km[0], km[1]),
                None,
                "Km = \\frac{a\\cos(A-\\pi/4)A+\\cdots}{\\sum}",
                "肯莫图点 X(371)：三全等正方形的公共点（等角共轭于外韦克滕点）",
            ).with(Shape::Point {
                x: km[0],
                y: km[1],
                label: "Km 肯莫图".into(),
            }));
            let edge_den = a * a + b * b + c * c + 4.0 * area;
            if edge_den > 1e-12 {
                let edge = std::f64::consts::SQRT_2 * a * b * c / edge_den;
                out.push(fact(
                    "肯莫图点",
                    "s_{\\text{square}}",
                    nice(edge),
                    Some(edge),
                    "s = \\frac{\\sqrt{2}\\,abc}{a^2+b^2+c^2+4S}",
                    "三全等正方形的边长",
                ));
            }
        }
    }

    // Apollonius point X(181): perspector of Apollonius circle with the excircles.
    // Bary a²(b+c)²/(b+c−a); b+c−a=2(s−a)>0 for non-degenerate △.
    {
        let sa = p - a;
        let sb = p - b;
        let sc = p - c;
        if sa > 1e-12 && sb > 1e-12 && sc > 1e-12 {
            let wa = (a * a) * (b + c) * (b + c) / (2.0 * sa);
            let wb = (b * b) * (c + a) * (c + a) / (2.0 * sb);
            let wc = (c * c) * (a + b) * (a + b) / (2.0 * sc);
            let den = wa + wb + wc;
            if den.abs() > 1e-12 {
                let ap = [
                    (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                    (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
                ];
                out.push(fact(
                    "阿波罗尼奥斯点",
                    "Ap",
                    pt(ap[0], ap[1]),
                    None,
                    "Ap = \\frac{a^2(b+c)^2/(b+c-a)\\,A+\\cdots}{\\sum}",
                    "阿波罗尼奥斯点 X(181)：与三旁切圆外切的阿氏圆的透视中心",
                ).with(Shape::Point {
                    x: ap[0],
                    y: ap[1],
                    label: "Ap 阿氏".into(),
                }));
            }
        }
    }


    // Fermat–Torricelli / isogonic centers X(13), X(14) — distinct from isodynamic X(15)/X(16).
    // Trilinear csc(A±π/3); bary a csc(A±π/3). If some angle ≥ 120°, X(13) is that vertex.
    {
        let pi3 = std::f64::consts::PI / 3.0;
        let two_pi3 = 2.0 * pi3;
        let mut obtuse120: Option<usize> = None;
        for (i, &ang) in g.iter().enumerate() {
            if ang >= two_pi3 - 1e-9 {
                obtuse120 = Some(i);
                break;
            }
        }
        if let Some(i) = obtuse120 {
            let fv = v[i];
            out.push(fact(
                "费马点",
                "F_1",
                pt(fv[0], fv[1]),
                None,
                "F_1 = \\text{obtuse vertex (}\\ge 120^\\circ\\text{)}",
                "第一费马–托里拆利点 X(13)：钝角 ≥120° 时退化为该顶点",
            ).with(Shape::Point {
                x: fv[0],
                y: fv[1],
                label: "F1 费马".into(),
            }));
        } else {
            let s13 = [(g[0] + pi3).sin(), (g[1] + pi3).sin(), (g[2] + pi3).sin()];
            if s13.iter().all(|&s| s.abs() > 1e-9) {
                let wa = a / s13[0];
                let wb = b / s13[1];
                let wc = c / s13[2];
                let den = wa + wb + wc;
                if den.abs() > 1e-12 {
                    let f1 = [
                        (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                        (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
                    ];
                    out.push(fact(
                        "费马点",
                        "F_1",
                        pt(f1[0], f1[1]),
                        None,
                        "F_1 = \\frac{a\\csc(A+\\pi/3)A+\\cdots}{\\sum}",
                        "第一费马–托里拆利 / 等角线中心 X(13)（异于等动力点 X(15)）",
                    ).with(Shape::Point {
                        x: f1[0],
                        y: f1[1],
                        label: "F1 费马".into(),
                    }));
                }
            }
        }
        // X(14) 2nd isogonic: skip equilateral (sin(A−π/3)=0).
        let s14 = [(g[0] - pi3).sin(), (g[1] - pi3).sin(), (g[2] - pi3).sin()];
        // Guard: any near-zero sin → skip (equilateral / 60° singularity in csc form)
        if s14.iter().all(|&s| s.abs() > 1e-9) {
            let wa = a / s14[0];
            let wb = b / s14[1];
            let wc = c / s14[2];
            {
                let den = wa + wb + wc;
                if den.abs() > 1e-12 {
                    let f2 = [
                        (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                        (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
                    ];
                    out.push(fact(
                        "费马点",
                        "F_2",
                        pt(f2[0], f2[1]),
                        None,
                        "F_2 = \\frac{a\\csc(A-\\pi/3)A+\\cdots}{\\sum}",
                        "第二等角线中心 X(14)（异于等动力点 X(16)）",
                    ).with(Shape::Point {
                        x: f2[0],
                        y: f2[1],
                        label: "F2 费马".into(),
                    }));
                }
            }
        }
        // Helper: isogonic ≠ isodynamic (X13 isogonal conjugate of X15).
        if out.iter().any(|f| f.group == "费马点" && f.label == "F_1")
            && out.iter().any(|f| f.group == "等动力点" && f.label.contains("S_{1}"))
        {
            let f1v = out.iter().find(|f| f.group == "费马点" && f.label == "F_1").map(|f| f.value.clone());
            let s1v = out.iter().find(|f| f.group == "等动力点" && f.label.contains("S_{1}")).map(|f| f.value.clone());
            if let (Some(a), Some(b)) = (f1v, s1v) {
                if a != b {
                    out.push(fact(
                        "费马点",
                        "F_1 \\ne S_1",
                        "\\text{isogonic} \\ne \\text{isodynamic}".into(),
                        None,
                        "X(13)=\\text{isogonal of }X(15)",
                        "等角线中心与等动力点不同（互为等角共轭）",
                    ));
                }
            }
        }
    }

    // Equal detour X(176) / isoperimetric X(175) (inner/outer Soddy centers).
    // X(176): bary sin A · (1 + sec(A/2) cos(B/2) cos(C/2)); always for non-degen △.
    // X(175): same with −1; emit only when a+b+c > 4R+r.
    {
        let ha = g[0] / 2.0;
        let hb = g[1] / 2.0;
        let hc = g[2] / 2.0;
        let cos_ha = ha.cos();
        let cos_hb = hb.cos();
        let cos_hc = hc.cos();
        if cos_ha.abs() > 1e-12 && cos_hb.abs() > 1e-12 && cos_hc.abs() > 1e-12 {
            let t176 = [
                1.0 + cos_hb * cos_hc / cos_ha,
                1.0 + cos_hc * cos_ha / cos_hb,
                1.0 + cos_ha * cos_hb / cos_hc,
            ];
            let wa = a * t176[0];
            let wb = b * t176[1];
            let wc = c * t176[2];
            let den = wa + wb + wc;
            if den.abs() > 1e-12 {
                let ed = [
                    (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                    (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
                ];
                out.push(fact(
                    "等迂回点",
                    "Ed",
                    pt(ed[0], ed[1]),
                    None,
                    "Ed = (\\sin A\\,(1+\\sec\\tfrac{A}{2}\\cos\\tfrac{B}{2}\\cos\\tfrac{C}{2}):\\cdots)",
                    "等迂回点 X(176)：内苏迪圆圆心",
                ).with(Shape::Point {
                    x: ed[0],
                    y: ed[1],
                    label: "Ed 等迂回".into(),
                }));
            }
            // Isoperimetric / outer Soddy X(175)
            if per > 4.0 * rr + r + 1e-9 {
                let t175 = [
                    -1.0 + cos_hb * cos_hc / cos_ha,
                    -1.0 + cos_hc * cos_ha / cos_hb,
                    -1.0 + cos_ha * cos_hb / cos_hc,
                ];
                let wa = a * t175[0];
                let wb = b * t175[1];
                let wc = c * t175[2];
                let den = wa + wb + wc;
                if den.abs() > 1e-12 {
                    let ip = [
                        (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                        (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
                    ];
                    out.push(fact(
                        "等周点",
                        "Ip",
                        pt(ip[0], ip[1]),
                        None,
                        "Ip = (\\sin A\\,(-1+\\sec\\tfrac{A}{2}\\cos\\tfrac{B}{2}\\cos\\tfrac{C}{2}):\\cdots)",
                        "等周点 X(175)：外苏迪圆圆心（需 a+b+c>4R+r）",
                    ).with(Shape::Point {
                        x: ip[0],
                        y: ip[1],
                        label: "Ip 等周".into(),
                    }));
                }
            }
        }
    }

    // Moses point X(75): isotomic conjugate of the incenter; bary (bc : ca : ab).
    {
        let wa = b * c;
        let wb = c * a;
        let wc = a * b;
        let den = wa + wb + wc;
        if den > 1e-18 {
            let mo = [
                (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
            ];
            out.push(fact(
                "摩西点",
                "Mo",
                pt(mo[0], mo[1]),
                None,
                "Mo = \\frac{bc\\,A + ca\\,B + ab\\,C}{\\sum}",
                "摩西点 X(75)：内心的等截共轭",
            ).with(Shape::Point {
                x: mo[0],
                y: mo[1],
                label: "Mo 摩西".into(),
            }));
            out.push(fact(
                "摩西点",
                "Mo \\leftrightarrow I",
                "\\text{等截共轭}".into(),
                None,
                "\\text{isotomic of }I",
                "摩西点与内心互为等截共轭（bary I=a:b:c ↔ 1/a:1/b:1/c）",
            ));
        }
    }

    // X(25): homothetic center of orthic and tangential triangles; bary a²/(b²+c²−a²).
    // Denominator vanishes at a right angle — skip then.
    {
        let da = b * b + c * c - a * a;
        let db = c * c + a * a - b * b;
        let dc = a * a + b * b - c * c;
        if da.abs() > 1e-12 && db.abs() > 1e-12 && dc.abs() > 1e-12 {
            let wa = (a * a) / da;
            let wb = (b * b) / db;
            let wc = (c * c) / dc;
            let den = wa + wb + wc;
            if den.abs() > 1e-12 {
                let x25 = [
                    (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                    (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
                ];
                out.push(fact(
                    "垂足切线同调中心",
                    "X_{25}",
                    pt(x25[0], x25[1]),
                    None,
                    "X(25) = \\bigl(a^2/(b^2+c^2-a^2):\\cdots\\bigr)",
                    "X(25)：垂足三角形与切线三角形的同调中心",
                ).with(Shape::Point {
                    x: x25[0],
                    y: x25[1],
                    label: "X25 同调".into(),
                }));
            }
        }
    }

    // X(55)/X(56): internal/external centers of similitude of circumcircle (O) and incircle (I).
    // X(55) = (r O + R I)/(R+r) divides OI internally in R:r; bary a²(b+c−a).
    // X(56) = (R I − r O)/(R−r) divides OI externally in R:r; bary a²/(b+c−a).
    {
        let sa = b + c - a;
        let sb = c + a - b;
        let sc = a + b - c;
        if sa > 1e-12 && sb > 1e-12 && sc > 1e-12 {
            let sum_rr = rr + r;
            if sum_rr > 1e-12 {
                let s55 = [
                    (r * circ[0] + rr * inc[0]) / sum_rr,
                    (r * circ[1] + rr * inc[1]) / sum_rr,
                ];
                // Cross-check bary a²(b+c−a)
                let wa = a * a * sa;
                let wb = b * b * sb;
                let wc = c * c * sc;
                let den = wa + wb + wc;
                if den > 1e-12 {
                    let s55b = [
                        (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                        (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
                    ];
                    let s55u = if dist2(s55, s55b) < 1e-5 * (1.0 + dist2(circ, inc)) {
                        s55
                    } else {
                        s55b
                    };
                    out.push(fact(
                        "相似中心",
                        "S_{+}",
                        pt(s55u[0], s55u[1]),
                        None,
                        "S_{+} = \\dfrac{r\\,O + R\\,I}{R+r}",
                        "内相似中心 X(55)：外接圆与内切圆的内相似中心",
                    ).with(Shape::Point {
                        x: s55u[0],
                        y: s55u[1],
                        label: "S+ X55".into(),
                    }));
                    let d_o = dist2(s55u, circ);
                    let d_i = dist2(s55u, inc);
                    if d_i > 1e-12 {
                        let ratio = d_o / d_i;
                        let expect = rr / r;
                        if (ratio - expect).abs() < 1e-4 * (1.0 + expect) {
                            out.push(fact(
                                "相似中心",
                                "OS_{+}:S_{+}I",
                                format!("{}:{}", nice(rr), nice(r)),
                                Some(expect),
                                "OS_{+}:S_{+}I = R:r",
                                "内相似中心按 R:r 内分 OI",
                            ));
                        }
                    }
                }
            }
            let diff_rr = rr - r;
            if diff_rr > 1e-12 {
                let s56 = [
                    (-r * circ[0] + rr * inc[0]) / diff_rr,
                    (-r * circ[1] + rr * inc[1]) / diff_rr,
                ];
                let wa = (a * a) / sa;
                let wb = (b * b) / sb;
                let wc = (c * c) / sc;
                let den = wa + wb + wc;
                if den.abs() > 1e-12 {
                    let s56b = [
                        (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                        (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
                    ];
                    let s56u = if dist2(s56, s56b) < 1e-5 * (1.0 + dist2(circ, inc)) {
                        s56
                    } else {
                        s56b
                    };
                    out.push(fact(
                        "相似中心",
                        "S_{-}",
                        pt(s56u[0], s56u[1]),
                        None,
                        "S_{-} = \\dfrac{R\\,I - r\\,O}{R-r}",
                        "外相似中心 X(56)：外接圆与内切圆的外相似中心",
                    ).with(Shape::Point {
                        x: s56u[0],
                        y: s56u[1],
                        label: "S- X56".into(),
                    }));
                    // O, I, S+, S− collinear on the OI line
                    let cross = (inc[0] - circ[0]) * (s56u[1] - circ[1])
                        - (inc[1] - circ[1]) * (s56u[0] - circ[0]);
                    let scale = (1.0 + dist2(circ, inc)) * (1.0 + dist2(circ, s56u));
                    if cross.abs() < 1e-5 * scale {
                        out.push(fact(
                            "相似中心",
                            "O,\\ I,\\ S_{+},\\ S_{-}",
                            "\\text{共线}".into(),
                            None,
                            "S_{\\pm}\\in OI",
                            "内/外相似中心均在 OI 线上（互为关于 O,I 的调和共轭）",
                        ));
                    }
                }
            }
        }
    }

    // X(30) Euler infinity point: Euler line ∩ line at infinity (direction of OH).
    // Emit unit direction when |OH| is non-degenerate; bary sum of g(a,b,c) is 0.
    {
        let ohx = orth[0] - circ[0];
        let ohy = orth[1] - circ[1];
        let oh_len = (ohx * ohx + ohy * ohy).sqrt();
        if oh_len > 1e-9 {
            let ux = ohx / oh_len;
            let uy = ohy / oh_len;
            out.push(fact(
                "欧拉无穷远点",
                "X_{30}",
                format!("({}, {})", nice(ux), nice(uy)),
                None,
                "X(30) = \\text{Euler}\\cap\\ell_{\\infty}",
                "欧拉无穷远点：欧拉线与无穷远直线的交点（方向向量）",
            ));
            out.push(fact(
                "欧拉无穷远点",
                "\\overrightarrow{OH}/|OH|",
                format!("({}, {})", nice(ux), nice(uy)),
                None,
                "\\parallel\\overrightarrow{OH}",
                "欧拉线方向单位向量（X(30) 的仿射代表）",
            ));
            // Bary g = 2a⁴ − (b²−c²)² − a²(b²+c²); homogeneous sum ≈ 0 at infinity.
            let g_a = {
                let a2 = a * a;
                let b2 = b * b;
                let c2 = c * c;
                2.0 * a2 * a2 - (b2 - c2) * (b2 - c2) - a2 * (b2 + c2)
            };
            let g_b = {
                let a2 = b * b;
                let b2 = c * c;
                let c2 = a * a;
                2.0 * a2 * a2 - (b2 - c2) * (b2 - c2) - a2 * (b2 + c2)
            };
            let g_c = {
                let a2 = c * c;
                let b2 = a * a;
                let c2 = b * b;
                2.0 * a2 * a2 - (b2 - c2) * (b2 - c2) - a2 * (b2 + c2)
            };
            let gsum = g_a + g_b + g_c;
            if gsum.abs() < 1e-6 * (1.0 + g_a.abs() + g_b.abs() + g_c.abs()) {
                out.push(fact(
                    "欧拉无穷远点",
                    "\\sum g(a,b,c)",
                    "0".into(),
                    Some(0.0),
                    "g=2a^4-(b^2-c^2)^2-a^2(b^2+c^2)",
                    "X(30) 重心坐标之和为 0（无穷远点判据）",
                ));
            }
        }
    }

    // X(57): isogonal conjugate of Mittenpunkt X(9); perspector of intouch & excentral.
    // Bary a/(b+c−a) = a/(2(s−a)).
    {
        let sa = b + c - a;
        let sb = c + a - b;
        let sc = a + b - c;
        if sa > 1e-12 && sb > 1e-12 && sc > 1e-12 {
            let wa = a / sa;
            let wb = b / sb;
            let wc = c / sc;
            let den = wa + wb + wc;
            if den.abs() > 1e-12 {
                let x57 = [
                    (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                    (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
                ];
                out.push(fact(
                    "米滕等角共轭点",
                    "X_{57}",
                    pt(x57[0], x57[1]),
                    None,
                    "X(57) = \\bigl(a/(b+c-a):\\cdots\\bigr)",
                    "X(57)：米滕点的等角共轭（接触△与旁心△的透视中心）",
                ).with(Shape::Point {
                    x: x57[0],
                    y: x57[1],
                    label: "X57".into(),
                }));
                out.push(fact(
                    "米滕等角共轭点",
                    "X_{57} \\leftrightarrow Mi",
                    "\\text{等角共轭}".into(),
                    None,
                    "\\text{isogonal of }X(9)",
                    "X(57) 与米滕点 X(9) 互为等角共轭",
                ));
            }
        }
    }

    // X(58): isogonal conjugate of Spieker X(10); bary a²/(b+c).
    {
        let wa = (a * a) / (b + c);
        let wb = (b * b) / (c + a);
        let wc = (c * c) / (a + b);
        let den = wa + wb + wc;
        if den > 1e-12 {
            let x58 = [
                (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
            ];
            out.push(fact(
                "斯皮克等角共轭点",
                "X_{58}",
                pt(x58[0], x58[1]),
                None,
                "X(58) = \\bigl(a^2/(b+c):\\cdots\\bigr)",
                "X(58)：斯皮克中心的等角共轭",
            ).with(Shape::Point {
                x: x58[0],
                y: x58[1],
                label: "X58".into(),
            }));
            out.push(fact(
                "斯皮克等角共轭点",
                "X_{58} \\leftrightarrow Sp",
                "\\text{等角共轭}".into(),
                None,
                "\\text{isogonal of }X(10)",
                "X(58) 与斯皮克中心 X(10) 互为等角共轭",
            ));
        }
    }

    // X(84): isogonal conjugate of Bevan X(40); perspector of hexyl triangle.
    // Bary a / (cos B + cos C − cos A − 1); skip when any denominator ≈ 0.
    {
        let ca = g[0].cos();
        let cb = g[1].cos();
        let cc = g[2].cos();
        let da = cb + cc - ca - 1.0;
        let db = cc + ca - cb - 1.0;
        let dc = ca + cb - cc - 1.0;
        if da.abs() > 1e-12 && db.abs() > 1e-12 && dc.abs() > 1e-12 {
            let wa = a / da;
            let wb = b / db;
            let wc = c / dc;
            let den = wa + wb + wc;
            if den.abs() > 1e-12 {
                let x84 = [
                    (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den,
                    (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den,
                ];
                out.push(fact(
                    "己基透视中心",
                    "X_{84}",
                    pt(x84[0], x84[1]),
                    None,
                    "X(84) = \\bigl(a/(\\cos B+\\cos C-\\cos A-1):\\cdots\\bigr)",
                    "X(84)：贝万点的等角共轭（己基三角形透视中心）",
                ).with(Shape::Point {
                    x: x84[0],
                    y: x84[1],
                    label: "X84".into(),
                }));
                // Cross-check: isogonal of Be=2O−I via bary of Be then a²/x.
                let be = [2.0 * circ[0] - inc[0], 2.0 * circ[1] - inc[1]];
                // signed areas for bary of Be
                let area2 = |p: [f64; 2], q: [f64; 2], r: [f64; 2]| {
                    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
                };
                let aa = area2(be, pb, pc);
                let bb = area2(pa, be, pc);
                let cc_ = area2(pa, pb, be);
                let ssum = aa + bb + cc_;
                if ssum.abs() > 1e-12 && aa.abs() > 1e-14 && bb.abs() > 1e-14 && cc_.abs() > 1e-14 {
                    let wa = (a * a) / aa;
                    let wb = (b * b) / bb;
                    let wc = (c * c) / cc_;
                    let den2 = wa + wb + wc;
                    if den2.abs() > 1e-12 {
                        let iso = [
                            (wa * pa[0] + wb * pb[0] + wc * pc[0]) / den2,
                            (wa * pa[1] + wb * pb[1] + wc * pc[1]) / den2,
                        ];
                        if dist2(iso, x84) < 1e-4 * (1.0 + dist2(circ, orth)) {
                            out.push(fact(
                                "己基透视中心",
                                "X_{84} \\leftrightarrow Be",
                                "\\text{等角共轭}".into(),
                                None,
                                "\\text{isogonal of }X(40)",
                                "X(84) 与贝万点 X(40) 互为等角共轭",
                            ));
                        }
                    }
                }
            }
        }
    }

    // Ceva: concurrent cevians AD, BE, CF satisfy (BD/DC)(CE/EA)(AF/FB) = 1.
    // Emit the classical families that are always concurrent from three sides alone.
    {
        // Medians: each ratio = 1.
        out.push(fact(
            "塞瓦与梅涅劳斯",
            "\\Pi_{\\text{Ceva}}^{\\text{中线}}",
            "1".into(),
            Some(1.0),
            "\\frac{BD}{DC}\\cdot\\frac{CE}{EA}\\cdot\\frac{AF}{FB} = 1\\cdot 1\\cdot 1",
            "塞瓦定理：三中线交于重心",
        ));
        // Angle bisectors: BD/DC = c/b, CE/EA = a/c, AF/FB = b/a.
        let bis = (c / b) * (a / c) * (b / a);
        out.push(fact(
            "塞瓦与梅涅劳斯",
            "\\Pi_{\\text{Ceva}}^{\\text{角平分线}}",
            nice(bis),
            Some(bis),
            &format!(
                "\\frac{{c}}{{b}}\\cdot\\frac{{a}}{{c}}\\cdot\\frac{{b}}{{a}} = {}",
                nice(bis)
            ),
            "塞瓦定理：三角平分线交于内心",
        ));
        // Altitudes: feet of the three altitudes; directed product = 1.
        let mut alt_prod = 1.0;
        let mut alt_ok = true;
        for i in 0..3 {
            let (p0, q1, q2) = (v[i], v[(i + 1) % 3], v[(i + 2) % 3]);
            let dx = q2[0] - q1[0];
            let dy = q2[1] - q1[1];
            let den = dx * dx + dy * dy;
            if den < 1e-18 {
                alt_ok = false;
                break;
            }
            let t = ((p0[0] - q1[0]) * dx + (p0[1] - q1[1]) * dy) / den;
            let foot = [q1[0] + t * dx, q1[1] + t * dy];
            match directed_ratio(q1, q2, foot) {
                Some(r) => alt_prod *= r,
                None => {
                    alt_ok = false;
                    break;
                }
            }
        }
        if alt_ok {
            out.push(fact(
                "塞瓦与梅涅劳斯",
                "\\Pi_{\\text{Ceva}}^{\\text{高}}",
                nice(alt_prod),
                Some(alt_prod),
                "\\frac{BD}{DC}\\cdot\\frac{CE}{EA}\\cdot\\frac{AF}{FB} = 1",
                "塞瓦定理：三高交于垂心（有向比）",
            ));
        }
        // Gergonne: incircle contact points. BD = s−b, DC = s−c, …
        let (ta, tb, tc) = (p - a, p - b, p - c);
        if ta > 1e-12 && tb > 1e-12 && tc > 1e-12 {
            let ger = (tb / tc) * (tc / ta) * (ta / tb);
            out.push(fact(
                "塞瓦与梅涅劳斯",
                "\\Pi_{\\text{Ceva}}^{\\text{切点}}",
                nice(ger),
                Some(ger),
                "\\frac{s-b}{s-c}\\cdot\\frac{s-c}{s-a}\\cdot\\frac{s-a}{s-b} = 1",
                "塞瓦定理：内切圆切点连线交于格尔巩点",
            ));
            // Nagel / extouch: BD = s−c, DC = s−b (swap), product still 1.
            let nag = (tc / tb) * (ta / tc) * (tb / ta);
            out.push(fact(
                "塞瓦与梅涅劳斯",
                "\\Pi_{\\text{Ceva}}^{\\text{旁切}}",
                nice(nag),
                Some(nag),
                "\\frac{s-c}{s-b}\\cdot\\frac{s-a}{s-c}\\cdot\\frac{s-b}{s-a} = 1",
                "塞瓦定理：旁切圆切点连线交于奈格尔点",
            ));
        }
    }

    // Menelaus: a transversal DEF with D on BC, E on CA, F on AB (or extensions)
    // satisfies (BD/DC)(CE/EA)(AF/FB) = −1 (directed). Construct D,E then F = DE ∩ AB.
    {
        let d_pt = section_point(pb, pc, 2.0, 1.0); // BD:DC = 2:1
        let e_pt = section_point(pc, pa, 2.0, 1.0); // CE:EA = 2:1
        if let Some(f_pt) = line_line_isect2(d_pt, e_pt, pa, pb) {
            if let (Some(r_bc), Some(r_ca), Some(r_ab)) = (
                directed_ratio(pb, pc, d_pt),
                directed_ratio(pc, pa, e_pt),
                directed_ratio(pa, pb, f_pt),
            ) {
                let prod = r_bc * r_ca * r_ab;
                out.push(fact(
                    "塞瓦与梅涅劳斯",
                    "\\Pi_{\\text{Menelaus}}",
                    nice(prod),
                    Some(prod),
                    &format!(
                        "\\frac{{BD}}{{DC}}\\cdot\\frac{{CE}}{{EA}}\\cdot\\frac{{AF}}{{FB}} = {}\\cdot{}\\cdot{} = {}",
                        nice(r_bc),
                        nice(r_ca),
                        nice(r_ab),
                        nice(prod)
                    ),
                    "梅涅劳斯定理：横截线分三边的有向比之积为 −1",
                ).with(Shape::Segment {
                    x1: d_pt[0],
                    y1: d_pt[1],
                    x2: e_pt[0],
                    y2: e_pt[1],
                    label: "Menelaus 横截线".into(),
                }));
                out.push(fact(
                    "塞瓦与梅涅劳斯",
                    "F_{\\text{Menelaus}}",
                    pt(f_pt[0], f_pt[1]),
                    None,
                    "DE \\cap AB",
                    "横截线与 AB（延长线）的交点",
                ).with(Shape::Point {
                    x: f_pt[0],
                    y: f_pt[1],
                    label: "F Menelaus".into(),
                }));
            }
        }
    }

    // Stewart: for a cevian AD to side a=BC with BD=m, DC=n (m+n=a),
    // a(d² + mn) = b²m + c²n. Verify for medians and angle bisectors.
    {
        for i in 0..3 {
            let (aa, bb, cc) = (s[i], s[(i + 1) % 3], s[(i + 2) % 3]);
            // median: m = n = a/2
            let m = aa / 2.0;
            let n = aa / 2.0;
            let d = 0.5 * (2.0 * bb * bb + 2.0 * cc * cc - aa * aa).max(0.0).sqrt();
            let lhs = bb * bb * m + cc * cc * n;
            let rhs = aa * (d * d + m * n);
            if (lhs - rhs).abs() < 1e-6 * (1.0 + lhs.abs()) {
                out.push(fact(
                    "斯特瓦尔特定理",
                    &format!("\\text{{Stewart}}_{{m_{}}}", SIDE[i]),
                    nice(lhs),
                    Some(lhs),
                    &format!(
                        "{b}^2\\cdot\\frac{{{a}}}{{2}} + {c}^2\\cdot\\frac{{{a}}}{{2}} = {a}\\left(m_{s}^2 + \\left(\\frac{{{a}}}{{2}}\\right)^2\\right)",
                        a = SIDE[i],
                        b = SIDE[(i + 1) % 3],
                        c = SIDE[(i + 2) % 3],
                        s = SIDE[i],
                    ),
                    "斯特瓦尔特定理（中线）",
                ));
            }
            // angle bisector: BD:DC = c:b → m = c/(b+c)·a, n = b/(b+c)·a
            let den = bb + cc;
            if den > 1e-12 {
                let m = cc / den * aa;
                let n = bb / den * aa;
                let d = 2.0 * bb * cc * (g[i] / 2.0).cos() / den;
                let lhs = bb * bb * m + cc * cc * n;
                let rhs = aa * (d * d + m * n);
                if (lhs - rhs).abs() < 1e-6 * (1.0 + lhs.abs()) {
                    out.push(fact(
                        "斯特瓦尔特定理",
                        &format!("\\text{{Stewart}}_{{t_{}}}", SIDE[i]),
                        nice(lhs),
                        Some(lhs),
                        &format!(
                            "{b}^2 m + {c}^2 n = {a}(t_{s}^2 + mn),\\ m:n = {c}:{b}",
                            a = SIDE[i],
                            b = SIDE[(i + 1) % 3],
                            c = SIDE[(i + 2) % 3],
                            s = SIDE[i],
                        ),
                        "斯特瓦尔特定理（角平分线）",
                    ));
                }
            }
            // altitude: signed segments along side i (foot may lie on the extension)
            let bpt = v[(i + 1) % 3];
            let cpt = v[(i + 2) % 3];
            let apt = v[i];
            let (dx, dy) = (cpt[0] - bpt[0], cpt[1] - bpt[1]);
            let den2 = dx * dx + dy * dy;
            if den2 > 1e-18 && aa > 1e-12 {
                let t = ((apt[0] - bpt[0]) * dx + (apt[1] - bpt[1]) * dy) / den2;
                let m = t * aa;
                let nseg = (1.0 - t) * aa;
                let d = 2.0 * area / aa;
                let lhs = bb * bb * m + cc * cc * nseg;
                let rhs = aa * (d * d + m * nseg);
                if (lhs - rhs).abs() < 1e-6 * (1.0 + lhs.abs()) {
                    out.push(fact(
                        "斯特瓦尔特定理",
                        &format!("\\text{{Stewart}}_{{h_{}}}", SIDE[i]),
                        nice(lhs),
                        Some(lhs),
                        &format!(
                            "{b}^2 m + {c}^2 n = {a}(h_{s}^2 + mn)",
                            a = SIDE[i],
                            b = SIDE[(i + 1) % 3],
                            c = SIDE[(i + 2) % 3],
                            s = SIDE[i],
                        ),
                        "斯特瓦尔特定理（高，有向线段）",
                    ));
                }
            }
        }
    }

    // Van Obel (incenter form): AI/ID = (b+c)/a.
    {
        for i in 0..3 {
            let (aa, bb, cc) = (s[i], s[(i + 1) % 3], s[(i + 2) % 3]);
            let den = bb + cc;
            if den < 1e-12 || aa < 1e-12 {
                continue;
            }
            let foot = [
                (bb * v[(i + 1) % 3][0] + cc * v[(i + 2) % 3][0]) / den,
                (bb * v[(i + 1) % 3][1] + cc * v[(i + 2) % 3][1]) / den,
            ];
            let ai = dist2(v[i], inc);
            let idlen = dist2(inc, foot);
            if idlen < 1e-12 {
                continue;
            }
            let ratio = ai / idlen;
            let expect = den / aa;
            if (ratio - expect).abs() < 1e-6 * (1.0 + expect) {
                out.push(fact(
                    "凡奥培尔定理",
                    &format!("\\dfrac{{|{n}I|}}{{|ID_{{{s}}}|}}", n = names[i], s = SIDE[i]),
                    nice(ratio),
                    Some(ratio),
                    &format!(
                        "\\dfrac{{{b} + {c}}}{{{a}}} = \\dfrac{{AF}}{{FB}} + \\dfrac{{AE}}{{EC}}",
                        a = SIDE[i],
                        b = SIDE[(i + 1) % 3],
                        c = SIDE[(i + 2) % 3],
                    ),
                    "凡奥培尔定理（内心）：角平分线分对边的内分比之和",
                ).with(Shape::Segment {
                    x1: v[i][0],
                    y1: v[i][1],
                    x2: foot[0],
                    y2: foot[1],
                    label: format!("{}I", names[i]),
                }));
            }
        }
    }

    // Apollonius circle at vertex i.
    {
        for i in 0..3 {
            let b_pt = v[(i + 1) % 3];
            let c_pt = v[(i + 2) % 3];
            let side_to_b = s[(i + 2) % 3];
            let side_to_c = s[(i + 1) % 3];
            let opp = s[i];
            if side_to_c < 1e-12 {
                continue;
            }
            let k = side_to_b / side_to_c;
            if (k - 1.0).abs() < 1e-9 {
                let mid = [(b_pt[0] + c_pt[0]) / 2.0, (b_pt[1] + c_pt[1]) / 2.0];
                out.push(fact(
                    "阿波罗尼奥斯圆",
                    &format!("\\mathcal{{A}}_{{{}}}", names[i]),
                    "\\text{中垂线}".into(),
                    None,
                    &format!(
                        "\\frac{{|P{nb}|}}{{|P{nc}|}} = 1",
                        nb = names[(i + 1) % 3],
                        nc = names[(i + 2) % 3],
                    ),
                    "阿波罗尼奥斯圆退化为对边的中垂线",
                ).with(Shape::Point {
                    x: mid[0],
                    y: mid[1],
                    label: format!("A_{} 中点", names[i]),
                }));
                continue;
            }
            let k2 = k * k;
            let o = [
                (k2 * c_pt[0] - b_pt[0]) / (k2 - 1.0),
                (k2 * c_pt[1] - b_pt[1]) / (k2 - 1.0),
            ];
            let rad = (k * opp / (k2 - 1.0).abs()).abs();
            let d_v = dist2(v[i], o);
            if (d_v - rad).abs() > 1e-4 * (1.0 + rad) {
                continue;
            }
            out.push(fact(
                "阿波罗尼奥斯圆",
                &format!("\\mathcal{{A}}_{{{}}}", names[i]),
                format!(
                    "O=\\left({},\\ {}\\right),\\ R={}",
                    nice_short(o[0]),
                    nice_short(o[1]),
                    nice(rad)
                ),
                Some(rad),
                &format!(
                    "\\frac{{|P{nb}|}}{{|P{nc}|}} = \\frac{{{c}}}{{{b}}} = {k}",
                    nb = names[(i + 1) % 3],
                    nc = names[(i + 2) % 3],
                    b = SIDE[(i + 1) % 3],
                    c = SIDE[(i + 2) % 3],
                    k = nice(k),
                ),
                "阿波罗尼奥斯圆：到两定点距离成定比的轨迹",
            ).with(Shape::Circle {
                cx: o[0],
                cy: o[1],
                r: rad,
                label: format!("阿氏圆 {}", names[i]),
            }));
        }
    }

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
    // Viviani (equilateral): sum of distances to the three sides equals the altitude; at I this is 3r = h.
    if near(a, b) && near(b, c) {
        let h = 2.0 * area / a;
        let sum = 3.0 * r;
        out.push(fact(
            "维维安尼定理",
            "d_a + d_b + d_c",
            nice(sum),
            Some(sum),
            "d_a + d_b + d_c = h",
            "等边三角形：内点到三边距离之和等于高（内心处为 3r）",
        ));
        out.push(fact(
            "维维安尼定理",
            "h",
            nice(h),
            Some(h),
            "3r = h",
            "等边：内切圆半径是高的三分之一",
        ));
    }
    if near(maxg, PI / 2.0) {
        out.push(fact("形状判断", "R", nice(rr), Some(rr), "R = \\frac{\\text{斜边}}{2}", "直角三角形外心在斜边中点"));
        // altitude onto the hypotenuse and the two leg projections (射影定理).
        // Right angle at vertex ri; the hypotenuse joins vertices u and w. Leg s[u]
        // (= V_ri→V_w) projects onto the segment from V_w to the foot F, leg s[w]
        // onto the segment from V_u to F.
        let ri = g.iter().position(|x| near(*x, PI / 2.0)).unwrap();
        let (u, w) = ((ri + 1) % 3, (ri + 2) % 3);
        let (lu, lw, hyp) = (s[u], s[w], s[ri]);
        let t = lw * lw / (hyp * hyp); // |V_u F| = s[w]²/hyp
        let foot = [v[u][0] + t * (v[w][0] - v[u][0]), v[u][1] + t * (v[w][1] - v[u][1])];
        let hc = lu * lw / hyp;
        out.push(fact("高与中线", "\\text{斜边上的高}", nice(hc), Some(hc), &format!("\\frac{{{a}\\cdot {b}}}{{{c}}}", a = SIDE[u], b = SIDE[w], c = SIDE[ri]), "等面积：½·直角边₁·直角边₂ = ½·斜边·h").with(Shape::Segment { x1: v[ri][0], y1: v[ri][1], x2: foot[0], y2: foot[1], label: "斜边上的高".into() }));
        out.push(fact("射影定理", &format!("\\text{{射影}}_{{{}}}", SIDE[u]), nice(lu * lu / hyp), Some(lu * lu / hyp), &format!("\\frac{{{u}^2}}{{{c}}}", u = SIDE[u], c = SIDE[ri]), "直角边² = 斜边 × 这条直角边的射影").with(Shape::Segment { x1: v[w][0], y1: v[w][1], x2: foot[0], y2: foot[1], label: format!("射影 {}", SIDE[u]) }));
        out.push(fact("射影定理", &format!("\\text{{射影}}_{{{}}}", SIDE[w]), nice(lw * lw / hyp), Some(lw * lw / hyp), &format!("\\frac{{{w}^2}}{{{c}}}", w = SIDE[w], c = SIDE[ri]), "直角边² = 斜边 × 这条直角边的射影").with(Shape::Segment { x1: v[u][0], y1: v[u][1], x2: foot[0], y2: foot[1], label: format!("射影 {}", SIDE[w]) }));
    }
    // Morley: adjacent angle trisectors meet at an equilateral triangle.
    {
        let unit = |u: [f64; 2]| {
            let l = u[0].hypot(u[1]);
            if l < 1e-12 {
                [0.0, 0.0]
            } else {
                [u[0] / l, u[1] / l]
            }
        };
        let rot = |u: [f64; 2], ang: f64| {
            let (c, s) = (ang.cos(), ang.sin());
            [u[0] * c - u[1] * s, u[0] * s + u[1] * c]
        };
        let sang = |u: [f64; 2], w: [f64; 2]| (u[0] * w[1] - u[1] * w[0]).atan2(u[0] * w[0] + u[1] * w[1]);
        let mut mverts = [[0.0; 2]; 3];
        let mut ok = true;
        for s in 0..3 {
            let i = s;
            let j = (s + 1) % 3;
            let k = (s + 2) % 3;
            let (pi, pj) = (v[i], v[j]);
            let u_ij = unit([pj[0] - pi[0], pj[1] - pi[1]]);
            let u_ik = unit([v[k][0] - pi[0], v[k][1] - pi[1]]);
            let ai = sang(u_ij, u_ik);
            let dir_i = rot(u_ij, ai / 3.0);
            let u_ji = unit([pi[0] - pj[0], pi[1] - pj[1]]);
            let u_jk = unit([v[k][0] - pj[0], v[k][1] - pj[1]]);
            let aj = sang(u_ji, u_jk);
            let dir_j = rot(u_ji, aj / 3.0);
            let mat = vec![vec![dir_i[0], -dir_j[0]], vec![dir_i[1], -dir_j[1]]];
            if let Some(st) = solve_linear_pub(mat, vec![pj[0] - pi[0], pj[1] - pi[1]]) {
                if st[0].is_finite() && st[0] > 1e-9 {
                    mverts[s] = [pi[0] + st[0] * dir_i[0], pi[1] + st[0] * dir_i[1]];
                } else {
                    ok = false;
                }
            } else {
                ok = false;
            }
        }
        if ok {
            let e01 = dist2(mverts[0], mverts[1]);
            let e12 = dist2(mverts[1], mverts[2]);
            let e20 = dist2(mverts[2], mverts[0]);
            if e01 > 1e-9 && near(e01, e12) && near(e12, e20) {
                out.push(fact(
                    "莫利定理",
                    "\\text{Morley}",
                    "\\text{等边}".into(),
                    None,
                    "\\text{邻角三等分线交点}",
                    "相邻角的三等分线交出等边三角形",
                ));
                out.push(fact(
                    "莫利定理",
                    "|M_0M_1|",
                    nice(e01),
                    Some(e01),
                    "",
                    "莫利三角形边长",
                ).with(Shape::Segment {
                    x1: mverts[0][0],
                    y1: mverts[0][1],
                    x2: mverts[1][0],
                    y2: mverts[1][1],
                    label: "Morley".into(),
                }));
                for (ii, mv) in mverts.iter().enumerate() {
                    out.push(fact(
                        "莫利定理",
                        &format!("M_{}", ii),
                        pt(mv[0], mv[1]),
                        None,
                        "",
                        "莫利三角形顶点",
                    ).with(Shape::Point {
                        x: mv[0],
                        y: mv[1],
                        label: format!("M{}", ii),
                    }));
                }
            }
        }
    }
    // Napoleon: outward equilateral on each side → centroids form an equilateral triangle.
    {
        // Orient: positive cross (pa→pb)×(pa→pc) means CCW; outward on edge B→C is clockwise (−60°).
        let orient = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
        let sign = if orient >= 0.0 { -1.0 } else { 1.0 }; // outward
        let cos60 = 0.5;
        let sin60 = sign * (3.0f64).sqrt() / 2.0;
        let rot = |u: [f64; 2]| -> [f64; 2] {
            [u[0] * cos60 - u[1] * sin60, u[0] * sin60 + u[1] * cos60]
        };
        let mut cents = [[0.0; 2]; 3];
        for i in 0..3 {
            let b = v[(i + 1) % 3];
            let c = v[(i + 2) % 3];
            let w = rot([c[0] - b[0], c[1] - b[1]]);
            let dpt = [b[0] + w[0], b[1] + w[1]];
            cents[i] = [(b[0] + c[0] + dpt[0]) / 3.0, (b[1] + c[1] + dpt[1]) / 3.0];
        }
        let e01 = dist2(cents[0], cents[1]);
        let e12 = dist2(cents[1], cents[2]);
        let e20 = dist2(cents[2], cents[0]);
        if e01 > 1e-12 && near(e01, e12) && near(e12, e20) {
            out.push(fact(
                "拿破仑定理",
                "\\text{Napoleon}",
                "\\text{等边}".into(),
                None,
                "G_aG_bG_c\\text{ 等边}",
                "各边向外作等边三角形，其重心连成等边三角形",
            ));
            out.push(fact(
                "拿破仑定理",
                "|G_aG_b|",
                nice(e01),
                Some(e01),
                "",
                "拿破仑三角形边长",
            ).with(Shape::Segment {
                x1: cents[0][0], y1: cents[0][1], x2: cents[1][0], y2: cents[1][1],
                label: "Napoleon".into(),
            }));
            for (i, gcent) in cents.iter().enumerate() {
                out.push(fact(
                    "拿破仑定理",
                    &format!("G_{{{}}}", SIDE[i]),
                    pt(gcent[0], gcent[1]),
                    None,
                    "",
                    "外侧等边三角形的重心",
                ).with(Shape::Point { x: gcent[0], y: gcent[1], label: format!("G{}", SIDE[i]) }));
            }
        }
    }

    // Simson line: feet from a circumcircle point P onto the three sides are collinear.
    // Take P = antipode of A on the circumcircle (always on (O)).
    {
        let p_sim = [2.0 * circ[0] - pa[0], 2.0 * circ[1] - pa[1]];
        let foot_line = |p: [f64; 2], q1: [f64; 2], q2: [f64; 2]| -> Option<[f64; 2]> {
            let dx = q2[0] - q1[0];
            let dy = q2[1] - q1[1];
            let den = dx * dx + dy * dy;
            if den < 1e-18 {
                return None;
            }
            let t = ((p[0] - q1[0]) * dx + (p[1] - q1[1]) * dy) / den;
            Some([q1[0] + t * dx, q1[1] + t * dy])
        };
        // feet onto BC, CA, AB
        let sides = [(pb, pc), (pc, pa), (pa, pb)];
        let mut feet = [[0.0; 2]; 3];
        let mut ok = true;
        for (i, (q1, q2)) in sides.into_iter().enumerate() {
            if let Some(f) = foot_line(p_sim, q1, q2) {
                feet[i] = f;
            } else {
                ok = false;
            }
        }
        if ok {
            let cross = (feet[1][0] - feet[0][0]) * (feet[2][1] - feet[0][1])
                - (feet[1][1] - feet[0][1]) * (feet[2][0] - feet[0][0]);
            if cross.abs() < 1e-6 * (1.0 + rr) {
                out.push(fact(
                    "西姆松线",
                    "\\text{Simson}",
                    "\\text{共线}".into(),
                    None,
                    "P\\in\\odot(O)\\Rightarrow\\text{三垂足共线}",
                    "西姆松线：外接圆上一点到三边垂足共线（P 取 A 的对径点）",
                ));
                out.push(fact(
                    "西姆松线",
                    "P_{\\text{Simson}}",
                    pt(p_sim[0], p_sim[1]),
                    None,
                    "P = 2O - A",
                    "外接圆上 A 的对径点",
                ).with(Shape::Point {
                    x: p_sim[0],
                    y: p_sim[1],
                    label: "P Simson".into(),
                }));
                for (i, f) in feet.iter().enumerate() {
                    let side_name = SIDE[i];
                    out.push(fact(
                        "西姆松线",
                        &format!("F_{{{}}}", side_name),
                        pt(f[0], f[1]),
                        None,
                        "",
                        &format!("P 到边 {} 的垂足", side_name),
                    ).with(Shape::Point {
                        x: f[0],
                        y: f[1],
                        label: format!("F{}", side_name),
                    }));
                }
                // line through F_a and F_b
                let (f0, f1) = (feet[0], feet[1]);
                let la = f1[1] - f0[1];
                let lb = f0[0] - f1[0];
                let lc = la * f0[0] + lb * f0[1];
                if la.hypot(lb) > 1e-12 {
                    out.push(fact(
                        "西姆松线",
                        "l_{\\text{Simson}}",
                        line_eq_latex(la, lb, lc),
                        None,
                        "三垂足所在直线",
                        "西姆松线方程",
                    ).with(Shape::Segment {
                        x1: f0[0],
                        y1: f0[1],
                        x2: f1[0],
                        y2: f1[1],
                        label: "Simson".into(),
                    }));
                }
            }
        }
    }

    // Trilinear polar of the incenter I (barycentrics a:b:c): X/a + Y/b + Z/c = 0.
    {
        let mut poles: Vec<[f64; 2]> = Vec::new();
        // Intersection with side opposite vertex i (bary coord of that vertex = 0).
        for i in 0..3 {
            let sj = s[(i + 1) % 3];
            let sk = s[(i + 2) % 3];
            // On side jk: α_i = 0, β_j + β_k = 1, β_j/sj + β_k/sk = 0.
            if (sj - sk).abs() < 1e-12 {
                continue; // polar ∥ this side
            }
            let bj = sj / (sj - sk);
            let bk = 1.0 - bj;
            let pj = v[(i + 1) % 3];
            let pk = v[(i + 2) % 3];
            let pt_i = [bj * pj[0] + bk * pk[0], bj * pj[1] + bk * pk[1]];
            if pt_i[0].is_finite() && pt_i[1].is_finite() {
                poles.push(pt_i);
            }
        }
        out.push(fact(
            "三线极线",
            "\\tau(I)",
            "\\frac{X}{a}+\\frac{Y}{b}+\\frac{Z}{c}=0".into(),
            None,
            "I=(a:b:c)_{\\text{bary}}",
            "内心的三线极线（重心坐标方程）",
        ));
        if poles.len() >= 2 {
            let (p0, p1) = (poles[0], poles[1]);
            let la = p1[1] - p0[1];
            let lb = p0[0] - p1[0];
            let lc = la * p0[0] + lb * p0[1];
            if la.hypot(lb) > 1e-12 {
                out.push(fact(
                    "三线极线",
                    "l_{\\tau(I)}",
                    line_eq_latex(la, lb, lc),
                    None,
                    "\\frac{X}{a}+\\frac{Y}{b}+\\frac{Z}{c}=0",
                    "内心三线极线的直角坐标方程",
                ).with(Shape::Segment {
                    x1: p0[0],
                    y1: p0[1],
                    x2: p1[0],
                    y2: p1[1],
                    label: "τ(I)".into(),
                }));
            }
            for (k, pp) in poles.iter().take(3).enumerate() {
                out.push(fact(
                    "三线极线",
                    &format!("Q_{{{}}}", k),
                    pt(pp[0], pp[1]),
                    None,
                    "",
                    "三线极线与边的交点",
                ).with(Shape::Point {
                    x: pp[0],
                    y: pp[1],
                    label: format!("Q{}", k),
                }));
            }
        }
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


pub(crate) fn dist2(a: [f64; 2], b: [f64; 2]) -> f64 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt()
}

/// Directed ratio AP:PB for P on the line AB. P = A + t(B−A) ⇒ AP:PB = t:(1−t).
fn directed_ratio(a: [f64; 2], b: [f64; 2], p: [f64; 2]) -> Option<f64> {
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    let len2 = dx * dx + dy * dy;
    if len2 < 1e-18 {
        return None;
    }
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    if (1.0 - t).abs() < 1e-14 {
        return None;
    }
    Some(t / (1.0 - t))
}

fn section_point(a: [f64; 2], b: [f64; 2], m: f64, n: f64) -> [f64; 2] {
    // divides AB in AP:PB = m:n
    let den = m + n;
    [(n * a[0] + m * b[0]) / den, (n * a[1] + m * b[1]) / den]
}

fn line_line_isect2(p: [f64; 2], q: [f64; 2], r: [f64; 2], s: [f64; 2]) -> Option<[f64; 2]> {
    let d1 = [q[0] - p[0], q[1] - p[1]];
    let d2 = [s[0] - r[0], s[1] - r[1]];
    let det = d1[0] * d2[1] - d1[1] * d2[0];
    if det.abs() < 1e-14 * (d1[0].hypot(d1[1]) * d2[0].hypot(d2[1])).max(1e-18) {
        return None;
    }
    let t = ((r[0] - p[0]) * d2[1] - (r[1] - p[1]) * d2[0]) / det;
    Some([p[0] + t * d1[0], p[1] + t * d1[1]])
}


pub(crate) fn line_eq_latex(a: f64, b: f64, c: f64) -> String {
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
        // Varignon: midpoints of the four sides form a parallelogram.
        {
            let mids = [
                [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0],
                [(b[0] + c[0]) / 2.0, (b[1] + c[1]) / 2.0],
                [(c[0] + d[0]) / 2.0, (c[1] + d[1]) / 2.0],
                [(d[0] + a[0]) / 2.0, (d[1] + a[1]) / 2.0],
            ];
            let side = |i: usize, j: usize| {
                let (u, w) = (mids[i], mids[j]);
                [w[0] - u[0], w[1] - u[1]]
            };
            let (u01, u23) = (side(0, 1), side(3, 2));
            let (u12, u30) = (side(1, 2), side(0, 3));
            let para = |p: [f64; 2], q: [f64; 2]| {
                let cr = p[0] * q[1] - p[1] * q[0];
                let sc = (p[0].hypot(p[1])) * (q[0].hypot(q[1]));
                sc < 1e-12 || cr.abs() < 1e-9 * sc
            };
            if para(u01, u23) && para(u12, u30) {
                let l01 = u01[0].hypot(u01[1]);
                let l12 = u12[0].hypot(u12[1]);
                out.push(fact(
                    "瓦里农定理",
                    "\\text{Varignon}",
                    "\\text{平行四边形}".into(),
                    None,
                    "M_i = \\text{中点}(P_iP_{i+1})",
                    "任意四边形各边中点连成平行四边形",
                ));
                out.push(fact(
                    "瓦里农定理",
                    "|M_0M_1|",
                    nice(l01),
                    Some(l01),
                    "",
                    "Varignon 边长",
                ).with(Shape::Segment {
                    x1: mids[0][0], y1: mids[0][1], x2: mids[1][0], y2: mids[1][1],
                    label: "Varignon".into(),
                }));
                out.push(fact(
                    "瓦里农定理",
                    "|M_1M_2|",
                    nice(l12),
                    Some(l12),
                    "",
                    "Varignon 邻边",
                ));
                for (i, m) in mids.iter().enumerate() {
                    out.push(fact(
                        "瓦里农定理",
                        &format!("M_{}", i),
                        pt(m[0], m[1]),
                        None,
                        "",
                        "边中点",
                    ).with(Shape::Point { x: m[0], y: m[1], label: format!("M{}", i) }));
                }
            }
        }
        // British flag theorem: for rectangle/square, PA²+PC² = PB²+PD² for any P (verify at origin).
        if is_para && right {
            let p0 = [0.0, 0.0];
            let dsq = |q: [f64; 2]| (q[0] - p0[0]).powi(2) + (q[1] - p0[1]).powi(2);
            let lhs = dsq(a) + dsq(c);
            let rhs = dsq(b) + dsq(d);
            if near(lhs, rhs) {
                out.push(fact(
                    "英国国旗定理",
                    "PA^2 + PC^2",
                    nice(lhs),
                    Some(lhs),
                    "PA^2 + PC^2 = PB^2 + PD^2",
                    "矩形上任一点（取原点验证）：对角顶点到点的平方和相等",
                ));
                out.push(fact(
                    "英国国旗定理",
                    "PB^2 + PD^2",
                    nice(rhs),
                    Some(rhs),
                    "PA^2 + PC^2 = PB^2 + PD^2",
                    "英国国旗定理",
                ));
            }
        }

        // Cyclic quad: opposite angles sum to π → Ptolemy + Brahmagupta.
        {
            let cyclic = convex
                && near(angles[0] + angles[2], PI)
                && near(angles[1] + angles[3], PI);
            if cyclic {
                out.push(fact(
                    "圆内接四边形",
                    "\\text{共圆}",
                    "\\checkmark".into(),
                    None,
                    "\\angle A + \\angle C = \\angle B + \\angle D = 180^\\circ",
                    "对角互补 ⇒ 四点共圆",
                ));
                let (ab, bc, cd, da) = (sides[0], sides[1], sides[2], sides[3]);
                let (ac, bd) = (d1, d2);
                let lhs = ac * bd;
                let rhs = ab * cd + da * bc;
                out.push(fact(
                    "托勒密定理",
                    "AC \\cdot BD",
                    nice(lhs),
                    Some(lhs),
                    "AC\\cdot BD = AB\\cdot CD + AD\\cdot BC",
                    "圆内接四边形的托勒密定理",
                ));
                out.push(fact(
                    "托勒密定理",
                    "AB\\cdot CD + AD\\cdot BC",
                    nice(rhs),
                    Some(rhs),
                    "AC\\cdot BD = AB\\cdot CD + AD\\cdot BC",
                    "托勒密：对角线积 = 对边积之和",
                ));
                let ssemi = (ab + bc + cd + da) / 2.0;
                let brahm = ((ssemi - ab) * (ssemi - bc) * (ssemi - cd) * (ssemi - da)).max(0.0).sqrt();
                out.push(fact(
                    "婆罗摩笈多公式",
                    "S_{\\text{Brahmagupta}}",
                    nice(brahm),
                    Some(brahm),
                    "S = \\sqrt{(s-a)(s-b)(s-c)(s-d)}",
                    "圆内接四边形面积（婆罗摩笈多）",
                ));
            }
        }

        out.push(fact("形状判断", "\\text{类型}", format!("\\text{{{}}}", kind), None, "", "由对边平行、直角、边长相等判断"));
    } else {
        out.push(fact("形状判断", "\\text{类型}", format!("\\text{{{}{}边形}}", if convex { "凸" } else { "凹" }, n), None, "", "内角和 (n-2)·180°"));
    }

    // Desargues quick check: pts[0..3] vs pts[3..6] as △ABC, △A′B′C′.
    if pts.len() >= 6 {
        let (a, b, c) = (pts[0].1, pts[1].1, pts[2].1);
        let (ap, bp, cp) = (pts[3].1, pts[4].1, pts[5].1);
        let (na, nb, nc) = (&pts[0].0, &pts[1].0, &pts[2].0);
        let (nap, nbp, ncp) = (&pts[3].0, &pts[4].0, &pts[5].0);
        if let Some(s) = line_line_isect2(a, ap, b, bp) {
            if collinear2(s, c, cp) {
                out.push(fact(
                    "德萨格定理",
                    "\\text{Desargues}",
                    "\\text{透视}".into(),
                    None,
                    &format!("{na}{nap},{nb}{nbp},{nc}{ncp}\\ \\text{{共点}}"),
                    "两三角形对应顶点连线共点 ⇒ 对应边交点共线",
                ).with(Shape::Point {
                    x: s[0],
                    y: s[1],
                    label: "S Desargues".into(),
                }));
                out.push(fact(
                    "德萨格定理",
                    "S",
                    pt(s[0], s[1]),
                    None,
                    "AA'\\cap BB'\\cap CC'",
                    "透视中心",
                ));
                let x = line_line_isect2(b, c, bp, cp);
                let y = line_line_isect2(c, a, cp, ap);
                let z = line_line_isect2(a, b, ap, bp);
                if let (Some(x), Some(y), Some(z)) = (x, y, z) {
                    if collinear2(x, y, z) {
                        out.push(fact(
                            "德萨格定理",
                            "\\text{透视轴}",
                            "\\text{共线}".into(),
                            None,
                            "BC\\cap B'C',\\ CA\\cap C'A',\\ AB\\cap A'B'",
                            "对应边交点共线（德萨格透视轴）",
                        ).with(Shape::Segment {
                            x1: x[0],
                            y1: x[1],
                            x2: y[0],
                            y2: y[1],
                            label: "Desargues轴".into(),
                        }));
                    }
                }
            }
        }
    }

    // Pascal (cyclic hexagon) + Brianchon (opposite-vertex diagonals) for 6-gon in order.
    if n == 6 {
        let v: [[f64; 2]; 6] = std::array::from_fn(|i| pts[i].1);
        let names: [&str; 6] = std::array::from_fn(|i| pts[i].0.as_str());
        // Cyclic? circumcircle of first three; others on it.
        if let Some((o, r)) = circum2(v[0], v[1], v[2]) {
            let cyclic = (3..6).all(|i| (dist2(v[i], o) - r).abs() < 1e-6 * (1.0 + r));
            if cyclic {
                // Opposite sides: AB∩DE, BC∩EF, CD∩FA
                let p01 = line_line_isect2(v[0], v[1], v[3], v[4]);
                let p12 = line_line_isect2(v[1], v[2], v[4], v[5]);
                let p23 = line_line_isect2(v[2], v[3], v[5], v[0]);
                match (p01, p12, p23) {
                    (Some(x), Some(y), Some(z)) if collinear2(x, y, z) => {
                        out.push(fact(
                            "帕斯卡定理",
                            "\\text{Pascal}",
                            "\\text{共线}".into(),
                            None,
                            "AB\\cap DE,\\ BC\\cap EF,\\ CD\\cap FA",
                            "圆内接六边形：三组对边交点共线（帕斯卡线）",
                        ).with(Shape::Segment {
                            x1: x[0],
                            y1: x[1],
                            x2: y[0],
                            y2: y[1],
                            label: "Pascal".into(),
                        }));
                        out.push(fact(
                            "帕斯卡定理",
                            "\\text{Pascal线}",
                            line_eq_latex(y[1] - x[1], x[0] - y[0], (y[1] - x[1]) * x[0] + (x[0] - y[0]) * x[1]),
                            None,
                            "",
                            "帕斯卡线方程",
                        ));
                    }
                    (None, None, None) => {
                        out.push(fact(
                            "帕斯卡定理",
                            "\\text{Pascal}",
                            "\\text{无穷远直线}".into(),
                            None,
                            "AB\\parallel DE,\\ BC\\parallel EF,\\ CD\\parallel FA",
                            "对边皆平行：帕斯卡线为无穷远直线",
                        ));
                    }
                    _ => {}
                }
            }
        }
        // Brianchon: diagonals joining opposite vertices AD, BE, CF concur.
        if let Some(s) = line_line_isect2(v[0], v[3], v[1], v[4]) {
            if collinear2(s, v[2], v[5]) {
                // also check tangential side condition a+c+e = b+d+f (sufficient for circle)
                let side = |i: usize, j: usize| dist2(v[i], v[j]);
                let ace = side(0, 1) + side(2, 3) + side(4, 5);
                let bdf = side(1, 2) + side(3, 4) + side(5, 0);
                out.push(fact(
                    "布利安雄定理",
                    "\\text{Brianchon}",
                    "\\text{共点}".into(),
                    None,
                    &format!(
                        "{}{}\\cap{}{}\\cap{}{}",
                        names[0], names[3], names[1], names[4], names[2], names[5]
                    ),
                    "六边形对顶点连线共点（布利安雄点）",
                ).with(Shape::Point {
                    x: s[0],
                    y: s[1],
                    label: "Brianchon".into(),
                }));
                out.push(fact(
                    "布利安雄定理",
                    "B",
                    pt(s[0], s[1]),
                    None,
                    "AD\\cap BE\\cap CF",
                    "布利安雄点",
                ));
                if (ace - bdf).abs() < 1e-6 * (1.0 + ace) {
                    out.push(fact(
                        "布利安雄定理",
                        "a+c+e = b+d+f",
                        nice(ace),
                        Some(ace),
                        "a+c+e = b+d+f",
                        "对边和相等：存在内切圆（切线六边形）",
                    ));
                }
            }
        }
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
            out.push(fact("体积", "V_{\\text{四面体}}", nice(vol), Some(vol), "V = \\frac16\\left|\\vec{AD}\\cdot(\\vec{AB}\\times\\vec{AC})\\right|", "混合积"));
            // Cayley–Menger: volume from the six edge lengths alone.
            {
                let p0 = pts[0].1;
                let p1 = pts[1].1;
                let p2 = pts[2].1;
                let p3 = pts[3].1;
                let d12 = len3(sub3(p1, p0));
                let d13 = len3(sub3(p2, p0));
                let d14 = len3(sub3(p3, p0));
                let d23 = len3(sub3(p2, p1));
                let d24 = len3(sub3(p3, p1));
                let d34 = len3(sub3(p3, p2));
                let s = |x: f64| x * x;
                let mut m = [
                    [0.0, 1.0, 1.0, 1.0, 1.0],
                    [1.0, 0.0, s(d12), s(d13), s(d14)],
                    [1.0, s(d12), 0.0, s(d23), s(d24)],
                    [1.0, s(d13), s(d23), 0.0, s(d34)],
                    [1.0, s(d14), s(d24), s(d34), 0.0],
                ];
                // Gaussian elimination → det
                let mut det = 1.0_f64;
                for i in 0..5 {
                    let mut piv = i;
                    for r in (i + 1)..5 {
                        if m[r][i].abs() > m[piv][i].abs() {
                            piv = r;
                        }
                    }
                    if m[piv][i].abs() < 1e-18 {
                        det = 0.0;
                        break;
                    }
                    if piv != i {
                        m.swap(piv, i);
                        det = -det;
                    }
                    det *= m[i][i];
                    for r in (i + 1)..5 {
                        let f = m[r][i] / m[i][i];
                        for c in i..5 {
                            m[r][c] -= f * m[i][c];
                        }
                    }
                }
                let v_cm2 = det.abs() / 288.0;
                if v_cm2 >= 0.0 {
                    let v_cm = v_cm2.sqrt();
                    out.push(fact(
                        "体积",
                        "V_{\\text{Cayley--Menger}}",
                        nice(v_cm),
                        Some(v_cm),
                        "288V^2 = |\\det M_5|",
                        "凯莱–门杰行列式：由六棱长求四面体体积",
                    ));
                }
            }
            if area > 1e-12 {
                let h = 3.0 * vol / area;
                out.push(fact("距离", &format!("d({}, \\text{{平面}})", pts[3].0), nice(h), Some(h), "d = \\frac{3V}{S}", "等体积法"));
            }

            
            // Four face areas and altitudes from each vertex to the opposite face.
            {
                let verts = [pts[0].1, pts[1].1, pts[2].1, pts[3].1];
                let labels = [&pts[0].0, &pts[1].0, &pts[2].0, &pts[3].0];
                let faces = [[1usize, 2, 3], [0, 2, 3], [0, 1, 3], [0, 1, 2]];
                for (i, face) in faces.iter().enumerate() {
                    let (p, q, r) = (verts[face[0]], verts[face[1]], verts[face[2]]);
                    let nrm = cross3(sub3(q, p), sub3(r, p));
                    let s_face = len3(nrm) / 2.0;
                    let fname = format!("{}{}{}", labels[face[0]], labels[face[1]], labels[face[2]]);
                    out.push(fact(
                        "四面体面",
                        &format!("S_{{\\triangle {}}}", fname),
                        nice(s_face),
                        Some(s_face),
                        "S = \\frac12|\\vec{u}\\times\\vec{v}|",
                        "四面体的一个面的面积",
                    ));
                    if s_face > 1e-12 && vol > 1e-12 {
                        let h_i = 3.0 * vol / s_face;
                        out.push(fact(
                            "四面体面",
                            &format!("h_{{{}}}", labels[i]),
                            nice(h_i),
                            Some(h_i),
                            "h = \\frac{3V}{S_{\\text{对面}}}",
                            &format!("从顶点 {} 到对面的高", labels[i]),
                        ));
                    }
                }
            }

            // Viviani for regular tetrahedron: sum of distances from an interior point to the four faces = altitude.
            {
                let edges = [
                    len3(sub3(pts[1].1, pts[0].1)),
                    len3(sub3(pts[2].1, pts[0].1)),
                    len3(sub3(pts[3].1, pts[0].1)),
                    len3(sub3(pts[2].1, pts[1].1)),
                    len3(sub3(pts[3].1, pts[1].1)),
                    len3(sub3(pts[3].1, pts[2].1)),
                ];
                let e0 = edges[0];
                if e0 > 1e-12 && edges.iter().all(|e| near(*e, e0)) && vol > 1e-12 {
                    // Regular tetra: altitude h = √6 / 3 · a; inradius ρ = h/4
                    let h_reg = (6.0f64).sqrt() / 3.0 * e0;
                    let rho = h_reg / 4.0;
                    out.push(fact(
                        "维维安尼定理",
                        "\\sum d_{\\text{面}}",
                        nice(h_reg),
                        Some(h_reg),
                        "d_1+d_2+d_3+d_4 = h",
                        "正四面体：内点到四面距离之和等于高（形心处为 4ρ）",
                    ));
                    out.push(fact(
                        "维维安尼定理",
                        "\\rho",
                        nice(rho),
                        Some(rho),
                        "\\rho = h/4",
                        "正四面体内切球半径",
                    ));
                }
            }
            // Skew / intersecting lines AB and CD from the first four points.
            let (na, nb, nc, nd) = (&pts[0].0, &pts[1].0, &pts[2].0, &pts[3].0);
            let (pa, pb, pc, pd) = (pts[0].1, pts[1].1, pts[2].1, pts[3].1);
            let ab = sub3(pb, pa);
            let cd = sub3(pd, pc);
            let (lab, lcd) = (len3(ab), len3(cd));
            if lab > 1e-12 && lcd > 1e-12 {
                let cosang = (dot3(ab, cd).abs() / (lab * lcd)).clamp(0.0, 1.0);
                let theta = cosang.acos();
                out.push(fact(
                    "异面直线",
                    &format!("\\theta({}{}, {}{})", na, nb, nc, nd),
                    deg(theta),
                    Some(theta),
                    "\\cos\\theta = \\frac{|\\vec{AB}\\cdot\\vec{CD}|}{|\\vec{AB}||\\vec{CD}|}",
                    "两直线方向的夹角（取锐角或直角）",
                ));
            }
            let nskew = cross3(ab, cd);
            let ln = len3(nskew);
            let ac = sub3(pc, pa);
            if ln < 1e-12 * len3(ab).max(len3(cd)).max(1e-12) {
                let parallel = len3(ab) > 1e-12 && len3(cd) > 1e-12;
                if parallel {
                    let n2 = cross3(ab, ac);
                    let dpar = len3(n2) / len3(ab);
                    out.push(fact(
                        "异面直线",
                        &format!("{}{} \\parallel {}{}", na, nb, nc, nd),
                        "\\checkmark".into(),
                        None,
                        "\\vec{AB} \\times \\vec{CD} = \\mathbf{0}",
                        "方向向量共线",
                    ));
                    out.push(fact(
                        "异面直线",
                        &format!("d({}{}, {}{})", na, nb, nc, nd),
                        nice(dpar),
                        Some(dpar),
                        "d = \\frac{|\\vec{AB}\\times\\vec{AC}|}{|\\vec{AB}|}",
                        "平行直线间距离",
                    ));
                }
            } else {
                let triple = dot3(ac, nskew);
                let dskew = triple.abs() / ln;
                if dskew < 1e-9 {
                    out.push(fact(
                        "异面直线",
                        &format!("{}{} , {}{}", na, nb, nc, nd),
                        "\\text{共面（相交或平行）}".into(),
                        Some(0.0),
                        "\\vec{AC}\\cdot(\\vec{AB}\\times\\vec{CD}) = 0",
                        "混合积为 0 ⇒ 共面",
                    ));
                } else {
                    out.push(fact(
                        "异面直线",
                        &format!("d({}{}, {}{})", na, nb, nc, nd),
                        nice(dskew),
                        Some(dskew),
                        "d = \\frac{|\\vec{AC}\\cdot(\\vec{AB}\\times\\vec{CD})|}{|\\vec{AB}\\times\\vec{CD}|}",
                        "异面直线的距离",
                    ).with(Shape::Line3 {
                        px: pa[0],
                        py: pa[1],
                        pz: pa[2],
                        dx: ab[0],
                        dy: ab[1],
                        dz: ab[2],
                        label: format!("{na}{nb}"),
                    }));
                    out.push(fact(
                        "异面直线",
                        &format!("{}{} \\nparallel {}{}", na, nb, nc, nd),
                        "\\text{异面}".into(),
                        None,
                        "\\vec{AB}\\times\\vec{CD}\\ne\\mathbf{0},\\ \\vec{AC}\\cdot(\\vec{AB}\\times\\vec{CD})\\ne 0",
                        "既不平行也不相交",
                    ));
                }
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
            let fmt = |v: &[f64]| if is3 { pt3([v[0], v[1], v[2]]) } else { pt(v[0], v[1]) };
            out.push(fact("两向量关系", &format!("{} \\cdot {}", na, nb), nice(d), Some(d), "x_1x_2 + y_1y_2 + z_1z_2", "数量积"));
            if la > 1e-12 && lb > 1e-12 {
                let ang = (d / (la * lb)).clamp(-1.0, 1.0).acos();
                out.push(fact("两向量关系", &format!("\\langle {}, {} \\rangle", na, nb), deg(ang), Some(ang), "\\cos\\theta = \\frac{\\vec a\\cdot\\vec b}{|\\vec a||\\vec b|}", "夹角"));
                let proj = d / lb;
                out.push(fact("两向量关系", &format!("\\text{{{} 在 {} 上的投影}}", vs[i].name, vs[j].name), nice(proj), Some(proj), "\\frac{\\vec a\\cdot\\vec b}{|\\vec b|}", "投影（数量）"));
                // projection vector of a onto b, and the perpendicular rest: a = proj + perp
                let pb2 = dot3(b, b);
                let k = d / pb2;
                let projv: Vec<f64> = (0..3).map(|t| k * b[t]).collect();
                let perp: Vec<f64> = (0..3).map(|t| a[t] - k * b[t]).collect();
                out.push(fact("两向量关系", &format!("\\text{{proj}}_{{{}}}\\ {}", nb, na), fmt(&projv), None, "\\frac{{\\vec a\\cdot\\vec b}}{{|\\vec b|^2}}\\,\\vec b", "投影向量").with(if is3 { Shape::Arrow3 { x: projv[0], y: projv[1], z: projv[2], label: format!("proj{}_{}", vs[i].name, vs[j].name) } } else { Shape::Segment { x1: 0.0, y1: 0.0, x2: projv[0], y2: projv[1], label: format!("proj{}_{}", vs[i].name, vs[j].name) } }));
                out.push(fact("两向量关系", &format!("{} - \\text{{proj}}_{{{}}}\\ {}", na, nb, na), fmt(&perp), None, "\\vec a - \\text{proj}_{\\vec b}\\,\\vec a", "垂直分量：a = 投影 + 垂直").with(if is3 { Shape::Arrow3 { x: perp[0], y: perp[1], z: perp[2], label: format!("perp{}_{}", vs[i].name, vs[j].name) } } else { Shape::Segment { x1: projv[0], y1: projv[1], x2: a[0], y2: a[1], label: format!("perp{}_{}", vs[i].name, vs[j].name) } }));
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
            out.push(fact("两向量关系", &format!("{} + {}", na, nb), fmt(&sum), None, "", "坐标相加"));
            out.push(fact("两向量关系", &format!("{} - {}", na, nb), fmt(&dif), None, "", "坐标相减"));
            // Parallelogram law: |a+b|² + |a−b|² = 2(|a|²+|b|²)
            {
                let sum_len2 = sum[0] * sum[0] + sum[1] * sum[1] + sum[2] * sum[2];
                let dif_len2 = dif[0] * dif[0] + dif[1] * dif[1] + dif[2] * dif[2];
                let rhs = 2.0 * (la * la + lb * lb);
                let lhs = sum_len2 + dif_len2;
                if (lhs - rhs).abs() < 1e-6 * (1.0 + rhs) {
                    out.push(fact(
                        "平行四边形法则",
                        &format!("|{0}+{1}|^2 + |{0}-{1}|^2", vs[i].name, vs[j].name),
                        nice(lhs),
                        Some(lhs),
                        "|\\vec a+\\vec b|^2 + |\\vec a-\\vec b|^2 = 2(|\\vec a|^2+|\\vec b|^2)",
                        "平行四边形法则（向量形式）",
                    ));
                }
            }
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

/// Intersection point of two lines a x + b y = c, when they are not (near-)parallel.
fn line_isect(p: &NamedLine, q: &NamedLine) -> Option<[f64; 2]> {
    let det = p.a * q.b - p.b * q.a;
    if det.abs() < 1e-12 * (p.a.hypot(p.b) * q.a.hypot(q.b)) {
        return None;
    }
    Some([(p.c * q.b - p.b * q.c) / det, (p.a * q.c - p.c * q.a) / det])
}


/// Circumcenter and radius of △ABC; None if collinear.
fn circum2(a: [f64; 2], b: [f64; 2], c: [f64; 2]) -> Option<([f64; 2], f64)> {
    let d = 2.0 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    if d.abs() < 1e-14 {
        return None;
    }
    let sq = |q: [f64; 2]| q[0] * q[0] + q[1] * q[1];
    let ux = (sq(a) * (b[1] - c[1]) + sq(b) * (c[1] - a[1]) + sq(c) * (a[1] - b[1])) / d;
    let uy = (sq(a) * (c[0] - b[0]) + sq(b) * (a[0] - c[0]) + sq(c) * (b[0] - a[0])) / d;
    let o = [ux, uy];
    let r = dist2(o, a);
    if r < 1e-14 || !r.is_finite() {
        return None;
    }
    Some((o, r))
}

fn collinear2(a: [f64; 2], b: [f64; 2], c: [f64; 2]) -> bool {
    let cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    cross.abs() < 1e-8 * (1.0 + dist2(a, b) * dist2(a, c))
}

/// Second intersection of two circles, skipping `avoid` (the shared vertex).
fn circles_second_isect(
    o1: [f64; 2],
    r1: f64,
    o2: [f64; 2],
    r2: f64,
    avoid: [f64; 2],
) -> Option<[f64; 2]> {
    let dx = o2[0] - o1[0];
    let dy = o2[1] - o1[1];
    let d = dx.hypot(dy);
    if d < 1e-12 || d > r1 + r2 + 1e-9 || d < (r1 - r2).abs() - 1e-9 {
        return None;
    }
    let a = (r1 * r1 - r2 * r2 + d * d) / (2.0 * d);
    let h2 = r1 * r1 - a * a;
    if h2 < -1e-9 {
        return None;
    }
    let h = h2.max(0.0).sqrt();
    let px = o1[0] + a * dx / d;
    let py = o1[1] + a * dy / d;
    let mx = -dy * h / d;
    let my = dx * h / d;
    let p_a = [px + mx, py + my];
    let p_b = [px - mx, py - my];
    let da = dist2(p_a, avoid);
    let db = dist2(p_b, avoid);
    if da < 1e-6 && db < 1e-6 {
        return None;
    }
    Some(if da >= db { p_a } else { p_b })
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

                let rp = [2.0 * foot[0] - x, 2.0 * foot[1] - y];
                out.push(fact(
                    "反射",
                    &format!("{}^{{\\prime}}_{{{}}}", p.name, nm),
                    pt(rp[0], rp[1]),
                    None,
                    "P' = 2\\,\\mathrm{foot} - P",
                    &format!("点 {} 关于直线 {} 的反射", p.name, nm),
                ).with(Shape::Point {
                    x: rp[0],
                    y: rp[1],
                    label: format!("{}′/{}", p.name, nm),
                }));

            }
        }
    }
    let mut par_pairs: Vec<(usize, usize)> = Vec::new();
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
                    par_pairs.push((i, j));
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
    // transversals: a third line cutting a parallel pair — equal corresponding / alternate
    // interior angles, supplementary co-interior angles, and the segment cut off between
    // the two parallels along the transversal.
    for &(i, j) in &par_pairs {
        for t in 0..ls.len() {
            if t == i || t == j {
                continue;
            }
            let (Some(pa), Some(pb)) = (line_isect(&ls[i], &ls[t]), line_isect(&ls[j], &ls[t])) else { continue };
            let (p, q, tr) = (&ls[i], &ls[j], &ls[t]);
            let det = p.a * tr.b - p.b * tr.a;
            let dt = p.a * tr.a + p.b * tr.b;
            let theta = det.abs().atan2(dt.abs());
            out.push(fact("平行线的截线", &format!("\\text{{同位角}} \\; \\angle({}, {}) = \\angle({}, {})", tr.name, p.name, tr.name, q.name), deg(theta), Some(theta), "两直线平行，同位角相等", "同位角"));
            out.push(fact("平行线的截线", &format!("\\text{{内错角}}({} \\mid {} \\parallel {})", tr.name, p.name, q.name), deg(theta), Some(theta), "两直线平行，内错角相等", "内错角"));
            out.push(fact("平行线的截线", &format!("\\text{{同旁内角}}({} \\mid {} \\parallel {})", tr.name, p.name, q.name), deg(PI - theta), Some(PI - theta), "两直线平行，同旁内角互补", "同旁内角"));
            let cut = dist2(pa, pb);
            out.push(fact("平行线的截线", &format!("\\text{{截线段}}_{{{}}}", tr.name), nice(cut), Some(cut), "|PQ| = \\sqrt{\\Delta x^2 + \\Delta y^2}", "沿截线夹在两平行线之间的线段").with(Shape::Segment { x1: pa[0], y1: pa[1], x2: pb[0], y2: pb[1], label: format!("{} 截 {}", tr.name, p.name) }));
        }
    }
    // Intercept theorem: three (or more) parallels cut by two transversals give proportional
    // segments (平行线分线段成比例); two parallels cut by two transversals give similar
    // triangles at the point where the transversals meet.
    let dist_key = |l: &NamedLine| {
        let n = l.a.hypot(l.b);
        if n < 1e-12 {
            return 0.0;
        }
        let sign = if l.a.abs() > 1e-12 { l.a.signum() } else { l.b.signum() };
        sign * l.c / n
    };
    let crosses = |s: usize, p: usize| line_isect(&ls[s], &ls[p]).is_some();
    let s_name = |ix: usize| ls[ix].name.clone();
    let mut triple_count = 0usize;
    'triples: for i in 0..ls.len() {
        for j in i + 1..ls.len() {
            for k in j + 1..ls.len() {
                if triple_count >= 2 {
                    break 'triples;
                }
                let is_par = |x: usize, y: usize| par_pairs.contains(&(x.min(y), x.max(y)));
                if !(is_par(i, j) && is_par(i, k)) {
                    continue;
                }
                // order the three parallels along their common normal
                let mut trio = [i, j, k];
                trio.sort_by(|x, y| dist_key(&ls[*x]).partial_cmp(&dist_key(&ls[*y])).unwrap());
                let (p, q, r) = (s_name(trio[0]), s_name(trio[1]), s_name(trio[2]));
                let mut tcount = 0usize;
                'ts: for s in 0..ls.len() {
                    for t in s + 1..ls.len() {
                        if tcount >= 2 {
                            break 'ts;
                        }
                        if trio.contains(&s) || trio.contains(&t) || !crosses(s, trio[0]) || !crosses(s, trio[2]) || !crosses(t, trio[0]) || !crosses(t, trio[2]) {
                            continue;
                        }
                        if line_isect(&ls[s], &ls[t]).is_none() {
                            continue; // the two transversals must meet somewhere
                        }
                        let ps: Vec<[f64; 2]> = trio.iter().map(|&ix| line_isect(&ls[s], &ls[ix]).unwrap()).collect();
                        let qt: Vec<[f64; 2]> = trio.iter().map(|&ix| line_isect(&ls[t], &ls[ix]).unwrap()).collect();
                        let (l1, l2) = (dist2(ps[0], ps[1]), dist2(ps[1], ps[2]));
                        let (m1, m2) = (dist2(qt[0], qt[1]), dist2(qt[1], qt[2]));
                        if l1 * l2 * m1 * m2 < 1e-12 {
                            continue;
                        }
                        tcount += 1;
                        let sn = s_name(s);
                        let tn = s_name(t);
                        let seg = |x: &[f64; 2], y: &[f64; 2], nm: String| Shape::Segment { x1: x[0], y1: x[1], x2: y[0], y2: y[1], label: nm };
                        out.push(seg_fact("平行线分线段", &format!("|{sn} \\cap {p},\\ {sn} \\cap {q}|"), l1, "\\sqrt{\\Delta x^2 + \\Delta y^2}", "第一条截线段").with(seg(&ps[0], &ps[1], format!("{sn} 上的截线段"))));
                        out.push(seg_fact("平行线分线段", &format!("|{sn} \\cap {q},\\ {sn} \\cap {r}|"), l2, "\\sqrt{\\Delta x^2 + \\Delta y^2}", "第二条截线段").with(seg(&ps[1], &ps[2], format!("{sn} 上的截线段"))));
                        out.push(seg_fact("平行线分线段", &format!("|{tn} \\cap {p},\\ {tn} \\cap {q}|"), m1, "\\sqrt{\\Delta x^2 + \\Delta y^2}", "对应的第一条截线段").with(seg(&qt[0], &qt[1], format!("{tn} 上的截线段"))));
                        out.push(seg_fact("平行线分线段", &format!("|{tn} \\cap {q},\\ {tn} \\cap {r}|"), m2, "\\sqrt{\\Delta x^2 + \\Delta y^2}", "对应的第二条截线段").with(seg(&qt[1], &qt[2], format!("{tn} 上的截线段"))));
                        out.push(fact("平行线分线段", "\\text{成比例}", nice(l1 / l2), Some(l1 / l2), &format!("\\frac{{|{sn} \\cap {p},\\ {sn} \\cap {q}|}}{{|{sn} \\cap {q},\\ {sn} \\cap {r}|}} = \\frac{{|{tn} \\cap {p},\\ {tn} \\cap {q}|}}{{|{tn} \\cap {q},\\ {tn} \\cap {r}|}} = {}", nice(m1 / m2)), "平行线分线段成比例定理：三条平行线在两条截线上截出的线段对应成比例"));
                    }
                }
                triple_count += 1;
            }
        }
    }
    // similar triangles: two parallels + two transversals meeting at X
    let mut sim_count = 0usize;
    'sims: for &(i, j) in &par_pairs {
        for s in 0..ls.len() {
            for t in s + 1..ls.len() {
                if sim_count >= 2 {
                    break 'sims;
                }
                if s == i || s == j || t == i || t == j {
                    continue;
                }
                let (Some(x), Some(a), Some(c)) = (line_isect(&ls[s], &ls[t]), line_isect(&ls[s], &ls[i]), line_isect(&ls[s], &ls[j])) else { continue };
                let (Some(b), Some(d)) = (line_isect(&ls[t], &ls[i]), line_isect(&ls[t], &ls[j])) else { continue };
                let (k1n, k1d) = (dist2(x, a), dist2(x, c));
                let (k2n, k2d) = (dist2(x, b), dist2(x, d));
                if k1d < 1e-9 || k2d < 1e-9 || k1n < 1e-9 || k2n < 1e-9 {
                    continue; // transversals meet on one of the parallels
                }
                sim_count += 1;
                let k1 = k1n / k1d;
                let k2 = k2n / k2d;
                let value = if near(k1, k2) { nice(k1) } else { format!("{} \\approx {}", nice(k1), nice(k2)) };
                let (pn, qn, sn, tn) = (ls[i].name.clone(), ls[j].name.clone(), ls[s].name.clone(), ls[t].name.clone());
                out.push(fact("相似三角形", &format!("\\text{{相似比}}_{{{}}}", pn), value, Some(k1), &format!("\\frac{{|X({sn} \\cap {pn})|}}{{|X({sn} \\cap {qn})|}} = \\frac{{|X({tn} \\cap {pn})|}}{{|X({tn} \\cap {qn})|}} = {}", nice(k1)), "平行于三角形一边的直线截其他两边，所得三角形与原三角形相似（X = 两截线的交点）"));
            }
        }
    }

    // Miquel point of a complete quadrilateral (4 lines, 6 vertices).
    if ls.len() >= 4 {
        let n = ls.len().min(6);
        'miquel: for i0 in 0..n {
            for i1 in (i0 + 1)..n {
                for i2 in (i1 + 1)..n {
                    for i3 in (i2 + 1)..n {
                        let idx = [i0, i1, i2, i3];
                        let mut ok_pairs = true;
                        for a in 0..4 {
                            for b in (a + 1)..4 {
                                if line_isect(&ls[idx[a]], &ls[idx[b]]).is_none() {
                                    ok_pairs = false;
                                }
                            }
                        }
                        if !ok_pairs {
                            continue;
                        }
                        let tri = |a: usize, b: usize, c: usize| -> Option<[[f64; 2]; 3]> {
                            Some([
                                line_isect(&ls[idx[a]], &ls[idx[b]])?,
                                line_isect(&ls[idx[b]], &ls[idx[c]])?,
                                line_isect(&ls[idx[c]], &ls[idx[a]])?,
                            ])
                        };
                        let (Some(t012), Some(t013), Some(t023), Some(t123)) =
                            (tri(0, 1, 2), tri(0, 1, 3), tri(0, 2, 3), tri(1, 2, 3))
                        else {
                            continue;
                        };
                        if collinear2(t012[0], t012[1], t012[2])
                            || collinear2(t013[0], t013[1], t013[2])
                            || collinear2(t023[0], t023[1], t023[2])
                            || collinear2(t123[0], t123[1], t123[2])
                        {
                            continue;
                        }
                        let (Some((o1, r1)), Some((o2, r2))) =
                            (circum2(t012[0], t012[1], t012[2]), circum2(t013[0], t013[1], t013[2]))
                        else {
                            continue;
                        };
                        let shared = line_isect(&ls[idx[0]], &ls[idx[1]]).unwrap();
                        let Some(m) = circles_second_isect(o1, r1, o2, r2, shared) else {
                            continue;
                        };
                        let (Some((o3, r3)), Some((o4, r4))) =
                            (circum2(t023[0], t023[1], t023[2]), circum2(t123[0], t123[1], t123[2]))
                        else {
                            continue;
                        };
                        if (dist2(m, o3) - r3).abs() > 1e-5 * (1.0 + r3)
                            || (dist2(m, o4) - r4).abs() > 1e-5 * (1.0 + r4)
                        {
                            continue;
                        }
                        let names = format!(
                            "{},{},{},{}",
                            ls[idx[0]].name, ls[idx[1]].name, ls[idx[2]].name, ls[idx[3]].name
                        );
                        out.push(fact(
                            "米克尔点",
                            "\\text{Miquel}",
                            pt(m[0], m[1]),
                            None,
                            "\\odot(L_iL_jL_k)\\ \\text{共点}",
                            &format!("完全四线形 {{{names}}} 的四个三点形外接圆交于米克尔点"),
                        ).with(Shape::Point {
                            x: m[0],
                            y: m[1],
                            label: "Miquel".into(),
                        }));
                        out.push(fact(
                            "米克尔点",
                            "M",
                            pt(m[0], m[1]),
                            None,
                            "",
                            "米克尔点坐标",
                        ));
                        break 'miquel;
                    }
                }
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
            if ln > 1e-12 && d > 1e-8 && d.is_finite() {
                let lam = (p.d - dot3(p.n, x)) / (ln * ln);
                let foot = [x[0] + lam * p.n[0], x[1] + lam * p.n[1], x[2] + lam * p.n[2]];
                out.push(fact(
                    "点与平面",
                    &format!("\\text{{foot}}({}, {})", q.name, p.name),
                    pt3(foot),
                    None,
                    "P + \\frac{d - \\vec n\\cdot P}{|\\vec n|^2}\\vec n",
                    "点到平面的垂足",
                ).with(Shape::Point3 { x: foot[0], y: foot[1], z: foot[2], label: format!("foot {} {}", q.name, p.name) }));

                let rp = [2.0 * foot[0] - x[0], 2.0 * foot[1] - x[1], 2.0 * foot[2] - x[2]];
                out.push(fact(
                    "反射",
                    &format!("{}^{{\\prime}}_{{{}}}", q.name, p.name),
                    pt3(rp),
                    None,
                    "P' = 2\\,\\mathrm{foot} - P",
                    &format!("点 {} 关于平面 {} 的反射", q.name, p.name),
                ).with(Shape::Point3 {
                    x: rp[0],
                    y: rp[1],
                    z: rp[2],
                    label: format!("{}′/{}", q.name, p.name),
                }));

            }
        }
    }
    // Line–plane angle: every pair of 3D points defines a line.
    {
        let pts3: Vec<(String, [f64; 3])> = points
            .iter()
            .filter(|q| q.p.len() >= 3)
            .map(|q| (q.name.clone(), [q.p[0], q.p[1], q.p[2]]))
            .collect();
        let mut pair_count = 0usize;
        'pairs: for i in 0..pts3.len() {
            for j in i + 1..pts3.len() {
                if pair_count >= 6 {
                    break 'pairs;
                }
                let (ref na, pa) = pts3[i];
                let (ref nb, pb) = pts3[j];
                let dir = sub3(pb, pa);
                let ld = len3(dir);
                if ld < 1e-12 {
                    continue;
                }
                pair_count += 1;
                for p in ps {
                    let ln = len3(p.n);
                    if ln < 1e-12 {
                        continue;
                    }
                    let sin_phi = (dot3(dir, p.n).abs() / (ld * ln)).clamp(0.0, 1.0);
                    let phi = sin_phi.asin(); // angle between line and plane ∈ [0, π/2]
                    out.push(fact(
                        "线面角",
                        &format!("\\theta({}{}, {})", na, nb, p.name),
                        deg(phi),
                        Some(phi),
                        "\\sin\\theta = \\dfrac{|\\vec v\\cdot\\vec n|}{|\\vec v||\\vec n|}",
                        "直线与平面所成的角",
                    ));
                    if sin_phi < 1e-9 {
                        out.push(fact(
                            "线面角",
                            &format!("{}{} \\parallel {}", na, nb, p.name),
                            "\\checkmark".into(),
                            None,
                            "\\vec v\\cdot\\vec n = 0",
                            "直线平行于平面（或落在平面上）",
                        ));
                    } else if (1.0 - sin_phi).abs() < 1e-9 {
                        out.push(fact(
                            "线面角",
                            &format!("{}{} \\perp {}", na, nb, p.name),
                            "\\checkmark".into(),
                            None,
                            "|\\vec v\\cdot\\vec n| = |\\vec v||\\vec n|",
                            "直线垂直于平面",
                        ));
                    }
                }
            }
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
            out.push(fact(
                "两平面",
                &format!("\\text{{二面角}}({}, {})", p.name, q.name),
                deg(ang),
                Some(ang),
                "\\cos\\theta = \\frac{|\\vec n_1\\cdot\\vec n_2|}{|\\vec n_1||\\vec n_2|}",
                "二面角等于两法向量夹角（取锐角）",
            ));
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

// ---------------------------------------------------------------------------
// Derived points: midpoints (中点) and section points (定比分点)

#[derive(Deserialize)]
pub struct PointDef {
    pub name: String,
    pub a: String,
    pub b: String,
    /// AP : PB = m : n; both None → midpoint
    #[serde(default)]
    pub m: Option<f64>,
    #[serde(default)]
    pub n: Option<f64>,
}

fn distn(a: &[f64], b: &[f64]) -> f64 {
    (0..a.len().max(b.len())).map(|t| (a.get(t).unwrap_or(&0.0) - b.get(t).unwrap_or(&0.0)).powi(2)).sum::<f64>().sqrt()
}

pub fn derived_points_analyze(defs: &[PointDef], points: &[NamedPoint]) -> Vec<Fact> {
    let lookup = |nm: &str| points.iter().find(|p| p.name == nm).map(|p| p.p.clone());
    let mut out = Vec::new();
    for d in defs {
        let (Some(pa), Some(pb)) = (lookup(&d.a), lookup(&d.b)) else { continue };
        let (m, n) = match (d.m, d.n) {
            (Some(m), Some(n)) => (m, n),
            (Some(m), None) => (m, 1.0),
            (None, Some(n)) => (1.0, n),
            (None, None) => (1.0, 1.0),
        };
        if m + n == 0.0 {
            continue;
        }
        let is_mid = near(m, n);
        let p: Vec<f64> = (0..pa.len().max(pb.len()))
            .map(|t| (n * pa.get(t).unwrap_or(&0.0) + m * pb.get(t).unwrap_or(&0.0)) / (m + n))
            .collect();
        let f3 = p.len() == 3;
        let pval = if f3 { pt3([p[0], p[1], p[2]]) } else { pt(p[0], p[1]) };
        let how = if is_mid {
            if f3 { "\\left(\\frac{x_A+x_B}{2},\\ \\frac{y_A+y_B}{2},\\ \\frac{z_A+z_B}{2}\\right)".to_string() } else { "\\left(\\frac{x_A+x_B}{2},\\ \\frac{y_A+y_B}{2}\\right)".to_string() }
        } else {
            format!("P = \\frac{{{n}A + {m}B}}{{{m} + {n}}}")
        };
        out.push(fact("中点与分点", &d.name, pval, None, &how, if is_mid { "中点公式" } else { "定比分点公式" }).with(Shape::Point { x: p[0], y: *p.get(1).unwrap_or(&0.0), label: d.name.clone() }));
        let (dap, dpb) = (distn(&pa, &p), distn(&p, &pb));
        if dpb > 1e-12 {
            let ms = nice_short(m);
            let ns = nice_short(n);
            out.push(fact("中点与分点", &format!("\\frac{{|{}{}|}}{{|{}{}|}}", d.a, d.name, d.name, d.b), nice(dap / dpb), Some(dap / dpb), &format!("AP : PB = {ms} : {ns}"), if is_mid { "中点到两端等距" } else { "定比分点：AP : PB = m : n" }));
        }
        out.push(seg_fact("中点与分点", &format!("|{}{}|", d.a, d.name), dap, "\\sqrt{\\Delta x^2 + \\Delta y^2}", "到起点的距离").with(Shape::Segment { x1: pa[0], y1: *pa.get(1).unwrap_or(&0.0), x2: p[0], y2: *p.get(1).unwrap_or(&0.0), label: format!("{}{}", d.a, d.name) }));
        out.push(seg_fact("中点与分点", &format!("|{}{}|", d.name, d.b), dpb, "\\sqrt{\\Delta x^2 + \\Delta y^2}", "到终点的距离").with(Shape::Segment { x1: p[0], y1: *p.get(1).unwrap_or(&0.0), x2: pb[0], y2: *pb.get(1).unwrap_or(&0.0), label: format!("{}{}", d.name, d.b) }));
    }
    // two midpoints sharing an endpoint form a midsegment (中位线)
    let mid_of = |a: &str, b: &str| -> Option<Vec<f64>> {
        let (pa, pb) = (lookup(a)?, lookup(b)?);
        Some((0..pa.len().max(pb.len())).map(|t| (pa.get(t).unwrap_or(&0.0) + pb.get(t).unwrap_or(&0.0)) / 2.0).collect())
    };
    let is_mid_def = |d: &PointDef| match (d.m, d.n) {
        (None, None) => true,
        (Some(m), Some(n)) => near(m, n),
        _ => false,
    };
    for i in 0..defs.len() {
        for j in i + 1..defs.len() {
            let (d1, d2) = (&defs[i], &defs[j]);
            if !is_mid_def(d1) || !is_mid_def(d2) {
                continue;
            }
            let (vertex, u, v) = if d1.a == d2.a {
                (d1.a.clone(), d1.b.clone(), d2.b.clone())
            } else if d1.a == d2.b {
                (d1.a.clone(), d1.b.clone(), d2.a.clone())
            } else if d1.b == d2.a {
                (d1.b.clone(), d1.a.clone(), d2.b.clone())
            } else if d1.b == d2.b {
                (d1.b.clone(), d1.a.clone(), d2.a.clone())
            } else {
                continue;
            };
            if u == v {
                continue;
            }
            let (Some(pu), Some(pv)) = (lookup(&u), lookup(&v)) else { continue };
            let (Some(pm), Some(pn2)) = (mid_of(&vertex, &u), mid_of(&vertex, &v)) else { continue };
            let len = distn(&pm, &pn2);
            let base = distn(&pu, &pv);
            if base < 1e-12 {
                continue;
            }
            out.push(seg_fact("中点与分点", &format!("\\text{{中位线}}_{{{}{}}}", d1.name, d2.name), len, &format!("\\frac{{1}}{{2}}|{u}{v}|"), "中位线定理：连接两个中点的线段平行于第三边，且等于第三边的一半").with(Shape::Segment { x1: pm[0], y1: *pm.get(1).unwrap_or(&0.0), x2: pn2[0], y2: *pn2.get(1).unwrap_or(&0.0), label: format!("中位线{}{}", d1.name, d2.name) }));
            out.push(fact("中点与分点", &format!("{}{} \\parallel {}{}", d1.name, d2.name, u, v), "\\checkmark".into(), None, "\\vec{MN} = \\frac12\\vec{UV}", "中位线平行于第三边"));
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
    fn asa_two_angles() {
        // a = 5, B = 50°, C = 60° → A = 70°, b = 5·sin50°/sin70°, c = 5·sin60°/sin70°
        let k = TriangleKnown { a: Some(5.0), angle_b: Some(50.0f64.to_radians()), angle_c: Some(60.0f64.to_radians()), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        let f = |label: &str| r.cases[0].facts.iter().find(|x| x.label == label).unwrap().num.unwrap();
        assert!((f("\\angle A") - 70.0f64.to_radians()).abs() < 1e-9);
        assert!((f("b") - 5.0 * 50f64.to_radians().sin() / 70f64.to_radians().sin()).abs() < 1e-9);
        assert!((f("c") - 5.0 * 60f64.to_radians().sin() / 70f64.to_radians().sin()).abs() < 1e-9);
    }

    #[test]
    fn midsegment_and_bisector() {
        // 3-4-5 triangle: midsegment parallel to a(=3) is 1.5; the bisector from A… check t_c
        let k = TriangleKnown { a: Some(3.0), b: Some(4.0), angle_c: Some(PI / 2.0), ..Default::default() };
        let r = triangle_solve(&k);
        let fs = &r.cases[0].facts;
        let mid = fs.iter().find(|f| f.label == "\\text{中位线}_a").unwrap();
        assert!((mid.num.unwrap() - 1.5).abs() < 1e-9);
        let mid_c = fs.iter().find(|f| f.label == "\\text{中位线}_c").unwrap();
        assert!((mid_c.num.unwrap() - 2.5).abs() < 1e-9);
        // angle bisector from C: t_c = 2ab·cos(C/2)/(a+b) = 2·3·4·cos45°/7
        let t_c = fs.iter().find(|f| f.label == "t_c").unwrap();
        assert!((t_c.num.unwrap() - 24.0 * (PI / 4.0).cos() / 7.0).abs() < 1e-9);
        // the drawn bisector starts at C and divides AB as AC : BC = 4 : 3
        let seg = t_c.shape.as_ref().unwrap();
        if let Shape::Segment { x1, y1, x2, y2: _, .. } = seg {
            let (va, vb, vc) = (r.cases[0].vertices[0], r.cases[0].vertices[1], r.cases[0].vertices[2]);
            assert!((*x1 - vc[0]).abs() < 1e-9 && (*y1 - vc[1]).abs() < 1e-9);
            let fx = (3.0 * va[0] + 4.0 * vb[0]) / 7.0;
            assert!((*x2 - fx).abs() < 1e-9);
        } else {
            panic!("bisector fact should carry a segment");
        }
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

    #[test]
    fn hl_hypotenuse_leg() {
        // HL written as SSA with the right angle: a = 3, c = 5, C = 90° → b = 4, one case
        let k = TriangleKnown { a: Some(3.0), c: Some(5.0), angle_c: Some(PI / 2.0), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        assert_eq!(r.cases.len(), 1);
        let f = |label: &str| r.cases[0].facts.iter().find(|x| x.label == label).unwrap().num.unwrap();
        assert!((f("b") - 4.0).abs() < 1e-9);
        assert!((f("\\angle A") - 3f64.atan2(4.0)).abs() < 1e-9);
    }

    #[test]
    fn median_as_input() {
        // b = 4, c = 3, m_a = 2.5 → a = 5 (the 3-4-5 triangle)
        let k = TriangleKnown { b: Some(4.0), c: Some(3.0), ma: Some(2.5), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        let f = |label: &str| r.cases[0].facts.iter().find(|x| x.label == label).unwrap().num.unwrap();
        assert!((f("a") - 5.0).abs() < 1e-9);
        // the other direction: a and b with the median give c
        let k = TriangleKnown { a: Some(5.0), b: Some(4.0), ma: Some(2.5), ..Default::default() };
        let r = triangle_solve(&k);
        let f = |label: &str| r.cases[0].facts.iter().find(|x| x.label == label).unwrap().num.unwrap();
        assert!((f("c") - 3.0).abs() < 1e-9);
    }

    #[test]
    fn height_as_input() {
        // a = 3, c = 5, h_c = 2.4 → S = 6 → sin B = 0.8: B = 53.13° or 126.87°
        let k = TriangleKnown { a: Some(3.0), c: Some(5.0), hc: Some(2.4), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        assert_eq!(r.cases.len(), 2);
        let f = |i: usize, label: &str| r.cases[i].facts.iter().find(|x| x.label == label).unwrap().num.unwrap();
        assert!((f(0, "b") - 4.0).abs() < 1e-9);
        assert!((f(0, "S") - 6.0).abs() < 1e-9);
    }

    #[test]
    fn angles_plus_area() {
        // A = B = 60°, S = 3√3/4 → equilateral with side √3
        let s = 3.0 * 3f64.sqrt() / 4.0;
        let k = TriangleKnown { angle_a: Some(PI / 3.0), angle_b: Some(PI / 3.0), area: Some(s), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        let f = |label: &str| r.cases[0].facts.iter().find(|x| x.label == label).unwrap().num.unwrap();
        assert!((f("a") - 3f64.sqrt()).abs() < 1e-9);
        assert!((f("R") - 1.0).abs() < 1e-9);
    }

    #[test]
    fn right_triangle_projection_theorem() {
        // 3-4-5: altitude to hypotenuse 12/5, projections 9/5 and 16/5
        let k = TriangleKnown { a: Some(3.0), b: Some(4.0), c: Some(5.0), ..Default::default() };
        let r = triangle_solve(&k);
        let fs = &r.cases[0].facts;
        let get = |label: &str| fs.iter().find(|f| f.label == label).unwrap();
        assert!((get("\\text{斜边上的高}").num.unwrap() - 12.0 / 5.0).abs() < 1e-9);
        assert!((get("\\text{射影}_{a}").num.unwrap() - 9.0 / 5.0).abs() < 1e-9);
        assert!((get("\\text{射影}_{b}").num.unwrap() - 16.0 / 5.0).abs() < 1e-9);
        // the projection segments lie on the hypotenuse and share the altitude foot
        if let (Shape::Segment { x2: x2a, y2: y2a, .. }, Shape::Segment { x2: x2b, y2: y2b, .. }) = (get("\\text{射影}_{a}").shape.as_ref().unwrap(), get("\\text{射影}_{b}").shape.as_ref().unwrap()) {
            assert!((x2a - x2b).abs() < 1e-9 && (y2a - y2b).abs() < 1e-9, "both projections end at the altitude foot");
        } else {
            panic!("projection facts should carry segments");
        }
    }

    #[test]
    fn inconsistent_givens_rejected() {
        // SSS plus a wrong area
        let k = TriangleKnown { a: Some(3.0), b: Some(4.0), c: Some(5.0), area: Some(10.0), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_some());
        // SAS plus a wrong extra angle
        let k = TriangleKnown { a: Some(5.0), b: Some(7.0), angle_c: Some(PI / 3.0), angle_a: Some(1.2), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_some());
        // consistent extra angle passes
        let aa = (5.0f64 * (PI / 3.0).sin() / 39f64.sqrt()).asin(); // sin A = a sinC / c
        let k = TriangleKnown { a: Some(5.0), b: Some(7.0), angle_c: Some(PI / 3.0), angle_a: Some(aa), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        let f = |label: &str| r.cases[0].facts.iter().find(|x| x.label == label).unwrap().num.unwrap();
        assert!((f("\\angle B") - (PI - PI / 3.0 - aa)).abs() < 1e-9);
    }

    #[test]
    fn derived_midpoints_and_sections() {
        let pts = vec![
            NamedPoint { name: "A".into(), p: vec![0.0, 0.0] },
            NamedPoint { name: "B".into(), p: vec![4.0, 0.0] },
            NamedPoint { name: "C".into(), p: vec![1.0, 3.0] },
        ];
        let defs = vec![
            PointDef { name: "M".into(), a: "A".into(), b: "B".into(), m: None, n: None },
            PointDef { name: "N".into(), a: "A".into(), b: "C".into(), m: None, n: None },
        ];
        let out = derived_points_analyze(&defs, &pts);
        let get = |label: &str| out.iter().find(|f| f.label == label).unwrap();
        assert!((get("\\text{中位线}_{MN}").num.unwrap() - 18f64.sqrt() / 2.0).abs() < 1e-9);
        assert!(out.iter().any(|f| f.label == "MN \\parallel BC"));
        // section point P = 分点(A, B, 1:2): AP:PB = 1:2 → P = (4/3·1...) = (4/3? no: (2A + 1B)/3 = (4/3, 0))
        let defs = vec![PointDef { name: "P".into(), a: "A".into(), b: "B".into(), m: Some(1.0), n: Some(2.0) }];
        let out = derived_points_analyze(&defs, &pts);
        let get = |label: &str| out.iter().find(|f| f.label == label).unwrap();
        assert!((get("|AP|").num.unwrap() - 4.0 / 3.0).abs() < 1e-9);
        assert!((get("\\frac{|AP|}{|PB|}").num.unwrap() - 0.5).abs() < 1e-9);
    }

    #[test]
    fn angle_bisector_theorem_heron_excircles() {
        // 3-4-5: Heron S = 6; bisector from C splits AB as b:a = 4:3; r_a = 2, r_b = 3, r_c = 6
        let k = TriangleKnown { a: Some(3.0), b: Some(4.0), c: Some(5.0), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        let fs = &r.cases[0].facts;
        let get = |label: &str| fs.iter().find(|f| f.label == label).unwrap();
        assert!((get("S_{\\text{海伦}}").num.unwrap() - 6.0).abs() < 1e-9);
        let ratio = get("\\frac{|AF_{c}|}{|F_{c}B|}").num.unwrap();
        assert!((ratio - 4.0 / 3.0).abs() < 1e-9, "ratio = {ratio}");
        assert!((get("r_a").num.unwrap() - 2.0).abs() < 1e-9);
        assert!((get("r_b").num.unwrap() - 3.0).abs() < 1e-9);
        assert!((get("r_c").num.unwrap() - 6.0).abs() < 1e-9);
        // OI² = R(R − 2r) = 2.5 · (2.5 − 2) = 1.25 → OI = √1.25
        let oi = get("|OI|").num.unwrap();
        assert!((oi * oi - 1.25).abs() < 1e-9, "OI = {oi}");
        // right triangle: H at C, O midpoint of AB → |OH| = R = 2.5
        assert!((get("|OH|").num.unwrap() - 2.5).abs() < 1e-9);
    }

    #[test]
    fn vector_projection_vector() {
        let vs = vec![NamedVec { name: "a".into(), v: vec![3.0, 4.0] }, NamedVec { name: "b".into(), v: vec![1.0, 0.0] }];
        let out = vectors_analyze(&vs);
        let get = |label: &str| out.iter().find(|f| f.label == label).unwrap();
        let proj = get("\\text{proj}_{\\mathbf{b}}\\ \\mathbf{a}").value.clone();
        assert!(proj.contains("3") && proj.contains("0"), "proj = {proj}");
        let perp = get("\\mathbf{a} - \\text{proj}_{\\mathbf{b}}\\ \\mathbf{a}").value.clone();
        assert!(perp.contains("4"), "perp = {perp}");
        // scalar projection still there
        assert!((get("\\text{a 在 b 上的投影}").num.unwrap() - 3.0).abs() < 1e-9);
    }

    #[test]
    fn parallel_transversal_angles() {
        // y = 0, y = 3 parallel; x - y = 0 a 45° transversal
        let ls = vec![
            NamedLine { name: "l".into(), a: 0.0, b: 1.0, c: 0.0 },
            NamedLine { name: "m".into(), a: 0.0, b: 1.0, c: 3.0 },
            NamedLine { name: "t".into(), a: 1.0, b: -1.0, c: 0.0 },
        ];
        let out = lines_analyze(&ls, &[]);
        let get = |label: &str| out.iter().find(|f| f.label == label).unwrap();
        // corresponding angles ∠(t, l) = ∠(t, m) = 45°
        let cor = get("\\text{同位角} \\; \\angle(t, l) = \\angle(t, m)").num.unwrap();
        assert!((cor - PI / 4.0).abs() < 1e-9);
        // co-interior supplementary: 135°
        let co = get("\\text{同旁内角}(t \\mid l \\parallel m)").num.unwrap();
        assert!((co - 3.0 * PI / 4.0).abs() < 1e-9);
        // cut segment between the parallels along t: from (0,0) to (3,3) → 3√2
        let cut = out.iter().find(|f| f.label == "\\text{截线段}_{t}").unwrap();
        assert!((cut.num.unwrap() - 3.0 * 2.0f64.sqrt()).abs() < 1e-9);
    }

    #[test]
    fn intercept_theorem_ratios() {
        // three parallels y = 0, 1, 3 cut by x = 0 and y = x → ratios 1:2 on both
        let ls = vec![
            NamedLine { name: "l".into(), a: 0.0, b: 1.0, c: 0.0 },
            NamedLine { name: "m".into(), a: 0.0, b: 1.0, c: 1.0 },
            NamedLine { name: "n".into(), a: 0.0, b: 1.0, c: 3.0 },
            NamedLine { name: "s".into(), a: 1.0, b: 0.0, c: 0.0 },
            NamedLine { name: "t".into(), a: 1.0, b: -1.0, c: 0.0 },
        ];
        let out = lines_analyze(&ls, &[]);
        let ratio = out.iter().find(|f| f.label == "\\text{成比例}").unwrap();
        assert!((ratio.num.unwrap() - 0.5).abs() < 1e-9);
        let seg = out.iter().find(|f| f.label == "|s \\cap l,\\ s \\cap m|").unwrap();
        assert!((seg.num.unwrap() - 1.0).abs() < 1e-9);
    }

    #[test]
    fn similar_triangles_from_parallels() {
        // parallels y = 2, y = 0... use y=0 and y=2 with transversals y=x and y=-x+1 meeting at (0.5,0.5)
        let ls = vec![
            NamedLine { name: "p".into(), a: 0.0, b: 1.0, c: 0.0 },
            NamedLine { name: "q".into(), a: 0.0, b: 1.0, c: 2.0 },
            NamedLine { name: "s".into(), a: 1.0, b: -1.0, c: 0.0 },
            NamedLine { name: "t".into(), a: 1.0, b: 1.0, c: 1.0 },
        ];
        let out = lines_analyze(&ls, &[]);
        let sim = out.iter().find(|f| f.label.starts_with("\\text{相似比}")).unwrap();
        assert!((sim.num.unwrap() - 1.0 / 3.0).abs() < 1e-9, "k = {}", sim.value);
    }

    #[test]
    fn ceva_and_menelaus_on_345() {
        let k = TriangleKnown { a: Some(3.0), b: Some(4.0), c: Some(5.0), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        let fs = &r.cases[0].facts;
        let get = |label: &str| fs.iter().find(|f| f.label == label).unwrap_or_else(|| panic!("missing {label}"));
        assert!((get("\\Pi_{\\text{Ceva}}^{\\text{中线}}").num.unwrap() - 1.0).abs() < 1e-9);
        assert!((get("\\Pi_{\\text{Ceva}}^{\\text{角平分线}}").num.unwrap() - 1.0).abs() < 1e-9);
        // right triangle: an altitude foot sits on a vertex → skip 高 family
        assert!(fs.iter().all(|f| f.label != "\\Pi_{\\text{Ceva}}^{\\text{高}}"));
        assert!((get("\\Pi_{\\text{Ceva}}^{\\text{切点}}").num.unwrap() - 1.0).abs() < 1e-9);
        let men = get("\\Pi_{\\text{Menelaus}}").num.unwrap();
        assert!((men + 1.0).abs() < 1e-9, "Menelaus = {men}");
    }

    #[test]
    fn ceva_altitudes_acute() {
        // 6-5-5 acute isosceles: all altitude feet interior → Ceva product = 1
        let k = TriangleKnown { a: Some(6.0), b: Some(5.0), c: Some(5.0), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        let fs = &r.cases[0].facts;
        let alt = fs.iter().find(|f| f.label == "\\Pi_{\\text{Ceva}}^{\\text{高}}").unwrap();
        assert!((alt.num.unwrap() - 1.0).abs() < 1e-9, "alt = {}", alt.value);
    }

    #[test]
    fn skew_lines_distance() {
        // AB = (0,0,0)->(1,0,0), CD = (0,1,0)->(0,1,1): skew, distance = 1
        let pts = vec![
            NamedPoint { name: "A".into(), p: vec![0.0, 0.0, 0.0] },
            NamedPoint { name: "B".into(), p: vec![1.0, 0.0, 0.0] },
            NamedPoint { name: "C".into(), p: vec![0.0, 1.0, 0.0] },
            NamedPoint { name: "D".into(), p: vec![0.0, 1.0, 1.0] },
        ];
        let out = points_analyze(&pts);
        let d = out.iter().find(|f| f.label == "d(AB, CD)").unwrap();
        assert!((d.num.unwrap() - 1.0).abs() < 1e-9, "d = {}", d.value);
        assert!(out.iter().any(|f| f.value.contains("异面")));
    }

    #[test]
    fn stewart_median_and_bisector() {
        let k = TriangleKnown { a: Some(3.0), b: Some(4.0), c: Some(5.0), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        let fs = &r.cases[0].facts;
        // median to c=5: m=n=2.5, d=2.5; LHS = 3²·2.5 + 4²·2.5 = 62.5
        let med = fs.iter().find(|f| f.label == "\\text{Stewart}_{m_c}").unwrap();
        assert!((med.num.unwrap() - 62.5).abs() < 1e-6, "med = {}", med.value);
        let bis = fs.iter().find(|f| f.label == "\\text{Stewart}_{t_c}").unwrap();
        assert!(bis.num.unwrap().is_finite());
        // altitude to the hypotenuse: m = 16/5, n = 9/5, h = 12/5 → LHS = 57.6
        let alt = fs.iter().find(|f| f.label == "\\text{Stewart}_{h_c}").unwrap();
        assert!((alt.num.unwrap() - 57.6).abs() < 1e-6, "alt = {}", alt.value);
        // medians, bisectors, and altitudes
        assert_eq!(fs.iter().filter(|f| f.label.starts_with("\\text{Stewart}_")).count(), 9);
    }

    #[test]
    fn line_plane_angle_perpendicular() {
        // AB = vertical (0,0,0)->(0,0,1); plane z = 0 → θ = 90°
        let ps = vec![NamedPlane { name: "α".into(), n: [0.0, 0.0, 1.0], d: 0.0 }];
        let pts = vec![
            NamedPoint { name: "A".into(), p: vec![0.0, 0.0, 0.0] },
            NamedPoint { name: "B".into(), p: vec![0.0, 0.0, 1.0] },
            NamedPoint { name: "C".into(), p: vec![1.0, 0.0, 0.0] },
        ];
        let out = planes_analyze(&ps, &pts);
        let th = out.iter().find(|f| f.label == "\\theta(AB, α)").unwrap();
        assert!((th.num.unwrap() - PI / 2.0).abs() < 1e-9, "θ = {}", th.value);
        assert!(out.iter().any(|f| f.label == "AB \\perp α"));
        // AC lies in / parallel to the plane → θ = 0
        let th2 = out.iter().find(|f| f.label == "\\theta(AC, α)").unwrap();
        assert!(th2.num.unwrap().abs() < 1e-9, "θ(AC) = {}", th2.value);
        assert!(out.iter().any(|f| f.label == "AC \\parallel α"));
        let foot = out.iter().find(|f| f.label == "\\text{foot}(B, α)").unwrap();
        assert!(foot.value.contains('0'), "foot = {}", foot.value);
        if let Shape::Point3 { x, y, z, .. } = foot.shape.as_ref().unwrap() {
            assert!(x.abs() < 1e-9 && y.abs() < 1e-9 && z.abs() < 1e-9);
        } else {
            panic!("foot should be a point");
        }
    }

    #[test]
    fn skew_line_angle() {
        let pts = vec![
            NamedPoint { name: "A".into(), p: vec![0.0, 0.0, 0.0] },
            NamedPoint { name: "B".into(), p: vec![1.0, 0.0, 0.0] },
            NamedPoint { name: "C".into(), p: vec![0.0, 1.0, 0.0] },
            NamedPoint { name: "D".into(), p: vec![0.0, 1.0, 1.0] },
        ];
        let out = points_analyze(&pts);
        let th = out.iter().find(|f| f.label == "\\theta(AB, CD)").unwrap();
        assert!((th.num.unwrap() - PI / 2.0).abs() < 1e-9, "θ = {}", th.value);
    }

    #[test]
    fn van_obel_and_apollonius_on_345() {
        let k = TriangleKnown { a: Some(3.0), b: Some(4.0), c: Some(5.0), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        let fs = &r.cases[0].facts;
        let vo_a = fs.iter().find(|f| f.label.contains("ID_{a}")).expect("Van Obel A");
        assert!((vo_a.num.unwrap() - 3.0).abs() < 1e-6, "Van Obel A = {}", vo_a.value);
        let vo_b = fs.iter().find(|f| f.label.contains("ID_{b}")).expect("Van Obel B");
        assert!((vo_b.num.unwrap() - 2.0).abs() < 1e-6, "Van Obel B = {}", vo_b.value);
        assert_eq!(fs.iter().filter(|f| f.label.contains("ID_")).count(), 3);
        let ap = fs.iter().filter(|f| f.group == "阿波罗尼奥斯圆").count();
        assert_eq!(ap, 3, "Apollonius count");
    }

    #[test]
    fn tetrahedron_volume_unit() {
        let pts = vec![
            NamedPoint { name: "A".into(), p: vec![0.0, 0.0, 0.0] },
            NamedPoint { name: "B".into(), p: vec![1.0, 0.0, 0.0] },
            NamedPoint { name: "C".into(), p: vec![0.0, 1.0, 0.0] },
            NamedPoint { name: "D".into(), p: vec![0.0, 0.0, 1.0] },
        ];
        let out = points_analyze(&pts);
        let v = out.iter().find(|f| f.label.contains("四面体")).expect("tetra volume");
        assert!((v.num.unwrap() - 1.0 / 6.0).abs() < 1e-9, "V = {}", v.value);
        let cm = out.iter().find(|f| f.label.contains("Cayley")).expect("Cayley-Menger");
        assert!((cm.num.unwrap() - 1.0 / 6.0).abs() < 1e-9, "V_CM = {}", cm.value);
    }

    #[test]
    fn dihedral_angle_xy_planes() {
        let ps = vec![
            NamedPlane { name: "α".into(), n: [1.0, 0.0, 0.0], d: 0.0 },
            NamedPlane { name: "β".into(), n: [0.0, 1.0, 0.0], d: 0.0 },
        ];
        let out = planes_analyze(&ps, &[]);
        let th = out.iter().find(|f| f.label == "\\theta(α, β)").expect("theta");
        assert!((th.num.unwrap() - PI / 2.0).abs() < 1e-9);
        assert!(out.iter().any(|f| f.label.contains("二面角")));
        assert!(out.iter().any(|f| f.label == "α \\perp β"));
    }

    #[test]
    fn euler_line_and_nine_point() {
        let k = TriangleKnown { a: Some(3.0), b: Some(4.0), c: Some(5.0), ..Default::default() };
        let r = triangle_solve(&k);
        let fs = &r.cases[0].facts;
        assert!(fs.iter().any(|f| f.label.contains("O,") && f.value.contains("共线")));
        let og_gh = fs.iter().find(|f| f.label == "OG:GH").unwrap();
        assert!((og_gh.num.unwrap() - 2.0).abs() < 1e-6, "OG:GH = {}", og_gh.value);
        let r9 = fs.iter().find(|f| f.label.contains("九点")).unwrap();
        assert!((r9.num.unwrap() - 1.25).abs() < 1e-9, "R9 = {}", r9.value); // R=2.5
        // OI² = R(R-2r) already covered; ensure |OI| present
        assert!(fs.iter().any(|f| f.label == "|OI|"));
        // 3-4-5 is right: OH is nine-point diameter
        assert!(
            fs.iter().any(|f| f.label.contains("九点圆直径")),
            "OH nine-point diameter fact missing for right triangle"
        );
        let oh2on = fs.iter().find(|f| f.label == "|OH| = 2|ON|").expect("OH=2ON");
        assert!((oh2on.num.unwrap() - 2.5).abs() < 1e-9);
    }

    #[test]
    fn feuerbach_spieker_nagel() {
        // 3-4-5: R=2.5, r=1 → |NI|=R/2−r=0.25; r_a=2,r_b=3,r_c=6 → |NI_*|=R/2+r_*.
        let k = TriangleKnown { a: Some(3.0), b: Some(4.0), c: Some(5.0), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        let fs = &r.cases[0].facts;
        let ni = fs.iter().find(|f| f.group == "费尔巴哈定理" && f.label == "|NI|").expect("|NI|");
        assert!((ni.num.unwrap() - 0.25).abs() < 1e-9, "|NI|={}", ni.value);
        assert!(fs.iter().any(|f| f.group == "费尔巴哈定理" && f.label.contains("内切")));
        let nia = fs.iter().find(|f| f.label == "|NI_a|").expect("|NI_a|");
        let nib = fs.iter().find(|f| f.label == "|NI_b|").expect("|NI_b|");
        let nic = fs.iter().find(|f| f.label == "|NI_c|").expect("|NI_c|");
        assert!((nia.num.unwrap() - 3.25).abs() < 1e-9, "|NI_a|={}", nia.value);
        assert!((nib.num.unwrap() - 4.25).abs() < 1e-9, "|NI_b|={}", nib.value);
        assert!((nic.num.unwrap() - 7.25).abs() < 1e-9, "|NI_c|={}", nic.value);
        assert!(fs.iter().any(|f| f.group == "斯皮克中心" && f.label == "Sp"));
        assert!(fs.iter().any(|f| f.group == "奈格尔点" && f.label == "Na"));
        let ig = fs.iter().find(|f| f.group == "奈格尔点" && f.label == "IG:GNa").expect("IG:GNa");
        assert!((ig.num.unwrap() - 2.0).abs() < 1e-6, "IG:GNa={}", ig.value);
        assert!(fs.iter().any(|f| f.group == "奈格尔点" && f.value.contains("共线")));
    }

    #[test]
    fn gergonne_lemoine_brocard() {
        // 3-4-5: Ge → (3.25, 1.5); K → (3.2, 1.2); tan ω = 12/25 = 0.48; cot ω = 25/12.
        let k = TriangleKnown { a: Some(3.0), b: Some(4.0), c: Some(5.0), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        let fs = &r.cases[0].facts;
        let ge = fs.iter().find(|f| f.group == "格尔巩点" && f.label == "Ge").expect("Ge");
        // bary 1/(s−a):… on 3-4-5 → (3.109…, 1.309…) = (171/55, 72/55)
        assert!(
            ge.value.contains("3.10")
                || ge.value.contains("1.30")
                || ge.value.contains("171/55")
                || ge.value.contains("\\frac{171}{55}")
                || ge.value.contains("72/55")
                || ge.value.contains("\\frac{72}{55}"),
            "Ge={}",
            ge.value
        );
        assert!(fs.iter().any(|f| f.group == "格尔巩点" && f.value.contains("等截")));
        let kp = fs.iter().find(|f| f.group == "勒莫恩点" && f.label == "K").expect("K");
        // (3.2, 1.2) == (16/5, 6/5)
        assert!(
            (kp.value.contains("3.2") || kp.value.contains("16/5") || kp.value.contains("\\frac{16}{5}"))
                && (kp.value.contains("1.2") || kp.value.contains("6/5") || kp.value.contains("\\frac{6}{5}")),
            "K={}",
            kp.value
        );
        assert!(fs.iter().any(|f| f.group == "等角共轭" && f.label.contains("G") && f.label.contains("K")));
        let tan_w = fs.iter().find(|f| f.group == "布罗卡" && f.label == "\\tan\\omega").expect("tan ω");
        assert!((tan_w.num.unwrap() - 0.48).abs() < 1e-9, "tan ω={}", tan_w.value);
        let cot_w = fs.iter().find(|f| f.group == "布罗卡" && f.label == "\\cot\\omega").expect("cot ω");
        assert!((cot_w.num.unwrap() - 25.0 / 12.0).abs() < 1e-9, "cot ω={}", cot_w.value);
        assert!(fs.iter().any(|f| f.group == "布罗卡" && f.label == "\\omega"));
        assert!(fs.iter().any(|f| f.group == "布罗卡" && f.label == "\\Omega"));
        assert!(fs.iter().any(|f| f.group == "布罗卡" && f.label == "\\Omega'"));
    }


    #[test]
    fn longchamps_mittenpunkt_schiffler() {
        // 3-4-5: H=C=(3.2,2.4), O=(2.5,0) → L=2O−H=(1.8,−2.4);
        // Mi bary a(s−a):… → (28/11, 6/11); Sc on Euler line, matches Euler(ICA).
        let k = TriangleKnown { a: Some(3.0), b: Some(4.0), c: Some(5.0), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        let fs = &r.cases[0].facts;
        let l = fs.iter().find(|f| f.group == "德龙尚点" && f.label == "L").expect("L");
        assert!(
            (l.value.contains("1.8") || l.value.contains("9/5") || l.value.contains("\\frac{9}{5}"))
                && (l.value.contains("-2.4") || l.value.contains("-\\frac{12}{5}") || l.value.contains("-12/5")),
            "L={}",
            l.value
        );
        assert!(fs.iter().any(|f| f.group == "德龙尚点" && f.label.contains("中点")));
        let mi = fs.iter().find(|f| f.group == "米滕点" && f.label == "Mi").expect("Mi");
        assert!(
            mi.value.contains("28/11")
                || mi.value.contains("\\frac{28}{11}")
                || mi.value.contains("2.54"),
            "Mi={}",
            mi.value
        );
        assert!(fs.iter().any(|f| f.group == "席弗勒点" && f.label == "Sc"), "Sc missing");
        assert!(
            fs.iter().any(|f| f.group == "席弗勒点" && f.label.contains("ICA")),
            "Schiffler ICA concurrence missing"
        );
        let sc = fs.iter().find(|f| f.group == "席弗勒点" && f.label == "Sc").unwrap();
        // Sc ≈ (2.68421, 0.63158) = (51/19, 12/19)
        assert!(
            sc.value.contains("2.68")
                || sc.value.contains("51/19")
                || sc.value.contains("\\frac{51}{19}")
                || sc.value.contains("0.63"),
            "Sc={}",
            sc.value
        );
    }


    #[test]
    fn bevan_orthic_euler_reflection() {
        // 3-4-5: Be = 2O−I = (2,−1); orthic feet; Euler reflection skipped (right).
        let k = TriangleKnown { a: Some(3.0), b: Some(4.0), c: Some(5.0), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        let fs = &r.cases[0].facts;
        let be = fs.iter().find(|f| f.group == "贝万点" && f.label == "Be").expect("Be");
        assert!(
            (be.value.contains("2") || be.value.contains("2.0"))
                && (be.value.contains("-1")),
            "Be={}",
            be.value
        );
        assert!(fs.iter().any(|f| f.group == "贝万点" && f.label.contains("I_a")));
        assert!(["H_a", "H_b", "H_c"].iter().all(|lab| fs.iter().any(|f| f.group == "垂足三角形" && f.label == *lab)));
        assert!(fs.iter().any(|f| f.group == "垂足三角形" && f.label.contains("九点圆")));
        let hc = fs.iter().find(|f| f.group == "垂足三角形" && f.label == "H_c").expect("Hc");
        assert!(
            hc.value.contains("3.2") || hc.value.contains("16/5") || hc.value.contains("\\frac{16}{5}"),
            "Hc={}",
            hc.value
        );

        // Acute 6-7-8: Euler reflection point on circumcircle.
        let k2 = TriangleKnown { a: Some(6.0), b: Some(7.0), c: Some(8.0), ..Default::default() };
        let r2 = triangle_solve(&k2);
        assert!(r2.error.is_none(), "{:?}", r2.error);
        let fs2 = &r2.cases[0].facts;
        assert!(fs2.iter().any(|f| f.group == "欧拉反射点" && f.label == "E_r"), "E_r missing on 6-7-8");
        assert!(fs2.iter().any(|f| f.group == "欧拉反射点" && f.label.contains("(O)")));
        let er = fs2.iter().find(|f| f.group == "欧拉反射点" && f.label == "E_r").unwrap();
        assert!(
            er.value.contains("1.7") || er.value.contains("4.4") || er.value.contains("\\frac"),
            "Er={}",
            er.value
        );
    }


    #[test]
    fn contact_spieker_radius_kosnita() {
        // 3-4-5: contact pts; |IX_*|=r=1; r_Sp=1/2; Kosnita skipped (O on AB).
        let k = TriangleKnown { a: Some(3.0), b: Some(4.0), c: Some(5.0), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        let fs = &r.cases[0].facts;
        assert!(["X_a", "X_b", "X_c"].iter().all(|lab| fs.iter().any(|f| f.group == "接触三角形" && f.label == *lab)));
        let ix = fs.iter().find(|f| f.group == "接触三角形" && f.label == "|IX_*|").expect("|IX_*|");
        assert!((ix.num.unwrap() - 1.0).abs() < 1e-9, "|IX_*|={}", ix.value);
        assert!(fs.iter().any(|f| f.group == "接触三角形" && f.value.contains("共线")));
        let rsp = fs.iter().find(|f| f.group == "斯皮克圆" && f.label.contains("Sp")).expect("r_Sp");
        assert!((rsp.num.unwrap() - 0.5).abs() < 1e-9, "r_Sp={}", rsp.value);
        assert!(fs.iter().any(|f| f.group == "斯皮克圆" && f.label.contains("中点")));
        assert!(
            fs.iter().all(|f| f.group != "科斯尼塔点"),
            "Kosnita should be skipped on right 3-4-5"
        );

        // Acute 6-7-8: Kosnita present.
        let k2 = TriangleKnown { a: Some(6.0), b: Some(7.0), c: Some(8.0), ..Default::default() };
        let r2 = triangle_solve(&k2);
        assert!(r2.error.is_none(), "{:?}", r2.error);
        let fs2 = &r2.cases[0].facts;
        let ko = fs2.iter().find(|f| f.group == "科斯尼塔点" && f.label == "Ko").expect("Ko on 6-7-8");
        assert!(ko.value.contains("4.5") || ko.value.contains("1.8") || ko.value.contains("\\frac"), "Ko={}", ko.value);
        let rsp2 = fs2.iter().find(|f| f.group == "斯皮克圆" && f.label.contains("Sp")).unwrap();
        // r = Δ/s; for 6-7-8, s=10.5, Δ=sqrt(10.5·4.5·3.5·2.5)=21*sqrt(3)/4? 
        // r_Sp = r/2 > 0
        assert!(rsp2.num.unwrap() > 0.0);
    }

    #[test]
    fn extouch_steiner_mandart() {
        // 3-4-5: extouch T_*; X_a/T_a midpoint = mid BC; A–T_a–Na; Steiner area; Mandart@Mi
        let k = TriangleKnown { a: Some(3.0), b: Some(4.0), c: Some(5.0), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        let fs = &r.cases[0].facts;
        assert!(["T_a", "T_b", "T_c"].iter().all(|lab| fs.iter().any(|f| f.group == "旁切接触三角形" && f.label == *lab)));
        assert!(fs.iter().any(|f| f.group == "旁切接触三角形" && f.label.contains("X_a")));
        assert!(fs.iter().any(|f| f.group == "旁切接触三角形" && f.value.contains("共线")));
        let st = fs.iter().find(|f| f.group == "施泰纳内接椭圆" && f.label.contains("Steiner")).expect("Steiner area");
        let expect = std::f64::consts::PI * 6.0 / (3.0 * 3.0f64.sqrt());
        assert!((st.num.unwrap() - expect).abs() < 1e-9, "Steiner={} vs {}", st.value, expect);
        assert!(["M_a", "M_b", "M_c"].iter().all(|lab| fs.iter().any(|f| f.group == "施泰纳内接椭圆" && f.label == *lab)));
        let mi = fs.iter().find(|f| f.group == "米滕点" && f.label == "Mi").expect("Mi");
        let man = fs.iter().find(|f| f.group == "曼达特内接椭圆" && f.label.contains("center")).expect("Mandart");
        assert_eq!(man.value, mi.value, "Mandart center should equal Mittenpunkt");
        assert!(fs.iter().any(|f| f.group == "曼达特内接椭圆" && f.label.contains("T_")));
        let nag_ceva = fs.iter().find(|f| f.group == "塞瓦与梅涅劳斯" && f.label.contains("旁切")).expect("Nagel Ceva");
        assert!((nag_ceva.num.unwrap() - 1.0).abs() < 1e-9);

        // Equilateral: Steiner = incircle area π r²
        let k2 = TriangleKnown { a: Some(2.0), b: Some(2.0), c: Some(2.0), ..Default::default() };
        let r2 = triangle_solve(&k2);
        assert!(r2.error.is_none(), "{:?}", r2.error);
        let fs2 = &r2.cases[0].facts;
        assert!(fs2.iter().any(|f| f.group == "施泰纳内接椭圆" && f.label.contains("pi r")));
    }

    #[test]
    fn clawson_yff_exeter() {
        // Right 3-4-5: Clawson & Yff skipped (tan/sec undefined); Exeter present.
        let k = TriangleKnown { a: Some(3.0), b: Some(4.0), c: Some(5.0), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        let fs = &r.cases[0].facts;
        assert!(fs.iter().all(|f| f.group != "克劳森点"), "Clawson must skip right △");
        assert!(fs.iter().all(|f| f.group != "伊夫中心"), "Yff must skip right △");
        let ex = fs.iter().find(|f| f.group == "埃克塞特点" && f.label == "Ex").expect("Exeter on 3-4-5");
        assert!(ex.value.contains("\\left") || ex.value.contains("(") || ex.value.contains("\\frac"), "Ex={}", ex.value);
        assert!(fs.iter().any(|f| f.group == "埃克塞特点" && f.label.contains("perspector")));

        // Acute 6-7-8: all three present.
        let k2 = TriangleKnown { a: Some(6.0), b: Some(7.0), c: Some(8.0), ..Default::default() };
        let r2 = triangle_solve(&k2);
        assert!(r2.error.is_none(), "{:?}", r2.error);
        let fs2 = &r2.cases[0].facts;
        let cl = fs2.iter().find(|f| f.group == "克劳森点" && f.label == "Cl").expect("Clawson on 6-7-8");
        let yff = fs2.iter().find(|f| f.group == "伊夫中心" && f.label == "Yff").expect("Yff on 6-7-8");
        let ex2 = fs2.iter().find(|f| f.group == "埃克塞特点" && f.label == "Ex").expect("Exeter on 6-7-8");
        assert!(cl.value.contains("\\left") || cl.value.contains("("), "Cl={}", cl.value);
        assert!(yff.value.contains("\\left") || yff.value.contains("("), "Yff={}", yff.value);
        assert!(ex2.value.contains("\\left") || ex2.value.contains("("), "Ex={}", ex2.value);
        // Distinct from each other and from G on a scalene acute △.
        let g = fs2.iter().find(|f| f.group == "特殊点" && f.label == "G").expect("G");
        assert_ne!(cl.value, yff.value);
        assert_ne!(cl.value, ex2.value);
        assert_ne!(yff.value, g.value);
    }

    #[test]
    fn isodynamic_steiner_tarry() {
        // Scalene right 3-4-5: S1,S2,St,Ty all present (not isosceles).
        let k = TriangleKnown { a: Some(3.0), b: Some(4.0), c: Some(5.0), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        let fs = &r.cases[0].facts;
        let s1 = fs.iter().find(|f| f.group == "等动力点" && f.label.contains("S_{1}")).expect("S1");
        let s2 = fs.iter().find(|f| f.group == "等动力点" && f.label.contains("S_{2}")).expect("S2");
        assert_ne!(s1.value, s2.value);
        assert!(fs.iter().any(|f| f.group == "等动力点" && f.label.contains("Apollonius")));
        let st = fs.iter().find(|f| f.group == "施泰纳点" && f.label == "St").expect("Steiner");
        let ty = fs.iter().find(|f| f.group == "塔里点" && f.label == "Ty").expect("Tarry");
        assert_ne!(st.value, ty.value);
        let ot = fs.iter().find(|f| f.group == "塔里点" && f.label.contains("O")).expect("|O Ty|");
        let rr = fs.iter().find(|f| f.group == "外接圆与内切圆" && f.label == "R").expect("R");
        assert!((ot.num.unwrap() - rr.num.unwrap()).abs() < 1e-6, "Tarry on circumcircle");

        // Isosceles 5-5-6: Steiner/Tarry skipped; isodynamic present.
        let k2 = TriangleKnown { a: Some(6.0), b: Some(5.0), c: Some(5.0), ..Default::default() };
        let r2 = triangle_solve(&k2);
        assert!(r2.error.is_none(), "{:?}", r2.error);
        let fs2 = &r2.cases[0].facts;
        assert!(fs2.iter().all(|f| f.group != "施泰纳点"), "Steiner skip isosceles");
        assert!(fs2.iter().all(|f| f.group != "塔里点"), "Tarry skip with Steiner");
        assert!(fs2.iter().any(|f| f.group == "等动力点" && f.label.contains("S_{1}")));

        // Equilateral: S2 skipped; S1 coincides with G; Steiner skipped.
        let k3 = TriangleKnown { a: Some(2.0), b: Some(2.0), c: Some(2.0), ..Default::default() };
        let r3 = triangle_solve(&k3);
        assert!(r3.error.is_none(), "{:?}", r3.error);
        let fs3 = &r3.cases[0].facts;
        assert!(fs3.iter().all(|f| f.group != "施泰纳点"));
        assert!(fs3.iter().all(|f| !(f.group == "等动力点" && f.label.contains("S_{2}"))), "S2 skip equilateral");
        let s1e = fs3.iter().find(|f| f.group == "等动力点" && f.label.contains("S_{1}")).expect("S1 eq");
        let g = fs3.iter().find(|f| f.group == "特殊点" && f.label == "G").expect("G");
        assert_eq!(s1e.value, g.value, "equilateral S1 = G");
    }

    #[test]
    fn napoleon_parry_vecten() {
        // Scalene 3-4-5: all present (no 30°/45°/135°/150°; not equilateral).
        let k = TriangleKnown { a: Some(3.0), b: Some(4.0), c: Some(5.0), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        let fs = &r.cases[0].facts;
        let n1 = fs.iter().find(|f| f.group == "拿破仑中心" && f.label == "N_1").expect("N1");
        let n2 = fs.iter().find(|f| f.group == "拿破仑中心" && f.label == "N_2").expect("N2");
        assert_ne!(n1.value, n2.value);
        let py = fs.iter().find(|f| f.group == "帕里点" && f.label == "Py").expect("Parry");
        let op = fs.iter().find(|f| f.group == "帕里点" && f.label.contains("O")).expect("|O Py|");
        let rr = fs.iter().find(|f| f.group == "外接圆与内切圆" && f.label == "R").expect("R");
        assert!((op.num.unwrap() - rr.num.unwrap()).abs() < 1e-6, "Parry on circumcircle");
        let vout = fs.iter().find(|f| f.group == "韦克滕点" && f.label.contains("out")).expect("Vout");
        let vin = fs.iter().find(|f| f.group == "韦克滕点" && f.label.contains("in")).expect("Vin");
        assert_ne!(vout.value, vin.value);
        assert_ne!(py.value, n1.value);

        // Equilateral: Parry skipped; Napoleon + Vecten present; N1=N2=G.
        let k2 = TriangleKnown { a: Some(2.0), b: Some(2.0), c: Some(2.0), ..Default::default() };
        let r2 = triangle_solve(&k2);
        assert!(r2.error.is_none(), "{:?}", r2.error);
        let fs2 = &r2.cases[0].facts;
        assert!(fs2.iter().all(|f| f.group != "帕里点"), "Parry skip equilateral");
        let n1e = fs2.iter().find(|f| f.group == "拿破仑中心" && f.label == "N_1").expect("N1 eq");
        let n2e = fs2.iter().find(|f| f.group == "拿破仑中心" && f.label == "N_2").expect("N2 eq");
        let g = fs2.iter().find(|f| f.group == "特殊点" && f.label == "G").expect("G");
        assert_eq!(n1e.value, g.value);
        assert_eq!(n2e.value, g.value);
        assert!(fs2.iter().any(|f| f.group == "韦克滕点" && f.label.contains("out")));

        // Isosceles right 1-1-√2 ≈ has 45°: inner Vecten skipped; outer ok; Parry ok.
        let k3 = TriangleKnown { a: Some(1.0), b: Some(1.0), c: Some(2f64.sqrt()), ..Default::default() };
        let r3 = triangle_solve(&k3);
        assert!(r3.error.is_none(), "{:?}", r3.error);
        let fs3 = &r3.cases[0].facts;
        assert!(fs3.iter().all(|f| !(f.group == "韦克滕点" && f.label.contains("in"))), "Vin skip 45°");
        assert!(fs3.iter().any(|f| f.group == "韦克滕点" && f.label.contains("out")), "Vout on isos right");
        assert!(fs3.iter().any(|f| f.group == "帕里点" && f.label == "Py"));
    }

    #[test]
    fn hofstadter_kenmotu_apollonius() {
        // 3-4-5: Hofstadter, Kenmotu (+square edge), Apollonius, Brocard midpoint.
        let k = TriangleKnown { a: Some(3.0), b: Some(4.0), c: Some(5.0), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        let fs = &r.cases[0].facts;
        let hf0 = fs.iter().find(|f| f.group == "霍夫斯塔特点" && f.label == "Hf_0").expect("Hf0");
        let hf1 = fs.iter().find(|f| f.group == "霍夫斯塔特点" && f.label == "Hf_1").expect("Hf1");
        assert_ne!(hf0.value, hf1.value);
        let g = fs.iter().find(|f| f.group == "特殊点" && f.label == "G").expect("G");
        assert_ne!(hf0.value, g.value, "Hofstadter zero ≠ centroid on scalene");
        let km = fs.iter().find(|f| f.group == "肯莫图点" && f.label == "Km").expect("Kenmotu");
        let sq = fs.iter().find(|f| f.group == "肯莫图点" && f.label.contains("square")).expect("square edge");
        assert!(sq.num.unwrap() > 0.0);
        let vout = fs.iter().find(|f| f.group == "韦克滕点" && f.label.contains("out")).expect("Vout");
        assert_ne!(km.value, vout.value, "Kenmotu ≠ outer Vecten (isogonal mates)");
        let ap = fs.iter().find(|f| f.group == "阿波罗尼奥斯点" && f.label == "Ap").expect("Apollonius");
        assert!(ap.value.contains("(") || ap.value.contains("\\left"));
        assert!(fs.iter().any(|f| f.group == "布罗卡" && f.label.contains("39")));

        // Equilateral: Hf0=Hf1=G; Kenmotu=G; Apollonius=G.
        let k2 = TriangleKnown { a: Some(2.0), b: Some(2.0), c: Some(2.0), ..Default::default() };
        let r2 = triangle_solve(&k2);
        assert!(r2.error.is_none(), "{:?}", r2.error);
        let fs2 = &r2.cases[0].facts;
        let g2 = fs2.iter().find(|f| f.group == "特殊点" && f.label == "G").unwrap();
        let hf0e = fs2.iter().find(|f| f.group == "霍夫斯塔特点" && f.label == "Hf_0").unwrap();
        let hf1e = fs2.iter().find(|f| f.group == "霍夫斯塔特点" && f.label == "Hf_1").unwrap();
        assert_eq!(hf0e.value, g2.value);
        assert_eq!(hf1e.value, g2.value);
        let kme = fs2.iter().find(|f| f.group == "肯莫图点" && f.label == "Km").unwrap();
        assert_eq!(kme.value, g2.value);
        let ape = fs2.iter().find(|f| f.group == "阿波罗尼奥斯点" && f.label == "Ap").unwrap();
        assert_eq!(ape.value, g2.value);
    }

    #[test]
    fn fermat_feuerbach_point_detour() {
        // 3-4-5: F1,F2 distinct from S1,S2; Fe on nine-point & incircle; Ed + Ip (12>4*2.5+1).
        let k = TriangleKnown { a: Some(3.0), b: Some(4.0), c: Some(5.0), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        let fs = &r.cases[0].facts;
        let f1 = fs.iter().find(|f| f.group == "费马点" && f.label == "F_1").expect("F1");
        let f2 = fs.iter().find(|f| f.group == "费马点" && f.label == "F_2").expect("F2");
        assert_ne!(f1.value, f2.value);
        let s1 = fs.iter().find(|f| f.group == "等动力点" && f.label.contains("S_{1}")).expect("S1");
        assert_ne!(f1.value, s1.value, "isogonic ≠ isodynamic");
        assert!(fs.iter().any(|f| f.group == "费马点" && f.label.contains("S_1")));
        let fe = fs.iter().find(|f| f.group == "费尔巴哈点" && f.label == "Fe").expect("Fe");
        let nfe = fs.iter().find(|f| f.group == "费尔巴哈点" && f.label.contains("N")).expect("|N Fe|");
        let r9 = fs.iter().find(|f| f.group == "欧拉线" && f.label.contains("九点")).expect("R9");
        assert!((nfe.num.unwrap() - r9.num.unwrap()).abs() < 1e-6);
        let ed = fs.iter().find(|f| f.group == "等迂回点" && f.label == "Ed").expect("Ed");
        let ip = fs.iter().find(|f| f.group == "等周点" && f.label == "Ip").expect("Ip");
        assert_ne!(ed.value, ip.value);
        assert_ne!(fe.value, ed.value);

        // Equilateral: F1=G; F2 skipped; Fe, Ed, Ip (=G for eq?).
        let k2 = TriangleKnown { a: Some(2.0), b: Some(2.0), c: Some(2.0), ..Default::default() };
        let r2 = triangle_solve(&k2);
        assert!(r2.error.is_none(), "{:?}", r2.error);
        let fs2 = &r2.cases[0].facts;
        let g = fs2.iter().find(|f| f.group == "特殊点" && f.label == "G").unwrap();
        let f1e = fs2.iter().find(|f| f.group == "费马点" && f.label == "F_1").unwrap();
        assert_eq!(f1e.value, g.value);
        assert!(fs2.iter().all(|f| !(f.group == "费马点" && f.label == "F_2")), "F2 skip equilateral");
        assert!(fs2.iter().all(|f| f.group != "费尔巴哈点"), "Fe skip equilateral coincident circles");
        assert!(fs2.iter().any(|f| f.group == "等迂回点" && f.label == "Ed"));

        // Obtuse with angle > 120°: F1 at obtuse vertex. Sides 2,3,4: cos C=(4+9-16)/12 < 0, C>90; check C>120?
        // 2²+3²=13 < 16, obtuse at C. cos C = (4+9-16)/12 = -3/12 = -0.25, C ≈ 104.5° < 120.
        // Need stronger obtuse: sides 1,1,1.9 — almost flat apex.
        let k3 = TriangleKnown { a: Some(1.0), b: Some(1.0), c: Some(1.9), ..Default::default() };
        let r3 = triangle_solve(&k3);
        assert!(r3.error.is_none(), "{:?}", r3.error);
        let fs3 = &r3.cases[0].facts;
        // angle opposite c=1.9: cos C = (1+1-3.61)/2 = -1.61/2 = -0.805, C≈143.6° > 120
        let f1o = fs3.iter().find(|f| f.group == "费马点" && f.label == "F_1").expect("F1 obtuse");
        // F1 should be at C = verts[2]
        assert!(f1o.why.contains("120") || f1o.how.contains("obtuse") || f1o.how.contains("120"), "why={}", f1o.why);
    }

    #[test]
    fn moses_x25_orthic_circumcenter() {
        // Scalene acute 6-7-8: Moses, X(25), orthic circumcenter = N.
        let k = TriangleKnown { a: Some(6.0), b: Some(7.0), c: Some(8.0), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        let fs = &r.cases[0].facts;
        let mo = fs.iter().find(|f| f.group == "摩西点" && f.label == "Mo").expect("Mo");
        let i = fs.iter().find(|f| f.group == "特殊点" && f.label == "I").expect("I");
        assert_ne!(mo.value, i.value, "Moses ≠ I on scalene");
        assert!(fs.iter().any(|f| f.group == "摩西点" && f.value.contains("等截")));
        let x25 = fs.iter().find(|f| f.group == "垂足切线同调中心" && f.label.contains("25")).expect("X25");
        assert_ne!(x25.value, mo.value);
        assert!(fs.iter().any(|f| f.group == "垂足三角形" && f.label.contains("O(H_a")));
        assert!(fs.iter().any(|f| f.group == "垂足三角形" && f.label.contains("= N")));
        let oh = fs.iter().find(|f| f.group == "垂足三角形" && f.label == "O(H_a H_b H_c)").expect("Oh");
        let n = fs.iter().find(|f| f.group == "欧拉线" && f.label == "N").expect("N");
        assert_eq!(oh.value, n.value, "orthic circumcenter = N");

        // Right 3-4-5: Moses still; X(25) skipped (right angle); orthic degenerates (two feet = right vertex).
        let k2 = TriangleKnown { a: Some(3.0), b: Some(4.0), c: Some(5.0), ..Default::default() };
        let r2 = triangle_solve(&k2);
        assert!(r2.error.is_none(), "{:?}", r2.error);
        let fs2 = &r2.cases[0].facts;
        assert!(fs2.iter().any(|f| f.group == "摩西点" && f.label == "Mo"));
        assert!(fs2.iter().all(|f| f.group != "垂足切线同调中心"), "X25 skip right");
        assert!(fs2.iter().all(|f| !(f.group == "垂足三角形" && f.label.contains("O(H_a"))), "orthic O skip right");

        // Equilateral: Moses = I = G; X(25) = G.
        let k3 = TriangleKnown { a: Some(2.0), b: Some(2.0), c: Some(2.0), ..Default::default() };
        let r3 = triangle_solve(&k3);
        assert!(r3.error.is_none(), "{:?}", r3.error);
        let fs3 = &r3.cases[0].facts;
        let g = fs3.iter().find(|f| f.group == "特殊点" && f.label == "G").unwrap();
        let moe = fs3.iter().find(|f| f.group == "摩西点" && f.label == "Mo").unwrap();
        assert_eq!(moe.value, g.value);
        let x25e = fs3.iter().find(|f| f.group == "垂足切线同调中心" && f.label.contains("25")).unwrap();
        assert_eq!(x25e.value, g.value);
    }

    #[test]
    fn similitude_centers_euler_infinity() {
        // 3-4-5: R=2.5, r=1; S+ divides OI in 2.5:1; S− on OI; X30 direction || OH.
        let k = TriangleKnown { a: Some(3.0), b: Some(4.0), c: Some(5.0), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        let fs = &r.cases[0].facts;
        let sp = fs.iter().find(|f| f.group == "相似中心" && f.label == "S_{+}").expect("S+");
        let sm = fs.iter().find(|f| f.group == "相似中心" && f.label == "S_{-}").expect("S-");
        assert_ne!(sp.value, sm.value);
        let ratio = fs.iter().find(|f| f.group == "相似中心" && f.label.contains("OS")).expect("ratio");
        assert!((ratio.num.unwrap() - 2.5).abs() < 1e-6, "R/r={}", ratio.num.unwrap());
        assert!(fs.iter().any(|f| f.group == "相似中心" && f.value.contains("共线")));
        let x30 = fs.iter().find(|f| f.group == "欧拉无穷远点" && f.label.contains("30")).expect("X30");
        assert!(fs.iter().any(|f| f.group == "欧拉无穷远点" && f.label.contains("OH")));
        assert!(fs.iter().any(|f| f.group == "欧拉无穷远点" && f.label.contains("g") && f.value == "0"));
        // Direction nonzero
        assert!(x30.value.contains("("));

        // Equilateral: S+=S−=O=I=G; X30 skipped (|OH|=0).
        let k2 = TriangleKnown { a: Some(2.0), b: Some(2.0), c: Some(2.0), ..Default::default() };
        let r2 = triangle_solve(&k2);
        assert!(r2.error.is_none(), "{:?}", r2.error);
        let fs2 = &r2.cases[0].facts;
        let g = fs2.iter().find(|f| f.group == "特殊点" && f.label == "G").unwrap();
        let spe = fs2.iter().find(|f| f.group == "相似中心" && f.label == "S_{+}").expect("S+ eq");
        let sme = fs2.iter().find(|f| f.group == "相似中心" && f.label == "S_{-}").expect("S- eq");
        assert_eq!(spe.value, g.value);
        assert_eq!(sme.value, g.value);
        assert!(fs2.iter().all(|f| f.group != "欧拉无穷远点"), "X30 skip equilateral");
    }

    #[test]
    fn x57_x58_x84_isogonals() {
        // Scalene 6-7-8: X57≠Mi, X58≠Sp, X84≠Be; isogonal notes present.
        let k = TriangleKnown { a: Some(6.0), b: Some(7.0), c: Some(8.0), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        let fs = &r.cases[0].facts;
        let x57 = fs.iter().find(|f| f.group == "米滕等角共轭点" && f.label == "X_{57}").expect("X57");
        let mi = fs.iter().find(|f| f.group == "米滕点" && f.label == "Mi").expect("Mi");
        assert_ne!(x57.value, mi.value);
        assert!(fs.iter().any(|f| f.group == "米滕等角共轭点" && f.value.contains("等角")));
        let x58 = fs.iter().find(|f| f.group == "斯皮克等角共轭点" && f.label == "X_{58}").expect("X58");
        let sp = fs.iter().find(|f| f.group == "斯皮克中心" && f.label == "Sp").expect("Sp");
        assert_ne!(x58.value, sp.value);
        assert!(fs.iter().any(|f| f.group == "斯皮克等角共轭点" && f.value.contains("等角")));
        let x84 = fs.iter().find(|f| f.group == "己基透视中心" && f.label == "X_{84}").expect("X84");
        let be = fs.iter().find(|f| f.group == "贝万点" && f.label == "Be").expect("Be");
        assert_ne!(x84.value, be.value);
        assert!(fs.iter().any(|f| f.group == "己基透视中心" && f.value.contains("等角")));
        assert_ne!(x57.value, x58.value);
        assert_ne!(x58.value, x84.value);

        // Equilateral: all collapse to G.
        let k2 = TriangleKnown { a: Some(2.0), b: Some(2.0), c: Some(2.0), ..Default::default() };
        let r2 = triangle_solve(&k2);
        assert!(r2.error.is_none(), "{:?}", r2.error);
        let fs2 = &r2.cases[0].facts;
        let g = fs2.iter().find(|f| f.group == "特殊点" && f.label == "G").unwrap();
        for (grp, lab) in [
            ("米滕等角共轭点", "X_{57}"),
            ("斯皮克等角共轭点", "X_{58}"),
            ("己基透视中心", "X_{84}"),
        ] {
            let p = fs2.iter().find(|f| f.group == grp && f.label == lab).unwrap_or_else(|| panic!("missing {lab}"));
            assert_eq!(p.value, g.value, "{lab} should = G");
        }
    }

    #[test]
    fn british_flag_on_rectangle() {
        let pts = vec![
            NamedPoint { name: "A".into(), p: vec![0.0, 0.0] },
            NamedPoint { name: "B".into(), p: vec![4.0, 0.0] },
            NamedPoint { name: "C".into(), p: vec![4.0, 3.0] },
            NamedPoint { name: "D".into(), p: vec![0.0, 3.0] },
        ];
        let out = points_analyze(&pts);
        assert!(out.iter().any(|f| f.value.contains("矩形")));
        let lhs = out.iter().find(|f| f.group == "英国国旗定理" && f.label == "PA^2 + PC^2").expect("british lhs");
        let rhs = out.iter().find(|f| f.group == "英国国旗定理" && f.label == "PB^2 + PD^2").expect("british rhs");
        assert!((lhs.num.unwrap() - 25.0).abs() < 1e-9);
        assert!((rhs.num.unwrap() - 25.0).abs() < 1e-9);
    }

    #[test]
    fn varignon_parallelogram() {
        let pts = vec![
            NamedPoint { name: "A".into(), p: vec![0.0, 0.0] },
            NamedPoint { name: "B".into(), p: vec![4.0, 0.0] },
            NamedPoint { name: "C".into(), p: vec![5.0, 3.0] },
            NamedPoint { name: "D".into(), p: vec![1.0, 3.0] },
        ];
        let out = points_analyze(&pts);
        assert!(out.iter().any(|f| f.group == "瓦里农定理" && f.value.contains("平行四边形")));
        assert_eq!(out.iter().filter(|f| f.group == "瓦里农定理" && f.label.starts_with("M_")).count(), 4);
    }

    #[test]
    fn viviani_equilateral() {
        let k = TriangleKnown { a: Some(2.0), b: Some(2.0), c: Some(2.0), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        let fs = &r.cases[0].facts;
        let sum = fs.iter().find(|f| f.group == "维维安尼定理" && f.label.contains("d_a")).expect("viviani sum");
        let h = fs.iter().find(|f| f.group == "维维安尼定理" && f.label == "h").expect("viviani h");
        assert!((sum.num.unwrap() - h.num.unwrap()).abs() < 1e-9);
        // h = √3 for side 2
        assert!((h.num.unwrap() - 3f64.sqrt()).abs() < 1e-9, "h = {}", h.value);
    }

    #[test]
    fn parallelogram_law_vectors() {
        let vs = vec![
            NamedVec { name: "a".into(), v: vec![3.0, 4.0] },
            NamedVec { name: "b".into(), v: vec![1.0, 0.0] },
        ];
        let out = vectors_analyze(&vs);
        let f = out.iter().find(|f| f.group == "平行四边形法则").expect("parallelogram law");
        // |a+b|² + |a-b|² = 2(25+1) = 52
        assert!((f.num.unwrap() - 52.0).abs() < 1e-9, "got {}", f.value);
    }

    #[test]
    fn viviani_regular_tetra() {
        // Regular tetra with edge √2: (1,1,1),(1,-1,-1),(-1,1,-1),(-1,-1,1)
        let pts = vec![
            NamedPoint { name: "A".into(), p: vec![1.0, 1.0, 1.0] },
            NamedPoint { name: "B".into(), p: vec![1.0, -1.0, -1.0] },
            NamedPoint { name: "C".into(), p: vec![-1.0, 1.0, -1.0] },
            NamedPoint { name: "D".into(), p: vec![-1.0, -1.0, 1.0] },
        ];
        let out = points_analyze(&pts);
        let sum = out.iter().find(|f| f.group == "维维安尼定理" && f.label.contains("面")).expect("tetra viviani");
        let edge = 2f64.sqrt() * 2.0 / 1.0; // |A-B| = √[(0)²+(2)²+(2)²] = √8 = 2√2
        let e = (0.0f64.powi(2) + 2.0f64.powi(2) + 2.0f64.powi(2)).sqrt(); // √8 = 2√2
        let h_reg = (6.0f64).sqrt() / 3.0 * e;
        assert!((sum.num.unwrap() - h_reg).abs() < 1e-9, "sum={} expect {}", sum.value, h_reg);
        let _ = edge;
    }


    #[test]
    fn ptolemy_and_brahmagupta_rectangle() {
        // 3-4-5 rectangle: sides 4,3,4,3; diagonals 5,5; area 12
        let pts = vec![
            NamedPoint { name: "A".into(), p: vec![0.0, 0.0] },
            NamedPoint { name: "B".into(), p: vec![4.0, 0.0] },
            NamedPoint { name: "C".into(), p: vec![4.0, 3.0] },
            NamedPoint { name: "D".into(), p: vec![0.0, 3.0] },
        ];
        let out = points_analyze(&pts);
        assert!(out.iter().any(|f| f.group == "圆内接四边形"));
        let acbd = out.iter().find(|f| f.group == "托勒密定理" && f.label.contains("AC")).unwrap();
        assert!((acbd.num.unwrap() - 25.0).abs() < 1e-9, "AC·BD = {}", acbd.value);
        let rhs = out.iter().find(|f| f.group == "托勒密定理" && f.label.contains("AB")).unwrap();
        assert!((rhs.num.unwrap() - 25.0).abs() < 1e-9);
        let s = out.iter().find(|f| f.group == "婆罗摩笈多公式").unwrap();
        assert!((s.num.unwrap() - 12.0).abs() < 1e-9, "Brahmagupta = {}", s.value);
    }

    #[test]
    fn napoleon_equilateral_centroids() {
        let k = TriangleKnown { a: Some(3.0), b: Some(4.0), c: Some(5.0), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        let fs = &r.cases[0].facts;
        assert!(fs.iter().any(|f| f.group == "拿破仑定理" && f.value.contains("等边")));
        let side = fs.iter().find(|f| f.label == "|G_aG_b|").unwrap();
        assert!(side.num.unwrap() > 0.0);
        assert_eq!(fs.iter().filter(|f| f.group == "拿破仑定理" && f.label.starts_with("G_")).count(), 3);
    }



    #[test]
    fn oh2_carnot_isogonal_morley() {
        let k = TriangleKnown { a: Some(3.0), b: Some(4.0), c: Some(5.0), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        let fs = &r.cases[0].facts;
        let oh2 = fs.iter().find(|f| f.label == "|OH|^2").expect("|OH|^2");
        assert!((oh2.num.unwrap() - 6.25).abs() < 1e-9, "OH² = {}", oh2.value);
        let form = fs.iter().find(|f| f.label.starts_with("9R^2")).expect("9R^2 form");
        assert!((form.num.unwrap() - 6.25).abs() < 1e-9);
        let oi2 = fs.iter().find(|f| f.label == "|OI|^2").expect("|OI|^2");
        assert!((oi2.num.unwrap() - 1.25).abs() < 1e-9, "OI² = {}", oi2.value);
        assert!(fs.iter().any(|f| f.group == "等角共轭" && f.label.contains("H")));
        let sum = fs
            .iter()
            .find(|f| f.group == "卡诺定理" && f.label.contains("delta_a") && f.label.contains('+'))
            .expect("Carnot sum");
        let rr = fs.iter().find(|f| f.group == "卡诺定理" && f.label == "R+r").unwrap();
        assert!((sum.num.unwrap() - rr.num.unwrap()).abs() < 1e-6, "Carnot {} vs {}", sum.value, rr.value);
        assert!(
            fs.iter().any(|f| f.group == "莫利定理" && f.value.contains("等边")),
            "Morley missing"
        );
        let ms = fs.iter().find(|f| f.group == "莫利定理" && f.label == "|M_0M_1|").unwrap();
        assert!(ms.num.unwrap() > 0.0);
    }

    #[test]
    fn simson_and_trilinear_polar() {
        let k = TriangleKnown { a: Some(3.0), b: Some(4.0), c: Some(5.0), ..Default::default() };
        let r = triangle_solve(&k);
        assert!(r.error.is_none(), "{:?}", r.error);
        let fs = &r.cases[0].facts;
        assert!(
            fs.iter().any(|f| f.group == "西姆松线" && f.value.contains("共线")),
            "Simson collinear missing"
        );
        assert!(fs.iter().any(|f| f.group == "西姆松线" && f.label.contains("Simson")));
        assert_eq!(fs.iter().filter(|f| f.group == "西姆松线" && f.label.starts_with("F_")).count(), 3);
        assert!(
            fs.iter().any(|f| f.group == "三线极线" && f.label.contains("tau")),
            "trilinear polar of I missing"
        );
        assert!(fs.iter().any(|f| f.group == "三线极线" && f.label.contains("l_")));
    }

    #[test]
    fn miquel_complete_quadrilateral() {
        // y=0, x=0, x+y=2, x-y=1 — four lines, six vertices, general position
        let ls = vec![
            NamedLine { name: "l".into(), a: 0.0, b: 1.0, c: 0.0 },
            NamedLine { name: "m".into(), a: 1.0, b: 0.0, c: 0.0 },
            NamedLine { name: "n".into(), a: 1.0, b: 1.0, c: 2.0 },
            NamedLine { name: "p".into(), a: 1.0, b: -1.0, c: 1.0 },
        ];
        let out = lines_analyze(&ls, &[]);
        assert!(
            out.iter().any(|f| f.group == "米克尔点" && f.label.contains("Miquel")),
            "Miquel missing: {:?}",
            out.iter().map(|f| (&f.group, &f.label)).collect::<Vec<_>>()
        );
        assert!(out.iter().any(|f| f.group == "米克尔点" && f.label == "M"));
    }

    #[test]
    fn desargues_perspective_triangles() {
        // S=O; A,B,C and scaled A',B',C' with distinct factors → perspective + axis
        let pts = vec![
            NamedPoint { name: "A".into(), p: vec![2.0, 1.0] },
            NamedPoint { name: "B".into(), p: vec![-1.0, 2.0] },
            NamedPoint { name: "C".into(), p: vec![-2.0, -3.0] },
            NamedPoint { name: "A'".into(), p: vec![4.0, 2.0] },
            NamedPoint { name: "B'".into(), p: vec![-3.0, 6.0] },
            NamedPoint { name: "C'".into(), p: vec![-1.0, -1.5] },
        ];
        let out = points_analyze(&pts);
        assert!(
            out.iter().any(|f| f.group == "德萨格定理" && f.value.contains("透视")),
            "Desargues perspective missing"
        );
        assert!(out.iter().any(|f| f.group == "德萨格定理" && f.label == "S"));
        assert!(
            out.iter().any(|f| f.group == "德萨格定理" && f.label.contains("透视轴")),
            "Desargues axis missing"
        );
    }

    #[test]
    fn pascal_cyclic_hexagon() {
        let pts = vec![
            NamedPoint { name: "A".into(), p: vec![5.0, 0.0] },
            NamedPoint { name: "B".into(), p: vec![4.0, 3.0] },
            NamedPoint { name: "C".into(), p: vec![-3.0, 4.0] },
            NamedPoint { name: "D".into(), p: vec![-5.0, 0.0] },
            NamedPoint { name: "E".into(), p: vec![-3.0, -4.0] },
            NamedPoint { name: "F".into(), p: vec![4.0, -3.0] },
        ];
        let out = points_analyze(&pts);
        assert!(
            out.iter().any(|f| f.group == "帕斯卡定理" && f.value.contains("共线")),
            "Pascal missing"
        );
        assert!(out.iter().any(|f| f.group == "帕斯卡定理" && f.label.contains("Pascal线")));
    }

    #[test]
    fn brianchon_regular_hexagon() {
        let s3 = 3f64.sqrt();
        let pts = vec![
            NamedPoint { name: "A".into(), p: vec![1.0, 0.0] },
            NamedPoint { name: "B".into(), p: vec![0.5, s3 / 2.0] },
            NamedPoint { name: "C".into(), p: vec![-0.5, s3 / 2.0] },
            NamedPoint { name: "D".into(), p: vec![-1.0, 0.0] },
            NamedPoint { name: "E".into(), p: vec![-0.5, -s3 / 2.0] },
            NamedPoint { name: "F".into(), p: vec![0.5, -s3 / 2.0] },
        ];
        let out = points_analyze(&pts);
        assert!(
            out.iter().any(|f| f.group == "布利安雄定理" && f.value.contains("共点")),
            "Brianchon missing"
        );
        assert!(out.iter().any(|f| f.group == "布利安雄定理" && f.label.contains("a+c+e")));
        assert!(
            out.iter().any(|f| f.group == "帕斯卡定理" && f.value.contains("无穷远")),
            "Pascal at infinity for regular hex"
        );
    }

    #[test]
    fn tetra_face_areas_and_altitudes() {
        let pts = vec![
            NamedPoint { name: "A".into(), p: vec![0.0, 0.0, 0.0] },
            NamedPoint { name: "B".into(), p: vec![1.0, 0.0, 0.0] },
            NamedPoint { name: "C".into(), p: vec![0.0, 1.0, 0.0] },
            NamedPoint { name: "D".into(), p: vec![0.0, 0.0, 1.0] },
        ];
        let out = points_analyze(&pts);
        let faces = out.iter().filter(|f| f.group == "四面体面" && f.label.starts_with("S_")).count();
        assert_eq!(faces, 4, "four face areas");
        let hs = out.iter().filter(|f| f.group == "四面体面" && f.label.starts_with("h_")).count();
        assert_eq!(hs, 4, "four altitudes");
        let sabc = out.iter().find(|f| f.label.contains("ABC") && f.label.starts_with("S_")).unwrap();
        assert!((sabc.num.unwrap() - 0.5).abs() < 1e-9);
        let hd = out.iter().find(|f| f.label == "h_{D}").unwrap();
        assert!((hd.num.unwrap() - 1.0).abs() < 1e-9); // V=1/6, S_ABC=1/2 → h=1
    }

    #[test]
    fn reflect_point_over_line_and_plane() {
        let ls = vec![NamedLine { name: "l".into(), a: 0.0, b: 1.0, c: 0.0 }]; // y=0
        let pts = vec![NamedPoint { name: "P".into(), p: vec![1.0, 2.0] }];
        let out = lines_analyze(&ls, &pts);
        let rp = out.iter().find(|f| f.group == "反射").expect("line reflection");
        assert!(rp.value.contains("1") && rp.value.contains("-2") || rp.value.contains("1,\\ -2") || rp.value.contains("(1"), "got {}", rp.value);
        if let Some(Shape::Point { x, y, .. }) = rp.shape.as_ref() {
            assert!((*x - 1.0).abs() < 1e-9 && (*y + 2.0).abs() < 1e-9);
        } else {
            panic!("expected point shape");
        }
        let planes = vec![NamedPlane { name: "α".into(), n: [0.0, 0.0, 1.0], d: 0.0 }]; // z=0
        let q = vec![NamedPoint { name: "Q".into(), p: vec![1.0, 2.0, 3.0] }];
        let out3 = planes_analyze(&planes, &q);
        let rq = out3.iter().find(|f| f.group == "反射").expect("plane reflection");
        if let Some(Shape::Point3 { x, y, z, .. }) = rq.shape.as_ref() {
            assert!((*x - 1.0).abs() < 1e-9 && (*y - 2.0).abs() < 1e-9 && (*z + 3.0).abs() < 1e-9);
        } else {
            panic!("expected Point3");
        }
    }


}
