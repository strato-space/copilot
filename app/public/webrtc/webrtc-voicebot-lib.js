	        const APP_VERSION = String(document.body?.dataset?.appVersion || '').trim();
	        function detectPageMode() {
	            // Explicit page mode (webrtc HTML clients) wins.
	            const raw = String(document.body?.dataset?.pageMode || '').trim();
	            if (raw) return raw;
	            const path = String(location.pathname || '');
	            const isWebrtcPath = path.includes('/webrtc');
	            if (!isWebrtcPath) return 'host';
	            if (path.includes('monitoring')) return 'monitoring';
	            if (path.includes('settings')) return 'settings';
	            if (path.includes('index') || path.endsWith('/webrtc') || path.endsWith('/webrtc/')) return 'index';
	            return 'settings';
	        }
	        const PAGE_MODE = detectPageMode();
	        if (document.body && !document.body.dataset.pageMode && PAGE_MODE !== 'host') {
	            document.body.dataset.pageMode = PAGE_MODE;
	        }
	        function applyAppVersion() {
	            // In host mode (Voicebot pages) we must not touch document.title.
	            if (PAGE_MODE === 'host') return;
	            const baseTitle = 'WebRTC Audio Capture with Silence Detection';
	            const label = APP_VERSION ? `${baseTitle} ${APP_VERSION}` : baseTitle;
	            document.title = label;
	            const h1 = document.getElementById('app-title');
	            if (h1) h1.textContent = label;
	        }
	        applyAppVersion();
	        function applyPageMode() {
	            if (PAGE_MODE === 'host') return;
	            const app = document.getElementById('app');
	            if (!app) return;
	            if (PAGE_MODE === 'settings') app.classList.add('settings-open');
	            if (PAGE_MODE === 'monitoring' || PAGE_MODE === 'index') app.classList.remove('settings-open');
	        }
        applyPageMode();

        // --- Component base resolution ---
        function getScriptBase() {
            try {
                if (document.currentScript && document.currentScript.src) {
                    return new URL('.', document.currentScript.src).toString();
                }
                const fallback = Array.from(document.scripts || []).reverse()
                    .find(s => s && s.src && s.src.includes('webrtc-voicebot-lib.js'));
                if (fallback && fallback.src) return new URL('.', fallback.src).toString();
            } catch {}
            return new URL('.', location.href).toString();
        }
        const SCRIPT_BASE = getScriptBase();
        const FAB_CSS_URL = new URL('components/fab.css', SCRIPT_BASE).toString();
        const FAB_HTML_URL = new URL('components/fab.html', SCRIPT_BASE).toString();
        const SHOULD_MOUNT_FAB = PAGE_MODE === 'index'
            || document.body?.dataset?.voicebotFab === '1'
            || (document.currentScript && document.currentScript.dataset.voicebotFab === '1');
        const IS_EMBEDDED = (() => {
            try { return window.parent && window.parent !== window; } catch { return false; }
        })();
        function logUi(action, detail = {}) {
            try { console.log(`[ui] ${action}`, detail); } catch {}
        }
        function logApi(label, detail = {}) {
            try { console.log(`[api] ${label}`, detail); } catch {}
        }
        function isCableLabel(label) {
            return /(cable output|virtual cable)/i.test(String(label || ''));
        }
        function notifyParentSettingsChange(action, payload = {}) {
            if (!IS_EMBEDDED) return;
            try {
                window.parent?.postMessage({ type: 'voicebot-settings', action, payload }, location.origin);
            } catch {}
        }
        function hasStoredMicAec(i) {
            try { return localStorage.getItem(`mic${i}AecNsAgc`) !== null; } catch { return false; }
        }
        function autoSetMicAecIfUnset(i, label, reason = '') {
            try {
                if (hasStoredMicAec(i)) return false;
                const enabled = !isCableLabel(label);
                micAecNsAgc[i] = enabled;
                try { localStorage.setItem(`mic${i}AecNsAgc`, enabled ? '1' : '0'); } catch {}
                const aecCb = document.getElementById(`mic-${i}-aec`);
                if (aecCb && 'checked' in aecCb) aecCb.checked = enabled;
                try { logUi('mic.aec.auto', { mic: i, enabled, reason, label }); } catch {}
                return true;
            } catch { return false; }
        }
        async function restartRecordingFromSettingsChange(reason = '') {
            if (!isRecording) {
                if (testingMode && allowMonitoringInit && audioContext) {
                    try { await rebuildMonitoring(`settings:${reason}`); } catch {}
                }
                return;
            }
            if (modeSwitching) return;
            modeSwitching = true;
            try {
                try { detectPause(true); } catch {}
                try { await stopArchiveTrackRecorders({ reason: `settings:${reason || 'change'}:switch`, timeoutMs: 5000, pollMs: 60 }); } catch {}
                try { await waitForAllPendingUploads({ settleMs: 2000, pollMs: 500 }); } catch {}
                try { await stopRecording({ reason: `settings:${reason || 'change'}` }); } catch {}
            } finally {
                modeSwitching = false;
            }
            try { await rebuildMonitoring(`settings:${reason}`); } catch {}
            try { await startRecording(); } catch (e) { console.error('settings-change restart', e); }
        }

        // --- FAB UI (index SPA) helpers ---
        let fabWrap = null;
        let fabButton = null;
        let fabMenu = null;
        let fabToast = null;
        let fabStatus = null;
        let fabOrbit = null;
        let fabOrbitCanvas = null;
        let sidePanel = null;
        let sideBackdrop = null;
        let panelTabs = [];
        let panelViews = [];
        let panelClose = null;
        let panelGear = null;
        let fabShiftX = 0;
        let fabShiftY = 0;
        let fabCuttingUntil = 0;
        let cutFlashTimer = null;
        let suppressStatePersist = true;
        function updateFabDockPosition() {
            try {
                if (!fabWrap) return;
                const selectors = [
                    'main',
                    '.page-content',
                    '.layout-content',
                    '.app-layout',
                    '.app-shell',
                    '#root > .app',
                    '#root > div'
                ];
                let gutter = 0;
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (!el) continue;
                    const rect = el.getBoundingClientRect();
                    if (!rect.width) continue;
                    const candidate = window.innerWidth - rect.right;
                    if (candidate > gutter) gutter = candidate;
                }
                const style = getComputedStyle(fabWrap);
                const fabSize = parseFloat(style.getPropertyValue('--fab-size')) || 56;
                let rightPx = 8;
                if (Number.isFinite(gutter) && gutter > fabSize + 16) {
                    rightPx = Math.max(8, Math.round((gutter - fabSize) / 2));
                }
                document.documentElement.style.setProperty('--voicebot-fab-right', `${rightPx}px`);
            } catch {}
        }
        function resolveFabRefs() {
            fabWrap = document.getElementById('fab-wrap');
            fabButton = document.getElementById('fab-call');
            fabMenu = document.getElementById('fab-menu');
            fabToast = document.getElementById('fab-toast');
            fabStatus = document.getElementById('fab-status');
            fabOrbit = fabWrap ? fabWrap.querySelector('.fab-orbit') : null;
            fabOrbitCanvas = fabWrap ? fabWrap.querySelector('.fab-orbit-canvas') : null;
            sidePanel = document.getElementById('side-panel');
            sideBackdrop = document.getElementById('side-backdrop');
            panelTabs = sidePanel ? Array.from(sidePanel.querySelectorAll('.panel-tab')) : [];
            panelViews = sidePanel ? Array.from(sidePanel.querySelectorAll('.panel-view')) : [];
            panelClose = document.getElementById('panel-close');
            panelGear = document.getElementById('panel-gear');
        }
        resolveFabRefs();

        function ensureFabStyles() {
            if (document.getElementById('voicebot-fab-style')) return;
            const link = document.createElement('link');
            link.id = 'voicebot-fab-style';
            link.rel = 'stylesheet';
            link.href = FAB_CSS_URL;
            document.head.appendChild(link);
        }

        async function ensureFabComponent() {
            if (!SHOULD_MOUNT_FAB) return false;
            if (document.readyState === 'loading') {
                await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
            }
            resolveFabRefs();
            if (fabWrap) return true;
            try {
                ensureFabStyles();
                const resp = await fetch(FAB_HTML_URL, { cache: 'no-store' });
                if (!resp.ok) throw new Error(`Fab component fetch failed: ${resp.status}`);
                const html = await resp.text();
                const tpl = document.createElement('template');
                tpl.innerHTML = String(html || '').trim();
                document.body.appendChild(tpl.content);
                document.body.dataset.voicebotFabMounted = '1';
                resolveFabRefs();
                updateFabDockPosition();
                window.addEventListener('resize', updateFabDockPosition, { passive: true });
                // When embedding into non-/webrtc pages (Voicebot SPA), iframe URLs must resolve
                // relative to the script base, not the host route (e.g. /sessions).
                try {
                    const frames = Array.from(document.querySelectorAll('.panel-iframe'));
                    frames.forEach((iframe) => {
                        const rawSrc = String(iframe.getAttribute('data-src') || iframe.getAttribute('src') || '').trim();
                        if (!rawSrc) return;
                        // Skip non-http(s) protocols.
                        if (/^[a-zA-Z]+:/.test(rawSrc) && !/^https?:/i.test(rawSrc)) return;
                        let resolved = new URL(rawSrc, SCRIPT_BASE).toString();
                        if (rawSrc.endsWith('.html')) {
                            try {
                                const check = new URL(resolved, location.origin);
                                if (!check.pathname.includes('/webrtc/')) {
                                    resolved = new URL(`/webrtc/${rawSrc.replace(/^\/+/, '')}`, location.origin).toString();
                                }
                            } catch {}
                        }
                        if (iframe.src !== resolved) iframe.src = resolved;
                    });
                } catch {}
                if (sidePanel && !sidePanel.dataset.panel) {
                    setPanelView('monitoring');
                    sidePanel.dataset.panel = 'monitoring';
                }
                return !!fabWrap;
            } catch (e) {
                console.warn('Failed to mount FAB component', e);
                return false;
            }
        }
        function setPanelView(name) {
            if (!sidePanel) return;
            panelTabs.forEach(btn => btn.classList.toggle('active', btn.dataset.panel === name));
            panelViews.forEach(view => view.classList.toggle('active', view.dataset.panelView === name));
        }
        function openSidePanel(name) {
            if (!sidePanel) return;
            const target = name || sidePanel.dataset.panel || 'monitoring';
            setPanelView(target);
            sidePanel.dataset.panel = target;
            sidePanel.classList.add('open');
            if (sideBackdrop) sideBackdrop.classList.add('open');
            sidePanel.setAttribute('aria-hidden', 'false');
            try { sidePanel.inert = false; } catch {}
            if (target === 'settings') {
                ensureSettingsDevices('settings-open').catch(()=>{});
            }
        }
        function closeSidePanel() {
            if (!sidePanel) return;
            try {
                if (sidePanel.contains(document.activeElement) && fabButton) {
                    fabButton.focus();
                }
            } catch {}
            sidePanel.classList.remove('open');
            if (sideBackdrop) sideBackdrop.classList.remove('open');
            sidePanel.setAttribute('aria-hidden', 'true');
            try { sidePanel.inert = true; } catch {}
        }
        function setFabState(state) {
            if (!fabWrap) return;
            fabWrap.dataset.state = state;
            updateFabStatus(state);
            if (!suppressStatePersist) {
                try { persistVoicebotState(state); } catch {}
            }
            syncControlState();
            try { updateFabOrbit(); } catch {}
        }
        function getFabStateLabel(state) {
            switch (state) {
                case 'error': return 'Error';
                case 'cutting': return 'Cutting';
                case 'recording': return 'Recording';
                case 'paused': return 'Paused';
                case 'final_uploading': return 'Final upload';
                case 'unauthorized': return 'Unauthorized';
                default: return 'Ready';
            }
        }
        function updateFabStatus(state) {
            if (!fabStatus) return;
            const label = getFabStateLabel(state || fabWrap?.dataset?.state || 'idle');
            fabStatus.textContent = `State: ${label}`;
        }
        function syncFabAuthState() {
            if (!fabWrap) return;
            if (fabCuttingUntil && Date.now() < fabCuttingUntil) {
                setFabState('cutting');
                return;
            }
            if (isFinalUploading) {
                setFabState('final_uploading');
                return;
            }
            if (!AUTH_TOKEN) {
                setFabState('unauthorized');
                return;
            }
            if (isPaused) {
                setFabState('paused');
                return;
            }
            if (isRecording) {
                setFabState('recording');
                return;
            }
            setFabState('idle');
        }
        function flashFabCut() {
            if (!fabWrap) return;
            fabCuttingUntil = Date.now() + 1000;
            setFabState('cutting');
            if (cutFlashTimer) clearTimeout(cutFlashTimer);
            cutFlashTimer = setTimeout(() => {
                if (Date.now() >= fabCuttingUntil) {
                    fabCuttingUntil = 0;
                    syncFabAuthState();
                }
                cutFlashTimer = null;
            }, 1000);
        }

        function getFabElapsedMs() {
            if (fabFrozenElapsedMs >= 0) return fabFrozenElapsedMs;
            if (!fabStartTs) return 0;
            const now = Date.now();
            const paused = fabPausedMs + (fabPausedTs ? (now - fabPausedTs) : 0);
            return Math.max(0, now - fabStartTs - paused);
        }

        function fitFabInViewport(radiusPx) {
            if (!fabButton) return;
            const rect = fabButton.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const vw = window.innerWidth;
            const vh = window.innerHeight;

            const distRight = vw - cx;
            const distLeft = cx;
            const distBottom = vh - cy;
            const distTop = cy;

            const dx = Math.max(0, radiusPx - distRight) - Math.max(0, radiusPx - distLeft);
            const dy = Math.max(0, radiusPx - distBottom) - Math.max(0, radiusPx - distTop);
            if (!dx && !dy) return;

            fabShiftX = Math.max(-420, Math.min(420, fabShiftX + dx));
            fabShiftY = Math.max(-420, Math.min(420, fabShiftY + dy));
            try {
                document.documentElement.style.setProperty('--voicebot-fab-shift-x', `${Math.round(fabShiftX)}px`);
                document.documentElement.style.setProperty('--voicebot-fab-shift-y', `${Math.round(fabShiftY)}px`);
            } catch {}
        }

        function decayFabShiftToZero() {
            if (!fabShiftX && !fabShiftY) return;
            const damp = 0.85;
            fabShiftX *= damp;
            fabShiftY *= damp;
            if (Math.abs(fabShiftX) < 0.5) fabShiftX = 0;
            if (Math.abs(fabShiftY) < 0.5) fabShiftY = 0;
            try {
                document.documentElement.style.setProperty('--voicebot-fab-shift-x', `${Math.round(fabShiftX)}px`);
                document.documentElement.style.setProperty('--voicebot-fab-shift-y', `${Math.round(fabShiftY)}px`);
            } catch {}
        }

        function getFabRingPalette() {
            try {
                if (!fabWrap) return null;
                const cs = getComputedStyle(fabWrap);
                const track = String(cs.getPropertyValue('--fab-ring-track') || '').trim() || 'rgba(148,163,184,0.35)';
                const rec = String(cs.getPropertyValue('--fab-ring-recording') || '').trim() || '#10b981';
                const speech = String(cs.getPropertyValue('--fab-ring-speech') || '').trim() || '#3b82f6';
                return { track, rec, speech };
            } catch {
                return { track: 'rgba(148,163,184,0.35)', rec: '#10b981', speech: '#3b82f6' };
            }
        }

        function updateFabOrbit() {
            try {
                if (!fabWrap || !fabOrbit || !fabOrbitCanvas || !fabButton) return;

                const state = String(fabWrap.dataset.state || 'idle');
                const palette = getFabRingPalette();
                if (!palette) return;

                const HOUR_MS = 60 * 60 * 1000;
                const RING_PX = 2;
                const GAP_PX = 2;
                const STEP_PX = RING_PX + GAP_PX;
                const INNER_GAP_PX = 1;
                const OUTER_GAP_PX = 1;
                const EDGE_PAD_PX = 2;
                const BASE_INSET_PX = 18;

                const btnRect = fabButton.getBoundingClientRect();
                const fabSize = Math.max(1, btnRect.width || 72);
                const fabR = fabSize / 2;

                const innerRing0 = fabR - INNER_GAP_PX - (RING_PX / 2);
                const outerRing0 = fabR + OUTER_GAP_PX + (RING_PX / 2);

                const isActive = (state === 'recording' || state === 'paused' || state === 'final_uploading');
                const recordingMsTotal = isActive ? getFabElapsedMs() : 0;
                const speechMsTotalSafe = isActive ? (speechMsTotal || 0) : 0;
                const outerCount = isActive ? Math.max(1, Math.floor(recordingMsTotal / HOUR_MS) + 1) : 1;
                const innerCount = isActive ? Math.max(1, Math.floor(speechMsTotalSafe / HOUR_MS) + 1) : 0;

                let maxRadius = outerRing0 + (RING_PX / 2) + EDGE_PAD_PX;
                let orbitInset = BASE_INSET_PX;
                if (isActive) {
                    const outerMostR = outerRing0 + (outerCount - 1) * STEP_PX;
                    maxRadius = outerMostR + (RING_PX / 2) + EDGE_PAD_PX;
                    orbitInset = Math.max(BASE_INSET_PX, Math.ceil(maxRadius - fabR));
                }

                try { fabWrap.style.setProperty('--fab-orbit-inset', `${orbitInset}px`); } catch {}
                if (isActive) fitFabInViewport(maxRadius);
                else decayFabShiftToZero();

                const dpr = Math.max(1, window.devicePixelRatio || 1);
                const box = fabOrbit.getBoundingClientRect();
                const sizePx = Math.max(1, box.width || (fabSize + orbitInset * 2));
                const size = Math.round(sizePx);
                const px = Math.round(size * dpr);
                if (fabOrbitCanvas.width !== px || fabOrbitCanvas.height !== px) {
                    fabOrbitCanvas.width = px;
                    fabOrbitCanvas.height = px;
                }

                const ctx = fabOrbitCanvas.getContext('2d');
                if (!ctx) return;
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                ctx.clearRect(0, 0, size, size);

                const cx = size / 2;
                const cy = size / 2;
                const a0 = -Math.PI / 2; // 12:00

                const drawTrackCircle = (r, color, alpha, w = RING_PX) => {
                    ctx.save();
                    ctx.globalAlpha = alpha;
                    ctx.strokeStyle = color;
                    ctx.lineWidth = w;
                    ctx.lineCap = 'round';
                    ctx.beginPath();
                    ctx.arc(cx, cy, r, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.restore();
                };
                const drawArc = (r, frac, color, alpha, w = RING_PX) => {
                    const f = Math.max(0, Math.min(1, Number(frac) || 0));
                    if (f <= 0) return;
                    ctx.save();
                    ctx.globalAlpha = alpha;
                    ctx.strokeStyle = color;
                    ctx.lineWidth = w;
                    ctx.lineCap = (f >= 0.999) ? 'butt' : 'round';
                    ctx.beginPath();
                    ctx.arc(cx, cy, r, a0, a0 + f * Math.PI * 2, false);
                    ctx.stroke();
                    ctx.restore();
                };

                // Idle/unauthorized: no ring.
                if (!isActive) {
                    return;
                }

                const baseAlpha = (state === 'paused') ? 0.8 : 1;

                // Tracks: recording outside (green), speech inside (blue).
                for (let i = 0; i < outerCount; i++) {
                    drawTrackCircle(outerRing0 + i * STEP_PX, palette.rec, baseAlpha * 0.18);
                }
                for (let i = 0; i < innerCount; i++) {
                    const r = innerRing0 - i * STEP_PX;
                    if (r <= (RING_PX / 2)) continue;
                    drawTrackCircle(r, palette.speech, baseAlpha * 0.18);
                }

                // Progress arcs.
                const outerFrac = (recordingMsTotal % HOUR_MS) / HOUR_MS;
                const innerFrac = (speechMsTotalSafe % HOUR_MS) / HOUR_MS;
                for (let i = 0; i < outerCount; i++) {
                    drawArc(outerRing0 + i * STEP_PX, (i < outerCount - 1) ? 1 : outerFrac, palette.rec, baseAlpha * 0.92);
                }
                for (let i = 0; i < innerCount; i++) {
                    const r = innerRing0 - i * STEP_PX;
                    if (r <= (RING_PX / 2)) continue;
                    drawArc(r, (i < innerCount - 1) ? 1 : innerFrac, palette.speech, baseAlpha * 0.75);
                }

                // Notches for each cut/auto-cut event (inside the recording ring).
                try {
                    const cuts = Array.isArray(cutEventsMs) ? cutEventsMs : [];
                    ctx.save();
                    ctx.globalAlpha = baseAlpha * 0.95;
                    ctx.strokeStyle = palette.rec;
                    ctx.lineWidth = 2;
                    for (const tMsRaw of cuts) {
                        const tMs = Number(tMsRaw);
                        if (!Number.isFinite(tMs) || tMs < 0) continue;
                        const ringIdx = Math.floor(tMs / HOUR_MS);
                        if (ringIdx < 0 || ringIdx >= outerCount) continue;
                        const frac = (tMs % HOUR_MS) / HOUR_MS;
                        const ang = a0 + frac * Math.PI * 2;
                        const r = outerRing0 + ringIdx * STEP_PX;
                        const r1 = r - (RING_PX / 2) + 0.5;
                        const r2 = r1 + 3.5;
                        ctx.beginPath();
                        ctx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
                        ctx.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
                        ctx.stroke();
                    }
                    ctx.restore();
                } catch {}

            } catch (e) {
                console.warn('[fab] ring render failed', e);
            }
        }
        function startFabOrbit() {
            if (!fabOrbit) return;
            if (fabOrbitTimer) clearInterval(fabOrbitTimer);
            fabOrbitTimer = setInterval(updateFabOrbit, 250);
            updateFabOrbit();
        }
        function stopFabOrbit(opts = {}) {
            if (fabOrbitTimer) clearInterval(fabOrbitTimer);
            fabOrbitTimer = null;
            if (opts && opts.reset) resetFabProgress();
        }
        function resetFabProgress() {
            if (!fabWrap) return;
            try { fabWrap.style.setProperty('--fab-orbit-inset', '18px'); } catch {}
            try { fabFrozenElapsedMs = -1; } catch {}
            try { speechMsTotal = 0; } catch {}
            try { cutEventsMs = []; } catch {}
            fabShiftX = 0;
            fabShiftY = 0;
            try {
                document.documentElement.style.setProperty('--voicebot-fab-shift-x', '0px');
                document.documentElement.style.setProperty('--voicebot-fab-shift-y', '0px');
            } catch {}
            try { updateFabOrbit(); } catch {}
        }
        function showFabToast(text, ms = 1200) {
            if (!fabToast) resolveFabRefs();
            if (!fabToast) return;
            fabToast.textContent = String(text || '');
            fabToast.classList.add('show');
            setTimeout(() => fabToast.classList.remove('show'), Math.max(600, ms));
        }
        function setFabMenuPauseLabel() {
            if (!fabMenu) return;
            const btn = fabMenu.querySelector('[data-action="pause"]');
            if (!btn) return;
            btn.textContent = '⏸️ Pause';
        }

        function syncControlState() {
            const startBtn = document.getElementById('start-btn');
            const recordBtn = document.getElementById('record-btn');
            const pauseBtn = document.getElementById('pause-btn');
            const chunkBtn = document.getElementById('chunk-btn');
            const doneBtn = document.getElementById('btn-done-button');
            const resetBtn = document.getElementById('btn-reset');
            const logoutBtn = document.getElementById('btn-logout');
            const logoutAppBtn = document.getElementById('btn-logout-app');
            const uploadAllBtn = document.getElementById('btn-upload-all');

            let rec = isRecording;
            let paused = isPaused;
            let finalUploading = isFinalUploading;
            if (IS_EMBEDDED) {
                try {
                    const shared = window.parent?.__voicebotState?.get?.();
                    if (shared) {
                        rec = !!shared.isRecording;
                        paused = !!shared.isPaused;
                        finalUploading = !!shared.isFinalUploading;
                    }
                } catch {}
            }

            const hasToken = !!AUTH_TOKEN;
            const hasSession = !!getSessionIdValue();
            const hasActiveSession = !!getActiveSessionIdValue();
            const hasPageSession = !!getPageSessionIdValue();

            const canStart = hasToken && !finalUploading && !rec;
            const canRecord = hasToken && !finalUploading && !rec;
            const canPause = hasToken && !finalUploading && rec;
            const canCut = hasToken && !finalUploading && (rec || paused);
            const canFabDone = hasToken && !finalUploading && hasActiveSession;
            const canPageDone = hasToken && !finalUploading && hasPageSession;
            const canReset = !finalUploading;
            const canLogout = hasToken && !finalUploading;
            const canUploadAll = hasToken && !finalUploading && hasSession;

            if (startBtn) startBtn.disabled = !canStart;
            if (recordBtn) recordBtn.disabled = !canRecord;
            if (pauseBtn) pauseBtn.disabled = !canPause;
            if (chunkBtn) chunkBtn.disabled = !canCut;
            if (doneBtn) doneBtn.disabled = !canPageDone;
            if (resetBtn) resetBtn.disabled = !canReset;
            if (logoutBtn) logoutBtn.disabled = !canLogout;
            if (logoutAppBtn) logoutAppBtn.disabled = !canLogout;
            if (uploadAllBtn) uploadAllBtn.disabled = !canUploadAll;

            if (fabMenu) {
                const mStart = fabMenu.querySelector('[data-action="new"], [data-action="start"]');
                const mRecord = fabMenu.querySelector('[data-action="rec"], [data-action="record"]');
                const mCut = fabMenu.querySelector('[data-action="cut"]');
                const mPause = fabMenu.querySelector('[data-action="pause"]');
                const mDone = fabMenu.querySelector('[data-action="done"]');
                if (mStart) mStart.disabled = !canStart;
                if (mRecord) mRecord.disabled = !canRecord;
                if (mCut) mCut.disabled = !canCut;
                if (mPause) mPause.disabled = !canPause;
                if (mDone) mDone.disabled = !canFabDone;
            }
        }

	        // Small inline toast near element
	        function showInlineToast(el, text, ms = 950) {
            try {
                const rect = el.getBoundingClientRect();
                const tip = document.createElement('div');
                tip.className = 'toast-inline';
                tip.textContent = String(text || '');
                document.body.appendChild(tip);
                const top = Math.max(0, rect.top + window.scrollY - 8);
                const left = rect.left + (rect.width / 2) + window.scrollX;
                tip.style.top = `${top}px`;
                tip.style.left = `${left}px`;
                // ensure layout, then show
                requestAnimationFrame(() => tip.classList.add('show'));
                setTimeout(() => {
                    tip.classList.remove('show');
                    setTimeout(() => { try { tip.remove(); } catch {} }, 220);
                }, Math.max(400, ms));
            } catch {}
        }

        // --- Upload wait helpers for Done sequencing ---
        function getChunksList() {
            try { return resolveChunkListTarget().list || null; } catch { return null; }
        }
        function getLatestChunkLi() {
            const list = getChunksList();
            if (!list) return null;
            const node = list.firstElementChild;
            return (node && node.tagName === 'LI') ? node : null;
        }
        function isLiUploaded(li) {
            try {
                if (!li) return false;
                if (li.dataset && li.dataset.uploaded === '1') return true;
                const upBtn = li.querySelector('button[data-role="uploaded"]');
                return Boolean(upBtn);
            } catch { return false; }
        }
        async function waitForLiCountIncrease(prevCount, timeoutMs = 2000) {
            const start = Date.now();
            return new Promise(resolve => {
                const tick = () => {
                    const list = getChunksList();
                    const cnt = list ? list.childElementCount : 0;
                    if (cnt > prevCount) { resolve(true); return; }
                    if (Date.now() - start >= timeoutMs) { resolve(false); return; }
                    setTimeout(tick, 60);
                };
                tick();
            });
        }
        async function ensureLatestUploadedOrTimeout(timeoutMs = 60000) {
            const li = getLatestChunkLi();
            if (!li) return 'no-li';
            if (isLiUploaded(li)) return 'already';
            // trigger upload if not started
            try {
                const upBtn = li.querySelector('button[data-role="upload"]');
                if (upBtn && !upBtn.disabled) upBtn.click();
            } catch {}
            // wait until uploaded flag appears or timeout
            const start = Date.now();
            return new Promise(resolve => {
                const tick = () => {
                    if (isLiUploaded(li)) { resolve('uploaded'); return; }
                    if (Date.now() - start >= timeoutMs) { resolve('timeout'); return; }
                    setTimeout(tick, 120);
                };
                tick();
            });
        }
        function sleepMs(ms) {
            return new Promise(resolve => setTimeout(resolve, Math.max(0, ms || 0)));
        }
        async function waitForAllPendingUploads(opts = {}) {
            const settleMs = Number.isFinite(opts.settleMs) ? opts.settleMs : 2000;
            const pollMs = Number.isFinite(opts.pollMs) ? opts.pollMs : 500;
            const maxWaitMs = Number.isFinite(opts.maxWaitMs) ? opts.maxWaitMs : 120000;
            const startedAt = Date.now();
            let lastCount = -1;
            let lastChangeTs = Date.now();
            while (true) {
                const list = getChunksList();
                const lis = list ? Array.from(list.querySelectorAll('li')) : [];
                const count = lis.length;
                if (count !== lastCount) { lastCount = count; lastChangeTs = Date.now(); }

                let pending = 0;
                let inFlight = 0;
                let startedNow = 0;

                for (const li of lis) {
                    const trackKind = String(li?.dataset?.trackKind || '').trim();
                    if (li?.dataset?.silent === '1' || li?.dataset?.corrupt === '1' || trackKind === 'full_track') {
                        try { if (li.dataset) delete li.dataset.uploading; } catch {}
                        continue;
                    }
                    if (isLiUploaded(li)) {
                        try { if (li.dataset) delete li.dataset.uploading; } catch {}
                        continue;
                    }

                    pending += 1;

                    if (li?.dataset?.uploading === '1') {
                        inFlight += 1;
                        continue;
                    }
                    if (li?.dataset?.autoUploadAttempted === '1') continue;

                    const upBtn = li.querySelector('button[data-role="upload"]');
                    if (!upBtn || upBtn.disabled) {
                        try { if (li?.dataset) li.dataset.autoUploadAttempted = '1'; } catch {}
                        continue;
                    }

                    startedNow += 1;
                    inFlight += 1;
                    try {
                        if (li?.dataset) {
                            li.dataset.uploading = '1';
                            li.dataset.autoUploadAttempted = '1';
                        }
                    } catch {}

                    try {
                        if (li._blob) {
                            uploadBlobForLi(li._blob, li, upBtn, null, { silent: true })
                                .finally(() => {
                                    try { if (li?.dataset) delete li.dataset.uploading; } catch {}
                                });
                        } else {
                            upBtn.click();
                            try { if (li?.dataset) delete li.dataset.uploading; } catch {}
                        }
                    } catch {
                        try { if (li?.dataset) delete li.dataset.uploading; } catch {}
                    }
                }

                const settled = (Date.now() - lastChangeTs) >= settleMs;
                if (pending === 0 && settled) {
                    return { status: 'all-uploaded', pending: 0, failed: 0 };
                }

                if (startedNow === 0 && inFlight === 0 && settled) {
                    const failed = lis.filter((li) => {
                        const trackKind = String(li?.dataset?.trackKind || '').trim();
                        if (trackKind === 'full_track') return false;
                        if (li?.dataset?.silent === '1' || li?.dataset?.corrupt === '1') return false;
                        return !isLiUploaded(li);
                    }).length;
                    return {
                        status: failed > 0 ? 'pending-manual' : 'all-uploaded',
                        pending: failed,
                        failed,
                    };
                }

                if ((Date.now() - startedAt) >= maxWaitMs) {
                    return { status: 'timeout', pending, failed: pending };
                }

                await sleepMs(pollMs);
            }
        }
        // --- Config / Auth ---
        // Default API URL should follow the current origin (dev/prod) unless overridden by the user.
        // This avoids creating sessions on prod while running the UI on voice-dev (and vice versa).
        const DEFAULT_HOST = location.host || 'voice.stratospace.fun';
        const DEFAULT_HTTP_API = `http://${DEFAULT_HOST}`;
        const DEFAULT_HTTPS_API = `https://${DEFAULT_HOST}`;
        const isStandaloneVoiceHost = /(^|\.)(voice|voice-dev)\.stratospace\.fun$/i.test(DEFAULT_HOST);
        const schemeBasedDefault = /^https?:\/\//.test(String(location.origin || ''))
            ? (isStandaloneVoiceHost ? location.origin : `${location.origin}/api`)
            : (isStandaloneVoiceHost ? DEFAULT_HTTPS_API : `${DEFAULT_HTTPS_API}/api`);
        // Secure-context helper for media devices
        const IS_SECURE_OR_LOCAL = (window.isSecureContext === true) || ['localhost','127.0.0.1','::1'].includes(location.hostname);
        const USER_AGENT = String(navigator.userAgent || '');
        const IS_CHROME = (/Chrome|CriOS/.test(USER_AGENT)) && !/Edg|OPR|Opera/.test(USER_AGENT);
        // Chrome requires a user gesture before starting AudioContext / playback.
        let audioUnlocked = false;
        // Do not request mic permission / build monitoring graph until the user explicitly starts recording
        // or opens Settings (to show meters and Audio Monitor before recording).
        let allowMonitoringInit = false;
        let pendingMonitorInit = false;
        let preserveAudioContext = false;
        function primeAudioContextForGesture(reason = '') {
            preserveAudioContext = true;
            audioUnlocked = true;
            pendingMonitorInit = false;
            try {
                if (!audioContext || audioContext.state === 'closed') {
                    audioContext = new (window.AudioContext || window.webkitAudioContext)();
                }
            } catch {}
            try {
                if (audioContext && audioContext.state === 'suspended') audioContext.resume();
            } catch {}
            logApi('audio.prime', { reason, state: audioContext?.state || 'none' });
        }
        function unlockAudioOnce() {
            if (audioUnlocked) return;
            audioUnlocked = true;
            try { if (audioContext && audioContext.state === 'suspended') audioContext.resume(); } catch {}
            try { if (monitorAudioEl) { monitorAudioEl.muted = false; monitorAudioEl.play?.(); } } catch {}
            if (pendingMonitorInit) {
                pendingMonitorInit = false;
                try { ensureMonitoring('user-gesture'); } catch {}
            }
        }
        window.addEventListener('pointerdown', unlockAudioOnce, { once: true, passive: true });
        window.addEventListener('keydown', unlockAudioOnce, { once: true });
        // Helpers
        function bytesToHuman(n) {
            if (!Number.isFinite(n)) return '';
            const units = ['B','KB','MB','GB'];
            let i = 0; let v = n;
            while (v >= 1024 && i < units.length-1) { v /= 1024; i++; }
            return `${v.toFixed(i===0?0:1)} ${units[i]}`;
        }

        function pickBlobTypeFromParts(parts, fallbackType = '') {
            try {
                for (const p of (parts || [])) {
                    const t = p && typeof p.type === 'string' ? p.type : '';
                    if (t) return t;
                }
            } catch {}
            return String(fallbackType || '').trim();
        }

        function guessAudioExtFromMime(mime, fallbackExt = '.webm') {
            const m = String(mime || '').toLowerCase();
            if (m.includes('ogg')) return '.ogg';
            if (m.includes('mp4')) return '.m4a';
            if (m.includes('aac')) return '.aac';
            if (m.includes('webm')) return '.webm';
            return fallbackExt;
        }

        function pickMediaRecorderMime() {
            try {
                if (window.MediaRecorder && typeof MediaRecorder.isTypeSupported === 'function') {
                    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
                    if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
                    if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) return 'audio/ogg;codecs=opus';
                    if (MediaRecorder.isTypeSupported('audio/ogg')) return 'audio/ogg';
                    if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
                    if (MediaRecorder.isTypeSupported('audio/aac')) return 'audio/aac';
                }
            } catch {}
            return '';
        }

        async function readBlobPrefixU8(blob, maxBytes = 16384) {
            try {
                const b = blob && typeof blob.slice === 'function'
                    ? blob.slice(0, Math.max(0, maxBytes || 0))
                    : blob;
                if (!b) return new Uint8Array();
                if (typeof b.arrayBuffer === 'function') {
                    return new Uint8Array(await b.arrayBuffer());
                }
            } catch {}
            // Fallback for older browsers
            return await new Promise((resolve) => {
                try {
                    const fr = new FileReader();
                    fr.onload = () => {
                        try { resolve(new Uint8Array(fr.result || new ArrayBuffer(0))); } catch { resolve(new Uint8Array()); }
                    };
                    fr.onerror = () => resolve(new Uint8Array());
                    fr.readAsArrayBuffer(blob.slice(0, Math.max(0, maxBytes || 0)));
                } catch {
                    resolve(new Uint8Array());
                }
            });
        }

        function findBytes(haystackU8, needleU8) {
            try {
                const h = haystackU8 || new Uint8Array();
                const n = needleU8 || new Uint8Array();
                if (!n.length || h.length < n.length) return -1;
                for (let i = 0; i <= (h.length - n.length); i++) {
                    let ok = true;
                    for (let j = 0; j < n.length; j++) {
                        if (h[i + j] !== n[j]) { ok = false; break; }
                    }
                    if (ok) return i;
                }
            } catch {}
            return -1;
        }

        function bytesToHex(u8, maxLen = 16) {
            try {
                const a = Array.from(u8 || []);
                return a.slice(0, Math.max(0, maxLen || 0)).map(b => b.toString(16).padStart(2, '0')).join(' ');
            } catch {}
            return '';
        }

        async function sniffAndMaybeRepairBlob(blob, opts = {}) {
            const maxScanBytes = Number.isFinite(opts.maxScanBytes) ? opts.maxScanBytes : 16384;
            const prefix = await readBlobPrefixU8(blob, maxScanBytes);
            if (!prefix || prefix.length < 4) {
                return { ok: false, reason: 'too_small', headHex: bytesToHex(prefix, 16) };
            }
            const EBML = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
            const OggS = new Uint8Array([0x4f, 0x67, 0x67, 0x53]);
            const idxEbml = findBytes(prefix, EBML);
            const idxOgg = findBytes(prefix, OggS);

            const candidates = [];
            if (idxEbml >= 0) candidates.push({ kind: 'webm', idx: idxEbml });
            if (idxOgg >= 0) candidates.push({ kind: 'ogg', idx: idxOgg });
            candidates.sort((a, b) => a.idx - b.idx);
            const pick = candidates.length ? candidates[0] : null;
            if (!pick) {
                return { ok: false, reason: 'unknown_header', headHex: bytesToHex(prefix, 16) };
            }

            const origType = String(blob?.type || '');
            const origTypeLc = origType.toLowerCase();
            const kind = pick.kind;
            const offset = pick.idx;
            let fixedType = origType;
            if (kind === 'ogg') fixedType = (origType && origTypeLc.includes('ogg')) ? origType : 'audio/ogg';
            if (kind === 'webm') fixedType = (origType && origTypeLc.includes('webm')) ? origType : 'audio/webm';

            if (offset === 0) {
                return { ok: true, repaired: false, kind, offset: 0, blob, type: fixedType };
            }
            // Repair: strip any leading junk before a known container header (often a leftover tail fragment).
            const sliced = blob.slice(offset);
            const repairedBlob = fixedType ? new Blob([sliced], { type: fixedType }) : sliced;
            return { ok: true, repaired: true, kind, offset, blob: repairedBlob, type: fixedType };
        }

        async function validateAndMaybeRepairChunkLi(li, opts = {}) {
            try {
                const blob = li?._blob;
                if (!blob) return { ok: false, reason: 'no_blob' };
                const res = await sniffAndMaybeRepairBlob(blob, opts);
                if (!res.ok) {
                    try { li?._markCorrupt?.(res.reason || 'corrupt'); } catch {}
                    return res;
                }
                if (res.repaired && res.blob) {
                    try { li?._setBlob?.(res.blob, { repaired: true, offset: res.offset, kind: res.kind, type: res.type }); } catch {}
                }
                return res;
            } catch (e) {
                try { li?._markCorrupt?.('validate_failed'); } catch {}
                return { ok: false, reason: 'validate_failed', error: String(e || '') };
            }
        }

        // Default session name: YYYY-MM-DD HH:MM (24h)
        function defaultSessionName(d = new Date()) {
            const pad = (n) => String(n).padStart(2, '0');
            const y = d.getFullYear();
            const m = pad(d.getMonth() + 1);
            const day = pad(d.getDate());
            const hh = pad(d.getHours());
            const mm = pad(d.getMinutes());
            return `${y}-${m}-${day} ${hh}:${mm}`;
        }

        function localYmd(d = new Date()) {
            return defaultSessionName(d).slice(0, 10);
        }

        function parseDateOrNull(v) {
            try {
                if (v === null || v === undefined || v === '') return null;
                if (typeof v === 'number' && Number.isFinite(v)) {
                    const ms = v < 1e12 ? v * 1000 : v;
                    const d = new Date(ms);
                    return Number.isFinite(d.getTime()) ? d : null;
                }
                const s = String(v).trim();
                if (!s) return null;
                // Support numeric timestamps coming as strings.
                if (/^\d+$/.test(s)) {
                    const n = Number(s);
                    if (Number.isFinite(n)) {
                        const ms = n < 1e12 ? n * 1000 : n;
                        const d = new Date(ms);
                        return Number.isFinite(d.getTime()) ? d : null;
                    }
                }
                const d = new Date(s);
                return Number.isFinite(d.getTime()) ? d : null;
            } catch {
                return null;
            }
        }

        function parseLocalYmdHm(v) {
            const m = /^\s*(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/.exec(String(v || ''));
            if (!m) return null;
            const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0);
            return Number.isFinite(d.getTime()) ? d : null;
        }

        function getSessionPerformerId(s) {
            return String(s?.performer?._id || s?.performer_id || s?.performerId || s?.performer || '');
        }

        function getSessionCreatedAtDate(s) {
            return parseDateOrNull(s?.created_at || s?.createdAt || s?.created || '');
        }

        function getSessionCreatedAtLocalYmd(s) {
            const d = getSessionCreatedAtDate(s);
            if (d) return localYmd(d);
            const raw = String(s?.created_at || s?.createdAt || s?.created || '');
            return raw ? raw.slice(0, 10) : '';
        }

        function isSessionOpen(s) {
            const statusStr = String(s?.status || '').toLowerCase();
            const flag = s?.is_active;
            if (typeof flag === 'boolean') return flag;
            return !['closed', 'completed', 'done', 'archived'].includes(statusStr);
        }

        function getSessionId(s) {
            return String(s?._id || s?.id || s?.session_id || '');
        }
        // Dynamically load Socket.IO client if needed
        async function ensureSocketIo() {
            if (window.io && typeof window.io === 'function') return true;
            return await new Promise((resolve) => {
                try {
                    const s = document.createElement('script');
                    s.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
                    s.onload = () => resolve(true);
                    s.onerror = () => resolve(false);
                    document.head.appendChild(s);
                } catch { resolve(false); }
            });
        }
        // Emit session_done via Socket.IO from the browser (best-effort)
        async function sessionDoneBrowser(sessionId, opts={}) {
            try {
                const okLoaded = await ensureSocketIo();
                if (!okLoaded || !window.io) return false;
                const base = API_BASE;
                // Prefer secure scheme for sockets if page is secure, even if API_BASE is http
                const baseForSocket = (() => {
                    try {
                        const u = new URL(base);
                        if ((window.isSecureContext || location.protocol === 'https:') && u.protocol === 'http:') {
                            u.protocol = 'https:'; // this ensures WSS
                        }
                        return u.toString();
                    } catch { return (window.isSecureContext && /^http:\/\//.test(base)) ? base.replace(/^http:/,'https:') : base; }
                })();
                // Browser cannot set custom headers; pass auth in auth payload
                const sio = window.io(baseForSocket, {
                    path: '/socket.io',
                    // Prefer polling to avoid noisy WS errors in mixed/proxied environments
                    transports: ['polling'],
                    forceNew: true,
                    reconnection: false,
                    auth: { token: AUTH_TOKEN, 'X-Authorization': AUTH_TOKEN }
                });
                return await new Promise((resolve) => {
                    let settled = false;
                    const done = (v)=>{ if (!settled){ settled=true; try{ sio.close(); }catch{} resolve(!!v); } };
                    const timer = setTimeout(()=> done(false), Math.max(500, opts.timeoutMs||5000));
                    sio.on('connect', () => {
                        try {
                            const payload = { session_id: sessionId };
                            sio.timeout(3000).emit('session_done', payload, (err) => {
                                clearTimeout(timer);
                                if (err) return done(false);
                                done(true);
                            });
                        } catch { clearTimeout(timer); done(false); }
                    });
                    sio.on('connect_error', () => { clearTimeout(timer); done(false); });
                    sio.on('error', () => { clearTimeout(timer); done(false); });
                });
            } catch (e) { console.warn('sessionDoneBrowser failed', e); return false; }
        }
        let API_BASE = localStorage.getItem('VOICEBOT_API_URL') || schemeBasedDefault;
        // Migration: older builds defaulted to https://voice.stratospace.fun even on voice-dev.
        // If we detect that stale default, automatically switch to same-origin.
        try {
            const raw = String(API_BASE || '').trim().replace(/\/+$/, '');
            if ((raw === 'https://voice.stratospace.fun' || raw === 'http://voice.stratospace.fun') && location.host && location.host !== 'voice.stratospace.fun') {
                API_BASE = schemeBasedDefault;
                localStorage.setItem('VOICEBOT_API_URL', API_BASE);
            }
        } catch {}
        let AUTH_TOKEN = localStorage.getItem('VOICEBOT_AUTH_TOKEN') || '';
        let MY_PERFORMER_ID = localStorage.getItem('VOICEBOT_ME_ID') || '';
        let MY_TELEGRAM_ID = localStorage.getItem('VOICEBOT_TELEGRAM_ID') || '';
        const LAST_SESSION_ID_KEY = 'VOICEBOT_LAST_SESSION_ID';

        function rememberLastSessionId(sid) {
            try {
                const v = String(sid || '').trim();
                if (!v) return;
                localStorage.setItem(LAST_SESSION_ID_KEY, v);
            } catch {}
        }

        function restoreLastSessionId() {
            try { return String(localStorage.getItem(LAST_SESSION_ID_KEY) || '').trim(); } catch { return ''; }
        }
        function getSessionIdFromDoc(doc) {
            try {
                const el = doc && doc.getElementById ? doc.getElementById('session-id') : null;
                const v = el && 'value' in el ? String(el.value || '').trim() : '';
                if (v) return v;
            } catch {}
            return '';
        }
        function getFabSessionIdFromDoc(doc) {
            try {
                const el = doc && doc.getElementById ? doc.getElementById('fab-session-id') : null;
                const v = el && 'value' in el ? String(el.value || '').trim() : '';
                if (v) return v;
            } catch {}
            return '';
        }
        function getActiveSessionIdValue() {
            if (ACTIVE_SESSION_ID) return String(ACTIVE_SESSION_ID).trim();
            try {
                const stored = String(localStorage.getItem(SESSION_ID_STORAGE_KEY) || '').trim();
                if (stored) return stored;
            } catch {}
            const fabId = getFabSessionIdFromDoc(document);
            if (fabId) return fabId;
            return '';
        }
        function getPageSessionIdValue() {
            const docSid = getSessionIdFromDoc(document);
            if (docSid) return docSid;
            try {
                const match = String(location.pathname || '').match(/\/session\/([0-9a-fA-F]{24})(?:\/|$)/);
                if (match && match[1]) return String(match[1]).trim();
            } catch {}
            return '';
        }
        function getSessionIdValue() {
            const active = getActiveSessionIdValue();
            if (active) return active;
            return getPageSessionIdValue();
        }
        function getSessionNameValue() {
            try {
                const el = document.getElementById('session-name');
                const v = el && 'value' in el ? String(el.value || '') : '';
                if (v) return v;
            } catch {}
            try {
                const el = document.getElementById('fab-session-name');
                const v = el && 'value' in el ? String(el.value || '') : '';
                if (v) return v;
            } catch {}
            return '';
        }
        function getPageSessionNameValue() {
            try {
                const el = document.getElementById('session-name');
                return el && 'value' in el ? String(el.value || '') : '';
            } catch {}
            return '';
        }
        function getActiveSessionNameValue() {
            try {
                const el = document.getElementById('fab-session-name');
                const v = el && 'value' in el ? String(el.value || '') : '';
                if (v) return v;
            } catch {}
            try {
                return String(localStorage.getItem(SESSION_NAME_STORAGE_KEY) || '');
            } catch {}
            return '';
        }
        const SESSION_ID_STORAGE_KEY = 'VOICEBOT_ACTIVE_SESSION_ID';
        const SESSION_NAME_STORAGE_KEY = 'VOICEBOT_ACTIVE_SESSION_NAME';
        const SESSION_PROJECT_ID_STORAGE_KEY = 'VOICEBOT_ACTIVE_SESSION_PROJECT_ID';
        const SESSION_PROJECT_NAME_STORAGE_KEY = 'VOICEBOT_ACTIVE_SESSION_PROJECT_NAME';
        const SESSION_STATE_STORAGE_KEY = 'VOICEBOT_STATE';
        const SESSION_PAUSED_HINT_KEY = 'VOICEBOT_PAUSED_HINT';
        let lastSessionMetaStorageSig = '';
        function persistPausedHint(value) {
            try {
                if (value) {
                    localStorage.setItem(SESSION_PAUSED_HINT_KEY, '1');
                } else {
                    localStorage.removeItem(SESSION_PAUSED_HINT_KEY);
                }
            } catch {}
        }
        function readPausedHint() {
            try { return String(localStorage.getItem(SESSION_PAUSED_HINT_KEY) || '') === '1'; } catch { return false; }
        }
        function persistVoicebotState(state) {
            try {
                if (!state) {
                    localStorage.removeItem(SESSION_STATE_STORAGE_KEY);
                    return;
                }
                localStorage.setItem(SESSION_STATE_STORAGE_KEY, String(state));
            } catch {}
        }
        function readVoicebotState() {
            try { return String(localStorage.getItem(SESSION_STATE_STORAGE_KEY) || '').trim(); } catch { return ''; }
        }
        function clearSessionInfoStorage() {
            try { localStorage.removeItem(SESSION_ID_STORAGE_KEY); } catch {}
            try { localStorage.removeItem(SESSION_NAME_STORAGE_KEY); } catch {}
            try { localStorage.removeItem(SESSION_PROJECT_ID_STORAGE_KEY); } catch {}
            try { localStorage.removeItem(SESSION_PROJECT_NAME_STORAGE_KEY); } catch {}
            try { localStorage.removeItem(SESSION_STATE_STORAGE_KEY); } catch {}
            try { localStorage.removeItem(SESSION_PAUSED_HINT_KEY); } catch {}
        }
        function upsertProjectOption(sel, projectId, projectName = '') {
            try {
                if (!sel || !('options' in sel)) return;
                const pid = String(projectId || '').trim();
                if (!pid) return;
                const title = String(projectName || '').trim() || pid;
                let opt = Array.from(sel.options || []).find((o) => String(o.value || '') === pid);
                if (!opt) {
                    opt = document.createElement('option');
                    opt.value = pid;
                    opt.textContent = title;
                    sel.appendChild(opt);
                } else if (title && (!String(opt.textContent || '').trim() || String(opt.textContent || '').trim() === String(opt.value || '').trim())) {
                    opt.textContent = title;
                }
            } catch {}
        }
        function setPageSessionIdInDoc(doc, id) {
            try {
                const sidEl = doc?.getElementById?.('session-id');
                if (sidEl && 'value' in sidEl) sidEl.value = id;
            } catch {}
        }
        function setPageSessionNameInDoc(doc, name) {
            try {
                const nameEl = doc?.getElementById?.('session-name');
                if (nameEl && 'value' in nameEl) nameEl.value = name;
            } catch {}
        }
        function setActiveSessionIdInDoc(doc, id) {
            try {
                const fabSidEl = doc?.getElementById?.('fab-session-id');
                if (fabSidEl && 'value' in fabSidEl) fabSidEl.value = id;
            } catch {}
        }
        function setActiveSessionNameInDoc(doc, name) {
            try {
                const fabNameEl = doc?.getElementById?.('fab-session-name');
                if (fabNameEl && 'value' in fabNameEl) fabNameEl.value = name;
            } catch {}
        }
        function setFabSessionNameEditing(doc, editing) {
            try {
                const rootDoc = doc || document;
                const row = rootDoc?.querySelector?.('.fab-session-name-row');
                if (row) row.classList.toggle('is-editing', !!editing);
                const input = rootDoc?.getElementById?.('fab-session-name');
                if (!input) return;
                if (editing) {
                    input.removeAttribute('readonly');
                    input.setAttribute('aria-readonly', 'false');
                } else {
                    input.setAttribute('readonly', 'readonly');
                    input.setAttribute('aria-readonly', 'true');
                }
            } catch {}
        }
        function setActiveSessionProjectInDoc(doc, projectId, projectName = '') {
            try {
                const sel = doc?.getElementById?.('fab-session-project');
                if (!sel || !('value' in sel)) return;
                const pid = String(projectId || '').trim();
                if (pid) {
                    upsertProjectOption(sel, pid, projectName);
                    sel.value = pid;
                    if (projectName) sel.dataset.projectName = String(projectName || '').trim();
                } else {
                    sel.value = '';
                    if (projectName) sel.dataset.projectName = String(projectName || '').trim();
                    else try { delete sel.dataset.projectName; } catch {}
                }
            } catch {}
        }
        function setSessionIdEverywhere(id) {
            setActiveSessionIdInDoc(document, id);
        }
        function setSessionNameEverywhere(name) {
            setActiveSessionNameInDoc(document, name);
        }
        function setSessionProjectEverywhere(projectId, projectName = '') {
            setActiveSessionProjectInDoc(document, projectId, projectName);
        }
        function setPageSessionIdEverywhere(id) {
            setPageSessionIdInDoc(document, id);
            try {
                const frames = Array.from(document.querySelectorAll('.panel-iframe'));
                frames.forEach((f) => setPageSessionIdInDoc(f.contentDocument, id));
            } catch {}
        }
        function setPageSessionNameEverywhere(name) {
            setPageSessionNameInDoc(document, name);
            try {
                const frames = Array.from(document.querySelectorAll('.panel-iframe'));
                frames.forEach((f) => setPageSessionNameInDoc(f.contentDocument, name));
            } catch {}
        }
        function persistSessionMeta(id, name, projectMeta = null) {
            try {
                if (id) localStorage.setItem(SESSION_ID_STORAGE_KEY, id);
                else localStorage.removeItem(SESSION_ID_STORAGE_KEY);
                if (name !== undefined && name !== null) {
                    const rawName = String(name);
                    if (rawName.length > 0) localStorage.setItem(SESSION_NAME_STORAGE_KEY, rawName);
                    else localStorage.removeItem(SESSION_NAME_STORAGE_KEY);
                }
                if (projectMeta && typeof projectMeta === 'object') {
                    if (Object.prototype.hasOwnProperty.call(projectMeta, 'projectId')) {
                        const projectId = String(projectMeta.projectId || '').trim();
                        if (projectId) localStorage.setItem(SESSION_PROJECT_ID_STORAGE_KEY, projectId);
                        else localStorage.removeItem(SESSION_PROJECT_ID_STORAGE_KEY);
                    }
                    if (Object.prototype.hasOwnProperty.call(projectMeta, 'projectName')) {
                        const projectName = String(projectMeta.projectName || '').trim();
                        if (projectName) localStorage.setItem(SESSION_PROJECT_NAME_STORAGE_KEY, projectName);
                        else localStorage.removeItem(SESSION_PROJECT_NAME_STORAGE_KEY);
                    }
                }
            } catch {}
        }
        function syncSessionMetaFromStorage() {
            try {
                const storedId = String(localStorage.getItem(SESSION_ID_STORAGE_KEY) || '').trim();
                const storedName = String(localStorage.getItem(SESSION_NAME_STORAGE_KEY) || '');
                const storedProjectId = String(localStorage.getItem(SESSION_PROJECT_ID_STORAGE_KEY) || '').trim();
                const storedProjectName = String(localStorage.getItem(SESSION_PROJECT_NAME_STORAGE_KEY) || '');
                const sig = `${storedId}::${storedName}::${storedProjectId}::${storedProjectName}`;
                if (sig === lastSessionMetaStorageSig) return;
                lastSessionMetaStorageSig = sig;
                if (!storedId && !storedName && !storedProjectId && !storedProjectName) {
                    const hasActiveUi = Boolean(
                        String(ACTIVE_SESSION_ID || '').trim()
                        || getFabSessionIdFromDoc(document)
                        || String(document.getElementById('fab-session-name')?.value || '').trim()
                        || String(document.getElementById('fab-session-project')?.value || '').trim()
                    );
                    if (hasActiveUi) clearActiveSessionUi();
                    return;
                }
                if (storedId) {
                    setSessionIdEverywhere(storedId);
                    ACTIVE_SESSION_ID = storedId;
                } else {
                    ACTIVE_SESSION_ID = '';
                    setSessionIdEverywhere('');
                }
                if (storedName) setSessionNameEverywhere(storedName);
                else setSessionNameEverywhere('');
                setSessionProjectEverywhere(storedProjectId, storedProjectName);
                refreshFabProjectOptions(storedProjectId, storedProjectName).catch(() => {});
                if (storedId && !storedProjectId) {
                    hydrateActiveSessionProjectMeta(storedId).catch(() => {});
                }
            } catch {}
        }
        function getMainAppSessionPath(sid) {
            const safeId = String(sid || '').trim();
            if (!safeId) return '/voice/session';
            return `/voice/session/${encodeURIComponent(safeId)}`;
        }
        function openSessionInMainApp(sid) {
            try {
                if (!sid || PAGE_MODE !== 'host') return;
                const sessionPath = getMainAppSessionPath(sid);
                const url = new URL(sessionPath, location.origin).toString();
                if (location.pathname.includes(sessionPath)) return;
                if (openSessionLinkInHost(url)) return;
                const target = (window.top && window.top !== window) ? window.top : window;
                target.location.assign(url);
            } catch (e) {
                console.warn('openSessionInMainApp failed', e);
            }
        }
        async function getSessionStatusById(sessionId) {
            try {
                const sid = String(sessionId || '').trim();
                if (!sid) return null;
                const sessions = await getRecentSessions();
                if (!Array.isArray(sessions)) return null;
                return sessions.find((s) => getSessionId(s) === sid) || null;
            } catch (e) {
                console.warn('[getSessionStatusById] failed', e);
                return null;
            }
        }
        function clearActiveSession(reason = '') {
            try { ACTIVE_SESSION_ID = ''; } catch {}
            clearActiveSessionUi();
            clearSessionInfoStorage();
            try { logUi('session.clear', { reason }); } catch {}
        }
        async function reconcileStoredSessionState(reason = 'boot') {
            let storedState = readVoicebotState();
            const storedId = (() => {
                try { return String(localStorage.getItem(SESSION_ID_STORAGE_KEY) || '').trim(); } catch { return ''; }
            })();
            if (!storedId) {
                clearSessionInfoStorage();
                return { action: 'idle', reason: 'no-session' };
            }
            // Keep paused restore deterministic even if a stale "recording" write happened before refresh.
            if (storedState === 'recording' && readPausedHint()) {
                storedState = 'paused';
            }
            if (!['recording', 'paused'].includes(storedState)) {
                clearActiveSession('stored-state-not-recording');
                return { action: 'idle', reason: 'state-not-recording' };
            }
            const session = await getSessionStatusById(storedId);
            if (!session || !isSessionOpen(session)) {
                clearActiveSession('session-closed');
                return { action: 'idle', reason: 'session-closed' };
            }
            setSessionIdEverywhere(storedId);
            const storedName = (() => {
                try { return String(localStorage.getItem(SESSION_NAME_STORAGE_KEY) || ''); } catch { return ''; }
            })();
            if (storedName) setSessionNameEverywhere(storedName);
            try { logUi('session.restore', { reason, state: storedState, session_id: storedId }); } catch {}
            return { action: storedState, reason: 'restored', session };
        }
        async function ensureSessionIdForRecording(opts = {}) {
            const forceCreate = Boolean(opts?.forceCreate);
            const openInMainAppOnCreate = Boolean(opts?.openInMainApp);
            let sid = forceCreate ? '' : getSessionIdValue();
            if (sid) {
                ACTIVE_SESSION_ID = sid;
                setSessionIdEverywhere(sid);
                return sid;
            }
            if (!AUTH_TOKEN) {
                if (typeof showFabToast === 'function') showFabToast('Login required to create session', 1600);
                try { openSidePanel('settings'); } catch {}
                return '';
            }
            try {
                logApi('create_session.request', { chat_id: '2820582847' });
                const resp = await fetch(endpoints.createSession(), {
                    method: 'POST',
                    headers: { 'X-Authorization': AUTH_TOKEN, 'Accept': 'application/json', 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: '2820582847' })
                });
                logApi('create_session', { status: resp.status, ok: resp.ok });
                if (!resp.ok) throw new Error(await resp.text() || `status ${resp.status}`);
                const newSess = await resp.json();
                const newId = String(newSess?.session_id || newSess?._id || newSess?.id || '');
                if (!newId) throw new Error('No session_id in response');
                ACTIVE_SESSION_ID = newId;
                // Active session is tracked in FAB/localStorage and is separate from page session.
                setSessionIdEverywhere(newId);
                const sessionName = String(newSess?.name || newSess?.session_name || newSess?.title || '').trim();
                const compactName = sessionName.replace(/\s+/g, ' ').trim();
                const shortName = compactName.length > 28 ? `${compactName.slice(0, 25)}…` : compactName;
                const link = getMainAppSessionPath(newId);
                if (sessionName) {
                    setSessionNameEverywhere(sessionName);
                    persistSessionMeta(newId, sessionName, { projectId: '', projectName: '' });
                } else {
                    persistSessionMeta(newId, '', { projectId: '', projectName: '' });
                }
                if (typeof showFabToast === 'function') {
                    const lines = [];
                    if (shortName) lines.push(`Session: ${shortName}`);
                    lines.push(`ID: ${newId}`);
                    lines.push(link);
                    showFabToast(lines.join('\n'), 3000);
                }
                logApi('create_session.ok', { session_id: newId, name: shortName || '' });
                try { invalidateSessionsCache(); } catch {}
                if (openInMainAppOnCreate) {
                    try { openSessionInMainApp(newId); } catch {}
                }
                try {
                    window.dispatchEvent(new CustomEvent('voicebot:session-created', {
                        detail: { session_id: newId, name: shortName || '' }
                    }));
                } catch {}
                try {
                    window.dispatchEvent(new CustomEvent('voicebot:active-session-updated', {
                        detail: { session_id: newId, session_name: sessionName || shortName || '', source: 'new' }
                    }));
                } catch {}
                return newId;
            } catch (e) {
                console.error('Failed to create session', e);
                logApi('create_session.error', { message: String(e || '') });
                alert('Failed to create session: ' + e);
                return '';
            }
        }

        async function activateSessionAPI(sessionId) {
            const payload = { session_id: String(sessionId || '').trim() };
            if (!payload.session_id) throw new Error('session_id is required');
            const resp = await fetch(endpoints.activateSession(), {
                method: 'POST',
                headers: { 'X-Authorization': AUTH_TOKEN, 'Accept': 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const text = await resp.text();
            if (!resp.ok) throw new Error(text || `status ${resp.status}`);
            try { return text ? JSON.parse(text) : {}; } catch { return {}; }
        }

        async function activateSessionForRecording(sessionId, opts = {}) {
            const sid = String(sessionId || '').trim();
            if (!sid) return '';
            if (!AUTH_TOKEN) throw new Error('Login required');

            const current = String(getActiveSessionIdValue() || '').trim();
            if (current && current === sid) return sid;

            const source = String(opts?.source || 'rec').trim();
            const activation = await activateSessionAPI(sid);
            const activeId = String(activation?.session_id || sid).trim();
            const activeNameFromResponse = String(activation?.session_name || '').trim();

            ACTIVE_SESSION_ID = activeId;
            setSessionIdEverywhere(activeId);

            let activeName = activeNameFromResponse;
            let projectMeta = { projectId: '', projectName: '' };
            try {
                invalidateSessionsCache();
                const sessions = await getRecentSessions(200);
                const session = Array.isArray(sessions) ? sessions.find((s) => String(getSessionId(s)) === activeId) : null;
                if (session) {
                    const resolvedName = String(session?.session_name || session?.name || session?.title || '').trim();
                    if (resolvedName) activeName = resolvedName;
                    projectMeta = extractProjectMetaFromSession(session);
                }
            } catch {}

            setSessionNameEverywhere(activeName || '');
            setSessionProjectEverywhere(projectMeta.projectId || '', projectMeta.projectName || '');
            persistSessionMeta(activeId, activeName || '', projectMeta);
            try { refreshFabProjectOptions(projectMeta.projectId || '', projectMeta.projectName || '').catch(() => {}); } catch {}
            try {
                window.dispatchEvent(new CustomEvent('voicebot:active-session-updated', {
                    detail: {
                        session_id: activeId,
                        session_name: activeName || '',
                        project_id: projectMeta.projectId || '',
                        project_name: projectMeta.projectName || '',
                        source
                    }
                }));
            } catch {}
            return activeId;
        }

        const endpoints = {
            login: () => `${API_BASE.replace(/\/$/, '')}/try_login`,
            me: () => `${API_BASE.replace(/\/$/, '')}/auth/me`,
            sessions: () => `${API_BASE.replace(/\/$/, '')}/voicebot/sessions`,
            activeSession: () => `${API_BASE.replace(/\/$/, '')}/voicebot/active_session`,
            activateSession: () => `${API_BASE.replace(/\/$/, '')}/voicebot/activate_session`,
            uploadAudio: () => `${API_BASE.replace(/\/$/, '')}/voicebot/upload_audio`,
            sessionDetail: () => `${API_BASE.replace(/\/$/, '')}/voicebot/session`,
            projects: () => `${API_BASE.replace(/\/$/, '')}/voicebot/projects`,
            updateSessionName: () => `${API_BASE.replace(/\/$/, '')}/voicebot/update_session_name`,
            updateSessionProject: () => `${API_BASE.replace(/\/$/, '')}/voicebot/update_session_project`,
            createSession: () => `${API_BASE.replace(/\/$/, '')}/voicebot/create_session`,
        };

        const ME_TELEGRAM_ID_KEY = 'VOICEBOT_TELEGRAM_ID';
        function extractMeValue(me, path = []) {
            if (!me) return '';
            let val = me;
            for (const p of path) {
                if (!val || typeof val !== 'object') return '';
                val = val[p];
            }
            if (val === null || val === undefined) return '';
            return String(val);
        }
        function normalizeTelegramUserId(value) {
            const raw = extractMeValue(value);
            const trimmed = String(raw || '').trim();
            if (!trimmed) return '';
            return String(Number(trimmed)) === trimmed || /^-?\d+$/.test(trimmed) ? trimmed : trimmed;
        }
        function cacheMeProfile(me) {
            const perfId = extractMeValue(me, ['_id']) || extractMeValue(me, ['id']) || extractMeValue(me, ['user', '_id']) || extractMeValue(me, ['user', 'id']);
            if (perfId) {
                MY_PERFORMER_ID = String(perfId);
                localStorage.setItem('VOICEBOT_ME_ID', MY_PERFORMER_ID);
            } else {
                MY_PERFORMER_ID = '';
                localStorage.removeItem('VOICEBOT_ME_ID');
            }

            const telegramId = normalizeTelegramUserId(
                extractMeValue(me, ['telegram_id']) ||
                extractMeValue(me, ['user', 'telegram_id']) ||
                extractMeValue(me, ['telegram_user_id']) ||
                extractMeValue(me, ['user', 'telegram_user_id'])
            );
            if (telegramId) {
                MY_TELEGRAM_ID = telegramId;
                localStorage.setItem(ME_TELEGRAM_ID_KEY, MY_TELEGRAM_ID);
            } else {
                MY_TELEGRAM_ID = '';
                localStorage.removeItem(ME_TELEGRAM_ID_KEY);
            }
            return { performerId: MY_PERFORMER_ID, telegramId: MY_TELEGRAM_ID };
        }

        // Функция для закрытия всех вчерашних сессий
        async function closeYesterdaySessions() {
            try {
                if (!AUTH_TOKEN || !MY_PERFORMER_ID) return;
                const sessions = await getRecentSessions(); // use shared cache
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                const yesterdayStr = localYmd(yesterday);
                
                for (const s of sessions) {
                    const perfId = getSessionPerformerId(s);
                    const isOpen = isSessionOpen(s);
                    const isYesterday = getSessionCreatedAtLocalYmd(s) === yesterdayStr;
                    const isMine = String(perfId) === String(MY_PERFORMER_ID);
                    
                    if (isOpen && isYesterday && isMine) {
                        const sid = getSessionId(s);
                        if (sid) {
                            console.log('Closing yesterday session:', sid);
                            try {
                                await sessionDoneBrowser(sid, { timeoutMs: 3000 });
                            } catch (e) {
                                console.warn('Failed to close session', sid, e);
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn('closeYesterdaySessions failed', e);
            }
        }

        // --- Current user label helpers ---
        function setCurrentUserLabel(me) {
            try {
                const el = document.getElementById('current-user');
                if (!el) return;
                const name = me?.name || me?.user?.name || me?.login || me?.user?.login || me?.email || me?.user?.email || '';
                const email = me?.email || me?.user?.email || '';
                const id = me?._id || me?.id || me?.user?._id || me?.user?.id || '';
                el.textContent = name ? String(name) : '';
                el.title = [name, email, id ? `id:${id}` : ''].filter(Boolean).join(' · ');
                if (name) localStorage.setItem('VOICEBOT_ME_DISPLAY', String(name));
            } catch {}
        }
        function clearCurrentUserLabel() {
            try {
                const el = document.getElementById('current-user');
                if (el) el.textContent = '';
                localStorage.removeItem('VOICEBOT_ME_DISPLAY');
            } catch {}
        }

        // Helpers to work with sessions list
        const DEFAULT_SESSIONS_LIMIT = 200;
        const SESSIONS_CACHE_TTL_MS = 5000;
        let _sessionsCache = { ts: 0, limit: 0, sessions: null, inflight: null };

        function invalidateSessionsCache() {
            try {
                _sessionsCache.ts = 0;
                _sessionsCache.limit = 0;
                _sessionsCache.sessions = null;
                _sessionsCache.inflight = null;
            } catch {}
        }

        async function getRecentSessions(limit = DEFAULT_SESSIONS_LIMIT) {
            const effLimit = Math.max(1, Number(limit) || DEFAULT_SESSIONS_LIMIT);
            const now = Date.now();
            if (_sessionsCache.sessions && (now - _sessionsCache.ts) < SESSIONS_CACHE_TTL_MS && _sessionsCache.limit >= effLimit) {
                console.log('[getRecentSessions] Using cache, sessions:', _sessionsCache.sessions.length);
                return _sessionsCache.sessions;
            }
            if (_sessionsCache.inflight && _sessionsCache.limit >= effLimit) {
                return await _sessionsCache.inflight;
            }
            console.log('[getRecentSessions] Fetching sessions, limit:', effLimit);
            _sessionsCache.limit = Math.max(_sessionsCache.limit || 0, effLimit);
            _sessionsCache.inflight = (async () => {
            const resp = await fetch(endpoints.sessions(), {
                method: 'POST',
                headers: { 'X-Authorization': AUTH_TOKEN, 'Accept': 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({ limit: effLimit })
            });
            if (!resp.ok) {
                const err = await resp.text() || `status ${resp.status}`;
                console.error('[getRecentSessions] Failed:', err);
                throw new Error(err);
            }
            const data = await resp.json();
            const sessions = Array.isArray(data) ? data : (data?.sessions || []);
            // Normalize ordering: newest-first (VoiceBot clients assume items[0] is the most recent).
            try {
                const createdMs = (s) => {
                    const d = getSessionCreatedAtDate(s) || (typeof s?.name === 'string' ? parseLocalYmdHm(s.name) : null);
                    return d ? d.getTime() : 0;
                };
                sessions.sort((a, b) => createdMs(b) - createdMs(a));
            } catch (e) {
                console.warn('[getRecentSessions] sort failed (keeping backend order):', e);
            }
            console.log('[getRecentSessions] Got', sessions.length, 'sessions');
                _sessionsCache.sessions = sessions;
                _sessionsCache.ts = Date.now();
            return sessions;
            })();
            try {
                const sessions = await _sessionsCache.inflight;
                _sessionsCache.inflight = null;
                return sessions;
            } catch (e) {
                _sessionsCache.inflight = null;
                throw e;
            }
        }

        let _projectsCache = { ts: 0, projects: null, inflight: null };
        const PROJECTS_CACHE_TTL_MS = 60 * 1000;

        function normalizeProjectOption(raw) {
            const id = String(raw?._id || raw?.id || raw?.project_id || '').trim();
            if (!id) return null;
            const name = String(raw?.name || raw?.title || id).trim() || id;
            return { id, name };
        }

        function extractProjectMetaFromSession(rawSession) {
            const session = rawSession || {};
            const projectId = String(
                session?.project_id
                || session?.project?._id
                || session?.project?.id
                || session?.project_id_str
                || ''
            ).trim();
            const projectName = String(
                session?.project?.name
                || session?.project?.title
                || session?.project_name
                || ''
            ).trim();
            return { projectId, projectName };
        }

        function renderFabProjectOptions(projects = [], selectedProjectId = '', selectedProjectName = '') {
            try {
                const sel = document.getElementById('fab-session-project');
                if (!sel) return;
                const normalized = Array.isArray(projects)
                    ? projects.map(normalizeProjectOption).filter(Boolean)
                    : [];
                const prevValue = String(selectedProjectId || sel.value || '').trim();
                const prevLabel = String(selectedProjectName || sel.dataset?.projectName || '').trim();
                sel.innerHTML = '';

                const placeholder = document.createElement('option');
                placeholder.value = '';
                placeholder.textContent = 'Project';
                sel.appendChild(placeholder);

                for (const item of normalized) {
                    const opt = document.createElement('option');
                    opt.value = item.id;
                    opt.textContent = item.name;
                    sel.appendChild(opt);
                }

                if (prevValue) {
                    upsertProjectOption(sel, prevValue, prevLabel);
                    sel.value = prevValue;
                } else {
                    sel.value = '';
                }
            } catch (e) {
                console.warn('renderFabProjectOptions failed', e);
            }
        }

        async function getPreparedProjects(force = false) {
            if (!AUTH_TOKEN) return [];
            const now = Date.now();
            if (!force && _projectsCache.projects && (now - _projectsCache.ts) < PROJECTS_CACHE_TTL_MS) {
                return _projectsCache.projects;
            }
            if (!force && _projectsCache.inflight) {
                return await _projectsCache.inflight;
            }
            _projectsCache.inflight = (async () => {
                const resp = await fetch(endpoints.projects(), {
                    method: 'POST',
                    headers: { 'X-Authorization': AUTH_TOKEN, 'Accept': 'application/json', 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                if (!resp.ok) throw new Error(await resp.text() || `status ${resp.status}`);
                const raw = await resp.json();
                const projects = Array.isArray(raw) ? raw.map(normalizeProjectOption).filter(Boolean) : [];
                _projectsCache.projects = projects;
                _projectsCache.ts = Date.now();
                return projects;
            })();
            try {
                const out = await _projectsCache.inflight;
                _projectsCache.inflight = null;
                return out;
            } catch (e) {
                _projectsCache.inflight = null;
                throw e;
            }
        }

        async function refreshFabProjectOptions(selectedProjectId = '', selectedProjectName = '') {
            try {
                const projects = await getPreparedProjects(false);
                renderFabProjectOptions(projects, selectedProjectId, selectedProjectName);
            } catch (e) {
                // Keep UI usable even if projects endpoint fails.
                renderFabProjectOptions([], selectedProjectId, selectedProjectName);
                console.warn('refreshFabProjectOptions failed', e);
            }
        }

        async function hydrateActiveSessionProjectMeta(sessionId) {
            const sid = String(sessionId || '').trim();
            if (!sid || !AUTH_TOKEN) return;
            try {
                const sessions = await getRecentSessions(200);
                const session = Array.isArray(sessions) ? sessions.find((s) => String(getSessionId(s)) === sid) : null;
                if (!session) return;
                const { projectId, projectName } = extractProjectMetaFromSession(session);
                if (!projectId && !projectName) return;
                setSessionProjectEverywhere(projectId, projectName);
                persistSessionMeta(sid, getActiveSessionNameValue(), { projectId, projectName });
                await refreshFabProjectOptions(projectId, projectName);
            } catch (e) {
                console.warn('hydrateActiveSessionProjectMeta failed', e);
            }
        }

        async function closePageSessionOnly(sessionId) {
            const sid = String(sessionId || '').trim();
            if (!sid) return false;
            try {
                await sessionDoneBrowser(sid, { timeoutMs: 4000 });
                try { invalidateSessionsCache(); } catch {}
                return true;
            } catch (e) {
                console.warn('[page-done] close failed', e);
                return false;
            }
        }

        async function handlePageDoneAction() {
            const pageSid = String(getPageSessionIdValue() || '').trim();
            if (!pageSid) {
                try { showFabToast('Page session is empty', 1800); } catch {}
                return;
            }
            const activeSid = String(getActiveSessionIdValue() || '').trim();
            if (activeSid && pageSid === activeSid) {
                await handleDoneAction({ logout: false });
                return;
            }
            if (!AUTH_TOKEN) {
                try { showFabToast('Login required', 1600); } catch {}
                return;
            }
            const ok = await closePageSessionOnly(pageSid);
            if (ok) {
                try { showFabToast('Page session closed', 1800); } catch {}
            } else {
                try { showFabToast('Failed to close page session', 2200); } catch {}
            }
        }

        // Page Done button closes pageSessionId. FAB Done closes active session.
        (function initDoneButton() {
            const btn = document.getElementById('btn-done-button');
            if (!btn) return;
            btn.addEventListener('click', () => { handlePageDoneAction().catch((e) => console.warn('[page-done] error', e)); });
        })();
        // Guard to avoid double /sessions fetch when we set Session ID programmatically
        let SUPPRESS_SID_FETCH = false;

        function clearAutoCloseTimer() {
            try { if (autoCloseTimer) clearTimeout(autoCloseTimer); } catch {}
            autoCloseTimer = null;
            autoCloseTimerSessionId = '';
        }

        function scheduleAutoCloseForCurrentSession(reason = '') {
            clearAutoCloseTimer();
            const hours = Number(AUTO_CLOSE_HOURS);
            if (!Number.isFinite(hours) || hours <= 0) return;
            const sid = String(document.getElementById('session-id')?.value || '').trim();
            if (!sid) return;
            const openedAtMs = Number(CURRENT_SESSION_OPENED_AT_MS);
            if (!Number.isFinite(openedAtMs) || openedAtMs <= 0) return;

            const dueAtMs = openedAtMs + (hours * 60 * 60 * 1000);
            const rawDelayMs = dueAtMs - Date.now();
            const delayMs = Math.max(0, Math.min(2147483647, rawDelayMs)); // setTimeout max (~24.8 days)
            autoCloseTimerSessionId = sid;
            console.log('[autoClose] Scheduling Done in', Math.round(delayMs / 1000), 'sec for session', sid, reason ? `(${reason})` : '');

            autoCloseTimer = setTimeout(() => {
                try {
                    const curSid = String(document.getElementById('session-id')?.value || '').trim();
                    if (!curSid || curSid !== sid) {
                        console.log('[autoClose] Session changed, skipping:', sid, '->', curSid);
                        return;
                    }
                    const btnDone = document.getElementById('btn-done-button');
                    if (!btnDone || btnDone.disabled) {
                        console.warn('[autoClose] Done button is disabled; skipping');
                        return;
                    }
                    console.log('[autoClose] Auto-clicking Done for session', sid);
                    btnDone.click();
                } catch (e) {
                    console.warn('[autoClose] Failed:', e);
                } finally {
                    clearAutoCloseTimer();
                }
            }, delayMs);
        }

	        function setSessionUiFromSessionObject(obj) {
	            try {
	                const nm = obj?.name || obj?.session_name || obj?.title || '';
                    const sid = getSessionId(obj);
	                const statusStr = String(obj?.status || '').toLowerCase();
	                const open = isSessionOpen(obj);
	                console.log('[setSessionUI] name:', nm, 'open:', open, 'status:', statusStr);
	                const createdAt = getSessionCreatedAtDate(obj) || parseLocalYmdHm(nm);
	                CURRENT_SESSION_OPENED_AT_MS = createdAt ? createdAt.getTime() : 0;
	                
	                const sidEl = document.getElementById('session-id');
	                const nameEl = document.getElementById('session-name');
	                const openedEl = document.getElementById('session-opened-at');
	                setPageSessionIdEverywhere(sid);
	                setPageSessionNameEverywhere(nm);
	                if (sidEl && 'value' in sidEl) sidEl.value = sid;
	                if (nameEl) { nameEl.disabled = false; }
	                if (openedEl) {
	                    let openedStr = createdAt ? defaultSessionName(createdAt) : '';
	                    if (!openedStr && typeof nm === 'string' && /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(nm)) {
	                        openedStr = nm;
	                    }
	                    openedEl.textContent = openedStr ? `Opened: ${openedStr}` : '';
	                }
	                try { open ? scheduleAutoCloseForCurrentSession('session') : clearAutoCloseTimer(); } catch {}
	                return open;
	            } catch (e) { 
	                console.error('[setSessionUI] Error:', e);
	                return false; 
	            }
	        }

	        function initTooltips() {
	            try {
                const TOOLTIP_BY_ID = {
                    'start-btn': 'New: create a brand-new active session and begin recording.',
                    'record-btn': 'Rec: record into active session (activates page session on /voice/session/:id).',
                    'chunk-btn': 'Cut the current chunk right now.',
                    'pause-btn': 'Pause recording (finalizes current chunk and uploads).',
                    'btn-done-button': 'Close only the page session from the current session card.',
                    'btn-choose-file': 'Upload an audio file to the current session.',
                    'btn-reset': 'Reset settings to defaults.',
                    'btn-logout-app': 'Logout from VoiceBot.',
                    'fab-call': 'Open the recording control dock.',
                    'panel-gear': 'Open Settings panel.',
                    'panel-close': 'Close the side panel.',
	
                    'mic-count': 'How many microphone inputs are shown/used (1–9).',
                    'tog-separate-tracks': 'Record separate tracks per microphone instead of a single mixed track.',
	                    'inp-min-chunk': 'Minimum chunk length (minutes). Before this, silence splitting is disabled.',
                    'inp-max-chunk': 'Maximum chunk length (minutes). When reached, chunk is force-cut.',
                    'inp-sil-min': 'Required silence (seconds) near MAX chunk length (end). Can be 0.',
                    'inp-sil-max': 'Required silence (seconds) near MIN chunk length (start).',
                    'auto-upload': 'Automatically upload each chunk after it is cut.',
                    'low-cpu-mode': 'Reduce CPU usage for monitoring (lower meter update rate and FFT sizes).',
                    'inp-speech-ratio': 'Minimum speech ratio (%) required to auto-upload a chunk.',
                    'inp-speech-mode': 'Speech threshold mode: Manual (fixed dB) or Dynamic (noise + margin).',
                    'inp-noise-threshold': 'Fixed threshold in dBFS (Manual mode).',
                    'inp-speech-margin': 'Speech must exceed noise floor by this dB margin to count as speech (Dynamic mode).',
	                    'inp-auto-close-hours': 'Auto-click Done after N hours since session creation. Set 0 to disable.',
                    'spk-select': 'Speaker/output device used for Audio monitor.',
	
	                    'session-id': 'VoiceBot session ID where audio chunks will be uploaded.',
	                    'btn-open-session-link': 'Open public session link in the same tab.',
	                    'btn-pick-session': 'Find an open session from recent sessions.',
	                    'session-name': 'Session name/title (editable while session is open).',
	                    'btn-copy-session-name': 'Copy session name to clipboard.',
	                    'btn-upload-all': 'Upload all chunks that are not uploaded yet.',
                        'fab-session-id': 'VoiceBot session ID where audio chunks will be uploaded.',
                        'fab-open-session-link': 'Open public session link in the same tab.',
                        'fab-session-name': 'Session name/title (click or use pencil to edit).',
                        'fab-edit-session-name': 'Toggle session name editing in FAB.',
                        'fab-session-project': 'Project for the active session (editable).',
	                };

                    // Dynamic mic controls (Mic 1..9)
                    try {
                        for (let i = 1; i <= MAX_MIC_COUNT; i++) {
                            TOOLTIP_BY_ID[`mic-${i}-select`] = `Mic ${i} input device.\nSelect OFF to disable Mic ${i}.\nTip: use a physical microphone OR the output of your noise suppression system (e.g., "NVIDIA Noise Removal"/"Krisp").\nTip: for app audio (Google Meet/Telegram) choose a virtual cable device here.`;
                            TOOLTIP_BY_ID[`mic-${i}-vol`] = `Mic ${i} gain (0–200%). Affects monitoring and recordings.`;
                            TOOLTIP_BY_ID[`mic-${i}-monitor`] = `Audio monitor for Mic ${i}: when enabled, copies this mic to Speaker output. Use headphones to avoid echo.`;
                            TOOLTIP_BY_ID[`mic-${i}-aec`] = `Enable AEC/NS/AGC for Mic ${i}: echo cancellation, noise suppression, and automatic gain control.`;
                        }
                    } catch {}
	
	                for (const [id, text] of Object.entries(TOOLTIP_BY_ID)) {
	                    const el = document.getElementById(id);
	                    if (!el) continue;
	                    const has = el.getAttribute('title');
	                    if (!has && text) el.setAttribute('title', text);
	                }
	
	                // Labels: inherit tooltip from their target control whenever possible.
	                document.querySelectorAll('label').forEach((label) => {
	                    if (label.getAttribute('title')) return;
	                    const forId = label.getAttribute('for');
	                    let target = forId ? document.getElementById(forId) : null;
	                    if (!target) target = label.querySelector('input,select,textarea,button');
	                    const mapped = target?.id ? TOOLTIP_BY_ID[target.id] : '';
	                    const t = mapped || target?.getAttribute('title') || '';
	                    if (t) { label.setAttribute('title', t); return; }
	                    const txt = label.textContent.replace(/\s+/g, ' ').trim();
	                    if (txt) label.setAttribute('title', txt);
	                });
	
	                // Fallback: add a tooltip for any remaining interactive elements.
	                document.querySelectorAll('input,select,textarea,button').forEach((el) => {
	                    if (el.getAttribute('title')) return;
	                    const aria = el.getAttribute('aria-label') || '';
	                    const ph = el.getAttribute('placeholder') || '';
	                    const txt = (el.tagName === 'BUTTON') ? el.textContent.replace(/\s+/g, ' ').trim() : '';
	                    const t = (aria || ph || txt).trim();
	                    if (t) el.setAttribute('title', t);
	                });
	            } catch (e) {
	                console.warn('initTooltips failed', e);
	            }
	        }
        // Auto-join today's session (does not create new sessions)
        async function autoPickSessionId() {
            console.log('[autoPickSessionId] Starting...');
            try {
                const sidEl = document.getElementById('session-id');
                const snameEl = document.getElementById('session-name');
                const startBtn = document.getElementById('start-btn');
                const recordBtn = document.getElementById('record-btn');
                if (!AUTH_TOKEN) {
                    console.warn('[autoPickSessionId] No auth token');
                    return;
                }
                // ensure we know current user's performer id
                if (!MY_PERFORMER_ID) {
                    console.log('[autoPickSessionId] Fetching performer ID...');
                    try {
                        const meResp = await fetch(endpoints.me(), { headers: { 'X-Authorization': AUTH_TOKEN, 'Accept': 'application/json' } });
                        const meText = await meResp.text();
                        if (meResp.ok) {
                            const me = meText ? JSON.parse(meText) : {};
                            const profile = cacheMeProfile(me);
                            if (profile?.performerId) {
                                console.log('[autoPickSessionId] Performer ID:', profile.performerId);
                            }
                            setCurrentUserLabel(me);
                        }
                    } catch (e) { console.warn('[autoPickSessionId] Failed to fetch /me:', e); }
                }
                const sessions = await getRecentSessions();
                const today = localYmd(new Date()); // YYYY-MM-DD in local time
                console.log('[autoPickSessionId] Today:', today, 'My ID:', MY_PERFORMER_ID);
                
                // Find today's open session for current user
                let pick = null;
                for (const s of sessions) {
                    const perfId = getSessionPerformerId(s);
                    if (String(perfId) !== String(MY_PERFORMER_ID)) continue;
                    if (!isSessionOpen(s)) continue;
                    const createdDay = getSessionCreatedAtLocalYmd(s);
                    const nameDay = typeof s?.name === 'string' ? String(s.name).slice(0, 10) : '';
                    if (createdDay === today || nameDay === today) { pick = s; break; }
                }
                
                if (pick) {
                    // Join today's session
                    const sid = getSessionId(pick);
                    console.log('[autoPickSessionId] Found today session:', sid);
                    if (sidEl && sid) {
                        SUPPRESS_SID_FETCH = true;
                        sidEl.value = sid;
                        rememberLastSessionId(sid);
                        setSessionUiFromSessionObject(pick);
                        setTimeout(() => { SUPPRESS_SID_FETCH = false; }, 0);
                        if (startBtn) {
                            startBtn.disabled = false;
                            console.log('[autoPickSessionId] Start button enabled');
                        }
                        if (recordBtn) recordBtn.disabled = false;
                        syncMicUI();
                        console.log('[autoPickSessionId] ✓ Joined session:', sid);
                    }
                } else {
                    // No open session for today; do not create one automatically.
                    console.log('[autoPickSessionId] No today session; not creating (explicit Start required).');
                    if (snameEl) snameEl.value = '';
                    if (startBtn) startBtn.disabled = false;
                    if (recordBtn) recordBtn.disabled = false;
                    syncMicUI();
                }
            } catch (e) {
                console.error('[autoPickSessionId] ✗ Failed:', e);
                alert('Failed to initialize session: ' + e);
            }
        }

        // Removed session-detail helpers; sessions list is the single source of truth.

        // Ensure we have an open session using only the sessions list when explicitly requested
        async function ensureOpenSessionOrPick(opts = {}) {
            const sidEl = document.getElementById('session-id');
            const snameEl = document.getElementById('session-name');
            let sid = sidEl && 'value' in sidEl ? String(sidEl.value || '').trim() : '';
            if (!AUTH_TOKEN) return sid;
            if (sid) return sid;
            if (!opts.allowPick) return '';

            const sessions = await getRecentSessions();
            const today = localYmd(new Date());

            const setSidFromSession = (s) => {
                const newSid = getSessionId(s);
                if (!newSid) return '';
                sid = newSid;
                if (sidEl) {
                    SUPPRESS_SID_FETCH = true;
                    sidEl.value = sid;
                    setTimeout(() => { SUPPRESS_SID_FETCH = false; }, 0);
                }
                rememberLastSessionId(sid);
                setSessionUiFromSessionObject(s);
                try { syncMicUI(); } catch {}
                return sid;
            };

            // If no session id entered, try to auto-pick today (no auto-create).
            if (!sid) {
                try { await autoPickSessionId(); } catch {}
                sid = sidEl && 'value' in sidEl ? String(sidEl.value || '').trim() : '';
                if (snameEl) snameEl.disabled = !sid;
                return sid;
            }

            // Validate current sid against recent sessions list.
            const cur = sessions.find(s => String(getSessionId(s)) === String(sid));
            if (cur) {
                const open = setSessionUiFromSessionObject(cur);
                try { syncMicUI(); } catch {}
                if (open) return sid;
            }

            // Fallback: pick newest open session for *me* (prefer today), otherwise do nothing.
            let pick = null;
            for (const s of sessions) {
                if (!isSessionOpen(s)) continue;
                const perfId = getSessionPerformerId(s);
                if (MY_PERFORMER_ID && String(perfId) !== String(MY_PERFORMER_ID)) continue;
                const createdDay = getSessionCreatedAtLocalYmd(s);
                const nameDay = typeof s?.name === 'string' ? String(s.name).slice(0, 10) : '';
                if (createdDay === today || nameDay === today) { pick = s; break; }
                if (!pick) pick = s;
            }

            if (pick) return setSidFromSession(pick);
            if (snameEl) snameEl.disabled = true;
            return sid;
        }

        // Update session name via dedicated endpoint
        async function updateSessionNameAPI(sessionId, newName) {
            const payload = { session_id: String(sessionId || ''), session_name: String(newName || '') };
            const resp = await fetch(endpoints.updateSessionName(), {
                method: 'POST',
                headers: { 'X-Authorization': AUTH_TOKEN, 'Accept': 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const text = await resp.text();
            if (!resp.ok) throw new Error(text || `status ${resp.status}`);
            try { return text ? JSON.parse(text) : {}; } catch { return {}; }
        }

        async function updateSessionProjectAPI(sessionId, projectId) {
            const payload = { session_id: String(sessionId || ''), project_id: String(projectId || '') };
            const resp = await fetch(endpoints.updateSessionProject(), {
                method: 'POST',
                headers: { 'X-Authorization': AUTH_TOKEN, 'Accept': 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const text = await resp.text();
            if (!resp.ok) throw new Error(text || `status ${resp.status}`);
            try { return text ? JSON.parse(text) : {}; } catch { return {}; }
        }

        // (createChunkListItem is defined later with compact player + actions)
        
        // Settings panel is always expanded in Settings view
        (function initSettingsToggle(){
            const panel = document.getElementById('params');
            const appRoot = document.getElementById('app');
            let settingsOpen = true;
            let devicesEnumerated = false;
	            const ensureDevicesReady = async () => {
	                if (devicesEnumerated) return;
	                try { await initDeviceEnumeration(); devicesEnumerated = true; } catch {}
	            };
	            const sync = () => {
	                // Visibility fully controlled by CSS via #app.settings-open
	                if (appRoot) appRoot.classList.toggle('settings-open', settingsOpen);
	                if (panel) panel.style.display = settingsOpen ? 'block' : 'none';
	            };
            sync();
            if (PAGE_MODE === 'settings') {
                ensureSettingsDevices('settings-open').catch(()=>{});
            } else {
                ensureDevicesReady();
            }
        })();

        async function resetSettingsToDefaults(opts = {}) {
            const { silent = false, reason = 'reset', toastEl = null } = opts || {};
            try {
                // Stop recording first to avoid graph churn.
                if (isRecording) {
                    try { await stopRecording({ reason: `reset:${reason}` }); } catch {}
                }
                try { clearAutoCloseTimer(); } catch {}
                try { await teardownMonitoringGraph(`reset:${reason}`, { keepContext: false }); } catch {}
                allowMonitoringInit = false;

                // Clear localStorage (new keys + historical aliases).
                const keys = [
                    'minChunkSec', 'maxChunkSec', 'silMinSec', 'silMaxSec', 'autoCloseHours',
                    'minSpeechRatio', 'speechThresholdMode', 'noiseThresholdDb', 'speechDbMargin', 'noiseAvgMs',
                    'autoUpload', 'micCount', 'recSeparate', 'outputDeviceId', 'rawAudioMode', 'aecNsAgcEnabled',
                    'micCountUserSet', 'deviceLabelsMissing',
                    // legacy aliases
                    'monitorOn', 'monitorVol', 'minSpeechMs',
                ];
                for (let i = 1; i <= MAX_MIC_COUNT; i++) {
                    const devKey = (i === 1) ? 'micDeviceId' : (i === 2) ? 'mic2DeviceId' : `mic${i}DeviceId`;
                    keys.push(devKey, `mic${i}Vol`, `mic${i}Monitor`, `mic${i}AecNsAgc`);
                }
                keys.forEach(k => { try { localStorage.removeItem(k); } catch {} });

                // Reset in-memory defaults.
                MIN_CHUNK_SEC = 180; MAX_CHUNK_SEC = 420;   // 3–7 minutes
                SILENCE_MIN_SEC = 0; SILENCE_MAX_SEC = 5;   // 0–5 seconds
                AUTO_CLOSE_HOURS = 2;
                MIN_SPEECH_RATIO = 3.5;
                SPEECH_THRESHOLD_MODE = 'dynamic';
                NOISE_THRESHOLD_DB = -50;
                SPEECH_DB_MARGIN = 5;
                NOISE_AVG_MS = 1500;
                micCount = 2;
                recordSeparate = true;
                lowCpuMode = false;
                selectedOutputId = '';
                autoUploadChunks = true;
                aecNsAgcEnabled = true;

                for (let i = 1; i <= MAX_MIC_COUNT; i++) {
                    micDeviceIds[i] = null;
                    micGainValues[i] = 1.0;
                    // After reset we keep monitoring OFF by default (safer: avoids echo).
                    // populateDevices({afterReset:true}) may enable monitoring for known virtual-cable inputs.
                    micMonitorOn[i] = false;
                    micAecNsAgc[i] = true;
                }
                recomputeDerived();

                // Update UI state.
                const micCountEl = document.getElementById('mic-count');
                if (micCountEl && 'value' in micCountEl) micCountEl.value = String(micCount);
                const sepEl = document.getElementById('tog-separate-tracks');
                if (sepEl && 'checked' in sepEl) sepEl.checked = true;
                const autoEl = document.getElementById('auto-upload');
                if (autoEl && 'checked' in autoEl) autoEl.checked = true;
                const lowEl = document.getElementById('low-cpu-mode');
                if (lowEl && 'checked' in lowEl) lowEl.checked = false;
                const spkEl = document.getElementById('spk-select');
                if (spkEl && 'value' in spkEl) spkEl.value = '__off__';

                try { ensureMicGroups(micCount); } catch {}
                for (let i = 1; i <= micCount; i++) {
                    const volEl = document.getElementById(`mic-${i}-vol`);
                    const volLabel = document.getElementById(`mic-${i}-vol-label`);
                    if (volEl && 'value' in volEl) volEl.value = '100';
                    if (volLabel) volLabel.textContent = '100%';
                    const cb = document.getElementById(`mic-${i}-monitor`);
                    if (cb && 'checked' in cb) cb.checked = micMonitorOn[i];
                    const aecCb = document.getElementById(`mic-${i}-aec`);
                    if (aecCb && 'checked' in aecCb) aecCb.checked = micAecNsAgc[i];
                }

                updateParamsUI();
                try { saveParams(); } catch {}

                // Re-enumerate devices. If permission is missing, request it once on reset.
                try {
                    const labelsOk = await ensureDeviceLabels(`reset:${reason}`);
                    if (labelsOk) {
                        await ensureActiveMicSelection(`reset:${reason}`, { forceDefaults: true });
                    } else {
                        await populateDevices({ afterReset: true });
                    }
                } catch {}
                // Final reset step: hide the second mic by default while keeping its selection configured.
                try {
                    micCount = 1;
                    try { localStorage.setItem('micCount', '1'); } catch {}
                    const micCountEl2 = document.getElementById('mic-count');
                    if (micCountEl2 && 'value' in micCountEl2) micCountEl2.value = '1';
                    try { ensureMicGroups(micCount); } catch {}
                } catch {}
                try { notifySettingsIframe('sync-devices'); } catch {}
                try { renderPerTrackList(); } catch {}
                try { saveParams(); } catch {}
                try { scheduleAutoCloseForCurrentSession('reset'); } catch {}

                if (!silent && toastEl) {
                    showInlineToast(toastEl, 'Настройки сброшены / Settings reset', 1500);
                }
                return true;
            } catch (e) {
                console.error('Reset failed', e);
                if (!silent) alert('Failed to reset settings: ' + e);
                return false;
            }
        }

        // Reset button - restore all settings to default values
        (function initResetButton(){
            const btn = document.getElementById('btn-reset');
            if (!btn) return;
            btn.addEventListener('click', async () => {
                await resetSettingsToDefaults({ silent: false, reason: 'reset', toastEl: btn });
            });
        })();

        function setAuthUi(loggedIn) {
            const app = document.getElementById('app');
            const auth = document.getElementById('auth-card');
            if (loggedIn) {
                if (app) app.style.display = '';
                if (auth) auth.style.display = 'none';
                // Restore cached display name immediately
                try {
                    const cached = localStorage.getItem('VOICEBOT_ME_DISPLAY');
                    if (cached) setCurrentUserLabel({ name: cached });
                } catch {}
                // Refresh current user label in background
                try {
                    if (AUTH_TOKEN) {
                        fetch(endpoints.me(), { headers: { 'X-Authorization': AUTH_TOKEN, 'Accept': 'application/json' } })
                            .then(r => r.text())
                            .then(t => { try { const me = t ? JSON.parse(t) : {}; cacheMeProfile(me); setCurrentUserLabel(me); } catch {} });
                    }
                } catch {}
                // Не выбираем/создаём сессию автоматически — только по явному действию (FAB/Start).
                // Ensure devices are enumerated once we are in the app (only in secure context)
                if (IS_SECURE_OR_LOCAL && PAGE_MODE !== 'index') {
                    initDeviceEnumeration().catch(()=>{});
                }
                // Не закрываем/не сканируем сессии автоматически.
                syncFabAuthState();
                try { syncSessionMetaFromStorage(); } catch {}
                try {
                    const storedProjectId = String(localStorage.getItem(SESSION_PROJECT_ID_STORAGE_KEY) || '').trim();
                    const storedProjectName = String(localStorage.getItem(SESSION_PROJECT_NAME_STORAGE_KEY) || '');
                    refreshFabProjectOptions(storedProjectId, storedProjectName).catch(() => {});
                } catch {}
            } else {
                if (app) app.style.display = 'none';
                if (auth) auth.style.display = '';
                clearCurrentUserLabel();
                allowMonitoringInit = false;
                try { teardownMonitoringGraph('auth-logged-out'); } catch {}
                try {
                    _projectsCache = { ts: 0, projects: null, inflight: null };
                } catch {}
                try { setSessionProjectEverywhere('', ''); } catch {}
                syncFabAuthState();
            }
        }

        // Initialize header server name and scheme toggle
        (function initSchemeToggle(){
            try {
                const hostSpan = document.getElementById('srv-host');
                if (hostSpan) hostSpan.textContent = location.host || 'localhost';
                const btn = document.getElementById('btn-toggle-scheme');
                if (btn) btn.addEventListener('click', () => {
                    const toHttps = location.protocol === 'http:';
                    const target = (toHttps ? 'https:' : 'http:') + '//' + location.host + location.pathname + location.search + location.hash;
                    window.location.href = target;
                });
                // API-only toggle (does not reload page)
                const btnApi = document.getElementById('btn-toggle-api');
                if (btnApi) btnApi.addEventListener('click', () => {
                    const baseEl = document.getElementById('base-url');
                    if (!baseEl || !('value' in baseEl)) return;
                    let v = (baseEl.value || '').trim();
                    if (!v) v = API_BASE;
                    if (v.startsWith('https://')) {
                        v = DEFAULT_HTTP_API;
                    } else {
                        v = DEFAULT_HTTPS_API;
                    }
                    baseEl.value = v;
                    API_BASE = v;
                    localStorage.setItem('VOICEBOT_API_URL', API_BASE);
                });
                // HSTS hint
                const note = document.getElementById('scheme-note');
                if (note) {
                    if (location.protocol === 'https:') {
                        note.textContent = 'Note: your browser may enforce HTTPS (HSTS), so switching to HTTP might be blocked.';
                    } else {
                        note.textContent = 'MediaDevices require a secure context. Use HTTPS (https://webrtc.stratospace.fun) or localhost for device access.';
                    }
                }
                // Prefill API URL input based on computed default if not set
                const baseEl = document.getElementById('base-url');
                if (baseEl && 'value' in baseEl && !localStorage.getItem('VOICEBOT_API_URL')) {
                    baseEl.value = schemeBasedDefault;
                }
            } catch {}
        })();

        async function doLogin(opts = {}) {
            const base = (opts.baseUrl || opts.base || '').toString().trim() || document.getElementById('base-url')?.value?.trim() || API_BASE;
            const login = (opts.login !== undefined ? String(opts.login).trim() : (document.getElementById('login')?.value?.trim() || ''));
            const password = (opts.password !== undefined ? String(opts.password) : (document.getElementById('password')?.value || ''));
            const statusEl = document.getElementById('auth-status');
            console.log('[doLogin] Attempting login, user:', login, 'API:', base);
            try {
                API_BASE = base;
                localStorage.setItem('VOICEBOT_API_URL', API_BASE);
                const resp = await fetch(endpoints.login(), {
                    method: 'POST',
                    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                    body: JSON.stringify({ login, password })
                });
                logApi('try_login', { status: resp.status, ok: resp.ok });
                if (!resp.ok) {
                    const err = await resp.text();
                    console.error('[doLogin] Login failed:', err);
                    logApi('try_login.error', { status: resp.status, body: String(err || '').slice(0, 200) });
                    throw new Error(err);
                }
                const data = await resp.json();
                const token = data?.auth_token;
                if (!token) throw new Error('No auth_token');
                AUTH_TOKEN = token;
                localStorage.setItem('VOICEBOT_AUTH_TOKEN', token);
                console.log('[doLogin] ✓ Token received');
                // Fetch /me to know performer's id
                try {
                    const meResp = await fetch(endpoints.me(), { headers: { 'X-Authorization': AUTH_TOKEN, 'Accept': 'application/json' } });
                    if (meResp.ok) {
                        const me = await meResp.json();
                        const profile = cacheMeProfile(me);
                        if (profile?.performerId) {
                            console.log('[doLogin] Performer ID:', profile.performerId);
                        }
                        setCurrentUserLabel(me);
                    }
                } catch (e) { console.warn('[doLogin] Failed to fetch /me:', e); }
                if (statusEl) statusEl.textContent = 'Logged in';
                console.log('[doLogin] ✓ Login complete');
                setAuthUi(true);
            } catch (e) {
                if (statusEl) statusEl.textContent = `Auth failed: ${e}`;
                setAuthUi(false);
            }
        }

	        // --- Existing recording code ---
	        let mediaRecorder;
	        let mediaRecorders = []; // when recording separate tracks
	        let audioChunks = [];
		        let chunkIndex = 0; // sequential number for completed chunks
		        let isRecording = false;
                let isPaused = false;
                let isFinalUploading = false;
                let ACTIVE_SESSION_ID = '';
                let fabStartTs = 0;
                let fabPausedTs = 0;
                let fabPausedMs = 0;
                // Freeze elapsed time for FAB ring while Done/Logout finalizes uploads.
                let fabFrozenElapsedMs = -1;
                let fabOrbitTimer = null;
                let fabStopTimer = null;
                let pauseStartedAt = 0;
                let splitInProgress = false;
                let isUnloading = false;
                let unloadResetTimer = null;
                let activeUploadCount = 0;
                const resetUnloadingFlag = (reason) => {
                    if (!isUnloading) return;
                    isUnloading = false;
                    console.info(`[unload] reset flag via ${reason}`);
                };
                const hasPendingUploadsInUi = () => {
                    try {
                        const list = getChunksList();
                        const lis = list ? Array.from(list.querySelectorAll('li')) : [];
                        return lis.some((li) => {
                            if (!li || li.dataset?.silent === '1' || li.dataset?.corrupt === '1') return false;
                            if (isLiUploaded(li)) return false;
                            const upBtn = li.querySelector('button[data-role="upload"]');
                            return !!upBtn;
                        });
                    } catch {
                        return false;
                    }
                };
                const isUploadInFlight = () => activeUploadCount > 0;
                const hasOpenSessionForUnload = () => {
                    const sid = getSessionIdValue();
                    if (!sid) return false;
                    const state = String(readVoicebotState() || '').trim();
                    if (state === 'recording' || state === 'paused') return true;
                    if (isRecording || isPaused) return true;
                    return hasPendingUploadsInUi();
                };
		        const MAX_MIC_COUNT = 9;
		        // --- Audio graph state (monitoring + recording) ---
		        let audioContext = null;
		        let mixGain = null;
		        let mixAnalyser = null;
		        let mixDataArray = null;
                let mixTimeArray = null;
		
		        let monitorMixGain = null;
		        let monitorDest = null;
		        let monitorAudioEl = null;
		
		        let outAnalyser = null;
		        let outDataArray = null;
                let outTimeArray = null;
		
		        // Recording destinations
		        let recordDest = null;
		        let recordStream = null;
		
		        // Per-mic nodes/state (1-based index)
		        let micCount = 1;
		        let micDeviceIds = Array(MAX_MIC_COUNT + 1).fill(null);         // string | null
		        let micStreams = Array(MAX_MIC_COUNT + 1).fill(null);           // MediaStream | null
		        let micSources = Array(MAX_MIC_COUNT + 1).fill(null);           // MediaStreamAudioSourceNode | null
		        let micGainNodes = Array(MAX_MIC_COUNT + 1).fill(null);         // GainNode | null (volume)
		        let micGainValues = Array(MAX_MIC_COUNT + 1).fill(1.0);         // 1.0 = 100%
		        let micAnalysers = Array(MAX_MIC_COUNT + 1).fill(null);         // AnalyserNode | null
		        let micDataArrays = Array(MAX_MIC_COUNT + 1).fill(null);        // Uint8Array | null
                let micTimeArrays = Array(MAX_MIC_COUNT + 1).fill(null);       // Float32Array | null (time domain)
		        let micMonitorOn = Array(MAX_MIC_COUNT + 1).fill(true);         // boolean
		        let micAecNsAgc = Array(MAX_MIC_COUNT + 1).fill(true);          // boolean (per-mic)
		        let micMonitorGainNodes = Array(MAX_MIC_COUNT + 1).fill(null);  // GainNode | null (0/1 enable)
		
		        // Per-mic recording (separate tracks)
		        let micRecordDests = Array(MAX_MIC_COUNT + 1).fill(null);        // MediaStreamDestination | null
		
		        let selectedOutputId = '';
		        let recordSeparate = false; // record per-mic tracks instead of mix
		        let recordingMode = 'mixed'; // 'mixed' or 'separate' for current active recording
		        let modeSwitching = false;
	        let autoUploadChunks = true; // stored in localStorage as autoUpload (1/0); default true
		        let testingMode = false; // when true, monitoring is enabled without recording
		        let analysisRaf = 0;
		        let analysisTickTimer = 0;     // fallback loop for hidden/stalled tabs
		        let analysisInFlight = false;  // prevent re-entrant analyzeAudio() calls
        // Chunking / silence params
        // NOTE: internal storage is seconds, UI shows minutes.
	        let MIN_CHUNK_SEC = 180;        // default 3 minutes
	        let MAX_CHUNK_SEC = 420;        // default 7 minutes
	        let SILENCE_MIN_SEC = 0;        // required silence at MAX_CHUNK_SEC (can be 0)
	        let SILENCE_MAX_SEC = 5;        // required silence at MIN_CHUNK_SEC
	        let AUTO_CLOSE_HOURS = 2;       // 0 disables auto close
	        let CURRENT_SESSION_OPENED_AT_MS = 0;
	        let autoCloseTimer = null;
	        let autoCloseTimerSessionId = '';

        function secToUiMinutes(sec) {
            const m = Number(sec) / 60;
            if (!Number.isFinite(m)) return 0;
            const roundedInt = Math.round(m);
            if (Math.abs(m - roundedInt) < 1e-6) return roundedInt;
            const roundedHalf = Math.round(m * 2) / 2;
            if (Math.abs(m - roundedHalf) < 1e-6) return roundedHalf;
            return Number(m.toFixed(2));
        }

        function uiMinutesToSec(min) {
            const m = Number(min);
            if (!Number.isFinite(m) || m <= 0) return 0;
            return Math.max(1, Math.round(m * 60));
        }

        // Derived (ms)
        let minChunkMs = 0, maxChunkMs = 0, silenceMinMs = 0, silenceMaxMs = 0;
        function recomputeDerived() {
            minChunkMs = MIN_CHUNK_SEC * 1000;
            maxChunkMs = MAX_CHUNK_SEC * 1000;
            silenceMinMs = SILENCE_MIN_SEC * 1000;
            silenceMaxMs = SILENCE_MAX_SEC * 1000;
        }
        let paramsSaveTimer = null;
        function scheduleParamsSave(delayMs = 800) {
            try { if (paramsSaveTimer) clearTimeout(paramsSaveTimer); } catch {}
            paramsSaveTimer = setTimeout(() => {
                try { saveParams(); } catch (e) { console.warn('saveParams failed', e); }
            }, Math.max(100, delayMs));
        }
        function saveParams() {
            try {
                localStorage.setItem('minChunkSec', String(MIN_CHUNK_SEC));
                localStorage.setItem('maxChunkSec', String(MAX_CHUNK_SEC));
                localStorage.setItem('silMinSec', String(SILENCE_MIN_SEC));
                localStorage.setItem('silMaxSec', String(SILENCE_MAX_SEC));
                localStorage.setItem('autoCloseHours', String(AUTO_CLOSE_HOURS));
                localStorage.setItem('minSpeechRatio', String(MIN_SPEECH_RATIO));
                localStorage.setItem('speechThresholdMode', String(SPEECH_THRESHOLD_MODE));
                localStorage.setItem('noiseThresholdDb', String(NOISE_THRESHOLD_DB));
                localStorage.setItem('speechDbMargin', String(SPEECH_DB_MARGIN));
                localStorage.setItem('noiseAvgMs', String(NOISE_AVG_MS));
                localStorage.setItem('lowCpuMode', lowCpuMode ? '1' : '0');
                localStorage.setItem('aecNsAgcEnabled', aecNsAgcEnabled ? '1' : '0');
                localStorage.setItem('testingMode', testingMode ? '1' : '0');
                // Legacy key (rawAudioMode = inverted)
                localStorage.setItem('rawAudioMode', aecNsAgcEnabled ? '0' : '1');
	                const autoEl = document.getElementById('auto-upload');
	                if (autoEl && 'checked' in autoEl) autoUploadChunks = !!autoEl.checked;
	                localStorage.setItem('autoUpload', autoUploadChunks ? '1' : '0');
	                localStorage.setItem('micCount', String(micCount));
	                for (let i = 1; i <= MAX_MIC_COUNT; i++) {
	                    const devKey = (i === 1) ? 'micDeviceId' : (i === 2) ? 'mic2DeviceId' : `mic${i}DeviceId`;
	                    localStorage.setItem(devKey, micDeviceIds[i] ? String(micDeviceIds[i]) : '__off__');
	                    localStorage.setItem(`mic${i}Vol`, String(Math.round((micGainValues[i] || 1.0) * 100)));
                    localStorage.setItem(`mic${i}Monitor`, micMonitorOn[i] ? '1' : '0');
                    localStorage.setItem(`mic${i}AecNsAgc`, micAecNsAgc[i] ? '1' : '0');
                }
	                // separate tracks
	                const sep = document.getElementById('tog-separate-tracks');
	                if (sep && 'checked' in sep) localStorage.setItem('recSeparate', sep.checked ? '1' : '0');
	            } catch {}
	        }
	        function loadParams() {
	            const n = (v, d) => { const x = Number(v); return Number.isFinite(x) && x>0 ? x : d; };
	            const n0 = (v, d) => { const x = Number(v); return Number.isFinite(x) && x>=0 ? x : d; };
	            const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
	            try {
	                MIN_CHUNK_SEC = n(localStorage.getItem('minChunkSec'), MIN_CHUNK_SEC);
	                MAX_CHUNK_SEC = n(localStorage.getItem('maxChunkSec'), MAX_CHUNK_SEC);
	                SILENCE_MIN_SEC = n0(localStorage.getItem('silMinSec'), SILENCE_MIN_SEC);
	                SILENCE_MAX_SEC = n0(localStorage.getItem('silMaxSec'), SILENCE_MAX_SEC);
                AUTO_CLOSE_HOURS = n0(localStorage.getItem('autoCloseHours'), AUTO_CLOSE_HOURS);
                {
                    const raw = Number(localStorage.getItem('minSpeechRatio'));
                    if (Number.isFinite(raw)) MIN_SPEECH_RATIO = clamp(raw, 0, 100);
                }
                {
                    const mode = String(localStorage.getItem('speechThresholdMode') || '').trim();
                    if (mode === 'manual' || mode === 'dynamic') SPEECH_THRESHOLD_MODE = mode;
                }
                {
                    const raw = Number(localStorage.getItem('noiseThresholdDb'));
                    if (Number.isFinite(raw)) NOISE_THRESHOLD_DB = clamp(raw, -80, -20);
                }
                {
                    const raw = Number(localStorage.getItem('speechDbMargin'));
                    if (Number.isFinite(raw)) SPEECH_DB_MARGIN = clamp(raw, 0, 12);
                }
                {
                    const raw = Number(localStorage.getItem('noiseAvgMs'));
                    if (Number.isFinite(raw) && raw >= 0) NOISE_AVG_MS = Math.round(raw);
                }
                const lowRaw = localStorage.getItem('lowCpuMode');
                lowCpuMode = (lowRaw === '1' || lowRaw === 'true');
                const testRaw = localStorage.getItem('testingMode');
                testingMode = (testRaw === '1' || testRaw === 'true');
                {
                    const aecMode = localStorage.getItem('aecNsAgcEnabled');
                    if (aecMode === null) {
                        const rawMode = localStorage.getItem('rawAudioMode');
                        if (rawMode !== null) aecNsAgcEnabled = !(rawMode === '1' || rawMode === 'true');
                    } else {
                        aecNsAgcEnabled = (aecMode === '1' || aecMode === 'true');
                    }
                }
                // auto-upload default true if absent
                const au = localStorage.getItem('autoUpload');
                const autoVal = (au === null) ? true : (au === '1' || au === 'true');
                autoUploadChunks = autoVal;
                const autoEl = document.getElementById('auto-upload');
                if (autoEl && 'checked' in autoEl) autoEl.checked = autoVal;
                const lowEl = document.getElementById('low-cpu-mode');
                if (lowEl && 'checked' in lowEl) lowEl.checked = lowCpuMode;
                // source toggles removed: nothing to load
                // separate tracks
	                const sep = document.getElementById('tog-separate-tracks');
	                const sepStored = localStorage.getItem('recSeparate');
	                recordSeparate = (sepStored === '1' || sepStored === 'true');
	                if (sep && 'checked' in sep) sep.checked = recordSeparate;
	                // micCount
	                const storedCount = Number(localStorage.getItem('micCount'));
	                if (Number.isFinite(storedCount)) micCount = clamp(Math.round(storedCount), 1, MAX_MIC_COUNT);
	                const micCountEl = document.getElementById('mic-count');
	                if (micCountEl && 'value' in micCountEl) micCountEl.value = String(micCount);
	
	                // Per-mic settings (device id, volume, monitor)
	                for (let i = 1; i <= MAX_MIC_COUNT; i++) {
	                    const devKey = (i === 1) ? 'micDeviceId' : (i === 2) ? 'mic2DeviceId' : `mic${i}DeviceId`;
	                    const devRaw = localStorage.getItem(devKey);
	                    micDeviceIds[i] = (devRaw && devRaw !== '__off__' && devRaw !== 'OFF') ? String(devRaw) : null;
	
	                    const volStored = Number(localStorage.getItem(`mic${i}Vol`));
	                    const volPct = Number.isFinite(volStored) ? clamp(volStored, 0, 200) : 100;
	                    micGainValues[i] = volPct / 100.0;
	
                    const monRaw = localStorage.getItem(`mic${i}Monitor`);
                    const monVal = (monRaw === null) ? true : (monRaw === '1' || monRaw === 'true');
                    micMonitorOn[i] = !!monVal;

                    const aecRaw = localStorage.getItem(`mic${i}AecNsAgc`);
                    const aecVal = (aecRaw === null) ? aecNsAgcEnabled : (aecRaw === '1' || aecRaw === 'true');
                    micAecNsAgc[i] = !!aecVal;
                }
	
	                selectedOutputId = String(localStorage.getItem('outputDeviceId') || '').trim();
	
	                // Ensure mic groups exist and apply UI values (options are filled later by populateDevices)
	                try { ensureMicGroups(micCount); } catch {}
	                for (let i = 1; i <= micCount; i++) {
	                    const pct = clamp(Math.round((micGainValues[i] || 1.0) * 100), 0, 200);
	                    const volEl = document.getElementById(`mic-${i}-vol`);
	                    const volLabel = document.getElementById(`mic-${i}-vol-label`);
	                    if (volEl && 'value' in volEl) volEl.value = String(pct);
	                    if (volLabel) volLabel.textContent = `${pct}%`;
	                    const cb = document.getElementById(`mic-${i}-monitor`);
	                    if (cb && 'checked' in cb) cb.checked = micMonitorOn[i];
	                }
	                const spkSel = document.getElementById('spk-select');
	                if (spkSel && 'value' in spkSel && selectedOutputId) spkSel.value = selectedOutputId;
	            } catch {}
	            // basic constraints
	            MIN_CHUNK_SEC = clamp(MIN_CHUNK_SEC, 180, 420);
	            MAX_CHUNK_SEC = clamp(MAX_CHUNK_SEC, 180, 420);
	            if (MIN_CHUNK_SEC >= MAX_CHUNK_SEC) {
	                if (MIN_CHUNK_SEC >= 420) {
	                    MIN_CHUNK_SEC = 390;
	                    MAX_CHUNK_SEC = 420;
	                } else {
	                    MAX_CHUNK_SEC = clamp(MIN_CHUNK_SEC + 30, 180, 420); // keep >= 0.5 min gap
	                }
	            }
            if (SILENCE_MIN_SEC < 0) SILENCE_MIN_SEC = 0;
            if (SILENCE_MAX_SEC < SILENCE_MIN_SEC) SILENCE_MAX_SEC = SILENCE_MIN_SEC;
            recomputeDerived();
            try { applyAnalysisConfig(); } catch {}
        }
	        function updateParamsUI() {
	            const e = (id)=>document.getElementById(id);
	            const pmn = e('param-min');
	            const pmx = e('param-max');
            const psn = e('param-sil-min');
            const psx = e('param-sil-max');
            if (pmn) pmn.textContent = `${secToUiMinutes(MIN_CHUNK_SEC)}m`;
            if (pmx) pmx.textContent = `${secToUiMinutes(MAX_CHUNK_SEC)}m`;
            if (psn) psn.textContent = `${SILENCE_MIN_SEC}s`;
            if (psx) psx.textContent = `${SILENCE_MAX_SEC}s`;
            const legend = e('chunk-legend');
            if (legend) legend.textContent = `· tick = min chunk ${secToUiMinutes(MIN_CHUNK_SEC)} min · 100% = max chunk duration ${secToUiMinutes(MAX_CHUNK_SEC)} min`;
            // reflect numeric inputs
            const setVal = (id, v) => { const el = e(id); if (el && 'value' in el) el.value = String(v); };
            setVal('inp-min-chunk', secToUiMinutes(MIN_CHUNK_SEC));
            setVal('inp-max-chunk', secToUiMinutes(MAX_CHUNK_SEC));
            setVal('inp-sil-min', SILENCE_MIN_SEC);
            setVal('inp-sil-max', SILENCE_MAX_SEC);
            setVal('inp-auto-close-hours', AUTO_CLOSE_HOURS);
            // Ensure a Min Speech Ratio input exists
            try {
                const paramsCard = document.getElementById('params');
                if (paramsCard && !document.getElementById('inp-speech-ratio')) {
                    const row = document.createElement('div');
                    row.id = 'speech-ratio-row';
                    row.className = 'row settings-only';
                    row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '8px'; row.style.flexWrap = 'wrap'; row.style.marginTop = '6px';
                    const lbl = document.createElement('label'); lbl.textContent = 'Min Speech Ratio (%)'; lbl.className = 'settings-row-label'; lbl.title = 'Minimum percentage of speech within a chunk required for auto-upload.';
                    const input = document.createElement('input'); input.type='number'; input.id='inp-speech-ratio'; input.min='0'; input.max='100'; input.step='0.1'; input.className='btn'; input.style.width='90px'; input.title = 'Minimum percentage of speech within a chunk required for auto-upload.';
                    const cur = document.createElement('small'); cur.id='param-speech-ratio'; cur.className='settings-row-value';
                    row.appendChild(lbl); row.appendChild(input); row.appendChild(cur);
                    const autoRow = document.getElementById('auto-close-row');
                    if (autoRow && autoRow.parentNode) autoRow.parentNode.insertBefore(row, autoRow);
                    else paramsCard.appendChild(row);
                    input.addEventListener('change', ()=>{
                        let v = Number(input.value);
                        if (!Number.isFinite(v) || v < 0) v = MIN_SPEECH_RATIO;
                        MIN_SPEECH_RATIO = Math.round(clampNum(v, 0, 100) * 10) / 10;
                        saveParams();
                        updateParamsUI();
                    });
                }
                setVal('inp-speech-ratio', MIN_SPEECH_RATIO);
                const cur = document.getElementById('param-speech-ratio'); if (cur) cur.textContent = `= ${MIN_SPEECH_RATIO.toFixed(1)}%`;
            } catch {}
            // Ensure a Speech threshold mode input exists
            try {
                const paramsCard = document.getElementById('params');
                if (paramsCard && !document.getElementById('inp-speech-mode')) {
                    const row = document.createElement('div');
                    row.id = 'speech-mode-row';
                    row.className = 'row settings-only';
                    row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '8px'; row.style.flexWrap = 'wrap'; row.style.marginTop = '6px';
                    const lbl = document.createElement('label'); lbl.textContent = 'Speech threshold mode'; lbl.className = 'settings-row-label'; lbl.title = 'How speech is detected: manual fixed threshold or dynamic noise + margin.';
                    const select = document.createElement('select'); select.id='inp-speech-mode'; select.className='btn'; select.title = 'How speech is detected: manual fixed threshold or dynamic noise + margin.';
                    const optManual = document.createElement('option'); optManual.value = 'manual'; optManual.textContent = 'Manual (fixed threshold)';
                    const optDynamic = document.createElement('option'); optDynamic.value = 'dynamic'; optDynamic.textContent = 'Dynamic (noise + margin)';
                    select.appendChild(optManual); select.appendChild(optDynamic);
                    row.appendChild(lbl); row.appendChild(select);
                    const autoRow = document.getElementById('auto-close-row');
                    if (autoRow && autoRow.parentNode) autoRow.parentNode.insertBefore(row, autoRow);
                    else paramsCard.appendChild(row);
                    select.addEventListener('change', ()=>{
                        const v = String(select.value || 'manual');
                        SPEECH_THRESHOLD_MODE = (v === 'dynamic') ? 'dynamic' : 'manual';
                        saveParams();
                        updateParamsUI();
                    });
                }
                const sel = document.getElementById('inp-speech-mode');
                if (sel) sel.value = SPEECH_THRESHOLD_MODE;
            } catch {}
            // Ensure a Noise threshold input exists (Manual mode)
            try {
                const paramsCard = document.getElementById('params');
                if (paramsCard && !document.getElementById('inp-noise-threshold')) {
                    const row = document.createElement('div');
                    row.id = 'noise-threshold-row';
                    row.className = 'row settings-only';
                    row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '8px'; row.style.flexWrap = 'wrap'; row.style.marginTop = '6px';
                    const lbl = document.createElement('label'); lbl.textContent = 'Noise threshold (dB)'; lbl.className = 'settings-row-label'; lbl.title = 'Manual speech threshold in dBFS. Any level above this counts as speech.';
                    const input = document.createElement('input'); input.type='number'; input.id='inp-noise-threshold'; input.min='-80'; input.max='-20'; input.step='1'; input.className='btn'; input.style.width='90px'; input.title = 'Manual speech threshold in dBFS.';
                    const cur = document.createElement('small'); cur.id='param-noise-threshold'; cur.className='settings-row-value';
                    row.appendChild(lbl); row.appendChild(input); row.appendChild(cur);
                    const autoRow = document.getElementById('auto-close-row');
                    if (autoRow && autoRow.parentNode) autoRow.parentNode.insertBefore(row, autoRow);
                    else paramsCard.appendChild(row);
                    input.addEventListener('change', ()=>{
                        let v = Number(input.value);
                        if (!Number.isFinite(v)) v = NOISE_THRESHOLD_DB;
                        NOISE_THRESHOLD_DB = Math.round(clampNum(v, -80, -20));
                        saveParams();
                        updateParamsUI();
                    });
                }
                setVal('inp-noise-threshold', NOISE_THRESHOLD_DB);
                const cur = document.getElementById('param-noise-threshold'); if (cur) cur.textContent = `= ${NOISE_THRESHOLD_DB} dB`;
            } catch {}
            // Ensure a Noise margin input exists (Dynamic mode)
            try {
                const paramsCard = document.getElementById('params');
                if (paramsCard && !document.getElementById('inp-speech-margin')) {
                    const row = document.createElement('div');
                    row.id = 'speech-margin-row';
                    row.className = 'row settings-only';
                    row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '8px'; row.style.flexWrap = 'wrap'; row.style.marginTop = '6px';
                    const lbl = document.createElement('label'); lbl.textContent = 'Speech above noise (dB)'; lbl.className = 'settings-row-label'; lbl.title = 'Dynamic mode margin: speech is counted when level exceeds noise floor by this many dB.';
                    const input = document.createElement('input'); input.type='number'; input.id='inp-speech-margin'; input.min='0'; input.max='12'; input.step='0.5'; input.className='btn'; input.style.width='90px'; input.title = 'Dynamic mode margin: speech is counted when level exceeds noise floor by this many dB.';
                    const cur = document.createElement('small'); cur.id='param-speech-margin'; cur.className='settings-row-value';
                    row.appendChild(lbl); row.appendChild(input); row.appendChild(cur);
                    const autoRow = document.getElementById('auto-close-row');
                    if (autoRow && autoRow.parentNode) autoRow.parentNode.insertBefore(row, autoRow);
                    else paramsCard.appendChild(row);
                    input.addEventListener('change', ()=>{
                        let v = Number(input.value);
                        if (!Number.isFinite(v)) v = SPEECH_DB_MARGIN;
                        v = clampNum(v, 0, 12);
                        SPEECH_DB_MARGIN = Math.round(v * 2) / 2;
                        saveParams();
                        updateParamsUI();
                    });
                }
                setVal('inp-speech-margin', SPEECH_DB_MARGIN);
                const cur = document.getElementById('param-speech-margin'); if (cur) cur.textContent = `= ${SPEECH_DB_MARGIN} dB`;
            } catch {}
            // Toggle visibility based on mode
            try {
                const mode = SPEECH_THRESHOLD_MODE === 'dynamic' ? 'dynamic' : 'manual';
                const marginRow = document.getElementById('speech-margin-row');
                const noiseRow = document.getElementById('noise-threshold-row');
                if (marginRow) marginRow.style.display = (mode === 'dynamic') ? 'flex' : 'none';
                if (noiseRow) noiseRow.style.display = (mode === 'manual') ? 'flex' : 'none';
            } catch {}
            // Ensure a Noise window input exists
            try {
                const paramsCard = document.getElementById('params');
                if (paramsCard && !document.getElementById('inp-noise-avg')) {
                    const row = document.createElement('div');
                    row.id = 'noise-avg-row';
                    row.className = 'row settings-only';
                    row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '8px'; row.style.flexWrap = 'wrap'; row.style.marginTop = '6px';
                    const lbl = document.createElement('label'); lbl.textContent = 'Noise window (ms)'; lbl.className = 'settings-row-label'; lbl.title = 'Dynamic mode noise averaging window length in milliseconds.';
                    const input = document.createElement('input'); input.type='number'; input.id='inp-noise-avg'; input.min='0'; input.step='100'; input.className='btn'; input.style.width='90px'; input.title = 'Dynamic mode noise averaging window length in milliseconds.';
                    const cur = document.createElement('small'); cur.id = 'param-noise-avg'; cur.className = 'settings-row-value';
                    row.appendChild(lbl); row.appendChild(input); row.appendChild(cur);
                    const autoRow = document.getElementById('auto-close-row');
                    if (autoRow && autoRow.parentNode) autoRow.parentNode.insertBefore(row, autoRow);
                    else paramsCard.appendChild(row);
                    input.addEventListener('change', ()=>{
                        let v = Number(input.value);
                        if (!Number.isFinite(v) || v < 0) v = NOISE_AVG_MS;
                        NOISE_AVG_MS = Math.round(v);
                        saveParams();
                        updateParamsUI();
                    });
                }
                setVal('inp-noise-avg', NOISE_AVG_MS);
                const cur = document.getElementById('param-noise-avg'); if (cur) cur.textContent = `= ${NOISE_AVG_MS} ms`;
            } catch {}
            // ticks
            const tickMin = document.getElementById('tick-min');
            const bChunk = document.getElementById('bar-chunk');
            const bSil = document.getElementById('bar-sil');
            if (tickMin && MAX_CHUNK_SEC > 0) tickMin.style.left = `${Math.min(100, (MIN_CHUNK_SEC / MAX_CHUNK_SEC) * 100)}%`;
            // Keep per-mic chunk ticks in sync even when not recording.
            for (let mi = 1; mi <= MAX_MIC_COUNT; mi++) {
                const t = document.getElementById(`tick-mic-${mi}`);
                if (!t || maxChunkMs <= 0) continue;
                t.style.left = `${Math.min(100, (minChunkMs / maxChunkMs) * 100)}%`;
            }
            const tickSilMin = document.getElementById('tick-sil-min');
            if (tickSilMin && silenceMaxMs > 0) tickSilMin.style.left = `${Math.min(100, (silenceMinMs / silenceMaxMs) * 100)}%`;
	            if (bChunk) bChunk.style.width = '0%';
	            if (bSil) bSil.style.width = '0%';
            try { syncTestingModeUi(); } catch {}
            try { bindTestingModeControls(); } catch {}
	        }
	        function clampNum(x, lo, hi) {
	            const n = Number(x);
	            if (!Number.isFinite(n)) return lo;
	            return Math.max(lo, Math.min(hi, n));
	        }
	        function micKey(i) { return `mic${i}`; }
	        function getMicEls(i) {
	            return {
	                group: document.getElementById(`mic-${i}-group`),
	                label: document.getElementById(`lbl-mic-${i}`),
	                select: document.getElementById(`mic-${i}-select`),
	                meterWrap: document.getElementById(`mic-${i}-meter-wrap`),
	                bar: document.getElementById(`bar-mic-${i}-level`),
	                volRow: document.getElementById(`mic-${i}-vol-row`),
	                vol: document.getElementById(`mic-${i}-vol`),
	                volLabel: document.getElementById(`mic-${i}-vol-label`),
	                tipRow: document.getElementById(`mic-${i}-tip-row`),
	                monitorCb: document.getElementById(`mic-${i}-monitor`),
	                aecCb: document.getElementById(`mic-${i}-aec`),
	            };
	        }
	
	        function bindMicGroup(i) {
	            const { group, select, vol, volLabel, monitorCb, aecCb } = getMicEls(i);
	            if (!group || group.dataset.bound === '1') return;
	            group.dataset.bound = '1';
                const aecRow = aecCb?.closest?.('.mic-aec-ctl');

                // Ensure tooltips exist for dynamic mic groups (Mic 3..9 are cloned after initTooltips()).
                try {
                    if (select && !select.getAttribute('title')) select.setAttribute('title', `Mic ${i} input device. Select OFF to disable Mic ${i}.`);
                    if (vol && !vol.getAttribute('title')) vol.setAttribute('title', `Mic ${i} gain (0–200%). Affects monitoring and recordings.`);
                    if (monitorCb && !monitorCb.getAttribute('title')) monitorCb.setAttribute('title', `Audio monitor for Mic ${i}: when enabled, copies this mic to Speaker output. Use headphones to avoid echo.`);
                    if (aecCb && !aecCb.getAttribute('title')) aecCb.setAttribute('title', `Enable AEC/NS/AGC for Mic ${i}: Acoustic Echo Cancellation, Noise Suppression, Automatic Gain Control.`);
                } catch {}
	
	            if (select) {
                    select.addEventListener('change', async () => {
                        const raw = String(select.value || '');
                        micDeviceIds[i] = (raw && raw !== 'OFF' && raw !== '__off__') ? raw : null;
                        try { autoSetMicAecIfUnset(i, getSelectedMicLabel(i), 'mic-select-change'); } catch {}
                        try { logUi('mic.select.change', { mic: i, deviceId: micDeviceIds[i], label: getSelectedMicLabel(i) }); } catch {}
                        try { saveParams(); } catch {}
                        try { syncMicUI(); } catch {}
                        try { updateCounters(); } catch {}
                        if (IS_EMBEDDED) {
                            notifyParentSettingsChange('mic-select', { mic: i, deviceId: micDeviceIds[i] });
                            return;
                        }
                        if (isRecording) {
                            try { await restartRecordingFromSettingsChange(`mic${i}-device-change`); } catch (e) { console.warn('restart after mic change', e); }
                        } else if (testingMode && allowMonitoringInit && audioContext) {
                            try { await rebuildMonitoring(`mic${i}-device-change`); } catch {}
                        }
	                });
	            }
	
	            if (vol) {
	                vol.addEventListener('input', () => {
	                    const pct = clampNum(vol.value, 0, 200);
	                    vol.value = String(pct);
	                    if (volLabel) volLabel.textContent = `${pct}%`;
	                    micGainValues[i] = pct / 100.0;
	                    try { if (micGainNodes[i]) micGainNodes[i].gain.value = micGainValues[i] || 1.0; } catch {}
	                    try { scheduleParamsSave(400); } catch {}
	                });
	            }
	
	            const applyMonitorUi = () => {
	                const on = !!micMonitorOn[i];
	                if (monitorCb && 'checked' in monitorCb) monitorCb.checked = on;
	            };
                if (monitorCb) {
                    monitorCb.addEventListener('change', () => {
                        micMonitorOn[i] = !!monitorCb.checked;
                        applyMonitorUi();
                        try { logUi('mic.monitor.toggle', { mic: i, enabled: micMonitorOn[i] }); } catch {}
                        try { saveParams(); } catch {}
                        try { applyMonitorGains(); } catch {}
                        if (IS_EMBEDDED) notifyParentSettingsChange('mic-monitor', { mic: i, enabled: micMonitorOn[i] });
                        if (!isRecording && micMonitorOn[i] && testingMode) {
                            allowMonitoringInit = true;
                            primeAudioContextForGesture(`monitor-toggle:${i}`);
                            try { ensureMonitoring(`monitor-toggle:${i}`); } catch {}
                        }
                    });
                }
                if (aecCb) {
                    aecCb.addEventListener('change', async () => {
                        micAecNsAgc[i] = !!aecCb.checked;
                        try { logUi('mic.aec.toggle', { mic: i, enabled: micAecNsAgc[i] }); } catch {}
                        try { saveParams(); } catch {}
                        try { updateCounters(); } catch {}
                        if (IS_EMBEDDED) {
                            notifyParentSettingsChange('mic-aec', { mic: i, enabled: micAecNsAgc[i] });
                            return;
                        }
                        if (isRecording) {
                            try { await restartRecordingFromSettingsChange(`mic-aec-toggle:${i}`); } catch (e) { console.error('aec-ns-agc restart', e); }
                        } else if (testingMode) {
                            allowMonitoringInit = true;
                            primeAudioContextForGesture(`mic-aec-toggle:${i}`);
                            try { await rebuildMonitoring(`mic-aec-toggle:${i}`); } catch {}
                        }
                    });
                    // Ensure checkbox reflects current state
                    if ('checked' in aecCb) aecCb.checked = !!micAecNsAgc[i];
                    if (aecRow) aecRow.style.display = '';
                }
	        }
	
	        function ensureMicGroups(count) {
	            const desired = clampNum(count, 1, MAX_MIC_COUNT);
	            const extraWrap = document.getElementById('mics-extra');
	            const tpl = document.getElementById('mic-2-group') || document.getElementById('mic-1-group');
	            if (!tpl) return;
	
	            // Ensure base groups are bound and visible/hidden by mic count.
	            bindMicGroup(1);
	            bindMicGroup(2);
	
	            const g1 = document.getElementById('mic-1-group');
	            const g2 = document.getElementById('mic-2-group');
	            if (g1) g1.style.display = '';
	            if (g2) g2.style.display = (desired >= 2) ? '' : 'none';
	
	            // Create mic3..mic9 as clones of mic2 group.
	            if (extraWrap && desired >= 3) {
	                for (let i = 3; i <= desired; i++) {
	                    let g = document.getElementById(`mic-${i}-group`);
	                    if (!g) {
	                        g = tpl.cloneNode(true);
	                        // cloneNode(true) copies data-* attributes but not event listeners; clear binding flag.
	                        try { g.removeAttribute('data-bound'); } catch {}
	                        g.id = `mic-${i}-group`;
	                        g.dataset.micIndex = String(i);
	                        g.style.display = '';
	
	                        const relabel = (oldId, newId) => {
	                            const el = g.querySelector(`#${oldId}`);
	                            if (el) el.id = newId;
	                        };
	                        relabel('lbl-mic-2', `lbl-mic-${i}`);
	                        relabel('mic-2-select', `mic-${i}-select`);
	                        relabel('mic-2-meter-wrap', `mic-${i}-meter-wrap`);
	                        relabel('bar-mic-2-level', `bar-mic-${i}-level`);
	                        relabel('tick-mic-2-noise', `tick-mic-${i}-noise`);
	                        relabel('tick-mic-2-gate', `tick-mic-${i}-gate`);
	                        relabel('mic-2-vol-row', `mic-${i}-vol-row`);
	                        relabel('mic-2-vol', `mic-${i}-vol`);
	                        relabel('mic-2-vol-label', `mic-${i}-vol-label`);
	                        relabel('mic-2-tip-row', `mic-${i}-tip-row`);
	                        relabel('mic-2-monitor', `mic-${i}-monitor`);
	                        relabel('mic-2-aec', `mic-${i}-aec`);
	
	                        // Update label "for" attribute + text
	                        const label = g.querySelector('label');
	                        if (label) {
	                            label.setAttribute('for', `mic-${i}-select`);
	                            label.innerHTML = `<b class="title-grad">Mic ${i}:</b>`;
	                        }
	                        // Update per-mic "level" label
	                        try {
	                            const small = g.querySelector(`#mic-${i}-vol-row small`);
	                            if (small) small.textContent = `Mic ${i} level:`;
	                        } catch {}
                            try {
                                const aec = g.querySelector(`#mic-${i}-aec`);
                                if (aec) aec.id = `mic-${i}-aec`;
                            } catch {}
	                    }
	                    if (g.parentElement !== extraWrap) extraWrap.appendChild(g);
	                    bindMicGroup(i);
	                }
	            }
	
	            // Hide any extra mic groups above desired.
	            for (let i = desired + 1; i <= MAX_MIC_COUNT; i++) {
	                const g = document.getElementById(`mic-${i}-group`);
	                if (!g) continue;
	                if (i === 1) { g.style.display = ''; continue; }
	                g.style.display = 'none';
	            }
	        }
	
	        // Sync mic visibility (hide non-settings rows when Off) and Start button state
	        function syncMicUI() {
	            try {
	                const micCountEl = document.getElementById('mic-count');
	                if (micCountEl && 'value' in micCountEl) {
	                    micCount = clampNum(micCountEl.value, 1, MAX_MIC_COUNT);
	                }
	                ensureMicGroups(micCount);
	
	                let anyEnabled = false;
	                for (let i = 1; i <= MAX_MIC_COUNT; i++) {
	                    const slotVisible = i <= micCount;
	                    const on = slotVisible && !!micDeviceIds[i];
	                    const { group, meterWrap, volRow, tipRow, aecCb } = getMicEls(i);
                        const aecRow = aecCb?.closest?.('.mic-aec-ctl');
	                    if (group) group.style.display = slotVisible ? '' : 'none';
	                    if (meterWrap) meterWrap.style.display = on ? '' : 'none';
	                    if (volRow) volRow.style.display = on ? '' : 'none';
	                    if (tipRow) tipRow.style.display = on ? '' : 'none';
                        if (aecRow) aecRow.style.display = on ? '' : 'none';
	                    if (on) anyEnabled = true;
	                }
	
	                // Keep Start enabled when idle; session is created on demand.
	                // Start/Cut/Pause/Done enablement is controlled by syncControlState (auth + state matrix).
	                try { syncControlState(); } catch {}
                    // Keep "Current Chunks" per-mic list in sync even when not recording.
                    try { renderPerTrackList(); } catch {}
	            } catch (e) {
	                console.warn('syncMicUI failed', e);
	            }
	        }
        let silenceThreshold = 6;        // avg level (0..255) below this is treated as silence
        let silenceTimer = 0, isSilence = false;
        let lastChunkStart = 0;          // timestamp of current chunk start
        let forceChunk = false;
        // Speech tracking per chunk (mixed and per-source)
        let MIN_SPEECH_RATIO = 3.5;      // percent: speechMs/chunkDurationMs * 100
        let SPEECH_THRESHOLD_MODE = 'dynamic'; // 'manual' | 'dynamic'
        let NOISE_THRESHOLD_DB = -50;    // manual threshold in dBFS
        let micNoiseDbByIndex = {};      // baseline noise floor per mic (dBFS)
        let SPEECH_DB_MARGIN = 5;        // required dBFS above noise floor to count as speech (dynamic mode)
        let NOISE_AVG_MS = 1500;         // dynamic noise window (ms)
        let noiseWindowSize = 0;
        let noiseSamplesByIndex = {};
        let noiseSamplePosByIndex = {};
        let noiseSampleCountByIndex = {};
        let lastNoiseUpdateTs = 0;
	        const NOISE_PERCENTILE = 0.2;    // 20th percentile is a robust noise floor estimate
	        const NOISE_FOLLOW_MS = 600;     // smoothing for noise floor updates
	        let speechMsMixed = 0;           // accumulated ms with speech in current chunk (mixed)
	        let speechMsByKey = {};          // e.g., { mic1: ms, mic2: ms }
	        let speechMsByKeyFallback = {};  // absolute-threshold fallback (guards against dynamic gate drift)
	        let speechMsTotal = 0;           // accumulated ms with speech across the whole session (for FAB ring)
	        let cutEventsMs = [];            // elapsedMs (from start, excluding pauses) for each cut/auto-cut notch (for FAB ring)
	        let lastAnalysisTs = 0;          // for dt accumulation
	        let lastAnalysisFrameMs = 0;     // throttle analysis to reduce CPU
	        let analysisFrameMs = 50;        // ~20 fps is enough for silence detection + meters
	        let lowCpuMode = false;
	        let aecNsAgcEnabled = true;
	        const ABS_SPEECH_FALLBACK_DB = -45; // secondary detector: when primary says 0, we can recover obvious speech
	        const ABS_SPEECH_RECOVERY_MIN_MS = 1500; // ignore tiny spikes/clicks

	        function resolveSpeechMsForChunk(key, primaryMs) {
	            const base = Number(primaryMs || 0);
	            if (base > 0) return base;
	            const fb = Number((key ? speechMsByKeyFallback?.[key] : speechMsMixed) || 0);
	            if (fb >= ABS_SPEECH_RECOVERY_MIN_MS) return fb;
	            return base;
	        }

	        // Full-track archive (per mic) for post-session diarization.
	        // Unlike chunk recorders, these recorders are not cut on silence/cut;
	        // they are segmented only when recording is restarted/stopped (settings/device changes, pause, done).
	        let archiveTrackRecorders = []; // [{key, mi, mr, dest, mimeType, buf, startedAtMs, _stopRequested, _stopped}]
	        let archiveTrackSegmentsByKey = {}; // { mic1: [{...}], mic2: [{...}] }
	        let archiveTrackSeqByKey = {}; // { mic1: 1, mic2: 2, ... }
	        let archiveTrackSessionId = '';

	        function inferSpeakerForMicIndex(mi) {
	            try {
	                const me = getMySpeakerName();
	                if (!me) return '';
	                const label = getSelectedMicLabel(mi);
	                if (!label) return '';
	                if (/(microphone|микрофон)/i.test(label)) return me;
	            } catch {}
	            return '';
	        }

	        function clearArchiveTrackStore(opts = {}) {
	            const keepSession = !!opts.keepSession;
	            archiveTrackSegmentsByKey = {};
	            archiveTrackSeqByKey = {};
	            if (!keepSession) archiveTrackSessionId = '';
	        }

	        function buildArchiveSegmentFileName(seg) {
	            const ext = guessAudioExtFromMime(seg?.blob?.type || seg?.mimeType || '');
	            const micLabel = Number.isFinite(seg?.mic) && seg.mic > 0 ? `mic${seg.mic}` : String(seg?.key || 'track');
	            const seq = String(seg?.seq || 0).padStart(3, '0');
	            return `full-${micLabel}-seg${seq}${ext}`;
	        }

	        function ensureArchiveSegmentListItem(seg, opts = {}) {
	            try {
	                if (!seg || seg._li) return seg?._li || null;
	                const { list, doc } = resolveChunkListTarget();
	                if (!list) return null;
	                const sid = String(opts?.sessionId || archiveTrackSessionId || getSessionIdValue() || '').trim();
	                const fileName = buildArchiveSegmentFileName(seg);
	                const startedAtMs = Number.isFinite(seg?.startedAtMs) ? Math.max(0, Math.round(seg.startedAtMs)) : 0;
	                const endedRaw = Number.isFinite(seg?.endedAtMs) ? Math.max(0, Math.round(seg.endedAtMs)) : 0;
	                const endedAtMs = Math.max(endedRaw || startedAtMs, startedAtMs);
	                const durationMs = Math.max(0, endedAtMs - startedAtMs);
	                const label = `${fileName} (${(durationMs / 1000).toFixed(1)}s)`;
	                const { li, upBtn } = createChunkListItem(seg.blob, label, null, fileName, doc);
	                try {
	                    li.dataset.trackKind = 'full_track';
	                    li.dataset.trackKey = String(seg?.key || '');
	                    li.dataset.sessionId = sid;
	                    if (Number.isFinite(seg?.mic) && seg.mic > 0) li.dataset.mic = String(seg.mic);
	                    if (startedAtMs > 0) li.dataset.startedAtMs = String(startedAtMs);
	                    if (endedAtMs > 0) li.dataset.endedAtMs = String(endedAtMs);
	                    if (durationMs > 0) li.dataset.durationMs = String(durationMs);
	                    li.dataset.autoUploadAttempted = seg?.autoUploadAttempted ? '1' : '0';
	                } catch {}
	                try {
	                    if (li?._statusEl) {
	                        li._statusEl.textContent = ' · full-track';
	                        li._statusEl.style.color = '#0f766e';
	                    }
	                } catch {}
	                try {
	                    li._onUploadSuccess = () => {
	                        try { seg.uploaded = true; seg.uploadError = ''; } catch {}
	                    };
	                    li._onUploadError = (msg) => {
	                        try { seg.uploaded = false; seg.uploadError = String(msg || ''); } catch {}
	                    };
	                } catch {}
	                list.insertBefore(li, list.firstChild);
	                seg._li = li;
	                seg._upBtn = upBtn || null;
	                seg.fileName = fileName;
	                seg.durationMs = durationMs;
	                return li;
	            } catch (e) {
	                console.warn('[archive] list item create failed', e);
	                return null;
	            }
	        }

	        async function stopArchiveTrackRecorders(opts = {}) {
	            const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 5000;
	            const pollMs = Number.isFinite(opts.pollMs) ? opts.pollMs : 60;
	            const reason = String(opts.reason || '');
	            const recs = Array.isArray(archiveTrackRecorders) ? archiveTrackRecorders.slice() : [];
	            if (!recs.length) return { produced: 0, timeout: false };

	            for (const r of recs) {
	                try {
	                    if (r?.mr && r.mr.state === 'recording') {
	                        try { r._stopRequested = true; } catch {}
	                        try { r.mr.requestData(); } catch {}
	                        try { r.mr.stop(); } catch {}
	                    }
	                } catch {}
	            }

	            const start = Date.now();
	            let timeout = false;
	            while (true) {
	                let ready = true;
	                for (const r of recs) {
	                    try {
	                        if (!r || !r.mr) continue;
	                        if (r.mr.state === 'recording') { ready = false; break; }
	                        if (r._stopRequested && !r._stopped) { ready = false; break; }
	                    } catch {}
	                }
	                if (ready) break;
	                if ((Date.now() - start) >= timeoutMs) {
	                    timeout = true;
	                    console.warn('[archive] timeout waiting stop', { reason, timeoutMs });
	                    break;
	                }
	                await new Promise((r) => setTimeout(r, pollMs));
	            }

	            let produced = 0;
	            for (const r of recs) {
	                try {
	                    const key = String(r?.key || '');
	                    const mi = Number(r?.mi || 0);
	                    const parts = Array.isArray(r?.buf) ? r.buf : [];
	                    if (parts.length > 0 && key) {
	                        const blobType = pickBlobTypeFromParts(parts, r?.mimeType || r?.mr?.mimeType || '');
	                        const blob = blobType ? new Blob(parts, { type: blobType }) : new Blob(parts);
	                        if (blob && blob.size > 0) {
	                            const seq = (archiveTrackSeqByKey[key] || 0) + 1;
	                            archiveTrackSeqByKey[key] = seq;
	                            const item = {
	                                key,
	                                mic: mi,
	                                seq,
	                                blob,
	                                mimeType: blobType || blob.type || '',
	                                startedAtMs: Number(r?.startedAtMs || 0),
	                                endedAtMs: Date.now(),
	                                uploaded: false,
	                                autoUploadAttempted: false,
	                                uploadError: ''
	                            };
	                            if (!Array.isArray(archiveTrackSegmentsByKey[key])) archiveTrackSegmentsByKey[key] = [];
	                            archiveTrackSegmentsByKey[key].push(item);
	                            try { ensureArchiveSegmentListItem(item, { sessionId: archiveTrackSessionId }); } catch {}
	                            produced += 1;
	                        }
	                    }
	                } catch (e) {
	                    console.warn('[archive] finalize failed', e);
	                } finally {
	                    try { if (r && r.mi && r.dest && micGainNodes[r.mi]) micGainNodes[r.mi].disconnect(r.dest); } catch {}
	                    try { if (r?.dest?.stream) _stopStreamSafe(r.dest.stream); } catch {}
	                    try { if (r) { r.buf = []; r._stopRequested = false; r._stopped = false; } } catch {}
	                }
	            }
	            archiveTrackRecorders = [];
	            return { produced, timeout };
	        }

	        function startArchiveTrackRecorders(opts = {}) {
	            const sid = String(opts.sessionId || getSessionIdValue() || '').trim();
	            if (!sid) return { started: 0, reason: 'no_session' };
	            if (!audioContext || !Array.isArray(micGainNodes)) return { started: 0, reason: 'no_audio_graph' };

	            if (archiveTrackSessionId && archiveTrackSessionId !== sid) {
	                clearArchiveTrackStore({ keepSession: false });
	            }
	            archiveTrackSessionId = sid;

	            let started = 0;
	            for (let mi = 1; mi <= micCount; mi++) {
	                if (!micStreams[mi] || !micGainNodes[mi]) continue;
	                try {
	                    const dest = audioContext.createMediaStreamDestination();
	                    micGainNodes[mi].connect(dest);
	                    const tracks = dest.stream?.getTracks?.() || [];
	                    if (!tracks.length) {
	                        try { if (micGainNodes[mi]) micGainNodes[mi].disconnect(dest); } catch {}
	                        try { _stopStreamSafe(dest.stream); } catch {}
	                        continue;
	                    }
	                    const mime = pickMediaRecorderMime();
	                    const mr = mime ? new MediaRecorder(dest.stream, { mimeType: mime }) : new MediaRecorder(dest.stream);
	                    const actualMime = (mr && typeof mr.mimeType === 'string' && mr.mimeType) ? mr.mimeType : (mime || '');
	                    const entry = {
	                        key: micKey(mi),
	                        mi,
	                        mr,
	                        dest,
	                        mimeType: actualMime,
	                        buf: [],
	                        startedAtMs: Date.now(),
	                        _stopRequested: false,
	                        _stopped: false
	                    };
	                    mr.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) entry.buf.push(ev.data); };
	                    mr.onstop = () => { entry._stopped = true; entry._stopRequested = false; };
	                    archiveTrackRecorders.push(entry);
	                    started += 1;
	                } catch (e) {
	                    console.warn('[archive] start recorder failed', { mic: mi, error: String(e || '') });
	                }
	            }
	            for (const r of archiveTrackRecorders) {
	                try {
	                    if (r?.mr && r.mr.state === 'inactive') r.mr.start(1000);
	                } catch (e) {
	                    console.warn('[archive] recorder.start failed', e);
	                }
	            }
	            return { started };
	        }

	        async function uploadArchiveTrackSegments(sessionId, opts = {}) {
	            const sid = String(sessionId || archiveTrackSessionId || '').trim();
	            if (!sid) return { total: 0, uploaded: 0, failed: 0, skipped: 0 };
	            let total = 0;
	            let uploaded = 0;
	            let failed = 0;
	            let skipped = 0;
	            const reason = String(opts.reason || '');
	            const autoMode = opts?.autoMode !== false;

	            const keys = Object.keys(archiveTrackSegmentsByKey || {}).sort();
	            for (const key of keys) {
	                const segments = Array.isArray(archiveTrackSegmentsByKey[key]) ? archiveTrackSegmentsByKey[key] : [];
	                for (const seg of segments) {
	                    if (!seg || seg.uploaded) continue;
	                    if (!seg.blob || seg.blob.size <= 0) {
	                        seg.uploaded = true;
	                        continue;
	                    }
	                    if (autoMode && seg.autoUploadAttempted) {
	                        skipped += 1;
	                        continue;
	                    }
	                    if (autoMode) {
	                        seg.autoUploadAttempted = true;
	                        try { if (seg._li?.dataset) seg._li.dataset.autoUploadAttempted = '1'; } catch {}
	                    }
	                    total += 1;
	                    const li = ensureArchiveSegmentListItem(seg, { sessionId: sid });
	                    const upBtn = seg?._upBtn || li?.querySelector?.('button[data-role="upload"]') || null;
	                    let ok = false;
	                    try {
	                        if (li) {
	                            ok = await uploadBlobForLi(seg.blob, li, upBtn, null, { silent: true });
	                        } else {
	                            const fileName = buildArchiveSegmentFileName(seg);
	                            const speaker = Number.isFinite(seg.mic) && seg.mic > 0 ? inferSpeakerForMicIndex(seg.mic) : '';
	                            const startedAtMs = Number.isFinite(seg.startedAtMs) ? Math.max(0, Math.round(seg.startedAtMs)) : 0;
	                            const endedAtMsRaw = Number.isFinite(seg.endedAtMs) ? Math.max(0, Math.round(seg.endedAtMs)) : 0;
	                            const endedAtMs = Math.max(endedAtMsRaw || startedAtMs, startedAtMs);
	                            const durationMs = Math.max(0, endedAtMs - startedAtMs);
	                            await uploadBlob(seg.blob, fileName, {
	                                sessionId: sid,
	                                speaker,
	                                allowWhileUnloading: true,
	                                meta: {
	                                    chunk_started_at_ms: startedAtMs,
	                                    chunk_ended_at_ms: endedAtMs,
	                                    chunk_duration_ms: durationMs,
	                                    chunk_track_kind: 'full_track',
	                                    chunk_track_key: key,
	                                    chunk_track_mic: Number.isFinite(seg.mic) && seg.mic > 0 ? seg.mic : ''
	                                }
	                            });
	                            ok = true;
	                        }
	                    } catch (e) {
	                        ok = false;
	                        seg.uploadError = String(e || '');
	                    }
	                    if (ok) {
	                        seg.uploaded = true;
	                        seg.uploadError = '';
	                        uploaded += 1;
	                    } else {
	                        seg.uploaded = false;
	                        failed += 1;
	                        if (!seg.uploadError) seg.uploadError = 'upload_failed';
	                        console.warn('[archive] upload failed', { reason, key, seq: seg.seq, error: seg.uploadError });
	                    }
	                }
	            }
	            return { total, uploaded, failed, skipped };
	        }

        function getHostSessionIdFromPath() {
            try {
                if (PAGE_MODE !== 'host') return '';
                const match = String(location.pathname || '').match(/\/session\/([0-9a-fA-F]{24})(?:\/|$)/);
                return match && match[1] ? String(match[1]).trim() : '';
            } catch {}
            return '';
        }

        async function handleNewAction() {
            if (isFinalUploading) return;
            if (!AUTH_TOKEN) {
                try { openSidePanel('settings'); } catch {}
                try { showFabToast('Login required', 1600); } catch {}
                try { syncFabAuthState(); } catch {}
                return;
            }
            if (!isRecording) {
                try { persistVoicebotState('recording'); } catch {}
            }
            if (!isRecording) {
                // New always creates a brand-new active session and opens it in the main app.
                isPaused = false;
                await startRecording({ forceCreate: true, openInMainApp: true });
            }
        }

        async function handleRecAction() {
            if (isFinalUploading) return;
            if (!AUTH_TOKEN) {
                try { openSidePanel('settings'); } catch {}
                try { showFabToast('Login required', 1600); } catch {}
                try { syncFabAuthState(); } catch {}
                return;
            }
            if (!isRecording) {
                try { persistVoicebotState('recording'); } catch {}
            }
            if (!isRecording) {
                const pageSid = String(getHostSessionIdFromPath() || '').trim();
                if (pageSid) {
                    try {
                        await activateSessionForRecording(pageSid, { source: 'rec-page' });
                    } catch (e) {
                        console.warn('[Rec] activate page session failed', e);
                        try { showFabToast('Failed to activate page session', 2000); } catch {}
                        return;
                    }
                }
                // Rec writes to current active session (creates one only when no active session exists).
                isPaused = false;
                await startRecording({ forceCreate: false });
            }
        }

        function clearActiveSessionUi() {
            try { ACTIVE_SESSION_ID = ''; } catch {}
            setSessionIdEverywhere('');
            setSessionNameEverywhere('');
            setSessionProjectEverywhere('', '');
        }

        function clearSessionUiEverywhere() {
            clearActiveSessionUi();
            const clearDoc = (doc) => {
                try {
                    const sidEl = doc?.getElementById?.('session-id');
                    const snameEl = doc?.getElementById?.('session-name');
                    if (sidEl && 'value' in sidEl) sidEl.value = '';
                    if (snameEl && 'value' in snameEl) { snameEl.value = ''; snameEl.disabled = false; }
                    const openedEl = doc?.getElementById?.('session-opened-at');
                    if (openedEl) openedEl.textContent = '';
                } catch {}
            };

            clearDoc(document);
            try {
                const frames = Array.from(document.querySelectorAll('.panel-iframe'));
                frames.forEach((f) => clearDoc(f.contentDocument));
            } catch {}

            try { CURRENT_SESSION_OPENED_AT_MS = 0; clearAutoCloseTimer(); } catch {}
        }

        async function handleDoneAction(opts = {}) {
            const isLogout = !!opts.logout;
            if (isFinalUploading) return;

            if (!AUTH_TOKEN) {
                if (isLogout) {
                    clearSessionUiEverywhere();
                    setFabState('unauthorized');
                    try { openSidePanel('settings'); } catch {}
                } else {
                    setFabState('unauthorized');
                }
                return;
            }

            const prevSid = String(getActiveSessionIdValue() || '').trim();
            if (!prevSid) {
                try {
                    await stopArchiveTrackRecorders({ reason: isLogout ? 'logout-no-session' : 'done-no-session', timeoutMs: 1500, pollMs: 60 });
                    clearArchiveTrackStore({ keepSession: false });
                } catch {}
                // Nothing to close; for Logout still clear token.
                if (isLogout) {
                    try {
                        AUTH_TOKEN = '';
                        localStorage.removeItem('VOICEBOT_AUTH_TOKEN');
                        localStorage.removeItem('VOICEBOT_ME_ID');
                        localStorage.removeItem(ME_TELEGRAM_ID_KEY);
                        MY_TELEGRAM_ID = '';
                        MY_PERFORMER_ID = '';
                        clearCurrentUserLabel();
                    } catch {}
                    setAuthUi(false);
                    setFabState('unauthorized');
                    try { openSidePanel('settings'); } catch {}
                } else {
                    setFabState('idle');
                }
                return;
            }

            isFinalUploading = true;
            try {
                const doneReason = isLogout ? 'logout' : 'done';
                try { clearAutoCloseTimer(); } catch {}
                try { fabFrozenElapsedMs = getFabElapsedMs(); } catch {}
                setFabState('final_uploading');
                stopFabOrbit({ reset: false });
                syncControlState();

                // Stop recorders (finalize last chunk) and prevent auto-restart in onstop handlers.
                try { splitInProgress = false; } catch {}
                isRecording = false;
                isPaused = false;
                try {
                    if (mediaRecorder && mediaRecorder.state === 'recording') {
                        try { mediaRecorder.requestData(); } catch {}
                        try { mediaRecorder.stop(); } catch {}
                    }
                    for (const r of (mediaRecorders || [])) {
                        try {
                            if (r.mr && r.mr.state === 'recording') {
                                try { r._stopRequested = true; } catch {}
                                try { r.mr.requestData(); } catch {}
                                try { r.mr.stop(); } catch {}
                            }
                        } catch {}
                    }
                    if (recordingMode === 'separate') {
                        await scheduleFinalizeChunkSeparate({ reason: doneReason, timeoutMs: 5000, pollMs: 60 });
                    }
                } catch (e) {
                    console.warn('[Done] stop recorders failed (continuing):', e);
                }

                try { await stopArchiveTrackRecorders({ reason: doneReason, timeoutMs: 5000, pollMs: 60 }); } catch (e) { console.warn('[Done] stop archive failed (continuing):', e); }

                // Wait for final chunk uploads; each chunk is auto-attempted only once.
                try {
                    const pendingResult = await waitForAllPendingUploads({ settleMs: 2000, pollMs: 500, maxWaitMs: 120000 });
                    if (pendingResult && pendingResult.status && pendingResult.status !== 'all-uploaded') {
                        console.warn('[Done] some chunk uploads require manual retry', pendingResult);
                        try {
                            const failed = Number(pendingResult.failed || pendingResult.pending || 0);
                            if (failed > 0) showFabToast(`Chunk upload failed (${failed}). Use Upload button.`, 3000);
                        } catch {}
                    }
                } catch {}

                // Upload full per-mic tracks (created from Start->Done segments incl. mic switches).
                const archiveUpload = await uploadArchiveTrackSegments(prevSid, { reason: doneReason, autoMode: true });
                if ((archiveUpload?.failed || 0) > 0) {
                    console.warn('[Done] archive upload has failed segments; waiting for manual retries', archiveUpload);
                    try {
                        const failed = Number(archiveUpload?.failed || 0);
                        showFabToast(`Full-track upload failed (${failed}). Use Upload button.`, 3200);
                    } catch {}
                }

                // Close session (best-effort).
                try { await sessionDoneBrowser(prevSid, { timeoutMs: 4000 }); } catch (e) { console.warn('[Done] session_done failed (continuing):', e); }

                clearActiveSessionUi();
                clearSessionInfoStorage();
                clearArchiveTrackStore({ keepSession: false });

                // Reset ring to 0 after completion.
                try { fabStartTs = 0; fabPausedTs = 0; fabPausedMs = 0; } catch {}
                resetFabProgress();
                // Release mic access after Done/Logout.
                try { await teardownMonitoringGraph(isLogout ? 'logout' : 'done', { keepContext: false }); } catch {}
                allowMonitoringInit = false;

                if (isLogout) {
                    try {
                        AUTH_TOKEN = '';
                        localStorage.removeItem('VOICEBOT_AUTH_TOKEN');
                        localStorage.removeItem('VOICEBOT_ME_ID');
                        localStorage.removeItem(ME_TELEGRAM_ID_KEY);
                        MY_TELEGRAM_ID = '';
                        MY_PERFORMER_ID = '';
                        clearCurrentUserLabel();
                    } catch {}
                    setAuthUi(false);
                    setFabState('unauthorized');
                    try { openSidePanel('settings'); } catch {}
                } else {
                    setFabState('idle');
                    try { showFabToast('Session closed', 1800); } catch {}
                }
            } catch (e) {
                console.error('[Done] failed', e);
                try { showFabToast('Final upload failed', 2400); } catch {}
                // Spec: on error, return to idle/unauthorized and reset ring to 0.
                try { fabStartTs = 0; fabPausedTs = 0; fabPausedMs = 0; fabFrozenElapsedMs = -1; } catch {}
                try { resetFabProgress(); } catch {}
                try { setFabState(AUTH_TOKEN ? 'idle' : 'unauthorized'); } catch {}
            } finally {
                isFinalUploading = false;
                try { syncFabAuthState(); } catch {}
                syncControlState();
            }
        }

        function normalizeControlAction(action) {
            const raw = String(action || '').trim().toLowerCase();
            if (raw === 'start') return 'new';
            if (raw === 'record') return 'rec';
            return raw;
        }

        function dispatchControlAction(action) {
            const normalizedAction = normalizeControlAction(action);
            logUi('control', { action: normalizedAction, original_action: action, isRecording, isPaused, embedded: IS_EMBEDDED });
            if (IS_EMBEDDED) {
                try {
                    const ctrl = window.parent?.__voicebotControl;
                    if (typeof ctrl === 'function') {
                        ctrl(normalizedAction);
                        return;
                    }
                } catch {}
            }
            if (normalizedAction === 'new') return handleNewAction();
            if (normalizedAction === 'rec') return handleRecAction();
            if (normalizedAction === 'pause') return pauseRecording();
            if (normalizedAction === 'cut') {
                if (isRecording || (IS_EMBEDDED && window.parent?.__voicebotState?.get?.()?.isRecording)) {
                    try { detectPause(true); } catch {}
                    try { if (!IS_EMBEDDED) showFabToast('Chunk cut'); } catch {}
                }
            }
            if (normalizedAction === 'done') return handleDoneAction({ logout: false });
            if (normalizedAction === 'logout') return handleDoneAction({ logout: true });
        }

        function sendControlToSettingsIframe(action) {
            try {
                const iframe = document.querySelector('.panel-iframe[data-src*="settings.html"], .panel-iframe[src*="settings.html"]');
                if (iframe && iframe.contentWindow) {
                    iframe.contentWindow.postMessage({ type: 'voicebot-control', action }, location.origin);
                }
            } catch {}
        }

        function notifySettingsIframe(action, payload = {}) {
            try {
                const iframe = document.querySelector('.panel-iframe[data-src*="settings.html"], .panel-iframe[src*="settings.html"]');
                if (!iframe || !iframe.contentWindow) return;
                iframe.contentWindow.postMessage({ type: 'voicebot-control', action, payload }, location.origin);
            } catch {}
        }

        // Capture audio streams from selected sources and start recording
        async function startRecording(opts = {}) {
            logUi('start-recording.begin', { hasSession: !!getSessionIdValue(), isRecording, isPaused });
            if (testingMode) {
                try { setTestingMode(false, 'start-recording'); } catch {}
            }
            allowMonitoringInit = true;
            primeAudioContextForGesture('start-recording');
            try { loadParams(); } catch {}
            try { updateParamsUI(); } catch {}
            try { syncMicUI(); } catch {}
            let sid = '';
            try {
                sid = await ensureSessionIdForRecording(opts);
            } catch (e) {
                preserveAudioContext = false;
                throw e;
            }
            if (!sid) { preserveAudioContext = false; return; }

            try {
            const sepEl = document.getElementById('tog-separate-tracks');
            if (sepEl && 'checked' in sepEl) recordSeparate = !!sepEl.checked;
            recordingMode = recordSeparate ? 'separate' : 'mixed';
            try { saveParams(); } catch {}
            try { renderPerTrackList(); } catch {}

            // If user never configured devices, silently reset defaults before starting.
            if (!hasStoredMicSelection()) {
                try { await resetSettingsToDefaults({ silent: true, reason: 'auto-start' }); } catch {}
            }

            // Device labels are hidden until mic permission is granted.
            // Request permission on explicit Start/Resume, then repopulate selects and auto-pick defaults if needed.
            const labelsOk = await ensureDeviceLabels('start-recording');
            if (!labelsOk) {
                if (typeof showFabToast === 'function') showFabToast('Microphone permission required. Open Settings.', 2200);
                try { openSidePanel('settings'); } catch {}
                preserveAudioContext = false;
                return;
            }
            try { await ensureActiveMicSelection('start-recording'); } catch {}
            try { notifySettingsIframe('sync-devices'); } catch {}
            {
                const active = [];
                for (let i = 1; i <= micCount; i++) if (micDeviceIds[i]) active.push(i);
                if (!active.length) {
                    try {
                        await resetSettingsToDefaults({ silent: true, reason: 'auto-start-fallback' });
                        await ensureActiveMicSelection('auto-start-fallback');
                    } catch {}
                }
                const activeAfter = [];
                for (let i = 1; i <= micCount; i++) if (micDeviceIds[i]) activeAfter.push(i);
                if (!activeAfter.length) {
                    if (typeof showFabToast === 'function') showFabToast('No active microphone selected. Open Settings.', 2200);
                    try { openSidePanel('settings'); } catch {}
                    preserveAudioContext = false;
                    return;
                }
            }

            try {
                if (navigator.mediaDevices?.enumerateDevices) {
                    const devs = await navigator.mediaDevices.enumerateDevices();
                    const mics = devs.filter(d => d.kind === 'audioinput');
                    if (!mics.length) {
                        if (typeof showFabToast === 'function') showFabToast('No microphones detected. Open Settings.', 2200);
                        try { openSidePanel('settings'); } catch {}
                        preserveAudioContext = false;
                        return;
                    }
                }
            } catch {}

            try {
                await teardownMonitoringGraph('start-recording-refresh', { keepContext: false });
                _monitorSig = '';
            } catch {}
            const monitorPromise = ensureMonitoring('start-recording');
            try { await monitorPromise; } catch (e) { console.warn('ensureMonitoring failed', e); logApi('monitoring.error', { message: String(e || '') }); }
            // Re-calibrate speech detection baseline on a fresh start (not on Resume).
            // We do it AFTER ensureMonitoring() because it creates analysers + streams.
            if (!fabStartTs) {
                try { micNoiseDbByIndex = {}; } catch {}
                // Give the analysers a brief moment to populate noise floor before recording starts.
                try { await new Promise(r => setTimeout(r, 120)); } catch {}
            }
            preserveAudioContext = false;
            if (!audioContext || !mixGain) {
                if (typeof showFabToast === 'function') showFabToast('No active microphone. Open Settings.', 2200);
                try { openSidePanel('settings'); } catch {}
                return;
            }
            try { if (audioContext.state === 'suspended') await audioContext.resume(); } catch {}

            // Reset recorder state
            try { await stopArchiveTrackRecorders({ reason: 'start-recording-refresh', timeoutMs: 2000, pollMs: 60 }); } catch {}
            splitInProgress = false;
            audioChunks = [];
            mediaRecorders = [];

            const cleanupRecordingDests = () => {
                try {
                    if (recordDest && mixGain) mixGain.disconnect(recordDest);
                } catch {}
                try { if (recordStream) _stopStreamSafe(recordStream); } catch {}
                recordStream = null;
                recordDest = null;

                for (let mi = 1; mi <= MAX_MIC_COUNT; mi++) {
                    const dest = micRecordDests[mi];
                    if (!dest) continue;
                    try { if (micGainNodes[mi]) micGainNodes[mi].disconnect(dest); } catch {}
                    try { _stopStreamSafe(dest.stream); } catch {}
                    micRecordDests[mi] = null;
                }
            };

            const ensureMixedDest = () => {
                if (recordDest && recordStream) return;
                recordDest = audioContext.createMediaStreamDestination();
                try {
                    mixGain.connect(recordDest);
                } catch (e) {
                    recordDest = null;
                    recordStream = null;
                    throw e;
                }
                recordStream = recordDest.stream;
            };

	            const createMixedRecorder = () => {
	                if (!recordStream || typeof recordStream.getTracks !== 'function') {
	                    throw new Error('No record stream (MediaStream) for MediaRecorder');
	                }
                const tracks = recordStream.getTracks();
                if (!tracks || !tracks.length) {
                    throw new Error('No tracks in record stream (MediaStream) for MediaRecorder');
                }
                const mime = pickMediaRecorderMime();
                mediaRecorder = mime ? new MediaRecorder(recordStream, { mimeType: mime }) : new MediaRecorder(recordStream);
	                mediaRecorder.ondataavailable = (event) => { if (event.data && event.data.size > 0) audioChunks.push(event.data); };
	                mediaRecorder.onstop = () => finalizeChunkSingle();
	            };

	            function finalizeChunkSingle() {
	                splitInProgress = false;
	                const forced = forceChunk;
	                forceChunk = false;
                if (!audioChunks.length) {
                    if (!isRecording || recordingMode !== 'mixed') cleanupRecordingDests();
                    return;
                }
                const blobType = pickBlobTypeFromParts(audioChunks, mediaRecorder?.mimeType || '');
                const blob = blobType ? new Blob(audioChunks, { type: blobType }) : new Blob(audioChunks);
	                const durationMs = Date.now() - lastChunkStart;
	                const speechMs = resolveSpeechMsForChunk('', speechMsMixed || 0);
	                const speechRatio = durationMs > 0 ? (speechMs / durationMs) * 100 : 0;
                const speechRatioSafe = Number.isFinite(speechRatio) ? speechRatio : 0;
                audioChunks = [];

                const isSilent = (MIN_SPEECH_RATIO > 0) ? (speechRatioSafe <= MIN_SPEECH_RATIO) : false;
                if (isSilent) {
                    console.debug('Silence-only chunk (single)', { durationMs, speechMs, speechRatio: speechRatioSafe });
                }

                chunkIndex += 1;
                const ext = guessAudioExtFromMime(blobType);
                const base = `${String(chunkIndex).padStart(3,'0')}${ext}`;
                const label = `${base} (${(durationMs/1000).toFixed(1)}s)`;
                const { list, doc } = resolveChunkListTarget();
                const { li, upBtn } = createChunkListItem(blob, label, (speechMs/1000), base, doc);
                try {
                    const startedAtMs = Math.max(0, Math.round(lastChunkStart || Date.now() - durationMs));
                    const endedAtMs = Math.max(startedAtMs, startedAtMs + Math.max(0, Math.round(durationMs)));
                    li.dataset.durationMs = String(Math.max(0, Math.round(durationMs)));
                    li.dataset.startedAtMs = String(startedAtMs);
                    li.dataset.endedAtMs = String(endedAtMs);
                    li.dataset.speechRatio = String(Math.max(0, Math.min(100, speechRatioSafe)));
                    li.dataset.trackKind = 'chunk';
                } catch {}
                if (isSilent) {
                    try { li.dataset.silent = '1'; } catch {}
                }
                // Attach context for speaker inference on upload.
                try {
                    const active = [];
                    for (let mi = 1; mi <= micCount; mi++) { if (micDeviceIds[mi]) active.push(mi); }
                    li.dataset.enabledMics = String(active.length);
                    if (active.length === 1) {
                        const mi = active[0];
                        li.dataset.mic = String(mi);
                        li.dataset.deviceLabel = getSelectedMicLabel(mi);
                        li.dataset.trackKey = micKey(mi);
                    }
                } catch {}
                if (list) list.insertBefore(li, list.firstChild);
                if (autoUploadChunks && !isSilent) {
                    setTimeout(async () => {
                        try { await (li?._validatePromise || Promise.resolve()); } catch {}
                        if (li?.dataset?.corrupt === '1') return;
                        try { upBtn.click(); } catch {}
                    }, 50);
                }

                // Reset speech accumulators for next chunk
                speechMsMixed = 0; speechMsByKey = {}; speechMsByKeyFallback = {}; lastAnalysisTs = 0;
                if (isRecording && recordingMode === 'mixed' && !modeSwitching) {
                    lastChunkStart = Date.now();
                    createMixedRecorder();
                    mediaRecorder.start(1000);
                } else {
                    cleanupRecordingDests();
                }
            }

            cleanupRecordingDests();

            try {
                if (!recordSeparate) {
                    ensureMixedDest();
                    createMixedRecorder();
                    mediaRecorder.start(1000);
                } else {
                    // Per-mic recorders using per-mic WebAudio destinations (volume applies)
                    for (let mi = 1; mi <= micCount; mi++) {
                        if (!micStreams[mi] || !micGainNodes[mi]) continue;
                        const dest = audioContext.createMediaStreamDestination();
                        micRecordDests[mi] = dest;
                        micGainNodes[mi].connect(dest);
                        const tracks = dest.stream?.getTracks?.() || [];
                        if (!tracks.length) continue;

                        const mime = pickMediaRecorderMime();
                        const mr = mime ? new MediaRecorder(dest.stream, { mimeType: mime }) : new MediaRecorder(dest.stream);
                        const actualMime = (mr && typeof mr.mimeType === 'string' && mr.mimeType) ? mr.mimeType : (mime || '');
                        const entry = { key: micKey(mi), mr, mimeType: actualMime, buf: [], _stopped: false, _stopRequested: false };
                        mr.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) entry.buf.push(ev.data); };
                        mr.onstop = () => { entry._stopped = true; entry._stopRequested = false; };
                        mediaRecorders.push(entry);
                    }
                    for (const r of mediaRecorders) { try { r.mr.start(1000); } catch {} }
                }
                try { startArchiveTrackRecorders({ sessionId: sid }); } catch (e) { console.warn('[archive] start failed', e); }
            } catch (e) {
                console.error('startRecording failed', e);
                try { cleanupRecordingDests(); } catch {}
                try { await stopArchiveTrackRecorders({ reason: 'start-recording-failed', timeoutMs: 1500, pollMs: 60 }); } catch {}
                isRecording = false;
                const startBtn = document.getElementById('start-btn'); if (startBtn) startBtn.disabled = false;
                const recordBtn = document.getElementById('record-btn'); if (recordBtn) recordBtn.disabled = false;
                const pauseBtn = document.getElementById('pause-btn'); if (pauseBtn) pauseBtn.disabled = true;
                const chunkBtn = document.getElementById('chunk-btn'); if (chunkBtn) chunkBtn.disabled = true;
                throw e;
            }

            isRecording = true;
            isPaused = false;
            try { persistPausedHint(false); } catch {}
            try {
                const now = Date.now();
                // Start keeps its original startTs; Resume continues from the paused position.
                if (!fabStartTs) {
                    fabStartTs = now;
                    fabFrozenElapsedMs = -1;
                    speechMsTotal = 0;
                    cutEventsMs = [];
                }
                if (fabPausedTs) {
                    fabPausedMs += Math.max(0, now - fabPausedTs);
                    fabPausedTs = 0;
                }
            } catch {}
            setFabState('recording');
            setFabMenuPauseLabel();
            setPauseButtonLabel();
            startFabOrbit();
            showFabToast('Recording enabled');
            syncControlState();
            lastChunkStart = Date.now();
            speechMsMixed = 0; speechMsByKey = {}; speechMsByKeyFallback = {}; lastAnalysisTs = 0;

            const startBtn = document.getElementById('start-btn'); if (startBtn) startBtn.disabled = true;
            const recordBtn = document.getElementById('record-btn'); if (recordBtn) recordBtn.disabled = true;
            const pauseBtn = document.getElementById('pause-btn'); if (pauseBtn) pauseBtn.disabled = false;
            const chunkBtn = document.getElementById('chunk-btn'); if (chunkBtn) chunkBtn.disabled = false;
            try { const rs = document.getElementById('rec-status'); if (rs) rs.textContent = 'Recording…'; } catch {}

	            ensureAnalysisLoop('start-recording');

            if (window._counterTimer) clearInterval(window._counterTimer);
            window._counterTimer = setInterval(updateCounters, 100);
            logUi('start-recording.ok', { mode: recordingMode });
            } catch (e) {
                console.error('[startRecording] failed', e);
                logUi('start-recording.error', { message: String(e || '') });
                alert('Failed to start recording: ' + e);
            }
        }

        let separateFinalizePromise = null;
        function scheduleFinalizeChunkSeparate(opts = {}) {
            if (separateFinalizePromise) return separateFinalizePromise;
            const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 2500;
            const pollMs = Number.isFinite(opts.pollMs) ? opts.pollMs : 60;
            const reason = String(opts.reason || '');
            const start = Date.now();
            separateFinalizePromise = new Promise((resolve) => {
                const tick = () => {
                    let ready = true;
                    try {
                        for (const r of (mediaRecorders || [])) {
                            if (!r || !r.mr) continue;
                            if (r.mr.state === 'recording') { ready = false; break; }
                            if (r._stopRequested && !r._stopped) { ready = false; break; }
                        }
                    } catch {}
                    if (ready) {
                        try { finalizeChunkSeparate(); } catch (e) { console.warn('[finalizeSeparate] finalize threw', e); }
                        resolve('stopped');
                        return;
                    }
                    if ((Date.now() - start) >= timeoutMs) {
                        console.warn('[finalizeSeparate] timeout waiting for MediaRecorder.stop', { reason, timeoutMs });
                        try { finalizeChunkSeparate(); } catch (e) { console.warn('[finalizeSeparate] finalize threw', e); }
                        resolve('timeout');
                        return;
                    }
                    setTimeout(tick, pollMs);
                };
                setTimeout(tick, 0);
            }).finally(() => { separateFinalizePromise = null; });
            return separateFinalizePromise;
        }

        // Global finalize for separate-tracks mode so stopRecording()/detectPause() can call it
        function finalizeChunkSeparate() {
            try {
                splitInProgress = false;
                const forced = forceChunk;
                forceChunk = false;
                const nextIndex = chunkIndex + 1;
                let produced = 0;
                const durationMs = Date.now() - lastChunkStart;
                const enabledMics = Array.isArray(mediaRecorders) ? mediaRecorders.length : 0;
                const { list, doc } = resolveChunkListTarget();
                for (const r of (mediaRecorders || [])) {
                    const parts = r && r.buf && r.buf.length ? r.buf : [];
                    // Clear buffers immediately after snapshot to avoid double-finalize duplicates.
                    try { if (r) { r.buf = []; r._stopRequested = false; } } catch {}
                    if (!parts.length) continue;
	                    const speechMsPrimary = (speechMsByKey && typeof r?.key === 'string') ? (speechMsByKey[r.key] || 0) : 0;
	                    const speechMs = resolveSpeechMsForChunk((typeof r?.key === 'string') ? r.key : '', speechMsPrimary);
	                    const speechRatio = durationMs > 0 ? (speechMs / durationMs) * 100 : 0;
                    const speechRatioSafe = Number.isFinite(speechRatio) ? speechRatio : 0;
                    const isSilent = (MIN_SPEECH_RATIO > 0) ? (speechRatioSafe <= MIN_SPEECH_RATIO) : false;
                    if (isSilent) {
                        console.debug('Silence-only track', r.key, { durationMs, speechMs, speechRatio: speechRatioSafe });
                    }
                    const blobType = pickBlobTypeFromParts(parts, r?.mimeType || r?.mr?.mimeType || '');
                    const blob = blobType ? new Blob(parts, { type: blobType }) : new Blob(parts);
                    const idxP = String(nextIndex).padStart(3,'0');
                    let micNumStr = '';
                    try { const m = String(r.key||'').match(/(\d+)/); micNumStr = m ? m[1] : ''; } catch {}
                    const ext = guessAudioExtFromMime(blobType);
                    const base = micNumStr ? `${idxP}-${micNumStr}${ext}` : `${idxP}${ext}`;
                    const label = `${base} (${(durationMs/1000).toFixed(1)}s)`;
                    const { li, upBtn } = createChunkListItem(blob, label, (speechMs/1000), base, doc);
                    try {
                        const startedAtMs = Math.max(0, Math.round(lastChunkStart || Date.now() - durationMs));
                        const endedAtMs = Math.max(startedAtMs, startedAtMs + Math.max(0, Math.round(durationMs)));
                        li.dataset.durationMs = String(Math.max(0, Math.round(durationMs)));
                        li.dataset.startedAtMs = String(startedAtMs);
                        li.dataset.endedAtMs = String(endedAtMs);
                        li.dataset.speechRatio = String(Math.max(0, Math.min(100, speechRatioSafe)));
                        li.dataset.trackKind = 'chunk';
                    } catch {}
                    if (isSilent) {
                        try { li.dataset.silent = '1'; } catch {}
                    }
                    try {
                        li.dataset.enabledMics = String(enabledMics);
                        const mi = Number(micNumStr || 0);
                        if (Number.isFinite(mi) && mi > 0) {
                            li.dataset.mic = String(mi);
                            li.dataset.deviceLabel = getSelectedMicLabel(mi);
                            li.dataset.trackKey = micKey(mi);
                        }
                    } catch {}
                    if (list) list.insertBefore(li, list.firstChild);
                    if (autoUploadChunks && !isSilent) {
                        setTimeout(async () => {
                            try { await (li?._validatePromise || Promise.resolve()); } catch {}
                            if (li?.dataset?.corrupt === '1') return;
                            try { upBtn.click(); } catch {}
                        }, 50);
                    }
                    produced += 1;
                }
                if (produced > 0) chunkIndex = nextIndex;
                // Reset speech accumulators for next chunk
                speechMsMixed = 0; speechMsByKey = {}; speechMsByKeyFallback = {}; lastAnalysisTs = 0;
                if (isRecording && recordingMode === 'separate' && !modeSwitching) {
                    lastChunkStart = Date.now();
                    // restart all recorders
                    for (const r of (mediaRecorders || [])) { try { r.buf = []; r._stopped = false; r._stopRequested = false; r.mr.start(1000); } catch(e){} }
                }
            } catch (e) {
                console.error('finalizeChunkSeparate failed', e);
            }
        }

        function getPanelDocs() {
            const docs = [document];
            const pushDoc = (doc) => { if (doc && !docs.includes(doc)) docs.push(doc); };
            try {
                const s = document.querySelector('.panel-iframe[data-src*="settings.html"], .panel-iframe[src*="settings.html"]');
                if (s?.contentDocument) pushDoc(s.contentDocument);
            } catch {}
            try {
                const m = document.querySelector('.panel-iframe[data-src*="monitoring.html"], .panel-iframe[src*="monitoring.html"]');
                if (m?.contentDocument) pushDoc(m.contentDocument);
            } catch {}
            return docs;
        }

        function syncTestingModeUi() {
            try {
                const docs = getPanelDocs();
                for (const doc of docs) {
                    const btn = doc.getElementById('btn-test-mode');
                    if (!btn) continue;
                    const isOn = !!testingMode;
                    btn.textContent = isOn ? 'Stop test' : 'Test audio';
                    btn.dataset.active = isOn ? '1' : '0';
                    btn.title = isOn
                        ? 'Stop testing mode (monitoring only, no recording).'
                        : 'Enable testing mode (monitoring only, no recording).';
                }
            } catch {}
        }

        function setTestingMode(next, reason = '') {
            const desired = !!next;
            if (isRecording) {
                testingMode = false;
                try { syncTestingModeUi(); } catch {}
                try { showFabToast('Stop recording to test audio', 1600); } catch {}
                return;
            }
            testingMode = desired;
            try { localStorage.setItem('testingMode', testingMode ? '1' : '0'); } catch {}
            try { syncTestingModeUi(); } catch {}
            if (testingMode) {
                allowMonitoringInit = true;
                primeAudioContextForGesture(`testing-mode:${reason || 'toggle'}`);
                try { ensureMonitoring(`testing-mode:${reason || 'toggle'}`); } catch {}
            } else {
                allowMonitoringInit = false;
                try { teardownMonitoringGraph('testing-mode-off', { keepContext: false }); } catch {}
            }
        }

	        function bindTestingModeControls() {
	            try {
	                const docs = getPanelDocs();
                for (const doc of docs) {
                    const btn = doc.getElementById('btn-test-mode');
                    if (!btn || btn.dataset.bound === '1') continue;
                    btn.dataset.bound = '1';
                    btn.addEventListener('click', () => {
                        setTestingMode(!testingMode, 'button');
                    });
                }
	            } catch {}
	        }

	        function runAnalysisTick(reason = '') {
	            try {
	                if (analysisInFlight) return;
	                analysisInFlight = true;
	                analyzeAudio();
	            } catch (e) {
	                console.warn('runAnalysisTick failed', { reason, error: e });
	            } finally {
	                analysisInFlight = false;
	            }
	        }

	        function scheduleAnalysisRaf() {
	            try {
	                if (analysisRaf) return;
	                analysisRaf = requestAnimationFrame(() => {
	                    analysisRaf = 0;
	                    runAnalysisTick('raf');
	                });
	            } catch {}
	        }

	        function ensureAnalysisLoop(reason = '') {
	            scheduleAnalysisRaf();
	            if (analysisTickTimer) return;
	            const intervalMs = 250;
	            analysisTickTimer = setInterval(() => {
	                try {
	                    if (!isRecording && !testingMode) return;
	                    const now = Date.now();
	                    const staleMs = Math.max(1500, analysisFrameMs * 8);
	                    const stale = !lastAnalysisFrameMs || ((now - lastAnalysisFrameMs) > staleMs);
	                    const hidden = document.visibilityState === 'hidden';
	                    // rAF can freeze forever in hidden tabs (notably Firefox). Recover stale loops explicitly.
	                    if (!hidden && stale && analysisRaf) {
	                        try { cancelAnimationFrame(analysisRaf); } catch {}
	                        analysisRaf = 0;
	                    }
	                    if (hidden || stale) runAnalysisTick(hidden ? 'hidden-fallback' : 'stale-fallback');
	                } catch {}
	            }, intervalMs);
	            try { console.info('[audio] analysis loop enabled', { reason, intervalMs }); } catch {}
	        }

	        function stopAnalysisLoop(reason = '') {
	            try { if (analysisRaf) cancelAnimationFrame(analysisRaf); } catch {}
	            analysisRaf = 0;
	            try { if (analysisTickTimer) clearInterval(analysisTickTimer); } catch {}
	            analysisTickTimer = 0;
	            analysisInFlight = false;
	            try { console.info('[audio] analysis loop disabled', { reason }); } catch {}
	        }

		        // Analyze the audio for silence
		        function analyzeAudio() {
		            try {
		                const nowFrame = Date.now();
		                if (lastAnalysisFrameMs && (nowFrame - lastAnalysisFrameMs) < analysisFrameMs) {
		                    scheduleAnalysisRaf();
		                    return;
		                }
		                lastAnalysisFrameMs = nowFrame;
		                // If graph not ready, keep polling lightly.
		                if (!mixAnalyser || !mixDataArray || !outAnalyser || !outDataArray) {
		                    scheduleAnalysisRaf();
		                    return;
		                }
	
	                // Mixed input level (for silence splitting)
	                mixAnalyser.getByteFrequencyData(mixDataArray);
	                let totalMic = 0;
	                for (let i = 0; i < mixDataArray.length; i++) totalMic += mixDataArray[i];
	                const avgMic = totalMic / (mixDataArray.length || 1);
	
                    const rmsOf = (arr) => {
                        let sumSq = 0;
                        for (let i = 0; i < arr.length; i++) { const x = arr[i]; sumSq += x * x; }
                        return Math.sqrt(sumSq / (arr.length || 1));
                    };

	                // Output/monitor level
                    let outDb = -60;
                    if (outAnalyser && outTimeArray) {
                        outAnalyser.getFloatTimeDomainData(outTimeArray);
                        outDb = rmsToDb(rmsOf(outTimeArray));
                    } else if (outAnalyser && outDataArray) {
                        outAnalyser.getByteFrequencyData(outDataArray);
                        let totalOut = 0;
                        for (let i = 0; i < outDataArray.length; i++) totalOut += outDataArray[i];
                        const avgOut = totalOut / (outDataArray.length || 1);
                        outDb = avgToDb(avgOut);
                    }
	
	                // Per-mic meters + cache dB for speech tracking
	                const micDbByIndex = {};
                    const docs = getPanelDocs();
                    // Note: use time-domain RMS dBFS for more stable speech/noise separation; detection is still
                    // relative to a per-mic noise floor so quiet voices can register while steady noise does not.
	                for (let mi = 1; mi <= micCount; mi++) {
	                    let db = -60;
	                    const an = micAnalysers[mi];
	                    const tarr = micTimeArrays[mi];
	                    const arr = micDataArrays[mi];
	                    if (an && tarr) {
	                        an.getFloatTimeDomainData(tarr);
	                        db = rmsToDb(rmsOf(tarr));
	                    } else if (an && arr) {
	                        an.getByteFrequencyData(arr);
	                        let sum = 0;
	                        for (let j = 0; j < arr.length; j++) sum += arr[j];
	                        const avg = sum / (arr.length || 1);
	                        db = avgToDb(avg);
	                    }
	                    micDbByIndex[mi] = db;
                        const pct = dbToPct(db);
                        for (const doc of docs) {
                            const bar = doc.getElementById(`bar-mic-${mi}-level`);
                            if (bar) bar.style.width = `${pct}%`;
                        }
	                }
                    for (const doc of docs) {
                        const bOut = doc.getElementById('bar-out');
                        if (bOut) bOut.style.width = `${dbToPct(outDb)}%`;
                    }

                    const nowTs = Date.now();
                    const windowMs = Number.isFinite(NOISE_AVG_MS) ? Math.max(200, NOISE_AVG_MS) : 1500;
                    const desiredWindowSize = Math.max(5, Math.round(windowMs / analysisFrameMs));
                    if (desiredWindowSize !== noiseWindowSize) {
                        noiseWindowSize = desiredWindowSize;
                        noiseSamplesByIndex = {};
                        noiseSamplePosByIndex = {};
                        noiseSampleCountByIndex = {};
                    }
                    const noiseDt = lastNoiseUpdateTs ? (nowTs - lastNoiseUpdateTs) : 0;
                    lastNoiseUpdateTs = nowTs;
                    const noiseAlpha = noiseDt > 0 ? (1 - Math.exp(-noiseDt / NOISE_FOLLOW_MS)) : 1;

	                    // Dynamic noise floor: track the lower percentile of the recent window.
	                    // Important: do NOT let the noise floor chase speech (otherwise gate rises above speech and we get "speech=0"
	                    // while the user is talking). So when we already have a baseline and current frame is classified as speech,
	                    // skip adding it into the noise window.
	                    for (let mi = 1; mi <= micCount; mi++) {
	                        if (!micAnalysers[mi]) continue;
	                        const db = micDbByIndex[mi];
	                        if (!Number.isFinite(db)) continue;
	                        if (SPEECH_THRESHOLD_MODE === 'dynamic') {
	                            const prevNoise = micNoiseDbByIndex[mi];
	                            if (Number.isFinite(prevNoise)) {
	                                const gateDb = prevNoise + SPEECH_DB_MARGIN;
	                                if (db >= gateDb) continue;
	                            }
	                        }
	                        let samples = noiseSamplesByIndex[mi];
	                        if (!samples || samples.length !== noiseWindowSize) {
	                            samples = new Float32Array(noiseWindowSize);
	                            noiseSamplesByIndex[mi] = samples;
	                            noiseSamplePosByIndex[mi] = 0;
                            noiseSampleCountByIndex[mi] = 0;
                        }
                        let pos = noiseSamplePosByIndex[mi] || 0;
                        let count = noiseSampleCountByIndex[mi] || 0;
                        samples[pos] = db;
                        pos = (pos + 1) % noiseWindowSize;
                        count = Math.min(count + 1, noiseWindowSize);
                        noiseSamplePosByIndex[mi] = pos;
                        noiseSampleCountByIndex[mi] = count;

                        if (count > 0) {
                            const buf = Array.from(samples.slice(0, count)).sort((a, b) => a - b);
                            const idx = Math.max(0, Math.min(buf.length - 1, Math.floor((buf.length - 1) * NOISE_PERCENTILE)));
                            const floorDb = buf[idx];
                            const prev = micNoiseDbByIndex[mi];
                            micNoiseDbByIndex[mi] = Number.isFinite(prev)
                                ? (prev + (floorDb - prev) * noiseAlpha)
                                : floorDb;
                        }
                    }
                    // Noise floor + gate/threshold readouts in Settings/Monitoring iframes
                    for (let mi = 1; mi <= micCount; mi++) {
                        const db = micDbByIndex[mi];
                        const noiseDb = Number.isFinite(micNoiseDbByIndex[mi]) ? micNoiseDbByIndex[mi] : db;
                        const safeNoise = Number.isFinite(noiseDb) ? noiseDb : -60;
                        const mode = SPEECH_THRESHOLD_MODE === 'dynamic' ? 'dynamic' : 'manual';
                        const gateDb = (mode === 'dynamic') ? (safeNoise + SPEECH_DB_MARGIN) : NOISE_THRESHOLD_DB;
                        const noisePct = dbToPct(safeNoise);
                        const gatePct = dbToPct(gateDb);
                        for (const doc of docs) {
                            const tickNoise = doc.getElementById(`tick-mic-${mi}-noise`);
                            if (tickNoise) tickNoise.style.left = `${Math.min(100, Math.max(0, noisePct))}%`;
                            const tickGate = doc.getElementById(`tick-mic-${mi}-gate`);
                            if (tickGate) tickGate.style.left = `${Math.min(100, Math.max(0, gatePct))}%`;
                            const label = doc.getElementById(`mic-${mi}-noise-label`);
                            if (label) {
                                label.textContent = (mode === 'dynamic')
                                    ? `Noise: ${safeNoise.toFixed(1)} dB · Gate: ${gateDb.toFixed(1)} dB`
                                    : `Noise: ${safeNoise.toFixed(1)} dB · Threshold: ${gateDb.toFixed(1)} dB`;
                            }
                        }
                    }
	
	                // Speech accumulation (per chunk)
	                let speechActive = false;
                if (isRecording) {
                    const dt = lastAnalysisTs ? (nowTs - lastAnalysisTs) : 0;
                    lastAnalysisTs = nowTs;
	                    if (dt > 0) {
	                        let anySpeech = false;
	                        for (let mi = 1; mi <= micCount; mi++) {
                                if (!micAnalysers[mi]) continue;
		                            const db = micDbByIndex[mi];
		                            if (!Number.isFinite(db)) continue;
                                const noiseDb = Number.isFinite(micNoiseDbByIndex[mi]) ? micNoiseDbByIndex[mi] : db;
                                const mode = SPEECH_THRESHOLD_MODE === 'dynamic' ? 'dynamic' : 'manual';
                                const gateDb = (mode === 'dynamic') ? (noiseDb + SPEECH_DB_MARGIN) : NOISE_THRESHOLD_DB;
                                const isSpeechNow = (db >= gateDb);
	                            const isSpeechFallback = (db >= ABS_SPEECH_FALLBACK_DB);
	                            const k = micKey(mi);
                            if (isSpeechNow) {
                                anySpeech = true;
                                speechMsByKey[k] = (speechMsByKey[k] || 0) + dt;
                            }
	                            if (isSpeechFallback) {
	                                speechMsByKeyFallback[k] = (speechMsByKeyFallback[k] || 0) + dt;
	                            }
                        }
		                        if (anySpeech) {
                                speechMsMixed += dt;
                                speechMsTotal += dt;
                                speechActive = true;
                            }
	                    }
	                }

	                // During recording: silence-driven auto-split + max cap
                if (isRecording) {
	                const silentNow = !speechActive;
	                    if (silentNow) {
	                        if (!isSilence) { silenceTimer = Date.now(); }
	                        isSilence = true;
	                        const requiredNow = getRequiredSilenceMs();
	                        if ((Date.now() - lastChunkStart) >= minChunkMs && (Date.now() - silenceTimer) >= requiredNow) {
	                            detectPause();
	                        }
	                    } else {
	                        const required = getRequiredSilenceMs();
	                        if (isSilence && (Date.now() - silenceTimer >= required) && (Date.now() - lastChunkStart >= minChunkMs)) {
	                            detectPause();
	                        }
	                        isSilence = false;
	                    }
	                    if (Date.now() - lastChunkStart >= maxChunkMs) detectPause();
	                }
		            } catch (e) {
		                console.warn('analyzeAudio failed', e);
		            }
		
		            scheduleAnalysisRaf();
		        }

        // Detect pause or silence and create a chunk
        function detectPause(force = false) {
            if (splitInProgress) return;
            splitInProgress = true;
            if (force) forceChunk = true;
            try {
                if (isRecording && fabStartTs) {
                    cutEventsMs.push(getFabElapsedMs());
                    updateFabOrbit();
                }
            } catch {}
            // Stop current recorder which triggers onstop to append chunk and restart if isRecording
            // Reset silence counters immediately on manual/auto split
            isSilence = false;
            silenceTimer = Date.now();
            if (recordingMode === 'mixed') {
                if (mediaRecorder && mediaRecorder.state === 'recording') { try { mediaRecorder.requestData(); } catch{} mediaRecorder.stop(); }
            } else {
                for (const r of mediaRecorders) {
                    try {
                        if (r.mr && r.mr.state === 'recording') {
                            try { r._stopRequested = true; } catch {}
                            try { r.mr.requestData(); } catch{}
                            r.mr.stop();
                        }
                    } catch(e){}
                }
                // Force flush but wait for stop events (bounded) to avoid mixing leftover tail fragments into the next chunk.
                try { for (const r of mediaRecorders) { try { r.mr.requestData(); } catch{} } } catch {}
                scheduleFinalizeChunkSeparate({ reason: force ? 'cut' : 'split', timeoutMs: 2500, pollMs: 60 });
            }
            // Analysis loop is continuous; no need to restart it here.
        }

        async function pauseRecording() {
            if (!isRecording) return;
            try {
                const now = Date.now();
                if (fabStartTs && !fabPausedTs) fabPausedTs = now;
            } catch {}
            isRecording = false;
            isPaused = true;
            try { persistPausedHint(true); } catch {}
            try { persistVoicebotState('paused'); } catch {}
            if (fabStopTimer) { clearTimeout(fabStopTimer); fabStopTimer = null; }
            setFabState('paused');
            stopFabOrbit({ reset: false });
            showFabToast('Paused');

            try {
                if (mediaRecorder && mediaRecorder.state === 'recording') {
                    try { mediaRecorder.requestData(); } catch {}
                    try { mediaRecorder.stop(); } catch {}
                }
                for (const r of (mediaRecorders || [])) {
                    try {
                        if (r.mr && r.mr.state === 'recording') {
                            try { r._stopRequested = true; } catch {}
                            try { r.mr.requestData(); } catch {}
                            try { r.mr.stop(); } catch {}
                        }
                    } catch {}
                }
            } catch (e) {
                console.warn('[Pause] stop recorders failed', e);
            }

            if (recordingMode === 'separate') {
                try { await scheduleFinalizeChunkSeparate({ reason: 'pause', timeoutMs: 5000, pollMs: 60 }); } catch {}
            }
            try { await stopArchiveTrackRecorders({ reason: 'pause', timeoutMs: 5000, pollMs: 60 }); } catch {}

            const pauseBtn = document.getElementById('pause-btn'); if (pauseBtn) pauseBtn.disabled = true;
            setPauseButtonLabel();
            const chunkBtn = document.getElementById('chunk-btn'); if (chunkBtn) chunkBtn.disabled = true;
            if (window._counterTimer) { clearInterval(window._counterTimer); window._counterTimer = null; }
            try { const rs = document.getElementById('rec-status'); if (rs) rs.textContent = 'Paused'; } catch {}

            // Ensure current chunk is finalized and uploaded after pause.
            setTimeout(async () => {
                try {
                    const status = await waitForAllPendingUploads({ settleMs: 2000, pollMs: 500 });
                    console.log('[Pause] upload status:', status);
                } catch (e) {
                    console.warn('[Pause] upload failed:', e);
                }
            }, 0);

            // Cleanup recording destinations shortly after recorder flush.
            setTimeout(() => {
                if (isRecording) return;
                try { if (recordDest && mixGain) mixGain.disconnect(recordDest); } catch {}
                try { if (recordStream) _stopStreamSafe(recordStream); } catch {}
                recordStream = null;
                recordDest = null;

                for (let mi = 1; mi <= MAX_MIC_COUNT; mi++) {
                    const dest = micRecordDests[mi];
                    if (!dest) continue;
                    try { if (micGainNodes[mi]) micGainNodes[mi].disconnect(dest); } catch {}
                    try { _stopStreamSafe(dest.stream); } catch {}
                    micRecordDests[mi] = null;
                }
            }, 150);

            try { syncMicUI(); } catch {}
            if (testingMode) {
                try { ensureMonitoring('pause-recording'); } catch {}
            } else {
                try {
                    allowMonitoringInit = true;
                    await ensureMonitoring('pause-recording');
                } catch {}
            }
            syncControlState();
        }

        function setPauseButtonLabel() {
            const pauseBtn = document.getElementById('pause-btn');
            if (!pauseBtn) return;
            const lbl = pauseBtn.querySelector('.lbl');
            pauseBtn.dataset.icon = '⏸️';
            if (lbl) lbl.textContent = '⏸️ Pause';
        }

	        // Stop recording
	        async function stopRecording(opts = {}) {
            const reason = String(opts?.reason || 'stop');
	            isRecording = false;
                isPaused = false;
                try { persistPausedHint(false); } catch {}
                if (fabStopTimer) { clearTimeout(fabStopTimer); fabStopTimer = null; }
                setFabState('idle');
                try { persistVoicebotState('idle'); } catch {}
                stopFabOrbit({ reset: true });
                showFabToast('Recording stopped');
	            try { splitInProgress = false; } catch {}
	
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                try { mediaRecorder.requestData(); } catch {}
                try { mediaRecorder.stop(); } catch {}
            }
            for (const r of (mediaRecorders || [])) {
                try {
                    if (r.mr && r.mr.state === 'recording') {
                        try { r._stopRequested = true; } catch {}
                        try { r.mr.requestData(); } catch {}
                        try { r.mr.stop(); } catch {}
                    }
                } catch {}
            }
            const finalizeP = (recordingMode === 'separate')
                ? scheduleFinalizeChunkSeparate({ reason, timeoutMs: 5000, pollMs: 60 })
                : null;
            const archiveStopP = stopArchiveTrackRecorders({ reason, timeoutMs: 5000, pollMs: 60 });
	
	            const pauseBtn = document.getElementById('pause-btn'); if (pauseBtn) pauseBtn.disabled = true;
                setPauseButtonLabel();
	            const chunkBtn = document.getElementById('chunk-btn'); if (chunkBtn) chunkBtn.disabled = true;
	            if (window._counterTimer) { clearInterval(window._counterTimer); window._counterTimer = null; }
	            try { const rs = document.getElementById('rec-status'); if (rs) rs.textContent = 'Idle'; } catch {}
	
	            const afterStop = () => {
	                // Cleanup recording destinations shortly after recorder flush/finalize.
	                setTimeout(() => {
	                    if (isRecording) return;
	                    try { if (recordDest && mixGain) mixGain.disconnect(recordDest); } catch {}
	                    try { if (recordStream) _stopStreamSafe(recordStream); } catch {}
	                    recordStream = null;
	                    recordDest = null;

	                    for (let mi = 1; mi <= MAX_MIC_COUNT; mi++) {
	                        const dest = micRecordDests[mi];
	                        if (!dest) continue;
	                        try { if (micGainNodes[mi]) micGainNodes[mi].disconnect(dest); } catch {}
	                        try { _stopStreamSafe(dest.stream); } catch {}
	                        micRecordDests[mi] = null;
	                    }
	                }, 150);

	                try { syncMicUI(); } catch {}
	                if (!testingMode) {
	                    try { teardownMonitoringGraph('stop-recording', { keepContext: false }); } catch {}
	                    allowMonitoringInit = false;
	                }
	                syncControlState();
	            };
            const waits = [];
            if (finalizeP && typeof finalizeP.then === 'function') waits.push(finalizeP);
            if (archiveStopP && typeof archiveStopP.then === 'function') waits.push(archiveStopP);
            if (waits.length) {
                try { await Promise.allSettled(waits); } catch {}
            }
            afterStop();
        }

        // Event listeners for buttons
        const startBtn = document.getElementById('start-btn');
        if (startBtn) startBtn.addEventListener('click', () => dispatchControlAction('new'));
        const recordBtn = document.getElementById('record-btn');
        if (recordBtn) recordBtn.addEventListener('click', () => dispatchControlAction('rec'));
        const pauseBtn = document.getElementById('pause-btn');
        if (pauseBtn) pauseBtn.addEventListener('click', () => dispatchControlAction('pause'));
        const chunkBtn = document.getElementById('chunk-btn');
        if (chunkBtn) chunkBtn.addEventListener('click', () => dispatchControlAction('cut'));

        // File input: auto-upload on selection
        const fileInput = document.getElementById('file-input');
        const chooseBtn = document.getElementById('btn-choose-file');
        if (chooseBtn && fileInput) {
            chooseBtn.addEventListener('click', (e)=>{ e.preventDefault(); try { fileInput.click(); } catch {} });
        }
        if (fileInput && 'addEventListener' in fileInput) fileInput.addEventListener('change', async () => {
            const inp = fileInput;
            if (!inp || !('files' in inp) || !inp.files || inp.files.length === 0) return;
            const f = inp.files[0];
            try {
                // build list item with playback/download controls
                const label = f.name || 'file.webm';
                const { list, doc } = resolveChunkListTarget();
                const { li } = createChunkListItem(f, label, null, null, doc);
                if (list) list.insertBefore(li, list.firstChild);
                // Immediately upload
                const upBtn = li.querySelector('button[data-role="upload"]');
                await uploadBlobForLi(f, li, upBtn || null, null);
            } catch (e) { console.error(e); }
            // Reset input to allow re-selecting the same file
            try { fileInput.value = ''; } catch {}
        });

        // Upload all pending
        const btnUploadAll = document.getElementById('btn-upload-all');
        if (btnUploadAll) btnUploadAll.addEventListener('click', async () => {
            // Oldest first: DOM has newest on top; reverse to process bottom-up
            const items = Array.from(document.querySelectorAll('#audio-chunks li')).reverse();
            for (const li of items) {
                if (li.dataset && li.dataset.uploaded === '1') continue;
                const upBtn = li.querySelector('button[data-role="upload"]');
                if (li._blob) {
                    try { await uploadBlobForLi(li._blob, li, upBtn || null, null); } catch(e) { console.error(e); }
                }
            }
        });

        // Devices: populate microphones
        function pickResetDefaults(mics, outs) {
            const hasMics = Array.isArray(mics) && mics.length > 0;
            const hasOuts = Array.isArray(outs) && outs.length > 0;
            const isDefaultLabel = (label) => /(default|по умолчанию)/i.test(String(label || ''));
            const isMicLabel = (label) => /(microphone|микрофон)/i.test(String(label || ''));
            const isCableLabel = (label) => /(cable output|virtual cable)/i.test(String(label || ''));
            const cable = hasMics ? (mics.find(d => isCableLabel(d.label))?.deviceId || '') : '';
            const defaultMic = hasMics ? (mics.find(d => d.deviceId === 'default' || isDefaultLabel(d.label)) || null) : null;
            const defaultMicId = defaultMic?.deviceId || '';
            const mic1Preferred = defaultMicId
                ? defaultMicId
                : (hasMics ? (mics.find(d => isMicLabel(d.label) && (!cable || d.deviceId !== cable))?.deviceId || '') : '');

            let mic1Id = '';
            if (mic1Preferred) {
                mic1Id = mic1Preferred;
            } else if (cable && mics.length > 1) {
                mic1Id = mics.find(d => d.deviceId !== cable)?.deviceId || cable;
            } else {
                mic1Id = hasMics ? (mics[0]?.deviceId || '') : '';
            }

            let mic2Id = '';
            if (mics.length >= 2) {
                if (cable && cable !== mic1Id) mic2Id = cable;
                else mic2Id = mics.find(d => d.deviceId !== mic1Id)?.deviceId || '';
            }

            const norm = (v) => String(v || '').toLowerCase();
            const findOutByIncludes = (subs) => {
                try {
                    const needles = (subs || []).map(x => String(x || '').toLowerCase()).filter(Boolean);
                    const hit = outs.find(d => needles.some(needle => norm(d.label).includes(needle)));
                    return hit?.deviceId || '';
                } catch { return ''; }
            };
            const outputId = (() => {
                if (!hasOuts) return '__off__';
                const enHeadphones = findOutByIncludes(['headphones', 'headset', 'earphones']);
                if (enHeadphones) return enHeadphones;
                const enSpeakers = findOutByIncludes(['speakers']);
                if (enSpeakers) return enSpeakers;
                const ruHeadphones = findOutByIncludes(['наушники', 'гарнитура']);
                if (ruHeadphones) return ruHeadphones;
                const ruSpeakers = findOutByIncludes(['динамики']);
                if (ruSpeakers) return ruSpeakers;
                return outs[0]?.deviceId || '__off__';
            })();
            return { mic1Id, mic2Id, outputId, cableId: cable };
        }

        async function populateDevices(opts = {}) {
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                const mics = devices.filter(d => d.kind === 'audioinput');
                const outs = devices.filter(d => d.kind === 'audiooutput');
                mics.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
                outs.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
                const hasMicLabels = mics.some(d => String(d.label || '').trim());
                const hasOutLabels = outs.some(d => String(d.label || '').trim());

                ensureMicGroups(micCount);

                const hasOption = (selectEl, val) => val && Array.from(selectEl.options).some(o => o.value === val);
                const afterReset = !!opts?.afterReset;
                const resetDefaults = afterReset ? pickResetDefaults(mics, outs) : null;
                const allowAutoDefaults = afterReset || !hasStoredMicSelection();

                // Microphones (1..micCount)
                const chosenMicIds = new Set();
                for (let mi = 1; mi <= micCount; mi++) {
                    const sel = document.getElementById(`mic-${mi}-select`);
                    if (!sel) continue;
                    const devKey = (mi === 1) ? 'micDeviceId' : (mi === 2) ? 'mic2DeviceId' : `mic${mi}DeviceId`;
                    const saved = localStorage.getItem(devKey);

                    sel.innerHTML = '';
                    const offOpt = document.createElement('option');
                    offOpt.value = '__off__';
                    offOpt.textContent = 'OFF';
                    sel.appendChild(offOpt);
                if (hasMicLabels) {
                    mics.forEach((d, idx) => {
                        const opt = document.createElement('option');
                        opt.value = d.deviceId;
                        opt.textContent = d.label || `Mic ${idx + 1}`;
                        sel.appendChild(opt);
                    });
                }

                if (!hasMicLabels) {
                    try { localStorage.setItem('deviceLabelsMissing', '1'); } catch {}
                    sel.value = '__off__';
                    continue;
                }

                    let preferred = null;
                    if (afterReset && resetDefaults) {
                        if (mi === 1 && resetDefaults.mic1Id && hasOption(sel, resetDefaults.mic1Id)) preferred = resetDefaults.mic1Id;
                        else if (mi === 2 && resetDefaults.mic2Id && hasOption(sel, resetDefaults.mic2Id)) preferred = resetDefaults.mic2Id;
                    } else {
                        if (saved && saved !== '__off__' && hasOption(sel, saved)) preferred = saved;
                        else if (micDeviceIds[mi] && hasOption(sel, micDeviceIds[mi])) preferred = micDeviceIds[mi];
                        else if (sel.value && sel.value !== '__off__' && hasOption(sel, sel.value)) preferred = sel.value;
                        else if (allowAutoDefaults && mi === 1 && sel.options.length > 1) preferred = sel.options[1].value;
                    }

                    // Fallback: pick the first available mic not already used by another slot.
                    if (!preferred && allowAutoDefaults) {
                        const candidates = Array.from(sel.options)
                            .map(o => String(o.value || '').trim())
                            .filter(v => v && v !== '__off__' && v !== 'OFF');
                        const unique = candidates.find(v => !chosenMicIds.has(v));
                        if (unique) preferred = unique;
                    }

                    sel.value = (preferred && hasOption(sel, preferred)) ? preferred : '__off__';
                    micDeviceIds[mi] = (sel.value === '__off__' || sel.value === 'OFF') ? null : String(sel.value);
                    try { localStorage.setItem(devKey, micDeviceIds[mi] ? String(micDeviceIds[mi]) : '__off__'); } catch {}
                    if (micDeviceIds[mi]) chosenMicIds.add(micDeviceIds[mi]);
                }

                // Speaker / output device (for monitoring)
                const spk = document.getElementById('spk-select');
                if (spk) {
                    const savedOut = String(localStorage.getItem('outputDeviceId') || '').trim();
                    const currentOut = String(spk.value || selectedOutputId || '').trim();
                    spk.innerHTML = '';
                    const offOut = document.createElement('option');
                    offOut.value = '__off__';
                    offOut.textContent = 'OFF';
                    spk.appendChild(offOut);
                    if (hasOutLabels) {
                        outs.forEach((d, idx) => {
                            const opt = document.createElement('option');
                            opt.value = d.deviceId;
                            opt.textContent = d.label || `Speaker ${idx + 1}`;
                            spk.appendChild(opt);
                        });
                    }
                    if (!hasOutLabels) {
                        spk.value = '__off__';
                    } else {
                    let preferOut = '__off__';
                    if (savedOut && hasOption(spk, savedOut)) preferOut = savedOut;
                    else if (currentOut && currentOut !== '__off__' && hasOption(spk, currentOut)) preferOut = currentOut;
                    else if (afterReset && resetDefaults?.outputId && hasOption(spk, resetDefaults.outputId)) { preferOut = resetDefaults.outputId; }
                    else if (afterReset && outs.length) { preferOut = outs[0].deviceId; }
                    spk.value = preferOut;
                    selectedOutputId = String(spk.value || '').trim();
                    if (afterReset) {
                        try { localStorage.setItem('outputDeviceId', selectedOutputId || '__off__'); } catch {}
                    }
                    }
                }

                if (afterReset && resetDefaults) {
                    for (let i = 1; i <= micCount; i++) {
                        micMonitorOn[i] = !!(resetDefaults.cableId && micDeviceIds[i] === resetDefaults.cableId);
                        try { localStorage.setItem(`mic${i}Monitor`, micMonitorOn[i] ? '1' : '0'); } catch {}
                        const cb = document.getElementById(`mic-${i}-monitor`);
                        if (cb && 'checked' in cb) cb.checked = micMonitorOn[i];
                        micAecNsAgc[i] = !(resetDefaults.cableId && micDeviceIds[i] === resetDefaults.cableId);
                        try { localStorage.setItem(`mic${i}AecNsAgc`, micAecNsAgc[i] ? '1' : '0'); } catch {}
                        const aecCb = document.getElementById(`mic-${i}-aec`);
                        if (aecCb && 'checked' in aecCb) aecCb.checked = micAecNsAgc[i];
                    }
                }

                try { syncMicUI(); } catch {}
            } catch (e) {
                console.warn('enumerateDevices failed; need permission first', e);
            }
        }

        // Helper to prompt permission and populate devices at app start
        async function initDeviceEnumeration() {
            // Guard: only in secure context (HTTPS or localhost)
            if (!IS_SECURE_OR_LOCAL) {
                console.warn('initDeviceEnumeration skipped: insecure context');
                const note = document.getElementById('scheme-note');
                if (note) note.textContent = 'MediaDevices blocked on HTTP. Open over HTTPS or localhost.';
                throw new Error('insecure-context');
            }
            try {
                await populateDevices();
            } catch (e) {
                console.warn('initDeviceEnumeration', e);
            }
        }

        let _deviceLabelsReady = false;
        let _settingsPermToastTs = 0;
        async function ensureDeviceLabels(reason = '') {
            if (!IS_SECURE_OR_LOCAL) return false;
            if (_deviceLabelsReady) return true;
            try {
                const devs = await navigator.mediaDevices.enumerateDevices();
                const hasLabels = Array.isArray(devs) && devs.some(d => (d?.kind === 'audioinput' || d?.kind === 'audiooutput') && String(d?.label || '').trim());
                if (hasLabels) {
                    _deviceLabelsReady = true;
                    return true;
                }
            } catch {}
            try {
                // Request permission only as a result of explicit user actions (Start / Resume / opening Settings).
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                _stopStreamSafe(stream);
                _deviceLabelsReady = true;
                logApi('media.permission', { reason, ok: true });
                return true;
            } catch (e) {
                logApi('media.permission', { reason, ok: false, message: String(e || '') });
                return false;
            }
        }

        async function ensureSettingsDevices(reason = '') {
            if (!IS_SECURE_OR_LOCAL) return false;
            const hasStored = hasStoredMicSelection();
            const labelsOk = await ensureDeviceLabels(reason);
            if (!labelsOk) {
                try {
                    const now = Date.now();
                    if (now - _settingsPermToastTs > 2500) {
                        _settingsPermToastTs = now;
                        const anchor = document.getElementById('btn-reset')
                            || (panelTabs || []).find(btn => btn?.dataset?.panel === 'settings')
                            || fabButton
                            || document.body;
                        if (anchor && anchor.getBoundingClientRect) {
                            showInlineToast(anchor, 'Mic permission required. Allow microphone in site settings.', 1800);
                        }
                    }
                } catch {}
            }
            if (!labelsOk && !hasStored) return false;
            try { await populateDevices({ afterReset: !hasStored }); } catch {}
            try { await ensureActiveMicSelection(reason); } catch {}
            try {
                if (!IS_EMBEDDED && !isRecording && testingMode && (String(reason || '').includes('settings') || PAGE_MODE === 'settings')) {
                    allowMonitoringInit = true;
                    primeAudioContextForGesture(`settings-open:${reason}`);
                    await ensureMonitoring(`settings-open:${reason}`);
                }
            } catch {}
            if (!IS_EMBEDDED) {
                try { notifySettingsIframe('sync-devices'); } catch {}
            }
            return true;
        }

        function hasStoredMicSelection() {
            try {
                for (let i = 1; i <= MAX_MIC_COUNT; i++) {
                    const key = (i === 1) ? 'micDeviceId' : (i === 2) ? 'mic2DeviceId' : `mic${i}DeviceId`;
                    const raw = localStorage.getItem(key);
                    if (raw === null) continue;
                    const v = String(raw || '').trim();
                    if (v && v !== '__off__' && v !== 'OFF') return true;
                }
                return false;
            } catch { return false; }
        }

        async function ensureActiveMicSelection(reason = '', opts = {}) {
            if (!IS_SECURE_OR_LOCAL) return false;
            const forceDefaults = opts && opts.forceDefaults === true;
            let devs = [];
            try { devs = await navigator.mediaDevices.enumerateDevices(); } catch {}
            const mics = (devs || []).filter(d => d?.kind === 'audioinput' && String(d?.deviceId || '').trim());
            mics.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
            const outs = (devs || []).filter(d => d?.kind === 'audiooutput' && String(d?.deviceId || '').trim());
            outs.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
            if (!mics.length) return false;

            // If there is no saved mic selection at all, default to 2 inputs (Mic + Cable) when possible.
            const hasStoredSelection = hasStoredMicSelection();
            const userCountSet = localStorage.getItem('micCountUserSet') === '1';
            let desiredCount = micCount;
            try {
                const pendingLabels = localStorage.getItem('deviceLabelsMissing') === '1';
                const storedCountRaw = localStorage.getItem('micCount');
                const storedCount = Number(storedCountRaw);
                if (!Number.isFinite(storedCount) || pendingLabels || (!userCountSet && !hasStoredSelection)) {
                    desiredCount = (mics.length >= 2) ? 2 : 1;
                } else {
                    desiredCount = storedCount;
                }
            } catch {}
            desiredCount = clampNum(desiredCount, 1, Math.min(MAX_MIC_COUNT, Math.max(1, mics.length)));
            if (desiredCount !== micCount) {
                micCount = desiredCount;
                try { localStorage.setItem('micCount', String(micCount)); } catch {}
                const micCountEl = document.getElementById('mic-count');
                if (micCountEl && 'value' in micCountEl) micCountEl.value = String(micCount);
                try { ensureMicGroups(micCount); } catch {}
            }

            const exists = (id) => !!id && mics.some(d => d.deviceId === id);
            const labelFor = (id) => {
                try { return String(mics.find(d => d.deviceId === id)?.label || '').trim(); } catch { return ''; }
            };
            const isCableLabel = (label) => /(cable output|virtual cable)/i.test(String(label || ''));
            const micKeyFor = (i) => (i === 1) ? 'micDeviceId' : (i === 2) ? 'mic2DeviceId' : `mic${i}DeviceId`;
            const readStoredMic = (i) => {
                if (forceDefaults) return { hasKey: false, isOff: false, value: '' };
                try {
                    const raw = localStorage.getItem(micKeyFor(i));
                    if (raw === null) return { hasKey: false, isOff: false, value: '' };
                    const v = String(raw || '').trim();
                    if (!v || v === '__off__' || v === 'OFF') return { hasKey: true, isOff: true, value: '' };
                    return { hasKey: true, isOff: false, value: v };
                } catch { return { hasKey: false, isOff: false, value: '' }; }
            };
            const storedMics = Array(MAX_MIC_COUNT + 1).fill(null);
            for (let i = 1; i <= MAX_MIC_COUNT; i++) storedMics[i] = readStoredMic(i);
            const hasAnyValidMicKey = storedMics.some(s => s?.value && exists(s.value));
            // Auto-defaults are allowed only when there is no valid configured device.
            const autoSelectionAllowed = forceDefaults || !hasAnyValidMicKey;
            const stored1 = storedMics[1];
            const stored2 = storedMics[2];
            try {
                const labelsPresent = mics.some(d => String(d?.label || '').trim());
                const pendingLabels = localStorage.getItem('deviceLabelsMissing') === '1';
                if (labelsPresent && pendingLabels && autoSelectionAllowed) {
                    if (stored1.isOff) { stored1.hasKey = false; stored1.value = ''; }
                    if (stored2.isOff) { stored2.hasKey = false; stored2.value = ''; }
                    localStorage.removeItem('deviceLabelsMissing');
                }
            } catch {}
            if (forceDefaults) {
                for (let i = 1; i <= MAX_MIC_COUNT; i++) micDeviceIds[i] = null;
            }

            // If there is no stored mic selection, prefer 2 inputs when available (ignore stored micCount).
            if (!userCountSet && autoSelectionAllowed) {
                const prefer = (mics.length >= 2) ? 2 : 1;
                if (prefer !== micCount) {
                    micCount = prefer;
                    try { localStorage.setItem('micCount', String(micCount)); } catch {}
                    const micCountEl = document.getElementById('mic-count');
                    if (micCountEl && 'value' in micCountEl) micCountEl.value = String(micCount);
                    try { ensureMicGroups(micCount); } catch {}
                }
            }

            const norm = (v) => String(v || '').toLowerCase();
            const isDefaultLabel = (label) => /(default|по умолчанию)/i.test(String(label || ''));
            const findMicIdByIncludes = (subs) => {
                try {
                    const s = (subs || []).map(x => String(x || '').toLowerCase()).filter(Boolean);
                    const hit = mics.find(d => s.some(needle => norm(d.label).includes(needle)));
                    return hit?.deviceId || '';
                } catch { return ''; }
            };
            const defaultMicId = (() => {
                try {
                    const hit = mics.find(d => d.deviceId === 'default' || isDefaultLabel(d.label));
                    return hit?.deviceId || '';
                } catch { return ''; }
            })();

            if (forceDefaults) {
                desiredCount = (mics.length >= 2) ? 2 : 1;
                if (desiredCount !== micCount) {
                    micCount = desiredCount;
                    try { localStorage.setItem('micCount', String(micCount)); } catch {}
                    const micCountEl = document.getElementById('mic-count');
                    if (micCountEl && 'value' in micCountEl) micCountEl.value = String(micCount);
                    try { ensureMicGroups(micCount); } catch {}
                }
                const resetDefaults = pickResetDefaults(mics, outs);
                micDeviceIds[1] = resetDefaults.mic1Id || null;
                micDeviceIds[2] = (micCount >= 2) ? (resetDefaults.mic2Id || null) : null;
                for (let i = 3; i <= MAX_MIC_COUNT; i++) micDeviceIds[i] = null;
                for (let i = 1; i <= micCount; i++) {
                    const devKey = (i === 1) ? 'micDeviceId' : (i === 2) ? 'mic2DeviceId' : `mic${i}DeviceId`;
                    try { localStorage.setItem(devKey, micDeviceIds[i] ? String(micDeviceIds[i]) : '__off__'); } catch {}
                    micMonitorOn[i] = !!(resetDefaults.cableId && micDeviceIds[i] === resetDefaults.cableId);
                    try { localStorage.setItem(`mic${i}Monitor`, micMonitorOn[i] ? '1' : '0'); } catch {}
                    const cb = document.getElementById(`mic-${i}-monitor`);
                    if (cb && 'checked' in cb) cb.checked = micMonitorOn[i];
                    micAecNsAgc[i] = !(resetDefaults.cableId && micDeviceIds[i] === resetDefaults.cableId);
                    try { localStorage.setItem(`mic${i}AecNsAgc`, micAecNsAgc[i] ? '1' : '0'); } catch {}
                    const aecCb = document.getElementById(`mic-${i}-aec`);
                    if (aecCb && 'checked' in aecCb) aecCb.checked = micAecNsAgc[i];
                }
                selectedOutputId = resetDefaults.outputId || '__off__';
                try { localStorage.setItem('outputDeviceId', selectedOutputId); } catch {}
                const spkSel = document.getElementById('spk-select');
                if (spkSel && Array.from(spkSel.options).some(o => o.value === selectedOutputId)) {
                    spkSel.value = selectedOutputId;
                }
                try { await populateDevices({ afterReset: false }); } catch {}
                try { syncMicUI(); } catch {}
                return true;
            }

            // Apply stored selections if they exist and are still available.
            if (stored1.value && exists(stored1.value)) micDeviceIds[1] = stored1.value;
            if (stored2.value && exists(stored2.value)) micDeviceIds[2] = stored2.value;
            if (stored1.value && !exists(stored1.value)) { stored1.hasKey = false; stored1.value = ''; }
            if (stored2.value && !exists(stored2.value)) { stored2.hasKey = false; stored2.value = ''; }

            // If any slot is OFF/empty, pick defaults (best-effort).
            let autoPicked = false;
            if (autoSelectionAllowed) {
                const chosen = new Set();
                for (let i = 1; i <= micCount; i++) if (micDeviceIds[i]) chosen.add(micDeviceIds[i]);
                if (!micDeviceIds[1] && mics.length && !stored1.hasKey) {
                    const hinted = defaultMicId || findMicIdByIncludes(['microphone', 'микрофон']);
                    micDeviceIds[1] = exists(hinted) ? hinted : (mics[0]?.deviceId || null);
                    if (micDeviceIds[1]) chosen.add(micDeviceIds[1]);
                    autoPicked = true;
                }
                if (micCount >= 2 && !micDeviceIds[2] && !stored2.hasKey) {
                    const hinted = mics.find(d => isCableLabel(d.label))?.deviceId || '';
                    const picked = exists(hinted) ? hinted : (mics.find(d => !chosen.has(d.deviceId))?.deviceId || null);
                    micDeviceIds[2] = picked;
                    if (micDeviceIds[2]) chosen.add(micDeviceIds[2]);
                    autoPicked = true;
                }

                // If nothing was explicitly stored, prefer Mic 1 = Microphone, Mic 2 = Cable Output (when both exist).
                if (!stored1.hasKey && !stored2.hasKey && micCount >= 2) {
                    const preferredMic = findMicIdByIncludes(['microphone', 'микрофон']);
                    const preferredCable = mics.find(d => isCableLabel(d.label))?.deviceId || '';
                    if (preferredMic && preferredCable && preferredMic !== preferredCable) {
                        micDeviceIds[1] = preferredMic;
                        micDeviceIds[2] = preferredCable;
                        autoPicked = true;
                    }
                }
            }

            // Persist selection for pages without Settings UI (index/FAB-only).
            for (let i = 1; i <= micCount; i++) {
                const devKey = (i === 1) ? 'micDeviceId' : (i === 2) ? 'mic2DeviceId' : `mic${i}DeviceId`;
                try { localStorage.setItem(devKey, micDeviceIds[i] ? String(micDeviceIds[i]) : '__off__'); } catch {}
            }

            // If we just auto-selected defaults, prefer safer monitoring defaults.
            if (autoPicked) {
                const l1 = labelFor(micDeviceIds[1]);
                const l2 = labelFor(micDeviceIds[2]);
                if (micDeviceIds[1]) micMonitorOn[1] = isCableLabel(l1);
                if (micDeviceIds[2]) micMonitorOn[2] = isCableLabel(l2);
                for (let i = 1; i <= micCount; i++) {
                    try { localStorage.setItem(`mic${i}Monitor`, micMonitorOn[i] ? '1' : '0'); } catch {}
                    const cb = document.getElementById(`mic-${i}-monitor`);
                    if (cb && 'checked' in cb) cb.checked = micMonitorOn[i];
                    const label = labelFor(micDeviceIds[i]);
                    if (!hasStoredMicAec(i)) {
                        micAecNsAgc[i] = !isCableLabel(label);
                        try { localStorage.setItem(`mic${i}AecNsAgc`, micAecNsAgc[i] ? '1' : '0'); } catch {}
                        const aecCb = document.getElementById(`mic-${i}-aec`);
                        if (aecCb && 'checked' in aecCb) aecCb.checked = micAecNsAgc[i];
                    }
                }
            }
            for (let i = 1; i <= micCount; i++) {
                if (!micDeviceIds[i]) continue;
                try { autoSetMicAecIfUnset(i, labelFor(micDeviceIds[i]), 'sync-devices'); } catch {}
            }

            // Default Speaker: prefer physical output device (speakers/headphones) when we auto-pick.
            try {
                const outs = (devs || []).filter(d => d?.kind === 'audiooutput' && String(d?.deviceId || '').trim());
                const hasOutputStored = (() => {
                    if (forceDefaults) return false;
                    try {
                        const raw = String(localStorage.getItem('outputDeviceId') || '').trim();
                        return !!raw && raw !== '__off__' && raw !== 'OFF';
                    } catch { return false; }
                })();
                if ((autoPicked || reason.includes('reset')) && outs.length && !hasOutputStored) {
                    const pickOut = outs.find(d => /(speakers|speaker|динамики|динамик)/i.test(String(d.label || ''))) || outs[0];
                    if (pickOut?.deviceId) {
                        selectedOutputId = pickOut.deviceId;
                        try { localStorage.setItem('outputDeviceId', selectedOutputId); } catch {}
                        const spkSel = document.getElementById('spk-select');
                        if (spkSel && Array.from(spkSel.options).some(o => o.value === selectedOutputId)) {
                            spkSel.value = selectedOutputId;
                        }
                    }
                }
            } catch {}

            // Refresh Settings selects if present (labels appear after permission).
            try { await populateDevices({ afterReset: false }); } catch {}
            try { syncMicUI(); } catch {}

            logApi('devices.selected', {
                reason,
                micCount,
                mic1: micDeviceIds[1] ? getSelectedMicLabel(1) : 'OFF',
                mic2: micCount >= 2 && micDeviceIds[2] ? getSelectedMicLabel(2) : 'OFF',
            });
            return true;
        }

        function _stopStreamSafe(s) {
            try { (s?.getTracks?.() || []).forEach(t => { try { t.stop(); } catch {} }); } catch {}
        }

	        async function teardownMonitoringGraph(reason = '', opts = {}) {
	            try { console.log('[audioGraph] teardown', reason); } catch {}
	            stopAnalysisLoop(`teardown:${reason}`);

            try { if (monitorAudioEl) { monitorAudioEl.pause(); monitorAudioEl.srcObject = null; } } catch {}
            try { if (recordStream) _stopStreamSafe(recordStream); } catch {}
            recordStream = null;
            recordDest = null;

            for (let i = 1; i <= MAX_MIC_COUNT; i++) {
                try { _stopStreamSafe(micStreams[i]); } catch {}
                micStreams[i] = null;
                micSources[i] = null;
                micGainNodes[i] = null;
                micAnalysers[i] = null;
                micDataArrays[i] = null;
                micTimeArrays[i] = null;
                micMonitorGainNodes[i] = null;
                micRecordDests[i] = null;
            }

            mixGain = null;
            mixAnalyser = null;
            mixDataArray = null;
            mixTimeArray = null;
            monitorMixGain = null;
            monitorDest = null;
            outAnalyser = null;
            outDataArray = null;
            outTimeArray = null;

            const keepContext = !!opts.keepContext || preserveAudioContext;
            if (!keepContext) {
                try { if (audioContext && audioContext.state !== 'closed') await audioContext.close(); } catch {}
                audioContext = null;
            }

            try {
                const docs = getPanelDocs();
                for (const doc of docs) {
                    for (let i = 1; i <= MAX_MIC_COUNT; i++) {
                        const bar = doc.getElementById(`bar-mic-${i}-level`);
                        if (bar) bar.style.width = '0%';
                        const noiseLabel = doc.getElementById(`mic-${i}-noise-label`);
                        if (noiseLabel) noiseLabel.textContent = 'Noise: — dB · Gate: — dB';
                    }
                    const outBar = doc.getElementById('bar-out');
                    if (outBar) outBar.style.width = '0%';
                }
            } catch {}
        }

        async function rebuildMonitoring(reason = '') {
            if (isRecording) return;
            // Avoid calling teardown outside of ensureMonitoring() lock to prevent races where
            // audioContext becomes null while another ensureMonitoring() iteration is in-flight.
            _monitorSig = '';
            try { await ensureMonitoring(`rebuild:${reason}`); } catch (e) { console.warn('rebuildMonitoring failed', e); }
        }

        // Ensure monitor-only graph is initialized (no recording) so meters work and VOX can trigger
        function applyMonitorGains() {
            try {
                for (let i = 1; i <= micCount; i++) {
                    if (micMonitorGainNodes[i]) micMonitorGainNodes[i].gain.value = micMonitorOn[i] ? 1.0 : 0.0;
                }
            } catch {}
        }
        function applySpeakerOutput() {
            const off = !selectedOutputId || selectedOutputId === '__off__' || selectedOutputId === 'OFF';
            try { if (monitorMixGain) monitorMixGain.gain.value = off ? 0.0 : 1.0; } catch {}
            try {
                if (monitorAudioEl) {
                    monitorAudioEl.muted = off;
                    if (off) monitorAudioEl.pause?.();
                    else monitorAudioEl.play?.();
                }
            } catch {}
        }
        function syncMonitorCheckbox(i) {
            try {
                const docs = getPanelDocs();
                for (const doc of docs) {
                    const cb = doc.getElementById(`mic-${i}-monitor`);
                    if (cb && 'checked' in cb) cb.checked = !!micMonitorOn[i];
                }
            } catch {}
        }
        function syncMonitorFromStorage(key, value) {
            const m = String(key || '').match(/^mic(\d+)Monitor$/);
            if (!m) return false;
            const idx = Number(m[1] || 0);
            if (!Number.isFinite(idx) || idx <= 0 || idx > MAX_MIC_COUNT) return false;
            const on = value === '1' || value === 'true';
            micMonitorOn[idx] = !!on;
            try { if (micMonitorGainNodes[idx]) micMonitorGainNodes[idx].gain.value = micMonitorOn[idx] ? 1.0 : 0.0; } catch {}
            syncMonitorCheckbox(idx);
            return true;
        }
        function syncMicGainFromStorage(key, value) {
            const m = String(key || '').match(/^mic(\d+)Vol$/);
            if (!m) return false;
            const idx = Number(m[1] || 0);
            if (!Number.isFinite(idx) || idx <= 0 || idx > MAX_MIC_COUNT) return false;
            const pctRaw = Number(value);
            if (!Number.isFinite(pctRaw)) return false;
            const pct = clampNum(pctRaw, 0, 200);
            micGainValues[idx] = pct / 100.0;
            try { if (micGainNodes[idx]) micGainNodes[idx].gain.value = micGainValues[idx] || 1.0; } catch {}
            try {
                const docs = getPanelDocs();
                for (const doc of docs) {
                    const volEl = doc.getElementById(`mic-${idx}-vol`);
                    const volLabel = doc.getElementById(`mic-${idx}-vol-label`);
                    if (volEl && 'value' in volEl) volEl.value = String(Math.round(pct));
                    if (volLabel) volLabel.textContent = `${Math.round(pct)}%`;
                }
            } catch {}
            return true;
        }
        function syncMicAecFromStorage(key, value) {
            const m = String(key || '').match(/^mic(\d+)AecNsAgc$/);
            if (!m) return false;
            const idx = Number(m[1] || 0);
            if (!Number.isFinite(idx) || idx <= 0 || idx > MAX_MIC_COUNT) return false;
            const on = value === '1' || value === 'true';
            micAecNsAgc[idx] = !!on;
            try {
                const docs = getPanelDocs();
                for (const doc of docs) {
                    const cb = doc.getElementById(`mic-${idx}-aec`);
                    if (cb && 'checked' in cb) cb.checked = micAecNsAgc[idx];
                }
            } catch {}
            return true;
        }
        function applyAnalysisConfig() {
            analysisFrameMs = lowCpuMode ? 150 : 16;
            const mixCfg = lowCpuMode ? { fft: 256, smooth: 0.9 } : { fft: 1024, smooth: 0.8 };
            const micCfg = lowCpuMode ? { fft: 128, smooth: 0.9 } : { fft: 512, smooth: 0.8 };
            try {
                if (mixAnalyser) { mixAnalyser.fftSize = mixCfg.fft; mixAnalyser.smoothingTimeConstant = mixCfg.smooth; }
                if (outAnalyser) { outAnalyser.fftSize = micCfg.fft; outAnalyser.smoothingTimeConstant = micCfg.smooth; }
                for (let i = 1; i <= micCount; i++) {
                    if (micAnalysers[i]) { micAnalysers[i].fftSize = micCfg.fft; micAnalysers[i].smoothingTimeConstant = micCfg.smooth; }
                }
                mixDataArray = mixAnalyser ? new Uint8Array(mixAnalyser.frequencyBinCount) : null;
                mixTimeArray = mixAnalyser ? new Float32Array(mixAnalyser.fftSize) : null;
                outDataArray = outAnalyser ? new Uint8Array(outAnalyser.frequencyBinCount) : null;
                outTimeArray = outAnalyser ? new Float32Array(outAnalyser.fftSize) : null;
                for (let i = 1; i <= micCount; i++) {
                    micDataArrays[i] = micAnalysers[i] ? new Uint8Array(micAnalysers[i].frequencyBinCount) : null;
                    micTimeArrays[i] = micAnalysers[i] ? new Float32Array(micAnalysers[i].fftSize) : null;
                }
                lastAnalysisFrameMs = 0;
            } catch {}
        }
        let _monitorSig = '';
        let _ensureMonitoringInFlight = null;
        let _ensureMonitoringQueued = false;
        let _ensureMonitoringQueuedReason = '';

        async function ensureMonitoring(reason = '') {
            if (IS_EMBEDDED) {
                try { await teardownMonitoringGraph('embedded-iframe'); } catch {}
                return;
            }
            if (isRecording) return;
            if (!IS_SECURE_OR_LOCAL) return;
            if (!allowMonitoringInit && !testingMode) return;
            if (!audioUnlocked) {
                pendingMonitorInit = true;
                return;
            }

            // Coalesce concurrent calls to avoid mixing AudioNodes from different AudioContexts.
            if (_ensureMonitoringInFlight) {
                _ensureMonitoringQueued = true;
                if (reason && !_ensureMonitoringQueuedReason) _ensureMonitoringQueuedReason = reason;
                return await _ensureMonitoringInFlight;
            }

            _ensureMonitoringQueued = false;
            _ensureMonitoringQueuedReason = '';

            _ensureMonitoringInFlight = (async () => {
                let loopReason = String(reason || '');
                while (true) {
                    await _ensureMonitoringImpl(loopReason);
                    loopReason = '';
                    if (!_ensureMonitoringQueued) break;
                    _ensureMonitoringQueued = false;
                    loopReason = _ensureMonitoringQueuedReason || 'queued';
                    _ensureMonitoringQueuedReason = '';
                }
            })();

            try {
                await _ensureMonitoringInFlight;
            } finally {
                _ensureMonitoringInFlight = null;
            }
        }

        async function _ensureMonitoringImpl(reason = '') {
            try {
                if (isRecording) return;
                if (!IS_SECURE_OR_LOCAL) return;

                try { syncMicUI(); } catch {}

                const activeIdx = [];
                for (let i = 1; i <= micCount; i++) if (micDeviceIds[i]) activeIdx.push(i);
                if (!activeIdx.length) {
                    if (audioContext) {
                        await teardownMonitoringGraph('no-active-mics');
                        _monitorSig = '';
                    }
                    return;
                }

                const sigParts = [`count:${micCount}`];
                for (let i = 1; i <= micCount; i++) sigParts.push(`${i}:${micDeviceIds[i] || ''}`);
                const sig = sigParts.join('|');

	                if (audioContext && sig === _monitorSig && mixAnalyser && outAnalyser && mixGain && monitorMixGain && monitorDest) {
	                    try { applyMonitorGains(); } catch {}
	                    ensureAnalysisLoop(`monitor-sig:${reason}`);
	                    return;
	                }

                await teardownMonitoringGraph(`monitor-rebuild:${reason}`, { keepContext: preserveAudioContext });
                _monitorSig = sig;

                if (!audioContext || audioContext.state === 'closed') {
                    audioContext = new (window.AudioContext || window.webkitAudioContext)();
                }
                try { if (audioContext.state === 'suspended') await audioContext.resume(); } catch {}

                mixGain = audioContext.createGain();
                mixGain.gain.value = 1.0;

                mixAnalyser = audioContext.createAnalyser();
                mixGain.connect(mixAnalyser);

                // Keep graph alive without audible output.
                const silentOut = audioContext.createGain();
                silentOut.gain.value = 0;
                mixAnalyser.connect(silentOut);
                silentOut.connect(audioContext.destination);

                monitorMixGain = audioContext.createGain();
                monitorMixGain.gain.value = 1.0;
                outAnalyser = audioContext.createAnalyser();
                monitorDest = audioContext.createMediaStreamDestination();
                monitorMixGain.connect(outAnalyser);
                outAnalyser.connect(monitorDest);

                if (!monitorAudioEl) {
                    monitorAudioEl = document.createElement('audio');
                    monitorAudioEl.id = 'monitor';
                    monitorAudioEl.autoplay = true;
                    monitorAudioEl.playsInline = true;
                    monitorAudioEl.style.display = 'none';
                    document.body.appendChild(monitorAudioEl);
                }
                monitorAudioEl.srcObject = monitorDest.stream;
                if (monitorAudioEl.setSinkId && selectedOutputId && selectedOutputId !== '__off__') {
                    try { await monitorAudioEl.setSinkId(selectedOutputId); } catch (e) { console.warn('setSinkId failed', e); }
                }
                applySpeakerOutput();

                const pickConstraints = (deviceId, enableAec) => {
                    const audioFlags = enableAec
                        ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
                        : { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
                    return {
                        audio: deviceId
                            ? { deviceId: { exact: deviceId }, ...audioFlags }
                            : { ...audioFlags }
                    };
                };

                for (const i of activeIdx) {
                    let s = null;
                    const devId = micDeviceIds[i];
                    const aecEnabled = !!micAecNsAgc[i];
                    try {
                        logApi('media.getUserMedia', { mic: i, deviceId: devId || '', aecNsAgc: aecEnabled });
                        s = await navigator.mediaDevices.getUserMedia(pickConstraints(devId, aecEnabled));
                    } catch (e) {
                        console.warn(`mic${i} getUserMedia failed, retrying generic`, e?.name || e);
                        try {
                            logApi('media.getUserMedia', { mic: i, deviceId: '', aecNsAgc: aecEnabled, fallback: true });
                            s = await navigator.mediaDevices.getUserMedia({ audio: true });
                        } catch {}
                    }
                    micStreams[i] = s;
                    if (!s) continue;
                    try { logApi('media.getUserMedia.ok', { mic: i, deviceId: devId || '', aecNsAgc: aecEnabled }); } catch {}

                    micSources[i] = audioContext.createMediaStreamSource(s);
                    micGainNodes[i] = audioContext.createGain();
                    micGainNodes[i].gain.value = micGainValues[i] || 1.0;
                    micSources[i].connect(micGainNodes[i]);
                    micGainNodes[i].connect(mixGain);

                    micAnalysers[i] = audioContext.createAnalyser();
                    micGainNodes[i].connect(micAnalysers[i]);

                    micMonitorGainNodes[i] = audioContext.createGain();
                    micMonitorGainNodes[i].gain.value = micMonitorOn[i] ? 1.0 : 0.0;
                    micGainNodes[i].connect(micMonitorGainNodes[i]);
                    micMonitorGainNodes[i].connect(monitorMixGain);
                }

                applyAnalysisConfig();

	                ensureAnalysisLoop(`monitor-build:${reason}`);
	            } catch (e) {
                console.warn('ensureMonitoring failed', e);
                try { await teardownMonitoringGraph('ensureMonitoring-failed'); } catch {}
                _monitorSig = '';
            }
        }
        // Output device for monitoring (speaker)
        (function bindSpeakerSelect() {
            const spkSel = document.getElementById('spk-select');
            if (!spkSel) return;
            spkSel.addEventListener('change', async () => {
                selectedOutputId = String(spkSel.value || '').trim();
                try { logUi('speaker.select', { deviceId: selectedOutputId || '__off__', label: spkSel.selectedOptions?.[0]?.textContent || '' }); } catch {}
                try { localStorage.setItem('outputDeviceId', selectedOutputId || '__off__'); } catch {}
                try {
                    audioUnlocked = true;
                    if (!monitorAudioEl && testingMode) await ensureMonitoring('speaker-change');
                    if (monitorAudioEl?.setSinkId && selectedOutputId && selectedOutputId !== '__off__') {
                        await monitorAudioEl.setSinkId(selectedOutputId);
                    }
                } catch (err) {
                    console.warn('setSinkId', err);
                }
                applySpeakerOutput();
            });
        })();

        // Mic count setting (1..9, default 2)
        (function bindMicCount() {
            const micCountSel = document.getElementById('mic-count');
            if (!micCountSel) return;
            micCountSel.addEventListener('change', async () => {
                try { localStorage.setItem('micCountUserSet', '1'); } catch {}
                try {
                    micCount = clampNum(micCountSel.value, 1, MAX_MIC_COUNT);
                    logUi('mic.count.change', { micCount });
                } catch {}
                try { syncMicUI(); } catch {}
                try { saveParams(); } catch {}
                try { await populateDevices(); } catch {}
                try { renderPerTrackList(); } catch {}
                try { updateCounters(); } catch {}
                if (IS_EMBEDDED) {
                    notifyParentSettingsChange('mic-count', { micCount });
                    return;
                }
                if (isRecording) {
                    try { await restartRecordingFromSettingsChange('mic-count-change'); } catch (e) { console.warn('restart after micCount change', e); }
                } else if (testingMode && allowMonitoringInit && audioContext) {
                    try { await rebuildMonitoring('mic-count-change'); } catch {}
                }
            });
        })();

        // Separate tracks toggle: persist and hot-apply during recording
        (function bindSeparateTracksToggle() {
            const togSepEl = document.getElementById('tog-separate-tracks');
            if (!togSepEl) return;
            togSepEl.addEventListener('change', async () => {
                const nextSeparate = !!togSepEl.checked;
                try { logUi('record.separate.toggle', { enabled: nextSeparate }); } catch {}
                try { saveParams(); } catch {}
                try { renderPerTrackList(); } catch {}
                if (IS_EMBEDDED) {
                    notifyParentSettingsChange('record-separate', { enabled: nextSeparate });
                    return;
                }
                if (isRecording) {
                    recordSeparate = nextSeparate;
                    try { await restartRecordingFromSettingsChange('record-separate'); } catch (e) { console.error('apply separate-tracks', e); }
                } else {
                    recordSeparate = nextSeparate;
                }
            });
        })();

        // Low CPU mode toggle
        (function bindLowCpuMode() {
            const lowEl = document.getElementById('low-cpu-mode');
            if (!lowEl) return;
            lowEl.addEventListener('change', async () => {
                lowCpuMode = !!lowEl.checked;
                try { saveParams(); } catch {}
                try { applyAnalysisConfig(); } catch {}
                if (!isRecording && testingMode) {
                    try { await ensureMonitoring('low-cpu-toggle'); } catch {}
                }
            });
        })();

        // Ask for permission once (if needed) to reveal full device list and labels
        async function ensurePermissionForLabels() {
            try {
                const pre = await navigator.mediaDevices.enumerateDevices();
                const preMics = pre.filter(d => d.kind === 'audioinput');
                const labelsKnown = preMics.some(d => d.label);
                // In insecure contexts or before grant, labels are empty; request temporary access
                if (!labelsKnown) {
                    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
                    tmp.getTracks().forEach(t => t.stop());
                }
            } catch (e) {
                // swallow; populateDevices will log
                console.debug('ensurePermissionForLabels:', e);
            }
        }

	        // Initial population (labels may be empty until permission granted)
	        loadParams();
	        updateParamsUI();
	        initTooltips();
        bindTestingModeControls();
        syncTestingModeUi();
        if (navigator.mediaDevices?.enumerateDevices) {
            // Do NOT request mic permission on page load.
            // Populate selects (labels may be empty until the first Start).
            populateDevices().catch(()=>{});
            // Refresh list automatically when devices change
            try { navigator.mediaDevices.addEventListener('devicechange', populateDevices); } catch {}
        }

	        function applyParamsFromUI() {
	            const v = (id)=>Number(document.getElementById(id)?.value);
	            let minMin = v('inp-min-chunk'); // minutes (UI)
	            let maxMin = v('inp-max-chunk'); // minutes (UI)
	            let newSilMin = v('inp-sil-min');
	            let newSilMax = v('inp-sil-max');
	            let newAutoCloseHours = v('inp-auto-close-hours');
	
	            if (!Number.isFinite(minMin) || minMin <= 0) minMin = secToUiMinutes(MIN_CHUNK_SEC);
	            if (!Number.isFinite(maxMin) || maxMin <= 0) maxMin = secToUiMinutes(MAX_CHUNK_SEC);
	            // Chunk range is intentionally bounded to 3–7 minutes (requested UX default window).
	            const CHUNK_MIN_MIN = 3;
	            const CHUNK_MAX_MIN = 7;
	            const CHUNK_STEP_MIN = 0.5;
	            minMin = clampNum(minMin, CHUNK_MIN_MIN, CHUNK_MAX_MIN);
	            maxMin = clampNum(maxMin, CHUNK_MIN_MIN, CHUNK_MAX_MIN);
	            if (minMin >= maxMin) {
	                if (minMin >= CHUNK_MAX_MIN) {
	                    minMin = CHUNK_MAX_MIN - CHUNK_STEP_MIN;
	                    maxMin = CHUNK_MAX_MIN;
	                } else {
	                    maxMin = Math.min(CHUNK_MAX_MIN, minMin + CHUNK_STEP_MIN);
	                }
	            }
	            let newMinSec = uiMinutesToSec(minMin);
	            let newMaxSec = uiMinutesToSec(maxMin);
	            if (!Number.isFinite(newMinSec) || newMinSec <= 0) newMinSec = MIN_CHUNK_SEC;
	            if (!Number.isFinite(newMaxSec) || newMaxSec <= 0) newMaxSec = MAX_CHUNK_SEC;
	            if (newMinSec >= newMaxSec) newMinSec = Math.max(180, newMaxSec - 30);
	            if (!Number.isFinite(newSilMin) || newSilMin < 0) newSilMin = SILENCE_MIN_SEC;
	            if (!Number.isFinite(newSilMax) || newSilMax < 0) newSilMax = SILENCE_MAX_SEC;
	            if (newSilMin > newSilMax) newSilMin = newSilMax;
	            if (!Number.isFinite(newAutoCloseHours) || newAutoCloseHours < 0) newAutoCloseHours = AUTO_CLOSE_HOURS;
	            // round to 0.5h steps for stable storage
	            newAutoCloseHours = Math.max(0, Math.round(newAutoCloseHours * 2) / 2);
	            MIN_CHUNK_SEC = Math.round(newMinSec);
	            MAX_CHUNK_SEC = Math.round(newMaxSec);
	            SILENCE_MIN_SEC = Math.round(newSilMin);
	            SILENCE_MAX_SEC = Math.round(newSilMax);
	            AUTO_CLOSE_HOURS = newAutoCloseHours;
	            recomputeDerived();
	            // thresholds apply immediately; schedule save for 5s later
	            scheduleParamsSave(5000);
	            try { scheduleAutoCloseForCurrentSession('params'); } catch {}
	        }
	        ['inp-min-chunk','inp-max-chunk','inp-sil-min','inp-sil-max','inp-auto-close-hours','auto-upload'].forEach(id => {
	            const el = document.getElementById(id);
	            if (el) el.addEventListener('change', ()=> { applyParamsFromUI(); updateParamsUI(); });
	        });

        function getMySpeakerName() {
            try { return String(localStorage.getItem('VOICEBOT_ME_DISPLAY') || '').trim(); } catch { return ''; }
        }

        function getSelectedMicLabel(mi) {
            try {
                const sel = document.getElementById(`mic-${mi}-select`);
                if (!sel) return '';
                const opt = sel.selectedOptions?.[0] || sel.options?.[sel.selectedIndex];
                return opt ? String(opt.textContent || '').trim() : '';
            } catch { return ''; }
        }

        function inferSpeakerForLi(li) {
            try {
                const enabledMics = Number(li?.dataset?.enabledMics || 0);
                if (!Number.isFinite(enabledMics) || enabledMics < 2) return '';
                const me = getMySpeakerName();
                if (!me) return '';
                const micIndex = Number(li?.dataset?.mic || 0);
                const label = String(li?.dataset?.deviceLabel || '').trim() || (micIndex ? getSelectedMicLabel(micIndex) : '');
                if (!label) return '';
                // Heuristic: treat physical microphone tracks as "my" voice.
                if (/(microphone|микрофон)/i.test(label)) return me;
                return '';
            } catch {
                return '';
            }
        }

        // --- Upload API ---
        async function uploadBlob(blob, filenameOpt, opts = {}) {
            if (typeof navigator !== 'undefined' && 'onLine' in navigator && navigator.onLine === false) {
                throw new Error('Offline: cannot upload right now. Please try again when back online.');
            }
            let sid = String(opts?.sessionId || '').trim();
            if (!sid) sid = getSessionIdValue();
            if (!sid) { throw new Error('Provide session_id'); }
            if (!AUTH_TOKEN) { throw new Error('Not authenticated'); }
            const allowWhileUnloading = Boolean(opts?.allowWhileUnloading);
            const autoExt = guessAudioExtFromMime(blob?.type || '');
            const name = filenameOpt && typeof filenameOpt === 'string' && filenameOpt.trim()
                ? filenameOpt.trim()
                : `chunk_${new Date().toISOString().replace(/[:.]/g,'-')}${autoExt}`;
            activeUploadCount += 1;
            const fd = new FormData();
            const file = new File([blob], name, { type: blob.type || 'audio/webm' });
            fd.append('audio', file);
            fd.append('session_id', sid);
            try {
                const speaker = String(opts?.speaker || '').trim();
                if (speaker) fd.append('speaker', speaker);
            } catch {}
            try {
                const meta = (opts && typeof opts === 'object' && opts.meta && typeof opts.meta === 'object')
                    ? opts.meta
                    : null;
                if (meta) {
                    for (const [k, v] of Object.entries(meta)) {
                        const key = String(k || '').trim();
                        if (!key) continue;
                        if (v === null || typeof v === 'undefined') continue;
                        if (typeof v === 'number') {
                            if (Number.isFinite(v)) fd.append(key, String(v));
                            continue;
                        }
                        if (typeof v === 'boolean') {
                            fd.append(key, v ? '1' : '0');
                            continue;
                        }
                        const sv = String(v).trim();
                        if (!sv) continue;
                        fd.append(key, sv);
                    }
                }
            } catch {}
            const useKeepalive = Boolean(opts?.keepalive || (isUnloading && !allowWhileUnloading));
            let resp;
            try {
                resp = await fetch(endpoints.uploadAudio(), {
                    method: 'POST',
                    headers: { 'X-Authorization': AUTH_TOKEN, 'Accept': 'application/json' },
                    body: fd,
                    keepalive: useKeepalive
                });
            } catch (e) {
                if (isUnloading && !allowWhileUnloading) {
                    throw new Error('Upload aborted: page is unloading');
                }
                throw e;
            } finally {
                activeUploadCount = Math.max(0, activeUploadCount - 1);
            }
            const text = await resp.text();
            logApi('upload_audio', { status: resp.status, ok: resp.ok, session_id: sid, size: blob?.size || 0 });
            if (!resp.ok) {
                console.error('Upload failed', resp.status, text);
                if (resp.status === 404) {
                    try {
                        const existing = await getSessionStatusById(sid);
                        if (!existing || !isSessionOpen(existing)) {
                            clearActiveSession('upload-404');
                        }
                    } catch (e) {
                        console.warn('[uploadAudio] session status check failed', e);
                    }
                }
                throw new Error(`Upload failed: ${resp.status} ${text}`);
            }
            const data = text ? JSON.parse(text) : {};
            return data;
        }

        // Helper to upload a blob and update corresponding list item UI
        async function uploadBlobForLi(blob, li, upBtn, statusMark, opts = {}) {
          let success = false;
          const silent = !!opts?.silent;
          try {
            if (upBtn) upBtn.disabled = true;
            if (statusMark) statusMark.textContent = '…';
            const fname = (li && li.dataset && li.dataset.filename) ? li.dataset.filename : undefined;
            const speaker = inferSpeakerForLi(li);
            let sessionId = li?.dataset?.sessionId ? String(li.dataset.sessionId).trim() : '';
            if (!sessionId && li && li.ownerDocument) {
                sessionId = getSessionIdValue() || getSessionIdFromDoc(li.ownerDocument);
                if (sessionId && li?.dataset) li.dataset.sessionId = sessionId;
            }
            const uploadOpts = {};
            if (sessionId) uploadOpts.sessionId = sessionId;
            if (speaker) uploadOpts.speaker = speaker;
            try {
                const startedAtMs = Number(li?.dataset?.startedAtMs || 0);
                const endedAtMsData = Number(li?.dataset?.endedAtMs || 0);
                const durationMsData = Number(li?.dataset?.durationMs || 0);
                const startedAtSafe = Number.isFinite(startedAtMs) && startedAtMs > 0 ? Math.round(startedAtMs) : 0;
                const durationSafe = Number.isFinite(durationMsData) && durationMsData > 0 ? Math.round(durationMsData) : 0;
                const endedFromDuration = (startedAtSafe && durationSafe) ? (startedAtSafe + durationSafe) : 0;
                const endedAtSafe = Number.isFinite(endedAtMsData) && endedAtMsData > 0
                    ? Math.round(endedAtMsData)
                    : endedFromDuration;
                const micIdx = Number(li?.dataset?.mic || 0);
                const trackKind = String(li?.dataset?.trackKind || 'chunk').trim();
                const trackKey = String(li?.dataset?.trackKey || '').trim();
                const meta = {};
                if (startedAtSafe > 0) meta.chunk_started_at_ms = startedAtSafe;
                if (endedAtSafe > 0) meta.chunk_ended_at_ms = Math.max(endedAtSafe, startedAtSafe || 0);
                if (durationSafe > 0) meta.chunk_duration_ms = durationSafe;
                if (trackKind) meta.chunk_track_kind = trackKind;
                if (trackKey) meta.chunk_track_key = trackKey;
                if (Number.isFinite(micIdx) && micIdx > 0) meta.chunk_track_mic = micIdx;
                if (Object.keys(meta).length) uploadOpts.meta = meta;
            } catch {}
            // Manual upload should not be blocked by stale unload flags.
            uploadOpts.allowWhileUnloading = true;
            await uploadBlob(blob, fname, uploadOpts);
            success = true;
            if (li && li.dataset) {
                li.dataset.uploaded = '1';
                delete li.dataset.uploadError;
            }
            try { if (typeof li?._onUploadSuccess === 'function') li._onUploadSuccess(); } catch {}
            // Replace the upload button with a checkmark in-place
            if (upBtn) {
                upBtn.textContent = '✓';
                upBtn.title = 'Uploaded (double-click to upload again)';
                upBtn.setAttribute('aria-label','Uploaded');
                upBtn.setAttribute('data-role','uploaded');
                upBtn.disabled = false;
            }
          } catch (e) {
            console.error('Upload error', e);
            const msg = String(e || '');
            const pageHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
            if (pageHidden || (isUnloading && /unload|AbortError|Failed to fetch/i.test(msg))) {
                console.warn('[uploadAudio] suppressed error during unload', msg);
                return success;
            }
            if (li?.dataset) li.dataset.uploadError = msg;
            try { if (typeof li?._onUploadError === 'function') li._onUploadError(msg); } catch {}
            if (statusMark) statusMark.textContent = '✗';
            if (silent) {
                console.warn('Upload error (silent)', e);
            } else {
                alert(String(e));
            }
          } finally {
            if (upBtn && !success) upBtn.disabled = false;
          }
          return success;
        }

        // Build a chunk list item with playback and download controls
        function createChunkListItem(blob, label, speechSeconds, filenameOpt, targetDoc = null) {
          const doc = targetDoc || document;
          let url = URL.createObjectURL(blob);
          const li = doc.createElement('li');
          li._blob = blob;
          try {
              const sid = getSessionIdValue() || getSessionIdFromDoc(doc);
              if (sid) li.dataset.sessionId = sid;
          } catch {}
          let durationSeconds = null;
          try {
            const m = /\((\d+(?:\.\d+)?)s\)\s*$/.exec(String(label || ''));
            if (m) {
              const n = Number(m[1]);
              if (Number.isFinite(n)) durationSeconds = n;
            }
          } catch {}
          // name label
          const name = doc.createElement('span');
          name.textContent = label;
          name.style.flex = '1';
          // size label
          const sizeEl = doc.createElement('small');
          sizeEl.style.color = '#64748b';
          sizeEl.textContent = ` · ${bytesToHuman(blob?.size || 0)}`;
          li._sizeEl = sizeEl;
          // mini audio player like Telegram voice
          const audio = doc.createElement('audio');
          audio.src = url;
          audio.preload = 'metadata';
          audio.style.display = 'none';
          const nameWrap = doc.createElement('span');
          nameWrap.style.display = 'flex';
          nameWrap.style.alignItems = 'center';
          nameWrap.style.gap = '4px';
          nameWrap.appendChild(name);
          nameWrap.appendChild(sizeEl);
          // optional speech seconds pill
          if (typeof speechSeconds === 'number' && isFinite(speechSeconds)) {
            const speechEl = doc.createElement('small');
            speechEl.style.color = '#2563eb';
            const speechLabel = formatMs(speechSeconds * 1000);
            const durLabel = (typeof durationSeconds === 'number' && isFinite(durationSeconds)) ? formatMs(durationSeconds * 1000) : '';
            speechEl.textContent = durLabel ? ` · speech ${speechLabel}/${durLabel}` : ` · speech ${speechLabel}`;
            nameWrap.appendChild(speechEl);
            try {
              li.dataset.speech = String(speechSeconds.toFixed(1));
              li.dataset.speechMs = String(Math.max(0, Math.round(speechSeconds * 1000)));
            } catch {}
          }
          const statusEl = doc.createElement('small');
          statusEl.style.color = '#94a3b8';
          statusEl.textContent = '';
          nameWrap.appendChild(statusEl);
          li._statusEl = statusEl;
          try {
            if (typeof durationSeconds === 'number' && isFinite(durationSeconds)) {
              li.dataset.durationMs = String(Math.max(0, Math.round(durationSeconds * 1000)));
              const speechMs = Number(li.dataset.speechMs || NaN);
              if (Number.isFinite(speechMs) && durationSeconds > 0) {
                const ratio = (speechMs / (durationSeconds * 1000)) * 100;
                li.dataset.speechRatio = String(Math.max(0, Math.min(100, ratio)));
              }
            }
          } catch {}
          li.appendChild(nameWrap);
          li.appendChild(audio);
          // Compact controls
          const player = doc.createElement('div');
          player.style.display = 'flex';
          player.style.alignItems = 'center';
          player.style.gap = '8px';
          const btnToggle = doc.createElement('button');
          btnToggle.className = 'btn';
          btnToggle.textContent = '▶';
          btnToggle.style.minWidth = '36px';
          const barWrap = doc.createElement('div');
          barWrap.style.flex = '1';
          barWrap.style.height = '6px';
          barWrap.style.background = '#e5e7eb';
          barWrap.style.borderRadius = '6px';
          barWrap.style.position = 'relative';
          const barFill = doc.createElement('div');
          barFill.style.position = 'absolute';
          barFill.style.left = '0';
          barFill.style.top = '0';
          barFill.style.bottom = '0';
          barFill.style.width = '0%';
          barFill.style.background = 'linear-gradient(90deg,#60a5fa,#2563eb)';
          barFill.style.borderRadius = '6px';
          barWrap.appendChild(barFill);
          const dur = doc.createElement('small');
          dur.style.color = '#475569';
          dur.textContent = '0:00';
          player.appendChild(btnToggle);
          player.appendChild(barWrap);
          player.appendChild(dur);
          li.appendChild(player);
          // toggle logic
          btnToggle.addEventListener('click', async () => {
            try {
              if (li?.dataset?.corrupt === '1') return;
              if (audio.paused) { await audio.play(); } else { audio.pause(); }
            } catch (e) { console.warn('audio toggle failed', e); }
          });
          audio.addEventListener('play', () => { btnToggle.textContent = '⏸'; });
          audio.addEventListener('pause', () => { btnToggle.textContent = '▶'; });
          audio.addEventListener('ended', () => { btnToggle.textContent = '▶'; barFill.style.width='0%'; });
          audio.addEventListener('timeupdate', () => {
            if (Number.isFinite(audio.duration) && audio.duration > 0) {
              const p = Math.min(100, (audio.currentTime / audio.duration) * 100);
              barFill.style.width = `${p}%`;
              const m = Math.floor(audio.currentTime / 60);
              const s = Math.floor(audio.currentTime % 60);
              dur.textContent = `${m}:${String(s).padStart(2,'0')}`;
            }
          });
          barWrap.addEventListener('click', (ev) => {
            try {
              const rect = barWrap.getBoundingClientRect();
              const x = Math.min(rect.width, Math.max(0, ev.clientX - rect.left));
              const ratio = rect.width > 0 ? x / rect.width : 0;
              if (Number.isFinite(audio.duration) && audio.duration > 0) {
                audio.currentTime = audio.duration * ratio;
              }
            } catch {}
          });
          // Actions on the right
          const actions = doc.createElement('div');
          actions.style.marginLeft = 'auto';
          actions.style.display = 'flex';
          actions.style.gap = '8px';
          // Download button (icon only)
          const btnDownload = doc.createElement('a');
          btnDownload.className = 'btn';
          btnDownload.setAttribute('data-role','download');
          btnDownload.setAttribute('aria-label','Download');
          btnDownload.title = 'Download';
          btnDownload.innerText = '⬇';
          btnDownload.href = url;
          // Try to derive a filename from explicit filename or label
          const preferred = (filenameOpt && typeof filenameOpt === 'string') ? filenameOpt : (label || 'chunk.webm');
          const suggested = preferred.replace(/[^A-Za-z0-9._-]+/g,'_');
          const updateDownloadName = () => {
              const b = li._blob || blob;
              const ext = guessAudioExtFromMime(b?.type || '');
              const hasKnownExt = /\.(webm|ogg|mp4|m4a|aac)$/i.test(suggested);
              const dlName = hasKnownExt ? suggested : `${suggested}${ext}`;
              btnDownload.download = dlName;
              try { li.dataset.filename = dlName; } catch {}
          };
          updateDownloadName();
          actions.appendChild(btnDownload);
          // Upload button (icon only)
          const upBtn = doc.createElement('button');
          upBtn.className = 'btn';
          upBtn.setAttribute('data-role', 'upload');
          upBtn.setAttribute('aria-label', 'Upload');
          upBtn.title = 'Upload';
          upBtn.innerText = '⬆';
          const doUpload = async (force = false) => {
              if (!force && li?.dataset?.uploaded === '1') return;
              await uploadBlobForLi(li._blob || blob, li, upBtn, null);
          };
          upBtn.addEventListener('click', async (event) => {
              if (event && event.detail && event.detail > 1) return;
              await doUpload(false);
          });
          upBtn.addEventListener('dblclick', async () => {
              if (li?.dataset?.uploaded !== '1') return;
              await doUpload(true);
          });
          actions.appendChild(upBtn);
          li.appendChild(actions);

          const clearCorrupt = () => {
              try { if (li?.dataset) { delete li.dataset.corrupt; delete li.dataset.corruptReason; } } catch {}
              try { btnToggle.disabled = false; } catch {}
              try { if (upBtn && upBtn.getAttribute('data-role') === 'upload') upBtn.disabled = false; } catch {}
              try { statusEl.textContent = ''; statusEl.style.color = '#94a3b8'; } catch {}
          };
          const markCorrupt = (reason = '') => {
              try { if (li?.dataset) { li.dataset.corrupt = '1'; if (reason) li.dataset.corruptReason = String(reason); } } catch {}
              try { statusEl.textContent = ' · corrupt'; statusEl.style.color = '#dc2626'; } catch {}
              try { btnToggle.disabled = true; } catch {}
              try { if (upBtn && upBtn.getAttribute('data-role') === 'upload') upBtn.disabled = true; } catch {}
              try { audio.pause(); } catch {}
          };
          const setBlob = (nextBlob, meta = {}) => {
              if (!nextBlob) return;
              try {
                  if (url) URL.revokeObjectURL(url);
              } catch {}
              li._blob = nextBlob;
              url = URL.createObjectURL(nextBlob);
              audio.src = url;
              btnDownload.href = url;
              try { sizeEl.textContent = ` · ${bytesToHuman(nextBlob?.size || 0)}`; } catch {}
              updateDownloadName();
              clearCorrupt();
              try {
                  if (meta && meta.repaired) {
                      const off = Number(meta.offset || 0);
                      statusEl.textContent = Number.isFinite(off) && off > 0 ? ` · repaired (+${off}B)` : ' · repaired';
                      statusEl.style.color = '#f59e0b';
                      if (li?.dataset) {
                          li.dataset.repaired = '1';
                          if (Number.isFinite(off) && off > 0) li.dataset.repairedOffset = String(Math.round(off));
                      }
                  }
              } catch {}
              try { audio.load(); } catch {}
          };

          li._setBlob = setBlob;
          li._markCorrupt = markCorrupt;
          li._clearCorrupt = clearCorrupt;

          audio.addEventListener('error', () => { try { markCorrupt('audio_error'); } catch {} });
          li._validatePromise = validateAndMaybeRepairChunkLi(li, { maxScanBytes: 16384 });
          try { audio.load(); } catch {}
          return { li, upBtn };
        }
        function resolveChunkListTarget() {
            let list = document.getElementById('audio-chunks');
            let doc = document;
            if (!list && IS_EMBEDDED) {
                try {
                    const iframe = window.parent?.document?.querySelector?.('.panel-iframe[src*="monitoring.html"]');
                    const idoc = iframe?.contentDocument;
                    const ilist = idoc?.getElementById('audio-chunks');
                    if (ilist) { list = ilist; doc = idoc; }
                } catch {}
            }
            if (!list && !IS_EMBEDDED) {
                try {
                    const iframe = document.querySelector('.panel-iframe[src*="monitoring.html"]');
                    const idoc = iframe?.contentDocument;
                    const ilist = idoc?.getElementById('audio-chunks');
                    if (ilist) { list = ilist; doc = idoc; }
                } catch {}
            }
            return { list, doc };
        }

        // Auth button
        const btnLogin = document.getElementById('btn-login');
        if (btnLogin) btnLogin.addEventListener('click', () => {
            try {
                const loginEl = document.getElementById('login');
                const passEl = document.getElementById('password');
                const l = loginEl && 'value' in loginEl ? loginEl.value : '';
                const p = passEl && 'value' in passEl ? passEl.value : '';
                localStorage.setItem('voicebot_login', l);
                localStorage.setItem('voicebot_password', p);
            } catch {}
            doLogin();
        });
        // Submit on Enter in login/password fields
        (function initLoginEnter(){
            const loginEl = document.getElementById('login');
            const passEl = document.getElementById('password');
            const handler = (e) => {
                if (e && (e.key === 'Enter' || e.keyCode === 13)) {
                    try { e.preventDefault(); } catch {}
                    doLogin();
                }
            };
            if (loginEl && 'addEventListener' in loginEl) loginEl.addEventListener('keydown', handler);
            if (passEl && 'addEventListener' in passEl) passEl.addEventListener('keydown', handler);
        })();
        async function finishSessionBeforeLogout() {
            try { clearAutoCloseTimer(); } catch {}
            const sidEl = document.getElementById('session-id');
            const snameEl = document.getElementById('session-name');
            const prevSid = sidEl && 'value' in sidEl ? String(sidEl.value || '').trim() : '';

            if (isRecording) {
                try { await stopRecording({ reason: 'logout-finish' }); } catch {}
            }
            if (isPaused) {
                try { isPaused = false; setFabState('idle'); persistVoicebotState('idle'); syncControlState(); } catch {}
                try { const rs = document.getElementById('rec-status'); if (rs) rs.textContent = 'Idle'; } catch {}
            }

            try { await waitForAllPendingUploads({ settleMs: 2000, pollMs: 500 }); } catch {}
            try {
                if (prevSid) {
                    const archiveUpload = await uploadArchiveTrackSegments(prevSid, { reason: 'logout-finish' });
                    if ((archiveUpload?.failed || 0) > 0) {
                        console.warn('[logout] archive upload has failed segments', archiveUpload);
                    }
                }
            } catch {}
            try { if (prevSid) { await sessionDoneBrowser(prevSid, { timeoutMs: 4000 }); } } catch {}

            if (sidEl) sidEl.value = '';
            if (snameEl) { snameEl.value = ''; snameEl.disabled = false; }
            const openedEl = document.getElementById('session-opened-at');
            if (openedEl) openedEl.textContent = '';
            try { CURRENT_SESSION_OPENED_AT_MS = 0; clearAutoCloseTimer(); } catch {}
            try { clearArchiveTrackStore({ keepSession: false }); } catch {}
        }

        // Logout button — Done + clear token (go to unauthorized)
        const btnLogout = document.getElementById('btn-logout');
        if (btnLogout) btnLogout.addEventListener('click', async () => {
            const prevText = btnLogout.textContent;
            btnLogout.disabled = true; btnLogout.textContent = '…';
            try {
                await Promise.resolve(dispatchControlAction('logout'));
            } finally {
                btnLogout.disabled = false; btnLogout.textContent = prevText || '⎋ Logout';
            }
        });
        // Toolbar Logout button — same flow as above
        const btnLogoutApp = document.getElementById('btn-logout-app');
        if (btnLogoutApp) btnLogoutApp.addEventListener('click', async () => {
            const prevText = btnLogoutApp.textContent;
            btnLogoutApp.disabled = true; btnLogoutApp.textContent = '…';
            try {
                await Promise.resolve(dispatchControlAction('logout'));
            } finally {
                btnLogoutApp.disabled = false; btnLogoutApp.textContent = prevText || '⎋ Logout';
            }
        });
        // Session button: manually find and prefill latest session id
        const btnPickSession = document.getElementById('btn-pick-session');
        if (btnPickSession) btnPickSession.addEventListener('click', async () => {
            if (!AUTH_TOKEN) { alert('Not authenticated'); return; }
            const prevText = btnPickSession.textContent;
            setAuthUi(true);
            try {
                if (prevText) btnPickSession.textContent = 'Searching…';
                // If current is closed or missing, pick a new open session
                const sid = await ensureOpenSessionOrPick({ allowPick: true });
                if (!sid) { alert('No open session found'); }
            } catch (e) {
                console.warn('Find Session failed', e);
                alert('Failed to find session: ' + e);
            } finally {
                btnPickSession.textContent = prevText || '🔎Find';
            }
        });
            const openSessionLinkInWindow = (win, url) => {
                try {
                    if (!win || !url) return false;
                    const targetPath = String(win?.location?.pathname || '');
                    const isWebrtcPage = /\/webrtc(\/|$)/.test(targetPath)
                        || /settings\.html$/.test(targetPath)
                        || /monitoring\.html$/.test(targetPath)
                        || /index\.html$/.test(targetPath);
                    if (isWebrtcPage) return false;
                    if (win.history && typeof win.history.pushState === 'function') {
                        const parsed = new URL(String(url), win.location.origin);
                        const targetUrl = `${parsed.pathname}${parsed.search}${parsed.hash}`;
                        win.history.pushState({}, '', targetUrl);
                        win.dispatchEvent(new win.PopStateEvent('popstate'));
                        return true;
                    }
                } catch (e) {
                    console.warn('openSessionLinkInWindow failed', e);
                }
                return false;
            };
            const openSessionLinkInHost = (url) => {
                try {
                    if (!url) return false;
                    return openSessionLinkInWindow(window, url);
                } catch (e) {
                    console.warn('openSessionLinkInHost failed', e);
                }
                return false;
            };
	        const openSessionLinkSameWindow = (sid) => {
	            const safeSid = String(sid || '').trim();
	            if (!safeSid) { alert('Provide session_id'); return; }
                // Use the currently configured base URL (same-origin by default) so dev links stay on dev.
                const baseInput = document.getElementById('base-url');
                const base = (baseInput && 'value' in baseInput ? String(baseInput.value || '').trim() : '') || API_BASE || location.origin;
	            const url = new URL(getMainAppSessionPath(safeSid), base.replace(/\/+$/, '') + '/').toString();
	            try {
                    if (window.top && window.top !== window) {
                        if (openSessionLinkInWindow(window.top, url)) return;
                    }
                    if (openSessionLinkInHost(url)) return;
	            } catch (e) {
	                console.warn('open link failed', e);
	            }
                try {
                    const target = (window.top && window.top !== window) ? window.top : window;
                    target.location.assign(url);
                } catch (e) {
                    console.warn('open link fallback failed', e);
                    try {
                        const target = (window.top && window.top !== window) ? window.top : window;
                        target.location.href = url;
                    } catch {}
                }
	        };
        // Open session public link buttons (bind lazily for FAB popover)
        const bindSessionLinkButtons = () => {
            const btnOpenLink = document.getElementById('btn-open-session-link');
            if (btnOpenLink && !btnOpenLink.dataset.boundOpenLink) {
                btnOpenLink.dataset.boundOpenLink = '1';
                btnOpenLink.addEventListener('click', () => {
                    const sidEl = document.getElementById('session-id');
                    const sid = sidEl && 'value' in sidEl ? String(sidEl.value || '').trim() : '';
                    try { logUi('open-session.click', { source: 'settings', sid }); } catch {}
                    openSessionLinkSameWindow(sid);
                });
            }
            const btnFabOpenLink = document.getElementById('fab-open-session-link');
            if (btnFabOpenLink && !btnFabOpenLink.dataset.boundOpenLink) {
                btnFabOpenLink.dataset.boundOpenLink = '1';
                btnFabOpenLink.addEventListener('click', () => {
                    const fabSidEl = document.getElementById('fab-session-id');
                    const sid = fabSidEl && 'value' in fabSidEl ? String(fabSidEl.value || '').trim() : getSessionIdValue();
                    try { logUi('open-session.click', { source: 'fab', sid }); } catch {}
                    openSessionLinkSameWindow(sid);
                });
            }
        };
        bindSessionLinkButtons();
        // Copy session name button
        const btnCopyName = document.getElementById('btn-copy-session-name');
        if (btnCopyName) btnCopyName.addEventListener('click', async () => {
            const snameEl = document.getElementById('session-name');
            const nm = snameEl && 'value' in snameEl ? String(snameEl.value || '').trim() : '';
            try {
                await navigator.clipboard.writeText(nm);
                showInlineToast(btnCopyName, 'Имя скопировано');
            } catch (e) {
                console.warn('clipboard failed', e);
                prompt('Copy name:', nm);
            }
        });
        // Link inputs: when Session ID changes, fetch name; when Session Name changes, update via API
        (function initSessionInputs(){
            const sidEl = document.getElementById('session-id');
            const snameEl = document.getElementById('session-name');
            const fabSidEl = document.getElementById('fab-session-id');
            const fabNameEl = document.getElementById('fab-session-name');
            let lastSavedName = '';
            let snameTimer = null;
            let fabNameEditing = false;
            let fabNameBeforeEdit = '';
            const getSidValue = () => {
                if (sidEl && 'value' in sidEl) return String(sidEl.value || '').trim();
                if (fabSidEl && 'value' in fabSidEl) return String(fabSidEl.value || '').trim();
                return '';
            };
            const getActiveSidValue = () => {
                if (fabSidEl && 'value' in fabSidEl) {
                    const sid = String(fabSidEl.value || '').trim();
                    if (sid) return sid;
                }
                return String(getActiveSessionIdValue() || '').trim();
            };
            const getCurrentFabProjectMeta = () => {
                const current = document.getElementById('fab-session-project');
                if (!current) return { projectId: '', projectName: '' };
                const projectId = String(current.value || '').trim();
                const projectName = String(current.selectedOptions?.[0]?.textContent || current.dataset?.projectName || '').trim();
                return { projectId, projectName };
            };
            const getNameValue = () => {
                if (snameEl && 'value' in snameEl) return String(snameEl.value || '');
                if (fabNameEl && 'value' in fabNameEl) return String(fabNameEl.value || '');
                return '';
            };
            const syncPageSessionMetaIfMatches = ({ sid, sessionName = undefined, projectId = undefined, projectName = undefined }) => {
                const safeSid = String(sid || '').trim();
                if (!safeSid) return;
                const pageSid = String(getPageSessionIdValue() || '').trim();
                if (!pageSid || pageSid !== safeSid) return;
                if (sessionName !== undefined) setPageSessionNameEverywhere(String(sessionName || ''));
                if (projectId !== undefined || projectName !== undefined) {
                    try {
                        window.dispatchEvent(new CustomEvent('voicebot:active-session-updated', {
                            detail: {
                                session_id: safeSid,
                                session_name: sessionName === undefined ? String(getPageSessionNameValue() || '') : String(sessionName || ''),
                                project_id: String(projectId || ''),
                                project_name: String(projectName || ''),
                                source: 'fab-sync',
                            },
                        }));
                    } catch {}
                }
            };
            const setFabNameEditMode = (inputEl, enabled, opts = {}) => {
                if (!inputEl) return;
                const shouldFocus = opts.focus !== false;
                const selectAll = opts.select !== false;
                fabNameEditing = !!enabled;
                if (fabNameEditing) {
                    fabNameBeforeEdit = String(inputEl.value || '');
                }
                setFabSessionNameEditing(document, fabNameEditing);
                if (fabNameEditing && shouldFocus) {
                    try { inputEl.focus(); } catch {}
                    if (selectAll) {
                        try { inputEl.select(); } catch {}
                    }
                }
            };
            if (sidEl && 'addEventListener' in sidEl) {
                const fetchName = async () => {
	                    if (SUPPRESS_SID_FETCH) return;
                    const sid = sidEl && 'value' in sidEl ? sidEl.value.trim() : '';
	                    if (!snameEl) return;
	                    if (!sid) { try { clearAutoCloseTimer(); CURRENT_SESSION_OPENED_AT_MS = 0; } catch {}; snameEl.disabled = false; return; }
                        // Do not fetch session lists automatically.
                        snameEl.disabled = false;
	                };
                sidEl.addEventListener('change', fetchName);
            }
            const bindFabInputs = () => {
                const currentFabSid = document.getElementById('fab-session-id');
                const currentFabName = document.getElementById('fab-session-name');
                const currentFabProject = document.getElementById('fab-session-project');
                const currentFabNameEdit = document.getElementById('fab-edit-session-name');
                if (currentFabSid && 'addEventListener' in currentFabSid && !currentFabSid.dataset.boundSessionId) {
                    currentFabSid.dataset.boundSessionId = '1';
                    currentFabSid.addEventListener('change', () => {
                        const sid = currentFabSid && 'value' in currentFabSid ? currentFabSid.value.trim() : '';
                        ACTIVE_SESSION_ID = sid;
                        setSessionIdEverywhere(sid);
                        const nm = currentFabName && 'value' in currentFabName ? String(currentFabName.value || '') : '';
                        const meta = getCurrentFabProjectMeta();
                        persistSessionMeta(sid, nm, meta);
                        syncControlState();
                        if (sid) {
                            hydrateActiveSessionProjectMeta(sid).catch(() => {});
                        } else {
                            setSessionProjectEverywhere('', '');
                        }
                    });
                }
                if (currentFabName && 'addEventListener' in currentFabName && !currentFabName.dataset.boundSessionName) {
                    currentFabName.dataset.boundSessionName = '1';
                    setFabSessionNameEditing(document, false);
                    currentFabName.addEventListener('pointerdown', () => {
                        if (fabNameEditing) return;
                        setFabNameEditMode(currentFabName, true);
                    });
                    currentFabName.addEventListener('keydown', (ev) => {
                        if (!ev) return;
                        if (ev.key === 'Escape') {
                            ev.preventDefault();
                            if (fabNameEditing) {
                                currentFabName.value = fabNameBeforeEdit;
                                setFabNameEditMode(currentFabName, false, { focus: false, select: false });
                            }
                            return;
                        }
                        if (ev.key === 'Enter') {
                            ev.preventDefault();
                            const sid = getActiveSidValue();
                            const nm = currentFabName && 'value' in currentFabName ? String(currentFabName.value || '') : '';
                            if (snameTimer) clearTimeout(snameTimer);
                            trySave(sid, nm).finally(() => {
                                setFabNameEditMode(currentFabName, false, { focus: false, select: false });
                            });
                        }
                    });
                    currentFabName.addEventListener('blur', () => {
                        if (!fabNameEditing) return;
                        const sid = getActiveSidValue();
                        const nm = currentFabName && 'value' in currentFabName ? String(currentFabName.value || '') : '';
                        if (snameTimer) clearTimeout(snameTimer);
                        trySave(sid, nm).finally(() => {
                            setFabNameEditMode(currentFabName, false, { focus: false, select: false });
                        });
                    });
                    currentFabName.addEventListener('input', () => {
                        const nm = currentFabName && 'value' in currentFabName ? String(currentFabName.value || '') : '';
                        const sid = getActiveSidValue();
                        setSessionNameEverywhere(nm);
                        persistSessionMeta(sid, nm, getCurrentFabProjectMeta());
                        syncPageSessionMetaIfMatches({ sid, sessionName: nm });
                        if (snameTimer) clearTimeout(snameTimer);
                        snameTimer = setTimeout(()=>{ trySave(sid, nm); }, 1500);
                    });
                }
                if (currentFabNameEdit && 'addEventListener' in currentFabNameEdit && !currentFabNameEdit.dataset.boundSessionNameEdit) {
                    currentFabNameEdit.dataset.boundSessionNameEdit = '1';
                    currentFabNameEdit.addEventListener('click', () => {
                        if (!currentFabName) return;
                        if (fabNameEditing) {
                            const sid = getActiveSidValue();
                            const nm = currentFabName && 'value' in currentFabName ? String(currentFabName.value || '') : '';
                            if (snameTimer) clearTimeout(snameTimer);
                            trySave(sid, nm).finally(() => {
                                setFabNameEditMode(currentFabName, false, { focus: false, select: false });
                            });
                            return;
                        }
                        setFabNameEditMode(currentFabName, true);
                    });
                }
                if (currentFabProject && 'addEventListener' in currentFabProject && !currentFabProject.dataset.boundSessionProject) {
                    currentFabProject.dataset.boundSessionProject = '1';
                    currentFabProject.addEventListener('focus', () => {
                        const selectedId = String(currentFabProject.value || '').trim();
                        const selectedName = String(currentFabProject.selectedOptions?.[0]?.textContent || currentFabProject.dataset?.projectName || '').trim();
                        refreshFabProjectOptions(selectedId, selectedName).catch(() => {});
                    });
                    currentFabProject.addEventListener('change', async () => {
                        const sid = getActiveSidValue();
                        const projectId = String(currentFabProject.value || '').trim();
                        const projectName = String(currentFabProject.selectedOptions?.[0]?.textContent || '').trim();
                        if (!sid) {
                            showFabToast('No active session', 1600);
                            return;
                        }
                        if (!projectId) return;
                        if (!AUTH_TOKEN) {
                            showFabToast('Login required', 1600);
                            return;
                        }
                        try {
                            await updateSessionProjectAPI(sid, projectId);
                            currentFabProject.dataset.projectName = projectName;
                            persistSessionMeta(sid, getActiveSessionNameValue(), { projectId, projectName });
                            setSessionProjectEverywhere(projectId, projectName);
                            syncPageSessionMetaIfMatches({ sid, projectId, projectName });
                            try {
                                window.dispatchEvent(new CustomEvent('voicebot:active-session-updated', {
                                    detail: {
                                        session_id: sid,
                                        session_name: String(getActiveSessionNameValue() || ''),
                                        project_id: projectId,
                                        project_name: projectName,
                                        source: 'fab-project-save',
                                    },
                                }));
                            } catch {}
                            try { invalidateSessionsCache(); } catch {}
                            showFabToast('Project updated', 1200);
                        } catch (e) {
                            console.warn('Update session project failed', e);
                            showFabToast('Project update failed', 1800);
                        }
                    });
                }
                if (currentFabProject && !currentFabProject.dataset.projectsBootstrapped) {
                    currentFabProject.dataset.projectsBootstrapped = '1';
                    const selectedId = String(currentFabProject.value || '').trim();
                    const selectedName = String(currentFabProject.selectedOptions?.[0]?.textContent || currentFabProject.dataset?.projectName || '').trim();
                    refreshFabProjectOptions(selectedId, selectedName).catch(() => {});
                }
                bindSessionLinkButtons();
            };
            bindFabInputs();
            const trySave = async (overrideSid, overrideName) => {
                const sid = String(overrideSid ?? getSidValue()).trim();
                const nm = String(overrideName ?? getNameValue());
                if (nm === lastSavedName) { return; }
                    if (!sid || !AUTH_TOKEN) {
                        // Inline status only, no alerts to avoid keyboard dismissal
                        const statusEl = document.getElementById('session-name-status');
                        if (statusEl) statusEl.textContent = '';
                        return;
                    }
                    const statusEl = document.getElementById('session-name-status');
                    try {
                        if (statusEl) statusEl.textContent = '…';
                        await updateSessionNameAPI(sid, nm);
                        const projectMeta = getCurrentFabProjectMeta();
                        persistSessionMeta(sid, nm, projectMeta);
                        syncPageSessionMetaIfMatches({ sid, sessionName: nm });
                        const activeSidForDispatch = String(getActiveSidValue() || '').trim();
                        if (activeSidForDispatch && activeSidForDispatch === sid) {
                            try {
                                window.dispatchEvent(new CustomEvent('voicebot:active-session-updated', {
                                    detail: {
                                        session_id: sid,
                                        session_name: nm,
                                        project_id: projectMeta.projectId || '',
                                        project_name: projectMeta.projectName || '',
                                        source: 'fab-session-name-save',
                                    },
                                }));
                            } catch {}
                        }
                        if (statusEl) {
                            statusEl.textContent = '✓';
                            setTimeout(()=>{ if (statusEl.textContent === '✓') statusEl.textContent=''; }, 1200);
                        }
                        lastSavedName = nm;
                    } catch (e) {
                        console.warn('Update session name failed', e);
                        if (statusEl) statusEl.textContent = '✗';
                    }
                };
            if (snameEl && 'addEventListener' in snameEl) {
                // Do NOT save on blur to keep iOS keyboard up; keep Enter as explicit save
                snameEl.addEventListener('keydown', (ev)=>{ if (ev && ev.key === 'Enter') { ev.preventDefault(); trySave(); } });
                // Debounce input: 1.5 seconds of inactivity
                snameEl.addEventListener('input', ()=>{
                    const statusEl = document.getElementById('session-name-status');
                    if (statusEl) statusEl.textContent = '…';
                    if (snameTimer) clearTimeout(snameTimer);
                    snameTimer = setTimeout(()=>{ trySave(); }, 1500);
                });
            }
            // FAB inputs may be injected later (popover). Rebind periodically to ensure listeners exist.
            syncSessionMetaFromStorage();
            try {
                if (!window.__voicebotSessionSyncTimer) {
                    window.__voicebotSessionSyncTimer = setInterval(() => {
                        try { syncSessionMetaFromStorage(); } catch {}
                        try { bindFabInputs(); } catch {}
                    }, 250);
                }
            } catch {}
        })();
        // Sync session meta across documents when storage changes (fires in other same-origin frames).
        try {
            window.addEventListener('storage', (e) => {
                const key = String(e?.key || '');
                if (key === SESSION_ID_STORAGE_KEY || key === SESSION_NAME_STORAGE_KEY || key === SESSION_PROJECT_ID_STORAGE_KEY || key === SESSION_PROJECT_NAME_STORAGE_KEY) {
                    syncSessionMetaFromStorage();
                }
            });
        } catch {}
        try {
            window.addEventListener('voicebot:active-session-updated', (event) => {
                try {
                    const detail = event?.detail || {};
                    const hasSessionId = Object.prototype.hasOwnProperty.call(detail, 'session_id');
                    const hasSessionName = Object.prototype.hasOwnProperty.call(detail, 'session_name');
                    const hasProjectId = Object.prototype.hasOwnProperty.call(detail, 'project_id');
                    const hasProjectName = Object.prototype.hasOwnProperty.call(detail, 'project_name');
                    const incomingSessionId = String(detail?.session_id || '').trim();

                    if (hasSessionId) {
                        ACTIVE_SESSION_ID = incomingSessionId;
                        setSessionIdEverywhere(incomingSessionId);
                    }
                    if (hasSessionName) {
                        const incomingSessionName = String(detail?.session_name || '');
                        setSessionNameEverywhere(incomingSessionName);
                        const pageSid = String(getPageSessionIdValue() || '').trim();
                        if (incomingSessionId && pageSid && incomingSessionId === pageSid) {
                            setPageSessionNameEverywhere(incomingSessionName);
                        }
                    }
                    if (hasProjectId || hasProjectName) {
                        const incomingProjectId = String(detail?.project_id || '').trim();
                        const incomingProjectName = String(detail?.project_name || '').trim();
                        setSessionProjectEverywhere(incomingProjectId, incomingProjectName);
                        refreshFabProjectOptions(incomingProjectId, incomingProjectName).catch(() => {});
                    }

                    if (hasSessionId || hasSessionName || hasProjectId || hasProjectName) {
                        const sidToPersist = hasSessionId ? incomingSessionId : String(getActiveSessionIdValue() || '').trim();
                        const nameToPersist = hasSessionName ? String(detail?.session_name || '') : String(getActiveSessionNameValue() || '');
                        const currentProjectEl = document.getElementById('fab-session-project');
                        const fallbackProjectId = String(currentProjectEl?.value || '').trim();
                        const fallbackProjectName = String(currentProjectEl?.selectedOptions?.[0]?.textContent || currentProjectEl?.dataset?.projectName || '').trim();
                        const projectIdToPersist = hasProjectId ? String(detail?.project_id || '').trim() : fallbackProjectId;
                        const projectNameToPersist = hasProjectName ? String(detail?.project_name || '').trim() : fallbackProjectName;
                        persistSessionMeta(sidToPersist, nameToPersist, { projectId: projectIdToPersist, projectName: projectNameToPersist });
                    }
                } catch (e) {
                    console.warn('voicebot:active-session-updated sync failed', e);
                } finally {
                    syncSessionMetaFromStorage();
                }
            });
        } catch {}
        function syncAuthFromStorage() {
            const storedToken = localStorage.getItem('VOICEBOT_AUTH_TOKEN') || '';
            const storedMe = localStorage.getItem('VOICEBOT_ME_ID') || '';
            const storedTelegram = localStorage.getItem(ME_TELEGRAM_ID_KEY) || '';
            if (storedToken) {
                AUTH_TOKEN = storedToken;
                MY_PERFORMER_ID = storedMe;
                MY_TELEGRAM_ID = storedTelegram;
                if (!storedMe) MY_PERFORMER_ID = '';
                if (!storedTelegram) MY_TELEGRAM_ID = '';
                setAuthUi(true);
            } else {
                AUTH_TOKEN = '';
                MY_TELEGRAM_ID = '';
                MY_PERFORMER_ID = '';
                setAuthUi(false);
            }
            syncFabAuthState();
        }

        (async function bootSessionRecovery() {
            try {
                const result = await reconcileStoredSessionState('boot');
                const action = result?.action || 'idle';
                const hasMicPermissionForPassiveRestore = async () => {
                    try {
                        if (navigator.permissions?.query) {
                            const status = await navigator.permissions.query({ name: 'microphone' });
                            const state = String(status?.state || '').toLowerCase();
                            if (state === 'granted') return true;
                            return false;
                        }
                    } catch {}
                    try {
                        const devs = await navigator.mediaDevices?.enumerateDevices?.();
                        if (Array.isArray(devs)) {
                            return devs.some((d) => d?.kind === 'audioinput' && String(d?.label || '').trim());
                        }
                    } catch {}
                    return false;
                };
                const restoreAudioMonitor = async (reason) => {
                    try {
                        if (IS_EMBEDDED) return;
                        const hasPermission = await hasMicPermissionForPassiveRestore();
                        if (!hasPermission) {
                            try {
                                logUi('session.restore.monitor.skip', {
                                    reason,
                                    cause: 'mic-permission-not-granted',
                                });
                            } catch {}
                            return;
                        }
                        allowMonitoringInit = true;
                        try { await ensureMonitoring(`restore-monitor:${reason || 'boot'}`); } catch {}
                    } catch {}
                };
                if (action === 'recording') {
                    if (IS_CHROME) {
                        isRecording = false;
                        isPaused = true;
                        try { persistPausedHint(true); } catch {}
                        setFabState('paused');
                        try { persistVoicebotState('paused'); } catch {}
                        await restoreAudioMonitor('recording');
                        try {
                            logUi('session.restore.chrome-force-paused', { reason: 'audio-gesture-required' });
                            console.info('[audio] Chrome requires user gesture to resume recording after refresh.');
                        } catch {}
                        return;
                    }
                    isPaused = false;
                    isRecording = false;
                    setFabState('recording');
                    try { await startRecording(); } catch (e) {
                        console.warn('restore recording failed, staying paused', e);
                        isRecording = false;
                        isPaused = true;
                        try { persistPausedHint(true); } catch {}
                        setFabState('paused');
                        await restoreAudioMonitor('recording-fallback');
                    }
                } else if (action === 'paused') {
                    isRecording = false;
                    isPaused = true;
                    try { persistPausedHint(true); } catch {}
                    setFabState('paused');
                    await restoreAudioMonitor('paused');
                }
            } catch (e) {
                console.warn('bootSessionRecovery failed', e);
            } finally {
                suppressStatePersist = false;
            }
        })();

        // If token already present, show app
        setAuthUi(Boolean(AUTH_TOKEN));
        syncFabAuthState();

        window.addEventListener('storage', (e) => {
            if (!e || !e.key) return;
            if (e.key === 'VOICEBOT_AUTH_TOKEN' || e.key === 'VOICEBOT_ME_ID' || e.key === ME_TELEGRAM_ID_KEY) {
                syncAuthFromStorage();
            }
            if (e.key === SESSION_ID_STORAGE_KEY || e.key === SESSION_NAME_STORAGE_KEY || e.key === SESSION_PROJECT_ID_STORAGE_KEY || e.key === SESSION_PROJECT_NAME_STORAGE_KEY) {
                syncSessionMetaFromStorage();
            }
            // Settings can be edited inside iframes; keep the active runtime in sync.
            const k = String(e.key || '');
            const isParamKey =
                k === 'minChunkSec' || k === 'maxChunkSec' || k === 'silMinSec' || k === 'silMaxSec'
                || k === 'autoCloseHours' || k === 'minSpeechRatio' || k === 'speechThresholdMode' || k === 'noiseThresholdDb' || k === 'speechDbMargin'
                || k === 'lowCpuMode' || k === 'rawAudioMode' || k === 'aecNsAgcEnabled' || k === 'noiseAvgMs'
                || k === 'autoUpload' || k === 'micCount' || k === 'recSeparate' || k === 'outputDeviceId' || k === 'testingMode'
                || /^mic\d*DeviceId$/.test(k) || /^mic\d+Vol$/.test(k) || /^mic\d+Monitor$/.test(k) || /^mic\d+AecNsAgc$/.test(k);
            if (isParamKey) {
                try { loadParams(); } catch {}
                try { updateParamsUI(); } catch {}
                try { syncMicUI(); } catch {}
                try { updateCounters(); } catch {}
                try { renderPerTrackList(); } catch {}
                if (!IS_EMBEDDED && !isRecording && testingMode) {
                    if (k === 'rawAudioMode' || k === 'aecNsAgcEnabled' || /^mic\d+AecNsAgc$/.test(k)) {
                        allowMonitoringInit = true;
                        try { rebuildMonitoring(`storage:${k}`); } catch {}
                    } else {
                        try { ensureMonitoring(`storage:${k}`); } catch {}
                    }
                }
                if (k === 'testingMode' && !testingMode && !isRecording) {
                    try { teardownMonitoringGraph('testing-mode-off', { keepContext: false }); } catch {}
                    allowMonitoringInit = false;
                }
            }
        });

        window.addEventListener('beforeunload', (e) => {
            const hasOpenSession = hasOpenSessionForUnload();
            const hasUpload = isUploadInFlight() || isFinalUploading || hasPendingUploadsInUi();
            if (!hasOpenSession && !hasUpload) return;
            if (!IS_EMBEDDED) isUnloading = true;
            if (unloadResetTimer) clearTimeout(unloadResetTimer);
            unloadResetTimer = setTimeout(() => {
                if (document.visibilityState === 'visible') resetUnloadingFlag('beforeunload-timeout');
            }, 1500);
            if (isRecording) {
                try { detectPause(true); } catch {}
            }
            if (hasOpenSession || isRecording || isPaused || isFinalUploading) {
                const persistedPaused = isPaused || readPausedHint();
                try { persistVoicebotState(persistedPaused ? 'paused' : 'recording'); } catch {}
            } else {
                try { persistVoicebotState(''); } catch {}
            }
            const sid = getSessionIdValue();
            const sidSuffix = sid ? ` (${sid})` : '';
            const name = getSessionNameValue();
            const nameSuffix = name ? ` (${name})` : '';
            const suffix = `${sidSuffix}${nameSuffix}`.trim();
            const reasons = [];
            if (hasOpenSession) reasons.push('session is open');
            if (hasUpload) reasons.push('upload is in progress');
            const reasonText = reasons.length ? ` (${reasons.join(', ')})` : '';
            const msg = `VoiceBot has unsaved activity${reasonText}${suffix ? ` ${suffix}` : ''}. Are you sure you want to close this tab?`;
            e.preventDefault();
            e.returnValue = msg;
            return msg;
        });
        window.addEventListener('pagehide', () => { if (!IS_EMBEDDED) isUnloading = true; });
        window.addEventListener('pageshow', () => { resetUnloadingFlag('pageshow'); });
        window.addEventListener('focus', () => { resetUnloadingFlag('focus'); });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                if (!IS_EMBEDDED) isUnloading = true;
                return;
            }
            if (document.visibilityState === 'visible') resetUnloadingFlag('visibilitychange');
        });
        // Periodic sync for same-tab iframe auth flows
        setInterval(() => { if (PAGE_MODE === 'index') syncAuthFromStorage(); }, 2000);
        // Auto-login only on index when saved credentials exist and no token yet.
        (function autoLoginIndex() {
            if (PAGE_MODE !== 'index') return;
            if (AUTH_TOKEN) return;
            const savedLogin = localStorage.getItem('voicebot_login') || '';
            const savedPassword = localStorage.getItem('voicebot_password') || '';
            if (savedLogin && savedPassword) {
                doLogin({ login: savedLogin, password: savedPassword, baseUrl: API_BASE });
            }
        })();

        function formatMs(ms) {
            // Format as MM:SS.t (one decimal place)
            ms = Math.max(0, Math.floor(ms));
            const totalSecondsInt = Math.floor(ms / 1000);
            const tenths = Math.floor((ms % 1000) / 100);
            const m = Math.floor(totalSecondsInt / 60);
            const s = totalSecondsInt % 60;
            const mm = String(m).padStart(2, '0');
            const ss = String(s).padStart(2, '0');
            return `${mm}:${ss}.${tenths}`;
        }

	        function getRequiredSilenceMs() {
	            const age = Date.now() - lastChunkStart; // current chunk age
	            // Before min chunk duration: do not allow split by silence
	            if (age < minChunkMs) return Number.POSITIVE_INFINITY;
            // Between min and max: interpolate linearly from silenceMaxMs -> silenceMinMs
            if (maxChunkMs <= minChunkMs) return silenceMinMs;
            if (age <= maxChunkMs) {
                const t = (age - minChunkMs) / (maxChunkMs - minChunkMs); // 0..1
                const required = silenceMaxMs + (silenceMinMs - silenceMaxMs) * t;
                return Math.max(silenceMinMs, Math.min(silenceMaxMs, required));
            }
	            // After max: be very permissive
	            return silenceMinMs;
	        }
	
	        let _perTrackSig = '';
	        function renderPerTrackList() {
	            try {
	                const wrap = document.getElementById('per-track-list');
	                if (!wrap) return;
	                const active = [];
	                for (let mi = 1; mi <= micCount; mi++) {
	                    if (micDeviceIds[mi]) active.push(mi);
	                }
	                const sig = `${micCount}|${active.join(',')}`;
	                if (sig === _perTrackSig && wrap.childElementCount) return;
	                _perTrackSig = sig;
	
	                wrap.innerHTML = '';
	                for (const mi of active) {
	                    const row = document.createElement('div');
                        row.id = `row-mic-${mi}`;
	                    row.className = 'row';
	                    row.style.gap = '8px';
	                    row.style.alignItems = 'center';
	                    row.style.marginTop = '6px';
	
	                    const lbl = document.createElement('small');
	                    lbl.style.minWidth = '56px';
	                    lbl.style.color = '#475569';
	                    lbl.textContent = `Mic ${mi}:`;

                        const sd = document.createElement('small');
                        sd.style.minWidth = '140px';
                        sd.style.whiteSpace = 'nowrap';
                        sd.style.color = '#475569';
                        const sp = document.createElement('span');
                        sp.id = `c-mic-${mi}-speech`;
                        sp.style.color = '#2563eb';
                        sp.textContent = '00:00.0';
                        const sep = document.createElement('span');
                        sep.textContent = '/';
                        const dur = document.createElement('span');
                        dur.id = `c-mic-${mi}-chunk`;
                        dur.textContent = '00:00.0';
                        sd.appendChild(sp);
                        sd.appendChild(sep);
                        sd.appendChild(dur);
	
	                    const barWrap = document.createElement('div');
	                    barWrap.className = 'bar';
	                    barWrap.style.flex = '1';
                        barWrap.style.position = 'relative';
	                    const fillChunk = document.createElement('div');
	                    fillChunk.id = `bar-mic-${mi}-chunk`;
	                    fillChunk.className = 'fill chunk';
	                    fillChunk.style.width = '0%';
                        const fillSpeech = document.createElement('div');
                        fillSpeech.id = `bar-mic-${mi}-speech`;
                        fillSpeech.className = 'fill speech';
                        fillSpeech.style.position = 'absolute';
                        fillSpeech.style.left = '0';
                        fillSpeech.style.top = '0';
                        fillSpeech.style.height = '100%';
                        fillSpeech.style.width = '0%';
                        const tick = document.createElement('div');
                        tick.id = `tick-mic-${mi}`;
                        tick.style.position = 'absolute';
                        tick.style.top = '0';
                        tick.style.bottom = '0';
                        tick.style.width = '2px';
                        tick.style.background = '#475569';
                        tick.style.pointerEvents = 'none';
                        tick.style.left = `${maxChunkMs > 0 ? Math.min(100, (minChunkMs / maxChunkMs) * 100) : 0}%`;
	                    barWrap.appendChild(fillChunk);
	                    barWrap.appendChild(fillSpeech);
                        barWrap.appendChild(tick);
	
	                    row.appendChild(lbl);
                        row.appendChild(sd);
	                    row.appendChild(barWrap);
	                    wrap.appendChild(row);
	                }
	            } catch (e) {
	                console.warn('renderPerTrackList failed', e);
	            }
	        }

        function updateCounters(stateOverride = null) {
            const now = Date.now();
            const shared = stateOverride || null;
            const sharedRec = shared ? !!shared.isRecording : isRecording;
            const sharedPaused = shared ? !!shared.isPaused : isPaused;
            const chunkAge = shared
                ? (shared.chunkAgeMs || 0)
                : (sharedRec ? Math.max(0, now - lastChunkStart) : 0);
            const speechMixed = shared
                ? (shared.speechMsMixed || 0)
                : (sharedRec ? speechMsMixed : 0);
            const speechByKey = shared ? (shared.speechMsByKey || {}) : speechMsByKey;
            const sharedMicCount = shared ? (shared.micCount || 0) : micCount;
            const sharedMicDeviceIds = shared ? (shared.micDeviceIds || {}) : micDeviceIds;
            const maxChunk = shared ? (shared.maxChunkMs || 0) : maxChunkMs;
            const minChunk = shared ? (shared.minChunkMs || 0) : minChunkMs;
            const silMin = shared ? (shared.silenceMinMs || 0) : silenceMinMs;
            const silMax = shared ? (shared.silenceMaxMs || 0) : silenceMaxMs;
            const sDur = shared
                ? (shared.silenceDurMs || 0)
                : (sharedRec && isSilence ? Math.max(0, now - silenceTimer) : 0);
            const sessionElapsed = shared
                ? (shared.sessionElapsedMs || 0)
                : (sharedRec ? getFabElapsedMs() : 0);
            const sessionSpeech = shared
                ? (shared.speechMsTotal || 0)
                : (sharedRec ? speechMsTotal : 0);
            if (!shared && isRecording && maxChunkMs > 0 && chunkAge >= maxChunkMs) {
                detectPause();
            }
            const est = shared ? (shared.requiredSilenceMs || getRequiredSilenceMs()) : getRequiredSilenceMs();
            const elChunk = document.getElementById('c-chunk');
            const elSil = document.getElementById('c-silence');
            const elChunkSpeech = document.getElementById('c-chunk-speech');
            const elReq = document.getElementById('c-silence-req');
            const elNote = document.getElementById('c-silence-note');
            const fabChunkTotal = document.getElementById('fab-chunk-total');
            const fabChunkMic1 = document.getElementById('fab-chunk-mic1-speech');
            const fabChunkMic2 = document.getElementById('fab-chunk-mic2-speech');
            const fabChunkMic2Sep = document.getElementById('fab-chunk-mic2-sep');
            const fabChunkTotalSep = document.getElementById('fab-chunk-total-sep');
            const fabSessionTotal = document.getElementById('fab-session-total');
            const fabSessionSpeech = document.getElementById('fab-session-speech');
            if (elChunk) elChunk.textContent = formatMs(chunkAge);
            if (elSil) elSil.textContent = formatMs(sDur);
            if (elChunkSpeech) elChunkSpeech.textContent = formatMs(speechMixed);
            if (fabChunkTotal) fabChunkTotal.textContent = formatMs(chunkAge);
            if (fabChunkMic1) fabChunkMic1.textContent = formatMs(speechByKey?.[micKey(1)] || 0);
            if (fabChunkMic2) fabChunkMic2.textContent = formatMs(speechByKey?.[micKey(2)] || 0);
            const showMic2 = (sharedMicCount >= 2 && !!sharedMicDeviceIds[2]);
            if (fabChunkMic2Sep) fabChunkMic2Sep.style.display = showMic2 ? '' : 'none';
            if (fabChunkMic2) fabChunkMic2.style.display = showMic2 ? '' : 'none';
            if (fabChunkTotalSep) fabChunkTotalSep.style.display = '';
            if (fabSessionTotal) fabSessionTotal.textContent = formatMs(sessionElapsed);
            if (fabSessionSpeech) fabSessionSpeech.textContent = formatMs(sessionSpeech);
            try {
                const rs = document.getElementById('rec-status');
                if (rs) {
                    rs.textContent = sharedPaused ? 'Paused' : (sharedRec ? 'Recording…' : 'Idle');
                }
            } catch {}
            // Update required silence readout and note
            if (elReq) {
                const estSec = Number.isFinite(est) ? (est / 1000) : SILENCE_MAX_SEC;
                elReq.textContent = `${estSec.toFixed(1)} s`;
            }
            if (elNote) {
                const minSec = Math.round((minChunk || minChunkMs) / 1000);
                elNote.textContent = (chunkAge < (minChunk || minChunkMs)) ? `(after ${secToUiMinutes(minSec)}m)` : '';
            }
            // Bars
            const bChunk = document.getElementById('bar-chunk');
            const bChunkSpeech = document.getElementById('bar-chunk-speech');
            const bSil = document.getElementById('bar-sil');
            // Normalize chunk progress to maxChunkMs
            if (bChunk) bChunk.style.width = `${maxChunk > 0 ? Math.min(100, (chunkAge / maxChunk) * 100) : 0}%`;
            // Speech overlay width relative to max chunk duration
            if (bChunkSpeech) bChunkSpeech.style.width = `${maxChunk > 0 ? Math.min(100, (speechMixed / maxChunk) * 100) : 0}%`;
            // Silence bar: scale to max silence duration; tick shows min silence duration
            if (bSil) bSil.style.width = `${silMax > 0 ? Math.min(100, (sDur / silMax) * 100) : 0}%`;
            const tickSilMin = document.getElementById('tick-sil-min');
            if (tickSilMin && silMax > 0) tickSilMin.style.left = `${Math.min(100, (silMin / silMax) * 100)}%`;
            // Update min tick position relative to max
            const tickMin = document.getElementById('tick-min');
            if (tickMin && maxChunk > 0) tickMin.style.left = `${Math.min(100, ((minChunk || minChunkMs) / maxChunk) * 100)}%`;
            // Per-mic chunk readout
            const per = document.getElementById('per-track');
            if (per) per.style.display = '';
            renderPerTrackList();
            for (let mi = 1; mi <= sharedMicCount; mi++) {
                const row = document.getElementById(`row-mic-${mi}`);
                const enabled = !!sharedMicDeviceIds[mi];
                    if (row) row.style.display = enabled ? '' : 'none';
	                if (!enabled) continue;
                    const d = document.getElementById(`c-mic-${mi}-chunk`);
                    if (d) d.textContent = formatMs(chunkAge);
                const ms = speechByKey?.[micKey(mi)] || 0;
                const wChunk = document.getElementById(`bar-mic-${mi}-chunk`);
                const wSpeech = document.getElementById(`bar-mic-${mi}-speech`);
                const tick = document.getElementById(`tick-mic-${mi}`);
                const t = document.getElementById(`c-mic-${mi}-speech`);
                if (wChunk) wChunk.style.width = `${maxChunk > 0 ? Math.min(100, (chunkAge / maxChunk) * 100) : 0}%`;
                if (wSpeech) wSpeech.style.width = `${maxChunk > 0 ? Math.min(100, (ms / maxChunk) * 100) : 0}%`;
                if (tick && maxChunk > 0) tick.style.left = `${Math.min(100, ((minChunk || minChunkMs) / maxChunk) * 100)}%`;
                if (t) t.textContent = formatMs(ms);
            }
            try {
                const fabMic1 = document.getElementById('fab-mic-1-row');
                if (fabMic1) fabMic1.style.display = (sharedMicCount >= 1 && !!sharedMicDeviceIds[1]) ? 'flex' : 'none';
                const fabMic2 = document.getElementById('fab-mic-2-row');
                if (fabMic2) fabMic2.style.display = (sharedMicCount >= 2 && !!sharedMicDeviceIds[2]) ? 'flex' : 'none';
            } catch {}
        }

	        function avgToDb(avg) {
	            // avg is 0..255 roughly; map to 0..1 then to dBFS range [-60, 0]
	            const norm = Math.max(1e-6, avg / 255);
	            const db = 20 * Math.log10(norm);
            return Math.max(-60, Math.min(0, db));
        }
        function rmsToDb(rms) {
            // rms is 0..1; map to dBFS range [-60, 0]
            const norm = Math.max(1e-6, Number(rms) || 0);
            const db = 20 * Math.log10(norm);
            return Math.max(-60, Math.min(0, db));
        }
        function dbToPct(db) {
            // Map -60..0 dB to 0..100%
            return ((db + 60) / 60) * 100;
        }
        function formatDb(db) { return `${db.toFixed(1)} dB`; }

        // --- Index SPA demo FAB ---
        function initFabDemo() {
            resolveFabRefs();
            if (!fabWrap || !fabButton) return;
            let holdTimer = null;
            let hoverCloseTimer = null;
            let clickTimer = null;
            const clickDelayMs = 260;
            const openMenu = () => { fabWrap.classList.add('fab-open'); };
            const closeMenu = () => { fabWrap.classList.remove('fab-open'); };
            const scheduleClose = () => {
                if (hoverCloseTimer) clearTimeout(hoverCloseTimer);
                hoverCloseTimer = setTimeout(() => closeMenu(), 180);
            };
            const cancelClose = () => {
                if (hoverCloseTimer) { clearTimeout(hoverCloseTimer); hoverCloseTimer = null; }
            };

            const handleFabToggle = () => {
                try {
                    logUi('fab-toggle', { isRecording, isPaused, isFinalUploading });
                    if (!AUTH_TOKEN) {
                        setFabState('unauthorized');
                        showFabToast('Login required\nOpen Settings', 1800);
                        openSidePanel('settings');
                        return;
                    }
                    if (isFinalUploading) {
                        openMenu();
                        return;
                    }
                    if (isRecording) return;
                    // idle/paused: click acts like Rec/Resume
                    dispatchControlAction('rec');
                } catch (e) {
                    console.warn('FAB toggle failed', e);
                }
            };

            fabButton.addEventListener('click', (e) => {
                if (e && e.pointerType && e.pointerType !== 'mouse') return;
                if (isRecording) {
                    if (clickTimer) clearTimeout(clickTimer);
                    clickTimer = setTimeout(() => {
                        clickTimer = null;
                        flashFabCut();
                        dispatchControlAction('cut');
                    }, clickDelayMs);
                    return;
                }
                handleFabToggle();
            });
            fabButton.addEventListener('dblclick', (e) => {
                if (!isRecording) return;
                if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
                dispatchControlAction('done');
            });
            fabButton.addEventListener('pointerdown', (e) => {
                if (e.pointerType === 'mouse') return;
                holdTimer = setTimeout(() => openMenu(), 420);
            });
            fabButton.addEventListener('pointerup', (e) => {
                if (e.pointerType === 'mouse') return;
                if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
                if (!fabWrap.classList.contains('fab-open')) {
                    if (isRecording) {
                        flashFabCut();
                        dispatchControlAction('cut');
                        return;
                    }
                    handleFabToggle();
                }
            });
            fabButton.addEventListener('pointercancel', () => {
                if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
            });
            fabWrap.addEventListener('mouseenter', () => { cancelClose(); openMenu(); });
            fabWrap.addEventListener('mouseleave', () => { scheduleClose(); });
            if (fabMenu) {
                fabMenu.addEventListener('mouseenter', () => { cancelClose(); openMenu(); });
                fabMenu.addEventListener('mouseleave', () => { scheduleClose(); });
            }

            if (fabMenu) {
                fabMenu.addEventListener('click', (e) => {
                    const btn = e.target.closest('[data-action]');
                    if (!btn) return;
                    if (btn.disabled) return;
                    const action = btn.getAttribute('data-action');
                    if (action === 'new' || action === 'rec' || action === 'start' || action === 'record' || action === 'cut' || action === 'pause' || action === 'done') {
                        dispatchControlAction(action);
                    }
                    if (action === 'open-session') {
                        const sid = getSessionIdValue();
                        try { logUi('open-session.click', { source: 'fab-action', sid }); } catch {}
                        if (sid) openSessionLinkSameWindow(sid);
                    }
                    if (action === 'settings' || action === 'monitoring') {
                        const target = btn.getAttribute('data-panel-target') || action;
                        openSidePanel(target);
                    }
                    closeMenu();
                });
            }

            document.addEventListener('click', (e) => {
                if (!fabWrap.contains(e.target)) closeMenu();
            });

            if (panelTabs.length) {
                panelTabs.forEach(btn => {
                    btn.addEventListener('click', () => openSidePanel(btn.dataset.panel));
                });
            }
            if (panelGear) panelGear.addEventListener('click', () => openSidePanel('settings'));
            if (panelClose) panelClose.addEventListener('click', closeSidePanel);
            if (sideBackdrop) sideBackdrop.addEventListener('click', closeSidePanel);
            updateFabStatus(fabWrap.dataset.state || 'idle');
            syncControlState();
            try { updateFabOrbit(); } catch {}
        }

        if (!IS_EMBEDDED) {
            try {
                window.__voicebotControl = (action) => dispatchControlAction(action);
                window.__voicebotState = {
                    get: () => ({
                        state: isFinalUploading
                            ? 'final_uploading'
                            : (!AUTH_TOKEN ? 'unauthorized' : (isPaused ? 'paused' : (isRecording ? 'recording' : 'idle'))),
                        isRecording,
                        isPaused,
                        isFinalUploading,
                    }),
	                    getCounters: () => {
	                        const now = Date.now();
	                        const chunkAgeMs = lastChunkStart ? Math.max(0, now - lastChunkStart) : 0;
	                        const silenceDurMs = isSilence ? Math.max(0, now - silenceTimer) : 0;
	                        const sessionElapsedMs = (isRecording && fabStartTs) ? getFabElapsedMs() : 0;
                        const micIds = {};
                        try {
                            for (let i = 1; i <= MAX_MIC_COUNT; i++) {
                                if (micDeviceIds[i]) micIds[i] = micDeviceIds[i];
                            }
                        } catch {}
                        return {
                            isRecording,
                            isPaused,
                            isFinalUploading,
                            chunkAgeMs,
	                            speechMsMixed,
	                            speechMsTotal,
	                            speechMsByKey,
	                            speechMsByKeyFallback,
	                            maxChunkMs,
                            minChunkMs,
                            silenceMinMs,
                            silenceMaxMs,
                            silenceDurMs,
                            requiredSilenceMs: getRequiredSilenceMs(),
                            sessionElapsedMs,
                            micCount,
                            micDeviceIds: micIds,
                        };
	                    },
	                };
	            } catch {}
	            try {
	                // Repair/validate existing chunk blobs in-place (useful for debugging corrupted headers).
	                // Usage in DevTools: `await __voicebotRepairChunks({ maxScanBytes: 16384 })`
	                window.__voicebotRepairChunks = async (opts = {}) => {
	                    const maxScanBytes = Number.isFinite(opts.maxScanBytes) ? opts.maxScanBytes : 16384;
	                    const list = getChunksList();
	                    const lis = list ? Array.from(list.querySelectorAll('li')) : [];
	                    let ok = 0, repaired = 0, corrupt = 0;
	                    for (const li of lis) {
	                        if (!li || !li._blob) continue;
	                        const res = await validateAndMaybeRepairChunkLi(li, { maxScanBytes });
	                        if (res && res.ok) {
	                            if (res.repaired) repaired += 1;
	                            else ok += 1;
	                        } else {
	                            corrupt += 1;
	                        }
	                    }
	                    const out = { total: lis.length, ok, repaired, corrupt };
	                    console.log('[repairChunks]', out);
	                    return out;
	                };
	            } catch {}
	            try {
	                // Best-effort cleanup hook for host apps (Voicebot React) to unmount the injected widget.
	                window.__voicebotFabCleanup = () => {
	                    try { if (fabOrbitTimer) clearInterval(fabOrbitTimer); } catch {}
	                    try { if (fabStopTimer) clearTimeout(fabStopTimer); } catch {}
	                    try { if (window._counterTimer) clearInterval(window._counterTimer); } catch {}
	                    try { stopAnalysisLoop('fab-cleanup'); } catch {}
	                    try { teardownMonitoringGraph('fab-cleanup'); } catch {}

                    try { document.getElementById('voicebot-fab-style')?.remove?.(); } catch {}
                    try { document.getElementById('fab-wrap')?.remove?.(); } catch {}
                    try { document.getElementById('fab-toast')?.remove?.(); } catch {}
                    try { document.getElementById('side-backdrop')?.remove?.(); } catch {}
                    try { document.getElementById('side-panel')?.remove?.(); } catch {}
                    try { delete document.body.dataset.voicebotFabMounted; } catch {}

                    try { delete window.__voicebotControl; } catch {}
                    try { delete window.__voicebotState; } catch {}
                    try { delete window.__voicebotFabCleanup; } catch {}
                };
            } catch {}
        }

        window.addEventListener('message', (ev) => {
            try {
                if (ev.origin !== location.origin) return;
                const data = ev.data || {};
                if (data.type === 'voicebot-open-session') {
                    if (!data.url) return;
                    if (openSessionLinkInHost(String(data.url || ''))) return;
                    try { location.assign(String(data.url || '')); } catch {}
                    return;
                }
                if (data.type === 'voicebot-control') {
                    if (data.action === 'done') {
                        const doneBtn = document.getElementById('btn-done-button');
                        if (doneBtn) doneBtn.click();
                    }
                    if (data.action === 'new' || data.action === 'rec' || data.action === 'start' || data.action === 'record' || data.action === 'pause' || data.action === 'cut') {
                        dispatchControlAction(data.action);
                    }
                    if (data.action === 'sync-devices') {
                        ensureSettingsDevices('sync-devices').catch(()=>{});
                    }
                    return;
                }
                if (data.type === 'voicebot-settings') {
                    if (!IS_EMBEDDED) {
                        restartRecordingFromSettingsChange(data.action || 'settings-change').catch(()=>{});
                    }
                    return;
                }
            } catch {}
        });

        if (IS_EMBEDDED) {
            try { setInterval(syncControlState, 500); } catch {}
            try {
                setInterval(() => {
                    let shared = null;
                    try { shared = window.parent?.__voicebotState?.getCounters?.(); } catch {}
                    if (shared) updateCounters(shared);
                }, 250);
            } catch {}
        }
        // Cross-frame sync for Settings changes (speaker/monitor/speech threshold)
        if (!IS_EMBEDDED) {
            window.addEventListener('storage', async (ev) => {
                try {
                    const k = String(ev?.key || '');
                    const v = ev?.newValue;
                    let shouldRestart = false;
                    if (!k) return;
                    if (k === 'micCount' || /^mic\\d*DeviceId$/.test(k)) {
                        try { loadParams(); } catch {}
                        try { syncMicUI(); } catch {}
                        try { updateCounters(); } catch {}
                        shouldRestart = true;
                        if (shouldRestart && isRecording) {
                            restartRecordingFromSettingsChange(`storage:${k}`).catch(()=>{});
                        }
                        return;
                    }
                    if (k === 'micCountUserSet') {
                        try { loadParams(); } catch {}
                        try { syncMicUI(); } catch {}
                        try { updateCounters(); } catch {}
                        return;
                    }
                    if (k === 'outputDeviceId') {
                        selectedOutputId = String(v || '').trim() || '__off__';
                        try { await ensureMonitoring('storage-speaker'); } catch {}
                        try {
                            if (monitorAudioEl?.setSinkId && selectedOutputId && selectedOutputId !== '__off__') {
                                await monitorAudioEl.setSinkId(selectedOutputId);
                            }
                        } catch {}
                        applySpeakerOutput();
                        return;
                    }
                    if (k === 'minSpeechRatio') {
                        const raw = Number(v);
                        if (Number.isFinite(raw)) MIN_SPEECH_RATIO = clampNum(raw, 0, 100);
                        return;
                    }
                    if (k === 'speechThresholdMode') {
                        const mode = String(v || '').trim();
                        if (mode === 'manual' || mode === 'dynamic') SPEECH_THRESHOLD_MODE = mode;
                        return;
                    }
                    if (k === 'noiseThresholdDb') {
                        const raw = Number(v);
                        if (Number.isFinite(raw)) NOISE_THRESHOLD_DB = clampNum(raw, -80, -20);
                        return;
                    }
                    if (k === 'speechDbMargin') {
                        const raw = Number(v);
                        if (Number.isFinite(raw)) SPEECH_DB_MARGIN = clampNum(raw, 0, 12);
                        return;
                    }
                    if (k === 'noiseAvgMs') {
                        const raw = Number(v);
                        if (Number.isFinite(raw) && raw >= 0) NOISE_AVG_MS = Math.round(raw);
                        return;
                    }
                    if (syncMonitorFromStorage(k, v)) return;
                    if (syncMicGainFromStorage(k, v)) return;
                    if (syncMicAecFromStorage(k, v)) {
                        if (isRecording) restartRecordingFromSettingsChange(`storage:${k}`).catch(()=>{});
                        return;
                    }
                } catch {}
            });
        }

        if (SHOULD_MOUNT_FAB) {
            ensureFabComponent().then((mounted) => { if (mounted) { initFabDemo(); syncFabAuthState(); } });
        }
