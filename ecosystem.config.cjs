/**
 * SparkNav - PM2 Production Ecosystem Configuration
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 status
 *   pm2 logs sparknav-bot
 *   pm2 restart sparknav-bot
 *   pm2 stop sparknav-bot
 */

const fs = require('node:fs');
const path = require('node:path');

// Automatically pre-load .env into process.env before configuring PM2
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envPath);
  } catch (e) {}
}

module.exports = {
  apps: [
    {
      name: 'sparknav-bot',
      script: path.join(__dirname, 'src/scripts/telegram-bot-daemon.mjs'),
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      restart_delay: 3000,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
        TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
        TELEGRAM_ADMIN_CHAT_ID: process.env.TELEGRAM_ADMIN_CHAT_ID || '',
        GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
        GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        LLM_API_KEY: process.env.LLM_API_KEY || '',
        LLM_API_BASE: process.env.LLM_API_BASE || 'https://api.deepseek.com/v1',
        LLM_MODEL: process.env.LLM_MODEL || 'deepseek-chat',
        OLLAMA_HOST: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
        OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'qwen2.5:7b'
      },
      error_file: path.join(__dirname, 'logs/pm2-bot-error.log'),
      out_file: path.join(__dirname, 'logs/pm2-bot-out.log'),
      merge_logs: true,
      time: true
    }
  ]
};
