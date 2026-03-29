import { Button, Layout, Menu, Spin } from 'antd';
import {
  AppstoreOutlined,
  MessageOutlined,
  LineChartOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RobotOutlined,
  SettingOutlined,
  SoundOutlined,
  ToolOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { type ReactElement, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams, Outlet } from 'react-router-dom';
import PlanFactPage from './pages/PlanFactPage';
import AnalyticsPage from './pages/AnalyticsPage';
import DirectoriesPage from './pages/DirectoriesPage';
import DirectoryDetailPage from './pages/directories/DirectoryDetailPage';
import AgentsPage from './pages/directories/AgentsPage';
import ClientsProjectsRatesPage from './pages/directories/ClientsProjectsRatesPage';
import EmployeesSalariesPage from './pages/directories/EmployeesSalariesPage';
import FxPage from './pages/directories/FxPage';
import ProjectEditPage from './pages/ProjectEditPage';
import NotificationsDrawer from './components/NotificationsDrawer';
import { useNotificationStore } from './store/notificationStore';
import VoiceLayout from './pages/VoiceLayout';
import SessionsListPage from './pages/voice/SessionsListPage';
import SessionPage from './pages/voice/SessionPage';
import SessionResolverPage from './pages/voice/SessionResolverPage';
import AdminPage from './pages/AdminPage';
import TGAuthPage from './pages/TGAuthPage';
import OperOpsLayout from './pages/OperOpsLayout';
import {
  CRMPage,
  PerformersPage,
  TaskPage,
  CodexTaskPage,
  ProjectsTree,
  ProjectManagementPage,
  FinancesPerformersPage,
} from './pages/operops';
import ChatopsPage from './pages/ChatopsPage';
import AgentsOpsPage from './pages/AgentsOpsPage';
import AgentsHarnessPage from './pages/AgentsHarnessPage';
import DesopsPage from './pages/DesopsPage';
import HhopsPage from './pages/HhopsPage';
import LoginPage from './pages/LoginPage';
import SaleopsPage from './pages/SaleopsPage';
import { useAuthStore } from './store/authStore';
import { useAppInit } from './hooks/useAppInit';
import { useMCPWebSocket } from './hooks/useMCPWebSocket';
import WebrtcFabLoader from './components/voice/WebrtcFabLoader';

const { Sider, Content } = Layout;
const SIDEBAR_WIDTH = 172;
const SIDEBAR_COLLAPSED_WIDTH = 56;

type NavBadge = 'alpha' | 'beta' | 'zero';

interface NavItem {
  key: string;
  label: string;
  to: string;
  icon: ReactElement;
  badge?: NavBadge;
}

export const navItems: NavItem[] = [
  { key: 'analytics', label: 'Analytics', to: '/analytics', icon: <LineChartOutlined />, badge: 'alpha' },
  { key: 'agents', label: 'Agents', to: '/agents', icon: <RobotOutlined />, badge: 'zero' },
  { key: 'operops', label: 'OperOps', to: '/operops', icon: <SettingOutlined />, badge: 'beta' },
  { key: 'finops', label: 'FinOps', to: '/finops', icon: <WalletOutlined />, badge: 'alpha' },
  { key: 'chatops', label: 'ChatOps', to: '/chatops', icon: <MessageOutlined />, badge: 'zero' },
  { key: 'desops', label: 'DesOps', to: '/desops', icon: <ToolOutlined />, badge: 'zero' },
  { key: 'voice', label: 'Voice', to: '/voice', icon: <SoundOutlined /> },
  { key: 'admin', label: 'Admin', to: '/admin', icon: <SettingOutlined />, badge: 'beta' },
  { key: 'guides', label: 'Guides', to: '/guide', icon: <AppstoreOutlined />, badge: 'alpha' },
];

const isMainShellRouteMatch = (pathname: string, route: string): boolean => {
  return pathname === route || pathname.startsWith(`${route}/`);
};

export const resolveMainShellSelectedKey = (pathname: string): string => {
  const normalizedPath = pathname === '/' ? '/analytics' : pathname;
  return navItems.find((item): boolean => isMainShellRouteMatch(normalizedPath, item.to))?.key ?? '';
};

export const resolveMainShellContextLabel = (pathname: string): string => {
  if (pathname.startsWith('/finops') || pathname.startsWith('/plan-fact')) {
    return 'FinOps';
  }

  if (pathname.startsWith('/saleops')) {
    return 'SaleOps';
  }

  if (pathname.startsWith('/hhops')) {
    return 'HHOps';
  }

  if (pathname.startsWith('/guide')) {
    return 'Guides';
  }

  if (pathname.startsWith('/voice')) {
    return 'Voice';
  }

  if (pathname.startsWith('/admin')) {
    return 'Admin';
  }

  if (pathname.startsWith('/operops')) {
    return 'OperOps';
  }

  if (pathname.startsWith('/chatops')) {
    return 'ChatOps';
  }

  if (pathname.startsWith('/agents')) {
    return 'Agents';
  }

  if (pathname.startsWith('/desops')) {
    return 'DesOps';
  }

  return navItems.find((item): boolean => isMainShellRouteMatch(pathname, item.to))?.label ?? '';
};

export const resolveNavBadgeText = (badge?: NavBadge): string | null => {
  if (!badge) {
    return null;
  }

  return badge;
};

function LegacyProjectRedirect(): ReactElement {
  const { projectId } = useParams();

  return (
    <Navigate
      to={projectId ? `/guide/projects/${projectId}` : '/guide/clients-projects-rates'}
      replace
    />
  );
}

function LegacyTaskRedirect(): ReactElement {
  const { taskId } = useParams();

  return <Navigate to={taskId ? `/operops/task/${taskId}` : '/operops/crm'} replace />;
}

function RequireAuth(): ReactElement {
  const { isAuth, loading, ready } = useAuthStore();
  const location = useLocation();

  if (!ready || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Spin size="large" />
      </div>
    );
  }

  if (!isAuth) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}

