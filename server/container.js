import { createMediaUseCases } from './application/media/media-use-cases.js'
import { mongooseMediaRepository } from './infrastructure/database/mongoose-media-repository.js'
import { deleteImage, uploadImage } from './infrastructure/storage/local-image-storage.js'

export const mediaUseCases = createMediaUseCases({
  mediaRepository: mongooseMediaRepository,
  imageStorage: { upload: uploadImage, delete: deleteImage },
})
