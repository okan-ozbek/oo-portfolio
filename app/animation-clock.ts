type Driver = {
  now: () => number;
  delay: (callback: () => void, ms: number) => number;
  cancelDelay: (id: number) => void;
  frame: (callback: (now: number) => void) => number;
  cancelFrame: (id: number) => void;
};

// One clock for all visible graphics. Sleep between draws, including on 120 Hz displays.
export function createAnimationClock(driver: Driver) {
  const subscribers = new Set<{ draw: (delta: number) => void; interval: number; last: number; next: number }>();
  let timer: number | undefined, frame: number | undefined;
  const cancel = () => {
    if (timer !== undefined) driver.cancelDelay(timer);
    if (frame !== undefined) driver.cancelFrame(frame);
    timer = frame = undefined;
  };
  const schedule = () => {
    cancel();
    if (!subscribers.size) return;
    const due = Math.min(...Array.from(subscribers, subscriber => subscriber.next));
    timer = driver.delay(() => {
      timer = undefined;
      frame = driver.frame(now => {
        frame = undefined;
        for (const subscriber of subscribers) {
          if (now < subscriber.next) continue;
          const delta = Math.min((now - subscriber.last) / 1000, .5);
          subscriber.last = now;
          // Retain cadence instead of accumulating a display-frame delay each draw.
          subscriber.next += (Math.floor((now - subscriber.next) / subscriber.interval) + 1) * subscriber.interval;
          subscriber.draw(delta);
        }
        schedule();
      });
    }, Math.max(0, due - driver.now()));
  };
  return (draw: (delta: number) => void, fps: number) => {
    const now = driver.now(), interval = 1000 / fps;
    const subscriber = { draw, interval, last: now, next: now + interval };
    subscribers.add(subscriber);
    schedule();
    return () => { subscribers.delete(subscriber); schedule(); };
  };
}

export const animate = createAnimationClock({
  now: () => performance.now(),
  delay: (callback, ms) => window.setTimeout(callback, ms),
  cancelDelay: id => window.clearTimeout(id),
  frame: callback => requestAnimationFrame(callback),
  cancelFrame: id => cancelAnimationFrame(id),
});
