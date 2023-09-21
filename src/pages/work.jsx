import '../App.css';
import { Link } from 'react-router-dom';

function Work() {
    return (
        <div className="landing-container work">
            <div className='work-box'></div>
            <div className='side-box work'>
                <button>HOME</button>
                <div className='work-line'></div>
                <button>©/2023</button>
            </div>
            <div className='title-box work'>
                <h1>WORK</h1>
                <p>This is a showcase of my best work in Web Design and VFX Pipleine Product Deisgn and Managament</p>
                <p>The world of digital design and development is constantly evolving and 
                    so has my role over the last 4 years. I'm strive to learn and evolve everyday </p>
            </div>
            <div className='nav-box work'>
                <ul>
                    <li><Link to="/work/edusim">EDUSIM</Link></li>
                    <ul> Full Stack</ul>
                    <li><Link to="/about">VXNESSA</Link></li>
                    <ul> Web Design</ul>
                    <li><Link to="/contact">MARZ</Link></li>
                    <ul> Pipeline Developer</ul>
                </ul>
            </div>
        </div>
    );
}

export default Work;
