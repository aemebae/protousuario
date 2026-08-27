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
  emitirAfecto, emitirSecuencia, emitirDeriva, emitirPausa, emitirPreludio,
} from './emitir_evento.js';
// LA VOZ. voz(texto) devuelve el nombre del mp3 (de disco o recién grabado).
// Nunca lanza error: si no hay voz, el bloque sale en silencio.
import { voz, vozLote, duracionMs, buscarSonido, VOZ_AUTOR, VOZ_IA } from './voz.js';

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

// ── CORPUS TEÓRICO ──
// Haraway, Mbembe, Preciado, Quijano, Rivera Cusicanqui. NO son citas: cada
// marco es una OPERACIÓN que Gemini ejecuta sin nombrarla. Se elige UNO por
// agente, rotando, para que ninguno se repita en la misma función. Sin este
// bloque, las narraciones salen bonitas pero sin espina dorsal conceptual.
let MARCOS = [];
try { MARCOS = JSON.parse(fs.readFileSync('corpus_teorico.json', 'utf8')).marcos ?? []; } catch {}
const marcosUsados = [];
function elegirMarco(agenteId) {
  if (!MARCOS.length) return null;
  const suyos = MARCOS.filter((m) => (m.agentes ?? []).includes(agenteId));
  const pool = suyos.length ? suyos : MARCOS;
  const frescos = pool.filter((m) => !marcosUsados.includes(m.id));
  const elegido = (frescos.length ? frescos : pool)[0];
  marcosUsados.push(elegido.id);
  return elegido;
}

// ── PRELUDIO ──
// Va UNA sola vez, al principio de todo, antes de cualquier agente. No lo
// genera la IA. Para saltarlo en un ensayo: SIN_PRELUDIO=1
let PRELUDIO = null;
try { PRELUDIO = JSON.parse(fs.readFileSync('preludio.json', 'utf8')); } catch {}

/**
 * Encuentra una región de regiones_conflicto.json por nombre aproximado.
 * Tolera mayúsculas, tildes, artículos y paréntesis, para que puedas escribir
 * "El este de la República Democrática del Congo" y encuentre "rdc_este".
 */
function buscarRegion(regiones, nombre) {
  const limpiar = (x) => String(x).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[()\-–—,.]/g, ' ').replace(/\b(el|la|los|las|de|del|y)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const q = limpiar(nombre);
  if (!q) return null;
  let exacta = regiones.find((r) => limpiar(r.nombre) === q);
  if (exacta) return exacta;
  // parcial: que una contenga a la otra
  exacta = regiones.find((r) => limpiar(r.nombre).includes(q) || q.includes(limpiar(r.nombre)));
  if (exacta) return exacta;
  // por palabras compartidas (mínimo 2)
  const pal = new Set(q.split(' ').filter((w) => w.length > 3));
  let mejor = null, mejorN = 0;
  for (const r of regiones) {
    const n = limpiar(r.nombre).split(' ').filter((w) => pal.has(w)).length;
    if (n > mejorN) { mejorN = n; mejor = r; }
  }
  return mejorN >= 2 ? mejor : null;
}

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

// ═══════════════════════════════════════════════════════════════════════════
//  MODO AUTOMÁTICO
//  Por defecto la obra CORRE SOLA: cuando la voz de un bloque termina, pasa al
//  siguiente sin que toques nada. Los botones siguen todos ahí — PAUSA congela,
//  REPETIR vuelve, AVANZAR salta antes de tiempo, MANUAL desactiva el automático
//  y vuelve al modo botón-a-botón. Al reanudar, sigue solo otra vez.
//
//  Cuánto espera: la duración real del mp3 (se calcula del tamaño del archivo)
//  ajustada por la velocidad de reproducción, más un respiro. Si un bloque no
//  tiene voz, se estima por el largo del texto.
// ═══════════════════════════════════════════════════════════════════════════
let modoAuto = process.env.MANUAL !== '1';
let velocidad = 1;                                  // la cambia el celular
const RESPIRO_MS = Number(process.env.RESPIRO_MS || 1400);

