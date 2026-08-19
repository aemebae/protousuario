// PROTOUSUARIO / AGENTE-ESPEJO — cliente de la ESCENA COMPUESTA  ·  v4
// ═══════════════════════════════════════════════════════════════════════
// QUÉ CAMBIA RESPECTO A v3 (y por qué)
//
// 1. LAS RAYAS GROTESCAS.  globe.gl dibuja `pointsData` como CILINDROS que
//    salen de la superficie y llegan hasta la altitud pedida. Con altitud
//    0.35 eso son espigas larguísimas: exactamente lo que viste. Se cambia
//    a la capa `particlesData`, que son PUNTOS FLOTANTES de verdad (una
//    sola geometría THREE.Points), igual que satellitemap.space.
//
// 2. EL LAG.  Con `pointsMerge(false)` cada satélite era una malla aparte:
//    con el grupo `active` eso son ~13.000 mallas × 2 globos = ~26.000
//    draw calls por cuadro. La GTX 1050 no da. `particlesData` los dibuja
//    TODOS en 1 draw call. Además: se apaga el raycaster de hover
//    (`enablePointerInteraction(false)`), se limita el pixel ratio, el
//    globo pequeño ya no recibe la nube de satélites, y los polígonos solo
//    se repintan cuando de verdad cambian.
//
// 3. EL ANILLO DE RADAR "DEBAJO DEL GLOBO".  Los anillos salían a altitud
//    ~0.0015 y los polígonos de países a 0.004 / 0.016: el anillo quedaba
//    SEPULTADO bajo la capa de países. Se sube con `ringAltitude`.
//
// 4. COLOR TIPO GOOGLE MAPS.  Modo 'satelite': una sola textura NASA Blue
//    Marble sobre la esfera (1 draw call, más realista Y más fluido que
//    pintar 250 polígonos). Modo 'mapa': coloreado por bioma, sin archivos
//    externos. Si la textura no está, cae solo al modo 'mapa'.
//
// 5. SEGMENTOS DEL PROMPT-MANIFIESTO.  Rótulo SOLO en "DATO ORBITAL" y
//    "PROMPT". Memoria episódica y Narración NatGeo entran sin título,
//    diferenciadas únicamente por tipografía. El rótulo PROMPT aparece una
//    sola vez por agente: los actos siguientes de la misma secuencia caen
//    sin título.
// ═══════════════════════════════════════════════════════════════════════

// ── AJUSTES QUE PUEDES TOCAR SIN SABER JS ─────────────────────────────
const MODO_GLOBO   = 'mapa';   // en vez de 'satelite' (textura NASA) | 'mapa' (biomas)
const TEXTURA      = 'img/earth-blue-marble.jpg';
const RELIEVE      = 'img/earth-topology.png';   // opcional; '' para desactivar
const MOSTRAR_BORDES = true;       // fronteras de países sobre la textura
const TAM_SATELITE   = 2.4;        // px del punto de los satélites de fondo
const TAM_PROTA      = 8.0;        // px del punto del satélite protagonista
const PIXEL_RATIO_MAX = 1.25;      // baja a 1 si aún hay lag
// ───────────────────────────────────────────────────────────────────────

const PALETA = {
  PANOPTICO:  {grid:0x3a5c46, accent:0x55ffa6, dim:0x2b6b49},
  LIMINAL:    {grid:0x6b4f96, accent:0xc9a6ff, dim:0x6b4f96},
  CORRIENTE:  {grid:0x2b6b7a, accent:0x5fe0e8, dim:0x256b74},
  ORBITAL:    {grid:0x7a5c1e, accent:0xffc65f, dim:0x8a6520},
  POLIFONICO: {grid:0x8a3a6b, accent:0xff7ad1, dim:0x8a3a6b},
};
const POR_DEFECTO = 'PANOPTICO';
// Ámbar de los satélites secundarios: fijo, NO cambia con la paleta, para
// que se lean siempre como "los otros" (referencia satellitemap.space).
const AMBAR = '#ff9b3d';
const MAR = '#0b1f33';

let estadoActual = POR_DEFECTO, paisIdx = -1, paisNombre = null;
let satelites = [], protagonista = null;
let hayTextura = false;

const el = id => document.getElementById(id);
const hex = n => '#' + n.toString(16).padStart(6,'0');
const paleta = () => PALETA[estadoActual] ?? PALETA[POR_DEFECTO];

