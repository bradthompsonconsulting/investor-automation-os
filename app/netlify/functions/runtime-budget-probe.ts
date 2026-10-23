/**
 * Runtime-budget probe (B15-26 B1). TEMPORARY, TEST ONLY: removed after one
 * authorized invocation.
 *
 * GET only. Reports the remaining execution budget the runtime states at the
 * moment of observation, via context.getRemainingTimeInMillis(). That is NOT
 * the exact configured timeout and NOT a guaranteed HTTP limit: it excludes
 * time already spent before the handler ran, and says nothing about any
 * edge, proxy or browser limit.
 *
 * Order (the first refusal ends the request):
 *   IAOS_ENV not exactly "test" -> 404, before the runtime context is examined
 *   method not GET -> 405
 *   observe the budget once -> 200 { available, remainingMs }
 * A missing, throwing, non-finite or negative result is available:false.
 *
 * No authentication, credentials, provider requests, request-body
 * processing, sleeps or logging.
 */

const json = (statusCode: number, data: unknown) => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(data) });

export function observeRemainingBudget(context: unknown): { available: true; remainingMs: number } | { available: false; remainingMs: null } {
  try {
    const read = (context as { getRemainingTimeInMillis?: unknown } | null)?.getRemainingTimeInMillis;
    if (typeof read !== "function") return { available: false, remainingMs: null };
    const value = read.call(context);
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return { available: false, remainingMs: null };
    return { available: true, remainingMs: value };
  } catch {
    return { available: false, remainingMs: null };
  }
}

export const handler = async (event: any, context: any) => {
  if (process.env.IAOS_ENV !== "test") return json(404, { error: "Not found" });
  if (event?.httpMethod !== "GET") return json(405, { error: "Method not allowed" });
  return json(200, observeRemainingBudget(context));
};
