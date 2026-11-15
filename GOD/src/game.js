"use strict";

import { Camera } from "./camera/camera.js";
import { LevelOfDetail } from "./render/levelOfDetail.js";
import { TreeManager } from "./trees/treeManager.js";
import { WindSystem } from "./wind/windSystem.js";
import { HumanManager } from "./humans/humanManager.js";
import { HumanSocialSystem } from "./humans/humanSocialSystem.js";
import { FamilySystem } from "./humans/familySystem.js";
import { VillageSystem } from "./villages/villageSystem.js";
import { WoodcutterSystem } from "./forestry/woodcutterSystem.js";
import { VillageDevelopmentSystem } from "./villages/villageDevelopmentSystem.js";
import { FoodSystem } from "./food/foodSystem.js";
import { FarmSystem } from "./farming/farmSystem.js";
import { BirdSystem } from "./ambience/birdSystem.js";

const world = document.querySelector("#world");
const canvas = document.querySelector("#world-canvas");
const fullscreenButton = document.querySelector("#fullscreen-button");
const viewVillageButton = document.querySelector("#view-village-button");
const humanMenu = document.querySelector("#human-menu");
const humanAmountInput = document.querySelector("#human-amount");
const spawnHumanButton = document.querySelector("#spawn-human-button");
const humanSpawnStatus = document.querySelector("#human-spawn-status");
const simulationSpeedButtons = document.querySelectorAll(".simulation-speed-button");
const context = canvas.getContext("2d");
const treeManager = new TreeManager();
const camera = new Camera();
const levelOfDetail = new LevelOfDetail();
const windSystem = new WindSystem();
const humanManager = new HumanManager();
const humanSocialSystem = new HumanSocialSystem();
const familySystem = new FamilySystem();
const villageSystem = new VillageSystem();
const woodcutterSystem = new WoodcutterSystem();
const villageDevelopmentSystem = new VillageDevelopmentSystem();
const foodSystem = new FoodSystem();
const farmSystem = new FarmSystem();
const birdSystem = new BirdSystem();

let humanSpawnMode = false;
let pendingHumanCount = 0;
let simulationSpeed = 1;

const grassColor = "#4f8f3a";
const chunkSize = 64;
const maxCachedChunks = 768;
const detailCullPadding = 10;

const flowerColors = [
  "#f2df82",
  "#e7b6b6",
  "#eee8d5",
  "#c9b6dc"
];

const chunkCache = new Map();
let cameraAnimationFrame = null;
let lastAnimationTimestamp = 0;
let lastDrawTimestamp = 0;

