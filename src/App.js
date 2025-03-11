import React, { useEffect, useState } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useLocation,
} from "react-router-dom";
import LandingPage from "./Pages/Landing/Landing";
import WorkPage from "./Pages/Work/Work";
import AboutPage from "./Pages/About/About";
import ContactPage from "./Pages/Contact/Contact";
import Showcase from "./Pages/Showcase/Showcase";
import InquiryPage from "./Pages/Inquiry/Inquiry";

import Edusim from "./Pages/Work/Edusim";
import Vxnessa from "./Pages/Work/Vxnessa";
import Marz from "./Pages/Work/Marz";
import Timeslot from "./Pages/Work/Timeslot";
import { faker } from "@faker-js/faker";

import "./App.css";

const App = () => {
  const location = useLocation();

  const SideBar = () => {
    let locationStyle = "";
    if (location.pathname === "/work" || location.pathname === "/showcase")
      locationStyle = "work";
    else if (location.pathname === "/about") locationStyle = "about";
    return (
      <>
        <div className={`black-box ${locationStyle}`}></div>
        <div className={`side-box ${locationStyle}`}>
          {location.pathname !== "" && (
            <a>
              <a href="/">HOME</a>
            </a>
          )}
          <a href="https://github.com/Cdhaldane">GH</a>
          <a href="https://www.linkedin.com/in/charliehaldaneuottawa/">LI</a>
          <a href="https://www.instagram.com/charliedhaldane/">IG</a>
          <div
            className="vertical-line"
            style={{
              borderLeft: location.pathname.includes("marz")
                ? "1px solid red"
                : location.pathname.includes("vxnessa")
                ? "1px solid purple"
                : location.pathname.includes("timeslot")
                ? "1px solid #88f188"
                : location.pathname.includes("edusim")
                ? "1px solid #8f001a"
                : "1px solid var(--primary)",
            }}
          ></div>
          <a>©/2025</a>
        </div>
      </>
    );
  };

  const [users, setUsers] = useState([]);

  useEffect(() => {
    // Fetch users when the component mounts
    async function fetchUsers() {
      try {
        const response = await fetch(
          process.env.REACT_APP_BACKEND_URL + "/api/users"
        );
        if (!response.ok) {
          throw new Error("Network response was not ok");
        }
        const data = await response.json();
        console.log(data);
        setUsers(data);
      } catch (error) {
        console.error("Error fetching users:", error);
      }
    }

    fetchUsers();
  }, []);

  // Add a fake user
  const addFakeUser = async () => {
    try {
      // Generate fake data
      const fakeUser = {
        username: faker.internet.userName(),
        email: faker.internet.email(),
      };

      // Send the fake data in the request body
      const response = await fetch(
        process.env.REACT_APP_BACKEND_URL + "/api/users",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(fakeUser), // Send the fake user data
        }
      );

      if (!response.ok) {
        throw new Error("Failed to add fake user");
      }

      const newUser = await response.json();
      setUsers([...users, newUser]); // Update the UI with the new user
    } catch (error) {
      console.error("Error adding fake user:", error);
    }
  };

  return (
    <div className="main">
      <SideBar />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/work" element={<WorkPage />} />
        <Route path="/work/edusim" element={<Edusim />} />
        <Route path="/work/vxnessa" element={<Vxnessa />} />
        <Route path="/work/marz" element={<Marz />} />
        <Route path="/work/timeslot" element={<Timeslot />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/showcase" element={<Showcase />} />
        <Route path="/inquiry" element={<InquiryPage />} />
      </Routes>
      {/* <div>
        <h1>Users</h1>
        <button onClick={addFakeUser}>Add fake user</button>
        <ul>
          {users.map((user) => (
            <li key={user.id}>
              {user.username} - {user.email}
            </li>
          ))}
        </ul>
      </div> */}
    </div>
  );
};

export default App;
