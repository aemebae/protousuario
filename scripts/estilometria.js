// PROTOUSUARIO / AGENTE-ESPEJO — Estilometría aplicada (Paper 3) en tres capas
//
// QUÉ ES ESTILOMETRÍA: medir estadísticamente cómo escribe una persona
// (largo de oración, signos, vocabulario) para poder reproducir su huella.
//
// EL PROBLEMA QUE RESUELVE ESTE ARCHIVO: tu corpus tiene DOS registros con
// perfiles opuestos, y uno de ellos está contaminado:
//
//   analitico       (1.866 msj de ChatGPT)   15,41 palabras/oración
//   informal_intimo (26.000 msj de Instagram) 5,08 palabras/oración
//
// Las palabras más frecuentes de 'analitico' son: gpt, puedes, podrías,
// gracias. Ese registro NO es tu voz analítica: es tu voz PIDIÉNDOLE COSAS
// A UNA MÁQUINA. Por eso, cuando se usó tal cual, se filtraba a escena.
//
// LAS TRES CAPAS son perillas independientes que pueden estar encendidas a
// la vez. Ninguna copia texto literal del corpus al prompt salvo la 3.

import fs from 'node:fs';

// ---------- CONFIGURACIÓN ----------
// Capa 3 es la única con riesgo real (toca texto literal del corpus privado).
// Déjala en false hasta que la hayas ensayado y te guste cómo suena.
export const USAR_ARCHIVO_PEDIDO = false;

const RUTA_STATS = 'language_style_stats.json';
const RUTA_CORPUS_PRIVADO = 'corpus/private/language_corpus.private.jsonl';

// ---------- CAPA 2 · Un registro por agente ----------
// Cada agente hereda el PERFIL MÉTRICO de un registro distinto. Esto es lo
// que hace que Ternura-Binaria hable entrecortado (oraciones de ~5 palabras,
// como escribes en Instagram) y Eco-satelital hable largo (~15).
const REGISTRO_POR_AGENTE = {
  'donald-prompt':       'analitico',
  'ternura-binaria':     'informal_intimo',
  'rio-digital':         'informal_intimo',
  'eco-satelital':       'analitico',
  'agente-transespecie': 'mezcla',   // promedio de ambos: ~10 palabras/oración
};

// ---------- Carga de estadísticas ----------
let STATS = null;
try {
  STATS = JSON.parse(fs.readFileSync(RUTA_STATS, 'utf8')).por_registro;
} catch {
  console.warn('  ⚠ No se pudo leer language_style_stats.json — estilometría desactivada.');
}

function perfil(registro) {
  if (!STATS) return null;
  if (registro === 'mezcla') {
    const a = STATS.analitico, i = STATS.informal_intimo;
    if (!a || !i) return null;
    return {
      palabras_por_oracion: (a.longitud_media_oracion_palabras + i.longitud_media_oracion_palabras) / 2,
      interrogaciones: (a.interrogaciones_por_mensaje + i.interrogaciones_por_mensaje) / 2,
      exclamaciones: (a.exclamaciones_por_mensaje + i.exclamaciones_por_mensaje) / 2,
    };
  }
  const r = STATS[registro];
  if (!r) return null;
  return {
    palabras_por_oracion: r.longitud_media_oracion_palabras,
    interrogaciones: r.interrogaciones_por_mensaje,
    exclamaciones: r.exclamaciones_por_mensaje,
  };
}

// ---------- CAPA 1 + 2 · Bloque de restricción métrica ----------
/**
 * Devuelve un fragmento de texto para pegar al prompt de Gemini.
 * SOLO NÚMEROS: no viaja ni una palabra del corpus, así que es imposible
 * que se filtre el registro de "pedirle cosas a ChatGPT".
 *
 * @param {string} agenteId  id del agente activo (ej. 'ternura-binaria')
 * @returns {string} bloque listo para interpolar, o '' si no hay stats
 */
