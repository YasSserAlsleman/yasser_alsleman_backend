import { randomUUID, createHash } from 'node:crypto'
import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import multer from 'multer'
import mongoose from 'mongoose'
import { z } from 'zod'
import { config } from '../../infrastructure/config.js'
import { mediaUseCases } from '../../container.js'
import {
  ActivityLog, Admin, AnalyticsEvent, Article, Inquiry, Media, PageSection,
  Profile, Project, Service, SiteSettings, Testimonial,
} from '../../infrastructure/database/models.js'
import {
  createCsrfToken, recordActivity, requireAdmin, requireCsrf,
  validate,
} from './security.js'

export const api = Router()
const publicRouter = Router()
const admin = Router()
const idSchema = z.string().refine((value) => mongoose.isValidObjectId(value), 'Invalid ID.')
const localized = z.object({ en: z.string().trim().max(5000).optional(), ar: z.string().trim().max(5000).optional() }).strict()
const seo = z.object({
  title: z.object({ en: z.string().trim().max(70).optional(), ar: z.string().trim().max(70).optional() }).optional(),
  description: z.object({ en: z.string().trim().max(180).optional(), ar: z.string().trim().max(180).optional() }).optional(),
}).optional()
const socialUrl = z.string().trim().max(300).url().refine((value) => /^https?:\/\//i.test(value), 'Social links must use HTTP or HTTPS.')
const projectContent = z.object({
  title: z.object({ en: z.string().trim().max(180).optional(), ar: z.string().trim().max(180).optional() }).refine((value) => Boolean(value.en || value.ar), 'Enter a title in at least one language.'),
  slug: z.string().trim().min(1).max(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  category: localized.optional(),
  summary: z.object({ en: z.string().trim().max(1000).optional(), ar: z.string().trim().max(1000).optional() }).optional(),
  description: localized.optional(),
  technologies: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
  location: localized.optional(),
  year: z.number().int().min(1900).max(2200).optional(),
  cover: z.string().optional().nullable(),
  images: z.array(z.object({ media: z.string(), alt: localized.optional(), order: z.number().int().min(0) }).strict()).max(40).default([]),
  problem: localized.optional(), solution: localized.optional(), role: localized.optional(),
  challenges: localized.optional(), decisions: localized.optional(),
  implementation: localized.optional(), results: localized.optional(), seo,
}).strict()
const serviceInput = z.object({
  title: localized, description: localized, technologies: z.array(z.string().trim().max(50)).max(30).default([]),
  icon: z.string().trim().max(80).default('Code2'), image: z.string().nullable().optional(),
  status: z.enum(['draft', 'published', 'archived']).default('draft'), order: z.number().int().min(0).default(0),
}).strict()
const articleContent = z.object({
  title: z.object({ en: z.string().trim().max(180).optional(), ar: z.string().trim().max(180).optional() }).refine((value) => Boolean(value.en || value.ar), 'Enter a title in at least one language.'),
  slug: z.string().trim().min(1).max(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  summary: z.object({ en: z.string().trim().max(1000).optional(), ar: z.string().trim().max(1000).optional() }).optional(),
  body: localized.optional(), category: localized.optional(),
  tags: z.array(z.string().trim().max(40)).max(30).default([]), cover: z.string().optional().nullable(), seo,
}).strict()
const articleInput = z.object({
  content: articleContent, status: z.enum(['draft', 'published', 'archived', 'scheduled']).default('draft'),
  scheduledAt: z.string().datetime().optional().nullable(),
}).strict()
const inquiryInput = z.object({
  name: z.string().trim().min(1).max(120), email: z.string().trim().email().max(254),
  subject: z.string().trim().max(200).optional().default(''),
  message: z.string().trim().min(4).max(5000), website: z.string().max(500).optional(),
}).strict()
const settingsInput = z.object({
  brandName: localized.optional(), brandInfo: localized.optional(),
  logo: z.string().nullable().optional(),
  contactEmail: z.string().email().max(254).optional().or(z.literal('')),
  phone: z.string().max(40).optional(), whatsapp: z.string().max(40).optional(),
  address: localized.optional(), socials: z.record(z.string().max(40), socialUrl).optional(),
  languages: z.array(z.enum(['en', 'ar'])).min(1).max(2).optional(),
  defaultLanguage: z.enum(['en', 'ar']).optional(), footer: localized.optional(), seo,
}).strict()
const profileInput = z.object({
  name: localized, title: localized.optional(), introduction: localized.optional(), biography: localized.optional(),
  email: z.string().email().max(254).optional().or(z.literal('')), location: localized.optional(),
  profileImage: z.string().nullable().optional(), socials: z.record(z.string().max(40), socialUrl).optional(),
  availability: z.boolean().optional(),
}).strict()
const messageStatus = z.enum(['new', 'in-progress', 'replied', 'archived'])
const sectionInput = z.object({
  title: localized.optional(), content: localized.optional(),
  enabled: z.boolean().optional(), order: z.number().int().min(0).optional(),
}).strict()
const testimonialInput = z.object({
  author: localized, role: localized.optional(), quote: localized,
  enabled: z.boolean().default(false), order: z.number().int().min(0).default(0),
}).strict()

const publicLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: 'draft-8', legacyHeaders: false })
const inquiryLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false })
const analyticsLimit = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false })
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.mimetype)) {
      return callback(Object.assign(new Error('Only JPEG, PNG, WebP, and AVIF images are allowed.'), { status: 415 }))
    }
    callback(null, true)
  },
})

