import { useMemo, useState } from "react";
import { calculateWorkforce } from "./calculations/erlangC";

function App() {
  const [volume, setVolume] = useState(100);
  const [aht, setAht] = useState(420);
  const [intervalMinutes, setIntervalMinutes] = useState(30);
  const [targetSLA, setTargetSLA] = useState(80);
  const [answerTime, setAnswerTime] = useState(20);
  const [shrinkage, setShrinkage] = useState(30);
  const [availableFTE, setAvailableFTE] = useState(40);
  const [maximumOccupancy, setMaximumOccupancy] = useState(85);

  const calculation = useMemo(() => {
    try {
      const result = calculateWorkforce({
        forecastVolume: volume,
        ahtSeconds: aht,
        intervalSeconds: intervalMinutes * 60,
        targetSLA: targetSLA / 100,
        answerTimeSeconds: answerTime,
        shrinkage: shrinkage / 100,
        availableFTE,
        maximumOccupancy: maximumOccupancy / 100,
      });

      return {
        result,
        error: "",
      };
    } catch (error) {
      return {
        result: null,
        error:
          error instanceof Error
            ? error.message
            : "Unable to calculate workforce requirements.",
      };
    }
  }, [
    volume,
    aht,
    intervalMinutes,
    targetSLA,
    answerTime,
    shrinkage,
    availableFTE,
    maximumOccupancy,
  ]);

  const result = calculation.result;

  function getStatusColor(status: string) {
    if (status === "Understaffed") {
      return "#b42318";
    }

    if (status === "Overstaffed") {
      return "#175cd3";
    }

    return "#067647";
  }

  function getRiskLevel() {
    if (!result) {
      return "Unavailable";
    }

    const gapPercentage =
      result.requiredScheduledFTE > 0
        ? result.fteGap / result.requiredScheduledFTE
        : 0;

    if (gapPercentage <= -0.15) {
      return "Critical";
    }

    if (gapPercentage < -0.02) {
      return "High";
    }

    if (
      result.occupancy >=
      maximumOccupancy / 100 - 0.03
    ) {
      return "Medium";
    }

    return "Low";
  }

  function getRiskColor(risk: string) {
    if (risk === "Critical") {
      return "#b42318";
    }

    if (risk === "High") {
      return "#d92d20";
    }

    if (risk === "Medium") {
      return "#dc6803";
    }

    if (risk === "Low") {
      return "#067647";
    }

    return "#475467";
  }

  const riskLevel = getRiskLevel();

  const inputStyle = {
    width: "100%",
    padding: "10px",
    marginTop: "6px",
    border: "1px solid #d0d5dd",
    borderRadius: "8px",
    fontSize: "16px",
    boxSizing: "border-box" as const,
  };

  const inputGroupStyle = {
    display: "flex",
    flexDirection: "column" as const,
  };

  const resultCardStyle = {
    padding: "18px",
    border: "1px solid #e4e7ec",
    borderRadius: "12px",
    backgroundColor: "#ffffff",
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        backgroundColor: "#f2f4f7",
        padding: "32px 20px",
        fontFamily: "Arial, sans-serif",
        color: "#101828",
      }}
    >
      <div
        style={{
          maxWidth: "1100px",
          margin: "0 auto",
        }}
      >
        <header
          style={{
            marginBottom: "28px",
          }}
        >
          <h1
            style={{
              marginBottom: "8px",
            }}
          >
            Workforce Executive
          </h1>

          <p
            style={{
              color: "#475467",
              margin: 0,
            }}
          >
            WFM Capacity and Erlang C Calculator
          </p>
        </header>

        <section
          style={{
            padding: "24px",
            marginBottom: "24px",
            backgroundColor: "#ffffff",
            border: "1px solid #e4e7ec",
            borderRadius: "16px",
          }}
        >
          <h2
            style={{
              marginTop: 0,
            }}
          >
            Planning Inputs
          </h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "20px",
            }}
          >
            <label style={inputGroupStyle}>
              Forecast Volume
              <input
                style={inputStyle}
                type="number"
                min="0"
                value={volume}
                onChange={(event) =>
                  setVolume(Number(event.target.value))
                }
              />
            </label>

            <label style={inputGroupStyle}>
              AHT in seconds
              <input
                style={inputStyle}
                type="number"
                min="1"
                value={aht}
                onChange={(event) =>
                  setAht(Number(event.target.value))
                }
              />
            </label>

            <label style={inputGroupStyle}>
              Interval length in minutes
              <input
                style={inputStyle}
                type="number"
                min="1"
                value={intervalMinutes}
                onChange={(event) =>
                  setIntervalMinutes(
                    Number(event.target.value)
                  )
                }
              />
            </label>

            <label style={inputGroupStyle}>
              SLA target %
              <input
                style={inputStyle}
                type="number"
                min="1"
                max="99.9"
                step="0.1"
                value={targetSLA}
                onChange={(event) =>
                  setTargetSLA(Number(event.target.value))
                }
              />
            </label>

            <label style={inputGroupStyle}>
              Answer-time target in seconds
              <input
                style={inputStyle}
                type="number"
                min="1"
                value={answerTime}
                onChange={(event) =>
                  setAnswerTime(Number(event.target.value))
                }
              />
            </label>

            <label style={inputGroupStyle}>
              Shrinkage %
              <input
                style={inputStyle}
                type="number"
                min="0"
                max="99.9"
                step="0.1"
                value={shrinkage}
                onChange={(event) =>
                  setShrinkage(Number(event.target.value))
                }
              />
            </label>

            <label style={inputGroupStyle}>
              Available FTE
              <input
                style={inputStyle}
                type="number"
                min="0"
                step="0.1"
                value={availableFTE}
                onChange={(event) =>
                  setAvailableFTE(
                    Number(event.target.value)
                  )
                }
              />
            </label>

            <label style={inputGroupStyle}>
              Maximum occupancy %
              <input
                style={inputStyle}
                type="number"
                min="1"
                max="99.9"
                step="0.1"
                value={maximumOccupancy}
                onChange={(event) =>
                  setMaximumOccupancy(
                    Number(event.target.value)
                  )
                }
              />
            </label>
          </div>
        </section>

        {calculation.error && (
          <section
            style={{
              padding: "16px",
              marginBottom: "24px",
              color: "#b42318",
              backgroundColor: "#fef3f2",
              border: "1px solid #fecdca",
              borderRadius: "12px",
            }}
          >
            <strong>Calculation error:</strong>{" "}
            {calculation.error}
          </section>
        )}

        {result && (
          <>
            <section
              style={{
                marginBottom: "24px",
              }}
            >
              <h2>Capacity Results</h2>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(210px, 1fr))",
                  gap: "16px",
                }}
              >
                <div style={resultCardStyle}>
                  <div style={{ color: "#475467" }}>
                    Offered Load
                  </div>

                  <strong style={{ fontSize: "24px" }}>
                    {result.offeredLoad.toFixed(2)}
                  </strong>

                  <div style={{ color: "#667085" }}>
                    Erlangs
                  </div>
                </div>

                <div style={resultCardStyle}>
                  <div style={{ color: "#475467" }}>
                    Productive Agents
                  </div>

                  <strong style={{ fontSize: "24px" }}>
                    {result.requiredProductiveAgents}
                  </strong>

                  <div style={{ color: "#667085" }}>
                    Before shrinkage
                  </div>
                </div>

                <div style={resultCardStyle}>
                  <div style={{ color: "#475467" }}>
                    Scheduled FTE
                  </div>

                  <strong style={{ fontSize: "24px" }}>
                    {result.requiredScheduledFTE.toFixed(2)}
                  </strong>

                  <div style={{ color: "#667085" }}>
                    After shrinkage
                  </div>
                </div>

                <div style={resultCardStyle}>
                  <div style={{ color: "#475467" }}>
                    Available FTE
                  </div>

                  <strong style={{ fontSize: "24px" }}>
                    {availableFTE.toFixed(2)}
                  </strong>

                  <div style={{ color: "#667085" }}>
                    Current capacity
                  </div>
                </div>

                <div style={resultCardStyle}>
                  <div style={{ color: "#475467" }}>
                    FTE Gap
                  </div>

                  <strong
                    style={{
                      fontSize: "24px",
                      color:
                        result.fteGap < 0
                          ? "#b42318"
                          : "#067647",
                    }}
                  >
                    {result.fteGap > 0 ? "+" : ""}
                    {result.fteGap.toFixed(2)}
                  </strong>

                  <div style={{ color: "#667085" }}>
                    Available minus required
                  </div>
                </div>

                <div style={resultCardStyle}>
                  <div style={{ color: "#475467" }}>
                    Occupancy
                  </div>

                  <strong style={{ fontSize: "24px" }}>
                    {(result.occupancy * 100).toFixed(1)}%
                  </strong>

                  <div style={{ color: "#667085" }}>
                    Limit: {maximumOccupancy.toFixed(1)}%
                  </div>
                </div>

                <div style={resultCardStyle}>
                  <div style={{ color: "#475467" }}>
                    Projected SLA
                  </div>

                  <strong style={{ fontSize: "24px" }}>
                    {(result.projectedSLA * 100).toFixed(1)}%
                  </strong>

                  <div style={{ color: "#667085" }}>
                    Target: {targetSLA.toFixed(1)}%
                  </div>
                </div>

                <div style={resultCardStyle}>
                  <div style={{ color: "#475467" }}>
                    Risk Level
                  </div>

                  <strong
                    style={{
                      fontSize: "24px",
                      color: getRiskColor(riskLevel),
                    }}
                  >
                    {riskLevel}
                  </strong>

                  <div style={{ color: "#667085" }}>
                    Capacity risk assessment
                  </div>
                </div>
              </div>
            </section>

            <section
              style={{
                padding: "24px",
                backgroundColor: "#ffffff",
                border: "1px solid #e4e7ec",
                borderRadius: "16px",
              }}
            >
              <h2
                style={{
                  marginTop: 0,
                }}
              >
                Executive Capacity Position
              </h2>

              <p
                style={{
                  fontSize: "22px",
                  fontWeight: 700,
                  color: getStatusColor(
                    result.capacityStatus
                  ),
                }}
              >
                {result.capacityStatus}
              </p>

              {result.capacityStatus ===
                "Understaffed" && (
                <p>
                  Current capacity is below the calculated
                  scheduled requirement by{" "}
                  <strong>
                    {Math.abs(result.fteGap).toFixed(2)} FTE
                  </strong>
                  . Review reallocation, schedule optimization,
                  shrinkage recovery, cross-skilling, and
                  targeted overtime.
                </p>
              )}

              {result.capacityStatus === "Balanced" && (
                <p>
                  Available capacity is reasonably aligned with
                  the calculated scheduled requirement. Continue
                  monitoring volume, AHT, shrinkage, and
                  interval-level staffing.
                </p>
              )}

              {result.capacityStatus ===
                "Overstaffed" && (
                <p>
                  Available capacity exceeds the calculated
                  scheduled requirement by{" "}
                  <strong>
                    {result.fteGap.toFixed(2)} FTE
                  </strong>
                  . Consider reallocating available capacity to
                  other queues, backlogs, training, or planned
                  offline work.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

export default App;