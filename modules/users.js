// Samba Manager - Users Management Module
(function() {
    'use strict';

    // Dependencies - get them when needed
    function getApp() { return window.SambaManager.app; }
    function getUtils() { return window.SambaManager.utils; }
    function getTable() { return window.SambaManager.table; }
    function getModals() { return window.SambaManager.modals; }

    // Initialize table configuration
    function initializeTable() {
        const table = getTable();
        const utils = getUtils();
        
        table.registerTable('users-table', {
            columns: [
                { 
                    key: 'username', 
                    label: 'Username',
                    renderer: function(value) {
                        return '<strong>' + utils.escapeHtml(value) + '</strong>';
                    }
                },
                { key: 'fullName', label: 'Full Name' },
                { 
                    key: 'sambaEnabled', 
                    label: 'Samba Status',
                    renderer: function(value) {
                        const statusClass = value ? 'enabled' : 'disabled';
                        const statusText = value ? 'Enabled' : 'Disabled';
                        return '<div class="user-status">' +
                               '<span class="user-status-indicator ' + statusClass + '"></span>' +
                               '<span>' + statusText + '</span>' +
                               '</div>';
                    },
                    sortTransform: function(value) {
                        return value ? 1 : 0;
                    }
                },
                {
                    key: 'actions',
                    label: 'Actions',
                    className: 'actions-column',
                    renderer: function(value, item) {
                        return renderUserActions(item);
                    }
                }
            ],
            searchColumns: [0, 1],
            emptyMessage: 'No regular user accounts found on this system.',
            defaultSort: { column: 0, order: 'asc' }
        });
    }

    // Initialize modal configurations
    function initializeModals() {
        const modals = getModals();
        const utils = getUtils();
        
        modals.registerModal('samba-password-modal', {
            title: function(data) {
                return 'Set Samba password for ' + (data ? data.username : 'user');
            },
            size: 'small',
            fields: [
                {
                    name: 'samba-password',
                    label: 'Password',
                    type: 'password',
                    required: true,
                    autocomplete: 'new-password'
                },
                {
                    name: 'samba-password-confirm',
                    label: 'Confirm password',
                    type: 'password',
                    required: true,
                    autocomplete: 'new-password'
                }
            ],
            validators: {
                'samba-password': function(value) {
                    if (!value) return 'Password is required';
                    if (value.length < 6) return 'Password must be at least 6 characters';
                    return null;
                },
                'samba-password-confirm': function(value) {
                    const password = utils.getElement('samba-password').value;
                    if (!value) return 'Confirm password is required';
                    if (value !== password) return 'Passwords do not match';
                    return null;
                }
            },
            onShow: function(data) {
                // Store username in a data attribute
                const modal = utils.getElement('samba-password-modal');
                if (modal && data) {
                    modal.dataset.username = data.username;
                }
            },
            onSubmit: function(formData) {
                const modal = utils.getElement('samba-password-modal');
                const username = modal.dataset.username;
                return setSambaPassword(username, formData['samba-password']);
            },
            submitLabel: 'Set password'
        });
    }

    // Render user actions
    function renderUserActions(user) {
        const actions = [];
        
        if (user.sambaEnabled) {
            actions.push(
                { label: 'Change Password', className: 'primary', action: 'changePassword', data: { username: user.username } },
                { label: 'Disable Samba', className: 'danger', action: 'disableSamba', data: { username: user.username } }
            );
        } else {
            actions.push(
                { label: 'Enable Samba', className: 'primary', action: 'enableSamba', data: { username: user.username } }
            );
        }
        
        const buttonsHtml = actions.map(action => {
            const dataAttrs = Object.entries(action.data)
                .map(([key, value]) => `data-${key}="${getUtils().escapeHtml(value)}"`)
                .join(' ');
            return `<button class="table-action-btn ${action.className}" data-action="${action.action}" ${dataAttrs}>${action.label}</button>`;
        }).join('');
        
        return '<div class="table-action-buttons">' + buttonsHtml + '</div>';
    }

    // User loading and rendering
    async function loadUsers() {
        const app = getApp();
        const utils = getUtils();
        const table = getTable();
        
        table.showLoading('users-table');
        
        const result = await utils.executeCommand(['getent', 'passwd']);
        if (result.success) {
            const users = parseSystemUsers(result.data);
            app.users = users;
            await loadSambaUsers();
        } else {
            app.users = [];
        }
        
        renderUsers();
    }

    function parseSystemUsers(output) {
        const users = [];
        const lines = output.split('\n');

        for (const line of lines) {
            const parts = line.split(':');
            if (parts.length >= 7) {
                const username = parts[0];
                const uid = parseInt(parts[2]);
                const fullName = parts[4].split(',')[0];
                const shell = parts[6];

                const isSystemUser = username.includes('-') || 
                                   username.includes('_') || 
                                   username === 'nobody' ||
                                   username.startsWith('cockpit') ||
                                   username.startsWith('systemd') ||
                                   username.startsWith('ssh') ||
                                   shell === '/sbin/nologin' ||
                                   shell === '/bin/false' ||
                                   shell === '/usr/sbin/nologin';

                if (uid >= 1000 && uid < 65534 && !isSystemUser) {
                    users.push({
                        username: username,
                        fullName: fullName || username,
                        sambaEnabled: false
                    });
                }
            }
        }

        return users;
    }

    async function loadSambaUsers() {
        const utils = getUtils();
        const app = getApp();
        let sambaUsers = [];
        
        const cmd = utils.sambaCommands.listUsers();
        const pdbeditResult = await utils.executeCommand(cmd.command, cmd.options);
        
        if (pdbeditResult.success) {
            sambaUsers = pdbeditResult.data.split('\n')
                .filter(line => line.trim())
                .map(line => line.split(':')[0]);
        } else {
            // Try smbpasswd file locations
            const possiblePaths = [
                '/var/lib/samba/private/smbpasswd',
                '/etc/samba/smbpasswd',
                '/usr/local/samba/private/smbpasswd'
            ];
            
            for (const path of possiblePaths) {
                const fileResult = await utils.executeCommand(['cat', path], { superuser: 'try', silent: true });
                if (fileResult.success) {
                    sambaUsers = fileResult.data.split('\n')
                        .filter(line => line.trim() && !line.startsWith('#'))
                        .map(line => line.split(':')[0]);
                    break;
                }
            }
        }

        app.users.forEach(user => {
            user.sambaEnabled = sambaUsers.includes(user.username);
        });
    }

    function renderUsers() {
        getTable().renderTable('users-table', getApp().users);
    }

    // User management functions
    function showPasswordModal(username) {
        const modals = getModals();
        modals.showModal('samba-password-modal', { username: username });
    }

    function enableSambaUser(username) {
        showPasswordModal(username);
    }

    async function setSambaPassword(username, password) {
        const utils = getUtils();
        
        const cmd = utils.sambaCommands.addUser(username, password);
        
        return utils.errorHandler.handleAsync(
            utils.executeCommand(cmd.command, cmd.options),
            'samba-password-set',
            async function() {
                utils.showNotification(`Samba password set for user "${username}"`, 'success');
                await loadUsers();
                return true;
            },
            async function() {
                // Try alternative method
                const altCommand = `printf "${password}\\n${password}\\n" | smbpasswd -a -s ${username}`;
                const altResult = await utils.executeCommand(['bash', '-c', altCommand], { superuser: 'require' });
                
                if (altResult.success) {
                    utils.showNotification(`Samba password set for user "${username}"`, 'success');
                    await loadUsers();
                    return true;
                }
                throw new Error('Failed to set Samba password');
            }
        );
    }

    async function disableSambaUser(username) {
        const utils = getUtils();
        const modals = getModals();
        
        const confirmed = await modals.confirm(
            `Disable Samba access for user "${username}"?`,
            { title: 'Disable Samba User', confirmLabel: 'Disable', cancelLabel: 'Cancel' }
        );
        
        if (!confirmed) return;
        
        const cmd = utils.sambaCommands.removeUser(username);
        
        return utils.errorHandler.handleAsync(
            utils.executeCommand(cmd.command, cmd.options),
            'samba-user-disable',
            async function() {
                utils.showNotification(`Samba access disabled for user "${username}"`, 'success');
                await loadUsers();
            }
        );
    }

    // Initialize on module load
    initializeTable();
    initializeModals();

    // Export public interface
    window.SambaManager.users = {
        loadUsers: loadUsers,
        renderUsers: renderUsers,
        enableSambaUser: enableSambaUser,
        disableSambaUser: disableSambaUser,
        showPasswordModal: showPasswordModal
    };

})();