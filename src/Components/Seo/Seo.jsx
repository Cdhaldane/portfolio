import { Helmet } from "react-helmet-async";

const SITE_URL = "https://charliehaldane.ca";
const DEFAULT_TITLE = "Charlie Haldane — Web Developer in Peterborough, Ontario";
const DEFAULT_DESCRIPTION =
  "Charlie Haldane builds fast, well-designed websites and web apps for businesses in Peterborough, Ontario. React, Webflow & full-stack development.";
const DEFAULT_IMAGE = `${SITE_URL}/C_Logo.png`;

/**
 * Per-page SEO + social metadata.
 *
 * @param {string} title       Page title (a site suffix is appended automatically).
 * @param {string} description Meta description for search + social previews.
 * @param {string} path        Route path (e.g. "/work") used to build the canonical URL.
 * @param {string} image       Absolute URL to the social-share image.
 */
const Seo = ({
  title,
  description = DEFAULT_DESCRIPTION,
  path = "",
  image = DEFAULT_IMAGE,
}) => {
  const fullTitle = title ? `${title} | Charlie Haldane` : DEFAULT_TITLE;
  const canonical = `${SITE_URL}${path}`;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonical} />

      {/* Open Graph */}
      <meta property="og:type" content="website" />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={image} />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
    </Helmet>
  );
};

export default Seo;
