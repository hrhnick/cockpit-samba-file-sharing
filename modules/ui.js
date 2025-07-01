// Samba Manager - UI Event Listeners and Service Management Module
(function() {
    'use strict';

    // Lazy dependency getters
    function app() { return window.SambaManager.app; }
    function utils() { return window.SambaManager.utils; }
    function config() { return window.SambaManager.config; }
    function shares() { return window.SambaManager.shares; }
    function users() { return window.SambaManager.users; }
    function modals() { return window.SambaManager.modals; }

    // Service management using error handler
    async function detectSamba() {
        const detectionMethods = [
            { method: () => utils().executeCommand(['which', 'smbd'], { silent: true }), type: 'binary' },
            { method: () => utils().executeCommand(['systemctl', 'status', 'smb'], { silent: true }), type: 'service', name: 'smb' },
            { method: () => utils().executeCommand(['systemctl', 'status', 'smbd'], { silent: true }), type: 'service', name: 'smbd' },
            { method: () => utils().executeCommand(['rpm', '-q', 'samba'], { silent: true }), type: 'package' },
            { method: () => utils().executeCommand(['dpkg', '-l', 'samba'], { silent: true }), type: 'package' }
        ];
        
        for (const { method, type, name } of detectionMethods) {
            const result = await method();
            if (result.success) {
                app().sambaInstalled = true;
                app().sambaService = name || 'smbd';
                return true;
            }
        }
        
        // Check for running processes
        const processCheck = await utils().executeCommand(['pgrep', '-f', 'smbd'], { silent: true });
        if (processCheck.success && processCheck.data.trim()) {
            app().sambaInstalled = true;
            app().sambaService = 'smbd (process)';
            return true;
        }
        
        app().sambaInstalled = false;
        return false;
    }

    async function loadServiceStatus() {
        let serviceStatus = 'unknown';
        let isRunning = false;
        let detectedService = null;
        
        // First, try to detect which service name is actually in use
        const servicesToCheck = ['smb', 'smbd', 'samba'];
        for (const service of servicesToCheck) {
            const unitCheck = await utils().executeCommand(['systemctl', 'list-unit-files', service + '.service'], { silent: true });
            if (unitCheck.success && unitCheck.data.includes(service + '.service')) {
                detectedService = service;
                const statusCheck = await utils().executeCommand(['systemctl', 'is-active', service], { silent: true });
                if (statusCheck.success) {
                    const status = statusCheck.data.trim();
                    if (status === 'active') {
                        serviceStatus = 'active';
                        isRunning = true;
                        app().sambaService = service;
                        break;
                    } else if (status === 'inactive' || status === 'failed') {
                        serviceStatus = status;
                        app().sambaService = service;
                    }
                } else {
                    // If is-active fails, check the detailed status
                    const detailedStatus = await utils().executeCommand(['systemctl', 'show', service, '-p', 'ActiveState'], { silent: true });
                    if (detailedStatus.success) {
                        const state = detailedStatus.data.trim().replace('ActiveState=', '');
                        if (state === 'failed') {
                            serviceStatus = 'failed';
                            app().sambaService = service;
                        }
                    }
                }
            }
        }
        
        // If still not found, check for running smbd processes
        if (serviceStatus === 'unknown') {
            const processCheck = await utils().executeCommand(['pgrep', '-x', 'smbd'], { silent: true });
            if (processCheck.success && processCheck.data.trim()) {
                isRunning = true;
                serviceStatus = 'active';
                if (!app().sambaService) {
                    app().sambaService = 'smbd (process)';
                }
            } else {
                // Also check with -f flag for full command line
                const processCheckFull = await utils().executeCommand(['pgrep', '-f', 'smbd'], { silent: true });
                if (processCheckFull.success && processCheckFull.data.trim()) {
                    isRunning = true;
                    serviceStatus = 'active';
                    if (!app().sambaService) {
                        app().sambaService = 'smbd (process)';
                    }
                }
            }
        }
        
        // If still unknown, check if Samba is listening on port 445
        if (serviceStatus === 'unknown' || !isRunning) {
            const portCheck = await utils().executeCommand(['ss', '-tlnp'], { silent: true });
            if (!portCheck.success) {
                // Fallback to netstat if ss is not available
                const netstatCheck = await utils().executeCommand(['netstat', '-tlnp'], { superuser: 'try', silent: true });
                if (netstatCheck.success && netstatCheck.data.includes(':445')) {
                    serviceStatus = 'active';
                    isRunning = true;
                    if (!app().sambaService) {
                        app().sambaService = 'smbd (port 445)';
                    }
                }
            } else if (portCheck.data.includes(':445')) {
                serviceStatus = 'active';
                isRunning = true;
                if (!app().sambaService) {
                    app().sambaService = 'smbd (port 445)';
                }
}
        }
        
        // Final fallback - if we detected a service but status is still unknown
        if (serviceStatus === 'unknown' && detectedService) {
            serviceStatus = 'inactive';
            app().sambaService = detectedService;
        } else if (serviceStatus === 'unknown') {
            serviceStatus = 'inactive';
            if (!app().sambaService) {
                app().sambaService = 'smb';  // Default fallback
            }
        }
        
        updateServiceStatus(serviceStatus, app().sambaService);
    }

    // Update service status using DOM utilities
    function updateServiceStatus(status, serviceName = 'smb/smbd') {
        const dom = utils().dom;
        const statusBadge = utils().getElement('service-status-badge');
        const startBtn = utils().getElement('start-service-btn');
        const restartBtn = utils().getElement('restart-service-btn');
        const stopBtn = utils().getElement('stop-service-btn');
        const serviceNameElement = document.querySelector('.service-name');
        const divider = document.querySelector('.service-actions .pf-v6-c-divider');

        if (statusBadge) {
            statusBadge.className = `status-badge status-${status}`;
            if (serviceNameElement) {
                serviceNameElement.textContent = `Samba (${serviceName})`;
            }
        }

        switch (status) {
            case 'active':
                statusBadge.textContent = 'Running';
                // Show Restart and Stop buttons, hide Start
                dom.toggle(startBtn, false);
                dom.toggle(restartBtn, true);
                dom.toggle(stopBtn, true);
                restartBtn.disabled = false;
                stopBtn.disabled = false;
                // Show divider when multiple action buttons are visible
                if (divider) dom.toggle(divider, true);
                break;
                
            case 'inactive':
            case 'failed':
                statusBadge.textContent = status === 'failed' ? 'Failed' : 'Stopped';
                // Show Start button only, hide Stop
                dom.toggle(startBtn, true);
                dom.toggle(restartBtn, false);
                dom.toggle(stopBtn, false);
                startBtn.disabled = false;
                // Show divider when start button is visible
                if (divider) dom.toggle(divider, true);
                break;
                
            default:
                statusBadge.textContent = 'Unknown';
                // Show Start button, hide Stop
                dom.toggle(startBtn, true);
                dom.toggle(restartBtn, false);
                dom.toggle(stopBtn, false);
                startBtn.disabled = false;
                if (divider) dom.toggle(divider, true);
        }
    }

    // Service control functions
    async function startSambaService() {
        const startBtn = utils().getElement('start-service-btn');
        startBtn.disabled = true;
        
        const servicesToTry = app().sambaService && !app().sambaService.includes('(process)') && !app().sambaService.includes('(port')
            ? [app().sambaService] 
            : ['smb', 'smbd'];
        
        return utils().errorHandler.handleAsync(
            tryServiceCommand(servicesToTry, 'start'),
            'service-start',
            async function() {
                await utils().batchOperations.delay(2000);
                await loadServiceStatus();
                utils().showNotification('Samba service started successfully', 'success');
            },
            function(error) {
                startBtn.disabled = false;
                loadServiceStatus();
            }
        );
    }

    async function stopSambaService() {
        const stopBtn = utils().getElement('stop-service-btn');
        const restartBtn = utils().getElement('restart-service-btn');
        stopBtn.disabled = true;
        restartBtn.disabled = true;
        
        const servicesToTry = app().sambaService && !app().sambaService.includes('(process)') && !app().sambaService.includes('(port')
            ? [app().sambaService]
            : ['smb', 'smbd'];
        
        return utils().errorHandler.handleAsync(
            tryServiceCommand(servicesToTry, 'stop'),
            'service-stop',
            async function() {
                await utils().batchOperations.delay(1000);
                await loadServiceStatus();
                utils().showNotification('Samba service stopped successfully', 'success');
            },
            function(error) {
                stopBtn.disabled = false;
                restartBtn.disabled = false;
                loadServiceStatus();
            }
        );
    }

    async function restartSambaService() {
        const restartBtn = utils().getElement('restart-service-btn');
        const stopBtn = utils().getElement('stop-service-btn');
        restartBtn.disabled = true;
        stopBtn.disabled = true;
        
        const servicesToTry = app().sambaService && !app().sambaService.includes('(process)') && !app().sambaService.includes('(port')
            ? [app().sambaService]
            : ['smb', 'smbd'];
        
        return utils().errorHandler.handleAsync(
            tryServiceCommand(servicesToTry, 'restart'),
            'service-restart',
            async function() {
                await utils().batchOperations.delay(2000);
                await loadServiceStatus();
                utils().showNotification('Samba service restarted successfully', 'success');
            },
            function(error) {
                restartBtn.disabled = false;
                stopBtn.disabled = false;
                loadServiceStatus();
            }
        );
    }

    async function tryServiceCommand(services, action) {
        let lastError = '';
        for (const service of services) {
            const result = await utils().executeCommand(['systemctl', action, service], { superuser: 'require', silent: true });
            if (result.success) {
                return result;
            }
            lastError = result.error;
        }
        throw new Error(lastError);
    }

    // Reload Samba configuration without disrupting active connections
    async function reloadSambaService() {
        // Test configuration
        await utils().executeCommand(['testparm', '-s'], { silent: true });
        
        // Try to reload using smbcontrol first (no service disruption)
        const smbcontrolResult = await utils().executeCommand(['smbcontrol', 'smbd', 'reload-config'], { superuser: 'require', silent: true });
        if (smbcontrolResult.success) {
            return;
        }
        
        // Try alternative smbcontrol command
        const altSmbcontrolResult = await utils().executeCommand(['smbcontrol', 'all', 'reload-config'], { superuser: 'require', silent: true });
        if (altSmbcontrolResult.success) {
            return;
        }
        
        // Fallback to systemctl reload if smbcontrol is not available
        const servicesToTry = app().sambaService && !app().sambaService.includes('(process)') && !app().sambaService.includes('(port')
            ? [app().sambaService]
            : ['smb', 'smbd'];
            
        for (const service of servicesToTry) {
            const reloadResult = await utils().executeCommand(['systemctl', 'reload', service], { superuser: 'require', silent: true });
            if (reloadResult.success) {
                return;
            }
        }
    }

    // Tab switching with lazy loading
    function switchTab(tab) {
        const dom = utils().dom;
        const loadModule = window.SambaManager.loadModule;
        
        // Update UI immediately
        document.querySelectorAll('.pf-v6-c-tabs__tab').forEach(function(link) {
            dom.removeClass(link, 'active');
            link.setAttribute('aria-selected', 'false');
        });
        
        const selectedTab = document.querySelector('[data-tab="' + tab + '"]');
        if (selectedTab) {
            dom.addClass(selectedTab, 'active');
            selectedTab.setAttribute('aria-selected', 'true');
        }

        document.querySelectorAll('.tab-content').forEach(function(panel) {
            dom.removeClass(panel, 'active');
        });
        dom.addClass(tab + '-tab', 'active');

        app().currentTab = tab;
        
        // Load module if not already loaded
        if (!app().loadedModules[tab]) {
            // Show loading message
            const tbody = document.querySelector('#' + tab + '-tbody');
            if (tbody) {
                tbody.innerHTML = '<tr class="loading-row"><td colspan="' + 
                    (tbody.parentElement.querySelector('thead tr').children.length) + 
                    '" class="loading-cell">Loading ' + tab + ' module...</td></tr>';
            }
            
            // Load the module
            loadModule(tab).then(function() {
                // Module loaded, now load the data
                loadTabData(tab);
            }).catch(function(error) {
                console.error('Failed to load module:', tab, error);
                if (tbody) {
                    tbody.innerHTML = '<tr class="error-row"><td colspan="' + 
                        (tbody.parentElement.querySelector('thead tr').children.length) + 
                        '" class="error-message">Failed to load ' + tab + ' module</td></tr>';
                }
            });
        } else {
            // Module already loaded, just load the data
            loadTabData(tab);
        }
    }

    // Load tab data after module is loaded
    function loadTabData(tab) {
        switch(tab) {
            case 'shares':
                if (shares()) shares().loadShares();
                break;
            case 'users':
                if (users()) users().loadUsers();
                break;
        }
    }

    // Setup event listeners - simplified with data attributes
    function setupEventListeners() {
        const dom = utils().dom;
        
        // Service controls
        const startBtn = utils().getElement('start-service-btn');
        const restartBtn = utils().getElement('restart-service-btn');
        const stopBtn = utils().getElement('stop-service-btn');
        const settingsBtn = utils().getElement('settings-btn');
        
        if (startBtn) startBtn.addEventListener('click', startSambaService);
        if (restartBtn) restartBtn.addEventListener('click', restartSambaService);
        if (stopBtn) stopBtn.addEventListener('click', stopSambaService);
        if (settingsBtn) settingsBtn.addEventListener('click', function() {
            if (config()) config().showSettingsModal();
        });
        
        // Tab-specific actions - will be initialized when module loads
        const addShareBtn = utils().getElement('add-share-btn');
        if (addShareBtn) {
            addShareBtn.addEventListener('click', function() {
                ensureModuleAndCall('shares', function() {
                    shares().showShareModal('add');
                });
            });
        }
        
        const manageUsersBtn = utils().getElement('manage-users-btn');
        if (manageUsersBtn) {
            manageUsersBtn.addEventListener('click', function() {
                navigateToUsers();
            });
        }
        
        // Tab navigation
        document.querySelectorAll('.pf-v6-c-tabs__tab').forEach(function(tab) {
            tab.addEventListener('click', function(e) {
                const tabName = e.target.dataset.tab;
                if (tabName) {
                    switchTab(tabName);
                }
            });
        });
    }

    // Helper function to ensure module is loaded before calling
    function ensureModuleAndCall(moduleName, callback) {
        if (!app().loadedModules[moduleName]) {
            utils().showNotification('Loading ' + moduleName + ' module...', 'info');
            window.SambaManager.loadModule(moduleName).then(function() {
                callback();
            }).catch(function(error) {
                utils().showNotification('Failed to load ' + moduleName + ' module', 'error');
            });
        } else {
            callback();
        }
    }

    function navigateToUsers() {
        if (typeof cockpit !== 'undefined' && cockpit.jump) {
            cockpit.jump('/users');
        } else if (typeof cockpit !== 'undefined' && cockpit.location) {
            cockpit.location = '/users';
        } else {
            window.location.href = window.location.origin + '/users';
        }
    }

    // Export public interface
    window.SambaManager.ui = {
        // UI functions
        setupEventListeners: setupEventListeners,
        switchTab: switchTab,
        loadTabData: loadTabData,
        // Service management functions
        detectSamba: detectSamba,
        loadServiceStatus: loadServiceStatus,
        updateServiceStatus: updateServiceStatus,
        startSambaService: startSambaService,
        stopSambaService: stopSambaService,
        restartSambaService: restartSambaService,
        reloadSambaService: reloadSambaService
    };

})();