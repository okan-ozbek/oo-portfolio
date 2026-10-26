import test from "node:test";
import assert from "node:assert/strict";
import { createAnimationClock } from "../app/animation-clock.ts";

test("visible graphics share one clock, honor their cadence, and stop without pending work", () => {
  let now = 0, sequence = 0, frames = 0;
  const pending = new Map();
  const delay = (callback, ms) => {
    const id = ++sequence;
    pending.set(id, { callback, due: now + ms });
    assert.equal(pending.size, 1, "Only one timer or animation frame may be pending");
    return id;
  };
  const animate = createAnimationClock({
    now: () => now, delay, cancelDelay: id => pending.delete(id),
    frame: callback => delay(() => { frames++; callback(now); }, 1),
    cancelFrame: id => pending.delete(id),
  });
  const draws = [0, 0, 0], elapsed = [0, 0, 0];
  const stops = [3, 12, 24].map((fps, index) => animate(delta => {
    draws[index]++; elapsed[index] += delta;
  }, fps));
  const advance = end => {
    while (pending.size) {
      const [id, task] = [...pending][0];
      if (task.due > end) break;
      now = task.due; pending.delete(id); task.callback();
    }
    now = end;
  };
  advance(4002);
  assert.deepEqual(draws, [12, 48, 96]);
  assert.ok(elapsed.every(time => Math.abs(time - 4) < .01), "Lower fps must retain four-second candle timing");
  assert.equal(frames, 96, "Slower charts should reuse the faster graphic's frame");
  stops.forEach(stop => stop());
  assert.equal(pending.size, 0);
  advance(10000);
  assert.deepEqual(draws, [12, 48, 96]);
  const stop = animate(delta => assert.ok(delta < .1, "Resuming must not catch up through a pause"), 24);
  advance(10050); stop();
});
