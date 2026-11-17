/**
 * The "nothing was sent" error, in its own module so lib/protected-lane.ts can extend it without an import cycle
 * through app-write-session.ts. app-write-session.ts re-exports it, so every existing import and every
 * `instanceof AppWriteSignInRequired` check is unchanged.
 */
/** Thrown before any request is sent: there is no current write session (or the save was never dispatched). */
export class AppWriteSignInRequired extends Error {}
