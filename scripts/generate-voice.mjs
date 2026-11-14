#!/usr/bin/env node
// Uso:
//   node scripts/generate-voice.mjs --channel curiosidades --script guiones/curiosidades-ejemplo.json --dry-run
//   node scripts/generate-voice.mjs --channel curiosidades --script guiones/curiosidades-ejemplo.json --scene s1
//   node scripts/generate-voice.mjs ... --piper     (fuerza voz local, no toca ElevenLabs)
// Sin --scene procesa todo el guion. Requiere env ELEVENLABS_API_KEY (si falta, usa Piper).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { loadJson, plan, synthesizeScene } from '../src/voice.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values: a } = parseArgs({ options: {
  channel: { type: 'string' }, script: { type: 'string' }, scene: { type: 'string' },
  'dry-run': { type: 'boolean', default: false }, piper: { type: 'boolean', default: false },
} });

if (!a.channel || !a.script) {
  console.error('Faltan --channel y --script. Ver cabecera del archivo.');
  process.exit(2);
}

const cfg = await loadJson(path.join(root, 'channels', `${a.channel}.json`));
const guion = await loadJson(path.resolve(a.script));
let scenes = guion.scenes;
if (a.scene) {
  scenes = scenes.filter((s) => s.id === a.scene);
  if (!scenes.length) { console.error(`Escena "${a.scene}" no existe en el guion.`); process.exit(2); }
}

const cacheDir = path.join(root, 'cache', 'audio');
const outDir = path.join(root, 'out', path.basename(a.script, '.json'));

const p = await plan(cfg, scenes, { cacheDir, forcePiper: a.piper });
console.log(`Canal: ${cfg.id} | escenas: ${scenes.length} | API key: ${p.hasKey ? 'presente' : 'AUSENTE (se usará Piper)'}`);
for (const r of p.rows) console.log(`  ${r.id.padEnd(8)} ${String(r.chars).padStart(5)} car. -> ${r.action}`);
console.log(`Caracteres de ElevenLabs que se gastarían: ${p.totalCost}`);
if (a['dry-run']) { console.log('(dry-run: no se llamó a ninguna API)'); process.exit(0); }

const results = [];
for (const s of scenes) {
  const r = await synthesizeScene(cfg, s, { cacheDir, outDir, baseDir: root, forcePiper: a.piper });
  console.log(`  ${s.id}: ${r.provider}${r.fromCache ? ' (caché)' : ''} -> ${path.relative(root, r.file)}`);
  results.push({ id: r.id, file: path.relative(root, r.file), provider: r.provider });
}
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify({ channel: cfg.id, scenes: results }, null, 2));
console.log(`Manifest: ${path.relative(root, path.join(outDir, 'manifest.json'))}`);
