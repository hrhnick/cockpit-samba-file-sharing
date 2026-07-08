import cockpit from "cockpit";

const _ = cockpit.gettext;

const SMB_CONF_PATH = '/etc/samba/smb.conf';
const fileObj = cockpit.file(SMB_CONF_PATH, { syntax: "string", superuser: "try" });

// --- SERVICE MANAGEMENT ---

async function unitLoadState(serviceName) {
    try {
        const out = await cockpit.spawn(
            ["systemctl", "show", serviceName, "--property=LoadState", "--value"],
            { superuser: "try" }
        );
        return out.trim();
    } catch (e) {
        return "not-found";
    }
}

export async function checkServiceStatus() {
    let serviceName = null;
    for (const candidate of ["smb", "smbd"]) {
        if (!(await unitLoadState(candidate)).includes("not-found")) {
            serviceName = candidate;
            break;
        }
    }
    if (!serviceName) return { status: "not installed", name: null };

    try {
        const isActive = await cockpit.spawn(["systemctl", "is-active", serviceName], { superuser: "try" });
        return { status: isActive.trim() === "active" ? "running" : "stopped", name: serviceName };
    } catch (e) {
        return { status: "stopped", name: serviceName };
    }
}

export async function getServiceDetails(statusObj) {
    const details = { version: 'N/A', activeSince: 'N/A' };

    if (statusObj.status !== "not installed") {
        try {
            const out = await cockpit.spawn(["smbd", "--version"], { superuser: "try" });
            details.version = out.trim().replace(/^Version\s+/i, '');
        } catch (e) {}
    }

    if (statusObj.status === "running" && statusObj.name) {
        try {
            const ts = await cockpit.spawn(["systemctl", "show", statusObj.name, "--property=ActiveEnterTimestamp", "--value"], { superuser: "try" });
            const trimmed = ts.trim();
            if (trimmed) details.activeSince = trimmed;
        } catch (e) {}
    }

    return details;
}

const MONTH_NUMBERS = {
    Jan: '01',
    Feb: '02',
    Mar: '03',
    Apr: '04',
    Jun: '06',
    Jul: '07',
    Aug: '08',
    Sep: '09',
    Oct: '10',
    Nov: '11',
    Dec: '12',
    May: '05'
};

// smbstatus prints "Connected at" in ctime style (e.g. "Mon Jul  6 20:51:31
// 2026 EDT" — note the double space padding a single-digit day). Reformat it
// to match the "Active since" field's systemd-style layout
// ("Mon 2026-07-06 20:51:31 EDT") so the two dates in the UI look consistent.
// Also returns a plain YYYY-MM-DD HH:MM:SS sort key (no day name or
// timezone), since the display string's leading day-of-week abbreviation
// sorts alphabetically, not chronologically — needed to find a user's
// earliest connection across their per-share rows. Falls back to the raw
// string (and no sort key) if it doesn't match the expected shape.
function formatConnectedAt(raw) {
    const m = raw.trim().match(/^(\w{3})\s+(\w{3})\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})\s+(\d{4})\s+(\S+)$/);
    if (!m) return { display: raw.trim(), sortKey: null };
    const [, dow, monName, day, time, year, tz] = m;
    const month = MONTH_NUMBERS[monName];
    if (!month) return { display: raw.trim(), sortKey: null };
    const dayPadded = day.padStart(2, '0');
    return { display: `${dow} ${year}-${month}-${dayPadded} ${time} ${tz}`, sortKey: `${year}-${month}-${dayPadded} ${time}` };
}

// Parses `smbstatus -S` (per-share connections) into a list of plain
// objects. This is fixed-width columnar output, so columns are sliced by the
// character position each header starts at — not by splitting on whitespace,
// which breaks because values can themselves contain runs of 2+ spaces (the
// "Connected at" timestamp pads single-digit days: "Jul  6").
export async function getShareConnections() {
    try {
        const out = await cockpit.spawn(["smbstatus", "-S"], { superuser: "try", err: "message" });
        const lines = out.split('\n');
        const separatorIdx = lines.findIndex(l => /^-{5,}/.test(l.trim()));
        if (separatorIdx < 1) return [];

        const headerLine = lines[separatorIdx - 1];
        const knownColumns = [
            ['Service', 'share'], ['pid', 'pid'], ['Machine', 'machine'],
            ['Connected at', 'connectedAt'], ['Encryption', 'encryption'], ['Signing', 'signing']
        ];
        const columns = knownColumns
                .map(([label, key]) => ({ key, start: headerLine.indexOf(label) }))
                .filter(c => c.start !== -1)
                .sort((a, b) => a.start - b.start);

        return lines.slice(separatorIdx + 1)
                .filter(line => line.trim())
                .map(line => {
                    const entry = {};
                    columns.forEach((col, i) => {
                        const end = i + 1 < columns.length ? columns[i + 1].start : line.length;
                        entry[col.key] = line.slice(col.start, end).trim();
                    });
                    if (entry.connectedAt) {
                        const formatted = formatConnectedAt(entry.connectedAt);
                        entry.connectedAt = formatted.display;
                        entry.connectedAtSort = formatted.sortKey;
                    }
                    return entry;
                });
    } catch (e) {
        return [];
    }
}

