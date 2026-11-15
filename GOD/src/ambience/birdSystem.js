const FIRST_FLOCK_DELAY_MIN = 3;
const FIRST_FLOCK_DELAY_MAX = 7;
const NEXT_FLOCK_DELAY_MIN = 22;
const NEXT_FLOCK_DELAY_MAX = 42;

function randomBetween(minimum, maximum) {
  return minimum + Math.random() * (maximum - minimum);
}

export class BirdSystem {
  constructor() {
    this.flock = null;
    this.nextFlockIn = randomBetween(
      FIRST_FLOCK_DELAY_MIN,
      FIRST_FLOCK_DELAY_MAX
    );
  }

  update(deltaSeconds, visibleBounds, zoom) {
    const delta = Math.max(0, Math.min(Number(deltaSeconds) || 0, 0.1));
    const safeZoom = Math.max(0.01, Number(zoom) || 1);

    if (this.flock) {
      this.flock.age += delta;
      for (const bird of this.flock.birds) {
        bird.x += (this.flock.direction * this.flock.speed * delta) / safeZoom;
        bird.y += (bird.drift * this.flock.speed * delta) / safeZoom;
        bird.wingPhase += delta * bird.flapSpeed;
      }

      if (this.flock.age >= this.flock.duration) {
        this.flock = null;
        this.nextFlockIn = randomBetween(
          NEXT_FLOCK_DELAY_MIN,
          NEXT_FLOCK_DELAY_MAX
        );
      }
      return;
    }

    this.nextFlockIn -= delta;
    if (this.nextFlockIn <= 0) {
      this.startFlock(visibleBounds, safeZoom);
    }
  }

  startFlock(visibleBounds, zoom) {
    if (!visibleBounds) return;

    const direction = Math.random() < 0.5 ? 1 : -1;
    const speed = randomBetween(28, 42);
    const count = 3 + Math.floor(Math.random() * 3);
    const margin = 18 / zoom;
    const startX = direction > 0
      ? visibleBounds.left - margin
      : visibleBounds.right + margin;
    const startY = randomBetween(visibleBounds.top + 18 / zoom, visibleBounds.bottom - 18 / zoom);
    const birds = [];

    for (let index = 0; index < count; index += 1) {
      birds.push({
        x: startX - direction * index * (8 / zoom),
        y: startY + (index - (count - 1) / 2) * (6 / zoom),
        drift: randomBetween(-0.05, 0.05),
        wingPhase: randomBetween(0, Math.PI * 2),
        flapSpeed: randomBetween(7, 10)
      });
    }

    const viewportWidth = Math.max(1, visibleBounds.right - visibleBounds.left);
    this.flock = {
      birds,
      direction,
      speed,
      age: 0,
      duration: (viewportWidth + margin * 2) * zoom / speed + 1
    };
  }

  draw(context, visibleBounds, zoom) {
    if (!this.flock || !visibleBounds) return;

    const safeZoom = Math.max(0.01, Number(zoom) || 1);
    const padding = 8 / safeZoom;

    for (const bird of this.flock.birds) {
      if (
        bird.x < visibleBounds.left - padding ||
        bird.x > visibleBounds.right + padding ||
        bird.y < visibleBounds.top - padding ||
        bird.y > visibleBounds.bottom + padding
      ) {
        continue;
      }

      const wingLift = 1 + Math.abs(Math.sin(bird.wingPhase)) * 2.5;
      context.save();
      context.translate(bird.x, bird.y);
      if (this.flock.direction < 0) context.rotate(Math.PI);
      context.scale(1 / safeZoom, 1 / safeZoom);
      context.strokeStyle = "#3d382b";
      context.lineWidth = 1.5;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(3, 0);
      context.lineTo(-1, 0);
      context.moveTo(-1, 0);
      context.lineTo(-5, -wingLift);
      context.moveTo(-1, 0);
      context.lineTo(-5, wingLift);
      context.stroke();
      context.restore();
    }
  }
}
