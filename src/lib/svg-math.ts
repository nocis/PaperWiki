/**
 * Math inside SVG diagram labels.
 *
 * svg.js draws labels as <text>/<tspan> elements; LaTeX does not render
 * there. After the svg.js code executes, the serialized SVG is post-processed:
 * any text element whose content contains $...$ (or \(...\)) math is replaced
 * by a <foreignObject> wrapping the MathML that KaTeX produces. The diagram
 * is therefore displayed via <object> (foreignObject content is not painted
 * when an SVG is shown through <img>).
 *
 * mathToUnicode() is the fallback for contexts where MathML is not wanted —
 * it converts common LaTeX to Unicode glyphs (x_{t-1} -> xₜ₋₁) instead.
 */
import katex from "katex";

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** True when the label contains a $...$ or \(...\) math run. */
export function hasMath(text: string): boolean {
  return /\$[^$\n]+\$|\\\([^()\n]+\\\)/.test(text);
}

/** Split a label into alternating {tex} math runs and {text} plain runs. */
export function splitMath(text: string): { tex: string | null; text: string }[] {
  const re = /\$([^$\n]+)\$|\\\(([^()\n]+)\\\)/g;
  const out: { tex: string | null; text: string }[] = [];
  let last = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index > last) out.push({ tex: null, text: text.slice(last, m.index) });
    out.push({ tex: m[1] ?? m[2] ?? "", text: "" });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ tex: null, text: text.slice(last) });
  if (out.length === 0) out.push({ tex: null, text });
  return out;
}

/** KaTeX MathML for a LaTeX run (inline), without the <span class="katex"> wrapper. */
export function mathToMathML(tex: string): string {
  const html = katex.renderToString(tex, { output: "mathml", throwOnError: false, strict: false });
  const m = html.match(/<math[\s\S]*<\/math>/);
  return m ? m[0] : escapeXml(tex);
}

function estimateWidth(segments: { tex: string | null; text: string }[]): number {
  let width = 0;
  for (const s of segments) {
    width += s.tex !== null ? Math.min(300, 20 + s.tex.length * 9) : s.text.length * 7.2;
  }
  return Math.min(720, Math.max(60, Math.ceil(width)));
}

function attrValue(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
}

/**
 * Replace <text>...</text> blocks containing math with <foreignObject> wrappers
 * carrying KaTeX MathML. Operates on the SERIALIZED svg.js output (single-line
 * labels render as one tspan, so the whole text element becomes one
 * foreignObject positioned at the text's x/y). Plain runs stay as escaped text
 * next to the inline <math> elements.
 */
export function embedMathInSvg(svg: string): string {
  if (!hasMath(svg)) return svg;
  return svg.replace(/<text\b([^>]*)>([\s\S]*?)<\/text>/g, (full, attrs: string, inner: string) => {
    const content = inner.replace(/<tspan\b[^>]*>|<\/tspan>/g, "");
    if (!hasMath(content)) return full;
    const segments = splitMath(content);
    const x = attrValue(attrs, "x") ?? "0";
    const y = attrValue(attrs, "y") ?? "0";
    const fill = attrValue(attrs, "fill") ?? "#000000";
    const width = estimateWidth(segments);
    const body = segments.map((s) => (s.tex !== null ? mathToMathML(s.tex) : escapeXml(s.text))).join("");
    // Baseline sits at the text's y; lift the foreignObject so the math sits
    // where the label did.
    return (
      `<foreignObject x="${x}" y="${Number(y) - 14}" width="${width}" height="40">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" style="color:${fill};font-family:sans-serif;font-size:13px;line-height:1.3">` +
      body +
      `</div></foreignObject>`
    );
  });
}

// ---------------------------------------------------------------------------
// Unicode fallback (mathToUnicode) — used when MathML is not an option.
// ---------------------------------------------------------------------------

const SUB_MAP: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "(": "₍", ")": "₎", "=": "₌",
  a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ",
  r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
};

const SUP_MAP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "(": "⁽", ")": "⁾", "=": "⁼",
  a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ", i: "ⁱ", j: "ʲ", k: "ᵏ", l: "ˡ",
  m: "ᵐ", n: "ⁿ", o: "ᵒ", p: "ᵖ", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ",
};

const GREEK_MAP: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", zeta: "ζ", eta: "η", theta: "θ",
  iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ",
  tau: "τ", phi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Delta: "Δ", Gamma: "Γ", Lambda: "Λ", Sigma: "Σ", Theta: "Θ", Omega: "Ω", Phi: "Φ", Psi: "Ψ",
};

function mapChars(text: string, map: Record<string, string>): string {
  return [...text].map((ch) => map[ch] ?? ch).join("");
}

function convertRun(inner: string): string {
  return inner
    .replace(/\^\{([^}]*)\}/g, (_, g: string) => mapChars(g, SUP_MAP))
    .replace(/_\{([^}]*)\}/g, (_, g: string) => mapChars(g, SUB_MAP))
    .replace(/\^([0-9a-zA-Z+\-()=])/g, (_, ch: string) => mapChars(ch, SUP_MAP))
    .replace(/_([0-9a-zA-Z+\-()=])/g, (_, ch: string) => mapChars(ch, SUB_MAP))
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, (_, n: string, d: string) => `${convertRun(n)}⁄${convertRun(d)}`)
    .replace(/\\sqrt\{([^}]*)\}/g, (_, r: string) => `√${convertRun(r)}`);
}

/** Best-effort LaTeX -> Unicode conversion for SVG labels (fallback path). */
export function mathToUnicode(text: string): string {
  const out = text
    .replace(/\$\$([^$]+)\$\$|\$([^$]+)\$|\\\(([^()]+)\\\)/g, (_, a?: string, b?: string, c?: string) =>
      convertRun((a ?? b ?? c ?? "").trim())
    )
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, (_, n: string, d: string) => `${convertRun(n)}⁄${convertRun(d)}`)
    .replace(/\\sqrt\{([^}]*)\}/g, (_, r: string) => `√${convertRun(r)}`)
    .replace(/\\cdot/g, "·")
    .replace(/\\times/g, "×")
    .replace(/\\approx/g, "≈")
    .replace(/\\le|\\leq/g, "≤")
    .replace(/\\ge|\\geq/g, "≥")
    .replace(/\\neq/g, "≠")
    .replace(/\\infty/g, "∞")
    .replace(/\\in/g, "∈")
    .replace(/\\sum/g, "∑")
    .replace(/\\prod/g, "∏")
    .replace(/\\rightarrow|\\to/g, "→")
    .replace(/\\left|\\right/g, "")
    .replace(/\\text\{([^}]*)\}/g, "$1");
  return out.replace(/\\[a-zA-Z]+\b/g, (cmd) => GREEK_MAP[cmd.slice(1)] ?? "").replace(/[{}]/g, "").trim();
}
