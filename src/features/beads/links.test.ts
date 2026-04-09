import { describe, expect, it } from 'vitest';
import { buildBeadTabId, decodeBeadLinkHref, isBeadId, isBeadLinkHref, isSyntacticallyValidExplicitBeadHref, parseBeadLinkHref } from './links';

describe('bead link helpers', () => {
  it('recognizes legacy bead shorthand and explicit bead URIs', () => {
    expect(isBeadId('nerve-fms2')).toBe(true);
    expect(isBeadLinkHref('bead:nerve-fms2')).toBe(true);
    expect(isBeadLinkHref('bead:///repos/demo#nerve-fms2')).toBe(true);
  });

  it('rejects bare bead ids and normal file paths as markdown bead links', () => {
    expect(isBeadLinkHref('nerve-fms2')).toBe(false);
    expect(isBeadId('.plans/demo.md')).toBe(false);
    expect(isBeadLinkHref('docs/todo.md')).toBe(false);
  });

  it('parses legacy same-context bead links', () => {
    expect(parseBeadLinkHref('bead:nerve-fms2')).toEqual({ beadId: 'nerve-fms2' });
    expect(decodeBeadLinkHref('bead:nerve-fms2')).toBe('nerve-fms2');
    expect(buildBeadTabId('nerve-fms2')).toBe('bead:nerve-fms2');
  });

  it('parses explicit absolute bead URIs with custom payload parsing', () => {
    expect(parseBeadLinkHref('bead:///home/alice/work/repos/demo/.beads#nerve-fms2')).toEqual({
      beadId: 'nerve-fms2',
      explicitTargetPath: '/home/alice/work/repos/demo/.beads',
      currentDocumentPath: undefined,
      workspaceAgentId: undefined,
    });
  });

  it('preserves relative explicit bead targets and the current document context', () => {
    expect(parseBeadLinkHref('bead://../projects/demo#nerve-fms2', {
      currentDocumentPath: 'notes/beads.md',
      workspaceAgentId: 'research',
    })).toEqual({
      beadId: 'nerve-fms2',
      explicitTargetPath: '../projects/demo',
      currentDocumentPath: 'notes/beads.md',
      workspaceAgentId: 'research',
    });
  });

  it('rejects relative explicit bead URIs when there is no current document path', () => {
    expect(parseBeadLinkHref('bead://../projects/demo#nerve-fms2')).toBeNull();
  });

  it('still recognizes syntactically valid explicit bead URIs before context-aware resolution', () => {
    expect(isSyntacticallyValidExplicitBeadHref('bead://../projects/demo#nerve-fms2')).toBe(true);
    expect(isBeadLinkHref('bead://../projects/demo#nerve-fms2')).toBe(false);
  });

  it('builds distinct tab ids for explicit bead targets', () => {
    expect(buildBeadTabId({
      beadId: 'nerve-fms2',
      explicitTargetPath: '../projects/demo',
      currentDocumentPath: 'notes/beads.md',
      workspaceAgentId: 'research',
    })).toBe('bead://research:notes/beads.md:../projects/demo#nerve-fms2');
  });
});
