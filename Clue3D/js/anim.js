// Tiny tween system driven by the render loop. tween() returns a promise that resolves when done,
// so moves can be chained with await (hop, hop, hop, land).
const live = new Set();

export const ease = {
  linear: (t) => t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
  outBounce: (t) => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
};

// fn(k) is called every frame with k going 0 -> 1 (after easing).
export function tween(ms, fn, easing = ease.linear) {
  return new Promise((resolve) => {
    live.add({ t0: performance.now(), ms, fn, easing, resolve });
  });
}
export const wait = (ms) => tween(ms, () => {});

export function step(now) {
  for (const a of live) {
    const t = Math.min(1, (now - a.t0) / a.ms);
    a.fn(a.easing(t));
    if (t >= 1) { live.delete(a); a.resolve(); }
  }
}
export const busy = () => live.size > 0;

// One hop of a pawn from a to b (THREE.Vector3s), with squash and stretch.
export async function hop(obj, a, b, ms = 210, height = 0.55) {
  await tween(ms, (k) => {
    obj.position.lerpVectors(a, b, k);
    obj.position.y = a.y + (b.y - a.y) * k + Math.sin(Math.PI * k) * height;
    const s = 1 + Math.sin(Math.PI * k) * 0.12; // stretch in the air
    obj.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
    if (b.x !== a.x || b.z !== a.z) obj.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
  });
  // squash on landing, then spring back
  await tween(90, (k) => { const s = 1 - Math.sin(Math.PI * k) * 0.18; obj.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s)); });
  obj.scale.set(1, 1, 1);
}
