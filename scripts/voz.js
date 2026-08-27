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
import { duracionMp3Ms } from './mp3_duracion.js';

// audio_respaldo/ = lo que grabaste en casa, a mano. NUNCA se borra.
// audio_cache/    = lo que se generó en vivo. Se puede borrar sin miedo.
export const DIR_RESPALDO = 'audio_respaldo';
export const DIR_CACHE = 'audio_cache';

for (const d of [DIR_RESPALDO, DIR_CACHE]) fs.mkdirSync(d, { recursive: true });

// ═══════════════════════════════════════════════════════════════════════════
//  DOS VOCES
//  VOZ_AUTOR → lo que escribiste tú: @PRELUDIO @ID @PROMPT @PREGUNTA @CIERRE
//  VOZ_IA    → lo que escribe Gemini: @ORBITAL @NATGEO @MEMORIA y la DERIVA
//  Si no defines la segunda en .env, TODO suena con la primera y no se rompe
//  nada: el sistema simplemente no distingue.
//
//  IMPORTANTE: la huella incluye la voz. El mismo texto dicho por dos voces
//  distintas son dos archivos distintos. Si no fuera así, el segundo pisaría
//  al primero y sonaría la voz equivocada.
// ═══════════════════════════════════════════════════════════════════════════
export const VOZ_AUTOR = 'autor';
export const VOZ_IA = 'ia';

function idDeVoz(cual) {
  if (cual === VOZ_IA) {
    return process.env.ELEVENLABS_VOICE_ID_IA
        || process.env.ELEVENLABS_VOICE_ID    // sin segunda voz: la misma
        || '';
  }
  return process.env.ELEVENLABS_VOICE_ID || '';
}

/** La huella de un texto EN UNA VOZ. Mismo texto + misma voz → mismo archivo. */
export function huella(texto, cual = VOZ_AUTOR) {
  // La semilla lleva la voz Y sus ajustes: dos voces (o los mismos ajustes
  // cambiados) dan archivos distintos y no se pisan entre sí.
  const a = AJUSTES(cual);
  const semilla = `${idDeVoz(cual)}|${a.stability}/${a.similarity_boost}/${a.style}/${a.speed}|${String(texto).trim()}`;
  return crypto.createHash('sha1').update(semilla).digest('hex').slice(0, 16);
}

/** ¿Ya existe en disco? Devuelve el nombre del archivo o null. */
export function buscarEnDisco(texto, cual = VOZ_AUTOR) {
  const nombre = huella(texto, cual) + '.mp3';
  for (const dir of [DIR_RESPALDO, DIR_CACHE]) {
    if (fs.existsSync(path.join(dir, nombre))) return nombre;
  }
  return null;
}

/**
 * Cuánto dura un mp3, en milisegundos, SIN abrirlo.
 * Los mp3 que grabamos son de tasa constante a 128 kbps, así que
 * duración = bytes × 8 ÷ 128000. El error es de centésimas de segundo.
 * Esto es lo que hace posible el MODO AUTOMÁTICO: el orquestador sabe cuánto
 * dura cada bloque y pasa solo al siguiente cuando la voz termina.
 */
