import fs from 'node:fs';
import path from 'node:path';

describe('webrtc start transition contract', () => {
  const scriptPath = path.resolve(process.cwd(), 'public/webrtc/webrtc-voicebot-lib.js');
  const source = fs.readFileSync(scriptPath, 'utf8');

  it('deduplicates rapid New/Rec clicks via single-flight transition', () => {
    expect(source).toContain('function runStartTransitionSingleFlight(action, run)');
    expect(source).toContain('function runDoneTransitionSingleFlight(action, run)');
    expect(source).toContain('if (startTransitionPromise) {');
    expect(source).toContain("logUi('start-transition.reused'");
    expect(source).toContain("if (normalizedAction === 'new') return runStartTransitionSingleFlight('new', handleNewAction);");
    expect(source).toContain("if (normalizedAction === 'rec') return runStartTransitionSingleFlight('rec', handleRecAction);");
    expect(source).toContain("if (normalizedAction === 'done') return runDoneTransitionSingleFlight('done', () => handleDoneAction({ logout: false }));");
  });

  it('keeps Start intent queueable while Done is in-flight and retries queued New after failed Done', () => {
    expect(source).toContain("const canQueueStartDuringDone = doneTransitionBusy && inFlightDoneAction !== '' && inFlightDoneAction !== 'logout';");
    expect(source).toContain("if (!doneResult && nextAction !== 'new') return false;");
    expect(source).toContain("if (!doneResult && nextAction === 'new') {");
    expect(source).toContain("logUi('control.queued-start.retry-after-done-failure'");
  });

  it('forces New to finalize active session, then create a new session and bind chunk uploads to the new recording session id', () => {
    expect(source).toContain("const transitionId = createTransitionCorrelationId();");
    expect(source).toContain("() => handleDoneAction(withTransitionTraceFields(transitionId, { logout: false }))");
    expect(source).toContain("if (!closed) {");
    expect(source).toContain('await startRecording(withTransitionTraceFields(transitionId, {');
    expect(source).toContain("forceCreate: true,");
    expect(source).toContain("openInMainApp: true,");
    expect(source).toContain('currentRecordingSessionId = sid;');
    expect(source).toContain("logUi('old_session_closed', withTransitionTraceFields(transitionId, {");
    expect(source).toContain("logUi('new_session_created', withTransitionTraceFields(transitionId, {");
    expect(source).toContain("logUi('recording_attached', withTransitionTraceFields(transitionId, {");
    expect(source).toContain("createChunkListItem(blob, label, (speechMs/1000), base, doc, { sessionId: sid });");
    expect(source).toContain("boundSessionId ? { sessionId: boundSessionId } : {}");
    expect(source).toContain("li.dataset.sessionBinding = 'recording';");
    expect(source).toContain("throw new Error('Chunk upload blocked: recording session binding is missing');");
  });
});
