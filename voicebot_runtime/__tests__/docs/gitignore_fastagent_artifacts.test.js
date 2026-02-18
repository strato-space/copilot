const fs = require('fs');
const path = require('path');

describe('Gitignore parity for fast-agent local artifacts', () => {
  it('ignores agents/.venv and agents/logs in copilot root .gitignore', () => {
    const runtimeRoot = path.join(__dirname, '..', '..');
    const copilotRoot = path.join(runtimeRoot, '..');
    const gitignore = fs.readFileSync(path.join(copilotRoot, '.gitignore'), 'utf8');

    expect(gitignore).toMatch(/(^|\n)agents\/\.venv\/(\n|$)/);
    expect(gitignore).toMatch(/(^|\n)agents\/logs\/(\n|$)/);
  });
});
