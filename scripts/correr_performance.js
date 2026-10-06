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
  emitirClon, emitirSilencio,
} from './emitir_evento.js';
// LA VOZ. voz(texto) devuelve el nombre del mp3 (de disco o recién grabado).
// Nunca lanza error: si no hay voz, el bloque sale en silencio.
import { voz, vozLote, duracionMs, buscarSonido, VOZ_AUTOR, VOZ_IA } from './voz.js';

const URL_VISUAL = process.env.URL_VISUAL || 'http://localhost:3000';
const DERIVA_MS = Number(process.env.DERIVA_MS || 13000);
const rl = readline.createInterface({ input, output });
// Si la terminal se queda sin teclado (ventana sin entrada, arranque raro),
// el orquestador NO se cae: sigue obedeciendo al celular. Antes moría con
// "readline was closed" en la segunda espera.
let tecladoVivo = true;
rl.on('close', () => { tecladoVivo = false; });

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

// ═══════════════════════════════════════════════════════════════════════════
//  AJUSTES DE DRAMATURGIA — se tocan aquí, o desde PowerShell sin editar nada
// ═══════════════════════════════════════════════════════════════════════════
//  LARGO DEL DATO ORBITAL, en palabras.
//  Vuelve al largo con que sonó el 27-08 (te gustó así). Para cambiarlo,
//  edita estos números o, sin tocar el archivo, desde PowerShell:
//     $env:ORBITAL_PALABRAS="60-80"        ← con dos territorios
//     $env:ORBITAL_PALABRAS_UNO="40-55"    ← cuando hay un solo territorio
const ORBITAL_PALABRAS = process.env.ORBITAL_PALABRAS || '80-110';
const ORBITAL_PALABRAS_UNO = process.env.ORBITAL_PALABRAS_UNO || '45-70';

//  SATÉLITE EN VIVO — el que está ENCIMA de cada territorio cuando se habla.
//  · ANTICIPO_ORBITAL: cuántos bloques antes del @ORBITAL se elige el satélite
//    y se graba su voz. Con 2, la elección ocurre ~10-30 s antes de decirla:
//    en ese tiempo un satélite bajo avanza 75-225 km, sigue encima.
//  · RELEVO_S: cada cuántos segundos el radar pasa al satélite que AHORA está
//    encima del territorio (los bajos lo cruzan en un par de minutos).
//    0 = el radar se queda con el mismo satélite todo el agente.
//  · CIELOS_DESDE: para Eco-Satelital ("desde los cielos"), si la elevación
//    que lo autoriza se mide desde el TERRITORIO o desde la SALA.
const ANTICIPO_ORBITAL = Number(process.env.ANTICIPO_ORBITAL ?? 2);
const RELEVO_S = Number(process.env.RELEVO_S ?? 45);
const CIELOS_DESDE = process.env.CIELOS_DESDE || 'territorio';
//  Ubicación corta del segundo territorio, sin repetir el observador (1 = sí).
const UBICACION_B_CORTA = process.env.UBICACION_B_CORTA === '1';

//  LOS DOS SILENCIOS — son DISTINTOS y se ajustan por separado:
//
//  PAUSA_PREGUNTAS_S  el aire que queda después de CADA pregunta del @CIERRE.
//                     Va solo: no tienes que escribir nada en el guion.
//  SILENCIO_S         lo que dura un @SILENCIO escrito sin número, en
//                     cualquier parte del guion. Un "@SILENCIO 12" dura 12,
//                     diga lo que diga este número.
//
//  Para cambiarlos, edita los números de abajo o, sin tocar el archivo:
//     $env:PAUSA_PREGUNTAS_S=3 ; $env:SILENCIO_S=4
const PAUSA_PREGUNTAS_S = Number(process.env.PAUSA_PREGUNTAS_S
  ?? (process.env.PAUSA_PREGUNTAS_MS ? Number(process.env.PAUSA_PREGUNTAS_MS) / 1000 : 5));
const SILENCIO_S = Number(process.env.SILENCIO_S ?? 5);

/**
 * La ubicación del SEGUNDO territorio, sin repetir el observador.
 *   "al noroeste (325°) desde el Museo de la Nación / MINCUL, Lima, Perú"
 *   → "al noroeste (325°)"
 * Ahorra 9-10 palabras por dato orbital, que con el límite nuevo es mucho.
 * El primer territorio conserva la línea entera: el observador se dice UNA vez.
 */
