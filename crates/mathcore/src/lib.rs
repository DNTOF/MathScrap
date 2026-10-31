//! MathScrap math core — the JS ↔ Rust boundary.
//!
//! Conventions for every export:
//! - expressions are passed as source strings in the notebook dialect (see `expr.rs`)
//! - `env` is a JSON object of fixed variable values, e.g. `{"k": 2, "b": 1}` (`""` = none)
//! - dense numeric output is `Vec<f64>` (a `Float64Array` in JS); structured output is a JSON string
//! - errors never throw: numeric exports return NaN / empty arrays, JSON exports carry `error`

pub mod circle;
pub mod expr;
pub mod geometry;
pub mod numeric;

use expr::{compile, parse, Code};
use serde::Serialize;
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

fn env_of(env: &str) -> HashMap<String, f64> {
    if env.trim().is_empty() {
        return HashMap::new();
    }
    serde_json::from_str::<HashMap<String, f64>>(env).unwrap_or_default()
}

fn code(src: &str, vars: &[&str], env: &str) -> Result<Code, String> {
    let e = parse(src)?;
    compile(&e, vars, &env_of(env))
}

fn json<T: Serialize>(v: &T) -> String {
    serde_json::to_string(v).unwrap_or_else(|e| format!("{{\"error\":\"{}\"}}", e))
}

#[wasm_bindgen]
pub fn version() -> String {
    format!("mathcore {}", env!("CARGO_PKG_VERSION"))
}

/// LaTeX for a statement (`y = x^2`, `a = (1, 2)`, `sin(x)/x`).
#[wasm_bindgen]
pub fn latex(src: &str) -> String {
    expr::statement_latex(src)
}

#[derive(Serialize)]
struct Inspect {
    ok: bool,
    error: Option<String>,
    vars: Vec<String>,
    source: Option<String>,
}

/// Validate an expression and list its free variables.
#[wasm_bindgen]
pub fn inspect(src: &str) -> String {
    match parse(src) {
        Ok(e) => {
            let mut vars = Vec::new();
            e.free_vars(&mut vars);
            json(&Inspect { ok: true, error: None, vars, source: Some(e.to_source()) })
        }
        Err(err) => json(&Inspect { ok: false, error: Some(err), vars: vec![], source: None }),
    }
}

/// Replace variable `name` with expression `with` and return normalised source.
#[wasm_bindgen]
pub fn substitute(src: &str, name: &str, with: &str) -> String {
    match (parse(src), parse(with)) {
        (Ok(e), Ok(w)) => e.substitute(name, &w).to_source(),
        _ => String::new(),
    }
}

/// Evaluate with all variables taken from `env`.
#[wasm_bindgen]
pub fn eval(src: &str, env: &str) -> f64 {
    code(src, &[], env).map(|c| c.eval(&[])).unwrap_or(f64::NAN)
}

/// Sample `src` over `var ∈ [a, b]` at `n` points.
#[wasm_bindgen]
pub fn sample_curve(src: &str, var: &str, env: &str, a: f64, b: f64, n: usize) -> Vec<f64> {
    match code(src, &[var], env) {
        Ok(c) => numeric::sample_1d(&c, a, b, n),
        Err(_) => vec![],
    }
}

/// Row-major grid: out[j * nx + i] = f(x_i, y_j).
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn sample_grid(src: &str, xv: &str, yv: &str, env: &str, x0: f64, x1: f64, y0: f64, y1: f64, nx: usize, ny: usize) -> Vec<f64> {
    let Ok(c) = code(src, &[xv, yv], env) else { return vec![] };
    let xs: Vec<f64> = numeric::linspace(x0, x1, nx).collect();
    let mut out = Vec::with_capacity(nx * ny);
    for y in numeric::linspace(y0, y1, ny) {
        for &x in &xs {
            out.push(c.eval(&[x, y]));
        }
    }
    out
}

