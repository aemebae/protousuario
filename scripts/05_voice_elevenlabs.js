// 05_voice_elevenlabs.js
//
// FASE 1 del pipeline de voz (ver Paper 5).
//
// QUÉ HACE ESTE SCRIPT: manda textos de prueba (prompt-manifiestos de ejemplo)
// a ElevenLabs por WebSocket streaming, mide cuánto tarda en llegar el primer
// audio, y guarda el resultado en mp3 dentro de out/.
//
// QUÉ NO HACE TODAVÍA: no está conectado a Gemini. Eso es la Fase 1.5 — una vez
// que confirmes que la voz suena bien y la latencia es aceptable, conectamos
// la función hablar() de aquí abajo a la salida real del generador de
// manifiestos.
//
// REQUISITOS:
//   npm install ws
//   .env con: ELEVENLABS_API_KEY=tu-key-aqui
//
// CÓMO CORRERLO:
//   node --env-file=.env scripts/05_voice_elevenlabs.js

import WebSocket from "ws";
import fs from "node:fs";
import { exec } from "node:child_process";

// ════════════════════════════════════════════════════════════
// CONFIGURACIÓN — edita esto según lo que veas en 00_listar_voces_elevenlabs.js
// ════════════════════════════════════════════════════════════

// Voz "Rachel", una de las voces default históricas de ElevenLabs.
// Corre primero 00_listar_voces_elevenlabs.js para confirmar que esta (u otra)
// está disponible en TU cuenta, y cambia el ID si prefieres otra voz.
const VOICE_ID = "0Ou6QL46aeiJmEnSWUxP"; // Sarcástica NatGeo

// El modelo de menor latencia (~75ms de inferencia según ElevenLabs), el
// recomendado para voz en vivo. Soporta español entre sus idiomas.
const MODEL_ID = "eleven_multilingual_v2";

// Forzar español reduce el riesgo de que la voz "default" (entrenada
// mayormente en inglés) suene con acento marcado.
const LANGUAGE_CODE = "es";

// Formato del audio de salida: mp3, 44.1kHz de frecuencia de muestreo,
// 128kbps de tasa de bits. Buena calidad para pruebas de escucha.
const OUTPUT_FORMAT = "mp3_44100_128";

const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) {
  console.error("Falta ELEVENLABS_API_KEY en tu archivo .env");
  process.exit(1);
}

// ════════════════════════════════════════════════════════════
// TEXTOS DE PRUEBA — reemplázalos más adelante por la salida real de Gemini
// ════════════════════════════════════════════════════════════

const MANIFIESTOS_DE_PRUEBA = [
  "Satélite GPS BIIR-2, elevación 65 grados. En este momento sobrevuela la República Democrática del Congo. Con movimientos lentos, recoge el taburete bajo de cinco ruedas.",
  "El agente no es un asistente. El agente es un clon que te observa desde veinte mil kilómetros de altura y te pide que te derrumbes hacia el sur.",
  "Hola, bienvenides, el especímen que ven a mi lado se identifica como PROTOUSUARIO, es mi servidor humana que cumplira mis prompts-manifiestos de manera literal... ¿Qué especie merece estar en la cima de la pirámide evolutiva? Responde con el cuerpo, no con palabras. Mantén el cuerpo en una tensión constante que simule la coexistencia de múltiples sistemas operativos; cada gesto debe ser una interpolación entre estados de latencia y ejecución.",
];

// ════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL: hablar(texto)
// ════════════════════════════════════════════════════════════
//
// Esta es la pieza que en el futuro llamará tu generador de manifiestos.
//
// Cómo funciona el protocolo WebSocket de ElevenLabs, paso a paso:
//
//   1. Abrimos la conexión — el "túnel" bidireccional persistente.
//
//   2. Mandamos un primer mensaje ("BOS" = beginning of stream, "inicio del
//      flujo") con tu API key y los ajustes de voz. Este mensaje NO lleva
//      todavía el texto que quieres que se hable.
//
//   3. Mandamos el texto real en uno o más mensajes ("chunks", fragmentos).
//      Hoy mandamos el manifiesto completo en un solo chunk; cuando conectes
//      Gemini en streaming, aquí es donde llamarías ws.send() una vez por
//      cada fragmento que Gemini vaya generando.
//
//   4. Mandamos un mensaje con texto vacío ("") para decirle al servidor
//      "ya no viene más texto, genera lo que falte".
//
//   5. El servidor responde por el MISMO túnel con mensajes que traen audio
//      codificado en base64 (una forma de representar datos binarios como
//      texto) — y empieza a mandarlos ANTES de terminar de generar todo el
//      audio. Por eso hay baja latencia: no esperas el audio completo.
//
//   6. Cuando el servidor manda "isFinal: true", ya no llegará más audio
//      para este texto — cerramos la conexión.

