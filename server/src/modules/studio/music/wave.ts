import { closeSync, fstatSync, openSync, readSync } from 'node:fs'

/** Validate the complete PCM WAV returned by Music3, without loading audio into memory. */
export function verifyMusic3Wave(path: string) {
  const fd = openSync(path, 'r')
  const invalid = () => { throw new Error('invalid-music3-wave') }
  const read = (offset: number, length: number) => {
    const bytes = Buffer.alloc(length)
    if (readSync(fd, bytes, 0, length, offset) !== length) invalid()
    return bytes
  }
  try {
    const size = fstatSync(fd).size
    if (size < 44) invalid()
    const riff = read(0, 12)
    if (riff.toString('ascii', 0, 4) !== 'RIFF' || riff.toString('ascii', 8, 12) !== 'WAVE' || riff.readUInt32LE(4) + 8 !== size) invalid()
    let offset = 12, alignment = 0, dataBytes = 0, dataFound = false, chunks = 0
    while (offset < size) {
      // Bound synchronous metadata work even for adversarial streams of tiny chunks.
      if (++chunks > 4096) invalid()
      if (size - offset < 8) invalid()
      const header = read(offset, 8), kind = header.toString('ascii', 0, 4), length = header.readUInt32LE(4)
      const next = offset + 8 + length + (length % 2)
      if (next > size) invalid()
      if (kind === 'fmt ') {
        if (alignment || length < 16) invalid()
        const format = read(offset + 8, 16), channels = format.readUInt16LE(2), rate = format.readUInt32LE(4)
        // Official Music3 documents 16-bit PCM. Reject other codecs rather than treating headers as decoded audio.
        if (format.readUInt16LE(0) !== 1 || !channels || !rate || format.readUInt16LE(14) !== 16) invalid()
        alignment = channels * 2
        if (format.readUInt16LE(12) !== alignment || format.readUInt32LE(8) !== rate * alignment) invalid()
      } else if (kind === 'data') {
        if (dataFound || !length) invalid()
        dataFound = true; dataBytes = length
      }
      offset = next
    }
    if (!alignment || !dataFound || dataBytes % alignment) invalid()
  } finally { closeSync(fd) }
}
