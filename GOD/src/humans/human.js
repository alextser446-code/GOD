import { HumanAnimation } from "./humanAnimation.js";
import { createHumanIdentity } from "./humanIdentity.js";
import { HumanMovement } from "./humanMovement.js";

const SKIN_TONES = ["#efc6a0", "#d9a77e", "#b97852", "#8c573d"];
const HAIR_COLORS = ["#30251e", "#5b3826", "#8a5a32", "#b18a4d", "#77716a"];
const CLOTHING_COLORS = ["#6b4635", "#52637a", "#705344", "#65704b", "#8a3f35", "#8b7440"];
const DARK_CLOTHING_COLORS = ["#493126", "#36465a", "#4e392d", "#465036", "#642f2b", "#66552f"];

function pick(values) {
  return values[Math.floor(Math.random() * values.length)];
}

export class Human {
  constructor(id, x, y) {
    this.id = id;
    this.identity = createHumanIdentity(id);
    this.villageId = null;
    this.isKing = false;
    this.isIndoors = false;
    this.isOffDuty = false;
    this.joiningVillageId = null;
    this.joiningStatus = null;
    this.actionPriority = "normal";
    this.profession = "none";
    this.workTaskId = null;
    this.workStatus = "idle";
    this.workState = { phase: "idle", axeSwing: 0, carriedWood: 0 };
    this.workAreaId = null;
    this.movement = new HumanMovement(x, y);
    this.animation = new HumanAnimation();

    const presentation = this.identity.gender === "Female"
      ? "feminine"
      : "masculine";
    const hairStyle = pick(
      presentation === "feminine"
        ? ["long", "braid", "hood"]
        : ["short", "long", "hood"]
    );

    this.appearance = {
      presentation,
      skin: pick(SKIN_TONES),
      hair: pick(HAIR_COLORS),
      hairStyle,
      clothing: pick(CLOTHING_COLORS),
      darkClothing: pick(DARK_CLOTHING_COLORS),
      garment: pick(presentation === "feminine" ? ["tunic", "dress"] : ["tunic", "coat"]),
      hasBeard: presentation === "masculine" && Math.random() < 0.45,
      faceMark: Math.random() < 0.35
    };

    const traits = new Set(this.identity.personality);
    let willingness = 0.48;

    if (traits.has("Friendly")) willingness += 0.2;
    if (traits.has("Curious")) willingness += 0.12;
    if (traits.has("Shy")) willingness -= 0.2;
    if (traits.has("Aggressive")) willingness -= 0.08;

    willingness += Math.random() * 0.12 - 0.06;

    this.social = {
      acquaintances: new Set(),
      relationships: new Map(),
      willingness: Math.max(0.08, Math.min(0.92, willingness)),
      cooldownUntil: 0,
      conversationId: null,
      speech: null,
      gazeX: 0,
      dialogueHistory: Object.create(null)
    };
  }

  update(deltaSeconds) {
    this.movement.update(deltaSeconds);
    this.animation.update(deltaSeconds, this.movement);
  }

