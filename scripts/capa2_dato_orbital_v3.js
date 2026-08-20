// PROTOUSUARIO / AGENTE-ESPEJO -- Capa 2, "Dato orbital" v3.1
//
// ═══ QUE CAMBIA EN v3.1 (rendimiento; misma salida, mismo contrato) ═══
// El grupo 'active' de CelesTrak trae ~13.000 objetos. Antes, CADA llamada:
//   (a) leia y parseaba de disco un JSON de ~10 MB,
//   (b) construia 13.000 satrec desde cero con json2satrec(),
//   (c) devolvia los 13.000 en 'todos' para dibujarlos en el navegador.
// Con el ciclo de espera corriendo cada 5 s, eso bloqueaba el hilo de Node
// varias decimas de segundo por vuelta y ahogaba al navegador. Ahora:
//   (a) el JSON parseado se memoriza en RAM (MEMO_GP),
//   (b) los satrec se memorizan por satelite (MEMO_SATREC): json2satrec es
//       lo caro, propagate() es barato,
//   (c) 'todos' se recorta a MAX_SATELITES (por defecto 400) eligiendo los
//       mas cercanos al protagonista + un reparto global, para que la nube
//       se vea densa alrededor de la accion sin fundir la GPU.
// Se ajusta con variables de entorno: MAX_SATELITES=250 node ...
//
// Reemplaza a capa2_dato_orbital.js (v2). Mantiene el mismo CONTRATO de
// salida que ya consume test_manifiesto_estructurado.js:
//   { satelite, satelite_enunciable, region, contexto, simulado }
// y AGREGA lo que pediste: país/territorio real, coordenadas, y la lista
// de TODOS los satélites del grupo (para dibujarlos en el globo).
//
// DOS CAPAS DE TERRITORIO QUE CONVIVEN (a propósito, no es redundante):
//  1. "region"/"contexto" -- tu curaduría dramatúrgica en regiones_conflicto.json
//     (cajas que TÚ elegiste a mano por su carga simbólica). Sigue mandando
//     en la narrativa: si el satélite protagonista cae ahí, ese es el elegido.
//  2. "pais"/"pais_tipo" -- la geografía REAL (Natural Earth + resolver_territorio.js),
//     para que la interfaz visual pueda decir "Bolivia" o "Océano Pacífico Sur"
//     aunque ese país no esté en tu lista curada de conflicto.
//
// ESTADOS DE SALUD: "modo_datos" viaja en la respuesta:
//   ONLINE_COMPLETO -> CelesTrak respondió fresco
//   DEGRADADO       -> se usó un cache vencido (red caída)
//   OFFLINE_AUTONOMO -> ni red ni cache -> "simulado: true"
// La resolución de territorio (resolver_territorio.js) es SIEMPRE local, así
// que no aparece en esta lista de estados: funciona igual en los tres casos.

import { readFileSync } from 'node:fs';
import * as satellite from 'satellite.js';
import { obtenerGP } from './descargar_gp.js';
import { resolverTerritorio } from './resolver_territorio.js';

const LIMA = { lat: -12.0464, lon: -77.0428, altKm: 0.154 };

// Cuantos satelites se MANDAN al navegador (no cuantos se propagan).
// 400 se ve denso como satellitemap.space y la GTX 1050 lo mueve sobrado.
const MAX_SATELITES = Number(process.env.MAX_SATELITES || 400);

// Memoria de proceso: evita releer/reparsear y reconstruir todo cada vuelta.
const MEMO_GP = new Map();      // cachePath -> { t, modo, datos }
const MEMO_SATREC = new Map();  // clave del satelite -> satrec
const MEMO_GP_MS = 15 * 60 * 1000;  // 15 min: los TLE no cambian tan rapido

function claveSat(omm) {
  return String(omm.NORAD_CAT_ID ?? omm.OBJECT_ID ?? omm.OBJECT_NAME);
}

/**
 * Recorta la nube de satelites que viaja al navegador.
 * Mitad "cerca del protagonista" (para que la accion se vea poblada) y
 * mitad repartida por todo el globo (para que el planeta no quede vacio).
 */
function recortarNube(candidatos, elegido, maximo) {
  if (candidatos.length <= maximo) return candidatos;
  const cerca = [...candidatos].sort((a, b) => {
    const da = (a.lat - elegido.lat) ** 2 + (a.lon - elegido.lon) ** 2;
    const db = (b.lat - elegido.lat) ** 2 + (b.lon - elegido.lon) ** 2;
    return da - db;
  }).slice(0, Math.floor(maximo / 2));
  const vistos = new Set(cerca.map((c) => c.nombre));
  const resto = candidatos.filter((c) => !vistos.has(c.nombre));
  const paso = Math.max(1, Math.floor(resto.length / (maximo - cerca.length)));
  const reparto = [];
  for (let i = 0; i < resto.length && reparto.length < maximo - cerca.length; i += paso) {
    reparto.push(resto[i]);
  }
  return cerca.concat(reparto);
}

function cargarRegiones(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8')).regiones ?? [];
  } catch {
    return []; // si no existe el archivo o está vacío, seguimos sin curaduría de conflicto
  }
}

