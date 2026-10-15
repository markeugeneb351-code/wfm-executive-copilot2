export interface WorkforceInput {
  forecastVolume: number;
  ahtSeconds: number;
  intervalSeconds: number;
  targetSLA: number;
  answerTimeSeconds: number;
  shrinkage: number;
  availableFTE: number;
  maximumOccupancy: number;
}

export interface WorkforceResult {
  offeredLoad: number;
  requiredProductiveAgents: number;
  requiredScheduledFTE: number;
  projectedSLA: number;
  occupancy: number;
  fteGap: number;
  capacityStatus: "Understaffed" | "Balanced" | "Overstaffed";
}