function responseError(error, fallback = 'Operation failed.') {
  if (error?.code === 11000) return { status: 409, message: 'A record with the same unique value already exists.' }
  if (error?.name === 'CastError') return { status: 400, message: 'Invalid identifier.' }
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') return { status: 413, message: 'Uploaded image exceeds the 10 MB limit.' }
    return { status: 400, message: 'Invalid media upload.' }
  }
  return { status: error?.status || 500, message: error?.status ? error.message : fallback }
}

function pageResult(query, page, limit) {
  return query.skip((page - 1) * limit).limit(limit)
}

function pagination(req) {
  return {
    page: Math.max(1, Number.parseInt(req.query.page, 10) || 1),
    limit: Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20)),
  }
}

function searchFilter(value) {
  if (typeof value !== 'string' || !value.trim()) return {}
  const escaped = value.trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return { $or: [{ 'content.title.en': { $regex: escaped, $options: 'i' } }, { 'content.title.ar': { $regex: escaped, $options: 'i' } }, { 'content.slug': { $regex: escaped, $options: 'i' } }] }
}

function logActivity(req, action, entity, entityId, summary) {
  recordActivity(req.admin._id, action, entity, entityId, summary).catch((error) => {
    console.error('Failed to record CMS activity:', error.message)
  })
}

api.use('/public', publicLimit, publicRouter)
api.use('/admin', admin)

api.get('/health', async (_req, res) => {
  try {
    if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
      return res.status(503).json({
        status: 'unavailable',
        services: { database: 'unavailable', mediaStorageConfigured: config.mediaStorageConfigured },
      })
    }
    await mongoose.connection.db.admin().ping()
    return res.json({
      status: 'ok',
      services: { database: 'connected', mediaStorageConfigured: config.mediaStorageConfigured },
    })
  } catch (error) {
    console.error('Database health check failed:', error.message)
    return res.status(503).json({
      status: 'unavailable',
      services: { database: 'unavailable', mediaStorageConfigured: config.mediaStorageConfigured },
    })
  }
})

api.post('/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false }), async (req, res) => {
  const body = validate(z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) }).strict(), req.body)
  const account = await Admin.findOne({ email: body.email.toLowerCase(), active: true }).select('+passwordHash')
  const valid = account && await bcrypt.compare(body.password, account.passwordHash)
  if (!valid) return res.status(401).json({ error: 'Email or password is incorrect.' })
  await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()))
  req.session.adminId = account.id
  req.session.csrfToken = createCsrfToken()
  account.lastLoginAt = new Date()
  await account.save()
  req.session.authVersion = account.passwordChangedAt.getTime()
  res.json({ admin: { id: account.id, email: account.email, role: account.role }, csrfToken: req.session.csrfToken })
})

api.get('/auth/session', requireAdmin, (req, res) => res.json({
  admin: { id: req.admin._id, email: req.admin.email, role: req.admin.role },
  csrfToken: req.session.csrfToken,
}))

