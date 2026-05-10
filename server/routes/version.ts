/**
 * GET /api/version — Returns the application version from package.json.
 */

import { Hono } from 'hono';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')) as {
  version: string;
  name: string;
};

const app = new Hono();

app.get('/api/version', rateLimitGeneral, (c) => c.json({ version: pkg.version, name: pkg.name }));

export default app;
