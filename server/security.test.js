import test from 'node:test'
import assert from 'node:assert/strict'
import {
  localizedText, requireAdmin, requireCsrf, sanitizeText, validate,
} from './presentation/http/security.js'

function responseMock() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

test('sanitizeText strips markup and trims surrounding whitespace', () => {
  assert.equal(sanitizeText('  <script>alert(1)</script><b>Hello</b>  '), 'Hello')
})

test('validate rejects unknown fields and returns sanitized localized content', () => {
  assert.deepEqual(validate(localizedText, { en: '<b>Welcome</b>' }), { en: 'Welcome' })
  assert.throws(() => validate(localizedText, { en: 'Welcome', extra: true }), { status: 400 })
})

test('requireCsrf rejects missing and invalid tokens', () => {
  const res = responseMock()
  requireCsrf({ session: { csrfToken: 'expected' }, get: () => undefined }, res, () => assert.fail('Unexpected pass'))
  assert.equal(res.statusCode, 403)
  requireCsrf({ session: { csrfToken: 'expected' }, get: () => 'different' }, res, () => assert.fail('Unexpected pass'))
  assert.equal(res.statusCode, 403)
})

test('requireCsrf accepts a matching token', () => {
  const res = responseMock()
  let continued = false
  requireCsrf({ session: { csrfToken: 'expected' }, get: () => 'expected' }, res, () => { continued = true })
  assert.equal(continued, true)
})

test('requireAdmin rejects requests without an authenticated session', async () => {
  const res = responseMock()
  await requireAdmin({ session: {} }, res, () => assert.fail('Unexpected pass'))
  assert.equal(res.statusCode, 401)
  assert.equal(res.body.error, 'Authentication required.')
})
