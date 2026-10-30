import * as maplibregl from "/vendor/maplibre-gl.mjs";

window.MapLibreGL = maplibregl;
window.dispatchEvent(new Event("maplibre-ready"));
