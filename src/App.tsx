import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import { calculateWorkforce } from "./calculations/erlangC";

const theme = {
  primary: "#009CDE",
  primaryDark: "#006F9E",
  orange: "#FF8200",
  paleBlue: "#EAF8FE",
  pageBackground: "#F4FAFD",
  white: "#FFFFFF",
  darkText: "#163247",
  mutedText: "#527080",
  border: "#B9E4F5",
  green: "#067647",
  greenBackground: "#ECFDF3",
  amber: "#B54708",
  amberBackground: "#FFFAEB",
  red: "#B42318",
  redBackground: "#FEF3F2",
};

interface IntervalRow {
  id: number;
  interval: string;
  forecastVolume: number;
  ahtSeconds: number;
  availableFTE: number;
}

interface CalculatedInterval extends IntervalRow {
  offeredLoad: number;
  requiredProductiveAgents: number;
  requiredScheduledFTE: number;
  projectedSLA: number;
  occupancy: number;
  fteGap: number;
  capacityStatus: "Understaffed" | "Balanced" | "Overstaffed";
  riskLevel: "Low" | "Medium" | "High" | "Critical";
}

interface SectionHeadingProps {
  title: string;
  subtitle?: string;
}

interface SummaryCardProps {
  label: string;
  value: string;
  helper: string;
  accentColor?: string;
  valueColor?: string;
}

type EditableIntervalField =
  | "interval"
  | "forecastVolume"
  | "ahtSeconds"
  | "availableFTE";

const defaultIntervals: IntervalRow[] = [
  {
    id: 1,
    interval: "09:00",
    forecastVolume: 100,
    ahtSeconds: 420,
    availableFTE: 40,
  },
  {
    id: 2,
    interval: "09:30",
    forecastVolume: 115,
    ahtSeconds: 420,
    availableFTE: 40,
  },
  {
    id: 3,
    interval: "10:00",
    forecastVolume: 125,
    ahtSeconds: 430,
    availableFTE: 42,
  },
  {
    id: 4,
    interval: "10:30",
    forecastVolume: 105,
    ahtSeconds: 410,
    availableFTE: 43,
  },
];

function createRowId(index = 0) {
  return Date.now() + index + Math.floor(Math.random() * 1000);
}

function normalizeHeader(header: string) {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let currentValue = "";
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === '"' && insideQuotes && nextCharacter === '"') {
      currentValue += '"';
      index += 1;
    } else if (character === '"') {
      insideQuotes = !insideQuotes;
    } else if (character === "," && !insideQuotes) {
      values.push(currentValue.trim());
      currentValue = "";
    } else {
      currentValue += character;
    }
  }

  values.push(currentValue.trim());

  return values;
}

