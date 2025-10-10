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

// Admin mode toggle functionality
function toggleAdminMode() {
    const button = document.querySelector('.admin-toggle');
    const adminElements = document.querySelectorAll('.admin-indicators, .faq-admin-info, .admin-info');

    // Toggle active state on button
    const isActive = button.classList.contains('active');

    if (isActive) {
        button.classList.remove('active');
        button.title = 'Show admin information';
        // Hide all admin elements
        adminElements.forEach(el => {
            if (el.classList.contains('admin-info')) {
                el.hidden = true;
            } else {
                el.style.display = 'none';
            }
        });
    } else {
        button.classList.add('active');
        button.title = 'Hide admin information';
        // Show all admin elements
        adminElements.forEach(el => {
            if (el.classList.contains('admin-info')) {
                el.hidden = false;
            } else {
                el.style.display = 'block';
            }
        });
    }
}
