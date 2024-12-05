import { Link } from "react-router-dom";
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
          backgroundColor: "#a9c5c9",
          color: "white",
        }}
      >
        <h1>VXNESSA</h1>
        <p>@vanessa</p>
      </div>
      <div className="workpage-info">
        <h1>A commissioned art portfolio website – built in React</h1>
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
                  <p>VXNESSA</p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <img
        className="workpage-img"
        style={{
          border: "2px solid #a9c5c9",
        }}
        src={`/assets/vxnessa/header.png`}
        alt="v"
      />
      <p className="workpage-img-p">
        As the sole developer commissioned for this project in the summer of
        2022, I was responsible for creating an art portfolio website. Given the
        artistic nature of the project, I had significant creative latitude to
        ensure that the website not only showcased the artwork effectively but
        also reflected the artist's unique style. The website was crafted using
        React and Node, incorporating a custom CMS for easy art upload and
        management.
      </p>

      <p className="workpage-img-p">
        One of the standout features of this portfolio was the gallery. Visitors
        could interact with the gallery, seeing the high-level css animations
        that were implemented. The interactive gallery was built using React,
        and I opted for CSS Grid for layout management. The choice to go
        minimalist with dependencies was deliberate, aiming for speed and ease
        of maintenance.
      </p>

      <p className="workpage-img-p">
        On the backend, I employed Node and Express to manage asset delivery and
        user inquiries. For data storage, I used MongoDB to securely store
        user-submitted contact forms and inquiries. The backend was simplified
        but robust, ensuring that the artist could easily add new pieces to
        their portfolio without hassle.
      </p>

      <img
        className="workpage-img"
        style={{
          border: "2px solid #a9c5c9",
        }}
        src={`/assets/vxnessa/v1.gif`}
        alt="v"
      />

      <div className="workpage-footer">
        <Button
          onClick={() => window.open("https://www.vxnessa.tk/")}
          color="#a9c5c9"
        >
          Check it out!
        </Button>
      </div>
    </div>
  );
};

export default WorkPage;
