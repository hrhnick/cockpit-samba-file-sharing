// Samba Manager - Shares Management Module
(function() {
    'use strict';

    // Dependencies - get them when needed
    function getApp() { return window.SambaManager.app; }
    function getUtils() { return window.SambaManager.utils; }
    function getTable() { return window.SambaManager.table; }
    function getModals() { return window.SambaManager.modals; }

    // Share configuration manager
    const shareConfigManager = {
        createDefaultShare: function(name) {
            return {
                name: name,
                path: '',
                comment: '',
                readonly: false,
                guest: false,
                browseable: true,
                validUsers: '',
                access: ''  // For sorting
            };
        },

        parseShareProperty: function(share, line) {
            const equalIndex = line.indexOf('=');
            const key = line.substring(0, equalIndex).trim().toLowerCase();
            const value = line.substring(equalIndex + 1).trim();
            
            switch (key) {
                case 'path':
                    share.path = value;
                    break;
                case 'comment':
                    share.comment = value;
                    break;
                case 'read only':
                case 'readonly':
                    share.readonly = value.toLowerCase() === 'yes' || value.toLowerCase() === 'true';
                    break;
                case 'guest ok':
                case 'public':
                    share.guest = value.toLowerCase() === 'yes' || value.toLowerCase() === 'true';
                    break;
                case 'browseable':
                case 'browsable':
                    share.browseable = value.toLowerCase() !== 'no' && value.toLowerCase() !== 'false';
                    break;
                case 'valid users':
                    share.validUsers = value;
                    break;
            }
        },

        parseShareConfig: function(configContent, targetShare = null) {
            const shares = [];
            const lines = configContent.split('\n');
            let currentShare = null;
            
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
                
                if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                    if (currentShare && currentShare.name !== 'global') {
                        // Set access property for sorting
                        currentShare.access = currentShare.readonly ? 'readonly' : 'readwrite';
                        if (targetShare && currentShare.name === targetShare) {
                            return currentShare;
                        }
                        shares.push(currentShare);
                    }
                    
                    const sectionName = trimmed.slice(1, -1);
                    if (sectionName !== 'global') {
                        currentShare = this.createDefaultShare(sectionName);
                    } else {
                        currentShare = null;
                    }
                } else if (currentShare && trimmed.includes('=')) {
                    this.parseShareProperty(currentShare, trimmed);
                }
            }
            
            if (currentShare && currentShare.name !== 'global') {
                // Set access property for sorting
                currentShare.access = currentShare.readonly ? 'readonly' : 'readwrite';
                if (targetShare && currentShare.name === targetShare) {
                    return currentShare;
                }
                shares.push(currentShare);
            }
            
            return targetShare ? null : shares;
        },

        generateShareConfig: function(shareData) {
            let config = `\n[${shareData.name}]\n`;
            config += `    path = ${shareData.path}\n`;
            if (shareData.comment) config += `    comment = ${shareData.comment}\n`;
            config += `    read only = ${shareData.readonly ? 'yes' : 'no'}\n`;
            config += `    guest ok = ${shareData.guest ? 'yes' : 'no'}\n`;
            config += `    browseable = ${shareData.browseable ? 'yes' : 'no'}\n`;
            if (shareData.users) config += `    valid users = ${shareData.users}\n`;
            return config;
        }
    };

    // Initialize table configuration
    function initializeTable() {
        const table = getTable();
        const utils = getUtils();
        
        table.registerTable('shares-table', {
            columns: [
                { 
                    key: 'name', 
                    label: 'Name',
                    renderer: function(value, item) {
                        let html = '<strong>' + utils.escapeHtml(value) + '</strong>';
                        return html;
                    }
                },
                { 
                    key: 'path', 
                    label: 'Path',
                    renderer: function(value) {
                        return '<code class="path-cell">' + utils.escapeHtml(value) + '</code>';
                    }
                },
                { key: 'comment', label: 'Comment' },
                { 
                    key: 'access', 
                    label: 'Access',
                    renderer: function(value, item) {
                        let html = '<div class="access-badges">';
                        html += '<span class="access-badge ' + (item.readonly ? 'read-only' : 'read-write') + '">';
                        html += item.readonly ? 'Read Only' : 'Read/Write';
                        html += '</span>';
                        if (item.guest) {
                            html += '<span class="access-badge guest">Guest</span>';
                        }
                        html += '</div>';
                        return html;
                    }
                },
                {
                    key: 'actions',
                    label: 'Actions',
                    className: 'actions-column',
                    renderer: function(value, item) {
                        return renderShareActions(item);
                    }
                }
            ],
            searchColumns: [0, 1, 2],
            emptyMessage: 'No shares configured. Click "Add share" to create your first share.',
            defaultSort: { column: 0, order: 'asc' }
        });
    }

    // Initialize modal configurations
    function initializeModals() {
        const modals = getModals();
        const utils = getUtils();
        
        modals.registerModal('share-modal', {
            title: function(data) {
                return data && data.mode === 'edit' ? 'Edit share' : 'Add new share';
            },
            size: 'medium',
            fields: [
                {
                    name: 'share-name',
                    label: 'Share name',
                    type: 'text',
                    placeholder: 'e.g., documents, media',
                    required: true,
                    helperText: 'Name for the share (e.g., "documents", "media")'
                },
                {
                    name: 'share-path',
                    label: 'Directory path',
                    type: 'text',
                    placeholder: '/home/shared/documents',
                    required: true,
                    helperText: 'Full path to the directory to share (e.g., /home/shared/documents)'
                },
                {
                    name: 'share-comment',
                    label: 'Comment',
                    type: 'text',
                    placeholder: 'Optional description',
                    helperText: 'Optional description for the share'
                },
                {
                    name: 'share-readonly',
                    label: 'Read only',
                    type: 'checkbox',
                    defaultValue: false
                },
                {
                    name: 'share-guest',
                    label: 'Allow guest access',
                    type: 'checkbox',
                    defaultValue: false
                },
                {
                    name: 'share-browseable',
                    label: 'Browseable',
                    type: 'checkbox',
                    defaultValue: true
                },
                {
                    name: 'share-users',
                    label: 'Valid users and groups',
                    type: 'text',
                    placeholder: 'e.g. john,mary,@sales,@admin',
                    helperText: 'Enter users and groups separated by commas. Use @groupname for groups.<br>' +
                               '<strong>Examples:</strong> <code>john,mary</code> or <code>@sales,@admin</code> or <code>john,@developers,mary</code><br>' +
                               '<em>Leave empty to allow all users</em>'
                }
            ],
            validators: {
                'share-name': function(value) {
                    return utils.validators.shareName(value);
                },
                'share-path': function(value) {
                    return utils.validators.path(value);
                },
                'share-users': function(value) {
                    return utils.validators.usersAndGroups(value);
                }
            },
            onShow: function(data) {
                const nameInput = utils.getElement('share-name');
                
                if (data && data.mode === 'edit') {
                    nameInput.disabled = true;
                    populateShareForm(data.share);
                } else {
                    nameInput.disabled = false;
                }
            },
            onSubmit: function(formData) {
                const mode = utils.getElement('share-name').disabled ? 'edit' : 'create';
                return mode === 'create' ? handleCreateShare(formData) : handleUpdateShare(formData);
            },
            submitLabel: function(data) {
                return data && data.mode === 'edit' ? 'Update' : 'Create share';
            }
        });
    }

    // Populate form for editing
    function populateShareForm(share) {
        const utils = getUtils();
        
        // Store original name for update
        let originalNameField = document.getElementById('edit-original-name');
        if (!originalNameField) {
            originalNameField = document.createElement('input');
            originalNameField.type = 'hidden';
            originalNameField.id = 'edit-original-name';
            const form = document.querySelector('#share-modal form');
            if (form) form.appendChild(originalNameField);
        }
        originalNameField.value = share.name;
        
        // Populate fields
        utils.getElement('share-name').value = share.name;
        utils.getElement('share-path').value = share.path;
        utils.getElement('share-comment').value = share.comment || '';
        utils.getElement('share-readonly').checked = share.readonly;
        utils.getElement('share-guest').checked = share.guest;
        utils.getElement('share-browseable').checked = share.browseable;
        utils.getElement('share-users').value = share.validUsers || '';
    }

    // Render share actions
    function renderShareActions(share) {
        const actions = [
            { label: 'Edit', className: 'primary', action: 'editShare', data: { name: share.name } },
            { label: 'Delete', className: 'danger', action: 'deleteShare', data: { name: share.name } }
        ];
        
        const buttonsHtml = actions.map(action => {
            const dataAttrs = Object.entries(action.data)
                .map(([key, value]) => `data-${key}="${getUtils().escapeHtml(value)}"`)
                .join(' ');
            return `<button class="table-action-btn ${action.className}" data-action="${action.action}" ${dataAttrs}>${action.label}</button>`;
        }).join('');
        
        return '<div class="table-action-buttons">' + buttonsHtml + '</div>';
    }

    // Share loading and rendering
    async function loadShares() {
        const app = getApp();
        const utils = getUtils();
        const table = getTable();
        
        table.showLoading('shares-table');
        
        const configExists = await utils.executeCommand(['test', '-f', app.configPath], { silent: true });
        if (!configExists.success) {
            app.shares = [];
            renderShares();
            return;
        }
        
        const configResult = await utils.executeCommand(['cat', app.configPath]);
        if (configResult.success) {
            const shares = shareConfigManager.parseShareConfig(configResult.data);
            app.shares = shares;
        } else {
            app.shares = [];
        }
        
        renderShares();
    }

    function renderShares() {
        getTable().renderTable('shares-table', getApp().shares);
    }

    // Share management functions
    async function validateUsersAndGroups(usersString) {
        if (!usersString.trim()) {
            return { valid: true };
        }
        
        const utils = getUtils();
        const items = usersString.split(',').map(item => item.trim()).filter(item => item);
        const invalidUsers = [];
        const invalidGroups = [];
        
        for (const item of items) {
            if (item.startsWith('@')) {
                const groupName = item.substring(1);
                const result = await utils.executeCommand(['getent', 'group', groupName], { silent: true });
                if (!result.success || !result.data.trim()) {
                    invalidGroups.push(groupName);
                }
            } else {
                const result = await utils.executeCommand(['getent', 'passwd', item], { silent: true });
                if (!result.success || !result.data.trim()) {
                    invalidUsers.push(item);
                }
            }
        }
        
        if (invalidUsers.length > 0 || invalidGroups.length > 0) {
            let message = 'Invalid entries found:\n';
            if (invalidUsers.length > 0) {
                message += `• Users not found: ${invalidUsers.join(', ')}\n`;
            }
            if (invalidGroups.length > 0) {
                message += `• Groups not found: ${invalidGroups.join(', ')}`;
            }
            return { valid: false, message };
        }
        
        return { valid: true };
    }

    async function handleCreateShare(formData) {
        const utils = getUtils();
        const app = getApp();
        
        // Additional validation for users/groups
        if (formData['share-users']) {
            const validationResult = await validateUsersAndGroups(formData['share-users']);
            if (!validationResult.valid) {
                utils.showNotification(validationResult.message, 'error');
                return false;
            }
        }
        
        const shareData = {
            name: formData['share-name'],
            path: formData['share-path'],
            comment: formData['share-comment'],
            readonly: formData['share-readonly'],
            guest: formData['share-guest'],
            browseable: formData['share-browseable'],
            users: formData['share-users']
        };
        
        return utils.errorHandler.handleAsync(
            createShareConfig(shareData),
            'share-create',
            async function() {
                await window.SambaManager.config.reloadSambaConfig();
                utils.showNotification(`Share "${shareData.name}" created successfully`, 'success');
                await loadShares();
                return true;
            }
        );
    }

    async function createShareConfig(shareData) {
        const utils = getUtils();
        const app = getApp();
        
        // Check if share already exists
        const configResult = await utils.executeCommand(['cat', app.configPath]);
        if (configResult.success && configResult.data.includes(`[${shareData.name}]`)) {
            throw new Error(`Share "${shareData.name}" already exists`);
        }
        
        const shareConfig = shareConfigManager.generateShareConfig(shareData);
        
        const result = await utils.executeCommand(
            ['bash', '-c', `echo "${shareConfig.replace(/"/g, '\\"')}" >> ${app.configPath}`], 
            { superuser: 'require' }
        );
        
        if (!result.success) {
            throw new Error('Failed to create share: ' + result.error);
        }
        
        return result;
    }

    async function handleUpdateShare(formData) {
        const utils = getUtils();
        const originalName = document.getElementById('edit-original-name')?.value || formData['share-name'];
        
        // Additional validation for users/groups
        if (formData['share-users']) {
            const validationResult = await validateUsersAndGroups(formData['share-users']);
            if (!validationResult.valid) {
                utils.showNotification(validationResult.message, 'error');
                return false;
            }
        }
        
        const shareData = {
            name: formData['share-name'],
            path: formData['share-path'],
            comment: formData['share-comment'],
            readonly: formData['share-readonly'],
            guest: formData['share-guest'],
            browseable: formData['share-browseable'],
            users: formData['share-users']
        };
        
        return utils.errorHandler.handleAsync(
            updateShareConfig(originalName, shareData),
            'share-update',
            async function() {
                await window.SambaManager.config.reloadSambaConfig();
                utils.showNotification(`Share "${shareData.name}" updated successfully`, 'success');
                await loadShares();
                return true;
            }
        );
    }

    async function updateShareConfig(originalName, shareData) {
        const utils = getUtils();
        const app = getApp();
        
        // Create backup
        const backupFile = `/etc/samba/smb.conf.backup.${Date.now()}`;
        await utils.executeCommand(['cp', app.configPath, backupFile], { superuser: 'require' });
        
        // Delete old share section
        const sedCommand = `/^\\[${originalName}\\]/,/^\\[.*\\]/{/^\\[${originalName}\\]/d; /^\\[.*\\]/!d;}`;
        await utils.executeCommand(['sed', '-i', sedCommand, app.configPath], { superuser: 'require' });
        
        // Add updated share configuration
        const shareConfig = shareConfigManager.generateShareConfig(shareData);
        const result = await utils.executeCommand(
            ['bash', '-c', `echo "${shareConfig.replace(/"/g, '\\"')}" >> ${app.configPath}`], 
            { superuser: 'require' }
        );
        
        if (!result.success) {
            throw new Error('Failed to update share: ' + result.error);
        }
        
        return result;
    }

    // Share actions
    function showShareModal(mode, shareData) {
        const modals = getModals();
        modals.showModal('share-modal', { mode: mode, share: shareData });
    }

    function hideShareModal() {
        const modals = getModals();
        modals.hideModal('share-modal');
    }

    async function editShare(shareName) {
        const app = getApp();
        const utils = getUtils();
        
        const configResult = await utils.executeCommand(['cat', app.configPath]);
        if (!configResult.success) {
            utils.showNotification('Failed to read configuration', 'error');
            return;
        }
        
        const shareData = shareConfigManager.parseShareConfig(configResult.data, shareName);
        if (!shareData) {
            utils.showNotification(`Share "${shareName}" not found in configuration`, 'error');
            return;
        }
        
        showShareModal('edit', shareData);
    }

    async function deleteShare(shareName) {
        const utils = getUtils();
        const modals = getModals();
        
        const confirmed = await modals.confirm(
            `Are you sure you want to delete the share "${shareName}"?`,
            { title: 'Delete Share', confirmLabel: 'Delete', cancelLabel: 'Cancel' }
        );
        
        if (!confirmed) return;
        
        return utils.errorHandler.handleAsync(
            deleteShareConfig(shareName),
            'share-delete',
            async function() {
                await window.SambaManager.config.reloadSambaConfig();
                utils.showNotification(`Share "${shareName}" deleted successfully`, 'success');
                await loadShares();
            }
        );
    }

    async function deleteShareConfig(shareName) {
        const utils = getUtils();
        const app = getApp();
        
        // Check if share exists
        const configResult = await utils.executeCommand(['cat', app.configPath]);
        if (!configResult.success || !configResult.data.includes(`[${shareName}]`)) {
            throw new Error(`Share "${shareName}" not found in configuration`);
        }
        
        // Create backup
        const backupFile = `/etc/samba/smb.conf.backup.${Date.now()}`;
        await utils.executeCommand(['cp', app.configPath, backupFile], { superuser: 'require' });
        
        // Delete share section
        const sedCommand = `/^\\[${shareName}\\]/,/^\\[.*\\]/{/^\\[${shareName}\\]/d; /^\\[.*\\]/!d;}`;
        const result = await utils.executeCommand(['sed', '-i', sedCommand, app.configPath], { superuser: 'require' });
        
        if (!result.success) {
            throw new Error('Failed to delete share: ' + result.error);
        }
        
        // Verify deletion
        const updatedResult = await utils.executeCommand(['cat', app.configPath]);
        if (updatedResult.success && updatedResult.data.includes(`[${shareName}]`)) {
            throw new Error(`Share [${shareName}] still exists after deletion attempt`);
        }
        
        return result;
    }

    // Initialize on module load
    initializeTable();
    initializeModals();

    // Export public interface
    window.SambaManager.shares = {
        loadShares: loadShares,
        renderShares: renderShares,
        showShareModal: showShareModal,
        hideShareModal: hideShareModal,
        editShare: editShare,
        deleteShare: deleteShare
    };

})();
