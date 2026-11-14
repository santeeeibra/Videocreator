// Prueba con UNA escena corta y API simulada: no gasta caracteres reales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadJson, plan, synthesizeScene } from '../src/voice.mjs';

const root = path.resolve(import.meta.dirname, '..');
const scene = { id: 's1', text: 'Hola mundo.' };
const mkOpts = async (extra = {}) => {
  const d = await mkdtemp(path.join(os.tmpdir(), 'voz-'));
  return { cacheDir: path.join(d, 'c'), outDir: path.join(d, 'o'), baseDir: root, log: () => {}, ...extra };
};
const okFetch = (counter) => async () => { counter.n++; return { ok: true, arrayBuffer: async () => Buffer.from('MP3') }; };
const fakePiper = async (_c, _t, out) => writeFile(out, 'WAV');

async function cfgWithVoice() {
  const cfg = await loadJson(path.join(root, 'channels', 'curiosidades.json'));
  cfg.voice.elevenlabs.voice_id = 'voz_test';
  return cfg;
}

test('segunda corrida usa caché: una sola llamada a la API', async () => {
  const cfg = await cfgWithVoice(); const c = { n: 0 };
  const o = await mkOpts({ apiKey: 'k', fetchImpl: okFetch(c) });
  const r1 = await synthesizeScene(cfg, scene, o);
  const r2 = await synthesizeScene(cfg, scene, o);
  assert.equal(c.n, 1); assert.equal(r1.fromCache, false); assert.equal(r2.fromCache, true);
});

test('cambiar el texto o la voz invalida la caché', async () => {
  const cfg = await cfgWithVoice(); const c = { n: 0 };
  const o = await mkOpts({ apiKey: 'k', fetchImpl: okFetch(c) });
  await synthesizeScene(cfg, scene, o);
  await synthesizeScene(cfg, { ...scene, text: 'Otro texto.' }, o);
  cfg.voice.elevenlabs.voice_id = 'otra_voz';
  await synthesizeScene(cfg, scene, o);
  assert.equal(c.n, 3);
});

test('sin API key cae a Piper y no llama a la API', async () => {
  const cfg = await cfgWithVoice(); const c = { n: 0 };
  const o = await mkOpts({ apiKey: undefined, fetchImpl: okFetch(c), piper: fakePiper });
  const r = await synthesizeScene(cfg, scene, o);
  assert.equal(r.provider, 'piper'); assert.equal(c.n, 0);
});

test('límite agotado (401/429) cae a Piper sin romper', async () => {
  const cfg = await cfgWithVoice();
  for (const status of [401, 429]) {
    const f = async () => ({ ok: false, status, text: async () => 'quota_exceeded' });
    const o = await mkOpts({ apiKey: 'k', fetchImpl: f, piper: fakePiper });
    assert.equal((await synthesizeScene(cfg, scene, o)).provider, 'piper');
  }
});

test('voice_id sin configurar cae a Piper en vez de gastar', async () => {
  const cfg = await loadJson(path.join(root, 'channels', 'curiosidades.json')); const c = { n: 0 };
  const o = await mkOpts({ apiKey: 'k', fetchImpl: okFetch(c), piper: fakePiper });
  assert.equal((await synthesizeScene(cfg, scene, o)).provider, 'piper'); assert.equal(c.n, 0);
});

test('dry-run: cuenta caracteres, y 0 si ya está en caché', async () => {
  const cfg = await cfgWithVoice(); const c = { n: 0 };
  const o = await mkOpts({ apiKey: 'k', fetchImpl: okFetch(c) });
  const p1 = await plan(cfg, [scene], { cacheDir: o.cacheDir, apiKey: 'k' });
  assert.equal(p1.totalCost, scene.text.length);
  await synthesizeScene(cfg, scene, o);
  const p2 = await plan(cfg, [scene], { cacheDir: o.cacheDir, apiKey: 'k' });
  assert.equal(p2.totalCost, 0); assert.equal(c.n, 1);
});
