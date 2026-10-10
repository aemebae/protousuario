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
// 900 por defecto. Con la capa de PARTÍCULAS el navegador los dibuja todos en
// UNA llamada, así que 900 cuesta casi lo mismo que 200 en la GPU. Lo que sí
// crece es el tamaño del mensaje (unos 70 bytes por satélite), pero eso viaja
// dentro de la laptop, no por la red. Sube a 1500 si quieres el cielo lleno.
// MAX_SATELITES: cuántos puntos van a la pantalla. "todos" = el catálogo
// entero que haya en caché (16.471 activos en tu caché de agosto).
const MAX_SATELITES = /^(todos|all|\*)$/i.test(String(process.env.MAX_SATELITES ?? '').trim())
  ? Infinity : Number(process.env.MAX_SATELITES || 1200);
// GRUPOS_EXTRA: lo que hay MÁS ALLÁ de los satélites activos. Tus 16.471 son
// todos los que CelesTrak da por funcionando. Lo que queda en órbita además
// son restos: los escombros de tres destrucciones en el espacio (un misil
// chino contra el Fengyun-1C en 2007, el choque Iridium 33 – Cosmos 2251 en
// 2009). Entran SOLO a la nube de puntos, nunca como protagonistas: la voz
// no nombra basura. Necesitan internet UNA vez (luego quedan en tles/):
//   $env:GRUPOS_EXTRA="fengyun-1c-debris,cosmos-2251-debris,iridium-33-debris"
const GRUPOS_EXTRA = String(process.env.GRUPOS_EXTRA || '')
  .split(',').map((g) => g.trim()).filter((g) => /^[a-z0-9-]+$/i.test(g));
const avisadoExtra = new Set();

// Memoria de proceso: evita releer/reparsear y reconstruir todo cada vuelta.
const MEMO_GP = new Map();      // cachePath -> { t, modo, datos }
const MEMO_SATREC = new Map();  // clave del satelite -> satrec
const MEMO_GP_MS = 15 * 60 * 1000;  // 15 min: los TLE no cambian tan rapido

/** Los objetos de GRUPOS_EXTRA, marcados como extra (solo nube). */
async function cargarExtras() {
  const salida = [];
  for (const g of GRUPOS_EXTRA) {
    const cachePath = `tles/gp_cache_${g}.json`;
    let memo = MEMO_GP.get(cachePath);
    if (!memo || Date.now() - memo.t >= MEMO_GP_MS) {
      try {
        const r = await obtenerGP({ url: `https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=json`, cachePath });
        memo = { t: Date.now(), modo: r.modo, datos: (r.datos || []).map((x) => ({ ...x, __extra: true })) };
      } catch { memo = { t: Date.now(), datos: [] }; }
      MEMO_GP.set(cachePath, memo);
      if (!avisadoExtra.has(g)) {
        avisadoExtra.add(g);
        console.log(memo.datos.length
          ? `  + ${memo.datos.length} objetos del grupo extra "${g}" (solo nube)`
          : `  ⚠ grupo extra "${g}": sin datos (¿sin internet la primera vez?)`);
      }
    }
    salida.push(...memo.datos);
  }
  return salida;
}

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

// ═══════════════════════════════════════════════════════════════════════════
//  ¿QUÉ SATÉLITE ESTÁ ENCIMA DE ESTE TERRITORIO, AHORA?
//
//  Antes se elegía UN satélite para todo el agente con dos reglas ajenas a
//  tus territorios: "el primero que caiga en cualquier región curada" o, si
//  ninguno, "el más alto en el cielo de LIMA". Por eso la noche del 27 salió
//  ORBCOMM FM04 sobre Brasil mientras la voz hablaba del Congo: estaba alto
//  en el cielo de Lima, no encima del Congo.
//
//  Ahora, para CADA territorio, se busca entre los ~16.000 satélites el que
//  se ve más alto en el cielo DE ESE TERRITORIO. Es una definición física
//  exacta de "sobrevolar": si estuvieras parado en el centro del Congo y
//  miraras hacia arriba, ese es el que tendrías más cerca de la vertical.
//
//  Preferencia por la ÓRBITA BAJA (menos de 2.000 km): son los satélites que
//  de verdad pasan, que cruzan el territorio en minutos. Un geoestacionario
//  está siempre en el mismo sitio; si no se prefiriera la órbita baja, el
//  Congo tendría el mismo satélite todas las noches, para siempre.
// ═══════════════════════════════════════════════════════════════════════════
const R_TIERRA = 6371;
const ORBITA_BAJA_KM = Number(process.env.ORBITA_BAJA_KM || 2000);
const ELEV_MINIMA_BAJA = 30;   // un satélite bajo vale si está a más de 30° en ese cielo

function centroDeTerritorio(t) {
  if (t?.centro?.lat != null) return t.centro;
  const [a, b, c, d] = t.bbox;
  return { lat: (a + b) / 2, lon: (c + d) / 2 };
}

