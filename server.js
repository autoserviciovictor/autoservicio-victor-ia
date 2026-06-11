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
const seleccionesPendientes = {};

let catalogoCache = [];
let catalogoUltimaCarga = 0;

function limpiarJson(texto) {
  if (!texto) return "{}";
  return texto.replace(/```json/g, "").replace(/```/g, "").trim();
}

function normalizarTexto(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizarHorario(horario) {
  if (!horario) return "";
  const h = String(horario).toLowerCase();

  if (h.includes("12") || h.includes("mediod")) return "12:00";
  if (h.includes("17") || h.includes("5") || h.includes("tarde")) return "17:00";

  return horario;
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

function agregarProducto(productosActuales, nuevoProducto) {
  if (!productosActuales) return nuevoProducto;
  return productosActuales + "\n" + nuevoProducto;
}

function combinarPedido(anterior, nuevo) {
  return {
    cliente: nuevo.cliente || anterior.cliente || "",
    direccion: nuevo.direccion || anterior.direccion || "",
    pago: nuevo.pago || anterior.pago || "",
    productos: anterior.productos || "",
    horario_entrega: normalizarHorario(
      nuevo.horario_entrega || anterior.horario_entrega || ""
    ),
  };
}

function buscarEnCatalogo(catalogo, busqueda, limite = 5) {
  const q = normalizarTexto(busqueda);
  if (!q || q.length < 2) return [];

  const palabrasBuscadas = q.split(" ").filter((p) => p.length > 1);

  const palabrasDeProductoPrincipal = [
    "azucar",
    "sal",
    "leche",
    "aceite",
    "yerba",
    "arroz",
    "fideo",
    "fideos",
    "harina",
    "mayonesa",
    "ketchup",
    "mostaza",
    "coca",
    "sprite",
    "fanta",
    "agua",
    "jugo",
    "galletitas",
    "galletita",
    "pan",
    "cafe",
    "te",
    "mate",
    "dulce",
    "atun",
    "tomate",
    "pure",
    "salsa",
    "vinagre",
    "detergente",
    "lavandina",
    "jabon",
    "shampoo",
    "papel",
  ];

  const palabrasQueIndicanVersion = [
    "sin",
    "s",
    "cero",
    "zero",
    "0",
    "light",
    "diet",
    "bajo",
    "baja",
    "libre",
    "reducido",
    "reducida",
  ];

  const palabrasEspeciales = [
    "azucar",
    "sal",
    "sodio",
    "gluten",
    "lactosa",
    "alcohol",
    "grasas",
    "grasa",
  ];

  function tieneVersionEspecial(art, productoBuscado) {
    const palabrasArt = art.split(" ").filter(Boolean);

    for (let i = 0; i < palabrasArt.length; i++) {
      const actual = palabrasArt[i];
      const siguiente = palabrasArt[i + 1] || "";
      const siguiente2 = palabrasArt[i + 2] || "";

      if (
        palabrasQueIndicanVersion.includes(actual) &&
        (siguiente === productoBuscado ||
          siguiente2 === productoBuscado ||
          palabrasEspeciales.includes(siguiente) ||
          palabrasEspeciales.includes(siguiente2))
      ) {
        return true;
      }
    }

    return false;
  }

  function posicionPrimeraCoincidencia(art, palabras) {
    const palabrasArt = art.split(" ").filter(Boolean);
    let mejor = 999;

    for (const palabra of palabras) {
      const pos = palabrasArt.indexOf(palabra);
      if (pos !== -1 && pos < mejor) mejor = pos;
    }

    return mejor;
  }

  return catalogo
    .map((item) => {
      const art = normalizarTexto(item.articulo);
      const palabrasArticulo = art.split(" ").filter(Boolean);

      let puntaje = 0;

      // Coincidencia exacta total.
      if (art === q) puntaje += 3000;

      // El artículo empieza con la búsqueda.
      if (art.startsWith(q)) puntaje += 2200;

      // La búsqueda aparece completa.
      if (art.includes(q)) puntaje += 900;

      // Coincidencia exacta por palabras.
      for (const palabra of palabrasBuscadas) {
        const regexPalabra = new RegExp(`\\b${palabra}\\b`, "i");

        if (regexPalabra.test(art)) {
          puntaje += 500;
        } else if (art.includes(palabra)) {
          puntaje += 150;
        }
      }

      // Si todas las palabras buscadas aparecen, sube.
      const todasAparecen = palabrasBuscadas.every((p) => art.includes(p));
      if (todasAparecen) puntaje += 600;

      // Priorizar cuando la coincidencia aparece cerca del inicio.
      const pos = posicionPrimeraCoincidencia(art, palabrasBuscadas);
      if (pos === 0) puntaje += 1200;
      else if (pos === 1) puntaje += 900;
      else if (pos === 2) puntaje += 500;
      else if (pos >= 3 && pos < 999) puntaje += 100;

      // Si se busca marca + producto, priorizar que aparezcan ambas.
      if (palabrasBuscadas.length >= 2 && todasAparecen) {
        puntaje += 900;
      }

      // Penalización general para versiones "sin", "cero", "light", etc.
      // Ejemplo: buscar "azucar" no debe priorizar "Monster s/azucar".
      for (const palabra of palabrasBuscadas) {
        if (tieneVersionEspecial(art, palabra)) {
          puntaje -= 4000;
        }
      }

      // Si el usuario busca un producto principal simple, evitar que aparezca como característica secundaria.
      // Ejemplo: "azucar" en "cereal s/azucar", "sal" en "sin sal".
      if (
        palabrasBuscadas.length === 1 &&
        palabrasDeProductoPrincipal.includes(q)
      ) {
        const posProducto = palabrasArticulo.indexOf(q);

        if (posProducto === 0) puntaje += 1800;
        else if (posProducto === 1) puntaje += 1400;
        else if (posProducto === 2) puntaje += 700;
        else if (posProducto >= 3) puntaje -= 700;

        if (tieneVersionEspecial(art, q)) {
          puntaje = -9999;
        }
      }

      // Caso general para productos comunes con marca delante:
      // "Ledesma Azucar 1 Kg", "Natura Aceite...", "Amanda Yerba..."
      if (
        palabrasBuscadas.length === 1 &&
        palabrasDeProductoPrincipal.includes(q) &&
        palabrasArticulo.includes(q)
      ) {
        puntaje += 1200;
      }

      // Ajustes suaves por tamaño común.
      if (
        art.includes("1 kg") ||
        art.includes("1kg") ||
        art.includes("1 lt") ||
        art.includes("1lt") ||
        art.includes("500 gr") ||
        art.includes("500gr")
      ) {
        puntaje += 150;
      }

      // Ajustes específicos pero no únicos.
      if (q === "azucar") {
        if (art.includes("azucar 1 kg") || art.includes("azucar 1kg")) {
          puntaje += 2500;
        }

        if (
          art.includes("ledesma azucar") ||
          art.includes("ledesma superior azucar") ||
          art.includes("superior azucar")
        ) {
          puntaje += 2500;
        }

        if (
          art.includes("impalpable") ||
          art.includes("light") ||
          art.includes("rubio") ||
          art.includes("mascabo")
        ) {
          puntaje -= 300;
        }
      }

      if (q === "sal") {
        if (art.includes("sal fina") || art.includes("sal gruesa")) {
          puntaje += 1800;
        }

        if (tieneVersionEspecial(art, "sal") || art.includes("sin sal")) {
          puntaje = -9999;
        }
      }

      if (q === "leche") {
        if (art.startsWith("leche") || palabrasArticulo[0] === "leche") {
          puntaje += 1800;
        }

        if (art.includes("dulce de leche")) {
          puntaje -= 2500;
        }
      }

      if (q === "coca") {
        if (
          art.startsWith("coca") ||
          art.startsWith("coca cola") ||
          art.includes("coca cola")
        ) {
          puntaje += 2500;
        }
      }

      if (q.includes("mayonesa")) {
        if (art.startsWith("mayonesa")) puntaje += 1600;
        if (art.includes("hellmanns") || art.includes("hellmann s")) puntaje += 1600;
      }

      return {
        ...item,
        puntaje,
      };
    })
    .filter((item) => item.puntaje > 0)
    .sort((a, b) => b.puntaje - a.puntaje)
    .slice(0, limite);
}

async function obtenerCatalogo() {
  const ahora = Date.now();

  if (catalogoCache.length > 0 && ahora - catalogoUltimaCarga < 10 * 60 * 1000) {
    return catalogoCache;
  }

  const auth = new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY,
    ["https://www.googleapis.com/auth/spreadsheets"]
  );

  const sheets = google.sheets({ version: "v4", auth });

  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "Catalogo!A2:B",
  });

  const rows = result.data.values || [];

  catalogoCache = rows
    .filter((row) => row[0] && row[1])
    .map((row) => ({
      codigo: String(row[0]).trim(),
      articulo: String(row[1]).trim(),
    }));

  catalogoUltimaCarga = ahora;

  console.log("Catálogo cargado:", catalogoCache.length, "productos");
  return catalogoCache;
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
    delete seleccionesPendientes[from];

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

