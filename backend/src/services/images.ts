import { z } from 'zod';
const mime = z.enum(['image/png', 'image/jpeg', 'image/webp']);
export const imageInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    mime_type: mime,
    data_base64: z.string().min(32).max(1398104),
  })
  .strict()
  .superRefine((value, context) => {
    const bytes = Buffer.from(value.data_base64, 'base64');
    const canonical = bytes.toString('base64') === value.data_base64;
    const valid =
      value.mime_type === 'image/png'
        ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        : value.mime_type === 'image/jpeg'
          ? bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
          : bytes.subarray(0, 4).toString() === 'RIFF' &&
            bytes.subarray(8, 12).toString() === 'WEBP';
    if (!canonical || bytes.length > 1048576 || bytes.length < 32 || !valid)
      context.addIssue({
        code: 'custom',
        path: ['data_base64'],
        message: 'Bitte ein gültiges PNG-, JPEG- oder WebP-Bild bis 1 MB hochladen.',
      });
  });
