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
