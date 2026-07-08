import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import 'cockpit-dark-theme';
import '@patternfly/patternfly/patternfly.css';
import {
    Button,
    Card,
    CardHeader,
    CardBody,
    CardTitle,
    CardExpandableContent,
    DescriptionList,
    DescriptionListGroup,
    DescriptionListTerm,
    DescriptionListDescription,
    Flex,
    Label,
    Page,
    PageSection,
    Stack,
    AlertActionCloseButton,
    Modal,
    ModalHeader,
    ModalBody,
    ModalFooter,
    Form,
    FormGroup,
    FormHelperText,
    HelperText,
    HelperTextItem,
    TextInput,
    TextArea,
    Checkbox,
    Alert,
    AlertGroup,
    DropdownItem,
    SearchInput,
    Divider,
    List,
    ListItem,
    Tooltip
} from '@patternfly/react-core';
import SyncAltIcon from '@patternfly/react-icons/dist/esm/icons/sync-alt-icon';
import ExclamationTriangleIcon from '@patternfly/react-icons/dist/esm/icons/exclamation-triangle-icon';
import ExclamationCircleIcon from '@patternfly/react-icons/dist/esm/icons/exclamation-circle-icon';
import { Table, Thead, Tr, Th, Tbody, Td } from '@patternfly/react-table';
import { EmptyStatePanel } from 'cockpit-components-empty-state';
import { install_dialog } from 'cockpit-components-install-dialog.jsx';
import { fmt_to_fragments } from 'utils';
import CubesIcon from '@patternfly/react-icons/dist/esm/icons/cubes-icon';
import { MultiTypeaheadSelect } from './components/multi-typeahead-select';
import { KebabMenu } from './components/kebab-menu';
import { ConfirmModal } from './components/confirm-modal';
import './app.scss';

// Import the decoupled Cockpit API methods
import * as api from './api/samba';
import cockpit from 'cockpit';

const _ = cockpit.gettext;

// Monotonic toast id — Date.now() alone collides when two toasts fire in the
// same millisecond (e.g. "folder created" immediately followed by the ACL
// warning), which breaks React keys and dismisses both at once.
let toastSequence = 0;

// Human-readable (and translatable) labels for the raw service states.
const STATUS_LABELS = {
    running: _("Running"),
    stopped: _("Stopped"),
    'not installed': _("Not installed"),
    unknown: _("Unknown")
};

// Whole sentences per action rather than interpolating the verb, so each
// message can be translated naturally.
const SERVICE_ACTION_MESSAGES = {
    start: _("Service start command sent."),
    stop: _("Service stop command sent."),
    restart: _("Service restart command sent.")
};

const SERVICE_ACTION_FAILURES = {
    start: _("Failed to start service: $0"),
    stop: _("Failed to stop service: $0"),
    restart: _("Failed to restart service: $0")
};

// Error text under a form field, matching PatternFly's FormHelperText/HelperText
// boilerplate — repeated as-is for every validated field in this file.
const FieldError = ({ children }) => (
    <FormHelperText>
        <HelperText>
            <HelperTextItem variant="error">{children}</HelperTextItem>
        </HelperText>
    </FormHelperText>
);

