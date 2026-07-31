// PROTOUSUARIO / AGENTE-ESPEJO -- Capa 2, Motor de estado afectivo
//
// QUÉ ES una FSM (máquina de estados finitos): un objeto que en cada momento
// está en EXACTAMENTE uno de un número finito de estados (aquí: AUTORITARIO
// o TERNURA) y que cambia de estado solo cuando una condición se cumple.
//
// POR QUÉ HISTÉRESIS: si decidieras el estado con un solo umbral (p.ej.
// "AUTORITARIO si señal > 0.5"), cuando la señal oscila alrededor de 0.5 el
// estado PARPADEA muchas veces por segundo -- visualmente epiléptico y
// narrativamente absurdo. La histéresis usa DOS umbrales: uno exigente para
// ENTRAR a un estado y otro más laxo para SALIR. Entre ambos hay una "banda
// muerta" donde el estado no cambia aunque la señal se mueva un poco.
//
// POR QUÉ DEBOUNCE: además, exigimos que la señal candidata se sostenga un
// tiempo mínimo (sostenerMs) antes de confirmar el cambio -- filtra ruido
// de un instante suelto.

export function crearFSMAfectiva({
  entrarAutoritario = 0.70,   // umbral de señal (0..1) para pasar a AUTORITARIO
  salirAutoritario  = 0.45,   // umbral más bajo para volver a TERNURA (histéresis)
  sostenerMs        = 3000,   // la señal candidata debe sostenerse este tiempo
} = {}) {
  let estado = 'TERNURA';
  let candidato = estado;
  let desde = Date.now();

  /**
   * @param {{ proximidad: number, enTerritorioConflicto: boolean }} entrada
   *   proximidad: 0..1, normalmente derivado de la elevación del satélite
   *   sobre el horizonte (0 = en el horizonte o debajo, 1 = en el cenit).
   *   enTerritorioConflicto: true si el punto subsatelital cae dentro de
   *   una región listada en regiones_conflicto.json.
   * @returns {{ estado: 'AUTORITARIO'|'TERNURA', cambio: boolean }}
   */
  return function actualizar({ proximidad, enTerritorioConflicto }) {
    const senal = Math.max(proximidad, enTerritorioConflicto ? 1 : 0);

    let objetivo = estado;
    if (estado === 'TERNURA'     && senal >= entrarAutoritario) objetivo = 'AUTORITARIO';
    if (estado === 'AUTORITARIO' && senal <  salirAutoritario)  objetivo = 'TERNURA';

    if (objetivo !== candidato) { candidato = objetivo; desde = Date.now(); }

    if (candidato !== estado && Date.now() - desde >= sostenerMs) {
      estado = candidato;
      return { estado, cambio: true };
    }
    return { estado, cambio: false };
  };
}

/** Convierte elevación en grados (-90..90) a una señal de proximidad 0..1.
 *  Bajo el horizonte (elevación <= 0) = 0. En el cenit (90°) = 1. */
export function elevacionAProximidad(elevacionDeg) {
  return Math.max(0, Math.min(1, elevacionDeg / 90));
}
