// Sticky nav background on scroll
const nav = document.getElementById('site-nav');
const onScroll = () => {
  if (window.scrollY > 40) nav.classList.add('scrolled');
  else nav.classList.remove('scrolled');
};
document.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// Full-screen menu
const menuToggle = document.getElementById('menu-toggle');
const fullMenu = document.getElementById('full-menu');
const iconBurger = document.getElementById('icon-burger');
const iconClose = document.getElementById('icon-close');

const closeMenu = () => {
  fullMenu.classList.remove('open');
  iconBurger.classList.remove('hidden');
  iconClose.classList.add('hidden');
  menuToggle.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('overflow-hidden');
};

menuToggle.addEventListener('click', () => {
  const isOpen = fullMenu.classList.toggle('open');
  iconBurger.classList.toggle('hidden', isOpen);
  iconClose.classList.toggle('hidden', !isOpen);
  menuToggle.setAttribute('aria-expanded', String(isOpen));
  document.body.classList.toggle('overflow-hidden', isOpen);
});

document.querySelectorAll('.full-menu-link').forEach((link) => {
  link.addEventListener('click', closeMenu);
});

// Scroll reveal
const revealEls = document.querySelectorAll('.reveal');
const io = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('in-view');
      io.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });
revealEls.forEach((el) => io.observe(el));
