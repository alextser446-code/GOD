function randomBetween(minimum, maximum) {
  return minimum + Math.random() * (maximum - minimum);
}

export class HumanAnimation {
  constructor() {
    this.phaseOffset = randomBetween(0, Math.PI * 2);
    this.walkPhase = this.phaseOffset;
    this.idleTime = randomBetween(0, 20);
    this.walkBlend = 0;
    this.flipBlend = 0;
    this.blinkTimer = randomBetween(1.5, 5);
    this.blinkRemaining = 0;
  }

  update(deltaSeconds, movement) {
    const delta = Math.min(Math.max(deltaSeconds, 0), 0.1);
    const walking = movement.speed > 0.35;
    const blendTarget = walking ? 1 : 0;

    this.walkBlend +=
      (blendTarget - this.walkBlend) * (1 - Math.exp(-delta * 8));

    const flipTarget = movement.isFacingLeft ? 1 : 0;
    this.flipBlend +=
      (flipTarget - this.flipBlend) * (1 - Math.exp(-delta * 12));

    if (walking) {
      this.walkPhase += delta * (4 + movement.speed * 0.3);
    } else {
      this.idleTime += delta;
    }

    if (this.blinkRemaining > 0) {
      this.blinkRemaining = Math.max(0, this.blinkRemaining - delta);
    } else {
      this.blinkTimer -= delta;

      if (this.blinkTimer <= 0) {
        this.blinkRemaining = 0.12;
        this.blinkTimer = randomBetween(2, 5.5);
      }
    }
  }

  getPose(movement) {
    const walkingWave = Math.sin(this.walkPhase);
    const idleWave = Math.sin(this.idleTime * 2.1 + this.phaseOffset);

    return {
      legSwing: walkingWave * 1.5 * this.walkBlend,
      armSwing: -walkingWave * 1.1 * this.walkBlend,
      bodyBob:
        Math.abs(walkingWave) * 0.65 * this.walkBlend +
        idleWave * 0.25 * (1 - this.walkBlend),
      headBob: Math.sin(this.idleTime * 1.4 + this.phaseOffset) *
        0.2 * (1 - this.walkBlend),
      horizontalScale: 1 - this.flipBlend * 2,
      blink: this.blinkRemaining > 0,
      walking: movement.speed > 0.35
    };
  }
}
