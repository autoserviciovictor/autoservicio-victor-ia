const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");
const { google } = require("googleapis");
const {
  formatearHojaPrincipal,
  aplicarDesplegableEstado,
  formatearHojaPedidoImprimible,
} = require("./excelStyles");

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

function extraerHorarioTexto(texto) {
  const original = String(texto || "").trim();
  const t = normalizarTexto(original);
  if (!t) return "";

  // Primero respetamos horarios válidos claros: 12 / 17.
  const valido = normalizarHorario(t);
  if (valido) return valido;

  // Evita tomar cantidades o tamaños como horarios.
  // Ejemplo anterior del error: "quiero 2 coca 2l ... 17" tomaba "02:00".
  const lineas = original
    .split(/\n|,|;/)
    .map((l) => normalizarTexto(l))
    .filter(Boolean);

  function formatearHora(horaTxt, minutosTxt) {
    const hora = Number(horaTxt);
    const minutos = minutosTxt ? Number(minutosTxt) : 0;

    if (!Number.isFinite(hora) || hora < 0 || hora > 23) return "";
    if (!Number.isFinite(minutos) || minutos < 0 || minutos > 59) return "";

    return `${String(hora).padStart(2, "0")}:${String(minutos).padStart(2, "0")}`;
  }

  // Caso: el cliente manda una línea sola: "17", "15", "15hs", "a las 15".
  for (const linea of lineas) {
    const horarioValidoLinea = normalizarHorario(linea);
    if (horarioValidoLinea) return horarioValidoLinea;

    const soloHorario = linea.match(/^(?:a\s+las\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(?:hs|h|horas)?$/);
    if (soloHorario) {
      const horario = formatearHora(soloHorario[1], soloHorario[2]);
      if (horario) return horario;
    }
  }

  // Caso: dentro de una frase: "entregalo a las 15hs" o "para las 15".
  const conContexto = t.match(/(?:a\s+las|para\s+las|entrega\s+a\s+las|llevalo\s+a\s+las|lo\s+quiero\s+a\s+las)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(?:hs|h|horas)?\b/);
  if (conContexto) {
    const horario = formatearHora(conContexto[1], conContexto[2]);
    if (horario) return horario;
  }

  // Caso: "15hs" en una frase, pero no "2l", "2 kg", etc.
  const conHs = t.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(?:hs|h|horas)\b/);
  if (conHs) {
    const horario = formatearHora(conHs[1], conHs[2]);
    if (horario) return horario;
  }

  return "";
}
function esMensajeSoloHorario(texto) {
  const t = normalizarTexto(texto);
  if (!t) return false;
  if (!extraerHorarioTexto(t)) return false;

  return /^(a\s+las\s+)?\d{1,2}([:.]\d{2})?\s*(hs|h|horas)?$/.test(t) ||
    t === "mediodia" ||
    t === "medio dia" ||
    t === "5 tarde" ||
    t === "cinco tarde";
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
    if (new RegExp(`\\b${palabra}\\b`).test(t)) return valor;
  }

  return 1;
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

