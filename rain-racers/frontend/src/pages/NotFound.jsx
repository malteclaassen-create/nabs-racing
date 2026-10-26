import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="py-20 text-center">
      <div className="eyebrow mb-2">404</div>
      <h1 className="h1">Off track</h1>
      <p className="mt-3 text-muted">This page does not exist.</p>
      <Link to="/" className="btn-accent mt-6">
        Back to the pits
      </Link>
    </div>
  );
}
