import { createContext, useContext } from "react";

/**
 * PRESENTATION ONLY (Board 15 B5). ReadAccess remains the only component
 * that asks the server about the read session; it reports what it already
 * knows here so Layout can lock the sidebar and show one status line.
 * Nothing here makes a request or holds a credential.
 */
export type ReadView =
  | { kind: "checking" | "unconfigured" | "signed_out" }
  | { kind: "signed_in"; expiresAt: number; signOut: () => void };

export const ReadViewReport = createContext<(view: ReadView) => void>(() => {});

/**
 * Board 15 cleanup (Bones, PR #131): how many times the read session has come
 * back after ending on an open page. ReadAccess never remounts the page (that
 * would destroy drafts, pending saves and their warnings); instead each page
 * re-runs its own READS when this number changes, leaving everything else as
 * it was. Nothing here makes a request.
 */
export const ReadRecovered = createContext(0);
export function useReadRecovered(): number {
  return useContext(ReadRecovered);
}
