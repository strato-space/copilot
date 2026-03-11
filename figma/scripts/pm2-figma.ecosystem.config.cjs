const path = require('path');

const rootDir = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'copilot-figma-indexer-dev',
      cwd: rootDir,
      script: 'npm',
      args: 'run dev:indexer',
      env_file: path.join(rootDir, '.env.development'),
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
    },
    {
      name: 'copilot-figma-webhook-receiver-dev',
      cwd: rootDir,
      script: 'npm',
      args: 'run dev:webhooks',
      env_file: path.join(rootDir, '.env.development'),
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
    },
    {
      name: 'copilot-figma-indexer-prod',
      cwd: rootDir,
      script: 'npm',
      args: 'run start:indexer',
      env_file: path.join(rootDir, '.env.production'),
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
    },
    {
      name: 'copilot-figma-webhook-receiver-prod',
      cwd: rootDir,
      script: 'npm',
      args: 'run start:webhooks',
      env_file: path.join(rootDir, '.env.production'),
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
    },
  ],
};
