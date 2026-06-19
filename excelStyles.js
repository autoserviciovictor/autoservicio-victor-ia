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

async function obtenerSheetIdPorTitulo(sheets, spreadsheetId, titulo) {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });

  const hoja = (spreadsheet.data.sheets || []).find(
    (s) => s.properties.title === titulo
  );

  if (!hoja) {
    throw new Error(`No se encontró la hoja: ${titulo}`);
  }

  return hoja.properties.sheetId;
}

async function formatearHojaPrincipal(sheets, spreadsheetIdParam) {
  const spreadsheetId = obtenerSpreadsheetId(spreadsheetIdParam);
  const sheetId = await obtenerSheetIdPorTitulo(sheets, spreadsheetId, "Hoja 1");

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
          clearBasicFilter: { sheetId },
        },
        {
          setBasicFilter: {
            filter: {
              range: {
                sheetId,
                startRowIndex: 0,
                startColumnIndex: 0,
                endColumnIndex: 10,
              },
            },
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
                verticalAlignment: "MIDDLE",
                wrapStrategy: "WRAP",
              },
            },
            fields: "userEnteredFormat(verticalAlignment,wrapStrategy)",
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
            innerHorizontal: { style: "SOLID", width: 1, color: colorHex("#D9D9D9") },
            innerVertical: { style: "SOLID", width: 1, color: colorHex("#D9D9D9") },
          },
        },

        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 120 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 90 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 2, endIndex: 3 }, properties: { pixelSize: 180 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 3, endIndex: 4 }, properties: { pixelSize: 150 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 4, endIndex: 5 }, properties: { pixelSize: 120 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 5, endIndex: 6 }, properties: { pixelSize: 260 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 6, endIndex: 7 }, properties: { pixelSize: 150 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 7, endIndex: 8 }, properties: { pixelSize: 140 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 8, endIndex: 9 }, properties: { pixelSize: 140 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 9, endIndex: 10 }, properties: { pixelSize: 130 }, fields: "pixelSize" } },
      ],
    },
  });
}

async function aplicarDesplegableEstado(sheets, spreadsheetIdParam) {
  const spreadsheetId = obtenerSpreadsheetId(spreadsheetIdParam);
  const sheetId = await obtenerSheetIdPorTitulo(sheets, spreadsheetId, "Hoja 1");

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

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
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
                horizontalAlignment: "CENTER",
                verticalAlignment: "MIDDLE",
                textFormat: {
                  bold: true,
                  fontSize: 16,
                  foregroundColor: colorHex("#111111"),
                },
              },
            },
            fields: "userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat)",
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
                horizontalAlignment: "LEFT",
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
              startColumnIndex: 1,
              endColumnIndex: 2,
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
              startRowIndex: 12,
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
              startRowIndex: 12,
              startColumnIndex: 1,
              endColumnIndex: 2,
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
              startRowIndex: 12,
              startColumnIndex: 2,
              endColumnIndex: 3,
            },
            cell: {
              userEnteredFormat: {
                horizontalAlignment: "LEFT",
                verticalAlignment: "MIDDLE",
              },
            },
            fields: "userEnteredFormat(horizontalAlignment,verticalAlignment)",
          },
        },

        {
          updateBorders: {
            range: {
              sheetId,
              startRowIndex: 3,
              endRowIndex: 10,
              startColumnIndex: 0,
              endColumnIndex: 3,
            },
            top: { style: "SOLID", width: 1, color: colorHex("#999999") },
            bottom: { style: "SOLID", width: 1, color: colorHex("#999999") },
            left: { style: "SOLID", width: 1, color: colorHex("#999999") },
            right: { style: "SOLID", width: 1, color: colorHex("#999999") },
            innerHorizontal: { style: "SOLID", width: 1, color: colorHex("#D9D9D9") },
            innerVertical: { style: "SOLID", width: 1, color: colorHex("#D9D9D9") },
          },
        },

        {
          updateBorders: {
            range: {
              sheetId,
              startRowIndex: 11,
              startColumnIndex: 0,
              endColumnIndex: 3,
            },
            top: { style: "SOLID", width: 1, color: colorHex("#999999") },
            bottom: { style: "SOLID", width: 1, color: colorHex("#999999") },
            left: { style: "SOLID", width: 1, color: colorHex("#999999") },
            right: { style: "SOLID", width: 1, color: colorHex("#999999") },
            innerHorizontal: { style: "SOLID", width: 1, color: colorHex("#D9D9D9") },
            innerVertical: { style: "SOLID", width: 1, color: colorHex("#D9D9D9") },
          },
        },

        {
          updateDimensionProperties: {
            range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
            properties: { pixelSize: 90 },
            fields: "pixelSize",
          },
        },
        {
          updateDimensionProperties: {
            range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 },
            properties: { pixelSize: 130 },
            fields: "pixelSize",
          },
        },
        {
          updateDimensionProperties: {
            range: { sheetId, dimension: "COLUMNS", startIndex: 2, endIndex: 3 },
            properties: { pixelSize: 430 },
            fields: "pixelSize",
          },
        },
      ],
    },
  });
}

module.exports = {
  formatearHojaPrincipal,
  aplicarDesplegableEstado,
  formatearHojaPedidoImprimible,
};
