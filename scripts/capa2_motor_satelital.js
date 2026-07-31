// PROTOUSUARIO / AGENTE-ESPEJO — Paper 4, Capa 2
// Backbone offline: TLEs pre-descargados de CelesTrak + satellite.js (SGP4 100% local).
// Descarga antes de la performance, ej.: https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle
// y guarda el resultado en tles/starlink.tle — de ahí en adelante no necesita internet.

import fs from 'fs';
import * as satellite from 'satellite.js';

const UMBRAL_ELEVACION_GRADOS = 20; // baja esto para expandir el radio de detección
const UMBRAL_RANGO_KM = 1500; // sube esto para expandir el radio de detección

// AJUSTA a las coordenadas reales del espacio de performance (lat/lon en grados, altura en km)
const OBSERVADOR = {
  latitude: satellite.degreesToRadians(-12.046374),
  longitude: satellite.degreesToRadians(-77.042793),
  height: 0.15,
};

function cargarTLEs(path) {
  const lineas = fs.readFileSync(path, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  const sats = [];
  for (let i = 0; i < lineas.length; i += 3) {
    const nombre = lineas[i];
    const l1 = lineas[i + 1];
    const l2 = lineas[i + 2];
    if (!l1 || !l2) continue;
    sats.push({ nombre, satrec: satellite.twoline2satrec(l1, l2) });
  }
  return sats;
}

// Revisa todos los satélites cargados y devuelve el primero que esté "cerca"
// según los umbrales. 100% cálculo local — no llama a ninguna API.
function hayProximidad(sats, fecha = new Date()) {
  const gmst = satellite.gstime(fecha);
  for (const { nombre, satrec } of sats) {
    const pv = satellite.propagate(satrec, fecha);
    if (!pv.position) continue;
    const posEcf = satellite.eciToEcf(pv.position, gmst);
    const look = satellite.ecfToLookAngles(OBSERVADOR, posEcf);
    const elevGrados = satellite.radiansToDegrees(look.elevation);
    if (elevGrados >= UMBRAL_ELEVACION_GRADOS && look.rangeSat <= UMBRAL_RANGO_KM) {
      return { proximidad: true, satelite: nombre, elevacion: +elevGrados.toFixed(1), rango: +look.rangeSat.toFixed(0) };
    }
  }
  return { proximidad: false };
}

// Máquina de estados afectiva con histéresis (no "parpadea" con cada micro-cambio).
// AUTORITARIO domina por diseño porque los satélites están lejos la mayor parte del tiempo.
class MotorAfectivo {
  constructor() {
    this.estado = 'AUTORITARIO';
    this.ultimoCambio = 0;
    this.histeresisMs = 15000;
  }
  actualizar(hayProximidadBool) {
    const ahora = Date.now();
    if (ahora - this.ultimoCambio < this.histeresisMs) return this.estado;
    const objetivo = hayProximidadBool ? 'TERNURA' : 'AUTORITARIO';
    if (objetivo !== this.estado) {
      this.estado = objetivo;
      this.ultimoCambio = ahora;
    }
    return this.estado;
  }
  descriptorPrompt() {
    return {
      AUTORITARIO: { tono: 'firme, frío, sentencioso', registro: 'institucional' },
      TERNURA: { tono: 'tierno, incierto, vulnerable', registro: 'intimo' },
    }[this.estado];
  }
}

export { cargarTLEs, hayProximidad, MotorAfectivo };
