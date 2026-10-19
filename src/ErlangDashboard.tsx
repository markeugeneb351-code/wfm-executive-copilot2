import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";

import {
  calculateWorkforce,
  type WorkforceResult,
} from "./calculations/erlangC";

/* -------------------------------------------------------------------------- */
/* Types and defaults                                                         */
/* -------------------------------------------------------------------------- */

interface IntervalRow {
  id: number;
  interval: string;
  forecastVolume: number;
  availableFTE: number;
}

type RiskLevel = "Low" | "Medium" | "High" | "Critical";
type Tone = "default" | "positive" | "warning" | "negative" | "info";

interface CalculatedInterval extends IntervalRow, WorkforceResult {
  riskLevel: RiskLevel;
}

interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  integer?: boolean;
  label: string;
}

const initialIntervals: IntervalRow[] = [
  { id: 1, interval: "09:00", forecastVolume: 50, availableFTE: 40 },
  { id: 2, interval: "09:15", forecastVolume: 50, availableFTE: 40 },
  { id: 3, interval: "09:30", forecastVolume: 58, availableFTE: 42 },
  { id: 4, interval: "09:45", forecastVolume: 57, availableFTE: 43 },
];

const riskOrder: RiskLevel[] = ["Critical", "High", "Medium", "Low"];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function normalizeInterval(value: string) {
  const match = value.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);

  if (!match) {
    throw new Error(`Invalid interval "${value}". Use HH:MM.`);
  }

  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function formatPercent(value: number | null) {
  return value === null ? "N/A" : `${(value * 100).toFixed(1)}%`;
}

function formatSeconds(value: number | null) {
  return value === null ? "N/A" : `${value.toFixed(1)} sec`;
}

