/** Session stays in memory; it is neither business data nor a voice credential. */
let session: { token: string; expiresAt: string } | null = null;
/** Thrown before any request is sent: there is no current write session. */
export class AppWriteSignInRequired extends Error {}
export function setAppWriteSession(value: typeof session) { session = value; }
/**
 * Storage correction (amendment r2 §2): the page loads the deployment's
 * activation id ONCE and echoes it on every write. It is never refreshed
 * within a page load, so a stale tab is refused ("reload") rather than writing
 * under a newer activation. A failed load is retried on the next write.
 */
let activation: string | null = null;
async function activationId(): Promise<string | null> {
  if (activation) return activation;
  try {
    const res = await fetch("/.netlify/functions/iaos-activation", { method: "GET", credentials: "same-origin" });
    const b = res.ok ? await res.json() : null;
    if (b && b.state === "open" && typeof b.activationId === "string" && b.deployId === b.runtimeDeployId) activation = b.activationId;
  } catch { /* the server refuses the write; nothing is sent */ }
  return activation;
}
export async function appWriteFetch(url: string, init: RequestInit): Promise<Response> {
  if (!session || Date.parse(session.expiresAt) <= Date.now()) {
    session = null;
    throw new AppWriteSignInRequired("Sign in for application writes before saving. Your edits have not been submitted.");
  }
  const echo = await activationId();
  const response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${session.token}`, ...(echo ? { "X-IAOS-Activation": echo } : {}) } });
  if (response.status === 401) session = null;
  return response;
}
