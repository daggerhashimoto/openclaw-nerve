import { Hono } from 'hono';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import { BeadAdapterError, BeadNotFoundError, getBeadDetail } from '../lib/beads.js';

const app = new Hono();

app.get('/api/beads/:id', rateLimitGeneral, async (c) => {
  const beadId = c.req.param('id')?.trim();
  if (!beadId) {
    return c.json({ error: 'invalid_request', details: 'bead id is required' }, 400);
  }

  const targetPath = c.req.query('targetPath')?.trim() || undefined;
  const currentDocumentPath = c.req.query('currentDocumentPath')?.trim() || undefined;
  const workspaceAgentId = c.req.query('workspaceAgentId')?.trim() || undefined;

  try {
    const bead = await getBeadDetail(beadId, {
      targetPath,
      currentDocumentPath,
      workspaceAgentId,
    });
    return c.json({ ok: true, bead });
  } catch (error) {
    if (error instanceof BeadNotFoundError) {
      return c.json({ error: 'not_found', details: error.message }, 404);
    }
    if (error instanceof BeadAdapterError) {
      return c.json({ error: 'beads_adapter_error', details: error.message }, 502);
    }
    throw error;
  }
});

export default app;
