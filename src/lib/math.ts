/**
 * Wrap BARE LaTeX in $...$ so math typesets even when the source text lacks
 * delimiters (e.g. figure/diagram captions written before the $...$ rule).
 * Runs containing a backslash command, `_`, or `^` — bounded by
 * whitespace/sentence punctuation/dashes — get wrapped; already-delimited
 * math is left untouched.
 *
 * App-safe (no node-only imports): shared by both server and client code
 * (figure captions + diagram captions).
 */
export function wrapBareMath(text: string): string {
  const marker = /(?:\\[a-zA-Z]+|[_^])/;
  return text
    .split(/(\$\$?[\s\S]*?\$\$?)/g)
    .map((part) => {
      if (part.startsWith("$")) return part;
      if (!marker.test(part)) return part;
      return part.replace(
        /[^\s,.;:!?()\[\]"'“”’—–]*(?:\\[a-zA-Z]+|[_^])[^\s,.;:!?()\[\]"'“”’—–]*/g,
        (run) => `$${run}$`
      );
    })
    .join("");
}