function colorHex(hex) {
  const limpio = hex.replace("#", "");
  const r = parseInt(limpio.substring(0, 2), 16) / 255;
  const g = parseInt(limpio.substring(2, 4), 16) / 255;
  const b = parseInt(limpio.substring(4, 6), 16) / 255;
  return { red: r, green: g, blue: b };
}

function obtenerSpreadsheetId(spreadsheetId) {
  return spreadsheetId || process.env.GOOGLE_SHEET_ID;
}

function escaparNombreHoja(titulo) {
  return String(titulo).replace(/'/g, "''");
}

async function obtenerHojaPorTitulo(sheets, spreadsheetId, titulo) {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });

  const hoja = (spreadsheet.data.sheets || []).find(
    (s) => s.properties.title === titulo
  );

  if (!hoja) {
    throw new Error(`No se encontró la hoja: ${titulo}`);
  }

  return hoja.properties;
}

async function obtenerHojaPorId(sheets, spreadsheetId, sheetId) {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });

  const hoja = (spreadsheet.data.sheets || []).find(
    (s) => s.properties.sheetId === sheetId
  );

  if (!hoja) {
    throw new Error(`No se encontró la hoja con ID: ${sheetId}`);
  }

  return hoja.properties;
}

async function formatearHojaPrincipal(sheets, spreadsheetIdParam) {
  const spreadsheetId = obtenerSpreadsheetId(spreadsheetIdParam);
  const hoja = await obtenerHojaPorTitulo(sheets, spreadsheetId, "Hoja 1");
  const sheetId = hoja.sheetId;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          updateSheetProperties: {
            properties: {
              sheetId,
              gridProperties: { frozenRowCount: 1 },
            },
            fields: "gridProperties.frozenRowCount",
          },
        },

        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 10,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: colorHex("#B71C1C"),
                textFormat: {
                  bold: true,
                  foregroundColor: colorHex("#FFFFFF"),
                },
                horizontalAlignment: "CENTER",
                verticalAlignment: "MIDDLE",
              },
            },
            fields:
              "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
          },
        },

        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 10,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: colorHex("#FFFFFF"),
                textFormat: {
                  bold: false,
                  foregroundColor: colorHex("#111111"),
                },
                verticalAlignment: "MIDDLE",
                wrapStrategy: "WRAP",
              },
            },
            fields:
              "userEnteredFormat(backgroundColor,textFormat,verticalAlignment,wrapStrategy)",
          },
        },

        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 2,
            },
            cell: {
              userEnteredFormat: { horizontalAlignment: "CENTER" },
            },
            fields: "userEnteredFormat.horizontalAlignment",
          },
        },

        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 1,
              startColumnIndex: 2,
              endColumnIndex: 3,
            },
            cell: {
              userEnteredFormat: { horizontalAlignment: "LEFT" },
            },
            fields: "userEnteredFormat.horizontalAlignment",
          },
        },

        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 1,
              startColumnIndex: 3,
              endColumnIndex: 5,
            },
            cell: {
              userEnteredFormat: { horizontalAlignment: "CENTER" },
            },
            fields: "userEnteredFormat.horizontalAlignment",
          },
        },

        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 1,
              startColumnIndex: 5,
              endColumnIndex: 6,
            },
            cell: {
              userEnteredFormat: { horizontalAlignment: "LEFT" },
            },
            fields: "userEnteredFormat.horizontalAlignment",
          },
        },

        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 1,
              startColumnIndex: 6,
              endColumnIndex: 10,
            },
            cell: {
              userEnteredFormat: { horizontalAlignment: "CENTER" },
            },
            fields: "userEnteredFormat.horizontalAlignment",
          },
        },

        {
          addConditionalFormatRule: {
            rule: {
              ranges: [
                {
                  sheetId,
                  startRowIndex: 1,
                  startColumnIndex: 8,
                  endColumnIndex: 9,
                },
              ],
              booleanRule: {
                condition: {
                  type: "TEXT_EQ",
                  values: [{ userEnteredValue: "Incompleto" }],
                },
                format: {
                  backgroundColor: colorHex("#FCE4D6"),
                  textFormat: {
                    bold: true,
                    foregroundColor: colorHex("#7F3B00"),
                  },
                },
              },
            },
            index: 0,
          },
        },

        {
          addConditionalFormatRule: {
            rule: {
              ranges: [
                {
                  sheetId,
                  startRowIndex: 1,
                  startColumnIndex: 8,
                  endColumnIndex: 9,
                },
              ],
              booleanRule: {
                condition: {
                  type: "TEXT_EQ",
                  values: [{ userEnteredValue: "Completo" }],
                },
                format: {
                  backgroundColor: colorHex("#D9EAD3"),
                  textFormat: {
                    bold: true,
                    foregroundColor: colorHex("#274E13"),
                  },
                },
              },
            },
            index: 1,
          },
        },

        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 1,
              startColumnIndex: 9,
              endColumnIndex: 10,
            },
            cell: {
              userEnteredFormat: {
                textFormat: {
                  foregroundColor: colorHex("#1155CC"),
                  underline: true,
                },
                horizontalAlignment: "CENTER",
              },
            },
            fields: "userEnteredFormat(textFormat,horizontalAlignment)",
          },
        },

        {
          updateBorders: {
            range: {
              sheetId,
              startRowIndex: 0,
              startColumnIndex: 0,
              endColumnIndex: 10,
            },
            top: { style: "SOLID", width: 1, color: colorHex("#D9D9D9") },
            bottom: { style: "SOLID", width: 1, color: colorHex("#D9D9D9") },
            left: { style: "SOLID", width: 1, color: colorHex("#D9D9D9") },
            right: { style: "SOLID", width: 1, color: colorHex("#D9D9D9") },
            innerHorizontal: { style: "SOLID", width: 1, color: colorHex("#E6E6E6") },
            innerVertical: { style: "SOLID", width: 1, color: colorHex("#E6E6E6") },
          },
        },

        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 120 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 95 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 2, endIndex: 3 }, properties: { pixelSize: 190 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 3, endIndex: 4 }, properties: { pixelSize: 150 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 4, endIndex: 5 }, properties: { pixelSize: 125 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 5, endIndex: 6 }, properties: { pixelSize: 270 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 6, endIndex: 7 }, properties: { pixelSize: 160 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 7, endIndex: 8 }, properties: { pixelSize: 145 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 8, endIndex: 9 }, properties: { pixelSize: 140 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 9, endIndex: 10 }, properties: { pixelSize: 130 }, fields: "pixelSize" } },
      ],
    },
  });
}

