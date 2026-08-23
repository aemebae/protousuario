// PROTOUSUARIO / AGENTE-ESPEJO — COMPILADOR DE GUION
//   node scripts/compilar_guion.js
//
// ═══════════════════════════════════════════════════════════════════════════
//  QUÉ RESUELVE
//  Hay dos archivos que parecían competir y en realidad se necesitan:
//
//    instrucciones_permanentes.json   ← EL TUYO. Aquí escribes y editas.
//              │                        Solo tus textos, cómodos de leer.
//              │  node scripts/compilar_guion.js
//              ↓
//    guion_performance.json           ← EL DE LA MÁQUINA. No lo edites a mano.
//                                       Lleva los huecos de Gemini intercalados
//                                       en el orden exacto de la escena.
//
//  Tú tocas el de arriba. El comando genera el de abajo. Así nunca más tienes
//  que acordarte de dónde va cada hueco: eso lo pone este script.
//
// ═══════════════════════════════════════════════════════════════════════════
//  CÓMO SE ESCRIBE instrucciones_permanentes.json
//
//  Cada agente tiene una lista "actos". Cada acto es una línea tuya. Además
//  puedes escribir "preguntas": líneas para el micrófono, que salen al final.
//
//    "donald-prompt": {
//      "nombre": "Donald-Prompt",
//      "estado": "PANOPTICO",
//      "id_agente": "Soy Donald-Prompt, tu agente…",   ← su presentación
//      "actos": [ "PROTOUSUARIO…", "Luego…", "Ahora…" ],
//      "preguntas": [ "¿…?", "¿…?" ]
//    }
//
//  REGLAS DE ARMADO (las aplica este script, no tú):
//   · id_agente abre siempre.
//   · Después, el primer DATO ORBITAL.
//   · Los actos van en tu orden, intocables.
//   · Detrás de cada acto entra una NARRACIÓN NatGeo… pero no detrás de todos:
//     una por cada dos actos, para que no se vuelva mecánico (mínimo 1).
//   · El SEGUNDO dato orbital entra después del segundo acto, si hay 3 o más.
//   · Las preguntas van después de los actos.
//   · La MEMORIA episódica cierra el agente.
//
//  Si quieres otro orden, cámbialo en ORDEN() aquí abajo, no en el guion.
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';

const ORIGEN = 'instrucciones_permanentes.json';
const DESTINO = 'guion_performance.json';

// Cuántas narraciones NatGeo por agente, según cuántos actos tenga.
// 1-2 actos → 1 narración · 3-4 actos → 2 · 5+ actos → 3
const cuantasNarraciones = (n) => (n <= 2 ? 1 : n <= 4 ? 2 : 3);

function bloquesDeAgente(a) {
  const actos = (a.actos ?? []).filter((t) => t && t.trim());
  const preguntas = (a.preguntas ?? []).filter((t) => t && t.trim());
  const nNar = cuantasNarraciones(actos.length);
  const dosOrbitales = actos.length >= 3;

  // ¿Detrás de qué actos entra narración? Se reparten a lo largo, terminando
  // siempre con una detrás del último acto (que es donde más se necesita).
  const conNarracion = new Set();
  for (let k = 0; k < nNar; k++) {
    conNarracion.add(actos.length - 1 - Math.round((k * (actos.length - 1)) / Math.max(1, nNar)));
  }

  const bloques = [];
  if (a.id_agente?.trim()) bloques.push({ tipo: 'id_agente', texto: a.id_agente.trim() });
  bloques.push({ tipo: 'orbital', gemini: true, texto: '' });

  actos.forEach((texto, i) => {
    bloques.push({ tipo: 'prompt', texto: texto.trim() });
    if (conNarracion.has(i)) bloques.push({ tipo: 'narracion', gemini: true, texto: '' });
    if (i === 1 && dosOrbitales) bloques.push({ tipo: 'orbital', gemini: true, texto: '' });
  });

  preguntas.forEach((texto) => bloques.push({ tipo: 'pregunta', texto: texto.trim() }));
  bloques.push({ tipo: 'memoria', gemini: true, texto: '' });
  return bloques;
}

// ── Compilar ──
const fuente = JSON.parse(fs.readFileSync(ORIGEN, 'utf8'));
const orden = fuente.orden ?? Object.keys(fuente.agentes ?? {});

const guion = {
  _uso: `GENERADO por scripts/compilar_guion.js el ${new Date().toISOString().slice(0, 16).replace('T', ' ')}. NO EDITAR A MANO: edita ${ORIGEN} y vuelve a compilar.`,
  _tipos: 'id_agente · orbital(gemini) · prompt(tuyo) · narracion(gemini) · pregunta(tuya) · memoria(gemini)',
  _avanzar: 'cada bloque espera un AVANZAR del celular',
  agentes: [],
  cierre: fuente.cierre ?? '',
};

let totalBloques = 0;
for (const id of orden) {
  const a = fuente.agentes?.[id];
  if (!a) { console.warn(`  ⚠ "${id}" está en "orden" pero no en "agentes" — se salta.`); continue; }
  const bloques = bloquesDeAgente(a);
  totalBloques += bloques.length;
  guion.agentes.push({ id, nombre: a.nombre ?? id, estado: a.estado ?? 'LIMINAL', bloques });

  const cuenta = bloques.reduce((m, b) => ({ ...m, [b.tipo]: (m[b.tipo] ?? 0) + 1 }), {});
  const sinEscribir = bloques.filter((b) => !b.gemini && /REEMPLAZA ESTE TEXTO/i.test(b.texto)).length;
  console.log(`  ${(a.nombre ?? id).padEnd(24)} ${bloques.length} bloques  ${JSON.stringify(cuenta)}`
    + (sinEscribir ? `   ⚠ ${sinEscribir} SIN ESCRIBIR` : ''));
}

// Copia de seguridad del guion anterior, por si acaso.
if (fs.existsSync(DESTINO)) fs.copyFileSync(DESTINO, DESTINO.replace('.json', '.anterior.json'));
fs.writeFileSync(DESTINO, JSON.stringify(guion, null, 2), 'utf8');

console.log(`\n✓ ${DESTINO} escrito · ${guion.agentes.length} agentes · ${totalBloques} bloques`);
console.log(`  (el anterior quedó en ${DESTINO.replace('.json', '.anterior.json')})`);
console.log(`\n  Siguiente paso, para grabar la voz de lo nuevo:`);
console.log(`     node --env-file=.env scripts/prerender_voz.js\n`);
