//! Round-4 integration test: drive the real `ocr_native_recognize` Tauri
//! command implementation over the 13 parity fixtures, and report first-call
//! latency (model load included), steady-state latency, and process peak memory.
//!
//! Run: cargo test --manifest-path src-tauri/Cargo.toml --features native-ocr --test native_ocr -- --nocapture
//!
//! This exercises the same command function the Tauri IPC layer dispatches to;
//! the window/IPC hop itself is not simulated (no dev server needed).

#![cfg(feature = "native-ocr")]

use mathscrap_lib::ocr_native::{NativePoint, NativeStroke, ocr_native_recognize};
use serde::Deserialize;
use std::time::{Duration, Instant};

#[derive(Deserialize)]
struct TextCand {
    #[allow(dead_code)]
    text: String,
    #[allow(dead_code)]
    confidence: f64,
}

#[derive(Deserialize)]
struct Fixture {
    name: String,
    strokes: Vec<StrokeJson>,
    #[allow(dead_code)]
    text: Vec<TextCand>,
}

#[derive(Deserialize)]
struct StrokeJson {
    points: Vec<PointJson>,
    #[serde(rename = "lineWidth")]
    line_width: f64,
}

#[derive(Deserialize)]
struct PointJson {
    x: f64,
    y: f64,
}

#[derive(Deserialize)]
struct FixtureFile {
    #[allow(dead_code)]
    runtime: String,
    fixtures: Vec<Fixture>,
}

fn to_native(strokes: &[StrokeJson]) -> Vec<NativeStroke> {
    strokes
        .iter()
        .map(|s| NativeStroke {
            points: s.points.iter().map(|p| NativePoint { x: p.x, y: p.y }).collect(),
            line_width: s.line_width,
        })
        .collect()
}

#[cfg(windows)]
fn peak_working_set_mb() -> f64 {
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows_sys::Win32::System::Threading::GetCurrentProcess;
    unsafe {
        let handle: HANDLE = GetCurrentProcess();
        let mut pmc: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
        pmc.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
        let ok = GetProcessMemoryInfo(handle, &mut pmc, std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32);
        if ok == 0 {
            return -1.0;
        }
        pmc.PeakWorkingSetSize as f64 / (1024.0 * 1024.0)
    }
}

#[cfg(not(windows))]
fn peak_working_set_mb() -> f64 {
    -1.0 // not measured on this host
}

#[test]
fn all_fixtures_match_the_web_baseline() {
    let manifest = env!("CARGO_MANIFEST_DIR");
    let fixtures_path = format!("{manifest}/../crates/comer-native/fixtures/fixtures.json");
    let raw = std::fs::read_to_string(&fixtures_path).expect("fixtures.json readable");
    let file: FixtureFile = serde_json::from_str(&raw).expect("fixtures parse");
    assert_eq!(file.fixtures.len(), 13, "expected the 13 parity fixtures");

    let mut first_call: Option<Duration> = None;
    let mut per_fixture: Vec<(String, Duration)> = Vec::new();
    let mut top1_mismatch: Vec<String> = Vec::new();

    for fixture in &file.fixtures {
        let strokes = to_native(&fixture.strokes);
        let expected = fixture.text.first().map(|t| t.text.clone()).unwrap_or_default();
        let t0 = Instant::now();
        let out = ocr_native_recognize(strokes).expect("command succeeds");
        let elapsed = t0.elapsed();
        if first_call.is_none() {
            first_call = Some(elapsed); // includes one-time model load + ORT init
        }
        let got = out.first().map(|c| c.text.clone()).unwrap_or_default();
        if got != expected {
            top1_mismatch.push(format!("{}: got '{got}' want '{expected}'", fixture.name));
        }
        per_fixture.push((fixture.name.clone(), elapsed));
        assert!(
            out.iter().all(|c| !c.text.is_empty() && c.confidence.is_finite()),
            "{} produced an empty/NaN candidate",
            fixture.name
        );
    }

    assert!(top1_mismatch.is_empty(), "top-1 text diverged: {:?}", top1_mismatch);

    // steady-state: second pass over the same fixtures (sessions warm)
    let mut warm: Vec<Duration> = Vec::new();
    for fixture in &file.fixtures {
        let strokes = to_native(&fixture.strokes);
        let t0 = Instant::now();
        let _ = ocr_native_recognize(strokes).expect("warm call succeeds");
        warm.push(t0.elapsed());
    }

    let load_estimate = first_call.unwrap().as_secs_f64() * 1000.0 - warm.iter().map(|d| d.as_secs_f64() * 1000.0).sum::<f64>() / warm.len() as f64;
    let warm_min = warm.iter().min().unwrap().as_secs_f64() * 1000.0;
    let warm_avg = warm.iter().map(|d| d.as_secs_f64() * 1000.0).sum::<f64>() / warm.len() as f64;
    println!("\nnative ocr_native_recognize over {} fixtures:", file.fixtures.len());
    println!("  first call (model load + recognize): {:.1} ms", first_call.unwrap().as_secs_f64() * 1000.0);
    println!("  derived one-time load ≈ {load_estimate:.1} ms (first − warm avg)");
    println!("  warm calls: min {warm_min:.1} ms / avg {warm_avg:.1} ms");
    for (name, d) in &per_fixture {
        println!("    {name:<14} first {:.1} ms", d.as_secs_f64() * 1000.0);
    }
    let peak = peak_working_set_mb();
    if peak >= 0.0 {
        println!("  process peak working set: {peak:.1} MB");
    } else {
        println!("  process peak working set: not measured on this host");
    }
    assert!(first_call.unwrap().as_millis() < 10_000, "first call should stay well under 10 s");
}
