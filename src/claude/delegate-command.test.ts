import { describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const loadDelegate = () => import('../../claude/scripts/lib/operations/delegate.mjs');
const loadStore = () => import('../../claude/scripts/lib/jobs-store.mjs');
const loadWorker = () => import('../../claude/scripts/run-background-job.mjs');
const loadClaudeProcess = () => import('../../claude/scripts/lib/claude-process.mjs');

function createFakeClaudeExecutable(body: string) {
  const root = mkdtempSync(join(tmpdir(), 'claude-fake-cli-'));
  const binDir = join(root, 'bin');
  const exePath = join(binDir, 'claude');

  mkdirSync(binDir, { recursive: true });
  writeFileSync(exePath, `#!/bin/sh\n${body}\n`, 'utf8');
  chmodSync(exePath, 0o755);

  return {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
    },
  };
}

describe('delegate operation', () => {
  it('defaults delegate core runs to opus with high effort', async () => {
    const { runDelegateCore } = await loadDelegate();
    const argsFile = join(mkdtempSync(join(tmpdir(), 'claude-args-')), 'args.txt');
    const fake = createFakeClaudeExecutable([
      'printf "%s\\n" "$@" > "$CLAUDE_ARGS_FILE"',
      'printf \'{"is_error":false,"result":"delegated","session_id":"session-defaults"}\'',
    ].join('\n'));

    await runDelegateCore(
      {
        command: 'delegate',
        flags: {
          background: false,
          resume: false,
          fresh: false,
          model: undefined,
          effort: undefined,
        },
        trailingText: 'check defaults',
      },
      null,
      {
        ...fake.env,
        CLAUDE_ARGS_FILE: argsFile,
      },
    );

    const args = readFileSync(argsFile, 'utf8').trim().split('\n');
    expect(args[args.indexOf('--model') + 1]).toBe('opus');
    expect(args[args.indexOf('--effort') + 1]).toBe('high');
  });

  it('streams Claude stdout and stderr chunks while still aggregating the final result', async () => {
    const { runClaudeJson } = await loadClaudeProcess();
    const fake = createFakeClaudeExecutable([
      'printf \'{"is_error":false,\'',
      'sleep 0.1',
      'printf \'"result":"streamed done","session_id":"session-stream"}\'',
      'printf \'progress line\\n\' >&2',
    ].join('\n'));
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const result = await runClaudeJson(
      'Reply with streamed output.',
      ['--model', 'sonnet'],
      fake.env,
      {
        onStdoutChunk: (chunk) => stdoutChunks.push(String(chunk)),
        onStderrChunk: (chunk) => stderrChunks.push(String(chunk)),
      },
    );

    expect(result.stdout).toContain('"session_id":"session-stream"');
    expect(result.stderr).toContain('progress line');
    expect(stdoutChunks.join('')).toBe(result.stdout);
    expect(stderrChunks.join('')).toBe(result.stderr);
  });

  it('spawns a background worker when --background is set and persists a durable logFilePath', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claude-companion-delegate-'));
    const { runDelegate } = await loadDelegate();
    const { createJob, readJob, listJobs, updateJob } = await loadStore();
    const spawnBackgroundWorker = vi.fn(async () => 4242);

    const result = await runDelegate(
      {
        command: 'delegate',
        flags: {
          background: true,
          resume: false,
          fresh: false,
          model: undefined,
          effort: undefined,
        },
        trailingText: 'investigate retry flakiness',
      },
      {
        stateRoot: root,
        workspaceRoot: '/repo/example',
        config: { defaultModel: 'sonnet', defaultEffort: 'medium' },
        createJob,
        updateJob,
        listJobs,
        spawnBackgroundWorker,
      },
    );

    const [job] = await listJobs(root, '/repo/example');
    const stored = await readJob(root, '/repo/example', job.id);

    expect(spawnBackgroundWorker).toHaveBeenCalledWith(
      job.id,
      expect.objectContaining({ trailingText: 'investigate retry flakiness' }),
      stored.logFilePath,
    );
    expect(stored.logFilePath).toMatch(new RegExp(`${job.id}.*\\.log$`));
    expect(result.output).toContain(job.id);
  });

  it('stores new delegate jobs under the delegate kind', async () => {
    const { runDelegate } = await loadDelegate();
    const createJob = vi.fn(async (_root, _workspaceRoot, job) => ({ id: 'job-1', ...job }));
    const runDelegateCore = vi.fn(async () => ({
      sessionId: 'session-delegate',
      rawOutput: 'Delegated',
      parsedPayload: { summary: 'Delegated' },
      renderedOutput: 'Delegated',
    }));

    const result = await runDelegate(
      {
        command: 'delegate',
        flags: {
          background: false,
          resume: false,
          fresh: false,
          model: undefined,
          effort: undefined,
        },
        trailingText: 'investigate default naming',
      },
      {
        stateRoot: '/state',
        workspaceRoot: '/repo/example',
        config: { defaultModel: 'opus', defaultEffort: 'high' },
        createJob,
        updateJob: vi.fn(async (_root, _workspaceRoot, _jobId, patch) => ({ id: 'job-1', ...patch })),
        listJobs: vi.fn(async () => []),
        runDelegateCore,
      },
    );

    expect(createJob).toHaveBeenCalledWith(
      '/state',
      '/repo/example',
      expect.objectContaining({
        kind: 'delegate',
        title: 'Claude delegate',
      }),
    );
    expect(result.output).toContain('Delegated');
  });

  it('reuses the latest delegate session when --resume is set', async () => {
    const { selectDelegateSession } = await loadDelegate();

    const session = selectDelegateSession(
      [
        { id: 'job-1', kind: 'review', sessionId: 'review-1', createdAt: '2026-03-31T21:00:00.000Z' },
        { id: 'job-7', kind: 'delegate', sessionId: 'session-7', createdAt: '2026-03-31T23:00:00.000Z' },
        { id: 'job-8', kind: 'delegate', sessionId: 'session-8', createdAt: '2026-03-31T23:30:00.000Z' },
        { id: 'job-3', kind: 'delegate', sessionId: 'session-3', createdAt: '2026-03-31T22:00:00.000Z' },
      ],
      { resume: true, fresh: false },
    );

    expect(session).toBe('session-8');
  });

  it('scopes implicit --resume to the current Codex thread when a thread id is available', async () => {
    const { selectDelegateSession } = await loadDelegate();
    const jobs = [
      {
        id: 'job-other',
        kind: 'delegate',
        sessionId: 'session-other-window',
        threadId: 'codex-thread-other',
        createdAt: '2026-07-29T02:00:00.000Z',
      },
      {
        id: 'job-mine',
        kind: 'delegate',
        sessionId: 'session-mine',
        threadId: 'codex-thread-mine',
        createdAt: '2026-07-29T01:00:00.000Z',
      },
    ];

    expect(selectDelegateSession(jobs, { resume: true, fresh: false }, 'codex-thread-mine')).toBe('session-mine');
    expect(selectDelegateSession(jobs, { resume: true, fresh: false }, 'codex-thread-unknown')).toBeNull();
    expect(selectDelegateSession(jobs, { resume: true, fresh: false }, null)).toBe('session-other-window');
  });

  it('records the Codex thread id on new delegate jobs when the environment provides one', async () => {
    const { runDelegate } = await loadDelegate();
    const createJob = vi.fn(async (_root, _workspaceRoot, job) => ({ id: 'job-1', ...job }));

    await runDelegate(
      {
        command: 'delegate',
        flags: {
          background: false,
          resume: false,
          fresh: false,
          model: undefined,
          effort: undefined,
        },
        trailingText: 'scoped task',
      },
      {
        stateRoot: '/state',
        workspaceRoot: '/repo/example',
        config: { defaultModel: 'opus', defaultEffort: 'high' },
        env: { CODEX_THREAD_ID: 'codex-thread-123' },
        createJob,
        updateJob: vi.fn(async (_root, _workspaceRoot, _jobId, patch) => ({ id: 'job-1', ...patch })),
        listJobs: vi.fn(async () => []),
        runDelegateCore: vi.fn(async () => ({
          sessionId: 'session-new',
          rawOutput: 'Done',
          parsedPayload: { summary: 'Done' },
          renderedOutput: 'Done',
        })),
      },
    );

    expect(createJob).toHaveBeenCalledWith(
      '/state',
      '/repo/example',
      expect.objectContaining({ threadId: 'codex-thread-123' }),
    );
  });

  it('shows a resume hint when a prior delegate session exists and no routing flag is passed', async () => {
    const { runDelegate } = await loadDelegate();
    const runDelegateCore = vi.fn(async () => ({
      sessionId: 'session-new',
      rawOutput: 'Done',
      parsedPayload: { summary: 'Done' },
      renderedOutput: 'Done',
    }));

    const result = await runDelegate(
      {
        command: 'delegate',
        flags: {
          background: false,
          resume: false,
          fresh: false,
          model: undefined,
          effort: undefined,
        },
        trailingText: 'investigate flaky retries',
      },
      {
        stateRoot: '/state',
        workspaceRoot: '/repo/example',
        config: { defaultModel: 'sonnet', defaultEffort: 'medium' },
        createJob: vi.fn(async (_root, _workspaceRoot, job) => ({ id: 'job-1', ...job })),
        updateJob: vi.fn(async (_root, _workspaceRoot, _jobId, patch) => ({ id: 'job-1', ...patch })),
        listJobs: vi.fn(async () => [
          {
            id: 'job-9',
            kind: 'delegate',
            summary: 'Previous delegate',
            sessionId: 'session-9',
            createdAt: '2026-03-31T23:00:00.000Z',
          },
        ]),
        runDelegateCore,
      },
    );

    expect(runDelegateCore).toHaveBeenCalledWith(expect.anything(), null);
    expect(result.output).toContain('Done');
    expect(result.output).toContain('--resume');
    expect(result.output).toContain('--fresh');
  });

  it('completes a persisted delegate job from the background worker entrypoint', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claude-companion-delegate-'));
    const { createJob, readJob } = await loadStore();
    const { runBackgroundJob } = await loadWorker();
    const runDelegateCore = vi.fn(async () => ({
      sessionId: 'session-42',
      rawOutput: 'Background delegate finished',
      parsedPayload: { summary: 'Background delegate finished' },
      renderedOutput: 'Background delegate finished',
    }));

    const job = await createJob(root, '/repo/example', {
      kind: 'delegate',
      title: 'Claude delegate',
      summary: 'Investigate flaky retries',
      status: 'running',
      phase: 'running',
      logFilePath: join(root, 'logs', 'job-1.log'),
      sessionId: 'session-prior',
    });

    await runBackgroundJob({
      jobId: job.id,
      workspaceRoot: '/repo/example',
      stateRoot: root,
      config: { defaultModel: 'sonnet', defaultEffort: 'medium' },
      log: vi.fn(),
      runDelegateCore,
    });

    const stored = await readJob(root, '/repo/example', job.id);
    expect(runDelegateCore).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: expect.objectContaining({ model: 'sonnet', effort: 'medium' }),
        trailingText: 'Investigate flaky retries',
      }),
      'session-prior',
      expect.objectContaining({
        onStdoutChunk: expect.any(Function),
        onStderrChunk: expect.any(Function),
      }),
    );
    expect(stored.status).toBe('completed');
    expect(stored.phase).toBe('completed');
    expect(stored.sessionId).toBe('session-42');
    expect(stored.renderedOutput).toBe('Background delegate finished');
  });

  it('passes streaming sinks into delegate core and persists a running snapshot before completion', async () => {
    const { runBackgroundJob } = await loadWorker();
    const log = vi.fn();
    const updateJob = vi.fn(async (_stateRoot, _workspaceRoot, _jobId, patch) => ({ id: 'job-1', ...patch }));
    const readJob = vi.fn(async () => ({
      id: 'job-1',
      kind: 'delegate',
      title: 'Claude delegate',
      summary: 'Investigate flaky retries',
      status: 'running',
      phase: 'running',
      sessionId: 'session-prior',
    }));
    const runDelegateCore = vi.fn(async (_parsed, _sessionId, runtime) => {
      runtime?.onStdoutChunk?.('step 1\n');
      runtime?.onStderrChunk?.('step 2\n');
      return {
        sessionId: 'session-next',
        rawOutput: 'Background delegate finished',
        parsedPayload: { summary: 'Background delegate finished' },
        renderedOutput: 'Background delegate finished',
      };
    });

    await runBackgroundJob({
      jobId: 'job-1',
      workspaceRoot: '/repo/example',
      stateRoot: '/state',
      config: { defaultModel: 'sonnet', defaultEffort: 'medium' },
      log,
      readJob,
      updateJob,
      runDelegateCore,
    });

    expect(runDelegateCore).toHaveBeenCalledWith(
      expect.anything(),
      'session-prior',
      expect.objectContaining({
        onStdoutChunk: expect.any(Function),
        onStderrChunk: expect.any(Function),
      }),
    );
    expect(log).toHaveBeenCalledWith('step 1\n');
    expect(log).toHaveBeenCalledWith('step 2\n');
    expect(updateJob).toHaveBeenNthCalledWith(
      1,
      '/state',
      '/repo/example',
      'job-1',
      expect.objectContaining({
        status: 'running',
        phase: 'running',
      }),
    );
    expect(updateJob).toHaveBeenLastCalledWith(
      '/state',
      '/repo/example',
      'job-1',
      expect.objectContaining({
        status: 'completed',
        phase: 'completed',
      }),
    );
  });

  it('does not let a later background completion overwrite a cancelled delegate job', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claude-companion-delegate-'));
    const { createJob, readJob, updateJob } = await loadStore();
    const { runBackgroundJob } = await loadWorker();

    const job = await createJob(root, '/repo/example', {
      kind: 'delegate',
      title: 'Claude delegate',
      summary: 'Investigate flaky retries',
      status: 'running',
      phase: 'running',
      pid: 22222,
      processGroupId: 22222,
      sessionId: 'session-prior',
    });

    await runBackgroundJob({
      jobId: job.id,
      workspaceRoot: '/repo/example',
      stateRoot: root,
      config: { defaultModel: 'sonnet', defaultEffort: 'medium' },
      log: vi.fn(),
      updateJob,
      runDelegateCore: async (_parsed, _sessionId, runtime) => {
        runtime?.onStdoutChunk?.('step 1\n');
        await updateJob(root, '/repo/example', job.id, {
          status: 'cancelled',
          phase: 'cancelled',
          pid: null,
          processGroupId: null,
        });

        return {
          sessionId: 'session-next',
          rawOutput: 'Background delegate finished',
          parsedPayload: { summary: 'Background delegate finished' },
          renderedOutput: 'Background delegate finished',
        };
      },
    });

    const stored = await readJob(root, '/repo/example', job.id);
    expect(stored.status).toBe('cancelled');
    expect(stored.phase).toBe('cancelled');
    expect(stored.pid).toBeNull();
    expect(stored.renderedOutput).not.toBe('Background delegate finished');
    expect(stored.sessionId).toBe('session-prior');
  });

  it('keeps the final terminal write reachable when a background progress write fails', async () => {
    const { runBackgroundJob } = await loadWorker();
    const log = vi.fn();
    const updateJob = vi.fn(async (_stateRoot, _workspaceRoot, _jobId, patch) => {
      if (patch.renderedOutput === 'step 1\n') {
        throw new Error('transient write failure');
      }

      return { id: 'job-1', ...patch };
    });
    const readJob = vi.fn(async () => ({
      id: 'job-1',
      kind: 'delegate',
      title: 'Claude delegate',
      summary: 'Investigate flaky retries',
      status: 'running',
      phase: 'running',
      sessionId: 'session-prior',
    }));
    const runDelegateCore = vi.fn(async (_parsed, _sessionId, runtime) => {
      runtime?.onStdoutChunk?.('step 1\n');
      return {
        sessionId: 'session-next',
        rawOutput: 'Background delegate finished',
        parsedPayload: { summary: 'Background delegate finished' },
        renderedOutput: 'Background delegate finished',
      };
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => {
      unhandled.push(error);
    };

    process.on('unhandledRejection', onUnhandled);
    try {
      const result = await runBackgroundJob({
        jobId: 'job-1',
        workspaceRoot: '/repo/example',
        stateRoot: '/state',
        config: { defaultModel: 'sonnet', defaultEffort: 'medium' },
        log,
        readJob,
        updateJob,
        runDelegateCore,
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(result.status).toBe('completed');
      expect(updateJob).toHaveBeenLastCalledWith(
        '/state',
        '/repo/example',
        'job-1',
        expect.objectContaining({
          status: 'completed',
          phase: 'completed',
          sessionId: 'session-next',
        }),
      );
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
