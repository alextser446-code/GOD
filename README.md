# Medieval World Simulation

A small, evolving 2D medieval village simulation. Watch villagers gather resources, build homes and farms, grow food, form families, and develop a settlement on a living grassy world.

> **Work in progress:** Features and balance may change as development continues.

## Download and install

Download and run the Windows installer:

`Medieval-World-Simulation-Setup-1.0.0.exe`

The installer creates a Start menu entry and a desktop shortcut. Open **Medieval World Simulation** from either shortcut after installation.

The installer is currently available in this project at:

`windows-installer/Medieval-World-Simulation-Setup-1.0.0.exe`

## Controls

| Action | Control |
| --- | --- |
| Zoom in or out | Scroll the mouse wheel |
| Keep the pointed world location under the cursor while zooming | Move the wheel over that location |
| Move the camera | Hold the middle mouse button and move the mouse |
| Enter or exit fullscreen | Click **Fullscreen** |
| Open or close the villager menu | Press **Tab** |
| Spawn villagers | Open the menu, choose an amount, click **Spawn**, then click the world |
| Change simulation speed | Click **1x**, **2x**, **5x**, **8x**, **10x**, or **100x** |
| Show or hide village territory | Click **View Village** |

## What is in the game

- A top-down grassy world with natural ground details, trees, and occasional birds.
- Villagers with movement, conversations, relationships, and families.
- Village founding, housing, construction, roads, and settlement expansion.
- Woodcutters, resource gathering, farms, farmers, and food production.
- A day and night cycle, wind, camera zoom, and camera panning.

## System requirements

- Windows 10 or later, 64-bit.
- Internet access is not required to play after installation.

## Development

The game is built with JavaScript, HTML Canvas, and Electron. To run it from source, install Node.js LTS, open this folder in a terminal, and run:

```bash
npm install
npm start
```

To build a Windows installer from source, run:

```bash
npm run dist
```

The installer is written to `windows-installer/`.

## Project structure

```text
electron/       Electron desktop app entry point
src/            Game systems, simulation, rendering, and camera
styles/         Interface styles
index.html      Game interface entry page
```

## Notes

- The installer is not code-signed, so Windows may show a security notice when it is opened.
- The simulation is still being developed; performance and game behavior may vary in larger settlements.

## License

No open-source license has been added yet. All rights remain with the project owner unless a license is added.
