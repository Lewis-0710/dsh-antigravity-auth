import { defineConfig } from 'tsdown'

export default defineConfig({
  name: 'dsh-antigravity-auth',
  entry: ['src/index.ts', 'src/invariant.ts', 'src/wire-identity.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  tsconfig: 'tsconfig.host.json',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: {
    neverBundle: [/^@deepseek-ai\//, /^@cortexkit\//],
  },
})
