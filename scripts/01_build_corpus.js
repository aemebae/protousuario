import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const RAW_DIR = path.join(ROOT, "corpus", "raw");
const OUT = path.join(ROOT, "corpus.json");

const NOISE_BASENAMES = new Set([
  "settings.json",
  "export_manifest.json",
  "library_files.json",
  "conversation_asset_file_names.json",
  "message_feedback.json",
]);

const NOISE_KEYWORDS = [
  "ads_about_meta",
  "advertisers_using_your_activity_or_information",
  "other_categories_used_to_reach_you",
  "in_app_message",
  "shared_conversations",
];

function loadJsonOrNull(filePath) {
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return null;

  return JSON.parse(raw);
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function listJsonFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listJsonFiles(full));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
      out.push(full);
    }
  }

  return out;
}

function basename(filePath) {
  return path.basename(filePath).toLowerCase();
}

function shouldSkipFile(filePath) {
  const base = basename(filePath);

  if (base === "corpus.json") return true;
  if (NOISE_BASENAMES.has(base)) return true;
  if (NOISE_KEYWORDS.some((k) => base.includes(k))) return true;

  return false;
}

function detectSource(filePath) {
  const p = filePath.toLowerCase().replaceAll("\\", "/");

  if (p.includes("/chatgpt/")) return "chatgpt";
  if (p.includes("/instagram/")) return "instagram";
  if (p.includes("/spotify/")) return "spotify";
  if (p.includes("/youtube/")) return "youtube";
  if (p.includes("/my-activity/") || p.includes("my activity") || p.includes("myactivity")) return "my-activity";
  if (p.includes("/google-maps/") || p.includes("/timeline/")) return "google-maps";
  if (p.includes("/brave/") || p.includes("/chrome/")) return "browser";

  return "unknown";
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

function deepFix(value) {
  if (typeof value === "string") return fixMojibake(value);
  if (Array.isArray(value)) return value.map(deepFix);

  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[fixMojibake(k)] = deepFix(v);
    }
    return out;
  }

  return value;
}

function isPlainObject(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function extractChatGPTRecords(data) {
  const records = [];
  const mapping = data?.mapping;

  if (!isPlainObject(mapping)) return records;

  for (const [nodeId, node] of Object.entries(mapping)) {
    if (!isPlainObject(node)) continue;

    const msg = node.message;
    const parts = msg?.content?.parts;

    let title = "";
    if (Array.isArray(parts)) {
      title = parts
        .filter((p) => typeof p === "string")
        .join("\n")
        .trim();
    }

    if (!title) {
      title =
        node.title ??
        msg?.content?.text ??
        msg?.summary ??
        msg?.metadata?.title ??
        "";
    }

    const time =
      msg?.create_time ??
      msg?.update_time ??
      node.create_time ??
      node.update_time ??
      null;

    if (!title && !time && !msg) continue;

    records.push({
      kind: "chatgpt_message",
      node_id: nodeId,
      title: title || "sin_titulo",
      time,
      role: msg?.author?.role ?? msg?.author?.name ?? null,
    });
  }

  return records;
}

function findFirstArrayByKeys(obj, keys) {
  if (!isPlainObject(obj)) return null;

  for (const key of keys) {
    if (Array.isArray(obj[key])) return obj[key];
  }

  return null;
}

function normalizeRecords(source, data) {
  if (source === "chatgpt") {
    const chatgptRecords = extractChatGPTRecords(data);
    if (chatgptRecords.length > 0) return chatgptRecords;
  }

  if (Array.isArray(data)) return data;

  if (!isPlainObject(data)) return [];

  const keysBySource = {
    youtube: ["items", "activity", "records", "events", "watchHistory", "watch_history", "searchHistory", "search_history"],
    "my-activity": ["items", "activity", "records", "events"],
    spotify: ["items", "records", "activities", "tracks"],
    "google-maps": ["semanticSegments", "records", "items", "timeline", "segments"],
    instagram: [
      "likes_media_likes",
      "saved_saved_media",
      "comments_media_comments",
      "searches_keyword",
      "relationships_following",
      "followers",
      "following",
      "media",
      "items",
      "content",
      "posts_viewed",
      "videos_watched",
    ],
    browser: ["items", "records", "history", "bookmarks", "urls"],
    unknown: ["items", "records", "activity", "events", "messages"],
  };

  const keys = keysBySource[source] ?? keysBySource.unknown;

  const direct = findFirstArrayByKeys(data, keys);
  if (direct) return direct;

  // one-level fallback: useful for some exports whose arrays are nested one object down
  for (const val of Object.values(data)) {
    if (Array.isArray(val)) return val;
    if (isPlainObject(val)) {
      const nested = findFirstArrayByKeys(val, keys);
      if (nested) return nested;
    }
  }

  return [];
}

function extractTextFromRecord(record) {
  if (record == null) return "sin_titulo";

  if (typeof record === "string") {
    const t = record.trim();
    return t || "sin_titulo";
  }

  if (!isPlainObject(record)) return "sin_titulo";

  if (Array.isArray(record.message?.content?.parts)) {
    const text = record.message.content.parts
      .filter((p) => typeof p === "string")
      .join("\n")
      .trim();
    if (text) return text.slice(0, 220);
  }

  if (Array.isArray(record.content?.parts)) {
    const text = record.content.parts
      .filter((p) => typeof p === "string")
      .join("\n")
      .trim();
    if (text) return text.slice(0, 220);
  }

  const candidates = [
    record.title,
    record.header,
    record.text,
    record.name,
    record.value,
    record.query,
    record.caption,
    record.action,
    record.url,
    record.page_title,
    record.master_metadata_track_name,
    record.master_metadata_album_artist_name,
    record.master_metadata_album_album_name,
    record.video_title,
    record.search_query,
    record.search,
    record.prompt,
    record.description,
    record.media_title,
    record.author,
  ];

  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim().slice(0, 220);
  }

  // fallback: some objects wrap the text in a nested field
  if (typeof record.message?.author?.name === "string" && record.message.author.name.trim()) {
    return record.message.author.name.trim().slice(0, 220);
  }

  return "sin_titulo";
}

