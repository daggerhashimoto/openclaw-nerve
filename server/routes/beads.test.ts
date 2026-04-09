import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const getBeadDetailMock = vi.fn();

vi.mock('../lib/beads.js', () => ({
  getBeadDetail: (...args: unknown[]) => getBeadDetailMock(...args),
  BeadNotFoundError: class BeadNotFoundError extends Error {},
  BeadAdapterError: class BeadAdapterError extends Error {},
}));

describe('beads routes', () => {
  beforeEach(() => {
    getBeadDetailMock.mockReset();
  });

  async function buildApp() {
    vi.resetModules();
    const mod = await import('./beads.js');
    const app = new Hono();
    app.route('/', mod.default);
    return app;
  }

  it('returns bead detail for a known bead id', async () => {
    getBeadDetailMock.mockResolvedValue({
      id: 'nerve-fms2',
      title: 'Implement read-only bead viewer tab foundation',
      notes: 'Open a bead viewer tab.',
      status: 'in_progress',
      priority: 1,
      issueType: 'task',
      owner: 'Derrick',
      createdAt: '2026-04-06T13:23:33Z',
      updatedAt: '2026-04-06T13:26:10Z',
      closedAt: null,
      closeReason: null,
      dependencies: [{ id: 'nerve-qkdo', title: 'Create branch', status: 'closed', dependencyType: 'blocks' }],
      dependents: [],
      linkedPlan: {
        path: '.plans/2026-04-06-bead-viewer-tab-foundation-execution.md',
        title: 'Bead viewer tab foundation',
        planId: 'plan-bead-viewer-tab-foundation-execution',
        archived: false,
        status: 'In Progress',
        updatedAt: 123,
      },
    });

    const app = await buildApp();
    const res = await app.request('/api/beads/nerve-fms2');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      bead: expect.objectContaining({
        id: 'nerve-fms2',
        dependencies: [expect.objectContaining({ id: 'nerve-qkdo' })],
        linkedPlan: expect.objectContaining({
          path: '.plans/2026-04-06-bead-viewer-tab-foundation-execution.md',
        }),
      }),
    });
    expect(getBeadDetailMock).toHaveBeenCalledWith('nerve-fms2', {
      targetPath: undefined,
      currentDocumentPath: undefined,
      workspaceAgentId: undefined,
    });
  });

  it('passes explicit lookup context through to the bead lookup', async () => {
    getBeadDetailMock.mockResolvedValue({
      id: 'virtra-apex-docs-id2',
      title: 'Demo',
      notes: null,
      status: null,
      priority: null,
      issueType: null,
      owner: null,
      createdAt: null,
      updatedAt: null,
      closedAt: null,
      closeReason: null,
      dependencies: [],
      dependents: [],
      linkedPlan: null,
    });

    const app = await buildApp();
    const res = await app.request('/api/beads/virtra-apex-docs-id2?targetPath=../projects/virtra-apex-docs/.beads&currentDocumentPath=bead-link-dogfood.md&workspaceAgentId=main');

    expect(res.status).toBe(200);
    expect(getBeadDetailMock).toHaveBeenCalledWith('virtra-apex-docs-id2', {
      targetPath: '../projects/virtra-apex-docs/.beads',
      currentDocumentPath: 'bead-link-dogfood.md',
      workspaceAgentId: 'main',
    });
  });

  it('returns 404 when the bead is missing', async () => {
    const { BeadNotFoundError } = await import('../lib/beads.js');
    getBeadDetailMock.mockRejectedValue(new BeadNotFoundError('nerve-miss'));

    const app = await buildApp();
    const res = await app.request('/api/beads/nerve-miss');

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: 'not_found',
      details: 'nerve-miss',
    });
  });

  it('returns 502 when the bd adapter fails', async () => {
    const { BeadAdapterError } = await import('../lib/beads.js');
    getBeadDetailMock.mockRejectedValue(new BeadAdapterError('bd failed'));

    const app = await buildApp();
    const res = await app.request('/api/beads/nerve-fms2');

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: 'beads_adapter_error',
      details: 'bd failed',
    });
  });
});
