import express from 'express'
import session from 'express-session'
import MongoStore from 'connect-mongo'
import mongoose from 'mongoose'
import cors from 'cors'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import { config } from './infrastructure/config.js'
import { Admin } from './infrastructure/database/models.js'
import { api, errorMiddleware } from './presentation/http/routes.js'
import { ensureMediaStorageDirectory } from './infrastructure/storage/local-image-storage.js'

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', config.NODE_ENV === 'production' ? 1 : false)
const allowedOrigins = new Set([config.APP_ORIGIN])
if (config.NODE_ENV === 'development') {
  const configuredOrigin = new URL(config.APP_ORIGIN)
  const loopbackHosts = new Set(['localhost', '127.0.0.1'])
  if (loopbackHosts.has(configuredOrigin.hostname)) {
    for (const host of loopbackHosts) {
      const localOrigin = new URL(config.APP_ORIGIN)
      localOrigin.hostname = host
      allowedOrigins.add(localOrigin.origin)
    }
  }
}
const isAllowedOrigin = (origin) => allowedOrigins.has(origin)
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
app.use((req, res, next) => {
  const origin = req.get('origin')
  if (origin && !isAllowedOrigin(origin)) return res.status(403).json({ error: 'Origin not allowed.' })
  next()
})
app.use(cors({
  origin(origin, callback) {
    if (!origin || isAllowedOrigin(origin)) return callback(null, true)
    return callback(new Error('Origin is not allowed by CORS.'))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key'],
  maxAge: 600,
}))
app.use('/api/media-files', express.static(config.mediaDirectory, {
  dotfiles: 'deny',
  fallthrough: false,
  index: false,
  maxAge: '1y',
  immutable: true,
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff')
  },
}))
app.use(express.json({ limit: '100kb', strict: true }))
app.use(express.urlencoded({ extended: false, limit: '20kb', parameterLimit: 50 }))
app.use(session({
  name: 'cms.sid',
  secret: config.SESSION_SECRET,
  store: MongoStore.create({ mongoUrl: config.MONGODB_URI, collectionName: 'cms_sessions', ttl: 60 * 60 * 8 }),
  resave: false,
  saveUninitialized: false,
  rolling: false,
  cookie: {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000,
    path: '/',
  },
}))
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 500,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (req) => req.path === '/health',
}))
app.use('/api', api)
app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }))
app.use(errorMiddleware)

let server
let scheduledPublisher

async function publishScheduled() {
  const due = await mongoose.connection.collection('articles').find({
    status: 'scheduled', scheduledAt: { $lte: new Date() },
  }).toArray()
  for (const article of due) {
    await mongoose.connection.collection('articles').updateOne(
      { _id: article._id, status: 'scheduled' },
      { $set: { content: article.draft || article.content, status: 'published', publishedAt: new Date() }, $unset: { draft: '' } },
    )
  }
}

async function start() {
  await ensureMediaStorageDirectory()
  await mongoose.connect(config.MONGODB_URI, { serverSelectionTimeoutMS: 10000 })
  await Admin.init()
  server = app.listen(config.PORT, () => {
    console.info(`CMS API listening on port ${config.PORT}`)
  })
  scheduledPublisher = setInterval(() => {
    publishScheduled().catch((error) => console.error('Scheduled publishing failed:', error.message))
  }, 60_000)
  scheduledPublisher.unref()
}

async function shutdown(signal) {
  console.info(`${signal} received; shutting down`)
  clearInterval(scheduledPublisher)
  if (server) await new Promise((resolve) => server.close(resolve))
  await mongoose.disconnect()
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
start().catch((error) => {
  console.error('CMS API failed to start:', error.message)
  process.exitCode = 1
})
