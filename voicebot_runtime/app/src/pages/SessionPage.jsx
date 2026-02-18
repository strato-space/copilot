import React from "react";
import { Button, Result, Tooltip, Tabs, Spin } from "antd";
import { ExclamationCircleOutlined, MoonOutlined, SunOutlined } from "@ant-design/icons";
import MeetingCard from "../components/voicebot/MeetingCard";
import WidgetsPanel from "../components/voicebot/WidgetsPanel";
import Categorization from "../components/voicebot/Categorization";
import PostprocessedQuestions from "../components/voicebot/PostprocessedQuestions";
import SessionStatusWidget from "../components/voicebot/SessionStatusWidget";
import TasksTable from "../components/voicebot/TasksTable";
import SessionLog from "../components/voicebot/SessionLog";
import Screenshort from "../components/voicebot/Screenshort";


import Transcription from "../components/voicebot/Transcription";
import Summary from "../components/voicebot/Summary";
import TicketsPreviewModal from "../components/voicebot/TicketsPreviewModal";
import CustomPromptResult from "../components/voicebot/CustomPromptResult";

import RequireAuth from "../components/RequireAuth";
import { useAuthUser } from "../store/AuthUser";
import { useNavigate, useParams } from "react-router-dom";
import { useVoiceBot } from "../store/voiceBot";
import { useCurrentUserPermissions } from '../store/permissions';
import { PERMISSIONS } from "../constants/permissions";

