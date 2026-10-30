//! Sampling, root finding, extrema, and a multi-start Levenberg–Marquardt system solver.

use crate::expr::Code;

pub fn linspace(a: f64, b: f64, n: usize) -> impl Iterator<Item = f64> {
    let n = n.max(2);
    let h = (b - a) / (n - 1) as f64;
    (0..n).map(move |i| a + h * i as f64)
}

pub fn sample_1d(c: &Code, a: f64, b: f64, n: usize) -> Vec<f64> {
    linspace(a, b, n).map(|x| c.eval(&[x])).collect()
}

fn bisect(f: &dyn Fn(f64) -> f64, mut lo: f64, mut hi: f64, mut flo: f64) -> f64 {
    for _ in 0..80 {
        let mid = 0.5 * (lo + hi);
        let fm = f(mid);
        if fm == 0.0 {
            return mid;
        }
        if (fm < 0.0) == (flo < 0.0) {
            lo = mid;
            flo = fm;
        } else {
            hi = mid;
        }
        if (hi - lo).abs() < 1e-13 * (1.0 + lo.abs()) {
            break;
        }
    }
    0.5 * (lo + hi)
}

fn golden_min(f: &dyn Fn(f64) -> f64, mut a: f64, mut b: f64) -> f64 {
    let g = (5f64.sqrt() - 1.0) / 2.0;
    let mut c = b - g * (b - a);
    let mut d = a + g * (b - a);
    for _ in 0..100 {
        if f(c) < f(d) {
            b = d;
        } else {
            a = c;
        }
        c = b - g * (b - a);
        d = a + g * (b - a);
        if (b - a).abs() < 1e-12 * (1.0 + a.abs()) {
            break;
        }
    }
    0.5 * (a + b)
}

fn push_unique(out: &mut Vec<f64>, x: f64, tol: f64) {
    if !out.iter().any(|r| (r - x).abs() < tol) {
        out.push(x);
    }
}

/// Real roots of f on [a, b]: sign changes (rejecting asymptote jumps) plus tangent touches.
pub fn roots_fn(f: &dyn Fn(f64) -> f64, a: f64, b: f64, n: usize) -> Vec<f64> {
    let xs: Vec<f64> = linspace(a, b, n).collect();
    let ys: Vec<f64> = xs.iter().map(|&x| f(x)).collect();
    let span = (b - a).abs();
    let tol = span * 1e-7 + 1e-10;
    let mut roots = Vec::new();
    let scale = ys.iter().filter(|v| v.is_finite()).fold(0.0f64, |m, v| m.max(v.abs())).max(1.0);
    for i in 0..xs.len() - 1 {
        let (y0, y1) = (ys[i], ys[i + 1]);
        if !y0.is_finite() || !y1.is_finite() {
            continue;
        }
        if y0 == 0.0 {
            push_unique(&mut roots, xs[i], tol);
            continue;
        }
        if (y0 < 0.0) != (y1 < 0.0) && y1 != 0.0 {
            let r = bisect(f, xs[i], xs[i + 1], y0);
            let fr = f(r);
            if fr.is_finite() && fr.abs() < 1e-6 * scale {
                push_unique(&mut roots, r, tol);
            }
        }
    }
    // tangent (double) roots: local minima of |f| that touch zero
    for i in 1..xs.len() - 1 {
        let (a0, a1, a2) = (ys[i - 1].abs(), ys[i].abs(), ys[i + 1].abs());
        if a1.is_finite() && a0.is_finite() && a2.is_finite() && a1 <= a0 && a1 <= a2 && a1 < 1e-2 * scale {
            let g = |x: f64| f(x).abs();
            let m = golden_min(&g, xs[i - 1], xs[i + 1]);
            if g(m) < 1e-9 * scale.max(1.0) {
                push_unique(&mut roots, m, tol.max(1e-6));
            }
        }
    }
    roots.sort_by(|a, b| a.partial_cmp(b).unwrap());
    roots.into_iter().map(clean).collect()
}

