export class Map3D {
  constructor(containerId, labelsContainerId) {
    this.container = document.getElementById(containerId);
    this.labelsContainer = document.getElementById(labelsContainerId);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050811);

    this.camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 1, 3000);
    this.camera.position.set(0, 380, 480);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;

    this.mapGroup = new THREE.Group();
    this.scene.add(this.mapGroup);

    this.projection = d3.geoAlbersUsa().translate([0, 0]).scale(980);
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.gaccMeshes = [];
    this.gaccLabels = [];
    this.gaccCentroids = {};
    this.selectedGaccGroup = null;

    // Store dynamic HTML HUD overlay instances for ALL GACCs mode
    this.centroidHuds = [];

    this.GACC_CONFIG = {
      "AICC": { name: "Alaska",              color: 0x1e293b, emissive: 0x090d16 },
      "NWCC": { name: "Northwest",           color: 0x0f5257, emissive: 0x031719 },
      "ONCC": { name: "Northern California", color: 0x1b4965, emissive: 0x081721 },
      "OSCC": { name: "Southern California", color: 0x2b593f, emissive: 0x0b1a11 },
      "GBCC": { name: "Great Basin",         color: 0x725114, emissive: 0x211704 },
      "NRCC": { name: "Northern Rockies",    color: 0x1d3557, emissive: 0x070e17 },
      "RMCC": { name: "Rocky Mountain",      color: 0x4a2e35, emissive: 0x170b0e },
      "SWCC": { name: "Southwest",           color: 0x7a3328, emissive: 0x210c09 },
      "SACC": { name: "Southern",            color: 0x495057, emissive: 0x111315 },
      "EACC": { name: "Eastern",             color: 0x2c3e50, emissive: 0x0a1118 }
    };

    this.fipsToAbbrev = {
      "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE",
      "12": "FL", "13": "GA", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS",
      "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
      "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ",
      "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR",
      "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
      "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY"
    };

    this.initLighting();
    window.addEventListener('resize', () => this.onWindowResize());
  }

  initLighting() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight.position.set(100, 300, 150);
    this.scene.add(dirLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.35);
    rimLight.position.set(-200, 150, -200);
    this.scene.add(rimLight);

    const gridHelper = new THREE.GridHelper(1600, 50, 0x1e293b, 0x0f172a);
    gridHelper.position.y = -0.5;
    this.scene.add(gridHelper);
  }

  loadMapData(onReadyCallback) {
    fetch('https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json')
      .then(res => res.json())
      .then(us => {
        const states = topojson.feature(us, us.objects.states);
        const gaccList = this.processGaccGeometries(states);
        this.drawMap(gaccList);
        if (onReadyCallback) onReadyCallback();
      });
  }

  sliceRingByLatitude(ring, splitLat, keepNorth) {
    const result = [];
    for (let i = 0; i < ring.length; i++) {
      const curr = ring[i];
      const next = ring[(i + 1) % ring.length];
      const currKeep = keepNorth ? (curr[1] >= splitLat) : (curr[1] <= splitLat);
      const nextKeep = keepNorth ? (next[1] >= splitLat) : (next[1] <= splitLat);

      if (currKeep) result.push(curr);

      if (currKeep !== nextKeep) {
        const t = (splitLat - curr[1]) / (next[1] - curr[1]);
        const intersectLon = curr[0] + t * (next[0] - curr[0]);
        result.push([intersectLon, splitLat]);
      }
    }
    return result;
  }

  sliceFeatureByLatitude(feature, splitLat, keepNorth) {
    const newFeature = JSON.parse(JSON.stringify(feature));
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    const newPolygons = [];

    polygons.forEach(polygon => {
      const newPolygon = [];
      polygon.forEach(ring => {
        const slicedRing = this.sliceRingByLatitude(ring, splitLat, keepNorth);
        if (slicedRing.length >= 3) newPolygon.push(slicedRing);
      });
      if (newPolygon.length > 0) newPolygons.push(newPolygon);
    });

    newFeature.geometry.type = 'MultiPolygon';
    newFeature.geometry.coordinates = newPolygons;
    return newFeature;
  }

  processGaccGeometries(statesGeojson) {
    const gaccBuckets = {
      "AICC": [], "NWCC": [], "ONCC": [], "OSCC": [], "GBCC": [],
      "NRCC": [], "RMCC": [], "SWCC": [], "SACC": [], "EACC": []
    };

    statesGeojson.features.forEach(feature => {
      const st = this.fipsToAbbrev[feature.id];
      if (!st) return;

      if (st === "AK") gaccBuckets["AICC"].push(feature);
      else if (st === "OR" || st === "WA") gaccBuckets["NWCC"].push(feature);
      else if (st === "MT" || st === "ND") gaccBuckets["NRCC"].push(feature);
      else if (st === "UT" || st === "NV") gaccBuckets["GBCC"].push(feature);
      else if (st === "CO" || st === "WY" || st === "SD" || st === "NE" || st === "KS") gaccBuckets["RMCC"].push(feature);
      else if (st === "NM" || st === "AZ") gaccBuckets["SWCC"].push(feature);
      else if (["TX", "OK", "AR", "LA", "MS", "AL", "GA", "FL", "SC", "NC", "TN", "KY", "VA"].includes(st)) gaccBuckets["SACC"].push(feature);
      else if (["MN", "WI", "IA", "MO", "IL", "IN", "MI", "OH", "WV", "MD", "DE", "PA", "NJ", "NY", "CT", "RI", "MA", "VT", "NH", "ME"].includes(st)) gaccBuckets["EACC"].push(feature);
      else if (st === "CA") {
        gaccBuckets["ONCC"].push(this.sliceFeatureByLatitude(feature, 37.1, true));
        gaccBuckets["OSCC"].push(this.sliceFeatureByLatitude(feature, 37.1, false));
      }
      else if (st === "ID") {
        gaccBuckets["NRCC"].push(this.sliceFeatureByLatitude(feature, 45.3, true));
        gaccBuckets["GBCC"].push(this.sliceFeatureByLatitude(feature, 45.3, false));
      }
    });

    return Object.keys(gaccBuckets).map(code => ({
      abbr: code,
      name: this.GACC_CONFIG[code].name,
      color: this.GACC_CONFIG[code].color,
      emissive: this.GACC_CONFIG[code].emissive,
      features: gaccBuckets[code]
    }));
  }

  drawMap(gaccList) {
    const stateLineMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.22
    });

    gaccList.forEach(gacc => {
      const gaccGroup = new THREE.Group();
      const fullDisplayName = `${gacc.name} (${gacc.abbr})`;
      gaccGroup.userData = { name: fullDisplayName, abbr: gacc.abbr, color: gacc.color, emissive: gacc.emissive };

      const gaccMaterial = new THREE.MeshPhongMaterial({
        color: gacc.color,
        emissive: gacc.emissive,
        specular: 0x444444,
        shininess: 15,
        flatShading: true
      });

      let centroidSum = new THREE.Vector3();
      let pointCount = 0;

      gacc.features.forEach(feature => {
        const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;

        polygons.forEach(polygon => {
          polygon.forEach(ring => {
            const shape = new THREE.Shape();
            let hasPoints = false;

            ring.forEach((coord) => {
              const projected = this.projection(coord);
              if (projected) {
                const x = projected[0];
                const y = projected[1]; 

                if (!hasPoints) {
                  shape.moveTo(x, y);
                  hasPoints = true;
                } else {
                  shape.lineTo(x, y);
                }

                centroidSum.add(new THREE.Vector3(x, 12, y));
                pointCount++;
              }
            });

            if (hasPoints && shape.curves.length > 2) {
              const extrudeSettings = {
                depth: 12,
                bevelEnabled: true,
                bevelSegments: 1,
                steps: 1,
                bevelSize: 0.15,
                bevelThickness: 0.15
              };

              try {
                const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
                geometry.rotateX(Math.PI / 2);

                const mesh = new THREE.Mesh(geometry, gaccMaterial.clone());
                mesh.userData = { parentGroup: gaccGroup, name: fullDisplayName };
                gaccGroup.add(mesh);
                this.gaccMeshes.push(mesh);

                const edges = new THREE.EdgesGeometry(geometry, 15);
                const stateLine = new THREE.LineSegments(edges, stateLineMaterial);
                gaccGroup.add(stateLine);
              } catch (e) {}
            }
          });
        });
      });

      this.mapGroup.add(gaccGroup);

      if (pointCount > 0) {
        const centerPos = centroidSum.divideScalar(pointCount);
        this.gaccCentroids[gacc.abbr] = centerPos.clone();

        const labelElem = document.createElement('div');
        labelElem.className = 'gacc-label';
        labelElem.innerText = fullDisplayName;
        this.labelsContainer.appendChild(labelElem);

        this.gaccLabels.push({
          element: labelElem,
          pos: centerPos,
          group: gaccGroup
        });
      }
    });

    const box = new THREE.Box3().setFromObject(this.mapGroup);
    const center = box.getCenter(new THREE.Vector3());
    this.mapGroup.position.x = -center.x;
    this.mapGroup.position.z = -center.z;

    Object.keys(this.gaccCentroids).forEach(code => {
      this.gaccCentroids[code].add(this.mapGroup.position);
    });
  }

  selectGacc(gaccGroup, onSelectCallback) {
    if (this.selectedGaccGroup && this.selectedGaccGroup !== gaccGroup) {
      this.deselectGacc();
    }

    this.selectedGaccGroup = gaccGroup;

    const baseColor = new THREE.Color(gaccGroup.userData.color);
    const deepColor = baseColor.clone().multiplyScalar(1.3);
    const deepEmissive = baseColor.clone().multiplyScalar(0.25);

    gaccGroup.children.forEach(child => {
      if (child.isMesh) {
        child.material.color.copy(deepColor);
        child.material.emissive.copy(deepEmissive);
      }
      if (child.isLineSegments) {
        child.material.color.setHex(0xffffff);
        child.material.opacity = 0.85;
      }
    });

    this.animateYPosition(gaccGroup, 14, 180);

    this.gaccLabels.forEach(item => {
      if (item.group === gaccGroup) {
        item.element.classList.add('selected');
      }
    });

    if (onSelectCallback) onSelectCallback(gaccGroup.userData.abbr);
  }

  deselectGacc(onDeselectCallback) {
    if (!this.selectedGaccGroup) return;

    const origColor = this.selectedGaccGroup.userData.color;
    const origEmissive = this.selectedGaccGroup.userData.emissive;

    this.selectedGaccGroup.children.forEach(child => {
      if (child.isMesh) {
        child.material.color.setHex(origColor);
        child.material.emissive.setHex(origEmissive);
      }
      if (child.isLineSegments) {
        child.material.color.setHex(0xffffff);
        child.material.opacity = 0.22;
      }
    });

    this.animateYPosition(this.selectedGaccGroup, 0, 180);

    this.gaccLabels.forEach(item => {
      item.element.classList.remove('selected');
    });

    this.selectedGaccGroup = null;
    if (onDeselectCallback) onDeselectCallback();
  }

  animateYPosition(target, targetY, duration) {
    const startY = target.position.y;
    const startTime = performance.now();

    const update = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);

      target.position.y = startY + (targetY - startY) * ease;

      if (progress < 1) requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
  }

  renderNationalCentroidHUDs(ranksData, resourceName = '') {
    this.clearCentroidHUDs();

    // Hide standard GACC text labels during ALL mode to prevent overlap
    this.gaccLabels.forEach(item => {
      item.element.style.display = 'none';
    });

    Object.keys(this.gaccCentroids).forEach(code => {
      const pos = this.gaccCentroids[code];
      const gaccName = this.GACC_CONFIG[code] ? this.GACC_CONFIG[code].name : code;

      const hudElem = document.createElement('div');
      hudElem.className = 'gacc-national-hud';
      hudElem.style.cssText = `
        position: absolute;
        transform: translate(-50%, -100%);
        background: rgba(10, 15, 30, 0.95);
        border: 1px solid rgba(56, 189, 248, 0.35);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7), 0 0 12px rgba(56, 189, 248, 0.12);
        border-radius: 8px;
        padding: 6px 8px;
        color: #f8fafc;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 0.68rem;
        pointer-events: none;
        z-index: 1000;
        width: 145px;
        backdrop-filter: blur(8px);
        transition: opacity 0.2s ease, transform 0.1s ease;
      `;

      const getMetricHTML = (label, dataObj, colorHex) => {
        if (!dataObj || !dataObj[code]) return '';
        const m = dataObj[code];
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 3px; padding-bottom: 3px; border-bottom: 1px solid rgba(255, 255, 255, 0.04);">
            <div style="display: flex; flex-direction: column; overflow: hidden;">
              <span style="color: #94a3b8; font-size: 0.55rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${label}</span>
              <span style="font-size: 0.68rem; font-weight: 600; color: #f8fafc; white-space: nowrap;">
                ${m.val.toLocaleString()} <span style="font-size: 0.58rem; font-weight: 400; color: #94a3b8;">(${m.pct})</span>
              </span>
            </div>
            <span style="font-weight: 700; color: ${colorHex}; background: ${colorHex}18; padding: 1px 4px; border-radius: 3px; border: 1px solid ${colorHex}40; font-size: 0.65rem; min-width: 20px; text-align: center; flex-shrink: 0;">
              #${m.rank}
            </span>
          </div>
        `;
      };

      // Extract supply and shortage values safely from ranksData or fallback to 0
      const supplyVal = (ranksData.supply && ranksData.supply[code] !== undefined) ? ranksData.supply[code] : (ranksData.supplyVal && ranksData.supplyVal[code] !== undefined ? ranksData.supplyVal[code] : 0);
      const shortageVal = (ranksData.shortage && ranksData.shortage[code] !== undefined) ? ranksData.shortage[code] : (ranksData.shortageVal && ranksData.shortageVal[code] !== undefined ? ranksData.shortageVal[code] : 0);
      
      const totalVal = supplyVal + shortageVal;
      const supplyPct = totalVal > 0 ? (supplyVal / totalVal) * 100 : 0;
      const shortagePct = totalVal > 0 ? (shortageVal / totalVal) * 100 : 0;

      const stackbarHTML = `
        <div style="margin-top: 5px; padding-top: 4px; border-top: 1px solid rgba(255, 255, 255, 0.08);">
          <div style="display: flex; justify-content: space-between; font-size: 0.55rem; color: #94a3b8; margin-bottom: 2px;">
            <span>Supply: <strong style="color: #10b981;">${supplyVal.toLocaleString()}</strong></span>
            <span>Shortage: <strong style="color: #ef4444;">${shortageVal.toLocaleString()}</strong></span>
          </div>
          <div style="display: flex; height: 6px; width: 100%; background: rgba(255, 255, 255, 0.06); border-radius: 3px; overflow: hidden;">
            <div style="width: ${supplyPct}%; background: #10b981; height: 100%; transition: width 0.3s ease;"></div>
            <div style="width: ${shortagePct}%; background: #ef4444; height: 100%; transition: width 0.3s ease;"></div>
          </div>
        </div>
      `;

      hudElem.innerHTML = `
        <div style="font-weight: 700; font-size: 0.68rem; color: #38bdf8; padding-bottom: 2px; display: flex; justify-content: space-between; align-items: center; white-space: nowrap;">
          <span style="overflow: hidden; text-overflow: ellipsis; margin-right: 4px;">${gaccName}</span>
          <span style="font-size: 0.6rem; background: rgba(56, 189, 248, 0.15); color: #38bdf8; padding: 1px 3px; border-radius: 3px; font-weight: 600; flex-shrink: 0;">${code}</span>
        </div>
        <div style="font-size: 0.6rem; color: #94a3b8; font-weight: 500; border-bottom: 1px solid rgba(255,255,255,0.12); padding-bottom: 4px; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${resourceName ? resourceName : 'All Resources'}
        </div>
        ${getMetricHTML('Staffing Level', ranksData.staffing, '#38bdf8')}
        ${getMetricHTML('Workload', ranksData.workload, '#f59e0b')}
        ${getMetricHTML('Local Use', ranksData.localUse, '#10b981')}
        ${getMetricHTML('Importation', ranksData.importation, '#8b5cf6')}
        ${getMetricHTML('Exportation', ranksData.exportation, '#ef4444')}
        ${stackbarHTML}
      `;

      this.labelsContainer.appendChild(hudElem);
      this.centroidHuds.push({
        element: hudElem,
        pos: pos
      });
    });
  }

  clearCentroidHUDs() {
    this.centroidHuds.forEach(hud => {
      if (hud.element && hud.element.parentNode) {
        hud.element.parentNode.removeChild(hud.element);
      }
    });
    this.centroidHuds = [];

    // Re-enable standard GACC text labels
    this.gaccLabels.forEach(item => {
      item.element.style.display = 'block';
    });
  }

  updateLabels() {
    const tempV = new THREE.Vector3();

    // 1. Update standard labels
    this.gaccLabels.forEach(item => {
      if (item.element.style.display === 'none') return;

      tempV.copy(item.pos);
      tempV.y += item.group.position.y;
      tempV.add(this.mapGroup.position);

      tempV.project(this.camera);

      if (tempV.z > 1) {
        item.element.style.opacity = '0';
        return;
      }

      const x = (tempV.x * 0.5 + 0.5) * window.innerWidth;
      const y = (tempV.y * -0.5 + 0.5) * window.innerHeight;

      item.element.style.left = `${x}px`;
      item.element.style.top = `${y}px`;
      item.element.style.opacity = '1';
    });

    // 2. Update National HUD position overlays
    this.centroidHuds.forEach(hud => {
      tempV.copy(hud.pos);
      tempV.y += 18; // Offset slightly above the map 3D surface
      tempV.project(this.camera);

      if (tempV.z > 1) {
        hud.element.style.opacity = '0';
        return;
      }

      const x = (tempV.x * 0.5 + 0.5) * window.innerWidth;
      const y = (tempV.y * -0.5 + 0.5) * window.innerHeight;

      hud.element.style.left = `${x}px`;
      hud.element.style.top = `${y}px`;
      hud.element.style.opacity = '1';
    });
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}