import type { InternalState, SecondaryOutcome, UiState } from '../db/types';

export interface StateInputs {
  internalState: InternalState;
  hasOpenPr: boolean;
  hasMergedPr: boolean;
  hasClosedUnmergedPr: boolean;
  issueClosed?: boolean;
  devinStatus?: string | null;
  devinStatusDetail?: string | null;
  dispatchExhausted?: boolean;
  anomaly?: boolean;
}

export interface MappedState {
  uiState: UiState;
  secondaryOutcome: SecondaryOutcome | null;
}

/** Devin v3 session statuses that are terminal for a session attempt. */
const TERMINAL_DEVIN_STATUSES = new Set(['exit', 'error', 'suspended', 'expired', 'blocked']);

export function isTerminalDevinStatus(status: string | null | undefined): boolean {
  return status ? TERMINAL_DEVIN_STATUSES.has(status.toLowerCase()) : false;
}

/**
 * Devin keeps a session `running` while it waits on a human reply, so the detail field is the
 * only signal that the session has stopped making progress on its own.
 */
const AWAITING_INPUT_DETAILS = new Set(['waiting_for_user', 'waiting_for_input', 'blocked']);

export function isAwaitingInputDetail(detail: string | null | undefined): boolean {
  return detail ? AWAITING_INPUT_DETAILS.has(detail.toLowerCase()) : false;
}

/**
 * Maps detailed internal state plus business facts to the user-facing states.
 * Business outcomes (an open or merged PR) always take precedence over raw session state.
 */
export function mapUiState(input: StateInputs): MappedState {
  if (input.internalState === 'ignored') {
    return { uiState: 'ignored', secondaryOutcome: null };
  }
  if (input.hasMergedPr) {
    return { uiState: 'merged', secondaryOutcome: null };
  }
  // Conductor never closes an issue, so a closed issue is a human resolving the task.
  if (input.issueClosed) {
    return { uiState: 'closed', secondaryOutcome: null };
  }
  if (input.hasOpenPr) {
    return { uiState: 'pr_ready', secondaryOutcome: null };
  }
  if (input.anomaly) {
    return { uiState: 'needs_attention', secondaryOutcome: 'anomaly' };
  }
  if (input.dispatchExhausted || input.internalState === 'failed') {
    return { uiState: 'needs_attention', secondaryOutcome: 'dispatch_exhausted' };
  }

  const devinStatus = input.devinStatus?.toLowerCase() ?? null;
  if (devinStatus === 'error') {
    return { uiState: 'needs_attention', secondaryOutcome: 'devin_error' };
  }
  if (devinStatus === 'suspended' || devinStatus === 'blocked') {
    return { uiState: 'needs_attention', secondaryOutcome: 'devin_suspended' };
  }
  if (devinStatus === 'expired') {
    return { uiState: 'needs_attention', secondaryOutcome: 'externally_cancelled' };
  }
  if (isAwaitingInputDetail(input.devinStatusDetail)) {
    return { uiState: 'needs_attention', secondaryOutcome: 'awaiting_input' };
  }
  if (devinStatus === 'exit' || input.internalState === 'session_terminal') {
    return {
      uiState: 'needs_attention',
      secondaryOutcome: input.hasClosedUnmergedPr ? 'pr_closed_unmerged' : 'completed_without_pr',
    };
  }
  if (input.internalState === 'running' || input.internalState === 'dispatching') {
    return { uiState: 'working', secondaryOutcome: null };
  }
  return { uiState: 'queued', secondaryOutcome: null };
}

export const UI_STATE_LABELS: Record<UiState, string> = {
  queued: 'Queued',
  working: 'Working',
  pr_ready: 'PR ready',
  merged: 'Merged',
  needs_attention: 'Needs attention',
  closed: 'Issue closed',
  ignored: 'Ignored',
};

export const SECONDARY_OUTCOME_LABELS: Record<SecondaryOutcome, string> = {
  completed_without_pr: 'Completed without PR',
  pr_closed_unmerged: 'PR closed without merge',
  externally_cancelled: 'Externally cancelled',
  dispatch_exhausted: 'Dispatch retries exhausted',
  devin_error: 'Devin session errored',
  devin_suspended: 'Devin session suspended',
  awaiting_input: 'Waiting on a human reply',
  anomaly: 'Anomaly — needs review',
};
