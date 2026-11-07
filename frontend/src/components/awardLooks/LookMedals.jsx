// Season awards look "medals" (Hall of Fame preview, ?look=medals). Stub, to be designed.
export default function LookMedals({ seasons }) {
  return (
    <section data-awards-look="medals" className="reveal">
      <div className="card p-8 text-medium">Look "medals": {seasons.length} seasons with awards.</div>
    </section>
  );
}
