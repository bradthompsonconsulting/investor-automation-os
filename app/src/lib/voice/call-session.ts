import { VOICE_ACTION, type VoiceAttemptView, type VoiceCallState } from "../../../shared/voice-call-contract";
import type { BrowserVoiceConnection, TwilioBrowserAdapter } from "./twilio-browser-adapter";

export interface AuthorizedVoiceAttempt extends VoiceAttemptView {
  voiceToken: string;
  voiceTokenExpiresAt: string;
}

export class VoiceCallSession {
  private inFlight: Promise<BrowserVoiceConnection> | null = null;
  private connection: BrowserVoiceConnection | null = null;

  constructor(
    private readonly adapter: TwilioBrowserAdapter,
    private readonly sessionToken: () => string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async authorize(contactId: string, attemptId: string): Promise<AuthorizedVoiceAttempt> {
    const response = await this.fetcher("/.netlify/functions/voice-authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.sessionToken()}` },
      body: JSON.stringify({ action: VOICE_ACTION, contactId, attemptId }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Voice authorization failed");
    return body as AuthorizedVoiceAttempt;
  }

  start(
    attempt: AuthorizedVoiceAttempt,
    onState: (state: VoiceCallState) => void,
    onError: (error: Error) => void,
  ): Promise<BrowserVoiceConnection> {
    if (Date.parse(attempt.voiceTokenExpiresAt) <= this.now()) return Promise.reject(new Error("Voice capability expired; authorize a new attempt"));
    if (this.inFlight) return this.inFlight;
    if (this.connection) return Promise.resolve(this.connection);
    this.inFlight = this.adapter.connect({
      voiceToken: attempt.voiceToken,
      contactId: attempt.contactBinding,
      attemptId: attempt.attemptId,
      onState,
      onError,
    }).then((connection) => {
      this.connection = connection;
      return connection;
    }).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async restore(contactId: string): Promise<VoiceAttemptView | null> {
    const response = await this.fetcher(`/.netlify/functions/voice-attempt?contactId=${encodeURIComponent(contactId)}`, {
      headers: { Authorization: `Bearer ${this.sessionToken()}` },
    });
    if (response.status === 404) return null;
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Voice attempt refresh failed");
    return body as VoiceAttemptView;
  }

  disconnect(): void {
    this.connection?.disconnect();
    this.connection = null;
  }
}
