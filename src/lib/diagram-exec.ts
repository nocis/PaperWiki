/**
 * Headless svg.js renderer — turns LLM-generated svg.js drawing code into a
 * self-contained SVG string.
 *
 * Execution model (verified 2026-08-14):
 * - svgdom provides a window/document for svg.js to attach to. A FRESH window
 *   is created per call, so no state bleeds between renders.
 * - The generated code must define a single `render(SVG, draw)` function. It
 *   runs in a node:vm sandbox that exposes ONLY the svg.js factory — no
 *   require/process/module access.
 * - The compile step AND the invocation step each go through
 *   vm.Script.runInContext with a timeout. vm's timeout only guards the
 *   script that contains the code, so calling render() from host code would
 *   let an infinite loop hang the process; invoking it inside runInContext
 *   keeps the interrupt armed ("Script execution timed out").
 * - svgdom's XML serializer rejects the root's namespace-unaware `xmlns`
 *   attribute (Invalid State Error), so it is removed before serialization;
 *   svg.js-injected `data-svgjs` metadata attributes are stripped as well.
 */
import vm from "node:vm";
import { registerWindow, SVG } from "@svgdotjs/svg.js";
import { createSVGWindow } from "svgdom";
import { embedMathInSvg } from "./svg-math";

const COMPILE_TIMEOUT_MS = 2000;
const INVOKE_TIMEOUT_MS = 2000;
const MAX_SVG_LENGTH = 64_000;
const MAX_ERROR_LENGTH = 500;

export type SvgExecResult = { ok: true; svg: string } | { ok: false; error: string };

/** Minimal shape of the svg.js root we drive — structural only. */
interface DrawRoot {
  node: Element & { removeAttribute(name: string): void };
  find(selector: string): { node: Element & { removeAttribute(name: string): void } }[];
  viewbox(): { x: number; y: number; width: number; height: number };
  viewbox(x: number, y: number, width: number, height: number): void;
  svg(): string;
}

