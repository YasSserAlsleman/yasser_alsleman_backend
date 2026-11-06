import dotenv from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const backendDirectory = resolve(fileURLToPath(new URL('../..', import.meta.url)))
dotenv.config({ path: resolve(backendDirectory, '.env') })

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGODB_URI: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  MEDIA_STORAGE_DIR: z.string().min(1).default('storage/media'),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
  throw new Error(`Invalid server environment: ${details}`)
}

export const config = {
  ...parsed.data,
  mediaDirectory: resolve(backendDirectory, parsed.data.MEDIA_STORAGE_DIR),
  secureCookies: parsed.data.NODE_ENV === 'production',
  mediaStorageConfigured: true,
}
