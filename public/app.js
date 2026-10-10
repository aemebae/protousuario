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
// 3.4 px. Con la textura NASA puesta el planeta es MUCHO más claro que el
// modo mapa oscuro de antes, así que los puntos ámbar necesitan más cuerpo
// para leerse. Si los quieres finos otra vez, baja a 2.2.
let TAM_SATELITE     = 3.4;        // px del punto de los satélites de fondo
// ABRAZO: cuánto se pega la nube al planeta. 1 = la altura de siempre;
// 0.4 = todos los satélites bajan a ras del suelo y lo envuelven como una
// piel. ALTURA_MAX es el techo (los geoestacionarios, a 36.000 km, quedan
// ahí). Las tres cosas se ajustan desde el servidor, sin tocar este archivo:
//   $env:TAM_SATELITE=2.6 ; $env:ABRAZO=0.5 ; node scripts\servidor_visual.js
let ABRAZO           = 1;
let ALTURA_MAX       = 0.45;
// Cuántos satélites dibuja el navegador. La capa de partículas los pinta
// TODOS en una sola llamada de dibujo, así que 1000 cuesta prácticamente lo
// mismo que 200: el límite real es cuántos manda el servidor (MAX_SATELITES).
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
let satelites = [], protagonista = null, protagonistaB = null;
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
  // LUZ. Por defecto hay una luz direccional: la mitad de atrás del globo
  // queda negra. En la captura que mandaste se ve exactamente eso — el
  // planeta casi apagado, con tierra visible solo en el borde. Se sube la luz
  // ambiental (la que ilumina por igual desde todos lados) y se baja la
  // direccional, para que el planeta se lea entero desde cualquier ángulo.
  try {
    const luces = g.lights();
    for (const l of luces) {
      if (l.type === 'AmbientLight') l.intensity = 2.4;
      else l.intensity = 0.55;
    }
    g.lights(luces);
  } catch {}
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

