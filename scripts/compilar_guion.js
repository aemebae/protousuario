// PROTOUSUARIO / AGENTE-ESPEJO — COMPILADOR DE GUION  ·  v2
//   node scripts/compilar_guion.js
//
// ═══════════════════════════════════════════════════════════════════════════
//  QUÉ CAMBIA RESPECTO A v1
//  La v1 leía un JSON con llaves, comillas y comas: igual de incómodo que el
//  guion. Tenías razón. Ahora lee TEXTO PLANO en TU formato, el del .docx:
//  marcas al principio de línea y texto debajo. Se edita en el Bloc de notas,
//  en VS Code o en Word (guardando como .txt en UTF-8).
//
//        instrucciones_permanentes.txt      ← EL TUYO. Texto plano.
//                    │
//                    │   node scripts/compilar_guion.js
//                    ↓
//        guion_performance.json  +  preludio.json     ← para la máquina
//
//  Y EL CAMBIO DE FONDO: la v1 decidía dónde iban las narraciones y las
//  preguntas. Ya no decide nada. **Tu archivo ES la partitura, literal.**
//  Si escribes @NATGEO ahí, ahí va. Si una pregunta va en medio de dos
//  prompts, va en medio. Nunca se reordena, nunca se agrupa.
//
// ═══════════════════════════════════════════════════════════════════════════
//  LAS MARCAS (van solas en su línea)
//    @PRELUDIO                          arranca el preludio (una sola vez)
//    @AGENTE  id | Nombre | ESTADO      arranca un agente
//    @ID                                su presentación — texto tuyo
//    @PROMPT                            texto tuyo: acción del cuerpo
//    @PREGUNTA                          pregunta que TÚ dices al micrófono
//    @ORBITAL   @NATGEO   @MEMORIA      huecos: los escribe Gemini en vivo
//    @DERIVA                            marca dónde entra el pasaje final
//    @CIERRE                            el último texto de la obra
//    # …                                nota tuya, se ignora
//
//  UNA LÍNEA = UN BLOQUE = UN AVANZAR = UN AUDIO.
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';

const ORIGEN = 'instrucciones_permanentes.txt';
const DESTINO = 'guion_performance.json';
const PRELUDIO_JSON = 'preludio.json';

// ¿La voz clonada dice también las preguntas?
// Mowgli confirmó: la voz clonada dice la pregunta PRIMERO y él la repite
// después al micrófono. Así no tiene que memorizar 15 preguntas.
const VOZ_EN_PREGUNTAS = true;

if (!fs.existsSync(ORIGEN)) {
  console.error(`\n✗ No encuentro ${ORIGEN}.\n`);
  process.exit(1);
}

const lineas = fs.readFileSync(ORIGEN, 'utf8').split(/\r?\n/);

const HUECOS = { ORBITAL: 'orbital', NATGEO: 'narracion', MEMORIA: 'memoria' };
const MIOS = { PROMPT: 'prompt', PREGUNTA: 'pregunta', ID: 'id_agente' };

const preludio = [];
const agentes = [];
let cierre = '';
let agente = null;      // agente en construcción
let modo = null;        // 'preludio' | 'cierre' | tipo de bloque mío
let avisos = [];
let nLinea = 0;

