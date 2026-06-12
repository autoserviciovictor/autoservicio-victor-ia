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
  return texto.replace(/```json/g, "").replace(/```/g, "").trim();
}

function normalizarTexto(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s:.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizarHorario(horario) {
  if (!horario) return "";

  const h = normalizarTexto(horario);

  if (
    h === "12" ||
    h === "12:00" ||
    h === "12 00" ||
    h.includes("12hs") ||
    h.includes("12 hs") ||
    h.includes("mediod")
  ) {
    return "12:00";
  }

  if (
    h === "17" ||
    h === "17:00" ||
    h === "17 00" ||
    h.includes("17hs") ||
    h.includes("17 hs") ||
    h.includes("5 tarde") ||
    h.includes("tarde")
  ) {
    return "17:00";
  }

  return "";
}

function normalizarPago(pago) {
  const p = normalizarTexto(pago);

  if (!p) return "";

  if (p.includes("efectivo")) return "efectivo";

  if (p.includes("tarjeta") || p.includes("debito") || p.includes("credito")) {
    return "tarjeta";
  }

  if (p.includes("transferencia") || p.includes("transf")) {
    return "transferencia";
  }

  if (p.includes("mercado pago") || p.includes("mercadopago") || p === "mp") {
    return "Mercado Pago";
  }

  return "";
}

function calcularDatosFaltantes(pedido) {
  const faltantes = [];

  if (!pedido.productos) faltantes.push("productos");
  if (!pedido.cliente) faltantes.push("nombre");
  if (!pedido.direccion) faltantes.push("dirección");
  if (!pedido.pago) faltantes.push("forma de pago");
  if (!pedido.horario_entrega) {
    faltantes.push("horario de entrega (12:00 o 17:00)");
  }

  return faltantes;
}

function agregarProducto(productosActuales, nuevoProducto) {
  if (!nuevoProducto) return productosActuales || "";
  if (!productosActuales) return nuevoProducto;
  return productosActuales + "\n" + nuevoProducto;
}

function formatearProductos(productosBuscados) {
  if (!Array.isArray(productosBuscados) || productosBuscados.length === 0) {
    return "";
  }

  return productosBuscados
    .filter((p) => p && p.producto)
    .map((p) => {
      const cantidad = p.cantidad || "";
      const producto = String(p.producto || "").trim();

      if (cantidad) {
        return `${cantidad} ${producto}`;
      }

      return producto;
    })
    .join("\n");
}


function obtenerPalabrasClave(producto) {
  const ignorar = [
    "de", "del", "la", "el", "los", "las", "en", "con", "sin", "y",
    "x", "por", "un", "una", "1", "2", "3", "4", "5",
    "kg", "gr", "lt", "l", "ml"
  ];

  return normalizarTexto(producto)
    .split(" ")
    .filter((p) => p.length > 2)
    .filter((p) => !ignorar.includes(p));
}

function obtenerProductoPrincipal(producto) {
  const palabras = obtenerPalabrasClave(producto);

  const principales = [
    "coca", "leche", "azucar", "yerba", "aceite", "arroz",
    "fideo", "fideos", "harina", "mayonesa", "servilleta",
    "servilletas", "agua", "gaseosa", "pan", "galletitas",
    "jugo", "sal", "cafe", "te"
  ];

  for (const p of palabras) {
    if (principales.includes(p)) return p;
  }

  return palabras[0] || "";
}

function parsearLineaProducto(linea) {
  const texto = String(linea || "").trim();
  const match = texto.match(/^(\d+)\s+(.+)$/);

  if (match) {
    return {
      cantidad: Number(match[1]),
      producto: match[2].trim(),
    };
  }

  return {
    cantidad: 1,
    producto: texto,
  };
}

function limpiarProductoYCantidad(cantidad, producto) {
  let prod = String(producto || "").trim();
  let cant = Number(cantidad || 1);

  // Evita que se guarde "1 1 coca" cuando la IA devuelve
  // cantidad: 1 y producto: "1 coca".
  const match = prod.match(/^(\d+)\s+(.+)$/);

  if (match) {
    cant = Number(match[1]);
    prod = match[2].trim();
  }

  return {
    cantidad: cant || 1,
    producto: prod,
  };
}

function productosStringAItems(productos) {
  if (!productos) return [];

  return String(productos)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map(parsearLineaProducto);
}

function productosItemsAString(items) {
  return items
    .filter((i) => i && i.producto)
    .map((i) => `${i.cantidad || 1} ${i.producto}`)
    .join("\n");
}

function productosBuscadosAItems(productosBuscados) {
  if (!Array.isArray(productosBuscados)) return [];

  return productosBuscados
    .filter((p) => p && p.producto)
    .map((p) => limpiarProductoYCantidad(p.cantidad, p.producto));
}

function fusionarProductos(productosActuales, productosNuevos, esAclaracion) {
  const actuales = productosStringAItems(productosActuales);
  const nuevos = productosBuscadosAItems(productosNuevos);

  for (const nuevo of nuevos) {
    const principalNuevo = obtenerProductoPrincipal(nuevo.producto);
    let indiceExistente = -1;

    if (esAclaracion && principalNuevo) {
      indiceExistente = actuales.findIndex((actual) => {
        const principalActual = obtenerProductoPrincipal(actual.producto);
        return principalActual && principalActual === principalNuevo;
      });
    }

    if (indiceExistente >= 0) {
      actuales[indiceExistente] = {
        cantidad: actuales[indiceExistente].cantidad || nuevo.cantidad || 1,
        producto: nuevo.producto,
      };
    } else {
      actuales.push(nuevo);
    }
  }

  return productosItemsAString(actuales);
}

function combinarPedido(anterior, nuevo) {
  const productosNuevos = nuevo.productos_buscados || [];

  const esAclaracion =
    Array.isArray(anterior.dudas_productos) &&
    anterior.dudas_productos.length > 0 &&
    productosNuevos.length > 0;

  return {
    cliente: nuevo.cliente || anterior.cliente || "",
    direccion: nuevo.direccion || anterior.direccion || "",
    pago: normalizarPago(nuevo.pago) || anterior.pago || "",
    productos: fusionarProductos(
      anterior.productos || "",
      productosNuevos,
      esAclaracion
    ),
    horario_entrega: normalizarHorario(
      nuevo.horario_entrega || anterior.horario_entrega || ""
    ),
    dudas_productos: nuevo.dudas_productos || [],
  };
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
          cliente,
          telefono,
          productos,
          direccion,
          pago,
          horario_entrega,
          estado,
        ],
      ],
    },
  });

  console.log("Pedido guardado en Google Sheets");
}

