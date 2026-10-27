import test from 'node:test'
import assert from 'node:assert/strict'
import { MockVideoAdapter, readVideoConfiguration, validateVideo } from '../../shared/video/model.js'
import type { StudioProject } from '../../shared/contracts/studio.js'
const configuration = { aspectRatio: '16:9', shots: [{ id: 'first', description: '虚构的海边清晨', duration: 5, camera: '缓慢推进' }] }
test('video adapter includes script, shot duration, camera and aspect ratio without network access', () => {
  const project = { content: '小船驶入港湾', settings: { aspectRatio: configuration.aspectRatio, shots: JSON.stringify(configuration.shots) } } as StudioProject
  const prompt = new MockVideoAdapter().prompt(project)
  for (const value of ['小船驶入港湾', '16:9', '5 秒', '缓慢推进', '海边清晨']) assert.ok(prompt.includes(value))
  assert.deepEqual(readVideoConfiguration(project.settings), configuration)
})
test('video configuration rejects invalid ratios, durations, descriptions and duplicate IDs', () => {
  validateVideo(configuration)
  assert.throws(() => validateVideo({ ...configuration, aspectRatio: '2:3' }))
  assert.throws(() => validateVideo({ ...configuration, shots: [...configuration.shots, ...configuration.shots] }))
  for (const duration of [0, 61, NaN, Infinity]) assert.throws(() => validateVideo({ ...configuration, shots: [{ ...configuration.shots[0], duration }] }))
  assert.throws(() => validateVideo({ ...configuration, shots: [{ ...configuration.shots[0], description: ' ' }] }))
})
