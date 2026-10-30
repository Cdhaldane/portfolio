// node --test src/Pages/Garage/car/model.test.mjs  (npm run test:car)
import { test } from "node:test";
import assert from "node:assert/strict";
import { Box3, Vector3 } from "three";
import { RIDE_DROP, buildCar } from "./model.mjs";
import { AREAS, MODS, OVERVIEW, cameraFrom } from "./mods.mjs";
import { DIM, T, controls, endX, stations } from "./shape.mjs";

const car = buildCar();
car.updateMatrixWorld(true);

const meshes = [];
car.traverse((o) => o.isMesh && meshes.push(o));

const boxOf = (filter) => {
  const box = new Box3();
  for (const m of meshes.filter(filter)) box.expandByObject(m);
  return box;
};

test("every mod is on the list once, in a known area, with a view", () => {
  assert.equal(MODS.length, 14);
  assert.equal(new Set(MODS.map((m) => m.id)).size, MODS.length);
  const areas = new Set(AREAS.map((a) => a.key));
  for (const m of MODS) {
    assert.ok(areas.has(m.area), m.id);
    assert.ok(m.parts.length > 0, m.id);
    assert.ok([null, "hood", "xray", "cabin"].includes(m.reveal), m.id);
    assert.ok(m.view.dist > 1 && m.view.pitch >= -5 && m.view.pitch <= 89, m.id);
  }
});

test("every mod's parts exist on the model, and every tagged part belongs to a mod", () => {
  const tagged = new Set(meshes.map((m) => m.userData.part).filter(Boolean));
  const claimed = new Set(MODS.flatMap((m) => m.parts));
  for (const p of claimed) assert.ok(tagged.has(p), `no mesh tagged "${p}"`);
  for (const p of tagged) assert.ok(claimed.has(p), `"${p}" is tagged but no mod claims it`);
});

test("every mesh has a material key and finite geometry", () => {
  for (const m of meshes) {
    assert.equal(typeof m.userData.mat, "string");
    const a = m.geometry.attributes.position.array;
    for (let i = 0; i < a.length; i++) assert.ok(Number.isFinite(a[i]), `${m.userData.mat} has a NaN`);
  }
});

test("the body is a Golf R's size", () => {
  const body = boxOf((m) => m.userData.part === "wrap" && m.name !== "handle");
  const size = body.getSize(new Vector3());
  assert.ok(Math.abs(size.x - 4.276) < 0.02, `length ${size.x}`);
  assert.ok(size.y < 1.44 && size.y > 1.2, `height above the sills ${size.y}`);
  assert.ok(size.z < 1.81 && size.z > 1.76, `width ${size.z}`);
  assert.ok(body.max.y <= 1.44, `roof at ${body.max.y}`);
});

test("the wheels sit on the ground, inside the arches", () => {
  const wheels = boxOf((m) => m.userData.part === "wheels");
  assert.ok(Math.abs(wheels.min.y) < 0.005, `lowest tire point ${wheels.min.y}`);
  // Lowered, but the tire still clears the arch with a finger's gap.
  assert.ok(DIM.tireR * 2 < DIM.archY - RIDE_DROP + DIM.archR - 0.025, "tire top clears the arch");
  const body = boxOf((m) => m.userData.part === "wrap");
  assert.ok(body.min.y > 0.1, `body floor at ${body.min.y}`);
  assert.ok(wheels.max.z < 0.9, `wheels poke out to ${wheels.max.z}`);
});

test("sections stay in order from floor to roof", () => {
  for (const x of stations()) {
    const c = controls(x);
    const y = (i) => c[i][1];
    assert.ok(y(T.shoulder) >= y(T.lip) - 1e-9, `shoulder under the arch lip at ${x}`);
    assert.ok(y(T.belt) >= y(T.shoulder) - 1e-9, `belt under shoulder at ${x}`);
    assert.ok(y(T.roofEdge) >= y(T.belt) - 1e-9, `roof edge under belt at ${x}`);
    assert.ok(y(T.top) >= y(T.roofEdge) - 1e-9, `top under roof edge at ${x}`);
  }
});

test("the lights and intakes land on the nose and tail", () => {
  for (const [y, z] of [
    [0.665, 0.44], [0.81, 0.64], [0.8, 0.83], [0.245, 0.42], [0.47, 0.77], [0.2, 0.8],
  ]) {
    assert.ok(endX(y, z, 1) > 1.9, `nose at (${y}, ${z})`);
  }
  for (const [y, z] of [
    [0.983, 0.6], [0.978, 0.84], [0.858, 0.852], [0.3, 0.42], [0.3, 0.8], [0.45, 0.16], [0.6, 0.16],
  ]) {
    assert.ok(endX(y, z, -1) < -1.9, `tail at (${y}, ${z})`);
  }
});

test("opening the hood lifts its leading edge", () => {
  const hood = meshes.find((m) => m.userData.part === "hood");
  const shut = new Box3().setFromObject(hood).max.y;
  car.userData.openHood(1);
  car.updateMatrixWorld(true);
  const open = new Box3().setFromObject(hood).max.y;
  car.userData.openHood(0);
  car.updateMatrixWorld(true);
  assert.ok(open > shut + 0.6, `hood top went from ${shut} to ${open}`);
});

test("the driver sits on the left, at -z", () => {
  const wheel = boxOf((m) => m.userData.part === "steering");
  const airbox = boxOf((m) => m.userData.part === "intake");
  assert.ok(wheel.max.z < 0, `steering wheel reaches z ${wheel.max.z}`);
  assert.ok(airbox.max.z < 0, "the airbox is on the driver's side");
});

test("stickers carry a layout, and never a plate number or a VIN", () => {
  const stickers = meshes.filter((m) => m.userData.mat === "sticker");
  assert.ok(stickers.length >= 6);
  for (const m of stickers) {
    const spec = m.userData.sticker;
    assert.ok(spec.w > 0 && spec.h > 0 && m.geometry.attributes.uv, "sized, with UVs");
    for (const l of spec.lines || []) {
      const t = l.text.replace(/\s+/g, "");
      assert.ok(!/^[A-Z]{4}\d{3}$/.test(t), `"${l.text}" looks like an Ontario plate`);
      assert.ok(!/^[A-HJ-NPR-Z0-9]{17}$/.test(t), `"${l.text}" looks like a VIN`);
    }
  }
});

test("the rig's yaw 0 looks at the nose and 90 at the passenger side", () => {
  const front = cameraFrom({ ...OVERVIEW, yaw: 0, pitch: 0 }).position;
  const side = cameraFrom({ ...OVERVIEW, yaw: 90, pitch: 0 }).position;
  assert.ok(front[0] > 6 && Math.abs(front[2]) < 1e-9);
  assert.ok(side[2] > 6 && Math.abs(side[0]) < 1e-9);
});
