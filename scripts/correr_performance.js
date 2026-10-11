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
  emitirClon, emitirSilencio, emitirFondo,
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

// GEMINI_URL solo existe para las pruebas (un Gemini falso local). Sin
// definirla, se habla con Google como siempre.
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY,
  ...(process.env.GEMINI_URL ? { httpOptions: { baseUrl: process.env.GEMINI_URL } } : {}) });
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

// ═══════════════════════════════════════════════════════════════════════════
//  LA ESPERA DE CADA BLOQUE  (v16, 10-10)
//
//  ANTES: al empezar un bloque se ponía un reloj "duración ÷ velocidad +
//  respiro". Y cada vez que tocabas VELOCIDAD o PAUSA, ese reloj volvía a
//  EMPEZAR DE CERO con la duración completa. Si cambiabas la velocidad a los
//  8 s de una frase de 10, esperaba otros 10 enteros: silencios largos.
//
//  AHORA, dos cosas:
//   1) La pantalla AVISA cuando la voz terminó de sonar de verdad ("fin" con
//      la contraseña de ese bloque). Con ese aviso se espera el respiro y se
//      pasa al siguiente. Es exacto aunque cambies la velocidad diez veces.
//   2) Un reloj de respaldo, por si la pantalla no avisa (se colgó, se cerró):
//      lleva la cuenta de cuánta voz ya sonó a cada velocidad y descuenta las
//      pausas. Nunca vuelve a empezar de cero.
// ═══════════════════════════════════════════════════════════════════════════
const MARGEN_FIN_MS = 1500;   // cuánto más espera el respaldo que el aviso real
let contrasena = 0;           // una por cada bloque que se emite
const nuevaContrasena = () => ++contrasena;

/** Duración estimada (a 1×) de un texto sin audio: ~62 ms por carácter. */
const duracionEstimada = (texto) => Math.max(2200, (texto || '').length * 62);

/**
 * Plan de espera:
 *   { vozMs, token, despuesMs }  bloque con voz (vozMs = duración real a 1×)
 *   { fijoMs, token, despuesMs } tu @SONIDO (no cambia con la velocidad)
 *   { fijoMs }                   @SILENCIO
 *   número                       espera fija (compatibilidad)
 */
function planDeVoz(texto, mp3, token, despuesMs = RESPIRO_MS) {
  const dur = duracionMs(mp3);
  return { vozMs: dur > 0 ? dur : duracionEstimada(texto), token, despuesMs };
}

/** "@CLON figura s fin" (clon v4, chat 6): cuánto le falta a este agente desde
 *  el bloque `desde`, con la misma cuenta que usa el modo automático para
 *  esperar cada bloque. Devuelve ms totales y cuántos de esos son @SILENCIO
 *  (el clon los cuenta aparte, porque en silencio su tiempo corre más lento). */
function restanteDelAgente(ag, segmentos, vozAg, desde) {
  let total = 0, silencio = 0;
  for (let j = desde; j < ag.bloques.length; j++) {
    const b = ag.bloques[j], s = segmentos[j];
    if (b.tipo === 'clon' || b.tipo === 'fondo') continue;
    if (b.tipo === 'silencio') {
      const ms = (b.segundos ?? SILENCIO_S) * 1000;
      total += ms; silencio += ms; continue;
    }
    const son = s?.sonido ? buscarSonido(s.sonido) : null;
    if (son) { total += duracionMs(son) + RESPIRO_MS; continue; }
    if (!s?.texto) continue;
    const mp3 = s.sin_voz ? null : (vozAg.get(s.texto) ?? null);
    total += Math.round((duracionMs(mp3) || duracionEstimada(s.texto)) / Math.max(0.25, velocidad)) + RESPIRO_MS;
  }
  return { total, silencio };
}

