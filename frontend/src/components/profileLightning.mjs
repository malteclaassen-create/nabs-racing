// Every discharge starts on a document edge. Regenerate between discharges, while the
// paths are invisible; strength/theme changes must not interrupt a growing bolt.
export function makeStrike(seed, width = 1000, height = 700) {
  let state = seed;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const path = points => points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  // Distribute origins along the perimeter, including the full height of long
  // profiles. Top/bottom always refer to document boundaries, never scrollY.
  const perimeterPosition = random() * 2 * (width + height);
  const edge = perimeterPosition < height ? 0 : perimeterPosition < height * 2 ? 1 : perimeterPosition < height * 2 + width ? 2 : 3;
  const position = .08 + random() * .84;
  const start = [[0, position * height], [width, position * height], [position * width, 0], [position * width, height]][edge];
  // Vary the angle around the inward normal so no bolt starts in empty space
  // or immediately heads out of view. Length and forks remain independent.
  const angle = [0, Math.PI, Math.PI / 2, -Math.PI / 2][edge] + (random() - .5) * 1.9;
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const scale = Math.min(1, width / 700);
  const desiredLength = (100 + random() ** .8 * 470) * scale;
  const inset = 25 * scale;
  const roomX = Math.abs(dx) < .001 ? Infinity : ((dx > 0 ? width - inset : inset) - start[0]) / dx;
  const roomY = Math.abs(dy) < .001 ? Infinity : ((dy > 0 ? height - inset : inset) - start[1]) / dy;
  const length = Math.min(desiredLength, roomX, roomY);
  const steps = Math.max(8, Math.ceil(length / 16));
  const jaggedLine = (origin, vx, vy, distance, count, spread) => Array.from({ length: count + 1 }, (_, i) => {
    const t = i / count;
    const jitter = (random() - .5) * spread * scale * Math.sin(Math.PI * t);
    return [origin[0] + vx * distance * t - vy * jitter, origin[1] + vy * distance * t + vx * jitter];
  });
  const points = jaggedLine(start, dx, dy, length, steps, 38);
  const distances = line => line.reduce((result, point, i) => {
    result.push(i === 0 ? 0 : result[i - 1] + Math.hypot(point[0] - line[i - 1][0], point[1] - line[i - 1][1]));
    return result;
  }, []);
  const travelled = distances(points);
  const branchCount = Math.max(2, Math.floor(length / 85));
  const branches = Array.from({ length: branchCount }, (_, branch) => {
    const vertex = Math.floor(steps * (.16 + branch / branchCount * .65));
    const origin = points[vertex];
    const forkAngle = Math.atan2(dy, dx) + (branch % 2 ? 1 : -1) * (.5 + random() * .65);
    const vx = Math.cos(forkAngle), vy = Math.sin(forkAngle);
    const forkLength = length * (.12 + random() * .2);
    const fork = jaggedLine(origin, vx, vy, forkLength, 6, 22);
    const twig = jaggedLine(fork[3], dx, dy, forkLength * .45, 3, 16);
    const forkDistances = distances(fork);
    const startAt = travelled[vertex] / travelled[steps] * .65 + .005;
    const twigAt = startAt + forkDistances[3] / forkDistances[6] * .22 + .005;
    const parent = 1 + branch * 2;
    return [
      { d: path(fork), start: startAt, span: .22, type: "branch", points: fork, parent: 0, vertex },
      { d: path(twig), start: twigAt, span: .12, type: "twig", points: twig, parent, vertex: 3 },
    ];
  }).flat();
  return [{ d: path(points), start: 0, span: .65, type: "trunk", points }, ...branches];
}
