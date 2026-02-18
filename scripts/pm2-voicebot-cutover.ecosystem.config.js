const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const backendDir = path.join(rootDir, 'backend');

module.exports = {
  apps: [
    {
      name: 'copilot-voicebot-tgbot-prod',
      cwd: backendDir,
      script: 'npm',
      args: 'run start:voicebot-tgbot',
      env_file: path.join(backendDir, '.env.production'),
      env: {
        NODE_ENV: 'production',
      },
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
    },
  ],
};
