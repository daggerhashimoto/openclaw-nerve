/**
 * GET /api/backups/config — Read backup configuration from environment
 */

import { Hono } from 'hono';

const app = new Hono();

app.get('/api/backups/config', async (c) => {
  const env = process.env;
  return c.json({
    BACKUP_LOCAL_ENABLED: env.BACKUP_LOCAL_ENABLED === 'true',
    BACKUP_LOCAL_DIR: env.BACKUP_LOCAL_DIR || '~/Backups',
    BACKUP_RETENTION_DAYS: parseInt(env.BACKUP_RETENTION_DAYS || '7', 10),
    BACKUP_LOCAL_SCHEDULE: env.BACKUP_LOCAL_SCHEDULE || '0 1 * * *',
    BACKUP_NAS_ENABLED: env.BACKUP_NAS_ENABLED === 'true',
    BACKUP_NAS_HOST: env.BACKUP_NAS_HOST || '',
    BACKUP_NAS_USER: env.BACKUP_NAS_USER || '',
    BACKUP_NAS_PASSWORD: env.BACKUP_NAS_PASSWORD || '',
    BACKUP_NAS_BACKUP_PATH: env.BACKUP_NAS_BACKUP_PATH || '',
    BACKUP_NAS_RETENTION_DAYS: parseInt(env.BACKUP_NAS_RETENTION_DAYS || '30', 10),
    BACKUP_NAS_SCHEDULE: env.BACKUP_NAS_SCHEDULE || '30 1 * * *',
    BACKUP_GITHUB_ENABLED: env.BACKUP_GITHUB_ENABLED === 'true',
    BACKUP_GITHUB_REPO: env.BACKUP_GITHUB_REPO || '',
    BACKUP_GITHUB_BRANCH: env.BACKUP_GITHUB_BRANCH || 'main',
    BACKUP_GITHUB_PATH: env.BACKUP_GITHUB_PATH || 'backups',
  });
});

export default app;
