// Copy BibTeX to clipboard
function copyBibTeX() {
    const bibtexElement = document.getElementById('bibtex-code');
    const button = document.querySelector('.copy-btn');

    if (!bibtexElement) return;

    function showCopied() {
        button.classList.add('is-copied');
        button.textContent = 'Copied!';
        setTimeout(function() {
            button.classList.remove('is-copied');
            button.textContent = 'Copy';
        }, 2000);
    }

    navigator.clipboard.writeText(bibtexElement.textContent).then(showCopied).catch(function() {
        const textArea = document.createElement('textarea');
        textArea.value = bibtexElement.textContent;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showCopied();
    });
}

// Scroll to top (fixed-duration, so it feels snappy regardless of page length)
function scrollToTop() {
    const duration = 400;
    const start = window.pageYOffset || document.documentElement.scrollTop;
    const startTime = performance.now();

    function step(now) {
        const progress = Math.min((now - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        window.scrollTo({ top: start * (1 - eased), behavior: 'auto' });
        if (progress < 1) {
            requestAnimationFrame(step);
        }
    }

    requestAnimationFrame(step);
}

window.addEventListener('scroll', function() {
    const scrollButton = document.querySelector('.scroll-to-top');
    if (!scrollButton) return;
    if (window.pageYOffset > 300) {
        scrollButton.classList.add('visible');
    } else {
        scrollButton.classList.remove('visible');
    }
});
