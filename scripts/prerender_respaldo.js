// PROTOUSUARIO / AGENTE-ESPEJO — Pre-render de audio de respaldo (ElevenLabs)
//
// PARA QUÉ: si en el Patio de las Artes el 4G no alcanza, ElevenLabs no
// responde y la voz clonada se cae. Estos archivos son el salvavidas: el
// Preludio y los 5 Agente-ID ya renderizados en disco. Se reproducen con
// cualquier reproductor (o con el mismo navegador) sin tocar la red.
//
// CORRE ASÍ, EN CASA, CON BUEN INTERNET:
//    node --env-file=.env scripts/prerender_respaldo.js
//
// Deja los mp3 en  audio_respaldo/  y un index.html para dispararlos a mano
// desde el celular o la laptop, en orden, si todo lo demás falla.

import fs from 'node:fs';
import path from 'node:path';

const API = process.env.ELEVENLABS_API_KEY;
const VOZ = process.env.ELEVENLABS_VOICE_ID;
if (!API || !VOZ) {
  console.error('\n❌ Falta ELEVENLABS_API_KEY o ELEVENLABS_VOICE_ID en .env\n');
  process.exit(1);
}

const MODELO = process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5';
const SALIDA = 'audio_respaldo';
fs.mkdirSync(SALIDA, { recursive: true });

const preludio = JSON.parse(fs.readFileSync('preludio.json', 'utf8'));
const { orden, agentes } = JSON.parse(fs.readFileSync('agentes.json', 'utf8'));

// Se usa el endpoint HTTP simple (no WebSocket): aquí no importa la latencia,
// importa que el archivo quede completo y bien en disco.
async function renderizar(texto, nombreArchivo) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOZ}?output_format=mp3_44100_128`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': API, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: texto,
      model_id: MODELO,
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${await r.text()}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const destino = path.join(SALIDA, nombreArchivo);
  fs.writeFileSync(destino, buf);
  console.log(`  ✓ ${nombreArchivo}  (${(buf.length / 1024).toFixed(0)} KB)`);
  return nombreArchivo;
}

const piezas = [];
console.log('\nRenderizando respaldo de voz...\n');
try {
  piezas.push({ titulo: 'PRELUDIO', archivo: await renderizar(preludio.texto, '00_preludio.mp3') });
  let i = 1;
  for (const id of orden) {
    const a = agentes.find((x) => x.id === id);
    if (!a?.agente_id_texto) continue;
    piezas.push({
      titulo: a.agente,
      archivo: await renderizar(a.agente_id_texto, `${String(i).padStart(2, '0')}_${id}.mp3`),
    });
    i++;
  }
} catch (e) {
  console.error('\n⚠ Falló en:', e.message);
  console.error('  Lo que ya se descargó sirve igual. Revisa cupo o clave.\n');
}

// Panel para disparar los audios a mano, sin red, desde cualquier navegador.
const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Respaldo de voz — PROTOUSUARIO</title>
<style>body{margin:0;background:#05080a;color:#d9ffe9;font:15px ui-monospace,monospace;padding:16px}
h1{font-size:12px;letter-spacing:.24em;color:#55ffa6;opacity:.8}
div{border:1px solid #2b6b49;border-radius:10px;padding:12px;margin:10px 0}
b{display:block;margin-bottom:8px;color:#55ffa6}audio{width:100%}</style></head><body>
<h1>RESPALDO DE VOZ · SIN RED</h1>
${piezas.map((p) => `<div><b>${p.titulo}</b><audio controls preload="auto" src="${p.archivo}"></audio></div>`).join('\n')}
</body></html>`;
fs.writeFileSync(path.join(SALIDA, 'index.html'), html, 'utf8');

console.log(`\n✓ Listo: ${piezas.length} audios en ${SALIDA}/`);
console.log(`  Panel offline: abre ${SALIDA}/index.html en Chrome (laptop o celular).\n`);
