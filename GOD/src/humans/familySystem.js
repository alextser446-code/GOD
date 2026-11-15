import { Human } from "./human.js";
import { GAME_DAY_SECONDS, MAX_POPULATION } from "./populationRules.js";

const CHILDHOOD_SECONDS = 7 * GAME_DAY_SECONDS;
const CHILD_BIRTH_INTERVAL = 14 * GAME_DAY_SECONDS;
const CHILD_MINIMUM_SCALE = 0.45;

function distanceSquared(a, b) {
  const dx = a.movement.x - b.movement.x;
  const dy = a.movement.y - b.movement.y;
  return dx * dx + dy * dy;
}

function familyOf(human) {
  human.family ??= {
    partnerId: null,
    parentIds: [],
    childrenIds: [],
    nextChildAt: null
  };
  human.family.parentIds ??= [];
  human.family.childrenIds ??= [];
  return human.family;
}

function isAdult(human) {
  return Boolean(human && !human.isChild && human.identity.age >= 18);
}

export class FamilySystem {
  constructor() {
    this.simulationTime = 0;
  }

  update(deltaSeconds, humanManager, village, developmentSystem) {
    const delta = Math.max(0, Math.min(Number(deltaSeconds) || 0, 0.1));
    this.simulationTime += delta;

    if (!village || village.foundingStatus !== "established") return;

    const residents = village.inhabitants
      .map((id) => humanManager.humans.find((human) => human.id === id))
      .filter(Boolean);

    this.updateChildren(residents, humanManager.humans, developmentSystem, delta);
    this.formCouples(residents);
    this.tryBirths(residents, humanManager, village, developmentSystem);
  }

  updateChildren(residents, allHumans, developmentSystem, delta) {
    const humanById = new Map(allHumans.map((human) => [human.id, human]));

    for (const child of residents) {
      if (!child.isChild) continue;

      child.childAgeSeconds = (child.childAgeSeconds ?? 0) + delta;
      child.growthRatio = Math.min(1, child.childAgeSeconds / CHILDHOOD_SECONDS);
      child.identity.age = 18 * child.growthRatio;
      this.assignChildToParentHome(child, humanById, developmentSystem);

      if (child.childAgeSeconds < CHILDHOOD_SECONDS) continue;

      child.isChild = false;
      child.identity.age = 18;
      child.growthRatio = 1;
      child.profession = "none";
      child.workStatus = "idle";
      child.actionPriority = "normal";
      child.workTaskId = null;
      familyOf(child).partnerId = null;
      familyOf(child).nextChildAt = null;
    }
  }

  formCouples(residents) {
    const byId = new Map(residents.map((human) => [human.id, human]));
    const men = residents.filter(
      (human) => isAdult(human) && human.identity.gender === "Male"
    );
    const women = residents.filter(
      (human) => isAdult(human) && human.identity.gender === "Female"
    );

    for (const man of men) {
      const manFamily = familyOf(man);
      if (isAdult(byId.get(manFamily.partnerId))) continue;

      manFamily.partnerId = null;
      manFamily.nextChildAt = null;
      let closestWoman = null;
      let closestDistance = Infinity;

      for (const woman of women) {
        const womanFamily = familyOf(woman);
        if (isAdult(byId.get(womanFamily.partnerId))) continue;

        const distance = distanceSquared(man, woman);
        if (distance < closestDistance) {
          closestWoman = woman;
          closestDistance = distance;
        }
      }

      if (!closestWoman) continue;

      const womanFamily = familyOf(closestWoman);
      const firstBirthAt = this.simulationTime + CHILD_BIRTH_INTERVAL;
      manFamily.partnerId = closestWoman.id;
      manFamily.nextChildAt = firstBirthAt;
      womanFamily.partnerId = man.id;
      womanFamily.nextChildAt = firstBirthAt;
      man.relationshipStatus = "partnered";
      closestWoman.relationshipStatus = "partnered";
    }
  }

  tryBirths(residents, humanManager, village, developmentSystem) {
    const byId = new Map(residents.map((human) => [human.id, human]));

    for (const man of residents) {
      if (!isAdult(man) || man.identity.gender !== "Male") continue;

      const manFamily = familyOf(man);
      const woman = byId.get(manFamily.partnerId);
      if (!isAdult(woman) || woman.identity.gender !== "Female") continue;

      const womanFamily = familyOf(woman);
      if (womanFamily.partnerId !== man.id) continue;
      if (this.simulationTime < (manFamily.nextChildAt ?? Infinity)) continue;

      if (
        humanManager.humans.length >= MAX_POPULATION ||
        village.inhabitants.length >= MAX_POPULATION
      ) {
        continue;
      }

      this.createChild(man, woman, humanManager, village, developmentSystem);
      const nextBirthAt = this.simulationTime + CHILD_BIRTH_INTERVAL;
      manFamily.nextChildAt = nextBirthAt;
      womanFamily.nextChildAt = nextBirthAt;
    }
  }

