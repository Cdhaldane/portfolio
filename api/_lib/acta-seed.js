// Starting content for Acta Diurna. NOT an endpoint.
//
// SEASON_ONE is inserted as a *proposed* season the first time the tables are
// created, so Charlie approves it on the desk like any season Claude drafts.
// SEED_LESSONS are finished, hand-checked lessons keyed by topic slug: when a
// season containing one is approved, that lesson goes straight to "ready"
// instead of being generated (and if one is written after its season was
// approved, the next pipeline pass picks it up). Week 1 of Season 1 is all
// hand-written. The Salamis file is also the page's sample lesson, shown
// before any lesson has gone live.
//
// Static requires (not a directory scan) so Vercel's bundler traces them.
const salamis = require("../../src/Pages/Acta/lessons/salamis.json");
const themistocles = require("../../src/Pages/Acta/lessons/themistocles.json");
const delphi = require("../../src/Pages/Acta/lessons/delphi.json");
const ostracism = require("../../src/Pages/Acta/lessons/ostracism.json");
const trireme = require("../../src/Pages/Acta/lessons/the-trireme.json");
const confucius = require("../../src/Pages/Acta/lessons/confucius.json");

const t = (kind, title, era, year, yearLabel, wiki, focus, slug) => ({
  kind,
  title,
  era,
  year,
  yearLabel,
  wiki,
  focus,
  ...(slug ? { slug } : {}),
});

