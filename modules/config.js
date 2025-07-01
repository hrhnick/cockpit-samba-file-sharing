// Samba Manager - Configuration Management Module
(function() {
    'use strict';

    // Lazy dependency getters
    function app() { return window.SambaManager.app; }
    function utils() { return window.SambaManager.utils; }
    function modals() { return window.SambaManager.modals; }

    // Configuration file state
    let originalContent = '';
    let isEditing = false;

    // Create settings modal dynamically using DOM utilities
    function createSettingsModal() {
        if (!window.SambaManager.modals) return null;
        
        const dom = utils().dom;
        
        const modalId = modals().createModal({
            id: 'settings-modal',
            title: 'Settings',
            size: 'large',
            showFooter: false,
            content: dom.create('div', {}, [
                // Settings info
                dom.create('div', { className: 'settings-info' }, [
                    dom.create('p', {}, [
                        'Configuration file: ',
                        dom.create('code', { textContent: '/etc/samba/smb.conf' })
                    ])
                ]),
                
                // Settings toolbar
                dom.create('div', { className: 'settings-toolbar' }, [
                    dom.create('div', { className: 'settings-toolbar-left' }, [
                        dom.create('button', {
                            type: 'button',
                            className: 'pf-v6-c-button pf-v6-c-button--secondary',
                            id: 'edit-config-btn',
                            textContent: 'Edit'
                        }),
                        dom.create('button', {
                            type: 'button',
                            className: 'pf-v6-c-button pf-v6-c-button--primary',
                            id: 'save-config-btn',
                            style: 'display: none;',
                            textContent: 'Save'
                        }),
                        dom.create('button', {
                            type: 'button',
                            className: 'pf-v6-c-button pf-v6-c-button--secondary',
                            id: 'cancel-edit-btn',
                            style: 'display: none;',
                            textContent: 'Cancel'
                        })
                    ]),
                    dom.create('div', { className: 'settings-toolbar-right' }, [
                        dom.create('button', {
                            type: 'button',
                            className: 'pf-v6-c-button pf-v6-c-button--secondary',
                            id: 'download-config-btn',
                            textContent: 'Download Backup'
                        }),
                        dom.create('button', {
                            type: 'button',
                            className: 'pf-v6-c-button pf-v6-c-button--secondary',
                            id: 'restore-config-btn',
                            textContent: 'Restore'
                        })
                    ])
                ]),
                
                // Config editor
                dom.create('div', { className: 'pf-v6-c-form__group' }, [
                    dom.create('textarea', {
                        className: 'pf-v6-c-form__input config-editor',
                        id: 'config-content',
                        readOnly: true,
                        rows: 20
                    })
                ]),
                
                // Hidden file input for restore
                dom.create('input', {
                    type: 'file',
                    id: 'restore-file-input',
                    accept: '.conf',
                    style: 'display: none;'
                })
            ]).innerHTML,
            onShow: function() {
                loadConfig();
                setupSettingsEventHandlers();
            }
        });
        
        return modalId;
    }

    // Setup settings-specific event handlers
    function setupSettingsEventHandlers() {
        const editBtn = utils().getElement('edit-config-btn');
        const saveBtn = utils().getElement('save-config-btn');
        const cancelBtn = utils().getElement('cancel-edit-btn');
        const downloadBtn = utils().getElement('download-config-btn');
        const restoreBtn = utils().getElement('restore-config-btn');
        const restoreInput = utils().getElement('restore-file-input');
        
        if (editBtn) editBtn.addEventListener('click', enableEdit);
        if (saveBtn) saveBtn.addEventListener('click', saveConfig);
        if (cancelBtn) cancelBtn.addEventListener('click', cancelEdit);
        if (downloadBtn) downloadBtn.addEventListener('click', downloadConfig);
        if (restoreBtn) restoreBtn.addEventListener('click', () => restoreInput.click());
        if (restoreInput) {
            restoreInput.addEventListener('change', e => {
                const file = e.target.files[0];
                if (file) {
                    handleRestore(file);
                    e.target.value = ''; // Reset the input
                }
            });
        }
    }

    // Initialize modal on first use
    let settingsModalId = null;
    function ensureSettingsModal() {
        if (!settingsModalId || !utils().getElement(settingsModalId)) {
            settingsModalId = createSettingsModal();
        }
    }

    // Configuration management using error handler
    async function loadConfig() {
        const result = await utils().executeCommand(['cat', app().configPath]);
        const configTextarea = utils().getElement('config-content');
        
        if (result.success) {
            originalContent = result.data;
            configTextarea.value = result.data;
        } else {
            configTextarea.value = 'Failed to load configuration file: ' + result.error;
        }
    }

    function enableEdit() {
        // Show warning
        if (!confirm('Hic sunt dracones! Manually editing the smb.conf can break existing functionality. Are you sure you want to continue?')) {
            return;
        }

        isEditing = true;
        const configTextarea = utils().getElement('config-content');
        configTextarea.readOnly = false;
        
        utils().dom.toggle('edit-config-btn', false);
        utils().dom.toggle('save-config-btn', true);
        utils().dom.toggle('cancel-edit-btn', true);
        
        configTextarea.focus();
    }

    function cancelEdit() {
        isEditing = false;
        const configTextarea = utils().getElement('config-content');
        configTextarea.readOnly = true;
        configTextarea.value = originalContent;
        
        utils().dom.toggle('edit-config-btn', true);
        utils().dom.toggle('save-config-btn', false);
        utils().dom.toggle('cancel-edit-btn', false);
    }

    async function saveConfig() {
        const confirmed = await modals().confirm(
            'Saving these changes will reload the Samba configuration. Are you sure you want to continue?',
            { title: 'Save Configuration', confirmLabel: 'Save', cancelLabel: 'Cancel' }
        );
        
        if (!confirmed) return;

        const newContent = utils().getElement('config-content').value;

        return utils().errorHandler.handleAsync(
            doSaveConfig(newContent),
            'config-save',
            async function() {
                utils().showNotification('Configuration saved and reloaded successfully', 'success');
                originalContent = newContent;
                cancelEdit();
                
                // Reload shares and service status
                if (window.SambaManager.shares) {
                    await window.SambaManager.shares.loadShares();
                }
                await window.SambaManager.ui.loadServiceStatus();
            }
        );
    }

    async function doSaveConfig(content) {
        // Create backup
        const backupFile = `/etc/samba/smb.conf.backup.${Date.now()}`;
        await utils().executeCommand(['cp', app().configPath, backupFile], { superuser: 'require' });

        // Write new content to a temporary file first
        const tempFile = `/tmp/smb.conf.temp.${Date.now()}`;
        // Use cockpit.file to write the content
        const file = cockpit.file(tempFile);
        await file.replace(content);
        await file.close();
        
        // Test the configuration
        const testResult = await utils().executeCommand(['testparm', '-s', tempFile], { silent: true });
        if (!testResult.success) {
            // Clean up temp file
            await utils().executeCommand(['rm', '-f', tempFile]);
            throw new Error('Configuration validation failed: ' + testResult.error);
        }

        // Copy the validated config to the actual location (preserves SELinux context)
        await utils().executeCommand(['cp', tempFile, app().configPath], { superuser: 'require' });
        
        // Clean up temp file
        await utils().executeCommand(['rm', '-f', tempFile]);
        
        // Restore SELinux context just in case
        await utils().executeCommand(['restorecon', app().configPath], { superuser: 'try', silent: true });
        
        // Also try to set proper permissions
        await utils().executeCommand(['chmod', '644', app().configPath], { superuser: 'require', silent: true });

        // Reload configuration
        return reloadSambaConfig();
    }

    async function reloadSambaConfig() {
        // Try to reload using smbcontrol first (no service disruption)
        const cmd = utils().sambaCommands.reloadConfig();
        const reloadResult = await utils().executeCommand(cmd.command, cmd.options);
        
        if (!reloadResult.success) {
            // Try alternative smbcontrol command
            const altResult = await utils().executeCommand(['smbcontrol', 'all', 'reload-config'], 
                { superuser: 'require', silent: true });
            
            if (!altResult.success && window.SambaManager.ui) {
                // If smbcontrol fails, try systemctl reload as last resort
                return window.SambaManager.ui.reloadSambaService();
            }
        }
        
        return { success: true };
    }

    async function downloadConfig() {
        try {
            const content = utils().getElement('config-content').value;
            const blob = new Blob([content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `smb.conf.backup.${new Date().toISOString().replace(/:/g, '-')}.conf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            utils().showNotification('Configuration downloaded successfully', 'success');
        } catch (error) {
            utils().showNotification('Failed to download configuration: ' + error.message, 'error');
        }
    }

    async function handleRestore(file) {
        const confirmed = await modals().confirm(
            'This will replace the current configuration with the uploaded file and reload the Samba configuration. Are you sure?',
            { title: 'Restore Configuration', confirmLabel: 'Restore', cancelLabel: 'Cancel' }
        );
        
        if (!confirmed) return;

        try {
            const content = await readFile(file);
            await doSaveConfig(content);
            
            utils().showNotification('Configuration restored and reloaded successfully', 'success');
            
            // Reload the configuration in the modal
            await loadConfig();
            
        } catch (error) {
            utils().showNotification('Failed to restore configuration: ' + error.message, 'error');
        }
    }

    function readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    // Settings modal functions
    function showSettingsModal() {
        ensureSettingsModal();
        if (modals() && settingsModalId) {
            modals().showModal(settingsModalId);
        }
    }

    function hideSettingsModal() {
        if (modals() && settingsModalId) {
            modals().hideModal(settingsModalId);
        }
    }

    // Export public interface
    window.SambaManager.config = {
        showSettingsModal,
        hideSettingsModal,
        reloadSambaConfig
    };

})();