/// Snap values like 1.9999999997 to 2 for nicer display.
pub fn clean(v: f64) -> f64 {
    let r = v.round();
    if (v - r).abs() < 1e-9 {
        return if r == 0.0 { 0.0 } else { r };
    }
    let r3 = (v * 1000.0).round() / 1000.0;
    if (v - r3).abs() < 1e-10 {
        return r3;
    }
    v
}

#[derive(serde::Serialize)]
pub struct Extremum {
    pub x: f64,
    pub y: f64,
    pub kind: &'static str,
}

pub fn extrema_fn(f: &dyn Fn(f64) -> f64, a: f64, b: f64, n: usize) -> Vec<Extremum> {
    let xs: Vec<f64> = linspace(a, b, n).collect();
    let ys: Vec<f64> = xs.iter().map(|&x| f(x)).collect();
    let mut out: Vec<Extremum> = Vec::new();
    for i in 1..xs.len() - 1 {
        let (y0, y1, y2) = (ys[i - 1], ys[i], ys[i + 1]);
        if !(y0.is_finite() && y1.is_finite() && y2.is_finite()) {
            continue;
        }
        let is_max = y1 > y0 && y1 >= y2;
        let is_min = y1 < y0 && y1 <= y2;
        if !(is_max || is_min) {
            continue;
        }
        let x = if is_min {
            golden_min(f, xs[i - 1], xs[i + 1])
        } else {
            let g = |x: f64| -f(x);
            golden_min(&g, xs[i - 1], xs[i + 1])
        };
        let y = f(x);
        // reject spikes next to vertical asymptotes: refinement must stay near the sampled value
        let h = (b - a) / n as f64;
        if !(y.is_finite() && f(x - h).is_finite() && f(x + h).is_finite()) {
            continue;
        }
        if (y - y1).abs() > (y1 - y0).abs() + (y1 - y2).abs() + 1e-9 {
            continue;
        }
        if out.iter().any(|e| (e.x - x).abs() < 1e-6 * (1.0 + x.abs())) {
            continue;
        }
        out.push(Extremum { x: clean(x), y: clean(y), kind: if is_max { "max" } else { "min" } });
    }
    out
}

/// Intervals (pairs) on [a, b] where f is undefined / non-finite.
pub fn domain_gaps_fn(f: &dyn Fn(f64) -> f64, a: f64, b: f64, n: usize) -> Vec<f64> {
    let xs: Vec<f64> = linspace(a, b, n).collect();
    let mut gaps = Vec::new();
    let mut start: Option<f64> = None;
    for (i, &x) in xs.iter().enumerate() {
        let bad = !f(x).is_finite();
        match (bad, start) {
            (true, None) => start = Some(if i == 0 { x } else { refine_edge(f, xs[i - 1], x, false) }),
            (false, Some(s)) => {
                gaps.push(clean(s));
                gaps.push(clean(refine_edge(f, xs[i - 1], x, true)));
                start = None;
            }
            _ => {}
        }
    }
    if let Some(s) = start {
        gaps.push(clean(s));
        gaps.push(b);
    }
    gaps
}

/// Boundary between a finite and non-finite region; `good_on_right` tells which side is defined.
fn refine_edge(f: &dyn Fn(f64) -> f64, mut lo: f64, mut hi: f64, good_on_right: bool) -> f64 {
    for _ in 0..60 {
        let mid = 0.5 * (lo + hi);
        let good = f(mid).is_finite();
        if good == good_on_right {
            hi = mid;
        } else {
            lo = mid;
        }
    }
    0.5 * (lo + hi)
}

// ---------------------------------------------------------------------------
// Systems of equations

fn solve_linear(mut a: Vec<Vec<f64>>, mut b: Vec<f64>) -> Option<Vec<f64>> {
    let n = b.len();
    for col in 0..n {
        let piv = (col..n).max_by(|&i, &j| a[i][col].abs().partial_cmp(&a[j][col].abs()).unwrap())?;
        if a[piv][col].abs() < 1e-300 {
            return None;
        }
        a.swap(col, piv);
        b.swap(col, piv);
        for r in col + 1..n {
            let f = a[r][col] / a[col][col];
            for c in col..n {
                a[r][c] -= f * a[col][c];
            }
            b[r] -= f * b[col];
        }
    }
    let mut x = vec![0.0; n];
    for r in (0..n).rev() {
        let s: f64 = (r + 1..n).map(|c| a[r][c] * x[c]).sum();
        x[r] = (b[r] - s) / a[r][r];
    }
    Some(x)
}

