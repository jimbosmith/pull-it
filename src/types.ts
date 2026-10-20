/**
 * Core data types and interfaces for Pull It.
 * All physics quantities use logical world units (meters, kilograms, seconds, radians)
 * rather than screen pixels.
 */

export type GameState =
  | 'title'
  | 'ready'
  | 'gesture'
  | 'pulling'
  | 'settling'
  | 'adding_object'
  | 'paused'
  | 'game_over';

export type ObjectType = 'glass' | 'plate' | 'egg' | 'bowl';

export type ObjectStabilityState = 'upright' | 'rocking' | 'tipped' | 'falling';

export type FailureCause =
  | 'none'
  | 'tipped_over'
  | 'fell_off_edge'
  | 'table_full';

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Definition of an object archetype in logical tabletop meters.
 */
export interface ObjectArchetype {
  type: ObjectType;
  label: string;
  /** Base support radius in meters (along major/minor axes for egg, circular when radiusX === radiusY) */
  footprintRadiusX: number;
  footprintRadiusY: number;
  /** Visual outer radius at widest point (e.g. bowl rim or plate rim) in meters */
  visualRadiusX: number;
  visualRadiusY: number;
  /** Mass in kg */
  mass: number;
  /** Total visual height in meters */
  height: number;
  /** Height of center of mass above tabletop in meters */
  comHeight: number;
  /** Base critical tilt angle (radians) at which COM projects outside the base of support */
  criticalTiltRad: number;
  /** Contact friction coefficient against the cloth (dimensionless) */
  clothFriction: number;
  /** Contact friction / rolling resistance on bare wooden tabletop (dimensionless) */
  woodFriction: number;
  /** Anisotropic rolling factor: for egg, rolls much easier perpendicular to its long axis */
  anisotropicRollFactor: number;
  /** Restoring angular spring stiffness scale */
  restoringStiffness: number;
  /** Angular damping coefficient (1/s) */
  tiltDamping: number;
  /** Edge support threshold fraction of footprint radius that can overhang before tipping off */
  edgeSupportRadiusFactor: number;
}

/**
 * Live runtime state of an object on the table.
 */
export interface TableObject {
  id: number;
  type: ObjectType;
  label: string;
  /** Current tabletop position in world meters (table center = 0,0; +y is toward player/handle) */
  x: number;
  y: number;
  /** Previous physics step position for render interpolation */
  prevX: number;
  prevY: number;
  /** Linear velocity on tabletop plane (m/s) */
  vx: number;
  vy: number;
  /** Yaw orientation on the tabletop plane (radians) */
  yaw: number;
  prevYaw: number;
  /** Yaw angular velocity (rad/s) */
  yawRate: number;
  /** Footprint radii (m) */
  footprintRadiusX: number;
  footprintRadiusY: number;
  /** Collision / visual radii (m) */
  visualRadiusX: number;
  visualRadiusY: number;
  /** Mass (kg) */
  mass: number;
  /** Height and COM height (m) */
  height: number;
  comHeight: number;
  /** Critical tilt angle (rad) before tipping becomes irreversible */
  criticalTiltRad: number;
  /** Cloth & wood friction coefficients */
  clothFriction: number;
  woodFriction: number;
  /** Anisotropic rolling factor */
  anisotropicRollFactor: number;
  restoringStiffness: number;
  tiltDamping: number;
  edgeSupportRadiusFactor: number;
  /** 2D tilt vector (rx, ry) in radians representing lean direction and magnitude; |tilt| = hypot(tiltX, tiltY) */
  tiltX: number;
  tiltY: number;
  prevTiltX: number;
  prevTiltY: number;
  /** Tilt angular velocity (rad/s) along X and Y lean axes */
  tiltVelX: number;
  tiltVelY: number;
  /** Persistent resting lean angle (rad) accumulated from heavy rocking on prior pulls */
  restTiltX: number;
  restTiltY: number;
  /** Vertical elevation offset (m) for falling off table edge or spawn drop animation */
  z: number;
  prevZ: number;
  vz: number;
  /** Current stability state */
  state: ObjectStabilityState;
  /** Fraction [0, 1] of footprint currently overlapping the cloth */
  clothOverlap: number;
  /** Spawn animation timer [0, 1] for visual arrival squash/bounce without altering simulated tabletop (x,y) */
  spawnAnimProgress: number;
  /** Peak tilt ratio experienced during the current pull (for close-call praise) */
  peakTiltRatio: number;
  /** Reason this specific object failed, if any */
  failureReason?: string;
}

/**
 * State of the tablecloth on the tabletop.
 */
