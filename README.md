# cc-profiler

External performance profiling harness for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) TUI.

Measures UI responsiveness and correlates latency with system resource usage — without modifying Claude Code itself.

## Installation

```bash
# Global install
npm install -g cc-profiler

# Or use npx (no install required)
npx cc-profiler claude
```

**Requirements:** Node.js 22+

## Quick Start

```bash
# Profile a Claude Code session
cc-profiler claude

# When done, quit Claude normally (Ctrl+C or /exit)
# Output:
#   cc-profiler session complete
#   - Output: ./cc-profiler-session-2026-02-04-135044
#   - Data:   ./cc-profiler-session-2026-02-04-135044/data.json
#   - Report: ./cc-profiler-session-2026-02-04-135044/report.html

# Open report.html in a browser to view results
```

## CLI Reference

```
cc-profiler [options] [--] <command...>
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--output <dir>` | Auto-generated | Output directory for session data |
| `--duration <time>` | None | Auto-stop after duration (e.g., `5m`, `30s`) |
| `--binary <path>` | — | Path to claude binary (overrides first arg) |
| `--disable-mcps` | false | Run with MCP servers disabled (A/B testing) |
| `--turn-hotkey <spec>` | `alt+t` | Manual turn marker hotkey (`alt+t` or `off`) |
| `--burst-idle-ms <ms>` | 30 | Idle gap to end output burst detection |
| `--sample-interval-ms <ms>` | 100 | Process sampling interval |
| `--interaction-timeout-ms <ms>` | 2000 | Timeout for interactions with no output |

### Privacy Flags (opt-in, makes output NOT shareable)

| Flag | Description |
|------|-------------|
| `--unsafe-store-paths` | Store plaintext paths in data.json |
| `--unsafe-store-command` | Store plaintext command + args |
| `--unsafe-store-errors` | Store full error messages (may contain paths) |

### Subcommands

```bash
# Generate report from existing data
cc-profiler report <data.json> [--out <path>]

# Add marker to active session (from another terminal)
cc-profiler mark [label] [--unsafe-plaintext-label]
```

### Passing Flags to Claude

Use `--` to separate cc-profiler flags from the target command:

```bash
cc-profiler --duration 5m -- claude --dangerously-skip-permissions
```

## Understanding the Output

### Session Bundle

Each session creates a directory containing:

| File | Description |
|------|-------------|
| `data.json` | Raw metrics (machine-readable) |
| `report.html` | Interactive charts (open in browser) |
| `markers.jsonl` | Timeline annotations |

### Latency Metrics (T1/T2/T3)

| Metric | Description |
|--------|-------------|
| **T1** | Time from keystroke to first output byte |
| **T2** | Time from keystroke to end of output burst (response complete) |
| **T3** | Total output bytes in the burst |

**Turn** = a user message (detected when Enter is pressed, or manually via `Alt+T`)

### Process Metrics

| Metric | Platforms |
|--------|-----------|
| RSS (memory) | All |
| CPU % | All |
| Page faults | Linux |
| Context switches | Linux |
| File descriptors | Linux |
| Thread count | Linux |

### Report Charts

The HTML report includes:
- **RSS + CPU over time** — Memory and CPU usage throughout the session
- **Turn latency over time** — Response time trends (are later turns slower?)
- **Turn latency vs turn index** — Scatter plot of latency per turn

## Privacy

By default, cc-profiler produces **shareable** output:

- **No plaintext I/O** — Only timestamps and byte counts, never what you typed or received
- **Hashed paths** — File paths stored as SHA-256 hashes
- **Redacted errors** — Only error class/code, not full messages
- **Names only** — MCP server and plugin names (no URLs or secrets)

Use `--unsafe-*` flags only for local debugging.

## A/B Testing

Compare performance with/without MCP servers:

```bash
# Control: MCPs enabled (normal)
cc-profiler --output ./with-mcps claude

# Treatment: MCPs disabled
cc-profiler --output ./no-mcps --disable-mcps claude
```

The `--disable-mcps` flag uses a temporary settings overlay. Your real `~/.claude/settings.json` is never modified.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

## License

MIT
