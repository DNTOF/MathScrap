/**
 * Models often write `b = (1, 2)`. On this sheet a vector is bold and uses `=`,
 * so rewrite that spelling before it hits the paper. Parentheses without a comma
 * stay untouched (`y = (x + 1)` is not a vector).
 */
export function emphasizeVectors(text: string): string {
  return text.replace(/(^|[\n;,])([ \t]*)([a-z](?:_\w+)?)([ \t]*=[ \t]*)(\([^()\n]*\))/g, (full, lead: string, space: string, name: string, eq: string, tuple: string) => {
    if (!tuple.includes(',')) return full
    return `${lead}${space}**${name}**${eq}${tuple}`
  })
}
