const locationMapDialog = document.getElementById("map-dialog");
const locationMapCanvas = document.getElementById("map-canvas");
const locationMapStatus = document.getElementById("map-status");
const locationMapSummary = document.getElementById("map-summary");
const placeTitle = document.getElementById("selected-place-title");
const placeDetails = document.getElementById("selected-place-details");
const reviewEmpty = document.getElementById("review-empty");
const locationReviews = document.getElementById("location-reviews");
const locationReviewForm = document.getElementById("review-form");
const locationReviewStatus = document.getElementById("review-status");
const locationReviewSignIn = document.getElementById("review-sign-in");
const locationReviewRating = document.getElementById("review-rating");
const locationReviewComment = document.getElementById("review-comment");
const locationReviewSubmit = document.getElementById("review-submit");
const locationSearchInput = document.getElementById("map-search");
const locationGlobeCanvas = document.getElementById("map-globe-canvas");
const mapDialogPanel = document.querySelector(".map-dialog-panel");
let destinationLocations = [];
let nearbyLocations = new Map();
let placesById = new Map();
let locationMap;
let destinationMarkers;
const markersById = new Map();
let activeMapFilter = "all";
let currentLocationMarker;
let currentLocationCoordinates;
let mapGlobe;
let activeMapView = "2d";
let catalogLoading;
let selectedPlace;
let nearbySearchTimer;
let nearbySearchController;
let lastNearbyBounds;

function updateMapReviewAuth() {
  const signedIn = Boolean(currentUser);
  locationReviewForm.hidden = !signedIn || !selectedPlace;
  locationReviewSignIn.hidden = signedIn || !selectedPlace;
}

function renderLocationSummary() {
  const summary = [
    { label: "Destinations", value: destinationLocations.length.toLocaleString() },
    { label: "Countries", value: new Set(destinationLocations.map(place => place.countryCode)).size.toLocaleString() },
    { label: "Nearby attractions", value: nearbyLocations.size.toLocaleString() }
  ];
  locationMapSummary.replaceChildren();
  for (const item of summary) {
    const row = document.createElement("li");
    const label = document.createElement("span");
    const value = document.createElement("strong");
    label.textContent = item.label;
    value.textContent = item.value;
    row.append(label, value);
    locationMapSummary.appendChild(row);
  }
}

function mapPlaceIcon(isAttraction, category) {
  return L.divIcon({
    className: `map-place-icon${isAttraction ? " map-poi-icon" : ""}${category === "nature" ? " map-nature-icon" : ""}${category === "culture" ? " map-culture-icon" : ""}`,
    html: "",
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });
}

function getMapPlaceCategory(place) {
  const category = String(place.category || "").toLowerCase().replaceAll("_", " ");
  if (/park|garden|nature reserve|beach|peak|cave|hot spring|picnic/.test(category)) return "nature";
  if (/museum|gallery|artwork|historic|fort|monument|castle|place of worship|temple|archaeological/.test(category)) return "culture";
  if (/attraction|viewpoint|zoo|aquarium|theme park|information/.test(category)) return "sights";
  return "destination";
}

function mapPlaceMatchesFilter(place) {
  return activeMapFilter === "all" || getMapPlaceCategory(place) === activeMapFilter;
}

function refreshVisibleMapMarkers() {
  if (destinationMarkers) {
    destinationMarkers.clearLayers();
    for (const [id, marker] of markersById) {
      const place = placesById.get(id);
      if (place && mapPlaceMatchesFilter(place)) destinationMarkers.addLayer(marker);
    }
  }
  updateGlobePlaces();
}