function escapeCsvValue(value: string | number) {
  const text = String(value);

  if (
    text.includes(",") ||
    text.includes('"') ||
    text.includes("\n")
  ) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function normalizeInterval(value: string) {
  const trimmedValue = value.trim();

  const twentyFourHourMatch = trimmedValue.match(
    /^([01]?\d|2[0-3]):([0-5]\d)$/
  );

  if (twentyFourHourMatch) {
    const hours = twentyFourHourMatch[1].padStart(2, "0");
    const minutes = twentyFourHourMatch[2];

    return `${hours}:${minutes}`;
  }

  const twelveHourMatch = trimmedValue.match(
    /^(\d{1,2}):([0-5]\d)\s*(AM|PM)$/i
  );

  if (twelveHourMatch) {
    let hours = Number(twelveHourMatch[1]);
    const minutes = twelveHourMatch[2];
    const period = twelveHourMatch[3].toUpperCase();

    if (hours < 1 || hours > 12) {
      throw new Error(`Invalid interval time: ${value}`);
    }

    if (period === "AM" && hours === 12) {
      hours = 0;
    }

    if (period === "PM" && hours !== 12) {
      hours += 12;
    }

    return `${String(hours).padStart(2, "0")}:${minutes}`;
  }

  throw new Error(
    `Invalid interval "${value}". Use HH:MM, such as 09:30.`
  );
}

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [intervalMinutes, setIntervalMinutes] = useState(30);
  const [targetSLA, setTargetSLA] = useState(80);
  const [answerTime, setAnswerTime] = useState(20);
  const [shrinkage, setShrinkage] = useState(30);
  const [maximumOccupancy, setMaximumOccupancy] = useState(85);

  const [intervals, setIntervals] =
    useState<IntervalRow[]>(defaultIntervals);

  const [csvMessage, setCsvMessage] = useState("");
  const [csvError, setCsvError] = useState("");

  const calculation = useMemo(() => {
    try {
      const results: CalculatedInterval[] = intervals.map((row) => {
        const result = calculateWorkforce({
          forecastVolume: row.forecastVolume,
          ahtSeconds: row.ahtSeconds,
          intervalSeconds: intervalMinutes * 60,
          targetSLA: targetSLA / 100,
          answerTimeSeconds: answerTime,
          shrinkage: shrinkage / 100,
          availableFTE: row.availableFTE,
          maximumOccupancy: maximumOccupancy / 100,
        });

        const gapPercentage =
          result.requiredScheduledFTE > 0
            ? result.fteGap / result.requiredScheduledFTE
            : 0;

        let riskLevel: CalculatedInterval["riskLevel"] = "Low";

        if (gapPercentage <= -0.15) {
          riskLevel = "Critical";
        } else if (gapPercentage < -0.02) {
          riskLevel = "High";
        } else if (
          result.occupancy >=
          maximumOccupancy / 100 - 0.03
        ) {
          riskLevel = "Medium";
        }

        return {
          ...row,
          ...result,
          riskLevel,
        };
      });

      return {
        results,
        error: "",
      };
    } catch (error) {
      return {
        results: [] as CalculatedInterval[],
        error:
          error instanceof Error
            ? error.message
            : "Unable to calculate interval results.",
      };
    }
  }, [
    intervals,
    intervalMinutes,
    targetSLA,
    answerTime,
    shrinkage,
    maximumOccupancy,
  ]);

  const calculatedIntervals = calculation.results;

  const summary = useMemo(() => {
    if (calculatedIntervals.length === 0) {
      return null;
    }

    const totalForecastVolume = calculatedIntervals.reduce(
      (total, row) => total + row.forecastVolume,
      0
    );

    const averageRequiredFTE =
      calculatedIntervals.reduce(
        (total, row) => total + row.requiredScheduledFTE,
        0
      ) / calculatedIntervals.length;

    const averageAvailableFTE =
      calculatedIntervals.reduce(
        (total, row) => total + row.availableFTE,
        0
      ) / calculatedIntervals.length;

    const averageFTEGap =
      calculatedIntervals.reduce(
        (total, row) => total + row.fteGap,
        0
      ) / calculatedIntervals.length;

    const peakInterval = calculatedIntervals.reduce(
      (peak, row) =>
        row.requiredScheduledFTE > peak.requiredScheduledFTE
          ? row
          : peak
    );

    const largestDeficitInterval = calculatedIntervals.reduce(
      (largestDeficit, row) =>
        row.fteGap < largestDeficit.fteGap
          ? row
          : largestDeficit
    );

    const atRiskIntervals = calculatedIntervals.filter(
      (row) =>
        row.riskLevel === "High" ||
        row.riskLevel === "Critical"
    );

    return {
      totalForecastVolume,
      averageRequiredFTE,
      averageAvailableFTE,
      averageFTEGap,
      peakInterval,
      largestDeficitInterval,
      atRiskIntervals,
    };
  }, [calculatedIntervals]);

  function updateInterval(
    id: number,
    field: EditableIntervalField,
    value: string | number
  ) {
    setIntervals((currentIntervals) =>
      currentIntervals.map((row) => {
        if (row.id !== id) {
          return row;
        }

        switch (field) {
          case "interval":
            return {
              ...row,
              interval: String(value),
            };

          case "forecastVolume":
            return {
              ...row,
              forecastVolume: Number(value),
            };

          case "ahtSeconds":
            return {
              ...row,
              ahtSeconds: Number(value),
            };

          case "availableFTE":
            return {
              ...row,
              availableFTE: Number(value),
            };

          default:
            return row;
        }
      })
    );
  }

  function addInterval() {
    const lastInterval = intervals[intervals.length - 1];
    let nextTime = "09:00";

    if (lastInterval) {
      const [hours, minutes] = lastInterval.interval
        .split(":")
        .map(Number);

      const totalMinutes =
        hours * 60 + minutes + intervalMinutes;

      const nextHours = Math.floor(totalMinutes / 60) % 24;
      const nextMinutes = totalMinutes % 60;

      nextTime = `${String(nextHours).padStart(2, "0")}:${String(
        nextMinutes
      ).padStart(2, "0")}`;
    }

    setIntervals((currentIntervals) => [
      ...currentIntervals,
      {
        id: createRowId(),
        interval: nextTime,
        forecastVolume: 0,
        ahtSeconds: 420,
        availableFTE: 0,
      },
    ]);

    setCsvMessage("");
    setCsvError("");
  }

  function removeInterval(id: number) {
    setIntervals((currentIntervals) =>
      currentIntervals.filter((row) => row.id !== id)
    );

    setCsvMessage("");
    setCsvError("");
  }

  function resetIntervals() {
    setIntervals(
      defaultIntervals.map((row, index) => ({
        ...row,
        id: createRowId(index),
      }))
    );

    setCsvMessage("Interval inputs were reset.");
    setCsvError("");
  }

  function openCsvImporter() {
    fileInputRef.current?.click();
  }

  function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setCsvMessage("");
    setCsvError("");

    const reader = new FileReader();

    reader.onload = () => {
      try {
        const fileContents = String(reader.result ?? "")
          .replace(/^\uFEFF/, "")
          .trim();

        if (!fileContents) {
          throw new Error("The selected CSV file is empty.");
        }

        const lines = fileContents
          .split(/\r?\n/)
          .filter((line) => line.trim() !== "");

        if (lines.length < 2) {
          throw new Error(
            "The CSV must contain a header row and at least one data row."
          );
        }

        const headers = parseCsvLine(lines[0]).map(normalizeHeader);

        const intervalIndex = headers.findIndex((header) =>
          ["interval", "time", "intervaltime"].includes(header)
        );

        const volumeIndex = headers.findIndex((header) =>
          [
            "forecastvolume",
            "volume",
            "forecast",
            "contacts",
          ].includes(header)
        );

        const ahtIndex = headers.findIndex((header) =>
          [
            "ahtseconds",
            "aht",
            "averagehandletime",
          ].includes(header)
        );

        const availableFteIndex = headers.findIndex((header) =>
          [
            "availablefte",
            "fte",
            "availableagents",
            "staffing",
          ].includes(header)
        );

        if (
          intervalIndex === -1 ||
          volumeIndex === -1 ||
          ahtIndex === -1 ||
          availableFteIndex === -1
        ) {
          throw new Error(
            "Required CSV columns: Interval, Forecast Volume, AHT Seconds, Available FTE."
          );
        }

        const importedRows: IntervalRow[] = lines
          .slice(1)
          .map((line, index) => {
            const values = parseCsvLine(line);

            const interval = normalizeInterval(
              values[intervalIndex] ?? ""
            );

            const forecastVolume = Number(
              values[volumeIndex]
            );

            const ahtSeconds = Number(values[ahtIndex]);

            const availableFTE = Number(
              values[availableFteIndex]
            );

            if (
              !Number.isFinite(forecastVolume) ||
              forecastVolume < 0
            ) {
              throw new Error(
                `Row ${index + 2}: Forecast Volume must be zero or greater.`
              );
            }

            if (
              !Number.isFinite(ahtSeconds) ||
              ahtSeconds <= 0
            ) {
              throw new Error(
                `Row ${index + 2}: AHT Seconds must be greater than zero.`
              );
            }

            if (
              !Number.isFinite(availableFTE) ||
              availableFTE < 0
            ) {
              throw new Error(
                `Row ${index + 2}: Available FTE must be zero or greater.`
              );
            }

            return {
              id: createRowId(index),
              interval,
              forecastVolume,
              ahtSeconds,
              availableFTE,
            };
          });

        if (importedRows.length === 0) {
          throw new Error(
            "No valid interval rows were found in the CSV."
          );
        }

        importedRows.sort((firstRow, secondRow) =>
          firstRow.interval.localeCompare(secondRow.interval)
        );

        setIntervals(importedRows);

        setCsvMessage(
          `${importedRows.length} interval row${
            importedRows.length === 1 ? "" : "s"
          } imported successfully.`
        );
      } catch (error) {
        setCsvError(
          error instanceof Error
            ? error.message
            : "Unable to import the CSV file."
        );
      } finally {
        event.target.value = "";
      }
    };

    reader.onerror = () => {
      setCsvError("The selected CSV file could not be read.");
      event.target.value = "";
    };

    reader.readAsText(file);
  }

  function exportInputsCsv() {
    const header = [
      "Interval",
      "Forecast Volume",
      "AHT Seconds",
      "Available FTE",
    ];

    const rows = intervals.map((row) => [
      row.interval,
      row.forecastVolume,
      row.ahtSeconds,
      row.availableFTE,
    ]);

    downloadCsv(
      "wfm-interval-inputs.csv",
      [header, ...rows]
        .map((row) => row.map(escapeCsvValue).join(","))
        .join("\n")
    );

    setCsvMessage("Input data was exported successfully.");
    setCsvError("");
  }

  function exportResultsCsv() {
    if (calculatedIntervals.length === 0) {
      setCsvError(
        "There are no calculated interval results to export."
      );
      setCsvMessage("");
      return;
    }

    const header = [
      "Interval",
      "Forecast Volume",
      "AHT Seconds",
      "Available FTE",
      "Offered Load",
      "Required Productive Agents",
      "Required Scheduled FTE",
      "FTE Gap",
      "Occupancy Percent",
      "Projected SLA Percent",
      "Capacity Status",
      "Risk Level",
    ];

    const rows = calculatedIntervals.map((row) => [
      row.interval,
      row.forecastVolume,
      row.ahtSeconds,
      row.availableFTE.toFixed(2),
      row.offeredLoad.toFixed(2),
      row.requiredProductiveAgents,
      row.requiredScheduledFTE.toFixed(2),
      row.fteGap.toFixed(2),
      (row.occupancy * 100).toFixed(1),
      (row.projectedSLA * 100).toFixed(1),
      row.capacityStatus,
      row.riskLevel,
    ]);

    downloadCsv(
      "wfm-capacity-results.csv",
      [header, ...rows]
        .map((row) => row.map(escapeCsvValue).join(","))
        .join("\n")
    );

    setCsvMessage("Calculated results were exported successfully.");
    setCsvError("");
  }

  function downloadCsv(fileName: string, csvContent: string) {
    const blob = new Blob([`\uFEFF${csvContent}`], {
      type: "text/csv;charset=utf-8;",
    });

    const downloadUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement("a");

    downloadLink.href = downloadUrl;
    downloadLink.download = fileName;
    downloadLink.style.display = "none";

    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);

    URL.revokeObjectURL(downloadUrl);
  }

  function getStatusColors(status: string) {
    if (status === "Understaffed") {
      return {
        color: theme.red,
        background: theme.redBackground,
      };
    }

    if (status === "Overstaffed") {
      return {
        color: theme.primaryDark,
        background: theme.paleBlue,
      };
    }

    return {
      color: theme.green,
      background: theme.greenBackground,
    };
  }

  function getRiskColors(risk: string) {
    if (risk === "Critical" || risk === "High") {
      return {
        color: theme.red,
        background: theme.redBackground,
      };
    }

    if (risk === "Medium") {
      return {
        color: theme.amber,
        background: theme.amberBackground,
      };
    }

    return {
      color: theme.green,
      background: theme.greenBackground,
    };
  }

  const inputStyle = {
    width: "100%",
    minWidth: "90px",
    padding: "11px",
    color: theme.darkText,
    backgroundColor: theme.white,
    border: `1px solid ${theme.border}`,
    borderRadius: "8px",
    fontSize: "14px",
    boxSizing: "border-box" as const,
    outlineColor: theme.primary,
  };

  const assumptionInputStyle = {
    ...inputStyle,
    marginTop: "6px",
    fontSize: "16px",
    backgroundColor: theme.paleBlue,
  };

  const labelStyle = {
    display: "flex",
    flexDirection: "column" as const,
    minWidth: 0,
  };

  const labelTextStyle = {
    minHeight: "48px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: theme.darkText,
    textAlign: "center" as const,
    fontWeight: 600,
    lineHeight: 1.3,
  };

  const sectionStyle = {
    marginBottom: "24px",
    padding: "24px",
    backgroundColor: theme.white,
    border: `1px solid ${theme.border}`,
    borderRadius: "16px",
    boxShadow: "0 6px 20px rgba(0, 111, 158, 0.07)",
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "32px 20px",
        backgroundColor: theme.pageBackground,
        color: theme.darkText,
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: "1400px",
          margin: "0 auto",
        }}
      >
        <header
          style={{
            position: "relative",
            overflow: "hidden",
            marginBottom: "28px",
            padding: "36px 42px",
            color: theme.white,
            backgroundColor: theme.primary,
            borderRadius: "18px",
            boxShadow:
              "0 10px 30px rgba(0, 111, 158, 0.18)",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: "0 0 0 auto",
              width: "18px",
              backgroundColor: theme.orange,
            }}
          />

          <div
            style={{
              position: "absolute",
              top: "-80px",
              right: "90px",
              width: "230px",
              height: "230px",
              backgroundColor: "rgba(255, 255, 255, 0.08)",
              borderRadius: "50%",
            }}
          />

          <div style={{ position: "relative", zIndex: 1 }}>
            <div
              style={{
                marginBottom: "12px",
                fontSize: "13px",
                fontWeight: 700,
                letterSpacing: "1.8px",
                textTransform: "uppercase",
              }}
            >
              Workforce Management
            </div>

            <h1
              style={{
                margin: 0,
                color: theme.white,
                fontSize: "36px",
                lineHeight: 1.15,
              }}
            >
              Workforce Executive
            </h1>

            <p
              style={{
                margin: "12px 0 0",
                color: theme.white,
                fontSize: "18px",
              }}
            >
              Daily Multi-Interval Capacity and Erlang C Planner
            </p>
          </div>
        </header>

        <section style={sectionStyle}>
          <SectionHeading
            title="Planning Assumptions"
            subtitle="Set the common service and staffing assumptions."
          />

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "20px",
            }}
          >
            <label style={labelStyle}>
              <span style={labelTextStyle}>
                Interval length in minutes
              </span>

              <input
                style={assumptionInputStyle}
                type="number"
                min="1"
                value={intervalMinutes}
                onChange={(event) =>
                  setIntervalMinutes(Number(event.target.value))
                }
              />
            </label>

            <label style={labelStyle}>
              <span style={labelTextStyle}>SLA target %</span>

              <input
                style={assumptionInputStyle}
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

            <label style={labelStyle}>
              <span style={labelTextStyle}>
                Answer-time target in seconds
              </span>

              <input
                style={assumptionInputStyle}
                type="number"
                min="1"
                value={answerTime}
                onChange={(event) =>
                  setAnswerTime(Number(event.target.value))
                }
              />
            </label>

            <label style={labelStyle}>
              <span style={labelTextStyle}>Shrinkage %</span>

              <input
                style={assumptionInputStyle}
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

            <label style={labelStyle}>
              <span style={labelTextStyle}>
                Maximum occupancy %
              </span>

              <input
                style={assumptionInputStyle}
                type="number"
                min="1"
                max="99.9"
                step="0.1"
                value={maximumOccupancy}
                onChange={(event) =>
                  setMaximumOccupancy(Number(event.target.value))
                }
              />
            </label>
          </div>
        </section>

        <section style={sectionStyle}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: "16px",
              flexWrap: "wrap",
            }}
          >
            <SectionHeading
              title="Daily Interval Inputs"
              subtitle="Import a CSV or enter workload and staffing manually."
            />

            <div
              style={{
                display: "flex",
                gap: "8px",
                flexWrap: "wrap",
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={importCsv}
                style={{ display: "none" }}
              />

              <ActionButton
                label="Import CSV"
                onClick={openCsvImporter}
                variant="secondary"
              />

              <ActionButton
                label="Export Inputs"
                onClick={exportInputsCsv}
                variant="secondary"
              />

              <ActionButton
                label="Export Results"
                onClick={exportResultsCsv}
                variant="secondary"
              />

              <ActionButton
                label="Reset"
                onClick={resetIntervals}
                variant="secondary"
              />

              <ActionButton
                label="+ Add Interval"
                onClick={addInterval}
                variant="primary"
              />
            </div>
          </div>

          <div
            style={{
              marginBottom: "18px",
              padding: "12px 14px",
              color: theme.mutedText,
              backgroundColor: theme.paleBlue,
              border: `1px solid ${theme.border}`,
              borderRadius: "10px",
              fontSize: "13px",
              lineHeight: 1.5,
            }}
          >
            Required CSV headers: <strong>Interval</strong>,{" "}
            <strong>Forecast Volume</strong>,{" "}
            <strong>AHT Seconds</strong>, and{" "}
            <strong>Available FTE</strong>.
          </div>

          {csvMessage && (
            <MessageBox
              text={csvMessage}
              color={theme.green}
              background={theme.greenBackground}
            />
          )}

          {csvError && (
            <MessageBox
              text={csvError}
              color={theme.red}
              background={theme.redBackground}
            />
          )}

          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr style={tableHeaderRowStyle}>
                  <th style={tableHeaderStyle}>Interval</th>
                  <th style={tableHeaderStyle}>
                    Forecast Volume
                  </th>
                  <th style={tableHeaderStyle}>AHT Seconds</th>
                  <th style={tableHeaderStyle}>Available FTE</th>
                  <th style={tableHeaderStyle}>Action</th>
                </tr>
              </thead>

              <tbody>
                {intervals.map((row, index) => (
                  <tr
                    key={row.id}
                    style={{
                      backgroundColor:
                        index % 2 === 0
                          ? theme.white
                          : theme.pageBackground,
                    }}
                  >
                    <td style={tableCellStyle}>
                      <input
                        style={inputStyle}
                        type="time"
                        value={row.interval}
                        onChange={(event) =>
                          updateInterval(
                            row.id,
                            "interval",
                            event.target.value
                          )
                        }
                      />
                    </td>

                    <td style={tableCellStyle}>
                      <input
                        style={inputStyle}
                        type="number"
                        min="0"
                        value={row.forecastVolume}
                        onChange={(event) =>
                          updateInterval(
                            row.id,
                            "forecastVolume",
                            Number(event.target.value)
                          )
                        }
                      />
                    </td>

                    <td style={tableCellStyle}>
                      <input
                        style={inputStyle}
                        type="number"
                        min="1"
                        value={row.ahtSeconds}
                        onChange={(event) =>
                          updateInterval(
                            row.id,
                            "ahtSeconds",
                            Number(event.target.value)
                          )
                        }
                      />
                    </td>

                    <td style={tableCellStyle}>
                      <input
                        style={inputStyle}
                        type="number"
                        min="0"
                        step="0.1"
                        value={row.availableFTE}
                        onChange={(event) =>
                          updateInterval(
                            row.id,
                            "availableFTE",
                            Number(event.target.value)
                          )
                        }
                      />
                    </td>

                    <td style={tableCellStyle}>
                      <button
                        type="button"
                        disabled={intervals.length === 1}
                        onClick={() => removeInterval(row.id)}
                        style={{
                          padding: "9px 12px",
                          color:
                            intervals.length === 1
                              ? "#98A2B3"
                              : theme.red,
                          backgroundColor:
                            intervals.length === 1
                              ? "#F2F4F7"
                              : theme.redBackground,
                          border: "1px solid #FECDCA",
                          borderRadius: "8px",
                          fontWeight: 600,
                          cursor:
                            intervals.length === 1
                              ? "not-allowed"
                              : "pointer",
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {calculation.error && (
          <MessageBox
            text={`Calculation error: ${calculation.error}`}
            color={theme.red}
            background={theme.redBackground}
          />
        )}

        {summary && (
          <>
            <section style={{ marginBottom: "24px" }}>
              <SectionHeading
                title="Daily Capacity Summary"
                subtitle="Executive rollup across all entered intervals."
              />

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(210px, 1fr))",
                  gap: "16px",
                }}
              >
                <SummaryCard
                  label="Total Forecast Volume"
                  value={summary.totalForecastVolume.toLocaleString()}
                  helper="Across all intervals"
                />

                <SummaryCard
                  label="Average Required FTE"
                  value={summary.averageRequiredFTE.toFixed(2)}
                  helper="Shrinkage adjusted"
                />

                <SummaryCard
                  label="Average Available FTE"
                  value={summary.averageAvailableFTE.toFixed(2)}
                  helper="Current interval staffing"
                />

                <SummaryCard
                  label="Average FTE Gap"
                  value={`${summary.averageFTEGap > 0 ? "+" : ""}${summary.averageFTEGap.toFixed(2)}`}
                  helper="Available minus required"
                  valueColor={
                    summary.averageFTEGap < 0
                      ? theme.red
                      : theme.green
                  }
                />

                <SummaryCard
                  label="Peak Interval"
                  value={summary.peakInterval.interval}
                  helper={`${summary.peakInterval.requiredScheduledFTE.toFixed(
                    2
                  )} required FTE`}
                />

                <SummaryCard
                  label="At-Risk Intervals"
                  value={String(summary.atRiskIntervals.length)}
                  helper="High or critical risk"
                  accentColor={
                    summary.atRiskIntervals.length > 0
                      ? theme.orange
                      : theme.green
                  }
                  valueColor={
                    summary.atRiskIntervals.length > 0
                      ? theme.red
                      : theme.green
                  }
                />
              </div>
            </section>

            <section style={sectionStyle}>
              <SectionHeading
                title="Interval Capacity Results"
                subtitle="Calculated Erlang C staffing, occupancy, SLA, and risk."
              />

              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    ...tableStyle,
                    minWidth: "1200px",
                  }}
                >
                  <thead>
                    <tr style={tableHeaderRowStyle}>
                      <th style={tableHeaderStyle}>Interval</th>
                      <th style={tableHeaderStyle}>Offered Load</th>
                      <th style={tableHeaderStyle}>Productive</th>
                      <th style={tableHeaderStyle}>Required FTE</th>
                      <th style={tableHeaderStyle}>Available</th>
                      <th style={tableHeaderStyle}>Gap</th>
                      <th style={tableHeaderStyle}>Occupancy</th>
                      <th style={tableHeaderStyle}>SLA</th>
                      <th style={tableHeaderStyle}>Status</th>
                      <th style={tableHeaderStyle}>Risk</th>
                    </tr>
                  </thead>

                  <tbody>
                    {calculatedIntervals.map((row, index) => {
                      const statusColors = getStatusColors(
                        row.capacityStatus
                      );

                      const riskColors = getRiskColors(
                        row.riskLevel
                      );

                      return (
                        <tr
                          key={row.id}
                          style={{
                            backgroundColor:
                              index % 2 === 0
                                ? theme.white
                                : theme.pageBackground,
                          }}
                        >
                          <td style={tableCellStyle}>
                            <strong
                              style={{
                                color: theme.primaryDark,
                              }}
                            >
                              {row.interval}
                            </strong>
                          </td>

                          <td style={tableCellStyle}>
                            {row.offeredLoad.toFixed(2)}
                          </td>

                          <td style={tableCellStyle}>
                            {row.requiredProductiveAgents}
                          </td>

                          <td style={tableCellStyle}>
                            {row.requiredScheduledFTE.toFixed(2)}
                          </td>

                          <td style={tableCellStyle}>
                            {row.availableFTE.toFixed(2)}
                          </td>

                          <td
                            style={{
                              ...tableCellStyle,
                              color:
                                row.fteGap < 0
                                  ? theme.red
                                  : theme.green,
                              fontWeight: 700,
                            }}
                          >
                            {row.fteGap > 0 ? "+" : ""}
                            {row.fteGap.toFixed(2)}
                          </td>

                          <td style={tableCellStyle}>
                            {(row.occupancy * 100).toFixed(1)}%
                          </td>

                          <td style={tableCellStyle}>
                            {(row.projectedSLA * 100).toFixed(1)}
                            %
                          </td>

                          <td style={tableCellStyle}>
                            <StatusBadge
                              text={row.capacityStatus}
                              color={statusColors.color}
                              background={statusColors.background}
                            />
                          </td>

                          <td style={tableCellStyle}>
                            <StatusBadge
                              text={row.riskLevel}
                              color={riskColors.color}
                              background={riskColors.background}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section
              style={{
                padding: "26px",
                backgroundColor: theme.paleBlue,
                border: `1px solid ${theme.border}`,
                borderLeft: `9px solid ${theme.orange}`,
                borderRadius: "16px",
              }}
            >
              <SectionHeading
                title="Executive Decision"
                subtitle="Recommended action based on current results."
              />

              {summary.atRiskIntervals.length > 0 ? (
                <>
                  <p style={{ lineHeight: 1.6 }}>
                    <strong>
                      {summary.atRiskIntervals.length}
                    </strong>{" "}
                    interval
                    {summary.atRiskIntervals.length > 1
                      ? "s are"
                      : " is"}{" "}
                    classified as high or critical risk.
                  </p>

                  <p style={{ lineHeight: 1.6 }}>
                    Prioritize capacity reallocation, schedule
                    optimization, movement of flexible offline
                    activities, cross-skilling, and targeted
                    overtime during:
                  </p>

                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      margin: "16px 0",
                      flexWrap: "wrap",
                    }}
                  >
                    {summary.atRiskIntervals.map((row) => (
                      <span
                        key={row.id}
                        style={{
                          padding: "7px 12px",
                          color: theme.white,
                          backgroundColor:
                            row.riskLevel === "Critical"
                              ? theme.red
                              : theme.orange,
                          borderRadius: "999px",
                          fontWeight: 700,
                        }}
                      >
                        {row.interval}
                      </span>
                    ))}
                  </div>

                  <p style={{ lineHeight: 1.6 }}>
                    The largest deficit is at{" "}
                    <strong>
                      {summary.largestDeficitInterval.interval}
                    </strong>
                    , with a staffing gap of{" "}
                    <strong style={{ color: theme.red }}>
                      {summary.largestDeficitInterval.fteGap.toFixed(
                        2
                      )}{" "}
                      FTE
                    </strong>
                    .
                  </p>
                </>
              ) : (
                <p style={{ marginBottom: 0, lineHeight: 1.6 }}>
                  No high or critical capacity risks are
                  identified. Maintain the existing staffing plan
                  and continue monitoring actual volume, AHT,
                  shrinkage, and intraday availability.
                </p>
              )}
            </section>

            <footer
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "12px",
                marginTop: "24px",
                padding: "18px 4px",
                color: theme.mutedText,
                fontSize: "13px",
                flexWrap: "wrap",
              }}
            >
              <span>Workforce Executive Capacity Planner</span>
              <span>Code calculates. Copilot interprets.</span>
            </footer>
          </>
        )}
      </div>
    </main>
  );
}