const SambaManager = () => {
    // --- STATE ---
    const [serviceStatus, setServiceStatus] = useState('unknown');
    const [serviceName, setServiceName] = useState(null);
    const [serviceDetails, setServiceDetails] = useState({});
    const [shareConnections, setShareConnections] = useState([]);

    const [globalConf, setGlobalConf] = useState({});
    const [shares, setShares] = useState({});
    const [shareStatus, setShareStatus] = useState({}); // { [name]: { missing, selinuxBad } }
    const [isLoading, setIsLoading] = useState(true);
    const [toasts, setToasts] = useState([]);

    // Directory fix modal: null | { type: 'missing'|'selinux', shareName, path, validUsers, includeAcl }
    const [fixModal, setFixModal] = useState(null);
    // Delete share confirmation modal: null | { name, path }
    const [deleteModal, setDeleteModal] = useState(null);
    // Remove Samba password confirmation modal: null | { username }
    const [removePasswordModal, setRemovePasswordModal] = useState(null);

    // Main UI State
    const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);
    const [isServiceDetailsExpanded, setIsServiceDetailsExpanded] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [installInProgress, setInstallInProgress] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState('name');
    const [sortAsc, setSortAsc] = useState(true);
    const [openShareActions, setOpenShareActions] = useState(null);

    // Share Modal State
    const [isShareModalOpen, setIsShareModalOpen] = useState(false);
    const [editingShareName, setEditingShareName] = useState(null);
    const [shareForm, setShareForm] = useState({
        name: '',
        path: '',
        comment: '',
        readOnly: false,
        browsable: true,
        guestOk: false,
        validUsers: [] // array of user names and @group names
    });
    const [userGroupSuggestions, setUserGroupSuggestions] = useState([]);
    const [validUsersInput, setValidUsersInput] = useState('');

    // Users Modal State
    const [isUsersModalOpen, setIsUsersModalOpen] = useState(false);
    const [users, setUsers] = useState([]);
    const [usersLoading, setUsersLoading] = useState(false);
    const [newPasswords, setNewPasswords] = useState({});
    const [confirmPasswords, setConfirmPasswords] = useState({});
    const [openUserActions, setOpenUserActions] = useState(null);
    const [userSearchQuery, setUserSearchQuery] = useState('');
    const [userSortAsc, setUserSortAsc] = useState(true);
    const [editingPasswordFor, setEditingPasswordFor] = useState(null);

    // Global Settings Modal State
    const [isGlobalModalOpen, setIsGlobalModalOpen] = useState(false);
    const [globalConfText, setGlobalConfText] = useState('');

    // Logs Modal State
    const [isLogsModalOpen, setIsLogsModalOpen] = useState(false);
    const [auditToggling, setAuditToggling] = useState(false);
    const [logLines, setLogLines] = useState('');
    const logProcRef = useRef(null); // journalctl --follow spawn handle
    const logViewRef = useRef(null); // scroll container, for auto-scroll

    // Backup/Restore Modal State
    const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
    const [backupText, setBackupText] = useState(''); // config shown in the box
    const [backupIsPreview, setBackupIsPreview] = useState(false); // true once an uploaded config is loaded but not yet applied
    const [backupSaving, setBackupSaving] = useState(false);
    const restoreInputRef = useRef(null); // hidden file input for uploads

    // --- INITIALIZATION ---
    // For each share, check whether its directory is missing or has a wrong
    // SELinux context, so the table can surface a warning/fix icon per row.
    const refreshShareStatus = async (sharesObj) => {
        const entries = await Promise.all(Object.entries(sharesObj).map(async ([name, config]) => {
            const path = config.path;
            if (!path) return [name, { missing: false, selinuxBad: false }];

            const exists = await api.checkDirectoryExists(path);
            let selinuxBad = false;
            if (exists) {
                const ctxOk = await api.checkSELinuxContext(path);
                selinuxBad = !ctxOk;
            }
            return [name, { missing: !exists, selinuxBad }];
        }));
        setShareStatus(Object.fromEntries(entries));
    };

    const loadData = async () => {
        setIsLoading(true);
        try {
            // getServiceDetails depends on the service status, but reading the
            // config doesn't depend on either — run it concurrently instead of
            // waiting on the service status/details chain first.
            const [statusObj, allShares] = await Promise.all([api.checkServiceStatus(), api.readShares()]);
            setServiceStatus(statusObj.status);
            setServiceName(statusObj.name);

            const [details, connections, usernamesByPid] = await Promise.all([
                api.getServiceDetails(statusObj),
                statusObj.status === 'running' ? api.getShareConnections() : Promise.resolve([]),
                statusObj.status === 'running' ? api.getSessionUsernames() : Promise.resolve({})
            ]);
            setServiceDetails(details);
            // getShareConnections (smbstatus -S) has no username column;
            // getSessionUsernames (smbstatus -p) does — join the two reports
            // by the PID they share.
            setShareConnections(connections.map(c => ({ ...c, username: usernamesByPid[c.pid] || '' })));

            setGlobalConf(allShares.global || {});

            const justShares = {};
            for (const key in allShares) {
                if (key.toLowerCase() !== 'global') {
                    justShares[key] = allShares[key];
                }
            }
            setShares(justShares);
            refreshShareStatus(justShares);
        } catch (err) {
            addToast(_("Failed to load Samba configuration"), "danger");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        // Load Cockpit's bundled Red Hat fonts, served same-origin at
        // ../../static/fonts/ (the same path other Cockpit plugins use). Injected
        // at runtime rather than via an SCSS @font-face import because esbuild
        // would otherwise try to bundle the .woff2 files at build time.
        if (!document.getElementById('samba-redhat-fonts')) {
            const style = document.createElement('style');
            style.id = 'samba-redhat-fonts';
            const face = (family, file, weight) =>
                `@font-face{font-family:"${family}";src:url("../../static/fonts/${file}.woff2") format("woff2");font-weight:${weight};font-display:fallback;}`;
            // PatternFly's font stacks list both spellings ("Red Hat Text" and
            // "RedHatText"), preferring the spaced one — register both so the
            // first candidate in the stack always resolves.
            style.textContent = [
                face('Red Hat Text', 'RedHatText-Regular', 400),
                face('Red Hat Text', 'RedHatText-Bold', 700),
                face('RedHatText', 'RedHatText-Regular', 400),
                face('RedHatText', 'RedHatText-Bold', 700),
                face('Red Hat Display', 'RedHatDisplay-Medium', 400),
                face('Red Hat Display', 'RedHatDisplay-Bold', 700),
                face('RedHatDisplay', 'RedHatDisplay-Medium', 400),
                face('RedHatDisplay', 'RedHatDisplay-Bold', 700),
                face('Red Hat Mono', 'RedHatMono-Regular', 400),
                face('RedHatMono', 'RedHatMono-Regular', 400)
            ].join('\n');
            document.head.appendChild(style);
        }
        loadData();
        // loadData is defined in the component body; this effect is intentionally
        // run only once on mount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // --- HELPERS ---
    const addToast = (title, variant = 'success') => {
        const id = ++toastSequence;
        setToasts(prev => [...prev, { id, title, variant }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 5000);
    };

    // Extract a human-readable string from a caught error. cockpit.spawn
    // rejections carry .message when spawned with err:"message", otherwise
    // .problem; fall back to the string form for anything else.
    const errText = (e) => e?.message || e?.problem || String(e);

    // Show a red toast built from a translatable format string. Extra args
    // fill the format's $0, $1, ... placeholders. The _() literal stays at the
    // call site so gettext extraction still finds it.
    const showError = (fmt, ...args) => addToast(cockpit.format(fmt, ...args), "danger");

    // Manual refresh of service details and share status; the icon spins
    // while the reload runs.
    const handleRefresh = async () => {
        if (isRefreshing) return;
        setIsRefreshing(true);
        try {
            await loadData();
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleServiceAction = async (action) => {
        if (!serviceName) return;
        try {
            await api.manageServiceAction(serviceName, action);
            addToast(SERVICE_ACTION_MESSAGES[action]);
            setTimeout(loadData, 1500);
        } catch (err) {
            showError(SERVICE_ACTION_FAILURES[action], errText(err));
        }
    };

    // Offer to install the Samba packages via PackageKit when the service is
    // not present on the system at all.
    const handleInstallSamba = async () => {
        setInstallInProgress(true);
        try {
            await install_dialog("samba");
            await loadData();
        } catch (e) {
            // Dialog cancelled or PackageKit unavailable — nothing to do.
        } finally {
            setInstallInProgress(false);
        }
    };

    // --- SORTING & FILTERING SHARES ---
    const handleSort = (key) => {
        if (sortBy === key) {
            setSortAsc(!sortAsc);
        } else {
            setSortBy(key);
            setSortAsc(true);
        }
    };

    const getFilteredAndSortedShares = () => {
        const query = searchQuery.toLowerCase();
        const arr = Object.entries(shares).filter(([name, config]) => {
            return name.toLowerCase().includes(query) || (config.comment || '').toLowerCase().includes(query);
        });

        arr.sort((a, b) => {
            const valA = (sortBy === 'path' ? (a[1].path || '') : a[0]).toLowerCase();
            const valB = (sortBy === 'path' ? (b[1].path || '') : b[0]).toLowerCase();
            if (valA < valB) return sortAsc ? -1 : 1;
            if (valA > valB) return sortAsc ? 1 : -1;
            return 0;
        });
        return arr;
    };

    const processedShares = getFilteredAndSortedShares();
    const activeSortIndex = sortBy === 'name' ? 0 : sortBy === 'path' ? 1 : -1;

    // --- SORTING & FILTERING USERS ---
    const getFilteredAndSortedUsers = () => {
        const query = userSearchQuery.toLowerCase();
        const arr = users.filter(u => u.name.toLowerCase().includes(query));
        arr.sort((a, b) => {
            if (a.name < b.name) return userSortAsc ? -1 : 1;
            if (a.name > b.name) return userSortAsc ? 1 : -1;
            return 0;
        });
        return arr;
    };

    const processedUsers = getFilteredAndSortedUsers();

    // --- SHARE MANAGEMENT ---
    const openShareModal = (shareName = null, config = null) => {
        setEditingShareName(shareName);
        if (config) {
            setShareForm({
                name: shareName,
                path: config.path || '',
                comment: config.comment || '',
                readOnly: config['read only'] === 'yes',
                browsable: config.browsable !== 'no',
                guestOk: config['guest ok'] === 'yes',
                validUsers: (config['valid users'] || '').split(',')
                        .map(s => s.trim())
                        .filter(Boolean)
            });
        } else {
            setShareForm({ name: '', path: '', comment: '', readOnly: false, browsable: true, guestOk: false, validUsers: [] });
        }
        setValidUsersInput('');
        setIsShareModalOpen(true);

        // Load user/group autocomplete suggestions for the Valid Users field.
        api.loadUserGroupSuggestions()
                .then(setUserGroupSuggestions)
                .catch(() => setUserGroupSuggestions([]));
    };

    // --- VALID USERS TYPEAHEAD OPTIONS ---
    // Options for the multi-select: the system's user/group suggestions, plus
    // anything already selected on the share (so its chip always renders), plus
    // whatever is currently typed (so arbitrary users/@groups can be added).
    // Groups (@name) get yellow labels, users blue — like the Accounts page.
    const validUserOptions = (() => {
        const values = new Set([...userGroupSuggestions, ...shareForm.validUsers]);
        const typed = validUsersInput.trim();
        if (typed) values.add(typed);
        return [...values].map(v => ({ value: v, content: v, color: v.startsWith('@') ? 'yellow' : 'blue' }));
    })();

    // Share name validation: saving a share under an existing name would
    // silently overwrite that share (Samba treats section names
    // case-insensitively). When editing, the share's own name stays allowed so
    // it can be kept or changed.
    const shareNameError = (() => {
        const name = shareForm.name.trim();
        if (!name) return '';
        const collision = Object.keys(shares).find(s =>
            s.toLowerCase() === name.toLowerCase() &&
            (!editingShareName || s.toLowerCase() !== editingShareName.toLowerCase())
        );
        return collision ? cockpit.format(_("A share named \"$0\" already exists."), collision) : '';
    })();

    // Path validation: Samba shares need an absolute path; catch an obvious
    // typo (relative path, stray whitespace) before it reaches the shell.
    const sharePathError = (() => {
        const path = shareForm.path.trim();
        if (!path) return '';
        if (!path.startsWith('/')) return _("Path must be absolute (start with /).");
        return '';
    })();

    // Open the delete-confirmation modal for a share.
    const handleDeleteShare = (shareName) => {
        setDeleteModal({ name: shareName, path: shares[shareName]?.path || '' });
    };

    const confirmDeleteShare = async () => {
        const shareName = deleteModal.name;
        const updatedShares = { ...shares };
        delete updatedShares[shareName];

        try {
            await api.saveShares(globalConf, updatedShares);
            setShares(updatedShares);
            refreshShareStatus(updatedShares);
            addToast(cockpit.format(_("Share $0 deleted successfully."), shareName));
            setDeleteModal(null);
        } catch (err) {
            showError(_("Failed to delete share: $0"), errText(err));
        }
    };

    // --- ACTIVE CONNECTIONS ---
    // shareConnections holds one row per (pid, share) tree-connect, per
    // smbstatus -S. Group those into one row per session/user: the shares a
    // pid has open, and the earliest connectedAt among them (when that user
    // first connected, not when they opened their most recent share).
    const getUserConnections = () => {
        const byPid = new Map();
        for (const c of shareConnections) {
            const existing = byPid.get(c.pid);
            if (!existing) {
                byPid.set(c.pid, { pid: c.pid, username: c.username, machine: c.machine, connectedAt: c.connectedAt, connectedAtSort: c.connectedAtSort, encryption: c.encryption, signing: c.signing, shares: [c.share] });
                continue;
            }
            existing.shares.push(c.share);
            // Sort keys are plain "YYYY-MM-DD HH:MM:SS" strings (see
            // formatConnectedAt in samba.js), so string comparison is
            // chronological; missing sort keys never replace an existing one.
            if (c.connectedAtSort && (!existing.connectedAtSort || c.connectedAtSort < existing.connectedAtSort)) {
                existing.connectedAt = c.connectedAt;
                existing.connectedAtSort = c.connectedAtSort;
                existing.encryption = c.encryption;
                existing.signing = c.signing;
            }
        }
        return [...byPid.values()];
    };

    const userConnections = getUserConnections();

    // --- DIRECTORY / SELINUX FIXES ---
    const handleFixSELinux = async (path) => {
        try {
            await api.fixSELinuxContext(path);
            addToast(cockpit.format(_("SELinux context fixed for $0."), path));
        } catch (e) {
            showError(_("Failed to fix SELinux context: $0"), errText(e));
        }
        setFixModal(null);
        refreshShareStatus(shares);
    };

    const handleRecreateDirectory = async (path, validUsers, includeAcl) => {
        try {
            await api.createDirectory(path);
            if (includeAcl) {
                const permRes = await api.applySharePermissions(path, validUsers);
                if (permRes.aclWarning) {
                    addToast(_("Folder created, but per-user ACLs could not be applied (setfacl unavailable) — access is limited to the folder's owner and group."), "warning");
                }
            }
            if (await api.checkSELinuxStatus()) {
                await api.fixSELinuxContext(path);
            }
            addToast(cockpit.format(_("Folder $0 created."), path));
        } catch (e) {
            showError(_("Failed to create folder: $0"), errText(e));
            setFixModal(null);
            return;
        }
        // When opened from the share form's save flow, finish saving the
        // share now that its directory exists.
        const resumeSave = fixModal?.resumeSave;
        setFixModal(null);
        if (resumeSave) {
            await performSaveShare();
        } else {
            refreshShareStatus(shares);
        }
    };

    const handleSaveShare = async () => {
        if (!shareForm.name.trim() || !shareForm.path) {
            addToast(_("Share name and path are required."), "danger");
            return;
        }
        if (shareNameError) {
            addToast(shareNameError, "danger");
            return;
        }
        if (sharePathError) {
            addToast(sharePathError, "danger");
            return;
        }

        const dirExists = await api.checkDirectoryExists(shareForm.path);
        if (!dirExists) {
            // Reuse the Create Missing Directory modal (instead of a browser
            // dialog); saving resumes after the directory is created.
            setFixModal({
                type: 'missing',
                shareName: shareForm.name.trim(),
                path: shareForm.path,
                validUsers: shareForm.validUsers.join(', '),
                includeAcl: true,
                resumeSave: true
            });
            return;
        }

        await performSaveShare();
    };

    // Build the smb.conf section from the form and write the config. Runs
    // directly from Save when the directory exists, or after the Create
    // Missing Directory modal creates it.
    const performSaveShare = async () => {
        // The form keeps valid users as an array; smb.conf wants a comma list.
        const normalizedValidUsers = shareForm.validUsers.join(', ');

        // Carry over any extra keys from the share being edited (renames
        // included) so options this UI doesn't manage are preserved.
        const shareName = shareForm.name.trim();
        const newConfig = {
            ...(editingShareName ? shares[editingShareName] : {}),
            path: shareForm.path,
            comment: shareForm.comment,
            'read only': shareForm.readOnly ? 'yes' : 'no',
            browsable: shareForm.browsable ? 'yes' : 'no',
            'guest ok': shareForm.guestOk ? 'yes' : 'no'
        };

        if (normalizedValidUsers) {
            newConfig['valid users'] = normalizedValidUsers;
        } else {
            delete newConfig['valid users'];
        }

        const updatedShares = { ...shares };
        if (editingShareName && editingShareName !== shareName) {
            // The share was renamed — drop the old section.
            delete updatedShares[editingShareName];
        }
        updatedShares[shareName] = newConfig;

        try {
            await api.saveShares(globalConf, updatedShares);
            setShares(updatedShares);
            refreshShareStatus(updatedShares);
            setIsShareModalOpen(false);
            addToast(_("Share saved successfully."));
        } catch (err) {
            showError(_("Failed to save share: $0"), errText(err));
        }
    };

    // --- USERS MANAGEMENT ---
    const refreshUsers = async () => {
        const sysUsers = await api.loadSystemUsers();
        setUsers(sysUsers);
    };

    const openUsersModal = async () => {
        setIsActionsMenuOpen(false);
        setIsUsersModalOpen(true);
        setUserSearchQuery('');
        setEditingPasswordFor(null);
        setUsersLoading(true);
        try {
            await refreshUsers();
        } catch (err) {
            addToast(_("Failed to load users"), "danger");
        } finally {
            setUsersLoading(false);
        }
    };

    const handleSetPassword = async (username) => {
        const pass = newPasswords[username];
        if (!pass) return;
        if (pass !== confirmPasswords[username]) return;
        try {
            await api.setSmbPassword(username, pass);
            addToast(cockpit.format(_("Password updated for $0."), username));
            setNewPasswords(prev => ({ ...prev, [username]: '' }));
            setConfirmPasswords(prev => ({ ...prev, [username]: '' }));
            setEditingPasswordFor(null);
            await refreshUsers();
        } catch (e) {
            showError(_("Failed to set password for $0: $1"), username, errText(e));
        }
    };

    const handleRemovePassword = (username) => {
        setRemovePasswordModal({ username });
    };

    const confirmRemovePassword = async () => {
        const username = removePasswordModal.username;
        try {
            await api.removeSmbPassword(username);
            addToast(cockpit.format(_("Samba password removed for $0."), username));
            await refreshUsers();
            setRemovePasswordModal(null);
        } catch (e) {
            showError(_("Failed to remove password for $0: $1"), username, errText(e));
        }
    };

    // --- GLOBAL SETTINGS MANAGEMENT ---
    const openGlobalModal = () => {
        setIsActionsMenuOpen(false);
        const text = Object.entries(globalConf).map(([k, v]) => `    ${k} = ${v}`)
                .join('\n');
        setGlobalConfText(text);
        setIsGlobalModalOpen(true);
    };

    const handleSaveGlobal = async () => {
        const lines = globalConfText.split('\n');
        const newGlobal = {};

        lines.forEach(line => {
            const kv = api.parseKeyValueLine(line);
            if (kv) newGlobal[kv[0]] = kv[1];
        });

        try {
            await api.saveShares(newGlobal, shares);
            setGlobalConf(newGlobal);
            setIsGlobalModalOpen(false);
            addToast(_("Global settings saved successfully."));
        } catch (e) {
            showError(_("Failed to save global settings: $0"), errText(e));
        }
    };

    // --- BACKUP / RESTORE ---
    const openBackupModal = async () => {
        setIsActionsMenuOpen(false);
        setBackupIsPreview(false);
        setBackupText('');
        setIsBackupModalOpen(true);
        try {
            setBackupText(await api.readRawConfig());
        } catch (e) {
            showError(_("Failed to read configuration: $0"), errText(e));
        }
    };

    // Download whatever is currently shown (the live config, or a loaded
    // preview) as a file the user can keep and restore later.
    //
    // Cockpit runs plugins in a sandboxed iframe that does not set
    // "allow-downloads", so a download triggered from inside our frame is
    // silently blocked by the browser. Cockpit requires allow-same-origin for
    // its bridge, so window.top is reachable and same-origin — build and click
    // the link in the top-level (non-sandboxed) shell document instead, using
    // that realm's Blob/URL so the object URL is valid there.
    const handleBackupDownload = () => {
        try {
            let win = window;
            try {
                if (window.top && window.top.document && window.top.document.body) win = window.top;
            } catch (e) { /* cross-origin top: fall back to our own frame */ }

            const blob = new win.Blob([backupText], { type: 'application/octet-stream' });
            const url = win.URL.createObjectURL(blob);
            const a = win.document.createElement('a');
            a.href = url;
            a.download = 'smb.conf';
            win.document.body.appendChild(a);
            a.click();
            win.document.body.removeChild(a);
            win.setTimeout(() => win.URL.revokeObjectURL(url), 1000);
        } catch (e) {
            showError(_("Failed to download configuration: $0"), errText(e));
        }
    };

    // Restore = load a config file from the user's machine into the box as a
    // preview. Nothing is written until Validate & Save.
    const handleRestoreFile = (event) => {
        const file = event.target.files?.[0];
        event.target.value = ''; // allow re-selecting the same file later
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            setBackupText(String(reader.result));
            setBackupIsPreview(true);
        };
        reader.onerror = () => addToast(_("Failed to read the selected file."), "danger");
        reader.readAsText(file);
    };

    const handleSaveBackup = async () => {
        setBackupSaving(true);
        try {
            await api.saveRawConfig(backupText);
            addToast(_("Configuration saved successfully."));
            setIsBackupModalOpen(false);
            setBackupIsPreview(false);
            await loadData();
        } catch (e) {
            showError(_("Failed to save configuration: $0"), errText(e));
        } finally {
            setBackupSaving(false);
        }
    };

    // --- LOGS ---
    const auditEnabled = api.isAuditEnabled(globalConf);

    const openLogsModal = () => {
        setIsActionsMenuOpen(false);
        setLogLines('');
        setIsLogsModalOpen(true);

        const proc = api.streamServiceLogs(serviceName, chunk => {
            setLogLines(prev => {
                const next = prev + chunk;
                // Keep the buffer bounded during long-lived streams.
                return next.length > 200000 ? next.slice(next.length - 150000) : next;
            });
        });
        // journalctl --follow never exits on its own; the promise settling
        // means the stream died (or we closed it — that surfaces as
        // "cancelled", which is not worth reporting).
        proc.catch(ex => {
            if (ex?.problem !== 'cancelled') {
                setLogLines(prev => prev + '\n' + cockpit.format(_("Log stream ended: $0"), ex.message || ex.problem || '') + '\n');
            }
        });
        logProcRef.current = proc;
    };

    const closeLogsModal = () => {
        logProcRef.current?.close();
        logProcRef.current = null;
        setIsLogsModalOpen(false);
    };

    const handleToggleAudit = async (checked) => {
        setAuditToggling(true);
        try {
            const newGlobal = checked ? api.withAuditEnabled(globalConf) : api.withAuditDisabled(globalConf);
            await api.saveShares(newGlobal, shares);
            setGlobalConf(newGlobal);
            addToast(checked ? _("Advanced logging enabled.") : _("Advanced logging disabled."));
        } catch (e) {
            showError(_("Failed to update logging configuration: $0"), errText(e));
        } finally {
            setAuditToggling(false);
        }
    };

    // Keep the log view pinned to the newest output as it streams in.
    useEffect(() => {
        if (logViewRef.current) {
            logViewRef.current.scrollTop = logViewRef.current.scrollHeight;
        }
    }, [logLines]);

    // --- RENDER ---
    return (
        <Page className="no-masthead-sidebar">
            {/* TOAST NOTIFICATIONS */}
            <AlertGroup isToast isLiveRegion>
                {toasts.map(({ id, title, variant }) => (
                    <Alert key={id} variant={variant} title={title} actionClose={<AlertActionCloseButton onClose={() => setToasts(prev => prev.filter(t => t.id !== id))} />} />
                ))}
            </AlertGroup>

            <PageSection hasBodyWrapper={false} className="samba-surface">
                {serviceStatus === 'not installed'
                    ? (
                        <EmptyStatePanel
                            icon={CubesIcon}
                            title={_("Samba is not installed")}
                            paragraph={_("The Samba server is required to create and manage network file shares on this machine.")}
                            action={_("Install Samba support")}
                            isActionInProgress={installInProgress}
                            onAction={handleInstallSamba}
                        />
                    )
                    : (
                        <Stack hasGutter>
                            {/* SERVICE STATUS CARD (mirrors the "Groups" card on the Accounts page) */}
                            <Card className="ct-card" isExpanded={isServiceDetailsExpanded}>
                                <CardHeader
                    actions={{
                        actions: (
                            <KebabMenu
                                isOpen={isActionsMenuOpen}
                                onOpenChange={setIsActionsMenuOpen}
                                ariaLabel={_("Settings and actions")}
                            >
                                <DropdownItem key="users" onClick={openUsersModal}>{_("Edit Access")}</DropdownItem>
                                <DropdownItem key="global" onClick={openGlobalModal}>{_("Edit Global Settings")}</DropdownItem>
                                <DropdownItem key="logs" onClick={openLogsModal}>{_("View Logs")}</DropdownItem>
                                <DropdownItem key="backup" onClick={openBackupModal}>{_("Backup/Restore Configuration")}</DropdownItem>
                                <Divider key="div1" />
                                {serviceStatus === 'running'
                                    ? (
                                        <>
                                            <DropdownItem key="restart" onClick={() => handleServiceAction('restart')}>{_("Restart Service")}</DropdownItem>
                                            <DropdownItem key="stop" onClick={() => handleServiceAction('stop')} isDanger>{_("Stop Service")}</DropdownItem>
                                        </>
                                    )
                                    : (
                                        <DropdownItem key="start" onClick={() => handleServiceAction('start')}>{_("Start Service")}</DropdownItem>
                                    )}
                            </KebabMenu>
                        )
                    }}
                    onExpand={() => setIsServiceDetailsExpanded(!isServiceDetailsExpanded)}
                    toggleButtonProps={{
                        id: 'toggle-service-details',
                        'aria-label': isServiceDetailsExpanded ? _("Hide service details") : _("Show service details"),
                        'aria-expanded': isServiceDetailsExpanded
                    }}
                                >
                                    <CardTitle component="h2">
                                        <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                                            <span>{_("Samba")}</span>
                                            <Label color={serviceStatus === 'running' ? 'green' : serviceStatus === 'stopped' ? 'red' : 'grey'}>
                                                {STATUS_LABELS[serviceStatus] || serviceStatus}
                                            </Label>
                                        </Flex>
                                    </CardTitle>
                                </CardHeader>

                                <CardExpandableContent>
                                    <CardBody>
                                        <div className="samba-service-details">
                                            <DescriptionList className="samba-service-details-list">
                                                {serviceDetails.version && serviceDetails.version !== 'N/A' && (
                                                    <DescriptionListGroup>
                                                        <DescriptionListTerm>{_("Version")}</DescriptionListTerm>
                                                        <DescriptionListDescription>{serviceDetails.version}</DescriptionListDescription>
                                                    </DescriptionListGroup>
                                                )}
                                                {serviceDetails.activeSince && serviceDetails.activeSince !== 'N/A' && (
                                                    <DescriptionListGroup>
                                                        <DescriptionListTerm>{_("Active since")}</DescriptionListTerm>
                                                        <DescriptionListDescription>{serviceDetails.activeSince}</DescriptionListDescription>
                                                    </DescriptionListGroup>
                                                )}
                                            </DescriptionList>
                                            <Tooltip content={_("Refresh data")} position="right">
                                                <Button
                                            variant="plain"
                                            aria-label={_("Refresh data")}
                                            className={isRefreshing ? 'samba-refresh samba-refresh-spinning' : 'samba-refresh'}
                                            onClick={handleRefresh}
                                                >
                                                    <SyncAltIcon />
                                                </Button>
                                            </Tooltip>
                                        </div>

                                        {serviceStatus === 'running' && (
                                            <div className="samba-connections">
                                                <div className="samba-connections-heading">{cockpit.format(_("Connections ($0)"), userConnections.length)}</div>
                                                {userConnections.length === 0
                                                    ? (
                                                        <p className="samba-connections-empty">{_("No active connections.")}</p>
                                                    )
                                                    : (
                                                        <Table variant="compact" aria-label={_("User connections")}>
                                                            <Thead>
                                                                <Tr>
                                                                    <Th>{_("User")}</Th>
                                                                    <Th>{_("Shares")}</Th>
                                                                    <Th>{_("IP")}</Th>
                                                                    <Th>{_("Connected At")}</Th>
                                                                    <Th>{_("Encryption")}</Th>
                                                                    <Th>{_("Signing")}</Th>
                                                                </Tr>
                                                            </Thead>
                                                            <Tbody>
                                                                {userConnections.map((c) => (
                                                                    <Tr key={c.pid}>
                                                                        <Td dataLabel={_("User")}>{c.username || '—'}</Td>
                                                                        <Td dataLabel={_("Shares")}>
                                                                            <div className="samba-label-row">
                                                                                {c.shares.map(s => <Label key={s}>{s}</Label>)}
                                                                            </div>
                                                                        </Td>
                                                                        <Td dataLabel={_("IP")}>{c.machine}</Td>
                                                                        <Td dataLabel={_("Connected At")}>{c.connectedAt}</Td>
                                                                        <Td dataLabel={_("Encryption")}>{c.encryption || '—'}</Td>
                                                                        <Td dataLabel={_("Signing")}>{c.signing || '—'}</Td>
                                                                    </Tr>
                                                                ))}
                                                            </Tbody>
                                                        </Table>
                                                    )}
                                            </div>
                                        )}
                                    </CardBody>
                                </CardExpandableContent>
                            </Card>

                            {/* SHARES SECTION — plain (borderless) so it sits directly on the page surface */}
                            <Card className="ct-card" isPlain>
                                <CardHeader
                    actions={{
                        actions: (
                            <Flex spaceItems={{ default: 'spaceItemsMd' }} alignItems={{ default: 'alignItemsCenter' }} flexWrap={{ default: 'wrap', md: 'nowrap' }} justifyContent={{ default: 'justifyContentFlexEnd' }}>
                                <SearchInput
                                    aria-label={_("Search shares")}
                                    placeholder={_("Search for name, desc...")}
                                    value={searchQuery}
                                    onChange={(_e, val) => setSearchQuery(val)}
                                    onClear={() => setSearchQuery('')}
                                />
                                <Divider orientation={{ default: 'vertical' }} />
                                <Button variant="primary" onClick={() => openShareModal()}>
                                    {_("Create new share")}
                                </Button>
                            </Flex>
                        )
                    }}
                                >
                                    <CardTitle component="h2">{_("Shares")}</CardTitle>
                                </CardHeader>
                                <CardBody>
                                    {/* SHARES TABLE */}
                                    {isLoading
                                        ? (
                                            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--pf-t--global--text--color--subtle, #6a6e73)' }}>{_("Loading shares...")}</div>
                                        )
                                        : (
                                            <Table aria-label="Samba Shares Table" variant="compact">
                                                <Thead>
                                                    <Tr>
                                                        <Th className="samba-col-share-name" sort={{ sortBy: { index: activeSortIndex, direction: sortAsc ? 'asc' : 'desc' }, onSort: (_e, index) => handleSort(index === 0 ? 'name' : 'path'), columnIndex: 0 }}>{_("Share Name")}</Th>
                                                        <Th sort={{ sortBy: { index: activeSortIndex, direction: sortAsc ? 'asc' : 'desc' }, onSort: (_e, index) => handleSort(index === 0 ? 'name' : 'path'), columnIndex: 1 }}>{_("Path")}</Th>
                                                        <Th>{_("Description")}</Th>
                                                        <Th>{_("Attributes")}</Th>
                                                        <Th />
                                                    </Tr>
                                                </Thead>
                                                <Tbody>
                                                    {processedShares.length === 0
                                                        ? (
                                                            <Tr><Td colSpan={5} className="pf-v6-u-text-align-center samba-empty-cell">{_("No shares found.")}</Td></Tr>
                                                        )
                                                        : (
                                                            processedShares.map(([name, config]) => {
                                                                return (
                                                                    <Tr key={name}>
                                                                        <Td dataLabel={_("Share Name")}>{name}</Td>
                                                                        <Td dataLabel={_("Path")}>
                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                <code>
                                                                                    {config.path}
                                                                                </code>
                                                                                {shareStatus[name]?.missing && (
                                                                                    <Tooltip content={_("Create missing directory")} position="right">
                                                                                        <Button
                                                                                    variant="plain"
                                                                                    className="samba-status-icon samba-status-icon--danger"
                                                                                    aria-label={_("Create missing directory")}
                                                                                    onClick={() => setFixModal({ type: 'missing', shareName: name, path: config.path, validUsers: config['valid users'] || '', includeAcl: true })}
                                                                                        >
                                                                                            <ExclamationCircleIcon />
                                                                                        </Button>
                                                                                    </Tooltip>
                                                                                )}
                                                                                {shareStatus[name]?.selinuxBad && (
                                                                                    <Tooltip content={_("Fix SELinux")} position="right">
                                                                                        <Button
                                                                                    variant="plain"
                                                                                    className="samba-status-icon samba-status-icon--warning"
                                                                                    aria-label={_("Fix SELinux context")}
                                                                                    onClick={() => setFixModal({ type: 'selinux', shareName: name, path: config.path })}
                                                                                        >
                                                                                            <ExclamationTriangleIcon />
                                                                                        </Button>
                                                                                    </Tooltip>
                                                                                )}
                                                                            </div>
                                                                        </Td>
                                                                        <Td dataLabel={_("Description")}>{config.comment || <em style={{ color: 'var(--pf-t--global--text--color--subtle, #6a6e73)' }}>{_("None")}</em>}</Td>
                                                                        <Td dataLabel={_("Attributes")}>
                                                                            <div className="samba-label-row">
                                                                                {config['read only'] === 'yes' && <Label color="orange">{_("Read Only")}</Label>}
                                                                                {config.browsable !== 'no' && <Label color="blue">{_("Browsable")}</Label>}
                                                                                {config['guest ok'] === 'yes' && <Label color="blue">{_("Guest Access")}</Label>}
                                                                            </div>
                                                                        </Td>
                                                                        <Td dataLabel={_("Actions")} modifier="fitContent">
                                                                            <KebabMenu
                                                                                isOpen={openShareActions === name}
                                                                                onOpenChange={(isOpen) => setOpenShareActions(isOpen ? name : null)}
                                                                                ariaLabel={_("Share actions")}
                                                                            >
                                                                                <DropdownItem key="edit" onClick={() => openShareModal(name, config)}>{_("Edit Share")}</DropdownItem>
                                                                                <DropdownItem key="delete" onClick={() => handleDeleteShare(name)} isDanger>{_("Delete Share")}</DropdownItem>
                                                                            </KebabMenu>
                                                                        </Td>
                                                                    </Tr>
                                                                );
                                                            })
                                                        )}
                                                </Tbody>
                                            </Table>
                                        )}
                                </CardBody>
                            </Card>
                        </Stack>
                    )}
            </PageSection>

            {/* ADD / EDIT SHARE MODAL */}
            <Modal
                isOpen={isShareModalOpen}
                onClose={() => setIsShareModalOpen(false)}
                variant="small"
            >
                <ModalHeader title={editingShareName ? cockpit.format(_("Edit Share: $0"), editingShareName) : _("Create New Share")} />
                <ModalBody>
                    <Form isHorizontal>
                        <FormGroup label={_("Share Name")} isRequired fieldId="share-name">
                            <TextInput id="share-name" value={shareForm.name} validated={shareNameError ? 'error' : 'default'} onChange={(_event, val) => setShareForm({ ...shareForm, name: val })} />
                            {shareNameError && <FieldError>{shareNameError}</FieldError>}
                        </FormGroup>
                        <FormGroup label={_("Absolute Path")} isRequired fieldId="share-path">
                            <TextInput id="share-path" value={shareForm.path} validated={sharePathError ? 'error' : 'default'} onChange={(_event, val) => setShareForm({ ...shareForm, path: val })} />
                            {sharePathError && <FieldError>{sharePathError}</FieldError>}
                        </FormGroup>
                        <FormGroup label={_("Description")} fieldId="share-desc">
                            <TextInput id="share-desc" value={shareForm.comment} onChange={(_event, val) => setShareForm({ ...shareForm, comment: val })} />
                        </FormGroup>
                        <FormGroup label={_("Valid Users/Groups")} fieldId="share-users">
                            <MultiTypeaheadSelect
                                id="share-users"
                                placeholder={shareForm.validUsers.length === 0 ? _("All users (no restriction)") : ""}
                                options={validUserOptions}
                                selected={shareForm.validUsers}
                                onAdd={(value) => setShareForm({ ...shareForm, validUsers: [...shareForm.validUsers, value] })}
                                onRemove={(value) => setShareForm({ ...shareForm, validUsers: shareForm.validUsers.filter(v => v !== value) })}
                                onInputChange={setValidUsersInput}
                                noOptionsFoundMessage={() => _("Type a user name or @group name to add it")}
                            />
                        </FormGroup>
                        <FormGroup label={_("Options")} fieldId="share-flags">
                            <div className="samba-option-panel">
                                <Checkbox id="share-readonly" label={_("Read Only")} isChecked={shareForm.readOnly} onChange={(_event, checked) => setShareForm({ ...shareForm, readOnly: checked })} />
                                <Checkbox id="share-browsable" label={_("Browsable (Visible on network)")} isChecked={shareForm.browsable} onChange={(_event, checked) => setShareForm({ ...shareForm, browsable: checked })} />
                                <Checkbox id="share-guest" label={_("Guest Access (No password)")} isChecked={shareForm.guestOk} onChange={(_event, checked) => setShareForm({ ...shareForm, guestOk: checked })} />
                            </div>
                        </FormGroup>
                    </Form>
                </ModalBody>
                <ModalFooter>
                    <Button key="save" variant="primary" onClick={handleSaveShare}>{_("Save Share")}</Button>
                    <Button key="cancel" variant="link" onClick={() => setIsShareModalOpen(false)}>{_("Cancel")}</Button>
                </ModalFooter>
            </Modal>

            {/* MANAGE USERS MODAL */}
            <Modal
                isOpen={isUsersModalOpen}
                onClose={() => setIsUsersModalOpen(false)}
                variant="medium"
            >
                <ModalHeader title={_("Edit Access")} />
                <ModalBody>
                    <SearchInput
                        aria-label={_("Search users")}
                        placeholder={_("Search for username...")}
                        value={userSearchQuery}
                        onChange={(_e, val) => setUserSearchQuery(val)}
                        onClear={() => setUserSearchQuery('')}
                        className="samba-mb-md"
                    />
                    <List className="samba-mb-md">
                        <ListItem>{_("To allow Samba access, click the ellipsis next to the username and set a Samba password.")}</ListItem>
                        <ListItem>{_("To remove Samba access, click the ellipsis next to the username and remove the Samba password.")}</ListItem>
                        <ListItem>
                            {fmt_to_fragments(_("To create a new user, visit $0."), <a href="#" onClick={(e) => { e.preventDefault(); cockpit.jump("/users") }}>{_("Accounts")}</a>)}
                        </ListItem>
                    </List>

                    {usersLoading
                        ? (
                            <div style={{ padding: '24px', textAlign: 'center' }}>{_("Loading users...")}</div>
                        )
                        : (
                            <Table aria-label="Users Table" variant="compact">
                                <Thead>
                                    <Tr>
                                        <Th
                                                                               sort={{ sortBy: { index: 0, direction: userSortAsc ? 'asc' : 'desc' }, onSort: () => setUserSortAsc(!userSortAsc), columnIndex: 0 }}
                                        >
                                            {_("Username")}
                                        </Th>
                                        <Th>{_("Samba Access")}</Th>
                                        <Th />
                                    </Tr>
                                </Thead>
                                <Tbody>
                                    {processedUsers.length === 0
                                        ? (
                                            <Tr><Td colSpan={3} className="pf-v6-u-text-align-center samba-empty-cell">{_("No standard users found.")}</Td></Tr>
                                        )
                                        : (
                                            processedUsers.map(u => (
                                                <Tr key={u.name}>
                                                    <Td dataLabel={_("Username")}>{u.name}</Td>
                                                    <Td dataLabel={_("Samba Access")}>
                                                        <Label color={u.hasPass ? "green" : "red"}>{u.hasPass ? _("Enabled") : _("Disabled")}</Label>
                                                    </Td>
                                                    <Td dataLabel={_("Actions")} modifier="fitContent">
                                                        {editingPasswordFor === u.name
                                                            ? (() => {
                                                                const pass = newPasswords[u.name] || '';
                                                                const confirmPass = confirmPasswords[u.name] || '';
                                                                const mismatch = confirmPass.length > 0 && pass !== confirmPass;
                                                                return (
                                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '180px' }}>
                                                                        <TextInput
                                                                            type="password"
                                                                            placeholder={_("New password")}
                                                                            value={pass}
                                                                            onChange={(_event, val) => setNewPasswords({ ...newPasswords, [u.name]: val })}
                                                                            autoFocus
                                                                        />
                                                                        <TextInput
                                                                            type="password"
                                                                            placeholder={_("Confirm password")}
                                                                            value={confirmPass}
                                                                            validated={mismatch ? 'error' : 'default'}
                                                                            onChange={(_event, val) => setConfirmPasswords({ ...confirmPasswords, [u.name]: val })}
                                                                        />
                                                                        {mismatch && <FieldError>{_("Passwords do not match.")}</FieldError>}
                                                                        <div style={{ display: 'flex', gap: '8px' }}>
                                                                            <Button variant="primary" size="sm" isDisabled={!pass || pass !== confirmPass} onClick={() => handleSetPassword(u.name)}>{_("Save")}</Button>
                                                                            <Button
                                                                                variant="link" size="sm" onClick={() => {
                                                                                    setEditingPasswordFor(null);
                                                                                    setNewPasswords(prev => ({ ...prev, [u.name]: '' }));
                                                                                    setConfirmPasswords(prev => ({ ...prev, [u.name]: '' }));
                                                                                }}
                                                                            >{_("Cancel")}
                                                                            </Button>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })()
                                                            : (
                                                                <KebabMenu
                                                                    isOpen={openUserActions === u.name}
                                                                    onOpenChange={(isOpen) => setOpenUserActions(isOpen ? u.name : null)}
                                                                    ariaLabel={_("User actions")}
                                                                >
                                                                    <DropdownItem key="setpw" onClick={() => { setEditingPasswordFor(u.name); setOpenUserActions(null) }}>
                                                                        {_("Set Password")}
                                                                    </DropdownItem>
                                                                    {u.hasPass && (
                                                                        <DropdownItem key="remove" onClick={() => { handleRemovePassword(u.name); setOpenUserActions(null) }} isDanger>
                                                                            {_("Remove Password")}
                                                                        </DropdownItem>
                                                                    )}
                                                                </KebabMenu>
                                                            )}
                                                    </Td>
                                                </Tr>
                                            ))
                                        )}
                                </Tbody>
                            </Table>
                        )}
                </ModalBody>
                <ModalFooter>
                    <Button key="close" variant="primary" onClick={() => setIsUsersModalOpen(false)}>{_("Done")}</Button>
                </ModalFooter>
            </Modal>

            {/* GLOBAL SETTINGS MODAL */}
            <Modal
                isOpen={isGlobalModalOpen}
                onClose={() => setIsGlobalModalOpen(false)}
                variant="medium"
            >
                <ModalHeader
                    title={_("Edit Global Settings")}
                    description={fmt_to_fragments(_("Edit the $0 section of your Samba configuration. Changes are automatically validated before being applied."), <code>[global]</code>)}
                />
                <ModalBody>
                    <TextArea
                        value={globalConfText}
                        onChange={(_event, val) => setGlobalConfText(val)}
                        aria-label={_("Global configuration")}
                        rows={15}
                        className="samba-conf-textarea"
                    />
                </ModalBody>
                <ModalFooter>
                    <Button key="save" variant="primary" onClick={handleSaveGlobal}>{_("Validate & Save")}</Button>
                    <Button key="cancel" variant="link" onClick={() => setIsGlobalModalOpen(false)}>{_("Cancel")}</Button>
                </ModalFooter>
            </Modal>

            {/* BACKUP / RESTORE MODAL */}
            <Modal
                isOpen={isBackupModalOpen}
                onClose={() => setIsBackupModalOpen(false)}
                variant="large"
            >
                <ModalHeader
                    title={_("Backup/Restore Configuration")}
                    description={_("Download the current Samba configuration, or upload one to preview it. Uploaded configurations are only applied once validated and saved.")}
                />
                <ModalBody>
                    {backupIsPreview && (
                        <Alert
                            variant="info"
                            isInline
                            title={_("Previewing an uploaded configuration — it has not been applied yet.")}
                            className="samba-mb-md"
                        />
                    )}
                    <TextArea
                        value={backupText}
                        readOnlyVariant="default"
                        aria-label={_("Samba configuration")}
                        rows={18}
                        className="samba-conf-textarea"
                    />
                    <input
                        type="file"
                        ref={restoreInputRef}
                        style={{ display: 'none' }}
                        accept=".conf,text/plain"
                        onChange={handleRestoreFile}
                    />
                </ModalBody>
                <ModalFooter>
                    <Button key="backup" variant="secondary" onClick={handleBackupDownload}>{_("Backup Configuration")}</Button>
                    <Button key="restore" variant="secondary" onClick={() => restoreInputRef.current?.click()}>{_("Restore Configuration")}</Button>
                    <Button key="save" variant="primary" isDisabled={backupSaving} isLoading={backupSaving} onClick={handleSaveBackup}>{_("Validate & Save")}</Button>
                    <Button key="cancel" variant="link" onClick={() => setIsBackupModalOpen(false)}>{_("Cancel")}</Button>
                </ModalFooter>
            </Modal>

            {/* LOGS MODAL */}
            <Modal
                isOpen={isLogsModalOpen}
                onClose={closeLogsModal}
                variant="large"
            >
                <ModalHeader title={_("Logs")} />
                <ModalBody>
                    <div className="samba-option-panel">
                        <Checkbox
                            id="samba-audit-toggle"
                            label={_("Enable advanced logging: record file operations (open, create, rename, delete) for all connected clients.")}
                            isChecked={auditEnabled}
                            isDisabled={auditToggling}
                            onChange={(_event, checked) => handleToggleAudit(checked)}
                        />
                    </div>
                    <pre className="samba-log-view" ref={logViewRef}>
                        {logLines || _("Waiting for log output...")}
                    </pre>
                </ModalBody>
                <ModalFooter>
                    <Button key="close" variant="primary" onClick={closeLogsModal}>{_("Close")}</Button>
                </ModalFooter>
            </Modal>

            {/* DELETE SHARE CONFIRMATION MODAL */}
            <ConfirmModal
                isOpen={!!deleteModal}
                onClose={() => setDeleteModal(null)}
                onConfirm={confirmDeleteShare}
                title={cockpit.format(_("Delete share $0?"), deleteModal?.name)}
                confirmLabel={_("Delete share")}
            >
                {deleteModal && (
                    <>
                        <p>
                            {fmt_to_fragments(_("This removes the $0 share from the Samba configuration. Connected clients will lose access to it."), <strong>{deleteModal.name}</strong>)}
                        </p>
                        {deleteModal.path && (
                            <p style={{ marginTop: '8px' }}>
                                {fmt_to_fragments(_("The folder $0 and the files inside it are $1 deleted from this system."), <code>{deleteModal.path}</code>, <strong>{_("not")}</strong>)}
                            </p>
                        )}
                    </>
                )}
            </ConfirmModal>

            {/* REMOVE SAMBA PASSWORD CONFIRMATION MODAL */}
            <ConfirmModal
                isOpen={!!removePasswordModal}
                onClose={() => setRemovePasswordModal(null)}
                onConfirm={confirmRemovePassword}
                title={cockpit.format(_("Remove Samba password for $0?"), removePasswordModal?.username)}
                confirmLabel={_("Remove Password")}
            >
                {removePasswordModal && (
                    <p>
                        {fmt_to_fragments(_("This disables Samba access for $0. The account's regular system login is not affected."), <strong>{removePasswordModal.username}</strong>)}
                    </p>
                )}
            </ConfirmModal>

            {/* DIRECTORY / SELINUX FIX MODAL */}
            <Modal
                isOpen={!!fixModal}
                onClose={() => setFixModal(null)}
                variant="small"
            >
                {fixModal && (
                    <>
                        <ModalHeader title={fixModal.type === 'missing' ? _("Create Missing Directory") : _("Fix SELinux context")} />
                        <ModalBody>
                            {fixModal.type === 'missing'
                                ? (
                                    <>
                                        <p>{fmt_to_fragments(_("The path $0 was not found on the filesystem. It will now be created."), <code>{fixModal.path}</code>)}</p>
                                        <div className="samba-option-panel" style={{ marginTop: '16px' }}>
                                            <Checkbox
                                                id="fix-include-acl"
                                                label={_("Include ACL permissions to allow local access for previously defined users.")}
                                                isChecked={fixModal.includeAcl}
                                                onChange={(_e, checked) => setFixModal({ ...fixModal, includeAcl: checked })}
                                            />
                                        </div>
                                    </>
                                )
                                : (
                                    <p>{fmt_to_fragments(_("SELinux is blocking Samba from accessing $0 because this folder doesn't have the correct security context. Applying the fix registers a persistent $1 rule with $2 and relabels the folder with $3, so the fix survives a filesystem relabel."), <code>{fixModal.path}</code>, <code>samba_share_t</code>, <code>semanage fcontext</code>, <code>restorecon</code>)}</p>
                                )}
                        </ModalBody>
                        <ModalFooter>
                            {fixModal.type === 'missing'
                                ? (
                                    <Button variant="primary" onClick={() => handleRecreateDirectory(fixModal.path, fixModal.validUsers, fixModal.includeAcl)}>{_("Create Directory")}</Button>
                                )
                                : (
                                    <Button variant="primary" onClick={() => handleFixSELinux(fixModal.path)}>{_("Fix SELinux")}</Button>
                                )}
                            <Button variant="link" onClick={() => setFixModal(null)}>{_("Cancel")}</Button>
                        </ModalFooter>
                    </>
                )}
            </Modal>
        </Page>
    );
};

// Mount the App
const container = document.getElementById('app');
if (container) {
    const root = createRoot(container);
    root.render(<SambaManager />);
}
