const FIRST_NAMES = {
  Male: [
    "Edmund", "Arthur", "Edward", "William",
    "Henry", "Geoffrey", "Thomas", "Richard"
  ],
  Female: [
    "Alice", "Eleanor", "Matilda", "Isabel",
    "Agnes", "Margaret", "Joan", "Cecily"
  ]
};

const LAST_NAMES = [
  "Oakley", "Fletcher", "Bennett", "of Linden",
  "Ashford", "Silverbrook", "Rosewood", "Stonebridge"
];

const PERSONALITY_GROUPS = [
  ["Friendly", "Generous", "Optimistic", "Curious", "Calm", "Hardworking", "Intelligent"],
  ["Shy", "Calm", "Fearful", "Patient", "Pessimistic", "Curious", "Clumsy"],
  ["Brave", "Curious", "Hardworking", "Optimistic", "Impatient", "Aggressive", "Intelligent"],
  ["Hardworking", "Intelligent", "Patient", "Calm", "Friendly", "Generous", "Curious"],
  ["Lazy", "Calm", "Selfish", "Clumsy", "Pessimistic", "Impatient"],
  ["Fearful", "Shy", "Pessimistic", "Selfish", "Lazy", "Calm", "Clumsy"]
];

function pick(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function createPersonality() {
  const group = [...pick(PERSONALITY_GROUPS)];

  for (let index = group.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [group[index], group[swapIndex]] = [group[swapIndex], group[index]];
  }

  const traitCount = 1 + Math.floor(Math.random() * 4);
  return group.slice(0, traitCount);
}

function calculateLeadership(personality) {
  let value = 45 + Math.floor(Math.random() * 21);
  const traits = new Set(personality);

  if (traits.has("Brave")) value += 16;
  if (traits.has("Friendly")) value += 10;
  if (traits.has("Calm")) value += 8;
  if (traits.has("Hardworking")) value += 12;
  if (traits.has("Intelligent")) value += 8;
  if (traits.has("Optimistic")) value += 4;
  if (traits.has("Shy")) value -= 6;
  if (traits.has("Fearful")) value -= 10;
  if (traits.has("Lazy")) value -= 12;
  if (traits.has("Aggressive")) value -= 3;

  return Math.max(0, Math.min(100, value));
}

export function createHumanIdentity(id) {
  const gender = Math.random() < 0.5 ? "Male" : "Female";
  const personality = createPersonality();

  return {
    id,
    firstName: pick(FIRST_NAMES[gender]),
    lastName: pick(LAST_NAMES),
    age: 18 + Math.floor(Math.random() * 43),
    gender,
    personality,
    health: 100,
    strength: 1 + Math.floor(Math.random() * 100),
    leadership: calculateLeadership(personality)
  };
}
