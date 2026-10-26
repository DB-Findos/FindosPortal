export type ChangeProposal = {
  token: string;
  title: string;
  entity: string;
  operation: 'create' | 'update' | 'archive';
  preview: Record<string, unknown>;
};
