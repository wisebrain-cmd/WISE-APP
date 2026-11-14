(() => {
  "use strict";

  const defaults = {
    map: {
      defaultType: "standard",
      showTraffic: false,
      showTransit: false,
      showBicycleRoutes: false,
      showWalkingRoutes: false,
      showLandmarks: true,
      showBusinesses: true,
      buildings3d: false,
      labels: true,
      autoRotate: false
    },
    navigation: {
      travelMode: "driving",
      routePreference: "balanced",
      avoidTolls: false,
      avoidHighways: false,
      avoidFerries: false,
      preferFaster: true,
      voiceNavigation: false,
      voiceVolume: 70,
      navigationNotifications: true,
      autoStart: false
    },
    location: {
      locationAccess: false,
      useCurrentLocation: false,
      locationAccuracy: "precise",
      locationHistory: false,
      savedLocationsEnabled: true,
      managePermissions: "browser"
    },
    discovery: {
      nearbyPlaces: true,
      restaurantPreferences: "any",
      hotelPreferences: "any",
      shoppingPreferences: "any",
      attractions: true,
      recommendedPlaces: true,
      personalizedRecommendations: false,
      searchHistory: true
    },
    notifications: {
      agentNotifications: true,
      trafficAlerts: true,
      routeChanges: true,
      nearbyPlaces: false,
      travelRecommendations: false,
      promotions: false,
      accountNotifications: true,
      emailNotifications: false,
      pushNotifications: false
    },
    appearance: {
      theme: "system",
      accent: "sage",
      mapAppearance: "automatic",
      language: "en",
      units: "kilometers",
      temperatureUnits: "celsius",
      fontSize: "standard",
      timeZone: "UTC",
      dateFormat: "iso",
      timeFormat: "24h"
    },
    privacy: {
      privacyControls: "balanced",
      locationSharing: false,
      locationHistory: false,
      searchHistory: true,
      dataCollection: false,
      personalization: false
    },
    savedPlaces: {
      homeLocation: "",
      workLocation: "",
      favorites: "",
      savedTrips: "",
      customPlaces: ""
    },
    offlineMaps: {
      automaticUpdates: false
    },
    accessibility: {
      largerText: false,
      highContrast: false,
      reducedMotion: false,
      screenReaderSupport: true,
      voiceGuidance: false,
      accessibleRoutes: false
    }
  };

  const choices = {
    "map.defaultType": ["standard", "satellite", "terrain"],
    "navigation.travelMode": ["driving", "walking", "cycling", "transit"],
    "navigation.routePreference": ["balanced", "scenic", "fastest"],
    "location.locationAccuracy": ["precise", "approximate"],
    "location.managePermissions": ["browser"],
    "discovery.restaurantPreferences": ["any", "vegetarian", "vegan", "gluten-free", "family-friendly"],
    "discovery.hotelPreferences": ["any", "budget", "midrange", "luxury", "accessible"],
    "discovery.shoppingPreferences": ["any", "local", "markets", "malls", "outlets"],
    "appearance.theme": ["light", "dark", "system"],
    "appearance.accent": ["sage", "terracotta", "ocean", "plum"],
    "appearance.mapAppearance": ["automatic", "day", "night"],
    "appearance.language": ["en"],
    "appearance.units": ["kilometers", "miles"],
    "appearance.temperatureUnits": ["celsius", "fahrenheit"],
    "appearance.fontSize": ["compact", "standard", "large"],
    "appearance.timeZone": ["UTC", "Atlantic/Reykjavik", "Europe/London", "Europe/Paris", "America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Australia/Sydney"],
    "appearance.dateFormat": ["iso", "dmy", "mdy"],
    "appearance.timeFormat": ["12h", "24h"],
    "privacy.privacyControls": ["balanced", "minimal"]
  };

  const api = { defaults, choices };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.WseSettingsSchema = api;
})();
