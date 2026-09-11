import { Map3D } from './Map3D.js';
import { EmbeddedGACCFlowOverlay } from './FlowOverlay.js';
import { DataParser } from './DataParser.js';

class App {
  constructor() {
    this.movementMatrix = [];
    this.resourceLevels = [];
    this.selectedGaccPl = 5;
    this.selectedNatPl = 5;
    this.map = new Map3D('canvas-container', 'labels-container');
    this.flowOverlay = null;

    // Available scenario plan folders inside WebContent/data/
    this.availablePlans = [
      { name: 'Plan A', enabled: true },
      { name: 'Plan B', enabled: false },
      { name: 'Plan C', enabled: false },
      { name: 'Plan D', enabled: false }
    ];
    this.currentPlan = 'Plan A';

    this.initEventListeners();
    this.initNavigation();

    this.map.loadMapData(() => {
      this.flowOverlay = new EmbeddedGACCFlowOverlay(
        this.map.scene, 
        this.map.mapGroup, 
        this.map.gaccCentroids
      );

      // Populate scenario plan options and load default plan
      this.populatePlanDropdown();
      this.loadScenarioPlan(this.currentPlan);
    });

    this.animate();
  }

  initNavigation() {
    const tabMap = document.getElementById('tabMap');
    const tabAbout = document.getElementById('tabAbout');
    const aboutOverlay = document.getElementById('aboutOverlay');
    const closeAboutBtn = document.getElementById('closeAboutBtn');

    const showMap = () => {
      tabMap.classList.add('active');
      tabAbout.classList.remove('active');
      aboutOverlay.classList.remove('active');
    };

    const showAbout = () => {
      tabAbout.classList.add('active');
      tabMap.classList.remove('active');
      aboutOverlay.classList.add('active');
    };

    tabMap.addEventListener('click', showMap);
    tabAbout.addEventListener('click', showAbout);
    closeAboutBtn.addEventListener('click', showMap);
  }

  populatePlanDropdown() {
    const planSelect = document.getElementById('planSelect');
    if (!planSelect) return;

    planSelect.innerHTML = '';
    this.availablePlans.forEach(planObj => {
      const option = document.createElement('option');
      option.value = planObj.name;
      option.innerText = planObj.enabled ? planObj.name : `${planObj.name} (No Data)`;
      option.disabled = !planObj.enabled;
      
      if (planObj.name === this.currentPlan) {
        option.selected = true;
      }
      planSelect.appendChild(option);
    });
  }

  loadScenarioPlan(planFolder) {
    this.currentPlan = planFolder;
    const folderPath = `data/${planFolder}`;

    // Load primary GACC movement matrix CSV
    DataParser.loadDefaultCSVFile(
      `${folderPath}/gacc_matrix.csv`, 
      (data) => this.onDataLoaded(data),
      (err) => {
        console.error(`Failed to load matrix for ${planFolder}`, err);
      }
    );

    // Load preparedness resource level CSV
    DataParser.loadResourceLevelCSV(
      `${folderPath}/resourcelevel.csv`, 
      (resData) => {
        this.resourceLevels = resData;
        this.updateResourceFlowStream();
      }
    );
  }

  onDataLoaded(data) {
    if (data && data.length > 0) {
      this.movementMatrix = data;
      this.populateResourceDropdown();
      const resSelect = document.getElementById('resSelect');
      if (resSelect.options.length > 0) {
        resSelect.selectedIndex = 0;
      }
      this.updateFlows();
    }
  }

  populateResourceDropdown() {
    const resSelect = document.getElementById('resSelect');
    const uniqueResources = [...new Set(this.movementMatrix.map(item => String(item.res).trim()))].filter(Boolean);
    
    resSelect.innerHTML = '';
    uniqueResources.forEach(res => {
      const option = document.createElement('option');
      option.value = res;
      option.innerText = res;
      resSelect.appendChild(option);
    });
  }

