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

  static loadResourceLevelCSV(filePath, onComplete) {
    fetch(filePath)
      .then(res => res.text())
      .then(csvText => {
        const parsed = DataParser.parseResourceLevelCSV(csvText);
        if (onComplete) onComplete(parsed);
      })
      .catch(err => console.warn('resourcelevel.csv not found, skipping.', err));
  }

  static parseResourceLevelCSV(csvText) {
    const lines = csvText.split(/\r?\n/);
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const records = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const cols = line.split(',').map(c => c.trim());
      if (cols.length < headers.length) continue;

      records.push({
        crewtype: cols[0],
        region: cols[1].toUpperCase(),
        gacc_pl: parseInt(cols[2], 10),
        national_pl: parseInt(cols[3], 10),
        drawndown: parseFloat(cols[4]) || 0,
        outsource: parseFloat(cols[5]) || 0,
        staffing: parseFloat(cols[6]) || 0
      });
    }
    return records;
  }

  static loadDemandCSVFile(filePath, onComplete, onError) {
    fetch(filePath)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error status: ${response.status}`);
        }
        return response.text();
      })
      .then(csvText => {
        const parsed = DataParser.parseDemandCSVText(csvText);
        if (onComplete) onComplete(parsed, filePath);
      })
      .catch(error => {
        console.warn(`Could not automatically load demand file ${filePath}:`, error);
        if (onError) onError(error);
      });
  }

  static parseDemandCSVText(csvText) {
    const lines = csvText.split(/\r?\n/);
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const records = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const cols = line.split(',').map(c => c.trim());
      if (cols.length < headers.length) continue;

      records.push({
        resource: cols[0],            
        gacc: cols.length > 1 ? cols[1].toUpperCase() : '',      
        demand: parseFloat(cols[2]) || 0,                        
        shortage: parseFloat(cols[3]) || 0,                        
        supply: parseFloat(cols[4]) || 0                       
      });
    }
    return records;
  }

  // --- Newly Migrated Calculation Helpers ---

  static calculateNationalResourceFlows(resourceLevels, movementMatrix, resType, selectedGaccPl, selectedNatPl, knownGaccCodes) {
    let natDrawdown = 0;
    let natOutsource = 0;
    let natStaffing = 0;
    let natLocal = 0;
    let natExport = 0;
    let natImport = 0;

    const gaccStats = {};
    knownGaccCodes.forEach(code => {
      gaccStats[code] = { local: 0, export: 0, import: 0, staffing: 0 };
    });

    // 1. Accumulate movement matrix stats
    movementMatrix.forEach(d => {
      const itemRes = String(d.res || '').trim().toLowerCase();
      if (itemRes === resType.toLowerCase()) {
        const orig = String(d.orig || '').trim().toUpperCase();
        const dest = String(d.dest || '').trim().toUpperCase();
        const val = Number(d.val) || 0;

        if (!gaccStats[orig]) gaccStats[orig] = { local: 0, export: 0, import: 0, staffing: 0 };
        if (!gaccStats[dest]) gaccStats[dest] = { local: 0, export: 0, import: 0, staffing: 0 };

        if (orig === dest) {
          natLocal += val;
          gaccStats[orig].local += val;
        } else {
          natExport += val;
          natImport += val;
          gaccStats[orig].export += val;
          gaccStats[dest].import += val;
        }
      }
    });

    // 2. Accumulate regional resource levels/staffing
    Object.keys(gaccStats).forEach(gaccCode => {
      const match = resourceLevels.find(r => {
        const reg = String(r.region || r.gacc || '').trim().toUpperCase();
        const gaccPl = parseInt(r.gacc_pl || r.gaccpl, 10);
        const natPl = parseInt(r.national_pl || r.natpl || r.nat_pl, 10);
        const crew = String(r.crewtype || r.resource || '').trim().toLowerCase();
        
        let matchesCrew = true;
        if (resType && crew) {
          const cleanSelected = resType.toLowerCase().replace(/[^a-z0-9]/g, '');
          const cleanCrew = crew.replace(/[^a-z0-9]/g, '');
          matchesCrew = (cleanSelected === cleanCrew);
        }

        return reg === gaccCode && gaccPl === selectedGaccPl && natPl === selectedNatPl && matchesCrew;
      });

      const staffVal = match ? Number(match.staffing || 0) : 0;
      const drawVal = match ? Number(match.drawndown || match.drawdown || 0) : 0;
      const outVal = match ? Number(match.outsource || match.outsourced || 0) : 0;

      gaccStats[gaccCode].staffing = staffVal;
      natStaffing += staffVal;
      natDrawdown += drawVal;
      natOutsource += outVal;
    });

    return { natDrawdown, natOutsource, natStaffing, natLocal, natExport, natImport, gaccStats };
  }

  static computeRankings(gaccStats, getter) {
    const list = Object.keys(gaccStats).map(gacc => ({
      gacc,
      val: Math.round(getter(gaccStats[gacc]))
    })).sort((a, b) => b.val - a.val);

    const result = {};
    const total = list.reduce((sum, item) => sum + item.val, 0);

    let currentRank = 1;
    list.forEach((item, index) => {
      if (index > 0 && item.val < list[index - 1].val) {
        currentRank = index + 1;
      }
      result[item.gacc] = {
        val: item.val,
        rank: currentRank,
        pct: total > 0 ? ((item.val / total) * 100).toFixed(1) + '%' : '0.0%'
      };
    });
    return result;
  }

  static processDemandAggregates(demandRecords, resType, targetGacc = null) {
    const supplyObj = {};
    const shortageObj = {};
    let totalDemand = 0;
    let totalSupply = 0;
    let totalShortage = 0;

    const normalizedResType = resType.toLowerCase().replace(/[\s_]+/g, ' ');

    demandRecords.forEach(d => {
      const itemRes = String(d.resource || '').trim().toLowerCase(); 
      const normalizedItemRes = itemRes.replace(/[\s_]+/g, ' ');

      if (normalizedItemRes === normalizedResType) {
        const gacc = String(d.gacc || '').trim().toUpperCase();
        
        if (!targetGacc || gacc === targetGacc) {
          const demand = Number(d.demand) || 0;
          const unmet = Number(d.shortage) || 0;
          const supplied = Number(d.supply) || Math.max(0, demand - unmet);

          supplyObj[gacc] = (supplyObj[gacc] || 0) + Math.round(supplied);
          shortageObj[gacc] = (shortageObj[gacc] || 0) + Math.round(unmet);

          totalDemand += demand;
          totalSupply += supplied;
          totalShortage += unmet;
        }
      }
    });

    return { supplyObj, shortageObj, totalDemand, totalSupply, totalShortage };
  }
}