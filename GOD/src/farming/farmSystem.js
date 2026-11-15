const DAY_LENGTH_SECONDS = 180;
const CROP_GROWTH_SECONDS = DAY_LENGTH_SECONDS * 2;
const SOW_WORK_SECONDS = 4.5;
const HARVEST_WORK_SECONDS = 6;
const FOOD_PER_HARVEST = 26;
const SEEDS_PER_HARVEST = 2;
const FIELD_COLUMNS = 7;
const FIELD_ROWS = 5;
const FIELD_CELLS = FIELD_COLUMNS * FIELD_ROWS;

function getWorkPoint(farm, cell) {
  const column = cell % FIELD_COLUMNS;
  const row = Math.floor(cell / FIELD_COLUMNS);
  return {
    x: farm.x + 2 + column * 4.2,
    y: farm.y - 3 + row * 7
  };
}

function moveTo(human, x, y) {
  const target = human.movement.temporaryTarget;
  if (!target || Math.abs(target.x - x) > 1 || Math.abs(target.y - y) > 1) {
    human.movement.setTemporaryTarget(x, y);
  }
}

function farmerScore(human) {
  const traits = new Set(human.identity?.personality ?? []);
  let score = Number(human.identity?.strength) || 0;
  if (traits.has("Hardworking")) score += 30;
  if (traits.has("Patient")) score += 18;
  if (traits.has("Intelligent")) score += 8;
  if (traits.has("Lazy")) score -= 30;
  if (traits.has("Clumsy")) score -= 8;
  return score;
}

export class FarmSystem {
  update(deltaSeconds, humans, village, developmentSystem, isNight) {
    if (
      !village ||
      village.foundingStatus !== "established" ||
      !village.storage
    ) {
      return;
    }

    const delta = Math.max(0, Math.min(Number(deltaSeconds) || 0, 0.1));
    village.storage.foodCapacity ??= 80;
    village.storage.food ??= 0;
    village.storage.foodBalance ??= {};
    village.storage.foodBalance.farmFoodProducedSinceSample ??= 0;
    const farms = developmentSystem.buildings.filter(
      (building) => building.type === "farm" && building.state === "completed"
    );

    for (const farm of farms) {
      farm.farmState ??= {
        cropPhase: "empty",
        growthRemaining: 0,
        seedStock: 2,
        fieldCell: Math.floor(Math.random() * FIELD_CELLS)
      };
      farm.farmState.cropPhase ??= "empty";
      farm.farmState.seedStock = Number.isFinite(farm.farmState.seedStock)
        ? Math.max(0, farm.farmState.seedStock)
        : 2;
      farm.farmState.growthRemaining = Number.isFinite(farm.farmState.growthRemaining)
        ? Math.max(0, farm.farmState.growthRemaining)
        : 0;
      farm.farmState.fieldCell = Number.isInteger(farm.farmState.fieldCell)
        ? Math.max(0, Math.min(FIELD_CELLS - 1, farm.farmState.fieldCell))
        : Math.floor(Math.random() * FIELD_CELLS);

      if (farm.farmState.cropPhase === "growing") {
        farm.farmState.growthRemaining = Math.max(
          0,
          farm.farmState.growthRemaining - delta
        );
        if (farm.farmState.growthRemaining <= 0) {
          farm.farmState.cropPhase = "ready";
        }
      }

      const task = developmentSystem.tasks.find(
        (entry) => entry.buildingId === farm.id
      );
      if (task) task.farmState = farm.farmState;
    }

    this.assignFarmers(farms, humans, village);

    if (isNight) return;

    for (const farm of farms) {
      const farmer = humans.find((human) => human.id === farm.farmerId);
      if (!farmer || farmer.isIndoors || farmer.isOffDuty) continue;
      if (["goingToSleep", "sleeping", "waking"].includes(farmer.villageRoutine?.phase)) continue;
      if (farmer.workTaskId || farmer.foodActivity) continue;

      if (!farmer.farmActivity) {
        const cropPhase = farm.farmState.cropPhase;
        const storageRoom = village.storage.foodCapacity - village.storage.food;

        if (cropPhase === "ready" && storageRoom > 0) {
          this.startWork(farmer, farm, "toHarvest", village.storage);
        } else if (cropPhase === "empty" && farm.farmState.seedStock > 0) {
          this.startWork(farmer, farm, "toSow", village.storage);
        } else {
          continue;
        }
      }

      this.advanceFarmer(farmer, farm, village.storage, delta);
    }
  }

