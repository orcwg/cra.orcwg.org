// ============================================================================
// STORAGE UTILITIES
// ============================================================================

function getStorageValue(name) {
    return sessionStorage.getItem(name);
}

function setStorageValue(name, value) {
    sessionStorage.setItem(name, value);
}


// ============================================================================
// ADMIN MODE TOGGLE FUNCTIONALITY
// ============================================================================
function applyAdminMode(enabled) {
    if (enabled) {
        document.body.classList.add('admin-mode');
    } else {
        document.body.classList.remove('admin-mode');
    }
}

function toggleAdminMode(event) {
    event.preventDefault();
    event.stopPropagation();

    const isEnabled = document.body.classList.contains('admin-mode');
    const newState = !isEnabled;

    applyAdminMode(newState);
    setStorageValue('adminMode', newState ? '1' : '0');

    // Scroll to bottom after DOM updates
    requestAnimationFrame(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
    });
}

// Initialize admin mode from sessionStorage immediately
const adminModeValue = getStorageValue('adminMode');
if (adminModeValue === '1') {
    applyAdminMode(true);
}

function attachAdminToggle() {
    const toggleButton = document.querySelector('.admin-toggle');
    if (toggleButton) {
        toggleButton.addEventListener('click', toggleAdminMode);
    }
}


// ============================================================================
// ACCORDION ANIMATION SYSTEM
// ============================================================================

// Custom easing function for the accordion animation, slow start and snappy end
const easeInOutCubic = t => t < 0.8 ? 2 * t ** 3 : 0.5 * (2 * t - 2) ** 3 + 1;

function animateAccordion(details, isOpening) {
    const article = details.querySelector('article');
    const summary = details.querySelector('summary');
    if (!article) return Promise.resolve();

    const startHeight = isOpening ? 0 : article.scrollHeight;
    const endHeight = isOpening ? article.scrollHeight : 0;
    const startTime = Date.now();

    article.style.overflow = 'hidden';
    if (isOpening) {
        article.style.height = '0px';
        details.open = true;
    }

    return new Promise(resolve => {
        const frame = () => {
            const t = Math.min((Date.now() - startTime) / 300, 1);
            const progress = t < 0.8 ? 2 * t ** 3 : 0.5 * (2 * t - 2) ** 3 + 1;

            article.style.height = (startHeight + (endHeight - startHeight) * progress) + 'px';
            summary?.style.setProperty('--caret-rotation', (isOpening ? -180 * progress : -180 * (1 - progress)) + 'deg');

            if (progress < 1) {
                requestAnimationFrame(frame);
            } else {
                article.style.height = endHeight === 0 ? '0px' : '';
                article.style.overflow = '';
                summary?.style.setProperty('--caret-rotation', (isOpening ? -180 : 0) + 'deg');
                if (!isOpening) details.open = false;
                resolve();
            }
        };
        requestAnimationFrame(frame);
    });
}

// Track if an animation is currently running to prevent concurrent animations
let isAnimating = false;

async function closeAndCompensateScroll(openAccordion, details, sizeWhenOpen) {
    const initialScrollY = window.scrollY;
    const startTime = Date.now();

    const compensateScroll = () => {
        const progress = easeInOutCubic(Math.min((Date.now() - startTime) / 300, 1));
        const heightLost = sizeWhenOpen - openAccordion.offsetHeight;
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo(0, Math.max(0, Math.min(initialScrollY - heightLost, maxScroll)));

        if (progress < 1) requestAnimationFrame(compensateScroll);
    };

    await Promise.all([
        animateAccordion(openAccordion, false),
        animateAccordion(details, true),
        new Promise(resolve => {
            requestAnimationFrame(compensateScroll);
            setTimeout(resolve, 300);
        })
    ]);
}

function attachAccordionClickHandler() {
    document.addEventListener('click', async function(e) {
        const summary = e.target.closest('summary');
        const details = summary?.closest('details.faq-accordion-item');

        // Only handle accordion interactions
        if (!summary || !details) return;
        if (isAnimating) return;

        e.preventDefault();
        e.stopPropagation();
        isAnimating = true;

        try {
            if (details.open) { // Closes the clicked accordion if it's already open
                await animateAccordion(details, false);
            } else {
                const openAccordion = document.querySelector('details.faq-accordion-item[open]');
                if (openAccordion) {
                    if (openAccordion.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING) { // If there is an open accordion above, close it and compensate scroll.
                        await closeAndCompensateScroll(openAccordion, details, openAccordion.offsetHeight);
                    } else { // If the clicked accordion is below the open one, simply close it while opening the clicked accordion.
                        await Promise.all([
                            animateAccordion(openAccordion, false),
                            animateAccordion(details, true)
                        ]);
                    }
                } else { // If there is no open accordion, just open the clicked one.
                    await animateAccordion(details, true);
                }
            }
        } finally {
            isAnimating = false;
        }
    }, true);
}

// ============================================================================
// MERMAID DIAGRAM INITIALIZATION
// ============================================================================

function initializeMermaid() {
    const mermaidBlocks = document.querySelectorAll('code.language-mermaid');
    mermaidBlocks.forEach(function(block) {
        const mermaidDiv = document.createElement('div');
        mermaidDiv.className = 'mermaid';
        mermaidDiv.textContent = block.textContent;
        block.parentNode.parentNode.replaceChild(mermaidDiv, block.parentNode);
    });

    // Initialize Mermaid after converting blocks
    mermaid.initialize({
        startOnLoad: false,
        theme: 'default'
    });

    // Manually trigger Mermaid rendering
    mermaid.run();
}


// ============================================================================
// COPY LINK FUNCTIONALITY
// ============================================================================

function initializeCopyLink() {
    document.querySelectorAll('.action-button[data-permalink]').forEach(function(button) {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();

            const permalink = this.getAttribute('data-permalink');
            const fullUrl = window.location.origin + permalink;
            const textSpan = button.querySelector('span');

            navigator.clipboard.writeText(fullUrl).then(function() {
                // Visual feedback
                textSpan.textContent = 'Copied!';
                button.classList.add('copied');

                setTimeout(function() {
                    textSpan.textContent = 'Copy link';
                    button.classList.remove('copied');
                }, 2000);
            }).catch(function(err) {
                console.error('Failed to copy: ', err);
                textSpan.textContent = 'Failed';
                setTimeout(function() {
                    textSpan.textContent = 'Copy link';
                }, 2000);
            });
        });
    });
}


// ============================================================================
// ACCORDION CLICK HANDLER & SCROLL COMPENSATION
// ============================================================================




// ============================================================================
// DOM INITIALIZATION ORCHESTRATION
// ============================================================================

document.addEventListener('DOMContentLoaded', function() {
    initializeMermaid();
    attachAdminToggle();
    initializeCopyLink();
    attachAccordionClickHandler();
});
