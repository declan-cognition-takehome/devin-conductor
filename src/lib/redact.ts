/**
 * Defence-in-depth redaction for anything derived from external systems before it is
 * logged, persisted as an error summary, or rendered.
 */

const PATTERNS: Array<[RegExp, string]> = [
  [/\bcog_[A-Za-z0-9_-]{8,}/g, 'cog_[REDACTED]'],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, 'gh*_[REDACTED]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, 'github_pat_[REDACTED]'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_KEY]'],
  [/\bsha256=[A-Fa-f0-9]{8,}/g, 'sha256=[REDACTED]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[REDACTED_JWT]'],
];

/** Values registered at runtime (configured secrets) that must never appear in output. */
const dynamicSecrets = new Set<string>();

export function registerSecret(value: string | undefined | null): void {
  if (value && value.trim().length >= 8) dynamicSecrets.add(value.trim());
}

export function redact(input: string): string {
  let output = input;
  for (const secret of dynamicSecrets) {
    output = output.split(secret).join('[REDACTED]');
  }
  for (const [pattern, replacement] of PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

export function redactUnknown(value: unknown): unknown {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactUnknown);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SENSITIVE_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : redactUnknown(v),
      ]),
    );
  }
  return value;
}

const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-hub-signature',
  'x-hub-signature-256',
  'password',
  'secret',
  'token',
  'access_token',
  'client_secret',
  'private_key',
  'api_key',
]);

/** Produces a short, safe, human-readable summary of an unknown error value. */
export function safeErrorSummary(error: unknown, maxLength = 500): string {
  const raw =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === 'string'
        ? error
        : (() => {
            try {
              return JSON.stringify(error);
            } catch {
              return String(error);
            }
          })();
  const cleaned = redact(raw).replace(/\s+/g, ' ').trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}
