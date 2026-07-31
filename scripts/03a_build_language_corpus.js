import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();

/**
 * ⚠️ AJUSTA ESTO ANTES DE CORRER EL SCRIPT.
 *
 * Es tu nombre EXACTO tal como aparece en el campo "sender_name"
 * dentro de tus archivos message_1_*.json de Instagram.
 *
 * Cómo encontrarlo: abre cualquier archivo en
 * corpus/private/instagram-messages/ y busca dentro de "messages"
 * un mensaje que sepas que escribiste tú. Copia el valor exacto
 * de "sender_name" (cuidado con acentos/mojibake, cópialo tal cual
 * aparece, este script ya repara el mojibake por dentro).
 */
const MI_NOMBRE_INSTAGRAM = "Julio Urbina";

const CHATGPT_DIR = path.join(ROOT, "corpus", "raw", "chatgpt");
const INSTAGRAM_PRIVATE_DIR = path.join(ROOT, "corpus", "private", "instagram-messages");

const PRIVATE_DIR = path.join(ROOT, "corpus", "private");
const JSONL_OUTPUT = path.join(PRIVATE_DIR, "language_corpus.private.jsonl");
const STATS_OUTPUT = path.join(ROOT, "language_style_stats.json");

// Palabras funcionales muy comunes en español, para separar "muletillas"
// de palabras de contenido al calcular las más frecuentes. Es una lista
// corta a propósito; si más adelante quieres algo más completo, el
// paquete npm "stopword" trae listas más largas en varios idiomas.
const STOPWORDS_ES = new Set([
  "el","la","los","las","un","una","unos","unas","de","del","al","a","en","y",
  "o","que","es","son","se","su","sus","lo","le","les","por","para","con",
  "sin","no","si","mi","tu","yo","tú","él","ella","nos","como","más","pero",
  "ya","muy","esto","eso","esta","este","estos","estas","porque","cuando",
]);

// Términos técnicos en inglés (código, jerga de programación) que se
// cuelan en el registro "analitico" al discutir tu propio código con
// ChatGPT, cuando el código no viene envuelto en comillas triple o es
// una sola palabra suelta (por eso el filtro de camelCase no la agarra:
// "behaviour" sola no tiene ningún cambio de mayúscula que la delate).
// No son tu voz en español; se excluyen solo del ranking de palabras
// frecuentes, no del conteo total de palabras.
const TERMINOS_TECNICOS_NO_VOZ = new Set([
  "the", "and", "for", "from", "with", "this", "that", "true", "false",
  "null", "undefined", "new", "super", "extends", "implements", "import",
  "export", "const", "let", "var", "return", "function", "class",
  "public", "private", "protected", "static", "void", "interface",
  "type", "async", "await", "behaviour", "behavior", "behaviourmanager",
  "behaviormanager",
]);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function fixMojibake(s) {
  if (typeof s !== "string") return s;
  try {
    const fixed = Buffer.from(s, "latin1").toString("utf8");
    return fixed.includes("\uFFFD") ? s : fixed;
  } catch {
    return s;
  }
}

function shortHash(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 8);
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return null;
  return JSON.parse(raw);
}

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".json"))
    .map((e) => path.join(dir, e.name));
}

/**
 * Extrae SOLO tus mensajes de UNA conversación de ChatGPT (un objeto
 * con su propio "mapping"). Filtra estrictamente por
 * author.role === "user": así nunca se mezcla tu voz con la del asistente.
 */
function extractChatGPTUserMessagesFromConversation(conversation, fallbackId) {
  const mapping = conversation?.mapping;
  if (!mapping || typeof mapping !== "object") return [];

  const conversationId = shortHash(
    conversation.conversation_id ?? conversation.title ?? fallbackId
  );
  const out = [];

  for (const node of Object.values(mapping)) {
    const msg = node?.message;
    if (!msg) continue;
    if (msg.author?.role !== "user") continue;

    const parts = msg.content?.parts;
    if (!Array.isArray(parts)) continue;

    const texto = parts.filter((p) => typeof p === "string").join("\n").trim();
    if (!texto) continue;

    out.push({
      texto,
      registro: "analitico",
      fuente: "chatgpt",
      fecha: msg.create_time ? new Date(msg.create_time * 1000).toISOString() : null,
      conversacion_id: conversationId,
    });
  }

  return out;
}

