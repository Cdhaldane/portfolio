import '../App.css';
import { Link } from 'react-router-dom';

import marz from '../images/marz.png'
import pipeline from '../images/pipeline.png'
import tools from '../images/tools.png'
import tools2 from '../images/tools2.png'
import './workpage.css'

import { redirect } from 'react-router-dom';

function WorkPage() {
    return (
        <div className="workpage-container">
            <div className="landing-container workpage">
                <div className='black-box'></div>
                <div className='side-box workpage'>
                    <a><Link to="/">HOME</Link></a>
                    <div className='work-line red'></div>
                    <a>©/2023</a>
                </div>

                <div className='workpage-bg'>
                    <div className='workpage-box'>
                        <h1>MARZ</h1>
                        <p>@Monsters Aliens Robots Zombies</p>
                    </div>
                </div>
            </div>
            <div className='workpage-info'>
                <h1>VFX Pipeline Development for MARZ – Specialized in Performance Optimization</h1>
                <div>
                    <div>
                        <h3>ROLE</h3>
                        <p>Pipeline Developer</p>
                    </div>
                    <div>
                        <h3>RESPONSIBILITIES</h3>
                        <p>Performance Optimization, Automation Scripts, Pipeline Architecture, Asset Management, Collaboration with VFX Artists</p>
                    </div>
                    <div>
                        <h3>INFO</h3>
                        <p>2022</p>
                        <p>MARZ</p>
                    </div>
                </div>
            </div>

            <img className="workpage-img" src={marz} alt="MARZ" />

            <p className='workpage-img-p'>
                During my CO-OP term at MARZ in the summer and fall of 2022, I worked as a Pipeline Developer focusing on performance optimization.

                Being one of the key developers in the team, I was entrusted with the responsibility of re-architecting existing pipelines to improve efficiency and scalability.

                I primarily used Python for scripting and developed custom modules to streamline VFX processes.
            </p>

            <img className="workpage-img" src={pipeline} alt="MARZ Pipeline" />

            <p className='workpage-img-p'>
                A critical part of my role was to develop automation scripts that simplified the workflow for VFX artists.

                The development phase included rigorous testing to make sure that the new pipeline components integrated seamlessly into the existing ecosystem.
            </p>

            <p className='workpage-img-p'>
                The backend requirements were intricate, necessitating a well-thought-out design. I utilized various Python libraries and frameworks to build resilient backend components capable of handling the complex data structures typical in VFX pipelines.
            </p>

            <div className='marz-tools'> 
            <img className="workpage-img" src={tools} alt="MARZ Optimization" />
            <img className="workpage-img" src={tools2} alt="MARZ Optimization" />
            </div>
            <p className='workpage-img-p'>
                As the pipelines are crucial for the performance of VFX renderings, extensive planning and consultations with VFX artists were carried out to ensure optimal performance.

                I collaborated closely with various teams to ensure the pipeline met technical specifications and artist requirements, resulting in a more robust and user-friendly system.

                I also utilized PyQt, a set of Python bindings for the Qt application framework, to build the user interface for our pipeline software. PyQt allowed me to quickly and easily create a user-friendly interface that could be used to input and manage data as it moved through the pipeline. 
                To further my understanding in regards to PyQt, in my free time I created a UI that could be used in a VFX pipeline.
            </p>

            <div className="workpage-footer">
                <button onClick={() => window.open('https://monstersaliensrobotszombies.com/')}> Check it out! </button>
            </div>
        </div>
    );
}

export default WorkPage;
