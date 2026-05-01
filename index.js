import inquirer from 'inquirer';
import ora from 'ora';
import chalk from 'chalk';
import fsPromises from 'fs/promises';
import path from 'path';

import { runFallow } from './fallow.js';
import { invokeAgent, PRESETS } from './agents.js';
import { loadConfig, saveConfig, isFirstRun } from './config.js';
import {
  summarizeReport,
  formatChecklist,
  formatChecklistFromIssues,
  diffSummaries,
  formatDiff,
} from './report.js';

export const MAX_ROUNDS = 3;

/**
 * Pure decision function for the verify+retry loop. Given the current
 * round's verification outcome, decides whether to run another round.
 *
 * Stop conditions (in order):
 *   - remainingCount === 0          → reason: 'no-remaining'
 *   - userConfirmed === false       → reason: 'user-declined'
 *   - round >= maxRounds            → reason: 'max-rounds'
 *   - remainingCount >= prevRemainingCount (no progress) → reason: 'no-progress'
 *
 * Otherwise returns { retry: true }.
 */
export function shouldRetry({
  remainingCount,
  prevRemainingCount,
  round,
  maxRounds,
  userConfirmed,
}) {
  if (remainingCount === 0) {
    return { retry: false, reason: 'no-remaining' };
  }
  if (!userConfirmed) {
    return { retry: false, reason: 'user-declined' };
  }
  if (round >= maxRounds) {
    return { retry: false, reason: 'max-rounds' };
  }
  if (
    typeof prevRemainingCount === 'number' &&
    remainingCount >= prevRemainingCount
  ) {
    return { retry: false, reason: 'no-progress' };
  }
  return { retry: true };
}

/**
 * Writes a Fallow report to `<dir>/_ppt-report/<timestamp>.json`,
 * creating the directory if needed. The file is persisted (not cleaned up).
 * Returns the absolute path to the written report.
 */
