import { test, expect } from '@playwright/test'
test('durable task survives browser refresh and idempotent resubmission', async ({ page, request }) => {
  const health = await request.get('/api/health')
  const headers = { 'X-StoryForge-Generation': health.headers()['x-storyforge-generation'] }
  const created = await request.post('/api/studio/projects', { headers, data: { kind: 'music', title: 'durable refresh' } })
  expect(created.status()).toBe(201)
  const p = await created.json()
  const body = { version: p.version, prompt: 'local song', idempotencyKey: 'browser-' + p.id }
  const response = await request.post(`/api/studio/projects/${p.id}/generate`, { headers, data: body })
  expect(response.status()).toBe(202)
  const task = await response.json()
  await page.goto('/#music'); await page.reload()
  const repeated = await request.post(`/api/studio/projects/${p.id}/generate`, { headers, data: body })
  expect(repeated.status()).toBe(202); expect((await repeated.json()).id).toBe(task.id)
  await expect.poll(async () => (await (await request.get(`/api/studio/projects/${p.id}/tasks`)).json())[0].status).toBe('completed')
  const tasks = await (await request.get(`/api/studio/projects/${p.id}/tasks`)).json()
  expect(tasks).toHaveLength(1)
  const audio = await request.get(`/api/studio/assets/${tasks[0].assetId}/content`)
  expect(audio.status()).toBe(200); expect((await audio.body()).subarray(0, 4).toString()).toBe('RIFF')
  expect((await request.post('/api/studio/webhooks/mock', { data: { status: 'completed' } })).status()).toBe(403)
})
