// PROTOUSUARIO / AGENTE-ESPEJO — puente entre el orquestador de manifiestos
// (test_manifiesto_estructurado.js) y la interfaz visual (servidor_visual.js).
//
// POR QUÉ UN POST HTTP Y NO MEMORIA COMPARTIDA: cada vez que corres
// `node --env-file=.env scripts/test_manifiesto_estructurado.js` es un
// PROCESO DE NODE NUEVO. servidor_visual.js es OTRO proceso, que dejas
// corriendo aparte (en otra terminal) durante toda la performance. Dos
// procesos de Node no comparten variables en memoria -- la única forma
// simple de que uno le hable al otro es por red (aquí, HTTP local).
//
// v2: UNA FUNCIÓN POR BLOQUE DRAMATÚRGICO, en vez de un solo volcado de
// texto. Así la pantalla sigue EXACTAMENTE el mismo ritmo que tu consola
// (cada bloque aparece cuando TÚ presionas ENTER), y cada bloque tiene su
// propio lugar y tratamiento visual:
//
//   emitirPreludio()      -> pantalla completa (ceremonial, una sola vez)
//   emitirAgenteId()      -> pantalla completa (una vez por agente)
//   emitirBloqueOrbital() -> panel superior derecho (junto a la telemetría)
//   emitirMemoria()       -> panel izquierdo (íntimo, primera persona)
//   emitirPrompt()        -> inferior derecha (lo que el PROTOUSUARIO ejecuta)
//   emitirSatelite()      -> sincroniza el globo con ESTE manifiesto
//   emitirAfecto()        -> cambia la paleta/tipografía de toda la interfaz
//
// Si servidor_visual.js NO está corriendo (ej. ensayas solo el texto, sin
// pantalla), TODO esto falla en silencio -- el generador de manifiestos sigue
// funcionando igual. La interfaz visual es un "lujo conmutable".

const URL_BASE = process.env.URL_VISUAL || 'http://localhost:3000';

async function emitirEvento(tipo, datos) {
  try {
    await fetch(`${URL_BASE}/evento`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo, datos }),
      signal: AbortSignal.timeout(1500), // no bloquear la performance si la interfaz no responde
    });
  } catch {
    // silencioso a propósito: la interfaz visual es un extra, nunca debe
    // frenar la generación de manifiestos si el servidor visual no está arriba.
  }
}

// ---------- Bloques ceremoniales (pantalla completa, una sola vez) ----------
export function emitirPreludio(titulo, texto) {
  return emitirEvento('preludio', { titulo, texto });
}

export function emitirAgenteId(nombre, texto) {
  return emitirEvento('agente_id', { nombre, texto });
}

// ---------- Bloques del manifiesto (aparecen uno por uno, a tu ritmo) ----------
export function emitirBloqueOrbital(texto) {
  return emitirEvento('bloque_orbital', { texto });
}

export function emitirMemoria(texto) {
  return emitirEvento('memoria', { texto });
}

export function emitirPrompt(texto) {
  return emitirEvento('prompt', { texto });
}

// ---------- Sincronización del globo ----------
// CLAVE contra la desincronización: el orquestador manda AQUÍ el mismo objeto
// `dato` que usó para construir el manifiesto. Así el globo muestra el
// satélite y el territorio EXACTOS que Gemini está nombrando, en vez de que
// el servidor visual consulte por su cuenta y elija otro satélite distinto.
export function emitirSatelite(dato) {
  return emitirEvento('satelite_manifiesto', {
    satelite: dato.satelite,
    satelite_enunciable: dato.satelite_enunciable,
    lat: dato.lat, lon: dato.lon, altKm: dato.altKm,
    elevacionDeg: dato.elevacionDeg, rangeKm: dato.rangeKm,
    pais: dato.pais, pais_tipo: dato.pais_tipo,
    region: dato.region, region_real: dato.region_real,
    modo_datos: dato.modo_datos,
    todos: dato.todos,
  });
}

// ---------- Estado afectivo ----------
export function emitirAfecto(estado) {
  return emitirEvento('afecto', { estado });
}

// ---------- Compatibilidad hacia atrás ----------
// Si ya tenías `emitirManifiesto(...)` puesto en tu orquestador, sigue
// funcionando: manda el texto completo a la zona del prompt.
export function emitirManifiesto(texto) {
  return emitirEvento('prompt', { texto });
}
