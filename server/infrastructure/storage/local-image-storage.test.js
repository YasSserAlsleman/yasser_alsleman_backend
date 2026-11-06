import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { createLocalImageStorage } from './local-image-storage.js'

async function withStorage(run) {
  const directory = await mkdtemp(join(tmpdir(), 'cms-media-'))
  try {
    await run(createLocalImageStorage(directory), directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('local image storage validates, optimizes, and writes uploaded images', async () => {
  await withStorage(async (storage, directory) => {
    const buffer = await sharp({
      create: { width: 64, height: 48, channels: 3, background: '#456789' },
    }).png().toBuffer()
    const result = await storage.upload({ buffer })

    assert.match(result.publicId, /^[\da-f-]+\.webp$/i)
    assert.equal(result.url, `/api/media-files/${result.publicId}`)
    assert.equal(result.secureUrl, result.url)
    assert.equal(result.format, 'webp')
    assert.equal(result.width, 64)
    assert.equal(result.height, 48)
    assert.ok(result.bytes > 0)
    assert.equal((await readFile(join(directory, result.publicId))).subarray(0, 4).toString(), 'RIFF')
  })
})

test('local image storage rejects files with unsupported signatures', async () => {
  await withStorage(async (storage, directory) => {
    await assert.rejects(storage.upload({ buffer: Buffer.from('not an image') }), (error) => error.status === 415)
    assert.deepEqual(await readdir(directory), [])
  })
})

test('local image storage rejects a MIME type that does not match the file signature', async () => {
  await withStorage(async (storage, directory) => {
    const buffer = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#456789' },
    }).png().toBuffer()
    await assert.rejects(
      storage.upload({ buffer, mimetype: 'image/jpeg' }),
      (error) => error.status === 415,
    )
    assert.deepEqual(await readdir(directory), [])
  })
})

test('local image storage deletes only generated media filenames', async () => {
  await withStorage(async (storage) => {
    await assert.rejects(storage.delete('../outside.webp'), (error) => error.status === 400)
  })
})