for (const cruda of lineas) {
  nLinea++;
  const t = cruda.trim();
  if (!t) continue;

  // Las viñetas de territorio se leen AUNQUE estén comentadas con #, porque así
  // las tienes escritas en tu archivo. Cualquier otro comentario se ignora.
  if (modo && modo.hueco) {
    const m = t.match(/^#?\s*[•·*+-]\s*(.+)$/);
    if (m) {
      const nombre = m[1].split(/→|->|·/)[0].trim().replace(/\s+/g, ' ');
      if (nombre) (modo.hueco.territorios ??= []).push(nombre);
      continue;
    }
  }
  if (t.startsWith('#')) continue;

  // ── ¿es una marca? ──
  if (t.startsWith('@')) {
    const [marcaCruda, ...resto] = t.slice(1).split(/\s+/);
    const marca = marcaCruda.toUpperCase();

    if (marca === 'PRELUDIO') { modo = 'preludio'; continue; }
    if (marca === 'CIERRE') { modo = 'cierre'; continue; }
    if (marca === 'DERIVA') { modo = null; continue; }   // el final entra solo

    if (marca === 'AGENTE') {
      const partes = resto.join(' ').split('|').map((x) => x.trim());
      if (!partes[0]) { avisos.push(`línea ${nLinea}: @AGENTE sin id`); continue; }
      agente = {
        id: partes[0],
        nombre: partes[1] || partes[0],
        estado: (partes[2] || 'LIMINAL').toUpperCase(),
        bloques: [],
      };
      agentes.push(agente);
      modo = null;
      continue;
    }

    if (HUECOS[marca]) {
      if (!agente) { avisos.push(`línea ${nLinea}: @${marca} fuera de un agente`); continue; }
      const hueco = { tipo: HUECOS[marca], gemini: true, texto: '' };
      agente.bloques.push(hueco);
      // Un @ORBITAL puede llevar debajo los DOS territorios que quieres que se
      // nombren, escritos con viñeta. Se leen aunque estén comentados con #,
      // que es como los tienes escritos:
      //     @ORBITAL
      //     # • El este de la República Democrática del Congo → este (94°) · ✖ DESPLAZADO
      //     # • La frontera México-Estados Unidos → noroeste (325°) · ★ AUTORIZADO
      // Solo se toma el NOMBRE (lo que va antes de la flecha): el rumbo, los
      // grados y el estado los calcula el motor en vivo, con el satélite real.
      modo = marca === 'ORBITAL' ? { hueco } : null;
      continue;
    }

    if (MIOS[marca]) {
      if (!agente) { avisos.push(`línea ${nLinea}: @${marca} fuera de un agente`); continue; }
      modo = MIOS[marca];
      continue;
    }

    avisos.push(`línea ${nLinea}: marca desconocida "@${marcaCruda}"`);
    continue;
  }

  // ── es contenido ──
  if (modo === 'preludio') { preludio.push(t); continue; }
  if (modo === 'cierre') { cierre = cierre ? cierre + ' ' + t : t; continue; }
  if (!modo || typeof modo !== 'string' || !agente) {
    avisos.push(`línea ${nLinea}: texto suelto sin marca — ignorado: "${t.slice(0, 48)}…"`);
    continue;
  }

  const bloque = { tipo: modo, texto: t };
  if (modo === 'pregunta' && !VOZ_EN_PREGUNTAS) bloque.sin_voz = true;
  agente.bloques.push(bloque);
}

// ── Agentes sin nada que decir: se avisan y se saltan ──
const vivos = [];
for (const a of agentes) {
  const utiles = a.bloques.filter((b) => b.gemini || (b.texto && b.texto.trim()));
  const soloId = utiles.every((b) => b.tipo === 'id_agente');
  if (!utiles.length || soloId) {
    avisos.push(`${a.nombre}: sin bloques — se salta (¿"lo voy a saltar esta vez"?)`);
    continue;
  }
  a.bloques = utiles;
  vivos.push(a);
}

// ── Escribir ──
const guion = {
  _uso: `GENERADO por scripts/compilar_guion.js el ${new Date().toISOString().slice(0, 16).replace('T', ' ')} desde ${ORIGEN}. NO EDITAR A MANO.`,
  _tipos: 'id_agente · orbital(gemini) · prompt(tuyo) · narracion(gemini) · pregunta(tuya) · memoria(gemini)',
  _avanzar: 'cada bloque espera un AVANZAR del celular',
  agentes: vivos,
  cierre,
};

if (fs.existsSync(DESTINO)) fs.copyFileSync(DESTINO, DESTINO.replace('.json', '.anterior.json'));
fs.writeFileSync(DESTINO, JSON.stringify(guion, null, 2), 'utf8');

if (preludio.length) {
  fs.writeFileSync(PRELUDIO_JSON, JSON.stringify({
    _uso: `GENERADO desde ${ORIGEN}. Se reproduce UNA SOLA VEZ al inicio, párrafo a párrafo.`,
    titulo: 'Preludio.',
    parrafos: preludio,
    texto: preludio.join('\n'),
  }, null, 2), 'utf8');
}

// ── Informe ──
console.log('');
if (preludio.length) console.log(`  PRELUDIO${''.padEnd(16)} ${preludio.length} párrafos`);
let total = preludio.length;
for (const a of vivos) {
  const c = a.bloques.reduce((m, b) => ({ ...m, [b.tipo]: (m[b.tipo] ?? 0) + 1 }), {});
  const mios = a.bloques.filter((b) => !b.gemini).length;
  const ia = a.bloques.filter((b) => b.gemini).length;
  total += a.bloques.length;
  console.log(`  ${a.nombre.padEnd(24)} ${String(a.bloques.length).padStart(3)} bloques  `
    + `(${mios} tuyos · ${ia} de Gemini)   ${JSON.stringify(c)}`);
}
if (cierre) { total++; console.log(`  CIERRE${''.padEnd(18)}   1 bloque`); }

console.log(`\n✓ ${DESTINO} · ${vivos.length} agentes · ${total} bloques en total`);
if (preludio.length) console.log(`✓ ${PRELUDIO_JSON} · ${preludio.length} párrafos`);

if (avisos.length) {
  console.log(`\n⚠ ${avisos.length} aviso(s):`);
  for (const a of avisos) console.log(`   · ${a}`);
}

console.log(`\n  Ahora, para grabar la voz de lo que cambió:`);
console.log(`     node --env-file=.env scripts/prerender_voz.js`);
console.log(`  (lo que ya estaba grabado NO se vuelve a grabar)\n`);