/** Espera un comando. PAUSA no devuelve: congela aquí hasta el siguiente. */
async function esperar(msg = '[ENTER o AVANZAR en el celular]', plan = 0) {
  if (typeof plan === 'number') plan = plan > 0 ? { fijoMs: plan } : {};
  const nunca = new Promise(() => {});
  let porTeclado = nunca;
  if (tecladoVivo) {
    try { porTeclado = rl.question('\n' + msg + ' ').then(() => 'avanzar', () => nunca); }
    catch { tecladoVivo = false; porTeclado = nunca; }
  } else {
    console.log('\n' + msg + '  (sin teclado: espera al celular)');
  }
  // ── el reloj de este bloque: se acumula, nunca se reinicia ──
  let sonado = 0;          // ms de voz (a 1×) o de espera fija ya transcurridos
  let respirado = 0;       // ms de respiro ya transcurridos tras el fin real
  let finReal = false;     // la pantalla avisó que la voz terminó
  let ultimo = Date.now();
  const contar = () => {
    const ahora = Date.now();
    if (!enPausa) {
      const dt = ahora - ultimo;
      if (finReal) respirado += dt;
      else sonado += dt * (plan.vozMs ? velocidad : 1);
    }
    ultimo = ahora;
  };
  const falta = () => {
    const respiro = plan.despuesMs ?? (plan.vozMs ? RESPIRO_MS : 0);
    if (finReal) return Math.max(0, respiro - respirado);
    const margen = plan.token ? MARGEN_FIN_MS : 0;
    if (plan.vozMs) return Math.max(0, (plan.vozMs - sonado) / Math.max(0.25, velocidad)) + respiro + margen;
    if (plan.fijoMs) return Math.max(0, plan.fijoMs - sonado) + respiro + margen;
    return null;     // sin plan: solo espera un botón
  };

  while (true) {
    contar();
    const ctrl = new AbortController();
    // En automático corre además un reloj: gana el que llegue primero.
    const carrera = [porTeclado, esperarCelular(ctrl.signal)];
    let reloj = null;
    const ms = falta();
    if (modoAuto && !enPausa && ms != null) {
      carrera.push(new Promise((r) => { reloj = setTimeout(() => r('__reloj'), ms); }));
    }
    const cmd = (await Promise.race(carrera)) ?? 'avanzar';
    clearTimeout(reloj);
    ctrl.abort();
    contar();

    if (cmd === '__reloj') return 'avanzar';
    // El aviso de la pantalla: "la voz de este bloque terminó". Solo vale el
    // de ESTE bloque (contraseña); los de bloques viejos se descartan.
    if (typeof cmd === 'string' && cmd.startsWith('fin:')) {
      if (plan.token && cmd.slice(4) === String(plan.token) && !finReal) { finReal = true; respirado = 0; }
      continue;
    }
    if (cmd === 'auto')   { modoAuto = true;  console.log('\n  ▶▶ AUTOMÁTICO'); continue; }
    if (cmd === 'manual') { modoAuto = false; console.log('\n  ▐▐ MANUAL'); continue; }
    if (cmd.startsWith?.('velocidad:')) {
      velocidad = Math.min(2, Math.max(0.5, Number(cmd.split(':')[1]) || 1));
      console.log(`\n  ⏩ velocidad ${velocidad.toFixed(2)}×`);
      continue;      // el reloj sigue donde estaba: ya contó lo sonado a la velocidad anterior
    }
    if (cmd === 'pausa') {
      enPausa = !enPausa;
      // NO se emite nada desde aquí: el servidor ya avisó a la pantalla en el
      // instante en que recibió el botón.
      console.log(enPausa ? '\n  ⏸  PAUSA' : '\n  ▶  reanudado');
      continue;      // al reanudar, sigue donde quedó: no vuelve a empezar
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
//
// v16: el tope era de 20 s y gemini-2.5-flash "piensa" antes de responder;
// con un pedido largo eso puede pasar de 20 s. Por eso Eco-Satelital falló
// las 3 veces del 8 y 9 de octubre y sonó el respaldo, sin contexto. Ahora:
//  · se le pide JSON estricto (responseMimeType): no más respuestas rotas,
//  · se le limita el "pensamiento" (GEMINI_PENSAR, 0 = responde directo),
//  · y el tope sube a 45 s: se pide en segundo plano, hay minutos de sobra.
const GEMINI_MS = Number(process.env.GEMINI_MS || 45000);
const GEMINI_PENSAR = Number(process.env.GEMINI_PENSAR ?? 0);

async function llamarGemini(prompt, maxIntentos = Number(process.env.GEMINI_INTENTOS || 2)) {
  for (let i = 0; i < maxIntentos; i++) {
    try {
      const res = await Promise.race([
        ai.models.generateContent({
          model: process.env.GEMINI_MODELO || 'gemini-2.5-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            ...(GEMINI_PENSAR >= 0 ? { thinkingConfig: { thinkingBudget: GEMINI_PENSAR } } : {}),
          },
        }),
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
// ── Textos de Gemini: ajustes (v16) ──
//  TOPE de NATGEO y MEMORIA: tu frase base + lo que agrega Gemini, en total.
//     $env:NATGEO_PALABRAS=60 ; $env:MEMORIA_PALABRAS=60
const TOPE_NATGEO = Number(process.env.NATGEO_PALABRAS || 60);
const TOPE_MEMORIA = Number(process.env.MEMORIA_PALABRAS || 60);
const palabras = (t) => (String(t || '').match(/\S+/g) || []).length;
const sinTildes = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[–—-]/g, ' ').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
/** Lo que Gemini devuelva (lista, texto suelto u otra cosa) → lista de textos. */
const lista = (x) => (Array.isArray(x) ? x : (typeof x === 'string' ? [x] : []))
  .map((t) => (typeof t === 'string' ? t.trim() : '')).filter(Boolean);
/** El nombre sin el artículo inicial: "La frontera…" y "la frontera…" valen igual. */
const nucleo = (nombre) => sinTildes(nombre).replace(/^(el|la|los|las) /, '');

/** El molde del dato orbital: todo es fijo salvo lo que va entre ⟨ ⟩. */
function moldeOrbital({ territorio, rumbo, territorioB, rumboB }) {
  const ubicB = rumboB ? (UBICACION_B_CORTA ? ubicacionCorta(rumboB) : rumboB.territorio_texto) : '';
  return `{SAT_A}, a {ALT_A} kilómetros de altura, sobrevuela ${territorio.nombre}, ${rumbo.territorio_texto}. ⟨CONTEXTO A⟩ ${rumbo.rumbo_texto} está ${rumbo.estado_marca}.`
    + (territorioB && rumboB
      ? ` Y {SAT_B}, a {ALT_B} kilómetros, sobrevuela ${territorioB.nombre}, ${ubicB}. ⟨CONTEXTO B⟩ ${rumboB.rumbo_texto} está ${rumboB.estado_marca}.`
      : '');
}
const hechosDe = (t) => (t.contexto_voz ? `"${t.contexto_voz}" (más detalle: ${t.contexto})` : t.contexto);

/**
 * ¿El dato orbital cumple? Devuelve la lista de lo que FALTA (vacía = bien).
 * Lo que no puede faltar nunca: los nombres de tus dos territorios TAL CUAL,
 * las dos marcas de satélite y las dos frases de rumbo.
 */
function faltasOrbital(texto, { territorio, territorioB }) {
  const t = sinTildes(texto), faltan = [];
  if (!t.includes(nucleo(territorio.nombre))) faltan.push(`el nombre "${territorio.nombre}"`);
  if (territorioB && !t.includes(nucleo(territorioB.nombre))) faltan.push(`el nombre "${territorioB.nombre}"`);
  if (!/[{[]\s*SAT[_\s-]?A\s*[}\]]/i.test(texto)) faltan.push('la marca {SAT_A}');
  if (territorioB && !/[{[]\s*SAT[_\s-]?B\s*[}\]]/i.test(texto)) faltan.push('la marca {SAT_B}');
  if ((texto.match(/PROTOUSUARIO desde/gi) || []).length < (territorioB ? 2 : 1)) faltan.push('las frases de rumbo');
  if (/⟨|CONTEXTO [AB]/.test(texto)) faltan.push('rellenar los ⟨CONTEXTO⟩');
  return faltan;
}

/** Tu frase base + la continuación de Gemini, sin pasar del tope de palabras. */
function unirConBase(base, cont, tope, tipo) {
  const b = String(base || '').trim();
  let c = String(cont || '').trim();
  // Si Gemini repitió tu frase al principio, se le quita.
  if (b && c && sinTildes(c).startsWith(sinTildes(b).slice(0, 40))) c = c.slice(Math.min(c.length, b.length)).trim();
  if (tipo === 'memoria') c = c.split(/(?<=[.!?…])\s+/).filter((f) => !/julio\s+urbina|mowgli/i.test(f)).join(' ');
  const libre = b ? tope - palabras(b) : tope;
  if (libre < 4 || !c) return b;
  c = recortarA(c, libre);
  return c ? (b ? b + '\n' + c : c) : b;
}
/** Recorta a N palabras por frases enteras (nunca a media frase si se puede). */
function recortarA(texto, max) {
  if (palabras(texto) <= max) return texto;
  const frases = texto.split(/(?<=[.!?…])\s+/);
  let out = '';
  for (const f of frases) {
    const cand = out ? out + ' ' + f : f;
    if (palabras(cand) > max) break;
    out = cand;
  }
  if (out) return out;
  const w = texto.match(/\S+/g).slice(0, max).join(' ').replace(/[,;:]$/, '');
  return w + '…';
}

// ═══════════════════════════════════════════════════════════════════════
//  UNA SOLA LLAMADA POR AGENTE — devuelve todos sus huecos de golpe
// ═══════════════════════════════════════════════════════════════════════
function promptDeAgente({ ficha, bloques, territorio, rumbo, territorioB, rumboB, marco, nOrb, nat, mem }) {
  // Gemini ve TODA la partitura del agente para saber qué está narrando y en
  // qué momento entra cada pieza. Pero los actos son intocables.
  let kN = 0, kM = 0;
  // ── LO ÍNTIMO NO VIAJA A GEMINI (v17) ──
  // El texto TAL CUAL del autor (@NATGEO / @MEMORIA TAL CUAL) y TODO lo que
  // suena bajo un @FONDO (hoy: el pasaje de María, de "Recuerdo cuando conocí
  // a María Luisa" a "Te voy a extrañar Lu.") no se le muestra a Gemini: no lo
  // lee, no lo cita, no puede bromear con él. Los huecos que Gemini SÍ tiene
  // que llenar se siguen marcando (sin texto).
  const privado = new Set();
  let bajoFondo = false;
  bloques.forEach((b, i) => {
    if (b.tipo === 'fondo') { bajoFondo = b.accion === 'iniciar'; return; }
    if (bajoFondo || ((b.tipo === 'narracion' || b.tipo === 'memoria') && !b.gemini)) privado.add(i);
    if (b.cortarFondo) bajoFondo = false;
  });
  const partitura = bloques.map((b, i) => {
    if (privado.has(i) && !b.gemini) return '';
    if (b.tipo === 'prompt') return `${i + 1}. [ACCIÓN DEL CUERPO] ${b.texto}`;
    if (b.tipo === 'pregunta') return `${i + 1}. [PREGUNTA AL MICRÓFONO] ${b.texto}`;
    if (b.tipo === 'id_agente') return `${i + 1}. [TU PRESENTACIÓN, ya escrita]`;
    if (b.tipo === 'orbital') return `${i + 1}. [AQUÍ VA TU dato_orbital]`;
    if (b.tipo === 'narracion' && b.gemini) return `${i + 1}. [AQUÍ VA TU narracion Nº${++kN}]`;
    if (b.tipo === 'memoria' && b.gemini) return `${i + 1}. [AQUÍ VA TU memoria Nº${++kM}]`;
    if (b.tipo === 'narracion' || b.tipo === 'memoria') return `${i + 1}. [${b.tipo.toUpperCase()} DEL AUTOR, ya escrita] ${b.texto}`;
    return '';
  }).filter(Boolean).join('\n');

  const huecosTexto = (lista, tipo) => lista.map((h, k) => h.base
    ? `   Nº${k + 1}: CONTINÚA esta frase base del autor (se dirá en voz alta JUSTO ANTES de tu texto; NO la repitas, NO la cambies):\n      "${h.base.replace(/\n/g, ' / ')}"\n      Tu continuación: UN párrafo de MÁXIMO ${Math.max(4, h.tope - palabras(h.base))} palabras, que siga el hilo de esa frase.`
    : `   Nº${k + 1}: (sin frase base) UN párrafo de MÁXIMO ${h.tope} palabras sobre lo que acaba de pasar en la partitura.`).join('\n');

  const SENCILLO = `   LENGUAJE: palabras SENCILLAS, de todos los días, y frases cortas. Que se entienda a la primera, dicho en voz alta en un patio con gente. PROHIBIDAS las palabras rebuscadas, académicas o técnicas (como "calibración", "protocolo", "entidad", "biomasa", "paradigma", "dinámica", "asimilación", "efigie", "membranas cefálicas").
   COMO UNA IA QUE SUELTA DATOS MEDIO AL AZAR: mete UN dato concreto — una cifra, una hora, una medida, un porcentaje, un conteo — aunque parezca fuera de lugar.`;

  return `Eres AGENTE-ESPEJO, híbrido entre clon virtual y agente de IA, en una performance en vivo en el Patio de las Artes del Ministerio de Cultura del Perú, en Lima. PROTOUSUARIO es tu servidor humano en escena; el público está presente, con máscaras de especies.

AGENTE ACTIVO: ${ficha.agente} — ${ficha.caracter}
SESGO: ${ficha.sesgo_manifiestos}
${marco ? `\nOPERACIÓN CONCEPTUAL DE ESTE PASAJE (ejecútala en el tono de lo que escribas; NO la expliques, NO la nombres, NO cites autores):\n${marco.operacion}\n` : ''}
PARTITURA COMPLETA DE ESTE AGENTE (el orden real de la escena):
${partitura}

REGLA ABSOLUTA: las líneas [ACCIÓN DEL CUERPO], [PREGUNTA AL MICRÓFONO] y lo escrito por el autor NO se reescriben, NO se citan, NO se resumen. Tu trabajo es rellenar SOLO los huecos.

ESCRIBE:
${nOrb ? `
1) "dato_orbital": ${nOrb} texto(s). Cada uno sigue ESTE MOLDE, palabra por palabra en todo lo que NO está entre ⟨ ⟩:

   ${moldeOrbital({ territorio, rumbo, territorioB, rumboB })}

   · Las marcas {SAT_A}, {ALT_A}${territorioB ? ', {SAT_B}, {ALT_B}' : ''} van TAL CUAL, con llaves: el sistema pondrá en vivo el satélite real que esté encima en ese momento. Nunca inventes satélites.
   · Los nombres de los territorios van TAL CUAL, completos. PROHIBIDO cambiarlos por eufemismos, metáforas o descripciones ("el sector de extracción", "el perímetro de contención", "la herida abierta"): el público tiene que oír el NOMBRE.
   · ⟨CONTEXTO A⟩${territorioB ? ' y ⟨CONTEXTO B⟩' : ''}: una o dos frases sobre lo que pasa HOY en ese territorio, con hechos concretos (quién, qué, para qué), en palabras sencillas. Puede llevar el tono y la ironía del agente, pero el hecho tiene que oírse claro.
     Hechos de ${territorio.nombre}: ${hechosDe(territorio)}${territorioB ? `
     Hechos de ${territorioB.nombre}: ${hechosDe(territorioB)}` : ''}${territorioB && rumboB && rumboB.estado !== rumbo.estado ? `
   · El estado CAMBIA entre un territorio y el otro: que se note ese desplazamiento de autoridad en el ⟨CONTEXTO B⟩.` : ''}
   · Puedes empezar con UNA frase corta de entrada antes de {SAT_A} (máximo 8 palabras). No agregues nada más fuera del molde.
   · Largo total: ${territorioB ? ORBITAL_PALABRAS : ORBITAL_PALABRAS_UNO} palabras.
   · PROHIBIDO nombrar cualquier país, océano o región que no sean tus territorios.
` : ''}${nat.length ? `
2) "narracion": ${nat.length} texto(s). VOZ DE NARRADOR DE DOCUMENTAL DE NATURALEZA (estilo National Geographic): describe a PROTOUSUARIO como a una especie animal que observa, grave y pausado, con humor seco. Sigue lo que acaba de pasar en la partitura.
${huecosTexto(nat, 'narracion')}
${SENCILLO}
   PROHIBIDO dar órdenes, dirigirse al público y decir arte, obra, performance, prompt, algoritmo, inteligencia artificial o IA.
` : ''}${mem.length ? `
3) "memoria": ${mem.length} texto(s). RECUERDOS ÍNTIMOS de la vida del autor, rescatados de sus apps, chats, fotos y notas de voz, dichos en primera persona por su clon. Detalles cotidianos y concretos: una hora, una calle de Lima, un mensaje, una canción, un precio. Sin nombres propios de personas. NUNCA "Julio Urbina" ni "Mowgli".
${huecosTexto(mem, 'memoria')}
${SENCILLO}
` : ''}
Al performer llámalo siempre PROTOUSUARIO.

Devuelve SOLO este JSON:
{ "dato_orbital": [${Array(nOrb).fill('"..."').join(', ')}], "narracion": [${Array(nat.length).fill('"..."').join(', ')}], "memoria": [${Array(mem.length).fill('"..."').join(', ')}] }
(En "narracion" y "memoria" va SOLO tu continuación, sin la frase base.)`;
}

/**
 * Asegura el dato orbital: si a lo de Gemini le falta algo esencial, le pide
 * UNA corrección; si aún falla, usa el respaldo (con contexto). Nunca sale un
 * dato orbital sin el nombre de tus territorios.
 */
async function asegurarOrbital(textos, nOrb, ctx) {
  const salida = [];
  for (let k = 0; k < nOrb; k++) {
    let t = textos[k] ?? '';
    let faltan = t ? faltasOrbital(t, ctx) : ['todo'];
    if (t && faltan.length && !SIN_GEMINI) {
      console.warn(`    ⚠ al dato orbital le falta ${faltan.join(', ')}: se pide corrección.`);
      try {
        const r = await llamarGemini(`Corrige este dato orbital de una performance. Le falta: ${faltan.join(', ')}.

Reescríbelo siguiendo EXACTAMENTE este molde, palabra por palabra en todo lo que NO está entre ⟨ ⟩ (las marcas con llaves van tal cual):
${moldeOrbital(ctx)}

En cada ⟨CONTEXTO⟩, una o dos frases con hechos concretos y palabras sencillas. Hechos de ${ctx.territorio.nombre}: ${hechosDe(ctx.territorio)}${ctx.territorioB ? `. Hechos de ${ctx.territorioB.nombre}: ${hechosDe(ctx.territorioB)}` : ''}.
Conserva el tono del texto original:
"${t}"

Devuelve SOLO: { "dato_orbital": "..." }`, 1);
        const c = lista(r?.dato_orbital)[0] ?? '';
        if (c && !faltasOrbital(c, ctx).length) { t = c; faltan = []; console.log('    ✓ corregido.'); }
      } catch (e) { console.warn(`    ⚠ la corrección falló (${e.message}).`); }
    }
    if (!t || faltan.length) {
      if (t) console.warn('    ⚠ sigue incompleto: entra el respaldo, con el contexto de cada territorio.');
      t = orbitalDeRespaldo(ctx);
    }
    salida.push(t);
  }
  return salida;
}

// ═══════════════════════════════════════════════════════════════════════
//  FUNCIÓN
// ═══════════════════════════════════════════════════════════════════════
const GRUPO = process.env.GRUPO_SATELITAL || 'active';
// Bloques que no se dicen: marcas de escena.
const SIN_VOZ_TIPOS = ['sonido', 'silencio', 'clon', 'fondo'];
/**
 * QUÉ VOZ dice cada bloque (la MISMA regla que prerender_voz.js, para que lo
 * pregrabado se encuentre):
 *   VOZ_IA    → @ORBITAL, @NATGEO, @MEMORIA (escritas por Gemini, por ti, o
 *               mitad y mitad) y los textos congelados con "="
 *   VOZ_AUTOR → todo lo demás: @ID, @PROMPT, @PREGUNTA, preludio y cierre
 * Así tu memoria de María suena con la voz de la máquina, como pediste.
 */
function vozDe(b) {
  if (b.gemini || b.fijado || ['orbital', 'narracion', 'memoria'].includes(b.tipo)) return VOZ_IA;
  return VOZ_AUTOR;
}
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
  const huecos = ag.bloques.filter((b) => b.gemini);
  const nOrb = huecos.filter((b) => b.tipo === 'orbital').length;
  // NATGEO y MEMORIA: cada hueco lleva (o no) tu frase base y su tope total.
  const nat = huecos.filter((b) => b.tipo === 'narracion').map((b) => ({ base: b.base ?? '', tope: TOPE_NATGEO }));
  const mem = huecos.filter((b) => b.tipo === 'memoria').map((b) => ({ base: b.base ?? '', tope: TOPE_MEMORIA }));
  let gen = { dato_orbital: [], narracion: [], memoria: [] };
  // `marco` se declara aquí y no dentro del try (era el "marco is not defined").
  const marco = huecos.length ? elegirMarco(ag.id) : null;
  if (marco) console.log(`    marco teórico: ${marco.id}`);
  const ctx = { territorio, rumbo, territorioB, rumboB };
  if (huecos.length && !SIN_GEMINI) {
    const t0 = Date.now();
    try {
      const r = await llamarGemini(promptDeAgente({ ficha, bloques: ag.bloques, ...ctx, marco, nOrb, nat, mem }));
      gen = { dato_orbital: lista(r?.dato_orbital), narracion: lista(r?.narracion), memoria: lista(r?.memoria) };
      console.log(`  Gemini (${((Date.now() - t0) / 1000).toFixed(1)} s): ${gen.dato_orbital.length} orbital · ${gen.narracion.length} narración · ${gen.memoria.length} memoria`);
    } catch (e) {
      console.warn(`  ⚠ GEMINI CAÍDO (${e.message}) — respaldo local, la función sigue.`);
    }
  }
  // El dato orbital SIEMPRE nombra tus dos territorios (ver asegurarOrbital).
  gen.dato_orbital = await asegurarOrbital(gen.dato_orbital, nOrb, ctx);
  for (const t of gen.dato_orbital) {
    console.log(`    dato orbital: ${palabras(t)} palabras (pedidas: ${territorioB ? ORBITAL_PALABRAS : ORBITAL_PALABRAS_UNO})`);
  }
  // NATGEO y MEMORIA: tu frase base, SIEMPRE, + la continuación de Gemini.
  // Si Gemini falla, suena tu frase sola: nunca más un hueco vacío.
  gen.narracion = nat.map((h, k) => unirConBase(h.base, gen.narracion[k], h.tope, 'narracion'));
  gen.memoria = mem.map((h, k) => unirConBase(h.base, gen.memoria[k], h.tope, 'memoria')
    || (k === 0 ? 'Recuerdo una avenida a esta misma hora, y no recuerdo si la crucé yo.' : ''));
  for (const [tipo, l] of [['natgeo', gen.narracion], ['memoria', gen.memoria]]) {
    for (const t of l) console.log(`    ${tipo}: ${palabras(t)} palabras`);
  }

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
      sin_voz: !!b.sin_voz || SIN_VOZ_TIPOS.includes(b.tipo),
      gemini: !!b.gemini,
      voz: vozDe(b),
      sonido: b.sonido ?? null,
      figura: b.figura ?? null,
      cortarFondo: !!b.cortarFondo,
      fondo: b.tipo === 'fondo' ? { accion: b.accion, archivo: b.archivo, volumen: b.volumen, bucle: b.bucle } : null,
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
      .map((x) => ({ texto: x.texto, cual: x.voz })),
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

/** Respaldo del dato orbital: el molde con el contexto corto de cada territorio. */
function orbitalDeRespaldo({ territorio, rumbo, territorioB, rumboB }) {
  const ctx = (t) => (t?.contexto_voz ? ` ${t.contexto_voz.trim().replace(/^./, (c) => c.toUpperCase())}` : '');
  const ubicB = rumboB ? (UBICACION_B_CORTA ? ubicacionCorta(rumboB) : rumboB.territorio_texto) : '';
  return `{SAT_A}, a {ALT_A} kilómetros de altura, sobrevuela ${territorio.nombre}, ${rumbo.territorio_texto}.${ctx(territorio)} ${rumbo.rumbo_texto} está ${rumbo.estado_marca}.`
    + (territorioB && rumboB
      ? ` Y {SAT_B}, a {ALT_B} kilómetros, sobrevuela ${territorioB.nombre}, ${ubicB}.${ctx(territorioB)} ${rumboB.rumbo_texto} está ${rumboB.estado_marca}.`
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

// ═══════════════════════════════════════════════════════════════════════════
//  FONDO — música debajo de la voz (@FONDO archivo [volumen%] … @FONDO FIN)
//  Se gobierna por RANGOS, no por marcas sueltas: para cada bloque se sabe si
//  "aquí debe sonar la canción". Así, si saltas con ATRÁS, AVANZAR o tocando
//  una línea, la música se enciende o se apaga según donde caigas.
//  El corte seco en la última palabra lo hace la pantalla: el bloque que
//  lleva el corte avisa "terminó mi voz" y en ese instante se calla.
// ═══════════════════════════════════════════════════════════════════════════
const FONDO_VOLUMEN = Number(process.env.FONDO_VOLUMEN || 22) / 100;
let fondoSonando = null;
/** Para cada índice de una lista de bloques: el fondo que debe sonar ahí (o null). */
function rangosDeFondo(bloques, prefijo) {
  const en = []; let actual = null;
  bloques.forEach((b, k) => {
    if (b.tipo === 'fondo') {
      if (b.accion === 'iniciar') {
        const archivo = buscarSonido(b.archivo);
        if (!archivo) console.warn(`    ⚠ @FONDO: no encuentro "${b.archivo}" en "sonidos externos/"`);
        actual = archivo ? { id: `${prefijo}#${k}`, archivo,
          volumen: b.volumen != null ? b.volumen / 100 : FONDO_VOLUMEN, bucle: b.bucle !== false } : null;
      } else actual = null;
    }
    en[k] = actual;
    if (b.cortarFondo) actual = null;     // termina con la voz de este bloque
  });
  return en;
}
async function sincronizarFondo(f) {
  if (f && fondoSonando !== f.id) {
    fondoSonando = f.id;
    console.log(`  ♫ fondo: ${f.archivo} (${Math.round(f.volumen * 100)} %)`);
    await emitirFondo({ accion: 'iniciar', ...f });
  } else if (!f && fondoSonando) {
    fondoSonando = null;
    await emitirFondo({ accion: 'parar', fade: 300 });
  }
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

// ═══════════════════════════════════════════════════════════════════════════
//  ENSAYO DESDE CUALQUIER PUNTO (v17)
//    node --env-file=.env scripts\correr_performance.js --desde "conocí a María"
//    node --env-file=.env scripts\correr_performance.js --desde Quimera
//    node --env-file=.env scripts\correr_performance.js --desde cierre
//  Busca ese pedazo de texto (sin importar tildes ni mayúsculas) en el
//  preludio, los agentes y el cierre, y empieza AHÍ: no suena el preludio ni
//  los agentes anteriores, y Gemini no gasta tiempo en ellos. Si cae dentro
//  de un @FONDO, la canción entra igual. Vale SOLO para esa vez: no queda
//  guardado en la ventana. Con ▶ EMPEZAR del celular siempre es la obra entera.
// ═══════════════════════════════════════════════════════════════════════════
const DESDE_TXT = (() => {
  const a = process.argv.slice(2);
  const k = a.findIndex((x) => x === '--desde' || x.startsWith('--desde='));
  if (k < 0) return null;
  const v = a[k].includes('=') ? a[k].slice(a[k].indexOf('=') + 1) : a.slice(k + 1).join(' ');
  return v.replace(/^["']|["']$/g, '').trim() || null;
})();
const normalDesde = (x) => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[¿?¡!.,;:"«»()]/g, ' ').replace(/\s+/g, ' ').trim();
function resolverDesde(q) {
  const n = normalDesde(q);
  if (!n) return null;
  if (n === 'preludio' || n === 'inicio') return { zona: 'preludio', i: 0, donde: 'PRELUDIO' };
  if (n === 'cierre') return { zona: 'cierre', i: 0, donde: 'CIERRE' };
  for (let a = 0; a < GUION.agentes.length; a++) {
    const ag = GUION.agentes[a];
    const nombres = [ag.id, ag.nombre].map(normalDesde);
    if (nombres.some((x) => x === n || x.split(/[\s-]+/).includes(n))) return { zona: 'agente', idx: a, i: 0, donde: ag.nombre };
  }
  const pars = PRELUDIO?.parrafos ?? [];
  for (let i = 0; i < pars.length; i++) if (normalDesde(pars[i]).includes(n)) return { zona: 'preludio', i, donde: 'PRELUDIO' };
  for (let a = 0; a < GUION.agentes.length; a++) {
    const bl = GUION.agentes[a].bloques;
    for (let i = 0; i < bl.length; i++) {
      if (normalDesde(bl[i].texto).includes(n) || normalDesde(bl[i].base).includes(n)) {
        return { zona: 'agente', idx: a, i, donde: GUION.agentes[a].nombre };
      }
    }
  }
  const ci = Array.isArray(GUION.cierre) ? GUION.cierre : [];
  for (let i = 0; i < ci.length; i++) if (normalDesde(ci[i].texto).includes(n)) return { zona: 'cierre', i, donde: 'CIERRE' };
  return undefined;
}
const DESDE = DESDE_TXT ? resolverDesde(DESDE_TXT) : null;
if (DESDE_TXT && !DESDE) {
  console.error(`\n✖ --desde: no encuentro «${DESDE_TXT}» en la partitura.`);
  console.error('  Prueba con un pedazo más corto de la frase, o con: Donald, Eco, Quimera, cierre.\n');
  process.exit(1);
}

async function funcion() {
  if (DESDE) {
    console.log('\n' + '▷'.repeat(72));
    console.log(`  ENSAYO · empieza en ${DESDE.donde}, bloque ${DESDE.i + 1}  («${DESDE_TXT}»)`);
    console.log('  Para la función de verdad: sin --desde, o ▶ EMPEZAR en el celular.');
    console.log('▷'.repeat(72));
  }
  console.log('\n' + '='.repeat(72));
  console.log('  PROTOUSUARIO · Patio de las Artes · MINCUL, Lima');
  console.log(`  ${GUION.agentes.length} agentes · ${GUION.agentes.reduce((s, a) => s + a.bloques.length, 0)} bloques`);
  console.log('  AVANZAR = siguiente bloque · PAUSA congela · DERIVA = pasaje final');
  console.log('='.repeat(72));
  // El agente 1 empieza a prepararse AHORA, antes de que suene una sola
  // palabra. Para cuando termine el preludio, ya estará listo.
  const preparado = [];
  // Con --desde se prepara el agente donde empieza el ensayo (no el 1).
  const primero = DESDE?.zona === 'agente' ? DESDE.idx
    : DESDE?.zona === 'cierre' ? GUION.agentes.length : 0;
  let arranqueI = DESDE?.zona === 'agente' ? DESDE.i : 0;
  if (GUION.agentes[primero]) preparado[0] = lanzar(GUION.agentes[primero]);

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
  if (hayPreludio && process.env.SIN_PRELUDIO !== '1' && (!DESDE || DESDE.zona === 'preludio')) {
    // El compilador ya deja los párrafos partidos; si no, se parten aquí.
    const parrafos = (PRELUDIO.parrafos?.length ? PRELUDIO.parrafos
      : PRELUDIO.texto.split(/\n+/)).map((t) => t.trim()).filter(Boolean);
    console.log('\n' + '─'.repeat(72));
    console.log(`  PRELUDIO  (${parrafos.length} párrafos)`);
    console.log('─'.repeat(72));
    await emitirAfecto('LIMINAL');
    const vozPre = await vozLote(parrafos.map((t) => ({ texto: t, cual: VOZ_AUTOR })), { etiqueta: 'preludio' });
    await emitirSecuencia(parrafos.map((t) => ({ tipo: 'narracion', texto: t })), { agente: 'PRELUDIO' });
    // @CLON escritos dentro del preludio (los guarda compilar_guion.js en
    // preludio.json → clon): cada uno sale justo antes de su párrafo.
    const clonesPre = Array.isArray(PRELUDIO.clon) ? PRELUDIO.clon : [];
    for (let i = DESDE?.zona === 'preludio' ? DESDE.i : 0; i < parrafos.length; i++) {
      for (const c of clonesPre) {
        if (c.antes !== i) continue;
        console.log(`\n  ◐ CLON → ${c.figura} (${c.segundos ?? 12} s)`);
        await emitirClon(c.figura, c.segundos ?? 12);
      }
      console.log(`\n  [${i + 1}/${parrafos.length}] PRELUDIO`);
      console.log('  ' + parrafos[i].replace(/(.{88})/g, '$1\n  '));
      const mp3Pre = vozPre.get(parrafos[i]) ?? null;
      if (i === parrafos.length - 1) adelantarOrbital(0);
      const tokenPre = nuevaContrasena();
      await emitirPreludio(parrafos[i], mp3Pre, { token: tokenPre, dur: duracionMs(mp3Pre) || duracionEstimada(parrafos[i]) });
      await informarControl({ agente: 'PRELUDIO', progreso: `${i + 1}/${parrafos.length}` });
      const cmd = await esperar(`[preludio ${i + 1}/${parrafos.length}] AVANZAR`,
                                planDeVoz(parrafos[i], mp3Pre, tokenPre));
      if (cmd === 'repetir') i--;
      else if (cmd === 'retroceder') i = Math.max(-1, i - 2);
      else if (typeof cmd === 'string' && cmd.startsWith('ir:')) {
        const d = Number(cmd.slice(3));
        if (Number.isFinite(d) && d >= 0 && d < parrafos.length) i = d - 1;
      }
    }
    // un @CLON escrito después del último párrafo sale al terminar el preludio
    for (const c of clonesPre) if (c.antes >= parrafos.length) await emitirClon(c.figura, c.segundos ?? 12);
  }

  // ── ADELANTARSE ──
  // El agente 1 se prepara mientras suena el preludio; el 2 mientras corre el
  // 1; y así. Cuando le toca a cada uno, ya está todo pedido y grabado.
  let enCamino = preparado[0] ?? (GUION.agentes[primero] ? lanzar(GUION.agentes[primero]) : null);

  for (let idx = primero; idx < GUION.agentes.length; idx++) {
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
      const fondoEn = rangosDeFondo(ag.bloques, ag.id);
      try {

      // ── Recorrer la partitura, bloque a bloque ──
      // (con --desde, el primer agente arranca en el bloque elegido)
      const i0 = arranqueI; arranqueI = 0;
      if (i0) console.log(`\n  ▷ ensayo: se empieza en el bloque ${i0 + 1}`);
      for (let i = i0; i < ag.bloques.length; i++) {
        const b = ag.bloques[i];
        const seg = segmentos[i];

        // ── DISPARADORES DEL SATÉLITE EN VIVO ──
        if (prep.indicesVivos.length && !prep.orbitalVivo && i >= prep.io - ANTICIPO_ORBITAL) {
          fijarOrbitalEnVivo(prep, { motivo: `(${Math.max(0, prep.io - i)} bloques antes de decirlo)` });
        }
        if (i === ag.bloques.length - 1) adelantarOrbital(idx + 1);

        // ── FONDO: ¿debe sonar la canción en este bloque? ──
        await sincronizarFondo(fondoEn[i]);
        if (b.tipo === 'fondo') continue;          // la marca no se espera

        // ── @CLON: el rostro cambia, la escena no se detiene ──
        if (b.tipo === 'clon') {
          let extra = {}, nota = '';
          if (b.hasta_fin) {
            const r = restanteDelAgente(ag, segmentos, vozAg, i + 1);
            extra = { hasta: Math.round(r.total / 100) / 10, silencio: Math.round(r.silencio / 100) / 10 };
            nota = ` · se pierde hasta el cierre del agente (~${Math.round(r.total / 1000)} s)`;
          }
          console.log(`\n  [${i + 1}/${ag.bloques.length}] ◐ CLON → ${b.figura} (${b.segundos ?? 12} s)${nota}`);
          await emitirClon(b.figura, b.segundos ?? 12, extra);
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
        // Un hueco que quedó vacío (sin frase base y sin Gemini) se salta.
        if (!texto && !son) { console.log('    (vacío: se salta)'); continue; }
        const token = nuevaContrasena();
        const extra = { token, dur: (son ? duracionMs(son) : duracionMs(mp3)) || duracionEstimada(texto),
                        cortarFondo: !!seg.cortarFondo };
        if (b.tipo === 'id_agente') await emitirAgenteId(ag.nombre, texto, mp3, extra);
        else await emitirSegmento(b.tipo, texto, i, mp3, son, extra);

        await informarControl({ agente: ag.nombre, progreso: `${i + 1}/${ag.bloques.length}` });
        // En automático pasa al siguiente cuando la VOZ (o tu sonido) termina
        // de verdad en la pantalla, más el respiro.
        const cmd = await esperar(`[${i + 1}/${ag.bloques.length}] AVANZAR`,
          son ? { fijoMs: duracionMs(son) || 3000, token, despuesMs: RESPIRO_MS } : planDeVoz(texto, mp3, token));
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
      CIERRE.filter((b) => b.texto && !SIN_VOZ_TIPOS.includes(b.tipo))
            .map((b) => ({ texto: b.texto, cual: VOZ_AUTOR })),
      { etiqueta: 'cierre' });

    await emitirSecuencia(CIERRE.map((b) => ({ tipo: b.tipo, texto: b.texto ?? '', sonido: b.sonido ?? null })),
                          { agente: 'CIERRE' });

    const fondoCierre = rangosDeFondo(CIERRE, 'cierre');
    for (let i = DESDE?.zona === 'cierre' ? DESDE.i : 0; i < CIERRE.length; i++) {
      const b = CIERRE[i];
      await sincronizarFondo(fondoCierre[i]);
      if (b.tipo === 'fondo') continue;
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
      const token = nuevaContrasena();
      await emitirSegmento(b.tipo, b.texto ?? '', i, mp3, son,
        { token, dur: (son ? duracionMs(son) : duracionMs(mp3)) || duracionEstimada(b.texto), cortarFondo: !!b.cortarFondo });

      // La espera: hasta que la voz termine DE VERDAD + el silencio que toque.
      // Tras una PREGUNTA, PAUSA_PREGUNTAS_S; tras el resto, el respiro normal.
      const aire = b.tipo === 'pregunta' ? PAUSA_PREGUNTAS_S * 1000 : RESPIRO_MS;
      const cmd = await esperar(`[cierre ${i + 1}/${CIERRE.length}] AVANZAR`,
        son ? { fijoMs: duracionMs(son) || 3000, token, despuesMs: aire } : planDeVoz(b.texto, mp3, token, aire));

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

const callarFondo = () => (fondoSonando ? emitirFondo({ accion: 'parar', fade: 600 }) : null);
funcion().then(async () => {
  await callarFondo();
  // La partitura terminó sin deriva (DERIVA_AL_FINAL=0): se cierra limpio.
  console.log('\n\n■  FIN.\n');
  rl.close();
  process.exit(0);
}).catch(async (e) => {
  await callarFondo();
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
