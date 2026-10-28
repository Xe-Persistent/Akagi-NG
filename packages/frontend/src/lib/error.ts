/**
 * An unknown rejection as the message a form can show. IPC failures arrive as
 * whatever the main process threw, which is not always an `Error`.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
