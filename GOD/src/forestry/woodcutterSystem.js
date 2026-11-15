const WOODCUTTERS_PER_VILLAGER_COUNT = 8;
const WOOD_TARGET_PER_TASK = 12;
const STRIKE_INTERVAL = 0.9;
const FALL_DURATION = 1.1;
const WOOD_PROCESSING_SECONDS = 2.5;
const WORK_BREAK_SECONDS = 3;
const REGROWTH_SECONDS = {
  small: 70,
  medium: 105,
  large: 145
};
const CHOPS_TO_FELL = {
  small: 4,
  medium: 7,
  large: 10
};
const PROCESSING_MULTIPLIER = {
  small: 0.75,
  medium: 1,
  large: 1.5
};

function getHumanById(humans, id) {
  return humans.find((human) => human.id === id) ?? null;
}

function getPersonalityScore(human) {
  const traits = new Set(human.identity.personality);
  let score = human.identity.strength * 0.35;

  if (traits.has("Hardworking")) score += 24;
  if (traits.has("Brave")) score += 9;
  if (traits.has("Calm")) score += 7;
  if (traits.has("Patient")) score += 6;
  if (traits.has("Intelligent")) score += 4;
  if (traits.has("Lazy")) score -= 20;
  if (traits.has("Fearful")) score -= 7;
  if (traits.has("Clumsy")) score -= 4;

  return score;
}

function getTreeSize(tree) {
  return ["small", "medium", "large"].includes(tree.sizeClass)
    ? tree.sizeClass
    : "medium";
}

function normalizeAngle(angle) {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}

export class WoodcutterSystem {
  constructor() {
    this.tasks = [];
    this.taskBoard = { tasks: this.tasks };
    this.nextTaskId = 1;
    this.workerIds = new Set();
    this.workAreas = new Map();
    this.reservedAreas = [];
    this.regrowthQueue = [];
    this.fallenTrunks = [];
    this.simulationTime = 0;
  }

  update(deltaSeconds, humans, villageSystem, treeManager) {
    const delta = Number.isFinite(deltaSeconds)
      ? Math.max(0, Math.min(deltaSeconds, 0.1))
      : 0;
    this.simulationTime += delta;
    this._humansById = new Map(humans.map((human) => [human.id, human]));
    this._treeManager = treeManager;

    treeManager.setLandUseCheck((x, y, radius) =>
      this.isLandAvailable(x, y, radius)
    );

    this.updateTreeEffects(delta, treeManager);
    this.updateRegrowth(delta, villageSystem, treeManager);

    const village = villageSystem.currentVillage;

    if (!village || village.foundingStatus !== "established") {
      return;
    }

    this.ensureStorage(village, treeManager);
    this.ensureWoodcutters(village, humans);
    this.rebuildWorkAreas(village);

    for (const id of this.workerIds) {
      const worker = getHumanById(humans, id);

      if (!worker) {
        this.releaseWorker(id, treeManager);
        continue;
      }

      if (worker.isOffDuty) {
        continue;
      }

      this.updateWorker(worker, village, delta, treeManager);
    }
  }

  ensureStorage(village, treeManager) {
    if (!village.taskBoard) {
      village.taskBoard = { tasks: [] };
    }

    if (village.storage) {
      if (!village.storage.buildingCompleted) {
        village.storage.capacity = Math.min(village.storage.capacity ?? 30, 30);
      }
      village.storage.food ??= 0;
      village.storage.foodCapacity ??= 80;
      village.storage.reservedFood ??= 0;
      return;
    }

    village.storage = {
      x: village.centerX + village.radius * 0.28,
      y: village.centerY + village.radius * 0.2,
      wood: 0,
      capacity: 30,
      food: 0,
      foodCapacity: 80,
      reservedFood: 0,
      buildingCompleted: false,
      upgradePath: ["storageYard", "storageShed", "warehouse"]
    };

    this.prepareConstructionSite(
      `storage-yard-${village.id}`,
      village.storage.x,
      village.storage.y,
      16,
      treeManager
    );
  }

