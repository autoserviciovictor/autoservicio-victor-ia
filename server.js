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
    h === "12.00" ||
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
    h === "17.00" ||
    h.includes("17hs") ||
    h.includes("17 hs") ||
    h.includes("5 tarde") ||
    h.includes("cinco tarde")
  ) {
    return "17:00";
  }

  return "";
}


function extraerHorarioPedido(texto) {
  const t = normalizarTexto(texto);
  if (!t) return { encontrado: false, valido: false, horario: "", original: "" };

  const valido = normalizarHorario(t);
  if (valido) {
    return { encontrado: true, valido: true, horario: valido, original: valido };
  }

  const match = t.match(/\b(\d{1,2})(?:[:.]?(\d{2}))?\s*(hs|h)?\b/);
  if (!match) return { encontrado: false, valido: false, horario: "", original: "" };

  const hora = Number(match[1]);
  const minutos = match[2] ? Number(match[2]) : 0;

  if (!Number.isFinite(hora) || hora < 0 || hora > 23) {
    return { encontrado: false, valido: false, horario: "", original: "" };
  }

  const horario = `${String(hora).padStart(2, "0")}:${String(minutos || 0).padStart(2, "0")}`;
  return { encontrado: true, valido: false, horario, original: match[0] };
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

  // Si el cliente pasó un horario inválido por primera vez, no lo marcamos
  // como faltante común. Primero le preguntamos si puede ser 12:00 o 17:00.
  if (!pedido.horario_entrega && !pedido.horario_invalido_pendiente) {
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

function productoTieneTamanioOPresentacion(producto) {
  const p = normalizarTexto(producto);

  return /\b\d+(\.\d+)?\s*(l|lt|lts|litro|litros|ml|cc|kg|kilo|kilos|gr|g)\b/.test(p) ||
    p.includes("sachet") ||
    p.includes("botella") ||
    p.includes("caja") ||
    p.includes("lata") ||
    p.includes("pack");
}

function filtrarDudasInnecesarias(dudas, productosActuales, productosNuevos) {
  if (!Array.isArray(dudas) || dudas.length === 0) return [];

  const items = [
    ...productosStringAItems(productosActuales || ""),
    ...productosBuscadosAItems(productosNuevos || []),
  ];

  return dudas.filter((duda) => {
    const d = normalizarTexto(duda);

    const hayCocaConTamanio = items.some(
      (item) => obtenerProductoPrincipal(item.producto) === "coca" && productoTieneTamanioOPresentacion(item.producto)
    );

    if (hayCocaConTamanio && d.includes("coca") && (d.includes("tamano") || d.includes("tamaño"))) {
      return false;
    }

    const hayLecheConPresentacion = items.some(
      (item) => obtenerProductoPrincipal(item.producto) === "leche" && productoTieneTamanioOPresentacion(item.producto)
    );

    if (hayLecheConPresentacion && d.includes("leche")) {
      return false;
    }

    return true;
  });
}

function textoContieneProductoClaro(texto) {
  const t = normalizarTexto(texto);
  if (!t) return false;

  const palabras = obtenerPalabrasClave(t);
  return palabras.some((p) => {
    const principal = obtenerProductoPrincipal(p);
    return [
      "coca", "leche", "azucar", "yerba", "aceite", "arroz", "fideo",
      "harina", "mayonesa", "servilleta", "agua", "gaseosa", "pan",
      "galletita", "jugo", "sal", "cafe", "te"
    ].includes(principal);
  });
}

function mensajeEsSoloDatoComplementario(texto) {
  const t = normalizarTexto(texto);
  if (!t) return false;

  if (normalizarHorario(t)) return true;
  if (/^\d{1,2}([:.]\d{2})?\s*(hs|h)?$/.test(t)) return true;
  if (normalizarPago(t)) return true;

  const palabrasDePedido = ["quiero", "agrega", "agregar", "tambien", "también", "sumame", "mandame", "llevo"];
  if (palabrasDePedido.some((p) => t.includes(p))) return false;

  if (textoContieneProductoClaro(t)) return false;

  const palabras = t.split(" ").filter(Boolean);

  // Nombre simple: "agustin", "juan perez".
  if (/^[a-z\s]+$/.test(t) && palabras.length <= 4) return true;

  // Dirección simple: "san juan 456", "calle roca 123".
  if (/\d/.test(t) && palabras.length <= 6) return true;

  return false;
}


function mensajeTieneDatosSinProductos(texto) {
  const t = normalizarTexto(texto);
  if (!t) return false;

  const palabrasDePedido = ["quiero", "agrega", "agregar", "tambien", "también", "sumame", "mandame", "llevo", "necesito"];
  if (palabrasDePedido.some((p) => t.includes(p))) return false;
  if (textoContieneProductoClaro(t)) return false;

  const tienePago = Boolean(normalizarPago(t));
  const tieneHorario = extraerHorarioPedido(t).encontrado;
  const tieneDireccionProbable = /\d/.test(t) && /(calle|avenida|av|san|roca|ruta|barrio|juan|peron|sarmiento|mitre|belgrano|independencia|argentina)/.test(t);
  const tieneComas = String(texto || "").includes(",");

  return tienePago || tieneHorario || tieneDireccionProbable || tieneComas;
}

function claveProducto(item) {
  return `${Number(item.cantidad || 1)}|${normalizarTexto(item.producto)}`;
}

function productoEsMasCompleto(productoCompleto, productoSimple) {
  const completo = normalizarTexto(productoCompleto);
  const simple = normalizarTexto(productoSimple);

  if (!completo || !simple) return false;
  if (completo === simple) return true;

  const principalCompleto = obtenerProductoPrincipal(completo);
  const principalSimple = obtenerProductoPrincipal(simple);

  if (!principalCompleto || !principalSimple || principalCompleto !== principalSimple) {
    return false;
  }

  const completoTieneDetalle =
    productoTieneTamanioOPresentacion(completo) ||
    completo.split(" ").length > simple.split(" ").length;

  const simpleTieneDetalle = productoTieneTamanioOPresentacion(simple);

  // Ejemplo:
  // actual: "coca 2l" / nuevo: "coca" => ignorar nuevo.
  // actual: "leche entera en sachet" / nuevo: "leche" => ignorar nuevo.
  return completoTieneDetalle && !simpleTieneDetalle;
}

function quitarProductosYaExistentes(productosActuales, productosNuevos) {
  const actuales = productosStringAItems(productosActuales);
  const nuevos = productosBuscadosAItems(productosNuevos);

  if (actuales.length === 0 || nuevos.length === 0) {
    return productosNuevos || [];
  }

  const clavesActuales = new Set(actuales.map(claveProducto));

  return nuevos.filter((nuevo) => {
    // Evita duplicados exactos cuando la IA repite el pedido anterior.
    if (clavesActuales.has(claveProducto(nuevo))) {
      return false;
    }

    // Evita que la IA vuelva hacia atrás y reemplace/agregue un producto incompleto
    // cuando el pedido anterior ya tenía la aclaración completa.
    // Ejemplo: actual "2 coca 2l" y nuevo "2 coca" => se ignora "2 coca".
    const principalNuevo = obtenerProductoPrincipal(nuevo.producto);

    const existeVersionMasCompleta = actuales.some((actual) => {
      const principalActual = obtenerProductoPrincipal(actual.producto);
      return (
        principalActual &&
        principalNuevo &&
        principalActual === principalNuevo &&
        productoEsMasCompleto(actual.producto, nuevo.producto)
      );
    });

    if (existeVersionMasCompleta) {
      return false;
    }

    return true;
  });
}


function cantidadDesdeTexto(texto) {
  const t = normalizarTexto(texto);

  const numeros = t.match(/\b\d+\b/g);
  if (numeros && numeros.length > 0) {
    const n = Number(numeros[0]);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const cantidades = {
    un: 1,
    una: 1,
    uno: 1,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    siete: 7,
    ocho: 8,
    nueve: 9,
    diez: 10,
  };

  for (const [palabra, valor] of Object.entries(cantidades)) {
    if (new RegExp(`\\b${palabra}\\b`).test(t)) {
      return valor;
    }
  }

  return 1;
}

function completarProductosPendientesDesdeDudas(texto, dudasProductos, productosBuscados) {
  if (Array.isArray(productosBuscados) && productosBuscados.length > 0) {
    return productosBuscados;
  }

  if (!Array.isArray(dudasProductos) || dudasProductos.length === 0) {
    return productosBuscados || [];
  }

  const t = normalizarTexto(texto);
  const dudas = dudasProductos.map((d) => normalizarTexto(d)).join(" ");
  const cantidad = cantidadDesdeTexto(texto);
  const pendientes = [];

  if (dudas.includes("coca") && /\bcoca(s)?\b/.test(t)) {
    pendientes.push({ cantidad, producto: "coca" });
  }

  if (dudas.includes("leche") && /\bleche(s)?\b/.test(t)) {
    pendientes.push({ cantidad, producto: "leche" });
  }

  if (dudas.includes("yerba") && /\byerba(s)?\b/.test(t)) {
    pendientes.push({ cantidad, producto: "yerba" });
  }

  if (dudas.includes("aceite") && /\baceite(s)?\b/.test(t)) {
    pendientes.push({ cantidad, producto: "aceite" });
  }

  if (dudas.includes("gaseosa") && /\bgaseosa(s)?\b/.test(t)) {
    pendientes.push({ cantidad, producto: "gaseosa" });
  }

  return pendientes.length > 0 ? pendientes : (productosBuscados || []);
}

function fusionarProductos(productosActuales, productosNuevos, esAclaracion) {
  const actuales = productosStringAItems(productosActuales);
  const nuevos = productosBuscadosAItems(productosNuevos);

  if (!esAclaracion) {
    const existentes = new Set(actuales.map(claveProducto));
    const resultado = [...actuales];

    for (const nuevo of nuevos) {
      const clave = claveProducto(nuevo);
      if (!existentes.has(clave)) {
        resultado.push(nuevo);
        existentes.add(clave);
      }
    }

    return productosItemsAString(resultado);
  }

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
  let productosNuevos = nuevo.productos_buscados || [];

  const horarioDetectado = nuevo.horario_detectado || { encontrado: false, valido: false, horario: "" };
  const horarioNuevoNormalizado = normalizarHorario(nuevo.horario_entrega || "");
  const pagoNuevoNormalizado = normalizarPago(nuevo.pago || "");

  const nuevosItems = productosBuscadosAItems(productosNuevos);

  const esAclaracion =
    Array.isArray(anterior.dudas_productos) &&
    anterior.dudas_productos.length > 0 &&
    nuevosItems.length > 0 &&
    nuevosItems.some((nuevoItem) =>
      productosStringAItems(anterior.productos || "").some((actualItem) => {
        const principalActual = obtenerProductoPrincipal(actualItem.producto);
        const principalNuevo = obtenerProductoPrincipal(nuevoItem.producto);
        return (
          principalActual &&
          principalNuevo &&
          principalActual === principalNuevo &&
          productoEsMasCompleto(nuevoItem.producto, actualItem.producto)
        );
      })
    );

  if (!esAclaracion && anterior.productos) {
    productosNuevos = quitarProductosYaExistentes(anterior.productos, productosNuevos);
  }

  let horarioEntrega = anterior.horario_entrega || "";
  let horarioInvalidoPendiente = anterior.horario_invalido_pendiente || "";
  let horarioEspecial = Boolean(anterior.horario_especial);

  if (horarioNuevoNormalizado) {
    horarioEntrega = horarioNuevoNormalizado;
    horarioInvalidoPendiente = "";
    horarioEspecial = false;
  } else if (horarioDetectado.encontrado && !horarioDetectado.valido) {
    if (horarioInvalidoPendiente) {
      // Segunda vez que insiste con un horario fuera de 12:00/17:00:
      // lo guardamos, pero queda sujeto a confirmación del negocio.
      horarioEntrega = horarioDetectado.horario;
      horarioInvalidoPendiente = "";
      horarioEspecial = true;
    } else if (!horarioEntrega) {
      // Primera vez que pide horario inválido: preguntamos 12:00 o 17:00.
      horarioInvalidoPendiente = horarioDetectado.horario;
    }
  }

  return {
    cliente: nuevo.cliente || anterior.cliente || "",
    direccion: nuevo.direccion || anterior.direccion || "",
    pago: pagoNuevoNormalizado || anterior.pago || "",
    productos: fusionarProductos(
      anterior.productos || "",
      productosNuevos,
      esAclaracion
    ),
    horario_entrega: horarioEntrega,
    horario_invalido_pendiente: horarioInvalidoPendiente,
    horario_especial: horarioEspecial,
    dudas_productos: filtrarDudasInnecesarias(
      nuevo.dudas_productos || [],
      anterior.productos || "",
      productosNuevos || []
    ),
  };
}

function calcularCantidadTotalProductos(productos) {
  return productosStringAItems(productos).reduce((total, item) => {
    const cantidad = Number(item.cantidad || 1);
    return total + (Number.isFinite(cantidad) ? cantidad : 1);
  }, 0);
}

function textoParaSheets(valor) {
  if (valor === null || valor === undefined) return "";
  return `'${String(valor)}`;
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
    throw new Error("No se encontró la Hoja 1");
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
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 3,
            },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true, fontSize: 20 },
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
              startRowIndex: 1,
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
              startRowIndex: 3,
              endRowIndex: 10,
              startColumnIndex: 0,
              endColumnIndex: 1,
            },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true },
              },
            },
            fields: "userEnteredFormat.textFormat",
          },
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 3,
              endRowIndex: 10,
              startColumnIndex: 1,
              endColumnIndex: 2,
            },
            cell: {
              userEnteredFormat: {
                horizontalAlignment: "RIGHT",
              },
            },
            fields: "userEnteredFormat.horizontalAlignment",
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
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 12,
              startColumnIndex: 1,
              endColumnIndex: 2,
            },
            cell: {
              userEnteredFormat: {
                horizontalAlignment: "RIGHT",
              },
            },
            fields: "userEnteredFormat.horizontalAlignment",
          },
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 12,
              startColumnIndex: 2,
              endColumnIndex: 3,
            },
            cell: {
              userEnteredFormat: {
                horizontalAlignment: "LEFT",
              },
            },
            fields: "userEnteredFormat.horizontalAlignment",
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
            properties: { pixelSize: 130 },
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
            properties: { pixelSize: 150 },
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
            properties: { pixelSize: 430 },
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
          textoParaSheets(fecha),
          textoParaSheets(hora),
          cliente,
          telefono,
          cantidadTotalProductos,
          direccion,
          pago,
          textoParaSheets(horario_entrega),
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

  if (faltantes.length > 0) {
    pedidosEnCurso[from] = pedidoActual;

    await enviarWhatsApp(
      from,
      `Gracias. Para completar el pedido, pasame: ${faltantes.join(", ")}.`
    );

    return;
  }

  if (!pedidoActual.horario_entrega && pedidoActual.horario_invalido_pendiente) {
    pedidosEnCurso[from] = pedidoActual;

    await enviarWhatsApp(
      from,
      "Ese horario queda fuera de los horarios habituales de entrega. ¿Querés que te lo llevemos a las 12:00 o a las 17:00?"
    );

    return;
  }

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

  if (pedidoActual.horario_especial) {
    await enviarWhatsApp(
      from,
      `Perfecto, tu pedido quedó registrado. Guardamos el horario solicitado (${pedidoActual.horario_entrega}), pero queda sujeto a confirmación según disponibilidad para hacer el envío a esa hora.`
    );
  } else {
    await enviarWhatsApp(
      from,
      "Perfecto, tu pedido quedó registrado. Un vendedor confirmará disponibilidad y precio final."
    );
  }
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
      horario_invalido_pendiente: "",
      horario_especial: false,
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
- Si un producto requiere aclaración, igual agregalo en productos_buscados con cantidad y producto base. Ejemplo: "quiero 2 coca" debe devolver productos_buscados [{"cantidad":2,"producto":"coca"}] y dudas_productos ["¿De qué tamaño querés la Coca?"].
- Conservá marca, tamaño, presentación y detalles.
- Si el producto está claro, NO preguntes nada.
- Si falta cantidad, agregá una pregunta en dudas_productos.
- Si falta tamaño o presentación en productos donde importa, agregá una pregunta en dudas_productos.
- Si el cliente dice "coca" sin tamaño, preguntá: "¿De qué tamaño querés la Coca?"
- Si el cliente dice "coca 2l", "coca 3l", "coca 1.5l", "coca 500ml" o cualquier Coca con tamaño, NO preguntes tamaño.
- Si el cliente dice "leche" sin tipo o presentación, preguntá: "¿Qué leche querés? Por ejemplo entera, descremada, sachet o caja."
- Si el cliente dice "leche entera en sachet", "leche descremada en botella" o cualquier leche con tipo/presentación clara, NO preguntes nada.
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
- Si el mensaje nuevo es solo un dato faltante del pedido anterior, interpretalo como continuación del pedido.
- Si existe pedido anterior y el mensaje nuevo es solo "12", "12hs", "17" o "17hs", cargalo como horario_entrega.
- Los horarios habituales de entrega son "12:00" o "17:00".
- Si el cliente dice 11, 11hs, 13, 14, 15, 16, 18 u otro horario distinto a 12 o 17, dejá horario_entrega = "".
- Si dice 12hs, 12 o mediodía: horario_entrega = "12:00".
- Si dice 17hs, 17, 5 de la tarde: horario_entrega = "17:00".
- Si dice cualquier otro horario distinto, dejá horario_entrega = "".
- Si insiste con otro horario, el sistema lo guardará localmente y quedará sujeto a confirmación.
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

    const horarioDetectado = extraerHorarioPedido(text);

    let productosBuscados = completarProductosPendientesDesdeDudas(
      text,
      data.dudas_productos || [],
      data.productos_buscados || []
    );

    // Si hay un pedido abierto y el cliente solo está completando datos
    // (nombre, dirección, pago u horario), NO confiamos en productos_buscados
    // ni en dudas_productos que OpenAI pueda repetir desde el pedido anterior.
    // Esto evita volver de "coca 2L" a "coca" y repetir la duda de tamaño.
    const mensajeSoloDatosComplementarios =
      pedidosEnCurso[from] &&
      (mensajeEsSoloDatoComplementario(text) || mensajeTieneDatosSinProductos(text));

    if (mensajeSoloDatosComplementarios) {
      productosBuscados = [];
      data.dudas_productos = [];

      // Refuerzo local: si OpenAI no cargó horario/pago, lo sacamos del texto.
      // Ejemplo: "agustin, san juan 456, efectivo, 12hs".
      if (!data.horario_entrega) {
        data.horario_entrega = normalizarHorario(text);
      }

      if (!data.pago) {
        data.pago = normalizarPago(text);
      }
    }

    const tieneDatosPedido =
      data.hay_pedido ||
      productosBuscados.length > 0 ||
      data.cliente ||
      data.direccion ||
      data.pago ||
      data.horario_entrega ||
      (data.dudas_productos && data.dudas_productos.length > 0);

    if (tieneDatosPedido || pedidosEnCurso[from]) {
      const pedidoActual = combinarPedido(pedidoAnterior, {
        cliente: data.cliente,
        direccion: data.direccion,
        pago: data.pago,
        horario_entrega: data.horario_entrega,
        horario_detectado: horarioDetectado,
        productos_buscados: productosBuscados,
        dudas_productos: data.dudas_productos || [],
      });

      pedidosEnCurso[from] = pedidoActual;

      console.log("Pedido combinado:", pedidoActual);

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
