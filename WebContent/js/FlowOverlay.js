export class EmbeddedGACCFlowOverlay {
  constructor(scene, mapGroup, gaccCentroids) {
    this.scene = scene;
    this.mapGroup = mapGroup;
    this.centroids = gaccCentroids;
    this.flowGroup = new THREE.Group();
    this.scene.add(this.flowGroup);

    this.COLOR_LOCAL    = 0x38bdf8; // Cyan/Blue for Local Use
    this.COLOR_OUTBOUND = 0xfacc15; // Yellow for Exportation
    this.COLOR_INBOUND  = 0xff007f; // Magenta/Pink for Importation
    this.animatedParticles = [];
  }

  renderFlows(matrixData, focusGACC, selectedResource, directionMode) {
    this.clear();

    if (!matrixData || matrixData.length === 0) return;

    const filtered = matrixData.filter(d => 
      String(d.res).trim().toLowerCase() === String(selectedResource).trim().toLowerCase() &&
      d.val > 0
    );

    filtered.forEach(d => {
      const isLocal    = (d.orig === focusGACC && d.dest === focusGACC);
      const isOutbound = (d.orig === focusGACC && d.dest !== focusGACC);
      const isInbound  = (d.dest === focusGACC && d.orig !== focusGACC);

      let shouldRender = false;

      if (directionMode === 'all' && (isLocal || isOutbound || isInbound)) shouldRender = true;
      if (directionMode === 'local' && isLocal) shouldRender = true;
      if (directionMode === 'outbound' && isOutbound) shouldRender = true;
      if (directionMode === 'inbound' && isInbound) shouldRender = true;

      if (shouldRender) {
        const startPos = this.centroids[d.orig];
        const endPos   = this.centroids[d.dest];

        if (startPos && endPos) {
          if (isLocal) {
            this.drawSelfLoopArc(startPos, d.val, this.COLOR_LOCAL);
          } else {
            const lineColor = isOutbound ? this.COLOR_OUTBOUND : this.COLOR_INBOUND;
            this.drawCurvedFlowArc(startPos, endPos, d.val, lineColor);
          }
        }
      }
    });
  }

  drawSelfLoopArc(centerPos, val, hexColor) {
    const pCenter = centerPos.clone();
    pCenter.y += 14;

    // Build a teardrop/loop curve extending upward and back to the centroid
    const p1 = pCenter.clone().add(new THREE.Vector3(-15, 35, -15));
    const p2 = pCenter.clone().add(new THREE.Vector3(0, 65, 0));
    const p3 = pCenter.clone().add(new THREE.Vector3(15, 35, 15));

    const curve = new THREE.CubicBezierCurve3(pCenter, p1, p2, pCenter);

    const tubeRadius = Math.min(Math.max(Math.log10(val + 1) * 0.8, 0.8), 3.5);
    const geometry   = new THREE.TubeGeometry(curve, 32, tubeRadius, 6, false);
    
    const material = new THREE.MeshPhongMaterial({
      color: hexColor,
      emissive: hexColor,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.85,
      shininess: 30
    });

    const arcMesh = new THREE.Mesh(geometry, material);
    this.flowGroup.add(arcMesh);

    // Particle Animation
    const particleGeo = new THREE.SphereGeometry(tubeRadius * 1.5, 8, 8);
    const particleMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const particleMesh = new THREE.Mesh(particleGeo, particleMat);
    this.flowGroup.add(particleMesh);

    this.animatedParticles.push({
      mesh: particleMesh,
      curve: curve,
      progress: Math.random()
    });

    // Value Label Sprite at apex
    const labelSprite = this.createTextLabelSprite(val, hexColor);
    const labelPos = curve.getPoint(0.5);
    labelPos.y += tubeRadius + 6;
    labelSprite.position.copy(labelPos);
    this.flowGroup.add(labelSprite);
  }

  drawCurvedFlowArc(startPos, endPos, val, hexColor) {
    const pStart = startPos.clone();
    const pEnd   = endPos.clone();

    pStart.y += 14;
    pEnd.y   += 14;

    const distance = pStart.distanceTo(pEnd);
    const midPoint = new THREE.Vector3().addVectors(pStart, pEnd).multiplyScalar(0.5);

    const arcHeight = Math.min(Math.max(distance * 0.35, 30), 120);
    midPoint.y += arcHeight;

    const curve = new THREE.QuadraticBezierCurve3(pStart, midPoint, pEnd);

    const tubeRadius = Math.min(Math.max(Math.log10(val + 1) * 0.8, 0.8), 3.5);
    const geometry   = new THREE.TubeGeometry(curve, 32, tubeRadius, 6, false);
    
    const material = new THREE.MeshPhongMaterial({
      color: hexColor,
      emissive: hexColor,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.82,
      shininess: 30
    });

    const arcMesh = new THREE.Mesh(geometry, material);
    this.flowGroup.add(arcMesh);

    // Particle
    const particleGeo = new THREE.SphereGeometry(tubeRadius * 1.5, 8, 8);
    const particleMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const particleMesh = new THREE.Mesh(particleGeo, particleMat);
    this.flowGroup.add(particleMesh);

    this.animatedParticles.push({
      mesh: particleMesh,
      curve: curve,
      progress: Math.random()
    });

    // Flow Label Sprite
    const labelSprite = this.createTextLabelSprite(val, hexColor);
    const labelPos = curve.getPoint(0.5);
    labelPos.y += tubeRadius + 6;
    labelSprite.position.copy(labelPos);
    this.flowGroup.add(labelSprite);
  }

  createTextLabelSprite(val, hexColor) {
    const formattedVal = Math.round(val).toLocaleString();
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    const cssColor = '#' + new THREE.Color(hexColor).getHexString();

    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.strokeStyle = cssColor;
    ctx.lineWidth = 6;
    
    const x = 10, y = 20, w = 236, h = 88, r = 16;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'Bold 42px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(formattedVal, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    
    const spriteMaterial = new THREE.SpriteMaterial({ 
      map: texture, 
      transparent: true,
      depthTest: false
    });
    
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(32, 16, 1);
    return sprite;
  }

  updateAnimations() {
    this.animatedParticles.forEach(p => {
      p.progress += 0.008;
      if (p.progress > 1) p.progress = 0;
      const pos = p.curve.getPoint(p.progress);
      p.mesh.position.copy(pos);
    });
  }

  clear() {
    while (this.flowGroup.children.length > 0) {
      const obj = this.flowGroup.children[0];
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
      this.flowGroup.remove(obj);
    }
    this.animatedParticles = [];
  }
}