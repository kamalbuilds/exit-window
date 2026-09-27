window.__mer=null;(async () => {
  const seen = new Map();
  const grab = () => document.querySelectorAll('article').forEach(a => {
    const link = [...a.querySelectorAll('a[href*="/status/"]')].map(x => x.href).find(h => /\/status\/\d+$/.test(h));
    if (!link || seen.has(link)) return;
    const text = a.querySelector('[data-testid="tweetText"]')?.innerText || '';
    const links = [...a.querySelectorAll('[data-testid="tweetText"] a')].map(x => x.innerText).filter(t => /\.|github/.test(t));
    const stats = a.querySelector('[role="group"]')?.getAttribute('aria-label') || '';
    const time = a.querySelector('time')?.getAttribute('datetime') || '';
    seen.set(link, {url: link, time, text: text.slice(0, 600), links, stats});
  });
  let stale = 0, last = 0;
  for (let i = 0; i < 80 && stale < 6; i++) {
    grab(); window.scrollBy(0, 2500);
    await new Promise(r => setTimeout(r, 1800));
    if (seen.size === last) stale++; else { stale = 0; last = seen.size; }
  }
  grab();
  window.__mer = JSON.stringify([...seen.values()]);
})()
