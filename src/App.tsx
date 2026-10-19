import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";

import { calculateWorkforce } from "./calculations/erlangC";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

interface IntervalRow {
  id: number;
  interval: string;
  forecastVolume: number;
  availableFTE: number;
}

type RiskLevel = "Low" | "Medium" | "High" | "Critical";

interface CalculatedInterval extends IntervalRow {
  offeredLoad: number;
  requiredProductiveAgents: number;
  requiredScheduledFTE: number;
  projectedSLA: number;
  occupancy: number;
  fteGap: number;
  capacityStatus: "Understaffed" | "Balanced" | "Overstaffed";
  riskLevel: RiskLevel;
}

interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  allowDecimal?: boolean;
  ariaLabel: string;
}

interface SummaryMetricProps {
  label: string;
  value: string;
  helper: string;
  tone?: "default" | "positive" | "warning" | "negative";
}

type EditableIntervalField =
  | "interval"
  | "forecastVolume"
  | "availableFTE";

/* -------------------------------------------------------------------------- */
/* Defaults and utilities                                                     */
/* -------------------------------------------------------------------------- */

const startingIntervals: IntervalRow[] = [
  { id: 1, interval: "09:00", forecastVolume: 50, availableFTE: 40 },
  { id: 2, interval: "09:15", forecastVolume: 50, availableFTE: 40 },
  { id: 3, interval: "09:30", forecastVolume: 58, availableFTE: 42 },
  { id: 4, interval: "09:45", forecastVolume: 57, availableFTE: 43 },
];

const riskOrder: RiskLevel[] = ["Critical", "High", "Medium", "Low"];

