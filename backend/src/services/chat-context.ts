import { z } from 'zod';

export const chatViewContext = z
  .object({
    path: z.string().max(4000),
    view: z.string().max(200),
    entity: z.string().max(100).nullable(),
    content: z
      .object({
        capturedAt: z.iso.datetime(),
        title: z.string().max(1000),
        text: z.string().max(80000),
        controls: z
          .array(z.object({ label: z.string().max(2000), value: z.string().max(20000) }))
          .max(500),
        visuals: z
          .array(
            z.object({
              title: z.string().max(2000),
              labels: z.array(z.string().max(4000)).max(4000),
              image: z
                .string()
                .max(2000000)
                .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/)
                .optional(),
            })
          )
          .max(30),
        sources: z.array(z.object({ name: z.string().max(4000), data: z.unknown() })).max(60),
        limitations: z.array(z.string().max(4000)).max(100),
      })
      .optional(),
  })
  .refine((value) => JSON.stringify(value).length <= 3000000, 'Der Ansichtskontext ist zu groß.');

export type ChatViewContext = z.infer<typeof chatViewContext>;
export function textViewContext(context: ChatViewContext) {
  if (!context.content) return context;
  return {
    ...context,
    content: {
      ...context.content,
      visuals: context.content.visuals.map(({ image, ...visual }) => ({
        ...visual,
        imageAttached: !!image,
      })),
    },
  };
}
