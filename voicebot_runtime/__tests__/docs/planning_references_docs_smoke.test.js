const fs = require('fs');
const path = require('path');

const readCopilotRoot = (name) => {
  const runtimeRoot = path.join(__dirname, '..', '..');
  const copilotRoot = path.join(runtimeRoot, '..');
  return fs.readFileSync(path.join(copilotRoot, name), 'utf8');
};

describe('Planning references docs parity', () => {
  it('keeps implementation draft + transcript versioning references in AGENTS and README', () => {
    const agents = readCopilotRoot('AGENTS.md');
    const readme = readCopilotRoot('README.md');

    for (const content of [agents, readme]) {
      expect(content).toMatch(/docs\/voicebot-plan-sync\/implementation-draft-v1\.md/);
      expect(content).toMatch(/edit-event-log-plan\.md/);
      expect(content).toMatch(/gpt-4o-transcribe-diarize-plan\.md/);
    }
  });

  it('documents close-session outcomes in core docs set', () => {
    const agents = readCopilotRoot('AGENTS.md');
    const readme = readCopilotRoot('README.md');

    expect(agents).toMatch(/close-session|close session|finalization/i);
    expect(readme).toMatch(/close\/finalization|close-session|finalization/i);
  });
});
