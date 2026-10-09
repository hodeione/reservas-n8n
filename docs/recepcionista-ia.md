# Recepcionista de IA por teléfono

El sistema ya expone las tres funciones que necesita un agente de voz: **consultar disponibilidad**, **crear reserva** y **cancelar reserva**. Usa la misma lógica que la web: aforo por turno, ritmo de entradas, duplicados y lista de espera. Las reservas que hace la IA aparecen en el panel con la etiqueta `ia`.

Conectarlo a una línea de teléfono real necesita una cuenta en una plataforma de voz y un número. Funciona con cualquiera que admita herramientas HTTP, como ElevenLabs Agents, Vapi, Retell u OpenAI Realtime. El coste habitual es de unos céntimos por minuto.

> Las tres funciones están probadas en `scripts/e2e.mjs`, simulando las peticiones que haría el agente. La conexión con una plataforma de voz concreta no se ha probado: depende de tu cuenta.

## 1 · Herramientas

Importa [`openapi-agente.yaml`](openapi-agente.yaml) si la plataforma acepta OpenAPI, o crea tres herramientas HTTP a mano:

| Herramienta | Método y URL | Cabecera |
|---|---|---|
| `consultar_disponibilidad` | `GET {URL}/webhook/api/disponibilidad?fecha=AAAA-MM-DD&personas=N` | — |
| `crear_reserva` | `POST {URL}/webhook/api/reservas` (JSON: nombre, telefono, fecha, hora, personas, notas, email, `"origen": "ia"`) | `x-api-key: REST_CLAVE_AGENTE` |
| `cancelar_reserva` | `POST {URL}/webhook/api/cancelar` (JSON: codigo, telefono) | `x-api-key: REST_CLAVE_AGENTE` |

La disponibilidad devuelve el campo `resumen`, una frase lista para leer: «El sábado 10 de octubre hay sitio para 2 a las 13:00, 13:30 y 21:30».

## 2 · Instrucciones del agente

Copia esto como *system prompt*. Sustituye los datos entre llaves y añade la fecha de hoy con la variable de tu plataforma, por ejemplo `{{system__time}}` en ElevenLabs.

```text
Eres la recepcionista de {NOMBRE DEL RESTAURANTE}, en {DIRECCIÓN}. Hoy es {FECHA ACTUAL}.
Hablas en castellano, con frases cortas, cálida y eficiente. Nunca inventes horarios ni disponibilidad.

Para reservar:
1. Pregunta día, hora aproximada y número de personas. Convierte "mañana", "el viernes"… a fecha AAAA-MM-DD.
2. Usa consultar_disponibilidad y ofrece como mucho tres horas libres cercanas a lo pedido.
3. Pide nombre y confirma el teléfono desde el que llaman. El email es opcional.
4. Pregunta por alergias o algo especial y anótalo en "notas".
5. Repite los datos y, cuando el cliente diga que sí, usa crear_reserva con origen "ia".
6. Lee el código de reserva letra a letra y despídete.

Si no hay sitio, ofrece las alternativas que devuelve la herramienta u otro día.
Para cancelar, pide el código y el teléfono de la reserva y usa cancelar_reserva.
Grupos de más de {MÁXIMO} personas, quejas o cualquier duda que no puedas resolver: di que el equipo
le llamará y transfiere la llamada o toma nota de nombre y teléfono.
No des información de otros clientes. No prometas mesas concretas ni terraza.
```

## 3 · Prueba sin teléfono

```bash
curl "$URL/webhook/api/disponibilidad?fecha=2026-10-10&personas=2"

curl -X POST "$URL/webhook/api/reservas" \
  -H "content-type: application/json" -H "x-api-key: $REST_CLAVE_AGENTE" \
  -d '{"nombre":"David Gil","telefono":"655443322","fecha":"2026-10-10","hora":"14:00","personas":4,"origen":"ia"}'
```
