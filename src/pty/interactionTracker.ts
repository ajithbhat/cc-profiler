import type { Interaction, TurnDetectionMode, TurnEvent } from "../session/schema";

interface ActiveInteraction {
  id: number;
  kind: Interaction["kind"];
  t0Ms: number;
  firstOutputAtMs?: number;
  lastOutputAtMs?: number;
  inputBytes: number;
  outputBytes: number;
  turnIndex?: number;
  idleTimer?: NodeJS.Timeout;
  noOutputTimeout?: NodeJS.Timeout;
}

export interface InteractionTrackerOptions {
  burstIdleMs: number;
  interactionTimeoutMs: number;
  turnDetection: TurnDetectionMode;
  nowMs: () => number;
  onTurn: (turn: TurnEvent) => void;
  onInteraction: (interaction: Interaction) => void;
}

export class InteractionTracker {
  private readonly burstIdleMs: number;
  private readonly interactionTimeoutMs: number;
  private readonly turnDetection: TurnDetectionMode;
  private readonly nowMs: () => number;
  private readonly onTurn: (turn: TurnEvent) => void;
  private readonly onInteraction: (interaction: Interaction) => void;

  private nextId = 1;
  private turnIndex = 0;

  private activeKeystroke?: ActiveInteraction;
  private activeTurn?: ActiveInteraction;

  constructor(opts: InteractionTrackerOptions) {
    this.burstIdleMs = opts.burstIdleMs;
    this.interactionTimeoutMs = opts.interactionTimeoutMs;
    this.turnDetection = opts.turnDetection;
    this.nowMs = opts.nowMs;
    this.onTurn = opts.onTurn;
    this.onInteraction = opts.onInteraction;
  }

  handleInput(data: string, byteLen: number): void {
    const now = this.nowMs();

    // Keystroke interaction (coalesces typing until output burst ends).
    if (!this.activeKeystroke) {
      this.activeKeystroke = this.startInteraction("keystroke", now);
    }
    this.activeKeystroke.inputBytes += byteLen;

    // Turn detection (required for v1): treat Enter as "send turn".
    if (this.turnDetection === "enter" && bufferContainsEnter(data)) {
      this.beginTurn("enter", now);
      this.activeTurn!.inputBytes += byteLen;
    } else if (this.activeTurn) {
      // If user types while turn interaction is active, include bytes (still no plaintext stored).
      this.activeTurn.inputBytes += byteLen;
    }
  }

  handleOutput(byteLen: number): void {
    const now = this.nowMs();
    if (this.activeKeystroke) this.observeOutput(this.activeKeystroke, now, byteLen);
    if (this.activeTurn) this.observeOutput(this.activeTurn, now, byteLen);
  }

  endSession(): void {
    if (this.activeKeystroke) this.finalize(this.activeKeystroke, "sessionEnd");
    if (this.activeTurn) this.finalize(this.activeTurn, "sessionEnd");
    this.activeKeystroke = undefined;
    this.activeTurn = undefined;
  }

  getCurrentTurnIndex(): number {
    return this.turnIndex;
  }

  markTurn(source: TurnDetectionMode): void {
    const now = this.nowMs();
    this.beginTurn(source, now);
  }

  private beginTurn(source: TurnDetectionMode, now: number): void {
    this.turnIndex += 1;
    this.onTurn({ index: this.turnIndex, tMs: now, source });

    if (this.activeTurn) {
      // A new turn started while previous turn interaction is still active.
      this.finalize(this.activeTurn, "overlap");
      this.activeTurn = undefined;
    }

    this.activeTurn = this.startInteraction("turn", now, { turnIndex: this.turnIndex });
  }

  private startInteraction(
    kind: Interaction["kind"],
    t0Ms: number,
    extra?: { turnIndex?: number },
  ): ActiveInteraction {
    const it: ActiveInteraction = {
      id: this.nextId++,
      kind,
      t0Ms,
      inputBytes: 0,
      outputBytes: 0,
      turnIndex: extra?.turnIndex,
    };

    // If no output arrives within interactionTimeoutMs, close it.
    it.noOutputTimeout = setTimeout(() => {
      // Only timeout if output never started.
      if (it.firstOutputAtMs == null) this.finalize(it, "timeout");
    }, this.interactionTimeoutMs);

    return it;
  }

  private observeOutput(it: ActiveInteraction, nowMs: number, bytes: number): void {
    if (it.firstOutputAtMs == null) {
      it.firstOutputAtMs = nowMs;
      if (it.noOutputTimeout) clearTimeout(it.noOutputTimeout);
      it.noOutputTimeout = undefined;
    }

    it.lastOutputAtMs = nowMs;
    it.outputBytes += bytes;

    if (it.idleTimer) clearTimeout(it.idleTimer);
    it.idleTimer = setTimeout(() => {
      this.finalize(it, "burstIdle");
    }, this.burstIdleMs);
  }

  private finalize(it: ActiveInteraction, reason: Interaction["endReason"]): void {
    if (it.idleTimer) clearTimeout(it.idleTimer);
    if (it.noOutputTimeout) clearTimeout(it.noOutputTimeout);

    const interaction: Interaction = {
      id: it.id,
      kind: it.kind,
      t0Ms: it.t0Ms,
      t1Ms: it.firstOutputAtMs == null ? undefined : it.firstOutputAtMs - it.t0Ms,
      t2Ms: it.lastOutputAtMs == null ? undefined : it.lastOutputAtMs - it.t0Ms,
      inputBytes: it.inputBytes,
      outputBytes: it.outputBytes,
      turnIndex: it.turnIndex,
      endReason: reason,
    };

    // Clear active references if they point at this interaction.
    if (this.activeKeystroke?.id === it.id) this.activeKeystroke = undefined;
    if (this.activeTurn?.id === it.id) this.activeTurn = undefined;

    this.onInteraction(interaction);
  }
}

function bufferContainsEnter(str: string): boolean {
  return str.includes("\n") || str.includes("\r");
}
