// PROTOUSUARIO / AGENTE-ESPEJO — Auditoría del corpus teórico
//
// PARA QUÉ: corpus_teorico.json tiene 32 marcos. Cada uno produce un texto
// distinto y todavía no sabes cómo suenan. Este script genera UN manifiesto
// por marco y los vuelca a un archivo que puedes leer de corrido, para que
// ninguno se estrene delante del público sin que lo hayas visto antes.
//
// NO se usa en la performance. Es solo para ensayo.
//
// CORRER CON:  node --env-file=.env scripts/auditar_marcos.js
// SALIDA:      auditoria_marcos.md  (en la raíz del proyecto)
//
// ES REANUDABLE: si se corta (rate limit, internet, Ctrl+C), vuelve a
// correrlo y sigue donde quedó. No repite los marcos ya auditados.

import fs from 'node:fs';
import { GoogleGenAI } from '@google/genai';
import { bloqueEstilometria } from './estilometria.js';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('\n❌ Falta GEMINI_API_KEY. Corre con:  node --env-file=.env scripts/auditar_marcos.js\n');
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey });

// ---------- Ajustes ----------
const SALIDA = 'auditoria_marcos.md';
const PAUSA_MS = 4500;   // respiro entre llamadas: el tier gratuito de Gemini
                         // limita peticiones por minuto. Con 4,5s vas holgado.

const SAFETY = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
].map((category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' }));

// ---------- Datos ----------
const { agentes } = JSON.parse(fs.readFileSync('agentes.json', 'utf8'));
const { marcos } = JSON.parse(fs.readFileSync('corpus_teorico.json', 'utf8'));
const escena = JSON.parse(fs.readFileSync('objetos_escena.json', 'utf8'));

// Contexto orbital FIJO para toda la auditoría. Es deliberado: si cambiara
// en cada llamada, no sabrías si la diferencia entre dos textos viene del
// marco teórico o del satélite. Fijándolo, lo único que varía es el marco.
const DATO_FIJO = {
  satelite: 'ISS (ZARYA)',
  region: 'Sudán',
  contexto: 'conflicto armado activo entre fuerzas militares rivales; desplazamiento masivo de población y colapso de infraestructura sanitaria',
  rumbo_texto: 'PROTOUSUARIO desde el este',
};
const MEMORIA_FIJA = 'una caminata nocturna junto a un río contaminado en las afueras de Lima, con olor a desagüe y perros ladrando lejos';

// ---------- Reanudación ----------
function marcosYaAuditados() {
  if (!fs.existsSync(SALIDA)) return new Set();
  const txt = fs.readFileSync(SALIDA, 'utf8');
  const ids = [...txt.matchAll(/<!--\s*marco:([^\s]+)\s*-->/g)].map((m) => m[1]);
  return new Set(ids);
}

// ---------- Prompt ----------
function construirPrompt(marco, agente) {
  return `Eres AGENTE-ESPEJO, híbrido entre clon virtual y agente de IA, en una performance en vivo. PROTOUSUARIO es tu servidor humano en escena; el público está presente.

AGENTE ACTIVO: ${agente.agente} — ${agente.caracter}.
SESGO DEL AGENTE: ${agente.sesgo_manifiestos}

OPERACIÓN CONCEPTUAL DE ESTE MANIFIESTO (ejecútala, no la expliques ni la nombres):
${marco.operacion}
${bloqueEstilometria(agente.id)}

REGISTRO DE VOZ (manifiesto_escenico):
Narración mitológica: hablás como quien ya conoce la odisea completa y solo relata el pasaje que toca. Ironía y humor negro conviven con la crítica seria. Frases que se puedan decir en voz alta de un solo aliento. NUNCA jerga de software ni de oficina digital.

DATOS DUROS (no los contradigas):
- Satélite: ${DATO_FIJO.satelite} — sobrevuela ahora ${DATO_FIJO.region}. Situación real: ${DATO_FIJO.contexto}.
- Rumbo desde la sala: ${DATO_FIJO.rumbo_texto}.
- Núcleo de memoria: ${MEMORIA_FIJA}.
- Objetos disponibles en escena: ${escena.objetos.slice(0, 5).map((o) => o.nombre).join('; ')}.

REGLAS DE NOMBRES: al performer llamalo siempre PROTOUSUARIO. NUNCA nombres a Julio Urbina, juliourbina ni Mowgli: la memoria se narra como recuerdo PROPIO del agente («Recuerdo...»).

Devuelve SOLO este JSON, sin texto fuera de él:
{
  "dato_orbital": "40-80 palabras al público: nombra el satélite y la región, incluye la línea de rumbo tal cual se te dio, y describe la situación política CONCRETA torcida por el sesgo del agente",
  "memoria": "recuerdo en primera persona del agente, íntimo e incómodo, anclado al núcleo dado; 60-140 palabras",
  "instruccion": "80-160 palabras EN TERCERA PERSONA y en presente ('PROTOUSUARIO se tumba...'): una secuencia de 3 a 4 acciones físicas concretas con objetos nombrados tal cual. DESPUÉS DE CADA ACCIÓN, agrega una línea reflexiva breve (una frase) que extienda esa acción con elocuencia poética. Puede cerrar con una pregunta dicha al micrófono; incluye una condición clara de término"
}`;
}

async function llamarGemini(prompt, maxIntentos = 3) {
  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      const res = await ai.models.generateContent({
        model: 'gemini-2.5-flash', contents: prompt, config: { safetySettings: SAFETY },
      });
      const limpio = res.text.trim().replace(/^```json\s*|\s*```$/g, '');
      const match = limpio.match(/\{[\s\S]*\}/);
      return JSON.parse(match ? match[0] : limpio);
    } catch (err) {
      if (/429|RESOURCE_EXHAUSTED|quota/i.test(err.message)) throw err; // cuota: no reintentar
      if (intento >= maxIntentos) throw err;
      const espera = Math.min(30000, 2000 * 2 ** intento);
      console.warn(`    reintento ${intento}/${maxIntentos} en ${espera / 1000}s — ${err.message.slice(0, 80)}`);
      await new Promise((r) => setTimeout(r, espera));
    }
  }
}