pub fn solve_linear_pub(a: Vec<Vec<f64>>, b: Vec<f64>) -> Option<Vec<f64>> {
    solve_linear(a, b)
}

fn norm2(v: &[f64]) -> f64 {
    v.iter().map(|x| x * x).sum()
}

fn eval_all(eqs: &[Code], u: &[f64]) -> Vec<f64> {
    eqs.iter().map(|c| c.eval(u)).collect()
}

/// Levenberg–Marquardt from one start. Returns (solution, residual²) on convergence.
fn lm(eqs: &[Code], start: &[f64]) -> Option<(Vec<f64>, f64)> {
    let n = start.len();
    let m = eqs.len();
    let mut u = start.to_vec();
    let mut r = eval_all(eqs, &u);
    if r.iter().any(|v| !v.is_finite()) {
        return None;
    }
    let mut cost = norm2(&r);
    let mut lambda = 1e-3;
    for _ in 0..200 {
        if cost < 1e-26 {
            break;
        }
        // numerical Jacobian (central differences)
        let mut j = vec![vec![0.0; n]; m];
        for k in 0..n {
            let h = 1e-6 * (1.0 + u[k].abs());
            let mut up = u.clone();
            let mut dn = u.clone();
            up[k] += h;
            dn[k] -= h;
            let rp = eval_all(eqs, &up);
            let rn = eval_all(eqs, &dn);
            for i in 0..m {
                j[i][k] = (rp[i] - rn[i]) / (2.0 * h);
            }
        }
        let mut jtj = vec![vec![0.0; n]; n];
        let mut jtr = vec![0.0; n];
        for a in 0..n {
            for b in 0..n {
                jtj[a][b] = (0..m).map(|i| j[i][a] * j[i][b]).sum();
            }
            jtr[a] = -(0..m).map(|i| j[i][a] * r[i]).sum::<f64>();
        }
        let mut improved = false;
        for _ in 0..12 {
            let mut aug = jtj.clone();
            for d in 0..n {
                aug[d][d] += lambda * (1.0 + jtj[d][d]);
            }
            let Some(step) = solve_linear(aug, jtr.clone()) else {
                lambda *= 10.0;
                continue;
            };
            let cand: Vec<f64> = u.iter().zip(&step).map(|(a, b)| a + b).collect();
            let rc = eval_all(eqs, &cand);
            let cc = norm2(&rc);
            if cc.is_finite() && cc < cost {
                u = cand;
                r = rc;
                cost = cc;
                lambda = (lambda * 0.3).max(1e-12);
                improved = true;
                break;
            }
            lambda *= 10.0;
        }
        if !improved {
            break;
        }
    }
    if cost.is_finite() && u.iter().all(|v| v.is_finite()) {
        Some((u, cost))
    } else {
        None
    }
}

#[derive(serde::Serialize)]
pub struct SystemResult {
    pub solutions: Vec<Vec<f64>>,
    /// true when every equation is satisfied (vs. best least-squares fit)
    pub exact: bool,
    pub starts: usize,
}