function extractTimeFromRecord(record) {
  if (record == null) return null;

  if (typeof record === "number") {
    const ms = record < 1e12 ? record * 1000 : record;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof record === "string") {
    const asNum = Number(record);
    if (!Number.isNaN(asNum) && record.trim() !== "") {
      return extractTimeFromRecord(asNum);
    }

    const d = new Date(record);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (!isPlainObject(record)) return null;

  const candidates = [
    record.time,
    record.timestamp,
    record.ts,
    record.date,
    record.startTime,
    record.endTime,
    record.activityTime,
    record.create_time,
    record.update_time,
    record.creation_timestamp,
    record.timestampMs,
    record.time_usec,
    record.photoTakenTime?.timestamp,
    record.creationTime?.timestamp,
    record.timestamp_ms,
  ];

  for (const candidate of candidates) {
    const dt = extractTimeFromRecord(candidate);
    if (dt) return dt;
  }

  return null;
}

function aggregate(records) {
  const byHour = Array.from({ length: 24 }, () => 0);
  const topText = new Map();
  let withTime = 0;

  for (const item of records) {
    const label = extractTextFromRecord(item);
    topText.set(label, (topText.get(label) ?? 0) + 1);

    const dt = extractTimeFromRecord(item);
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

function isWorthKeeping(summary, source, filePath) {
  if (!summary) return false;
  if (summary.total > 0) return true;

  // keep extremely few structural files only if they actually said something
  const base = basename(filePath);
  const meaningfulNoise = new Set([
    "settings.json",
    "export_manifest.json",
    "library_files.json",
    "conversation_asset_file_names.json",
    "message_feedback.json",
  ]);

  if (meaningfulNoise.has(base)) return false;
  return false;
}

function buildEntry(filePath, source, data) {
  const records = normalizeRecords(source, data);
  const summary = aggregate(records);

  if (!isWorthKeeping(summary, source, filePath)) {
    return null;
  }

  return {
    fuente: source,
    archivo: path.relative(ROOT, filePath).replaceAll("\\", "/"),
    generado: new Date().toISOString(),
    resumen: summary,
  };
}

function main() {
  if (!fs.existsSync(RAW_DIR)) {
    console.log(`No existe la carpeta: ${RAW_DIR}`);
    console.log("Crea corpus/raw y pon ahí tus exportaciones JSON por app.");
    process.exit(1);
  }

  const files = listJsonFiles(RAW_DIR).sort((a, b) =>
    a.localeCompare(b, "es", { sensitivity: "base" })
  );

  const entriesByFile = new Map();

  let scanned = 0;
  let kept = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of files) {
    scanned += 1;

    if (shouldSkipFile(file)) {
      skipped += 1;
      continue;
    }

    const source = detectSource(file);

    try {
      let data = loadJsonOrNull(file);
      if (data == null) {
        skipped += 1;
        continue;
      }

      if (source === "instagram") {
        data = deepFix(data);
      }

      const entry = buildEntry(file, source, data);

      if (!entry) {
        skipped += 1;
        continue;
      }

      entriesByFile.set(entry.archivo, entry);
      kept += 1;

      console.log(`OK: ${entry.archivo} -> ${entry.fuente} (${entry.resumen.total} registros)`);
    } catch (err) {
      errors += 1;

      const errorEntry = {
        fuente: source,
        archivo: path.relative(ROOT, file).replaceAll("\\", "/"),
        generado: new Date().toISOString(),
        error: String(err?.message ?? err),
      };

      entriesByFile.set(errorEntry.archivo, errorEntry);
      console.log(`ERROR: ${errorEntry.archivo} -> ${errorEntry.error}`);
    }
  }

  const corpus = {
    entradas: [...entriesByFile.values()].sort((a, b) =>
      String(a.archivo).localeCompare(String(b.archivo), "es", { sensitivity: "base" })
    ),
  };

  writeJson(OUT, corpus);

  console.log("\nOK: corpus reconstruido.");
  console.log(`Escaneados: ${scanned}`);
  console.log(`Guardados: ${kept}`);
  console.log(`Saltados: ${skipped}`);
  console.log(`Errores: ${errors}`);
  console.log(`Salida: ${OUT}`);
}

main();