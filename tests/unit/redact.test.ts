import { describe, expect, it } from 'vitest';
import { redact, redactUnknown, registerSecret, safeErrorSummary } from '@/lib/redact';

describe('redact', () => {
  it('removes Devin service-user credentials', () => {
    expect(redact('key cog_abcdefgh12345678 used')).toBe('key cog_[REDACTED] used');
  });

  it('removes GitHub tokens and app private keys', () => {
    expect(redact('ghp_abcdefghijklmnopqrstuvwxyz012345')).toBe('gh*_[REDACTED]');
    expect(redact('-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----')).toBe(
      '[REDACTED_KEY]',
    );
  });

  it('removes webhook signatures, bearer tokens and JWTs', () => {
    expect(redact('sha256=deadbeefdeadbeef')).toBe('sha256=[REDACTED]');
    expect(redact('Authorization: Bearer abcdefgh12345678')).toBe(
      'Authorization: Bearer [REDACTED]',
    );
    expect(redact('eyJhbGciOiJIUzI1.eyJzdWIiOiIx.abcdefgh')).toBe('[REDACTED_JWT]');
  });

  it('removes dynamically registered secrets', () => {
    registerSecret('super-secret-runtime-value');
    expect(redact('token=super-secret-runtime-value')).toBe('token=[REDACTED]');
  });

  it('masks sensitive object keys without inspecting their values', () => {
    expect(
      redactUnknown({ authorization: 'anything', nested: { token: 'x' }, keep: 'visible' }),
    ).toEqual({ authorization: '[REDACTED]', nested: { token: '[REDACTED]' }, keep: 'visible' });
  });

  it('summarises errors safely and bounds their length', () => {
    const summary = safeErrorSummary(new Error('failed with cog_abcdefgh12345678'));
    expect(summary).toBe('Error: failed with cog_[REDACTED]');
    expect(safeErrorSummary('x'.repeat(1000)).length).toBeLessThanOrEqual(500);
  });
});
