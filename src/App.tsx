import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
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

interface StaticNumberInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  allowDecimal?: boolean;
  ariaLabel: string;
  style?: CSSProperties;
}

interface SummaryCardProps {
  label: string;
  value: string;
  helper: string;
  accentColor?: string;
  valueColor?: string;
}

type EditableIntervalField = "interval" | "forecastVolume" | "availableFTE";

const startingIntervals: IntervalRow[] = [
  { id: 1, interval: "09:00", forecastVolume: 50, availableFTE: 40 },
  { id: 2, interval: "09:15", forecastVolume: 50, availableFTE: 40 },
  { id: 3, interval: "09:30", forecastVolume: 58, availableFTE: 42 },
  { id: 4, interval: "09:45", forecastVolume: 57, availableFTE: 43 },
];

function createRowId(index = 0) {
  return Date.now() + index + Math.floor(Math.random() * 10000);
}

function normalizeHeader(header: string) {
  return header.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const next = line[index + 1];

    if (character === '"' && insideQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (character === '"') {
      insideQuotes = !insideQuotes;
    } else if (character === "," && !insideQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }

  values.push(current.trim());
  return values;
}

function normalizeInterval(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);

  if (!match) {
    throw new Error(`Invalid interval "${value}". Use HH:MM, such as 09:15.`);
  }

  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function escapeCsvValue(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(fileName: string, csvContent: string) {
  const blob = new Blob([`\uFEFF${csvContent}`], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [intervalMinutes, setIntervalMinutes] = useState(15);
  const [targetSLA, setTargetSLA] = useState(80);
  const [answerTime, setAnswerTime] = useState(20);
  const [ahtSeconds, setAhtSeconds] = useState(420);
  const [shrinkage, setShrinkage] = useState(30);
  const [maximumOccupancy, setMaximumOccupancy] = useState(85);
  const [intervals, setIntervals] = useState<IntervalRow[]>(startingIntervals);

  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotQuestion, setCopilotQuestion] = useState("");
  const [copilotResponse, setCopilotResponse] = useState(
    "Select a quick action or ask a workforce question."
  );

  const calculation = useMemo(() => {
    try {
      const completeRows = intervals.filter(
        (row) => row.forecastVolume >= 0 && row.availableFTE >= 0 && ahtSeconds > 0
      );

      const results: CalculatedInterval[] = completeRows.map((row) => {
        const result = calculateWorkforce({
          forecastVolume: row.forecastVolume,
          ahtSeconds,
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
        if (gapPercentage <= -0.15) riskLevel = "Critical";
        else if (gapPercentage < -0.02) riskLevel = "High";
        else if (result.occupancy >= maximumOccupancy / 100 - 0.03) riskLevel = "Medium";

        return { ...row, ...result, riskLevel };
      });

      return { results, error: "" };
    } catch (error) {
      return {
        results: [] as CalculatedInterval[],
        error: error instanceof Error ? error.message : "Unable to calculate interval results.",
      };
    }
  }, [
    intervals,
    intervalMinutes,
    targetSLA,
    answerTime,
    ahtSeconds,
    shrinkage,
    maximumOccupancy,
  ]);

  const calculatedIntervals = calculation.results;

  const summary = useMemo(() => {
    if (calculatedIntervals.length === 0) return null;

    const totalForecastVolume = calculatedIntervals.reduce(
      (total, row) => total + row.forecastVolume,
      0
    );
    const averageRequiredFTE =
      calculatedIntervals.reduce((total, row) => total + row.requiredScheduledFTE, 0) /
      calculatedIntervals.length;
    const averageAvailableFTE =
      calculatedIntervals.reduce((total, row) => total + row.availableFTE, 0) /
      calculatedIntervals.length;
    const averageFTEGap =
      calculatedIntervals.reduce((total, row) => total + row.fteGap, 0) /
      calculatedIntervals.length;
    const peakInterval = calculatedIntervals.reduce((peak, row) =>
      row.requiredScheduledFTE > peak.requiredScheduledFTE ? row : peak
    );
    const largestDeficitInterval = calculatedIntervals.reduce((deficit, row) =>
      row.fteGap < deficit.fteGap ? row : deficit
    );
    const atRiskIntervals = calculatedIntervals.filter(
      (row) => row.riskLevel === "High" || row.riskLevel === "Critical"
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

  function clearMessages() {
    setMessage("");
    setErrorMessage("");
  }

  function updateInterval(
    id: number,
    field: EditableIntervalField,
    value: string | number
  ) {
    setIntervals((current) =>
      current.map((row) => {
        if (row.id !== id) return row;

        switch (field) {
          case "interval":
            return { ...row, interval: String(value) };
          case "forecastVolume":
            return { ...row, forecastVolume: Number(value) };
          case "availableFTE":
            return { ...row, availableFTE: Number(value) };
          default:
            return row;
        }
      })
    );
  }

  function addInterval() {
    const lastRow = intervals[intervals.length - 1];
    let nextTime = "09:00";

    if (lastRow) {
      const [hours, minutes] = lastRow.interval.split(":").map(Number);
      if (Number.isFinite(hours) && Number.isFinite(minutes)) {
        const totalMinutes = hours * 60 + minutes + intervalMinutes;
        nextTime = `${String(Math.floor(totalMinutes / 60) % 24).padStart(2, "0")}:${String(
          totalMinutes % 60
        ).padStart(2, "0")}`;
      }
    }

    setIntervals((current) => [
      ...current,
      {
        id: createRowId(),
        interval: nextTime,
        forecastVolume: 0,
        availableFTE: 0,
      },
    ]);
    clearMessages();
  }

  function removeInterval(id: number) {
    setIntervals((current) => current.filter((row) => row.id !== id));
    clearMessages();
  }

  function resetInputs() {
    setIntervals((current) =>
      current.map((row) => ({
        ...row,
        forecastVolume: 0,
        availableFTE: 0,
      }))
    );
    setMessage(
      "Forecast Volume and Available FTE were cleared. Interval times and planning assumptions were retained."
    );
    setErrorMessage("");
    setCopilotResponse("Enter new workforce data to generate an analysis.");
  }

  function openCsvImporter() {
    fileInputRef.current?.click();
  }

  function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    clearMessages();
    const reader = new FileReader();

    reader.onload = () => {
      try {
        const text = String(reader.result ?? "").replace(/^\uFEFF/, "").trim();
        if (!text) throw new Error("The selected CSV file is empty.");

        const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
        if (lines.length < 2) {
          throw new Error("The CSV must contain a header row and at least one data row.");
        }

        const headers = parseCsvLine(lines[0]).map(normalizeHeader);
        const intervalIndex = headers.findIndex((header) =>
          ["interval", "time", "intervaltime"].includes(header)
        );
        const volumeIndex = headers.findIndex((header) =>
          ["forecastvolume", "volume", "forecast", "contacts"].includes(header)
        );
        const availableIndex = headers.findIndex((header) =>
          ["availablefte", "fte", "availableagents", "staffing"].includes(header)
        );

        if ([intervalIndex, volumeIndex, availableIndex].includes(-1)) {
          throw new Error(
            "Required CSV columns: Interval, Forecast Volume, Available FTE."
          );
        }

        const importedRows: IntervalRow[] = lines.slice(1).map((line, index) => {
          const values = parseCsvLine(line);
          const interval = normalizeInterval(values[intervalIndex] ?? "");
          const forecastVolume = Number(values[volumeIndex]);
          const availableFTE = Number(values[availableIndex]);

          if (!Number.isFinite(forecastVolume) || forecastVolume < 0) {
            throw new Error(`Row ${index + 2}: Forecast Volume must be zero or greater.`);
          }
          if (!Number.isFinite(availableFTE) || availableFTE < 0) {
            throw new Error(`Row ${index + 2}: Available FTE must be zero or greater.`);
          }

          return {
            id: createRowId(index),
            interval,
            forecastVolume,
            availableFTE,
          };
        });

        importedRows.sort((first, second) => first.interval.localeCompare(second.interval));
        setIntervals(importedRows);
        setMessage(`${importedRows.length} interval row(s) imported successfully.`);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Unable to import the CSV file.");
      } finally {
        event.target.value = "";
      }
    };

    reader.onerror = () => {
      setErrorMessage("The selected CSV file could not be read.");
      event.target.value = "";
    };

    reader.readAsText(file);
  }

  function exportInputsCsv() {
    const rows: Array<Array<string | number>> = [
      ["Interval", "Forecast Volume", "Available FTE"],
      ...intervals.map((row) => [row.interval, row.forecastVolume, row.availableFTE]),
    ];

    downloadCsv(
      "wfm-interval-inputs.csv",
      rows.map((row) => row.map(escapeCsvValue).join(",")).join("\n")
    );
    setMessage("Input data was exported successfully.");
    setErrorMessage("");
  }

  function exportResultsCsv() {
    if (calculatedIntervals.length === 0) {
      setErrorMessage("There are no completed interval results to export.");
      setMessage("");
      return;
    }

    const rows: Array<Array<string | number>> = [
      [
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
      ],
      ...calculatedIntervals.map((row) => [
        row.interval,
        row.forecastVolume,
        ahtSeconds,
        row.availableFTE.toFixed(2),
        row.offeredLoad.toFixed(2),
        row.requiredProductiveAgents,
        row.requiredScheduledFTE.toFixed(2),
        row.fteGap.toFixed(2),
        (row.occupancy * 100).toFixed(1),
        (row.projectedSLA * 100).toFixed(1),
        row.capacityStatus,
        row.riskLevel,
      ]),
    ];

    downloadCsv(
      "wfm-capacity-results.csv",
      rows.map((row) => row.map(escapeCsvValue).join(",")).join("\n")
    );
    setMessage("Calculated results were exported successfully.");
    setErrorMessage("");
  }

  function generateLocalCopilotAnalysis(request: string) {
    if (!summary) {
      setCopilotResponse(
        "No completed interval data is available. Enter Forecast Volume and Available FTE."
      );
      return;
    }

    const query = request.toLowerCase();

    if (query.includes("risk") || query.includes("critical") || query.includes("interval")) {
      if (summary.atRiskIntervals.length === 0) {
        setCopilotResponse(
          "No high or critical intervals are identified. Continue monitoring volume, AHT, shrinkage, and staffing availability."
        );
      } else {
        setCopilotResponse(
          `There are ${summary.atRiskIntervals.length} high or critical intervals: ${summary.atRiskIntervals
            .map((row) => row.interval)
            .join(", ")}. The largest deficit is at ${
            summary.largestDeficitInterval.interval
          }, with a gap of ${summary.largestDeficitInterval.fteGap.toFixed(2)} FTE.`
        );
      }
      return;
    }

    if (query.includes("action") || query.includes("recommend") || query.includes("overtime")) {
      setCopilotResponse(
        summary.atRiskIntervals.length > 0
          ? `Recommended action: Reallocate capacity into ${summary.atRiskIntervals
              .map((row) => row.interval)
              .join(", ")}. Move flexible offline work, use cross-skilled support, and consider targeted overtime.`
          : "Recommended action: Maintain the current staffing plan. No high or critical risks are identified."
      );
      return;
    }

    setCopilotResponse(
      `Daily workforce position: Total forecast volume is ${summary.totalForecastVolume}. Average required staffing is ${summary.averageRequiredFTE.toFixed(
        2
      )} FTE compared with ${summary.averageAvailableFTE.toFixed(
        2
      )} available FTE. The average gap is ${summary.averageFTEGap.toFixed(
        2
      )} FTE. Peak staffing is required at ${summary.peakInterval.interval}.`
    );
  }

  function submitCopilotQuestion() {
    const question = copilotQuestion.trim();
    if (!question) {
      setCopilotResponse("Enter a workforce question before sending.");
      return;
    }
    generateLocalCopilotAnalysis(question);
    setCopilotQuestion("");
  }

  function statusColors(status: CalculatedInterval["capacityStatus"]) {
    if (status === "Understaffed") return [theme.red, theme.redBackground];
    if (status === "Overstaffed") return [theme.primaryDark, theme.paleBlue];
    return [theme.green, theme.greenBackground];
  }

  function riskColors(risk: CalculatedInterval["riskLevel"]) {
    if (risk === "Critical" || risk === "High") return [theme.red, theme.redBackground];
    if (risk === "Medium") return [theme.amber, theme.amberBackground];
    return [theme.green, theme.greenBackground];
  }

  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <header style={styles.header}>
          <div style={styles.headerAccent} />
          <div style={styles.headerCircle} />
          <div style={{ position: "relative", zIndex: 1 }}>
            <div style={styles.eyebrow}>Workforce Management</div>
            <h1 style={styles.title}>GSSC WFM</h1>
            <p style={styles.headerSubtitle}>
              15-Minute Capacity and Erlang C Planner
            </p>
          </div>
        </header>

        <section style={styles.planningSection}>
          <SectionHeading
            title="Planning Assumptions"
            subtitle="Common assumptions applied across all intervals."
            compact
          />
          <div style={styles.assumptionGrid}>
            <InputLabel text="Interval minutes">
              <StaticNumberInput
                value={intervalMinutes}
                min={1}
                allowDecimal={false}
                onChange={setIntervalMinutes}
                ariaLabel="Interval length in minutes"
                style={styles.assumptionInput}
              />
            </InputLabel>
            <InputLabel text="SLA target %">
              <StaticNumberInput
                value={targetSLA}
                min={1}
                max={99.9}
                onChange={setTargetSLA}
                ariaLabel="SLA target percentage"
                style={styles.assumptionInput}
              />
            </InputLabel>
            <InputLabel text="Answer target sec">
              <StaticNumberInput
                value={answerTime}
                min={1}
                allowDecimal={false}
                onChange={setAnswerTime}
                ariaLabel="Answer-time target in seconds"
                style={styles.assumptionInput}
              />
            </InputLabel>
            <InputLabel text="AHT seconds">
              <StaticNumberInput
                value={ahtSeconds}
                min={1}
                onChange={setAhtSeconds}
                ariaLabel="Average handle time in seconds"
                style={styles.assumptionInput}
              />
            </InputLabel>
            <InputLabel text="Shrinkage %">
              <StaticNumberInput
                value={shrinkage}
                min={0}
                max={99.9}
                onChange={setShrinkage}
                ariaLabel="Shrinkage percentage"
                style={styles.assumptionInput}
              />
            </InputLabel>
            <InputLabel text="Max occupancy %">
              <StaticNumberInput
                value={maximumOccupancy}
                min={1}
                max={99.9}
                onChange={setMaximumOccupancy}
                ariaLabel="Maximum occupancy percentage"
                style={styles.assumptionInput}
              />
            </InputLabel>
          </div>
        </section>

        <section style={styles.section}>
          <div style={styles.toolbar}>
            <SectionHeading
              title="Daily Interval Inputs"
              subtitle="Import a CSV or enter 15-minute workload and staffing manually."
            />
            <div style={styles.buttonGroup}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={importCsv}
                style={{ display: "none" }}
              />
              <ActionButton label="Import CSV" onClick={openCsvImporter} />
              <ActionButton label="Export Inputs" onClick={exportInputsCsv} />
              <ActionButton label="Export Results" onClick={exportResultsCsv} />
              <ActionButton label="Reset" onClick={resetInputs} />
              <ActionButton label="+ Add Interval" onClick={addInterval} primary />
            </div>
          </div>

          <div style={styles.helpBox}>
            CSV headers: Interval, Forecast Volume, Available FTE. Reset clears Forecast Volume
            and Available FTE while retaining interval times and planning assumptions.
          </div>

          {message && (
            <MessageBox text={message} color={theme.green} background={theme.greenBackground} />
          )}
          {errorMessage && (
            <MessageBox text={errorMessage} color={theme.red} background={theme.redBackground} />
          )}

          <div style={{ overflowX: "auto" }}>
            <table style={styles.table}>
              <thead>
                <tr style={styles.tableHeaderRow}>
                  <th style={styles.th}>Interval</th>
                  <th style={styles.th}>Forecast Volume</th>
                  <th style={styles.th}>Available FTE</th>
                  <th style={styles.th}>Action</th>
                </tr>
              </thead>
              <tbody>
                {intervals.map((row, index) => (
                  <tr
                    key={row.id}
                    style={{ backgroundColor: index % 2 === 0 ? theme.white : theme.pageBackground }}
                  >
                    <td style={styles.td}>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={row.interval}
                        maxLength={5}
                        placeholder="09:15"
                        aria-label={`Interval row ${index + 1}`}
                        onChange={(event) =>
                          updateInterval(row.id, "interval", event.target.value)
                        }
                        style={styles.input}
                      />
                    </td>
                    <td style={styles.td}>
                      <StaticNumberInput
                        value={row.forecastVolume}
                        min={0}
                        allowDecimal={false}
                        onChange={(value) => updateInterval(row.id, "forecastVolume", value)}
                        ariaLabel={`Forecast volume row ${index + 1}`}
                        style={styles.input}
                      />
                    </td>
                    <td style={styles.td}>
                      <StaticNumberInput
                        value={row.availableFTE}
                        min={0}
                        onChange={(value) => updateInterval(row.id, "availableFTE", value)}
                        ariaLabel={`Available FTE row ${index + 1}`}
                        style={styles.input}
                      />
                    </td>
                    <td style={styles.td}>
                      <button
                        type="button"
                        disabled={intervals.length === 1}
                        onClick={() => removeInterval(row.id)}
                        style={{
                          ...styles.removeButton,
                          opacity: intervals.length === 1 ? 0.5 : 1,
                          cursor: intervals.length === 1 ? "not-allowed" : "pointer",
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

        {!summary && !calculation.error && (
          <section style={styles.emptyState}>
            <strong>No completed interval data</strong>
            <p style={{ marginBottom: 0 }}>
              Enter Forecast Volume and Available FTE. Global AHT applies to every interval.
            </p>
          </section>
        )}

        {summary && (
          <>
            <section style={{ marginBottom: "24px" }}>
              <SectionHeading
                title="Daily Capacity Summary"
                subtitle="Executive rollup across completed intervals."
              />
              <div style={styles.summaryGrid}>
                <SummaryCard
                  label="Total Forecast Volume"
                  value={summary.totalForecastVolume.toLocaleString()}
                  helper="Across completed intervals"
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
                  valueColor={summary.averageFTEGap < 0 ? theme.red : theme.green}
                />
                <SummaryCard
                  label="Peak Interval"
                  value={summary.peakInterval.interval}
                  helper={`${summary.peakInterval.requiredScheduledFTE.toFixed(2)} required FTE`}
                />
                <SummaryCard
                  label="At-Risk Intervals"
                  value={String(summary.atRiskIntervals.length)}
                  helper="High or critical risk"
                  accentColor={summary.atRiskIntervals.length > 0 ? theme.orange : theme.green}
                  valueColor={summary.atRiskIntervals.length > 0 ? theme.red : theme.green}
                />
              </div>
            </section>

            <section style={styles.section}>
              <SectionHeading
                title="Interval Capacity Results"
                subtitle="Calculated Erlang C staffing, occupancy, SLA, and risk."
              />
              <div style={{ overflowX: "auto" }}>
                <table style={{ ...styles.table, minWidth: "1200px" }}>
                  <thead>
                    <tr style={styles.tableHeaderRow}>
                      {[
                        "Interval",
                        "Offered Load",
                        "Productive",
                        "Required FTE",
                        "Available",
                        "Gap",
                        "Occupancy",
                        "SLA",
                        "Status",
                        "Risk",
                      ].map((heading) => (
                        <th key={heading} style={styles.th}>
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {calculatedIntervals.map((row, index) => {
                      const [statusColor, statusBackground] = statusColors(row.capacityStatus);
                      const [riskColor, riskBackground] = riskColors(row.riskLevel);

                      return (
                        <tr
                          key={row.id}
                          style={{
                            backgroundColor: index % 2 === 0 ? theme.white : theme.pageBackground,
                          }}
                        >
                          <td style={styles.td}>
                            <strong style={{ color: theme.primaryDark }}>{row.interval}</strong>
                          </td>
                          <td style={styles.td}>{row.offeredLoad.toFixed(2)}</td>
                          <td style={styles.td}>{row.requiredProductiveAgents}</td>
                          <td style={styles.td}>{row.requiredScheduledFTE.toFixed(2)}</td>
                          <td style={styles.td}>{row.availableFTE.toFixed(2)}</td>
                          <td
                            style={{
                              ...styles.td,
                              color: row.fteGap < 0 ? theme.red : theme.green,
                              fontWeight: 700,
                            }}
                          >
                            {row.fteGap > 0 ? "+" : ""}
                            {row.fteGap.toFixed(2)}
                          </td>
                          <td style={styles.td}>{(row.occupancy * 100).toFixed(1)}%</td>
                          <td style={styles.td}>{(row.projectedSLA * 100).toFixed(1)}%</td>
                          <td style={styles.td}>
                            <StatusBadge
                              text={row.capacityStatus}
                              color={statusColor}
                              background={statusBackground}
                            />
                          </td>
                          <td style={styles.td}>
                            <StatusBadge
                              text={row.riskLevel}
                              color={riskColor}
                              background={riskBackground}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section style={styles.executiveDecision}>
              <SectionHeading
                title="Executive Decision"
                subtitle="Recommended action based on current results."
              />
              {summary.atRiskIntervals.length > 0 ? (
                <>
                  <p style={styles.decisionText}>
                    <strong>{summary.atRiskIntervals.length}</strong> interval
                    {summary.atRiskIntervals.length > 1 ? "s are" : " is"} classified as high or
                    critical risk.
                  </p>
                  <p style={styles.decisionText}>
                    Prioritize reallocation, schedule optimization, flexible offline work,
                    cross-skilling, and targeted overtime during:
                  </p>
                  <div style={styles.riskBadgeRow}>
                    {summary.atRiskIntervals.map((row) => (
                      <span
                        key={row.id}
                        style={{
                          ...styles.riskIntervalBadge,
                          backgroundColor: row.riskLevel === "Critical" ? theme.red : theme.orange,
                        }}
                      >
                        {row.interval}
                      </span>
                    ))}
                  </div>
                  <p style={styles.decisionText}>
                    The largest deficit is at <strong>{summary.largestDeficitInterval.interval}</strong>,
                    with a staffing gap of{" "}
                    <strong style={{ color: theme.red }}>
                      {summary.largestDeficitInterval.fteGap.toFixed(2)} FTE
                    </strong>
                    .
                  </p>
                </>
              ) : (
                <p style={styles.decisionText}>
                  No high or critical risks are identified. Maintain the current staffing plan and
                  continue monitoring volume, AHT, shrinkage, and intraday availability.
                </p>
              )}
            </section>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => setCopilotOpen(true)}
        aria-label="Open Workforce Copilot"
        style={styles.copilotFloatingButton}
      >
        <span aria-hidden="true">✨</span>
        Workforce Copilot
      </button>

      {copilotOpen && (
        <>
          <button
            type="button"
            onClick={() => setCopilotOpen(false)}
            aria-label="Close Workforce Copilot"
            style={styles.copilotOverlay}
          />
          <aside aria-label="Workforce Copilot" style={styles.copilotPanel}>
            <div style={styles.copilotHeader}>
              <div>
                <div style={styles.copilotEyebrow}>AI Workforce Advisor</div>
                <strong style={{ fontSize: "20px" }}>Workforce Copilot</strong>
              </div>
              <button
                type="button"
                onClick={() => setCopilotOpen(false)}
                aria-label="Close Workforce Copilot"
                style={styles.copilotCloseButton}
              >
                ×
              </button>
            </div>

            <div style={styles.copilotBody}>
              <p style={styles.copilotDescription}>
                This preview interprets the verified workforce calculations displayed in the
                dashboard.
              </p>
              <div style={styles.copilotActions}>
                <CopilotQuickAction
                  label="Analyze daily capacity"
                  onClick={() => generateLocalCopilotAnalysis("Analyze daily capacity")}
                />
                <CopilotQuickAction
                  label="Identify critical intervals"
                  onClick={() => generateLocalCopilotAnalysis("Identify critical interval risks")}
                />
                <CopilotQuickAction
                  label="Recommend operational actions"
                  onClick={() =>
                    generateLocalCopilotAnalysis("Recommend immediate operational actions")
                  }
                />
              </div>
              <div role="status" aria-live="polite" style={styles.copilotResponse}>
                {copilotResponse}
              </div>
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitCopilotQuestion();
              }}
              style={styles.copilotForm}
            >
              <label htmlFor="copilot-question" style={styles.copilotQuestionLabel}>
                Ask Workforce Copilot
              </label>
              <div style={styles.copilotQuestionRow}>
                <input
                  id="copilot-question"
                  type="text"
                  value={copilotQuestion}
                  placeholder="Explain today's staffing risk..."
                  autoComplete="off"
                  onChange={(event) => setCopilotQuestion(event.target.value)}
                  style={styles.copilotQuestionInput}
                />
                <button
                  type="submit"
                  disabled={!copilotQuestion.trim()}
                  style={{
                    ...styles.copilotSendButton,
                    opacity: copilotQuestion.trim() ? 1 : 0.55,
                    cursor: copilotQuestion.trim() ? "pointer" : "not-allowed",
                  }}
                >
                  Send
                </button>
              </div>
            </form>
          </aside>
        </>
      )}
    </main>
  );
}

function StaticNumberInput({
  value,
  onChange,
  min = 0,
  max,
  allowDecimal = true,
  ariaLabel,
  style,
}: StaticNumberInputProps) {
  function updateValue(rawValue: string) {
    if (rawValue === "") {
      onChange(min);
      return;
    }

    const validPattern = allowDecimal
      ? /^\d*\.?\d*$/
      : /^\d*$/;

    if (!validPattern.test(rawValue)) {
      return;
    }

    const parsedValue = Number(rawValue);

    if (!Number.isFinite(parsedValue)) {
      return;
    }

    let numericValue = Math.max(min, parsedValue);

    if (max !== undefined) {
      numericValue = Math.min(max, numericValue);
    }

    onChange(numericValue);
  }

  return (
    <input
      type="text"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      value={String(value)}
      autoComplete="off"
      aria-label={ariaLabel}
      style={style}
      onChange={(event) => updateValue(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
    />
  );
}

function InputLabel({ text, children }: { text: string; children: ReactNode }) {
  return (
    <label style={styles.inputLabel}>
      <span style={styles.inputLabelText}>{text}</span>
      {children}
    </label>
  );
}

function SectionHeading({
  title,
  subtitle,
  compact = false,
}: {
  title: string;
  subtitle?: string;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        ...styles.sectionHeadingContainer,
        marginBottom: compact ? "12px" : "20px",
      }}
    >
      <div
        style={{
          ...styles.sectionHeadingAccent,
          height: compact ? "27px" : "34px",
        }}
      />
      <div>
        <h2
          style={{
            ...styles.sectionHeading,
            fontSize: compact ? "18px" : "22px",
          }}
        >
          {title}
        </h2>
        {subtitle && (
          <p
            style={{
              ...styles.sectionSubtitle,
              margin: compact ? "3px 0 0" : "5px 0 0",
              fontSize: compact ? "12px" : "14px",
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
    <div style={{ ...styles.summaryCard, borderTop: `5px solid ${accentColor}` }}>
      <div style={styles.summaryCardLabel}>{label}</div>
      <strong style={{ ...styles.summaryCardValue, color: valueColor }}>{value}</strong>
      <div style={styles.summaryCardHelper}>{helper}</div>
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
    <span style={{ ...styles.statusBadge, color, backgroundColor: background }}>{text}</span>
  );
}

function ActionButton({
  label,
  onClick,
  primary = false,
}: {
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...styles.actionButton,
        color: primary ? theme.white : theme.primaryDark,
        backgroundColor: primary ? theme.primary : theme.white,
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
        ...styles.messageBox,
        color,
        backgroundColor: background,
        border: `1px solid ${color}`,
      }}
    >
      {text}
    </div>
  );
}

function CopilotQuickAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={styles.copilotQuickAction}>
      {label}
    </button>
  );
}

const baseInput: CSSProperties = {
  width: "100%",
  minWidth: "90px",
  height: "48px",
  padding: "0 14px",
  color: theme.darkText,
  backgroundColor: theme.white,
  border: `1px solid ${theme.border}`,
  borderRadius: "10px",
  fontFamily: "inherit",
  fontSize: "16px",
  boxSizing: "border-box",
  outlineColor: theme.primary,
};

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    padding: "32px 20px",
    color: theme.darkText,
    backgroundColor: theme.pageBackground,
    fontFamily: "Arial, Helvetica, sans-serif",
  },
  container: { maxWidth: "1400px", margin: "0 auto" },
  header: {
    position: "relative",
    overflow: "hidden",
    marginBottom: "28px",
    padding: "36px 42px",
    color: theme.white,
    backgroundColor: theme.primary,
    borderRadius: "18px",
    boxShadow: "0 10px 30px rgba(0, 111, 158, 0.18)",
  },
  headerAccent: {
    position: "absolute",
    inset: "0 0 0 auto",
    width: "18px",
    backgroundColor: theme.orange,
  },
  headerCircle: {
    position: "absolute",
    top: "-80px",
    right: "90px",
    width: "230px",
    height: "230px",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: "50%",
  },
  eyebrow: {
    marginBottom: "12px",
    fontSize: "13px",
    fontWeight: 700,
    letterSpacing: "1.8px",
    textTransform: "uppercase",
  },
  title: { margin: 0, color: theme.white, fontSize: "36px", lineHeight: 1.15 },
  headerSubtitle: { margin: "12px 0 0", color: theme.white, fontSize: "18px" },
  section: {
    marginBottom: "24px",
    padding: "24px",
    backgroundColor: theme.white,
    border: `1px solid ${theme.border}`,
    borderRadius: "16px",
    boxShadow: "0 6px 20px rgba(0, 111, 158, 0.07)",
  },
  planningSection: {
    marginBottom: "20px",
    padding: "16px 18px",
    backgroundColor: theme.white,
    border: `1px solid ${theme.border}`,
    borderRadius: "14px",
    boxShadow: "0 4px 14px rgba(0, 111, 158, 0.06)",
  },
  assumptionGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: "12px",
  },
  assumptionInput: {
    ...baseInput,
    minWidth: "110px",
    height: "38px",
    padding: "0 10px",
    marginTop: "4px",
    backgroundColor: theme.paleBlue,
    borderRadius: "8px",
    fontSize: "14px",
  },
  input: baseInput,
  inputLabel: { display: "flex", flexDirection: "column", minWidth: 0 },
  inputLabelText: {
    minHeight: "34px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: theme.darkText,
    textAlign: "center",
    fontSize: "12px",
    fontWeight: 600,
    lineHeight: 1.2,
  },
  toolbar: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "16px",
    flexWrap: "wrap",
  },
  buttonGroup: { display: "flex", gap: "8px", flexWrap: "wrap" },
  helpBox: {
    marginBottom: "18px",
    padding: "12px 14px",
    color: theme.mutedText,
    backgroundColor: theme.paleBlue,
    border: `1px solid ${theme.border}`,
    borderRadius: "10px",
    fontSize: "13px",
    lineHeight: 1.5,
  },
  table: {
    width: "100%",
    minWidth: "720px",
    overflow: "hidden",
    borderCollapse: "separate",
    borderSpacing: 0,
    border: `1px solid ${theme.border}`,
    borderRadius: "12px",
  },
  tableHeaderRow: { color: theme.white, backgroundColor: theme.primary },
  th: {
    padding: "14px 12px",
    color: theme.white,
    borderBottom: `1px solid ${theme.primaryDark}`,
    textAlign: "left",
    fontSize: "13px",
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  td: {
    padding: "12px",
    color: theme.darkText,
    borderBottom: `1px solid ${theme.border}`,
    textAlign: "left",
    fontSize: "14px",
    whiteSpace: "nowrap",
  },
  removeButton: {
    padding: "9px 12px",
    color: theme.red,
    backgroundColor: theme.redBackground,
    border: "1px solid #FECDCA",
    borderRadius: "8px",
    fontWeight: 600,
  },
  actionButton: {
    padding: "10px 15px",
    border: `1px solid ${theme.primary}`,
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: 700,
    cursor: "pointer",
  },
  messageBox: {
    marginBottom: "16px",
    padding: "12px 14px",
    borderRadius: "10px",
    fontSize: "14px",
  },
  emptyState: {
    marginBottom: "24px",
    padding: "24px",
    color: theme.mutedText,
    backgroundColor: theme.white,
    border: `1px dashed ${theme.border}`,
    borderRadius: "14px",
    textAlign: "center",
  },
  sectionHeadingContainer: {
    display: "flex",
    alignItems: "flex-start",
    gap: "10px",
    marginBottom: "20px",
  },
  sectionHeadingAccent: {
    width: "7px",
    minWidth: "7px",
    height: "34px",
    backgroundColor: theme.orange,
    borderRadius: "4px",
  },
  sectionHeading: { margin: 0, color: theme.darkText, fontSize: "22px" },
  sectionSubtitle: { margin: "5px 0 0", color: theme.mutedText, fontSize: "14px" },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: "16px",
  },
  summaryCard: {
    padding: "20px",
    backgroundColor: theme.white,
    border: `1px solid ${theme.border}`,
    borderRadius: "12px",
    boxShadow: "0 5px 16px rgba(0, 111, 158, 0.08)",
  },
  summaryCardLabel: {
    minHeight: "38px",
    marginBottom: "8px",
    color: theme.mutedText,
    fontSize: "14px",
    fontWeight: 600,
  },
  summaryCardValue: { display: "block", marginBottom: "4px", fontSize: "26px" },
  summaryCardHelper: { color: theme.mutedText, fontSize: "13px" },
  statusBadge: {
    display: "inline-block",
    padding: "5px 10px",
    borderRadius: "999px",
    fontWeight: 700,
  },
  executiveDecision: {
    padding: "26px",
    backgroundColor: theme.paleBlue,
    border: `1px solid ${theme.border}`,
    borderLeft: `9px solid ${theme.orange}`,
    borderRadius: "16px",
  },
  decisionText: { lineHeight: 1.6 },
  riskBadgeRow: { display: "flex", gap: "8px", margin: "16px 0", flexWrap: "wrap" },
  riskIntervalBadge: {
    padding: "7px 12px",
    color: theme.white,
    borderRadius: "999px",
    fontWeight: 700,
  },
  copilotFloatingButton: {
    position: "fixed",
    right: "24px",
    bottom: "24px",
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "14px 18px",
    color: theme.white,
    backgroundColor: theme.primary,
    border: `2px solid ${theme.white}`,
    borderRadius: "999px",
    boxShadow: "0 10px 30px rgba(0, 111, 158, 0.35)",
    fontSize: "14px",
    fontWeight: 700,
    cursor: "pointer",
  },
  copilotOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 1001,
    width: "100%",
    height: "100%",
    padding: 0,
    backgroundColor: "rgba(22, 50, 71, 0.25)",
    border: "none",
  },
  copilotPanel: {
    position: "fixed",
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 1002,
    display: "flex",
    flexDirection: "column",
    width: "min(420px, 100vw)",
    color: theme.darkText,
    backgroundColor: theme.white,
    boxShadow: "-12px 0 35px rgba(22, 50, 71, 0.22)",
  },
  copilotHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    padding: "20px",
    color: theme.white,
    backgroundColor: theme.primary,
    borderRight: `8px solid ${theme.orange}`,
  },
  copilotEyebrow: {
    marginBottom: "4px",
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "1px",
    textTransform: "uppercase",
  },
  copilotCloseButton: {
    width: "36px",
    height: "36px",
    color: theme.white,
    backgroundColor: "rgba(255,255,255,0.15)",
    border: "1px solid rgba(255,255,255,0.35)",
    borderRadius: "50%",
    fontSize: "20px",
    cursor: "pointer",
  },
  copilotBody: { flex: 1, overflowY: "auto", padding: "20px" },
  copilotDescription: { marginTop: 0, color: theme.mutedText, lineHeight: 1.5 },
  copilotActions: { display: "grid", gap: "10px", marginBottom: "20px" },
  copilotQuickAction: {
    padding: "11px 14px",
    color: theme.primaryDark,
    backgroundColor: theme.white,
    border: `1px solid ${theme.border}`,
    borderRadius: "10px",
    textAlign: "left",
    fontSize: "14px",
    fontWeight: 700,
    cursor: "pointer",
  },
  copilotResponse: {
    padding: "16px",
    color: theme.darkText,
    backgroundColor: theme.paleBlue,
    border: `1px solid ${theme.border}`,
    borderLeft: `6px solid ${theme.orange}`,
    borderRadius: "12px",
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
  },
  copilotForm: {
    padding: "16px",
    backgroundColor: theme.pageBackground,
    borderTop: `1px solid ${theme.border}`,
  },
  copilotQuestionLabel: {
    display: "block",
    marginBottom: "8px",
    color: theme.darkText,
    fontSize: "13px",
    fontWeight: 700,
  },
  copilotQuestionRow: { display: "flex", alignItems: "stretch", gap: "8px" },
  copilotQuestionInput: {
    flex: 1,
    minWidth: 0,
    height: "44px",
    padding: "0 12px",
    color: theme.darkText,
    backgroundColor: theme.white,
    border: `1px solid ${theme.border}`,
    borderRadius: "8px",
    fontFamily: "inherit",
    fontSize: "14px",
    boxSizing: "border-box",
    outlineColor: theme.primary,
  },
  copilotSendButton: {
    minWidth: "70px",
    height: "44px",
    padding: "0 15px",
    color: theme.white,
    backgroundColor: theme.primary,
    border: "none",
    borderRadius: "8px",
    fontFamily: "inherit",
    fontSize: "14px",
    fontWeight: 700,
  },
};

export default App;
