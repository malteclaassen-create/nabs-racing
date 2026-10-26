// Small fetch wrapper: JSON in, JSON out, the error message of the server
// thrown as an Error.
async function request(method, url, body) {
  const opts = { method, headers: {}, credentials: "same-origin" };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${url}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  get: (url) => request("GET", url),
  post: (url, body) => request("POST", url, body ?? {}),
  put: (url, body) => request("PUT", url, body ?? {}),
  del: (url) => request("DELETE", url),
};

export const seasonQuery = (seasonId) => (seasonId ? `?season=${seasonId}` : "");
