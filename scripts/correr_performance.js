// ═══════════════════════════════════════════════════════════════════════
//  PROTOUSUARIO / AGENTE-ESPEJO — ORQUESTADOR DE FUNCIÓN
//  node --env-file=.env scripts/correr_performance.js
//
//  RECORRE guion_performance.json DE ARRIBA A ABAJO, EN ORDEN LITERAL.
//  Nada se sortea. Tus prompts y preguntas se imprimen tal cual. Gemini solo
//  rellena los huecos marcados "gemini": true (orbital, narracion, memoria).
//
//  ANTES DE CADA AGENTE hace UNA sola llamada a Gemini que devuelve todas
//  sus piezas de golpe. Si esa llamada falla, entra el respaldo local y la
//  función SIGUE: tus textos son tuyos y están en disco.
//
//  Cada bloque espera un AVANZAR del celular (o ENTER en la terminal).
//  PAUSA congela. SALTAR AGENTE salta al siguiente. DERIVA entra al final.
// ═══════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { GoogleGenAI } from '@google/genai';
import { obtenerDatoOrbital } from './capa2_dato_orbital_v3.js';
import { crearMotorRumbo, elegirTerritorio } from './rumbo_territorial.js';
import {
  emitirAgenteId, emitirSegmento, emitirSatelite, emitirRumbo,
  emitirAfecto, emitirSecuencia, emitirDeriva, emitirPausa,
} from './emitir_evento.js';

const URL_VISUAL = process.env.URL_VISUAL || 'http://localhost:3000';
const DERIVA_MS = Number(process.env.DERIVA_MS || 13000);
const rl = readline.createInterface({ input, output });

// ── Datos ──
const GUION = JSON.parse(fs.readFileSync('guion_performance.json', 'utf8'));
const { agentes: FICHAS } = JSON.parse(fs.readFileSync('agentes.json', 'utf8'));
const { regiones } = JSON.parse(fs.readFileSync('regiones_conflicto.json', 'utf8'));
let PREGUNTAS_DERIVA = [];
try { PREGUNTAS_DERIVA = JSON.parse(fs.readFileSync('preguntas_deriva.json', 'utf8')).preguntas ?? []; } catch {}
let RESPALDO = [];
try { RESPALDO = JSON.parse(fs.readFileSync('instrucciones_permanentes.json', 'utf8')).narraciones_respaldo ?? []; } catch {}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const motorRumbo = crearMotorRumbo({ sostenerLecturas: 1 });

// ── Señales de control ──
class Terminar extends Error {}
class Saltar extends Error {}
class Deriva extends Error {}

async function esperarCelular(señal) {
  while (!señal.aborted) {
    try {
      const r = await fetch(`${URL_VISUAL}/control/esperar`, { signal: señal });
      if (r.ok) { const j = await r.json(); if (j?.comando) return j.comando; }
    } catch { if (señal.aborted) return null; }
    await new Promise((r) => setTimeout(r, 1200));
  }
  return null;
}
async function informarControl(datos) {
  try {
    await fetch(`${URL_VISUAL}/control/estado`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos), signal: AbortSignal.timeout(1200) });
  } catch {}
}

let enPausa = false;
/** Espera un comando. PAUSA no devuelve: congela aquí hasta el siguiente. */
async function esperar(msg = '[ENTER o AVANZAR en el celular]') {
  const porTeclado = rl.question('\n' + msg + ' ').then(() => 'avanzar');
  while (true) {
    const ctrl = new AbortController();
    const cmd = (await Promise.race([porTeclado, esperarCelular(ctrl.signal)])) ?? 'avanzar';
    ctrl.abort();
    if (cmd === 'pausa') {
      enPausa = !enPausa;
      await emitirPausa(enPausa);
      console.log(enPausa ? '\n  ⏸  PAUSA' : '\n  ▶  reanudado');
      continue;
    }
    if (enPausa) { enPausa = false; await emitirPausa(false); }
    if (cmd === 'terminar') throw new Terminar();
    if (cmd === 'saltar_agente') throw new Saltar();
    if (cmd === 'deriva') throw new Deriva();
    return cmd;
  }
}

