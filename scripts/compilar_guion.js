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
//  MARCAS CON ALGO DETRÁS (también solas en su línea)
//    @SONIDO nombre                     un mp3 tuyo de "sonidos externos"
//    @SILENCIO [s]                      reposo escrito (SILENCIO_S si no hay número)
//    @CLON figura [s]                   el clon toma ese rostro: se arma corte a
//                                       corte, se sostiene s segundos (12 si no hay
//                                       número) y se pierde entre otras cabezas.
//                                       Vale en el preludio, en un agente y en el
//                                       cierre.   @CLON vaciar [s] = la muda.
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
// Los @CLON escritos dentro del preludio: { antes: nº de párrafo, figura, segundos }.
// Van aparte de `parrafos` para no mover la numeración de los párrafos (la
// usan la voz pregrabada y el salto ir:N del celular).
const clonesPreludio = [];
const agentes = [];
// El CIERRE ahora es una LISTA de bloques, igual que un agente: una línea =
// un bloque = un audio. Antes se pegaba todo en un solo texto de 3.771
// caracteres — las preguntas se leían de corrido, sin respiro, y el mp3 era
// tan largo que ElevenLabs cortaba por tiempo. Eso fue lo del 27-08.
const cierre = [];
let agente = null;      // agente en construcción
let modo = null;        // 'preludio' | 'cierre' | tipo de bloque mío
let avisos = [];
let nLinea = 0;
// En @MEMORIA TAL CUAL y @NATGEO TAL CUAL, las líneas SEGUIDAS forman una
// estrofa = un bloque = un audio (con sus saltos de línea). Una línea en
// blanco (o cualquier marca) cierra la estrofa. Así una memoria escrita en
// verso suena con su respiración, sin un silencio de 1,4 s en cada verso.
let estrofa = null;