  initEventListeners() {
    // Stop pointer events from leaking through the side panel to the 3D scene
    const panel = document.getElementById('gisPanel');
    if (panel) {
      panel.addEventListener('pointerdown', (e) => e.stopPropagation());
      panel.addEventListener('click', (e) => e.stopPropagation());
    }

    // Window click for picking GACCs in 3D scene
    window.addEventListener('pointerdown', (event) => {
      if (event.clientY < 52 || event.target.closest('#gisPanel') || event.target.closest('.top-navbar')) {
        return;
      }

      this.map.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      this.map.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

      this.map.raycaster.setFromCamera(this.map.mouse, this.map.camera);
      const intersects = this.map.raycaster.intersectObjects(this.map.gaccMeshes);

      if (intersects.length > 0) {
        const clickedMesh = intersects[0].object;
        const targetGroup = clickedMesh.userData.parentGroup;
        this.map.selectGacc(targetGroup, (abbr) => {
          document.getElementById('gaccSelect').value = abbr;
          this.updateFlows();
        });
      } else {
        this.map.deselectGacc(() => this.updateFlows());
      }
    });

    // Plan / Scenario dropdown selector listener
    const planSelect = document.getElementById('planSelect');
    if (planSelect) {
      planSelect.addEventListener('change', (e) => {
        this.loadScenarioPlan(e.target.value);
      });
    }

    // Control panel events
    document.getElementById('gaccSelect').addEventListener('change', () => {
      const code = document.getElementById('gaccSelect').value;
      const foundGroup = this.map.mapGroup.children.find(c => c.userData && c.userData.abbr === code);
      if (foundGroup) {
        this.map.selectGacc(foundGroup, () => this.updateFlows());
      } else {
        this.updateFlows();
      }
    });

    document.getElementById('resSelect').addEventListener('change', () => this.updateFlows());
    document.getElementById('dirSelect').addEventListener('change', () => this.updateFlows());

    // Event listener for GACC Preparedness Level (1-5)
    const gaccRow = document.getElementById('gaccPlRow');
    if (gaccRow) {
      gaccRow.addEventListener('click', (e) => {
        const btn = e.target.closest('.pl-btn') || e.target.closest('button');
        if (!btn) return;
        
        const plVal = btn.dataset.pl || btn.dataset.level || btn.innerText.trim();
        const parsedPl = parseInt(plVal, 10);

        if (!isNaN(parsedPl)) {
          gaccRow.querySelectorAll('.pl-btn, button').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.selectedGaccPl = parsedPl;
          this.updateResourceFlowStream();
        }
      });
    }

    // Event listener for National Preparedness Level (1-5)
    const natRow = document.getElementById('natPlRow');
    if (natRow) {
      natRow.addEventListener('click', (e) => {
        const btn = e.target.closest('.pl-btn') || e.target.closest('button');
        if (!btn) return;

        const plVal = btn.dataset.pl || btn.dataset.level || btn.innerText.trim();
        const parsedPl = parseInt(plVal, 10);

        if (!isNaN(parsedPl)) {
          natRow.querySelectorAll('.pl-btn, button').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.selectedNatPl = parsedPl;
          this.updateResourceFlowStream();
        }
      });
    }
  }