/// Volume samples for isosurfaces: index = (k * n + j) * n + i over x_i, y_j, z_k in [lo, hi]³.
#[wasm_bindgen]
pub fn sample_volume(src: &str, env: &str, lo: f64, hi: f64, n: usize) -> Vec<f64> {
    let Ok(c) = code(src, &["x", "y", "z"], env) else { return vec![] };
    let ts: Vec<f64> = numeric::linspace(lo, hi, n).collect();
    let mut out = Vec::with_capacity(n * n * n);
    for &z in &ts {
        for &y in &ts {
            for &x in &ts {
                out.push(c.eval(&[x, y, z]));
            }
        }
    }
    out
}

#[wasm_bindgen]
pub fn roots(src: &str, var: &str, env: &str, a: f64, b: f64) -> Vec<f64> {
    let Ok(c) = code(src, &[var], env) else { return vec![] };
    numeric::roots_fn(&|x| c.eval(&[x]), a, b, 4000)
}

#[wasm_bindgen]
pub fn extrema(src: &str, var: &str, env: &str, a: f64, b: f64) -> String {
    let Ok(c) = code(src, &[var], env) else { return "[]".into() };
    json(&numeric::extrema_fn(&|x| c.eval(&[x]), a, b, 4000))
}

/// Pairs [start, end, ...] of intervals in [a, b] where the expression is undefined.
#[wasm_bindgen]
pub fn domain_gaps(src: &str, var: &str, env: &str, a: f64, b: f64) -> Vec<f64> {
    let Ok(c) = code(src, &[var], env) else { return vec![] };
    numeric::domain_gaps_fn(&|x| c.eval(&[x]), a, b, 4000)
}

/// Intersections of y = f(x) and y = g(x) on [a, b] as [x0, y0, x1, y1, ...].
#[wasm_bindgen]
pub fn intersect_curves(f: &str, g: &str, env: &str, a: f64, b: f64) -> Vec<f64> {
    let (Ok(cf), Ok(cg)) = (code(f, &["x"], env), code(g, &["x"], env)) else { return vec![] };
    let xs = numeric::roots_fn(&|x| cf.eval(&[x]) - cg.eval(&[x]), a, b, 4000);
    xs.into_iter().flat_map(|x| [x, numeric::clean(cf.eval(&[x]))]).collect()
}

/// Intersections of y = f(x) with the implicit curve F(x, y) = 0.
#[wasm_bindgen]
pub fn intersect_curve_implicit(f: &str, big_f: &str, env: &str, a: f64, b: f64) -> Vec<f64> {
    let (Ok(cf), Ok(cg)) = (code(f, &["x"], env), code(big_f, &["x", "y"], env)) else { return vec![] };
    let xs = numeric::roots_fn(&|x| cg.eval(&[x, cf.eval(&[x])]), a, b, 6000);
    xs.into_iter().flat_map(|x| [x, numeric::clean(cf.eval(&[x]))]).collect()
}

#[derive(Serialize)]
struct SolveOut {
    unknowns: Vec<String>,
    solutions: Vec<Vec<f64>>,
    exact: bool,
    starts: usize,
    error: Option<String>,
}

/// Solve residual equations `eqs` (each = 0) for `unknowns` with multi-start Levenberg–Marquardt.
/// `eqs_json`: ["k*1 + b - 3", ...], `unknowns_json`: ["k", "b"].
#[wasm_bindgen]
pub fn solve_system(eqs_json: &str, unknowns_json: &str, env: &str) -> String {
    let eqs: Vec<String> = serde_json::from_str(eqs_json).unwrap_or_default();
    let unknowns: Vec<String> = serde_json::from_str(unknowns_json).unwrap_or_default();
    let names: Vec<&str> = unknowns.iter().map(|s| s.as_str()).collect();
    let env = env_of(env);
    let mut codes = Vec::new();
    for e in &eqs {
        match parse(e).and_then(|x| compile(&x, &names, &env)) {
            Ok(c) => codes.push(c),
            Err(err) => return json(&SolveOut { unknowns, solutions: vec![], exact: false, starts: 0, error: Some(err) }),
        }
    }
    let r = numeric::solve_system(&codes, names.len());
    json(&SolveOut { unknowns, solutions: r.solutions, exact: r.exact, starts: r.starts, error: None })
}

