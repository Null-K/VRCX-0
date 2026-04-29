import { create } from 'zustand';

type DialogKind = string;

interface DialogBreadcrumb {
    kind?: DialogKind;
    entityId?: string;
    title?: string;
    label?: string;
    description?: string;
    payload?: unknown;
    [key: string]: unknown;
}

interface ActiveDialog {
    kind: DialogKind;
    entityId: string;
    title: string;
    description?: string;
    payload?: unknown;
    crumb?: DialogBreadcrumb;
    [key: string]: unknown;
}

interface DialogMetadataPatch {
    kind?: unknown;
    entityId?: unknown;
    title?: unknown;
    description?: unknown;
}

interface DialogStoreState {
    activeDialog: ActiveDialog | null;
    breadcrumbs: DialogBreadcrumb[];
    openDialog: (dialog: ActiveDialog | null) => void;
    setDialog: (dialog: ActiveDialog | null) => void;
    setDialogTrail: (
        dialog: ActiveDialog | null,
        breadcrumbs: DialogBreadcrumb[] | unknown
    ) => void;
    updateEntityDialogMetadata: (patch?: DialogMetadataPatch) => void;
    closeDialog: () => void;
    setBreadcrumbs: (breadcrumbs: DialogBreadcrumb[]) => void;
    pushBreadcrumb: (crumb: DialogBreadcrumb) => void;
    popToBreadcrumb: (index: number) => void;
    clearDialogState: () => void;
}

const initialState: Pick<DialogStoreState, 'activeDialog' | 'breadcrumbs'> = {
    activeDialog: null,
    breadcrumbs: []
};

function dialogFromBreadcrumb(crumb: DialogBreadcrumb): ActiveDialog | null {
    if (!crumb?.kind || !crumb?.entityId) {
        return null;
    }

    return {
        kind: crumb.kind,
        entityId: crumb.entityId,
        title: crumb.title ?? crumb.label ?? crumb.kind,
        description: crumb.description ?? '',
        payload: crumb.payload ?? null
    };
}

function isSameEntity(
    left: DialogBreadcrumb | ActiveDialog | null,
    rightKind: string,
    rightEntityId: string
): boolean {
    return (
        left?.kind === rightKind &&
        String(left?.entityId ?? '').trim() === rightEntityId
    );
}

export const useDialogStore = create<DialogStoreState>((set) => ({
    ...initialState,
    openDialog(dialog) {
        set((state) => ({
            activeDialog: dialog,
            breadcrumbs: dialog?.crumb
                ? [...state.breadcrumbs, dialog.crumb]
                : state.breadcrumbs
        }));
    },
    setDialog(dialog) {
        set({ activeDialog: dialog });
    },
    setDialogTrail(dialog, breadcrumbs) {
        set({
            activeDialog: dialog,
            breadcrumbs: Array.isArray(breadcrumbs) ? breadcrumbs : []
        });
    },
    updateEntityDialogMetadata({
        kind,
        entityId,
        title = '',
        description = ''
    } = {}) {
        const normalizedKind = String(kind || '').trim();
        const normalizedEntityId = String(entityId ?? '').trim();
        const normalizedTitle = String(title || '').trim();
        const normalizedDescription = String(description || '').trim();
        if (
            !normalizedKind ||
            !normalizedEntityId ||
            (!normalizedTitle && !normalizedDescription)
        ) {
            return;
        }
        set((state) => ({
            activeDialog: isSameEntity(
                state.activeDialog,
                normalizedKind,
                normalizedEntityId
            )
                ? {
                      ...state.activeDialog,
                      ...(normalizedTitle ? { title: normalizedTitle } : {}),
                      ...(normalizedDescription
                          ? { description: normalizedDescription }
                          : {})
                  }
                : state.activeDialog,
            breadcrumbs: state.breadcrumbs.map((crumb) =>
                isSameEntity(crumb, normalizedKind, normalizedEntityId)
                    ? {
                          ...crumb,
                          ...(normalizedTitle
                              ? {
                                    label: normalizedTitle,
                                    title: normalizedTitle
                                }
                              : {}),
                          ...(normalizedDescription
                              ? { description: normalizedDescription }
                              : {})
                      }
                    : crumb
            )
        }));
    },
    closeDialog() {
        set({ activeDialog: null, breadcrumbs: [] });
    },
    setBreadcrumbs(breadcrumbs) {
        set({ breadcrumbs });
    },
    pushBreadcrumb(crumb) {
        set((state) => ({
            breadcrumbs: [...state.breadcrumbs, crumb]
        }));
    },
    popToBreadcrumb(index) {
        set((state) => ({
            activeDialog:
                dialogFromBreadcrumb(state.breadcrumbs[index]) ??
                state.activeDialog,
            breadcrumbs: state.breadcrumbs.slice(0, index + 1)
        }));
    },
    clearDialogState() {
        set(initialState);
    }
}));
export type {
    ActiveDialog,
    DialogBreadcrumb,
    DialogKind,
    DialogMetadataPatch,
    DialogStoreState
};