// ══════════════════════════════════════════════════════════════════════
//  GLOBOS
// ══════════════════════════════════════════════════════════════════════
function crearGlobo(contenedor, opts = {}) {
  const g = Globe()(contenedor)
    .backgroundColor('rgba(0,0,0,0)')
    .showAtmosphere(true).atmosphereColor('#5a9bd4').atmosphereAltitude(0.14)
    .showGraticules(opts.graticulas ?? false)
    // Apaga el raycaster de hover: con miles de objetos, globe.gl lanza un
    // rayo contra la escena en CADA cuadro solo para saber si el mouse está
    // encima de algo. Aquí nadie va a pasar el mouse: es puro costo.
    .enablePointerInteraction(false);
  try { g.globeMaterial().color.set(MAR); } catch {}
  try { g.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_MAX)); } catch {}
  return g;
}
const globo = crearGlobo(el('globo'), {graticulas:true});
const globoZoom = crearGlobo(el('globoZoom'));

function ajustar(){
  const c = el('globo').getBoundingClientRect();
  globo.width(c.width).height(c.height);
  const z = el('globoZoom').getBoundingClientRect();
  globoZoom.width(z.width).height(z.height);
}
addEventListener('resize', ajustar); setTimeout(ajustar, 60);

// ── Textura satelital (modo 'satelite') ───────────────────────────────
// Se prueba a cargar la imagen ANTES de pedírsela a globe.gl. Si no está
// (no la descargaste, o falla el disco), caemos al modo 'mapa' sin que la
// escena se quede negra en plena performance.
function iluminarTextura(g){
  // La esfera con textura se ilumina con una luz direccional: la mitad de
  // atrás queda negra. En escena eso es un agujero. Se usa la MISMA textura
  // como mapa de emisión para que se autoilumine de forma pareja.
  let intentos = 0;
  const t = setInterval(() => {
    let mat; try { mat = g.globeMaterial(); } catch { return; }
    if (mat && mat.map) {
      try {
        mat.color.set('#ffffff');
        mat.emissiveMap = mat.map;
        mat.emissive.set('#ffffff');
        mat.emissiveIntensity = 0.55;   // sube a 0.75 si tu proyector es flojo
        mat.bumpScale = 6;
        mat.needsUpdate = true;
      } catch {}
      clearInterval(t);
    }
    if (++intentos > 60) clearInterval(t);
  }, 250);
}

function aplicarTextura(){
  return new Promise((res) => {
    const img = new Image();
    img.onload  = () => {
      for (const g of [globo, globoZoom]) {
        g.globeImageUrl(TEXTURA);
        if (RELIEVE) g.bumpImageUrl(RELIEVE);
        iluminarTextura(g);
      }
      res(true);
    };
    img.onerror = () => res(false);
    img.src = TEXTURA;
  });
}

// ══════════════════════════════════════════════════════════════════════
//  PAÍSES
//  Se carga el 110m (el MISMO archivo que usa servidor_visual.js). El 50m
//  pesaba 3 MB y, peor, sus índices NO coincidían con los que manda el
//  servidor: el país resaltado podía ser otro. Con la textura satelital
//  encima, las islas chicas se ven igual aunque el contorno no las tenga.
// ══════════════════════════════════════════════════════════════════════
let paises = [];
fetch('data/ne_110m_admin_0_countries.geojson').then(r=>r.json()).then(geo=>{
  paises = geo.features; pintarPoligonos();
}).catch(e=>console.error('GeoJSON:', e));

// Coloreado por bioma (solo modo 'mapa'): costa-desierto beige, sierra
// marrón, selva verde, hielo blanco-celeste. Heurística por latitud +
// región de Natural Earth. Barata: se calcula una vez por país.
const BIOMA = {
  hielo:'#cfe4ee', desierto:'#c9ab6e', selva:'#3f6b3a',
  sierra:'#7a6039', templado:'#5d6b46', estepa:'#8d8a5a',
};
function colorTierra(f){
  const p = f.properties || {};
  const lat = Math.abs(((f.__lat ??= centroideLat(f))) || 0);
  const sub = String(p.SUBREGION || p.REGION_UN || '');
  if (lat > 62) return BIOMA.hielo;
  if (/Northern Africa|Western Asia|Central Asia/.test(sub)) return BIOMA.desierto;
  if (lat < 12 && /America|Africa|Asia/.test(sub)) return BIOMA.selva;
  if (/South America/.test(sub) && lat < 30) return BIOMA.sierra;
  if (lat > 45) return BIOMA.estepa;
  return BIOMA.templado;
}
function centroideLat(f){
  try {
    const c = f.geometry.coordinates.flat(3);
    let s = 0, n = 0;
    for (let i = 1; i < c.length; i += 2) { s += c[i]; n++; }
    return n ? s / n : 0;
  } catch { return 0; }
}

