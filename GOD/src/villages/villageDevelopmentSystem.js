const BUILDING_TYPES = {
  campfire: { name: "Campfire", radius: 9, wood: 4, work: 12, color: "#76523a" },
  taskBoard: { name: "Task Board", radius: 8, wood: 6, work: 18, color: "#795638" },
  storageYard: { name: "Storage Yard", radius: 16, wood: 12, work: 28, color: "#9b7045" },
  townHall: { name: "Town Hall", radius: 22, wood: 28, work: 50, color: "#826043" },
  smallHouse: { name: "Small House", radius: 14, wood: 18, work: 24, capacity: 2, color: "#a37a52" },
  normalHouse: { name: "House", radius: 18, wood: 32, work: 42, capacity: 4, color: "#8b6443" },
  largeHouse: { name: "Large House", radius: 23, wood: 48, work: 64, capacity: 6, color: "#76543d" },
  farm: { name: "Farm", radius: 46, wood: 38, work: 68, color: "#8b704c" },
  road: { name: "Dirt Path", radius: 4, wood: 0, work: 8, color: "#8b704c" }
};

const REPRESENTATIVE_POPULATION = 12;
const BUILDING_SPACING = 12;
const NEED_INTERVAL = 18;
const TREE_GROWTH_INTERVAL = 55;
const DAY_CYCLE_SECONDS = 180;
const FOOD_BALANCE_SAMPLE_SECONDS = 90;
const AVERAGE_MEAL_REDUCTION = 64;
const HUNGER_INCREASE_PER_SECOND = 0.22;
const FARM_FOOD_PER_HARVEST = 26;
const FARM_CYCLE_SECONDS = DAY_CYCLE_SECONDS * 2 + 45;
const FARM_FOOD_PER_DAY =
  FARM_FOOD_PER_HARVEST * DAY_CYCLE_SECONDS / FARM_CYCLE_SECONDS;
const FOOD_PRODUCTION_SURPLUS = 1.15;
const CAMPFIRE_REMOTE_DISTANCE = 110;
const CAMPFIRE_MIN_SPACING = 125;
const CAMPFIRE_MIN_RESIDENTS = 6;
const INITIAL_BUILDING_ORDER = ["campfire", "taskBoard", "storageYard", "townHall"];
const BOARD_STORAGE_KEY = "medieval-world-village-tasks-v1";
const REQUEST_STORAGE_KEY = "medieval-world-village-requests-v1";

function distanceSquared(x1, y1, x2, y2) {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return dx * dx + dy * dy;
}

function smoothStep(edgeStart, edgeEnd, value) {
  const amount = Math.max(0, Math.min(1, (value - edgeStart) / (edgeEnd - edgeStart)));
  return amount * amount * (3 - 2 * amount);
}

function getHuman(humans, id) {
  return humans.find((human) => human.id === id) ?? null;
}

function setTarget(human, x, y) {
  const target = human.movement.temporaryTarget;
  if (!target || Math.abs(target.x - x) > 0.01 || Math.abs(target.y - y) > 0.01) {
    human.movement.setTemporaryTarget(x, y);
  }
}

function hasTrait(human, trait) {
  return human.identity.personality.includes(trait);
}

function builderScore(human) {
  let score = human.identity.strength * 0.2;
  if (hasTrait(human, "Hardworking")) score += 20;
  if (hasTrait(human, "Patient")) score += 12;
  if (hasTrait(human, "Intelligent")) score += 10;
  if (hasTrait(human, "Lazy")) score -= 24;
  if (hasTrait(human, "Clumsy")) score -= 8;
  return score;
}

function getConstructionTaskPriority(task) {
  if (task.buildingType?.endsWith("House")) return 0;
  if (["campfire", "taskBoard", "storageYard", "townHall"].includes(task.buildingType)) return 1;
  if (task.buildingType === "farm") return 2;
  if (task.buildingType === "road") return 3;
  return 1;
}

function getHouseVisualSize(radius) {
  return {
    width: Math.max(24, Math.floor(radius * 1.9)),
    height: Math.max(20, Math.floor(radius * 1.4))
  };
}

function getPathLength(points) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y
    );
  }
  return length;
}

function getClosestPointOnPath(x, y, points) {
  let closest = null;
  let closestDistance = Infinity;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const amount = lengthSquared > 0
      ? Math.max(0, Math.min(1, ((x - start.x) * dx + (y - start.y) * dy) / lengthSquared))
      : 0;
    const point = { x: start.x + dx * amount, y: start.y + dy * amount };
    const distance = distanceSquared(x, y, point.x, point.y);

    if (distance < closestDistance) {
      closest = point;
      closestDistance = distance;
    }
  }

  return closest;
}

export class VillageDevelopmentSystem {
  constructor() {
    this.nextBuildingId = 1;
    this.nextTaskId = 1;
    this.simulationTime = 0;
    this.dayCycleTime = DAY_CYCLE_SECONDS * 0.3;
    this.daylight = 1;
    this.isNight = false;
    this.needTimer = 0;
    this.treeGrowthTimer = TREE_GROWTH_INTERVAL;
    this.lastSaveTime = 0;
    this.fireTime = 0;
    this.currentVillageId = null;
    this.buildings = [];
    this.tasks = [];
    this.requests = [];
    this.assignedHousing = new Map();
    this.roadRetryAt = new Map();
  }

  update(deltaSeconds, humans, villageSystem, treeManager, woodcutterSystem) {
    const delta = Math.min(Math.max(Number(deltaSeconds) || 0, 0), 0.1);
    this.simulationTime += delta;
    this.fireTime += delta;
    this.dayCycleTime = (this.dayCycleTime + delta) % DAY_CYCLE_SECONDS;
    const dayPhase = this.dayCycleTime / DAY_CYCLE_SECONDS;
    this.daylight = Math.min(
      smoothStep(0.08, 0.22, dayPhase),
      1 - smoothStep(0.62, 0.78, dayPhase)
    );
    this.isNight = dayPhase >= 0.72 || dayPhase < 0.12;
    this._treeManager = treeManager;
    this._woodcutterSystem = woodcutterSystem;
    const village = villageSystem.currentVillage;
    if (!village || village.foundingStatus !== "established") return;

    if (this.currentVillageId !== village.id) this.initializeVillage(village, woodcutterSystem);
    this.ensureOrderedBuildings(village, treeManager, woodcutterSystem);
    this._currentVillage = village;
    this.updateFoodBalance(delta, village, humans);
    village.management.requests = this.requests;
    this.ensureBuilders(village, humans);
    this.updateNeeds(delta, village, humans);
    this.updateRequests(village, humans);
    this.updateTasks(delta, village, humans, treeManager, woodcutterSystem);
    this.ensureVillageRoads(village, humans, treeManager, woodcutterSystem);
    this.ensureNextBuildingTask(village, humans, treeManager, woodcutterSystem);
    this.assignHousing(village, humans);
    this.ensureAdditionalCampfire(village, treeManager, woodcutterSystem);
    this.ensureFarmConstruction(village, humans, treeManager, woodcutterSystem);
    this.updateCivilianRoutines(village, humans, treeManager);
    this.maybeAppointRepresentative(village, humans);
    this.growVillageTree(delta, village, treeManager);
    if (this.simulationTime - this.lastSaveTime >= 5) {
      this.saveTasks(village);
      this.lastSaveTime = this.simulationTime;
    }
  }

