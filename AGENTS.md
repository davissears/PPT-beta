# fallow-review — Agent Reference

Node.js ESM CLI. Runs Fallow static analysis on a JS/TS codebase, then invokes a configured AI coding agent (as a subprocess) with the findings.

## File Map

```
index.js   — CLI entry. mainFlow(), runConfigWizard(), subcommand routing
fallow.js  — runFallow(dir): parallel Fallow runner
agents.js  — PRESETS[], invokeAgent(config, reportPath, cwd)
config.js  — loadConfig(), saveConfig(config), isFirstRun(), DEFAULT_CONFIG
```

## Call Graph

```
fallow-review (entry)
  └─ isFirstRun()? → optional runConfigWizard()
  └─ mainFlow()
       ├─ inquirer: dir input
       ├─ runFallow(dir) → { dead-code, dupes, health }
       ├─ inquirer: checkbox (select analyses)
       ├─ write /tmp/fallow-report-<ts>.json
       ├─ process.on('exit') → unlinkSync(tempPath)
       └─ loadConfig() → invokeAgent(config.agent, tempPath, dir)

fallow-review config (entry)
  └─ runConfigWizard() → saveConfig()
```

## Public APIs

### config.js
```js
DEFAULT_CONFIG: AgentConfig           // Claude Code preset, used when no file exists
loadConfig(): Promise<AgentConfig>    // reads ~/.fallow-review/config.json; returns DEFAULT_CONFIG on ENOENT
saveConfig(config): Promise<void>     // mkdir -p ~/.fallow-review, writes JSON
isFirstRun(): Promise<boolean>        // true if ~/.fallow-review/config.json absent
```

### fallow.js
```js
runFallow(directory: string): Promise<FallowResults>
// Runs all 3 analyses in parallel via execa with reject:false.
// Success = stdout starts with { or [ (fallow exits 1 on findings — not an error).
```

### agents.js
```js
PRESETS: AgentConfig[]                // 5 entries: Claude Code, Aider, Codex CLI, Gemini CLI, Custom
invokeAgent(agentConfig, reportPath, cwd): Promise<void>
// Reads report file, replaces {reportContents} and {reportPath} in agentConfig.prompt, then:
//   inline: execa(command, [...args, finalPrompt], { cwd, stdio:"inherit" })
//   stdin:  execa(command, [...args], { cwd, stdio:["pipe","inherit","inherit"] }), writes prompt to stdin
```

### index.js
```js
mainFlow(): Promise<void>             // full interactive flow (dir → fallow → checkbox → agent)
runConfigWizard(): Promise<void>      // interactive agent config wizard, calls saveConfig()
```

## Schemas

### AgentConfig
```ts
{
  name: string          // display name
  command: string       // binary to invoke (e.g. "claude")
  args: string[]        // args prepended before the prompt (e.g. ["--message"])
  promptStyle: "inline" | "stdin"
  prompt: string        // template — use {reportContents} for embedded report, {reportPath} for file path
}
```

### FallowResults
```ts
{
  "dead-code": { success: boolean, output: string, error: string }
  "dupes":     { success: boolean, output: string, error: string }
  "health":    { success: boolean, output: string, error: string }
}
// output = raw stdout (JSON string from fallow --format json)
// error  = stderr/message when success:false
```

### Report (written to temp file)
```ts
{
  directory: string       // absolute path analysed
  timestamp: string       // ISO 8601
  analyses: {             // only user-selected keys present
    "dead-code"?: { success, output, error }
    "dupes"?:     { success, output, error }
    "health"?:    { success, output, error }
  }
}
```

### Config file — ~/.fallow-review/config.json
```json
{ "agent": AgentConfig }
```

## Subcommands

| Invocation | Behaviour |
|---|---|
| `fallow-review` | main flow; first-run check runs before mainFlow |
| `fallow-review config` | config wizard only; exits after save |

## Presets

| Name | command | args | promptStyle |
|---|---|---|---|
| Claude Code | `claude` | `[]` | inline |
| Aider | `aider` | `["--message"]` | inline |
| Codex CLI | `codex` | `[]` | inline |
| Gemini CLI | `gemini` | `["--prompt"]` | inline |
| Custom | user input | user input | user input |

## Key Behaviours

- **Fallow exit codes**: `fallow` exits 1 when it finds issues. `runFallow` treats this as success if stdout is valid JSON; only stdout that does not start with `{` or `[` is treated as a hard failure.
- **Temp file lifecycle**: written before agent invocation, deleted via `process.on('exit')` sync handler.
- **Agent subprocess cwd**: always set to the analysed directory so the agent can edit files directly.
- **No Anthropic SDK calls** in the main path — agent is always a CLI subprocess.
- **First-run**: if `~/.fallow-review/config.json` is absent, user is offered a confirm prompt to reconfigure; declining silently uses `DEFAULT_CONFIG` (Claude Code).

## Dependencies

```
inquirer  — interactive prompts (input, list, checkbox, confirm)
execa     — subprocess execution
ora       — spinners (one per analysis during runFallow)
chalk     — terminal colour (green=success, red=error/failure)
```