async function aplicarDesplegableEstado(sheets, spreadsheetIdParam) {
  const spreadsheetId = obtenerSpreadsheetId(spreadsheetIdParam);
  const hoja = await obtenerHojaPorTitulo(sheets, spreadsheetId, "Hoja 1");
  const sheetId = hoja.sheetId;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
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

function buscarValorPorEtiqueta(filas, etiqueta) {
  const etiquetaNormalizada = String(etiqueta).toLowerCase();

  for (const fila of filas) {
    const nombre = String(fila?.[0] || "").toLowerCase();
    if (nombre.includes(etiquetaNormalizada)) {
      return fila?.[1] || "";
    }
  }

  return "";
}

function extraerProductosDeFilas(filas) {
  const productos = [];

  for (let i = 0; i < filas.length; i++) {
    const fila = filas[i] || [];
    const cantidad = fila[1];
    const producto = fila[2];

    if (producto && cantidad && String(producto).toLowerCase() !== "producto") {
      productos.push([cantidad, producto]);
    }
  }

  return productos;
}

async function formatearHojaPedidoImprimible(sheets, arg1, arg2) {
  let spreadsheetId;
  let sheetId;

  if (arg2 === undefined) {
    spreadsheetId = process.env.GOOGLE_SHEET_ID;
    sheetId = arg1;
  } else {
    spreadsheetId = arg1;
    sheetId = arg2;
  }

  const hoja = await obtenerHojaPorId(sheets, spreadsheetId, sheetId);
  const tituloHoja = hoja.title;
  const tituloEscapado = escaparNombreHoja(tituloHoja);

  const respuesta = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tituloEscapado}'!A1:C60`,
  });

  const filasOriginales = respuesta.data.values || [];

  const titulo = filasOriginales?.[0]?.[0] || "AUTOSERVICIO VICTOR";
  const numeroPedido = filasOriginales?.[1]?.[0] || tituloHoja.replace("_", " #");

  const fecha = buscarValorPorEtiqueta(filasOriginales, "fecha");
  const hora = buscarValorPorEtiqueta(filasOriginales, "hora");
  const cliente = buscarValorPorEtiqueta(filasOriginales, "cliente");
  const telefono = buscarValorPorEtiqueta(filasOriginales, "teléfono") || buscarValorPorEtiqueta(filasOriginales, "telefono");
  const direccion = buscarValorPorEtiqueta(filasOriginales, "dirección") || buscarValorPorEtiqueta(filasOriginales, "direccion");
  const entrega = buscarValorPorEtiqueta(filasOriginales, "entrega");
  const pago = buscarValorPorEtiqueta(filasOriginales, "pago");

  const productos = extraerProductosDeFilas(filasOriginales);
  const inicioProductos = 12;
  const cantidadFilasProductos = Math.max(productos.length, 5);
  const filaFirmas = inicioProductos + cantidadFilasProductos + 3;

  const valores = [
    [titulo, "", "", ""],
    [numeroPedido, "", "", ""],
    ["", "", "", ""],
    ["", "", "", ""],
    ["DATOS DEL CLIENTE", "", "DATOS DEL PEDIDO", ""],
    ["Cliente:", cliente, "Horario de entrega:", entrega],
    ["Teléfono:", telefono, "Forma de pago:", pago],
    ["Dirección:", direccion, "Fecha:", fecha],
    ["", "", "Hora:", hora],
    ["", "", "", ""],
    ["Cantidad", "Producto", "", ""],
  ];

  for (const [cantidad, producto] of productos) {
    valores.push([cantidad, producto, "", ""]);
  }

  while (valores.length < inicioProductos + cantidadFilasProductos - 1) {
    valores.push(["", "", "", ""]);
  }

  valores.push(
    ["", "", "", ""],
    ["", "", "", ""],
    ["", "", "", ""],
    ["", "", "", ""],
    ["________________", "________________", "________________", "________________"],
    ["Armó pedido", "Controló", "Entregó", "Recibió"]
  );

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${tituloEscapado}'!A1:Z80`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tituloEscapado}'!A1:D${valores.length}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: valores,
    },
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          unmergeCells: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: 80,
              startColumnIndex: 0,
              endColumnIndex: 10,
            },
          },
        },

        {
          updateBorders: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: 80,
              startColumnIndex: 0,
              endColumnIndex: 10,
            },
            top: { style: "NONE" },
            bottom: { style: "NONE" },
            left: { style: "NONE" },
            right: { style: "NONE" },
            innerHorizontal: { style: "NONE" },
            innerVertical: { style: "NONE" },
          },
        },

        {
          mergeCells: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 4,
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
              endColumnIndex: 4,
            },
            mergeType: "MERGE_ALL",
          },
        },
        {
          mergeCells: {
            range: {
              sheetId,
              startRowIndex: 2,
              endRowIndex: 3,
              startColumnIndex: 0,
              endColumnIndex: 4,
            },
            mergeType: "MERGE_ALL",
          },
        },
        {
          mergeCells: {
            range: {
              sheetId,
              startRowIndex: 4,
              endRowIndex: 5,
              startColumnIndex: 0,
              endColumnIndex: 2,
            },
            mergeType: "MERGE_ALL",
          },
        },
        {
          mergeCells: {
            range: {
              sheetId,
              startRowIndex: 4,
              endRowIndex: 5,
              startColumnIndex: 2,
              endColumnIndex: 4,
            },
            mergeType: "MERGE_ALL",
          },
        },
        {
          mergeCells: {
            range: {
              sheetId,
              startRowIndex: 7,
              endRowIndex: 8,
              startColumnIndex: 1,
              endColumnIndex: 2,
            },
            mergeType: "MERGE_ALL",
          },
        },
        {
          mergeCells: {
            range: {
              sheetId,
              startRowIndex: 10,
              endRowIndex: 11,
              startColumnIndex: 1,
              endColumnIndex: 4,
            },
            mergeType: "MERGE_ALL",
          },
        },

        ...Array.from({ length: cantidadFilasProductos }).map((_, index) => ({
          mergeCells: {
            range: {
              sheetId,
              startRowIndex: inicioProductos - 1 + index,
              endRowIndex: inicioProductos + index,
              startColumnIndex: 1,
              endColumnIndex: 4,
            },
            mergeType: "MERGE_ALL",
          },
        })),

        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 4,
            },
            cell: {
              userEnteredFormat: {
                horizontalAlignment: "CENTER",
                verticalAlignment: "MIDDLE",
                textFormat: {
                  bold: true,
                  fontSize: 15,
                  foregroundColor: colorHex("#111111"),
                },
              },
            },
            fields:
              "userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat)",
          },
        },

        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 1,
              endRowIndex: 2,
              startColumnIndex: 0,
              endColumnIndex: 4,
            },
            cell: {
              userEnteredFormat: {
                horizontalAlignment: "CENTER",
                verticalAlignment: "MIDDLE",
                textFormat: {
                  bold: true,
                  fontSize: 14,
                  foregroundColor: colorHex("#111111"),
                },
              },
            },
            fields:
              "userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat)",
          },
        },

        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 2,
              endRowIndex: 3,
              startColumnIndex: 0,
              endColumnIndex: 4,
            },
            cell: {
              userEnteredFormat: {
                horizontalAlignment: "CENTER",
                verticalAlignment: "MIDDLE",
                textFormat: {
                  fontSize: 9,
                  foregroundColor: colorHex("#999999"),
                },
              },
            },
            fields:
              "userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat)",
          },
        },

        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 4,
              endRowIndex: 5,
              startColumnIndex: 0,
              endColumnIndex: 4,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: colorHex("#B71C1C"),
                textFormat: {
                  bold: true,
                  foregroundColor: colorHex("#FFFFFF"),
                },
                horizontalAlignment: "CENTER",
                verticalAlignment: "MIDDLE",
              },
            },
            fields:
              "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
          },
        },

        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 5,
              endRowIndex: 9,
              startColumnIndex: 0,
              endColumnIndex: 4,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: colorHex("#FFFFFF"),
                verticalAlignment: "MIDDLE",
                horizontalAlignment: "LEFT",
                wrapStrategy: "WRAP",
                textFormat: {
                  foregroundColor: colorHex("#111111"),
                  fontSize: 10,
                },
              },
            },
            fields:
              "userEnteredFormat(backgroundColor,verticalAlignment,horizontalAlignment,wrapStrategy,textFormat)",
          },
        },

        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 5,
              endRowIndex: 9,
              startColumnIndex: 0,
              endColumnIndex: 1,
            },
            cell: {
              userEnteredFormat: { textFormat: { bold: true } },
            },
            fields: "userEnteredFormat.textFormat.bold",
          },
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 5,
              endRowIndex: 9,
              startColumnIndex: 2,
              endColumnIndex: 3,
            },
            cell: {
              userEnteredFormat: { textFormat: { bold: true } },
            },
            fields: "userEnteredFormat.textFormat.bold",
          },
        },

        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 10,
              endRowIndex: 11,
              startColumnIndex: 0,
              endColumnIndex: 4,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: colorHex("#B71C1C"),
                textFormat: {
                  bold: true,
                  foregroundColor: colorHex("#FFFFFF"),
                },
                horizontalAlignment: "CENTER",
                verticalAlignment: "MIDDLE",
              },
            },
            fields:
              "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
          },
        },

        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 11,
              endRowIndex: 11 + cantidadFilasProductos,
              startColumnIndex: 0,
              endColumnIndex: 1,
            },
            cell: {
              userEnteredFormat: {
                horizontalAlignment: "CENTER",
                verticalAlignment: "MIDDLE",
              },
            },
            fields: "userEnteredFormat(horizontalAlignment,verticalAlignment)",
          },
        },

        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 11,
              endRowIndex: 11 + cantidadFilasProductos,
              startColumnIndex: 1,
              endColumnIndex: 4,
            },
            cell: {
              userEnteredFormat: {
                horizontalAlignment: "LEFT",
                verticalAlignment: "MIDDLE",
                wrapStrategy: "WRAP",
              },
            },
            fields:
              "userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy)",
          },
        },

        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: filaFirmas - 1,
              endRowIndex: filaFirmas + 3,
              startColumnIndex: 0,
              endColumnIndex: 4,
            },
            cell: {
              userEnteredFormat: {
                horizontalAlignment: "CENTER",
                verticalAlignment: "MIDDLE",
              },
            },
            fields: "userEnteredFormat(horizontalAlignment,verticalAlignment)",
          },
        },

        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: filaFirmas + 2,
              endRowIndex: filaFirmas + 3,
              startColumnIndex: 0,
              endColumnIndex: 4,
            },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true },
              },
            },
            fields: "userEnteredFormat.textFormat.bold",
          },
        },

        {
          updateBorders: {
            range: {
              sheetId,
              startRowIndex: 4,
              endRowIndex: 9,
              startColumnIndex: 0,
              endColumnIndex: 4,
            },
            top: { style: "SOLID", width: 1, color: colorHex("#666666") },
            bottom: { style: "SOLID", width: 1, color: colorHex("#666666") },
            left: { style: "SOLID", width: 1, color: colorHex("#666666") },
            right: { style: "SOLID", width: 1, color: colorHex("#666666") },
            innerHorizontal: { style: "SOLID", width: 1, color: colorHex("#D9D9D9") },
            innerVertical: { style: "SOLID", width: 1, color: colorHex("#666666") },
          },
        },

        {
          updateBorders: {
            range: {
              sheetId,
              startRowIndex: 10,
              endRowIndex: 11 + cantidadFilasProductos,
              startColumnIndex: 0,
              endColumnIndex: 4,
            },
            top: { style: "SOLID", width: 1, color: colorHex("#666666") },
            bottom: { style: "SOLID", width: 1, color: colorHex("#666666") },
            left: { style: "SOLID", width: 1, color: colorHex("#666666") },
            right: { style: "SOLID", width: 1, color: colorHex("#666666") },
            innerHorizontal: { style: "SOLID", width: 1, color: colorHex("#D9D9D9") },
            innerVertical: { style: "SOLID", width: 1, color: colorHex("#666666") },
          },
        },

        {
          updateBorders: {
            range: {
              sheetId,
              startRowIndex: filaFirmas - 1,
              endRowIndex: filaFirmas + 3,
              startColumnIndex: 0,
              endColumnIndex: 4,
            },
            top: { style: "NONE" },
            bottom: { style: "NONE" },
            left: { style: "NONE" },
            right: { style: "NONE" },
            innerHorizontal: { style: "NONE" },
            innerVertical: { style: "NONE" },
          },
        },

        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 130 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 260 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 2, endIndex: 3 }, properties: { pixelSize: 150 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 3, endIndex: 4 }, properties: { pixelSize: 170 }, fields: "pixelSize" } },

        { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 30 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 30 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 2, endIndex: 3 }, properties: { pixelSize: 20 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 4, endIndex: 5 }, properties: { pixelSize: 28 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 10, endIndex: 11 }, properties: { pixelSize: 30 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 11, endIndex: 11 + cantidadFilasProductos }, properties: { pixelSize: 34 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: filaFirmas - 1, endIndex: filaFirmas + 1 }, properties: { pixelSize: 42 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: filaFirmas + 1, endIndex: filaFirmas + 3 }, properties: { pixelSize: 30 }, fields: "pixelSize" } },
      ],
    },
  });
}

module.exports = {
  formatearHojaPrincipal,
  aplicarDesplegableEstado,
  formatearHojaPedidoImprimible,
};
