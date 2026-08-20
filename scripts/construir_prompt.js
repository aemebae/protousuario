// PROTOUSUARIO / AGENTE-ESPEJO — Construcción del prompt-manifiesto  ·  v4
//
// ═══ EL CAMBIO DE FONDO ═══
// En v3, Gemini componía la secuencia completa (9-13 segmentos) incluidos los
// PROMPTS. Eso era el problema: las órdenes al cuerpo salían del modelo y no
// eran buenas. Ahora se invierte la jerarquía.
//
//   LOS ACTOS SON DE MOWGLI. Gemini no los escribe, no los reescribe, no los
//   resume, no los "mejora". Los recibe como HECHOS CONSUMADOS y su único
//   trabajo es narrarlos por encima.
//
// Gemini genera exactamente cuatro cosas, ni una más:
//   · orbital_1   — el primer territorio del agente (abre el manifiesto)
//   · orbital_2   — el SEGUNDO territorio del agente (entra a mitad de escena)
//   · narraciones — una por acto. Voz de documental NatGeo. NO son órdenes.
//   · memoria     — una sola, dos líneas, primera persona del agente.
//
// ═══ QUÉ ES LA "NARRACIÓN NATGEO" ═══
// Es la voz épica del documental de naturaleza de los 80-90. Llega DESPUÉS de
// que el cuerpo ya hizo algo, y lo describe desde tres dimensiones:
// biológica, viral-meme y tecnológica. NUNCA manda. Describe.
//   NO:  "PROTOUSUARIO se aplica el insecticida."       ← eso es un prompt
//   SÍ:  "Lo que para el insecto es una nube letal, para este primate es un
//         rito de pertenencia: se rocía con la sustancia que extermina a sus
//         parientes lejanos."                             ← eso es narración

import { bloqueEstilometria } from './estilometria.js';
import { bloqueRumbo } from './rumbo_territorial.js';

