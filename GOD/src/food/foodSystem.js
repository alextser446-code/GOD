const BERRY_OFFSETS = [
  [-4, -2], [-1, -4], [3, -3], [5, 0], [1, 2], [-3, 1]
];

const FORAGE_AMOUNT = 1;
const MEAL_HUNGER_REDUCTION = 58;

function distanceSquared(x1, y1, x2, y2) {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return dx * dx + dy * dy;
}

function moveTo(human, x, y) {
  const target = human.movement.temporaryTarget;
  if (!target || Math.abs(target.x - x) > 1 || Math.abs(target.y - y) > 1) {
    human.movement.setTemporaryTarget(x, y);
  }
}

export class FoodSystem {
  constructor() {
    this.patches = [];
    this.nextPatchId = 1;
    this.worldWidth = 0;
    this.worldHeight = 0;
    this.time = 0;
    this.dispatchTimer = 0;
  }

  setWorldSize(width, height, treeManager) {
    if (width === this.worldWidth && height === this.worldHeight) return;

    this.worldWidth = width;
    this.worldHeight = height;
    this.patches = this.patches.filter(
      (patch) => patch.x >= 12 && patch.y >= 12 && patch.x <= width - 12 && patch.y <= height - 12
    );

    const targetCount = Math.floor((width * height) / 65000);
    const maxAttempts = Math.max(100, targetCount * 40);
    let attempts = 0;

    while (this.patches.length < targetCount && attempts < maxAttempts) {
      attempts += 1;
      if (width < 40 || height < 40) break;

      const x = 16 + Math.random() * (width - 32);
      const y = 16 + Math.random() * (height - 32);
      const tooCloseToPatch = this.patches.some(
        (patch) => distanceSquared(x, y, patch.x, patch.y) < 48 ** 2
      );
      const tooCloseToTree = treeManager?.trees?.some(
        (tree) => distanceSquared(x, y, tree.x, tree.y) < (tree.radius + 16) ** 2
      );

      if (tooCloseToPatch || tooCloseToTree) continue;

      this.patches.push({
        id: `berry-patch-${this.nextPatchId++}`,
        x,
        y,
        berries: 3 + Math.floor(Math.random() * 4),
        maxBerries: 6,
        regrowTimer: 12 + Math.random() * 20,
        phase: Math.random() * Math.PI * 2
      });
    }
  }

  update(deltaSeconds, humans, village, isNight) {
    const delta = Math.max(0, Math.min(Number(deltaSeconds) || 0, 0.1));
    this.time += delta;

    for (const patch of this.patches) {
      if (patch.berries >= patch.maxBerries) continue;
      patch.regrowTimer -= delta;
      if (patch.regrowTimer <= 0) {
        patch.berries += 1;
        patch.regrowTimer = 20 + Math.random() * 24;
      }
    }

    if (!village || village.foundingStatus !== "established" || !village.storage) {
      return;
    }

    const storage = village.storage;
    storage.foodCapacity ??= 80;
    storage.food = Math.max(0, Number(storage.food) || 0);
    storage.reservedFood = Math.max(0, Number(storage.reservedFood) || 0);
    storage.foodBalance ??= {};
    storage.foodBalance.foodConsumedSinceSample ??= 0;
    storage.foodBalance.berriesProducedSinceSample ??= 0;

    let activeForagers = 0;

    for (const human of humans) {
      if (!village.inhabitants.includes(human.id)) continue;

      this.updateHunger(human, delta);
      if (human.foodActivity?.kind === "foraging") activeForagers += 1;

      if (isNight) {
        if (human.foodActivity) this.cancelActivity(human, storage, true);
        continue;
      }

      if (human.foodActivity) {
        this.advanceActivity(human, storage, delta);
        continue;
      }

      if (!this.canStartActivity(human)) continue;

      const unreservedFood = storage.food - storage.reservedFood;
      if (
        human.needs.hunger >= human.needs.hungerThreshold &&
        unreservedFood >= 1
      ) {
        this.startMeal(human, storage, false);
      }
    }

    if (isNight) return;

    this.dispatchTimer -= delta;
    const desiredFood = Math.min(
      storage.foodCapacity,
      Math.max(3, Math.ceil(village.inhabitants.length * 0.35))
    );
    const maximumForagers = village.inhabitants.length >= 12 ? 2 : 1;

    if (
      this.dispatchTimer <= 0 &&
      storage.food < desiredFood &&
      activeForagers < maximumForagers
    ) {
      this.dispatchTimer = 28 + Math.random() * 17;
      this.dispatchForager(humans, village, storage);
    }
  }