/**
 * Encuentra el arreglo de conversaciones sin importar cómo esté envuelto:
 * - el archivo ES directamente el arreglo;
 * - el arreglo está bajo una clave "conversations";
 * - el archivo ES una sola conversación (tiene su propio "mapping");
 * - último recurso: el primer valor de nivel superior que sea un arreglo.
 */
function findConversationsArray(data) {
  if (Array.isArray(data)) return data;

  if (data && typeof data === "object") {
    if (Array.isArray(data.conversations)) return data.conversations;
    if (data.mapping && typeof data.mapping === "object") return [data];

    for (const value of Object.values(data)) {
      if (Array.isArray(value)) return value;
    }
  }

  return [];
}

/**
 * Un archivo conversations-XXX.json de ChatGPT trae muchas conversaciones
 * envueltas de alguna forma (ver findConversationsArray). Aquí recorremos
 * ese arreglo y delegamos la extracción de cada conversación a la función
 * de arriba.
 */
function extractChatGPTUserMessages(data, fileLabel) {
  const conversations = findConversationsArray(data);
  const out = [];

  conversations.forEach((conversation, index) => {
    out.push(
      ...extractChatGPTUserMessagesFromConversation(conversation, `${fileLabel}-${index}`)
    );
  });

  return out;
}

// Frases que Instagram genera automáticamente cuando envías un adjunto
// (foto, archivo, nota de voz, etc.). No son texto tuyo, son subtítulos
// del sistema. Se usan como respaldo cuando el mensaje no trae marcado
// ningún campo de adjunto pero igual el contenido es uno de estos avisos.
const SUBTITULOS_AUTOMATICOS_INSTAGRAM = new Set([
  "enviaste un archivo adjunto.",
  "compartiste una publicación.",
  "compartiste una historia.",
  "enviaste una nota de voz.",
  "enviaste una ubicación.",
  "enviaste un video.",
  "enviaste una foto.",
  "enviaste un gif.",
  "enviaste una encuesta.",
  "este mensaje fue eliminado.",
]);

/**
 * Detecta si un mensaje de Instagram trae un adjunto (foto, video, audio,
 * archivo, sticker, contenido compartido, llamada). Cuando esto ocurre,
 * el campo "content" suele ser un subtítulo automático ("Enviaste un
 * archivo adjunto."), no texto que tú hayas escrito.
 */
function tieneAdjunto(message) {
  const camposDeArreglo = ["photos", "videos", "audio_files", "files", "gifs"];

  for (const campo of camposDeArreglo) {
    if (Array.isArray(message[campo]) && message[campo].length > 0) {
      return true;
    }
  }

  return Boolean(message.sticker || message.share || message.call_duration);
}

/**
 * Extrae SOLO tus mensajes de texto de un message_1_*.json de Instagram.
 * Filtra por sender_name === tu nombre, ignora mensajes sin texto
 * (stickers, fotos, llamadas, reacciones sueltas) y descarta subtítulos
 * automáticos generados por Instagram cuando envías un adjunto.
 */
