import { defineConfig } from 'tsdown'
import { clientBundle } from './build/client-bundle.ts'

const packageName = 'dsh-antigravity-auth'

/** Build the Host rows, browser entry, and public companion modules. */
export default defineConfig([
  {
    name: packageName,
    entry: [
      'src/index.ts',
      'src/search.ts',
      'src/image.ts',
      'src/video.ts',
      'src/invariant.ts',
      'src/rpc-contract.ts',
      'src/wire-identity.ts',
    ],
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
  },
  clientBundle(packageName),
])
