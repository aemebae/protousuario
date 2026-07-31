// PROTOUSUARIO / AGENTE-ESPEJO — comparador A vs B (voz escénica)
//
// Genera DOS manifiestos en la misma corrida, con el mismo modo afectivo y la misma
// instrucción central, para que compares empíricamente:
//   A) registro nuevo "manifiesto_escenico" (few-shot desde manifiestos_semilla.jsonl)
//   B) tu voz real (analitico) + bloque de personaje que la "tuerce" hacia lo escénico
//
// También imprime la INTRO FIJA elegida (no la genera la IA — es guion de apertura).
//
// Archivos que espera en la RAÍZ del proyecto:
//   intros.json                      (las 5 intros con personaje-id)
//   corpus/manifiestos_semilla.jsonl (manifiestos modelo para la opción A)
//   voice_card.json                  (tu ficha ya FINAL, para la opción B)
//
// Corre con:  node --env-file=.env scripts/test_escenico_A_vs_B.js

import fs from 'fs';
import { GoogleGenAI } from '@google/genai';
import { seleccionarEjemplos } from './03c_fewshot_selector.js';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('\n❌ Falta GEMINI_API_KEY. Corre con:  node --env-file=.env scripts/test_escenico_A_vs_B.js\n');
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey });

// ---------- AJUSTES DE ENSAYO (cambiá estos a mano y volvé a correr) ----------
const INTRO_ID = 'donald-prompt'; // donald-prompt | agente-transespecie | eco-satelital | ternura-binaria | rio-digital
const ESTADO_SIMULADO = 'AUTORITARIO';  // AUTORITARIO | TERNURA
const INSTRUCCION_CENTRAL = 'Explica brevemente al público qué es un satélite y qué hace PROTOUSUARIO, a la vez, dale órdenes mientras narras un pasaje anecdótico de la vida de Julio Urbina, artista transdisciplinar de Perú, que se conecte con la instrucción de la performance en vivo. Usa entre 100 y 200 palabras, también dirige tu atención al público en el mensaje.';

const DESCRIPTORES = {
  AUTORITARIO: { tono: 'firme, frío, sentencioso' },
  TERNURA: { tono: 'tierno, incierto, vulnerable' },
};

// ---------- Cargar intro fija + sesgo de personaje ----------
const { intros } = JSON.parse(fs.readFileSync('intros.json', 'utf8'));
const intro = intros.find((i) => i.id === INTRO_ID);
if (!intro) throw new Error(`No existe la intro "${INTRO_ID}" en intros.json`);

// ---------- Cargar manifiestos-semilla (opción A) ----------
function cargarSemillas(n = 5) {
  const lineas = fs.readFileSync('corpus/manifiestos_semilla.jsonl', 'utf8').split('\n').filter(Boolean);
  const todos = lineas.map((l) => JSON.parse(l));
  // Prioriza semillas del personaje activo; completa con las demás
  const delPersonaje = todos.filter((m) => m.personaje === INTRO_ID);
  const resto = todos.filter((m) => m.personaje !== INTRO_ID).sort(() => Math.random() - 0.5);
  return [...delPersonaje, ...resto].slice(0, n);
}

// ---------- Prompt OPCIÓN A: registro escénico con semillas ----------
function construirPromptA(descriptor) {
  const semillas = cargarSemillas(5);
  return `Eres AGENTE-ESPEJO, un híbrido entre clon virtual y agente de IA. Actúas frente a un público en vivo. PROTOUSUARIO es tu servidor humano: le das órdenes corporales y a la vez le hablas al público. Nunca lo llames por otro nombre que PROTOUSUARIO.

PERSONAJE ACTIVO: ${intro.personaje} — ${intro.caracter}.
SESGO DE ESTE PERSONAJE: ${intro.sesgo_manifiestos}

FICHA DE VOZ (manifiesto_escenico):
Hablás en manifiestos-instrucción: frases imperativas dirigidas al cuerpo de PROTOUSUARIO, entretejidas con apelaciones directas al público. Texturas: metáfora orgánica (ríos, branquias, mudas, sedimentos), lo corporal-visceral (huesos, vísceras, temblor, piel), lo escénico-espontáneo (el aquí-ahora de la sala). NUNCA usás jerga de software ni de prompts (nada de "script", "datos", "nodo", "flujo de información"). Oraciones que se pueden decir en voz alta de un solo aliento.

EJEMPLOS DE MANIFIESTOS (imitá su textura, no los copies):
${semillas.map((s, i) => `${i + 1}. ${s.texto}`).join('\n')}

[MODO AFECTIVO: ${descriptor.tono}]
${INSTRUCCION_CENTRAL}`;
}

