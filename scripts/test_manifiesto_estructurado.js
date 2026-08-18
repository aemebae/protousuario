// PROTOUSUARIO / AGENTE-ESPEJO — orquestador de ensayo v2
//
// Estructura completa de la obra:
//   PRELUDIO (una sola vez por performance, persistente entre corridas)
//   → por cada manifiesto: AGENTE ID (una sola vez por agente, orden fijo cíclico)
//     → DATO ORBITAL → MEMORIA EPISÓDICA → PROMPT (instrucción en 3ª persona)
// con pausa (ENTER) entre bloques — el ritmo que en performance será la app del celular.
//
// v2 respecto a la versión anterior:
//  - preludio.json (obra) y agentes.json (5 agentes con Agente ID) reemplazan a intros.json
//  - estado_performance.json persiste qué ya sonó (preludio, agente-IDs, contador, léxico usado)
//  - los agentes rotan en orden fijo: donald-prompt → transespecie → eco-satelital → ternura → río
//  - instrucción ("prompt") en TERCERA PERSONA, 80-160 palabras, tono de odisea ya escrita
//  - memoria SIN nombres propios, en primera persona del agente ("Recuerdo...")
//  - anti-repetición: palabras clave de manifiestos anteriores quedan VETADAS (persistente)
//  - USAR_BUSQUEDA_WEB: grounding con Google Search de la API de Gemini (opcional, con degradación)
//  - safetySettings al mínimo bloqueo que permite la API (BLOCK_ONLY_HIGH)
//
// Archivos en la RAÍZ: preludio.json, agentes.json, objetos_escena.json,
// regiones_conflicto.json, episodios.jsonl, corpus/manifiestos_semilla.jsonl
//
// Corre con:  node --env-file=.env scripts/test_manifiesto_estructurado.js

import fs from 'fs';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { GoogleGenAI } from '@google/genai';
import { obtenerDatoOrbital } from './capa2_dato_orbital_v3.js';
import { recuperarPorRecenciaYTags } from './capa3_memoria_episodica.js';
import { emitirPreludio, emitirAgenteId, emitirSegmento,
         emitirSatelite, emitirAfecto, emitirRumbo } from './emitir_evento.js';
// El motor afectivo por proximidad fue reemplazado por el motor de RUMBO:
// AUTORIZADO (el territorio cae en el rumbo propio del agente) / DESPLAZADO.
import { crearMotorRumbo, elegirTerritorio } from './rumbo_territorial.js';
import { construirPrompt, validarSegmentos, segmentosABloques } from './construir_prompt.js';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('\n❌ Falta GEMINI_API_KEY. Corre con:  node --env-file=.env scripts/test_manifiesto_estructurado.js\n');
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey });

// ---------- AJUSTES DE ENSAYO ----------
const NUEVA_FUNCION = false;        // true = resetea estado_performance.json (preludio y Agente IDs vuelven a sonar)
const USAR_BUSQUEDA_WEB = false;    // true = grounding con Google Search en el dato orbital (gasta cupo diario del free tier, sube latencia)
const LICENCIA_ESPECULATIVA = true; // permite fabular alrededor del núcleo real de memoria
const MANIFIESTOS_POR_SESION = 5;   // 5 = un manifiesto por agente, en el orden fijo

