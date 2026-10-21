let steamSlides = [];
let steamSlideIndex = -1;
let steamSlideBusy = false;
const reducedBackdropMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function thumbnailGlowColors(image) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 20;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, 32, 20);
    const pixels = context.getImageData(0, 0, 32, 20).data;
    const bins = new Map();
    for (let index = 0; index < pixels.length; index += 4) {
      const rgb = [...pixels.slice(index, index + 3)];
      const max = Math.max(...rgb),
        min = Math.min(...rgb);
      if (max < 45 || min > 225 || max - min < 22) continue;
      const key = rgb.map((channel) => channel >> 5).join(',');
      const bin = bins.get(key) || { rgb: [0, 0, 0], count: 0, weight: 0 };
      rgb.forEach((channel, i) => (bin.rgb[i] += channel));
      bin.count++;
      bin.weight += 0.7 + ((max - min) / max) * 0.3;
      bins.set(key, bin);
    }
    const candidates = [...bins.values()]
      .sort((a, b) => b.weight - a.weight)
      .map((bin) => bin.rgb.map((channel) => channel / bin.count));
    const chosen = [];
    for (const rgb of candidates) {
      if (
        chosen.some(
          (other) => rgb.reduce((sum, value, i) => sum + (value - other[i]) ** 2, 0) < 5500,
        )
      )
        continue;
      chosen.push(rgb);
      if (chosen.length === 3) break;
    }
    if (!chosen.length) return ['#c8c8c8', '#eeeeee', '#a8a8a8'];
    return Array.from({ length: 3 }, (_, i) => {
      const rgb = chosen[i % chosen.length];

      const factor = Math.min(1.16, 180 / Math.max(...rgb));
      return (
        '#' +
        rgb
          .map((channel) =>
            Math.round(Math.min(255, channel * factor))
              .toString(16)
              .padStart(2, '0'),
          )
          .join('')
      );
    });
  } catch {
    return null;
  }
}

async function advanceSteamBackdrop() {
  const backdrop = document.querySelector('#steam-backdrop');
  if (
    !backdrop ||
    !steamSlides.length ||
    steamSlideBusy ||
    document.hidden ||
    !document.body.classList.contains('home-active')
  )
    return;
  if (reducedBackdropMotion.matches && backdrop.childElementCount) return;
  steamSlideBusy = true;
  try {
    for (let attempt = 0; attempt < steamSlides.length; attempt++) {
      steamSlideIndex++;
      if (steamSlideIndex >= steamSlides.length) {
        shuffleSteamSlides();
        steamSlideIndex = 0;
      }
      const game = steamSlides[steamSlideIndex];
      if (backdrop.lastElementChild?.dataset.appId === String(game.id)) continue;
      const image = document.createElement('img');
      image.crossOrigin = 'anonymous';
      image.src = game.image;
      image.alt = '';
      image.decoding = 'async';
      image.dataset.appId = game.id;
      try {
        await image.decode();
      } catch {
        image.removeAttribute('crossorigin');
        image.src = game.image;
        try {
          await image.decode();
        } catch {
          continue;
        }
      }
      if (document.hidden || !document.body.classList.contains('home-active')) return;
      const previous = [...backdrop.children];
      if (!previous.length) image.style.transitionDuration = '900ms';
      const ambient = document.querySelector('#ambient-art');
      const previousGlow = [...ambient.children];
      const glow = document.createElement('span');
      thumbnailGlowColors(image)?.forEach((color, index) =>
        glow.style.setProperty('--art-glow-' + index, color),
      );
      backdrop.append(image);
      ambient.append(glow);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          image.classList.add('visible');
          glow.classList.add('visible');
        }),
      );

      setTimeout(() => [...previous, ...previousGlow].forEach((slide) => slide.remove()), 2800);
      return;
    }
  } finally {
    steamSlideBusy = false;
  }
}

function shuffleSteamSlides() {
  for (let index = steamSlides.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [steamSlides[index], steamSlides[swap]] = [steamSlides[swap], steamSlides[index]];
  }
  const current = document.querySelector('#steam-backdrop img:last-child')?.dataset.appId;
  if (steamSlides.length > 1 && String(steamSlides[0].id) === current) {
    [steamSlides[0], steamSlides[1]] = [steamSlides[1], steamSlides[0]];
  }
}
async function loadSteamBackdrop() {
  if (!window.mamba?.featuredGames) return;
  try {
    const games = await window.mamba.featuredGames();
    if (!Array.isArray(games) || !games.length) return;
    steamSlides = games.filter((game) => {
      try {
        const url = new URL(game.image);
        return url.protocol === 'https:' && url.hostname.endsWith('.steamstatic.com');
      } catch {
        return false;
      }
    });
    shuffleSteamSlides();
    steamSlideIndex = -1;
    await advanceSteamBackdrop();
  } catch {}
}
loadSteamBackdrop();
setInterval(advanceSteamBackdrop, 10000);
setInterval(loadSteamBackdrop, 60 * 1000);

function updateHomeBackdrop() {
  const home =
    !document.querySelector('#search-page').hidden &&
    !document.querySelector('#main-search').value.trim();
  document.body.classList.toggle('home-active', home);
  if (home && !document.querySelector('#steam-backdrop').childElementCount) advanceSteamBackdrop();
  if (home) {
    const image = document.querySelector('#steam-backdrop img.visible');
  }
}
