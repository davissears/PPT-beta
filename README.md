# fallow-review

Run [Fallow](https://github.com/nicolo-ribaudo/fallow) static analysis on a JS/TS codebase and automatically pipe the findings to an AI coding agent to fix them.

## What it does

1. Asks which directory to analyse
2. Runs three Fallow analyses in parallel (dead code, duplicates, health)
3. Lets you choose which results to include
4. Extracts issues into a numbered checklist and shows a summary by category
5. Invokes your configured AI agent with the checklist so it can edit files directly
6. Re-runs Fallow after the agent finishes and shows what was fixed, what remains, and any new issues introduced
7. Optionally runs up to 3 more rounds on remaining issues (with your confirmation each time)

## Prerequisites

- Node.js 18+
- `fallow` available via `npx` (install with `npm install -g fallow` or keep it in your project's devDependencies)
- At least one supported AI agent installed: [Claude Code](https://claude.ai/code), [Aider](https://aider.chat), [Codex CLI](https://github.com/openai/codex), or [Gemini CLI](https://github.com/google-gemini/gemini-cli)

## Installation

```bash
git clone https://github.com/davissears/fallow-review.git
cd fallow-review
npm install
```

## Usage

### Main flow

```bash
fallow-review
```

Or without installing globally:

```bash
node index.js
```

1. Enter (or confirm) the directory to analyse — defaults to the current directory.
2. Watch the three analyses run. Green = analysis returned results. Red = analysis failed.
3. Use the checkbox prompt to pick which analyses to send to your agent. Only successful analyses are pre-checked.
4. A summary of issues by category is shown, then your agent launches in the analysed directory.
5. After the agent finishes, Fallow re-runs automatically. You'll see:
   - **Fixed** — issues resolved by the agent
   - **Remaining** — issues not yet resolved
   - **Introduced** — new issues created by the agent's changes
6. If issues remain and progress was made, you're asked whether to run another round (up to 3 total).

**First run:** if no config file exists you'll be asked whether to set up a different agent. Press Enter to skip and use Claude Code.

### Configure your agent

```bash
fallow-review config
```

Interactive wizard to switch agents. Pick one of the built-in presets or enter a custom command.

## Supported agents

| Agent | Command required on PATH |
|---|---|
| Claude Code (default) | `claude` |
| Aider | `aider` |
| Codex CLI | `codex` |
| Gemini CLI | `gemini` |
| Custom | any |

## Configuration

Config is saved to `~/.fallow-review/config.json`. You can edit it by hand or via `fallow-review config`.

```json
{
  "agent": {
    "name": "Claude Code",
    "command": "claude",
    "args": [],
    "promptStyle": "inline",
    "prompt": "Fix every issue listed in this Fallow static analysis report by changing code so the analysis no longer reports it.\n\n{checklist}\n\nRules:\n- Do NOT add suppression comments.\n- Do NOT delete or skip tests.\n- Fix root causes: remove dead code, deduplicate logic, refactor complex functions."
  }
}
```

### Fields

| Field | Description |
|---|---|
| `command` | The binary to run (e.g. `claude`, `aider`) |
| `args` | Arguments prepended before the prompt |
| `promptStyle` | `"inline"` — prompt passed as a CLI arg; `"stdin"` — prompt piped to stdin |
| `prompt` | Prompt template. Available placeholders: `{checklist}`, `{reportContents}`, `{reportPath}` |

### Prompt placeholders

| Placeholder | Replaced with |
|---|---|
| `{checklist}` | Numbered list of issues extracted from the selected analyses |
| `{reportContents}` | Full JSON contents of the report file |
| `{reportPath}` | Absolute path to the report file |

### Default prompt rules

The built-in prompt instructs the agent to:

- Fix root causes — remove dead code, deduplicate logic, refactor complex functions
- **Not** add suppression comments (`eslint-disable`, `@ts-ignore`, `fallow-ignore`, etc.)
- **Not** delete tests or narrow analyser scope
- **Not** mark issues as "false positives" — there are none
- List any issue it genuinely cannot fix rather than papering over it

### Custom agent example

If your agent reads from stdin:

```json
{
  "agent": {
    "name": "My Agent",
    "command": "my-agent",
    "args": [],
    "promptStyle": "stdin",
    "prompt": "Fix all issues in this Fallow report:\n\n{checklist}"
  }
}
```

## Analyses

| Analysis | What it checks |
|---|---|
| `dead-code` | Unused exports, types, files, circular dependencies |
| `dupes` | Duplicated logic |
| `health` | Complexity, maintainability, refactor hotspots |

All three run in parallel. A failed analysis (e.g. `fallow` not found, parse error) is shown in red but does not block the others.

> **Note:** Fallow exits with code 1 when it finds issues — that is expected and treated as a successful analysis. Only a completely unparseable response is considered a failure.

## Verification & iteration

After the agent finishes, `fallow-review` re-runs the same analyses and compares results:

- **Fixed** issues are shown in green
- **Remaining** issues are shown in yellow
- **Introduced** issues (regressions) are shown in red

If there are remaining issues and at least one issue was fixed in the last round, you're asked:

> Run another round on the N remaining issues? (up to 3 total)

On retry, the agent receives only the remaining issues — not the full original list. Rounds stop automatically if:

- All issues are fixed
- No progress was made in the last round
- The 3-round limit is reached

## Report file

A JSON report is written to a `_ppt-report/` directory inside the analysed project (e.g. `your-project/_ppt-report/1714500000000.json`). The directory is created automatically if it doesn't exist. Reports persist after the process exits so you can reference them later. The filename is the Unix epoch timestamp in milliseconds. The report contains:

```json
{
  "directory": "/absolute/path/analysed",
  "timestamp": "2026-04-30T12:00:00.000Z",
  "analyses": {
    "dead-code": { "success": true, "output": "...", "error": "" },
    "health":    { "success": true, "output": "...", "error": "" }
  }
}
```

Only the analyses you selected in the checkbox step are included.

## How the agent runs

The agent subprocess is launched with its working directory set to the analysed directory. This means Claude Code (or any other agent) can read and edit the project files directly without any extra configuration.

## Testing

```bash
npm test
```

Runs the test suite using Node's built-in test runner (`node --test`). Tests cover report summarisation, diff logic, checklist formatting, prompt template rendering, report persistence, and the iteration decision function.

## Troubleshooting

**`fallow` command not found** — install it globally (`npm i -g fallow`) or add it to the project's devDependencies so `npx` can find it.

**Agent command not found** — make sure the agent binary is on your `PATH`. Run `which claude` (or the relevant command) to verify.

**All analyses failed** — check that the target directory is a valid JS/TS project and that you have network access for `npx` to download `fallow` if it isn't cached.

**Want to reset config** — delete `~/.fallow-review/config.json` and re-run `fallow-review`. You'll be offered the first-run setup prompt again.

**Agent introduced new issues** — if the verification step shows introduced issues, decline the retry prompt and review the agent's changes manually. The verification output tells you exactly which issues are new.
