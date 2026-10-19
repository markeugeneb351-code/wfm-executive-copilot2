/* ==========================================================================
   ERLANG C WORKFORCE CALCULATION ENGINE

   Input conventions:
   - availableFTE: scheduled staffing BEFORE shrinkage.
   - targetSLA: decimal fraction, e.g. 0.80.
   - shrinkage: decimal fraction, e.g. 0.30.
   - maximumOccupancy: decimal fraction, e.g. 0.85.
   - Time values: seconds.

   Staffing conventions:
   - Required productive agents are whole concurrent agents.
   - Required scheduled staffing is rounded UP after shrinkage.
   - Available productive agents are rounded DOWN after shrinkage.

   Performance conventions:
   - Projected performance uses AVAILABLE productive agents.
   - Required-staffing performance is returned separately.
   - Unstable queues return null for steady-state performance.
   ========================================================================== */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface WorkforceInput {
  forecastVolume: number;
  ahtSeconds: number;
  intervalSeconds: number;

  targetSLA: number;
  answerTimeSeconds: number;

  shrinkage: number;
  maximumOccupancy: number;

  availableFTE: number;
}

export interface QueuePerformance {
  queueStable: boolean;

  probabilityOfWait: number | null;
  serviceLevel: number | null;
  asaSeconds: number | null;
  occupancy: number | null;
}

export type CapacityStatus =
  | "Understaffed"
  | "Balanced"
  | "Overstaffed";

export interface WorkforceResult {
  offeredLoad: number;

  requiredProductiveAgents: number;
  requiredScheduledFTE: number;

  availableProductiveFTE: number;
  availableProductiveAgents: number;

  fteGap: number;
  capacityStatus: CapacityStatus;

  // Performance using AVAILABLE productive staffing.
  projectedSLA: number | null;
  occupancy: number | null;
  estimatedASASeconds: number | null;
  probabilityOfWait: number | null;
  queueStable: boolean;

  // Offered load / available productive agents.
  // May exceed 1. This is a demand-to-capacity ratio,
  // not achieved occupancy in an unstable queue.
  demandCapacityRatio: number | null;

  serviceLevelTargetMet: boolean;
  occupancyTargetMet: boolean;

