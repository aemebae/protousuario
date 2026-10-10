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
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';
import { obtenerDatoOrbital, repropagarNube } from './capa2_dato_orbital_v3.js';
// Distrito / ciudad bajo el satélite (curaduría propia, offline, 0 MB extra).
import { resolverLugar } from './resolver_lugar.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, '..');

// ---------- Ajustes ----------
const PUERTO = process.env.PUERTO_VISUAL || 3000;
const GRUPO_SATELITAL = process.env.GRUPO_SATELITAL || 'active';
const POLL_MS = Number(process.env.POLL_MS || 10000); // ciclo de espera (10 s: menos carga)
const SILENCIO_MS = 120000;  // si el orquestador calla 2 min, vuelve el ciclo de espera
// TICK RÁPIDO: cada cuánto se recalculan SOLO las posiciones ya elegidas, para
// que los satélites se vean moverse de forma continua. Cuesta <2 ms porque los
// satrec están memorizados. Súbelo a 2000 si tu laptop sufre; 0 lo desactiva.
const TICK_MS = Number(process.env.TICK_MS || 900);
// DENSIDAD DE LA NUBE en la pantalla (v16). Se ajusta en la misma línea con
// la que arrancas el servidor, sin tocar ningún archivo:
//   $env:MAX_SATELITES="todos" ; $env:TAM_SATELITE=2.6 ; $env:ABRAZO=0.5 ; node scripts\servidor_visual.js
const CONFIG_ESCENA = {
  tamSatelite: Number(process.env.TAM_SATELITE || 0) || null,   // px del punto (3.4 por defecto)
  abrazo: Number(process.env.ABRAZO || 0) || null,              // 1 = altura real; 0.4 = pegados al suelo
  alturaMax: Number(process.env.ALTURA_MAX || 0) || null,       // techo de la nube (0.45 por defecto)
};
// Con muchos satélites, el tic de movimiento se espacia solo para no cargar
// la laptop: hasta 2.500 cada 0,9 s; más que eso, cada 2 s (a esa escala el
// salto de un punto entre tic y tic no se ve).
const tickNube = (n) => Number(process.env.TICK_MS) || (n > 2500 ? 2000 : 900);

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

// ---------- Imágenes del CLON TRANSESPECIE ----------
// La carpeta vive en la raíz (con espacio en el nombre). Se sirve por su
// propia ruta para no tener que mover ni renombrar nada. Caché larga: son
// 21 PNG de ~1 MB que el navegador carga UNA vez y reutiliza toda la noche.
app.use('/clon-img', express.static(join(RAIZ, 'CLON TRANSESPECIE'), {
  maxAge: '7d',
  fallthrough: true,
}));

// La lista de esa carpeta. El clon la pide al arrancar: así una imagen nueva
// o renombrada entra sola, sin tocar clon.html (julix → jvlix, Yakuruna…).
// Las maquetas jvlix-transespecie las descarta el propio clon.
app.get('/clon-lista', (req, res) => {
  try {
    res.json(readdirSync(join(RAIZ, 'CLON TRANSESPECIE')).filter((n) => /\.png$/i.test(n)));
  } catch {
    res.json([]);
  }
});

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
  if (ultimoEstado.posiciones) enviarA(ws, 'posiciones', compactar(ultimoEstado.posiciones));
  enviarA(ws, 'config_escena', CONFIG_ESCENA);
  if (ultimoEstado.territorio) enviarA(ws, 'territorio', ultimoEstado.territorio);
  // El rumbo también: una pantalla que se recarga a media función recupera la
  // rosa de los vientos y el clon recupera su integridad (AUTORIZADO / DESPLAZADO).
  if (ultimoEstado.rumbo) enviarA(ws, 'rumbo', ultimoEstado.rumbo);
  if (ultimoEstado.secuencia) enviarA(ws, 'secuencia', ultimoEstado.secuencia);
  if (ultimoEstado.deriva) enviarA(ws, 'deriva', { activa: true });
  if (ultimoEstado.control) enviarA(ws, 'control_estado', ultimoEstado.control);
  ws.on('close', () => clientes.delete(ws));
  // ── LO QUE LOS NAVEGADORES LE DICEN AL SERVIDOR (v16) ──
  // Faltaba del todo: el celular decía "soy el control" para que no le
  // mandaran la nube de satélites, pero nadie escuchaba. Tu celular recibía
  // ~145 KB cada 0,9 s por el hotspot. Con 16.000 satélites habrían sido
  // más de 2 MB por segundo: el control se habría ahogado.
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(String(raw)); } catch { return; }
    if (m?.soy === 'control' || m?.soy === 'clon') ES_CONTROL.add(ws);
    // La escena avisa que la VOZ de un bloque terminó de verdad. Con eso el
    // orquestador pasa al siguiente, en vez de adivinar con un reloj.
    if (m?.tipo === 'fin_bloque' && m.token != null) entregarComando('fin:' + m.token);
  });
});

