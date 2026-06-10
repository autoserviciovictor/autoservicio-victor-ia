const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

const mensajesProcesados = new Set();

function limpiarJson(texto) {
  if (!texto) return "{}";

  return texto
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();
}

async function guardarPedido({
  cliente,
  telefono,
  productos,
  direccion,
  pago,
  horario_entrega,
  estado,
}) {
  const auth = new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY,
    ["https://www.googleapis.com/auth/spreadsheets"]
  );

  const sheets = google.sheets({ version: "v4", auth });

  const ahora = new Date();

  const fecha = ahora.toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
  });

  const hora = ahora.toLocaleTimeString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "2-digit",
    minute: "2-digit",
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "Hoja 1!A:I",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          fecha,
          hora,
          cliente || "",
          telefono || "",
          productos || "",
          direccion || "",
          pago || "",
          horario_entrega || "",
          estado || "Pendiente",
        ],
      ],
    },
  });

  console.log("Pedido guardado en Google Sheets");
}

app.get("/", (req, res) => {
  res.send("Servidor Autoservicio Victor IA funcionando");
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message || message.type !== "text") {
      return res.sendStatus(200);
    }

    if (mensajesProcesados.has(message.id)) {
      console.log("Mensaje duplicado ignorado:", message.id);
      return res.sendStatus(200);
    }

    mensajesProcesados.add(message.id);

    const from = message.from;
    const text = message.text.body;

    console.log("Mensaje recibido de:", from);
    console.log("Texto recibido:", text);

    const extractor = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: `
Extraé datos de un posible pedido de WhatsApp para un autoservicio.

Respondé SOLO JSON válido. No expliques nada.

Detectá como pedido si el cliente:
- pide productos
- dice "quiero", "necesito", "te encargo", "mandame", "anotame", "pedido", "comprar"
- enumera productos aunque falten nombre, dirección o pago

Productos pueden venir así:
- "2 coca, 1 pan"
- "coca x2"
- "yerba, azúcar y leche"
- "necesito fideos aceite galletitas"
- "te encargo arroz x2 azúcar x1"

Devolvé este formato:

{
  "hay_pedido": true,
  "pedido_completo": true,
  "cliente": "",
  "direccion": "",
  "pago": "",
  "productos": "",
  "horario_entrega": "",
  "datos_faltantes": []
}

Reglas:
- "hay_pedido" es true si hay productos o intención clara de comprar.
- "pedido_completo" es true solo si tiene productos, nombre, dirección y forma de pago.
- Si falta nombre, agregá "nombre" en datos_faltantes.
- Si falta dirección, agregá "direccion" en datos_faltantes.
- Si falta pago, agregá "pago" en datos_faltantes.
- Si falta horario de entrega, agregá "horario_entrega" en datos_faltantes.
- El horario de entrega puede ser 12:00 o 17:00.
- Si no hay pedido, respondé:
{
  "hay_pedido": false,
  "pedido_completo": false,
  "datos_faltantes": []
}

Mensaje del cliente:
${text}
      `,
    });

    let data;

    try {
      data = JSON.parse(limpiarJson(extractor.output_text));
    } catch (error) {
      console.log("No se pudo parsear JSON:", extractor.output_text);
      data = {
        hay_pedido: false,
        pedido_completo: false,
        datos_faltantes: [],
      };
    }

    console.log("Datos extraídos:", data);

    if (data.hay_pedido) {
      const estado = data.pedido_completo
        ? "Pedido completo"
        : "Faltan datos: " + (data.datos_faltantes || []).join(", ");

      await guardarPedido({
        cliente: data.cliente,
        telefono: from,
        productos: data.productos,
        direccion: data.direccion,
        pago: data.pago,
        horario_entrega: data.horario_entrega,
        estado,
      });
    }

    let instruccionesRespuesta = "";

    if (data.hay_pedido && !data.pedido_completo) {
      instruccionesRespuesta = `
El cliente hizo un pedido pero faltan estos datos: ${(data.datos_faltantes || []).join(", ")}.
Pedile esos datos de forma breve y amable.
`;
    } else if (data.hay_pedido && data.pedido_completo) {
      instruccionesRespuesta = `
El cliente hizo un pedido completo.
Agradecé el pedido y avisá que un vendedor confirmará disponibilidad y precio final.
`;
    } else {
      instruccionesRespuesta = `
Respondé normalmente como asistente del autoservicio.
`;
    }

    const ai = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: `
Sos el asistente virtual de Autoservicio Victor.

Información del negocio:
- Dirección: San Juan 573.
- Horario: 8:00 a 22:00.
- Realizamos envíos.
- Pedido mínimo: $50.000.
- Horarios de entrega: 12:00 y 17:00.
- Medios de pago: todos los medios en 1 cuota.

Reglas:
- Respondé breve, amable y en español argentino.
- Tomá pedidos.
- Si faltan datos, pedilos.
- No confirmes stock.
- No confirmes precio final.
- Decí que un vendedor confirmará disponibilidad y precio final.

${instruccionesRespuesta}

Mensaje del cliente:
${text}
      `,
    });

    const reply =
      ai.output_text || "Gracias. Un vendedor te responderá en breve.";

    await axios.post(
      `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: "542994654375",
        type: "text",
        text: {
          preview_url: false,
          body: reply,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("Respuesta enviada a WhatsApp");

    return res.sendStatus(200);
  } catch (error) {
    console.error("Error completo:", error.response?.data || error.message);
    return res.sendStatus(200);
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor activo en puerto ${PORT}`);
});
