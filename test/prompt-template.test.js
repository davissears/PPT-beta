import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS } from "../agents.js";
import { DEFAULT_CONFIG } from "../config.js";

function checkPrompt(prompt, label) {
  assert.ok(
    prompt.includes("{checklist}"),
    `${label}: must contain {checklist} placeholder`,
  );
  assert.ok(
    prompt.includes("Do NOT add suppression comments"),
    `${label}: must contain "Do NOT add suppression comments"`,
  );
  assert.ok(
    prompt.includes("There are no false positives"),
    `${label}: must contain "There are no false positives"`,
  );

  const lower = prompt.toLowerCase();
  assert.ok(
    !lower.includes("triage"),
    `${label}: must NOT contain "triage" (case-insensitive)`,
  );
  assert.ok(
    !lower.includes("sub agent"),
    `${label}: must NOT contain "sub agent" (case-insensitive)`,
  );
  assert.ok(
    !lower.includes("subagent"),
    `${label}: must NOT contain "subagent" (case-insensitive)`,
  );

  // Every occurrence of "false positive" must either be preceded by "no "
  // (as in "no false positives") or appear in the prohibition list bullet
  // that explicitly forbids labelling issues as "false positive."
  const needle = "false positive";
  let idx = 0;
  while ((idx = lower.indexOf(needle, idx)) !== -1) {
    const preceding = lower.slice(Math.max(0, idx - 3), idx);
    const context = lower.slice(Math.max(0, idx - 40), idx + needle.length + 5);
    const okPrecededByNo = preceding === "no ";
    const okInProhibition = context.includes('or "false positive."');
    assert.ok(
      okPrecededByNo || okInProhibition,
      `${label}: occurrence of "false positive" at index ${idx} must be in "no false positives" or in the prohibition bullet (context: ${JSON.stringify(context)})`,
    );
    idx += needle.length;
  }
}

test("every PRESETS entry has the new prompt template", () => {
  assert.ok(Array.isArray(PRESETS) && PRESETS.length > 0, "PRESETS must be a non-empty array");
  for (const preset of PRESETS) {
    checkPrompt(preset.prompt, `PRESETS[${preset.name}]`);
  }
});

test("DEFAULT_CONFIG.agent.prompt has the new prompt template", () => {
  checkPrompt(DEFAULT_CONFIG.agent.prompt, "DEFAULT_CONFIG.agent.prompt");
});
