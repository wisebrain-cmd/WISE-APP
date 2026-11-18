const locationPattern = /^(?:geonames-\d+|osm-(?:node|way|relation)-\d+)$/;
const pathId = decodeURIComponent(window.location.pathname.split("/").filter(Boolean).pop() || "");
const statusMessage = document.getElementById("location-status");
const content = document.getElementById("location-content");
const locationPhoto = document.getElementById("location-photo");
const photoPlaceholder = document.getElementById("photo-placeholder");
const photoStatus = document.getElementById("photo-status");
const photoCredit = document.getElementById("photo-credit");
const photoForm = document.getElementById("photo-form");
const photoFile = document.getElementById("photo-file");
const photoSaveButton = document.getElementById("photo-save");
const photoRemoveButton = document.getElementById("photo-remove");
const photoSignIn = document.getElementById("photo-sign-in");
const weatherStatus = document.getElementById("weather-status");
const weatherContent = document.getElementById("weather-content");
const reviewForm = document.getElementById("review-form");
const reviewSignIn = document.getElementById("review-sign-in");
const reviewList = document.getElementById("location-reviews");
const reviewEmpty = document.getElementById("review-empty");
const reviewSummary = document.getElementById("review-summary");
const reviewStatus = document.getElementById("review-status");
const reviewSubmit = document.getElementById("review-submit");
let place;
let signedIn = false;
let weatherTemperatureUnit = "celsius";

function isPlace(value) {
  return value && value.id === pathId && locationPattern.test(value.id)
    && typeof value.name === "string" && value.name.trim()
    && Number.isFinite(value.latitude) && value.latitude >= -90 && value.latitude <= 90
    && Number.isFinite(value.longitude) && value.longitude >= -180 && value.longitude <= 180;
}

function countryName(code) {
  if (!code) return "";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
}

function cacheSelectedPlace(value) {
  try {
    sessionStorage.setItem("wse-selected-place", JSON.stringify(value));
  } catch (error) {
    console.warn("Could not cache place details:", error);
  }
}

