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
    "fideo", "harina", "mayonesa", "servilleta", "agua",
    "gaseosa", "pan", "galletita", "jugo", "sal", "cafe", "te"
  ];

  for (let palabra of palabras) {
    palabra = normalizarSingularProducto(palabra);

    if (principales.includes(palabra)) {
      return palabra;
    }
  }

  if (palabras.length > 0) {
    return normalizarSingularProducto(palabras[0]);
  }

  return "";
}

function normalizarSingularProducto(palabra) {
  let p = String(palabra || "").trim();

  const equivalencias = {
    cocas: "coca",
    leches: "leche",
    azucares: "azucar",
    fideos: "fideo",
    servilletas: "servilleta",
    galletitas: "galletita",
    gaseosas: "gaseosa",
    aguas: "agua",
    jugos: "jugo",
    aceites: "aceite",
    yerbas: "yerba",
    harinas: "harina",
    arroces: "arroz",
    panes: "pan",
  };

  if (equivalencias[p]) return equivalencias[p];

  if (p.endsWith("es") && p.length > 4) {
    p = p.slice(0, -2);
  } else if (p.endsWith("s") && p.length > 3) {
    p = p.slice(0, -1);
  }

  return p;
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

  if (!esAclaracion) {
    return productosItemsAString([...actuales, ...nuevos]);
  }

  // En aclaraciones, reemplazamos productos ambiguos existentes.
  // Caso simple:
  //   2 coca -> coca 2l  => 2 coca 2l
  // Caso dividido:
  //   3 leche -> 2 leche entera + 1 leche descremada
  //   => 2 leche entera + 1 leche descremada
  const usados = new Set();
  const resultado = [];

  for (const actual of actuales) {
    const principalActual = obtenerProductoPrincipal(actual.producto);

    const relacionados = nuevos
      .map((nuevo, index) => ({ nuevo, index }))
      .filter(({ nuevo }) => {
        const principalNuevo = obtenerProductoPrincipal(nuevo.producto);
        return principalActual && principalNuevo && principalActual === principalNuevo;
      });

    if (relacionados.length === 0) {
      resultado.push(actual);
      continue;
    }

    relacionados.forEach(({ index }) => usados.add(index));

    if (relacionados.length === 1) {
      const nuevo = relacionados[0].nuevo;

      resultado.push({
        cantidad: actual.cantidad || nuevo.cantidad || 1,
        producto: nuevo.producto,
      });
    } else {
      for (const { nuevo } of relacionados) {
        resultado.push({
          cantidad: nuevo.cantidad || 1,
          producto: nuevo.producto,
        });
      }
    }
  }

  nuevos.forEach((nuevo, index) => {
    if (!usados.has(index)) {
      resultado.push(nuevo);
    }
  });

  return productosItemsAString(resultado);
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

function calcularCantidadTotalProductos(productos) {
  return productosStringAItems(productos).reduce((total, item) => {
    const cantidad = Number(item.cantidad || 1);
    return total + (Number.isFinite(cantidad) ? cantidad : 1);
  }, 0);
}

function armarFilasPedidoImprimible({
  numeroPedido,
  fecha,
  hora,
  cliente,
  telefono,
  productos,
  direccion,
  pago,
  horario_entrega,
}) {
  const items = productosStringAItems(productos);

  const filas = [
    ["AUTOSERVICIO VICTOR", "", ""],
    [`Pedido #${numeroPedido}`, "", ""],
    ["", "", ""],
    ["Fecha", fecha, ""],
    ["Hora", hora, ""],
    ["Cliente", cliente, ""],
    ["Teléfono", telefono, ""],
    ["Dirección", direccion, ""],
    ["Entrega", horario_entrega, ""],
    ["Forma de Pago", pago, ""],
    ["", "", ""],
    ["✓", "Cantidad", "Producto"],
  ];

  for (const item of items) {
    filas.push(["☐", item.cantidad || 1, item.producto]);
  }

  filas.push(
    ["", "", ""],
    ["Armó pedido", "________________________", ""],
    ["Controló", "________________________", ""],
    ["Pasó por caja", "________________________", ""]
  );

  return filas;
}

async function asegurarEncabezadosHojaPrincipal(sheets) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "Hoja 1!A1:J1",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        "Fecha",
        "Hora",
        "Cliente",
        "Teléfono",
        "Cant. Productos",
        "Dirección",
        "Forma de Pago",
        "Horario Entrega",
        "Estado",
        "Ver Pedido",
      ]],
    },
  });
}

async function aplicarDesplegableEstado(sheets) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: GOOGLE_SHEET_ID,
  });

  const hoja = (spreadsheet.data.sheets || []).find(
    (s) => s.properties.title === "Hoja 1"
  );

  if (!hoja) {
    throw new Error("No se encontró la hoja principal: Hoja 1");
  }

  const sheetId = hoja.properties.sheetId;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: GOOGLE_SHEET_ID,
    requestBody: {
      requests: [
        {
          setDataValidation: {
            range: {
              sheetId,
              startRowIndex: 1,
              startColumnIndex: 8,
              endColumnIndex: 9,
            },
            rule: {
              condition: {
                type: "ONE_OF_LIST",
                values: [
                  { userEnteredValue: "Incompleto" },
                  { userEnteredValue: "Completo" },
                ],
              },
              showCustomUi: true,
              strict: true,
            },
          },
        },
      ],
    },
  });
}