api.post('/auth/change-password', requireAdmin, requireCsrf, async (req, res) => {
  const body = validate(z.object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(14).max(200),
  }).strict(), req.body)
  const account = await Admin.findById(req.admin._id).select('+passwordHash')
  if (!account || !await bcrypt.compare(body.currentPassword, account.passwordHash)) {
    return res.status(400).json({ error: 'Current password is incorrect.' })
  }
  account.passwordHash = await bcrypt.hash(body.newPassword, 12)
  account.passwordChangedAt = new Date(Math.max(Date.now(), account.passwordChangedAt.getTime() + 1))
  await account.save()
  await new Promise((resolve, reject) => req.session.destroy((error) => error ? reject(error) : resolve()))
  res.clearCookie('cms.sid', { httpOnly: true, sameSite: 'strict', secure: config.secureCookies, path: '/' })
  res.status(204).end()
})

api.post('/auth/logout', requireAdmin, requireCsrf, async (req, res) => {
  await new Promise((resolve, reject) => req.session.destroy((error) => error ? reject(error) : resolve()))
  res.clearCookie('cms.sid', { httpOnly: true, sameSite: 'strict', secure: config.secureCookies, path: '/' })
  res.status(204).end()
})

admin.use(requireAdmin)
admin.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  return requireCsrf(req, res, next)
})

admin.get('/overview', async (_req, res) => {
  const [publishedProjects, draftProjects, articles, newInquiries, visits, recentActivity, messages] = await Promise.all([
    Project.countDocuments({ status: 'published' }), Project.countDocuments({ status: 'draft' }),
    Article.countDocuments({ status: 'published' }), Inquiry.countDocuments({ status: 'new' }),
    AnalyticsEvent.countDocuments({ kind: 'page', createdAt: { $gte: new Date(Date.now() - 30 * 86400000) } }),
    ActivityLog.find().sort({ createdAt: -1 }).limit(8).lean(),
    Inquiry.find({ status: 'new' }).sort({ createdAt: -1 }).limit(5).lean(),
  ])
  res.json({ data: { publishedProjects, draftProjects, articles, newInquiries, visits, recentActivity, messages } })
})

admin.get('/analytics', async (req, res) => {
  const requestedDays = Number.parseInt(req.query.days, 10) || 30
  const days = Math.min(90, Math.max(1, requestedDays))
  const since = new Date(Date.now() - days * 86400000)
  const [result] = await AnalyticsEvent.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $facet: {
      daily: [{ $group: { _id: '$day', visits: { $sum: 1 } } }, { $sort: { _id: 1 } }],
      pages: [{ $group: { _id: '$path', visits: { $sum: 1 } } }, { $sort: { visits: -1 } }, { $limit: 10 }],
      total: [{ $count: 'visits' }],
    } },
  ])
  res.json({ data: { days, totalVisits: result.total[0]?.visits || 0, daily: result.daily, topPages: result.pages } })
})

admin.get('/profile', async (_req, res) => res.json({ data: await Profile.findOne({ key: 'primary' }).populate('profileImage', 'secureUrl width height').lean() }))
admin.put('/profile', async (req, res) => {
  const data = validate(profileInput, req.body)
  const profile = await Profile.findOneAndUpdate({ key: 'primary' }, { $set: data, $setOnInsert: { key: 'primary' } }, { new: true, upsert: true, runValidators: true })
  logActivity(req, 'updated', 'profile', profile.id, 'Profile settings updated')
  res.json({ data: profile })
})