/// Coefficients if `src` is affine in `vars`: [c_0, ..., c_{n-1}, constant]; `null` otherwise.
#[wasm_bindgen]
pub fn linear_coeffs(src: &str, vars_json: &str, env: &str) -> String {
    let vars: Vec<String> = serde_json::from_str(vars_json).unwrap_or_default();
    let names: Vec<&str> = vars.iter().map(|s| s.as_str()).collect();
    match code(src, &names, env) {
        Ok(c) => json(&numeric::affine_coeffs(&c, names.len())),
        Err(_) => "null".into(),
    }
}

/// Classify a quadratic implicit curve F(x, y) = 0 (circle / ellipse / hyperbola / parabola).
#[wasm_bindgen]
pub fn conic_analyze(src: &str, env: &str, name: &str) -> String {
    let Ok(c) = code(src, &["x", "y"], env) else { return "[]".into() };
    match numeric::quadratic2_coeffs(&c) {
        Some(q) => json(&geometry::conic_analyze(q, name)),
        None => "[]".into(),
    }
}

/// Solve a triangle from partial data: {"a":3,"b":4,"C":1.5708,"S":6} (angles in radians).
#[wasm_bindgen]
pub fn triangle_solve(known_json: &str) -> String {
    match serde_json::from_str::<geometry::TriangleKnown>(known_json) {
        Ok(k) => json(&geometry::triangle_solve(&k)),
        Err(e) => json(&geometry::TriangleResult { cases: vec![], error: Some(e.to_string()) }),
    }
}

/// Solve a circle chord problem around one point P:
/// `{"r":5,"cross":{"p":"P","chords":[["A","B"],["C","D"]],"lengths":{"PA":2,"PB":6,"PC":4},"pos":"in"}}`
/// → cases with the derived segment, chord lengths, centre distances, central angles.
#[wasm_bindgen]
pub fn circle_solve(known_json: &str) -> String {
    match serde_json::from_str::<circle::CircleKnown>(known_json) {
        Ok(k) => json(&circle::circle_solve(&k)),
        Err(e) => json(&circle::CircleResult { cases: vec![], error: Some(e.to_string()) }),
    }
}

/// [{"name":"O","cx":0,"cy":0,"r":5}] plus named points → facts about powers, chords,
/// central / inscribed angles, chord crossings.
#[wasm_bindgen]
pub fn circles_analyze(circles_json: &str, points_json: &str) -> String {
    let cs: Vec<circle::NamedCircle> = serde_json::from_str(circles_json).unwrap_or_default();
    let pts: Vec<geometry::NamedPoint> = serde_json::from_str(points_json).unwrap_or_default();
    json(&circle::circles_analyze(&cs, &pts))
}

/// Midpoints / section points: [{"name":"M","a":"A","b":"B"}, {"name":"P","a":"A","b":"B",
/// "m":1,"n":2} (AP:PB = 1:2)] plus named points → coordinates, distances, ratios and
/// midsegments between two midpoints that share an endpoint.
#[wasm_bindgen]
pub fn derived_points_analyze(defs_json: &str, points_json: &str) -> String {
    let defs: Vec<geometry::PointDef> = serde_json::from_str(defs_json).unwrap_or_default();
    let pts: Vec<geometry::NamedPoint> = serde_json::from_str(points_json).unwrap_or_default();
    json(&geometry::derived_points_analyze(&defs, &pts))
}

/// `{"cx":..,"cy":..,"r":..}` when the implicit curve F(x, y) = 0 is a real circle, else "null".
#[wasm_bindgen]
pub fn circle_of(src: &str, env: &str) -> String {
    let Ok(c) = code(src, &["x", "y"], env) else { return "null".into() };
    let Some(q) = numeric::quadratic2_coeffs(&c) else { return "null".into() };
    let [a, b, cc, d, e, f] = q;
    let det = 4.0 * a * cc - b * b;
    if det <= 0.0 || !geometry::near(b, 0.0) || !geometry::near(a, cc) || geometry::near(a, 0.0) {
        return "null".into();
    }
    let x0 = (b * e - 2.0 * cc * d) / det;
    let y0 = (b * d - 2.0 * a * e) / det;
    let f0 = a * x0 * x0 + b * x0 * y0 + cc * y0 * y0 + d * x0 + e * y0 + f;
    let r2 = -f0 / a;
    if r2 <= 1e-12 {
        return "null".into();
    }
    json(&serde_json::json!({ "cx": numeric::clean(x0), "cy": numeric::clean(y0), "r": r2.sqrt() }))
}

