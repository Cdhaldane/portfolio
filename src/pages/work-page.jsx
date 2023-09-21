import '../App.css';
import { Link } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
import edusim from '../images/edusim.png'
import './workpage.css'

function WorkPage() {
    let title = useLocation().pathname.split('/')[2].toUpperCase()
    return (
        <div className="workpage-container">
            <div className="landing-container workpage">
                <div className='black-box'></div>
                <div className='side-box'>
                    <button>HOME</button>
                    <div className='work-line'></div>
                    <button>©/2023</button>
                </div>

                <div className='workpage-bg'>
                    <div className='workpage-box'>
                        <h1>{title}</h1>
                        <p>@DumondDesign</p>
                    </div>
                </div>
            </div>
            <div className='workpage-info'>
                <h1>A website built in Framer for Superlink – a domain name startup changing the world.</h1>
                <div>
                    <div>
                        <h3>ROLE</h3>
                        <p>Framer Development and Consultatio</p>
                    </div>
                    <div>
                        <h3>RESPONSIBILITIES</h3>
                        <p>Framer Consultation, Frontend Framer Setup, 
                            React Component Styling, Dynamic Landing Pages, Custom CMS, Animation</p>
                    </div>
                    <div>
                        <h3>INFO</h3>
                        <p>2021</p>
                        <p>EDUSIM</p>
                    </div>
                </div>
            </div>
            <img className="workpage-img" src={edusim} alt="edusim" />
            <p className='workpage-img-p'>
            An ex-CEO of mine Matt Winn approached me about helping with building a website for his new startup idea, Superlink. 
            I recommended they use Framer for the marketing website because I think Framer is the perfect website builder for startups 
            that need to move fast and iterate on what they're offering as a product or service. 
            
            <br/>
            <br/>
            (Side note: If you're thinking about using Framer but have questions, hit me up).
            The website and brand was designed by Hunter Thompson and lucky for me I got to setup and build a really beautiful site.
            </p>

        </div>
    );
}

export default WorkPage;
