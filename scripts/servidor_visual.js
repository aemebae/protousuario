// PROTOUSUARIO / AGENTE-ESPEJO — servidor de la interfaz visual (Capa 2 + globo)
//
// Corre con:  node scripts/servidor_visual.js
// Abre luego: http://localhost:3000  (o Chrome en modo kiosco, ver README)
//
// QUÉ HACE:
// 1) Sirve public/ (el globo de datos) como página estática.
// 2) Mantiene un WebSocket con cada navegador conectado y les EMPUJA eventos.
// 3) Expone POST /evento -- por ahí entra TODO lo que manda el orquestador
//    (test_manifiesto_estructurado.js), que corre como OTRO proceso de Node.
// 4) Corre un "ciclo de espera" que mantiene el globo vivo ANTES de que
//    empiece la performance.
//
// ---- ARREGLO DE LA DESINCRONIZACIÓN (importante) ----
// Antes, este servidor consultaba obtenerDatoOrbital() cada 5s POR SU CUENTA,
// mientras el orquestador la consultaba APARTE al generar cada manifiesto.
// Dos consultas independientes, en momentos distintos = dos satélites
// distintos = el globo mostraba un territorio y Gemini nombraba otro.
//
// Ahora hay UNA sola fuente de verdad, con relevo automático:
//   - Mientras NO haya orquestador hablando: este ciclo de espera manda
//     (el globo se ve vivo aunque la performance no haya empezado).
//   - En cuanto el orquestador manda su primer evento: este ciclo SE APAGA
//     solo, y el globo pasa a mostrar exactamente el satélite del manifiesto.
//   - Si el orquestador se queda callado más de SILENCIO_MS: el ciclo de
//     espera vuelve a encenderse solo (por si cierras esa terminal).

import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { obtenerDatoOrbital } from './capa2_dato_orbital_v3.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, '..');

// ---------- Ajustes ----------
const PUERTO = process.env.PUERTO_VISUAL || 3000;
const GRUPO_SATELITAL = process.env.GRUPO_SATELITAL || 'stations';
const POLL_MS = 5000;        // cada cuánto refresca el ciclo de espera
const SILENCIO_MS = 120000;  // si el orquestador calla 2 min, vuelve el ciclo de espera

// ---------- Índice país -> posición en el GeoJSON (para resaltar en el cliente) ----------
const paisesGeoJSON = JSON.parse(
  readFileSync(join(RAIZ, 'data', 'ne_110m_admin_0_countries.geojson'), 'utf8')
);
const indicePorAdmin = new Map(paisesGeoJSON.features.map((f, i) => [f.properties.ADMIN, i]));

function indiceDePais(pais, pais_tipo) {
  return (pais_tipo === 'pais' || pais_tipo === 'pais_cercano') ? indicePorAdmin.get(pais) : undefined;
}

// ---------- Servidor Express + WebSocket ----------
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(join(RAIZ, 'public')));

const server = createServer(app);
const wss = new WebSocketServer({ server });
const clientes = new Set();

// Memoria del último estado, para que un navegador que se conecta TARDE
// (o que recargas a media performance) no aparezca vacío.
const ultimoEstado = { afecto: 'AUTORITARIO', salud: 'ONLINE_COMPLETO', posiciones: null, territorio: null };

wss.on('connection', (ws) => {
  clientes.add(ws);
  console.log(`[visual] navegador conectado (${clientes.size} activo/s)`);
  // reenviar el estado actual al recién llegado
  enviarA(ws, 'afecto', { estado: ultimoEstado.afecto });
  enviarA(ws, 'salud', { modo: ultimoEstado.salud });
  if (ultimoEstado.posiciones) enviarA(ws, 'posiciones', ultimoEstado.posiciones);
  if (ultimoEstado.territorio) enviarA(ws, 'territorio', ultimoEstado.territorio);
  ws.on('close', () => clientes.delete(ws));
});

