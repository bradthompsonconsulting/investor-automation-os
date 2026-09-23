/** Google ID-token verification shared by the application write and read
 * authorities. Each caller supplies its OWN client id and allowlist; this
 * module holds no configuration and issues no session. */
export async function verifyGoogleIdToken(idToken: string, clientId: string, emails: string[], fetcher: typeof fetch = fetch, now = Date.now()) {
  const response = await fetcher(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!response.ok) throw new Error("Google identity verification failed");
  const c = await response.json();
  const email = typeof c.email === "string" ? c.email.toLowerCase() : "";
  if (!["accounts.google.com", "https://accounts.google.com"].includes(c.iss) || c.aud !== clientId || String(c.email_verified) !== "true" ||
      !Number.isFinite(Number(c.exp)) || Number(c.exp) <= now / 1000 || !emails.includes(email)) throw new Error("Google identity is not authorized");
  return email;
}
