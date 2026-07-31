import json
import os

def reparar_mojibake(texto):
    if isinstance(texto, str):
        try:
            return texto.encode('latin-1').decode('utf-8')
        except (UnicodeEncodeError, UnicodeDecodeError):
            return texto
    return texto

def limpiar_datos_recursivo(data):
    if isinstance(data, dict):
        return {clave: limpiar_datos_recursivo(valor) for clave, valor in data.items()}
    elif isinstance(data, list):
        return [limpiar_datos_recursivo(elemento) for elemento in data]
    elif isinstance(data, str):
        return reparar_mojibake(data)
    else:
        return data

def procesar_carpeta(carpeta_entrada, carpeta_salida):
    if not os.path.exists(carpeta_salida):
        os.makedirs(carpeta_salida)

    for nombre_archivo in os.listdir(carpeta_entrada):
        if nombre_archivo.endswith('.json'):
            ruta_entrada = os.path.join(carpeta_entrada, nombre_archivo)
            ruta_salida = os.path.join(carpeta_salida, nombre_archivo)

            with open(ruta_entrada, 'r', encoding='utf-8') as f:
                datos = json.load(f)
            
            datos_limpios = limpiar_datos_recursivo(datos)
            
            with open(ruta_salida, 'w', encoding='utf-8') as f:
                json.dump(datos_limpios, f, ensure_ascii=False, indent=2)
            
            print(f"✅ Reparado: {nombre_archivo}")

if __name__ == "__main__":
    # 📁 Rutas de tus archivos originales (Entrada)
    carpeta_insta_raw = r"C:\Users\julio\agente-espejo\corpus\raw\instagram"
    carpeta_gpt_raw = r"C:\Users\julio\agente-espejo\corpus\raw\chatgpt"
    carpeta_mensajes_raw = r"C:\Users\julio\agente-espejo\corpus\private\instagram-messages"

    # 📁 Rutas donde se guardarán los archivos limpios (Salida)
    carpeta_insta_limpio = r"C:\Users\julio\agente-espejo\corpus\limpio\instagram"
    carpeta_gpt_limpio = r"C:\Users\julio\agente-espejo\corpus\limpio\chatgpt"
    carpeta_mensajes_limpio = r"C:\Users\julio\agente-espejo\corpus\limpio\private\instagram-messages"

    print("Iniciando limpieza de Instagram (Público)...")
    procesar_carpeta(carpeta_insta_raw, carpeta_insta_limpio)

    print("\nIniciando limpieza de ChatGPT...")
    procesar_carpeta(carpeta_gpt_raw, carpeta_gpt_limpio)

    print("\nIniciando limpieza de Mensajes Privados de Instagram...")
    procesar_carpeta(carpeta_mensajes_raw, carpeta_mensajes_limpio)

    print("\n¡Proceso terminado con éxito!")