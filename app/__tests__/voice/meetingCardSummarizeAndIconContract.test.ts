import fs from 'node:fs';
import path from 'node:path';

describe('MeetingCard summarize + circle icon alignment contract', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/voice/MeetingCard.tsx');
  const source = fs.readFileSync(componentPath, 'utf8');

  it('keeps manual Summarize trigger with 3-minute cooldown in UI', () => {
    expect(source).toContain('setSummarizeDisabledUntil(Date.now() + 3 * 60 * 1000);');
    expect(source).toContain('const isSummarizeCooldownActive = typeof summarizeDisabledUntil === \'number\' && Date.now() < summarizeDisabledUntil;');
    expect(source).toContain('const result = await triggerSessionReadyToSummarize(voiceBotSession._id);');
    expect(source).toContain('disabled={!voiceBotSession?._id || isSummarizing || isSummarizeCooldownActive}');
    expect(source).toContain('content: projectAssigned ? \'Summarize запущен (проект PMO назначен).\' : \'Summarize запущен.\'');
  });

  it('uses centered icon wrappers for circle session-header action buttons', () => {
    const shapeMatches = source.match(/shape=\"circle\"/g) ?? [];
    expect(shapeMatches.length).toBeGreaterThanOrEqual(3);

    expect(source).toContain('const circleIconButtonClassName = \'inline-flex items-center justify-center');
    expect(source).toContain('const centeredIconClassName = \'inline-flex items-center justify-center leading-none\';');
    expect(source).toContain('icon={<span className={centeredIconClassName}><EditOutlined /></span>}');
    expect(source).toContain('icon={<span className={centeredIconClassName}><RobotOutlined /></span>}');
    expect(source).toContain('icon={<span className={`${centeredIconClassName} text-sm font-semibold`}>∑</span>}');
  });
});
