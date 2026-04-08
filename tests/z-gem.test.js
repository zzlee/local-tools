const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');

describe('z-gem', () => {
  it('should exit with code 1 and show error when piped input is empty', (done) => {
    const binPath = path.resolve(__dirname, '../bin/z-gem');
    const templatePath = path.resolve(__dirname, 'mock-template');

    // We mock GEMINI_API_KEY to bypass the initial check
    const child = spawn('node', [binPath, templatePath], {
      env: { ...process.env, GEMINI_API_KEY: 'mock-key' }
    });

    let stderr = '';
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      try {
        assert.strictEqual(code, 1, `Expected exit code 1 but got ${code}`);
        assert.ok(stderr.includes('Error: No input provided on stdin for piped mode.'), `Expected error message not found in stderr: ${stderr}`);
        done();
      } catch (err) {
        done(err);
      }
    });

    child.stdin.end(); // Send empty input
  });
});