  updateHunger(human, delta) {
    human.needs ??= {};
    human.needs.hunger ??= Math.random() * 24;
    human.needs.hungerThreshold ??= 58 + Math.random() * 24;
    human.needs.hungerRate ??= 0.75 + Math.random() * 0.5;

    const isWorking = Boolean(human.workTaskId) ||
      ["work", "woodcutting", "farming"].includes(human.actionPriority);
    const isMoving = human.movement?.speed > 0.35;
    const activityRate = isWorking ? 1.8 : isMoving ? 1.25 : 1;
    human.needs.hunger = Math.min(
      100,
      human.needs.hunger + delta * 0.22 * human.needs.hungerRate * activityRate
    );
  }

  canStartActivity(human, foraging = false) {
    return Boolean(
      human.movement &&
      !human.isKing &&
      !human.isIndoors &&
      !human.isOffDuty &&
      (
        !foraging ||
        (
          human.profession !== "farmer" &&
          human.profession !== "child"
        )
      ) &&
      !["goingToSleep", "sleeping", "waking"].includes(human.villageRoutine?.phase) &&
      !human.workTaskId &&
      human.actionPriority === "normal" &&
      human.social?.conversationId == null
    );
  }

  dispatchForager(humans, village, storage) {
    let selectedHuman = null;
    let selectedPatch = null;
    let bestScore = -Infinity;

    for (const human of humans) {
      if (!village.inhabitants.includes(human.id) || !this.canStartActivity(human, true)) continue;

      const patch = this.findNearestAvailablePatch(human, village);
      if (!patch) continue;

      const hunger = human.needs?.hunger ?? 0;
      const score = hunger * 2 - Math.sqrt(
        distanceSquared(human.movement.x, human.movement.y, patch.x, patch.y)
      );

      if (score > bestScore) {
        selectedHuman = human;
        selectedPatch = patch;
        bestScore = score;
      }
    }

    if (!selectedHuman || !selectedPatch) return false;

    selectedHuman.foodActivity = {
      kind: "foraging",
      phase: "toPatch",
      patchId: selectedPatch.id,
      carriedFood: 0,
      elapsed: 0
    };
    selectedHuman.actionPriority = "foraging";
    moveTo(selectedHuman, selectedPatch.x, selectedPatch.y);
    return true;
  }

  findNearestAvailablePatch(human, village) {
    let nearestInside = null;
    let nearestInsideDistance = Infinity;
    let nearestOverall = null;
    let nearestOverallDistance = Infinity;
    const localRadius = village.radius + 120;

    for (const patch of this.patches) {
      if (patch.berries <= 0) continue;

      const distance = distanceSquared(
        human.movement.x,
        human.movement.y,
        patch.x,
        patch.y
      );

      if (distance < nearestOverallDistance) {
        nearestOverall = patch;
        nearestOverallDistance = distance;
      }

      if (
        distanceSquared(patch.x, patch.y, village.centerX, village.centerY) <= localRadius ** 2 &&
        distance < nearestInsideDistance
      ) {
        nearestInside = patch;
        nearestInsideDistance = distance;
      }
    }

    return nearestInside ?? nearestOverall;
  }

  advanceActivity(human, storage, delta) {
    const activity = human.foodActivity;

    if (activity.kind === "meal") {
      this.advanceMeal(human, storage, delta);
      return;
    }

    const patch = this.patches.find((entry) => entry.id === activity.patchId);
    if (!patch && activity.phase !== "toStorage") {
      this.cancelActivity(human, storage);
      return;
    }

    human.actionPriority = "foraging";

    if (activity.phase === "toPatch") {
      moveTo(human, patch.x, patch.y);
      if (!human.movement.destinationReached) return;
      human.movement.setPaused(true);
      activity.phase = "gathering";
      activity.elapsed = 0;
      return;
    }

    if (activity.phase === "gathering") {
      human.movement.setPaused(true);
      activity.elapsed += delta;
      if (activity.elapsed < 2.8) return;

      const room = Math.max(0, storage.foodCapacity - storage.food);
      activity.carriedFood = Math.min(FORAGE_AMOUNT, patch.berries, room);
      patch.berries -= activity.carriedFood;
      activity.elapsed = 0;

      if (activity.carriedFood <= 0) {
        this.finishActivity(human);
        return;
      }

      activity.phase = "toStorage";
      human.movement.setPaused(false);
      moveTo(human, storage.x, storage.y);
      return;
    }

    if (activity.phase === "toStorage") {
      moveTo(human, storage.x, storage.y);
      if (!human.movement.destinationReached) return;

      const delivered = Math.min(
        Math.max(0, storage.foodCapacity - storage.food),
        activity.carriedFood
      );
      storage.food += delivered;
      storage.foodBalance ??= {};
      storage.foodBalance.berriesProducedSinceSample ??= 0;
      storage.foodBalance.berriesProducedSinceSample += delivered;
      activity.carriedFood = 0;

      if (
        human.needs.hunger >= human.needs.hungerThreshold &&
        storage.food - storage.reservedFood >= 1
      ) {
        this.startMeal(human, storage, true);
      } else {
        this.finishActivity(human);
      }
    }
  }

