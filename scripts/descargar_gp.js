// PROTOUSUARIO / AGENTE-ESPEJO -- Capa 2, descarga de datos orbitales
//
// QUÉ ES OMM: Orbit Mean-Elements Message, el formato que reemplaza al TLE
// clásico de 2 líneas. Misma información orbital, pero como objeto JSON con
// nombres de campo explícitos en vez de columnas de texto de ancho fijo. Es
// el formato recomendado por CelesTrak desde 2026 (el TLE clásico se queda
// sin números de catálogo de 5 dígitos para satélites NUEVOS, pero sigue
// funcionando para todo lo que ya está catalogado -- ver el paper 4.2).
//
// POR QUÉ CACHÉ: CelesTrak pide explícitamente NO descargar más de 3-4 veces
// al día. Además, para resiliencia offline (estado OFFLINE_AUTONOMO), la
// propagación SGP4 debe poder correr sin red una vez que el archivo está
// descargado -- por eso guardamos SIEMPRE una copia en disco.
//
// TRES ESTADOS DE SALIDA:
//   ONLINE_COMPLETO -> descarga fresca de la red, cache actualizado
//   DEGRADADO       -> la red falló, se usa un cache más viejo que existía
//   OFFLINE_AUTONOMO -> ni red ni cache -> datos vacíos (capa2 cae a modo simulado)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const URL_POR_DEFECTO = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json';
const MAX_EDAD_MS_POR_DEFECTO = 6 * 60 * 60 * 1000; // 6 horas

/**
 * @param {object} opciones
 * @param {string} [opciones.url]        endpoint a consultar (parametrizable para pruebas)
 * @param {string} [opciones.cachePath]  dónde guardar/leer el cache en disco
 * @param {number} [opciones.maxEdadMs]  edad máxima del cache antes de intentar refrescar
 * @returns {Promise<{ modo: 'ONLINE_COMPLETO'|'DEGRADADO'|'OFFLINE_AUTONOMO', datos: any[] }>}
 */
export async function obtenerGP({
  url = URL_POR_DEFECTO,
  cachePath = 'tles/gp_cache.json',
  maxEdadMs = MAX_EDAD_MS_POR_DEFECTO,
} = {}) {
  // 1) ¿hay un cache lo bastante fresco? úsalo sin tocar la red.
  try {
    const raw = await readFile(cachePath, 'utf8');
    const { t, datos } = JSON.parse(raw);
    if (Date.now() - t < maxEdadMs) {
      return { modo: 'ONLINE_COMPLETO', datos, fuente: 'cache_fresco' };
    }
  } catch { /* no hay cache todavía, o está corrupto: seguimos a la red */ }

  // 2) intentar la red
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'agente-espejo-protousuario/1.0 (contacto: artista, uso academico/artistico)' },
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const datos = await r.json();
    if (!Array.isArray(datos)) throw new Error('Respuesta no es un array JSON');

    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify({ t: Date.now(), datos }), 'utf8');
    return { modo: 'ONLINE_COMPLETO', datos, fuente: 'red' };
  } catch (e) {
    // 3) la red falló: usar cache viejo si existe, aunque esté vencido
    try {
      const { datos } = JSON.parse(await readFile(cachePath, 'utf8'));
      return { modo: 'DEGRADADO', datos, fuente: 'cache_vencido', error: String(e.message || e) };
    } catch {
      // 4) ni red ni cache: manos vacías, capa2 debe caer a modo simulado
      return { modo: 'OFFLINE_AUTONOMO', datos: [], fuente: 'ninguno', error: String(e.message || e) };
    }
  }
}
