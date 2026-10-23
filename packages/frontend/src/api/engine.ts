import type { EngineStatus } from '@/types';

/** The engine's current status, for a window that opens mid-session. */
export function fetchEngineStatus(): Promise<EngineStatus> {
  return window.electron.invoke<EngineStatus>('engine:status:get');
}