  startMeal(human, storage, alreadyAtStorage) {
    if (storage.food - storage.reservedFood < 1) return false;

    storage.reservedFood += 1;
    human.foodActivity = {
      kind: "meal",
      phase: alreadyAtStorage ? "eating" : "toMeal",
      elapsed: 0,
      reservedMeal: true
    };
    human.actionPriority = "eating";

    if (alreadyAtStorage) {
      human.movement.setPaused(true);
    } else {
      moveTo(human, storage.x, storage.y);
    }
    return true;
  }

  advanceMeal(human, storage, delta) {
    const activity = human.foodActivity;
    human.actionPriority = "eating";

    if (activity.phase === "toMeal") {
      moveTo(human, storage.x, storage.y);
      if (!human.movement.destinationReached) return;
      human.movement.setPaused(true);
      activity.phase = "eating";
      activity.elapsed = 0;
      return;
    }

    human.movement.setPaused(true);
    activity.elapsed += delta;
    if (activity.elapsed < 2.2) return;

    storage.food = Math.max(0, storage.food - 1);
    storage.foodBalance ??= {};
    storage.foodBalance.foodConsumedSinceSample ??= 0;
    storage.foodBalance.foodConsumedSinceSample += 1;
    storage.reservedFood = Math.max(0, storage.reservedFood - 1);
    human.needs.hunger = Math.max(
      0,
      human.needs.hunger - MEAL_HUNGER_REDUCTION - Math.random() * 12
    );
    human.needs.lastMealAt = this.time;
    activity.reservedMeal = false;
    this.finishActivity(human);
  }

  cancelActivity(human, storage, preserveMovement = false) {
    const activity = human.foodActivity;
    if (!activity) return;

    if (activity.reservedMeal) {
      storage.reservedFood = Math.max(0, storage.reservedFood - 1);
    }

    if (activity.carriedFood > 0) {
      const patch = this.patches.find((entry) => entry.id === activity.patchId);
      if (patch) {
        patch.berries = Math.min(
          patch.maxBerries,
          patch.berries + activity.carriedFood
        );
      }
    }

    if (preserveMovement) {
      human.foodActivity = null;
      human.actionPriority = "normal";
      return;
    }

    this.finishActivity(human);
  }

  finishActivity(human) {
    human.foodActivity = null;
    human.actionPriority = "normal";
    human.movement.clearTemporaryTarget();
    human.movement.setPaused(false);
  }

  draw(context, visibleBounds, village, zoom) {
    for (const patch of this.patches) {
      if (
        patch.x + 12 < visibleBounds.left ||
        patch.x - 12 > visibleBounds.right ||
        patch.y + 12 < visibleBounds.top ||
        patch.y - 12 > visibleBounds.bottom
      ) {
        continue;
      }

      context.save();
      context.translate(patch.x, patch.y);
      context.fillStyle = "rgba(37, 54, 27, 0.25)";
      context.beginPath();
      context.ellipse(0, 3, 9, 5, 0, 0, Math.PI * 2);
      context.fill();

      context.fillStyle = "#356c32";
      context.beginPath();
      context.arc(-3, 0, 4, 0, Math.PI * 2);
      context.arc(2, -1, 5, 0, Math.PI * 2);
      context.arc(4, 2, 3, 0, Math.PI * 2);
      context.fill();

      context.fillStyle = "#568b3b";
      context.fillRect(-4, -2, 3, 2);
      context.fillRect(1, -4, 3, 2);

      for (let index = 0; index < patch.berries; index += 1) {
        const [x, y] = BERRY_OFFSETS[index];
        const bob = Math.round(Math.sin(this.time * 2.2 + patch.phase + index) * 0.45);
        context.fillStyle = index % 2 === 0 ? "#a63238" : "#c14443";
        context.fillRect(x, y + bob, 2, 2);
        context.fillStyle = "#f0a09a";
        context.fillRect(x, y + bob, 1, 1);
      }
      context.restore();
    }

    if (!village?.storage) return;

    const storage = village.storage;
    context.save();
    context.translate(storage.x, storage.y + 24);
    context.scale(1 / Math.max(0.01, zoom), 1 / Math.max(0.01, zoom));
    context.fillStyle = "rgba(30, 26, 21, 0.78)";
    context.fillRect(-25, -7, 50, 14);
    context.fillStyle = "#c14443";
    context.fillRect(-19, -2, 3, 3);
    context.fillStyle = "#fff0d4";
    context.font = "9px system-ui, sans-serif";
    context.textAlign = "left";
    context.fillText(`Food ${Math.floor(storage.food ?? 0)}`, -13, 3);
    context.restore();
  }
}
