// PROTOUSUARIO / AGENTE-ESPEJO — Paper 4, Capa 3
// episodios.jsonl es append-only (NUNCA se resetea, ni con desde_cero:true).
// memoria.json es la sesión conversacional (SÍ se resetea) — son dos archivos distintos a propósito.

import fs from 'fs';

const EPISODIOS_PATH = 'episodios.jsonl';

function leerEpisodios() {
  if (!fs.existsSync(EPISODIOS_PATH)) return [];
  return fs.readFileSync(EPISODIOS_PATH, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// Escribe DURANTE la performance, no solo al final — así un crash no pierde lo ya ocurrido.
function agregarEpisodio(episodio) {
  fs.appendFileSync(EPISODIOS_PATH, JSON.stringify(episodio) + '\n', 'utf8');
}

// Recuperación simple por recencia + coincidencia de tags — suficiente a tu escala
// (decenas de episodios). El upgrade a embeddings/coseno queda para cuando haga falta.
function recuperarPorRecenciaYTags(tags = [], n = 3) {
  const episodios = leerEpisodios();
  const conCoincidencia = episodios.filter(
    (e) => tags.length === 0 || (e.tags || []).some((t) => tags.includes(t))
  );
  return conCoincidencia.sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, n);
}

// Corre ESTO UNA SOLA VEZ para sembrar tu obra previa como "proto-episodios",
// así el agente puede citar tu pasado artístico desde la primera performance real.
// Ajusta fechas/lugares/tags reales — aquí van placeholders con lo que sé de tu bio.
function sembrarProtoEpisodios() {
  if (fs.existsSync(EPISODIOS_PATH)) {
    console.warn('episodios.jsonl ya existe — no se re-siembra para evitar duplicados.');
    return;
  }
  const protoEpisodios = [
    { id: 'proto-manifiesto-transespecie', fecha: '2020-01-01', lugar: '', tags: ['transespecie', 'manifiesto', 'antiguo-futuro', 'peru'], resumen: 'Manifiesto Transespecie del Antiguo Futuro del Perú', frases_dichas: [] },
    { id: 'proto-rvta-especies', fecha: '2020-01-01', lugar: '', tags: ['especies', 'rvta'], resumen: 'La Rvta de las Especies', frases_dichas: [] },
    { id: 'proto-chillon', fecha: '2020-01-01', lugar: 'Chillón', tags: ['rio', 'chillon', 'grito'], resumen: 'Chillón no grites', frases_dichas: [] },
    { id: 'proto-piedad-ucayali', fecha: '2020-01-01', lugar: 'Ucayali', tags: ['rio', 'ucayali', 'piedad'], resumen: 'La Piedad de Ucayali', frases_dichas: [] },
    { id: 'proto-trasladar-rio', fecha: '2020-01-01', lugar: '', tags: ['rio', 'traslado'], resumen: 'Trasladar un río', frases_dichas: [] },
    { id: 'proto-analfabetosis', fecha: '2020-01-01', lugar: '', tags: ['codigo', 'ancestral', 'no-binario'], resumen: 'Tratamiento de la analfabetosis algorítmica a través del código-no-binario ancestral', frases_dichas: [] },
    { id: 'proto-rotacion', fecha: '2020-01-01', lugar: '', tags: ['rotacion', 'yo'], resumen: '00:01:22:YO:ROTACIÓN', frases_dichas: [] },
  ];
  for (const ep of protoEpisodios) agregarEpisodio(ep);
  console.log(`✓ Sembrados ${protoEpisodios.length} proto-episodios en ${EPISODIOS_PATH}. Corrígeles fecha/lugar reales cuando puedas.`);
}

export { leerEpisodios, agregarEpisodio, recuperarPorRecenciaYTags, sembrarProtoEpisodios };
