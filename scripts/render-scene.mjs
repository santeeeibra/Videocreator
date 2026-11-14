// Uso: node scripts/render-scene.mjs <guion.json> <escena-id>
// Ej:  node scripts/render-scene.mjs guiones/curiosidades-ejemplo.json s1
//
// Lee el guion y el canal, mide el .wav de la escena para fijar la duración
// (si no existe usa FALLBACK_SECONDS y avisa) y renderiza solo esa escena a MP4.
// No llama a ninguna API.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const FPS = 30;
const FALLBACK_SECONDS = 4;
const TAIL_SECONDS = 0.4; // pequeña pausa al final de cada escena

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [guionArg, sceneId] = process.argv.slice(2);
if (!guionArg || !sceneId) {
  console.error("Uso: node scripts/render-scene.mjs <guion.json> <escena-id>");
  process.exit(1);
}

const guionPath = resolve(root, guionArg);
const guion = JSON.parse(readFileSync(guionPath, "utf8"));
const scene = guion.scenes.find((s) => s.id === sceneId);
if (!scene) {
  console.error(`No existe la escena "${sceneId}" en ${guionArg}`);
  process.exit(1);
}

const channel = JSON.parse(
  readFileSync(resolve(root, "channels", `${guion.channel}.json`), "utf8")
);
if (!channel.brand) {
  console.error(`channels/${guion.channel}.json no tiene el bloque "brand".`);
  process.exit(1);
}

// Duración real del WAV (PCM): recorre los chunks hasta "fmt " y "data".
function wavSeconds(file) {
  const b = readFileSync(file);
  let byteRate = 0;
  let dataSize = 0;
  let pos = 12;
  while (pos + 8 <= b.length) {
    const id = b.toString("ascii", pos, pos + 4);
    let size = b.readUInt32LE(pos + 4);
    if (id === "fmt ") byteRate = b.readUInt32LE(pos + 16);
    if (id === "data") {
      // Algunos encoders en streaming dejan 0 o 0xFFFFFFFF: usar lo que queda.
      if (size === 0 || size === 0xffffffff || pos + 8 + size > b.length) {
        size = b.length - (pos + 8);
      }
      dataSize = size;
      break;
    }
    pos += 8 + size + (size % 2);
  }
  if (!byteRate || !dataSize) throw new Error(`WAV no válido: ${file}`);
  return dataSize / byteRate;
}

const audioPath = resolve(root, "out", basename(guionPath, ".json"), `${scene.id}.wav`);
let seconds;
if (existsSync(audioPath)) {
  const audioSeconds = wavSeconds(audioPath);
  seconds = audioSeconds + TAIL_SECONDS;
  console.log(`Audio ${scene.id}.wav: ${audioSeconds.toFixed(2)} s (+${TAIL_SECONDS} s de cola)`);
} else {
  seconds = FALLBACK_SECONDS;
  console.warn(`AVISO: no existe ${audioPath}. Uso duración de respaldo: ${FALLBACK_SECONDS} s.`);
}
const durationInFrames = Math.ceil(seconds * FPS);

const props = { text: scene.text, brand: channel.brand, durationInFrames };
const cacheDir = resolve(root, "cache");
mkdirSync(cacheDir, { recursive: true });
const propsFile = resolve(cacheDir, `props-${scene.id}.json`);
writeFileSync(propsFile, JSON.stringify(props, null, 2));

const outDir = resolve(root, "out", basename(guionPath, ".json"));
mkdirSync(outDir, { recursive: true });
const outFile = resolve(outDir, `${scene.id}.mp4`);

const cli = resolve(root, "node_modules", "@remotion", "cli", "remotion-cli.js");
const res = spawnSync(
  process.execPath,
  [cli, "render", "src/remotion/index.js", "Escena", outFile, `--props=${propsFile}`, "--codec=h264"],
  { cwd: root, stdio: "inherit" }
);
if (res.status !== 0) process.exit(res.status ?? 1);
console.log(`\nListo: ${outFile}  (${durationInFrames} frames, ${(durationInFrames / FPS).toFixed(2)} s)`);
