/** Inventory only built files and dependency locks; never include data or .env. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const files: { path: string; bytes: number; sha256: string }[] = []
function walk(path: string) {
  for (const name of readdirSync(path).sort()) {
    const p = join(path, name), s = lstatSync(p)
    if (s.isSymbolicLink() || (!s.isDirectory() && (!s.isFile() || s.nlink !== 1))) throw Error('构建产物包含不安全链接或特殊文件')
    if (s.isDirectory()) walk(p)
    else files.push({ path: p, bytes: s.size, sha256: sha256(p) })
  }
}
walk('dist')
if (!files.some(f => f.path === join('dist', 'index.html')) || files.length < 2) throw Error('构建产物不完整')
const result = { version: 1, checkoutSha: git('rev-parse', 'HEAD'), parents: git('show', '-s', '--format=%P', 'HEAD').split(' ').filter(Boolean), node: process.version, platform: process.platform, arch: process.arch, packageLockSha256: sha256('package-lock.json'), files }
mkdirSync('work', { recursive: true })
writeFileSync('work/beta-build-manifest.json', JSON.stringify(result, null, 2) + '\n')
console.info(`Beta build inventory: ${files.length} files, ${result.platform}/${result.arch}, checkout ${result.checkoutSha}`)