async function loadPlace() {
  if (!locationPattern.test(pathId)) throw new Error("This place link is invalid.");
  if (pathId.startsWith("geonames-")) {
    const response = await fetch("/locations.json");
    if (!response.ok) throw new Error("The place catalog could not be loaded.");
    const catalog = await response.json();
    place = catalog.find(entry => entry.id === pathId);
  } else {
    let lookupError;
    try {
      const response = await fetch(`/api/locations/${encodeURIComponent(pathId)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Mapped place details are temporarily unavailable.");
      place = result.place;
    } catch (error) {
      lookupError = error;
    }
    try {
      const cached = JSON.parse(sessionStorage.getItem("wse-selected-place") || "null");
      if (!isPlace(place) && isPlace(cached) && cached.source === "OpenStreetMap") {
        place = cached;
        console.warn("Using this session's cached place details after lookup failed:", lookupError);
      }
    } catch (error) {
      console.warn("Could not read the selected map place:", error);
    }
    if (!isPlace(place) && lookupError) throw lookupError;
  }
  if (!isPlace(place)) throw new Error("This place is not available in the catalog. Open it again from the map.");
  cacheSelectedPlace(place);
}

function setPhoto(source, alt, credit, sourceUrl, license, licenseUrl) {
  locationPhoto.src = source;
  locationPhoto.alt = alt;
  locationPhoto.onerror = () => {
    locationPhoto.hidden = true;
    photoPlaceholder.hidden = false;
    photoCredit.replaceChildren();
    photoStatus.textContent = "This photo is currently unavailable.";
  };
  locationPhoto.hidden = false;
  photoPlaceholder.hidden = true;
  photoCredit.replaceChildren();
  if (credit) photoCredit.append(document.createTextNode(`${credit} `));
  if (license) {
    if (licenseUrl) {
      const licenseLink = document.createElement("a");
      licenseLink.href = licenseUrl;
      licenseLink.target = "_blank";
      licenseLink.rel = "noreferrer";
      licenseLink.textContent = `License: ${license}`;
      photoCredit.append(licenseLink, document.createTextNode(". "));
    } else {
      photoCredit.append(document.createTextNode(`License: ${license}. `));
    }
  }
  if (sourceUrl) {
    const link = document.createElement("a");
    link.href = sourceUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "View photo source";
    photoCredit.append(link);
  }
}

async function loadPhoto() {
  photoStatus.textContent = "Loading place photo…";
  try {
    const response = await fetch(`/api/locations/${encodeURIComponent(place.id)}/photo`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load place photo.");
    if (result.photo?.imageData) {
      setPhoto(result.photo.imageData, `Visitor-added photo of ${place.name}`, "Shared by WSE Adventures visitors.");
      photoForm.hidden = !signedIn || !result.photo.canManage;
      photoRemoveButton.hidden = !signedIn || !result.photo.canManage;
      if (signedIn && !result.photo.canManage) {
        photoStatus.textContent = "This shared photo can only be replaced or removed by the visitor who added it.";
      }
      if (result.photo.canManage) photoStatus.textContent = "Your shared community photo";
      else if (!signedIn) photoStatus.textContent = "Community photo";
      return;
    }
    photoForm.hidden = !signedIn;
    photoRemoveButton.hidden = true;
    const query = new URLSearchParams({ name: place.name, countryCode: place.countryCode || "" });
    const searchResponse = await fetch(`/api/locations/${encodeURIComponent(place.id)}/photo-search?${query}`);
    const searchResult = await searchResponse.json();
    if (!searchResponse.ok) throw new Error(searchResult.error || "Place photo search is temporarily unavailable.");
    const photo = searchResult.photo;
    if (!photo) {
      photoStatus.textContent = "No matching photo was found. You can add one while signed in.";
      return;
    }
    setPhoto(photo.url, `${place.name} · ${photo.title}`, photo.artist ? `Photo by ${photo.artist}.` : "", photo.sourceUrl, photo.license, photo.licenseUrl);
    photoStatus.textContent = "Photo from Wikimedia Commons";
  } catch (error) {
    photoStatus.textContent = error.message || "Place photo is temporarily unavailable.";
  }
}

function weatherDescription(code, isDay) {
  const descriptions = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Depositing rime fog", 51: "Light drizzle", 53: "Moderate drizzle",
    55: "Dense drizzle", 56: "Light freezing drizzle", 57: "Dense freezing drizzle",
    61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain", 66: "Light freezing rain",
    67: "Heavy freezing rain", 71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
    77: "Snow grains", 80: "Slight rain showers", 81: "Moderate rain showers",
    82: "Violent rain showers", 85: "Slight snow showers", 86: "Heavy snow showers",
    95: "Thunderstorm", 96: "Thunderstorm with slight hail", 99: "Thunderstorm with heavy hail"
  };
  const description = descriptions[code] || "Weather conditions";
  return code <= 1 && !isDay ? "Clear night" : description;
}

function formatted(value, unit) {
  const displayUnit = unit === "mp/h" ? "mph" : unit;
  return Number.isFinite(value) ? `${Math.round(value * 10) / 10}${displayUnit ? ` ${displayUnit}` : ""}` : "—";
}

async function loadWeather() {
  weatherStatus.textContent = "Loading current conditions…";
  try {
    const query = new URLSearchParams({
      latitude: String(place.latitude),
      longitude: String(place.longitude),
      temperatureUnit: weatherTemperatureUnit
    });
    const response = await fetch(`/api/weather?${query}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Current weather is temporarily unavailable.");
    const current = result.current;
    const units = result.units || {};
    document.getElementById("weather-summary").textContent = weatherDescription(current.weather_code, current.is_day);
    document.getElementById("weather-temperature").textContent = formatted(current.temperature_2m, units.temperature_2m);
    document.getElementById("weather-feels").textContent = formatted(current.apparent_temperature, units.apparent_temperature);
    document.getElementById("weather-humidity").textContent = formatted(current.relative_humidity_2m, units.relative_humidity_2m);
    document.getElementById("weather-wind").textContent = formatted(current.wind_speed_10m, units.wind_speed_10m);
    document.getElementById("weather-precipitation").textContent = formatted(current.precipitation, units.precipitation);
    document.getElementById("weather-time").textContent = `Observed ${current.time.replace("T", " ")} · ${result.timezone || "local time"}`;
    weatherContent.hidden = false;
    weatherStatus.hidden = true;
  } catch (error) {
    weatherStatus.textContent = error.message || "Current weather is temporarily unavailable.";
  }
}

async function loadSession() {
  try {
    const response = await fetch("/api/session", { credentials: "same-origin" });
    if (!response.ok) throw new Error("Could not check sign-in status.");
    const result = await response.json();
    signedIn = Boolean(result.user);
    photoForm.hidden = !signedIn;
    photoSignIn.hidden = signedIn;
    reviewForm.hidden = !signedIn;
    reviewSignIn.hidden = signedIn;
    if (signedIn) {
      try {
        const settingsResponse = await fetch("/api/me/settings", { credentials: "same-origin", cache: "no-store" });
        if (!settingsResponse.ok) throw new Error("Could not load your weather display preference.");
        const settings = await settingsResponse.json();
        const preference = settings.settings?.appearance?.temperatureUnits;
        if (preference === "celsius" || preference === "fahrenheit") weatherTemperatureUnit = preference;
      } catch (error) {
        console.error("Weather preference load failed:", error);
      }
    }
  } catch (error) {
    photoForm.hidden = true;
    photoSignIn.textContent = "Could not verify sign-in status. Refresh the page to try adding a photo.";
    photoSignIn.hidden = false;
    reviewForm.hidden = true;
    reviewSignIn.textContent = "Could not verify sign-in status. Refresh the page to share feedback.";
    reviewSignIn.hidden = false;
    console.error("Place detail sign-in check failed:", error);
  }
}

function renderReviews(result) {
  reviewList.replaceChildren();
  reviewSummary.textContent = result.reviewCount
    ? `${result.averageRating} / 5 · ${result.reviewCount} ${result.reviewCount === 1 ? "review" : "reviews"}`
    : "No visitor feedback yet.";
  reviewEmpty.textContent = result.reviews.length ? "" : "Be the first to share a helpful note about this place.";
  reviewEmpty.hidden = result.reviews.length > 0;
  for (const review of result.reviews) {
    const item = document.createElement("li");
    const heading = document.createElement("strong");
    heading.textContent = `${review.rating} / 5 · ${review.author}`;
    const comment = document.createElement("p");
    comment.textContent = review.comment;
    const date = document.createElement("p");
    date.className = "form-help";
    date.textContent = new Date(`${review.createdAt}Z`).toLocaleDateString();
    item.append(heading, comment, date);
    reviewList.append(item);
  }
  if (result.myReview) {
    document.getElementById("review-rating").value = String(result.myReview.rating);
    document.getElementById("review-comment").value = result.myReview.comment;
    reviewSubmit.textContent = "Update feedback";
  }
}

async function loadReviews() {
  reviewEmpty.textContent = "Loading visitor feedback…";
  reviewEmpty.hidden = false;
  try {
    const response = await fetch(`/api/locations/${encodeURIComponent(place.id)}/reviews`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load visitor feedback.");
    renderReviews(result);
  } catch (error) {
    reviewEmpty.textContent = error.message || "Could not load visitor feedback.";
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("The selected photo could not be read.")));
    reader.readAsDataURL(file);
  });
}

