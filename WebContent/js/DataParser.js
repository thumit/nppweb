export class DataParser {
  static loadDefaultCSVFile(filePath, onComplete, onError) {
    fetch(filePath)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error status: ${response.status}`);
        }
        return response.text();
      })
      .then(csvText => {
        const parsed = DataParser.parseCSVText(csvText);
        if (onComplete) onComplete(parsed, 'gacc_matrix.csv');
      })
      .catch(error => {
        console.warn(`Could not automatically load ${filePath}:`, error);
        if (onError) onError(error);
      });
  }

  static parseCSVText(csvText) {
    const lines = csvText.split(/\r?\n/);
    const rows = [];

    for (let line of lines) {
      let trimmed = line.trim();
      if (!trimmed) continue;

      let cells = [];
      let inQuotes = false;
      let token = '';

      for (let i = 0; i < trimmed.length; i++) {
        let char = trimmed[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          cells.push(token.trim().replace(/^"|"$/g, ''));
          token = '';
        } else {
          token += char;
        }
      }
      cells.push(token.trim().replace(/^"|"$/g, ''));
      rows.push(cells);
    }

    return DataParser.processMatrixRows(rows);
  }

  static processMatrixRows(rows) {
    const parsedData = [];
    let currentResource = null;
    let activeDestHeaders = [];

    const validGACCs = ["AICC", "NWCC", "ONCC", "OSCC", "NRCC", "GBCC", "SWCC", "RMCC", "EACC", "SACC"];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const firstCell = String(row[0] || '').trim();
      const upperFirstCell = firstCell.toUpperCase();

      const gaccMatches = row.map(cell => String(cell || '').trim().toUpperCase())
                             .filter(cell => validGACCs.includes(cell));

      if (gaccMatches.length >= 3) {
        activeDestHeaders = row.map(cell => String(cell || '').trim().toUpperCase());

        if (firstCell && !validGACCs.includes(upperFirstCell)) {
          currentResource = firstCell;
        }
        continue;
      }

      if (firstCell && !validGACCs.includes(upperFirstCell) && gaccMatches.length === 0) {
        currentResource = firstCell;
        continue;
      }

      if (validGACCs.includes(upperFirstCell) && currentResource) {
        const origGACC = upperFirstCell;

        for (let j = 1; j < row.length; j++) {
          const destGACC = activeDestHeaders[j];
          const rawVal = row[j];

          if (destGACC && validGACCs.includes(destGACC)) {
            const cleanVal = String(rawVal).replace(/[^0-9.-]+/g, "");
            const numVal = parseFloat(cleanVal);

            if (!isNaN(numVal)) {
              parsedData.push({
                res: String(currentResource).trim(),
                orig: String(origGACC).trim().toUpperCase(),
                dest: String(destGACC).trim().toUpperCase(),
                val: numVal
              });
            }
          }
        }
      }
    }

    return parsedData;
  }
}