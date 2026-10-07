/** Session stays in memory; it is neither business data nor a voice credential. */
let session: { token: string; expiresAt: string } | null = null;
/** Thrown before any request is sent: there is no current write session. */
export class AppWriteSignInRequired extends Error {}
export function setAppWriteSession(value: typeof session) { session = value; }
/**
 * Storage correction (amendment r2 §2; Bones review finding 7): the page is
 * BOUND to the deployment's activation ONCE -- when read sign-in first succeeds
 * on this page load, before any edit or save is possible (Layout calls
 * `bindPageActivation`). Every write echoes that original id. The binding is
 * never refreshed and never retried within the page load, and write-session
 * recovery keeps it: a page that has not written yet can therefore never adopt
 * a later activation. An unbound page -- including one whose binding failed --
 * refuses to send anything and asks for a reload.
 */
type Binding = { state: "unbound" } | { state: "binding"; done: Promise<void> } | { state: "bound"; activationId: string } | { state: "failed" };
let binding: Binding = { state: "unbound" };
/** The page is out of date or not bound to an activation: reload. Nothing was sent. */
export class AppWritePageStale extends AppWriteSignInRequired {}
export const PAGE_STALE_MESSAGE = "This page is out of date for saving — reload it. Your edits have not been submitted.";
export function pageActivation(): Binding["state"] { return binding.state; }
/** Idempotent: only the FIRST call on a page load reads the activation. */
export function bindPageActivation(fetcher: typeof fetch = fetch): Promise<void> {
  if (binding.state === "binding") return binding.done;
  if (binding.state !== "unbound") return Promise.resolve();
  const done = (async () => {
    try {
      const res = await fetcher("/.netlify/functions/iaos-activation", { method: "GET", credentials: "same-origin" });
      const b = res.ok ? await res.json() : null;
      binding = b && b.state === "open" && typeof b.activationId === "string" && b.deployId === b.runtimeDeployId
        ? { state: "bound", activationId: b.activationId }
        : { state: "failed" };
    } catch { binding = { state: "failed" }; }
  })();
  binding = { state: "binding", done };
  return done;
}
export async function appWriteFetch(url: string, init: RequestInit): Promise<Response> {
  if (!session || Date.parse(session.expiresAt) <= Date.now()) {
    session = null;
    throw new AppWriteSignInRequired("Sign in for application writes before saving. Your edits have not been submitted.");
  }
  if (binding.state === "binding") await binding.done;
  if (binding.state !== "bound") throw new AppWritePageStale(PAGE_STALE_MESSAGE);
  const response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${session.token}`, "X-IAOS-Activation": binding.activationId } });
  if (response.status === 401) session = null;
  return response;
}
