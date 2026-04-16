const siteHeader = document.querySelector(".site-header");
const menuToggle = document.querySelector(".menu-toggle");
const nav = document.querySelector("#site-nav");

if (siteHeader && menuToggle && nav) {
  const navLinks = nav.querySelectorAll("a");
  const mobileBreakpoint = window.matchMedia("(max-width: 900px)");

  const closeMenu = () => {
    siteHeader.classList.remove("nav-open");
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open navigation menu");
  };

  const openMenu = () => {
    siteHeader.classList.add("nav-open");
    menuToggle.setAttribute("aria-expanded", "true");
    menuToggle.setAttribute("aria-label", "Close navigation menu");
  };

  menuToggle.addEventListener("click", () => {
    const isOpen = siteHeader.classList.contains("nav-open");
    if (isOpen) {
      closeMenu();
      return;
    }
    openMenu();
  });

  navLinks.forEach((link) => {
    link.addEventListener("click", () => {
      if (mobileBreakpoint.matches) {
        closeMenu();
      }
    });
  });

  mobileBreakpoint.addEventListener("change", (event) => {
    if (!event.matches) {
      closeMenu();
    }
  });
}
