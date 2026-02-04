import { describe, expect, it, vi } from "vitest";

import { InteractionTracker } from "../src/pty/interactionTracker";

describe("InteractionTracker", () => {
  it("does not persist plaintext input/output", () => {
    vi.useFakeTimers();

    let now = 0;
    const turns: any[] = [];
    const interactions: any[] = [];

    const tracker = new InteractionTracker({
      burstIdleMs: 30,
      interactionTimeoutMs: 2000,
      turnDetection: "enter",
      nowMs: () => now,
      onTurn: (t) => turns.push(t),
      onInteraction: (i) => interactions.push(i),
    });

    tracker.handleInput("SECRET", Buffer.byteLength("SECRET", "utf8"));
    now = 5;
    tracker.handleOutput(Buffer.byteLength("SECRET", "utf8"));

    vi.advanceTimersByTime(31);

    expect(interactions.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(interactions)).not.toContain("SECRET");
    expect(turns.length).toBe(0);
  });

  it("creates turn events and turn interactions on Enter", () => {
    vi.useFakeTimers();

    let now = 0;
    const turns: any[] = [];
    const interactions: any[] = [];

    const tracker = new InteractionTracker({
      burstIdleMs: 30,
      interactionTimeoutMs: 2000,
      turnDetection: "enter",
      nowMs: () => now,
      onTurn: (t) => turns.push(t),
      onInteraction: (i) => interactions.push(i),
    });

    tracker.handleInput("hi\r", Buffer.byteLength("hi\r", "utf8"));
    expect(turns).toEqual([{ index: 1, tMs: 0, source: "enter" }]);

    now = 12;
    tracker.handleOutput(10);
    vi.advanceTimersByTime(31);

    const turnInteractions = interactions.filter((i) => i.kind === "turn");
    expect(turnInteractions.length).toBe(1);
    expect(turnInteractions[0].turnIndex).toBe(1);
  });

  it("does not double-finalize an overlapped turn via stale timers", () => {
    vi.useFakeTimers();

    let now = 0;
    const interactions: any[] = [];

    const tracker = new InteractionTracker({
      burstIdleMs: 30,
      interactionTimeoutMs: 50,
      turnDetection: "enter",
      nowMs: () => now,
      onTurn: () => undefined,
      onInteraction: (i) => interactions.push(i),
    });

    // Start turn 1 (no output).
    tracker.handleInput("\r", Buffer.byteLength("\r", "utf8"));

    // Start turn 2 before turn 1 produces output; turn 1 should finalize as "overlap".
    now = 10;
    tracker.handleInput("\r", Buffer.byteLength("\r", "utf8"));

    // Advance beyond timeout; only turn 2 should timeout.
    vi.advanceTimersByTime(200);

    const turnInteractions = interactions.filter((i) => i.kind === "turn");
    const overlap = turnInteractions.filter((i) => i.endReason === "overlap");
    const timeout = turnInteractions.filter((i) => i.endReason === "timeout");

    expect(overlap.length).toBe(1);
    expect(timeout.length).toBe(1);
  });
});
