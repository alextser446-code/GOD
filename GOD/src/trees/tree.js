import { TREE_TYPES } from "./treeTypes.js";

const OAK_LOBES = [
  [-0.48, -0.14, 0.48],
  [-0.2, -0.5, 0.43],
  [0.26, -0.42, 0.46],
  [0.52, -0.08, 0.4],
  [0.34, 0.38, 0.48],
  [-0.18, 0.48, 0.45],
  [-0.52, 0.28, 0.38]
];

export class Tree {
  constructor(id, x, y, type, variation = {}) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.type = type;
    this.state = {
      condition: "healthy",
      assignedTaskId: null,
      hitPulse: 0,
      hitPhase: 0,
      fellingProgress: 0
    };

    this.scale = variation.scale ?? 1;
    this.colorIndex = variation.colorIndex ?? 0;
    const sizeRoll = Math.random();
    this.sizeClass = variation.sizeClass ?? (
      sizeRoll < 0.3 ? "small" : sizeRoll < 0.82 ? "medium" : "large"
    );
    this.woodYield = {
      small: 2,
      medium: 4,
      large: 6
    }[this.sizeClass];
    this.radius = TREE_TYPES[this.type].size * this.scale;

    const phaseSeed = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    this.windPhase = (phaseSeed - Math.floor(phaseSeed)) * Math.PI * 2;
  }

  draw(context, detail, windSystem) {
    const treeType = TREE_TYPES[this.type];
    const radius = this.radius;
    const leafColor =
      treeType.leafColors[this.colorIndex % treeType.leafColors.length];
    const windAmount = detail.wind ?? 0;
    const speciesResponse = treeType.shape === "birch" ? 0.95 : 0.75;
    const sway = windSystem
      ? windSystem.getSway(this.windPhase, speciesResponse, windAmount) * radius * 0.82
      : 0;

    context.save();
    context.translate(this.x, this.y);

    const hitPulse = this.state.hitPulse ?? 0;
    const hitPhase = this.state.hitPhase ?? 0;
    context.translate(
      Math.sin(hitPhase) * hitPulse,
      Math.cos(hitPhase * 0.83) * hitPulse * 0.35
    );

    context.fillStyle = "rgba(35, 54, 28, 0.22)";
    context.beginPath();
    context.ellipse(1, 2, radius * 0.88, radius * 0.72, 0, 0, Math.PI * 2);
    context.fill();

    context.save();
    const fellingProgress = Math.max(
      0,
      Math.min(1, this.state.fellingProgress ?? 0)
    );
    context.globalAlpha *= 1 - fellingProgress;
    const windX = windSystem?.state.directionX ?? 0;
    const windY = windSystem?.state.directionY ?? 0;
    context.translate(
      windX * sway - fellingProgress * radius * 0.55,
      windY * sway + fellingProgress * radius * 0.25
    );
    context.rotate(sway * speciesResponse * 0.16);

    // Die Baumkronen haben schon in der einfachen Ansicht verschiedene Formen.
    context.fillStyle = treeType.shadowColor;
    context.beginPath();
    if (treeType.shape === "birch") {
      context.ellipse(0, 0, radius * 0.68, radius * 1.02, -0.12, 0, Math.PI * 2);
    } else if (treeType.shape === "oak") {
      context.moveTo(-radius * 0.72, -radius * 0.08);
      context.quadraticCurveTo(-radius * 0.92, -radius * 0.72, -radius * 0.3, -radius * 0.76);
      context.quadraticCurveTo(radius * 0.08, -radius * 1.08, radius * 0.42, -radius * 0.68);
      context.quadraticCurveTo(radius * 1.02, -radius * 0.56, radius * 0.78, 0);
      context.quadraticCurveTo(radius * 0.96, radius * 0.64, radius * 0.32, radius * 0.72);
      context.quadraticCurveTo(-radius * 0.08, radius * 1.02, -radius * 0.45, radius * 0.68);
      context.quadraticCurveTo(-radius * 1.02, radius * 0.52, -radius * 0.72, -radius * 0.08);
      context.closePath();
    } else {
      context.ellipse(0, 0, radius * 0.94, radius * 0.82, 0.08, 0, Math.PI * 2);
    }
    context.fill();

    context.fillStyle = leafColor;
    context.beginPath();
    if (treeType.shape === "birch") {
      context.ellipse(-radius * 0.04, -radius * 0.08, radius * 0.58, radius * 0.9, -0.12, 0, Math.PI * 2);
    } else if (treeType.shape === "oak") {
      context.ellipse(-radius * 0.04, -radius * 0.08, radius * 0.76, radius * 0.72, -0.08, 0, Math.PI * 2);
    } else {
      context.ellipse(-radius * 0.02, -radius * 0.04, radius * 0.82, radius * 0.7, 0.08, 0, Math.PI * 2);
    }
    context.fill();

    // Die zusätzlichen Kronenformen werden beim Hineinzoomen eingeblendet.
    if (detail.canopy > 0) {
      context.save();
      context.globalAlpha = detail.canopy;

      if (treeType.shape === "oak") {
        this.drawOak(context, treeType, leafColor, radius, sway, detail.highlights ?? 0);
      } else if (treeType.shape === "birch") {
        this.drawBirch(context, treeType, leafColor, radius, sway, detail.highlights ?? 0);
      } else {
        this.drawBeech(context, treeType, leafColor, radius, sway, detail.highlights ?? 0);
      }

      context.restore();
    }

    context.restore();

    if (detail.trunk > 0) {
      context.save();
      context.globalAlpha = detail.trunk;
      context.fillStyle = treeType.shape === "birch" ? "#d5d2aa" : "#795638";
      if (fellingProgress > 0) {
        context.rotate(-0.8 * fellingProgress);
        context.fillRect(-radius * 0.55, -1.5, radius * 1.1, 3);
      } else {
        context.fillRect(-1.5, -1.5, 3, 3);
      }
      context.restore();
    }

    context.restore();
  }

  drawOak(context, treeType, leafColor, radius, sway, highlights) {
    for (const [offsetX, offsetY, size] of OAK_LOBES) {
      const branchShift = sway * (0.08 + (offsetY + 0.5) * 0.12);
      this.drawLeafCircle(
        context,
        offsetX * radius + branchShift,
        offsetY * radius,
        radius * size,
        treeType.shadowColor
      );
    }

    this.drawLeafCircle(context, sway * 0.1, 0, radius * 0.67, leafColor);
    this.drawLeafCircle(
      context,
      -radius * 0.24 + sway * 0.08,
      -radius * 0.3,
      radius * 0.23,
      treeType.highlightColor
    );
    this.drawFoliageSpecks(context, radius, treeType.highlightColor, highlights, 7);
  }

  drawBirch(context, treeType, leafColor, radius, sway, highlights) {
    context.fillStyle = treeType.shadowColor;
    context.beginPath();
    context.ellipse(sway * 0.08, 0, radius * 0.68, radius * 0.98, -0.2, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = leafColor;
    context.beginPath();
    context.ellipse(-1 + sway * 0.08, -1, radius * 0.6, radius * 0.86, -0.2, 0, Math.PI * 2);
    context.fill();

    this.drawLeafCircle(
      context,
      -radius * 0.16 + sway * 0.08,
      -radius * 0.32,
      radius * 0.2,
      treeType.highlightColor
    );

    context.fillStyle = "#d5d2aa";
    context.fillRect(-1, -1, 2, 3);
    this.drawFoliageSpecks(context, radius, treeType.highlightColor, highlights, 5);
  }

  drawBeech(context, treeType, leafColor, radius, sway, highlights) {
    this.drawLeafCircle(
      context,
      radius * 0.12 + sway * 0.08,
      radius * 0.1,
      radius * 0.82,
      treeType.shadowColor
    );

    this.drawLeafCircle(context, sway * 0.08, 0, radius * 0.72, leafColor);
    this.drawLeafCircle(
      context,
      -radius * 0.2 + sway * 0.08,
      -radius * 0.28,
      radius * 0.24,
      treeType.highlightColor
    );
    this.drawFoliageSpecks(context, radius, treeType.highlightColor, highlights, 6);
  }

  drawFoliageSpecks(context, radius, color, amount, count) {
    if (amount <= 0) return;
    context.save();
    context.globalAlpha *= amount;
    context.fillStyle = color;
    for (let index = 0; index < count; index += 1) {
      const angle = index * 2.399963229728653 + this.windPhase;
      const distance = radius * (0.2 + (index % 3) * 0.16);
      const size = Math.max(1, radius * 0.055);
      context.fillRect(
        Math.cos(angle) * distance,
        Math.sin(angle) * distance,
        size,
        size
      );
    }
    context.restore();
  }

  drawLeafCircle(context, x, y, radius, color) {
    context.fillStyle = color;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
}
