// PROTOUSUARIO / AGENTE-ESPEJO — LA VOZ  ·  módulo único
//
// ═══════════════════════════════════════════════════════════════════════════
//  POR QUÉ NO SONABA NADA
//  Hasta ahora la voz nunca estuvo conectada. `05_voice_elevenlabs.js` era una
//  prueba suelta (su propia cabecera lo dice: "no está conectado a Gemini") y
//  `prerender_voz.js` solo grababa archivos a disco. Nadie los reproducía.
//  No te faltó un flag: faltaba el cable. Este archivo es ese cable.
//
// ═══════════════════════════════════════════════════════════════════════════
//  CÓMO FUNCIONA — la idea entera en cuatro líneas
//
//  1. Cada texto tiene una HUELLA: un código de 16 letras calculado a partir
//     del texto mismo (un "hash"). El mismo texto da siempre la misma huella.
//  2. El archivo de audio se llama como su huella: `a3f9c1...mp3`.
//  3. Antes de pedirle nada a ElevenLabs, se mira si ese archivo ya existe en
//     disco. Si existe, se usa. Cero red, cero espera, cero costo.
//  4. Si no existe, se pide a ElevenLabs, se guarda con su huella, y la próxima
//     vez ya está.
//
//  CONSECUENCIA IMPORTANTE: todo lo que tú escribes (preludio, prompts,
//  preguntas, cierre) se puede grabar EN CASA con `prerender_voz.js`. En el
//  patio esos textos ya no tocan internet. Solo lo que genera Gemini —que es
//  nuevo cada vez— necesita conexión, y si falla, la escena sigue en silencio
//  sin romperse.
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// audio_respaldo/ = lo que grabaste en casa, a mano. NUNCA se borra.
// audio_cache/    = lo que se generó en vivo. Se puede borrar sin miedo.
export const DIR_RESPALDO = 'audio_respaldo';
export const DIR_CACHE = 'audio_cache';

for (const d of [DIR_RESPALDO, DIR_CACHE]) fs.mkdirSync(d, { recursive: true });

/** La huella de un texto. Mismo texto → mismo nombre de archivo, siempre. */
export function huella(texto) {
  return crypto.createHash('sha1').update(String(texto).trim()).digest('hex').slice(0, 16);
}

/** ¿Ya existe en disco? Devuelve el nombre del archivo o null. */
export function buscarEnDisco(texto) {
  const nombre = huella(texto) + '.mp3';
  for (const dir of [DIR_RESPALDO, DIR_CACHE]) {
    if (fs.existsSync(path.join(dir, nombre))) return nombre;
  }
  return null;
}

const API = () => process.env.ELEVENLABS_API_KEY;
const VOZ = () => process.env.ELEVENLABS_VOICE_ID;
const MODELO = () => process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5';

// Ajustes de la voz clonada. Se pueden mover desde .env sin tocar código.
// stability bajo = más expresiva y más impredecible; alto = más plana.
const AJUSTES = () => ({
  stability: Number(process.env.VOZ_STABILITY ?? 0.45),
  similarity_boost: Number(process.env.VOZ_SIMILARITY ?? 0.8),
  style: Number(process.env.VOZ_STYLE ?? 0.35),
  use_speaker_boost: true,
  speed: Number(process.env.VOZ_SPEED ?? 1.0),
});

/**
 * Graba un texto a mp3 llamando a ElevenLabs. Uso interno y de prerender_voz.
 * @returns {Promise<string>} nombre del archivo (huella.mp3)
 */
export async function grabar(texto, { dir = DIR_CACHE } = {}) {
  if (!API() || !VOZ()) throw new Error('faltan ELEVENLABS_API_KEY o ELEVENLABS_VOICE_ID en .env');
  const nombre = huella(texto) + '.mp3';
  const destino = path.join(dir, nombre);

  const r = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOZ()}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': API(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: texto, model_id: MODELO(), voice_settings: AJUSTES() }),
      signal: AbortSignal.timeout(30000),
    }
  );
  if (!r.ok) throw new Error(`ElevenLabs HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`);

  fs.writeFileSync(destino, Buffer.from(await r.arrayBuffer()));
  return nombre;
}

/**
 * LA FUNCIÓN QUE USA LA PERFORMANCE.
 * Devuelve el nombre del mp3 listo para reproducir, o null si no se pudo.
 * NUNCA lanza error: si la voz falla, la escena sigue en silencio. Un texto
 * sin voz es un problema; una función caída es un desastre.
 *
 * @param {string} texto
 * @param {object} [op]
 * @param {boolean} [op.silencioso]  true = ni siquiera intenta la red
 */
export async function voz(texto, { silencioso = false } = {}) {
  if (!texto || !texto.trim()) return null;

  const enDisco = buscarEnDisco(texto);
  if (enDisco) return enDisco;                 // ← el 90 % de las veces cae aquí
  if (silencioso || process.env.SIN_VOZ === '1') return null;

  try {
    return await grabar(texto);
  } catch (e) {
    console.warn(`    ⚠ sin voz para este bloque (${e.message})`);
    return null;
  }
}

/**
 * Graba de golpe una lista de textos. Se usa al empezar cada agente, mientras
 * el público todavía no vio nada: así la red se toca UNA vez por agente y no
 * a mitad de una frase. Secuencial a propósito, para no chocar con el límite
 * de peticiones simultáneas de ElevenLabs.
 * @returns {Promise<Map<string,string>>} texto → nombre de archivo
 */
export async function vozLote(textos, { etiqueta = '' } = {}) {
  const mapa = new Map();
  const pendientes = [];

  for (const t of textos) {
    if (!t || !t.trim()) continue;
    const yaEsta = buscarEnDisco(t);
    if (yaEsta) mapa.set(t, yaEsta);
    else pendientes.push(t);
  }

  if (pendientes.length) {
    console.log(`    voz${etiqueta ? ' ' + etiqueta : ''}: ${mapa.size} en disco · ${pendientes.length} por grabar…`);
    for (const t of pendientes) {
      const n = await voz(t);
      if (n) mapa.set(t, n);
    }
  } else if (mapa.size) {
    console.log(`    voz${etiqueta ? ' ' + etiqueta : ''}: ${mapa.size} bloques, todos en disco (sin red).`);
  }
  return mapa;
}
