// PROTOUSUARIO / AGENTE-ESPEJO — cliente de la ESCENA COMPUESTA
// Todo local: globe.gl (trae su three.js) + Natural Earth 50m.

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
const AMBAR = '#ff9b3d', AMBAR_TENUE = '#c06a1e';
const MAR = '#0b1f33', TIERRA = '#3a3320';

let estadoActual = POR_DEFECTO, paisIdx = -1, satelites = [], protagonista = null;
const el = id => document.getElementById(id);
const hex = n => '#' + n.toString(16).padStart(6,'0');
const paleta = () => PALETA[estadoActual] ?? PALETA[POR_DEFECTO];

// ══ GLOBO PRINCIPAL ══
// showGlobe(true) con material de color: así el mar se ve como superficie y
// las líneas dejan de superponerse en el vacío. El truco para no necesitar
// THREE por separado: globeMaterial() devuelve el material YA creado y se
// muta su color, en vez de construir uno nuevo.
function crearGlobo(contenedor, opts = {}) {
  const g = Globe()(contenedor)
    .backgroundColor('rgba(0,0,0,0)')
    .showAtmosphere(true).atmosphereColor('#3a6ea5').atmosphereAltitude(0.13)
    .showGraticules(opts.graticulas ?? true);
  try { g.globeMaterial().color.set(MAR); } catch {}
  return g;
}
const globo = crearGlobo(el('globo'));
const globoZoom = crearGlobo(el('globoZoom'), {graticulas:false});

function ajustar(){
  const c = el('globo').getBoundingClientRect();
  globo.width(c.width).height(c.height);
  const z = el('globoZoom').getBoundingClientRect();
  globoZoom.width(z.width).height(z.height);
}
addEventListener('resize', ajustar); setTimeout(ajustar, 60);

// ══ PAÍSES (50m: incluye Cabo Verde, Rapa Nui, Malvinas, Hawái) ══
let paises = [];
fetch('data/ne_50m_admin_0_countries.geojson').then(r=>r.json()).then(geo=>{
  paises = geo.features; pintarPoligonos();
}).catch(e=>console.error('GeoJSON:', e));

function pintarPoligonos(){
  const p = paleta();
  for (const g of [globo, globoZoom]) {
    g.polygonsData(paises)
     .polygonCapColor((f,i)=> i===paisIdx ? hex(p.accent)+'99' : TIERRA)
     .polygonSideColor(()=> 'rgba(0,0,0,0.15)')
     .polygonStrokeColor((f,i)=> i===paisIdx ? hex(p.accent) : hex(p.grid))
     .polygonAltitude((f,i)=> i===paisIdx ? 0.016 : 0.004);
  }
}

function pintarSatelites(){
  const p = paleta();
  for (const g of [globo, globoZoom]) {
    g.pointsData(satelites)
     .pointLat(d=>d.lat).pointLng(d=>d.lon)
     // Protagonista con el color del agente; los demás en ámbar fijo.
     .pointColor(d => d.esProtagonista ? hex(p.accent) : (d.altKm>1200 ? AMBAR_TENUE : AMBAR))
     .pointAltitude(d => Math.min(0.35, (d.altKm ?? 500)/12000))
     .pointRadius(d => d.esProtagonista ? 0.5 : 0.16)
     .pointsMerge(false);
  }
  // El anillo de radar SOLO rodea al protagonista.
  const anillo = protagonista ? [{lat:protagonista.lat, lng:protagonista.lon}] : [];
  globo.ringsData(anillo).ringLat('lat').ringLng('lng')
    .ringColor(()=> hex(p.accent)).ringMaxRadius(4)
    .ringPropagationSpeed(2).ringRepeatPeriod(1400);
}

// ══ CÁMARA: retorno lento tras tocar el globo ══
// Si el performer mueve o hace zoom, el globo NO debe arrebatarle la vista:
// espera 2,5 s desde la última interacción y vuelve despacio (4 s).
let ultimaInteraccion = 0;
const ESPERA_RETORNO = 2500, DURACION_RETORNO = 4000;
for (const ev of ['mousedown','wheel','touchstart','touchmove'])
  el('globo').addEventListener(ev, ()=>{ ultimaInteraccion = Date.now(); }, {passive:true});

function centrar(lat, lon){
  const hacer = () => globo.pointOfView({lat, lng:lon, altitude:1.9}, DURACION_RETORNO);
  const falta = ESPERA_RETORNO - (Date.now() - ultimaInteraccion);
  falta > 0 ? setTimeout(hacer, falta) : hacer();
  globoZoom.pointOfView({lat, lng:lon, altitude:0.55}, 2500);  // plano detalle
}

// ══ ESTADO DEL AGENTE ══
function aplicarEstado(estado){
  if(!estado) return;
  estadoActual = PALETA[estado] ? estado : POR_DEFECTO;
  document.documentElement.setAttribute('data-estado', estadoActual);
  el('tEstado').textContent = estado;
  pintarPoligonos(); pintarSatelites();
}

// ══ TEXTO: máquina de escribir ══
const VEL = 22;                        // ms por carácter
let escribiendo = null;
const ROTULO = {orbital:'DATO ORBITAL', memoria:'MEMORIA EPISÓDICA',
                prompt:'PROMPT · PROTOUSUARIO', reflexion:'REFLEXIÓN'};

function nuevoSegmento(tipo, texto){
  const corrido = el('corrido');
  // el segmento anterior se atenúa: el foco siempre en el que suena
  corrido.querySelectorAll('.seg.activo').forEach(n=>n.classList.remove('activo'));
  if (tipo === 'orbital' && corrido.children.length > 8) corrido.innerHTML = '';

  const div = document.createElement('div');
  div.className = 'seg activo'; div.dataset.tipo = tipo;
  div.innerHTML = `<span class="rotulo">${ROTULO[tipo] ?? tipo}</span><span class="cuerpo cursor"></span>`;
  corrido.appendChild(div);
  const cuerpo = div.querySelector('.cuerpo');

  clearInterval(escribiendo);
  let i = 0;
  escribiendo = setInterval(()=>{
    cuerpo.textContent = texto.slice(0, ++i);
    corrido.scrollTop = corrido.scrollHeight;
    if(i >= texto.length){ clearInterval(escribiendo); cuerpo.classList.remove('cursor'); }
  }, VEL);
}

// ══ TERRITORIO ══
function mostrarTerritorio(d){
  el('bTipo').textContent = d.tipo === 'oceano' ? 'CUERPO DE AGUA' : 'TERRITORIO';
  el('bNombre').textContent = d.nombre ?? '—';
  // distrito / ciudad / país cuando el servidor los manda
  el('bDetalle').textContent = [d.distrito, d.ciudad].filter(Boolean).join(' · ');
  const r = el('bRegion');
  if(d.region && d.region_real){ r.textContent = '▸ ' + d.region; r.classList.add('visible'); }
  else r.classList.remove('visible');
  el('bannerTerritorio').classList.add('visible');
  if(typeof d.paisIdx === 'number'){ paisIdx = d.paisIdx; pintarPoligonos(); }
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

// ══ WEBSOCKET ══
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
    if(m.tipo==='preludio'){ el('cabAgente').textContent='PRELUDIO'; nuevoSegmento('orbital', d.texto||''); }
    if(m.tipo==='agente_id'){ el('cabAgente').textContent=d.nombre||''; nuevoSegmento('orbital', d.texto||''); }
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
conectar();
