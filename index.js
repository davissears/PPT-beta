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
  formatPreAgentSummary,
} from './report.js';

export const MAX_ROUNDS = 3;

function noProgressStop(remainingCount, prevRemainingCount) {
  const prev = typeof prevRemainingCount === 'number' ? prevRemainingCount : Infinity;
  return remainingCount >= prev ? 'no-progress' : null;
}

function stopReason({ remainingCount, prevRemainingCount, round, maxRounds, userConfirmed }) {
  if (remainingCount === 0) return 'no-remaining';
  if (!userConfirmed) return 'user-declined';
  if (round >= maxRounds) return 'max-rounds';
  return noProgressStop(remainingCount, prevRemainingCount);
}

export function shouldRetry(opts) {
  const reason = stopReason(opts);
  return reason ? { retry: false, reason } : { retry: true };
}

export async function writeReport(report, dir) {
  const reportDir = path.join(dir, '_ppt-report');
  await fsPromises.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${Date.now()}.json`);
  await fsPromises.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  return reportPath;
}

async function promptDirectory() {
  const { dir } = await inquirer.prompt([
    {
      type: 'input',
      name: 'dir',
      message: 'Directory to analyse:',
      default: process.cwd(),
    },
  ]);
  return dir;
}

function updateSpinner(spinner, success, label) {
  if (success) spinner.succeed(chalk.green(label));
  else spinner.fail(chalk.red(label));
}

async function runAnalysesWithSpinners(dir, analysisKeys) {
  const spinners = {};
  for (const key of analysisKeys) spinners[key] = ora(key).start();
  const results = await runFallow(dir);
  for (const key of analysisKeys) {
    updateSpinner(spinners[key], results[key] && results[key].success, key);
  }
  return results;
}

async function promptForAnalyses(analysisKeys, results) {
  const { selectedKeys } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedKeys',
      message: 'Select analyses to include in the report:',
      choices: analysisKeys.map((key) => ({
        name: key,
        value: key,
        checked: results[key] && results[key].success === true,
      })),
    },
  ]);
  return selectedKeys;
}

function buildInitialReport(dir, selectedKeys, results) {
  const selectedEntries = {};
  for (const key of selectedKeys) selectedEntries[key] = results[key];
  const report = {
    directory: dir,
    timestamp: new Date().toISOString(),
    analyses: { ...selectedEntries },
  };
  const summaryBefore = summarizeReport(report);
  report.checklist = formatChecklist(summaryBefore);
  return { report, summaryBefore, selectedEntries };
}

function agentInfo(config) {
  const agent = config.agent || {};
  return { name: agent.name || 'agent', command: agent.command || '' };
}

function printPreAgentSummary(summaryBefore, config, dir, reportPath) {
  const { name: agentName, command } = agentInfo(config);
  console.log(
    '\n' +
      formatPreAgentSummary(
        {
          counts: summaryBefore.countsByKind,
          total: summaryBefore.total,
          agentName,
          command,
          dir,
          reportPath,
        },
        { color: true },
      ) +
      '\n',
  );
}

async function verifyAgainst(dir, selectedKeys, prevSummary, baseLabel, reportDir) {
  const verifySpinner = ora('Verifying with Fallow...').start();
  let verifyResults;
  try {
    verifyResults = await runFallow(dir);
    verifySpinner.succeed(chalk.green('Verifying with Fallow...'));
  } catch (err) {
    verifySpinner.fail(chalk.red('Verifying with Fallow...'));
    throw err;
  }
  const verifyEntries = {};
  for (const key of selectedKeys) verifyEntries[key] = verifyResults[key];
  const verifyReport = {
    directory: dir,
    timestamp: new Date().toISOString(),
    analyses: { ...verifyEntries },
  };
  const summaryAfter = summarizeReport(verifyReport);
  const diff = diffSummaries(prevSummary, summaryAfter);
  console.log(formatDiff(diff, { color: true }));
  const verificationPath = path.join(reportDir, `${baseLabel}-verification.json`);
  await fsPromises.writeFile(
    verificationPath,
    JSON.stringify({ before: prevSummary, after: summaryAfter, diff }, null, 2),
    'utf8',
  );
  return { summaryAfter, diff };
}

async function promptRetry(remainingCount) {
  const { retry } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'retry',
      message: `${remainingCount} issue${remainingCount === 1 ? '' : 's'} still remaining. Retry with the agent?`,
      default: false,
    },
  ]);
  return retry;
}

async function runRetryRound({ dir, selectedEntries, config, reportBase, reportDir, diff, round }) {
  const retryChecklist = formatChecklistFromIssues(diff.remaining);
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
  await invokeAgent(config.agent, roundPath, dir, { checklist: retryChecklist });
  return nextRound;
}

async function verifyLoop({ dir, selectedKeys, selectedEntries, config, summaryBefore, reportBase, reportDir }) {
  let { diff } = await verifyAgainst(dir, selectedKeys, summaryBefore, reportBase, reportDir);
  let round = 1;
  let prevRemainingCount = summaryBefore.total;
  let overallDiff = diff;

  while (diff.remainingCount > 0 && round < MAX_ROUNDS) {
    const userConfirmed = await promptRetry(diff.remainingCount);
    const decision = shouldRetry({
      remainingCount: diff.remainingCount,
      prevRemainingCount,
      round,
      maxRounds: MAX_ROUNDS,
      userConfirmed,
    });
    if (!decision.retry) break;
    prevRemainingCount = diff.remainingCount;
    round = await runRetryRound({ dir, selectedEntries, config, reportBase, reportDir, diff, round });
    ({ diff } = await verifyAgainst(dir, selectedKeys, summaryBefore, `${reportBase}-round-${round}`, reportDir));
    overallDiff = diff;
  }

  return { overallDiff, round };
}

function finalLineColor(overallDiff) {
  if (overallDiff.introducedCount > 0) return chalk.red;
  if (overallDiff.remainingCount > 0) return chalk.yellow;
  return chalk.green;
}

function printFinalResults(overallDiff, round, reportDir) {
  const finalLine = `Final: ${overallDiff.fixedCount} fixed, ${overallDiff.remainingCount} remaining, ${overallDiff.introducedCount} introduced over ${round} round${round === 1 ? '' : 's'}.`;
  console.log(finalLineColor(overallDiff)(finalLine));
  if (overallDiff.remainingCount === 0 && overallDiff.introducedCount === 0) {
    console.log(chalk.green('All Fallow issues resolved.'));
  } else {
    console.log(chalk.yellow(`Some issues remain — see verification report at ${reportDir}.`));
  }
}

export async function mainFlow() {
  const dir = await promptDirectory();
  const analysisKeys = ['dead-code', 'dupes', 'health'];
  const results = await runAnalysesWithSpinners(dir, analysisKeys);
  const selectedKeys = await promptForAnalyses(analysisKeys, results);
  if (selectedKeys.length === 0) {
    console.log(chalk.red('No analyses selected. Exiting.'));
    return;
  }
  const { report, summaryBefore, selectedEntries } = buildInitialReport(dir, selectedKeys, results);
  const reportPath = await writeReport(report, dir);
  const config = await loadConfig();
  printPreAgentSummary(summaryBefore, config, dir, reportPath);
  await invokeAgent(config.agent, reportPath, dir, { checklist: report.checklist });
  const reportDir = path.dirname(reportPath);
  const reportBase = path.basename(reportPath, '.json');
  const { overallDiff, round } = await verifyLoop({
    dir,
    selectedKeys,
    selectedEntries,
    config,
    summaryBefore,
    reportBase,
    reportDir,
  });
  printFinalResults(overallDiff, round, reportDir);
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