function enviarA(ws, tipo, datos) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ tipo, datos, t: Date.now() }));
}

function emitir(tipo, datos) {
  const msg = JSON.stringify({ tipo, datos, t: Date.now() });
  for (const ws of clientes) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

// ---------- Relevo: ¿manda el orquestador o el ciclo de espera? ----------
let ultimoEventoOrquestador = 0;
const orquestadorActivo = () => Date.now() - ultimoEventoOrquestador < SILENCIO_MS;

app.post('/evento', (req, res) => {
  const { tipo, datos } = req.body || {};
  if (!tipo) return res.status(400).json({ error: 'falta "tipo"' });

  const primeraVez = !orquestadorActivo();
  ultimoEventoOrquestador = Date.now();
  if (primeraVez) console.log('[visual] orquestador tomó el control — ciclo de espera en pausa.');

  // El dato satelital del manifiesto se traduce a los eventos que el globo
  // ya sabe dibujar, para que muestre EXACTAMENTE ese satélite y territorio.
  if (tipo === 'satelite_manifiesto') {
    const d = datos || {};
    ultimoEstado.salud = d.modo_datos || ultimoEstado.salud;
    emitir('salud', { modo: ultimoEstado.salud });

    if (d.lat != null) {
      const protagonista = {
        nombre: d.satelite, nombreEnunciable: d.satelite_enunciable,
        lat: d.lat, lon: d.lon, altKm: d.altKm,
        elevacionDeg: d.elevacionDeg, rangeKm: d.rangeKm,
      };
      ultimoEstado.posiciones = { todos: d.todos || [], protagonista };
      emitir('posiciones', ultimoEstado.posiciones);

      ultimoEstado.territorio = {
        tipo: d.pais_tipo, nombre: d.pais,
        paisIdx: indiceDePais(d.pais, d.pais_tipo),
        region: d.region, region_real: d.region_real,
      };
      emitir('territorio', ultimoEstado.territorio);
    }
    return res.json({ ok: true });
  }

  if (tipo === 'afecto' && datos?.estado) ultimoEstado.afecto = datos.estado;

  emitir(tipo, datos ?? {});
  res.json({ ok: true });
});

// ---------- Ciclo de espera (solo cuando el orquestador está callado) ----------
async function cicloEspera() {
  if (orquestadorActivo()) return; // el orquestador manda: no interferir
  try {
    const dato = await obtenerDatoOrbital({ grupo: GRUPO_SATELITAL });

    ultimoEstado.salud = dato.modo_datos;
    emitir('salud', { modo: dato.modo_datos });

    if (dato.lat != null) {
      const protagonista = {
        nombre: dato.satelite, nombreEnunciable: dato.satelite_enunciable,
        lat: dato.lat, lon: dato.lon, altKm: dato.altKm,
        elevacionDeg: dato.elevacionDeg, rangeKm: dato.rangeKm,
      };
      ultimoEstado.posiciones = { todos: dato.todos, protagonista };
      emitir('posiciones', ultimoEstado.posiciones);

      ultimoEstado.territorio = {
        tipo: dato.pais_tipo, nombre: dato.pais,
        paisIdx: indiceDePais(dato.pais, dato.pais_tipo),
        region: dato.region, region_real: dato.region_real,
      };
      emitir('territorio', ultimoEstado.territorio);
    }
  } catch (e) {
    console.error('[visual] error en ciclo de espera:', e.message || e);
  }
}

server.listen(PUERTO, () => {
  console.log(`\n✓ Interfaz visual en http://localhost:${PUERTO}`);
  console.log(`  Grupo satelital: ${GRUPO_SATELITAL}  |  ciclo de espera cada ${POLL_MS / 1000}s`);
  console.log('  Esperando al orquestador (test_manifiesto_estructurado.js)...\n');
  cicloEspera();
  setInterval(cicloEspera, POLL_MS);
});