  updateResourceFlowStream() {
    const totalBadge = document.getElementById('sankeyTotalBadge');
    if (totalBadge) {
      totalBadge.style.display = 'none';
    }

    const focusGACC = (document.getElementById('gaccSelect').value || '').trim().toUpperCase();
    const selectedRes = (document.getElementById('resSelect').value || '').trim().toLowerCase();

    if (!this.resourceLevels || this.resourceLevels.length === 0 || !focusGACC) return;

    // Filter by Region
    const regionRows = this.resourceLevels.filter(r => {
      const reg = String(r.region || r.gacc || '').trim().toUpperCase();
      return reg === focusGACC;
    });

    if (regionRows.length === 0) return;

    // Find row matching selected GACC_PL and NAT_PL
    let matchedRecord = regionRows.find(r => {
      const gaccPl = parseInt(r.gacc_pl || r.gaccpl, 10);
      const natPl = parseInt(r.national_pl || r.natpl || r.nat_pl, 10);

      const matchesGacc = gaccPl === this.selectedGaccPl;
      const matchesNat = natPl === this.selectedNatPl;

      // Check resource match if crewtype exists
      const crew = String(r.crewtype || r.resource || '').trim().toLowerCase();
      let matchesCrew = true;
      if (selectedRes && crew) {
        const cleanSelected = selectedRes.replace(/[^a-z0-9]/g, '');
        const cleanCrew = crew.replace(/[^a-z0-9]/g, '');
        matchesCrew = cleanSelected.includes(cleanCrew) || cleanCrew.includes(cleanSelected);
      }

      return matchesGacc && matchesNat && matchesCrew;
    });

    // Fallback: match strictly on region + PL levels
    if (!matchedRecord) {
      matchedRecord = regionRows.find(r => {
        const gaccPl = parseInt(r.gacc_pl || r.gaccpl, 10);
        const natPl = parseInt(r.national_pl || r.natpl || r.nat_pl, 10);
        return gaccPl === this.selectedGaccPl && natPl === this.selectedNatPl;
      });
    }

    if (matchedRecord) {
      const drawndown = Number(matchedRecord.drawndown || matchedRecord.drawdown || 0);
      const outsource = Number(matchedRecord.outsource || matchedRecord.outsourced || 0);
      const staffing = Number(matchedRecord.staffing || (drawndown + outsource));

      document.getElementById('sankeyStaffingVal').innerText = Math.round(staffing).toLocaleString();
      document.getElementById('sankeyDrawdownVal').innerText = Math.round(drawndown).toLocaleString();
      document.getElementById('sankeyOutsourceVal').innerText = Math.round(outsource).toLocaleString();

      const drawPct = staffing > 0 ? (drawndown / staffing) * 100 : 0;
      const outPct = staffing > 0 ? (outsource / staffing) * 100 : 0;

      document.getElementById('barDrawdownFill').style.width = `${drawPct}%`;
      document.getElementById('barOutsourceFill').style.width = `${outPct}%`;
    }
  }

  updateFlows() {
    const rawRes = document.getElementById('resSelect').value || '';
    const rawFocus = document.getElementById('gaccSelect').value || '';
    const direction = document.getElementById('dirSelect').value;

    const resType = rawRes.trim().toLowerCase();
    const focusGACC = rawFocus.trim().toUpperCase();

    if (!resType || !focusGACC) return;

    if (this.flowOverlay) {
      this.flowOverlay.renderFlows(this.movementMatrix, focusGACC, rawRes, direction);
    }

    let localUse = 0, exportation = 0, importation = 0;

    this.movementMatrix.forEach(d => {
      const itemRes = String(d.res || '').trim().toLowerCase();
      const itemOrig = String(d.orig || '').trim().toUpperCase();
      const itemDest = String(d.dest || '').trim().toUpperCase();

      if (itemRes === resType) {
        if (itemOrig === focusGACC && itemDest === focusGACC) {
          localUse += d.val;
        }
        if (itemOrig === focusGACC && itemDest !== focusGACC) {
          exportation += d.val;
        }
        if (itemDest === focusGACC && itemOrig !== focusGACC) {
          importation += d.val;
        }
      }
    });

    document.getElementById('kpiLocalUse').innerText = Math.round(localUse).toLocaleString();
    document.getElementById('kpiExportation').innerText = Math.round(exportation).toLocaleString();
    document.getElementById('kpiImportation').innerText = Math.round(importation).toLocaleString();

    // Refresh capacity split UI
    this.updateResourceFlowStream();
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.map.controls.update();
    if (this.flowOverlay) this.flowOverlay.updateAnimations();
    this.map.updateLabels();
    this.map.renderer.render(this.map.scene, this.map.camera);
  }
}

// Start application
new App();