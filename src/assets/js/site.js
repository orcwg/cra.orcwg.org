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

// Accordion collapse animation
document.addEventListener('click', function(e) {
    const summary = e.target.closest('summary');
    if (!summary) return;

    const details = summary.closest('details.faq-accordion-item');
    if (!details) return;

    // Always prevent default to control opening/closing ourselves
    e.preventDefault();
    e.stopPropagation();

    if (details.open) {
        // User clicked an open accordion - close it with animation
        details.classList.add('closing');
        setTimeout(() => {
            details.classList.remove('closing');
            details.open = false;
        }, 300);
    } else {
        // User clicked a closed accordion - close any open ones first with animation
        const clickedDetailsRect = details.getBoundingClientRect();
        const clickedDetailsY = clickedDetailsRect.top + window.scrollY;

        const openAccordions = document.querySelectorAll('details.faq-accordion-item[open]');

        // Store info about accordions we're closing
        const closingInfo = Array.from(openAccordions).map(accordion => {
            const article = accordion.querySelector('article');
            const accordionY = accordion.getBoundingClientRect().top + window.scrollY;
            const isAbove = accordionY < clickedDetailsY;

            return {
                accordion: accordion,
                article: article,
                isAbove: isAbove,
                heightBefore: article ? article.offsetHeight : 0
            };
        });

        openAccordions.forEach(openDetail => {
            openDetail.classList.add('closing');
            setTimeout(() => {
                openDetail.classList.remove('closing');
                openDetail.open = false;
            }, 300);
        });

        // Then open this one
        details.open = true;

        // Compensate scroll for accordions above
        const initialScrollY = window.scrollY;
        const duration = 300;
        const startTime = Date.now();

        function compensateScroll() {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Calculate total height lost from accordions above the clicked one
            let totalHeightLostAbove = 0;
            closingInfo.forEach(({isAbove, article, heightBefore}) => {
                if (isAbove) {
                    const heightAfter = article ? article.offsetHeight : 0;
                    const heightLost = heightBefore - heightAfter;
                    totalHeightLostAbove += heightLost;
                }
            });

            // Set scroll position to compensate for height lost above
            // But don't scroll past the maximum possible scroll position
            const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
            const targetScroll = Math.max(0, Math.min(initialScrollY - totalHeightLostAbove, maxScroll));
            window.scrollTo(0, targetScroll);

            if (progress < 1) {
                requestAnimationFrame(compensateScroll);
            }
        }

        compensateScroll();
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
