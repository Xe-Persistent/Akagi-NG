import type { ApiResponse } from '@/types';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let baseUrl = '';

export function setBaseUrl(url: string) {
  baseUrl = url;
}

export async function fetchJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`;
  let res: Response;
  try {
    res = await fetch(fullUrl, options);
  } catch {
    throw new ApiError('connect_failed', 'Failed to connect to server');
  }

  const contentType = res.headers.get('content-type');
  let body: ApiResponse<unknown> | unknown;

  // 尝试解析 JSON 响应
  if (contentType && contentType.includes('application/json')) {
    try {
      body = await res.json();
    } catch {
      throw new ApiError(
        'config_error',
        `Failed to parse JSON response (${res.status})`,
        res.status,
      );
    }
  } else {
    // 处理非 JSON 响应（可能是 404/500 等错误页面）
    await res.text().catch(() => '');

    // 常见状态码的友好提示
    if (res.status === 404) {
      throw new ApiError('api_not_found', 'API endpoint not found', res.status);
    }
    if (res.status >= 500) {
      throw new ApiError('server_error', 'Internal server error', res.status);
    }

    throw new ApiError(
      'request_failed',
      `Request failed (${res.status} ${res.statusText})`,
      res.status,
    );
  }

  // 检查 API 层面的成功状态
  if (body && typeof body === 'object') {
    const apiBody = body as ApiResponse<unknown>;
    if ('ok' in apiBody && !apiBody.ok) {
      throw new ApiError('api_error', apiBody.error || 'Server reported an error', res.status);
    }
    // 如果存在 data 字段则返回，否则返回整个 body
    if ('data' in apiBody) {
      return apiBody.data as T;
    }
  }

  if (!res.ok) {
    throw new ApiError('request_failed', `HTTP error ${res.status}`, res.status);
  }

  return body as T;
}