// La nube viaja COMPACTA: [lat, lon, alt, lat, lon, alt, …] redondeada.
// Con nombre y clave de cada satélite pesaba ~6 veces más. El servidor se
// queda con la versión completa (la necesita para seguir moviéndolos).
function compactar(pos, tick = false) {
  if (!pos) return pos;
  const n = pos.todos || [];
  const nube = new Array(n.length * 3);
  for (let i = 0; i < n.length; i++) {
    nube[i * 3] = Math.round(n[i].lat * 100) / 100;
    nube[i * 3 + 1] = Math.round(n[i].lon * 100) / 100;
    nube[i * 3 + 2] = Math.round(n[i].altKm ?? 500);
  }
  return { nube, protagonista: pos.protagonista ?? null, protagonistaB: pos.protagonistaB ?? null,
           ...(tick ? { tick: true } : {}) };
}
function emitirPosiciones(pos, tick = false) { emitir('posiciones', compactar(pos, tick)); }

// ── PALESTINA, NUNCA ISRAEL ──
// Mientras el territorio sea la Franja de Gaza, el país que se resalta y se
// nombra en pantalla es Palestina, tenga el satélite debajo Israel, Egipto o
// el mar. Y en cualquier otro momento, si debajo queda Israel, se muestra
// Palestina. Es una decisión de la obra.
function palestinaSiempre(ter) {
  if (!ter) return ter;
  const enGaza = /gaza/i.test(ter.region ?? '');
  if (enGaza || /^israel$/i.test(String(ter.nombre ?? '').trim())) {
    return { ...ter, nombre: 'Palestina', tipo: 'pais', paisIdx: undefined };
  }
  return ter;
}

function enviarA(ws, tipo, datos) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ tipo, datos, t: Date.now() }));
}

const ES_CONTROL = new WeakSet();
// Eventos pesados que solo tienen sentido en la pantalla grande.
const SOLO_ESCENA = new Set(['posiciones']);

function emitir(tipo, datos) {
  const msg = JSON.stringify({ tipo, datos, t: Date.now() });
  const pesado = SOLO_ESCENA.has(tipo);
  for (const ws of clientes) {
    if (ws.readyState !== 1) continue;
    // Al celular no le mandamos la nube de satélites: con 1000 satélites eso
    // son ~120 KB cada 900 ms viajando por el hotspot para nada.
    if (pesado && ES_CONTROL.has(ws)) continue;
    ws.send(msg);
  }
}

// ---------- Relevo: ¿manda el orquestador o el ciclo de espera? ----------
let ultimoEventoOrquestador = 0;
// Vivo = mandó algo hace poco, O está ahora mismo esperando un botón del
// celular. Esto último faltaba: durante una PAUSA larga el orquestador no
// manda nada (solo espera), y a los 2 minutos el servidor lo daba por muerto
// y el globo volvía a recorrer territorios EN PLENA PAUSA.
const orquestadorActivo = () =>
  esperandoOrquestador != null || Date.now() - ultimoEventoOrquestador < SILENCIO_MS;