// firma = huella del estado visual. Solo repinta si CAMBIÓ algo. Antes se
// reconstruían 250 polígonos extruidos en cada tic de satélite: eso, dos
// veces por segundo, es un buen pedazo del lag.
let firmaPoligonos = '';
function pintarPoligonos(){
  if (!paises.length) return;
  const p = paleta();
  const firma = `${estadoActual}|${paisIdx}|${paisNombre}|${hayTextura}`;
  if (firma === firmaPoligonos) return;
  firmaPoligonos = firma;

  const esResaltado = (f, i) =>
    (paisNombre && f.properties && f.properties.ADMIN === paisNombre) || i === paisIdx;

  const datos = MOSTRAR_BORDES ? paises : paises.filter(esResaltado);

  globo.polygonsData(datos)
    .polygonCapColor((f,i)=> {
      if (esResaltado(f, i)) return hex(p.accent) + (hayTextura ? '55' : '99');
      return hayTextura ? 'rgba(0,0,0,0)' : colorTierra(f);
    })
    .polygonSideColor(()=> 'rgba(0,0,0,0.12)')
    .polygonStrokeColor((f,i)=> esResaltado(f,i) ? hex(p.accent) : hex(p.grid))
    .polygonAltitude((f,i)=> esResaltado(f,i) ? 0.014 : 0.003);

  // El globo pequeño ("plano satélite") solo dibuja el país sobrevolado:
  // no necesita el planeta entero y así deja de costar.
  globoZoom.polygonsData(paises.filter(esResaltado))
    .polygonCapColor(()=> hex(p.accent) + (hayTextura ? '44' : '88'))
    .polygonSideColor(()=> 'rgba(0,0,0,0.12)')
    .polygonStrokeColor(()=> hex(p.accent))
    .polygonAltitude(()=> 0.014);
}

// ══════════════════════════════════════════════════════════════════════
//  SATÉLITES — capa de PARTÍCULAS (puntos flotantes, no cilindros)
// ══════════════════════════════════════════════════════════════════════
// `particlesData` recibe una LISTA DE CONJUNTOS. Cada conjunto se dibuja
// como un único THREE.Points: un draw call para miles de satélites.
// Marcamos cada conjunto con `__prota` para poder darle color y tamaño
// distintos sin recorrer partícula por partícula.
function pintarSatelites(){
  const p = paleta();

  const otros = satelites.filter(s => !s.esProtagonista);
  otros.__prota = false;

  const prota = protagonista
    ? [{lat:protagonista.lat, lon:protagonista.lon, altKm:protagonista.altKm}]
    : [];
  prota.__prota = true;

  globo.particlesData([otros, prota])
    .particleLat('lat').particleLng('lon')
    .particleAltitude(d => Math.min(0.45, (d.altKm ?? 500) / 12000))
    // sizeAttenuation(false) = el tamaño se mide en PÍXELES y no encoge con
    // la distancia. Es lo que hace que se lean como puntos de radar y no
    // como bolitas 3D. Si los ves muy chicos, sube TAM_SATELITE.
    .particlesSizeAttenuation(false)
    .particlesSize(set => set.__prota ? TAM_PROTA : TAM_SATELITE)
    .particlesColor(set => set.__prota ? hex(p.accent) : AMBAR);

  // El globo pequeño NO recibe la nube: solo el protagonista. Era el otro
  // 50% del lag (todo se dibujaba dos veces).
  const protaZoom = prota.slice(); protaZoom.__prota = true;
  globoZoom.particlesData([protaZoom])
    .particleLat('lat').particleLng('lon')
    .particleAltitude(d => Math.min(0.45, (d.altKm ?? 500) / 12000))
    .particlesSizeAttenuation(false)
    .particlesSize(() => TAM_PROTA)
    .particlesColor(() => hex(p.accent));

  // ── EL RADAR ──
  // ringAltitude por ENCIMA de la capa de países (0.014) y de la esfera.
  // Ahí estaba el bug: el anillo se dibujaba por debajo y parecía salir
  // "del otro lado" del globo.
  const anillo = protagonista ? [{lat:protagonista.lat, lng:protagonista.lon}] : [];
  for (const g of [globo, globoZoom]) {
    g.ringsData(anillo).ringLat('lat').ringLng('lng')
     .ringAltitude(0.022)
     .ringColor(()=> hex(p.accent))
     .ringMaxRadius(g === globo ? 4 : 9)
     .ringPropagationSpeed(2).ringRepeatPeriod(1400)
     .ringResolution(72);
  }
}

