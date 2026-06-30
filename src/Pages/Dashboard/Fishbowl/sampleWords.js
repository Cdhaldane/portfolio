// Optional starter words for "Fishbowl" — players normally fill the bowl
// themselves, but this seeds a quick game (or a solo demo) with a tap.
// Famous people, characters, places, and things that are fun to act out.

export const SAMPLE_WORDS = [
  "Albert Einstein",
  "Beyoncé",
  "Sherlock Holmes",
  "The Eiffel Tower",
  "A black hole",
  "Spider-Man",
  "Cleopatra",
  "Mount Everest",
  "Harry Potter",
  "The Mona Lisa",
  "A unicorn",
  "Charlie Chaplin",
  "Pikachu",
  "The Loch Ness Monster",
  "A roller coaster",
  "Darth Vader",
  "The Great Wall of China",
  "A jellyfish",
  "Lady Gaga",
  "A time machine",
  "Bigfoot",
  "The Statue of Liberty",
  "A vending machine",
  "Gandalf",
  "A boomerang",
  "Marie Curie",
  "The Titanic",
  "A disco ball",
  "Yoda",
  "A kangaroo",
];

// Fisher–Yates shuffle, returning a new array (never mutates the source).
export const shuffle = (arr) => {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};
