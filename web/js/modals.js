const Modals = {
    show(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'flex';
        }
    },

    hide(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
        } 
    },

    createModal(id, contentHtml, onClose) {
        const existing = document.getElementById(id);
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = id;
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content">
                <span class="modal-close">&times;</span>
                ${contentHtml}
            </div>
        `;

        overlay.querySelector('.modal-close').onclick = () => {
            this.hide(id);
            if (onClose) onClose();
        };
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                this.hide(id);
                if (onClose) onClose();
            }
        });
        document.body.appendChild(overlay);
        this.hide(id);
        return overlay;
    }
};