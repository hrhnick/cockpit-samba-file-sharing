# Cockpit Samba Manager

A hacked, probably broken, two file (.json + .html) file sharing management plugin for [Cockpit](https://cockpit-project.org/) that provides a web interface for managing Samba shares and users.

<img width="1257" height="943" alt="screenshot" src="https://github.com/user-attachments/assets/69f2b796-1e58-44b6-af3b-68f65e2f63a2" />


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

## Configuration

Default paths:
- Configuration: `/etc/samba/smb.conf`
- Automatic backups created before changes