function numeroPalabraAValor(valor) {
  const t = normalizarTexto(valor);

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

  if (cantidades[t]) return cantidades[t];

  const n = Number(String(valor).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function limpiarTextoProductoDesdeMensaje(segmento) {
  let texto = String(segmento || "").trim();

  texto = texto
    .replace(/^(quiero|necesito|pasame|mandame|agregame|sumame|me das|deme|dame)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();

  // Saca cantidades explícitas del final: "10 unidades", "x2", "x 2", "2 unidades".
  texto = texto
    .replace(/\b(?:x|por)\s*\d+\s*$/i, "")
    .replace(/\b\d+\s*(unidades|unidad|u|uni|uds)\s*$/i, "")
    .trim();

  // Saca cantidad explícita al inicio solo si NO es peso/medida.
  // "10 Lays 134 gm" => saca el 10.
  // "10 kg asado" => NO saca el 10 porque es parte del peso.
  texto = texto.replace(
    /^(\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?!kg\b|kilo\b|kilos\b|gr\b|g\b|gm\b|l\b|lt\b|lts\b|litro\b|litros\b|ml\b|cc\b)/i,
    ""
  );

  return texto.replace(/\s+/g, " ").trim();
}

function obtenerSegmentosMensajeProductos(texto) {
  return String(texto || "")
    .split(/\n|,|;|\sy\s(?=\d+\s|\w+)/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function extraerPesoOMedida(segmento) {
  const texto = normalizarTexto(segmento);

  const matches = [...texto.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(kg|kilo|kilos|gr|g|gm|l|lt|lts|litro|litros|ml|cc)\b/g)];

  if (matches.length === 0) return null;

  const ultimo = matches[matches.length - 1];

  return {
    numero: Number(String(ultimo[1]).replace(",", ".")),
    unidad: ultimo[2],
    texto: `${ultimo[1]} ${ultimo[2]}`,
  };
}

function extraerCantidadExplicita(segmento) {
  const texto = normalizarTexto(segmento);

  // "10 Lays 134 gm" => cantidad 10.
  // "2 lechones 5kg" => cantidad 2.
  // "10 kg asado" => NO es cantidad, es peso.
  const inicio = texto.match(/^(\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?!kg\b|kilo\b|kilos\b|gr\b|g\b|gm\b|l\b|lt\b|lts\b|litro\b|litros\b|ml\b|cc\b)/i);
  if (inicio) {
    const valor = numeroPalabraAValor(inicio[1]);
    if (valor > 0) return valor;
  }

  // "Lays 134 gm 10 unidades" => cantidad 10.
  const unidades = texto.match(/\b(\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s*(unidades|unidad|u|uni|uds)\b/i);
  if (unidades) {
    const valor = numeroPalabraAValor(unidades[1]);
    if (valor > 0) return valor;
  }

  // "coca 2l x2" o "coca 2l x 2" => cantidad 2.
  const xDespues = texto.match(/\b(?:x|por)\s*(\d+)\b/i);
  if (xDespues) {
    const valor = Number(xDespues[1]);
    if (Number.isFinite(valor) && valor > 0) return valor;
  }

  return 0;
}

function segmentoCoincideConProducto(segmento, producto) {
  const seg = normalizarTexto(segmento);
  const prod = normalizarTexto(producto);
  const principal = obtenerProductoPrincipal(producto);

  if (!seg || !prod) return false;
  if (principal && seg.includes(principal)) return true;

  const palabrasProducto = obtenerPalabrasClave(producto);
  return palabrasProducto.some((p) => seg.includes(p));
}

function corregirProductosConTextoOriginal(textoOriginal, productosBuscados) {
  if (!Array.isArray(productosBuscados) || productosBuscados.length === 0) {
    return productosBuscados || [];
  }

  const segmentos = obtenerSegmentosMensajeProductos(textoOriginal);

  return productosBuscados.map((item) => {
    if (!item || !item.producto) return item;

    const productoIA = String(item.producto || "").trim();
    const cantidadIA = Number(item.cantidad || 1);

    const segmento = segmentos.find((s) => segmentoCoincideConProducto(s, productoIA));

    if (!segmento) {
      return limpiarProductoYCantidad(cantidadIA, productoIA);
    }

    const pesoOMedida = extraerPesoOMedida(segmento);
    const cantidadExplicita = extraerCantidadExplicita(segmento);

    if (!pesoOMedida) {
      return limpiarProductoYCantidad(cantidadIA, productoIA);
    }

    const productoLimpioDesdeMensaje = limpiarTextoProductoDesdeMensaje(segmento);

    // Si hay peso/medida y NO hay cantidad explícita, el número de kg/gr/litros
    // pertenece al producto, no a la cantidad.
    //
    // Ejemplos:
    // "Asado 10 kg" => 1 | Asado 10 kg
    // "Papa 3 kg" => 1 | Papa 3 kg
    // "Lechón 5kg" => 1 | Lechón 5kg
    //
    // Si hay cantidad explícita, se respeta:
    // "2 lechones 5kg" => 2 | lechones 5kg
    // "10 Lays 134 gm" => 10 | Lays 134 gm
    // "Lays 134 gm 10 unidades" => 10 | Lays 134 gm
    if (cantidadExplicita > 0) {
      return {
        cantidad: cantidadExplicita,
        producto: productoLimpioDesdeMensaje || productoIA,
      };
    }

    return {
      cantidad: 1,
      producto: productoLimpioDesdeMensaje || productoIA,
    };
  });
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

  return completoTieneDetalle && !simpleTieneDetalle;
}

function fusionarProductos(productosActuales, productosNuevos, esAclaracion) {
  const actuales = productosStringAItems(productosActuales);
  const nuevos = productosBuscadosAItems(productosNuevos);

  if (!esAclaracion) {
    const resultado = [...actuales];
    const existentes = new Set(actuales.map(claveProducto));

    for (const nuevo of nuevos) {
      if (existentes.has(claveProducto(nuevo))) continue;

      const principalNuevo = obtenerProductoPrincipal(nuevo.producto);
      const existeMasCompleto = actuales.some((actual) => {
        const principalActual = obtenerProductoPrincipal(actual.producto);
        return principalActual && principalNuevo &&
          principalActual === principalNuevo &&
          productoEsMasCompleto(actual.producto, nuevo.producto);
      });

      if (existeMasCompleto) continue;

      resultado.push(nuevo);
      existentes.add(claveProducto(nuevo));
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
    if (!usados.has(index)) resultado.push(nuevo);
  });

  return productosItemsAString(resultado);
}

function completarProductosDesdeTextoYPedido(texto, pedidoAnterior, productosBuscados, dudasProductos) {
  let productos = Array.isArray(productosBuscados) ? [...productosBuscados] : [];
  const t = normalizarTexto(texto);
  const dudas = Array.isArray(dudasProductos) ? dudasProductos.map((d) => normalizarTexto(d)).join(" ") : "";

  if (productos.length === 0 && dudas.includes("coca") && /\bcoca(s)?\b/.test(t)) {
    productos.push({ cantidad: cantidadDesdeTexto(texto), producto: "coca" });
  }

  if (productos.length === 0 && dudas.includes("leche") && /\bleche(s)?\b/.test(t)) {
    productos.push({ cantidad: cantidadDesdeTexto(texto), producto: "leche" });
  }

  if (productos.length === 0 && pedidoAnterior && Array.isArray(pedidoAnterior.dudas_productos)) {
    const dudasAnteriores = pedidoAnterior.dudas_productos.map((d) => normalizarTexto(d)).join(" ");
    const actuales = productosStringAItems(pedidoAnterior.productos || "");

    if (dudasAnteriores.includes("coca") && productoTieneTamanioOPresentacion(texto)) {
      const cocaActual = actuales.find((item) => obtenerProductoPrincipal(item.producto) === "coca");
      productos.push({
        cantidad: cocaActual?.cantidad || cantidadDesdeTexto(texto) || 1,
        producto: `coca ${texto.trim()}`,
      });
    }

    if (dudasAnteriores.includes("leche") && t && !/\bleche\b/.test(t)) {
      const lecheActual = actuales.find((item) => obtenerProductoPrincipal(item.producto) === "leche");
      if (lecheActual) {
        productos.push({
          cantidad: lecheActual.cantidad || 1,
          producto: `leche ${texto.trim()}`,
        });
      }
    }
  }

  return productos;
}

function combinarPedido(anterior, nuevo) {
  const productosNuevos = nuevo.productos_buscados || [];

  // Prioridad:
  // 1) Si OpenAI ya devolvió un horario válido (12:00 o 17:00), usamos ese.
  // 2) Si no, usamos el horario detectado del texto del cliente.
  // Esto evita que una cantidad como "2 coca" se interprete como "02:00".
  const horarioEntregaIA = nuevo.horario_entrega || "";
  const horarioTextoCliente = nuevo.horario_solicitado || "";
  const horarioNormalizado = normalizarHorario(horarioEntregaIA) || normalizarHorario(horarioTextoCliente);
  const horarioSolicitado = horarioNormalizado ? "" : (extraerHorarioTexto(horarioEntregaIA) || extraerHorarioTexto(horarioTextoCliente));

  const esAclaracion =
    Array.isArray(anterior.dudas_productos) &&
    anterior.dudas_productos.length > 0 &&
    productosNuevos.length > 0;

  let horarioEntrega = anterior.horario_entrega || "";
  let horarioPendienteConfirmacion = anterior.horario_pendiente_confirmacion || false;
  let horarioInvalidoPropuesto = anterior.horario_invalido_propuesto || "";
  let horarioEspecialAceptado = false;

  if (horarioNormalizado) {
    horarioEntrega = horarioNormalizado;
    horarioPendienteConfirmacion = false;
    horarioInvalidoPropuesto = "";
  } else if (horarioSolicitado) {
    if (horarioPendienteConfirmacion && horarioInvalidoPropuesto === horarioSolicitado) {
      horarioEntrega = horarioSolicitado;
      horarioPendienteConfirmacion = false;
      horarioInvalidoPropuesto = "";
      horarioEspecialAceptado = true;
    } else {
      horarioPendienteConfirmacion = true;
      horarioInvalidoPropuesto = horarioSolicitado;
    }
  }

  return {
    cliente: nuevo.cliente || anterior.cliente || "",
    direccion: nuevo.direccion || anterior.direccion || "",
    pago: normalizarPago(nuevo.pago) || anterior.pago || "",
    productos: fusionarProductos(
      anterior.productos || "",
      productosNuevos,
      esAclaracion
    ),
    horario_entrega: horarioEntrega,
    horario_pendiente_confirmacion: horarioPendienteConfirmacion,
    horario_invalido_propuesto: horarioInvalidoPropuesto,
    horario_especial_aceptado: horarioEspecialAceptado,
    dudas_productos: nuevo.dudas_productos || [],
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
    ["Fecha", textoParaSheets(fecha), ""],
    ["Hora", textoParaSheets(hora), ""],
    ["Cliente", cliente, ""],
    ["Teléfono", textoParaSheets(telefono), ""],
    ["Dirección", direccion, ""],
    ["Entrega", textoParaSheets(horario_entrega), ""],
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
  await formatearHojaPrincipal(sheets);

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
          textoParaSheets(telefono),
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

  await formatearHojaPrincipal(sheets);
  await aplicarDesplegableEstado(sheets);

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

  if (pedidoActual.horario_pendiente_confirmacion) {
    pedidosEnCurso[from] = pedidoActual;

    await enviarWhatsApp(
      from,
      "Los horarios habituales de entrega son a las 12:00 o a las 17:00. ¿En cuál de esos horarios querés que te lo llevemos?"
    );

    return;
  }

  const faltantes = calcularDatosFaltantes(pedidoActual);

  if (faltantes.length === 0) {
    const horarioEspecialAceptado = pedidoActual.horario_especial_aceptado;

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

    if (horarioEspecialAceptado) {
      await enviarWhatsApp(
        from,
        "Perfecto, tu pedido quedó registrado. El horario solicitado se guardó, pero queda sujeto a confirmación del autoservicio para saber si se puede realizar la entrega a esa hora."
      );
    } else {
      await enviarWhatsApp(
        from,
        "Perfecto, tu pedido quedó registrado. Un vendedor confirmará disponibilidad y precio final."
      );
    }

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
      horario_pendiente_confirmacion: false,
      horario_invalido_propuesto: "",
      horario_especial_aceptado: false,
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
- Si un producto requiere aclaración, igual agregalo en productos_buscados con cantidad y producto base. Ejemplo: "quiero 2 coca" debe devolver [{"cantidad":2,"producto":"coca"}] y la duda correspondiente.
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
- Diferenciá siempre cantidad de peso/tamaño/presentación.
- Cantidad = cuántas unidades pide el cliente.
- Peso/tamaño/presentación queda dentro del nombre del producto.
- Si el cliente dice "Asado 10 kg", devolvé cantidad 1 y producto "Asado 10 kg".
- Si el cliente dice "Papa 3 kg", devolvé cantidad 1 y producto "Papa 3 kg".
- Si el cliente dice "Lechón 5kg", devolvé cantidad 1 y producto "Lechón 5kg".
- Si el cliente dice "2 lechones 5kg", devolvé cantidad 2 y producto "Lechones 5kg".
- Si el cliente dice "10 Lays 134 gm", devolvé cantidad 10 y producto "Lays 134 gm".
- Si el cliente dice "Lays 134 gm 10 unidades", devolvé cantidad 10 y producto "Lays 134 gm".
- Si el cliente dice "2 coca 2L", devolvé cantidad 2 y producto "coca 2L".
- Si el cliente dice "coca 2L x2", devolvé cantidad 2 y producto "coca 2L".
- Si no dice cantidad y es un producto individual común, asumí 1.
- Si realmente no queda clara la cantidad, preguntá.

Reglas para datos:
- Si completa datos personales, extraé cliente, dirección, pago y horario.
- Si dice 12hs, 12, mediodía: horario_entrega = "12:00".
- Si dice 17hs, 17, 5 de la tarde, tarde: horario_entrega = "17:00".
- Si dice otro horario distinto, dejá horario_entrega = "".
- El negocio solo entrega habitualmente a las 12:00 o 17:00.
- Si existe pedido anterior y el mensaje nuevo es solo "12", "12hs", "17" o "17hs", cargalo como horario_entrega.
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

    const horarioTexto = extraerHorarioTexto(text);
    const mensajeSoloHorario = esMensajeSoloHorario(text);

    let productosBuscados = completarProductosDesdeTextoYPedido(
      text,
      pedidoAnterior,
      data.productos_buscados || [],
      data.dudas_productos || []
    );

    productosBuscados = corregirProductosConTextoOriginal(text, productosBuscados);

    let dudasProductos = data.dudas_productos || [];

    // Si el mensaje es solo horario, no dejamos que la IA repita productos anteriores.
    if (pedidosEnCurso[from] && mensajeSoloHorario) {
      productosBuscados = [];
      dudasProductos = [];
    }

    const tieneDatosPedido =
      data.hay_pedido ||
      productosBuscados.length > 0 ||
      data.cliente ||
      data.direccion ||
      data.pago ||
      data.horario_entrega ||
      horarioTexto ||
      dudasProductos.length > 0;

    if (tieneDatosPedido || pedidosEnCurso[from]) {
      const pedidoActual = combinarPedido(pedidoAnterior, {
        cliente: data.cliente,
        direccion: data.direccion,
        pago: data.pago,
        horario_entrega: data.horario_entrega,
        horario_solicitado: horarioTexto,
        productos_buscados: productosBuscados,
        dudas_productos: dudasProductos,
      });

      console.log("Pedido combinado:", pedidoActual);

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
