import { Layout, Menu, Spin, Tag } from 'antd';
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
import { Navigate, Route, Routes, NavLink, useLocation, useParams, Outlet } from 'react-router-dom';
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
import VoicePage from './pages/VoicePage';
import OperopsPage from './pages/OperopsPage';
import ChatopsPage from './pages/ChatopsPage';
import AgentsOpsPage from './pages/AgentsOpsPage';
import DesopsPage from './pages/DesopsPage';
import HhopsPage from './pages/HhopsPage';
import LoginPage from './pages/LoginPage';
import SaleopsPage from './pages/SaleopsPage';
import { useAuthStore } from './store/authStore';

const { Sider, Content } = Layout;

const navItems = [
  { key: 'analytics', label: 'Analytic', to: '/analytics', icon: <LineChartOutlined />, badge: 'alpha' },
  { key: 'agents', label: 'Agents', to: '/agents', icon: <RobotOutlined />, badge: 'dev' },
  { key: 'operops', label: 'OperOps', to: '/operops', icon: <SettingOutlined />, badge: 'beta' },
  { key: 'finops', label: 'FinOps', to: '/finops', icon: <WalletOutlined />, badge: 'alpha' },
  { key: 'chatops', label: 'ChatOps', to: '/chatops', icon: <MessageOutlined />, badge: 'dev' },
  { key: 'devops', label: 'DevOps', to: '/devops', icon: <ToolOutlined />, badge: 'dev' },
  { key: 'voice', label: 'Voice', to: '/voice', icon: <SoundOutlined />, badge: 'dev' },
  { key: 'guides', label: 'Guides', to: '/guide', icon: <AppstoreOutlined />, badge: 'alpha' },
];

function LegacyProjectRedirect(): ReactElement {
  const { projectId } = useParams();

  return (
    <Navigate
      to={projectId ? `/guide/projects/${projectId}` : '/guide/clients-projects-rates'}
      replace
    />
  );
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
  const normalizedPath = location.pathname === '/' ? '/analytics' : location.pathname;
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const selectedKey =
    navItems.find((item): boolean => normalizedPath.startsWith(item.to))?.key ?? 'analytics';
  const setContextLabel = useNotificationStore((state) => state.setContextLabel);
  const contextLabel = normalizedPath.startsWith('/finops') || normalizedPath.startsWith('/plan-fact')
    ? 'FinOps'
    : normalizedPath.startsWith('/saleops')
    ? 'SaleOps'
    : normalizedPath.startsWith('/hhops')
    ? 'HHOps'
    : normalizedPath.startsWith('/guide')
    ? 'Guides'
    : normalizedPath.startsWith('/voice')
    ? 'Voice'
    : normalizedPath.startsWith('/operops')
    ? 'OperOps'
    : normalizedPath.startsWith('/chatops')
    ? 'ChatOps'
    : normalizedPath.startsWith('/agents')
    ? 'Agents'
    : normalizedPath.startsWith('/devops')
    ? 'DevOps'
    : normalizedPath.startsWith('/desops')
    ? 'DevOps'
    : 'Analytic';

  useEffect((): void => {
    setContextLabel(contextLabel);
  }, [contextLabel, setContextLabel]);

  return (
    <Layout className="min-h-screen">
      <Sider
        width={220}
        collapsedWidth={80}
        collapsible
        collapsed={collapsed}
        trigger={null}
        onCollapse={(value): void => setCollapsed(value)}
        breakpoint="lg"
        onBreakpoint={(broken): void => setCollapsed(broken)}
        className="border-r border-slate-200"
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
        <div className={`py-4 ${collapsed ? 'flex justify-center' : 'px-4'}`}>
          <div className="w-3.5 h-3.5 rounded-full bg-slate-900" aria-hidden="true" />
        </div>
        <Menu
          mode="inline"
          className="border-r-0"
          selectedKeys={selectedKey ? [selectedKey] : []}
          style={{ background: '#ffffff' }}
        >
          <Menu.Item
            key="__toggle"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={(): void => setCollapsed((prev) => !prev)}
          >
          </Menu.Item>
          {navItems.map((item): ReactElement => (
            <Menu.Item key={item.key} icon={item.icon}>
              <NavLink to={item.to} className="flex items-center gap-2 w-full">
                <span className="min-w-0 truncate">{item.label}</span>
                <Tag
                  color={item.badge === 'alpha' ? 'magenta' : item.badge === 'beta' ? 'cyan' : 'default'}
                  className="ml-auto"
                >
                  {item.badge === 'alpha'
                    ? '(alpha)'
                    : item.badge === 'beta'
                    ? '(beta)'
                    : '(dev)'}
                </Tag>
              </NavLink>
            </Menu.Item>
          ))}
        </Menu>
      </Sider>
      <Layout style={{ marginLeft: collapsed ? 80 : 220, transition: 'margin 0.2s' }}>
        <Content style={{ margin: '24px 16px 0', overflow: 'initial', background: '#f5f5f5' }}>
          <div className="p-6 min-h-screen">
            <Outlet />
          </div>
        </Content>
      </Layout>
      <NotificationsDrawer />
    </Layout>
  );
}

export default function App(): ReactElement {
  const checkAuth = useAuthStore((state) => state.checkAuth);

  useEffect((): void => {
    void checkAuth();
  }, [checkAuth]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Navigate to="/analytics" replace />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/operops" element={<Navigate to="/operops/crm" replace />} />
          <Route path="/operops/*" element={<OperopsPage />} />
          <Route path="/chatops" element={<ChatopsPage />} />
          <Route path="/agents" element={<AgentsOpsPage />} />
          <Route path="/voice/*" element={<VoicePage />} />
          <Route path="/finops" element={<PlanFactPage />} />
          <Route path="/saleops" element={<SaleopsPage />} />
          <Route path="/hhops" element={<HhopsPage />} />
          <Route path="/plan-fact" element={<Navigate to="/finops" replace />} />
          <Route path="/finops/plan-fact" element={<Navigate to="/finops" replace />} />
          <Route path="/devops" element={<DesopsPage />} />
          <Route path="/desops" element={<Navigate to="/devops" replace />} />
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
          <Route path="/finops/devops" element={<Navigate to="/desops" replace />} />
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
          <Route path="*" element={<Navigate to="/analytics" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
