import { Link } from "react-router-dom";
import Button from "../../DevComponents/Button/Button";

import "./Landing.css";

const LandingPage = () => {
  return (
    <div className="landing-container">
      <div className="title-box">
        <h1>CHARLIE HALDANE</h1>
        <p>
          Product Designer / Webflow Developer / Framer Developer and Partner.
        </p>
        <p>
          Currently studying Software Engineering at the Univeristy of Ottawa
        </p>
        <Button className="landing-showcase-button">
          <Link to="/showcase">SHOWCASE</Link>
        </Button>
      </div>
      <div className="nav-box">
        <ul>
          <li>
            <Link to="/work">WORK</Link>
          </li>
          <li>
            <Link to="/about">ABOUT</Link>
          </li>
          <li>
            <Link to="/contact">CONTACT</Link>
          </li>
        </ul>
      </div>
    </div>
  );
};

export default LandingPage;
