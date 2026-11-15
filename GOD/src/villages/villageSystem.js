const INITIAL_TERRITORY_RADIUS = 96;
const FOUNDING_RADIUS = 96;
const FOUNDING_DURATION = 5;
const GATHERING_RADIUS = 18;
const GATHERING_TIMEOUT = 45;
const CORONATION_DURATION = 7;
const KING_ACCEPTANCE_RADIUS = 18;
const ACCEPTANCE_DURATION = 8;
const MAX_ACCEPTED_PER_PROCESS = 3;

const VILLAGE_NAMES = [
  "Stonebrook",
  "Iligia",
  "Alexicon",
  "zwülf",
  "fumf",
  "fumunfirzisch",
  "Westbrook",
  "Ashford",
];

function choose(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function getHumanById(humans, id) {
  return humans.find((human) => human.id === id) ?? null;
}

function getDistanceSquared(first, second) {
  const dx = first.movement.x - second.movement.x;
  const dy = first.movement.y - second.movement.y;

  return dx * dx + dy * dy;
}

function getStableAngle(id) {
  let hash = 0;

  for (const character of String(id)) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return (hash / 4294967296) * Math.PI * 2;
}

function getStrongestHuman(humans, preferredId = null) {
  if (humans.length === 0) {
    return null;
  }

  const highestStrength = Math.max(
    ...humans.map((human) => human.identity.strength)
  );
  const tied = humans.filter(
    (human) => human.identity.strength === highestStrength
  );
  const preferred = tied.find((human) => human.id === preferredId);

  return preferred ?? choose(tied);
}

export class VillageSystem {
  constructor() {
    this.villages = [];
    this.currentVillage = null;
    this.nextVillageId = 1;
    this.simulationTime = 0;
    this.territoryVisible = false;

    this.founding = null;
    this.ceremony = null;

    this.joinRequestIds = new Set();
    this.acceptance = null;
  }

  update(deltaSeconds, humans) {
    const delta = Number.isFinite(deltaSeconds)
      ? Math.max(0, deltaSeconds)
      : 0;

    this.simulationTime += delta;

    if (!this.currentVillage) {
      this.updateFounding(delta, humans);
      return;
    }

    if (this.ceremony) {
      this.updateCeremony(humans);
    }

    if (!this.ceremony && this.currentVillage) {
      this.updateJoining(delta, humans);
    }
  }

  registerSpawnedHumans(spawnedHumans, allHumans) {
    if (!spawnedHumans || spawnedHumans.length === 0) {
      return;
    }

    if (this.currentVillage) {
      for (const human of spawnedHumans) {
        this.requestToJoin(human);
      }

      return;
    }

    if (!this.founding) {
      const firstHuman = spawnedHumans[0];

      this.founding = {
        centerX: firstHuman.movement.x,
        centerY: firstHuman.movement.y,
        elapsed: 0,
        candidateId: firstHuman.id
      };
    }

    this.lockFounders(this.getEligibleFounders(allHumans));
    this.refreshFoundingCandidate(allHumans);
  }

  lockFounders(founders) {
    for (const human of founders) {
      if (human.actionPriority === "normal") {
        human.actionPriority = "founding";
      }

      if (human.social.conversationId === null && human.movement.isPaused) {
        human.movement.setPaused(false);
      }
    }
  }

  updateFounding(delta, humans) {
    if (!this.founding) {
      return;
    }

    const eligibleHumans = this.getEligibleFounders(humans);

    if (eligibleHumans.length == 0) {
      for (const human of humans) {
        if (human.actionPriority === "founding") {
          human.actionPriority = "normal";
          human.movement.setPaused(false);
        }
      }
      this.founding = null;
      return;
    }

    this.lockFounders(eligibleHumans);

    const strongest = getStrongestHuman(
      eligibleHumans,
      this.founding.candidateId
    );
    this.founding.candidateId = strongest.id;
    this.founding.elapsed += delta;

    if (this.founding.elapsed >= FOUNDING_DURATION) {
      this.createFirstVillage(eligibleHumans);
    }
  }

  refreshFoundingCandidate(humans) {
    if (!this.founding) {
      return;
    }

    const eligibleHumans = this.getEligibleFounders(humans);

    if (eligibleHumans.length > 0) {
      this.founding.candidateId = getStrongestHuman(
        eligibleHumans,
        this.founding.candidateId
      ).id;
    }
  }

  getEligibleFounders(humans) {
    if (!this.founding) {
      return [];
    }

    const radiusSquared = FOUNDING_RADIUS * FOUNDING_RADIUS;

    return humans.filter((human) => {
      const dx = human.movement.x - this.founding.centerX;
      const dy = human.movement.y - this.founding.centerY;

      return dx * dx + dy * dy <= radiusSquared;
    });
  }

  createFirstVillage(founders) {
    if (this.currentVillage || founders.length === 0) {
      return;
    }

    const king = getStrongestHuman(founders, this.founding?.candidateId);

    if (!king) {
      this.founding = null;
      return;
    }

    const centerX =
      founders.reduce((total, human) => total + human.movement.x, 0) /
      founders.length;
    const centerY =
      founders.reduce((total, human) => total + human.movement.y, 0) /
      founders.length;

    const village = {
      id: `village-${this.nextVillageId}`,
      name: this.createVillageName(),
      kingId: king.id,
      centerX,
      centerY,
      radius: INITIAL_TERRITORY_RADIUS,
      inhabitants: [...new Set(founders.map((human) => human.id))],
      foundingTime: this.simulationTime,
      foundingStatus: "founding",
      coronationStatus: "gathering"
    };

    this.nextVillageId += 1;
    this.currentVillage = village;
    this.villages.push(village);
    this.founding = null;

    for (const human of founders) {
      human.villageId = village.id;
      human.joiningVillageId = null;
      human.joiningStatus = null;
      human.isKing = false;
    }

    this.beginCoronation(village, founders, king);

    // Menschen außerhalb des Gründungsbereichs werden nicht Gründer.
    // Nach der Gründung können sie sich dem Dorf anschließen.
  }

  createVillageName() {
    const usedNames = new Set(this.villages.map((village) => village.name));
    const availableNames = VILLAGE_NAMES.filter((name) => !usedNames.has(name));

    return availableNames.length > 0
      ? choose(availableNames)
      : `Newstead ${this.villages.length + 1}`;
  }

  beginCoronation(village, founders, king) {
    const targets = new Map();
    const otherFounders = founders.filter((human) => human.id !== king.id);

    targets.set(king.id, {
      x: village.centerX,
      y: village.centerY
    });

    otherFounders.forEach((human, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(1, otherFounders.length);

      targets.set(human.id, {
        x: village.centerX + Math.cos(angle) * GATHERING_RADIUS,
        y: village.centerY + Math.sin(angle) * GATHERING_RADIUS
      });
    });

    this.ceremony = {
      kingId: king.id,
      participantIds: founders.map((human) => human.id),
      targets,
      arrivedIds: new Set(),
      phase: "gathering",
      startedAt: this.simulationTime,
      previousKingSpeech: null
    };

    for (const human of founders) {
      human.actionPriority = "coronation";
      human.movement.clearTemporaryTarget();
      this.moveCeremonyParticipant(human);
    }
  }

  moveCeremonyParticipant(human) {
    const target = this.ceremony.targets.get(human.id);

    if (!target || human.social.conversationId !== null) {
      return;
    }

    if (human.movement.isPaused) human.movement.setPaused(false);

    if (!human.movement.temporaryTarget) {
      human.movement.setTemporaryTarget(target.x, target.y);
    }
  }

  updateCeremony(humans) {
    const ceremony = this.ceremony;

    if (!ceremony) {
      return;
    }

    this._humansById = new Map(humans.map((human) => [human.id, human]));

    ceremony.participantIds = ceremony.participantIds.filter((id) => {
      const human = getHumanById(humans, id);

      if (!human) {
        this.currentVillage.inhabitants =
          this.currentVillage.inhabitants.filter(
            (inhabitantId) => inhabitantId !== id
          );
        ceremony.arrivedIds.delete(id);
        return false;
      }

      return true;
    });

    const king = getHumanById(humans, ceremony.kingId);

    if (!king) {
      this.cancelCeremony(humans);
      this.currentVillage.foundingStatus = "cancelled";
      this.currentVillage.coronationStatus = "cancelled";
      return;
    }

    if (ceremony.phase === "gathering") {
      for (const id of ceremony.participantIds) {
        const human = getHumanById(humans, id);

        if (!human || ceremony.arrivedIds.has(id)) {
          continue;
        }

        this.moveCeremonyParticipant(human);

        if (
          human.social.conversationId === null &&
          human.movement.destinationReached &&
          human.movement.speed <= 0.4
        ) {
          human.movement.stopAndFaceTarget();
          ceremony.arrivedIds.add(id);
        }
      }
      
      const allArrived = ceremony.participantIds.every((id) =>
        ceremony.arrivedIds.has(id)
      );
      const timedOut =
        this.simulationTime - ceremony.startedAt >= GATHERING_TIMEOUT;

      if (allArrived || timedOut) {
        for (const id of ceremony.participantIds) {
          const human = getHumanById(humans, id);

          if (!human || ceremony.arrivedIds.has(id)) {
            continue;
          }

          human.movement.stopAndFaceTarget();

          ceremony.arrivedIds.add(id);
        }

        this.startCoronation(king);
      }

      return;
    }

    if (
      ceremony.phase === "coronation" &&
      this.simulationTime - ceremony.startedAt >= CORONATION_DURATION
    ) {
      this.finishCoronation(humans);
    }
  }

  startCoronation(king) {
    const ceremony = this.ceremony;

    ceremony.phase = "coronation";
    ceremony.startedAt = this.simulationTime;
    ceremony.previousKingSpeech = king.social.speech;
    king.isKing = true;
    king.social.speech = "Long live the king!";
    this.currentVillage.coronationStatus = "ceremony";

    for (const id of ceremony.participantIds) {
      const human = this._humansById?.get(id);
      if (human) human.movement.stopAndFaceTarget();
    }
  }

  finishCoronation(humans) {
    const ceremony = this.ceremony;
    const village = this.currentVillage;

    for (const id of ceremony.participantIds) {
      const human = getHumanById(humans, id);

      if (!human) {
        continue;
      }

      if (human.id === ceremony.kingId) {
        if (human.social.speech === "Long live the king!") {
          human.social.speech = ceremony.previousKingSpeech;
        }
      }

      human.movement.clearTemporaryTarget();
      human.actionPriority = "normal";
      human.social.cooldownUntil = 0;

      if (human.social.conversationId === null) {
        human.movement.setPaused(false);
      }
    }

    village.foundingStatus = "established";
    village.coronationStatus = "completed";
    this.ceremony = null;
  }


  cancelCeremony(humans) {
    if (!this.ceremony) {
      return;
    }

    for (const id of this.ceremony.participantIds) {
      const human = getHumanById(humans, id);

      if (!human) {
        continue;
      }

      human.movement.clearTemporaryTarget();
      human.actionPriority = "normal";
      human.social.cooldownUntil = 0;

      if (human.social.conversationId === null) {
        human.movement.setPaused(false);
      }
    }

    this.ceremony = null;
  }

  requestToJoin(human) {
    const village = this.currentVillage;

    if (
      !village ||
      !human || 
      village.inhabitants.includes(human.id) ||
      human.joiningVillageId === village.id
    ) {
      return;
    }

    human.joiningVillageId = village.id;
    human.joiningStatus = "approaching";
    human.actionPriority = "joining";
    this.joinRequestIds.add(human.id);
  }

  updateJoining(delta, humans) {
    const village = this.currentVillage;
    const king = getHumanById(humans, village.kingId);

    if (!king) {
      this.cancelJoining(humans);
      return;
    }

    for (const id of [...this.joinRequestIds]) {
      const human = getHumanById(humans, id);

      if (!human) {
        this.joinRequestIds.delete(id);
        continue;
      }

      if (
        human.villageId === village.id ||
        human.joiningVillageId !== village.id
      ) {
        this.joinRequestIds.delete(id);
        continue;
      }

      if (human.social.conversationId !== null) {
        continue;
      }

      const distanceFromKingSquared = getDistanceSquared(human, king);
      const acceptanceRadiusSquared =
        KING_ACCEPTANCE_RADIUS * KING_ACCEPTANCE_RADIUS;

      if (distanceFromKingSquared <= acceptanceRadiusSquared) {
        if (human.joiningStatus !== "waiting") {
          human.movement.clearTemporaryTarget();
          human.movement.setPaused(true);
          human.joiningStatus = "waiting";
          human.actionPriority = "waiting";
        }

        continue;
      }

      human.joiningStatus = "approaching";

      if (human.movement.isPaused) {
        human.movement.setPaused(false);
      }

      const angle = distanceFromKingSquared > 0
        ? Math.atan2(
            human.movement.y - king.movement.y,
            human.movement.x - king.movement.x
        )
        : getStableAngle(human.id);

      const targetX =
        king.movement.x + Math.cos(angle) * (KING_ACCEPTANCE_RADIUS * 0.7);
      const targetY =
        king.movement.y + Math.sin(angle) * (KING_ACCEPTANCE_RADIUS * 0.7);

      human.movement.setTemporaryTarget(targetX, targetY);
    }

    this.updateAcceptance(delta, humans, king);

    if (!this.acceptance) {
      this.startAcceptanceIfReady(humans, king);
    }
  }

  startAcceptanceIfReady(humans, king) {
    if (
      this.acceptance ||
      king.social.conversationId !== null ||
      king.movement.isPaused
    ) {
      return;
    }

    const radiusSquared =
      KING_ACCEPTANCE_RADIUS * KING_ACCEPTANCE_RADIUS;
    const waitingIds = [];

    for (const id of this.joinRequestIds) {
      const human = getHumanById(humans, id);

      if (
        human &&
        human.joiningStatus === "waiting" && 
        human.joiningVillageId === this.currentVillage.id &&
        getDistanceSquared(human, king) <= radiusSquared
      ) {
        waitingIds.push(id);
      }
    }

    if (waitingIds.length === 0) {
      return;
    }

    const participantIds = waitingIds.slice(0, MAX_ACCEPTED_PER_PROCESS);

    this.acceptance = {
      kingId: king.id,
      participantIds,
      remaining: ACCEPTANCE_DURATION,
      kingWasPaused: king.movement.isPaused
    };

    king.actionPriority = "acceptance";
    king.movement.setPaused(true);
  }

  updateAcceptance(delta, humans, king) {
    if (!this.acceptance) {
      return;
    }

    this.acceptance.participantIds = this.acceptance.participantIds.filter(
      (id) => {
        const human = getHumanById(humans, id);

        if (!human) {
          this.joinRequestIds.delete(id);
          return false;
        }

        return true;
      }
    );

    if (this.acceptance.participantIds.length === 0) {
      this.finishAcceptance(humans, king, false);
      return;
    }

    this.acceptance.remaining -= delta;

    if (this.acceptance.remaining <= 0) {
      this.finishAcceptance(humans, king, true);
    }
  }

  finishAcceptance(humans, king, shouldAccept) {
    const acceptance = this.acceptance;

    if (!acceptance || !this.currentVillage) {
      return;
    }

    const village = this.currentVillage;
    const radiusSquared = KING_ACCEPTANCE_RADIUS * KING_ACCEPTANCE_RADIUS;

    for (const id of acceptance.participantIds) {
      const human = getHumanById(humans, id);

      if (!human) {
        this.joinRequestIds.delete(id);
        continue;
      }

      const isNearby = getDistanceSquared(human, king) <= radiusSquared;

      if (
        shouldAccept &&
        isNearby &&
        !human.villageId &&
        !village.inhabitants.includes(human.id)
      ) {
        village.inhabitants.push(human.id);
        human.villageId = village.id;
        human.joiningVillageId = null;
        human.joiningStatus = null;
        human.actionPriority = "normal";
        human.social.cooldownUntil = 0;
        this.joinRequestIds.delete(human.id);
        human.movement.clearTemporaryTarget();

        if (human.social.conversationId === null) {
          human.movement.setPaused(false);
        }

        continue;
      }

      human.joiningStatus = "approaching";
      human.actionPriority = "joining";

      if (human.social.conversationId === null) {
        human.movement.setPaused(false);
      }
    }

    if (!acceptance.kingWasPaused && king.social.conversationId === null) {
      king.movement.setPaused(false);
    }
    king.actionPriority = "normal";
    king.social.cooldownUntil = 0;

    this.acceptance = null;
  }

  cancelJoining(humans) {
    for (const id of this.joinRequestIds) {
      const human = getHumanById(humans, id);

      if (!human) {
        continue;
      }

      human.joiningVillageId = null;
      human.joiningStatus = null;
      human.actionPriority = "normal";
      human.social.cooldownUntil = 0;
      human.movement.clearTemporaryTarget();

      if (human.social.conversationId === null) {
        human.movement.setPaused(false);
      }
    }

    this.joinRequestIds.clear();
    this.acceptance = null;
  }

  drawProgressBar(context, human, label, progress, zoom) {
    const safeZoom = Math.max(0.01, zoom);
    const barWidth = 190;
    const barHeight = 5;
    const fillWidth = barWidth * Math.max(0, Math.min(1, progress));

    context.save();
    context.translate(human.movement.x, human.movement.y - 20);
    context.scale(1 / safeZoom, 1 / safeZoom);
    context.font = "11px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "bottom";
    context.lineWidth = 2;
    context.strokeStyle = "rgba(30, 28, 22, 0.9)";
    context.fillStyle = "#fff9e9";
    context.strokeText(label, 0, -3);
    context.fillText(label, 0, -3);
    context.fillStyle = "rgba(30, 28, 22, 0.85)";
    context.fillRect(-barWidth / 2, 0, barWidth, barHeight);
    context.fillStyle = "#e3bf55";
    context.fillRect(-barWidth / 2, 0, fillWidth, barHeight);
    context.restore();
  }

  drawIndicators(context, zoom, humans) {
    if (this.founding) {
      const candidate = getHumanById(humans, this.founding.candidateId);

      if (candidate) {
        const remaining = Math.max(0, FOUNDING_DURATION - this.founding.elapsed);
        this.drawProgressBar(
          context,
          candidate,
          `Village being founded — ${Math.ceil(remaining)} seconds left`,
          this.founding.elapsed / FOUNDING_DURATION,
          zoom
        );
      }
    }

    if (this.acceptance) {
      const king = getHumanById(humans, this.acceptance.kingId);

      if (king) {
        this.drawProgressBar(
          context,
          king,
          `Accepting new villagers — ${Math.ceil(this.acceptance.remaining)} seconds left`,
          1 - this.acceptance.remaining / ACCEPTANCE_DURATION,
          zoom
        );
      }
    }
  }

  toggleTerritory() {
    if (!this.currentVillage) {
      return false;
    }

    this.territoryVisible = !this.territoryVisible;
    return this.territoryVisible;
  }

  drawTerritory(context, zoom) {
    if (!this.currentVillage || !this.territoryVisible) {
      return;
    }

    const village = this.currentVillage;
    const safeZoom = Math.max(0.01, zoom);

    context.save();
    context.beginPath();
    context.arc(village.centerX, village.centerY, village.radius, 0, Math.PI * 2);
    context.fillStyle = "rgba(238, 207, 105, 0.035)";
    context.fill();
    context.strokeStyle = "rgba(244, 218, 132, 0.85)";
    context.lineWidth = 1.5 / safeZoom;
    context.setLineDash([7 / safeZoom, 5 / safeZoom]);
    context.stroke();
    context.restore();
  }
}
