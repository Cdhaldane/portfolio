import {
  CARD_RATIO,
  PERSPECTIVE,
  HAND_TILT,
  INSPECT_TILT,
  cardWidthFor,
  stageBox,
  handLayout,
  ripLayout,
  zComp,
  prand,
  fanPose,
  poseFor,
  fanBounds,
  nearestFanIndex,
  cloudPose,
  homePose,
  sidePose,
} from "./poses";

const rad = (deg) => (deg * Math.PI) / 180;
// scale() doesn't touch Z, so a tilted card's depth swing uses its UNSCALED
// size, corner to corner.
const reach = (L, tilt) => Math.sin(rad(tilt.y)) * (L.cw / 2) + Math.sin(rad(tilt.x)) * (L.ch / 2);

const layoutFor = (vw, vh) => {
  const { w, h } = stageBox(vw, vh);
  return handLayout({ stageW: w, stageH: h, cw: cardWidthFor(vw) });
};

describe("sizing", () => {
  test("card width clamps between 248 and 340", () => {
    expect(cardWidthFor(200)).toBe(248);
    expect(cardWidthFor(360)).toBeCloseTo(280.8);
    expect(cardWidthFor(1440)).toBe(340);
  });

  test("the stage is the viewport minus the table bars", () => {
    const s = stageBox(360, 640);
    expect(s.w).toBe(360);
    expect(s.h).toBeLessThan(640);
    expect(s.top).toBeGreaterThan(0);
    expect(s.top + s.h).toBeLessThan(640);
  });

  test.each([
    [360, 640],
    [390, 844],
    [768, 1024],
    [1280, 720],
    [1440, 900],
    [640, 360],
  ])("cards are only ever scaled down at %ix%i", (vw, vh) => {
    const L = layoutFor(vw, vh);
    expect(L.handScale).toBeGreaterThan(0);
    expect(L.handScale).toBeLessThanOrEqual(0.7);
    expect(L.inspectScale).toBeLessThanOrEqual(1);
    expect(L.ch).toBeCloseTo(L.cw * CARD_RATIO);
  });
});

describe("the fan", () => {
  test.each([
    [360, 640],
    [390, 844],
    [470, 1000],
    [600, 960],
    [700, 1000],
    [744, 1133],
    [1440, 900],
    [1366, 657],
  ])("the rotated, projected fan fits inside a %ix%i stage", (vw, vh) => {
    const { w, h } = stageBox(vw, vh);
    const L = handLayout({ stageW: w, stageH: h, cw: cardWidthFor(vw) });
    const b = fanBounds(L);
    expect(b.left).toBeGreaterThanOrEqual(-w / 2);
    expect(b.right).toBeLessThanOrEqual(w / 2);
    expect(b.top).toBeGreaterThanOrEqual(-h / 2);
    expect(b.bottom).toBeLessThanOrEqual(h / 2);
  });

  test("the fan is symmetric and stacks front-to-right", () => {
    const L = layoutFor(1440, 900);
    const first = fanPose(0, L);
    const last = fanPose(4, L);
    expect(first.x).toBeCloseTo(-last.x);
    expect(first.rotate).toBeCloseTo(-last.rotate);
    expect(first.y).toBeCloseTo(last.y);
    expect(fanPose(2, L).rotate).toBe(0);
    expect(last.z).toBeGreaterThan(first.z);
  });

  test("desktop fans are big enough to read", () => {
    expect(layoutFor(1440, 900).handScale).toBeGreaterThanOrEqual(0.6);
  });

  test.each([0, 1, 2, 3, 4])("lifted card %i clears its neighbours through a full corner tilt", (li) => {
    const L = layoutFor(1440, 900);
    const lifted = poseFor({ i: li, phase: "hand", lifted: li, L }).pose;
    [li - 1, li + 1]
      .filter((i) => i >= 0 && i <= 4)
      .forEach((i) => {
        const neighbour = poseFor({ i, phase: "hand", lifted: li, L }).pose;
        expect(lifted.z - neighbour.z).toBeGreaterThan(reach(L, HAND_TILT));
      });
  });

  test("neighbours part away from the lifted card", () => {
    const L = layoutFor(1440, 900);
    const left = poseFor({ i: 1, phase: "hand", lifted: 2, L }).pose;
    const right = poseFor({ i: 3, phase: "hand", lifted: 2, L }).pose;
    expect(left.x).toBeLessThan(fanPose(1, L).x);
    expect(right.x).toBeGreaterThan(fanPose(3, L).x);
  });

  test("nearestFanIndex maps stage x back to a card", () => {
    const L = layoutFor(1440, 900);
    expect(nearestFanIndex(fanPose(0, L).x, L)).toBe(0);
    expect(nearestFanIndex(fanPose(3, L).x + 4, L)).toBe(3);
    expect(nearestFanIndex(-9999, L)).toBe(0);
    expect(nearestFanIndex(9999, L)).toBe(4);
  });
});