app.post('/evento', (req, res) => {
  const { tipo, datos } = req.body || {};
  if (!tipo) return res.status(400).json({ error: 'falta "tipo"' });

  const primeraVez = !orquestadorActivo();
  ultimoEventoOrquestador = Date.now();
  anunciarOrquestador();
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
        k: d.protagonista_k,
        lat: d.lat, lon: d.lon, altKm: d.altKm,
        elevacionDeg: d.elevacionDeg, rangeKm: d.rangeKm,
      };
      // El satélite del SEGUNDO territorio: se dibuja también, sin mover la cámara.
      const protagonistaB = d.protagonista_b?.lat != null ? {
        nombre: d.protagonista_b.nombre, k: d.protagonista_b.k,
        lat: d.protagonista_b.lat, lon: d.protagonista_b.lon, altKm: d.protagonista_b.altKm,
      } : null;
      ultimoEstado.posiciones = { todos: d.todos || [], protagonista, protagonistaB };
      emitirPosiciones(ultimoEstado.posiciones);

      const lug = resolverLugar(d.lat, d.lon);
      ultimoEstado.territorio = palestinaSiempre({
        tipo: d.pais_tipo, nombre: d.pais,
        paisIdx: indiceDePais(d.pais, d.pais_tipo),
        region: d.region, region_real: d.region_real,
        distrito: lug?.tipo === 'distrito' || lug?.tipo === 'sitio' ? lug.nombre : null,
        ciudad: lug?.tipo === 'ciudad' ? lug.nombre : null,
      });
      emitir('territorio', ultimoEstado.territorio);
    }
    return res.json({ ok: true });
  }

  if (tipo === 'afecto' && datos?.estado) ultimoEstado.afecto = datos.estado;
  if (tipo === 'rumbo' && datos?.estado) ultimoEstado.rumbo = datos;
  // La secuencia completa se guarda: un celular que se reconecta a media
  // función recupera de golpe todos los textos que faltan.
  if (tipo === 'secuencia') {
    ultimoEstado.secuencia = datos ?? null;
    if (!datos?.actualizacion) ultimoEstado.bloque = null;
  }
  if (tipo === 'segmento' && typeof datos?.indice === 'number') {
    ultimoEstado.bloque = datos.indice;
    emitir('bloque', { i: datos.indice });   // el celular resalta esa línea
  }
  if (tipo === 'deriva') ultimoEstado.deriva = !!datos?.activa;

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
    // Un "fin" que nadie recogió no debe acumularse.
    while (colaComandos.length > 40) colaComandos.shift();
  }
  if (!String(cmd).startsWith('fin:')) emitir('control', { comando: cmd, t: Date.now() });
}

