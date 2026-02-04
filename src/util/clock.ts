export interface MonotonicClock {
  startedAtHr: bigint;
  startedAtMsEpoch: number;
  nowMs: () => number;
}

export function createMonotonicClock(): MonotonicClock {
  const startedAtHr = process.hrtime.bigint();
  const startedAtMsEpoch = Date.now();
  return {
    startedAtHr,
    startedAtMsEpoch,
    nowMs: () => Number(process.hrtime.bigint() - startedAtHr) / 1e6,
  };
}

