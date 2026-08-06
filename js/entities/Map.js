import * as THREE from 'three';

export default class Map {
  constructor(grid, blockSize = 4, groundY = 50) {
    this.grid = grid;
    this.blockSize = blockSize;
    this.groundY = groundY;

    this.collidableBlocks = [];
    this.stars = [];
    this.group = new THREE.Group();

    this._buildGridMap();
  }

  _buildGridMap() {
    const groundGeo = new THREE.BoxGeometry(this.blockSize, this.blockSize, this.blockSize);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x55aa55 });

    const questionGeo = new THREE.BoxGeometry(this.blockSize, this.blockSize, this.blockSize);
    const questionMat = new THREE.MeshStandardMaterial({ color: 0xf4b436 });

    const starGeo = new THREE.OctahedronGeometry(1.5);
    const starMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });

    this.grid.forEach((row, zIndex) => {
      row.forEach((cellType, xIndex) => {
        const posX = xIndex * this.blockSize;
        const posZ = zIndex * this.blockSize;

        // 1 = Terreno base
        if (cellType === 1) {
          const block = new THREE.Mesh(groundGeo, groundMat);
          block.position.set(posX, this.groundY - this.blockSize / 2, posZ);
          block.receiveShadow = true;
          this.group.add(block);
          this.collidableBlocks.push(block);
        }
        // 2 = Blocco sospeso
        else if (cellType === 2) {
          const block = new THREE.Mesh(questionGeo, questionMat);
          block.position.set(posX, this.groundY + 4, posZ);
          block.castShadow = true;
          this.group.add(block);
          this.collidableBlocks.push(block);
        }
        // 3 = Stella
        else if (cellType === 3) {
          const star = new THREE.Mesh(starGeo, starMat);
          star.position.set(posX, this.groundY + 3, posZ);
          this.group.add(star);
          this.stars.push(star);
        }
      });
    });
  }

  addToScene(scene) {
    scene.add(this.group);
  }

  update(player, onStarCollected) {
    if (!player) return;

    for (let i = this.stars.length - 1; i >= 0; i--) {
      const star = this.stars[i];
      star.rotation.y += 0.03;

      if (player.position.distanceTo(star.position) < 2.5) {
        this.group.remove(star);
        this.stars.splice(i, 1);
        if (onStarCollected) onStarCollected();
      }
    }
  }
}