// Umbral mínimo de bloqueo que permite la API (reduce rechazos espurios en contenido
// político/corporal legítimo; los límites duros del proveedor siguen existiendo).
const SAFETY = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
].map((category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' }));

// ---------- Cargar datos ----------
const preludio = JSON.parse(fs.readFileSync('preludio.json', 'utf8'));
const { orden, agentes } = JSON.parse(fs.readFileSync('agentes.json', 'utf8'));
const escena = JSON.parse(fs.readFileSync('objetos_escena.json', 'utf8'));
const { regiones } = JSON.parse(fs.readFileSync('regiones_conflicto.json', 'utf8'));
const { marcos } = JSON.parse(fs.readFileSync('corpus_teorico.json', 'utf8'));
const semillasTodas = fs.readFileSync('corpus/manifiestos_semilla.jsonl', 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));

// ---------- Estado persistente de la performance ----------
const ESTADO_PATH = 'estado_performance.json';
function cargarEstado() {
  if (NUEVA_FUNCION || !fs.existsSync(ESTADO_PATH)) {
    return { preludio_reproducido: false, agentes_presentados: [], manifiestos_totales: 0, palabras_recientes: [] };
  }
  return JSON.parse(fs.readFileSync(ESTADO_PATH, 'utf8'));
}
function guardarEstado(e) { fs.writeFileSync(ESTADO_PATH, JSON.stringify(e, null, 2), 'utf8'); }
const estado = cargarEstado();

const rl = readline.createInterface({ input, output });
// ═══════════════════════════════════════════════════════════════════════
//  PAUSA CON DOBLE MANDO: celular O teclado, lo que llegue primero.
//  El celular es el mando principal en escena; ENTER queda como RESPALDO
//  por si el teléfono se cuelga o pierde el wifi a mitad de función.
//  Devuelve el comando recibido: 'avanzar' | 'repetir' | 'saltar_agente' | 'terminar'
// ═══════════════════════════════════════════════════════════════════════
const URL_VISUAL = process.env.URL_VISUAL || 'http://localhost:3000';

async function esperarCelular(señal) {
  try {
    const r = await fetch(`${URL_VISUAL}/control/esperar`, { signal: señal });
    if (!r.ok) return null;
    return (await r.json()).comando;
  } catch { return null; }   // servidor caído: solo queda el teclado
}

const pausa = async (msg = '[ENTER o botón del celular para continuar]') => {
  const ctrl = new AbortController();
  const porTeclado = rl.question('\n' + msg + ' ').then(() => 'avanzar');
  const porCelular = esperarCelular(ctrl.signal);
  const comando = await Promise.race([porTeclado, porCelular]);
  ctrl.abort();                 // cancelar la espera del celular
  return comando ?? 'avanzar';
};

/** Informa al celular en qué punto va la performance. */
async function informarControl(datos) {
  try {
    await fetch(`${URL_VISUAL}/control/estado`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos), signal: AbortSignal.timeout(1200) });
  } catch { /* la pantalla es un extra, nunca frena la función */ }
}

/** Señal para cortar la performance desde el celular. */
class TerminarPerformance extends Error {}
class SaltarAgente extends Error {}

/** Traduce el comando recibido en la acción correspondiente. */
function aplicarComando(cmd) {
  if (cmd === 'terminar') throw new TerminarPerformance();
  if (cmd === 'saltar_agente') throw new SaltarAgente();
  return cmd;
}

// ---------- Anti-repetición léxica ----------
const STOP_ES = new Set(['protousuario', 'satélite', 'satelite', 'público', 'publico', 'agente', 'manifiesto', 'micrófono', 'microfono', 'mientras', 'durante', 'después', 'despues', 'aunque', 'porque', 'también', 'tambien', 'ustedes', 'nosotros', 'entonces', 'todavía', 'todavia', 'siempre', 'ninguna', 'ninguno', 'alguien', 'alguna', 'alguno', 'ahora', 'sobre', 'entre', 'hasta', 'desde', 'donde', 'cuando', 'contra', 'hacia', 'antes', 'luego', 'quien']);
const objetoTokens = new Set(
  escena.objetos.flatMap((o) => o.nombre.toLowerCase().match(/[a-záéíóúñü]{4,}/g) ?? [])
);
function extraerPalabrasClave(texto, n = 10) {
  const crudas = texto.toLowerCase().match(/[a-záéíóúñü]{6,}/g) ?? [];
  const frec = new Map();
  for (const p of crudas) {
    if (STOP_ES.has(p) || objetoTokens.has(p)) continue; // los objetos DEBEN poder nombrarse siempre
    frec.set(p, (frec.get(p) ?? 0) + 1);
  }
  return [...frec.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([p]) => p);
}

// ---------- Selección por patrones ----------
function barajar(arr) { return [...arr].sort(() => Math.random() - 0.5); }

function semillasPara(agenteId, acto, n = 3) {
  const agenteYActo = semillasTodas.filter((s) => s.personaje === agenteId && s.acto === acto);
  const mismoAgente = semillasTodas.filter((s) => s.personaje === agenteId && s.acto !== acto);
  const mismoActo = semillasTodas.filter((s) => s.personaje !== agenteId && s.acto === acto);
  const resto = semillasTodas.filter((s) => s.personaje !== agenteId && s.acto !== acto);
  return [...agenteYActo, ...barajar(mismoAgente), ...barajar(mismoActo), ...barajar(resto)].slice(0, n);
}

function elegirEscena(acto) {
  const objetos = barajar(escena.objetos.filter((o) => o.actos.includes(acto))).slice(0, 2);
  const accion = barajar(escena.acciones.filter((a) => a.actos.includes(acto)))[0] ?? null;
  return { objetos, accion };
}

const episodiosUsados = new Set();
function elegirEpisodio(tags) {
  let candidatos = recuperarPorRecenciaYTags(tags, 5).filter((e) => !episodiosUsados.has(e.id));
  if (candidatos.length === 0) candidatos = recuperarPorRecenciaYTags([], 15).filter((e) => !episodiosUsados.has(e.id));
  if (candidatos.length === 0) return null;
  const elegido = barajar(candidatos)[0];
  episodiosUsados.add(elegido.id);
  return elegido;
}