// Maps each connected session's PID to its Samba username, parsed from
// `smbstatus -p` (the per-process/session report — distinct from `-S`'s
// per-share report, which has no username column). The two reports share PID
// as a join key. Same fixed-width column-position technique as
// getShareConnections, for the same reason (values can contain runs of 2+
// spaces, e.g. padded dates).
export async function getSessionUsernames() {
    try {
        const out = await cockpit.spawn(["smbstatus", "-p"], { superuser: "try", err: "message" });
        const lines = out.split('\n');
        const separatorIdx = lines.findIndex(l => /^-{5,}/.test(l.trim()));
        if (separatorIdx < 1) return {};

        const headerLine = lines[separatorIdx - 1];
        const pidStart = headerLine.indexOf('PID');
        const usernameStart = headerLine.indexOf('Username');
        const usernameEnd = headerLine.indexOf('Group');
        if (pidStart === -1 || usernameStart === -1 || usernameEnd === -1) return {};

        const usernames = {};
        lines.slice(separatorIdx + 1)
                .filter(line => line.trim())
                .forEach(line => {
                    const pid = line.slice(pidStart, usernameStart).trim();
                    if (pid) usernames[pid] = line.slice(usernameStart, usernameEnd).trim();
                });
        return usernames;
    } catch (e) {
        return {};
    }
}

export async function manageServiceAction(name, action) {
    return cockpit.spawn(["systemctl", action, name], { superuser: "try" });
}

// --- ADVANCED LOGGING (full_audit VFS module) ---

// A sensible default set of file operations to audit: session lifecycle plus
// actual content/structure changes. Every name here is a real operation from
// the vfs_full_audit(8) man page for a current Samba — mixing in a name a
// given version doesn't recognize makes full_audit fail to build the VFS stack
// at connect time, which silently breaks every client connection (that's what
// the removed legacy "rmdir" did). So:
//   connect / disconnect  - session lifecycle
//   mkdirat               - new directory
//   renameat              - rename / move
//   unlinkat              - delete (covers both files and directories; there
//                           is no separate "rmdir" op)
//   pwrite                - bytes written to a file (edits)
//   ftruncate             - truncate/resize; many apps "save" by truncating
//                           then rewriting, so this catches saves pwrite alone
//                           can miss, plus file-emptying
//   offload_write_recv    - server-side/offloaded copy (a copy within a share
//                           that never streams bytes through pwrite)
//
// Deliberately excludes "openat"/"create_file": in SMB *every* file access is
// an open/create, so those fire on plain reads, folder listing and thumbnail
// generation — the main source of full_audit noise — and there is no op that
// means "a new file was created" without also firing on reads. A newly saved
// file still shows up here via its pwrite/ftruncate.
//
// Failed connect attempts are logged too, so authentication problems show up.
// Messages go to syslog (picked up by the journal, tagged "smbd_audit")
// rather than Samba's own log files, so no log file settings need to change.
const AUDIT_SETTINGS = {
    'full_audit:prefix': '%u|%I|%S',
    'full_audit:success': 'connect disconnect mkdirat renameat unlinkat pwrite ftruncate offload_write_recv',
    'full_audit:failure': 'connect',
    'full_audit:facility': 'LOCAL5',
    'full_audit:priority': 'NOTICE'
};

export function isAuditEnabled(globalConfig) {
    return (globalConfig['vfs objects'] || '').split(/\s+/).includes('full_audit');
}

