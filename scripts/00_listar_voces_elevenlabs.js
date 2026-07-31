// 00_listar_voces_elevenlabs.js
//
// QUÉ HACE: pregunta a la API de ElevenLabs qué voces puedes usar con tu cuenta.
//
// POR QUÉ EXISTE: en el plan FREE, ElevenLabs solo permite usar voces de
// categoría "premade" (las voces "default" del sistema) a través de la API.
// Las voces de la "Voice Library" (la biblioteca comunitaria de +10.000 voces)
// están bloqueadas para cuentas free — si intentas usar una, la API responde
// con un error 402 ("free_users_not_allowed"). Este script te evita ese error:
// te muestra la lista real de voces que SÍ puedes usar, con su ID exacto.
//
// CÓMO CORRERLO:
//   node --env-file=.env scripts/00_listar_voces_elevenlabs.js
//
// (asume que tu .env tiene una línea: ELEVENLABS_API_KEY=tu-key-aqui)

const API_KEY = process.env.ELEVENLABS_API_KEY;

if (!API_KEY) {
  console.error("Falta ELEVENLABS_API_KEY en tu archivo .env");
  process.exit(1);
}

async function main() {
  // GET a /v1/voices: el endpoint que devuelve todas las voces accesibles
  // por tu cuenta (no todas las de ElevenLabs — solo las tuyas + las default).
  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": API_KEY },
  });

  if (!res.ok) {
    console.error(`Error ${res.status}: ${await res.text()}`);
    process.exit(1);
  }

  const data = await res.json();

  console.log(`\nTienes acceso a ${data.voices.length} voces vía API:\n`);

  for (const voz of data.voices) {
    const idioma = voz.labels?.language || voz.labels?.accent || "sin etiqueta";
    const esUsableEnFree = voz.category === "premade" ? "✓ usable en FREE" : "✗ requiere plan de pago";

    console.log(
      `- ${voz.name.padEnd(20)} | id: ${voz.voice_id} | categoría: ${voz.category.padEnd(10)} | ${idioma.padEnd(15)} | ${esUsableEnFree}`
    );
  }

  console.log(`\nCopia el "id" de la voz "premade" que quieras probar y pégalo`);
  console.log(`como VOICE_ID dentro de 05_voice_elevenlabs.js\n`);
}

main().catch((err) => {
  console.error("Fallo inesperado:", err);
  process.exit(1);
});
