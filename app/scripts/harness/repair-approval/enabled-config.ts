/**
 * B15-26 B1 -- test-only stand-in for shared/repair-approval-config, served
 * ONLY by test-repair-approval-browser.cjs's own Vite server (its resolveId
 * plugin redirects every other importer here). The committed switch stays
 * `enabled: false`; this file is never imported by the app or a build.
 */
import { REPAIR_APPROVAL_CONFIG as COMMITTED } from "../../../shared/repair-approval-config";

export { REPAIR_APPROVAL_DISABLED, REPAIR_APPROVAL_FIELD_NOT_PROVISIONED } from "../../../shared/repair-approval-config";
export type { RepairApprovalConfig } from "../../../shared/repair-approval-config";
export const REPAIR_APPROVAL_CONFIG = Object.freeze({ ...COMMITTED, enabled: true });
/** Lets the test prove the page ran on the committed file's values, with only `enabled` changed. */
(window as any).__repairApprovalCommittedEnabled = COMMITTED.enabled;
