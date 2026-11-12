(function (root, factory) {
  const model = factory();
  if (typeof module === "object" && module.exports) module.exports = model;
  if (root) root.WSESettingsModel = model;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const DEFAULT_SETTINGS = {
    account: {
      profilePhoto: null
    },
    map: {
      mapType: "standard",
      showTraffic: false,
      showTransit: false,
      showBicycleRoutes: false,
      showWalkingRoutes: false,
      showLandmarks: true,
      showBusinesses: true,
      buildings3D: false,
      mapLabels: true,
      autoRotate: false
    },
    navigation: {
      travelMode: "driving",
      avoidTolls: false,
      avoidHighways: false,
      avoidFerries: false,
      preferFasterRoutes: true,
      voiceNavigation: true,
      voiceVolume: 70,
      navigationNotifications: true,
      autoStartNavigation: false
    },
    location: {
      locationAccess: "while-using",
      useCurrentLocation: false,
      locationAccuracy: "precise",
      locationHistory: false,
      homeLocation: "",
      workLocation: ""
    },
    places: {
      nearbyPlaces: true,
      restaurantPreferences: "all",
      hotelPreferences: "all",
      shoppingPreferences: "all",
      attractions: true,
      recommendedPlaces: true,
      personalizedRecommendations: true,
      searchHistory: true
    },
    notifications: {
      navigation: true,
      trafficAlerts: true,
      routeChanges: true,
      nearbyPlaces: false,
      travelRecommendations: false,
      promotions: false,
      accountNotifications: true,
      emailNotifications: true,
      pushNotifications: false
    },
    appearance: {
      theme: "system",
      mapAppearance: "automatic",
      language: "en",
      distanceUnits: "kilometers",
      temperatureUnits: "celsius"
    },
    privacy: {
      locationSharing: false,
      locationHistory: false,
      searchHistory: true,
      dataCollection: false,
      personalization: true
    },
    savedPlaces: {
      home: "",
      work: "",
      favorites: [],
      savedTrips: [],
      customPlaces: []
    },
    offlineMaps: {
      automaticUpdates: true
    },
    accessibility: {
      largerText: false,
      highContrast: false,
      reducedMotion: false,
      screenReaderSupport: true,
      voiceGuidance: true,
      accessibleRoutes: false
    }
  };

  const ENUMS = {
    "map.mapType": ["standard", "satellite", "terrain"],
    "navigation.travelMode": ["driving", "walking", "cycling", "transit"],
    "location.locationAccess": ["while-using", "ask-every-time", "never"],
    "location.locationAccuracy": ["precise", "approximate"],
    "places.restaurantPreferences": ["all", "vegetarian", "vegan", "family-friendly"],
    "places.hotelPreferences": ["all", "budget", "boutique", "accessible"],
    "places.shoppingPreferences": ["all", "local", "markets", "malls"],
    "appearance.theme": ["light", "dark", "system"],
    "appearance.mapAppearance": ["automatic", "light", "dark", "satellite"],
    "appearance.language": ["en", "es", "fr", "de"],
    "appearance.distanceUnits": ["kilometers", "miles"],
    "appearance.temperatureUnits": ["celsius", "fahrenheit"]
  };

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function getDefaultSettings() {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }

  function mergeSettings(saved) {
    const result = getDefaultSettings();
    if (!isPlainObject(saved)) return result;
    for (const [category, values] of Object.entries(result)) {
      if (!isPlainObject(saved[category])) continue;
      for (const key of Object.keys(values)) {
        if (Object.prototype.hasOwnProperty.call(saved[category], key)) {
          values[key] = saved[category][key];
        }
      }
    }
    return result;
  }

  function validatePreference(category, key, value) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, category) ||
        !Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS[category], key)) {
      return "Unknown setting.";
    }

    const path = `${category}.${key}`;
    if (Object.prototype.hasOwnProperty.call(ENUMS, path)) {
      return ENUMS[path].includes(value) ? null : "Choose a supported option.";
    }
    if (typeof DEFAULT_SETTINGS[category][key] === "boolean") {
      return typeof value === "boolean" ? null : "Choose a valid on or off value.";
    }
    if (path === "navigation.voiceVolume") {
      return Number.isInteger(value) && value >= 0 && value <= 100
        ? null
        : "Voice volume must be between 0 and 100.";
    }
    if (path === "location.homeLocation" || path === "location.workLocation" ||
        path === "savedPlaces.home" || path === "savedPlaces.work") {
      return typeof value === "string" && value.length <= 160
        ? null
        : "Location names must be 160 characters or fewer.";
    }
    if (path === "account.profilePhoto") {
      if (value === null) return null;
      if (typeof value !== "string" || value.length > 70000 ||
          !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)) {
        return "Choose a PNG, JPEG, or WebP image smaller than 50 KB.";
      }
      return BufferlessBase64Length(value) <= 51200
        ? null
        : "Choose an image smaller than 50 KB.";
    }
    if (path === "savedPlaces.favorites" || path === "savedPlaces.savedTrips" ||
        path === "savedPlaces.customPlaces") {
      if (!Array.isArray(value) || value.length > 50) return "Keep up to 50 saved places.";
      const valid = value.every((place) =>
        isPlainObject(place) &&
        typeof place.id === "string" && place.id.length <= 80 &&
        typeof place.name === "string" && place.name.trim().length > 0 && place.name.length <= 100 &&
        typeof place.address === "string" && place.address.length <= 180
      );
      return valid ? null : "Each saved place needs a name and a valid address.";
    }
    return "Invalid setting value.";
  }

  function BufferlessBase64Length(value) {
    const encoded = value.slice(value.indexOf(",") + 1);
    return Math.floor(encoded.length * 3 / 4) - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  }

  return { DEFAULT_SETTINGS, getDefaultSettings, mergeSettings, validatePreference };
});