admin.get('/projects', async (req, res) => {
  const { page, limit } = pagination(req)
  const filter = { ...searchFilter(req.query.search) }
  if (['draft', 'published', 'archived'].includes(req.query.status)) filter.status = req.query.status
  if (req.query.featured === 'true' || req.query.featured === 'false') filter.featured = req.query.featured === 'true'
  if (typeof req.query.category === 'string') filter['content.category.en'] = req.query.category.slice(0, 100)
  const [items, total] = await Promise.all([
    pageResult(Project.find(filter).sort({ order: 1, updatedAt: -1 }).populate('content.cover draft.cover content.images.media draft.images.media', 'secureUrl width height format'), page, limit).lean(),
    Project.countDocuments(filter),
  ])
  res.json({ data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})
admin.post('/projects', async (req, res) => {
  const body = validate(z.object({
    content: projectContent,
    featured: z.boolean().optional(),
    order: z.number().int().min(0).optional(),
  }).strict(), req.body)
  const content = body.content
  const project = await Project.create({ content, draft: content, featured: body.featured, order: body.order, status: 'draft', createdBy: req.admin._id })
  logActivity(req, 'created', 'project', project.id, content.title.en)
  res.status(201).json({ data: project })
})
admin.get('/projects/:id', async (req, res) => {
  const id = validate(idSchema, req.params.id)
  const project = await Project.findById(id).populate('content.cover draft.cover content.images.media draft.images.media', 'secureUrl width height format').lean()
  if (!project) return res.status(404).json({ error: 'Project not found.' })
  res.json({ data: project })
})
admin.get('/projects/:id/preview', async (req, res) => {
  const project = await Project.findById(validate(idSchema, req.params.id)).populate('draft.cover draft.images.media', 'secureUrl width height format').lean()
  if (!project) return res.status(404).json({ error: 'Project not found.' })
  res.json({ data: { ...project, content: project.draft || project.content, preview: true } })
})
admin.put('/projects/:id/draft', async (req, res) => {
  const id = validate(idSchema, req.params.id)
  const body = validate(z.object({
    content: projectContent,
    featured: z.boolean().optional(),
    order: z.number().int().min(0).optional(),
  }).strict(), req.body)
  const changes = { draft: body.content }
  if (body.featured !== undefined) changes.featured = body.featured
  if (body.order !== undefined) changes.order = body.order
  const project = await Project.findByIdAndUpdate(id, { $set: changes }, { new: true, runValidators: true })
  if (!project) return res.status(404).json({ error: 'Project not found.' })
  logActivity(req, 'saved draft', 'project', id, body.content.title.en || body.content.title.ar)
  res.json({ data: project })
})
admin.post('/projects/:id/publish', async (req, res) => {
  const id = validate(idSchema, req.params.id)
  const project = await Project.findById(id)
  if (!project) return res.status(404).json({ error: 'Project not found.' })
  project.content = project.draft || project.content
  project.draft = undefined
  project.status = 'published'
  project.publishedAt = new Date()
  await project.save()
  logActivity(req, 'published', 'project', id, project.content.title.en)
  res.json({ data: project })
})
admin.patch('/projects/:id/status', async (req, res) => {
  const id = validate(idSchema, req.params.id)
  const body = validate(z.object({ status: z.enum(['draft', 'published', 'archived']) }).strict(), req.body)
  const project = await Project.findById(id)
  if (!project) return res.status(404).json({ error: 'Project not found.' })
  if (body.status === 'published') {
    project.content = project.draft || project.content
    project.draft = undefined
    project.publishedAt = new Date()
  }
  project.status = body.status
  await project.save()
  logActivity(req, body.status, 'project', id, project.content.title.en)
  res.json({ data: project })
})
admin.delete('/projects/:id', async (req, res) => {
  const id = validate(idSchema, req.params.id)
  const project = await Project.findByIdAndDelete(id)
  if (!project) return res.status(404).json({ error: 'Project not found.' })
  logActivity(req, 'deleted', 'project', id, project.content.title.en)
  res.status(204).end()
})

admin.get('/services', async (_req, res) => res.json({ data: await Service.find().sort({ order: 1, createdAt: 1 }).populate('image', 'secureUrl width height').lean() }))
admin.post('/services', async (req, res) => {
  const data = validate(serviceInput, req.body)
  const service = await Service.create(data)
  logActivity(req, 'created', 'service', service.id, data.title.en || data.title.ar)
  res.status(201).json({ data: service })
})
admin.put('/services/:id', async (req, res) => {
  const id = validate(idSchema, req.params.id)
  const data = validate(serviceInput.partial(), req.body)
  const service = await Service.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true })
  if (!service) return res.status(404).json({ error: 'Service not found.' })
  logActivity(req, 'updated', 'service', id, service.title.en || service.title.ar)
  res.json({ data: service })
})
admin.delete('/services/:id', async (req, res) => {
  const service = await Service.findByIdAndDelete(validate(idSchema, req.params.id))
  if (!service) return res.status(404).json({ error: 'Service not found.' })
  logActivity(req, 'deleted', 'service', service.id, service.title.en || service.title.ar)
  res.status(204).end()
})
admin.put('/services/order', async (req, res) => {
  const data = validate(z.object({ ids: z.array(z.string()).min(1).max(100) }).strict(), req.body)
  await Promise.all(data.ids.map((id, order) => Service.findByIdAndUpdate(validate(idSchema, id), { $set: { order } })))
  res.json({ data: await Service.find().sort({ order: 1 }).lean() })
})

