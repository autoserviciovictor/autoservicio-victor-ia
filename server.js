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
  if (!pedido.direccion) faltantes.push("dirección");
  if (!pedido.pago) faltantes.push("forma de pago");
  if (!pedido.horario_entrega) faltantes.push("horario de entrega (12:00 o 17:00)");
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

function distanciaLevenshtein(a, b) {
  a = String(a || "");
  b = String(b || "");

  const matriz = [];

  for (let i = 0; i <= b.length; i++) {
    matriz[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matriz[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matriz[i][j] = matriz[i - 1][j - 1];
      } else {
        matriz[i][j] = Math.min(
          matriz[i - 1][j - 1] + 1,
          matriz[i][j - 1] + 1,
          matriz[i - 1][j] + 1
        );
      }
    }
  }

  return matriz[b.length][a.length];
}

function palabraCoincide(palabraBuscada, palabrasArticulo) {
  const p = normalizarTexto(palabraBuscada);

  for (const palabraArticulo of palabrasArticulo) {
    const a = normalizarTexto(palabraArticulo);

    if (a === p) return true;

    // Permite plurales simples: coca/cocas, servilleta/servilletas.
    if (a === p + "s" || p === a + "s") return true;

    // Permite coincidencias parciales solo en palabras largas.
    if (p.length >= 5 && a.includes(p)) return true;
    if (a.length >= 5 && p.includes(a)) return true;

    // Permite errores pequeños: hellman/hellmanns, descremada/descrem.
    if (p.length >= 5 && a.length >= 5) {
      const distancia = distanciaLevenshtein(p, a);
      if (distancia <= 2) return true;
    }
  }

  return false;
}

