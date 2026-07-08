import React from 'react';
import { Dropdown, DropdownList, MenuToggle } from '@patternfly/react-core';
import EllipsisVIcon from '@patternfly/react-icons/dist/esm/icons/ellipsis-v-icon';

// A PatternFly kebab (⋮) menu: shared boilerplate for the app's ellipsis
// dropdowns (service actions, per-share actions, per-user actions).
//
// Open/closed state deliberately stays with the caller rather than moving
// into this component: some menus track a single boolean, others track
// "which row's menu is open" by name/username, so unifying that state
// management here would risk changing behavior. This only wraps the
// Dropdown/MenuToggle/EllipsisVIcon structure that's identical everywhere.
export const KebabMenu = ({ isOpen, onOpenChange, ariaLabel, children }) => (
    <Dropdown
        isOpen={isOpen}
        onSelect={() => onOpenChange(false)}
        onOpenChange={onOpenChange}
        popperProps={{ position: 'right' }}
        toggle={(toggleRef) => (
            <MenuToggle
                ref={toggleRef}
                isExpanded={isOpen}
                onClick={() => onOpenChange(!isOpen)}
                variant="plain"
                aria-label={ariaLabel}
            >
                <EllipsisVIcon />
            </MenuToggle>
        )}
    >
        <DropdownList>
            {children}
        </DropdownList>
    </Dropdown>
);
