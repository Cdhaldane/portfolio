import React, { useState, useRef } from 'react';
import '../App.css';
import { Link } from 'react-router-dom';
import './contact.css'
import emailjs from '@emailjs/browser';

function Contact() {
    const [show, setShow] = useState(false)
    const [send, setSend] = useState('Send')
    const form = useRef();




    const handleCopy = () => {
        navigator.clipboard.writeText("xcdhaldane@gmail.com")
        document.querySelector('.contact-copied').style.color = '#007bff'
    }

    const handleEmail = () => {
        document.querySelector('.contact-form').style.left = show ? '1000px' : '0px'
        setShow(!show)
    }


    const sendEmail = (e) => {
        e.preventDefault();
        setSend('Sending...')

        if(!form.current.user_name.value || !form.current.user_email.value || !form.current.message.value) {
            setSend('Missing Fields')
            setTimeout(() => {
                setSend('Send')
            }, 2000)
            return
        }
        
        emailjs.sendForm('service_7xvem3p', 'template_5imqdhx', form.current, 'g49oHx9bZd0NTtYal')
            .then((result) => {
                console.log(result.text);
                setSend('Sent!')
            }, (error) => {
                console.log(error.text);
                setSend('Error')
            });

        setTimeout(() => {
            setSend('Send')
        }, 2000)
    };

    return (
        <div className="landing-container">
            <div className='work-box'></div>
            <div className='side-box work'>
                <a><Link to="/">HOME</Link></a>
                <div className='work-line'></div>
                <a>©/2023</a>
            </div>
            <div className='contact-container'>
                <div className='contact-title'>
                    <h1>H</h1>
                    <div>
                        <div onClick={handleEmail} className='contact-click'>click me</div>
                        <button onClick={handleEmail}>e</button>
                    </div>
                    <h1>l</h1>
                    <h1>l</h1>
                    <h1>o</h1>
                    <h1>.</h1>
                </div>
                <p>Need a well designed, efficient website? Get in touch.</p>
                <p>Email: <a onClick={handleCopy}>xcdhaldane@gmail.com</a> <span className='contact-copied'>Copied</span></p>

            </div>
            <form className='contact-form' ref={form} onSubmit={sendEmail} >
                <label>Name</label>
                <input type="text" name="user_name" />
                <label>Email</label>
                <input type="email" name="user_email" />
                <label>Message</label>
                <textarea name="message" />
                <input type="submit" value={send} />
            </form>
        </div>
    );
}

export default Contact;
