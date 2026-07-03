export const meta = {
  slug: "cyberpunk-games-console",
  title: "Building a cyberpunk games console in React",
  date: "2026-07-03",
  excerpt:
    "How a hidden /dashboard turned into a rack of self-contained party games — pass-the-phone social deduction, a draggable telepathy dial, and a countdown word race — all sharing one aesthetic.",
  tags: ["React", "Design", "Games"],
  readMinutes: 6,
};

export const Body = () => (
  <>
    <p>
      There's a door on this site most people never open. Type{" "}
      <code>/dashboard</code>, get past the gate, and you land in an "ops
      console" — a private rack of small games I build for fun. It started as
      one pass-the-phone game and quietly became four. Here's what I learned
      making a games console feel like a single, intentional product instead of
      a folder of demos.
    </p>

    <h2>One aesthetic, ruthlessly enforced</h2>
    <p>
      The rule that made everything cohere: every game is fully self-contained
      and namespaced. Word Imposter lives under <code>.imp</code>, Wavelength
      under <code>.wv</code>, Fishbowl under <code>.fb</code>. No shared global
      styles to accidentally break, but a copied set of design tokens — the same
      cyan/magenta glow, scanlines, corner brackets, and mono labels — so they
      read as siblings. A redesign of one can never leak into another, yet they
      all feel like they came off the same workbench.
    </p>

    <h2>The pass-the-phone pattern</h2>
    <p>
      Local multiplayer on a single device is a tiny state machine:{" "}
      <code>setup → reveal → play</code>. The interesting part is the{" "}
      <em>reveal</em> phase — each player privately taps to see their secret
      role, then hands the phone on. No backend, no accounts, just a flipped
      card and a "lock &amp; pass" button. It's astonishing how much social
      tension you get from a <code>useState</code> cursor and a CSS transform.
    </p>

    <h2>The fun engineering bit: a telepathy dial</h2>
    <p>
      Wavelength is the one I'm proudest of. A psychic sees a hidden target on a
      spectrum and gives a one-word clue; the team drags a needle to guess. The
      whole thing hinges on mapping a value in <code>[0, 1]</code> to an angle on
      a semicircle, and back again from a pointer position.
    </p>
    <pre className="wr-pre">
      <code>{`// value 0 → far left, 1 → far right, 0.5 → straight up
const pointOnArc = (value, r) => {
  const a = Math.PI * (1 - value);          // 180° … 0°
  return { x: CX + r * Math.cos(a),
           y: CY - r * Math.sin(a) };        // SVG y grows downward
};

// …and the inverse, to turn a drag into a value:
const valueFromPointer = (dx, dy) => {
  const angle = Math.atan2(-dy, dx);         // flip y back to math space
  return 1 - clamp(angle, 0, Math.PI) / Math.PI;
};`}</code>
    </pre>
    <p>
      Drawing the scoring bands as SVG arcs and clamping the drag to the top
      half is all it takes. The needle follows your thumb, the bands bloom in on
      the reveal, and it feels like a physical instrument — not a slider with
      extra steps.
    </p>

    <h2>Motion that earns its place</h2>
    <p>
      Every animation is scroll-triggered or interaction-driven, and every one
      has a <code>prefers-reduced-motion</code> escape hatch. Scroll-linked
      effects write a single CSS variable in a rAF-throttled listener instead of
      hammering React state each frame. That's the difference between "has
      animations" and "runs at 60fps."
    </p>

    <h2>The takeaway</h2>
    <p>
      A portfolio piece doesn't have to be a serious app to be serious craft.
      Constraints — one device, one aesthetic, no backend — are what make small
      things feel finished. Go find the door.
    </p>
  </>
);
