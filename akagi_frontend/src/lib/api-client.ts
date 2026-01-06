import i18n from '@/i18n/i18n';
import type { ApiResponse } from '@/types';

export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function fetchJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, options);
  } catch {
    throw new ApiError(i18n.t('app.connect_failed'));
  }

  const contentType = res.headers.get('content-type');
  let body: ApiResponse<unknown> | unknown;

  // Try to parse JSON if content-type says so
  if (contentType && contentType.includes('application/json')) {
    try {
      body = await res.json();
    } catch {
      throw new ApiError(i18n.t('app.config_error') + ` (${res.status})`, res.status);
    }
  } else {
    // Handle non-JSON response (likely 404/500 plain text)
    await res.text().catch(() => '');

    // Provide user-friendly messages for common status codes
    if (res.status === 404) {
      throw new ApiError(
        i18n.t('app.api_not_found') || `API Not Found (${res.status})`,
        res.status,
      );
    }
    if (res.status >= 500) {
      throw new ApiError(i18n.t('app.server_error') || `Server Error (${res.status})`, res.status);
    }

    throw new ApiError(`Request failed (${res.status} ${res.statusText})`, res.status);
  }

  // Check application-level success (Akagi API envelope)
  // The API seems to return { ok: true, data: ... } or { ok: false, error: ... }
  // If we parsed JSON successfully, look for 'ok' field.
  if (body && typeof body === 'object') {
    const apiBody = body as ApiResponse<unknown>;
    if ('ok' in apiBody && !apiBody.ok) {
      throw new ApiError(apiBody.error || 'Unknown API error', res.status);
    }
    // Return 'data' if it exists, otherwise return the whole body
    // useSettings expects body.data.
    // let's stick to returning body.data if the shape matches ApiResponse<T>
    if ('data' in apiBody) {
      return apiBody.data as T;
    }
    // Fallback: return the whole body logic is context dependent.
    // But for Akagi, it seems consistent.
  }

  if (!res.ok) {
    throw new ApiError(`Request failed (${res.status})`, res.status);
  }

  return body as T;
}
