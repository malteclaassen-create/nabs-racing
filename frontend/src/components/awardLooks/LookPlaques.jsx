// Season awards look "plaques" (Hall of Fame preview, ?look=plaques). Stub, to be designed.
export default function LookPlaques({ seasons }) {
  return (
    <section data-awards-look="plaques" className="reveal">
      <div className="card p-8 text-medium">Look "plaques": {seasons.length} seasons with awards.</div>
    </section>
  );
}
