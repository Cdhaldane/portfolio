import CaseStudy from "./CaseStudy";

const Vxnessa = () => (
  <CaseStudy
    slug="vxnessa"
    name="Vxnessa"
    client="Vanessa"
    accent="#8b5cf6"
    year="2022"
    role="Full-Stack Developer & Designer"
    focus="Design consultation, frontend, custom CMS, interactive gallery & a Node/MongoDB backend"
    url="https://www.vxnessa.tk/"
    summary="A commissioned art-portfolio website built in React, with an interactive, animation-driven gallery."
    cover="/assets/vxnessa/header.png"
    coverAlt="Vxnessa art portfolio homepage"
    sections={[
      {
        type: "text",
        body: [
          "As the sole developer commissioned for this project in the summer of 2022, I created an art-portfolio website. Given the artistic nature of the work, I had significant creative latitude to make sure the site showcased the artwork effectively while reflecting the artist's unique style. It was crafted with React and Node, with a custom CMS for easy art upload and management.",
          "One of the standout features was the gallery. Visitors could interact with it and experience the high-level CSS animations throughout. The interactive gallery was built with React and CSS Grid for layout — going deliberately minimalist on dependencies for speed and ease of maintenance.",
          "On the backend, I used Node and Express to manage asset delivery and inquiries, with MongoDB securely storing contact submissions. The backend stayed simple but robust, so the artist could add new pieces without hassle.",
        ],
      },
      {
        type: "image",
        src: "/assets/vxnessa/v1.gif",
        alt: "Vxnessa interactive gallery animation",
      },
    ]}
  />
);

export default Vxnessa;
