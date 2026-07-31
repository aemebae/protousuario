// PROTOUSUARIO / AGENTE-ESPEJO — Capa 2, extensión "Dato orbital"
// Responde: ¿qué satélite del TLE sobrevuela AHORA alguna región de conflicto?
// Lógica invertida respecto a capa2_motor_satelital.js: en vez de mirar desde un
// observador (elevación/rango sobre la sala), calculamos el punto subsatelital
// (lat/lon del satélite proyectado sobre la Tierra) y revisamos si cae dentro
// del bounding box de alguna región de regiones_conflicto.json.
//
// NOTA TÉCNICA (la lección del ERR_MODULE_NOT_FOUND): acá uso `await import(...)`
// —import DINÁMICO— en vez del import estático de arriba del archivo. El estático
// se resuelve ANTES de ejecutar cualquier línea, así que revienta si el paquete
// no está instalado aunque haya try/catch. El dinámico se ejecuta como una línea
// más, DENTRO del try: si satellite.js no está, cae limpio al modo simulado.

import fs from 'fs';

const REGIONES_PATH = 'regiones_conflicto.json';

function cargarRegiones() {
  return JSON.parse(fs.readFileSync(REGIONES_PATH, 'utf8')).regiones;
}

function dentroDeBbox(lat, lon, [latMin, latMax, lonMin, lonMax]) {
  return lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax;
}

/**
 * Devuelve { satelite, region, contexto, simulado }.
 * - Con satellite.js instalado + TLE descargado: satélite REAL sobre región REAL ahora.
 * - Sin ellos: región al azar + nombre de satélite simulado (para ensayar hoy).
 */
export async function obtenerDatoOrbital({ tlePath = 'tles/starlink.tle' } = {}) {
  const regiones = cargarRegiones();

  try {
    const mod = await import('satellite.js'); // import dinámico: no revienta al cargar el módulo
    const satellite = mod.default ?? mod;
    const lineas = fs.readFileSync(tlePath, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
    const ahora = new Date();
    const gmst = satellite.gstime(ahora);

    for (let i = 0; i + 2 < lineas.length; i += 3) {
      const nombre = lineas[i];
      const satrec = satellite.twoline2satrec(lineas[i + 1], lineas[i + 2]);
      const pv = satellite.propagate(satrec, ahora);
      if (!pv.position) continue;
      const geo = satellite.eciToGeodetic(pv.position, gmst);
      const lat = satellite.degreesLat(geo.latitude);
      const lon = satellite.degreesLong(geo.longitude);
      for (const r of regiones) {
        if (dentroDeBbox(lat, lon, r.bbox)) {
          return { satelite: nombre, region: r.nombre, contexto: r.contexto, simulado: false };
        }
      }
    }
    // Ningún satélite del TLE está sobre una región en este instante: cae a simulado.
  } catch {
    // satellite.js no instalado o TLE ausente: modo simulado para poder ensayar igual.
  }

  const r = regiones[Math.floor(Math.random() * regiones.length)];
  return {
    satelite: 'SATELITE-SIMULADO-' + Math.floor(1000 + Math.random() * 9000),
    region: r.nombre,
    contexto: r.contexto,
    simulado: true,
  };
}
