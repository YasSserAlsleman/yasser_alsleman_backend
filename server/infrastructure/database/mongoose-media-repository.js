import { Article, Media, Profile, Project, Service, SiteSettings } from './models.js'

export const mongooseMediaRepository = {
  create: (data) => Media.create(data),
  findById: (id) => Media.findById(id),
  async isInUse(id) {
    const references = await Promise.all([
      Project.exists({ $or: [{ 'content.cover': id }, { 'draft.cover': id }, { 'content.images.media': id }, { 'draft.images.media': id }] }),
      Service.exists({ image: id }),
      Article.exists({ $or: [{ 'content.cover': id }, { 'draft.cover': id }] }),
      Profile.exists({ profileImage: id }),
      SiteSettings.exists({ logo: id }),
    ])
    return references.some(Boolean)
  },
  delete: (media) => media.deleteOne(),
}
