// ============================================================
//  Solar System - index page
//
//  This page is only a navigator. It shows:
//    - a full-screen iframe
//    - a bottom navigation bar
//    - a loading screen while a planet page loads
//
//  Every planet lives in its own folder (earth/, mars/, ...)
//  and is a complete standalone website. This file just points
//  the iframe at the right one.
// ============================================================

// Every body we can show. Each entry knows:
//   id    - folder name and URL hash (#mars)
//   label - text shown in the navigation bar
//   color - accent color used for the dot, glow and loader
const BODIES = [
  { id: "sun",     label: "Sun",     color: "#ffb25e" },
  { id: "mercury", label: "Mercury", color: "#b8b2a8" },
  { id: "venus",   label: "Venus",   color: "#e8c98f" },
  { id: "earth",   label: "Earth",   color: "#6fa8ff" },
  { id: "moon",    label: "Moon",    color: "#cdd2da" },
  { id: "mars",    label: "Mars",    color: "#ff8a5f" },
  { id: "jupiter", label: "Jupiter", color: "#e0b48c" },
  { id: "saturn",  label: "Saturn",  color: "#e6cfa0" },
  { id: "uranus",  label: "Uranus",  color: "#9fe1e7" },
  { id: "neptune", label: "Neptune", color: "#7f9cff" },
  { id: "pluto",   label: "Pluto",   color: "#c9b8a8" },
];

// How long the loading screen stays visible at minimum (milliseconds).
// Without this, fast loads make the screen flash for a single frame.
const MINIMUM_LOADING_TIME = 700;

const viewer = document.getElementById("viewer");
const nav = document.getElementById("nav");
const loadingScreen = document.getElementById("loading");
const loadingName = document.getElementById("loadingName");

let activeBody = null;
let loadingStartedAt = 0;

// ---------- Build the navigation bar ----------

for (const body of BODIES) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "nav-item";
  button.dataset.id = body.id;

  // Each button carries its body's color. The selected label uses it
  // as its text highlight without adding a separate decorative marker.
  button.style.setProperty("--body-accent", body.color);

  const label = document.createElement("span");
  label.textContent = body.label;

  button.append(label);
  button.addEventListener("click", () => showBody(body));
  nav.appendChild(button);
}

// ---------- Switching between bodies ----------

function showBody(body) {
  if (activeBody?.id === body.id) return;
  activeBody = body;

  // Highlight the selected navigation item
  for (const item of nav.children) {
    const isActive = item.dataset.id === body.id;
    item.classList.toggle("active", isActive);
    item.toggleAttribute("aria-current", isActive);
  }

  // The accent color tints the loading dot and focus outlines
  document.documentElement.style.setProperty("--accent", body.color);
  document.title = `${body.label} - Solar System`;

  // Remember the choice in the URL, so refreshing keeps the planet
  history.replaceState(null, "", `#${body.id}`);

  // Show the loading screen and start loading the standalone page.
  // Every page follows the same pattern: <folder>/<folder>.html
  loadingName.textContent = body.label;
  loadingScreen.classList.remove("hidden");
  viewer.classList.add("loading");
  loadingStartedAt = performance.now();
  viewer.src = `${body.id}/${body.id}.html`;
}

// When the iframe finishes loading, fade the loading screen away.
// We wait for MINIMUM_LOADING_TIME so the transition feels calm.
viewer.addEventListener("load", () => {
  const elapsed = performance.now() - loadingStartedAt;
  const remaining = Math.max(0, MINIMUM_LOADING_TIME - elapsed);

  setTimeout(() => {
    loadingScreen.classList.add("hidden");
    viewer.classList.remove("loading");
  }, remaining);
});

// ---------- First load ----------

// If the URL has a hash like #saturn, open that body.
// Otherwise start at the Sun.
const requestedId = window.location.hash.replace("#", "");
const startBody = BODIES.find(body => body.id === requestedId) || BODIES[3]; // Earth is the default
showBody(startBody);