export async function writeReport(report, dir) {
  const reportDir = path.join(dir, '_ppt-report');
  await fsPromises.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${Date.now()}.json`);
  await fsPromises.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  return reportPath;
}

export async function mainFlow() {
  // Step 1: Prompt for directory
  const { dir } = await inquirer.prompt([
    {
      type: 'input',
      name: 'dir',
      message: 'Directory to analyse:',
      default: process.cwd(),
    },
  ]);

  // Step 2: Run analyses with spinners
  const analysisKeys = ['dead-code', 'dupes', 'health'];

  const spinners = {};
  for (const key of analysisKeys) {
    spinners[key] = ora(key).start();
  }

  const results = await runFallow(dir);

  for (const key of analysisKeys) {
    if (results[key]?.success) {
      spinners[key].succeed(chalk.green(key));
    } else {
      spinners[key].fail(chalk.red(key));
    }
  }

  // Step 3: Checkbox prompt for analyses to include
  const { selectedKeys } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedKeys',
      message: 'Select analyses to include in the report:',
      choices: analysisKeys.map((key) => ({
        name: key,
        value: key,
        checked: results[key]?.success === true,
      })),
    },
  ]);

  if (selectedKeys.length === 0) {
    console.log(chalk.red('No analyses selected. Exiting.'));
    return;
  }

  // Step 4: Build report object
  const selectedEntries = {};
  for (const key of selectedKeys) {
    selectedEntries[key] = results[key];
  }

  const report = {
    directory: dir,
    timestamp: new Date().toISOString(),
    analyses: { ...selectedEntries },
  };

  // Build a structured, numbered checklist from the raw analyses so the
  // agent has a canonical list of issues to address. The raw `analyses`
  // are preserved so nothing downstream breaks.
  const summaryBefore = summarizeReport(report);
  report.checklist = formatChecklist(summaryBefore);

  // Step 5: Write report to <dir>/_ppt-report/<timestamp>.json (persisted)
  const reportPath = await writeReport(report, dir);

  // Step 6: Invoke agent
  const config = await loadConfig();
  await invokeAgent(config.agent, reportPath, dir, { checklist: report.checklist });

  // Step 7: Verification — re-run Fallow against the same directory, diff
  // against the original summary, print results, and persist the diff.
  const reportDir = path.dirname(reportPath);
  const reportBase = path.basename(reportPath, '.json');

  async function verifyAgainst(prevSummary, baseLabel) {
    console.log('Verifying...');
    const verifyResults = await runFallow(dir);
    const verifyEntries = {};
    for (const key of selectedKeys) {
      verifyEntries[key] = verifyResults[key];
    }
    const verifyReport = {
      directory: dir,
      timestamp: new Date().toISOString(),
      analyses: { ...verifyEntries },
    };
    const summaryAfter = summarizeReport(verifyReport);
    const diff = diffSummaries(prevSummary, summaryAfter);
    console.log(formatDiff(diff));

    const verificationPath = path.join(reportDir, `${baseLabel}-verification.json`);
    await fsPromises.writeFile(
      verificationPath,
      JSON.stringify({ before: prevSummary, after: summaryAfter, diff }, null, 2),
      'utf8',
    );
    return { summaryAfter, diff };
  }

  // Round 1 verification (against the original summary).
  let { summaryAfter, diff } = await verifyAgainst(summaryBefore, reportBase);

  // Track totals across rounds (relative to the original summaryBefore).
  // The diff returned by `verifyAgainst` is always against `summaryBefore`
  // for round 1; for retry rounds we recompute against the original so the
  // final summary numbers reflect overall progress.
  let round = 1;
  let prevRemainingCount = summaryBefore.total;
  let overallDiff = diff;

  while (true) {
    const remainingCount = diff.remainingCount;

    if (remainingCount === 0) {
      // Nothing left — stop without prompting.
      break;
    }
    if (round >= MAX_ROUNDS) {
      // Out of rounds.
      const stop = shouldRetry({
        remainingCount,
        prevRemainingCount,
        round,
        maxRounds: MAX_ROUNDS,
        userConfirmed: true,
      });
      // stop is for clarity; we just break.
      void stop;
      break;
    }

    // Ask the user whether to retry this round.
    const { retry: userConfirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'retry',
        message: `${remainingCount} issue${remainingCount === 1 ? '' : 's'} still remaining. Retry with the agent?`,
        default: false,
      },
    ]);

    const decision = shouldRetry({
      remainingCount,
      prevRemainingCount,
      round,
      maxRounds: MAX_ROUNDS,
      userConfirmed,
    });

    if (!decision.retry) break;

    // Build a fresh checklist from the remaining issues only.
    const retryChecklist = formatChecklistFromIssues(diff.remaining);

    // Write a per-round report file: <reportBase>-round-<N>.json.
    const nextRound = round + 1;
    const roundReport = {
      directory: dir,
      timestamp: new Date().toISOString(),
      analyses: { ...selectedEntries },
      remaining: diff.remaining,
      checklist: retryChecklist,
      round: nextRound,
    };
    const roundPath = path.join(reportDir, `${reportBase}-round-${nextRound}.json`);
    await fsPromises.writeFile(roundPath, JSON.stringify(roundReport, null, 2), 'utf8');

    // Re-invoke the agent with only the remaining issues.
    await invokeAgent(config.agent, roundPath, dir, { checklist: retryChecklist });

    // Re-verify against the original summary so reported counts are absolute.
    prevRemainingCount = remainingCount;
    round = nextRound;
    const result = await verifyAgainst(summaryBefore, `${reportBase}-round-${round}`);
    summaryAfter = result.summaryAfter;
    diff = result.diff;
    overallDiff = diff;
  }

  console.log(
    `Final: ${overallDiff.fixedCount} fixed, ${overallDiff.remainingCount} remaining, ${overallDiff.introducedCount} introduced over ${round} round${round === 1 ? '' : 's'}.`,
  );
}

export async function runConfigWizard() {
  const { selectedConfig } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedConfig',
      message: 'Select an agent:',
      choices: PRESETS.map((preset) => ({ name: preset.name, value: preset })),
    },
  ]);

  let agentConfig = selectedConfig;

  if (selectedConfig.name === 'Custom') {
    const { command, argsTemplate, mode } = await inquirer.prompt([
      {
        type: 'input',
        name: 'command',
        message: 'Command:',
      },
      {
        type: 'input',
        name: 'argsTemplate',
        message: 'Args template (use {prompt} as placeholder):',
      },
      {
        type: 'list',
        name: 'mode',
        message: 'Invocation mode:',
        choices: ['inline', 'stdin'],
      },
    ]);

    agentConfig = {
      name: 'Custom',
      command,
      args: argsTemplate ? [argsTemplate] : [],
      promptStyle: mode,
      prompt: 'Review and fix the issues in this Fallow report: {reportPath}',
    };
  }

  await saveConfig({ agent: agentConfig });
  console.log(chalk.green(`Agent configured: ${agentConfig.name}`));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    if (process.argv[2] === 'config') {
      runConfigWizard().catch((err) => {
        console.error(chalk.red(err.message ?? String(err)));
        process.exit(1);
      });
    } else {
      if (await isFirstRun()) {
        const { reconfigure } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'reconfigure',
            message: 'No config found. Claude Code is the default agent. Configure a different one?',
            default: false,
          },
        ]);
        if (reconfigure) await runConfigWizard();
      }
      mainFlow().catch((err) => {
        console.error(chalk.red(err.message ?? String(err)));
        process.exit(1);
      });
    }
  })();
}
