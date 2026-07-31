// PROTOUSUARIO / AGENTE-ESPEJO — cliente de la interfaz de rastreo orbital
//
// Todo lo que corre aquí es 100% local: globe.gl.min.js se carga desde
// vendor/ (sin CDN; ya trae three.js empacado adentro, por eso NO cargamos
// un three.min.js aparte -- eso causaba un conflicto de versiones). El
// GeoJSON de países se carga desde data/ (Natural Earth, dominio público).
//
// Este archivo solo ESCUCHA y PINTA. No decide nada: ni qué satélite mostrar
// ni qué estado afectivo aplicar. Todo eso llega por WebSocket desde
// servidor_visual.js, que a su vez lo recibe del orquestador.

// ---------- Paleta espejo de styles.css ----------
// Los colores del globo 3D no pueden leer las variables CSS, así que aquí
// hay una copia. AL AGREGAR UN ESTADO NUEVO: agrégalo en los DOS lados.
const PALETA = {
  AUTORITARIO: { grid: 0x3a5c46, accent: 0x55ffa6, accentDim: 0x2b6b49 },
  TERNURA:     { grid: 0x6b4f96, accent: 0xc9a6ff, accentDim: 0x6b4f96 },
};
const ESTADO_POR_DEFECTO = 'AUTORITARIO';

let estadoActual = ESTADO_POR_DEFECTO;
let paisActualIdx = -1;
let satelites = [];
let protagonista = null;

const el = (id) => document.getElementById(id);
const elPanel = {
  satelite: el('tSatelite'), coords: el('tCoords'), alt: el('tAlt'),
  elev: el('tElev'), estado: el('tEstado'),
};

const temporizadores = {};
function mostrarTemporal(nodo, ms) {
  nodo.classList.add('visible');
  clearTimeout(temporizadores[nodo.id]);
  if (ms) temporizadores[nodo.id] = setTimeout(() => nodo.classList.remove('visible'), ms);
}

function colorHexCSS(n) { return '#' + n.toString(16).padStart(6, '0'); }
const paletaActual = () => PALETA[estadoActual] ?? PALETA[ESTADO_POR_DEFECTO];

// ---------- Globo ----------
// NO mostramos la esfera base (showGlobe(false)): así evitamos necesitar un
// material 3D personalizado, que exigiría cargar THREE por separado -- la
// causa exacta del error "Multiple instances of Three.js". Los países,
// satélites y anillos viven en capas independientes de la esfera, así que se
// dibujan igual. El resultado es el look de "líneas de datos sobre el vacío".
const globo = Globe()(el('globo'))
  .backgroundColor('rgba(0,0,0,0)')
  .showGlobe(false)
  .showAtmosphere(false)
  .showGraticules(false)
  .width(window.innerWidth)
  .height(window.innerHeight);

window.addEventListener('resize', () => {
  globo.width(window.innerWidth).height(window.innerHeight);
});

let paises = [];
fetch('data/ne_110m_admin_0_countries.geojson')
  .then((r) => r.json())
  .then((geo) => { paises = geo.features; dibujarPoligonos(); })
  .catch((e) => console.error('No se pudo cargar el GeoJSON de países:', e));

function dibujarPoligonos() {
  const p = paletaActual();
  globo
    .polygonsData(paises)
    .polygonCapColor((f, i) => (i === paisActualIdx ? colorHexCSS(p.accent) + '55' : 'rgba(0,0,0,0)'))
    .polygonSideColor(() => 'rgba(0,0,0,0)')
    .polygonStrokeColor((f, i) => (i === paisActualIdx ? colorHexCSS(p.accent) : colorHexCSS(p.grid)))
    .polygonAltitude((f, i) => (i === paisActualIdx ? 0.02 : 0.006));
}

function dibujarSatelites() {
  const p = paletaActual();
  globo
    .pointsData(satelites)
    .pointLat((d) => d.lat)
    .pointLng((d) => d.lon)
    .pointColor((d) => (d.esProtagonista ? colorHexCSS(p.accent) : colorHexCSS(p.accentDim)))
    .pointAltitude(0.012)
    .pointRadius((d) => (d.esProtagonista ? 0.55 : 0.22));

  const anillo = protagonista ? [{ lat: protagonista.lat, lng: protagonista.lon }] : [];
  globo
    .ringsData(anillo)
    .ringLat('lat').ringLng('lng')
    .ringColor(() => colorHexCSS(p.accent))
    .ringMaxRadius(4).ringPropagationSpeed(2).ringRepeatPeriod(1400);
}

