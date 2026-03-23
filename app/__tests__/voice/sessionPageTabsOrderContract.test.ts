import fs from 'node:fs';
import path from 'node:path';

describe('SessionPage tabs contract', () => {
  const pagePath = path.resolve(process.cwd(), 'src/pages/voice/SessionPage.tsx');
  const source = fs.readFileSync(pagePath, 'utf8');

  it('keeps Саммари and Ревью right after categorization and Log tab at the end', () => {
    const idxTranscription = source.indexOf("key: '1'");
    const idxCategorization = source.indexOf("key: '2'");
    const idxSummary = source.indexOf("key: 'summary'");
    const idxReview = source.indexOf("key: 'review'");
    const idxTasks = source.indexOf("key: 'operops_tasks'");
    const idxScreenshort = source.indexOf("key: 'screenshort'");
    const idxLog = source.indexOf("key: 'log'");

    expect(idxTranscription).toBeGreaterThanOrEqual(0);
    expect(idxCategorization).toBeGreaterThan(idxTranscription);
    expect(idxSummary).toBeGreaterThan(idxCategorization);
    expect(idxReview).toBeGreaterThan(idxSummary);
    expect(idxTasks).toBeGreaterThan(idxReview);
    expect(idxScreenshort).toBeGreaterThan(idxTasks);
    expect(idxLog).toBeGreaterThan(idxScreenshort);
  });
});
