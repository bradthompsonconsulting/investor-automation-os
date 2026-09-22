/**
 * The exact, narrow deploy-preview origin shape Netlify assigns the
 * `iaos-app-test` site for a pull request: `deploy-preview-<PR
 * number>--iaos-app-test.netlify.app`, https only. Anchored full-string
 * match (`^...$`) -- never a prefix/suffix/substring test -- so no
 * lookalike host, extra path/port/credential, or sibling site
 * (`iaos-app`, `investor-automation-os`) can ever satisfy it. Exported so
 * it can be asserted directly, the same way `IAOS_APP_WRITE_ALLOWED_ORIGIN`
 * itself is asserted against `valid()` below.
 */
export const IAOS_APP_TEST_DEPLOY_PREVIEW_ORIGIN = /^https:\/\/deploy-preview-[1-9][0-9]*--iaos-app-test\.netlify\.app$/;

/** Exact browser Origin boundary; authentication remains a separate gate. */
export function requireAppWriteOrigin(event: any, env = process.env): void {
  const configured = env.IAOS_APP_WRITE_ALLOWED_ORIGIN;
  function valid(value: unknown): value is string {
    if (typeof value !== "string" || !value) return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.origin === value &&
        !url.username && !url.password && !value.includes("*");
    } catch { return false; }
  }
  if (!valid(configured)) throw new Error("Write origin is not configured");
  const entries = Object.entries(event.headers ?? {})
    .filter(([name]) => name.toLowerCase() === "origin");
  if (entries.length !== 1) throw new Error("One Origin is required");
  const origin = entries[0][1];
  // B9-13 gate-review closure -- PR #85 deploy-preview blocker. The
  // explicitly configured origin remains the primary, unconditional
  // path. A Test-only, narrowly-shaped EXCEPTION additionally accepts
  // the dedicated `iaos-app-test` site's own deploy-preview subdomain --
  // never any other Netlify site, never Production (env.IAOS_ENV must be
  // exactly "test"), never a substring/prefix/suffix match.
  const isConfiguredOrigin = valid(origin) && origin === configured;
  const isTestDeployPreview = env.IAOS_ENV === "test" && valid(origin) && IAOS_APP_TEST_DEPLOY_PREVIEW_ORIGIN.test(origin);
  if (!isConfiguredOrigin && !isTestDeployPreview) {
    throw new Error("Write origin refused");
  }
  const multi = Object.entries(event.multiValueHeaders ?? {})
    .filter(([name]) => name.toLowerCase() === "origin");
  if (multi.length > 1 || (multi.length === 1 &&
      (!Array.isArray(multi[0][1]) || multi[0][1].length !== 1 ||
       multi[0][1][0] !== origin))) {
    throw new Error("Ambiguous Origin");
  }
}