// ---------- Estado afectivo ----------
function aplicarEstadoAfectivo(estado) {
  if (!estado) return;
  // Si llega un estado que todavía no tiene paleta definida, no rompemos
  // nada: mostramos su nombre y usamos la paleta por defecto.
  estadoActual = PALETA[estado] ? estado : ESTADO_POR_DEFECTO;
  document.documentElement.setAttribute('data-estado', estadoActual);
  elPanel.estado.textContent = estado; // el nombre real, aunque no tenga paleta
  dibujarPoligonos();
  dibujarSatelites();
}

// ---------- Bloques del manifiesto ----------
function mostrarBloque(idContenedor, idTexto, texto, ms) {
  if (!texto) return;
  el(idTexto).textContent = texto;
  mostrarTemporal(el(idContenedor), ms);
}

function mostrarOverlay(tipo, titulo, texto) {
  el('overlayTipo').textContent = tipo;
  el('overlayTitulo').textContent = titulo || '';
  el('overlayTexto').textContent = texto || '';
  el('overlay').classList.add('visible');
}
function ocultarOverlay() { el('overlay').classList.remove('visible'); }

// ---------- Territorio ----------
function mostrarTerritorio(d) {
  el('bTipo').textContent = d.tipo === 'oceano' ? 'CUERPO DE AGUA' : 'TERRITORIO';
  el('bNombre').textContent = d.nombre ?? '—';

  // La región curada de regiones_conflicto.json solo se anuncia cuando el
  // satélite REALMENTE la sobrevuela (region_real), no cuando fue una
  // asignación de respaldo -- para no mentirle al público.
  const elRegion = el('bRegion');
  if (d.region && d.region_real) {
    elRegion.textContent = '▸ ' + d.region;
    elRegion.classList.add('visible');
  } else {
    elRegion.classList.remove('visible');
  }

  mostrarTemporal(el('bannerTerritorio'), 0); // sin auto-ocultar: es el contexto permanente
  if (typeof d.paisIdx === 'number') { paisActualIdx = d.paisIdx; dibujarPoligonos(); }
}

// ---------- Posiciones ----------
function actualizarPosiciones(d) {
  satelites = (d.todos || []).map((s) => ({
    ...s,
    esProtagonista: d.protagonista && s.nombre === d.protagonista.nombre,
  }));
  protagonista = d.protagonista || null;
  dibujarSatelites();

  if (protagonista) {
    elPanel.satelite.textContent = protagonista.nombre;
    elPanel.coords.textContent = `${protagonista.lat.toFixed(2)}, ${protagonista.lon.toFixed(2)}`;
    elPanel.alt.textContent = protagonista.altKm != null ? protagonista.altKm.toFixed(0) : '—';
    elPanel.elev.textContent = protagonista.elevacionDeg != null ? protagonista.elevacionDeg.toFixed(1) : '—';
    globo.pointOfView({ lat: protagonista.lat, lng: protagonista.lon, altitude: 1.9 }, 2500);
  }
}

function actualizarSalud(modo) {
  el('textoSalud').textContent = modo;
  el('puntoSalud').classList.toggle('degradado', modo !== 'ONLINE_COMPLETO');
}

// ---------- WebSocket ----------
function conectar() {
  const ws = new WebSocket(`ws://${location.host}`);
  ws.onmessage = (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    const { tipo, datos: d } = msg;

    if (tipo === 'posiciones')  actualizarPosiciones(d);
    if (tipo === 'territorio')  mostrarTerritorio(d);
    if (tipo === 'afecto')      aplicarEstadoAfectivo(d.estado);
    if (tipo === 'salud')       actualizarSalud(d.modo);

    // Ceremoniales: toman la pantalla completa hasta que llegue el
    // siguiente bloque del manifiesto (ver más abajo).
    if (tipo === 'preludio')    mostrarOverlay('PRELUDIO', d.titulo, d.texto);
    if (tipo === 'agente_id')   mostrarOverlay('AGENTE ID', d.nombre, d.texto);

    // Los tres bloques del manifiesto. El primero que llega cierra el
    // overlay ceremonial: así el Preludio/Agente ID se queda en pantalla
    // todo el tiempo que tú tardes en presionar ENTER, ni más ni menos.
    if (tipo === 'bloque_orbital') {
      ocultarOverlay();
      // limpiamos los bloques del manifiesto anterior
      el('bloqueMemoria').classList.remove('visible');
      el('bloquePrompt').classList.remove('visible');
      mostrarBloque('bloqueOrbital', 'textoOrbital', d.texto, 0);
    }
    if (tipo === 'memoria') {
      ocultarOverlay();
      mostrarBloque('bloqueMemoria', 'textoMemoria', d.texto, 0);
    }
    if (tipo === 'prompt') {
      ocultarOverlay();
      mostrarBloque('bloquePrompt', 'textoPrompt', d.texto, 0);
    }
  };
  ws.onclose = () => {
    actualizarSalud('DEGRADADO');
    setTimeout(conectar, 2000);
  };
}
conectar();
