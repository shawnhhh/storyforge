import type { CreativeProvider, GenerationInput, GenerationOutput } from '../../../../shared/contracts/studio.js'
/** Local audible sine wave. No credentials, remote fetch or billing path. */
export class MockCreativeProvider implements CreativeProvider {
  readonly id = 'mock'
  async generate({ project }: GenerationInput): Promise<Extract<GenerationOutput,{data:Uint8Array}>> {
    if (project.kind === 'video') {
      // Deterministic 1s VP8 WebM fixture: generated locally, no remote provider.
      return { name: 'mock-storyboard.webm', mime: 'video/webm', data: Buffer.from('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAOcEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEjTbuMU6uEHFO7a1OsggOG7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjEuNy4xMDNXQYxMYXZmNjEuNy4xMDNEiYhAj0AAAAAAABZUrmvIrgEAAAAAAAA/14EBc8WIHsjSEjdAKe6cgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QF9eEA4JCwgaC6gVqagQJVsIRVuYEBElTDZ/tzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYxLjcuMTAzc3PWY8CLY8WIHsjSEjdAKe5nyKFFo4dFTkNPREVSRIeUTGF2YzYxLjE5LjEwMSBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAxLjAwMDAwMDAwMAAfQ7Z1Qd3ngQCjQNqBAACAkAoAnQEqoABaAABHCIWFiIWEiAICAnXVofqvEVMR5A1Cv1/+j/9DP/Ab017APkzB6NneDZ5mKnCtn4hAXkoUdNc0Vm/zMguPIwU9wH4D9Dy1j7xQxTIoQ2TZ5mO0AP7/OcbG7yql2S9+81f/+W7v/75P/+1PM//Jv6gB+D/7yJGfp0ABs/ge0dsAAAf3/+3imAAAYp8m8D997//fyf/7ROz/8iwPN5p4zt30iGh/UPgkbwAABduHreb1Cs13/k7lgAAALt8O2spbyAAAAXd8ZdT0h4AAAKOsgQBkALECAAEQEAAYABkBN/QAOx2tTBwgT1rpYAE4AAAAAAAAAJUAAAAAAACjmIEAyAARAgABEBAAGAAYWC/0AAiAgQAAAKOYgQEsABECAAEQEAAYABhYL/QACICBAAAAo5iBAZAAEQIAARAQABgAGFgv9AAIgIEAAACjmIEB9AARAgABEBAAGAAYWC/0AAiAgQAAAKOYgQJYABECAAEQEAAYABhYL/QACICBAAAAo5eBArwA8QEAARAQFGAAYWC/0AAiAgQAAKOYgQMgABECAAEQEAAYABhYL/QACICBAAAAo5iBA4QAEQIAARAQABgAGFgv9AAIgIEAAAAcU7trkbuPs4EAt4r3gQHxggGj8IED', 'base64') }
    }
    const rate = 16000, count = rate * 2, data = new Uint8Array(44 + count * 2), view = new DataView(data.buffer)
    const text = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)))
    text(0, 'RIFF'); view.setUint32(4, data.length - 8, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, count * 2, true)
    for (let i = 0; i < count; i++) view.setInt16(44 + i * 2, Math.sin(i / rate * Math.PI * 440 * 2) * 4000 * Math.min(1, i / 800, (count - i) / 800), true)
    return { name: 'mock-music.wav', mime: 'audio/wav', data }
  }
}
