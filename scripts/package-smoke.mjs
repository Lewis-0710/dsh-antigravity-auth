#!/usr/bin/env node
/** Verify the private Wire Identity package shape without installing or publishing it. */
import { execFileSync } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const sourceRoot = resolve(import.meta.dirname, '..')
const temporary = await mkdtemp(resolve(sourceRoot, '.package-smoke-'))
try {
  const output = execFileSync('npm', [
    'pack', '--json', '--ignore-scripts', '--pack-destination', temporary,
  ], {
    cwd: sourceRoot,
    encoding: 'utf8',
    env: { ...process.env, npm_config_ignore_scripts: 'true' },
  })
  const jsonStart = output.lastIndexOf('\n[')
  const packed = JSON.parse(output.slice(jsonStart < 0 ? 0 : jsonStart + 1))
  const filename = packed?.[0]?.filename
  if (typeof filename !== 'string') throw new Error('package smoke: npm pack returned no artifact')
  execFileSync('tar', ['-xzf', resolve(temporary, filename), '-C', temporary])

  const packageRoot = resolve(temporary, 'package')
  const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
  if (manifest.private !== true) throw new Error('package smoke: package must remain private')
  const changelog = await readFile(resolve(packageRoot, 'CHANGELOG.md'), 'utf8')
  if (!changelog.includes(`## [${String(manifest.version)}]`)) {
    throw new Error(`package smoke: CHANGELOG.md lacks release ${String(manifest.version)}`)
  }
  const patch = await readFile(resolve(packageRoot, 'cordis.patch.yml'), 'utf8')
  if (!/^\[\]\s*$/mu.test(patch)) throw new Error('package smoke: Wire Identity phase must not auto-mount capability rows')
  if (patch.includes('deepseek-harness')) throw new Error('package smoke: patch unexpectedly mentions DSH core')

  for (const key of ['.', './wire-identity', './invariant']) {
    const target = manifest.exports?.[key]?.default
    const types = manifest.exports?.[key]?.types
    if (typeof target !== 'string' || typeof types !== 'string') throw new Error(`package smoke: incomplete export ${key}`)
    await access(resolve(packageRoot, target))
    await access(resolve(packageRoot, types))
    const loaded = await import(pathToFileURL(resolve(packageRoot, target)).href)
    if (key === '.' && typeof loaded.createWireIdentity !== 'function') {
      throw new Error('package smoke: root entry has no Wire Identity export')
    }
  }
  const source = await readFile(resolve(packageRoot, 'lib/wire-identity.js'), 'utf8')
  for (const marker of ['X-DeepSeek-Harness-Attribution', 'buildAgyCliHeaderPairs', 'ANTIGRAVITY_HEADERS']) {
    if (!source.includes(marker)) throw new Error(`package smoke: Wire Identity artifact lacks ${marker}`)
  }
  if (source.includes('deepseek-harness core')) throw new Error('package smoke: artifact contains an invalid core implementation claim')

  console.log(`package smoke: ${filename} exposes private Wire Identity, invariant, types, and no capability rows`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
