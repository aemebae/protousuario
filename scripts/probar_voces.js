// PROTOUSUARIO / AGENTE-ESPEJO — OÍR LAS DOS VOCES ANTES DE GRABARLO TODO
//   node --env-file=.env scripts/probar_voces.js
//   node --env-file=.env scripts/probar_voces.js "el texto que quieras probar"
//
// ═══════════════════════════════════════════════════════════════════════════
//  PARA QUÉ
//  El pre-render completo son ~11.800 créditos. Antes de soltarlos conviene
//  oír cómo suena cada voz con TUS ajustes. Este script graba UNA frase corta
//  con cada configuración y te deja un panel para compararlas.
//
//  CUESTA: unos 300 créditos en total (dos frases cortas). Nada.
//
//  QUÉ COMPARAS
//    VOZ AUTOR → tus @PROMPT, @PREGUNTA, @PRELUDIO, @ID, @CIERRE
//    VOZ IA    → los @ORBITAL, @NATGEO, @MEMORIA y la @DERIVA
//  Si en .env solo pusiste VOZ_IA_STABILITY y VOZ_IA_STYLE, las dos usan la
//  MISMA voz clonada: lo que cambia es el temperamento, no el timbre.
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { grabar, huella, DIR_CACHE, VOZ_AUTOR, VOZ_IA } from './voz.js';

const PRUEBA_AUTOR = process.argv[2]
  || 'PROTOUSUARIO ubica al público. Se acerca a cada persona enmascarada y les saca las máscaras, una por una.';
const PRUEBA_IA = process.argv[2]
  || 'Desde cuatrocientos kilómetros de altitud, el satélite sobrevuela el este del Congo. Aquí abajo, la especie ensaya una coreografía que la excede.';

const ajustes = (sufijo) => ({
  stability: process.env[`VOZ${sufijo}_STABILITY`] ?? process.env.VOZ_STABILITY ?? '0.45 (por defecto)',
  style: process.env[`VOZ${sufijo}_STYLE`] ?? process.env.VOZ_STYLE ?? '0.35 (por defecto)',
  similarity: process.env[`VOZ${sufijo}_SIMILARITY`] ?? process.env.VOZ_SIMILARITY ?? '0.8 (por defecto)',
  speed: process.env[`VOZ${sufijo}_SPEED`] ?? process.env.VOZ_SPEED ?? '1.0 (por defecto)',
});

const idAutor = process.env.ELEVENLABS_VOICE_ID || '(sin definir)';
const idIA = process.env.ELEVENLABS_VOICE_ID_IA || idAutor;

console.log('\n' + '═'.repeat(72));
console.log('  PRUEBA DE VOCES');
console.log('═'.repeat(72));
console.log(`  modelo: ${process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2'}`);
console.log('');
console.log(`  VOZ AUTOR   id ${idAutor}`);
console.log(`              ${JSON.stringify(ajustes(''))}`);
console.log('');
console.log(`  VOZ IA      id ${idIA}${idIA === idAutor ? '   (la misma voz, otros ajustes)' : '   (voz distinta)'}`);
console.log(`              ${JSON.stringify(ajustes('_IA'))}`);
console.log('═'.repeat(72) + '\n');

if (idAutor === '(sin definir)') {
  console.error('✗ Falta ELEVENLABS_VOICE_ID en .env\n');
  process.exit(1);
}
if (idIA === idAutor
    && !process.env.VOZ_IA_STABILITY && !process.env.VOZ_IA_STYLE
    && !process.env.VOZ_IA_SIMILARITY && !process.env.VOZ_IA_SPEED) {
  console.warn('⚠ Las dos voces son idénticas: mismo id y mismos ajustes.');
  console.warn('  Añade a .env, por ejemplo:');
  console.warn('     VOZ_IA_STABILITY=0.85');
  console.warn('     VOZ_IA_STYLE=0.05\n');
}

const hechos = [];
for (const [etiqueta, cual, texto] of [
  ['VOZ AUTOR — tus prompts y preguntas', VOZ_AUTOR, PRUEBA_AUTOR],
  ['VOZ IA — dato orbital, narración, memoria', VOZ_IA, PRUEBA_IA],
]) {
  try {
    // Siempre se regraba: es una prueba, quieres oír los ajustes de AHORA.
    const archivo = await grabar(texto, { dir: DIR_CACHE, cual });
    hechos.push({ etiqueta, cual, texto, archivo });
    console.log(`  ✓ ${etiqueta}`);
    console.log(`    ${path.join(DIR_CACHE, archivo)}  (${texto.length} créditos)\n`);
  } catch (e) {
    console.error(`  ✗ ${etiqueta}: ${e.message}\n`);
  }
}

if (!hechos.length) process.exit(1);

const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Prueba de voces — PROTOUSUARIO</title>
<style>
 body{margin:0;background:#05080a;color:#d9ffe9;font:15px ui-monospace,monospace;padding:18px}
 h1{font-size:11px;letter-spacing:.28em;color:#55ffa6;opacity:.75}
 div{border:1px solid #1d4a34;border-radius:10px;padding:13px;margin:14px 0}
 b{display:block;font-size:10px;letter-spacing:.2em;color:#ffc65f;margin-bottom:8px}
 p{font-size:13px;line-height:1.55;opacity:.85;margin:0 0 10px}
 audio{width:100%}
 small{display:block;margin-top:8px;font-size:10px;opacity:.4}
</style></head><body>
<h1>PRUEBA DE VOCES</h1>
${hechos.map((h) => `<div><b>${h.etiqueta}</b><p>${h.texto.replace(/</g, '&lt;')}</p>
 <audio controls preload="auto" src="../${DIR_CACHE}/${h.archivo}"></audio>
 <small>${h.archivo}</small></div>`).join('\n')}
<small>Escúchalas seguidas. ¿Se distinguen? Si no, sube VOZ_IA_STABILITY y baja VOZ_IA_STYLE, y vuelve a correr este script.</small>
</body></html>`;
fs.mkdirSync('audio_respaldo', { recursive: true });
fs.writeFileSync(path.join('audio_respaldo', 'prueba_voces.html'), html, 'utf8');

console.log('═'.repeat(72));
console.log('  Abre esto en Chrome y escúchalas seguidas:');
console.log('     audio_respaldo\\prueba_voces.html');
console.log('');
console.log('  ¿No se distinguen? Sube VOZ_IA_STABILITY (más plana) y baja');
console.log('  VOZ_IA_STYLE (menos carácter). Vuelve a correr este script.');
console.log('  Cuando te guste, ya sí:');
console.log('     node --env-file=.env scripts/prerender_voz.js');
console.log('═'.repeat(72) + '\n');