// PLANO SATÉLITE: sin esto, el globo pequeño arranca a la altura por defecto
// (muy lejos) y se ve como una bolita azul borrosa hasta que llega el primer
// dato del orquestador. Se le da un encuadre desde el arranque.
setTimeout(() => {
  globoZoom.pointOfView({ lat: -12.05, lng: -77.04, altitude: 0.55 }, 0);
}, 400);

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
//  PAÍSES  ·  v5: se vuelve al 50m
//
//  POR QUÉ. El 110m solo trae 177 países y SE COME LOS CHICOS: no tiene
//  Cabo Verde, ni Malta, ni Maldivas, ni Seychelles, ni Comoras. El 50m trae
//  242 e incluye además Rapa Nui dentro de la geometría de Chile.
//  Pesa 3 MB en vez de 838 KB, pero se carga una sola vez al abrir la escena
//  y no vuelve a tocarse: no afecta a los fotogramas.
//
//  EL RIESGO QUE TENÍA ANTES: los índices del 50m no coinciden con los que
//  calcula el servidor (que usa 110m). Por eso ahora el país resaltado se
//  busca SOLO POR NOMBRE (propiedad ADMIN) y el índice se ignora.
// ══════════════════════════════════════════════════════════════════════
let paises = [];
fetch('data/ne_50m_admin_0_countries.geojson').then(r=>r.json()).then(geo=>{
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
let firmaPoligonosGrande = '';
let firmaPoligonos = '';
function pintarPoligonos(){
  if (!paises.length) return;
  const p = paleta();
  // La firma incluye la celda de 5° donde está el protagonista: el plano
  // detalle se rehace cuando el satélite se mueve lo suficiente, no en cada tic.
  const celda = protagonista
    ? `${Math.round(protagonista.lat / 5)}:${Math.round(protagonista.lon / 5)}` : '-';
  // v16: DOS firmas. El globo GRANDE (242 países) solo se rehace cuando cambia
  // el país resaltado, el estado o la textura. Antes también se rehacía cada
  // vez que el satélite cambiaba de celda (~cada minuto): un tirón de cientos
  // de milisegundos en tu laptop que, con el texto viejo, atrasaba la escritura.
  // El plano detalle (unos 30 países) sí sigue al satélite celda a celda.
  const firmaGrande = `${estadoActual}|${paisIdx}|${paisNombre}|${hayTextura}`;
  const firma = `${firmaGrande}|${celda}`;
  if (firma === firmaPoligonos) return;
  const rehacerGrande = firmaGrande !== firmaPoligonosGrande;
  firmaPoligonos = firma;
  firmaPoligonosGrande = firmaGrande;

  // ── AQUÍ ESTABA EL FALLO DEL PLANO DETALLE ──
  // El servidor manda el país EN ESPAÑOL ("Brasil", "Sudán del Sur": sale del
  // campo NAME_ES del mapa). Este código lo comparaba con ADMIN, que está EN
  // INGLÉS ("Brazil", "South Sudan"). Nunca coincidían: desde que pasamos al
  // mapa de 50m, el país sobrevolado no se resaltó NI UNA VEZ, en ninguno de
  // los dos globos. Por eso el plano detalle mostraba el punto y el radar,
  // pero no el terreno. Ahora se compara con los tres nombres posibles.
  const normal = (x) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const buscado = normal(paisNombre);
  const esResaltado = (f) => {
    if (!buscado || !f.properties) return false;
    const pr = f.properties;
    return normal(pr.NAME_ES) === buscado || normal(pr.ADMIN) === buscado
        || normal(pr.NAME_EN) === buscado || normal(pr.NAME) === buscado;
  };

  const datos = MOSTRAR_BORDES ? paises : paises.filter(esResaltado);

  if (rehacerGrande)   globo.polygonsData(datos)
      // ── EL ARREGLO DE GROENLANDIA ──
      // Un polígono es un contorno plano (lat/lon) que hay que "pegar" sobre una
      // esfera. Para eso se parte en triángulos. Si los triángulos son grandes,
      // sus caras rectas se hunden POR DEBAJO de la superficie curva y la esfera
      // se los come: eso son las astillas negras y los agujeros que viste, y por
      // eso pasaba justo en Groenlandia, que es enorme y tiene pocos vértices.
      // Esta línea obliga a subdividir cada 1,5° en vez de cada 5°: más
      // triángulos, más pequeños, y la tapa abraza la curva sin hundirse.
      .polygonCapCurvatureResolution(1.5)
      .polygonCapColor((f)=> {
        if (esResaltado(f)) return hex(p.accent) + (hayTextura ? '55' : '99');
        return hayTextura ? 'rgba(0,0,0,0)' : colorTierra(f);
      })
      .polygonSideColor(()=> 'rgba(0,0,0,0.12)')
      .polygonStrokeColor((f)=> esResaltado(f) ? hex(p.accent) : hex(p.grid))
      // Un pelo más alto que antes: aleja la tapa de la esfera y elimina el
      // parpadeo entre las dos superficies (lo que se llama "z-fighting").
      .polygonAltitude((f)=> esResaltado(f) ? 0.016 : 0.005);

  // ── PLANO DETALLE: el terreno SIEMPRE ──
  // Antes el globo pequeño solo dibujaba el país resaltado. Cuando el satélite
  // pasaba sobre el océano (Océano Austral, en tu log) o el nombre no casaba,
  // no quedaba NADA dibujado: solo el punto y el radar sobre agua lisa.
  // Ahora dibuja las fronteras de todos los países a menos de 40° del satélite
  // —el vecindario que la cámara ve— con el sobrevolado relleno encima.
  // Siguen siendo pocos polígonos: no pesa como el planeta entero.
  const cerca = (f) => {
    if (!protagonista) return esResaltado(f);
    f.__c ??= centroideAprox(f);
    const dLat = f.__c.lat - protagonista.lat;
    let dLon = Math.abs(f.__c.lon - protagonista.lon); if (dLon > 180) dLon = 360 - dLon;
    return esResaltado(f) || Math.hypot(dLat, dLon * Math.cos(protagonista.lat * Math.PI / 180)) < 40;
  };
  globoZoom.polygonsData(paises.filter(cerca))
    .polygonCapCurvatureResolution(1.5)
    .polygonCapColor((f)=> esResaltado(f) ? hex(p.accent) + (hayTextura ? '55' : '99')
                                          : (hayTextura ? 'rgba(0,0,0,0)' : colorTierra(f)))
    .polygonSideColor(()=> 'rgba(0,0,0,0.10)')
    .polygonStrokeColor((f)=> esResaltado(f) ? hex(p.accent) : hex(p.grid))
    .polygonAltitude((f)=> esResaltado(f) ? 0.016 : 0.004);
}

/** Centro aproximado de un país: promedio de los vértices de su contorno. */
function centroideAprox(f){
  try {
    const c = f.geometry.coordinates.flat(3);
    let la = 0, lo = 0, n = 0;
    for (let i = 0; i + 1 < c.length; i += 2) { lo += c[i]; la += c[i + 1]; n++; }
    return n ? { lat: la / n, lon: lo / n } : { lat: 0, lon: 0 };
  } catch { return { lat: 0, lon: 0 }; }
}

// ══════════════════════════════════════════════════════════════════════
//  SATÉLITES — capa de PARTÍCULAS (puntos flotantes, no cilindros)
// ══════════════════════════════════════════════════════════════════════
// `particlesData` recibe una LISTA DE CONJUNTOS. Cada conjunto se dibuja
// como un único THREE.Points: un draw call para miles de satélites.
// Marcamos cada conjunto con `__prota` para poder darle color y tamaño
// distintos sin recorrer partícula por partícula.
// ── Capas de puntos y radar: se CONFIGURAN una vez; cada tic solo se mueven ──
// v16: antes, en cada tic (0,9 s) se volvían a armar los anillos del radar
// desde cero. Un pulso tarda 1,4 s en expandirse: el radar se reiniciaba
// antes de completar uno solo, y a veces casi no se veía. Ahora los anillos
// son SIEMPRE los mismos objetos: solo cambian de lugar, y el pulso sigue.
const altSat = (d) => Math.min(ALTURA_MAX, (d.altKm ?? 500) / 12000 * ABRAZO);
const anilloA = { lat: 0, lng: 0 }, anilloB = { lat: 0, lng: 0 };
let capasListas = false;
function configurarCapas(){
  globo.particleLat('lat').particleLng('lon').particleAltitude(altSat)
    // sizeAttenuation(false) = el tamaño se mide en PÍXELES y no encoge con
    // la distancia: se leen como puntos de radar, no como bolitas 3D.
    .particlesSizeAttenuation(false)
    .particlesSize(set => set.__prota ? TAM_PROTA : set.__protaB ? TAM_PROTA * 0.8 : TAM_SATELITE)
    .particlesColor(set => (set.__prota || set.__protaB) ? hex(paleta().accent) : AMBAR);
  globoZoom.particleLat('lat').particleLng('lon').particleAltitude(altSat)
    .particlesSizeAttenuation(false).particlesSize(() => TAM_PROTA)
    .particlesColor(() => hex(paleta().accent));
  // ringAltitude por ENCIMA de la capa de países (0.014) y de la esfera.
  for (const g of [globo, globoZoom]) {
    g.ringLat('lat').ringLng('lng').ringAltitude(0.022)
     .ringColor(() => hex(paleta().accent))
     .ringMaxRadius(g === globo ? 4 : 9)
     .ringPropagationSpeed(2).ringRepeatPeriod(1400)
     .ringResolution(72);
  }
  capasListas = true;
}

function pintarSatelites(){
  if (!capasListas) configurarCapas();
  const otros = satelites.filter(s => !s.esProtagonista);
  const prota = protagonista ? [{lat:protagonista.lat, lon:protagonista.lon, altKm:protagonista.altKm}] : [];
  prota.__prota = true;
  // El satélite del SEGUNDO territorio: mismo color, un poco más chico.
  // Dos ojos a la vez, uno sobre cada territorio que nombra el agente.
  const protaB = protagonistaB ? [{lat:protagonistaB.lat, lon:protagonistaB.lon, altKm:protagonistaB.altKm}] : [];
  protaB.__protaB = true;
  globo.particlesData([otros, prota, protaB]);
  // El globo pequeño NO recibe la nube: solo el protagonista.
  const protaZoom = prota.slice(); protaZoom.__prota = true;
  globoZoom.particlesData([protaZoom]);

  // ── EL RADAR: los mismos anillos, movidos de lugar ──
  if (protagonista) { anilloA.lat = protagonista.lat; anilloA.lng = protagonista.lon; }
  if (protagonistaB) { anilloB.lat = protagonistaB.lat; anilloB.lng = protagonistaB.lon; }
  // Misma lista de objetos en cada tic: three-globe solo actualiza su posición.
  const uno = protagonista ? [anilloA] : [];
  globo.ringsData(protagonistaB ? [...uno, anilloB] : uno);
  globoZoom.ringsData(uno);
}

// ══════════════════════════════════════════════════════════════════════
//  CÁMARA: retorno lento tras tocar el globo
// ══════════════════════════════════════════════════════════════════════
// v4.1 — TRES ARREGLOS AL REGRESO BRUSCO:
//  1. Espera 8 s desde tu última interacción (antes 2,5 s: te arrebataba el
//     globo mientras aún lo estabas mirando).
//  2. El viaje dura 9 s con curva suave (antes 4 s: era un tirón).
//  3. Solo re-centra si el objetivo se movió de verdad (>4°). Antes lo hacía
//     en CADA actualización, así que el tween se reiniciaba a medio camino y
//     eso es lo que se sentía como salto.
let ultimaInteraccion = 0, pendiente = null, ultimoCentro = null;
const ESPERA_RETORNO = 8000, DURACION_RETORNO = 9000, UMBRAL_GRADOS = 4;
for (const ev of ['mousedown','wheel','touchstart','touchmove','pointerdown'])
  el('globo').addEventListener(ev, ()=>{ ultimaInteraccion = Date.now(); }, {passive:true});

function lejos(lat, lon){
  if (!ultimoCentro) return true;
  const dLat = Math.abs(lat - ultimoCentro.lat);
  let dLon = Math.abs(lon - ultimoCentro.lon); if (dLon > 180) dLon = 360 - dLon;
  return Math.hypot(dLat, dLon) > UMBRAL_GRADOS;
}

function centrar(lat, lon, forzar = false){
  // El plano detalle sí sigue siempre al satélite: es su trabajo.
  globoZoom.pointOfView({lat, lng:lon, altitude:0.55}, 3500);
  if (!forzar && !lejos(lat, lon)) return;
  clearTimeout(pendiente);
  const hacer = () => {
    // Si volviste a tocar el globo mientras esperaba, se reprograma en vez
    // de robarte la vista de golpe.
    if (Date.now() - ultimaInteraccion < ESPERA_RETORNO) {
      pendiente = setTimeout(hacer, 1500); return;
    }
    ultimoCentro = {lat, lon};
    globo.pointOfView({lat, lng:lon, altitude:1.9}, DURACION_RETORNO);
  };
  const falta = ESPERA_RETORNO - (Date.now() - ultimaInteraccion);
  pendiente = setTimeout(hacer, Math.max(0, falta));
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

// ═══ PAUSA REAL: congela en la LETRA, no al final del párrafo ═══
// Antes, PAUSA solo tenía efecto entre bloques, porque el orquestador estaba
// esperando un comando. El texto, en cambio, se escribe AQUÍ, en el navegador.
// Ahora la máquina de escribir consulta `pausado` en cada tic: si está activa,
// el tic no avanza ni un carácter y no pierde el sitio. Al reanudar, sigue
// exactamente donde se quedó, aunque sea a mitad de una palabra.
let pausado = false;
let segActivo = null;   // { div, cuerpo, texto, i }
let promptYaRotulado = false;

// ═══════════════════════════════════════════════════════════════════════
//  LA VOZ
//  El audio suena AQUÍ, en el navegador de la escena compuesta, no en Node.
//  Motivo: Node no reproduce sonido sin librerías nativas; el navegador sí,
//  con dos líneas. La salida de audio de la laptop va al equipo de sala.
//
//  SINCRONÍA: cuando el mp3 informa cuánto dura, esa duración se reparte entre
//  las letras del texto. Así la última letra cae justo cuando la voz termina
//  la frase. Sin audio, se usa la velocidad fija de siempre.
// ═══════════════════════════════════════════════════════════════════════
let vozActual = null;
let audioDesbloqueado = false;
// Velocidad de la voz, controlada desde el celular. playbackRate cambia el
// ritmo AL VUELO, sin regrabar nada y sin gastar créditos de ElevenLabs.
// El navegador conserva el tono por defecto, así que no suena a ardilla.
let velocidadVoz = 1;

// Los navegadores no dejan sonar audio hasta que alguien toca la página una
// vez. Se desbloquea con el primer clic o tecla.
function desbloquearAudio(){
  if (audioDesbloqueado) return;
  audioDesbloqueado = true;
  el('avisoAudio')?.remove();
}
for (const ev of ['click','keydown','touchstart'])
  addEventListener(ev, desbloquearAudio, { passive:true });

function mostrarAvisoAudio(){
  if (el('avisoAudio')) return;
  const d = document.createElement('div');
  d.id = 'avisoAudio';
  d.textContent = 'TOCA LA PANTALLA PARA ACTIVAR EL AUDIO';
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:24px;text-align:center;'
    + 'z-index:200;font:11px/1 ui-monospace,monospace;letter-spacing:.3em;color:#ffc65f;';
  document.body.appendChild(d);
}

// Reproduce un sonido TUYO de "sonidos externos" (no pasa por ElevenLabs).
function sonarExterno(archivo){
  if (vozActual) { try { vozActual.pause(); } catch {} vozActual = null; }
  if (!archivo) return null;
  const a = new Audio('/sonido/' + encodeURIComponent(archivo));
  a.preload = 'auto';
  a.defaultPlaybackRate = 1;
  a.playbackRate = 1;            // tus sonidos NO cambian con la velocidad de voz
  a.__externo = true;            // ← para que el botón de velocidad no los toque
  vozActual = a;
  a.play().catch((e) => {
    a.__fallo = true;
    if (!audioDesbloqueado) mostrarAvisoAudio();
    console.warn('[sonido]', e.message);
  });
  a.addEventListener('error', () => { a.__fallo = true; });
  return a;
}

function sonar(archivo){
  if (vozActual) { try { vozActual.pause(); } catch {} vozActual = null; }
  if (!archivo) return null;
  const a = new Audio('/audio/' + archivo);
  a.preload = 'auto';
  // defaultPlaybackRate además de playbackRate: si el navegador recarga el
  // audio, vuelve a la velocidad por defecto. Así la velocidad no se pierde.
  a.defaultPlaybackRate = velocidadVoz;
  a.playbackRate = velocidadVoz;
  vozActual = a;
  a.play().catch((e) => {
    a.__fallo = true;
    if (!audioDesbloqueado) mostrarAvisoAudio();
    console.warn('[voz] no se pudo reproducir:', e.message);
  });
  a.addEventListener('error', () => { a.__fallo = true; });
  return a;
}

// ═══════════════════════════════════════════════════════════════════════
//  EL TEXTO OBEDECE AL RELOJ DE LA VOZ  (v16, 10-10)
//
//  ANTES: al empezar cada bloque se calculaba "X milisegundos por letra" y un
//  temporizador escribía una letra cada X ms. Ese temporizador NO miraba la
//  voz. Si el navegador se cargaba (el globo, la nube de satélites, el clon
//  animándose a la vez), los tics se atrasaban y el texto se quedaba atrás
//  — y nunca recuperaba. Al cambiar la velocidad se recalculaba, pero sin
//  corregir lo ya atrasado. Eso era lo que veías: texto lento, desfasado.
//
//  AHORA: cada 33 ms se mira EN QUÉ SEGUNDO VA LA VOZ (audio.currentTime) y se
//  muestran exactamente las letras que corresponden a ese segundo. Si el
//  navegador se atrasa, en el tic siguiente se pone al día de un salto. La
//  velocidad, la PAUSA y REPETIR quedan sincronizadas solas, porque el audio
//  ya las aplica: el texto solo lo sigue.
//
//  Las comas y los puntos pesan más que una letra: la voz se detiene ahí, y
//  el texto también. Sin audio (no hay mp3, o el navegador no lo deja sonar),
//  se escribe con un reloj propio que respeta la velocidad y la pausa.
// ═══════════════════════════════════════════════════════════════════════
const ARRANQUE_S = 0.08;          // la voz tarda un instante en sonar
const MS_POR_LETRA = 62;          // ritmo de lectura en voz alta, sin audio (a 1×)
let canalFin = null;              // el WebSocket, para avisar "terminó la voz"

/** Peso acumulado de cada letra: la voz respira DESPUÉS de cada signo. */
function pesosDe(texto){
  const acc = new Float64Array(texto.length + 1);
  let suma = 0;
  for (let i = 0; i < texto.length; i++) {
    const antes = i ? texto[i - 1] : '';
    let w = texto[i] === ' ' ? 0.9 : 1;
    if (antes === ',') w += 3.5;
    else if ('.;:?!…'.includes(antes)) w += 6;
    else if (antes === '\n') w += 5;
    suma += w; acc[i + 1] = suma;
  }
  return acc;
}
/** Cuántas letras corresponden a una fracción (0–1) del tiempo de la voz. */
function letrasPara(acc, f){
  const n = acc.length - 1;
  if (!(f > 0)) return 0;
  if (f >= 1) return n;
  const meta = f * acc[n];
  let lo = 0, hi = n;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (acc[m] <= meta) lo = m; else hi = m - 1; }
  return lo;
}
/** Fracción de la voz ya dicha, según el reloj del propio audio. */
function fraccionDeAudio(a){
  const dur = a.duration;
  if (!isFinite(dur) || dur <= 0) return null;
  // termina un pelín antes que la voz (nunca después): ElevenLabs deja un
  // respiro de silencio al final de cada mp3.
  const fin = Math.max(ARRANQUE_S + 0.25, dur - Math.min(0.35, dur * 0.06));
  return (a.currentTime - ARRANQUE_S) / (fin - ARRANQUE_S);
}
/** Prepara el reloj de escritura de un segmento recién llegado (o repetido). */
function prepararEscritura(s, audio, durMs){
  s.audio = audio || null;
  s.pesos = pesosDe(s.texto || '');
  s.i = 0; s.completo = !(s.texto && s.texto.length);
  s.inicio = performance.now(); s.ultimoTic = s.inicio; s.relojMs = 0;
  s.durMs = durMs > 0 ? durMs : Math.max(1600, (s.texto || '').length * MS_POR_LETRA);
  s.finAvisado = false;
  if (audio) {
    // El aviso de "terminó la voz" sale del FIN REAL del audio: el orquestador
    // pasa al bloque siguiente con eso, no con una estimación.
    audio.addEventListener('ended', () => { if (segActivo === s) avisarFin(s); }, { once: true });
  }
  if (s.completo) { s.cuerpo.classList.remove('cursor'); }
}
function avisarFin(s){
  if (s.finAvisado || !s.token) return;
  s.finAvisado = true;
  try { canalFin?.readyState === 1 && canalFin.send(JSON.stringify({ tipo: 'fin_bloque', token: s.token })); } catch {}
  // Si este bloque es donde termina la música de fondo, se corta AQUÍ, en la
  // última palabra (ver FONDO más abajo).
  if (s.cortarFondo) fondoParar(40);
}
/** El tic: pone en pantalla las letras que tocan en este instante. */
function ticEscritura(){
  const s = segActivo;
  if (!s) return;
  const ahora = performance.now();
  const dt = ahora - s.ultimoTic; s.ultimoTic = ahora;
  if (s.completo) return;
  let f = null;
  const a = s.audio;
  if (a && !a.__fallo) {
    if (a.ended) f = 1;
    else {
      f = fraccionDeAudio(a);
      // ¿El audio nunca arrancó? (red, bloqueo del navegador) → reloj propio.
      if (!pausado && a.paused && a.currentTime === 0 && ahora - s.inicio > 1800) a.__fallo = true;
    }
  }
  if (!a || a.__fallo) {
    if (!pausado) s.relojMs += dt * velocidadVoz;
    f = s.relojMs / s.durMs;
  }
  if (f == null) return;                 // el audio aún no sabe cuánto dura
  const n = letrasPara(s.pesos, f);
  if (n > s.i) {                         // solo avanza: nunca borra letras
    s.i = n;
    s.cuerpo.textContent = s.texto.slice(0, n);
    const corrido = el('corrido');
    corrido.scrollTop = corrido.scrollHeight;
  }
  if (s.i >= s.texto.length) {
    s.completo = true;
    s.cuerpo.classList.remove('cursor');
    // sin audio, el fin del bloque es el fin del texto
    if (!a || a.__fallo) avisarFin(s);
  }
}
setInterval(ticEscritura, 33);

// ═══════════════════════════════════════════════════════════════════════
//  FONDO — música que suena DEBAJO de la voz  (@FONDO en el guion)
//  Es un canal aparte: la voz y tus @SONIDO siguen en el suyo, encima.
//  Suena bajo (FONDO_VOLUMEN o el % escrito en la marca) para que la voz se
//  entienda. Si la canción se acaba antes de tiempo, vuelve a empezar: nunca
//  queda en silencio antes del corte. El corte es seco (40 ms, solo para que
//  no chasquee el parlante) y cae en la última palabra del bloque marcado.
//  PAUSA la congela con todo lo demás. Al clon no le llega: su boca sigue a
//  la voz, no a la canción.
// ═══════════════════════════════════════════════════════════════════════
let fondo = null;   // { a, id, vol }
function rampaVolumen(a, hasta, ms, alTerminar){
  const desde = a.volume, pasos = Math.max(1, Math.round(ms / 10));
  let k = 0;
  const iv = setInterval(() => {
    k++;
    try { a.volume = Math.min(1, Math.max(0, desde + (hasta - desde) * (k / pasos))); } catch {}
    if (k >= pasos) { clearInterval(iv); alTerminar?.(); }
  }, 10);
}
function fondoIniciar(d){
  if (fondo && fondo.id === d.id) return;           // ya suena este mismo
  fondoParar(300);
  const a = new Audio('/sonido/' + encodeURIComponent(d.archivo));
  a.preload = 'auto';
  a.loop = d.bucle !== false;
  a.volume = 0;
  const vol = Math.min(1, Math.max(0.02, Number(d.volumen) || 0.22));
  fondo = { a, id: d.id, vol };
  const sonar = () => a.play().then(() => rampaVolumen(a, vol, 700))
    .catch((e) => { if (!audioDesbloqueado) mostrarAvisoAudio(); console.warn('[fondo]', e.message); });
  if (!pausado) sonar(); else fondo.pendiente = sonar;
}
function fondoParar(msFade = 40){
  if (!fondo) return;
  const a = fondo.a; fondo = null;
  rampaVolumen(a, 0, msFade, () => { try { a.pause(); a.removeAttribute('src'); a.load(); } catch {} });
}

/** Congela / descongela la escena entera: texto, cursor y audio. */
function aplicarPausa(activa) {
  pausado = !!activa;
  document.documentElement.setAttribute('data-pausa', pausado ? '1' : '0');
  // La voz se detiene con el mismo botón. Sin esto, el texto se congelaría
  // en la letra y la voz seguiría hablando sola.
  if (vozActual) {
    if (pausado) { try { vozActual.pause(); } catch {} }
    else { vozActual.play?.().catch(() => {}); }
  }
  document.querySelectorAll('audio, video').forEach((a) => {
    if (pausado) { try { a.pause(); } catch {} }
    else { a.play?.().catch(() => {}); }
  });
  if (fondo) {
    if (pausado) { try { fondo.a.pause(); } catch {} }
    else if (fondo.pendiente) { const f = fondo.pendiente; fondo.pendiente = null; f(); }
    else { fondo.a.play?.().catch(() => {}); }
  }
}

const ROTULO = {
  orbital: 'DATO ORBITAL',
  prompt:  'PROMPT · PROTOUSUARIO',
  // memoria, narracion y pregunta: SIN rótulo, a propósito.
};

// Estilos que llegan con v5 (pregunta y pausa). Se inyectan desde aquí para no
// tener que tocar styles.css otra vez a horas de la función.
(function estilosV5(){
  const css = document.createElement('style');
  css.textContent = `
    /* PREGUNTA — el pasaje final. Grande, centrada, sin rótulo, con aire.
       Es lo último que se escucha: tiene que leerse desde el fondo del patio. */
    .seg[data-tipo="pregunta"] .rotulo{display:none;}
    .seg[data-tipo="pregunta"]{margin:2.2em 0;}
    .seg[data-tipo="pregunta"] .cuerpo{
      display:block; text-align:center; max-width:100%;
      font-family:'Iowan Old Style','Palatino Linotype',Georgia,serif;
      font-size:clamp(20px,2.1vw,38px); line-height:1.34;
      font-style:normal; letter-spacing:.005em;
      color:var(--text); text-shadow:var(--glow);
      border:none; padding:0;
    }
    /* Tus saltos de línea se respetan (memorias y narraciones en verso). */
    .seg .cuerpo{ white-space: pre-line; }
    /* PAUSA — visible pero sin gritar. Si el sistema está detenido a propósito,
       tiene que notarse; si no, parece colgado. */
    html[data-pausa="1"] .panel-texto{opacity:.55;}
    html[data-pausa="1"] .escena::after{
      content:'⏸ PAUSA'; position:fixed; top:14px; left:50%;
      transform:translateX(-50%); z-index:99;
      font-family:var(--font-hud); font-size:11px; letter-spacing:.32em;
      color:var(--alert); border:1px solid var(--alert);
      padding:5px 14px; border-radius:3px;
      animation:latidoPausa 2.2s ease-in-out infinite;
    }
    @keyframes latidoPausa{0%,100%{opacity:.35}50%{opacity:1}}
  `;
  document.head.appendChild(css);
})();
// 'reflexion' es el nombre viejo de 'narracion'. Se mantiene como alias
// para que los logs y scripts antiguos no rompan la pantalla.
const normalizar = (t) => (t === 'reflexion' ? 'narracion' : t);

/** Compatibilidad: completar de golpe el segmento visible. */
function completarSegmento(s){
  if (!s || s.completo) return;
  s.i = s.texto.length; s.completo = true;
  s.cuerpo.textContent = s.texto;
  s.cuerpo.classList.remove('cursor');
}

function nuevoSegmento(tipoCrudo, texto, archivoVoz, sonidoExterno, extra = {}){
  const tipo = normalizar(tipoCrudo);
  const corrido = el('corrido');

  // REPETIR manda el MISMO texto. En vez de apilar otro párrafo idéntico, se
  // reinicia el que ya está en pantalla desde la primera letra. Así REPETIR
  // es "volver al inicio del párrafo", que es justo lo que hace falta cuando
  // pausaste a mitad y quieres oírlo entero otra vez.
  // ── AQUÍ ESTABA EL BUG DE LOS TRES "CUAK" ──
  // Los bloques @SONIDO no tienen texto: los tres valían ''. Como este atajo
  // comparaba SOLO el texto, el segundo y el tercero se tomaban por "el mismo
  // bloque otra vez" (que es lo que hace REPETIR) y volvían a disparar el
  // sonido del PRIMERO. De ahí que Cuak sonara tres veces.
  // Ahora se compara también el sonido, y un bloque sin texto NUNCA entra por
  // este atajo: cada @SONIDO es un bloque distinto aunque digan lo mismo.
  const mismoBloque = segActivo
    && texto && segActivo.texto === texto
    && (segActivo.sonido ?? null) === (sonidoExterno ?? null);
  if (mismoBloque) {
    segActivo.cuerpo.textContent = '';
    segActivo.cuerpo.classList.add('cursor');
    segActivo.token = extra.token ?? null;
    segActivo.cortarFondo = !!extra.cortarFondo;
    const a = segActivo.sonido ? sonarExterno(segActivo.sonido)
                               : sonar(archivoVoz ?? segActivo.voz);   // REPETIR
    prepararEscritura(segActivo, a, extra.dur);
    return;
  }

  // Cierra de golpe el segmento anterior en vez de truncarlo a medias.
  completarSegmento(segActivo);
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
  segActivo = { div, cuerpo: div.querySelector('.cuerpo'), texto: texto || '', i: 0,
                voz: archivoVoz, sonido: sonidoExterno,
                token: extra.token ?? null, cortarFondo: !!extra.cortarFondo };
  const a = sonidoExterno ? sonarExterno(sonidoExterno) : sonar(archivoVoz);
  prepararEscritura(segActivo, a, extra.dur);
}

function limpiarPantalla(){
  if (vozActual) { try { vozActual.pause(); } catch {} vozActual = null; }
  segActivo = null;
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

/** Densidad de la nube, ajustada desde el servidor ($env:TAM_SATELITE, $env:ABRAZO…). */
function aplicarConfigEscena(d){
  if (Number(d.tamSatelite) > 0) TAM_SATELITE = Number(d.tamSatelite);
  if (Number(d.abrazo) > 0) ABRAZO = Number(d.abrazo);
  if (Number(d.alturaMax) > 0) ALTURA_MAX = Number(d.alturaMax);
  pintarSatelites();
}

function actualizarPosiciones(d){
  if (Array.isArray(d.nube)) {
    // FORMATO COMPACTO (v16): [lat, lon, alt, lat, lon, alt, …]. Con miles de
    // satélites, mandar nombre y clave de cada uno pesaba 6 veces más.
    const n = d.nube, lista = new Array(Math.floor(n.length / 3));
    for (let i = 0, k = 0; k < lista.length; i += 3, k++) lista[k] = { lat: n[i], lon: n[i + 1], altKm: n[i + 2] };
    satelites = lista;
  } else {
    const nombresProta = new Set([d.protagonista?.nombre, d.protagonistaB?.nombre].filter(Boolean));
    satelites = (d.todos||[]).map(s=>({...s, esProtagonista: nombresProta.has(s.nombre)}));
  }
  protagonista = d.protagonista || null;
  protagonistaB = d.protagonistaB || null;
  pintarSatelites();
  // TICK RÁPIDO (cada ~0,9 s): solo repinta los puntos para que la nube se
  // vea moverse. No toca telemetría ni cámara: si lo hiciera, el globo estaría
  // reencuadrando cada segundo y eso es justo lo que se sentía brusco.
  if (d.tick) {
    pintarPoligonos();          // barato: solo actúa si cambió de celda de 5°
    if (protagonista) {
      el('tCoords').textContent = `${protagonista.lat.toFixed(2)}, ${protagonista.lon.toFixed(2)}`;
      globoZoom.pointOfView({lat:protagonista.lat, lng:protagonista.lon, altitude:0.55}, 900);
    }
    return;
  }
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

function actualizarSalud(modo, sats, total){
  // Se muestra el conteo real de satélites junto al estado de los datos.
  // Si dice "12 sats" en vez de "1200", el problema no es el dibujo: es que
  // el grupo satelital no se descargó y estás viendo el caché de 'stations'.
  const cuenta = (sats != null && sats > 0)
    ? `  ·  ${sats} sats${total ? ' de ' + total.toLocaleString('es-PE') : ''}`
    : '';
  el('textoSalud').textContent = modo + cuenta;
  el('puntoSalud').classList.toggle('degradado', modo !== 'ONLINE_COMPLETO');
}

// ══════════════════════════════════════════════════════════════════════
//  WEBSOCKET
// ══════════════════════════════════════════════════════════════════════
function conectar(){
  const ws = new WebSocket(`ws://${location.host}`);
  canalFin = ws;
  // Esta es la ESCENA: recibe la nube de satélites y avisa el fin de cada voz.
  ws.onopen = () => { try { ws.send(JSON.stringify({ soy: 'escena' })); } catch {} };
  ws.onmessage = e => {
    let m; try{ m = JSON.parse(e.data); }catch{ return; }
    const d = m.datos;
    if(m.tipo==='posiciones')   actualizarPosiciones(d);
    if(m.tipo==='territorio')   mostrarTerritorio(d);
    if(m.tipo==='afecto')       aplicarEstado(d.estado);
    if(m.tipo==='salud')        actualizarSalud(d.modo, d.sats, d.total);
    if(m.tipo==='rumbo')        actualizarRumbo(d);
    if(m.tipo==='segmento')     nuevoSegmento(d.tipo, d.texto, d.audio, d.sonido, d);
    if(m.tipo==='preludio'){
      limpiarPantalla();
      el('cabAgente').textContent='PRELUDIO';
      nuevoSegmento('narracion', d.texto||'', d.audio, null, d);
    }
    if(m.tipo==='agente_id'){
      limpiarPantalla();                       // cada agente entra con pantalla limpia
      el('cabAgente').textContent=d.nombre||'';
      nuevoSegmento('narracion', d.texto||'', d.audio, null, d);
    }
    if(m.tipo==='fondo'){
      if (d.accion === 'iniciar' && d.archivo) fondoIniciar(d);
      else fondoParar(d.fade ?? 40);
    }
    if(m.tipo==='config_escena') aplicarConfigEscena(d);
    if(m.tipo==='pausa') aplicarPausa(d.activa);
    if(m.tipo==='velocidad'){
      velocidadVoz = Math.min(2, Math.max(0.5, Number(d.valor) || 1));
      // Solo la VOZ cambia de velocidad; tus @SONIDO y el fondo, nunca.
      // El texto no necesita reajuste: sigue al reloj del audio.
      if (vozActual && !vozActual.__externo) {
        vozActual.defaultPlaybackRate = velocidadVoz;
        vozActual.playbackRate = velocidadVoz;
      }
    }
    if(m.tipo==='deriva' && d.activa){
      fondoParar(300);
      limpiarPantalla();
      el('cabAgente').textContent = '◈  D E R I V A';
      el('cabMarca').textContent = '';
      el('cabMarca').className = 'marca';
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
  firmaPoligonos = ''; firmaPoligonosGrande = ''; pintarPoligonos();
  conectar();
})();