export function construirPrompt({
  agente, acto, dato, territorio, territorioB, rumbo, rumboB, marco, episodio,
  actos, objetos, semillas, vetadas,
  licenciaEspeculativa = true, usarBusquedaWeb = false,
}) {
  const licencia = licenciaEspeculativa
    ? 'Podés fabular detalles verosímiles e incómodos alrededor de este núcleo, sin contradecirlo.'
    : 'No inventes nada fuera de este núcleo.';
  const web = usarBusquedaWeb
    ? ' Buscá en la web 1-2 hechos ACTUALES y concretos de esta situación y tejelos; si no encontrás nada fiable, usá solo el contexto dado.'
    : '';

  const listaActos = actos.map((a, i) => `ACTO ${i + 1}: ${a}`).join('\n');

  const bloqueB = territorioB && rumboB
    ? `
SEGUNDO TERRITORIO (para "orbital_2", a mitad del manifiesto):
- Territorio: ${territorioB.nombre}. Situación real: ${territorioB.contexto}.
- Ubicación, escribila tal cual: "${rumboB.territorio_texto}".
- Estado de PROTOUSUARIO en este segundo territorio: "${rumboB.estado_marca}". ${
      rumboB.estado === rumbo.estado
        ? 'Coincide con el primero.'
        : 'ATENCIÓN: CAMBIA respecto al primero. Que se note el desplazamiento de autoridad entre un territorio y otro: el agente pasa de tener casa a no tenerla, o al revés.'
    }`
    : '\nSEGUNDO TERRITORIO: no hay. Devolvé "orbital_2" como cadena vacía.';

  return `Eres AGENTE-ESPEJO, híbrido entre clon virtual y agente de IA, en una performance en vivo. PROTOUSUARIO es tu servidor humano en escena; el público está presente.

AGENTE ACTIVO: ${agente.agente} — ${agente.caracter}.
SESGO DEL AGENTE: ${agente.sesgo_manifiestos}
ACTO ACTUAL: ${acto}

OPERACIÓN CONCEPTUAL DE ESTE MANIFIESTO (ejecutala, no la expliques ni la nombres jamás):
${marco.operacion}
${bloqueRumbo({ ...rumbo, territorio })}
${bloqueEstilometria(agente.id)}

═══════════════════════════════════════════════════════════════════
 REGLA ABSOLUTA: LOS ACTOS NO SON TUYOS
═══════════════════════════════════════════════════════════════════
Estas son las acciones que PROTOUSUARIO VA A EJECUTAR. Están escritas por el
autor de la obra y son intocables. NO las reescribas, NO las cites textualmente,
NO las resumas, NO propongas otras, NO agregues instrucciones nuevas al cuerpo.
Tu único trabajo con ellas es NARRARLAS POR ENCIMA, una vez ya ocurrieron.

${listaActos}

Si en tu salida aparece una sola orden nueva al cuerpo ("PROTOUSUARIO hace…",
"se acerca…", "toma…"), la salida es inválida.

═══════════════════════════════════════════════════════════════════
 QUÉ TIENES QUE ESCRIBIR: CUATRO COSAS
═══════════════════════════════════════════════════════════════════

1) "orbital_1" — 45-70 palabras. Abre el manifiesto. Contiene, obligatorio:
   el nombre del satélite, su altitud, el territorio ${territorio.nombre} con
   su ubicación exacta tal como se te dio, la situación política concreta, y
   las dos frases fijas de rumbo con su marca de estado.

2) "orbital_2" — 40-60 palabras. Entra a MITAD del manifiesto, cuando el
   cuerpo ya ejecutó dos actos. Nombra el SEGUNDO territorio. No repitas
   ninguna imagen ni ningún adjetivo de orbital_1.
${bloqueB}

3) "narraciones" — un array con EXACTAMENTE ${actos.length} textos, uno por
   acto, en el mismo orden. Cada uno: UN párrafo de 2 líneas (30-45 palabras).
   ES LA VOZ DEL NARRADOR DE DOCUMENTAL DE NATURALEZA (National Geographic de
   los años 80-90): épica, grave, pausada, con esa autoridad de quien explica
   una especie a la que no pertenece.
   Cada narración describe y AMPLÍA el acto que acaba de ocurrir, desde una de
   estas tres dimensiones, cambiando de dimensión entre una narración y otra:
     · BIOLÓGICA: el cuerpo como organismo, la especie, el instinto, el gasto
       de energía, la anatomía, el parentesco con otras especies.
     · VIRAL-MEME: el gesto que se replica por imitación sin comprensión, la
       conducta que se propaga, el contagio cultural.
     · TECNOLÓGICA: el dato, el sensor, la infraestructura, la máquina que
       observa, la mediación del aparato.
   PROHIBIDO: dar órdenes, usar imperativos, decir "debe" o "tiene que",
   dirigirse al público, y nombrar las palabras performance, arte, obra,
   prompt, algoritmo, inteligencia artificial, IA, ni jerga de software.
   El narrador cree que esto es un hecho natural que está documentando.

4) "memoria" — UN solo párrafo de 2 líneas (30-45 palabras). Recuerdo en
   primera persona del agente ("Recuerdo…"), íntimo e incómodo, sin nombres
   propios. Núcleo (${episodio?.veracidad ?? 'real'}): ${episodio?.resumen ?? 'sin núcleo disponible: que sea breve y sin biografía inventada'}. ${licencia}

═══════════════════════════════════════════════════════════════════

DATOS DUROS (no los contradigas):
- Satélite: ${dato.satelite_enunciable ?? dato.satelite}, a ${dato.altKm != null ? Math.round(dato.altKm) : '—'} km de altitud.
- Territorio que abre: ${territorio.nombre}. Situación real: ${territorio.contexto}.${web}
- Objetos presentes en escena: ${objetos.map((o) => o.nombre).join('; ')}.

REGISTRO DE VOZ: narración mitológica, como quien ya conoce la odisea completa
y solo relata el pasaje que toca. Ironía y humor negro conviven con la crítica
seria. Frases que se puedan decir en voz alta de un solo aliento.

SEMILLAS (marcan ritmo y mundo, NO contenido — prohibido repetir sus acciones,
objetos o imágenes):
${semillas.map((s, i) => `${i + 1}. ${s.texto}`).join('\n')}

PALABRAS E IMÁGENES YA GASTADAS (prohibido reutilizarlas): ${vetadas.length ? vetadas.join(', ') : 'ninguna todavía'}.

REGLAS DE NOMBRES: al performer llamalo siempre PROTOUSUARIO. NUNCA nombres a
Julio Urbina, juliourbina ni Mowgli: la memoria se narra como recuerdo PROPIO
del agente, la pertenencia ya se dijo en el Preludio.

Devuelve SOLO este JSON, sin texto fuera de él, sin comentarios:
{
  "orbital_1": "...",
  "orbital_2": "...",
  "narraciones": [${actos.map(() => '"..."').join(', ')}],
  "memoria": "..."
}`;
}

