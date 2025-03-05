import React, { useState } from 'react'
import "./AvailableLanguages.css"
const AvailableLanguages = ({ onLanguageSelect, languageList, pinnedLanguages, AddTopinLanguage, removeFromPinnedLanguages, handleAudioTrack, selected }) => {
    const [searchInput, setSearchInput] = useState("")
    const [serachResults, setSearchResults] = useState([])


    // for searching the lagauges 

    const getLanguages = async (language) => {
        try {
            const response = await fetch(`https://pkgstore.datahub.io/core/language-codes/language-codes-full_json/data/573588525f24edb215c07bec3c309153/language-codes-full_json.json`)
            const data = await response.json()
            const result = data.map(item => item['English']).filter((lang) => {
                return language &&
                    lang &&
                    lang.toLowerCase().includes(language)
            });
            // console.log(result)
            setSearchResults(result)


        } catch (error) {
            console.log('Error fetching the data', error)
        }

    }

    const handleChange = (language) => {
        // language.preventDefault();
        setSearchInput(language)
        getLanguages(language)
    };

   
    const handleLanguageClick = (lang) => {
        handleAudioTrack(lang);
        onLanguageSelect(lang);
    };

    return (
        <section className="avilable-languages-header">
            <div className="pinned-languages default-languages">
                {languageList.length > 1 ? languageList.map((lang) => (
                    <div key={lang.name} className="pinned-item" >
                        <span className={`language-hover-color ${selected === lang.index - 1 ? "select" : ""} `} onClick={() => { handleLanguageClick(lang.index -1)}}>{lang.name ? lang.name : lang.lang}</span>
                        {/* {pinnedLanguages.some(item => item.name === lang.name)
                            ? <span className="pin-icon" onClick={(e) => { e.stopPropagation(); removeFromPinnedLanguages(lang.name) }} ><i class="fa-solid fa-thumbtack"></i></span>
                            : <span className="pin-icon" onClick={(e) => { e.stopPropagation(); AddTopinLanguage(lang.name ? lang.name : lang.lang) }}  ><i class="fa-solid fa-thumbtack"></i></span>
                        } */}
                    </div>)) : "No track available"}
            </div>
            
            <div className="pinned-languages search-languages">
                {serachResults.map((lang) => (
                    <div key={lang.name} className="pinned-item" >
                        <span className="search-result" onClick={(e) => { e.stopPropagation(); AddTopinLanguage(lang.name ? lang.anme : lang) }} >{lang}</span>
                        {/* {pinnedLanguages.some(item => item.name === lang)
                            ? <span className="pin-icon" onClick={(e) => { e.stopPropagation(); removeFromPinnedLanguages(lang.name ? lang.name : lang) }} ><i class="fa-solid fa-thumbtack"></i></span>
                            : <span className="pin-icon" onClick={(e) => { e.stopPropagation(); AddTopinLanguage(lang.name ? lang.anme : lang) }}  ><i class="fa-solid fa-thumbtack"></i></span>
                        } */}
                    </div>))}
            </div>
        
            <div className="input-group">
                <span className="input-group-addon" > <i class="fa-solid fa-magnifying-glass"></i> </span>
                <input type="search"
                    className="search-bar"
                    placeholder="Search any language"
                    aria-label="Search"
                    value={searchInput} key='key' onChange={(e) => handleChange(e.target.value)} />
            </div>
            
          
        </section>
    )
}

export default AvailableLanguages