function extractInstagramOwnMessages(data, fileLabel) {
  const messages = Array.isArray(data.messages) ? data.messages : [];
  const conversationId = shortHash(data.title ?? fileLabel);
  const out = [];

  for (const m of messages) {
    const senderFixed = fixMojibake(m.sender_name ?? "");
    if (senderFixed !== MI_NOMBRE_INSTAGRAM) continue;

    if (tieneAdjunto(m)) continue;

    if (typeof m.content !== "string") continue;
    const texto = fixMojibake(m.content).trim();
    if (!texto) continue;
    if (SUBTITULOS_AUTOMATICOS_INSTAGRAM.has(texto.toLowerCase())) continue;

    out.push({
      texto,
      registro: "informal_intimo",
      fuente: "instagram",
      fecha: m.timestamp_ms ? new Date(Number(m.timestamp_ms)).toISOString() : null,
      conversacion_id: conversationId,
    });
  }

  return out;
}

// ---------- Estadísticas de estilo (todo local, no sale de tu máquina) ----------

function quitarBloquesDeCodigo(texto) {
  // Quita bloques de código entre comillas triple (```...```), típico
  // cuando pegas fragmentos de código en una conversación con ChatGPT.
  return texto.replace(/```[\s\S]*?```/g, " ");
}

function pareceIdentificadorDeCodigo(palabraOriginal) {
  // Una palabra normal en español casi nunca tiene una minúscula seguida
  // de una mayúscula DENTRO de sí misma (nadie escribe "casaGrande" en
  // prosa). Ese patrón camelCase/PascalCase sí es típico de nombres de
  // clases o variables de programación (ej. "behaviourManager",
  // "BehaviourManager"). Se revisa ANTES de pasar todo a minúsculas,
  // que es donde se perdería esta pista.
  return /[a-z][A-Z]/.test(palabraOriginal);
}