async function procesarProductos(from, catalogo, pedidoActual, productosPendientes) {
  while (productosPendientes.length > 0) {
    const prod = productosPendientes.shift();

    const cantidad = prod.cantidad || 1;
    const busqueda = prod.busqueda || "";

    const opciones = buscarEnCatalogo(catalogo, busqueda, 5);

    console.log("BUSQUEDA:", busqueda);

    if (opciones.length === 0) {
      console.log("Sin coincidencias para:", busqueda);

      pedidoActual.productos = agregarProducto(
        pedidoActual.productos,
        `${cantidad} ${busqueda}`
      );

      continue;
    }

    opciones.forEach((op, i) => {
      console.log(`${i + 1}. ${op.articulo} (${op.puntaje})`);
    });

    if (opciones.length === 1) {
      pedidoActual.productos = agregarProducto(
        pedidoActual.productos,
        `${cantidad} ${opciones[0].articulo}`
      );

      continue;
    }

    pedidosEnCurso[from] = pedidoActual;

    seleccionesPendientes[from] = {
      cantidad,
      busqueda,
      opciones,
      productosPendientes,
    };

    let mensaje = `Encontré varias opciones para "${busqueda}":\n\n`;

    opciones.forEach((op, i) => {
      mensaje += `${i + 1}. ${op.articulo}\n`;
    });

    mensaje += "\nRespondé con el número de la opción que querés.";

    await enviarWhatsApp(from, mensaje);

    return false;
  }

  pedidosEnCurso[from] = pedidoActual;

  await finalizarOSolicitarDatos(from, pedidoActual);

  return true;
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

    const catalogo = await obtenerCatalogo();

    console.log("Productos en catálogo:", catalogo.length);

    const pedidoAnterior = pedidosEnCurso[from] || {
      cliente: "",
      direccion: "",
      pago: "",
      productos: "",
      horario_entrega: "",
    };

    if (seleccionesPendientes[from]) {
      const opcion = parseInt(text, 10);
      const pendiente = seleccionesPendientes[from];

      if (isNaN(opcion) || opcion < 1 || opcion > pendiente.opciones.length) {
        await enviarWhatsApp(
          from,
          "Respondé con el número de una de las opciones."
        );

        return res.sendStatus(200);
      }

      const elegido = pendiente.opciones[opcion - 1];
      const productoFinal = `${pendiente.cantidad} ${elegido.articulo}`;

      let pedidoActual = {
        ...pedidoAnterior,
        productos: agregarProducto(pedidoAnterior.productos, productoFinal),
      };

      const productosPendientes = pendiente.productosPendientes || [];

      delete seleccionesPendientes[from];

      await procesarProductos(from, catalogo, pedidoActual, productosPendientes);

      return res.sendStatus(200);
    }

    const extractor = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: `
Extraé datos de pedido de WhatsApp para un autoservicio.

Respondé SOLO JSON válido.

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
      "busqueda": "coca"
    }
  ]
}

Reglas:
- Si el cliente pide productos, ponelos todos en productos_buscados.
- Si dice "quiero mayonesa hellmanns, tres cocas y 1 azucar", devolvé:
  mayonesa hellmanns cantidad 1,
  coca cantidad 3,
  azucar cantidad 1.
- Si dice "quiero 2 coca, azúcar y tres leches", devolvé:
  coca cantidad 2,
  azúcar cantidad 1,
  leche cantidad 3.
- Convertí cantidades escritas en letras a números: una=1, un=1, dos=2, tres=3, cuatro=4, cinco=5.
- Si no dice cantidad, asumí 1.
- Si completa datos personales, extraé cliente, dirección, pago y horario.
- Si dice 12hs, 12, mediodía: horario_entrega = "12:00".
- Si dice 17hs, 5 de la tarde, tarde: horario_entrega = "17:00".
- No preguntes por monto mínimo.
- No confirmes stock.
- No confirmes precio final.
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
      };
    }

    console.log("Datos extraídos:", data);

    if (data.hay_pedido) {
      let pedidoActual = combinarPedido(pedidoAnterior, {
        cliente: data.cliente,
        direccion: data.direccion,
        pago: data.pago,
        horario_entrega: data.horario_entrega,
      });

      const productosBuscados = data.productos_buscados || [];

      if (productosBuscados.length > 0) {
        await procesarProductos(from, catalogo, pedidoActual, productosBuscados);
        return res.sendStatus(200);
      }

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