function createRandom(seed) {
  let value = seed >>> 0;

  return function random() {
    value += 0x6d2b79f5;

    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);

    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function getChunkSeed(chunkX, chunkY) {
  let seed = Math.imul(chunkX, 374761393);
  seed += Math.imul(chunkY, 668265263);
  seed = Math.imul(seed ^ (seed >>> 13), 1274126177);

  return (seed ^ (seed >>> 16)) >>> 0;
}

function getWindPhase(x, y) {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return (value - Math.floor(value)) * Math.PI * 2;
}

function overlapsVisibleArea(x, y, padding, visible) {
  return (
    x + padding >= visible.left &&
    x - padding <= visible.right &&
    y + padding >= visible.top &&
    y - padding <= visible.bottom
  );
}

function createChunkData(chunkX, chunkY) {
  const random = createRandom(getChunkSeed(chunkX, chunkY));
  const left = chunkX * chunkSize;
  const top = chunkY * chunkSize;
  const data = {
    surface: [],
    blades: [],
    clumps: [],
    flower: null,
    wildPlant: null
  };

  const surfaceCount = 2 + Math.floor(random() * 4);

  for (let index = 0; index < surfaceCount; index += 1) {
    data.surface.push({
      x: left + random() * chunkSize,
      y: top + random() * chunkSize,
      radius: 2 + random() * 5,
      color: random() > 0.5
        ? "rgba(133, 174, 76, 0.10)"
        : "rgba(38, 104, 45, 0.07)"
    });
  }

  const bladeCount = 7 + Math.floor(random() * 8);

  for (let index = 0; index < bladeCount; index += 1) {
    const x = left + random() * chunkSize;
    const y = top + random() * chunkSize;
    const length = 2 + random() * 3.5;

    data.blades.push({
      x,
      y,
      endX: x + (random() - 0.5) * length,
      endY: y - length * (0.65 + random() * 0.35),
      color: random() > 0.5 ? "#2f7135" : "#78a94d",
      width: 0.7 + random() * 0.45
    });
  }

  if (random() < 0.38) {
    const centerX = left + random() * chunkSize;
    const centerY = top + random() * chunkSize;
    const clump = [];

    for (let blade = 0; blade < 3; blade += 1) {
      const x = centerX + (random() - 0.5) * 5;
      const y = centerY + random() * 3;
      const length = 3 + random() * 2.5;

      clump.push({
        x,
        y,
        endX: x + (random() - 0.5) * length,
        endY: y - length * (0.65 + random() * 0.35),
        color: random() > 0.5 ? "#397a39" : "#82ad51"
      });
    }

    data.clumps.push(clump);
  }

  if (random() <= 0.18) {
    data.flower = {
      x: left + 5 + random() * (chunkSize - 10),
      y: top + 5 + random() * (chunkSize - 10),
      radius: 0.9 + random() * 0.55,
      color: flowerColors[Math.floor(random() * flowerColors.length)]
    };
  }

  if (random() <= 0.09) {
    const x = left + 5 + random() * (chunkSize - 10);
    const y = top + 5 + random() * (chunkSize - 10);

    data.wildPlant = { x, y };
  }

  return data;
}

function getChunkData(chunkX, chunkY) {
  const key = `${chunkX},${chunkY}`;
  const cached = chunkCache.get(key);

  if (cached) {
    // Erneutes Setzen verschiebt den Eintrag ans Ende der Map.
    chunkCache.delete(key);
    chunkCache.set(key, cached);
    return cached;
  }

  if (chunkCache.size >= maxCachedChunks) {
    const oldestKey = chunkCache.keys().next().value;
    chunkCache.delete(oldestKey);
  }

  const data = createChunkData(chunkX, chunkY);
  chunkCache.set(key, data);

  return data;
}

function drawBlade(blade, windAmount, visible, chunkFullyVisible) {
  if (
    !chunkFullyVisible &&
    !overlapsVisibleArea(blade.x, blade.y, detailCullPadding, visible)
  ) {
    return;
  }

  const sway = windSystem.getSway(
    getWindPhase(blade.x, blade.y),
    0.8,
    windAmount
  ) * 5;

  context.beginPath();
  context.moveTo(blade.x, blade.y);
  context.lineTo(
    blade.endX + windSystem.state.directionX * sway,
    blade.endY + windSystem.state.directionY * sway
  );
  context.strokeStyle = blade.color;
  context.lineWidth = blade.width ?? 0.8;
  context.lineCap = "round";
  context.stroke();
}

function drawSurface(data, amount, visible, chunkFullyVisible) {
  const visibleCount = data.surface.length * amount;

  for (let index = 0; index < data.surface.length && index < visibleCount; index += 1) {
    const spot = data.surface[index];

    if (
      !chunkFullyVisible &&
      !overlapsVisibleArea(spot.x, spot.y, spot.radius, visible)
    ) {
      continue;
    }

    const alpha = Math.min(1, visibleCount - index);

    if (alpha < 1) {
      context.save();
      context.globalAlpha = alpha;
    }

    context.fillStyle = spot.color;
    context.beginPath();
    context.arc(spot.x, spot.y, spot.radius, 0, Math.PI * 2);
    context.fill();

    if (alpha < 1) {
      context.restore();
    }
  }
}

function drawBlades(data, amount, windAmount, visible, chunkFullyVisible) {
  const visibleCount = data.blades.length * amount;

  for (let index = 0; index < data.blades.length && index < visibleCount; index += 1) {
    const alpha = Math.min(1, visibleCount - index);

    if (alpha < 1) {
      context.save();
      context.globalAlpha = alpha;
    }

    drawBlade(data.blades[index], windAmount, visible, chunkFullyVisible);

    if (alpha < 1) {
      context.restore();
    }
  }
}

function drawClumps(data, amount, windAmount, visible, chunkFullyVisible) {
  const visibleCount = data.clumps.length * amount;

  for (let index = 0; index < data.clumps.length && index < visibleCount; index += 1) {
    const alpha = Math.min(1, visibleCount - index);

    if (alpha < 1) {
      context.save();
      context.globalAlpha = alpha;
    }

    for (const blade of data.clumps[index]) {
      drawBlade(blade, windAmount, visible, chunkFullyVisible);
    }

    if (alpha < 1) {
      context.restore();
    }
  }
}

function drawFlower(flower, amount, detailAmount, windAmount, visible, chunkFullyVisible) {
  if (!flower || amount <= 0) {
    return;
  }

  if (
    !chunkFullyVisible &&
    !overlapsVisibleArea(flower.x, flower.y, 5, visible)
  ) {
    return;
  }

  const sway = windSystem.getSway(
    getWindPhase(flower.x, flower.y),
    0.65,
    windAmount
  );

  context.save();
  context.translate(
    windSystem.state.directionX * sway * 4,
    windSystem.state.directionY * sway * 4
  );
  context.globalAlpha = amount;

  if (detailAmount > 0) {
    context.globalAlpha *= detailAmount;
    context.fillStyle = "#d8d0a0";
    context.fillRect(flower.x - 0.35, flower.y, 0.7, 2.5);
  }

  context.globalAlpha = amount;
  context.fillStyle = flower.color;
  context.beginPath();
  context.arc(
    flower.x,
    flower.y,
    0.65 + flower.radius * 0.5 * detailAmount,
    0,
    Math.PI * 2
  );
  context.fill();
  context.restore();
}

function drawWildPlant(plant, amount, windAmount, visible, chunkFullyVisible) {
  if (!plant || amount <= 0) {
    return;
  }

  if (
    !chunkFullyVisible &&
    !overlapsVisibleArea(plant.x, plant.y, 4, visible)
  ) {
    return;
  }

  const sway = windSystem.getSway(
    getWindPhase(plant.x, plant.y),
    0.55,
    windAmount
  );

  context.save();
  context.translate(
    windSystem.state.directionX * sway * 2,
    windSystem.state.directionY * sway * 2
  );
  context.globalAlpha = amount;
  context.strokeStyle = "#477d38";
  context.lineWidth = 1;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(plant.x, plant.y + 2);
  context.lineTo(plant.x, plant.y - 2);
  context.moveTo(plant.x, plant.y);
  context.lineTo(plant.x - 2, plant.y - 1);
  context.moveTo(plant.x, plant.y - 0.5);
  context.lineTo(plant.x + 2, plant.y - 2);
  context.stroke();
  context.restore();
}

function drawChunk(chunkX, chunkY, profile, visible) {
  const data = getChunkData(chunkX, chunkY);
  const left = chunkX * chunkSize;
  const top = chunkY * chunkSize;
  const right = left + chunkSize;
  const bottom = top + chunkSize;
  const chunkFullyVisible =
    left >= visible.left + detailCullPadding &&
    top >= visible.top + detailCullPadding &&
    right <= visible.right - detailCullPadding &&
    bottom <= visible.bottom - detailCullPadding;

  drawSurface(data, profile.ground.surface, visible, chunkFullyVisible);
  drawBlades(
    data,
    profile.vegetation.blades,
    profile.wind.grass,
    visible,
    chunkFullyVisible
  );
  drawClumps(
    data,
    profile.vegetation.clumps,
    profile.wind.grass,
    visible,
    chunkFullyVisible
  );
  drawFlower(
    data.flower,
    profile.vegetation.flowers,
    profile.vegetation.flowerDetails,
    profile.wind.flowers,
    visible,
    chunkFullyVisible
  );
  drawWildPlant(
    data.wildPlant,
    profile.vegetation.wildPlants,
    profile.wind.plants,
    visible,
    chunkFullyVisible
  );
}

function drawDayNightOverlay(width, height, visible) {
  const nightAmount = 1 - villageDevelopmentSystem.daylight;

  if (nightAmount > 0.01) {
    context.fillStyle = `rgba(10, 18, 44, ${nightAmount * 0.58})`;
    context.fillRect(0, 0, width, height);

    context.save();
    camera.applyToContext(context);
    villageDevelopmentSystem.drawNightLights(context, visible);
    context.restore();
  }

  context.save();
  context.fillStyle = "rgba(24, 29, 26, 0.82)";
  context.fillRect(12, 12, 88, 32);

  if (villageDevelopmentSystem.isNight) {
    context.fillStyle = "#e5e9f1";
    context.beginPath();
    context.arc(29, 28, 7, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#252d35";
    context.beginPath();
    context.arc(33, 25, 6, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#f0eee5";
    context.font = "600 14px system-ui, sans-serif";
    context.fillText("Night", 43, 33);
  } else {
    context.fillStyle = "#f2c95c";
    context.beginPath();
    context.arc(29, 28, 6, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#f2c95c";
    context.lineWidth = 2;

    for (let ray = 0; ray < 8; ray += 1) {
      const angle = (Math.PI * 2 * ray) / 8;
      context.beginPath();
      context.moveTo(29 + Math.cos(angle) * 8, 28 + Math.sin(angle) * 8);
      context.lineTo(29 + Math.cos(angle) * 10, 28 + Math.sin(angle) * 10);
      context.stroke();
    }

    context.fillStyle = "#fff2cf";
    context.font = "600 14px system-ui, sans-serif";
    context.fillText("Day", 43, 33);
  }

  context.restore();
}

function drawWorld() {
  const bounds = world.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);

  const pixelWidth = Math.round(width * pixelRatio);
  const pixelHeight = Math.round(height * pixelRatio);

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.fillStyle = grassColor;
  context.fillRect(0, 0, width, height);

  treeManager.setWorldSize(width, height);
  foodSystem.setWorldSize(width, height, treeManager);
  const profile = levelOfDetail.update(camera.zoom);
  const visible = camera.getVisibleBounds(width, height);

  context.save();
  camera.applyToContext(context);

  const drawGroundDetails =
    profile.ground.surface > 0 ||
    profile.vegetation.blades > 0 ||
    profile.vegetation.clumps > 0 ||
    profile.vegetation.flowers > 0 ||
    profile.vegetation.wildPlants > 0;

  if (drawGroundDetails) {
    const firstChunkX = Math.floor(visible.left / chunkSize);
    const firstChunkY = Math.floor(visible.top / chunkSize);
    const lastChunkX = Math.floor(visible.right / chunkSize);
    const lastChunkY = Math.floor(visible.bottom / chunkSize);

    for (let chunkY = firstChunkY; chunkY <= lastChunkY; chunkY += 1) {
      for (let chunkX = firstChunkX; chunkX <= lastChunkX; chunkX += 1) {
        drawChunk(chunkX, chunkY, profile, visible);
      }
    }
  }

  villageSystem.drawTerritory(context, camera.zoom);
  treeManager.draw(context, visible, profile.trees, windSystem);
  foodSystem.draw(context, visible, villageSystem.currentVillage, camera.zoom);
  woodcutterSystem.drawGround(context, villageSystem);
  farmSystem.draw(context, visible, villageDevelopmentSystem.buildings, windSystem);
  villageDevelopmentSystem.draw(context, villageSystem, camera.zoom);
  farmSystem.drawWindmills(
    context,
    visible,
    villageDevelopmentSystem.buildings,
    windSystem
  );
  humanManager.draw(context, profile.objects.people);
  birdSystem.draw(context, visible, camera.zoom);
  woodcutterSystem.drawCarriedWood(
    context,
    humanManager.humans,
    camera.zoom
  );
  humanSocialSystem.draw(context, humanManager.humans, camera.zoom);
  villageSystem.drawIndicators(context, camera.zoom, humanManager.humans);
  context.restore();
  drawDayNightOverlay(width, height, visible);
}

function updateSimulation(deltaSeconds) {
  const scaledDelta = deltaSeconds * simulationSpeed;
  const maxStep = simulationSpeed >= 100 ? 0.1 : 0.05;
  const stepCount = Math.max(1, Math.ceil(scaledDelta / maxStep));
  const stepDelta = scaledDelta / stepCount;

  for (let step = 0; step < stepCount; step += 1) {
    windSystem.update(stepDelta);
    humanManager.update(stepDelta);
    humanSocialSystem.update(stepDelta, humanManager.humans);
    villageSystem.update(stepDelta, humanManager.humans);
    woodcutterSystem.update(
      stepDelta,
      humanManager.humans,
      villageSystem,
      treeManager
    );
    villageDevelopmentSystem.update(
      stepDelta,
      humanManager.humans,
      villageSystem,
      treeManager,
      woodcutterSystem
    );
    familySystem.update(
      stepDelta,
      humanManager,
      villageSystem.currentVillage,
      villageDevelopmentSystem
    );
    foodSystem.update(
      stepDelta,
      humanManager.humans,
      villageSystem.currentVillage,
      villageDevelopmentSystem.isNight
    );
    farmSystem.update(
      stepDelta,
      humanManager.humans,
      villageSystem.currentVillage,
      villageDevelopmentSystem,
      villageDevelopmentSystem.isNight
    );
  }

  viewVillageButton.disabled = !villageSystem.currentVillage;
}

function animateCamera(timestamp) {
  const deltaSeconds = lastAnimationTimestamp === 0
    ? 0
    : Math.min((timestamp - lastAnimationTimestamp) / 1000, 0.1);

  lastAnimationTimestamp = timestamp;

  camera.update();
  const bounds = world.getBoundingClientRect();
  const visible = camera.getVisibleBounds(bounds.width, bounds.height);
  birdSystem.update(deltaSeconds, visible, camera.zoom);
  updateSimulation(deltaSeconds);

  const frameInterval = camera.zoom < 0.5 ? 66 : 33;

  if (timestamp - lastDrawTimestamp >= frameInterval) {
    drawWorld();
    lastDrawTimestamp = timestamp;
  }

  cameraAnimationFrame = window.requestAnimationFrame(animateCamera);
}

function requestCameraAnimation() {
  if (cameraAnimationFrame === null) {
    cameraAnimationFrame = window.requestAnimationFrame(animateCamera);
  }
}

function getWorldPoint(clientX, clientY) {
  const bounds = world.getBoundingClientRect();

  return {
    x: clientX - bounds.left,
    y: clientY - bounds.top
  };
}

function setHumanMenuOpen(isOpen) {
  humanMenu.classList.toggle("is-open", isOpen);
  humanMenu.setAttribute("aria-hidden", String(!isOpen));
  humanMenu.inert = !isOpen;

  if (!isOpen) {
    if (humanMenu.contains(document.activeElement)) {
      document.activeElement.blur();
    }

    humanSpawnMode = false;
    pendingHumanCount = 0;
    humanSpawnStatus.hidden = true;
  }
}

function handleKeyDown(event) {
  if (event.key !== "Tab") {
    return;
  }

  event.preventDefault();

  const menuIsOpen = humanMenu.classList.contains("is-open");
  setHumanMenuOpen(!menuIsOpen);
}

function handleSpawnButtonClick() {
  if (!humanAmountInput.checkValidity()) {
    humanAmountInput.reportValidity();
    return;
  }

  const amount = humanAmountInput.valueAsNumber;

  if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
    humanAmountInput.reportValidity();
    return;
  }

  pendingHumanCount = amount;
  humanSpawnMode = true;
  humanSpawnStatus.hidden = false;
}

function handleWorldClick(event) {
  if (
    !humanSpawnMode ||
    event.button !== 0 ||
    event.target !== canvas
  ) {
    return;
  }

  const screenPoint = getWorldPoint(event.clientX, event.clientY);
  const worldX = (screenPoint.x - camera.offsetX) / camera.zoom;
  const worldY = (screenPoint.y - camera.offsetY) / camera.zoom;

  const spawnedHumans = humanManager.spawnAt(
    worldX,
    worldY,
    pendingHumanCount
  );
  villageSystem.registerSpawnedHumans(spawnedHumans, humanManager.humans);

  humanAmountInput.value = "";
  setHumanMenuOpen(false);
  drawWorld();
}

function handleWheel(event) {
  event.preventDefault();

  const point = getWorldPoint(event.clientX, event.clientY);
  camera.zoomAt(point.x, point.y, event.deltaY);
  requestCameraAnimation();
}

function handleMouseDown(event) {
  if (event.button !== 1) {
    return;
  }

  event.preventDefault();

  const point = getWorldPoint(event.clientX, event.clientY);
  camera.beginPan(point.x, point.y);
  requestCameraAnimation();
}

function handleMouseMove(event) {
  if (!camera.isPanning) {
    return;
  }

  event.preventDefault();

  const point = getWorldPoint(event.clientX, event.clientY);
  camera.movePan(point.x, point.y);
  requestCameraAnimation();
}

function handleMouseUp(event) {
  if (!camera.isPanning || event.button !== 1) {
    return;
  }

  event.preventDefault();
  camera.endPan();
  requestCameraAnimation();
}

function stopPanning() {
  if (camera.isPanning) {
    camera.endPan();
    requestCameraAnimation();
  }
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (world.requestFullscreen) {
      await world.requestFullscreen();
    }
  } catch (error) {
    console.error("Could not change fullscreen mode.", error);
  }
}

function updateFullscreenButton() {
  const isFullscreen = Boolean(document.fullscreenElement);

  fullscreenButton.textContent = isFullscreen ? "Exit Fullscreen" : "Fullscreen";
  fullscreenButton.setAttribute(
    "aria-label",
    isFullscreen ? "Exit fullscreen mode" : "Enter fullscreen mode"
  );

  drawWorld();
}

function handleSimulationSpeedClick(event) {
  const button = event.target.closest(".simulation-speed-button");

  if (!button) {
    return;
  }

  simulationSpeed = Number(button.dataset.speed);

  simulationSpeedButtons.forEach((speedButton) => {
    const isActive = speedButton === button;
    speedButton.classList.toggle("is-active", isActive);
    speedButton.setAttribute("aria-pressed", String(isActive));
  });
}

window.addEventListener("keydown", handleKeyDown);
world.addEventListener("click", handleWorldClick);
spawnHumanButton.addEventListener("click", handleSpawnButtonClick);
world.addEventListener("wheel", handleWheel, { passive: false });
world.addEventListener("mousedown", handleMouseDown);
world.addEventListener("auxclick", (event) => {
  if (event.button === 1) {
    event.preventDefault();
  }
});

window.addEventListener("mousemove", handleMouseMove);
window.addEventListener("mouseup", handleMouseUp);
window.addEventListener("blur", stopPanning);

fullscreenButton.addEventListener("click", toggleFullscreen);
document.querySelector("#simulation-speed").addEventListener(
  "click",
  handleSimulationSpeedClick
);
viewVillageButton.addEventListener("click", () => {
  const isVisible = villageSystem.toggleTerritory();
  viewVillageButton.setAttribute("aria-pressed", String(isVisible));
  drawWorld();
});
document.addEventListener("fullscreenchange", updateFullscreenButton);
window.addEventListener("resize", drawWorld);

drawWorld();
requestCameraAnimation();
