#!/usr/bin/env node
/** Verify the private Wire Identity package shape without installing or publishing it. */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
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
  for (const row of ['antigravity-auth', 'antigravity-search', 'antigravity-image', 'antigravity-video']) {
    if (!patch.includes(`id: ${row}`)) throw new Error(`package smoke: patch lacks independent row ${row}`)
  }
  if (patch.includes('deepseek-harness')) throw new Error('package smoke: patch unexpectedly mentions DSH core')

  for (const key of [
    '.',
    './client',
    './search',
    './image',
    './video',
    './rpc-contract',
    './project-context',
    './wire-identity',
    './invariant',
    './llm-adapter',
    './private-transport',
    './replay',
    './quota',
    './media-admission',
  ]) {
    const target = manifest.exports?.[key]?.default
    const types = manifest.exports?.[key]?.types
    if (typeof target !== 'string' || typeof types !== 'string') throw new Error(`package smoke: incomplete export ${key}`)
    await access(resolve(packageRoot, target))
    await access(resolve(packageRoot, types))
    if (key !== './client') {
      const loaded = await import(pathToFileURL(resolve(packageRoot, target)).href)
      if (key === '.' && typeof loaded.createWireIdentity !== 'function') {
        throw new Error('package smoke: root entry has no Wire Identity export')
      }
      if (key === './project-context' && typeof loaded.createProjectDiscovery !== 'function') {
        throw new Error('package smoke: project-context export has no discovery factory')
      }
      if (key === './llm-adapter' && typeof loaded.AntigravityAdapter !== 'function') {
        throw new Error('package smoke: llm-adapter export has no adapter')
      }
      if (key === './quota' && typeof loaded.normalizeQuotaResponse !== 'function') {
        throw new Error('package smoke: quota export has no normalizer')
      }
      if (key === './media-admission' && typeof loaded.admitWorkspaceImage !== 'function') {
        throw new Error('package smoke: media-admission export has no workspace admission')
      }
    }
  }
  const source = await readFile(resolve(packageRoot, 'lib/wire-identity.js'), 'utf8')
  for (const marker of ['X-DeepSeek-Harness-Attribution', 'buildAgyCliHeaderPairs', 'ANTIGRAVITY_HEADERS']) {
    if (!source.includes(marker)) throw new Error(`package smoke: Wire Identity artifact lacks ${marker}`)
  }
  if (source.includes('deepseek-harness core')) throw new Error('package smoke: artifact contains an invalid core implementation claim')

  const clientTarget = manifest.exports?.['./client']?.default
  if (typeof clientTarget !== 'string') throw new Error('package smoke: client export is missing')
  const clientSource = await readFile(resolve(packageRoot, clientTarget), 'utf8')
  for (const marker of ['node:', '@cortexkit/antigravity-auth-core', 'globalThis.fetch']) {
    if (clientSource.includes(marker)) throw new Error(`package smoke: client artifact contains Host-only marker ${marker}`)
  }
  let registration
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window')
  const originalWindow = globalThis.window
  globalThis.window = { __ModuleLoader__: { load: value => { registration = value } } }
  try {
    await import(pathToFileURL(resolve(packageRoot, clientTarget)).href)
  } finally {
    if (hadWindow) globalThis.window = originalWindow
    else delete globalThis.window
  }
  if (registration?.id !== manifest.name || typeof registration.factory !== 'function') {
    throw new Error('package smoke: client artifact did not register with the DSH module loader')
  }
  const clientExports = registration.factory(createRequire(resolve(packageRoot, 'package.json')))
  if (typeof clientExports?.apply !== 'function') {
    throw new Error('package smoke: client factory did not expose an apply function')
  }

  console.log(`package smoke: ${filename} exposes private Host/client entries, project discovery, gated rows, Wire Identity, and value-free types`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