/** Ángulo central (radianes) entre dos puntos de la superficie. */
function anguloCentral(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const h = Math.sin(((lat2 - lat1) * r) / 2) ** 2
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Elevación (grados sobre el horizonte) a la que se ve un satélite desde un
 * punto del suelo, sabiendo solo su punto subsatelital y su altura.
 * 90° = en la vertical exacta; 0° = rasante en el horizonte; <0 = no se ve.
 */
export function elevacionDesde(gamma, altKm) {
  const k = R_TIERRA / (R_TIERRA + altKm);
  return Math.atan2(Math.cos(gamma) - k, Math.sin(gamma)) * 180 / Math.PI;
}

/**
 * El satélite que está encima de UN territorio en este instante.
 * Orden de preferencia:
 *   1. órbita baja con su punto subsatelital DENTRO del territorio
 *   2. órbita baja a más de 30° en el cielo del territorio
 *   3. cualquier órbita, la más alta en ese cielo
 * En los grupos 1 y 2 gana el que tiene el punto subsatelital MÁS CERCA del
 * centro del territorio (no "el más alto en el cielo": eso favorecía a los
 * que vuelan a 1.500 km aunque estuvieran al borde — en la prueba, un GONETS
 * sobre Puerto Maldonado, en plena Amazonía, para "el sur andino").
 * @param {Set<string>} [excluir]  claves ya usadas (para que A y B no compartan satélite)
 */
// Objetos sin nombre propio: solo tienen su matrícula internacional
// ("2024-199AU") o el rótulo provisional de un lanzamiento ("OBJECT AB").
// La voz los leería como "dos mil veinticuatro, ciento noventa y nueve, A, U".
// Se prefieren los que tienen nombre; los otros solo entran si no hay nada más.
const SIN_NOMBRE = /^(\d{4}-\d{3}[A-Z]{1,3}|OBJECT [A-Z]{1,3})$/i;

export function elegirSobreTerritorio(candidatos, territorio, excluir = new Set()) {
  return elegirSobreTerritorioFiltrado(candidatos, territorio, excluir, true)
      ?? elegirSobreTerritorioFiltrado(candidatos, territorio, excluir, false);
}

function elegirSobreTerritorioFiltrado(candidatos, territorio, excluir, soloConNombre) {
  if (!territorio?.bbox || !candidatos?.length) return null;
  const c = centroDeTerritorio(territorio);
  let dentroBajo = null, altoBajo = null, cualquiera = null;
  for (const s of candidatos) {
    if (excluir.has(s.k) || s.altKm == null) continue;
    if (soloConNombre && SIN_NOMBRE.test(String(s.nombre).trim())) continue;
    const g = anguloCentral(c.lat, c.lon, s.lat, s.lon);
    const elev = elevacionDesde(g, s.altKm);
    if (elev <= 0) continue;                       // bajo el horizonte de ese lugar
    const r = { s, elev, g, dentro: dentroDeBbox(s.lat, s.lon, territorio.bbox) };
    if (!cualquiera || elev > cualquiera.elev) cualquiera = r;
    if (s.altKm < ORBITA_BAJA_KM) {
      if (r.dentro && (!dentroBajo || g < dentroBajo.g)) dentroBajo = r;
      if (elev >= ELEV_MINIMA_BAJA && (!altoBajo || g < altoBajo.g)) altoBajo = r;
    }
  }
  const g = dentroBajo ?? altoBajo ?? cualquiera;
  if (!g) return null;
  const alt = g.s.altKm;
  return {
    territorio_id: territorio.id ?? null,
    territorio_nombre: territorio.nombre,
    satelite: g.s.nombre,
    satelite_enunciable: enunciable(g.s.nombre),
    k: g.s.k,
    lat: g.s.lat, lon: g.s.lon, altKm: alt,
    elevacion_desde_territorio: Math.round(g.elev * 10) / 10,
    distancia_km: Math.round(g.g * R_TIERRA),
    dentro: g.dentro,
    orbita: alt < ORBITA_BAJA_KM ? 'baja' : alt < 30000 ? 'media' : 'geoestacionaria',
    elevacionDeg: g.s.elevacionDeg,       // la de siempre: vista desde la sala (MINCUL)
    rangeKm: g.s.rangeKm,
  };
}

function enunciable(nombre) {
  // Para la VOZ: sin alias entre paréntesis ni etiquetas entre corchetes.
  //   "COSMOS 2532 (RODNIK-S 18)"            → "COSMOS 2532"
  //   "STARLINK-11453 [DTC]"                 → "STARLINK 11453"
  //   "DB GME UT (DB-GLOBE MISSION EARTH-UT)" → "DB GME UT"
  // En la pantalla se sigue viendo el nombre completo.
  const limpio = String(nombre).replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  return (limpio.trim() ? limpio : String(nombre)).replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
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
  territorios = [],          // [A, B]: si vienen, el protagonista es el que está encima de A
  silencioso = false,        // sin la línea de diagnóstico (para el relevo periódico)
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

  const extras = GRUPOS_EXTRA.length ? await cargarExtras() : [];
  const candidatos = [];
  for (const omm of (extras.length ? datos.concat(extras) : datos)) {
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
        extra: !!omm.__extra,    // escombro: solo nube, nunca protagonista
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
  // CON TERRITORIOS (durante la función): un satélite por territorio, el que
  // está encima de cada uno AHORA. El protagonista es el del primero.
  // SIN TERRITORIOS (la pantalla en espera, antes de empezar): la regla vieja.
  // Los escombros (GRUPOS_EXTRA) se dibujan, pero nunca protagonizan.
  const elegibles = candidatos.some((c) => c.extra) ? candidatos.filter((c) => !c.extra) : candidatos;
  const porTerritorio = [];
  const usados = new Set();
  for (const t of territorios.filter(Boolean)) {
    const r = elegirSobreTerritorio(elegibles, t, usados);
    if (r) { porTerritorio.push(r); usados.add(r.k); }
  }
  const elegido = porTerritorio.length
    ? candidatos.find((c) => c.k === porTerritorio[0].k)
    : (elegibles.find((c) => c.regionConflicto) ??
       elegibles.reduce((mejor, c) => (!mejor || c.elevacionDeg > mejor.elevacionDeg ? c : mejor), null));

  const territorio = resolverTerritorio(elegido.lat, elegido.lon); // UNA sola consulta, sobre el elegido

  // GARANTÍA HEREDADA de tu capa2_dato_orbital.js original: region/contexto
  // NUNCA deben quedar en null (tu prompt los interpola sin '??' de respaldo).
  // Si el protagonista real NO cae en ninguna región curada, se asigna una al
  // azar de tu regiones_conflicto.json -- igual que hacía tu sistema viejo --
  // pero (mejora real) el satélite y las coordenadas siguen siendo REALES,
  // en vez de inventar un satélite falso como hacía la versión anterior.
  const regionAsignada = porTerritorio.length
    ? (territorios.find(Boolean) ?? null)
    : (elegido.regionConflicto ?? (regiones.length ? regiones[Math.floor(Math.random() * regiones.length)] : null));

  // ── DIAGNÓSTICO ──
  // Sin esto no hay forma de saber por qué se ven pocos puntos: si el grupo
  // trajo 13.000 objetos o 12, si la red respondió o se está usando un caché
  // viejo. Ahora la consola lo dice en cada ciclo.
  const nube = recortarNube(candidatos, elegido, MAX_SATELITES);
  if (!silencioso) console.log(`  ☉ ${datos.length} objetos en el grupo "${grupo}" · `
    + `${candidatos.length} propagados · ${nube.length} enviados al navegador · ${modo}`);
  if (candidatos.length < 100 && !silencioso) {
    console.warn(`  ⚠ MUY POCOS SATÉLITES. Casi seguro no existe tles/gp_cache_${grupo}.json`);
    console.warn(`    y CelesTrak no respondió. Con internet, borra tles/ y vuelve a arrancar.`);
  }

  return {
    modo_datos: modo,
    n_grupo: datos.length,
    n_propagados: candidatos.length,
    n_enviados: nube.length,
    satelite: elegido.nombre,
    satelite_enunciable: enunciable(elegido.nombre),
    region: regionAsignada?.nombre ?? null,
    contexto: regionAsignada?.contexto ?? null,
    region_real: porTerritorio.length ? !!porTerritorio[0].dentro : !!elegido.regionConflicto,
    simulado: false,
    pais: territorio.nombre,
    pais_tipo: territorio.tipo,
    lat: elegido.lat, lon: elegido.lon, altKm: elegido.altKm,
    elevacionDeg: elegido.elevacionDeg, rangeKm: elegido.rangeKm,
    proximidad: Math.max(0, Math.min(1, elegido.elevacionDeg / 90)),
    // TODOS los satélites del grupo con posición, para dibujar el fondo en el globo.
    // Nube RECORTADA (ver recortarNube): el navegador no necesita 13.000
    // puntos para verse lleno, y con 13.000 no se ve: se atraganta.
    todos: nube.map((c) => ({ nombre: c.nombre, k: c.k, lat: c.lat, lon: c.lon, altKm: c.altKm })),
    protagonista_k: elegido.k,
    // Uno por territorio, en el orden de tus viñetas. Vacío en la espera.
    porTerritorio: porTerritorio.map((r) => ({
      ...r, pais: resolverTerritorio(r.lat, r.lon).nombre,
    })),
    // El segundo satélite, para dibujarlo en el globo junto al protagonista.
    protagonista_b: porTerritorio[1]
      ? { nombre: porTerritorio[1].satelite, k: porTerritorio[1].k,
          lat: porTerritorio[1].lat, lon: porTerritorio[1].lon, altKm: porTerritorio[1].altKm }
      : null,
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