function hablar(texto, { guardarComo } = {}) {
  return new Promise((resolve, reject) => {
    const url =
      `wss://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream-input` +
      `?model_id=${MODEL_ID}&output_format=${OUTPUT_FORMAT}`;

    const ws = new WebSocket(url);

    const chunksDeAudio = []; // acumulamos el audio recibido, en orden de llegada
    let huboError = false;
    const t0 = Date.now(); // marca de tiempo para medir la latencia
    let primerAudioEn = null;

    ws.on("open", () => {
      // Mensaje BOS: autenticación + ajustes de voz.
      // stability: qué tan "fiel y estable" (vs. expresiva/variable) suena la
      //   voz en cada generación (0 a 1).
      // similarity_boost: qué tanto se refuerza el parecido a la voz original
      //   (relevante sobre todo cuando uses voces clonadas más adelante).
      ws.send(
        JSON.stringify({
          text: " ",
          voice_settings: {
          stability: 0.0,          // tu slider está al extremo "Más variable"
          similarity_boost: 1.0,   // tu slider está al extremo "Alta"
          style: 1.0,              // tu "Exageración de estilo" al máximo
          use_speaker_boost: true, // tu "Aumento de altavoz" está encendido
          speed: 1.10               // ← pon aquí el número exacto que veas en la web
          },
          xi_api_key: API_KEY,
          language_code: LANGUAGE_CODE,
        })
      );

      // El texto real. ElevenLabs recomienda terminar cada fragmento con un
      // espacio para que el "planificador" de generación sepa dónde termina
      // una palabra (evita que corte una palabra a la mitad).
      ws.send(JSON.stringify({ text: texto + " " }));

      // Cierre del flujo de texto: "ya no mando más, genera lo que falte".
      ws.send(JSON.stringify({ text: "" }));
    });

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());

      if (msg.audio) {
        if (primerAudioEn === null) {
          primerAudioEn = Date.now() - t0;
          console.log(`   ⏱  primer audio recibido en ${primerAudioEn} ms`);
        }
        chunksDeAudio.push(Buffer.from(msg.audio, "base64"));
      }

      if (msg.isFinal) {
        ws.close();
      }
    });

    ws.on("error", (err) => {
      huboError = true;
      console.error("   ✗ Error de WebSocket:", err.message);
    });

    ws.on("close", () => {
      if (huboError) {
        return reject(new Error("La conexión falló — revisa el mensaje de error de arriba."));
      }

      const audioCompleto = Buffer.concat(chunksDeAudio);

      if (audioCompleto.length === 0) {
        // Esto suele pasar si tu cuenta no tiene acceso a esa voz: por ejemplo,
        // si VOICE_ID apunta a una voz de la Voice Library en vez de una
        // "premade", en plan free el servidor cierra sin mandar audio.
        return reject(
          new Error(
            "No llegó audio. Si estás en plan free, confirma que VOICE_ID sea una voz " +
              '"premade" (default) — corre 00_listar_voces_elevenlabs.js para verificarlo.'
          )
        );
      }

      if (guardarComo) {
        fs.writeFileSync(guardarComo, audioCompleto);
        console.log(`   💾 guardado en ${guardarComo}`);
      }

      resolve({ audio: audioCompleto, latenciaPrimerAudioMs: primerAudioEn });
    });
  });
}

// ════════════════════════════════════════════════════════════
// REPRODUCCIÓN
// ════════════════════════════════════════════════════════════
//
// Node no reproduce audio por sí mismo (no es un reproductor multimedia).
// Para esta prueba, la forma más simple sin instalar dependencias nuevas es:
// guardar el mp3 y abrirlo con el reproductor por defecto de Windows.
// (Más adelante, cuando montemos la reproducción en los teléfonos vía
// navegador — Fase 2 del paper — esto cambiará por completo.)

function reproducir(rutaArchivo) {
  exec(`start "" "${rutaArchivo}"`, (err) => {
    if (err) {
      console.error("No se pudo abrir el reproductor automáticamente:", err.message);
      console.error(`Abre manualmente: ${rutaArchivo}`);
    }
  });
}

// ════════════════════════════════════════════════════════════
// EJECUCIÓN DE PRUEBA
// ════════════════════════════════════════════════════════════

async function main() {
  console.log(`Voz: ${VOICE_ID} | Modelo: ${MODEL_ID} | Idioma forzado: ${LANGUAGE_CODE}\n`);

  fs.mkdirSync("out", { recursive: true });

  for (let i = 0; i < MANIFIESTOS_DE_PRUEBA.length; i++) {
    const texto = MANIFIESTOS_DE_PRUEBA[i];
    const archivo = `out/manifiesto_prueba_${i + 1}.mp3`;

    console.log(`[${i + 1}/${MANIFIESTOS_DE_PRUEBA.length}] "${texto.slice(0, 60)}..."`);

    try {
      const { latenciaPrimerAudioMs } = await hablar(texto, { guardarComo: archivo });
      console.log(`   ✓ listo (latencia primer audio: ${latenciaPrimerAudioMs} ms)\n`);

      if (i === 0) reproducir(archivo); // abre el primero automáticamente para escucharlo ya
    } catch (err) {
      console.error(`   ✗ Falló: ${err.message}\n`);
    }
  }

  console.log("Prueba terminada. Revisa la carpeta out/ para escuchar los demás manifiestos.");
}

main();

// ════════════════════════════════════════════════════════════
// PARA MÁS ADELANTE (Fase 1.5): cómo se conectará esto a Gemini
// ════════════════════════════════════════════════════════════
//
// Cuando tengas el manifiesto generado por tu script de Gemini como una
// variable de texto, la integración es tan simple como:
//
//   import { hablar } from "./05_voice_elevenlabs.js"; (habría que exportarla)
//   const manifiesto = await generarManifiesto(...); // tu función existente
//   await hablar(manifiesto, { guardarComo: `out/manifiesto_${Date.now()}.mp3` });
//
// Si más adelante Gemini te da el texto en streaming (token por token), el
// cambio sería: en vez de un solo ws.send({text: manifiesto}), harías un
// ws.send({text: fragmento}) por cada fragmento que llegue, y solo mandarías
// el mensaje de cierre ({text: ""}) cuando Gemini termine.