function dentroDeBbox(lat, lon, [latMin, latMax, lonMin, lonMax]) {
  return lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax;
}

function enunciable(nombre) {
  return String(nombre).replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * @param {object} opciones
 * @param {string} [opciones.grupo]           grupo de CelesTrak: 'stations', 'starlink', 'weather', 'active'...
 * @param {{lat:number, lon:number, altKm:number}} [opciones.observador]  por defecto Lima
 * @param {string} [opciones.regionesPath]     ruta a tu regiones_conflicto.json curado
 * @returns {Promise<object>} el dato orbital unificado (ver comentario arriba)
 */
export async function obtenerDatoOrbital({
  grupo = 'stations',
  observador = LIMA,
  regionesPath = 'regiones_conflicto.json',
} = {}) {
  const regiones = cargarRegiones(regionesPath);
  const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${grupo}&FORMAT=json`;
  const cachePath = `tles/gp_cache_${grupo}.json`;

  // --- memoria de proceso: no releer 10 MB de disco cada 5 segundos ---
  let modo, datos;
  const memo = MEMO_GP.get(cachePath);
  if (memo && Date.now() - memo.t < MEMO_GP_MS) {
    ({ modo, datos } = memo);
  } else {
    ({ modo, datos } = await obtenerGP({ url, cachePath }));
    MEMO_GP.set(cachePath, { t: Date.now(), modo, datos });
  }

  // ---------- MODO SIMULADO (no hay datos reales de ningún tipo) ----------
  // CLAVE para "nunca parar": aunque no haya TLE/JSON real, esta rama SIEMPRE
  // devuelve lat/lon plausibles (y país/océano resuelto sobre ellas), para que
  // la interfaz visual nunca se quede con la pantalla vacía en OFFLINE_AUTONOMO.
  if (!datos.length) {
    const r = regiones.length ? regiones[Math.floor(Math.random() * regiones.length)] : null;
    const nombreSim = 'SATÉLITE-' + Math.floor(1000 + Math.random() * 9000);

    // Si hay una región curada, el punto simulado cae en el centro de su bbox
    // (para que la narrativa siga siendo la tuya); si no, un punto al azar
    // sobre el globo (evitando los polos, poco interesantes visualmente).
    let lat, lon;
    if (r) {
      const [latMin, latMax, lonMin, lonMax] = r.bbox;
      lat = (latMin + latMax) / 2;
      lon = (lonMin + lonMax) / 2;
    } else {
      lat = -60 + Math.random() * 135; // rango -60..75
      lon = -180 + Math.random() * 360;
    }
    const territorioSim = resolverTerritorio(lat, lon);
    const elevacionSim = -20 + Math.random() * 90; // a veces bajo el horizonte, a veces alto

    return {
      modo_datos: 'OFFLINE_AUTONOMO',
      satelite: nombreSim,
      satelite_enunciable: enunciable(nombreSim),
      region: r?.nombre ?? null,
      contexto: r?.contexto ?? null,
      region_real: false, // todo el dato es fabricado en esta rama
      simulado: true,
      pais: territorioSim.nombre, pais_tipo: territorioSim.tipo,
      lat, lon, altKm: 400 + Math.random() * 250,
      elevacionDeg: elevacionSim, rangeKm: 800 + Math.random() * 1500,
      proximidad: Math.max(0, Math.min(1, elevacionSim / 90)),
      todos: [{ nombre: nombreSim, lat, lon, altKm: 400 }],
    };
  }

  // ---------- PROPAGAR TODOS LOS SATÉLITES DEL GRUPO ----------
  const ahora = new Date();
  const gmst = satellite.gstime(ahora);
  const observerGd = {
    longitude: satellite.degreesToRadians(observador.lon),
    latitude: satellite.degreesToRadians(observador.lat),
    height: observador.altKm ?? 0.15,
  };

  const candidatos = [];
  for (const omm of datos) {
    try {
      // json2satrec es lo caro (parseo + inicializacion SGP4). Se hace UNA
      // vez por satelite en toda la sesion; propagate() si es barato.
      const k = claveSat(omm);
      let satrec = MEMO_SATREC.get(k);
      if (!satrec) { satrec = satellite.json2satrec(omm); MEMO_SATREC.set(k, satrec); }
      const pv = satellite.propagate(satrec, ahora);
      if (!pv || !pv.position) continue; // objeto decaído / error numérico: se descarta

      const geo = satellite.eciToGeodetic(pv.position, gmst);
      const lat = satellite.degreesLat(geo.latitude);
      const lon = satellite.degreesLong(geo.longitude);

      const positionEcf = satellite.eciToEcf(pv.position, gmst);
      const look = satellite.ecfToLookAngles(observerGd, positionEcf);
      const elevacionDeg = satellite.radiansToDegrees(look.elevation);
      const rangeKm = look.rangeSat;

      const regionConflicto = regiones.find((r) => dentroDeBbox(lat, lon, r.bbox));

      candidatos.push({
        nombre: omm.OBJECT_NAME,
        k,                       // clave para repropagar rápido (ver repropagarNube)
        lat, lon, altKm: geo.height,
        elevacionDeg, rangeKm,
        regionConflicto,
      });
    } catch {
      continue; // un satélite con elementos corruptos no debe tumbar a los demás
    }
  }

  if (!candidatos.length) {
    // los datos llegaron pero ninguno propagó (muy raro): mismo respaldo que arriba
    const nombreSim = 'SATÉLITE-' + Math.floor(1000 + Math.random() * 9000);
    const r = regiones.length ? regiones[Math.floor(Math.random() * regiones.length)] : null;
    return {
      modo_datos: modo, satelite: nombreSim, satelite_enunciable: enunciable(nombreSim),
      region: r?.nombre ?? null, contexto: r?.contexto ?? null, region_real: false, simulado: true,
      pais: null, pais_tipo: null, lat: null, lon: null, altKm: null,
      elevacionDeg: null, rangeKm: null, proximidad: 0, todos: [],
    };
  }

  // ---------- ELEGIR PROTAGONISTA ----------
  // Prioridad 1: el primero que caiga en una región de conflicto curada (tu dramaturgia manda).
  // Prioridad 2: si ninguno cae ahí, el de mayor elevación (el "más presente" en el cielo).
  const elegido =
    candidatos.find((c) => c.regionConflicto) ??
    candidatos.reduce((mejor, c) => (!mejor || c.elevacionDeg > mejor.elevacionDeg ? c : mejor), null);

  const territorio = resolverTerritorio(elegido.lat, elegido.lon); // UNA sola consulta, sobre el elegido

  // GARANTÍA HEREDADA de tu capa2_dato_orbital.js original: region/contexto
  // NUNCA deben quedar en null (tu prompt los interpola sin '??' de respaldo).
  // Si el protagonista real NO cae en ninguna región curada, se asigna una al
  // azar de tu regiones_conflicto.json -- igual que hacía tu sistema viejo --
  // pero (mejora real) el satélite y las coordenadas siguen siendo REALES,
  // en vez de inventar un satélite falso como hacía la versión anterior.
  const regionAsignada = elegido.regionConflicto ?? (regiones.length ? regiones[Math.floor(Math.random() * regiones.length)] : null);

  return {
    modo_datos: modo,
    satelite: elegido.nombre,
    satelite_enunciable: enunciable(elegido.nombre),
    region: regionAsignada?.nombre ?? null,
    contexto: regionAsignada?.contexto ?? null,
    region_real: !!elegido.regionConflicto, // true = el satélite SÍ sobrevuela esa región ahora; false = asignación decorativa de respaldo
    simulado: false,
    pais: territorio.nombre,
    pais_tipo: territorio.tipo,
    lat: elegido.lat, lon: elegido.lon, altKm: elegido.altKm,
    elevacionDeg: elegido.elevacionDeg, rangeKm: elegido.rangeKm,
    proximidad: Math.max(0, Math.min(1, elegido.elevacionDeg / 90)),
    // TODOS los satélites del grupo con posición, para dibujar el fondo en el globo.
    // Nube RECORTADA (ver recortarNube): el navegador no necesita 13.000
    // puntos para verse lleno, y con 13.000 no se ve: se atraganta.
    todos: recortarNube(candidatos, elegido, MAX_SATELITES)
      .map((c) => ({ nombre: c.nombre, k: c.k, lat: c.lat, lon: c.lon, altKm: c.altKm })),
    protagonista_k: elegido.k,
  };
}


/**
 * REPROPAGACIÓN RÁPIDA — para que los satélites se vean MOVERSE.
 *
 * El ciclo completo (obtenerDatoOrbital) es caro porque propaga los ~13.000
 * objetos del grupo para poder elegir protagonista. Pero una vez elegida la
 * nube de 200-400, recalcular SOLO esas posiciones cuesta menos de 2 ms,
 * porque sus satrec ya están en MEMO_SATREC.
 *
 * Así el servidor puede refrescar posiciones cada ~800 ms (movimiento
 * continuo y visible) sin volver a hacer el trabajo pesado.
 *
 * @param {Array<{nombre:string,k:string}>} nube  la lista 'todos' anterior
 * @param {Date} [fecha]
 * @returns {Array<{nombre,k,lat,lon,altKm}>}  posiciones frescas
 */
export function repropagarNube(nube, fecha = new Date()) {
  const gmst = satellite.gstime(fecha);
  const salida = [];
  for (const s of nube || []) {
    const satrec = MEMO_SATREC.get(s.k);
    if (!satrec) { salida.push(s); continue; }   // sin satrec: se queda quieto
    try {
      const pv = satellite.propagate(satrec, fecha);
      if (!pv || !pv.position) { salida.push(s); continue; }
      const geo = satellite.eciToGeodetic(pv.position, gmst);
      salida.push({
        nombre: s.nombre, k: s.k,
        lat: satellite.degreesLat(geo.latitude),
        lon: satellite.degreesLong(geo.longitude),
        altKm: geo.height,
      });
    } catch { salida.push(s); }
  }
  return salida;
}