function SectionHeading({
  title,
  subtitle,
}: SectionHeadingProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        marginBottom: "20px",
      }}
    >
      <div
        style={{
          width: "7px",
          minWidth: "7px",
          height: "34px",
          backgroundColor: theme.orange,
          borderRadius: "4px",
        }}
      />

      <div>
        <h2
          style={{
            margin: 0,
            color: theme.darkText,
            fontSize: "22px",
          }}
        >
          {title}
        </h2>

        {subtitle && (
          <p
            style={{
              margin: "5px 0 0",
              color: theme.mutedText,
              fontSize: "14px",
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  helper,
  accentColor = theme.primary,
  valueColor = theme.primaryDark,
}: SummaryCardProps) {
  return (
    <div
      style={{
        padding: "20px",
        backgroundColor: theme.white,
        border: `1px solid ${theme.border}`,
        borderTop: `5px solid ${accentColor}`,
        borderRadius: "12px",
        boxShadow:
          "0 5px 16px rgba(0, 111, 158, 0.08)",
      }}
    >
      <div
        style={{
          minHeight: "38px",
          marginBottom: "8px",
          color: theme.mutedText,
          fontSize: "14px",
          fontWeight: 600,
        }}
      >
        {label}
      </div>

      <strong
        style={{
          display: "block",
          marginBottom: "4px",
          color: valueColor,
          fontSize: "26px",
        }}
      >
        {value}
      </strong>

      <div
        style={{
          color: theme.mutedText,
          fontSize: "13px",
        }}
      >
        {helper}
      </div>
    </div>
  );
}

function StatusBadge({
  text,
  color,
  background,
}: {
  text: string;
  color: string;
  background: string;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "5px 10px",
        color,
        backgroundColor: background,
        borderRadius: "999px",
        fontWeight: 700,
      }}
    >
      {text}
    </span>
  );
}