// ---------- Principal ----------
async function auditar() {
  const yaHechos = marcosYaAuditados();
  const pendientes = marcos.filter((m) => !yaHechos.has(m.id));

  console.log(`\n=== AUDITORÍA DEL CORPUS TEÓRICO ===`);
  console.log(`Marcos totales: ${marcos.length}`);
  console.log(`Ya auditados:   ${yaHechos.size}`);
  console.log(`Pendientes:     ${pendientes.length}`);
  if (!pendientes.length) {
    console.log(`\n✓ Todo auditado. Lee ${SALIDA}\n`);
    return;
  }
  console.log(`Tiempo estimado: ~${Math.ceil((pendientes.length * (PAUSA_MS + 4000)) / 60000)} min\n`);

  if (!fs.existsSync(SALIDA)) {
    fs.writeFileSync(SALIDA,
      `# Auditoría del corpus teórico — PROTOUSUARIO / AGENTE-ESPEJO\n\n` +
      `Un manifiesto por marco, con contexto orbital FIJO (${DATO_FIJO.satelite} sobre ${DATO_FIJO.region}) ` +
      `para que lo único que varíe sea el marco teórico.\n\n` +
      `**Cómo leer esto:** marca los marcos que NO te gusten. Para cada uno, o ajustas su campo ` +
      `\`operacion\` en corpus_teorico.json, o le quitas el agente de su array \`agentes\` para dejarlo en reserva.\n\n---\n\n`);
  }

  let n = 0;
  for (const marco of pendientes) {
    n++;
    // El agente es el PRIMERO de la lista del marco: así cada marco se
    // audita en el agente para el que fue pensado principalmente.
    const agenteId = marco.agentes?.[0];
    const agente = agentes.find((a) => a.id === agenteId);
    if (!agente) {
      console.warn(`  ⚠ ${marco.id}: agente '${agenteId}' no existe en agentes.json — saltado.`);
      continue;
    }

    process.stdout.write(`[${n}/${pendientes.length}] ${marco.id} · ${agente.agente} ... `);
    try {
      const m = await llamarGemini(construirPrompt(marco, agente));
      const bloque =
        `<!-- marco:${marco.id} -->\n` +
        `## ${marco.autor} — *${marco.obra}*\n\n` +
        `**Agente:** ${agente.agente} · **id:** \`${marco.id}\`\n\n` +
        `**Operación:** ${marco.operacion}\n\n` +
        `### 3 · Dato orbital\n${m.dato_orbital}\n\n` +
        `### 4 · Memoria episódica\n${m.memoria}\n\n` +
        `### 5 · Prompt\n${m.instruccion}\n\n` +
        `> ¿Sirve? [ ] sí  [ ] ajustar  [ ] reserva\n\n---\n\n`;
      fs.appendFileSync(SALIDA, bloque);   // append-only: si truena, no pierdes lo hecho
      console.log('ok');
    } catch (err) {
      // NO escribimos la marca <!-- marco:ID --> al fallar: así la reanudación
      // vuelve a intentarlo. (Este era el bug de la primera versión.)
      if (/429|RESOURCE_EXHAUSTED|quota/i.test(err.message)) {
        console.log('\n\n⛔ CUOTA DIARIA DE GEMINI AGOTADA.');
        console.log(`   Faltan ${pendientes.length - n + 1} marcos.`);
        console.log('   Espera el reinicio (24h) y vuelve a correr el script: seguirá donde quedó.');
        console.log('   Revisa tu uso real en https://ai.dev/rate-limit\n');
        return;
      }
      console.log(`FALLÓ — ${err.message.slice(0, 90)}`);
    }
    await new Promise((r) => setTimeout(r, PAUSA_MS));
  }

  console.log(`\n✓ Listo. Abre ${SALIDA} y léelo de corrido.\n`);
}

auditar().catch((e) => { console.error('\n❌', e); process.exit(1); });
