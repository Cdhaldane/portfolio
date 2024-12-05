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
          backgroundColor: "#88f188",
          color: "white",
        }}
      >
        <h1>TIMESLOT</h1>
        <p>@time-slot.ca</p>
      </div>
      <div className="workpage-info">
        <h1>
          Appointment Scheduling for Small Businesses – Full Stack Development
          for a Salon
        </h1>
        <div className="workpage-table">
          <table>
            <tbody>
              <tr>
                <th>ROLE</th>
                <td>Full Stack Developer</td>
              </tr>
              <tr>
                <th>RESPONSIBILITIES</th>
                <td>
                  Database Design with Supabase, Custom Calendar Component
                  Development, Responsive Frontend Design, Integration of
                  Backend Services
                </td>
              </tr>
              <tr>
                <th>INFO</th>
                <td>
                  <p>2024</p>
                  <p>Time-Slot Project</p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <img
        className="workpage-img"
        style={{
          border: `2px solid #88f188`,
        }}
        src={`/assets/timeslot/header-${themeMode}.png`}
        alt="Time-Slot"
      />

      <p className="workpage-img-p">
        Time-Slot is a web application I developed for a local salon to help
        manage appointments efficiently. As a Full Stack Developer, I built the
        entire solution from the backend using Supabase to the frontend using
        React.
      </p>

      <img
        className="workpage-img"
        style={{
          border: `2px solid #88f188`,
        }}
        src={`/assets/timeslot/calendar-${themeMode}.png`}
        alt="Time-Slot Calendar"
      />

      <p className="workpage-img-p">
        A key feature of Time-Slot is the custom-built responsive and dynamic
        calendar component. This calendar allows both customers and salon owners
        to easily view, add, and modify appointments, ensuring smooth scheduling
        and avoiding conflicts.
      </p>

      <p className="workpage-img-p">
        The backend setup uses Supabase, which provides a scalable and efficient
        database solution. It handles authentication and appointment data
        storage seamlessly, making the development process faster without
        compromising on performance or security.
      </p>

      <div
        className="workpage-tools"
        style={{
          border: `4px solid #88f188`,
        }}
      >
        <img
          className="workpage-img"
          style={{
            border: `2px solid transparent`,
          }}
          src={`/assets/timeslot/services-${themeMode}.png`}
          alt="Development Tools"
        />
        <img
          className="workpage-img"
          style={{
            border: `2px solid transparent`,
          }}
          src={`/assets/timeslot/example-${themeMode}.png`}
          alt="Calendar Component Development"
        />
      </div>
      <p className="workpage-img-p">
        The frontend was developed with responsiveness in mind, ensuring that
        both salon owners and clients can easily access Time-Slot from any
        device. I utilized modern web technologies to deliver a sleek and
        easy-to-navigate user experience.
      </p>
      <p className="workpage-img-p">
        I also implemented a dynamic calendar that adapts based on the
        appointment load, offering visual cues for peak times. This was crucial
        for a salon to optimize staff schedules and ensure customer
        satisfaction.
      </p>

      <div className="workpage-footer">
        <Button
          onClick={() => window.open("https://time-slot.ca")}
          color="#88f188"
        >
          Check it out!
        </Button>
      </div>
    </div>
  );
};

export default WorkPage;
