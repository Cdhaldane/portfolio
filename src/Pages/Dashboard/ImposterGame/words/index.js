// Word data for "Word Imposter". One file per category; each entry is
// [secret word, hint, hint, hint] — the imposter is shown one of the hints.

import movies from "./movies";
import tvShows from "./tv-shows";
import characters from "./characters";
import heroesVillains from "./heroes-villains";
import animals from "./animals";
import foodDrink from "./food-drink";
import nature from "./nature";
import fantasy from "./fantasy";
import sports from "./sports";
import hobbies from "./hobbies";
import toysGames from "./toys-games";
import videoGames from "./video-games";
import countries from "./countries";
import cities from "./cities";
import places from "./places";
import canada from "./canada";
import famousPeople from "./famous-people";
import musicians from "./musicians";
import music from "./music";
import brands from "./brands";
import household from "./household";
import jobs from "./jobs";
import vehicles from "./vehicles";
import clothing from "./clothing";
import science from "./science";
import holidays from "./holidays";
import history from "./history";
import tech from "./tech";

/* Shelves on the setup screen, in display order. */
export const GROUPS = [
  { id: "screen", name: "Screen", categories: [movies, tvShows, characters, heroesVillains] },
  { id: "play", name: "Play", categories: [sports, hobbies, toysGames, videoGames] },
  { id: "world", name: "World", categories: [countries, cities, places, canada] },
  { id: "culture", name: "People & Culture", categories: [famousPeople, musicians, music, brands] },
  { id: "everyday", name: "Everyday", categories: [household, foodDrink, clothing, jobs, vehicles] },
  { id: "beyond", name: "Nature & Beyond", categories: [animals, nature, science, fantasy] },
  { id: "then-now", name: "Then & Now", categories: [history, holidays, tech] },
];

export const CATEGORIES = GROUPS.flatMap((g) => g.categories);
