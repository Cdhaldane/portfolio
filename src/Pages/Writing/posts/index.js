// Post registry. To add a post: create ./<slug>.jsx exporting `meta` + `Body`,
// then import it here. Sorted newest-first.
import * as cyberpunkConsole from "./cyberpunk-games-console";

const modules = [cyberpunkConsole];

export const POSTS = modules
  .map((m) => ({ ...m.meta, Body: m.Body }))
  .sort((a, b) => (a.date < b.date ? 1 : -1));

export const getPost = (slug) => POSTS.find((p) => p.slug === slug);