function esperaDe(texto, mp3) {
  const dur = duracionMs(mp3);
  // Sin audio: ~62 ms por carácter es el ritmo de lectura en voz alta.
  const base = dur > 0 ? dur : Math.max(2200, (texto || '').length * 62);
  return Math.round(base / Math.max(0.25, velocidad)) + RESPIRO_MS;
}

/** Espera un comando. PAUSA no devuelve: congela aquí hasta el siguiente. */
async function esperar(msg = '[ENTER o AVANZAR en el celular]', msAuto = 0) {
  const porTeclado = rl.question('\n' + msg + ' ').then(() => 'avanzar');
  while (true) {
    const ctrl = new AbortController();
    // En automático corre además un reloj: gana el que llegue primero.
    const carrera = [porTeclado, esperarCelular(ctrl.signal)];
    let reloj = null;
    if (modoAuto && msAuto > 0 && !enPausa) {
      carrera.push(new Promise((r) => { reloj = setTimeout(() => r('avanzar'), msAuto); }));
    }
    const cmd = (await Promise.race(carrera)) ?? 'avanzar';
    clearTimeout(reloj);
    ctrl.abort();

    if (cmd === 'auto')   { modoAuto = true;  console.log('\n  ▶▶ AUTOMÁTICO'); continue; }
    if (cmd === 'manual') { modoAuto = false; console.log('\n  ▐▐ MANUAL'); continue; }
    if (cmd.startsWith?.('velocidad:')) {
      velocidad = Math.min(2, Math.max(0.5, Number(cmd.split(':')[1]) || 1));
      console.log(`\n  ⏩ velocidad ${velocidad.toFixed(2)}×`);
      continue;
    }
    if (cmd === 'pausa') {
      enPausa = !enPausa;
      // NO se emite nada desde aquí: el servidor ya avisó a la pantalla en el
      // instante en que recibió el botón. Si además emitiéramos, la pantalla
      // recibiría dos avisos y podría quedar en el estado contrario.
      console.log(enPausa ? '\n  ⏸  PAUSA' : '\n  ▶  reanudado');
      continue;
    }
    if (enPausa) enPausa = false;
    if (cmd === 'terminar') throw new Terminar();
    if (cmd === 'saltar_agente') throw new Saltar();
    if (cmd === 'deriva') throw new Deriva();
    return cmd;
  }
}

// SIN_GEMINI=1 → la función corre SOLO con tus textos permanentes y el
// respaldo local. Cero red, cero espera, cero sorpresas. Es el interruptor
// de emergencia si el modelo está saturado el día de la función.
const SIN_GEMINI = process.env.SIN_GEMINI === '1';
// Tope duro por intento. Sin esto, un 503 de Google puede dejar la escena
// colgada minutos: fue lo que te pasó con Quimera.
const GEMINI_MS = Number(process.env.GEMINI_MS || 20000);