function signed(value: number) {
  const rounded = Number(value.toFixed(2));
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}`;
}

function getRiskTone(risk: RiskLevel): Tone {
  if (risk === "Critical" || risk === "High") return "negative";
  if (risk === "Medium") return "warning";
  return "positive";
}

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
      if (character === "\r" && next === "\n") index += 1;
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

function escapeCsv(value: string | number) {
  const text = String(value);

  return /[",\r\n]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

function downloadCsv(
  filename: string,
  rows: Array<Array<string | number>>
) {
  const content = rows
    .map((row) => row.map(escapeCsv).join(","))
    .join("\r\n");

  const blob = new Blob([`\uFEFF${content}`], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
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
  const nextId = useRef(5);

  const copilotTriggerRef = useRef<HTMLButtonElement>(null);
  const copilotPanelRef = useRef<HTMLElement>(null);
  const copilotInputRef = useRef<HTMLInputElement>(null);

  const [intervalMinutes, setIntervalMinutes] = useState(15);
  const [targetSLA, setTargetSLA] = useState(80);
  const [answerTime, setAnswerTime] = useState(90);
  const [ahtSeconds, setAhtSeconds] = useState(420);
  const [shrinkage, setShrinkage] = useState(30);
  const [maximumOccupancy, setMaximumOccupancy] = useState(85);

  const [intervals, setIntervals] =
    useState<IntervalRow[]>(initialIntervals);

  const [inputRevision, setInputRevision] = useState(0);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotQuestion, setCopilotQuestion] = useState("");
  const [copilotResponse, setCopilotResponse] = useState(
    "Select a quick action to analyze the current results."
  );

  /* ------------------------------ Calculations ----------------------------- */

  const calculation = useMemo(() => {
    try {
      if (
        !Number.isInteger(intervalMinutes) ||
        intervalMinutes < 1 ||
        intervalMinutes > 1440
      ) {
        throw new Error(
          "Interval minutes must be a whole number between 1 and 1440."
        );
      }

      const seen = new Set<string>();

      const results: CalculatedInterval[] = intervals.map((row) => {
        const interval = normalizeInterval(row.interval);

        if (seen.has(interval)) {
          throw new Error(`Duplicate interval: ${interval}.`);
        }

        seen.add(interval);

        const result = calculateWorkforce({
          forecastVolume: row.forecastVolume,
          availableFTE: row.availableFTE,
          ahtSeconds,
          intervalSeconds: intervalMinutes * 60,
          targetSLA: targetSLA / 100,
          answerTimeSeconds: answerTime,
          shrinkage: shrinkage / 100,
          maximumOccupancy: maximumOccupancy / 100,
        });

        const gapRatio =
          result.requiredScheduledFTE > 0
            ? result.fteGap / result.requiredScheduledFTE
            : 0;

        let riskLevel: RiskLevel = "Low";

        if (row.forecastVolume > 0) {
          if (!result.queueStable || gapRatio <= -0.15) {
            riskLevel = "Critical";
          } else if (
            !result.serviceLevelTargetMet ||
            gapRatio < -0.02
          ) {
            riskLevel = "High";
          } else if (
            !result.occupancyTargetMet ||
            result.fteGap < 0
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
            : "Unable to calculate workforce requirements.",
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

  const results = calculation.results;

  const summary = useMemo(() => {
    if (results.length === 0) return null;

    const count = results.length;

    const totalForecastVolume = results.reduce(
      (total, row) => total + row.forecastVolume,
      0
    );

    const averageRequiredFTE =
      results.reduce(
        (total, row) => total + row.requiredScheduledFTE,
        0
      ) / count;

    const averageAvailableFTE =
      results.reduce(
        (total, row) => total + row.availableFTE,
        0
      ) / count;

    const averageFTEGap =
      results.reduce((total, row) => total + row.fteGap, 0) /
      count;

    const peakInterval = results.reduce((peak, row) =>
      row.requiredScheduledFTE > peak.requiredScheduledFTE
        ? row
        : peak
    );

    const largestDeficit = results.reduce((lowest, row) =>
      row.fteGap < lowest.fteGap ? row : lowest
    );

    const atRisk = results.filter(
      (row) =>
        row.riskLevel === "Critical" || row.riskLevel === "High"
    );

    const unstable = results.filter((row) => !row.queueStable);

    const highestRisk =
      riskOrder.find((risk) =>
        results.some((row) => row.riskLevel === risk)
      ) ?? "Low";

    return {
      totalForecastVolume,
      averageRequiredFTE,
      averageAvailableFTE,
      averageFTEGap,
      peakInterval,
      largestDeficit,
      atRisk,
      unstable,
      highestRisk,
    };
  }, [results]);

  const hourlyRequirements = useMemo(() => {
    const groups = new Map<
      string,
      {
        hour: string;
        count: number;
        net: number;
        scheduled: number;
      }
    >();

    for (const row of results) {
      const hour = `${row.interval.slice(0, 2)}:00`;

      const group = groups.get(hour) ?? {
        hour,
        count: 0,
        net: 0,
        scheduled: 0,
      };

      group.count += 1;
      group.net = Math.max(
        group.net,
        row.requiredProductiveAgents
      );
      group.scheduled = Math.max(
        group.scheduled,
        row.requiredScheduledFTE
      );

      groups.set(hour, group);
    }

    return Array.from(groups.values()).sort((a, b) =>
      a.hour.localeCompare(b.hour)
    );
  }, [results]);

  /* ------------------------------ Copilot panel ---------------------------- */

  useEffect(() => {
    if (!copilotOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    copilotInputRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setCopilotOpen(false);
        return;
      }

      if (event.key !== "Tab") return;

      const elements =
        copilotPanelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled])'
        );

      if (!elements?.length) return;

      const first = elements[0];
      const last = elements[elements.length - 1];

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

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      copilotTriggerRef.current?.focus();
    };
  }, [copilotOpen]);

  /* ------------------------------ Input actions ---------------------------- */

  function clearMessages() {
    setMessage("");
    setErrorMessage("");
  }

  function updateRow(
    id: number,
    changes: Partial<Omit<IntervalRow, "id">>
  ) {
    setIntervals((current) =>
      current.map((row) =>
        row.id === id ? { ...row, ...changes } : row
      )
    );

    clearMessages();
  }

  function addInterval() {
    clearMessages();

    try {
      const last = intervals[intervals.length - 1];
      let nextTime = "09:00";

      if (last) {
        const [hours, minutes] = normalizeInterval(last.interval)
          .split(":")
          .map(Number);

        const total =
          (hours * 60 + minutes + intervalMinutes) % 1440;

        nextTime = `${String(Math.floor(total / 60)).padStart(
          2,
          "0"
        )}:${String(total % 60).padStart(2, "0")}`;
      }

      if (intervals.some((row) => row.interval === nextTime)) {
        throw new Error(
          `${nextTime} already exists. Adjust the interval times first.`
        );
      }

      const row: IntervalRow = {
        id: nextId.current++,
        interval: nextTime,
        forecastVolume: 0,
        availableFTE: 0,
      };

      setIntervals((current) => [...current, row]);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to add an interval."
      );
    }
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

    // Remount row inputs to clear any unfinished numeric drafts.
    setInputRevision((current) => current + 1);

    setMessage(
      "Forecast Volume and Available FTE cleared. Interval times and assumptions retained."
    );
    setErrorMessage("");
    setCopilotResponse(
      "Inputs were reset. Enter new workload data before analyzing capacity."
    );
  }

  /* ------------------------------ CSV actions ------------------------------ */

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];

    if (!file) return;

    clearMessages();

    try {
      const text = (await file.text())
        .replace(/^\uFEFF/, "")
        .trim();

      if (!text) throw new Error("The selected CSV is empty.");

      const records = parseCsv(text);

      if (records.length < 2) {
        throw new Error(
          "The CSV needs a header and at least one data row."
        );
      }

      const headers = records[0].map(normalizeHeader);

      const timeIndex = headers.findIndex((header) =>
        ["interval", "time", "intervaltime"].includes(header)
      );

      const volumeIndex = headers.findIndex((header) =>
        [
          "forecastvolume",
          "volume",
          "forecast",
          "contacts",
          "callsoffered",
        ].includes(header)
      );

      const staffingIndex = headers.findIndex((header) =>
        [
          "availablefte",
          "scheduledfte",
          "fte",
          "availableagents",
          "staffing",
        ].includes(header)
      );

      if ([timeIndex, volumeIndex, staffingIndex].includes(-1)) {
        throw new Error(
          "Required columns: Interval, Forecast Volume, Available FTE."
        );
      }

      const seen = new Set<string>();

      const imported: IntervalRow[] = records
        .slice(1)
        .map((values, index) => {
          const rowNumber = index + 2;
          const interval = normalizeInterval(
            values[timeIndex] ?? ""
          );

          const rawVolume = values[volumeIndex]?.trim() ?? "";
          const rawStaffing = values[staffingIndex]?.trim() ?? "";

          if (rawVolume === "" || rawStaffing === "") {
            throw new Error(
              `Row ${rowNumber}: Volume and staffing are required.`
            );
          }

          const forecastVolume = Number(rawVolume);
          const availableFTE = Number(rawStaffing);

          if (
            !Number.isFinite(forecastVolume) ||
            !Number.isInteger(forecastVolume) ||
            forecastVolume < 0
          ) {
            throw new Error(
              `Row ${rowNumber}: Forecast volume must be a non-negative whole number.`
            );
          }

          if (
            !Number.isFinite(availableFTE) ||
            availableFTE < 0
          ) {
            throw new Error(
              `Row ${rowNumber}: Available FTE must be zero or greater.`
            );
          }

          if (seen.has(interval)) {
            throw new Error(
              `Row ${rowNumber}: Duplicate interval ${interval}.`
            );
          }

          seen.add(interval);

          return {
            id: nextId.current++,
            interval,
            forecastVolume,
            availableFTE,
          };
        });

      imported.sort((a, b) =>
        a.interval.localeCompare(b.interval)
      );

      setIntervals(imported);
      setMessage(`${imported.length} interval(s) imported.`);
      setCopilotResponse(
        "New data imported. Run an analysis action to refresh the response."
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to import the CSV."
      );
    } finally {
      input.value = "";
    }
  }

  function exportInputs() {
    downloadCsv("wfm-interval-inputs.csv", [
      ["Interval", "Forecast Volume", "Available FTE"],
      ...intervals.map((row) => [
        row.interval,
        row.forecastVolume,
        row.availableFTE,
      ]),
    ]);

    setMessage("Input data exported.");
    setErrorMessage("");
  }

  function exportResults() {
    if (calculation.error || results.length === 0) {
      setErrorMessage(
        "Resolve calculation errors before exporting results."
      );
      setMessage("");
      return;
    }

    const csvPercent = (value: number | null) =>
      value === null ? "N/A" : (value * 100).toFixed(1);

    downloadCsv("wfm-erlang-c-results.csv", [
      [
        "Interval",
        "Interval Minutes",
        "Forecast Volume",
        "AHT Seconds",
        "SLA Target Percent",
        "Answer Target Seconds",
        "Shrinkage Percent",
        "Maximum Occupancy Percent",
        "Traffic Erlangs",
        "Required Net Agents",
        "Required Scheduled Agents",
        "Available Scheduled FTE",
        "Available Productive FTE",
        "Available Net Agents",
        "Scheduled FTE Gap",
        "Projected Occupancy Percent",
        "Estimated ASA Seconds",
        "Projected SLA Percent",
        "Probability Of Wait Percent",
        "Demand Capacity Ratio Percent",
        "Queue Stable",
        "SLA Target Met",
        "Occupancy Target Met",
        "SLA At Required Staffing Percent",
        "Occupancy At Required Staffing Percent",
        "ASA At Required Staffing Seconds",
        "Capacity Status",
        "Risk",
      ],
      ...results.map((row) => [
        row.interval,
        intervalMinutes,
        row.forecastVolume,
        ahtSeconds,
        targetSLA,
        answerTime,
        shrinkage,
        maximumOccupancy,
        row.offeredLoad.toFixed(2),
        row.requiredProductiveAgents,
        row.requiredScheduledFTE,
        row.availableFTE.toFixed(2),
        row.availableProductiveFTE.toFixed(2),
        row.availableProductiveAgents,
        row.fteGap.toFixed(2),
        csvPercent(row.occupancy),
        row.estimatedASASeconds === null
          ? "N/A"
          : row.estimatedASASeconds.toFixed(1),
        csvPercent(row.projectedSLA),
        csvPercent(row.probabilityOfWait),
        csvPercent(row.demandCapacityRatio),
        row.queueStable ? "Yes" : "No",
        row.serviceLevelTargetMet ? "Yes" : "No",
        row.occupancyTargetMet ? "Yes" : "No",
        csvPercent(row.requiredStaffingSLA),
        csvPercent(row.requiredStaffingOccupancy),
        row.requiredStaffingASASeconds.toFixed(1),
        row.capacityStatus,
        row.riskLevel,
      ]),
    ]);

    setMessage("Erlang C results exported.");
    setErrorMessage("");
  }

  /* ------------------------------ Local analysis --------------------------- */

  function analyze(request: string) {
    if (!summary || calculation.error) {
      setCopilotResponse(
        "No valid results are available. Resolve the calculation messages first."
      );
      return;
    }

    if (summary.totalForecastVolume === 0) {
      setCopilotResponse(
        "Forecast volume is zero. Enter workload data before assessing staffing."
      );
      return;
    }

    const query = request.toLowerCase();

    const unstableNote =
      summary.unstable.length > 0
        ? ` ${summary.unstable.length} interval(s) have unstable queues: ${summary.unstable
            .map((row) => row.interval)
            .join(
              ", "
            )}. Steady-state SLA and ASA are unavailable for these intervals.`
        : " All entered intervals have stable queues.";

    if (
      query.includes("action") ||
      query.includes("recommend")
    ) {
      setCopilotResponse(
        summary.atRisk.length > 0
          ? `Review coverage during ${summary.atRisk
              .map((row) => row.interval)
              .join(
                ", "
              )}. Evaluate approved capacity reallocation, flexible offline work, and cross-skilled support. Validate constraints before changing schedules.${unstableNote}`
          : `No high or critical intervals are identified. Continue reviewing demand, SLA, occupancy, and staffing assumptions.${unstableNote}`
      );
      return;
    }

    if (
      query.includes("risk") ||
      query.includes("critical") ||
      query.includes("unstable")
    ) {
      setCopilotResponse(
        `Highest risk: ${summary.highestRisk}. High or critical intervals: ${summary.atRisk.length}.${unstableNote}`
      );
      return;
    }

    setCopilotResponse(
      `Forecast volume: ${summary.totalForecastVolume.toLocaleString()}. Average scheduled requirement: ${summary.averageRequiredFTE.toFixed(
        2
      )}. Average scheduled availability: ${summary.averageAvailableFTE.toFixed(
        2
      )}. Average gap: ${signed(
        summary.averageFTEGap
      )} FTE. Peak requirement: ${
        summary.peakInterval.interval
      }.${unstableNote}`
    );
  }

  /* -------------------------------- Render -------------------------------- */

  return (
    <main className="wfm-app">
      <style>{appCss}</style>

      <div className="wfm-container">
        <header className="app-header">
          <div className="eyebrow">Workforce Management</div>
          <h1>GSSC WFM</h1>
          <p>Intraday Capacity Planner · Erlang C</p>
        </header>

        <div className="overview-grid">
          <section className="panel">
            <SectionHeading
              title="Assumptions"
              subtitle="Common service and staffing parameters."
            />

            <div className="assumptions-grid">
              <Assumption label="Interval" unit="min">
                <NumberInput
                  value={intervalMinutes}
                  onChange={setIntervalMinutes}
                  min={1}
                  max={1440}
                  integer
                  label="Interval minutes"
                />
              </Assumption>

              <Assumption label="SLA Target" unit="%">
                <NumberInput
                  value={targetSLA}
                  onChange={setTargetSLA}
                  min={1}
                  max={99.9}
                  label="SLA target percentage"
                />
              </Assumption>

              <Assumption label="Answer Target" unit="sec">
                <NumberInput
                  value={answerTime}
                  onChange={setAnswerTime}
                  min={0}
                  integer
                  label="SLA answer-time threshold in seconds"
                />
              </Assumption>

              <Assumption label="AHT" unit="sec">
                <NumberInput
                  value={ahtSeconds}
                  onChange={setAhtSeconds}
                  min={1}
                  label="Average handle time in seconds"
                />
              </Assumption>

              <Assumption label="Shrinkage" unit="%">
                <NumberInput
                  value={shrinkage}
                  onChange={setShrinkage}
                  min={0}
                  max={99.9}
                  label="Shrinkage percentage"
                />
              </Assumption>

              <Assumption label="Max Occupancy" unit="%">
                <NumberInput
                  value={maximumOccupancy}
                  onChange={setMaximumOccupancy}
                  min={1}
                  max={99.9}
                  label="Maximum occupancy percentage"
                />
              </Assumption>
            </div>

            <p className="footnote">
              Available FTE means scheduled staffing before shrinkage.
              Available productive agents are rounded down after
              shrinkage.
            </p>
          </section>

          <section className="panel">
            <SectionHeading
              title="Daily Capacity Summary"
              subtitle="Scheduled requirements and availability."
            />

            <div className="summary-grid">
              <Metric
                label="Total Forecast Volume"
                value={
                  summary?.totalForecastVolume.toLocaleString() ?? "—"
                }
                helper="Across entered intervals"
              />

              <Metric
                label="Average FTE Required"
                value={
                  summary?.averageRequiredFTE.toFixed(2) ?? "—"
                }
                helper="Scheduled, shrinkage adjusted"
              />

              <Metric
                label="Average Available FTE"
                value={
                  summary?.averageAvailableFTE.toFixed(2) ?? "—"
                }
                helper="Scheduled, before shrinkage"
              />

              <Metric
                label="Average FTE Gap"
                value={
                  summary ? signed(summary.averageFTEGap) : "—"
                }
                helper="Available minus required"
                tone={
                  !summary
                    ? "default"
                    : summary.averageFTEGap < 0
                      ? "negative"
                      : "positive"
                }
              />

              <Metric
                label="Peak Interval"
                value={summary?.peakInterval.interval ?? "—"}
                helper={
                  summary
                    ? `${summary.peakInterval.requiredScheduledFTE} scheduled agents required`
                    : "Highest staffing requirement"
                }
              />

              <Metric
                label="At-Risk Level"
                value={summary?.highestRisk ?? "—"}
                helper={
                  summary
                    ? `${summary.atRisk.length} high / critical; ${summary.unstable.length} unstable`
                    : "Highest interval risk"
                }
                tone={
                  summary
                    ? getRiskTone(summary.highestRisk)
                    : "default"
                }
              />
            </div>
          </section>
        </div>

        {/* No SLA column in Daily Interval Outputs. */}
        <section className="panel spaced">
          <div className="toolbar">
            <SectionHeading
              title="Daily Interval Outputs"
              subtitle={`Enter workload and scheduled staffing for ${intervalMinutes}-minute intervals.`}
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
                onClick={exportInputs}
              />
              <ActionButton
                label="Export Results"
                onClick={exportResults}
              />
              <ActionButton
                label="Reset"
                onClick={resetInputs}
              />
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
            <strong>Available FTE</strong>. Available FTE is scheduled
            staffing before shrinkage. Reset retains times and
            assumptions.
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
                  <th scope="col">Action</th>
                </tr>
              </thead>

              <tbody key={inputRevision}>
                {intervals.map((row, index) => (
                  <tr key={row.id}>
                    <td>
                      <input
                        className="field-input"
                        type="time"
                        step={60}
                        value={row.interval}
                        aria-label={`Interval row ${index + 1}`}
                        onChange={(event) =>
                          updateRow(row.id, {
                            interval: event.target.value,
                          })
                        }
                      />
                    </td>

                    <td>
                      <NumberInput
                        value={row.forecastVolume}
                        onChange={(value) =>
                          updateRow(row.id, {
                            forecastVolume: value,
                          })
                        }
                        min={0}
                        integer
                        label={`Forecast volume row ${index + 1}`}
                      />
                    </td>

                    <td>
                      <NumberInput
                        value={row.availableFTE}
                        onChange={(value) =>
                          updateRow(row.id, {
                            availableFTE: value,
                          })
                        }
                        min={0}
                        label={`Scheduled available FTE row ${
                          index + 1
                        }`}
                      />
                    </td>

                    <td>
                      <button
                        type="button"
                        className="remove-button"
                        disabled={intervals.length === 1}
                        onClick={() => removeInterval(row.id)}
                        aria-label={`Remove interval ${row.interval}`}
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

        {summary && (
          <>
            <section className="panel spaced">
              <SectionHeading
                title="Interval Capacity Results"
                subtitle={`Performance at available productive staffing. Target: ${targetSLA}% within ${answerTime} seconds.`}
              />

              {summary.unstable.length > 0 && (
                <div className="notice error result-warning">
                  <strong>
                    {summary.unstable.length} unstable interval(s).
                  </strong>{" "}
                  Available productive agents do not exceed offered
                  load. Steady-state SLA, ASA, occupancy, and wait
                  probability are unavailable.
                </div>
              )}

              <div className="table-scroll section-table">
                <table className="data-table results-table">
                  <thead>
                    <tr>
                      {[
                        "Interval",
                        "Traffic",
                        "Required Net",
                        "Required Scheduled",
                        "Available Scheduled",
                        "Available Net",
                        "Gap",
                        "Occupancy",
                        "ASA",
                        "Projected SLA",
                        "Wait Probability",
                        "Queue",
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
                    {results.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <strong className="text-info">
                            {row.interval}
                          </strong>
                        </td>

                        <td>{row.offeredLoad.toFixed(2)}</td>
                        <td>{row.requiredProductiveAgents}</td>
                        <td>{row.requiredScheduledFTE}</td>
                        <td>{row.availableFTE.toFixed(2)}</td>

                        <td
                          title={`${row.availableProductiveFTE.toFixed(
                            2
                          )} productive FTE before rounding down`}
                        >
                          {row.availableProductiveAgents}
                        </td>

                        <td
                          className={
                            row.fteGap < 0
                              ? "text-negative strong"
                              : "text-positive strong"
                          }
                        >
                          {signed(row.fteGap)}
                        </td>

                        <td
                          className={
                            !row.queueStable
                              ? "text-negative"
                              : row.occupancyTargetMet
                                ? ""
                                : "text-warning strong"
                          }
                        >
                          {formatPercent(row.occupancy)}
                        </td>

                        <td>
                          {row.queueStable
                            ? formatSeconds(row.estimatedASASeconds)
                            : "Unstable"}
                        </td>

                        <td
                          className={
                            row.serviceLevelTargetMet
                              ? "text-positive strong"
                              : "text-negative strong"
                          }
                        >
                          {row.queueStable
                            ? formatPercent(row.projectedSLA)
                            : "Unstable"}
                        </td>

                        <td>
                          {formatPercent(row.probabilityOfWait)}
                        </td>

                        <td>
                          <Badge
                            text={
                              row.queueStable ? "Stable" : "Unstable"
                            }
                            tone={
                              row.queueStable
                                ? "positive"
                                : "negative"
                            }
                          />
                        </td>

                        <td>
                          <Badge
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
                          <Badge
                            text={row.riskLevel}
                            tone={getRiskTone(row.riskLevel)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="footnote">
                Required Net meets both SLA and maximum occupancy.
                Required Scheduled is rounded up after shrinkage.
                Available Net is rounded down after shrinkage.
                Projected performance uses Available Net, not
                Required Net. Zero-demand intervals use 100% SLA
                and zero waiting as a no-demand convention.
              </p>
            </section>

            <section className="panel spaced">
              <SectionHeading
                title="Hourly Peak Requirements"
                subtitle="Maximum requirement among entered intervals starting in each hour."
              />

              <div className="table-scroll section-table">
                <table className="data-table hourly-table">
                  <thead>
                    <tr>
                      <th scope="col">Hour Starting</th>
                      <th scope="col">Intervals Entered</th>
                      <th scope="col">Peak Net Agents</th>
                      <th scope="col">Peak Scheduled Agents</th>
                    </tr>
                  </thead>

                  <tbody>
                    {hourlyRequirements.map((row) => (
                      <tr key={row.hour}>
                        <td>{row.hour}</td>
                        <td>{row.count}</td>
                        <td>{row.net}</td>
                        <td>{row.scheduled}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="footnote">
                Missing intervals are not inferred. This is a
                single-day peak summary, not a shift schedule.
              </p>
            </section>

            <section className="panel decision-panel">
              <SectionHeading
                title="Executive Decision"
                subtitle="Planning guidance based on the current inputs."
              />

              {summary.totalForecastVolume === 0 ? (
                <p>
                  Forecast volume is zero. Enter workload data
                  before assessing staffing requirements.
                </p>
              ) : summary.atRisk.length > 0 ? (
                <>
                  <p>
                    <strong>{summary.atRisk.length}</strong>{" "}
                    interval(s) are high or critical risk.
                    Prioritize reviewing these intervals:
                  </p>

                  <div className="risk-intervals">
                    {summary.atRisk.map((row) => (
                      <Badge
                        key={row.id}
                        text={`${row.interval} · ${row.riskLevel}`}
                        tone={getRiskTone(row.riskLevel)}
                      />
                    ))}
                  </div>

                  {summary.unstable.length > 0 && (
                    <p className="text-negative">
                      <strong>
                        {summary.unstable.length} interval(s)
                        have unstable queues.
                      </strong>{" "}
                      Unavailable SLA does not mean the target is met.
                    </p>
                  )}

                  {summary.largestDeficit.fteGap < 0 && (
                    <p>
                      Largest scheduled staffing deficit:{" "}
                      <strong>
                        {summary.largestDeficit.interval}
                      </strong>
                      , with a gap of{" "}
                      <strong className="text-negative">
                        {signed(summary.largestDeficit.fteGap)} FTE
                      </strong>
                      .
                    </p>
                  )}

                  <p>
                    Review approved capacity reallocation,
                    flexible offline work, and cross-skilled
                    support. Validate staffing assumptions and
                    operational constraints before changing
                    schedules.
                  </p>
                </>
              ) : (
                <p>
                  No high or critical intervals are identified.
                  Continue reviewing projected SLA, occupancy,
                  staffing gaps, and actual demand.
                </p>
              )}

              <p className="footnote">
                Risk labels are dashboard rules based on queue
                stability, SLA, occupancy, and staffing gaps.
                They are not outputs of the Erlang C equation.
              </p>
            </section>
          </>
        )}
      </div>

      <button
        ref={copilotTriggerRef}
        type="button"
        className="copilot-floating"
        aria-haspopup="dialog"
        aria-expanded={copilotOpen}
        aria-controls="workforce-copilot"
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
            ref={copilotPanelRef}
            id="workforce-copilot"
            className="copilot-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="copilot-title"
          >
            <div className="copilot-header">
              <div>
                <div className="eyebrow">
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
              <p className="muted">
                Rule-based local analysis of the current
                calculations. No external AI service is connected.
                Run an action again after changing inputs.
              </p>

              <div className="copilot-actions">
                <ActionButton
                  label="Analyze daily capacity"
                  onClick={() => analyze("Analyze daily capacity")}
                />
                <ActionButton
                  label="Identify critical and unstable intervals"
                  onClick={() => analyze("Identify critical risks")}
                />
                <ActionButton
                  label="Recommend operational actions"
                  onClick={() => analyze("Recommend actions")}
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

                const question = copilotQuestion.trim();
                if (!question) return;

                analyze(question);
                setCopilotQuestion("");
              }}
            >
              <label htmlFor="copilot-question">
                Ask Workforce Copilot
              </label>

              <div className="copilot-question-row">
                <input
                  ref={copilotInputRef}
                  id="copilot-question"
                  className="field-input"
                  value={copilotQuestion}
                  placeholder="Explain the staffing risks..."
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
/* Components                                                                 */
/* -------------------------------------------------------------------------- */

function NumberInput({
  value,
  onChange,
  min = 0,
  max,
  integer = false,
  label,
}: NumberInputProps) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function change(raw: string) {
    const pattern = integer ? /^\d*$/ : /^\d*\.?\d*$/;

    if (!pattern.test(raw)) return;

    setDraft(raw);

    if (raw === "" || raw === ".") return;

    const parsed = Number(raw);

    if (
      Number.isFinite(parsed) &&
      parsed >= min &&
      (max === undefined || parsed <= max)
    ) {
      onChange(parsed);
    }
  }

  function commit() {
    const parsed =
      draft === "" || draft === "." ? min : Number(draft);

    let next = Number.isFinite(parsed) ? parsed : value;

    if (integer) next = Math.trunc(next);

    next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);

    setDraft(String(next));
    onChange(next);
  }

  return (
    <input
      className="field-input"
      type="text"
      inputMode={integer ? "numeric" : "decimal"}
      value={draft}
      aria-label={label}
      autoComplete="off"
      onChange={(event) => change(event.target.value)}
      onBlur={commit}
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

function Assumption({
  label,
  unit,
  children,
}: {
  label: string;
  unit: string;
  children: ReactNode;
}) {
  return (
    <label className="assumption-field">
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

function Metric({
  label,
  value,
  helper,
  tone = "default",
}: {
  label: string;
  value: string;
  helper: string;
  tone?: Tone;
}) {
  return (
    <div className="summary-metric">
      <div className="field-label">{label}</div>
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

function Badge({
  text,
  tone,
}: {
  text: string;
  tone: Tone;
}) {
  return (
    <span className={`status-badge badge-${tone}`}>
      {text}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const appCss = `
  html {
    min-width: 320px;
    background: #f4fafd;
  }

  body {
    display: block;
    min-width: 320px;
    margin: 0;
  }

  #root {
    width: 100%;
    max-width: none;
    margin: 0;
    padding: 0;
    text-align: left;
  }

  .wfm-app {
    --primary: #009cde;
    --primary-dark: #006f9e;
    --orange: #ff8200;
    --pale: #eaf8fe;
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

    width: 100%;
    min-height: 100vh;
    padding: 20px 16px 100px;
    color: var(--text);
    background: var(--page);
    font: 14px/1.45 Arial, Helvetica, sans-serif;
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

  .wfm-app button:disabled {
    opacity: .5;
    cursor: not-allowed;
  }

  .wfm-app button:focus-visible,
  .wfm-app input:focus-visible {
    outline: 3px solid rgba(0,156,222,.35);
    outline-offset: 2px;
  }

  .wfm-container {
    width: 100%;
    max-width: 1480px;
    margin: 0 auto;
  }

  .app-header {
    position: relative;
    overflow: hidden;
    margin-bottom: 18px;
    padding: 22px 28px;
    color: white;
    background: var(--primary);
    border-radius: 14px;
    box-shadow: 0 4px 16px rgba(0,111,158,.1);
  }

  .app-header::after {
    content: "";
    position: absolute;
    inset: 0 0 0 auto;
    width: 10px;
    background: var(--orange);
  }

  .eyebrow {
    margin-bottom: 5px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1.4px;
    text-transform: uppercase;
  }

  .app-header h1 {
    margin: 0;
    color: white;
    font-size: 30px;
    line-height: 1.15;
  }

  .app-header p {
    margin: 6px 0 0;
    color: white;
    font-size: 15px;
  }

  .overview-grid {
    display: grid;
    grid-template-columns: minmax(0,1fr) minmax(0,1fr);
    gap: 16px;
    margin-bottom: 18px;
  }

  .panel {
    min-width: 0;
    padding: 20px;
    background: white;
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: 0 4px 14px rgba(0,111,158,.05);
  }

  .spaced {
    margin-bottom: 18px;
  }

  .section-heading {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    min-width: 0;
  }

  .section-accent {
    flex: 0 0 6px;
    height: 28px;
    background: var(--orange);
    border-radius: 4px;
  }

  .section-heading h2 {
    margin: 0;
    color: var(--text);
    font-size: 19px;
    line-height: 1.25;
  }

  .section-heading p {
    margin: 4px 0 0;
    color: var(--muted);
    font-size: 12px;
  }

  .assumptions-grid,
  .summary-grid {
    display: grid;
    grid-template-columns: repeat(2,minmax(0,1fr));
    grid-template-rows: repeat(3,auto);
    grid-auto-flow: column;
    gap: 12px 20px;
    margin-top: 18px;
  }

  .assumption-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .field-label {
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
    background: white;
    border: 1px solid var(--border);
    border-radius: 7px;
    font-size: 14px;
    line-height: normal;
  }

  .unit-input .field-input {
    height: 40px;
    padding: 0 44px 0 12px;
    background: var(--pale);
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

  .metric-value {
    display: flex;
    align-items: center;
    min-height: 40px;
    margin-top: 6px;
    padding: 7px 12px;
    background: var(--page);
    border: 1px solid #dce7ee;
    border-radius: 8px;
    font-size: 19px;
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

  .text-default,
  .text-info {
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

  .muted {
    color: var(--muted);
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
    background: white;
    border: 1px solid var(--primary);
    border-radius: 7px;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.3;
    white-space: nowrap;
    cursor: pointer;
  }

  .action-button:hover:not(:disabled) {
    background: var(--pale);
  }

  .action-button.primary {
    color: white;
    background: var(--primary-dark);
  }

  .help-box {
    margin-bottom: 12px;
    padding: 9px 12px;
    color: var(--muted);
    background: var(--pale);
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

  .result-warning {
    margin-top: 16px;
    margin-bottom: 0;
  }

  .table-scroll {
    width: 100%;
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: 10px;
  }

  .section-table {
    margin-top: 16px;
  }

  .data-table {
    width: 100%;
    margin: 0;
    border-collapse: separate;
    border-spacing: 0;
    font-variant-numeric: tabular-nums;
  }

  .input-table {
    min-width: 620px;
    table-layout: fixed;
  }

  .input-table th:nth-child(1) {
    width: 24%;
  }

  .input-table th:nth-child(2),
  .input-table th:nth-child(3) {
    width: 30%;
  }

  .input-table th:nth-child(4) {
    width: 16%;
  }

  .results-table {
    min-width: 1600px;
  }

  .hourly-table {
    min-width: 580px;
  }

  .data-table thead {
    background: var(--primary);
  }

  .data-table th {
    padding: 12px;
    color: white;
    border-bottom: 1px solid var(--primary-dark);
    text-align: left;
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
  }

  .data-table td {
    padding: 9px 12px;
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

  .badge-info,
  .badge-default {
    color: var(--primary-dark);
    background: var(--pale);
  }

  .footnote {
    margin: 12px 0 0;
    color: var(--muted);
    font-size: 11px;
    line-height: 1.5;
  }

  .decision-panel {
    background: var(--pale);
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
    margin-top: 12px;
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
    color: white;
    background: var(--primary-dark);
    border: 2px solid white;
    border-radius: 999px;
    box-shadow: 0 8px 24px rgba(0,111,158,.25);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }

  .copilot-overlay {
    position: fixed;
    inset: 0;
    z-index: 1001;
    background: rgba(22,50,71,.3);
  }

  .copilot-panel {
    position: fixed;
    inset: 0 0 0 auto;
    z-index: 1002;
    display: flex;
    flex-direction: column;
    width: min(440px,100vw);
    background: white;
    box-shadow: -12px 0 35px rgba(22,50,71,.22);
  }

  .copilot-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 20px;
    color: white;
    background: var(--primary-dark);
    border-right: 8px solid var(--orange);
  }

  .copilot-header h2 {
    margin: 0;
    color: white;
    font-size: 20px;
  }

  .copilot-close {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    padding: 0;
    color: white;
    background: rgba(255,255,255,.15);
    border: 1px solid rgba(255,255,255,.4);
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

  .copilot-body > p {
    margin-top: 0;
    font-size: 13px;
    line-height: 1.6;
  }

  .copilot-actions {
    display: grid;
    gap: 10px;
    margin: 18px 0;
  }

  .copilot-actions .action-button {
    justify-content: flex-start;
    padding: 11px 12px;
    text-align: left;
    white-space: normal;
  }

  .copilot-response {
    padding: 16px;
    background: var(--pale);
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
      grid-template-columns: minmax(0,1fr);
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
``