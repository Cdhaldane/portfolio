import '../App.css';
import { Link } from 'react-router-dom';
import './contact.css'


function Contact() {

    const handleCopy = () => {
        navigator.clipboard.writeText("xcdhaldane@gmail.com")
        document.querySelector('.contact-copied').style.color = '#007bff'
    }

    return (
        <div className="landing-container">
            <div className='work-box'></div>
            <div className='side-box work'>
                <a><Link to="/">HOME</Link></a>
                <div className='work-line'></div>
                <a>©/2023</a>
            </div>
            <div className='contact-container'>
                <h1>H<span>e</span>llo.</h1>
                <p>Need a well designed, efficient website? Get in touch.</p>
                <p>Email: <a onClick={handleCopy}>xcdhaldane@gmail.com</a> <span className='contact-copied'>Copied</span></p>
                
            </div>
            
        </div>
    );
}

export default Contact;
