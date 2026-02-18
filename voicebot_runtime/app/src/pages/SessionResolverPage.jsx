import React from "react";
import { Button, Spin } from "antd";
import { useNavigate } from "react-router-dom";

import { useAuthUser } from "../store/AuthUser";
import { useVoiceBot } from "../store/voiceBot";

const SessionResolverPage = () => {
  const navigate = useNavigate();
  const { isAuth } = useAuthUser();
  const { fetchActiveSession } = useVoiceBot();

  const [isLoading, setIsLoading] = React.useState(true);
  const [activeSessionId, setActiveSessionId] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!isAuth) return;
      setIsLoading(true);
      try {
        const active = await fetchActiveSession();
        const nextSessionId = active?.session_id ? String(active.session_id) : null;
        if (cancelled) return;
        if (nextSessionId) {
          setActiveSessionId(nextSessionId);
          navigate(`/session/${nextSessionId}`, { replace: true });
          return;
        }
        setActiveSessionId(null);
      } catch (_) {
        if (!cancelled) setActiveSessionId(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [isAuth, fetchActiveSession, navigate]);

  if (isLoading) {
    return (
      <div style={{ width: "100%", margin: "0 auto", padding: "40px", display: "flex", justifyContent: "center", alignItems: "center", minHeight: "240px" }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!activeSessionId) {
    return (
      <div style={{ width: "100%", margin: "0 auto", padding: "40px", display: "flex", justifyContent: "center", alignItems: "center", minHeight: "240px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
          <div>Активная сессия не найдена.</div>
          <Button type="primary" onClick={() => navigate("/sessions")}>Открыть список сессий</Button>
        </div>
      </div>
    );
  }

  return null;
};

export default SessionResolverPage;