  draw(context, detail = { simple: 1, full: 1 }) {
    if (this.isIndoors || detail.simple <= 0) {
      return;
    }

    const look = this.appearance;
    const pose = this.animation.getPose(this.movement);
    const legSwing = Math.round(pose.legSwing);
    const axeSwing = this.profession === "woodcutter"
      ? (this.workState?.axeSwing ?? 0)
      : 0;
    const foodPhase = this.foodActivity?.phase;
    const foodTime = this.foodActivity?.elapsed ?? 0;
    const gatherReach = foodPhase === "gathering"
      ? Math.round(Math.sin(foodTime * 8) * 2)
      : 0;
    const eatingReach = foodPhase === "eating"
      ? Math.round((Math.sin(foodTime * 9) + 1) * 1.5)
      : 0;
    const farmPhase = this.farmActivity?.phase;
    const farmTime = this.farmActivity?.elapsed ?? 0;
    const farmReach = ["sowing", "harvesting"].includes(farmPhase)
      ? Math.round(Math.sin(farmTime * 8) * 2)
      : 0;
    const armSwing = Math.round(
      pose.armSwing + axeSwing * 2 + gatherReach + eatingReach + farmReach
    );
    const clothingColor = this.profession === "woodcutter"
      ? "#775039"
      : this.profession === "builder"
        ? "#a47743"
        : this.profession === "farmer"
          ? "#66734a"
        : this.profession === "representative"
          ? "#6d536f"
          : look.clothing;

    context.save();
    context.translate(
      Math.round(this.movement.x),
      Math.round(this.movement.y + pose.bodyBob)
    );
    context.scale(pose.horizontalScale * 0.68, 0.68);
    context.globalAlpha = detail.simple;

    // Pixelartige Bodenspur und Beine.
    context.fillStyle = "rgba(35, 30, 24, 0.28)";
    context.fillRect(-4, 7, 8, 2);

    context.fillStyle = look.darkClothing;
    context.fillRect(-3 + legSwing, 3, 2, 4);
    context.fillRect(1 - legSwing, 3, 2, 4);
    context.fillStyle = "#493b30";
    context.fillRect(-3 + legSwing, 6, 3, 2);
    context.fillRect(1 - legSwing, 6, 3, 2);

    // Lange Haare oder Kapuze liegen hinter dem Körper.
    if (look.hairStyle === "long" || look.hairStyle === "braid") {
      context.fillStyle = look.hair;
      context.fillRect(-3, -7, 6, 8);
      if (look.hairStyle === "braid") {
        context.fillRect(3, -2, 1, 5);
      }
    } else if (look.hairStyle === "hood") {
      context.fillStyle = look.darkClothing;
      context.fillRect(-4, -9, 8, 7);
    }

    if (this.isKing) {
      context.fillStyle = "#8f202a";
      context.fillRect(-4, -3, 8, 9);
      context.fillRect(-5, -1, 1, 6);
      context.fillRect(4, -1, 1, 6);
      context.fillStyle = "#d6b45b";
      context.fillRect(-4, -3, 8, 1);
    }

    // Körper und Kleidung.
    context.fillStyle = clothingColor;
    context.fillRect(-3, -3, 6, 8);
    context.fillRect(-5, -2 + armSwing, 2, 5);
    context.fillRect(3, -2 - armSwing, 2, 5);

    if (look.garment === "dress") {
      context.fillRect(-4, 2, 8, 3);
    } else if (look.garment === "coat") {
      context.fillStyle = look.darkClothing;
      context.fillRect(-1, -2, 2, 7);
    }

    context.fillStyle = "#c5a05a";
    context.fillRect(-3, 1, 6, 1);

    if (this.profession === "woodcutter") {
      context.fillStyle = "#493126";
      context.fillRect(-2, 2, 4, 3);
      context.fillStyle = "#b18a4d";
      context.fillRect(-2, 2, 4, 1);
    }

    if (this.profession === "builder") {
      context.fillStyle = "#674a32";
      context.fillRect(-4, -4, 8, 2);
      context.fillStyle = "#c39a5b";
      context.fillRect(-3, -3, 6, 1);
      const hammerSwing = this.workState?.phase === "building"
        ? (this.workState.hammerSwing ?? 0) * 2
        : armSwing * 0.35;
      context.save();
      context.translate(5, -5 + hammerSwing);
      context.rotate(-0.35 + hammerSwing * 0.08);
      context.fillStyle = "#67462e";
      context.fillRect(-0.5, 0, 1, 7);
      context.fillStyle = "#aeb0aa";
      context.fillRect(-2, -1, 5, 2);
      context.restore();

      if (
        this.workState?.phase === "building" &&
        Math.abs(this.workState.hammerSwing ?? 0) > 0.62
      ) {
        const dustShift = Math.round((this.workState.hammerSwing ?? 0) * 3);
        context.fillStyle = "#e0c28a";
        context.fillRect(7 + dustShift, -6, 1, 1);
        context.fillRect(8 - dustShift, -3, 1, 1);
        context.fillStyle = "#9d805c";
        context.fillRect(6 - dustShift, -2, 1, 1);
      }

      if ((this.workState?.carriedMaterials ?? 0) > 0) {
        context.fillStyle = "#805637";
        context.fillRect(-6, 0, 3, 4);
        context.fillStyle = "#b48955";
        context.fillRect(-6, 1, 3, 1);
      }
    }

    if (this.profession === "representative") {
      context.fillStyle = "#b58a4c";
      context.fillRect(-3, -4, 6, 2);
      context.fillStyle = "#d7bb74";
      context.fillRect(-3, -5, 1, 2);
      context.fillRect(-1, -6, 2, 3);
      context.fillRect(2, -5, 1, 2);
    }

    if (this.profession === "woodcutter") {
      const swingY = Math.round(-4 - axeSwing * 2);
      context.fillStyle = "#68492f";
      context.fillRect(4, swingY, 1, 7);
      context.fillStyle = "#c1c4bd";
      context.fillRect(3, swingY, 3, 2);
      context.fillStyle = "#797f7c";
      context.fillRect(5, swingY + 1, 1, 2);
    }

    if (this.profession === "farmer") {
      const hoeY = Math.round(-5 - farmReach);
      context.fillStyle = "#68492f";
      context.fillRect(5, hoeY, 1, 8);
      context.fillStyle = "#aeb0aa";
      context.fillRect(3, hoeY, 5, 1);
      context.fillRect(6, hoeY + 1, 2, 1);
    }

    context.fillStyle = look.skin;
    context.fillRect(-5, 2 + armSwing, 2, 2);
    context.fillRect(3, 2 - armSwing, 2, 2);

    if (foodPhase === "gathering") {
      context.fillStyle = "#765238";
      context.fillRect(-5, 5, 10, 3);
      context.fillStyle = "#b18450";
      context.fillRect(-4, 5, 8, 1);
      context.fillStyle = "#b83a40";
      context.fillRect(-2, 4, 2, 1);
      context.fillRect(2, 4, 2, 1);
    } else if (foodPhase === "toStorage" && (this.foodActivity?.carriedFood ?? 0) > 0) {
      context.fillStyle = "#765238";
      context.fillRect(-4, -5, 8, 5);
      context.fillStyle = "#b18450";
      context.fillRect(-3, -5, 6, 1);
      context.fillStyle = "#b83a40";
      context.fillRect(-2, -6, 2, 2);
      context.fillRect(1, -6, 2, 2);
    } else if (foodPhase === "eating") {
      const biteY = -5 - Math.round(Math.sin(foodTime * 9) * 2);
      context.fillStyle = "#b83a40";
      context.fillRect(4, biteY, 2, 2);
      context.fillStyle = "#f0a09a";
      context.fillRect(4, biteY, 1, 1);
    }

    if (
      farmPhase === "toStorage" &&
      (this.farmActivity?.carriedFood ?? 0) > 0
    ) {
      context.fillStyle = "#765238";
      context.fillRect(-4, -6, 8, 6);
      context.fillStyle = "#b18450";
      context.fillRect(-3, -6, 6, 1);
      context.fillStyle = "#d6bc63";
      context.fillRect(-2, -8, 2, 2);
      context.fillRect(1, -9, 2, 3);
      context.fillRect(3, -7, 2, 2);
    }

    // Kopf und Haare bewegen sich bei Idle minimal mit.
    context.save();
    context.translate(0, pose.headBob);
    context.fillStyle = look.skin;
    context.fillRect(-2, -9, 4, 5);

    if (look.hairStyle === "short") {
      context.fillStyle = look.hair;
      context.fillRect(-3, -10, 6, 2);
      context.fillRect(-3, -8, 1, 2);
      context.fillRect(2, -8, 1, 2);
    } else if (look.hairStyle === "hood") {
      context.fillStyle = look.darkClothing;
      context.fillRect(-4, -10, 8, 2);
    } else {
      context.fillStyle = look.hair;
      context.fillRect(-3, -10, 6, 2);
      context.fillRect(-3, -8, 1, 3);
      context.fillRect(2, -8, 1, 3);
    }

    if (this.isKing) {
      context.fillStyle = "#e3bf55";
      context.fillRect(-3, -12, 6, 2);
      context.fillRect(-3, -14, 1, 2);
      context.fillRect(-1, -15, 2, 3);
      context.fillRect(2, -14, 1, 2);
      context.fillStyle = "#f4df8a";
      context.fillRect(-2, -12, 1, 1);
      context.fillRect(1, -12, 1, 1);
    }

    if (look.hasBeard) {
      context.fillStyle = look.hair;
      context.fillRect(-1, -5, 2, 1);
    }

    if (detail.full > 0) {
      context.save();
      context.globalAlpha = detail.simple * detail.full;
      const gazeOffset = this.social.gazeX < 0
        ? -0.5
        : this.social.gazeX > 0
          ? 0.5
          : 0;
      context.fillStyle = "#302820";

      if (pose.blink) {
        context.fillRect(-1 + gazeOffset, -7, 2, 1);
      } else {
        context.fillRect(-1 + gazeOffset, -7, 1, 1);
        context.fillRect(1 + gazeOffset, -7, 1, 1);
      }

      if (look.faceMark) {
        context.fillStyle = "#7d4939";
        context.fillRect(1, -5, 1, 1);
      }

      context.fillStyle = "#d0b783";
      context.fillRect(-1, -2, 2, 1);
      context.restore();
    }

    context.restore();
    context.restore();
  }
}
