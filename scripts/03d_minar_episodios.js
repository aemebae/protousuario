// PROTOUSUARIO / AGENTE-ESPEJO — Paper 3/4, minado de episodios íntimos
//
// Escanea tu corpus privado (language_corpus.private.jsonl) 100% LOCALMENTE —
// nada sale de tu disco, no llama a ninguna API — buscando pasajes narrativos
// e íntimos (Génesis, familia, ríos, performances, llanto, infancia...) y los
// deja en episodios_candidatos.jsonl YA en formato episodio, listos para curar.
//
// CURADURÍA (manual, tuya): abrí episodios_candidatos.jsonl en VS Code,
//   1. BORRÁ las líneas que no quieras volver material escénico,
//   2. EDITÁ tags/resumen/fecha de las que sí (el resumen puede quedar tal cual),
//   3. PEGÁ las elegidas al final de episodios.jsonl.
// ⚠ episodios_candidatos.jsonl contiene material íntimo: NO lo subas a ningún lado.
//
// Corre con:  node scripts/03d_minar_episodios.js   (no necesita .env ni internet)

import fs from 'fs';
import readline from 'readline';
import crypto from 'crypto';

const CORPUS_PATH = 'corpus/private/language_corpus.private.jsonl';
const SALIDA_PATH = 'episodios_candidatos.jsonl';
const MIN_PALABRAS = 20; // pasajes más cortos rara vez tienen materia narrativa

// Gatillos por SUBCADENA (raíces largas y frases — baja ambigüedad)
const GATILLOS_SUBCADENA = [
  'génesis', 'genesis', 'margaret', 'perrita', 'perrito', 'veterinari', 'enferm', 'hospital','adopción', 'adopcion',
  'falleci', 'murió', 'murio', 'abuel', 'herman', 'llorand', 'lloré', 'llore',
  'pesadilla', 'infancia', 'cuando era', 'de niño', 'de nino', 'niñ','nunca le dije',
  'te extraño', 'te extrano', 'me siento', 'confieso', 'enamorad', 
  'ansiedad', 'estrés', 'estres', 'trauma', 'traumático', 'traumatico', 'violencia', 'violento',
  'precariedad', 'desigualdad', 'desigual', 'pobreza', 'pobre', 'explotación', 'explotacion',
  'politic', 'polític', 'corrupción', 'corrupcion', 'dictadura', 'régimen', 'regimen', 'gobierno',
  'anticolonial', 'decolonial', 'colonialismo', 'colonial', 'imperialismo', 'imperial', 'capitalismo', 'capitalista', 
  'tercer mundo', 'tercermundista', 'neoliberal', 'neoliberalismo', 'sur global', 'surglobal',
  'río', 'contaminado', 'zonas de sacrificio','mutante','rímac', 'rimac', 'chillón', 'chillon', 'ucayali', 'marañón', 'maranon', 'amazonas',
  'migración', 'migracion', 'desaparecid', 'desapareci', 'desaparec', 'desaparecío', 'desaparecio', 'trasladar', 
  'maleta', 'viaj', 'viajar', 'viaje', 'viaje', 'pasaje', 'latino', 'latam', 'latinoamérica', 'latinoamerican', 'residencia',
  'amazon', 'perform', 'ayahuasca','animal','trance', 'transespecie','ritual', 'cuadrúped', 'cuadruped',
  'sexo', 'genero', 'género', 'sexualidad', 'sexual', 'no binario', 'no binar', 'trans', 'lgbt',
  'pareja', 'romántic', 'romantic', 'novi', 'relación', 'relacion', 'monogamia', 'poliamor',
];
// Gatillos por PALABRA EXACTA (cortas y ambiguas — exigen límite de palabra)
const GATILLOS_PALABRA = ['papá', 'mamá', 'miedo', 'sueño', 'soñé', 'amor', 'muerte', 'recuerdo'];
const REGEX_PALABRA = new RegExp('\\b(' + GATILLOS_PALABRA.join('|') + ')\\b', 'i');

function hallarGatillos(textoMin) {
  const encontrados = GATILLOS_SUBCADENA.filter((g) => textoMin.includes(g));
  const m = textoMin.match(REGEX_PALABRA);
  if (m) encontrados.push(m[1].toLowerCase());
  return [...new Set(encontrados)];
}

async function main() {
  if (!fs.existsSync(CORPUS_PATH)) {
    console.error(`No encuentro ${CORPUS_PATH} — corré este script parado en la raíz del proyecto.`);
    process.exit(1);
  }

  const candidatos = [];
  const vistos = new Set(); // dedup por hash del texto

  const rl = readline.createInterface({ input: fs.createReadStream(CORPUS_PATH), crlfDelay: Infinity });
  for await (const linea of rl) {
    if (!linea.trim()) continue;
    let msg;
    try { msg = JSON.parse(linea); } catch { continue; }

    const texto = (msg.texto || '').trim();
    if (texto.split(/\s+/).length < MIN_PALABRAS) continue;
    if (texto.includes('http') || texto.includes('```')) continue; // links y código: no son memoria

    const textoMin = texto.toLowerCase();
    const gatillos = hallarGatillos(textoMin);
    if (gatillos.length === 0) continue;

    const hash = crypto.createHash('sha1').update(texto).digest('hex').slice(0, 8);
    if (vistos.has(hash)) continue;
    vistos.add(hash);

    candidatos.push({
      id: 'corpus-' + hash,
      fecha: msg.fecha ? msg.fecha.slice(0, 10) : '',
      lugar: '',
      tags: gatillos.slice(0, 5),
      resumen: texto.length > 450 ? texto.slice(0, 450) + '…' : texto,
      frases_dichas: [],
      veracidad: 'real',
      origen: msg.fuente || 'corpus',
      registro: msg.registro || '',
    });
  }

  candidatos.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
  fs.writeFileSync(SALIDA_PATH, candidatos.map((c) => JSON.stringify(c)).join('\n') + '\n', 'utf8');

  console.log(`\n✓ ${candidatos.length} candidatos escritos en ${SALIDA_PATH} (ordenados por fecha).`);
  if (candidatos.length > 400) {
    console.log('  Son muchos: afiná GATILLOS_SUBCADENA (borrá los genéricos como "perform" o "recuerdo") y volvé a correr.');
  }
  console.log('  Curaduría: borrá lo que no quieras exponer, editá tags/resumen de lo que sí,');
  console.log('  y pegá las líneas elegidas al final de episodios.jsonl.');
  console.log('  ⚠ Este archivo contiene material íntimo: no lo compartas ni lo subas a la nube.');
}

main().catch(console.error);
