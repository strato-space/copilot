import fs from 'node:fs';
import path from 'node:path';

describe('MeetingCard state badge and controls contract', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/voice/MeetingCard.tsx');
  const source = fs.readFileSync(componentPath, 'utf8');

  it('maps FAB/runtime states into session visual state', () => {
    expect(source).toContain("if (!voiceBotSession?.is_active) return 'closed';");
    expect(source).toContain("if (!isThisSessionActiveInFab) return 'ready';");
    expect(source).toContain("if (normalizedFabState === 'recording' || normalizedFabState === 'cutting') return 'recording';");
    expect(source).toContain("if (normalizedFabState === 'paused') return 'paused';");
    expect(source).toContain("if (normalizedFabState === 'final_uploading') return 'finalizing';");
    expect(source).toContain("if (normalizedFabState === 'error') return 'error';");
  });

  it('renders state badge variants for recording/paused/finalizing/error/closed/ready', () => {
    expect(source).toContain("if (sessionVisualState === 'recording') return <span className=\"h-2.5 w-2.5 animate-pulse rounded-full bg-red-500\" />;");
    expect(source).toContain("if (sessionVisualState === 'paused') {");
    expect(source).toContain("if (sessionVisualState === 'finalizing') return <span className=\"text-xs font-semibold leading-none text-emerald-500\">✓</span>;");
    expect(source).toContain("if (sessionVisualState === 'error') return <span className=\"text-xs font-semibold leading-none text-rose-500\">!</span>;");
    expect(source).toContain("if (sessionVisualState === 'closed') return <span className=\"h-2.5 w-2.5 rounded-[2px] bg-blue-500\" />;");
    expect(source).toContain("return <span className=\"h-2.5 w-2.5 rounded-full border border-slate-400\" />;");
  });

  it('keeps session control order New/Rec/Cut/Pause/Done', () => {
    const labels = ['>\n                        New\n                    </Button>', '>\n                        Rec\n                    </Button>', '>\n                        Cut\n                    </Button>', '>\n                        Pause\n                    </Button>', '>\n                        Done\n                    </Button>'];

    let cursor = 0;
    for (const label of labels) {
      const next = source.indexOf(label, cursor);
      expect(next).toBeGreaterThanOrEqual(cursor);
      cursor = next + label.length;
    }
  });
});
