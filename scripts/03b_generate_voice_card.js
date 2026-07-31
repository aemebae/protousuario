// PROTOUSUARIO / AGENTE-ESPEJO — Paper 3, Etapa 2
// Construye la "ficha de voz destilada" por registro vía meta-prompting Tree-of-Thoughts:
// pide 3 versiones a Gemini, que elija la mejor y justifique. TÚ la editas a mano después —
// este script nunca "finaliza" nada, solo produce el borrador (voice_card.json, estado: BORRADOR).
//
// Nunca envía el .jsonl completo a Gemini — solo una muestra curada de ~25 mensajes por registro,
// muestreada a lo largo del TIEMPO y de la LONGITUD para no sesgar la voz hacia una sola
// conversación puntual ni hacia un solo largo de mensaje.
//
// CÓMO CORRERLO (importante):
//   node --env-file=.env 03b_generate_voice_card.js
// El flag --env-file carga tu archivo .env en process.env. Sin él, GEMINI_API_KEY llega vacía
// y el SDK cae al método de credenciales de Google Cloud (ADC) que tú no usas -> error.

import fs from 'fs';
import readline from 'readline';
import { GoogleGenAI } from '@google/genai';

const CORPUS_PATH = 'corpus/private/language_corpus.private.jsonl';
const STATS_PATH = 'language_style_stats.json';
const OUTPUT_PATH = 'voice_card.json';
const MUESTRA_POR_REGISTRO = 25; // dentro del rango 20-30 recomendado en el Paper 3
const UMBRAL_MINIMO_REGISTRO = 30; // por debajo de esto, avisa fusionar registros

// ---------- 0. Autenticación robusta (arregla el error "Could not load the default credentials") ----------
// Pasamos la clave EXPLÍCITAMENTE en vez de new GoogleGenAI({}). Así forzamos la "puerta" de
// API key simple (Gemini Developer API) y nunca se intenta la "puerta" empresarial (Vertex/ADC).
// Y si falta la clave, el script muere de inmediato con un mensaje claro, en vez de reintentar 3
// veces contra un servidor de metadatos que no existe en tu laptop.
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error(
    '\n❌ Falta GEMINI_API_KEY en el entorno.\n' +
    '   Corre así:   node --env-file=.env 03b_generate_voice_card.js\n' +
    '   y confirma que tu archivo .env tiene, literalmente, una línea:\n' +
    '   GEMINI_API_KEY=tu_clave_de_ai_studio\n'
  );
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey });

// ---------- 1. Cargar corpus agrupado por registro ----------
async function cargarCorpusPorRegistro() {
  const porRegistro = {};
  const rl = readline.createInterface({
    input: fs.createReadStream(CORPUS_PATH),
    crlfDelay: Infinity,
  });
  for await (const linea of rl) {
    if (!linea.trim()) continue;
    const msg = JSON.parse(linea);
    const reg = msg.registro || 'sin_registro';
    (porRegistro[reg] ??= []).push(msg);
  }
  return porRegistro;
}

// ---------- 2. Muestreo estratificado por TIEMPO y LONGITUD ----------
// Antes: solo repartía por fecha (una toma por franja temporal). Ahora, dentro de cada franja
// temporal, la posición de longitud rota: corto -> largo -> mediano -> corto... Así la muestra
// cubre a la vez el rango de fechas Y el rango de largos, y la ficha captura tanto tus mensajes
// telegráficos como los expansivos (que en tus stats son mundos aparte: informal ~5.9 palabras
// de media vs analítico ~62). Es el complemento por longitud sobre la base temporal.
function muestrearTiempoYLongitud(mensajes, n) {
  if (mensajes.length <= n) return mensajes;

  const porTiempo = [...mensajes].sort(
    (a, b) => new Date(a.fecha || 0) - new Date(b.fecha || 0)
  );
  const tamCubo = Math.floor(porTiempo.length / n);
  const patronLongitud = ['corto', 'largo', 'mediano']; // rota para garantizar variedad
  const muestra = [];

  for (let i = 0; i < n; i++) {
    const inicio = i * tamCubo;
    const fin = i === n - 1 ? porTiempo.length : inicio + tamCubo;
    const cubo = porTiempo.slice(inicio, fin);
    if (cubo.length === 0) continue;

    const porLongitud = [...cubo].sort(
      (a, b) => contarPalabras(a.texto) - contarPalabras(b.texto)
    );

    const modo = patronLongitud[i % patronLongitud.length];
    let idx;
    if (modo === 'corto') idx = 0;
    else if (modo === 'largo') idx = porLongitud.length - 1;
    else idx = Math.floor(porLongitud.length / 2);

    muestra.push(porLongitud[idx]);
  }
  return muestra;
}

function contarPalabras(texto) {
  return (texto || '').split(/\s+/).filter(Boolean).length;
}

