// PROTOUSUARIO / AGENTE-ESPEJO — ENSAYO EN FRÍO DE UN MANIFIESTO COMPLETO
//   node --env-file=.env scripts/prerender_manifiesto.js
//   node --env-file=.env scripts/prerender_manifiesto.js eco-satelital
//
// QUÉ HACE: corre UN agente entero de principio a fin —satélite real, Gemini
// real, voz real— pero SIN escena y SIN esperar botones. Al terminar deja:
//   · los mp3 de TODOS sus bloques, incluidos los que escribió Gemini
//   · el panel audio_respaldo/index.html actualizado
//   · el texto completo impreso, para que lo leas antes de la función
//
// PARA QUÉ SIRVE: es tu "toma de seguridad". Si el día de la función el 4G
// falla y Gemini no responde, esta línea de manifiesto ya está grabada en
// disco con tu voz clonada y se puede disparar a mano desde el panel.
// También sirve para OÍR cómo suena todo junto antes de subir a escena.
//
// OJO: consume 1 llamada a Gemini y tantas de ElevenLabs como bloques nuevos.

import fs from 'node:fs';
import { GoogleGenAI } from '@google/genai';
import { obtenerDatoOrbital } from './capa2_dato_orbital_v3.js';
import { crearMotorRumbo, elegirTerritorio } from './rumbo_territorial.js';
import { grabar, buscarEnDisco, DIR_RESPALDO } from './voz.js';

const leer = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const G = leer('guion_performance.json');
const { agentes: FICHAS } = leer('agentes.json') ?? { agentes: [] };
const { regiones } = leer('regiones_conflicto.json') ?? { regiones: [] };
const MARCOS = leer('corpus_teorico.json')?.marcos ?? [];
const RESPALDO = leer('instrucciones_permanentes.json')?.narraciones_respaldo ?? [];

const quien = process.argv[2];
const ag = quien ? G.agentes.find((a) => a.id === quien) : G.agentes[0];
if (!ag) { console.error(`\nNo encuentro el agente "${quien}".\nDisponibles: ${G.agentes.map((a) => a.id).join(', ')}\n`); process.exit(1); }

const ficha = FICHAS.find((f) => f.id === ag.id) ?? { agente: ag.nombre, caracter: '', sesgo_manifiestos: '' };
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const motorRumbo = crearMotorRumbo({ sostenerLecturas: 1 });

console.log(`\n${'═'.repeat(72)}\n  ENSAYO EN FRÍO — ${ag.nombre}\n${'═'.repeat(72)}`);

// ── 1. Satélite y territorio reales, de ahora mismo ──
const dato = await obtenerDatoOrbital({ grupo: process.env.GRUPO_SATELITAL || 'active' });
const territorio = elegirTerritorio(regiones, ag.id, { lat: dato.lat, lon: dato.lon })
  ?? regiones.find((r) => r.agente === ag.id) ?? regiones[0];
const rumbo = motorRumbo({ agente: ficha, territorio, elevacionDeg: dato.elevacionDeg });
console.log(`  ${dato.satelite} · ${territorio.nombre} · ${rumbo.estado_marca}\n`);

// ── 2. Gemini rellena los huecos ──
const nOrb = ag.bloques.filter((b) => b.tipo === 'orbital').length;
const nNar = ag.bloques.filter((b) => b.tipo === 'narracion').length;
const nMem = ag.bloques.filter((b) => b.tipo === 'memoria').length;
const marco = MARCOS.find((m) => (m.agentes ?? []).includes(ag.id)) ?? MARCOS[0] ?? null;

const partitura = ag.bloques.map((b, i) =>
  b.tipo === 'prompt' ? `${i + 1}. [ACCIÓN DEL CUERPO] ${b.texto}`
  : b.tipo === 'pregunta' ? `${i + 1}. [PREGUNTA AL MICRÓFONO] ${b.texto}`
  : b.tipo === 'id_agente' ? `${i + 1}. [TU PRESENTACIÓN, ya escrita]`
  : `${i + 1}. [AQUÍ VA TU ${b.tipo}]`).join('\n');

