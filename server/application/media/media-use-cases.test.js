import test from 'node:test'
import assert from 'node:assert/strict'
import { createMediaUseCases } from './media-use-cases.js'

function setup(overrides = {}) {
  const calls = []
  const media = { _id: 'media-id', publicId: 'image-id' }
  const useCases = createMediaUseCases({
    mediaRepository: {
      create: async (data) => { calls.push(['create', data]); return media },
      findById: async () => media,
      isInUse: async () => false,
      delete: async () => { calls.push(['delete']) },
      ...overrides.mediaRepository,
    },
    imageStorage: {
      upload: async () => ({ publicId: 'image-id', secureUrl: 'https://images.example/image.webp' }),
      delete: async (id) => { calls.push(['storage-delete', id]) },
      ...overrides.imageStorage,
    },
  })
  return { calls, media, useCases }
}

test('media upload stores the image metadata and administrator', async () => {
  const { calls, media, useCases } = setup()
  const file = { originalname: 'cover.webp' }

  assert.equal(await useCases.upload(file, 'admin-id'), media)
  assert.deepEqual(calls, [['create', {
    publicId: 'image-id',
    secureUrl: 'https://images.example/image.webp',
    originalName: 'cover.webp',
    uploadedBy: 'admin-id',
  }]])
})

test('media upload removes the stored file if database persistence fails', async () => {
  const { calls, useCases } = setup({
    mediaRepository: { create: async () => { throw new Error('database unavailable') } },
  })

  await assert.rejects(useCases.upload({ originalname: 'cover.webp' }, 'admin-id'), /database unavailable/)
  assert.deepEqual(calls, [['storage-delete', 'image-id']])
})

test('media deletion refuses to remove a referenced image', async () => {
  const { calls, useCases } = setup({
    mediaRepository: { isInUse: async () => true },
  })

  await assert.rejects(useCases.delete('media-id'), (error) => error.status === 409)
  assert.deepEqual(calls, [])
})

test('media deletion removes the image from storage before its record', async () => {
  const { calls, useCases } = setup()

  await useCases.delete('media-id')
  assert.deepEqual(calls, [['storage-delete', 'image-id'], ['delete']])
})
