// node --env-file=.env scripts/prerender_voz.js
// Graba en mp3 TODOS tus textos fijos del guion + las preguntas de la deriva.
// Si el 4G del patio falla, esto suena igual: abre audio_respaldo/index.html.
import fs from 'node:fs'; import path from 'node:path';
const API = process.env.ELEVENLABS_API_KEY, VOZ = process.env.ELEVENLABS_VOICE_ID;
if (!API || !VOZ) { console.error('\nFalta ELEVENLABS_API_KEY o ELEVENLABS_VOICE_ID en .env\n'); process.exit(1); }
const MODELO = process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5';
const SOLO = process.env.SOLO_FIJOS === '1';   // SOLO_FIJOS=1 -> sin preguntas de deriva
const SALIDA = 'audio_respaldo'; fs.mkdirSync(SALIDA, { recursive: true });

const G = JSON.parse(fs.readFileSync('guion_performance.json', 'utf8'));
let PD = []; try { PD = JSON.parse(fs.readFileSync('preguntas_deriva.json','utf8')).preguntas ?? []; } catch {}

const cola = [];
for (const a of G.agentes)
  for (const b of a.bloques)
    if (!b.gemini && b.texto) cola.push({ grupo: a.nombre, tipo: b.tipo, texto: b.texto });
if (G.cierre) cola.push({ grupo: 'CIERRE', tipo: 'narracion', texto: G.cierre });
if (!SOLO) PD.forEach((q) => cola.push({ grupo: 'DERIVA', tipo: 'pregunta', texto: q }));

async function tts(texto, archivo) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOZ}?output_format=mp3_44100_128`, {
    method: 'POST', headers: { 'xi-api-key': API, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: texto, model_id: MODELO,
      voice_settings: { stability: .45, similarity_boost: .8, style: .35, use_speaker_boost: true } }) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${await r.text()}`);
  fs.writeFileSync(path.join(SALIDA, archivo), Buffer.from(await r.arrayBuffer()));
}

const hechos = [];
console.log(`\nGrabando ${cola.length} textos con tu voz clonada...\n`);
for (let i = 0; i < cola.length; i++) {
  const c = cola[i]; const archivo = `${String(i + 1).padStart(3, '0')}_${c.tipo}.mp3`;
  try { await tts(c.texto, archivo); hechos.push({ ...c, archivo }); console.log(`  OK ${archivo}  ${c.grupo}`); }
  catch (e) { console.error(`  X  ${archivo} — ${e.message}`); break; }
}
const html = `<!DOCTYPE html><html lang=es><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>Voz · PROTOUSUARIO</title>
<style>body{margin:0;background:#05080a;color:#d9ffe9;font:14px ui-monospace,monospace;padding:14px}
h2{font-size:11px;letter-spacing:.24em;color:#55ffa6;margin:18px 0 6px}
div{border:1px solid #2b6b49;border-radius:9px;padding:10px;margin:7px 0}
b{display:block;margin-bottom:6px;opacity:.75;font-weight:400}audio{width:100%}</style></head><body>
<h2>VOZ CLONADA · SIN RED</h2>
${hechos.map(h=>`<div><b>${h.grupo} · ${h.tipo}</b>${h.texto.slice(0,110)}…<audio controls preload=none src="${h.archivo}"></audio></div>`).join('\n')}
</body></html>`;
fs.writeFileSync(path.join(SALIDA, 'index.html'), html, 'utf8');
console.log(`\nListo: ${hechos.length}/${cola.length} en ${SALIDA}/  →  abre ${SALIDA}/index.html\n`);
