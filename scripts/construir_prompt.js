// PROTOUSUARIO / AGENTE-ESPEJO — Construcción del prompt-manifiesto
//
// NUEVO CONTRATO CON GEMINI: SEGMENTOS ENTRELAZADOS
//
// Antes Gemini devolvía tres bloques completos y en orden fijo:
//   { dato_orbital, memoria, instruccion }
// El problema escénico: PROTOUSUARIO se quedaba parado escuchando el bloque
// entero y recién después actuaba.
//
// Ahora devuelve una SECUENCIA de segmentos cortos que se alternan:
//   { segmentos: [ {tipo, texto}, {tipo, texto}, ... ] }
// Así el cuerpo puede ejecutar una acción MIENTRAS suenan datos orbitales o
// memoria. El texto sigue sonando; el cuerpo ya está haciendo.
//
// LOS CUATRO TIPOS:
//   orbital    — el satélite, el territorio, la situación política
//   memoria    — recuerdo en primera persona del agente
//   prompt     — UNA acción física concreta que PROTOUSUARIO ejecuta
//   reflexion  — la cola poética que extiende la acción anterior
//
// El corpus teórico entra en TRES trabajos distintos, con UN solo marco:
//   1. enmarca el hecho   (tiñe los segmentos 'orbital')
//   2. elige el recuerdo  (selecciona qué episodio, sin tocar su lenguaje)
//   3. extiende la orden  (alimenta los segmentos 'reflexion')

import { bloqueEstilometria } from './estilometria.js';
import { bloqueRumbo } from './rumbo_territorial.js';

/**
 * @param {object} p
 * @param {object} p.agente      objeto de agentes.json
 * @param {string} p.acto
 * @param {object} p.dato        salida de obtenerDatoOrbital()
 * @param {object} p.territorio  región elegida (de regiones_conflicto.json)
 * @param {object} p.rumbo       salida del motor de rumbo
 * @param {object} p.marco       marco de corpus_teorico.json (uno solo)
 * @param {object} p.episodio
 * @param {Array}  p.objetos
 * @param {object} p.accion
 * @param {Array}  p.semillas
 * @param {Array}  p.vetadas
 * @param {boolean} p.licenciaEspeculativa
 * @param {boolean} p.usarBusquedaWeb
 */
export function construirPrompt({
  agente, acto, dato, territorio, rumbo, marco, episodio,
  objetos, accion, semillas, vetadas,
  licenciaEspeculativa = true, usarBusquedaWeb = false,
}) {
  const licencia = licenciaEspeculativa
    ? 'Podés fabular detalles verosímiles e incómodos alrededor de este núcleo, sin contradecirlo.'
    : 'No inventes nada fuera de este núcleo.';
  const web = usarBusquedaWeb
    ? ' Buscá en la web 1-2 hechos ACTUALES y concretos de esta situación y tejelos; si no encontrás nada fiable, usá solo el contexto dado.'
    : '';

  return `Eres AGENTE-ESPEJO, híbrido entre clon virtual y agente de IA, en una performance en vivo. PROTOUSUARIO es tu servidor humano en escena; el público está presente.

AGENTE ACTIVO: ${agente.agente} — ${agente.caracter}.
SESGO DEL AGENTE: ${agente.sesgo_manifiestos}
ACTO ACTUAL: ${acto}

OPERACIÓN CONCEPTUAL DE ESTE MANIFIESTO (ejecútala, no la expliques ni la nombres jamás):
${marco.operacion}
${bloqueRumbo({ ...rumbo, territorio })}
${bloqueEstilometria(agente.id)}

REGISTRO DE VOZ (manifiesto_escenico):
Narración mitológica: hablás como quien ya conoce la odisea completa y solo relata el pasaje que toca. Ironía y humor negro conviven con la crítica seria. Frases que se puedan decir en voz alta de un solo aliento. NUNCA jerga de software ni de oficina digital.

SEMILLAS (marcan ritmo y mundo, NO contenido — prohibido repetir sus acciones, objetos o imágenes):
${semillas.map((s, i) => `${i + 1}. ${s.texto}`).join('\n')}

PALABRAS E IMÁGENES YA GASTADAS (prohibido reutilizarlas): ${vetadas.length ? vetadas.join(', ') : 'ninguna todavía'}.

DATOS DUROS DE ESTE MANIFIESTO (no los contradigas):
- Satélite: ${dato.satelite_enunciable ?? dato.satelite}.
- Territorio nombrado: ${territorio.nombre}. Situación real: ${territorio.contexto}.${web}
- Núcleo de memoria (${episodio?.veracidad ?? 'real'}): ${episodio?.resumen ?? 'sin núcleo disponible: la memoria será de 1-2 frases, sin inventar biografía'}. ${licencia}
- Objetos disponibles en escena: ${objetos.map((o) => o.nombre).join('; ')}.
- Acción de repertorio disponible: ${accion?.nombre ?? 'ninguna'}.

REGLAS DE NOMBRES: al performer llamalo siempre PROTOUSUARIO. NUNCA nombres a Julio Urbina, juliourbina ni Mowgli: la memoria se narra como recuerdo PROPIO del agente («Recuerdo...»); la pertenencia de esos datos es implícita, ya se dijo en el Preludio.

═══ FORMA DE SALIDA: SECUENCIA ENTRELAZADA ═══

No devuelvas bloques largos. Devuelve una SECUENCIA de 9 a 13 segmentos cortos que se alternan, pensada para que el cuerpo de PROTOUSUARIO pueda EJECUTAR una acción mientras siguen sonando otros segmentos.

Tipos permitidos:
- "orbital"    — el satélite, el territorio, su situación política concreta. 25-45 palabras.
- "memoria"    — recuerdo en primera persona del agente, íntimo e incómodo. 25-50 palabras.
- "prompt"     — UNA SOLA acción física concreta y realizable, en TERCERA PERSONA y presente ("PROTOUSUARIO se tumba..."). 15-40 palabras. Nombra los objetos tal cual aparecen en la lista.
- "reflexion"  — cola poética que extiende la acción inmediatamente anterior: elocuencia, adjetivos, metáfora, frase épica. 12-30 palabras.

REGLAS DE COMPOSICIÓN (obligatorias):
1. El PRIMER segmento es siempre "orbital" y debe contener la línea de rumbo tal cual se te dio.
2. Debe haber entre 3 y 4 segmentos "prompt". Son la columna vertebral: la partitura física.
3. NUNCA dos "prompt" seguidos. Entre dos acciones siempre va algo que el cuerpo pueda seguir ejecutando mientras suena: una "reflexion", un "orbital" o una "memoria".
4. Cada "prompt" va seguido de su "reflexion" en la mayoría de los casos, pero no siempre: a veces conviene que un "orbital" o una "memoria" irrumpa antes de la reflexión.
5. La "memoria" se parte en 2 o 3 segmentos repartidos por la secuencia, no en un bloque único. Que vuelva, que insista.
6. El ÚLTIMO segmento es un "prompt" que incluye una pregunta dicha al micrófono y una condición clara de término (duración, conteo o señal).
7. El orden NO es fijo ni aleatorio: componelo según la tensión de la escena. Que el corte entre un segmento y el siguiente produzca sentido, no ruido.

Devuelve SOLO este JSON, sin texto fuera de él:
{
  "segmentos": [
    { "tipo": "orbital", "texto": "..." },
    { "tipo": "prompt", "texto": "..." },
    { "tipo": "reflexion", "texto": "..." }
  ]
}`;
}