  // Performance using REQUIRED productive staffing.
  requiredStaffingSLA: number;
  requiredStaffingOccupancy: number;
  requiredStaffingASASeconds: number;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

// Practical browser-side computation limit.
const MAX_AGENTS = 100_000;

// Tolerance used only for floating-point staffing comparisons.
const STAFFING_TOLERANCE = 1e-9;

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

function requireFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number.`);
  }
}

function validateWorkforceInput(input: WorkforceInput): void {
  requireFinite("Forecast volume", input.forecastVolume);
  requireFinite("AHT", input.ahtSeconds);
  requireFinite("Interval seconds", input.intervalSeconds);
  requireFinite("SLA target", input.targetSLA);
  requireFinite("Answer-time target", input.answerTimeSeconds);
  requireFinite("Shrinkage", input.shrinkage);
  requireFinite("Maximum occupancy", input.maximumOccupancy);
  requireFinite("Available FTE", input.availableFTE);

  if (
    input.forecastVolume < 0 ||
    !Number.isInteger(input.forecastVolume)
  ) {
    throw new Error(
      "Forecast volume must be a non-negative whole number."
    );
  }

  if (input.ahtSeconds <= 0) {
    throw new Error("AHT must be greater than zero.");
  }

  if (input.intervalSeconds <= 0) {
    throw new Error("Interval seconds must be greater than zero.");
  }

  if (input.targetSLA <= 0 || input.targetSLA >= 1) {
    throw new Error(
      "SLA target must be greater than 0 and below 1. Use 0.80 for 80%."
    );
  }

  if (input.answerTimeSeconds < 0) {
    throw new Error("Answer-time target cannot be negative.");
  }

  if (input.shrinkage < 0 || input.shrinkage >= 1) {
    throw new Error(
      "Shrinkage must be between 0 and below 1. Use 0.30 for 30%."
    );
  }

  if (
    input.maximumOccupancy <= 0 ||
    input.maximumOccupancy >= 1
  ) {
    throw new Error(
      "Maximum occupancy must be greater than 0 and below 1. Use 0.85 for 85%."
    );
  }

  if (input.availableFTE < 0) {
    throw new Error("Available FTE cannot be negative.");
  }
}

/* -------------------------------------------------------------------------- */
/* Numeric helpers                                                            */
/* -------------------------------------------------------------------------- */

function clampProbability(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Removes only floating-point noise close to an integer.
 *
 * Example:
 * 54.99999999999999 becomes 55.
 *
 * This avoids losing an available agent because of binary
 * floating-point representation.
 */
function normalizeNearInteger(value: number): number {
  const nearestInteger = Math.round(value);

  const tolerance =
    Number.EPSILON * Math.max(1, Math.abs(value)) * 8;

  return Math.abs(value - nearestInteger) <= tolerance
    ? nearestInteger
    : value;
}

/* -------------------------------------------------------------------------- */
/* Erlang B recursion                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Computes Erlang B recursively without factorials.
 *
 * B(0, A) = 1
 *
 * B(n, A) =
 *   A * B(n - 1, A)
 *   -------------------------
 *   n + A * B(n - 1, A)
 *
 * Used internally to calculate Erlang C.
 */
function calculateErlangB(
  offeredLoad: number,
  agents: number
): number {
  let blockingProbability = 1;

  for (let count = 1; count <= agents; count += 1) {
    const numerator = offeredLoad * blockingProbability;

    blockingProbability =
      numerator / (count + numerator);
  }

  return blockingProbability;
}

/* -------------------------------------------------------------------------- */
/* Queue performance                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Calculates steady-state Erlang C performance for a given
 * offered load and integer productive agent count.
 *
 * Occupancy:
 *   rho = A / N
 *
 * Probability of waiting:
 *   C = B / (1 - rho + rho * B)
 *
 * Service level:
 *   SL = 1 - C * exp(-(N - A) * T / AHT)
 *
 * Average speed of answer:
 *   ASA = C * AHT / (N - A)
 *
 * A = offered load in Erlangs
 * N = productive agents
 * T = answer-time threshold in seconds
 *
 * A stable queue requires N > A.
 */
export function calculateQueuePerformance(
  offeredLoad: number,
  agents: number,
  ahtSeconds: number,
  answerTimeSeconds: number
): QueuePerformance {
  requireFinite("Offered load", offeredLoad);
  requireFinite("Productive agents", agents);
  requireFinite("AHT", ahtSeconds);
  requireFinite("Answer-time target", answerTimeSeconds);

  if (offeredLoad < 0) {
    throw new Error("Offered load cannot be negative.");
  }

  if (
    !Number.isInteger(agents) ||
    agents < 0 ||
    agents > MAX_AGENTS
  ) {
    throw new Error(
      `Productive agents must be a whole number between 0 and ${MAX_AGENTS}.`
    );
  }

  if (ahtSeconds <= 0) {
    throw new Error("AHT must be greater than zero.");
  }

  if (answerTimeSeconds < 0) {
    throw new Error("Answer-time target cannot be negative.");
  }

  // No-demand convention:
  // no waiting, no occupancy, and no service-level failures.
  if (offeredLoad === 0) {
    return {
      queueStable: true,
      probabilityOfWait: 0,
      serviceLevel: 1,
      asaSeconds: 0,
      occupancy: 0,
    };
  }

  // No valid steady-state Erlang C solution.
  if (agents <= offeredLoad) {
    return {
      queueStable: false,
      probabilityOfWait: null,
      serviceLevel: null,
      asaSeconds: null,
      occupancy: null,
    };
  }

  const occupancy = offeredLoad / agents;

  const blockingProbability = calculateErlangB(
    offeredLoad,
    agents
  );

  const probabilityOfWait = clampProbability(
    blockingProbability /
      (1 - occupancy + occupancy * blockingProbability)
  );

  const spareCapacity = agents - offeredLoad;

  const serviceLevel = clampProbability(
    1 -
      probabilityOfWait *
        Math.exp(
          -(spareCapacity * answerTimeSeconds) / ahtSeconds
        )
  );

  const asaSeconds =
    (probabilityOfWait * ahtSeconds) / spareCapacity;

  return {
    queueStable: true,
    probabilityOfWait,
    serviceLevel,
    asaSeconds,
    occupancy,
  };
}

/* -------------------------------------------------------------------------- */
/* Required staffing optimization                                             */
/* -------------------------------------------------------------------------- */

/**
 * Finds the smallest integer productive agent count meeting:
 *
 * 1. Queue stability.
 * 2. Target service level.
 * 3. Maximum occupancy.
 *
 * Uses an expanding upper bound followed by integer binary search.
 */
function findRequiredProductiveAgents(
  offeredLoad: number,
  input: WorkforceInput
): number {
  if (offeredLoad === 0) {
    return 0;
  }

  const occupancyMinimum = Math.ceil(
    normalizeNearInteger(
      offeredLoad / input.maximumOccupancy
    )
  );

  const stabilityMinimum = Math.floor(offeredLoad) + 1;

  const minimumAgents = Math.max(
    stabilityMinimum,
    occupancyMinimum
  );

  if (minimumAgents > MAX_AGENTS) {
    throw new Error(
      `Required productive staffing exceeds the supported limit of ${MAX_AGENTS} agents.`
    );
  }

  function meetsTargets(agents: number): boolean {
    const performance = calculateQueuePerformance(
      offeredLoad,
      agents,
      input.ahtSeconds,
      input.answerTimeSeconds
    );

    return (
      performance.queueStable &&
      performance.serviceLevel !== null &&
      performance.occupancy !== null &&
      performance.serviceLevel >= input.targetSLA &&
      performance.occupancy <= input.maximumOccupancy
    );
  }

  if (meetsTargets(minimumAgents)) {
    return minimumAgents;
  }

  let lower = minimumAgents;
  let upper = minimumAgents;

  // Find a passing upper bound.
  while (!meetsTargets(upper)) {
    if (upper >= MAX_AGENTS) {
      throw new Error(
        "Unable to meet the service-level and occupancy targets within the supported staffing limit."
      );
    }

    lower = upper;

    upper = Math.min(
      MAX_AGENTS,
      Math.max(upper + 1, Math.ceil(upper * 1.25))
    );
  }

  // Lower fails; upper passes.
  // Find the minimum passing integer count.
  while (upper - lower > 1) {
    const middle = Math.floor((lower + upper) / 2);

    if (meetsTargets(middle)) {
      upper = middle;
    } else {
      lower = middle;
    }
  }

  return upper;
}

/* -------------------------------------------------------------------------- */
/* Main workforce calculation                                                 */
/* -------------------------------------------------------------------------- */

export function calculateWorkforce(
  input: WorkforceInput
): WorkforceResult {
  validateWorkforceInput(input);

  // Traffic = contacts * AHT / interval seconds.
  const offeredLoad =
    (input.forecastVolume * input.ahtSeconds) /
    input.intervalSeconds;

  if (!Number.isFinite(offeredLoad)) {
    throw new Error(
      "Calculated offered load is too large. Check volume, AHT, and interval length."
    );
  }

  const requiredProductiveAgents =
    findRequiredProductiveAgents(offeredLoad, input);

  const productiveFraction = 1 - input.shrinkage;

  // Gross scheduled staffing, rounded up to whole agents.
  const requiredScheduledFTE = Math.ceil(
    normalizeNearInteger(
      requiredProductiveAgents / productiveFraction
    )
  );

  if (!Number.isSafeInteger(requiredScheduledFTE)) {
    throw new Error(
      "Required scheduled staffing is outside the supported numeric range."
    );
  }

  // Available FTE is scheduled staffing before shrinkage.
  const availableProductiveFTE =
    input.availableFTE * productiveFraction;

  // Conservative whole-server convention.
  const availableProductiveAgents = Math.floor(
    normalizeNearInteger(availableProductiveFTE)
  );

  if (availableProductiveAgents > MAX_AGENTS) {
    throw new Error(
      `Available productive staffing exceeds the supported limit of ${MAX_AGENTS} agents.`
    );
  }

  // Projected performance at AVAILABLE staffing.
  const availablePerformance = calculateQueuePerformance(
    offeredLoad,
    availableProductiveAgents,
    input.ahtSeconds,
    input.answerTimeSeconds
  );

  // Performance at REQUIRED staffing, returned separately.
  const requiredPerformance = calculateQueuePerformance(
    offeredLoad,
    requiredProductiveAgents,
    input.ahtSeconds,
    input.answerTimeSeconds
  );

  if (
    requiredPerformance.serviceLevel === null ||
    requiredPerformance.occupancy === null ||
    requiredPerformance.asaSeconds === null
  ) {
    throw new Error(
      "Required staffing did not produce a stable queue."
    );
  }

  // Compare scheduled staffing with scheduled requirement.
  const fteGap =
    input.availableFTE - requiredScheduledFTE;

  let capacityStatus: CapacityStatus = "Balanced";

  if (fteGap < -STAFFING_TOLERANCE) {
    capacityStatus = "Understaffed";
  } else if (fteGap > STAFFING_TOLERANCE) {
    capacityStatus = "Overstaffed";
  }

  // Diagnostic workload-to-capacity ratio.
  // Null indicates positive demand with zero productive agents.
  const demandCapacityRatio =
    offeredLoad === 0
      ? 0
      : availableProductiveAgents > 0
        ? offeredLoad / availableProductiveAgents
        : null;

  const serviceLevelTargetMet =
    availablePerformance.serviceLevel !== null &&
    availablePerformance.serviceLevel >= input.targetSLA;

  const occupancyTargetMet =
    availablePerformance.occupancy !== null &&
    availablePerformance.occupancy <= input.maximumOccupancy;

  return {
    offeredLoad,

    requiredProductiveAgents,
    requiredScheduledFTE,

    availableProductiveFTE,
    availableProductiveAgents,

    fteGap,
    capacityStatus,

    projectedSLA: availablePerformance.serviceLevel,
    occupancy: availablePerformance.occupancy,
    estimatedASASeconds: availablePerformance.asaSeconds,
    probabilityOfWait: availablePerformance.probabilityOfWait,
    queueStable: availablePerformance.queueStable,

    demandCapacityRatio,

    serviceLevelTargetMet,
    occupancyTargetMet,

    requiredStaffingSLA: requiredPerformance.serviceLevel,
    requiredStaffingOccupancy: requiredPerformance.occupancy,
    requiredStaffingASASeconds: requiredPerformance.asaSeconds,
  };
}