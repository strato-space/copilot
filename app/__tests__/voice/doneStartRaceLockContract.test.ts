import fs from 'node:fs';
import path from 'node:path';

describe('Done -> Start race lock contract', () => {
  const meetingCardPath = path.resolve(process.cwd(), 'src/components/voice/MeetingCard.tsx');
  const storePath = path.resolve(process.cwd(), 'src/store/voiceBotStore.ts');
  const webrtcPath = path.resolve(process.cwd(), 'public/webrtc/webrtc-voicebot-lib.js');
  const meetingSource = fs.readFileSync(meetingCardPath, 'utf8');
  const storeSource = fs.readFileSync(storePath, 'utf8');
  const webrtcSource = fs.readFileSync(webrtcPath, 'utf8');

  function extractFunction(source: string, name: string): string {
    const asyncMarker = `async function ${name}(`;
    const syncMarker = `function ${name}(`;
    const asyncStart = source.indexOf(asyncMarker);
    const syncStart = source.indexOf(syncMarker);
    const start = asyncStart >= 0 ? asyncStart : syncStart;
    if (start < 0) throw new Error(`Function not found: ${name}`);
    const open = source.indexOf('{', start);
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

  it('awaits page-session close in MeetingCard Done flow before controls unlock', () => {
    expect(meetingSource).toContain('await finishSession(pageSessionId);');
    expect(storeSource).toContain('finishSession: async (sessionId) => {');
    expect(storeSource).toContain("await voicebotHttp.request('voicebot/session_done', { session_id: normalizedSessionId });");
    expect(storeSource).toContain('throw error;');
  });

  it('keeps Start/Rec blocked while page Done close is settling in runtime controls', () => {
    expect(webrtcSource).toContain('if (pageDoneInFlight) {');
    expect(webrtcSource).toContain('pageDoneInFlight = true;');
    expect(webrtcSource).toContain('pageDoneInFlight = false;');
    expect(webrtcSource).toContain('const doneTransitionBusy = Boolean(doneTransitionPromise);');
    expect(webrtcSource).toContain("const canQueueStartDuringDone = doneTransitionBusy && inFlightDoneAction !== '' && inFlightDoneAction !== 'logout';");
    expect(webrtcSource).toContain('const startBlockedByDoneTransition = doneTransitionBusy && !canQueueStartDuringDone;');
    expect(webrtcSource).toContain('const startBlockedByFinalUploading = finalUploading && !canQueueStartDuringDone;');
    expect(webrtcSource).toContain('const canStart = hasToken && !startBlockedByFinalUploading && !pageDoneInFlight && !startTransitionBusy && !startBlockedByDoneTransition && !rec;');
    expect(webrtcSource).toContain('const canRecord = hasToken && !startBlockedByFinalUploading && !pageDoneInFlight && !startTransitionBusy && !startBlockedByDoneTransition && !rec;');
    expect(webrtcSource).toContain("if (doneTransitionPromise && isStartAction) {");
    expect(webrtcSource).toContain('function queueStartActionAfterDone(action) {');
    expect(webrtcSource).toContain('return queueStartActionAfterDone(normalizedAction);');
    expect(webrtcSource).toContain("if (startTransitionPromise && isDoneAction) {");
  });

  it('queues Start dispatch while Done transition is in-flight and runs it after Done settles', async () => {
    const normalizeControlActionSource = extractFunction(webrtcSource, 'normalizeControlAction');
    const queueStartActionAfterDoneSource = extractFunction(webrtcSource, 'queueStartActionAfterDone');
    const dispatchControlActionSource = extractFunction(webrtcSource, 'dispatchControlAction');
    let resolveDone!: (value: boolean) => void;
    const donePromise = new Promise<boolean>((resolve) => {
      resolveDone = resolve;
    });
    const runStartTransitionSingleFlight = jest.fn((_action: string, run: () => Promise<boolean>) => run());
    const runDoneTransitionSingleFlight = jest.fn(() => Promise.resolve(true));
    const dispatchFactory = new Function(
      'deps',
      `
      let isRecording = false;
      let isPaused = false;
      let pageDoneInFlight = false;
      let startTransitionPromise = null;
      let startTransitionAction = '';
      let doneTransitionPromise = deps.doneTransitionPromise.finally(() => { doneTransitionPromise = null; doneTransitionAction = ''; });
      let doneTransitionAction = deps.doneTransitionAction;
      let queuedStartAction = '';
      let queuedStartPromise = null;
      const IS_EMBEDDED = false;
      const window = { parent: {} };
      const console = deps.console;
      const logUi = () => {};
      const showFabToast = () => {};
      const runStartTransitionSingleFlight = deps.runStartTransitionSingleFlight;
      const runDoneTransitionSingleFlight = deps.runDoneTransitionSingleFlight;
      const handleNewAction = async () => true;
      const handleRecAction = async () => true;
      const pauseRecording = async () => true;
      const detectPause = () => {};
      const handleDoneAction = async () => true;
      ${normalizeControlActionSource}
      ${queueStartActionAfterDoneSource}
      ${dispatchControlActionSource}
      return { dispatchControlAction };
      `,
    );
    const { dispatchControlAction } = dispatchFactory({
      doneTransitionPromise: donePromise,
      doneTransitionAction: 'done',
      runStartTransitionSingleFlight,
      runDoneTransitionSingleFlight,
      console,
    });

    const resultPromise = Promise.resolve(dispatchControlAction('new'));
    expect(runStartTransitionSingleFlight).not.toHaveBeenCalled();
    resolveDone(true);
    await expect(resultPromise).resolves.toBe(true);
    expect(runStartTransitionSingleFlight).toHaveBeenCalledWith('new', expect.any(Function));
    expect(runDoneTransitionSingleFlight).not.toHaveBeenCalled();
  });

  it('keeps queued New intent and re-dispatches after Done fails once', async () => {
    const normalizeControlActionSource = extractFunction(webrtcSource, 'normalizeControlAction');
    const queueStartActionAfterDoneSource = extractFunction(webrtcSource, 'queueStartActionAfterDone');
    const dispatchControlActionSource = extractFunction(webrtcSource, 'dispatchControlAction');
    let resolveDone!: (value: boolean) => void;
    const donePromise = new Promise<boolean>((resolve) => {
      resolveDone = resolve;
    });
    const runStartTransitionSingleFlight = jest.fn((_action: string, run: () => Promise<boolean>) => run());
    const dispatchFactory = new Function(
      'deps',
      `
      let isRecording = false;
      let isPaused = false;
      let pageDoneInFlight = false;
      let startTransitionPromise = null;
      let startTransitionAction = '';
      let doneTransitionPromise = deps.doneTransitionPromise.finally(() => { doneTransitionPromise = null; doneTransitionAction = ''; });
      let doneTransitionAction = deps.doneTransitionAction;
      let queuedStartAction = '';
      let queuedStartPromise = null;
      const IS_EMBEDDED = false;
      const window = { parent: {} };
      const console = deps.console;
      const logUi = () => {};
      const showFabToast = () => {};
      const runStartTransitionSingleFlight = deps.runStartTransitionSingleFlight;
      const runDoneTransitionSingleFlight = () => Promise.resolve(true);
      const handleNewAction = async () => true;
      const handleRecAction = async () => true;
      const pauseRecording = async () => true;
      const detectPause = () => {};
      const handleDoneAction = async () => true;
      ${normalizeControlActionSource}
      ${queueStartActionAfterDoneSource}
      ${dispatchControlActionSource}
      return { dispatchControlAction };
      `,
    );
    const { dispatchControlAction } = dispatchFactory({
      doneTransitionPromise: donePromise,
      doneTransitionAction: 'done',
      runStartTransitionSingleFlight,
      console,
    });

    const resultPromise = Promise.resolve(dispatchControlAction('new'));
    resolveDone(false);
    await expect(resultPromise).resolves.toBe(true);
    expect(runStartTransitionSingleFlight).toHaveBeenCalledWith('new', expect.any(Function));
  });

  it('blocks Done dispatch while Start transition is in-flight', async () => {
    const normalizeControlActionSource = extractFunction(webrtcSource, 'normalizeControlAction');
    const dispatchControlActionSource = extractFunction(webrtcSource, 'dispatchControlAction');
    const startPromise = Promise.resolve(true);
    const runDoneTransitionSingleFlight = jest.fn(() => Promise.resolve(true));
    const dispatchFactory = new Function(
      'deps',
      `
      let isRecording = false;
      let isPaused = false;
      let pageDoneInFlight = false;
      let startTransitionPromise = deps.startTransitionPromise;
      let startTransitionAction = deps.startTransitionAction;
      let doneTransitionPromise = null;
      let doneTransitionAction = '';
      const IS_EMBEDDED = false;
      const window = { parent: {} };
      const logUi = () => {};
      const showFabToast = () => {};
      const runStartTransitionSingleFlight = () => Promise.resolve(true);
      const runDoneTransitionSingleFlight = deps.runDoneTransitionSingleFlight;
      const handleNewAction = async () => true;
      const handleRecAction = async () => true;
      const pauseRecording = async () => true;
      const detectPause = () => {};
      const handleDoneAction = async () => true;
      ${normalizeControlActionSource}
      ${dispatchControlActionSource}
      return { dispatchControlAction };
      `,
    );
    const { dispatchControlAction } = dispatchFactory({
      startTransitionPromise: startPromise,
      startTransitionAction: 'new',
      runDoneTransitionSingleFlight,
    });

    const result = dispatchControlAction('done');
    expect(result).toBe(startPromise);
    expect(runDoneTransitionSingleFlight).not.toHaveBeenCalled();
  });

  it('finalizes active session before New creates/records into a fresh session', async () => {
    const handleNewActionSource = extractFunction(webrtcSource, 'handleNewAction');
    const order: string[] = [];
    const handleDoneAction = jest.fn(async () => {
      order.push('done');
      return true;
    });
    const runDoneTransitionSingleFlight = jest.fn(async (_action: string, run: () => Promise<boolean>) => {
      order.push('done-transition');
      return run();
    });
    const startRecording = jest.fn(async () => {
      order.push('start-recording');
      return true;
    });
    const handleNewFactory = new Function(
      'deps',
      `
      let isFinalUploading = false;
      let AUTH_TOKEN = 'token';
      let pageDoneInFlight = false;
      let isRecording = false;
      let isPaused = false;
      let currentRecordingSessionId = '';
      const openSidePanel = () => {};
      const showFabToast = () => {};
      const syncFabAuthState = () => {};
      const createTransitionCorrelationId = () => deps.transitionId;
      const withTransitionTraceFields = (_transitionId, extra = {}) => ({ ...extra, transition_id: deps.transitionId, correlation_id: deps.transitionId });
      const getActiveSessionIdValue = () => deps.activeSessionId;
      const runDoneTransitionSingleFlight = deps.runDoneTransitionSingleFlight;
      const handleDoneAction = deps.handleDoneAction;
      const persistVoicebotState = () => {};
      const startRecording = async (opts) => {
        const result = await deps.startRecording(opts);
        currentRecordingSessionId = deps.recordingSessionId;
        return result;
      };
      const logUi = () => {};
      ${handleNewActionSource}
      return { handleNewAction };
      `,
    );
    const { handleNewAction } = handleNewFactory({
      activeSessionId: 'old-session-id',
      runDoneTransitionSingleFlight,
      handleDoneAction,
      startRecording,
      transitionId: 'tr-test-1',
      recordingSessionId: 'new-session-id',
    });

    await handleNewAction();

    expect(order).toEqual(['done-transition', 'done', 'start-recording']);
    expect(runDoneTransitionSingleFlight).toHaveBeenCalledWith('done-for-new', expect.any(Function));
    expect(startRecording).toHaveBeenCalledWith(expect.objectContaining({
      forceCreate: true,
      openInMainApp: true,
      transition_id: 'tr-test-1',
      correlation_id: 'tr-test-1',
    }));
  });

  it('does not create a new recording session when finalizing old session fails', async () => {
    const handleNewActionSource = extractFunction(webrtcSource, 'handleNewAction');
    const startRecording = jest.fn(async () => true);
    const handleNewFactory = new Function(
      'deps',
      `
      let isFinalUploading = false;
      let AUTH_TOKEN = 'token';
      let pageDoneInFlight = false;
      let isRecording = false;
      let isPaused = false;
      let currentRecordingSessionId = '';
      const openSidePanel = () => {};
      const showFabToast = () => {};
      const syncFabAuthState = () => {};
      const createTransitionCorrelationId = () => 'tr-test-fail';
      const withTransitionTraceFields = (_transitionId, extra = {}) => ({ ...extra, transition_id: 'tr-test-fail', correlation_id: 'tr-test-fail' });
      const getActiveSessionIdValue = () => 'old-session-id';
      const runDoneTransitionSingleFlight = async () => false;
      const handleDoneAction = async () => false;
      const persistVoicebotState = () => {};
      const startRecording = deps.startRecording;
      const logUi = () => {};
      ${handleNewActionSource}
      return { handleNewAction };
      `,
    );
    const { handleNewAction } = handleNewFactory({ startRecording });
    await handleNewAction();
    expect(startRecording).not.toHaveBeenCalled();
  });

  it('emits explicit forensic chain events with shared transition/correlation id', () => {
    expect(webrtcSource).toContain("logUi('old_session_closed', withTransitionTraceFields(transitionId, {");
    expect(webrtcSource).toContain("logUi('new_session_created', withTransitionTraceFields(transitionId, {");
    expect(webrtcSource).toContain("logUi('recording_attached', withTransitionTraceFields(transitionId, {");
    expect(webrtcSource).toContain('transition_id: transitionId');
    expect(webrtcSource).toContain('correlation_id: transitionId');
  });
});
