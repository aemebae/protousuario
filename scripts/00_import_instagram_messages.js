import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();

// La ruta de la carpeta "inbox" se pasa desde la terminal.
const SOURCE_INBOX = process.argv[2];

const PRIVATE_OUTPUT_DIR = path.join(
  ROOT,
  "corpus",
  "private",
  "instagram-messages"
);

const EVENTS_OUTPUT_FILE = path.join(
  ROOT,
  "corpus",
  "raw",
  "instagram",
  "instagram_messages_events.json"
);

const REPORT_OUTPUT_FILE = path.join(
  ROOT,
  "corpus",
  "private",
  "instagram_messages_import_report.json"
);

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function sanitizeFilename(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 150) || "conversacion_sin_nombre";
}

function shortHash(value) {
  return crypto
    .createHash("sha1")
    .update(value)
    .digest("hex")
    .slice(0, 8);
}

function walk(directory) {
  const results = [];

  for (const entry of fs.readdirSync(directory, {
    withFileTypes: true,
  })) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      results.push(...walk(fullPath));
    } else if (
      entry.isFile() &&
      entry.name.toLowerCase() === "message_1.json"
    ) {
      results.push(fullPath);
    }
  }

  return results;
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").trim();

  if (!raw) {
    throw new Error("Archivo vacío");
  }

  return JSON.parse(raw);
}

function timestampToIso(timestampMs) {
  if (!timestampMs) return null;

  const date = new Date(Number(timestampMs));

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function hasMedia(message) {
  const arrayFields = [
    "photos",
    "videos",
    "audio_files",
    "files",
    "gifs",
  ];

  for (const field of arrayFields) {
    if (
      Array.isArray(message[field]) &&
      message[field].length > 0
    ) {
      return true;
    }
  }

  return Boolean(
    message.sticker ||
    message.share ||
    message.call_duration
  );
}

function buildEvent(message, conversationName, copiedFilename) {
  return {
    title: conversationName,
    time: timestampToIso(message.timestamp_ms),

    // Conserva información estructural, no el mensaje textual.
    sender_name:
      typeof message.sender_name === "string"
        ? message.sender_name
        : null,

    has_text:
      typeof message.content === "string" &&
      message.content.trim().length > 0,

    has_media: hasMedia(message),

    reaction_count: Array.isArray(message.reactions)
      ? message.reactions.length
      : 0,

    conversation_file: copiedFilename,
  };
}

function main() {
  if (!SOURCE_INBOX) {
    console.error(
      'Falta indicar la ruta de la carpeta "inbox".'
    );

    console.error(
      'Ejemplo:\nnode scripts/00_import_instagram_messages.js "C:\\ruta\\a\\inbox"'
    );

    process.exit(1);
  }

  const inboxPath = path.resolve(SOURCE_INBOX);

  if (!fs.existsSync(inboxPath)) {
    console.error(`No existe la ruta: ${inboxPath}`);
    process.exit(1);
  }

  ensureDir(PRIVATE_OUTPUT_DIR);
  ensureDir(path.dirname(EVENTS_OUTPUT_FILE));

  const messageFiles = walk(inboxPath);
  const usedNames = new Map();

  const events = [];
  const report = [];

  let copied = 0;
  let errors = 0;
  let totalMessages = 0;

  console.log(
    `Encontrados ${messageFiles.length} archivos message_1.json.`
  );

  for (const sourceFile of messageFiles) {
    const parentFolder = path.basename(
      path.dirname(sourceFile)
    );

    const cleanConversationName =
      sanitizeFilename(parentFolder);

    let copiedFilename =
      `message_1_${cleanConversationName}.json`;

    /*
     * Si dos carpetas diferentes terminan produciendo
     * exactamente el mismo nombre limpio, añade un hash.
     */
    if (
      usedNames.has(copiedFilename) &&
      usedNames.get(copiedFilename) !== sourceFile
    ) {
      const relativeSource = path.relative(
        inboxPath,
        sourceFile
      );

      copiedFilename =
        `message_1_${cleanConversationName}_` +
        `${shortHash(relativeSource)}.json`;
    }

    usedNames.set(copiedFilename, sourceFile);

    const destinationFile = path.join(
      PRIVATE_OUTPUT_DIR,
      copiedFilename
    );

    try {
      // Copia, no mueve. El export original queda intacto.
      fs.copyFileSync(sourceFile, destinationFile);

      const data = readJson(sourceFile);
      const messages = Array.isArray(data.messages)
        ? data.messages
        : [];

      for (const message of messages) {
        events.push(
          buildEvent(
            message,
            parentFolder,
            copiedFilename
          )
        );
      }

      totalMessages += messages.length;
      copied += 1;

      report.push({
        source: path.relative(inboxPath, sourceFile),
        copiedAs: copiedFilename,
        messages: messages.length,
        participants: Array.isArray(data.participants)
          ? data.participants.length
          : 0,
        status: "ok",
      });
    } catch (error) {
      errors += 1;

      report.push({
        source: path.relative(inboxPath, sourceFile),
        copiedAs: copiedFilename,
        messages: 0,
        status: "error",
        error: String(error?.message ?? error),
      });

      console.error(
        `ERROR: ${sourceFile} -> ${error.message}`
      );
    }
  }

  fs.writeFileSync(
    EVENTS_OUTPUT_FILE,
    JSON.stringify(events, null, 2),
    "utf8"
  );

  const reportDocument = {
    generatedAt: new Date().toISOString(),
    sourceInbox: inboxPath,
    messageFilesFound: messageFiles.length,
    filesCopied: copied,
    totalMessagesIndexed: totalMessages,
    errors,
    privateOutputDirectory: path.relative(
      ROOT,
      PRIVATE_OUTPUT_DIR
    ),
    eventsOutputFile: path.relative(
      ROOT,
      EVENTS_OUTPUT_FILE
    ),
    files: report,
  };

  fs.writeFileSync(
    REPORT_OUTPUT_FILE,
    JSON.stringify(reportDocument, null, 2),
    "utf8"
  );

  console.log("\nImportación terminada.");
  console.log(`Archivos encontrados: ${messageFiles.length}`);
  console.log(`Archivos copiados: ${copied}`);
  console.log(`Mensajes indexados: ${totalMessages}`);
  console.log(`Errores: ${errors}`);

  console.log(
    `\nCopias privadas:\n${PRIVATE_OUTPUT_DIR}`
  );

  console.log(
    `\nÍndice ligero:\n${EVENTS_OUTPUT_FILE}`
  );

  console.log(
    `\nInforme:\n${REPORT_OUTPUT_FILE}`
  );
}

main();