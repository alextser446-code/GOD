function pick(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function hasTrait(human, trait) {
  return human.identity.personality.includes(trait);
}

function fullName(human) {
  return `${human.identity.firstName} ${human.identity.lastName}`;
}

function chooseText(human, category, options) {
  const previous = human.social.dialogueHistory[category];
  const available = options.filter((option) => option !== previous);
  const chosen = pick(available.length > 0 ? available : options);

  human.social.dialogueHistory[category] = chosen;
  return chosen;
}

function makeLine(speaker, text) {
  return {
    speakerId: speaker.id,
    text,
    duration: Math.max(1.8, Math.min(3.3, 1.35 + text.length * 0.025))
  };
}

export class HumanDialogue {
  static createIntroduction(first, second) {
    const firstIntroduction = hasTrait(first, "Shy")
      ? [
          "Hello... I'm {name}. What is your name?",
          "Good day. My name is {name}. And you?"
        ]
      : [
          "Hello there! I'm {name}. What is your name?",
          "Good day! My name is {name}. May I ask your name?",
          "Greetings! I'm {name}. Who do I have the pleasure of meeting?"
        ];

    const secondIntroduction = hasTrait(second, "Shy")
      ? [
          "I'm {name}. Nice to meet you.",
          "My name is {name}. It is good to meet you."
        ]
      : [
          "I'm {name}. Nice to meet you!",
          "My name is {name}. Pleased to meet you!",
          "I am {name}. It is a pleasure to meet you."
        ];

    const firstReaction = hasTrait(first, "Friendly")
      ? [
          "It is lovely to meet you too!",
          "The pleasure is mine!",
          "I'm glad we met!"
        ]
      : [
          "Nice to meet you too.",
          "It is good to meet you.",
          "I'm pleased to make your acquaintance."
        ];

    const questions = hasTrait(second, "Curious")
      ? [
          "What brings you here today?",
          "How has your day been so far?",
          "Have you lived around here long?"
        ]
      : [
          "How are you doing today?",
          "Has your day been going well?",
          "Are you having a pleasant day?"
        ];

    const answers = hasTrait(first, "Optimistic")
      ? [
          "Quite well, thank you. It has been a fine day.",
          "Very well, thank you! I cannot complain.",
          "I'm doing well. The day has been kind to me."
        ]
      : hasTrait(first, "Calm")
        ? [
            "I'm doing well, thank you.",
            "Quite all right, thank you for asking.",
            "Well enough, thank you. And yourself?"
          ]
        : [
            "I'm doing well, thank you for asking.",
            "Pretty well, thank you. How about you?",
            "I'm all right, thank you."
          ];

    const closings = [
      "I'm glad to hear it.",
      "That is good to hear.",
      "I hope the rest of your day goes just as well."
    ];

    return [
      makeLine(
        first,
        chooseText(first, "introduction", firstIntroduction)
          .replace("{name}", fullName(first))
      ),
      makeLine(
        second,
        chooseText(second, "introduction", secondIntroduction)
          .replace("{name}", fullName(second))
      ),
      makeLine(first, chooseText(first, "introduction-reaction", firstReaction)),
      makeLine(second, chooseText(second, "introduction-question", questions)),
      makeLine(first, chooseText(first, "introduction-answer", answers)),
      makeLine(second, chooseText(second, "introduction-closing", closings))
    ];
  }

  static createSmallTalk(first, second) {
    const greetings = hasTrait(first, "Shy")
      ? [
          "Hello again.",
          "Good to see you.",
          "It is nice to see you again."
        ]
      : hasTrait(first, "Friendly")
        ? [
            "Hey! Good to see you again!",
            "Hello, friend! How have you been?",
            "It is lovely to see you again!"
          ]
        : [
            "Hello! How have you been?",
            "Good to see you again.",
            "How has your day been?"
          ];

    const replies = hasTrait(second, "Shy")
      ? [
          "I'm well, thank you. How are you?",
          "Quite all right, thank you.",
          "I'm doing well. It is good to see you."
        ]
      : [
          "I'm doing well, thank you. How about you?",
          "Pretty well! How has your day been?",
          "I've been well. How are things with you?"
        ];

    const answers = hasTrait(first, "Optimistic")
      ? [
          "Very well! It has been a good day.",
          "I'm doing wonderfully, thank you!",
          "Quite well. I have much to be thankful for."
        ]
      : [
          "Not bad, thank you.",
          "I'm doing well, thanks for asking.",
          "Pretty well. I hope your day is going nicely too."
        ];

    const closings = hasTrait(second, "Friendly")
      ? [
          "That's good to hear!",
          "I'm glad things are going well!",
          "I hope it stays that way!"
        ]
      : [
          "That's good to hear.",
          "I hope the rest of your day goes well.",
          "It is good to hear."
        ];

    return [
      makeLine(first, chooseText(first, "small-talk-greeting", greetings)),
      makeLine(second, chooseText(second, "small-talk-reply", replies)),
      makeLine(first, chooseText(first, "small-talk-answer", answers)),
      makeLine(second, chooseText(second, "small-talk-closing", closings))
    ];
  }
}
