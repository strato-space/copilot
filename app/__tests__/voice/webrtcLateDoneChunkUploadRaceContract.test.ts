import fs from 'node:fs';
import path from 'node:path';

describe('webrtc late post-Done chunk upload race contract', () => {
  const scriptPath = path.resolve(process.cwd(), 'public/webrtc/webrtc-voicebot-lib.js');
  const source = fs.readFileSync(scriptPath, 'utf8');

  function extractFunction(name: string): string {
    const asyncMarker = `async function ${name}(`;
    const syncMarker = `function ${name}(`;
    const asyncStart = source.indexOf(asyncMarker);
    const syncStart = source.indexOf(syncMarker);
    const start = asyncStart >= 0 ? asyncStart : syncStart;
    if (start < 0) throw new Error(`Function not found: ${name}`);
    const paramsStart = source.indexOf('(', start);
    if (paramsStart < 0) throw new Error(`Function params not found: ${name}`);
    let parenDepth = 0;
    let open = -1;
    for (let i = paramsStart; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === '(') parenDepth += 1;
      if (ch === ')') {
        parenDepth -= 1;
        continue;
      }
      if (ch === '{' && parenDepth === 0) {
        open = i;
        break;
      }
    }
    if (open < 0) throw new Error(`Function body not found: ${name}`);
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) return source.slice(start, i + 1);
      }
    }
    throw new Error(`Function closing brace not found: ${name}`);
  }

  it('records successful Done closure and blocks stale post-close uploads with trace metadata', async () => {
    expect(source).toContain('rememberDoneClosedSession(prevSid, transitionId);');
    expect(source).toContain("logApi('upload_audio_blocked_closed_session', trace);");
    expect(source).toContain('const transitionId = resolveTransitionCorrelationId(opts);');

    const normalizeTransitionIdSource = extractFunction('normalizeTransitionId');
    const createTransitionCorrelationIdSource = extractFunction('createTransitionCorrelationId');
    const withTransitionTraceFieldsSource = extractFunction('withTransitionTraceFields');
    const resolveTransitionCorrelationIdSource = extractFunction('resolveTransitionCorrelationId');
    const pruneDoneClosedSessionMetaSource = extractFunction('pruneDoneClosedSessionMeta');
    const rememberDoneClosedSessionSource = extractFunction('rememberDoneClosedSession');
    const getDoneClosedSessionMetaSource = extractFunction('getDoneClosedSessionMeta');
    const buildDoneClosedUploadTraceSource = extractFunction('buildDoneClosedUploadTrace');
    const uploadBlobForLiSource = extractFunction('uploadBlobForLi');
    const finalizeChunkSingleSource = extractFunction('finalizeChunkSingle');

    const runHarness = new Function(
      'deps',
      `
      return (async () => {
        const DONE_CLOSED_SESSION_TTL_MS = 15 * 60 * 1000;
        const DONE_CLOSED_SESSION_MAX_ENTRIES = 128;
        const doneClosedSessionMeta = new Map();
        ${normalizeTransitionIdSource}
        ${createTransitionCorrelationIdSource}
        ${withTransitionTraceFieldsSource}
        ${resolveTransitionCorrelationIdSource}
        ${pruneDoneClosedSessionMetaSource}
        ${rememberDoneClosedSessionSource}
        ${getDoneClosedSessionMetaSource}
        ${buildDoneClosedUploadTraceSource}

        const console = deps.console;
        const logUi = deps.logUi;
        const logApi = deps.logApi;
        const showFabToast = deps.showFabToast;
        const inferSpeakerForLi = () => '';
        const getSessionIdFromDoc = () => '';
        const getSessionIdValue = () => '';
        const normalizeUploadThrownError = () => 'upload_error';
        let isUnloading = false;
        const uploadBlob = deps.uploadBlob;

        ${uploadBlobForLiSource}

        let splitInProgress = true;
        let forceChunk = false;
        let audioChunks = [new Blob(['late-final-chunk'], { type: 'audio/webm' })];
        let mediaRecorder = { mimeType: 'audio/webm' };
        let isRecording = false;
        let recordingMode = 'mixed';
        let modeSwitching = false;
        let MIN_SPEECH_RATIO = 0;
        let speechMsMixed = 0;
        let speechMsByKey = {};
        let speechMsByKeyFallback = {};
        let lastAnalysisTs = 0;
        let chunkIndex = 6;
        let lastChunkStart = Date.now() - 1250;
        const sid = 'sid-closed';
        const micCount = 1;
        const pickBlobTypeFromParts = () => 'audio/webm';
        const resolveSpeechMsForChunk = () => 900;
        const guessAudioExtFromMime = () => '.webm';
        const resolveChunkListTarget = () => ({ list: { insertBefore: () => {} }, doc: {} });
        const getSelectedMicLabel = () => 'Mic 1';
        const micKey = (mi) => 'mic' + mi;
        const cleanupRecordingDests = () => {};
        const createMixedRecorder = () => {};
        const autoUploadChunks = true;
        let latestLi = null;
        let latestStatusMark = null;
        let lateUploadPromise = null;
        const createChunkListItem = (blob, _label, _speechSeconds, filenameOpt, _doc, opts = {}) => {
          const li = {
            _blob: blob,
            dataset: {
              filename: String(filenameOpt || ''),
              sessionId: String(opts.sessionId || ''),
              sessionBinding: 'recording',
            },
            _validatePromise: Promise.resolve(),
          };
          const statusMark = { textContent: '', style: {}, title: '' };
          const upBtn = {
            disabled: false,
            click: () => {
              lateUploadPromise = uploadBlobForLi(li._blob, li, upBtn, statusMark, { silent: true });
              return lateUploadPromise;
            },
          };
          latestLi = li;
          latestStatusMark = statusMark;
          return { li, upBtn };
        };
        const setTimeout = (fn) => {
          fn();
          return 0;
        };

        ${finalizeChunkSingleSource}

        rememberDoneClosedSession('sid-closed', 'tr-done-late');
        finalizeChunkSingle();
        await Promise.resolve();
        await Promise.resolve();
        const lateUploadResult = lateUploadPromise ? await lateUploadPromise : null;

        return {
          lateUploadResult,
          uploadBlobCalls: deps.uploadBlobCallsRef.value,
          latestChunkState: latestLi?.dataset?.chunkState || '',
          latestDoneClosed: latestLi?.dataset?.doneClosed || '',
          statusText: latestStatusMark?.textContent || '',
          statusTitle: latestStatusMark?.title || '',
          blockedLog: deps.blockedLogRef.value,
        };
      })();
      `,
    );

    const uploadBlobCallsRef = { value: 0 };
    const blockedLogRef: { value: null | { label: string; detail: Record<string, unknown> } } = { value: null };
    const result = await runHarness({
      console,
      uploadBlobCallsRef,
      blockedLogRef,
      uploadBlob: async () => {
        uploadBlobCallsRef.value += 1;
        return { ok: true };
      },
      showFabToast: () => {},
      logUi: () => {},
      logApi: (label: string, detail: Record<string, unknown>) => {
        if (label === 'upload_audio_blocked_closed_session') blockedLogRef.value = { label, detail };
      },
    });

    expect(result.lateUploadResult).toBe(false);
    expect(result.uploadBlobCalls).toBe(0);
    expect(result.latestChunkState).toBe('stale_session_closed');
    expect(result.latestDoneClosed).toBe('1');
    expect(String(result.statusText)).toContain('session closed');
    expect(String(result.statusTitle)).toContain('session already closed');
    expect(result.blockedLog).toEqual(
      expect.objectContaining({
        label: 'upload_audio_blocked_closed_session',
        detail: expect.objectContaining({
          session_id: 'sid-closed',
          transition_id: 'tr-done-late',
          correlation_id: 'tr-done-late',
          reason: 'session_closed_after_done',
        }),
      }),
    );
  });

  it('mints fallback transition metadata for blocked post-Done uploads when Done was invoked without trace ids', async () => {
    const normalizeTransitionIdSource = extractFunction('normalizeTransitionId');
    const createTransitionCorrelationIdSource = extractFunction('createTransitionCorrelationId');
    const withTransitionTraceFieldsSource = extractFunction('withTransitionTraceFields');
    const resolveTransitionCorrelationIdSource = extractFunction('resolveTransitionCorrelationId');
    const pruneDoneClosedSessionMetaSource = extractFunction('pruneDoneClosedSessionMeta');
    const rememberDoneClosedSessionSource = extractFunction('rememberDoneClosedSession');
    const getDoneClosedSessionMetaSource = extractFunction('getDoneClosedSessionMeta');
    const buildDoneClosedUploadTraceSource = extractFunction('buildDoneClosedUploadTrace');
    const uploadBlobForLiSource = extractFunction('uploadBlobForLi');

    const runHarness = new Function(
      'deps',
      `
      return (async () => {
        const DONE_CLOSED_SESSION_TTL_MS = 15 * 60 * 1000;
        const DONE_CLOSED_SESSION_MAX_ENTRIES = 128;
        const doneClosedSessionMeta = new Map();
        ${normalizeTransitionIdSource}
        ${createTransitionCorrelationIdSource}
        ${withTransitionTraceFieldsSource}
        ${resolveTransitionCorrelationIdSource}
        ${pruneDoneClosedSessionMetaSource}
        ${rememberDoneClosedSessionSource}
        ${getDoneClosedSessionMetaSource}
        ${buildDoneClosedUploadTraceSource}

        const console = deps.console;
        const logUi = deps.logUi;
        const logApi = deps.logApi;
        const showFabToast = deps.showFabToast;
        const inferSpeakerForLi = () => '';
        const getSessionIdFromDoc = () => '';
        const getSessionIdValue = () => '';
        const normalizeUploadThrownError = () => 'upload_error';
        let isUnloading = false;
        const uploadBlob = deps.uploadBlob;

        ${uploadBlobForLiSource}

        const transitionId = resolveTransitionCorrelationId({});
        rememberDoneClosedSession('sid-closed', transitionId);
        const li = {
          dataset: {
            sessionId: 'sid-closed',
            sessionBinding: 'recording',
            filename: '007-1.webm',
          },
        };
        const statusMark = { textContent: '', style: {}, title: '' };
        const result = await uploadBlobForLi(
          new Blob(['late-final-chunk'], { type: 'audio/webm' }),
          li,
          { disabled: false },
          statusMark,
          { silent: true },
        );
        return {
          result,
          transitionId,
          blockedLog: deps.blockedLogRef.value,
          chunkState: li.dataset.chunkState || '',
        };
      })();
      `,
    );

    const blockedLogRef: { value: null | { label: string; detail: Record<string, unknown> } } = { value: null };
    const result = await runHarness({
      console,
      blockedLogRef,
      uploadBlob: async () => ({ ok: true }),
      showFabToast: () => {},
      logUi: () => {},
      logApi: (label: string, detail: Record<string, unknown>) => {
        if (label === 'upload_audio_blocked_closed_session') blockedLogRef.value = { label, detail };
      },
    });

    expect(result.result).toBe(false);
    expect(result.chunkState).toBe('stale_session_closed');
    expect(String(result.transitionId)).toMatch(/^tr_/);
    expect(result.blockedLog).toEqual(
      expect.objectContaining({
        label: 'upload_audio_blocked_closed_session',
        detail: expect.objectContaining({
          session_id: 'sid-closed',
          transition_id: result.transitionId,
          correlation_id: result.transitionId,
          reason: 'session_closed_after_done',
        }),
      }),
    );
  });
});
