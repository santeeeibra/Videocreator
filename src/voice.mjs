// Generación de voz por escena: ElevenLabs con caché y fallback a Piper.
// La API key sale SOLO de process.env.ELEVENLABS_API_KEY.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile, access } from 'node:fs/promises';
import path from 'node:path';

const API = 'https://api.elevenlabs.io/v1/text-to-speech';
// 401 = quota_exceeded / key inválida, 402 = plan, 429 = límite de uso o concurrencia.
const FALLBACK_STATUS = new Set([401, 402, 403, 429]);

const exists = (p) => access(p).then(() => true, () => false);
const sha = (obj) => createHash('sha256').update(JSON.stringify(obj)).digest('hex');
const normalize = (t) => t.replace(/\s+/g, ' ').trim();

export function extFor(outputFormat) {
  return outputFormat.startsWith('mp3') ? 'mp3' : outputFormat.startsWith('pcm') ? 'pcm' : 'mp3';
}

// Hash por (texto + voz + parámetros que cambian el audio).
export function elevenKey(cfg, text) {
  const e = cfg.voice.elevenlabs;
  return sha({ p: 'elevenlabs', text: normalize(text), voice_id: e.voice_id, model_id: e.model_id,
    output_format: e.output_format, voice_settings: e.voice_settings ?? {} });
}
export function piperKey(cfg, text) {
  return sha({ p: 'piper', text: normalize(text), model: cfg.voice.piper.model });
}

export async function loadJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export function validateChannel(cfg) {
  const id = cfg?.voice?.elevenlabs?.voice_id;
  if (!id || id.startsWith('REEMPLAZAR')) return 'voice_id sin configurar en el canal';
  return null;
}

async function callElevenLabs(cfg, text, apiKey, fetchImpl) {
  const e = cfg.voice.elevenlabs;
  const url = `${API}/${encodeURIComponent(e.voice_id)}?output_format=${e.output_format}`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text: normalize(text), model_id: e.model_id, voice_settings: e.voice_settings }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    const err = new Error(`ElevenLabs HTTP ${res.status}: ${detail}`);
    err.status = res.status;
    throw err;
  }
  return Buffer.from(await res.arrayBuffer());
}

function runPiper(cfg, text, outFile, baseDir) {
  const p = cfg.voice.piper;
  const raw = process.env.PIPER_BIN || p.binary;
  const bin = /[\\/]/.test(raw) ? path.resolve(baseDir, raw) : raw;
  const model = path.resolve(baseDir, p.model);
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['--model', model, '--output_file', outFile], { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => reject(new Error(`No se pudo ejecutar Piper (${bin}): ${e.message}`)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Piper salió con código ${code}: ${stderr.slice(0, 300)}`))));
    child.stdin.end(normalize(text));
  });
}

/**
 * Calcula qué se gastaría. Una escena en caché cuesta 0. No llama a ninguna API.
 */
export async function plan(cfg, scenes, { cacheDir, forcePiper = false, apiKey = process.env.ELEVENLABS_API_KEY }) {
  const ext = extFor(cfg.voice.elevenlabs.output_format);
  const rows = [];
  for (const s of scenes) {
    const chars = normalize(s.text).length;
    const cached = await exists(path.join(cacheDir, `${elevenKey(cfg, s.text)}.${ext}`));
    const piperCached = await exists(path.join(cacheDir, `${piperKey(cfg, s.text)}.wav`));
    let action;
    if (cached) action = 'caché (0 caracteres)';
    else if (forcePiper || !apiKey || validateChannel(cfg)) {
      action = piperCached ? 'Piper en caché' : `Piper (gratis)${validateChannel(cfg) ? ` — ${validateChannel(cfg)}` : ''}`;
    }
    else action = 'ElevenLabs (gasta caracteres)';
    rows.push({ id: s.id, chars, action, cost: !cached && !forcePiper && apiKey && !validateChannel(cfg) ? chars : 0 });
  }
  return { rows, totalCost: rows.reduce((a, r) => a + r.cost, 0), hasKey: Boolean(apiKey) };
}

/**
 * Genera el audio de una escena. Devuelve { file, provider, fromCache, chars }.
 * Nunca lanza por falta de key / límite: cae a Piper. Solo lanza si Piper tampoco puede.
 */
export async function synthesizeScene(cfg, scene, opts) {
  const { cacheDir, outDir, baseDir, forcePiper = false, fetchImpl = fetch, log = console.log,
    apiKey = process.env.ELEVENLABS_API_KEY, piper = runPiper } = opts;
  await mkdir(cacheDir, { recursive: true });
  await mkdir(outDir, { recursive: true });
  const ext = extFor(cfg.voice.elevenlabs.output_format);
  const chars = normalize(scene.text).length;
  const finish = async (cacheFile, provider, fromCache, extension) => {
    const file = path.join(outDir, `${scene.id}.${extension}`);
    await copyFile(cacheFile, file);
    return { id: scene.id, file, provider, fromCache, chars };
  };

  // 1) ElevenLabs en caché: sirve aunque no haya key.
  const eKey = path.join(cacheDir, `${elevenKey(cfg, scene.text)}.${ext}`);
  if (await exists(eKey)) return finish(eKey, 'elevenlabs', true, ext);

  // 2) ElevenLabs en vivo.
  let reason = forcePiper ? 'forzado --piper' : !apiKey ? 'sin ELEVENLABS_API_KEY' : null;
  const cfgErr = validateChannel(cfg);
  if (!reason && cfgErr) reason = cfgErr;
  if (!reason) {
    try {
      const audio = await callElevenLabs(cfg, scene.text, apiKey, fetchImpl);
      await writeFile(eKey, audio);
      return finish(eKey, 'elevenlabs', false, ext);
    } catch (e) {
      if (e.status !== undefined && !FALLBACK_STATUS.has(e.status) && e.status < 500) throw e; // error de petición: no es límite
      reason = e.message;
    }
  }

  // 3) Fallback a Piper (caché propia).
  log(`  [${scene.id}] Piper (${reason})`);
  const pKey = path.join(cacheDir, `${piperKey(cfg, scene.text)}.wav`);
  if (!(await exists(pKey))) await piper(cfg, scene.text, pKey, baseDir);
  return finish(pKey, 'piper', false, 'wav');
}