function ubicacionCorta(rumbo) {
  const t = rumbo?.territorio_texto ?? '';
  const i = t.indexOf(' desde ');
  return i > 0 ? t.slice(0, i) : t;
}

function esperaDe(texto, mp3) {
  const dur = duracionMs(mp3);
  // Sin audio: ~62 ms por carácter es el ritmo de lectura en voz alta.
  const base = dur > 0 ? dur : Math.max(2200, (texto || '').length * 62);
  return Math.round(base / Math.max(0.25, velocidad)) + RESPIRO_MS;
}

/** Espera un comando. PAUSA no devuelve: congela aquí hasta el siguiente. */
async function esperar(msg = '[ENTER o AVANZAR en el celular]', msAuto = 0) {
  const nunca = new Promise(() => {});
  let porTeclado = nunca;
  if (tecladoVivo) {
    try { porTeclado = rl.question('\n' + msg + ' ').then(() => 'avanzar', () => nunca); }
    catch { tecladoVivo = false; porTeclado = nunca; }
  } else {
    console.log('\n' + msg + '  (sin teclado: espera al celular)');
  }
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
- LOS SATÉLITES SE ELIGEN EN VIVO: en el instante en que se diga tu texto, el
  sistema pondrá el satélite real que en ESE momento está justo encima de cada
  territorio. Tú no sabes cuál será. Escríbelos con estas marcas, tal cual,
  con llaves, una vez cada una:
    {SAT_A} = el satélite encima del primer territorio · {ALT_A} = su altitud en km (solo el número)${territorioB ? `
    {SAT_B} = el satélite encima del segundo territorio · {ALT_B} = su altitud en km (solo el número)` : ''}
  Uso correcto: "{SAT_A}, a {ALT_A} kilómetros de altura, sobrevuela ..."
  NUNCA inventes nombres de satélites.
- PROHIBIDO nombrar cualquier país, océano o región que no sean tus territorios.
- Territorio: ${territorio.nombre}. Situación real: ${territorio.contexto}
- Ubicación, escríbela TAL CUAL: "${rumbo.territorio_texto}"
- Frase fija de rumbo, escríbela TAL CUAL: "${rumbo.rumbo_texto} está ${rumbo.estado_marca}"
${territorioB && rumboB ? `- SEGUNDO TERRITORIO, que se nombra en el MISMO bloque, justo después del primero y sin transición explicativa: ${territorioB.nombre}. Situación real: ${territorioB.contexto}
- Su ubicación, TAL CUAL: "${UBICACION_B_CORTA ? ubicacionCorta(rumboB) : rumboB.territorio_texto}"
- Su frase de rumbo, TAL CUAL: "${rumboB.rumbo_texto} está ${rumboB.estado_marca}"${rumboB.estado !== rumbo.estado ? '\n- ATENCIÓN: el estado CAMBIA entre un territorio y el otro. Que se note ese desplazamiento de autoridad: el agente pasa de tener casa a no tenerla, o al revés.' : ''}` : ''}

PARTITURA COMPLETA DE ESTE AGENTE (el orden real de la escena):
${partitura}

REGLA ABSOLUTA: las líneas marcadas [ACCIÓN DEL CUERPO] y [PREGUNTA AL MICRÓFONO] las escribió el autor de la obra. NO las reescribas, NO las cites, NO las resumas, NO inventes acciones nuevas. Tu trabajo es rellenar SOLO los huecos.

ESCRIBE:

1) "dato_orbital": ${nOrb} texto(s).${territorioB ? ` Cada uno de ${ORBITAL_PALABRAS} palabras y nombra LOS DOS TERRITORIOS SEGUIDOS, en este orden: primero ${territorio.nombre} con {SAT_A}, después ${territorioB.nombre} con {SAT_B}. Un solo bloque continuo, sin punto y aparte, sin "por otro lado" ni "mientras tanto": la mirada orbital pasa de un satélite al otro como quien barre. Cada territorio con su satélite y su altitud, su ubicación exacta, su situación política concreta y su frase fija de rumbo.` : ` De ${ORBITAL_PALABRAS_UNO} palabras. Contiene {SAT_A} y {ALT_A}, el territorio con su ubicación exacta, la situación política concreta, y la frase fija de rumbo con su marca de estado.`}${nOrb > 1 ? ' Si hay más de uno, el segundo NO repite ninguna imagen ni adjetivo del primero.' : ''}

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

  // ── TUS TERRITORIOS, primero ──
  // Mandan las viñetas bajo @ORBITAL, en tu orden. Si no hay viñetas, el
  // reparto de regiones_conflicto.json (el campo "agente").
  const pedidos = (ag.bloques.find((b) => b.tipo === 'orbital' && b.territorios)?.territorios ?? [])
    .map((n) => buscarRegion(regiones, n)).filter(Boolean);
  const deReparto = regiones.filter((r) => r.agente === ag.id);
  const territorio = pedidos[0] ?? deReparto[0] ?? regiones[0];
  const territorioB = pedidos.length ? (pedidos[1] ?? null) : (deReparto[1] ?? null);

  // ── Y LUEGO EL CIELO: un satélite encima de cada territorio ──
  const dato = await obtenerDatoOrbital({ grupo: GRUPO, territorios: [territorio, territorioB] });
  const [vivoA, vivoB] = dato.porTerritorio ?? [];
  const elevA = CIELOS_DESDE === 'sala' ? dato.elevacionDeg : (vivoA?.elevacion_desde_territorio ?? dato.elevacionDeg);
  const elevB = CIELOS_DESDE === 'sala' ? dato.elevacionDeg : (vivoB?.elevacion_desde_territorio ?? dato.elevacionDeg);
  const rumbo = motorRumbo({ agente: ficha, territorio, elevacionDeg: elevA });
  const rumboB = territorioB ? motorRumbo({ agente: ficha, territorio: territorioB, elevacionDeg: elevB }) : null;

  console.log(`  ${territorio.nombre} · ${rumbo.territorio_texto} · ${rumbo.estado_marca}`);
  if (territorioB) console.log(`  + ${territorioB.nombre} · ${rumboB.territorio_texto} · ${rumboB.estado_marca}`);

  // ── Una sola llamada a Gemini con todos los huecos ──
  const nOrb = ag.bloques.filter((b) => b.tipo === 'orbital' && b.gemini).length;
  const nNar = ag.bloques.filter((b) => b.tipo === 'narracion' && b.gemini).length;
  const nMem = ag.bloques.filter((b) => b.tipo === 'memoria' && b.gemini).length;
  let gen = { dato_orbital: [], narracion: [], memoria: [] };
  // `marco` se declara aquí y no dentro del try (era el "marco is not defined").
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
  // Si Gemini olvidó la marca del satélite, se le antepone: nunca se dirá un
  // satélite inventado, y el real siempre se nombra.
  gen.dato_orbital = gen.dato_orbital.map((t) => {
    if (/[{[]\s*SAT[_\s-]?A\s*[}\]]/i.test(t)) return t;
    console.warn('    ⚠ Gemini no puso {SAT_A}: se antepone el satélite en vivo.');
    return `{SAT_A}, a {ALT_A} kilómetros de altura: ${t}`;
  });
  for (const t of gen.dato_orbital) {
    console.log(`    dato orbital: ${t.split(/\s+/).filter(Boolean).length} palabras (pedidas: ${territorioB ? ORBITAL_PALABRAS : ORBITAL_PALABRAS_UNO})`);
  }
  // Respaldo: nunca queda un hueco vacío en escena.
  while (gen.dato_orbital.length < nOrb) {
    gen.dato_orbital.push(orbitalDeRespaldo({ territorio, rumbo, territorioB, rumboB }));
  }
  while (gen.narracion.length < nNar) {
    const t = RESPALDO[gen.narracion.length % Math.max(1, RESPALDO.length)] ?? '';
    // El satélite NO se nombra en una narración de respaldo: se graba antes y
    // para entonces el satélite ya habría pasado.
    gen.narracion.push(t.replaceAll('{TERRITORIO}', territorio.nombre).replaceAll('{SATELITE}', 'el satélite'));
  }
  while (gen.memoria.length < nMem) gen.memoria.push('Recuerdo una avenida a esta misma hora, y no recuerdo si la crucé yo.');

  // ── Armar la secuencia LITERAL ──
  // Los @ORBITAL de Gemini quedan como PLANTILLA con {SAT_A}…: se rellenan
  // en vivo, dos bloques antes de decirse (ver fijarOrbitalEnVivo).
  const cola = { orbital: [...gen.dato_orbital], narracion: [...gen.narracion], memoria: [...gen.memoria] };
  const segmentos = ag.bloques.map((b) => {
    const texto = b.gemini ? (cola[b.tipo]?.shift() ?? '') : (b.texto ?? '');
    const vivo = b.tipo === 'orbital' && tieneMarcas(texto);
    return {
      tipo: b.tipo === 'id_agente' ? 'prompt' : b.tipo,
      texto, plantilla: vivo ? texto : null, vivo,
      sin_voz: !!b.sin_voz || ['sonido', 'silencio', 'clon'].includes(b.tipo),
      gemini: !!b.gemini,
      sonido: b.sonido ?? null,
      figura: b.figura ?? null,
    };
  });
  const indicesVivos = segmentos.map((x, k) => (x.vivo ? k : -1)).filter((k) => k >= 0);
  const io = indicesVivos.length ? indicesVivos[0] : Infinity;

  // ── VOZ DE TODO EL AGENTE, menos los @ORBITAL en vivo ──
  // Se graba ahora, mientras suena el agente anterior. Lo que ya está en
  // disco ni siquiera toca la red. Los orbitales en vivo se graban después,
  // cuando se sepa qué satélite está encima.
  const vozAg = await vozLote(
    segmentos.filter((x) => !x.sin_voz && !x.vivo && x.texto)
      .map((x) => ({ texto: x.texto, cual: x.gemini ? VOZ_IA : VOZ_AUTOR })),
    { etiqueta: ag.nombre });

  return { ag, ficha, dato, territorio, territorioB, rumbo, rumboB, marco, gen,
           segmentos, vozAg, indicesVivos, io, orbitalVivo: null, datoVivo: null,
           enEscena: false, relevoPausado: false, registrado: false };
}