function numAttr(el: Element, name: string): number | null {
  const v = el.getAttribute(name);
  if (v === null || v === "") return null;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * svgdom has no text layout, so getBBox cannot measure labels. Grow the
 * viewBox from element attributes instead (never shrink): every rect/line/
 * text contributes its max extent (text height estimated from font-size and
 * line count, baseline at y + descender allowance). A diagram whose lowest
 * label sits below the viewBox bottom is the #1 visual bug — this guarantees
 * the content fits without the LLM getting the layout right.
 */
function autofitViewBox(draw: DrawRoot): void {
  const vb = draw.viewbox();
  let maxX = vb.x + vb.width;
  let maxY = vb.y + vb.height;
  for (const el of draw.find("*")) {
    const n = el.node;
    const x = numAttr(n, "x");
    const y = numAttr(n, "y");
    let extX = 0;
    let extY = 0;
    if (n.tagName === "text") {
      const fontSize = numAttr(n, "font-size") ?? 16;
      const lines = (n.textContent ?? "").split("\n").length;
      extY = (y ?? 0) + fontSize * 1.15 * lines + fontSize * 0.35;
      extX = x ?? 0;
    } else {
      const w = numAttr(n, "width");
      const h = numAttr(n, "height");
      const x2 = numAttr(n, "x2");
      const y2 = numAttr(n, "y2");
      if (w !== null && h !== null) {
        extX = (x ?? 0) + w;
        extY = (y ?? 0) + h;
      } else if (x2 !== null || y2 !== null) {
        extX = x2 ?? 0;
        extY = y2 ?? 0;
      } else if (x !== null) {
        extX = x;
      }
      if (y !== null && h === null && y2 === null) extY = y;
    }
    if (extY > maxY) maxY = extY;
    if (extX > maxX) maxX = extX;
  }
  const overflowY = maxY - (vb.y + vb.height);
  const overflowX = maxX - (vb.x + vb.width);
  if (overflowY > 8 || overflowX > 8) {
    draw.viewbox(
      vb.x,
      vb.y,
      overflowX > 8 ? vb.width + overflowX + 20 : vb.width,
      overflowY > 8 ? vb.height + overflowY + 24 : vb.height
    );
  }
}

/**
 * Execute an LLM-written svg.js draw function and serialize the result.
 * Never throws — all failure modes return { ok: false, error }.
 */
export function executeSvgJsCode(code: string): SvgExecResult {
  const window = createSVGWindow();
  const document = window.document;
  // svgdom's window/document are not lib.dom instances; registerWindow only
  // reads them through svg.js's own lookups, so the cast is structural-only.
  registerWindow(window as unknown as Window, document as unknown as Document);

  const draw = SVG(document.documentElement as unknown as HTMLElement) as unknown as DrawRoot;

  try {
    const sandbox: Record<string, unknown> = { SVG, draw };
    const context = vm.createContext(sandbox);
    // Cross-realm bridge: object literals created inside the vm have the VM
    // realm's Object/Array as their `constructor`, which fails svg.js's
    // `attr.constructor === Object` dispatch checks — `.attr({...})` would
    // silently become a no-op. Point the realm prototypes' `constructor` at
    // the host constructors so svg.js handles sandbox-created objects.
    const realmObject = vm.runInContext("Object", context) as typeof Object;
    const realmArray = vm.runInContext("Array", context) as typeof Array;
    realmObject.prototype.constructor = Object;
    realmArray.prototype.constructor = Array;
    new vm.Script(`${code}\n;\nrender`, { filename: "diagram-render.js" }).runInContext(context, {
      timeout: COMPILE_TIMEOUT_MS,
    });
    new vm.Script("render(SVG, draw)", { filename: "diagram-invoke.js" }).runInContext(context, {
      timeout: INVOKE_TIMEOUT_MS,
    });
  } catch (err) {
    return { ok: false, error: truncateError(err instanceof Error ? err.message : String(err)) };
  }

  // svgdom's serializer throws "Invalid State Error" on the root's
  // namespace-unaware xmlns attribute — drop it before serializing.
  draw.node.removeAttribute("xmlns");
  // Text-positioning fix: svg.js creates <tspan> children that carry their OWN
  // x attribute (synced only by .move(), initial 0). When a label is positioned
  // via .attr({ x, y }) on the <text> element the tspan keeps x=0, and the
  // tspan's x OVERRIDES the text's x in rendering — every label collapses to
  // the left edge. Strip tspan x so each line inherits the <text> position
  // (dy stays, so multiline flow is unchanged).
  for (const el of draw.find("tspan")) el.node.removeAttribute("x");

  autofitViewBox(draw);

  let svg: string;
  try {
    svg = draw.svg();
  } catch (err) {
    return { ok: false, error: truncateError(err instanceof Error ? err.message : String(err)) };
  }

  // svg.js re-injects its `data-svgjs` metadata attributes during serialization
  // (writeDataToDom runs inside .svg()) — a pre-serialize strip is futile, so
  // scrub them from the final string.
  svg = svg.replace(/ data-svgjs="[^"]*"/g, "");

  if (!/^<svg[\s>]/i.test(svg)) return { ok: false, error: "renderer output is not an SVG (missing <svg> root)" };
  if (!/viewBox=/.test(svg)) return { ok: false, error: "renderer output has no viewBox — call draw.viewbox(0, 0, w, h)" };

  // Math in labels: replace text elements containing $...$ / \(...\) with
  // foreignObject-wrapped KaTeX MathML (real typeset math inside the SVG).
  svg = embedMathInSvg(svg);

  if (svg.length > MAX_SVG_LENGTH) {
    return { ok: false, error: `renderer output too large (${svg.length} chars, cap ${MAX_SVG_LENGTH})` };
  }
  return { ok: true, svg };
}

function truncateError(message: string): string {
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH)}…` : message;
}