for (const cruda of lineas) {
  nLinea++;
  const t = cruda.trim();
  if (!t) { estrofa = null; continue; }

  // Las viñetas de territorio se leen AUNQUE estén comentadas con #, porque así
  // las tienes escritas en tu archivo. Cualquier otro comentario se ignora.
  if (modo && modo.hueco) {
    // ── TEXTO FIJADO ──
    // Una línea que empieza con "=" debajo de @ORBITAL / @NATGEO / @MEMORIA
    // CONGELA ese hueco: se dice tal cual y Gemini ya no lo escribe. Sirve
    // para guardar una generación que te gustó (ver scripts/fijar_generado.js).
    if (t.startsWith('=')) {
      const fijo = t.slice(1).trim();
      if (fijo) {
        modo.hueco.texto = modo.hueco.texto ? modo.hueco.texto + ' ' + fijo : fijo;
        delete modo.hueco.gemini;
        modo.hueco.fijado = true;
      }
      continue;
    }
    if (modo.esOrbital) {
      const m = t.match(/^#?\s*[•·*+-]\s*(.+)$/);
      if (m) {
        const nombre = m[1].split(/→|->|·/)[0].trim().replace(/\s+/g, ' ');
        if (nombre) (modo.hueco.territorios ??= []).push(nombre);
        continue;
      }
    }
    // ── TU FRASE BASE (v16) ──
    // Texto debajo de @NATGEO o @MEMORIA (sin "=" ni "#") es TU frase: la voz
    // la dice siempre, tal cual, y Gemini agrega un párrafo que la continúa.
    // Varias líneas seguidas forman una sola frase base (se respetan los
    // saltos de línea). Tope total: NATGEO_PALABRAS / MEMORIA_PALABRAS (60).
    if (!modo.esOrbital && !t.startsWith('#') && !t.startsWith('@') && modo.hueco.gemini) {
      modo.hueco.base = modo.hueco.base ? modo.hueco.base + '\n' + t : t;
      continue;
    }
  }
  if (t.startsWith('#')) continue;

  // ── ¿es una marca? ──
  if (t.startsWith('@')) {
    estrofa = null;
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

    // ── @SILENCIO [segundos] ──
    // Un reposo escrito, como el silencio de una partitura musical: no se dice
    // nada, la pantalla se queda como está, y la escena espera.
    //     @SILENCIO        ← lo que diga SILENCIO_S en correr_performance.js (5 s)
    //     @SILENCIO 12     ← este en concreto, 12 s
    // No confundir con el botón PAUSA (que es tuyo, en vivo, e indefinido).
    if (marca === 'SILENCIO') {
      const n = Number(resto[0]);
      const seg = resto.length && Number.isFinite(n) ? Math.max(0, n) : null;   // null = el de siempre
      const bloque = { tipo: 'silencio', segundos: seg, texto: '' };
      if (modo === 'cierre') cierre.push(bloque);
      else if (agente) agente.bloques.push(bloque);
      else avisos.push(`línea ${nLinea}: @SILENCIO fuera de un agente o del cierre`);
      continue;   // no toca `modo`: lo que sigue continúa en su sección
    }

    // ── @CLON figura ──
    // Le dice al clon transespecie qué rostro tomar EN ESE PUNTO de la
    // partitura. No se dice nada y la escena no se detiene: el rostro cambia
    // mientras sigue el bloque siguiente. El nombre es el de la imagen, sin
    // .png, sin importar mayúsculas ni tildes:
    //     @CLON Señora K        ← justo antes de la risa
    //     @CLON jvlix           ← vuelve tu rostro
    //     @CLON Yakuruna
    //     @CLON Señora K 10     ← un número al final = segundos que se sostiene (12 si no)
    //     @CLON Yakuruna 30 fin ← "fin": la pérdida dura hasta que cierra el agente
    //                             (del chat 6, clon v4: el orquestador calcula cuánto falta)
    if (marca === 'CLON') {
      let partes = resto;
      const hastaFin = partes.length > 1 && /^fin$/i.test(partes.at(-1));
      if (hastaFin) partes = partes.slice(0, -1);
      const ultimo = Number(partes.at(-1));
      const conSeg = partes.length > 1 && Number.isFinite(ultimo);
      const figura = (conSeg ? partes.slice(0, -1) : partes).join(' ').trim();
      if (!figura) { avisos.push(`línea ${nLinea}: @CLON sin figura`); continue; }
      const bloque = { tipo: 'clon', figura, segundos: conSeg ? ultimo : 12, texto: '' };
      if (hastaFin) {
        if (modo === 'preludio' || modo === 'cierre' || !agente) avisos.push(`línea ${nLinea}: "fin" solo vale dentro de un agente — se ignora`);
        else bloque.hasta_fin = true;
      }
      // En el preludio: se dispara justo antes del párrafo que le sigue.
      if (modo === 'preludio') {
        clonesPreludio.push({ antes: preludio.length, figura, segundos: bloque.segundos });
        continue;
      }
      if (modo === 'cierre') cierre.push(bloque);
      else if (agente) agente.bloques.push(bloque);
      else avisos.push(`línea ${nLinea}: @CLON fuera de un agente o del cierre`);
      continue;   // como @SONIDO y @SILENCIO: no corta el @PROMPT en curso
    }

    // ── @SONIDO ──
    // Un mp3 tuyo de la carpeta "sonidos externos". Es un bloque como los
    // demás: ocupa su AVANZAR y, en automático, la escena espera a que
    // termine de sonar. No pasa por ElevenLabs ni gasta créditos.
    //     @SONIDO Sonido Rana Croar
    if (marca === 'SONIDO' && modo === 'cierre') {
      const archivo = resto.join(' ').trim();
      if (archivo) cierre.push({ tipo: 'sonido', sonido: archivo, texto: '' });
      continue;
    }
    if (marca === 'SONIDO') {
      if (!agente) { avisos.push(`línea ${nLinea}: @SONIDO fuera de un agente`); continue; }
      const archivo = resto.join(' ').trim();
      if (!archivo) { avisos.push(`línea ${nLinea}: @SONIDO sin nombre de archivo`); continue; }
      agente.bloques.push({ tipo: 'sonido', sonido: archivo, texto: '' });
      // NO se toca `modo`: un sonido se intercala DENTRO de un @PROMPT y las
      // líneas que siguen deben continuar siendo del mismo prompt. Si aquí se
      // reseteara, todo el texto de después se perdería como "texto suelto".
      continue;
    }

    // ── @NATGEO TAL CUAL / @MEMORIA TAL CUAL (v16) ──
    // Texto TUYO que suena con la voz de la máquina, SIN que Gemini agregue
    // nada. Una línea = un bloque, como @PROMPT. Es lo de María:
    //     @MEMORIA TAL CUAL
    //     Recuerdo cuando conocí a María Luisa, …
    const resto_ = resto.join(' ').trim().toUpperCase();
    if ((marca === 'NATGEO' || marca === 'MEMORIA') && /^(TAL CUAL|FIJA|FIJO|FIJAS|FIJOS)$/.test(resto_)) {
      if (!agente) { avisos.push(`línea ${nLinea}: @${marca} fuera de un agente`); continue; }
      modo = HUECOS[marca];          // 'narracion' | 'memoria', como texto tuyo
      continue;
    }

    // ── @FONDO archivo [volumen%]   …   @FONDO FIN (v16) ──
    // Música de tus "sonidos externos" que suena DEBAJO de la voz, baja, y
    // sigue bloque tras bloque hasta @FONDO FIN. @FONDO FIN corta la canción
    // EN LA ÚLTIMA PALABRA del bloque que tiene justo arriba.
    //     @FONDO Patsy Cline (1961) Crazy 25%
    //     …
    //     Te voy a extrañar Lu.
    //     @FONDO FIN
    if (marca === 'FONDO') {
      const destino = modo === 'cierre' ? cierre : agente?.bloques;
      if (!destino) { avisos.push(`línea ${nLinea}: @FONDO fuera de un agente o del cierre`); continue; }
      const arg = resto.join(' ').trim();
      if (/^(fin|parar|stop|corte|cortar)$/i.test(arg)) {
        const ultimo = [...destino].reverse().find((b) => !['fondo', 'clon', 'silencio'].includes(b.tipo));
        if (ultimo) ultimo.cortarFondo = true;
        destino.push({ tipo: 'fondo', accion: 'parar', texto: '' });
        continue;
      }
      const partes = [...resto];
      let volumen = null;
      if (/^\d+(\.\d+)?%$/.test(partes.at(-1) ?? '')) volumen = parseFloat(partes.pop());
      const archivo = partes.join(' ').trim();
      if (!archivo) { avisos.push(`línea ${nLinea}: @FONDO sin archivo`); continue; }
      destino.push({ tipo: 'fondo', accion: 'iniciar', archivo, volumen, texto: '' });
      continue;   // como @SONIDO: no corta la sección en curso
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
      modo = { hueco, esOrbital: marca === 'ORBITAL' };
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
  if (modo === 'cierre') {
    // Limpia lo que queda al pegar desde un JSON:  "¿...?",  →  ¿...?
    // SOLO si la línea viene entre comillas. Una coma al final de un verso
    // tuyo ("como una crisálida seca,") es puntuación y se respeta.
    let limpio = t;
    if (/^["“]/.test(t)) {
      limpio = t.replace(/^["“]\s*/, '').replace(/\s*["”]\s*,?\s*$/, '').trim();
    }
    if (!limpio) continue;
    const esPregunta = /^¿[\s\S]*\?$/.test(limpio);
    cierre.push({ tipo: esPregunta ? 'pregunta' : 'narracion', texto: limpio });
    continue;
  }
  if (!modo || typeof modo !== 'string' || !agente) {
    avisos.push(`línea ${nLinea}: texto suelto sin marca — ignorado: "${t.slice(0, 48)}…"`);
    continue;
  }

  // @MEMORIA TAL CUAL / @NATGEO TAL CUAL: estrofas (ver arriba).
  if (modo === 'memoria' || modo === 'narracion') {
    if (estrofa) { estrofa.texto += '\n' + t; continue; }
    estrofa = { tipo: modo, texto: t };
    agente.bloques.push(estrofa);
    continue;
  }
  const bloque = { tipo: modo, texto: t };
  if (modo === 'pregunta' && !VOZ_EN_PREGUNTAS) bloque.sin_voz = true;
  agente.bloques.push(bloque);
}

// ── Agentes sin nada que decir: se avisan y se saltan ──
const vivos = [];
for (const a of agentes) {
  // Un bloque @SONIDO no tiene texto y no es un hueco de Gemini, pero SÍ es
  // útil: es tu mp3. Sin esta excepción se descartaba en silencio.
  const utiles = a.bloques.filter((b) =>
    b.gemini || ['sonido', 'silencio', 'clon', 'fondo'].includes(b.tipo) || (b.texto && b.texto.trim()));
  const soloId = utiles.length > 0 && utiles.every((b) => b.tipo === 'id_agente');
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
    ...(clonesPreludio.length ? { clon: clonesPreludio } : {}),
  }, null, 2), 'utf8');
}

// ── ¿Cada @CLON encuentra su imagen? La misma búsqueda que hace el clon:
//    nombre exacto, luego "empieza con", luego "contiene" (sin tildes ni
//    mayúsculas). Un error de tipeo se ve AQUÍ y no en plena función. ──
const normF = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\.png$/i, '').replace(/[^a-z0-9]+/g, ' ').trim();
let imagenesClon = null;
try {
  imagenesClon = fs.readdirSync('CLON TRANSESPECIE')
    .filter((n) => /\.png$/i.test(n) && !/^jvlix transespecie/.test(normF(n)));   // maquetas: modelo, no material
} catch { /* sin carpeta: no se puede revisar */ }
function imagenDe(figura) {
  const q = normF(figura);
  if (q === 'vaciar' || !imagenesClon) return true;
  const busca = (k) => imagenesClon.find((f) => normF(f) === k) ?? imagenesClon.find((f) => normF(f).startsWith(k))
                    ?? imagenesClon.find((f) => normF(f).includes(k));
  return busca(q) ?? (q === 'jvlix' ? busca('julix') : q === 'julix' ? busca('jvlix') : null) ?? false;
}
const todosLosClon = [
  ...clonesPreludio.map((c) => ({ ...c, donde: 'PRELUDIO' })),
  ...agentes.flatMap((a) => a.bloques.filter((b) => b.tipo === 'clon').map((b) => ({ ...b, donde: a.nombre }))),
  ...cierre.filter((b) => b.tipo === 'clon').map((b) => ({ ...b, donde: 'CIERRE' })),
];
for (const c of todosLosClon) {
  if (imagenDe(c.figura) === false) avisos.push(`@CLON ${c.figura} (${c.donde}): no encuentro esa imagen en "CLON TRANSESPECIE/" — en la función el clon la ignoraría`);
}

