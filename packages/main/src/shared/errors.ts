/** 取出错误对象里适合写进日志/返回给渲染进程的消息 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
