
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
} from "chart.js";

import { Doughnut, Bar } from "react-chartjs-2";
import "./Analytics.css";

ChartJS.register(
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement
);

export default function Analytics({
  analyticsData = null,
  analyticsLoading = false,
}) {
  const openCount = Number(analyticsData?.open_conversations ?? 0);
  const resolvedCount = Number(
    analyticsData?.resolved_conversations ?? 0
  );
  const totalCount = Number(
    analyticsData?.total_conversations ?? 0
  );

  // Use top subjects returned by the backend analytics endpoint.
  const topSubjects = Array.isArray(analyticsData?.top_subjects)
    ? analyticsData.top_subjects
        .map((item) => ({
          subject: item.subject || "Other inquiries",
          count: Number(item.count ?? 0),
        }))
        .filter((item) => item.count > 0)
    : [];

  const doughnutData = {
    labels: ["Open", "Resolved"],
    datasets: [
      {
        data: [openCount, resolvedCount],
        backgroundColor: ["#FBBF24", "#34D399"],
        borderColor: "#11121b",
        borderWidth: 4,
      },
    ],
  };

  const barData = {
    labels: topSubjects.map((item) => item.subject),
    datasets: [
      {
        label: "Conversations",
        data: topSubjects.map((item) => item.count),
        backgroundColor: "#9B83FF",
        borderRadius: 6,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: "#c7c8d5",
        },
      },
    },
  };

  return (
    <section className="analytics-section">
      <div className="analytics-heading">
        <div>
          <h2>Analytics overview</h2>
          <p>Insights from your workspace analytics</p>
        </div>
        <span className="analytics-live">
          ● {analyticsLoading ? "Refreshing..." : "Backend data"}
        </span>
      </div>

      {analyticsLoading && !analyticsData ? (
        <p>Loading analytics...</p>
      ) : (
        <div className="analytics-grid">
          <article className="analytics-card">
            <h3>Conversation status</h3>
            <div className="analytics-chart">
              <Doughnut
                data={doughnutData}
                options={chartOptions}
              />
            </div>
            <p className="analytics-note">
              {totalCount} total conversations
            </p>
          </article>

          <article className="analytics-card">
            <h3>Top conversation subjects</h3>
            <div className="analytics-chart">
              {topSubjects.length > 0 ? (
                <Bar data={barData} options={chartOptions} />
              ) : (
                <p>No conversation subject data available yet.</p>
              )}
            </div>
            <p className="analytics-note">
              Most frequent subjects in your workspace
            </p>
          </article>
        </div>
      )}
    </section>
  );
}
