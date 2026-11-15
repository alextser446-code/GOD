function smoothStep(start, end, value) {
  const amount = Math.min(1, Math.max(0, (value - start) / (end - start)));
  return amount * amount * (3 - 2 * amount);
}

export class LevelOfDetail {
  constructor() {
    this.profile = {
      ground: {
        surface: 0
      },
      vegetation: {
        blades: 0,
        clumps: 0,
        flowers: 0,
        flowerDetails: 0,
        wildPlants: 0
      },
      trees: {
        canopy: 0,
        highlights: 0,
        trunk: 0,
        wind: 0
      },
      wind: {
        grass: 0,
        flowers: 0,
        plants: 0,
        trees: 0
      },
      objects: {
        people: { simple: 0, full: 0 },
        buildings: { simple: 0, full: 0 },
        animals: { simple: 0, full: 0 },
        resources: { simple: 0, full: 0 }
      }
    };
  }

  update(zoom) {
    const { ground, vegetation, trees, objects } = this.profile;

    ground.surface = smoothStep(0.45, 0.75, zoom);

    vegetation.blades = smoothStep(0.55, 1.2, zoom);
    vegetation.clumps = smoothStep(0.65, 1.3, zoom);
    vegetation.flowers = smoothStep(0.5, 0.9, zoom);
    vegetation.flowerDetails = smoothStep(0.9, 1.45, zoom);
    vegetation.wildPlants = smoothStep(0.75, 1.4, zoom);

    trees.canopy = smoothStep(0.45, 1.2, zoom);
    trees.highlights = smoothStep(0.8, 1.5, zoom);
    trees.trunk = smoothStep(0.85, 1.4, zoom);

    objects.people.simple = smoothStep(0.3, 0.55, zoom);
    objects.people.full = smoothStep(0.75, 1.25, zoom);

    objects.buildings.simple = smoothStep(0.25, 0.5, zoom);
    objects.buildings.full = smoothStep(0.7, 1.2, zoom);

    objects.animals.simple = smoothStep(0.3, 0.55, zoom);
    objects.animals.full = smoothStep(0.75, 1.25, zoom);

    objects.resources.simple = smoothStep(0.35, 0.6, zoom);
    objects.resources.full = smoothStep(0.8, 1.3, zoom);

    const wind = this.profile.wind;

    wind.grass = smoothStep(0.65, 1.2, zoom);
    wind.flowers = smoothStep(0.55, 1.05, zoom);
    wind.plants = smoothStep(0.65, 1.15, zoom);
    wind.trees = smoothStep(0.35, 0.85, zoom);
    trees.wind = wind.trees;

    return this.profile;
  }
}