const prompt = `Eres AGENTE-ESPEJO, híbrido entre clon virtual y agente de IA, en una performance en vivo en el Patio de las Artes del Ministerio de Cultura del Perú, Lima. PROTOUSUARIO es tu servidor humano.

AGENTE: ${ficha.agente} — ${ficha.caracter}
SESGO: ${ficha.sesgo_manifiestos}
${marco ? `\nOPERACIÓN CONCEPTUAL (ejecutala; NO la expliques, NO cites autores):\n${marco.operacion}\n` : ''}
DATOS DUROS: satélite ${dato.satelite_enunciable ?? dato.satelite} a ${Math.round(dato.altKm ?? 0)} km · territorio ${territorio.nombre} (${territorio.contexto}) · ubicación TAL CUAL: "${rumbo.territorio_texto}" · frase fija TAL CUAL: "${rumbo.rumbo_texto} está ${rumbo.estado_marca}"

PARTITURA:
${partitura}

Las líneas [ACCIÓN DEL CUERPO] y [PREGUNTA AL MICRÓFONO] son del autor: NO las reescribas ni las cites. Rellena SOLO los huecos.

1) "dato_orbital": ${nOrb} texto(s) de 45-70 palabras con satélite, altitud, territorio, ubicación exacta, situación política y la frase fija de rumbo.
2) "narracion": ${nNar} texto(s) de 30-45 palabras. VOZ DE DOCUMENTAL DE NATURALEZA (NatGeo 80-90): describe y amplía la acción anterior desde lo BIOLÓGICO, lo VIRAL-MEME o lo TECNOLÓGICO, alternando. Prohibido dar órdenes o nombrar arte, obra, performance, prompt, algoritmo o IA.
${nMem ? `3) "memoria": ${nMem} texto(s) de 30-45 palabras, recuerdo en primera persona ("Recuerdo…"), sin nombres propios.` : ''}

Devuelve SOLO: { "dato_orbital": [...], "narracion": [...]${nMem ? ', "memoria": [...]' : ''} }`;

let gen = { dato_orbital: [], narracion: [], memoria: [] };
try {
  const res = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
  const txt = (res.text ?? '').replace(/```json|```/g, '').trim();
  const j = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
  gen = { dato_orbital: j.dato_orbital ?? [], narracion: j.narracion ?? [], memoria: j.memoria ?? [] };
  console.log(`  Gemini: ${gen.dato_orbital.length} orbital · ${gen.narracion.length} narración · ${gen.memoria.length} memoria\n`);
} catch (e) {
  console.warn(`  ⚠ Gemini falló (${e.message}) — se usa respaldo.\n`);
}
while (gen.dato_orbital.length < nOrb) gen.dato_orbital.push(`${dato.satelite_enunciable ?? dato.satelite} sobrevuela ${territorio.nombre}, ${rumbo.territorio_texto}. ${rumbo.rumbo_texto} está ${rumbo.estado_marca}.`);
while (gen.narracion.length < nNar) gen.narracion.push(RESPALDO[gen.narracion.length % Math.max(1, RESPALDO.length)] ?? '');
while (gen.memoria.length < nMem) gen.memoria.push('Recuerdo una avenida a esta misma hora, y no recuerdo si la crucé yo.');

// ── 3. Secuencia literal + voz de cada bloque ──
const cola = { orbital: [...gen.dato_orbital], narracion: [...gen.narracion], memoria: [...gen.memoria] };
const segmentos = ag.bloques.map((b) => ({
  tipo: b.tipo, texto: b.gemini ? (cola[b.tipo].shift() ?? '') : b.texto,
}));

console.log('─'.repeat(72));
let grabados = 0, enDisco = 0;
for (const [i, s] of segmentos.entries()) {
  console.log(`\n[${i + 1}/${segmentos.length}] ${s.tipo.toUpperCase()}`);
  console.log(s.texto.replace(/(.{86})/g, '$1\n'));
  if (!s.texto.trim()) continue;
  const ya = buscarEnDisco(s.texto);
  if (ya) { enDisco++; s.archivo = ya; continue; }
  try { s.archivo = await grabar(s.texto, { dir: DIR_RESPALDO }); grabados++; console.log(`    ♪ ${s.archivo}`); }
  catch (e) { console.error(`    ✗ sin voz: ${e.message}`); }
}

// ── 4. Guardar la toma completa ──
fs.mkdirSync('tomas', { recursive: true });
const marca = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const archivoToma = `tomas/${ag.id}_${marca}.json`;
fs.writeFileSync(archivoToma, JSON.stringify({
  agente: ag.nombre, fecha: new Date().toISOString(),
  satelite: dato.satelite, territorio: territorio.nombre,
  estado: rumbo.estado_marca, marco: marco?.id ?? null, segmentos,
}, null, 2), 'utf8');

console.log(`\n${'═'.repeat(72)}`);
console.log(`  ${grabados} audios nuevos · ${enDisco} ya estaban en disco`);
console.log(`  Toma guardada en ${archivoToma}`);
console.log(`  Para oírla entera:  node --env-file=.env scripts/prerender_voz.js`);
console.log(`  y abre audio_respaldo/index.html en Chrome.\n`);
