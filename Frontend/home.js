const screen = document.querySelector('.welcome-screen');
const scene = document.querySelector('.background-scene');
const caption = document.querySelector('#slide-caption');
const dots = Array.from(document.querySelectorAll('.slide-dot'));
const captions = [
    'Reliable rides, right when you need them.',
    'Choose a car or bike for your Nairobi trip.',
    'Know your route and fare before you ride.'
];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let currentSlide = 0;
let timer;
let paused = false;
let pointerStart;

function showSlide(index) {
    currentSlide = (index + dots.length) % dots.length;
    scene.dataset.slide = String(currentSlide);
    caption.textContent = captions[currentSlide];
    dots.forEach((dot, dotIndex) => {
        const active = dotIndex === currentSlide;
        dot.classList.toggle('active', active);
        dot.setAttribute('aria-pressed', String(active));
    });
}

function restartTimer() {
    window.clearInterval(timer);
    if (paused || reducedMotion.matches || document.hidden) return;
    timer = window.setInterval(() => showSlide(currentSlide + 1), 5000);
}

dots.forEach((dot, index) => {
    dot.addEventListener('click', () => {
        showSlide(index);
        restartTimer();
    });
});

screen.addEventListener('pointerenter', () => {
    paused = true;
    restartTimer();
});
screen.addEventListener('pointerleave', () => {
    paused = false;
    restartTimer();
});
screen.addEventListener('focusin', () => {
    paused = true;
    restartTimer();
});
screen.addEventListener('focusout', () => {
    window.setTimeout(() => {
        paused = screen.contains(document.activeElement);
        restartTimer();
    }, 0);
});
screen.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('a, button')) pointerStart = event.clientX;
});
screen.addEventListener('pointerup', (event) => {
    if (pointerStart === undefined) return;
    const distance = event.clientX - pointerStart;
    pointerStart = undefined;
    if (Math.abs(distance) > 45) showSlide(currentSlide + (distance < 0 ? 1 : -1));
    restartTimer();
});
screen.addEventListener('pointercancel', () => {
    pointerStart = undefined;
});
document.addEventListener('visibilitychange', restartTimer);
reducedMotion.addEventListener?.('change', restartTimer);

restartTimer();
