// PROTOUSUARIO / AGENTE-ESPEJO — Motor de rumbo territorial
// Reemplaza el uso de fsm_afectiva.js como "motor afectivo".
//
// LA CUALIDAD: AUTORIZADO / DESPLAZADO
//
// Cada agente tiene un rumbo propio (Ternura-Binaria es del este, Río-Digital
// del oeste...) y dos territorios curados. En cada manifiesto:
//
//   1. El SATÉLITE elige cuál de los dos territorios se nombra: el más cercano
//      a su punto subsatelital actual. (Así el satélite decide de verdad, no
//      es adorno, pero sin romper tu curaduría.)
//   2. Se calcula el RUMBO REAL de ese territorio desde Lima. Esa es la línea
//      "PROTOUSUARIO desde el este" — y es geográficamente cierta.
//   3. Si ese rumbo coincide con el rumbo propio del agente -> AUTORIZADO.
//      Si no -> DESPLAZADO.
//
// AUTORIZADO: el agente habla desde su propia casa, con voz plena.
// DESPLAZADO: le toca hablar de un territorio que no es suyo, prestado.
// Estar desplazado es la norma; llegar a casa es la excepción.
//
// CASO ESPECIAL — Eco-satelital. Su rumbo es 'cielos', que no es un punto
// cardinal: ningún territorio queda "en los cielos". Si aplicáramos la regla
// normal estaría DESPLAZADO siempre, lo cual es aburrido. Su condición es
// otra y usa un dato que si no se desperdiciaría: está AUTORIZADO cuando el
// satélite está genuinamente ENCIMA de la sala (elevación sobre el umbral).
// Así la elevación deja de ser un dimmer inútil y pasa a ser una condición
// binaria, rara y verificable.

// EL CENTRO se lee de observador.json: es el único lugar donde vive la
// posición desde la que se trazan todos los cardinales. Si la obra viaja a
// otra sede, se cambia ese archivo y todo el sistema se reorienta solo.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OBS = JSON.parse(readFileSync(join(__dirname, '..', 'observador.json'), 'utf8'));

const CENTRO = { lat: OBS.posicion.lat, lon: OBS.posicion.lon };
const ELEVACION_CIELOS = OBS.linea_de_rumbo.elevacion_cielos_grados ?? 45;

/**
 * Línea de PROTOUSUARIO. SIEMPRE sale del rumbo FIJO del agente, nunca del
 * territorio. Solo hay cinco posibles: norte, sur, este, oeste, cielos.
 * (Error de la v1: se generaba desde el cardinal del territorio, produciendo
 * cosas como "PROTOUSUARIO desde el noroeste", que no existen en la obra.)
 */
export function lineaProtousuario(rumboAgente) {
  return OBS.rumbos_protousuario?.[rumboAgente] ?? `PROTOUSUARIO desde el ${rumboAgente}`;
}

/** Ubicación del TERRITORIO respecto al observador. Aquí sí van los 8 puntos. */
export function lineaTerritorio(cardinal, azimut) {
  const o = OBS.posicion;
  return `al ${cardinal} (${Math.round(azimut)}°) desde el ${o.nombre}, ${o.ciudad}, ${o.pais}`;
}

export const observador = OBS;

/** Centro aproximado de una bbox [latMin, latMax, lonMin, lonMax]. */
export function centroBbox([latMin, latMax, lonMin, lonMax]) {
  return { lat: (latMin + latMax) / 2, lon: (lonMin + lonMax) / 2 };
}

/**
 * Rumbo (azimut) inicial en grados desde un punto a otro, 0 = norte,
 * 90 = este. Fórmula estándar de navegación sobre esfera.
 */
