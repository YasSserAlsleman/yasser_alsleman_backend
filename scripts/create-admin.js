import 'dotenv/config'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import { z } from 'zod'
import { Admin } from '../server/infrastructure/database/models.js'

const credentials = z.object({
  MONGODB_URI: z.string().min(1),
  ADMIN_EMAIL: z.string().email().max(254),
  ADMIN_PASSWORD: z.string().min(14).max(200),
}).safeParse(process.env)

if (!credentials.success) {
  console.error('Set MONGODB_URI, ADMIN_EMAIL, and ADMIN_PASSWORD (at least 14 characters) in your private environment.')
  process.exit(1)
}

await mongoose.connect(credentials.data.MONGODB_URI)
try {
  const email = credentials.data.ADMIN_EMAIL.toLowerCase()
  const existing = await Admin.findOne({ email })
  if (existing) throw new Error('An administrator with this email already exists; no account was changed.')
  const passwordHash = await bcrypt.hash(credentials.data.ADMIN_PASSWORD, 12)
  await Admin.create({ email, passwordHash })
  console.info(`Initial administrator created for ${email}. Remove the bootstrap credentials from your environment.`)
} finally {
  await mongoose.disconnect()
}
