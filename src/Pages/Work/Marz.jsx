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
          backgroundColor: "#8f001a",
          color: "white",
        }}
      >
        <h1>MARZ</h1>
        <p>@Monsters Aliens Robots Zombies</p>
      </div>
      <div className="workpage-info">
        <h1>
          VFX Pipeline Development for MARZ – Specialized in Performance
          Optimization
        </h1>
        <div className="workpage-table">
          <table>
            <tbody>
              <tr>
                <th>ROLE</th>
                <td>Pipeline Developer</td>
              </tr>
              <tr>
                <th>RESPONSIBILITIES</th>
                <td>
                  Performance Optimization, Automation Scripts, Pipeline
                  Architecture, Asset Management, Collaboration with VFX Artists
                </td>
              </tr>
              <tr>
                <th>INFO</th>
                <td>
                  <p>2022</p>
                  <p>MARZ</p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <img
        className="workpage-img"
        style={{
          border: "2px solid #8f001a",
        }}
        src={`/assets/marz/header.png`}
        alt="MARZ"
      />

      <p className="workpage-img-p">
        During my CO-OP term at MARZ in the summer and fall of 2022, I worked as
        a Pipeline Developer focusing on performance optimization. Being one of
        the key developers in the team, I was entrusted with the responsibility
        of re-architecting existing pipelines to improve efficiency and
        scalability. I primarily used Python for scripting and developed custom
        modules to streamline VFX processes.
      </p>

      <img
        className="workpage-img"
        style={{
          border: "2px solid #8f001a",
        }}
        src={`/assets/marz/pipeline.png`}
        alt="MARZ Pipeline"
      />

      <p className="workpage-img-p">
        A critical part of my role was to develop automation scripts that
        simplified the workflow for VFX artists. The development phase included
        rigorous testing to make sure that the new pipeline components
        integrated seamlessly into the existing ecosystem.
      </p>

      <p className="workpage-img-p">
        The backend requirements were intricate, necessitating a
        well-thought-out design. I utilized various Python libraries and
        frameworks to build resilient backend components capable of handling the
        complex data structures typical in VFX pipelines.
      </p>

      <div
        className="workpage-tools"
        style={{
          border: "4px solid #8f001a",
        }}
      >
        <img
          className="workpage-img"
          style={{
            border: "2px solid transparent",
          }}
          src={`/assets/marz/tools.png`}
          alt="MARZ Optimization"
        />
        <img
          className="workpage-img"
          style={{
            border: "2px solid transparent",
          }}
          src={`/assets/marz/tools2.png`}
          alt="MARZ Optimization"
        />
      </div>
      <p className="workpage-img-p">
        As the pipelines are crucial for the performance of VFX renderings,
        extensive planning and consultations with VFX artists were carried out
        to ensure optimal performance. I collaborated closely with various teams
        to ensure the pipeline met technical specifications and artist
        requirements, resulting in a more robust and user-friendly system. I
        also utilized PyQt, a set of Python bindings for the Qt application
        framework, to build the user interface for our pipeline software. PyQt
        allowed me to quickly and easily create a user-friendly interface that
        could be used to input and manage data as it moved through the pipeline.
        To further my understanding in regards to PyQt, in my free time I
        created a UI that could be used in a VFX pipeline.
      </p>

      <div className="workpage-footer">
        <Button
          onClick={() =>
            window.open("https://monstersaliensrobotszombies.com/")
          }
          color="#8f001a"
        >
          Check it out!
        </Button>
      </div>
    </div>
  );
};

export default WorkPage;
