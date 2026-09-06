// icons-loader.js
// Загружает shared/icons.svg и инлайнит спрайт в DOM — нужно для Brave (Shields
// блокирует внешние SVG-use). После инлайна переписывает все <use href="...icons.svg#X">
// на локальные <use href="#X">, чтобы Brave рендерил иконки.
//
// Подключается из любого HTML на разной глубине — путь к спрайту берётся из
// первого <use href> на странице.

(function () {
  function inlineSprite() {
    const firstUse = document.querySelector('use[href*="icons.svg#"], use[xlink\\:href*="icons.svg#"]');
    if (!firstUse) return;
    const ref = firstUse.getAttribute('href') || firstUse.getAttribute('xlink:href');
    if (!ref) return;
    const url = ref.split('#')[0];

    fetch(url, { credentials: 'same-origin' })
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then((text) => {
        const wrap = document.createElement('div');
        wrap.setAttribute('aria-hidden', 'true');
        wrap.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;';
        wrap.innerHTML = text;
        document.body.insertBefore(wrap, document.body.firstChild);

        document.querySelectorAll('use').forEach((u) => {
          const h = u.getAttribute('href') || u.getAttribute('xlink:href');
          if (h && h.includes('icons.svg#')) {
            const id = h.split('#')[1];
            u.setAttribute('href', '#' + id);
            u.removeAttribute('xlink:href');
          }
        });
      })
      .catch((err) => console.warn('icons-loader: failed to inline sprite', err));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inlineSprite);
  } else {
    inlineSprite();
  }
})();
