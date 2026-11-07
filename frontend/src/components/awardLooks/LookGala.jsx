// Season awards look "gala" (Hall of Fame preview, ?look=gala). Stub, to be designed.
export default function LookGala({ seasons }) {
  return (
    <section data-awards-look="gala" className="reveal">
      <div className="card p-8 text-medium">Look "gala": {seasons.length} seasons with awards.</div>
    </section>
  );
}