admin.get('/articles', async (req, res) => {
  const { page, limit } = pagination(req)
  const filter = {}
  if (['draft', 'published', 'archived', 'scheduled'].includes(req.query.status)) filter.status = req.query.status
  if (typeof req.query.search === 'string' && req.query.search.trim()) {
    const escaped = req.query.search.trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    filter.$or = [{ 'content.title.en': { $regex: escaped, $options: 'i' } }, { 'content.title.ar': { $regex: escaped, $options: 'i' } }]
  }
  const [items, total] = await Promise.all([
    pageResult(Article.find(filter).sort({ publishedAt: -1, updatedAt: -1 }).populate('content.cover draft.cover', 'secureUrl width height'), page, limit).lean(),
    Article.countDocuments(filter),
  ])
  res.json({ data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})
admin.post('/articles', async (req, res) => {
  const data = validate(articleInput, req.body)
  const article = await Article.create({ content: data.content, draft: data.content, status: data.status === 'published' ? 'draft' : data.status, scheduledAt: data.scheduledAt, createdBy: req.admin._id })
  logActivity(req, 'created', 'article', article.id, data.content.title.en || data.content.title.ar)
  res.status(201).json({ data: article })
})
admin.put('/articles/:id', async (req, res) => {
  const id = validate(idSchema, req.params.id)
  const data = validate(articleInput, req.body)
  const article = await Article.findById(id)
  if (!article) return res.status(404).json({ error: 'Article not found.' })
  article.draft = data.content
  if (data.status !== 'published') article.status = data.status
  article.scheduledAt = data.scheduledAt
  await article.save()
  logActivity(req, 'updated', 'article', id, data.content.title.en || data.content.title.ar)
  res.json({ data: article })
})
admin.post('/articles/:id/publish', async (req, res) => {
  const article = await Article.findById(validate(idSchema, req.params.id))
  if (!article) return res.status(404).json({ error: 'Article not found.' })
  article.content = article.draft || article.content
  article.draft = undefined
  article.status = 'published'
  article.publishedAt = new Date()
  await article.save()
  logActivity(req, 'published', 'article', article.id, article.content.title.en || article.content.title.ar)
  res.json({ data: article })
})
admin.get('/articles/:id', async (req, res) => {
  const article = await Article.findById(validate(idSchema, req.params.id)).populate('content.cover draft.cover', 'secureUrl width height').lean()
  if (!article) return res.status(404).json({ error: 'Article not found.' })
  res.json({ data: article })
})
admin.get('/articles/:id/preview', async (req, res) => {
  const article = await Article.findById(validate(idSchema, req.params.id)).populate('draft.cover', 'secureUrl width height').lean()
  if (!article) return res.status(404).json({ error: 'Article not found.' })
  res.json({ data: { ...article, content: article.draft || article.content, preview: true } })
})
admin.delete('/articles/:id', async (req, res) => {
  const article = await Article.findByIdAndDelete(validate(idSchema, req.params.id))
  if (!article) return res.status(404).json({ error: 'Article not found.' })
  logActivity(req, 'deleted', 'article', article.id, article.content.title.en || article.content.title.ar)
  res.status(204).end()
})

admin.get('/pages', async (_req, res) => res.json({ data: await PageSection.find().sort({ order: 1 }).lean() }))
admin.put('/pages', async (req, res) => {
  const data = validate(z.object({ sections: z.array(z.object({ key: z.string().trim().min(1).max(80), ...sectionInput.shape }).strict()).max(30) }).strict(), req.body)
  const ops = data.sections.map((section) => ({ updateOne: { filter: { key: section.key }, update: { $set: section }, upsert: true } }))
  if (ops.length) await PageSection.bulkWrite(ops)
  res.json({ data: await PageSection.find().sort({ order: 1 }).lean() })
})
admin.get('/testimonials', async (_req, res) => res.json({ data: await Testimonial.find().sort({ order: 1 }).lean() }))
admin.post('/testimonials', async (req, res) => {
  const data = validate(testimonialInput, req.body)
  const testimonial = await Testimonial.create(data)
  logActivity(req, 'created', 'testimonial', testimonial.id, data.author.en || data.author.ar)
  res.status(201).json({ data: testimonial })
})
admin.put('/testimonials/:id', async (req, res) => {
  const testimonial = await Testimonial.findByIdAndUpdate(validate(idSchema, req.params.id), { $set: validate(testimonialInput.partial(), req.body) }, { new: true, runValidators: true })
  if (!testimonial) return res.status(404).json({ error: 'Testimonial not found.' })
  logActivity(req, 'updated', 'testimonial', testimonial.id, testimonial.author.en || testimonial.author.ar)
  res.json({ data: testimonial })
})
admin.delete('/testimonials/:id', async (req, res) => {
  const testimonial = await Testimonial.findByIdAndDelete(validate(idSchema, req.params.id))
  if (!testimonial) return res.status(404).json({ error: 'Testimonial not found.' })
  res.status(204).end()
})

admin.get('/inquiries', async (req, res) => {
  const { page, limit } = pagination(req)
  const filter = {}
  if (['new', 'in-progress', 'replied', 'archived'].includes(req.query.status)) filter.status = req.query.status
  if (typeof req.query.search === 'string' && req.query.search.trim()) {
    const escaped = req.query.search.trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    filter.$or = ['name', 'email', 'subject', 'message'].map((field) => ({ [field]: { $regex: escaped, $options: 'i' } }))
  }
  const [items, total] = await Promise.all([
    pageResult(Inquiry.find(filter).sort({ createdAt: -1 }), page, limit).lean(), Inquiry.countDocuments(filter),
  ])
  res.json({ data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})
admin.patch('/inquiries/:id', async (req, res) => {
  const body = validate(z.object({ status: messageStatus.optional(), internalNotes: z.string().max(5000).optional() }).strict(), req.body)
  const inquiry = await Inquiry.findByIdAndUpdate(validate(idSchema, req.params.id), { $set: body }, { new: true, runValidators: true })
  if (!inquiry) return res.status(404).json({ error: 'Inquiry not found.' })
  logActivity(req, 'updated', 'inquiry', inquiry.id, inquiry.status)
  res.json({ data: inquiry })
})
admin.delete('/inquiries/:id', async (req, res) => {
  const inquiry = await Inquiry.findByIdAndDelete(validate(idSchema, req.params.id))
  if (!inquiry) return res.status(404).json({ error: 'Inquiry not found.' })
  res.status(204).end()
})

admin.get('/settings', async (_req, res) => res.json({ data: await SiteSettings.findOne({ key: 'primary' }).populate('logo', 'secureUrl width height').lean() }))
admin.put('/settings', async (req, res) => {
  const data = validate(settingsInput, req.body)
  const settings = await SiteSettings.findOneAndUpdate({ key: 'primary' }, { $set: data, $setOnInsert: { key: 'primary' } }, { new: true, upsert: true, runValidators: true })
  logActivity(req, 'updated', 'settings', settings.id, 'Website settings updated')
  res.json({ data: settings })
})

admin.get('/media', async (req, res) => {
  const { page, limit } = pagination(req)
  const [items, total] = await Promise.all([pageResult(Media.find().sort({ createdAt: -1 }), page, limit).lean(), Media.countDocuments()])
  res.json({ data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})
admin.post('/media', upload.single('file'), async (req, res) => {
  const media = await mediaUseCases.upload(req.file, req.admin._id)
  logActivity(req, 'uploaded', 'media', media.id, media.originalName)
  res.status(201).json({ data: media })
})
admin.delete('/media/:id', async (req, res) => {
  await mediaUseCases.delete(validate(idSchema, req.params.id))
  res.status(204).end()
})

publicRouter.get('/home', async (_req, res) => {
  const [profile, settings, services, projects, articles, sections, testimonials] = await Promise.all([
    Profile.findOne({ key: 'primary' }).populate('profileImage', 'secureUrl width height').lean(),
    SiteSettings.findOne({ key: 'primary' }).populate('logo', 'secureUrl width height').lean(),
    Service.find({ status: 'published' }).sort({ order: 1 }).populate('image', 'secureUrl width height').lean(),
    Project.find({ status: 'published' }).select('-draft -createdBy').sort({ featured: -1, order: 1, publishedAt: -1 }).populate('content.cover content.images.media', 'secureUrl width height').lean(),
    Article.find({ status: 'published', publishedAt: { $lte: new Date() } }).select('-draft -createdBy').sort({ publishedAt: -1 }).populate('content.cover', 'secureUrl width height').limit(10).lean(),
    PageSection.find({ enabled: true }).sort({ order: 1 }).lean(),
    Testimonial.find({ enabled: true }).sort({ order: 1 }).lean(),
  ])
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  res.json({ data: { profile, settings, services, projects, articles, sections, testimonials } })
})
publicRouter.get('/projects', async (_req, res) => {
  const projects = await Project.find({ status: 'published' }).select('-draft -createdBy').sort({ featured: -1, order: 1, publishedAt: -1 }).populate('content.cover content.images.media', 'secureUrl width height').lean()
  res.json({ data: projects })
})
publicRouter.get('/projects/:slug', async (req, res) => {
  const project = await Project.findOne({ 'content.slug': req.params.slug, status: 'published' }).select('-draft -createdBy').populate('content.cover content.images.media', 'secureUrl width height').lean()
  if (!project) return res.status(404).json({ error: 'Project not found.' })
  res.json({ data: project })
})
publicRouter.get('/services', async (_req, res) => res.json({ data: await Service.find({ status: 'published' }).sort({ order: 1 }).populate('image', 'secureUrl width height').lean() }))
publicRouter.get('/articles', async (_req, res) => res.json({ data: await Article.find({ status: 'published', publishedAt: { $lte: new Date() } }).select('-draft -createdBy').sort({ publishedAt: -1 }).populate('content.cover', 'secureUrl width height').lean() }))
publicRouter.get('/articles/:slug', async (req, res) => {
  const article = await Article.findOne({ 'content.slug': req.params.slug, status: 'published', publishedAt: { $lte: new Date() } }).select('-draft -createdBy').populate('content.cover', 'secureUrl width height').lean()
  if (!article) return res.status(404).json({ error: 'Article not found.' })
  res.json({ data: article })
})
publicRouter.get('/settings', async (_req, res) => {
  const settings = await SiteSettings.findOne({ key: 'primary' }).select('-_id logo brandName brandInfo contactEmail phone whatsapp address socials languages defaultLanguage footer seo').populate('logo', 'secureUrl width height').lean()
  res.json({ data: settings })
})
publicRouter.get('/testimonials', async (_req, res) => res.json({ data: await Testimonial.find({ enabled: true }).sort({ order: 1 }).lean() }))
publicRouter.post('/inquiries', inquiryLimit, async (req, res) => {
  const body = validate(inquiryInput, req.body)
  if (body.website) return res.status(202).json({ data: { inquiryId: randomUUID() } })
  const key = req.get('idempotency-key')
  if (key && (key.length < 16 || key.length > 200)) return res.status(400).json({ error: 'Invalid idempotency key.' })
  const idempotencyKey = key ? createHash('sha256').update(key).digest('hex') : undefined
  if (idempotencyKey) {
    const duplicate = await Inquiry.findOne({ idempotencyKey }).select('inquiryId').lean()
    if (duplicate) return res.status(200).json({ data: { inquiryId: duplicate.inquiryId } })
  }
  try {
    const inquiry = await Inquiry.create({ inquiryId: randomUUID(), idempotencyKey, name: body.name, email: body.email.toLowerCase(), subject: body.subject, message: body.message })
    res.status(201).json({ data: { inquiryId: inquiry.inquiryId } })
  } catch (error) {
    if (error?.code === 11000 && idempotencyKey) {
      const duplicate = await Inquiry.findOne({ idempotencyKey }).select('inquiryId').lean()
      if (duplicate) return res.status(200).json({ data: { inquiryId: duplicate.inquiryId } })
    }
    throw error
  }
})
publicRouter.post('/analytics', analyticsLimit, async (req, res) => {
  const body = validate(z.object({ path: z.string().trim().min(1).max(300), kind: z.enum(['page', 'project', 'article']).default('page'), contentId: z.string().max(80).optional() }).strict(), req.body)
  const path = body.path.split('?')[0].replace(/\/{2,}/g, '/')
  await AnalyticsEvent.create({ ...body, path, day: new Date().toISOString().slice(0, 10) })
  res.status(202).end()
})

export function errorMiddleware(error, req, res, _next) {
  req.log?.error({ error }, 'API request failed')
  const result = responseError(error)
  res.status(result.status).json({ error: result.message, ...(error.details ? { details: error.details } : {}) })
}
