import '../App.css';
import { Link } from 'react-router-dom';

function Landing() {
    return (
        <div className="landing-container">
            <div className='black-box'></div>
            <div className='side-box'>
                <a href="https://github.com/Cdhaldane">GH</a>
                <a href="https://www.linkedin.com/in/charliehaldaneuottawa/">LI</a>
                <a href="https://www.instagram.com/charliedhaldane/">IG</a>
                <div className='vertical-line'></div>
                <a>©/2023</a>
            </div>
            <div className='title-box'>
                <h1>CHARLIE HALDANE</h1>
                <p>Product Designer / Webflow Developer / Framer Developer and Partner.</p>
                <p>Currently studying Software Engineering at the Univeristy of Ottawa</p>
            </div>
            <div className='nav-box'>
                <ul>
                    <li><Link to="/work">WORK</Link></li>
                    <li><Link to="/about">ABOUT</Link></li>
                    <li><Link to="/contact">CONTACT</Link></li>
                </ul>
            </div>
        </div>
    );
}

export default Landing;