export function duracionMs(nombre) {
  if (!nombre) return 0;
  for (const dir of [DIR_RESPALDO, DIR_CACHE, DIR_SONIDOS]) {
    const f = path.join(dir, nombre);
    if (!fs.existsSync(f)) continue;
    // Se lee la cabecera del propio mp3: vale también para TUS sonidos, que
    // pueden venir a cualquier tasa o ser de tasa variable.
    const real = duracionMp3Ms(f);
    if (real > 0) return real;
    return Math.round((fs.statSync(f).size * 8 / 128000) * 1000);
  }
  return 0;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SONIDOS EXTERNOS
//  Tus mp3 (croares, zumbidos, estática) viven en su carpeta y NO pasan por
//  ElevenLabs: no cuestan créditos y conservan su nombre, no se renombran por
//  huella. Se llaman desde el guion con @SONIDO.
// ═══════════════════════════════════════════════════════════════════════════
export const DIR_SONIDOS = 'sonidos externos';

/** Busca un sonido tuyo por nombre, tolerando mayúsculas y la extensión. */
export function buscarSonido(nombre) {
  if (!nombre || !fs.existsSync(DIR_SONIDOS)) return null;
  const pedido = String(nombre).trim().toLowerCase().replace(/\.[^.]+$/, '');
  for (const f of fs.readdirSync(DIR_SONIDOS)) {
    if (!/\.(mp3|wav|ogg|m4a)$/i.test(f)) continue;
    if (f.toLowerCase().replace(/\.[^.]+$/, '') === pedido) return f;
  }
  return null;
}

const API = () => process.env.ELEVENLABS_API_KEY;
const MODELO = () => process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5';

// Ajustes de la voz clonada. Se pueden mover desde .env sin tocar código.
// stability bajo = más expresiva y más impredecible; alto = más plana.
// TRUCO ÚTIL: si no quieres crear una segunda voz en ElevenLabs, la VOZ IA
// puede ser la MISMA voz clonada con otros ajustes — más plana, menos estilo.
// Suena a otra cosa sin costarte una voz nueva:
//     VOZ_IA_STABILITY=0.85
//     VOZ_IA_STYLE=0.05
// Los ajustes entran en la huella, así que los dos resultados conviven en
// disco sin pisarse.
function AJUSTES(cual) {
  const sufijo = cual === VOZ_IA ? '_IA' : '';
  const leer = (n, d) => Number(process.env[`VOZ${sufijo}_${n}`] ?? process.env[`VOZ_${n}`] ?? d);
  return {
    stability: leer('STABILITY', 0.45),
    similarity_boost: leer('SIMILARITY', 0.8),
    style: leer('STYLE', 0.35),
    use_speaker_boost: true,
    speed: leer('SPEED', 1.0),
  };
}

/**
 * Graba un texto a mp3 llamando a ElevenLabs. Uso interno y de prerender_voz.
 * @returns {Promise<string>} nombre del archivo (huella.mp3)
 */
export async function grabar(texto, { dir = DIR_CACHE, cual = VOZ_AUTOR } = {}) {
  const vozId = idDeVoz(cual);
  if (!API() || !vozId) throw new Error('faltan ELEVENLABS_API_KEY o ELEVENLABS_VOICE_ID en .env');
  const nombre = huella(texto, cual) + '.mp3';
  const destino = path.join(dir, nombre);

  const r = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${vozId}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': API(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: texto, model_id: MODELO(), voice_settings: AJUSTES(cual) }),
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
export async function voz(texto, { silencioso = false, cual = VOZ_AUTOR } = {}) {
  if (!texto || !texto.trim()) return null;

  const enDisco = buscarEnDisco(texto, cual);
  if (enDisco) return enDisco;                 // ← el 90 % de las veces cae aquí
  if (silencioso || process.env.SIN_VOZ === '1') return null;

  try {
    return await grabar(texto, { cual });
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
export async function vozLote(entradas, { etiqueta = '' } = {}) {
  // entradas: lista de strings, o de { texto, cual } para elegir la voz.
  const mapa = new Map();
  const pendientes = [];
  const normal = (e) => (typeof e === 'string' ? { texto: e, cual: VOZ_AUTOR } : e);

  for (const cruda of entradas) {
    const { texto: t, cual } = normal(cruda);
    if (!t || !t.trim()) continue;
    const yaEsta = buscarEnDisco(t, cual);
    if (yaEsta) mapa.set(t, yaEsta);
    else pendientes.push({ texto: t, cual });
  }

  if (pendientes.length) {
    console.log(`    voz${etiqueta ? ' ' + etiqueta : ''}: ${mapa.size} en disco · ${pendientes.length} por grabar…`);
    for (const { texto: t, cual } of pendientes) {
      const n = await voz(t, { cual });
      if (n) mapa.set(t, n);
    }
  } else if (mapa.size) {
    console.log(`    voz${etiqueta ? ' ' + etiqueta : ''}: ${mapa.size} bloques, todos en disco (sin red).`);
  }
  return mapa;
}
