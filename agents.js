import { execa } from "execa";
import { readFile } from "fs/promises";

export const PRESETS = [
  { name: "Claude Code", command: "claude", args: [],            promptStyle: "inline", prompt: "Review and fix the issues found by Fallow static analysis:\n\n{reportContents}\n\nThere are no false positives. Evaluate and triage each issue independently. Assign tasks to sub agents whenever possible." },
  { name: "Aider",       command: "aider",  args: ["--message"], promptStyle: "inline", prompt: "Review and fix the issues found by Fallow static analysis:\n\n{reportContents}\n\nThere are no false positives. Evaluate and triage each issue independently. Assign tasks to sub agents whenever possible." },
  { name: "Codex CLI",   command: "codex",  args: [],            promptStyle: "inline", prompt: "Review and fix the issues found by Fallow static analysis:\n\n{reportContents}\n\nThere are no false positives. Evaluate and triage each issue independently. Assign tasks to sub agents whenever possible." },
  { name: "Gemini CLI",  command: "gemini", args: ["--prompt"],  promptStyle: "inline", prompt: "Review and fix the issues found by Fallow static analysis:\n\n{reportContents}\n\nThere are no false positives. Evaluate and triage each issue independently. Assign tasks to sub agents whenever possible." },
  { name: "Custom",      command: "",       args: [],            promptStyle: "inline", prompt: "" },
];

export async function invokeAgent(agentConfig, reportPath, cwd) {
  const reportContents = await readFile(reportPath, "utf8");
  const finalPrompt = agentConfig.prompt
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
