/**
 * Lets the verification scripts import the editor's TypeScript sources the way
 * Vite does, with extensionless relative paths. Node strips the types itself,
 * this only teaches its resolver to try .ts / .tsx / index.ts.
 *
 * Used via:  node --import ./tools/ts-resolve.mjs tools/verify-scene.mjs
 */

import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && path.extname(specifier) === '') {
      const parent = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd();
      const base = path.resolve(path.dirname(parent), specifier);
      for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        if (existsSync(candidate)) {
          // No explicit format: Node infers .ts and strips the types itself.
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
