/**
 * GACCFlowOverlay.js
 * 3D Flow Engine for Three.js Executive GIS
 */

class GACCFlowOverlay {
  /**
   * @param {THREE.Scene} scene - Active Three.js scene instance
   * @param {THREE.Group} mapGroup - Map group containing extruded meshes
   * @param {Function} projection - D3 projection function used for map coordinates
   */
  constructor(scene, mapGroup, projection) {
    this.scene = scene;
    this.mapGroup = mapGroup;
    this.projection = projection;
    
    // Dedicated group for flow lines inside Three.js
    this.flowGroup = new THREE.Group();
    this.flowGroup.name = "FlowGroup";
    this.scene.add(this.flowGroup);

    // Approximate 3D positions for GACC centers based on projected coordinates
    this.gaccGeoCoords = {
      "AICC": [-150.0, 64.0],
      "NWCC": [-120.5, 45.5],
      "ONCC": [-121.5, 39.5],
      "OSCC": [-118.0, 35.0],
      "NRCC": [-111.0, 46.5],
      "GBCC": [-114.5, 40.5],
      "SWCC": [-108.0, 34.5],
      "RMCC": [-105.5, 39.0],
      "EACC": [-88.0, 42.5],
      "SACC": [-83.0, 32.5]
    };

    this.3dCentroids = {};
    this.calculateCentroids();
  }

  /**
   * Converts GeoJSON lat/long to Three.js world space coordinates
   */
  calculateCentroids() {
    Object.keys(this.gaccGeoCoords).forEach(code => {
      const geo = this.gaccGeoCoords[code];
      const proj = this.projection(geo);
      if (proj) {
        // Map 2D D3 projection to 3D X/Z plane (matching ExtrudeGeometry orientation)
        this.3dCentroids[code] = new THREE.Vector3(proj[0], 14, proj[1]);
      }
    });
  }

  /**
   * Renders 3D Quadratic Bézier arcs for selected movement flow parameters
   */
  renderFlows(data, focusGACC, resType, direction = 'outbound') {
    this.clear();

    const filtered = data.filter(d => d.res === resType);

    filtered.forEach(row => {
      if (row.orig === row.dest) return; // Skip internal/retained flows

      const isMatch = (direction === 'outbound')
        ? (row.orig === focusGACC)
        : (row.dest === focusGACC);

      if (isMatch && row.val > 0) {
        const start = this.3dCentroids[row.orig];
        const end = this.3dCentroids[row.dest];

        if (start && end) {
          this.draw3DArc(start, end, row.val, direction);
        }
      }
    });
  }

  /**
   * Builds a 3D curved TubeGeometry arc with dynamic height elevation
   */
  draw3DArc(start, end, value, direction) {
    // Offset target vector relative to map group centering
    const startVec = start.clone().add(this.mapGroup.position);
    const endVec = end.clone().add(this.mapGroup.position);

    // Calculate arc apex control point in 3D space
    const distance = startVec.distanceTo(endVec);
    const midPoint = new THREE.Vector3().addVectors(startVec, endVec).multiplyScalar(0.5);
    
    // Elevate middle point along Y axis proportional to distance
    midPoint.y += Math.min(distance * 0.35, 120);

    // Create 3D Quadratic Bézier Curve
    const curve = new THREE.QuadraticBezierCurve3(startVec, midPoint, endVec);

    // Scale line thickness by log volume
    const radius = Math.max(0.8, Math.min(3.5, Math.log2(value) * 0.5));
    const geometry = new THREE.TubeGeometry(curve, 32, radius, 8, false);

    const arcColor = (direction === 'outbound') ? 0xff9100 : 0x00e5ff;

    const material = new THREE.MeshPhongMaterial({
      color: arcColor,
      emissive: arcColor,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.85,
      shininess: 30
    });

    const arcMesh = new THREE.Mesh(geometry, material);
    this.flowGroup.add(arcMesh);
  }

  clear() {
    while (this.flowGroup.children.length > 0) {
      const obj = this.flowGroup.children[0];
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
      this.flowGroup.remove(obj);
    }
  }
}