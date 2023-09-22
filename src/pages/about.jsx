import '../App.css';
import { Link } from 'react-router-dom';
import './about.css';

import me from '../images/charlie.jpg'

function About() {
    return (
        <div className="landing-container">
            <div className='line top'></div>
            <div className='line vertical'></div>
            <div className='black-box about'></div>
            <div className='side-box about'>
                    <a><Link to="/">HOME</Link></a>
                    <div className='work-line'></div>
                    <a>©/2023</a>
                </div>
            <div className='about-container'>
                <div className='about-title'>
                    <h1>ABOUT</h1>
                    <img src={me}></img>
                </div>
                <div className='about-info'>
                    <h1>I'm Charlie. A designer, maker and problem solver.</h1>
                    <p>From the moment I wrote my first line of code, I knew I had tapped into something transformational.
                        Fast forward to 2023, and my journey has been an enlightening experience. From Web Development to VFX pipelines for visual content,
                        each project—big or small—has been a crucial stepping stone towards where I stand today.</p>
                    <p>What gets my gears turning as a Software Developer is the possibility of solving real-world problems through code.
                        It goes beyond just writing functions or designing websites. I am passionate about delivering efficient and scalable 
                        solutions that make a tangible difference—be it enhancing video production workflows,
                        optimizing eCommerce experiences, or contributing to open-source communities.</p>
                    <p>One of my favorite quotes is by Peter Drucker:</p>
                    <h1>"There is nothing so useless as doing efficiently that which should not be done at all."</h1>
                    <p>This resonates with me profoundly. I'm not here to write code just for the sake of it; I aim to contribute
                        to projects that are impactful, that solve genuine problems, and that offer value to the end-user.</p>
                    <h2>EXPERIENCE</h2>
                    <ul>
                        <li>Fourth-year Software Engineering Student at the University of Ottawa</li>
                        <li>Specialized in React Web Development and VFX Pipelines</li>
                        <li>Knowledgable with back-end developtment and Database Managament</li>
                    </ul>
                    <ul>
                        <li>3 years experience in React Web Development</li>
                        <li>2 years experience in VFX Pipelines</li>
                        <li>1 year experience in Team Leadership</li>
                        <li>Multiple collaborative projects within and outside university settings</li>
                    </ul>
                    <h2>SKILLS</h2>
                    <p>React Web Development / VFX Pipelines / Team Collaboration / Agile Methodologies / Version Control / C++ / Python / User Experience Design /
                        Problem-Solving</p>
                    <button>RESUME</button>
                </div>
            </div>
        </div>
    );
}

export default About;