  assignFarmers(farms, humans, village) {
    const residents = village.inhabitants
      .map((id) => humans.find((human) => human.id === id))
      .filter(Boolean);
    const activeFarmIds = new Set(farms.map((farm) => farm.id));

    for (const human of residents) {
      if (human.profession !== "farmer") continue;
      if (activeFarmIds.has(human.farmId)) continue;
      human.profession = "none";
      human.farmId = null;
      human.farmActivity = null;
      if (human.actionPriority === "farming") human.actionPriority = "normal";
    }

    for (const farm of farms) {
      const assigned = residents.find(
        (human) => human.profession === "farmer" && human.farmId === farm.id
      );
      if (assigned) {
        farm.farmerId = assigned.id;
      } else {
        farm.farmerId = null;
      }
    }

    const eligible = residents
      .filter((human) =>
        !human.isKing &&
        !human.isIndoors &&
        !human.isOffDuty &&
        human.profession === "none" &&
        !human.workTaskId &&
        !human.foodActivity &&
        human.actionPriority === "normal" &&
        human.social?.conversationId == null
      )
      .sort((first, second) => farmerScore(second) - farmerScore(first));

    for (const farm of farms) {
      if (farm.farmerId) continue;
      const farmer = eligible.shift();
      if (!farmer) break;

      farmer.profession = "farmer";
      farmer.farmId = farm.id;
      farmer.farmActivity = null;
      farmer.workStatus = "idle";
      farmer.actionPriority = "normal";
      farm.farmerId = farmer.id;
    }
  }

  startWork(human, farm, phase, storage) {
    const cell = farm.farmState.fieldCell ?? 0;
    const point = getWorkPoint(farm, cell);
    human.farmActivity = {
      farmId: farm.id,
      phase,
      elapsed: 0,
      carriedFood: 0,
      cell
    };
    human.actionPriority = "farming";
    if (phase === "toStorage") {
      moveTo(human, storage.x, storage.y);
    } else {
      moveTo(human, point.x, point.y);
    }
  }

  advanceFarmer(human, farm, storage, delta) {
    const activity = human.farmActivity;
    if (!activity || activity.farmId !== farm.id) return;
    human.actionPriority = "farming";

    if (activity.phase === "toSow" || activity.phase === "toHarvest") {
      const point = getWorkPoint(farm, activity.cell);
      moveTo(human, point.x, point.y);
      if (!human.movement.destinationReached) return;
      human.movement.setPaused(true);
      activity.phase = activity.phase === "toSow" ? "sowing" : "harvesting";
      activity.elapsed = 0;
      return;
    }

    if (activity.phase === "sowing") {
      human.movement.setPaused(true);
      activity.elapsed += delta;
      if (activity.elapsed < SOW_WORK_SECONDS) return;

      farm.farmState.seedStock = Math.max(0, farm.farmState.seedStock - 1);
      farm.farmState.cropPhase = "growing";
      farm.farmState.growthRemaining = CROP_GROWTH_SECONDS;
      this.finishWork(human);
      return;
    }

    if (activity.phase === "harvesting") {
      human.movement.setPaused(true);
      activity.elapsed += delta;
      if (activity.elapsed < HARVEST_WORK_SECONDS) return;

      activity.phase = "toStorage";
      activity.elapsed = 0;
      activity.carriedFood = FOOD_PER_HARVEST;
      human.movement.setPaused(false);
      moveTo(human, storage.x, storage.y);
      return;
    }

    if (activity.phase === "toStorage") {
      moveTo(human, storage.x, storage.y);
      if (!human.movement.destinationReached) return;

      const room = Math.max(0, storage.foodCapacity - storage.food);
      const delivered = Math.min(room, activity.carriedFood);
      storage.food += delivered;
      storage.foodBalance ??= {};
      storage.foodBalance.farmFoodProducedSinceSample ??= 0;
      storage.foodBalance.farmFoodProducedSinceSample += delivered;
      activity.carriedFood = 0;
      farm.farmState.cropPhase = "empty";
      farm.farmState.growthRemaining = 0;
      farm.farmState.seedStock = Math.min(
        6,
        farm.farmState.seedStock + SEEDS_PER_HARVEST
      );
      this.finishWork(human);
    }
  }

  finishWork(human) {
    human.farmActivity = null;
    human.actionPriority = "normal";
    human.movement.clearTemporaryTarget();
    human.movement.setPaused(false);
  }