/// [{"name":"A","p":[0,0]}, ...] → facts about distances, polygon, triangle centres.
#[wasm_bindgen]
pub fn points_analyze(points_json: &str) -> String {
    let pts: Vec<geometry::NamedPoint> = serde_json::from_str(points_json).unwrap_or_default();
    json(&geometry::points_analyze(&pts))
}

/// [{"name":"a","v":[1,2,3]}, ...]
#[wasm_bindgen]
pub fn vectors_analyze(vectors_json: &str) -> String {
    let vs: Vec<geometry::NamedVec> = serde_json::from_str(vectors_json).unwrap_or_default();
    json(&geometry::vectors_analyze(&vs))
}

/// [{"name":"l_1","a":2,"b":-1,"c":-1}] meaning a x + b y = c, plus points for distances.
#[wasm_bindgen]
pub fn lines_analyze(lines_json: &str, points_json: &str) -> String {
    let ls: Vec<geometry::NamedLine> = serde_json::from_str(lines_json).unwrap_or_default();
    let pts: Vec<geometry::NamedPoint> = serde_json::from_str(points_json).unwrap_or_default();
    json(&geometry::lines_analyze(&ls, &pts))
}

/// [{"name":"π_1","n":[1,1,1],"d":3}] meaning n · (x, y, z) = d, plus points for distances.
#[wasm_bindgen]
pub fn planes_analyze(planes_json: &str, points_json: &str) -> String {
    let ps: Vec<geometry::NamedPlane> = serde_json::from_str(planes_json).unwrap_or_default();
    let pts: Vec<geometry::NamedPoint> = serde_json::from_str(points_json).unwrap_or_default();
    json(&geometry::planes_analyze(&ps, &pts))
}

/// Number formatting shared with the UI: exact forms (√, fractions, π) plus decimals.
#[wasm_bindgen]
pub fn nice_number(v: f64) -> String {
    geometry::nice(v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn solve_linear_params() {
        // y = kx + b through (1, 3) and (2, 5)
        let out = solve_system(r#"["k*1+b-3","k*2+b-5"]"#, r#"["k","b"]"#, "");
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        let s = &v["solutions"][0];
        assert!((s[0].as_f64().unwrap() - 2.0).abs() < 1e-9);
        assert!((s[1].as_f64().unwrap() - 1.0).abs() < 1e-9);
    }

    #[test]
    fn solve_quadratic_two_roots() {
        let out = solve_system(r#"["t^2 - 4"]"#, r#"["t"]"#, "");
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["solutions"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn curve_intersections() {
        let pts = intersect_curves("x^2 - 2", "0.5x + 1", "", -10.0, 10.0);
        assert_eq!(pts.len(), 4);
        let circle = intersect_curve_implicit("x", "x^2 + y^2 - 4", "", -10.0, 10.0);
        assert_eq!(circle.len(), 4);
    }

    #[test]
    fn tangent_root() {
        let r = roots("(x-1)^2", "x", "", -5.0, 5.0);
        assert_eq!(r.len(), 1);
        assert!((r[0] - 1.0).abs() < 1e-5);
    }

    #[test]
    fn plane_coeffs() {
        let c = linear_coeffs("x + 2y - z - 3", r#"["x","y","z"]"#, "");
        assert_eq!(c, "[1.0,2.0,-1.0,-3.0]");
    }

    #[test]
    fn gaps() {
        let g = domain_gaps("ln(x)", "x", "", -2.0, 2.0);
        assert_eq!(g.len(), 2);
        assert!(g[1].abs() < 1e-6);
    }
}

#[cfg(test)]
mod extrema_tests {
    #[test]
    fn parabola_min() {
        let s = super::extrema("x^2 - 2", "x", "", -20.0, 20.0);
        assert!(s.contains("min"), "{}", s);
        let s = super::extrema("1/x", "x", "", -20.0, 20.0);
        assert_eq!(s, "[]");
    }
}
