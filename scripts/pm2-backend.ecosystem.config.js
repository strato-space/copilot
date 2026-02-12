const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const backDir = path.join(rootDir, 'backend');

module.exports = {
    apps: [
        {
            name: 'copilot-backend-dev',
            cwd: backDir,
            script: 'npm',
            args: 'run dev',
            env_file: path.join(backDir, '.env.development'),
        },
        {
            name: 'copilot-miniapp-backend-dev',
            cwd: backDir,
            script: 'npm',
            args: 'run dev:miniapp',
            env_file: path.join(backDir, '.env.development'),
        },
        {
            name: 'copilot-backend-local',
            cwd: backDir,
            script: 'npm',
            args: 'run dev',
            env_file: path.join(backDir, '.env.development'),
        },
        {
            name: 'copilot-miniapp-backend-local',
            cwd: backDir,
            script: 'npm',
            args: 'run dev:miniapp',
            env_file: path.join(backDir, '.env.development'),
        },
        {
            name: 'copilot-backend-prod',
            cwd: backDir,
            script: 'npm',
            args: 'run start',
            env_file: path.join(backDir, '.env.production'),
        },
        {
            name: 'copilot-miniapp-backend-prod',
            cwd: backDir,
            script: 'npm',
            args: 'run start:miniapp',
            env_file: path.join(backDir, '.env.production'),
        },
    ],
};
