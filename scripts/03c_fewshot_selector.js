// PROTOUSUARIO / AGENTE-ESPEJO — Paper 3, Etapa 3
// Selección de ~5 ejemplos few-shot rotativos por registro. Techo de 5 según Wang et al.
// (EMNLP 2025): más ejemplos casi no mejora fidelidad de estilo y gasta contexto/tokens.
//
// "Rotativo" = el estado se guarda en fewshot_rotation_state.json (independiente de memoria.json:
// esto NO es historial conversacional, es solo el mazo de qué ejemplos ya se usaron). Cada turno
// saca una mano distinta; cuando el mazo se agota, se reshuffle completo — nunca se repite la
// misma combinación dos veces seguidas, nunca se queda sin ejemplos.

import fs from 'fs';
import readline from 'readline';

const CORPUS_PATH = 'corpus/private/language_corpus.private.jsonl';
const ROTATION_STATE_PATH = 'fewshot_rotation_state.json';
const N_EJEMPLOS = 5;

let CACHE_CORPUS = null;

// ---------- Cargar corpus completo indexado por registro (una vez por sesión) ----------
async function obtenerCorpusPorRegistro() {
  if (CACHE_CORPUS) return CACHE_CORPUS;
  const porRegistro = {};
  const rl = readline.createInterface({ input: fs.createReadStream(CORPUS_PATH), crlfDelay: Infinity });
  for await (const linea of rl) {
    if (!linea.trim()) continue;
    const msg = JSON.parse(linea);
    const reg = msg.registro || 'sin_registro';
    (porRegistro[reg] ??= []).push(msg);
  }
  CACHE_CORPUS = porRegistro;
  return porRegistro;
}

function cargarEstadoRotacion() {
  if (!fs.existsSync(ROTATION_STATE_PATH)) return {};
  return JSON.parse(fs.readFileSync(ROTATION_STATE_PATH, 'utf8'));
}
function guardarEstadoRotacion(estado) {
  fs.writeFileSync(ROTATION_STATE_PATH, JSON.stringify(estado, null, 2), 'utf8');
}

/**
 * Selecciona ~5 ejemplos reales del registro dado, rotando para no repetir la misma
 * combinación en turnos consecutivos.
 *
 * @param {string} registro - ej. 'instagram_intimo', 'chatbot_analitico', 'obra_artistico'
 * @param {object} opciones
 * @param {string} [opciones.semilla] - texto del contexto actual; si se pasa, se añade un
 *   snippet de sus primeras ~20% palabras como "semilla auténtica" (truco de Wang et al.
 *   que más aumenta la percepción de voz humana en la generación).
 * @param {boolean} [opciones.resetear] - si true, vacía el mazo de este registro antes de
 *   sacar la mano (úsalo si quieres una performance bit-por-bit repetible con desde_cero=true).
 */
async function seleccionarEjemplos(registro, { semilla = null, resetear = false } = {}) {
  const corpus = await obtenerCorpusPorRegistro();
  const mensajes = corpus[registro];
  if (!mensajes || mensajes.length === 0) {
    console.warn(`⚠ Sin mensajes para el registro "${registro}" — fusiona con un registro afín en el corpus.`);
    return [];
  }

  const estado = cargarEstadoRotacion();
  let usados = resetear ? [] : (estado[registro] || []);
  let disponibles = mensajes.map((_, i) => i).filter((i) => !usados.includes(i));

  if (disponibles.length < N_EJEMPLOS) {
    // Mazo agotado (o pocos mensajes en este registro): reshuffle completo
    usados = [];
    disponibles = mensajes.map((_, i) => i);
  }

  const pool = [...disponibles].sort(() => Math.random() - 0.5);
  const elegidos = pool.slice(0, N_EJEMPLOS);

  usados.push(...elegidos);
  estado[registro] = usados;
  guardarEstadoRotacion(estado);

  const ejemplos = elegidos.map((i) => mensajes[i].texto);

  if (semilla) {
    const palabras = semilla.split(/\s+/).filter(Boolean);
    const nSemilla = Math.max(1, Math.round(palabras.length * 0.2));
    const snippet = palabras.slice(0, nSemilla).join(' ');
    ejemplos.push(`[SEMILLA — continúa desde aquí en tu voz]: "${snippet}..."`);
  }

  return ejemplos;
}

export { seleccionarEjemplos };
