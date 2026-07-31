// 01_comparar_voces_elevenlabs.js
//
// QUÉ HACE: genera UNA MISMA frase de prueba en español con cada una de las
// voces "premade" (default, usables en free tier) de tu cuenta, y guarda
// cada resultado como un mp3 separado con el nombre de la voz.
//
// POR QUÉ EXISTE: ninguna de tus voces premade está etiquetada como "es" —
// todas son "en" (el acento/idioma original del actor de voz que las
// originó). El modelo SÍ es multilingüe y puede hablar español igual, pero
// el grado de acento varía de voz en voz. La única forma confiable de saber
// cuál conviene es escuchar el mismo texto con todas y comparar.
//
// CÓMO CORRERLO:
//   node --env-file=.env scripts/01_comparar_voces_elevenlabs.js
//
// Al terminar, revisa la carpeta out/comparacion/ y escucha los archivos.
// El nombre del archivo te dice qué voz es cada uno.

import WebSocket from "ws";
import fs from "node:fs";

const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) {
  console.error("Falta ELEVENLABS_API_KEY en tu archivo .env");
  process.exit(1);
}

// El mismo modelo de baja latencia que usaremos en la performance.
const MODEL_ID = "eleven_flash_v2_5";
const LANGUAGE_CODE = "es";
const OUTPUT_FORMAT = "mp3_44100_128";

// Frase de prueba: corta (para gastar pocos créditos) pero con sonidos
// característicos del español (ñ, doble rr, acentos) que delatan rápido
// si una voz suena forzada en el idioma.
const TEXTO_DE_PRUEBA =
    "Hola, bienvenides, el especímen que ven a mi lado se identifica como PROTOUSUARIO, es mi servidor humano que cumplira mis prompts-manifiestos de manera literal... ¿Qué especie merece estar en la cima de la pirámide evolutiva? Responde con el cuerpo, no con palabras. Mantén el cuerpo en una tensión constante que simule la coexistencia de múltiples sistemas operativos; cada gesto debe ser una interpolación entre estados de latencia y ejecución.";

// ════════════════════════════════════════════════════════════
// Pega aquí las voces que salieron en tu 00_listar_voces_elevenlabs.js
// (categoría "premade" únicamente — las "professional" no funcionan en free)
// ════════════════════════════════════════════════════════════
const VOCES_A_PROBAR = [
  { id: "CwhRBWXzGAHq8TQ4Fs17", nombre: "Roger" },
  { id: "EXAVITQu4vr4xnSDxMaL", nombre: "Sarah" },
  { id: "FGY2WhTYpPnrIDTdsKH5", nombre: "Laura" },
  { id: "IKne3meq5aSn9XLyUdCD", nombre: "Charlie" },
  { id: "JBFqnCBsd6RMkjVDRZzb", nombre: "George" },
  { id: "N2lVS1w4EtoT3dr4eOWO", nombre: "Callum" },
  { id: "SAz9YHcvj6GT2YYXdXww", nombre: "River" },
  { id: "SOYHLrjzK2X1ezoPC6cr", nombre: "Harry" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", nombre: "Liam" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", nombre: "Alice" },
  { id: "XrExE9yKIg1WjnnlVkGX", nombre: "Matilda" },
  { id: "bIHbv24MWmeRgasZH58o", nombre: "Will" },
  { id: "cgSgspJ2msm6clMCkdW9", nombre: "Jessica" },
  { id: "cjVigY5qzO86Huf0OWal", nombre: "Eric" },
  { id: "hpp4J3VqNfWAUOO0d1Us", nombre: "Bella" },
  { id: "iP95p4xoKVk53GoZ742B", nombre: "Chris" },
  { id: "nPczCjzI2devNBz1zQrb", nombre: "Brian" },
  { id: "onwK4e9ZLuTAKqWW03F9", nombre: "Daniel" },
  { id: "pFZP5JQG7iQjIQuC4Bku", nombre: "Lily" },
  { id: "pNInz6obpgDQGcFmaJgB", nombre: "Adam" },
  { id: "pqHfZKP75CvOlQylNhV4", nombre: "Bill" },
];

// ════════════════════════════════════════════════════════════
// Misma función hablar() del script 05, generalizada para recibir
// el voice_id como parámetro (en vez de una constante fija).
// ════════════════════════════════════════════════════════════
function hablar(texto, voiceId, { guardarComo } = {}) {
  return new Promise((resolve, reject) => {
    const url =
      `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input` +
      `?model_id=${MODEL_ID}&output_format=${OUTPUT_FORMAT}`;

    const ws = new WebSocket(url);
    const chunksDeAudio = [];
    let huboError = false;
    const t0 = Date.now();
    let primerAudioEn = null;

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          text: " ",
          voice_settings: { stability: 0.5, similarity_boost: 0.8 },
          xi_api_key: API_KEY,
          language_code: LANGUAGE_CODE,
        })
      );
      ws.send(JSON.stringify({ text: texto + " " }));
      ws.send(JSON.stringify({ text: "" }));
    });

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.audio) {
        if (primerAudioEn === null) primerAudioEn = Date.now() - t0;
        chunksDeAudio.push(Buffer.from(msg.audio, "base64"));
      }
      if (msg.isFinal) ws.close();
    });

    ws.on("error", (err) => {
      huboError = true;
      console.error(`   ✗ Error de WebSocket: ${err.message}`);
    });

    ws.on("close", () => {
      if (huboError) return reject(new Error("falló la conexión"));

      const audioCompleto = Buffer.concat(chunksDeAudio);
      if (audioCompleto.length === 0) {
        return reject(new Error("no llegó audio (voz no disponible en tu plan)"));
      }

      if (guardarComo) fs.writeFileSync(guardarComo, audioCompleto);
      resolve({ latenciaPrimerAudioMs: primerAudioEn });
    });
  });
}

// ════════════════════════════════════════════════════════════
// EJECUCIÓN: genera la frase de prueba con cada voz, UNA A LA VEZ
// (en serie, no en paralelo, para no chocar con límites de concurrencia
// del plan free).
// ════════════════════════════════════════════════════════════
async function main() {
  fs.mkdirSync("out/comparacion", { recursive: true });

  console.log(`Probando ${VOCES_A_PROBAR.length} voces con el texto:`);
  console.log(`"${TEXTO_DE_PRUEBA}"\n`);

  for (let i = 0; i < VOCES_A_PROBAR.length; i++) {
    const { id, nombre } = VOCES_A_PROBAR[i];
    const numero = String(i + 1).padStart(2, "0");
    const archivo = `out/comparacion/${numero}_${nombre}.mp3`;

    process.stdout.write(`[${numero}/${VOCES_A_PROBAR.length}] ${nombre.padEnd(12)} ... `);

    try {
      const { latenciaPrimerAudioMs } = await hablar(TEXTO_DE_PRUEBA, id, { guardarComo: archivo });
      console.log(`✓ (${latenciaPrimerAudioMs} ms)`);
    } catch (err) {
      console.log(`✗ ${err.message}`);
    }
  }

  console.log(`\nListo. Abre la carpeta out/comparacion/ y escucha en orden.`);
  console.log(`El nombre del archivo te dice qué voz es cada una.`);
  console.log(`Cuando elijas una, copia su "id" (lo tienes en VOCES_A_PROBAR de este mismo`);
  console.log(`script) y pégalo como VOICE_ID en 05_voice_elevenlabs.js.`);
}

main();