  ensureWoodcutters(village, humans) {
    const eligible = village.inhabitants
      .map((id) => getHumanById(humans, id))
      .filter((human) =>
        human && !human.isKing && human.profession === "none"
      );

    const existingWorkers = village.inhabitants
      .map((id) => getHumanById(humans, id))
      .filter((human) => human?.profession === "woodcutter");

    for (const worker of existingWorkers) {
      this.workerIds.add(worker.id);
    }

    const king = getHumanById(humans, village.kingId);
    const desiredCount = this.getKingWorkforceDecision(village, king);
    village.desiredWoodcutters = desiredCount;

    const hiresNeeded = Math.max(0, desiredCount - existingWorkers.length);
    eligible.sort((first, second) =>
      getPersonalityScore(second) - getPersonalityScore(first)
    );

    for (const worker of eligible.slice(0, hiresNeeded)) {
      worker.profession = "woodcutter";
      worker.actionPriority = "normal";
      worker.workTaskId = null;
      worker.workStatus = "idle";
      worker.workState = {
        phase: "idle",
        axeSwing: 0,
        carriedWood: 0
      };
      worker.workAreaId = null;
      this.workerIds.add(worker.id);
      this.createTask(worker, village);
    }

    for (const worker of existingWorkers) {
      if (!worker.workState) {
        worker.workState = {
          phase: "idle",
          axeSwing: 0,
          carriedWood: 0
        };
      }

      if (!worker.workTaskId) {
        this.createTask(worker, village);
      }
    }
  }

  getKingWorkforceDecision(village, king) {
    if (!king) {
      return 1;
    }

    const villagersPerWoodcutter =
      king.identity.leadership >= 75
        ? WOODCUTTERS_PER_VILLAGER_COUNT - 2
        : WOODCUTTERS_PER_VILLAGER_COUNT;

    return Math.max(
      1,
      Math.ceil(village.inhabitants.length / villagersPerWoodcutter)
    );
  }

  rebuildWorkAreas(village) {
    const workers = [...this.workerIds].sort();
    const count = workers.length;

    workers.forEach((id, index) => {
      const previousArea = this.workAreas.get(id);
      const area = {
        id: `${village.id}-work-area-${index + 1}`,
        villageId: village.id,
        sectorIndex: index,
        sectorCount: count,
        centerX: village.centerX,
        centerY: village.centerY,
        radius: village.radius
      };

      this.workAreas.set(id, area);

      const workerTask = this.getTaskForWorker(id);

      if (workerTask) {
        workerTask.workAreaId = area.id;
        const worker = this._humansById.get(id);

        if (worker) {
          worker.workAreaId = area.id;
        }

        if (
          previousArea &&
          (previousArea.sectorIndex !== area.sectorIndex ||
            previousArea.sectorCount !== area.sectorCount) &&
          workerTask.treeId
        ) {
          const assignedTree = this._treeManager.trees.find(
            (tree) => tree.id === workerTask.treeId
          );

          if (
            assignedTree &&
            !this.isTreeInsideWorkArea(assignedTree, area)
          ) {
            assignedTree.state.assignedTaskId = null;
            assignedTree.state.condition = "healthy";
            workerTask.treeId = null;
            workerTask.phase = workerTask.woodCollected >= workerTask.targetWood
              ? "delivering"
              : "seeking-tree";

            if (worker) {
              worker.movement.clearTemporaryTarget();
              worker.movement.setPaused(false);
            }
          }
        }
      }
    });

    for (const [workerId, area] of this.workAreas) {
      if (area.villageId === village.id && !workers.includes(workerId)) {
        this.workAreas.delete(workerId);
      }
    }
  }

  createTask(worker, village) {
    if (worker.workTaskId) {
      return null;
    }

    const task = {
      id: `woodcutting-${this.nextTaskId}`,
      type: "woodcutting",
      villageId: village.id,
      workerId: worker.id,
      workAreaId: null,
      targetWood: village.storage?.buildingCompleted
        ? WOOD_TARGET_PER_TASK
        : 4,
      woodCollected: 0,
      deliveredWood: 0,
      treeId: null,
      phase: "seeking-tree",
      timer: 0,
      strikes: 0,
      status: "active",
      createdAt: this.simulationTime
    };

    this.nextTaskId += 1;
    this.tasks.push(task);
    village.taskBoard?.tasks.push(task);
    worker.workTaskId = task.id;
    worker.workStatus = "working";
    worker.workState.phase = task.phase;
    return task;
  }

  getTaskForWorker(workerId) {
    return this.tasks.find(
      (task) => task.workerId === workerId && task.status === "active"
    ) ?? null;
  }

