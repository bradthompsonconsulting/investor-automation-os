import { Call, Device } from "@twilio/voice-sdk";
import { VOICE_ACTION, type VoiceCallState } from "../../../shared/voice-call-contract";

export interface BrowserVoiceConnection {
  disconnect(): void;
  mute(muted: boolean): void;
  isMuted(): boolean;
}

export class TwilioBrowserAdapter {
  private device: Device | null = null;
  private call: Call | null = null;

  async connect(input: {
    voiceToken: string;
    contactId: string;
    attemptId: string;
    onState: (state: VoiceCallState) => void;
    onError: (error: Error) => void;
  }): Promise<BrowserVoiceConnection> {
    if (this.call) throw new Error("A browser voice call is already active");
    this.device?.destroy();
    this.device = new Device(input.voiceToken, { closeProtection: true });
    input.onState("initiating");
    try {
      const call = await this.device.connect({ params: { action: VOICE_ACTION, contactId: input.contactId, attemptId: input.attemptId } });
      this.call = call;
      call.on("ringing", () => input.onState("ringing"));
      call.on("accept", () => input.onState("connected"));
      call.on("disconnect", () => { this.call = null; input.onState("disconnected"); });
      call.on("cancel", () => { this.call = null; input.onState("disconnected"); });
      call.on("reject", () => { this.call = null; input.onState("rejected"); });
      call.on("error", (error) => { this.call = null; input.onError(error); });
      return {
        disconnect: () => call.disconnect(),
        mute: (muted) => { call.mute(muted); input.onState(muted ? "muted" : "connected"); },
        isMuted: () => call.isMuted(),
      };
    } catch (error) {
      this.call = null;
      throw error;
    }
  }

  destroy(): void {
    this.call?.disconnect();
    this.call = null;
    this.device?.destroy();
    this.device = null;
  }
}
