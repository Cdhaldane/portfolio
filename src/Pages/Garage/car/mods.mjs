/*
 * The Golf R's build: every mod on the car, in the order of the build list,
 * and where each one lives on the 3D model. No three.js here, so the page can
 * list the mods without loading the renderer.
 *
 * `parts` are the userData.part tags in model.mjs that light up. `reveal` is
 * what the scene has to do to show them: lift the hood, x-ray the body, or
 * clear the glass. `view` frames them with the page's orbit rig: yaw is
 * degrees round the car (0 looks at the nose, 90 at the driver's side),
 * pitch is degrees above the horizon, dist is metres from the target.
 *
 * Values and the VIN stay off this list on purpose: the repo is public.
 */

export const AREAS = [
  { key: "performance", label: "Performance" },
  { key: "exterior", label: "Exterior" },
  { key: "interior", label: "Interior" },
];

export const MODS = [
  {
    id: "exhaust",
    area: "performance",
    name: "Cat-back exhaust",
    brand: "Nameless Performance",
    note: "Everything behind the cats: the mid-pipe, the rear silencer and the four tips.",
    parts: ["exhaust"],
    reveal: "xray",
    view: { yaw: 212, pitch: 9, dist: 4.1, target: [-1.25, 0.32, 0] },
  },
  {
    id: "downpipe",
    area: "performance",
    name: "Catted downpipe",
    brand: "CTS Turbo",
    note: "A wider pipe straight off the turbo, with a high-flow cat in place of the factory one.",
    parts: ["downpipe"],
    reveal: "xray",
    view: { yaw: 142, pitch: 16, dist: 2.7, target: [0.8, 0.34, -0.05] },
  },
  {
    id: "inlet",
    area: "performance",
    name: "Turbo inlet pipe",
    brand: "Aftermarket",
    note: "Replaces the factory plastic pipe between the air filter and the turbo.",
    parts: ["inlet"],
    reveal: "hood",
    view: { yaw: 52, pitch: 46, dist: 2.7, target: [1.25, 0.68, 0.05] },
  },
  {
    id: "intake",
    area: "performance",
    name: "Carbon cold air intake",
    brand: "Unitronic",
    note: "A carbon fibre airbox and cone filter feeding the turbo.",
    parts: ["intake"],
    reveal: "hood",
    view: { yaw: 38, pitch: 44, dist: 2.6, target: [1.35, 0.72, 0.32] },
  },
  {
    id: "coils",
    area: "performance",
    name: "Ignition coils",
    brand: "APR",
    note: "Coil packs built for the cylinder pressures of a Stage 2 tune.",
    parts: ["coils"],
    reveal: "hood",
    view: { yaw: 12, pitch: 52, dist: 2.3, target: [1.38, 0.76, -0.22] },
  },
  {
    id: "tune",
    area: "performance",
    name: "Stage 2 tune, ECU + TCU",
    brand: "EQT",
    note: "Equilibrium Tuning maps for the engine and the DSG, flashed with the Accessport.",
    parts: ["tune"],
    reveal: "hood",
    view: { yaw: 62, pitch: 40, dist: 2.9, target: [1.0, 0.7, 0.45] },
  },
  {
    id: "hood",
    area: "exterior",
    name: "Forged carbon hood",
    brand: "Forged carbon fibre",
    note: "The whole hood skin in forged carbon, the chopped-fibre marble look.",
    parts: ["hood"],
    reveal: null,
    view: { yaw: 22, pitch: 30, dist: 4.4, target: [1.3, 0.78, 0] },
  },
  {
    id: "spoiler",
    area: "exterior",
    name: "Carbon rear spoiler",
    brand: "Carbon fibre",
    note: "Twill-weave carbon in place of the factory roof spoiler.",
    parts: ["spoiler"],
    reveal: null,
    view: { yaw: 208, pitch: 26, dist: 3.7, target: [-1.8, 1.25, 0] },
  },
  {
    id: "diffuser",
    area: "exterior",
    name: "Rear diffuser",
    brand: "Maxton Design",
    note: "Gloss black fins along the bottom of the rear bumper, framing the tips.",
    parts: ["diffuser"],
    reveal: null,
    view: { yaw: 198, pitch: 7, dist: 3.0, target: [-2.0, 0.34, 0] },
  },
  {
    id: "mirrors",
    area: "exterior",
    name: "Mirror caps",
    brand: "Forged carbon fibre",
    note: "Forged carbon shells over both door mirrors.",
    parts: ["mirrors"],
    reveal: null,
    view: { yaw: 24, pitch: 10, dist: 1.9, target: [0.47, 1.03, 0.92] },
  },
  {
    id: "wheels",
    area: "exterior",
    name: "Wheels and tires",
    brand: "Superspeed · Indy 500",
    note: "Gloss black flow-formed wheels on Indy 500 tires.",
    parts: ["wheels"],
    reveal: null,
    view: { yaw: 70, pitch: 6, dist: 2.8, target: [1.25, 0.33, 0.78] },
  },
  {
    id: "wrap",
    area: "exterior",
    name: "Gloss sky blue wrap",
    brand: "Avery Dennison",
    note: "Gloss film over every painted panel, applied in 2023 by Carbon Detailing Canada in Milton.",
    parts: ["wrap"],
    reveal: null,
    view: { yaw: 62, pitch: 13, dist: 6.4, target: [0, 0.62, 0] },
  },
  {
    id: "steering",
    area: "interior",
    name: "Forged carbon steering wheel",
    brand: "Forged carbon fibre",
    note: "A forged carbon rim top and bottom, leather where your hands sit.",
    parts: ["steering"],
    reveal: "cabin",
    view: { yaw: 100, pitch: 15, dist: 1.5, target: [0.08, 0.92, 0.37] },
  },
  {
    id: "paddles",
    area: "interior",
    name: "Magnetic shift paddles",
    brand: "Carbon fibre",
    note: "Longer carbon paddles that click onto the DSG's shifters with magnets.",
    parts: ["paddles"],
    reveal: "cabin",
    view: { yaw: 100, pitch: 12, dist: 1.5, target: [0.12, 0.92, 0.37] },
  },
];

export const MOD_BY_ID = Object.fromEntries(MODS.map((m) => [m.id, m]));

/** The resting three-quarter view, front left. */
export const OVERVIEW = { yaw: 38, pitch: 12, dist: 6.6, target: [0, 0.62, 0] };

const RAD = Math.PI / 180;

/** Camera position and target for a rig view. */
export function cameraFrom({ yaw, pitch, dist, target }) {
  const cp = Math.cos(pitch * RAD);
  return {
    position: [
      target[0] + dist * cp * Math.cos(yaw * RAD),
      target[1] + dist * Math.sin(pitch * RAD),
      target[2] + dist * cp * Math.sin(yaw * RAD),
    ],
    target,
  };
}
