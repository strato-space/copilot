module.exports = {
  apps: [
    {
      name: "copilot-voicebot-tgbot-prod",
      cwd: "/home/strato-space/copilot/voicebot_runtime",
      script: "voicebot-tgbot.js",
      env_file: "/home/strato-space/copilot/voicebot_runtime/.env.prod-cutover",
      env: {
        DOTENV_CONFIG_PATH: "/home/strato-space/copilot/voicebot_runtime/.env.prod-cutover",
        DOTENV_CONFIG_OVERRIDE: "true"
      },
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s"
    }
  ]
};
