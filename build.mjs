import { build } from 'esbuild';
import fs from 'node:fs';

const common = { bundle: true, sourcemap: true, logLevel: 'warning' };

await build({
  ...common,
  entryPoints: ['src/daemon/aeryxd.ts'],
  platform: 'node',
  format: 'esm',
  external: ['@anthropic-ai/claude-agent-sdk', 'better-sqlite3', 'msedge-tts'],
  outfile: 'dist/aeryxd.mjs',
});

await build({
  ...common,
  entryPoints: ['src/brain/brain.ts'],
  platform: 'node',
  format: 'esm',
  external: ['@anthropic-ai/claude-agent-sdk', 'better-sqlite3'],
  outfile: 'dist/brain.mjs',
});

await build({
  ...common,
  entryPoints: ['src/voice/voice.ts'],
  platform: 'node',
  format: 'esm',
  external: ['@picovoice/porcupine-node', '@picovoice/pvrecorder-node'],
  outfile: 'dist/voice.mjs',
});

await build({
  ...common,
  entryPoints: ['src/session/agent.ts'],
  platform: 'node',
  format: 'esm',
  outfile: 'dist/session-agent.mjs',
});

fs.copyFileSync('src/client/status.html', 'dist/status.html');
fs.copyFileSync('src/client/hud.html', 'dist/hud.html');
fs.copyFileSync('src/client/lens.html', 'dist/lens.html');
fs.copyFileSync('src/client/orb.html', 'dist/orb.html');
fs.copyFileSync('src/client/quick.html', 'dist/quick.html');
fs.copyFileSync('src/client/orb.js', 'dist/orb.js');
fs.mkdirSync('dist/assets', { recursive: true });
for (const f of fs.readdirSync('src/client/assets')) {
  if (!/\.(webp|svg)$/.test(f)) continue;
  fs.copyFileSync(`src/client/assets/${f}`, `dist/assets/${f}`);
}
fs.cpSync('src/client/assets/characters', 'dist/assets/characters', { recursive: true });
fs.cpSync('src/client/assets/news', 'dist/assets/news', { recursive: true });
fs.mkdirSync('dist/fonts', { recursive: true });
for (const f of fs.readdirSync('src/client/fonts')) {
  fs.copyFileSync(`src/client/fonts/${f}`, `dist/fonts/${f}`);
}
console.log('build ok');
