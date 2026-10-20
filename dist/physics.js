import { getDirectionalSupportRadius, getEffectiveCollisionRadius } from './objects.js?v=7';
             
             
               
             
                     
                   
             
                    

                                 
                      
                    
                    
 

                             
                                
                             
                  
                             
                                   
                               
 

/**
 * Creates a fresh centered cloth state covering the tabletop.
 */
export function createInitialClothState(config                  )             {
  return {
    present: true,
    offsetX: 0,
    offsetY: 0,
    prevOffsetX: 0,
    prevOffsetY: 0,
    vx: 0,
    vy: 0,
    accelMag: 0,
    jerkMag: 0,
    halfWidth: config.tableHalfWidth - 0.018,
    halfLength: config.tableHalfLength - 0.018,
    rethreadProgress: 1.0,
    rippleIntensity: 0
  };
}

/**
 * Computes the fraction [0, 1] of an object's base footprint that overlaps the cloth rectangle.
 * Uses a 9-point footprint quadrature (center + 8 perimeter points on the elliptical base)
 * blended with smooth edge distance so partial overlap transitions smoothly as the trailing
 * cloth edge passes underneath an object.
 */
export function computeClothFootprintOverlap(
  obj             ,
  cloth            
)         {
  if (!cloth.present) return 0;

  const minX = cloth.offsetX - cloth.halfWidth;
  const maxX = cloth.offsetX + cloth.halfWidth;
  const minY = cloth.offsetY - cloth.halfLength;
  const maxY = cloth.offsetY + cloth.halfLength;

  // Quick reject if object center is well outside cloth bounds
  const maxR = Math.max(obj.footprintRadiusX, obj.footprintRadiusY);
  if (
    obj.x + maxR < minX ||
    obj.x - maxR > maxX ||
    obj.y + maxR < minY ||
    obj.y - maxR > maxY
  ) {
    return 0;
  }

  // Quick accept if object footprint is completely inside cloth bounds
  if (
    obj.x - maxR >= minX &&
    obj.x + maxR <= maxX &&
    obj.y - maxR >= minY &&
    obj.y + maxR <= maxY
  ) {
    return 1;
  }

  // 9-point quadrature over the oriented elliptical base footprint
  const cosY = Math.cos(obj.yaw);
  const sinY = Math.sin(obj.yaw);
  let accum = 0;
  const totalWeight = 9;

  // Center point (weight 1)
  if (obj.x >= minX && obj.x <= maxX && obj.y >= minY && obj.y <= maxY) {
    accum += 1;
  }

  // 8 boundary points around the base ellipse
  const angles = [
    0,
    Math.PI * 0.25,
    Math.PI * 0.5,
    Math.PI * 0.75,
    Math.PI,
    Math.PI * 1.25,
    Math.PI * 1.5,
    Math.PI * 1.75
  ];

  const smoothBand = 0.012; // 12mm smooth edge transition
  for (let i = 0; i < angles.length; i++) {
    const a = angles[i];
    const lx = Math.cos(a) * obj.footprintRadiusX * 0.85;
    const ly = Math.sin(a) * obj.footprintRadiusY * 0.85;
    const px = obj.x + lx * cosY - ly * sinY;
    const py = obj.y + lx * sinY + ly * cosY;

    // Signed distance inside the cloth rectangle
    const dxIn = Math.min(px - minX, maxX - px);
    const dyIn = Math.min(py - minY, maxY - py);
    const signedInside = Math.min(dxIn, dyIn);

    if (signedInside >= smoothBand) {
      accum += 1;
    } else if (signedInside > -smoothBand) {
      accum += (signedInside + smoothBand) / (2 * smoothBand);
    }
  }

  return Math.max(0, Math.min(1, accum / totalWeight));
}

/**
 * Signed distance from a tabletop point (x, y) to the outer edge of the rounded-rectangle table.
 * Negative values mean inside the table; positive values mean outside (overhanging the edge).
 * Also returns the outward normal unit vector (nx, ny) pointing off the nearest table edge.
 */
