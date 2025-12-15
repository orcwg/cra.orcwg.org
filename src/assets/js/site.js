// Storage utilities
function getStorageValue(name) {
    return sessionStorage.getItem(name);
}

function setStorageValue(name, value) {
    sessionStorage.setItem(name, value);
}

// Admin mode functionality
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

// Accordion animation utilities
const ANIMATION_DURATION = 300;

// Easing function: Smooth cubic ease-in-out
// ============================================
// Standard cubic bezier easing that transitions smoothly at the midpoint
// First half uses cubic ease-in, second half uses cubic ease-out
// Formula is continuous and smooth throughout

function easeInOutCubic(t) {
    if (t < 0.5) {
        // First half: accelerate in
        return 4 * t * t * t;
    } else {
        // Second half: decelerate out
        const p = 2 * t - 2;
        return 0.5 * p * p * p + 1;
    }
}

function animateAccordionOpen(details) {
    const article = details.querySelector('article');
    const summary = details.querySelector('summary');
    if (!article) return Promise.resolve();

    return new Promise(resolve => {
        // Set initial state
        article.style.overflow = 'hidden';
        article.style.height = '0px';
        article.style.paddingTop = '0px';
        article.style.paddingBottom = '0px';
        details.open = true;

        // Measure final height with CSS padding applied
        article.style.paddingTop = '';
        article.style.paddingBottom = '';
        const finalHeight = article.scrollHeight;

        // Reset to animation start state
        article.style.paddingTop = '0px';
        article.style.paddingBottom = '0px';

        const startTime = Date.now();

        function frame() {
            const elapsed = Date.now() - startTime;
            const rawProgress = Math.min(elapsed / ANIMATION_DURATION, 1);
            const progress = easeInOutCubic(rawProgress);

            // Animate height and padding
            article.style.height = (finalHeight * progress) + 'px';
            article.style.paddingTop = (20 * progress) + 'px';
            article.style.paddingBottom = (20 * progress) + 'px';

            // Rotate caret from 0° to -180°
            if (summary) {
                const caretRotation = -180 * progress;
                summary.style.setProperty('--caret-rotation', caretRotation + 'deg');
            }

            if (progress < 1) {
                requestAnimationFrame(frame);
            } else {
                // Complete state - clear all animation styles
                article.style.height = '';
                article.style.paddingTop = '';
                article.style.paddingBottom = '';
                article.style.overflow = '';
                if (summary) {
                    summary.style.setProperty('--caret-rotation', '-180deg');
                }
                resolve();
            }
        }

        requestAnimationFrame(frame);
    });
}

function animateAccordionClose(details) {
    const article = details.querySelector('article');
    const summary = details.querySelector('summary');
    if (!article) return Promise.resolve();

    return new Promise(resolve => {
        article.style.overflow = 'hidden';
        // Measure current height
        const currentHeight = article.scrollHeight;
        const startTime = Date.now();

        function frame() {
            const elapsed = Date.now() - startTime;
            const rawProgress = Math.min(elapsed / ANIMATION_DURATION, 1);
            const progress = easeInOutCubic(rawProgress);

            // Animate height and padding together
            article.style.height = (currentHeight * (1 - progress)) + 'px';
            article.style.paddingTop = (20 * (1 - progress)) + 'px';
            article.style.paddingBottom = (20 * (1 - progress)) + 'px';

            // Rotate caret from -180° to 0°
            if (summary) {
                const caretRotation = -180 * (1 - progress);
                summary.style.setProperty('--caret-rotation', caretRotation + 'deg');
            }

            if (progress < 1) {
                requestAnimationFrame(frame);
            } else {
                // Complete state
                article.style.height = '0px';
                article.style.paddingTop = '0px';
                article.style.paddingBottom = '0px';
                article.style.overflow = '';
                if (summary) {
                    summary.style.setProperty('--caret-rotation', '0deg');
                }
                details.open = false;
                resolve();
            }
        }

        requestAnimationFrame(frame);
    });
}

// Accordion click handler with JS-driven animations
document.addEventListener('click', async function(e) {
    const summary = e.target.closest('summary');
    if (!summary) return;

    const details = summary.closest('details.faq-accordion-item');
    if (!details) return;

    // Always prevent default to control opening/closing ourselves
    e.preventDefault();
    e.stopPropagation();

    if (details.open) {
        // User clicked an open accordion - close it with animation
        await animateAccordionClose(details);
    } else {
        // User clicked a closed accordion - close any open ones first with animation
        const initialScrollY = window.scrollY;

        const openAccordions = Array.from(document.querySelectorAll('details.faq-accordion-item[open]'));

        // Store info about accordions we're closing BEFORE we close them
        const closingInfo = openAccordions.map(accordion => {
            const isAbove = accordion.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING;
            const sizeWhenOpen = accordion.offsetHeight;

            return {
                accordion: accordion,
                isAbove: isAbove,
                sizeWhenOpen: sizeWhenOpen
            };
        });

        // Close all open accordions in parallel with scroll compensation
        const startTime = Date.now();

        const scrollCompensationLoop = () => {
            const elapsed = Date.now() - startTime;
            const rawProgress = Math.min(elapsed / ANIMATION_DURATION, 1);
            const progress = easeInOutCubic(rawProgress);

            // Calculate total height lost so far during the closing animation
            let totalHeightLostAbove = 0;
            closingInfo.forEach(({isAbove, accordion, sizeWhenOpen}) => {
                if (isAbove) {
                    const currentSize = accordion.offsetHeight;
                    const heightLost = sizeWhenOpen - currentSize;
                    totalHeightLostAbove += heightLost;
                }
            });

            // Compensate scroll to keep clicked element in same viewport position
            const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
            const targetScroll = Math.max(0, Math.min(initialScrollY - totalHeightLostAbove, maxScroll));
            window.scrollTo(0, targetScroll);

            if (progress < 1) {
                requestAnimationFrame(scrollCompensationLoop);
            }
        };

        // Start the closing animations, scroll compensation, and opening animation together
        await Promise.all([
            ...openAccordions.map(openDetail => animateAccordionClose(openDetail)),
            animateAccordionOpen(details),
            new Promise(resolve => {
                requestAnimationFrame(scrollCompensationLoop);
                // Wait for animations to complete
                setTimeout(resolve, ANIMATION_DURATION);
            })
        ]);
    }
}, true);

// Mermaid diagram initialization
document.addEventListener('DOMContentLoaded', function() {
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

    // Attach toggle functionality to existing button
    const toggleButton = document.querySelector('.admin-toggle');
    if (toggleButton) {
        toggleButton.addEventListener('click', toggleAdminMode);
    }

    // Copy link functionality
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
});
