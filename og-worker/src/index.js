// Share image for hanzheng.li: a random landscape card on every fetch, never cached, so a chat
// app that fetches the preview again gets a different photo. The cards are static files on the
// site (public/og/, made by the site's scripts).
const CARDS = ["tamalpais", "iceland", "iceland-fjord", "kawaguchiko", "kyoto", "taiwan", "atchafalaya", "louisiana", "aruba"];

export default {
  async fetch(request) {
    // crawlers (Twitterbot first of all) read robots.txt before the image; it must be text, not a card
    if (new URL(request.url).pathname === "/robots.txt")
      return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
    const name = CARDS[Math.floor(Math.random() * CARDS.length)];
    const card = await fetch(`https://hanzheng.li/og/${name}.jpg`, { cf: { cacheTtl: 86400, cacheEverything: true } });
    if (!card.ok) return new Response("card not found", { status: 502 });
    return new Response(card.body, {
      headers: {
        "content-type": "image/jpeg",
        "cache-control": "no-store, max-age=0",
        "x-card": name,
      },
    });
  },
};
