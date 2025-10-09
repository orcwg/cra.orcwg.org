// Accordion functionality for FAQ components
function toggleAccordion(trigger) {
    const item = trigger.closest('.faq-item');
    const content = item.querySelector('.faq-content');
    const icon = trigger.querySelector('.accordion-icon');
    const isOpen = item.classList.contains('open');

    // Close all other items in this category
    const category = item.closest('.faq-category');
    category.querySelectorAll('.faq-item.open').forEach(openItem => {
        if (openItem !== item) {
            openItem.classList.remove('open');
            openItem.querySelector('.faq-content').style.maxHeight = null;
            openItem.querySelector('.accordion-icon').style.transform = 'rotate(0deg)';
        }
    });

    // Toggle current item
    if (isOpen) {
        item.classList.remove('open');
        content.style.maxHeight = null;
        icon.style.transform = 'rotate(0deg)';
    } else {
        item.classList.add('open');
        content.style.maxHeight = content.scrollHeight + 'px';
        icon.style.transform = 'rotate(180deg)';
    }
}
