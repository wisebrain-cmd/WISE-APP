const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildOverpassQuery, normalizeOverpassElements, parseMapBounds } = require("./map-location-service");

test("destination catalog contains thousands of geographically distributed real places", () => {
  const places = JSON.parse(fs.readFileSync(path.join(__dirname, "locations.json"), "utf8"));
  assert.ok(places.length > 1000);
  assert.ok(new Set(places.map(place => place.countryCode)).size > 100);
  assert.ok(places.some(place => place.latitude < -30));
  assert.ok(places.some(place => place.latitude > 60));
  assert.ok(places.some(place => place.longitude < -100));
  assert.ok(places.some(place => place.longitude > 100));
  assert.ok(places.every(place => place.id.startsWith("geonames-")
    && place.name && place.countryCode && Number.isFinite(place.population)
    && Number.isFinite(place.latitude) && Number.isFinite(place.longitude)));
});

test("map bounds are validated and dateline-crossing bounds are split safely", () => {
  assert.deepEqual(parseMapBounds("-5,176,5,-176"), [
    [-5, 176, 5, 180],
    [-5, -180, 5, -176]
  ]);
  assert.deepEqual(parseMapBounds("1,2,3,4"), [[1, 2, 3, 4]]);
  assert.throws(() => parseMapBounds("not-bounds"), { statusCode: 400 });
  assert.throws(() => parseMapBounds("1,,3,4"), { statusCode: 400 });
  assert.throws(() => parseMapBounds("-10,-10,10,10"), { statusCode: 400 });
});

test("Overpass queries request named, mapped attractions without user-controlled query text", () => {
  const query = buildOverpassQuery([[1, 2, 3, 4]]);
  assert.match(query, /tourism/);
  assert.match(query, /historic/);
  assert.match(query, /out center tags 300/);
  assert.doesNotMatch(query, /not-user-input/);
});

test("Overpass results include only named features with valid coordinates and stable ids", () => {
  const places = normalizeOverpassElements([
    { type: "node", id: 21, lat: 10, lon: 20, tags: { name: "Old Fort", historic: "fort", description: "Built in 1800." } },
    { type: "way", id: 22, center: { lat: 11, lon: 21 }, tags: { name: "City Garden", leisure: "garden", website: "www.example.org" } },
    { type: "node", id: 23, lat: 91, lon: 20, tags: { name: "Invalid" } },
    { type: "node", id: 24, lat: 10, lon: 20, tags: { historic: "ruins" } },
    { type: "node", id: 25, lat: 10, lon: 20, tags: { name: "Untrusted Site", tourism: "attraction", website: "javascript:alert(1)" } }
  ]);
  assert.equal(places.length, 3);
  assert.equal(places[0].id, "osm-node-21");
  assert.equal(places[0].category, "fort");
  assert.equal(places[0].description, "Built in 1800.");
  assert.equal(places[1].latitude, 11);
  assert.equal(places[1].website, "https://www.example.org/");
  assert.equal(places[2].website, "");
});
