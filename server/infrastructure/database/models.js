import mongoose from 'mongoose'

const { Schema } = mongoose
const localized = {
  en: { type: String, trim: true, default: '' },
  ar: { type: String, trim: true, default: '' },
}
const localizedSchema = new Schema(localized, { _id: false })
const localizedField = { type: localizedSchema, default: () => ({}) }
const seoSchema = new Schema({
  title: localizedField,
  description: localizedField,
}, { _id: false })

const adminSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['admin'], default: 'admin', immutable: true },
  active: { type: Boolean, default: true },
  passwordChangedAt: { type: Date, default: Date.now },
  lastLoginAt: Date,
}, { timestamps: true })

const profileSchema = new Schema({
  key: { type: String, default: 'primary', unique: true },
  name: { type: localizedSchema, required: true },
  title: localizedField,
  introduction: localizedField,
  biography: localizedField,
  email: { type: String, trim: true, lowercase: true, maxlength: 254 },
  location: localizedField,
  profileImage: { type: Schema.Types.ObjectId, ref: 'Media' },
  socials: { type: Map, of: String, default: {} },
  availability: { type: Boolean, default: false },
}, { timestamps: true })

const imageSchema = new Schema({
  media: { type: Schema.Types.ObjectId, ref: 'Media', required: true },
  alt: localizedSchema,
  order: { type: Number, min: 0, default: 0 },
}, { _id: false })
const contentSchema = new Schema({
  title: { type: localizedSchema, required: true },
  slug: { type: String, trim: true, lowercase: true, maxlength: 180 },
  category: localizedField,
  summary: localizedField,
  description: localizedField,
  technologies: [{ type: String, trim: true, maxlength: 50 }],
  location: localizedField,
  year: { type: Number, min: 1900, max: 2200 },
  cover: { type: Schema.Types.ObjectId, ref: 'Media' },
  images: [imageSchema],
  problem: localizedField,
  solution: localizedField,
  role: localizedField,
  challenges: localizedField,
  decisions: localizedField,
  implementation: localizedField,
  results: localizedField,
  seo: seoSchema,
}, { _id: false })
const projectSchema = new Schema({
  content: { type: contentSchema, required: true },
  draft: contentSchema,
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', index: true },
  featured: { type: Boolean, default: false },
  order: { type: Number, min: 0, default: 0 },
  publishedAt: Date,
  createdBy: { type: Schema.Types.ObjectId, ref: 'Admin', required: true },
}, { timestamps: true })
projectSchema.index({ status: 1, featured: -1, order: 1, updatedAt: -1 })
projectSchema.index({ 'content.slug': 1 }, { unique: true, sparse: true })

const serviceSchema = new Schema({
  title: localizedField,
  description: localizedField,
  technologies: [{ type: String, trim: true, maxlength: 50 }],
  icon: { type: String, maxlength: 80, default: 'Code2' },
  image: { type: Schema.Types.ObjectId, ref: 'Media' },
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', index: true },
  order: { type: Number, min: 0, default: 0 },
}, { timestamps: true })

const articleContentSchema = new Schema({
  title: localizedField,
  slug: { type: String, trim: true, lowercase: true, maxlength: 180 },
  summary: localizedField,
  body: localizedField,
  category: localizedField,
  tags: [{ type: String, trim: true, maxlength: 40 }],
  cover: { type: Schema.Types.ObjectId, ref: 'Media' },
  seo: seoSchema,
}, { _id: false })
const articleSchema = new Schema({
  content: { type: articleContentSchema, required: true },
  draft: articleContentSchema,
  status: { type: String, enum: ['draft', 'published', 'archived', 'scheduled'], default: 'draft', index: true },
  scheduledAt: Date,
  publishedAt: Date,
  createdBy: { type: Schema.Types.ObjectId, ref: 'Admin', required: true },
}, { timestamps: true })
articleSchema.index({ status: 1, publishedAt: -1 })
articleSchema.index({ 'content.slug': 1 }, { unique: true, sparse: true })

