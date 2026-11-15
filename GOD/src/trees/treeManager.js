import { Tree } from "./tree.js";
import { TREE_TYPES } from "./treeTypes.js";

export class TreeManager {
  constructor() {
    this.trees = [];
    this.nextId = 1;
    this.worldWidth = 0;
    this.worldHeight = 0;
    this.spacing = 34;
    this.cellSize = 128;
    this.grid = new Map();
    this.landUseCheck = null;
  }

  setLandUseCheck(check) {
    this.landUseCheck = typeof check === "function" ? check : null;
  }

  setWorldSize(width, height) {
    if (width === this.worldWidth && height === this.worldHeight) {
      return;
    }

    this.worldWidth = width;
    this.worldHeight = height;

    this.trees = this.trees.filter((tree) => {
      const margin = tree.radius + 3;

      return (
        tree.x >= margin &&
        tree.y >= margin &&
        tree.x <= width - margin &&
        tree.y <= height - margin
      );
    });

    this.rebuildGrid();
    this.fillWorld();
  }

  getCell(x, y, create = false) {
    const cellX = Math.floor(x / this.cellSize);
    const cellY = Math.floor(y / this.cellSize);

    let row = this.grid.get(cellY);

    if (!row && create) {
      row = new Map();
      this.grid.set(cellY, row);
    }

    if (!row) {
      return null;
    }

    let cell = row.get(cellX);

    if (!cell && create) {
      cell = [];
      row.set(cellX, cell);
    }

    return cell ?? null;
  }

  insertIntoGrid(tree) {
    this.getCell(tree.x, tree.y, true).push(tree);
  }

  rebuildGrid() {
    this.grid.clear();

    for (const tree of this.trees) {
      this.insertIntoGrid(tree);
    }
  }

  fillWorld() {
    const targetCount = Math.floor(
      (this.worldWidth * this.worldHeight) / 22000
    );

    let attempts = 0;
    const maxAttempts = Math.max(100, targetCount * 30);

    while (this.trees.length < targetCount && attempts < maxAttempts) {
      attempts += 1;

      const typeNames = Object.keys(TREE_TYPES);
      const type = typeNames[Math.floor(Math.random() * typeNames.length)];
      const treeType = TREE_TYPES[type];
      const scale = 0.88 + Math.random() * 0.24;
      const radius = treeType.size * scale;
      const margin = radius + 3;

      if (
        this.worldWidth <= margin * 2 ||
        this.worldHeight <= margin * 2
      ) {
        return;
      }

      const x = margin + Math.random() * (this.worldWidth - margin * 2);
      const y = margin + Math.random() * (this.worldHeight - margin * 2);

      if (!this.hasRoomAt(x, y, radius)) {
        continue;
      }

      if (this.landUseCheck && !this.landUseCheck(x, y, radius)) {
        continue;
      }

      const tree = new Tree(
        `tree-${this.nextId}`,
        x,
        y,
        type,
        {
          scale,
          colorIndex: Math.floor(Math.random() * treeType.leafColors.length)
        }
      );

      this.nextId += 1;
      this.trees.push(tree);
      this.insertIntoGrid(tree);
    }
  }

  hasRoomAt(x, y, radius) {
    return this.trees.every((tree) => {
      const dx = tree.x - x;
      const dy = tree.y - y;
      const minimumDistance = Math.max(
        this.spacing,
        radius + tree.radius + 8
      );

      return dx * dx + dy * dy >= minimumDistance * minimumDistance;
    });
  }

  createTree(x, y, type, variation = {}) {
    if (!TREE_TYPES[type]) {
      throw new Error(`Unknown tree type: ${type}`);
    }

    const treeType = TREE_TYPES[type];
    const scale = variation.scale ?? (0.88 + Math.random() * 0.24);
    const radius = treeType.size * scale;
    const margin = radius + 3;

    if (
      x < margin ||
      y < margin ||
      x > this.worldWidth - margin ||
      y > this.worldHeight - margin ||
      !this.hasRoomAt(x, y, radius) ||
      (this.landUseCheck && !this.landUseCheck(x, y, radius))
    ) {
      return null;
    }

    const tree = new Tree(
      `tree-${this.nextId}`,
      x,
      y,
      type,
      {
        ...variation,
        scale,
        colorIndex: variation.colorIndex ??
          Math.floor(Math.random() * treeType.leafColors.length)
      }
    );

    this.nextId += 1;
    this.trees.push(tree);
    this.insertIntoGrid(tree);

    return tree;
  }

  removeTree(id) {
    const index = this.trees.findIndex((tree) => tree.id === id);

    if (index === -1) {
      return false;
    }

    const [tree] = this.trees.splice(index, 1);
    const cell = this.getCell(tree.x, tree.y);

    if (cell) {
      const cellIndex = cell.indexOf(tree);

      if (cellIndex !== -1) {
        cell.splice(cellIndex, 1);
      }
    }

    return true;
  }

  getTreesInRadius(x, y, radius) {
    const radiusSquared = radius * radius;

    return this.trees.filter((tree) => {
      const dx = tree.x - x;
      const dy = tree.y - y;
      const combinedRadius = radius + tree.radius;
      return dx * dx + dy * dy <= combinedRadius * combinedRadius;
    });
  }

  draw(context, visibleBounds, detail, windSystem) {
    const margin = 24;
    const firstCellX = Math.floor(
      (visibleBounds.left - margin) / this.cellSize
    );
    const lastCellX = Math.floor(
      (visibleBounds.right + margin) / this.cellSize
    );
    const firstCellY = Math.floor(
      (visibleBounds.top - margin) / this.cellSize
    );
    const lastCellY = Math.floor(
      (visibleBounds.bottom + margin) / this.cellSize
    );

    for (let cellY = firstCellY; cellY <= lastCellY; cellY += 1) {
      const row = this.grid.get(cellY);

      if (!row) {
        continue;
      }

      for (let cellX = firstCellX; cellX <= lastCellX; cellX += 1) {
        const cell = row.get(cellX);

        if (!cell) {
          continue;
        }

        for (const tree of cell) {
          const visibleRadius = tree.radius + 8;

          if (
            tree.x + visibleRadius < visibleBounds.left ||
            tree.x - visibleRadius > visibleBounds.right ||
            tree.y + visibleRadius < visibleBounds.top ||
            tree.y - visibleRadius > visibleBounds.bottom
          ) {
            continue;
          }

          tree.draw(context, detail, windSystem);
        }
      }
    }
  }
}
