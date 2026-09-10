import { Map3D } from './Map3D.js';
import { EmbeddedGACCFlowOverlay } from './FlowOverlay.js';
import { DataParser } from './DataParser.js';

class App {
  constructor() {
    this.movementMatrix = [];
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

      // Auto load CSV on launch
      DataParser.loadDefaultCSVFile(
        'data/gacc_matrix.csv', 
        (data, fileName) => this.onDataLoaded(data, fileName),
        (err) => {
          document.getElementById('fileStatusLabel').innerText = '⚠️ Load CSV File';
        }
      );
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
        // Clear label showing current file and indicating it can be clicked again
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
    // Window click for picking GACCs
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

    // File input event
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