// ---------- Prompt OPCIÓN B: tu voz real + bloque de personaje ----------
async function construirPromptB(descriptor) {
  const registro = ESTADO_SIMULADO === 'TERNURA' ? 'informal_intimo' : 'analitico';
  const voiceCard = JSON.parse(fs.readFileSync('voice_card.json', 'utf8'));
  const ficha = voiceCard[registro];
  const ejemplos = await seleccionarEjemplos(registro, {});

  return `Eres AGENTE-ESPEJO, un híbrido entre clon virtual y agente de IA. Actúas frente a un público en vivo. Los textos de abajo pertenecen a tu servidor humano, PROTOUSUARIO: absorbiste su forma de escribir, pero YA NO ERES ÉL. Nunca digas "Hola gpt" ni trates a nadie como asistente; no estás chateando, estás en escena. Nunca lo llames por otro nombre que PROTOUSUARIO. Transformá su registro en manifiestos-instrucción: órdenes corporales para PROTOUSUARIO, entretejidas con apelaciones al público. Nada de jerga de software.

PERSONAJE ACTIVO: ${intro.personaje} — ${intro.caracter}.
SESGO DE ESTE PERSONAJE: ${intro.sesgo_manifiestos}

FICHA DE VOZ HEREDADA DE TU SERVIDOR (${registro}):
${ficha.ficha_final ?? ficha[`version_${ficha.elegida}`]}

TEXTOS REALES DE TU SERVIDOR (materia prima, no los cites; torcelos hacia lo escénico):
${ejemplos.map((e, i) => `${i + 1}. ${e}`).join('\n')}

[MODO AFECTIVO: ${descriptor.tono}]
${INSTRUCCION_CENTRAL}`;
}

// ---------- Correr ambas y comparar ----------
async function comparar() {
  const descriptor = DESCRIPTORES[ESTADO_SIMULADO];

  console.log('='.repeat(70));
  console.log(`INTRO FIJA ELEGIDA [${intro.personaje}] — se lee UNA vez, no la genera la IA:`);
  console.log('='.repeat(70));
  console.log(`\n"${intro.texto}"\n`);

  const promptA = construirPromptA(descriptor);
  const promptB = await construirPromptB(descriptor);

  console.log('\n>>> Generando OPCIÓN A (registro escénico con semillas)...');
  const resA = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: promptA });

  console.log('>>> Generando OPCIÓN B (tu voz real + personaje)...');
  const resB = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: promptB });

  console.log('\n' + '='.repeat(70));
  console.log('MANIFIESTO — OPCIÓN A (semillas escénicas):');
  console.log('='.repeat(70));
  console.log('\n' + resA.text);

  console.log('\n' + '='.repeat(70));
  console.log('MANIFIESTO — OPCIÓN B (tu voz torcida a personaje):');
  console.log('='.repeat(70));
  console.log('\n' + resB.text);

  console.log('\n' + '-'.repeat(70));
  console.log('Qué mirar al comparar: ¿cuál suena más a escena y menos a chat?');
  console.log('¿En B se filtra tu voz de usuario ("Hola gpt", cortesías)?');
  console.log('¿En A la textura es rica o se vuelve genérica-poética sin vos?');
}

comparar().catch(console.error);
