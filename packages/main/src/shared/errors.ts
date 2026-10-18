/** Message from an error object that is safe to log or hand to the renderer. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