function selectMapFilter(filter) {
  activeMapFilter = filter;
  for (const button of document.querySelectorAll("[data-map-filter]")) {
    const isActive = button.dataset.mapFilter === filter;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
  refreshVisibleMapMarkers();
  const label = document.querySelector(`[data-map-filter="${filter}"]`)?.textContent || "Everything";
  locationMapStatus.textContent = filter === "all"
    ? "Showing destinations and mapped places. Zoom in to discover more attractions."
    : `Showing ${label.toLowerCase()} markers. Select Everything to see all destinations.`;
}

function addPlaceMarker(place) {
  if (!destinationMarkers || !place.id || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) return;
  if (markersById.has(place.id)) return;

  const category = getMapPlaceCategory(place);
  const marker = L.marker([place.latitude, place.longitude], {
    icon: mapPlaceIcon(place.source === "OpenStreetMap", category),
    title: `${place.name} · ${place.category || "Destination"}`,
    placeId: place.id
  });
  marker.bindTooltip(place.name, { direction: "top", offset: [0, -8] });
  marker.on("click", () => selectMapPlace(place));
  markersById.set(place.id, marker);
  if (mapPlaceMatchesFilter(place)) destinationMarkers.addLayer(marker);
}

function addDestinationMarkers() {
  for (const place of destinationLocations) addPlaceMarker(place);
}

function initializeLocationMap() {
  if (locationMap) {
    locationMap.invalidateSize();
    return;
  }
  if (!window.L || typeof L.markerClusterGroup !== "function") {
    locationMapStatus.textContent = "The map library did not load. Refresh the page to try again.";
    return;
  }

  locationMap = L.map(locationMapCanvas, { minZoom: 2, maxZoom: 18, worldCopyJump: true }).setView([20, 0], 2);
  L.tileLayer("https://tile.openstreetmap.de/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'
  }).addTo(locationMap);
  destinationMarkers = L.markerClusterGroup({
    chunkedLoading: true,
    maxClusterRadius: 55,
    iconCreateFunction(cluster) {
      return L.divIcon({
        html: `<span>${cluster.getChildCount().toLocaleString()}</span>`,
        className: "map-marker-cluster",
        iconSize: L.point(42, 42)
      });
    }
  }).addTo(locationMap);
  locationMap.on("moveend", scheduleNearbySearch);
  addDestinationMarkers();
  window.setTimeout(() => locationMap.invalidateSize(), 50);
}

function globePlaceCollection() {
  const places = [...placesById.values()].filter(mapPlaceMatchesFilter);
  return {
    type: "FeatureCollection",
    features: places.map(place => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [place.longitude, place.latitude] },
      properties: {
        placeId: place.id,
        category: getMapPlaceCategory(place),
        source: place.source === "OpenStreetMap" ? "OpenStreetMap" : "GeoNames"
      }
    }))
  };
}

function updateGlobePlaces() {
  if (mapGlobe?.getSource("places")) {
    mapGlobe.getSource("places").setData(globePlaceCollection());
  }
}

function initializeGlobeMap() {
  if (mapGlobe || !window.MapLibreGL) return;
  const maplibregl = window.MapLibreGL;
  mapGlobe = new maplibregl.Map({
    container: locationGlobeCanvas,
    style: {
      version: 8,
      sources: {
        "openstreetmap-raster": {
          type: "raster",
          tiles: ["https://tile.openstreetmap.de/{z}/{x}/{y}.png"],
          tileSize: 256,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
        }
      },
      layers: [{ id: "openstreetmap-raster", type: "raster", source: "openstreetmap-raster" }],
      projection: { type: "globe" }
    },
    center: [0, 20],
    zoom: 1.4,
    minZoom: 1,
    maxZoom: 18,
    attributionControl: true,
    canvasContextAttributes: { antialias: true }
  });
  mapGlobe.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  mapGlobe.on("load", () => {
    mapGlobe.addSource("places", { type: "geojson", data: globePlaceCollection() });
    mapGlobe.addLayer({
      id: "place-points",
      type: "circle",
      source: "places",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 2.5, 6, 5, 13, 8],
        "circle-color": [
          "match", ["get", "category"],
          "nature", "#538a58",
          "culture", "#8663a7",
          "sights", "#f18c51",
          "#4d7db8"
        ],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.25,
        "circle-opacity": 0.94
      }
    });
    mapGlobe.addSource("current-location", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] }
    });
    mapGlobe.addLayer({
      id: "current-location",
      type: "circle",
      source: "current-location",
      paint: {
        "circle-radius": 9,
        "circle-color": "#4285f4",
        "circle-opacity": 0.78,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 3
      }
    });
    mapGlobe.on("click", "place-points", event => {
      const placeId = event.features?.[0]?.properties?.placeId;
      const place = placesById.get(placeId);
      if (place) selectMapPlace(place);
    });
    mapGlobe.on("mouseenter", "place-points", () => { mapGlobe.getCanvas().style.cursor = "pointer"; });
    mapGlobe.on("mouseleave", "place-points", () => { mapGlobe.getCanvas().style.cursor = ""; });
    mapGlobe.on("moveend", scheduleNearbySearch);
    if (currentLocationCoordinates) showGlobeCurrentLocation();
    locationMapStatus.textContent = `${placesById.size.toLocaleString()} places ready on the 3D globe.`;
  });
  mapGlobe.on("error", event => {
    if (event.error) console.error("3D map error:", event.error.message);
  });
}

