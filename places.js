const placesList = document.getElementById("places-list");
const searchInput = document.getElementById("places-search");
const countrySelect = document.getElementById("places-country");
const countLabel = document.getElementById("places-count");
const emptyMessage = document.getElementById("places-empty");
const errorMessage = document.getElementById("places-error");
const previousButton = document.getElementById("places-previous");
const nextButton = document.getElementById("places-next");
const pageLabel = document.getElementById("places-page");
const pageSize = 30;
const countryNames = new Map();
let allPlaces = [];
let currentPage = 0;

function countryName(code) {
  if (!code) return "";
  if (countryNames.has(code)) return countryNames.get(code);
  try {
    const name = new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code;
    countryNames.set(code, name);
    return name;
  } catch {
    countryNames.set(code, code);
    return code;
  }
}

function isPlace(place) {
  return place && typeof place.id === "string"
    && /^(?:geonames-\d+|osm-(?:node|way|relation)-\d+)$/.test(place.id)
    && typeof place.name === "string" && place.name.trim().length > 0
    && Number.isFinite(place.latitude) && place.latitude >= -90 && place.latitude <= 90
    && Number.isFinite(place.longitude) && place.longitude >= -180 && place.longitude <= 180;
}

function cacheSelectedPlace(place) {
  try {
    sessionStorage.setItem("wse-selected-place", JSON.stringify(place));
  } catch (error) {
    console.warn("Could not cache place details:", error);
  }
}

function renderPlaces() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  const country = countrySelect.value;
  const filtered = allPlaces.filter(place => {
    const regionName = countryName(place.countryCode);
    const text = `${place.name} ${place.countryCode || ""} ${regionName} ${place.category || ""}`.toLocaleLowerCase();
    return (!query || text.includes(query)) && (!country || place.countryCode === country);
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  currentPage = Math.min(currentPage, pageCount - 1);
  const pagePlaces = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  placesList.replaceChildren();

  for (const place of pagePlaces) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = `/places/${encodeURIComponent(place.id)}`;
    link.addEventListener("click", () => cacheSelectedPlace(place));
    const main = document.createElement("span");
    main.className = "place-list-main";
    const name = document.createElement("strong");
    name.textContent = place.name;
    const detail = document.createElement("span");
    detail.textContent = place.source === "OpenStreetMap"
      ? `${place.category || "Mapped attraction"}${place.country ? ` · ${place.country}` : ""}`
      : `${countryName(place.countryCode)}${place.population ? ` · Population ${Number(place.population).toLocaleString()}` : ""}`;
    main.append(name, detail);
    const arrow = document.createElement("span");
    arrow.className = "place-list-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "›";
    link.append(main, arrow);
    item.append(link);
    placesList.append(item);
  }

  countLabel.textContent = `${filtered.length.toLocaleString()} places found`;
  pageLabel.textContent = `${currentPage + 1} of ${pageCount}`;
  previousButton.disabled = currentPage === 0;
  nextButton.disabled = currentPage >= pageCount - 1;
  emptyMessage.hidden = filtered.length !== 0;
}

function renderCountryOptions() {
  const countries = [...new Set(allPlaces.map(place => place.countryCode).filter(Boolean))]
    .sort((a, b) => countryName(a).localeCompare(countryName(b)));
  countrySelect.replaceChildren(new Option("All countries", ""));
  for (const code of countries) countrySelect.add(new Option(countryName(code), code));
}

async function loadPlaces() {
  try {
    const response = await fetch("/locations.json");
    if (!response.ok) throw new Error("The place directory could not be loaded.");
    const catalog = await response.json();
    if (!Array.isArray(catalog) || catalog.length < 1000 || !catalog.every(isPlace)) {
      throw new Error("The global place catalog is incomplete or invalid.");
    }

    let attractions = [];
    try {
      attractions = JSON.parse(sessionStorage.getItem("wse-mapped-attractions") || "[]");
    } catch (error) {
      console.warn("Could not read mapped attractions from this session:", error);
    }
    if (!Array.isArray(attractions)) attractions = [];
    const byId = new Map(catalog.map(place => [place.id, place]));
    for (const place of attractions) {
      if (isPlace(place) && place.source === "OpenStreetMap") byId.set(place.id, place);
    }
    allPlaces = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name) || (a.countryCode || "").localeCompare(b.countryCode || ""));
    renderCountryOptions();
    renderPlaces();
  } catch (error) {
    countLabel.textContent = "Places could not be loaded.";
    errorMessage.textContent = error.message || "Please refresh the page to try again.";
    errorMessage.hidden = false;
  }
}

searchInput.addEventListener("input", () => {
  currentPage = 0;
  renderPlaces();
});
countrySelect.addEventListener("change", () => {
  currentPage = 0;
  renderPlaces();
});
previousButton.addEventListener("click", () => {
  currentPage -= 1;
  renderPlaces();
});
nextButton.addEventListener("click", () => {
  currentPage += 1;
  renderPlaces();
});

loadPlaces();
