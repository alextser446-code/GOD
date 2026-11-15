import { HumanDialogue } from "./humanDialogue.js";

const SOCIAL_DAY_SECONDS = 60;
const RELATIONSHIP_DECAY_DELAY_DAYS = 7;
const RELATIONSHIP_DECAY_PER_DAY = 0.08;
const FORGET_AFTER_DAYS = 90;
const INTERACTION_INTERVAL = 0.75;
const INTERACTION_RANGE = 38;
const CONVERSATION_BUBBLE_MIN_ZOOM = 1.25;

function randomBetween(minimum, maximum) {
  return minimum + Math.random() * (maximum - minimum);
}

function hasTrait(human, trait) {
  return human.identity.personality.includes(trait);
}

function pairKey(first, second) {
  return first.id < second.id
    ? `${first.id}|${second.id}`
    : `${second.id}|${first.id}`;
}

function getRelationshipStage(value) {
  if (value >= 60) {
    return "Friend";
  }

  if (value >= 25) {
    return "Good Acquaintance";
  }

  return "Acquaintance";
}

export class HumanSocialSystem {
  constructor() {
    this.simulationTime = 0;
    this.interactionTimer = 0;
    this.nextConversationId = 1;
    this.conversations = new Map();
    this.pairCooldowns = new Map();
  }

  update(deltaSeconds, humans) {
    const delta = Math.min(Math.max(deltaSeconds, 0), 0.1);
    this.simulationTime += delta;

    const humansById = new Map();
    for (const human of humans) {
      humansById.set(human.id, human);
    }

    this.cleanRemovedHumans(humans, humansById);
    this.advanceConversations(humansById);

    this.interactionTimer += delta;

    if (this.interactionTimer >= INTERACTION_INTERVAL) {
      this.interactionTimer %= INTERACTION_INTERVAL;
      this.updateRelationshipDecay(humans, humansById);
      this.checkNearbyHumans(humans);
      this.removeExpiredCooldowns();
    }
  }

  cleanRemovedHumans(humans, humansById) {
    for (const conversation of this.conversations.values()) {
      if (
        !humansById.has(conversation.firstId) ||
        !humansById.has(conversation.secondId)
      ) {
        this.finishConversation(conversation, humansById, false);
      }
    }

    for (const human of humans) {
      for (const otherId of human.social.acquaintances) {
        if (!humansById.has(otherId)) {
          human.social.acquaintances.delete(otherId);
          human.social.relationships.delete(otherId);
        }
      }

      for (const otherId of human.social.relationships.keys()) {
        if (!humansById.has(otherId)) {
          human.social.relationships.delete(otherId);
        }
      }
    }
  }

  checkNearbyHumans(humans) {
    const rangeSquared = INTERACTION_RANGE * INTERACTION_RANGE;

    for (let firstIndex = 0; firstIndex < humans.length; firstIndex += 1) {
      const first = humans[firstIndex];

      for (
        let secondIndex = firstIndex + 1;
        secondIndex < humans.length;
        secondIndex += 1
      ) {
        const second = humans[secondIndex];
        const dx = first.movement.x - second.movement.x;
        const dy = first.movement.y - second.movement.y;

        if (dx * dx + dy * dy > rangeSquared) {
          continue;
        }

        this.tryStartConversation(first, second);
      }
    }
  }

  tryStartConversation(first, second) {
    const key = pairKey(first, second);

    if ((this.pairCooldowns.get(key) ?? 0) > this.simulationTime) {
      return;
    }

    if (!this.isAvailable(first) || !this.isAvailable(second)) {
      return;
    }

    const areAcquainted =
      first.social.acquaintances.has(second.id) &&
      second.social.acquaintances.has(first.id);

    this.pairCooldowns.set(
      key,
      this.simulationTime + randomBetween(8, 15)
    );

    if (
      !this.wantsToSocialize(first, areAcquainted) ||
      !this.wantsToSocialize(second, areAcquainted)
    ) {
      return;
    }

    this.startConversation(first, second, areAcquainted);
  }