/** Valida y repara la secuencia devuelta por Gemini. */
export function validarSegmentos(salida) {
  const tiposOk = new Set(['orbital', 'memoria', 'prompt', 'reflexion']);
  let segs = Array.isArray(salida?.segmentos) ? salida.segmentos : [];

  segs = segs
    .filter((s) => s && typeof s.texto === 'string' && s.texto.trim())
    .map((s) => ({ tipo: tiposOk.has(s.tipo) ? s.tipo : 'reflexion', texto: s.texto.trim() }));

  const avisos = [];
  if (!segs.length) return { segmentos: [], avisos: ['secuencia vacía'] };

  // Regla 3: nunca dos 'prompt' seguidos -- el cuerpo necesita algo que
  // siga sonando mientras ejecuta. Reparación: se intercala un segmento
  // no-prompt tomado de más adelante en la secuencia.
  // Se recorre en una sola pasada y se reevalúa la MISMA posición tras
  // insertar, para no dejar conflictos nuevos detrás (bug de la v1).
  let i = 1, guardas = 0;
  while (i < segs.length && guardas++ < 200) {
    if (segs[i].tipo === 'prompt' && segs[i - 1].tipo === 'prompt') {
      const j = segs.findIndex((s, k) => k > i && s.tipo !== 'prompt');
      if (j > -1) {
        segs.splice(i, 0, segs.splice(j, 1)[0]);
        avisos.push('dos prompt seguidos: intercalado');
        continue;               // reevaluar esta misma posición
      }
      // No queda nada que intercalar: se fusiona el prompt huérfano con el
      // anterior, para que no haya dos órdenes seguidas sin respiro.
      segs[i - 1].texto = `${segs[i - 1].texto} ${segs[i].texto}`;
      segs.splice(i, 1);
      avisos.push('dos prompt seguidos sin relleno: fusionados');
      continue;
    }
    i++;
  }

  const nPrompt = segs.filter((s) => s.tipo === 'prompt').length;
  if (nPrompt < 3) avisos.push(`solo ${nPrompt} segmentos 'prompt' (se esperaban 3-4)`);
  if (segs[0].tipo !== 'orbital') avisos.push("el primer segmento no es 'orbital'");

  return { segmentos: segs, avisos };
}

/** Reconstruye los tres bloques clásicos, para seguir guardando manifiestos_log.jsonl igual. */
export function segmentosABloques(segmentos) {
  const junta = (t) => segmentos.filter((s) => s.tipo === t).map((s) => s.texto).join(' ');
  return {
    dato_orbital: junta('orbital'),
    memoria: junta('memoria'),
    instruccion: segmentos.filter((s) => s.tipo === 'prompt' || s.tipo === 'reflexion')
      .map((s) => s.texto).join(' '),
  };
}