async function llamarGemini(prompt, maxIntentos = Number(process.env.GEMINI_INTENTOS || 2)) {
  for (let i = 0; i < maxIntentos; i++) {
    try {
      const res = await Promise.race([
        ai.models.generateContent({ model: process.env.GEMINI_MODELO || 'gemini-2.5-flash', contents: prompt }),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`sin respuesta en ${GEMINI_MS / 1000}s`)), GEMINI_MS)),
      ]);
      const limpio = res.text.trim().replace(/^```json\s*|\s*```$/g, '');
      const m = limpio.match(/\{[\s\S]*\}/);
      return JSON.parse(m ? m[0] : limpio);
    } catch (e) {
      if (i === maxIntentos - 1) throw e;
      console.warn(`  reintento ${i + 1}/${maxIntentos} — ${e.message}`);
      await new Promise((r) => setTimeout(r, 800));
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  UNA SOLA LLAMADA POR AGENTE — devuelve todos sus huecos de golpe
// ═══════════════════════════════════════════════════════════════════════
function promptDeAgente({ ficha, bloques, dato, territorio, rumbo, territorioB, rumboB, marco, nOrb, nNar, nMem }) {
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
${marco ? `\nOPERACIÓN CONCEPTUAL DE ESTE PASAJE (ejecutala en todo lo que escribas; NO la expliques, NO la nombres, NO cites autores):\n${marco.operacion}\n` : ''}

DATOS DUROS DE ESTE MOMENTO (no los contradigas):
- Satélite: ${dato.satelite_enunciable ?? dato.satelite}, a ${dato.altKm != null ? Math.round(dato.altKm) : '—'} km de altitud, sobrevolando ${dato.pais ?? 'aguas internacionales'}.
- Territorio: ${territorio.nombre}. Situación real: ${territorio.contexto}
- Ubicación, escríbela TAL CUAL: "${rumbo.territorio_texto}"
- Frase fija de rumbo, escríbela TAL CUAL: "${rumbo.rumbo_texto} está ${rumbo.estado_marca}"
${territorioB && rumboB ? `- SEGUNDO TERRITORIO, que se nombra en el MISMO bloque, justo después del primero y sin transición explicativa: ${territorioB.nombre}. Situación real: ${territorioB.contexto}
- Su ubicación, TAL CUAL: "${rumboB.territorio_texto}"
- Su frase de rumbo, TAL CUAL: "${rumboB.rumbo_texto} está ${rumboB.estado_marca}"${rumboB.estado !== rumbo.estado ? '\n- ATENCIÓN: el estado CAMBIA entre un territorio y el otro. Que se note ese desplazamiento de autoridad: el agente pasa de tener casa a no tenerla, o al revés.' : ''}` : ''}

PARTITURA COMPLETA DE ESTE AGENTE (el orden real de la escena):
${partitura}

REGLA ABSOLUTA: las líneas marcadas [ACCIÓN DEL CUERPO] y [PREGUNTA AL MICRÓFONO] las escribió el autor de la obra. NO las reescribas, NO las cites, NO las resumas, NO inventes acciones nuevas. Tu trabajo es rellenar SOLO los huecos.

ESCRIBE:

1) "dato_orbital": ${nOrb} texto(s).${territorioB ? ` Cada uno de 80-110 palabras y nombra LOS DOS TERRITORIOS SEGUIDOS, en este orden: primero ${territorio.nombre}, después ${territorioB.nombre}. Un solo bloque continuo, sin punto y aparte, sin "por otro lado" ni "mientras tanto": el satélite pasa de uno al otro como quien barre. Cada territorio con su ubicación exacta, su situación política concreta y su frase fija de rumbo.` : ` De 45-70 palabras. Contiene el satélite, su altitud, el territorio con su ubicación exacta, la situación política concreta, y la frase fija de rumbo con su marca de estado.`}${nOrb > 1 ? ' Si hay más de uno, el segundo NO repite ninguna imagen ni adjetivo del primero.' : ''}

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

// ═══════════════════════════════════════════════════════════════════════════
//  PREPARAR UN AGENTE — se hace EN SEGUNDO PLANO, mientras suena el anterior
//
//  EL PROBLEMA QUE RESUELVE: antes, al entrar cada agente, la escena se
//  detenía a esperar a Gemini. Si Google devolvía 503 (te pasó con Quimera),
//  eran minutos de pantalla congelada y el control sin responder, porque el
//  orquestador solo escucha el celular entre bloque y bloque.
//
//  AHORA: mientras PROTOUSUARIO ejecuta al agente 1, el sistema ya está
//  pidiendo y grabando el agente 2 por detrás. Cuando llega su turno, todo
//  está en memoria y en disco. Gemini deja de estar en el camino crítico.
async function prepararAgente(ag) {
  const ficha = FICHAS.find((f) => f.id === ag.id)
    ?? { agente: ag.nombre, caracter: '', sesgo_manifiestos: '' };
      // ── Dato satelital real de este instante ──
      const dato = await obtenerDatoOrbital({ grupo: GRUPO });
      // ── TUS TERRITORIOS ──
      // Si escribiste viñetas debajo de @ORBITAL, mandan esas, en tu orden.
      // Si no, se elige el más cercano al satélite como hasta ahora.
      const pedidos = (ag.bloques.find((b) => b.tipo === 'orbital' && b.territorios)?.territorios ?? [])
        .map((n) => buscarRegion(regiones, n)).filter(Boolean);
      const territorio = pedidos[0]
        ?? elegirTerritorio(regiones, ag.id, { lat: dato.lat, lon: dato.lon })
        ?? regiones.find((r) => r.agente === ag.id) ?? regiones[0];
      const territorioB = pedidos[1] ?? null;
      const rumbo = motorRumbo({ agente: ficha, territorio, elevacionDeg: dato.elevacionDeg });
      const rumboB = territorioB
        ? motorRumbo({ agente: ficha, territorio: territorioB, elevacionDeg: dato.elevacionDeg })
        : null;
      if (territorioB) {
        console.log(`  + segundo territorio: ${territorioB.nombre} · ${rumboB.territorio_texto} · ${rumboB.estado_marca}`);
      }
      console.log(`  ${dato.satelite} · ${territorio.nombre} · ${rumbo.estado_marca}`);

      // ── Una sola llamada a Gemini con todos los huecos ──
      const nOrb = ag.bloques.filter((b) => b.tipo === 'orbital').length;
      const nNar = ag.bloques.filter((b) => b.tipo === 'narracion').length;
      const nMem = ag.bloques.filter((b) => b.tipo === 'memoria').length;
      let gen = { dato_orbital: [], narracion: [], memoria: [] };
      // `marco` se declara AQUÍ y no dentro del try: si se queda dentro, al
      // escribir el registro más abajo da "marco is not defined" — que es
      // exactamente el error que viste en la terminal.
      const marco = (nOrb + nNar + nMem > 0) ? elegirMarco(ag.id) : null;
      if (marco) console.log(`    marco teórico: ${marco.id}`);
      if (nOrb + nNar + nMem > 0 && !SIN_GEMINI) {
        try {
          const r = await llamarGemini(promptDeAgente({ ficha, bloques: ag.bloques, dato, territorio, rumbo, territorioB, rumboB, marco, nOrb, nNar, nMem }));
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
        gen.dato_orbital.push(
          `${dato.satelite_enunciable ?? dato.satelite} sobrevuela ${territorio.nombre}, ${rumbo.territorio_texto}. ${rumbo.rumbo_texto} está ${rumbo.estado_marca}.`
          + (territorioB && rumboB ? ` Y ahora ${territorioB.nombre}, ${rumboB.territorio_texto}: ${rumboB.rumbo_texto} está ${rumboB.estado_marca}.` : ''));
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
        sin_voz: !!b.sin_voz || b.tipo === 'sonido',
        gemini: !!b.gemini,
        sonido: b.sonido ?? null,
      }));

      // ── REGISTRO ──
      // Todo lo que escribe Gemini queda guardado en manifiestos_log.jsonl,
      // una línea por agente. Sirve para tres cosas: releer después de la
      // función lo que dijo el sistema, alimentar el veto de repeticiones, y
      // tener el material publicable de la obra sin depender de la memoria.
      try {
        fs.appendFileSync('manifiestos_log.jsonl', JSON.stringify({
          fecha: new Date().toISOString(),
          agente: ag.id, agente_nombre: ag.nombre, estado: ag.estado,
          satelite: dato.satelite, satelite_enunciable: dato.satelite_enunciable,
          lat: dato.lat, lon: dato.lon, altKm: dato.altKm, elevacionDeg: dato.elevacionDeg,
          pais: dato.pais, territorio: territorio.nombre, territorio_id: territorio.id,
          territorio_b: territorioB?.nombre ?? null, estado_rumbo_b: rumboB?.estado ?? null,
          rumbo: rumbo.rumbo_texto, ubicacion: rumbo.territorio_texto,
          estado_rumbo: rumbo.estado, estado_marca: rumbo.estado_marca,
          marco_teorico: marco?.id ?? null,
          // SOLO lo que escribió Gemini. Tus textos permanentes no se guardan
          // aquí: ya los tienes en instrucciones_permanentes.txt y duplicarlos
          // engordaría el archivo sin darte nada nuevo.
          generado: gen,
        }) + '\n', 'utf8');
      } catch (e) { console.warn(`  ⚠ no se pudo escribir manifiestos_log.jsonl: ${e.message}`); }
      // ── VOZ DE TODO EL AGENTE, DE UNA SOLA VEZ ──
      // Se graba AHORA, mientras el público aún no vio nada de este agente,
      // y no a mitad de una frase. Lo que ya está en disco no se vuelve a
      // pedir: tus textos fijos ni siquiera tocan la red.
      // Los bloques marcados sin_voz NO se graban: son las preguntas que
      // PROTOUSUARIO dice con su propia boca al micrófono. Si el clon también
      // las dijera, se pisarían. Se cambia en compilar_guion.js (VOZ_EN_PREGUNTAS).
      // DOS VOCES: lo tuyo con la voz del autor, lo de Gemini con la voz IA.
      const vozAg = await vozLote(
        segmentos.filter((x) => !x.sin_voz)
          .map((x) => ({ texto: x.texto, cual: x.gemini ? VOZ_IA : VOZ_AUTOR })),
        { etiqueta: ag.nombre });


  return { ag, ficha, dato, territorio, territorioB, rumbo, rumboB, marco, gen, segmentos, vozAg };
}

