/**
 * Lightweight client-side audit breadcrumb (console only).
 * Correlate with backend `X-Request-Id` / audit JSONL for OTP and auth failures.
 */
export type ClientAuditOutcome = 'ok' | 'fail' | 'warn' | 'info'

export function clientAudit(
  action: string,
  outcome: ClientAuditOutcome,
  meta: Record<string, unknown> = {}
): void {
  const entry = {
    ts: new Date().toISOString(),
    scope: 'client-audit',
    action,
    outcome,
    ...meta
  }
  if (outcome === 'fail') {
    console.warn('[audit]', entry)
  } else {
    console.info('[audit]', entry)
  }
}
