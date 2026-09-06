/* ============================================
   Sidebar scroll border indicators
   Source: NavigationMenu scroll behavior
   ============================================ */
(function initSidebarScroll() {
  const menu = document.getElementById('navMenuItems');
  if (!menu) return;

  function updateBorders() {
    const top = menu.scrollTop > 1;
    const bottom = menu.scrollHeight - menu.scrollTop - menu.clientHeight > 1;
    menu.classList.toggle('scroll-top', top);
    menu.classList.toggle('scroll-bottom', bottom);
  }

  menu.addEventListener('scroll', updateBorders, { passive: true });

  const ro = new ResizeObserver(updateBorders);
  ro.observe(menu);

  updateBorders();
})();
