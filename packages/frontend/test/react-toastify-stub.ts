/**
 * Stand-in for `react-toastify`, aliased in by `vitest.config.ts` for the
 * frontend unit project. It records what would have been shown, so the wrapper
 * in `lib/notify.ts` can be checked without a React tree or a DOM.
 */
import type { Id, ToastOptions, UpdateOptions } from 'react-toastify';

export interface RecordedToast {
  kind: 'success' | 'error' | 'info' | 'warn' | 'loading' | 'show' | 'update' | 'dismiss';
  message?: string;
  id?: Id;
  options?: ToastOptions | UpdateOptions;
}

const calls: RecordedToast[] = [];

const record =
  (kind: RecordedToast['kind']) =>
  (message: string, options?: ToastOptions): Id => {
    calls.push({ kind, message, options });
    return calls.length;
  };

export const toast = Object.assign(
  (message: string, options?: ToastOptions) => record('show')(message, options),
  {
    calls,
    success: record('success'),
    error: record('error'),
    info: record('info'),
    warn: record('warn'),
    loading: record('loading'),
    update: (id: Id, options: UpdateOptions) => {
      calls.push({ kind: 'update', id, options });
    },
    dismiss: (id?: Id) => {
      calls.push({ kind: 'dismiss', id });
    },
  },
);

export default { toast };
