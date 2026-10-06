import { createContext } from "react";

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
