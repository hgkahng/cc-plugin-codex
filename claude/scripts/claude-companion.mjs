#!/usr/bin/env node
import { cwd } from 'node:process';
import { closeSync, openSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { parseCommand } from './lib/parse-command.mjs';
import { loadRuntimeConfig, getStateRoot } from './lib/runtime-config.mjs';
import { runStatus, runResult, runCancel } from './lib/operations/jobs.mjs';
import { runDelegate, runDelegateCore } from './lib/operations/delegate.mjs';
import { createJob, listJobs, updateJob } from './lib/jobs-store.mjs';
import { scriptsDir } from './lib/plugin-paths.mjs';

function printLine(value) {
  process.stdout.write(value.endsWith('\n') ? value : `${value}\n`);
}

async function spawnBackgroundWorker(jobId, parsed, logFilePath) {
  await mkdir(dirname(logFilePath), { recursive: true });
  const logFile = openSync(logFilePath, 'a');
  try {
    const args = [join(scriptsDir, 'run-background-job.mjs'), jobId];

    if (parsed.flags.model) {
      args.push('--model', parsed.flags.model);
    }

    if (parsed.flags.effort) {
      args.push('--effort', parsed.flags.effort);
    }

    const child = spawn('node', args, {
      cwd: cwd(),
      detached: true,
      env: process.env,
      stdio: ['ignore', logFile, logFile],
    });
    child.unref();
    return {
      pid: child.pid,
      processGroupId: child.pid,
    };
  } finally {
    closeSync(logFile);
  }
}

async function main(argv = process.argv.slice(2)) {
  const parsed = parseCommand(argv);
  const config = await loadRuntimeConfig();
  const stateRoot = getStateRoot();
  const deps = {
    config,
    stateRoot,
    workspaceRoot: cwd(),
    env: process.env,
    runDelegateCore: (nextParsed, sessionId) =>
      runDelegateCore(
        {
          ...nextParsed,
          flags: {
            ...nextParsed.flags,
            model: nextParsed.flags.model ?? config.defaultModel,
            effort: nextParsed.flags.effort ?? config.defaultEffort,
          },
        },
        sessionId,
        process.env,
      ),
    createJob,
    listJobs,
    updateJob,
    spawnBackgroundWorker,
  };

  let result;
  switch (parsed.command) {
    case 'status':
      result = await runStatus(parsed, deps);
      break;
    case 'result':
      result = await runResult(parsed, deps);
      break;
    case 'cancel':
      result = await runCancel(parsed, deps);
      break;
    case 'delegate':
      result = await runDelegate(parsed, deps);
      break;
    default:
      throw new Error(`Unknown command: ${parsed.command}. Expected one of: delegate, status, result, cancel.`);
  }

  printLine(parsed.flags.json ? JSON.stringify(result, null, 2) : result.output);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
