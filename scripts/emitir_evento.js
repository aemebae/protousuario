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
export const emitirAgenteId  = (nombre, texto, audio = null, extra = {}) => emitirEvento('agente_id', { nombre, texto, audio, ...extra });

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
// `extra` (v16): { token, dur, cortarFondo }. La pantalla devuelve el token
// cuando la voz termina de verdad; `dur` es la duración real del mp3 a 1×.
export const emitirSegmento = (tipo, texto, indice, audio = null, sonido = null, extra = {}) =>
  emitirEvento('segmento', { tipo, texto, indice, audio, sonido, ...extra });

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
export const emitirPreludio = (texto, audio = null, extra = {}) =>
  emitirEvento('preludio', { texto, audio, ...extra });
/** @FONDO: { accion: 'iniciar', archivo, volumen, bucle, id } o { accion: 'parar' }. */
export const emitirFondo = (datos) => emitirEvento('fondo', datos);

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
    // Faltaba: sin la clave, el servidor no podía mover al protagonista
    // durante la función (la nube se movía; el punto principal, congelado).
    protagonista_k: dato.protagonista_k ?? null,
    // El satélite del segundo territorio, para dibujarlo también.
    protagonista_b: dato.protagonista_b ?? null,
  });
}

// ---------- Partitura del clon y reposos escritos ----------
/** @CLON <figura>: le dice al clon transespecie qué rostro tomar. */
// `extra` (opcional): { hasta, silencio } en segundos, para "@CLON … fin":
// cuánto le falta al agente y cuánto de eso es silencio (clon v4, chat 6).
export const emitirClon = (figura, segundos = 12, extra = {}) =>
  emitirEvento('clon', { figura, segundos, ...extra });
/** @SILENCIO <s>: un reposo escrito; el clon puede quedarse quieto. */
export const emitirSilencio = (segundos) => emitirEvento('silencio', { segundos });

// ---------- Rumbo y pertenencia (para la rosa de los vientos en pantalla) ----------
/** @param {{estado:string, cardinal:string, azimut:number, rumboAgente:string}} r */
export const emitirRumbo = (r) => emitirEvento('rumbo', r);

// ---------- Estado del agente (paleta / tipografía) ----------
export const emitirAfecto = (estado) => emitirEvento('afecto', { estado });