const SEASON_ONE = {
  number: 1,
  title: "Greece and Persia",
  span: "539–429 BC",
  intro:
    "The century when a few quarrelling Greek cities beat the largest empire on earth, and what they did with the victory.",
  weeks: [
    {
      theme: "The Persian Wars",
      topics: [
        t("person", "Themistocles", "greece", -480, "c. 524–459 BC", ["Themistocles"],
          "The politician who saw the threat coming by sea and spent Athens' silver on ships. Turn it on his gamble before Salamis and his fall afterwards."),
        t("place", "Delphi", "greece", -480, "8th century BC – AD 390s", ["Delphi", "Pythia"],
          "Why every Greek state asked the oracle before acting, how a consultation worked, and what the 'wooden wall' answer did in 480 BC."),
        t("moment", "Salamis, 480 BC", "greece", -480, "480 BC", ["Battle of Salamis"],
          "The night Themistocles tricked Xerxes into the narrows and the morning the Greek fleet won there.", "salamis"),
        t("idea", "Ostracism", "greece", -487, "487–417 BC", ["Ostracism"],
          "How Athenians voted a citizen into ten years of exile with broken pots, why the system existed, and how it ended up exiling Themistocles."),
        t("object", "The trireme", "greece", -480, "5th century BC", ["Trireme"],
          "The oared warship that won Salamis: how it was built and rowed, how ramming worked, and what the replica Olympias taught us."),
        t("meanwhile", "Confucius", "east", -479, "551–479 BC", ["Confucius"],
          "While Greece fought Persia, a teacher in the state of Lu died thinking he had failed. How his ideas outlasted every empire of his age."),
      ],
    },
    {
      theme: "Athens at its height",
      topics: [
        t("person", "Pericles", "greece", -450, "c. 495–429 BC", ["Pericles"],
          "The general who led Athens through its golden age and into the war that ended it."),
        t("place", "The Acropolis", "greece", -447, "Parthenon begun 447 BC", ["Acropolis of Athens", "Parthenon"],
          "How the ruin the Persians left became Pericles' building programme, and what has happened to the Parthenon since."),
        t("moment", "The plague of Athens, 430 BC", "greece", -430, "430 BC", ["Plague of Athens"],
          "Thucydides caught the epidemic, survived, and wrote down its symptoms. What it did to the city and to Pericles."),
        t("idea", "Herodotus invents history", "greece", -430, "c. 430 BC", ["Herodotus", "Histories (Herodotus)"],
          "Why a man from Halicarnassus set out to find out what really happened in the Persian Wars, and how his 'inquiry' became history."),
        t("object", "The owl tetradrachm", "greece", -449, "5th century BC", ["Tetradrachm", "Owl of Athena"],
          "The silver coin stamped with Athena's owl, struck from Laurion silver, that paid for the fleet and was trusted across the Mediterranean."),
        t("meanwhile", "The Buddha", "east", -480, "c. 5th century BC", ["The Buddha"],
          "In the Ganges valley, in roughly the same decades, a prince gave up his inheritance to work out why people suffer."),
      ],
    },
    {
      theme: "The Persian Empire",
      topics: [
        t("person", "Darius the Great", "ancient", -500, "c. 550–486 BC", ["Darius the Great"],
          "How a king with a disputed claim organised the largest empire yet, and why he sent an army to Marathon."),
        t("place", "Persepolis", "ancient", -518, "begun c. 518 BC", ["Persepolis"],
          "The ceremonial capital whose carved stairways show the empire's peoples bringing gifts, and the night Alexander burned it."),
        t("moment", "Marathon, 490 BC", "greece", -490, "490 BC", ["Battle of Marathon"],
          "The morning Athenian hoplites charged a Persian landing force, and how much of the legend, the runner included, holds up."),
        t("idea", "Satraps and the Royal Road", "ancient", -500, "6th–4th century BC", ["Satrap", "Royal Road"],
          "How Persia governed dozens of peoples through governors, roads and relay riders, and what its famous tolerance did and didn't mean."),
        t("object", "The Cyrus Cylinder", "ancient", -539, "539 BC", ["Cyrus Cylinder"],
          "A clay barrel from Babylon that has been called the first charter of human rights. What it actually says and why that claim is argued over."),
        t("meanwhile", "Himera, 480 BC", "greece", -480, "480 BC", ["Battle of Himera (480 BC)"],
          "In the same year as Salamis, Sicilian Greeks beat a Carthaginian army; Herodotus says on the same day. What was happening in the western Mediterranean."),
      ],
    },
    {
      theme: "Sparta",
      topics: [
        t("person", "Leonidas", "greece", -480, "died 480 BC", ["Leonidas I"],
          "The Spartan king who took 300 men north knowing what was coming. Separating him from the legend."),
        t("place", "Sparta", "greece", -480, "Classical Sparta", ["Sparta"],
          "A city without walls run like a barracks, built on the labour of the helots it feared. What the Spartans were really like."),
        t("moment", "Thermopylae, 480 BC", "greece", -480, "480 BC", ["Battle of Thermopylae"],
          "Three days in a narrow pass, the mountain path around it, and why a defeat became history's most famous last stand."),
        t("idea", "The hoplite phalanx", "greece", -650, "7th–4th century BC", ["Hoplite", "Phalanx"],
          "How citizens fighting shoulder to shoulder behind a wall of shields shaped Greek politics as much as Greek war."),
        t("object", "The Corinthian helmet", "greece", -600, "7th–5th century BC", ["Corinthian helmet"],
          "The bronze helmet that became the face of Greek war, how it was made, and what wearing one did to a fighter."),
        t("meanwhile", "The Nok culture", "ancient", -500, "1st millennium BC", ["Nok culture"],
          "In what is now Nigeria, people were smelting iron and modelling terracotta heads. What archaeologists know, and what looting has cost them."),
      ],
    },
    {
      theme: "After the war",
      topics: [
        t("person", "Aeschylus", "greece", -472, "c. 525–456 BC", ["Aeschylus", "The Persians"],
          "A veteran of Marathon who turned the war into tragedy, and wrote The Persians from the losers' side."),
        t("place", "Olympia", "greece", -472, "776 BC – AD 393", ["Olympia, Greece", "Ancient Olympic Games"],
          "The sanctuary where Greek states that fought each other met every four years, and what the Games actually looked like."),
        t("moment", "Plataea, 479 BC", "greece", -479, "479 BC", ["Battle of Plataea"],
          "The land battle that actually ended the invasion: a muddled fight the Greeks nearly lost before they won it."),
        t("idea", "Athenian democracy", "greece", -462, "508–322 BC", ["Athenian democracy"],
          "How tens of thousands of citizens ran a state themselves: the Assembly, the lottery, pay for jurors, and who was left out."),
        t("object", "The Riace bronzes", "greece", -450, "c. 460–450 BC", ["Riace bronzes"],
          "Two bronze warriors found by a snorkeller off Calabria in 1972, and what they show about Greek art that marble copies can't."),
        t("meanwhile", "The Art of War", "east", -500, "5th century BC (traditional)", ["The Art of War"],
          "While Greek generals trusted the shield wall, a Chinese text argued that the best victory needs no battle at all. Who wrote it and why it lasted."),
      ],
    },
  ],
};

/** Hand-written, hand-checked lessons, keyed by topic slug. */
const SEED_LESSONS = Object.fromEntries(
  [themistocles, delphi, salamis, ostracism, trireme, confucius].map((l) => [l.slug, l])
);

module.exports = { SEASON_ONE, SEED_LESSONS };