function setMapView(view) {
  activeMapView = view;
  const showGlobe = view === "3d";
  locationMapCanvas.hidden = showGlobe;
  locationGlobeCanvas.hidden = !showGlobe;
  for (const button of document.querySelectorAll("[data-map-view]")) {
    const active = button.dataset.mapView === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  if (!showGlobe) {
    locationMap?.invalidateSize();
    locationMapStatus.textContent = "2D map view. Zoom in to discover mapped attractions.";
    return;
  }
  if (!window.MapLibreGL) {
    locationMapStatus.textContent = "Loading the interactive 3D globe…";
    return;
  }
  initializeGlobeMap();
  window.setTimeout(() => mapGlobe?.resize(), 50);
}

window.addEventListener("maplibre-ready", () => {
  if (activeMapView === "3d" && !locationMapDialog.hidden) setMapView("3d");
});

function showGlobeCurrentLocation() {
  if (!mapGlobe?.getSource("current-location") || !currentLocationCoordinates) return;
  const { latitude, longitude } = currentLocationCoordinates;
  mapGlobe.getSource("current-location").setData({
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry: { type: "Point", coordinates: [longitude, latitude] },
      properties: {}
    }]
  });
}

function getActiveMapZoom() {
  return activeMapView === "3d" ? mapGlobe?.getZoom() : locationMap?.getZoom();
}

function getActiveMapBounds() {
  if (activeMapView === "3d") {
    const bounds = mapGlobe?.getBounds();
    if (!bounds) return null;
    return {
      getSouth: () => bounds.getSouth(),
      getWest: () => bounds.getWest(),
      getNorth: () => bounds.getNorth(),
      getEast: () => bounds.getEast()
    };
  }
  return locationMap?.getBounds();
}

async function centerMapOnCurrentLocation() {
  if (!locationMap) return;
  const button = document.getElementById("map-find-location");
  button.disabled = true;
  locationMapStatus.textContent = "Finding your current location…";
  try {
    const { latitude, longitude } = await window.getCurrentDeviceLocation();
    currentLocationCoordinates = { latitude, longitude };
    if (activeMapView === "3d" && mapGlobe) {
      mapGlobe.flyTo({ center: [longitude, latitude], zoom: Math.max(mapGlobe.getZoom(), 12) });
      showGlobeCurrentLocation();
    } else {
      locationMap.setView([latitude, longitude], Math.max(locationMap.getZoom(), 13));
      if (currentLocationMarker) locationMap.removeLayer(currentLocationMarker);
      currentLocationMarker = L.circleMarker([latitude, longitude], {
        radius: 9,
        className: "map-current-location",
        interactive: false
      }).addTo(locationMap);
    }
    locationMapStatus.textContent = "Map centered on your current location. Your location is not saved.";
  } catch (error) {
    locationMapStatus.textContent = error.code === 1
      ? "Location access was not allowed. Enable it in browser settings or search for a place."
      : error.code === 3
        ? "We could not get your location in time. Please try again."
        : error.message || "Your location is unavailable right now.";
  } finally {
    button.disabled = false;
  }
}

async function loadDestinationCatalog() {
  if (destinationLocations.length) return;
  if (catalogLoading) return catalogLoading;
  catalogLoading = (async () => {
    const response = await fetch("/locations.json", { credentials: "same-origin" });
    if (!response.ok) throw new Error("Could not load the global destination catalog.");
    const places = await response.json();
    if (!Array.isArray(places) || places.length < 1000) {
      throw new Error("The global destination catalog is incomplete.");
    }
    destinationLocations = places;
    for (const place of places) placesById.set(place.id, place);
    addDestinationMarkers();
    renderLocationSummary();
    locationMapStatus.textContent = `${places.length.toLocaleString()} real destinations across ${new Set(places.map(place => place.countryCode)).size.toLocaleString()} countries. Zoom in to discover mapped attractions.`;
  })();
  try {
    await catalogLoading;
  } catch (error) {
    catalogLoading = null;
    locationMapStatus.textContent = error.message || "Could not load destinations.";
    throw error;
  }
}