export function computeTableEdgeSignedDistance(
  x        ,
  y        ,
  config                  
)                                                                      {
  const innerHalfW = Math.max(0.01, config.tableHalfWidth - config.tableCornerRadius);
  const innerHalfL = Math.max(0.01, config.tableHalfLength - config.tableCornerRadius);

  const absX = Math.abs(x);
  const absY = Math.abs(y);

  const qx = absX - innerHalfW;
  const qy = absY - innerHalfL;

  const outsideBoxX = Math.max(qx, 0);
  const outsideBoxY = Math.max(qy, 0);
  const outsideDist = Math.hypot(outsideBoxX, outsideBoxY);
  const insideDist = Math.min(Math.max(qx, qy), 0);
  const signedDistanceOutside = outsideDist + insideDist - config.tableCornerRadius;

  let nx = 0;
  let ny = 0;
  if (outsideDist > 1e-6) {
    nx = (Math.sign(x) * outsideBoxX) / outsideDist;
    ny = (Math.sign(y) * outsideBoxY) / outsideDist;
  } else if (qx > qy) {
    nx = Math.sign(x) || 1;
    ny = 0;
  } else {
    nx = 0;
    ny = Math.sign(y) || 1;
  }

  return { signedDistanceOutside, normalX: nx, normalY: ny };
}

/**
 * Advances the fixed-timestep physics simulation by one step `dt = config.fixedDt`.
 */
