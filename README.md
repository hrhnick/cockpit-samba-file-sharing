# Cockpit Samba Manager

A hacked, probably broken, file sharing management plugin for [Cockpit](https://cockpit-project.org/) that provides a web interface for managing Samba shares and users.

![2025_06_30___21_49_03](https://github.com/user-attachments/assets/adb8d24c-abf0-46d0-b25a-737e93380c6d)

## Installation

```bash
sudo mkdir -p /usr/share/cockpit/samba
sudo cp -r * /usr/share/cockpit/samba/
sudo systemctl reload cockpit
```

Access through Cockpit at `https://your-server:9090`

## Requirements

- Cockpit web console
- Samba server (smbd)
- Samba common tools (smbpasswd, testparm, pdbedit)

## Core Features

**Share Management**
- Create and configure Samba shares
- Set access permissions (read-only/read-write)
- Configure guest access and browseable options
- Manage valid users and groups per share
- Edit and delete existing shares

**User Management**
- Enable/disable Samba access for system users
- Set and change Samba passwords
- View user status at a glance
- Only shows regular users (UID >= 1000)
- Quick link to the Cockpit Users/Accounts plugin for advanced user management/creation

**Service Control**
- Monitor Samba service status
- Start, stop, and restart Samba
- Automatic service detection (smb/smbd)

**Configuration Management**
- Direct editing of smb.conf with syntax validation
- Backup and restore configuration
- Download configuration backups
- Automatic configuration reload without disrupting connections

## Configuration

Default paths:
- Configuration: `/etc/samba/smb.conf`
- Automatic backups created before changes

## Usage

1. Navigate to the Shares tab to manage file shares
2. Click "Add share" to create a new share
3. Navigate to Users tab to manage Samba user access
4. Use Settings to directly edit or backup the configuration

## Security Notes

- All operations require appropriate permissions
- Configuration changes are validated before applying
- Automatic backups are created before modifications
