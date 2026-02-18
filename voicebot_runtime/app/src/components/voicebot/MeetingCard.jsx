
import React, { useState, useEffect } from "react";
import { Button, Tooltip, Select, message } from "antd";
import { EditOutlined, PlusOutlined, InfoCircleOutlined, RobotOutlined, DownloadOutlined, MoreOutlined } from "@ant-design/icons";
import dayjs from "dayjs";

import { useVoiceBot } from "../../store/voiceBot";
import { useRequest } from "../../store/request";
import { useMCPRequestStore } from "../../store/mcpRequestStore";
import { useSessionsUI } from "../../store/sessionsUI";
import AddParticipantModal from "./AddParticipantModal";
import AccessUsersModal from "./AccessUsersModal";
import CustomPromptModal from "./CustomPromptModal";
import ProjectSelect from "./ProjectSelect";

import { SESSION_ACCESS_LEVELS, SESSION_ACCESS_LEVELS_NAMES, SESSION_ACCESS_LEVELS_DESCTIPTIONS } from '../../constants/permissions';
import { getMessageCategorizationRows } from "../../utils/categorization";


const MeetingCard = ({ onCustomPromptResult, activeTab }) => {
  const { voiceBotSession, updateSessionName, prepared_projects, persons_list, performers_list, voiceBotMessages, downloadTranscription, runCustomPrompt, getSessionData } = useVoiceBot();
  const { sendMCPCall, waitForCompletion } = useMCPRequestStore();
  const { getAuthToken } = useRequest();
  const { openParticipantModal, openAccessUsersModal, generateSessionTitle } = useSessionsUI();
  const [isEditing, setIsEditing] = useState(false);
  const [localSessionName, setLocalSessionName] = useState(voiceBotSession?.session_name || "");
  const [isNewStarting, setIsNewStarting] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [isRecStarting, setIsRecStarting] = useState(false);
  const [isCutting, setIsCutting] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summarizeDisabledUntil, setSummarizeDisabledUntil] = useState(null);
  const [fabSessionState, setFabSessionState] = useState(() => {
    try { return String(localStorage.getItem("VOICEBOT_STATE") || "").trim(); } catch { return ""; }
  });
  const [fabActiveSessionId, setFabActiveSessionId] = useState(() => {
    try { return String(localStorage.getItem("VOICEBOT_ACTIVE_SESSION_ID") || "").trim(); } catch { return ""; }
  });
  const [messageApi, contextHolder] = message.useMessage();
  const [customPromptModalVisible, setCustomPromptModalVisible] = useState(false);

  // Ant Design icons are baseline-aligned by default; wrap them so they are
  // visually centered inside circle icon-only buttons.
  const circleIconWrapperStyle = { display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 0 };
  const circleIconButtonStyle = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
  const controlButtonBaseStyle = {
    borderRadius: 999,
    minWidth: 92,
    height: 40,
    paddingInline: 16,
    fontWeight: 650,
    letterSpacing: "0.01em",
    borderColor: "rgba(15, 23, 42, 0.12)",
    background: "rgba(15, 23, 42, 0.04)",
    color: "#0f172a",
    boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.72)",
  };
  const controlButtonByAction = {
    new: { background: "rgba(59, 130, 246, 0.10)", borderColor: "rgba(59, 130, 246, 0.22)", color: "#1d4ed8" },
    rec: { background: "rgba(239, 68, 68, 0.10)", borderColor: "rgba(239, 68, 68, 0.22)", color: "#b91c1c" },
    cut: { background: "rgba(15, 23, 42, 0.04)", borderColor: "rgba(15, 23, 42, 0.12)", color: "#64748b" },
    pause: { background: "rgba(234, 179, 8, 0.10)", borderColor: "rgba(234, 179, 8, 0.22)", color: "#a16207" },
    done: { background: "rgba(34, 197, 94, 0.12)", borderColor: "rgba(34, 197, 94, 0.24)", color: "#047857" },
  };
  const controlIconByAction = {
    new: { glyph: "🆕", color: "#1d4ed8" },
    rec: { glyph: "⏺", color: "#dc2626" },
    cut: { glyph: "✂️", color: "#fb7185" },
    pause: { glyph: "⏸️", color: "#0ea5e9" },
    done: { glyph: "✅", color: "#4ade80" },
  };
  const controlButtonStyle = (action, disabled) => (
    disabled
      ? { ...controlButtonBaseStyle, color: "#94a3b8", background: "rgba(15, 23, 42, 0.03)", borderColor: "rgba(15, 23, 42, 0.10)" }
      : { ...controlButtonBaseStyle, ...(controlButtonByAction[action] || {}) }
  );
  const controlLabel = (action, title) => (
    <span className="inline-flex items-center gap-2">
      <span style={{ color: controlIconByAction[action]?.color || "currentColor", lineHeight: 1 }}>
        {controlIconByAction[action]?.glyph || ""}
      </span>
      <span>{title}</span>
    </span>
  );

  useEffect(() => {
    setLocalSessionName(voiceBotSession?.session_name || "");
  }, [voiceBotSession]);

  // Reset summarize UI state only when switching sessions (not on every session_update patch).
  useEffect(() => {
    setIsSummarizing(false);
    setSummarizeDisabledUntil(null);
  }, [voiceBotSession?._id]);

  useEffect(() => {
    if (typeof summarizeDisabledUntil !== 'number') return undefined;
    const remainingMs = summarizeDisabledUntil - Date.now();
    if (remainingMs <= 0) {
      setSummarizeDisabledUntil(null);
      return undefined;
    }
    const timer = setTimeout(() => setSummarizeDisabledUntil(null), remainingMs);
    return () => clearTimeout(timer);
  }, [summarizeDisabledUntil]);

  useEffect(() => {
    const syncFabState = () => {
      try {
        const runtime = window.__voicebotState?.get?.();
        const runtimeState = String(runtime?.state || "").trim();
        const storedState = String(localStorage.getItem("VOICEBOT_STATE") || "").trim();
        setFabSessionState(runtimeState || storedState || "");
      } catch {
        setFabSessionState(String(localStorage.getItem("VOICEBOT_STATE") || "").trim());
      }
      try {
        setFabActiveSessionId(String(localStorage.getItem("VOICEBOT_ACTIVE_SESSION_ID") || "").trim());
      } catch {
        setFabActiveSessionId("");
      }
    };

    syncFabState();

    const onStorage = (ev) => {
      if (!ev?.key) {
        syncFabState();
        return;
      }
      if (
        ev.key === "VOICEBOT_STATE"
        || ev.key === "VOICEBOT_ACTIVE_SESSION_ID"
        || ev.key === "VOICEBOT_ACTIVE_SESSION_NAME"
      ) {
        syncFabState();
      }
    };
    const onActiveSessionUpdated = () => syncFabState();

    window.addEventListener("storage", onStorage);
    window.addEventListener("voicebot:active-session-updated", onActiveSessionUpdated);
    const timer = setInterval(syncFabState, 600);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("voicebot:active-session-updated", onActiveSessionUpdated);
      clearInterval(timer);
    };
  }, []);

  const handleEditClick = () => setIsEditing(true);
  const handleInputChange = (e) => setLocalSessionName(e.target.value);
  const handleInputBlur = async () => {
    setIsEditing(false);
    if (voiceBotSession && localSessionName !== voiceBotSession.session_name) {
      await updateSessionName(voiceBotSession._id, localSessionName);
    }
  };
  const handleInputKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.target.blur();
    }
  };

  const triggerSummarize = async () => {
    if (!voiceBotSession?._id) return;

    // Rate-limit manual summarization attempts from the UI.
    setSummarizeDisabledUntil(Date.now() + 3 * 60 * 1000);

    setIsSummarizing(true);
    messageApi.open({
      key: 'summarize',
      type: 'loading',
      content: 'Запускаю Summarize...',
      duration: 0,
    });

    try {
      const result = await useVoiceBot.getState().triggerSessionReadyToSummarize(voiceBotSession._id);
      const projectAssigned = Boolean(result?.project_assigned);
      messageApi.open({
        key: 'summarize',
        type: 'success',
        content: projectAssigned ? 'Summarize запущен (проект PMO назначен).' : 'Summarize запущен.',
        duration: 4,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Ошибка при запуске Summarize:', error);
      messageApi.open({
        key: 'summarize',
        type: 'error',
        content: `Ошибка запуска Summarize: ${error?.message || error}`,
        duration: 4,
      });
    } finally {
      setIsSummarizing(false);
    }
  };

  const getInitials = (fullName) => {
    if (!fullName) return '';
    const parts = fullName.split(' ');
    if (parts.length === 1) return parts[0]; // Только фамилия

    const surname = parts[0]; // Фамилия
    const initials = parts.slice(1)
      .map(name => name.charAt(0).toUpperCase())
      .join('.');

    return initials ? `${surname} ${initials}.` : surname;
  };

  // Проверяем наличие категоризации в сообщениях
  const hasCategorizationData = () => {
    if (!voiceBotMessages || !Array.isArray(voiceBotMessages)) return false;
    return voiceBotMessages.some(msg =>
      getMessageCategorizationRows(msg).length > 0
    );
  };

  // Функция для получения полного текста транскрипции
  const getFullTranscription = () => {
    if (!voiceBotMessages || !Array.isArray(voiceBotMessages)) return "";

    return voiceBotMessages
      .map(msg => {
        const categorization = getMessageCategorizationRows(msg);
        if (categorization.length > 0) {
          return categorization.map(cat => cat.text).join("\n");
        }
        return "";
      })
      .filter(text => text.length > 0)
      .join("\n\n");
  };

  // Функция для получения полной категоризации
  const getFullCategorization = () => {
    if (!voiceBotMessages || !Array.isArray(voiceBotMessages)) return [];

    return voiceBotMessages
      .filter(msg => getMessageCategorizationRows(msg).length > 0)
      .map(msg => getMessageCategorizationRows(msg))
      .flat();
  };

  // Функция для запуска произвольного промпта
  const handleRunCustomPrompt = async (prompt) => {
    if (!prompt || prompt.trim() === "") {
      message.error("Промпт не может быть пустым");
      return;
    }

    // Определяем какие данные отправлять в зависимости от активного таба
    let inputData;
    let inputType;

    if (activeTab === "1") {
      // Если выбран таб "Транскрипция", отправляем полный текст транскрипции
      inputData = getFullTranscription();
      inputType = "transcription";
      if (!inputData || inputData.trim() === "") {
        message.warning("Транскрипция пуста");
        return;
      }
    } else {
      // Если выбран любой другой таб, отправляем полную категоризацию
      inputData = getFullCategorization();
      inputType = "categorization";
      if (!inputData || inputData.length === 0) {
        message.warning("Категоризация пуста");
        return;
      }
    }

    // Запускаем счетчик секунд
    let seconds = 0;
    const startTime = Date.now();

    const updateMessage = () => {
      seconds = Math.floor((Date.now() - startTime) / 1000);
      messageApi.open({
        key: 'running-prompt',
        type: 'loading',
        content: `Выполняю промпт... (${seconds}с)`,
        duration: 0,
      });
    };

    updateMessage();
    const timerInterval = setInterval(updateMessage, 1000);

    try {
      const result = await runCustomPrompt(prompt, inputData, 'gpt-5', voiceBotSession?._id, inputType);
      clearInterval(timerInterval);

      // Проверяем результат
      if (!result) {
        throw new Error('Не получен ответ от сервера');
      }

      if (result.success === false) {
        throw new Error(result.error || result.details || 'Ошибка при выполнении промпта');
      }

      // Передаем результат в родительский компонент
      if (onCustomPromptResult) {
        onCustomPromptResult(result);
      }

      messageApi.open({
        key: 'running-prompt',
        type: 'success',
        content: 'Промпт успешно выполнен!',
        duration: 2,
      });

      // Закрываем модальное окно после успешного выполнения
      setCustomPromptModalVisible(false);
    } catch (error) {
      console.error('Ошибка при выполнении промпта:', error);

      let errorMessage = 'Ошибка выполнения промпта';
      if (error.message) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }

      messageApi.open({
        key: 'running-prompt',
        type: 'error',
        content: errorMessage,
        duration: 5,
      });
    } finally {
      clearInterval(timerInterval);
    }
  };

  // Функция для генерации заголовка с помощью AI
  const generateAITitle = async () => {
    if (!voiceBotSession?._id || !hasCategorizationData()) return;

    setIsGeneratingTitle(true);
    messageApi.open({
      key: 'generating-title',
      type: 'loading',
      content: 'Генерирую заголовок...',
      duration: 0,
    });

    try {
      const result = await generateSessionTitle(
        voiceBotSession._id,
        getSessionData,
        updateSessionName,
        sendMCPCall,
        waitForCompletion
      );

      if (result.success) {
        setLocalSessionName(result.title);
        messageApi.open({
          key: 'generating-title',
          type: 'success',
          content: 'Заголовок успешно сгенерирован!',
          duration: 2,
        });
      } else {
        messageApi.open({
          key: 'generating-title',
          type: 'error',
          content: result.error || 'Ошибка генерации заголовка',
          duration: 4,
        });
      }
    } catch (error) {
      console.error('Ошибка при генерации заголовка:', error);
      messageApi.open({
        key: 'generating-title',
        type: 'error',
        content: `Ошибка генерации заголовка: ${error.message}`,
        duration: 4,
      });
    } finally {
      setIsGeneratingTitle(false);
    }
  };

  const getSessionProjectMeta = (session) => {
    const projectId = String(session?.project_id || "").trim();
    const project = (prepared_projects || []).find((item) => String(item?._id || "") === projectId);
    const projectName = String(
      project?.name
      || project?.title
      || session?.project?.name
      || session?.project?.title
      || ""
    ).trim();
    return { projectId, projectName };
  };

  const syncFabActiveSessionMeta = ({ sessionId, sessionName, projectId, projectName, source = "activate", force = false }) => {
    try {
      const nextSessionId = String(sessionId || "").trim();
      const nextSessionName = String(sessionName || "");
      const nextProjectId = String(projectId || "").trim();
      const nextProjectName = String(projectName || "");
      const currentSessionId = String(localStorage.getItem("VOICEBOT_ACTIVE_SESSION_ID") || "").trim();
      const currentSessionName = String(localStorage.getItem("VOICEBOT_ACTIVE_SESSION_NAME") || "");
      const currentProjectId = String(localStorage.getItem("VOICEBOT_ACTIVE_SESSION_PROJECT_ID") || "").trim();
      const currentProjectName = String(localStorage.getItem("VOICEBOT_ACTIVE_SESSION_PROJECT_NAME") || "");

      const changed = (
        nextSessionId !== currentSessionId
        || nextSessionName !== currentSessionName
        || nextProjectId !== currentProjectId
        || nextProjectName !== currentProjectName
      );
      if (!changed && !force) return;

      if (nextSessionId) localStorage.setItem("VOICEBOT_ACTIVE_SESSION_ID", nextSessionId);
      else localStorage.removeItem("VOICEBOT_ACTIVE_SESSION_ID");

      if (nextSessionName) localStorage.setItem("VOICEBOT_ACTIVE_SESSION_NAME", nextSessionName);
      else localStorage.removeItem("VOICEBOT_ACTIVE_SESSION_NAME");

      if (nextProjectId) localStorage.setItem("VOICEBOT_ACTIVE_SESSION_PROJECT_ID", nextProjectId);
      else localStorage.removeItem("VOICEBOT_ACTIVE_SESSION_PROJECT_ID");

      if (nextProjectName) localStorage.setItem("VOICEBOT_ACTIVE_SESSION_PROJECT_NAME", nextProjectName);
      else localStorage.removeItem("VOICEBOT_ACTIVE_SESSION_PROJECT_NAME");

      window.dispatchEvent(new CustomEvent("voicebot:active-session-updated", {
        detail: {
          session_id: nextSessionId,
          session_name: nextSessionName,
          project_id: nextProjectId,
          project_name: nextProjectName,
          source,
        },
      }));
    } catch {
      // no-op
    }
  };

  const activateSessionAndSyncFab = async (sessionId) => {
    if (!sessionId) throw new Error("session_id is required");
    const activation = await useVoiceBot.getState().activateSession(sessionId);
    const activeSessionId = String(activation?.session_id || sessionId || "").trim();
    const activeSessionName = String(activation?.session_name || voiceBotSession?.session_name || "").trim();
    const { projectId, projectName } = getSessionProjectMeta(voiceBotSession);

    syncFabActiveSessionMeta({
      sessionId: activeSessionId,
      sessionName: activeSessionName,
      projectId,
      projectName,
      source: "meeting-card",
    });

    return { activeSessionId, activeSessionName, projectId, projectName };
  };

  const applySessionMetaToStore = ({ sessionId, sessionName, projectId }) => {
    const sid = String(sessionId || "").trim();
    if (!sid) return;

    const hasSessionName = sessionName !== undefined;
    const hasProjectId = projectId !== undefined;
    if (!hasSessionName && !hasProjectId) return;

    const patch = {};
    if (hasSessionName) patch.session_name = String(sessionName || "");
    if (hasProjectId) patch.project_id = String(projectId || "").trim();

    useVoiceBot.setState((state) => {
      const nextVoiceBotSession = state.voiceBotSession?._id === sid
        ? { ...state.voiceBotSession, ...patch }
        : state.voiceBotSession;
      const nextVoiceBotSessionsList = Array.isArray(state.voiceBotSessionsList)
        ? state.voiceBotSessionsList.map((session) => (
          session?._id === sid ? { ...session, ...patch } : session
        ))
        : state.voiceBotSessionsList;
      return {
        voiceBotSession: nextVoiceBotSession,
        voiceBotSessionsList: nextVoiceBotSessionsList,
      };
    });

    if (hasSessionName && !isEditing && sid === String(voiceBotSession?._id || "").trim()) {
      setLocalSessionName(String(sessionName || ""));
    }
  };

  useEffect(() => {
    const sessionId = String(voiceBotSession?._id || "").trim();
    if (!sessionId) return;
    if (!fabActiveSessionId || String(fabActiveSessionId).trim() !== sessionId) return;

    const { projectId, projectName } = getSessionProjectMeta(voiceBotSession);
    syncFabActiveSessionMeta({
      sessionId,
      sessionName: String(voiceBotSession?.session_name || ""),
      projectId,
      projectName,
      source: "meeting-card-sync",
    });
  }, [
    voiceBotSession?._id,
    voiceBotSession?.session_name,
    voiceBotSession?.project_id,
    voiceBotSession?.project?.name,
    voiceBotSession?.project?.title,
    prepared_projects,
    fabActiveSessionId,
  ]);

  useEffect(() => {
    const onActiveSessionUpdated = (event) => {
      const detail = event?.detail || {};
      const sessionId = String(detail?.session_id || "").trim();
      const currentId = String(voiceBotSession?._id || "").trim();
      if (!sessionId || !currentId || sessionId !== currentId) return;
      if (String(detail?.source || "") === "meeting-card-sync") return;

      const hasSessionName = Object.prototype.hasOwnProperty.call(detail, "session_name");
      const hasProjectId = Object.prototype.hasOwnProperty.call(detail, "project_id");
      if (!hasSessionName && !hasProjectId) return;

      applySessionMetaToStore({
        sessionId,
        sessionName: hasSessionName ? detail.session_name : undefined,
        projectId: hasProjectId ? detail.project_id : undefined,
      });
    };

    window.addEventListener("voicebot:active-session-updated", onActiveSessionUpdated);
    return () => window.removeEventListener("voicebot:active-session-updated", onActiveSessionUpdated);
  }, [voiceBotSession?._id, isEditing]);

  const runFabControlAction = async ({ action, ensurePageSessionActive = false, fallback = null }) => {
    if (ensurePageSessionActive && voiceBotSession?._id) {
      await activateSessionAndSyncFab(voiceBotSession._id);
    }

    const control = window.__voicebotControl;
    if (typeof control === "function") {
      await Promise.resolve(control(action));
      return { handled: true, via: "fab" };
    }

    if (typeof fallback === "function") {
      await fallback();
      return { handled: true, via: "fallback" };
    }

    return { handled: false, via: "none" };
  };

  const currentSessionId = String(voiceBotSession?._id || "").trim();
  const isThisSessionActiveInFab = Boolean(currentSessionId && fabActiveSessionId && currentSessionId === fabActiveSessionId);
  const normalizedFabState = String(fabSessionState || "").trim().toLowerCase();
  const hasAuthToken = Boolean(getAuthToken?.());
  const fabIsRecording = normalizedFabState === "recording" || normalizedFabState === "cutting";
  const fabIsPaused = normalizedFabState === "paused";
  const fabIsFinalUploading = normalizedFabState === "final_uploading";
  const canNewControl = hasAuthToken && !fabIsFinalUploading && !fabIsRecording;
  const canRecControl = hasAuthToken && !fabIsFinalUploading && !fabIsRecording;
  const canCutControl = hasAuthToken && !fabIsFinalUploading && (fabIsRecording || fabIsPaused);
  const canPauseControl = hasAuthToken && !fabIsFinalUploading && fabIsRecording;
  const canDoneControl = hasAuthToken && !fabIsFinalUploading && Boolean(currentSessionId);
  const sessionVisualState = (() => {
    if (!voiceBotSession?.is_active) return "closed";
    if (!isThisSessionActiveInFab) return "ready";
    if (normalizedFabState === "recording") return "recording";
    if (normalizedFabState === "cutting") return "cutting";
    if (normalizedFabState === "paused") return "paused";
    if (normalizedFabState === "final_uploading") return "finalizing";
    if (normalizedFabState === "error") return "error";
    return "ready";
  })();
  const visualByState = {
    recording: { badgeClass: "is-recording", title: "Recording" },
    cutting: { badgeClass: "is-cutting", title: "Cutting" },
    paused: { badgeClass: "is-paused", title: "Paused" },
    finalizing: { badgeClass: "is-finalizing", title: "Finalizing" },
    error: { badgeClass: "is-error", title: "Error" },
    closed: { badgeClass: "is-closed", title: "Closed" },
    ready: { badgeClass: "is-ready", title: "Ready" },
  };
  const sessionVisual = visualByState[sessionVisualState] || visualByState.ready;
  const controlsBusy = isNewStarting || isRecStarting || isCutting || isPausing || isFinishing;

  const participantNames = Array.isArray(voiceBotSession?.participants)
    ? voiceBotSession.participants.map((participant, index) => {
      if (participant?._id) return participant.name;
      return (
        persons_list.find(p => p._id === participant)?.name
        || participant?.name
        || `Участник ${index + 1}`
      );
    }).filter(Boolean)
    : [];
  const participantsTitle = participantNames.length > 0 ? participantNames.join(", ") : "Участники не указаны";
  const participantsDisplay = participantNames.length > 0
    ? participantNames.map((name) => getInitials(name)).join(" • ")
    : "Не указаны";

  const allowedUsers = Array.isArray(voiceBotSession?.allowed_users) ? voiceBotSession.allowed_users : [];
  const accessSummary = (() => {
    if (voiceBotSession?.access_level === SESSION_ACCESS_LEVELS.PUBLIC) return "Все пользователи проекта";
    if (voiceBotSession?.access_level === SESSION_ACCESS_LEVELS.RESTRICTED) {
      if (!allowedUsers.length) return "Создатель + админы";
      return allowedUsers.map((user, index) => (
        user?._id
          ? (user.email || user.name || `User ${index + 1}`)
          : (
            performers_list?.find(p => p._id === user)?.email
            || performers_list?.find(p => p._id === user)?.name
            || `User ${index + 1}`
          )
      )).join(" • ");
    }
    return "Только создатель";
  })();


  return (
    <>
      {contextHolder}
      <div
        data-record="False"
        className="voice-meeting-glass-card"
      >
        <div className="voice-meeting-header-row">
          <div className="voice-meeting-header-main">
            <div className="voice-meeting-control-field">
              <ProjectSelect
                preparedProjects={prepared_projects}
                placeholder="Проект"
                value={voiceBotSession?.project_id || null}
                className="w-[220px]"
                classNames={{
                  popup: {
                    root: "w-[280px]"
                  }
                }}
                popupMatchSelectWidth={false}
                onChange={async (projectId) => {
                  if (voiceBotSession && projectId !== voiceBotSession.project_id) {
                    try {
                      await useVoiceBot.getState().updateSessionProject(voiceBotSession._id, projectId);
                    } catch (e) {
                      // eslint-disable-next-line no-console
                      console.error('Ошибка при обновлении проекта сессии', e);
                    }
                  }
                }}
              />
            </div>
            <div className="voice-meeting-control-field">
              <Select
                placeholder="Уровень доступа"
                value={voiceBotSession?.access_level ?? SESSION_ACCESS_LEVELS.PRIVATE}
                options={Object.entries(SESSION_ACCESS_LEVELS_NAMES).map(([key, name]) => ({ label: name, value: key }))}
                className="w-[220px]"
                onChange={async (accessLevel) => {
                  if (voiceBotSession && accessLevel !== (voiceBotSession.access_level ?? SESSION_ACCESS_LEVELS.PRIVATE)) {
                    try {
                      await useVoiceBot.getState().updateSessionAccessLevel(voiceBotSession._id, accessLevel);
                    } catch (e) {
                      // eslint-disable-next-line no-console
                      console.error('Ошибка при обновлении уровня доступа сессии', e);
                    }
                  }
                }}
              />
            </div>
            <div className="voice-meeting-title-wrap">
              {isEditing ? (
                <input
                  autoFocus
                  type="text"
                  value={localSessionName}
                  onChange={handleInputChange}
                  onBlur={handleInputBlur}
                  onKeyDown={handleInputKeyDown}
                  className="voice-meeting-title-input"
                  style={{ minWidth: 120 }}
                />
              ) : (
                <div
                  className="voice-meeting-title"
                  onClick={handleEditClick}
                  title="Редактировать название встречи"
                >
                  {voiceBotSession?.session_name || "Без названия"}
                </div>
              )}
              <Tooltip title="Редактировать">
                <Button
                  type="text"
                  shape="circle"
                  style={circleIconButtonStyle}
                  icon={<span style={circleIconWrapperStyle}><EditOutlined style={{ color: "#8ea0b8", fontSize: 16 }} /></span>}
                  onClick={handleEditClick}
                />
              </Tooltip>
              {hasCategorizationData() && (
                <>
                  <Tooltip title="Сгенерировать заголовок с помощью AI">
                    <Button
                      type="text"
                      shape="circle"
                      style={circleIconButtonStyle}
                      loading={isGeneratingTitle}
                      disabled={isGeneratingTitle}
                      icon={<span style={circleIconWrapperStyle}><RobotOutlined style={{ color: "#1677ff", fontSize: 16 }} /></span>}
                      onClick={generateAITitle}
                    />
                  </Tooltip>
                  <Tooltip title="Summarize">
                    <Button
                      type="text"
                      shape="circle"
                      style={circleIconButtonStyle}
                      loading={isSummarizing}
                      disabled={isSummarizing || (typeof summarizeDisabledUntil === 'number' && Date.now() < summarizeDisabledUntil)}
                      icon={<span style={circleIconWrapperStyle}><span style={{ color: "#1677ff", fontSize: 16, fontWeight: 700 }}>∑</span></span>}
                      onClick={triggerSummarize}
                    />
                  </Tooltip>
                </>
              )}
            </div>
          </div>
          <div className="voice-meeting-header-actions">
            <Tooltip title="Запустить произвольный промпт">
              <button
                className="voice-meeting-icon-button"
                onClick={(e) => {
                  e.stopPropagation();
                  setCustomPromptModalVisible(true);
                }}
              >
                <MoreOutlined />
              </button>
            </Tooltip>

            <Tooltip title="Скачать Транскрипцию">
              <button
                className="voice-meeting-icon-button is-success"
                onClick={(e) => {
                  e.stopPropagation();
                  downloadTranscription(voiceBotSession._id);
                }}
              >
                <DownloadOutlined />
              </button>
            </Tooltip>

            {
              !voiceBotSession.is_active && voiceBotSession.to_finalize && !voiceBotSession.is_finalized && !voiceBotSession.is_postprocessing ?
                <Button
                  size="middle"
                  onClick={() => {
                    if (voiceBotSession?._id) {
                      useVoiceBot.getState().postProcessSession(voiceBotSession._id);
                    }
                  }}
                >
                  Постобработка
                </Button> : null
            }
          </div>
        </div>

        <div className="voice-meeting-toolbar-row">
          <Tooltip title={`State: ${sessionVisual.title}`}>
            <div className={`voice-meeting-state-badge ${sessionVisual.badgeClass}`}>
              <div className="voice-meeting-state-icon">
                {sessionVisualState === "recording" && (
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                )}
                {sessionVisualState === "paused" && (
                  <div className="inline-flex items-center justify-center gap-[2px]">
                    <span className="block w-[2px] h-3 bg-amber-500 rounded-sm" />
                    <span className="block w-[2px] h-3 bg-amber-500 rounded-sm" />
                  </div>
                )}
                {sessionVisualState === "cutting" && (
                  <span className="text-[12px] leading-none text-fuchsia-500 font-semibold">✂</span>
                )}
                {sessionVisualState === "finalizing" && (
                  <span className="text-[12px] leading-none text-emerald-500 font-semibold">✓</span>
                )}
                {sessionVisualState === "error" && (
                  <span className="text-[12px] leading-none text-rose-500 font-semibold">!</span>
                )}
                {sessionVisualState === "closed" && (
                  <div className="w-2.5 h-2.5 rounded-[2px] bg-blue-500" />
                )}
                {sessionVisualState === "ready" && (
                  <div className="w-2.5 h-2.5 rounded-full border border-slate-400" />
                )}
              </div>
            </div>
          </Tooltip>
          <div className="voice-meeting-toolbar-buttons">
          <Button
            size="middle"
            loading={isNewStarting}
            disabled={!canNewControl || controlsBusy}
            style={controlButtonStyle("new", !canNewControl || controlsBusy)}
            onClick={async () => {
              if (!canNewControl || controlsBusy) return;
              setIsNewStarting(true);
              try {
                const res = await runFabControlAction({ action: "new" });
                if (res.handled) {
                  messageApi.success("New started");
                } else {
                  messageApi.warning("FAB is unavailable right now.");
                }
              } catch (error) {
                messageApi.error(`New failed: ${error?.message || error}`);
              } finally {
                setIsNewStarting(false);
              }
            }}
          >
            {controlLabel("new", "New")}
          </Button>

          <Button
            size="middle"
            loading={isRecStarting}
            disabled={!canRecControl || controlsBusy}
            style={controlButtonStyle("rec", !canRecControl || controlsBusy)}
            onClick={async () => {
              if (!canRecControl || controlsBusy) return;
              setIsRecStarting(true);
              try {
                const res = await runFabControlAction({ action: "rec", ensurePageSessionActive: true });
                if (res.handled) {
                  messageApi.success("Rec started");
                } else {
                  messageApi.warning("Session activated. Rec is unavailable in FAB right now.");
                }
              } catch (error) {
                messageApi.error(`Rec failed: ${error?.message || error}`);
              } finally {
                setIsRecStarting(false);
              }
            }}
          >
            {controlLabel("rec", "Rec")}
          </Button>

          <Button
            size="middle"
            loading={isCutting}
            disabled={!canCutControl || controlsBusy}
            style={controlButtonStyle("cut", !canCutControl || controlsBusy)}
            onClick={async () => {
              if (!canCutControl || controlsBusy) return;
              setIsCutting(true);
              try {
                const res = await runFabControlAction({ action: "cut" });
                if (!res.handled) {
                  messageApi.warning("FAB is unavailable right now.");
                }
              } catch (error) {
                messageApi.error(`Cut failed: ${error?.message || error}`);
              } finally {
                setIsCutting(false);
              }
            }}
          >
            {controlLabel("cut", "Cut")}
          </Button>

          <Button
            size="middle"
            loading={isPausing}
            disabled={!canPauseControl || controlsBusy}
            style={controlButtonStyle("pause", !canPauseControl || controlsBusy)}
            onClick={async () => {
              if (!canPauseControl || controlsBusy) return;
              setIsPausing(true);
              try {
                const res = await runFabControlAction({ action: "pause" });
                if (!res.handled) {
                  messageApi.warning("FAB is unavailable right now.");
                }
              } catch (error) {
                messageApi.error(`Pause failed: ${error?.message || error}`);
              } finally {
                setIsPausing(false);
              }
            }}
          >
            {controlLabel("pause", "Pause")}
          </Button>

          <Button
            size="middle"
            disabled={!canDoneControl || controlsBusy}
            loading={isFinishing}
            style={controlButtonStyle("done", !canDoneControl || controlsBusy)}
            onClick={async () => {
              if (!canDoneControl || controlsBusy) return;
              if (voiceBotSession?._id) {
                setIsFinishing(true);
                try {
                  await runFabControlAction({
                    action: "done",
                    fallback: async () => {
                      await useVoiceBot.getState().finishSession(voiceBotSession._id);
                    },
                  });
                } finally {
                  setIsFinishing(false);
                }
              }
            }}
          >
            {controlLabel("done", "Done")}
          </Button>
          </div>
        </div>

        <div className="voice-meeting-meta-row">
          <div className="voice-meeting-meta-chip">
            <span className="voice-meeting-meta-label">Создано</span>
            <span className="voice-meeting-meta-value">
              {dayjs(voiceBotSession?.created_at).format("DD.MM.YYYY HH:mm")}
            </span>
          </div>

          <div className="voice-meeting-meta-chip">
            <span className="voice-meeting-meta-label">Session ID</span>
            <span className="voice-meeting-meta-value">{voiceBotSession?._id || "N/A"}</span>
          </div>

          <div className="voice-meeting-meta-chip voice-meeting-meta-chip-grow">
            <span className="voice-meeting-meta-label">Участники</span>
            <Tooltip title={participantsTitle}>
              <span className="voice-meeting-meta-value">{participantsDisplay}</span>
            </Tooltip>
            <Tooltip title="Добавить участника">
              <Button
                type="text"
                shape="circle"
                className="mt-[-2px] flex-shrink-0"
                icon={<PlusOutlined style={{ color: "rgba(128,128,128,0.9)", fontSize: 12 }} />}
                onClick={() => openParticipantModal(voiceBotSession?._id, voiceBotSession?.participants || [])}
              />
            </Tooltip>
          </div>

          <div className="voice-meeting-meta-chip voice-meeting-meta-chip-grow">
            <span className="voice-meeting-meta-label">Доступ</span>
            <Tooltip title={SESSION_ACCESS_LEVELS_DESCTIPTIONS[voiceBotSession?.access_level ?? SESSION_ACCESS_LEVELS.PRIVATE]}>
              <span className="voice-meeting-meta-value">{accessSummary}</span>
            </Tooltip>
            {voiceBotSession?.access_level === SESSION_ACCESS_LEVELS.RESTRICTED && (
              <Tooltip title="Управлять доступом">
                <Button
                  type="text"
                  shape="circle"
                  className="mt-[-2px]"
                  icon={<PlusOutlined style={{ color: "rgba(128,128,128,0.9)", fontSize: 12 }} />}
                  onClick={() => openAccessUsersModal(voiceBotSession?._id, voiceBotSession?.allowed_users || [])}
                />
              </Tooltip>
            )}
          </div>
        </div>

        {/* Модальное окно для добавления участников */}
        <AddParticipantModal />

        {/* Модальное окно для управления доступом к сессии */}
        <AccessUsersModal />

        {/* Модальное окно для запуска произвольного промпта */}
        <CustomPromptModal
          visible={customPromptModalVisible}
          onCancel={() => setCustomPromptModalVisible(false)}
          onRun={handleRunCustomPrompt}
        />
      </div>
    </>
  );
}


export default MeetingCard;
