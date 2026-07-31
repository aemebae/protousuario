// PROTOUSUARIO / AGENTE-ESPEJO — cómo esto se engancha con lo que ya tienes
//
// Jerarquía de qué se resetea con desde_cero y qué NO (coherente con tu diseño de Paper 2/3):
//
//   voice_card.json              → NUNCA se resetea (solo cambia si vuelves a correr 03b y editas a mano)
//   fewshot_rotation_state.json  → por defecto NO se resetea (ver nota de diseño abajo)
//   memoria.json (desde_cero)    → SÍ se resetea (historial conversacional de la sesión)
//   episodios.jsonl              → NUNCA se resetea (archivo entre-performances, Paper 4 / Capa 3)

import fs from 'fs';
import { seleccionarEjemplos } from './03c_fewshot_selector.js';

const voiceCard = JSON.parse(fs.readFileSync('voice_card.json', 'utf8')); // solo lectura en runtime

async function construirSystemPrompt(registroActual, { semilla, resetearRotacion } = {}) {
  const ficha = voiceCard[registroActual];
  if (!ficha) throw new Error(`No hay ficha de voz para el registro "${registroActual}" — corre 03b_generate_voice_card.js`);
  if (ficha.estado !== 'FINAL') {
    console.warn(`⚠ La ficha de "${registroActual}" sigue en BORRADOR sin editar a mano.`);
  }

  const ejemplos = await seleccionarEjemplos(registroActual, {
    semilla,
    resetear: resetearRotacion, // true solo si necesitas repetibilidad exacta para una demo/documentación
  });

  return `Eres PROTOUSUARIO, un híbrido entre clon virtual y agente-espejo de intelegencia artificial con una voz construida a partir de los textos reales de juliourbina.

FICHA DE VOZ (${registroActual}):
${ficha.ficha_final ?? ficha[`version_${ficha.elegida}`]}

REGISTRO ACTUAL: ${registroActual}
Escribe SIEMPRE en ese registro. No mezcles con otros registros salvo que el motor afectivo
o la capa transespecie lo indiquen explícitamente.

EJEMPLOS REALES (guía de tono, no los cites literalmente):
${ejemplos.map((e, i) => `${i + 1}. ${e}`).join('\n')}`;
}

export { construirSystemPrompt };

// -----------------------------------------------------------------------------------
// NOTA DE DISEÑO — decisión abierta para vos, Mowgli:
//
// ¿La rotación de few-shot debería resetearse con desde_cero:true o no?
//
//   (A) SÍ resetear junto con desde_cero
//       → Cada performance con desde_cero:true arranca con la MISMA primera mano de
//         ejemplos. Máxima repetibilidad para documentación/comparación entre fechas.
//
//   (B) NO resetear (comportamiento por defecto de este script)
//       → El mazo de ejemplos sigue rotando de una performance a la siguiente aunque
//         resetees la memoria conversacional. Cada función es ligeramente distinta
//         aunque el "estado base" (ficha + stats) sea idéntico — coherente con la idea
//         de "organismo vivo" y "espejo imperfecto" que atraviesa el Paper 4: el clon
//         nunca es una copia exacta, ni siquiera de sí mismo.
//
// Recomendación: (B) por defecto, con la opción resetearRotacion:true disponible para
// cuando necesites reproducibilidad puntual (por ejemplo, para grabar material de
// documentación o comparar dos performances bajo condiciones idénticas).
// -----------------------------------------------------------------------------------