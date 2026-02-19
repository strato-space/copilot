const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const backendDir = path.join(rootDir, 'backend');
const backendEnvFilePath = path.join(backendDir, '.env.production');

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

const deriveMongoConnectionString = (env) => {
  if (env.MONGODB_CONNECTION_STRING) return env.MONGODB_CONNECTION_STRING;

  const user = env.MONGO_USER;
  const password = env.MONGO_PASSWORD;
  const host = env.MONGODB_HOST;
  const port = env.MONGODB_PORT || '27017';
  const dbName = env.DB_NAME || 'stratodb';

  if (!user || !password || !host) return undefined;

  return `mongodb://${user}:${password}@${host}:${port}/${dbName}?authSource=admin&directConnection=true`;
};

const backendEnv = parseEnvFile(backendEnvFilePath);
const mergedEnv = {
  ...backendEnv,
};

if (!mergedEnv.MONGODB_CONNECTION_STRING) {
  const derived = deriveMongoConnectionString(mergedEnv);
  if (derived) mergedEnv.MONGODB_CONNECTION_STRING = derived;
}

module.exports = {
  apps: [
    {
      name: 'copilot-voicebot-tgbot-prod',
      cwd: backendDir,
      script: 'npm',
      args: 'run start:voicebot-tgbot',
      env_file: backendEnvFilePath,
      env: {
        ...mergedEnv,
        NODE_ENV: mergedEnv.NODE_ENV || 'production',
      },
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
    },
    {
      name: 'copilot-voicebot-workers-prod',
      cwd: backendDir,
      script: 'npm',
      args: 'run start:voicebot-workers',
      env_file: backendEnvFilePath,
      env: {
        ...mergedEnv,
        NODE_ENV: mergedEnv.NODE_ENV || 'production',
      },
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
    },
  ],
};