// ═══════════════════════════════════════════════════════════════════════════
//  EL SATÉLITE, EN VIVO
// ═══════════════════════════════════════════════════════════════════════════
const RE_MARCA = /[{[]\s*(SAT|ALT)[_\s-]?([AB])\s*[}\]]/gi;
function tieneMarcas(t) { RE_MARCA.lastIndex = 0; return RE_MARCA.test(t ?? ''); }

/** Pone el nombre y la altura reales donde Gemini dejó {SAT_A}, {ALT_B}… */
function rellenarOrbital(plantilla, vivos) {
  const [a, b] = vivos;
  const nombre = (v) => v?.satelite_enunciable ?? v?.satelite ?? null;
  const alt = (v) => (v?.altKm != null ? String(Math.round(v.altKm)) : null);
  return plantilla.replace(RE_MARCA, (_, que, cual) => {
    const v = cual.toUpperCase() === 'B' ? (b ?? a) : a;
    return que.toUpperCase() === 'SAT' ? (nombre(v) ?? 'un satélite') : (alt(v) ?? 'cientos de');
  });
}

/** Lo que se ve en el celular ANTES de fijar el satélite. */
const vistaPrevia = (segs) => segs.map((x) => ({
  ...x, texto: x.vivo && tieneMarcas(x.texto) ? x.texto.replace(RE_MARCA, '◉') : x.texto,
}));