  isTreeInsideWorkArea(tree, area) {
    const dx = tree.x - area.centerX;
    const dy = tree.y - area.centerY;

    if (dx * dx + dy * dy > area.radius * area.radius) {
      return false;
    }

    if (area.sectorCount <= 1) {
      return true;
    }

    const angle = normalizeAngle(Math.atan2(dy, dx));
    const sectorWidth = (Math.PI * 2) / area.sectorCount;
    const sector = Math.floor(angle / sectorWidth);
    return sector === area.sectorIndex;
  }

  chooseTree(task, worker, treeManager) {
    const area = this.workAreas.get(task.workerId);

    if (!area) {
      return null;
    }

    let selectedInSector = null;
    let shortestSectorDistance = Infinity;
    let selectedInVillage = null;
    let shortestVillageDistance = Infinity;
    let selectedOutside = null;
    let closestOutsideBoundary = Infinity;
    let outsideWorkerDistance = Infinity;

    for (const tree of treeManager.trees) {
      if (
        tree.state.condition !== "healthy" ||
        tree.state.assignedTaskId !== null
      ) {
        continue;
      }

      const workerDx = tree.x - worker.movement.x;
      const workerDy = tree.y - worker.movement.y;
      const workerDistance = workerDx * workerDx + workerDy * workerDy;
      const villageDx = tree.x - area.centerX;
      const villageDy = tree.y - area.centerY;
      const centerDistance = Math.hypot(villageDx, villageDy);

      if (centerDistance <= area.radius) {
        if (workerDistance < shortestVillageDistance) {
          selectedInVillage = tree;
          shortestVillageDistance = workerDistance;
        }

        if (
          this.isTreeInsideWorkArea(tree, area) &&
          workerDistance < shortestSectorDistance
        ) {
          selectedInSector = tree;
          shortestSectorDistance = workerDistance;
        }
        continue;
      }

      const boundaryDistance = Math.max(0, centerDistance - area.radius - tree.radius);
      if (
        boundaryDistance < closestOutsideBoundary ||
        (boundaryDistance === closestOutsideBoundary &&
          workerDistance < outsideWorkerDistance)
      ) {
        selectedOutside = tree;
        closestOutsideBoundary = boundaryDistance;
        outsideWorkerDistance = workerDistance;
      }
    }

    // Suche zuerst im eigenen Sektor, dann im restlichen Dorfgebiet.
    // Erst wenn dort kein freier Baum steht, geht der Holzfäller nach draußen.
    return selectedInSector ?? selectedInVillage ?? selectedOutside;
  }

