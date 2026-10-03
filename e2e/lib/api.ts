import { ENV } from './env';

export interface ApiResult<T = any> {
  status: number;
  body: any;
  data: T;
  ms: number;
  headers: Headers;
}

export interface ApiOpts {
  token?: string;
  apiKey?: string;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/** Thin fetch wrapper; never throws on HTTP errors so tests can assert the status. */
export async function api<T = any>(method: string, path: string, opts: ApiOpts = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { accept: 'application/json', ...(opts.headers || {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
  let body: string | undefined;
  if (opts.rawBody !== undefined) {
    body = opts.rawBody;
    headers['content-type'] ??= 'application/json';
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers['content-type'] = 'application/json';
  }
  const url = path.startsWith('http') ? path : `${ENV.API}${path}`;
  const t0 = performance.now();
  let res: Response;
  let text: string;
  try {
    res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000) });
    text = await res.text();
  } catch (e: any) {
    // timeout / network failure is reported as status 0 so callers can assert on it
    return { status: 0, body: `request failed: ${e?.name || e}`, data: undefined as T, ms: performance.now() - t0, headers: new Headers() };
  }
  const ms = performance.now() - t0;
  let json: any = text;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    /* keep raw text */
  }
  return { status: res.status, body: json, data: json?.data as T, ms, headers: res.headers };
}

/** Formats a request/response pair as plain text for proof files. */
export function proofLine(label: string, method: string, path: string, r: ApiResult, reqBody?: unknown) {
  return [
    `### ${label}`,
    `${method} ${path}${reqBody !== undefined ? `\n${JSON.stringify(reqBody)}` : ''}`,
    `-> HTTP ${r.status}`,
    typeof r.body === 'string' ? r.body : JSON.stringify(r.body),
    '',
  ].join('\n');
}
