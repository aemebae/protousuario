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
import { networkInterfaces } from 'node:os';
import { obtenerDatoOrbital } from './capa2_dato_orbital_v3.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, '..');

// ---------- Ajustes ----------
const PUERTO = process.env.PUERTO_VISUAL || 3000;
const GRUPO_SATELITAL = process.env.GRUPO_SATELITAL || 'active';
const POLL_MS = Number(process.env.POLL_MS || 10000); // ciclo de espera (10 s: menos carga)
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


// ═══════════════════════════════════════════════════════════════════════
//  CONTROL REMOTO DESDE EL CELULAR
//  El orquestador (test_manifiesto_estructurado.js) ya no depende solo de
//  ENTER en la terminal: espera un comando que puede venir del celular
//  (POST /control) o de la tecla. Lo que llegue primero, gana.
//
//  CÓMO FUNCIONA (long-polling): el orquestador hace GET /control/esperar y
//  ese pedido queda ABIERTO, sin responder, hasta que alguien toca un botón
//  en el celular. Ahí el servidor responde y el orquestador sigue. Es la
//  forma más simple y robusta de que dos procesos se coordinen sin
//  WebSocket de por medio.
// ═══════════════════════════════════════════════════════════════════════
let esperandoOrquestador = null;   // { resolver, contexto }
const colaComandos = [];

function entregarComando(cmd) {
  if (esperandoOrquestador) {
    const { resolver } = esperandoOrquestador;
    esperandoOrquestador = null;
    resolver(cmd);
  } else {
    colaComandos.push(cmd);   // llegó antes de que el orquestador preguntara
  }
  emitir('control', { comando: cmd, t: Date.now() });
}

// El celular manda un comando.
app.post('/control', (req, res) => {
  const cmd = req.body?.comando;
  const validos = ['avanzar', 'repetir', 'saltar_agente', 'terminar', 'pausa'];
  if (!validos.includes(cmd)) return res.status(400).json({ error: 'comando inválido', validos });
  console.log(`[control] ${cmd.toUpperCase()}`);
  entregarComando(cmd);
  res.json({ ok: true, comando: cmd });
});

// El orquestador pregunta "¿qué hago ahora?" y espera aquí colgado.
app.get('/control/esperar', (req, res) => {
  if (colaComandos.length) return res.json({ comando: colaComandos.shift() });
  esperandoOrquestador = { resolver: (cmd) => res.json({ comando: cmd }) };
  req.on('close', () => { if (esperandoOrquestador) esperandoOrquestador = null; });
});

// El orquestador informa en qué punto está, para que el celular lo muestre.
app.post('/control/estado', (req, res) => {
  ultimoEstado.control = req.body || {};
  emitir('control_estado', ultimoEstado.control);
  res.json({ ok: true });
});
app.get('/control/estado', (req, res) => res.json(ultimoEstado.control ?? {}));

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

// ---------- Direcciones reales de esta laptop en la red ----------
// EL ERROR MÁS CARO DE TODOS: escribir "localhost:3000" en el celular.
// En el celular, `localhost` ES EL CELULAR. Hay que escribir la IP de la
// LAPTOP. Este bloque la imprime en grande al arrancar para que no haya
// que adivinarla nunca más, y la reimprime si cambias de red (hotspot).
function direccionesLan() {
  const salida = [];
  for (const [nombre, lista] of Object.entries(networkInterfaces())) {
    for (const i of lista || []) {
      if (i.family === 'IPv4' && !i.internal) salida.push({ nombre, ip: i.address });
    }
  }
  return salida;
}

// 0.0.0.0 explícito: escucha en TODAS las interfaces (Wi-Fi, hotspot,
// ethernet). Sin esto, algunas configuraciones de Windows solo abren el
// puerto en loopback y el celular nunca llega.
server.listen(PUERTO, '0.0.0.0', () => {
  const ips = direccionesLan();
  console.log('\n════════════════════════════════════════════════════');
  console.log('  ESCENA COMPUESTA (proyector)  http://localhost:' + PUERTO);
  console.log('  CONTROL (esta laptop)         http://localhost:' + PUERTO + '/control.html');
  console.log('  ──────────────────────────────────────────────────');
  if (ips.length) {
    console.log('  DESDE EL CELULAR, escribe UNA de estas (con http:// y todo):');
    for (const { nombre, ip } of ips) {
      console.log(`     http://${ip}:${PUERTO}/control.html      [${nombre}]`);
    }
  } else {
    console.log('  ⚠ Sin red: no hay IP de LAN. Conecta el Wi-Fi / hotspot.');
  }
  console.log('════════════════════════════════════════════════════');
  console.log(`  Grupo satelital: ${GRUPO_SATELITAL} | ciclo de espera: ${POLL_MS / 1000}s`);
  console.log('  Esperando al orquestador...\n');
  cicloEspera();
  setInterval(cicloEspera, POLL_MS);
});
