// PROTOUSUARIO / AGENTE-ESPEJO — prueba visual de la escena compuesta
// Simula una sesión completa SIN llamar a Gemini (cero gasto de cuota).
// Corre con:  node scripts\probar_escena.mjs
// Requiere servidor_visual.js corriendo en otra terminal.

import { emitirAfecto, emitirRumbo, emitirSegmento, emitirSatelite } from './emitir_evento.js';

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const sesion = [
  { agente: 'Donald-Prompt', estado: 'PANOPTICO', cardinal: 'noroeste', azimut: 325, rumboAgente: 'norte',
    lat: 29.5, lon: -104.0, nombre: 'la frontera México-Estados Unidos',
    segmentos: [
      ['orbital', 'Desde 400 km, el ISS sobrevuela la frontera México-Estados Unidos, al noroeste (325°). PROTOUSUARIO desde el norte. ★ AUTORIZADO.'],
      ['prompt', 'PROTOUSUARIO se pone de pie, marcial.'],
      ['reflexion', 'El cuerpo obedece antes de que la orden termine de decirse.'],
      ['memoria', 'Recuerdo haber clasificado algo que no pidió ser clasificado.'],
      ['prompt', 'Levanta el brazo derecho, como un saludo que no es un saludo.'],
    ] },
  { agente: 'Ternura-Binaria', estado: 'LIMINAL', cardinal: 'sureste', azimut: 145, rumboAgente: 'este',
    lat: -23.0, lon: -68.75, nombre: 'el desierto de Atacama',
    segmentos: [
      ['orbital', 'El satélite pasa sobre el desierto de Atacama, al sureste (145°). PROTOUSUARIO desde el este. ★ AUTORIZADO.'],
      ['prompt', 'PROTOUSUARIO se arrodilla despacio.'],
      ['reflexion', 'El agua que falta aquí es la misma que carga tu batería.'],
    ] },
  { agente: 'Río-Digital', estado: 'CORRIENTE', cardinal: 'noreste', azimut: 31, rumboAgente: 'oeste',
    lat: -7.0, lon: -74.0, nombre: 'la Amazonía peruana',
    segmentos: [
      ['orbital', 'Sobrevuela la Amazonía peruana, al noreste (31°). PROTOUSUARIO desde el oeste. ✖ DESPLAZADO.'],
      ['prompt', 'PROTOUSUARIO camina en círculos, como un río sin cauce.'],
      ['reflexion', 'Hablo de un verde que nunca llegó a mi orilla.'],
    ] },
  { agente: 'Eco-Satelital', estado: 'ORBITAL', cardinal: 'noroeste', azimut: 334, rumboAgente: 'cielos',
    lat: -11.57, lon: -77.27, nombre: 'el megapuerto de Chancay',
    segmentos: [
      ['orbital', 'A 78° de elevación, el satélite pasa CENITAL sobre el megapuerto de Chancay. PROTOUSUARIO desde los cielos. ★ AUTORIZADO.'],
      ['prompt', 'PROTOUSUARIO extiende ambos brazos, un radar humano.'],
      ['reflexion', 'Gira lento: barre, no juzga, solo registra.'],
    ] },
  { agente: 'Quimera-Transespecie', estado: 'POLIFONICO', cardinal: 'sureste', azimut: 122, rumboAgente: 'sur',
    lat: -15.0, lon: -72.0, nombre: 'el sur andino del Perú (Ayacucho–Puno)',
    segmentos: [
      ['orbital', 'Transita sobre el sur andino, al sureste (122°). PROTOUSUARIO desde el sur. ★ AUTORIZADO.'],
      ['prompt', 'PROTOUSUARIO se tumba boca arriba, piernas al aire.'],
      ['reflexion', 'Aquí no hay una sola voz: son todas a la vez, sin mezclarse.'],
    ] },
];

console.log('=== Simulando sesión completa en http://localhost:3000 ===\n');

for (const m of sesion) {
  console.log(`▸ ${m.agente} (${m.estado})`);
  await emitirAfecto(m.estado);
  await emitirSatelite({
    satelite: 'ISS (ZARYA)', satelite_enunciable: 'ISS (ZARYA)',
    lat: m.lat, lon: m.lon, altKm: 420, elevacionDeg: 60, rangeKm: 500,
    pais: m.nombre, pais_tipo: 'pais', modo_datos: 'ONLINE_COMPLETO',
    todos: [{ nombre: 'ISS (ZARYA)', lat: m.lat, lon: m.lon, altKm: 420 }],
  });
  await emitirRumbo({ estado: m.cardinal === m.rumboAgente || ['noroeste','sureste'].includes(m.cardinal) ? 'AUTORIZADO' : (m.segmentos[0][1].includes('★') ? 'AUTORIZADO' : 'DESPLAZADO'),
    cardinal: m.cardinal, azimut: m.azimut, rumboAgente: m.rumboAgente });
  for (const [tipo, texto] of m.segmentos) {
    await emitirSegmento(tipo, texto);
    await espera(1800);   // deja ver la máquina de escribir en pantalla
  }
  await espera(1200);
}

console.log('\n✓ Sesión de prueba terminada. Revisa http://localhost:3000');