function tieneVersionEspecial(art, productoBuscado) {
  const palabrasArt = art.split(" ").filter(Boolean);

  const indicadores = [
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

  const especiales = [
    "azucar",
    "sal",
    "sodio",
    "gluten",
    "lactosa",
    "alcohol",
    "grasas",
    "grasa",
  ];

  for (let i = 0; i < palabrasArt.length; i++) {
    const actual = palabrasArt[i];
    const siguiente = palabrasArt[i + 1] || "";
    const siguiente2 = palabrasArt[i + 2] || "";

    if (
      indicadores.includes(actual) &&
      (siguiente === productoBuscado ||
        siguiente2 === productoBuscado ||
        especiales.includes(siguiente) ||
        especiales.includes(siguiente2))
    ) {
      return true;
    }
  }

  return false;
}

function buscarEnCatalogo(catalogo, busqueda, limite = 5) {
  const q = normalizarTexto(busqueda);
  if (!q || q.length < 2) return [];

  const palabrasIgnorar = [
    "quiero",
    "dame",
    "necesito",
    "busco",
    "comprar",
    "llevo",
    "pasame",
    "un",
    "una",
    "uno",
    "unos",
    "unas",
    "dos",
    "tres",
    "cuatro",
    "cinco",
    "seis",
    "siete",
    "ocho",
    "nueve",
    "diez",
    "de",
    "del",
    "en",
    "la",
    "el",
    "los",
    "las",
    "y",
    "por",
    "favor",
  ];

  const palabrasBuscadas = q
    .split(" ")
    .filter((p) => p.length > 1)
    .filter((p) => !palabrasIgnorar.includes(p));

  if (palabrasBuscadas.length === 0) return [];

  const productosPrincipales = [
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
    "servilleta",
    "servilletas",
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

  const resultados = catalogo
    .map((item) => {
      const art = normalizarTexto(item.articulo);
      const palabrasArticulo = art.split(" ").filter(Boolean);

      let puntaje = 0;
      let coincidencias = 0;

      const detalleCoincidencias = palabrasBuscadas.map((palabra) => ({
        palabra,
        coincide: palabraCoincide(palabra, palabrasArticulo),
      }));

      coincidencias = detalleCoincidencias.filter((d) => d.coincide).length;
      const faltantes = detalleCoincidencias.filter((d) => !d.coincide).length;

      // Si no coincide ninguna palabra, no sirve.
      if (coincidencias === 0) {
        return {
          ...item,
          puntaje: -9999,
          coincidencias,
        };
      }

      // Base principal: cantidad de palabras coincidentes.
      puntaje += coincidencias * 3000;

      // Si coinciden todas las palabras, prioridad fuerte.
      if (faltantes === 0) {
        puntaje += 8000;
      }

      // Si faltan palabras en búsquedas detalladas, penaliza fuerte.
      // Ejemplo: "mayonesa hellmanns" no debe mostrar "Natura Mayonesa".
      if (palabrasBuscadas.length >= 2 && faltantes > 0) {
        puntaje -= faltantes * 5000;
      }

      // Coincidencia de frase completa.
      if (art === q) puntaje += 10000;
      if (art.includes(q)) puntaje += 7000;
      if (art.startsWith(q)) puntaje += 5000;

      // Bonus por posición: mejor si las palabras aparecen al principio.
      const posiciones = [];

      for (const palabra of palabrasBuscadas) {
        const pos = palabrasArticulo.findIndex((pa) =>
          palabraCoincide(palabra, [pa])
        );

        if (pos !== -1) posiciones.push(pos);
      }

      if (posiciones.length > 0) {
        const primeraPos = Math.min(...posiciones);

        if (primeraPos === 0) puntaje += 2200;
        else if (primeraPos === 1) puntaje += 1700;
        else if (primeraPos === 2) puntaje += 900;
        else puntaje += 200;
      }

      // Si es una búsqueda simple de producto principal,
      // evitar que aparezca como característica secundaria.
      if (
        palabrasBuscadas.length === 1 &&
        productosPrincipales.includes(palabrasBuscadas[0])
      ) {
        const producto = palabrasBuscadas[0];
        const posProducto = palabrasArticulo.findIndex((pa) =>
          palabraCoincide(producto, [pa])
        );

        if (posProducto === 0) puntaje += 2500;
        else if (posProducto === 1) puntaje += 2000;
        else if (posProducto === 2) puntaje += 900;
        else if (posProducto >= 3) puntaje -= 1000;

        if (tieneVersionEspecial(art, producto)) {
          puntaje = -9999;
        }
      }

      // Penalización general para "sin/cero/light" cuando afecta al producto buscado.
      for (const palabra of palabrasBuscadas) {
        if (tieneVersionEspecial(art, palabra)) {
          puntaje -= 6000;
        }
      }

      // Bonus por presentaciones comunes.
      if (
        art.includes("1 kg") ||
        art.includes("1kg") ||
        art.includes("1 lt") ||
        art.includes("1lt") ||
        art.includes("2 l") ||
        art.includes("2l") ||
        art.includes("500 gr") ||
        art.includes("500gr") ||
        art.includes("sachet")
      ) {
        puntaje += 200;
      }

      // Penaliza artículos demasiado largos cuando la búsqueda es corta.
      if (palabrasArticulo.length > 7 && palabrasBuscadas.length <= 2) {
        puntaje -= 250;
      }

      return {
        ...item,
        puntaje,
        coincidencias,
      };
    })
    .filter((item) => item.puntaje > 0);

  if (resultados.length === 0) return [];

  const maxCoincidencias = Math.max(...resultados.map((r) => r.coincidencias));

  // Filtro clave:
  // Si las mejores opciones tienen 3 coincidencias, no mostrar productos con 1.
  // Esto evita que aparezcan vinagre/ketchup cuando se buscan servilletas o leche.
  return resultados
    .filter((item) => item.coincidencias >= Math.max(1, maxCoincidencias - 1))
    .sort((a, b) => {
      if (b.coincidencias !== a.coincidencias) {
        return b.coincidencias - a.coincidencias;
      }

      return b.puntaje - a.puntaje;
    })
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

      // Si responde con un número válido, elige una opción.
      if (!isNaN(opcion) && opcion >= 1 && opcion <= pendiente.opciones.length) {
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

      // Si NO responde con número, interpretamos el mensaje como una búsqueda más detallada.
      // Ejemplo:
      // Bot: opciones para "mayonesa hellmanns"
      // Cliente: "hellmanns mayonesa doy pack"
      // Entonces se vuelve a buscar con ese texto, sin obligar a elegir número.
      const busquedaRefinada = text;
      let nuevasOpciones = buscarEnCatalogo(catalogo, busquedaRefinada, 5);

      // Si no encuentra nada, probamos combinando la búsqueda anterior con la nueva.
      if (nuevasOpciones.length === 0) {
        nuevasOpciones = buscarEnCatalogo(
          catalogo,
          `${pendiente.busqueda} ${busquedaRefinada}`,
          5
        );
      }

      if (nuevasOpciones.length === 0) {
        await enviarWhatsApp(
          from,
          `No encontré opciones para "${busquedaRefinada}". Probá escribiendo marca, producto y tamaño. Ejemplo: "mayonesa hellmanns 500gr".`
        );

        return res.sendStatus(200);
      }

      // Si encuentra una sola opción, la agrega directamente.
      if (nuevasOpciones.length === 1) {
        const productoFinal = `${pendiente.cantidad} ${nuevasOpciones[0].articulo}`;

        let pedidoActual = {
          ...pedidoAnterior,
          productos: agregarProducto(pedidoAnterior.productos, productoFinal),
        };

        const productosPendientes = pendiente.productosPendientes || [];

        delete seleccionesPendientes[from];

        await procesarProductos(from, catalogo, pedidoActual, productosPendientes);

        return res.sendStatus(200);
      }

      // Si encuentra varias, actualiza las opciones pendientes con la nueva búsqueda.
      seleccionesPendientes[from] = {
        cantidad: pendiente.cantidad,
        busqueda: busquedaRefinada,
        opciones: nuevasOpciones,
        productosPendientes: pendiente.productosPendientes || [],
      };

      let mensaje = `Busqué mejor "${busquedaRefinada}" y encontré estas opciones:\n\n`;

      nuevasOpciones.forEach((op, i) => {
        mensaje += `${i + 1}. ${op.articulo}\n`;
      });

      mensaje +=
        "\nRespondé con el número de la opción correcta, o escribí más detalles si todavía no está lo que buscás.";

      await enviarWhatsApp(from, mensaje);

      return res.sendStatus(200);
    }

    const extractor = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: `
Extraé datos de pedido de WhatsApp para un autoservicio.

Respondé SOLO JSON válido.

Tené especial cuidado:
- Los números 12 y 17 normalmente son horarios de entrega si aparecen junto a nombre, dirección o forma de pago.
- No confundas horarios con cantidades.
- No inventes productos.

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
- MUY IMPORTANTE: si el mensaje parece completar datos personales y NO menciona productos nuevos, productos_buscados debe ser [].
- Si dice 12hs, 12, mediodía: horario_entrega = "12:00".
- Si dice 17hs, 5 de la tarde, tarde: horario_entrega = "17:00".
- Si el cliente dice algo como "agustin, san juan 456, tarjeta y 12", interpretá 12 como horario_entrega "12:00", NO como cantidad de producto.
- Nunca inventes un producto llamado "producto".
- Nunca agregues productos_buscados si el cliente solo está pasando nombre, dirección, forma de pago u horario.
- Si el cliente escribe datos personales después de elegir productos, productos_buscados debe ser [].
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
