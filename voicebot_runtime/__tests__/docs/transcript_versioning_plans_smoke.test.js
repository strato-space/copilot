const fs = require('fs');
const path = require('path');

const readPlanDoc = (name) => {
  const runtimeRoot = path.join(__dirname, '..', '..');
  const copilotRoot = path.join(runtimeRoot, '..');
  return fs.readFileSync(path.join(copilotRoot, 'docs', 'voicebot-plan-sync', name), 'utf8');
};

describe('voicebot plan sync parity: event-log inputs + transcript version contract', () => {
  it('keeps the source event-log/edit/rollback planning input in repo', () => {
    const req = readPlanDoc('edit-event-log-req.md');

    expect(req).toMatch(/event-log/i);
    expect(req).toMatch(/edit\/delete\/rollback/i);
    expect(req).toMatch(/приоритет релиза|release priority/i);
  });

  it('locks canonical immutable transcription chain transcription_raw -> transcription', () => {
    const diarize = readPlanDoc('gpt-4o-transcribe-diarize-plan.md');

    expect(diarize).toMatch(/transcription_raw\s*[-=]>\s*transcription/i);
    expect(diarize).toMatch(/write-once|immutable/i);
    expect(diarize).toMatch(/legacy|derived/i);
  });

  it('documents session-level transcript versions and final effective transcript response', () => {
    const draft = readPlanDoc('implementation-draft-v1.md');

    expect(draft).toMatch(/Transcript versions are stored on the session object/i);
    expect(draft).toMatch(/final effective transcript/i);
  });
});