async function preparePhoto(file) {
  if (!file || !/^image\/(?:png|jpeg|webp)$/.test(file.type)) {
    throw new Error("Choose a PNG, JPEG or WebP image.");
  }
  const image = new Image();
  const objectUrl = URL.createObjectURL(file);
  try {
    image.src = objectUrl;
    await image.decode();
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [.84, .72, .6, .48]) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", quality));
      if (blob && blob.size <= 256 * 1024) return await readFileAsDataUrl(blob);
      canvas.width = Math.max(1, Math.round(canvas.width * .82));
      canvas.height = Math.max(1, Math.round(canvas.height * .82));
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    }
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  throw new Error("This image is too large to prepare. Choose a smaller image.");
}

async function getCsrfToken() {
  const response = await fetch("/api/csrf", { credentials: "same-origin" });
  if (!response.ok) throw new Error("Security token unavailable. Refresh the page and try again.");
  return (await response.json()).csrfToken;
}

photoFile.addEventListener("change", () => {
  photoSaveButton.disabled = !photoFile.files?.[0];
});

photoForm.addEventListener("submit", async event => {
  event.preventDefault();
  const file = photoFile.files?.[0];
  if (!file) return;
  photoSaveButton.disabled = true;
  photoStatus.textContent = "Preparing photo…";
  try {
    const imageData = await preparePhoto(file);
    const csrfToken = await getCsrfToken();
    const response = await fetch(`/api/locations/${encodeURIComponent(place.id)}/photo`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ imageData })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not save this photo.");
    setPhoto(imageData, `Visitor-added photo of ${place.name}`, "Shared by WSE Adventures visitors.");
    photoRemoveButton.hidden = false;
    photoStatus.textContent = "Photo saved for everyone visiting this place.";
    photoFile.value = "";
  } catch (error) {
    photoStatus.textContent = error.message || "Could not save this photo.";
  } finally {
    photoSaveButton.disabled = !photoFile.files?.[0];
  }
});