const pageSectionSchema = new Schema({
  key: { type: String, required: true, unique: true, trim: true, lowercase: true },
  title: localizedField,
  content: localizedField,
  enabled: { type: Boolean, default: true },
  order: { type: Number, min: 0, default: 0 },
}, { timestamps: true })

const inquirySchema = new Schema({
  inquiryId: { type: String, required: true, unique: true },
  idempotencyKey: { type: String, unique: true, sparse: true, select: false },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  subject: { type: String, trim: true, maxlength: 200, default: '' },
  message: { type: String, required: true, trim: true, maxlength: 5000 },
  status: { type: String, enum: ['new', 'in-progress', 'replied', 'archived'], default: 'new', index: true },
  internalNotes: { type: String, maxlength: 5000, default: '' },
}, { timestamps: true })
inquirySchema.index({ createdAt: -1 })
inquirySchema.index({ name: 'text', email: 'text', subject: 'text', message: 'text' })

const settingsSchema = new Schema({
  key: { type: String, default: 'primary', unique: true },
  logo: { type: Schema.Types.ObjectId, ref: 'Media' },
  brandName: localizedField,
  brandInfo: localizedField,
  contactEmail: { type: String, trim: true, lowercase: true, maxlength: 254 },
  phone: { type: String, trim: true, maxlength: 40 },
  whatsapp: { type: String, trim: true, maxlength: 40 },
  address: localizedField,
  socials: { type: Map, of: String, default: {} },
  languages: { type: [String], enum: ['en', 'ar'], default: ['en', 'ar'] },
  defaultLanguage: { type: String, enum: ['en', 'ar'], default: 'en' },
  footer: localizedField,
  seo: seoSchema,
}, { timestamps: true })

const mediaSchema = new Schema({
  publicId: { type: String, required: true, unique: true },
  url: { type: String, required: true },
  secureUrl: { type: String, required: true },
  format: { type: String, required: true, enum: ['jpg', 'png', 'webp', 'avif'] },
  width: { type: Number, required: true },
  height: { type: Number, required: true },
  bytes: { type: Number, required: true, max: 10 * 1024 * 1024 },
  originalName: { type: String, maxlength: 255 },
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'Admin', required: true },
}, { timestamps: true })

const analyticsSchema = new Schema({
  path: { type: String, required: true, maxlength: 300, index: true },
  kind: { type: String, enum: ['page', 'project', 'article'], default: 'page' },
  contentId: { type: String, maxlength: 80 },
  day: { type: String, required: true },
}, { timestamps: true })
analyticsSchema.index({ createdAt: -1 })
analyticsSchema.index({ day: 1, path: 1 })

const activitySchema = new Schema({
  actor: { type: Schema.Types.ObjectId, ref: 'Admin' },
  action: { type: String, required: true, maxlength: 80 },
  entity: { type: String, required: true, maxlength: 80 },
  entityId: { type: String, maxlength: 80 },
  summary: { type: String, maxlength: 300, default: '' },
}, { timestamps: true })
activitySchema.index({ createdAt: -1 })

const testimonialSchema = new Schema({
  author: localizedField,
  role: localizedField,
  quote: localizedField,
  enabled: { type: Boolean, default: false },
  order: { type: Number, min: 0, default: 0 },
}, { timestamps: true })

export const Admin = mongoose.model('Admin', adminSchema)
export const Profile = mongoose.model('Profile', profileSchema)
export const Project = mongoose.model('Project', projectSchema)
export const Service = mongoose.model('Service', serviceSchema)
export const Article = mongoose.model('Article', articleSchema)
export const PageSection = mongoose.model('PageSection', pageSectionSchema)
export const Inquiry = mongoose.model('Inquiry', inquirySchema)
export const SiteSettings = mongoose.model('SiteSettings', settingsSchema)
export const Media = mongoose.model('Media', mediaSchema)
export const AnalyticsEvent = mongoose.model('AnalyticsEvent', analyticsSchema)
export const ActivityLog = mongoose.model('ActivityLog', activitySchema)
export const Testimonial = mongoose.model('Testimonial', testimonialSchema)
