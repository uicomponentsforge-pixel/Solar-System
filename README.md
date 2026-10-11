# Helios · 3D Solar System Explorer

**Helios** is an interactive, web-based 3D Solar System explorer built with JavaScript and [Three.js](https://threejs.org/). It features procedurally generated textures, dual scale visualization models, realistic orbital mechanics, lighting effects, atmospheric shaders, and a celestial body comparison tool.

---

## 🌟 Key Features

- **Procedural Graphics & Textures:** All planetary and lunar textures, surface noise, bump details, cloud layers, and rings are generated procedurally on HTML5 Canvas without relying on external image assets.
- **Dual Scale Modes:**
  - **Educational Scale:** Enlarges celestial bodies and uses smooth distance mapping so that inner and outer planets, moons, and comets remain clearly visible simultaneously.
  - **Relative Scale:** Uses true relative size ratios and true distance ratios (AU) to convey realistic spatial proportions.
- **Rich Astronomical Data:** Interactive 3D visualization of the Sun, all 8 major planets, dwarf planets (Ceres, Pluto, Eris, Haumea, Makemake), major moons (e.g. Moon, Io, Europa, Ganymede, Titan, Enceladus, Triton), comets (e.g. Halley, Hale-Bopp, 67P), the Asteroid Belt, Kuiper Belt, and Oort Cloud.
- **World Comparison Tool:** Compare any two planets or dwarf planets side-by-side with proportional relative visual size models and physical/orbital statistics (diameter, mass, gravity, orbital period, temperature, etc.).
- **Camera & Navigation Controls:**
  - **Free & Follow Camera Modes:** Smoothly orbit, pan, and zoom around any object or follow selected celestial bodies in motion.
  - **Quick Jump & Instant Search:** Real-time search bar with auto-complete and navigation quick-jump buttons for fast access to major worlds.
- **Interactive Dock & Simulation Speed:** Pause/play the orbital simulation and adjust simulation speed from 0.05× up to 400× speed.
- **Customizable Visibility Layers:** Toggle orbit paths, labels, moons, asteroid belt, comets, Kuiper belt, and Oort cloud on or off.

---

## 🎮 Controls & Interaction

### Mouse & Touch
- **Left-Click / Drag:** Orbit camera around the current focus target.
- **Right-Click / Shift + Drag / Two-Finger Drag:** Pan camera across space.
- **Scroll Wheel / Pinch Gesture:** Zoom camera in and out.
- **Click / Tap Object:** Select and inspect a celestial body.

### Keyboard Shortcuts
- `Space`: Play / Pause orbital simulation
- `Arrow Keys`: Orbit camera left, right, up, or down
- `W` / `S` or `+` / `-`: Zoom camera in / out
- `A` / `D`: Pan camera left / right
- `F`: Focus camera on selected object
- `R`: Reset camera to default Solar System overview
- `/`: Focus search bar
- `Esc`: Close modals, search results, or deselect active object

---

## 🛠️ Technology Stack

- **HTML5 & CSS3:** Responsive UI with frosted glass design (`backdrop-filter`), modal dialogs, controls dock, and adaptive layout for desktop and mobile.
- **JavaScript (ES6+):** Pure vanilla JavaScript module design without external build tools.
- **Three.js (r128):** WebGL 3D rendering library used for scene graphs, custom vertex and fragment shaders (atmosphere lighting and sun surface noise), lighting, and particle systems.

---

## 🚀 Getting Started

Since Helios is a client-side WebGL web application with zero external build steps or compiler dependencies, running it locally is straightforward:

1. **Clone or Download the Repository:**
   ```bash
   git clone <repository-url>
   cd <repository-directory>
   ```

2. **Open in Browser:**
   Open `index.html` directly in any modern WebGL-compatible web browser (Chrome, Firefox, Safari, Edge):
   ```bash
   # Linux / macOS
   open index.html  # or xdg-open index.html

   # Or run a local HTTP server (recommended for CORS / WebGL consistency):
   npx serve .
   # or
   python3 -m http.server 8000
   ```

3. Navigate to `http://localhost:8000` (if using a local HTTP server) and enjoy exploring the Solar System!

---

## 📂 Project Structure

```
.
├── index.html   # Main HTML entry point, UI layout, modals, and CDN script tags
├── style.css    # CSS styling, frosted glass UI, responsive layout, and animations
├── script.js   # Application logic, procedural texture generators, 3D scene, shaders, and controls
└── README.md    # Project documentation
```
