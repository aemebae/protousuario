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
import { emitirPreludio, emitirAgenteId, emitirBloqueOrbital, emitirMemoria,
         emitirPrompt, emitirSatelite, emitirAfecto } from './emitir_evento.js';
import { crearFSMAfectiva, elevacionAProximidad } from './fsm_afectiva.js';

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
const pausa = async (msg = '[ENTER para continuar]') => { await rl.question('\n' + msg + ' '); };

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

// ---------- Prompt de generación ----------
function construirPrompt({ agente, acto, dato, episodio, objetos, accion, semillas, vetadas }) {
  const licencia = LICENCIA_ESPECULATIVA
    ? 'Podés fabular detalles verosímiles e incómodos alrededor de este núcleo, sin contradecirlo.'
    : 'No inventes nada fuera de este núcleo.';
  const web = USAR_BUSQUEDA_WEB
    ? ' Buscá en la web 1-2 hechos ACTUALES y concretos de esta situación y tejelos; si no encontrás nada fiable, usá solo el contexto dado.'
    : '';
  return `Eres AGENTE-ESPEJO, híbrido entre clon virtual y agente de IA, en una performance en vivo. PROTOUSUARIO es tu servidor humano en escena; el público está presente.

AGENTE ACTIVO: ${agente.agente} — ${agente.caracter}.
SESGO DEL AGENTE: ${agente.sesgo_manifiestos}
ACTO ACTUAL: ${acto}

REGISTRO DE VOZ (manifiesto_escenico):
Narración mitológica: hablás como quien ya conoce la odisea completa y solo relata el pasaje que toca. Ironía y humor negro conviven con la crítica seria. Frases que se puedan decir en voz alta de un solo aliento. NUNCA jerga de software ni de oficina digital.

SEMILLAS (marcan ritmo y mundo, NO contenido — prohibido repetir sus acciones, objetos o imágenes; proponé acciones nuevas):
${semillas.map((s, i) => `${i + 1}. ${s.texto}`).join('\n')}

PALABRAS E IMÁGENES YA GASTADAS (prohibido reutilizarlas): ${vetadas.length ? vetadas.join(', ') : 'ninguna todavía'}.

DATOS DUROS DE ESTE MANIFIESTO (no los contradigas):
- Satélite: ${dato.satelite_enunciable ?? dato.satelite} — sobrevuela ahora ${dato.region}. Situación real: ${dato.contexto}.${web}
- Núcleo de memoria (${episodio?.veracidad ?? 'real'}): ${episodio?.resumen ?? 'sin núcleo disponible: la memoria será de 1-2 frases, sin inventar biografía'}. ${licencia}
- Objetos disponibles en escena: ${objetos.map((o) => o.nombre).join('; ')}.
- Acción de repertorio disponible: ${accion?.nombre ?? 'ninguna'}.

REGLAS DE NOMBRES: al performer llamalo siempre PROTOUSUARIO. NUNCA nombres a Julio Urbina, juliourbina ni Mowgli: la memoria se narra como recuerdo PROPIO del agente («Recuerdo...»); la pertenencia de esos datos es implícita, ya se dijo en el Preludio.

Devuelve SOLO este JSON, sin texto fuera de él:
{
  "dato_orbital": "40-80 palabras al público: nombra el satélite y la región; describe su situación política CONCRETA (hechos, no abstracciones) torcida por el sesgo del agente",
  "memoria": "recuerdo en primera persona del agente, íntimo e incómodo, anclado al núcleo dado; 60-140 palabras SOLO si el núcleo da materia — si no, 1-2 frases y ya; prohibido el relleno poético y las preguntas retóricas genéricas",
  "instruccion": "80-160 palabras EN TERCERA PERSONA y en presente ('PROTOUSUARIO se tumba...'): una secuencia de 2 a 4 acciones físicas concretas y realizables con al menos un objeto de la lista nombrado tal cual, narrada como pasaje de una odisea ya escrita; puede cerrar con una pregunta dicha al micrófono; ironía y humor negro bienvenidos; incluye una condición clara de término (duración, conteo o señal)"
}`;
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
    await pausa('[Fin del Preludio — ENTER para continuar]');
  }
  
    const actualizarFSM = crearFSMAfectiva({});

  for (let i = 0; i < MANIFIESTOS_POR_SESION; i++) {
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
      await pausa('[ENTER → dato orbital]');
    }

    const dato = await obtenerDatoOrbital();
    await emitirSatelite(dato);   // el globo muestra ESTE satélite, no otro
    const proximidad = elevacionAProximidad(dato.elevacionDeg ?? -90);
    const { estado: estadoAfectivo, cambio } = actualizarFSM({ proximidad, enTerritorioConflicto: dato.region_real });
    if (cambio) await emitirAfecto(estadoAfectivo);
    const { objetos, accion } = elegirEscena(acto);
    const tags = [...new Set(objetos.flatMap((o) => o.tags))];
    const episodio = elegirEpisodio(tags);
    const semillas = semillasPara(agenteId, acto);
    const vetadas = estado.palabras_recientes;

    console.log(`\n>>> Generando manifiesto ${idx + 1} — ${agente.agente} · acto: ${acto}${dato.simulado ? ' (satélite simulado)' : ''}${USAR_BUSQUEDA_WEB ? ' (con búsqueda web)' : ''}...`);
    const m = await llamarGemini(construirPrompt({ agente, acto, dato, episodio, objetos, accion, semillas, vetadas }));

    console.log('\n' + '─'.repeat(70));
    console.log(`MANIFIESTO ${idx + 1} · ${agente.agente} · ACTO: ${acto.toUpperCase()}`);
    console.log('─'.repeat(70));

    console.log('\n— DATO ORBITAL —\n');
    console.log(m.dato_orbital);
    await emitirBloqueOrbital(m.dato_orbital);
    await pausa();

    console.log('\n— MEMORIA EPISÓDICA —\n');
    console.log(m.memoria);
    await emitirMemoria(m.memoria);
    await pausa();

    console.log('\n— PROMPT —\n');
    console.log(m.instruccion);
    await emitirPrompt(m.instruccion);

    fs.appendFileSync('manifiestos_log.jsonl', JSON.stringify({
      fecha: new Date().toISOString(),
      agente: agenteId,
      acto,
      satelite: dato.satelite,
      region: dato.region,
      simulado: dato.simulado,
      busqueda_web: USAR_BUSQUEDA_WEB,
      episodio_id: episodio?.id ?? null,
      objetos: objetos.map((o) => o.id),
      bloques: m,
    }) + '\n', 'utf8');

    const nuevas = extraerPalabrasClave(`${m.dato_orbital} ${m.memoria} ${m.instruccion}`);
    estado.palabras_recientes = [...new Set([...nuevas, ...estado.palabras_recientes])].slice(0, 24);
    estado.manifiestos_totales++;
    guardarEstado(estado);

    await pausa('[PROTOUSUARIO ejecuta la acción. ENTER cuando termine → siguiente manifiesto]');
  }

  console.log('\n✓ Fin de la sesión. Registro en manifiestos_log.jsonl; estado en estado_performance.json.');
  console.log('  Para una función nueva desde cero (Preludio y Agente IDs otra vez): NUEVA_FUNCION = true.');
  rl.close();
}

funcion().catch((e) => { console.error(e); rl.close(); });
