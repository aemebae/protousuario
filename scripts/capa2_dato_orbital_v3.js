// PROTOUSUARIO / AGENTE-ESPEJO -- Capa 2, "Dato orbital" v3
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

  const { modo, datos } = await obtenerGP({ url, cachePath });

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
      const satrec = satellite.json2satrec(omm);
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
    todos: candidatos.map((c) => ({ nombre: c.nombre, lat: c.lat, lon: c.lon, altKm: c.altKm })),
  };
}
