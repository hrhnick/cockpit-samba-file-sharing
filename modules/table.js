// Samba Manager - Shared Table Management Module
(function() {
    'use strict';

    // Dependencies
    function utils() { return window.SambaManager.utils; }

    // Table configuration cache
    const tables = {};
    // Render queue for batch updates
    const renderQueue = new Map();
    let renderTimer = null;

    // Register a table configuration
    function registerTable(tableId, config) {
        // Clean up existing table
        if (tables[tableId]) {
            cleanup(tableId);
        }

        tables[tableId] = {
            config: {
                columns: config.columns || [],
                searchColumns: config.searchColumns || [],
                emptyMessage: config.emptyMessage || 'No items found.',
                loadingMessage: config.loadingMessage || 'Loading...',
                errorMessage: config.errorMessage || 'Failed to load data.',
                sortable: config.sortable !== false,
                searchable: config.searchable !== false,
                customRenderers: config.customRenderers || {},
                defaultSort: config.defaultSort || { column: 0, order: 'asc' }
            },
            state: {
                sortColumn: config.defaultSort?.column || 0,
                sortOrder: config.defaultSort?.order || 'asc',
                searchTerm: '',
                data: [],
                processedData: null
            }
        };

        setupTableEvents(tableId);
    }

    // Simplified render with batching
    function renderTable(tableId, data) {
        const table = tables[tableId];
        if (!table) {
            console.error('Table not registered:', tableId);
            return;
        }

        // Queue render operation
        renderQueue.set(tableId, data);
        
        // Schedule batch render
        if (!renderTimer) {
            renderTimer = requestAnimationFrame(() => {
                renderTimer = null;
                processBatchRender();
            });
        }
    }

    // Process all queued renders
    function processBatchRender() {
        const dom = utils().dom;
        
        renderQueue.forEach((data, tableId) => {
            const table = tables[tableId];
            if (!table) return;
            
            // Update data
            table.state.data = data;
            table.state.processedData = null;
            
            const tbody = document.querySelector(`#${tableId} tbody`);
            if (!tbody) return;
            
            tbody.classList.remove('loading');
            
            // Handle empty state
            if (!data || data.length === 0) {
                tbody.innerHTML = `<tr class="empty-row"><td colspan="${table.config.columns.length}">${utils().escapeHtml(table.config.emptyMessage)}</td></tr>`;
                return;
            }
            
            // Process data
            let processedData = data;
            
            // Apply search filter
            if (table.state.searchTerm) {
                const term = table.state.searchTerm.toLowerCase();
                processedData = data.filter(item => {
                    return table.config.searchColumns.some(columnIndex => {
                        const column = table.config.columns[columnIndex];
                        const value = getNestedValue(item, column.key);
                        return value && value.toString().toLowerCase().includes(term);
                    });
                });
            }
            
            // Apply sorting
            if (table.config.sortable && table.state.sortColumn !== null) {
                processedData = sortData(processedData, table.state, table.config);
            }
            
            // Cache processed data
            table.state.processedData = processedData;
            
            // Render rows using efficient string concatenation
            renderRowsOptimized(tbody, processedData, table);
        });
        
        renderQueue.clear();
    }

    // Optimized row rendering using string building
    function renderRowsOptimized(tbody, data, table) {
        const rowsHtml = data.map((item, index) => {
            const cells = table.config.columns.map(column => {
                const value = getNestedValue(item, column.key);
                const renderer = table.config.customRenderers[column.key] || column.renderer;
                
                let content;
                if (renderer) {
                    content = renderer(value, item);
                } else {
                    content = utils().escapeHtml(value || '');
                }
                
                return `<td${column.className ? ` class="${column.className}"` : ''}>${content}</td>`;
            }).join('');
            
            return `<tr data-index="${index}">${cells}</tr>`;
        }).join('');
        
        tbody.innerHTML = rowsHtml;
    }

    // Get nested object value by key path
    function getNestedValue(obj, keyPath) {
        if (!keyPath) return obj;
        return keyPath.split('.').reduce((value, key) => 
            value && typeof value === 'object' ? value[key] : undefined, obj);
    }

    // Simplified sort function
    function sortData(data, state, config) {
        const column = config.columns[state.sortColumn];
        if (!column) return data;
        
        const sorted = [...data].sort((a, b) => {
            let aVal = getNestedValue(a, column.key);
            let bVal = getNestedValue(b, column.key);
            
            // Apply sort transform if provided
            if (column.sortTransform) {
                aVal = column.sortTransform(aVal);
                bVal = column.sortTransform(bVal);
            } else if (typeof aVal === 'string') {
                aVal = aVal.toLowerCase();
                bVal = bVal ? bVal.toLowerCase() : '';
            }
            
            if (aVal === bVal) return 0;
            const result = aVal > bVal ? 1 : -1;
            return state.sortOrder === 'asc' ? result : -result;
        });
        
        return sorted;
    }

    // Setup table events - simplified
    function setupTableEvents(tableId) {
        const table = tables[tableId];
        const tableElement = document.getElementById(tableId);
        if (!tableElement || !table) return;
        
        // Sort handler
        tableElement.addEventListener('click', e => {
            const sortButton = e.target.closest('.sort-button');
            if (sortButton && table.config.sortable) {
                const th = sortButton.closest('th');
                const columnIndex = Array.from(th.parentNode.children).indexOf(th);
                handleSort(tableId, columnIndex);
            }
        });
        
        // Search handler
        if (table.config.searchable) {
            const searchInputId = tableId.replace('-table', '-search');
            const searchInput = document.getElementById(searchInputId);
            
            if (searchInput) {
                let debounceTimer;
                searchInput.addEventListener('input', e => {
                    clearTimeout(debounceTimer);
                    const newValue = e.target.value;
                    
                    debounceTimer = setTimeout(() => {
                        if (table.state.searchTerm !== newValue) {
                            table.state.searchTerm = newValue;
                            table.state.processedData = null;
                            renderTable(tableId, table.state.data);
                        }
                    }, 300);
                });
            }
        }
    }

    // Handle sort click
    function handleSort(tableId, columnIndex) {
        const table = tables[tableId];
        const state = table.state;
        
        // Toggle sort order if same column
        if (state.sortColumn === columnIndex) {
            state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
        } else {
            state.sortColumn = columnIndex;
            state.sortOrder = 'asc';
        }
        
        // Clear processed data cache
        state.processedData = null;
        
        // Update UI
        updateSortIndicators(tableId);
        
        // Re-render
        renderTable(tableId, state.data);
    }

    // Update sort indicators
    function updateSortIndicators(tableId) {
        const table = tables[tableId];
        const tableElement = document.getElementById(tableId);
        if (!tableElement) return;
        
        // Clear all indicators
        tableElement.querySelectorAll('.sort-indicator').forEach(indicator => {
            indicator.className = 'sort-indicator';
        });
        
        // Set active indicator
        const activeHeader = tableElement.querySelectorAll('th')[table.state.sortColumn];
        if (activeHeader) {
            const indicator = activeHeader.querySelector('.sort-indicator');
            if (indicator) {
                indicator.className = `sort-indicator ${table.state.sortOrder}`;
            }
        }
    }

    // Show loading state
    function showLoading(tableId) {
        const table = tables[tableId];
        const tbody = document.querySelector(`#${tableId} tbody`);
        if (!tbody || !table) return;
        
        tbody.classList.add('loading');
        tbody.innerHTML = `<tr class="loading-row"><td colspan="${table.config.columns.length}" class="loading-cell">${utils().escapeHtml(table.config.loadingMessage)}</td></tr>`;
    }

    // Show error state
    function showError(tableId, message) {
        const table = tables[tableId];
        const tbody = document.querySelector(`#${tableId} tbody`);
        if (!tbody || !table) return;
        
        tbody.classList.remove('loading');
        tbody.innerHTML = `<tr class="error-row"><td colspan="${table.config.columns.length}" class="error-message">${utils().escapeHtml(message || table.config.errorMessage)}</td></tr>`;
    }

    // Cleanup table resources
    function cleanup(tableId) {
        if (!tables[tableId]) return;
        
        // Remove from render queue
        renderQueue.delete(tableId);
        
        // Clear search input listener if exists
        const searchInputId = tableId.replace('-table', '-search');
        const searchInput = document.getElementById(searchInputId);
        if (searchInput) {
            // Remove event listeners by cloning
            const newInput = searchInput.cloneNode(true);
            searchInput.parentNode.replaceChild(newInput, searchInput);
        }
        
        delete tables[tableId];
    }

    // Export public interface
    window.SambaManager.table = {
        registerTable: registerTable,
        renderTable: renderTable,
        showLoading: showLoading,
        showError: showError,
        cleanup: cleanup
    };

})();
