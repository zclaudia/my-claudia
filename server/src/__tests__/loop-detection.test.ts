import { describe, it, expect } from 'vitest';
import { generateToolSignature, detectLoop } from '../loop-detection';

describe('generateToolSignature', () => {
  describe('Bash commands', () => {
    it('should generate specific signature for git commands', () => {
      const result = generateToolSignature('Bash', { command: 'git status' });
      expect(result).toBe('Bash:git status');
    });

    it('should generate specific signature for npm commands', () => {
      const result = generateToolSignature('Bash', { command: 'npm test' });
      expect(result).toBe('Bash:npm test');
    });

    it('should handle complex bash commands', () => {
      const result = generateToolSignature('Bash', { command: 'find . -name "*.ts" -type f' });
      expect(result).toBe('Bash:find . "*.ts"');
    });

    it('should distinguish different bash commands', () => {
      const gitCall = generateToolSignature('Bash', { command: 'git status' });
      const npmCall = generateToolSignature('Bash', { command: 'npm test' });
      const lsCall = generateToolSignature('Bash', { command: 'ls -la' });

      expect(gitCall).toBe('Bash:git status');
      expect(npmCall).toBe('Bash:npm test');
      expect(lsCall).toBe('Bash:ls');
      expect(gitCall).not.toBe(npmCall);
    });
  });

  describe('File operations', () => {
    it('should include parent directory for file operations', () => {
      const result = generateToolSignature('Read', { file_path: '/project/src/config.json' });
      expect(result).toBe('Read:src/config.json');
    });

    it('should distinguish files in different directories', () => {
      const srcConfig = generateToolSignature('Edit', { file_path: '/project/src/config.json' });
      const testConfig = generateToolSignature('Edit', { file_path: '/project/test/config.json' });

      expect(srcConfig).toBe('Edit:src/config.json');
      expect(testConfig).toBe('Edit:test/config.json');
      expect(srcConfig).not.toBe(testConfig);
    });

    it('should handle single-level file paths', () => {
      const result = generateToolSignature('Read', { file_path: '/project/README.md' });
      expect(result).toBe('Read:README.md');
    });

    it('should handle deeply nested paths', () => {
      const result = generateToolSignature('Write', {
        file_path: '/project/apps/desktop/src/components/Button.tsx'
      });
      expect(result).toBe('Write:components/Button.tsx');
    });

    it('should work for Read, Write, and Edit', () => {
      const readResult = generateToolSignature('Read', { file_path: '/app/src/file.ts' });
      const writeResult = generateToolSignature('Write', { file_path: '/app/src/file.ts' });
      const editResult = generateToolSignature('Edit', { file_path: '/app/src/file.ts' });

      expect(readResult).toBe('Read:src/file.ts');
      expect(writeResult).toBe('Write:src/file.ts');
      expect(editResult).toBe('Edit:src/file.ts');
    });
  });

  describe('Grep operations', () => {
    it('should include pattern in signature', () => {
      const result = generateToolSignature('Grep', { pattern: 'TODO' });
      expect(result).toBe('Grep:TODO');
    });

    it('should truncate long patterns', () => {
      const result = generateToolSignature('Grep', {
        pattern: 'This is a very long search pattern that should be truncated'
      });
      expect(result).toBe('Grep:This is a very long search pat');
      expect(result.length).toBeLessThanOrEqual(35); // "Grep:" + 30 chars
    });

    it('should distinguish different grep patterns', () => {
      const todo = generateToolSignature('Grep', { pattern: 'TODO' });
      const fixme = generateToolSignature('Grep', { pattern: 'FIXME' });

      expect(todo).toBe('Grep:TODO');
      expect(fixme).toBe('Grep:FIXME');
      expect(todo).not.toBe(fixme);
    });
  });

  describe('Other tools', () => {
    it('should use tool name as signature for unknown tools', () => {
      const result = generateToolSignature('CustomTool', { foo: 'bar' });
      expect(result).toBe('CustomTool');
    });

    it('should handle tools without input', () => {
      const result = generateToolSignature('Task');
      expect(result).toBe('Task');
    });

    it('should handle tools with empty input', () => {
      const result = generateToolSignature('TodoWrite', {});
      expect(result).toBe('TodoWrite');
    });
  });
});

