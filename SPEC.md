# fallow-review — Project Spec

## Purpose
Node.js CLI that runs Fallow static analysis on a JS/TS codebase and pipes the findings to a user-configured AI coding agent (Claude Code, Aider, Codex, etc.) to resolve the issues.

## Tech Stack
- Node.js ESM, single repo
- `inquirer` — interactive prompts + checkboxes
- `execa` — shell command execution
- `ora` — spinners
- `chalk` — terminal color
- `@anthropic-ai/sdk` — NOT used for the agent call (agent is a CLI subprocess); may be used for future features

## File Structure
```
index.js       # CLI entry, wires subcommands
fallow.js      # runs fallow suite, returns results
agents.js      # agent registry, invocation logic
config.js      # load/save ~/.fallow-review/config.json
package.json
```

## User Flow
1. Run `fallow-review` → prompt: select directory
2. Run all 3 Fallow commands in parallel against that dir (with spinners)
3. Checkbox: select which analyses to include
4. Write selected outputs to a temp file in `os.tmpdir()` (e.g. `/tmp/fallow-report-<timestamp>.json`)
5. Read the report file contents and invoke the configured AI agent with the report embedded in the prompt
6. Agent runs with cwd = selected directory (so it can edit files directly)

## Fallow Commands (all run with `--format json`)
- `npx fallow dead-code` — unused exports, types, files, circular deps
- `npx fallow dupes` — duplicated logic
- `npx fallow health` — complexity, maintainability, refactor hotspots

All 3 run in parallel. Failures are shown but don't block the others.

## Agent Configuration

### Config file: `~/.fallow-review/config.json`
```json
{
  "agent": {
    "name": "Claude Code",
    "command": "claude",
    "args": [],
    "promptStyle": "inline",
    "prompt": "Review and fix the issues found by Fallow static analysis:\n\n{reportContents}"
  }
}
```

### First-run behavior
- Default config: Claude Code (pre-wired, no setup needed)
- On first run (no config file exists): ask user if they want to reconfigure for a different agent
  - Yes → run config wizard (same as `fallow-review config`)
  - No → proceed with Claude Code default

### `fallow-review config` subcommand
Interactive wizard:
1. Pick agent from preset list or "Custom"
2. If Custom: enter command, args template, invocation mode
3. Saves to `~/.fallow-review/config.json`

### Built-in Presets
| Name | Command | Args | Mode |
|---|---|---|---|
| Claude Code | `claude` | `"{prompt}"` | inline |
| Aider | `aider` | `--message "{prompt}"` | inline |
| Codex CLI | `codex` | `"{prompt}"` | inline |
| Gemini CLI | `gemini` | `--prompt "{prompt}"` | inline |
| Custom | user-defined | user-defined | inline or stdin |

### Invocation Modes
- `inline` — prompt passed as CLI arg: `claude "Fix these issues: <report contents>"`
- `stdin` — prompt piped to stdin: `echo "Fix these issues: <report contents>" | aider`

### Report temp file
- Written to OS temp dir: `os.tmpdir()/fallow-report-<timestamp>.json`
- Contains: `{ directory, timestamp, analyses: { "dead-code": {...}, "dupes": {...}, "health": {...} } }`
- Deleted on process exit

## Subcommands
- `fallow-review` — main flow (dir select → fallow → checkbox → agent)
- `fallow-review config` — reconfigure agent

## Key Constraints
- Agent subprocess runs with `cwd` set to the analysed directory
- No Anthropic API calls in the main path — agent is always a CLI subprocess
- Config stored in user home dir (`~/.fallow-review/`), not project dir