function scheduleNearbySearch() {
  if ((!locationMap && !mapGlobe) || !destinationLocations.length) return;
  window.clearTimeout(nearbySearchTimer);
  if (nearbySearchController) nearbySearchController.abort();
  if (getActiveMapZoom() < 8) {
    locationMapStatus.textContent = "Zoom in to explore real attractions and places of interest.";
    return;
  }
  nearbySearchTimer = window.setTimeout(loadNearbyAttractions, 650);
}

async function loadNearbyAttractions() {
  const bounds = getActiveMapBounds();
  if (!bounds) return;
  const wrapLongitude = value => ((value + 180) % 360 + 360) % 360 - 180;
  const bbox = [
    bounds.getSouth(), wrapLongitude(bounds.getWest()), bounds.getNorth(), wrapLongitude(bounds.getEast())
  ].map(value => value.toFixed(5)).join(",");
  if (bbox === lastNearbyBounds) return;

  nearbySearchController = new AbortController();
  locationMapStatus.textContent = "Searching mapped attractions in this area…";
  try {
    const response = await fetch(`/api/locations/nearby?bbox=${encodeURIComponent(bbox)}`, {
      credentials: "same-origin",
      signal: nearbySearchController.signal
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Nearby attraction search failed.");
    lastNearbyBounds = bbox;
    for (const place of result.locations) {
      if (placesById.has(place.id)) continue;
      placesById.set(place.id, place);
      nearbyLocations.set(place.id, place);
      addPlaceMarker(place);
    }
    updateGlobePlaces();
    renderLocationSummary();
    locationMapStatus.textContent = `${result.locations.length.toLocaleString()} mapped attractions found in this area.`;
  } catch (error) {
    if (error.name === "AbortError") return;
    locationMapStatus.textContent = error.message || "Nearby attraction data is temporarily unavailable.";
  }
}

function addPlaceFact(list, label, value) {
  if (!value) return;
  const row = document.createElement("li");
  const heading = document.createElement("strong");
  const detail = document.createElement("span");
  heading.textContent = label;
  detail.textContent = value;
  row.append(heading, detail);
  list.appendChild(row);
}

function renderPlaceDetails(place) {
  placeTitle.textContent = place.name;
  placeDetails.replaceChildren();
  const facts = document.createElement("ul");
  facts.className = "place-facts";
  addPlaceFact(facts, "Type", place.category || "Destination");
  if (place.countryCode) addPlaceFact(facts, "Country code", place.countryCode);
  if (Number.isFinite(place.population)) {
    addPlaceFact(facts, "Population", `${place.population.toLocaleString()} · GeoNames`);
  }
  if (place.description) addPlaceFact(facts, "Description", place.description);
  if (place.openingHours) addPlaceFact(facts, "Opening hours", place.openingHours);
  if (place.wikipedia) addPlaceFact(facts, "Wikipedia reference", place.wikipedia);
  addPlaceFact(facts, "Coordinates", `${place.latitude.toFixed(4)}, ${place.longitude.toFixed(4)}`);
  placeDetails.appendChild(facts);

  const links = document.createElement("div");
  links.className = "place-links";
  const directions = document.createElement("a");
  directions.href = `https://www.google.com/maps/search/?api=1&query=${place.latitude},${place.longitude}`;
  directions.target = "_blank";
  directions.rel = "noopener noreferrer";
  directions.textContent = "Open in Google Maps";
  links.appendChild(directions);
  if (place.id.startsWith("osm-")) {
    const [, type, id] = place.id.split("-");
    const openStreetMap = document.createElement("a");
    openStreetMap.href = `https://www.openstreetmap.org/${type}/${id}`;
    openStreetMap.target = "_blank";
    openStreetMap.rel = "noopener noreferrer";
    openStreetMap.textContent = "View OpenStreetMap source";
    links.appendChild(openStreetMap);
  }
  const source = document.createElement("span");
  if (place.source === "OpenStreetMap") {
    source.textContent = "Place details from OpenStreetMap";
  } else {
    source.append("Destination and population data: ");
    const geoNames = document.createElement("a");
    geoNames.href = "https://www.geonames.org/";
    geoNames.target = "_blank";
    geoNames.rel = "noopener noreferrer";
    geoNames.textContent = "GeoNames";
    source.appendChild(geoNames);
  }
  links.appendChild(source);
  if (place.website) {
    const website = document.createElement("a");
    website.href = place.website;
    website.target = "_blank";
    website.rel = "noopener noreferrer";
    website.textContent = "Official website";
    links.appendChild(website);
  }
  placeDetails.appendChild(links);
}

function renderReviews(result) {
  locationReviews.replaceChildren();
  const count = result.reviewCount;
  reviewEmpty.textContent = count
    ? `${result.averageRating.toFixed(1)} out of 5 · ${count.toLocaleString()} ${count === 1 ? "review" : "reviews"}`
    : "No visitor feedback yet. Be the first to share a helpful note.";
  reviewEmpty.hidden = false;
  for (const review of result.reviews) {
    const article = document.createElement("article");
    article.className = "location-review";
    const heading = document.createElement("div");
    heading.className = "location-review-heading";
    const author = document.createElement("strong");
    author.textContent = review.author;
    const rating = document.createElement("span");
    rating.textContent = `${review.rating}/5`;
    heading.append(author, rating);
    const comment = document.createElement("p");
    comment.textContent = review.comment;
    const date = document.createElement("time");
    date.textContent = new Date(`${review.createdAt.replace(" ", "T")}Z`).toLocaleDateString();
    article.append(heading, comment, date);
    locationReviews.appendChild(article);
  }
  locationReviewForm.hidden = !currentUser || !selectedPlace;
  locationReviewSignIn.hidden = Boolean(currentUser) || !selectedPlace;
  if (result.myReview) {
    locationReviewRating.value = String(result.myReview.rating);
    locationReviewComment.value = result.myReview.comment;
    locationReviewSubmit.textContent = "Update feedback";
  } else {
    locationReviewRating.value = "5";
    locationReviewComment.value = "";
    locationReviewSubmit.textContent = "Share feedback";
  }
}

async function loadPlaceReviews(place) {
  reviewEmpty.textContent = "Loading visitor feedback…";
  reviewEmpty.hidden = false;
  locationReviews.replaceChildren();
  locationReviewStatus.textContent = "";
  updateMapReviewAuth();
  try {
    const response = await fetch(`/api/locations/${encodeURIComponent(place.id)}/reviews`, {
      credentials: "same-origin"
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load visitor feedback.");
    if (selectedPlace?.id === place.id) renderReviews(result);
  } catch (error) {
    if (selectedPlace?.id === place.id) reviewEmpty.textContent = error.message || "Could not load visitor feedback.";
  }
}

function selectMapPlace(place) {
  selectedPlace = place;
  renderPlaceDetails(place);
  loadPlaceReviews(place);
}

async function openLocationMap() {
  locationMapDialog.hidden = false;
  initializeLocationMap();
  if (!locationMap) return;
  try {
    await loadDestinationCatalog();
  } catch {
    return;
  }
  if (locationMap) window.setTimeout(() => locationMap.invalidateSize(), 50);
}

function toggleMapFullscreen() {
  if (document.fullscreenElement === mapDialogPanel || mapDialogPanel.classList.contains("map-fullscreen-fallback")) {
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen();
    mapDialogPanel.classList.remove("map-fullscreen-fallback");
    updateFullscreenButton(false);
    return;
  }
  if (mapDialogPanel.requestFullscreen) {
    mapDialogPanel.requestFullscreen().then(() => updateFullscreenButton(true)).catch(() => {
      mapDialogPanel.classList.add("map-fullscreen-fallback");
      updateFullscreenButton(true);
    });
  } else {
    mapDialogPanel.classList.add("map-fullscreen-fallback");
    updateFullscreenButton(true);
  }
  window.setTimeout(() => {
    locationMap?.invalidateSize();
    mapGlobe?.resize();
  }, 100);
}

function updateFullscreenButton(isFullscreen) {
  const button = document.getElementById("map-fullscreen");
  button.setAttribute("aria-pressed", String(isFullscreen));
  button.setAttribute("aria-label", isFullscreen ? "Exit full screen map" : "View map full screen");
  button.querySelector(".fullscreen-label").textContent = isFullscreen ? "Exit full screen" : "Full screen";
}

document.addEventListener("fullscreenchange", () => {
  const isFullscreen = document.fullscreenElement === mapDialogPanel;
  if (!isFullscreen) mapDialogPanel.classList.remove("map-fullscreen-fallback");
  updateFullscreenButton(isFullscreen || mapDialogPanel.classList.contains("map-fullscreen-fallback"));
  window.setTimeout(() => {
    locationMap?.invalidateSize();
    mapGlobe?.resize();
  }, 50);
});

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("maplibre-module").addEventListener("error", () => {
    locationMapStatus.textContent = "The 3D globe could not be loaded. You can continue using the 2D map.";
  });
});

async function openMapForPlace(placeOrId) {
  await openLocationMap();
  if (!locationMap) return;

  let place = typeof placeOrId === "string" ? placesById.get(placeOrId) : placeOrId;
  if (place && typeof place === "object") {
    place = placesById.get(place.id) || place;
  }
  if (!place || !place.id || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)
    || place.latitude < -90 || place.latitude > 90 || place.longitude < -180 || place.longitude > 180) {
    locationMapStatus.textContent = "That place could not be opened on the map. Try searching for it instead.";
    return;
  }

  if (activeMapFilter !== "all") selectMapFilter("all");
  placesById.set(place.id, place);
  if (place.source === "OpenStreetMap") nearbyLocations.set(place.id, place);
  addPlaceMarker(place);
  if (activeMapView === "3d" && mapGlobe) {
    mapGlobe.flyTo({ center: [place.longitude, place.latitude], zoom: Math.max(mapGlobe.getZoom(), 12) });
  } else {
    if (activeMapView === "3d" && mapGlobe) {
      mapGlobe.flyTo({ center: [place.longitude, place.latitude], zoom: Math.max(mapGlobe.getZoom(), 12) });
    } else {
      locationMap.setView([place.latitude, place.longitude], Math.max(locationMap.getZoom(), 12));
    }
  }
  locationSearchInput.value = place.name;
  selectMapPlace(place);
}

function closeLocationMap() {
  locationMapDialog.hidden = true;
  if (document.fullscreenElement === mapDialogPanel && document.exitFullscreen) document.exitFullscreen();
  mapDialogPanel.classList.remove("map-fullscreen-fallback");
  updateFullscreenButton(false);
}

window.openMapForPlace = openMapForPlace;
document.getElementById("open-map-dialog").addEventListener("click", openLocationMap);
document.getElementById("map-find-location").addEventListener("click", centerMapOnCurrentLocation);
document.getElementById("map-fullscreen").addEventListener("click", toggleMapFullscreen);
document.getElementById("map-view-2d").addEventListener("click", () => setMapView("2d"));
document.getElementById("map-view-3d").addEventListener("click", () => setMapView("3d"));
for (const button of document.querySelectorAll("[data-map-filter]")) {
  button.addEventListener("click", () => selectMapFilter(button.dataset.mapFilter));
}
document.getElementById("close-map-dialog").addEventListener("click", closeLocationMap);
locationMapDialog.addEventListener("click", event => {
  if (event.target.matches("[data-close-map='true']")) closeLocationMap();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !locationMapDialog.hidden) closeLocationMap();
});

