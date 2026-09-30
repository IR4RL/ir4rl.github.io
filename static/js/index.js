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

// Lazily fetch a qualitative-result thumb's source code and populate its overlay,
// caching the in-flight/finished fetch on the element so it only ever loads once.
function loadQualCode(thumb) {
    if (thumb._qualCodePromise) return thumb._qualCodePromise;

    const src = thumb.dataset.codeSrc;
    const codeElement = thumb.querySelector('.qual-code code');
    if (!src || !codeElement) return Promise.resolve('');

    thumb._qualCodePromise = fetch(src)
        .then(function(res) { return res.text(); })
        .then(function(text) {
            codeElement.textContent = text;
            return text;
        })
        .catch(function() {
            codeElement.textContent = 'Failed to load code.';
            return '';
        });

    return thumb._qualCodePromise;
}

// Switch a qualitative-result grid between Images / GIF / Code views
function setQualMode(gridId, mode, button) {
    const grid = document.getElementById(gridId);
    if (!grid) return;

    grid.dataset.mode = mode;

    button.parentElement.querySelectorAll('.qual-toggle-btn').forEach(function(btn) {
        btn.classList.remove('is-active');
    });
    button.classList.add('is-active');

    const caption = document.getElementById(gridId.replace('qual-grid-', 'qual-caption-'));
    if (caption && button.dataset.caption) {
        caption.textContent = button.dataset.caption;
    }

    if (mode === 'code') {
        grid.querySelectorAll('.qual-output[data-code-src]').forEach(loadQualCode);
    }
}

// Copy qualitative-result code snippet to clipboard
function copyQualCode(button) {
    const thumb = button.closest('.qual-output');
    const codeElement = thumb ? thumb.querySelector('code') : button.parentElement.querySelector('code');
    if (!codeElement) return;

    function showCopied() {
        button.classList.add('is-copied');
        button.textContent = 'Copied!';
        setTimeout(function() {
            button.classList.remove('is-copied');
            button.textContent = 'Copy';
        }, 2000);
    }

    function doCopy(text) {
        navigator.clipboard.writeText(text).then(showCopied).catch(function() {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            showCopied();
        });
    }

    const pending = (thumb && thumb.dataset.codeSrc) ? loadQualCode(thumb) : Promise.resolve(codeElement.textContent);
    pending.then(function(text) {
        doCopy(text || codeElement.textContent);
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

// Model dropdown menu
document.querySelectorAll('.link-menu[data-menu]').forEach(function(menu) {
    const trigger = menu.querySelector('.link-menu-trigger');
    const panel = menu.querySelector('.link-menu-panel');
    if (!trigger || !panel) return;

    function close() {
        trigger.setAttribute('aria-expanded', 'false');
        panel.setAttribute('aria-hidden', 'true');
    }

    trigger.addEventListener('click', function(ev) {
        ev.preventDefault();
        const open = trigger.getAttribute('aria-expanded') === 'true';
        trigger.setAttribute('aria-expanded', open ? 'false' : 'true');
        panel.setAttribute('aria-hidden', open ? 'true' : 'false');
    });

    document.addEventListener('click', function(ev) {
        if (!menu.contains(ev.target)) close();
    });

    document.addEventListener('keydown', function(ev) {
        if (ev.key === 'Escape') close();
    });
});
