/**
 * Dev server for the web player example.
 *
 * Uses esbuild to bundle the player.ts with all dependencies, then serves
 * the HTML and JS on a local HTTP server.
 *
 * Run:
 *   npx tsx examples/web-player/serve.ts
 */

import * as esbuild from 'esbuild';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

async function main() {
	// Bundle the player script
	console.log('Bundling player.ts...');
	const srcDir = path.resolve(__dirname, '../../src');

	const result = await esbuild.build({
		entryPoints: [path.join(__dirname, 'player.ts')],
		bundle: true,
		write: false,
		format: 'esm',
		platform: 'browser',
		target: 'esnext',
		sourcemap: 'inline',
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
	

	const bundledJs = result.outputFiles[0].text;
	const htmlContent = await fs.readFile(path.join(__dirname, 'index.html'), 'utf-8');


	console.log(`Bundle size: ${(bundledJs.length / 1024).toFixed(1)} KB`);

	// Create HTTP server
	const server = http.createServer(async (req, res) => {
		const url = req.url || '/';

		if (url === '/' || url === '/index.html') {
			res.writeHead(200, { 'Content-Type': 'text/html' });
			res.end(htmlContent);
		} else if (url === '/player.js') {
			res.writeHead(200, { 'Content-Type': 'application/javascript' });
			res.end(bundledJs);
		} else if (url === '/sample.mp3' || url === '/sample.mp4' || url === '/sample.jpg') {
			// Serve sample media files from examples directory
			const filePath = path.join(__dirname, '..', url);
			try {
				const data = await fs.readFile(filePath);
				const mimeType = url.endsWith('.mp3') ? 'audio/mpeg' : 'video/mp4';
				res.writeHead(200, { 'Content-Type': mimeType });
				res.end(data);
			} catch {
				res.writeHead(404);
				res.end('Not found');
			}
		} else {
			res.writeHead(404);
			res.end('Not found');
		}
	});

	server.listen(PORT, () => {
		console.log(`\nServing at http://localhost:${PORT}\n`);
	});
}

main().catch(console.error);