describe("poses by phase", () => {
  const L = layoutFor(1440, 900);
  const R = ripLayout({ stageW: 1440, stageH: stageBox(1440, 900).h });
  const kind = (args) => poseFor({ L, R, ...args }).kind;

  test("cards hide in the pack until the tear, then rise", () => {
    expect(kind({ i: 0, phase: "ripping", tearDone: false })).toBe("pack");
    expect(kind({ i: 0, phase: "ripping", tearDone: true })).toBe("risen");
  });

  test("#5 to #2 deal while #1 waits, then takes the stage", () => {
    expect(kind({ i: 0, phase: "dealing" })).toBe("fan");
    expect(kind({ i: 3, phase: "dealing" })).toBe("fan");
    expect(kind({ i: 4, phase: "dealing" })).toBe("risen");
    expect(kind({ i: 4, phase: "legend" })).toBe("legend");
    expect(kind({ i: 4, phase: "reveal" })).toBe("legend");
    expect(kind({ i: 4, phase: "hand" })).toBe("fan");
  });

  test("inspect centres one card and sinks the rest", () => {
    expect(kind({ i: 2, phase: "inspect", inspected: 2 })).toBe("inspect");
    expect(kind({ i: 0, phase: "inspect", inspected: 2 })).toBe("dimmed");
    const inspect = poseFor({ L, R, i: 2, phase: "inspect", inspected: 2 }).pose;
    expect(inspect.x).toBe(0);
    expect(inspect.rotate).toBe(0);
  });

  test("the hero card flips and tilts without cutting through the fan", () => {
    const fanTop = Math.max(...[0, 1, 2, 3].map((i) => poseFor({ L, R, i, phase: "legend" }).pose.z));
    const legend = poseFor({ L, R, i: 4, phase: "legend" }).pose;
    expect(legend.z - L.cw / 2).toBeGreaterThan(fanTop); // a full flip
    expect(legend.z - reach(L, INSPECT_TILT)).toBeGreaterThan(fanTop); // a full tilt
    const inspect = poseFor({ L, R, i: 2, phase: "inspect", inspected: 2 }).pose;
    const dimmedTop = Math.max(...[0, 1, 3, 4].map((i) => poseFor({ L, R, i, phase: "inspect", inspected: 2 }).pose.z));
    expect(inspect.z - L.cw / 2).toBeGreaterThan(dimmedTop);
    expect(inspect.z - reach(L, INSPECT_TILT)).toBeGreaterThan(dimmedTop);
  });

  test.each([
    [1366, 657],
    [844, 390],
    [360, 640],
  ])("the rising stack stays inside a %ix%i stage", (vw, vh) => {
    const { w, h } = stageBox(vw, vh);
    const L2 = handLayout({ stageW: w, stageH: h, cw: cardWidthFor(vw) });
    const R2 = ripLayout({ stageW: w, stageH: h });
    const risen = poseFor({ L: L2, R: R2, i: 0, phase: "ripping", tearDone: true }).pose;
    expect(risen.y - (L2.ch * risen.scale) / 2).toBeGreaterThanOrEqual(-h / 2);
  });

  test("tiny stages never go negative", () => {
    const s = stageBox(800, 100);
    expect(s.h).toBe(0);
    const R2 = ripLayout({ stageW: 800, stageH: s.h });
    expect(R2.scale).toBeGreaterThan(0);
  });

  test("close-to-lens poses are compensated for perspective", () => {
    expect(zComp(40)).toBeCloseTo((PERSPECTIVE - 40) / PERSPECTIVE);
    const inspect = poseFor({ L, R, i: 2, phase: "inspect", inspected: 2 }).pose;
    expect(inspect.scale).toBeCloseTo(L.inspectScale * zComp(inspect.z));
  });

  test("everything stays inside the Z budget", () => {
    const phases = ["ripping", "dealing", "legend", "hand", "inspect"];
    phases.forEach((phase) => {
      for (let i = 0; i < 5; i += 1) {
        const { pose } = poseFor({ L, R, i, phase, tearDone: true, lifted: 1, inspected: 3 });
        expect(pose.z).toBeLessThanOrEqual(0.6 * PERSPECTIVE);
      }
    });
  });

  test("switch entries come in from the side they were asked for", () => {
    const fromRight = sidePose(0, 1, L, 1440);
    const fromLeft = sidePose(0, -1, L, 1440);
    expect(fromRight.x).toBeGreaterThan(fanPose(0, L).x);
    expect(fromLeft.x).toBeLessThan(fanPose(0, L).x);
  });
});

describe("the shelf depth cloud", () => {
  test("prand is deterministic and in [0, 1)", () => {
    for (let n = 0; n < 50; n += 1) {
      const v = prand(n);
      expect(v).toBe(prand(n));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("cloud points are spread, tumble-capped and inside the Z budget", () => {
    const pts = Array.from({ length: 8 }, (_, i) => cloudPose(i, 8, false));
    pts.forEach((p) => {
      expect(Math.abs(p.rotateX)).toBeLessThanOrEqual(70);
      expect(Math.abs(p.rotateY)).toBeLessThanOrEqual(70);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(0.6 * PERSPECTIVE);
    });
    expect(new Set(pts.map((p) => Math.round(p.x))).size).toBe(8);
  });

  test("packs land flat with only a small toss", () => {
    for (let i = 0; i < 8; i += 1) {
      const h = homePose(i);
      expect(h.z).toBe(0);
      expect(h.rotateX).toBe(0);
      expect(h.rotateY).toBe(0);
      expect(Math.abs(h.rotate)).toBeLessThanOrEqual(4);
    }
  });
});
