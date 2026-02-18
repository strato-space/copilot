import fs from 'node:fs';
import path from 'node:path';

describe('AudioUploader byte-level upload progress', () => {
  const uploaderPath = path.resolve(process.cwd(), 'src/components/voice/AudioUploader.tsx');
  const storePath = path.resolve(process.cwd(), 'src/store/voiceBotStore.ts');
  const uploaderSource = fs.readFileSync(uploaderPath, 'utf8');
  const storeSource = fs.readFileSync(storePath, 'utf8');

  it('passes onUploadProgress through to axios and does not force multipart Content-Type', () => {
    expect(storeSource).toContain('if (opt?.onUploadProgress)');
    expect(storeSource).toContain('requestConfig.onUploadProgress = opt.onUploadProgress;');
    expect(storeSource).not.toContain("'Content-Type': 'multipart/form-data'");
  });

  it('computes progress by uploaded bytes (not per-file index) and renders MB progress', () => {
    expect(uploaderSource).toContain('const onUploadProgress');
    expect(uploaderSource).toContain('evt.loaded');
    expect(uploaderSource).toContain('overallLoaded / totalBytes');

    // Regression: progress should not be based on file index only.
    expect(uploaderSource).not.toContain('((index + 1) / validFiles.length)');
    expect(uploaderSource).not.toContain('for (const [index, file] of validFiles.entries())');

    // UI feedback includes MB counters.
    expect(uploaderSource).toContain('MB /');
  });

  it('shows helpful error hints for common failures (413/network/timeout)', () => {
    expect(uploaderSource).toContain('status === 413');
    expect(uploaderSource).toContain('ECONNABORTED');
    expect(uploaderSource).toContain("includes('network')");
  });
});