function orbitalDeRespaldo({ territorio, rumbo, territorioB, rumboB }) {
  return `{SAT_A}, a {ALT_A} kilómetros de altura, sobrevuela ${territorio.nombre}, ${rumbo.territorio_texto}. ${rumbo.rumbo_texto} está ${rumbo.estado_marca}.`
    + (territorioB && rumboB
      ? ` Y {SAT_B}, a {ALT_B} kilómetros, sobre ${territorioB.nombre}, ${UBICACION_B_CORTA ? ubicacionCorta(rumboB) : rumboB.territorio_texto}: ${rumboB.rumbo_texto} está ${rumboB.estado_marca}.`
      : '');
}

/**
 * Elige AHORA el satélite que está encima de cada territorio, lo escribe en
 * el texto, lo muestra en el globo y graba la voz. Se llama ANTICIPO_ORBITAL
 * bloques antes de que se diga el @ORBITAL (o en el último bloque del agente
 * anterior, si el @ORBITAL abre el agente). Una sola vez por agente.
 * @param {{mostrar?: boolean, motivo?: string}} op  mostrar=false cuando se
 *        adelanta desde el agente anterior: el globo no debe saltar todavía.
 */
function fijarOrbitalEnVivo(prep, { mostrar = true, motivo = '' } = {}) {
  if (prep.orbitalVivo) return prep.orbitalVivo;
  prep.orbitalVivo = (async () => {
    const { ag, territorio, territorioB, segmentos, vozAg } = prep;
    let dato = prep.dato;
    try {
      dato = await obtenerDatoOrbital({ grupo: GRUPO, territorios: [territorio, territorioB], silencioso: true });
    } catch (e) { console.warn(`    ⚠ no se pudo recalcular el cielo (${e.message}): se usa el de la preparación.`); }
    const vivos = dato.porTerritorio?.length ? dato.porTerritorio : (prep.dato.porTerritorio ?? []);
    for (const k of prep.indicesVivos) segmentos[k].texto = rellenarOrbital(segmentos[k].plantilla, vivos);
    prep.datoVivo = dato;

    console.log(`\n  ◉ SATÉLITE EN VIVO — ${ag.nombre} ${motivo}`);
    for (const v of vivos) {
      console.log(`    ${v.satelite} encima de ${v.territorio_nombre} · ${v.elevacion_desde_territorio}° en ese cielo · `
        + `a ${v.distancia_km} km del centro · órbita ${v.orbita}${v.dentro ? '' : ' · (al borde del territorio)'}`);
    }
    if (mostrar && prep.enEscena) {
      // Desde que se fija hasta que se dice su nombre, el relevo se detiene:
      // en pantalla tiene que estar el MISMO satélite que la voz nombra.
      prep.relevoPausado = true;
      await emitirSatelite(dato);
      await emitirSecuencia(segmentos, { agente: ag.nombre, actualizacion: true });
    }
    escribirRegistro(prep, dato);

    // La voz se graba ahora: unos segundos, mientras suena lo anterior.
    const mapa = await vozLote(prep.indicesVivos.map((k) => ({ texto: segmentos[k].texto, cual: VOZ_IA })),
                               { etiqueta: `${ag.nombre} · orbital en vivo` });
    for (const [t, mp3] of mapa) vozAg.set(t, mp3);
    return dato;
  })();
  return prep.orbitalVivo;
}

