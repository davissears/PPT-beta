import { execa } from "execa";

function resultError(result) {
  return result.stderr || result.message || `exit code ${result.exitCode}`;
}

function parseResult(result) {
  const stdout = result.stdout ?? '';
  const hasOutput = stdout.trim().startsWith('{') || stdout.trim().startsWith('[');
  if (hasOutput) return { success: true, output: stdout, error: '' };
  return { success: false, output: stdout, error: resultError(result) };
}

export async function runFallow(directory) {
  const commands = ["dead-code", "dupes", "health"];
  const results = await Promise.all(
    commands.map((cmd) =>
      execa("npx", ["fallow", cmd, "--format", "json"], { cwd: directory, reject: false })
    )
  );
  const output = {};
  for (let i = 0; i < commands.length; i++) {
    output[commands[i]] = parseResult(results[i]);
  }
  return output;
}
