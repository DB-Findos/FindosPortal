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
export type ChatProgress = {
  stage:
    | 'context'
    | 'planning'
    | 'task'
    | 'model'
    | 'tool'
    | 'review'
    | 'retry'
    | 'synthesis'
    | 'complete'
    | 'warning';
  summary: string;
  at: string;
  elapsed_ms: number;
  taskId?: string;
  taskTitle?: string;
  status?: 'pending' | 'running' | 'checking' | 'accepted' | 'blocked' | 'failed' | 'info';
  details?: string[];
  reason?: string;
  plan?: {
    objective: string;
    scope: string[];
    tasks: { id: string; title: string; criteria: string[] }[];
    effort: string;
    maxRepairs: number;
    maxSeconds: number;
  };
};
export type ChatRunSnapshot = {
  run_id: string;
  conversation_id: string;
  started_at: string;
  cursor: number;
  status: 'queued' | 'running' | 'complete' | 'error' | 'cancelled';
  events: { sequence: number; progress: ChatProgress }[];
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
  metadata: {
    changes?: ChangeProposal[];
    steps?: string[];
    committed_indices?: number[];
    progress?: ChatProgress[];
    review?: { status: string; model: string; passes: number };
  };
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
