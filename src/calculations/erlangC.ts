import type {
  WorkforceInput,
  WorkforceResult,
} from "../types/workforce";

function probabilityOfWaiting(
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

  for (let n = 1; n <= agents; n++) {
    erlangB =
      (offeredLoad * erlangB) /
      (n + offeredLoad * erlangB);
  }

  return (
    (agents * erlangB) /
    (agents - offeredLoad + offeredLoad * erlangB)
  );
}

function calculateServiceLevel(
  offeredLoad: number,
  agents: number,
  answerTimeSeconds: number,
  ahtSeconds: number
): number {
  if (agents <= offeredLoad) {
    return 0;
  }

  const probabilityWait = probabilityOfWaiting(
    offeredLoad,
    agents
  );

  return (
    1 -
    probabilityWait *
      Math.exp(
        -(agents - offeredLoad) *
          (answerTimeSeconds / ahtSeconds)
      )
  );
}

export function calculateWorkforce(
  input: WorkforceInput
): WorkforceResult {
  if (input.forecastVolume < 0) {
    throw new Error("Forecast volume cannot be negative.");
  }

  if (input.ahtSeconds <= 0) {
    throw new Error("AHT must be greater than zero.");
  }

  if (input.intervalSeconds <= 0) {
    throw new Error("Interval length must be greater than zero.");
  }

  if (input.shrinkage < 0 || input.shrinkage >= 1) {
    throw new Error("Shrinkage must be between 0 and 1.");
  }

  const offeredLoad =
    (input.forecastVolume * input.ahtSeconds) /
    input.intervalSeconds;

  let agents = Math.max(
    1,
    Math.floor(offeredLoad) + 1
  );

  let projectedSLA = 0;
  let occupancy = 1;

  while (agents <= 10000) {
    projectedSLA = calculateServiceLevel(
      offeredLoad,
      agents,
      input.answerTimeSeconds,
      input.ahtSeconds
    );

    occupancy = offeredLoad / agents;

    const meetsSLA =
      projectedSLA >= input.targetSLA;

    const meetsOccupancy =
      occupancy <= input.maximumOccupancy;

    if (meetsSLA && meetsOccupancy) {
      break;
    }

    agents++;
  }

  if (agents > 10000) {
    throw new Error(
      "No staffing result found within the supported range."
    );
  }

  const requiredScheduledFTE =
    agents / (1 - input.shrinkage);

  const fteGap =
    input.availableFTE - requiredScheduledFTE;

  const gapPercentage =
    requiredScheduledFTE > 0
      ? fteGap / requiredScheduledFTE
      : 0;

  let capacityStatus: WorkforceResult["capacityStatus"];

  if (gapPercentage < -0.02) {
    capacityStatus = "Understaffed";
  } else if (gapPercentage > 0.05) {
    capacityStatus = "Overstaffed";
  } else {
    capacityStatus = "Balanced";
  }

  return {
    offeredLoad,
    requiredProductiveAgents: agents,
    requiredScheduledFTE,
    projectedSLA,
    occupancy,
    fteGap,
    capacityStatus,
  };
}