// ══════════════════════════════════════════════════════════════════════
//  CÁMARA: retorno lento tras tocar el globo
// ══════════════════════════════════════════════════════════════════════
let ultimaInteraccion = 0;
const ESPERA_RETORNO = 2500, DURACION_RETORNO = 4000;
for (const ev of ['mousedown','wheel','touchstart','touchmove'])
  el('globo').addEventListener(ev, ()=>{ ultimaInteraccion = Date.now(); }, {passive:true});

function centrar(lat, lon){
  const hacer = () => globo.pointOfView({lat, lng:lon, altitude:1.9}, DURACION_RETORNO);
  const falta = ESPERA_RETORNO - (Date.now() - ultimaInteraccion);
  falta > 0 ? setTimeout(hacer, falta) : hacer();
  globoZoom.pointOfView({lat, lng:lon, altitude:0.55}, 2500);
}

// ══════════════════════════════════════════════════════════════════════
//  ESTADO DEL AGENTE
// ══════════════════════════════════════════════════════════════════════
function aplicarEstado(estado){
  if(!estado) return;
  estadoActual = PALETA[estado] ? estado : POR_DEFECTO;
  document.documentElement.setAttribute('data-estado', estadoActual);
  el('tEstado').textContent = estado;
  pintarPoligonos(); pintarSatelites();
}

// ══════════════════════════════════════════════════════════════════════
//  TEXTO DEL PROMPT-MANIFIESTO
//  Rótulo SOLO en 'orbital' y en el PRIMER 'prompt' de cada agente.
//  'memoria' y 'narracion' entran sin título: se distinguen por tipografía.
// ══════════════════════════════════════════════════════════════════════
const VEL = 22;                        // ms por carácter
let escribiendo = null, terminarAnterior = null;
let promptYaRotulado = false;

const ROTULO = {
  orbital: 'DATO ORBITAL',
  prompt:  'PROMPT · PROTOUSUARIO',
  // memoria y narracion: SIN rótulo, a propósito.
};
// 'reflexion' es el nombre viejo de 'narracion'. Se mantiene como alias
// para que los logs y scripts antiguos no rompan la pantalla.
const normalizar = (t) => (t === 'reflexion' ? 'narracion' : t);

function nuevoSegmento(tipoCrudo, texto){
  const tipo = normalizar(tipoCrudo);
  const corrido = el('corrido');

  // Cierra de golpe el segmento anterior en vez de truncarlo a medias.
  if (terminarAnterior) { terminarAnterior(); terminarAnterior = null; }
  corrido.querySelectorAll('.seg.activo').forEach(n=>n.classList.remove('activo'));

  const div = document.createElement('div');
  div.className = 'seg activo'; div.dataset.tipo = tipo;

  let rotulo = ROTULO[tipo] ?? '';
  if (tipo === 'prompt') {
    rotulo = promptYaRotulado ? '' : ROTULO.prompt;
    promptYaRotulado = true;      // los actos siguientes del agente van sin título
  }
  div.innerHTML =
    (rotulo ? `<span class="rotulo">${rotulo}</span>` : '') +
    `<span class="cuerpo cursor"></span>`;
  corrido.appendChild(div);
  const cuerpo = div.querySelector('.cuerpo');

  clearInterval(escribiendo);
  let i = 0;
  const cerrar = () => {
    clearInterval(escribiendo);
    cuerpo.textContent = texto;
    cuerpo.classList.remove('cursor');
  };
  terminarAnterior = cerrar;
  escribiendo = setInterval(()=>{
    cuerpo.textContent = texto.slice(0, ++i);
    corrido.scrollTop = corrido.scrollHeight;
    if(i >= texto.length){ cerrar(); terminarAnterior = null; }
  }, VEL);
}

function limpiarPantalla(){
  el('corrido').innerHTML = '';
  promptYaRotulado = false;
}

