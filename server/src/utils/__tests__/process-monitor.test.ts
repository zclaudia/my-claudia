import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: mockExecFile,
}));

import { ProcessMonitor } from '../process-monitor.js';

describe('ProcessMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports leaked descendant processes when no runs are active', async () => {
    mockExecFile.mockImplementation((_cmd, _args, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, {
        stdout: `${process.pid} 1 500 node node server.js\n200 ${process.pid} 180 claude claude --resume\n`,
        stderr: '',
      });
    });

    const onLeakDetected = vi.fn();
    const monitor = new ProcessMonitor(() => 0, onLeakDetected, { minElapsedSeconds: 60 });

    const report = await monitor.check();

    expect(report?.leakedProcesses).toEqual([
      expect.objectContaining({
        pid: 200,
        ppid: process.pid,
        command: 'claude',
        elapsedSeconds: 180,
      }),
    ]);
    expect(onLeakDetected).toHaveBeenCalledWith(expect.objectContaining({
      leakedProcesses: expect.arrayContaining([
        expect.objectContaining({ pid: 200 }),
      ]),
    }));
  });

  it('skips leak detection while runs are active', async () => {
    mockExecFile.mockImplementation((_cmd, _args, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, {
        stdout: `${process.pid} 1 500 node node server.js\n201 ${process.pid} 240 claude claude --resume\n`,
        stderr: '',
      });
    });

    const onLeakDetected = vi.fn();
    const monitor = new ProcessMonitor(() => 1, onLeakDetected, { minElapsedSeconds: 60 });

    const report = await monitor.check();

    expect(report).toBeNull();
    expect(onLeakDetected).not.toHaveBeenCalled();
  });

  it('kills leaked processes on forced cleanup', async () => {
    mockExecFile.mockImplementation((_cmd, _args, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, {
        stdout: `${process.pid} 1 500 node node server.js\n202 ${process.pid} 300 claude claude --resume\n`,
        stderr: '',
      });
    });

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const monitor = new ProcessMonitor(() => 0, vi.fn(), { minElapsedSeconds: 60 });

    await monitor.check(true);

    expect(killSpy).toHaveBeenCalledWith(202, 'SIGTERM');
    killSpy.mockRestore();
  });

  it('returns skipped_active_runs when manual cleanup is requested with active runs', async () => {
    const monitor = new ProcessMonitor(() => 2, vi.fn(), { minElapsedSeconds: 60 });

    const result = await monitor.cleanupNow();

    expect(result).toEqual({
      status: 'skipped_active_runs',
      leakedCount: 0,
      killedCount: 0,
      activeRunCount: 2,
    });
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('ignores the monitor ps helper when it appears as a descendant', async () => {
    mockExecFile.mockImplementation((_cmd, _args, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, {
        stdout: `${process.pid} 1 120 node node server.js\n203 ${process.pid} 121 ps ps -e -o pid=,ppid=,etimes=,comm=,args=\n`,
        stderr: '',
      });
    });

    const onLeakDetected = vi.fn();
    const monitor = new ProcessMonitor(() => 0, onLeakDetected, { minElapsedSeconds: 60 });

    const report = await monitor.check();

    expect(report).toBeNull();
    expect(onLeakDetected).not.toHaveBeenCalled();
  });

  it('ignores descendants with impossible elapsed times', async () => {
    mockExecFile.mockImplementation((_cmd, _args, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, {
        stdout: `${process.pid} 1 120 node node server.js\n204 ${process.pid} 4123168608 ps ps -e -o pid=,ppid=,etimes=,comm=,args=\n205 ${process.pid} 180 claude claude --resume\n`,
        stderr: '',
      });
    });

    const onLeakDetected = vi.fn();
    const monitor = new ProcessMonitor(() => 0, onLeakDetected, { minElapsedSeconds: 60 });

    const report = await monitor.check();

    expect(report?.leakedProcesses).toEqual([
      expect.objectContaining({
        pid: 205,
        ppid: process.pid,
        command: 'claude',
        elapsedSeconds: 180,
      }),
    ]);
    expect(onLeakDetected).toHaveBeenCalledWith(expect.objectContaining({
      leakedProcesses: expect.arrayContaining([
        expect.objectContaining({ pid: 205 }),
      ]),
    }));
  });
});
