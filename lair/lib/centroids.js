export const CENTROIDS = {
  us: [39.8, -98.6], ca: [56.1, -106.3], mx: [23.6, -102.5], br: [-10.3, -53.1], ar: [-38.4, -63.6], cl: [-35.7, -71.5], co: [4.6, -74.3], pe: [-9.2, -75.0], ve: [7.1, -66.2],
  gb: [54.0, -2.5], ie: [53.4, -8.2], fr: [46.6, 2.2], de: [51.2, 10.4], es: [40.4, -3.7], pt: [39.6, -8.0], it: [42.8, 12.8], nl: [52.1, 5.3], be: [50.6, 4.6], ch: [46.8, 8.2],
  at: [47.6, 14.1], se: [62.2, 17.6], no: [61.5, 8.5], fi: [64.5, 26.0], dk: [56.0, 10.0], pl: [52.1, 19.4], cz: [49.8, 15.5], ua: [49.0, 31.4], ro: [45.9, 25.0], gr: [39.1, 22.0],
  tr: [39.0, 35.2], ru: [61.5, 99.0], il: [31.4, 34.9], sa: [23.9, 45.1], ae: [24.3, 54.3], ir: [32.4, 53.7], iq: [33.2, 43.7], eg: [26.8, 30.8], ng: [9.1, 8.7], ke: [0.2, 37.9],
  za: [-30.6, 22.9], et: [9.1, 40.5], gh: [7.9, -1.0], ma: [31.8, -7.1], dz: [28.0, 1.7], tz: [-6.4, 34.9], in: [22.0, 79.0], pk: [30.4, 69.3], bd: [23.7, 90.4], lk: [7.9, 80.8],
  cn: [35.9, 104.2], jp: [36.2, 138.3], kr: [36.4, 127.9], kp: [40.3, 127.5], tw: [23.7, 121.0], hk: [22.3, 114.2], sg: [1.35, 103.8], my: [4.2, 102.0], id: [-2.5, 118.0], th: [15.9, 101.0],
  vn: [14.1, 108.3], ph: [12.9, 121.8], au: [-25.3, 133.8], nz: [-41.0, 174.0], af: [33.9, 67.7],
};

export function project([lat, lng], phi, theta, radius = .82) {
  const la = lat * Math.PI / 180;
  const lo = lng * Math.PI / 180 - Math.PI;
  const x = -Math.cos(la) * Math.cos(lo) * radius;
  const y = Math.sin(la) * radius;
  const z = Math.cos(la) * Math.sin(lo) * radius;
  const cp = Math.cos(phi), sp = Math.sin(phi), ct = Math.cos(theta), st = Math.sin(theta);
  const sx = cp * x + sp * z;
  const sy = sp * st * x + ct * y - cp * st * z;
  const depth = -sp * ct * x + st * y + cp * ct * z;
  return { x: (sx + 1) / 2, y: (-sy + 1) / 2, visible: depth >= 0 };
}
