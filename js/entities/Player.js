import * as THREE from "three";
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";
import { enableShadows } from "../utils/shadows.js";

export default class Player {
  // A 'stats' object is used instead of fixed constants so EntityManager can
  // pass different values per character (see EntityManager.spawnPlayer).
  constructor(mesh, physicsEngine, stats = {}) {
    this.mesh = mesh;
    this.physicsEngine = physicsEngine;

    // Assign the movement stats, falling back to Mario's default values.
    this.moveSpeed = stats.moveSpeed || 11;
    this.jumpVelocity = stats.jumpVelocity || 18;
    this.control = stats.control || 0.8; // 1.0 = instant stop, lower values = slippery movement.

    this.sprintMultiplier = 1.5;

    this.body = null;
    this.canJump = false;
    this.radius = 1;

    enableShadows(this.mesh);
  }

  spawn(x, y, z) {
    if (!this.mesh) return;

    // 1. Three.js setup (visual mesh).
    this.mesh.position.set(x, y, z);

    // Store the model's base rotation offset, needed because the source
    // GLTF model isn't authored facing the same way as +Z.
    this.modelOffset = Math.PI / 2;
    this.mesh.rotation.y = this.modelOffset;

    // 2. cannon-es setup (physics body).
    const shape = new CANNON.Sphere(this.radius);

    // Raise the sphere's center by 'radius' so the model's origin, at the
    // character's feet (y = 0), touches the ground.
    this.body = new CANNON.Body({
      mass: 5,
      position: new CANNON.Vec3(x, y + this.radius, z),
      shape: shape,
      material: this.physicsEngine?.defaultMaterial,
      fixedRotation: true, // Prevents the character from tumbling/rolling.
    });

    // 3. Collision listener used to reset the jump flag on landing.
    const contactNormal = new CANNON.Vec3();
    const upAxis = new CANNON.Vec3(0, 1, 0);

    this.body.addEventListener("collide", (e) => {
      e.contact.ni.negate(contactNormal);

      // Only count it as "landing" if the contact normal points roughly
      // upward, i.e. the player is standing on top of something.
      if (contactNormal.dot(upAxis) > 0.5) {
        this.canJump = true;
      }
    });

    if (this.physicsEngine && this.physicsEngine.world) {
      this.physicsEngine.world.addBody(this.body);
    }
  }

  update(delta, input, ui, audio, camera) {
    if (!this.mesh || !this.body) return;

    const isSprinting =
      input.isPressed("shift") ||
      input.isPressed("shiftleft") ||
      input.isPressed("shiftright");
    const activeSpeed = isSprinting
      ? this.moveSpeed * this.sprintMultiplier
      : this.moveSpeed;

    // Stable horizontal camera angle, used to compute movement directions
    // relative to where the camera is currently looking.
    const camAngle =
      camera && camera.userData && camera.userData.cameraAngleX !== undefined
        ? camera.userData.cameraAngleX
        : 0;

    // Forward/right direction vectors derived from the camera angle.
    const camForwardX = -Math.sin(camAngle);
    const camForwardZ = -Math.cos(camAngle);

    const camRightX = Math.cos(camAngle);
    const camRightZ = -Math.sin(camAngle);

    let moveDirX = 0;
    let moveDirZ = 0;

    if (input.isPressed("w") || input.isPressed("arrowup")) {
      moveDirX += camForwardX;
      moveDirZ += camForwardZ;
    }
    if (input.isPressed("s") || input.isPressed("arrowdown")) {
      moveDirX -= camForwardX;
      moveDirZ -= camForwardZ;
    }
    if (input.isPressed("a") || input.isPressed("arrowleft")) {
      moveDirX -= camRightX;
      moveDirZ -= camRightZ;
    }
    if (input.isPressed("d") || input.isPressed("arrowright")) {
      moveDirX += camRightX;
      moveDirZ += camRightZ;
    }

    // Normalize so diagonal movement isn't faster than axis-aligned movement.
    const moveLen = Math.hypot(moveDirX, moveDirZ);
    if (moveLen > 0.0001) {
      moveDirX /= moveLen;
      moveDirZ /= moveLen;
    }

    const targetMoveX = moveDirX * activeSpeed;
    const targetMoveZ = moveDirZ * activeSpeed;

    // Ease the current velocity towards the target velocity; 'control'
    // determines how sharply the character accelerates/decelerates.
    this.body.velocity.x += (targetMoveX - this.body.velocity.x) * this.control;
    this.body.velocity.z += (targetMoveZ - this.body.velocity.z) * this.control;

    if (moveLen > 0.0001) {
      const targetRotation = Math.atan2(moveDirX, moveDirZ);
      this.currentFacingAngle = targetRotation;
      this.mesh.rotation.y = targetRotation + (this.modelOffset || 0);
    }

    if ((input.isPressed("space") || input.isPressed(" ")) && this.canJump) {
      this.body.velocity.y = this.jumpVelocity;
      this.canJump = false;

      if (audio && audio.playSFX) {
        audio.playSFX("jump");
      }
    }

    // Sync the visual mesh to the physics body, compensating for the
    // sphere-center offset applied in spawn().
    this.mesh.position.set(
      this.body.position.x,
      this.body.position.y - this.radius,
      this.body.position.z,
    );
  }

  get position() {
    return this.mesh ? this.mesh.position : new THREE.Vector3();
  }
}