// Returns a copy of the [global] config with full_audit added. Appends to any
// existing "vfs objects" list (e.g. recycle) instead of replacing it.
export function withAuditEnabled(globalConfig) {
    const cfg = { ...globalConfig, ...AUDIT_SETTINGS };
    const modules = (globalConfig['vfs objects'] || '').split(/\s+/).filter(Boolean);
    if (!modules.includes('full_audit')) modules.push('full_audit');
    cfg['vfs objects'] = modules.join(' ');
    return cfg;
}

// Returns a copy of the [global] config with full_audit and all its
// full_audit:* options removed, preserving any other VFS modules.
export function withAuditDisabled(globalConfig) {
    const cfg = {};
    for (const [key, value] of Object.entries(globalConfig)) {
        if (!key.startsWith('full_audit:')) cfg[key] = value;
    }
    const modules = (cfg['vfs objects'] || '').split(/\s+/).filter(m => m && m !== 'full_audit');
    if (modules.length) cfg['vfs objects'] = modules.join(' ');
    else delete cfg['vfs objects'];
    return cfg;
}

// Starts following the journal for Samba activity: the service unit's own
// messages plus full_audit lines (journald tags those "smbd_audit" via
// syslog). The "+" argument is journalctl's OR between the two match groups.
// Returns the spawn handle; the caller must call .close() on it when done.
export function streamServiceLogs(serviceName, onData) {
    const args = ["journalctl", "--follow", "--lines=100", "--no-pager", "SYSLOG_IDENTIFIER=smbd_audit"];
    if (serviceName) args.push("+", `_SYSTEMD_UNIT=${serviceName}.service`);
    const proc = cockpit.spawn(args, { superuser: "try", err: "message" });
    proc.stream(onData);
    return proc;
}

// --- CONFIGURATION MANAGEMENT ---

export function parseKeyValueLine(line) {
    line = line.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) return null;
    const splitIndex = line.indexOf('=');
    if (splitIndex === -1) return null;
    return [line.substring(0, splitIndex).trim(), line.substring(splitIndex + 1).trim()];
}

function formatSection(header, config) {
    let out = `[${header}]\n`;
    for (const [key, value] of Object.entries(config)) out += `    ${key} = ${value}\n`;
    return out + '\n';
}

export async function readShares() {
    const data = await fileObj.read();
    if (!data) return {};

    const lines = data.split('\n');
    const shares = {};
    let currentShare = null;

    lines.forEach(line => {
        const sectionMatch = line.trim().match(/^\[(.*)\]$/);
        if (sectionMatch) {
            currentShare = sectionMatch[1];
            shares[currentShare] = {};
            return;
        }
        if (!currentShare) return;
        const kv = parseKeyValueLine(line);
        if (kv) shares[currentShare][kv[0]] = kv[1];
    });

    return shares;
}

async function validateConfig(configText) {
    let tempPath = null;
    try {
        tempPath = (await cockpit.spawn(["mktemp", "/tmp/smb_test.XXXXXX.conf"], { superuser: "try" })).trim();
        await cockpit.file(tempPath, { superuser: "try" }).replace(configText);
        await cockpit.spawn(["testparm", "-s", tempPath], { superuser: "try", err: "message" });
        return { valid: true };
    } catch (e) {
        return { valid: false, error: e.message || _("Invalid configuration syntax.") };
    } finally {
        if (tempPath) cockpit.spawn(["rm", "-f", tempPath], { superuser: "try" }).catch(() => {});
    }
}

// Validate a full smb.conf, back up the current one to .bak, write the new
// content, and reload the running service. Shared by both the structured save
// path (saveShares) and the raw restore path (saveRawConfig).
async function writeConfig(text) {
    const validation = await validateConfig(text);
    if (!validation.valid) {
        throw new Error(cockpit.format(_("Validation failed: $0"), validation.error));
    }

    await cockpit.spawn(["cp", SMB_CONF_PATH, `${SMB_CONF_PATH}.bak`], { superuser: "try" });
    await fileObj.replace(text);

    const srv = await checkServiceStatus();
    if (srv.name && srv.status === "running") {
        await cockpit.spawn(["systemctl", "reload", srv.name], { superuser: "try" });
    }
}

export async function saveShares(globalConfig, sharesConfig) {
    let output = formatSection('global', globalConfig);
    for (const [share, config] of Object.entries(sharesConfig)) {
        if (share.toLowerCase() === 'global') continue;
        output += formatSection(share, config);
    }
    await writeConfig(output);
}

