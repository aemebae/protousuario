import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-lite",
        contents: "Eres PROTOUSUARIO. Preséntate en una frase después de asustar al público presente con una noticia terrible de la coyuntura política peruana actual y el futuro régimen de la señora K.",
      });

      console.log(response.text);
      return;
    } catch (error) {
      console.error(`Intento ${attempt} falló:`, error.message || error);

      if (attempt < 3) {
        console.log("Esperando 5 segundos y reintentando...");
        await sleep(5000);
      } else {
        process.exit(1);
      }
    }
  }
}

main();