  isAvailable(human) {
    return (
      human.social.conversationId === null &&
      human.actionPriority === "normal" &&
      !human.isOffDuty &&
      !human.movement.isPaused &&
      human.social.cooldownUntil <= this.simulationTime
    );
  }

  wantsToSocialize(human, areAcquainted) {
    let chance =
      human.social.willingness -
      Math.min(human.social.acquaintances.size * 0.025, 0.28);

    if (human.movement.state === "idle") {
      chance += 0.12;
    } else if (human.movement.speed > 6) {
      chance -= 0.12;
    }

    if (areAcquainted) {
      chance *= 0.65;
    }

    chance += randomBetween(-0.1, 0.1);
    chance = Math.max(0.05, Math.min(0.9, chance));

    return Math.random() < chance;
  }

  startConversation(first, second, areAcquainted) {
    const conversationId = `conversation-${this.nextConversationId}`;
    this.nextConversationId += 1;

    const conversation = {
      id: conversationId,
      firstId: first.id,
      secondId: second.id,
      type: areAcquainted ? "small-talk" : "introduction",
      lines: areAcquainted
        ? HumanDialogue.createSmallTalk(first, second)
        : HumanDialogue.createIntroduction(first, second),
      lineIndex: -1,
      nextLineAt: this.simulationTime
    };

    first.social.conversationId = conversationId;
    second.social.conversationId = conversationId;
    first.social.speech = null;
    second.social.speech = null;

    first.social.gazeX = Math.sign(second.movement.x - first.movement.x);
    second.social.gazeX = Math.sign(first.movement.x - second.movement.x);

    first.movement.setPaused(true);
    second.movement.setPaused(true);

    this.conversations.set(conversationId, conversation);
  }

  advanceConversations(humansById) {
    for (const conversation of this.conversations.values()) {
      const first = humansById.get(conversation.firstId);
      const second = humansById.get(conversation.secondId);

      if (!first || !second) {
        this.finishConversation(conversation, humansById, false);
        continue;
      }

      if (
        first.actionPriority !== "normal" ||
        second.actionPriority !== "normal"
      ) {
        this.finishConversation(conversation, humansById, false);
        continue;
      }

      if (this.simulationTime < conversation.nextLineAt) {
        continue;
      }

      if (conversation.lineIndex >= 0) {
        const previousLine = conversation.lines[conversation.lineIndex];
        const previousSpeaker = humansById.get(previousLine.speakerId);

        if (previousSpeaker) {
          previousSpeaker.social.speech = null;
        }
      }

      conversation.lineIndex += 1;

      if (conversation.lineIndex >= conversation.lines.length) {
        this.finishConversation(conversation, humansById, true);
        continue;
      }

      const line = conversation.lines[conversation.lineIndex];
      const speaker = humansById.get(line.speakerId);

      if (!speaker) {
        this.finishConversation(conversation, humansById, false);
        continue;
      }

      speaker.social.speech = line.text;
      conversation.nextLineAt = this.simulationTime + line.duration;
    }
  }

  finishConversation(conversation, humansById, completed) {
    this.conversations.delete(conversation.id);

    const first = humansById.get(conversation.firstId);
    const second = humansById.get(conversation.secondId);

    if (completed && first && second) {
      if (conversation.type === "introduction") {
        first.social.acquaintances.add(second.id);
        second.social.acquaintances.add(first.id);
      }

      this.updateRelationship(first, second);
    }

    for (const human of [first, second]) {
      if (!human) {
        continue;
      }

      human.social.speech = null;
      human.social.conversationId = null;
      human.social.gazeX = 0;
      human.social.cooldownUntil = this.simulationTime + randomBetween(1, 3);
      const mustStayStillForCoronation =
        human.actionPriority === "coronation" &&
        human.movement.temporaryTarget === null;

      if (!mustStayStillForCoronation) {
        human.movement.setPaused(false);
      }
    }
  }

  updateRelationship(first, second) {
    const uncomfortable =
      Math.random() < 0.2 ||
      (
        (hasTrait(first, "Aggressive") && hasTrait(second, "Shy")) ||
        (hasTrait(second, "Aggressive") && hasTrait(first, "Shy"))
      );

    this.updateOneRelationship(first, second, uncomfortable);
    this.updateOneRelationship(second, first, uncomfortable);
  }

