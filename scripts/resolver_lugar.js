// PROTOUSUARIO / AGENTE-ESPEJO — Distrito y ciudad bajo el satélite
//
// POR QUÉ NO USAMOS UN DATASET DE CIUDADES DEL MUNDO:
// Los datasets completos (GeoNames, Natural Earth populated places) pesan
// decenas de MB y traen 200.000 lugares que a la obra no le importan. Aquí lo
// que importa es que cuando el satélite pase sobre el Kivu, la pantalla diga
// "Goma · Kivu del Norte" — no "Kinshasa". Con 83 lugares curados a mano
// (lugares_finos.json) eso se resuelve con precisión escénica, cero MB
// extra y funcionando siempre offline.
//
// CÓMO FUNCIONA: distancia ortodrómica al lugar más cercano. Si el más cercano
// está más lejos que RADIO_MAX_KM, no devuelve nada — y el banner se queda
// mostrando solo el país, exactamente como antes. Nunca miente.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

let LUGARES = [];
try {
  const d = JSON.parse(readFileSync(join(__dirname, '..', 'lugares_finos.json'), 'utf8'));
  // Se aplana a una sola lista, cada lugar recuerda de qué región vino.
  LUGARES = (d.entradas ?? []).flatMap((e) =>
    (e.lugares ?? []).map((l) => ({ ...l, region_id: e.region_id }))
  );
} catch {
  LUGARES = [];   // sin archivo: el sistema sigue igual que antes
}

const RADIO_MAX_KM = Number(process.env.RADIO_LUGAR_KM || 320);

/** Distancia en km sobre la esfera (haversine). */
function distanciaKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * @param {number} lat
 * @param {number} lon
 * @param {object} [opciones]
 * @param {string} [opciones.regionId]  si se pasa, solo busca dentro de esa región
 * @returns {{nombre:string, tipo:string, region_id:string, km:number}|null}
 */
export function resolverLugar(lat, lon, { regionId } = {}) {
  if (lat == null || lon == null || !LUGARES.length) return null;
  const pool = regionId ? LUGARES.filter((l) => l.region_id === regionId) : LUGARES;
  if (!pool.length) return null;

  let mejor = null, mejorKm = Infinity;
  for (const l of pool) {
    const km = distanciaKm({ lat, lon }, l);
    if (km < mejorKm) { mejorKm = km; mejor = l; }
  }
  if (!mejor || mejorKm > RADIO_MAX_KM) return null;
  return { nombre: mejor.nombre, tipo: mejor.tipo, region_id: mejor.region_id, km: Math.round(mejorKm) };
}

/** Línea lista para la pantalla: "Goma · a 46 km del punto subsatelital". */
export function lineaLugar(lugar) {
  if (!lugar) return '';
  return `${lugar.nombre} · a ${lugar.km} km del punto subsatelital`;
}
