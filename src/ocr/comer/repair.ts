/** Brace repair for a CoMER token list. Structural only — no DOM. */

export function repairLatex(tokens: string[]): string[] {
  return fixSqrtArgs(fixFracArgs(balanceBraces(tokens)))
}

export function isCompleteExpression(tokens: string[]): boolean {
  if (!tokens.length) return false
  if (tokens.length === 1 && (tokens[0] === '\\frac' || tokens[0] === '\\sqrt')) return false
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '\\frac' && countGroups(tokens.slice(i + 1)) < 2) return false
    if (tokens[i] === '\\sqrt' && countGroups(tokens.slice(i + 1)) < 1 && tokens[i + 1] == null) return false
  }
  return true
}

function balanceBraces(tokens: string[]): string[] {
  const result: string[] = []
  let depth = 0
  for (const t of tokens) {
    if (t === '{') {
      depth++
      result.push(t)
    } else if (t === '}') {
      if (depth > 0) {
        depth--
        result.push(t)
      }
    } else result.push(t)
  }
  while (depth > 0) {
    result.push('}')
    depth--
  }
  return result
}

function fixFracArgs(tokens: string[]): string[] {
  return takeArgs(tokens, '\\frac', 2)
}

function fixSqrtArgs(tokens: string[]): string[] {
  return takeArgs(tokens, '\\sqrt', 1)
}

function takeArgs(tokens: string[], op: string, n: number): string[] {
  const result: string[] = []
  let i = 0
  while (i < tokens.length) {
    if (tokens[i] !== op) {
      result.push(tokens[i])
      i++
      continue
    }
    result.push(tokens[i])
    i++
    let groups = 0
    while (i < tokens.length && groups < n) {
      if (tokens[i] === '{') {
        groups++
        let depth = 1
        result.push(tokens[i])
        i++
        while (i < tokens.length && depth > 0) {
          if (tokens[i] === '{') depth++
          else if (tokens[i] === '}') depth--
          result.push(tokens[i])
          i++
        }
      } else {
        result.push(tokens[i])
        i++
        groups++
      }
    }
    while (i < tokens.length && tokens[i] === '{') {
      let depth = 1
      i++
      while (i < tokens.length && depth > 0) {
        if (tokens[i] === '{') depth++
        else if (tokens[i] === '}') depth--
        i++
      }
    }
  }
  return result
}

function countGroups(tokens: string[]): number {
  let groups = 0
  let i = 0
  while (i < tokens.length && tokens[i] === '{') {
    groups++
    let depth = 1
    i++
    while (i < tokens.length && depth > 0) {
      if (tokens[i] === '{') depth++
      else if (tokens[i] === '}') depth--
      i++
    }
  }
  return groups
}