// ---------- Selección de marco teórico ----------
// UN marco por manifiesto, rotando entre los del agente activo para que no se
// repita ninguno en la sesión. Cumple tres trabajos: enmarca el hecho, elige
// el recuerdo y extiende la orden. (construirPrompt vive ahora en su módulo.)
function elegirMarco(agenteId, usados) {
  const suyos = marcos.filter((m) => (m.agentes ?? []).includes(agenteId));
  if (!suyos.length) return marcos[Math.floor(Math.random() * marcos.length)];
  const frescos = suyos.filter((m) => !usados.includes(m.id));
  const pool = frescos.length ? frescos : suyos;
  return pool[Math.floor(Math.random() * pool.length)];
}

async function llamarGemini(prompt, maxIntentos = 4) {
  let conBusqueda = USAR_BUSQUEDA_WEB;
  let intento = 0;
  while (intento < maxIntentos) {
    try {
      const config = { safetySettings: SAFETY, ...(conBusqueda ? { tools: [{ googleSearch: {} }] } : {}) };
      const res = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt, config });
      const limpio = res.text.trim().replace(/^```json\s*|\s*```$/g, '');
      const match = limpio.match(/\{[\s\S]*\}/);
      return JSON.parse(match ? match[0] : limpio);
    } catch (err) {
      intento++;
      if (conBusqueda) {
        console.warn('  ⚠ Búsqueda web falló — DEGRADADO: reintento sin grounding, solo con regiones_conflicto.json.');
        conBusqueda = false;
      }
      if (intento >= maxIntentos) throw err;
      const espera = Math.min(20000, 1000 * 2 ** intento);
      console.warn(`  Reintentando (${intento}/${maxIntentos}) en ${espera}ms — ${err.message}`);
      await new Promise((r) => setTimeout(r, espera));
    }
  }
}