export function stepPhysics(
  objects               ,
  cloth            ,
  pullCmd                           ,
  pullElapsedSec        ,
  config                  
)             {
  const dt = config.fixedDt;
  const collisions                   = [];

  // Save previous positions/orientations for smooth render interpolation
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    obj.prevX = obj.x;
    obj.prevY = obj.y;
    obj.prevYaw = obj.yaw;
    obj.prevTiltX = obj.tiltX;
    obj.prevTiltY = obj.tiltY;
    obj.prevZ = obj.z;
  }
  cloth.prevOffsetX = cloth.offsetX;
  cloth.prevOffsetY = cloth.offsetY;

  // 1. Update cloth motion if a pull is active
  let clothFinishedExiting = !cloth.present;
  if (cloth.present && pullCmd) {
    const duration = Math.max(0.08, pullCmd.extractionDurationSec);
    const u = Math.min(1.2, pullElapsedSec / duration);

    // Smooth whip velocity profile: ramps up rapidly in the first 18% of extraction,
    // sustains peak extraction speed as it clears the table.
    const ramp = u < 0.18 ? Math.sin((u / 0.18) * (Math.PI * 0.5)) : 1.0;
    const speedNow = pullCmd.extractionSpeedMps * (0.35 + 0.65 * ramp);

    const prevVx = cloth.vx;
    const prevVy = cloth.vy;
    cloth.vx = pullCmd.dirX * speedNow;
    cloth.vy = pullCmd.dirY * speedNow;

    const ax = (cloth.vx - prevVx) / dt;
    const ay = (cloth.vy - prevVy) / dt;
    cloth.accelMag = Math.hypot(ax, ay);
    cloth.jerkMag = pullCmd.jerkMetric;
    cloth.rippleIntensity = Math.min(1, speedNow / 3.5);

    cloth.offsetX += cloth.vx * dt;
    cloth.offsetY += cloth.vy * dt;

    // Check if cloth has completely exited the tabletop
    const trailingEdgeY = cloth.offsetY - cloth.halfLength;
    const leadingSideX = Math.abs(cloth.offsetX) - cloth.halfWidth;
    if (trailingEdgeY > config.tableHalfLength + 0.04 || leadingSideX > config.tableHalfWidth + 0.04) {
      cloth.present = false;
      cloth.vx = 0;
      cloth.vy = 0;
      cloth.accelMag = 0;
      cloth.rippleIntensity = 0;
      clothFinishedExiting = true;
    }
  } else {
    cloth.vx = 0;
    cloth.vy = 0;
    cloth.accelMag = 0;
    cloth.rippleIntensity = 0;
  }

  // 2. Update each object's cloth contact, friction forces, tipping torque, and edge support
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];

    // Advance spawn arrival animation timer if active (visual only, does not move x/y)
    if (obj.spawnAnimProgress < 1) {
      obj.spawnAnimProgress = Math.min(1, obj.spawnAnimProgress + dt * 3.8);
    }

    // If object is already falling off the edge, integrate free-fall and outward topple
    if (obj.state === 'falling') {
      obj.vz -= config.gravity * dt;
      obj.z += obj.vz * dt;
      obj.x += obj.vx * dt;
      obj.y += obj.vy * dt;
      obj.tiltX += obj.tiltVelX * dt;
      obj.tiltY += obj.tiltVelY * dt;
      continue;
    }

    const prevOverlap = obj.clothOverlap;
    const overlap = computeClothFootprintOverlap(obj, cloth);
    obj.clothOverlap = overlap;

    // Compute contact acceleration from cloth friction (while overlapping cloth)
    let axCloth = 0;
    let ayCloth = 0;
    let hemBumpTorqueX = 0;
    let hemBumpTorqueY = 0;

    if (overlap > 0 && cloth.present) {
      const relVx = cloth.vx - obj.vx;
      const relVy = cloth.vy - obj.vy;
      const relSpeed = Math.hypot(relVx, relVy);

      if (relSpeed > 1e-5) {
        // Stribeck-inspired whip slip curve:
        // Slow pulls stay in high-coupling regime and drag objects strongly with the cloth.
        // Fast controlled pulls exceed breakaway speed so kinetic friction drops significantly.
        const whipRatio = Math.min(1, Math.max(0, (relSpeed - 0.85) / config.characteristicWhipSpeed));
        const smoothWhip = whipRatio * whipRatio * (3 - 2 * whipRatio);
        const slipReduction = 1 - config.highSpeedSlipReduction * smoothWhip;

        const muCloth = obj.clothFriction * config.clothFrictionScale * slipReduction;
        const maxClothAccel = muCloth * config.gravity * overlap;

        const dirRelX = relVx / relSpeed;
        const dirRelY = relVy / relSpeed;

        // Clamp acceleration so object never overshoots cloth velocity in a single step
        const neededAccel = relSpeed / dt;
        const appliedAccel = Math.min(maxClothAccel, neededAccel);

        axCloth = dirRelX * appliedAccel;
        ayCloth = dirRelY * appliedAccel;
      }

      // Trailing hem seam passage: as overlap crosses through the mid-zone (0.15 -> 0.85),
      // the woven hem seam imparts both a planar drag tug and a speed-dependent pitch impulse.
      // Pulling too slowly snags the hem; pulling in the Sweet Spot (2.2 - 3.85 m/s) glides cleanly;
      // yanking violently (> 3.92 m/s) on a loaded table snaps the hem upward against tall objects.
      if (prevOverlap > overlap && overlap > 0.15 && overlap < 0.85) {
        const clothSpeed = Math.hypot(cloth.vx, cloth.vy);
        const slowSnag = config.hemSeamImpulse / (0.65 + clothSpeed * 0.65);
        const loadCount = Math.max(0, objects.length - 1);
        const overSpeedExcess = Math.max(0, clothSpeed - 3.92);
        const overSpeedSnap =
          loadCount > 0 && obj.comHeight > 0.06
            ? overSpeedExcess * 0.18 * Math.min(2.2, 0.75 + loadCount * 0.45)
            : 0;
        const seamFactor = slowSnag + overSpeedSnap;
        const pullNorm = Math.max(0.001, clothSpeed);
        const pDirX = cloth.vx / pullNorm;
        const pDirY = cloth.vy / pullNorm;
        hemBumpTorqueX = pDirX * seamFactor * (obj.comHeight / 0.075);
        hemBumpTorqueY = pDirY * seamFactor * (obj.comHeight / 0.075);

        // Planar hem tug: high-coupling coasters (bowl, egg) catch the woven border as it exits
        const hemPlanarDv = Math.max(0, obj.clothFriction - 0.32) * 0.24;
        axCloth += (pDirX * hemPlanarDv) / dt;
        ayCloth += (pDirY * hemPlanarDv) / dt;
      }
    }

    // Compute bare-wood tabletop friction / rolling resistance only on the uncovered support share (1 - overlap)
    const woodContactShare = Math.max(0, 1 - overlap);
    let axWood = 0;
    let ayWood = 0;

    const speedOnTable = Math.hypot(obj.vx, obj.vy);
    if (speedOnTable > 1e-5 && woodContactShare > 0) {
      // Decompose velocity into object's local frame to model anisotropic rolling (for the Egg)
      const cosY = Math.cos(obj.yaw);
      const sinY = Math.sin(obj.yaw);
      const localVx = obj.vx * cosY + obj.vy * sinY;   // Along major axis
      const localVy = -obj.vx * sinY + obj.vy * cosY;  // Along minor (rolling) axis

      const baseWoodMu = obj.woodFriction * config.woodFrictionScale * woodContactShare;
      const majorMu = baseWoodMu;
      const minorMu = baseWoodMu * (1 - obj.anisotropicRollFactor);

      const shareMajor = Math.abs(localVx) / speedOnTable;
      const shareMinor = Math.abs(localVy) / speedOnTable;

      const maxDvMajor = majorMu * config.gravity * shareMajor * dt;
      const maxDvMinor = minorMu * config.gravity * shareMinor * dt;

      const dvMajor = -Math.sign(localVx) * Math.min(Math.abs(localVx), maxDvMajor);
      const dvMinor = -Math.sign(localVy) * Math.min(Math.abs(localVy), maxDvMinor);

      // Rotate velocity change back to world coordinates
      axWood = (dvMajor * cosY - dvMinor * sinY) / dt;
      ayWood = (dvMajor * sinY + dvMinor * cosY) / dt;

      // Anisotropic rolling also induces yaw alignment torque for the egg
      if (obj.anisotropicRollFactor > 0.1) {
        obj.yawRate += (-localVx * localVy * 18.0 - obj.yawRate * 3.5) * dt;
      } else {
        obj.yawRate *= Math.max(0, 1 - 5.0 * dt);
      }
    } else {
      obj.yawRate *= Math.max(0, 1 - 6.0 * dt);
    }

    // Total planar acceleration
    const totalAx = axCloth + axWood;
    const totalAy = ayCloth + ayWood;

    obj.vx += totalAx * dt;
    obj.vy += totalAy * dt;

    // Eliminate permanent creeping once cloth has passed and speed is below settle threshold
    const newSpeed = Math.hypot(obj.vx, obj.vy);
    if (overlap === 0 && newSpeed < config.settleLinearThreshold * 0.65) {
      obj.vx = 0;
      obj.vy = 0;
    }

    obj.x += obj.vx * dt;
    obj.y += obj.vy * dt;
    obj.yaw += obj.yawRate * dt;

    // 3. Tilt & Rocking Dynamics
    const tiltMag = Math.hypot(obj.tiltX, obj.tiltY);
    const supportR =
      tiltMag > 1e-4
        ? getDirectionalSupportRadius(obj, obj.tiltX / tiltMag, obj.tiltY / tiltMag)
        : Math.min(obj.footprintRadiusX, obj.footprintRadiusY);

    if (obj.state !== 'tipped') {
      // Contact acceleration at the bottom of the object creates a tipping torque.
      // Notice: tall narrow objects (Glass: comHeight=0.088, supportR=0.036) have much higher
      // geometric tipping sensitivity than wide low objects (Plate: comHeight=0.011, supportR=0.082).
      const geomSensitivity = obj.comHeight / Math.max(0.022, supportR * 0.68);

      // Jerk & angled-pull shear sensitivity: sudden uneven acceleration or crooked pull rocks tall objects
      let jerkExcitationX = 0;
      let jerkExcitationY = 0;
      if (overlap > 0 && cloth.present) {
        const tallnessFactor = Math.max(0, (obj.comHeight - 0.025) / 0.055);
        const clothSpeed = Math.hypot(cloth.vx, cloth.vy);
        if (clothSpeed > 0.05) {
          const pDirX = cloth.vx / clothSpeed;
          const pDirY = cloth.vy / clothSpeed;
          // Angled pulls add lateral shear excitation proportional to |pDirX|
          const angleShear = Math.abs(pDirX) * 0.35;
          const totalExcitation = (cloth.jerkMag + angleShear) * config.jerkTorqueFactor * tallnessFactor * overlap * 68.0;
          jerkExcitationX = pDirX * totalExcitation;
          jerkExcitationY = pDirY * totalExcitation;
        }
      }

      const driveAlphaX =
        (axCloth * 0.44 - axWood * 0.22) * geomSensitivity +
        jerkExcitationX +
        hemBumpTorqueX / dt;
      const driveAlphaY =
        (ayCloth * 0.44 - ayWood * 0.22) * geomSensitivity +
        jerkExcitationY +
        hemBumpTorqueY / dt;

      // Nonlinear restoring torque around the object's resting lean (restTiltX, restTiltY):
      // Positive restoring stiffness while |tilt| < criticalTiltRad,
      // vanishing at criticalTiltRad and becoming a toppling torque beyond it.
      const tiltRatio = tiltMag / obj.criticalTiltRad;
      if (tiltRatio > obj.peakTiltRatio) {
        obj.peakTiltRatio = tiltRatio;
      }

      const stabilityFactor = 1 - tiltRatio * tiltRatio;
      const kRestore = obj.restoringStiffness * config.stabilityScale * stabilityFactor;
      const restoreAlphaX = -kRestore * (obj.tiltX - obj.restTiltX);
      const restoreAlphaY = -kRestore * (obj.tiltY - obj.restTiltY);

      const damping = obj.tiltDamping * config.dampingScale;
      const dampAlphaX = -damping * obj.tiltVelX;
      const dampAlphaY = -damping * obj.tiltVelY;

      obj.tiltVelX += (driveAlphaX + restoreAlphaX + dampAlphaX) * dt;
      obj.tiltVelY += (driveAlphaY + restoreAlphaY + dampAlphaY) * dt;

      obj.tiltX += obj.tiltVelX * dt;
      obj.tiltY += obj.tiltVelY * dt;

      const updatedTiltMag = Math.hypot(obj.tiltX, obj.tiltY);
      const deltaFromRest = Math.hypot(obj.tiltX - obj.restTiltX, obj.tiltY - obj.restTiltY);

      if (updatedTiltMag >= obj.criticalTiltRad) {
        // Crossed the irreversible tipping threshold!
        obj.state = 'tipped';
        obj.failureReason = `${obj.label} tipped over!`;
        // Ensure outward angular velocity continues in the direction of the lean
        const nx = obj.tiltX / updatedTiltMag;
        const ny = obj.tiltY / updatedTiltMag;
        const outwardVel = obj.tiltVelX * nx + obj.tiltVelY * ny;
        if (outwardVel < 1.4) {
          obj.tiltVelX += nx * 1.6;
          obj.tiltVelY += ny * 1.6;
        }
      } else if (
        deltaFromRest > 0.022 ||
        Math.hypot(obj.tiltVelX, obj.tiltVelY) > config.settleAngularThreshold
      ) {
        obj.state = 'rocking';
      } else {
        obj.state = 'upright';
        if (overlap === 0 && deltaFromRest < 0.008 && Math.hypot(obj.tiltVelX, obj.tiltVelY) < 0.015) {
          obj.tiltX = obj.restTiltX;
          obj.tiltY = obj.restTiltY;
          obj.tiltVelX = 0;
          obj.tiltVelY = 0;
        }
      }
    } else {
      // Object is irreversibly tipped: gravity pulls it all the way onto its side (PI/2)
      const currentTilt = Math.max(1e-4, Math.hypot(obj.tiltX, obj.tiltY));
      const nx = obj.tiltX / currentTilt;
      const ny = obj.tiltY / currentTilt;
      const maxTipAngle = Math.PI * 0.48;

      if (currentTilt < maxTipAngle) {
        const toppleAccel = (config.gravity / Math.max(0.04, obj.comHeight)) * Math.sin(currentTilt) * 0.9;
        obj.tiltVelX += nx * toppleAccel * dt;
        obj.tiltVelY += ny * toppleAccel * dt;
        obj.tiltX += obj.tiltVelX * dt;
        obj.tiltY += obj.tiltVelY * dt;
      } else {
        obj.tiltX = nx * maxTipAngle;
        obj.tiltY = ny * maxTipAngle;
        obj.tiltVelX = 0;
        obj.tiltVelY = 0;
      }
    }

    // 4. Table Edge Support Check (Object-specific footprint threshold)
    // Project center of mass shift onto tabletop plane
    const comProjX = obj.x + Math.sin(obj.tiltX) * obj.comHeight * 0.72;
    const comProjY = obj.y + Math.sin(obj.tiltY) * obj.comHeight * 0.72;

    const edgeCheck = computeTableEdgeSignedDistance(comProjX, comProjY, config);
    const directionalFootR = getDirectionalSupportRadius(
      obj,
      edgeCheck.normalX,
      edgeCheck.normalY
    );
    // Maximum allowed overhang past the table edge before support becomes insufficient:
    // A wide plate/bowl has a different physical support threshold than a narrow glass.
    const maxAllowedOverhang = directionalFootR * (1 - obj.edgeSupportRadiusFactor);

    if (edgeCheck.signedDistanceOutside > maxAllowedOverhang) {
      obj.state = 'falling';
      obj.failureReason = `${obj.label} fell off the table edge!`;
      // Impart outward tipping & velocity off the edge
      obj.vx += edgeCheck.normalX * 0.35;
      obj.vy += edgeCheck.normalY * 0.35;
      obj.tiltVelX += edgeCheck.normalX * 4.2;
      obj.tiltVelY += edgeCheck.normalY * 4.2;
      obj.vz = -0.15;
    }
  }

  // 5. Pairwise Object-Object Collisions (bounded impulses, stable separation, tipping transfer)
  for (let i = 0; i < objects.length; i++) {
    const a = objects[i];
    if (a.state === 'falling') continue;

    for (let j = i + 1; j < objects.length; j++) {
      const b = objects[j];
      if (b.state === 'falling') continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);

      const rA = getEffectiveCollisionRadius(a);
      const rB = getEffectiveCollisionRadius(b);
      const minDist = rA + rB;

      if (dist < minDist) {
        const nx = dist > 1e-5 ? dx / dist : 1;
        const ny = dist > 1e-5 ? dy / dist : 0;
        const penetration = minDist - dist;

        // Positional correction weighted by inverse mass (prevents clipping without jitter)
        const invMassA = 1 / a.mass;
        const invMassB = 1 / b.mass;
        const totalInvMass = invMassA + invMassB;
        const slop = 0.0005;
        const corrMag = (Math.max(0, penetration - slop) / totalInvMass) * 0.8;

        a.x -= nx * corrMag * invMassA;
        a.y -= ny * corrMag * invMassA;
        b.x += nx * corrMag * invMassB;
        b.y += ny * corrMag * invMassB;

        // Relative velocity along collision normal
        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const velAlongNormal = rvx * nx + rvy * ny;

        if (velAlongNormal < 0) {
          const restitution = 0.45;
          let jImpulse = (-(1 + restitution) * velAlongNormal) / totalInvMass;
          // Bound maximum collision impulse to guarantee non-explosive behavior
          const maxImpulse = 0.85;
          jImpulse = Math.min(maxImpulse, jImpulse);

          const impulseX = jImpulse * nx;
          const impulseY = jImpulse * ny;

          a.vx -= impulseX * invMassA;
          a.vy -= impulseY * invMassA;
          b.vx += impulseX * invMassB;
          b.vy += impulseY * invMassB;

          const impactSpeed = Math.abs(velAlongNormal);
          if (impactSpeed > 0.04) {
            collisions.push({
              impactSpeed,
              typeA: a.type,
              typeB: b.type
            });
          }

          // Collision transfers a tipping impulse proportional to object height & fragility
          const fragilityA = a.comHeight > 0.06 ? 24.0 : 8.0;
          const fragilityB = b.comHeight > 0.06 ? 24.0 : 8.0;
          const tipScaleA = jImpulse * invMassA * (a.comHeight / 0.04) * fragilityA;
          const tipScaleB = jImpulse * invMassB * (b.comHeight / 0.04) * fragilityB;

          a.tiltVelX -= nx * tipScaleA;
          a.tiltVelY -= ny * tipScaleA;
          b.tiltVelX += nx * tipScaleB;
          b.tiltVelY += ny * tipScaleB;
        }
      }
    }
  }

  // 6. Evaluate global failure and settling status
  let failed = false;
  let failureCause               = 'none';
  let failedObject                     = null;
  let allObjectsSettled = !cloth.present;

  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (obj.state === 'falling') {
      failed = true;
      failureCause = 'fell_off_edge';
      failedObject = obj;
      break;
    }
    if (obj.state === 'tipped') {
      failed = true;
      failureCause = 'tipped_over';
      failedObject = obj;
      break;
    }

    const linSpeed = Math.hypot(obj.vx, obj.vy);
    const angSpeed = Math.hypot(obj.tiltVelX, obj.tiltVelY);
    const deltaFromRest = Math.hypot(obj.tiltX - obj.restTiltX, obj.tiltY - obj.restTiltY);

    if (
      linSpeed > config.settleLinearThreshold ||
      angSpeed > config.settleAngularThreshold ||
      deltaFromRest > 0.032
    ) {
      allObjectsSettled = false;
    }
  }

  return {
    clothFinishedExiting,
    allObjectsSettled,
    failed,
    failureCause,
    failedObject,
    collisions
  };
}


//# sourceURL=physics.ts