photoRemoveButton.addEventListener("click", async () => {
  photoRemoveButton.disabled = true;
  try {
    const csrfToken = await getCsrfToken();
    const response = await fetch(`/api/locations/${encodeURIComponent(place.id)}/photo`, {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "X-CSRF-Token": csrfToken }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not remove this photo.");
    locationPhoto.hidden = true;
    photoPlaceholder.hidden = false;
    photoCredit.replaceChildren();
    photoRemoveButton.hidden = true;
    await loadPhoto();
  } catch (error) {
    photoStatus.textContent = error.message || "Could not remove this photo.";
  } finally {
    photoRemoveButton.disabled = false;
  }
});

reviewForm.addEventListener("submit", async event => {
  event.preventDefault();
  reviewSubmit.disabled = true;
  reviewStatus.textContent = "Saving your feedback…";
  try {
    const csrfToken = await getCsrfToken();
    const response = await fetch(`/api/locations/${encodeURIComponent(place.id)}/reviews`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({
        rating: Number(document.getElementById("review-rating").value),
        comment: document.getElementById("review-comment").value.trim()
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not save your feedback.");
    renderReviews(result);
    reviewStatus.textContent = "Your feedback has been saved.";
  } catch (error) {
    reviewStatus.textContent = error.message || "Could not save your feedback.";
  } finally {
    reviewSubmit.disabled = false;
  }
});

async function initialize() {
  try {
    await loadPlace();
    const country = countryName(place.countryCode);
    document.title = `${place.name}${country ? `, ${country}` : ""} · WSE Adventures`;
    document.getElementById("location-name").textContent = place.name;
    document.getElementById("location-country").textContent = country || place.category || "Mapped place";
    document.getElementById("location-meta").textContent = place.source === "OpenStreetMap"
      ? `${place.category || "Mapped attraction"} · OpenStreetMap`
      : `Population ${Number(place.population || 0).toLocaleString()} · GeoNames`;
    const mapLink = document.getElementById("location-map-link");
    mapLink.href = `/?place=${encodeURIComponent(place.id)}`;
    content.hidden = false;
    statusMessage.hidden = true;
    await loadSession();
    await Promise.all([loadPhoto(), loadWeather(), loadReviews()]);
  } catch (error) {
    statusMessage.classList.add("error");
    statusMessage.textContent = error.message || "Place details could not be loaded.";
  }
}

initialize();
