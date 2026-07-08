# Cockpit Samba Manager

A hacked, probably broken, file sharing management plugin for [Cockpit](https://cockpit-project.org/) that provides a web interface for managing Samba shares and users.

<img width="1731" height="748" alt="Screenshot 2026-07-08 at 1 52 43 PM" src="https://github.com/user-attachments/assets/38a35565-a132-4190-b91c-66120f9ae022" />



## Installation



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
- Fix SELinux
- Fix missing folders

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
- Enable advanced logging
- View logs

## Configuration

Default paths:
- Configuration: `/etc/samba/smb.conf`
- Automatic backups created before changes

