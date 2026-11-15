export class WindSystem {
  constructor() {
    this.direction = -Math.PI / 4;
    this.targetDirection = this.direction;
    this.directionTimer = 20;

    this.baseStrength = 0.4;
    this.targetStrength = 0.4;
    this.strengthTimer = 8;

    this.state = {
      time: 0,
      directionX: Math.cos(this.direction),
      directionY: Math.sin(this.direction),
      strength: this.baseStrength
    };
  }

  update(deltaSeconds) {
    const delta = Math.min(Math.max(deltaSeconds, 0), 0.1);
    this.state.time += delta;

    this.directionTimer -= delta;

    if (this.directionTimer <= 0) {
      this.targetDirection = (Math.random() * 2 - 1) * Math.PI;
      this.directionTimer = 20 + Math.random() * 20;
    }

    const directionDifference = Math.atan2(
      Math.sin(this.targetDirection - this.direction),
      Math.cos(this.targetDirection - this.direction)
    );

    this.direction += directionDifference * (1 - Math.exp(-delta * 0.12));

    this.strengthTimer -= delta;

    if (this.strengthTimer <= 0) {
      this.targetStrength = 0.12 + Math.random() * 0.78;
      this.strengthTimer = 8 + Math.random() * 12;
    }

    this.baseStrength +=
      (this.targetStrength - this.baseStrength) *
      (1 - Math.exp(-delta * 0.16));

    const gust = 0.88 + Math.sin(this.state.time * 0.65) * 0.12;

    this.state.directionX = Math.cos(this.direction);
    this.state.directionY = Math.sin(this.direction);
    this.state.strength = this.baseStrength * gust;
  }

  getSway(phase, response, detailAmount) {
    if (detailAmount <= 0) {
      return 0;
    }

    const strength = this.state.strength;
    const wave = Math.sin(this.state.time * 1.7 + phase);

    return (
      strength * 0.55 +
      wave * (0.08 + strength * 0.24)
    ) * response * detailAmount;
  }
}