export function rumboEntre(desde, hacia) {
  const rad = Math.PI / 180;
  const dLon = (hacia.lon - desde.lon) * rad;
  const lat1 = desde.lat * rad, lat2 = hacia.lat * rad;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

/**
 * Convierte grados de azimut a la rosa de 8 puntos.
 * Se usan 8 y no 4 porque con 4 se pierde precisión real: el sur andino del
 * Perú está a 122° (SURESTE), y una rosa de 4 puntos lo redondeaba a 'este',
 * que es geográficamente falso.
 */
export function azimutACardinal(grados) {
  const n = ['norte','noreste','este','sureste','sur','suroeste','oeste','noroeste'];
  const g = ((grados % 360) + 360) % 360;
  return n[Math.round(g / 45) % 8];
}

/**
 * ¿El cardinal de un territorio pertenece al rumbo de un agente?
 * Un intercardinal cuenta como pertenencia PARCIAL a sus dos componentes:
 * 'sureste' autoriza tanto al agente del sur como al del este. Es lo justo:
 * ese territorio está genuinamente en ambas direcciones.
 */
export function cardinalPertenece(cardinal, rumboAgente) {
  if (cardinal === rumboAgente) return true;
  const compuestos = {
    noreste: ['norte','este'], sureste: ['sur','este'],
    suroeste: ['sur','oeste'], noroeste: ['norte','oeste'],
  };
  return (compuestos[cardinal] ?? []).includes(rumboAgente);
}

/** Distancia aproximada en grados (suficiente para "cuál está más cerca"). */
function distanciaAprox(a, b) {
  const dLat = a.lat - b.lat;
  const dLon = (a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

/**
 * Elige cuál de los territorios del agente se nombra: el más cercano al
 * punto subsatelital actual. Si no hay posición satelital, elige al azar.
 */
export function elegirTerritorio(regiones, agenteId, puntoSat) {
  const suyos = regiones.filter((r) => r.agente === agenteId);
  if (!suyos.length) return null;
  if (suyos.length === 1) return suyos[0];
  if (!puntoSat || puntoSat.lat == null) {
    return suyos[Math.floor(Math.random() * suyos.length)];
  }
  let mejor = null, mejorD = Infinity;
  for (const r of suyos) {
    const d = distanciaAprox(puntoSat, centroBbox(r.bbox));
    if (d < mejorD) { mejorD = d; mejor = r; }
  }
  return mejor;
}

/**
 * Motor de rumbo con histéresis.
 *
 * POR QUÉ HISTÉRESIS: cuando el punto subsatelital se mueve cerca del límite
 * entre dos cuadrantes (por ejemplo 44° / 46°), el cardinal saltaría entre
 * 'norte' y 'este' varias veces seguidas y el estado parpadearía. La
 * histéresis exige que el nuevo cardinal se sostenga N manifiestos antes de
 * confirmarse; si no, se conserva el anterior.
 *
 * @param {number} sostenerLecturas cuántas lecturas seguidas debe repetirse
 *   un cardinal nuevo antes de aceptarlo. 1 = sin histéresis.
 */
export function crearMotorRumbo({ sostenerLecturas = 1, elevacionCielos = ELEVACION_CIELOS } = {}) {
  // La histéresis se lleva POR AGENTE, no global. Antes era global y arrastraba
  // el cardinal de un agente al siguiente: como cada manifiesto es de otro
  // agente con su propio territorio, ese cambio es legítimo y debe ser
  // inmediato. Con sostenerLecturas=1 (por defecto) no hay retención: en una
  // sesión de 5 manifiestos cada agente habla una vez y no hay parpadeo posible.
  // Súbelo a 2 solo si MANIFIESTOS_POR_SESION > 5 y los agentes se repiten:
  // ahí sí evita que el satélite oscile entre los dos territorios del agente.
  const memoria = new Map(); // agenteId -> { confirmado, candidato, repeticiones }

  /**
   * @param {object} p
   * @param {object} p.agente        objeto del agente (necesita .rumbo)
   * @param {object} p.territorio    región elegida (necesita .bbox y .nombre)
   * @param {number} p.elevacionDeg  elevación del satélite sobre Lima
   * @returns {{estado:'AUTORIZADO'|'DESPLAZADO', cardinal:string, azimut:number,
   *            rumboAgente:string, cambio:boolean, rumbo_texto:string}}
   */
  return function actualizar({ agente, territorio, elevacionDeg }) {
    const centro = centroBbox(territorio.bbox);
    const azimut = rumboEntre(CENTRO, centro);
    const cardinalCrudo = azimutACardinal(azimut);

    // --- histéresis, aislada por agente ---
    const m = memoria.get(agente.id) ?? { confirmado: null, candidato: null, repeticiones: 0 };
    if (cardinalCrudo === m.candidato) m.repeticiones++;
    else { m.candidato = cardinalCrudo; m.repeticiones = 1; }

    let cambio = false;
    if (m.confirmado === null) { m.confirmado = cardinalCrudo; cambio = true; }
    else if (m.candidato !== m.confirmado && m.repeticiones >= sostenerLecturas) {
      m.confirmado = m.candidato; cambio = true;
    }
    memoria.set(agente.id, m);
    const cardinalConfirmado = m.confirmado;

    // --- AUTORIZADO / DESPLAZADO ---
    let estado;
    if (agente.rumbo === 'cielos') {
      // Caso especial: no le pertenece ningún cardinal. Está autorizado solo
      // cuando el satélite está realmente encima de la sala.
      estado = (elevacionDeg ?? -90) >= elevacionCielos ? 'AUTORIZADO' : 'DESPLAZADO';
    } else {
      estado = cardinalPertenece(cardinalConfirmado, agente.rumbo) ? 'AUTORIZADO' : 'DESPLAZADO';
    }

    return {
      estado,
      cardinal: cardinalConfirmado,
      azimut: Math.round(azimut),
      rumboAgente: agente.rumbo,
      cambio,
      // La línea lista para el Bloque 3, geográficamente verdadera:
      // (1) PROTOUSUARIO: rumbo FIJO del agente, siempre el mismo.
      rumbo_texto: lineaProtousuario(agente.rumbo),
      // (2) El territorio: rosa de 8 puntos + grados, respecto al observador.
      territorio_texto: lineaTerritorio(cardinalConfirmado, azimut),
      // (3) La marca de estado, tal como Julio la escribe en escena.
      estado_marca: estado === 'AUTORIZADO' ? '★ AUTORIZADO' : '✖ DESPLAZADO',
    };
  };
}

/** Bloque de texto para el prompt de Gemini. */
export function bloqueRumbo({ estado, rumbo_texto, territorio_texto, estado_marca, territorio, rumboAgente, cardinal }) {
  const cuerpo = estado === 'AUTORIZADO'
    ? `Estás AUTORIZADO: ${territorio.nombre} cae en tu propio rumbo (${rumboAgente}). Hablás desde tu casa, con voz plena y autoridad sobre lo que nombrás. No pidas permiso a nadie.`
    : `Estás DESPLAZADO: ${territorio.nombre} queda al ${cardinal}, y tu rumbo es el ${rumboAgente}. Te toca hablar de un territorio que no es tuyo. Hablás prestado, fuera de lugar, sin derecho de entrada. Que se note esa falta de pertenencia sin que la expliques.`;
  return `
RUMBO Y PERTENENCIA (dos enunciados distintos, no los confundas):
1. UBICACIÓN DEL TERRITORIO — al nombrar ${territorio.nombre} por primera vez, situalo así, tal cual: "${territorio_texto}".
2. RUMBO DE PROTOUSUARIO — incluí esta frase exacta, sin variarla nunca: "${rumbo_texto}", acompañada de su estado: "${estado_marca}".
   Ese rumbo es FIJO: pertenece al agente, no al territorio. Jamás escribas "PROTOUSUARIO desde el noreste/sureste/suroeste/noroeste": esas direcciones solo ubican territorios.
- ${cuerpo}
- Las dos frases van en el primer segmento 'orbital'. Podés retomarlas después en 'memoria' o 'prompt' si la escena lo pide.`;
}
