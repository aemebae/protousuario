// PROTOUSUARIO / AGENTE-ESPEJO — CONGELAR UN TEXTO GENERADO
//   node scripts/fijar_generado.js                 ← muestra lo último generado
//   node scripts/fijar_generado.js --escribir      ← lo mete en tu archivo
//   node scripts/fijar_generado.js donald-prompt --escribir
//
// ═══════════════════════════════════════════════════════════════════════════
//  PARA QUÉ
//  Gemini escribió un dato orbital, una narración o una memoria que te gustó
//  y quieres que se diga TAL CUAL en la función, sin volver a generarse.
//
//  CÓMO FUNCIONA
//  Debajo de un hueco, una línea que empieza con "=" lo congela:
//
//      @NATGEO
//      = Lo que para el insecto es una nube letal, para este primate es un
//
//  El compilador ve el "=" y deja de tratarlo como hueco: pasa a ser texto
//  tuyo, con tu voz de autor, y Gemini ya no lo escribe. Para descongelarlo,
//  borras esa línea y vuelve a ser hueco.
//
//  Este script lee manifiestos_log.jsonl —donde queda todo lo que generó
//  Gemini— y te da esas líneas listas, o las escribe él mismo en su sitio.
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';

const ARCHIVO = 'instrucciones_permanentes.txt';
const LOG = 'manifiestos_log.jsonl';

const args = process.argv.slice(2);
const escribir = args.includes('--escribir');
const soloAgente = args.find((a) => !a.startsWith('--')) ?? null;

// ── 1. Leer la última generación de cada agente ──
if (!fs.existsSync(LOG)) {
  console.error(`\n✗ No hay ${LOG} todavía. Corre una función primero.\n`);
  process.exit(1);
}
const entradas = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter((x) => x && x.generado && x.agente && x.agente !== 'deriva');

if (!entradas.length) {
  console.error(`\n✗ ${LOG} no tiene generaciones de agentes.\n`);
  process.exit(1);
}

// La última de cada agente gana.
const ultimas = new Map();
for (const e of entradas) ultimas.set(e.agente, e);

const MARCA = { dato_orbital: 'ORBITAL', narracion: 'NATGEO', memoria: 'MEMORIA' };

// ── 2. Mostrar ──
console.log('');
const elegidos = [...ultimas.values()].filter((e) => !soloAgente || e.agente === soloAgente);
if (!elegidos.length) {
  console.error(`✗ No hay generaciones de "${soloAgente}".`);
  console.error(`  Disponibles: ${[...ultimas.keys()].join(', ')}\n`);
  process.exit(1);
}

for (const e of elegidos) {
  console.log('─'.repeat(74));
  console.log(`  ${e.agente_nombre ?? e.agente}   ·   ${new Date(e.fecha).toLocaleString('es-PE')}`);
  console.log(`  ${e.satelite ?? '—'} · ${e.territorio ?? '—'} · ${e.estado_marca ?? ''}`);
  console.log('─'.repeat(74));
  for (const [clave, marca] of Object.entries(MARCA)) {
    for (const t of e.generado[clave] ?? []) {
      if (!t?.trim()) continue;
      console.log(`\n  @${marca}`);
      console.log(`  = ${t.trim()}`);
    }
  }
  console.log('');
}

if (!escribir) {
  console.log('═'.repeat(74));
  console.log('  Copia las líneas "= …" y pégalas DEBAJO de su marca en');
  console.log(`  ${ARCHIVO}. Ejemplo:`);
  console.log('');
  console.log('      @NATGEO');
  console.log('      = Lo que para el insecto es una nube letal…');
  console.log('');
  console.log('  O deja que lo haga este script:');
  console.log(`      node scripts/fijar_generado.js${soloAgente ? ' ' + soloAgente : ''} --escribir`);
  console.log('═'.repeat(74) + '\n');
  process.exit(0);
}

// ── 3. Escribir en el archivo, en su sitio ──
if (!fs.existsSync(ARCHIVO)) { console.error(`\n✗ No encuentro ${ARCHIVO}.\n`); process.exit(1); }
fs.copyFileSync(ARCHIVO, ARCHIVO.replace('.txt', '.anterior.txt'));

const lineas = fs.readFileSync(ARCHIVO, 'utf8').split(/\r?\n/);
const salida = [];
let agenteActual = null;
let pendientes = null;      // { ORBITAL: [...], NATGEO: [...], MEMORIA: [...] }
let puestos = 0, saltados = 0;

const colaDe = (e) => {
  const c = { ORBITAL: [], NATGEO: [], MEMORIA: [] };
  for (const [clave, marca] of Object.entries(MARCA)) {
    for (const t of e.generado[clave] ?? []) if (t?.trim()) c[marca].push(t.trim());
  }
  return c;
};

for (let i = 0; i < lineas.length; i++) {
  const linea = lineas[i];
  const t = linea.trim();
  salida.push(linea);

  const mAg = t.match(/^@AGENTE\s+([^\s|]+)/i);
  if (mAg) {
    agenteActual = mAg[1];
    const e = ultimas.get(agenteActual);
    pendientes = (e && (!soloAgente || soloAgente === agenteActual)) ? colaDe(e) : null;
    continue;
  }

  const mHueco = t.match(/^@(ORBITAL|NATGEO|MEMORIA)\b/i);
  if (!mHueco || !pendientes) continue;
  const marca = mHueco[1].toUpperCase();

  // ¿Ya está congelado? Se mira si más abajo, antes de otra marca, hay un "=".
  let yaFijado = false;
  for (let j = i + 1; j < lineas.length; j++) {
    const u = lineas[j].trim();
    if (!u) continue;
    if (u.startsWith('@')) break;
    if (u.startsWith('=')) { yaFijado = true; break; }
  }
  const texto = pendientes[marca].shift();
  if (!texto) continue;
  if (yaFijado) { saltados++; continue; }

  salida.push(`= ${texto}`);
  puestos++;
}

fs.writeFileSync(ARCHIVO, salida.join('\n'), 'utf8');

console.log('═'.repeat(74));
console.log(`✓ ${puestos} texto(s) congelados en ${ARCHIVO}`);
if (saltados) console.log(`  ${saltados} se saltaron: ya tenían un "=" debajo.`);
console.log(`  Copia de seguridad: ${ARCHIVO.replace('.txt', '.anterior.txt')}`);
console.log('');
console.log('  Ahora:');
console.log('     node scripts/compilar_guion.js            ← debe decir "· N fijados"');
console.log('     node --env-file=.env scripts/prerender_voz.js   ← graba los nuevos fijos');
console.log('');
console.log('  Para descongelar cualquiera: borra su línea "= …" y recompila.');
console.log('═'.repeat(74) + '\n');
