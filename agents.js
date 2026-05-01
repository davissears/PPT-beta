import { execa } from "execa";
import { readFile } from "fs/promises";

const NEW_PROMPT = "Fix every issue listed in this Fallow static analysis report by changing code so the analysis no longer reports it.\n\n{checklist}\n\nRules:\n- Do NOT add suppression comments (e.g. eslint-disable, @ts-ignore, fallow-ignore, // @ts-expect-error).\n- Do NOT delete or skip tests, narrow analyzer scope, or move files out of the analysis path.\n- Do NOT mark issues as \"intentional,\" \"won't fix,\" or \"false positive.\" There are no false positives.\n- Fix root causes: remove genuinely dead code, deduplicate logic, refactor complex functions.\n- If an issue truly cannot be fixed by code change, leave it untouched and list it explicitly in your final summary. Do not paper over it.\n\nA re-run of `fallow` after your changes must report fewer issues, not the same set with suppressions added.";

export const PRESETS = [
  { name: "Claude Code", command: "claude", args: [],            promptStyle: "inline", prompt: NEW_PROMPT },
  { name: "Aider",       command: "aider",  args: ["--message"], promptStyle: "inline", prompt: NEW_PROMPT },
  { name: "Codex CLI",   command: "codex",  args: [],            promptStyle: "inline", prompt: NEW_PROMPT },
  { name: "Gemini CLI",  command: "gemini", args: ["--prompt"],  promptStyle: "inline", prompt: NEW_PROMPT },
  { name: "Custom",      command: "",       args: [],            promptStyle: "inline", prompt: NEW_PROMPT },
];

export async function invokeAgent(agentConfig, reportPath, cwd, extras = {}) {
  const reportContents = await readFile(reportPath, "utf8");
  const checklist = extras.checklist ?? "";
  const finalPrompt = agentConfig.prompt
    .replace("{checklist}", checklist)
    .replace("{reportContents}", reportContents)
    .replace("{reportPath}", reportPath);
  const { command, args } = agentConfig;

  if (agentConfig.promptStyle === "stdin") {
    const proc = execa(command, [...args], {
      cwd,
      stdio: ["pipe", "inherit", "inherit"],
    });
    proc.stdin.write(finalPrompt);
    proc.stdin.end();
    await proc;
  } else {
    await execa(command, [...args, finalPrompt], { cwd, stdio: "inherit" });
  }
}
