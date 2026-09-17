import type { VoiceCallState } from "../../../shared/voice-call-contract";

export const VOICE_STATE_LABELS: Record<VoiceCallState, string> = {
  idle: "Ready to call",
  authorizing: "Checking seller and call eligibility",
  ready: "Authorized — starting call",
  initiating: "Calling seller",
  ringing: "Seller phone is ringing",
  connected: "Connected",
  muted: "Connected — microphone muted",
  completed: "Call completed",
  busy: "Seller line was busy",
  "no-answer": "Seller did not answer",
  rejected: "Call was rejected",
  failed: "Call failed",
  disconnected: "Call ended",
  "provider-unknown": "Call outcome is uncertain — review before trying again",
};

export interface VoiceControlAvailability {
  showIaosMode: boolean;
  iaosDisabled: boolean;
  canDial: boolean;
  canMute: boolean;
  canHangUp: boolean;
}

const ACTIVE = new Set<VoiceCallState>(["initiating", "ringing", "connected", "muted"]);

export function voiceControlAvailability(input: {
  isMobile: boolean;
  browserSupported: boolean;
  featureEnabled: boolean;
  authenticated: boolean;
  state: VoiceCallState;
}): VoiceControlAvailability {
  const showIaosMode = !input.isMobile || input.browserSupported;
  const active = ACTIVE.has(input.state);
  return {
    showIaosMode,
    iaosDisabled: !input.browserSupported || !input.featureEnabled,
    canDial: input.browserSupported && input.featureEnabled && input.authenticated && input.state === "idle",
    canMute: input.state === "connected" || input.state === "muted",
    canHangUp: active,
  };
}

export function isVoiceAttemptActive(state: VoiceCallState): boolean {
  return ACTIVE.has(state) || state === "authorizing" || state === "ready";
}
