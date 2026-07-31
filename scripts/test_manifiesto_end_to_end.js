// PROTOUSUARIO / AGENTE-ESPEJO — prueba end-to-end
// Une motor afectivo (Capa 2) + memoria episódica (Capa 3) + ficha de voz/few-shot (Paper 3)
// y llama a Gemini una vez, para que veas un prompt-manifiesto real de punta a punta.
//
// Funciona AUNQUE todavía no tengas TLEs descargados (simula proximidad=false)
// y AUNQUE voice_card.json siga en estado BORRADOR (solo te avisa, no bloquea).

import { GoogleGenAI } from '@google/genai';
import { cargarTLEs, hayProximidad, MotorAfectivo } from './capa2_motor_satelital.js';
import { recuperarPorRecenciaYTags, sembrarProtoEpisodios } from './capa3_memoria_episodica.js';
import { construirSystemPrompt } from './integracion_system_prompt.js';

// Misma autenticación robusta que en 03b: clave explícita + guard claro.
// Corre con:  node --env-file=.env test_manifiesto_end_to_end.js
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error(
    '\n❌ Falta GEMINI_API_KEY. Corre con:  node --env-file=.env test_manifiesto_end_to_end.js\n' +
    '   y confirma que tu .env tiene:  GEMINI_API_KEY=tu_clave\n'
  );
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey });

async function ensamblarYProbar() {
  sembrarProtoEpisodios(); // no-op si episodios.jsonl ya existe

  // --- Capa 2 ---
  let proximidadInfo;
  try {
    const sats = cargarTLEs('tles/starlink.tle');
    proximidadInfo = hayProximidad(sats);
  } catch {
    console.warn('⚠ No hay TLEs descargados todavía (tles/starlink.tle) — simulando proximidad=false.');
    proximidadInfo = { proximidad: false };
  }
  const motor = new MotorAfectivo();
  const estado = motor.actualizar(proximidadInfo.proximidad);
  const descriptor = motor.descriptorPrompt();

  // --- Capa 3 ---
  const episodiosRelevantes = recuperarPorRecenciaYTags(['rio', 'transespecie'], 1);
  const citaPasado = episodiosRelevantes[0]?.resumen ?? null;

  // --- Paper 3: ficha de voz + few-shot ---
  // Registros reales de tu voice_card.json: 'analitico' e 'informal_intimo'.
  const registro = estado === 'TERNURA' ? 'informal_intimo' : 'analitico';
  const systemPrompt = await construirSystemPrompt(registro);

  const promptCentral = 'Da una instrucción corporal para el performer, de no más de 2 frases.';
  const promptFinal = `${systemPrompt}

[MODO AFECTIVO: ${descriptor.tono}] [REGISTRO: ${descriptor.registro}]
${citaPasado ? `[ECO DE OBRA PASADA: ${citaPasado}]` : ''}
INSTRUCCIÓN CENTRAL PARA EL PERFORMER: ${promptCentral}`;

  console.log('\n--- PROMPT FINAL ENVIADO A GEMINI ---\n');
  console.log(promptFinal);

  const res = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: promptFinal });

  console.log('\n--- MANIFIESTO GENERADO ---\n');
  console.log(res.text);
}

ensamblarYProbar().catch(console.error);