export const FIGMA_INDEX_STATUS = {
  PENDING: 'pending',
  OK: 'ok',
  ERROR: 'error',
  RATE_LIMITED: 'rate_limited',
} as const;

export const FIGMA_WEBHOOK_PROCESS_STATUS = {
  PENDING: 'pending',
  OK: 'ok',
  ERROR: 'error',
  IGNORED: 'ignored',
} as const;

export const FIGMA_SYNC_SCOPE_TYPE = {
  BOOTSTRAP: 'bootstrap',
  TEAM: 'team',
  PROJECT: 'project',
  FILE: 'file',
  RECONCILE: 'reconcile',
  WEBHOOK: 'webhook',
} as const;

export const FIGMA_SYNC_TRIGGER = {
  STARTUP: 'startup',
  INTERVAL: 'interval',
  MANUAL: 'manual',
  WEBHOOK: 'webhook',
} as const;

export const FIGMA_SYNC_STATUS = {
  RUNNING: 'running',
  OK: 'ok',
  ERROR: 'error',
  PARTIAL: 'partial',
} as const;

export const DEFAULT_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;
