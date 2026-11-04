import type { z } from 'zod';
import type { ChatViewContext } from '../../chat-context.js';
import type { ChatProgress } from '../../chat-progress.js';
import type { ChangeProposal } from '../../../mcp/changes.js';

export type ChatInput = {
  model?: string;
  reasoning_effort?: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  context: ChatViewContext;
};
export type BudgetPolicy = {
  effort: string;
  maxTasks: number;
  maxTools: number;
  maxModels: number;
  taskRounds: number;
  taskRepairs: number;
  synthesisRepairs: number;
  durationMs: number;
};
export type Task = {
  id: string;
  title: string;
  instruction: string;
  criteria: string[];
  depends_on: string[];
  tools: string[];
  data_requirements: string[];
};
export type Plan = {
  objective: string;
  intent: 'conversation' | 'explanation' | 'analysis' | 'change' | 'document';
  scope: string[];
  criteria: string[];
  direct_reply: string | null;
  data_requirements: string[];
  tasks: Task[];
};
export type Evidence = {
  id: number;
  tool: string;
  arguments: unknown;
  data: unknown;
  output: string;
};
export type TaskDraft = {
  answer: string;
  source_ids: number[];
  limitations: {
    subject: string;
    kind: 'data' | 'permission' | 'business' | 'technical';
    detail: string;
    source_ids: number[];
  }[];
};
export type Check = {
  verdict: 'accepted' | 'revise' | 'blocked';
  summary: string;
  issues: { criterion: string; problem: string; correction: string; source_ids: number[] }[];
  research: { tool: string; arguments_json: string; purpose: string }[];
};
export type TaskResult = {
  task: Task;
  status: 'accepted' | 'blocked' | 'unverified';
  draft: TaskDraft;
  check: Check;
  attempts: number;
};
export type Emit = (event: Omit<ChatProgress, 'at' | 'elapsed_ms'>) => void;
export type ChatResult = {
  reply: string;
  changes: ChangeProposal[];
  proposals: never[];
  steps: string[];
  document_ids: string[];
  progress: ChatProgress[];
  review: { status: string; model: string; passes: number };
  orchestration: {
    plan: Plan;
    budget: BudgetPolicy;
    usage: { models: number; tools: number; cacheHits: number };
    tasks: TaskResult[];
  };
};
export type FunctionTool = {
  type: 'function';
  name: string;
  description: string;
  parameters: unknown;
  strict: false;
};
export type ModelOptions = {
  schema: z.ZodType;
  name: string;
  tools?: FunctionTool[];
  outputTokens?: number;
  requireTool?: boolean;
  images?: { title: string; url: string }[];
};