async function obtenerProximoNumeroPedido(sheets) {
  const respuesta = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "Hoja 1!A2:A",
  });

  const filas = respuesta.data.values || [];
  return filas.length + 1;
}

async function crearHojaPedidoImprimible(sheets, tituloBase) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: GOOGLE_SHEET_ID,
  });

  const titulosExistentes = new Set(
    (spreadsheet.data.sheets || []).map((s) => s.properties.title)
  );

  let titulo = tituloBase;
  let contador = 2;

  while (titulosExistentes.has(titulo)) {
    titulo = `${tituloBase}_${contador}`;
    contador += 1;
  }

  const respuesta = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: GOOGLE_SHEET_ID,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: titulo,
              gridProperties: {
                rowCount: 60,
                columnCount: 6,
              },
            },
          },
        },
      ],
    },
  });

  const nuevaHoja = respuesta.data.replies[0].addSheet.properties;

  return {
    titulo: nuevaHoja.title,
    sheetId: nuevaHoja.sheetId,
  };
}

async function formatearHojaPedidoImprimible(sheets, sheetId) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: GOOGLE_SHEET_ID,
    requestBody: {
      requests: [
        {
          mergeCells: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 3,
            },
            mergeType: "MERGE_ALL",
          },
        },
        {
          mergeCells: {
            range: {
              sheetId,
              startRowIndex: 1,
              endRowIndex: 2,
              startColumnIndex: 0,
              endColumnIndex: 3,
            },
            mergeType: "MERGE_ALL",
          },
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: 2,
              startColumnIndex: 0,
              endColumnIndex: 3,
            },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true, fontSize: 16 },
                horizontalAlignment: "CENTER",
              },
            },
            fields: "userEnteredFormat(textFormat,horizontalAlignment)",
          },
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 11,
              endRowIndex: 12,
              startColumnIndex: 0,
              endColumnIndex: 3,
            },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true },
                horizontalAlignment: "CENTER",
              },
            },
            fields: "userEnteredFormat(textFormat,horizontalAlignment)",
          },
        },
        {
          updateDimensionProperties: {
            range: {
              sheetId,
              dimension: "COLUMNS",
              startIndex: 0,
              endIndex: 1,
            },
            properties: { pixelSize: 80 },
            fields: "pixelSize",
          },
        },
        {
          updateDimensionProperties: {
            range: {
              sheetId,
              dimension: "COLUMNS",
              startIndex: 1,
              endIndex: 2,
            },
            properties: { pixelSize: 110 },
            fields: "pixelSize",
          },
        },
        {
          updateDimensionProperties: {
            range: {
              sheetId,
              dimension: "COLUMNS",
              startIndex: 2,
              endIndex: 3,
            },
            properties: { pixelSize: 360 },
            fields: "pixelSize",
          },
        },
      ],
    },
  });
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

  await asegurarEncabezadosHojaPrincipal(sheets);
  await aplicarDesplegableEstado(sheets);

  const numeroPedido = await obtenerProximoNumeroPedido(sheets);
  const numeroPedidoFormateado = String(numeroPedido).padStart(6, "0");
  const nombreHojaPedido = `Pedido_${numeroPedidoFormateado}`;
  const cantidadTotalProductos = calcularCantidadTotalProductos(productos);

  const hojaPedido = await crearHojaPedidoImprimible(sheets, nombreHojaPedido);

  const filasPedido = armarFilasPedidoImprimible({
    numeroPedido: numeroPedidoFormateado,
    fecha,
    hora,
    cliente,
    telefono,
    productos,
    direccion,
    pago,
    horario_entrega,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `'${hojaPedido.titulo}'!A1:C${filasPedido.length}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: filasPedido,
    },
  });

  await formatearHojaPedidoImprimible(sheets, hojaPedido.sheetId);

  const linkPedido = `=HIPERVINCULO("#gid=${hojaPedido.sheetId}";"Ver Pedido")`;

  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "Hoja 1!A:J",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [
        [
          fecha,
          hora,
          cliente,
          telefono,
          cantidadTotalProductos,
          direccion,
          pago,
          horario_entrega,
          estado,
          linkPedido,
        ],
      ],
    },
  });

  console.log(`Pedido guardado en Google Sheets: ${nombreHojaPedido}`);
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
      estado: "Incompleto",
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
- En las aclaraciones simples, conservá la cantidad original del pedido anterior.
- Si el cliente divide un producto anterior en varias variantes, respetá las cantidades nuevas de cada variante. Ejemplo: si antes tenía 3 leche y ahora aclara 2 leche entera en sachet y 1 leche descremada en botella, devolvé esos dos productos separados.
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