  updateOneRelationship(owner, other, uncomfortable) {
    let relationship = owner.social.relationships.get(other.id);

    if (!relationship) {
      relationship = {
        value: 6,
        stage: "Acquaintance",
        lastInteractionTime: this.simulationTime,
        lastDecayTime: this.simulationTime
      };

      owner.social.relationships.set(other.id, relationship);
    }

    let change = uncomfortable
      ? -randomBetween(0.8, 2.2)
      : randomBetween(1, 2.5);

    if (
      !uncomfortable &&
      (hasTrait(owner, "Friendly") || hasTrait(owner, "Generous"))
    ) {
      change += 0.8;
    }

    if (hasTrait(owner, "Aggressive")) {
      change -= 1;
    }

    if (
      hasTrait(other, "Aggressive") &&
      (hasTrait(owner, "Shy") || hasTrait(owner, "Fearful"))
    ) {
      change -= 1;
    }

    relationship.value = Math.max(
      0,
      Math.min(100, relationship.value + change)
    );
    relationship.stage = getRelationshipStage(relationship.value);
    relationship.lastInteractionTime = this.simulationTime;
    relationship.lastDecayTime = this.simulationTime;
  }

  updateRelationshipDecay(humans, humansById) {
    const decayDelay = RELATIONSHIP_DECAY_DELAY_DAYS * SOCIAL_DAY_SECONDS;
    const forgetAfter = FORGET_AFTER_DAYS * SOCIAL_DAY_SECONDS;

    for (const human of humans) {
      for (const [otherId, relationship] of human.social.relationships) {
        if (!humansById.has(otherId)) {
          continue;
        }

        const decayStart = relationship.lastInteractionTime + decayDelay;

        if (this.simulationTime > decayStart) {
          const decayFrom = Math.max(relationship.lastDecayTime, decayStart);
          const elapsed = this.simulationTime - decayFrom;

          relationship.value = Math.max(
            0,
            relationship.value -
              (elapsed / SOCIAL_DAY_SECONDS) * RELATIONSHIP_DECAY_PER_DAY
          );
          relationship.lastDecayTime = this.simulationTime;
          relationship.stage = getRelationshipStage(relationship.value);
        }

        if (
          relationship.value <= 0 &&
          this.simulationTime - relationship.lastInteractionTime >= forgetAfter
        ) {
          human.social.relationships.delete(otherId);
          human.social.acquaintances.delete(otherId);
        }
      }
    }
  }

  removeExpiredCooldowns() {
    for (const [key, expiryTime] of this.pairCooldowns) {
      if (expiryTime <= this.simulationTime) {
        this.pairCooldowns.delete(key);
      }
    }
  }

  draw(context, humans, zoom) {
    const safeZoom = Math.max(0.01, zoom);

    for (const human of humans) {
      const text = human.social.speech;

      if (!text) {
        continue;
      }

      // Hide ordinary conversation bubbles when the village is zoomed out.
      // Other speech, such as the king's announcement, stays visible.
      if (
        human.social.conversationId !== null &&
        safeZoom < CONVERSATION_BUBBLE_MIN_ZOOM
      ) {
        continue;
      }

      context.save();
      context.translate(human.movement.x, human.movement.y - 13);
      context.scale(1 / safeZoom, 1 / safeZoom);
      context.font = "12px system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";

      const width = Math.min(
        240,
        Math.max(72, context.measureText(text).width + 18)
      );

      context.fillStyle = "#fff9e9";
      context.strokeStyle = "#4b4032";
      context.lineWidth = 1;
      context.fillRect(-width / 2, -30, width, 26);
      context.strokeRect(-width / 2, -30, width, 26);

      context.beginPath();
      context.moveTo(-4, -4);
      context.lineTo(0, 1);
      context.lineTo(4, -4);
      context.closePath();
      context.fill();
      context.stroke();

      context.fillStyle = "#211e19";
      context.fillText(text, 0, -17, width - 12);
      context.restore();
    }
  }
}
