// PROTOUSUARIO / AGENTE-ESPEJO — puente entre el orquestador y la interfaz visual.
//
// v3: SEGMENTOS ENTRELAZADOS. Antes el manifiesto llegaba en tres bloques
// completos y en orden fijo (orbital -> memoria -> prompt). Ahora llega como
// una SECUENCIA de segmentos cortos que se alternan, para que PROTOUSUARIO
// pueda ejecutar una acción MIENTRAS suenan datos orbitales o memoria, en vez
// de quedarse parado esperando la siguiente instrucción.
//
// Cada segmento tiene un tipo, y cada tipo tiene su zona en pantalla:
//   orbital   -> panel superior derecho
//   memoria   -> panel izquierdo (cursiva, voz interior)
//   prompt    -> inferior derecha (lo que el cuerpo ejecuta)
//   reflexion -> inferior derecha, bajo el prompt (la cola poética)
//
// Si servidor_visual.js NO está corriendo, todo falla en silencio: la
// generación de manifiestos nunca se frena por la pantalla.

const URL_BASE = process.env.URL_VISUAL || 'http://localhost:3000';

async function emitirEvento(tipo, datos) {
  try {
    await fetch(`${URL_BASE}/evento`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo, datos }),
      signal: AbortSignal.timeout(1500),
    });
  } catch { /* silencioso a propósito */ }
}

// ---------- Ceremoniales (pantalla completa, una sola vez) ----------
export const emitirAgenteId  = (nombre, texto, audio = null) => emitirEvento('agente_id', { nombre, texto, audio });

// ---------- Segmento entrelazado ----------
/**
 * @param {'orbital'|'memoria'|'prompt'|'narracion'} tipo
 * @param {string} texto
 * @param {number} indice  posición en la secuencia (para depurar)
 */
// `audio` es el nombre del mp3 (huella.mp3). El navegador lo pide a
// /audio/<nombre> y lo reproduce mientras escribe el texto. Si va null, el
// bloque sale en silencio: la escena no se detiene por falta de voz.
// `sonido` es el nombre de un mp3 de "sonidos externos" (los tuyos, sin pasar
// por ElevenLabs). Si viene, el navegador lo reproduce en lugar de la voz.
export const emitirSegmento = (tipo, texto, indice, audio = null, sonido = null) =>
  emitirEvento('segmento', { tipo, texto, indice, audio, sonido });

// ---------- Secuencia completa (respaldo del celular) ----------
/**
 * Manda al servidor la secuencia ENTERA del manifiesto en cuanto se ensambla.
 * El celular la guarda: si el hotspot se corta mientras PROTOUSUARIO camina,
 * el teléfono sigue avanzando los textos por su cuenta y se re-sincroniza al
 * volver al alcance. Es el seguro contra la pérdida de red en escena.
 */
export const emitirSecuencia = (segmentos, meta = {}) =>
  emitirEvento('secuencia', { segmentos, ...meta });

// ---------- Pausa ----------
// Congela la función sin perder el punto. La pantalla y el celular lo muestran
// para que sepas, a oscuras y sin mirar la laptop, que el sistema está detenido
// a propósito y no colgado.
export const emitirPausa = (activa) => emitirEvento('pausa', { activa });

// ---------- Deriva (pasaje final autónomo) ----------
export const emitirDeriva = (activa) => emitirEvento('deriva', { activa });

// ---------- Preludio ----------
// Va UNA sola vez, antes de todos los IDs. No lo genera la IA.
export const emitirPreludio = (texto, audio = null) =>
  emitirEvento('preludio', { texto, audio });

// ---------- Compatibilidad con la versión de bloques ----------
export const emitirBloqueOrbital = (texto) => emitirSegmento('orbital', texto);
export const emitirMemoria       = (texto) => emitirSegmento('memoria', texto);
export const emitirPrompt        = (texto) => emitirSegmento('prompt', texto);
export const emitirManifiesto    = (texto) => emitirSegmento('prompt', texto);

// ---------- Sincronización del globo ----------
export function emitirSatelite(dato) {
  return emitirEvento('satelite_manifiesto', {
    satelite: dato.satelite, satelite_enunciable: dato.satelite_enunciable,
    lat: dato.lat, lon: dato.lon, altKm: dato.altKm,
    elevacionDeg: dato.elevacionDeg, rangeKm: dato.rangeKm,
    pais: dato.pais, pais_tipo: dato.pais_tipo,
    region: dato.region, region_real: dato.region_real,
    modo_datos: dato.modo_datos, todos: dato.todos,
  });
}

// ---------- Rumbo y pertenencia (para la rosa de los vientos en pantalla) ----------
/** @param {{estado:string, cardinal:string, azimut:number, rumboAgente:string}} r */
export const emitirRumbo = (r) => emitirEvento('rumbo', r);

// ---------- Estado del agente (paleta / tipografía) ----------
export const emitirAfecto = (estado) => emitirEvento('afecto', { estado });