function MainLayout(): ReactElement {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const selectedKey = resolveMainShellSelectedKey(location.pathname);
  const setContextLabel = useNotificationStore((state) => state.setContextLabel);
  const contextLabel = resolveMainShellContextLabel(location.pathname);

  useEffect((): void => {
    setContextLabel(contextLabel);
  }, [contextLabel, setContextLabel]);

  return (
    <Layout className="app-shell-layout min-h-screen">
      <Sider
        width={SIDEBAR_WIDTH}
        collapsedWidth={SIDEBAR_COLLAPSED_WIDTH}
        collapsible
        collapsed={collapsed}
        trigger={null}
        onCollapse={(value): void => setCollapsed(value)}
        className="app-shell-sider border-r border-slate-200"
        style={{
          overflow: 'auto',
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          background: '#ffffff',
        }}
      >
        <div className={`app-shell-sider-top ${collapsed ? 'app-shell-sider-top--collapsed' : ''}`}>
          <div className="app-shell-sider-mark" aria-hidden="true" />
          <Button
            type="text"
            size="small"
            className="app-shell-sider-toggle"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={(): void => setCollapsed((prev) => !prev)}
          />
        </div>
        <Menu
          mode="inline"
          inlineCollapsed={collapsed}
          className="app-shell-nav border-r-0"
          selectedKeys={selectedKey ? [selectedKey] : []}
          style={{ background: '#ffffff' }}
          onClick={({ key }): void => {
            const item = navItems.find((entry) => entry.key === key);
            if (!item || location.pathname === item.to) return;
            navigate(item.to);
          }}
        >
          {navItems.map((item): ReactElement => (
            <Menu.Item key={item.key} icon={item.icon} title={item.label}>
              <span className="app-shell-nav-link">
                <span className="app-shell-nav-label">{item.label}</span>
                {item.badge ? (
                  <span className={`app-shell-nav-meta app-shell-nav-meta--${item.badge}`}>
                    ({resolveNavBadgeText(item.badge)})
                  </span>
                ) : null}
              </span>
            </Menu.Item>
          ))}
        </Menu>
      </Sider>
      <Layout
        className="app-shell-main"
        style={{ marginLeft: collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH, transition: 'margin 0.2s' }}
      >
        <Content className="app-shell-main-content" style={{ margin: '0', overflow: 'initial', background: 'transparent' }}>
          <div className="app-shell-main-surface min-h-screen">
            <Outlet />
          </div>
        </Content>
      </Layout>
      <WebrtcFabLoader />
      <NotificationsDrawer />
    </Layout>
  );
}