  createChild(man, woman, humanManager, village, developmentSystem) {
    const id = `human-${humanManager.nextId++}`;
    const x = (man.movement.x + woman.movement.x) * 0.5;
    const y = (man.movement.y + woman.movement.y) * 0.5;
    const angle = Math.random() * Math.PI * 2;
    const child = new Human(
      id,
      x + Math.cos(angle) * 4,
      y + Math.sin(angle) * 4
    );

    child.villageId = village.id;
    child.profession = "child";
    child.workStatus = "idle";
    child.workTaskId = null;
    child.isChild = true;
    child.childAgeSeconds = 0;
    child.growthRatio = 0;
    child.identity.age = 0;
    child.identity.lastName = man.identity.lastName;
    child.appearance.hasBeard = false;
    child.appearance.faceMark = false;
    child.relationshipStatus = "single";
    child.family = {
      partnerId: null,
      parentIds: [man.id, woman.id],
      childrenIds: [],
      nextChildAt: null
    };

    this.installChildDrawing(child);
    humanManager.humans.push(child);
    village.inhabitants.push(child.id);
    familyOf(man).childrenIds.push(child.id);
    familyOf(woman).childrenIds.push(child.id);

    this.assignChildToParentHome(
      child,
      new Map([[man.id, man], [woman.id, woman]]),
      developmentSystem
    );
  }

  assignChildToParentHome(child, humanById, developmentSystem) {
    if (
      !developmentSystem?.assignedHousing ||
      !Array.isArray(developmentSystem.buildings)
    ) {
      return;
    }

    const houses = developmentSystem.buildings.filter(
      (building) =>
        building.state === "completed" &&
        typeof building.type === "string" &&
        building.type.endsWith("House")
    );
    const houseById = new Map(houses.map((house) => [house.id, house]));

    // Keep an existing valid assignment. Remove only stale assignments.
    const assignedHouseId = developmentSystem.assignedHousing.get(child.id);
    if (assignedHouseId && houseById.has(assignedHouseId)) return;
    if (assignedHouseId) {
      developmentSystem.assignedHousing.delete(child.id);
      for (const house of developmentSystem.buildings) {
        if (Array.isArray(house.residents)) {
          house.residents = house.residents.filter((id) => id !== child.id);
        }
      }
    }

    const parentHouseIds = familyOf(child).parentIds
      .map((parentId) => humanById.get(parentId))
      .filter(Boolean)
      .map((parent) => developmentSystem.assignedHousing.get(parent.id))
      .filter(Boolean);
    const parentHouseIdSet = new Set(parentHouseIds);
    const orderedHouses = [
      ...houses.filter((house) => parentHouseIdSet.has(house.id)),
      ...houses.filter((house) => !parentHouseIdSet.has(house.id))
    ];

    for (const home of orderedHouses) {
      const capacity = Math.max(0, Number(home.capacity) || 0);
      if (capacity === 0) continue;

      let occupiedBeds = 0;
      for (const assignedId of developmentSystem.assignedHousing.values()) {
        if (assignedId === home.id) occupiedBeds += 1;
      }
      if (occupiedBeds >= capacity) continue;

      home.residents ??= [];
      if (!home.residents.includes(child.id)) home.residents.push(child.id);
      developmentSystem.assignedHousing.set(child.id, home.id);
      if (child.needs) child.needs.housing = null;
      return;
    }

    // No free bed: keep the child in the population without assigning housing.
    // VillageDevelopmentSystem will see the missing assignment and request a house.
  }

  installChildDrawing(child) {
    const originalDraw = child.draw.bind(child);

    child.draw = (context, detail) => {
      const growth = Math.max(0, Math.min(1, child.growthRatio ?? 0));
      const scale =
        CHILD_MINIMUM_SCALE + (1 - CHILD_MINIMUM_SCALE) * growth;
      const x = child.movement.x;
      const y = child.movement.y;

      context.save();
      try {
        context.translate(x, y);
        context.scale(scale, scale);
        context.translate(-x, -y);
        originalDraw(context, detail);
      } finally {
        context.restore();
      }
    };
  }
}