  updateWorker(worker, village, delta, treeManager) {
    const task = this.getTaskForWorker(worker.id);

    if (!task) {
      this.createTask(worker, village);
      return;
    }

    worker.workTaskId = task.id;
    const state = worker.workState;
    state.axeSwing = 0;

    if (task.phase === "break") {
      task.timer -= delta;
      worker.actionPriority = "normal";
      worker.workStatus = "break";
      state.phase = "break";
      worker.movement.setPaused(false);

      if (task.timer <= 0) {
        worker.actionPriority = "woodcutting";

        if (task.completeAfterBreak) {
          task.status = "completed";
          worker.workTaskId = null;
          this.createTask(worker, village);
          return;
        }

        task.phase = task.waitingForStorage
          ? "waiting-for-storage"
          : "seeking-tree";
        task.timer = 0;
      } else {
        return;
      }
    }

    worker.actionPriority = "woodcutting";
    worker.workStatus = "working";

    if (worker.social.conversationId !== null) {
      return;
    }

    if (task.phase === "seeking-tree") {
      if (task.woodCollected >= task.targetWood) {
        this.beginDelivery(task, worker, village.storage);
        return;
      }

      const tree = this.chooseTree(task, worker, treeManager);

      if (!tree) {
        worker.workStatus = "waiting-for-trees";
        worker.actionPriority = "normal";
        state.phase = "waiting";
        return;
      }

      task.treeId = tree.id;
      task.phase = "walking-to-tree";
      tree.state.assignedTaskId = task.id;
    }

    if (task.phase === "waiting-for-storage") {
      if (village.storage.wood >= village.storage.capacity) {
        worker.workStatus = "waiting-for-storage";
        worker.movement.setPaused(true);
        return;
      }

      task.phase = "walking-to-storage";
      worker.movement.setPaused(false);
      worker.movement.setTemporaryTarget(village.storage.x, village.storage.y);
    }

    if (task.phase === "walking-to-tree") {
      const tree = treeManager.trees.find((entry) => entry.id === task.treeId);

      if (!tree) {
        task.treeId = null;
        task.phase = "seeking-tree";
        worker.movement.clearTemporaryTarget();
        worker.movement.setPaused(false);
        return;
      }

      const distance = Math.hypot(
        tree.x - worker.movement.x,
        tree.y - worker.movement.y
      );

      if (distance > tree.radius + 13) {
        const angle = Math.atan2(
          worker.movement.y - tree.y,
          worker.movement.x - tree.x
        );
        const targetX = tree.x + Math.cos(angle) * (tree.radius + 8);
        const targetY = tree.y + Math.sin(angle) * (tree.radius + 8);

        if (!worker.movement.temporaryTarget) {
          worker.movement.setTemporaryTarget(targetX, targetY);
        }

        worker.movement.setPaused(false);
        state.phase = "walking-to-tree";
        return;
      }

      worker.movement.clearTemporaryTarget();
      worker.movement.setPaused(true);
      task.phase = "chopping";
      task.timer = 0;
      task.strikes = 0;
      tree.state.condition = "being-felled";
      tree.state.hitPulse = 0;
    }

    if (task.phase === "chopping") {
      const tree = treeManager.trees.find((entry) => entry.id === task.treeId);

      if (!tree) {
        task.treeId = null;
        task.phase = "seeking-tree";
        worker.movement.clearTemporaryTarget();
        worker.movement.setPaused(false);
        return;
      }

      worker.movement.setPaused(true);
      task.timer += delta;
      state.phase = "chopping";
      state.axeSwing = Math.sin(task.timer * Math.PI * 2 / STRIKE_INTERVAL);

      if (task.timer >= STRIKE_INTERVAL) {
        task.timer -= STRIKE_INTERVAL;
        task.strikes += 1;
        tree.state.hitPulse = 1.6;
        tree.state.hitPhase = task.strikes * 1.7;
      }

      if (task.strikes >= CHOPS_TO_FELL[getTreeSize(tree)]) {
        task.phase = "falling";
        task.timer = 0;
        tree.state.condition = "falling";
      }

      return;
    }

    if (task.phase === "falling") {
      const tree = treeManager.trees.find((entry) => entry.id === task.treeId);

      if (!tree) {
        task.treeId = null;
        task.phase = "seeking-tree";
        worker.movement.clearTemporaryTarget();
        worker.movement.setPaused(false);
        return;
      }

      task.timer += delta;
      tree.state.fellingProgress = Math.min(1, task.timer / FALL_DURATION);
      state.axeSwing = Math.sin(task.timer * 4) * 0.25;

      if (task.timer >= FALL_DURATION) {
        this.finishFelling(task, tree, treeManager);
      }

      return;
    }

    if (task.phase === "processing") {
      task.timer -= delta;
      state.phase = "processing";
      state.axeSwing = Math.sin(this.simulationTime * 5) * 0.45;

      if (task.timer <= 0) {
        const amount = task.lastTreeYield;
        task.woodCollected += amount;
        state.carriedWood = task.woodCollected;
        task.treeId = null;
        task.phase = task.woodCollected >= task.targetWood
          ? "delivering"
          : "seeking-tree";
      }
    }

    if (task.phase === "delivering") {
      this.beginDelivery(task, worker, village.storage);
    }

    if (task.phase === "walking-to-storage") {
      const storage = village.storage;
      const distance = Math.hypot(
        storage.x - worker.movement.x,
        storage.y - worker.movement.y
      );

      if (distance > 10) {
        if (!worker.movement.temporaryTarget) {
          worker.movement.setTemporaryTarget(storage.x, storage.y);
        }
        worker.movement.setPaused(false);
        state.phase = "carrying";
        return;
      }

      worker.movement.clearTemporaryTarget();
      worker.movement.setPaused(true);
      const deliverable = Math.min(
        state.carriedWood,
        Math.max(0, storage.capacity - storage.wood)
      );
      storage.wood += deliverable;
      state.carriedWood -= deliverable;
      task.deliveredWood += deliverable;
      task.woodCollected = state.carriedWood;
      task.waitingForStorage = state.carriedWood > 0;
      task.completeAfterBreak = task.deliveredWood >= task.targetWood;
      task.phase = "break";
      task.timer = WORK_BREAK_SECONDS;
      state.phase = "break";
      worker.workStatus = "break";
      worker.actionPriority = "normal";
      worker.movement.setPaused(false);
      return;
    }
  }

