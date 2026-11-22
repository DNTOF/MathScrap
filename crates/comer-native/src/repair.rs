//! Brace repair for a CoMER token list. Port of `src/ocr/comer/repair.ts`
//! (structural only — no DOM).

pub fn repair_latex(tokens: &[String]) -> Vec<String> {
    fix_sqrt_args(&fix_frac_args(&balance_braces(tokens)))
}

pub fn is_complete_expression(tokens: &[String]) -> bool {
    if tokens.is_empty() {
        return false;
    }
    if tokens.len() == 1 && (tokens[0] == "\\frac" || tokens[0] == "\\sqrt") {
        return false;
    }
    for i in 0..tokens.len() {
        if tokens[i] == "\\frac" && count_groups(&tokens[i + 1..]) < 2 {
            return false;
        }
        // JS: tokens[i+1] == null guards the \\sqrt case at the end of the list
        if tokens[i] == "\\sqrt" && count_groups(&tokens[i + 1..]) < 1 && i + 1 >= tokens.len() {
            return false;
        }
    }
    true
}

fn balance_braces(tokens: &[String]) -> Vec<String> {
    let mut result = Vec::new();
    let mut depth = 0usize;
    for t in tokens {
        if t == "{" {
            depth += 1;
            result.push(t.clone());
        } else if t == "}" {
            if depth > 0 {
                depth -= 1;
                result.push(t.clone());
            }
        } else {
            result.push(t.clone());
        }
    }
    for _ in 0..depth {
        result.push("}".to_string());
    }
    result
}

fn fix_frac_args(tokens: &[String]) -> Vec<String> {
    take_args(tokens, "\\frac", 2)
}

fn fix_sqrt_args(tokens: &[String]) -> Vec<String> {
    take_args(tokens, "\\sqrt", 1)
}

fn take_args(tokens: &[String], op: &str, n: usize) -> Vec<String> {
    let mut result = Vec::new();
    let mut i = 0usize;
    while i < tokens.len() {
        if tokens[i] != op {
            result.push(tokens[i].clone());
            i += 1;
            continue;
        }
        result.push(tokens[i].clone());
        i += 1;
        let mut groups = 0usize;
        while i < tokens.len() && groups < n {
            if tokens[i] == "{" {
                groups += 1;
                let mut depth = 1usize;
                result.push(tokens[i].clone());
                i += 1;
                while i < tokens.len() && depth > 0 {
                    if tokens[i] == "{" {
                        depth += 1;
                    } else if tokens[i] == "}" {
                        depth -= 1;
                    }
                    result.push(tokens[i].clone());
                    i += 1;
                }
            } else {
                result.push(tokens[i].clone());
                i += 1;
                groups += 1;
            }
        }
        while i < tokens.len() && tokens[i] == "{" {
            let mut depth = 1usize;
            i += 1;
            while i < tokens.len() && depth > 0 {
                if tokens[i] == "{" {
                    depth += 1;
                } else if tokens[i] == "}" {
                    depth -= 1;
                }
                i += 1;
            }
        }
    }
    result
}

fn count_groups(tokens: &[String]) -> usize {
    let mut groups = 0usize;
    let mut i = 0usize;
    while i < tokens.len() && tokens[i] == "{" {
        groups += 1;
        let mut depth = 1usize;
        i += 1;
        while i < tokens.len() && depth > 0 {
            if tokens[i] == "{" {
                depth += 1;
            } else if tokens[i] == "}" {
                depth -= 1;
            }
            i += 1;
        }
    }
    groups
}

#[cfg(test)]
mod tests {
    use super::*;

    fn toks(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn balance_adds_missing_closing_braces() {
        assert_eq!(balance_braces(&toks(&["a", "^", "{", "2"])), toks(&["a", "^", "{", "2", "}"]));
        assert_eq!(balance_braces(&toks(&["}", "x"])), toks(&["x"])); // stray } dropped
    }

    #[test]
    fn frac_gets_two_args() {
        assert_eq!(
            repair_latex(&toks(&["\\frac", "1", "2"])),
            toks(&["\\frac", "1", "2"])
        );
        assert_eq!(repair_latex(&toks(&["\\frac", "{", "1", "}", "2"])), toks(&["\\frac", "{", "1", "}", "2"]));
    }

    #[test]
    fn completeness_matches_ts() {
        assert!(!is_complete_expression(&toks(&["\\frac"])));
        assert!(!is_complete_expression(&toks(&["\\sqrt"])));
        assert!(is_complete_expression(&toks(&["a", "^", "{", "2", "}"])));
        assert!(!is_complete_expression(&toks(&["\\frac", "{", "1", "}"])));
    }
}
