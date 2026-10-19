import ErlangDashboard from "./ErlangDashboard";

export default function App() {
  const openCapacityPlanner = () => {
    window.open(
      `${import.meta.env.BASE_URL}WFM_Capacity_Planner.html`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          padding: "16px 24px",
          backgroundColor: "#009fe3",
          borderRight: "10px solid #ff7900",
        }}
      >
        <button
          type="button"
          onClick={openCapacityPlanner}
          style={{
            padding: "12px 20px",
            backgroundColor: "#ffffff",
            color: "#006b9b",
            border: "none",
            borderRadius: "8px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Capacity Planning ↗
        </button>
      </div>

      <ErlangDashboard />
    </>
  );
}