// Returns the raw, unparsed smb.conf text (for the backup/restore view).
export async function readRawConfig() {
    const data = await fileObj.read();
    return data || '';
}

// Writes an entire smb.conf verbatim (a restored/uploaded config), after the
// same validate + backup + reload as a normal save.
export async function saveRawConfig(text) {
    await writeConfig(text);
}

// --- DIRECTORY & PERMISSION HELPERS ---

export async function checkSELinuxStatus() {
    try {
        const getenforce = await cockpit.spawn(["getenforce"], { superuser: "try", err: "message" });
        const mode = getenforce.trim();
        return mode === "Enforcing" || mode === "Permissive";
    } catch (e) {
        // getenforce may be missing or not in the bridge's PATH even when
        // SELinux is active — fall back to the kernel's selinuxfs interface.
        try {
            const enforce = await cockpit.file("/sys/fs/selinux/enforce", { superuser: "try" }).read();
            return enforce !== null;
        } catch (e2) {
            return false;
        }
    }
}

export async function checkDirectoryExists(path) {
    try {
        await cockpit.spawn(['test', '-d', path], { superuser: "try" });
        return true;
    } catch (e) {
        return false;
    }
}

export async function createDirectory(path) {
    return cockpit.spawn(['mkdir', '-p', path], { superuser: "try" });
}

export async function checkSELinuxContext(path) {
    const isSELinuxEnabled = await checkSELinuxStatus();
    if (!isSELinuxEnabled || path.trim() === '/') return true;

    try {
        const out = await cockpit.spawn(["ls", "-Zd", path], { superuser: "try", err: "message" });
        // "?" means no SELinux context is recorded (e.g. non-SELinux filesystem);
        // nothing to fix in that case.
        if (out.trim().startsWith("?")) return true;
        return out.includes("samba_share_t") || out.includes("public_content_t");
    } catch (e) {
        // Could not determine the context — don't show a warning based on a
        // failed check.
        return true;
    }
}

export async function fixSELinuxContext(path) {
    // Strip trailing slashes so the semanage regex pattern is well-formed. A
    // path made up entirely of slashes (e.g. "//") is root-equivalent — the
    // kernel collapses redundant leading slashes — so falling back to "/"
    // (not the original string) is what makes the root check below actually
    // catch that case.
    const cleanPath = path.trim().replace(/\/+$/, '') || '/';
    // A path that reduces to "/" would relabel the entire filesystem with
    // samba_share_t — refuse outright rather than trust callers to never
    // pass it (checkSELinuxContext already skips "/", but this function
    // shouldn't rely on that being the only caller).
    if (cleanPath === '/') {
        throw new Error(_("Refusing to change the SELinux context of the filesystem root."));
    }
    const fcontextPattern = `${cleanPath}(/.*)?`;

    try {
        // Register a persistent file-context rule so the samba_share_t label
        // survives a filesystem relabel (autorelabel / restorecon -R /), which
        // would otherwise silently revert a one-off chcon. `-a` (add) fails if a
        // rule already exists for this path, so fall back to `-m` (modify).
        try {
            await cockpit.spawn(["semanage", "fcontext", "-a", "-t", "samba_share_t", fcontextPattern],
                                { superuser: "try", err: "message" });
        } catch (e) {
            await cockpit.spawn(["semanage", "fcontext", "-m", "-t", "samba_share_t", fcontextPattern],
                                { superuser: "try", err: "message" });
        }
        return await cockpit.spawn(["restorecon", "-R", cleanPath], { superuser: "try" });
    } catch (e) {
        // semanage/restorecon may be unavailable (policycoreutils-python-utils
        // not installed). Fall back to chcon, which fixes the label immediately
        // but does not persist across a relabel.
        return cockpit.spawn(["chcon", "-R", "-t", "samba_share_t", path], { superuser: "try" });
    }
}

function parseValidUsersField(raw) {
    const users = [];
    const groups = [];
    if (!raw) return { users, groups };

    raw.split(',').map(t => t.trim())
            .filter(Boolean)
            .forEach(t => {
                if (t.startsWith('@')) {
                    const g = t.slice(1).trim();
                    if (g) groups.push(g);
                } else {
                    users.push(t);
                }
            });
    return { users, groups };
}

