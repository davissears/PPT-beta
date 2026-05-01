import inquirer from 'inquirer';
import ora from 'ora';
import chalk from 'chalk';
import fsPromises from 'fs/promises';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { runFallow } from './fallow.js';
import { invokeAgent, PRESETS } from './agents.js';
import { loadConfig, saveConfig, isFirstRun } from './config.js';

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

  // Step 5: Write report to OS temp directory
  const reportPath = path.join(os.tmpdir(), `fallow-report-${Date.now()}.json`);
  await fsPromises.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  // Clean up temp file on process exit
  process.on('exit', () => {
    try { fs.unlinkSync(reportPath); } catch {}
  });

  // Step 6: Invoke agent
  const config = await loadConfig();
  await invokeAgent(config.agent, reportPath, dir);
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
