import type {
  WorkforceInput,
  WorkforceResult,
} from "../types/workforce";

/**
 * Calculates the Erlang C probability that a contact must wait.
 *
 * This implementation first calculates Erlang B recursively,
 * then converts Erlang B to Erlang C. The recursive approach
 * avoids direct factorial calculations and is more stable for
 * larger staffing requirements.
 */
function calculateProbabilityOfWaiting(
  offeredLoad: number,
  agents: number
): number {
  if (offeredLoad <= 0) {
    return 0;
  }

  if (agents <= offeredLoad) {
    return 1;
  }

  let erlangB = 1;

  for (
    let currentAgent = 1;
    currentAgent <= agents;
    currentAgent += 1
  ) {
    erlangB =
      (offeredLoad * erlangB) /
      (currentAgent + offeredLoad * erlangB);
  }

  const denominator =
    agents -
    offeredLoad +
    offeredLoad * erlangB;

  if (denominator <= 0) {
    return 1;
  }

  const probabilityOfWaiting =
    (agents * erlangB) / denominator;

  return clamp(probabilityOfWaiting, 0, 1);
}

/**
 * Calculates the proportion of contacts expected to be answered
 * within the answer-time target.
 */
function calculateServiceLevel(
  offeredLoad: number,
  agents: number,
  answerTimeSeconds: number,
  ahtSeconds: number
): number {
  if (offeredLoad <= 0) {
    return 1;
  }

  if (agents <= offeredLoad) {
    return 0;
  }

  const probabilityOfWaiting =
    calculateProbabilityOfWaiting(
      offeredLoad,
      agents
    );

  const waitingExponent =
    -(agents - offeredLoad) *
    (answerTimeSeconds / ahtSeconds);

  const serviceLevel =
    1 -
    probabilityOfWaiting *
      Math.exp(waitingExponent);

  return clamp(serviceLevel, 0, 1);
}

/**
 * Determines whether the interval is understaffed, balanced,
 * or overstaffed after shrinkage.
 */
function determineCapacityStatus(
  availableFTE: number,
  requiredScheduledFTE: number
): WorkforceResult["capacityStatus"] {
  if (requiredScheduledFTE <= 0) {
    return availableFTE > 0
      ? "Overstaffed"
      : "Balanced";
  }

  const fteGap =
    availableFTE - requiredScheduledFTE;

  const gapPercentage =
    fteGap / requiredScheduledFTE;

  if (gapPercentage < -0.02) {
    return "Understaffed";
  }

  if (gapPercentage > 0.05) {
    return "Overstaffed";
  }

  return "Balanced";
}

/**
 * Validates all required workforce planning inputs.
 */
function validateInput(
  input: WorkforceInput
): void {
  if (
    !Number.isFinite(input.forecastVolume) ||
    input.forecastVolume < 0
  ) {
    throw new Error(
      "Forecast Volume must be zero or greater."
    );
  }

  if (
    !Number.isFinite(input.ahtSeconds) ||
    input.ahtSeconds <= 0
  ) {
    throw new Error(
      "AHT Seconds must be greater than zero."
    );
  }

  if (
    !Number.isFinite(input.intervalSeconds) ||
    input.intervalSeconds <= 0
  ) {
    throw new Error(
      "Interval length must be greater than zero."
    );
  }

  if (
    !Number.isFinite(input.targetSLA) ||
    input.targetSLA <= 0 ||
    input.targetSLA >= 1
  ) {
    throw new Error(
      "SLA target must be greater than 0% and less than 100%."
    );
  }

  if (
    !Number.isFinite(
      input.answerTimeSeconds
    ) ||
    input.answerTimeSeconds <= 0
  ) {
    throw new Error(
      "Answer-time target must be greater than zero."
    );
  }

  if (
    !Number.isFinite(input.shrinkage) ||
    input.shrinkage < 0 ||
    input.shrinkage >= 1
  ) {
    throw new Error(
      "Shrinkage must be at least 0% and less than 100%."
    );
  }

  if (
    !Number.isFinite(input.availableFTE) ||
    input.availableFTE < 0
  ) {
    throw new Error(
      "Available FTE must be zero or greater."
    );
  }

  if (
    !Number.isFinite(
      input.maximumOccupancy
    ) ||
    input.maximumOccupancy <= 0 ||
    input.maximumOccupancy >= 1
  ) {
    throw new Error(
      "Maximum occupancy must be greater than 0% and less than 100%."
    );
  }
}

/**
 * Keeps a number within the specified range.
 */
function clamp(
  value: number,
  minimum: number,
  maximum: number
): number {
  return Math.min(
    maximum,
    Math.max(minimum, value)
  );
}

/**
 * Calculates Erlang C staffing and shrinkage-adjusted FTE.
 *
 * The minimum productive-agent requirement must satisfy both:
 *
 * 1. The service-level target
 * 2. The maximum occupancy target
 */
export function calculateWorkforce(
  input: WorkforceInput
): WorkforceResult {
  validateInput(input);

  /*
   * A valid interval can have zero forecast contacts.
   * No productive agents are required when offered load is zero.
   */
  if (input.forecastVolume === 0) {
    const requiredScheduledFTE = 0;

    const fteGap =
      input.availableFTE -
      requiredScheduledFTE;

    return {
      offeredLoad: 0,
      requiredProductiveAgents: 0,
      requiredScheduledFTE,
      projectedSLA: 1,
      occupancy: 0,
      fteGap,
      capacityStatus:
        determineCapacityStatus(
          input.availableFTE,
          requiredScheduledFTE
        ),
    };
  }

  const offeredLoad =
    (input.forecastVolume *
      input.ahtSeconds) /
    input.intervalSeconds;

  /*
   * Erlang C requires the number of agents to be
   * greater than the offered load.
   */
  let requiredAgents = Math.max(
    1,
    Math.floor(offeredLoad) + 1
  );

  let projectedSLA = 0;
  let occupancy = 1;

  /*
   * This safety limit prevents an infinite loop if
   * invalid or unreasonably large inputs are supplied.
   */
  const maximumSupportedAgents = 10000;

  while (
    requiredAgents <=
    maximumSupportedAgents
  ) {
    occupancy =
      offeredLoad / requiredAgents;

    projectedSLA =
      calculateServiceLevel(
        offeredLoad,
        requiredAgents,
        input.answerTimeSeconds,
        input.ahtSeconds
      );

    const meetsServiceLevel =
      projectedSLA >= input.targetSLA;

    const meetsOccupancy =
      occupancy <=
      input.maximumOccupancy;

    if (
      meetsServiceLevel &&
      meetsOccupancy
    ) {
      break;
    }

    requiredAgents += 1;
  }

  if (
    requiredAgents >
    maximumSupportedAgents
  ) {
    throw new Error(
      "No valid staffing result was found within 10,000 agents. Review the volume, AHT, interval length, SLA, and occupancy assumptions."
    );
  }

  /*
   * Correct shrinkage adjustment:
   *
   * Scheduled FTE =
   * Productive agents / (1 - shrinkage)
   */
  const requiredScheduledFTE =
    requiredAgents /
    (1 - input.shrinkage);

  const fteGap =
    input.availableFTE -
    requiredScheduledFTE;

  const capacityStatus =
    determineCapacityStatus(
      input.availableFTE,
      requiredScheduledFTE
    );

  return {
    offeredLoad,
    requiredProductiveAgents:
      requiredAgents,
    requiredScheduledFTE,
    projectedSLA,
    occupancy,
    fteGap,
    capacityStatus,
  };
}