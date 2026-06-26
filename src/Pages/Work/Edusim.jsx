import CaseStudy from "./CaseStudy";

const Edusim = () => (
  <CaseStudy
    slug="edusim"
    name="EduSim"
    client="@DumondDesign"
    accent="#c2334a"
    year="2021"
    role="Full-Stack Developer, Lead Programmer & Designer"
    focus="Design consultation, frontend, custom CMS, animation, server handling & database design"
    url="https://edusim.ca/"
    summary="An educational platform built with React & Node, featuring a comprehensive Socket.io implementation and a custom game builder."
    cover="/assets/edusim/header.png"
    coverAlt="EduSim website landing page"
    sections={[
      {
        type: "text",
        body: "As the lead developer on this project, starting in spring of 2020, I was tasked with designing and developing a website for the Ontario school board. As this was my first CO-OP and I was the only developer on the project, I was given a lot of freedom to design and develop the website as I saw fit. It was built with React and Node, with a custom CMS and a Socket.io implementation for the chat and game features — a fun, interactive way for students to learn about career paths in the trades industry.",
      },
      {
        type: "image",
        src: "/assets/edusim/editpage.png",
        alt: "EduSim custom CMS game editor",
      },
      {
        type: "text",
        body: [
          "A large part of the project was the game building and game mechanics. We wanted to allow students and facilitators to create their own games and share them with other users. The game builder was built using React and Konva — a decision driven mostly by my inexperience at the time; as I've grown I've seen the flaws in relying on libraries.",
          "A scope this vast required a lot of backend handling to store game data, user data, and game logic. I used Node and Express for the backend and Supabase for storage, with a custom CMS that let users create and share their own games.",
        ],
      },
      {
        type: "image",
        src: "/assets/edusim/gamelogic.png",
        alt: "EduSim game logic and stage rendering",
      },
      {
        type: "text",
        body: "The game logic required a lot of planning and testing to ensure the games were fun and engaging for students. I worked closely with the client to keep everything up to their standards. Rendering the three stages of each game was handled with Konva — a challenge in itself that pushed me to learn how to render performantly and at scale.",
      },
    ]}
  />
);

export default Edusim;
