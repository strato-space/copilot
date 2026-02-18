import { Route, Routes, Outlet, Navigate, useLocation } from "react-router-dom"

import { useEffect } from "react";

import LoginPage from "./pages/LoginPage";
import SessionPage from "./pages/SessionPage";
import SessionResolverPage from "./pages/SessionResolverPage";
import SessionsListPage from "./pages/SessionsListPage";
import AdminPage from "./pages/AdminPage";
import Canvas from "./pages/Canvas";
import TGAuth from "./pages/TGAuth";
import TopicsPage from "./pages/TopicsPage";

import Navigation from "./components/Navigation"
import RequireAuth from "./components/RequireAuth";
import WebrtcFabLoader from "./components/WebrtcFabLoader";
import EmbedLayout from "./components/EmbedLayout";
import { useAppInit } from "./hooks/useAppInit";
import { useMCPWebSocket } from "./hooks/useMCPWebSocket";
import useEmbedBridge from "./hooks/useEmbedBridge";
import useEmbedHeight from "./hooks/useEmbedHeight";

function Layout() {
  return (
    <RequireAuth>
      <>
        <div className="flex">
          <Navigation />
          <div className="flex-grow py-6">
            <Outlet /> {/* Здесь будут рендериться вложенные роуты */}
          </div>
        </div>
        <WebrtcFabLoader />
      </>
    </RequireAuth>
  );
}

function Logout() {
  useEffect(() => {
    // Очищаем все cookies
    document.cookie.split(";").forEach(function (c) {
      document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
    });

    // Также очищаем localStorage и sessionStorage для полной очистки
    localStorage.clear();
    sessionStorage.clear();
  }, []);

  // Перенаправляем на страницу логина
  return <Navigate to="/login" replace />;
}

function App() {
  const location = useLocation();
  const isEmbedded = window.__VOICEBOT_EMBED__ === true;
  const isEmbedRoute = isEmbedded || location.pathname.startsWith("/embed");

  // Инициализация приложения - обновление данных пользователя при загрузке
  useAppInit();

  // Инициализация MCP WebSocket соединения
  useMCPWebSocket();

  useEmbedBridge({ enabled: isEmbedRoute, basePath: isEmbedded ? "" : "/embed" });
  useEmbedHeight({ enabled: isEmbedRoute });

  const coreRoutes = (
    <>
      <Route index element={<SessionsListPage />} />
      <Route path="sessions" element={<SessionsListPage />} />
      <Route path="session" element={<SessionResolverPage />} />
      <Route path="session/:sessionId" element={<SessionPage />} />
      <Route path="project-files" element={<Canvas />} />
      <Route path="topics" element={<TopicsPage />} />
      <Route path="admin" element={<AdminPage />} />
    </>
  );

  if (isEmbedded) {
    return (
      <Routes>
        <Route path="authorized" element={<Navigate to="/login" replace />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="tg_auth" element={<TGAuth />} />
        <Route path="logout" element={<Logout />} />
        <Route path="/" element={<EmbedLayout />}>
          {coreRoutes}
        </Route>
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="authorized" element={<Navigate to="/login" replace />} />
      <Route path="login" element={<LoginPage />} />
      <Route path="tg_auth" element={<TGAuth />} />
      <Route path="logout" element={<Logout />} />
      <Route path="embed" element={<EmbedLayout />}>
        {coreRoutes}
      </Route>
      <Route path="/" element={<Layout />}>
        {coreRoutes}
      </Route>
    </Routes>
  );
}

export default App;
