// Season awards look "cards" (Hall of Fame preview, ?look=cards). Stub, to be designed.
export default function LookCards({ seasons }) {
  return (
    <section data-awards-look="cards" className="reveal">
      <div className="card p-8 text-medium">Look "cards": {seasons.length} seasons with awards.</div>
    </section>
  );
}