document.getElementById("map-search-form").addEventListener("submit", event => {
  event.preventDefault();
  const query = locationSearchInput.value.trim().toLocaleLowerCase();
  if (!query) return;
  const availablePlaces = [...nearbyLocations.values(), ...destinationLocations];
  const place = availablePlaces.find(location => location.name.toLocaleLowerCase() === query)
    || availablePlaces.find(location => location.name.toLocaleLowerCase().includes(query));
  if (!place) {
    locationMapStatus.textContent = "No matching destination or currently loaded attraction. Pan or zoom to load nearby places.";
    return;
  }
  locationMap.setView([place.latitude, place.longitude], Math.max(locationMap.getZoom(), 12));
  selectMapPlace(place);
});

locationReviewForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!currentUser || !selectedPlace) return;
  locationReviewSubmit.disabled = true;
  locationReviewStatus.textContent = "Saving your feedback…";
  try {
    const csrfResponse = await fetch("/api/csrf", { credentials: "same-origin" });
    if (!csrfResponse.ok) throw new Error("Could not start a secure request.");
    const { csrfToken } = await csrfResponse.json();
    const response = await fetch(`/api/locations/${encodeURIComponent(selectedPlace.id)}/reviews`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({
        rating: Number(locationReviewRating.value),
        comment: locationReviewComment.value.trim()
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not save your feedback.");
    renderReviews(result);
    locationReviewStatus.textContent = "Your feedback has been saved.";
  } catch (error) {
    locationReviewStatus.textContent = error.message || "Could not save your feedback.";
  } finally {
    locationReviewSubmit.disabled = false;
  }
});