const VoiceBotPage = () => {
  const THEME_STORAGE_KEY = "VOICEBOT_UI_THEME";
  const {
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    hasRole,
    hasAnyRole,
    user
  } = useCurrentUserPermissions();

  const { isAuth } = useAuthUser();
  const { sessionId } = useParams();
  const {
    fetchVoiceBotSession,
    voiceBotSession,
    voiceBotMessages,
    voiceMesagesData,
    sessionAttachments,
    prepared_projects,
    fetchPreparedProjects,
    sessionLoadStatus,
    sessionLoadError
  } = useVoiceBot();
  const navigate = useNavigate();
  const [customPromptResult, setCustomPromptResult] = React.useState(null);
  const [activeTab, setActiveTab] = React.useState("2");
  const [themeMode, setThemeMode] = React.useState(() => {
    try {
      const stored = String(window.localStorage.getItem(THEME_STORAGE_KEY) || "").trim().toLowerCase();
      if (stored === "dark" || stored === "light") return stored;
      return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
    } catch {
      return "light";
    }
  });

  React.useEffect(() => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch {
      // no-op
    }
    document.documentElement.setAttribute("data-voice-theme", themeMode);
    return () => {
      document.documentElement.removeAttribute("data-voice-theme");
    };
  }, [themeMode]);

  React.useEffect(() => {
    if (isAuth) {
      fetchVoiceBotSession(sessionId);
    }
  }, [isAuth, sessionId]);

  React.useEffect(() => {
    if (!prepared_projects) fetchPreparedProjects()
  }, [])

  // Загружаем сохраненный результат промпта из сессии
  React.useEffect(() => {
    if (voiceBotSession?.custom_prompt_run) {
      setCustomPromptResult(voiceBotSession.custom_prompt_run.result);
    }
  }, [voiceBotSession])

  if (sessionLoadStatus === "not_found") {
    const requestedSessionId = String(sessionId || "").trim();
    const errorTitle = "Сессия недоступна в текущем runtime (prod/dev mismatch)";
    return (
      <div className={`voice-session-shell ${themeMode === "dark" ? "theme-dark" : "theme-light"}`}>
        <div className="voice-session-shell-bg" />
        <div style={{ width: "100%", margin: "0 auto", padding: "40px", display: "flex", justifyContent: "center", alignItems: "center", minHeight: "300px", position: "relative", zIndex: 1 }}>
          <Result
            status="warning"
            icon={<ExclamationCircleOutlined />}
            title={errorTitle}
            subTitle={requestedSessionId ? `Сессия ${requestedSessionId} недоступна в текущем окружении.` : "Сессия недоступна в текущем окружении."}
            extra={[
              <Button key="open-list" type="primary" onClick={() => navigate("/sessions")}>
                Открыть список сессий
              </Button>
            ]}
          />
        </div>
      </div>
    );
  }

  if (sessionLoadStatus === "error") {
    const statusText = sessionLoadError?.statusText ? ` (${sessionLoadError.statusText})` : "";
    const detail = sessionLoadError?.data?.error ? String(sessionLoadError.data.error) : "Произошла ошибка при загрузке сессии.";
    return (
      <div className={`voice-session-shell ${themeMode === "dark" ? "theme-dark" : "theme-light"}`}>
        <div className="voice-session-shell-bg" />
        <div style={{ width: "100%", margin: "0 auto", padding: "40px", display: "flex", justifyContent: "center", alignItems: "center", minHeight: "300px", position: "relative", zIndex: 1 }}>
          <Result
            status="error"
            icon={<ExclamationCircleOutlined />}
            title={`Ошибка загрузки сессии${statusText}`}
            subTitle={detail}
            extra={[
              <Button key="reload" type="primary" onClick={() => fetchVoiceBotSession(sessionId)}>
                Попробовать снова
              </Button>
            ]}
          />
        </div>
      </div>
    );
  }

  if (!prepared_projects || sessionLoadStatus === "loading" || !voiceBotSession) {
    return (
      <div className={`voice-session-shell ${themeMode === "dark" ? "theme-dark" : "theme-light"}`}>
        <div className="voice-session-shell-bg" />
        <div style={{ width: "100%", margin: "0 auto", padding: "40px", display: "flex", justifyContent: "center", alignItems: "center", minHeight: "300px", position: "relative", zIndex: 1 }}>
        <Spin size="large" />
        </div>
      </div>
    );
  }

  const custom_widgets = {}
  for (const message of voiceMesagesData) {
    if (message.widgets) {
      for (const [key, value] of Object.entries(message.widgets)) {
        if (key === "questions") continue;
        if (value && Array.isArray(value)) {
          if (!custom_widgets[key]) {
            custom_widgets[key] = [];
          }
          custom_widgets[key] = custom_widgets[key].concat(value);
        }
      }
    }
  }

  // Получаем задачи из processors_data.CREATE_TASKS
  const possibleTasks = voiceBotSession?.processors_data?.CREATE_TASKS?.data || [];

  // Проверяем права пользователя на создание/обновление проектов
  const canUpdateProjects = hasPermission(PERMISSIONS.PROJECTS.UPDATE);

  const tabs = [
    {
      key: "1",
      label: "Транскрипция",
      children: <Transcription />
    },
    {
      key: "2",
      label: "Категоризация",
      children: <Categorization />
    },
    // {
    //   key: "3",
    //   label: "Сводка",
    //   children: <Summary />
    // },
    ...(voiceBotSession?.processors_data?.FINAL_CUSTOM_PROMPT?.is_processed ? [{
      key: "4",
      label: "Итоговые вопросы",
      children: <PostprocessedQuestions />
    }] : []),
    ...(possibleTasks.length > 0 && canUpdateProjects ? [{
      key: "5",
      label: "Возможные Задачи",
      children: <TasksTable />
    }] : []),
    ...(Array.isArray(sessionAttachments) && sessionAttachments.length > 0 ? [{
      key: "screenshort",
      label: "Screenshort",
      children: <Screenshort attachments={sessionAttachments} />
    }] : [{
      key: "screenshort",
      label: "Screenshort",
      children: <Screenshort attachments={[]} />
    }]),
    // Таб с результатом обработки произвольного промпта
    ...(customPromptResult ? [{
      key: "custom_prompt_result",
      label: "Результат обработки",
      children: <CustomPromptResult result={customPromptResult} />
    }] : []),
    {
      key: "log",
      label: "Log",
      children: <SessionLog />
    }
  ];

  return (
    <div className={`voice-session-shell ${themeMode === "dark" ? "theme-dark" : "theme-light"}`}>
      <div className="voice-session-shell-bg" />
      <div className="voice-session-page">
        <div className="voice-session-page-header">
          <div className="voice-session-page-title-wrap">
            <div className="voice-session-page-title">Voice Session Workspace</div>
            <div className="voice-session-page-subtitle">Toolbar actions are synced with FAB state and active session flow.</div>
          </div>
          <Tooltip title={themeMode === "dark" ? "Day mode" : "Night mode"}>
            <Button
              shape="circle"
              className="voice-session-theme-toggle"
              icon={themeMode === "dark" ? <SunOutlined /> : <MoonOutlined />}
              onClick={() => setThemeMode((prev) => (prev === "dark" ? "light" : "dark"))}
            />
          </Tooltip>
        </div>

        <div className="voice-session-content">
          <div className="flex flex-col gap-3 flex-1 min-w-0">
            <MeetingCard
              onCustomPromptResult={setCustomPromptResult}
              activeTab={activeTab}
            />

            <div className="voice-session-tabs-shell">
              <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                defaultActiveKey="2"
                style={{ width: '100%', maxWidth: 1740 }}
                items={tabs}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            {/* <WidgetsPanel /> */}
          </div>
        </div>

        <div className="voice-session-status-bottom">
          <SessionStatusWidget />
        </div>
      </div>
      <TicketsPreviewModal />
    </div>
  );
};
export default VoiceBotPage;
