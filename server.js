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

async function guardarPedido({ cliente, telefono, productos, direccion, pago }) {
  const auth = new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY,
    ["https://www.googleapis.com/auth/spreadsheets"]
  );

  const sheets = google.sheets({ version: "v4", auth });

  const ahora = new Date();
  const fecha = ahora.toLocaleDateString("es-AR");
  const hora = ahora.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "Hoja 1!A:I",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        fecha,
        hora,
        cliente || "",
        telefono || "",
        productos || "",
        direccion || "",
        pago || "",
        "",
        "Pendiente"
      ]],
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

    const from = message.from;
    const text = message.text.body;

    console.log("Mensaje recibido de:", from);
    console.log("Texto recibido:", text);

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
- Si faltan datos, pedí nombre, dirección, forma de pago y productos.
- No confirmes stock.
- No confirmes precio final.
- Decí que un vendedor confirmará disponibilidad y precio final.

Mensaje del cliente: ${text}
      `,
    });

    const reply = ai.output_text || "Gracias. Un vendedor te responderá en breve.";

    const extractor = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: `
const extractor = await openai.responses.create({
  model: "gpt-4.1-mini",
  input: `
Extraé datos de pedido del siguiente mensaje de WhatsApp.

Respondé SOLO JSON válido, sin explicación.

Considerá que hay un pedido completo si el mensaje incluye:
- nombre del cliente
- dirección
- forma de pago
- al menos un producto

El horario de entrega es opcional.

Si hay pedido completo, respondé:
{
  "pedido_completo": true,
  "cliente": "",
  "direccion": "",
  "pago": "",
  "productos": "",
  "horario_entrega": ""
}

Si NO hay pedido completo, respondé:
{
  "pedido_completo": false
}

Mensaje:
${text}
  `,
});

Si no hay pedido completo, respondé:
{"pedido_completo": false}

Si hay pedido completo, respondé:
{
  "pedido_completo": true,
  "cliente": "",
  "direccion": "",
  "pago": "",
  "productos": ""
}

Mensaje:
${text}
      `,
    });

    let data;
    try {
      data = JSON.parse(extractor.output_text);
    } catch {
      data = { pedido_completo: false };
    }

    if (data.pedido_completo) {
      await guardarPedido({
        cliente: data.cliente,
        telefono: from,
        productos: data.productos,
        direccion: data.direccion,
        pago: data.pago,
      });
    }

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
