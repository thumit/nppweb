import { Map3D } from './Map3D.js';
import { EmbeddedGACCFlowOverlay } from './FlowOverlay.js';
import { DataParser } from './DataParser.js';

class App {
  constructor() {
    this.movementMatrix = [];
    this.resourceLevels = [];
    this.map = new Map3D('canvas-container', 'labels-container');
    this.flowOverlay = null;

    this.initEventListeners();
    this.initNavigation();

    this.map.loadMapData(() => {
      this.flowOverlay = new EmbeddedGACCFlowOverlay(
        this.map.scene, 
        this.map.mapGroup, 
        this.map.gaccCentroids
      );

      // Auto load primary CSV matrix on launch
      DataParser.loadDefaultCSVFile(
        'data/gacc_matrix.csv', 
        (data, fileName) => this.onDataLoaded(data, fileName),
        (err) => {
          document.getElementById('fileStatusLabel').innerText = '⚠️ Load CSV File';
        }
      );

      // Auto load preparedness capacity split data
      DataParser.loadResourceLevelCSV('data/resourcelevel.csv', (resData) => {
        this.resourceLevels = resData;
        this.updateResourceFlowStream();
      });
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

  onDataLoaded(data, fileName) {
    if (data && data.length > 0) {
      this.movementMatrix = data;
      if (fileName) {
        document.getElementById('fileStatusLabel').innerText = `🔄 Change CSV (Active: ${fileName})`;
      } else {
        document.getElementById('fileStatusLabel').innerText = `🔄 Change CSV File`;
      }
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
    // Window click for picking GACCs in 3D scene
    window.addEventListener('pointerdown', (event) => {
      if (event.clientY < 52) return; // Ignore navbar clicks
      if (event.clientX > window.innerWidth - 330 && event.clientY < 390) return; // Ignore panel clicks

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

    // Custom CSV file loader
    document.getElementById('fileInput').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt) => {
        const parsed = DataParser.parseCSVText(evt.target.result);
        this.onDataLoaded(parsed, file.name);
      };
      reader.readAsText(file);
    });
  }

  updateResourceFlowStream() {
    const focusGACC = (document.getElementById('gaccSelect').value || '').trim().toUpperCase();
    const rawRes = (document.getElementById('resSelect').value || '').trim().toLowerCase();

    if (!this.resourceLevels || this.resourceLevels.length === 0 || !focusGACC) return;

    // Match region and crew/resource type
    const matches = this.resourceLevels.filter(r => 
      r.region === focusGACC && 
      (rawRes === '' || r.crewtype.toLowerCase().includes(rawRes) || rawRes.includes(r.crewtype.toLowerCase()))
    );

    const record = matches.length > 0 ? matches[0] : this.resourceLevels.find(r => r.region === focusGACC);

    if (record) {
      const staffing = record.staffing || (record.drawndown + record.outsource);
      const drawndown = record.drawndown;
      const outsource = record.outsource;

      document.getElementById('sankeyTotalBadge').innerText = `TOTAL: ${staffing}`;
      document.getElementById('sankeyStaffingVal').innerText = Math.round(staffing).toLocaleString();
      document.getElementById('sankeyDrawdownVal').innerText = Math.round(drawndown).toLocaleString();
      document.getElementById('sankeyOutsourceVal').innerText = Math.round(outsource).toLocaleString();

      const drawPct = staffing > 0 ? (drawndown / staffing) * 100 : 50;
      const outPct = staffing > 0 ? (outsource / staffing) * 100 : 50;

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