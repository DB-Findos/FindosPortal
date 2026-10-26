export type ChangeProposal = {
  token: string;
  title: string;
  entity: string;
  operation: 'create' | 'update' | 'archive';
  preview: Record<string, unknown>;
};

export type ChatDocument = {
  objectId: string;
  name: string;
  url: string;
  size_bytes: number;
  extension: string;
  source: 'upload' | 'generated';
  extraction_note?: string | null;
};
export type ChatMessage = {
  objectId: string;
  role: 'user' | 'assistant';
  content: string;
  sent_at: string;
  reply_to_id: string | null;
  response_time_ms: number | null;
  model: string;
  reasoning_effort: string;
  status: 'complete' | 'error';
  files: ChatDocument[];
  metadata: { changes?: ChangeProposal[]; steps?: string[]; committed_indices?: number[] };
};
export type Conversation = {
  objectId: string;
  title: string;
  model: string;
  reasoning_effort: string;
  updated_at?: string;
};
export type ConversationDetail = { conversation: Conversation; messages: ChatMessage[] };
export type ChatModel = { id: string; label: string; efforts: string[] };
