import 'dotenv/config'
import mongoose from 'mongoose'
import {
  ActivityLog, Admin, AnalyticsEvent, Article, Inquiry, Media, PageSection,
  Profile, Project, Service, SiteSettings, Testimonial,
} from '../server/infrastructure/database/models.js'

const uri = process.env.MONGODB_URI
if (!uri) {
  console.error('Set MONGODB_URI in your private environment before running migrations.')
  process.exit(1)
}

const models = [
  ActivityLog, Admin, AnalyticsEvent, Article, Inquiry, Media, PageSection,
  Profile, Project, Service, SiteSettings, Testimonial,
]

try {
  await mongoose.connect(uri)
  for (const model of models) {
    await model.createIndexes()
    console.info(`Indexes verified: ${model.collection.collectionName}`)
  }
} finally {
  if (mongoose.connection.readyState) await mongoose.disconnect()
}
