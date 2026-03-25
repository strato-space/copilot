import fs from 'node:fs';
import path from 'node:path';

describe('SessionStatusWidget processing parity contract', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/voice/SessionStatusWidget.tsx');
  const source = fs.readFileSync(componentPath, 'utf8');

  it('uses canonical runtime activity gate instead of stale footer heuristics', () => {
    expect(source).toContain("import { isSessionRuntimeActive } from '../../utils/voiceSessionTabs';");
    expect(source).toContain('const runtimeActive = isSessionRuntimeActive(voiceBotSession);');
    expect(source).toContain('const hasActiveProcessing = processorPayloads.some((pdata) => pdata.is_processing === true);');
    expect(source).toContain('const hasProcessorFailure = processorPayloads.some((pdata) =>');
    expect(source).toContain('toText(pdata.error).length > 0');
    expect(source).toContain('toText(pdata.error_message).length > 0');
  });

  it('does not constrain footer width with legacy centered max-width wrapper', () => {
    expect(source).toContain('className="voice-session-status-widget w-full text-[12px] leading-[1.1]"');
    expect(source).not.toContain('max-w-[1740px]');
    expect(source).not.toContain('mx-auto');
  });
});
