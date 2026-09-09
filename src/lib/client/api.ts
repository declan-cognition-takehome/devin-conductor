'use client';

const CSRF_COOKIE = '__Host-conductor_csrf';
const CSRF_HEADER = 'x-conductor-csrf';

function csrfToken(): string {
  const match = document.cookie.split('; ').find((part) => part.startsWith(`${CSRF_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(CSRF_COOKIE.length + 1)) : '';
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return body as T;
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  return parse<T>(await fetch(url, { signal, credentials: 'same-origin' }));
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  return sendJson<T>('POST', url, body);
}

export async function patchJson<T>(url: string, body: unknown): Promise<T> {
  return sendJson<T>('PATCH', url, body);
}

async function sendJson<T>(method: string, url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', [CSRF_HEADER]: csrfToken() },
    body: JSON.stringify(body),
  });
  return parse<T>(response);
}
