/**
 * API key management — read status and write keys to .env
 *
 * GET  /api/keys — returns which keys are configured (booleans, never exposes values)
 * PUT  /api/keys — accepts key values, writes to .env, updates runtime config
 * @module
 */

import { Hono } from 'hono';
import { config } from '../lib/config.js';
import { writeEnvKey } from '../lib/env-file.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';

const app = new Hono();

/** GET /api/keys — which API keys are configured */
app.get('/api/keys', rateLimitGeneral, (c) => {
  return c.json({
    openaiKeySet: !!config.openaiApiKey,
    replicateKeySet: !!config.replicateApiToken,
    xiaomiKeySet: !!config.mimoApiKey,
  });
});

/** PUT /api/keys — save API keys to .env and update runtime config */
app.put('/api/keys', rateLimitGeneral, async (c) => {
  try {
    const body = await c.req.json() as Record<string, string>;
    const results: string[] = [];

    if (body.openaiKey !== undefined) {
      const val = body.openaiKey.trim();
      await writeEnvKey('OPENAI_API_KEY', val);
      // Update runtime config (cast away readonly for hot-reload)
      (config as Record<string, unknown>).openaiApiKey = val;
      results.push(val ? 'OPENAI_API_KEY saved' : 'OPENAI_API_KEY cleared');
    }

    if (body.replicateToken !== undefined) {
      const val = body.replicateToken.trim();
      await writeEnvKey('REPLICATE_API_TOKEN', val);
      (config as Record<string, unknown>).replicateApiToken = val;
      results.push(val ? 'REPLICATE_API_TOKEN saved' : 'REPLICATE_API_TOKEN cleared');
    }

    if (body.mimoApiKey !== undefined) {
      const val = body.mimoApiKey.trim();
      await writeEnvKey('MIMO_API_KEY', val);
      (config as Record<string, unknown>).mimoApiKey = val;
      results.push(val ? 'MIMO_API_KEY saved' : 'MIMO_API_KEY cleared');
    }

    return c.json({
      ok: true,
      message: results.join(', ') || 'No changes',
      openaiKeySet: !!config.openaiApiKey,
      replicateKeySet: !!config.replicateApiToken,
      xiaomiKeySet: !!config.mimoApiKey,
    });
  } catch {
    return c.text('Invalid request', 400);
  }
});

export default app;
