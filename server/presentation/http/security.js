import { randomBytes, timingSafeEqual } from 'node:crypto'
import sanitizeHtml from 'sanitize-html'
import { z } from 'zod'
import { ActivityLog, Admin } from '../../infrastructure/database/models.js'

export const localizedText = z.object({
  en: z.string().trim().max(5000).optional(),
  ar: z.string().trim().max(5000).optional(),
}).strict()

export function sanitizeText(value) {
  return typeof value === 'string'
    ? sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).trim()
    : value
}

export function sanitizeDeep(value) {
  if (typeof value === 'string') return sanitizeText(value)
  if (Array.isArray(value)) return value.map(sanitizeDeep)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeDeep(item)]))
  }
  return value
}

export function validate(schema, input) {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    const error = new Error('Request validation failed.')
    error.status = 400
    error.details = parsed.error.issues.map(({ path, message }) => ({ path: path.join('.'), message }))
    throw error
  }
  return sanitizeDeep(parsed.data)
}

export async function requireAdmin(req, res, next) {
  try {
    if (!req.session.adminId) return res.status(401).json({ error: 'Authentication required.' })
    const admin = await Admin.findOne({ _id: req.session.adminId, active: true }).select('_id email role passwordChangedAt').lean()
    if (!admin || req.session.authVersion !== admin.passwordChangedAt?.getTime()) {
      req.session.destroy(() => {})
      return res.status(401).json({ error: 'Authentication expired.' })
    }
    req.admin = admin
    next()
  } catch (error) {
    next(error)
  }
}

export function requireCsrf(req, res, next) {
  const expected = req.session.csrfToken
  const received = req.get('x-csrf-token')
  if (!expected || !received) return res.status(403).json({ error: 'CSRF validation failed.' })
  const expectedBuffer = Buffer.from(expected)
  const receivedBuffer = Buffer.from(received)
  if (expectedBuffer.length !== receivedBuffer.length || !timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return res.status(403).json({ error: 'CSRF validation failed.' })
  }
  next()
}

export function createCsrfToken() {
  return randomBytes(32).toString('base64url')
}

export function requireOrigin(allowedOrigin) {
  return (req, res, next) => {
    const origin = req.get('origin')
    if (origin && origin !== allowedOrigin) return res.status(403).json({ error: 'Origin not allowed.' })
    next()
  }
}

export async function recordActivity(adminId, action, entity, entityId, summary = '') {
  await ActivityLog.create({ actor: adminId, action, entity, entityId: String(entityId ?? ''), summary })
}
