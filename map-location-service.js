const TOURISM_VALUES = "attraction|museum|gallery|viewpoint|zoo|theme_park|aquarium|artwork|information|picnic_site";
const LEISURE_VALUES = "park|garden|nature_reserve";
const NATURAL_VALUES = "beach|peak|cave_entrance|hot_spring";

function invalidBounds(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function parseMapBounds(value) {
  if (typeof value !== "string") {
    throw invalidBounds("Provide map bounds as south,west,north,east.");
  }
  const coordinates = value.split(",");
  const bounds = coordinates.map(Number);
  if (bounds.length !== 4 || coordinates.some(coordinate => !coordinate.trim())
    || bounds.some(number => !Number.isFinite(number))) {
    throw invalidBounds("Map bounds must contain four valid coordinates.");
  }

  const [south, west, north, east] = bounds;
  const height = north - south;
  const width = east >= west ? east - west : 360 - west + east;
  if (south < -85 || north > 85 || south >= north
    || west < -180 || west > 180 || east < -180 || east > 180
    || width <= 0 || width > 12 || height > 12) {
    throw invalidBounds("Zoom in to an area no larger than 12 degrees.");
  }

  if (east >= west) return [[south, west, north, east]];
  return [[south, west, north, 180], [south, -180, north, east]];
}

function buildOverpassQuery(boxes) {
  const selectors = boxes.flatMap(([south, west, north, east]) => {
    const box = [south, west, north, east].join(",");
    return [
      `nwr["name"]["tourism"~"^(${TOURISM_VALUES})$"](${box});`,
      `nwr["name"]["historic"](${box});`,
      `nwr["name"]["leisure"~"^(${LEISURE_VALUES})$"](${box});`,
      `nwr["name"]["natural"~"^(${NATURAL_VALUES})$"](${box});`,
      `nwr["name"]["amenity"="place_of_worship"](${box});`
    ];
  });
  return `[out:json][timeout:20];(${selectors.join("")});out center tags 300;`;
}

function cleanTag(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanWebsite(value) {
  const rawUrl = cleanTag(value, 300);
  if (!rawUrl) return "";
  try {
    const url = new URL(rawUrl.startsWith("www.") ? `https://${rawUrl}` : rawUrl);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function normalizeOverpassElements(elements) {
  if (!Array.isArray(elements)) return [];
  const places = new Map();
  for (const element of elements) {
    const tags = element?.tags;
    const name = cleanTag(tags?.name, 160);
    const type = element?.type;
    const id = element?.id;
    const latitude = Number.isFinite(element?.lat) ? element.lat : element?.center?.lat;
    const longitude = Number.isFinite(element?.lon) ? element.lon : element?.center?.lon;
    if (!name || !["node", "way", "relation"].includes(type) || !Number.isSafeInteger(id)
      || !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      continue;
    }

    const category = tags.tourism || tags.historic || tags.leisure || tags.natural || tags.amenity || "attraction";
    places.set(`${type}-${id}`, {
      id: `osm-${type}-${id}`,
      name,
      category: cleanTag(category, 80).replaceAll("_", " "),
      latitude,
      longitude,
      description: cleanTag(tags.description || tags.inscription, 600),
      openingHours: cleanTag(tags.opening_hours, 160),
      website: cleanWebsite(tags.website || tags["contact:website"]),
      wikipedia: cleanTag(tags.wikipedia, 160),
      source: "OpenStreetMap"
    });
  }
  return [...places.values()];
}

module.exports = { buildOverpassQuery, normalizeOverpassElements, parseMapBounds };
