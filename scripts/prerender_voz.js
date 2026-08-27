// PROTOUSUARIO / AGENTE-ESPEJO — PRE-RENDERIZADO DE VOZ
//   node --env-file=.env scripts/prerender_voz.js
//
// Graba en mp3 TODO lo que ya está escrito y no cambia: el preludio, tus
// prompts, tus preguntas, las presentaciones de cada agente, el cierre y las
// preguntas de la deriva.
//
// LOS ARCHIVOS SE LLAMAN POR LA HUELLA DE SU TEXTO (ver scripts/voz.js). Eso
// significa que la performance los ENCUENTRA SOLA: cuando le toque decir ese
// texto, mira en disco, lo halla, y no toca internet. En el patio, todo lo
// tuyo suena sin red. Solo lo que escriba Gemini necesitará conexión.
//
// Deja además audio_respaldo/index.html: un panel para dispararlos a mano
// desde Chrome (laptop o celular) si TODO lo demás falla.
//
// OPCIONES:
//   SOLO_FIJOS=1   → sin las preguntas de la deriva (más rápido, menos cuota)
//   REGRABAR=1     → vuelve a grabar aunque ya exista (si cambiaste la voz)

import fs from 'node:fs';
import path from 'node:path';
import { grabar, buscarEnDisco, DIR_RESPALDO, VOZ_AUTOR, VOZ_IA } from './voz.js';

const SOLO_FIJOS = process.env.SOLO_FIJOS === '1';
const REGRABAR = process.env.REGRABAR === '1';

const leer = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

const G = leer('guion_performance.json');
const PRE = leer('preludio.json');
const PD = leer('preguntas_deriva.json');

// ── Reunir todo lo que hay que grabar ──
const cola = [];
const añadir = (grupo, tipo, texto, cual = VOZ_AUTOR) => {
  const t = (texto ?? '').trim();
  if (t) cola.push({ grupo, tipo, texto: t, cual });
};

// El preludio se graba PÁRRAFO A PÁRRAFO, igual que se dice en escena.
if (PRE?.texto || PRE?.parrafos) {
  (PRE.parrafos?.length ? PRE.parrafos : PRE.texto.split(/\n+/)).map((t) => t.trim()).filter(Boolean)
    .forEach((t, i) => añadir('PRELUDIO', `párrafo ${i + 1}`, t));
}

for (const a of G?.agentes ?? []) {
  for (const b of a.bloques ?? []) {
    // b.gemini  → cambia cada función, no se puede pre-grabar
    // b.sin_voz  → lo dice PROTOUSUARIO al micrófono
    // tipo sonido→ es un mp3 tuyo, no pasa por ElevenLabs
    // b.fijado   → era un hueco y lo congelaste: SÍ se pre-graba, con voz IA,
    //              porque lo escribió Gemini y así conserva su timbre.
    if (b.gemini || b.sin_voz || b.tipo === 'sonido') continue;
    añadir(a.nombre, b.tipo, b.texto, b.fijado ? VOZ_IA : VOZ_AUTOR);
  }
}
añadir('CIERRE', 'narracion', G?.cierre);
// La deriva la dice la voz IA: PROTOUSUARIO ya no está para repetirla.
if (!SOLO_FIJOS) (PD?.preguntas ?? []).forEach((q) => añadir('DERIVA', 'pregunta', q, VOZ_IA));

// ── Grabar ──
console.log(`\n${cola.length} textos fijos en el guion.\n`);
let nuevos = 0, saltados = 0, fallos = 0;
const hechos = [];

for (const item of cola) {
  const yaEsta = buscarEnDisco(item.texto, item.cual);
  if (yaEsta && !REGRABAR) {
    saltados++;
    hechos.push({ ...item, archivo: yaEsta });
    continue;
  }
  try {
    const archivo = await grabar(item.texto, { dir: DIR_RESPALDO, cual: item.cual });
    nuevos++;
    hechos.push({ ...item, archivo });
    console.log(`  ✓ ${item.grupo} · ${item.tipo}  →  ${archivo}`);
  } catch (e) {
    fallos++;
    console.error(`  ✗ ${item.grupo} · ${item.tipo}: ${e.message}`);
  }
}

// ── Panel offline ──
const grupos = [...new Set(hechos.map((h) => h.grupo))];
const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Respaldo de voz — PROTOUSUARIO</title>
<style>
 body{margin:0;background:#05080a;color:#d9ffe9;font:15px ui-monospace,monospace;padding:14px}
 h1{font-size:11px;letter-spacing:.28em;color:#55ffa6;opacity:.75;margin:0 0 4px}
 p.n{font-size:11px;opacity:.45;margin:0 0 18px}
 h2{font-size:11px;letter-spacing:.24em;color:#ffc65f;margin:24px 0 8px;
    border-bottom:1px solid #2b6b49;padding-bottom:6px}
 div.p{border:1px solid #1d4a34;border-radius:9px;padding:10px;margin:8px 0}
 b{display:block;font-size:9px;letter-spacing:.2em;color:#55ffa6;opacity:.6;margin-bottom:5px}
 span{display:block;font-size:13px;line-height:1.5;opacity:.85;margin-bottom:8px}
 audio{width:100%}
</style></head><body>
<h1>RESPALDO DE VOZ · FUNCIONA SIN RED</h1>
<p class="n">${hechos.length} audios · generado ${new Date().toISOString().slice(0, 16).replace('T', ' ')}</p>
${grupos.map((g) => `<h2>${g}</h2>` + hechos.filter((h) => h.grupo === g).map((h) =>
  `<div class="p"><b>${h.tipo}</b><span>${h.texto.replace(/</g, '&lt;').slice(0, 240)}</span>
   <audio controls preload="none" src="${h.archivo}"></audio></div>`).join('\n')).join('\n')}
</body></html>`;
fs.writeFileSync(path.join(DIR_RESPALDO, 'index.html'), html, 'utf8');

console.log(`\n✓ ${nuevos} nuevos · ${saltados} ya estaban · ${fallos} fallaron`);
console.log(`  Panel offline: ${DIR_RESPALDO}/index.html`);
console.log(`  Estos textos ya NO tocarán internet durante la función.\n`);