export default function App(): ReactElement {
  const checkAuth = useAuthStore((state) => state.checkAuth);

  const location = useLocation();
  const isHarnessRoute = location.pathname.startsWith('/__harness/agents');
  const isAcpSurface =
    location.pathname.startsWith('/agents') ||
    isHarnessRoute;

  useAppInit(isHarnessRoute);
  useMCPWebSocket(!isAcpSurface);

  useEffect((): void => {
    if (isHarnessRoute) {
      return;
    }
    void checkAuth();
  }, [checkAuth, isHarnessRoute]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/tg_auth" element={<TGAuthPage />} />
      <Route path="/__harness/agents" element={<AgentsHarnessPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Navigate to="/analytics" replace />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/operops" element={<OperOpsLayout />}>
            <Route index element={<Navigate to="/operops/crm" replace />} />
            <Route path="crm" element={<CRMPage />} />
            <Route path="crm/task/:taskId/edit" element={<CRMPage />} />
            <Route path="performers" element={<PerformersPage />} />
            <Route path="finances-performers" element={<FinancesPerformersPage />} />
            <Route path="projects-tree" element={<ProjectsTree />} />
            <Route path="projects-tree/new" element={<ProjectManagementPage />} />
            <Route path="projects-tree/:projectId" element={<ProjectManagementPage />} />
            <Route path="task/:taskId" element={<TaskPage />} />
            <Route path="codex/task/:issueId" element={<CodexTaskPage />} />
          </Route>
          <Route path="/chatops" element={<ChatopsPage />} />
          <Route path="/agents" element={<AgentsOpsPage />} />
          <Route path="/agents/session/:sessionId" element={<AgentsOpsPage />} />
          <Route path="/voice" element={<VoiceLayout />}>
            <Route index element={<SessionsListPage />} />
            <Route path="sessions" element={<SessionsListPage />} />
            <Route path="session" element={<SessionResolverPage />} />
            <Route path="session/:sessionId" element={<SessionPage />} />
          </Route>
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/finops" element={<PlanFactPage />} />
          <Route path="/saleops" element={<SaleopsPage />} />
          <Route path="/hhops" element={<HhopsPage />} />
          <Route path="/plan-fact" element={<Navigate to="/finops" replace />} />
          <Route path="/finops/plan-fact" element={<Navigate to="/finops" replace />} />
          <Route path="/desops" element={<DesopsPage />} />
          <Route path="/desops" element={<Navigate to="/desops" replace />} />
          <Route path="/guide" element={<DirectoriesPage />} />
          <Route path="/guide/clients-projects-rates" element={<ClientsProjectsRatesPage />} />
          <Route path="/guide/employees-salaries" element={<EmployeesSalariesPage />} />
          <Route path="/guide/fx" element={<FxPage />} />
          <Route path="/guide/agents" element={<AgentsPage />} />
          <Route path="/guide/projects/:projectId" element={<ProjectEditPage />} />
          <Route path="/guide/directory/:groupKey" element={<Navigate to="/guide/:groupKey" replace />} />
          <Route path="/guide/:groupKey" element={<DirectoryDetailPage />} />
          <Route path="/directories" element={<Navigate to="/guide" replace />} />
          <Route path="/directories/clients-projects-rates" element={<Navigate to="/guide/clients-projects-rates" replace />} />
          <Route path="/directories/employees-salaries" element={<Navigate to="/guide/employees-salaries" replace />} />
          <Route path="/directories/fx" element={<Navigate to="/guide/fx" replace />} />
          <Route path="/directories/agents" element={<Navigate to="/guide/agents" replace />} />
          {/* Backward-compatible deep links from the old /finops/* basename */}
          <Route path="/finops/analytics" element={<Navigate to="/analytics" replace />} />
          <Route path="/finops/operops" element={<Navigate to="/operops/crm" replace />} />
          <Route path="/finops/saleops" element={<Navigate to="/saleops" replace />} />
          <Route path="/finops/hhops" element={<Navigate to="/hhops" replace />} />
          <Route path="/finops/chatops" element={<Navigate to="/chatops" replace />} />
          <Route path="/finops/agents" element={<Navigate to="/agents" replace />} />
          <Route path="/finops/voice" element={<Navigate to="/voice" replace />} />
          <Route path="/finops/admin" element={<Navigate to="/admin" replace />} />
          <Route path="/finops/desops" element={<Navigate to="/desops" replace />} />
          <Route path="/finops/desops" element={<Navigate to="/desops" replace />} />
          <Route path="/finops/guide" element={<Navigate to="/guide" replace />} />
          <Route path="/finops/directories" element={<Navigate to="/guide" replace />} />
          <Route path="/finops/directories/clients-projects-rates" element={<Navigate to="/guide/clients-projects-rates" replace />} />
          <Route path="/finops/directories/employees-salaries" element={<Navigate to="/guide/employees-salaries" replace />} />
          <Route path="/finops/directories/fx" element={<Navigate to="/guide/fx" replace />} />
          <Route path="/finops/directories/agents" element={<Navigate to="/guide/agents" replace />} />
          <Route path="/finops/projects/:projectId" element={<LegacyProjectRedirect />} />
          <Route path="/projects/:projectId" element={<LegacyProjectRedirect />} />
          <Route path="/projects" element={<Navigate to="/guide/clients-projects-rates" replace />} />
          <Route path="/task/:taskId" element={<LegacyTaskRedirect />} />
          <Route path="*" element={<Navigate to="/analytics" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
