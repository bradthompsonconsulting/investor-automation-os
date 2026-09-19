/** Session stays in memory; it is neither business data nor a voice credential. */
let session: { token: string; expiresAt: string } | null = null;
export function setAppWriteSession(value: typeof session) { session = value; }
export async function appWriteFetch(url: string, init: RequestInit): Promise<Response> {
  if (!session || Date.parse(session.expiresAt) <= Date.now()) {
    session = null;
    throw new Error("Sign in for application writes before saving. Your edits have not been submitted.");
  }
  const response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${session.token}` } });
  if (response.status === 401) session = null;
  return response;
}
