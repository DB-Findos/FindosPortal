import { z } from 'zod';
import { httpError } from '../shared/errors.js';
export const reasoningEffort = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
export function chatModels() {
  const defaults = [
    { id: 'gpt-5-mini', label: 'GPT-5 mini', efforts: ['minimal', 'low', 'medium', 'high'] },
    { id: 'gpt-5', label: 'GPT-5', efforts: ['minimal', 'low', 'medium', 'high'] },
    { id: 'gpt-4.1', label: 'GPT-4.1', efforts: ['none'] },
  ];
  const configured = process.env.OPENAI_CHAT_MODELS_JSON;
  const models = configured
    ? z
        .array(
          z.object({
            id: z.string().min(1),
            label: z.string(),
            efforts: z.array(reasoningEffort).min(1),
          })
        )
        .min(1)
        .parse(JSON.parse(configured))
    : defaults;
  const defaultModel = process.env.OPENAI_MODEL || 'gpt-5-mini';
  if (!models.some((model) => model.id === defaultModel))
    models.unshift({ id: defaultModel, label: defaultModel, efforts: ['low', 'medium', 'high'] });
  return { models, defaultModel };
}
export function validateChatModel(model: string, effort: string) {
  const item = chatModels().models.find((item) => item.id === model);
  if (!item || !item.efforts.includes(effort))
    throw httpError(400, 'Modell oder Reasoning-Effort nicht freigegeben.');
  return { model, effort, reasoning: item.efforts.some((value) => value !== 'none') };
}
