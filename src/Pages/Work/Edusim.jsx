import Button from "../../DevComponents/Button/Button";

import "./Workpage.css";

const WorkPage = () => {
  const themeMode =
    localStorage.getItem("isDarkMode") === "true" ? "dark" : "light";
  return (
    <div className="workpage-container">
      <div
        className="workpage-box"
        style={{
          backgroundColor: "#8f001a",
          color: "white",
        }}
      >
        <h1>EDUSIM</h1>
        <p>@DumondDesign</p>
      </div>
      <div className="workpage-info">
        <h1>
          An educational website developed with React & Node – featuring a
          compressive Socket.io implementation
        </h1>
        <div className="workpage-table">
          <table>
            <tbody>
              <tr>
                <th>ROLE</th>
                <td>Full Stack Developer, Lead programmer & Designer</td>
              </tr>
              <tr>
                <th>RESPONSIBILITIES</th>
                <td>
                  Design Consultation, Frontend Setup, React Component Styling,
                  Dynamic Landing Pages, Custom CMS, Animation, Server Handling,
                  Database Design
                </td>
              </tr>
              <tr>
                <th>INFO</th>
                <td>
                  <p>2021</p>
                  <p>EDUSIM</p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <img
        className="workpage-img"
        style={{
          border: `2px solid #8f001a`,
        }}
        src={`/assets/edusim/header.png`}
        alt="edusim"
      />
      <p className="workpage-img-p">
        As the lead developer on this project, starting in spring of 2020, I was
        tasked with designing and developing a website for the Ontario school
        board. As this was my first CO-OP and I was the only developer on the
        project, I was given a lot of freedom to design and develop the website
        as I saw fit. The website was built using React and Node, with a custom
        CMS and a Socket.io implementation for the chat and game features. The
        website was designed to be a fun and interactive way for students to
        learn about the different career paths available to them in the trades
        industry.
      </p>

      <img
        className="workpage-img"
        style={{
          border: `2px solid #8f001a`,
        }}
        src={`/assets/edusim/editpage.png`}
        alt="edusim"
      />
      <p className="workpage-img-p">
        A large part of the project was the game building and game mechanics. We
        wanted to allow students and facillitators to create their own games and
        share them with other users. The game builder was built using React and
        Konva, the decision to go with Konva was mostly due to my inexperience -
        as I've grown I've seen the flaws in relying on libraries.
      </p>
      <p className="workpage-img-p">
        A scope this vast requires a lot of backend hanling to store game data,
        user data, and game logic. I used Node and Express to handle the
        backend, and Supbase to store the data. The game logic was handled using
        a custom CMS that I built using React and Node. The CMS allowed users to
        create their own games and share them with other users.
      </p>

      <img
        className="workpage-img"
        style={{
          border: `2px solid #8f001a`,
        }}
        src={`/assets/edusim/gamelogic.png`}
        alt="edusim"
      />
      <p className="workpage-img-p">
        The game logic required a lot of planning and testing to ensure that the
        games were fun and engaging for the students. I worked closely with the
        client to ensure that the games were up to their standards. Furthermore,
        the rendering of the three stages in the games was handled using Konva,
        which was a challenge in itself. I had to learn how to use Konva and how
        to render the games in a way that was performant and scalable.
      </p>
      <div className="workpage-footer">
        <Button
          onClick={() => window.open("https://edusim.ca/")}
          color="#8f001a"
        >
          {" "}
          Check it out!{" "}
        </Button>
      </div>
    </div>
  );
};

export default WorkPage;