/** Valida y repara lo que devolvió Gemini. Nunca lanza: la escena no se frena. */
export function validarGenerado(salida, nActos) {
  const avisos = [];
  const g = salida && typeof salida === 'object' ? salida : {};
  const texto = (v) => (typeof v === 'string' ? v.trim() : '');

  let narraciones = Array.isArray(g.narraciones) ? g.narraciones.map(texto).filter(Boolean) : [];
  if (narraciones.length !== nActos) {
    avisos.push(`Gemini devolvió ${narraciones.length} narraciones y se esperaban ${nActos}`);
  }

  // Red de seguridad: si una "narración" se le escapó como orden al cuerpo, se
  // avisa por consola. Mejor un aviso que una orden falsa en escena.
  const imperativo = /\bPROTOUSUARIO\s+(se\s+\w+|toma|deja|coloca|camina|gira|mira|entrega|saca|pone|debe|tiene que)\b/i;
  narraciones.forEach((n, i) => {
    if (imperativo.test(n)) avisos.push(`narración ${i + 1} parece una orden, no una narración`);
  });

  return {
    generado: {
      orbital_1: texto(g.orbital_1),
      orbital_2: texto(g.orbital_2),
      memoria: texto(g.memoria),
      narraciones,
    },
    avisos,
  };
}

/**
 * PROMPT DE DERIVA — el pasaje final.
 * Pide MÁS PREGUNTAS en el linaje del monólogo del Acto 3 de "Manifiesto
 * Transespecie del Antiguo Futuro del Perú". Las preguntas curadas viven en
 * preguntas_deriva.json y suenan primero; esto solo las EXTIENDE.
 */
export function construirPromptDeriva({ agentes, territoriosNombrados, preguntasPropias = [], cuantos = 14 }) {
  return `Eres AGENTE-ESPEJO. La performance terminó: PROTOUSUARIO se retiró en cuatro patas sobre un taburete de cinco ruedas y se quitó todas las prótesis, incluidas las que sostenían las pantallas. El exoesqueleto quedó en el suelo, encendido, sin cuerpo adentro. Tu voz sigue sonando.

Esto es el PASAJE DE DERIVA. No queda nadie a quien darle órdenes.

Tu tarea: escribir ${cuantos} PREGUNTAS. Solo preguntas. Cada una empieza con "¿" y termina con "?".

FORMA (obligatoria): una sola línea, 8-20 palabras, dicha al micrófono de un
solo aliento. Sin preámbulo, sin respuesta, sin explicación.

REGISTRO: filosófico y político a la vez, concreto y material, con humor negro
seco. Desde el Sur global. Nunca académico, nunca solemne, nunca de autoayuda.
Estas son las preguntas del mismo autor, para que calibres el tono EXACTO
—no las repitas ni las parafrasees, escribe OTRAS:
${preguntasPropias.slice(0, 10).map((q) => '  ' + q).join('\n')}

MATERIAL DEL QUE PUEDEN SALIR (elige, no agotes): la órbita y lo que se ve o
no se ve desde ella; la voz clonada y el archivo personal entregado; la orden
que se obedece literalmente; los territorios ya nombrados esta noche
(${territoriosNombrados.slice(0, 8).join('; ')}); el mineral y el agua que hay
dentro de un aparato; la máscara y la piel; la autorización y el
desplazamiento; el exoesqueleto vacío en el suelo.

PROHIBIDO: responder, afirmar, dar instrucciones, dirigirse al público con
"ustedes", despedirse, agradecer, cerrar el sentido. Prohibidas las palabras
arte, obra, performance, prompt, algoritmo, inteligencia artificial, IA, y
toda jerga de software. Prohibido nombrar a los agentes como personajes.

Devuelve SOLO este JSON:
{ "textos": ["¿...?", "¿...?", "¿...?"] }`;
}