// ══════════════════════════════════════════════════════════════════════
//  TERRITORIO
// ══════════════════════════════════════════════════════════════════════
function mostrarTerritorio(d){
  el('bTipo').textContent = d.tipo === 'oceano' ? 'CUERPO DE AGUA' : 'TERRITORIO';
  el('bNombre').textContent = d.nombre ?? '—';
  el('bDetalle').textContent = [d.distrito, d.ciudad].filter(Boolean).join(' · ');
  const r = el('bRegion');
  if(d.region && d.region_real){ r.textContent = '▸ ' + d.region; r.classList.add('visible'); }
  else r.classList.remove('visible');
  el('bannerTerritorio').classList.add('visible');
  paisNombre = d.nombre ?? null;
  if(typeof d.paisIdx === 'number') paisIdx = d.paisIdx;
  pintarPoligonos();
}

function actualizarPosiciones(d){
  satelites = (d.todos||[]).map(s=>({...s, esProtagonista: d.protagonista && s.nombre===d.protagonista.nombre}));
  protagonista = d.protagonista || null;
  pintarSatelites();
  if(protagonista){
    el('tSatelite').textContent = protagonista.nombre;
    el('tCoords').textContent = `${protagonista.lat.toFixed(2)}, ${protagonista.lon.toFixed(2)}`;
    el('tAlt').textContent = protagonista.altKm != null ? protagonista.altKm.toFixed(0) : '—';
    el('tElev').textContent = protagonista.elevacionDeg != null ? protagonista.elevacionDeg.toFixed(1) : '—';
    centrar(protagonista.lat, protagonista.lon);
  }
}

function actualizarRumbo(d){
  const rosa = el('rosaVientos'); if(!rosa) return;
  rosa.dataset.estado = d.estado || 'DESPLAZADO';
  if(typeof d.azimut === 'number') el('rosaAguja').style.transform = `rotate(${d.azimut}deg)`;
  const mapa = {N:'norte', E:'este', S:'sur', O:'oeste'};
  for(const L of ['N','E','S','O']){
    const n = el('rosa'+L); if(!n) continue;
    const activo = (d.cardinal||'').includes(mapa[L]);
    n.classList.toggle('activo', activo);
    n.classList.toggle('parpadea', activo && d.estado==='AUTORIZADO');
  }
  el('rosaEstado').textContent = d.estado==='AUTORIZADO' ? '★ AUTORIZADO' : '✖ DESPLAZADO';
}

function actualizarSalud(modo){
  el('textoSalud').textContent = modo;
  el('puntoSalud').classList.toggle('degradado', modo !== 'ONLINE_COMPLETO');
}

// ══════════════════════════════════════════════════════════════════════
//  WEBSOCKET
// ══════════════════════════════════════════════════════════════════════
function conectar(){
  const ws = new WebSocket(`ws://${location.host}`);
  ws.onmessage = e => {
    let m; try{ m = JSON.parse(e.data); }catch{ return; }
    const d = m.datos;
    if(m.tipo==='posiciones')   actualizarPosiciones(d);
    if(m.tipo==='territorio')   mostrarTerritorio(d);
    if(m.tipo==='afecto')       aplicarEstado(d.estado);
    if(m.tipo==='salud')        actualizarSalud(d.modo);
    if(m.tipo==='rumbo')        actualizarRumbo(d);
    if(m.tipo==='segmento')     nuevoSegmento(d.tipo, d.texto);
    if(m.tipo==='preludio'){
      limpiarPantalla();
      el('cabAgente').textContent='PRELUDIO';
      nuevoSegmento('narracion', d.texto||'');
    }
    if(m.tipo==='agente_id'){
      limpiarPantalla();                       // cada agente entra con pantalla limpia
      el('cabAgente').textContent=d.nombre||'';
      nuevoSegmento('narracion', d.texto||'');
    }
    if(m.tipo==='control_estado'){
      if(d.agente) el('cabAgente').textContent = d.agente;
      if(d.estado_marca){
        el('cabMarca').textContent = d.estado_marca;
        el('cabMarca').className = 'marca ' + (d.estado_marca.includes('AUTORIZADO')?'':'desplazado');
      }
    }
  };
  ws.onclose = () => { actualizarSalud('DEGRADADO'); setTimeout(conectar, 2000); };
}

// ── ARRANQUE ──
(async () => {
  if (MODO_GLOBO === 'satelite') hayTextura = await aplicarTextura();
  if (!hayTextura) console.warn('[escena] sin textura satelital: modo mapa por biomas');
  firmaPoligonos = ''; pintarPoligonos();
  conectar();
})();
