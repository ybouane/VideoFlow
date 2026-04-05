/**
 * Build script for the web player example.
 * Bundles player.ts into player.js for browser use.
 *
 * Run: npx tsx examples/web-player/build.ts
 */

import * as esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const srcDir = path.resolve(__dirname, '../../src');

const result = await esbuild.build({
	entryPoints: [path.join(__dirname, 'player.ts')],
	outfile: path.join(__dirname, 'player.js'),
	bundle: true,
	format: 'esm',
	platform: 'browser',
	target: 'esnext',
	sourcemap: true,
	external: ['@videoflow/renderer-server'],
	alias: {
		'@videoflow/core': path.join(srcDir, 'core/index.ts'),
		'@videoflow/core/types': path.join(srcDir, 'core/types.ts'),
		'@videoflow/core/utils': path.join(srcDir, 'core/utils.ts'),
		'@videoflow/renderer-browser': path.join(srcDir, 'renderer-browser/index.ts'),
		'@videoflow/renderer-dom': path.join(srcDir, 'renderer-dom/index.ts'),
	},
	loader: {
		'.ts': 'ts',
		'.css': 'text',
	},
});

console.log('Build complete.');
if (result.errors.length) console.error('Errors:', result.errors);
if (result.warnings.length) console.warn('Warnings:', result.warnings);
