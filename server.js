const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

app.get("/", (req, res) => {
  res.send("Servidor Autoservicio Victor IA funcionando");
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("Verificando webhook:", { mode, token, challenge });

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verificado correctamente");
    return res.status(200).send(challenge);
  }

  console.log("Error verificando webhook");
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];

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
- Tu función principal es responder consultas y tomar pedidos.
- Si el cliente quiere hacer un pedido, pedí nombre, dirección, forma de pago y productos.
- No confirmes stock.
- No confirmes precio final.
- Decí que un vendedor confirmará disponibilidad y precio final.
- Si el cliente pregunta algo que no sabés, decí que lo va a confirmar un vendedor.

Mensaje del cliente: ${text}
      `,
    });

    const reply =
      ai.output_text ||
      "Gracias. Un vendedor de Autoservicio Victor te responderá en breve.";

    console.log("Respuesta IA:", reply);
    console.log("Enviando respuesta a:", from);
    console.log("PHONE_NUMBER_ID usado:", PHONE_NUMBER_ID);

    const response = await axios.post(
      `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: from,
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

    console.log("Mensaje enviado correctamente:", response.data);

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