  beginDelivery(task, worker, storage) {
    task.phase = "walking-to-storage";
    worker.workState.phase = "carrying";
    worker.workState.carriedWood = task.woodCollected;
    worker.movement.setPaused(false);
    worker.movement.setTemporaryTarget(storage.x, storage.y);
  }

  finishFelling(task, tree, treeManager) {
    const treeRecord = {
      x: tree.x,
      y: tree.y,
      type: tree.type,
      sizeClass: getTreeSize(tree),
      scale: tree.scale,
      colorIndex: tree.colorIndex,
      taskId: task.id,
      workerId: task.workerId,
      woodUnits: tree.woodYield,
      processingProgress: 0
    };

    this.fallenTrunks.push(treeRecord);
    this.regrowthQueue.push({
      x: tree.x,
      y: tree.y,
      type: tree.type,
      sizeClass: getTreeSize(tree),
      scale: tree.scale,
      colorIndex: tree.colorIndex,
      remaining: REGROWTH_SECONDS[getTreeSize(tree)]
    });

    task.lastTreeSize = getTreeSize(tree);
    task.lastTreeYield = tree.woodYield;
    task.phase = "processing";
    task.timer = WOOD_PROCESSING_SECONDS * PROCESSING_MULTIPLIER[task.lastTreeSize];
    task.strikes = 0;
    treeManager.removeTree(tree.id);
  }

  updateTreeEffects(delta, treeManager) {
    for (const tree of treeManager.trees) {
      tree.state.hitPulse = Math.max(0, (tree.state.hitPulse ?? 0) - delta * 5);
      tree.state.hitPhase = (tree.state.hitPhase ?? 0) + delta * 8;
    }

    for (const trunk of this.fallenTrunks) {
      const task = this.tasks.find((entry) => entry.id === trunk.taskId);
      trunk.processingProgress = task?.phase === "processing"
        ? 1 - task.timer / (WOOD_PROCESSING_SECONDS * PROCESSING_MULTIPLIER[trunk.sizeClass])
        : 1;
    }

    this.fallenTrunks = this.fallenTrunks.filter((trunk) => {
      const task = this.tasks.find((entry) => entry.id === trunk.taskId);
      return task && task.phase === "processing";
    });
  }

  updateRegrowth(delta, villageSystem, treeManager) {
    for (const seed of this.regrowthQueue) {
      seed.remaining -= delta;
    }

    for (let index = this.regrowthQueue.length - 1; index >= 0; index -= 1) {
      const seed = this.regrowthQueue[index];

      if (
        seed.x < 0 ||
        seed.y < 0 ||
        seed.x >= treeManager.worldWidth ||
        seed.y >= treeManager.worldHeight
      ) {
        this.regrowthQueue.splice(index, 1);
        continue;
      }

      if (seed.remaining > 0) {
        continue;
      }

      if (!this.isLandAvailable(seed.x, seed.y, 12)) {
        seed.remaining = 15;
        continue;
      }

      const tree = treeManager.createTree(seed.x, seed.y, seed.type, {
        scale: seed.scale,
        colorIndex: seed.colorIndex,
        sizeClass: seed.sizeClass
      });

      if (tree) {
        this.regrowthQueue.splice(index, 1);
      } else {
        seed.remaining = 15;
      }
    }
  }

  isLandAvailable(x, y, radius = 0) {
    return this.reservedAreas.every((area) => {
      const combinedRadius = radius + area.radius;
      const dx = x - area.x;
      const dy = y - area.y;
      return dx * dx + dy * dy >= combinedRadius * combinedRadius;
    });
  }

  reserveArea(id, x, y, radius, kind = "construction") {
    const existing = this.reservedAreas.find((area) => area.id === id);

    if (existing) {
      existing.x = x;
      existing.y = y;
      existing.radius = radius;
      existing.kind = kind;
      return existing;
    }

    const area = { id, x, y, radius, kind };
    this.reservedAreas.push(area);
    return area;
  }

  releaseReservedArea(id) {
    const index = this.reservedAreas.findIndex((area) => area.id === id);

    if (index === -1) {
      return false;
    }

    this.reservedAreas.splice(index, 1);
    return true;
  }

  prepareConstructionSite(id, x, y, radius, treeManager) {
    this.reserveArea(id, x, y, radius, "building");

    for (const tree of treeManager.getTreesInRadius(x, y, radius)) {
      tree.state.assignedTaskId = null;
      this.scheduleRegrowth(tree);
      treeManager.removeTree(tree.id);
    }
  }