async function funcion() {
  console.log('\n' + '='.repeat(72));
  console.log('  PROTOUSUARIO · Patio de las Artes · MINCUL, Lima');
  console.log(`  ${GUION.agentes.length} agentes · ${GUION.agentes.reduce((s, a) => s + a.bloques.length, 0)} bloques`);
  console.log('  AVANZAR = siguiente bloque · PAUSA congela · DERIVA = pasaje final');
  console.log('='.repeat(72));
  // El agente 1 empieza a prepararse AHORA, antes de que suene una sola
  // palabra. Para cuando termine el preludio, ya estará listo.
  const preparado = [];
  if (GUION.agentes[0]) preparado[0] = prepararAgente(GUION.agentes[0]);

  await esperar('[ENTER o AVANZAR para empezar]');

  // ═══ PRELUDIO ═══
  // Se parte en párrafos: cada uno es un bloque con su propio AVANZAR y su
  // propia voz. Un preludio de 400 palabras de un solo golpe no se puede
  // sostener en escena; en párrafos, sí.
  // ── AQUÍ ESTABA EL FALLO ──
  // La condición era `PRELUDIO?.texto`, pero el compilador dejó de escribir
  // ese campo (era una copia redundante de `parrafos`, y lo quitamos). Al no
  // existir `texto`, la condición daba falso y el preludio ENTERO se saltaba
  // en silencio, sin un solo aviso. Ahora se mira `parrafos` primero.
  const hayPreludio = (PRELUDIO?.parrafos?.length || PRELUDIO?.texto);
  if (!hayPreludio) console.warn('  ⚠ preludio.json vacío o ausente: no habrá preludio.');
  if (hayPreludio && process.env.SIN_PRELUDIO !== '1') {
    // El compilador ya deja los párrafos partidos; si no, se parten aquí.
    const parrafos = (PRELUDIO.parrafos?.length ? PRELUDIO.parrafos
      : PRELUDIO.texto.split(/\n+/)).map((t) => t.trim()).filter(Boolean);
    console.log('\n' + '─'.repeat(72));
    console.log(`  PRELUDIO  (${parrafos.length} párrafos)`);
    console.log('─'.repeat(72));
    await emitirAfecto('LIMINAL');
    const vozPre = await vozLote(parrafos.map((t) => ({ texto: t, cual: VOZ_AUTOR })), { etiqueta: 'preludio' });
    await emitirSecuencia(parrafos.map((t) => ({ tipo: 'narracion', texto: t })), { agente: 'PRELUDIO' });
    for (let i = 0; i < parrafos.length; i++) {
      console.log(`\n  [${i + 1}/${parrafos.length}] PRELUDIO`);
      console.log('  ' + parrafos[i].replace(/(.{88})/g, '$1\n  '));
      const mp3Pre = vozPre.get(parrafos[i]) ?? null;
      await emitirPreludio(parrafos[i], mp3Pre);
      await informarControl({ agente: 'PRELUDIO', progreso: `${i + 1}/${parrafos.length}` });
      const cmd = await esperar(`[preludio ${i + 1}/${parrafos.length}] AVANZAR`,
                                esperaDe(parrafos[i], mp3Pre));
      if (cmd === 'repetir') i--;
      else if (cmd === 'retroceder') i = Math.max(-1, i - 2);
      else if (typeof cmd === 'string' && cmd.startsWith('ir:')) {
        const d = Number(cmd.slice(3));
        if (Number.isFinite(d) && d >= 0 && d < parrafos.length) i = d - 1;
      }
    }
  }

  // ── ADELANTARSE ──
  // El agente 1 se prepara mientras suena el preludio; el 2 mientras corre el
  // 1; y así. Cuando le toca a cada uno, ya está todo pedido y grabado.
  let enCamino = preparado[0] ?? prepararAgente(GUION.agentes[0]);

  for (let idx = 0; idx < GUION.agentes.length; idx++) {
    const ag = GUION.agentes[idx];
    try {
      console.log('\n' + '─'.repeat(72));
      console.log(`  ${ag.nombre.toUpperCase()}  (${ag.estado})`);
      console.log('─'.repeat(72));

      const prep = await enCamino;
      // Se lanza YA la preparación del siguiente, sin esperarla.
      enCamino = GUION.agentes[idx + 1] ? prepararAgente(GUION.agentes[idx + 1]) : null;

      const { dato, territorio, rumbo, segmentos, vozAg } = prep;

      await emitirAfecto(ag.estado);
      await emitirSatelite(dato);
      await emitirRumbo({ estado: rumbo.estado, cardinal: rumbo.cardinal,
                          azimut: rumbo.azimut, rumboAgente: rumbo.rumboAgente });
      await emitirSecuencia(segmentos, { agente: ag.nombre });
      await informarControl({ agente: ag.nombre, estado_marca: rumbo.estado_marca,
                              territorio: `${territorio.nombre} — ${rumbo.territorio_texto}` });

      // ── Recorrer la partitura, bloque a bloque ──
      for (let i = 0; i < ag.bloques.length; i++) {
        const b = ag.bloques[i];
        const texto = segmentos[i].texto;
        console.log(`\n  [${i + 1}/${ag.bloques.length}] ${rotulo[b.tipo]}`);
        console.log('  ' + texto.replace(/(.{88})/g, '$1\n  '));

        const seg = segmentos[i];
        const mp3 = seg.sin_voz ? null : (vozAg.get(texto) ?? null);
        // Un bloque @SONIDO no dice nada: suena tu mp3 y ya.
        const son = seg.sonido ? buscarSonido(seg.sonido) : null;
        if (seg.sonido && !son) console.warn(`    ⚠ no encuentro "${seg.sonido}" en "sonidos externos/"`);
        if (son) console.log(`  ♪ ${son}`);
        if (b.tipo === 'id_agente') await emitirAgenteId(ag.nombre, texto, mp3);
        else await emitirSegmento(b.tipo, texto, i, mp3, son);

        await informarControl({ agente: ag.nombre, progreso: `${i + 1}/${ag.bloques.length}` });
        // En automático, un @SONIDO espera lo que dure el mp3 de verdad.
        const cmd = await esperar(`[${i + 1}/${ag.bloques.length}] AVANZAR`,
          son ? duracionMs(son) + RESPIRO_MS : esperaDe(texto, mp3));

        // ── NAVEGACIÓN ──
        // El bucle usa i++ al final de cada vuelta, así que:
        //   repetir     → i--        vuelve a decir ESTE bloque
        //   retroceder  → i -= 2     va al ANTERIOR
        //   ir:N        → i = N-1    salta al bloque N (tocando una línea)
        // El tope inferior es -1 para que la siguiente vuelta caiga en 0 y
        // nunca se salga del guion por abajo.
        if (cmd === 'repetir') i--;
        else if (cmd === 'retroceder') i = Math.max(-1, i - 2);
        else if (typeof cmd === 'string' && cmd.startsWith('ir:')) {
          const destino = Number(cmd.slice(3));
          if (Number.isFinite(destino) && destino >= 0 && destino < ag.bloques.length) {
            i = destino - 1;
            console.log(`  ↦ salto al bloque ${destino + 1}`);
          }
        }
      }
    } catch (e) {
      if (e instanceof Saltar) { console.log(`\n  ⏭  ${ag.nombre} saltado.`); continue; }
      throw e;
    }
  }

  // ═══ CIERRE ═══
  // Antes solo aparecía DENTRO de la deriva, así que si no entrabas en deriva
  // nunca se decía. Ahora es un bloque propio, el último de la partitura, con
  // su AVANZAR y su voz, justo donde lo escribiste en el .txt.
  if (GUION.cierre && GUION.cierre.trim()) {
    console.log('\n' + '─'.repeat(72));
    console.log('  CIERRE');
    console.log('─'.repeat(72));
    const textoCierre = GUION.cierre.trim();
    const mp3Cierre = await voz(textoCierre, { cual: VOZ_AUTOR });
    await emitirAfecto('LIMINAL');
    await emitirSecuencia([{ tipo: 'narracion', texto: textoCierre }], { agente: 'CIERRE' });
    console.log('\n  ' + textoCierre.replace(/(.{88})/g, '$1\n  '));
    await emitirSegmento('narracion', textoCierre, 0, mp3Cierre, null);
    await informarControl({ agente: 'CIERRE', progreso: '1/1' });
    await esperar('[cierre] AVANZAR', esperaDe(textoCierre, mp3Cierre));
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
    // La voz de la deriva: tus preguntas ya están grabadas en audio_respaldo
    // (prerender_voz.js las incluye), así que suenan sin tocar la red. Solo
    // las que generó Gemini piden ElevenLabs, y una a una, sin prisa.
    const mp3 = await voz(texto, { cual: VOZ_IA });
    await emitirSegmento(/\?\s*$/.test(texto) ? 'pregunta' : 'narracion', texto, i, mp3);
    try {
      fs.appendFileSync('manifiestos_log.jsonl', JSON.stringify({
        fecha: new Date().toISOString(), agente: 'deriva', texto,
      }) + '\n', 'utf8');
    } catch {}
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
});  // ── LA DERIVA YA NO LLAMA A GEMINI ──
  // Tus preguntas están escritas en preguntas_deriva.json. Antes, además, se
  // le pedía un lote nuevo al modelo: eso es lo que hacía que el pasaje final
  // tardara tanto en arrancar. Ahora entra al instante, sin red.
  const lote = [];


