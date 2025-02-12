import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import Button from "../../DevComponents/Button/Button";
import "./About.css";

const About = () => {
  // Using `useRef` for animations and a more interactive feel.
  const aboutTitleRef = useRef(null);
  const aboutInfoRef = useRef(null);
  const containerRef = useRef(null);
  const [lineHeight, setLineHeight] = useState(0);

  useEffect(() => {
    // Add a smooth fade-in animation when the component mounts.
    aboutTitleRef.current.classList.add("fade-in");
    aboutInfoRef.current.classList.add("slide-in");

    const updateLineHeight = () => {
      const containerHeight = containerRef.current.clientHeight;
      setLineHeight(containerHeight);
    };

    updateLineHeight();

    window.addEventListener("resize", updateLineHeight);

    // Cleanup listener on unmount
    return () => {
      window.removeEventListener("resize", updateLineHeight);
    };
  }, []);

  return (
    <div className="about--container">
      <div className="line top"></div>
      <div
        className="line vertical"
        style={{
          height: `${lineHeight - 100}px`,
        }}
      ></div>

      <div className="about-container" ref={containerRef}>
        <div className="about-title" ref={aboutTitleRef}>
          <h1 className="no-margin">ABOUT</h1>
          <img
            src={process.env.PUBLIC_URL + "/assets/charlie.jpg"}
            alt="Charlie"
          />
        </div>
        <div className="about-info" ref={aboutInfoRef}>
          <h1>I'm Charlie. A designer, maker, and problem solver.</h1>
          <p className="about-info-mobile-p">
            From the moment I wrote my first line of code, I knew I had tapped
            into something transformational. Fast forward to 2023, and my
            journey has been an enlightening experience. From Web Development to
            VFX pipelines for visual content, each project—big or small—has been
            a crucial stepping stone towards where I stand today.
          </p>
          <p className="about-info-mobile-p-2">
            What gets my gears turning as a Software Developer is the
            possibility of solving real-world problems through code. It goes
            beyond just writing functions or designing websites. I am passionate
            about delivering efficient and scalable solutions that make a
            tangible difference—be it enhancing video production workflows,
            optimizing eCommerce experiences, or contributing to open-source
            communities.
          </p>
          <blockquote>
            "There is nothing so useless as doing efficiently that which should
            not be done at all." - Peter Drucker
          </blockquote>
          <p>
            This resonates with me profoundly. I'm not here to write code just
            for the sake of it; I aim to contribute to projects that are
            impactful, that solve genuine problems, and that offer value to the
            end-user.
          </p>
          <h2>EXPERIENCE</h2>
          <ul>
            <li>Software Engineering Graduate from the University of Ottawa</li>
            <li>Specialized in React Web Development and VFX Pipelines</li>
            <li>
              Knowledgeable in back-end development and Database Management
            </li>
          </ul>
          <ul>
            <li>4 years of experience in React Web Development</li>
            <li>3 years of experience in VFX Pipelines</li>
            <li>2 year of experience in Team Leadership</li>
            <li>
              Multiple collaborative projects within and outside university
              settings
            </li>
          </ul>
          <h2>SKILLS</h2>
          <p>
            React Web Development / VFX Pipelines / Team Collaboration / Agile
            Methodologies / Version Control / C++ / Python / User Experience
            Design / Problem-Solving
          </p>
          <Button className="resume-button">
            <Link
              to="/CHARLIE_RESUME_5.pdf"
              target="_blank"
              rel="noopener noreferrer"
            >
              Resume
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default About;
