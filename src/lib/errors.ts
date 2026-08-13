/** Shared unknown-error formatting: the Error message, or a string coercion. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
