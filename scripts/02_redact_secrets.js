import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const INPUT_FILE = path.join(ROOT, "corpus.json");
const OUTPUT_FILE = path.join(ROOT, "corpus.redacted.json");
const REPORT_FILE = path.join(ROOT, "redaction-report.json");

const report = [];
const counters = {};

/**
 * Registra una redacción sin guardar el contenido secreto.
 */
function registerHit(jsonPath, ruleName) {
  report.push({
    path: jsonPath,
    rule: ruleName,
  });

  counters[ruleName] = (counters[ruleName] ?? 0) + 1;
}

/**
 * Verifica números de tarjeta con el algoritmo de Luhn.
 * Reduce falsos positivos: no censura cualquier número largo.
 */
function passesLuhn(numberString) {
  const digits = numberString.replace(/\D/g, "");

  if (digits.length < 13 || digits.length > 19) {
    return false;
  }

  let sum = 0;
  let shouldDouble = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = Number(digits[i]);

    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

/**
 * Aplica una regla y registra cada coincidencia.
 */
function applyRule(text, regex, replacement, ruleName, jsonPath) {
  return text.replace(regex, (...args) => {
    registerHit(jsonPath, ruleName);

    if (typeof replacement === "function") {
      return replacement(...args);
    }

    return replacement;
  });
}

/**
 * Busca y elimina exclusivamente secretos o datos de acceso.
 */
function redactString(originalText, jsonPath) {
  let text = originalText;

  // Claves privadas completas.
  text = applyRule(
    text,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    "[CLAVE_PRIVADA_ELIMINADA]",
    "private_key",
    jsonPath
  );

  // Google API keys.
  text = applyRule(
    text,
    /\bAIza[0-9A-Za-z_-]{25,}\b/g,
    "[API_KEY_GOOGLE_ELIMINADA]",
    "google_api_key",
    jsonPath
  );

  // OpenAI y Anthropic API keys.
  text = applyRule(
    text,
    /\bsk-(?:proj-|ant-)?[0-9A-Za-z_-]{20,}\b/g,
    "[API_KEY_ELIMINADA]",
    "llm_api_key",
    jsonPath
  );

  // GitHub tokens.
  text = applyRule(
    text,
    /\bgh[pousr]_[0-9A-Za-z]{20,}\b/g,
    "[TOKEN_GITHUB_ELIMINADO]",
    "github_token",
    jsonPath
  );

  // Slack tokens.
  text = applyRule(
    text,
    /\bxox[baprs]-[0-9A-Za-z-]{15,}\b/g,
    "[TOKEN_SLACK_ELIMINADO]",
    "slack_token",
    jsonPath
  );

  // JWT.
  text = applyRule(
    text,
    /\beyJ[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}\b/g,
    "[JWT_ELIMINADO]",
    "jwt",
    jsonPath
  );

  // Bearer tokens.
  text = applyRule(
    text,
    /\bBearer\s+[0-9A-Za-z._~+/=-]{20,}\b/gi,
    "Bearer [TOKEN_ELIMINADO]",
    "bearer_token",
    jsonPath
  );

  // Tokens y claves en URLs.
  text = applyRule(
    text,
    /([?&](?:access_token|refresh_token|auth_token|session_token|sessionid|api_key|token|key|code)=)[^&#\s]+/gi,
    (_match, prefix) => `${prefix}[ELIMINADO]`,
    "secret_in_url",
    jsonPath
  );

  // Campos explícitos: password, PIN, CVV, OTP, token, API key, etc.
  text = applyRule(
    text,
    /(\b(?:contrase(?:ñ|n)a|password|passwd|clave\s+de\s+acceso|pin|cvv|cvc|otp|c[oó]digo\s+de\s+verificaci[oó]n|api[ _-]?key|client[ _-]?secret|access[ _-]?token|refresh[ _-]?token|auth[ _-]?token|session[ _-]?token)\b\s*[:=]\s*)(["']?)([^,\s;"']{4,})(\2)/gi,
    (_match, label) => `${label}[SECRETO_ELIMINADO]`,
    "explicit_secret",
    jsonPath
  );

  // Frases como “mi contraseña es ...”.
  text = applyRule(
    text,
    /(\b(?:mi\s+)?(?:contrase(?:ñ|n)a|password|clave\s+de\s+acceso|pin|cvv|cvc|otp)\s+(?:es|era)\s+)([^\s,;.]{4,})/gi,
    (_match, prefix) => `${prefix}[SECRETO_ELIMINADO]`,
    "secret_phrase",
    jsonPath
  );

  // IBAN.
  text = applyRule(
    text,
    /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
    "[IBAN_ELIMINADO]",
    "iban",
    jsonPath
  );

  // CCI o número de cuenta acompañado por contexto explícito.
  text = applyRule(
    text,
    /(\b(?:cci|cuenta\s+bancaria|n[úu]mero\s+de\s+cuenta)\b\s*(?:nro\.?|n[úu]mero)?\s*[:#=-]?\s*)(\d[\d -]{7,23}\d)/gi,
    (_match, prefix) => `${prefix}[CUENTA_ELIMINADA]`,
    "bank_account",
    jsonPath
  );

  // Frase semilla de criptomonedas, solo cuando está etiquetada explícitamente.
  text = applyRule(
    text,
    /(\b(?:seed\s+phrase|recovery\s+phrase|frase\s+semilla)\b\s*[:=]\s*)([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){10,23})/gi,
    (_match, prefix) => `${prefix}[FRASE_SEMILLA_ELIMINADA]`,
    "seed_phrase",
    jsonPath
  );

  // Números de tarjeta: solo se eliminan cuando pasan Luhn.
  text = text.replace(
    /\b(?:\d[ -]?){12,18}\d\b/g,
    (candidate) => {
      if (!passesLuhn(candidate)) {
        return candidate;
      }

      registerHit(jsonPath, "payment_card");
      return "[TARJETA_ELIMINADA]";
    }
  );

  return text;
}

/**
 * Recorre recursivamente todo el JSON.
 */
function redactValue(value, jsonPath = "$") {
  if (typeof value === "string") {
    return redactString(value, jsonPath);
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      redactValue(item, `${jsonPath}[${index}]`)
    );
  }

  if (value && typeof value === "object") {
    const output = {};

    for (const [key, childValue] of Object.entries(value)) {
      output[key] = redactValue(
        childValue,
        `${jsonPath}.${key}`
      );
    }

    return output;
  }

  return value;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`No existe el archivo: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8").trim();

  if (!raw) {
    throw new Error(`El archivo está vacío: ${filePath}`);
  }

  return JSON.parse(raw);
}

function writeJson(filePath, value) {
  fs.writeFileSync(
    filePath,
    JSON.stringify(value, null, 2),
    "utf8"
  );
}

function main() {
  try {
    console.log("Leyendo corpus.json...");

    const corpus = readJson(INPUT_FILE);
    const redactedCorpus = redactValue(corpus);

    writeJson(OUTPUT_FILE, redactedCorpus);

    const reportDocument = {
      generatedAt: new Date().toISOString(),
      input: path.basename(INPUT_FILE),
      output: path.basename(OUTPUT_FILE),
      totalRedactions: report.length,
      summaryByRule: counters,
      findings: report,
    };

    writeJson(REPORT_FILE, reportDocument);

    console.log("\nProceso terminado.");
    console.log(`Redacciones encontradas: ${report.length}`);
    console.log(`Corpus protegido: ${OUTPUT_FILE}`);
    console.log(`Informe: ${REPORT_FILE}`);

    if (report.length === 0) {
      console.log(
        "\nNo se detectaron credenciales o datos financieros evidentes."
      );
    } else {
      console.log(
        "\nRevisa redaction-report.json antes de continuar."
      );
    }
  } catch (error) {
    console.error("\nNo se pudo completar la revisión:");
    console.error(error.message);
    process.exitCode = 1;
  }
}

main();