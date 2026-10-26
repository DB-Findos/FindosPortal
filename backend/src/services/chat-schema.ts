import { z } from 'zod';
export const privateChatEntities = new Set([
  'chat_conversations',
  'chat_messages',
  'chat_documents',
  'chat_message_files',
]);
const id = z.uuid();
export const chatDefinitions = {
  chat_conversations: {
    label: 'Conversations',
    readonly: true,
    schema: z.object({
      owner_id: id,
      title: z.string(),
      model: z.string(),
      reasoning_effort: z.string(),
    }),
    refs: { owner_id: 'users' },
  },
  chat_messages: {
    label: 'Chat Messages',
    readonly: true,
    schema: z.object({
      conversation_id: id,
      role: z.enum(['user', 'assistant']),
      content: z.string(),
      sent_at: z.string(),
      reply_to_id: id.nullable(),
      response_time_ms: z.number().nullable(),
      model: z.string(),
      reasoning_effort: z.string(),
      status: z.string(),
      metadata: z.record(z.string(), z.unknown()),
    }),
    refs: { conversation_id: 'chat_conversations', reply_to_id: 'chat_messages' },
  },
  chat_documents: {
    label: 'Chat Documents',
    readonly: true,
    schema: z.object({
      owner_id: id,
      conversation_id: id,
      name: z.string(),
      document_at: z.string(),
      url: z.string(),
      extension: z.string(),
      mime_type: z.string(),
      size_bytes: z.number(),
      source: z.enum(['upload', 'generated']),
      sha256: z.string(),
      extraction_note: z.string().nullable(),
    }),
    refs: { owner_id: 'users', conversation_id: 'chat_conversations' },
  },
  chat_message_files: {
    label: 'Message Attachments',
    readonly: true,
    schema: z.object({ message_id: id, document_id: id }),
    refs: { message_id: 'chat_messages', document_id: 'chat_documents' },
  },
} as const;