// ---------- Función principal ----------
async function funcion() {
  if (!estado.preludio_reproducido) {
    console.log('\n' + '='.repeat(70));
    console.log(preludio.titulo.toUpperCase() + ' (fijo — una sola vez por performance):');
    console.log('='.repeat(70) + '\n');
    console.log(preludio.texto);
    await emitirPreludio(preludio.titulo, preludio.texto);
    estado.preludio_reproducido = true;
    guardarEstado(estado);
    aplicarComando(await pausa('[Fin del Preludio — ENTER o celular]'));
  }
  
    const motorRumbo = crearMotorRumbo();
    const marcosUsados = [];

  for (let i = 0; i < MANIFIESTOS_POR_SESION; i++) {
   try {
    const idx = estado.manifiestos_totales;
    const agenteId = orden[idx % orden.length];
    const agente = agentes.find((a) => a.id === agenteId);
    const acto = escena.actos_orden[idx % escena.actos_orden.length];

    if (!estado.agentes_presentados.includes(agenteId)) {
      console.log('\n' + '='.repeat(70));
      console.log(`AGENTE ID (fijo — primera aparición de ${agente.agente}):`);
      console.log('='.repeat(70) + '\n');
      console.log(agente.agente_id_texto);
      await emitirAgenteId(agente.agente, agente.agente_id_texto);
      estado.agentes_presentados.push(agenteId);
      guardarEstado(estado);
      aplicarComando(await pausa('[ENTER o celular → primer segmento]'));
    }

    const dato = await obtenerDatoOrbital();
    await emitirSatelite(dato);   // el globo muestra ESTE satélite, no otro

    // El SATÉLITE elige cuál de los dos territorios del agente se nombra:
    // el más cercano a su punto subsatelital actual.
    const territorio = elegirTerritorio(regiones, agenteId, { lat: dato.lat, lon: dato.lon });
    const rumbo = motorRumbo({ agente, territorio, elevacionDeg: dato.elevacionDeg });
    await emitirRumbo({ estado: rumbo.estado, cardinal: rumbo.cardinal,
                        azimut: rumbo.azimut, rumboAgente: rumbo.rumboAgente });
    await emitirAfecto(agente.estado);   // paleta y tipografía del agente activo

    const marco = elegirMarco(agenteId, marcosUsados);
    marcosUsados.push(marco.id);

    const { objetos, accion } = elegirEscena(acto);
    const tags = [...new Set(objetos.flatMap((o) => o.tags))];
    const episodio = elegirEpisodio(tags);
    const semillas = semillasPara(agenteId, acto);
    const vetadas = estado.palabras_recientes;

    console.log(`\n>>> Generando manifiesto ${idx + 1} — ${agente.agente} · acto: ${acto}${dato.simulado ? ' (satélite simulado)' : ''}${USAR_BUSQUEDA_WEB ? ' (con búsqueda web)' : ''}...`);
    console.log(`    ${territorio.nombre} · ${rumbo.cardinal} ${rumbo.azimut}° · ${rumbo.estado_marca} · marco: ${marco.id}`);
    await informarControl({
      agente: agente.agente,
      territorio: `${territorio.nombre} — ${rumbo.territorio_texto}`,
      estado_marca: rumbo.estado_marca,
      rumbo_texto: rumbo.rumbo_texto,
      progreso: `MANIFIESTO ${i + 1} DE ${MANIFIESTOS_POR_SESION} · ACTO: ${acto.toUpperCase()}`,
    });
    const bruto = await llamarGemini(construirPrompt({
      agente, acto, dato, territorio, rumbo, marco, episodio,
      objetos, accion, semillas, vetadas,
      licenciaEspeculativa: LICENCIA_ESPECULATIVA, usarBusquedaWeb: USAR_BUSQUEDA_WEB,
    }));
    const { segmentos, avisos } = validarSegmentos(bruto);
    if (avisos.length) console.log('    ⚠ ' + avisos.join(' | '));
    const m = segmentosABloques(segmentos);

    console.log('\n' + '─'.repeat(70));
    console.log(`MANIFIESTO ${idx + 1} · ${agente.agente} · ACTO: ${acto.toUpperCase()}`);
    console.log('─'.repeat(70));

    // SECUENCIA ENTRELAZADA: ya no son tres bloques fijos. Los segmentos se
    // alternan para que PROTOUSUARIO pueda EJECUTAR una acción mientras siguen
    // sonando datos orbitales o memoria, en vez de esperar de pie.
    const etiqueta = { orbital: 'DATO ORBITAL', memoria: 'MEMORIA EPISÓDICA',
                       prompt: 'PROMPT', reflexion: '· reflexión ·' };
    for (let k = 0; k < segmentos.length; k++) {
      const seg = segmentos[k];
      console.log(`\n— ${etiqueta[seg.tipo] ?? seg.tipo.toUpperCase()} —\n`);
      console.log(seg.texto);
      await emitirSegmento(seg.tipo, seg.texto, k);
      if (k < segmentos.length - 1) {
        let cmd = aplicarComando(await pausa('[ENTER o celular → siguiente segmento]'));
        while (cmd === 'repetir') {   // volver a decir el segmento actual
          console.log('\n  ↺ repitiendo segmento\n');
          console.log(seg.texto);
          await emitirSegmento(seg.tipo, seg.texto, k);
          cmd = aplicarComando(await pausa('[ENTER o celular → siguiente segmento]'));
        }
      }
    }

    fs.appendFileSync('manifiestos_log.jsonl', JSON.stringify({
      fecha: new Date().toISOString(),
      agente: agenteId,
      acto,
      satelite: dato.satelite,
      region: territorio.nombre,
      region_id: territorio.id,
      cardinal: rumbo.cardinal,
      azimut: rumbo.azimut,
      estado_rumbo: rumbo.estado,
      marco_teorico: marco.id,
      simulado: dato.simulado,
      busqueda_web: USAR_BUSQUEDA_WEB,
      episodio_id: episodio?.id ?? null,
      objetos: objetos.map((o) => o.id),
      bloques: m,
      segmentos,
    }) + '\n', 'utf8');

    const nuevas = extraerPalabrasClave(`${m.dato_orbital} ${m.memoria} ${m.instruccion}`);
    estado.palabras_recientes = [...new Set([...nuevas, ...estado.palabras_recientes])].slice(0, 24);
    estado.manifiestos_totales++;
    guardarEstado(estado);
   } catch (e) {
     if (e instanceof SaltarAgente) {
       console.log('\n  ⏭  AGENTE SALTADO — pasando al siguiente\n');
       estado.manifiestos_totales++;   // avanzar la rotación igual
       guardarEstado(estado);
       continue;
     }
     throw e;   // TerminarPerformance y errores reales suben
   }

    aplicarComando(await pausa('[PROTOUSUARIO ejecuta. ENTER o celular → siguiente manifiesto]'));
  }

  console.log('\n✓ Fin de la sesión. Registro en manifiestos_log.jsonl; estado en estado_performance.json.');
  console.log('  Para una función nueva desde cero (Preludio y Agente IDs otra vez): NUEVA_FUNCION = true.');
  rl.close();
}

funcion().catch((e) => {
  if (e instanceof TerminarPerformance) {
    console.log('\n\n■  PERFORMANCE TERMINADA desde el celular.');
    console.log('   El estado quedó guardado: podés retomar donde ibas.\n');
  } else {
    console.error(e);
  }
  rl.close();
  process.exit(0);
});
