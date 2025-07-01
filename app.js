// Samba Manager - Initialize namespace immediately for other modules
// Merge with existing namespace to preserve module references
window.SambaManager = window.SambaManager || {};

// Add application state to existing namespace
window.SambaManager.app = {
    shares: [],
    users: [],
    currentTab: 'shares',
    sambaInstalled: false,
    sambaService: null,
    configPath: '/etc/samba/smb.conf',
    // Track loaded modules
    loadedModules: {
        shares: false,
        users: false
    }
};

// Action handlers registry
window.SambaManager.actions = {};

console.log('Samba Manager namespace initialized');

// Samba Manager - Main Application Coordinator
(function() {
    'use strict';

    // Auto-refresh configuration
    const refreshConfig = {
        baseInterval: 60000,      // Base refresh interval (60 seconds)
        serviceInterval: 30000,   // Service status interval (30 seconds)
        maxInterval: 300000,      // Maximum interval (5 minutes)
        backoffMultiplier: 1.5,   // Exponential backoff multiplier
        idleTimeout: 120000,      // Time before considering user idle (2 minutes)
        lastActivity: Date.now(),
        currentInterval: 60000,
        refreshTimer: null,
        serviceTimer: null,
        documentHidden: false
    };

    // Module loading configuration
    const moduleConfig = {
        shares: 'modules/shares.js',
        users: 'modules/users.js'
    };

    // CSS Loading Detection - Ensure CSS is fully loaded before initializing
    function waitForCSS() {
        return new Promise(function(resolve) {
            // Check if our flag is set (from HTML onload)
            if (window.cssLoaded) {
                // Force a reflow to ensure styles are applied
                document.body.offsetHeight;
                resolve();
                return;
            }
            
            // Fallback: Check if stylesheets are loaded
            const styleSheets = document.styleSheets;
            let cssLoaded = true;
            
            for (let i = 0; i < styleSheets.length; i++) {
                try {
                    // Try to access rules - will throw if not loaded
                    if (styleSheets[i].href && styleSheets[i].href.includes('style.css')) {
                        const rules = styleSheets[i].cssRules || styleSheets[i].rules;
                        if (!rules || rules.length === 0) {
                            cssLoaded = false;
                        }
                    }
                } catch (e) {
                    // StyleSheet not yet loaded
                    cssLoaded = false;
                    break;
                }
            }
            
            if (cssLoaded) {
                // Force a reflow to ensure styles are applied
                document.body.offsetHeight;
                window.cssLoaded = true;
                resolve();
            } else {
                // Retry after a short delay
                setTimeout(function() {
                    waitForCSS().then(resolve);
                }, 10);
            }
        });
    }

    // Force CSS reflow to ensure proper rendering
    function forceReflow() {
        // Multiple techniques to force browser to recalculate styles
        
        // 1. Toggle display
        const body = document.body;
        const display = body.style.display;
        body.style.display = 'none';
        body.offsetHeight; // Trigger reflow
        body.style.display = display;
        
        // 2. Force style recalculation on main containers
        const containers = [
            document.getElementById('main-content'),
            document.querySelector('.pf-v6-c-page__main'),
            document.querySelector('.service-status-section')
        ];
        
        containers.forEach(function(container) {
            if (container) {
                // Use zoom trick to force repaint
                container.style.zoom = 1.0000001;
                container.offsetHeight; // Force reflow
                
                // Reset after a microtask
                Promise.resolve().then(function() {
                    container.style.zoom = '';
                });
            }
        });
        
        // 3. Request animation frame to ensure paint
        requestAnimationFrame(function() {
            document.documentElement.style.opacity = '0.9999';
            requestAnimationFrame(function() {
                document.documentElement.style.opacity = '';
            });
        });
    }

    // Enhanced loading overlay hiding with fade effect
    function hideLoadingOverlay() {
        const loadingOverlay = window.SambaManager.utils.getElement('loading-overlay');
        if (!loadingOverlay) return;
        
        // Add transition for smooth hiding
        loadingOverlay.style.transition = 'opacity 0.3s ease-out';
        loadingOverlay.style.opacity = '0';
        
        setTimeout(function() {
            loadingOverlay.style.display = 'none';
            loadingOverlay.style.transition = '';
            loadingOverlay.style.opacity = '';
            
            // Force final reflow after hiding
            forceReflow();
            
            // Ensure all content is visible with fade-in
            const content = document.querySelector('.pf-v6-c-page__main');
            if (content && !content.dataset.revealed) {
                content.dataset.revealed = 'true';
                content.style.opacity = '0';
                content.style.transition = 'opacity 0.2s ease-in';
                
                requestAnimationFrame(function() {
                    content.style.opacity = '1';
                    
                    // Clean up after transition
                    setTimeout(function() {
                        content.style.transition = '';
                        content.style.opacity = '';
                    }, 200);
                });
            }
        }, 300);
    }

    // Ensure rendering is complete before proceeding
    function ensureRendered(callback) {
        // Chain multiple techniques to ensure complete rendering
        
        // 1. Wait for next paint
        requestAnimationFrame(function() {
            // 2. Wait for following frame to ensure previous frame painted
            requestAnimationFrame(function() {
                // 3. Force style recalculation
                window.getComputedStyle(document.body).height;
                
                // 4. Use setTimeout to break out of current execution context
                setTimeout(function() {
                    // 5. Check if document is fully loaded
                    if (document.readyState === 'complete') {
                        callback();
                    } else {
                        // Wait for window load event
                        window.addEventListener('load', function() {
                            // One more frame for good measure
                            requestAnimationFrame(callback);
                        });
                    }
                }, 0);
            });
        });
    }

    // Load a module dynamically
    function loadModule(moduleName) {
        const app = window.SambaManager.app;
        
        // If already loaded or loading, return promise
        if (app.loadedModules[moduleName]) {
            return Promise.resolve(true);
        }
        
        // Check if module is already being loaded
        if (app.loadedModules[moduleName + '_loading']) {
            return app.loadedModules[moduleName + '_promise'];
        }
        
        console.log('Loading module:', moduleName);
        
        // Mark as loading
        app.loadedModules[moduleName + '_loading'] = true;
        
        // Create and store the promise
        const loadPromise = new Promise(function(resolve, reject) {
            const script = document.createElement('script');
            script.src = moduleConfig[moduleName];
            script.async = true;
            
            script.onload = function() {
                console.log('Module loaded:', moduleName);
                app.loadedModules[moduleName] = true;
                delete app.loadedModules[moduleName + '_loading'];
                delete app.loadedModules[moduleName + '_promise'];
                
                // Initialize module-specific action handlers
                initializeModuleActions(moduleName);
                
                resolve(true);
            };
            
            script.onerror = function() {
                console.error('Failed to load module:', moduleName);
                delete app.loadedModules[moduleName + '_loading'];
                delete app.loadedModules[moduleName + '_promise'];
                reject(new Error('Failed to load module: ' + moduleName));
            };
            
            document.head.appendChild(script);
        });
        
        // Store the promise for concurrent requests
        app.loadedModules[moduleName + '_promise'] = loadPromise;
        
        return loadPromise;
    }

    // Initialize module-specific action handlers
    function initializeModuleActions(moduleName) {
        const actions = window.SambaManager.actions;
        const modules = window.SambaManager;
        
        switch(moduleName) {
            case 'shares':
                if (modules.shares) {
                    actions.editShare = function(data) {
                        modules.shares.editShare(data.name);
                    };
                    actions.deleteShare = function(data) {
                        modules.shares.deleteShare(data.name);
                    };
                }
                break;
                
            case 'users':
                if (modules.users) {
                    actions.enableSamba = function(data) {
                        modules.users.enableSambaUser(data.username);
                    };
                    actions.disableSamba = function(data) {
                        modules.users.disableSambaUser(data.username);
                    };
                    actions.changePassword = function(data) {
                        modules.users.showPasswordModal(data.username);
                    };
                }
                break;
        }
    }

    // Initialize the application
    function init() {
        // Import references to modules
        const utils = window.SambaManager.utils;
        const config = window.SambaManager.config;
        const ui = window.SambaManager.ui;

        // Use enhanced loading overlay hiding
        ensureRendered(function() {
            hideLoadingOverlay();
            
            // Setup visibility change detection
            setupVisibilityHandlers();
            
            // Setup activity tracking
            setupActivityTracking();
            
            // Setup centralized event delegation
            setupEventDelegation();
            
            // Detect Samba installation
            ui.detectSamba()
                .then(function(installed) {
                    if (installed) {
                        utils.dom.toggle('service-status-section', true);
                        utils.dom.toggle('main-content', true);
                        utils.dom.toggle('samba-not-installed', false);
                        
                        // Force reflow after showing content
                        forceReflow();
                        
                        ui.setupEventListeners();
                        ui.loadServiceStatus();
                        
                        // Load shares module and initial data
                        return loadModule('shares').then(function() {
                            if (window.SambaManager.shares) {
                                window.SambaManager.shares.loadShares();
                            }
                        });
                    }
                    throw new Error('Samba not installed');
                })
                .then(function() {
                    // Start smart refresh timers
                    startSmartRefresh();
                })
                .catch(function(error) {
                    if (error.message === 'Samba not installed') {
                        utils.dom.toggle('samba-not-installed', true);
                        utils.dom.toggle('main-content', false);
                        utils.dom.toggle('service-status-section', false);
                        
                        // Force reflow after showing error
                        forceReflow();
                    } else {
                        utils.showNotification('Failed to initialize Samba manager', 'error');
                    }
                });
        });
    }

    // Setup centralized event delegation
    function setupEventDelegation() {
        // Single event delegation handler
        document.addEventListener('click', function(e) {
            // Check for data-action attribute
            const actionElement = e.target.closest('[data-action]');
            if (actionElement) {
                e.preventDefault();
                const action = actionElement.dataset.action;
                const handler = window.SambaManager.actions[action];
                
                if (handler) {
                    // Pass all data attributes as parameters
                    handler(actionElement.dataset);
                } else {
                    console.warn('No handler registered for action:', action);
                }
            }
        });
    }

    // Setup Page Visibility API handlers
    function setupVisibilityHandlers() {
        // Handle various browser prefixes
        let hidden, visibilityChange;
        if (typeof document.hidden !== "undefined") {
            hidden = "hidden";
            visibilityChange = "visibilitychange";
        } else if (typeof document.msHidden !== "undefined") {
            hidden = "msHidden";
            visibilityChange = "msvisibilitychange";
        } else if (typeof document.webkitHidden !== "undefined") {
            hidden = "webkitHidden";
            visibilityChange = "webkitvisibilitychange";
        }

        if (typeof document[hidden] !== "undefined") {
            document.addEventListener(visibilityChange, function() {
                refreshConfig.documentHidden = document[hidden];
                if (refreshConfig.documentHidden) {
                    // Page is hidden - stop refresh
                    stopSmartRefresh();
                } else {
                    // Page is visible again - restart refresh and update immediately
                    refreshConfig.lastActivity = Date.now();
                    refreshConfig.currentInterval = refreshConfig.baseInterval;
                    startSmartRefresh();
                    refreshCurrentTab();
                }
            }, false);
        }
    }

    // Setup activity tracking for idle detection
    function setupActivityTracking() {
        const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
        
        events.forEach(function(event) {
            document.addEventListener(event, function() {
                const now = Date.now();
                const wasIdle = (now - refreshConfig.lastActivity) > refreshConfig.idleTimeout;
                
                refreshConfig.lastActivity = now;
                
                // If user was idle and is now active, reset interval
                if (wasIdle && refreshConfig.currentInterval > refreshConfig.baseInterval) {
                    refreshConfig.currentInterval = refreshConfig.baseInterval;
                    resetRefreshTimer();
                }
            }, true);
        });
    }

    // Smart refresh implementation
    function startSmartRefresh() {
        // Clear any existing timers
        stopSmartRefresh();
        
        // Start service status timer (fixed interval)
        refreshConfig.serviceTimer = setInterval(function() {
            if (!refreshConfig.documentHidden) {
                window.SambaManager.ui.loadServiceStatus();
            }
        }, refreshConfig.serviceInterval);
        
        // Start main content refresh timer
        scheduleNextRefresh();
    }

    function stopSmartRefresh() {
        if (refreshConfig.refreshTimer) {
            clearTimeout(refreshConfig.refreshTimer);
            refreshConfig.refreshTimer = null;
        }
        if (refreshConfig.serviceTimer) {
            clearInterval(refreshConfig.serviceTimer);
            refreshConfig.serviceTimer = null;
        }
    }

    function scheduleNextRefresh() {
        if (refreshConfig.refreshTimer) {
            clearTimeout(refreshConfig.refreshTimer);
        }
        
        refreshConfig.refreshTimer = setTimeout(function() {
            if (!refreshConfig.documentHidden) {
                refreshCurrentTab();
                
                // Calculate next interval with exponential backoff if idle
                const now = Date.now();
                const timeSinceActivity = now - refreshConfig.lastActivity;
                
                if (timeSinceActivity > refreshConfig.idleTimeout) {
                    // User is idle - increase interval
                    refreshConfig.currentInterval = Math.min(
                        refreshConfig.currentInterval * refreshConfig.backoffMultiplier,
                        refreshConfig.maxInterval
                    );
                } else {
                    // User is active - use base interval
                    refreshConfig.currentInterval = refreshConfig.baseInterval;
                }
            }
            
            // Schedule next refresh
            scheduleNextRefresh();
        }, refreshConfig.currentInterval);
    }

    function resetRefreshTimer() {
        if (refreshConfig.refreshTimer) {
            clearTimeout(refreshConfig.refreshTimer);
            scheduleNextRefresh();
        }
    }

    function refreshCurrentTab() {
        const app = window.SambaManager.app;
        
        // Only refresh if the module is loaded
        if (!app.loadedModules[app.currentTab]) {
            return;
        }
        
        // Get module references
        const shares = window.SambaManager.shares;
        const users = window.SambaManager.users;
        
        // Only refresh the active tab
        switch(app.currentTab) {
            case 'shares':
                if (shares && shares.loadShares) shares.loadShares();
                break;
            case 'users':
                if (users && users.loadUsers) users.loadUsers();
                break;
        }
    }

    // Export module loading function for UI to use
    window.SambaManager.loadModule = loadModule;

    // Enhanced initialization with CSS loading detection
    document.addEventListener('DOMContentLoaded', function() {
        console.log('DOM Content Loaded - Waiting for CSS...');
        
        // Wait for CSS to be fully loaded
        waitForCSS().then(function() {
            console.log('CSS Loaded - Initializing application...');
            
            // Give modules and cockpit a moment to initialize
            setTimeout(function() {
                if (typeof cockpit !== 'undefined') {
                    init();
                } else {
                    const checkInterval = setInterval(function() {
                        if (typeof cockpit !== 'undefined') {
                            clearInterval(checkInterval);
                            init();
                        }
                    }, 100);
                }
            }, 100);
        });
    });

})();
