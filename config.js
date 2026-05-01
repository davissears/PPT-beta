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
    prompt: "Fix every issue listed in this Fallow static analysis report by changing code so the analysis no longer reports it.\n\n{checklist}\n\nRules:\n- Do NOT add suppression comments (e.g. eslint-disable, @ts-ignore, fallow-ignore, // @ts-expect-error).\n- Do NOT delete or skip tests, narrow analyzer scope, or move files out of the analysis path.\n- Do NOT mark issues as \"intentional,\" \"won't fix,\" or \"false positive.\" There are no false positives.\n- Fix root causes: remove genuinely dead code, deduplicate logic, refactor complex functions.\n- If an issue truly cannot be fixed by code change, leave it untouched and list it explicitly in your final summary. Do not paper over it.\n\nA re-run of `fallow` after your changes must report fewer issues, not the same set with suppressions added."
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
