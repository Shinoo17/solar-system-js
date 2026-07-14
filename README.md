# Solar System Explorer 🪐

An interactive 3D solar system experience built with Three.js. Explore the Sun, planets, the Moon, and Pluto through individual scenes with realistic textures, lighting, axial tilts, atmospheres, and ring systems.

Each celestial body is a standalone page, while the main page provides a lightweight navigator for moving between them.

## Features

- Interactive 3D views of the Sun, planets, the Moon, and Pluto
- Drag a celestial body to rotate it
- Drag empty space to orbit the camera
- Scroll or pinch to zoom
- Realistic axial tilt and automatic rotation
- Day and night lighting with soft terminator lines
- Atmospheric effects for supported planets
- Detailed ring systems for Saturn and Uranus
- Configurable scene settings through `lil-gui`
- Responsive layout with reduced-motion support
- Direct links to each scene through URL hashes, such as `#earth` and `#saturn`

## Included Bodies

- Sun
- Mercury
- Venus
- Earth
- Moon
- Mars
- Jupiter
- Saturn
- Uranus
- Neptune
- Pluto

## Technology

- HTML, CSS, and modern JavaScript modules
- [Three.js](https://threejs.org/) WebGPU renderer
- [Three Shading Language](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language) for selected visual effects
- [OrbitControls](https://threejs.org/docs/#examples/en/controls/OrbitControls) for camera interaction
- [lil-gui](https://lil-gui.georgealways.com/) for scene controls

The project does not require a build tool or package installation. Dependencies are loaded from a CDN through browser import maps.

## Getting Started

Texture files are loaded by JavaScript, so the project must be opened through a local web server. Opening `index.html` directly with `file://` will not work in most browsers.

### Option 1: Using Node.js

From the project directory, run:

```bash
npx serve .
```

Open the local URL shown in the terminal.

### Option 2: Using Python

```bash
python3 -m http.server 8000
```

Then visit:

```text
http://localhost:8000
```

## Controls

| Action | Mouse | Touch |
| --- | --- | --- |
| Rotate a body | Drag directly on the body | Drag directly on the body |
| Orbit the camera | Drag empty space | Drag empty space |
| Zoom | Mouse wheel | Pinch |
| Change scene | Use the bottom navigation | Use the bottom navigation |
| Adjust settings | Open the control panel | Open the control panel |

## Project Structure

```text
solar-system/
├── index.html          # Main navigator and iframe container
├── index.css           # Navigator and loading-screen styles
├── index.js            # Scene list and page switching
├── earth/
│   ├── earth.html
│   ├── earth.css
│   ├── earth.js
│   └── texture/
├── saturn/
├── uranus/
└── ...                 # One standalone folder per celestial body
```

Every body follows the same basic convention:

```text
<body-name>/<body-name>.html
<body-name>/<body-name>.css
<body-name>/<body-name>.js
<body-name>/texture/
```

The navigator uses this convention to load a page automatically:

```js
viewer.src = `${body.id}/${body.id}.html`;
```

## Adding Another Celestial Body

1. Create a folder using the body's lowercase name.
2. Add matching HTML, CSS, and JavaScript files.
3. Place the required images inside its `texture` folder.
4. Add the body to the `BODIES` array in `index.js`.

Example:

```js
{ id: "ceres", label: "Ceres", color: "#c8c2b8" }
```

The navigator will then load `ceres/ceres.html` and make it available through `#ceres`.

## Browser Support

A recent browser with WebGPU or WebGL2 support is recommended. Visual quality and performance depend on the device, browser, texture resolution, and GPU.

If a scene does not load:

- Confirm that the project is running through a local server.
- Check that the texture paths and filenames match exactly.
- Update the browser to a recent version.
- Check the browser console for WebGPU, WebGL, or texture-loading errors.

## Performance Notes

Several detailed scenes use high-resolution textures. On devices with limited memory, loading may take longer or use significant GPU memory. Smaller texture variants are recommended for overview scenes or mobile-focused versions.

## Assets and Attribution

Before publishing or redistributing the project, document the source and license of every planet texture and other external asset. Only include assets that permit use and redistribution.

## License

No license is currently included in this repository. Add a license file before granting permission for others to copy, modify, or redistribute the project.