export async function applySharePermissions(path, validUsersRaw) {
    const { users, groups } = parseValidUsersField(validUsersRaw);

    if (users.length === 0 && groups.length === 0) {
        await cockpit.spawn(['chmod', '777', path], { superuser: "try" });
        return {};
    }

    if (users.length === 0 && groups.length === 1) {
        await cockpit.spawn(['chgrp', groups[0], path], { superuser: "try" });
        await cockpit.spawn(['chmod', '2770', path], { superuser: "try" });
        return {};
    }

    await cockpit.spawn(['chmod', '770', path], { superuser: "try" });

    const aclEntries = [];
    users.forEach(u => { aclEntries.push(`u:${u}:rwx`, `d:u:${u}:rwx`) });
    groups.forEach(g => { aclEntries.push(`g:${g}:rwx`, `d:g:${g}:rwx`) });

    try {
        await cockpit.spawn(['setfacl', '-m', aclEntries.join(','), path], { superuser: "try" });
        return {};
    } catch (e) {
        return { aclWarning: true };
    }
}

// --- USER MANAGEMENT ---

export async function loadSystemUsers() {
    const sambaUsers = new Set();
    try {
        const out = await cockpit.spawn(["pdbedit", "-L"], { superuser: "try" });
        out.split('\n').forEach(line => {
            const name = line.split(':')[0].trim();
            if (name) sambaUsers.add(name);
        });
    } catch (e) {}

    try {
        const passwd = await cockpit.spawn(["getent", "passwd"], { superuser: "try" });
        const users = [];

        for (const line of passwd.split('\n')) {
            if (!line.trim()) continue;
            const parts = line.split(':');
            if (parts.length < 7) continue;

            const username = parts[0];
            const uid = parseInt(parts[2], 10);
            const shell = parts[6];

            if (uid >= 1000 && uid < 60000 && !shell.includes('nologin') && !shell.includes('false') && !shell.includes('sync')) {
                users.push({ name: username, hasPass: sambaUsers.has(username) });
            }
        }
        return users;
    } catch (e) {
        return [];
    }
}

export async function loadUserGroupSuggestions() {
    const DYNAMIC_ID_MIN = 61184;
    const DYNAMIC_ID_MAX = 65519;
    const isDynamicId = (id) => id >= DYNAMIC_ID_MIN && id <= DYNAMIC_ID_MAX;
    const NOISE_GROUPS = new Set(['nobody', 'nogroup']);
    const ALWAYS_INCLUDE_GROUPS = new Set(['wheel', 'sudo', 'admin', 'adm']);

    const userSuggestions = [];
    const realUsernames = new Set();
    const realUserGids = new Set();

    try {
        const passwdOut = await cockpit.spawn(['getent', 'passwd']);
        passwdOut.trim().split('\n')
                .forEach(line => {
                    if (!line) return;
                    const parts = line.split(':');
                    if (parts.length < 7) return;
                    const name = parts[0];
                    const uid = parseInt(parts[2], 10);
                    const gid = parseInt(parts[3], 10);
                    const shell = parts[6];
                    if ((uid === 0 || uid >= 1000) && !isDynamicId(uid) && !shell.includes('nologin') && !shell.includes('false')) {
                        userSuggestions.push(name);
                        realUsernames.add(name);
                        realUserGids.add(gid);
                    }
                });
    } catch (e) {}

    const groupSuggestions = [];
    try {
        const groupOut = await cockpit.spawn(['getent', 'group']);
        groupOut.trim().split('\n')
                .forEach(line => {
                    if (!line) return;
                    const parts = line.split(':');
                    if (parts.length < 3) return;
                    const name = parts[0];
                    const gid = parseInt(parts[2], 10);
                    const members = parts[3] ? parts[3].split(',').filter(Boolean) : [];

                    if (isDynamicId(gid) || NOISE_GROUPS.has(name)) return;
                    const hasRealMember = members.some(m => realUsernames.has(m));
                    const isPrimaryForRealUser = realUserGids.has(gid);
                    if (hasRealMember || isPrimaryForRealUser || ALWAYS_INCLUDE_GROUPS.has(name)) {
                        groupSuggestions.push('@' + name);
                    }
                });
    } catch (e) {}

    return [...userSuggestions, ...groupSuggestions];
}

export async function setSmbPassword(user, pass) {
    const inputString = `${pass}\n${pass}\n`;
    return cockpit.spawn(["smbpasswd", "-a", "-s", user], { err: "out", directory: "/", superuser: "try" })
            .input(inputString);
}

export async function removeSmbPassword(username) {
    return cockpit.spawn(["pdbedit", "-x", "-u", username], { superuser: "try" });
}
