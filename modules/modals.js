// Samba Manager - Modal Management Module
(function() {
    'use strict';

    // Dependencies
    function utils() { return window.SambaManager.utils; }

    // Modal registry and state
    const modals = {};
    const modalStack = [];
    let previousFocusElement = null;

    // Register a modal configuration
    function registerModal(modalId, config) {
        let element = utils().getElement(modalId);
        
        if (!element) {
            // Create modal dynamically
            createModal(Object.assign({ id: modalId }, config));
            return;
        }

        // Store configuration
        modals[modalId] = {
            element: element,
            ...config
        };

        // Setup form if needed
        if (config.fields && config.fields.length > 0) {
            setupModalForm(modalId);
        }
    }

    // Show modal with optional data
    function showModal(modalId, data) {
        const config = modals[modalId];
        if (!config || !config.element) {
            console.error('Modal not registered:', modalId);
            return;
        }

        // Store current focus
        previousFocusElement = document.activeElement;
        modalStack.push(modalId);

        // Reset form if present
        if (config.fields) {
            resetModalForm(modalId, data);
        }

        // Update dynamic content
        updateDynamicContent(modalId, data);

        // Call onShow callback
        if (config.onShow) {
            config.onShow(data);
        }

        // Show modal
        config.element.style.display = 'flex';
        config.element.removeAttribute('aria-hidden');
        
        // Focus first element
        setTimeout(() => {
            const focusable = config.element.querySelector(
                'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), .pf-v6-c-modal__close'
            );
            if (focusable) focusable.focus();
        }, 10);
    }

    // Update dynamic content (title, submit label)
    function updateDynamicContent(modalId, data) {
        const config = modals[modalId];
        
        // Update title if dynamic
        if (config.title && typeof config.title === 'function') {
            const titleElement = config.element.querySelector('h3, .modal-title');
            if (titleElement) titleElement.textContent = config.title(data);
        }

        // Update submit label if dynamic
        if (config.submitLabel && typeof config.submitLabel === 'function') {
            const submitBtn = config.element.querySelector('[type="submit"], .modal-submit-btn');
            if (submitBtn) submitBtn.textContent = config.submitLabel(data);
        }
    }

    // Hide modal
    function hideModal(modalId) {
        const config = modals[modalId];
        if (!config || !config.element) return;

        // Remove from stack
        const index = modalStack.indexOf(modalId);
        if (index > -1) modalStack.splice(index, 1);

        // Call onHide callback
        if (config.onHide) config.onHide();

        // Restore focus BEFORE hiding
        if (previousFocusElement && previousFocusElement.focus && document.body.contains(previousFocusElement)) {
            try { 
                previousFocusElement.focus(); 
            } catch (e) {
                document.body.focus();
            }
        } else {
            document.body.focus();
        }

        // Hide the modal
        config.element.style.display = 'none';
        previousFocusElement = null;
        
        // Clean up temporary modals
        if (modalId.includes('-temp-')) {
            setTimeout(() => {
                config.element.remove();
                delete modals[modalId];
            }, 50);
        }

        // Clear validation states
        clearValidationStates(modalId);
    }

    // Setup modal form
    function setupModalForm(modalId) {
        const config = modals[modalId];
        const form = config.element.querySelector('form');
        
        if (!form) return;

        // Handle form submission
        form.addEventListener('submit', e => {
            e.preventDefault();
            handleModalSubmit(modalId);
        });

        // Simple field validation on blur
        form.addEventListener('blur', e => {
            if (e.target.matches('input, textarea, select')) {
                validateField(modalId, e.target.name, e.target.value);
            }
        }, true);
        
        // Clear errors on input
        form.addEventListener('input', e => {
            if (e.target.matches('input, textarea, select')) {
                clearFieldError(modalId, e.target.name);
            }
        }, true);
    }

    // Reset modal form
    function resetModalForm(modalId, data) {
        const config = modals[modalId];
        const form = config.element.querySelector('form');
        
        if (!form) return;

        form.reset();
        clearValidationStates(modalId);

        // Populate fields with data
        if (data) {
            config.fields.forEach(field => {
                if (data[field.name] !== undefined) {
                    const input = form.querySelector(`[name="${field.name}"]`);
                    if (input) {
                        input[input.type === 'checkbox' ? 'checked' : 'value'] = data[field.name];
                    }
                }
            });
        }

        // Reset button state
        const submitBtn = form.querySelector('[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = typeof config.submitLabel === 'function' ? 
                config.submitLabel(data) : (config.submitLabel || 'Submit');
        }
    }

    // Handle modal submission
    function handleModalSubmit(modalId) {
        const config = modals[modalId];
        const form = config.element.querySelector('form');
        
        // Handle non-form modals
        if (!form && config.onSubmit) {
            const result = config.onSubmit({});
            if (result === true) hideModal(modalId);
            return;
        }
        
        if (!form) return;

        // Validate all fields
        const formData = {};
        let hasErrors = false;

        config.fields.forEach(field => {
            const input = form.querySelector(`[name="${field.name}"]`);
            if (!input) return;

            const value = input.type === 'checkbox' ? input.checked : input.value.trim();
            formData[field.name] = value;

            const error = validateField(modalId, field.name, value);
            if (error) hasErrors = true;
        });

        if (hasErrors) {
            utils().showNotification('Please fix the errors before submitting', 'error');
            return;
        }

        // Disable submit button
        const submitBtn = form.querySelector('[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Processing...';
        }

        // Call onSubmit handler
        if (config.onSubmit) {
            const result = config.onSubmit(formData);
            
            // Handle promise result
            if (result && typeof result.then === 'function') {
                result.then(
                    success => {
                        if (success) hideModal(modalId);
                    },
                    error => {
                        if (submitBtn) {
                            submitBtn.disabled = false;
                            submitBtn.textContent = typeof config.submitLabel === 'function' ? 
                                config.submitLabel() : (config.submitLabel || 'Submit');
                        }
                        // Handle field-specific errors
                        if (typeof error === 'object' && error.field) {
                            showFieldError(modalId, error.field, error.message);
                        }
                    }
                );
            } else if (result === true) {
                hideModal(modalId);
            } else if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = typeof config.submitLabel === 'function' ? 
                    config.submitLabel() : (config.submitLabel || 'Submit');
            }
        }
    }

    // Validate a single field
    function validateField(modalId, fieldName, value) {
        const config = modals[modalId];
        const field = config.fields.find(f => f.name === fieldName);
        if (!field) return null;

        let error = null;

        // Check required
        if (field.required && !value) {
            error = (field.label || fieldName) + ' is required';
        } else if (config.validators && config.validators[fieldName]) {
            error = config.validators[fieldName](value);
        }

        // Show/clear error
        if (error) {
            showFieldError(modalId, fieldName, error);
        } else {
            clearFieldError(modalId, fieldName);
        }

        return error;
    }

    // Show field error
    function showFieldError(modalId, fieldName, message) {
        const config = modals[modalId];
        const input = config.element.querySelector(`[name="${fieldName}"]`);
        if (!input) return;

        input.classList.add('error');

        let errorElement = input.parentNode.querySelector('.field-error');
        if (!errorElement) {
            errorElement = document.createElement('div');
            errorElement.className = 'field-error';
            errorElement.textContent = message;
            input.parentNode.appendChild(errorElement);
        } else {
            errorElement.textContent = message;
        }
    }

    // Clear field error
    function clearFieldError(modalId, fieldName) {
        const config = modals[modalId];
        const input = config.element.querySelector(`[name="${fieldName}"]`);
        if (!input) return;

        input.classList.remove('error');
        const errorElement = input.parentNode.querySelector('.field-error');
        if (errorElement) errorElement.remove();
    }

    // Clear all validation states
    function clearValidationStates(modalId) {
        const config = modals[modalId];
        if (!config || !config.element) return;
        
        config.element.querySelectorAll('.error').forEach(el => {
            el.classList.remove('error');
        });
        config.element.querySelectorAll('.field-error').forEach(el => el.remove());
    }

    // Create modal HTML structure
    function createModal(options) {
        const modalId = options.id || 'modal-temp-' + Date.now();
        const size = options.size || 'medium';
        const dom = utils().dom;
        
        // Build modal structure
        const modal = dom.create('div', {
            id: modalId,
            className: 'pf-v6-c-modal',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': modalId + '-title',
            style: 'display: none;'
        });
        
        const modalBox = dom.create('div', {
            className: 'pf-v6-c-modal__box modal-' + size
        });
        
        // Header
        const header = dom.create('header', { className: 'pf-v6-c-modal__header' });
        const titleText = typeof options.title === 'function' ? options.title() : (options.title || 'Modal');
        header.appendChild(dom.create('h3', {
            id: modalId + '-title',
            textContent: titleText
        }));
        
        const closeBtn = dom.create('button', {
            type: 'button',
            className: 'pf-v6-c-modal__close',
            'aria-label': 'Close dialog',
            textContent: '×'
        });
        // Use addEventListener instead of onclick to avoid issues
        closeBtn.addEventListener('click', () => hideModal(modalId));
        header.appendChild(closeBtn);
        
        modalBox.appendChild(header);
        
        // Body
        const body = dom.create('div', { className: 'pf-v6-c-modal__body' });
        
        if (options.content) {
            // Check if content is a DOM element or HTML string
            if (typeof options.content === 'string') {
                body.innerHTML = options.content;
            } else if (options.content instanceof Node) {
                body.appendChild(options.content);
            }
        } else if (options.fields && options.fields.length > 0) {
            const form = dom.create('form', { id: modalId + '-form', noValidate: true });
            options.fields.forEach(field => {
                form.appendChild(createFormField(field));
            });
            body.appendChild(form);
        }
        
        modalBox.appendChild(body);
        
        // Footer
        if (options.showFooter !== false) {
            const footer = dom.create('footer', { className: 'pf-v6-c-modal__footer' });
            
            const submitLabelText = typeof options.submitLabel === 'function' ? 
                options.submitLabel() : (options.submitLabel || 'Submit');
            
            const submitBtn = dom.create('button', {
                type: options.fields ? 'submit' : 'button',
                className: 'pf-v6-c-button pf-v6-c-button--primary modal-submit-btn',
                textContent: submitLabelText
            });
            
            if (options.fields) {
                submitBtn.setAttribute('form', modalId + '-form');
            } else {
                submitBtn.addEventListener('click', () => handleModalSubmit(modalId));
            }
            
            footer.appendChild(submitBtn);
            
            if (options.showCancel !== false) {
                const cancelBtn = dom.create('button', {
                    type: 'button',
                    className: 'pf-v6-c-button pf-v6-c-button--secondary',
                    textContent: options.cancelLabel || 'Cancel'
                });
                cancelBtn.addEventListener('click', () => hideModal(modalId));
                footer.appendChild(cancelBtn);
            }
            
            modalBox.appendChild(footer);
        }
        
        modal.appendChild(modalBox);
        document.body.appendChild(modal);

        // Store config
        modals[modalId] = {
            element: modal,
            ...options
        };

        // Setup form if needed
        if (options.fields && options.fields.length > 0) {
            setupModalForm(modalId);
        }
        
        return modalId;
    }

    // Create form field element
    function createFormField(field) {
        const dom = utils().dom;
        const group = dom.create('div', { className: 'pf-v6-c-form__group' });
        
        // Label (except for checkboxes)
        if (field.type !== 'checkbox') {
            const label = dom.create('label', {
                className: 'pf-v6-c-form__label',
                for: field.name,
                textContent: field.label + (field.required ? ' *' : '')
            });
            group.appendChild(label);
        }
        
        // Input element
        let input;
        
        switch (field.type) {
            case 'textarea':
                input = dom.create('textarea', {
                    className: 'pf-v6-c-form__input',
                    id: field.name,
                    name: field.name,
                    placeholder: field.placeholder || '',
                    rows: field.rows || 5,
                    required: field.required || false,
                    autocomplete: 'off'
                });
                break;
                
            case 'select':
                input = dom.create('select', {
                    className: 'pf-v6-c-form__input',
                    id: field.name,
                    name: field.name,
                    required: field.required || false,
                    autocomplete: 'off'
                });
                
                (field.options || []).forEach(option => {
                    const value = option.value !== undefined ? option.value : option;
                    const label = option.label || option;
                    const opt = dom.create('option', {
                        value: value,
                        textContent: label
                    });
                    if (field.defaultValue === value) opt.selected = true;
                    input.appendChild(opt);
                });
                break;
                
            case 'checkbox':
                const checkboxWrapper = dom.create('div', { className: 'pf-v6-c-form__group-control' });
                const checkLabel = dom.create('label', { className: 'pf-v6-c-check' });
                input = dom.create('input', {
                    type: 'checkbox',
                    className: 'pf-v6-c-check__input',
                    id: field.name,
                    name: field.name,
                    checked: field.defaultValue || false
                });
                checkLabel.appendChild(input);
                checkLabel.appendChild(dom.create('span', {
                    className: 'pf-v6-c-check__label',
                    textContent: field.label
                }));
                checkboxWrapper.appendChild(checkLabel);
                group.appendChild(checkboxWrapper);
                
                // Skip adding input again since it's in the label
                input = null;
                break;
                
            default:
                input = dom.create('input', {
                    className: 'pf-v6-c-form__input',
                    type: field.type || 'text',
                    id: field.name,
                    name: field.name,
                    placeholder: field.placeholder || '',
                    value: field.defaultValue || '',
                    required: field.required || false,
                    autocomplete: 'off'
                });
                if (field.pattern) input.pattern = field.pattern;
        }
        
        if (input) group.appendChild(input);
        
        // Helper text
        if (field.helperText) {
            group.appendChild(dom.create('div', {
                className: 'pf-v6-c-form__helper-text',
                innerHTML: field.helperText
            }));
        }
        
        return group;
    }

    // Setup global event handlers
    function setupGlobalHandlers() {
        // ESC key handler
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && modalStack.length > 0) {
                const topModal = modalStack[modalStack.length - 1];
                e.preventDefault();
                hideModal(topModal);
            }
        });

        // Backdrop click handler
        document.addEventListener('click', e => {
            if (e.target.classList.contains('pf-v6-c-modal')) {
                const modalId = e.target.id;
                if (modalStack.includes(modalId)) {
                    hideModal(modalId);
                }
            }
        });
    }

    // Simple helper functions
    function confirm(message, options = {}) {
        return new Promise(resolve => {
            let resolved = false;
            
            const modalId = createModal({
                size: 'small',
                title: options.title || 'Confirm',
                content: '<p>' + utils().escapeHtml(message) + '</p>',
                submitLabel: options.confirmLabel || 'Confirm',
                cancelLabel: options.cancelLabel || 'Cancel',
                showCancel: true,
                onSubmit: () => {
                    resolved = true;
                    resolve(true);
                    return true;
                },
                onHide: () => {
                    if (!resolved) resolve(false);
                }
            });
            
            showModal(modalId);
        });
    }

    function alert(message, options = {}) {
        return new Promise(resolve => {
            const modalId = createModal({
                size: 'small',
                title: options.title || 'Alert',
                content: '<p>' + utils().escapeHtml(message) + '</p>',
                submitLabel: 'OK',
                showCancel: false,
                onSubmit: () => {
                    resolve();
                    return true;
                }
            });
            
            showModal(modalId);
        });
    }

    // Initialize
    setupGlobalHandlers();

    // Export public interface
    window.SambaManager.modals = {
        registerModal,
        showModal,
        hideModal,
        createModal,
        confirm,
        alert,
        handleModalSubmit
    };

})();
