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
const pedidosEnCurso = {};

function limpiarJson(texto) {
  if (!texto) return "{}";

  return texto
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();
}

function normalizarHorario(horario) {
  if (!horario) return "";

  const h = String(horario).toLowerCase();

  if (h.includes("12")) return "12:00";
  if (h.includes("17") || h.includes("5")) return "17:00";

  return horario;
}

function combinarPedido(anterior, nuevo) {
  return {
    cliente: nuevo.cliente || anterior.cliente || "",
    direccion: nuevo.direccion || anterior.direccion || "",
    pago: nuevo.pago || anterior.pago || "",
    productos: nuevo.productos || anterior.productos || "",
    horario_entrega: normalizarHorario(
      nuevo.horario_entrega || anterior.horario_entrega || ""
    ),
  };
}

function calcularDatosFaltantes(pedido) {
  const faltantes = [];

  if (!pedido.productos) faltantes.push("productos");
  if (!pedido.cliente) faltantes.push("nombre");
  if (!pedido.direccion) faltantes.push("direccion");
  if (!pedido.pago) faltantes.push("pago");
  if (!pedido.horario_entrega) faltantes.push("horario_entrega");

  return faltantes;
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

    const pedidoAnterior = pedidosEnCurso[from] || {
      cliente: "",
      direccion: "",
      pago: "",
      productos: "",
      horario_entrega: "",
    };

    console.log("Mensaje recibido de:", from);
    console.log("Texto recibido:", text);
    console.log("Pedido anterior:", pedidoAnterior);

    const extractor = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: `
Extraé datos de pedido de WhatsApp para un autoservicio.

Respondé SOLO JSON válido. No expliques nada.

Tenés un pedido anterior y un mensaje nuevo.
Combiná ambos para formar el pedido actualizado.

Pedido anterior:
${JSON.stringify(pedidoAnterior)}

Mensaje nuevo del cliente:
${text}

Detectá como pedido si:
- pide productos
- completa datos de un pedido anterior
- dice "quiero", "necesito", "te encargo", "mandame", "anotame", "pedido", "comprar"
- enumera productos aunque falten datos

Datos posibles:
- cliente / nombre
- direccion
- pago
- productos
- horario_entrega

Reglas importantes:
- Si el mensaje nuevo solo trae nombre, dirección, pago y horario, pero el pedido anterior tenía productos, conservá los productos anteriores.
- Si el mensaje nuevo trae productos nuevos, reemplazá productos por los nuevos.
- Si el mensaje nuevo completa un dato faltante, usalo.
- Si dice "Agustín, San Juan 573, efectivo, 12hs", extraé:
  cliente: "Agustín"
  direccion: "San Juan 573"
  pago: "efectivo"
  horario_entrega: "12:00"
- Horarios válidos: 12:00 o 17:00.
- Si dice 12hs, 12, mediodía: horario_entrega = "12:00".
- Si dice 17hs, 5 de la tarde, tarde: horario_entrega = "17:00".

Devolvé este formato:

{
  "hay_pedido": true,
  "cliente": "",
  "direccion": "",
  "pago": "",
  "productos": "",
  "horario_entrega": ""
}

Si no hay pedido ni datos de pedido:
{
  "hay_pedido": false,
  "cliente": "",
  "direccion": "",
  "pago": "",
  "productos": "",
  "horario_entrega": ""
}
      `,
    });

    let data;

    try {
      data = JSON.parse(limpiarJson(extractor.output_text));
    } catch (error) {
      console.log("No se pudo parsear JSON:", extractor.output_text);
      data = {
        hay_pedido: false,
        cliente: "",
        direccion: "",
        pago: "",
        productos: "",
        horario_entrega: "",
      };
    }

    console.log("Datos extraídos:", data);

    let pedidoActual = pedidoAnterior;
    let datosFaltantes = [];
    let pedidoCompleto = false;

    if (data.hay_pedido) {
      pedidoActual = combinarPedido(pedidoAnterior, data);
      pedidosEnCurso[from] = pedidoActual;

      datosFaltantes = calcularDatosFaltantes(pedidoActual);
      pedidoCompleto = datosFaltantes.length === 0;

      console.log("Pedido actualizado:", pedidoActual);
      console.log("Datos faltantes:", datosFaltantes);

      const estado = pedidoCompleto
        ? "Pedido completo"
        : "Faltan datos: " + datosFaltantes.join(", ");

      await guardarPedido({
        cliente: pedidoActual.cliente,
        telefono: from,
        productos: pedidoActual.productos,
        direccion: pedidoActual.direccion,
        pago: pedidoActual.pago,
        horario_entrega: pedidoActual.horario_entrega,
        estado,
      });

      if (pedidoCompleto) {
        delete pedidosEnCurso[from];
        console.log("Pedido completo. Memoria limpiada para:", from);
      }
    }

    let instruccionesRespuesta = "";

    if (data.hay_pedido && !pedidoCompleto) {
      instruccionesRespuesta = `
El cliente está armando un pedido.
Pedido actual:
${JSON.stringify(pedidoActual)}

Faltan estos datos:
${datosFaltantes.join(", ")}

Pedile SOLO los datos faltantes de forma breve.
`;
    } else if (data.hay_pedido && pedidoCompleto) {
      instruccionesRespuesta = `
El pedido está completo:
${JSON.stringify(pedidoActual)}

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
- No confirmes stock.
- No confirmes precio final.
- Siempre decí que un vendedor confirmará disponibilidad y precio final.
- Si faltan datos, pedí solo los datos faltantes.
- No vuelvas a pedir productos si ya están en el pedido actual.
- No vuelvas a pedir nombre, dirección, pago u horario si ya están en el pedido actual.

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
