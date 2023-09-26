import '../App.css';
import { Link } from 'react-router-dom';
import v from '../images/v.png'
import v1 from '../images/v1.gif'
import './workpage.css'

import { redirect } from 'react-router-dom';

function WorkPage() {
    return (
        <div className="workpage-container">
            <div className="landing-container workpage">
                <div className='black-box'></div>
                <div className='side-box workpage'>
                    <a><Link to="/">HOME</Link></a>
                    <div className='work-line purple-line'></div>
                    <a>©/2023</a>
                </div>

                <div className='workpage-bg'>
                    <div className='workpage-box purple'>
                        <h1>VXNESSA</h1>
                        <p>@vanessa</p>
                    </div>
                </div>
            </div>
            <div className='workpage-info'>
                <h1>A commissioned art portfolio website – built in React</h1>
                <div>
                    <div>
                        <h3>ROLE</h3>
                        <p>Full Stack Developer, Lead programmer & Designer</p>
                    </div>
                    <div>
                        <h3>RESPONSIBILITIES</h3>
                        <p>Design Consultation, Frontend Setup,
                            React Component Styling, Dynamic Landing Pages, Custom CMS, Animation, Server Handling, Database Design</p>
                    </div>
                    <div>
                        <h3>INFO</h3>
                        <p>2021</p>
                        <p>VXNESSA</p>
                    </div>
                </div>
            </div>
            <img className="workpage-img" src={v} alt="v" />
            <p className='workpage-img-p'>
                As the sole developer commissioned for this project in the summer of 2022, I was responsible for creating an art portfolio website.

                Given the artistic nature of the project, I had significant creative latitude to ensure that the website not only showcased the artwork effectively but also reflected the artist's unique style.

                The website was crafted using React and Node, incorporating a custom CMS for easy art upload and management.
            </p>

            <p className='workpage-img-p'>
                One of the standout features of this portfolio was the gallery. Visitors could interact with the gallery, seeing the high-level css animations that were implemented.

                The interactive gallery was built using React, and I opted for CSS Grid for layout management. The choice to go minimalist with dependencies was deliberate, aiming for speed and ease of maintenance.
            </p>

            <p className='workpage-img-p'>
                On the backend, I employed Node and Express to manage asset delivery and user inquiries. For data storage, I used MongoDB to securely store user-submitted contact forms and inquiries.

                The backend was simplified but robust, ensuring that the artist could easily add new pieces to their portfolio without hassle.
            </p>
            
            <img className="workpage-img" src={v1} alt="v" />


            <div className="workpage-footer">
                <button className='purple-button' onClick={() => window.open('https://www.vxnessa.tk/')}> Check it out! </button>

            </div>
        </div>
    );
}

export default WorkPage;