function normalizeHeader(header: string) {
  return header.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function normalizeInterval(value: string) {
  const match = value.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);

  if (!match) {
    throw new Error(
      `Invalid interval "${value}". Use HH:MM, such as 09:15.`
    );
  }

  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function signedNumber(value: number, decimals = 2) {
  const rounded = Number(value.toFixed(decimals));
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(decimals)}`;
}

/**
 * Parses comma-separated records, including quoted commas, escaped quotes,
 * and line breaks inside quoted fields.
 */
function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  function finishRecord() {
    record.push(field.trim());

    if (record.some((value) => value !== "")) {
      records.push(record);
    }

    record = [];
    field = "";
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (character === '"') {
      if (quoted && next === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      record.push(field.trim());
      field = "";
    } else if (
      (character === "\n" || character === "\r") &&
      !quoted
    ) {
      if (character === "\r" && next === "\n") {
        index += 1;
      }

      finishRecord();
    } else {
      field += character;
    }
  }

  if (quoted) {
    throw new Error("The CSV contains an unclosed quoted field.");
  }

  finishRecord();
  return records;
}

function escapeCsvValue(value: string | number) {
  const text = String(value);

  return /[",\r\n]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

function downloadCsv(
  fileName: string,
  rows: Array<Array<string | number>>
) {
  const content = rows
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\r\n");

  const blob = new Blob([`\uFEFF${content}`], {
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

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* -------------------------------------------------------------------------- */
/* App                                                                        */
/* -------------------------------------------------------------------------- */

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nextRowId = useRef(5);
  const copilotQuestionRef = useRef<HTMLInputElement>(null);
  const copilotTriggerRef = useRef<HTMLButtonElement>(null);

  const [intervalMinutes, setIntervalMinutes] = useState(15);
  const [targetSLA, setTargetSLA] = useState(80);
  const [answerTime, setAnswerTime] = useState(20);
  const [ahtSeconds, setAhtSeconds] = useState(420);
  const [shrinkage, setShrinkage] = useState(30);
  const [maximumOccupancy, setMaximumOccupancy] = useState(85);

  const [intervals, setIntervals] =
    useState<IntervalRow[]>(startingIntervals);

  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotQuestion, setCopilotQuestion] = useState("");
  const [copilotResponse, setCopilotResponse] = useState(
    "Select a quick action or enter a workforce question."
  );

  /* ------------------------------ Calculations ----------------------------- */

  const calculation = useMemo(() => {
    try {
      if (
        !Number.isInteger(intervalMinutes) ||
        intervalMinutes < 1 ||
        intervalMinutes > 1440
      ) {
        throw new Error("Interval minutes must be between 1 and 1440.");
      }

      if (
        !Number.isFinite(ahtSeconds) ||
        ahtSeconds <= 0 ||
        targetSLA <= 0 ||
        targetSLA >= 100 ||
        answerTime < 0 ||
        shrinkage < 0 ||
        shrinkage >= 100 ||
        maximumOccupancy <= 0 ||
        maximumOccupancy >= 100
      ) {
        throw new Error("Check the service and staffing assumptions.");
      }

      const seenTimes = new Set<string>();

      const results: CalculatedInterval[] = intervals.map((row) => {
        const interval = normalizeInterval(row.interval);

        if (seenTimes.has(interval)) {
          throw new Error(`Duplicate interval: ${interval}.`);
        }

        seenTimes.add(interval);

        if (
          !Number.isFinite(row.forecastVolume) ||
          !Number.isInteger(row.forecastVolume) ||
          row.forecastVolume < 0
        ) {
          throw new Error(
            `${interval}: Forecast Volume must be a non-negative whole number.`
          );
        }

        if (
          !Number.isFinite(row.availableFTE) ||
          row.availableFTE < 0
        ) {
          throw new Error(
            `${interval}: Available FTE must be zero or greater.`
          );
        }

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

        const requiredValues = [
          result.offeredLoad,
          result.requiredProductiveAgents,
          result.requiredScheduledFTE,
          result.projectedSLA,
          result.occupancy,
          result.fteGap,
        ];

        if (!requiredValues.every(Number.isFinite)) {
          throw new Error(
            `${interval}: The calculation returned an invalid numeric result.`
          );
        }

        const gapPercentage =
          result.requiredScheduledFTE > 0
            ? result.fteGap / result.requiredScheduledFTE
            : 0;

        let riskLevel: RiskLevel = "Low";

        if (row.forecastVolume > 0) {
          if (gapPercentage <= -0.15) {
            riskLevel = "Critical";
          } else if (gapPercentage < -0.02) {
            riskLevel = "High";
          } else if (
            result.occupancy >= maximumOccupancy / 100 - 0.03
          ) {
            riskLevel = "Medium";
          }
        }

        return {
          ...row,
          ...result,
          interval,
          riskLevel,
        };
      });

      return { results, error: "" };
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
    ahtSeconds,
    shrinkage,
    maximumOccupancy,
  ]);

  const calculatedIntervals = calculation.results;

  const resultsById = useMemo(
    () => new Map(calculatedIntervals.map((row) => [row.id, row])),
    [calculatedIntervals]
  );

  const summary = useMemo(() => {
    if (calculatedIntervals.length === 0) {
      return null;
    }

    const count = calculatedIntervals.length;

    const totalForecastVolume = calculatedIntervals.reduce(
      (total, row) => total + row.forecastVolume,
      0
    );

    const averageRequiredFTE =
      calculatedIntervals.reduce(
        (total, row) => total + row.requiredScheduledFTE,
        0
      ) / count;

    const averageAvailableFTE =
      calculatedIntervals.reduce(
        (total, row) => total + row.availableFTE,
        0
      ) / count;

    const averageFTEGap =
      calculatedIntervals.reduce(
        (total, row) => total + row.fteGap,
        0
      ) / count;

    const peakInterval = calculatedIntervals.reduce((peak, row) =>
      row.requiredScheduledFTE > peak.requiredScheduledFTE ? row : peak
    );

    const largestDeficitInterval = calculatedIntervals.reduce(
      (deficit, row) => (row.fteGap < deficit.fteGap ? row : deficit)
    );

    const atRiskIntervals = calculatedIntervals.filter(
      (row) => row.riskLevel === "High" || row.riskLevel === "Critical"
    );

    const highestRisk =
      riskOrder.find((level) =>
        calculatedIntervals.some((row) => row.riskLevel === level)
      ) ?? "Low";

    return {
      totalForecastVolume,
      averageRequiredFTE,
      averageAvailableFTE,
      averageFTEGap,
      peakInterval,
      largestDeficitInterval,
      atRiskIntervals,
      highestRisk,
    };
  }, [calculatedIntervals]);

  /* ------------------------------ Copilot panel ---------------------------- */

  useEffect(() => {
    if (!copilotOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    copilotQuestionRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setCopilotOpen(false);
      }

      if (event.key === "Tab") {
        const panel = document.getElementById("workforce-copilot-panel");

        const focusable = panel?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex="0"]'
        );

        if (!focusable?.length) {
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === last
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      copilotTriggerRef.current?.focus();
    };
  }, [copilotOpen]);

  /* ------------------------------ Row controls ----------------------------- */

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
        if (row.id !== id) {
          return row;
        }

        switch (field) {
          case "interval":
            return { ...row, interval: String(value) };

          case "forecastVolume":
            return { ...row, forecastVolume: Number(value) };

          case "availableFTE":
            return { ...row, availableFTE: Number(value) };
        }
      })
    );

    clearMessages();
  }

  function addInterval() {
    clearMessages();

    const lastRow = intervals[intervals.length - 1];
    let nextTime = "09:00";

    if (lastRow) {
      try {
        const validTime = normalizeInterval(lastRow.interval);
        const [hours, minutes] = validTime.split(":").map(Number);
        const totalMinutes =
          (hours * 60 + minutes + intervalMinutes) % 1440;

        nextTime = `${String(Math.floor(totalMinutes / 60)).padStart(
          2,
          "0"
        )}:${String(totalMinutes % 60).padStart(2, "0")}`;
      } catch {
        setErrorMessage(
          "Correct the last interval time before adding another interval."
        );
        return;
      }
    }

    if (intervals.some((row) => row.interval === nextTime)) {
      setErrorMessage(
        `Interval ${nextTime} already exists. Adjust the interval times before adding another row.`
      );
      return;
    }

    const newRow: IntervalRow = {
      id: nextRowId.current++,
      interval: nextTime,
      forecastVolume: 0,
      availableFTE: 0,
    };

    setIntervals((current) => [...current, newRow]);
  }

  function removeInterval(id: number) {
    setIntervals((current) =>
      current.length > 1
        ? current.filter((row) => row.id !== id)
        : current
    );

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
      "Forecast Volume and Available FTE cleared. Interval times and assumptions retained."
    );

    setErrorMessage("");
    setCopilotResponse(
      "Inputs were reset. Enter new workforce data before requesting analysis."
    );
  }

  /* ------------------------------ CSV import ------------------------------- */

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    clearMessages();

    try {
      const text = (await file.text()).replace(/^\uFEFF/, "").trim();

      if (!text) {
        throw new Error("The selected CSV file is empty.");
      }

      const records = parseCsv(text);

      if (records.length < 2) {
        throw new Error(
          "The CSV must contain a header and at least one data row."
        );
      }

      const headers = records[0].map(normalizeHeader);

      const intervalIndex = headers.findIndex((header) =>
        ["interval", "time", "intervaltime"].includes(header)
      );

      const volumeIndex = headers.findIndex((header) =>
        ["forecastvolume", "volume", "forecast", "contacts"].includes(
          header
        )
      );

      const availableIndex = headers.findIndex((header) =>
        ["availablefte", "fte", "availableagents", "staffing"].includes(
          header
        )
      );

      if ([intervalIndex, volumeIndex, availableIndex].includes(-1)) {
        throw new Error(
          "Required CSV columns: Interval, Forecast Volume, Available FTE."
        );
      }

      const seenTimes = new Set<string>();

      const importedRows: IntervalRow[] = records
        .slice(1)
        .map((values, index) => {
          const rowNumber = index + 2;
          const interval = normalizeInterval(
            values[intervalIndex] ?? ""
          );

          const rawVolume = values[volumeIndex]?.trim() ?? "";
          const rawAvailable = values[availableIndex]?.trim() ?? "";

          if (rawVolume === "" || rawAvailable === "") {
            throw new Error(
              `Row ${rowNumber}: Forecast Volume and Available FTE are required.`
            );
          }

          const forecastVolume = Number(rawVolume);
          const availableFTE = Number(rawAvailable);

          if (
            !Number.isFinite(forecastVolume) ||
            !Number.isInteger(forecastVolume) ||
            forecastVolume < 0
          ) {
            throw new Error(
              `Row ${rowNumber}: Forecast Volume must be a non-negative whole number.`
            );
          }

          if (!Number.isFinite(availableFTE) || availableFTE < 0) {
            throw new Error(
              `Row ${rowNumber}: Available FTE must be zero or greater.`
            );
          }

          if (seenTimes.has(interval)) {
            throw new Error(
              `Row ${rowNumber}: Duplicate interval ${interval}.`
            );
          }

          seenTimes.add(interval);

          return {
            id: nextRowId.current++,
            interval,
            forecastVolume,
            availableFTE,
          };
        });

      importedRows.sort((first, second) =>
        first.interval.localeCompare(second.interval)
      );

      setIntervals(importedRows);
      setMessage(
        `${importedRows.length} interval row(s) imported successfully.`
      );

      setCopilotResponse(
        "New data imported. Select a quick action to refresh the analysis."
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to import the CSV file."
      );
    } finally {
      input.value = "";
    }
  }

  /* ------------------------------ CSV exports ------------------------------ */

  function exportInputsCsv() {
    downloadCsv("wfm-interval-inputs.csv", [
      ["Interval", "Forecast Volume", "Available FTE"],
      ...intervals.map((row) => [
        row.interval,
        row.forecastVolume,
        row.availableFTE,
      ]),
    ]);

    setMessage("Input data exported successfully.");
    setErrorMessage("");
  }

  function exportResultsCsv() {
    if (calculation.error || calculatedIntervals.length === 0) {
      setErrorMessage(
        "Resolve calculation errors and enter interval data before exporting results."
      );
      setMessage("");
      return;
    }

    downloadCsv("wfm-capacity-results.csv", [
      [
        "Interval",
        "Interval Minutes",
        "Forecast Volume",
        "AHT Seconds",
        "SLA Target Percent",
        "Answer Time Target Seconds",
        "Shrinkage Percent",
        "Maximum Occupancy Percent",
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
        intervalMinutes,
        row.forecastVolume,
        ahtSeconds,
        targetSLA,
        answerTime,
        shrinkage,
        maximumOccupancy,
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
    ]);

    setMessage("Calculated results exported successfully.");
    setErrorMessage("");
  }

  /* -------------------------- Local analysis preview ----------------------- */

  function generateLocalCopilotAnalysis(request: string) {
    if (!summary || calculation.error) {
      setCopilotResponse(
        "No valid interval results are available. Check the inputs and calculation messages."
      );
      return;
    }

    if (summary.totalForecastVolume === 0) {
      setCopilotResponse(
        "Forecast volume is zero across all intervals. Enter workload data before assessing capacity."
      );
      return;
    }

    const query = request.toLowerCase();

    if (
      query.includes("action") ||
      query.includes("recommend") ||
      query.includes("overtime")
    ) {
      setCopilotResponse(
        summary.atRiskIntervals.length > 0
          ? `Review coverage during ${summary.atRiskIntervals
              .map((row) => row.interval)
              .join(
                ", "
              )}. Evaluate flexible offline work, cross-skilled support, and approved staffing adjustments. Validate operational constraints before changing schedules.`
          : "No high or critical intervals are identified by the current gap-based rules. Review projected SLA and occupancy before making staffing changes."
      );

      return;
    }

    if (
      query.includes("risk") ||
      query.includes("critical") ||
      query.includes("interval")
    ) {
      setCopilotResponse(
        summary.atRiskIntervals.length > 0
          ? `${summary.atRiskIntervals.length} interval(s) have high or critical risk: ${summary.atRiskIntervals
              .map((row) => row.interval)
              .join(", ")}. The largest staffing deficit is at ${
              summary.largestDeficitInterval.interval
            }, with a gap of ${signedNumber(
              summary.largestDeficitInterval.fteGap
            )} FTE.`
          : `No high or critical intervals are identified. The highest interval risk is ${summary.highestRisk}. Continue reviewing projected SLA, occupancy, and actual demand.`
      );

      return;
    }

    setCopilotResponse(
      `Total forecast volume: ${summary.totalForecastVolume.toLocaleString()}. Average required staffing: ${summary.averageRequiredFTE.toFixed(
        2
      )} FTE. Average available staffing: ${summary.averageAvailableFTE.toFixed(
        2
      )} FTE. Average staffing gap: ${signedNumber(
        summary.averageFTEGap
      )} FTE. Peak staffing requirement: ${
        summary.peakInterval.interval
      }. Highest interval risk: ${summary.highestRisk}.`
    );
  }

  function submitCopilotQuestion() {
    const question = copilotQuestion.trim();

    if (!question) {
      return;
    }

    generateLocalCopilotAnalysis(question);
    setCopilotQuestion("");
  }

  const riskTone: SummaryMetricProps["tone"] =
    !summary
      ? "default"
      : summary.highestRisk === "Critical" ||
          summary.highestRisk === "High"
        ? "negative"
        : summary.highestRisk === "Medium"
          ? "warning"
          : "positive";

  /* -------------------------------- Render -------------------------------- */

  return (
    <main className="wfm-app">
      <style>{appCss}</style>

      <div className="wfm-container">
        <header className="app-header">
          <div className="eyebrow">Workforce Management</div>
          <h1>GSSC WFM</h1>
          <p>Intraday Capacity Planner</p>
        </header>

        {/* Assumptions and summary */}
        <div className="overview-grid">
          <section className="panel">
            <SectionHeading
              title="Assumptions"
              subtitle="Common service and staffing parameters."
            />

            <div className="assumptions-grid">
              <AssumptionField label="Interval" unit="min">
                <NumberInput
                  value={intervalMinutes}
                  min={1}
                  max={1440}
                  allowDecimal={false}
                  onChange={setIntervalMinutes}
                  ariaLabel="Interval length in minutes"
                />
              </AssumptionField>

              <AssumptionField label="SLA Target" unit="%">
                <NumberInput
                  value={targetSLA}
                  min={1}
                  max={99.9}
                  onChange={setTargetSLA}
                  ariaLabel="SLA target percentage"
                />
              </AssumptionField>

              <AssumptionField
                label="ASA Target"
                unit="sec"
                hint="Used by the existing engine as the SLA answer-time threshold, not a calculated average speed of answer."
              >
                <NumberInput
                  value={answerTime}
                  min={0}
                  allowDecimal={false}
                  onChange={setAnswerTime}
                  ariaLabel="Service-level answer-time threshold in seconds"
                />
              </AssumptionField>

              <AssumptionField label="AHT" unit="sec">
                <NumberInput
                  value={ahtSeconds}
                  min={1}
                  onChange={setAhtSeconds}
                  ariaLabel="Average handle time in seconds"
                />
              </AssumptionField>

              <AssumptionField label="Shrinkage" unit="%">
                <NumberInput
                  value={shrinkage}
                  min={0}
                  max={99.9}
                  onChange={setShrinkage}
                  ariaLabel="Shrinkage percentage"
                />
              </AssumptionField>

              <AssumptionField label="Occupancy" unit="%">
                <NumberInput
                  value={maximumOccupancy}
                  min={1}
                  max={99.9}
                  onChange={setMaximumOccupancy}
                  ariaLabel="Maximum occupancy percentage"
                />
              </AssumptionField>
            </div>
          </section>

          <section className="panel">
            <SectionHeading
              title="Daily Capacity Summary"
              subtitle="Calculated from the current interval inputs."
            />

            <div className="summary-grid">
              <SummaryMetric
                label="Total Forecast Volume"
                value={
                  summary?.totalForecastVolume.toLocaleString() ?? "—"
                }
                helper="Across calculated intervals"
              />

              <SummaryMetric
                label="Average FTE Required"
                value={summary?.averageRequiredFTE.toFixed(2) ?? "—"}
                helper="Shrinkage adjusted"
              />

              <SummaryMetric
                label="Average Available FTE"
                value={summary?.averageAvailableFTE.toFixed(2) ?? "—"}
                helper="Current interval staffing"
              />

              <SummaryMetric
                label="FTE Gap"
                value={
                  summary
                    ? signedNumber(summary.averageFTEGap)
                    : "—"
                }
                helper="Average available minus required"
                tone={
                  !summary
                    ? "default"
                    : summary.averageFTEGap < 0
                      ? "negative"
                      : "positive"
                }
              />

              <SummaryMetric
                label="Peak Interval"
                value={summary?.peakInterval.interval ?? "—"}
                helper={
                  summary
                    ? `${summary.peakInterval.requiredScheduledFTE.toFixed(
                        2
                      )} required FTE`
                    : "Highest staffing requirement"
                }
              />

              <SummaryMetric
                label="At-Risk Level"
                value={summary?.highestRisk ?? "—"}
                helper={
                  summary
                    ? `${summary.atRiskIntervals.length} high / critical interval(s)`
                    : "Highest interval risk"
                }
                tone={riskTone}
              />
            </div>
          </section>
        </div>

        {/* Interval inputs with calculated SLA */}
        <section className="panel interval-panel">
          <div className="toolbar">
            <SectionHeading
              title="Daily Interval Outputs"
              subtitle={`Enter workload and staffing for each ${intervalMinutes}-minute interval.`}
            />

            <div className="button-group">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={importCsv}
                hidden
              />

              <ActionButton
                label="Import CSV"
                onClick={() => fileInputRef.current?.click()}
              />

              <ActionButton
                label="Export Inputs"
                onClick={exportInputsCsv}
              />

              <ActionButton
                label="Export Results"
                onClick={exportResultsCsv}
              />

              <ActionButton label="Reset" onClick={resetInputs} />

              <ActionButton
                label="+ Add Interval"
                onClick={addInterval}
                primary
              />
            </div>
          </div>

          <div className="help-box">
            CSV headers: <strong>Interval</strong>,{" "}
            <strong>Forecast Volume</strong>,{" "}
            <strong>Available FTE</strong>. SLA is calculated. Reset
            retains interval times and assumptions.
          </div>

          {message && (
            <div className="notice success" role="status">
              {message}
            </div>
          )}

          {errorMessage && (
            <div className="notice error" role="alert">
              {errorMessage}
            </div>
          )}

          {calculation.error && (
            <div className="notice error" role="alert">
              Calculation error: {calculation.error}
            </div>
          )}

          <div className="table-scroll">
            <table className="data-table input-table">
              <thead>
                <tr>
                  <th scope="col">Interval</th>
                  <th scope="col">Forecast Volume</th>
                  <th scope="col">Available FTE</th>
                  <th scope="col">SLA</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>

              <tbody>
                {intervals.map((row, index) => {
                  const result = resultsById.get(row.id);

                  const meetsTarget =
                    result !== undefined &&
                    result.projectedSLA >= targetSLA / 100;

                  return (
                    <tr key={row.id}>
                      <td>
                        <input
                          className="field-input"
                          type="time"
                          step={60}
                          value={row.interval}
                          aria-label={`Interval row ${index + 1}`}
                          onChange={(event) =>
                            updateInterval(
                              row.id,
                              "interval",
                              event.target.value
                            )
                          }
                        />
                      </td>

                      <td>
                        <NumberInput
                          value={row.forecastVolume}
                          min={0}
                          allowDecimal={false}
                          onChange={(value) =>
                            updateInterval(
                              row.id,
                              "forecastVolume",
                              value
                            )
                          }
                          ariaLabel={`Forecast volume row ${index + 1}`}
                        />
                      </td>

                      <td>
                        <NumberInput
                          value={row.availableFTE}
                          min={0}
                          onChange={(value) =>
                            updateInterval(
                              row.id,
                              "availableFTE",
                              value
                            )
                          }
                          ariaLabel={`Available FTE row ${index + 1}`}
                        />
                      </td>

                      <td>
                        <output
                          className={`sla-output ${
                            result
                              ? meetsTarget
                                ? "sla-positive"
                                : "sla-negative"
                              : ""
                          }`}
                          aria-label={`Projected SLA row ${index + 1}`}
                        >
                          {result
                            ? `${(
                                result.projectedSLA * 100
                              ).toFixed(1)}%`
                            : "—"}
                        </output>
                      </td>

                      <td>
                        <button
                          type="button"
                          className="remove-button"
                          disabled={intervals.length === 1}
                          aria-label={`Remove interval ${row.interval}`}
                          onClick={() => removeInterval(row.id)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {!summary && !calculation.error && (
          <section className="panel empty-state">
            <strong>No interval results available</strong>
            <p>Add interval data to calculate capacity.</p>
          </section>
        )}

        {summary && (
          <>
            {/* Detailed results */}
            <section className="panel results-panel">
              <SectionHeading
                title="Interval Capacity Results"
                subtitle="Calculated staffing, occupancy, SLA, and risk."
              />

              <div className="table-scroll">
                <table className="data-table results-table">
                  <thead>
                    <tr>
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
                        <th key={heading} scope="col">
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {calculatedIntervals.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <strong className="interval-time">
                            {row.interval}
                          </strong>
                        </td>

                        <td>{row.offeredLoad.toFixed(2)}</td>
                        <td>{row.requiredProductiveAgents}</td>
                        <td>
                          {row.requiredScheduledFTE.toFixed(2)}
                        </td>
                        <td>{row.availableFTE.toFixed(2)}</td>

                        <td
                          className={
                            row.fteGap < 0
                              ? "text-negative strong"
                              : "text-positive strong"
                          }
                        >
                          {signedNumber(row.fteGap)}
                        </td>

                        <td>
                          {(row.occupancy * 100).toFixed(1)}%
                        </td>

                        <td>
                          {(row.projectedSLA * 100).toFixed(1)}%
                        </td>

                        <td>
                          <StatusBadge
                            text={row.capacityStatus}
                            tone={
                              row.capacityStatus === "Understaffed"
                                ? "negative"
                                : row.capacityStatus === "Overstaffed"
                                  ? "info"
                                  : "positive"
                            }
                          />
                        </td>

                        <td>
                          <StatusBadge
                            text={row.riskLevel}
                            tone={
                              row.riskLevel === "High" ||
                              row.riskLevel === "Critical"
                                ? "negative"
                                : row.riskLevel === "Medium"
                                  ? "warning"
                                  : "positive"
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="footnote">
                Risk uses the existing staffing-gap and occupancy
                rules. Review projected SLA separately.
              </p>
            </section>

            {/* Executive decision */}
            <section className="panel decision-panel">
              <SectionHeading
                title="Executive Decision"
                subtitle="Planning guidance based on the current inputs."
              />

              {summary.totalForecastVolume === 0 ? (
                <p>
                  Forecast volume is zero across all intervals.
                  Enter workload data before assessing staffing
                  requirements.
                </p>
              ) : summary.atRiskIntervals.length > 0 ? (
                <>
                  <p>
                    <strong>
                      {summary.atRiskIntervals.length}
                    </strong>{" "}
                    interval
                    {summary.atRiskIntervals.length > 1
                      ? "s are"
                      : " is"}{" "}
                    classified as high or critical risk.
                  </p>

                  <p>
                    Review capacity reallocation, flexible offline
                    work, cross-skilled support, and approved
                    staffing adjustments during:
                  </p>

                  <div className="risk-intervals">
                    {summary.atRiskIntervals.map((row) => (
                      <span
                        key={row.id}
                        className={`risk-time ${
                          row.riskLevel === "Critical"
                            ? "critical"
                            : ""
                        }`}
                      >
                        {row.interval}
                      </span>
                    ))}
                  </div>

                  <p>
                    The largest deficit is at{" "}
                    <strong>
                      {summary.largestDeficitInterval.interval}
                    </strong>
                    , with a staffing gap of{" "}
                    <strong className="text-negative">
                      {signedNumber(
                        summary.largestDeficitInterval.fteGap
                      )}{" "}
                      FTE
                    </strong>
                    .
                  </p>
                </>
              ) : (
                <p>
                  No high or critical intervals are identified by
                  the current risk rules. Review projected SLA,
                  occupancy, and actual demand before making
                  staffing changes.
                </p>
              )}
            </section>
          </>
        )}
      </div>

      {/* Local Copilot preview */}
      <button
        ref={copilotTriggerRef}
        type="button"
        className="copilot-floating"
        aria-haspopup="dialog"
        aria-expanded={copilotOpen}
        aria-controls="workforce-copilot-panel"
        onClick={() => setCopilotOpen(true)}
      >
        <span aria-hidden="true">✦</span>
        Workforce Copilot
      </button>

      {copilotOpen && (
        <>
          <div
            className="copilot-overlay"
            aria-hidden="true"
            onClick={() => setCopilotOpen(false)}
          />

          <aside
            id="workforce-copilot-panel"
            className="copilot-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="copilot-title"
          >
            <div className="copilot-header">
              <div>
                <div className="copilot-eyebrow">
                  Local Analysis Preview
                </div>
                <h2 id="copilot-title">Workforce Copilot</h2>
              </div>

              <button
                type="button"
                className="copilot-close"
                aria-label="Close Workforce Copilot"
                onClick={() => setCopilotOpen(false)}
              >
                ×
              </button>
            </div>

            <div className="copilot-body">
              <p className="copilot-description">
                This is a rule-based local preview using the
                dashboard results. It is not connected to Microsoft
                Copilot or an external AI service.
              </p>

              <div className="copilot-actions">
                <ActionButton
                  label="Analyze daily capacity"
                  onClick={() =>
                    generateLocalCopilotAnalysis(
                      "Analyze daily capacity"
                    )
                  }
                />

                <ActionButton
                  label="Identify critical intervals"
                  onClick={() =>
                    generateLocalCopilotAnalysis(
                      "Identify critical interval risks"
                    )
                  }
                />

                <ActionButton
                  label="Recommend operational actions"
                  onClick={() =>
                    generateLocalCopilotAnalysis(
                      "Recommend operational actions"
                    )
                  }
                />
              </div>

              <div
                className="copilot-response"
                role="status"
                aria-live="polite"
              >
                {copilotResponse}
              </div>
            </div>

            <form
              className="copilot-form"
              onSubmit={(event) => {
                event.preventDefault();
                submitCopilotQuestion();
              }}
            >
              <label htmlFor="copilot-question">
                Ask Workforce Copilot
              </label>

              <div className="copilot-question-row">
                <input
                  ref={copilotQuestionRef}
                  id="copilot-question"
                  className="field-input"
                  type="text"
                  value={copilotQuestion}
                  placeholder="Explain today's staffing risk..."
                  autoComplete="off"
                  onChange={(event) =>
                    setCopilotQuestion(event.target.value)
                  }
                />

                <button
                  type="submit"
                  className="action-button primary"
                  disabled={!copilotQuestion.trim()}
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

/* -------------------------------------------------------------------------- */
/* Reusable components                                                        */
/* -------------------------------------------------------------------------- */

function NumberInput({
  value,
  onChange,
  min = 0,
  max,
  allowDecimal = true,
  ariaLabel,
}: NumberInputProps) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function handleChange(rawValue: string) {
    const pattern = allowDecimal ? /^\d*\.?\d*$/ : /^\d*$/;

    if (!pattern.test(rawValue)) {
      return;
    }

    setDraft(rawValue);

    if (rawValue === "" || rawValue === ".") {
      return;
    }

    const parsed = Number(rawValue);

    if (
      Number.isFinite(parsed) &&
      parsed >= min &&
      (max === undefined || parsed <= max)
    ) {
      onChange(parsed);
    }
  }

  function commitValue() {
    const parsed =
      draft.trim() === "" || draft === "." ? min : Number(draft);

    let nextValue = Number.isFinite(parsed) ? parsed : value;

    if (!allowDecimal) {
      nextValue = Math.trunc(nextValue);
    }

    nextValue = Math.max(min, nextValue);

    if (max !== undefined) {
      nextValue = Math.min(max, nextValue);
    }

    setDraft(String(nextValue));
    onChange(nextValue);
  }

  return (
    <input
      className="field-input"
      type="text"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      value={draft}
      aria-label={ariaLabel}
      autoComplete="off"
      onChange={(event) => handleChange(event.target.value)}
      onBlur={commitValue}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function AssumptionField({
  label,
  unit,
  hint,
  children,
}: {
  label: string;
  unit: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="assumption-field" title={hint}>
      <span className="field-label">{label}</span>

      <span className="unit-input">
        {children}
        <span className="input-unit" aria-hidden="true">
          {unit}
        </span>
      </span>
    </label>
  );
}

function SectionHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="section-heading">
      <span className="section-accent" aria-hidden="true" />

      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  helper,
  tone = "default",
}: SummaryMetricProps) {
  return (
    <div className="summary-metric">
      <div className="metric-label">{label}</div>

      <strong className={`metric-value text-${tone}`}>
        {value}
      </strong>

      <div className="metric-helper">{helper}</div>
    </div>
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
      className={`action-button${primary ? " primary" : ""}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function StatusBadge({
  text,
  tone,
}: {
  text: string;
  tone: "positive" | "negative" | "warning" | "info";
}) {
  return <span className={`status-badge badge-${tone}`}>{text}</span>;
}

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const appCss = `
  .wfm-app {
    --primary: #009cde;
    --primary-dark: #006f9e;
    --orange: #ff8200;
    --pale-blue: #eaf8fe;
    --page: #f4fafd;
    --text: #163247;
    --muted: #527080;
    --border: #b9e4f5;
    --green: #067647;
    --green-bg: #ecfdf3;
    --amber: #b54708;
    --amber-bg: #fffaeb;
    --red: #b42318;
    --red-bg: #fef3f2;

    min-height: 100vh;
    width: 100%;
    padding: 20px 16px 100px;
    color: var(--text);
    background: var(--page);
    font-family: Arial, Helvetica, sans-serif;
    font-size: 14px;
    line-height: 1.4;
    text-align: left;
    color-scheme: light;
  }

  .wfm-app,
  .wfm-app *,
  .wfm-app *::before,
  .wfm-app *::after {
    box-sizing: border-box;
  }

  .wfm-app button,
  .wfm-app input {
    font-family: inherit;
  }

  .wfm-app button {
    transition:
      background-color 140ms ease,
      border-color 140ms ease,
      box-shadow 140ms ease;
  }

  .wfm-app button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .wfm-app button:focus-visible,
  .wfm-app input:focus-visible {
    outline: 3px solid rgba(0, 156, 222, 0.35);
    outline-offset: 2px;
  }

  .wfm-container {
    width: 100%;
    max-width: 1440px;
    margin: 0 auto;
  }

  .app-header {
    position: relative;
    overflow: hidden;
    margin-bottom: 18px;
    padding: 22px 28px;
    color: #fff;
    background: var(--primary);
    border-radius: 14px;
    box-shadow: 0 4px 16px rgba(0, 111, 158, 0.1);
  }

  .app-header::after {
    content: "";
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 10px;
    background: var(--orange);
  }

  .eyebrow {
    margin-bottom: 5px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
  }

  .app-header h1 {
    margin: 0;
    color: #fff;
    font-size: 30px;
    font-weight: 700;
    line-height: 1.15;
  }

  .app-header p {
    margin: 6px 0 0;
    color: #fff;
    font-size: 15px;
  }

  .overview-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: stretch;
    gap: 16px;
    margin-bottom: 18px;
  }

  .panel {
    min-width: 0;
    padding: 20px;
    background: #fff;
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: 0 4px 14px rgba(0, 111, 158, 0.05);
  }

  .section-heading {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    min-width: 0;
  }

  .section-accent {
    flex: 0 0 6px;
    width: 6px;
    height: 28px;
    background: var(--orange);
    border-radius: 4px;
  }

  .section-heading h2 {
    margin: 0;
    color: var(--text);
    font-size: 19px;
    font-weight: 700;
    line-height: 1.25;
  }

  .section-heading p {
    margin: 4px 0 0;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.4;
  }

  .assumptions-grid,
  .summary-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: repeat(3, auto);
    grid-auto-flow: column;
    column-gap: 20px;
    row-gap: 12px;
    margin-top: 18px;
  }

  .assumption-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .field-label,
  .metric-label {
    display: block;
    color: var(--text);
    font-size: 12px;
    font-weight: 600;
    line-height: 1.35;
  }

  .unit-input {
    position: relative;
    display: block;
    min-width: 0;
  }

  .field-input {
    display: block;
    width: 100%;
    min-width: 0;
    height: 38px;
    margin: 0;
    padding: 0 10px;
    color: var(--text);
    background: #fff;
    border: 1px solid var(--border);
    border-radius: 7px;
    font-size: 14px;
    font-weight: 400;
    line-height: normal;
  }

  .unit-input .field-input {
    height: 40px;
    padding: 0 44px 0 12px;
    background: var(--pale-blue);
    font-size: 15px;
  }

  .input-unit {
    position: absolute;
    top: 50%;
    right: 12px;
    transform: translateY(-50%);
    color: var(--muted);
    font-size: 12px;
    pointer-events: none;
  }

  .summary-metric {
    min-width: 0;
  }

  .metric-label {
    margin-bottom: 6px;
  }

  .metric-value {
    display: flex;
    align-items: center;
    min-height: 40px;
    padding: 7px 12px;
    background: var(--page);
    border: 1px solid #dce7ee;
    border-radius: 8px;
    font-size: 19px;
    font-weight: 700;
    line-height: 1.2;
    overflow-wrap: anywhere;
    font-variant-numeric: tabular-nums;
  }

  .metric-helper {
    margin-top: 4px;
    color: var(--muted);
    font-size: 10px;
    line-height: 1.3;
  }

  .text-default {
    color: var(--primary-dark);
  }

  .text-positive {
    color: var(--green);
  }

  .text-warning {
    color: var(--amber);
  }

  .text-negative {
    color: var(--red);
  }

  .strong {
    font-weight: 700;
  }

  .interval-panel,
  .results-panel {
    margin-bottom: 18px;
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 14px;
    margin-bottom: 14px;
  }

  .button-group {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .action-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 36px;
    padding: 8px 12px;
    color: var(--primary-dark);
    background: #fff;
    border: 1px solid var(--primary);
    border-radius: 7px;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.3;
    cursor: pointer;
    white-space: nowrap;
  }

  .action-button:hover:not(:disabled) {
    background: var(--pale-blue);
  }

  .action-button.primary {
    color: #fff;
    background: var(--primary);
  }

  .action-button.primary:hover:not(:disabled) {
    background: var(--primary-dark);
  }

  .help-box {
    margin-bottom: 12px;
    padding: 9px 12px;
    color: var(--muted);
    background: var(--pale-blue);
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 11px;
    line-height: 1.5;
  }

  .notice {
    margin-bottom: 12px;
    padding: 10px 12px;
    border: 1px solid;
    border-radius: 8px;
    font-size: 13px;
  }

  .notice.success {
    color: var(--green);
    background: var(--green-bg);
    border-color: #abefc6;
  }

  .notice.error {
    color: var(--red);
    background: var(--red-bg);
    border-color: #fecdca;
  }

  .table-scroll {
    width: 100%;
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: 10px;
  }

  .data-table {
    width: 100%;
    margin: 0;
    border-collapse: separate;
    border-spacing: 0;
    font-variant-numeric: tabular-nums;
  }

  .input-table {
    min-width: 700px;
  }

  .results-table {
    min-width: 1120px;
  }

  .data-table thead {
    color: #fff;
    background: var(--primary);
  }

  .data-table th {
    padding: 12px;
    color: #fff;
    border-bottom: 1px solid var(--primary-dark);
    text-align: left;
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
  }

  .data-table td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    text-align: left;
    font-size: 13px;
    white-space: nowrap;
  }

  .data-table tbody tr:nth-child(even) {
    background: var(--page);
  }

  .data-table tbody tr:last-child td {
    border-bottom: 0;
  }

  .input-table th:nth-child(1) {
    width: 19%;
  }

  .input-table th:nth-child(2),
  .input-table th:nth-child(3) {
    width: 27%;
  }

  .input-table th:nth-child(4) {
    width: 14%;
  }

  .input-table th:nth-child(5) {
    width: 13%;
  }

  .sla-output {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 76px;
    min-height: 34px;
    padding: 0 10px;
    color: var(--muted);
    background: var(--page);
    border-radius: 7px;
    font-size: 13px;
    font-weight: 700;
  }

  .sla-positive {
    color: var(--green);
    background: var(--green-bg);
  }

  .sla-negative {
    color: var(--red);
    background: var(--red-bg);
  }

  .remove-button {
    min-height: 34px;
    padding: 7px 11px;
    color: var(--red);
    background: var(--red-bg);
    border: 1px solid #fecdca;
    border-radius: 7px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .remove-button:hover:not(:disabled) {
    background: #fee4e2;
  }

  .results-panel > .section-heading {
    margin-bottom: 16px;
  }

  .interval-time {
    color: var(--primary-dark);
  }

  .status-badge {
    display: inline-block;
    padding: 5px 9px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
  }

  .badge-positive {
    color: var(--green);
    background: var(--green-bg);
  }

  .badge-negative {
    color: var(--red);
    background: var(--red-bg);
  }

  .badge-warning {
    color: var(--amber);
    background: var(--amber-bg);
  }

  .badge-info {
    color: var(--primary-dark);
    background: var(--pale-blue);
  }

  .footnote {
    margin: 12px 0 0;
    color: var(--muted);
    font-size: 11px;
  }

  .decision-panel {
    background: var(--pale-blue);
    border-left: 6px solid var(--orange);
  }

  .decision-panel p {
    margin: 12px 0 0;
    line-height: 1.6;
  }

  .risk-intervals {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 14px;
  }

  .risk-time {
    padding: 6px 11px;
    color: #fff;
    background: #b85c00;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
  }

  .risk-time.critical {
    background: var(--red);
  }

  .empty-state {
    margin-bottom: 18px;
    color: var(--muted);
    text-align: center;
  }

  .empty-state p {
    margin-bottom: 0;
  }

  .copilot-floating {
    position: fixed;
    right: 24px;
    bottom: 24px;
    z-index: 1000;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 13px 18px;
    color: #fff;
    background: var(--primary-dark);
    border: 2px solid #fff;
    border-radius: 999px;
    box-shadow: 0 8px 24px rgba(0, 111, 158, 0.25);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }

  .copilot-overlay {
    position: fixed;
    inset: 0;
    z-index: 1001;
    background: rgba(22, 50, 71, 0.3);
  }

  .copilot-panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 1002;
    display: flex;
    flex-direction: column;
    width: min(440px, 100vw);
    background: #fff;
    box-shadow: -12px 0 35px rgba(22, 50, 71, 0.22);
  }

  .copilot-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 20px;
    color: #fff;
    background: var(--primary-dark);
    border-right: 8px solid var(--orange);
  }

  .copilot-header h2 {
    margin: 0;
    color: #fff;
    font-size: 20px;
  }

  .copilot-eyebrow {
    margin-bottom: 4px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  .copilot-close {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    padding: 0;
    color: #fff;
    background: rgba(255, 255, 255, 0.15);
    border: 1px solid rgba(255, 255, 255, 0.4);
    border-radius: 50%;
    font-size: 24px;
    cursor: pointer;
  }

  .copilot-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 20px;
  }

  .copilot-description {
    margin: 0 0 18px;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.6;
  }

  .copilot-actions {
    display: grid;
    gap: 10px;
    margin-bottom: 20px;
  }

  .copilot-actions .action-button {
    justify-content: flex-start;
    padding: 11px 12px;
    text-align: left;
    white-space: normal;
  }

  .copilot-response {
    padding: 16px;
    color: var(--text);
    background: var(--pale-blue);
    border: 1px solid var(--border);
    border-left: 5px solid var(--orange);
    border-radius: 10px;
    font-size: 13px;
    line-height: 1.7;
    white-space: pre-wrap;
  }

  .copilot-form {
    padding: 16px;
    background: var(--page);
    border-top: 1px solid var(--border);
  }

  .copilot-form label {
    display: block;
    margin-bottom: 8px;
    font-size: 12px;
    font-weight: 700;
  }

  .copilot-question-row {
    display: flex;
    gap: 8px;
  }

  .copilot-question-row .field-input {
    flex: 1;
    height: 40px;
  }

  @media (max-width: 980px) {
    .overview-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .toolbar {
      align-items: flex-start;
    }
  }

  @media (max-width: 540px) {
    .wfm-app {
      padding: 12px 10px 90px;
    }

    .app-header {
      padding: 18px 20px;
    }

    .app-header h1 {
      font-size: 26px;
    }

    .panel {
      padding: 16px;
    }

    .section-heading h2 {
      font-size: 17px;
    }

    .assumptions-grid,
    .summary-grid {
      column-gap: 12px;
    }

    .metric-value {
      font-size: 17px;
    }

    .button-group {
      width: 100%;
    }

    .button-group .action-button {
      flex: 1 1 auto;
    }

    .copilot-floating {
      right: 14px;
      bottom: 14px;
      padding: 12px 15px;
    }
  }
`;

export default App;