async function llamarGemini(prompt, maxIntentos = 3) {
  for (let i = 0; i < maxIntentos; i++) {
    try {
      const res = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
      const limpio = res.text.trim().replace(/^```json\s*|\s*```$/g, '');
      const m = limpio.match(/\{[\s\S]*\}/);
      return JSON.parse(m ? m[0] : limpio);
    } catch (e) {
      if (i === maxIntentos - 1) throw e;
      console.warn(`  reintento ${i + 1}/${maxIntentos} — ${e.message}`);
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  UNA SOLA LLAMADA POR AGENTE — devuelve todos sus huecos de golpe
// ═══════════════════════════════════════════════════════════════════════
function promptDeAgente({ ficha, bloques, dato, territorio, rumbo, nOrb, nNar, nMem }) {
  // Gemini ve TODA la partitura del agente para saber qué está narrando y en
  // qué momento entra cada pieza. Pero los actos son intocables.
  const partitura = bloques.map((b, i) => {
    if (b.tipo === 'prompt') return `${i + 1}. [ACCIÓN DEL CUERPO] ${b.texto}`;
    if (b.tipo === 'pregunta') return `${i + 1}. [PREGUNTA AL MICRÓFONO] ${b.texto}`;
    if (b.tipo === 'id_agente') return `${i + 1}. [TU PRESENTACIÓN, ya escrita]`;
    if (b.tipo === 'orbital') return `${i + 1}. [AQUÍ VA TU dato_orbital]`;
    if (b.tipo === 'narracion') return `${i + 1}. [AQUÍ VA TU narracion]`;
    if (b.tipo === 'memoria') return `${i + 1}. [AQUÍ VA TU memoria]`;
    return '';
  }).join('\n');

  return `Eres AGENTE-ESPEJO, híbrido entre clon virtual y agente de IA, en una performance en vivo en el Patio de las Artes del Ministerio de Cultura del Perú, en Lima. PROTOUSUARIO es tu servidor humano en escena; el público está presente, con máscaras de especies.

AGENTE ACTIVO: ${ficha.agente} — ${ficha.caracter}
SESGO: ${ficha.sesgo_manifiestos}

DATOS DUROS DE ESTE MOMENTO (no los contradigas):
- Satélite: ${dato.satelite_enunciable ?? dato.satelite}, a ${dato.altKm != null ? Math.round(dato.altKm) : '—'} km de altitud, sobrevolando ${dato.pais ?? 'aguas internacionales'}.
- Territorio: ${territorio.nombre}. Situación real: ${territorio.contexto}
- Ubicación, escríbela TAL CUAL: "${rumbo.territorio_texto}"
- Frase fija de rumbo, escríbela TAL CUAL: "${rumbo.rumbo_texto} está ${rumbo.estado_marca}"

PARTITURA COMPLETA DE ESTE AGENTE (el orden real de la escena):
${partitura}

REGLA ABSOLUTA: las líneas marcadas [ACCIÓN DEL CUERPO] y [PREGUNTA AL MICRÓFONO] las escribió el autor de la obra. NO las reescribas, NO las cites, NO las resumas, NO inventes acciones nuevas. Tu trabajo es rellenar SOLO los huecos.

ESCRIBE:

1) "dato_orbital": ${nOrb} texto(s) de 45-70 palabras. Contiene el satélite, su altitud, el territorio con su ubicación exacta, la situación política concreta, y la frase fija de rumbo con su marca de estado.${nOrb > 1 ? ' El segundo NO repite ninguna imagen ni adjetivo del primero.' : ''}

2) "narracion": ${nNar} texto(s) de 30-45 palabras cada uno, UN párrafo de 2 líneas. VOZ DEL NARRADOR DE DOCUMENTAL DE NATURALEZA (National Geographic de los años 80-90): épica, grave, pausada, con la autoridad de quien explica una especie a la que no pertenece. Cada narración describe y amplía LA ACCIÓN QUE ACABA DE OCURRIR justo antes en la partitura, desde una de estas tres dimensiones, alternándolas:
   · BIOLÓGICA (organismo, especie, instinto, anatomía, parentesco)
   · VIRAL-MEME (el gesto que se replica por imitación sin comprensión)
   · TECNOLÓGICA (el dato, el sensor, la infraestructura que observa)
   PROHIBIDO: dar órdenes, usar imperativos, decir "debe" o "tiene que", dirigirse al público, y nombrar las palabras arte, obra, performance, prompt, algoritmo, inteligencia artificial, IA, o jerga de software. El narrador cree que documenta un hecho natural.
${nMem ? `
3) "memoria": ${nMem} texto(s) de 30-45 palabras. Recuerdo en PRIMERA PERSONA del agente ("Recuerdo…"), íntimo e incómodo, sin nombres propios, atado a Lima o al territorio nombrado.` : ''}

REGISTRO: narración mitológica, como quien ya conoce la odisea completa y solo relata el pasaje que toca. Ironía y humor negro conviven con la crítica seria. Frases que se digan en voz alta de un solo aliento. Al performer llamalo siempre PROTOUSUARIO. NUNCA nombres a Julio Urbina ni a Mowgli.

Devuelve SOLO este JSON:
{ "dato_orbital": [${Array(nOrb).fill('"..."').join(', ')}], "narracion": [${Array(nNar).fill('"..."').join(', ')}]${nMem ? `, "memoria": [${Array(nMem).fill('"..."').join(', ')}]` : ''} }`;
}

// ═══════════════════════════════════════════════════════════════════════
//  FUNCIÓN
// ═══════════════════════════════════════════════════════════════════════
const GRUPO = process.env.GRUPO_SATELITAL || 'active';
const rotulo = { orbital: 'DATO ORBITAL', prompt: 'PROMPT', narracion: '· narración NatGeo ·',
                 memoria: '· memoria episódica ·', pregunta: '◈ PREGUNTA', id_agente: 'ID AGENTE' };

async function funcion() {
  console.log('\n' + '='.repeat(72));
  console.log('  PROTOUSUARIO · Patio de las Artes · MINCUL, Lima');
  console.log(`  ${GUION.agentes.length} agentes · ${GUION.agentes.reduce((s, a) => s + a.bloques.length, 0)} bloques`);
  console.log('  AVANZAR = siguiente bloque · PAUSA congela · DERIVA = pasaje final');
  console.log('='.repeat(72));
  await esperar('[ENTER o AVANZAR para empezar]');

  for (const ag of GUION.agentes) {
    const ficha = FICHAS.find((f) => f.id === ag.id) ?? { agente: ag.nombre, caracter: '', sesgo_manifiestos: '' };
    try {
      console.log('\n' + '─'.repeat(72));
      console.log(`  ${ag.nombre.toUpperCase()}  (${ag.estado})`);
      console.log('─'.repeat(72));
      await emitirAfecto(ag.estado);

      // ── Dato satelital real de este instante ──
      const dato = await obtenerDatoOrbital({ grupo: GRUPO });
      await emitirSatelite(dato);
      const territorio = elegirTerritorio(regiones, ag.id, { lat: dato.lat, lon: dato.lon })
        ?? regiones.find((r) => r.agente === ag.id) ?? regiones[0];
      const rumbo = motorRumbo({ agente: ficha, territorio, elevacionDeg: dato.elevacionDeg });
      await emitirRumbo({ estado: rumbo.estado, cardinal: rumbo.cardinal,
                          azimut: rumbo.azimut, rumboAgente: rumbo.rumboAgente });
      console.log(`  ${dato.satelite} · ${territorio.nombre} · ${rumbo.estado_marca}`);

      // ── Una sola llamada a Gemini con todos los huecos ──
      const nOrb = ag.bloques.filter((b) => b.tipo === 'orbital').length;
      const nNar = ag.bloques.filter((b) => b.tipo === 'narracion').length;
      const nMem = ag.bloques.filter((b) => b.tipo === 'memoria').length;
      let gen = { dato_orbital: [], narracion: [], memoria: [] };
      if (nOrb + nNar + nMem > 0) {
        try {
          const r = await llamarGemini(promptDeAgente({ ficha, bloques: ag.bloques, dato, territorio, rumbo, nOrb, nNar, nMem }));
          gen = {
            dato_orbital: (r?.dato_orbital ?? []).filter(Boolean),
            narracion: (r?.narracion ?? []).filter(Boolean),
            memoria: (r?.memoria ?? []).filter(Boolean),
          };
          console.log(`  Gemini: ${gen.dato_orbital.length} orbital · ${gen.narracion.length} narración · ${gen.memoria.length} memoria`);
        } catch (e) {
          console.warn(`  ⚠ GEMINI CAÍDO (${e.message}) — respaldo local, la función sigue.`);
        }
      }
      // Respaldo: nunca queda un hueco vacío en escena.
      while (gen.dato_orbital.length < nOrb) {
        gen.dato_orbital.push(`${dato.satelite_enunciable ?? dato.satelite} sobrevuela ${territorio.nombre}, ${rumbo.territorio_texto}. ${rumbo.rumbo_texto} está ${rumbo.estado_marca}.`);
      }
      while (gen.narracion.length < nNar) {
        const t = RESPALDO[gen.narracion.length % Math.max(1, RESPALDO.length)] ?? '';
        gen.narracion.push(t.replaceAll('{TERRITORIO}', territorio.nombre)
                            .replaceAll('{SATELITE}', dato.satelite_enunciable ?? dato.satelite));
      }
      while (gen.memoria.length < nMem) gen.memoria.push('Recuerdo una avenida a esta misma hora, y no recuerdo si la crucé yo.');

      // ── Armar la secuencia LITERAL y mandarla al celular como respaldo ──
      const cola = { orbital: [...gen.dato_orbital], narracion: [...gen.narracion], memoria: [...gen.memoria] };
      const segmentos = ag.bloques.map((b) => ({
        tipo: b.tipo === 'id_agente' ? 'prompt' : b.tipo,
        texto: b.gemini ? (cola[b.tipo].shift() ?? '') : b.texto,
      }));
      await emitirSecuencia(segmentos, { agente: ag.nombre });
      await informarControl({ agente: ag.nombre, estado_marca: rumbo.estado_marca,
                              territorio: `${territorio.nombre} — ${rumbo.territorio_texto}` });

      // ── Recorrer la partitura, bloque a bloque ──
      for (let i = 0; i < ag.bloques.length; i++) {
        const b = ag.bloques[i];
        const texto = segmentos[i].texto;
        console.log(`\n  [${i + 1}/${ag.bloques.length}] ${rotulo[b.tipo]}`);
        console.log('  ' + texto.replace(/(.{88})/g, '$1\n  '));

        if (b.tipo === 'id_agente') await emitirAgenteId(ag.nombre, texto);
        else await emitirSegmento(b.tipo, texto, i);

        await informarControl({ agente: ag.nombre, progreso: `${i + 1}/${ag.bloques.length}` });
        const cmd = await esperar(`[${i + 1}/${ag.bloques.length}] AVANZAR`);
        if (cmd === 'repetir') i--;
      }
    } catch (e) {
      if (e instanceof Saltar) { console.log(`\n  ⏭  ${ag.nombre} saltado.`); continue; }
      throw e;
    }
  }
  throw new Deriva();   // al terminar la partitura, entra sola la deriva
}

// ═══════════════════════════════════════════════════════════════════════
//  DERIVA — el pasaje final
// ═══════════════════════════════════════════════════════════════════════
const barajar = (a) => [...a].sort(() => Math.random() - 0.5);

async function modoDeriva() {
  console.log('\n' + '◈'.repeat(72));
  console.log('  DERIVA — el cuerpo se retira, la voz continúa.');
  console.log('  TERMINAR en el celular o Ctrl+C para cerrar.');
  console.log('◈'.repeat(72));
  await emitirDeriva(true);
  await informarControl({ agente: 'DERIVA', progreso: 'PASAJE FINAL', estado_marca: '◈' });

  let extra = [];
  try {
    const r = await llamarGemini(`Eres AGENTE-ESPEJO. La performance terminó: PROTOUSUARIO se retiró en cuatro patas y se quitó todas las prótesis. El exoesqueleto quedó en el suelo, encendido, sin cuerpo adentro. Tu voz sigue sonando.

Escribe 12 PREGUNTAS. Solo preguntas, cada una empieza con "¿" y termina con "?". Una línea, 8-20 palabras, dicha al micrófono de un solo aliento. Filosóficas y políticas a la vez, concretas y materiales, con humor negro seco, desde el Sur global. Nunca académicas ni solemnes.

Estas son las del mismo autor, para calibrar el tono — NO las repitas ni parafrasees:
${PREGUNTAS_DERIVA.slice(0, 8).map((q) => '  ' + q).join('\n')}

PROHIBIDO responder, afirmar, dar instrucciones, despedirse o cerrar el sentido. Prohibidas las palabras arte, obra, performance, prompt, algoritmo, inteligencia artificial, IA.

Devuelve SOLO: { "textos": ["¿...?"] }`, 2);
    extra = (r?.textos ?? []).filter((t) => typeof t === 'string' && t.trim());
    console.log(`  +${extra.length} preguntas generadas`);
  } catch { console.warn('  ⚠ sin lote de Gemini: corren tus preguntas.'); }

  let cola = [...PREGUNTAS_DERIVA, ...extra];
  if (GUION.cierre) cola.push(GUION.cierre);
  if (!cola.length) cola = ['¿Y si nadie viene a apagar esto?'];

  let i = 0;
  while (true) {
    if (i >= cola.length) { cola = [...PREGUNTAS_DERIVA, ...barajar(extra), GUION.cierre].filter(Boolean); i = 0; }
    const texto = cola[i];
    console.log('\n◈ ' + texto);
    await emitirSegmento(/\?\s*$/.test(texto) ? 'pregunta' : 'narracion', texto, i);
    i++;
    const ctrl = new AbortController();
    const reloj = new Promise((r) => setTimeout(() => { ctrl.abort(); r('sigue'); }, DERIVA_MS));
    const cmd = await Promise.race([reloj, esperarCelular(ctrl.signal).then((c) => c ?? 'sigue')]);
    if (cmd === 'terminar') throw new Terminar();
  }
}

funcion().catch(async (e) => {
  if (e instanceof Deriva) {
    try { await modoDeriva(); }
    catch (e2) { console.log(e2 instanceof Terminar ? '\n\n■  FIN.\n' : ''); if (!(e2 instanceof Terminar)) console.error(e2); }
  } else if (e instanceof Terminar) {
    console.log('\n\n■  TERMINADO desde el celular.\n');
  } else {
    console.error('\n✖', e);
  }
  rl.close();
  process.exit(0);
});