function ActionButton({
  label,
  onClick,
  variant,
}: {
  label: string;
  onClick: () => void;
  variant: "primary" | "secondary";
}) {
  const isPrimary = variant === "primary";

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "10px 15px",
        color: isPrimary
          ? theme.white
          : theme.primaryDark,
        backgroundColor: isPrimary
          ? theme.primary
          : theme.white,
        border: `1px solid ${theme.primary}`,
        borderRadius: "8px",
        fontSize: "14px",
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function MessageBox({
  text,
  color,
  background,
}: {
  text: string;
  color: string;
  background: string;
}) {
  return (
    <div
      style={{
        marginBottom: "16px",
        padding: "12px 14px",
        color,
        backgroundColor: background,
        border: `1px solid ${color}`,
        borderRadius: "10px",
        fontSize: "14px",
      }}
    >
      {text}
    </div>
  );
}

const tableStyle = {
  width: "100%",
  minWidth: "850px",
  overflow: "hidden",
  borderCollapse: "separate" as const,
  borderSpacing: 0,
  border: `1px solid ${theme.border}`,
  borderRadius: "12px",
};

const tableHeaderRowStyle = {
  color: theme.white,
  backgroundColor: theme.primary,
};

const tableHeaderStyle = {
  padding: "14px 12px",
  color: theme.white,
  borderBottom: `1px solid ${theme.primaryDark}`,
  textAlign: "left" as const,
  fontSize: "13px",
  fontWeight: 700,
  whiteSpace: "nowrap" as const,
};

const tableCellStyle = {
  padding: "12px",
  color: theme.darkText,
  borderBottom: `1px solid ${theme.border}`,
  textAlign: "left" as const,
  fontSize: "14px",
  whiteSpace: "nowrap" as const,
};

export default App;