async function enviarWhatsApp(to, body) {
  await axios.post(
    `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",

      // NUMERO DE PRUEBA ACTUAL.
      // Cuando pases al número real, reemplazá esta línea por: to: to,
      to: "542994654375",

      type: "text",
      text: {
        preview_url: false,
        body,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

async function finalizarOSolicitarDatos(from, pedidoActual) {
  if (pedidoActual.dudas_productos && pedidoActual.dudas_productos.length > 0) {
    pedidosEnCurso[from] = pedidoActual;

    await enviarWhatsApp(
      from,
      "Para preparar bien el pedido, necesito que me aclares:\n" +
        pedidoActual.dudas_productos.map((d) => `- ${d}`).join("\n")
    );

    return;
  }

  const faltantes = calcularDatosFaltantes(pedidoActual);

  if (faltantes.length === 0) {
    await guardarPedido({
      cliente: pedidoActual.cliente,
      telefono: from,
      productos: pedidoActual.productos,
      direccion: pedidoActual.direccion,
      pago: pedidoActual.pago,
      horario_entrega: pedidoActual.horario_entrega,
      estado: "Pedido completo",
    });

    delete pedidosEnCurso[from];

    await enviarWhatsApp(
      from,
      "Perfecto, tu pedido quedó registrado. Un vendedor confirmará disponibilidad y precio final."
    );

    return;
  }

  pedidosEnCurso[from] = pedidoActual;

  await enviarWhatsApp(
    from,
    `Gracias. Para completar el pedido, pasame: ${faltantes.join(", ")}.`
  );
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
    const text = message.text.body.trim();

    console.log("Mensaje recibido de:", from);
    console.log("Texto recibido:", text);

    const pedidoAnterior = pedidosEnCurso[from] || {
      cliente: "",
      direccion: "",
      pago: "",
      productos: "",
      horario_entrega: "",
      dudas_productos: [],
    };

    const extractor = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: `
Extraé datos de pedido de WhatsApp para un autoservicio.

Respondé SOLO JSON válido.

IMPORTANTE:
- NO busques productos en ningún catálogo.
- NO muestres opciones.
- NO le pidas elegir número.
- NO confirmes stock.
- NO confirmes precio final.
- El cliente puede escribir los productos como quiera.
- Guardá los productos tal cual se entienden del mensaje.
- Solo preguntá aclaraciones si falta cantidad o tamaño/presentación importante.
- Un vendedor revisará disponibilidad y precio final después.

Pedido anterior:
${JSON.stringify(pedidoAnterior)}

Mensaje nuevo:
${text}

Devolvé este formato:

{
  "hay_pedido": true,
  "cliente": "",
  "direccion": "",
  "pago": "",
  "horario_entrega": "",
  "productos_buscados": [
    {
      "cantidad": 2,
      "producto": "coca 2L"
    }
  ],
  "dudas_productos": []
}

Reglas para productos:
- Si el cliente pide productos, ponelos todos en productos_buscados.
- Conservá marca, tamaño, presentación y detalles.
- Si el producto está claro, NO preguntes nada.
- Si falta cantidad, agregá una pregunta en dudas_productos.
- Si falta tamaño o presentación en productos donde importa, agregá una pregunta en dudas_productos.
- Si el cliente dice "coca" sin tamaño, preguntá: "¿De qué tamaño querés la Coca?"
- Si el cliente dice "leche" sin tipo o presentación, preguntá: "¿Qué leche querés? Por ejemplo entera, descremada, sachet o caja."
- Si el cliente dice "servilletas" sin tamaño, NO hace falta preguntar.
- Si el cliente dice "azucar" sin tamaño, NO hace falta preguntar.
- Si el cliente dice "yerba" sin marca o tamaño, preguntá marca o tamaño.
- Si el cliente dice "aceite" sin tamaño o tipo, preguntá tamaño o tipo.
- Si el cliente dice "gaseosa" sin marca o tamaño, preguntá marca y tamaño.
- Si dice "quiero una leche descremada en sachet, 2 cocas 2L y servilletas", devolvé:
  leche descremada en sachet cantidad 1,
  coca 2L cantidad 2,
  servilletas cantidad 1,
  dudas_productos [].
- Si dice "quiero mayonesa hellmanns, tres cocas y 1 azucar", devolvé:
  mayonesa hellmanns cantidad 1,
  coca cantidad 3,
  azucar cantidad 1,
  dudas_productos ["¿De qué tamaño querés las cocas?"].
- Convertí cantidades escritas en letras a números: una=1, un=1, dos=2, tres=3, cuatro=4, cinco=5.
- Si no dice cantidad y es un producto individual común, asumí 1.
- Si realmente no queda clara la cantidad, preguntá.

Reglas para datos:
- Si completa datos personales, extraé cliente, dirección, pago y horario.
- Si dice 12hs, 12, mediodía: horario_entrega = "12:00".
- Si dice 17hs, 17, 5 de la tarde, tarde: horario_entrega = "17:00".
- Si dice otro horario distinto, dejá horario_entrega = "".
- El negocio solo entrega a las 12:00 o 17:00.
- Forma de pago válida solo puede ser: efectivo, tarjeta, transferencia o Mercado Pago.
- Si el cliente escribe "agua", "coca", "leche" u otro producto, NO lo pongas como pago.
- Si el cliente solo pasa nombre, dirección, pago u horario, productos_buscados debe ser [].
- Si el pedido anterior tenía "3 leche" y el cliente aclara "leche entera en sachet", no lo tomes como producto nuevo; es una aclaración.
- Si el pedido anterior tenía "1 coca" y el cliente aclara "coca 2l", no lo tomes como producto nuevo; es una aclaración.
- En las aclaraciones, conservá la cantidad original del pedido anterior.
- Si el cliente responde una aclaración de producto, actualizá el pedido anterior y dejá dudas_productos [] si ya quedó claro.
- Si no hay pedido ni datos de pedido, hay_pedido false.
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
        horario_entrega: "",
        productos_buscados: [],
        dudas_productos: [],
      };
    }

    console.log("Datos extraídos:", data);

    const productosBuscados = data.productos_buscados || [];

    const tieneDatosPedido =
      data.hay_pedido ||
      productosBuscados.length > 0 ||
      data.cliente ||
      data.direccion ||
      data.pago ||
      data.horario_entrega ||
      (data.dudas_productos && data.dudas_productos.length > 0);

    if (tieneDatosPedido) {
      const pedidoActual = combinarPedido(pedidoAnterior, {
        cliente: data.cliente,
        direccion: data.direccion,
        pago: data.pago,
        horario_entrega: data.horario_entrega,
        productos_buscados: productosBuscados,
        dudas_productos: data.dudas_productos || [],
      });

      pedidosEnCurso[from] = pedidoActual;

      await finalizarOSolicitarDatos(from, pedidoActual);

      return res.sendStatus(200);
    }

    const ai = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: `
Sos el asistente virtual de Autoservicio Victor.

Información:
- Dirección: San Juan 573.
- Horario: 8:00 a 22:00.
- Realizamos envíos.
- Pedido mínimo: $50.000.
- Horarios de entrega: 12:00 y 17:00.
- Medios de pago: todos los medios en 1 cuota.

Reglas:
- Respondé breve, amable y en español argentino.
- Si el cliente quiere hacer un pedido, pedile que escriba los productos.
- No confirmes stock.
- No confirmes precio final.
- Un vendedor confirmará disponibilidad y precio final.

Mensaje del cliente:
${text}
      `,
    });

    await enviarWhatsApp(
      from,
      ai.output_text || "Gracias. Un vendedor te responderá en breve."
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
