export interface BeadRelationSummary {
  id: string;
  title: string | null;
  status: string | null;
  dependencyType: string | null;
}

export interface BeadLinkedPlanSummary {
  path: string;
  title: string;
  planId: string | null;
  archived: boolean;
  status: string | null;
  updatedAt: number;
}

export interface BeadDetail {
  id: string;
  title: string;
  notes: string | null;
  status: string | null;
  priority: number | null;
  issueType: string | null;
  owner: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  dependencies: BeadRelationSummary[];
  dependents: BeadRelationSummary[];
  linkedPlan: BeadLinkedPlanSummary | null;
}

export interface OpenBeadTab {
  id: string;
  beadId: string;
  name: string;
  explicitTargetPath?: string;
  currentDocumentPath?: string;
  workspaceAgentId?: string;
}
