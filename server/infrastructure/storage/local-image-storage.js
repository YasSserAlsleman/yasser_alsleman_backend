import { randomUUID } from 'node:crypto'
import { access, mkdir, unlink, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { fileTypeFromBuffer } from 'file-type'
import { config } from '../config.js'

const acceptedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])

function storageError(message, status) {
  return Object.assign(new Error(message), { status })
}

export async function ensureMediaStorageDirectory() {
  await mkdir(config.mediaDirectory, { recursive: true })
  await access(config.mediaDirectory, constants.W_OK)
}

export function createLocalImageStorage(directory) {
  return {
    async upload(file) {
      if (!file?.buffer) throw storageError('Choose an image to upload.', 400)
      const detected = await fileTypeFromBuffer(file.buffer)
      if (
        !detected ||
        !acceptedImageTypes.has(detected.mime) ||
        (file.mimetype && file.mimetype !== detected.mime)
      ) {
        throw storageError('The uploaded file is not a supported image.', 415)
      }

      const { data, info } = await sharp(file.buffer, { failOn: 'error' })
        .rotate()
        .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true })
      if (info.size > 10 * 1024 * 1024) {
        throw storageError('The optimized image exceeds the 10 MB storage limit.', 413)
      }
      const publicId = `${randomUUID()}.webp`
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, publicId), data, { flag: 'wx' })

      const url = `/api/media-files/${publicId}`
      return {
        publicId,
        url,
        secureUrl: url,
        format: 'webp',
        width: info.width,
        height: info.height,
        bytes: info.size,
      }
    },

    async delete(publicId) {
      if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\.webp$/i.test(publicId)) {
        throw storageError('Invalid media identifier.', 400)
      }
      await unlink(join(directory, publicId))
    },
  }
}

const localImageStorage = createLocalImageStorage(config.mediaDirectory)

export const uploadImage = (file) => localImageStorage.upload(file)
export const deleteImage = (publicId) => localImageStorage.delete(publicId)