function tokenizeWords(texto) {
  const crudas = texto.match(/[\p{L}\p{N}']+/gu) ?? [];
  return crudas
    .filter((palabra) => !pareceIdentificadorDeCodigo(palabra))
    .map((palabra) => palabra.toLowerCase());
}

function splitSentences(texto) {
  return texto
    .split(/[.!?¡¿]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function countMatches(texto, regex) {
  return (texto.match(regex) ?? []).length;
}

function computeStatsForGroup(samples) {
  if (samples.length === 0) return null;

  let totalPalabras = 0;
  let totalOraciones = 0;
  let totalExclamaciones = 0;
  let totalInterrogaciones = 0;
  let totalPuntosSuspensivos = 0;
  let totalEmojis = 0;
  const frecuencia = new Map();

  for (const s of samples) {
    const textoLimpio = quitarBloquesDeCodigo(s.texto);
    const palabras = tokenizeWords(textoLimpio);
    totalPalabras += palabras.length;
    totalOraciones += splitSentences(textoLimpio).length;
    totalExclamaciones += countMatches(textoLimpio, /!/g);
    totalInterrogaciones += countMatches(textoLimpio, /\?/g);
    totalPuntosSuspensivos += countMatches(textoLimpio, /\.\.\.|…/g);
    // Rango unicode aproximado para emojis comunes.
    totalEmojis += countMatches(textoLimpio, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu);

    for (const palabra of palabras) {
      if (STOPWORDS_ES.has(palabra)) continue;
      if (TERMINOS_TECNICOS_NO_VOZ.has(palabra)) continue;
      if (palabra.length < 3) continue;
      frecuencia.set(palabra, (frecuencia.get(palabra) ?? 0) + 1);
    }
  }

  const palabrasFrecuentes = [...frecuencia.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([palabra, conteo]) => ({ palabra, conteo }));

  return {
    total_mensajes: samples.length,
    total_palabras: totalPalabras,
    longitud_media_mensaje_palabras: Number((totalPalabras / samples.length).toFixed(2)),
    longitud_media_oracion_palabras: totalOraciones
      ? Number((totalPalabras / totalOraciones).toFixed(2))
      : null,
    exclamaciones_por_mensaje: Number((totalExclamaciones / samples.length).toFixed(3)),
    interrogaciones_por_mensaje: Number((totalInterrogaciones / samples.length).toFixed(3)),
    puntos_suspensivos_por_mensaje: Number((totalPuntosSuspensivos / samples.length).toFixed(3)),
    emojis_por_mensaje: Number((totalEmojis / samples.length).toFixed(3)),
    palabras_frecuentes: palabrasFrecuentes,
  };
}

function buildStats(allSamples) {
  const porRegistro = {};
  const registros = [...new Set(allSamples.map((s) => s.registro))];

  for (const registro of registros) {
    const grupo = allSamples.filter((s) => s.registro === registro);
    porRegistro[registro] = computeStatsForGroup(grupo);
  }

  return {
    generado: new Date().toISOString(),
    global: computeStatsForGroup(allSamples),
    por_registro: porRegistro,
  };
}

// ---------- Main ----------

function main() {
  if (MI_NOMBRE_INSTAGRAM === "TU_NOMBRE_AQUI") {
    console.error(
      "Falta configurar MI_NOMBRE_INSTAGRAM al inicio del script.\n" +
      "Abre un archivo en corpus/private/instagram-messages/, busca un\n" +
      "mensaje tuyo y copia el valor exacto de \"sender_name\"."
    );
    process.exit(1);
  }

  ensureDir(PRIVATE_DIR);

  const allSamples = [];

  // ChatGPT
  const chatgptFiles = listJsonFiles(CHATGPT_DIR);
  for (const file of chatgptFiles) {
    try {
      const data = readJson(file);
      if (!data) continue;
      const samples = extractChatGPTUserMessages(data, path.basename(file));
      allSamples.push(...samples);
      console.log(`ChatGPT OK: ${path.basename(file)} -> ${samples.length} mensajes tuyos`);

      if (samples.length === 0) {
        const estructura = Array.isArray(data)
          ? `arreglo de ${data.length} elementos`
          : `objeto con claves: ${Object.keys(data ?? {}).join(", ")}`;
        console.log(`  (sin mensajes; estructura de nivel superior -> ${estructura})`);
      }
    } catch (err) {
      console.error(`ChatGPT ERROR: ${path.basename(file)} -> ${err.message}`);
    }
  }

  // Instagram (copias privadas ya generadas por 00_import_instagram_messages.js)
  const instagramFiles = listJsonFiles(INSTAGRAM_PRIVATE_DIR);
  for (const file of instagramFiles) {
    try {
      const data = readJson(file);
      if (!data) continue;
      const samples = extractInstagramOwnMessages(data, path.basename(file));
      allSamples.push(...samples);
      console.log(`Instagram OK: ${path.basename(file)} -> ${samples.length} mensajes tuyos`);
    } catch (err) {
      console.error(`Instagram ERROR: ${path.basename(file)} -> ${err.message}`);
    }
  }

  if (allSamples.length === 0) {
    console.log(
      "\nNo se extrajo ningún mensaje. Revisa MI_NOMBRE_INSTAGRAM y que\n" +
      "existan archivos en corpus/raw/chatgpt/ y corpus/private/instagram-messages/."
    );
    process.exit(1);
  }

  // Escribe el corpus lingüístico privado, uno por línea (JSONL).
  const lines = allSamples.map((s) => JSON.stringify(s));
  fs.writeFileSync(JSONL_OUTPUT, lines.join("\n") + "\n", "utf8");

  // Escribe las estadísticas agregadas (esto sí es liviano y compartible).
  const stats = buildStats(allSamples);
  fs.writeFileSync(STATS_OUTPUT, JSON.stringify(stats, null, 2), "utf8");

  console.log("\nCorpus lingüístico generado.");
  console.log(`Mensajes totales: ${allSamples.length}`);
  console.log(`Por registro: ${JSON.stringify(
    Object.fromEntries(Object.entries(stats.por_registro).map(([k, v]) => [k, v.total_mensajes]))
  )}`);
  console.log(`\nArchivo privado (NO subir a ningún lado):\n${JSONL_OUTPUT}`);
  console.log(`\nEstadísticas (ligero, se puede compartir):\n${STATS_OUTPUT}`);
}

main();