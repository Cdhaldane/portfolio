// DEAD // RECKONING — the case files. 200 famous lives, each reduced to two
// pins: where/when they entered the world and where/when they left it.
// Coordinates are city-level (the map is a 1000px world — close enough).
// `field` is the first hint; `alt` holds extra accepted answers beyond the
// automatic last-name / last-two-words matches (see fuzzy.js).

const P = (name, field, bd, bp, blat, blng, dd, dp, dlat, dlng, alt) => ({
  name,
  field,
  born: { date: bd, place: bp, lat: blat, lng: blng },
  died: { date: dd, place: dp, lat: dlat, lng: dlng },
  alt: alt || [],
});

export const PEOPLE = [
  // ---- science & thought ----
  P("Albert Einstein", "Theoretical physicist", "14 Mar 1879", "Ulm, Germany", 48.4, 9.99, "18 Apr 1955", "Princeton, New Jersey, USA", 40.35, -74.66),
  P("Isaac Newton", "Physicist & mathematician", "4 Jan 1643", "Woolsthorpe, England", 52.81, -0.63, "31 Mar 1727", "Kensington, London, England", 51.5, -0.19),
  P("Charles Darwin", "Naturalist, theory of evolution", "12 Feb 1809", "Shrewsbury, England", 52.71, -2.75, "19 Apr 1882", "Downe, Kent, England", 51.33, 0.03),
  P("Marie Curie", "Physicist & chemist, two Nobel Prizes", "7 Nov 1867", "Warsaw, Poland", 52.23, 21.01, "4 Jul 1934", "Passy, Haute-Savoie, France", 45.93, 6.7),
  P("Galileo Galilei", "Astronomer & physicist", "15 Feb 1564", "Pisa, Italy", 43.72, 10.4, "8 Jan 1642", "Arcetri, Florence, Italy", 43.75, 11.25),
  P("Nikola Tesla", "Inventor & electrical engineer", "10 Jul 1856", "Smiljan, Croatia", 44.58, 15.31, "7 Jan 1943", "New York City, USA", 40.76, -73.98),
  P("Thomas Edison", "Inventor, electric light pioneer", "11 Feb 1847", "Milan, Ohio, USA", 41.3, -82.6, "18 Oct 1931", "West Orange, New Jersey, USA", 40.8, -74.24),
  P("Stephen Hawking", "Theoretical physicist & cosmologist", "8 Jan 1942", "Oxford, England", 51.75, -1.26, "14 Mar 2018", "Cambridge, England", 52.21, 0.12),
  P("Ada Lovelace", "Mathematician, first computer programmer", "10 Dec 1815", "London, England", 51.51, -0.13, "27 Nov 1852", "Marylebone, London, England", 51.52, -0.15),
  P("Alan Turing", "Mathematician & codebreaker", "23 Jun 1912", "Maida Vale, London, England", 51.53, -0.19, "7 Jun 1954", "Wilmslow, England", 53.33, -2.23),
  P("Louis Pasteur", "Microbiologist, pasteurization", "27 Dec 1822", "Dole, France", 47.09, 5.49, "28 Sep 1895", "Marnes-la-Coquette, France", 48.83, 2.17),
  P("Leonardo da Vinci", "Renaissance polymath & painter", "15 Apr 1452", "Vinci, Italy", 43.79, 10.92, "2 May 1519", "Amboise, France", 47.41, 0.98, ["da vinci", "leonardo"]),
  P("Nicolaus Copernicus", "Astronomer, heliocentric model", "19 Feb 1473", "Toruń, Poland", 53.01, 18.6, "24 May 1543", "Frombork, Poland", 54.36, 19.68),
  P("Johannes Kepler", "Astronomer, laws of planetary motion", "27 Dec 1571", "Weil der Stadt, Germany", 48.75, 8.87, "15 Nov 1630", "Regensburg, Germany", 49.01, 12.1),
  P("Michael Faraday", "Physicist, electromagnetism", "22 Sep 1791", "Newington Butts, London, England", 51.49, -0.1, "25 Aug 1867", "Hampton Court, England", 51.4, -0.34),
  P("Niels Bohr", "Physicist, atomic structure", "7 Oct 1885", "Copenhagen, Denmark", 55.68, 12.57, "18 Nov 1962", "Copenhagen, Denmark", 55.68, 12.57),
  P("Enrico Fermi", "Physicist, first nuclear reactor", "29 Sep 1901", "Rome, Italy", 41.89, 12.5, "28 Nov 1954", "Chicago, Illinois, USA", 41.88, -87.63),
  P("J. Robert Oppenheimer", "Physicist, led the Manhattan Project", "22 Apr 1904", "New York City, USA", 40.71, -74.01, "18 Feb 1967", "Princeton, New Jersey, USA", 40.35, -74.66),
  P("Richard Feynman", "Physicist & famed teacher", "11 May 1918", "Queens, New York, USA", 40.73, -73.79, "15 Feb 1988", "Los Angeles, California, USA", 34.05, -118.24),
  P("Gregor Mendel", "Monk & father of genetics", "20 Jul 1822", "Hynčice, Czech lands", 49.7, 17.8, "6 Jan 1884", "Brno, Czech lands", 49.2, 16.61),
  P("Sigmund Freud", "Founder of psychoanalysis", "6 May 1856", "Příbor, Moravia", 49.64, 18.14, "23 Sep 1939", "London, England", 51.51, -0.13),
  P("Carl Jung", "Psychiatrist, analytical psychology", "26 Jul 1875", "Kesswil, Switzerland", 47.6, 9.32, "6 Jun 1961", "Küsnacht, Switzerland", 47.32, 8.58),
  P("Alexander Fleming", "Discovered penicillin", "6 Aug 1881", "Lochfield, Ayrshire, Scotland", 55.61, -4.28, "11 Mar 1955", "London, England", 51.51, -0.13),
  P("Alexander Graham Bell", "Inventor of the telephone", "3 Mar 1847", "Edinburgh, Scotland", 55.95, -3.19, "2 Aug 1922", "Baddeck, Nova Scotia, Canada", 46.1, -60.75),
  P("Guglielmo Marconi", "Radio pioneer", "25 Apr 1874", "Bologna, Italy", 44.49, 11.34, "20 Jul 1937", "Rome, Italy", 41.89, 12.5),
  P("Alfred Nobel", "Inventor of dynamite, prize founder", "21 Oct 1833", "Stockholm, Sweden", 59.33, 18.07, "10 Dec 1896", "Sanremo, Italy", 43.82, 7.78),
  P("Ernest Rutherford", "Physicist, split the atom", "30 Aug 1871", "Brightwater, New Zealand", -41.38, 173.11, "19 Oct 1937", "Cambridge, England", 52.21, 0.12),
  P("Max Planck", "Physicist, quantum theory", "23 Apr 1858", "Kiel, Germany", 54.32, 10.13, "4 Oct 1947", "Göttingen, Germany", 51.53, 9.93),
  P("Rosalind Franklin", "Chemist, DNA X-ray crystallographer", "25 Jul 1920", "Notting Hill, London, England", 51.51, -0.2, "16 Apr 1958", "Chelsea, London, England", 51.49, -0.17),
  P("Jonas Salk", "Virologist, polio vaccine", "28 Oct 1914", "New York City, USA", 40.71, -74.01, "23 Jun 1995", "La Jolla, California, USA", 32.83, -117.27),
  P("Carl Sagan", "Astronomer & science communicator", "9 Nov 1934", "Brooklyn, New York, USA", 40.68, -73.94, "20 Dec 1996", "Seattle, Washington, USA", 47.61, -122.33),
  P("Katherine Johnson", "NASA mathematician", "26 Aug 1918", "White Sulphur Springs, West Virginia, USA", 37.8, -80.3, "24 Feb 2020", "Newport News, Virginia, USA", 36.98, -76.43),
  P("Erwin Schrödinger", "Physicist, wave equation (and a cat)", "12 Aug 1887", "Vienna, Austria", 48.21, 16.37, "4 Jan 1961", "Vienna, Austria", 48.21, 16.37),
  P("Werner Heisenberg", "Physicist, uncertainty principle", "5 Dec 1901", "Würzburg, Germany", 49.79, 9.94, "1 Feb 1976", "Munich, Germany", 48.14, 11.58),
  P("Archimedes", "Ancient mathematician & engineer", "c. 287 BC", "Syracuse, Sicily", 37.08, 15.28, "c. 212 BC", "Syracuse, Sicily", 37.08, 15.28),
  P("Florence Nightingale", "Founder of modern nursing", "12 May 1820", "Florence, Italy", 43.77, 11.26, "13 Aug 1910", "London, England", 51.51, -0.13),
  P("Jane Goodall", "Primatologist, chimpanzee researcher", "3 Apr 1934", "London, England", 51.51, -0.13, "1 Oct 2025", "Los Angeles, California, USA", 34.05, -118.24),
  P("Hedy Lamarr", "Actress & frequency-hopping inventor", "9 Nov 1914", "Vienna, Austria", 48.21, 16.37, "19 Jan 2000", "Casselberry, Florida, USA", 28.68, -81.33),
  P("George Washington Carver", "Agricultural scientist", "c. 1864", "Diamond, Missouri, USA", 36.99, -94.32, "5 Jan 1943", "Tuskegee, Alabama, USA", 32.43, -85.71),
  P("Dmitri Mendeleev", "Chemist, periodic table", "8 Feb 1834", "Tobolsk, Siberia, Russia", 58.2, 68.25, "2 Feb 1907", "Saint Petersburg, Russia", 59.94, 30.31),
  P("Socrates", "Classical Greek philosopher", "c. 470 BC", "Athens, Greece", 37.98, 23.73, "399 BC", "Athens, Greece", 37.98, 23.73),
  P("Plato", "Philosopher, founded the Academy", "c. 428 BC", "Athens, Greece", 37.98, 23.73, "c. 348 BC", "Athens, Greece", 37.98, 23.73),
  P("Aristotle", "Philosopher, tutor of Alexander", "384 BC", "Stagira, Greece", 40.53, 23.75, "322 BC", "Chalcis, Euboea, Greece", 38.46, 23.6),
  P("Confucius", "Chinese philosopher & teacher", "551 BC", "Qufu, China", 35.6, 116.99, "479 BC", "Qufu, China", 35.6, 116.99),
  P("René Descartes", "Philosopher, 'I think, therefore I am'", "31 Mar 1596", "La Haye en Touraine, France", 46.97, 0.7, "11 Feb 1650", "Stockholm, Sweden", 59.33, 18.07),
  P("Immanuel Kant", "Philosopher of pure reason", "22 Apr 1724", "Königsberg, Prussia", 54.71, 20.51, "12 Feb 1804", "Königsberg, Prussia", 54.71, 20.51),
  P("Friedrich Nietzsche", "Philosopher", "15 Oct 1844", "Röcken, Germany", 51.25, 12.13, "25 Aug 1900", "Weimar, Germany", 50.98, 11.33),
  P("Karl Marx", "Philosopher & economist", "5 May 1818", "Trier, Germany", 49.75, 6.64, "14 Mar 1883", "London, England", 51.51, -0.13),
  P("Voltaire", "Enlightenment writer & wit", "21 Nov 1694", "Paris, France", 48.86, 2.35, "30 May 1778", "Paris, France", 48.86, 2.35),
  P("Jean-Jacques Rousseau", "Enlightenment philosopher", "28 Jun 1712", "Geneva, Switzerland", 46.2, 6.14, "2 Jul 1778", "Ermenonville, France", 49.13, 2.7),

  // ---- art ----
  P("Michelangelo", "Sculptor & Sistine Chapel painter", "6 Mar 1475", "Caprese, Tuscany, Italy", 43.64, 11.99, "18 Feb 1564", "Rome, Italy", 41.89, 12.5),
  P("Raphael", "Renaissance painter", "6 Apr 1483", "Urbino, Italy", 43.73, 12.64, "6 Apr 1520", "Rome, Italy", 41.89, 12.5),
  P("Rembrandt", "Dutch Golden Age painter", "15 Jul 1606", "Leiden, Netherlands", 52.16, 4.49, "4 Oct 1669", "Amsterdam, Netherlands", 52.37, 4.9),
  P("Johannes Vermeer", "Painter of 'Girl with a Pearl Earring'", "Oct 1632", "Delft, Netherlands", 52.01, 4.36, "Dec 1675", "Delft, Netherlands", 52.01, 4.36),
  P("Vincent van Gogh", "Post-impressionist painter", "30 Mar 1853", "Zundert, Netherlands", 51.47, 4.66, "29 Jul 1890", "Auvers-sur-Oise, France", 49.07, 2.17, ["van gogh"]),
  P("Claude Monet", "Impressionist painter", "14 Nov 1840", "Paris, France", 48.86, 2.35, "5 Dec 1926", "Giverny, France", 49.08, 1.53),
  P("Pablo Picasso", "Cubist painter", "25 Oct 1881", "Málaga, Spain", 36.72, -4.42, "8 Apr 1973", "Mougins, France", 43.6, 7.0),
  P("Salvador Dalí", "Surrealist painter", "11 May 1904", "Figueres, Spain", 42.27, 2.96, "23 Jan 1989", "Figueres, Spain", 42.27, 2.96),
  P("Frida Kahlo", "Painter of unflinching self-portraits", "6 Jul 1907", "Coyoacán, Mexico City, Mexico", 19.35, -99.16, "13 Jul 1954", "Coyoacán, Mexico City, Mexico", 19.35, -99.16),
  P("Andy Warhol", "Pop artist", "6 Aug 1928", "Pittsburgh, Pennsylvania, USA", 40.44, -79.99, "22 Feb 1987", "New York City, USA", 40.76, -73.98),
  P("Jean-Michel Basquiat", "Neo-expressionist painter", "22 Dec 1960", "Brooklyn, New York, USA", 40.68, -73.94, "12 Aug 1988", "New York City, USA", 40.73, -73.99),
  P("Georgia O'Keeffe", "Painter of flowers and deserts", "15 Nov 1887", "Sun Prairie, Wisconsin, USA", 43.18, -89.21, "6 Mar 1986", "Santa Fe, New Mexico, USA", 35.69, -105.94),
  P("Caravaggio", "Baroque painter of light and shadow", "29 Sep 1571", "Milan, Italy", 45.46, 9.19, "18 Jul 1610", "Porto Ercole, Tuscany, Italy", 42.39, 11.2),
  P("Francisco Goya", "Spanish romantic painter", "30 Mar 1746", "Fuendetodos, Spain", 41.34, -0.96, "16 Apr 1828", "Bordeaux, France", 44.84, -0.58),
  P("Gustav Klimt", "Painter of 'The Kiss'", "14 Jul 1862", "Baumgarten, Vienna, Austria", 48.19, 16.29, "6 Feb 1918", "Vienna, Austria", 48.21, 16.37),
  P("Henri Matisse", "Fauvist painter", "31 Dec 1869", "Le Cateau-Cambrésis, France", 50.1, 3.54, "3 Nov 1954", "Nice, France", 43.7, 7.27),
  P("Edvard Munch", "Painter of 'The Scream'", "12 Dec 1863", "Løten, Norway", 60.82, 11.34, "23 Jan 1944", "Oslo, Norway", 59.91, 10.75),
  P("Paul Cézanne", "Post-impressionist painter", "19 Jan 1839", "Aix-en-Provence, France", 43.53, 5.45, "22 Oct 1906", "Aix-en-Provence, France", 43.53, 5.45),
  P("Auguste Rodin", "Sculptor of 'The Thinker'", "12 Nov 1840", "Paris, France", 48.86, 2.35, "17 Nov 1917", "Meudon, France", 48.81, 2.24),

  // ---- composers & voices ----
  P("Wolfgang Amadeus Mozart", "Classical composer, child prodigy", "27 Jan 1756", "Salzburg, Austria", 47.81, 13.05, "5 Dec 1791", "Vienna, Austria", 48.21, 16.37, ["mozart"]),
  P("Ludwig van Beethoven", "Composer who kept writing while deaf", "Dec 1770", "Bonn, Germany", 50.73, 7.1, "26 Mar 1827", "Vienna, Austria", 48.21, 16.37, ["beethoven"]),
  P("Johann Sebastian Bach", "Baroque composer", "31 Mar 1685", "Eisenach, Germany", 50.97, 10.32, "28 Jul 1750", "Leipzig, Germany", 51.34, 12.37, ["bach"]),
  P("Frédéric Chopin", "Romantic composer for piano", "1 Mar 1810", "Żelazowa Wola, Poland", 52.25, 20.31, "17 Oct 1849", "Paris, France", 48.86, 2.35),
  P("Pyotr Ilyich Tchaikovsky", "Composer of 'Swan Lake'", "7 May 1840", "Votkinsk, Russia", 57.05, 53.99, "6 Nov 1893", "Saint Petersburg, Russia", 59.94, 30.31, ["tchaikovsky"]),
  P("Antonio Vivaldi", "Composer of 'The Four Seasons'", "4 Mar 1678", "Venice, Italy", 45.44, 12.32, "28 Jul 1741", "Vienna, Austria", 48.21, 16.37),
  P("Richard Wagner", "Opera composer", "22 May 1813", "Leipzig, Germany", 51.34, 12.37, "13 Feb 1883", "Venice, Italy", 45.44, 12.32),
  P("Giuseppe Verdi", "Opera composer", "10 Oct 1813", "Le Roncole, Italy", 44.98, 10.05, "27 Jan 1901", "Milan, Italy", 45.46, 9.19),
  P("Johannes Brahms", "Romantic composer", "7 May 1833", "Hamburg, Germany", 53.55, 9.99, "3 Apr 1897", "Vienna, Austria", 48.21, 16.37),
  P("Franz Liszt", "Piano virtuoso & composer", "22 Oct 1811", "Raiding, Hungary (now Austria)", 47.57, 16.53, "31 Jul 1886", "Bayreuth, Germany", 49.95, 11.58),
  P("Claude Debussy", "Impressionist composer", "22 Aug 1862", "Saint-Germain-en-Laye, France", 48.9, 2.09, "25 Mar 1918", "Paris, France", 48.86, 2.35),
  P("George Frideric Handel", "Composer of 'Messiah'", "23 Feb 1685", "Halle, Germany", 51.48, 11.97, "14 Apr 1759", "London, England", 51.51, -0.13, ["handel"]),
  P("Antonín Dvořák", "Composer of the 'New World' Symphony", "8 Sep 1841", "Nelahozeves, Bohemia", 50.26, 14.3, "1 May 1904", "Prague, Bohemia", 50.09, 14.42),
  P("Maria Callas", "Opera soprano", "2 Dec 1923", "New York City, USA", 40.71, -74.01, "16 Sep 1977", "Paris, France", 48.86, 2.35),
  P("Luciano Pavarotti", "Operatic tenor", "12 Oct 1935", "Modena, Italy", 44.65, 10.93, "6 Sep 2007", "Modena, Italy", 44.65, 10.93),

  // ---- the written word ----
  P("William Shakespeare", "Playwright, the Bard of Avon", "Apr 1564", "Stratford-upon-Avon, England", 52.19, -1.71, "23 Apr 1616", "Stratford-upon-Avon, England", 52.19, -1.71),
  P("Charles Dickens", "Victorian novelist", "7 Feb 1812", "Portsmouth, England", 50.82, -1.09, "9 Jun 1870", "Higham, Kent, England", 51.42, 0.47),
  P("Jane Austen", "Novelist of manners and marriages", "16 Dec 1775", "Steventon, Hampshire, England", 51.23, -1.18, "18 Jul 1817", "Winchester, England", 51.06, -1.31),
  P("Mark Twain", "Humorist, wrote 'Huckleberry Finn'", "30 Nov 1835", "Florida, Missouri, USA", 39.49, -91.79, "21 Apr 1910", "Redding, Connecticut, USA", 41.3, -73.39, ["samuel clemens"]),
  P("Ernest Hemingway", "Novelist of short declarative sentences", "21 Jul 1899", "Oak Park, Illinois, USA", 41.89, -87.79, "2 Jul 1961", "Ketchum, Idaho, USA", 43.68, -114.36),
  P("Leo Tolstoy", "Novelist, 'War and Peace'", "9 Sep 1828", "Yasnaya Polyana, Russia", 54.07, 37.52, "20 Nov 1910", "Astapovo, Russia", 53.21, 39.44),
  P("Fyodor Dostoevsky", "Novelist, 'Crime and Punishment'", "11 Nov 1821", "Moscow, Russia", 55.76, 37.62, "9 Feb 1881", "Saint Petersburg, Russia", 59.94, 30.31),
  P("Anton Chekhov", "Playwright & short-story master", "29 Jan 1860", "Taganrog, Russia", 47.24, 38.9, "15 Jul 1904", "Badenweiler, Germany", 47.8, 7.67),
  P("Franz Kafka", "Novelist of nightmarish bureaucracy", "3 Jul 1883", "Prague, Bohemia", 50.09, 14.42, "3 Jun 1924", "Kierling, Austria", 48.31, 16.28),
  P("George Orwell", "Author of '1984'", "25 Jun 1903", "Motihari, India", 26.65, 84.92, "21 Jan 1950", "London, England", 51.51, -0.13, ["eric blair"]),
  P("Virginia Woolf", "Modernist novelist", "25 Jan 1882", "Kensington, London, England", 51.5, -0.19, "28 Mar 1941", "near Lewes, Sussex, England", 50.87, 0.02),
  P("Oscar Wilde", "Playwright & wit", "16 Oct 1854", "Dublin, Ireland", 53.35, -6.26, "30 Nov 1900", "Paris, France", 48.86, 2.35),
  P("Edgar Allan Poe", "Master of the macabre", "19 Jan 1809", "Boston, Massachusetts, USA", 42.36, -71.06, "7 Oct 1849", "Baltimore, Maryland, USA", 39.29, -76.61),
  P("Agatha Christie", "Best-selling mystery novelist", "15 Sep 1890", "Torquay, England", 50.46, -3.53, "12 Jan 1976", "Wallingford, England", 51.6, -1.13),
  P("J.R.R. Tolkien", "Author of 'The Lord of the Rings'", "3 Jan 1892", "Bloemfontein, South Africa", -29.12, 26.21, "2 Sep 1973", "Bournemouth, England", 50.72, -1.88, ["tolkien"]),
  P("C.S. Lewis", "Author of 'The Chronicles of Narnia'", "29 Nov 1898", "Belfast, Northern Ireland", 54.6, -5.93, "22 Nov 1963", "Oxford, England", 51.75, -1.26, ["cs lewis"]),
  P("Roald Dahl", "Author of 'Charlie and the Chocolate Factory'", "13 Sep 1916", "Llandaff, Cardiff, Wales", 51.49, -3.22, "23 Nov 1990", "Oxford, England", 51.75, -1.26),
  P("Dr. Seuss", "Rhyming children's author", "2 Mar 1904", "Springfield, Massachusetts, USA", 42.1, -72.59, "24 Sep 1991", "La Jolla, California, USA", 32.83, -117.27, ["theodor geisel", "seuss"]),
  P("Maya Angelou", "Poet & memoirist", "4 Apr 1928", "St. Louis, Missouri, USA", 38.63, -90.2, "28 May 2014", "Winston-Salem, North Carolina, USA", 36.1, -80.24),
  P("Toni Morrison", "Nobel-winning novelist, 'Beloved'", "18 Feb 1931", "Lorain, Ohio, USA", 41.45, -82.18, "5 Aug 2019", "The Bronx, New York, USA", 40.85, -73.87),
  P("Gabriel García Márquez", "Magical realist, '100 Years of Solitude'", "6 Mar 1927", "Aracataca, Colombia", 10.59, -74.19, "17 Apr 2014", "Mexico City, Mexico", 19.43, -99.13, ["garcia marquez"]),
  P("Jorge Luis Borges", "Writer of labyrinths and libraries", "24 Aug 1899", "Buenos Aires, Argentina", -34.6, -58.38, "14 Jun 1986", "Geneva, Switzerland", 46.2, 6.14),
  P("Pablo Neruda", "Nobel-winning poet", "12 Jul 1904", "Parral, Chile", -36.14, -71.83, "23 Sep 1973", "Santiago, Chile", -33.45, -70.67),
  P("Miguel de Cervantes", "Author of 'Don Quixote'", "29 Sep 1547", "Alcalá de Henares, Spain", 40.48, -3.36, "22 Apr 1616", "Madrid, Spain", 40.42, -3.7, ["cervantes"]),
  P("Dante Alighieri", "Poet of 'The Divine Comedy'", "c. 1265", "Florence, Italy", 43.77, 11.26, "14 Sep 1321", "Ravenna, Italy", 44.42, 12.2, ["dante"]),
  P("Johann Wolfgang von Goethe", "German poet, wrote 'Faust'", "28 Aug 1749", "Frankfurt, Germany", 50.11, 8.68, "22 Mar 1832", "Weimar, Germany", 50.98, 11.33, ["goethe"]),
  P("Victor Hugo", "Author of 'Les Misérables'", "26 Feb 1802", "Besançon, France", 47.24, 6.02, "22 May 1885", "Paris, France", 48.86, 2.35),
  P("Jules Verne", "Father of science fiction", "8 Feb 1828", "Nantes, France", 47.22, -1.55, "24 Mar 1905", "Amiens, France", 49.89, 2.3),
  P("H.G. Wells", "Author of 'The War of the Worlds'", "21 Sep 1866", "Bromley, England", 51.41, 0.02, "13 Aug 1946", "London, England", 51.51, -0.13, ["hg wells"]),
  P("Mary Shelley", "Author of 'Frankenstein'", "30 Aug 1797", "Somers Town, London, England", 51.53, -0.13, "1 Feb 1851", "Belgravia, London, England", 51.49, -0.15),
  P("Emily Dickinson", "Reclusive American poet", "10 Dec 1830", "Amherst, Massachusetts, USA", 42.37, -72.52, "15 May 1886", "Amherst, Massachusetts, USA", 42.37, -72.52),
  P("Walt Whitman", "Poet of 'Leaves of Grass'", "31 May 1819", "West Hills, New York, USA", 40.82, -73.43, "26 Mar 1892", "Camden, New Jersey, USA", 39.94, -75.12),
  P("Sylvia Plath", "Poet, 'The Bell Jar'", "27 Oct 1932", "Boston, Massachusetts, USA", 42.36, -71.06, "11 Feb 1963", "Primrose Hill, London, England", 51.54, -0.16),
  P("F. Scott Fitzgerald", "Author of 'The Great Gatsby'", "24 Sep 1896", "St. Paul, Minnesota, USA", 44.95, -93.09, "21 Dec 1940", "Hollywood, California, USA", 34.1, -118.33, ["fitzgerald"]),
  P("John Steinbeck", "Author of 'The Grapes of Wrath'", "27 Feb 1902", "Salinas, California, USA", 36.68, -121.66, "20 Dec 1968", "New York City, USA", 40.76, -73.98),
  P("Harper Lee", "Author of 'To Kill a Mockingbird'", "28 Apr 1926", "Monroeville, Alabama, USA", 31.53, -87.32, "19 Feb 2016", "Monroeville, Alabama, USA", 31.53, -87.32),
  P("Hans Christian Andersen", "Fairy-tale author", "2 Apr 1805", "Odense, Denmark", 55.4, 10.39, "4 Aug 1875", "Copenhagen, Denmark", 55.68, 12.57),
  P("Rumi", "Sufi mystic & poet", "30 Sep 1207", "Balkh, Khwarezmian Empire (Afghanistan)", 36.76, 66.9, "17 Dec 1273", "Konya, Anatolia (Turkey)", 37.87, 32.49),
  P("Anne Frank", "Diarist of the Secret Annex", "12 Jun 1929", "Frankfurt, Germany", 50.11, 8.68, "Feb/Mar 1945", "Bergen-Belsen, Germany", 52.76, 9.91),
  P("Kurt Vonnegut", "Author of 'Slaughterhouse-Five'", "11 Nov 1922", "Indianapolis, Indiana, USA", 39.77, -86.16, "11 Apr 2007", "New York City, USA", 40.76, -73.98),
  P("Terry Pratchett", "Discworld author", "28 Apr 1948", "Beaconsfield, England", 51.61, -0.65, "12 Mar 2015", "Broad Chalke, England", 51.03, -1.94),
  P("Douglas Adams", "Author of 'The Hitchhiker's Guide'", "11 Mar 1952", "Cambridge, England", 52.21, 0.12, "11 May 2001", "Santa Barbara, California, USA", 34.42, -119.7),
  P("Arthur Conan Doyle", "Creator of Sherlock Holmes", "22 May 1859", "Edinburgh, Scotland", 55.95, -3.19, "7 Jul 1930", "Crowborough, England", 51.06, 0.16, ["conan doyle"]),
  P("Isaac Asimov", "Sci-fi author, laws of robotics", "2 Jan 1920", "Petrovichi, Russia", 53.97, 32.15, "6 Apr 1992", "New York City, USA", 40.76, -73.98),

  // ---- music, modern ----
  P("Elvis Presley", "The King of Rock and Roll", "8 Jan 1935", "Tupelo, Mississippi, USA", 34.26, -88.7, "16 Aug 1977", "Memphis, Tennessee, USA", 35.15, -90.05, ["elvis"]),
  P("John Lennon", "Beatle, 'Imagine'", "9 Oct 1940", "Liverpool, England", 53.41, -2.98, "8 Dec 1980", "New York City, USA", 40.78, -73.98),
  P("George Harrison", "The quiet Beatle", "25 Feb 1943", "Liverpool, England", 53.41, -2.98, "29 Nov 2001", "Los Angeles, California, USA", 34.05, -118.24),
  P("Freddie Mercury", "Queen frontman", "5 Sep 1946", "Stone Town, Zanzibar", -6.16, 39.19, "24 Nov 1991", "Kensington, London, England", 51.5, -0.19, ["farrokh bulsara"]),
  P("David Bowie", "Shape-shifting rock icon, Ziggy Stardust", "8 Jan 1947", "Brixton, London, England", 51.46, -0.11, "10 Jan 2016", "New York City, USA", 40.72, -74.0),
  P("Prince", "Purple Rain auteur", "7 Jun 1958", "Minneapolis, Minnesota, USA", 44.98, -93.27, "21 Apr 2016", "Chanhassen, Minnesota, USA", 44.86, -93.53, ["prince rogers nelson"]),
  P("Michael Jackson", "The King of Pop", "29 Aug 1958", "Gary, Indiana, USA", 41.6, -87.34, "25 Jun 2009", "Los Angeles, California, USA", 34.05, -118.24),
  P("Whitney Houston", "Pop-soul powerhouse vocalist", "9 Aug 1963", "Newark, New Jersey, USA", 40.74, -74.17, "11 Feb 2012", "Beverly Hills, California, USA", 34.07, -118.4),
  P("Amy Winehouse", "Retro-soul singer, 'Back to Black'", "14 Sep 1983", "Southgate, London, England", 51.63, -0.13, "23 Jul 2011", "Camden, London, England", 51.54, -0.14),
  P("Kurt Cobain", "Nirvana frontman", "20 Feb 1967", "Aberdeen, Washington, USA", 46.98, -123.82, "5 Apr 1994", "Seattle, Washington, USA", 47.61, -122.33),
  P("Jimi Hendrix", "Guitar revolutionary", "27 Nov 1942", "Seattle, Washington, USA", 47.61, -122.33, "18 Sep 1970", "London, England", 51.51, -0.13),
  P("Janis Joplin", "Blues-rock voice of the 60s", "19 Jan 1943", "Port Arthur, Texas, USA", 29.9, -93.93, "4 Oct 1970", "Los Angeles, California, USA", 34.05, -118.24),
  P("Jim Morrison", "The Doors frontman", "8 Dec 1943", "Melbourne, Florida, USA", 28.08, -80.61, "3 Jul 1971", "Paris, France", 48.86, 2.35),
  P("Bob Marley", "Reggae legend", "6 Feb 1945", "Nine Mile, Jamaica", 18.31, -77.39, "11 May 1981", "Miami, Florida, USA", 25.76, -80.19),
  P("Johnny Cash", "The Man in Black", "26 Feb 1932", "Kingsland, Arkansas, USA", 33.86, -92.29, "12 Sep 2003", "Nashville, Tennessee, USA", 36.16, -86.78),
  P("Frank Sinatra", "Crooner, Ol' Blue Eyes", "12 Dec 1915", "Hoboken, New Jersey, USA", 40.74, -74.03, "14 May 1998", "Los Angeles, California, USA", 34.05, -118.24),
  P("Louis Armstrong", "Jazz trumpeter, Satchmo", "4 Aug 1901", "New Orleans, Louisiana, USA", 29.95, -90.07, "6 Jul 1971", "Queens, New York, USA", 40.73, -73.79),
  P("Ella Fitzgerald", "The First Lady of Song", "25 Apr 1917", "Newport News, Virginia, USA", 36.98, -76.43, "15 Jun 1996", "Beverly Hills, California, USA", 34.07, -118.4),
  P("Billie Holiday", "Jazz singer, 'Strange Fruit'", "7 Apr 1915", "Philadelphia, Pennsylvania, USA", 39.95, -75.17, "17 Jul 1959", "New York City, USA", 40.76, -73.98),
  P("Aretha Franklin", "The Queen of Soul", "25 Mar 1942", "Memphis, Tennessee, USA", 35.15, -90.05, "16 Aug 2018", "Detroit, Michigan, USA", 42.33, -83.05),
  P("Ray Charles", "Soul pioneer at the piano", "23 Sep 1930", "Albany, Georgia, USA", 31.58, -84.16, "10 Jun 2004", "Beverly Hills, California, USA", 34.07, -118.4),
  P("Tupac Shakur", "Rapper & poet of the West Coast", "16 Jun 1971", "East Harlem, New York, USA", 40.79, -73.94, "13 Sep 1996", "Las Vegas, Nevada, USA", 36.17, -115.14, ["tupac", "2pac"]),
  P("The Notorious B.I.G.", "Brooklyn rap heavyweight", "21 May 1972", "Brooklyn, New York, USA", 40.68, -73.94, "9 Mar 1997", "Los Angeles, California, USA", 34.05, -118.24, ["biggie", "biggie smalls", "notorious big", "christopher wallace"]),
  P("Tina Turner", "Queen of Rock 'n' Roll", "26 Nov 1939", "Nutbush, Tennessee, USA", 35.69, -89.4, "24 May 2023", "Küsnacht, Switzerland", 47.32, 8.58),
  P("Buddy Holly", "Bespectacled rock pioneer", "7 Sep 1936", "Lubbock, Texas, USA", 33.58, -101.86, "3 Feb 1959", "near Clear Lake, Iowa, USA", 43.14, -93.38),
  P("Selena", "Queen of Tejano music", "16 Apr 1971", "Lake Jackson, Texas, USA", 29.03, -95.43, "31 Mar 1995", "Corpus Christi, Texas, USA", 27.8, -97.4, ["selena quintanilla"]),
  P("Ozzy Osbourne", "Black Sabbath frontman", "3 Dec 1948", "Birmingham, England", 52.48, -1.9, "22 Jul 2025", "Buckinghamshire, England", 51.63, -0.57),
  P("Édith Piaf", "French chanson icon", "19 Dec 1915", "Paris, France", 48.86, 2.35, "10 Oct 1963", "Grasse, France", 43.66, 6.92, ["edith piaf", "piaf"]),
  P("Nina Simone", "Singer & civil-rights voice", "21 Feb 1933", "Tryon, North Carolina, USA", 35.21, -82.24, "21 Apr 2003", "Carry-le-Rouet, France", 43.33, 5.15),
  P("Marvin Gaye", "Motown soul singer", "2 Apr 1939", "Washington, D.C., USA", 38.9, -77.04, "1 Apr 1984", "Los Angeles, California, USA", 34.05, -118.24),
  P("George Michael", "Wham! and solo pop star", "25 Jun 1963", "East Finchley, London, England", 51.59, -0.16, "25 Dec 2016", "Goring-on-Thames, England", 51.52, -1.13),

  // ---- leaders & history ----
  P("Abraham Lincoln", "16th US president", "12 Feb 1809", "Hodgenville, Kentucky, USA", 37.57, -85.74, "15 Apr 1865", "Washington, D.C., USA", 38.9, -77.04),
  P("George Washington", "1st US president", "22 Feb 1732", "Westmoreland County, Virginia, USA", 38.19, -76.92, "14 Dec 1799", "Mount Vernon, Virginia, USA", 38.71, -77.09),
  P("Franklin D. Roosevelt", "Four-term US president", "30 Jan 1882", "Hyde Park, New York, USA", 41.78, -73.93, "12 Apr 1945", "Warm Springs, Georgia, USA", 32.89, -84.68, ["fdr", "franklin roosevelt"]),
  P("John F. Kennedy", "35th US president", "29 May 1917", "Brookline, Massachusetts, USA", 42.33, -71.12, "22 Nov 1963", "Dallas, Texas, USA", 32.78, -96.8, ["jfk", "john kennedy"]),
  P("Winston Churchill", "British wartime prime minister", "30 Nov 1874", "Blenheim Palace, Woodstock, England", 51.84, -1.36, "24 Jan 1965", "London, England", 51.51, -0.13),
  P("Napoleon Bonaparte", "French emperor & general", "15 Aug 1769", "Ajaccio, Corsica, France", 41.92, 8.74, "5 May 1821", "Longwood, Saint Helena", -15.95, -5.68, ["napoleon"]),
  P("Julius Caesar", "Roman general & dictator", "12 Jul 100 BC", "Rome, Roman Republic", 41.89, 12.5, "15 Mar 44 BC", "Rome, Roman Republic", 41.89, 12.5, ["caesar"]),
  P("Cleopatra", "Last pharaoh of Egypt", "69 BC", "Alexandria, Egypt", 31.2, 29.92, "12 Aug 30 BC", "Alexandria, Egypt", 31.2, 29.92),
  P("Alexander the Great", "Macedonian conqueror", "20 Jul 356 BC", "Pella, Macedonia", 40.76, 22.52, "10 Jun 323 BC", "Babylon, Mesopotamia", 32.54, 44.42, ["alexander"]),
  P("Genghis Khan", "Founder of the Mongol Empire", "c. 1162", "Khentii Mountains, Mongolia", 48.9, 110.7, "18 Aug 1227", "Liupan Mountains, Western Xia (China)", 35.67, 106.2, ["chinggis khan"]),
  P("Queen Victoria", "British monarch of an age", "24 May 1819", "Kensington Palace, London, England", 51.5, -0.19, "22 Jan 1901", "Osborne House, Isle of Wight, England", 50.75, -1.27, ["victoria"]),
  P("Queen Elizabeth II", "Britain's longest-reigning monarch", "21 Apr 1926", "Mayfair, London, England", 51.51, -0.15, "8 Sep 2022", "Balmoral Castle, Scotland", 57.04, -3.23, ["elizabeth ii", "elizabeth the second", "queen elizabeth"]),
  P("Mahatma Gandhi", "Nonviolent independence leader", "2 Oct 1869", "Porbandar, India", 21.64, 69.61, "30 Jan 1948", "New Delhi, India", 28.61, 77.21, ["gandhi", "mohandas gandhi"]),
  P("Nelson Mandela", "Anti-apartheid leader & president", "18 Jul 1918", "Mvezo, South Africa", -31.96, 28.49, "5 Dec 2013", "Johannesburg, South Africa", -26.2, 28.05),
  P("Martin Luther King Jr.", "Civil-rights leader, 'I Have a Dream'", "15 Jan 1929", "Atlanta, Georgia, USA", 33.75, -84.39, "4 Apr 1968", "Memphis, Tennessee, USA", 35.15, -90.05, ["mlk", "martin luther king"]),
  P("Rosa Parks", "Civil-rights icon of the bus boycott", "4 Feb 1913", "Tuskegee, Alabama, USA", 32.43, -85.71, "24 Oct 2005", "Detroit, Michigan, USA", 42.33, -83.05),
  P("Che Guevara", "Marxist revolutionary", "14 Jun 1928", "Rosario, Argentina", -32.95, -60.64, "9 Oct 1967", "La Higuera, Bolivia", -18.8, -64.2, ["che"]),
  P("Joan of Arc", "Teenage saint who led armies", "c. 1412", "Domrémy, France", 48.44, 5.67, "30 May 1431", "Rouen, France", 49.44, 1.1, ["jeanne darc"]),
  P("Princess Diana", "The People's Princess", "1 Jul 1961", "Sandringham, England", 52.83, 0.51, "31 Aug 1997", "Paris, France", 48.86, 2.35, ["diana", "lady di", "diana spencer"]),
  P("Mother Teresa", "Missionary of Calcutta", "26 Aug 1910", "Skopje, North Macedonia", 41.99, 21.43, "5 Sep 1997", "Kolkata, India", 22.57, 88.36),

  // ---- stage, screen & spectacle ----
  P("Marilyn Monroe", "Hollywood icon", "1 Jun 1926", "Los Angeles, California, USA", 34.05, -118.24, "4 Aug 1962", "Brentwood, Los Angeles, USA", 34.05, -118.47, ["norma jeane"]),
  P("Charlie Chaplin", "Silent-film tramp", "16 Apr 1889", "Walworth, London, England", 51.49, -0.09, "25 Dec 1977", "Corsier-sur-Vevey, Switzerland", 46.47, 6.86, ["chaplin"]),
  P("Audrey Hepburn", "Actress, 'Breakfast at Tiffany's'", "4 May 1929", "Brussels, Belgium", 50.85, 4.35, "20 Jan 1993", "Tolochenaz, Switzerland", 46.5, 6.48),
  P("James Dean", "Rebel without a cause", "8 Feb 1931", "Marion, Indiana, USA", 40.56, -85.66, "30 Sep 1955", "Cholame, California, USA", 35.73, -120.3),
  P("Alfred Hitchcock", "Master of suspense", "13 Aug 1899", "Leytonstone, London, England", 51.57, 0.01, "29 Apr 1980", "Bel Air, Los Angeles, USA", 34.08, -118.45),
  P("Walt Disney", "Animation empire founder", "5 Dec 1901", "Chicago, Illinois, USA", 41.88, -87.63, "15 Dec 1966", "Burbank, California, USA", 34.18, -118.31),
  P("Robin Williams", "Comedy whirlwind & actor", "21 Jul 1951", "Chicago, Illinois, USA", 41.88, -87.63, "11 Aug 2014", "Tiburon, California, USA", 37.92, -122.48),
  P("Bruce Lee", "Martial-arts film legend", "27 Nov 1940", "San Francisco, California, USA", 37.77, -122.42, "20 Jul 1973", "Hong Kong", 22.32, 114.17),
  P("Betty White", "Beloved TV comedian for 8 decades", "17 Jan 1922", "Oak Park, Illinois, USA", 41.89, -87.79, "31 Dec 2021", "Los Angeles, California, USA", 34.05, -118.24),
  P("Harry Houdini", "Escape artist", "24 Mar 1874", "Budapest, Hungary", 47.5, 19.04, "31 Oct 1926", "Detroit, Michigan, USA", 42.33, -83.05, ["houdini"]),
  P("Steve Irwin", "The Crocodile Hunter", "22 Feb 1962", "Essendon, Melbourne, Australia", -37.75, 144.92, "4 Sep 2006", "Batt Reef, Queensland, Australia", -16.38, 145.85),
  P("Bob Ross", "Painter of happy little trees", "29 Oct 1942", "Daytona Beach, Florida, USA", 29.21, -81.02, "4 Jul 1995", "Orlando, Florida, USA", 28.54, -81.38),

  // ---- sport ----
  P("Muhammad Ali", "Heavyweight boxing champion", "17 Jan 1942", "Louisville, Kentucky, USA", 38.25, -85.76, "3 Jun 2016", "Scottsdale, Arizona, USA", 33.49, -111.93, ["cassius clay", "ali"]),
  P("Babe Ruth", "Baseball's Sultan of Swat", "6 Feb 1895", "Baltimore, Maryland, USA", 39.29, -76.61, "16 Aug 1948", "New York City, USA", 40.76, -73.98),
  P("Kobe Bryant", "Lakers basketball legend", "23 Aug 1978", "Philadelphia, Pennsylvania, USA", 39.95, -75.17, "26 Jan 2020", "Calabasas, California, USA", 34.14, -118.66, ["kobe"]),
  P("Pelé", "Brazilian football king", "23 Oct 1940", "Três Corações, Brazil", -21.7, -45.25, "29 Dec 2022", "São Paulo, Brazil", -23.55, -46.63, ["pele", "edson arantes do nascimento"]),
  P("Diego Maradona", "Argentine football genius", "30 Oct 1960", "Lanús, Buenos Aires, Argentina", -34.71, -58.39, "25 Nov 2020", "Tigre, Argentina", -34.43, -58.58, ["maradona"]),

  // ---- explorers & frontier ----
  P("Christopher Columbus", "Atlantic navigator", "c. 1451", "Genoa, Italy", 44.41, 8.93, "20 May 1506", "Valladolid, Spain", 41.65, -4.72, ["columbus"]),
  P("Amelia Earhart", "Aviation pioneer, vanished mid-flight", "24 Jul 1897", "Atchison, Kansas, USA", 39.56, -95.12, "2 Jul 1937", "near Howland Island, Pacific Ocean", 0.81, -176.62),
  P("Neil Armstrong", "First human on the Moon", "5 Aug 1930", "Wapakoneta, Ohio, USA", 40.57, -84.19, "25 Aug 2012", "Cincinnati, Ohio, USA", 39.1, -84.51),
  P("Steve Jobs", "Apple co-founder", "24 Feb 1955", "San Francisco, California, USA", 37.77, -122.42, "5 Oct 2011", "Palo Alto, California, USA", 37.44, -122.14),
];

// ---------------- daily selection ----------------

export const ROUNDS_PER_DAY = 3;

const EPOCH = Date.UTC(2026, 0, 1); // day 0 — deterministic across clients
const DAY_MS = 86400000;

export function dayIndexFor(date = new Date()) {
  // Local Y/M/D (not UTC) so the roster flips at the player's midnight.
  const local = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((local - EPOCH) / DAY_MS);
}

// mulberry32 — tiny deterministic PRNG so every visitor gets the same
// 3 people on the same calendar day.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function getDailyRounds(date = new Date()) {
  const day = dayIndexFor(date);
  const rand = mulberry32(day * 2654435761 + 1013904223);
  const picks = [];
  const used = new Set();
  while (picks.length < ROUNDS_PER_DAY) {
    const i = Math.floor(rand() * PEOPLE.length);
    if (used.has(i)) continue;
    used.add(i);
    picks.push(PEOPLE[i]);
  }
  return { day, rounds: picks };
}

export function randomPerson(exclude = new Set()) {
  let i;
  do {
    i = Math.floor(Math.random() * PEOPLE.length);
  } while (exclude.has(i) && exclude.size < PEOPLE.length);
  return { person: PEOPLE[i], index: i };
}