/** El radar pasa al satélite que AHORA está encima del territorio. */
function iniciarRelevo(prep) {
  if (!RELEVO_S || RELEVO_S < 10) return () => {};
  const id = setInterval(async () => {
    if (prep.relevoPausado || enPausa) return;
    try {
      const d = await obtenerDatoOrbital({ grupo: GRUPO, territorios: [prep.territorio, prep.territorioB], silencioso: true });
      await emitirSatelite(d);
    } catch { /* un relevo que falla no importa: el radar sigue con el anterior */ }
  }, RELEVO_S * 1000);
  return () => clearInterval(id);
}

/** Una línea por agente en manifiestos_log.jsonl, con los satélites REALES. */
function escribirRegistro(prep, dato) {
  if (prep.registrado) return;
  prep.registrado = true;
  const { ag, territorio, territorioB, rumbo, rumboB, marco, gen, segmentos } = prep;
  try {
    fs.appendFileSync('manifiestos_log.jsonl', JSON.stringify({
      fecha: new Date().toISOString(),
      agente: ag.id, agente_nombre: ag.nombre, estado: ag.estado,
      satelite: dato.satelite, satelite_enunciable: dato.satelite_enunciable,
      lat: dato.lat, lon: dato.lon, altKm: dato.altKm, elevacionDeg: dato.elevacionDeg,
      pais: dato.pais, territorio: territorio.nombre, territorio_id: territorio.id,
      territorio_b: territorioB?.nombre ?? null, estado_rumbo_b: rumboB?.estado ?? null,
      // Qué satélite estaba encima de cada territorio, y cuán encima.
      satelites_vivos: (dato.porTerritorio ?? []).map((v) => ({
        territorio: v.territorio_nombre, satelite: v.satelite, orbita: v.orbita,
        altKm: Math.round(v.altKm), elevacion_desde_territorio: v.elevacion_desde_territorio,
        distancia_km: v.distancia_km, dentro: v.dentro, pais_bajo_el_satelite: v.pais,
      })),
      rumbo: rumbo.rumbo_texto, ubicacion: rumbo.territorio_texto,
      estado_rumbo: rumbo.estado, estado_marca: rumbo.estado_marca,
      marco_teorico: marco?.id ?? null,
      // SOLO lo que escribió Gemini, con el satélite ya escrito.
      generado: { ...gen, dato_orbital: prep.indicesVivos.length
        ? prep.indicesVivos.map((k) => segmentos[k].texto) : gen.dato_orbital },
    }) + '\n', 'utf8');
  } catch (e) { console.warn(`  ⚠ no se pudo escribir manifiestos_log.jsonl: ${e.message}`); }
}