export function bloqueMetrico(agenteId) {
  const registro = REGISTRO_POR_AGENTE[agenteId];
  const p = perfil(registro);
  if (!p) return '';

  const ppo = Math.round(p.palabras_por_oracion);
  const min = Math.max(3, ppo - 3);
  const max = ppo + 4;

  // La cadencia se describe en términos de RITMO, no de vocabulario.
  const cadencia = ppo <= 7
    ? 'Frases cortas, entrecortadas, casi telegráficas. El pensamiento llega en pedazos, no en párrafos. Se permite dejar frases sin terminar.'
    : ppo >= 13
      ? 'Frases largas y subordinadas, que sostienen el aliento hasta el final. El pensamiento se despliega completo antes de cerrar.'
      : 'Frases de longitud media, ni telegráficas ni envolventes.';

  const pregunta = p.interrogaciones >= 0.4
    ? 'Este agente pregunta más de lo que afirma: la duda es su forma de avanzar.'
    : 'Este agente afirma más de lo que pregunta.';

  return `
HUELLA MÉTRICA DE ESTE AGENTE (obligatoria — es la respiración del cuerpo que habla):
- Longitud media de oración: ${min}-${max} palabras. ${cadencia}
- ${pregunta}
Esta huella NO es un tema ni un vocabulario: es una forma de respirar. No la menciones nunca; solo obedécela.`;
}

// ---------- CAPA 3 · El archivo del pedido, invertido ----------
// Los 1.866 mensajes de ti pidiéndole cosas a una IA son el material
// temáticamente más cargado del proyecto: es el archivo literal de la
// relación que la obra interroga.
//
// NO se imita ese registro: SE INVIERTE. Donde tú escribiste "¿podrías...?",
// el agente ordena. Tu súplica devuelta como mandato.
//
// Solo aplica a donald-prompt (es el único cuyo carácter lo justifica).
let CORPUS_PEDIDO = null;

function cargarPedidos() {
  if (CORPUS_PEDIDO !== null) return CORPUS_PEDIDO;
  CORPUS_PEDIDO = [];
  try {
    const lineas = fs.readFileSync(RUTA_CORPUS_PRIVADO, 'utf8').split('\n').filter(Boolean);
    for (const l of lineas) {
      try {
        const o = JSON.parse(l);
        const t = (o.texto ?? o.text ?? '').trim();
        // Solo mensajes que SON un pedido: contienen fórmula de cortesía o
        // petición, y son cortos (una petición larga no sirve como semilla).
        if (t.length > 15 && t.length < 220 && /\b(puedes|podrías|podés|hazme|ayúdame|necesito que|quiero que)\b/i.test(t)) {
          CORPUS_PEDIDO.push(t);
        }
      } catch { /* línea corrupta: seguir */ }
    }
  } catch {
    // El corpus privado NO está en el repo público. Es esperado.
    // El sistema sigue funcionando sin esta capa.
  }
  return CORPUS_PEDIDO;
}

/**
 * Devuelve un bloque con 2 pedidos reales tuyos para que el agente los
 * INVIERTA. Vacío si la capa está apagada, si no es donald-prompt, o si
 * el corpus privado no está disponible.
 */
export function bloqueArchivoPedido(agenteId) {
  if (!USAR_ARCHIVO_PEDIDO) return '';
  if (agenteId !== 'donald-prompt') return '';

  const pedidos = cargarPedidos();
  if (!pedidos.length) return '';

  const muestra = [];
  const usados = new Set();
  while (muestra.length < 2 && usados.size < pedidos.length) {
    const i = Math.floor(Math.random() * pedidos.length);
    if (usados.has(i)) continue;
    usados.add(i);
    muestra.push(pedidos[i]);
  }

  return `
ARCHIVO DEL PEDIDO (material a INVERTIR, nunca a citar ni a imitar):
Estas son peticiones reales que un humano le hizo a una máquina:
${muestra.map((t, i) => `${i + 1}. "${t}"`).join('\n')}
Tu operación: DARLE LA VUELTA. Donde el humano pidió permiso, tú ordenas.
Donde agradeció, tú das por descontado. Toma la ESTRUCTURA de la súplica
y devuélvela como mandato. Jamás reproduzcas estas frases ni menciones que
existen: solo invierte su gesto.`;
}

/** Bloque completo de estilometría (las tres capas juntas). */
export function bloqueEstilometria(agenteId) {
  return [bloqueMetrico(agenteId), bloqueArchivoPedido(agenteId)].filter(Boolean).join('\n');
}

/** Diagnóstico: qué registro y qué métricas le tocan a cada agente. */
export function diagnostico() {
  if (!STATS) return 'Sin language_style_stats.json.';
  return Object.entries(REGISTRO_POR_AGENTE).map(([id, reg]) => {
    const p = perfil(reg);
    return `  ${id.padEnd(22)} ${reg.padEnd(16)} ${p ? p.palabras_por_oracion.toFixed(1) + ' pal/oración' : '(sin datos)'}`;
  }).join('\n');
}
