export const VOICE_ACTION = "authorize-outbound-call" as const;

/** One browser/server normalization rule for the authoritative GHL primary phone. */
export function normalizeVoicePhone(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (/^\+1\d{10}$/.test(value)) return value;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export const VOICE_STATES = [
  "idle", "authorizing", "ready", "initiating", "ringing", "connected", "muted",
  "completed", "busy", "no-answer", "rejected", "failed", "disconnected",
  "provider-unknown",
] as const;

export type VoiceCallState = (typeof VOICE_STATES)[number];

export const TERMINAL_VOICE_STATES = [
  "completed", "busy", "no-answer", "rejected", "failed", "disconnected",
] as const satisfies readonly VoiceCallState[];

const TERMINAL = new Set<VoiceCallState>(TERMINAL_VOICE_STATES);

const TRANSITIONS: Record<VoiceCallState, readonly VoiceCallState[]> = {
  idle: ["authorizing"],
  authorizing: ["ready", "rejected", "failed", "provider-unknown"],
  ready: ["initiating", "rejected", "failed", "provider-unknown"],
  initiating: ["ringing", "connected", "busy", "no-answer", "failed", "disconnected", "provider-unknown"],
  ringing: ["connected", "busy", "no-answer", "failed", "disconnected", "provider-unknown"],
  connected: ["muted", "completed", "failed", "disconnected", "provider-unknown"],
  muted: ["connected", "completed", "failed", "disconnected", "provider-unknown"],
  completed: [], busy: [], "no-answer": [], rejected: [], failed: [], disconnected: [],
  "provider-unknown": [],
};

export function isTerminalVoiceState(state: VoiceCallState): boolean {
  return TERMINAL.has(state);
}

export function canTransitionVoiceState(from: VoiceCallState, to: VoiceCallState): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export type ProviderCallStatus =
  | "queued" | "initiated" | "ringing" | "in-progress"
  | "completed" | "busy" | "no-answer" | "failed" | "canceled";

export function providerStatusToVoiceState(status: string): VoiceCallState | null {
  const normalized = status.trim().toLowerCase();
  if (normalized === "queued" || normalized === "initiated") return "initiating";
  if (normalized === "ringing") return "ringing";
  if (normalized === "in-progress") return "connected";
  if (normalized === "completed") return "completed";
  if (normalized === "busy") return "busy";
  if (normalized === "no-answer") return "no-answer";
  if (normalized === "failed") return "failed";
  if (normalized === "canceled") return "disconnected";
  return null;
}

const PROVIDER_RANK: Partial<Record<VoiceCallState, number>> = {
  initiating: 1, ringing: 2, connected: 3, completed: 4,
};

export type ProviderReduction =
  | { kind: "apply"; state: VoiceCallState }
  | { kind: "ignore"; reason: "duplicate" | "stale" | "already-terminal" }
  | { kind: "unknown"; reason: "unrecognized-status" | "conflicting-terminal" | "invalid-transition" };

/** Deterministic provider-callback reduction. It never invents success. */
export function reduceProviderStatus(current: VoiceCallState, providerStatus: string): ProviderReduction {
  const next = providerStatusToVoiceState(providerStatus);
  if (!next) return { kind: "unknown", reason: "unrecognized-status" };
  if (current === next) return { kind: "ignore", reason: "duplicate" };
  if (current === "provider-unknown") return { kind: "ignore", reason: "already-terminal" };
  if (isTerminalVoiceState(current)) {
    return isTerminalVoiceState(next)
      ? { kind: "unknown", reason: "conflicting-terminal" }
      : { kind: "ignore", reason: "already-terminal" };
  }
  const currentRank = PROVIDER_RANK[current];
  const nextRank = PROVIDER_RANK[next];
  if (currentRank !== undefined && nextRank !== undefined && nextRank < currentRank) {
    return { kind: "ignore", reason: "stale" };
  }
  return canTransitionVoiceState(current, next)
    ? { kind: "apply", state: next }
    : { kind: "unknown", reason: "invalid-transition" };
}

export interface VoiceAuthorizationRequest {
  action: typeof VOICE_ACTION;
  contactId: string;
  attemptId: string;
}

export interface VoiceAttemptView {
  attemptId: string;
  contactBinding: string;
  state: VoiceCallState;
  createdAt: string;
  updatedAt: string;
  providerCallId: string | null;
  providerChildCallId: string | null;
}
