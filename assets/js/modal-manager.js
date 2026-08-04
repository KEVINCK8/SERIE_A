/**
 * Modal Manager - Gestione centralizzata dei popup e delle notifiche
 * Stile moderno, Glassmorphism e animazioni fluide.
 */

class ModalManager {
    constructor() {
        this.container = this._createContainer();
        this.modals = [];
    }

    _createContainer() {
        let container = document.getElementById('modal-manager-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'modal-manager-container';
            document.body.appendChild(container);
        }
        return container;
    }

    /**
     * Mostra una notifica (Toast)
     * @param {string} message - Messaggio da mostrare
     * @param {string} type - 'success', 'error', 'info', 'warning'
     * @param {number} duration - Durata in ms
     */
    showToast(message, type = 'info', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `toast-notification ${type}`;
        
        const iconHtml = this._getIconForType(type);
        
        toast.innerHTML = `
            <div class="toast-content">
                ${iconHtml}
                <span>${message}</span>
            </div>
            <div class="toast-progress"></div>
        `;

        this.container.appendChild(toast);

        // Animazione ingresso
        setTimeout(() => toast.classList.add('show'), 10);

        // Rimozione automatica
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        }, duration);
    }

    /**
     * Crea un modal dinamico
     * @param {Object} options - { title, content, buttons, onClose }
     */
    openModal({ title, content, buttons = [], onClose = null }) {
        const modalId = `modal-${Date.now()}`;
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal-overlay';
        modalOverlay.id = modalId;

        const modalContent = document.createElement('div');
        modalContent.className = 'modal-glass-content';
        
        let buttonsHtml = buttons.map((btn, index) => `
            <button class="btn-${btn.type || 'primary'}" data-index="${index}">${btn.text}</button>
        `).join('');

        modalContent.innerHTML = `
            <div class="modal-header">
                <h3>${title}</h3>
                <button class="close-modal-btn">&times;</button>
            </div>
            <div class="modal-body">
                ${content}
            </div>
            <div class="modal-footer">
                ${buttonsHtml}
            </div>
        `;

        modalOverlay.appendChild(modalContent);
        this.container.appendChild(modalOverlay);

        // Gestione chiusura
        const closeModal = () => {
            modalOverlay.classList.remove('show');
            setTimeout(() => {
                modalOverlay.remove();
                if (onClose) onClose();
            }, 300);
        };

        modalContent.querySelector('.close-modal-btn').onclick = closeModal;
        modalOverlay.onclick = (e) => { if (e.target === modalOverlay) closeModal(); };

        // Gestione pulsanti
        modalContent.querySelectorAll('.modal-footer button').forEach(btn => {
            btn.onclick = () => {
                const index = btn.getAttribute('data-index');
                const action = buttons[index].action;
                if (action) action(closeModal);
                else closeModal();
            };
        });

        // Mostra con animazione
        setTimeout(() => modalOverlay.classList.add('show'), 10);

        return { id: modalId, close: closeModal };
    }

    /**
     * Modal di conferma rapida
     */
    confirm(title, message, onConfirm, onCancel = null) {
        return this.openModal({
            title,
            content: `<p>${message}</p>`,
            buttons: [
                { text: 'Annulla', type: 'secondary', action: (close) => { if(onCancel) onCancel(); close(); } },
                { text: 'Conferma', type: 'danger', action: (close) => { onConfirm(); close(); } }
            ]
        });
    }

    _getIconForType(type) {
        const path = 'assets/image/icon/';
        switch (type) {
            case 'success': return `<img src="${path}007-trophy.png" style="width:24px; height:24px;">`;
            case 'error': return `<img src="${path}026-bomb.png" style="width:24px; height:24px;">`;
            case 'warning': return `<img src="${path}030-blasting.png" style="width:24px; height:24px;">`;
            default: return `<img src="${path}017-football-card.png" style="width:24px; height:24px;">`;
        }
    }
}

export const modalManager = new ModalManager();
