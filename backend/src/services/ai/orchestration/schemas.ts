import { z } from 'zod';

export const planSchema = z
  .object({
    objective: z.string(),
    intent: z.enum(['conversation', 'explanation', 'analysis', 'change', 'document']),
    scope: z.array(z.string()),
    criteria: z.array(z.string()),
    direct_reply: z.string().nullable(),
    data_requirements: z.array(z.string()),
    tasks: z.array(
      z
        .object({
          id: z.string(),
          title: z.string(),
          instruction: z.string(),
          criteria: z.array(z.string()),
          depends_on: z.array(z.string()),
          tools: z.array(z.string()),
          data_requirements: z.array(z.string()),
        })
        .strict()
    ),
  })
  .strict();
export const draftSchema = z
  .object({
    answer: z.string(),
    source_ids: z.array(z.number().int()),
    limitations: z.array(
      z
        .object({
          subject: z.string(),
          kind: z.enum(['data', 'permission', 'business', 'technical']),
          detail: z.string(),
          source_ids: z.array(z.number().int()),
        })
        .strict()
    ),
  })
  .strict();
export const checkSchema = z
  .object({
    verdict: z.enum(['accepted', 'revise', 'blocked']),
    summary: z.string(),
    issues: z.array(
      z
        .object({
          criterion: z.string(),
          problem: z.string(),
          correction: z.string(),
          source_ids: z.array(z.number().int()),
        })
        .strict()
    ),
    research: z.array(
      z.object({ tool: z.string(), arguments_json: z.string(), purpose: z.string() }).strict()
    ),
  })
  .strict();
export const answerSchema = z.object({ reply: z.string() }).strict();
