import { useState } from "react";
import { calculateWorkforce } from "./calculations/erlangC";

function App() {
  const [volume, setVolume] = useState(100);
  const [aht, setAht] = useState(420);
  const [shrinkage, setShrinkage] = useState(30);
  const [availableFTE, setAvailableFTE] = useState(40);

  const result = calculateWorkforce({
    forecastVolume: volume,
    ahtSeconds: aht,
    intervalSeconds: 1800,
    targetSLA: 0.8,
    answerTimeSeconds: 20,
    shrinkage: shrinkage / 100,
    availableFTE: availableFTE,
    maximumOccupancy: 0.85,
  });

  return (
    <div
      style={{
        maxWidth: "800px",
        margin: "40px auto",
        padding: "20px",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <h1>Workforce Executive</h1>

      <p>WFM Capacity & Erlang C Calculator</p>

      <hr />

      <h2>Workforce Inputs</h2>

      <div>
        <label>Forecast Volume</label>
        <br />
        <input
          type="number"
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
        />
      </div>

      <br />

      <div>
        <label>AHT (seconds)</label>
        <br />
        <input
          type="number"
          value={aht}
          onChange={(e) => setAht(Number(e.target.value))}
        />
      </div>

      <br />

      <div>
        <label>Shrinkage %</label>
        <br />
        <input
          type="number"
          value={shrinkage}
          onChange={(e) => setShrinkage(Number(e.target.value))}
        />
      </div>

      <br />

      <div>
        <label>Available FTE</label>
        <br />
        <input
          type="number"
          value={availableFTE}
          onChange={(e) => setAvailableFTE(Number(e.target.value))}
        />
      </div>

      <hr />

      <h2>Capacity Results</h2>

      <p>
        Offered Load:
        <strong> {result.offeredLoad.toFixed(2)} Erlangs</strong>
      </p>

      <p>
        Required Productive Agents:
        <strong> {result.requiredProductiveAgents}</strong>
      </p>

      <p>
        Required Scheduled FTE:
        <strong> {result.requiredScheduledFTE.toFixed(2)}</strong>
      </p>

      <p>
        Available FTE:
        <strong> {availableFTE.toFixed(2)}</strong>
      </p>

      <p>
        FTE Gap:
        <strong> {result.fteGap.toFixed(2)}</strong>
      </p>

      <p>
        Occupancy:
        <strong> {(result.occupancy * 100).toFixed(1)}%</strong>
      </p>

      <p>
        Projected SLA:
        <strong> {(result.projectedSLA * 100).toFixed(1)}%</strong>
      </p>

      <h2>
        Capacity Status: {result.capacityStatus}
      </h2>
    </div>
  );
}

export default App;