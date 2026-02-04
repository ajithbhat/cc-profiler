export function parseDurationToMs(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Duration is empty");

  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i.exec(trimmed);
  if (!match) throw new Error(`Invalid duration: ${input}`);

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid duration: ${input}`);

  const unit = (match[2] ?? "ms").toLowerCase();
  switch (unit) {
    case "ms":
      return value;
    case "s":
      return value * 1000;
    case "m":
      return value * 60_000;
    case "h":
      return value * 3_600_000;
    default:
      throw new Error(`Invalid duration unit: ${unit}`);
  }
}

