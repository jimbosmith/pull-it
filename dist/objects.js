import { OBJECT_ARCHETYPES } from './config.js?v=7';
                                          
                                                                            

let nextObjectId = 1;

export function resetObjectIdCounter()       {
  nextObjectId = 1;
}

/**
 * Instantiates a new TableObject at (x, y) with orientation yaw.
 */
export function createTableObject(
  type            ,
  x        ,
  y        ,
  yaw         = 0
)              {
  const arch = OBJECT_ARCHETYPES[type];
  return {
    id: nextObjectId++,
    type: arch.type,
    label: arch.label,
    x,
    y,
    prevX: x,
    prevY: y,
    vx: 0,
    vy: 0,
    yaw,
    prevYaw: yaw,
    yawRate: 0,
    footprintRadiusX: arch.footprintRadiusX,
    footprintRadiusY: arch.footprintRadiusY,
    visualRadiusX: arch.visualRadiusX,
    visualRadiusY: arch.visualRadiusY,
    mass: arch.mass,
    height: arch.height,
    comHeight: arch.comHeight,
    criticalTiltRad: arch.criticalTiltRad,
    clothFriction: arch.clothFriction,
    woodFriction: arch.woodFriction,
    anisotropicRollFactor: arch.anisotropicRollFactor,
    restoringStiffness: arch.restoringStiffness,
    tiltDamping: arch.tiltDamping,
    edgeSupportRadiusFactor: arch.edgeSupportRadiusFactor,
    tiltX: 0,
    tiltY: 0,
    prevTiltX: 0,
    prevTiltY: 0,
    tiltVelX: 0,
    tiltVelY: 0,
    restTiltX: 0,
    restTiltY: 0,
    z: 0,
    prevZ: 0,
    vz: 0,
    state: 'upright',
    clothOverlap: 1.0,
    spawnAnimProgress: 0.0,
    peakTiltRatio: 0.0
  };
}

/**
 * Deep-clones an array of TableObjects for deterministic snapshot/replay.
 */
export function cloneTableObjects(objects                        )                {
  return objects.map((o) => ({ ...o }));
}

/**
 * Determines the object type to spawn for a given round index (0 = initial object).
 * Begins with the glass near the center, introduces forgiving objects (plate, bowl)
 * before adding eggs and additional glasses.
 */
export function pickNextObjectType(roundIndex        , rng           )             {
  if (roundIndex === 0) return 'glass';
  if (roundIndex === 1) return 'bowl';
  if (roundIndex === 2) return 'plate';
  if (roundIndex === 3) return 'egg';

  // From round 4 onward, use a seeded progression that weights awkward / fragile mixes
  const pool               =
    roundIndex < 6
      ? ['glass', 'egg', 'bowl', 'plate']
      : ['glass', 'egg', 'bowl', 'glass', 'egg', 'plate'];
  return rng.pick(pool);
}

/**
 * Creates the initial Glass near the center of the table with a small seeded offset.
 */
export function createInitialGlass(rng           )              {
  const offsetX = rng.range(-0.018, 0.018);
  const offsetY = rng.range(-0.045, 0.015);
  const yaw = rng.range(-0.3, 0.3);
  const glass = createTableObject('glass', offsetX, offsetY, yaw);
  glass.spawnAnimProgress = 1.0; // Initial glass is already resting on the cloth
  return glass;
}

/**
 * Effective collision radius of an object in tabletop meters.
 */
export function getEffectiveCollisionRadius(obj                                                                                                )         {
  return Math.max(obj.visualRadiusX, obj.visualRadiusY, obj.footprintRadiusX, obj.footprintRadiusY);
}

/**
 * Effective base support radius of an object along a given direction unit vector (nx, ny).
 * Handles elliptical footprints (such as the egg) oriented at `obj.yaw`.
 */
export function getDirectionalSupportRadius(
  obj                                                                    ,
  dirX        ,
  dirY        
)         {
  const cosY = Math.cos(obj.yaw);
  const sinY = Math.sin(obj.yaw);
  // Project direction into object's local frame
  const localX = dirX * cosY + dirY * sinY;
  const localY = -dirX * sinY + dirY * cosY;
  return Math.hypot(localX * obj.footprintRadiusX, localY * obj.footprintRadiusY);
}

/**
 * Checks whether a candidate position (x, y) for `type` is safely supported inside
 * the cloth and table boundaries and does not overlap any existing object.
 */
export function isValidSpawnCandidate(
  type            ,
  x        ,
  y        ,
  existingObjects                        ,
  config                  ,
  extraClearanceMeters         = 0.018
)          {
  const arch = OBJECT_ARCHETYPES[type];
  const candidateRadius = Math.max(arch.visualRadiusX, arch.visualRadiusY);
  const supportRadius = Math.max(arch.footprintRadiusX, arch.footprintRadiusY);

  // Must sit comfortably within the cloth & table bounds (avoid spawning on the very edge)
  const safeHalfWidth = config.tableHalfWidth - supportRadius - 0.038;
  const safeHalfLength = config.tableHalfLength - supportRadius - 0.048;

  if (Math.abs(x) > safeHalfWidth || Math.abs(y) > safeHalfLength) {
    return false;
  }

  // Also check rounded corner inset
  const cornerInsetX = Math.max(0, Math.abs(x) - (safeHalfWidth - config.tableCornerRadius));
  const cornerInsetY = Math.max(0, Math.abs(y) - (safeHalfLength - config.tableCornerRadius));
  if (Math.hypot(cornerInsetX, cornerInsetY) > config.tableCornerRadius) {
    return false;
  }

  // Check against all surviving objects on the table
  for (const obj of existingObjects) {
    const otherRadius = getEffectiveCollisionRadius(obj);
    const minDist = candidateRadius + otherRadius + extraClearanceMeters;
    const dist = Math.hypot(x - obj.x, y - obj.y);
    if (dist < minDist) {
      return false;
    }
  }

  return true;
}

