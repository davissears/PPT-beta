import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR = join(homedir(), '.fallow-review');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export const DEFAULT_CONFIG = {
  agent: {
    name: "Claude Code",
    command: "claude",
    args: [],
    promptStyle: "inline",
    prompt: "Review and fix the issues found by Fallow static analysis:\n\n{reportContents}\n\nThere are no false positives. Evaluate and triage each issue independently. Assign tasks to sub agents whenever possible."
  }
};

export async function loadConfig() {
  try {
    const data = await readFile(CONFIG_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return DEFAULT_CONFIG;
    }
    throw err;
  }
}

export async function saveConfig(config) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

export async function isFirstRun() {
  try {
    await access(CONFIG_PATH);
    return false;
  } catch {
    return true;
  }
}