pub fn solve_system(eqs: &[Code], n: usize) -> SystemResult {
    let grid: Vec<f64> = match n {
        1 => (-40..=40).map(|i| i as f64 * 0.5).collect(),
        2 => vec![-9.0, -4.0, -1.5, -0.4, 0.3, 1.2, 3.0, 6.5, 12.0],
        3 => vec![-6.0, -1.3, 0.4, 2.1, 7.0],
        _ => vec![-2.0, 0.5, 3.0],
    };
    let mut starts: Vec<Vec<f64>> = vec![vec![]];
    for _ in 0..n {
        starts = starts.into_iter().flat_map(|s| grid.iter().map(move |g| {
            let mut v = s.clone();
            v.push(*g);
            v
        })).collect();
        if starts.len() > 4000 {
            break;
        }
    }
    let total = starts.len();
    let mut sols: Vec<(Vec<f64>, f64)> = Vec::new();
    let mut best: Option<(Vec<f64>, f64)> = None;
    for s in starts.iter().filter(|s| s.len() == n) {
        if let Some((u, cost)) = lm(eqs, s) {
            if best.as_ref().map_or(true, |(_, c)| cost < *c) {
                best = Some((u.clone(), cost));
            }
            let scale = 1.0 + u.iter().fold(0.0f64, |m, v| m.max(v.abs()));
            if cost < 1e-16 * scale * scale {
                let u: Vec<f64> = u.into_iter().map(clean).collect();
                if !sols.iter().any(|(v, _)| v.iter().zip(&u).all(|(a, b)| (a - b).abs() < 1e-5 * (1.0 + a.abs()))) {
                    sols.push((u, cost));
                }
            }
        }
        if sols.len() >= 8 {
            break;
        }
    }
    if sols.is_empty() {
        return SystemResult { solutions: best.map(|(u, _)| vec![u.into_iter().map(clean).collect()]).unwrap_or_default(), exact: false, starts: total };
    }
    sols.sort_by(|a, b| {
        for (x, y) in a.0.iter().zip(&b.0) {
            if (x - y).abs() > 1e-9 {
                return x.partial_cmp(y).unwrap();
            }
        }
        std::cmp::Ordering::Equal
    });
    SystemResult { solutions: sols.into_iter().map(|(u, _)| u).collect(), exact: true, starts: total }
}

/// If `c(slots)` is affine in all slots, returns [coef_0, ..., coef_{n-1}, constant].
pub fn affine_coeffs(c: &Code, n: usize) -> Option<Vec<f64>> {
    let zero = vec![0.0; n];
    let k = c.eval(&zero);
    if !k.is_finite() {
        return None;
    }
    let mut coefs = Vec::with_capacity(n + 1);
    for i in 0..n {
        let mut p = zero.clone();
        p[i] = 1.0;
        coefs.push(c.eval(&p) - k);
    }
    let probes: [&[f64]; 4] = [&[1.7, -2.3, 0.9], &[-3.1, 0.4, 2.6], &[5.5, 3.3, -4.4], &[0.37, 7.1, 1.9]];
    for pr in probes {
        let p: Vec<f64> = (0..n).map(|i| pr[i % 3]).collect();
        let pred: f64 = k + coefs.iter().zip(&p).map(|(a, b)| a * b).sum::<f64>();
        let got = c.eval(&p);
        if !got.is_finite() || (pred - got).abs() > 1e-8 * (1.0 + got.abs()) {
            return None;
        }
    }
    coefs.push(k);
    Some(coefs.into_iter().map(clean).collect())
}

/// Fit F(x, y) = A x² + B xy + C y² + D x + E y + F exactly; None if F isn't a quadratic.
pub fn quadratic2_coeffs(c: &Code) -> Option<[f64; 6]> {
    let f = |x: f64, y: f64| c.eval(&[x, y]);
    let f0 = f(0.0, 0.0);
    let fx1 = f(1.0, 0.0);
    let fxm = f(-1.0, 0.0);
    let fy1 = f(0.0, 1.0);
    let fym = f(0.0, -1.0);
    let fxy = f(1.0, 1.0);
    let a = (fx1 + fxm) / 2.0 - f0;
    let d = (fx1 - fxm) / 2.0;
    let cc = (fy1 + fym) / 2.0 - f0;
    let e = (fy1 - fym) / 2.0;
    let b = fxy - (a + cc + d + e + f0);
    let coeffs = [a, b, cc, d, e, f0];
    if coeffs.iter().any(|v| !v.is_finite()) {
        return None;
    }
    for (x, y) in [(2.3, -1.7), (-3.9, 0.6), (0.45, 4.2), (6.1, 2.2)] {
        let pred = a * x * x + b * x * y + cc * y * y + d * x + e * y + f0;
        let got = f(x, y);
        if !got.is_finite() || (pred - got).abs() > 1e-7 * (1.0 + got.abs()) {
            return None;
        }
    }
    Some(coeffs.map(clean))
}
