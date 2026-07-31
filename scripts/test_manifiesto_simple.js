// PROTOUSUARIO / AGENTE-ESPEJO — prueba MÍNIMA de manifiesto (cero instalaciones)
//
// No toca la Capa 2 (satélite) en absoluto, así que NO necesita satellite.js.
// Sirve para ensayar la generación de manifiestos AHORA, mientras dejás la instalación
// de satellite.js para cuando armemos la Capa 2 de verdad.
//
// El modo afectivo se simula a mano con la variable ESTADO_SIMULADO de abajo.
//
// Corre con:  node --env-file=.env scripts/test_manifiesto_simple.js

import { GoogleGenAI } from '@google/genai';
import { construirSystemPrompt } from './integracion_system_prompt.js';
import { recuperarPorRecenciaYTags, sembrarProtoEpisodios } from './capa3_memoria_episodica.js';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error(
    '\n❌ Falta GEMINI_API_KEY. Corre con:  node --env-file=.env scripts/test_manifiesto_simple.js\n'
  );
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey });

// --- Modo afectivo SIMULADO a mano (sin satélites) ---
// Cambiá esta línea a 'TERNURA' para probar el otro registro/tono.
const ESTADO_SIMULADO = 'AUTORITARIO';

const DESCRIPTORES = {
  AUTORITARIO: { tono: 'firme, frío, sentencioso', registro: 'institucional' },
  TERNURA: { tono: 'tierno, incierto, vulnerable', registro: 'intimo' },
};

async function probar() {
  const descriptor = DESCRIPTORES[ESTADO_SIMULADO];
  const registro = ESTADO_SIMULADO === 'TERNURA' ? 'informal_intimo' : 'analitico';

  // Capa 3 (memoria episódica) — segura, solo usa fs, no necesita satellite.js
  try { sembrarProtoEpisodios(); } catch {}
  const episodiosRelevantes = recuperarPorRecenciaYTags(['rio', 'transespecie'], 1);
  const citaPasado = episodiosRelevantes[0]?.resumen ?? null;

  // Paper 3: ficha de voz destilada + few-shot rotativo
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

probar().catch(console.error);
