import { describe, expect, it } from 'vitest';
import { isTerminalDevinStatus, mapUiState } from '@/lib/tasks/state';

const base = {
  internalState: 'running' as const,
  hasOpenPr: false,
  hasMergedPr: false,
  hasClosedUnmergedPr: false,
};

describe('mapUiState', () => {
  it('prefers a merged PR over any session status', () => {
    expect(
      mapUiState({ ...base, hasMergedPr: true, hasOpenPr: true, devinStatus: 'error' }),
    ).toEqual({ uiState: 'merged', secondaryOutcome: null });
  });

  it('prefers an open PR over a failed or errored session', () => {
    expect(mapUiState({ ...base, hasOpenPr: true, devinStatus: 'error' })).toEqual({
      uiState: 'pr_ready',
      secondaryOutcome: null,
    });
  });

  it('classifies a clean exit without a PR', () => {
    expect(mapUiState({ ...base, devinStatus: 'exit' })).toEqual({
      uiState: 'needs_attention',
      secondaryOutcome: 'completed_without_pr',
    });
  });

  it('classifies an exit whose PR was closed unmerged', () => {
    expect(mapUiState({ ...base, devinStatus: 'exit', hasClosedUnmergedPr: true })).toEqual({
      uiState: 'needs_attention',
      secondaryOutcome: 'pr_closed_unmerged',
    });
  });

  it.each([
    ['error', 'devin_error'],
    ['suspended', 'devin_suspended'],
    ['blocked', 'devin_suspended'],
    ['expired', 'externally_cancelled'],
  ])('maps devin status %s', (status, outcome) => {
    expect(mapUiState({ ...base, devinStatus: status })).toEqual({
      uiState: 'needs_attention',
      secondaryOutcome: outcome,
    });
  });

  it('reports exhausted dispatch and anomalies', () => {
    expect(mapUiState({ ...base, dispatchExhausted: true }).secondaryOutcome).toBe(
      'dispatch_exhausted',
    );
    expect(mapUiState({ ...base, anomaly: true }).secondaryOutcome).toBe('anomaly');
  });

  it('keeps ignored tasks ignored', () => {
    expect(mapUiState({ ...base, internalState: 'ignored', devinStatus: 'error' })).toEqual({
      uiState: 'ignored',
      secondaryOutcome: null,
    });
  });

  it('reports running and queued work', () => {
    expect(mapUiState({ ...base, devinStatus: 'running' }).uiState).toBe('working');
    expect(mapUiState({ ...base, internalState: 'queued' }).uiState).toBe('queued');
  });
});

describe('isTerminalDevinStatus', () => {
  it.each(['exit', 'error', 'suspended', 'expired', 'blocked'])(
    'treats %s as terminal',
    (status) => {
      expect(isTerminalDevinStatus(status)).toBe(true);
    },
  );

  it.each(['new', 'claimed', 'running', 'resuming', null, undefined])(
    'treats %s as non-terminal',
    (status) => {
      expect(isTerminalDevinStatus(status)).toBe(false);
    },
  );
});
