import CaseStudy from "./CaseStudy";

const Marz = () => (
  <CaseStudy
    slug="marz"
    name="Marz"
    client="Monsters Aliens Robots Zombies"
    accent="#e5484d"
    year="2022"
    role="Pipeline Developer"
    focus="Performance optimization, automation scripts, pipeline architecture, asset management & artist collaboration"
    url="https://monstersaliensrobotszombies.com/"
    summary="VFX pipeline development for MARZ, specialised in performance optimization and tooling for visual-effects artists."
    cover="/assets/marz/header.png"
    coverAlt="MARZ studio header"
    sections={[
      {
        type: "text",
        body: "During my CO-OP term at MARZ in the summer and fall of 2022, I worked as a Pipeline Developer focusing on performance optimization. As one of the key developers on the team, I was entrusted with re-architecting existing pipelines to improve efficiency and scalability, primarily using Python for scripting and building custom modules to streamline VFX processes.",
      },
      {
        type: "image",
        src: "/assets/marz/pipeline.png",
        alt: "MARZ VFX pipeline architecture",
      },
      {
        type: "text",
        body: [
          "A critical part of my role was developing automation scripts that simplified the workflow for VFX artists. The development phase included rigorous testing to make sure new pipeline components integrated seamlessly into the existing ecosystem.",
          "The backend requirements were intricate, demanding a well-thought-out design. I used a range of Python libraries and frameworks to build resilient components capable of handling the complex data structures typical of VFX pipelines.",
        ],
      },
      {
        type: "gallery",
        images: [
          { src: "/assets/marz/tools.png", alt: "MARZ pipeline tooling UI" },
          { src: "/assets/marz/tools2.png", alt: "MARZ optimization tooling" },
        ],
      },
      {
        type: "text",
        body: "Because pipelines are crucial to render performance, extensive planning and consultation with VFX artists were carried out to ensure optimal results. I collaborated closely with multiple teams so the pipeline met both technical specs and artist needs. I built the interface for our pipeline software with PyQt, which let me quickly create a user-friendly UI to input and manage data as it moved through the pipeline — and in my own time I built an additional VFX-pipeline UI to deepen my understanding of it.",
      },
    ]}
  />
);

export default Marz;
