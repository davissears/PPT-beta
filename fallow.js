import { execa } from "execa";

export async function runFallow(directory) {
  const commands = ["dead-code", "dupes", "health"];

  const results = await Promise.all(
    commands.map((cmd) =>
      execa("npx", ["fallow", cmd, "--format", "json"], { cwd: directory, reject: false })
    )
  );

  const output = {};
  for (let i = 0; i < commands.length; i++) {
    const key = commands[i];
    const result = results[i];
    // fallow exits 1 when it finds issues — that's a successful analysis.
    // Only treat it as a hard failure if stdout isn't parseable JSON.
    const hasOutput = result.stdout?.trim().startsWith("{") || result.stdout?.trim().startsWith("[");
    if (hasOutput) {
      output[key] = { success: true, output: result.stdout, error: "" };
    } else {
      output[key] = {
        success: false,
        output: result.stdout ?? "",
        error: result.stderr || result.message || `exit code ${result.exitCode}`,
      };
    }
  }

  return output;
}
