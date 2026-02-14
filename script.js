const adventures = [
  {
    id: "adv-001",
    title: "Sunrise Rooftop Sketch",
    description: "Pack a small sketchbook and catch the first light from a nearby rooftop.",
    category: "Creative",
    effortLevel: "Low",
    location: {
      name: "Northbridge Rooftop",
      latitude: 47.6062,
      longitude: -122.3321,
    },
    completed: false,
  },
  {
    id: "adv-002",
    title: "Hidden Alley Coffee Loop",
    description: "Walk a short loop of alley cafes and journal one new detail in each.",
    category: "Food & Drink",
    effortLevel: "Medium",
    location: {
      name: "Old Town Alleyways",
      latitude: 45.5234,
      longitude: -122.6762,
    },
    completed: true,
  },
  {
    id: "adv-003",
    title: "Pocket Park Picnic",
    description: "Grab a snack and find a tucked-away park bench to reset your day.",
    category: "Nature",
    effortLevel: "Low",
    location: {
      name: "Willow Pocket Park",
      latitude: 40.7128,
      longitude: -74.006,
    },
    completed: false,
  },
];

const grid = document.getElementById("adventures-grid");

function renderAdventures(items) {
  grid.innerHTML = "";

  items.forEach((adventure) => {
    const card = document.createElement("article");
    card.className = "adventure-card";

    card.innerHTML = `
      <div class="adventure-top">
        <h3>${adventure.title}</h3>
        <span class="adventure-status" data-completed="${adventure.completed}">
          ${adventure.completed ? "Completed" : "In progress"}
        </span>
      </div>
      <p class="adventure-description">${adventure.description}</p>
      <div class="adventure-meta">
        <span>${adventure.category}</span>
        <span>${adventure.effortLevel} effort</span>
      </div>
      <div class="adventure-location">
        <strong>${adventure.location.name}</strong>
        <span>
          ${adventure.location.latitude.toFixed(4)}, ${adventure.location.longitude.toFixed(4)}
        </span>
      </div>
    `;

    grid.appendChild(card);
  });
}

renderAdventures(adventures);