describe('detectLoop', () => {
  describe('Basic loop detection', () => {
    it('should detect simple repeating pattern (period 2)', () => {
      const toolCalls = [
        'Read:file', 'Edit:file', 'Read:file', 'Edit:file', 'Read:file', 'Edit:file'
      ];
      const result = detectLoop(toolCalls);
      expect(result.detected).toBe(true);
      expect(result.pattern).toBe('Read:file → Edit:file');
    });

    it('should detect repeating pattern (period 3)', () => {
      const toolCalls = [
        'Read:a', 'Edit:b', 'Grep:c',
        'Read:a', 'Edit:b', 'Grep:c',
        'Read:a', 'Edit:b', 'Grep:c'
      ];
      const result = detectLoop(toolCalls);
      expect(result.detected).toBe(true);
      expect(result.pattern).toBe('Read:a → Edit:b → Grep:c');
    });

    it('should detect repeating pattern (period 4)', () => {
      const toolCalls = [
        'Read:a', 'Edit:b', 'Grep:c', 'Bash:d',
        'Read:a', 'Edit:b', 'Grep:c', 'Bash:d',
        'Read:a', 'Edit:b', 'Grep:c', 'Bash:d'
      ];
      const result = detectLoop(toolCalls);
      expect(result.detected).toBe(true);
      expect(result.pattern).toBe('Read:a → Edit:b → Grep:c → Bash:d');
    });
  });

  describe('No loop detection', () => {
    it('should NOT detect loop with insufficient calls', () => {
      const toolCalls = ['Read:file', 'Edit:file', 'Read:file'];
      const result = detectLoop(toolCalls);
      expect(result.detected).toBe(false);
    });

    it('should NOT detect loop with different commands', () => {
      const toolCalls = [
        'Bash:git', 'Bash:npm', 'Bash:ls',
        'Bash:git', 'Bash:npm', 'Bash:ls'
      ];
      const result = detectLoop(toolCalls);
      expect(result.detected).toBe(false);
    });

    it('should NOT detect loop with different files', () => {
      const toolCalls = [
        'Edit:src/a.ts', 'Edit:src/b.ts', 'Edit:src/c.ts',
        'Edit:src/d.ts', 'Edit:src/e.ts', 'Edit:src/f.ts'
      ];
      const result = detectLoop(toolCalls);
      expect(result.detected).toBe(false);
    });

    it('should NOT detect loop with no pattern', () => {
      const toolCalls = [
        'Read:a', 'Write:b', 'Edit:c', 'Bash:d', 'Grep:e', 'Read:f'
      ];
      const result = detectLoop(toolCalls);
      expect(result.detected).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should return false for empty array', () => {
      const result = detectLoop([]);
      expect(result.detected).toBe(false);
    });

    it('should return false for array with 5 elements', () => {
      const toolCalls = ['a', 'b', 'c', 'd', 'e'];
      const result = detectLoop(toolCalls);
      expect(result.detected).toBe(false);
    });

    it('should detect loop at exactly 6 elements', () => {
      const toolCalls = ['a', 'b', 'a', 'b', 'a', 'b'];
      const result = detectLoop(toolCalls);
      expect(result.detected).toBe(true);
      expect(result.pattern).toBe('a → b');
    });

    it('should detect loop with partial match at end', () => {
      const toolCalls = [
        'Read:a', 'Edit:b', 'Grep:c',
        'Read:a', 'Edit:b', 'Grep:c',
        'Read:a', 'Edit:b' // Partial third cycle
      ];
      const result = detectLoop(toolCalls);
      expect(result.detected).toBe(false); // Needs full 3 cycles
    });

    it('should detect loop in long history', () => {
      const toolCalls = [
        'Bash:git', 'Bash:ls', // Some initial calls
        'Read:a', 'Edit:b', // Start of pattern
        'Read:a', 'Edit:b', // Second iteration
        'Read:a', 'Edit:b'  // Third iteration
      ];
      const result = detectLoop(toolCalls);
      expect(result.detected).toBe(true);
      expect(result.pattern).toBe('Read:a → Edit:b');
    });
  });

  describe('Real-world scenarios', () => {
    it('should detect: Read same file → Edit same file loop', () => {
      const toolCalls = [
        'Read:src/server.ts', 'Edit:src/server.ts',
        'Read:src/server.ts', 'Edit:src/server.ts',
        'Read:src/server.ts', 'Edit:src/server.ts'
      ];
      const result = detectLoop(toolCalls);
      expect(result.detected).toBe(true);
      expect(result.pattern).toBe('Read:src/server.ts → Edit:src/server.ts');
    });

    it('should NOT detect: Read different files → Edit different files', () => {
      const toolCalls = [
        'Read:src/a.ts', 'Edit:src/a.ts',
        'Read:src/b.ts', 'Edit:src/b.ts',
        'Read:src/c.ts', 'Edit:src/c.ts'
      ];
      const result = detectLoop(toolCalls);
      expect(result.detected).toBe(false);
    });

    it('should detect: Grep pattern → Edit result loop', () => {
      const toolCalls = [
        'Grep:TODO', 'Edit:src/file.ts',
        'Grep:TODO', 'Edit:src/file.ts',
        'Grep:TODO', 'Edit:src/file.ts'
      ];
      const result = detectLoop(toolCalls);
      expect(result.detected).toBe(true);
      expect(result.pattern).toBe('Grep:TODO → Edit:src/file.ts');
    });

    it('should NOT detect: Different bash commands in sequence', () => {
      const toolCalls = [
        'Bash:git', 'Bash:npm', 'Bash:ls',
        'Bash:git', 'Bash:npm', 'Bash:ls',
        'Bash:git', 'Bash:npm', 'Bash:ls'
      ];
      const result = detectLoop(toolCalls);
      expect(result.detected).toBe(false); // Period 3, but they're all different Bash commands
    });

    it('should handle mixed tool types in pattern', () => {
      const toolCalls = [
        'Read:src/api.ts', 'Grep:fetch', 'Edit:src/api.ts',
        'Read:src/api.ts', 'Grep:fetch', 'Edit:src/api.ts',
        'Read:src/api.ts', 'Grep:fetch', 'Edit:src/api.ts'
      ];
      const result = detectLoop(toolCalls);
      expect(result.detected).toBe(true);
      expect(result.pattern).toBe('Read:src/api.ts → Grep:fetch → Edit:src/api.ts');
    });
  });
});
