const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

async function formatearHojaPrincipal(sheets) {
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
                backgroundColor: { red: 0.85, green: 0.92, blue: 1 },
                textFormat: { bold: true },
                horizontalAlignment: "CENTER",
                verticalAlignment: "MIDDLE",
              },
            },
            fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
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
              endColumnIndex: 8,
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
              startColumnIndex: 8,
              endColumnIndex: 10,
            },
            cell: {
              userEnteredFormat: { horizontalAlignment: "CENTER" },
            },
            fields: "userEnteredFormat.horizontalAlignment",
          },
        },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 180 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 105 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 2, endIndex: 3 }, properties: { pixelSize: 150 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 3, endIndex: 4 }, properties: { pixelSize: 145 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 4, endIndex: 5 }, properties: { pixelSize: 135 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 5, endIndex: 6 }, properties: { pixelSize: 210 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 6, endIndex: 7 }, properties: { pixelSize: 150 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 7, endIndex: 8 }, properties: { pixelSize: 145 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 8, endIndex: 9 }, properties: { pixelSize: 130 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 9, endIndex: 10 }, properties: { pixelSize: 130 }, fields: "pixelSize" } },
      ],
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
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 3,
              endRowIndex: 10,
              startColumnIndex: 0,
              endColumnIndex: 1,
            },
            cell: {
              userEnteredFormat: { textFormat: { bold: true } },
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
              userEnteredFormat: { horizontalAlignment: "RIGHT" },
            },
            fields: "userEnteredFormat.horizontalAlignment",
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
              userEnteredFormat: { horizontalAlignment: "RIGHT" },
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
              userEnteredFormat: { horizontalAlignment: "LEFT" },
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
            properties: { pixelSize: 140 },
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
            properties: { pixelSize: 180 },
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


module.exports = {
  formatearHojaPrincipal,
  aplicarDesplegableEstado,
  formatearHojaPedidoImprimible,
};