  draw(context, visible, buildings, windSystem) {
    for (const farm of buildings) {
      if (farm.type !== "farm" || farm.state !== "completed" || !farm.farmState) continue;
      if (
        farm.x + 47 < visible.left || farm.x - 47 > visible.right ||
        farm.y + 44 < visible.top || farm.y - 44 > visible.bottom
      ) {
        continue;
      }

      const state = farm.farmState;
      const growth = state.cropPhase === "growing"
        ? 1 - state.growthRemaining / CROP_GROWTH_SECONDS
        : state.cropPhase === "ready" ? 1 : 0;

      context.save();
      context.translate(farm.x, farm.y);
      context.fillStyle = "#60452f";
      context.fillRect(-2, -8, 37, 40);
      context.fillStyle = "#80603c";
      context.fillRect(0, -7, 33, 37);
      context.fillStyle = "#97754a";
      context.fillRect(1, -6, 31, 2);
      context.fillRect(1, 1, 31, 2);
      context.fillRect(1, 8, 31, 2);
      context.fillRect(1, 15, 31, 2);
      context.fillRect(1, 22, 31, 2);

      if (state.cropPhase !== "empty") {
        for (let cell = 0; cell < FIELD_CELLS; cell += 1) {
          const point = getWorkPoint(farm, cell);
          const x = point.x - farm.x;
          const y = point.y - farm.y;
          const phase = x * 9.3 + y * 4.7;
          const sway = windSystem?.getSway(phase, 0.45, 1) ?? 0;
          const swayX = Math.round((windSystem?.state.directionX ?? 0) * sway * 2);
          const swayY = Math.round((windSystem?.state.directionY ?? 0) * sway * 2);
          const plantX = x + swayX;
          const plantY = y + swayY;

          if (state.cropPhase === "ready") {
            context.fillStyle = "#b99b45";
            context.fillRect(plantX, plantY - 5, 2, 7);
            context.fillRect(plantX - 2, plantY - 4, 2, 4);
            context.fillRect(plantX + 2, plantY - 3, 2, 4);
            context.fillStyle = "#e0c46a";
            context.fillRect(plantX, plantY - 6, 2, 2);
          } else if (growth > 0.42) {
            context.fillStyle = "#598342";
            context.fillRect(plantX, plantY - 4, 2, 6);
            context.fillRect(plantX - 2, plantY - 3, 2, 3);
            context.fillRect(plantX + 2, plantY - 2, 2, 3);
          } else {
            context.fillStyle = "#69934b";
            context.fillRect(plantX, plantY, 2, 2);
            if (growth > 0.18) context.fillRect(plantX - 2, plantY - 1, 2, 2);
          }
        }
      }

      context.restore();
    }
  }

  drawWindmills(context, visible, buildings, windSystem) {
    for (const farm of buildings) {
      if (farm.type !== "farm" || farm.state !== "completed") continue;
      const centerX = farm.x + 23;
      const centerY = farm.y - 28;
      if (
        centerX + 19 < visible.left || centerX - 19 > visible.right ||
        centerY + 22 < visible.top || centerY - 22 > visible.bottom
      ) {
        continue;
      }

      context.save();
      context.translate(centerX, centerY);

      context.fillStyle = "rgba(35, 30, 24, 0.24)";
      context.fillRect(-8, 4, 17, 18);
      context.fillStyle = "#604b36";
      context.beginPath();
      context.moveTo(-7, 18);
      context.lineTo(-5, -4);
      context.lineTo(-3, -12);
      context.lineTo(4, -12);
      context.lineTo(7, 18);
      context.closePath();
      context.fill();
      context.fillStyle = "#b69a6d";
      context.fillRect(-4, -8, 8, 24);
      context.fillStyle = "#d2b984";
      context.fillRect(-3, -7, 2, 19);
      context.fillStyle = "#493126";
      context.fillRect(-2, 8, 5, 8);
      context.fillStyle = "#302820";
      context.fillRect(-3, -13, 7, 3);
      context.fillStyle = "#79573b";
      context.fillRect(-1, -18, 3, 6);

      context.save();
      const wind = windSystem?.state;
      const strength = Math.max(0, Math.min(1, wind?.strength ?? 0.4));
      const directionFactor = 0.8 + ((wind?.directionX ?? 0) + 1) * 0.1;
      const time = wind?.time ?? 0;
      const rotation = time * (0.55 + strength * 1.25) * directionFactor;
      context.rotate(rotation);

      for (let blade = 0; blade < 4; blade += 1) {
        context.save();
        context.rotate((Math.PI * blade) / 2);
        context.fillStyle = "#49342e";
        context.fillRect(-1, -17, 3, 19);
        context.fillRect(-2, -15, 5, 2);
        context.fillStyle = "#e0d2ad";
        context.beginPath();
        context.moveTo(2, -15);
        context.lineTo(10, -13);
        context.lineTo(5, -4);
        context.lineTo(2, -5);
        context.closePath();
        context.fill();
        context.fillStyle = "#b9a783";
        context.fillRect(4, -13, 4, 2);
        context.fillRect(3, -10, 3, 2);
        context.fillStyle = "#6e5138";
        context.fillRect(-1, -1, 3, 4);
        context.restore();
      }

      context.fillStyle = "#493126";
      context.fillRect(-4, -4, 8, 8);
      context.fillStyle = "#c6a86f";
      context.fillRect(-2, -2, 4, 4);
      context.fillStyle = "#ead69d";
      context.fillRect(-1, -1, 2, 2);
      context.restore();
      context.restore();
    }
  }
}
