import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const RAW_DIR = path.join(ROOT, "corpus", "raw");
const OUT = path.join(ROOT, "corpus.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function isJsonFile(file) {
  return file.toLowerCase().endsWith(".json");
}

function listJsonFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listJsonFiles(full));
    } else if (entry.isFile() && isJsonFile(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function detectSource(filePath) {
  const p = filePath.toLowerCase().replaceAll("\\", "/");

  if (p.includes("/youtube/")) return "youtube";
  if (p.includes("/instagram/")) return "instagram";
  if (p.includes("/spotify/")) return "spotify";
  if (p.includes("/chatgpt/")) return "chatgpt";
  if (p.includes("/google-maps/") || p.includes("/timeline/")) return "google-maps";
  if (p.includes("/my-activity/") || p.includes("my activity") || p.includes("myactivity")) return "my-activity";

  return "unknown";
}

function safeTime(value) {
  if (!value) return null;

  if (typeof value === "number") {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof value === "string") {
    const asNum = Number(value);
    if (!Number.isNaN(asNum) && value.trim() !== "") {
      return safeTime(asNum);
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function extractText(x) {
  if (typeof x === "string") return x;
  if (x && typeof x === "object") {
    return String(
      x.title ??
      x.header ??
      x.text ??
      x.name ??
      x.value ??
      x.query ??
      x.caption ??
      x.action ??
      "sin_titulo"
    );
  }
  return "sin_titulo";
}

function normalizeRecords(source, data) {
  // YouTube / My Activity / Spotify suelen venir como arrays o contenedores sencillos
  if (source === "youtube" || source === "my-activity" || source === "spotify" || source === "google-maps") {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.activity)) return data.activity;
    if (Array.isArray(data?.records)) return data.records;
    if (Array.isArray(data?.semanticSegments)) return data.semanticSegments;
    if (Array.isArray(data?.conversations)) return data.conversations;
    return [];
  }

  if (source === "instagram") {
    const candidates = [
      data?.likes_media_likes,
      data?.saved_saved_media,
      data?.comments_media_comments,
      data?.relationships_following,
      data?.followers,
      data?.following,
      data?.searches_keyword,
      data?.searches,
      data?.media,
      data?.items,
    ];
    for (const c of candidates) {
      if (Array.isArray(c)) return c;
    }
    return [];
  }

  if (source === "chatgpt") {
    // Export de ChatGPT: conversations.json es árbol; aquí lo dejamos como “records” mínimos.
    if (data?.mapping && typeof data.mapping === "object") {
      return Object.values(data.mapping).filter(Boolean);
    }
    return [];
  }

  return Array.isArray(data) ? data : [];
}

function aggregate(records) {
  const byHour = Array.from({ length: 24 }, () => 0);
  const topText = new Map();
  let withTime = 0;

  for (const item of records) {
    const label = extractText(item).trim();
    topText.set(label, (topText.get(label) ?? 0) + 1);

    const dt =
      safeTime(item.time) ??
      safeTime(item.timestamp) ??
      safeTime(item.creation_timestamp) ??
      safeTime(item.photoTakenTime?.timestamp) ??
      safeTime(item.activityTime) ??
      safeTime(item.date);

    if (dt) {
      byHour[dt.getHours()] += 1;
      withTime += 1;
    }
  }

  const topItems = [...topText.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([title, count]) => ({ title, count }));

  return {
    total: records.length,
    withTime,
    byHour,
    topItems,
  };
}

function ensureCorpus() {
  if (fs.existsSync(OUT)) return readJson(OUT);
  return { entradas: [] };
}

function main() {
  if (!fs.existsSync(RAW_DIR)) {
    console.log(`No existe ${RAW_DIR}`);
    console.log("Crea corpus/raw y mete ahí tus exportaciones JSON por app.");
    process.exit(1);
  }

  const files = listJsonFiles(RAW_DIR);
  const corpus = ensureCorpus();

  for (const file of files) {
    try {
      const source = detectSource(file);
      const data = readJson(file);
      const records = normalizeRecords(source, data);
      const resumen = aggregate(records);

      corpus.entradas.push({
        fuente: source,
        archivo: path.relative(ROOT, file).replaceAll("\\", "/"),
        generado: new Date().toISOString(),
        resumen,
      });

      console.log(`OK: ${path.basename(file)} -> ${source} (${records.length} registros)`);
    } catch (err) {
      corpus.entradas.push({
        fuente: detectSource(file),
        archivo: path.relative(ROOT, file).replaceAll("\\", "/"),
        generado: new Date().toISOString(),
        error: String(err?.message ?? err),
      });

      console.log(`ERROR: ${path.basename(file)} -> ${String(err?.message ?? err)}`);
    }
  }

  writeJson(OUT, corpus);
  console.log(`\nOK: corpus actualizado en ${OUT}`);
}

main();