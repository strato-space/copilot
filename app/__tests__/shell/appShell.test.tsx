import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appSource = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');

describe('main shell navigation contract', () => {
  it('keeps route selection owned by the pathname and leaves unknown routes unselected', () => {
    expect(appSource).toContain('className="app-shell-sider-toggle"');
    expect(appSource).toContain('inlineCollapsed={collapsed}');
    expect(appSource).toContain("return navItems.find((item): boolean => isMainShellRouteMatch(normalizedPath, item.to))?.key ?? '';");
    expect(appSource).toContain("const normalizedPath = pathname === '/' ? '/analytics' : pathname;");
    expect(appSource).toContain("const isMainShellRouteMatch = (pathname: string, route: string): boolean => {");
    expect(appSource).toContain('onClick={({ key }): void => {');
    expect(appSource).not.toContain('<NavLink');
  });

  it('keeps the voice item badge-free and the auxiliary items compacted', () => {
    expect(appSource).toContain("{ key: 'voice', label: 'Voice', to: '/voice', icon: <SoundOutlined /> },");
    expect(appSource).toContain("{ key: 'agents', label: 'Agents', to: '/agents', icon: <RobotOutlined />, badge: 'zero' },");
    expect(appSource).toContain("{ key: 'chatops', label: 'ChatOps', to: '/chatops', icon: <MessageOutlined />, badge: 'zero' },");
    expect(appSource).toContain("{ key: 'desops', label: 'DesOps', to: '/desops', icon: <ToolOutlined />, badge: 'zero' },");
    expect(appSource).toContain("({resolveNavBadgeText(item.badge)})");
    expect(appSource).toContain("label: 'Analytics'");
    expect(appSource).toContain('const SIDEBAR_WIDTH = 172;');
    expect(appSource).toContain('const SIDEBAR_COLLAPSED_WIDTH = 56;');
  });

  it('uses the wider main shell surface and removes the workspace frame', () => {
    expect(appSource).toContain('className="app-shell-main-surface min-h-screen"');
    expect(appSource).not.toContain('breakpoint="lg"');
  });

  it('does not fall back to the analytics context label for unmatched routes', () => {
    expect(appSource).toContain("return navItems.find((item): boolean => isMainShellRouteMatch(pathname, item.to))?.label ?? '';");
    expect(appSource).not.toContain("return 'Analytic';");
  });
});
