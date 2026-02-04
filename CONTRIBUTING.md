# Contributing to cc-profiler

## Dev setup

```bash
npm install
npm run build
npm test
```

Node requirement: Node.js 22+.

## Running locally

```bash
# Profile Claude Code (default)
node dist/cli.js claude

# Pass args to the wrapped command
node dist/cli.js -- --help
```

## Design constraints (must keep true)

- Do not persist plaintext user input or Claude output in `data.json`.
- Session JSONL files must never be read; only sizes/metadata may be recorded.
- Reports should be shareable without redaction (safe defaults).
