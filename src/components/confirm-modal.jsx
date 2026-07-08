import React from 'react';
import cockpit from 'cockpit';
import { Modal, ModalHeader, ModalBody, ModalFooter, Button } from '@patternfly/react-core';

const _ = cockpit.gettext;

// A small warning-styled confirmation modal: title with a warning icon, free-
// form body, and a danger "confirm" action beside Cancel. Shared by the app's
// two confirmation dialogs that fit this shape (delete share, remove
// password). Header/body/footer are only rendered while isOpen, matching the
// callers' existing `{state && (...)}` guards, so it's safe for `children` to
// read fields off the (possibly null) state object being confirmed.
export const ConfirmModal = ({ isOpen, onClose, onConfirm, title, confirmLabel, children }) => (
    <Modal isOpen={isOpen} onClose={onClose} variant="small">
        {isOpen && (
            <>
                <ModalHeader title={title} titleIconVariant="warning" />
                <ModalBody>{children}</ModalBody>
                <ModalFooter>
                    <Button variant="danger" onClick={onConfirm}>{confirmLabel}</Button>
                    <Button variant="link" onClick={onClose}>{_("Cancel")}</Button>
                </ModalFooter>
            </>
        )}
    </Modal>
);
