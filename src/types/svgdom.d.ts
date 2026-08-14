/**
 * Minimal ambient typings for svgdom (no published types). Structural-only —
 * svgdom's window/document objects are never used as real DOM in this codebase.
 */
declare module "svgdom" {
  export interface SvgdomWindow {
    document: {
      documentElement: unknown;
    };
  }
  export function createSVGWindow(): SvgdomWindow;
}
