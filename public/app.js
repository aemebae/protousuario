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
const TAM_SATELITE   = 2.0;        // px del punto de los satélites de fondo
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
let firmaPoligonos = '';
function pintarPoligonos(){
  if (!paises.length) return;
  const p = paleta();
  const firma = `${estadoActual}|${paisIdx}|${paisNombre}|${hayTextura}`;
  if (firma === firmaPoligonos) return;
  firmaPoligonos = firma;

  // Solo por nombre. El índice del servidor viene del 110m y aquí usamos 50m:
  // mezclarlos resaltaba el país equivocado.
  const esResaltado = (f) =>
    !!(paisNombre && f.properties && f.properties.ADMIN === paisNombre);

  const datos = MOSTRAR_BORDES ? paises : paises.filter(esResaltado);

  globo.polygonsData(datos)
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

  // El globo pequeño ("plano satélite") solo dibuja el país sobrevolado:
  // no necesita el planeta entero y así deja de costar.
  globoZoom.polygonsData(paises.filter(esResaltado))
    .polygonCapCurvatureResolution(1.5)
    .polygonCapColor(()=> hex(p.accent) + (hayTextura ? '44' : '88'))
    .polygonSideColor(()=> 'rgba(0,0,0,0.12)')
    .polygonStrokeColor(()=> hex(p.accent))
    .polygonAltitude(()=> 0.016);
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
let escribiendo = null;
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
  a.playbackRate = 1;            // tus sonidos NO cambian con la velocidad de voz
  vozActual = a;
  a.play().catch((e) => {
    if (!audioDesbloqueado) mostrarAvisoAudio();
    console.warn('[sonido]', e.message);
  });
  return a;
}

function sonar(archivo){
  if (vozActual) { try { vozActual.pause(); } catch {} vozActual = null; }
  if (!archivo) return null;
  const a = new Audio('/audio/' + archivo);
  a.preload = 'auto';
  a.playbackRate = velocidadVoz;
  vozActual = a;
  a.play().catch((e) => {
    if (!audioDesbloqueado) mostrarAvisoAudio();
    console.warn('[voz] no se pudo reproducir:', e.message);
  });
  return a;
}

/** Reparte la duración del mp3 entre las letras del texto. */
function sincronizarConVoz(audio, texto){
  if (!audio || !texto?.length) return;
  const ajustar = () => {
    const dur = audio.duration;
    if (!isFinite(dur) || dur <= 0) return;
    // ×0.92: el texto termina un pelín antes que la voz, nunca después.
    // Se divide por la velocidad: si la voz va a 1,5×, el texto también.
    const porLetra = Math.min(90, Math.max(8,
      (dur * 1000 * 0.92) / texto.length / Math.max(0.25, velocidadVoz)));
    arrancarEscritura(porLetra);
  };
  if (audio.readyState >= 1) ajustar();
  else audio.addEventListener('loadedmetadata', ajustar, { once:true });
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

/** Arranca (o retoma) la máquina de escribir sobre el segmento activo. */
function arrancarEscritura(velocidad = VEL){
  clearInterval(escribiendo);
  const corrido = el('corrido');
  escribiendo = setInterval(()=>{
    if (pausado) return;              // ← congelado: no avanza, no pierde el sitio
    const s = segActivo; if(!s) { clearInterval(escribiendo); return; }
    s.cuerpo.textContent = s.texto.slice(0, ++s.i);
    corrido.scrollTop = corrido.scrollHeight;
    if(s.i >= s.texto.length){
      clearInterval(escribiendo);
      s.cuerpo.classList.remove('cursor');
    }
  }, velocidad);
}

function nuevoSegmento(tipoCrudo, texto, archivoVoz, sonidoExterno){
  const tipo = normalizar(tipoCrudo);
  const corrido = el('corrido');

  // REPETIR manda el MISMO texto. En vez de apilar otro párrafo idéntico, se
  // reinicia el que ya está en pantalla desde la primera letra. Así REPETIR
  // es "volver al inicio del párrafo", que es justo lo que hace falta cuando
  // pausaste a mitad y quieres oírlo entero otra vez.
  if (segActivo && segActivo.texto === texto) {
    segActivo.i = 0;
    segActivo.cuerpo.textContent = '';
    segActivo.cuerpo.classList.add('cursor');
    const a = segActivo.sonido ? sonarExterno(segActivo.sonido)
                               : sonar(archivoVoz ?? segActivo.voz);   // REPETIR
    arrancarEscritura();
    sincronizarConVoz(a, texto);
    return;
  }

  // Cierra de golpe el segmento anterior en vez de truncarlo a medias.
  if (segActivo && segActivo.i < segActivo.texto.length) {
    clearInterval(escribiendo);
    segActivo.cuerpo.textContent = segActivo.texto;
    segActivo.cuerpo.classList.remove('cursor');
  }
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
  segActivo = { div, cuerpo: div.querySelector('.cuerpo'), texto, i: 0,
                voz: archivoVoz, sonido: sonidoExterno };
  const a = sonidoExterno ? sonarExterno(sonidoExterno) : sonar(archivoVoz);
  arrancarEscritura();
  sincronizarConVoz(a, texto);
}

function limpiarPantalla(){
  clearInterval(escribiendo);
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

function actualizarPosiciones(d){
  satelites = (d.todos||[]).map(s=>({...s, esProtagonista: d.protagonista && s.nombre===d.protagonista.nombre}));
  protagonista = d.protagonista || null;
  pintarSatelites();
  // TICK RÁPIDO (cada ~0,9 s): solo repinta los puntos para que la nube se
  // vea moverse. No toca telemetría ni cámara: si lo hiciera, el globo estaría
  // reencuadrando cada segundo y eso es justo lo que se sentía brusco.
  if (d.tick) {
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
    if(m.tipo==='segmento')     nuevoSegmento(d.tipo, d.texto, d.audio, d.sonido);
    if(m.tipo==='preludio'){
      limpiarPantalla();
      el('cabAgente').textContent='PRELUDIO';
      nuevoSegmento('narracion', d.texto||'', d.audio);
    }
    if(m.tipo==='agente_id'){
      limpiarPantalla();                       // cada agente entra con pantalla limpia
      el('cabAgente').textContent=d.nombre||'';
      nuevoSegmento('narracion', d.texto||'', d.audio);
    }
    if(m.tipo==='pausa') aplicarPausa(d.activa);
    if(m.tipo==='velocidad'){
      velocidadVoz = Math.min(2, Math.max(0.5, Number(d.valor) || 1));
      if (vozActual) {
        vozActual.playbackRate = velocidadVoz;
        // Reajustar el ritmo del texto a mitad de bloque, sin cortar nada.
        if (segActivo) sincronizarConVoz(vozActual, segActivo.texto);
      }
    }
    if(m.tipo==='deriva' && d.activa){
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
  firmaPoligonos = ''; pintarPoligonos();
  conectar();
})();
