// PROTOUSUARIO / AGENTE-ESPEJO — Duración real de un mp3, sin reproducirlo
//
// POR QUÉ HACE FALTA
// El modo automático necesita saber cuánto dura cada bloque para pasar solo al
// siguiente. Para los mp3 que grabamos nosotros basta con dividir el tamaño
// entre 128 kbps, porque los pedimos a esa tasa fija. Pero un sonido tuyo
// —"Sonido Rana Croar.mp3", por ejemplo— puede venir a cualquier tasa, o ser
// de tasa VARIABLE (VBR), y ahí esa cuenta falla y la escena esperaría de más
// o cortaría el sonido.
//
// QUÉ HACE ESTO
// Lee la cabecera del archivo, que es donde el mp3 declara su propio formato:
//   · Salta la etiqueta ID3v2 del principio (título, artista, carátula…).
//   · Busca la primera "trama" de audio y lee de ella la tasa y la frecuencia.
//   · Si encuentra una cabecera Xing/Info (la que ponen los codificadores VBR),
//     usa el número exacto de tramas → duración exacta.
//   · Si no, asume tasa constante: (bytes de audio × 8) ÷ tasa.
//
// No hace falta instalar nada: son unas pocas decenas de bytes leídos a mano.

import fs from 'node:fs';

// Tablas del estándar MPEG-1/2/2.5 Layer I/II/III.
const TASAS = {
  1: { // MPEG-1
    1: [0,32,64,96,128,160,192,224,256,288,320,352,384,416,448],
    2: [0,32,48,56,64,80,96,112,128,160,192,224,256,320,384],
    3: [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320],
  },
  2: { // MPEG-2 / 2.5
    1: [0,32,48,56,64,80,96,112,128,144,160,176,192,224,256],
    2: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160],
    3: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160],
  },
};
const FRECUENCIAS = {
  3: [44100, 48000, 32000],   // MPEG-1
  2: [22050, 24000, 16000],   // MPEG-2
  0: [11025, 12000, 8000],    // MPEG-2.5
};

/**
 * @param {string} ruta  ruta a un archivo .mp3
 * @returns {number} duración en milisegundos, o 0 si no se pudo averiguar
 */
export function duracionMp3Ms(ruta) {
  let fd;
  try {
    if (!fs.existsSync(ruta)) return 0;
    const tam = fs.statSync(ruta).size;
    if (tam < 128) return 0;

    // Solo hacen falta los primeros 64 KB: ahí están la etiqueta y la 1ª trama.
    const buf = Buffer.alloc(Math.min(65536, tam));
    fd = fs.openSync(ruta, 'r');
    fs.readSync(fd, buf, 0, buf.length, 0);

    // ── 1. Saltar la etiqueta ID3v2, si la hay ──
    let i = 0;
    if (buf.toString('latin1', 0, 3) === 'ID3') {
      // El tamaño viene en 4 bytes "sincroseguros": 7 bits útiles cada uno.
      const n = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14)
              | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
      i = 10 + n;
    }

    // ── 2. Buscar la primera trama de audio (sincronismo 11 bits a 1) ──
    const fin = Math.min(buf.length - 4, i + 40000);
    for (; i < fin; i++) {
      if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) continue;

      const versionBits = (buf[i + 1] >> 3) & 0x03;   // 3=MPEG-1, 2=MPEG-2, 0=2.5
      const capaBits = (buf[i + 1] >> 1) & 0x03;      // 3=Layer I, 2=II, 1=III
      const tasaIdx = (buf[i + 2] >> 4) & 0x0f;
      const frecIdx = (buf[i + 2] >> 2) & 0x03;
      if (versionBits === 1 || capaBits === 0 || tasaIdx === 0 || tasaIdx === 15 || frecIdx === 3) continue;

      const capa = 4 - capaBits;                       // 1, 2 o 3
      const grupo = versionBits === 3 ? 1 : 2;
      const kbps = TASAS[grupo][capa]?.[tasaIdx];
      const hz = FRECUENCIAS[versionBits]?.[frecIdx];
      if (!kbps || !hz) continue;

      // ── 3. ¿Hay cabecera Xing/Info? (tasa variable) ──
      // Va dentro de la primera trama, a un desplazamiento fijo según el modo.
      const canalesBits = (buf[i + 3] >> 6) & 0x03;    // 3 = mono
      const desp = versionBits === 3
        ? (canalesBits === 3 ? 21 : 36)
        : (canalesBits === 3 ? 13 : 21);
      const marca = buf.toString('latin1', i + desp, i + desp + 4);
      if (marca === 'Xing' || marca === 'Info') {
        const banderas = buf.readUInt32BE(i + desp + 4);
        if (banderas & 0x01) {                          // trae número de tramas
          const tramas = buf.readUInt32BE(i + desp + 8);
          const muestrasPorTrama = capa === 1 ? 384 : (versionBits === 3 ? 1152 : 576);
          return Math.round((tramas * muestrasPorTrama / hz) * 1000);
        }
      }

      // ── 4. Tasa constante: bytes de audio ÷ tasa ──
      return Math.round(((tam - i) * 8 / (kbps * 1000)) * 1000);
    }
    return 0;
  } catch {
    return 0;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
  }
}
