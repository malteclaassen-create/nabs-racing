import { useScope } from "./scope.jsx";
import { useAdminList, Section } from "./common.jsx";

// Who is still turning up: every driver of the entry list (and everyone who
// answered a sign-up) against every round of the season.
const ANSWER = { in: ["✓", "text-emerald-400", "said yes"], maybe: ["?", "text-amber-300", "said maybe"], out: ["✕", "text-red-300", "said no"] };

export default function AttendanceAdmin() {
  const { currentSeason } = useScope();
  const { data } = useAdminList(currentSeason ? `/admin/attendance?season=${currentSeason.id}` : null);
  if (!currentSeason) return <Section title="Attendance">Pick a season first.</Section>;
  if (!data) return null;

  function exportCsv() {
    const head = ["Driver", "Team", ...data.rounds.map((r) => `R${r.round} ${r.track}`), "Raced", "Answered", "No-shows"];
    const rows = data.rows.map((row) => [
      row.name,
      row.team ?? "",
      ...data.rounds.map((r) => {
        const c = row.cells[r.id] || {};
        return [c.raced ? "raced" : "", c.answer ? `answered ${c.answer}` : "", c.noShow ? "NO-SHOW" : ""].filter(Boolean).join(" / ");
      }),
      row.raced,
      row.answered,
      row.noShows,
    ]);
    const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-${currentSeason.name.replace(/\W+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Section
      title={`Attendance · ${currentSeason.name}`}
      actions={
        <button className="btn-ghost" onClick={exportCsv}>
          Export CSV
        </button>
      }
    >
      <p className="mb-4 text-sm text-muted">
        A filled box: raced (a DNF counts, a DNS does not). The mark inside: their sign-up answer. Red outline: said yes and did not start.
      </p>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Driver</th>
              {data.rounds.map((r) => (
                <th key={r.id} className="text-center" title={r.track}>
                  R{r.round}
                </th>
              ))}
              <th className="text-center">Raced</th>
              <th className="text-center">Answered</th>
              <th className="text-center">No-shows</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={`${row.driverId}-${row.userId}`}>
                <td>
                  <div className="font-semibold">{row.name}</div>
                  <div className="text-xs text-muted">{row.team ?? (row.driverId ? "no team" : "not on the entry list")}</div>
                </td>
                {data.rounds.map((r) => {
                  const c = row.cells[r.id] || {};
                  const a = ANSWER[c.answer];
                  return (
                    <td key={r.id} className="px-1 text-center">
                      <span
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-xs font-black ${c.raced ? "bg-white/15" : "border border-line"} ${c.noShow ? "ring-2 ring-red-400" : ""} ${a ? a[1] : "text-muted/40"}`}
                        title={[c.raced ? "raced" : r.done ? "did not race" : "ahead", a ? a[2] : "no answer", c.noShow ? "no-show" : null].filter(Boolean).join(" · ")}
                      >
                        {a ? a[0] : "·"}
                      </span>
                    </td>
                  );
                })}
                <td className="text-center tabular">
                  {row.raced}/{row.of}
                </td>
                <td className="text-center tabular">{row.answered}</td>
                <td className={`text-center tabular ${row.noShows ? "font-bold text-red-300" : "text-muted"}`}>{row.noShows}</td>
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={data.rounds.length + 4} className="py-6 text-center text-sm text-muted">
                  Nobody on the entry list and no sign-ups yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
