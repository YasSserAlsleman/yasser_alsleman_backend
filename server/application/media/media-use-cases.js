function applicationError(message, status) {
  return Object.assign(new Error(message), { status })
}

export function createMediaUseCases({ mediaRepository, imageStorage }) {
  return {
    async upload(file, uploadedBy) {
      if (!file) throw applicationError('Choose an image to upload.', 400)
      const stored = await imageStorage.upload(file)
      try {
        return await mediaRepository.create({
          ...stored,
          originalName: file.originalname.slice(0, 255),
          uploadedBy,
        })
      } catch (error) {
        try {
          await imageStorage.delete(stored.publicId)
        } catch (cleanupError) {
          console.error('Failed to clean up an unreferenced uploaded image:', cleanupError.message)
        }
        throw error
      }
    },

    async delete(id) {
      const media = await mediaRepository.findById(id)
      if (!media) throw applicationError('Media file not found.', 404)
      if (await mediaRepository.isInUse(media._id)) {
        throw applicationError('This image is in use and cannot be deleted.', 409)
      }
      await imageStorage.delete(media.publicId)
      await mediaRepository.delete(media)
    },
  }
}