export interface ClothState {
  /** Whether the cloth is present on the table */
  present: boolean;
  /**
   * Displacement vector (meters) of the cloth from its initial centered pose.
   * As the player pulls downward (+y) and slightly sideways (+/-x), the trailing
   * top edge of the cloth retreats across the table.
   */
  offsetX: number;
  offsetY: number;
  prevOffsetX: number;
  prevOffsetY: number;
  /** Current cloth velocity vector in world meters/second */
  vx: number;
  vy: number;
  /** Current cloth acceleration magnitude (m/s^2) / jerk impulse indicator */
  accelMag: number;
  jerkMag: number;
  /** Half-width and half-length of cloth on the table (meters) */
  halfWidth: number;
  halfLength: number;
  /** Visual re-threading progress [0, 1] when sliding a fresh cloth underneath */
  rethreadProgress: number;
  /** Visual wave/ripple intensity during pull */
  rippleIntensity: number;
}

/**
 * A single raw pointer sample recorded during a gesture.
 */
export interface PointerSample {
  /** Normalized tabletop world coordinates (meters) */
  worldX: number;
  worldY: number;
  /** Screen pixel coordinates */
  screenX: number;
  screenY: number;
  /** High-resolution timestamp in milliseconds */
  timeMs: number;
}

/**
 * Derived physical parameters of a completed swipe gesture.
 * Deterministic and independent of rendering frame rate.
 */
export interface PullGestureCommand {
  /** Normalized direction unit vector (dirX, dirY), clamped to allowed cone */
  dirX: number;
  dirY: number;
  /** Angle in degrees from straight down (+Y axis), within [-35, +35] */
  angleDeg: number;
  /** Smoothed speed in normalized table lengths per second */
  normalizedSpeed: number;
  /** Mapped physical peak extraction speed in world meters/second */
  extractionSpeedMps: number;
  /** Peak acceleration magnitude (world m/s^2) derived from filtered samples */
  peakAccel: number;
  /** Jerk / unevenness metric [0, 1+] from filtered velocity changes */
  jerkMetric: number;
  /** Total stroke length in normalized table units */
  strokeLengthNorm: number;
  /** Total duration of the cloth extraction phase in seconds */
  extractionDurationSec: number;
  /** Raw recorded samples for deterministic replay */
  samples: PointerSample[];
}

/**
 * Tunable simulation constants with explicit units.
 */
export interface SimulationConfig {
  /** Fixed physics timestep in seconds (e.g. 1/120 = 0.008333s) */
  fixedDt: number;
  /** Maximum physics steps per render frame to cap catch-up after tab switch/lag */
  maxCatchUpSteps: number;
  /** Table half-width in meters (total width = 2 * tableHalfWidth) */
  tableHalfWidth: number;
  /** Table half-length in meters (total depth = 2 * tableHalfLength) */
  tableHalfLength: number;
  /** Corner rounding radius of the tabletop in meters */
  tableCornerRadius: number;
  /** Gravitational acceleration (m/s^2) */
  gravity: number;
  /** Global cloth friction multiplier (dimensionless tuning knob) */
  clothFrictionScale: number;
  /** Global bare-table wood friction multiplier (dimensionless tuning knob) */
  woodFrictionScale: number;
  /** Global object stability / restoring torque multiplier (dimensionless tuning knob) */
  stabilityScale: number;
  /** Global angular tilt damping multiplier (dimensionless tuning knob) */
  dampingScale: number;
  /** Stribeck kinetic friction drop factor at high relative slip speed */
  highSpeedSlipReduction: number;
  /** Speed (m/s) above which whip-pull kinetic drop saturates */
  characteristicWhipSpeed: number;
  /** Jerk-induced micro-snag torque factor (couples sudden uneven acceleration into tall objects) */
  jerkTorqueFactor: number;
  /** Trailing-hem seam impulse factor as the cloth hem passes under an object's footprint */
  hemSeamImpulse: number;
  /** Maximum settling time (seconds) before forcing resolution */
  maxSettleTimeSec: number;
  /** Linear velocity threshold (m/s) below which an object is considered settled */
  settleLinearThreshold: number;
  /** Angular velocity threshold (rad/s) below which an object is considered settled */
  settleAngularThreshold: number;
  /** Minimum swipe stroke in normalized table units required to trigger a pull (shorter cancels) */
  minSwipeStrokeNorm: number;
  /** Maximum allowed sideways pull angle in degrees from straight down (+Y) */
  maxPullAngleDeg: number;
  /** Minimum mapped cloth extraction speed (m/s) */
  minExtractionSpeedMps: number;
  /** Maximum mapped cloth extraction speed (m/s) */
  maxExtractionSpeedMps: number;
}

/**
 * Snapshot of an arrangement for deterministic replay in the developer panel.
 */
export interface ArrangementSnapshot {
  seed: number;
  score: number;
  objects: TableObject[];
}