// Preparaciones en curso y las ya terminadas (para poder adelantarse al
// satélite del agente siguiente sin esperar a que empiece).
const listos = new Map();
function lanzar(ag) {
  const p = prepararAgente(ag);
  p.then((x) => listos.set(ag.id, x)).catch(() => {});
  return p;
}
/**
 * Si el @ORBITAL del agente SIGUIENTE está al principio (Donald-Prompt lo
 * tiene en el bloque 1), su satélite se fija y su voz se graba durante el
 * último bloque de lo que suena ahora. Así no hay silencio de espera.
 */
function adelantarOrbital(idxAgente) {
  const ag = GUION.agentes[idxAgente];
  const prep = ag && listos.get(ag.id);
  if (prep && prep.indicesVivos.length && prep.io <= ANTICIPO_ORBITAL) {
    fijarOrbitalEnVivo(prep, { mostrar: false, motivo: '(adelantado, durante lo anterior)' });
  }
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
  if (GUION.agentes[0]) preparado[0] = lanzar(GUION.agentes[0]);

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
      if (i === parrafos.length - 1) adelantarOrbital(0);
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
  let enCamino = preparado[0] ?? lanzar(GUION.agentes[0]);

  for (let idx = 0; idx < GUION.agentes.length; idx++) {
    const ag = GUION.agentes[idx];
    try {
      console.log('\n' + '─'.repeat(72));
      console.log(`  ${ag.nombre.toUpperCase()}  (${ag.estado})`);
      console.log('─'.repeat(72));

      const prep = await enCamino;
      // Se lanza YA la preparación del siguiente, sin esperarla.
      enCamino = GUION.agentes[idx + 1] ? lanzar(GUION.agentes[idx + 1]) : null;

      const { territorio, rumbo, segmentos, vozAg } = prep;
      prep.enEscena = true;
      // Si su satélite se fijó durante lo anterior, el relevo espera a que se diga.
      if (prep.orbitalVivo) prep.relevoPausado = true;

      await emitirAfecto(ag.estado);
      // El globo muestra el satélite que está encima del territorio AHORA.
      if (prep.indicesVivos.length && prep.io <= ANTICIPO_ORBITAL) {
        fijarOrbitalEnVivo(prep, { motivo: '(al entrar el agente)' });   // si ya se adelantó, no repite
      }
      let enPantalla = prep.datoVivo;
      if (!enPantalla) {
        try { enPantalla = await obtenerDatoOrbital({ grupo: GRUPO, territorios: [prep.territorio, prep.territorioB], silencioso: true }); }
        catch { enPantalla = prep.dato; }
      }
      await emitirSatelite(enPantalla);
      await emitirRumbo({ estado: rumbo.estado, cardinal: rumbo.cardinal,
                          azimut: rumbo.azimut, rumboAgente: rumbo.rumboAgente });
      await emitirSecuencia(vistaPrevia(segmentos), { agente: ag.nombre });
      await informarControl({ agente: ag.nombre, estado_marca: rumbo.estado_marca,
                              territorio: `${territorio.nombre} — ${rumbo.territorio_texto}` });
      if (!prep.indicesVivos.length) escribirRegistro(prep, prep.dato);
      const pararRelevo = iniciarRelevo(prep);
      try {

      // ── Recorrer la partitura, bloque a bloque ──
      for (let i = 0; i < ag.bloques.length; i++) {
        const b = ag.bloques[i];
        const seg = segmentos[i];

        // ── DISPARADORES DEL SATÉLITE EN VIVO ──
        if (prep.indicesVivos.length && !prep.orbitalVivo && i >= prep.io - ANTICIPO_ORBITAL) {
          fijarOrbitalEnVivo(prep, { motivo: `(${Math.max(0, prep.io - i)} bloques antes de decirlo)` });
        }
        if (i === ag.bloques.length - 1) adelantarOrbital(idx + 1);

        // ── @CLON: el rostro cambia, la escena no se detiene ──
        if (b.tipo === 'clon') {
          console.log(`\n  [${i + 1}/${ag.bloques.length}] ◐ CLON → ${b.figura} (${b.segundos ?? 12} s)`);
          await emitirClon(b.figura, b.segundos ?? 12);
          continue;
        }

        // ── @ORBITAL en vivo: si su voz aún se está grabando, se espera ──
        if (seg.vivo) {
          prep.relevoPausado = true;          // el radar no cambia mientras se dice su nombre
          const t0 = Date.now();
          await Promise.race([fijarOrbitalEnVivo(prep), new Promise((r) => setTimeout(r, 25000))]);
          const espero = Date.now() - t0;
          if (espero > 800) console.log(`    (fijando el satélite: ${(espero / 1000).toFixed(1)} s)`);
        }

        const texto = seg.texto;
        console.log(`\n  [${i + 1}/${ag.bloques.length}] ${rotulo[b.tipo] ?? b.tipo.toUpperCase()}`);
        if (texto) console.log('  ' + texto.replace(/(.{88})/g, '$1\n  '));

        // @SILENCIO dentro de un agente: reposo escrito, sin voz ni texto nuevo.
        if (b.tipo === 'silencio') {
          const segS = b.segundos ?? SILENCIO_S;
          await emitirSilencio(segS);
          console.log(`  · silencio ${segS} s ·`);
          const cmdS = await esperar(`[${i + 1}/${ag.bloques.length}] silencio`, segS * 1000);
          if (cmdS === 'retroceder') i = Math.max(-1, i - 2);
          else if (typeof cmdS === 'string' && cmdS.startsWith('ir:')) i = Math.max(-1, Number(cmdS.slice(3)) - 1);
          continue;
        }
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
        if (seg.vivo) prep.relevoPausado = false;

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
      } finally { pararRelevo(); prep.enEscena = false; }
    } catch (e) {
      if (e instanceof Saltar) { console.log(`\n  ⏭  ${ag.nombre} saltado.`); continue; }
      throw e;
    }
  }

  // ═══ CIERRE ═══
  // Ahora es una LISTA de bloques, igual que un agente: se navega con ATRÁS,
  // AVANZAR y tocando líneas; cada bloque tiene su propio audio. Entre las
  // PREGUNTAS se deja un silencio de PAUSA_PREGUNTAS_MS (5 s por defecto):
  // la voz pregunta, el patio se queda con la pregunta, y recién ahí sigue.
  // Acepta un texto viejo (string) por compatibilidad: lo trata como un bloque.
  const CIERRE = Array.isArray(GUION.cierre) ? GUION.cierre
    : (GUION.cierre && GUION.cierre.trim() ? [{ tipo: 'narracion', texto: GUION.cierre.trim() }] : []);

  if (CIERRE.length) {
    console.log('\n' + '─'.repeat(72));
    console.log(`  CIERRE  (${CIERRE.length} bloques · silencio entre preguntas: ${PAUSA_PREGUNTAS_S}s)`);
    console.log('─'.repeat(72));
    await emitirAfecto('LIMINAL');

    // Todo el cierre es texto TUYO: voz de autor. Lo que ya está en disco no
    // se vuelve a pedir; lo que falte se graba aquí, de una vez.
    const vozCierre = await vozLote(
      CIERRE.filter((b) => b.texto && !['sonido', 'silencio', 'clon'].includes(b.tipo))
            .map((b) => ({ texto: b.texto, cual: VOZ_AUTOR })),
      { etiqueta: 'cierre' });

    await emitirSecuencia(CIERRE.map((b) => ({ tipo: b.tipo, texto: b.texto ?? '', sonido: b.sonido ?? null })),
                          { agente: 'CIERRE' });

    for (let i = 0; i < CIERRE.length; i++) {
      const b = CIERRE[i];
      await informarControl({ agente: 'CIERRE', progreso: `${i + 1}/${CIERRE.length}` });

      // @SILENCIO: nadie habla, la pantalla no cambia, solo se espera.
      if (b.tipo === 'clon') { await emitirClon(b.figura, b.segundos ?? 12); console.log(`  ◐ CLON → ${b.figura}`); continue; }
      if (b.tipo === 'silencio') {
        const segS = b.segundos ?? SILENCIO_S;
        await emitirSilencio(segS);
        console.log(`\n  [${i + 1}/${CIERRE.length}] · silencio ${segS} s ·`);
        const cmd = await esperar(`[cierre ${i + 1}/${CIERRE.length}] silencio`, segS * 1000);
        if (cmd === 'retroceder') i = Math.max(-1, i - 2);
        else if (typeof cmd === 'string' && cmd.startsWith('ir:')) i = Math.max(-1, Number(cmd.slice(3)) - 1);
        continue;
      }

      const son = b.tipo === 'sonido' ? buscarSonido(b.sonido) : null;
      const mp3 = son ? null : (vozCierre.get(b.texto) ?? null);
      console.log(`\n  [${i + 1}/${CIERRE.length}] ${b.tipo === 'pregunta' ? '◈ PREGUNTA' : b.tipo.toUpperCase()}`);
      if (b.texto) console.log('  ' + b.texto.replace(/(.{88})/g, '$1\n  '));
      await emitirSegmento(b.tipo, b.texto ?? '', i, mp3, son);

      // La espera: lo que dura la voz + el silencio que corresponda.
      // Tras una PREGUNTA, el silencio largo; tras el resto, el respiro normal.
      const dur = son ? duracionMs(son) : duracionMs(mp3);
      const base = dur > 0 ? Math.round(dur / Math.max(0.25, velocidad))
                           : Math.max(2200, (b.texto || '').length * 62);
      const aire = b.tipo === 'pregunta' ? PAUSA_PREGUNTAS_S * 1000 : RESPIRO_MS;
      const cmd = await esperar(`[cierre ${i + 1}/${CIERRE.length}] AVANZAR`, base + aire);

      if (cmd === 'repetir') i--;
      else if (cmd === 'retroceder') i = Math.max(-1, i - 2);
      else if (typeof cmd === 'string' && cmd.startsWith('ir:')) {
        const d = Number(cmd.slice(3));
        if (Number.isFinite(d) && d >= 0 && d < CIERRE.length) i = d - 1;
      }
    }
  }

  // DESPUÉS DEL CIERRE: por defecto entra la deriva — la voz sigue
  // preguntando en bucle, con nadie en escena, hasta que aprietes TERMINAR
  // ("¿Y si nadie viene a apagar esto?"). Para que la obra TERMINE con la
  // última pregunta del cierre:   $env:DERIVA_AL_FINAL=0
  if (process.env.DERIVA_AL_FINAL === '0') {
    console.log('\n  ■ Fin de la partitura (DERIVA_AL_FINAL=0): la pantalla queda como está.');
    return;
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

  // ── LA DERIVA YA NO LLAMA A GEMINI (de verdad, esta vez) ──
  // Quedaba una segunda llamada que pedía 12 preguntas extra: hasta 40 s de
  // espera antes del pasaje final. Fuera. Y el cierre YA NO se agrega aquí:
  // ahora suena en su propio lugar, y además es una lista de bloques, no un
  // texto (agregarlo habría metido una lista donde va una pregunta).
  let cola = [...PREGUNTAS_DERIVA];
  if (!cola.length) cola = ['¿Y si nadie viene a apagar esto?'];

  let i = 0;
  while (true) {
    if (i >= cola.length) { cola = [...PREGUNTAS_DERIVA]; i = 0; }
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

funcion().then(() => {
  // La partitura terminó sin deriva (DERIVA_AL_FINAL=0): se cierra limpio.
  console.log('\n\n■  FIN.\n');
  rl.close();
  process.exit(0);
}).catch(async (e) => {
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