// ── Informe ──
console.log('');
if (preludio.length) console.log(`  PRELUDIO${''.padEnd(16)} ${preludio.length} párrafos`
  + (clonesPreludio.length ? `  · clon: ${clonesPreludio.map((c) => `${c.figura} ${c.segundos}s antes del ${c.antes + 1}`).join(', ')}` : ''));
let total = preludio.length;
for (const a of vivos) {
  const c = a.bloques.reduce((m, b) => ({ ...m, [b.tipo]: (m[b.tipo] ?? 0) + 1 }), {});
  const mios = a.bloques.filter((b) => !b.gemini).length;
  const ia = a.bloques.filter((b) => b.gemini).length;
  const fijados = a.bloques.filter((b) => b.fijado).length;
  const sonidos = a.bloques.filter((b) => b.tipo === 'sonido').length;
  const conBase = a.bloques.filter((b) => b.gemini && b.base).length;
  const fondos = a.bloques.filter((b) => b.tipo === 'fondo' && b.accion === 'iniciar').map((b) => b.archivo);
  total += a.bloques.length;
  console.log(`  ${a.nombre.padEnd(24)} ${String(a.bloques.length).padStart(3)} bloques  `
    + `(${mios} tuyos · ${ia} de Gemini`
    + (conBase ? `, ${conBase} con tu frase base` : '')
    + (fijados ? ` · ${fijados} fijados` : '')
    + (sonidos ? ` · ${sonidos} sonidos` : '')
    + (fondos.length ? ` · fondo: ${fondos.join(', ')}` : '') + `)   ${JSON.stringify(c)}`);
}
if (cierre.length) {
  total += cierre.length;
  const nPreg = cierre.filter((b) => b.tipo === 'pregunta').length;
  const nSil = cierre.filter((b) => b.tipo === 'silencio').length;
  console.log(`  CIERRE${''.padEnd(18)} ${String(cierre.length).padStart(3)} bloques  `
    + `(${nPreg} preguntas${nSil ? ` · ${nSil} silencios` : ''})`);
}

console.log(`\n✓ ${DESTINO} · ${vivos.length} agentes · ${total} bloques en total`);
if (preludio.length) console.log(`✓ ${PRELUDIO_JSON} · ${preludio.length} párrafos`);

if (avisos.length) {
  console.log(`\n⚠ ${avisos.length} aviso(s):`);
  for (const a of avisos) console.log(`   · ${a}`);
}

console.log(`\n  Ahora, para grabar la voz de lo que cambió:`);
console.log(`     node --env-file=.env scripts/prerender_voz.js`);
console.log(`  (lo que ya estaba grabado NO se vuelve a grabar)\n`);