  initializeVillage(village, woodcutterSystem) {
    this.currentVillageId = village.id;
    this.buildings = [];
    this.tasks = [];
    this.requests = [];
    this.assignedHousing.clear();
    this.roadRetryAt.clear();
    village.taskBoard ??= { tasks: [] };
    village.taskBoard.tasks ??= [];
    village.management ??= {};
    village.management.desiredBuilders ??= 1;
    village.management.representativeId ??= null;
    village.management.needs ??= {};
    village.management.requests ??= [];
    village.management.saveId ??= `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    this.loadTasks(village);
    this.loadRequests(village);
    this.loadStorage(village);
    for (const task of this.tasks) {
      if (!village.taskBoard.tasks.some((entry) => entry.id === task.id)) village.taskBoard.tasks.push(task);
    }

    for (const task of this.tasks) {
      const definition = BUILDING_TYPES[task.buildingType];
      if (!definition) continue;
      const done = task.status === "completed";
      this.buildings.push({
        id: task.buildingId, villageId: village.id, type: task.buildingType,
        x: task.x, y: task.y, radius: definition.radius,
        state: done ? "completed" : "planned", progress: done ? 1 : task.progress ?? 0,
        workRequired: task.workRequired ?? definition.work,
        workDone: done ? (task.workRequired ?? definition.work) : task.workDone ?? 0,
        capacity: definition.capacity ?? 0, residents: [], taskId: task.id, storage: null,
        farmState: task.farmState ?? null,
        roadPoints: task.roadPoints ?? null,
        roadForBuildingId: task.roadForBuildingId ?? null,
        pathLength: task.pathLength ?? 0
      });
      task.workerIds = [];
      if (task.inTransitWood > 0 && village.storage) {
        village.storage.wood = Math.min(village.storage.capacity, village.storage.wood + task.inTransitWood);
        task.inTransitWood = 0;
      }
      task.reservedWood = 0;
      task.status = done ? "completed" : "available";
      task.phase = done ? "completed" : (task.deliveredWood >= task.requiredWood ? "building" : "gathering-materials");
    }
    this.nextBuildingId = this.tasks.length + 1;
    village.storage && (village.storage.reservedWood = 0);

  }

  addCompletedBuilding(village, type, x, y, woodcutterSystem, storage = null) {
    if (type !== "campfire" && this.buildings.some((building) => building.type === type)) return;
    const definition = BUILDING_TYPES[type];
    const building = {
      id: `${type}-${village.id}-${this.nextBuildingId++}`,
      villageId: village.id,
      type,
      x,
      y,
      radius: definition.radius,
      state: "completed",
      progress: 1,
      workRequired: definition.work,
      workDone: definition.work,
      capacity: definition.capacity ?? 0,
      residents: [],
      storage
    };
    if (type === "campfire") {
      building.lightRadius = 42;
      building.warmthRadius = 28;
    }
    if (type === "storageYard" && storage) {
      storage.upgradePath ??= ["storageYard", "storageShed", "warehouse"];
    }
    this.buildings.push(building);
    if (woodcutterSystem && type !== "storageYard") {
      woodcutterSystem.prepareConstructionSite(building.id, x, y, building.radius + 3, this._treeManager);
    }
  }

  ensureOrderedBuildings(village, treeManager, woodcutterSystem) {
    for (const building of this.buildings) {
      if (building.type !== "storageYard" && building.type !== "road") {
        woodcutterSystem.reserveArea(building.id, building.x, building.y, building.radius + 3, "building");
        if (building.state !== "completed") {
          for (const tree of treecutterSafeRadius(treeManager, building.x, building.y, building.radius)) {
            tree.state.assignedTaskId = null;
            woodcutterSystem.scheduleRegrowth(tree);
            treeManager.removeTree(tree.id);
          }
        }
      }
    }
    // Keep the tree manager's current land-use predicate while adding completed building footprints.
    treeManager.setLandUseCheck((x, y, radius) =>
      woodcutterSystem.isLandAvailable(x, y, radius) &&
      this.buildings.every((building) => building.type === "road" || distanceSquared(x, y, building.x, building.y) >= (radius + building.radius + 3) ** 2)
    );
  }

  ensureBuilders(village, humans) {
    const residents = village.inhabitants.map((id) => getHuman(humans, id)).filter(Boolean);
    const king = getHuman(humans, village.kingId);
    const leadershipBonus = king && king.identity.leadership >= 75 ? 1 : 0;
    const desired = Math.max(1, Math.min(4, Math.ceil(residents.length / 6) + leadershipBonus));
    village.management.desiredBuilders = desired;
    const builders = residents.filter((human) => human.profession === "builder");
    const eligible = residents.filter((human) => !human.isKing && human.profession === "none");
    eligible.sort((a, b) => builderScore(b) - builderScore(a));
    for (const human of eligible.slice(0, Math.max(0, desired - builders.length))) {
      human.profession = "builder";
      human.workTaskId = null;
      human.workStatus = "idle";
      human.workState = { phase: "idle", axeSwing: 0, carriedWood: 0, hammerSwing: 0, carriedMaterials: 0 };
    }
    if (king) king.profession = "king";
  }

  ensureNextBuildingTask(village, humans, treeManager, woodcutterSystem) {
    const activeTask = this.tasks.some(
      (task) =>
        !["road", "farm"].includes(task.buildingType) &&
        (task.status === "available" || task.status === "active")
    );

    if (activeTask) return;

    const nextType = INITIAL_BUILDING_ORDER.find(
      (type) =>
        !this.buildings.some(
          (building) =>
            building.type === type &&
            building.state === "completed"
        )
    );

    if (!nextType) return;

    if (nextType === "storageYard" && village.storage) {
      this.createConstructionTask(
        village,
        nextType,
        village.storage.x,
        village.storage.y,
        humans,
        woodcutterSystem
      );
      return;
    }

    const sites = this.findBuildingSitesForTypes(
      village,
      [nextType],
      treeManager
    );

    const site = sites[0];
    if (!site) return;

    this.createConstructionTask(
      village,
      nextType,
      site.x,
      site.y,
      humans,
      woodcutterSystem
    );
  }

  updateFoodBalance(delta, village, humans) {
  const storage = village.storage;
  if (!storage) return;

  storage.foodBalance ??= {};
  const balance = storage.foodBalance;

  balance.sampleElapsed ??= 0;
  balance.foodConsumedSinceSample ??= 0;
  balance.berriesProducedSinceSample ??= 0;
  balance.measuredConsumptionPerDay ??= 0;
  balance.berryProductionPerDay ??= 0;
  balance.farmProductionPerDay ??= 0;
  balance.consumptionPerDay ??= 0;
  balance.productionPerDay ??= 0;

  let estimatedConsumptionPerDay = 0;

  for (const id of village.inhabitants) {
    const human = getHuman(humans, id);
    if (!human) continue;

    const hungerRate = human.needs?.hungerRate ?? 1;
    const isWorking =
      Boolean(human.workTaskId) ||
      ["work", "woodcutting", "farming"].includes(human.actionPriority);
    const isMoving = human.movement?.speed > 0.35;
    const activityRate = isWorking ? 1.8 : isMoving ? 1.25 : 1;

    estimatedConsumptionPerDay +=
      HUNGER_INCREASE_PER_SECOND *
      hungerRate *
      activityRate *
      DAY_CYCLE_SECONDS /
      AVERAGE_MEAL_REDUCTION;
  }

  balance.sampleElapsed += delta;

  if (balance.sampleElapsed >= FOOD_BALANCE_SAMPLE_SECONDS) {
    const scale = DAY_CYCLE_SECONDS / balance.sampleElapsed;
    const measuredConsumption =
      balance.foodConsumedSinceSample * scale;
    const measuredBerryProduction =
      balance.berriesProducedSinceSample * scale;

    balance.measuredConsumptionPerDay =
      balance.measuredConsumptionPerDay > 0
        ? balance.measuredConsumptionPerDay * 0.5 +
          measuredConsumption * 0.5
        : measuredConsumption;

    balance.berryProductionPerDay =
      balance.berryProductionPerDay > 0
        ? balance.berryProductionPerDay * 0.5 +
          measuredBerryProduction * 0.5
        : measuredBerryProduction;

    balance.sampleElapsed = 0;
    balance.foodConsumedSinceSample = 0;
    balance.berriesProducedSinceSample = 0;
  }

  const farms = this.buildings.filter(
    (building) =>
      building.type === "farm" &&
      building.state !== "cancelled"
  );

  balance.estimatedConsumptionPerDay = estimatedConsumptionPerDay;
  balance.consumptionPerDay = Math.max(
    estimatedConsumptionPerDay,
    balance.measuredConsumptionPerDay  );

  // This includes completed farms and farms already planned or being built.
  balance.farmProductionPerDay = farms.length * FARM_FOOD_PER_DAY;
  balance.productionPerDay =
    balance.berryProductionPerDay +
    balance.farmProductionPerDay;
  }

  ensureFarmConstruction(village, humans, treeManager, woodcutterSystem) {
    const requiredBuildings = ["campfire", "taskBoard", "storageYard", "townHall"];
    const villageReady = requiredBuildings.every((type) =>
      this.buildings.some((building) =>
        building.type === type && building.state === "completed"
      )
    );

    if (
      !villageReady ||
      !village.storage?.buildingCompleted ||
      village.inhabitants.length < 6 ||
      this.tasks.some((task) =>
        task.buildingType !== "road" &&
        (task.status === "available" || task.status === "active")
      )
    ) {
      return;
    }

    const balance = village.storage.foodBalance;
    if (!balance) return;
    if (
      balance.productionPerDay >=
      balance.consumptionPerDay * FOOD_PRODUCTION_SURPLUS
    ) {
      return;
    }

    const site = this.findBuildingSitesForTypes(village, ["farm"], treeManager)[0];
    if (!site) return;

    this.createConstructionTask(
      village,
      "farm",
      site.x,
      site.y,
      humans,
      woodcutterSystem
    );
  }

  findBuildingSitesForTypes(village, buildingTypes, treeManager) {
    if (buildingTypes.length === 0) return [];

    const startingRadius = village.radius;
    const farthestWorldCorner = Math.max(
      Math.hypot(village.centerX, village.centerY),
      Math.hypot(treeManager.worldWidth - village.centerX, village.centerY),
      Math.hypot(village.centerX, treeManager.worldHeight - village.centerY),
      Math.hypot(
        treeManager.worldWidth - village.centerX,
        treeManager.worldHeight - village.centerY
      )
    );
    const largestBuildingRadius = Math.max(
      ...buildingTypes.map((type) => BUILDING_TYPES[type]?.radius ?? 0)
    );
    // Let the village grow toward any open part of the map, even when its center
    // is close to one edge. Actual building sites still stay inside the world.
    const maximumRadius = Math.max(
      startingRadius,
      farthestWorldCorner + largestBuildingRadius + BUILDING_SPACING + 5
    );

    let bestSites = [];
    let bestRadius = startingRadius;
    let testRadius = startingRadius;

    while (true) {
      village.radius = testRadius;
      const plannedSites = [];

      for (const type of buildingTypes) {
        const site = this.findBuildingSite(
          village,
          type,
          treeManager,
          plannedSites
        );

        if (!site) break;

        plannedSites.push({
          type,
          x: site.x,
          y: site.y,
          radius: BUILDING_TYPES[type].radius
        });
      }

      if (plannedSites.length > bestSites.length) {
        bestSites = plannedSites;
        bestRadius = testRadius;
      }

      if (plannedSites.length === buildingTypes.length) {
        bestSites = plannedSites;
        bestRadius = testRadius;
        break;
      }

      if (testRadius >= maximumRadius) break;

      testRadius = Math.min(testRadius + 40, maximumRadius);
    }

    village.radius = bestRadius;

    const expansionSteps = Math.ceil(
      (bestRadius - startingRadius) / 40
    );

    if (expansionSteps > 0) {
      village.management.territoryTier ??= 0;
      village.management.territoryTier += expansionSteps;
    }

    return bestSites;
  }

  findBuildingSite(
    village,
    type,
    treeManager,
    plannedSites = []
  ) {
    const definition = BUILDING_TYPES[type];
    if (!definition) return null;

    const radius = definition.radius;
    const maximumDistance = village.radius - radius - 5;
    const minimumDistance = 32;

    if (maximumDistance < minimumDistance) return null;

    const candidateCount = 180;
    const angleOffset =
      (this.buildings.length + plannedSites.length) * 1.618;

    for (let index = 0; index < candidateCount; index += 1) {
      const progress = (index + 1) / candidateCount;
      const distance =
        minimumDistance +
        Math.sqrt(progress) * (maximumDistance - minimumDistance);
      const angle = angleOffset + index * 2.399963229728653;
      const x = village.centerX + Math.cos(angle) * distance;
      const y = village.centerY + Math.sin(angle) * distance;

      if (
        x < radius ||
        y < radius ||
        x > treeManager.worldWidth - radius ||
        y > treeManager.worldHeight - radius
      ) {
        continue;
      }

      if (
        distanceSquared(x, y, village.centerX, village.centerY) >
        (village.radius - radius - 5) ** 2
      ) {
        continue;
      }

      const overlapsBuilding = this.buildings.some(
        (building) => building.type !== "road" &&
          distanceSquared(x, y, building.x, building.y) <
        (radius + building.radius + BUILDING_SPACING) ** 2
      );

      if (overlapsBuilding) continue;

      const overlapsTask = this.tasks.some(
        (task) =>
          task.status !== "completed" &&
          task.status !== "cancelled" &&
          distanceSquared(x, y, task.x, task.y) <
            (radius + task.radius + BUILDING_SPACING) ** 2
      );

      if (overlapsTask) continue;

      const overlapsPlannedSite = plannedSites.some(
        (site) =>
          distanceSquared(x, y, site.x, site.y) <
          (radius + site.radius + BUILDING_SPACING) ** 2
      );

      if(overlapsPlannedSite) continue;

      const overlapsReservedArea =
        this._woodcutterSystem?.reservedAreas?.some(
          (area) =>
            distanceSquared(x, y, area.x, area.y) <
            (radius + area.radius + BUILDING_SPACING) ** 2
        );
      
        if (overlapsReservedArea) continue;

        return { x, y};
    }

    return null;
  }

  ensureVillageRoads(village, humans, treeManager, woodcutterSystem) {
    // Roads are optional decoration. Build them one at a time so a long road
    // queue cannot consume all builder slots or delay houses and farms.
    const unfinishedRoad = this.tasks.some(
      (task) =>
        task.buildingType === "road" &&
        (task.status === "available" || task.status === "active")
    );
    if (unfinishedRoad) return;

    const campfires = this.buildings.filter(
      (building) =>
        building.type === "campfire" &&
        building.state === "completed"
    );
    if (campfires.length === 0) return;

    const mainCampfire = campfires[0];

    for (const source of this.buildings) {
      const isHouse =
        source.type.endsWith("House") &&
        source.state === "completed";
      const isAdditionalCampfire =
        source.type === "campfire" &&
        source.id !== mainCampfire.id &&
        source.state === "completed";
      const isFarm = source.type === "farm" && source.state === "completed";
      if (!isHouse && !isAdditionalCampfire && !isFarm) continue;

      const alreadyConnected = this.tasks.some(
        (task) =>
          task.roadForBuildingId === source.id &&
          task.status !== "cancelled"
      );
      if (alreadyConnected) continue;
      if ((this.roadRetryAt.get(source.id) ?? 0) > this.simulationTime) continue;

      const start = isHouse
        ? {
            x: source.x,
            y: source.y + getHouseVisualSize(source.radius).height * 0.5 + 3
          }
        : isFarm
          ? { x: source.x - 20, y: source.y + 23 }
          : { x: source.x, y: source.y + source.radius + 5 };

      let end = null;
      let destinationBuilding = null;
      let closestDistance = Infinity;

      for (const fire of campfires) {
        if (fire.id === source.id) continue;
        const distance = distanceSquared(start.x, start.y, fire.x, fire.y);
        if (distance < closestDistance) {
          closestDistance = distance;
          end = { x: fire.x, y: fire.y };
          destinationBuilding = fire;
        }
      }

      for (const road of this.buildings) {
        if (road.type !== "road" || !road.roadPoints || road.state === "planned") continue;
        const point = getClosestPointOnPath(start.x, start.y, road.roadPoints);
        if (!point) continue;
        const distance = distanceSquared(start.x, start.y, point.x, point.y);
        if (distance < closestDistance) {
          closestDistance = distance;
          end = point;
          destinationBuilding = null;
        }
      }

      if (!end) continue;

      const route = this.findRoadRoute(
        start,
        end,
        source,
        destinationBuilding,
        treeManager
      );
      if (route.length < 2) {
        this.roadRetryAt.set(source.id, this.simulationTime + 10);
        continue;
      }

      const pathLength = getPathLength(route);
      const midpoint = this.getPathPointAtDistance(route, pathLength * 0.5);
      const task = this.createConstructionTask(
        village,
        "road",
        midpoint.x,
        midpoint.y,
        humans,
        woodcutterSystem,
        {
          roadPoints: route,
          roadForBuildingId: source.id,
          pathLength
        }
      );
      task.workRequired = Math.max(8, pathLength * 0.22);

      const roadBuilding = this.buildings.find(
        (building) => building.id === task.buildingId
      );
      if (roadBuilding) roadBuilding.workRequired = task.workRequired;

      this.roadRetryAt.delete(source.id);
      break;
    }
  }

  ensureAdditionalCampfire(village, treeManager, woodcutterSystem) {
    const requiredBuildings = ["campfire", "taskBoard", "storageYard", "townHall"];
    const villageReady = requiredBuildings.every((type) =>
      this.buildings.some(
        (building) => building.type === type && building.state === "completed"
      )
    );

    if (!villageReady) return;

    const campfires = this.buildings.filter(
      (building) => building.type === "campfire"
    );

    if (campfires.length === 0 || campfires.some((fire) => fire.state !== "completed")) {
      return;
    }

    let remoteResidentCount = 0;
    let weightedX = 0;
    let weightedY = 0;

    for (const house of this.buildings) {
      if (
        !house.type.endsWith("House") ||
        house.state !== "completed" ||
        !house.residents?.length
      ) {
        continue;
      }

      let closestFireDistance = Infinity;

      for (const fire of campfires) {
        closestFireDistance = Math.min(
          closestFireDistance,
          distanceSquared(house.x, house.y, fire.x, fire.y)
        );
      }

      if (closestFireDistance <= CAMPFIRE_REMOTE_DISTANCE ** 2) continue;

      const residentsHere = house.residents.length;
      remoteResidentCount += residentsHere;
      weightedX += house.x * residentsHere;
      weightedY += house.y * residentsHere;
    }

    if (remoteResidentCount < CAMPFIRE_MIN_RESIDENTS) return;

    const centerX = weightedX / remoteResidentCount;
    const centerY = weightedY / remoteResidentCount;
    const radius = BUILDING_TYPES.campfire.radius;
    const goldenAngle = 2.399963229728653;

    for (let index = 0; index < 84; index += 1) {
      const ring = 26 + Math.floor(index / 12) * 12;
      const angle = index * goldenAngle;
      const x = centerX + Math.cos(angle) * ring;
      const y = centerY + Math.sin(angle) * ring;

      if (
        x < radius + 3 ||
        y < radius + 3 ||
        x > treeManager.worldWidth - radius - 3 ||
        y > treeManager.worldHeight - radius - 3
      ) {
        continue;
      }

      if (
        distanceSquared(x, y, village.centerX, village.centerY) >
        (village.radius - radius - 8) ** 2
      ) {
        continue;
      }

      const tooCloseToFire = campfires.some(
        (fire) =>
          distanceSquared(x, y, fire.x, fire.y) < CAMPFIRE_MIN_SPACING ** 2
      );
      if (tooCloseToFire) continue;

      const overlapsBuilding = this.buildings.some(
        (building) =>
          building.type !== "road" &&
          distanceSquared(x, y, building.x, building.y) <
            (radius + building.radius + BUILDING_SPACING) ** 2
      );
      if (overlapsBuilding) continue;

      const overlapsTask = this.tasks.some(
        (task) =>
          task.status !== "completed" &&
          task.status !== "cancelled" &&
          distanceSquared(x, y, task.x, task.y) <
            (radius + task.radius + BUILDING_SPACING) ** 2
      );
      if (overlapsTask) continue;

      const overlapsReservedArea =
        woodcutterSystem?.reservedAreas?.some(
          (area) =>
            distanceSquared(x, y, area.x, area.y) <
            (radius + area.radius + BUILDING_SPACING) ** 2
        );
      if (overlapsReservedArea) continue;
      if (!treeManager.hasRoomAt(x, y, radius)) continue;

      if (
        treeManager.landUseCheck &&
        !treeManager.landUseCheck(x, y, radius)
      ) {
        continue;
      }

      this.createConstructionTask(
        village,
        "campfire",
        x,
        y,
        [],
        woodcutterSystem
      );
      return;
    }
  }

  findRoadRoute(start, end, sourceBuilding, destinationBuilding, treeManager) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 1) return [];

    const normalX = -dy / length;
    const normalY = dx / length;
    const candidates = [
      [start, end],
      [start, { x: end.x, y: start.y }, end],
      [start, { x: start.x, y: end.y }, end]
    ];

    for (const offset of [-56, -32, 32, 56]) {
      candidates.push([
        start,
        {
          x: (start.x + end.x) * 0.5 + normalX * offset,
          y: (start.y + end.y) * 0.5 + normalY * offset
        },
        end
      ]);
    }

    let bestRoute = null;
    let bestLength = Infinity;

    for (const candidate of candidates) {
      const candidateLength = getPathLength(candidate);
      if (candidateLength >= bestLength) continue;
      if (!this.isRoadRouteClear(candidate, sourceBuilding, destinationBuilding, treeManager)) continue;
      bestRoute = candidate;
      bestLength = candidateLength;
    }

    return bestRoute ?? [];
  }

  isRoadRouteClear(points, sourceBuilding, destinationBuilding, treeManager) {
    for (let segment = 1; segment < points.length; segment += 1) {
      const start = points[segment - 1];
      const end = points[segment];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy);
      const steps = Math.max(1, Math.ceil(length / 8));

      for (let step = 1; step < steps; step += 1) {
        const amount = step / steps;
        const x = start.x + dx * amount;
        const y = start.y + dy * amount;
        const nearSource = sourceBuilding &&
          distanceSquared(x, y, sourceBuilding.x, sourceBuilding.y) < (sourceBuilding.radius + 5) ** 2;
        const nearDestination = destinationBuilding &&
          distanceSquared(x, y, destinationBuilding.x, destinationBuilding.y) < (destinationBuilding.radius + 5) ** 2;

        if (x < 8 || y < 8 || x > treeManager.worldWidth - 8 || y > treeManager.worldHeight - 8) {
          return false;
        }
        if (nearSource || nearDestination) continue;

        const blockedByBuilding = this.buildings.some(
          (building) => building.type !== "road" &&
            building !== sourceBuilding &&
            building !== destinationBuilding &&
            distanceSquared(x, y, building.x, building.y) < (building.radius + 6) ** 2
        );
        if (blockedByBuilding) return false;

        const blockedByTree = treeManager.trees.some(
          (tree) => distanceSquared(x, y, tree.x, tree.y) < (tree.radius + 5) ** 2
        );
        if (blockedByTree) return false;
      }
    }

    return true;
  }

  getPathPointAtDistance(points, distance) {
    let remaining = distance;
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      if (remaining <= length || index === points.length - 1) {
        const amount = length > 0 ? Math.min(1, remaining / length) : 0;
        return {
          x: start.x + (end.x - start.x) * amount,
          y: start.y + (end.y - start.y) * amount
        };
      }
      remaining -= length;
    }
    return points[points.length - 1];
  }

  createConstructionTask(village, type, x, y, humans, woodcutterSystem, options = {}) {
    const definition = BUILDING_TYPES[type];
    const id = `construction-${village.id}-${this.nextTaskId++}`;
    const task = {
      id, villageId: village.id, type: "construction", description: `Build ${definition.name}`,
      issuedBy: village.management.representativeId ?? village.kingId,
      buildingType: type, x, y, radius: definition.radius, requiredWorkers: type === "largeHouse" ? 2 : 1,
      workerIds: [], requiredWood: definition.wood, reservedWood: 0, deliveredWood: 0,
      workRequired: definition.work, workDone: 0, progress: 0, status: "available",
      phase: "gathering-materials", breakTimer: 0, createdAt: this.simulationTime,
      roadPoints: options.roadPoints ?? null,
      roadForBuildingId: options.roadForBuildingId ?? null,
      pathLength: options.pathLength ?? 0
    };
    const building = {
      id: type === "storageYard"
        ? `storage-yard-${village.id}`
        : `${type}-${village.id}-${this.nextBuildingId++}`,
      villageId: village.id, type,
      x, y, radius: definition.radius, state: "planned", progress: 0,
      workRequired: definition.work, workDone: 0, capacity: definition.capacity ?? 0,
      residents: [], taskId: id, storage: null,
      roadPoints: options.roadPoints ?? null,
      roadForBuildingId: options.roadForBuildingId ?? null,
      pathLength: options.pathLength ?? 0
    };
    task.buildingId = building.id;
    this.tasks.push(task);
    this.buildings.push(building);
    village.taskBoard.tasks.push(task);
    if (type !== "road") {
      woodcutterSystem.reserveArea(building.id, x, y, building.radius + 3, "construction");
      for (const tree of treecutterSafeRadius(this._treeManager, x, y, building.radius)) {
        tree.state.assignedTaskId = null;
        woodcutterSystem.scheduleRegrowth(tree);
        this._treeManager.removeTree(tree.id);
      }
    }
    this.saveTasks(village);
    return task;
  }

  updateNeeds(delta, village, humans) {
    this.needTimer += delta;
    if (this.needTimer < NEED_INTERVAL) return;
    this.needTimer %=NEED_INTERVAL;

    const housed = new Set(this.assignedHousing.keys());

    for (const id of village.inhabitants) {
      const human = getHuman(humans, id);
      if (!human) continue;

      human.needs ??= {
        housing: null,
        reportTimer: Math.random() * 8
      };

      if (!housed.has(id) && !human.needs.housing) {
        human.needs.housing = {
          type: "housing",
          createdAt: this.simulationTime,
          reported: false,
          nextReportAt: this.simulationTime
        };
      }

      if (human.needs.housing?.reported) {
        const nextReportAt =
          human.needs.housing.nextReportAt ?? Infinity;

        if (this.simulationTime >= nextReportAt) {
          human.needs.housing.reported = false;
        }
      }

      if (village.storage?.wood < 12 && Math.random() < 0.25) {
        human.needs.wood ??= {
          type: "wood",
          createdAt: this.simulationTime,
          reported: false
        };
      }

      const need = human.needs.housing ?? human.needs.wood;

      if (
        need &&
        !need.reported &&
        !human.isKing &&
        !human.workTaskId &&
        human.actionPriority === "normal" &&
        Math.random() < 0.65
      ) {
        this.startReporting(human, need);
      }
    }
  }

  startReporting(human, need) {
    const hall = this.buildings.find((building) => building.type === "townHall" && building.state === "completed");
    if (!hall) return;
    let request = this.requests.find((entry) => entry.type === need.type && entry.status !== "completed");
    if (!request) {
      request = {
        id: `request-${human.villageId}-${this.requests.length + 1}`,
        type: need.type,
        description: need.type === "housing" ? "Residents need more housing" : "The village needs more wood",
        affectedResidentIds: [],
        status: "waiting",
        createdAt: this.simulationTime
      };
      this.requests.push(request);
    }
    if (!request.affectedResidentIds.includes(human.id)) request.affectedResidentIds.push(human.id);
    if (this._currentVillage) this.saveTasks(this._currentVillage);
    need.reported = true;
    if (need.type === "housing") {
      need.nextReportAt = this.simulationTime + NEED_INTERVAL * 2;
    }
    human.needs.activeReportType = need.type;
    human.actionPriority = "reporting";
    human.movement.setTemporaryTarget(hall.x, hall.y);
  }

  updateRequests(village, humans) {
    const hall = this.buildings.find((building) => building.type === "townHall" && building.state === "completed");
    if (!hall) return;
    this._currentVillage = village;
    village.management.requests = this.requests;
    const king = getHuman(humans, village.kingId);
    const representative = getHuman(humans, village.management.representativeId);
    const canReceive = Boolean(representative) || Boolean(king && distanceSquared(king.movement.x, king.movement.y, hall.x, hall.y) <= hall.radius ** 2);
    if (king && distanceSquared(king.movement.x, king.movement.y, hall.x, hall.y) > 16 ** 2) {
      king.actionPriority = "royal-duty";
      setTarget(king, hall.x, hall.y);
    } else if (king && king.actionPriority === "royal-duty") {
      king.actionPriority = "normal";
    }
    for (const request of this.requests) {
      if (request.status !== "waiting") continue;
      for (const id of request.affectedResidentIds) {
        const resident = getHuman(humans, id);
        if (!resident) continue;
        if (resident.workTaskId || !["normal", "reporting"].includes(resident.actionPriority)) continue;
        resident.needs ??= {};
        resident.needs[request.type] ??= { type: request.type, createdAt: request.createdAt, reported: true };
        resident.needs[request.type].reported = true;
        resident.needs.activeReportType = request.type;
        resident.actionPriority = "reporting";
        setTarget(resident, hall.x, hall.y);
      }
    }
    for (const human of humans) {
      const type = human.needs?.activeReportType;
      if (!type || distanceSquared(human.movement.x, human.movement.y, hall.x, hall.y) > (hall.radius + 3) ** 2) continue;
      if (canReceive) {
        let request = this.requests.find((entry) => entry.type === type && entry.status !== "completed");
        if (!request) {
          request = { id: `request-${village.id}-${this.requests.length + 1}`, type, description: type === "housing" ? "Residents need more housing" : "The village needs more wood", affectedResidentIds: [], status: "waiting", createdAt: this.simulationTime };
          this.requests.push(request);
          village.management.requests.push(request);
        }
        if (!request.affectedResidentIds.includes(human.id)) request.affectedResidentIds.push(human.id);
        request.status = "received";
        human.needs.activeReportType = null;
        human.actionPriority = "normal";
        human.movement.clearTemporaryTarget();
      }
    }
    for (const request of this.requests) {
      if (request.type === "housing") {
        const allHoused =
          request.affectedResidentIds.length > 0 &&
          request.affectedResidentIds.every((id) =>
            this.assignedHousing.has(id)
          );

        if (allHoused) {
          request.status = "completed";
          request.taskCreated = false;
          continue;
        }

        if (
          request.status === "received" &&
          !request.taskCreated &&
          this.simulationTime >= (request.retryAt ?? 0)
        ) {
          request.taskCreated = this.postHousingTask(
            village,
            humans,
            request
          );

          request.retryAt = request.taskCreated
            ? 0
            : this.simulationTime + NEED_INTERVAL;
        }

        const unfinishedHouseTask = this.tasks.some(
          (task) =>
            task.type === "construction" &&
            task.buildingType?.endsWith("House") &&
            task.status !== "cancelled" &&
            task.status !== "completed"
        );

        if (request.taskCreated && !unfinishedHouseTask) {
          request.taskCreated = false;
          request.retryAt = this.simulationTime + NEED_INTERVAL;
        }
      }
      if (request.type === "wood") {
        if (village.storage?.wood >= 12) {
          request.status = "completed";
          for (const id of request.affectedResidentIds) {
            const human = getHuman(humans, id);
            if (human?.needs) human.needs.wood = null;
          }
        }
        else if (!request.taskCreated) request.taskCreated = true;
      }
    }
  }

  postHousingTask(village, humans, request) {
    const cancelledHouseIds = new Set(
      this.tasks
        .filter(
          (task) =>
            task.buildingType?.endsWith("House") &&
            task.status === "cancelled"
        )
        .map((task) => task.buildingId)
    );

    const existingHousingCapacity = this.buildings
      .filter(
        (building) =>
          building.type.endsWith("House") &&
        !cancelledHouseIds.has(building.id)
      )
      .reduce(
        (total, building) =>
          total + (BUILDING_TYPES[building.type]?.capacity ?? 0),
        0
      );

    let missingBeds = Math.max(
      0,
      village.inhabitants.length - existingHousingCapacity
    );

    if (missingBeds === 0) return false;

    const houseTypes = [];

    while (missingBeds > 0) {
      let type;

      if (missingBeds >= 6) {
        type = "largeHouse";
      } else if (missingBeds >= 4) {
        type = "normalHouse";
      } else {
        type = "smallHouse";
      }

      houseTypes.push(type);
      missingBeds -= BUILDING_TYPES[type].capacity;
    }

    const sites = this.findBuildingSitesForTypes(
      village,
      houseTypes,
      this._treeManager
    );

    if (sites.length === 0) return false;

    for (const site of sites) {
      this.createConstructionTask(
        village,
        site.type,
        site.x,
        site.y,
        humans,
        this._woodcutterSystem
      );
    }
    
    return true;
  }

  ensureWoodTask(village, request) {
    if (village.storage && village.storage.wood >= 12) request.status = "completed";
  }

  updateTasks(delta, village, humans, treeManager, woodcutterSystem) {
    this._treeManager = treeManager;
    this._woodcutterSystem = woodcutterSystem;
    const builders = village.inhabitants
      .map((id) => getHuman(humans, id))
      .filter((human) => human?.profession === "builder" && !human.isOffDuty);

    // Clear builder assignments left behind by tasks that no longer exist.
    // A stale workTaskId makes an otherwise free builder unavailable forever.
    const taskById = new Map(this.tasks.map((task) => [task.id, task]));
    for (const builder of builders) {
      if (!builder.workTaskId) continue;
      const assignedTask = taskById.get(builder.workTaskId);
      if (!assignedTask || assignedTask.status === "completed" || assignedTask.status === "cancelled") {
        builder.workTaskId = null;
        builder.workStatus = "idle";
        if (builder.workState) {
          builder.workState.acceptedTaskId = null;
          builder.workState.materialStage = "none";
          builder.workState.materialAmount = 0;
          builder.workState.carriedMaterials = 0;
        }
      }
    }

    const orderedTasks = [...this.tasks].sort(
      (first, second) =>
        getConstructionTaskPriority(first) -
        getConstructionTaskPriority(second)
    );

    for (const task of orderedTasks) {
      if (task.status === "completed" || task.status === "cancelled") continue;
      const building = this.buildings.find((entry) => entry.id === task.buildingId);
      if (!building) continue;
      this.assignWorkers(task, builders);
      const workers = task.workerIds.map((id) => getHuman(humans, id)).filter(Boolean);
      if (workers.length < task.requiredWorkers) { task.status = "available"; continue; }
      task.status = "active";
      if (!this.acceptAtBoard(task, workers)) continue;
      if (task.phase === "break") {
        task.breakTimer -= delta;
        for (const worker of workers) {
          worker.workStatus = "break";
          worker.actionPriority = "normal";
        }
        if (task.breakTimer <= 0) task.phase = task.deliveredWood < task.requiredWood ? "gathering-materials" : "building";
        continue;
      }
      if (workers.some((worker) => worker.social.conversationId !== null)) {
        // Keeping work priority ends the conversation on the next social update
        // and prevents assigned builders from starting another one mid-task.
        for (const worker of workers) worker.actionPriority = "work";
        continue;
      }
      for (const worker of workers) worker.actionPriority = "work";
      if (task.phase === "gathering-materials") {
        this.gatherMaterials(task, workers, village);
        if (task.deliveredWood >= task.requiredWood) task.phase = "building";
        continue;
      }
      if (task.phase === "building") this.performConstruction(task, building, workers, delta);
    }
  }

  assignWorkers(task, builders) {
    task.workerIds = task.workerIds.filter((id) => builders.some((human) => human.id === id));
    const candidates = builders.filter((human) => !human.workTaskId || human.workTaskId === task.id).sort((a, b) => builderScore(b) - builderScore(a));
    for (const worker of candidates) {
      if (task.workerIds.length >= task.requiredWorkers) break;
      if (!task.workerIds.includes(worker.id)) task.workerIds.push(worker.id);
      worker.workTaskId = task.id;
      worker.actionPriority = "work";
      worker.workStatus = "working";
      worker.workState ??= {};
      worker.workState.phase = task.phase;
      worker.workState.hammerSwing ??= 0;
      worker.workState.carriedMaterials ??= 0;
      worker.workState.acceptedTaskId ??= null;
    }
  }

  acceptAtBoard(task, workers) {
    const board = this.buildings.find((building) =>
      building.type === "taskBoard" && building.state === "completed"
    );
    if (!board) return true;
    for (const worker of workers) {
      if (worker.workState.acceptedTaskId === task.id) continue;
      worker.workStatus = "checking-task-board";
      worker.workState.phase = "accepting-task";
      worker.actionPriority = "work";
      setTarget(worker, board.x, board.y);
      if (worker.movement.destinationReached) {
        worker.workState.acceptedTaskId = task.id;
        worker.workState.phase = task.phase;
        worker.workStatus = "working";
      }
    }
    return workers.every((worker) => worker.workState.acceptedTaskId === task.id);
  }

  gatherMaterials(task, workers, village) {
    const storage = village.storage;
    if (!storage) return;
    let carried = workers.reduce((sum, worker) => sum + (worker.workState.carriedMaterials ?? 0), 0);
    const amountNeeded = task.requiredWood - task.deliveredWood - task.reservedWood - carried;
    if (amountNeeded > 0 && task.reservedWood === 0 && carried === 0) {
      const unreserved = Math.max(0, storage.wood - (storage.reservedWood ?? 0));
      const reserve = Math.min(amountNeeded, unreserved);
      if (reserve > 0) {
        storage.reservedWood = (storage.reservedWood ?? 0) + reserve;
        task.reservedWood = reserve;
        let assigned = 0;
        workers.forEach((worker, index) => {
          const share = index === workers.length - 1
            ? reserve - assigned
            : Math.floor(reserve / workers.length);
          assigned += share;
          worker.workState.materialAmount = share;
          worker.workState.materialStage = share > 0 ? "toStorage" : "none";
          worker.workState.carriedMaterials = 0;
        });
      }
    }
    for (const worker of workers) {
      const amount = worker.workState.materialAmount ?? 0;
      const stage = worker.workState.materialStage;
      if (amount <= 0 || stage === "none") continue;
      if (stage === "toStorage") {
        setTarget(worker, storage.x, storage.y);
        if (!worker.movement.destinationReached) continue;
        const pickedUp = Math.min(amount, task.reservedWood, storage.wood);
        storage.wood -= pickedUp;
        storage.reservedWood = Math.max(0, (storage.reservedWood ?? 0) - pickedUp);
        task.reservedWood = Math.max(0, task.reservedWood - pickedUp);
        worker.workState.carriedMaterials = pickedUp;
        task.inTransitWood = (task.inTransitWood ?? 0) + pickedUp;
        worker.workState.materialAmount = pickedUp;
        worker.workState.materialStage = pickedUp > 0 ? "toSite" : "none";
        setTarget(worker, task.x, task.y);
      } else if (stage === "toSite") {
        setTarget(worker, task.x, task.y);
        if (!worker.movement.destinationReached) continue;
        task.deliveredWood += worker.workState.carriedMaterials;
        task.inTransitWood = Math.max(0, (task.inTransitWood ?? 0) - worker.workState.carriedMaterials);
        worker.workState.carriedMaterials = 0;
        worker.workState.materialAmount = 0;
        worker.workState.materialStage = "none";
        worker.movement.clearTemporaryTarget();
      }
    }
  }

  performConstruction(task, building, workers, delta) {
    let activeWorkers = 0;
    for (const worker of workers) {
      setTarget(worker, task.x, task.y);
      if (!worker.movement.destinationReached) continue;
      if (Math.random() < delta * 0.012) {
        task.phase = "break";
        task.breakTimer = 2 + Math.random() * 3;
        worker.workStatus = "break";
        continue;
      }
      worker.workStatus = "building";
      worker.workState.phase = "building";
      worker.workState.hammerSwing = Math.sin(this.simulationTime * 7 + worker.identity.strength) * 0.8;
      activeWorkers += 1;
    }
    if (activeWorkers === 0) return;
    task.workDone = Math.min(task.workRequired, task.workDone + delta * activeWorkers);
    task.progress = task.workDone / task.workRequired;
    building.workDone = task.workDone;
    building.progress = task.progress;
    building.state = "under-construction";
    if (task.workDone >= task.workRequired) this.completeBuilding(task, building, workers);
  }

  completeBuilding(task, building, workers) {
    task.status = "completed";
    task.phase = "completed";
    task.progress = 1;
    building.state = "completed";
    building.progress = 1;
    building.workDone = building.workRequired;
    if (building.type === "storageYard" && this._currentVillage?.storage) {
      this._currentVillage.storage.buildingCompleted = true;
      this._currentVillage.storage.capacity = 500;
    }
    for (const worker of workers) {
      worker.workTaskId = null;
      worker.workStatus = "idle";
      worker.actionPriority = "normal";
      worker.movement.clearTemporaryTarget();
    }
    if (building.capacity) {
      for (const request of this.requests) {
        if (request.type === "housing" && request.status !== "completed") request.taskCreated = false;
      }
    }
  }

  availableHousing(village, humans) {
    const capacity = this.buildings.filter((building) => building.type.endsWith("House") && building.state === "completed").reduce((sum, building) => sum + building.capacity, 0);
    const housed = [...this.assignedHousing.keys()].filter((id) => village.inhabitants.includes(id)).length;
    return Math.max(0, capacity - housed);
  }

  growVillageTree(delta, village, treeManager) {
    this.treeGrowthTimer -= delta;
    if (this.treeGrowthTimer > 0) return;
    this.treeGrowthTimer = TREE_GROWTH_INTERVAL + Math.random() * 35;
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.sqrt(Math.random()) * Math.max(1, village.radius - 12);
    const x = village.centerX + Math.cos(angle) * distance;
    const y = village.centerY + Math.sin(angle) * distance;
    const type = ["eiche", "birke", "buche"][Math.floor(Math.random() * 3)];
    try { treeManager.createTree(x, y, type); } catch (error) { /* A missing tree type simply skips this growth attempt. */ }
  }

  assignHousing(village, humans) {
    for (const id of this.assignedHousing.keys()) {
      if (!village.inhabitants.includes(id) || !getHuman(humans, id)) this.assignedHousing.delete(id);
    }
    for (const building of this.buildings) {
      if (!building.type.endsWith("House") || building.state !== "completed") continue;
      building.residents = building.residents.filter((id) => village.inhabitants.includes(id) && getHuman(humans, id));
      for (const id of building.residents) this.assignedHousing.set(id, building.id);
      for (const id of village.inhabitants) {
        if (building.residents.length >= building.capacity) break;
        if (this.assignedHousing.has(id)) continue;
        building.residents.push(id);
        this.assignedHousing.set(id, building.id);
        const human = getHuman(humans, id);
        if (human?.needs) human.needs.housing = null;
      }
    }
  }

  updateCivilianRoutines(village, humans, treeManager) {
    const now = this.simulationTime;
    const campfires = this.buildings.filter(
      (building) =>
        building.type === "campfire" &&
        building.state === "completed"
    );

    for (const humanId of village.inhabitants) {
      const human = getHuman(humans, humanId);

      if (!human || human.social?.conversationId) {
        continue;
      }

      const hasRoutinePriority =
        human.actionPriority === "normal" ||
        (
          this.isNight &&
          ["work", "woodcutting"].includes(human.actionPriority)
        );
      if (!hasRoutinePriority) continue;

      const movement = human.movement;
      if (!movement) {
        continue;
      }

      let nearbyCampfire = null;
      let nearestCampfireDistance = Infinity;
      for (const fire of campfires) {
        const distance = distanceSquared(
          movement.x,
          movement.y,
          fire.x,
          fire.y
        );
        if (distance < nearestCampfireDistance) {
          nearestCampfireDistance = distance;
          nearbyCampfire = fire;
        }
      }

      const homeId = this.assignedHousing.get(human.id);
      const home = this.buildings.find(
        (building) => 
          building.id === homeId &&
          building.state === "completed" &&
          building.type.endsWith("House")
      );

      if (!human.villageRoutine) {
        human.villageRoutine = {
          phase: "waiting",
          nextActionAt: now + Math.random() * 5,
          destinationType: null,
          until: 0
        };
      }

      const routine = human.villageRoutine;

      if (this.isNight && home) {
        human.isOffDuty = true;
        human.actionPriority = "normal";

        if (
          routine.phase !== "goingToSleep" &&
          routine.phase !== "sleeping"
        ) {
          human.isIndoors = false;
          movement.setPaused(false);
          movement.setTemporaryTarget(home.x, home.y);
          routine.phase = "goingToSleep";
          routine.destinationType = "sleep";
        }

        if (
          routine.phase === "goingToSleep" &&
          movement.destinationReached
        ) {
          movement.clearTemporaryTarget();
          movement.setPaused(true);
          human.isIndoors = true;
          routine.phase = "sleeping";
        }

        continue;
      }

      if (!this.isNight && routine.phase === "sleeping") {
        human.isIndoors = false;
        human.isOffDuty = Boolean(home);
        if (!home) {
          movement.setPaused(false);
          routine.phase = "waiting";
          routine.nextActionAt = now + Math.random() * 4;
          continue;
        }
        const worldHeight = Number.isFinite(treeManager.worldHeight)
          ? treeManager.worldHeight
          : Infinity;
        const exitY = Math.max(
          8,
          Math.min(worldHeight - 8, home.y + home.radius + 7)
        );
        movement.setPaused(false);
        movement.setTemporaryTarget(home.x, exitY);
        routine.phase = "waking";
        continue;
      }

      if (!this.isNight && routine.phase === "goingToSleep") {
        movement.clearTemporaryTarget();
        movement.setPaused(false);
        human.isOffDuty = false;
        routine.phase = "waiting";
        routine.nextActionAt = now + Math.random() * 4;
        continue;
      }

      if (routine.phase === "waking") {
        if (!movement.destinationReached) continue;

        movement.clearTemporaryTarget();
        movement.setPaused(false);
        human.isOffDuty = false;
        routine.phase = "waiting";
        routine.nextActionAt = now + Math.random() * 4;
        continue;
      }

      if (human.isKing || human.profession !== "none") continue;

      if (routine.phase === "indoors") {
        if (now < routine.until) {
          continue;
        }

        human.isIndoors = false;

        if (!home) {
          movement.setPaused(false);
          routine.phase = "waiting";
          routine.nextActionAt = now + 2;
          continue;
        }

        const worldHeight = Number.isFinite(treeManager.worldHeight)
          ? treeManager.worldHeight
          : Infinity;
        const exitY = Math.max(
          8,
          Math.min(worldHeight - 8, home.y + home.radius + 7)
        );

        movement.setPaused(false);
        movement.setTemporaryTarget(home.x, exitY);
        routine.phase = "leavingHome";
        continue;
      }

      // Gespräche imd andere angehalten Aktion nicht unterbrechen.
      if (movement.isPaused && routine.phase !== "resting") {
        continue;
      }

      if (
        routine.phase === "travelling" ||
        routine.phase === "leavingHome"
      ) {
        if (!movement.destinationReached) {
          continue;
        }

        const arrivedAtHome =
          routine.phase === "travelling" &&
          routine.destinationType === "home";

        movement.clearTemporaryTarget();
        movement.setPaused(true);

        if (arrivedAtHome) {
          human.isIndoors = true;
          routine.phase = "indoors";
          routine.until = now + 14 + Math.random() * 18;
        } else {
          routine.phase = "resting";
          routine.until = now + 2 + Math.random() * 4;
        }

        continue;
      }

      if (routine.phase === "resting") {
        if (now < routine.until) {
          continue;
        }

        movement.setPaused(false);
        routine.phase = "waiting";
        routine.nextActionAt = now;
      }

      if (
        routine.phase !== "waiting" ||
        now < routine.nextActionAt
      ) {
        continue;
      }

      let targetX;
      let targetY;
      let destinationType = "village";

      if (home && Math.random() < 0.4) {
        targetX = home.x;
        targetY = home.y;
        destinationType = "home";
      } else if (nearbyCampfire && Math.random() < 0.16) {
        const angle = Math.random() * Math.PI * 2;
        const distance = 18 + Math.random() * 18;
        targetX = nearbyCampfire.x + Math.cos(angle) * distance;
        targetY = nearbyCampfire.y + Math.sin(angle) * distance;
      } else {
        const angle = Math.random() * Math.PI * 2;
        const villageRadius = Math.max(
          12,
          Math.min(village.radius * 0.65, 70)
        );
        const distance = Math.sqrt(Math.random()) * villageRadius;

        targetX = village.centerX + Math.cos(angle) * distance;
        targetY = village.centerY + Math.sin(angle) * distance;
      }

      const worldWidth = Number.isFinite(treeManager.worldWidth)
        ? treeManager.worldWidth
        : Infinity;
      const worldHeight = Number.isFinite(treeManager.worldHeight)
        ? treeManager.worldHeight
        : Infinity;

      targetX = Math.max(8, Math.min(worldWidth - 8, targetX));
      targetY = Math.max(8, Math.min(worldHeight - 8, targetY));

      movement.setTemporaryTarget(targetX, targetY);
      routine.phase = "travelling";
      routine.destinationType = destinationType;
    }
  }

  maybeAppointRepresentative(village, humans) {
    if (village.management.representativeId || village.inhabitants.length < REPRESENTATIVE_POPULATION) return;
    if (!this.buildings.some((building) => building.type === "townHall" && building.state === "completed")) return;
    const candidate = village.inhabitants.map((id) => getHuman(humans, id)).filter((human) => human && !human.isKing && !["woodcutter", "builder", "farmer"].includes(human.profession)).sort((a, b) => b.identity.leadership - a.identity.leadership)[0];
    if (!candidate) return;
    candidate.profession = "representative";
    village.management.representativeId = candidate.id;
  }

  

  draw(context, villageSystem, zoom) {
    if (!this.currentVillageId) return;
    const scale = Math.max(0.01, zoom);
    for (const road of this.buildings) {
      if (road.type === "road" && road.state !== "planned") {
        this.drawRoad(context, road);
      }
    }

    for (const building of this.buildings) {
      if (building.type === "road") continue;
      if (building.state === "planned") continue;
      if (!Number.isFinite(building.x) || !Number.isFinite(building.y)) continue;
      const definition = BUILDING_TYPES[building.type];
      if (!definition) continue;
      context.save();
      context.translate(building.x, building.y);
      context.fillStyle = "rgba(35, 30, 24, 0.22)";
      const shadowRadius = building.type === "campfire"
        ? building.radius * 0.82
        : building.radius + 2;
      context.beginPath(); context.ellipse(0, 5, shadowRadius, shadowRadius * 0.58, 0, 0, Math.PI * 2); context.fill();
      if (building.type === "storageYard" && building.state === "completed") {
        context.restore();
        continue;
      }

      if (building.state !== "completed") {
        this.drawConstructionSite(context, building, definition);
      } else if (building.type === "campfire") {
        this.drawCampfire(context, building);
      } else if (building.type === "taskBoard") {
        this.drawTaskBoard(context, scale);
      } else if (building.type === "farm") {
        this.drawFarmBuilding(context, building);
      } else {
        this.drawFinishedBuilding(context, building, definition);
      }
      if (building.state !== "completed") this.drawProgress(context, building, scale);
      context.restore();
    }
  }

  drawRoad(context, road) {
    const points = road.roadPoints;
    if (!Array.isArray(points) || points.length < 2) return;

    const totalLength = road.pathLength || getPathLength(points);
    let remaining = totalLength * Math.max(0, Math.min(1, road.progress ?? 1));
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);

    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
      if (remaining >= segmentLength) {
        context.lineTo(end.x, end.y);
        remaining -= segmentLength;
        continue;
      }
      if (segmentLength > 0 && remaining > 0) {
        const amount = remaining / segmentLength;
        context.lineTo(
          start.x + (end.x - start.x) * amount,
          start.y + (end.y - start.y) * amount
        );
      }
      break;
    }

    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#554432";
    context.lineWidth = 9;
    context.stroke();
    context.strokeStyle = "#8b704c";
    context.lineWidth = 7;
    context.stroke();
    context.strokeStyle = "rgba(198, 169, 122, 0.32)";
    context.lineWidth = 1;
    context.setLineDash([1, 6]);
    context.stroke();
    context.restore();
  }

  drawCampfire(context, building) {
    context.save();
    context.scale(0.68, 0.68);
    const stones = [
      [-7, -4, "#777264"], [-5, -7, "#a39b83"], [-1, -8, "#6b695f"],
      [4, -7, "#928a76"], [7, -3, "#5d5b54"], [7, 2, "#8f8877"],
      [3, 6, "#68665b"], [-2, 7, "#a59b80"], [-7, 4, "#69675b"]
    ];
    for (const [x, y, color] of stones) {
      context.fillStyle = color;
      context.fillRect(x, y, 4, 3);
      context.fillStyle = "rgba(232, 220, 187, 0.35)";
      context.fillRect(x + 1, y, 2, 1);
    }

    context.save();
    context.rotate(-0.58);
    context.fillStyle = "#503426";
    context.fillRect(-7, -2, 14, 3);
    context.fillStyle = "#9a6840";
    context.fillRect(-6, -2, 11, 1);
    context.restore();
    context.save();
    context.rotate(0.58);
    context.fillStyle = "#63412d";
    context.fillRect(-7, -1, 14, 3);
    context.fillStyle = "#b07b49";
    context.fillRect(-5, -1, 10, 1);
    context.restore();

    this.drawFireFlame(context);
    context.restore();
  }

  drawFireFlame(context) {
    const time = this.fireTime;
    const pulse = (Math.sin(time * 6.2) + 1) * 0.5;
    const sway = Math.sin(time * 8.5) * 1.2;
    const leftSway = Math.sin(time * 10.7 + 1.4) * 1.1;
    const rightSway = Math.sin(time * 9.3 + 2.1) * 0.9;
    const extraHeight = Math.round(pulse * 3);

    // Broad, dark red outer flame.
    context.fillStyle = "#9b321d";
    context.fillRect(-5 + sway * 0.3, -2, 10, 4);
    context.fillRect(-4 + sway, -6, 8, 5);
    context.fillRect(-3 + sway, -10 - extraHeight, 6, 5);
    context.fillRect(-2 + sway * 1.2, -14 - extraHeight, 4, 5);
    context.fillRect(-1 + sway * 1.4, -17 - extraHeight, 2, 4);

    // Two smaller tongues move at different speeds.
    context.fillStyle = "#e45422";
    context.fillRect(-5 + leftSway, -4, 3, 5);
    context.fillRect(-4 + leftSway, -8, 2, 5);
    context.fillRect(2 + rightSway, -5, 3, 5);
    context.fillRect(3 + rightSway, -10 - extraHeight, 2, 6);

    // Bright yellow center and small hot pixels at the base.
    context.fillStyle = "#f49a32";
    context.fillRect(-3 + sway * 0.55, -2, 6, 4);
    context.fillRect(-2 + sway * 0.7, -6, 4, 5);
    context.fillRect(-1 + sway, -10 - extraHeight, 3, 5);
    context.fillStyle = "#ffe29a";
    context.fillRect(-1 + sway * 0.4, -2, 3, 3);
    context.fillRect(-1 + sway * 0.6, -6, 2, 3);

    for (let index = 0; index < 5; index += 1) {
      const phase = time * (1.5 + index * 0.17) + index * 2.2;
      const sparkY = -13 - ((phase * 3.2) % 18);
      const sparkX = Math.round(Math.sin(phase * 1.4) * (2 + index * 0.7));

      if (Math.sin(phase * 2.7) > -0.12) {
        context.fillStyle = index % 2 === 0 ? "#ffe18a" : "#ff9b3f";
        context.fillRect(sparkX, sparkY, 1, 1);
      }
    }
  }

  drawNightLights(context, visible) {
    const darkness = 1 - this.daylight;
    if (darkness <= 0.02 || !this.currentVillageId || !visible) return;

    for (const building of this.buildings) {
      if (
        building.state !== "completed" ||
        !Number.isFinite(building.x) ||
        !Number.isFinite(building.y)
      ) {
        continue;
      }

      const lightExtent = building.type === "campfire"
        ? (building.lightRadius ?? 42) * 1.75
        : 13;
      if (
        building.x + lightExtent < visible.left ||
        building.x - lightExtent > visible.right ||
        building.y + lightExtent < visible.top ||
        building.y - lightExtent > visible.bottom
      ) {
        continue;
      }

      if (building.type === "campfire") {
      const radius = lightExtent;
        const flicker = 0.88 + Math.sin(this.fireTime * 8) * 0.08;
        const glow = context.createRadialGradient(
          building.x,
          building.y - 2,
          1,
          building.x,
          building.y - 2,
          radius
        );
        glow.addColorStop(
          0,
          `rgba(255, 158, 58, ${0.42 * darkness * flicker})`
        );
        glow.addColorStop(0.35, `rgba(255, 127, 36, ${0.2 * darkness})`);
        glow.addColorStop(1, "rgba(255, 110, 25, 0)");
        context.fillStyle = glow;
        context.fillRect(
          building.x - radius,
          building.y - radius,
          radius * 2,
          radius * 2
        );

        context.save();
        context.translate(building.x, building.y);
        context.scale(0.68, 0.68);
        this.drawFireFlame(context);
        context.restore();
        continue;
      }

      if (!building.type.endsWith("House")) continue;

      const { width, height } = getHouseVisualSize(building.radius);
      const left = -Math.floor(width / 2);
      const top = -Math.floor(height / 2);
      const windowY = top + height - 7;
      const windowPositions = [
        left + Math.max(5, Math.floor(width * 0.2)),
        left + width - Math.max(9, Math.floor(width * 0.2)) - 3
      ];

      context.save();
      context.translate(building.x, building.y);

      for (const windowX of windowPositions) {
        const centerX = windowX + 1.5;
        const centerY = windowY + 1.5;
        const glow = context.createRadialGradient(
          centerX,
          centerY,
          1,
          centerX,
          centerY,
          13
        );
        glow.addColorStop(0, `rgba(255, 197, 95, ${0.58 * darkness})`);
        glow.addColorStop(1, "rgba(255, 166, 60, 0)");
        context.fillStyle = glow;
        context.fillRect(windowX - 12, windowY - 12, 27, 27);

        context.fillStyle = `rgba(255, 185, 75, ${0.9 * darkness})`;
        context.fillRect(windowX - 1, windowY - 1, 5, 5);
        context.fillStyle = `rgba(255, 239, 177, ${0.95 * darkness})`;
        context.fillRect(windowX, windowY, 3, 3);
      }

      context.restore();
    }
  }

  drawTaskBoard(context, scale) {
    context.fillStyle = "#59402e";
    context.fillRect(-6, -7, 12, 15);
    context.fillStyle = "#b18450";
    context.fillRect(-7, -8, 14, 9);
    context.fillStyle = "#d1ad70";
    context.fillRect(-5, -6, 10, 1);
    context.fillRect(-4, -3, 8, 1);
    context.fillRect(-3, 0, 6, 1);
    context.fillStyle = "#443126";
    context.fillRect(-1, 2, 2, 6);

    context.save();
    context.scale(1 / scale, 1 / scale);
    context.font = "10px system-ui, sans-serif";
    context.textAlign = "center";
    context.fillStyle = "#fff4db";
    context.fillText(`${this.tasks.filter((task) => task.status === "available" || task.status === "active").length} tasks`, 0, -13);
    context.restore();
  }

  drawFarmBuilding(context, building) {
    context.fillStyle = "rgba(35, 30, 24, 0.24)";
    context.fillRect(-41, -2, 40, 25);

    // Barn foundation and broad timber walls.
    context.fillStyle = "#51402f";
    context.fillRect(-41, -17, 40, 39);
    context.fillStyle = "#8d6540";
    context.fillRect(-39, -15, 36, 35);
    context.fillStyle = "#ba8a57";
    context.fillRect(-37, -13, 32, 4);
    context.fillStyle = "#6f4a34";
    context.fillRect(-39, 15, 36, 5);

    // Roof with a clear ridge and small tile highlights.
    context.fillStyle = "#382d29";
    context.fillRect(-43, -19, 44, 26);
    context.fillStyle = "#49342e";
    context.fillRect(-41, -18, 40, 21);
    context.fillStyle = "#80503a";
    context.fillRect(-39, -16, 36, 8);
    context.fillStyle = "#a66b49";
    context.fillRect(-38, -15, 34, 3);
    context.fillStyle = "#bd8052";
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        context.fillRect(-37 + column * 7 + (row % 2) * 3, -11 + row * 3, 3, 1);
      }
    }
    context.fillStyle = "#3a2e29";
    context.fillRect(-40, -7, 38, 2);
    context.fillStyle = "#9c6847";
    context.fillRect(-39, -6, 36, 1);

    // Loft window and wall beams.
    context.fillStyle = "#493126";
    context.fillRect(-31, -4, 6, 6);
    context.fillStyle = "#d1b36e";
    context.fillRect(-30, -3, 4, 4);
    context.fillStyle = "#5b3b2b";
    context.fillRect(-37, 4, 1, 10);
    context.fillRect(-5, 4, 1, 10);
    context.fillRect(-37, 10, 32, 1);

    // Wide double doors with iron hinges.
    context.fillStyle = "#493126";
    context.fillRect(-28, 3, 14, 17);
    context.fillStyle = "#765039";
    context.fillRect(-27, 4, 6, 15);
    context.fillRect(-20, 4, 5, 15);
    context.fillStyle = "#a47743";
    context.fillRect(-26, 5, 1, 13);
    context.fillRect(-19, 5, 1, 13);
    context.fillStyle = "#493126";
    context.fillRect(-27, 9, 12, 1);
    context.fillRect(-27, 15, 12, 1);
    context.fillStyle = "#d8b86f";
    context.fillRect(-22, 11, 1, 2);
    context.fillRect(-16, 11, 1, 2);

    // Hay bales beside the barn entrance.
    context.fillStyle = "#87683d";
    context.fillRect(-10, 12, 5, 5);
    context.fillRect(-8, 8, 5, 5);
    context.fillStyle = "#c1a15a";
    context.fillRect(-9, 13, 3, 1);
    context.fillRect(-7, 9, 3, 1);

    // Enclosed field fence.
    context.fillStyle = "#493a2d";
    context.fillRect(0, -12, 2, 44);
    context.fillRect(35, -12, 2, 44);
    context.fillRect(0, -12, 37, 2);
    context.fillRect(0, 30, 37, 2);
    context.fillStyle = "#9b7951";
    context.fillRect(1, -6, 35, 2);
    context.fillRect(1, 19, 35, 2);
    context.fillStyle = "#c09a62";
    context.fillRect(1, -6, 35, 1);
    context.fillRect(1, 19, 35, 1);
  }

  drawFinishedBuilding(context, building, definition) {
    const { width, height } = getHouseVisualSize(building.radius);
    const left = -Math.floor(width / 2);
    const top = -Math.floor(height / 2);
    const isTownHall = building.type === "townHall";

    // Eine feste Auswahl pro Gebäude, damit die Farben nicht bei jedem Bild wechseln.
    const idText = String(building.id ?? building.type);
    let variant = 0;

    for (let index = 0; index < idText.length; index += 1) {
      variant = (variant + idText.charCodeAt(index)) % 3;
    }

    const roofPalettes = [
      { dark: "#49342e", main: "#80503a", light: "#a66b49", tile: "#bd8052" },
      { dark: "#3f3830", main: "#71634a", light: "#988261", tile: "#b39b70" },
      { dark: "#50332d", main: "#75423a", light: "#9b5948", tile: "#b96c52" }
    ];
    const roof = isTownHall
      ? { dark: "#39312f", main: "#55433b", light: "#75574a", tile: "#8d6b55" }
      : roofPalettes[variant];

    const wall = isTownHall ? "#aa916d" : "#b99468";
    const wallLight = isTownHall ? "#d2b98d" : "#d5b47c";
    const wallDark = isTownHall ? "#786347" : "#806043";

  // Boden unter dem Haus und ein kleiner gepflasterter Eingang.
    context.fillStyle = "rgba(38, 31, 24, 0.24)";
    context.fillRect(left - 3, top + height - 1, width + 6, 5);
  
  context.fillStyle = "#75654c";
  context.fillRect(-4, top + height - 1, 8, 5);
  context.fillStyle = "#a99a78";
  context.fillRect(-3, top + height, 6, 2);
  context.fillStyle = "#c2b18b";
  context.fillRect(-2, top + height, 2, 1);

  // Hauswände mit heller Südseite und dunkler kante für tiefe
  context.fillStyle = "#574333";
  context.fillRect(left + 2, top + 4, width - 4, height - 5);

  context.fillStyle = wall;
  context.fillRect(left + 4, top + 5, width - 8, height - 8);

  context.fillStyle = wallLight;
  context.fillRect(left + 5, top + 6, width - 10, 2);

  context.fillStyle = wallDark;
  context.fillRect(left + 4, top + height - 5, width - 8, 2);

  // Dachtraufe und dunkler Dachrand.
  context.fillStyle = "#382d29";
  context.fillRect(left, top + 1, width, height - 3);

  context.fillStyle = roof.dark;
  context.fillRect(left + 1, top + 1, width - 2, height - 5);

  context.fillStyle = roof.main;
  context.fillRect(left + 3, top + 2, width - 6, height - 8);

  // Helle Dachfläche und dezente Schatten an den Dachseiten.
  context.fillStyle = roof.light;
  context.fillRect(left + 4, top + 3, width - 8, Math.max(2, Math.floor(height * 0.28)));

    context.fillStyle = "rgba(35, 24, 20, 0.22)";
    context.fillRect(left + 3, top + Math.floor(height * 0.55), width - 6, Math.max(2, Math.floor(height * 0.23)));

  // Kleine versetzte Dachziegel.
  for (let row = 0; row < Math.floor((height - 7) / 3); row += 1) {
    const y = top + 4 + row * 3;
    const offset = row % 2 === 0 ? 2 : 5;

    for (let x = left + offset; x < left + width - 5; x += 7) {
      context.fillStyle = row % 2 === 0 ? roof.tile : roof.light;
      context.fillRect(x, y, 3, 1);
    }
  }

  // Dachfirst verläuft quer über das Dauch - passend zur Draufsicht.
  const ridgeY = top + Math.floor(height * 0.48);
  context.fillStyle = roof.dark;
  context.fillRect(left + 3, ridgeY, width - 6, 2);
  context.fillStyle = roof.tile;
  context.fillRect(left + 4, ridgeY, width - 8, 1);

  // Schornstein auf der hinteren Dachhäflte.
  const chimneyX = left + Math.max(5, Math.floor(width * 0.24));
  const chimneyY = top + 3;

  context.fillStyle = "#3c302a";
  context.fillRect(chimneyX - 1, chimneyY - 1, 7, 6);
  context.fillStyle = "#776453";
  context.fillRect(chimneyX, chimneyY, 5, 4);
  context.fillStyle = "#a18b6b";
  context.fillRect(chimneyX + 1, chimneyY, 3, 1);
  context.fillStyle = "#403631";
  context.fillRect(chimneyX + 1, chimneyY + 1, 3, 2);

  // Fenster sitzen an der sichtbaren Vorderseite des Hauses.
  const windowY = top + height - 7;
  const windowPositions = [
    left + Math.max(5, Math.floor(width * 0.2)),
    left + width - Math.max(9, Math.floor(width * 0.2)) - 3
  ];

  for (const windowX of windowPositions) {
    context.fillStyle = "#49362c";
    context.fillRect(windowX - 1, windowY - 1, 5, 5);
    context.fillStyle = this.isNight ? "#efbd58" : "#6f9a91";
    context.fillRect(windowX, windowY, 3, 3);
    context.fillStyle = this.isNight ? "#fff0a6" : "#d6c18e";
    context.fillRect(windowX + 1, windowY, 1, 3);
    context.fillRect(windowX, windowY + 1, 3, 1);
  }

  // Eingangstür und Türstufe.
  const doorWidth = isTownHall ? 9 : 8;
  const doorX = -Math.floor(doorWidth / 2);
  const doorY = top + height - 9;

  context.fillStyle = "#493126";
  context.fillRect(doorX - 1, doorY - 1, doorWidth + 2, 10);
  context.fillStyle = isTownHall ? "#815439" : "#93613d";
  context.fillRect(doorX, doorY, doorWidth, 8);
  context.fillStyle = "#d8b86f";
  context.fillRect(doorX + doorWidth - 1, doorY + 2, 1, 1);

  context.fillStyle = "#6c5942";
  context.fillRect(doorX - 2, top + height, doorWidth + 4, 2);
  context.fillStyle = "#b2a07b";
  context.fillRect(doorX - 1, top + height, doorWidth + 2, 1);

  // Das Rathaus bekommt ein eigenes Zeichen und größere Fenster.
    if (isTownHall) {
    context.fillStyle = "#5a352e";
    context.fillRect(left + 5, top + 7, 4, 5);
    context.fillStyle = "#e0c889";
    context.fillRect(left + 6, top + 8, 2, 3);

    context.fillStyle = "#6e302b";
    context.fillRect(left + width - 8, top - 4, 6, 9);
    context.fillStyle = "#d5b46e";
    context.fillRect(left + width - 9, top - 5, 8, 2);
    context.fillStyle = "#efe0b4";
    context.fillRect(left + width - 6, top - 3, 2, 3);
  }
  }

  drawConstructionSite(context, building, definition) {
    const progress = Math.max(0, Math.min(1, building.progress));
    const size = Math.max(10, Math.floor(building.radius * 1.2));
    const left = -Math.floor(size / 2);
    const top = -Math.floor(size * 0.4);
    context.fillStyle = "#6f553b";
    context.fillRect(left, top + size * 0.55, size, 3);
    context.fillStyle = "#9b7951";
    context.fillRect(left + 2, top + size * 0.55 + 1, size - 4, 1);

    for (let x = left; x <= left + size; x += 6) {
      context.fillStyle = (x / 6) % 2 === 0 ? "#a49a82" : "#777366";
      context.fillRect(x, top + size * 0.55 - 1, 3, 3);
    }

    const postCount = progress < 0.12 ? 0 : Math.min(4, Math.ceil(progress * 4));
    const postPoints = [
      [left + 2, top + 2], [left + size - 4, top + 2],
      [left + 2, top + size * 0.45], [left + size - 4, top + size * 0.45]
    ];
    context.fillStyle = "#62452e";
    for (let index = 0; index < postCount; index += 1) {
      const [x, y] = postPoints[index];
      context.fillRect(x, y, 3, Math.max(4, Math.floor(size * 0.36 * progress)));
      context.fillStyle = "#b18450";
      context.fillRect(x, y, 1, Math.max(2, Math.floor(size * 0.3 * progress)));
      context.fillStyle = "#62452e";
    }

    if (progress >= 0.28) {
      const wallHeight = Math.floor(size * Math.min(0.33, (progress - 0.2) * 0.6));
      context.fillStyle = definition.color;
      context.fillRect(left + 4, top + size * 0.2, size - 8, wallHeight);
      context.fillStyle = "#c09a65";
      for (let x = left + 5; x < left + size - 5; x += 5) {
        context.fillRect(x, top + size * 0.2, 1, Math.max(1, wallHeight - 1));
      }
    }

    if (progress >= 0.72) {
      const roofHeight = Math.floor(size * Math.min(0.26, (progress - 0.68) * 0.75));
      context.fillStyle = "#604337";
      context.fillRect(left + 1, top + size * 0.2 - roofHeight, size - 2, 3);
      context.fillStyle = "#9a6244";
      context.fillRect(left + 3, top + size * 0.2 - roofHeight - 2, size - 6, 2);
    }
  }

  drawProgress(context, building, zoom) {
    const width = 34;
    context.save();
    context.scale(1 / zoom, 1 / zoom);
    context.fillStyle = "rgba(25, 22, 18, 0.8)"; context.fillRect(-width / 2, -building.radius - 12, width, 4);
    context.fillStyle = "#e3bf55"; context.fillRect(-width / 2, -building.radius - 12, width * Math.max(0, Math.min(1, building.progress)), 4);
    context.restore();
  }

  saveTasks(village) {
    try {
      const scope = this.getStorageScope(village);
      const persisted = this.tasks.map((task) => ({
        ...task,
        workerIds: [],
        reservedWood: 0,
        progress: task.workRequired > 0 ? task.workDone / task.workRequired : 1
      }));
      localStorage.setItem(`${BOARD_STORAGE_KEY}:${scope}`, JSON.stringify(persisted));
      localStorage.setItem(`${REQUEST_STORAGE_KEY}:${scope}`, JSON.stringify(this.requests));
      if (village.storage) {
        localStorage.setItem(`${BOARD_STORAGE_KEY}:${scope}:storage`, JSON.stringify({
          wood: village.storage.wood,
          capacity: village.storage.capacity,
          food: village.storage.food ?? 0,
          foodCapacity: village.storage.foodCapacity ?? 80
        }));
      }
    } catch (error) { console.warn("Village task save skipped.", error); }
  }

  loadTasks(village) {
    try {
      const scope = this.getStorageScope(village);
      const raw = localStorage.getItem(`${BOARD_STORAGE_KEY}:${scope}`);
      const saved = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(saved)) return;
      this.tasks = saved.filter((task) =>
        task &&
        task.villageId === village.id &&
        task.type === "construction" &&
        BUILDING_TYPES[task.buildingType] &&
        typeof task.id === "string" &&
        typeof task.buildingId === "string" &&
        Number.isFinite(task.x) &&
        Number.isFinite(task.y) &&
        Number.isFinite(task.workRequired) &&
        Number.isFinite(task.workDone) &&
        Number.isFinite(task.deliveredWood) &&
        ["available", "active", "completed", "cancelled"].includes(task.status)
      );
      this.nextTaskId = this.tasks.length + 1;
    } catch (error) { this.tasks = []; }
  }

  loadRequests(village) {
    try {
      const scope = this.getStorageScope(village);
      const raw = localStorage.getItem(`${REQUEST_STORAGE_KEY}:${scope}`);
      const saved = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(saved)) return;
      this.requests = saved.filter((request) => request && request.id && ["housing", "wood"].includes(request.type));
      village.management.requests = this.requests;
    } catch (error) {
      this.requests = [];
    }
  }

  loadStorage(village) {
    if (!village.storage) return;
    try {
      const scope = this.getStorageScope(village);
      const raw = localStorage.getItem(`${BOARD_STORAGE_KEY}:${scope}:storage`);
      const saved = raw ? JSON.parse(raw) : null;
      if (!saved || !Number.isFinite(saved.wood)) return;
      village.storage.wood = Math.max(0, Math.min(village.storage.capacity, saved.wood));
      village.storage.foodCapacity = Number.isFinite(saved.foodCapacity)
        ? Math.max(1, saved.foodCapacity)
        : (village.storage.foodCapacity ?? 80);
      village.storage.food = Number.isFinite(saved.food)
        ? Math.max(0, Math.min(village.storage.foodCapacity, saved.food))
        : (village.storage.food ?? 0);
      village.storage.reservedWood = 0;
      village.storage.reservedFood = 0;
    } catch (error) {
      village.storage.reservedWood = 0;
    }
  }

  getStorageScope(village) {
    return `${village.id}:${village.management.saveId}`;
  }
}

function treecutterSafeRadius(treeManager, x, y, radius) {
  return treeManager.getTreesInRadius(x, y, radius + 2);
}
