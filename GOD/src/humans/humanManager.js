import { Human } from "./human.js";
import { MAX_POPULATION } from "./populationRules.js";

export class HumanManager {
  constructor() {
    this.humans = [];
    this.nextId = 1;
  }

  spawnAt(x, y, amount) {
    const spawnedHumans = [];
    const requestedAmount = Number.isFinite(amount)
      ? Math.max(0, Math.floor(amount))
      : 0;
    const availableSlots = Math.max(
      0,
      MAX_POPULATION - this.humans.length
    );
    const spawnAmount = Math.min(requestedAmount, availableSlots);
    const angleStep = 2.399963229728653;

    for (let index = 0; index < spawnAmount; index += 1) {
      const distance = spawnAmount === 1
        ? 0
        : 1.5 + Math.sqrt(index / (spawnAmount - 1)) * 5;
      const angle = index * angleStep;
      const human = new Human(
        `human-${this.nextId}`,
        x + Math.cos(angle) * distance,
        y + Math.sin(angle) * distance
      );

      this.nextId += 1;
      this.humans.push(human);
      spawnedHumans.push(human);
    }

    return spawnedHumans;
  }

  removeHuman(id) {
    const index = this.humans.findIndex((human) => human.id === id);
    if (index === -1) return false;

    this.humans.splice(index, 1);
    return true;
  }

  update(deltaSeconds) {
    for (const human of this.humans) {
      human.update(deltaSeconds);
    }
  }

  draw(context, detail) {
    for (const human of this.humans) {
      human.draw(context, detail);
    }
  }
}