  scheduleRegrowth(tree) {
    this.regrowthQueue.push({
      x: tree.x,
      y: tree.y,
      type: tree.type,
      sizeClass: getTreeSize(tree),
      scale: tree.scale,
      colorIndex: tree.colorIndex,
      remaining: REGROWTH_SECONDS[getTreeSize(tree)]
    });
  }

  releaseWorker(workerId, treeManager) {
    const task = this.getTaskForWorker(workerId);

    if (task?.treeId) {
      const tree = treeManager.trees.find((entry) => entry.id === task.treeId);

      if (tree) {
        tree.state.assignedTaskId = null;
        tree.state.condition = "healthy";
      }
    }

    if (task) {
      task.status = "cancelled";
    }

    this.workerIds.delete(workerId);
    this.workAreas.delete(workerId);
  }

  drawGround(context, villageSystem) {
    const village = villageSystem.currentVillage;

    for (const trunk of this.fallenTrunks) {
      const progress = Math.max(0, Math.min(1, trunk.processingProgress));
      const pieces = Math.max(0, Math.floor(trunk.woodUnits * progress));

      context.save();
      context.translate(trunk.x, trunk.y);
      context.rotate(-0.38);
      context.fillStyle = "#60432f";
      context.fillRect(-12, -2, 24, 4);
      context.fillStyle = "#9a7048";
      context.fillRect(-11, -1, 22, 2);
      context.fillStyle = "#c19a68";

      for (let index = 0; index < pieces; index += 1) {
        context.fillRect(-10 + index * 4, 5, 3, 2);
      }

      context.restore();
    }

    if (!village?.storage) {
      return;
    }

    const storage = village.storage;
    const visibleUnits = Math.min(12, Math.ceil(storage.wood / 10));
    if (!storage.buildingCompleted && visibleUnits === 0) return;

    context.save();
    context.translate(storage.x, storage.y);
    context.fillStyle = "rgba(35, 30, 24, 0.25)";
    context.beginPath();
    context.ellipse(0, 8, 15, 5, 0, 0, Math.PI * 2);
    context.fill();

    if (storage.buildingCompleted) {
      context.fillStyle = "#795638";
      context.fillRect(-14, -5, 28, 14);
      context.fillStyle = "#b18450";
      context.fillRect(-11, -3, 22, 10);
      context.fillStyle = "#63452e";
      context.fillRect(-16, -10, 32, 6);
      context.fillStyle = "#9b6946";
      context.fillRect(-14, -12, 28, 2);
      context.fillStyle = "#b87e50";
      for (let row = 0; row < 3; row += 1) {
        context.fillRect(-13 + row % 2, -9 + row * 2, 26 - row % 2 * 2, 1);
      }
      context.fillStyle = "#4b3527";
      context.fillRect(-4, 2, 8, 7);
      context.fillStyle = "#d0ab69";
      context.fillRect(-3, 3, 1, 4);
    }

    for (let index = 0; index < visibleUnits; index += 1) {
      const row = Math.floor(index / 6);
      const column = index % 6;
      const logX = -10 + column * 4;
      const logY = (storage.buildingCompleted ? 8 : 3) + row * 3;
      context.fillStyle = index % 2 === 0 ? "#60432f" : "#795638";
      context.fillRect(logX, logY, 5, 3);
      context.fillStyle = "#b18450";
      context.fillRect(logX + 1, logY, 3, 1);
      context.fillStyle = "#d2b17a";
      context.fillRect(logX, logY + 1, 1, 1);
    }

    context.restore();
  }

  drawCarriedWood(context, humans, zoom) {
    const safeZoom = Math.max(0.01, zoom);

    for (const human of humans) {
      if (
        human.profession !== "woodcutter" ||
        !human.workState ||
        human.workState.carriedWood <= 0
      ) {
        continue;
      }

      context.save();
      context.translate(human.movement.x, human.movement.y - 8);
      context.scale(1 / safeZoom, 1 / safeZoom);
      const pieces = Math.min(4, Math.ceil(human.workState.carriedWood / 2));
      context.fillStyle = "#91663f";

      for (let index = 0; index < pieces; index += 1) {
        context.fillRect(-3 + index * 2, -2 - (index % 2), 6, 2);
      }

      context.restore();
    }
  }
}
