import { Layout, Menu } from 'antd';
import {
  AppstoreOutlined,
  LineChartOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { type ReactElement, useState } from 'react';
import { Route, Routes, NavLink, useLocation } from 'react-router-dom';
import PlanFactPage from './pages/PlanFactPage';
import AnalyticsPage from './pages/AnalyticsPage';
import DirectoriesPage from './pages/DirectoriesPage';
import AgentsPage from './pages/directories/AgentsPage';
import ClientsProjectsRatesPage from './pages/directories/ClientsProjectsRatesPage';
import EmployeesSalariesPage from './pages/directories/EmployeesSalariesPage';
import FxPage from './pages/directories/FxPage';
import ProjectEditPage from './pages/ProjectEditPage';

const { Sider, Content } = Layout;

const navItems = [
  { key: 'analytics', label: 'Аналитика', to: '/analytics', icon: <LineChartOutlined /> },
  { key: 'plan-fact', label: 'Финансы', to: '/plan-fact', icon: <WalletOutlined /> },
  { key: 'directories', label: 'Справочники', to: '/directories', icon: <AppstoreOutlined /> },
];

export default function App(): ReactElement {
  const location = useLocation();
  const normalizedPath = location.pathname === '/' ? '/analytics' : location.pathname;
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const selectedKey =
    navItems.find((item): boolean => normalizedPath.startsWith(item.to))?.key ?? 'analytics';

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
              <NavLink to={item.to}>{item.label}</NavLink>
            </Menu.Item>
          ))}
        </Menu>
      </Sider>
      <Layout style={{ marginLeft: collapsed ? 80 : 220, transition: 'margin 0.2s' }}>
        <Content style={{ margin: '24px 16px 0', overflow: 'initial', background: '#f5f5f5' }}>
          <div className="p-6 min-h-screen">
            <Routes>
              <Route path="/" element={<AnalyticsPage />} />
              <Route path="/plan-fact" element={<PlanFactPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/directories" element={<DirectoriesPage />} />
              <Route path="/directories/clients-projects-rates" element={<ClientsProjectsRatesPage />} />
              <Route path="/directories/employees-salaries" element={<EmployeesSalariesPage />} />
              <Route path="/directories/fx" element={<FxPage />} />
              <Route path="/directories/agents" element={<AgentsPage />} />
              <Route path="/projects/:projectId" element={<ProjectEditPage />} />
              <Route path="*" element={<AnalyticsPage />} />
            </Routes>
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
