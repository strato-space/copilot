import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  getAgentServers,
  getIncludeBuiltins,
  isRecord,
  mergeScopedExternalSettings,
  parseJsonc,
  toAgentConfigsFromServers,
  type AgentServerSetting,
} from '@strato-space/acp-runtime-shared';
import type { AgentConfig } from './agents.js';

function expandVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, key: string) => {
    if (key === 'userHome') return os.homedir();
    if (key.startsWith('env:')) {
      return process.env[key.slice('env:'.length)] ?? '';
    }
    return '';
  });
}

export type ExternalAgentSettings = {
  includeBuiltins?: boolean;
  agents: AgentConfig[];
  sourcePath?: string;
};

export function loadExternalAgentSettings(): ExternalAgentSettings {
  const candidates: Array<{ path: string; scope: 'global' | 'workspace' }> = [];
  const seen = new Set<string>();
  const pushCandidate = (candidate: { path: string; scope: 'global' | 'workspace' }) => {
    const normalizedPath = path.normalize(candidate.path);
    const key = `${candidate.scope}:${normalizedPath}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ ...candidate, path: normalizedPath });
  };

  pushCandidate({ path: path.join(os.homedir(), '.vscode', 'settings.json'), scope: 'global' });
  pushCandidate({ path: path.join(os.homedir(), '.vscode-server', 'data', 'Machine', 'settings.json'), scope: 'global' });
  pushCandidate({ path: path.join(os.homedir(), '.vscode-server', 'data', 'User', 'settings.json'), scope: 'global' });

  let currentDir = process.cwd();
  while (true) {
    pushCandidate({ path: path.join(currentDir, '.vscode', 'settings.json'), scope: 'workspace' });
    const parent = path.dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }

  const scopedEntries: Array<{
    scope: 'global' | 'workspace';
    servers: Record<string, AgentServerSetting>;
    includeBuiltins?: boolean;
    sourcePath: string;
  }> = [];

  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate.path)) continue;
      const parsed = parseJsonc(fs.readFileSync(candidate.path, 'utf8'));
      if (!isRecord(parsed)) continue;

      const includeBuiltins = getIncludeBuiltins(parsed);
      const servers = getAgentServers(parsed);
      if (Object.keys(servers).length === 0 && includeBuiltins === undefined) continue;

      const entry: {
        scope: 'global' | 'workspace';
        servers: Record<string, AgentServerSetting>;
        includeBuiltins?: boolean;
        sourcePath: string;
      } = {
        scope: candidate.scope,
        servers,
        sourcePath: candidate.path,
      };
      if (includeBuiltins !== undefined) {
        entry.includeBuiltins = includeBuiltins;
      }

      scopedEntries.push(entry);
    } catch {
      continue;
    }
  }

  const merged = mergeScopedExternalSettings(scopedEntries);
  const agents = toAgentConfigsFromServers(merged.servers, { expandVars });

  const result: ExternalAgentSettings = { agents };
  if (merged.includeBuiltins !== undefined) {
    result.includeBuiltins = merged.includeBuiltins;
  }
  if (merged.sourcePath !== undefined) {
    result.sourcePath = merged.sourcePath;
  }
  return result;
}
