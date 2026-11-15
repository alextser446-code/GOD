function randomBetween(minimum, maximum) {
  return minimum + Math.random() * (maximum - minimum);
}

function angleDifference(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export class HumanMovement {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.facingAngle = randomBetween(-Math.PI, Math.PI);
    this.targetAngle = this.facingAngle;
    this.walkSpeed = randomBetween(5, 9);
    this.speed = 0;
    this.targetSpeed = 0;
    this.state = "idle";
    this.isPaused = false;
    this.isFacingLeft = false;
    this.temporaryTarget = null;
    this.destinationReached = false;
    this.modeTimer = randomBetween(1, 4);

    if (Math.random() < 0.65) {
      this.startWalking();
    }
  }

  startWalking() {
    this.state = "walking";
    this.targetAngle = randomBetween(-Math.PI, Math.PI);
    this.targetSpeed = this.walkSpeed;
    this.modeTimer = randomBetween(3, 7);
  }

  startIdling() {
    this.state = "idle";
    this.targetSpeed = 0;
    this.modeTimer = randomBetween(1.5, 4);
  }

  setTemporaryTarget(x, y) {
    this.temporaryTarget = { x, y };
    this.destinationReached = false;
    this.isPaused = false;
  }

  clearTemporaryTarget() {
    this.temporaryTarget = null;
    this.destinationReached = false;
    this.startIdling();
  }

  setPaused(paused) {
    if (this.isPaused === paused) {
      return;
    }

    this.isPaused = paused;

    if (paused) {
      this.state = "idle";
      this.targetSpeed = 0;
      this.speed = 0;
    } else {
      this.state = "idle";
      this.targetSpeed = 0;
      this.modeTimer = randomBetween(0.8, 1.8);
    }
  }

  stopAndFaceTarget() {
    this.temporaryTarget = null;
    this.destinationReached = false;
    this.targetSpeed = 0;
    this.speed = 0;
    this.state = "idle";
    this.isPaused = true;
    this.targetAngle = this.facingAngle;
  }

  update(deltaSeconds) {
    const delta = Math.min(Math.max(deltaSeconds, 0), 0.1);
    if (!this.isPaused && this.temporaryTarget) {
      const targetX = this.temporaryTarget.x - this.x;
      const targetY = this.temporaryTarget.y - this.y;
      const distance = Math.hypot(targetX, targetY);

      if (distance <= 2) {
        this.destinationReached = true;
        this.state = "idle";
        this.targetSpeed = 0;
      } else {
        this.destinationReached = false;
        this.state = "walking";
        this.targetAngle = Math.atan2(targetY, targetX);
        this.targetSpeed = this.walkSpeed;
      }
    } else if (!this.isPaused) {
      this.modeTimer -= delta;

      if (this.modeTimer <= 0) {
        if (this.state === "walking") {
          this.startIdling();
        } else {
          this.startWalking();
        }
      }
    } else {
      this.targetSpeed = 0;
    }

    if (!this.isPaused) {
      const turn = angleDifference(this.facingAngle, this.targetAngle);
      const maxTurn = 1.25 * delta;
      this.facingAngle += Math.max(-maxTurn, Math.min(maxTurn, turn));
    }

    const directionX = Math.cos(this.facingAngle);
    const directionY = Math.sin(this.facingAngle);
    const mostlyHorizontal = Math.abs(directionX) >= Math.abs(directionY);

    if (!this.isPaused) {
      if (this.state === "walking" && mostlyHorizontal) {
        this.isFacingLeft = directionX < 0;
      } else {
        this.isFacingLeft = false;
      }
    }

    this.speed +=
      (this.targetSpeed - this.speed) * (1 - Math.exp(-delta * 2.8));

    if (this.speed < 0.03 && this.targetSpeed === 0) {
      this.speed = 0;
    }

    this.x += directionX * this.speed * delta;
    this.y += directionY * this.speed * delta;

    if (this.temporaryTarget && !this.isPaused) {
      const remainingX = this.temporaryTarget.x - this.x;
      const remainingY = this.temporaryTarget.y - this.y;

      if (Math.hypot(remainingX, remainingY) <= 2) {
        this.destinationReached = true;
        this.state = "idle";
        this.targetSpeed = 0;
      }
    }

    return this.speed > 0.35;
  }
}
