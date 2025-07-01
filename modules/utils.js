// Samba Manager - Utility Functions Module
(function() {
    'use strict';

    // Initialize namespace if needed
    window.SambaManager = window.SambaManager || {};
    
    // Core utility functions
    function executeCommand(command, options) {
        options = options || {};
        return cockpit.spawn(command, options)
            .then(function(result) {
                return { success: true, data: result };
            })
            .catch(function(error) {
                return { success: false, error: error.message || error.toString() };
            });
    }

    function getElement(id) {
        return document.getElementById(id);
    }

    function showNotification(message, type) {
        type = type || 'info';
        const banner = getElement('action-banner');
        if (banner) {
            banner.textContent = message;
            banner.className = type;
            banner.style.display = 'block';
            setTimeout(function() {
                banner.style.display = 'none';
            }, 4000);
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Modern DOM manipulation utilities
    const dom = {
        // Enhanced element creation with template support
        create: function(tag, attrs, children) {
            const el = document.createElement(tag);
            
            if (attrs) {
                Object.entries(attrs).forEach(([key, value]) => {
                    if (key === 'className') {
                        el.className = value;
                    } else if (key === 'textContent') {
                        el.textContent = value;
                    } else if (key === 'innerHTML') {
                        el.innerHTML = value;
                    } else if (key === 'dataset') {
                        Object.assign(el.dataset, value);
                    } else if (key === 'style' && typeof value === 'object') {
                        Object.assign(el.style, value);
                    } else if (key.startsWith('on') && typeof value === 'function') {
                        el.addEventListener(key.slice(2).toLowerCase(), value);
                    } else {
                        el.setAttribute(key, value);
                    }
                });
            }
            
            if (children) {
                this.append(el, children);
            }
            
            return el;
        },

        // Efficient append with fragment support
        append: function(parent, children) {
            if (!Array.isArray(children)) {
                children = [children];
            }
            
            // Use fragment for multiple children
            if (children.length > 1) {
                const fragment = document.createDocumentFragment();
                children.forEach(child => {
                    if (typeof child === 'string') {
                        fragment.appendChild(document.createTextNode(child));
                    } else if (child instanceof Node) {
                        fragment.appendChild(child);
                    }
                });
                parent.appendChild(fragment);
            } else {
                children.forEach(child => {
                    if (typeof child === 'string') {
                        parent.appendChild(document.createTextNode(child));
                    } else if (child instanceof Node) {
                        parent.appendChild(child);
                    }
                });
            }
        },

        // Template literal HTML creation
        html: function(strings, ...values) {
            const html = strings.reduce((result, str, i) => {
                const value = values[i - 1];
                if (value === undefined) return result + str;
                
                // Auto-escape values unless they're marked as safe
                const escaped = value && value.__safe ? value.toString() : escapeHtml(value);
                return result + escaped + str;
            });
            
            return { __safe: true, toString: () => html };
        },

        // Safe HTML marker
        safe: function(html) {
            return { __safe: true, toString: () => html };
        },

        // Create element from HTML string
        fromHTML: function(html) {
            const template = document.createElement('template');
            template.innerHTML = html.trim();
            return template.content.firstChild;
        },

        // Batch DOM updates
        batch: function(updates) {
            requestAnimationFrame(() => {
                updates.forEach(update => update());
            });
        },

        toggle: function(el, show) {
            if (typeof el === 'string') el = getElement(el);
            if (el) {
                el.style.display = show ? '' : 'none';
            }
        },

        updateText: function(id, text) {
            const el = getElement(id);
            if (el) el.textContent = text;
        },

        addClass: function(el, className) {
            if (typeof el === 'string') el = getElement(el);
            if (el) el.classList.add(className);
        },

        removeClass: function(el, className) {
            if (typeof el === 'string') el = getElement(el);
            if (el) el.classList.remove(className);
        },

        toggleClass: function(el, className, force) {
            if (typeof el === 'string') el = getElement(el);
            if (el) el.classList.toggle(className, force);
        },

        // Query utilities with caching
        query: function(selector, parent) {
            return (parent || document).querySelector(selector);
        },

        queryAll: function(selector, parent) {
            return Array.from((parent || document).querySelectorAll(selector));
        },

        // Delegated event handling
        delegate: function(parent, eventType, selector, handler) {
            if (typeof parent === 'string') parent = getElement(parent);
            
            parent.addEventListener(eventType, function(e) {
                const target = e.target.closest(selector);
                if (target && parent.contains(target)) {
                    handler.call(target, e, target);
                }
            });
        }
    };

    // Unified validation system
    const validators = {
        required: function(value, label) {
            return !value ? (label || 'Field') + ' is required' : null;
        },

        pattern: function(value, pattern, message) {
            return !pattern.test(value) ? message : null;
        },

        shareName: function(value) {
            if (!value) return 'Share name is required';
            if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
                return 'Share name can only contain letters, numbers, hyphens, and underscores';
            }
            return null;
        },

        path: function(value) {
            if (!value) return 'Path is required';
            if (!value.startsWith('/')) return 'Path must be absolute (start with /)';
            return null;
        },

        usersAndGroups: function(value) {
            if (!value) return null; // Optional field
            const items = value.split(',').map(item => item.trim());
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item && !/^@?[a-zA-Z0-9_-]+$/.test(item)) {
                    return 'Invalid user or group format at position ' + (i + 1);
                }
            }
            return null;
        }
    };

    // Samba-specific command builders
    const sambaCommands = {
        testConfig: function() {
            return {
                command: ['testparm', '-s'],
                options: { silent: true }
            };
        },

        reloadConfig: function() {
            return {
                command: ['smbcontrol', 'smbd', 'reload-config'],
                options: { superuser: 'require', silent: true }
            };
        },

        addUser: function(username, password) {
            const passwordInput = password + '\n' + password;
            return {
                command: ['bash', '-c', 'echo -e "' + passwordInput + '" | smbpasswd -a -s ' + username],
                options: { superuser: 'require' }
            };
        },

        removeUser: function(username) {
            return {
                command: ['smbpasswd', '-x', username],
                options: { superuser: 'require' }
            };
        },

        listUsers: function() {
            return {
                command: ['pdbedit', '-L'],
                options: { superuser: 'try', silent: true }
            };
        }
    };

    // Unified error handling
    const errorHandler = {
        handle: function(error, context) {
            const message = this.parse(error, context);
            showNotification(message, 'error');
            return message;
        },

        handleAsync: function(promise, context, onSuccess, onError) {
            return promise
                .then(function(result) {
                    if (result.success) {
                        if (onSuccess) return onSuccess(result);
                        return result;
                    } else {
                        const msg = errorHandler.parse(result.error, context);
                        if (onError) return onError(msg, result);
                        showNotification(msg, 'error');
                        return result;
                    }
                })
                .catch(function(error) {
                    const msg = errorHandler.parse(error, context);
                    if (onError) return onError(msg, { success: false, error: error });
                    showNotification(msg, 'error');
                    return { success: false, error: error };
                });
        },

        parse: function(error, context) {
            // Use existing parseSambaError for Samba-specific errors
            if (context && context.includes('samba')) {
                return parseSambaError(error);
            }
            
            // Generic error parsing
            if (typeof error === 'object' && error.message) {
                return error.message;
            }
            
            return error ? error.toString() : 'Unknown error';
        }
    };

    // Batch operations framework
    const batchOperations = {
        processSequentially: function(items, operation, delay) {
            const results = [];
            let index = 0;
            
            function processNext() {
                if (index >= items.length) {
                    return Promise.resolve(results);
                }
                
                const item = items[index++];
                return Promise.resolve(operation(item))
                    .then(function(result) {
                        results.push(result);
                        if (delay) {
                            return new Promise(function(resolve) {
                                setTimeout(function() {
                                    resolve(processNext());
                                }, delay);
                            });
                        }
                        return processNext();
                    })
                    .catch(function(error) {
                        results.push({ error: error, item: item });
                        return processNext();
                    });
            }
            
            return processNext();
        },

        processParallel: function(items, operation, batchSize) {
            batchSize = batchSize || 5;
            const results = [];
            
            function processBatch(startIndex) {
                if (startIndex >= items.length) {
                    return Promise.resolve(results);
                }
                
                const batch = items.slice(startIndex, startIndex + batchSize);
                const promises = batch.map(function(item) {
                    return Promise.resolve(operation(item))
                        .catch(function(error) {
                            return { error: error, item: item };
                        });
                });
                
                return Promise.all(promises)
                    .then(function(batchResults) {
                        results.push.apply(results, batchResults);
                        return processBatch(startIndex + batchSize);
                    });
            }
            
            return processBatch(0);
        },

        delay: function(ms) {
            return new Promise(function(resolve) {
                setTimeout(resolve, ms);
            });
        }
    };

    // Parse Samba error messages for more helpful feedback
    function parseSambaError(error) {
        if (!error) return 'Unknown error';
        
        // Common Samba error patterns
        const errorPatterns = [
            // Service errors
            { pattern: /Unit .* not found/, message: 'Samba service not installed' },
            { pattern: /Failed to .* Unit/, message: 'Systemd service error' },
            { pattern: /smbd: command not found/, message: 'Samba is not installed' },
            
            // Configuration errors
            { pattern: /Unknown parameter encountered/, extract: /"(.+)"/, message: 'Unknown configuration parameter: ' },
            { pattern: /syntax error/, message: 'Configuration syntax error' },
            { pattern: /Failed to load configuration/, message: 'Invalid configuration file' },
            
            // Permission errors
            { pattern: /permission denied/i, message: 'Permission denied' },
            { pattern: /operation not permitted/i, message: 'Operation not permitted' },
            { pattern: /access denied/i, message: 'Access denied' },
            
            // User management errors
            { pattern: /Failed to add entry for user/, extract: /user (.+)\./, message: 'Failed to add Samba user: ' },
            { pattern: /Failed to find entry for user/, extract: /user (.+)\./, message: 'User not found: ' },
            { pattern: /User .* does not exist/, extract: /User (.+) does/, message: 'System user does not exist: ' },
            
            // Share errors
            { pattern: /share .* does not exist/i, extract: /share (.+) does/i, message: 'Share not found: ' },
            { pattern: /path .* does not exist/i, extract: /path (.+) does/i, message: 'Path does not exist: ' }
        ];
        
        // Try to match against known patterns
        for (let i = 0; i < errorPatterns.length; i++) {
            const pattern = errorPatterns[i];
            if (pattern.pattern.test(error)) {
                if (pattern.extract) {
                    const match = error.match(pattern.extract);
                    if (match && match[1]) {
                        return pattern.message + match[1];
                    }
                }
                return pattern.message + (pattern.extract ? error : '');
            }
        }
        
        // If no pattern matched, try to extract the most relevant line
        const lines = error.split('\n').filter(function(line) {
            return line.trim() && !line.includes('spawn') && !line.includes('cockpit');
        });
        
        // Look for lines with error indicators
        const errorLine = lines.find(function(line) {
            return line.toLowerCase().includes('error') || 
                   line.toLowerCase().includes('failed') ||
                   line.toLowerCase().includes('cannot');
        });
        
        return errorLine || lines[0] || error.split('\n')[0];
    }

    function formatDate(dateStr) {
        if (!dateStr) return 'Unknown';
        
        try {
            const date = new Date(dateStr);
            const now = new Date();
            const diffMs = now - date;
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            
            if (diffDays === 0) {
                const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                if (diffHours === 0) {
                    const diffMinutes = Math.floor(diffMs / (1000 * 60));
                    if (diffMinutes === 0) {
                        return 'Just now';
                    }
                    return diffMinutes + ' minute' + (diffMinutes > 1 ? 's' : '') + ' ago';
                }
                return diffHours + ' hour' + (diffHours > 1 ? 's' : '') + ' ago';
            } else if (diffDays < 30) {
                return diffDays + ' day' + (diffDays > 1 ? 's' : '') + ' ago';
            } else {
                return date.toLocaleDateString();
            }
        } catch (e) {
            return 'Unknown';
        }
    }

    // Export public interface
    window.SambaManager.utils = {
        // Core utilities
        executeCommand: executeCommand,
        getElement: getElement,
        showNotification: showNotification,
        escapeHtml: escapeHtml,
        parseSambaError: parseSambaError,
        formatDate: formatDate,
        
        // Enhanced utilities
        dom: dom,
        validators: validators,
        sambaCommands: sambaCommands,
        errorHandler: errorHandler,
        batchOperations: batchOperations
    };

})();