/**
 * Bounded placement search for spawning a new object in an unoccupied, supported spot.
 * Prioritizes tactical puzzle placements on Round 2+ so that a mindless 0-degree pull
 * creates a collision hazard whereas an aimed angled pull (+/- 22..35 deg) threads cleanly.
 * Returns { x, y, yaw } if a valid spot exists, or null if the table is full.
 */
export function findSafeSpawnPlacement(
  type            ,
  existingObjects                        ,
  config                  ,
  rng           ,
  roundIndex        
)                                               {
  const arch = OBJECT_ARCHETYPES[type];
  const candRadius = Math.max(arch.visualRadiusX, arch.visualRadiusY);
  const supportRadius = Math.max(arch.footprintRadiusX, arch.footprintRadiusY);
  const maxSpawnX = Math.max(0.02, config.tableHalfWidth - supportRadius - 0.042);
  const maxSpawnY = Math.max(0.02, config.tableHalfLength - supportRadius - 0.052);

  // Pass 0: Tactical puzzle placement (when existing objects are present)
  // Places fast-gliding objects (bowl, egg) upstream (-Y) at an offset angle (~24-32 deg) behind a glass,
  // or heavy anchor blockers (plate) downstream (+Y) at an offset angle in front of a glass/bowl.
  // Because of the 24-32 deg offset, a 0-degree straight pull causes their relative slide paths to clip,
  // whereas angling the pull 22-35 deg toward the open side steers their paths cleanly past each other.
  if (existingObjects.length > 0 && roundIndex >= 1) {
    const glasses = existingObjects.filter((o) => o.type === 'glass');
    const targets = glasses.length > 0 ? glasses : existingObjects;
    const primarySign = rng.next() < 0.5 ? 1 : -1;
    const sideSigns = [primarySign, -primarySign];
    const angleDegCandidates = [38, 42, 35, 46];

    // Fast-gliding / rolling items (bowl, egg) spawn UPSTREAM (-Y) of a glass so they chase it down-table
    // Heavy slow items (plate) spawn DOWNSTREAM (+Y) of a glass so the glass slides toward the plate blocker
    const spawnUpstream = type === 'bowl' || type === 'egg';

    for (const target of targets) {
      const targetR = getEffectiveCollisionRadius(target);
      const tacticalDist = candRadius + targetR + 0.020; // 20mm clearance (> 18mm minimum)

      for (const s of sideSigns) {
        for (const deg of angleDegCandidates) {
          const rad = (deg * Math.PI) / 180;
          const cx = target.x + s * tacticalDist * Math.sin(rad);
          const cy = spawnUpstream
            ? target.y - tacticalDist * Math.cos(rad)
            : target.y + tacticalDist * Math.cos(rad);

          if (isValidSpawnCandidate(type, cx, cy, existingObjects, config, 0.018)) {
            // Orient egg with its rolling (minor) axis roughly down-table so it rolls briskly
            const yaw =
              type === 'egg'
                ? rng.range(-0.22, 0.22)
                : rng.range(-Math.PI, Math.PI);
            return { x: cx, y: cy, yaw };
          }
        }
      }
    }
  }

  // Earlier rounds prefer slightly more central placements; later rounds explore wider area
  const spreadFactor = Math.min(1.0, 0.62 + roundIndex * 0.06);

  // Pass 1: 120 seeded stratified candidates with comfortable clearance (18mm)
  const maxRandomCandidates = 120;
  for (let i = 0; i < maxRandomCandidates; i++) {
    const expand = Math.min(1.0, spreadFactor + (i / maxRandomCandidates) * (1 - spreadFactor));
    const cx = rng.range(-maxSpawnX * expand, maxSpawnX * expand);
    const cy = rng.range(-maxSpawnY * expand, maxSpawnY * expand);

    if (isValidSpawnCandidate(type, cx, cy, existingObjects, config, 0.018)) {
      const yaw = type === 'egg' ? rng.range(-0.25, 0.25) : rng.range(-Math.PI, Math.PI);
      return { x: cx, y: cy, yaw };
    }
  }

  // Pass 2: Deterministic systematic grid scan (11 x 13 = 143 points) with 10mm clearance
  // Guarantees we find room if any physically reasonable gap exists on the table.
  const cols = 11;
  const rows = 13;
  const startOffset = rng.intRange(0, cols * rows - 1);
  const totalCells = cols * rows;

  for (let k = 0; k < totalCells; k++) {
    const cellIdx = (startOffset + k) % totalCells;
    const col = cellIdx % cols;
    const row = Math.floor(cellIdx / cols);
    const u = (col / (cols - 1)) * 2 - 1;
    const v = (row / (rows - 1)) * 2 - 1;
    const gx = u * maxSpawnX;
    const gy = v * maxSpawnY;

    if (isValidSpawnCandidate(type, gx, gy, existingObjects, config, 0.010)) {
      const yaw = type === 'egg' ? rng.range(-0.25, 0.25) : rng.range(-Math.PI, Math.PI);
      return { x: gx, y: gy, yaw };
    }
  }

  return null;
}


//# sourceURL=objects.ts