// ---------- 3. Meta-prompt Tree-of-Thoughts ----------
function construirMetaPrompt(registro, muestra, stats) {
  const textos = muestra.map((m, i) => `${i + 1}. "${m.texto}"`).join('\n');
  return `Eres un analista de estilo lingüístico. A continuación tienes ${muestra.length} mensajes reales escritos por la misma persona (Mowgli / Julio Urbina Rey), todos del registro "${registro}".

MENSAJES REALES:
${textos}

ESTADÍSTICAS DURAS DE ESTE REGISTRO (ánclate en ellas, no inventes):
${JSON.stringify(stats?.por_registro?.[registro] ?? {}, null, 2)}

TAREA (Tree-of-Thoughts):
1. Genera TRES descripciones distintas de 2-3 párrafos del estilo de esta persona en este registro
   (tono, sintaxis, muletillas, puntuación, code-switching español/inglés, qué NO hace).
2. Evalúa las tres entre sí: ¿cuál captura patrones concretos y reconocibles en lectura ciega,
   en vez de generalidades que podrían describir a cualquiera?
3. Elige la mejor y justifica en una frase por qué.

Responde SOLO con este JSON, sin texto fuera de él:
{
  "version_1": "...",
  "version_2": "...",
  "version_3": "...",
  "elegida": 1,
  "justificacion": "..."
}`;
}

// ---------- 4. Llamada a Gemini con retry + backoff exponencial (con techo) ----------
// Los 503 "high demand" de Gemini son transitorios del lado de Google, no un bug tuyo.
// 6 intentos con techo de 20s evita esperas absurdas sin rendirse demasiado rápido.
async function llamarGeminiConRetry(prompt, maxIntentos = 6) {
  let intento = 0;
  while (intento < maxIntentos) {
    try {
      const res = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      const limpio = res.text.trim().replace(/^```json\s*|\s*```$/g, '');
      return JSON.parse(limpio);
    } catch (err) {
      intento++;
      if (intento >= maxIntentos) throw err;
      const espera = Math.min(20000, 1000 * 2 ** intento) + Math.random() * 300;
      console.warn(`Reintentando (${intento}/${maxIntentos}) en ${Math.round(espera)}ms — ${err.message}`);
      await new Promise((r) => setTimeout(r, espera));
    }
  }
}

// ---------- 5. Orquestador ----------
// Guarda voice_card.json DESPUÉS DE CADA REGISTRO (no solo al final) y sigue con el
// siguiente registro si uno falla — así un 503 pasajero en un registro no te hace
// perder el trabajo ya logrado en los demás. Vuelve a correr el script y solo
// reintentará los registros que quedaron pendientes (los ya guardados se resaltan).
async function main() {
  const porRegistro = await cargarCorpusPorRegistro();
  const stats = JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
  const fichas = fs.existsSync(OUTPUT_PATH) ? JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8')) : {};

  const pendientes = [];

  for (const [registro, mensajes] of Object.entries(porRegistro)) {
    if (mensajes.length < UMBRAL_MINIMO_REGISTRO) {
      console.warn(`⚠ Registro "${registro}" tiene solo ${mensajes.length} mensajes — considera fusionarlo con un registro afín antes de confiar en su ficha.`);
    }
    const muestra = muestrearTiempoYLongitud(mensajes, MUESTRA_POR_REGISTRO);
    const prompt = construirMetaPrompt(registro, muestra, stats);
    console.log(`\n→ Generando ficha ToT para registro: ${registro} (muestra de ${muestra.length}/${mensajes.length}, variada por tiempo y longitud)`);

    try {
      const resultado = await llamarGeminiConRetry(prompt);
      fichas[registro] = {
        ...resultado,
        generado: new Date().toISOString(),
        n_muestra: muestra.length,
        n_total_disponible: mensajes.length,
        estado: 'BORRADOR — pendiente de edición manual',
      };
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(fichas, null, 2), 'utf8');
      console.log(`  ✓ Guardado en ${OUTPUT_PATH} (registro "${registro}")`);
    } catch (err) {
      console.error(`  ✗ "${registro}" falló tras varios intentos: ${err.message}`);
      pendientes.push(registro);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  if (pendientes.length === 0) {
    console.log('✓ Todos los registros generados correctamente.');
  } else {
    console.log(`⚠ Registros pendientes (Gemini no respondió): ${pendientes.join(', ')}`);
    console.log('  Vuelve a correr el mismo comando — los ya guardados no se repiten,');
    console.log('  solo reintenta estos. Si el 503 persiste, espera unos minutos:');
    console.log('  es un problema temporal de disponibilidad del lado de Google.');
  }
  console.log('\nSiguiente paso (manual, no automatizable): lee cada "version_N" elegida,');
  console.log('edítala con tus propias palabras hasta que "suene a ti" en lectura ciega,');
  console.log('y cambia "estado" a "FINAL" registro por registro cuando estés conforme.');
}

main().catch(console.error);