const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const backDir = path.join(rootDir, 'backend');
const backendProdEnvFilePath = path.join(backDir, '.env.production');

const parseEnvFile = (filePath) => {
    if (!fs.existsSync(filePath)) return {};

    const env = {};
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);

    for (const rawLine of lines) {
        const line = String(rawLine || '').trim();
        if (!line || line.startsWith('#')) continue;

        const idx = line.indexOf('=');
        if (idx <= 0) continue;

        const key = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        env[key] = value;
    }

    return env;
};

const backendProdEnv = parseEnvFile(backendProdEnvFilePath);

module.exports = {
    apps: [
        {
            name: 'copilot-backend-dev',
            cwd: backDir,
            script: 'npm',
            args: 'run dev',
            env_file: path.join(backDir, '.env.development'),
            env: {
                NODE_ENV: 'development',
            },
        },
        {
            name: 'copilot-miniapp-backend-dev',
            cwd: backDir,
            script: 'npm',
            args: 'run dev:miniapp',
            env_file: path.join(backDir, '.env.development'),
            env: {
                NODE_ENV: 'development',
            },
        },
        {
            name: 'copilot-backend-local',
            cwd: backDir,
            script: 'npm',
            args: 'run dev',
            env_file: path.join(backDir, '.env.development'),
            env: {
                NODE_ENV: 'development',
            },
        },
        {
            name: 'copilot-miniapp-backend-local',
            cwd: backDir,
            script: 'npm',
            args: 'run dev:miniapp',
            env_file: path.join(backDir, '.env.development'),
            env: {
                NODE_ENV: 'development',
            },
        },
        {
            name: 'copilot-backend-prod',
            cwd: backDir,
            script: 'npm',
            args: 'run start',
            env_file: backendProdEnvFilePath,
            env: {
                ...backendProdEnv,
                NODE_ENV: backendProdEnv.NODE_ENV || 'production',
            },
        },
        {
            name: 'copilot-miniapp-backend-prod',
            cwd: backDir,
            script: 'npm',
            args: 'run start:miniapp',
            env_file: backendProdEnvFilePath,
            env: {
                ...backendProdEnv,
                NODE_ENV: backendProdEnv.NODE_ENV || 'production',
            },
        },
    ],
};
