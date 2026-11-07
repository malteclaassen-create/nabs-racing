// Season awards look "ceremony" (Hall of Fame preview, ?look=ceremony). Stub, to be designed.
export default function LookCeremony({ seasons }) {
  return (
    <section data-awards-look="ceremony" className="reveal">
      <div className="card p-8 text-medium">Look "ceremony": {seasons.length} seasons with awards.</div>
    </section>
  );
}
