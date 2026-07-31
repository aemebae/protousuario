// PROTOUSUARIO / AGENTE-ESPEJO -- Capa 2, extensión "Resolución de territorio"
//
// QUÉ HACE: dado un lat/lon (el punto subsatelital, es decir el punto en el
// suelo directamente debajo del satélite), responde "¿qué país o qué océano
// es esto, en español?".
//
// CÓMO: point-in-polygon (algoritmo que revisa si un punto cae DENTRO de un
// polígono) contra el GeoJSON de países de Natural Earth (dominio público,
// 100% legal para performance pública). Si no cae en ningún país (~70% de
// los puntos sobre la Tierra son agua), cae a una lista aproximada de
// océanos/mares por cajas (oceanos.json). Si ni eso lo cubre, calcula el
// país cuyo centroide está más cerca (para que un manifiesto NUNCA se quede
// sin territorio que nombrar).
//
// TODO ESTO ES 100% LOCAL/OFFLINE -- no requiere internet, mapea directo al
// estado ONLINE_COMPLETO/DEGRADADO/OFFLINE_AUTONOMO sin ninguna diferencia
// entre ellos (siempre funciona igual).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, '..');

const paisesGeoJSON = JSON.parse(
  readFileSync(join(RAIZ, 'data', 'ne_110m_admin_0_countries.geojson'), 'utf8')
);
const { oceanos } = JSON.parse(readFileSync(join(RAIZ, 'data', 'oceanos.json'), 'utf8'));

// Precalculamos el centroide aproximado de cada país (promedio simple de
// vértices del primer anillo) para el respaldo de "país más cercano".
// No es un centroide geométrico perfecto, pero sobra para elegir "el más
// cercano" cuando ya sabemos que no cayó dentro de ninguno.
function centroideAproximado(feature) {
  const geom = feature.geometry;
  const anillos = geom.type === 'Polygon' ? [geom.coordinates[0]]
    : geom.type === 'MultiPolygon' ? geom.coordinates.map((poly) => poly[0])
    : [];
  let sx = 0, sy = 0, n = 0;
  for (const anillo of anillos) {
    for (const [x, y] of anillo) { sx += x; sy += y; n++; }
  }
  return n ? { lon: sx / n, lat: sy / n } : null;
}

const paisesConCentroide = paisesGeoJSON.features.map((f) => ({
  feature: f,
  centroide: centroideAproximado(f),
}));

function distanciaAprox(lat1, lon1, lat2, lon2) {
  // distancia plana aproximada (suficiente para "cuál está más cerca", no
  // para navegación real): un grado de latitud son ~111km en todas partes.
  const dLat = lat1 - lat2;
  const dLon = (lon1 - lon2) * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

function dentroDeBbox(lat, lon, [latMin, latMax, lonMin, lonMax]) {
  return lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax;
}

/**
 * Resuelve territorio para un lat/lon.
 * @returns {{
 *   tipo: 'pais' | 'oceano' | 'pais_cercano',
 *   nombre: string,       // en español, listo para mostrar/decir
 *   nombre_en: string,
 *   admin: string,        // nombre administrativo (para depurar/matchear)
 * }}
 */
export function resolverTerritorio(lat, lon) {
  const pt = { type: 'Point', coordinates: [lon, lat] }; // GeoJSON = [lon, lat] !

  // 1) ¿Cae dentro de algún país?
  for (const f of paisesGeoJSON.features) {
    try {
      if (booleanPointInPolygon(pt, f)) {
        return {
          tipo: 'pais',
          nombre: f.properties.NAME_ES || f.properties.NAME_EN || f.properties.ADMIN,
          nombre_en: f.properties.NAME_EN || f.properties.ADMIN,
          admin: f.properties.ADMIN,
        };
      }
    } catch { /* geometría con anillo inválido: seguir con el siguiente país */ }
  }

  // 2) ¿Cae dentro de alguna caja de océano/mar?
  for (const o of oceanos) {
    if (dentroDeBbox(lat, lon, o.bbox)) {
      return { tipo: 'oceano', nombre: o.nombre, nombre_en: o.nombre, admin: null };
    }
  }

  // 3) Respaldo final: país más cercano por centroide aproximado.
  let mejor = null, mejorDist = Infinity;
  for (const { feature, centroide } of paisesConCentroide) {
    if (!centroide) continue;
    const d = distanciaAprox(lat, lon, centroide.lat, centroide.lon);
    if (d < mejorDist) { mejorDist = d; mejor = feature; }
  }
  if (mejor) {
    return {
      tipo: 'pais_cercano',
      nombre: mejor.properties.NAME_ES || mejor.properties.ADMIN,
      nombre_en: mejor.properties.NAME_EN || mejor.properties.ADMIN,
      admin: mejor.properties.ADMIN,
    };
  }

  // Esto no debería pasar nunca (los océanos cubren todo lo que falta), pero
  // por si acaso: nunca queremos que un manifiesto se quede sin territorio.
  return { tipo: 'desconocido', nombre: 'aguas no identificadas', nombre_en: 'unidentified waters', admin: null };
}