// ───────── AUDIO ─────────
// El navegador pide /audio/<huella>.mp3 y el servidor lo busca primero en
// audio_respaldo/ (lo que grabaste en casa) y después en audio_cache/ (lo
// generado en vivo). Se sirve desde la laptop, así que en el patio esto NO
// consume datos móviles: viaja por el hotspot, que es red local.
app.get('/audio/:archivo', (req, res) => {
  const nombre = String(req.params.archivo).replace(/[^a-z0-9._-]/gi, '');
  for (const dir of ['audio_respaldo', 'audio_cache']) {
    const ruta = resolve(process.cwd(), dir, nombre);
    if (existsSync(ruta)) {
      res.type('audio/mpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(ruta);
    }
  }
  res.status(404).end();
});

// ───────── SONIDOS EXTERNOS ─────────
// Tus mp3 se sirven por su NOMBRE REAL, no por huella: no pasan por ElevenLabs.
app.get('/sonido/:archivo', (req, res) => {
  const pedido = decodeURIComponent(String(req.params.archivo));
  if (pedido.includes('..') || /[\\/]/.test(pedido)) return res.status(400).end();
  const ruta = resolve(process.cwd(), 'sonidos externos', pedido);
  if (!existsSync(ruta)) return res.status(404).end();
  res.type('audio/mpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(ruta);
});

// Estado de pausa: vive aquí, en el servidor, para que la pantalla reaccione
// sin esperar al orquestador.
let estadoPausa = false;

// ═══════════════════════════════════════════════════════════════════════════
//  ARRANCAR LA PERFORMANCE DESDE EL CELULAR (botón ▶ EMPEZAR)
//  El servidor lanza correr_performance.js como proceso hijo, en esta misma
//  terminal: ves su salida aquí y el ENTER del teclado le sigue llegando.
//
//  ¿Y LOS BOTONES DEL CELULAR? El control atenúa ATRÁS / AVANZAR / PAUSA /
//  REPETIR hasta que el servidor le dice "corriendo". Antes eso SOLO pasaba
//  si arrancabas con el botón: arrancando desde la terminal, los botones se
//  quedaban apagados. Ahora "corriendo" significa que HAY un orquestador
//  vivo, lo haya lanzado quien lo haya lanzado.
// ═══════════════════════════════════════════════════════════════════════════
let procesoOrquestador = null;
const hijoVivo = () => !!(procesoOrquestador && procesoOrquestador.exitCode === null);
const orquestadorCorriendo = () => hijoVivo() || esperandoOrquestador != null
  || Date.now() - ultimoEventoOrquestador < 15000;
let corriendoAnunciado = null;
function anunciarOrquestador(forzar = false) {
  const vivo = orquestadorCorriendo();
  if (forzar || vivo !== corriendoAnunciado) {
    corriendoAnunciado = vivo;
    emitir('orquestador', { corriendo: vivo });
  }
}
setInterval(anunciarOrquestador, 2000);

function arrancarOrquestador() {
  if (orquestadorCorriendo()) {
    console.log('[control] EMPEZAR ignorado: la performance ya está corriendo.');
    emitir('orquestador', { corriendo: true, aviso: 'ya estaba corriendo' });
    return { ok: false, motivo: 'ya_corriendo' };
  }
  console.log('\n' + '▶'.repeat(36));
  console.log('  ARRANQUE REMOTO desde el celular');
  console.log('▶'.repeat(36) + '\n');

  const env = join(RAIZ, '.env');
  const args = existsSync(env) ? [`--env-file=${env}`] : [];
  if (!args.length) console.warn('  ⚠ no encuentro .env en la raíz: el orquestador arranca sin claves.');
  procesoOrquestador = spawn(process.execPath, [...args, join(__dirname, 'correr_performance.js')],
                             { cwd: RAIZ, stdio: 'inherit', env: process.env });
  anunciarOrquestador(true);

  procesoOrquestador.on('exit', (codigo) => {
    console.log(`\n■ La performance terminó (código ${codigo}).\n`);
    procesoOrquestador = null;
    ultimoEventoOrquestador = 0;      // vuelve la espera y el botón EMPEZAR
    anunciarOrquestador(true);
  });
  procesoOrquestador.on('error', (e) => {
    console.error('✗ No se pudo arrancar el orquestador:', e.message);
    procesoOrquestador = null;
    anunciarOrquestador(true);
  });
  return { ok: true };
}

// El celular manda un comando.
app.post('/control', (req, res) => {
  const cmd = req.body?.comando;
  const validos = ['avanzar', 'retroceder', 'repetir', 'saltar_agente',
                   'terminar', 'pausa', 'deriva', 'auto', 'manual', 'arrancar'];
  const esVelocidad = typeof cmd === 'string' && /^velocidad:[0-9.]+$/.test(cmd);
  const esIr = typeof cmd === 'string' && /^ir:\d+$/.test(cmd);   // saltar a un bloque
  if (!validos.includes(cmd) && !esVelocidad && !esIr) {
    return res.status(400).json({ error: 'comando inválido', validos });
  }

  // ═══ LA PAUSA LA MANDA EL SERVIDOR, NO EL ORQUESTADOR ═══
  // Este era el fallo que notaste: si el aviso de pausa tenía que dar la
  // vuelta por el orquestador, llegaba tarde y la frase terminaba igual. El
  // orquestador solo escucha entre bloques; el texto, en cambio, se escribe
  // letra a letra en el navegador. Ahora la pantalla se entera EN EL INSTANTE
  // en que sueltas el botón, y por eso congela en la letra exacta.
  {
    const antes = estadoPausa;
    if (cmd === 'pausa') estadoPausa = !estadoPausa;
    else estadoPausa = false;               // cualquier otro botón reanuda
    if (estadoPausa !== antes) {
      ultimoEstado.pausa = estadoPausa;
      emitir('pausa', { activa: estadoPausa });
    }
  }
  if (cmd === 'arrancar') {
    const r = arrancarOrquestador();
    return res.json({ ok: r.ok, comando: cmd, motivo: r.motivo ?? null });
  }
  if (esIr) { entregarComando(cmd); return res.json({ ok: true, comando: cmd }); }
  // La velocidad la aplica el navegador al vuelo (playbackRate): no hay que
  // regrabar nada, no cuesta créditos, y se oye el cambio al instante.
  if (esVelocidad) {
    const v = Math.min(2, Math.max(0.5, Number(cmd.split(':')[1]) || 1));
    ultimoEstado.velocidad = v;
    emitir('velocidad', { valor: v });
    entregarComando(cmd);
    return res.json({ ok: true, comando: cmd });
  }
  if (cmd === 'auto' || cmd === 'manual') {
    ultimoEstado.modo = cmd;
    emitir('modo', { auto: cmd === 'auto' });
    entregarComando(cmd);
    return res.json({ ok: true, comando: cmd });
  }
  console.log(`[control] ${cmd.toUpperCase()}`);
  entregarComando(cmd);
  res.json({ ok: true, comando: cmd });
});

// El orquestador pregunta "¿qué hago ahora?" y espera aquí colgado.
app.get('/control/esperar', (req, res) => {
  ultimoEventoOrquestador = Date.now();
  anunciarOrquestador();
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
// ═══════════════════════════════════════════════════════════════════════════
//  LA ESPERA TAMBIÉN VIGILA TUS TERRITORIOS
//  Antes de que empiece la función (y entre fases), el globo elegía "el
//  satélite más alto en el cielo de Lima": casi siempre sobre el Pacífico,
//  y el plano detalle mostraba agua lisa, sin terreno.
//  Ahora recorre tus territorios — los que tienen agente en
//  regiones_conflicto.json —, uno cada ROTACION_ESPERA_S segundos, siempre
//  con el satélite que en ese momento está encima. Entre un territorio y el
//  siguiente, cada ciclo releva al satélite que acaba de llegar.
// ═══════════════════════════════════════════════════════════════════════════
const ROTACION_ESPERA_S = Number(process.env.ROTACION_ESPERA_S || 30);
let territoriosEspera = [];
try {
  territoriosEspera = (JSON.parse(readFileSync(join(RAIZ, 'regiones_conflicto.json'), 'utf8')).regiones ?? [])
    .filter((r) => r.agente && r.bbox);
} catch { territoriosEspera = []; }
let iEspera = -1, tRotacion = 0;

async function cicloEspera() {
  if (orquestadorActivo()) return; // el orquestador manda: no interferir
  try {
    let territorios = [];
    if (territoriosEspera.length) {
      if (iEspera < 0 || Date.now() - tRotacion >= ROTACION_ESPERA_S * 1000) {
        iEspera = (iEspera + 1) % territoriosEspera.length;
        tRotacion = Date.now();
      }
      territorios = [territoriosEspera[iEspera]];
    }
    const dato = await obtenerDatoOrbital({ grupo: GRUPO_SATELITAL, territorios, silencioso: iEspera > 0 });

    ultimoEstado.salud = dato.modo_datos;
    // Se manda también el conteo: así la esquina de la escena te dice cuántos
    // satélites hay de verdad, sin tener que mirar la terminal.
    emitir('salud', { modo: dato.modo_datos, sats: dato.n_enviados ?? 0, total: dato.n_grupo ?? 0 });

    if (dato.lat != null) {
      const protagonista = {
        nombre: dato.satelite, nombreEnunciable: dato.satelite_enunciable,
        k: dato.protagonista_k,
        lat: dato.lat, lon: dato.lon, altKm: dato.altKm,
        elevacionDeg: dato.elevacionDeg, rangeKm: dato.rangeKm,
      };
      ultimoEstado.posiciones = { todos: dato.todos, protagonista };
      emitirPosiciones(ultimoEstado.posiciones);

      const lug = resolverLugar(dato.lat, dato.lon);
      ultimoEstado.territorio = palestinaSiempre({
        tipo: dato.pais_tipo, nombre: dato.pais,
        paisIdx: indiceDePais(dato.pais, dato.pais_tipo),
        region: dato.region, region_real: dato.region_real,
        distrito: lug?.tipo === 'distrito' || lug?.tipo === 'sitio' ? lug.nombre : null,
        ciudad: lug?.tipo === 'ciudad' ? lug.nombre : null,
      });
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
// ---------- TICK RÁPIDO: movimiento continuo de la nube ----------
// No vuelve a decidir nada: repropaga las MISMAS posiciones ya elegidas, para
// que el globo no dé saltos cada 10 s. Manda { tick: true } para que el
// cliente actualice los puntos sin volver a mover la cámara.
function tickRapido() {
  const pos = ultimoEstado.posiciones;
  if (!pos || !pos.todos?.length) return;
  const ahora = new Date();
  const todos = repropagarNube(pos.todos, ahora);
  const mover = (sat) => {
    if (!sat?.k) return sat ?? null;
    const p = repropagarNube([{ nombre: sat.nombre, k: sat.k }], ahora)[0];
    return p ? { ...sat, lat: p.lat, lon: p.lon, altKm: p.altKm } : sat;
  };
  const protagonista = mover(pos.protagonista);
  const protagonistaB = mover(pos.protagonistaB);
  emitirPosiciones({ todos, protagonista, protagonistaB }, true);
}
// El tic se reprograma solo, más espaciado cuanto más grande es la nube.
function cicloTick() {
  const t0 = Date.now();
  try { tickRapido(); } catch (e) { console.warn('[visual] tic:', e.message); }
  const n = ultimoEstado.posiciones?.todos?.length ?? 0;
  const costo = Date.now() - t0;
  if (n > 2500 && costo > 400) console.warn(`[visual] mover ${n} satélites tomó ${costo} ms: baja MAX_SATELITES si notas lentitud.`);
  setTimeout(cicloTick, Math.max(tickNube(n), costo * 2));
}

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
  console.log('  Arranca la performance DESDE EL CELULAR con ▶ EMPEZAR,');
  console.log('  o a mano en otra terminal:');
  console.log('     node --env-file=.env scripts\\correr_performance.js\n');
  cicloEspera();
  setInterval(cicloEspera, POLL_MS);
  if (TICK_MS !== 0 || !process.env.TICK_MS) setTimeout(cicloTick, 900);
});
