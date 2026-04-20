import { promises as fs } from 'fs';
import { createProject } from './09-effects.js';

const $ = createProject();
const frame = await $.renderFrame(60);
await fs.writeFile('./09-effects-frame-60.jpg', frame);
console.log('Frame 60 → ./09-effects-frame-60.jpg');
