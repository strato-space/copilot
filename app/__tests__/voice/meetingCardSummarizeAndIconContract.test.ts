import fs from 'node:fs';
import path from 'node:path';

describe('MeetingCard summarize + circle icon alignment contract', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/voice/MeetingCard.tsx');
  const source = fs.readFileSync(componentPath, 'utf8');

  it('keeps manual Summarize trigger with 3-minute cooldown in UI', () => {
    expect(source).toContain('setSummarizeDisabledUntil(Date.now() + 3 * 60 * 1000);');
    expect(source).toContain('const isSummarizeCooldownActive = typeof summarizeDisabledUntil === \'number\' && Date.now() < summarizeDisabledUntil;');
    expect(source).toContain('const result = await triggerSessionReadyToSummarize(voiceBotSession._id);');
    expect(source).toContain('disabled={!voiceBotSession?._id || uiState.isSummarizing || isSummarizeCooldownActive}');
    expect(source).toContain('content: projectAssigned ? \'Summarize запущен (проект PMO назначен).\' : \'Summarize запущен.\'');
  });

  it('uses centered icon wrappers for circle session-header action buttons', () => {
    const shapeMatches = source.match(/shape=\"circle\"/g) ?? [];
    expect(shapeMatches.length).toBeGreaterThanOrEqual(3);

    expect(source).toContain('const circleIconWrapperStyle: CSSProperties = {');
    expect(source).toContain('const circleIconButtonStyle: CSSProperties = {');
    expect(source).toContain('icon={<span style={circleIconWrapperStyle}><EditOutlined');
    expect(source).toContain('icon={<span style={circleIconWrapperStyle}><RobotOutlined');
    expect(source).toContain("icon={<span style={circleIconWrapperStyle}><span style={{ color: '#1677ff', fontSize: 16, fontWeight: 700 }}>∑</span></span>}");
  });
});
