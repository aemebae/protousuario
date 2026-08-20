// PROTOUSUARIO / AGENTE-ESPEJO — Ensamblaje de la secuencia del Prompt-Manifiesto
// ═══════════════════════════════════════════════════════════════════════════
// QUIÉN ESCRIBE QUÉ (esta es la regla de oro del sistema)
//
//   TÚ escribes  → los ACTOS. Viven en instrucciones_permanentes.json.
//                  Gemini los LEE pero NO los toca. Se imprimen tal cual.
//   Gemini escribe → DATO ORBITAL ×2, NARRACIÓN NATGEO ×(un acto = una
//                  narración), MEMORIA EPISÓDICA ×1. Nada más.
//   El PATRÓN decide → dónde cae la memoria. Rota, no sortea.
//
// FORMA DEL RESULTADO
//   Un array de { tipo, texto } listo para emitirSegmento(), donde tipo es:
//     'orbital'   → rótulo DATO ORBITAL, monoespaciada
//     'prompt'    → rótulo PROMPT solo la primera vez, cuerpo grande
//     'narracion' → SIN rótulo, serif documental (la voz NatGeo)
//     'memoria'   → SIN rótulo, cursiva sangrada (voz interior)
//
// POR QUÉ NO ES ALEATORIO: en escena, el azar es un riesgo, no una virtud.
// Con patrones rotativos puedes ensayar la función completa y saber qué va a
// pasar, y aun así ninguna función se parece a la anterior.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Reemplaza las fichas {ESTADO} {TERRITORIO} {UBICACION} {RUMBO} {SATELITE}
 * dentro de un texto tuyo, para que tus actos se contaminen del dato real
 * sin que tengas que escribirlos de nuevo cada vez.
 */
export function rellenarFichas(texto, ctx) {
  return String(texto)
    .replaceAll('{ESTADO}', ctx.estado_marca ?? '')
    .replaceAll('{TERRITORIO}', ctx.territorio_nombre ?? '')
    .replaceAll('{UBICACION}', ctx.territorio_texto ?? '')
    .replaceAll('{RUMBO}', ctx.rumbo_texto ?? '')
    .replaceAll('{SATELITE}', ctx.satelite ?? '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * @param {object} p
 * @param {string[]} p.actos            TUS textos, ya con fichas rellenadas
 * @param {object}   p.generado         { orbital_1, orbital_2, memoria, narraciones[] }
 * @param {object}   p.patron           entrada de patrones_secuencia.json
 * @param {string[]} p.narracionesRespaldo  salvavidas si Gemini quedó corto
 * @param {object}   p.ctx              contexto para rellenar el respaldo
 * @returns {{segmentos: Array<{tipo:string,texto:string}>, avisos: string[]}}
 */
export function ensamblarSecuencia({ actos, generado, patron, narracionesRespaldo = [], ctx = {} }) {
  const avisos = [];
  const g = generado || {};

  // ── 1. Narraciones: una por acto, sin excepción ──
  // Si Gemini devolvió menos (pasa: se corta, se le va el JSON), se rellena
  // con el banco de respaldo. La escena NUNCA se queda sin la cola del acto.
  const narraciones = Array.isArray(g.narraciones) ? [...g.narraciones] : [];
  while (narraciones.length < actos.length) {
    const i = narraciones.length;
    const plantilla = narracionesRespaldo[(i + (ctx.indice ?? 0)) % Math.max(1, narracionesRespaldo.length)] ?? '';
    narraciones.push(rellenarFichas(plantilla, ctx));
    avisos.push(`narración ${i + 1} vino del respaldo`);
  }
  narraciones.length = actos.length;   // si mandó de más, se recortan

  // ── 2. Los dos datos orbitales ──
  const orbital1 = (g.orbital_1 || '').trim();
  const orbital2 = (g.orbital_2 || '').trim();
  if (!orbital1) avisos.push('sin orbital_1: el manifiesto abre sin dato orbital');
  if (!orbital2) avisos.push('sin orbital_2: solo se nombra un territorio');

  // ── 3. Esqueleto: orbital1 → (acto+narración)×N, con orbital2 tras el 2º acto ──
  const seg = [];
  const marcas = {};   // nombre de ranura → índice donde insertar la memoria

  if (orbital1) seg.push({ tipo: 'orbital', texto: orbital1 });
  marcas.orbital = seg.length;

  for (let i = 0; i < actos.length; i++) {
    seg.push({ tipo: 'prompt', texto: actos[i] });
    if (i === 0) marcas.acto1 = seg.length;

    seg.push({ tipo: 'narracion', texto: narraciones[i] });
    if (i === 0) marcas.narracion1 = seg.length;

    // El segundo dato orbital entra DESPUÉS del segundo acto y su narración.
    // Con 2 actos eso es el tramo final; con 3, es exactamente la mitad.
    if (i === 1 && orbital2) {
      seg.push({ tipo: 'orbital', texto: orbital2 });
      marcas.orbital2 = seg.length;
    }
  }
  // Con un solo acto (caso raro) el orbital2 no encontró sitio: va al cierre.
  if (orbital2 && !('orbital2' in marcas)) {
    seg.push({ tipo: 'orbital', texto: orbital2 });
    marcas.orbital2 = seg.length;
  }
  marcas.final = seg.length;

  // ── 4. La memoria: única pieza móvil. El patrón decide su ranura ──
  const memoria = (g.memoria || '').trim();
  if (memoria) {
    const ranura = patron?.memoria_despues_de ?? 'narracion1';
    const donde = marcas[ranura] ?? marcas.final;
    seg.splice(donde, 0, { tipo: 'memoria', texto: memoria });
  } else {
    avisos.push('sin memoria episódica');
  }

  return { segmentos: seg, avisos };
}

/** Elige el patrón por rotación estricta. Determinista = ensayable. */
export function elegirPatron(patrones, indiceGlobal) {
  if (!patrones?.length) return { id: 'sin-patron', memoria_despues_de: 'narracion1' };
  return patrones[indiceGlobal % patrones.length];
}

/** Reconstruye los tres bloques clásicos, para seguir guardando el log igual. */
export function segmentosABloques(segmentos) {
  const junta = (t) => segmentos.filter((s) => s.tipo === t).map((s) => s.texto).join(' ');
  return {
    dato_orbital: junta('orbital'),
    memoria: junta('memoria'),
    instruccion: segmentos.filter((s) => s.tipo === 'prompt' || s.tipo === 'narracion')
      .map((s) => s.texto).join(' '),
  };
}
