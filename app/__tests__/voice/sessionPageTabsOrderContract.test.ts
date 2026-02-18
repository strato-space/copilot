import fs from 'node:fs';
import path from 'node:path';

describe('SessionPage tabs contract', () => {
  const pagePath = path.resolve(process.cwd(), 'src/pages/voice/SessionPage.tsx');
  const source = fs.readFileSync(pagePath, 'utf8');

  it('keeps Log tab at the end of tab bar after transcription/categorization/screenshort', () => {
    const idxTranscription = source.indexOf("key: '1'");
    const idxCategorization = source.indexOf("key: '2'");
    const idxScreenshort = source.indexOf("key: 'screenshort'");
    const idxLog = source.indexOf("key: 'log'");

    expect(idxTranscription).toBeGreaterThanOrEqual(0);
    expect(idxCategorization).toBeGreaterThan(idxTranscription);
    expect(idxScreenshort).toBeGreaterThan(idxCategorization);
    expect(idxLog).toBeGreaterThan(idxScreenshort);
  });
});
