import { spawn, spawnSync } from 'node:child_process';

export const DEFAULT_TIMEOUT_MS = 4 * 60 * 60 * 1000;

// CLAUDE_COMPANION_TIMEOUT_MS overrides the 4-hour limit on one Claude run.
export function resolveTimeoutMs(env = process.env) {
  const value = Number(env.CLAUDE_COMPANION_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

function formatDuration(ms) {
  return ms >= 3_600_000 && ms % 3_600_000 === 0 ? `${ms / 3_600_000} hours` : ms >= 60_000 ? `${Math.round(ms / 60_000)} minutes` : `${Math.round(ms / 1000)} seconds`;
}

function killClaude(child) {
  if (process.platform === 'win32') {
    if (child.pid) {
      // Kill the whole tree: with shell:true, child.kill would only
      // terminate the wrapping shell and leave claude running.
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    }
    return;
  }

  child.kill('SIGTERM');
  const forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
  forceKillTimer.unref?.();
}

function quoteWindowsArg(arg) {
  if (/^[\w@%+=:,./-]+$/.test(arg)) {
    return arg;
  }

  return `"${arg.replace(/"/g, '\\"')}"`;
}

function spawnClaude(args, env) {
  // npm installs Claude Code on Windows as a claude.cmd shim, which Node
  // refuses to spawn directly (EINVAL) unless a shell is used. With a shell,
  // Node joins the arguments verbatim, so each one must be quoted here.
  if (process.platform === 'win32') {
    return spawn('claude', args.map(quoteWindowsArg), {
      env,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  return spawn('claude', args, {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

async function runClaudeCommand(args, env, hooks = {}, stdinData = '') {
  const timeoutMs = hooks.timeoutMs ?? resolveTimeoutMs(env);
  return await new Promise((resolve) => {
    const child = spawnClaude(args, env);

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timeoutError;

    const timeoutTimer = setTimeout(() => {
      timeoutError = new Error(
        `Claude Code timed out after ${formatDuration(timeoutMs)}, so the plugin stopped it.`,
      );
      killClaude(child);
    }, timeoutMs);
    timeoutTimer.unref?.();

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutTimer);
      resolve(result);
    };

    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      stdout += text;
      hooks.onStdoutChunk?.(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      stderr += text;
      hooks.onStderrChunk?.(text);
    });

    child.on('close', (code) => {
      finish({ code, stdout, stderr, error: timeoutError });
    });

    child.on('error', (error) => {
      finish({ code: null, stdout, stderr, error: timeoutError ?? error });
    });

    // Input goes over stdin rather than argv: argv has hard per-argument
    // size limits (~128 KB on Linux) that long prompts exceed, and stdin
    // keeps prompts out of process listings. Stdin errors are ignored. If the
    // child fails to start, the 'error' handler above reports it.
    child.stdin.on('error', () => {});
    child.stdin.end(stdinData);
  });
}

export async function runClaudeJson(prompt, extraArgs = [], env = process.env, hooks = {}) {
  return await runClaudeCommand(['-p', '--output-format', 'json', ...extraArgs], env, hooks, prompt);
}

export function withClaudeVersionHint(message) {
  if (/unknown or unexpected option|unknown option|unrecognized option/i.test(message)) {
    return `${message}\nYour installed Claude Code likely predates a flag this plugin relies on (such as --effort). Update Claude Code and retry.`;
  }
  return message;
}

export function parseClaudeEnvelope(stdout) {
  const parsed = JSON.parse(stdout);
  return {
    isError: Boolean(parsed.is_error),
    result: String(parsed.result ?? ''),
    sessionId: parsed.session_id,
  };
}
