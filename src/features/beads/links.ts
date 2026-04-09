const BEAD_ID_PATTERN = /^[A-Za-z0-9]+-[A-Za-z0-9][A-Za-z0-9_-]*$/;
const LEGACY_BEAD_SCHEME = 'bead:';
const EXPLICIT_BEAD_SCHEME = 'bead://';

export interface BeadLinkTarget {
  beadId: string;
  explicitTargetPath?: string;
  currentDocumentPath?: string;
  workspaceAgentId?: string;
}

function decodeUriComponentOrRaw(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isAbsoluteFilesystemPath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
}

export function isBeadId(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('/') || trimmed.includes('.') || trimmed.includes('#') || trimmed.includes('?')) {
    return false;
  }
  return BEAD_ID_PATTERN.test(trimmed);
}

export function isSyntacticallyValidExplicitBeadHref(href: string): boolean {
  if (!href) return false;

  const trimmed = href.trim();
  if (!trimmed.toLowerCase().startsWith(EXPLICIT_BEAD_SCHEME)) return false;

  const rawPayload = trimmed.slice(EXPLICIT_BEAD_SCHEME.length);
  const hashIndex = rawPayload.indexOf('#');
  if (hashIndex <= 0 || hashIndex === rawPayload.length - 1) return false;

  const rawTargetPath = decodeUriComponentOrRaw(rawPayload.slice(0, hashIndex)).trim();
  const beadId = decodeUriComponentOrRaw(rawPayload.slice(hashIndex + 1)).trim();
  return Boolean(rawTargetPath) && isBeadId(beadId);
}

export function isBeadLinkHref(href: string): boolean {
  return parseBeadLinkHref(href) !== null;
}

export function decodeBeadLinkHref(href: string): string {
  return parseBeadLinkHref(href)?.beadId ?? href.trim();
}

export function parseBeadLinkHref(
  href: string,
  options: {
    currentDocumentPath?: string;
    workspaceAgentId?: string;
  } = {},
): BeadLinkTarget | null {
  if (!href) return null;

  const trimmed = href.trim();
  if (!trimmed) return null;

  if (trimmed.toLowerCase().startsWith(EXPLICIT_BEAD_SCHEME)) {
    const rawPayload = trimmed.slice(EXPLICIT_BEAD_SCHEME.length);
    const hashIndex = rawPayload.indexOf('#');
    if (hashIndex <= 0 || hashIndex === rawPayload.length - 1) return null;

    const rawTargetPath = decodeUriComponentOrRaw(rawPayload.slice(0, hashIndex)).trim();
    const beadId = decodeUriComponentOrRaw(rawPayload.slice(hashIndex + 1)).trim();
    if (!rawTargetPath || !isBeadId(beadId)) return null;

    const currentDocumentPath = options.currentDocumentPath?.trim();
    if (!isAbsoluteFilesystemPath(rawTargetPath) && !currentDocumentPath) {
      return null;
    }

    return {
      beadId,
      explicitTargetPath: rawTargetPath,
      currentDocumentPath,
      workspaceAgentId: options.workspaceAgentId?.trim() || undefined,
    };
  }

  if (!trimmed.toLowerCase().startsWith(LEGACY_BEAD_SCHEME)) return null;

  const beadId = decodeUriComponentOrRaw(trimmed.slice(LEGACY_BEAD_SCHEME.length)).trim();
  if (!isBeadId(beadId)) return null;

  return { beadId };
}

export function buildBeadTabId(target: BeadLinkTarget | string): string {
  if (typeof target === 'string') {
    return `bead:${target}`;
  }

  if (!target.explicitTargetPath) {
    return `bead:${target.beadId}`;
  }

  const workspaceAgentId = target.workspaceAgentId?.trim() || 'main';
  const currentDocumentPath = target.currentDocumentPath?.trim() || '';
  return `bead://${workspaceAgentId}:${currentDocumentPath}:${target.explicitTargetPath}#${target.beadId}`;
}
