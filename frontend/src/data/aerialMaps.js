// Adding a prepared JSON file registers a circuit without changing rendering code.
const maps = Object.values(import.meta.glob('./aerialMaps/*.json', { eager: true, import: 'default' }));
export function aerialForTrack(trackId, trackName) {
  return maps.find(map => map.trackId === trackId &&
    map.trackNames?.some(name => name.toLowerCase() === (trackName || '').toLowerCase()) &&
    map.affine?.length === 6 && map.affine.every(Number.isFinite) &&
    Math.abs(map.affine[0] * map.affine[3] - map.affine[1] * map.affine[2]) > 1e-8) || null;
}
