import type { ObjectArchetype, ObjectType, SimulationConfig } from './types.ts';

/**
 * Default simulation constants.
 * Units:
 * - Distances: meters (m)
 * - Velocities: meters per second (m/s)
 * - Accelerations: meters per second squared (m/s^2)
 * - Angles: radians (rad) or degrees (deg) where explicitly suffixed
 * - Masses: kilograms (kg)
 * - Time: seconds (s)
 */
export const DEFAULT_SIM_CONFIG: SimulationConfig = {
  fixedDt: 1 / 120,               // 120 Hz fixed physics step (0.008333 s)
  maxCatchUpSteps: 10,            // Max 10 steps (~83ms) catch-up to avoid spiral of death
  tableHalfWidth: 0.36,           // 0.72m total table width
  tableHalfLength: 0.44,          // 0.88m total table depth
  tableCornerRadius: 0.045,       // 4.5cm rounded wooden corners
  gravity: 9.81,                  // Standard gravity (m/s^2)
  clothFrictionScale: 1.0,        // Global multiplier for cloth-to-object friction
  woodFrictionScale: 1.0,         // Global multiplier for bare tabletop friction
  stabilityScale: 1.0,            // Global multiplier for restoring torque
  dampingScale: 1.0,              // Global multiplier for angular tilt damping
  highSpeedSlipReduction: 0.50,   // At fast whip speeds, effective kinetic drag drops by 50%
  characteristicWhipSpeed: 2.35,  // Cloth speed (m/s) where dynamic whip slip breakaway saturates
  jerkTorqueFactor: 0.09,         // Sensitivity of tall objects to sudden uneven jerk during pull
  hemSeamImpulse: 0.09,           // Impulse when the trailing cloth hem passes under an object
  maxSettleTimeSec: 3.2,          // Max seconds to wait in 'settling' before resolving round
  settleLinearThreshold: 0.008,   // 8 mm/s linear velocity threshold for settling
  settleAngularThreshold: 0.025,  // 0.025 rad/s angular velocity threshold for settling
  minSwipeStrokeNorm: 0.12,       // Swipes shorter than 12% of play ref cancel as accidental taps
  maxPullAngleDeg: 35,            // Allowed pull angle: +/- 35 degrees from straight down (+Y)
  minExtractionSpeedMps: 1.45,    // Slowest cloth drag speed (m/s)
  maxExtractionSpeedMps: 4.8      // Fastest cloth whip speed (m/s)
};

/**
 * Distinct object archetypes on the tabletop.
 * Note the distinct friction profiles:
 * - Plate: heavy & high wood friction (stops quickly, acts as a blocker obstacle)
 * - Glass: tall, narrow, fragile (tips easily on collision or over-yank)
 * - Bowl: medium base, glazed foot slides farther than glass/plate
 * - Egg: light ellipsoid that rolls a long distance along its minor axis
 */
export const OBJECT_ARCHETYPES: Record<ObjectType, ObjectArchetype> = {
  glass: {
    type: 'glass',
    label: 'Stemless Glass',
    footprintRadiusX: 0.036,
    footprintRadiusY: 0.036,
    visualRadiusX: 0.041,
    visualRadiusY: 0.041,
    mass: 0.22,
    height: 0.165,
    comHeight: 0.088,
    criticalTiltRad: 0.33,        // ~19 deg: tall & narrow, tips readily on collision or bad pull
    clothFriction: 0.36,
    woodFriction: 0.52,           // Moderate braking on wood (~2.5cm slide on fast pull)
    anisotropicRollFactor: 0.0,
    restoringStiffness: 23.5,
    tiltDamping: 3.9,
    edgeSupportRadiusFactor: 0.72 // Needs most of its narrow base on the table
  },
  plate: {
    type: 'plate',
    label: 'Ceramic Plate',
    footprintRadiusX: 0.082,
    footprintRadiusY: 0.082,
    visualRadiusX: 0.096,
    visualRadiusY: 0.096,
    mass: 0.52,
    height: 0.024,
    comHeight: 0.011,
    criticalTiltRad: 0.82,        // ~47 deg: very stable against tipping, acts as a wide blocker
    clothFriction: 0.15,
    woodFriction: 0.78,           // High wood friction: stops almost immediately (~0.5cm slide)
    anisotropicRollFactor: 0.0,
    restoringStiffness: 48.0,
    tiltDamping: 6.5,
    edgeSupportRadiusFactor: 0.82
  },
  egg: {
    type: 'egg',
    label: 'Speckled Egg',
    footprintRadiusX: 0.035,      // Major axis (length of egg lying on its side)
    footprintRadiusY: 0.025,      // Minor axis (width of egg — rolls easily along this axis)
    visualRadiusX: 0.038,
    visualRadiusY: 0.028,
    mass: 0.085,
    height: 0.052,
    comHeight: 0.024,
    criticalTiltRad: 0.50,        // Main hazard is rolling into glasses or off the table edge
    clothFriction: 0.84,
    woodFriction: 0.08,           // Very low rolling resistance along roll axis on bare wood
    anisotropicRollFactor: 0.84,  // Strong direction-dependent rolling (rolls perpendicular to long axis)
    restoringStiffness: 16.0,
    tiltDamping: 2.8,
    edgeSupportRadiusFactor: 0.65
  },
  bowl: {
    type: 'bowl',
    label: 'Stoneware Bowl',
    footprintRadiusX: 0.052,
    footprintRadiusY: 0.052,
    visualRadiusX: 0.074,         // Flared rim wider than foot ring
    visualRadiusY: 0.074,
    mass: 0.38,
    height: 0.078,
    comHeight: 0.038,
    criticalTiltRad: 0.46,        // ~26 deg: moderate stability, smooth glazed foot slides well
    clothFriction: 0.82,
    woodFriction: 0.11,           // Smooth foot ring glides ~8-10cm across bare oak
    anisotropicRollFactor: 0.0,
    restoringStiffness: 28.0,
    tiltDamping: 4.4,
    edgeSupportRadiusFactor: 0.76
  }
};

export const DEFAULT_SEED = 20261019;
